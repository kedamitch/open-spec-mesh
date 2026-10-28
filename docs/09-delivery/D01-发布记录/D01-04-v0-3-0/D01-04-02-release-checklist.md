# 发布检查清单 (0.3.0)

## Build

- [x] Node.js syntax & runtime check passed (`node scripts/check_runtime.js`)

## Tests

- [x] Unit tests passed (全库 300 项测试全部通过)
- [x] Integration tests passed (DSH 真实挂载冒烟、端到端安装与真实会话实测通过)

## Database

- [x] Migration verified or confirmed not applicable (无数据库变更)

## Configuration

- [x] Environment variables / configuration verified (DSH_HOME, osm-models.json 支持测试)

## Documentation

- [x] Current Truth updated (README, README.zh-CN, 模块文档, SDD 变更与发布记录全部同步)

## Deployment

- [x] Deployment path verified (.github/workflows/npm-publish.yml OIDC workflow dispatch)

## Rollback

- [x] Rollback path verified (Git tag 与 npm 版本回滚方案明确)
