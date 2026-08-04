---
record_type: model-release-event
title: "2026-07-31 DeepSeek V4 Flash 0731"
description: "追踪 DeepSeek V4 Flash 0731 的 Agent 后训练、Responses API、Codex 适配与低价高吞吐路线。"
date: 2026-07-31
noteType: technical
company: DeepSeek
brand: DeepSeek
model: DeepSeek V4 Flash 0731
release_date: 2026-07-31
release_kind: post-training-update
baseline: DeepSeek V4 Flash Preview
availability:
  - API-Public-Beta
  - Open-Weights
open_weights: true
license: MIT
optimization_axes:
  - Agent
  - Coding
  - Tool-Use
  - API-Compatibility
  - Cost
actual_increment: "不改架构和规模，只通过再后训练显著补强 Agent，并原生支持 Responses API、针对 Codex 适配。"
reaction_tone: 正面但有保留
reaction_summary: "独立评测显示能力、吞吐和价格组合极强；最大努力档输出 token 远高于同体量模型，低单价可能被冗长部分抵消。"
reaction_status: 待复测
evidence_grade: A
next_signal: "用固定任务比较 0731 与 Preview 的成功率、输出 token、总价和工具调用稳定性，并等待 V4-Pro 正式版。"
official_source: https://api-docs.deepseek.com/updates/
technical_source: https://api-docs.deepseek.com/updates/
independent_source: https://artificialanalysis.ai/models/deepseek-v4-flash
last_verified: 2026-08-03
tags:
  - 大模型追踪
  - 模型发布
  - DeepSeek
  - 开放权重
publish: true
---

# DeepSeek V4 Flash 0731

> [!summary] 当前判断
> 0731 是一个很干净的后训练案例：**架构和参数规模不变，Agent 指标与开发接口显著升级**。它说明当前竞争瓶颈正在从“再做一个更大的预训练模型”转向环境、任务、工具和轨迹驱动的 post-training。外部性价比很强，但 token 冗长需要进入真实账单。

## 发生了什么

DeepSeek 于 2026-07-31 将 V4 Flash 正式版本以 public beta 形式上线 API。官方明确说明：V4-Flash-0731 与 Preview 的架构和规模相同，**只进行了再后训练**；本次只升级 Flash API，V4-Pro 与 App/Web 模型不变。

## 相对 Preview 的真实增量

- **Agent post-training：** 官方报告 Terminal Bench、DeepSWE、Toolathlon、Automation Bench 等任务大幅改善。
- **接口和 harness 适配：** 原生 Responses API，并针对 Codex 使用方式优化。
- **因果边界清晰：** 既然架构和规模未改，本轮公开增量应优先归因于后训练、任务/环境和推理策略，而不是新注意力架构。
- **Flash 路线强化：** 284B total / 13B active 的小激活 MoE 继续承载高吞吐与低价目标。

## 外部反馈

### 独立评测

[Artificial Analysis](https://artificialanalysis.ai/models/deepseek-v4-flash) 的最大努力档快照给出 Intelligence Index 50、约 122.7 output tok/s、1M context；每百万 token 输入价格为 0.14 美元、输出为 0.28 美元，缓存命中输入约为 0.003 美元。它把 0731 评为同体量开放模型中能力、速度和价格都很强的组合。

同一评测也记录了约 210M 的总输出 token，显著高于同类中位数 100M。因而“最便宜”必须按**完成任务的总 token 和重试**核算，不能只看单 token 标价。

## 代价与边界

- 目前是 API public beta；稳定性、速率限制和最终模型 ID 仍需观察。
- 只有 Flash 更新，不能把 0731 的提升写到 V4-Pro 或 App/Web。
- 文本模型，不具备当前一批原生多模态旗舰的视觉入口。
- 官方 Agent 分数使用 DeepSeek Harness minimal mode、max effort 等条件，和其他 harness 结果不能直接横比。

## 下一步验证

把 Preview 与 0731 放进同一 Codex/Responses API 兼容 harness，重放 30 个 coding/tool-use 任务。记录成功率、工具错误、循环次数、输出 token、首答、总耗时和价格；同时等待 V4-Pro GA 后判断 Flash/Pro 分层是否稳定。

## 来源

- [DeepSeek API Change Log：2026-07-31](https://api-docs.deepseek.com/updates/)
- [Artificial Analysis：DeepSeek V4 Flash 0731](https://artificialanalysis.ai/models/deepseek-v4-flash)
