---
record_type: model-release-event
title: "2026-07-21 Google Gemini 3.6 Flash"
description: "追踪 Gemini 3.6 Flash 的输出效率、高吞吐、原生多模态与百万上下文表现。"
date: 2026-07-21
noteType: technical
company: Google DeepMind
brand: Gemini
model: Gemini 3.6 Flash
release_date: 2026-07-21
release_kind: point-update
baseline: Gemini 3.5 Flash
availability:
  - Gemini
  - Google-AI-Studio
  - Gemini-API
  - Antigravity
open_weights: false
license: proprietary
optimization_axes:
  - Token-Efficiency
  - Coding
  - Knowledge-Work
  - Multimodal
  - Long-Context
actual_increment: "在保持 Flash 高吞吐和 1M 原生多模态入口的同时，减少输出 token，并把接近前沿的能力压到可大规模调用的工作档。"
reaction_tone: 正面但有保留
reaction_summary: "独立评测的主要结论是输出快、价格适中、能力强且较简洁；它更像高吞吐工作模型，而不是最高推理上限。"
reaction_status: 待复测
evidence_grade: A
next_signal: "在视频、长文档和 Agent 工作流中同时测首答时间、有效召回、总 token 与任务成功率。"
official_source: https://deepmind.google/models/gemini/flash/
technical_source: https://ai.google.dev/gemini-api/docs/changelog
independent_source: https://artificialanalysis.ai/models/gemini-3-6-flash
last_verified: 2026-08-03
tags:
  - 大模型追踪
  - 模型发布
  - Google-DeepMind
  - Gemini
publish: true
---

# Google Gemini 3.6 Flash

> [!summary] 当前判断
> Gemini 3.6 Flash 的重点不是重新夺取最高能力榜首，而是把**原生多模态、1M 上下文、较强 Coding/知识工作和极高输出吞吐**放进一个可规模化的 Flash 档。它最可能改变的是高并发 Agent 的经济性，但“生成得快”仍不等于“长任务完成得稳”。

## 发生了什么

Google 于 2026-07-21 发布 Gemini 3.6 Flash。官方将其定位为 coding、knowledge work 与 multimodal tasks 的 token-efficient workhorse，并引用 Artificial Analysis 数据称其比 3.5 Flash 少用 17% 输出 token。

## 相对 Gemini 3.5 Flash 的真实增量

- **效率优先的点版本：**同为 Flash 档，重点是更少输出 token 与更好的能力—速度平衡。
- **原生多模态工作档：**文本、图像、语音和视频输入继续通过一个模型入口处理。
- **1M 上下文不再只属于 Pro：**长上下文与高吞吐结合，适合批量文档、媒体和 Agent 场景。
- **不是新架构发布：**公开材料主要给能力、价格和产品可用性，没有足够证据把增量归因到具体训练或架构模块。

## 外部反馈

### 独立评测

[Artificial Analysis](https://artificialanalysis.ai/models/gemini-3-6-flash) 给出的当前 high-effort 快照是 Intelligence Index 50、约 213.5 output tok/s、1M context，价格 $1.50/M input、$7.50/M output。相较同价位模型，它的外部画像是“明显快、较简洁、能力强且价格适中”。

### 解释边界

高 output tok/s 不包含模型开始回答前的思考与输入处理；对 reasoning model，用户感知延迟还取决于 time-to-first-answer、思考 token 和任务长度。Flash 的优势需要在端到端工作而非单纯 decode 速度上确认。

## 代价与边界

- 闭源；训练数据、参数量和具体效率来源未公开。
- 1M 最大窗口不保证 1M 范围内的稳定检索、归纳和指令保持。
- Google 的模型别名与 preview/GA 生命周期更新快，生产系统必须固定 model ID 并跟踪下线计划。
- 在最高难度推理任务上，Flash 的定位本就不是能力上限。

## 下一步验证

用同一套 100K、500K、1M 文档和视频任务比较 3.5/3.6 Flash：首答时间、检索正确率、跨段整合、输出 token、端到端价格与失败重试。Agent 测试另记录工具调用正确率和中途目标漂移。

## 来源

- [Google DeepMind：Gemini 3.6 Flash](https://deepmind.google/models/gemini/flash/)
- [Gemini API release notes](https://ai.google.dev/gemini-api/docs/changelog)
- [Artificial Analysis：Gemini 3.6 Flash](https://artificialanalysis.ai/models/gemini-3-6-flash)
