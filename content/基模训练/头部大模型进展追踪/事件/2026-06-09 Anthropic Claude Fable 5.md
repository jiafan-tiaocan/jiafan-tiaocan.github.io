---
record_type: model-release-event
title: "2026-06-09 Anthropic Claude Fable 5"
description: "追踪 Claude Fable 5 与 Mythos 5 的长程自主工作、安全分层、fallback 机制及其外部评价。"
date: 2026-06-09
noteType: technical
company: Anthropic
brand: Claude
model: Claude Fable 5
release_date: 2026-06-09
release_kind: major
baseline: Claude Opus 4.8
availability:
  - Claude.ai
  - Claude-Code
  - API
  - Cloud-Marketplaces
open_weights: false
license: proprietary
optimization_axes:
  - Long-Horizon-Agent
  - Coding
  - Knowledge-Work
  - Vision
  - Safety
actual_increment: "把同一 Mythos 级底模拆成面向公众的 Fable 安全配置与受限的 Mythos 配置，并以 Opus 4.8 fallback 支撑长程高风险任务的分层访问。"
reaction_tone: 分歧
reaction_summary: "能力与长程自主工作获强烈正面评价；高价格、fallback 混杂、短暂停服和更严格分类器的误拒绝使治理本身成为发布评价的一部分。"
reaction_status: 待复测
evidence_grade: A
next_signal: "在固定安全边界与无 fallback 条件下，测量长程任务成功率、拒绝率、路由比例和总成本。"
official_source: https://www.anthropic.com/news/claude-fable-5-mythos-5
technical_source: https://www-cdn.anthropic.com/2f9323abbcc4abe219577539efe19a623c9ca2bd/Claude%20Fable%205%20%26%20Claude%20Mythos%205%20System%20Card.pdf
independent_source: https://artificialanalysis.ai/models/claude-fable-5
last_verified: 2026-08-03
tags:
  - 大模型追踪
  - 模型发布
  - Anthropic
  - Claude
publish: true
---

# Anthropic Claude Fable 5

> [!summary] 当前判断
> Fable 5 把 Claude 的竞争单位推进到“可以连续工作数天的受治理 Agent”。但它不是一个可脱离系统讨论的单模型：**Fable / Mythos 安全配置、Opus 4.8 fallback、访问资格、价格和分类器误拒绝**都会改变用户实际得到的能力。

## 发生了什么

Anthropic 于 2026-06-09 发布同一底层模型的两种配置：面向一般用户的 **Claude Fable 5**，以及向受信合作方开放部分高风险能力的 **Claude Mythos 5**。6 月 12 日两者因美国政府指令短暂停止访问，7 月 1 日恢复全球服务；Anthropic 同时部署了更强分类器，并明确承认它会增加正常编码与调试的误报。

## 相对 Opus 4.8 的真实增量

- **更长自主时程：**发布主线从一次高难推理转向跨阶段规划、分派子 Agent、自检与异步工作。
- **能力与访问控制共同发布：**Fable 和 Mythos 共享底模，但安全层改变了可用能力；敏感查询可 fallback 到 Opus 4.8。
- **知识工作与视觉闭环：**文档、表格、复杂代码库和视觉核验被放进同一长程工作流。
- **治理机制成为模型接口：**这次发布无法只用 benchmark 描述，分类器、fallback 和 trusted access 都是实际系统行为。

## 外部反馈

### 独立评测

[Artificial Analysis](https://artificialanalysis.ai/models/claude-fable-5) 对“最大努力 + Opus 4.8 fallback”配置给出 Intelligence Index 60、约 76.4 output tok/s 和 1M context；标价 $10/M input、$50/M output。它确认 Fable 位于能力前沿，也明确指出其价格极高。

这个分数不能解释为纯 Fable 5：评测配置本身包含 fallback。官方称保守安全机制平均在少于 5% 的会话触发，但具体任务分布会显著改变比例。

### 从业者与市场信号

Anthropic 发布页包含 Stripe、Cursor、GitHub、Cognition 等早期测试者对大型迁移、长程 Coding 和知识工作的正面评价。它们提供了真实场景方向，但仍属于发布合作伙伴样本。

舆论的另一半集中在治理：停服、恢复、分类器加强、正常安全研究是否会被误拒、以及高价模型是否应自动 fallback。这里的争议不是附带噪声，而是 Fable 5 产品定义的一部分。

## 代价与边界

- 闭源且高价；只有长程成功率显著提升时，任务级经济性才可能成立。
- fallback 会让输出能力和评测归因不再纯粹。
- 更强安全分类器降低误用风险，也可能阻断合法安全、调试或生物研究任务。
- 官方客户案例多为精选 early-access 伙伴，需独立重放。

## 下一步验证

对安全敏感与普通任务分别记录：是否 fallback、是否拒绝、实际模型、effort、工具调用、总 token 和结果质量。跨模型比较时必须同时给“允许 fallback”和“禁止 fallback”两组结果。

## 来源

- [Anthropic：Claude Fable 5 与 Mythos 5](https://www.anthropic.com/news/claude-fable-5-mythos-5)
- [Anthropic：恢复部署与分类器说明](https://www.anthropic.com/news/redeploying-fable-5)
- [Anthropic：Fable 5 / Mythos 5 System Card](https://www-cdn.anthropic.com/2f9323abbcc4abe219577539efe19a623c9ca2bd/Claude%20Fable%205%20%26%20Claude%20Mythos%205%20System%20Card.pdf)
- [Artificial Analysis：Claude Fable 5](https://artificialanalysis.ai/models/claude-fable-5)
