"""Parse human-readable Task path boundaries and validate actual Git diff paths."""
import re

from markdown_contract import visible_lines

NONE = {"none", "无", "无。", "-"}


def _section(text, level, heading, label):
    hashes = "#" * level
    match = re.search(
        rf"^{re.escape(hashes)}\s+{re.escape(heading)}\s*$\n(.*?)(?=^{re.escape(hashes)}\s|\Z)",
        text,
        re.M | re.S,
    )
    if not match:
        raise ValueError(f"{label}: missing section: {heading}")
    return match.group(1)


def _subsection(text, heading, label):
    match = re.search(
        r"^###\s+" + re.escape(heading) + r"\s*$\n(.*?)(?=^###\s|^##\s|\Z)",
        text,
        re.M | re.S,
    )
    if not match:
        raise ValueError(f"{label}: missing subsection: {heading}")
    return match.group(1)


def _validate_pattern(value, label):
    if not value or value.startswith("/") or value.startswith("./") or "\\" in value:
        raise ValueError(f"{label}: path pattern must be repository-relative")
    if "\x00" in value or any(part in {"", ".", ".."} for part in value.split("/")):
        raise ValueError(f"{label}: invalid path pattern: {value}")
    if re.match(r"^[A-Za-z]:", value):
        raise ValueError(f"{label}: path pattern must not contain a drive prefix")
    return value


def parse_path_contract(text, label):
    """Return (allow, deny) from the Task's Path Contract table."""
    scope = _section(text, 2, "范围与代码落点", label)
    section = _subsection(scope, "Path Contract", label)
    lines = [line.strip() for _, line in visible_lines(section) if line.strip()]
    table = [line for line in lines if line.startswith("|")]
    if len(table) < 3:
        raise ValueError(f"{label}: Path Contract requires a table")
    header = [cell.strip() for cell in table[0].strip("|").split("|")]
    if header != ["规则", "路径"]:
        raise ValueError(f"{label}: Path Contract header must be 规则 / 路径")

    allow, deny = [], []
    for line in table[2:]:
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) != 2:
            raise ValueError(f"{label}: Path Contract rows require two columns")
        rule, raw = cells
        rule = rule.casefold()
        if rule not in {"allow", "deny"}:
            raise ValueError(f"{label}: Path Contract rule must be allow or deny")
        if raw.casefold() in NONE:
            if rule == "allow":
                raise ValueError(f"{label}: allow path cannot be empty")
            continue
        match = re.fullmatch(r"\x60([^\x60]+)\x60", raw)
        if not match:
            raise ValueError(f"{label}: Path Contract paths must be backticked")
        pattern = _validate_pattern(match.group(1), label)
        target = allow if rule == "allow" else deny
        if pattern in target:
            raise ValueError(f"{label}: duplicate Path Contract pattern: {pattern}")
        target.append(pattern)

    if not allow:
        raise ValueError(f"{label}: Path Contract requires at least one allow path")
    return tuple(allow), tuple(deny)


def _glob_regex(pattern):
    parts = pattern.split("/")
    out = ["^"]
    for index, part in enumerate(parts):
        if part == "**":
            if index == len(parts) - 1:
                out.append(".*")
            else:
                out.append("(?:[^/]+/)*")
            continue
        segment = re.escape(part).replace(r"\*", "[^/]*").replace(r"\?", "[^/]")
        out.append(segment)
        if index < len(parts) - 1:
            out.append("/")
    out.append("$")
    return re.compile("".join(out))


def matches(path, pattern):
    return bool(_glob_regex(pattern).fullmatch(path))


def validate_changed_paths(task_text, paths, label):
    """Deny wins. Overlap with another Task is intentionally not checked here."""
    allow, deny = parse_path_contract(task_text, label)
    violations = []
    for path in sorted(paths):
        denied = next((pattern for pattern in deny if matches(path, pattern)), None)
        if denied:
            violations.append(f"{path} denied by {denied}")
            continue
        if not any(matches(path, pattern) for pattern in allow):
            violations.append(f"{path} outside allow paths")
    if violations:
        raise ValueError(f"{label}: changed paths exceed Task boundary: " + "; ".join(violations))
    return paths
