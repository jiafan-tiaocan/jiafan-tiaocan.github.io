---
title: Palantir Ontology：为什么企业 AI 需要一层可执行的业务本体
aliases:
  - Palantir Ontology 深度研究
  - 企业运营本体
description: 从对象、关系、函数、动作与安全出发，拆解 Palantir Ontology 如何把企业数据变成可运行的业务模型，以及它对企业 Agent、MCP、权限治理和平台建设的启示。
status: active
owner: 贾凡
created_at: 2026-08-25
updated_at: 2026-08-25
review_after: 2026-11-25
noteType: technical
date: 2026-08-25
publish: true
tags:
  - Palantir
  - Ontology
  - 企业AI
  - Agent
  - MCP
  - AI-native
---

# Palantir Ontology：为什么企业 AI 需要一层可执行的业务本体

> 研究基线：2026-08-25。本文优先使用 Palantir 官方产品文档、2025 财年 10-K 与 W3C 标准。官方资料可以证明产品定义和公开能力，不能独立证明实施效果、部署成本或所有功能在每个租户中的可用性。

## 一、结论先行

Palantir 最值得研究的并不是某个知识图谱界面或 Agent 框架，而是一种构造企业软件的核心方法：在原始数据系统与具体应用之间建立一层可持续演进的“运营本体”（operational ontology），把组织中的人、项目、订单、设备、任务、风险和证据等真实事物建模为对象，把业务关系建模为链接，把可执行操作建模为动作，把判断和计算建模为函数，再让权限、审计、应用和 AI Agent 共同依赖这套统一语义。

Palantir 官方把 Ontology 定义为组织的 operational layer，并在许多场景中将其视为组织的数字孪生。它不只包含对象、属性和关系等“语义元素”，还包含动作、函数和动态安全等“动力元素”。[Palantir Ontology Overview](https://www.palantir.com/docs/foundry/ontology/overview)

这也是它与普通数据库模型、数据仓库语义层和知识图谱最大的差异：普通语义层主要帮助人和机器理解“有什么”，Palantir Ontology 还规定“可以做什么、谁能做、在什么条件下做、做完影响哪些系统、如何留下证据”。

因此，“Palantir 把组织的项目转成了本体”抓住了方向，但还不够准确：

1. 它不是把项目文档自动转换成静态图谱，而是把正在运行的组织现实映射成具有稳定身份、实时状态和数据来源的对象。
2. 项目只是对象类型之一。完整模型还会包含人员、角色、系统、任务、运行、产物、证据、风险、决策、策略和指标。
3. 对象和关系只是组织的“名词”；真正让本体成为运营系统的是动作、函数、权限、事件、写回与应用，也就是组织的“动词”和约束。
4. 本体不是一次性建模成果。它必须像代码一样拥有负责人、版本、评审、迁移、测试、发布和废弃机制。

对于企业 AI，运营本体最重要的价值是成为人类、工作流与 Agent 之间稳定的组织接口。Agent 不再接收一堆临时拼接的文档和底层 API，而是围绕稳定对象读取状态，通过被授权的业务动作改变现实，通过函数获得判断，通过证据证明结果，并把执行产生的新事实回流到同一个模型。

## 二、为什么 Ontology 是 Palantir 的核心

### 2.1 四个平台与 Ontology 的位置

Palantir 在 2025 财年 10-K 中将主要软件划分为四个平台：

| 平台 | 主要角色 | 与 Ontology 的关系 |
|---|---|---|
| Gotham | 国防、情报与任务运营 | 用共同对象和行动模型形成任务态势与执行闭环 |
| Foundry | 企业数据运营平台 | 提供数据集成、逻辑、Ontology、分析、应用和工作流基础 |
| AIP | 生成式 AI、Agent、自动化和评估 | 让模型在 Ontology 定义的数据、逻辑、动作与安全边界上工作 |
| Apollo | 跨云、本地和边缘环境的软件交付控制面 | 持续发布平台与客户软件，保证不同环境中的运行一致性 |

Ontology 位于 Foundry 的中心，又被 Gotham、AIP 和具体应用共同消费：

- Foundry 把分散的数据源、逻辑和模型接入平台；
- Ontology 把技术资产翻译成业务对象与可执行能力；
- Object Explorer、Workshop、SDK 和自定义应用把对象呈现给用户；
- AIP 和 Agent 在同一对象、动作和权限边界内理解并改变业务；
- Apollo 解决跨环境持续交付。

Palantir 的 10-K 把 Ontology 描述为其平台的“心脏”，强调它把数据、逻辑和动作组合成组织的基础表达。[Palantir 2025 Form 10-K，第 3—5 页](https://investors.palantir.com/files/2025%20FY%20PLTR%2010-K.pdf)

这套结构对应一个普遍存在的企业问题：企业并不缺数据库、报表或模型，真正缺的是从信息到决定，再从决定到受控行动的稳定闭环。数据工程师看到表和字段，业务人员看到客户、订单和项目，Agent 则需要知道哪些对象与当前目标相关、能调用什么动作、什么状态算完成。如果每个应用都重新翻译一遍，组织会不断复制业务逻辑、权限和集成代码；如果在本体层统一表达，上层的人、应用与 Agent 就可以共享同一套操作对象。

### 2.2 一次企业决策的四个组成部分

Palantir 将一次运营决策拆成四部分：

- Data：作出判断所依据的事实、状态和历史数据；
- Logic：规则、计算、启发式方法、优化器、传统模型或大模型推理；
- Action：把选择变成对象修改、通知、审批、外部 API 调用或源系统写回；
- Security：保证读取、逻辑执行与实际动作符合权限和治理要求。

官方强调，只有把 Action 闭环纳入，分析系统才真正转化为运营系统；如果对象是组织的名词，Actions 就是组织的动词。[Why create an Ontology?](https://www.palantir.com/docs/foundry/ontology/why-ontology)

这个区分对企业 Agent 尤其关键。大模型主要提供不确定性的推理能力，但企业工作需要确定的身份、对象、权限、状态转换和副作用控制。把所有约束写进 prompt 只能得到软约束；把动作、提交条件、对象权限和写回路径放在模型之外，才能形成系统约束。

## 三、Ontology 的基本构件

### 3.1 Object Type、Object 与 Property

Object Type 是业务对象的类型定义，例如 `Project`、`Claim`、`System`、`WorkItem`、`Agent`。Object 是具体实例，例如某个项目或理赔单。Property 是实例上的属性，例如状态、负责人、优先级、金额和更新时间。

Palantir 的 Object Type 通常映射到底层数据源。每个对象必须有稳定且唯一的主键，并有用于界面展示的 title key。官方文档特别警告，非确定性主键会导致编辑丢失或链接消失。这说明本体不是在表上临时贴一层名称，而是要求现实实体具有跨系统、跨时间稳定的身份。[Create an object type](https://www.palantir.com/docs/foundry/object-link-types/create-object-type/index.html)

在实际系统中，不能依赖标题或文件路径作为长期身份。应定义规范 ID、来源系统 ID 和实体合并规则，否则同一个需求会在 Jira、Git、测试平台和知识库中变成几个彼此不认识的对象。

### 3.2 Link Type

Link Type 表达对象之间有业务意义的关系，而不是任意相似度：

```text
Project ─CONTAINS→ WorkItem ─TARGETS→ System
WorkItem ─HAS_RUN→ TaskRun ─EXECUTED_BY→ Agent
TaskRun ─PRODUCED→ Artifact ─SUPPORTED_BY→ Evidence
TaskRun ─REQUESTED→ ActionRequest ─RESOLVED_BY→ Decision
KnowledgeItem ─APPLIES_TO→ System / WorkItem.type
```

关系应该能回答业务问题或支持动作，不应为了让图看起来丰富而无限扩张。若一条关系没有负责人、来源、用途或更新机制，它通常只是可视化装饰。

### 3.3 Interface 与共享能力

Palantir 的 Interface 描述一组对象共有的形状与能力，让不同 Object Type 可以多态地被应用和函数处理。例如不同类型的工作项可以实现 `Assignable`、`EvidenceBearing` 或 `RiskGoverned` 接口。[Ontology Overview](https://www.palantir.com/docs/foundry/ontology/overview)

| 接口 | 最小属性或能力 | 可能的实现对象 |
|---|---|---|
| `Assignable` | owner、status、dueAt；assign、unassign | Requirement、TestTask、ClaimTask |
| `Executable` | goal、state、budget；start、pause、resume、cancel | TaskRun、WorkflowRun |
| `EvidenceBearing` | acceptanceCriteria；attachEvidence、verify | WorkItem、Artifact、Decision |
| `GovernedActionTarget` | riskLevel、approvalPolicy；requestAction | Release、Claim、KnowledgeChange |
| `KnowledgeScoped` | scope、version、validFrom、validTo | Policy、KnowledgeItem、Skill |

共享底座因此可以依赖小接口，而不是依赖每个业务域的内部字段。这样既能跨场景复用，也避免过早建立覆盖所有岗位的超级数据模型。

### 3.4 Action Type：把字段修改提升为业务动作

Palantir 的 Action 不是“把某字段从 A 改成 B”的通用接口，而是带有业务意图的事务。例如 `Assign Employee` 可以同时修改员工角色、建立与新经理的关系、通知新旧经理，并验证执行者是否属于 HR。一个 Action Type 定义输入参数、对象与链接的修改规则、提交条件以及通知或 Webhook 等副作用。[Action Types Overview](https://www.palantir.com/docs/foundry/action-types/overview)

Action rules 可以创建、修改或删除对象和链接，也可以触发通知、Webhook 或调度任务。[Action Rules](https://www.palantir.com/docs/foundry/action-types/rules) 当外部 ERP、GitLab 或业务核心仍是事实源时，Action 可以通过 Webhook 把决定写回这些系统；Palantir 将这个模式称为 decision orchestration。[Action side effects](https://www.palantir.com/docs/foundry/action-types/side-effects-overview)

对 Agent 系统而言，动作层应成为唯一受支持的业务写入口。工具不应是 `updateObject` 或任意 `httpRequest`，而应是：

- `AcceptWorkItem`：校验身份、职责、依赖和预算后领取任务；
- `StartTaskRun`：冻结本次工作契约版本并建立运行记录；
- `SubmitResult`：提交产物、证据和完成声明，但不自动等价于验收；
- `RequestApproval`：对发布、赔付、知识生效等高风险操作请求批准；
- `ApproveAndExecute`：由授权角色批准并触发外部系统写回；
- `EscalateException`：记录异常、尝试、影响范围和所需决定；
- `PromoteKnowledge`：把候选经验经过审核后升级为有效知识。

这种设计能防止 Agent 绕过工作流直接修改状态，也让人类、确定性 workflow 和 Agent 复用同一业务动作。

### 3.5 Function：把组织逻辑放在稳定接口之后

Functions 用于读取对象、遍历关系、聚合状态、调用模型、计算指标或生成复杂编辑。Palantir Functions 支持 TypeScript 和 Python，可在隔离的服务端环境中运行，并原生读写 Ontology。[Functions Overview](https://www.palantir.com/docs/foundry/functions/overview)

典型函数包括：

- `assembleTaskContext(workItemId, actorId)`：只返回当前身份可见、与任务相关且在有效期内的上下文；
- `checkReadiness(workItemId)`：计算依赖、验收标准、环境和权限是否齐备；
- `evaluateResult(taskRunId)`：聚合测试、规则检查、人工复核与线上观测；
- `calculateActionRisk(actionRequestId)`：根据数据等级、影响范围和可逆性计算风险；
- `findApplicableKnowledge(systemId, taskType, time)`：按范围、版本和时间筛选知识；
- `recommendNextAction(workItemId)`：可以使用规则、优化器或 LLM，但只返回建议或受限动作候选。

函数与动作应该分开：函数负责判断和计算，动作负责受控改变现实。即使函数内部调用大模型，最终写操作仍应经过动作权限、提交条件和审计。

### 3.6 Security：权限是本体的一部分

Palantir 将 Ontology resource 与对象数据区分授权：能看到某个 Object Type 的模式，不代表能看到具体对象；读取对象还取决于底层数据源权限或对象、属性安全策略。[Object Permissioning Overview](https://www.palantir.com/docs/foundry/object-permissioning/overview)

项目角色提供自主访问控制，Markings 提供不能被普通资源 Owner 绕过的强制资格约束。一个资源有多个 Marking 时，访问者必须同时满足全部条件。[Markings](https://www.palantir.com/docs/foundry/security/markings/index.html)

Action 还有独立 submission criteria，可以同时检查当前用户、输入参数、目标对象状态和关系；条件失败时，所有应用都会得到一致的阻止原因。[Action submission criteria](https://www.palantir.com/docs/foundry/action-types/submission-criteria)

企业 Agent 的权限至少需要五层：

1. 身份资格：这个人或 Agent 是谁，属于哪个组织、角色和环境；
2. 对象可见性：可以看到哪些项目、系统和任务实例；
3. 属性可见性：对象可见时，哪些字段仍然需要脱敏；
4. 动作能力：可以申请、模拟或执行哪些业务动作；
5. 条件性授权：同一动作是否因为金额、环境、影响范围、时间和状态而需要升级。

Agent 的权限必须绑定 Non-Human Identity，而不是继承某个开发者或管理员的长期凭据。读取权限、动作权限和审批权限也不能合并成一个“Agent 可用”开关。

## 四、它与相邻技术有什么不同

| 技术 | 主要回答 | 擅长 | 为什么不能替代运营本体 |
|---|---|---|---|
| 数据库 Schema / ORM | 数据如何存 | 一致性、查询、事务 | 以单个应用和存储为中心，通常不统一跨系统身份、动作与治理 |
| 数据仓库语义层 | 指标如何统一计算 | BI 指标、维度、口径 | 主要支持读取和分析，缺少业务动作、状态迁移与写回 |
| 数据目录 | 数据在哪里、由谁负责 | 发现、血缘、治理元数据 | 描述数据资产，不直接表达真实对象的可执行行为 |
| 知识图谱 / RDF / OWL | 概念与关系如何形式化 | 跨域语义、推理、互操作 | 通常不自带企业动作事务、应用工作流和动态权限闭环 |
| Workflow / BPM | 流程下一步是什么 | 确定性编排、审批、重试 | 流程常拥有自己的局部数据模型，难成为组织共同对象层 |
| MCP | 工具与上下文如何暴露给模型 | 协议化发现与调用 | MCP 不定义业务对象、真相来源和动作合法性 |
| 向量库 / RAG | 哪些文本与问题相似 | 非结构化检索 | 相似文本不是权威状态，也不能决定可执行动作 |
| Palantir 式运营本体 | 什么正在发生，谁能如何改变它 | 对象、逻辑、动作、安全与应用 | 它是组合层，需要上述技术作为底层能力 |

W3C 的 OWL 2 是面向语义网、具有形式化语义的本体语言，支持类、属性、个体以及基于描述逻辑的推理。[W3C OWL 2 Overview](https://www.w3.org/TR/owl2-overview/) Palantir 使用“Ontology”一词，但其公开文档的产品重心是绑定真实数据源、动作、函数、权限和运营应用。因此，不能默认把 Palantir Ontology 等同于 RDF 三元组库或 OWL reasoner，也不应为了学习 Palantir 就先引入复杂图数据库。

## 五、为什么它适合成为 Agent 的组织接口

### 5.1 Agent 的真正瓶颈不是 token，而是世界模型不稳定

通用 Agent 常见的上下文装配方式是：搜索文档、读取任务描述、调用若干 API、把结果拼进 prompt，然后让模型决定下一步。这个方案在单次任务上可用，规模化后却会出现四类问题：

- 同一个业务概念在不同工具中名称和身份不一致；
- 当前状态、历史事实、建议文本和权威规则混在一起；
- 工具暴露的是底层 CRUD，而不是带约束的业务动作；
- 每个 Agent 都重复实现关联查询、权限判断、状态转换和审计。

运营本体把这些问题前移到平台层。Agent 看到的是稳定对象与关系，读取的是经过权限裁剪的当前状态，调用的是业务动作，运行结果进入统一证据链。模型供应商或 harness 可以更换，组织接口仍然稳定。

### 5.2 任务、运行、结果与验收必须分层

首批对象通常不需要很多：

| 对象 | 核心含义 |
|---|---|
| `Project` | 持续存在的交付与治理边界 |
| `System` | 被开发、测试或操作的真实系统 |
| `WorkItem` | 需要交付和验收的业务工作项 |
| `WorkContractVersion` | 某次任务实际使用的职责、资源、结果和汇报契约 |
| `Agent` | 稳定的非人身份与能力配置 |
| `TaskRun` | 一次具体执行，不等于工作项本身 |
| `Artifact` | 代码、测试、报告或业务结果 |
| `Evidence` | 支持或反驳结果声明的证据 |
| `ActionRequest` | 对真实系统变更的受控请求 |
| `Decision` | 人或策略对候选动作作出的决定 |
| `Exception` | 无法在授权范围内解决的异常 |
| `KnowledgeItem` | 经审核、带适用范围和时效的知识 |

`WorkItem` 与 `TaskRun` 必须分层。一个工作项可以有多次运行，一次运行成功不等于工作项已经验收。

```text
WorkItem: proposed → ready → in_progress → in_review → accepted
                              └────────────→ blocked / cancelled

TaskRun: queued → preparing → running → examining → succeeded
             └──────────────→ failed / paused / cancelled / expired

ActionRequest: draft → submitted → approved → executing → applied
                           └──────→ rejected / expired / failed
```

每次状态迁移都应通过命名 Action 发生，并记录 actor、原因、前置状态、结果、时间与关联证据。禁止客户端或 Agent 直接写 `status` 字段。

### 5.3 MCP 是本体的消费协议，不是本体本身

Palantir 目前区分两类 MCP：Palantir MCP 面向平台建设者，可搜索和修改 Ontology 类型、项目与代码，但不能直接写生产 Ontology 数据；Ontology MCP 面向本体消费者，把被选择的 Object Types、Action Types 与 Query Functions 暴露成工具，让外部 Agent 通过受限动作读写数据。[Palantir MCP Overview](https://www.palantir.com/docs/foundry/palantir-mcp/overview)

Ontology MCP 的参考架构显示，外部 Agent 可以用 SQL 工具读取被暴露的对象，用独立 Action 工具执行写操作，用 Query Function 获取定制计算；应用限制决定 Agent 能看到哪些能力。[Ontology MCP sample architecture](https://www.palantir.com/docs/foundry/ontology-mcp/sample-architecture)

因此，MCP Server 应从本体定义生成或绑定工具，而不是手工把所有数据库表与内部 API 暴露给 Agent。工具名应是 `submit_result`、`request_release`、`escalate_exception`，而不是 `update_task_row` 或任意 `http_request`。

## 六、无需复制 Foundry 的最小参考架构

```text
源系统层
Jira / Git / CI / 测试平台 / CMDB / ERP / 知识库
        │ Connector / CDC / Webhook / 定时同步
        ▼
事实与身份层
规范 ID、来源记录、数据质量、时间版本、冲突处理
        ▼
运营本体服务
Type Registry │ Object/Link Query │ State Machine │ Function Registry
        │
        ├── Policy Engine：对象、属性、动作、条件性授权
        ├── Action Gateway：校验、幂等、审批、外部写回、补偿
        ├── Event & Audit：事实事件、决定、证据、血缘
        └── Evaluation：规则、测试、模型评估、人工复核
        │
        ├── 人类应用：任务台、对象视图、审批台、运营看板
        └── Agent 接口：typed SDK / MCP / context assembler
```

首版完全可以使用关系数据库保存对象和关系，以 JSON Schema、OpenAPI 或代码类型定义模式，以应用服务实现动作，以现有 IAM 和策略引擎做授权，以消息表或事件总线保存事件。只有跨域关系查询、复杂推理或数据规模证明关系数据库不够时，才考虑图数据库或 OWL/RDF。

从第一天必须保留的不是“图”，而是以下不变量：

- 稳定对象身份与来源；
- 类型化对象、链接、函数和动作；
- 工作项与运行实例分离；
- 所有状态变化通过动作；
- 权限在对象与动作层执行；
- 产物、证据、决定和知识可追溯；
- 模式与动作有版本、评审、迁移和回滚；
- 人类应用与 Agent 使用同一业务接口。

## 七、Palantir 值得学习的治理细节

### 7.1 Ontology 也需要分支、评审和发布

Ontology 变化会同时影响数据映射、函数、Actions、应用与 Agent 工具。Palantir 的 Global Branching 允许在隔离分支修改数据管道与 Ontology、执行端到端测试，再通过 proposal 和 reviewer 合并；受保护的 Object、Action、Link 和 Interface 必须在分支修改。[Global Branching Overview](https://www.palantir.com/docs/foundry/global-branching/overview)

无论是否使用 Palantir，本体定义都应该进入 Git 或同等级版本系统，并具备兼容性检查、测试数据回放、动作契约测试、权限差异检查、迁移脚本、审批和可回滚发布。

### 7.2 Object View 让对象成为协作入口

Palantir 为每种 Object Type 自动提供标准 Object View，并允许构造面向具体工作流的配置视图。视图可以展示属性、关联对象和相关应用。[Object Views Overview](https://www.palantir.com/docs/foundry/object-views/overview)

这提供了一种不同于“功能菜单”和“聊天会话”的界面组织方式：打开一个工作项时，可以同时看到目标、依赖、运行、产物、证据、异常、可执行动作和相关知识。界面围绕业务对象组织，而不是围绕微服务或 Agent 会话组织。

### 7.3 Automation 监听对象状态，而不是扫描文本

Palantir Automate 可以按照时间或 Ontology 对象条件持续触发，例如出现新的高优先级 `Alert` 时执行 Action、Function、AIP Logic 或通知。[Automate Overview](https://www.palantir.com/docs/foundry/automate/overview)

企业 Agent 的持续工作也应该采用相同原则：监听权威对象状态与事件，通过确定触发条件创建任务，再由 Agent 处理需要动态判断的部分。不要让 Agent 无边界扫描知识库和业务系统，自行猜测是否有工作。

### 7.4 Scenario 把计划与现实修改隔离

Palantir Scenario 可以把一组 Action 应用在 Ontology 分支上，用于 what-if 分析而不改变主状态。[Workshop Scenarios](https://www.palantir.com/docs/foundry/workshop/scenarios-overview) 对高风险动作，可以引入 `simulate → evaluate → approve → apply` 路径：Agent 先生成影响预测，评测和人类审批通过后才提交真实动作。

### 7.5 Evals 是 AI 逻辑的发布门禁

AIP Evals 允许为函数建立测试用例、评价函数、指标阈值和多次运行比较，用来处理 LLM 非确定性并比较不同版本或模型。[AIP Evals Overview](https://www.palantir.com/docs/foundry/aip-evals/overview)

Agent 使用的函数、提示、模型和工具集合都应有版本，发布前用同一评测集比较质量、方差、成本和失败类型。“任务完成”必须由外部证据支持，不能只依赖 Agent 自报成功。

## 八、购买 Palantir，还是只学习它

### 8.1 适合正式评估 Palantir 的条件

只有同时出现以下多项条件，才值得进入正式产品评估：

- 需要连接大量异构系统，并快速形成跨部门共同运营视图；
- 数据和动作权限复杂，存在行列级、用途级、强制标记或高强度审计；
- 数据工程、分析、模型、低代码应用、Agent 和 DevOps 需要在统一平台协同；
- 部署跨云、本地、隔离网或边缘环境，平台持续交付本身是核心问题；
- 存在明确的高价值业务闭环，平台成本相对业务收益可接受；
- 组织愿意配置长期的领域建模、数据治理、产品和平台团队，而不是把本体视为一次性咨询交付。

Palantir 2025 年 10-K 显示，其专业服务包括持续的 ontology 和 data modeling 支持，这说明本体建设并非安装软件后自动完成。同一文件披露，前二十名客户的平均年收入为 9,390 万美元。这个数字不是产品报价，却说明大型合作的规模和组织投入不能按普通 SaaS 订阅理解。[Palantir 2025 Form 10-K，第 67、93 页](https://investors.palantir.com/files/2025%20FY%20PLTR%2010-K.pdf)

### 8.2 更稳妥的起点是最小垂直闭环

在场景、基线、验收人和业务收益尚未明确时，直接购买重型平台会把“是否存在值得解决的闭环”与“如何部署平台”混为一谈。更稳妥的方式是先用最小实现验证：

1. 统一对象模型能否减少 Agent 的上下文拼装和跨系统适配；
2. 命名 Actions 与证据模型能否提高可控性、验收质量和审计能力；
3. 第二个真实场景能否复用首个场景的接口、状态、动作和治理能力。

如果第一条垂直链路都不能产生可测价值，建设企业级 Ontology 只会形成另一套无人维护的元数据平台。

### 8.3 需要警惕的锁定面

- 模式锁定：应用和 SDK 依赖 Ontology API name，跨环境命名冲突可能破坏应用；
- 逻辑锁定：Actions、Functions、Workshop、Automate 和权限策略共同构成运行时，迁移成本不只在数据导出；
- 组织锁定：日常流程、对象命名和决策习惯一旦依赖平台，替换意味着重新设计工作方式；
- 服务依赖：复杂落地需要持续的领域建模能力，而非只有软件许可证。

任何候选平台都应该回答：对象、关系、动作定义和审计数据如何导出；外部应用能否通过标准 API/SDK 工作；身份和策略能否与既有 IAM 对接；停用平台后权威系统如何继续运行；关键业务动作能否保留在可替换的外部服务中。

## 九、一个 90 天引入路线

### 阶段 0：两周内完成场景与语义发现

选择一个真实任务，记录从输入到验收的现实链路。只定义 8—12 个对象、10—20 条关键关系和 5—8 个动作，并明确哪些系统仍是事实源。

验收标准：能够用一张对象—动作图解释一次真实任务，不依赖“AI 会自己理解”补洞。

### 阶段 1：第 3—6 周完成只读对象层与对象视图

接入任务系统、运行平台、Git/CI 或首个业务系统，建立规范 ID、来源、时间戳和数据质量告警；做一个工作项对象页，聚合契约、运行、产物和证据。

验收标准：用户无需切换多个系统即可回答“现在发生了什么、卡在哪里、依据是什么”，且关键事实都能回到来源。

### 阶段 2：第 7—10 周完成受控动作与 Agent 接入

实现领取、启动、提交结果、升级异常和请求批准等最小动作；通过 typed SDK 或 MCP 暴露给一个 Agent harness；使用 Non-Human Identity、最小权限、幂等键与完整审计。

验收标准：Agent 不使用通用数据库写权限即可完成真实任务；所有状态变化都能追溯到动作、执行者、策略版本和证据。

### 阶段 3：第 11—13 周完成评测与复用判断

运行同类真实任务，对照人工基线比较周期、人工操作、一次验收通过率、失败恢复和成本；再尝试将第二个相邻任务接入同一接口。

验收标准：至少一个价值指标可复现改善，关键质量指标不劣化；能够区分真正跨场景共享的对象和动作与必须留在业务域内的语义。

## 十、常见反模式

### 10.1 把 Ontology 当作全公司名词词典

只有对象和关系、没有动作和用户工作流的本体会退化成昂贵的数据目录。每个类型都应该回答：谁在什么决定中使用它，它支持什么动作，状态如何更新，价值如何衡量。

### 10.2 从数据表自底向上生成全部对象

自动映射每张表只会把历史系统结构复制到新平台。应从业务决定和行动闭环出发，再映射必要数据。表字段可以有数千个，真正需要进入运营接口的核心属性往往只有几十个。

### 10.3 建立万能 `Task` 和万能 `Action`

一个含有几百个可空字段的任务对象会抹掉业务语义；一个通用 `execute(tool, payload)` 动作会绕过治理。共享应该通过小接口与明确动作形成，而不是通过超级对象形成。

### 10.4 让 Agent 直接维护生产本体

Agent 可以生成类型或动作变更提案、补充描述、发现冲突，但不能未经审查修改生产本体。Palantir 自己的 MCP 安全说明也要求 Ontology 修改通过 proposal review，并由人合并到主分支。[Palantir MCP Security](https://www.palantir.com/docs/foundry/palantir-mcp/security)

### 10.5 把推理结果当成权威事实

模型建议、预测、人工决定和源系统事实必须拥有不同 provenance。建议可以触发 `ActionRequest`，但只有动作成功写回后，现实状态才真正改变。

### 10.6 忽略时间与版本

业务规则、知识、组织关系和对象属性都会变化。若只保存当前值，就无法回答“当时依据什么规则作出决定”。契约、策略、知识和模型都必须可以引用具体版本；审计记录必须保留运行时的有效版本。

## 十一、最终判断

Palantir Ontology 的关键创新不是发明“对象和关系”，而是把语义、逻辑、动作、安全、应用和 Agent 组织进同一个运营闭环。它给企业 AI 的核心启示可以压缩成五句话：

1. 先建立稳定的业务对象与身份，再讨论给模型多少上下文。
2. 把组织动作建模为带权限、条件、事务和审计的业务能力，而不是给 Agent 底层 CRUD。
3. 让人、workflow 和 Agent 使用同一对象、函数和动作接口。
4. 把产物、证据、决定、知识与时间版本纳入模型，任务完成不能依赖 Agent 自报。
5. 从一个可验证的垂直闭环开始；只有第二个场景证明能够复用时，平台化才有意义。

是否购买 Palantir 是商业与架构决策，不能仅凭概念先进性决定。但无论采用 Palantir、其他平台还是自建最小实现，“可执行的业务本体”都会逐渐成为企业 Agent 从演示走向真实运营时绕不开的一层。

## 主要资料

- [Palantir Ontology Overview](https://www.palantir.com/docs/foundry/ontology/overview)
- [Why create an Ontology?](https://www.palantir.com/docs/foundry/ontology/why-ontology)
- [Action Types Overview](https://www.palantir.com/docs/foundry/action-types/overview)
- [Functions Overview](https://www.palantir.com/docs/foundry/functions/overview)
- [Object Permissioning Overview](https://www.palantir.com/docs/foundry/object-permissioning/overview)
- [AIP Overview](https://www.palantir.com/docs/foundry/aip)
- [Palantir MCP Overview](https://www.palantir.com/docs/foundry/palantir-mcp/overview)
- [Ontology MCP sample architecture](https://www.palantir.com/docs/foundry/ontology-mcp/sample-architecture)
- [Global Branching](https://www.palantir.com/docs/foundry/global-branching/overview)
- [Palantir 2025 Form 10-K](https://investors.palantir.com/files/2025%20FY%20PLTR%2010-K.pdf)
- [W3C OWL 2 Overview](https://www.w3.org/TR/owl2-overview/)

