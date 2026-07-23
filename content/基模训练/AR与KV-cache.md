---
title: "AR 与 KV-cache：从增量解码到智能体跨会话状态复用"
description: "系统讲清 KV-cache 的注意力原理、内存估算、MQA/GQA、PagedAttention、前缀复用、跨会话缓存、分层分布式存储、安全失效、生产实现与评测方法。"
tags:
  - 大模型
  - KV-cache
  - LLM-Inference
  - 推理优化
  - Agent-Infrastructure
date: 2025-11-23
last_verified: 2026-07-23
noteType: technical
publish: true
---

# AR 与 KV-cache：从增量解码到智能体跨会话状态复用

![[AR与KV-cache.assets/01-kv-cache-evolution.svg]]
*图 1　KV-cache 从单序列增量复用到 Agent 跨会话基础设施的因果演进路线。本文归纳，依据文末所列论文与官方实现。*

> [!abstract] 核心判断
> 1. **KV-cache 缓存的不是文本，也不是模型的“记忆”，而是某个确定模型配置对某段 token 前缀计算出的逐层 Key/Value 张量。**
> 2. 在单次自回归解码中，它把“每生成一个 token 都重算全部历史”改成“只计算新 token，再读取历史 K/V”。但 Attention 仍要读取历史，因此 Decode 往往从算力受限转成显存带宽受限。
> 3. MQA/GQA 缩小每个 token 的 KV 状态；PagedAttention 解决动态长度、碎片与共享；RadixAttention 和 block hash 让相同前缀跨请求复用；Mooncake、HiCache、LMCache 一类系统进一步把 KV 变成跨 GPU、CPU、SSD 与节点调度的状态资源。
> 4. 多轮对话天然适合前缀缓存：第 \(n+1\) 轮的历史通常包含第 \(n\) 轮的完整前缀。但跨对话、跨用户、跨实例复用只有在**模型、Tokenizer、模板、位置、Adapter、模态、权限域和 token 前缀都兼容**时才安全。
> 5. 对 Agent 而言，正确架构是：**会话账本与 Mem-OS 承诺事实，Prompt Compiler 产生稳定前缀，KV-cache 只加速对该前缀的重算。**缓存丢失应只导致变慢，不能导致“失忆”；缓存误命中则是正确性与安全事故。

> [!note] 证据边界
> - 本文中的论文结构、机制和作者报告数字均链接到原论文；论文结果只代表对应模型、硬件与负载，不直接等于生产收益。
> - OpenAI、Anthropic、Gemini、vLLM、SGLang、TensorRT-LLM 与 LMCache 的产品或实现事实核验于 **2026-07-23**，后续接口、TTL、计费与默认值可能变化。
> - 本文没有虚构某个业务项目的吞吐或成本数字。容量示例由公开模型结构参数按公式推导；生产决策是跨论文和工程实现的归纳。
> - “跨会话 KV-cache”在本文中指跨请求、跨 session 或跨 engine instance 复用推理状态，不等同于语义长期记忆。长期记忆的治理见 [[Agent系统构建中的 Mem-OS：让知识与经验形成复利]]。

## 0. 先把几个容易混淆的“缓存”分开

很多讨论把上下文、KV-cache、Prompt Cache、会话状态和长期记忆混成一个词。工程上必须先拆开：

| 对象 | 保存什么 | 主要目的 | 能否作为事实来源 | 典型生命周期 |
|---|---|---|---|---|
| Token/Prompt Cache | token 化结果、规范化 Prompt 或内容哈希 | 少做 CPU 侧解析与 tokenization | 否 | 分钟到版本周期 |
| KV-cache | 每层历史 token 的 K/V 张量 | 少做模型 Prefill/Decode 重算 | 否 | 单请求到跨请求 TTL |
| Conversation State | 消息、Tool Call、审批、分支、Run checkpoint | 恢复一次会话或任务 | 是，需版本与日志 | 会话到任务生命周期 |
| Semantic Memory | 事实、偏好、规则、经验及其来源 | 让未来任务获得正确上下文 | 是，需权限、时间与冲突治理 | 长期 |
| Artifact Store | 文档、图片、代码、Trace、原始报告 | 保存可核验原件 | 是，作为证据来源 | 长期 |

一句最实用的区分是：

> **Memory 决定下一次应该给模型看什么；KV-cache 决定同样的东西是否还要再算一次。**

因此，KV-cache 的系统目标不是“记得更多”，而是减少**完全相同或严格兼容的计算**。如果上下文语义相似但 token 不同，普通前缀缓存不会命中；如果事实已经更新但旧 token 仍被复用，缓存反而可能放大陈旧状态。

## 1. KV-cache 为什么成立：因果注意力中的历史 K/V 是不变量

### 1.1 从 Self-Attention 开始

对第 \(l\) 层、长度为 \(T\) 的隐藏状态 \(X^{(l)}\)，单个 Attention head 的投影为：

$$
Q^{(l)} = X^{(l)} W_Q^{(l)},\qquad
K^{(l)} = X^{(l)} W_K^{(l)},\qquad
V^{(l)} = X^{(l)} W_V^{(l)}
$$

带因果 Mask 的注意力输出是：

$$
O^{(l)} =
\operatorname{softmax}
\left(
\frac{Q^{(l)} {K^{(l)}}^\top}{\sqrt{d_h}} + M_{\text{causal}}
\right)
V^{(l)}
$$

其中：

- \(d_h\) 是单个 head 的维度；
- \(M_{\text{causal}}[i,j]=-\infty\) 当 \(j>i\)，确保位置 \(i\) 看不到未来；
- 第 \(i\) 个 token 的 \(K_i^{(l)},V_i^{(l)}\) 只由它可见的前缀决定。

当模型已经处理完前缀 \(x_{1:t}\)，随后追加 \(x_{t+1}\) 时，因果 Mask 保证旧位置 \(1\ldots t\) 的隐藏状态不会因为“未来多了一个 token”而改变。因此每层的历史：

$$
K_{1:t}^{(l)},\;V_{1:t}^{(l)}
$$

都可以直接保留。新一步只需计算：

$$
q_{t+1}^{(l)},\;k_{t+1}^{(l)},\;v_{t+1}^{(l)}
$$

再执行：

$$
o_{t+1}^{(l)} =
\operatorname{softmax}
\left(
\frac{
q_{t+1}^{(l)}
\left[K_{1:t}^{(l)};k_{t+1}^{(l)}\right]^\top
}{\sqrt{d_h}}
\right)
\left[V_{1:t}^{(l)};v_{t+1}^{(l)}\right]
$$

这就是 KV-cache 的全部数学基础：**旧 token 不再重新过一遍 Q/K/V 投影、Attention 和 MLP，但新 query 仍要读取历史 K/V。**

### 1.2 Prefill 与 Decode 是两种完全不同的工作负载

一次常见 LLM 请求可以拆成两段：

1. **Prefill / Context phase**：并行处理输入的 \(N\) 个 token，生成首份 KV-cache；
2. **Decode / Generation phase**：每次生成一个或少量 token，并把新 K/V 追加进缓存。

| 维度 | Prefill | Decode |
|---|---|---|
| 每次处理 token 数 | 多 | 通常每序列 1 个 |
| 并行度 | 高 | 低，依赖上一 token |
| 主要瓶颈 | 大矩阵计算、Attention IO | KV 读取、权重读取、调度 |
| 关键指标 | TTFT、Prefill tokens/s | ITL/TBT、Decode tokens/s |
| 缓存作用 | 生成或恢复 KV | 读取并追加 KV |

没有 KV-cache 时，每个 Decode step 都要重新处理整个 \(N+t\) 长度的序列。启用缓存后，每层只对新 token 做一次投影和 MLP，但 Attention 对历史的读取仍随上下文长度线性增长。

因此更精确的复杂度表述是：

- **历史投影与 MLP 重算**：从每步随前缀增长，降为每步仅处理新 token；
- **单步 Attention 读历史**：仍为 \(O(Td)\)；
- **整段 Prefill**：标准全注意力仍有 \(O(T^2d)\) 的计算关系；
- **整段生成**：缓存消除了反复跑前缀的巨大浪费，但没有让长上下文 Attention 变成 \(O(1)\)。

“KV-cache 把复杂度从平方降到线性”是有条件的简写：它通常指**自回归生成期间不再对每一步完整重算历史**，不能理解为所有 Attention 成本都消失。

### 1.3 KV-cache 保存的具体是什么

对一个 Decoder-only Transformer，典型缓存按层保存：

```text
layer_0:
  key   [batch, num_kv_heads, seq_len, head_dim]
  value [batch, num_kv_heads, seq_len, head_dim]
layer_1:
  key   [...]
  value [...]
...
layer_(L-1)
```

它通常**不保存**：

- 历史 token 的 Query，因为未来 token 不会再以历史 token 为 query；
- MLP 中间激活，因为历史 token 不再重算；
- Attention score 矩阵，因为新 query 会产生新的 score；
- 文本事实的结构化语义，因为 KV 只是特定模型内部表示。

也有架构例外：

- Encoder-Decoder 模型会区分 self-attention KV 与 cross-attention KV；
- Sliding-window、local/global hybrid、Mamba/SSM hybrid 可能有不同缓存组与状态布局；
- MLA 一类结构会缓存压缩 latent，而非传统完整 K/V；
- 多模态模型还要把图像、音频 embedding 或其额外身份纳入缓存键。

所以“KV-cache 格式”不是跨模型通用 ABI。即使 token ids 相同，换了模型 revision、Adapter 或位置编码配置，旧 KV 也未必可用。

## 2. 先算清内存：KV-cache 为什么会成为并发上限

### 2.1 基本容量公式

若模型有：

- \(L\) 层；
- \(H_{kv}\) 个 KV heads；
- 每个 head 维度 \(d_h\)；
- 序列长度 \(T\)；
- Batch 或并发序列数 \(B\)；
- 每个元素 \(s\) bytes；

则不考虑对齐、块碎片和元数据时，KV-cache 近似占用：

$$
M_{\text{KV}}
=
2 \cdot L \cdot B \cdot T \cdot H_{kv} \cdot d_h \cdot s
$$

前面的 2 分别对应 Key 和 Value。单 token、单序列的字节数是：

$$
m_{\text{token}}
=
2 \cdot L \cdot H_{kv} \cdot d_h \cdot s
$$

这条公式比参数量更能直接回答两个生产问题：

1. 一张卡还能容纳多少并发 token；
2. 采用 MHA、GQA、MQA 或 KV 量化后能释放多少容量。

### 2.2 一个 70B 级 GQA 模型的量级

以常见的 80 层、8 个 KV heads、\(d_h=128\)、BF16 为例：

$$
m_{\text{token}}
=
2 \times 80 \times 8 \times 128 \times 2
=
327{,}680\ \text{bytes}
\approx 0.3125\ \text{MiB}
$$

单序列 128K token：

$$
0.3125\ \text{MiB/token} \times 131{,}072
= 40\ \text{GiB}
$$

这还没有算：

- 最后一个物理块的内部碎片；
- Block table、hash index、refcount 等元数据；
- CUDA graph 或 workspace；
- 量化 scale；
- 并发调度预留；
- Tensor Parallel 下各 rank 的布局与复制。

同样结构若采用 64 个 KV heads 的 MHA，KV 容量会是 8-head GQA 的 8 倍。由此可见，长上下文模型仅仅“支持 128K”不代表服务系统能在高并发下便宜地使用 128K。

### 2.3 MHA、GQA、MQA 在系统层的意义

原始 Multi-Head Attention 为每个 Query head 配一组 K/V heads。2019 年的 [Multi-Query Attention](https://arxiv.org/abs/1911.02150) 让所有 Query heads 共享单个 KV head，以显著减少增量解码的 KV 带宽。2023 年的 [Grouped-Query Attention](https://arxiv.org/abs/2305.13245) 则在 MHA 与 MQA 之间折中：每组 Query heads 共享一组 K/V。

设 Query heads 数为 \(H_q\)，KV heads 数为 \(H_{kv}\)：

| 结构 | \(H_{kv}\) | KV 容量相对 MHA | 主要权衡 |
|---|---:|---:|---|
| MHA | \(H_q\) | 1 | 容量和带宽最大 |
| GQA | \(1 < H_{kv} < H_q\) | \(H_{kv}/H_q\) | 质量、并行和容量折中 |
| MQA | 1 | \(1/H_q\) | 最省 KV，可能带来质量或切分约束 |

GQA/MQA 改变的是**模型产生多少 KV 状态**；PagedAttention 改变的是**这些状态如何分配**；量化改变的是**每个状态用多少 bit**。三者解决的是不同层次，不能互相替代。

### 2.4 显存容量不是唯一瓶颈，读带宽同样关键

Decode 每步都要为每层读取历史 K/V。上下文越长、并发越高，读取量越大，而单步新增计算相对少，GPU 算力核心可能在等 HBM 数据。

这也是为什么：

- MQA/GQA 不仅节省容量，也减少每步 KV 读取；
- FP8/INT8/INT4 KV 量化可能同时改善容量和带宽；
- Cache 命中不必然更快：从远端加载巨大的 KV 可能比本地重算 Prefill 更慢；
- [FlashAttention](https://arxiv.org/abs/2205.14135) 解决的是 Attention kernel 的 IO 路径，但不等于跨请求 KV 复用。

FlashAttention、PagedAttention、Prefix Cache 可以同时存在：

```text
FlashAttention / FlashDecoding：如何高效做一次 Attention
PagedAttention：KV 页如何映射与访问
Prefix Cache：哪些已经算过的页可以复用
Tiered Cache：这些页放在哪一层存储
Cache-aware Scheduler：请求应被路由到哪里
```

## 3. 一个最小但可运行的增量 Attention

下面代码展示数学机制，而不是高性能 kernel。它支持：

- Prefill；
- 单 token Decode；
- Chunked Prefill；
- RoPE 位置编码；
- MHA/GQA/MQA 的 KV head 重复；
- 与历史 cache 的 append。

代码需要 Python 3.10+ 与 PyTorch 2.x；它不依赖 vLLM/SGLang 的私有接口。

```python
from __future__ import annotations

from dataclasses import dataclass
import math

import torch
from torch import Tensor, nn


@dataclass
class LayerKV:
    key: Tensor    # [B, H_kv, T, D_h]
    value: Tensor  # [B, H_kv, T, D_h]

    @property
    def length(self) -> int:
        return self.key.size(2)

    def append(self, key: Tensor, value: Tensor) -> "LayerKV":
        return LayerKV(
            key=torch.cat((self.key, key), dim=2),
            value=torch.cat((self.value, value), dim=2),
        )


def apply_rope(x: Tensor, positions: Tensor, base: float = 10_000.0) -> Tensor:
    """Apply RoPE to [B, H, T, D_h]; D_h must be even."""
    head_dim = x.size(-1)
    if head_dim % 2:
        raise ValueError("RoPE requires an even head dimension")

    inv_freq = base ** (
        -torch.arange(0, head_dim, 2, device=x.device, dtype=torch.float32)
        / head_dim
    )
    angles = torch.outer(positions.to(torch.float32), inv_freq)
    cos = angles.cos()[None, None, :, :].to(dtype=x.dtype)
    sin = angles.sin()[None, None, :, :].to(dtype=x.dtype)

    even = x[..., 0::2]
    odd = x[..., 1::2]
    rotated = torch.stack(
        (even * cos - odd * sin, even * sin + odd * cos),
        dim=-1,
    )
    return rotated.flatten(-2)


def repeat_kv(x: Tensor, num_query_heads: int) -> Tensor:
    """Expand H_kv heads to H_q heads without changing cache storage."""
    num_kv_heads = x.size(1)
    if num_query_heads % num_kv_heads:
        raise ValueError("num_query_heads must be divisible by num_kv_heads")
    repeats = num_query_heads // num_kv_heads
    return x.repeat_interleave(repeats, dim=1)


class IncrementalSelfAttention(nn.Module):
    def __init__(
        self,
        model_dim: int,
        num_query_heads: int,
        num_kv_heads: int,
    ) -> None:
        super().__init__()
        if model_dim % num_query_heads:
            raise ValueError("model_dim must be divisible by num_query_heads")
        if num_query_heads % num_kv_heads:
            raise ValueError("query heads must be divisible by KV heads")

        self.model_dim = model_dim
        self.num_query_heads = num_query_heads
        self.num_kv_heads = num_kv_heads
        self.head_dim = model_dim // num_query_heads

        self.q_proj = nn.Linear(model_dim, num_query_heads * self.head_dim)
        self.k_proj = nn.Linear(model_dim, num_kv_heads * self.head_dim)
        self.v_proj = nn.Linear(model_dim, num_kv_heads * self.head_dim)
        self.o_proj = nn.Linear(model_dim, model_dim)

    def _split_heads(self, x: Tensor, heads: int) -> Tensor:
        batch, tokens, _ = x.shape
        return x.view(batch, tokens, heads, self.head_dim).transpose(1, 2)

    def forward(
        self,
        hidden: Tensor,
        cache: LayerKV | None = None,
    ) -> tuple[Tensor, LayerKV]:
        batch, new_tokens, _ = hidden.shape
        del batch

        offset = 0 if cache is None else cache.length
        positions = torch.arange(
            offset,
            offset + new_tokens,
            device=hidden.device,
        )

        query = self._split_heads(
            self.q_proj(hidden),
            self.num_query_heads,
        )
        key = self._split_heads(
            self.k_proj(hidden),
            self.num_kv_heads,
        )
        value = self._split_heads(
            self.v_proj(hidden),
            self.num_kv_heads,
        )

        query = apply_rope(query, positions)
        key = apply_rope(key, positions)
        new_cache = LayerKV(key, value) if cache is None else cache.append(key, value)

        full_key = repeat_kv(new_cache.key, self.num_query_heads)
        full_value = repeat_kv(new_cache.value, self.num_query_heads)
        scores = query @ full_key.transpose(-2, -1)
        scores = scores / math.sqrt(self.head_dim)

        query_positions = positions[:, None]
        key_positions = torch.arange(
            new_cache.length,
            device=hidden.device,
        )[None, :]
        causal_mask = key_positions > query_positions
        scores = scores.masked_fill(
            causal_mask[None, None, :, :],
            torch.finfo(scores.dtype).min,
        )

        attention = scores.softmax(dim=-1)
        output = attention @ full_value
        output = output.transpose(1, 2).contiguous()
        output = output.view(hidden.size(0), new_tokens, self.model_dim)
        return self.o_proj(output), new_cache


def verify_incremental_equivalence() -> None:
    torch.manual_seed(7)
    layer = IncrementalSelfAttention(
        model_dim=64,
        num_query_heads=8,
        num_kv_heads=2,
    ).eval()
    hidden = torch.randn(2, 12, 64)

    full_output, _ = layer(hidden)

    cache = None
    pieces = []
    for token_index in range(hidden.size(1)):
        output, cache = layer(hidden[:, token_index : token_index + 1], cache)
        pieces.append(output)
    incremental_output = torch.cat(pieces, dim=1)

    torch.testing.assert_close(
        incremental_output,
        full_output,
        rtol=1e-5,
        atol=1e-5,
    )


if __name__ == "__main__":
    verify_incremental_equivalence()
```

生产实现不会用 Python `torch.cat` 逐 token 搬动整个缓存。真正的系统会：

- 预分配 KV block pool；
- 用 slot mapping 把新 token 写入固定物理位置；
- kernel 通过 block table 访问非连续页；
- 维护 refcount、free queue 与事件；
- 在 Tensor Parallel rank 间按模型布局切分 KV；
- 用 fused kernel、CUDA graph、FlashDecoding 等减少 launch 与 IO 开销。

这段机制代码最重要的两个变量是 `offset` 与 `num_kv_heads`：前者保证位置正确，后者决定缓存容量。

## 4. KV-cache 的正确性约束：不是 token 相同就一定能复用

### 4.1 位置编码是缓存身份的一部分

对 RoPE，Key 在写入缓存前通常已经旋转到绝对位置 \(p\)：

$$
\widetilde{k}_p = R(p)k_p,\qquad
\widetilde{q}_t = R(t)q_t
$$

因此一段 token 在位置 0 开始生成的 KV，不能未经处理就搬到位置 10,000。普通 Prefix Cache 之所以安全，是因为相同前缀从相同起点出现，位置完全一致。

需要纳入身份或显式验证的配置至少包括：

- 模型权重 revision；
- Tokenizer 与 chat template revision；
- RoPE base、scaling 与位置偏移策略；
- Attention mask 和 sliding-window 配置；
- KV dtype 与量化 scale 规则；
- Tensor/Context Parallel 拓扑；
- LoRA/Adapter ID；
- Prompt tuning、soft prompt 或多模态 embedding 的额外 ID；
- 租户、项目、权限域和数据驻留域。

[TensorRT-LLM 的 KV reuse 文档](https://nvidia.github.io/TensorRT-LLM/advanced/kv-cache-reuse.html) 特别指出：P-tuning 的 fake token ids 可能相同，但背后的 Prompt embedding 不同，因此必须提供额外 ID。这个例子说明，**token id 只是缓存身份的一部分，不是完整身份。**

### 4.2 以下变化通常会导致 Prefix Cache miss

```text
工具定义新增、删除、换序
System Prompt 改了一个字符
JSON key 顺序不稳定
模板升级或特殊 token 改变
历史消息被摘要后替换
检索文档顺序变化
在稳定前缀前插入时间戳、request_id、nonce
模型或 Adapter 切换
图像/音频内容改变但占位 token 没变
```

采样温度、top-p、随机种子通常不改变**已给定输入前缀**的 KV，但会改变生成出来的后缀。后续轮次若包含不同生成结果，命中自然会在分叉处停止。

### 4.3 Cache hit 必须是“最长连续相同前缀”

普通 Prefix Cache 的可复用长度是两段 token 序列的 Longest Common Prefix：

$$
L_{\text{reuse}} =
\max\left\{
k \mid x_{1:k}=y_{1:k}
\right\}
$$

如果两个 Prompt 只是中间共享同一篇文档，前面内容不同，直接拼接预计算 KV 并不严格等价。原因是文档 token 在原计算中没有看到新的前文，缺少跨 chunk Attention。

[CacheBlend](https://arxiv.org/abs/2405.16444) 研究的正是非前缀知识块复用：加载独立 chunk 的 KV 后，选择性重算一部分 token 来恢复跨 chunk 依赖。它不是普通 Prefix Cache 的自然延伸，而是带近似选择与重算策略的新执行路径，必须单独评测质量。

## 5. 从连续张量到分页内存：PagedAttention 改变了什么

在早期服务系统中，一个请求往往按 `max_seq_len` 预留连续 KV 空间。实际输出长度未知且差异很大，导致三类浪费：

1. 为未来 token 预留但最终没有使用；
2. 请求之间产生外部碎片；
3. 最后一个分配单元产生内部碎片。

[PagedAttention / vLLM](https://arxiv.org/abs/2309.06180) 借鉴虚拟内存，把序列的逻辑 KV blocks 映射到非连续物理 blocks。

最值得看的是图中 Query `forth` 如何同时读取 Block 1、2、0：逻辑 token 顺序连续，物理位置却不需要连续。这层间接寻址让调度器可以按需分配、回收和共享页。

![[AR与KV-cache.assets/02-pagedattention-figure5.png]]
*图 2　PagedAttention 对非连续 KV blocks 的访问。原论文 Figure 5，[Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180)，裁剪自原始 PDF，版权归原作者。*

### 5.1 核心数据结构

```text
Request
  logical block 0 ──> physical block 91
  logical block 1 ──> physical block 17
  logical block 2 ──> physical block 64

Physical Block Pool
  block_id
  layer-wise K/V storage
  refcount
  state: FREE | WRITING | READY | EVICTING
  prefix hash / radix node
  last_access
  priority
```

Kernel 获得的不是单一连续指针，而是：

- 每个序列的 block table；
- 新 token 对应的 slot mapping；
- 每层 KV pool 的基址；
- 每个块的 token 数与有效长度。

### 5.2 为什么它能提高并发

假设物理块包含 \(P\) 个 token，序列长度为 \(T\)，分配块数：

$$
N_{\text{blocks}} = \left\lceil \frac{T}{P} \right\rceil
$$

内部碎片最多是最后一个块的 \(P-1\) 个 token，而不是按最大序列长度预留整个尾部。请求完成后，物理块可立即回到 free queue。

这使 Continuous Batching 成为自然选择：

- 每个 iteration 重新选择可运行序列；
- 已完成序列释放 blocks；
- 新序列进入；
- 被抢占序列可以 swap、recompute 或稍后恢复；
- Batch 不再绑定一组同时开始、同时结束的请求。

### 5.3 Copy-on-Write 支持分支

Beam Search、并行采样、Agent 分支和 Tree Search 都会从同一前缀分叉。分页系统可以让多个序列的逻辑 block table 指向同一物理前缀：

```text
branch A ─┐
branch B ─┼─> shared prefix blocks
branch C ─┘
```

只有写入共享末块时才 Copy-on-Write。这样既省容量，也避免重复 Prefill。引用计数必须跟请求生命周期和异常取消严格一致，否则会出现泄漏或提前回收。

### 5.4 PagedAttention 不自动等于 Prefix Cache

PagedAttention 提供“块可共享”的机制，但跨请求复用还需要：

- 稳定的缓存身份；
- Prefix index；
- Ready/commit 语义；
- 驱逐策略；
- 租户隔离；
- Scheduler 的命中感知。

分页是内存管理基础，前缀缓存是其上的复用策略。

## 6. 从单请求缓存到跨请求复用：Radix tree 与 block hash

### 6.1 为什么复杂 LLM 程序比普通聊天更需要复用

Agent、RAG、few-shot、self-consistency 和多分支推理常有大量重复前缀：

```text
[固定工具定义]
[固定安全策略]
[长 system prompt]
[相同知识库或文档]
[相同 few-shot examples]
[共享历史]
[本轮动态输入]  ← 只有尾部变化
```

如果每次都重新 Prefill，模型服务反复计算相同张量。2023 年的 [Prompt Cache](https://arxiv.org/abs/2311.04934) 用显式 Prompt modules 预计算可复用 Attention 状态；[SGLang](https://arxiv.org/abs/2312.07104) 的 RadixAttention 则用 radix tree 自动维护运行中出现的 token 前缀。

### 6.2 RadixAttention：共享的不只是 System Prompt

下面的九个时间点展示了两类重要行为：

- 新会话只共享根部 System Prompt；
- 同一会话追加 turn 时复用更长历史；
- few-shot batch 与 self-consistency 形成不同的树分叉；
- 容量不足时按 LRU 驱逐叶子。

![[AR与KV-cache.assets/03-radixattention-figure3.png]]
*图 3　RadixAttention 的多请求插入、分裂、命中与 LRU 驱逐。原论文 Figure 3，[SGLang: Efficient Execution of Structured Language Model Programs](https://arxiv.org/abs/2312.07104)，裁剪自原始 PDF，版权归原作者。*

Radix tree 的优势是共享关系直观，最长前缀查询自然；代价是树结构、节点分裂和并发维护更复杂。

### 6.3 vLLM 的链式 block hash

[vLLM Automatic Prefix Caching](https://docs.vllm.ai/en/latest/design/prefix_caching/) 把每个完整块标识为：

$$
h_i =
H\left(
h_{i-1},
\text{tokens}_i,
\text{extra}
\right)
$$

其中 `extra` 应包含所有会改变 KV 的身份信息。链式 hash 的关键不是“对当前块 token 求 hash”，而是把父 hash 带入；否则相同 token block 出现在不同前缀后会被错误地认为相同。

Hash table 方案的特点：

- 每块独立寻址，不必维护显式树；
- Parent hash 隐式编码完整前缀；
- 便于把 LoRA ID、模态 hash、tenant salt 加入身份；
- 只有完整块通常能直接共享；
- 必须考虑 hash collision 与恶意构造输入。

Radix tree 与 chained hash 不是谁绝对更先进，而是两种索引表达。系统最终仍需解决相同问题：匹配、引用、驱逐和隔离。

### 6.4 一段生产可用的缓存身份骨架

下面代码只负责生成稳定、租户隔离的 block digest；它不负责存储和网络协议。

```python
from __future__ import annotations

from dataclasses import dataclass, asdict
import hashlib
import json
import struct
from typing import Iterable


@dataclass(frozen=True)
class CacheIdentity:
    model_revision: str
    tokenizer_hash: str
    chat_template_hash: str
    adapter_id: str | None
    rope_config_hash: str
    attention_config_hash: str
    kv_dtype: str
    parallel_layout: str
    modality_hash: str | None
    tenant_scope: str

    def canonical_bytes(self) -> bytes:
        payload = json.dumps(
            asdict(self),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return payload.encode("utf-8")


def _encode_token_ids(token_ids: Iterable[int]) -> bytes:
    values = list(token_ids)
    if any(token_id < 0 for token_id in values):
        raise ValueError("token ids must be non-negative")
    return b"".join(struct.pack(">Q", token_id) for token_id in values)


def chained_block_digest(
    parent_digest: bytes,
    token_ids: Iterable[int],
    identity: CacheIdentity,
    tenant_salt: bytes,
) -> bytes:
    """
    tenant_salt should come from a secret manager or KMS.
    Never log it and never derive it from a public tenant name.
    """
    if len(parent_digest) not in (0, 32):
        raise ValueError("parent digest must be empty or a SHA-256 digest")
    if len(tenant_salt) < 16:
        raise ValueError("tenant_salt must contain at least 128 bits")

    hasher = hashlib.sha256()
    hasher.update(b"kv-block-v1\x00")
    hasher.update(tenant_salt)
    hasher.update(parent_digest)
    hasher.update(identity.canonical_bytes())
    hasher.update(_encode_token_ids(token_ids))
    return hasher.digest()


def build_prefix_chain(
    token_ids: list[int],
    block_size: int,
    identity: CacheIdentity,
    tenant_salt: bytes,
) -> list[bytes]:
    if block_size <= 0:
        raise ValueError("block_size must be positive")

    parent = b""
    digests = []
    for start in range(0, len(token_ids), block_size):
        block = token_ids[start : start + block_size]
        if len(block) != block_size:
            break  # Partial tail is not globally committed.
        parent = chained_block_digest(parent, block, identity, tenant_salt)
        digests.append(parent)
    return digests
```

生产实现还必须补：

- hash 命中后的长度、身份和可选二次校验；
- `WRITING → READY` 原子提交；
- 读者引用计数与 hazard/epoch 保护；
- tenant ACL，而非只依赖 hash 不可猜；
- key rotation 与版本迁移；
- 缓存目录和数据块的校验和；
- 远端传输失败后的 recompute fallback；
- 指标中不暴露原始 token 或可逆 Prompt 标识。

## 7. 跨对话 KV-cache：到底什么可以复用

“跨对话”至少有四种不同场景。

### 7.1 同一会话的下一轮

若第 \(n\) 轮请求是：

```text
System + Tools + User1 + Assistant1 + ... + UserN
```

第 \(n+1\) 轮通常是：

```text
System + Tools + User1 + Assistant1 + ... + UserN + AssistantN + User(N+1)
```

后一请求包含前一请求的完整 token 前缀，因此可以复用到前一轮末尾附近。这是最自然、收益最稳定的跨请求缓存。

失效常见于：

- 服务端重写了历史消息；
- 中间插入新的 System/Developer 指令；
- 工具列表或 Tool schema 改变；
- 对话被摘要替换；
- 服务端把 reasoning item、引用或多模态块序列化成不同格式。

### 7.2 不同会话共享相同系统前缀

不同用户会话可以在**同一隔离域**内共享：

- System Prompt；
- 工具定义；
- 安全策略；
- 公共 few-shot examples；
- 同一版本的公共知识前缀。

但默认不应跨租户共享私有前缀。即使物理张量看起来不可逆，命中时间、资源占用和错误配置仍可能形成侧信道。TensorRT-LLM 提供 `cache_salt` 控制可复用域；vLLM 文档也建议以 salt 防止潜在的 prompt theft。

### 7.3 同一用户跨 session 恢复

如果用户关闭会话后稍后继续，有三层状态：

1. 会话账本仍保存消息；
2. KV-cache 可能因 TTL、驱逐或实例重启已经不存在；
3. 长期记忆可能新增或修订事实。

恢复顺序应是：

```text
读取权威会话状态
→ 按当前权限和知识快照重新编译 Prompt
→ 查询兼容 KV blocks
→ 命中则加载，未命中则 Prefill
→ 继续 Decode
```

不能反过来用“缓存是否还在”决定会话事实。KV-cache 是可丢失的派生物，应当能够从 token 前缀重建。

### 7.4 不同对话只是在语义上相似

两个对话都在讨论同一个项目，不等于 token 前缀相同。普通 KV-cache 无法按 embedding 相似度安全命中。

正确组合是：

```text
Semantic Memory / RAG
  负责找到应该注入的内容

Deterministic Prompt Compiler
  负责把相同内容放在稳定位置并稳定序列化

KV Prefix Cache
  负责复用由此产生的相同 token 前缀
```

这三层联动后，语义检索才可能间接提高 KV 命中，但不能把“相似召回”直接当成“相同 KV”。

### 7.5 API 世界中的三类缓存契约

| 契约 | 调用者看到什么 | 优点 | 风险与限制 |
|---|---|---|---|
| 隐式 Prefix Cache | 正常发 Prompt，响应返回 cached tokens | 接入最简单 | TTL、位置和驱逐通常不可控 |
| 显式 Breakpoint | 在稳定内容末尾标记 cache point | 可控制写入边界 | Prompt 顺序和产品规则耦合 |
| 显式 Cached Content Handle | 先创建 cache resource，再用 ID 引用 | 跨请求关系清晰，可设 TTL | 有存储费用、生命周期和权限治理 |

截至 2026-07-23：

- [OpenAI Prompt Caching](https://developers.openai.com/api/docs/guides/prompt-caching) 支持前缀缓存与缓存 token 观测；具体模式、TTL 和计费应以当前模型文档为准。
- [Anthropic Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) 同时提供自动缓存和显式 breakpoints，并说明工具、System、Messages 的前缀顺序以及 5 分钟/1 小时 TTL 选项。
- [Gemini Context Caching](https://ai.google.dev/gemini-api/docs/caching) 提供隐式缓存；`generateContent` 路径还可创建带 TTL 的 CachedContent 资源。
- 自托管侧，[vLLM APC](https://docs.vllm.ai/en/latest/design/prefix_caching/)、[SGLang HiCache](https://docs.sglang.io/advanced_features/hicache_design.html)、[TensorRT-LLM KV Cache System](https://nvidia.github.io/TensorRT-LLM/latest/features/kvcache.html) 和 [LMCache](https://docs.lmcache.ai/) 提供不同程度的跨请求、分层或跨实例复用。

不要把某家 API 的 `previous_response_id`、会话 ID 或持久化 reasoning item 自动等同于底层 KV handle。产品可能复用 KV，也可能重建 Prompt，调用者只能依赖官方承诺的接口语义和 usage 字段。

## 8. Prompt 怎样写，才能真正获得跨会话命中

### 8.1 把稳定内容放前面，动态内容放后面

推荐顺序：

```text
1. 稳定工具定义
2. 稳定 System / Policy
3. 版本化的公共背景或大文档
4. Few-shot examples
5. 共享会话历史
6. 本轮动态检索结果
7. 当前时间、request_id、用户输入
```

如果时间戳被放在最开头，那么后面几十万 token 即使完全相同也不会命中同一前缀。

### 8.2 Prompt Compiler 必须确定性

至少固定：

- JSON key 排序和空白；
- Tool 列表顺序；
- 文档排序与去重规则；
- 换行、Unicode 规范化和特殊 token；
- System/Developer/User/Tool 的模板；
- 模型与 Tokenizer revision；
- Memory 与 RAG 注入位置；
- 摘要版本和知识快照 ID。

一个常见反模式是每轮都用无序 Map 生成 Tool schema。人眼看到的语义没有变化，token 序列却可能不同。

### 8.3 用多个稳定断点表达不同变化频率

```text
[公司级政策，月度变化]          ← 长 TTL / 高优先级
[Agent 工具与角色，日级变化]    ← 中 TTL
[当前会话历史，分钟级增长]       ← 自动向后移动
[本轮 Tool 输出与用户输入]       ← 不预热
```

断点不是越多越好。每个断点都会增加写入、索引和治理成本；应由复用概率、Prefill 成本和 TTL 决定。

### 8.4 Agent Tool Loop 的特殊性

一次 Agent 请求可能在模型与 Tool 之间来回多次：

```text
Prompt → Model → Tool Call → Tool Result
       → Model → Tool Call → Tool Result
       → Model → Final
```

每一步都在前缀末尾追加内容，理论上非常适合缓存。但要避免：

- 每轮重排全部工具；
- 把所有可用工具都常驻在前缀中；
- Tool Result 被不同序列化器重复编码；
- 服务端在中间步骤改变 thinking 或 tool-choice 配置；
- 长时间等待 Tool 时一直占用稀缺 HBM KV。

对长 Tool 调用或人工审批，可在三种策略中选择：

| 策略 | 何时使用 | 代价 |
|---|---|---|
| 保留 HBM KV | 等待很短、恢复延迟敏感 | 占用最贵容量 |
| Offload 到 CPU/SSD | 等待中等、上下文长 | 传输与恢复延迟 |
| 丢弃并重算 | 等待长、命中概率低 | 恢复时付 Prefill |

选择不能只看上下文长度，还要看预计等待时间、复用概率、队列压力与 SLO。

## 9. KV-cache 变成分布式系统资源

### 9.1 为什么单机 HBM 不够

跨请求缓存扩大后会出现新问题：

- 热前缀不一定在接收请求的 GPU；
- HBM 容量不足以长期保留；
- Prefill 和 Decode 的资源特性不同；
- 请求路由只做最短队列会丢失数据局部性；
- 远端加载可能阻塞 TTFT；
- 实例重启会让节点内缓存全部丢失。

这推动了两条路径：

1. **P/D Disaggregation**：Prefill 与 Decode 使用不同 Worker 池；
2. **Tiered/Distributed KV Store**：KV 在 GPU、CPU、SSD 与节点间移动。

### 9.2 Mooncake：缓存位置进入全局调度

[Mooncake](https://arxiv.org/abs/2407.00079) 把 Kimi 服务描述为 KVCache-centric disaggregated architecture。图中最重要的不是组件数量，而是两组不同目标：

- Prefill 侧希望最大化可复用 KV，同时满足 TTFT；
- Decode 侧希望扩大有效 Batch，同时满足 TBT；
- 中间的 CPU/DRAM/SSD KV pool 和节点间 RDMA 让“缓存在哪里”成为 Scheduler 输入。

![[AR与KV-cache.assets/04-mooncake-figure1.png]]
*图 4　Mooncake 的 Prefill/Decode 解耦、分布式 KV pool 与调度职责。原论文 Figure 1，[Mooncake: A KVCache-centric Disaggregated Architecture for LLM Serving](https://arxiv.org/abs/2407.00079)，裁剪自原始 PDF，版权归原作者。*

Mooncake 报告的吞吐改进是其特定真实负载和模拟实验结果，不能直接外推到其他模型或网络。它更有价值的启示是：**Cache-aware routing、传输和 SLO 必须联合优化。**

### 9.3 四层缓存的典型职责

| 层 | 容量 | 延迟/带宽 | 适合内容 | 主要策略 |
|---|---:|---|---|---|
| GPU HBM | 最小 | 最快 | 运行中序列、最热前缀 | refcount、优先级、LRU |
| CPU DRAM | 中 | PCIe/NVLink/RDMA | 暂停请求、温热前缀 | pinned memory、异步预取 |
| Local NVMe | 大 | 更慢 | 长 TTL、预热、恢复 | 压缩、Direct IO、校验 |
| Remote Store | 最大 | 网络相关 | 跨实例公共前缀 | 目录、复制、租户隔离 |

[CacheGen](https://arxiv.org/abs/2310.07240) 的核心问题是：KV 本身很大，从远端取回可能抵消复用收益，因此需要专用压缩与按带宽自适应加载。[LMCache](https://docs.lmcache.ai/) 则把 KV 管理从单一推理进程中拆出，支持 CPU、本地存储和远端后端，以减少 engine fate-sharing。

### 9.4 “加载还是重算”必须有成本模型

设：

- \(T_{\text{prefill}}(N)\)：本地重算 \(N\) 个 token 的时间；
- \(T_{\text{lookup}}\)：查询目录时间；
- \(T_{\text{load}}(N,\text{tier})\)：从某层加载 KV 的时间；
- \(T_{\text{verify}}\)：校验与映射时间；
- \(P_{\text{hit}}\)：缓存实际可用概率。

只有在近似满足：

$$
T_{\text{lookup}}
+
T_{\text{load}}
+
T_{\text{verify}}
<
T_{\text{prefill}}
$$

且不会违反 TTFT SLO 时，读缓存才值得。考虑 miss 后回退，期望成本是：

$$
\mathbb{E}[T]
=
P_{\text{hit}}
\left(
T_{\text{lookup}}+T_{\text{load}}+T_{\text{verify}}
\right)
+
(1-P_{\text{hit}})
\left(
T_{\text{lookup}}+T_{\text{prefill}}
\right)
$$

这解释了为什么短 Prompt、低复用内容或慢远端存储可能不适合缓存。

### 9.5 数据局部性与负载均衡会冲突

最短队列路由可能把请求送到没有缓存的节点；纯缓存亲和路由又可能把热点压到单节点。Scheduler 应综合：

```text
predicted_finish_time
= queue_delay
+ cache_lookup
+ cache_transfer_or_prefill
+ expected_decode
+ SLO_penalty
```

常用手段：

- 热块复制到多个节点；
- 为超热公共前缀预热；
- 用一致性 hash 缩小候选 Worker；
- 缓存目录只记录位置与版本，不保存语义真值；
- 当网络拥塞时切换为本地重算；
- 区分 Prefill affinity 与 Decode balance。

## 10. 容量不够时的六类策略

KV-cache 优化不能只靠一种技术。

| 策略 | 改变什么 | 是否精确等价 | 主要风险 |
|---|---|---|---|
| MQA/GQA | KV head 数 | 模型训练后是其定义行为 | 质量与模型兼容 |
| KV Quantization | 每元素 bit 数 | 数值近似 | 精度、scale、kernel 支持 |
| Paged Allocation | 物理布局 | 是 | 间接寻址与块管理开销 |
| Prefix Reuse | 跳过相同前缀 Prefill | 条件满足时是 | 错误身份、侧信道 |
| Offload/Tiering | KV 所在介质 | 是 | 传输延迟、拥塞 |
| Eviction/Compression | 保留哪些 token 或表示 | 常为近似 | 长程能力与任务退化 |

### 10.1 KV 量化

[KIVI](https://arxiv.org/abs/2402.02750) 观察到 Key 与 Value 的分布特性不同，提出 Key 按 channel、Value 按 token 的非对称 2-bit 量化。工程上还要决定：

- FP8、INT8、INT4 或更低；
- per-tensor、per-head、per-channel、per-token scale；
- residual window 是否保留高精度；
- 量化/反量化是否有 fused kernel；
- Prefill 写入与 Decode 读取的额外开销；
- 长上下文、代码、数学、RAG 与多语言的质量回归。

不能只用困惑度判断。Agent 还要测 Tool Call JSON、长程约束、引用一致性和任务成功率。

### 10.2 Token eviction

[H2O](https://arxiv.org/abs/2306.14048) 保留 recent tokens 与 Heavy Hitters；[StreamingLLM](https://arxiv.org/abs/2309.17453) 指出简单滑窗会破坏 attention sink，保留初始 sink tokens 可改善流式稳定性。

这类策略改变模型可见的历史状态，因此不再是纯系统透明优化。应明确：

- 哪些层使用窗口；
- 哪些 token 永不驱逐；
- 任务是否依赖远距离精确检索；
- Cache eviction 与语义 Context pruning 是否重复伤害信息；
- 模型是否为该策略训练或校准。

### 10.3 Recomputation

重算不是失败，而是缓存系统的正常下层：

- Cache miss；
- 远端加载预计更慢；
- 身份不兼容；
- 数据删除或权限收紧；
- 校验和错误；
- 存储层不可用；
- 模型升级后旧 KV 失效。

一个健壮系统应支持“禁用所有跨请求缓存仍然正确运行”。这既是故障降级，也是验证缓存透明性的基线。

## 11. Agent 的跨会话生产架构

下图把责任分成四层。KV-cache 只占后两层；上两层负责确定“当前请求究竟应该看到什么”和“哪些派生状态可以共享”。

![[AR与KV-cache.assets/05-agent-cross-session-architecture.svg]]
*图 5　Agent 跨会话 KV-cache 的语义平面、控制面、推理数据面与分层存储。本文归纳。*

### 11.1 语义平面：永远先于缓存

**会话账本**保存：

- Message 与 role；
- Tool Call/Result；
- 审批和人工输入；
- 分支、回滚、checkpoint；
- 模型与 Prompt 版本；
- 输入输出 Artifact 引用。

**Mem-OS**保存：

- 事实、偏好、规则和经验；
- 来源、时间、范围和权限；
- 冲突、修订与删除血缘；
- 当前任务需要注入的少量上下文。

二者产生确定性 Prompt。只有 Prompt 编译完成后，系统才查询 KV-cache。

### 11.2 缓存控制面：身份、生命周期和成本

建议为每个缓存对象保留：

```yaml
cache_id: opaque-id
state: READY
parent_digest: sha256
block_digest: sha256
token_count: 256
model_revision: model@sha
tokenizer_hash: sha256
template_hash: sha256
adapter_id: null
rope_config_hash: sha256
kv_dtype: fp8
parallel_layout: tp8
tenant_scope: tenant/project
knowledge_snapshot_id: optional-audit-id
created_at: timestamp
expires_at: timestamp
last_access_at: timestamp
storage_locations:
  - gpu://worker/rank/block
  - cpu://worker/block
checksum: sha256
```

`knowledge_snapshot_id` 主要用于审计和批量失效，不意味着 KV 能替代知识快照。

### 11.3 数据面的提交协议

一个 block 不应在部分 rank 或部分 layer 写完时可见。最小状态机：

```text
FREE
  → RESERVED
  → WRITING
  → READY
  → EVICTING
  → FREE

WRITING / TRANSFERRING
  → CORRUPT
  → FREE
```

跨节点写入可采用两阶段语义：

1. 写数据块并校验；
2. 原子发布目录项 `READY`。

读者只引用 `READY` 版本。驱逐先从目录隐藏，再等待 refcount/epoch 清零后回收物理页，避免 use-after-free。

### 11.4 Tool 结果与长等待

Tool Result 是会话事实，但其 KV 是派生状态：

- 原始 Tool Result 写入 Run log；
- Prompt Compiler 决定保留原文、摘要还是 Artifact 引用；
- 当前编译结果形成新的 token 后缀；
- KV 写入可在本轮完成后提交；
- 如果等待下一轮超过 TTL，重新 Prefill 不影响事实正确性。

对“浏览器打开后等待用户操作”“人工审批”“长作业回调”一类暂停，Agent OS 需要保存 checkpoint，而不是无限 Pin GPU KV。

## 12. 安全、隐私和失效：跨会话复用最容易被低估的部分

### 12.1 默认隔离层级

建议默认：

```text
组织
  └── 项目 / Workspace
      └── 模型 + Adapter + 数据驻留域
          └── 用户或共享策略组
```

只有明确标注为公共且无敏感信息的稳定前缀，才可扩大共享域。租户 salt 是索引隔离的一部分，但不能替代 ACL。

### 12.2 侧信道

攻击者可能通过：

- TTFT 差异推断某前缀是否被其他人使用；
- 构造共享前缀竞争缓存容量；
- 观察驱逐和吞吐变化；
- 利用 hash collision 或错误 extra ID；
- 读取未清零的复用物理页。

缓解手段：

- tenant/project salt；
- 物理页清零或安全覆写；
- 命中指标只对授权主体可见；
- 配额和 admission control；
- 常量时间不是总能实现，但可对高风险域禁用跨用户共享；
- hash 使用现代密码学摘要，并做结构化域分隔；
- 模糊测试 cache key 和 block table。

### 12.3 删除与“被遗忘权”

如果源内容被删除：

1. 会话/知识层先阻止继续编译该内容；
2. 以 source/version → prompt snapshot → cache digest 的血缘定位派生缓存；
3. 从目录隐藏并撤销授权；
4. 清理 HBM、DRAM、SSD 和远端副本；
5. 记录删除完成度与失败重试；
6. 禁止旧 handle 继续引用。

只等 TTL 自然过期未必满足合规要求。对显式长期缓存尤其要有删除 API 和审计。

### 12.4 模型滚动升级

蓝绿部署时必须防止新旧模型共享不兼容 KV：

```text
cache namespace =
  model_revision
  + tokenizer_revision
  + template_revision
  + adapter_revision
  + attention_config
  + kv_format_version
```

升级可以保留旧 namespace 供旧实例排空，不能复用到新实例。若希望跨 revision 复用，需要专门的状态转换研究与严格验证，不应靠“参数看起来差不多”猜测兼容。

## 13. 观测：命中率不是最终目标

### 13.1 四组核心指标

**用户体验**

- TTFT p50/p95/p99；
- Inter-token Latency / TBT；
- End-to-end latency；
- SLO miss rate。

**缓存效果**

- request-level hit rate；
- token-weighted hit ratio；
- reusable prefix length；
- cache write/read tokens；
- load bytes、load latency；
- recompute saved time。

**资源**

- HBM/DRAM/NVMe occupancy；
- free blocks 与 fragmentation；
- block utilization；
- eviction rate、thrash rate；
- PCIe/NVLink/RDMA 带宽；
- Prefill/Decode worker utilization。

**正确性与安全**

- cache identity mismatch；
- checksum failure；
- stale namespace access；
- cross-tenant denied reuse；
- deletion completion；
- fallback success。

Token-weighted hit ratio 比 request hit rate 更有信息：

$$
R_{\text{token-hit}}
=
\frac{
\sum_r N_{\text{reused},r}
}{
\sum_r N_{\text{prompt},r}
}
$$

但它仍不是最终业务指标。缓存 100 个短请求可能不如命中一个 100K 长前缀；命中远端冷块也可能比重算更慢。

### 13.2 应记录“实际节省”，而不是理论命中

建议每请求记录：

```text
prompt_tokens
matched_tokens
loaded_tokens
recomputed_tokens
cache_lookup_ms
cache_transfer_ms
prefill_ms
estimated_prefill_saved_ms
ttft_ms
cache_tier
eviction_cause
fallback_reason
```

区分：

- `matched_tokens`：目录认为可命中；
- `loaded_tokens`：实际成功载入；
- `reused_tokens`：Kernel 真正使用；
- `saved_compute`：相对于无缓存基线实际节省。

否则会出现“报表命中率很高，但 TTFT 没改善”的假成功。

### 13.3 基准测试矩阵

至少覆盖：

| 维度 | 取值 |
|---|---|
| Prompt 长度 | 短、中、长、极长 |
| 共享比例 | 0%、25%、50%、90%、100% |
| 并发 | 1、稳态、突发、过载 |
| 输出长度 | 短回答、长生成、推理链 |
| 会话 | 单轮、多轮、分支、暂停恢复 |
| 缓存层 | HBM、CPU、NVMe、远端 |
| 失效 | TTL、LRU、版本升级、删除 |
| 安全域 | 同用户、同项目、跨项目拒绝 |
| 故障 | 目录丢失、块损坏、网络超时、Worker 重启 |

对每个场景做 A/B：

1. Prefix Cache 关闭；
2. 只开 HBM；
3. 加 Host offload；
4. 加远端层；
5. 量化开/关；
6. 不同 block size。

固定模型、Prompt、Tokenizer、并发轨迹和硬件，否则结果不可比较。

## 14. Block size、驱逐和预热怎样选

### 14.1 Block size

小块：

- 前缀尾部浪费少；
- 命中粒度细；
- block table 与 hash 元数据更多；
- kernel 间接访问开销可能更高。

大块：

- 元数据少、访问更规整；
- 只有完整块可共享时，尾部可复用损失更大；
- 短 Prompt 更难受益；
- Copy-on-Write 复制粒度更粗。

不能只看 kernel microbenchmark。应以真实 Prompt 长度分布和共享边界做端到端测试。

### 14.2 驱逐

基础 LRU 简单，但不一定最优。生产优先级可考虑：

$$
\text{value(block)}
\approx
\frac{
P_{\text{reuse}}
\cdot
T_{\text{prefill-saved}}
}{
\text{bytes}
}
-
\text{transfer-cost}
-
\text{risk-penalty}
$$

可加入：

- 访问频率与最近性；
- 前缀深度；
- 重算成本；
- 租户配额；
- SLO 等级；
- 公共前缀保护；
- 删除/敏感内容惩罚；
- 远端是否已有副本。

### 14.3 预热

适合预热：

- 超长且稳定的 System/Policy；
- 大量请求共享的工具定义；
- 活动开始前确定会被访问的文档；
- 模型新版本上线后的公共前缀；
- 峰值前可预测的 Agent workflow。

不适合预热：

- 每次都变化的检索结果；
- 低复用、短 TTL 内容；
- 含用户私密数据但授权域不清；
- 加载时间大于重算时间的冷层；
- 还未通过版本和删除治理的 Prompt。

## 15. 常见误区

### 误区一：上下文窗口越大，KV-cache 收益越大

长前缀若能高频复用，收益确实大；但长上下文也让 KV 更大、更难驻留和传输。收益取决于复用频率、层级位置与重算/加载比。

### 误区二：跨会话缓存就是让模型拥有长期记忆

KV 丢失后模型仍可从会话账本重建；真正的记忆要处理来源、时间、权限、冲突和删除。把 KV 当记忆会让系统不可解释、不可修订。

### 误区三：相同字符串一定命中

Tokenizer、模板、位置、Adapter、模型 revision 或模态 embedding 任一不同，都可能产生不同状态。

### 误区四：命中越多越好

远端冷块、低价值短前缀或跨节点拥塞可能让命中更慢。最终看实际 TTFT、吞吐、成本和 SLO。

### 误区五：PagedAttention 已经解决全部 KV 问题

它解决内存布局与动态分配。跨请求身份、分布式目录、权限、TTL、删除和可观测性仍需独立系统。

### 误区六：量化、驱逐都是透明优化

分页和精确前缀复用在条件满足时可保持数学等价；低 bit 量化与 token eviction 往往改变数值或可见历史，必须做质量评测。

### 误区七：缓存故障应该阻止请求

除非业务明确要求“必须使用某个预热快照”，普通 KV-cache 应是可选加速层。目录、存储或 checksum 失败时，应降级到 Prefill。

## 16. 一套可执行的落地顺序

### 阶段一：先让单请求正确且可测

- 验证 full forward 与 incremental decode 等价；
- 明确每层 KV layout；
- 计算每 token bytes；
- 区分 TTFT 与 ITL；
- 建立 cache disabled 基线。

### 阶段二：分页与连续批处理

- 建 block pool、block table、slot mapping；
- 实现 refcount 与回收；
- 支持取消、超时和异常；
- 压测碎片、OOM 与长短请求混合；
- 验证分支 Copy-on-Write。

### 阶段三：节点内 Prefix Cache

- 建确定性 Prompt Compiler；
- 定义完整 CacheIdentity；
- 只提交完整 READY blocks；
- 默认项目级隔离；
- 上报 matched/loaded/reused tokens；
- 做版本和 TTL 失效。

### 阶段四：Agent 多轮与暂停恢复

- 会话账本成为唯一事实来源；
- 让工具定义和 System Prompt 稳定；
- 将动态数据移到缓存断点后；
- 对长 Tool 等待选择保留、offload 或重算；
- 支持分支、回滚和模型切换。

### 阶段五：分层与跨实例

- 先测 load/recompute break-even；
- 增加 CPU 层，再考虑 SSD/远端；
- Cache-aware routing 与负载均衡联调；
- 加 checksum、目录提交和故障回退；
- 完成跨租户拒绝与删除测试。

### 阶段六：再做量化和选择性驱逐

- 在真实任务回归集上评测；
- 分开测文本质量与系统吞吐；
- 对长程检索、Tool JSON、代码和数学单测；
- 保留精确模式作为高风险请求 fallback。

## 17. 收敛判断：KV-cache 已经成为模型服务的状态平面

今天几条技术路线正在收敛成稳定模块：

1. 模型结构用 MQA/GQA/MLA 一类方法降低状态规模；
2. kernel 用 IO-aware attention 高效读写；
3. allocator 用分页管理动态 token；
4. index 用 radix tree 或 chained hash 找共享前缀；
5. scheduler 联合考虑队列、缓存位置和 SLO；
6. storage 用 HBM/DRAM/NVMe/远端分层；
7. control plane 管版本、TTL、隔离、删除和观测；
8. Agent Runtime 用确定性 Prompt Compiler 把语义状态编译为可复用前缀。

未来增益不会只来自一个更快 kernel。更大的空间在于：

- 模型与系统联合设计的更小状态；
- 非前缀复用的正确性与高效重算；
- 跨实例 KV 的标准格式与传输协议；
- Cache-aware Agent 编排；
- 对敏感共享的强隔离；
- 基于真实节省而非命中率的调度；
- 缓存、Context Compiler 与长期记忆之间的清晰边界。

最终应记住：

> **KV-cache 是“已执行上下文”的物化视图。它可以被驱逐、重建和迁移；会话事实与长期知识不能。**

当这个边界成立时，跨对话缓存才会成为 Agent 的基础设施，而不是隐藏在推理框架里的危险捷径。

## 参考资料

### 原理与模型结构

- Vaswani et al., [Attention Is All You Need](https://arxiv.org/abs/1706.03762), 2017.
- Shazeer, [Fast Transformer Decoding: One Write-Head is All You Need](https://arxiv.org/abs/1911.02150), 2019.
- Ainslie et al., [GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints](https://arxiv.org/abs/2305.13245), 2023.
- Dao et al., [FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness](https://arxiv.org/abs/2205.14135), 2022.

### 分页、复用与分布式系统

- Kwon et al., [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180), 2023.
- Gim et al., [Prompt Cache: Modular Attention Reuse for Low-Latency Inference](https://arxiv.org/abs/2311.04934), 2023.
- Zheng et al., [SGLang: Efficient Execution of Structured Language Model Programs](https://arxiv.org/abs/2312.07104), NeurIPS 2024.
- Liu et al., [CacheGen: KV Cache Compression and Streaming for Fast Large Language Model Serving](https://arxiv.org/abs/2310.07240), 2023.
- Qin et al., [Mooncake: A KVCache-centric Disaggregated Architecture for LLM Serving](https://arxiv.org/abs/2407.00079), 2024.
- Yao et al., [CacheBlend: Fast Large Language Model Serving for RAG with Cached Knowledge Fusion](https://arxiv.org/abs/2405.16444), 2024.

### 压缩与驱逐

- Liu et al., [KIVI: A Tuning-Free Asymmetric 2bit Quantization for KV Cache](https://arxiv.org/abs/2402.02750), 2024.
- Zhang et al., [H2O: Heavy-Hitter Oracle for Efficient Generative Inference of Large Language Models](https://arxiv.org/abs/2306.14048), 2023.
- Xiao et al., [Efficient Streaming Language Models with Attention Sinks](https://arxiv.org/abs/2309.17453), ICLR 2024.

### 官方工程文档

- [vLLM Automatic Prefix Caching](https://docs.vllm.ai/en/latest/design/prefix_caching/)
- [SGLang HiCache Design](https://docs.sglang.io/advanced_features/hicache_design.html)
- [TensorRT-LLM KV Cache System](https://nvidia.github.io/TensorRT-LLM/latest/features/kvcache.html)
- [TensorRT-LLM KV Cache Reuse](https://nvidia.github.io/TensorRT-LLM/advanced/kv-cache-reuse.html)
- [LMCache Documentation](https://docs.lmcache.ai/)
- [OpenAI Prompt Caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Anthropic Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Gemini Context Caching](https://ai.google.dev/gemini-api/docs/caching)
