# 产品能力分层

```mermaid
flowchart TB
  G[目标：约束明确、实现可信、交接经济] --> M[模式选择：Quick / SDD]
  subgraph Flow[研发能力]
    P[必要设计与 Task Graph] --> E[实现与逐文件交付] --> C[集成验收与事实同步]
    C --> R[按需发布准备]
  end
  M --> P
  subgraph Shared[共享协作能力]
    A[Architect 自适应设计]
    Q[Explorer / Librarian 定向证据]
    V[自审与用户显式独立复审]
  end
  P --> A
  A --> Q
  E --> V
  subgraph Base[基础能力]
    D[Markdown 契约和结构化快照]
    T[Task / Worktree / attempt]
    S[Git 身份、差异与校验]
    I[安装与升级：受管文件与失败恢复]
    O[离线行为诊断：执行证据与规则回归]
  end
  I --> D
  P --> D
  E --> T
  C --> S
  S -.-> O
```

Quick 不创建 SDD 工件，但可按需使用 Explorer / Librarian。SDD 由 Architect 先规划，设计重量由任务本身决定；Graph 就绪后 Main 才派发 Worker。Reviewer 仍只有用户明确要求时启用。

共享交付能力：[安装与升级](../P02-modules/P02-03-installation.md)；属于本地工具包，不代表新增常驻应用。
