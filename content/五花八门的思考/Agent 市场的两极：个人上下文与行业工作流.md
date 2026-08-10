---
title: Agent 市场的两极：个人上下文与行业工作流
description: Agent 应用机会更可能向个人上下文与行业工作流两端收敛，但两端都必须证明客户 ROI 与供给方单位经济同时为正。
tags:
  - Agent
  - 商业判断
  - 行业智能体
  - AI应用
  - 单位经济
date: 2026-08-10
noteType: thought
publish: true
---

# Agent 市场的两极：个人上下文与行业工作流

Agent 应用层的机会更可能向两端收敛：通用 Agent 横向拥有一个人的长期上下文与跨应用行动面；垂直 Agent 纵向拥有一个行业的对象、流程、权限、风险和结果反馈。只把通用模型包装成某种角色的中间产品，两种私有状态都没有，最容易被模型升级或上游平台吸收。

但“通用 / 垂直”与“To C / To B”不是同一根轴。前者描述产品掌握什么，后者描述谁付钱；企业也会采购通用 Agent，消费市场也可能出现教育、健康等垂直 Agent。两端最终受同一套价值经济学约束。Token 是机器成本的计量单位，不是客户价值本身：

$$
C_{\text{total}}=C_{\text{token/tool/infra}}+C_{\text{integration/review/ops}}+\mathbb{E}[L_{\text{risk}}]
$$

$$
\mathrm{ROI}_{\text{Agent}}=\frac{V_{\text{accepted outcome}}-C_{\text{total}}}{C_{\text{total}}}
$$

To C 的价值可以是节省时间、改善决策与体验；To B 则是增量收入、节省人力和避免损失。两者都必须按“被接受且安全的结果”计价，不能按生成次数自我庆祝。客户 ROI 为正，只说明有人愿意买；供给方还要满足“结果收入减去全链路交付成本”为正，生意才能扩张。这延续了 [[关于商业模式]] 的判断：每个参与者都获得可持续回报，并且放大规模后仍然成立。

通用 Agent 的终局并不是一本被动增长的“个人百科全书”。它还要判断此刻该想起什么、可以采取什么行动，以及何时必须征得同意。OpenAI 已把对话、文件、记忆和连接应用纳入可纠正的 Memory；Google 的 Personal Intelligence 也在连接 Gmail、Photos、YouTube 与 Search。[OpenAI Memory](https://help.openai.com/en/articles/8590148-memory-in-chatgpt-faq)、[ChatGPT Apps](https://help.openai.com/en/articles/11487775-connectors-in)与[Gemini Personal Intelligence](https://blog.google/innovation-and-ai/products/gemini-app/personal-intelligence/)由此支持一个产品层推断：模型公司争夺的是“理解你并替你行动”的入口。真正的资产是**用户模型、行动图谱与信任界面**。这也对应 [[Agent系统构建中的 Mem-OS：让知识与经验形成复利|Mem-OS]] 的边界：记得多不产生壁垒，在正确时刻以正确权限改变行动才产生壁垒。

垂直 Agent 的行业 know-how 也不是专业文档，而是可执行的工作系统：输入、步骤、分支、可信来源、审批权和完成条件。Harvey 的 Agent Builder 让法律团队把客户材料、先例、分支逻辑和输出标准组织为可测试、可授权、可迭代的 Workflow Agent；产品本身也与律所律师和知识团队共同打磨。[Harvey 官方说明](https://www.harvey.ai/blog/introducing-workflow-builder)还原出来的是法律工作的状态机，而不是“法律 Prompt”。

To B 难做，恰恰因为早期功能没有多少壁垒，而销售、集成、复核与定制会先吃掉毛利。上游合作和客户关系可以带来渠道、信任与信息，却只是领先条件；只有当它们沉淀为难以替代的系统接入、数据权利、审批位置和 Outcome 反馈闭环，才会变成壁垒。与其称为“勾结”，更准确的是建立可持续的利益绑定与共同交付关系。技术团队可以来自行业之外，但必须长期绑定一线专家、真实工作流和结果数据，否则垂直 Agent 仍只是通用助手。

因此，对应用创业更实用的判断是：**通用端结构上更有利于模型、操作系统和生态入口的拥有者；创业公司的现实机会，更偏向能进入行业现场，并持续降低“每个被接受且安全的结果”的成本。** “把每个行业重做一遍”不是换一层对话界面，也不是转售更多 Token，而是把行业知识编译成一个客户 ROI 与供给方单位经济同时为正的执行系统。
