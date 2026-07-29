---
type: Technical Judgment
title: "OKF v0.2：个人知识库缺的不是格式，而是信任接口"
description: "OKF v0.2 的价值不是重新发明 Markdown 知识库，而是为 Agent 提供读取正文前即可判断来源、可信度、时效与计算路径的最小契约。"
tags:
  - Open-Knowledge-Format
  - 知识工程
  - Agent-Memory
  - Context-Engineering
date: 2026-07-28
noteType: thought
publish: true
status: stable
generated:
  by: codex/gpt-5
  at: 2026-07-28T20:51:26+08:00
stale_after: 2026-10-28
sources:
  - id: okf-v02-spec
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/3fcbb9f828c2f23d109c855ee403c3a4c81f3a96/okf/SPEC.md
    title: Open Knowledge Format v0.2 Specification
    author: team:google-cloud-data-analytics
    last_modified: 2026-07-24
  - id: okf-v02-blog
    resource: https://cloud.google.com/blog/products/data-analytics/okf-v0-2-adds-trust-signals/
    title: Open Knowledge format v0.2 tackles agentic trust
    author: team:google-cloud-data-analytics
    last_modified: 2026-07-24
  - id: llm-wiki
    resource: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
    title: LLM Wiki
    author: human:karpathy
    last_modified: 2026-04-04
  - id: local-mem-os
    resource: "../智能体/Agent系统构建中的 Mem-OS：让知识与经验形成复利.md"
    title: Agent 系统构建中的 Mem-OS：让知识与经验形成复利
---

# OKF v0.2：个人知识库缺的不是格式，而是信任接口

Google 于 2026 年 7 月 24 日发布的 Open Knowledge Format（OKF）v0.2，是面向人和 Agent 的知识交换格式：目录构成 Knowledge Bundle，一份 Markdown 表示一个 Concept，文件路径充当 ID，YAML Frontmatter 保存可过滤信号，链接把目录树扩展为图。它没有发明文件式知识库，而是把 LLM Wiki 一类实践压成可移植约定；只强制 Concept 有非空 `type`，不规定类型词表、检索引擎、存储或 Runtime。[^llm-wiki][^okf-v02-spec]

它真正推进的是**读取前决策**。v0.2 新增 `sources / generated / verified / status / stale_after`，使消费者在打开正文前先判断来源、生成者、复核等级、时效与生命周期；`Attested Computation` 又把指标定义、参数、执行器、回执和确定性 Attester 组成契约。Google 的 Acme Retail 示例因此不让 Agent 临场改写收入 SQL，而让 Metric 链接独立的受控计算。[^okf-v02-blog]

但 `human:` 只是 Actor 命名约定，不是身份认证；`stale_after` 只标记评审债务，不会修正事实；Attestation 证明某次运行执行了受认可的计算，不证明定义和数据正确。统一回执协议、Attester ABI、沙箱与缓存仍被推迟。OKF 解决的是“怎样携带信任信号”，不是“怎样产生真相”。它可补充 [[Agent系统构建中的 Mem-OS：让知识与经验形成复利|Mem-OS]] 的描述层，不能替代写入准入、冲突裁决、权限、上下文编译与评测。[^local-mem-os]

写入本文前的 Vault 已接近 OKF 的物理形态：124 个 Markdown 中有 84 个带 Frontmatter，35 个文件含双链，57 个文件引用外部网页；但尚未使用 `type / sources / generated / verified / stale_after`。现有 `noteType` 控制博客形态，`date` 是公开日期，已有 `status` 还承载 3D 打印生产状态。原地把全库宣布为 OKF，会制造字段语义冲突，并混合私人笔记、附件说明与公开知识。

更合适的做法，是保持 Vault 为唯一事实源，在 Quartz 公开投影之外增加一条**受控 OKF 投影**：导出时过滤隐私与范围、转换双链，保留 `noteType / date`，另加 OKF 字段并生成 `index.md / log.md`；消费侧先过滤草稿、过期和低信任内容，再把少量正文交给 Context Compiler。首批只选十篇**变化快、复用高、错误代价高**的 AI 进展、公司研究、源码研报与计算型结论：Agent 写入即记录来源，独立复核后成为 machine-confirmed，人工审阅后成为 human-reviewed，到期则降级；只有代码产生的数字才拆出 `Attested Computation`。这样，OKF 才是 Vault 面向 Agent 的信任接口，而不是第二套知识库。

[^okf-v02-spec]: [Open Knowledge Format v0.2 Specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/3fcbb9f828c2f23d109c855ee403c3a4c81f3a96/okf/SPEC.md)
[^okf-v02-blog]: [Open Knowledge format v0.2 tackles agentic trust](https://cloud.google.com/blog/products/data-analytics/okf-v0-2-adds-trust-signals/)
[^llm-wiki]: [Andrej Karpathy：LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
[^local-mem-os]: [[Agent系统构建中的 Mem-OS：让知识与经验形成复利]]
