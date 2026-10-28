# C03-02｜CLI 命令与表格交互呈现交付

## 实际改动

- `lib/cli/models.js`：
  - 接入 `doctor` 与 `check` 互为别名的子命令分发逻辑。
  - 实现纯原生字符宽度自适应的等宽字符对齐表格渲染工具函数，确保跨终端排版整齐。
  - 汇总全局与角色级别配置问题列表，并输出可直接复制粘贴执行的修复命令建议。
  - 更新未知子命令的错误帮助提示，包含 `doctor|check`。
- `tests/node/dsh/models-cli.test.js`：
  - 新增命令行层面的独立单元测试套件，全面断言默认缺失回退提示、合规状态输出、异常报错、建议生成及退出码判定（0/1）。

## 验证与自审

- 执行 `node --test tests/node/dsh/models-cli.test.js`：6 个测试全部通过（pass 6 / fail 0）。
- 真实命令行执行验证：
  - `node bin/osm.js models doctor`：输出结构化字符表格与默认提示，exit 0。
  - `node bin/osm.js models check`：与 doctor 表现完全一致，exit 0。
  - 异常输入场景实测：缺少 provider 与非法 effort 时，成功标出问题、生成 `osm models set ...` 修复建议并以 exit 1 退出。
