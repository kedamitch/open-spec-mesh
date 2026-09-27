# 运维与 Docker 交付

## 文档结构

| 文档 | 内容 |
| --- | --- |
| O01-operations-overview.md | Environments、Deployment、Configuration、Network、Observability、Recovery、Security 和逐应用入口 |
| O02-applications/O02-xx-<app>.md | 应用运行边界、构建/启动、外置配置、验证/恢复 |
| O03-diagrams/O03-01-deployment-architecture.md | 主机、容器、网络/端口、持久化和依赖；独立 Mermaid Markdown |

## 每应用模板

```markdown
# 应用部署

## 运行边界
职责、依赖、监听/入口、网络、资源与持久化位置。

## 构建与启动
链接真实 Dockerfile，写明执行目录、构建上下文、镜像版本、前置条件及一行启动命令。

## 外置配置
链接 .env.example；列变量、是否必需/默认值、用途和生效方式，不填真实密钥。

## 验证与恢复
健康检查、日志、升级/迁移条件、上一版本及回退步骤；有不可逆操作明确指出。
```

## 执行工件

Worker 在业务源码目录交付 Dockerfile、生效的 `.dockerignore`、无密钥 `.env.example`；Architect 只在 MD 引用。外部托管服务或第三方原版镜像标明来源，不虚构自建应用。

默认每个应用 Dockerfile + 一行 `docker run --env-file ...`；首次构建可用 `docker build ... && docker run ...`。不默认 Compose / Kubernetes，不用 `rm -f` 隐式替换现有容器，初始化网络/卷写为前置条件。

```sh
# 形式示例：在实际业务项目根目录，先准备私有 deploy/api/.env。
docker build -f deploy/api/Dockerfile -t example-api:release-001 . && docker run -d --name example-api --restart unless-stopped --env-file deploy/api/.env -p 127.0.0.1:8080:8080 example-api:release-001
```

## 必须守住的边界

- 真实 `.env` 外置且限制读取；不入 Git、构建上下文或镜像，不写 Dockerfile ARG/ENV 或日志。构建密钥用 BuildKit secret。
- `--env-file` 注入容器环境，不替宿主 shell 展开镜像、端口、网络或卷，也不执行脚本/Compose 插值；不 `eval/source` 不可信配置。
- 配置必须由应用真实读取；静态前端需要启动时配置机制，不能把构建时变量冒充运行时变量。
- 数据挂持久卷；按应用选择非 root、进程退出/信号、日志轮转与重启策略。host 网络只在实际需要时使用并列清端口冲突；不默认 privileged 或挂 Docker socket。
- 实际构建、启动、探活和恢复分别记录结果；缺环境写未验证。`.env` 不是秘密隔离系统，有 Docker 管理权限者可能读取环境。

依据：[Docker run](https://docs.docker.com/reference/cli/docker/container/run/)、[Build secrets](https://docs.docker.com/build/building/secrets/)、[Build context](https://docs.docker.com/build/building/context/)。
