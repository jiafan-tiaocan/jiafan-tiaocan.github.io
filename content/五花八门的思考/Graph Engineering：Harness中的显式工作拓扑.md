---
title: Graph Engineering 与 Dynamic Workflow：把 Agent 拓扑编译成可执行程序
description: 从 Claude Code Dynamic Workflow 出发，解释 Workflow 作为图程序、Graph Engineering 作为拓扑治理，以及 Harness 如何强制节点、边、循环、预算与完成条件。
tags:
  - Graph-Engineering
  - Workflow
  - Claude-Code
  - Agent-Runtime
  - Harness
noteType: technical
date: 2026-07-26
last_verified: 2026-07-27
publish: true
---

# Graph Engineering 与 Dynamic Workflow：把 Agent 拓扑编译成可执行程序

[![从隐式 Agent Loop 到受约束的动态 Workflow：控制流逐步移出模型上下文，最终由 Graph Engineering 管理图的生成、验证、执行和改进](assets/graph-engineering-workflow/01-evolution-route.svg)](assets/graph-engineering-workflow/01-evolution-route.svg)

*图 1　从隐式 Agent Loop 到受约束的动态 Workflow。演进的重点不是用 Graph 淘汰 Loop，而是让控制流获得模型上下文之外的可执行载体，并进一步验证这个载体。本文归纳，依据 [Anthropic 的 Agent 工作流模式](https://www.anthropic.com/engineering/building-effective-agents)、[Claude Code Dynamic Workflow 文档](https://code.claude.com/docs/en/workflows)和 [Agentic Computation Graphs 综述](https://arxiv.org/abs/2603.22386)。*

Agent 系统最初依赖模型在上下文中临场决定下一步。随后，工程师开始用状态机、DAG 和编排代码固定关键路径。Claude Code 的 Dynamic Workflow 又向前走了一步：模型根据当前任务生成 JavaScript 编排程序，独立 Runtime 再执行这个程序，批量启动 Agent、保存中间结果并完成复核。

这使 Graph Engineering 获得了更具体的工程对象。需要管理的不再只是一张人工设计的图，而是从任务意图生成的 Workflow、单次运行实例化的 Graph，以及执行过程中产生的 Trace。

核心关系可以先压缩成一句话：

> **Workflow 是生成和执行 Graph 的程序；Graph Engineering 负责约束、验证和优化这类程序所表达的拓扑；Harness 负责让它在真实环境中安全、可靠地运行。**

这里的 Harness 指承载权限、状态、预算、验证与恢复的系统级执行包络。Anthropic 也会把单个 Dynamic Workflow 称为“针对当前任务即时生成的 Harness”。两种说法并不矛盾：**系统级 Harness 托管一个由 Workflow 描述的任务级 Harness，后者再实例化具体 Graph。**

全文分为三条阅读路线：只关心概念边界，可以阅读第 1、4、9 节；关心 Claude Code Workflow，可以阅读第 2、3、8 节；准备实现类似系统，则重点阅读第 5 至第 7 节。

> [!note] 证据边界
> - Claude Code Dynamic Workflow 的产品行为核验于 2026-07-27，以 Anthropic 官方文档为准。
> - 2026 年 3 月 31 日，Claude Code 的 npm 包因 source map 打包错误暴露了内部源码；这是[发布包泄露](https://www.theregister.com/software/2026/03/31/anthropic-accidentally-exposes-claude-code-source-code/5227940)，不是以开源许可证发布。本文不依赖泄露源码，只分析已经公开的产品文档与运行界面。
> - Agentic Computation Graphs 综述目前是 arXiv v1 预印本；本文借用其统一定义，不把综述观点当成已建立的行业标准。
> - 文中的 Graph IR、静态验证器和 Harness 分层属于工程归纳，不是 Anthropic 对 Claude Code 内部实现的完整说明。

## 1. Workflow 不是 Graph，但它是一种图程序

在日常语言里，Workflow 通常只是“先做什么、后做什么”。Claude Code 的 Dynamic Workflow 更严格：它是 Claude 根据任务生成的一段 JavaScript 编排程序，由与主对话分离的 Workflow Runtime 在后台执行。

官方文档给出的最小形态是：

```javascript
export const meta = {
  name: "audit-routes",
  description: "Audit every route handler for missing auth checks",
};

const found = await agent("List every .ts file under src/routes/.", {
  schema: {
    type: "object",
    required: ["files"],
    properties: {
      files: { type: "array", items: { type: "string" } },
    },
  },
});

const audits = await pipeline(found.files, file =>
  agent(`Audit ${file} for missing authentication checks.`, {
    label: file,
  }),
);

return audits.filter(Boolean);
```

`agent()` 产生一个 Agent 节点；`pipeline()` 根据运行时数据展开一组并行节点；`await` 形成数据依赖和汇合点；普通 JavaScript 条件与循环负责路由、重试和终止。中间结果保存在脚本变量中，而不是全部回填主对话上下文。[官方文档](https://code.claude.com/docs/en/workflows)因此用一句很准确的话概括它：**Workflow 把计划移入代码。**

这段代码没有显式声明 `nodes` 和 `edges`，但它仍然会生成图：

- `found → audits` 是数据依赖边；
- 每个文件对应一个动态实例化的 Audit 节点；
- `pipeline()` 表示 fan-out 和 fan-in；
- `filter()` 决定哪些结果进入最终输出；
- 如果增加验证—修复循环，控制流图中就会出现回边。

所以 Workflow 不是图的数据结构，而是**能够实例化执行图的程序**。它和 SQL 查询计划、编译器控制流图的关系类似：源代码是程序，图是程序所表达或运行时形成的结构。

## 2. Claude Code 把 Workflow 从模式推进到了 Runtime

Anthropic 在 2024 年区分了 Workflow 与 Agent：Workflow 通过预定义代码路径组织 LLM 和工具，Agent 则由模型动态决定过程。它同时总结了 prompt chaining、routing、parallelization、orchestrator-workers 和 evaluator-optimizer 等模式。[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)

Orchestrator–Workers 解决的是任务规模在运行前未知的问题。Orchestrator 先分解任务，再动态启动多个 Worker，最后汇总结果。

[![Anthropic Orchestrator–Workers 工作流：Orchestrator 将输入动态拆分给多个 LLM Worker，再由 Synthesizer 汇总](assets/graph-engineering-workflow/02-anthropic-orchestrator-workers.png)](assets/graph-engineering-workflow/02-anthropic-orchestrator-workers.png)

*图 2　Orchestrator–Workers：工作单元不是预先枚举，而是根据输入动态产生。原图来自 [Anthropic《Building effective agents》](https://www.anthropic.com/engineering/building-effective-agents)，版权归 Anthropic。*

Evaluator–Optimizer 则给图增加回边。Generator 产生候选，Evaluator 决定接受还是返回反馈；它已经是一个有明确终止条件的循环图。

[![Anthropic Evaluator–Optimizer 工作流：Generator 与 Evaluator 之间形成反馈循环，通过后才输出](assets/graph-engineering-workflow/03-anthropic-evaluator-optimizer.png)](assets/graph-engineering-workflow/03-anthropic-evaluator-optimizer.png)

*图 3　Evaluator–Optimizer：`Rejected + Feedback` 构成从验证节点回到生成节点的有条件回边。原图来自 [Anthropic《Building effective agents》](https://www.anthropic.com/engineering/building-effective-agents)，版权归 Anthropic。*

这些模式当时主要回答“应该怎样组合 Agent”。Dynamic Workflow 增加的是可执行产品层：

- Claude 为当前任务生成 JavaScript；
- Runtime 在主对话之外执行编排；
- 中间结果保存在脚本变量中；
- Workflow 可以保存为项目级或个人命令；
- 已完成的 Agent 结果在同一 Session 内可以复用；
- Runtime 提供并发数、Agent 总量和成本告警等边界。

2026 年 5 月 28 日，Anthropic [正式发布 Dynamic Workflows](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)。官方运行界面已经不再只展示一条对话，而是展示 Workflow 名称、阶段、每阶段 Agent 数量、模型、Token、工具调用和运行时间。

[![Claude Code Dynamic Workflow 真实运行界面：React 到 Solid 迁移包含 Inventory、Pattern Analysis、Infrastructure、Migrate 与 Verify 等阶段，并展示 35 个 Agent 的进度和消耗](assets/graph-engineering-workflow/05-claude-dynamic-workflow-ui.png)](assets/graph-engineering-workflow/05-claude-dynamic-workflow-ui.png)

*图 4　Claude Code Dynamic Workflow 的官方运行界面。图中一个 React→Solid 迁移被拆成 6 个阶段、35 个 Agent；阶段、节点状态、Token、工具数和耗时均被外显。来源：[Introducing dynamic workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)，版权归 Anthropic。*

这里真正重要的变化不是 Agent 数量，而是**编排成为独立、可读取、可复用、可观测的运行对象**。

Anthropic 随后在 [A harness for every task](https://claude.com/blog/a-harness-for-every-task%2Ddynamic-workflows-in-claude-code) 中给出更直接的定义：Claude Code 可以按任务即时编写自己的 multi-agent harness。这里生成的不是另一个完整 Runtime，而是由 JavaScript 控制流、Subagent、Worktree、验证策略和预算组成的**任务级 Harness**；它仍运行在 Claude Code 的权限、Sandbox、Session 与工具系统之内。因而 Dynamic Workflow 更准确的定位是：**系统级 Harness 内部的 Harness 生成器。**

## 3. Graph Engineering 把 Workflow 结构本身变成优化对象

Graph Engineering 这个名称较新，实践并不新。LangGraph 很早就用有状态循环图表达 Agent；Anthropic 的五类 Workflow 模式本身也都有拓扑；[Alexey Grigorev](https://alexeyondata.substack.com/p/ai-native-development-specifications)所举的 PM→Engineer→QA 案例，则把角色、交接和失败回路组织成一张多 Agent 图。

更系统的理论框架来自 2026 年的综述 [From Static Templates to Dynamic Runtime Graphs](https://arxiv.org/abs/2603.22386)。论文将 LLM 调用、工具、检索、代码执行、记忆更新和验证统一建模为 Agentic Computation Graph，并把研究对象分为：

- 静态模板搜索；
- 固定拓扑内的节点优化；
- 拓扑与节点参数的联合优化；
- 运行前生成 Workflow；
- 执行中选择、裁剪或编辑 Graph；
- 基于指标、Verifier 和 Trace 的持续优化。

[![Agentic Computation Graphs 综述 Figure 1：从任务和约束进入 Graph Workflow，形成可复用模板、图执行、Trace、优化、观测、改进和部署，并比较静态优化与动态适配](assets/graph-engineering-workflow/04-acg-survey-workflow-optimization.png)](assets/graph-engineering-workflow/04-acg-survey-workflow-optimization.png)

*图 5　Workflow Optimization 的整体研究空间。上方是从 Task 到 Graph、Trace、Optimize、Observe、Refine 和 Deploy 的生命周期；下方区分静态模板优化与动态 Workflow 适配。原论文 Figure 1，取自 [From Static Templates to Dynamic Runtime Graphs](https://arxiv.org/abs/2603.22386)，已对照 PDF 第 4 页核验，版权归原作者。*

Claude Code Dynamic Workflow 在这个分类中更接近 **construct-then-execute**：Claude 在执行前生成面向当前任务的程序，Runtime 随后根据数据动态实例化节点。它已经支持运行时分支、循环和数据依赖的 fan-out，但现有公开文档没有表明 Workflow 会在执行过程中任意重写自身程序，因此不应把它直接等同于完全可塑的运行时图编辑器。

这一边界很重要。Graph Engineering 不是给任意多 Agent 编排换一个名称，而是把以下结构性变量变成一等工程对象：

- 允许哪些节点与角色；
- 哪些边可以存在；
- 哪些节点能够并行；
- 验证器放在哪里；
- 哪些失败允许回退；
- 回边可以经过多少次；
- 哪些条件才能进入终态；
- 质量、成本和恢复能力如何随拓扑变化。

## 4. 必须区分模板、运行图与 Trace

把所有东西都叫“Workflow”会掩盖三个不同对象。沿用 ACG 综述的记号，一个可复用模板可以写成：

$$
\bar{\mathcal{G}}
=
(\mathcal{V},\mathcal{E},\Phi,\Sigma,\mathcal{A})
$$

其中，$\mathcal{V}$ 是节点，$\mathcal{E}$ 是边，$\Phi$ 包含 Prompt、Tool、Model、Schema 等节点参数，$\Sigma$ 是路由与调度策略，$\mathcal{A}$ 是允许的激活、重试或编辑动作。

面对输入 $x$ 和运行状态 $s$，模板会实例化为本次真正执行的 Graph：

$$
\mathcal{G}^{\mathrm{run}}
=
\operatorname{instantiate}(\bar{\mathcal{G}},x,s)
$$

执行过程再产生 Trace：

$$
\tau
=
\{(s_t,a_t,o_t,c_t)\}_{t=1}^{T}
$$

这里的 $s_t$、$a_t$、$o_t$ 和 $c_t$ 分别表示状态、动作、观察与成本。

[![Workflow Template、Realized Graph 和 Execution Trace 的区别：模板包含可复用节点和有限回边，运行图根据输入展开三个 Worker，Trace 记录一次失败重试和成本](assets/graph-engineering-workflow/07-template-run-trace.svg)](assets/graph-engineering-workflow/07-template-run-trace.svg)

*图 6　一个 Workflow 对应三个工程对象。模板规定允许发生什么；运行图说明本次实例化了什么；Trace 记录实际上发生了什么。本文归纳，定义依据 [ACG 综述](https://arxiv.org/abs/2603.22386)，Workflow 行为依据 [Claude Code 文档](https://code.claude.com/docs/en/workflows)。*

这三个对象不能相互替代：

- 只保存模板，无法知道某次运行实际创建了多少 Agent。
- 只保存运行图，无法知道工具失败、重试和成本发生在哪一步。
- 只保存 Trace，无法判断实际路径是否违反模板允许的结构。

Graph Engineering 的版本管理、回归和评测对象因此不能只有 Workflow 源码。模板、运行图、Trace 以及产生它们的 Harness 版本都需要保存。

## 5. 用 Workflow 实现图约束：先生成，再验证，最后执行

用 Workflow 实现图约束是合理的，但不能直接执行模型任意生成的 JavaScript。更稳妥的生产结构是：

1. 任务先进入结构化 Task Contract；
2. 模型生成 Workflow 或 GraphSpec 候选；
3. 静态验证器检查拓扑不变量；
4. Policy Gate 绑定节点权限、Sandbox 和预算；
5. Runtime 实例化运行图；
6. 独立 Verifier 根据外部证据决定转移；
7. Harness 保存状态、Trace 和恢复点。

[![Harness、Workflow、Graph 与 Loop 的工程分层：任务契约经过 Workflow Generator 和 Graph IR Policy Gate 后，由 Runtime 实例化运行图，外层 Harness 持有权限、状态、预算、验证和恢复](assets/graph-engineering-workflow/06-harness-workflow-graph-stack.svg)](assets/graph-engineering-workflow/06-harness-workflow-graph-stack.svg)

*图 7　Harness、Workflow、Graph 与 Loop 的责任分层。Graph Engineering 横跨生成、验证、执行、观测与优化，而不是独立位于 Harness 之上的新层。本文归纳，依据 [Claude Code 架构文档](https://code.claude.com/docs/en/how-claude-code-works)、[Dynamic Workflow 文档](https://code.claude.com/docs/en/workflows)与 [ACG 综述](https://arxiv.org/abs/2603.22386)。*

### 5.1 用 GraphSpec 限制模型的生成空间

任意 JavaScript 表达力很强，也难以静态验证。生产系统可以先要求模型生成受约束的 GraphSpec，再由确定性编译器生成 Workflow。下面是一份可运行的 TypeScript 骨架：

```typescript
type Role = "pm" | "engineer" | "qa" | "done";

type NodeSpec = {
  id: string;
  role: Role;
  canWrite: boolean;
  canApprove: boolean;
  outputSchema: string;
};

type EdgeSpec = {
  from: string;
  to: string;
  on: "SUCCESS" | "PASS" | "FAIL";
  maxTraversals?: number;
  progressSignal?: string;
};

type GraphSpec = {
  start: string;
  terminals: string[];
  maxConcurrency: number;
  tokenBudget: number;
  nodes: NodeSpec[];
  edges: EdgeSpec[];
};

export function validateGraph(spec: GraphSpec): string[] {
  const errors: string[] = [];
  const byId = new Map(spec.nodes.map(node => [node.id, node]));

  if (!byId.has(spec.start)) errors.push("start node does not exist");
  if (spec.maxConcurrency < 1) errors.push("maxConcurrency must be positive");
  if (spec.tokenBudget < 1) errors.push("tokenBudget must be positive");

  for (const edge of spec.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);

    if (!from || !to) {
      errors.push(`dangling edge: ${edge.from} -> ${edge.to}`);
      continue;
    }

    if (to.role === "done" && from.role !== "qa") {
      errors.push(`only QA may enter done: ${edge.from} -> ${edge.to}`);
    }

    if (from.canWrite && from.canApprove) {
      errors.push(`writer may not approve itself: ${from.id}`);
    }
  }

  const color = new Map<string, 0 | 1 | 2>();
  const outgoing = (id: string) =>
    spec.edges.filter(edge => edge.from === id);

  function visit(id: string): void {
    color.set(id, 1);

    for (const edge of outgoing(id)) {
      const nextColor = color.get(edge.to) ?? 0;

      if (nextColor === 1) {
        if (!edge.maxTraversals || !edge.progressSignal) {
          errors.push(
            `cycle edge needs bound and progress signal: ` +
            `${edge.from} -> ${edge.to}`,
          );
        }
        continue;
      }

      if (nextColor === 0) visit(edge.to);
    }

    color.set(id, 2);
  }

  if (byId.has(spec.start)) visit(spec.start);

  for (const node of spec.nodes) {
    if (!color.has(node.id)) errors.push(`unreachable node: ${node.id}`);
  }

  return errors;
}
```

这段验证器固化了四类结构性约束：

- 不能存在悬空边和不可达节点；
- 写代码的角色不能同时批准自己的产物；
- 只有 QA 才能进入 `done`；
- 任意回边必须有次数上限和进展信号。

真实系统还应继续检查：所有非终态是否存在到终态或 `blocked` 的路径、并发写节点是否拥有隔离工作区、输出 Schema 是否兼容下一节点、工具权限是否符合角色，以及总成本是否在任务预算内。

### 5.2 把通过验证的结构编译成 Dynamic Workflow

Alexey 的 PM→Engineer→QA 图可以直接转换成 Workflow。下面的 JavaScript 只使用官方公开的 `agent()`、`pipeline()` 与普通语言控制流；为突出编排，工作区创建、权限绑定和 Git 合并仍由外层 Harness 负责。

```javascript
export const meta = {
  name: "deliver-backlog",
  description: "Groom, implement, and independently verify each issue",
};

const backlog = await agent(
  "List ready issues and their preallocated isolated workspaces.",
  {
    schema: {
      type: "object",
      required: ["issues"],
      properties: {
        issues: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "workspace"],
            properties: {
              id: { type: "string" },
              workspace: { type: "string" },
            },
          },
        },
      },
    },
  },
);

async function deliver(issue) {
  const spec = await agent(
    `Act as PM. Groom ${issue.id}. Do not edit code. ` +
    "Return testable acceptance criteria and explicit scope.",
    { label: `pm:${issue.id}` },
  );

  let feedback = "No previous QA feedback.";
  let previousFailure = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const implementation = await agent(
      `Act as Engineer in ${issue.workspace}. ` +
      `Implement ${issue.id} against this specification:\n${spec}\n` +
      `QA feedback:\n${feedback}`,
      { label: `engineer:${issue.id}:${attempt}` },
    );

    const qa = await agent(
      `Act as independent QA. Do not modify code. ` +
      `Verify ${issue.id} against the acceptance criteria.\n` +
      `Implementation evidence:\n${implementation}\n` +
      `Return PASS or FAIL, a failure fingerprint, and evidence.`,
      {
        label: `qa:${issue.id}:${attempt}`,
        schema: {
          type: "object",
          required: ["verdict", "fingerprint", "evidence"],
          properties: {
            verdict: { enum: ["PASS", "FAIL"] },
            fingerprint: { type: "string" },
            evidence: { type: "array", items: { type: "string" } },
          },
        },
      },
    );

    if (qa.verdict === "PASS") {
      return { issue: issue.id, status: "DONE", evidence: qa.evidence };
    }

    if (qa.fingerprint === previousFailure) {
      return {
        issue: issue.id,
        status: "BLOCKED",
        reason: "no progress across two verification rounds",
      };
    }

    previousFailure = qa.fingerprint;
    feedback = JSON.stringify(qa);
  }

  return {
    issue: issue.id,
    status: "BLOCKED",
    reason: "retry budget exhausted",
  };
}

return pipeline(backlog.issues, deliver);
```

这段 Workflow 表达了两层拓扑：

- Issue 之间可以并行，形成 `pipeline(backlog.issues, deliver)` 的 fan-out；
- 每个 Issue 内部是 PM→Engineer→QA，QA 失败后最多回到 Engineer 三次。

它还增加了一个比“重试三次”更重要的条件：相同失败指纹连续出现时立即进入 `BLOCKED`。有限循环不仅需要次数上限，还需要判断循环是否取得进展。

## 6. 图约束应分成三种强度

并不是把条件写进 Workflow 就获得了同样强的保证。图约束至少分为三层：

| 约束层 | 典型内容 | 最合适的执行者 |
|---|---|---|
| 拓扑约束 | 顺序、fan-out、fan-in、允许边、循环上限 | Workflow / Graph Runtime |
| 能力约束 | 角色工具、读写范围、网络、凭证、工作区 | Harness Policy 与 Sandbox |
| 完成约束 | 测试、Schema、grader、人工审批、部署观测 | 外部 Verifier 与控制面 |

Workflow 可以规定 Engineer 之后必须经过 QA，却不能仅凭一段 Prompt 保证 QA 没有写权限。它可以返回 `PASS`，却不能证明测试报告真实存在。真正的强约束必须落在模型无法绕过的执行面：

- QA 节点不获得写工具；
- 每个并行 Writer 使用独立 worktree 或环境命名空间；
- `PASS` 必须引用测试报告、退出码和 Artifact 哈希；
- `Done` 转移由 Runtime 根据证据执行，而不是 Agent 自己修改状态；
- 外部副作用使用幂等键、审批和补偿操作；
- 任务状态持久化在 Session 之外。

所以“用 Workflow 做图约束”是合理的，但更准确的实现方式是：**Workflow 提供控制结构，Harness 赋予控制结构强制力。**

## 7. Graph Engineering 需要评测什么

只比较最终答案，无法判断增加 Agent 是否真的有价值。Graph Engineering 的目标可以写成质量与成本之间的约束优化：

$$
\max
\;
\mathbb{E}_{x,\mathcal{G}^{\mathrm{run}},\tau}
\left[
R(\tau;x)-\lambda C(\tau)
\right]
$$

$R$ 是成功率、测试通过率或业务结果，$C$ 包括 Token、工具调用、延迟和费用，$\lambda$ 表示成本权重。实际评测至少应覆盖四组指标：

| 维度 | 指标示例 |
|---|---|
| Outcome | 任务成功率、验收项通过率、生产回滚率 |
| Graph | 节点数、深度、最大宽度、关键路径、回边次数 |
| Runtime | Token、延迟、并发利用率、失败恢复时间、cost per success |
| Governance | 越权调用、无证据转移、重复失败、人工接管率 |

评测单位也应分层：

1. 固定输入下比较不同 Workflow 模板；
2. 同一模板多次运行，测量模型随机性；
3. 比较生成图与实际运行图的偏差；
4. 从 Trace 中定位成本和失败集中在哪些节点；
5. 将有效改动晋级为新模板、节点契约或路由策略。

这时，Graph Engineering 才从“画一张更复杂的图”变成真正的工程循环。

## 8. Claude Code Dynamic Workflow 的边界

截至 2026-07-27，Claude Code Dynamic Workflow 已经具备清晰的编排能力，但不能直接视为通用耐久工作流引擎。官方文档列出了几项重要边界：

- Workflow 脚本本身不能直接访问文件系统或 Shell，实际动作由 Agent 完成；
- 单次运行最多并发 16 个 Agent，总量最多 1000 个；
- 普通用户输入不能在 Workflow 中途插入，阶段性人工审批需要拆成多个 Workflow；
- 暂停后可以在同一 Session 内复用已完成结果；
- 退出 Claude Code 后再次启动，Workflow 会从头开始。

这些限制并不削弱它作为图程序的价值，但说明它目前更适合：

- 大规模只读审计与研究；
- 文件级并行检查；
- 可拆分的大型迁移；
- 多候选生成与交叉验证；
- 有明确预算和终止条件的修复循环。

涉及跨 Session 耐久状态、长时间人工等待、外部事务、Exactly-once Activity 或复杂补偿时，仍需要 Temporal、队列系统、数据库状态机或专门 Agent Runtime 承担底层语义。Claude Workflow 可以作为上层生成和编排入口，而不是替代这些系统。

## 9. 与现有 Harness 实践的关系

[[AI Coding研发中的Harness与Loop构建]] 已经包含四层 Loop、任务状态机、跨系统依赖图、角色隔离、Worktree、Checkpoint、重试预算、Verifier 和人工接管。Dynamic Workflow 不会推翻这套结构，而是补上一个很具体的中间层：

```text
Task Contract
  → Workflow / GraphSpec 生成
  → 静态拓扑验证
  → Runtime 实例化执行图
  → Agent / Tool / Human 节点
  → Trace、Evidence 与 Graph Eval
```

由此可以进一步明确各层职责：

- **Skill** 定义某类节点应该怎样工作；
- **Workflow** 定义节点何时运行、怎样分支、汇合和循环；
- **Graph** 是 Workflow 所表达和实际实例化的执行结构；
- **Loop** 是 Graph 中受终止条件约束的回边；
- **任务级 Harness** 是 Workflow 为当前任务组合出的角色、工作区、验证器与控制流；
- **系统级 Harness** 持有上下文、权限、状态、预算、观测、恢复和接管，并托管任务级 Harness。

因此，Graph Engineering 不是 Harness 之后的新范式，也不是 Loop Engineering 的替代品。它是 Harness 内部关于工作拓扑的工程学；Dynamic Workflow 则使这套工程学从手工编排进入了“模型生成任务级 Harness、系统验证后执行”的阶段。

最终需要建设的不是一张越来越复杂的流程图，而是一条完整的编译与治理链路：

> **把任务意图编译成受约束的 Workflow，验证其拓扑不变量，由 Harness 可靠执行，并用运行图与 Trace 持续优化下一版结构。**
