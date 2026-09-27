"""Offline ownership-scoped cleanup; legacy manifests are migrated, not retained."""
from __future__ import annotations
import hashlib
import json
import re
import subprocess
from pathlib import Path

PACKAGE = 'kedamitch/open-spec-mesh'
MANIFEST = '.open-spec-mesh-managed.json'
OLD_MANIFEST = '.open-spec-mesh.install.json'
BEGIN = '<!-- open-spec-mesh: BEGIN -->'
END = '<!-- open-spec-mesh: END -->'
LEGACY_SKILLS = (
    'sdd-project-init', 'sdd-requirements-init', 'sdd-architecture-init',
    'sdd-change-init', 'sdd-change-spec', 'sdd-change-design', 'sdd-change-plan',
    'sdd-change-execution', 'sdd-change-verify', 'sdd-change-close',
    'sdd-decision-research', 'sdd-plan', 'sdd-execute',
)
LEGACY_ROLES = {'implementer': 'agents/implementer.toml', 'e2e': 'agents/e2e.toml'}
LEGACY_AUX = ('agents/validate_agents.py', 'agents/test_validate_agents.py')


def blob_hash(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def catalog(source):
    data = json.loads((source/'scripts/install-legacy.json').read_text(encoding='utf-8'))
    result = {row['blob'] for row in data['agents_md']}
    args = ['git', '--no-pager', '-C', str(source)]
    try:
        root = subprocess.run(args+['rev-parse','--show-toplevel'],capture_output=True,text=True,timeout=5)
        if root.returncode or Path(root.stdout.strip()).resolve()!=source.resolve(): return result
        history = subprocess.run(args+['log','--format=%H','-128','--','AGENTS.md'],capture_output=True,text=True,timeout=10)
        if history.returncode: return result
        for sha in history.stdout.splitlines():
            if not re.fullmatch(r'[0-9a-f]{40,64}',sha): continue
            old = subprocess.run(args+['show',f'{sha}:AGENTS.md'],capture_output=True,timeout=5)
            if old.returncode == 0 and len(old.stdout)<=131072:
                result.add(blob_hash(old.stdout.replace(b'\r\n',b'\n')))
    except (OSError,subprocess.TimeoutExpired): pass
    return result


def visible(text):
    fence=None;comment=False
    for i,raw in enumerate(text.splitlines(keepends=True)):
        line=raw.rstrip('\r\n');m=re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$',line)
        if fence:
            if m and m[1][0]==fence[0] and len(m[1])>=len(fence) and not m[2].strip():fence=None
        elif comment:
            if '-->' in line:comment=False
        elif m:fence=m[1]
        elif line.strip() in (BEGIN,END):yield i,line.strip()
        elif '<!--' in line:comment='-->' not in line.split('<!--',1)[1]
        elif not line.startswith(('    ','\t','>')):yield i,line
    if fence or comment:raise ValueError('AGENTS.md has unclosed example/comment; no files changed')


def clean_agents(existing, source_text, fingerprints):
    """Replace verified package spans, retaining surrounding user text byte-for-byte."""
    original=existing.splitlines(keepends=True);marked=[];start=None
    for i,line in visible(existing):
        if line==BEGIN:
            if start is not None:raise ValueError('Nested AGENTS managed markers')
            start=i
        elif line==END:
            if start is None:raise ValueError('Orphan AGENTS end marker')
            marked.append((start,i+1));start=None
    if start is not None:raise ValueError('Unclosed AGENTS managed block')
    omitted={i for first,last in marked for i in range(first,last)}
    mapping=[i for i in range(len(original)) if i not in omitted]
    lines=[original[i] for i in mapping]
    normalized=[line.replace('\r\n','\n') for line in lines]
    starts=[i for i,line in visible(''.join(lines)) if re.match(r'^#{1,2} ',line)]
    fingerprints=set(fingerprints)|{blob_hash(source_text.encode())}
    unmarked=[];end_of_match=0
    skills=(*LEGACY_SKILLS,'sdd-init','sdd-migrate','sdd-change','sdd-do','sdd-close','sdd-research','sdd-release','prd-spec','design-overview')
    links=re.compile(r'(\]\()skills/('+'|'.join(map(re.escape,skills))+r')/')
    for i in starts:
        if i<end_of_match:continue
        raw=b'';source_layout=b''
        for j in range(i,len(lines)):
            raw+=normalized[j].encode();source_layout+=links.sub(r'\1\2/',normalized[j]).encode()
            if len(raw)>131072:break
            variants={raw.rstrip(b'\n'),source_layout.rstrip(b'\n')}
            if any(blob_hash(core+tail) in fingerprints for core in variants for tail in (b'',b'\n',b'\n\n')):
                unmarked.append((mapping[i],mapping[j]+1));end_of_match=j+1;break
    spans=sorted(marked+unmarked);merged=[]
    for first,last in spans:
        if merged and first<=merged[-1][1]:merged[-1]=(merged[-1][0],max(last,merged[-1][1]))
        else:merged.append((first,last))
    block=BEGIN+'\n\n'+source_text.rstrip()+'\n\n'+END+'\n'
    parts=[];outside=[];cursor=0
    for n,(first,last) in enumerate(merged):
        user=''.join(original[cursor:first]);parts.append(user);outside.append(user)
        if n==0:parts.append(block)
        cursor=last
    tail=''.join(original[cursor:]);parts.append(tail);outside.append(tail);text=''.join(parts)
    if not merged:
        sep='' if not text or text.endswith('\n\n') else ('\n' if text.endswith('\n') else '\n\n')
        text+=sep+block
    warnings=[];remaining='\n'.join(line for _,line in visible(''.join(outside)))
    if any(re.search(r'(?<![\w-])'+re.escape(name)+r'(?![\w-])',remaining) for name in (*LEGACY_SKILLS,*LEGACY_ROLES)):
        warnings.append('AGENTS.md: unrecognized legacy references preserved; mark only known package text with BEGIN/END')
    return text,len(marked),len(unmarked),warnings


def read_manifest(home):
    """Read both released manifest formats; paths are validated before any cleanup."""
    result={'skills':[],'roles':{}}
    for filename in (OLD_MANIFEST,MANIFEST):
        path=home/filename
        if path.is_symlink():raise ValueError('Refusing symlink install manifest')
        if not path.exists():continue
        if not path.is_file():raise ValueError('Install manifest must be a file')
        data=json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(data,dict):raise ValueError('Invalid install manifest')
        if filename==OLD_MANIFEST:
            if data.get('package')!=PACKAGE or data.get('schema_version')!=1:raise ValueError('Unknown old install manifest')
            roles=data.get('roles')
        else:
            if data.get('schema')!=1 or data.get('package',PACKAGE)!=PACKAGE:raise ValueError('Unknown install manifest')
            names=data.get('roles')
            if not isinstance(names,list) or any(not isinstance(n,str) for n in names):raise ValueError('Invalid manifest roles')
            if len(names)!=len(set(names)):raise ValueError('Duplicate manifest roles')
            roles={r:f'agents/{r}.toml' for r in names}
        skills=data.get('skills')
        valid=lambda n:isinstance(n,str) and bool(re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,79}',n))
        if (not isinstance(skills,list) or any(not valid(s) for s in skills) or len(skills)!=len(set(skills))
                or not isinstance(roles,dict) or any(not valid(r) or p!=f'agents/{r}.toml' for r,p in roles.items())):
            raise ValueError('Unsafe paths in install manifest')
        result['skills']=sorted(set(result['skills'])|set(skills));result['roles'].update(roles)
    return result


def registration_path(value,home):
    if not isinstance(value,str):return None
    p=Path(value).expanduser()
    if p.is_absolute():
        try:p=p.relative_to(home)
        except ValueError:return None
    if '..' in p.parts or '\\' in value:return None
    return p.as_posix()


def legacy_agent_readme(path):
    if path.is_symlink():raise ValueError('Refusing symlink legacy Agent README')
    if not path.is_file():return False
    text=path.read_text(encoding='utf-8')
    return text.startswith('# Personal agents') and all(t in text for t in ('Subagent','implementer','e2e'))


def retirement(home,config,previous,current_skills,current_roles):
    skills=(set(LEGACY_SKILLS)|set(previous['skills']))-set(current_skills)
    roles={**LEGACY_ROLES,**previous['roles']};roles={r:p for r,p in roles.items() if r not in current_roles}
    owned=set(roles.values());registrations=config.get('agents',{})
    if not isinstance(registrations,dict):raise ValueError('agents must be a TOML table')
    removed=set();warnings=[]
    for name,settings in registrations.items():
        if not isinstance(settings,dict) or name in current_roles:continue
        target=registration_path(settings.get('config_file'),home)
        if target in owned or (name in roles and 'config_file' not in settings):removed.add(name)
        elif name in roles:warnings.append(f'Retained custom registration agents.{name}: different config_file')
    paths={f'skills/{s}' for s in skills}|owned|set(LEGACY_AUX)
    if legacy_agent_readme(home/'agents/README.md'):paths.add('agents/README.md')
    if (home/OLD_MANIFEST).exists():paths.add(OLD_MANIFEST)
    return sorted(paths),sorted(removed),warnings


def manifest_text(skills,roles):
    return json.dumps({'schema':1,'package':PACKAGE,'skills':list(skills),'roles':list(roles)},indent=2)+'\n'
