---
title: pi-mono 源码深度解析：pi-agent 的极简 Agent Core
description: 从固定源码修订逐层拆解 pi-agent 的模型协议、Agent 循环、状态机、Harness、Tool、Hook、Skill、Session、Compaction、Subagent 与沙箱边界。
tags:
  - Agent
  - Agent-Core
  - pi-mono
  - 源码解析
  - Agent架构
date: 2026-02-02
publish: true
---

# pi-mono 源码深度解析：pi-agent 的极简 Agent Core

> [!abstract] 核心判断
> `pi-agent` 的优秀，不在于它用一个“大而全的 Agent 类”包办所有事情，而在于它把真正的 Agent Core 拆成四层：`pi-ai` 统一模型协议，`agentLoop()` 实现最小执行闭环，`Agent` 把事件折叠成状态，`AgentHarness` 再补上 Session、资源、Hook、压缩与分支。每一层都能单独解释，也能单独替换。
>
> Skill、Tool、Hook、持久化、Subagent、Sandbox 在这套设计中有清楚的位置：Skill 是按需披露的程序性上下文；Tool 是类型化副作用；Hook 是生命周期插槽；Session 是追加式事件树；Subagent 是 Core 之上的组合模式；Sandbox 则明确属于进程和操作系统边界。Pi 的“简洁”不是功能少，而是**没有把不同层次的问题揉成同一个抽象**。

## 0. 先说结论：为什么它配得上 Agent Core 典范

如果把界面、CLI、模型供应商和具体工具全部拿掉，一个 Agent 最少还剩什么？

```text
输入消息
  → 调用模型并流式接收 assistant message
  → 如果模型请求工具：校验、执行、回填 tool result
  → 再次调用模型
  → 没有工具、没有插话、没有后续消息时结束
```

Pi 没有用工作流 DSL 隐藏这条路径。它把核心写成两个可以从上到下读完的 `while`，把所有复杂性安放在明确的边界上。[CODE]

| 维度 | 判断 | 最关键的源码证据 |
|---|---|---|
| 核心抽象 | 小而完整 | `AgentContext` 只有 system prompt、messages、tools |
| 控制流 | 显式双层循环 | 内层处理 tool/steering，外层处理 follow-up |
| 并发 | 并行执行、确定回填 | completion event 按完成顺序，tool result 按调用源顺序 |
| 状态 | 事件先归约，再等待订阅者 | `processEvents()` 中逐个 `await listener` |
| 应用运行时 | Harness 只管理一次会话的生命周期 | turn snapshot、pending writes、save point、settled |
| Skill | 渐进披露 | system prompt 只放 name/description/location，调用时才放正文 |
| 持久化 | 追加式事件树，不是扁平聊天数组 | parentId、leaf、compaction、branch summary |
| 扩展 | Hook 与 Extension 分层 | 强类型 Hook；Extension 是宿主 JS/TS 代码 |
| Subagent | 不污染 Core | 作为示例 Tool 启动独立 Pi 进程 |
| 安全 | 不制造伪安全感 | 官方明确要求外部 Sandbox |

我的最终判断是：

1. **`agentLoop()` 是这套系统最值得学习的内核。**它足够小，却认真处理了工具截断、并发顺序、事件时机、取消与队列。
2. **`Agent` 的价值不在“面向对象包装”，而在 awaited event barrier。**状态、持久化和下一步执行因此不会松散竞态。
3. **`AgentHarness` 是完整的 Agent Core 应用边界。**它把 Session、资源、Hook、Compaction 接到 loop，却没有让它们侵入 loop。
4. **coding-agent 很强，但不是 Agent Core 本身。**read/bash/edit/write、RPC、Extension、CLI/TUI 都是 Core 之上的一个具体应用。
5. **Subagent 与 Sandbox 不在 Core 内，是优点，不是缺陷。**前者是调度组合，后者是系统安全边界；硬塞进 loop 只会让抽象变形。

---

## 1. 版本锚点、范围与证据口径

### 1.1 固定源码修订

本文逐行分析固定在以下源码快照：

- canonical repository：[`earendil-works/pi`](https://github.com/earendil-works/pi)
- 默认分支：`main`
- full commit：[`13437ca828894f43f973c630d208b488637d8fa9`](https://github.com/earendil-works/pi/commit/13437ca828894f43f973c630d208b488637d8fa9)
- commit date：2026-07-20 14:03:33 +02:00
- subject：`fix(ai): normalize Kimi K2.7 to the canonical coding model`
- 最近标签：`v0.80.10`，标签提交 `8dc78834cde4e3292841cf505f9e3f99763df5529`
- License：MIT
- 本文快照中的 package version：`0.80.10`

HEAD 比 `v0.80.10` 标签多 40 个提交。[RUN] 因此本文讨论的是上述 SHA 的源码，而不是笼统的“npm 0.80.10”。所有核心代码链接都绑定完整 SHA，不使用会漂移的 `main`。

### 1.2 本文说的 Agent Core 到底包括什么

主线范围：

```text
packages/ai
  Model / Provider / Context / Message / Stream

packages/agent
  agentLoop / Agent / AgentHarness
  Tool contract / Hook contract
  Skill loader / Session tree / Compaction
```

为了讲清边界，本文还会阅读：

```text
packages/coding-agent
  built-in tools / Extension / RPC / 旧 AgentSession

packages/coding-agent/examples/extensions/subagent
  Subagent 组合示例

SECURITY.md
  官方信任与隔离边界
```

不展开 TUI 的组件树、布局、输入法和渲染，因为它们不改变 Agent Core 的语义。RPC 只用来说明 headless 接口，Subagent 示例只用来说明组合方式。

### 1.3 证据标签

- `[CODE]`：固定 SHA 中可直接验证的行为。
- `[RUN]`：针对固定 SHA 的命令、构建和测试结果。
- `[DOC]`：同仓库文档或维护者声明。
- `[ISSUE]`：上游 issue 记录的历史问题或设计讨论；不自动等于本文已复现。
- `[INFERENCE]`：由前述事实推导出的工程判断。

---

## 2. 真实架构：不是一个 Agent 类，而是四层运行时

![[AIGC/assets/pi-agent-core/01-agent-core-architecture.svg]]

Pi Agent Core 可以用四层理解。

### 2.1 第一层：`pi-ai` 定义模型协议

`packages/ai` 负责：

- Model 描述；
- Provider 注册与认证；
- User/Assistant/ToolResult message；
- Tool schema；
- streaming event；
- usage、stop reason、thinking/reasoning；
- 将不同供应商协议归一化。

Agent loop 不直接知道 OpenAI、Anthropic、Google 或其他 provider 的 HTTP 细节。它只拿到一个 `StreamFn`，输入 `Model + Context + options`，输出 `AssistantMessageEventStream`。[CODE]

[`StreamFn`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/types.ts#L17-L31) 的契约甚至明确要求：常规请求/模型/运行时错误不应通过 rejected promise 逃逸，而应编码进 stream，最终产生 `stopReason: "error" | "aborted"` 的 AssistantMessage。[CODE]

这条契约让 loop 能始终通过同一事件路径收束成功、失败和取消。

### 2.2 第二层：`agentLoop()` 是执行内核

`packages/agent/src/agent-loop.ts` 是最小 Agent：

```text
模型流 → assistant message → tool calls → tool results → 下一次模型流
```

它不拥有长期 Session，不扫描 Skill，不知道 CLI，也不关心消息画在什么界面上。它只接受：

- 一组新 prompt messages；
- 一个 `AgentContext`；
- 一个 `AgentLoopConfig`；
- 一个 event callback；
- 一个 `AbortSignal`；
- 一个 stream function。

主实现：[`runLoop()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L155-L275)。

### 2.3 第三层：`Agent` 是状态与事件封装

`Agent` 把纯 loop 包装成一个可以长期持有的对象，增加：

- `AgentState`；
- 当前 streaming message；
- pending tool calls；
- steering / follow-up queue；
- abort；
- subscriber；
- 一次只允许一个 active run。

它没有重写循环；真正执行仍然委托给 `runAgentLoop()` / `continueAgentLoop()`。[CODE]

### 2.4 第四层：`AgentHarness` 是会话级运行时

Harness 把应用真正需要的能力接进来：

- Session tree；
- turn snapshot；
- Skill / prompt template resources；
- 模型集合 `Models`；
- 更完整的 lifecycle hook；
- pending session writes；
- save point / settled；
- compact 与 branch navigation。

它仍然不拥有 Skill 的来源策略，也不拥有一个全局任务调度器。`AgentHarnessOptions.resources` 的注释明确说明，应用负责加载和刷新资源，再调用 `setResources()`。[CODE]

### 2.5 coding-agent 是应用，不是 Core

`packages/coding-agent` 在四层之上组装：

- 默认 read/bash/edit/write；
- 本地 Session 管理；
- Extension loader/runner；
- RPC、JSON mode、CLI、TUI；
- 本地配置和资源发现。

这解释了为什么 `pi-agent` 核心可以很小，而完整仓库仍有大量代码。核心的简洁来自**层次正确**，不是仓库只有几个文件。[INFERENCE]

---

## 3. Core 的最小数据模型

要理解 loop，先看它真正操作的数据。

### 3.1 `AgentContext`：整个内核最窄的腰部

[`AgentContext`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/types.ts#L398-L406) 只有三个字段：[CODE]

```ts
export interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: AgentTool<any>[];
}
```

这个类型非常重要。它说明 Agent Core 的世界只有：

1. 模型应该遵循什么；
2. 模型已经看到了什么；
3. 模型现在能调用什么。

Session 树、Skill 文件夹、配置中心、UI 状态都必须先投影成这三个字段，才能进入一次模型调用。Core 因而不需要理解上层所有业务对象。

### 3.2 `AgentMessage`：允许应用消息，但不强迫模型理解它

`AgentMessage` 是标准 LLM Message 与 `CustomAgentMessages` 的联合。[CODE]

```ts
export interface CustomAgentMessages {}

export type AgentMessage =
  | Message
  | CustomAgentMessages[keyof CustomAgentMessages];
```

应用可以通过 TypeScript declaration merging 增加 artifact、notification 等消息类型。真正发给模型前，`convertToLlm` 负责转换或过滤它们。[CODE]

这比“所有消息都必须伪装成 user text”更干净：

- transcript 可以保存应用事件；
- UI 可以渲染自定义消息；
- provider context 仍只包含模型能理解的结构；
- 哪些自定义消息进入模型，由明确的转换函数决定。

### 3.3 `AgentTool`：schema 与执行函数的最小结合

[`AgentTool`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/types.ts#L349-L395) 包含：[CODE]

```ts
interface AgentTool<TParameters, TDetails> extends Tool<TParameters> {
  label: string;
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute(
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ): Promise<AgentToolResult<TDetails>>;
  executionMode?: "sequential" | "parallel";
}
```

Tool 不继承复杂的 runtime context，也没有神秘依赖注入。`toolCallId`、已验证参数、取消信号和 progress callback 足以支撑绝大多数工具。

### 3.4 `AgentEvent`：状态、UI、持久化共用一条事实流

事件 union 只有四组：[CODE]

```text
agent_start / agent_end
turn_start / turn_end
message_start / message_update / message_end
tool_execution_start / update / end
```

对应定义：[`AgentEvent`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/types.ts#L408-L430)。

一个 turn 被精确定义为：**一次 assistant response，加上它请求的所有 tool call/result。**[CODE] 这一定义贯穿 loop、状态、Session 和 Hook，是整套实现能够对齐的原因。

---

## 4. 一次完整运行：从 prompt 到 `agent_end`

代表性端到端路径如下：[CODE]

```text
prompt messages
  → agent_start
  → message_start / message_end（新 user messages）
  → turn_start
  → transformContext
  → convertToLlm
  → streamFn(model, context)
  → message_start / 多个 message_update / message_end
  → 提取 tool calls
      ├─ 没有 tool call：turn_end
      └─ 有 tool call：prepare → validate → hook → execute → hook
                      → tool_execution_* events
                      → toolResult message_start / message_end
                      → turn_end
  → prepareNextTurn
  → drain steering
  → 必要时进入下一 inner turn
  → drain follow-up
  → 必要时重新进入 outer loop
  → agent_end
```

这条链中没有一个“框架调度黑箱”。每个转折点都能在 `agent-loop.ts` 中找到对应分支。

### 4.1 输入消息也产生 message event

loop 开始时，不是直接把 prompt 塞进数组。新 prompt messages 会依次产生 `message_start`、`message_end`，然后进入 context。[CODE] 这样 subscriber 看见的是完整 transcript 变化，而不是只看见模型输出。

### 4.2 Assistant partial 本身就是当前 context 的一部分

streaming 时，当前 assistant partial message 会临时放入 context，并随着 provider event 更新。[CODE] 因此：

- UI 能显示增量；
- `AgentState.streamingMessage` 有唯一来源；
- tool call 尚未闭合时，状态仍能准确表示“正在形成中的 assistant message”；
- 取消或错误能得到一个结构化终态，而不是只留下半截 stdout。

### 4.3 `message_end` 与 `turn_end` 不是一回事

Assistant message 完成只表示模型这次输出结束。若它包含 tool calls，工具还要执行、tool results 还要进入 transcript；所有这些结束后才有 `turn_end`。[CODE]

这一区分是后续持久化、插话与 compaction 正确性的基础。

---

## 5. `agentLoop()`：两个 while 如何构成真正的 Agent

主实现位于 [`packages/agent/src/agent-loop.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L155-L792)。

![[AIGC/assets/pi-agent-core/02-agent-loop.svg]]

### 5.1 外层循环处理 follow-up，内层循环处理 tool 与 steering

抽掉事件细节后，控制流接近：[CODE]

```ts
while (true) {                         // outer: follow-up
  let hasMoreToolCalls = true;
  let steeringAfterTools = null;

  while (hasMoreToolCalls || steeringAfterTools) { // inner
    const assistant = await streamAssistantResponse(...);
    const toolCalls = findToolCalls(assistant);

    hasMoreToolCalls = toolCalls.length > 0;
    if (hasMoreToolCalls) {
      const results = await executeToolCalls(...);
      context.messages.push(...results);
    }

    steeringAfterTools = await getSteeringMessages();
    context.messages.push(...steeringAfterTools);
  }

  const followUps = await getFollowUpMessages();
  if (followUps.length === 0) break;
  context.messages.push(...followUps);
}
```

对应源码：[`runLoop()` 双层循环](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L155-L275)。

两种队列语义不同：

- **Steering**：Agent 还在处理当前工作；当前工具批次完成后，插入一条消息改变下一步方向。
- **Follow-up**：Agent 本来已经要结束；如果队列有后续问题，再开启一轮外层循环。

Pi 没把它们合成一个“用户消息队列”，因为 drain point 不同。这个小区别直接决定插话是否会跳过当前工具、是否会让本已完成的任务重新启动。

### 5.2 `prepareNextTurn` 是动态配置的唯一换挡点

每个 `turn_end` 后、下一次 provider request 前，loop 会调用 `prepareNextTurn`。它可以替换：

- context；
- model；
- thinking level。

对应契约：[`AgentLoopTurnUpdate`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/types.ts#L128-L138) 与 [`prepareNextTurn`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/types.ts#L215-L222)。

这意味着运行时变化只在 turn boundary 生效，不会在一次 provider stream 中途偷偷换模型或工具集。[CODE]

### 5.3 `shouldStopAfterTurn` 是优雅停止，不是硬取消

`shouldStopAfterTurn` 在当前 assistant 和所有工具都完整结束后运行。如果返回 true，loop 直接发 `agent_end`，不再读取 steering/follow-up。[CODE]

它适合：

- 上下文接近上限，想在完整 turn 后停止；
- 达到应用定义的迭代上限；
- 已得到结构化终止信号。

它不替代 `AbortSignal`。硬取消需要打断正在进行的 provider 或 tool。

### 5.4 Stream 的失败也是消息，而不是旁路异常

[`streamAssistantResponse()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L281-L373) 做的事情依次是：[CODE]

1. 对 AgentMessage 执行 `transformContext`；
2. 用 `convertToLlm` 转成 provider 能理解的 Message；
3. 构造 `Context { systemPrompt, messages, tools }`；
4. 调用 `streamFn`；
5. 把每个 assistant delta 更新为 partial message；
6. 发出 `message_update`；
7. stream 结束后发 `message_end`。

`StreamFn` 契约要求常规 provider 错误落到最终 AssistantMessage 的 `stopReason` 与 `errorMessage` 中，而不是让 loop 丢失事件尾部。[CODE] 这让成功、失败、取消都有统一 transcript 形状。

真正无法归一化的异常仍可能逃出，例如 `transformContext`/`convertToLlm` 违反契约直接抛错。`Agent` 和 `AgentHarness` 会为这种情况补造 failure message 与完整结束事件。[CODE]

### 5.5 长度截断时，整个工具批次都拒绝执行

如果 assistant 因 `stopReason === "length"` 停止，Pi 不会执行其中“看起来已经完整”的 tool calls，而是为每一个 call 生成 error tool result。[CODE]

对应源码：[`length` 截断保护](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L376-L407)。

这是非常重要的事务语义：

```text
模型原本想表达的完整工具批次未知
≠
已经解析出来的前几个调用可以安全提交
```

即使第一个 JSON 合法，后面的参数或补偿动作可能被截断。Pi 选择 fail closed，不执行 partial intent。[INFERENCE]

### 5.6 并行不是一句 `Promise.all`

工具执行模式有两个来源：[CODE]

- 全局 `config.toolExecution`，默认 `parallel`；
- 单个工具的 `executionMode` override。

只要批次中任何工具要求 `sequential`，整批顺序执行；否则才走并行路径。[CODE]

对应源码：[`executionMode` 决策](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L413-L428)。

并行路径又分两段：

```text
阶段 A：按 assistant source order 串行预检
  tool lookup
  → prepareArguments
  → schema validation
  → beforeToolCall

阶段 B：允许执行的工具 Promise.all
  → 谁先完成，谁先发 tool_execution_end
  → 所有完成后，ToolResultMessage 仍按 source order 进入 transcript
```

对应源码：[`parallel execution`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L491-L555)。

这同时满足两种不同的“顺序”：

- **观察顺序**忠于真实完成时间，便于 UI 与 telemetry；
- **语义顺序**忠于模型原始 tool call 顺序，避免 transcript 随网络抖动随机变化。

很多实现只做到并行，却没保留第二个不变量。Pi 在这里确实很漂亮。

### 5.7 Sequential 是批次级退化

顺序路径会对每个 tool call 完整执行 prepare → execute → finalize，然后才处理下一个。[CODE]

[`sequential execution`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L435-L488)

代价是：一个要求 sequential 的工具会让同批其他本可并行的调用一起串行。这比资源级锁简单，但粒度较粗。[INFERENCE] Pi 在 coding-agent 的文件修改层又补了 per-file queue，说明细粒度冲突控制更适合放到 Tool 实现，而不是让通用 loop 理解所有资源。

### 5.8 工具错误被归一化为结果

工具准备和执行的失败会转换成结构化 error result，而不是让整个 Agent run 直接崩掉：[CODE]

- 找不到工具；
- `prepareArguments` 抛错；
- schema 校验失败；
- before hook block；
- execute 抛错；
- after hook 抛错。

模型因此有机会读到错误并修正参数或换方案。真正取消由 `AbortSignal` 区分，不会被伪装成普通业务失败。

### 5.9 Tool progress 有明确的生命周期

`execute()` 得到 `onUpdate` callback。只要 Promise 尚未 settle，update 会产生 `tool_execution_update`；Promise settle 后再迟到的 callback 会被忽略。[CODE]

对应源码：[`executePreparedToolCall()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L668-L709)。

这避免了 final result 已经出现，旧后台计时器又发 progress 的时序错误。

### 5.10 `terminate` 是批次一致决定

Tool result 可以带 `terminate: true`。但只有**本批所有 finalized results 都为 true**，loop 才提前停止；只要有一个结果没要求 terminate，就把完整批次交还模型。[CODE]

[`shouldTerminate`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L576-L586)

这样并行批次中的单个工具不会擅自吞掉其他工具结果。

---

## 6. Tool：类型化副作用如何接入 Core

Tool 是 Agent Core 与外部世界发生副作用的唯一标准通道。它不是 Skill，也不是 Hook。

![[AIGC/assets/pi-agent-core/03-tool-hook-pipeline.svg]]

### 6.1 一次 Tool Call 的完整流水线

```text
raw toolCall
  → 按 name 查找 AgentTool
  → prepareArguments(raw args)       可选兼容层
  → TypeBox Value.Check(schema)       强校验
  → beforeToolCall                    可 block
  → tool.execute(signal, onUpdate)
  → afterToolCall                     可替换结果字段
  → tool_execution_end
  → ToolResultMessage
  → message_start / message_end
```

源码对应：

- [`prepareToolCall()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L588-L666)
- [`executePreparedToolCall()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L668-L709)
- [`finalizeToolCall()` / after hook](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L711-L755)
- [`createToolResultMessage()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L774-L792)

### 6.2 `prepareArguments` 是兼容层，不是替代 schema

注释把它定义为 raw tool-call arguments 的 compatibility shim。[CODE] 它可以修复旧模型或旧 schema 的参数形状，但输出仍必须通过 TypeBox schema。

合理用途：

- 旧字段名迁移；
- 字符串数字转数值；
- 为兼容版本补默认字段。

不合理用途：

- 在里面执行副作用；
- 静默吞掉未知参数；
- 把完全错误的语义猜成合法请求。

### 6.3 Tool Result 分成 content 与 details

`content` 是回给模型的文本/图片；`details` 是应用侧结构化信息。[CODE]

这是一条非常实用的分界：

```text
content: 模型下一步决策真正需要的压缩信息
details: UI、日志、artifact id、完整命令元数据、渲染信息
```

如果把所有细节都塞进 content，会迅速耗尽 context；如果只有 content，又失去应用展示和审计所需的结构。

### 6.4 `afterToolCall` 是字段替换，不是深合并

Hook 可以替换 `content`、`details`、`isError`、`terminate`；未提供字段保留原值，content/details 不做 deep merge。[CODE]

[`AfterToolCallResult`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/types.ts#L65-L86)

这个规则看似朴素，却避免“多个 Hook 对嵌套 details 做隐式 merge”产生不可预测结果。

### 6.5 coding-agent 的四个默认工具只是一个应用选择

默认 active tools 是 `read`、`bash`、`edit`、`write`。[CODE]

[`packages/coding-agent/src/core/sdk.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/sdk.ts#L240-L246)

它们不是 agent-core 的硬编码能力。一个网页 Agent、数据 Agent 或机器人 Agent 可以完全不用这四个工具，只保留相同 loop 与 Tool contract。

### 6.6 输出截断是上下文管理，不只是界面优化

coding-agent 的通用工具输出上限是 2,000 行、50KB。[CODE]

[`truncate.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/tools/truncate.ts#L1-L120)

`bash` 对长输出保留 tail 并给出完整输出临时文件；`read` 更适合保留 head。[CODE] 这体现了 Tool 的一个核心职责：**不要把无限外部世界直接灌进有限模型窗口。**

### 6.7 同文件写入为什么要有第二层并发控制

上游 [issue #2327](https://github.com/earendil-works/pi/issues/2327) 记录过并行工具修改同一文件导致覆盖的历史问题。[ISSUE]

当前 `file-mutation-queue.ts` 按 canonical file path 串行化同一文件的 mutation，不同文件仍可并行。[CODE]

[`file-mutation-queue.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/tools/file-mutation-queue.ts#L28-L60)

这说明通用 loop 只应该知道“这个 Tool 是否允许并行”；真正的冲突键属于 Tool domain。[INFERENCE]

---

## 7. `Agent`：为什么薄封装仍然不可替代

`Agent` 位于 [`packages/agent/src/agent.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent.ts#L165-L574)。

### 7.1 它拥有的状态非常有限

[`AgentState`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/types.ts#L316-L347) 包含：[CODE]

```text
systemPrompt
model
thinkingLevel
tools
messages
isStreaming
streamingMessage
pendingToolCalls
errorMessage
```

没有 database handle、plugin registry、task graph、browser、workspace 等全局对象。这让 `Agent` 的状态可以被 event reducer 完整解释。

### 7.2 一次只允许一个 active run

`prompt()` 和 `continue()` 都先建立 active run；已有运行时再次调用会被拒绝。[CODE]

[`prompt()` / `continue()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent.ts#L334-L429)

这不是性能限制，而是 transcript 的单写者不变量。不同 Agent 实例可以并行；同一个 Agent 不能同时让两条模型流争夺同一 messages 数组。

### 7.3 Setter 在运行中为什么不会破坏当前 turn

`setModel`、`setThinkingLevel`、`setTools`、`setSystemPrompt` 修改 Agent 的未来状态。loop 的下一 turn 通过 `prepareNextTurn` 重新读取 snapshot，因此变化在 turn boundary 生效。[CODE]

`Agent` 不需要给每个字段上锁，因为一个 active loop 与一个明确换挡点已经限定了观察时机。

### 7.4 真正关键的是 awaited subscriber barrier

事件处理先改变内部状态，再按订阅顺序逐个等待 listener：[CODE]

```ts
private async processEvents(event: AgentEvent): Promise<void> {
  reduceRuntimeState(event);

  const signal = this.activeRun?.abortController.signal;
  for (const listener of this.listeners) {
    await listener(event, signal);
  }
}
```

对应源码：[`processEvents()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent.ts#L520-L574)。

这形成一个强顺序：

```text
loop 发 message_end
  → Agent state 已加入完整消息
  → listener A 完成
  → listener B 完成
  → loop 才能进入后续 tool preflight / turn
```

上游 [issue #1717](https://github.com/earendil-works/pi/issues/1717) 记录过异步事件处理破坏 Session 顺序的历史问题。[ISSUE] 当前 awaited barrier 正是避免“事件看似发了、持久化却还在后面追”的核心机制。[CODE]

### 7.5 `agent_end` 不是立刻 idle

类型注释明确说明：`agent_end` 是 loop 的最后一个事件，但订阅者仍属于 run settlement；只有所有 `agent_end` listeners 完成，`finishRun()` 才清掉 streaming/pending 状态并让 active run resolve。[CODE]

这让“模型停止输出”和“整个 Agent 运行已经结算”成为两个可区分的时间点。

### 7.6 Listener 的代价

因为 listener 在热路径上被 await：

- 持久化、策略和顺序敏感处理非常可靠；
- 一个慢 listener 也会直接拉长 Agent latency；
- listener 抛错会中止流程；
- 非关键 telemetry 不应在 listener 内做无界网络等待。[INFERENCE]

Pi 选择的是可解释顺序，而不是“事件 fire-and-forget 后祈祷副作用来得及”。这是一个值得保留的设计取舍。

---

## 8. `AgentHarness`：把最小循环升级成完整 Agent Core

`AgentHarness` 是本文最重要的第二个对象。`agentLoop()` 说明 Agent 如何运行；Harness 说明一次运行如何进入真实应用。

实现：[`packages/agent/src/harness/agent-harness.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/agent-harness.ts#L164-L953)。

![[AIGC/assets/pi-agent-core/06-harness-lifecycle.svg]]

### 8.1 Harness 聚合什么

类内部状态包括：[CODE]

```text
env                   ExecutionEnv
session               Session
models                Models
phase                 idle / turn / compaction / branch_summary / retry
model / thinking
systemPrompt builder
streamOptions
resources             skills / prompt templates
tools / activeTools
steer / followUp / nextTurn queues
pendingSessionWrites
handlers
AbortController / runPromise
```

这是一份“单个会话 Agent runtime”的完整清单，但仍没有全局 scheduler、全局数据库或 UI。

### 8.2 Phase 是清楚的有限状态机

`AgentHarnessPhase` 只有：[CODE]

```ts
"idle" | "turn" | "compaction" | "branch_summary" | "retry"
```

`prompt()`、`skill()`、`promptFromTemplate()` 都要求 `phase === "idle"`，否则抛 `busy`。`compact()` 和 `navigateTree()` 同样只允许 idle。[CODE]

这个约束避免：

- 一边 stream，一边重建 branch；
- 两次 prompt 共写 Session；
- compact 与新消息同时选择 cut point；
- 运行中直接换 leaf。

### 8.3 `createTurnState()`：所有可变输入先做快照

每个 turn 开始前，Harness 会读取：[CODE]

- `session.buildContext()`；
- resources；
- session metadata/id；
- 完整 tools 与 active tools；
- system prompt；
- stream options；
- model；
- thinking level。

对应源码：[`createTurnState()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/agent-harness.ts#L321-L353)。

返回的 `AgentHarnessTurnState` 是一次 provider request 前的稳定视图。运行中资源或模型发生变化，也只会在 `prepareNextTurn` 重建 snapshot 后影响下一 turn。[CODE]

这使“热更新”与“运行一致性”不冲突：配置可以变，但不会在一条 assistant stream 中途变。

### 8.4 `createLoopConfig()`：Harness 如何接入低层 loop

Harness 没有复制 loop，而是构造 `AgentLoopConfig`：[CODE]

```ts
return {
  model: turnState.model,
  reasoning: turnState.thinkingLevel,
  convertToLlm,

  transformContext: messages => emitHook("context", messages),
  beforeToolCall: call => emitHook("tool_call", call),
  afterToolCall: result => emitHook("tool_result", result),

  prepareNextTurn: async () => {
    await flushPendingSessionWrites();
    const next = await createTurnState();
    return { context: createContext(next), model: next.model, ... };
  },

  getSteeringMessages: () => drain(steerQueue),
  getFollowUpMessages: () => drain(followUpQueue),
};
```

对应源码：[`createLoopConfig()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/agent-harness.ts#L406-L455)。

这是很典型的 adapter：Harness 把自己的 Session/Hook/queue 语义翻译成低层 loop 已经定义好的几个插槽。

### 8.5 `createStreamFn()`：Provider 生命周期也被纳入 Harness

Harness 从 `Models` 建立 stream function，在真正请求前后发出：[CODE]

- `before_provider_request`；
- `before_provider_payload`；
- `after_provider_response`。

并将 cache retention、headers、retry、metadata、timeout、transport、session id 等 snapshot options 传给 `models.streamSimple()`。[CODE]

对应源码：[`createStreamFn()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/agent-harness.ts#L366-L391)。

因此 Provider 不是绕过 Harness 的黑盒网络调用；应用可以在统一生命周期中观察和微调请求。

### 8.6 `before_agent_start` 能改变什么

在真正调用 loop 前，Harness 发 `before_agent_start`。Hook 可以：[CODE]

- 附加 messages；
- 替换本次 run 的 system prompt。

然后 Harness 创建 AbortController，调用 `runAgentLoop(...)`，把所有 event 交给 `handleAgentEvent()`。[CODE]

[`executeTurn()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/agent-harness.ts#L538-L613)

### 8.7 事件如何变成持久化顺序

`handleAgentEvent()` 对三个事件有特殊处理：[CODE]

#### `message_end`

```text
session.appendMessage(message)
→ emitAny(event)
```

先落 Session，再让外部 handler 看见完整 message。这意味着 handler 收到 `message_end` 时，Session 已经包含它。

#### `turn_end`

```text
emitAny(turn_end)
→ flush pending session writes
→ emit save_point
```

即便 `turn_end` handler 抛错，Harness 也会先尝试 flush pending writes，然后再重新抛出 event error。[CODE]

#### `agent_end`

```text
flush pending writes
→ phase = idle
→ emit agent_end
→ emit settled
```

对应源码：[`handleAgentEvent()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/agent-harness.ts#L495-L522)。

这就是 Harness 比裸 Agent 更完整的地方：它不仅发事件，还定义事件与 Session durable operation 的相对顺序。

### 8.8 为什么运行中的 setter 会排队写 Session

Harness 运行时调用 `appendMessage()`、`setModel()`、`setThinkingLevel()`、`setActiveTools()` 等，不会立即与当前消息交错写入，而是进入 `pendingSessionWrites`；turn boundary 再按队列顺序 flush。[CODE]

[`flushPendingSessionWrites()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/agent-harness.ts#L469-L493)

这个机制同时解决：

- 当前 turn 使用旧 snapshot；
- 新配置被记录到事件树；
- 下一 turn 从 Session fold 出新配置；
- transcript 顺序不会因异步 setter 随机变化。

### 8.9 三种排队消息不是重复 API

Harness 有 `steer()`、`followUp()`、`nextTurn()`：[CODE]

- `steer`：当前 run 的工具批次后进入 inner loop；
- `followUp`：当前 run 本来结束时重新进入 outer loop；
- `nextTurn`：下一次显式 `prompt/skill/template` 开始时，排在它前面。

`steer/followUp` 在 idle 时拒绝，`nextTurn` 可以提前排队。[CODE]

[`steer()` / `followUp()` / `nextTurn()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/agent-harness.ts#L664-L679)

### 8.10 失败路径也补齐生命周期

如果 loop 抛出非正常异常，Harness 构造 failure assistant message，并依次处理：

```text
message_start
message_end
turn_end
agent_end
```

对应源码：[`emitRunFailure()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/agent-harness.ts#L524-L535)。

所以订阅者不需要为“正常 provider error”和“意外运行时 throw”维护两套完全不同的收尾状态机。

### 8.11 Harness 是公开 API，但文档仍不如测试完整

固定修订中，Harness 已从 `packages/agent/src/index.ts` 公开导出。[CODE] 它也有大量 harness tests，但对外 README 的叙述还没有覆盖所有 Session、Hook 与 phase 语义。[DOC][INFERENCE]

因此使用 Harness 时，测试文件是重要的 executable specification：

- `packages/agent/test/harness/agent-harness.test.ts`
- `packages/agent/test/harness/agent-harness-stream.test.ts`
- `packages/agent/test/harness/session.test.ts`
- `packages/agent/test/harness/compaction.test.ts`

---

## 9. Model / Provider：让 Agent Loop 与供应商无关

核心接口位于 [`packages/ai/src/models.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/ai/src/models.ts#L66-L187)。

### 9.1 `Provider` 负责能力集合

Provider 描述：[CODE]

- provider id/name；
- models；
- stream implementation；
- API key / OAuth 解析；
- 可选动态 model source。

Agent 不需要一串 `if provider === ...`。`ModelsImpl` 根据 `model.provider` 找 Provider、解析认证，再按 model API 选择 stream 实现。[CODE]

[`ModelsImpl` auth/dispatch](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/ai/src/models.ts#L455-L526)

### 9.2 `Models` 是运行时集合

`Models` 对外提供：[CODE]

```text
getModel(provider, id)
getModels()
getProviders()
getApiKey(model)
stream / streamSimple
login / logout / auth status
refresh provider models
```

Harness 只依赖该集合，不直接依赖每个 provider package。

### 9.3 动态认证为什么按每次 LLM call 解析

`AgentLoopConfig.getApiKey` 的注释明确支持短期 OAuth token；工具阶段可能很长，token 在下一次模型调用前已经过期。[CODE]

所以认证不是 Agent 构造时解析一次永久缓存，而是每个 provider request 可以重新获取。这是长任务 Agent 很实际的细节。

### 9.4 Provider 统一不等于所有模型完全同构

统一接口仍保留 model metadata、api、thinking level、context window、capabilities 等差异。[CODE] Pi 没有为了表面统一把供应商能力压成最小公分母，而是让 `Model<Api>` 保留具体 API 类型。

代价是 provider/catalog 代码量很大，并且生成模型目录会快速变化。本文构建时 `npm run build` 实际联网刷新多个模型目录并改动生成文件，之后已恢复 worktree。[RUN]

---

## 10. Hook：Core 的生命周期插槽

Hook 的作用是：不 fork 主循环，也能在关键边界观察、拒绝或变换行为。

### 10.1 低层 Agent Loop Hook

`AgentLoopConfig` 提供：[CODE]

| Hook | 时机 | 能力 |
|---|---|---|
| `transformContext` | 每次 provider 前 | 裁剪、注入或重排 AgentMessage |
| `convertToLlm` | provider 前 | 转换/过滤自定义消息 |
| `beforeToolCall` | schema 校验后、执行前 | block tool |
| `afterToolCall` | execute 后、结束事件前 | 替换 result 字段 |
| `shouldStopAfterTurn` | turn 完整结束后 | 优雅终止 |
| `prepareNextTurn` | 下一次 provider 前 | 更新 context/model/thinking |
| queue getters | 对应 drain point | 注入 steering/follow-up |

这些 Hook 都围绕 loop 的真实状态转折，而不是随意的“middleware before/after everything”。

### 10.2 Harness Hook 更接近应用生命周期

Harness event/result map 覆盖：[CODE]

```text
before_agent_start
context
before_provider_request
before_provider_payload
after_provider_response
tool_call / tool_result
compaction / branch_summary
model / thinking / tools / resources change
queue_update / save_point / settled
```

完整定义：[`harness/types.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/types.ts#L525-L726)。

### 10.3 Handler 顺序与返回值合并

Harness 用 `Set` 保存同一 event type 的 handlers，并按注册顺序 `await`。对于有返回值的 Hook，最后一个非 `undefined` 结果胜出；错误被归一化后抛出。[CODE]

[`emitHook()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/agent-harness.ts#L219-L255)

这是一种简单、确定的组合规则。代价是多个 Hook 不能自动 deep merge patch；如果两个策略都要改同一对象，必须显式安排注册顺序或合成一个 Hook。[INFERENCE]

### 10.4 没有 batch-level Tool Hook

当前 preflight 是 per tool call 的。Hook 看不到“整批工具调用作为一个原子事务”的授权点。[CODE] 上游 [issue #6816](https://github.com/earendil-works/pi/issues/6816) 请求 batch hook，最终关闭为 not planned。[ISSUE]

如果业务要求一批动作 all-or-nothing，应该把它建模成一个事务型 Tool，而不是期待 per-call Hook 自动提供批次事务。[INFERENCE]

---

## 11. Extension：它比 Hook 更强，也更危险

coding-agent Extension 是 Core 之上的应用扩展系统。

### 11.1 它加载的是宿主代码

Extension loader 使用 `jiti` 动态加载 TypeScript/JavaScript 模块。[CODE]

[`extensions/loader.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/extensions/loader.ts#L403-L427)

Extension 可以注册：[CODE]

- Tool；
- command；
- shortcut；
- flag；
- provider；
- message renderer；
- 生命周期 handler；
- UI interaction。

[`ExtensionAPI` 注册实现](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/extensions/loader.ts#L225-L337)

### 11.2 Hook 与 Extension 的边界

| 机制 | 运行位置 | 能力 | 信任级别 |
|---|---|---|---|
| Core Hook | Agent/Harness 定义的插槽 | 观察、block、有限 patch | 仍是应用代码 |
| Extension | coding-agent 宿主进程 | 注册新能力、读写任意宿主资源 | 等同宿主程序 |

Extension 不是受限插件沙箱。它可以直接访问 `process.env`、文件和网络。[CODE]

### 11.3 Tool input 原地修改的细节

coding-agent 的 `tool_call` event 明确允许 handler 原地修改 input。[CODE]

[`extensions/types.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/extensions/types.ts#L1057-L1061)

`AgentSession` 把已经通过 Core schema 校验的参数交给 Extension，之后执行修改后的对象；当前路径没有再跑一次 schema validation。[CODE]

[`AgentSession` tool_call bridge](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/agent-session.ts#L449-L496)

在 Extension 被视为宿主可信代码的前提下，这是一种强扩展能力；但它再次说明 Extension/Hook 不是安全边界。[INFERENCE]

### 11.4 Extension handler 的错误语义与 Core 不完全相同

Extension runner 中，一些通用 handler 错误会被报告并吞掉，tool result patch 会按 handler 链依次应用，tool_call 则在遇到第一个 block 时返回。[CODE]

[`extensions/runner.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/extensions/runner.ts#L860-L931)

因此不能把“Core Hook 抛错中止”与“所有 Extension event 都抛错中止”混为一谈。两层的 failure policy 不同。

### 11.5 旧 Extension runtime 会被失效

loader 会让被替换 Session 捕获的旧 runtime context 失效，防止 reload 后的 Extension 继续操作已经不属于它的 Session。[CODE]

[`invalidate stale runtime`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/extensions/loader.ts#L174-L205)

这是热重载中很容易漏掉的生命周期控制。

---

## 12. Skill：按需加载的程序性上下文

Skill 经常被错误理解成“另一种 Tool”。Pi 的实现清楚地表明：Skill 本质是**给模型的指令与参考资料包**，不直接执行副作用。

![[AIGC/assets/pi-agent-core/04-skill-disclosure.svg]]

### 12.1 渐进披露分成三层

```text
发现层
  扫描 SKILL.md / root markdown
  解析 frontmatter、ignore、路径

索引层
  system prompt 只展示 name / description / location

调用层
  匹配或显式 harness.skill(name)
  才注入完整 content，并以 Skill 目录解析 references/scripts/assets
```

这种设计把“模型知道有哪些能力”和“模型立即读完所有能力”分开。

### 12.2 系统提示只放元数据

[`formatSkillsForSystemPrompt()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/system-prompt.ts#L3-L24) 只输出类似：[CODE]

```xml
<available_skills>
  <skill>
    <name>...</name>
    <description>...</description>
    <location>...</location>
  </skill>
</available_skills>
```

没有完整 Skill 正文。这使每个 turn 的常驻 token 成本与 Skill 数量近似按 metadata 增长，而不是按全部文档总长度增长。[INFERENCE]

### 12.3 显式调用才注入正文

`formatSkillInvocation()` 会把完整内容放入消息，并提示相对引用以 Skill 文件所在目录为基准。[CODE]

[`formatSkillInvocation()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/skills.ts#L37-L75)

Harness 的 `skill(name, additionalInstructions?)`：

1. 要求 idle；
2. 建立 turn snapshot；
3. 从 snapshot resources 找 Skill；
4. 格式化完整调用；
5. 仍然走同一个 `executeTurn()`。[CODE]

[`AgentHarness.skill()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/agent-harness.ts#L630-L645)

Skill 没有另一套执行器。它只是产生一条特殊但普通的 prompt，之后完全复用 Agent Core。

### 12.4 资源发现与 ignore

Harness loader 支持递归发现 `SKILL.md` 或 root markdown、读取 frontmatter、应用 ignore 规则并产生 diagnostics。[CODE]

[`harness/skills.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/skills.ts#L103-L230)

关键点不是“会扫描文件夹”，而是 loader 返回结构化结果与 diagnostics；非法 Skill 不必让整个 Agent 启动崩溃。

### 12.5 coding-agent 的来源优先级

coding-agent 在底层 loader 上增加来源：user、project、explicit path。固定修订中的加载顺序是 user → project → explicit paths；同名 Skill 第一个获胜，后续冲突产生 diagnostic。[CODE]

[`coding-agent/core/skills.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/skills.ts#L387-L486)

这是 coding-agent 的应用策略，不是 Agent Core 的永久语义。Harness 只拿最终 `resources.skills`，资源从哪里来仍由应用决定。[CODE]

### 12.6 Skill、Tool、Hook 的准确区分

| 概念 | 对模型可见 | 是否执行副作用 | 生命周期 |
|---|---|---|---|
| Skill | metadata 常驻，正文按需 | 不直接执行 | 被选择时转成 prompt |
| Tool | name/description/schema 可见 | 是 | model toolCall 驱动 |
| Hook | 通常不可见 | 可观察、block、patch | runtime event 驱动 |

把 Skill 做成 Tool 会让“读说明”变成副作用 API；把 Tool 做成 Skill 会失去 schema 与结果协议；把 Hook 暴露给模型又会让生命周期控制变成模型可选行为。Pi 的三分法非常稳定。

---

## 13. Session：追加式事件树如何生成当前上下文

Pi Harness Session 不是 `messages[]` 的别名，而是一棵带 parent relation 的追加式事件树。

![[AIGC/assets/pi-agent-core/05-session-tree.svg]]

### 13.1 Entry union 保存的不只是消息

Session tree entry 包括：[CODE]

```text
message
model_change
thinking_level_change
tools_change
compaction
branch_summary
custom
custom_message
label
session_info
leaf
```

对应定义：[`harness/types.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/types.ts#L334-L420)。

因此一条 Session 路径能还原：

- 模型看到的对话；
- 当时选择的 model/thinking/tools；
- 哪段历史被 compaction summary 替代；
- 当前 active branch；
- 哪些 custom data 只供应用使用；
- 哪些 custom message 应进入模型。

### 13.2 每个新 entry 指向当前 leaf

append 时，新 entry 的 `parentId` 是当前 leaf id；写入后它成为新的 current leaf。[CODE] 如果切换 leaf，再 append，就从旧节点长出另一条分支。

这比复制整份 messages 创建分支更节省，也保留共同祖先的唯一身份。

### 13.3 当前配置通过 fold 得出

[`getSessionContext()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/session/session.ts#L37-L55) 沿 root → leaf 路径折叠 model、thinking level、active tools 等状态。[CODE]

状态不需要另外维护一张容易漂移的“当前配置表”；事件路径就是事实来源。

### 13.4 `buildContext()` 是逻辑投影

Session 不会把所有 entry 原封不动发给模型。投影规则包括：[CODE]

- `message` 进入上下文；
- `custom` 默认不进入模型；
- `custom_message` 可以投影为模型消息；
- 最近 compaction summary 替代被压缩的旧历史；
- compaction cut point 之后的近期消息完整保留；
- model/thinking/tools 通过 fold 形成运行配置，不变成聊天文本。

对应源码：

- [`latest compaction transform`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/session/session.ts#L57-L80)
- [`messages projection`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/session/session.ts#L93-L134)
- [`current branch`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/session/session.ts#L166-L176)

Session tree 是物理历史，AgentContext 是逻辑视图。这个区分让压缩、分支和自定义事件都不需要篡改原始历史。

### 13.5 `leaf` 本身也是 append-only entry

JSONL storage 的 `setLeafId()` 不会回写旧 header，而是追加一个 leaf entry，记录目标 id。[CODE]

[`setLeafId()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/session/jsonl-storage.ts#L247-L265)

这样“用户何时切到哪条分支”本身也保留在日志里。

### 13.6 JSONL version 3 的文件结构

首行是 header：[CODE]

```json
{
  "type": "session",
  "version": 3,
  "id": "...",
  "timestamp": "...",
  "cwd": "...",
  "parentSession": "...",
  "metadata": {}
}
```

后续每行一个 entry。loader 严格校验 header version、id、timestamp、cwd、metadata 和每一行 entry。[CODE]

[`jsonl-storage.ts` parse/load](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/session/jsonl-storage.ts#L8-L177)

### 13.7 先 append 磁盘，再更新内存

核心顺序：[CODE]

```ts
await fs.appendFile(path, JSON.stringify(entry) + "\n");
entries.set(entry.id, entry);
currentLeafId = entry.id;
```

[`JsonlSessionStorage.append()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/session/jsonl-storage.ts#L271-L280)

如果磁盘写失败，内存不会产生一个不存在于文件中的新 parent。这个顺序是正确的。[INFERENCE]

### 13.8 但 JSONL 不是数据库事务

固定实现没有显示：[CODE][INFERENCE]

- fsync；
- 跨进程锁；
- 原子整 turn transaction；
- write-ahead recovery；
- malformed tail 自动修复。

因此正确使用模型是：一个 Session 一个写者。上游 [issue #6242](https://github.com/earendil-works/pi/issues/6242) 的维护者讨论也指出，多个外部 caller 并发写需要在 Session 层串行化。[ISSUE]

### 13.9 严格加载的代价

新 Harness JSONL loader 遇到 malformed line 会拒绝整个 Session。[CODE] 这有利于暴露损坏，却降低了 crash-torn tail 的容忍度。

coding-agent 旧 `SessionManager` 则会跳过无法解析的行：[CODE]

[`SessionManager` parse/skip](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/session-manager.ts#L499-L552)

仓库中两套 persistence path 的恢复策略不同，是当前值得关注的架构漂移风险。[INFERENCE]

### 13.10 `JsonlSessionRepo` 管目录与 fork

Repo 层负责：

- 按 cwd 映射 session directory；
- create/open/list/delete；
- fork 到新 Session；
- 加载 metadata。

[`jsonl-repo.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/session/jsonl-repo.ts#L34-L179)

Session 负责一棵树的语义，Repo 负责多份 Session 文件的集合。这也是清楚的职责分离。

---

## 14. Compaction：保留历史，只改变模型视图

Compaction 不是 `messages = messages.slice(-N)`。Pi 把它建模为一种新的 Session entry，并让 `buildContext()` 用 summary 投影替换旧历史。[CODE]

### 14.1 默认策略

固定修订默认：[CODE]

```ts
{
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
}
```

[`DEFAULT_COMPACTION_SETTINGS`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/compaction/compaction.ts#L108-L123)

大意是当预计 context usage 超过 `model window - reserveTokens` 时，需要压缩，同时尽量完整保留最近约 20k tokens。

### 14.2 Token 估计是启发式

普通文本近似 `chars / 4`，图片单独估算；usage 信息可来自最近 assistant message。[CODE]

- [`calculate/estimate context tokens`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/compaction/compaction.ts#L125-L210)
- [`text/image estimation`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/compaction/compaction.ts#L213-L271)

估计便宜，但不是 provider tokenizer 的精确结果。reserve tokens 正是为误差和新输出留余量。[INFERENCE]

### 14.3 Cut point 尊重消息结构

切点选择会寻找合适的 turn start，并避免从 tool result 中间切开对应关系。[CODE] 这是 provider message protocol 的必要约束：tool result 通常必须对应前面的 assistant tool call id。

### 14.4 摘要保留工作状态

Compaction utils 会从工具调用中提取 read/modified files，并把这些信息放入 summary；进入摘要 prompt 的长 tool result 会截到 2,000 字符。[CODE]

[`compaction/utils.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/compaction/utils.ts#L23-L131)

好的 Agent summary 不能只说“讨论了哪些主题”，还必须保留继续工作需要的状态。Pi 对文件操作的显式保留就是这个原则的具体实现。

### 14.5 原始历史没有删除

Compaction entry 指向旧路径并保存 summary；物理 ancestors 仍在 Session tree 中。[CODE] 所以：

- 可以审计摘要；
- 可以换 branch；
- 可以将来用不同策略重新压缩；
- 模型当前看到的上下文与真实历史可以区分。

### 14.6 自动 compact-and-retry 是有界的

coding-agent 旧 `AgentSession` 在 overflow 时可以 compact 后重跑，但只做一次 compact-and-retry，防止无限压缩循环。[CODE]

[`agent-session.ts` overflow retry](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/agent-session.ts#L1915-L1984)

### 14.7 摘要仍然是有损模型输出

即使保留 file ops，summary 仍可能遗漏：

- 用户的细小约束；
- 某个 Tool failure 的原因；
- 未结构化的 pending task；
- 多轮推理中的否定结论。

因此 Compaction 的正确语义是“产生新的推理视图”，不是“证明旧内容已无用”。[INFERENCE]

---

## 15. Branch Navigation：为什么 Session 必须是一棵树

如果只有线性 messages，修改历史消息通常只能：

- 丢弃后续内容；
- 复制整份 Session；
- 或在一个数组中维护复杂的隐藏标记。

Pi 的 parentId 树让 branch 成为自然操作。

### 15.1 导航不是删除

`navigateTree(targetId)` 在 idle phase 执行：[CODE]

1. 找到目标 entry；
2. 比较当前 branch 与目标 branch；
3. 必要时为离开的分支生成 branch summary；
4. 设置新的 leaf；
5. 让下次 `buildContext()` 从新路径投影。

旧 branch 仍然存在，只是当前 leaf 改了。

### 15.2 Branch Summary 与 Compaction Summary 不同

- **Compaction summary**：替代当前路径中过旧的上下文。
- **Branch summary**：在跳离一条已经产生工作成果的分支时，把必要信息带到新分支。

两者都使用摘要，但触发原因和 provenance 不同。[CODE]

实现入口：

- [`branch-summarization.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/compaction/branch-summarization.ts)
- [`AgentHarness.navigateTree()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/agent-harness.ts#L743-L807)

### 15.3 为什么 branch 属于 Harness，不属于 loop

`agentLoop()` 只需要一个当前 context。它不应该知道 context 是来自直线历史、某个 Git 分支还是数据库 snapshot。

Harness 在 turn 之前把选中 branch 投影成 `AgentContext`，loop 完全复用。这个边界再次证明 Pi 没有让持久化结构污染执行内核。[INFERENCE]

---

## 16. Subagent：它是组合模式，不是 Agent Loop 原语

Pi coding-agent README 明确列出不内建 subagents。[DOC]

[`packages/coding-agent/README.md`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/README.md#L491-L505)

仓库提供了一个示例 Extension，说明如何把子 Agent 组合成 Tool；这与“Core 原生有 Subagent scheduler”是两件事。

![[AIGC/assets/pi-agent-core/07-core-boundaries.svg]]

### 16.1 示例如何工作

示例 Tool 支持三种模式：[CODE]

- `single`：运行一个子任务；
- `parallel`：多个子任务并行；
- `chain`：上一任务输出成为下一任务输入。

每个任务通过独立进程启动：

```text
pi --mode json -p --no-session
```

并将 prompt 写入子进程，消费 JSON event stream，最后收集结果。[CODE]

[`subagent/index.ts` 进程启动与收集](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/examples/extensions/subagent/index.ts#L267-L414)

### 16.2 并发是明确受限的

示例最多接受 8 个任务，并发上限 4。[CODE] 这避免模型一次生成几十个 subagents 直接耗尽进程资源。

[`single/parallel/chain execution`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/examples/extensions/subagent/index.ts#L460-L698)

### 16.3 取消映射到进程生命周期

父 Tool 收到 abort 后，先向子进程发 `SIGTERM`，必要时再 `SIGKILL`。[CODE] 相比只在内存中设一个布尔值，进程边界让取消更真实。

### 16.4 为什么不把 Subagent 放进 `agentLoop()`

如果 Core 原生理解 Subagent，它必须同时理解：

- 子任务 DAG；
- 全局并发；
- 子任务预算；
- 父子上下文继承；
- 工具能力继承；
- 失败聚合；
- 取消树；
- 进程/容器生命周期。

这些都不是“一次 assistant response 如何执行工具”的问题。Pi 选择把 `spawn subagent` 表达为一个普通 Tool，因此主 loop 一行都不用改。[CODE][INFERENCE]

### 16.5 示例不是生产调度器

上游 [issue #6298](https://github.com/earendil-works/pi/issues/6298) 讨论过示例在多租户、scope、confirm flag、默认工具继承等方面的尖角，最终关闭为 not planned。[ISSUE]

正确解读是：

- 示例证明组合拓扑可行；
- 它不是 Core 的稳定 API；
- 它没有承诺完整租户隔离、全局预算和故障恢复；
- 是否需要更强调度器，由具体应用决定。

### 16.6 `packages/orchestrator` 也不是成熟 Core

该 package README 开头明确写着 experimental，未来可能移除。[DOC]

[`packages/orchestrator/README.md`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/orchestrator/README.md#L1-L4)

所以本文不会把 experimental orchestrator 反向解释成 `pi-agent-core` 的正式组成部分。

---

## 17. Sandbox：Core 为什么明确不负责权限隔离

Pi 根 README 直接说明没有内置 permission prompts，并建议使用 Gondolin、Docker 或 OpenShell。[DOC]

[`README.md` Sandbox 说明](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/README.md#L37-L45)

仓库 [`SECURITY.md`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/SECURITY.md) 进一步明确：[DOC]

- Pi 以本地用户权限运行；
- 缺少 Sandbox 不属于其安全漏洞边界；
- prompt injection 不被视为 Pi 自身漏洞；
- 不受信 Extension 的行为不在其安全承诺中。

### 17.1 内置工具使用宿主权限

coding-agent 路径解析允许绝对路径，不做 cwd containment。[CODE]

[`path-utils.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/tools/path-utils.ts#L44-L50)

`NodeExecutionEnv.resolvePath()` 对绝对路径直接返回；shell 使用 `bash -c` 并合并 `process.env`。[CODE]

- [`NodeExecutionEnv.resolvePath()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/env/nodejs.ts#L47-L49)
- [`shell env / exec`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/env/nodejs.ts#L213-L390)

所以：

```text
cwd = /workspace
```

只表示相对路径基准，不表示进程无法访问 `/etc`、用户目录或其他挂载点。

### 17.2 Project trust 不是 Sandbox

coding-agent 安全文档说明 project trust 主要控制项目资源加载；built-in tools 和 Extension 仍以当前用户权限运行。[DOC]

[`packages/coding-agent/docs/security.md`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/docs/security.md)

Trust 可以回答“是否加载这个项目的 Skill/Extension”，不能回答“加载后代码最多能访问什么”。

### 17.3 Hook 也不是 Sandbox

`beforeToolCall` 可以 block 已知 Tool call，但无法约束：

- Extension 自己直接调用 Node fs/network；
- Tool 内部绕过约定访问其他路径；
- shell 子进程派生更多进程；
- 进程读取环境中的秘密；
- prompt injection 诱导一个本来被允许的 Tool 做危险操作。

Hook 是 policy insertion point，不是强制执行边界。[INFERENCE]

### 17.4 为什么这个“不负责”反而是正确设计

文件系统、网络、进程、凭证和资源上限，只有 OS/container/VM 才能一致约束。让 Agent Core 自己模拟这些权限，最终仍会被 Extension 或宿主 API 绕过。

Pi 的正确之处不是“默认安全”，而是**没有把应用层 allow/deny 包装成虚假的强隔离**。[DOC][INFERENCE]

### 17.5 Core 仍然提供了适合接安全策略的点

虽然不提供 Sandbox，Core 已提供：

- TypeBox 参数校验；
- before/after tool hook；
- AbortSignal；
- Tool execution mode；
- provider request hooks；
- event stream；
- active tool selection；
- application-owned resources。

这些是把 Core 放进真正隔离环境时所需的控制接口，但最终 enforcement 仍在外部。

---

## 18. Headless、RPC 与 TUI：哪些是 Core，哪些只是入口

Pi 支持 TUI、print/JSON mode 和 RPC。它们共享 Core，但不是 Core 本身。

### 18.1 TUI 不定义 Agent 语义

流式 token、tool progress、message lifecycle 经常被误认为 TUI 功能。实际上这些 event 在 `packages/agent` 定义；TUI 只是 subscriber 之一。[CODE]

即使完全移除 TUI，以下机制仍存在：

- partial assistant message；
- tool progress；
- abort；
- queue；
- Session；
- Hook；
- compaction。

### 18.2 RPC 是 coding-agent 的适配层

RPC 命令 union 包含 prompt、steer、follow_up、abort、model/thinking、compact、session switch/fork 等操作。[CODE]

[`rpc-types.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/modes/rpc/rpc-types.ts#L1-L223)

RPC 把 coding-agent 的 `AgentSession` 暴露为 JSONL 协议；它不是 `agentLoop` 自己的一部分。

### 18.3 stdout 必须是协议专用通道

上游 [issue #2388](https://github.com/earendil-works/pi/issues/2388) 记录过 Extension `console.log()` 污染 RPC stdout 的问题。[ISSUE]

当前 `output-guard.ts` 捕获原始 stdout，仅供 protocol writer 使用，普通 stdout 输出被重定向到 stderr；writer 自带队列和 backpressure。[CODE]

[`output-guard.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/output-guard.ts#L45-L106)

### 18.4 JSONL parser 是严格分帧器

RPC 不用宽松的“随便 readline 然后猜 JSON”，而是明确按 LF 分帧、处理残留 buffer、拒绝非法输入。[CODE]

[`modes/rpc/jsonl.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/modes/rpc/jsonl.ts#L4-L58)

### 18.5 RPC 的边界

- 本地 stdio 协议没有认证；[#6713](https://github.com/earendil-works/pi/issues/6713) 的认证请求关闭为 not planned。[ISSUE]
- input callback 以异步方式触发 command handler，parser 层本身不构造全局串行 promise chain。[CODE]
- RPC command union 没有通用的“反向请求外部进程执行任意 Tool”帧。[CODE]
- 当前 RPC 连接的是 coding-agent 旧 `AgentSession`，不等于直接暴露新 `AgentHarness` 的所有语义。[CODE]

这些都是适配层限制，不改变 Core 本身的设计质量。

---

## 19. 为什么这套 Core 显得如此简洁优美

“简洁”不能只凭代码行数判断。Pi 真正做对的是依赖方向和状态边界。

### 19.1 小腰部：所有复杂性最后投影成 `AgentContext`

Provider、Session、Skill、Extension、branch、compaction 最终都必须回答：

```text
本次模型调用的 systemPrompt 是什么？
messages 是什么？
tools 是什么？
```

因为腰部足够窄，应用可以替换 Session storage、Skill loader 或 Provider，而不需要改 `agentLoop()`。

### 19.2 一个事实流：Event 同时服务状态、持久化与展示

Pi 没有：

- 一套内部事件更新状态；
- 一套 callback 更新 UI；
- 一套日志事件写 Session。

`AgentEvent` 是共同事实流，`Agent` reducer、Harness persistence 和 TUI/RPC subscriber 都围绕它工作。[CODE]

### 19.3 一个换挡点：turn boundary

模型、thinking、tools、resources 与 context 的变化，都在下一 turn snapshot 统一生效。[CODE]

这比给每个可变字段设计独立锁和“立即生效”语义更简单，也更可预测。

### 19.4 一个并发原则：执行可并行，语义顺序不漂移

Pi 区分：

- 预检顺序；
- 真实完成顺序；
- transcript 顺序；
- 资源冲突顺序。

前两个在 loop，第三个由 source order 固定，第四个由 Tool 实现补充。并发控制被放在知道足够信息的最小层次。[CODE][INFERENCE]

### 19.5 一个安全原则：策略插槽不伪装成权限边界

Hook 提供 policy insertion point；OS/container 提供 enforcement。Core 不把两者混叫“permission system”。[DOC]

### 19.6 可选复杂性不强迫进入热路径

只需要纯循环时可以直接用 `runAgentLoop()`；需要状态时用 `Agent`；需要 Session/Skill/Compaction 时用 `AgentHarness`；需要本地 coding product 才进入 coding-agent。

这是一种真正的渐进复杂度：能力逐层增加，而不是所有用户都先实例化一个全能容器。

### 19.7 没有第二套隐藏调度器

Steering、follow-up、parallel tools、pending writes 都是普通数组、Map、Set、Promise 与 `while`。调试时可以沿语言原生控制流走完，不必先学一个框架私有 scheduler。

### 19.8 “快”的严格证据边界

从结构上可以确认：[CODE][INFERENCE]

- provider 原生流式；
- 独立工具默认并行；
- Skill 正文按需加载；
- Tool 输出有界；
- Core 热路径没有 workflow interpreter；
- TUI 不在 agent-core 依赖路径；
- turn snapshot 避免同一请求中反复解析资源。

本文没有做相同模型、相同网络、相同任务下的跨框架 benchmark。[RUN] 因此只能说 Pi 的结构避免了明显框架开销，不能把“代码简洁”直接宣传成“任何 workload 性能第一”。

---

## 20. 工程规模与运行验证

### 20.1 仓库不是小型概念原型

2026-07-20 快照：[RUN]

| 指标 | 数值 |
|---|---:|
| GitHub stars | 73,198 |
| forks | 9,038 |
| open issues（包含 PR） | 74 |
| commits | 5,007 |
| author identities | 281 |
| tags | 303 |
| tracked files | 1,066 |
| counted text lines | 262,389 |

Popularity 只能说明关注度，不能证明架构正确；真正有意义的是核心 package 的实现和测试分布。

### 20.2 核心 package 规模

| Package | 源码 TS 文件 | 源码行数 | 测试文件 | 测试行数 |
|---|---:|---:|---:|---:|
| `packages/agent` | 24 | 8,168 | 19 | 5,630 |
| `packages/ai` | 164 | 23,811 | 109 | 26,328 |
| `packages/coding-agent` | 175 | 54,703 | 184 | 41,079 |
| `packages/orchestrator` | 13 | 1,982 | 0 | 0 |
| `packages/tui` | 28 | 12,181 | 33 | 13,637 |

`packages/agent` 的代码量相对克制，测试/源码比例也不低；大量复杂性确实位于 provider 和具体应用，而不是 loop 本身。[RUN][INFERENCE]

### 20.3 构建与检查

在 Node `v22.23.1`、固定 SHA 下：[RUN]

| 检查 | 结果 | 分类 |
|---|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | 通过 | 安装 351 packages |
| `npm run build` | 通过 | 会联网刷新模型目录 |
| `npm run check` | 通过 | Biome、依赖锁、TS imports、shrinkwrap、tsgo、browser smoke |
| `npm audit --omit=dev --json` | 0 reported vulnerabilities | 快照结果，不代表未来 |

安装时出现 `@earendil-works/gondolin@0.12.0` 声明 Node `>=23.6` 的 engine warning，而上游 CI 使用 Node 22。[RUN][DOC] 当前 build/check 仍通过，但这是依赖/CI 版本约束需要继续观察的信号。

### 20.4 测试结果

| Suite | 结果 | 解释 |
|---|---|---|
| `packages/agent` | 15 files / 179 tests passed | Core 全部通过 |
| `packages/ai` | 78 files passed、25 skipped；566 passed、778 skipped | 大量 provider/live 条件测试跳过 |
| `packages/coding-agent` | 167 files passed、3 failed、6 skipped；1,573 passed、10 failed、47 skipped | 10 个失败均因本机缺少 `fd` 且下载失败 |
| 定向 headless tests | 9 files passed、3 skipped；92 passed、30 skipped | RPC、JSONL、Session、branch、compaction queue、Extension、Skill |

上游 CI 显式安装 `fd`，所以本地 10 个失败分类为**缺失系统依赖**，不是已确认的 Agent Core product failure。[RUN][DOC]

### 20.5 CI 与供应链信号

根 README 说明：[DOC]

- 依赖使用精确版本；
- 提交 npm shrinkwrap；
- install 忽略 scripts；
- 检查 npm audit signatures。

[`README.md` supply-chain 说明](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/README.md#L61-L73)

CI 使用 Node 22，安装系统依赖后执行 install/build/check/test；另有定时 npm audit workflow。[DOC]

### 20.6 构建不是完全离线可复现

本次 `npm run build` 实际请求 models.dev、NVIDIA、OpenRouter、Vercel 等来源生成模型 catalogs，并修改生成文件。[RUN]

Git SHA 固定并不自动保证生成 catalog 固定。若要严格复现，需要固定远程输入或把生成 artifacts 当受审制品。[INFERENCE]

### 20.7 HEAD 与最近 release 标签差异不小

HEAD 比 `v0.80.10` 多 40 commits；仅 `packages/agent`、`packages/ai`、`packages/coding-agent` 的 tag→HEAD diff 就涉及 136 个文件、7,687 行新增、19,547 行删除。[RUN]

因此评审和升级应记录完整 SHA/制品 digest，不能只记录 package.json 中仍为 `0.80.10` 的字符串。

---

## 21. 非显然的限制与架构代价

Pi 的 Core 很好，但“简洁”不是没有代价。

### 21.1 Event barrier 会传播慢订阅者延迟

**事实**：listener 顺序 await。[CODE]

**收益**：状态、持久化、策略有强顺序。

**代价**：慢 subscriber 直接阻塞 loop；某个遥测服务抖动也可能拖慢 Agent。

### 21.2 并发模式粒度只有工具级

**事实**：全局/单 Tool 只有 parallel 或 sequential。[CODE]

**收益**：模型简单、行为可解释。

**代价**：无法由 Core 表达 `file:A` 与 `file:B` 可并行、同文件串行；需要 Tool 自己实现 resource lock。

### 21.3 Per-call Hook 不能提供批次事务

**事实**：没有 batch-level authorization hook。[CODE][ISSUE]

**收益**：preflight 简单，单个调用可以独立 block。

**代价**：多个 tool calls 的 all-or-nothing 语义必须封装成一个 Tool 或在更外层实现。

### 21.4 JSONL 的 crash consistency 有限

**事实**：append-first 再更新内存，但没有显示 fsync、lock、transaction。[CODE]

**收益**：实现小、可读、append-only、便于本地检查。

**代价**：torn tail、跨进程写、磁盘 durability 不等同数据库。

### 21.5 新旧 Session 路径并存

**事实**：`AgentHarness` 新 Session 与 coding-agent 旧 `SessionManager` 的错误恢复策略不同。[CODE]

**风险**：RPC/TUI 与直接 Harness 使用者可能观察到不同 persistence behavior。

### 21.6 Compaction 依赖有损摘要与启发式 token

**事实**：chars/4 等估算；summary 由模型产生。[CODE]

**收益**：跨 provider、低成本、实现通用。

**代价**：可能过早/过晚压缩，也可能遗漏细约束。

### 21.7 Extension 是完全信任代码

**事实**：jiti 在宿主加载 TS/JS；project trust 不是 sandbox。[CODE][DOC]

**收益**：扩展能力极强，开发简单。

**代价**：不能安全加载不可信 Extension；任意 host API 都可能绕过 Tool Hook。

### 21.8 默认工具不是路径沙箱

**事实**：允许绝对路径，shell 合并宿主环境。[CODE]

**收益**：本地 coding-agent 不受人为目录限制。

**代价**：运行不可信仓库/提示时必须依赖外部隔离。

### 21.9 AgentHarness 的公开文档仍在追赶代码

**事实**：Harness 已公开导出并有测试，但 README 对其全部 lifecycle/session 语义覆盖有限。[CODE][DOC]

**代价**：升级时需要读 tests 与 source，不能只依赖高层文档。

### 21.10 没有通用性能冠军证据

**事实**：本文没有跨框架 benchmark。[RUN]

**边界**：可以赞赏它的热路径结构，不能把结构优雅等同于所有任务绝对最快。

---

## 22. 关键架构决策表

| 决策 | 收益 | 代价 | 可能替代 | 证据 |
|---|---|---|---|---|
| 双层 while 而非 workflow graph | 控制流可读、自然支持 tool/steering/follow-up | 不直接表达复杂 DAG | 外部 orchestrator | [CODE] `agent-loop.ts` |
| Event listener await | 强顺序、持久化可作 barrier | 慢 listener 增加延迟 | fire-and-forget event bus | [CODE] `agent.ts` |
| Tool 默认并行、结果原序 | 低 latency 且 transcript 稳定 | 资源冲突需 Tool 自理 | 全局串行 | [CODE] parallel path |
| Session append-only tree | 分支、审计、compaction 投影自然 | storage/recovery 更复杂 | 线性 messages + snapshots | [CODE] Session storage |
| Skill 渐进披露 | 降低常驻 token | 依赖模型正确选择/读取 | 全量注入 | [CODE] system-prompt/skills |
| Resources 由应用拥有 | Harness 不绑定目录/租户策略 | 应用必须实现加载治理 | Harness 自动全局扫描 | [CODE] options comment |
| Subagent 作为 Tool 示例 | Core 不引入 DAG 调度复杂性 | 应用需另做生产编排 | 内建 subagent runtime | [DOC][CODE] example |
| Sandbox 外置 | 真正由 OS 强制隔离 | 开箱即用的权限提示较少 | 框架内 permission UI | [DOC] SECURITY/README |

---

## 23. 核心代码阅读索引

以下链接全部固定到 `13437ca828894f43f973c630d208b488637d8fa9`。

### 23.1 最小必读路径

| 阅读目标 | 固定源码 | 为什么重要 |
|---|---|---|
| Core 类型 | [`packages/agent/src/types.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/types.ts#L17-L430) | Context、Tool、Hook、State、Event 的共同语义 |
| 双层循环 | [`agent-loop.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L155-L275) | Agent 的最小控制流 |
| 流式消息 | [`streamAssistantResponse()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L281-L373) | Provider event 如何成为状态消息 |
| 工具执行 | [`executeToolCalls()`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L376-L586) | 截断、并发、顺序、terminate |
| Tool 预检 | [`prepare/execute/finalize`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent-loop.ts#L588-L755) | 参数与 Hook 生命周期 |
| 状态包装 | [`Agent`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/agent.ts#L165-L574) | 单 active run、reducer、awaited listener |
| 应用运行时 | [`AgentHarness`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/agent-harness.ts#L164-L953) | Session、snapshot、Hook、phase、queue |

### 23.2 Session / Skill / Compaction

| 阅读目标 | 固定源码 | 为什么重要 |
|---|---|---|
| Session 投影 | [`session.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/session/session.ts#L37-L323) | tree → current context |
| JSONL storage | [`jsonl-storage.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/session/jsonl-storage.ts#L8-L308) | header、append、leaf、path |
| Session repo | [`jsonl-repo.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/session/jsonl-repo.ts#L34-L179) | 多 Session 与 fork |
| Skill loader | [`harness/skills.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/skills.ts#L37-L230) | 发现、校验、调用格式 |
| Skill index | [`system-prompt.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/system-prompt.ts#L3-L24) | 渐进披露的 metadata 层 |
| Compaction | [`compaction.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/compaction/compaction.ts#L108-L350) | token、threshold、cut point、summary |
| Summary 工作状态 | [`compaction/utils.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/compaction/utils.ts#L23-L131) | read/modified files 与 tool result 截断 |

### 23.3 Provider / Extension / 应用边界

| 阅读目标 | 固定源码 | 为什么重要 |
|---|---|---|
| Models/Provider | [`packages/ai/src/models.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/ai/src/models.ts#L66-L620) | 模型集合、auth、dispatch |
| Extension loader | [`loader.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/extensions/loader.ts#L174-L427) | 动态宿主代码与 runtime invalidation |
| Extension runner | [`runner.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/extensions/runner.ts#L860-L931) | tool hook chain 与错误语义 |
| 默认工具 | [`sdk.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/core/sdk.ts#L240-L246) | coding-agent 应用选择 |
| Node 环境 | [`nodejs.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/agent/src/harness/env/nodejs.ts#L47-L430) | 文件、shell 与宿主权限 |
| RPC types | [`rpc-types.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/src/modes/rpc/rpc-types.ts#L1-L260) | headless 命令面 |
| Subagent 示例 | [`subagent/index.ts`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/examples/extensions/subagent/index.ts#L1-L698) | Core 之外的组合模式 |

---

## 24. 如果把它作为我们的 Agent Core，只需要记住什么

这一节只谈采用边界，不再展开上层系统设计。

### 24.1 应原样保留的 Core 不变量

- `AgentContext` 的小腰部；
- 双层 loop 的 steering/follow-up 语义；
- truncated tool batch 全拒绝；
- 并行执行、source-order result；
- 同一 Agent 一个 active run；
- event 先归约、listener 按顺序 await；
- 配置只在 turn boundary 换挡；
- Session 物理历史与模型逻辑视图分开；
- Skill metadata/content 分层；
- Sandbox 不伪装成 Hook。

### 24.2 不要把 coding-agent 外围误当成必须继承的 Core

- TUI 不是必须；
- 默认四工具不是必须；
- 旧 `AgentSession`/SessionManager 不是唯一持久化选择；
- Extension loader 不是使用 Agent Core 的前提；
- Subagent 示例不是强制调度模型；
- experimental orchestrator 不是正式核心 API。

### 24.3 对 Python 封装只做一个简短结论

我们平时从 Python 系统调用时，最值得封装的是 `AgentHarness` 的会话级语义，而不是 TUI。可以先用 coding-agent RPC 验证 headless 行为；长期若需要更干净的边界，再用一个很薄的 Node bridge 暴露 Harness event、prompt/steer/abort 与 Tool 调用即可。

但无论外层是什么语言，**不要在 Python 里重写 `agentLoop()` 的并发、事件与工具顺序**；那正是 Pi 已经写得最好的部分。上层只需要拥有任务调度、业务持久化和真正的 Sandbox，Core 仍然保持 Pi 的原貌。[INFERENCE]

---

## 25. 最终评价

`pi-agent` 最值得被当作典范的地方，是它准确回答了“Agent Core 到底应该负责到哪里”。

它负责：[CODE]

- 把 model stream 变成一致 assistant message；
- 把 tool call 变成经过校验、可取消、可观察的执行；
- 把工具结果重新放回模型上下文；
- 把 steering、follow-up 和 turn boundary 写成显式循环；
- 把事件折叠成稳定状态；
- 把 Session、Skill、Hook、Compaction 接到同一 loop；
- 把分支历史与当前模型视图分开。

它刻意不负责：[CODE][DOC]

- 一个具体 TUI 应该长什么样；
- 所有 Agent 都必须使用哪些工具；
- Subagent 全局调度；
- 不可信代码隔离；
- 多租户权限和资源预算；
- 把应用所有资源都收进一个框架容器。

正因为边界准确，Pi 才能做到既简洁又不简陋：

```text
pi-ai        统一模型世界
agentLoop    保证一次 Agent 执行正确
Agent        保证状态与事件顺序正确
AgentHarness 保证一次会话运行完整
```

Skill、Tool、Hook、Session、Compaction 都不是额外堆上去的功能清单，而是沿这四层自然找到自己的位置。Subagent 和 Sandbox 也因为没有被强塞进 Core，反而拥有更正确的实现空间。

这就是 `pi-agent` 最值得学习的地方：**它没有试图定义整个 Agent 世界，只把最难、最通用、最容易出现时序错误的那一小块写得非常干净。**

---

## 参考资料与上游问题

### 一手源码与文档

- [`earendil-works/pi` 固定提交](https://github.com/earendil-works/pi/commit/13437ca828894f43f973c630d208b488637d8fa9)
- [`packages/agent`](https://github.com/earendil-works/pi/tree/13437ca828894f43f973c630d208b488637d8fa9/packages/agent)
- [`packages/ai`](https://github.com/earendil-works/pi/tree/13437ca828894f43f973c630d208b488637d8fa9/packages/ai)
- [`packages/coding-agent`](https://github.com/earendil-works/pi/tree/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent)
- [`SECURITY.md`](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/SECURITY.md)

### 关联问题

- [#1717 Async event handlers corrupt session ordering](https://github.com/earendil-works/pi/issues/1717) — awaited listener 的历史背景。[ISSUE]
- [#2327 Parallel same-file edits overwrite each other](https://github.com/earendil-works/pi/issues/2327) — per-file mutation queue 背景。[ISSUE]
- [#2388 RPC stdout corruption](https://github.com/earendil-works/pi/issues/2388) — output guard 背景。[ISSUE]
- [#6242 Session ID / concurrent write discussion](https://github.com/earendil-works/pi/issues/6242) — Session 单写者与 append 顺序。[ISSUE]
- [#6298 Subagent extension hardening](https://github.com/earendil-works/pi/issues/6298) — 示例与生产调度器边界。[ISSUE]
- [#6713 RPC authentication](https://github.com/earendil-works/pi/issues/6713) — 本地 stdio 协议边界。[ISSUE]
- [#6816 Batch-level tool hooks](https://github.com/earendil-works/pi/issues/6816) — per-call Hook 的能力边界。[ISSUE]

## 附录 A：验证命令摘要

在固定 SHA、Node 22 shell 中执行：[RUN]

```bash
git rev-parse HEAD
git describe --tags --abbrev=0

npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run check
npm test
npm audit --omit=dev --json
```

build 产生的模型 catalog 变化已恢复，审阅 clone 最终保持 clean。[RUN]

## 附录 B：本文没有证明什么

- 没有证明 Pi 在所有 Agent benchmark 中速度第一。
- 没有运行真实付费 provider 的全覆盖测试。
- 没有把 `main` HEAD 等同于已发布 npm `0.80.10`。
- 没有把本地缺 `fd` 的 10 个 coding-agent failures 隐藏成全部通过。
- 没有把 Hook、project trust 或 Extension 说成 Sandbox。
- 没有把 Subagent 示例或 experimental orchestrator 说成 Core 内建能力。
- 没有把 TUI 当作 Agent Core 的主线。
- 没有发布本文；当前仍是 Vault 中 `publish: false` 的源稿。
