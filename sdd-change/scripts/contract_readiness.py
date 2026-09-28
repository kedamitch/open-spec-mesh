"""Planning gates for the single canonical human-readable SDD document format."""
import re
from markdown_contract import split_contract, visible_lines
from sdd_common import metadata

AC = re.compile(r'(?<![A-Za-z0-9_-])AC-[0-9]+(?![A-Za-z0-9_-])')
DESIGN = re.compile(r'(?<![A-Za-z0-9_-])(D[0-9]+)(?![A-Za-z0-9_-])')
MARKER = re.compile(r'^(?:pending|tbd|todo|待补充|待交付|待核实)[。.!！?？:：;；\s]*$', re.I)
PREFIX = re.compile(r'^(?:todo|tbd|待补充|待交付|待核实)\s*[:：。]\s*.+$', re.I)
LIST = re.compile(r'^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)')
DECORATED = r'(?:\*\*|`)?(AC-[0-9]+)(?:\*\*|`)?'
DEFINITION = re.compile(r'^' + DECORATED + r'\s*[:：]\s*(.*)$')
DESIGN_DEFINITION = re.compile(r'^(D[0-9]+)\s*[:：]\s*(.*)$')
NONE = {'none', '无', '无。', '无依赖', '无直接依赖', '无专属决策', '仅公共设计', 'shared-only', '-'}


def _scalar(value):
    return value.strip().strip('*_').strip()


def _identifier(value):
    return value.strip().strip('`').strip('*_').strip()


def _is_none(value):
    return _identifier(value).lower() in NONE


def planning_lines(text, label):
    """Strip metadata and examples; report planning-body locations rather than treating examples as requirements."""
    if text.startswith('---\n'):
        _, text = metadata(text)
    list(visible_lines(text))
    text = re.sub(r'<!--.*?-->', lambda m: '\n' * m[0].count('\n'), text, flags=re.S)
    lines = list(visible_lines(text))
    headers = set()
    for pos, (number, line) in enumerate(lines):
        if line.strip().startswith('|') and all(
                re.fullmatch(r':?-+:?', c.strip()) for c in line.strip().strip('|').split('|')):
            headers.add(number)
            if pos:
                headers.add(lines[pos - 1][0])
    result = []
    for number, line in lines:
        value = LIST.sub('', line.strip())
        value = re.sub(r'^(?:>\s*)+', '', value).strip()
        if number in headers or re.match(r'^#{1,6}\s', value) or not value:
            continue
        cells = value.strip('|').split('|') if value.startswith('|') else [value]
        for cell in cells:
            scalar = _scalar(cell)
            tail = re.split(r'[:：]', scalar, maxsplit=1)[-1].strip()
            if (MARKER.fullmatch(scalar) or PREFIX.fullmatch(scalar)
                    or (tail != scalar and (MARKER.fullmatch(_scalar(tail)) or PREFIX.fullmatch(_scalar(tail))))):
                raise ValueError(f'{label} (planning line {number + 1}): unfinished planning field: {cell.strip()}')
        if re.search(r'[^\W_]', value, flags=re.UNICODE):
            result.append((number, value))
    if not result:
        raise ValueError(f'{label}: real planning content is required, not headings/comments/examples')
    return result



def _ac_definitions(text, label):
    stable, _ = split_contract(text)
    behavior = _section(stable, '行为与验收标准', label)
    matches = list(re.finditer(
        r'^###\s+(AC-[0-9]+)(?:\s*[｜|:：-]\s*(.*))?\s*$',
        behavior, re.M))
    if not matches:
        raise ValueError(f'{label}: 行为与验收标准 must define at least one AC-xx subsection')

    definitions = {}
    for index, match in enumerate(matches):
        identifier = match[1]
        if int(identifier[3:]) == 0 or identifier in definitions:
            raise ValueError(f'{label}: zero or duplicate AC definition: {identifier}')
        end = matches[index + 1].start() if index + 1 < len(matches) else len(behavior)
        body = behavior[match.end():end].strip()
        planning_lines(body, f'{label} / {identifier}')
        definitions[identifier] = match[0].strip() + '\n' + body
    return stable, definitions
def validate_change(text, label):
    stable, definitions = _ac_definitions(text, label)
    planning_lines(stable, label)
    if not definitions:
        raise ValueError(f'{label}: define at least one AC-xx subsection')
    return set(definitions)


def validate_task(text, definitions, label):
    references = {identifier for _, line in planning_lines(text, label) for identifier in AC.findall(line)}
    if not references:
        raise ValueError(f'{label}: reference at least one Change AC-xx')
    unknown = references - definitions
    if unknown:
        raise ValueError(f'{label}: unknown Change AC references: {", ".join(sorted(unknown))}')


def _section(text, heading, label):
    match = re.search(r'^##\s+' + re.escape(heading) + r'\s*$\n(.*?)(?=^##\s|\Z)', text, re.M | re.S)
    if not match:
        raise ValueError(f'{label}: missing section: {heading}')
    return match.group(1)


def _section_or_none(text, heading):
    match = re.search(r'^##\s+' + re.escape(heading) + r'\s*$\n(.*?)(?=^##\s|\Z)', text, re.M | re.S)
    return match.group(1) if match else None


def _section_any(text, headings, label):
    for heading in headings:
        section = _section_or_none(text, heading)
        if section is not None:
            return heading, section
    raise ValueError(f'{label}: missing section: {headings[0]}')


def _mentions(identifier, lines):
    pattern = re.compile(r'(?<![A-Za-z0-9_-])' + re.escape(identifier) + r'(?![A-Za-z0-9_-])')
    return any(pattern.search(line) for line in lines)


TASK_ID = re.compile(r'[A-Za-z][A-Za-z0-9_-]*')


def _reference_tokens(value):
    normalized = value.replace('`', '').replace('，', ',').replace('、', ',')
    return [token.strip() for token in normalized.split(',') if token.strip()]


def _parse_reference_list(value, pattern, label, *, allow_none=True):
    if allow_none and _is_none(value):
        return set()
    tokens = _reference_tokens(value)
    if not tokens:
        raise ValueError(f'{label}: reference list is empty')
    if len(tokens) != len(set(tokens)):
        raise ValueError(f'{label}: duplicate references are not allowed')
    invalid = [token for token in tokens if not pattern.fullmatch(token)]
    if invalid:
        raise ValueError(f'{label}: invalid references: {", ".join(sorted(invalid))}')
    return set(tokens)


CODE_REF = re.compile(r'`([^`]+)`')


def _parse_labeled_refs(value, pattern, label, *, allow_none=True):
    """Parse backticked IDs while allowing human labels around them."""
    if allow_none and _is_none(value):
        return set()
    refs = CODE_REF.findall(value)
    if not refs:
        raise ValueError(f'{label}: use backticked IDs or 无')
    if len(refs) != len(set(refs)):
        raise ValueError(f'{label}: duplicate references are not allowed')
    invalid = [ref for ref in refs if not pattern.fullmatch(ref)]
    if invalid:
        raise ValueError(f'{label}: invalid references: {", ".join(sorted(invalid))}')
    return set(refs)


def _subsection_or_none(text, heading):
    match = re.search(
        r'^###\s+' + re.escape(heading) + r'\s*$\n(.*?)(?=^###\s|\Z)',
        text, re.M | re.S)
    return match.group(1) if match else None


def _human_ref_section(text, heading, pattern, label, *, allow_none=True):
    section = _subsection_or_none(text, heading)
    if section is None:
        return None
    lines = [LIST.sub('', line.strip()) for _, line in visible_lines(section) if line.strip()]
    plain = ' '.join(lines).strip()
    refs = CODE_REF.findall(plain)
    if refs:
        if len(refs) != len(set(refs)):
            raise ValueError(f'{label}: duplicate references are not allowed')
        invalid = [ref for ref in refs if not pattern.fullmatch(ref)]
        if invalid:
            raise ValueError(f'{label}: invalid references: {", ".join(sorted(invalid))}')
        return set(refs)
    if allow_none and (plain.startswith('无') or '无专属决策' in plain):
        return set()
    raise ValueError(f'{label}: use backticked IDs or a clear 无 statement')


def _table_header(section):
    for _, line in visible_lines(section):
        value = line.strip()
        if value.startswith('|'):
            return [cell.strip() for cell in value.strip('|').split('|')]
    return None


def _field_values(section, key, label):
    found = []
    pattern = re.compile(r'^' + re.escape(key) + r'\s*[:：]\s*(.+)$', re.I)
    for _, line in planning_lines(section, label):
        match = pattern.fullmatch(line)
        if match:
            found.append(match[1].strip())
    return found


def _field(section, key, label):
    found = _field_values(section, key, label)
    if len(found) != 1:
        raise ValueError(f'{label}: require exactly one {key}: field')
    return found[0]


def _design_decisions(design_text, label):
    section = _section(design_text, '关键决策', label)
    matches = list(re.finditer(
        r'^###\s+(D[0-9]+)(?:\s*[｜|:：-]\s*(.*))?\s*$',
        section, re.M))
    if not matches:
        if any(_is_none(line) for _, line in planning_lines(section, label + ' / 关键决策')):
            return {}
        raise ValueError(f'{label}: 关键决策 must use Dxxx subsections or explicitly state 无')

    decisions = {}
    for index, match in enumerate(matches):
        identifier = match[1]
        if identifier in decisions:
            raise ValueError(f'{label}: duplicate Design decision: {identifier}')
        end = matches[index + 1].start() if index + 1 < len(matches) else len(section)
        body = section[match.end():end].strip()
        planning_lines(body, f'{label} / {identifier}')
        decisions[identifier] = match[0].strip() + '\n' + body
    return decisions

def design_task_mapping(design_text, tasks, label, definitions=None):
    """Return exact references from the canonical human-readable Task table."""
    section = _section(design_text, 'Task 关系与设计落点', label)
    lines = [line for _, line in planning_lines(section, label + ' / Task 关系与设计落点')]
    task_ids = [item['id'] if isinstance(item, dict) else item for item in tasks]

    shared = _section(design_text, '公共设计与不变量', label)
    planning_lines(shared, label + ' / 公共设计与不变量')
    header = _table_header(section)
    if header != ['Task', '交付结果', '前置任务', '关联设计', '验收']:
        raise ValueError(
            f'{label}: Task table must be exactly Task / 交付结果 / 前置任务 / 关联设计 / 验收')

    decisions = _design_decisions(design_text, label)
    rows = {}
    for line in lines:
        if not line.startswith('|'):
            continue
        cells = [cell.strip() for cell in line.strip('|').split('|')]
        if len(cells) != 5:
            raise ValueError(f'{label}: Task relationship rows require five columns')
        task_refs = _parse_labeled_refs(cells[0], TASK_ID, f'{label}: Task')
        if len(task_refs) != 1:
            raise ValueError(f'{label}: each Task row must identify exactly one Task ID')
        task_id = next(iter(task_refs))
        if task_id not in task_ids:
            raise ValueError(f'{label}: Task mapping contains unknown Task ID: {task_id}')
        if task_id in rows:
            raise ValueError(f'{label}: duplicate Task relationship row: {task_id}')

        dep_refs = _parse_labeled_refs(cells[2], TASK_ID, f'{label}: {task_id} 前置任务')
        design_refs = _parse_labeled_refs(
            cells[3], re.compile(r'D[0-9]+'), f'{label}: {task_id} 关联设计')
        ac_refs = _parse_labeled_refs(
            cells[4], re.compile(r'AC-[0-9]+'), f'{label}: {task_id} 验收',
            allow_none=False)

        unknown_deps = dep_refs - set(task_ids)
        if unknown_deps:
            raise ValueError(
                f"{label}: {task_id} references unknown dependencies: "
                + ', '.join(sorted(unknown_deps)))
        unknown_design = design_refs - set(decisions)
        if unknown_design:
            raise ValueError(
                f"{label}: {task_id} references unknown Design decisions: "
                + ', '.join(sorted(unknown_design)))
        if definitions is not None:
            unknown_ac = ac_refs - set(definitions)
            if unknown_ac:
                raise ValueError(
                    f"{label}: {task_id} references unknown Change ACs: "
                    + ', '.join(sorted(unknown_ac)))

        rows[task_id] = {
            'line': line,
            'design': design_refs,
            'deps': dep_refs,
            'acs': ac_refs,
        }

    missing = sorted(set(task_ids) - set(rows))
    if missing:
        raise ValueError(f'{label}: Task mapping must cover all graph Task IDs: {", ".join(missing)}')
    for item in tasks:
        if not isinstance(item, dict):
            continue
        refs = rows[item['id']]
        expected = set(item.get('depends_on', []))
        if refs['deps'] != expected:
            raise ValueError(
                f"{label}: {item['id']} Design depends_on mismatch; "
                f"graph={sorted(expected)} design={sorted(refs['deps'])}")
    return rows
def _require_mermaid(text, label, kinds):
    match = re.search(r'```mermaid\s*\n(.*?)\n```', text, re.S)
    if not match:
        raise ValueError(f'{label}: at least one Mermaid diagram is required')
    body = match.group(1)
    if not any(re.search(r'^\s*' + re.escape(kind) + r'\b', body, re.M) for kind in kinds):
        raise ValueError(
            f'{label}: Mermaid must contain one of: ' + ', '.join(kinds))


def validate_full_design_structure(design_text, label):
    """New public Design must be a complete delta from Current Truth."""
    if not design_text.lstrip().startswith('# 公共设计'):
        return
    required = (
        'Current 基线与变更范围',
        '总体方案与主流程',
        '产品变更',
        '接口变更',
        '领域模型与状态变更',
        '数据与表结构变更',
        '应用与组件变更',
        '关键决策',
        '公共设计与不变量',
        'Task 关系与设计落点',
        '实现自由度与停止条件',
        '风险与未决问题',
    )
    for heading in required:
        section = _section(design_text, heading, label)
        planning_lines(section, label + ' / ' + heading)
    _require_mermaid(
        _section(design_text, '总体方案与主流程', label),
        label + ' / 总体方案与主流程',
        ('sequenceDiagram', 'flowchart'))


def validate_full_task_design(text, label):
    """New Task Contract must contain an implementable local design."""
    if not re.search(r'^#\s+Task\s+`[^\n]+`：详细设计\s*$', text, re.M):
        return
    required = (
        '范围与代码落点',
        'Task 实现流程',
        '详细设计',
        '依赖与验收',
        '实现自由度',
        '交付要求',
    )
    for heading in required:
        section = _section(text, heading, label)
        if heading != 'Task 实现流程':
            planning_lines(section, label + ' / ' + heading)

    scope = _section(text, '范围与代码落点', label)
    if _subsection_or_none(scope, '代码结构 / 模块落点') is None:
        raise ValueError(f'{label}: missing subsection: 代码结构 / 模块落点')

    detail = _section(text, '详细设计', label)
    for heading in ('核心逻辑', 'Components', '接口变化', '领域模型 / 状态变化',
                    '数据与表结构变化', '失败与兼容', 'Tests'):
        if _subsection_or_none(detail, heading) is None:
            raise ValueError(f'{label}: missing subsection: {heading}')
    delivery = _section(text, '交付要求', label)
    if _subsection_or_none(delivery, 'Expected Output') is None:
        raise ValueError(f'{label}: missing subsection: Expected Output')

    _require_mermaid(
        _section(text, 'Task 实现流程', label),
        label + ' / Task 实现流程',
        ('flowchart', 'sequenceDiagram'))


def validate_design_task_graph(design_text, tasks, label, definitions=None):
    """Design owns shared design and Task relationships; local details stay in each Task."""
    validate_full_design_structure(design_text, label)
    return design_task_mapping(design_text, tasks, label, definitions)


def task_contract_references(text, task, task_ids, definitions, label):
    """Read references from the canonical human-readable Task contract."""
    section = _section(text, '依赖与验收', label)
    deps = _human_ref_section(section, '前置任务', TASK_ID, label + ' / 前置任务')
    design = _human_ref_section(
        section, '关联设计', re.compile(r'D[0-9]+'), label + ' / 关联设计')
    acs = _human_ref_section(
        section, '验收标准', re.compile(r'AC-[0-9]+'),
        label + ' / 验收标准', allow_none=False)
    if deps is None or design is None or acs is None:
        raise ValueError(
            f'{label}: Task Contract requires 前置任务 / 关联设计 / 验收标准 subsections')

    unknown_deps = deps - set(task_ids)
    if unknown_deps:
        raise ValueError(
            f'{label}: unknown Task dependencies: {", ".join(sorted(unknown_deps))}')
    unknown_ac = acs - set(definitions)
    if unknown_ac:
        raise ValueError(
            f'{label}: unknown Change AC references: {", ".join(sorted(unknown_ac))}')

    expected = set(task.get('depends_on', []))
    if deps != expected:
        raise ValueError(
            f"{label}: Task Contract depends_on mismatch; "
            f"graph={sorted(expected)} contract={sorted(deps)}")

    all_lines = [line for _, line in planning_lines(text, label)]
    all_acs = {identifier for line in all_lines for identifier in AC.findall(line)}
    if all_acs != acs:
        raise ValueError(
            f"{label}: all AC references must be declared in 验收标准; "
            f"declared={sorted(acs)} used={sorted(all_acs)}")
    all_design = {identifier for line in all_lines for identifier in DESIGN.findall(line)}
    if all_design != design:
        raise ValueError(
            f"{label}: all Dxxx references must be declared in 关联设计; "
            f"declared={sorted(design)} used={sorted(all_design)}")
    return {'deps': deps, 'acs': acs, 'design': design}

def validate_design_backed_task(
        text, design_name, task, design_text, definitions, task_ids, label,
        design_mapping=None):
    """Task Contract must match the canonical Design mapping and Graph."""
    task_id = task['id']
    validate_full_task_design(text, label)
    if design_name not in text:
        raise ValueError(f'{label}: SDD Task must reference Design {design_name}')
    if not _mentions(task_id, [text]):
        raise ValueError(f'{label}: SDD Task must identify its Task ID {task_id}')

    planning_lines(_section(text, '详细设计', label), label + ' / 详细设计')
    planning_lines(_section(text, '实现自由度', label), label + ' / 实现自由度')

    section = _section(design_text, 'Task 关系与设计落点', 'Design')
    design_lines = [line for _, line in planning_lines(section, 'Design / Task 关系与设计落点')]
    if not _mentions(task_id, design_lines):
        raise ValueError(f'{label}: Design Task mapping must reference Task ID {task_id}')

    refs = task_contract_references(text, task, task_ids, definitions, label)
    decisions = _design_decisions(design_text, 'Design')
    unknown_design = refs['design'] - set(decisions)
    if unknown_design:
        raise ValueError(
            f'{label}: unknown Design decisions: {", ".join(sorted(unknown_design))}')
    if design_mapping is None:
        raise ValueError(f'{label}: canonical Design Task mapping is required')

    mapped = design_mapping[task_id]
    if refs['deps'] != mapped['deps']:
        raise ValueError(f'{label}: Task Contract dependencies differ from Design Task relationship')
    if refs['acs'] != mapped['acs']:
        raise ValueError(f'{label}: Task Contract AC references differ from Design Task relationship')
    if refs['design'] != mapped['design']:
        raise ValueError(f'{label}: Task Contract Design references differ from Design Task relationship')
    return refs
def _without_section(text, heading):
    pattern = re.compile(
        r'^##\s+' + re.escape(heading) + r'\s*$\n.*?(?=^##\s|\Z)',
        re.M | re.S)
    return pattern.sub('', text).rstrip() + '\n'


def scoped_change_contract(text, ac_refs, label='Change'):
    """Freeze shared Change text plus only AC definitions referenced by this Task."""
    stable, definitions = _ac_definitions(text, label)
    if _section_or_none(stable, '行为与验收标准') is None:
        return stable
    missing = ac_refs - set(definitions)
    if missing:
        raise ValueError(f'{label}: missing scoped AC definitions: {", ".join(sorted(missing))}')
    shared = _without_section(stable, '行为与验收标准')
    selected = '\n'.join(definitions[identifier] for identifier in sorted(ac_refs))
    return shared + '\n---TASK-AC---\n' + selected + '\n'


def scoped_design_contract(design_text, task_id, design_refs, label='Design'):
    """Freeze shared Design plus this Task row and its referenced decisions."""
    if _section_or_none(design_text, 'Task 关系与设计落点') is None:
        return design_text.rstrip() + '\n'
    shared = _section(design_text, '公共设计与不变量', label).rstrip()
    freedom = _section_or_none(design_text, '实现自由度与停止条件')
    decisions = _design_decisions(design_text, label)
    missing = design_refs - set(decisions)
    if missing:
        raise ValueError(f'{label}: missing scoped Design decisions: {", ".join(sorted(missing))}')
    relation = _section(design_text, 'Task 关系与设计落点', label)
    task_row = None
    for _, line in planning_lines(relation, label + ' / Task 关系与设计落点'):
        if line.startswith('|'):
            cells = [cell.strip() for cell in line.strip('|').split('|')]
            if cells:
                human_ids = CODE_REF.findall(cells[0])
                if _identifier(cells[0]) == task_id or task_id in human_ids:
                    task_row = line
                    break
    if task_row is None:
        raise ValueError(f'{label}: missing Task relationship row for {task_id}')
    selected = '\n'.join(decisions[identifier] for identifier in sorted(design_refs))
    return (
        '## 公共设计与不变量\n' + shared
        + '\n\n## 当前 Task 关键决策\n' + (selected or 'none')
        + '\n\n## 当前 Task 关系\n' + task_row
        + ('\n\n## 实现自由度与停止条件\n' + freedom.rstrip() if freedom else '')
        + '\n'
    )
