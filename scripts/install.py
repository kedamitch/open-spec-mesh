#!/usr/bin/env python3
"""Install the runtime by default; package history is an explicit opt-in."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import urlparse
import shutil
import subprocess
import sys
import tempfile
import tomllib

sys.path.insert(0, str(Path(__file__).resolve().parent))
import install_migrations as migration
from install_toml import DELETE, set_value
SOURCE = Path(__file__).resolve().parents[1]
CORE_SKILLS = ('sdd-init', 'sdd-migrate', 'sdd-change', 'sdd-do', 'sdd-close', 'sdd-research', 'sdd-release', 'sdd-diagnose')
COMPAT_SKILLS = ('prd-spec', 'design-overview')
SKILLS = CORE_SKILLS + COMPAT_SKILLS
LEGACY_SKILLS = ('sdd-plan', 'sdd-execute')
ROLES = ('architect', 'worker', 'reviewer', 'explorer', 'librarian')
BEGIN, END = '<!-- open-spec-mesh: BEGIN -->', '<!-- open-spec-mesh: END -->'
TOOLS_DIR = '.open-spec-mesh-tools'
MIN_NODE = (20, 18, 1)
LEGACY_CODEGRAPH_PACKAGE = '@astudioplus/codegraph-mcp'
RESEARCH_TOOLS = (
    ('codegraph', '@colbymchenry/codegraph', 'codegraph', ()),
    ('context7', '@upstash/context7-mcp', 'context7-mcp', ('CONTEXT7_API_KEY',)),
    ('tavily', 'tavily-mcp', 'tavily-mcp', ('TAVILY_API_KEY',)),
)
LAYA_ENV_VARS = ('LAYA_BASE_URL', 'LAYA_API_KEY')
TYPESAFE_ENV_VARS = ('TYPESAFE_API_KEY',)
LAYA_MCP_REQUIREMENT = 'mcp>=2.2.0,<3'
RETIRED_LAYA_ENV = ('LAYA_BATCH_PATH',)  # Migration only; never read its value.
LAYA_SKILL = 'typesafe-laya'
LAYA_FILES = ('mcp/laya_http_mcp.py', 'mcp/laya_contracts.py', 'mcp/laya_runtime.py',
              'mcp/laya-settings.json', 'mcp/templates/execution-mode.v1.json',
              'mcp/templates/delegation.v1.json')
sys.path.insert(0, str(SOURCE/'mcp'))
from laya_contracts import (config as validate_laya_config, resolve_provider,
                            OPTIONAL_ENV, FORWARDED_ENV)


def active_skills(with_laya=False):
    return SKILLS + ((LAYA_SKILL,) if with_laya else ())


def laya_policy():
    return ('\n## 可复用语义判断\n\n'
            '只有同类判断批量或反复执行且有实际收益时，按 `typesafe-laya/SKILL.md` '
            '复用命名模板；新场景先定义、验证一次，再重复执行。明确或一次性判断直接完成。'
            '不为调用 Laya 重新总结长上下文，不每轮调用、不增加阶段。'
            '工具失败或不确定时原角色继续；不改变审批、角色权限、模型配置和验收要求。\n')



def safe_path(path: Path) -> None:
    """Reject links in the target and its ancestors, including broken links."""
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError(f'Refusing symlink: {part}')


def safe_tree(path: Path) -> None:
    safe_path(path)
    if path.is_dir():
        for child in path.rglob('*'):
            if child.is_symlink():
                raise ValueError(f'Refusing symlink: {child}')


def check_research_keys(*, required: bool = True, reporter=lambda _: None) -> list[str]:
    """Check this process's exported variables, never log/persist/probe their values."""
    missing = []
    for _, _, _, names in RESEARCH_TOOLS:
        for name in names:
            present = bool(os.environ.get(name, '').strip())
            reporter(f'  ENV {name}: ' + ('present (value hidden; not authenticated)' if present else 'MISSING (unset or empty)'))
            if not present:
                missing.append(name)
    if missing:
        message = 'Missing required environment variables: ' + ', '.join(missing)
        if required:
            raise ValueError(message + '; export them in the invoking shell and rerun ./install.sh')
        reporter('  WARNING ' + message + '; tool readiness is NOT verified')
    return missing


def research_install_env() -> dict[str, str]:
    """Package lifecycle scripts need no service credentials."""
    env = os.environ.copy()
    for _, _, _, names in RESEARCH_TOOLS:
        for name in names:
            env.pop(name, None)
    for name in (*FORWARDED_ENV, *RETIRED_LAYA_ENV):
        env.pop(name, None)
    return env


def check_laya_env(*, required: bool = True, reporter=lambda _: None) -> list[str]:
    """Check the selected System One provider without logging credential values."""
    try:
        provider = resolve_provider()
    except ValueError as error:
        if required:
            raise
        reporter('  WARNING ' + str(error) + '; System One MCP readiness is NOT verified')
        return ['SYSTEMONE_PROVIDER']
    names = LAYA_ENV_VARS if provider == 'laya' else TYPESAFE_ENV_VARS
    reporter(f'  SYSTEMONE provider: {provider}')
    missing = []
    for name in names:
        present = bool(os.environ.get(name, '').strip())
        reporter(f'  ENV {name}: ' + ('present (value hidden; endpoint not probed)' if present else 'MISSING (unset or empty)'))
        if not present:
            missing.append(name)
    if missing:
        message = 'Missing required environment variables: ' + ', '.join(missing)
        if required:
            raise ValueError(message + '; export them in the invoking shell and rerun ./install.sh')
        reporter('  WARNING ' + message + '; System One MCP readiness is NOT verified')
    if not missing:
        try:
            validate_laya_config()
        except ValueError as error:
            if required:
                raise
            reporter('  WARNING ' + str(error) + '; System One MCP readiness is NOT verified')
    return missing


def managed_laya_config(config: dict, home: Path) -> bool:
    """Recognize only this package's Laya bridge launch shape."""
    if 'url' in config:
        return False
    args = config.get('args', [])
    command = config.get('command', '')
    if not isinstance(command, str) or not re.fullmatch(r'python(?:3(?:\.\d+)?)?', Path(command).name):
        return False
    return args in (
        ['mcp/laya_http_mcp.py'],
        [str(home/'mcp/laya_http_mcp.py')],
    )


def laya_server_managed(home: Path, reporter=lambda _: None) -> bool:
    """Whether the installer owns mcp_servers.laya for this Codex Home."""
    config_path = home/'config.toml'
    safe_path(config_path)
    if not config_path.exists():
        return True
    data = tomllib.loads(config_path.read_text(encoding='utf-8'))
    servers = data.get('mcp_servers', {})
    if not isinstance(servers, dict):
        raise ValueError('mcp_servers must be a table')
    config = servers.get('laya')
    if config is None:
        return True
    if not isinstance(config, dict):
        raise ValueError('mcp_servers.laya must be a table')
    if not managed_laya_config(config, home):
        reporter('  TOOL preserve mcp_servers.laya (custom; not probed)')
        return False
    return True


def laya_mcp_config(home: Path, command: str | None = None) -> dict:
    return {
        'type': 'stdio',
        'command': command or sys.executable,
        'args': [str(home/'mcp/laya_http_mcp.py')],
        'env_vars': list(FORWARDED_ENV),
        'enabled': True,
    }


def laya_mcp_version(path: Path) -> tuple[int, int, int] | None:
    """Read the managed MCP distribution version without importing it."""
    if not path.is_dir():
        return None
    for metadata in path.glob('mcp-*.dist-info/METADATA'):
        try:
            fields = {}
            for line in metadata.read_text(encoding='utf-8', errors='replace').splitlines():
                if ': ' in line:
                    key, value = line.split(': ', 1)
                    fields.setdefault(key.lower(), value)
            if fields.get('name', '').lower() != 'mcp':
                continue
            match = re.match(r'^(\d+)\.(\d+)(?:\.(\d+))?', fields.get('version', ''))
            if match:
                return tuple(int(part or 0) for part in match.groups())
        except OSError:
            return None
    return None


def ensure_laya_mcp(home: Path, dry_run: bool = False, reporter=lambda _: None) -> dict:
    """Install the Python MCP runtime into a package-owned target directory."""
    home = Path(os.path.abspath(home.expanduser()))
    destination = home/TOOLS_DIR/'laya/python'
    safe_path(destination)
    version = laya_mcp_version(destination)
    launch = laya_mcp_config(home)
    if version is not None and (2, 2, 0) <= version < (3, 0, 0):
        reporter(f'  TOOL reuse laya MCP runtime: mcp {version[0]}.{version[1]}.{version[2]}')
        return launch
    reporter(f'  TOOL install laya MCP runtime: {LAYA_MCP_REQUIREMENT}')
    if dry_run:
        return launch

    parent = destination.parent
    safe_path(parent)
    parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.laya-python-', dir=parent))
    backup = parent/'.python.previous'
    safe_path(backup)
    if backup.exists():
        shutil.rmtree(stage)
        raise ValueError('Previous Laya runtime recovery data exists; inspect it before retrying')
    try:
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input',
             '--upgrade', '--target', str(stage), LAYA_MCP_REQUIREMENT],
            text=True, capture_output=True, timeout=180, env=research_install_env())
        if result.returncode:
            raise ValueError(f'Unable to install {LAYA_MCP_REQUIREMENT} (pip exit {result.returncode})')
        installed = laya_mcp_version(stage)
        if installed is None or not ((2, 2, 0) <= installed < (3, 0, 0)):
            raise ValueError(f'Installed package does not satisfy {LAYA_MCP_REQUIREMENT}')
        if destination.exists():
            os.replace(destination, backup)
        os.replace(stage, destination)
        if backup.exists():
            shutil.rmtree(backup)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        if destination.exists() and backup.exists():
            remove_item(destination)
        if backup.exists() and not destination.exists():
            os.replace(backup, destination)
        if isinstance(error, ValueError):
            raise
        raise ValueError(f'Unable to install {LAYA_MCP_REQUIREMENT} (I/O failure or timeout)') from None
    finally:
        if stage.exists():
            shutil.rmtree(stage, ignore_errors=True)
        if backup.exists() and destination.exists():
            shutil.rmtree(backup, ignore_errors=True)
    reporter(f'  TOOL installed laya MCP runtime: mcp {installed[0]}.{installed[1]}.{installed[2]}')
    return launch


def node_version(command: str) -> tuple[int, int, int]:
    try:
        result = subprocess.run([command, '--version'], text=True, capture_output=True,
                                timeout=15, env=research_install_env())
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError('Unable to determine Node.js version') from None
    match = re.search(r'(\d+)\.(\d+)\.(\d+)', result.stdout or result.stderr)
    if result.returncode or not match:
        raise ValueError('Unable to determine Node.js version')
    return tuple(int(part) for part in match.groups())


def legacy_codegraph(config: dict, home: Path) -> bool:
    """Match only the known wrong defaults, not custom wrappers or remote MCPs."""
    if 'url' in config:
        return False
    command, args = config.get('command'), config.get('args', [])
    old_managed = str(home/TOOLS_DIR/'node_modules/.bin/codegraph-mcp')
    if command in ('codegraph-mcp', old_managed) and args == []:
        return True
    return command == 'npx' and args in (
        ['-y', LEGACY_CODEGRAPH_PACKAGE], ['-y', LEGACY_CODEGRAPH_PACKAGE+'@latest'])


def managed_research_config(config: dict, home: Path, server: str, binary: str) -> bool:
    """Recognize installer-owned launch shapes; preserve custom args and endpoints."""
    if 'url' in config:
        return False
    commands = (binary, str(home/TOOLS_DIR/'node_modules/.bin'/binary),
                str(home/TOOLS_DIR/server/'node_modules/.bin'/binary))
    expected = ['serve', '--mcp'] if server == 'codegraph' else []
    return config.get('command') in commands and config.get('args', []) == expected


def research_executable(path: Path, package: str, *, managed: bool = False) -> bool:
    if not path.is_file() or not os.access(path, os.X_OK):
        return False
    # npm binaries are symlinks. Where package metadata exists, check its identity
    # rather than accidentally treating a different CodeGraph package as this one.
    if package == '@colbymchenry/codegraph':
        for parent in list(path.resolve().parents)[:5]:
            manifest = parent/'package.json'
            if manifest.is_file():
                try:
                    return json.loads(manifest.read_text(encoding='utf-8')).get('name') == package
                except (OSError, ValueError, AttributeError):
                    return False
        return not managed  # standalone PATH launchers need not have npm metadata
    return True


def ensure_research_tools(home: Path, dry_run: bool = False, reporter=lambda _: None, *, check_keys: bool = True) -> dict[str, str]:
    """Check keys, migrate known bad defaults, then install only missing tools."""
    home = Path(os.path.abspath(home.expanduser()))
    config_path = home/'config.toml'
    safe_path(config_path)
    existing = tomllib.loads(config_path.read_text(encoding='utf-8')) if config_path.exists() else {}
    servers = existing.get('mcp_servers', {})
    if not isinstance(servers, dict):
        raise ValueError('mcp_servers must be a table')
    if check_keys:
        check_research_keys(required=not dry_run, reporter=reporter)
    prefix = home/TOOLS_DIR
    safe_path(prefix)
    commands: dict[str, str] = {}
    missing = []
    for server, package, binary, _ in RESEARCH_TOOLS:
        config = servers.get(server)
        if config is not None:
            if not isinstance(config, dict):
                raise ValueError(f'mcp_servers.{server} must be a table')
            if config.get('enabled') is False:
                reporter(f'  TOOL preserve disabled mcp_servers.{server}')
                continue
            old = server == 'codegraph' and legacy_codegraph(config, home)
            if not old and not managed_research_config(config, home, server, binary):
                reporter(f'  TOOL preserve mcp_servers.{server} (custom; not probed)')
                continue
            if old:
                reporter('  TOOL migrate CodeGraph: @astudioplus/codegraph-mcp -> @colbymchenry/codegraph')
        # Each newly installed tool gets its own prefix. Installing CodeGraph must
        # not let npm prune Context7/Tavily from the old shared node_modules tree.
        destination = prefix/server
        for directory in (destination, destination/'node_modules', destination/'node_modules/.bin'):
            safe_path(directory)
        candidates = [destination/'node_modules/.bin'/binary, prefix/'node_modules/.bin'/binary]
        found = shutil.which(binary)
        for candidate in candidates:
            if research_executable(candidate, package, managed=True):
                found = str(candidate)
                break
        else:
            if found and not research_executable(Path(found), package):
                found = None
        if found:
            commands[server] = found
            reporter(f'  TOOL reuse {server}: {found}')
        else:
            commands[server] = str(candidates[0])
            missing.append((server, package, binary, destination))
            reporter(f'  TOOL install {server}: {package}@latest')
    if not missing or dry_run:
        return commands
    npm, node = shutil.which('npm'), shutil.which('node')
    if not npm or not node:
        raise ValueError('Node.js and npm are required to install CodeGraph, Context7 and Tavily')
    if node_version(node) < MIN_NODE:
        required = '.'.join(map(str, MIN_NODE))
        raise ValueError(f'Node.js {required}+ is required for research tools')
    for server, package, binary, destination in missing:
        existed = destination.exists()
        destination.mkdir(parents=True, exist_ok=True)
        try:
            result = subprocess.run(
                [npm, 'install', '--prefix', str(destination), '--no-save', '--no-package-lock',
                 '--no-audit', '--no-fund', '--engine-strict', package+'@latest'],
                text=True, capture_output=True, timeout=180, env=research_install_env())
            if result.returncode:
                # Do not echo npm output: private registry configuration may contain credentials.
                raise ValueError(f'Unable to install {package}@latest (npm exit {result.returncode})')
            executable = destination/'node_modules/.bin'/binary
            if not research_executable(executable, package, managed=True):
                raise ValueError(f'Installed package has no valid {binary} executable: {package}')
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            if not existed:
                shutil.rmtree(destination, ignore_errors=True)
            if isinstance(error, ValueError):
                raise
            raise ValueError(f'Unable to install {package}@latest (I/O failure or timeout)') from None
        reporter(f'  TOOL installed {server} (package present; runtime not authenticated)')
    return commands


@contextmanager
def install_lock(home: Path):
    key = hashlib.sha256(str(home).encode()).hexdigest()
    path = Path(tempfile.gettempdir())/f'sdd-install-{os.getuid()}-{key}.lock'
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield


def clean_laya_environment(value: dict) -> dict:
    """Remove retired forwarding only from installer-owned Laya configuration."""
    result = dict(value)
    if 'env_vars' in result:
        forwarded = result['env_vars']
        if not isinstance(forwarded, list):
            raise ValueError('mcp_servers.laya.env_vars must be a list')
        result['env_vars'] = [v for v in forwarded if
                              (v.get('name') if isinstance(v, dict) else v) not in RETIRED_LAYA_ENV]
    if 'env' in result:
        if not isinstance(result['env'], dict):
            raise ValueError('mcp_servers.laya.env must be a table')
        result['env'] = {k: v for k, v in result['env'].items() if k not in RETIRED_LAYA_ENV}
    return result


def merged_config(source: Path, target: Path, tool_commands: dict[str, str] | None = None,
                  laya_config: dict | None = None, *, with_laya: bool = False) -> str:
    target_exists = target.exists()
    original = (target if target_exists else source/'config.toml').read_text(encoding='utf-8')
    existing = tomllib.loads(original)
    servers = existing.get('mcp_servers', {})
    laya = servers.get('laya') if isinstance(servers, dict) else None
    if isinstance(laya, dict) and managed_laya_config(laya, target.parent):
        cleaned = clean_laya_environment(laya)
        if cleaned != laya:
            original = set_value(original, ('mcp_servers', 'laya'), cleaned)
    previous = migration.read_manifest(target.parent)
    _, retired_roles, _ = migration.retirement(target.parent, existing, previous, SKILLS, ROLES)
    return merge_config(source, original, retired_roles, tool_commands, laya_config=laya_config,
                        preserve_existing_mcp=target_exists, with_laya=with_laya)


def merge_config(source: Path, text: str, retired_roles=(), tool_commands: dict[str, str] | None = None,
                 laya_config: dict | None = None, *, preserve_existing_mcp: bool = True, with_laya: bool = False) -> str:
    existing = tomllib.loads(text)
    baseline = tomllib.loads((source/'config.toml').read_text(encoding='utf-8'))
    for role in retired_roles:
        text = set_value(text, ('agents', role), DELETE)
    agents = existing.get('agents', {}) if isinstance(existing.get('agents', {}), dict) else {}
    features = existing.get('features', {}) if isinstance(existing.get('features', {}), dict) else {}
    existing_v2 = features.get('multi_agent_v2')
    budget = existing_v2.get('max_concurrent_threads_per_session') if isinstance(existing_v2, dict) else None
    if type(budget) is not int or budget < 1:
        budget = agents.get('max_concurrent_threads_per_session', agents.get('max_threads'))
    if type(budget) is not int or budget < 1:
        budget = baseline['features']['multi_agent_v2']['max_concurrent_threads_per_session']
    for key in ('max_depth', 'max_threads', 'max_concurrent_threads_per_session'):
        text = set_value(text, ('agents', key), DELETE)
    v2 = dict(baseline['features']['multi_agent_v2'])
    v2['max_concurrent_threads_per_session'] = budget
    updates = {
        ('model',): baseline['model'],
        ('model_reasoning_effort',): baseline['model_reasoning_effort'],
        ('features', 'multi_agent'): True,
        ('features', 'multi_agent_v2'): v2,
        ('agents', 'enabled'): True,
        ('agents', 'default_subagent_model'): baseline['agents']['default_subagent_model'],
        ('agents', 'default_subagent_reasoning_effort'): baseline['agents']['default_subagent_reasoning_effort'],
    }
    if 'web_search' not in existing:
        updates[('web_search',)] = baseline['web_search']
    for path, value in updates.items():
        text = set_value(text, path, value)
    existing_servers = existing.get('mcp_servers', {}) if isinstance(existing.get('mcp_servers', {}), dict) else {}
    for server, _, _, env_vars in RESEARCH_TOOLS:
        previous_server = existing_servers.get(server) if preserve_existing_mcp else None
        if previous_server is not None and not isinstance(previous_server, dict):
            raise ValueError(f'mcp_servers.{server} must be a table')
        value = dict(previous_server if previous_server is not None else baseline['mcp_servers'][server])
        if tool_commands and server in tool_commands:
            value['command'] = tool_commands[server]
            if server == 'codegraph':
                value['args'] = ['serve', '--mcp']
            else:
                value.pop('args', None)
        # Old npx Context7 entries also need explicit forwarding. Never serialize
        # os.environ values, replace HTTP auth, or discard existing env_vars.
        if env_vars and 'url' not in value and 'command' in value:
            forwarded = value.get('env_vars', [])
            if not isinstance(forwarded, list):
                raise ValueError(f'mcp_servers.{server}.env_vars must be a list')
            forwarded = list(forwarded)
            for name in env_vars:
                if not any(item == name or (isinstance(item, dict) and item.get('name') == name)
                           for item in forwarded):
                    forwarded.append(name)
            value['env_vars'] = forwarded
        if previous_server != value:
            text = set_value(text, ('mcp_servers', server), value)
    previous_laya = existing_servers.get('laya') if preserve_existing_mcp else None
    if previous_laya is not None and not isinstance(previous_laya, dict):
        raise ValueError('mcp_servers.laya must be a table')
    if not with_laya:
        # Disable the named endpoint without deleting custom command, auth or options.
        if previous_laya is None:
            text = set_value(text, ('mcp_servers', 'laya'), DELETE)
        else:
            text = set_value(text, ('mcp_servers', 'laya', 'enabled'), False)
    else:
        value = dict(previous_laya if previous_laya is not None else baseline['mcp_servers']['laya'])
        if laya_config is not None:
            forwarding = value.get('env_vars', [])
            if not isinstance(forwarding, list):
                raise ValueError('mcp_servers.laya.env_vars must be a list')
            value.update(laya_config)
            value['env_vars'] = list(forwarding)
            for name in laya_config['env_vars']:
                if not any(v == name or (isinstance(v, dict) and v.get('name') == name) for v in forwarding):
                    value['env_vars'].append(name)
        if previous_laya != value:
            text = set_value(text, ('mcp_servers', 'laya'), value)
    for role in ROLES:
        data = tomllib.loads((source/'agents'/f'{role}.toml').read_text(encoding='utf-8'))
        text = set_value(text, ('agents', role), {'description': data['description'], 'config_file': f'agents/{role}.toml'})
    return text


def managed_agents(source: str, existing: str) -> str:
    return migration.clean_agents(existing, source, migration.catalog(SOURCE))[0]


def relocate_links(source: Path, source_path: Path, text: str) -> str:
    def layout(relative: Path) -> Path:
        return Path('skills')/relative if relative.parts and relative.parts[0] in active_skills() else relative
    current = layout(source_path.relative_to(source))
    def replace(match):
        target = match[1]
        if '://' in target or target.startswith(('#', 'mailto:')):
            return match[0]
        path, sep, fragment = target.partition('#')
        resolved = (source_path.parent/path).resolve()
        if not path or Path(path).is_absolute() or not resolved.is_relative_to(source):
            return match[0]
        return ']('+os.path.relpath(layout(resolved.relative_to(source)), current.parent)+(sep+fragment if sep else '')+')'
    return re.sub(r'\]\(([^)]+)\)', replace, text)


def copy_item(source: Path, src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        markdown = list(src.rglob('*.md'))
    else:
        shutil.copy2(src, dst)
        markdown = [src] if src.suffix == '.md' else []
    for path in markdown:
        destination = dst/path.relative_to(src) if src.is_dir() else dst
        destination.write_text(relocate_links(source, path, path.read_text(encoding='utf-8')), encoding='utf-8')


def package_paths(include_project_docs: bool = False, with_laya: bool = False) -> list[Path]:
    roots = ['README.md', 'index.md', 'AGENTS.md', 'config.toml', *LAYA_FILES, migration.MANIFEST]
    if include_project_docs:
        roots.insert(2, 'docs')
    return [Path(name) for name in roots] + [Path('skills')/name for name in active_skills(with_laya)] + [
        Path('agents/index.md'), Path('agents/dispatch-contract.md'),
        *[Path('agents')/f'{role}.toml' for role in ROLES]]


def runtime_index(include_project_docs: bool = False, with_laya: bool = False) -> str:
    text = '# 运行导航\n\n[使用指南](skills/sdd-init/references/runtime-guide.md) · [角色](agents/index.md)\n\n## 核心技能\n\n'
    text += ''.join(f'- [{name}](skills/{name}/SKILL.md)\n' for name in CORE_SKILLS)
    text += '\n## 写作兼容入口\n\n'
    text += ''.join(f'- [{name}](skills/{name}/SKILL.md)\n' for name in COMPAT_SKILLS)
    if with_laya:
        text += '\n[可复用语义判断](skills/typesafe-laya/SKILL.md)\n'
    if include_project_docs:
        text += '\n[配置包项目资料](docs/index.md)\n'
    return text


def runtime_readme(include_project_docs: bool = False) -> str:
    text = ('# Open Spec Mesh\n\n**Spec-Driven Multi-Agent Development**\n\n'
            'Quick 由 Main 直接完成；需要 Worker 分工时进入 SDD，由 Architect 先规划，再按 sdd-change → sdd-do → sdd-close 执行。\n\n'
            '[运行指南](skills/sdd-init/references/runtime-guide.md) · [技能导航](index.md) · [工作约定](AGENTS.md)\n\n'
            '这是 Codex 运行目录，不是业务项目。技能、角色与必要参考随安装更新；项目历史默认留在源码仓库。\n')
    if include_project_docs:
        text += '\n已选择安装 [配置包项目资料](docs/index.md)。\n'
    return text


def build_stage(source: Path, home: Path, stage: Path, tool_commands: dict[str, str] | None = None,
                laya_config: dict | None = None, *, include_project_docs: bool = False, with_laya: bool = False) -> None:
    for relative in package_paths(include_project_docs, with_laya):
        dst = stage/relative
        if relative == Path(migration.MANIFEST):
            text = migration.manifest_text(active_skills(with_laya), ROLES)
        elif relative == Path('README.md'):
            text = runtime_readme(include_project_docs)
        elif relative == Path('index.md'):
            text = runtime_index(include_project_docs, with_laya)
        elif relative == Path('config.toml'):
            text = merged_config(source, home/relative, tool_commands, laya_config, with_laya=with_laya)
        elif relative == Path('AGENTS.md'):
            target = home/relative
            text = migration.clean_agents(target.read_text(encoding='utf-8') if target.exists() else '',
                                          (source/relative).read_text(encoding='utf-8') + (laya_policy() if with_laya else ''), migration.catalog(source))[0]
        elif relative == Path('mcp/laya-settings.json'):
            text = json.dumps({'enabled': with_laya}) + '\n'
        else:
            src = source/(relative.relative_to('skills') if relative.parts[0] == 'skills' else relative)
            copy_item(source, src, dst)
            if with_laya and relative.parts[0] == 'agents' and relative.suffix == '.toml':
                prompt = tomllib.loads(dst.read_text())['developer_instructions']
                dst.write_text(set_value(dst.read_text(), ('developer_instructions',), prompt + laya_policy()))
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(text, encoding='utf-8')
        target = home/relative
        os.chmod(dst, (target.stat().st_mode & 0o777) if target.exists() else
                 (0o600 if relative.name == 'config.toml' else 0o644))


def preflight(source: Path, home: Path, validate: bool = True, *,
              include_project_docs: bool = False, with_laya: bool = False) -> None:
    safe_path(home)
    if home == source or home.is_relative_to(source) or source.is_relative_to(home):
        raise ValueError('Source and Codex Home must be disjoint directories')
    if home.exists() and not home.is_dir():
        raise ValueError('Codex Home must be a directory')
    for directory in (home/'skills', home/'agents'):
        safe_path(directory)
        if directory.exists() and not directory.is_dir():
            raise ValueError(f'Expected directory: {directory}')
    for path in package_paths(include_project_docs, with_laya) + [Path('skills')/name for name in LEGACY_SKILLS]:
        safe_path(home/path)
    required = ['config.toml', 'AGENTS.md', 'README.md', 'index.md', 'agents', 'docs',
                'scripts/install-legacy.json', *active_skills(with_laya)]
    if with_laya:
        required += [*LAYA_FILES]
    for path in required:
        if not (source/path).exists():
            raise ValueError(f'Missing source: {path}')
        safe_tree(source/path)
    if validate:
        for args in [('agents/validate_agents.py',), ('sdd-init/scripts/validate_docs.py', '--root', str(source))]:
            result = subprocess.run([sys.executable, *args], cwd=source, text=True, capture_output=True)
            if result.returncode:
                raise ValueError(result.stderr.strip() or result.stdout.strip())


def remove_item(path: Path) -> None:
    safe_path(path)
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def install(source: Path, home: Path, dry_run: bool = False, *, validate: bool = True,
            install_tools: bool = False, include_project_docs: bool = False, reporter=lambda _: None,
            with_laya: bool = False) -> list[str]:
    source = source.resolve()
    home = Path(os.path.abspath(home.expanduser()))
    paths = package_paths(include_project_docs, with_laya)
    warnings: list[str] = []
    with install_lock(home):
        preflight(source, home, validate, include_project_docs=include_project_docs, with_laya=with_laya)
        laya_managed = with_laya and laya_server_managed(home, reporter)
        # Never replace an unrelated skill installed under the new name.
        skill = home/'skills'/LAYA_SKILL
        previous_manifest = migration.read_manifest(home)
        if laya_managed and skill.exists() and LAYA_SKILL not in previous_manifest['skills']:
            raise ValueError('Unmanaged skills/typesafe-laya exists; preserve it and choose another installation target')
        effective_laya = bool(laya_managed)
        paths = package_paths(include_project_docs, effective_laya)
        if not with_laya:
            reporter('  LAYA/System One disabled: no endpoint checks or Python dependency installation')
        if install_tools:
            check_research_keys(required=not dry_run, reporter=reporter)
            if laya_managed:
                check_laya_env(required=not dry_run, reporter=reporter)
            tool_commands = ensure_research_tools(home, dry_run, reporter, check_keys=False)
            laya_config = ensure_laya_mcp(home, dry_run, reporter) if laya_managed else None
        else:
            check_research_keys(required=False, reporter=reporter)
            if laya_managed:
                check_laya_env(required=False, reporter=reporter)
            reporter('  WARNING tool installation/migration skipped; rerun ./install.sh to repair managed MCP tools')
            tool_commands = None
            laya_config = laya_mcp_config(home) if laya_managed else None
        reporter('  DOCS '+('include package project docs' if include_project_docs else 'runtime only; existing docs left untouched'))
        previous = migration.read_manifest(home)
        old_config = tomllib.loads((home/'config.toml').read_text()) if (home/'config.toml').exists() else {}
        retired, removed_roles, migration_warnings = migration.retirement(home, old_config, previous, active_skills(effective_laya), ROLES)
        for relative in retired:
            safe_path(home/relative)
        for relative in retired:
            if (home/relative).exists():
                reporter('  DELETE '+relative)
        for role in removed_roles:
            reporter('  UNREGISTER agents.'+role)
        if (home/'AGENTS.md').exists():
            _, marked, unmarked, notes = migration.clean_agents((home/'AGENTS.md').read_text(), (source/'AGENTS.md').read_text(), migration.catalog(source))
            reporter(f'  RULES replace {marked} managed block(s), remove {unmarked} verified unmarked block(s)')
            migration_warnings += notes
        warnings.extend(migration_warnings)
        for note in migration_warnings:
            reporter('  WARNING '+note)
        anchor = home.parent
        while not anchor.exists():
            anchor = anchor.parent
        transaction = Path(tempfile.mkdtemp(prefix='.sdd-install-', dir=anchor))
        stage, rollback = transaction/'stage', transaction/'rollback'
        stage.mkdir(); rollback.mkdir()
        moved: list[tuple[Path, Path]] = []
        installed: list[Path] = []
        created_dirs: list[Path] = []
        retain = False
        def ensure_parent(path: Path):
            missing = []
            while not path.exists():
                missing.append(path); path = path.parent
            for parent in reversed(missing):
                parent.mkdir(); created_dirs.append(parent)
        try:
            build_stage(source, home, stage, tool_commands, laya_config, include_project_docs=include_project_docs, with_laya=effective_laya)
            if with_laya and not effective_laya:
                # Custom MCP preserved, without injecting our policy or taking over its runtime.
                text = merged_config(source, home/'config.toml', tool_commands, None, with_laya=True)
                (stage/'config.toml').write_text(text)
            if dry_run:
                return warnings
            for relative in paths + [Path(name) for name in retired]:
                target = home/relative
                if target.exists():
                    old = rollback/relative
                    old.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(target, old)
                    moved.append((target, old))
            for relative in paths:
                target = home/relative
                ensure_parent(target.parent)
                temp = target.parent/('.'+target.name+'.'+transaction.name)
                try:
                    src = stage/relative
                    if src.is_dir():
                        shutil.copytree(src, temp)
                    else:
                        shutil.copy2(src, temp)
                    os.replace(temp, target)
                    installed.append(target)
                finally:
                    if temp.exists():
                        remove_item(temp)
        except BaseException:
            failures = []
            for target in reversed(installed):
                try:
                    remove_item(target)
                except OSError as exc:
                    failures.append(str(exc))
            for target, old in reversed(moved):
                try:
                    if target.exists():
                        remove_item(target)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(old, target)
                except OSError as exc:
                    failures.append(str(exc))
            for directory in reversed(created_dirs):
                try:
                    directory.rmdir()
                except OSError:
                    pass
            if failures:
                retain = True
                print(f'Rollback incomplete; recovery data retained at {rollback}: '+'; '.join(failures), file=sys.stderr)
            raise
        finally:
            if not retain:
                try:
                    shutil.rmtree(transaction)
                except OSError as exc:
                    warnings.append(f'Temporary cleanup failed: {transaction}: {exc}')
    return warnings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codex-home', default=os.environ.get('CODEX_HOME', str(Path.home()/'.codex')))
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--skip-tools', action='store_true', help='skip tool installation/migration; still report missing API key variables')
    parser.add_argument('--include-project-docs', action='store_true', help='also replace the package-owned reference docs directory')
    toggle = parser.add_mutually_exclusive_group()
    toggle.add_argument('--with-laya', dest='with_laya', action='store_true',
                        help='explicitly enable optional Laya/Jev System One bridge, skill and hints')
    toggle.add_argument('--without-laya', dest='with_laya', action='store_false',
                        help='disable Laya/Jev System One bridge, skill and hints (default)')
    parser.set_defaults(with_laya=False)
    args = parser.parse_args()
    try:
        warnings = install(SOURCE, Path(args.codex_home), args.dry_run, install_tools=not args.skip_tools,
                           include_project_docs=args.include_project_docs, reporter=print, with_laya=args.with_laya)
    except (OSError, ValueError) as exc:
        parser.exit(1, f'install failed: {exc}\n')
    print(('preview: ' if args.dry_run else 'installed: ')+str(Path(args.codex_home).expanduser()))
    print('dry-run: no target files changed' if args.dry_run else 'managed files replaced; no persistent backup; start a new Codex session')
    for warning in warnings:
        print(warning, file=sys.stderr)


if __name__ == '__main__':
    main()
