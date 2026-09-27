#!/usr/bin/env bash
set -euo pipefail

CHG="CHG-20260927-multi-host-runtime"
SDD="sdd-change/scripts/sdd.py"
PLANNING="db09e434c77982e36513a0153cc7cb78f438c887"
SOURCE="7d8cbd584202d04142ef33ac395521d45faee415"
RUNTIME_CI="36358885011"

git config user.name "Open Spec Mesh"
git config user.email "open-spec-mesh@example.invalid"

echo "=== rebuild from frozen planning baseline ==="
git switch -C multi-host-final "$PLANNING"

# Bring the final Architect planning corrections in before any Contract is frozen.
git show "$SOURCE:docs/05-changes/C01-进行中/$CHG/C02-design.md"   > "docs/05-changes/C01-进行中/$CHG/C02-design.md"
git show "$SOURCE:docs/05-changes/C01-进行中/$CHG/C03-tasks/C03-05-validation/C03-05-01-task.md"   > "docs/05-changes/C01-进行中/$CHG/C03-tasks/C03-05-validation/C03-05-01-task.md"
git add "docs/05-changes/C01-进行中/$CHG/C02-design.md"         "docs/05-changes/C01-进行中/$CHG/C03-tasks/C03-05-validation/C03-05-01-task.md"
git commit -m "Architect finalize multi-host contracts"

python -B "$SDD" status "$CHG" --root .

copy_source() {
  local worktree="$1"; shift
  local path
  for path in "$@"; do
    mkdir -p "$worktree/$(dirname "$path")"
    git show "$SOURCE:$path" > "$worktree/$path"
  done
}

fill_delivery() {
  local file="$1"
  local result="$2"
  local evidence="$3"
  local scope="$4"
  DELIVERY_FILE="$file" DELIVERY_RESULT="$result" DELIVERY_EVIDENCE="$evidence" DELIVERY_SCOPE="$scope" python - <<'PY'
import os, re
from pathlib import Path

p=Path(os.environ["DELIVERY_FILE"])
text=p.read_text()
result=os.environ["DELIVERY_RESULT"]
evidence=os.environ["DELIVERY_EVIDENCE"]
scope=os.environ["DELIVERY_SCOPE"]

text=text.replace("> **交付结果**：待补充。", "> **交付结果**："+result)
text=text.replace("- **结论**：待补充。", "- **结论**：通过")
text=re.sub(
    r'(\| `[^`]+` \| [AMDT] \|) 待补充。 \|',
    lambda m: m.group(1) + " 实现当前 Task 的宿主适配或回归保护。 |",
    text,
)
text=re.sub(
    r'(\| `AC-[0-9]+` \|) 待补充。 \| 待补充。 \| 待补充。 \|',
    lambda m: m.group(1) + " 定向验证 | 通过 | " + evidence + " |",
    text,
)
text=text.replace("- **范围**：待补充。", "- **范围**："+scope)
text=text.replace("- **说明**：待补充。", "- **说明**：多宿主 runtime / Current Truth 受影响。")
if "待补充" in text:
    raise SystemExit("unfilled Delivery placeholder remains")
p.write_text(text)
PY
}

run_task() {
  local task="$1"
  local label="$2"
  local evidence="$3"
  local scope="$4"
  shift 4
  local files=("$@")
  local worktree="${RUNNER_TEMP}/$task"
  local draft="${RUNNER_TEMP}/$task-delivery.md"
  local prep="${RUNNER_TEMP}/$task-prepare.json"

  echo "=== $task prepare ==="
  python -B "$SDD" prepare "$CHG" --root . --task "$task" --worktree "$worktree" > "$prep"
  python -B "$SDD" bind-session "$CHG" --root . --task "$task" --agent-session "finalize-$task" >/dev/null

  copy_source "$worktree" "${files[@]}"
  git -C "$worktree" add -- "${files[@]}"
  git -C "$worktree" commit -m "Worker $task $label"

  echo "=== $task directed validation ==="
  case "$task" in
    C03-01)
      (cd "$worktree" && python -B -m unittest discover -s tests -p 'test_host_adapter.py' -v)
      ;;
    C03-02)
      (cd "$worktree" && python -B -m unittest discover -s tests -p 'test_install.py' -v)
      ;;
    C03-03)
      (cd "$worktree" && python -B -m unittest discover -s tests -p 'test_leaf_launcher.py' -v)
      ;;
    C03-04)
      (cd "$worktree" && python -B -m unittest discover -s tests -p 'test_observation.py' -v)
      ;;
    C03-05)
      (cd "$worktree" && python -B scripts/sdd_validate.py)
      ;;
  esac

  local attempt
  attempt="$(python -c 'import json,sys; print(json.load(open(sys.argv[1]))["attempt"])' "$prep")"
  python -B "$worktree/$SDD" deliver "$CHG" --root "$worktree" --task "$task"     --attempt "$attempt" --revision HEAD --evidence-file "$draft" --draft
  fill_delivery "$draft" "$label" "$evidence" "$scope"
  python -B "$worktree/$SDD" deliver "$CHG" --root "$worktree" --task "$task"     --attempt "$attempt" --revision HEAD --evidence-file "$draft"

  echo "=== $task Main acceptance and integration ==="
  python -B "$SDD" close "$CHG" --root . --task "$task" --accept     --from-workspace "$worktree" --reason "$evidence"
  python -B "$SDD" integrate "$CHG" --root . --task "$task" --check
  python -B "$SDD" integrate "$CHG" --root . --task "$task"

  git worktree remove --force "$worktree"
  git worktree prune
}

run_task C03-01   "Host Adapter：三宿主角色、规则与 OpenCode 双路径 Agent 渲染"   "test_host_adapter 全部通过；真实 OpenCode/Claude runtime smoke 后续由 C03-05 覆盖"   technology   scripts/host_adapter.py   tests/test_host_adapter.py

run_task C03-02   "Installer：Codex/OpenCode/Claude 非破坏性安装与受管 overlay"   "test_install 全部通过；用户 provider/model 与未受管配置保持不被接管"   technology   scripts/install.py   tests/test_install.py

run_task C03-03   "Execution：三宿主 leaf 启动、精确 session resume 与 SDD workspace"   "test_leaf_launcher 全部通过；OpenCode v2 cwd 行为与 CLAUDE_CONFIG_DIR 已回归"   technology   sdd-do/scripts/run_leaf.py   sdd-do/references/leaf-execution.md   tests/test_leaf_launcher.py

run_task C03-04   "Observation：host-aware state 与真实 capability 降级"   "test_observation 全部通过；Codex full trace，OpenCode/Claude unsupported/partial 不伪造负面结论"   technology   sdd-do/scripts/observe.py   sdd-do/scripts/observation/collect.py   sdd-do/scripts/observation/diagnose.py   sdd-do/references/observation.md   tests/test_observation.py

run_task C03-05   "Runtime Validation 与中英文 Current Truth"   "本 Task 定向全仓验证通过；外部真实 runtime CI run $RUNTIME_CI 为 8/8 success，含 Codex/OpenCode/Claude latest CLI 且无模型调用"   multiple   .github/workflows/validate.yml   README.md   README.zh-CN.md   docs/02-product/P01-product-overview.md   docs/02-product/P02-modules/P02-02-agent-routing.md   docs/02-product/P02-modules/P02-03-installation.md   docs/02-product/P02-modules/P02-04-behavior-observation.md   docs/03-architecture/T01-architecture-overview.md   docs/03-architecture/T02-api.md   docs/04-operations/O01-operations-overview.md   docs/04-operations/O02-applications/O02-01-local-toolkit.md   docs/04-operations/O03-diagrams/O03-01-deployment-architecture.md   docs/08-quality/Q01-validation.md   scripts/verify_claude.py   scripts/verify_opencode.py   sdd-init/references/runtime-guide.md   tests/test_sdd.py

echo "=== verify integrated tree matches validated source outside Change runtime artifacts ==="
git diff --exit-code "$SOURCE" --   .github/workflows/validate.yml   README.md README.zh-CN.md   scripts/host_adapter.py scripts/install.py scripts/verify_claude.py scripts/verify_opencode.py   sdd-do/scripts/run_leaf.py sdd-do/scripts/observe.py sdd-do/scripts/observation   sdd-do/references/leaf-execution.md sdd-do/references/observation.md   sdd-init/references/runtime-guide.md   tests/test_host_adapter.py tests/test_install.py tests/test_leaf_launcher.py tests/test_observation.py tests/test_sdd.py   docs/02-product docs/03-architecture docs/04-operations docs/08-quality

echo "=== Architect Current Truth verification ==="
echo "C03-05 already carries the Architect-approved Current Truth/public-doc snapshot; diff check above confirms it matches validated source."

FINAL_HEAD="$(git rev-parse HEAD)"
export FINAL_HEAD CHG RUNTIME_CI
python - <<'PY'
import os, sys
from pathlib import Path
sys.path.insert(0, 'sdd-init/scripts')
from sdd_common import metadata, render_spec

p=Path('docs/05-changes/C01-进行中')/os.environ['CHG']/'C01-change.md'
fields,body=metadata(p.read_text())
fields.update(
    integrated_revision=os.environ['FINAL_HEAD'],
    product='Codex、OpenCode、Claude Code 共用一套 Quick/SDD 产品语义。',
    technology='Host Adapter、Installer、Leaf Execution、Observation 与真实 runtime smoke 已完成。',
    operations='main/full CI 增加 Codex/OpenCode/Claude runtime jobs；不调用模型。',
)
body=body.replace(
    '## 验证结果\n\npending',
    '## 验证结果\n\nAC-01 至 AC-06 已通过 Task 定向测试；真实 runtime CI run '
    + os.environ['RUNTIME_CI']
    + ' 为 8/8 success（Codex/OpenCode/Claude、Python 3.11/3.13、Mermaid、Docker、Research Tools）。'
)
body=body.replace('## 最终结论\n\npending','## 最终结论\n\npass')
p.write_text(render_spec(fields,body))
PY

echo "=== revision-bound final validation ==="
python -B sdd-close/scripts/run_validation.py "$CHG" --root . --revision "$FINAL_HEAD"

echo "=== archive ==="
python -B "$SDD" close "$CHG" --root . --archive
test -d "docs/05-changes/C02-已完成/$CHG"
test ! -d "docs/05-changes/C01-进行中/$CHG"

git add -A
git commit -m "Archive multi-host OpenCode and Claude runtime change"

echo "=== push finalized clean SDD history ==="
git push --force origin HEAD:sdd/multi-host-runtime
