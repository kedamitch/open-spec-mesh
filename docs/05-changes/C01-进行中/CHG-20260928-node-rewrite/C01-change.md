# 变更说明

> **目标**：把 Open Spec Mesh 的可执行实现从 Python/Shell 完整迁移为 Node.js/JavaScript；最终用户环境只要求 Node.js、npm、Git。现有 main 的能力必须等价保留或增强，已废弃能力不得复活。

## 目标与范围

### 本次包含

- NPM package / CLI，一条 npm 安装路径。
- Codex / OpenCode / Claude Code 三宿主安装、角色渲染、MCP 配置。
- `sdd-init / migrate / change / do / close / research / release / diagnose` 全部确定性能力。
- Quick / SDD 现行模式、Task Graph、Contract drift、Worker session、worktree、Delivery / Acceptance / Integration / Close。
- Observation、System One/Laya、Research MCP bootstrap、validation/CI。
- JS 测试覆盖当前 Python 测试表达的有效产品行为。
- parity 完成后移除 Python/Shell 运行依赖。

### 本次不做

- 不恢复 Simple / Complex 等已废弃模式。
- 不改变 Quick / SDD 产品语义。
- 不减少 Codex / OpenCode / Claude Code 当前能力。
- 不把 Python/Shell 包进 npm 后继续当隐藏运行时。

## Requirements

- **R01**：最终安装与运行只依赖 Node.js + npm + Git；MCP 可由安装器检测、安装、配置。
- **R02**：以本 Change 开始时 main 的代码和测试为 feature-parity 唯一基线。
- **R03**：迁移期间旧实现仅作为对照 oracle；主分支切换必须等待 JS parity 全绿。
- **R04**：用户配置、凭据、未受管文件与 Git 工作区安全边界不得因重写降级。

## 验收标准

- **AC-01 NPM 安装**：`npm install -g open-spec-mesh` 后 `osm` 可用；无 Python/Bash 前置依赖。
- **AC-02 Host parity**：Codex/OpenCode/Claude 安装形状、角色权限、session/workspace 语义与当前 main 等价。
- **AC-03 SDD parity**：现有 lifecycle、Task Graph、contract、delivery、integration、close 行为通过 JS 行为测试。
- **AC-04 Supporting parity**：init/migrate/research/release/diagnose/observation/System One/MCP 能力保留。
- **AC-05 Dependency gate**：仓库正式入口与发布包不再调用 `.py`/`.sh`；只有 Node/npm/Git 为前置。
- **AC-06 Regression**：Quick/SDD、角色边界、30 分钟轮询规则、Reviewer opt-in、三宿主能力均无回退。

## 影响范围

| 维度 | 影响 |
| --- | --- |
| 产品 | 安装体验与 CLI 统一为 NPM；产品语义不变 |
| Runtime | Python/Shell → Node.js |
| Git | 继续作为 revision/worktree/integration 基础 |
| MCP | 由 Node 安装器管理；不要求用户预装 |
| CI | Node 20.18.1+/22 parity matrix，最终移除 Python runtime gate |
