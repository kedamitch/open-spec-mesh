import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite,createText,inside,withProjectLock } from "../lib/fs-safe.js";

const PACKAGE_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const PROJECT_AGENTS_TEMPLATE=path.join(PACKAGE_ROOT,"sdd-init","references","project-agents-template.md");
const AREAS=["01-governance","02-product","03-architecture","04-operations","05-changes","06-decisions","07-research","08-quality","09-delivery"];
const CODE="(?:[GPTOCRQD][0-9]{2}(?:-[0-9]{2})*|ADR-[0-9]{3})";
const DIRECTORIES={
  "02-product/P02-modules":`# 产品模块

每个真实模块使用独立 \`P02-xx-<module>.md\`。

## 模块清单

| 模块 | 职责 | 核心能力 | 文档 |
| --- | --- | --- | --- |
| 待核实 | 待核实 | 待核实 | 待核实 |
`,
  "02-product/P03-diagrams":"# 产品图表\n",
  "03-architecture/T05-diagrams":"# 技术图表\n",
  "04-operations/O02-applications":`# 应用运行说明

每个可部署应用使用独立 \`O02-xx-<application>.md\`，维护 Runtime、依赖、端口、外置配置、Dockerfile、Build、一行 Deploy、健康检查、日志和回滚。
`,
  "04-operations/O03-diagrams":"# 运维图表\n",
  "05-changes/C01-进行中":"# 进行中的变更\n",
  "05-changes/C02-已完成":"# 已完成的变更\n",
  "08-quality/Q02-reviews":"# 独立 Review\n",
  "09-delivery/D01-发布记录":"# 发布记录\n"
};
const FILES={
"01-governance/G01-sdd-workflow.md":`# 项目研发约定

## 项目特有约束

待核实。

## 验证入口

待核实。

## 发布 / 回滚约束

待核实。

<!-- 只写本项目特有约束；全局 Quick / SDD / Agent 规则由安装的 SDD Skill 维护。 -->
`,
"02-product/P01-product-overview.md":`# 产品总览

## 产品定位与边界

待核实。

## 用户与核心场景

| 用户 / 角色 | 核心场景 | 目标 |
| --- | --- | --- |
| 待核实 | 待核实 | 待核实 |

## 产品架构

[产品架构图](P03-diagrams/P03-01-product-architecture.md)

待核实。

## 模块总览

| 模块 | 职责 | 核心能力 | 主要场景 | 文档 |
| --- | --- | --- | --- | --- |
| 待核实 | 待核实 | 待核实 | 待核实 | [模块目录](P02-modules/index.md) |

## 核心业务流程

[主用户流程](P03-diagrams/P03-02-main-user-flow.md)

待核实。

## 跨模块业务规则

- 待核实。

## 外部系统

| 系统 | 用途 | 交互边界 |
| --- | --- | --- |
| 待核实 | 待核实 | 待核实 |
`,
"02-product/P03-diagrams/P03-01-product-architecture.md":`# 产品架构

\`\`\`mermaid
flowchart TB
    Goal[业务目标]
    Scenario[核心场景]
    Module[产品模块]
    Shared[共享能力]
    Goal --> Scenario --> Module --> Shared
\`\`\`

待核实：替换为真实产品目标、场景、模块和共享能力。
`,
"02-product/P03-diagrams/P03-02-main-user-flow.md":`# 主用户流程

\`\`\`mermaid
flowchart LR
    Start[用户目标] --> Action[核心操作]
    Action --> Result[业务结果]
\`\`\`

待核实：替换为真实端到端用户流程。
`,
"03-architecture/T01-architecture-overview.md":`# 技术架构总览

## 系统范围

待核实。

## 技术 / 应用架构

[应用架构图](T05-diagrams/T05-02-application-architecture.md)

待核实。

## 应用与职责

| 应用 / 模块 | 核心职责 | 上游 | 下游 / 依赖 | 代码入口 |
| --- | --- | --- | --- | --- |
| 待核实 | 待核实 | 待核实 | 待核实 | 待核实 |

## 核心技术栈

| Layer | Technology | Purpose |
| --- | --- | --- |
| 待核实 | 待核实 | 待核实 |

## 应用交互

待核实。

## 外部依赖

| 依赖 | 用途 | 协议 / 边界 |
| --- | --- | --- |
| 待核实 | 待核实 | 待核实 |

## 公共机制

- 鉴权：待核实。
- 事务：待核实。
- 缓存：待核实。
- 消息：待核实。
- 错误处理：待核实。
- 配置：待核实。

## 技术基线入口

- [接口](T02-api.md)
- [数据库](T03-database.md)
- [领域模型](T04-domain-model.md)
- [System Context](T05-diagrams/T05-01-system-context.md)
- [主流程时序](T05-diagrams/T05-03-main-sequence.md)
- [运维](../04-operations/O01-operations-overview.md)
`,
"03-architecture/T02-api.md":`# API

## 公共约定

待核实。

## API List

| Method / Type | Path / Name | Purpose | Auth / Permission |
| --- | --- | --- | --- |
| 待核实 | 待核实 | 待核实 | 待核实 |

## API Details

### 待核实接口

#### Purpose

待核实。

#### Request

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| 待核实 | 待核实 | 待核实 | 待核实 |

#### Response

待核实。

#### Error Codes

| Code | Meaning |
| --- | --- |
| 待核实 | 待核实 |

#### Idempotency

待核实。

#### Compatibility

待核实。
`,
"03-architecture/T03-database.md":`# Database

## Storage Overview

待核实。

## Table List

| Table / Store | Purpose |
| --- | --- |
| 待核实 | 待核实 |

## ER Model

\`\`\`mermaid
erDiagram
    ENTITY {
        string id
    }
\`\`\`

待核实：替换为真实关系。

## 待核实表

### Purpose

待核实。

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| 待核实 | 待核实 | 待核实 | 待核实 | 待核实 |

### Indexes

| Index | Columns | Unique | Purpose |
| --- | --- | --- | --- |
| 待核实 | 待核实 | 待核实 | 待核实 |

### Constraints

- 待核实。

### Relations

- 待核实。

## 一致性规则

- 事务边界：待核实。
- 幂等 / 唯一性：待核实。
- 历史数据兼容：待核实。
`,
"03-architecture/T04-domain-model.md":`# Domain Model

## Domain Overview

\`\`\`mermaid
classDiagram
    class DomainObject
\`\`\`

待核实。

## Aggregates

- 待核实。

## Entities

### DomainObject

- **职责**：待核实。
- **关键属性 / 标识**：待核实。
- **业务规则**：待核实。

## Value Objects

- 待核实。

## Relationships

待核实。

## State Machines

[领域状态机](T05-diagrams/T05-04-domain-state.md)

## Domain Rules / Invariants

- 待核实。

## Domain Events

- 待核实。
`,
"03-architecture/T05-diagrams/T05-01-system-context.md":`# System Context

\`\`\`mermaid
flowchart LR
    User[用户 / 调用方] --> System[系统]
    System --> External[外部系统]
\`\`\`

待核实：替换为真实系统边界和外部参与者。
`,
"03-architecture/T05-diagrams/T05-02-application-architecture.md":`# 应用架构

\`\`\`mermaid
flowchart LR
    Client[调用方]
    App[应用]
    Store[(存储)]
    Client --> App --> Store
\`\`\`

待核实：替换为真实应用、分层、外部依赖和主要交互。
`,
"03-architecture/T05-diagrams/T05-03-main-sequence.md":`# 主流程时序

## Scenario

待核实。

## Sequence

\`\`\`mermaid
sequenceDiagram
    actor User
    participant App
    participant Store
    User->>App: 核心操作
    App->>Store: 读取 / 写入
    Store-->>App: 结果
    App-->>User: 可观察结果
\`\`\`

## Key Rules

- 待核实。

## Related Components

- 待核实。
`,
"03-architecture/T05-diagrams/T05-04-domain-state.md":`# 领域状态机

\`\`\`mermaid
stateDiagram-v2
    [*] --> Unknown
\`\`\`

待核实：替换为真实核心对象状态机；没有生命周期的对象不要发明状态。
`,
"04-operations/O01-operations-overview.md":`# Operations Overview

## Environments

| Environment | Purpose |
| --- | --- |
| 待核实 | 待核实 |

## Deployment Architecture

[部署架构图](O03-diagrams/O03-01-deployment-architecture.md)

## Configuration

待核实。

## Network

待核实。

## Observability

### Logs

待核实。

### Metrics

待核实。

### Tracing

待核实。

### Alerts

待核实。

## Backup & Recovery

待核实。

## Security

待核实。

## Common Operations

[逐应用运行说明](O02-applications/index.md)
`,
"04-operations/O03-diagrams/O03-01-deployment-architecture.md":`# 部署架构

\`\`\`mermaid
flowchart LR
    Host[Host]
    App[Application / Container]
    Store[(Persistent Store)]
    Host --> App --> Store
\`\`\`

待核实：替换为真实主机、容器、网络、端口、持久化和依赖。
`,
"08-quality/Q01-validation.md":`# Validation

## Validation Scope

待核实。

## Validation Entry Point

待核实：填写项目内一个版本化验证入口，例如 \`npm test\`。入口负责串行执行本项目全部 required checks，任一失败返回非零。

## Required Checks

| Check | Command / Method |
| --- | --- |
| Build | 待核实 |
| Unit Test | 待核实 |
| Integration Test | 待核实 |
| Lint / Static Check | 待核实 |

## Quality Gates

- 最终集成验证必须通过 Validation Entry Point；自然语言“pass”不能替代机器 receipt。
- 待核实项目特有门禁。

## Release Validation

- 待核实。

## Known Exceptions

- 无。
`
};
function itemCode(name){const m=name.match(new RegExp("^("+CODE+")-"));if(!m)throw new Error("Invalid scaffold code: "+name);return m[1];}
function refresh(directory){
  const index=path.join(directory,"index.md");
  let old=fs.existsSync(index)?fs.readFileSync(index,"utf8"):"# "+path.basename(directory)+"\n";
  const begin="<!-- INDEX:BEGIN -->",end="<!-- INDEX:END -->";
  const links=fs.readdirSync(directory,{withFileTypes:true}).filter(e=>e.name!=="index.md"&&!e.name.startsWith(".")).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>"- ["+e.name+"]("+e.name+(e.isDirectory()?"/index.md":"")+")").join("\n");
  const block=begin+"\n"+links+"\n"+end;
  if(old.includes(begin)){
    if((old.match(/<!-- INDEX:BEGIN -->/g)||[]).length!==1||(old.match(/<!-- INDEX:END -->/g)||[]).length!==1||old.indexOf(end)<old.indexOf(begin))throw new Error("Invalid index markers: "+index);
    old=old.slice(0,old.indexOf(begin))+block+old.slice(old.indexOf(end)+end.length);
  }else old=old.trimEnd()+"\n\n"+block+"\n";
  atomicWrite(index,old);
}
function allDirectories(root){const out=[root];for(const e of fs.readdirSync(root,{withFileTypes:true}))if(e.isDirectory())out.push(...allDirectories(path.join(root,e.name)));return out;}
export async function initializeProject(root){
  root=path.resolve(root);
  return withProjectLock(root,async()=>{
    if(!fs.existsSync(root))fs.mkdirSync(root,{recursive:true});
    const docs=inside(root,"docs"),agents=inside(root,"AGENTS.md");
    if(fs.existsSync(agents)&&!fs.statSync(agents).isFile())throw new Error("AGENTS.md must be a regular file");
    const projectRules=fs.existsSync(agents)?null:fs.readFileSync(PROJECT_AGENTS_TEMPLATE,"utf8");
    for(const relative of [...Object.keys(DIRECTORIES),...Object.keys(FILES)]){
      const target=inside(root,"docs",relative);
      if(fs.existsSync(target)){
        const shouldDir=Object.hasOwn(DIRECTORIES,relative);
        if(fs.statSync(target).isDirectory()!==shouldDir)throw new Error("Conflicting path type: "+target);
      }else if(fs.existsSync(path.dirname(target))){
        const code=itemCode(path.basename(target));
        for(const sibling of fs.readdirSync(path.dirname(target))){
          const m=sibling.match(new RegExp("^("+CODE+")-"));
          if(m&&m[1]===code)throw new Error("Number occupied; reconcile existing content first: "+target);
        }
      }
    }
    fs.mkdirSync(docs,{recursive:true});for(const area of AREAS)fs.mkdirSync(inside(root,"docs",area),{recursive:true});
    const docsIndex=path.join(docs,"index.md");
    if(!fs.existsSync(docsIndex))createText(docsIndex,`# Project Documentation

## Current Truth

- [Product](02-product/index.md)
- [Architecture](03-architecture/index.md)
- [Operations](04-operations/index.md)

## Engineering Records

- [Governance](01-governance/index.md)
- [Changes](05-changes/index.md)
- [Decisions](06-decisions/index.md)
- [Research](07-research/index.md)
- [Quality](08-quality/index.md)
- [Delivery](09-delivery/index.md)
`);
    for(const [relative,title] of Object.entries(DIRECTORIES)){
      const directory=inside(root,"docs",relative);fs.mkdirSync(directory,{recursive:true});
      const index=path.join(directory,"index.md");if(!fs.existsSync(index))createText(index,title);
    }
    for(const [relative,text] of Object.entries(FILES)){const target=inside(root,"docs",relative);if(!fs.existsSync(target))createText(target,text);}
    for(const directory of allDirectories(docs).sort((a,b)=>b.split(path.sep).length-a.split(path.sep).length))refresh(directory);
    if(projectRules!==null)createText(agents,projectRules);
    return root;
  });
}
