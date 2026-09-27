"""Small filesystem and metadata helpers shared by Lean SDD skills."""
from datetime import date
from pathlib import Path
import re

CHANGE_ID = r"CHG-\d{8}-[^/\\]+"

def today(): return date.today().isoformat()

def root_path(value):
    root = Path(value).resolve()
    if not root.is_dir(): raise ValueError(f"Project directory does not exist: {root}")
    return root

def inside(root, *parts):
    path = root.joinpath(*parts)
    relative = path.relative_to(root)
    if ".." in relative.parts: raise ValueError(f"Path escapes project: {path}")
    cursor = root
    for part in relative.parts:
        cursor /= part
        if cursor.is_symlink(): raise ValueError(f"Symlink is not a writable SDD path: {cursor}")
    return path

def read_text(path):
    if path.is_symlink() or not path.is_file(): raise ValueError(f"Required regular file missing: {path}")
    return path.read_text(encoding="utf-8")

def create_text(path, text):
    with path.open("x", encoding="utf-8") as stream: stream.write(text)

def mapped_document(root, directory, fields, key, required=True):
    name = fields.get(key, "")
    if not name:
        if required: raise ValueError(f"Missing document mapping: {key}")
        return None
    relative = Path(name)
    if relative.is_absolute() or ".." in relative.parts or "\\" in name:
        raise ValueError(f"Invalid document mapping: {key}")
    if key != "graph" and relative.name != name:
        raise ValueError(f"Invalid document mapping: {key}")
    path = inside(root, directory.relative_to(root), *relative.parts)
    read_text(path)
    return path

def active_change(root, change_id):
    if not re.fullmatch(CHANGE_ID, change_id):
        raise ValueError("Use the complete CHG-YYYYMMDD-name identifier.")
    change = inside(root, "docs", "05-changes", "C01-进行中", change_id)
    if not change.is_dir(): raise ValueError(f"Active Change not found: {change_id}")
    fields, body = metadata(read_text(change / "index.md"))
    if fields.get("id") != change_id or fields.get("status") != "active":
        raise ValueError("Spec must identify this Change with status: active.")
    required = {
        "contract": "C01-change.md",
        "design": "C02-design.md",
        "tasks": "C03-tasks",
        "graph": "C03-tasks/C03-task-graph.json",
    }
    for key, expected in required.items():
        if fields.get(key) != expected:
            raise ValueError(f"Change must use canonical mapping {key}: {expected}")
    mapped_document(root, change, fields, "contract")
    mapped_document(root, change, fields, "design")
    task_root = inside(root, change.relative_to(root), fields["tasks"])
    if not task_root.is_dir() or task_root.is_symlink():
        raise ValueError("Canonical Task directory missing: C03-tasks")
    mapped_document(root, change, fields, "graph")
    return change, fields, body

def metadata(text):
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---": raise ValueError("Spec requires scalar frontmatter.")
    fields = {}
    for index, line in enumerate(lines[1:], 1):
        if line.strip() == "---": return fields, "".join(lines[index + 1:])
        key, separator, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if not separator or not key or not value or key in fields:
            raise ValueError("Spec frontmatter contains an invalid or duplicate field.")
        fields[key] = value
    raise ValueError("Spec frontmatter is not closed.")

def render_spec(fields, body):
    return "---\n" + "".join(f"{k}: {v}\n" for k, v in fields.items()) + "---\n" + body
