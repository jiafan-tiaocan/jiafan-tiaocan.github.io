---
title: 人脑的上下文长度，不该用 Token 衡量
description: 人脑没有单一上下文窗口；回忆更像重建情境空间，未来 Agent 的 Context 也可能成为持续演化的神经状态。
tags:
  - 认知科学
  - 工作记忆
  - Context-Engineering
  - 持续学习
date: 2026-07-28
noteType: thought
publish: true
---

# 测量人脑上下文

把人脑问成“能容纳多少 Token”，一开始就选错了单位。LLM 的窗口是显式序列；人的当前认知却由工作记忆、跨时间整合和线索触发的长期记忆共同构成。人脑没有一个上下文长度，只有一组与任务相关的有效指标。

[Cowan 的综述](https://pubmed.ncbi.nlm.nih.gov/20445769/)给出的基线是：抑制复述和组块后，中央工作记忆约能保持 3–5 个有意义单元；但“单元”会随经验改变。[Hasson 等人的自然电影实验](https://pmc.ncbi.nlm.nih.gov/articles/PMC2556707/)又发现，不同脑区整合信息的时间尺度不同。这些机制不能拼成一个 Token 上限。

回忆带回的也常不是一句话，而是一个可重新进入的**情境空间**：人物、方位、感受和行动可能性同时出现，语言只是事后沿一条路径将它序列化。[Wheeler 等人的实验](https://pubmed.ncbi.nlm.nih.gov/11005879/)发现，回忆图片或声音会选择性重启相应感觉皮层；[Hassabis 等人](https://pubmed.ncbi.nlm.nih.gov/17229836/)则发现，海马损伤者想象新经历时只剩碎片，缺乏连贯的环境空间。“空间”在这里不必是三维地图，更像一个可被线索恢复的多模态关系状态。

更可行的是测“有效上下文长度”：在同一组短故事中，把会改变最终决策的关键事实放在不同距离 \(d\)，并设置保留、删除、打乱和矛盾版本，测量正确率、反应时与置信度：

$$
\Delta(d)=P(\text{答对}\mid\text{关键事实位于距离 }d)-P(\text{答对}\mid\text{关键事实被删除})
$$

定义 \(L_{50}\) 为影响衰减到近距离条件一半时的距离，用秒、词数和事件边界报告，并分开测试无提示整合与有提示检索。结果是一条“距离—影响曲线”。人类可观察行为约 [10 bit/s](https://www.caltech.edu/about/news/thinking-slowly-the-paradoxical-slowness-of-human-behavior) 的估计是输出吞吐率，不能换算为存储窗口。

[Andrej Karpathy](https://x.com/karpathy/status/1937902205765607626)把 context engineering 概括为给下一步装入恰到好处的信息。[Demis Hassabis 在 2026 年的对谈](https://eecs.iisc.ac.in/fireside-chat-sir-demis-hassabis-and-prof-govindan-rangarajan/)则指出，百万 Token 窗口仍是对海马体的粗糙近似；真正缺失的是选择、压缩、巩固与遗忘。

[![三层对比图：人脑以情境空间形成持续认知；当前 Agent 经由 Context、Model、Tool 离散转移；未来模型消费事件流，以动态状态、神经记忆和权重跨时间尺度更新。](assets/human-agent-context/human-vs-agent-thinking-v2.svg)](assets/human-agent-context/human-vs-agent-thinking-v2.svg)

*图 1　持续认知、离散 Agent 与未来神经流。结构自绘，图标由 OpenAI 图像模型生成；依据 [ReAct](https://research.google/blog/react-synergizing-reasoning-and-acting-in-language-models)、[Anthropic 的工作空间比较](https://www.anthropic.com/research/global-workspace)及多时间尺度记忆研究，仅比较功能结构。*

## 从 ReAct 到持续认知

[ReAct](https://arxiv.org/abs/2210.03629) 让推理、行动和检索交替发生，但调用仍是离散状态转移：Runtime 编译上下文，冻结模型生成动作，环境返回观察，下一轮再重建状态。人脑没有清晰的调用边界；感知、联想与判断持续互相改写。因此，“训练—推理解耦”是关键差异之一。

“持续推理”至少包含三层：[Coconut](https://arxiv.org/abs/2412.06769) 探索任务内的连续隐状态；[Continuous Thought Machine](https://pub.sakana.ai/ctm/paper/ctm.pdf) 引入内部时间与循环动力学；持续学习则要求经历跨任务改变行为。前两者并不会自动产生一个长期生活和学习的 Agent。

近期更现实的是**持久认知运行时**：保存目标和记忆线索，由事件唤醒推理，验证后更新长期资产。它建立事件—记忆—学习循环，但神经模型仍是一段段被调用。

## 畅想：NN is all you need

更激进的形态，是模型不再等待 Runtime 把世界装成一包 Token，而是直接消费图像、声音、身体、工具与反馈流。系统持续保留内部状态 \(s_t\)，事件 \(x_t\) 到来便更新为 \(s_{t+1}\)；沉默时也在预测和发现变化，只在需要行动时输出。Context 不再是请求附件，而是网络沿时间留下的状态轨迹。

常驻眼镜或机器人不必反复“读回”录像，而是在流中更新人物、地点、目标和未决事项：线索停留在快速激活中，重要经历写入较慢的神经记忆，规律再巩固为技能。[The Era of Experience](https://storage.googleapis.com/deepmind-media/Era-of-Experience%20/The%20Era%20of%20Experience%20Paper.pdf)、[Titans](https://arxiv.org/abs/2501.00663) 与 [Nested Learning](https://research.google/blog/introducing-nested-learning-a-new-ml-paradigm-for-continual-learning/)分别从连续经验、测试时记忆和嵌套更新逼近这一点：训练与推理或许不是开关，而是一组时间尺度。

“NN is all you need”并非删除数据库和 Harness。神经内核保存“什么会影响下一刻思考”；事实原件、权限、来源、审计与回滚仍留在离散治理层，否则持续学习只会变成持续漂移。[[Agent系统构建中的 Mem-OS：让知识与经验形成复利|Mem-OS]] 与 [[Agent Self-Evolution：从反馈闭环到可验证的系统进化|Self-Evolution]] 追问的，正是如何把这种可塑性放进可验证、可撤销的边界。
