# osm 短命令与显式发布：本地实施记录

> 2026-09-29，用户授权串行本地实现/验证，并明确先不上传；后续真实 npm 发布必须用户显式 $sdd-release + 本次目标版本授权。此记录不是最终验收、发布授权或 Change 归档。

## 本轮真实改动

- 新增 osm bin，共享 CLI entry 的帮助、版本和分发，保留 open-spec-mesh 兼容入口。
- osm 无参数等价 install --host codex --skip-tools；直接 --dry-run 只预览，完整子命令保留，显式选项可覆盖默认宿主。旧入口无参数仍显示帮助；help/version 不安装，未知命令非零退出。
- manifest、两份锁根 bin、安装所需资源与 runtime/pack 审计同步，依赖与 Node >=22.0.0 不变。
- 发布门槛写入工作约定、模板、运行指南和 sdd-release；Skill agents/openai.yaml 的 allow_implicit_invocation=false。本机受管 Skill/managed rules 已定向同步，非受管全局规则逐字节保留，没有重装真实 Home/runtime 或全局 npm 命令。
- 双语 README 明确当前公共 0.0.1 不含 osm；本地源码的短入口可用，未来版本需另行显式授权。没有改变版本号或覆写已发布产物。

## 验证

- Node 22.0.0 + npm 10.9.2：core exit=0，9 项 required checks 全通过；167 项项目 + 4 项 Agent 回归共 171 项，零失败/skip。
- 本地 tarball 的真实 npm global bin 验证 osm --version/--help、直接 --dry-run 与无参数实际 Codex 安装；旧 Python 退役和无关 user-tool/script.py 保留验证仍通过。测试全在隔离 Home/prefix，不发布 registry。
- Node 24.19.0：短入口及发布规范 10 项定向回归通过；此前最低版本安装/runtime 定向 77 项通过。
- runtime audit：122 JS syntax，第一方 Python=0，两份锁 byte-identical。帮助输出测试时遇到 head 提前关闭管道导致的第二次 stdout write EPIPE，已合并单次帮助输出；正常 help/version 行为回归通过。
- 文档结构/链接与 git diff --check 通过。Skill 显式调用 policy 与发布授权文本有定向回归；本机 Skill 与源文件一致。

核心日志与本轮前源代码、受管 norm 备份在 /tmp/osm-short-command-i7lfGb。full 扩展宿主/工具环境未在本轮重新完成，不以 core 结果冒称全绿。

## 发布和阶段边界

此前 0.0.1 于 2026-09-29 已合法成功发布并通过无认证公共消费验证，此次要求不撤销该历史版本。本轮只本地源码改造，npm 公共 0.0.1 仍只有原入口；没有上传 0.0.2、没有修改 latest、没有 unpublish，也未提交/push/归档。

用户这次贴出 Skill 用于设定授权规范，不等于真实上传指令。仅测试通过、“继续”、权限或旧版本授权都不能触发下次 npm publish；等待用户显式 $sdd-release 及目标版本授权后再处理发布准备与真实上传。
