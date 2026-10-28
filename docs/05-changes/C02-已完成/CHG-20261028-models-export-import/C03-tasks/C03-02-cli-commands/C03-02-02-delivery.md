# 任务交付：CLI 备份与还原命令 (C03-02)

## 交付物与验证

- 在 `lib/cli/models.js` 中增加 `export` 与 `import` 子命令分发。
- `export` 支持标准输出或输出到指定文件，格式化带缩进 JSON。
- `import` 支持从文件或标准输入导入配置，未指定 `--force` 时对已存在的目标文件报错退出并输出提示。
- CLI 测试套件 `tests/node/dsh/models-cli.test.js` 包含 12 项测试全部通过（tests 12 / pass 12 / fail 0）。
