---
title: Agent 市场的两极：个人上下文与行业工作流
description: Agent 应用机会正向个人上下文与行业工作流两端收敛：泛用 Agent 经营难以逐任务计量的长期体验，垂直 Agent 则必须证明可归因的客户 ROI 与供给方单位经济。
tags:
  - Agent
  - 商业判断
  - 行业智能体
  - AI应用
  - 单位经济
  - Codex
date: 2026-08-10
noteType: thought
publish: true
---

# Agent 市场的两极：个人上下文与行业工作流

Agent 应用层的机会更可能向两端收敛：通用 Agent 横向拥有一个人的长期上下文与跨应用行动面；垂直 Agent 纵向拥有一个行业的对象、流程、权限、风险和结果反馈。只把通用模型包装成某种角色的中间产品，两种私有状态都没有，最容易被模型升级或上游平台吸收。

但“通用 / 垂直”与“To C / To B”不是同一根轴。前者描述产品掌握什么，后者描述谁付钱；企业也会采购通用 Agent，消费市场也可能出现教育、健康等垂直 Agent。更重要的是，两端不能共用一条 Token ROI 公式。

泛用 Agent 带来的知识增益与体验价值会在长期使用中累积：少重复解释、理解偏好、跨任务保持连续，并逐渐形成行动信任。它们缺少稳定的单任务基线和可观察反事实，无法可靠归因到一次回答或一批 Token。客户侧应看留存、使用频率、付费意愿、任务扩张与信任，而不是硬算逐任务 ROI。Token 对它仍然重要，但只是供给侧的成本、毛利与模型路由约束，不是用户价值单位。

通用 Agent 不是被动增长的“个人百科全书”，还要判断该想起什么、可采取什么行动，以及何时征得同意。OpenAI 已把对话、文件、记忆和连接应用纳入可纠正的 Memory；Google 的 Personal Intelligence 也在连接 Gmail、Photos、YouTube 与 Search。[OpenAI Memory](https://help.openai.com/en/articles/8590148-memory-in-chatgpt-faq)、[ChatGPT Apps](https://help.openai.com/en/articles/11487775-connectors-in)与[Gemini Personal Intelligence](https://blog.google/innovation-and-ai/products/gemini-app/personal-intelligence/)支持一个产品层推断：模型公司争夺的是“理解你并替你行动”的入口。真正的资产是**用户模型、行动图谱与信任界面**。这也对应 [[Agent系统构建中的 Mem-OS：让知识与经验形成复利|Mem-OS]] 的边界：记得多不产生壁垒，在正确时刻以正确权限改变行动才产生壁垒。

Codex 是一个边界案例。OpenAI 仍将其定位为 Coding Agent，但[官方用例](https://learn.chatgpt.com/use-cases)已覆盖数据、研究、演示文稿与跨应用工作；客户端则区分 Chat、Work 与 Codex。[官方文档](https://developers.openai.com/)支持一个判断：Codex 的模型、工具、沙箱与长任务 Runtime 已达到泛用 Agent 执行底座的较高水位，但泛用助理和 Coding Agent 不应共享默认产品契约。前者侧重个人记忆、跨应用权限和开放终态；后者必须以仓库事实、最小 Diff、测试、Git、CI 与回滚为中心。更好的拆法是**共享 Agent Core 与 Runtime，拆分 Agent OS 和产品 Profile**，分别设计入口、默认上下文、工具、权限、完成条件与评测。

垂直 Agent 的行业 know-how 也不是专业文档，而是可执行的工作系统：输入、步骤、分支、可信来源、审批权和完成条件。Harvey 的 Agent Builder 让法律团队把客户材料、先例、分支逻辑和输出标准组织为可测试、可授权、可迭代的 Workflow Agent；产品本身也与律所律师和知识团队共同打磨。[Harvey 官方说明](https://www.harvey.ai/blog/introducing-workflow-builder)还原出来的是法律工作的状态机，而不是“法律 Prompt”。

垂直 Agent 才适合进入结果经济学：任务边界、人工基线、验收终态和业务结果相对明确，Token 可以作为全链路交付成本的一部分进入客户 ROI：

$$
C_{\text{total}}=C_{\text{token/tool/infra}}+C_{\text{integration/review/ops}}+\mathbb{E}[L_{\text{risk}}]
$$

$$
\mathrm{ROI}_{\text{vertical}}=\frac{V_{\text{accepted outcome}}-C_{\text{total}}}{C_{\text{total}}}
$$

其中，结果价值可以是增量收入、节省人力或避免损失，但必须以“被接受且安全的结果”为口径。客户 ROI 为正，只说明值得采购；供给方还要让结果收入减去全链路交付成本为正，才能规模化。这延续了 [[关于商业模式]] 的判断：每个参与者都获得可持续回报，并且放大规模后仍然成立。

To B 难做，因为早期功能没有多少壁垒，销售、集成、复核与定制却会先吃掉毛利。上游合作和客户关系只是领先条件；只有沉淀为难以替代的系统接入、数据权利、审批位置和 Outcome 反馈闭环，才会成为壁垒。与其称为“勾结”，更准确的是利益绑定与共同交付。技术团队可以来自行业之外，但必须长期绑定一线专家、真实工作流和结果数据，否则产品仍只是通用助手。

因此，两端有两套经济逻辑：泛用 Agent 经营不可逐任务计价的知识与体验复利，更有利于模型与生态入口拥有者；垂直 Agent 经营可归因的业务结果，机会属于能进入行业现场、降低安全结果成本的团队。“把每个行业重做一遍”不是转售 Token，而是把行业知识编译成客户 ROI 与供给方单位经济同时为正的执行系统。
