# Change 主流程时序

```mermaid
sequenceDiagram
  actor User as 用户
  participant Main
  participant Arch as Architect
  participant Worker
  participant CLI as SDD CLI
  participant Git

  User->>Main: 目标、范围与约束
  alt Quick
    opt 需要只读调查
      Main->>Main: 委派 Explorer / Librarian，收集证据
    end
    Main->>Main: 实现、测试、自审
  else SDD
    Main->>Arch: 目标、范围、已知事实与约束
    opt 关键事实不足
      Arch->>Arch: 委派 Explorer / Librarian
    end
    Arch-->>Main: C01 Change + C02 Design + C03 Task Graph + 全部 Task Design
    Main->>CLI: status
    CLI-->>Main: planning_ready / allowed_actions
    Main->>CLI: prepare
    CLI->>CLI: 检查真实正文、AC 与 Design/Task 映射
    break Graph / Contract 不可执行
      CLI-->>Main: 报告缺口
      Main->>Arch: 原上下文修正 Design / Graph
    end
    CLI->>Git: 检查依赖已验收且纳入 baseline
    CLI-->>Main: Worker Dispatch Packet + baseline / attempt / workspace
    Main->>Worker: Role Prompt + Dispatch Packet
    Main->>CLI: bind-session(spawn 返回的 thread/session)
    Worker->>Worker: 实现、定向测试、必要 build/static、自审、修复、复验
    alt 冻结契约必须变化
      Worker-->>Main: contract_change_required 与证据
      Main-->>User: 变化及其影响，暂停相关工作
      break 未获契约变更确认
        Main-->>User: 保留当前契约与代码，不启动下游
      end
      User-->>Main: 明确确认本次契约变化
      Main->>Arch: 修订 Design / Graph
      Main->>CLI: replan / prepare
      Main->>Worker: 原上下文，新执行身份，复验
    end
    Worker->>Git: 提交授权实现
    Worker->>CLI: 写当前逐文件 Delivery
    Main->>CLI: import_delivery / submit
    Main->>Main: 核查 AC / diff / 证据
    opt 用户明确要求独立复审
      Main->>Main: 委派 Reviewer
    end
    loop 存在普通实现缺陷且契约不变
      Main->>CLI: rework / prepare
      CLI-->>Main: resume=true + 原 agent_session
      Main->>Worker: 一次合并反馈，恢复原上下文
      Worker->>Git: 修复、测试、自审、提交
      Worker->>CLI: 新 attempt 的 Delivery
      Main->>CLI: 重新导入 / submit / 核验
    end
    Main->>CLI: accept
    Main->>CLI: integrate --check
    CLI->>Git: detached merge preflight + ancestry check
    alt 外部代码冲突
      CLI-->>Main: conflict paths
      Main->>Worker: 复杂语义冲突回派原 Worker；简单冲突 Main 处理
      Worker->>Git: 必要时提交冲突解决并定向复验
    else 可集成
      Main->>CLI: integrate
      CLI->>Git: ancestry-preserving merge commit
      CLI-->>Main: integrated
    end
    opt 受影响快照需要同步
      Main->>Arch: 完整 diff、历次 Delivery、集成结果
      Arch-->>Main: 受影响 Current Truth 已更新
    end
    Main->>Git: 提交实现 + Current Truth，形成最终 HEAD
    Main->>CLI: run_validation(final HEAD)
    CLI->>CLI: 调用项目唯一 Validation Entry Point
    loop 任一 required check 失败
      CLI-->>Main: 非零退出 + 失败摘要
      Main->>Main: 修复简单集成问题
      opt 需要局部 Worker 上下文
        Main->>Worker: 回派原 Worker 修复并定向复验
      end
      Main->>Git: 更新最终 HEAD
      Main->>CLI: 重新 run_validation
    end
    CLI-->>Main: revision-bound validation receipt
    Main->>Main: 整体 AC 验收 + 填 active Change 收口证据
    Main->>CLI: check_change / close_change
  end
```

Quick 允许 Explorer / Librarian 调查，但不进入 SDD Task 生命周期。SDD 有依赖时按 Execution Wave → Integration Wave → Next Wave 推进；accepted 但未进入 HEAD 的上游不会让下游 prepare。进入 SDD 无额外模式审批；冻结契约变化与 Reviewer 显式授权仍是独立边界。

路由分层：SDD runtime 只给出当前状态与机械允许动作；Main 负责 Quick/SDD、调查类型、实现缺陷/设计缺口等语义路由；角色 TOML 负责 Agent 被唤起后的工作方法，动态 Dispatch Packet 只传当前任务的工件引用和增量上下文。
