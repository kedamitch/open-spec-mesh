# 部署架构

```mermaid
flowchart LR
    Host[Host]
    App[Application / Container]
    Store[(Persistent Store)]
    Host --> App --> Store
```

待核实：替换为真实主机、容器、网络、端口、持久化和依赖。
