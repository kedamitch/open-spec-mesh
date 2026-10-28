# C03-02｜安装器与模型配置交付

## 实际改动

- `lib/installation/models-config.js`：成为模型配置单一事实源（`DEFAULT_MODELS` 在 `:7`）；新增 `loadModelsConfigWithDiagnostics(homeDir)`（`:54`），坏 JSON（`:69`）、顶层非对象（`:73`）、未知角色（`:77`）、角色非对象（`:82`）、缺字段（`:88`）逐条记 problem；`loadModelsConfig`（`:96`）取其 `config`。
- `dsh/gatekeeper.mjs`：改为 `import { DEFAULT_MODELS, loadModelsConfig } from '../lib/installation/models-config.js'`（`:13`），删除插件内旧副本（旧值 `worker=high`、`fatfei-codex/deepseek-flash`，与 HEAD 的 `1b9ec08`/`96ac9a1` 不一致）。
- `lib/installation/installer.js`：dsh 不写 `agents/*.md`（`:256`）、不写 MCP overlay（`:330-331`）、跳过 research tools（`:439`、`:443`）与 laya 环境检查（`:351`、`:444`），`--with-laya` 写入前 fail closed（`:534`），收尾给出真实产物与挂载命令（`:455`、`:510-512`）；`--host` 帮助补 dsh（`:549`）。
- 附带修复：只删 dsh 分支会让 dsh 落入 opencode/claude 的 else 分支调用 `renderMcpOverlay`，在 `lib/installation/host-adapter.js:154` 对 `null` commands 取属性抛 `TypeError: Cannot read properties of null (reading 'codegraph')`；现在由 `:330-331` 显式排除。
- `lib/installation/inspect.js`：dsh 角色文件判定为 `not_applicable`（`:64-65`），新增顶层 `dsh: { agents_md_managed_section, sdd_skills }`（`:84`），usage 补 dsh（`:104-107`）。
- `lib/cli/models.js`：allowlist 归属提示（`:15`）；`set` 拒绝空值并以 exit 1 结束（`:29-33`）。

## 验证与自审

- `node --test tests/node/dsh/*.test.js`：tests 20 / pass 20 / fail 0，其中 `models-config.test.js` 覆盖诊断路径，`install-dsh.test.js` 覆盖 dsh 写入/跳过语义。
- HEAD 的模型值未被改写：`architect=fatfei-codex/gpt-6.1-sol/xhigh`、`worker`/`reviewer=opencode-go/deepseek-flash/max`、`explorer`/`librarian=…/low` 保持提交 `1b9ec08`、`96ac9a1` 的设定。
- 自审要点：fail-closed 发生在任何写入之前；跳过项都有明确的 reporter 输出，不靠静默。

## 风险与快照影响

安装器全流程未在真实依赖齐全的环境跑通（仓库无 node_modules，离线安装挂在 `ETARGET jszip@3.10.2`），`tests/node/installer.test.js` 的 7 pass/16 fail 是改动前既有的环境性失败，见 [C04-delivery.md](../../C04-delivery.md) 的未验证清单。
