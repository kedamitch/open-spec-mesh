"""Numbered documents, preserved indexes and serialized allocation (POSIX)."""
from contextlib import contextmanager
import fcntl, hashlib, os
from pathlib import Path
import re, tempfile
from sdd_common import inside, read_text, create_text
AREAS = dict(zip(('01-governance','02-product','03-architecture','04-operations','05-changes','06-decisions','07-research','08-quality','09-delivery'),('G','P','T','O','C','ADR','R','Q','D')))
CODE = r'(?:[GPTOCRQD][0-9]{2}(?:-[0-9]{2})*|ADR-[0-9]{3})'
def title_check(title):
    if not re.fullmatch(r'[A-Za-z0-9_\-\u3400-\u9fff]{1,80}', title) or not re.search(r'[A-Za-z\u3400-\u9fff]', title):
        raise ValueError('名称仅允许中英文文字、数字、下划线和连字符。')
@contextmanager
def locked(root):
    key=hashlib.sha256(str(root.resolve()).encode()).hexdigest(); path=Path(tempfile.gettempdir())/f'sdd-{os.getuid()}-{key}.lock'; fd=os.open(path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as stream: fcntl.flock(stream,fcntl.LOCK_EX); yield
def atomic(path,text):
    if path.is_symlink(): raise ValueError('Refusing symlink')
    fd,name=tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as stream: stream.write(text)
        if path.exists(): os.chmod(name,path.stat().st_mode)
        os.replace(name,path)
    finally: Path(name).unlink(missing_ok=True)
def refresh(directory):
    path=directory/'index.md'; old=read_text(path) if path.exists() else f'# {directory.name}\n'; begin,end='<!-- INDEX:BEGIN -->','<!-- INDEX:END -->'
    links='\n'.join(f'- [{p.name}]({p.name}{"/index.md" if p.is_dir() else ""})' for p in sorted(directory.iterdir()) if p.name!='index.md' and not p.name.startswith('.')); block=f'{begin}\n{links}\n{end}'
    if begin in old:
        if old.count(begin)!=1 or old.count(end)!=1 or old.index(end)<old.index(begin): raise ValueError(f'Invalid index markers: {path}')
        old=old[:old.index(begin)]+block+old[old.index(end)+len(end):]
    else: old=old.rstrip()+'\n\n'+block+'\n'
    atomic(path,old)
def prefix(root,parent):
    rel=parent.relative_to(root/'docs')
    if not rel.parts or rel.parts[0] not in AREAS: raise ValueError('请选择 docs 的一级分类或其子目录。')
    base=AREAS[rel.parts[0]]
    if len(rel.parts)==1 or re.fullmatch(r'CHG-\d{8}-.+',parent.name): return base
    match=re.match(f'^({CODE})-',parent.name)
    if not match or not match[1].startswith(base): raise ValueError(f'Invalid parent code: {parent}')
    return match[1]
def allocate(root,parent,title,*,directory=False,extension='md',content=''):
    title_check(title); parent=inside(root,parent.relative_to(root))
    if not parent.is_dir() or not re.fullmatch(r'[a-z0-9]+',extension): raise ValueError('Invalid parent or extension')
    stem=prefix(root,parent); lead=stem if len(stem)==1 else stem+'-'; width=3 if stem=='ADR' else 2; pattern=re.compile(r'^'+re.escape(lead)+rf'(\d{{{width}}})-')
    nums=[int(m[1]) for p in parent.iterdir() if (m:=pattern.match(p.name))]
    if len(nums)!=len(set(nums)) or 0 in nums: raise ValueError('Existing duplicate/zero numbering; repair before allocating.')
    number=max(nums,default=0)+1
    if number>=10**width: raise ValueError('编号已用尽，请按主题增加层级。')
    name=f'{lead}{number:0{width}d}-{title}'; target=parent/(name if directory else name+'.'+extension)
    if directory: target.mkdir(); create_text(target/'index.md',content or f'# {title}\n')
    else: create_text(target,content or f'# {title}\n')
    refresh(parent); return target
