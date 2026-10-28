# C03-03｜文档与全量验证闭环交付

## 实际改动

- `docs/02-product/P02-modules/P02-03-installation.md`：
  - 更新“角色路由”部分描述，补充 `osm models doctor`（别名 `osm models check`）关于语法、4 个核心角色完整性与合法思考档位校验及字符表格、修复建议的说明。

## 验证与自审

- 静态与运行时检查：
  - 执行 `node scripts/check_runtime.js`：
    `Runtime audit passed: syntax=146, Python-sources=0, package-files=392, lock=3, static-files=92`
- 模型配置与 CLI 专项测试：
  - 执行 `node --test tests/node/dsh/models-config.test.js tests/node/dsh/models-cli.test.js`：18 tests / 18 passed / 0 failed。
- 端到端命令行检查：
  - `node bin/osm.js models doctor`：exit 0，字符表格与默认提示展示正常。
  - `node bin/osm.js models check`：exit 0，别名行为一致。
  - 异常输入实测：非对象、缺少必填字段、非法 reasoningEffort 档位均被精准捕获，给出可直接执行的一键修复命令，且 exit 1。
