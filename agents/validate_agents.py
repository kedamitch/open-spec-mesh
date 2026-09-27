#!/usr/bin/env python3
"""Static role/routing checks; live V2 behavior is verified separately."""
from pathlib import Path
import re
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {
    'architect': ('gpt-6-sol', 'xhigh', 'workspace-write'),
    'worker': ('gpt-6-luna', 'max', 'workspace-write'),
    'reviewer': ('gpt-6-luna', 'max', 'read-only'),
    'explorer': ('gpt-6-luna', 'low', 'read-only'),
    'librarian': ('gpt-6-luna', 'low', 'read-only'),
}
LEAVES = {'worker', 'reviewer', 'explorer', 'librarian'}
ROLE_REFERENCES = {'Main', 'Architect', 'Worker', 'Reviewer', 'Explorer', 'Librarian'}


def has_positive_delegation(text, names):
    """Detect explicit delegation/call authority, not harmless role handoff wording."""
    target = '|'.join(re.escape(name) for name in sorted(names, key=len, reverse=True))
    verb = r'(?:委派|调用|spawn|delegate)'
    negative = re.compile(r'(?:不可|不得|不能|禁止|不应)[^。；\n]{0,24}' + verb, re.IGNORECASE)
    direct = re.compile(verb + r'[^。；\n]{0,48}(?:' + target + r')', re.IGNORECASE)
    reverse = re.compile(r'(?:' + target + r')[^。；\n]{0,48}' + verb, re.IGNORECASE)
    listed = re.compile(
        r'(?:可以|允许|只可|可)\s*(?:委派|调用)[^。；\n]{0,16}[:：]?\s*'
        r'\n\s*[-*]?\s*(?:\*\*)?(?:' + target + r')(?:\*\*)?',
        re.IGNORECASE,
    )
    if listed.search(text):
        return True
    for clause in re.split(r'[。；;，,\n]+', text):
        if not clause.strip() or negative.search(clause):
            continue
        if direct.search(clause) or reverse.search(clause):
            return True
    return False


def validate_runtime_config(config):
    errors = []
    if config.get('model') != 'gpt-6-luna' or config.get('model_reasoning_effort') != 'max':
        errors.append('Main must use Luna 6 max')
    features = config.get('features')
    if not isinstance(features, dict) or features.get('multi_agent') is not True:
        return errors + ['Multi-agent feature must be enabled']
    v2 = features.get('multi_agent_v2')
    if not isinstance(v2, dict) or v2.get('enabled') is not True:
        errors.append('Multi-Agent V2 must be enabled')
    else:
        budget = v2.get('max_concurrent_threads_per_session')
        if type(budget) is not int or budget < 1:
            errors.append('V2 concurrency budget must be a positive integer')
        if v2.get('tool_namespace') != 'agents':
            errors.append('V2 tool namespace must be agents')
        if v2.get('hide_spawn_agent_metadata') is not False:
            errors.append('V2 agent role metadata must be visible')
        if v2.get('expose_spawn_agent_model_overrides') is not False:
            errors.append('Spawn-time model overrides must stay disabled')
        if v2.get('wait_agent_enabled') is not True:
            errors.append('V2 wait_agent must be enabled')
    agents = config.get('agents')
    if not isinstance(agents, dict) or agents.get('enabled') is not True:
        return errors + ['Missing/enabled agents table']
    for legacy in ('max_depth', 'max_threads', 'max_concurrent_threads_per_session'):
        if legacy in agents:
            errors.append(f'Legacy V1 setting must be removed: agents.{legacy}')
    if agents.get('default_subagent_model') != 'gpt-6-luna' or agents.get('default_subagent_reasoning_effort') != 'max':
        errors.append('Default child must use Luna 6 max')
    for role in EXPECTED:
        entry = agents.get(role)
        if not isinstance(entry, dict):
            errors.append(f'{role}: missing role table')
        elif entry.get('config_file') != f'agents/{role}.toml':
            errors.append(f'{role}: invalid config file')
    return errors


def validate_dispatch(root):
    errors = []
    try:
        text = (root/'agents/dispatch-contract.md').read_text(encoding='utf-8')
        for token in ('mode', 'goal', 'scope', 'known_facts', 'unknowns', 'constraints', 'expected_output'):
            if f'`{token}`' not in text:
                errors.append(f'dispatch: missing {token}')
        for phrase in ('不维护全局 Routing Graph', '自己角色说明允许的 delegate',
                       '不要向子 Agent 注入', '全局角色拓扑',
                       '固定 Role Prompt', '当前 Dispatch Packet'):
            if phrase not in text:
                errors.append('dispatch: local delegation contract missing')
        for forbidden in ('## 2. SDD 状态与确定性路由', '## 3. 语义路由', '## 4. 权限',
                          'Quick：Main 可委派', 'Architect 只可继续委派',
                          'Reviewer：仅 SDD'):
            if forbidden in text:
                errors.append('dispatch: global routing topology leaked into common contract')
    except OSError as exc:
        errors.append(str(exc))
    return errors


def validate_main(root):
    errors = []
    try:
        text = (root/'AGENTS.md').read_text(encoding='utf-8')
        if '## 2. 我的委派' not in text or 'Main 只需要知道自己可以委派的角色' not in text:
            errors.append('main: local delegation section missing')
        for role in ('Architect', 'Worker', 'Reviewer', 'Explorer', 'Librarian'):
            if f'| {role} |' not in text:
                errors.append(f'main: missing own delegate {role}')
        for forbidden in ('Architect 只可继续委派', 'Worker、Reviewer、Explorer、Librarian 不可继续委派'):
            if forbidden in text:
                errors.append('main: foreign delegation topology leaked')
    except OSError as exc:
        errors.append(str(exc))
    return errors


def validate(root=ROOT):
    errors = []
    try:
        config = tomllib.loads((root/'config.toml').read_text(encoding='utf-8'))
        errors.extend(validate_runtime_config(config))
        errors.extend(validate_dispatch(root))
        errors.extend(validate_main(root))
        config_agents = config.get('agents', {})
        for role, (model, effort, sandbox) in EXPECTED.items():
            data = tomllib.loads((root/'agents'/f'{role}.toml').read_text(encoding='utf-8'))
            for key, expected in {'name': role, 'model': model,
                                  'model_reasoning_effort': effort, 'sandbox_mode': sandbox}.items():
                if data.get(key) != expected:
                    errors.append(f'{role}: incorrect {key}')
            description = data.get('description')
            prompt = data.get('developer_instructions')
            if not isinstance(description, str) or not all(x in description for x in ('适用：', '不适用：')):
                errors.append(f'{role}: description needs trigger and negative boundary')
            if not isinstance(prompt, str) or not prompt.strip():
                errors.append(f'{role}: developer_instructions is required')
                continue
            if config_agents.get(role, {}).get('description') != description:
                errors.append(f'{role}: config description must mirror role TOML')
            if '恢复同一任务' not in prompt:
                errors.append(f'{role}: resume semantics required')
            if not all(x in prompt for x in ('status', 'evidence', 'artifacts', 'blockers')):
                errors.append(f'{role}: common output envelope required')
            if role == 'architect':
                if ('只处理 mode=sdd' not in prompt or 'fork_turns="none"' not in prompt
                        or '## 我的委派' not in prompt
                        or 'Explorer' not in prompt or 'Librarian' not in prompt
                        or 'Task Graph' not in prompt or 'Task Contract' not in prompt
                        or '调用方不应重新拆分' not in prompt
                        or 'Design 深度必须与任务复杂度匹配' not in prompt
                        or '所有 Task Contract 的详细设计' not in prompt
                        or '不得等 Task ready' not in prompt):
                    errors.append('architect: planning ownership and local delegation required')
                if has_positive_delegation(prompt, {'Main', 'Worker', 'Reviewer'}):
                    errors.append('architect: unauthorized delegation authority')
            if role == 'reviewer' and (
                    '仅执行 mode=sdd 且用户明确要求' not in prompt
                    or 'reviewer_requested=true' not in prompt
                    or 'Quick' not in prompt):
                errors.append('reviewer: explicit-user SDD gate required')
            if role == 'worker' and (
                    'mode=quick' not in prompt or 'permission_denied' not in prompt
                    or 'Design-backed Task Contract' not in prompt):
                errors.append('worker: Quick prohibition and frozen contract required')
            if role in {'explorer', 'librarian'} and not all(x in description for x in ('Quick', 'SDD')):
                errors.append(f'{role}: investigation mode coverage required')
            if role in LEAVES:
                if '不可委派任何 Agent' not in prompt:
                    errors.append(f'{role}: leaf no-delegation rule required')
                if has_positive_delegation(prompt, ROLE_REFERENCES):
                    errors.append(f'{role}: unauthorized delegation authority')
            if 'agents' in data or 'features' in data:
                errors.append(f'{role}: role-local multi-agent switches forbidden')
    except (OSError, ValueError) as exc:
        errors.append(str(exc))
    return errors


if __name__ == '__main__':
    errors = validate()
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        raise SystemExit(1)
    print('agents: local delegation contracts and V2 static configuration valid')
