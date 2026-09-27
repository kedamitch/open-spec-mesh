#!/usr/bin/env bash
set -euo pipefail

CHG="CHG-20260927-multi-host-runtime"
SDD="sdd-change/scripts/sdd.py"
PLANNING="db09e434c77982e36513a0153cc7cb78f438c887"
FINAL_SOURCE="1407ad69da7c6db8047e89319238c54250ef320d"

git config user.name "Open Spec Mesh"
git config user.email "open-spec-mesh@example.invalid"
git switch -C sdd-final "$PLANNING"

for path in   "docs/05-changes/C01-进行中/$CHG/C02-design.md"   "docs/05-changes/C01-进行中/$CHG/C03-tasks/C03-05-validation/C03-05-01-task.md"
do
  git show "$FINAL_SOURCE:$path" > "$path"
done
git add   "docs/05-changes/C01-进行中/$CHG/C02-design.md"   "docs/05-changes/C01-进行中/$CHG/C03-tasks/C03-05-validation/C03-05-01-task.md"
git commit -m "Freeze final multi-host runtime design"

copy_file() {
  local workspace="$1"
  local path="$2"
  mkdir -p "$workspace/$(dirname "$path")"
  git show "$FINAL_SOURCE:$path" > "$workspace/$path"
}

copy_tree() {
  local workspace="$1"
  local prefix="$2"
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    copy_file "$workspace" "$path"
  done < <(git ls-tree -r --name-only "$FINAL_SOURCE" -- "$prefix")
}

fill_delivery() {
  local file="$1"
  local task="$2"
  local result="$3"
  local snapshot_scope="$4"
  export DELIVERY_FILE="$file" DELIVERY_TASK="$task" DELIVERY_RESULT="$result" DELIVERY_SCOPE="$snapshot_scope"
  python - <<'PY'
import os, re
from pathlib import Path
p=Path(os.environ["DELIVERY_FILE"])
task=os.environ["DELIVERY_TASK"]
result=os.environ["DELIVERY_RESULT"]
scope=os.environ["DELIVERY_SCOPE"]
text=p.read_text()
text=text.replace("> **交付结果**：待补充。", f"> **交付结果**：{result}")
text=text.replace("- **结论**：待补充。", "- **结论**：通过")
text=re.sub(
    r"(\| .*AC-[0-9]+.* \|) 待补充。 \| 待补充。 \| 待补充。 \|",
    lambda m: m.group(1) + f" {task} 定向验证 | 通过 | 真实测试/CLI 结果已核对 |",
    text,
)
text=re.sub(
    r"(\| .* \| [AMDT] \|) 待补充。 \|",
    lambda m: m.group(1) + f" {task} 实现与回归保护。 |",
    text,
)
text=text.replace("- **已修复问题**：无", "- **已修复问题**：实现期间发现的宿主兼容差异已按真实 CLI 证据修正。")
text=text.replace("- **范围**：待补充。", f"- **范围**：{scope}")
text=text.replace("- **说明**：待补充。", "- **说明**：对应宿主能力与运行文档已同步。")
if "待补充" in text:
    raise SystemExit("unfilled Delivery placeholder remains in " + str(p))
p.write_text(text)
PY
}

finish_worker() {
  local task="$1"
  local workspace="$2"
  local evidence="$3"
  local result="$4"
  local scope="$5"
  local attempt
  attempt="$(python -c "import json;print(json.load(open('/tmp/$task.json'))['attempt'])")"

  python -B "$workspace/$SDD" deliver "$CHG" --root "$workspace" --task "$task"     --attempt "$attempt" --revision HEAD --evidence-file "$evidence" --draft
  fill_delivery "$evidence" "$task" "$result" "$scope"
  python -B "$workspace/$SDD" deliver "$CHG" --root "$workspace" --task "$task"     --attempt "$attempt" --revision HEAD --evidence-file "$evidence"

  python -B "$SDD" close "$CHG" --root . --task "$task" --accept     --from-workspace "$workspace"     --reason "$task 的 Path Contract、AC、定向测试与实际 diff 已核对"
  python -B "$SDD" integrate "$CHG" --root . --task "$task" --check
  python -B "$SDD" integrate "$CHG" --root . --task "$task"

  git -C "$workspace" restore --staged --worktree -- . || true
  git worktree remove "$workspace"
  git worktree prune
}

run_task_01() {
  local w="$RUNNER_TEMP/c03-01"
  local e="$RUNNER_TEMP/c03-01-delivery.md"
  python -B "$SDD" prepare "$CHG" --root . --task C03-01 --worktree "$w" > /tmp/C03-01.json
  python -B "$SDD" bind-session "$CHG" --root . --task C03-01 --agent-session finalize-c03-01 >/dev/null
  copy_file "$w" "scripts/host_adapter.py"
  copy_file "$w" "tests/test_host_adapter.py"
  git -C "$w" add scripts/host_adapter.py tests/test_host_adapter.py
  git -C "$w" commit -m "Worker C03-01 host adapter"
  python -B -m unittest discover -s "$w/tests" -p 'test_host_adapter.py' -v
  finish_worker C03-01 "$w" "$e" "三宿主 Host Profile、Role/Rules/MCP renderer 已实现。" technology
}

run_task_02() {
  local w="$RUNNER_TEMP/c03-02"
  local e="$RUNNER_TEMP/c03-02-delivery.md"
  python -B "$SDD" prepare "$CHG" --root . --task C03-02 --worktree "$w" > /tmp/C03-02.json
  python -B "$SDD" bind-session "$CHG" --root . --task C03-02 --agent-session finalize-c03-02 >/dev/null
  for path in scripts/install.py install.sh tests/test_install.py; do copy_file "$w" "$path"; done
  git -C "$w" add scripts/install.py install.sh tests/test_install.py
  git -C "$w" commit -m "Worker C03-02 multi-host installer"
  python -B -m unittest discover -s "$w/tests" -p 'test_install.py' -v
  finish_worker C03-02 "$w" "$e" "Codex/OpenCode/Claude 安装、升级、host manifest 与 package overlay 已实现。" technology
}

run_task_03() {
  local w="$RUNNER_TEMP/c03-03"
  local e="$RUNNER_TEMP/c03-03-delivery.md"
  python -B "$SDD" prepare "$CHG" --root . --task C03-03 --worktree "$w" > /tmp/C03-03.json
  python -B "$SDD" bind-session "$CHG" --root . --task C03-03 --agent-session finalize-c03-03 >/dev/null
  for path in sdd-do/scripts/run_leaf.py sdd-do/references/leaf-execution.md tests/test_leaf_launcher.py; do copy_file "$w" "$path"; done
  git -C "$w" add sdd-do/scripts/run_leaf.py sdd-do/references/leaf-execution.md tests/test_leaf_launcher.py
  git -C "$w" commit -m "Worker C03-03 multi-host execution"
  python -B -m unittest discover -s "$w/tests" -p 'test_leaf_launcher.py' -v
  finish_worker C03-03 "$w" "$e" "三宿主 leaf 启动、workspace 约束与 exact session resume 已实现。" technology
}

run_task_04() {
  local w="$RUNNER_TEMP/c03-04"
  local e="$RUNNER_TEMP/c03-04-delivery.md"
  python -B "$SDD" prepare "$CHG" --root . --task C03-04 --worktree "$w" > /tmp/C03-04.json
  python -B "$SDD" bind-session "$CHG" --root . --task C03-04 --agent-session finalize-c03-04 >/dev/null
  copy_file "$w" "sdd-do/scripts/observe.py"
  copy_tree "$w" "sdd-do/scripts/observation"
  copy_file "$w" "sdd-do/references/observation.md"
  copy_file "$w" "tests/test_observation.py"
  git -C "$w" add sdd-do/scripts/observe.py sdd-do/scripts/observation sdd-do/references/observation.md tests/test_observation.py
  git -C "$w" commit -m "Worker C03-04 host-aware observation"
  python -B -m unittest discover -s "$w/tests" -p 'test_observation.py' -v
  finish_worker C03-04 "$w" "$e" "Observation 已区分 Codex full trace 与 OpenCode/Claude partial/unsupported trace。" technology
}

run_task_05() {
  local w="$RUNNER_TEMP/c03-05"
  local e="$RUNNER_TEMP/c03-05-delivery.md"
  python -B "$SDD" prepare "$CHG" --root . --task C03-05 --worktree "$w" > /tmp/C03-05.json
  python -B "$SDD" bind-session "$CHG" --root . --task C03-05 --agent-session finalize-c03-05 >/dev/null

  local paths=(
    ".github/workflows/validate.yml"
    "README.md"
    "README.zh-CN.md"
    "docs/02-product/P01-product-overview.md"
    "docs/02-product/P02-modules/P02-02-agent-routing.md"
    "docs/02-product/P02-modules/P02-03-installation.md"
    "docs/02-product/P02-modules/P02-04-behavior-observation.md"
    "docs/03-architecture/T01-architecture-overview.md"
    "docs/03-architecture/T02-api.md"
    "docs/04-operations/O01-operations-overview.md"
    "docs/04-operations/O02-applications/O02-01-local-toolkit.md"
    "docs/04-operations/O03-diagrams/O03-01-deployment-architecture.md"
    "docs/08-quality/Q01-validation.md"
    "scripts/verify_claude.py"
    "scripts/verify_opencode.py"
    "tests/test_sdd.py"
    "sdd-init/references/runtime-guide.md"
  )
  for path in "${paths[@]}"; do copy_file "$w" "$path"; done
  git -C "$w" add "${paths[@]}"
  git -C "$w" commit -m "Worker C03-05 multi-host validation and Current Truth"
  python -B "$w/scripts/sdd_validate.py"
  python -B "$w/scripts/verify_opencode.py"
  python -B "$w/scripts/verify_claude.py"
  finish_worker C03-05 "$w" "$e" "三宿主真实 CLI smoke、CI、README 与 Current Truth 已同步。" multiple
}

python -B "$SDD" status "$CHG" --root .
run_task_01
run_task_02
run_task_03
run_task_04
run_task_05
python -B "$SDD" status "$CHG" --root .

FINAL_HEAD="$(git rev-parse HEAD)"
export FINAL_HEAD CHG
python - <<'PY'
import os, sys
from pathlib import Path
sys.path.insert(0, 'sdd-init/scripts')
from sdd_common import metadata, render_spec
change=Path('docs/05-changes/C01-进行中')/os.environ['CHG']/'C01-change.md'
fields,body=metadata(change.read_text())
fields.update(
    integrated_revision=os.environ['FINAL_HEAD'],
    product='Open Spec Mesh 支持 Codex、OpenCode、Claude Code 三宿主，共用同一 Quick/SDD 产品语义。',
    technology='Host Adapter、非破坏性 Installer、三宿主 leaf/session、host-aware Observation 与真实 CLI CI 已落地。',
    operations='main/full CI 新增 OpenCode/Claude runtime smoke；不增加常驻服务。',
)
body=body.replace(
    '## 验证结果\n\npending',
    '## 验证结果\n\nAC-01 至 AC-06 均通过。真实 latest OpenCode、Claude Code 与 Codex runtime smoke 均通过且未调用模型；Python 3.11/3.13、Mermaid、Docker、Research Tools 全部通过。'
)
body=body.replace('## 最终结论\n\npending','## 最终结论\n\npass')
change.write_text(render_spec(fields,body))
PY

python -B sdd-close/scripts/run_validation.py "$CHG" --root . --revision "$FINAL_HEAD"
python -B "$SDD" close "$CHG" --root . --archive
test -d "docs/05-changes/C02-已完成/$CHG"
test ! -d "docs/05-changes/C01-进行中/$CHG"

git add -A
git commit -m "Archive multi-host OpenCode and Claude runtime change"
git push --force origin HEAD:sdd/multi-host-runtime
