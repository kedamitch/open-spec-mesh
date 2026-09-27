"""Parse planning/evidence boundaries outside Markdown examples; no LLM dependency."""
import re
from sdd_common import metadata, render_spec

BEGIN = '<!-- SDD:EVIDENCE:BEGIN -->'
END = '<!-- SDD:EVIDENCE:END -->'
CLOSE_FIELDS = {'integrated_revision', 'product', 'technology', 'operations'}


def visible_lines(text):
    """Yield (line index, line) outside fenced/indented code and HTML comments."""
    fence = None
    comment = False
    for index, line in enumerate(text.splitlines(keepends=True)):
        raw = line.rstrip('\r\n')
        match = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', raw)
        if fence:
            if match and match[1][0] == fence[0] and len(match[1]) >= len(fence) and not match[2].strip():
                fence = None
            continue
        if comment:
            if '-->' in raw: comment = False
            continue
        if raw in (BEGIN, END):
            yield index, raw
        elif '<!--' in raw:
            comment = '-->' not in raw.split('<!--', 1)[1]
        elif match:
            fence = match[1]
        elif not raw.startswith(('    ', '\t')):
            yield index, raw
    if fence or comment:
        raise ValueError('Unclosed Markdown code fence or HTML comment')


def split_contract(text):
    """Return stable planning and mutable evidence from the canonical explicit marker pair."""
    fields = {}
    if text.startswith('---\n'):
        fields, text = metadata(text)
    lines = text.splitlines(keepends=True)
    visible = list(visible_lines(text))
    begins = [i for i, line in visible if line == BEGIN]
    ends = [i for i, line in visible if line == END]
    if len(begins) != 1 or len(ends) != 1 or begins[0] >= ends[0]:
        raise ValueError('Require exactly one ordered SDD:EVIDENCE marker pair')
    if ''.join(lines[ends[0] + 1:]).strip():
        raise ValueError('Evidence region must be the final region of the document')

    split, stop = begins[0], ends[0]
    evidence = ''.join(lines[split + 1:stop])
    evidence_headings = [
        line for _, line in visible_lines(evidence)
        if re.match(r'^#{1,2}\s', line)
    ]
    if evidence_headings != ['## 验证结果', '## 最终结论']:
        raise ValueError('Evidence must contain only ## 验证结果 and ## 最终结论')

    stable = ''.join(lines[:split]).rstrip() + '\n'
    immutable = {key: fields[key] for key in sorted(fields) if key not in CLOSE_FIELDS}
    if immutable:
        stable = render_spec(immutable, stable)
    return stable, evidence
