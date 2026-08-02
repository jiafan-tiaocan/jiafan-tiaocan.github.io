---
title: "论文解读：High-Resolution Image Synthesis with Latent Diffusion Models"
description: "从像素空间扩散的算力瓶颈出发，拆解 LDM 如何用轻度感知压缩、潜空间去噪与 Cross-Attention 奠定 Stable Diffusion 的系统骨架，并区分论文模型与真正的 SD v1。"
tags:
  - 论文解读
  - Diffusion
  - Latent-Diffusion
  - Stable-Diffusion
  - 图像生成
  - 生成模型
date: 2021-12-20
noteType: paper
publish: true
paper_version: "CVPR 2022 / arXiv:2112.10752v2"
last_verified: 2026-08-02
code_revision: "CompVis/latent-diffusion@a506df5756472e2ebaf9078affdde2c4f1502cd4; CompVis/stable-diffusion@21f890f9da3cfbeaba8e2ac3c425ee9e998d5229"
---

# 论文解读：High-Resolution Image Synthesis with Latent Diffusion Models

> **核心判断：这篇论文没有改变 Diffusion 的概率路径，而是把“反复在高分辨率 RGB 上计算”的责任拆开了——预训练自编码器先做一次轻度的感知压缩，Diffusion 只在保留二维结构的 latent 上学习语义分布；最关键的证据不是漂亮样片，而是 Figure 5 的压缩率实验：压得太少，训练仍然慢；压得太狠，生成质量的上限又被第一阶段锁死。**

论文：Robin Rombach、Andreas Blattmann、Dominik Lorenz、Patrick Esser、Björn Ommer，**High-Resolution Image Synthesis with Latent Diffusion Models**，CVPR 2022 Oral。  
主来源：[CVF 论文页](https://openaccess.thecvf.com/content/CVPR2022/html/Rombach_High-Resolution_Image_Synthesis_With_Latent_Diffusion_Models_CVPR_2022_paper.html)｜[论文 PDF](https://openaccess.thecvf.com/content/CVPR2022/papers/Rombach_High-Resolution_Image_Synthesis_With_Latent_Diffusion_Models_CVPR_2022_paper.pdf)｜[补充材料](https://openaccess.thecvf.com/content/CVPR2022/supplemental/Rombach_High-Resolution_Image_Synthesis_CVPR_2022_supplemental.pdf)｜[arXiv v2](https://arxiv.org/abs/2112.10752v2)｜[官方代码](https://github.com/CompVis/latent-diffusion/tree/a506df5756472e2ebaf9078affdde2c4f1502cd4)

> [!note] 版本、命名与证据边界
> - 论文最早于 **2021-12-20** 提交，本文以 **2022-04-13 的 arXiv v2 / CVPR 2022 版本**为论文事实来源。v2 更新了 1.45B 文生图模型、ImageNet 结果、Classifier-Free Guidance 与用户研究。
> - 日常所说的“Stable Diffusion 原始论文”通常就是这篇 LDM 论文，但二者不能画等号：论文提出并验证系统骨架；**Stable Diffusion v1 是论文之后的一套具体 checkpoint、文本编码器、训练数据与训练配方**。
> - “论文事实”指正文、补充材料直接陈述或测量的内容；“源码事实”分别锚定官方 LDM 提交 `a506df5` 与 Stable Diffusion v1 提交 `21f890f`；“本文推导”会显式标注。
> - arXiv v2 标注的是 [non-exclusive distribution license](https://arxiv.org/licenses/nonexclusive-distrib/1.0/)，不是明确授权第三方再发布的 CC 许可。因此公开版不转载 CVF PDF 裁切：需要核对原始曲线或样例时直接链接论文；正文内的栅格图来自作者官方 MIT 仓库，另有一张明确标注的教学示意图。

这是一篇长文。只想建立直觉，读第 1、3、8、12 节；想弄清训练与推理，读第 4–7 节；想判断证据强弱，重点读第 8、9 节；想把论文与 Stable Diffusion v1 的真实配置对齐，直接读第 10 节。扩散的 ELBO、噪声预测与 Score 推导可先看 [[努力做一个可以让人记住的Diffusion推导]]；U 形多尺度骨架和 Cross-Attention 的基础分别见 [[论文解读：U-Net: Convolutional Networks for Biomedical Image Segmentation]] 与 [[论文解读：Attention Is All You Need]]。

## 一、先纠正一个名字带来的误会：论文模型不等于 SD v1

这篇论文回答的是一个**模型类别**问题：怎样让 Diffusion 不再把绝大多数算力消耗在高分辨率像素上，同时保留图像结构和多种条件接口？它给出的答案叫 **Latent Diffusion Model，LDM**。

Stable Diffusion v1 则是后来沿用这套答案做出的一个具体系统。二者共享：

- 图像先经轻度压缩的自编码器进入二维 latent；
- 在 latent 上执行扩散训练和迭代采样；
- 去噪器采用带多尺度 Skip 的 U-Net；
- 文本 token 通过 Cross-Attention 持续影响每一步去噪；
- 最后只需一次 Decoder 前向，把 latent 还原为 RGB。

但论文中的 1.45B 文生图 LDM 使用 BERT tokenizer 和一个联合训练的 1280 维 Transformer 条件器；Stable Diffusion v1 改成了**冻结的 CLIP ViT-L/14 文本编码器**、768 维上下文和 860M U-Net。论文证明了“这条系统路线可行”，没有替后来的每个 Stable Diffusion 配置逐项背书。

## 二、任务契约：这篇论文到底在优化什么

| 项目 | 内容 |
|---|---|
| 输入 | 训练图像 $x$，以及可选条件 $y$：类别、文本、布局、语义图、低清图或掩码图 |
| 输出 | 无条件或受条件控制的高分辨率图像 $\tilde x$ |
| 监督 | 图像本身；条件任务还需要图像—条件配对 |
| 第一阶段 | 学习 $z=\mathcal E(x)$ 与 $\tilde x=\mathcal D(z)$，丢掉感知上不重要的细节 |
| 第二阶段 | 在固定的 latent 空间学习 $p(z)$ 或 $p(z\mid y)$ |
| 部署假设 | 多次去噪都发生在低维 latent；最后只做一次高分辨率解码 |
| 不解决 | Diffusion 的串行采样本身、严格像素级保真、数据版权与偏见、生产级安全治理 |

一句话读法是：**它优化的不是“怎样少走几个采样步”，而是“让每一步都在更便宜、却仍保留二维结构的空间里走”。**

## 三、旧瓶颈：像素空间让模型为人眼看不见的细节反复付费

像素 Diffusion 的训练和推理都要反复调用 U-Net。若状态一直是 $H\times W\times3$ 的 RGB 张量，每一次前向、反向、注意力和中间激活都承担完整空间尺寸。

论文用“感知压缩”和“语义压缩”拆开这个问题：

1. **感知压缩**：去掉人眼几乎不在意的高频细节，但保留物体、布局和纹理的可重建表示；
2. **语义压缩**：学习自然图像的概念组合与概率分布，这是生成模型真正应该投入容量的地方。

像素 Diffusion 可以通过重加权损失少关心某些细节，但网络和梯度仍必须在每个像素上计算。LDM 的关键责任转移是：**让一个可复用的自编码器先完成感知压缩，Diffusion 专注第二阶段。**

## 四、第一阶段：自编码器不是附属压缩包，而是生成质量上限

给定图像 $x\in\mathbb R^{H\times W\times3}$，编码器和解码器执行：

$$
z=\mathcal E(x),
\qquad
\tilde x=\mathcal D(z),
\qquad
z\in\mathbb R^{h\times w\times c}.
$$

空间下采样因子定义为：

$$
f=\frac{H}{h}=\frac{W}{w}.
$$

这里最容易误解的是“VAE”三个字。论文的第一阶段不是只用像素 MSE 和标准 ELBO 的朴素 VAE，而是沿用 VQGAN 路线，把**感知损失、Patch 判别器和很轻的 latent 正则**组合起来：

- 感知损失让重建结果保留人眼在意的结构与纹理；
- Patch 对抗目标约束局部结果落在真实图像流形附近，减轻纯 $L_1/L_2$ 的模糊；
- KL-reg 只施加约 $10^{-6}$ 权重的轻微 KL 约束，VQ-reg 则使用高容量码本；
- 训练第二阶段时，第一阶段被固定，不再同时拉扯“重建好”和“先验好”两个目标。

先看论文 [Figure 1](https://openaccess.thecvf.com/content/CVPR2022/papers/Rombach_High-Resolution_Image_Synthesis_With_Latent_Diffusion_Models_CVPR_2022_paper.pdf#page=2) 的局部细节：同样观察盘子边缘、人物眼睛和发丝，轻度下采样的 $f=4$ 重建更接近输入；更激进的压缩会把后续生成模型永远无法恢复的信息提前丢掉。下面是作者官方仓库给出的另一组第一阶段重建对照，放大框让这种不可逆损失更容易看见。

![作者官方 LDM 仓库的重建对照：同一摞盘子经过不同第一阶段模型后，放大区域显示边缘清晰度、纹理与色彩细节的差异。](assets/latent-diffusion-paper/official-ldm-reconstruction.png)

*作者官方仓库的第一阶段重建样例；它承担的是“压缩器会留下不可逆痕迹”的直观证据，不替代论文 Figure 1 的受控数值比较。来源：[CompVis/latent-diffusion 固定提交中的 `reconstruction1.png`](https://github.com/CompVis/latent-diffusion/blob/a506df5756472e2ebaf9078affdde2c4f1502cd4/assets/reconstruction1.png)，仓库采用 [MIT License](https://github.com/CompVis/latent-diffusion/blob/a506df5756472e2ebaf9078affdde2c4f1502cd4/LICENSE)。*

图中 LDM 的 $f=4$ 第一阶段报告 PSNR 27.4、R-FID 0.58；DALL-E 的 $f=8$ 与 VQGAN 的 $f=16$ 重建上限更低。它直接支持的是“**压缩器会设定可生成细节的天花板**”，但不能单凭这张图证明 latent 上的 Diffusion 一定训练更快或生成更好；后者要看压缩率控制实验。

> [!important] $f$ 只描述空间边长，不等于总张量缩小倍数
> 以 Stable Diffusion v1 的具体配置为例，$512\times512\times3$ 会变成 $64\times64\times4$。空间位置减少 $8^2=64$ 倍，标量元素从 786,432 减到 16,384，即 48 倍。这个比值有助于建立直觉，但不能直接当成 U-Net FLOPs 或显存的精确缩减倍数，因为通道数、特征层级、Attention 和实现开销也会变化。

## 五、第二阶段：Diffusion 公式几乎没变，只把 $x$ 换成了 $z$

先对干净 latent 加噪：

$$
z_0=\mathcal E(x),
\qquad
z_t=\alpha_t z_0+\sigma_t\epsilon,
\qquad
\epsilon\sim\mathcal N(0,I).
$$

再训练带时间条件的 U-Net 预测噪声：

$$
\mathcal L_{\mathrm{LDM}}
=
\mathbb E_{x,\epsilon,t}
\left[
\left\|
\epsilon-\epsilon_\theta(z_t,t)
\right\|_2^2
\right].
$$

如果与 [[努力做一个可以让人记住的Diffusion推导]] 对照，本文的符号只是：

$$
\alpha_t\leftrightarrow\sqrt{\bar\alpha_t},
\qquad
\sigma_t\leftrightarrow\sqrt{1-\bar\alpha_t},
\qquad
x_t\rightarrow z_t.
$$

因此 LDM 没有发明新的前向马尔可夫链、ELBO 或 Score Matching；它改变的是**状态空间和系统分工**。这一点非常重要：换 DDPM、DDIM 或后来的采样器，解决的是“怎样沿概率路径走”；换到 latent，解决的是“每一步在哪里算”。

## 六、训练与推理：Encoder、U-Net、Decoder 并不同时做同一件事

### 6.1 训练第二阶段

一批图像只需：

```python
with torch.no_grad():
    z_0 = scale * autoencoder.encode(images).sample()

t = random_timesteps(batch_size)
noise = torch.randn_like(z_0)
z_t = alpha[t] * z_0 + sigma[t] * noise
noise_pred = unet(z_t, t, context=condition_tokens)
loss = mse(noise_pred, noise)
```

训练时每个样本随机抽一个 $t$，不需要把同一张图完整去噪 $T$ 次。官方 LDM 源码把 `first_stage_model` 切到 `eval()`、覆盖其 `train` 行为并令全部参数 `requires_grad=False`；随后从高斯后验采样 latent，再乘 `scale_factor`。这正是“先固定感知空间，再学习生成先验”的工程落点。[源码：固定第一阶段并缩放 latent](https://github.com/CompVis/latent-diffusion/blob/a506df5756472e2ebaf9078affdde2c4f1502cd4/ldm/models/diffusion/ddpm.py#L498-L549)

### 6.2 文生图推理

推理时没有输入图像，因此 Encoder 根本不在主循环里：

$$
z_T\sim\mathcal N(0,I)
\longrightarrow
z_{T-1}\longrightarrow\cdots\longrightarrow z_0
\xrightarrow{\mathcal D}
\tilde x.
$$

真正昂贵的是 U-Net 被采样器反复调用；Decoder 只在最后运行一次。LDM 降低了每次 U-Net 调用的空间成本，但没有消除串行调用，因此论文也明确承认它仍比 GAN 的一次前向慢。

## 七、Cross-Attention：让不同条件共享一个去噪骨架

论文的第二个重要贡献不是“支持文本”这么窄，而是给 U-Net 设计了一个通用条件接口。先看作者同时放在官方仓库 README 中的方法图：左侧自编码器负责像素与 latent 的边界，中间 U-Net 负责每一步去噪，右侧领域编码器 $\tau_\theta$ 把文本、语义图、图像或其他条件变成表示；条件既可以拼接，也可以通过 Cross-Attention 注入。

![LDM 官方方法图：像素经编码器进入 latent；U-Net 在 latent 中反复去噪；文本、语义图或图像条件经领域编码器后，通过 Cross-Attention 或拼接进入网络。](assets/latent-diffusion-paper/official-ldm-model-figure.png)

*作者官方方法图，也是论文 Figure 3 的核心结构。来源：[CompVis/latent-diffusion 固定提交中的 `modelfigure.png`](https://github.com/CompVis/latent-diffusion/blob/a506df5756472e2ebaf9078affdde2c4f1502cd4/assets/modelfigure.png)，仓库采用 [MIT License](https://github.com/CompVis/latent-diffusion/blob/a506df5756472e2ebaf9078affdde2c4f1502cd4/LICENSE)。*

设 U-Net 第 $i$ 层空间特征展平后为 $\varphi_i(z_t)\in\mathbb R^{N\times d_i}$，条件编码为 $\tau_\theta(y)\in\mathbb R^{M\times d_\tau}$：

$$
Q=\varphi_i(z_t)W_Q^{(i)},
\qquad
K=\tau_\theta(y)W_K^{(i)},
\qquad
V=\tau_\theta(y)W_V^{(i)},
$$

$$
\operatorname{Attention}(Q,K,V)
=
\operatorname{softmax}\left(\frac{QK^\top}{\sqrt d}\right)V.
$$

可以把每个空间 Query 理解成一个问题：“我这个位置现在应该画什么？”文本或布局 token 作为 Key/Value 回答：“哪些条件和你有关，以及应该注入什么信息？”

源码中的 `SpatialTransformer` 先把 `[B,C,H,W]` 变成 `[B,H·W,C]`，依次执行 Self-Attention、Cross-Attention 和前馈层，再还原成二维特征并做残差连接。[源码：CrossAttention 与 SpatialTransformer](https://github.com/CompVis/latent-diffusion/blob/a506df5756472e2ebaf9078affdde2c4f1502cd4/ldm/modules/attention.py#L152-L268)

并非所有条件都适合 token 化：

- 文本、类别、边界框序列适合 Cross-Attention；
- 低清图、掩码图、语义分割图等空间对齐信号可下采样后与 noisy latent 按通道拼接；
- 同一个 U-Net 骨架因此能覆盖文生图、布局生图、超分、Inpainting 和语义图生成，而不是每个任务重造一套生成器。

条件训练目标只是再加上 $y$：

$$
\mathcal L_{\mathrm{cond}}
=
\mathbb E_{x,y,\epsilon,t}
\left[
\left\|
\epsilon-\epsilon_\theta(z_t,t,\tau_\theta(y))
\right\|_2^2
\right].
$$

论文里的 $\tau_\theta$ 与 U-Net 联合优化；Stable Diffusion v1 冻结 CLIP 文本编码器，这是后续工程选择，不能反写成论文原设定。

## 八、最关键的证据：$f$ 不是越大越好，而是存在甜点区

论文 [Figure 5](https://openaccess.thecvf.com/content/CVPR2022/papers/Rombach_High-Resolution_Image_Synthesis_With_Latent_Diffusion_Models_CVPR_2022_paper.pdf#page=5) 比样片重要得多。作者在 ImageNet 类别条件生成上比较 $f\in\{1,2,4,8,16,32\}$；其中 LDM-1 就是像素空间基线。实验在单张 A100 上训练 2M step，模型参数量保持在约 391M–396M 的相近范围。

![教学示意：随着空间下采样因子 f 增大，扩散计算负担下降，但第一阶段可保留的信息上限也下降；f=4 到 8 位于论文实验显示的稳健甜点区。](assets/latent-diffusion-paper/ldm-compression-sweet-spot.svg)

*本文教学示意，不是 Figure 5 曲线的复刻，也不能据此读取 FID 或 Inception Score；精确曲线与坐标请看上方论文链接。它只把原实验支持的两端瓶颈与中间甜点区压缩成一张阅读地图。*

读图时要看两端：

- **$f=1,2$ 压得太少**：Diffusion 仍承担大量感知压缩，训练进展慢；
- **$f=32$ 压得太狠**：第一阶段已丢失过多信息，生成质量很早停滞；
- **$f=4,8$ 最稳健**：既明显减少计算，又保住足够高的重建上限；论文也把 $f=4$–$16$ 视为有效区间，但最终总结更偏向 $f=4,8$。

论文报告 2M step 后，LDM-1 与 LDM-8 的 FID 相差约 **38**。这支持的不是“latent 天生比像素更会生成”，而是：**在有限计算预算下，把无关细节交给第一阶段，会让第二阶段更快把容量用于语义分布。**

这也不是完美的单变量消融。补充材料显示各模型会选择能稳定训练的不同学习率，Batch Size 也随 latent 尺寸从 7 增加到 112；U-Net 的通道倍率随输入尺寸调整。它更接近“同一块 GPU 上各压缩方案的最佳可行系统比较”，而不是只改变 $f$、其余逐项完全相同的实验。

## 九、证据阶梯：有效、为什么有效、哪里仍不够

### 9.1 能力证据：同一条件接口覆盖多种任务

论文 [Figure 7](https://openaccess.thecvf.com/content/CVPR2022/papers/Rombach_High-Resolution_Image_Synthesis_With_Latent_Diffusion_Models_CVPR_2022_paper.pdf#page=7) 上半展示边界框布局到图像，下半展示文本到图像。它证明 Cross-Attention 条件接口具有任务复用性，但不单独证明 Cross-Attention 比拼接或其他条件机制更好。为避免转载非 CC 的 PDF 页面，下面改用作者官方仓库公开的文生图样例。

![作者官方 LDM 文生图样例：七组提示词各有两幅结果，覆盖路牌、毕加索风格、混合动物、神经网络插画、松鼠、章鱼椅和印字 T 恤。](assets/latent-diffusion-paper/official-ldm-text2img-preview.png)

*作者官方仓库的文生图样例。来源：[CompVis/latent-diffusion 固定提交中的 `txt2img-preview.png`](https://github.com/CompVis/latent-diffusion/blob/a506df5756472e2ebaf9078affdde2c4f1502cd4/assets/txt2img-preview.png)，仓库采用 [MIT License](https://github.com/CompVis/latent-diffusion/blob/a506df5756472e2ebaf9078affdde2c4f1502cd4/LICENSE)。*

这张图也意外提供了边界证据：模型能生成“像路牌的东西”，却把 `LATENT DIFFUSION` 拼成不同的错误字形。它学会了视觉语义和局部纹理，不等于拥有离散字符级渲染能力。

在 MS-COCO 文生图表格中，未引导的 LDM-KL-8 报告 FID 23.35；加入 scale 1.5 的 Classifier-Free Guidance 后为 12.61。这个巨大差异说明论文 v2 的强结果同时来自 latent 系统与采样期引导，不能把最终分数全部归功于潜空间。

### 9.2 效率证据：训练和推理同时受益，但数字带估算口径

补充材料将 A100 天按“1 张 A100 约等于 2.2 张 V100 的 U-Net 吞吐”换算成 V100-days。以 ImageNet 为例：

| 方法 | 训练计算 | 采样条件 | A100 单卡吞吐 | FID |
|---|---:|---|---:|---:|
| ADM-G | 962 V100-days | 250 步、分类器引导 | 0.07 sample/s | 4.59 |
| LDM-4-G | 271 V100-days | 250 DDIM 步、CFG 1.5 | 0.40 sample/s | 3.60 |

在论文口径下，LDM-4-G 以约 28% 的训练计算和约 5.7 倍吞吐达到更低 FID。这是强系统证据，但仍要注意：训练计算包含硬件换算假设；引导方式、参数量与训练配方不同；FID 也不能独立衡量覆盖、文字准确性或人类偏好。

### 9.3 任务证据：Inpainting 给出了更接近闭环的比较

在固定相近参数量的 Inpainting 实验中，latent 模型相对像素模型至少获得 **2.7 倍**训练/采样加速，同时六个 epoch 后的 FID 至少改善 **1.6 倍**。用户研究中，受试者在 LDM 与 LaMa 的生成结果之间有 68.1% 的选择偏好落到 LDM 一侧。

这组结果比“能生成漂亮图片”更有说服力，因为它同时覆盖吞吐、自动指标与人类偏好；但 LDM 生成多样结果、LaMa 输出单一结果，LPIPS 的解释仍受任务设定影响。

## 十、从论文 LDM 到 Stable Diffusion v1：真正改了什么

下面只比较作者官方材料直接披露的配置，不把后来的 Diffusers、SDXL 或社区实现倒推回 2022 年论文。

| 维度 | 论文 1.45B 文生图 LDM | Stable Diffusion v1 |
|---|---|---|
| 定位 | 验证通用 LDM 与条件接口 | 面向 512×512 文生图的具体公开模型 |
| 第一阶段 | KL-reg，$f=8$，256 输入对应 $32\times32\times4$ | KL Autoencoder，$f=8$，512 输入对应 $64\times64\times4$ |
| 去噪器 | 表格报告 1.45B，U-Net 主通道 320 | 860M U-Net，主通道 320 |
| 文本侧 | BERT tokenizer + 32 层、1280 维可训练 Transformer | 冻结 CLIP ViT-L/14，123M，context dim 768 |
| token 长度 | 77 | 77 |
| latent 缩放 | 源码配置为 0.18215 | 源码配置为 0.18215 |
| 数据 | LAION-400M；部分展示还涉及 Conceptual Captions 微调 | LAION-2B(en)、高分辨率与 aesthetics 子集 |
| CFG | v2 结果加入 CFG | v1-3/v1-4 以 10% 条件丢弃专门支持 CFG |
| 条件编码器训练 | 与 U-Net 联合训练 | 冻结，不随 U-Net 更新 |

论文配置可在 [`txt2img-1p4B-eval.yaml`](https://github.com/CompVis/latent-diffusion/blob/a506df5756472e2ebaf9078affdde2c4f1502cd4/configs/latent-diffusion/txt2img-1p4B-eval.yaml) 中核对；Stable Diffusion v1 可在 [`v1-inference.yaml`](https://github.com/CompVis/stable-diffusion/blob/21f890f9da3cfbeaba8e2ac3c425ee9e998d5229/configs/stable-diffusion/v1-inference.yaml) 与[官方模型卡](https://github.com/CompVis/stable-diffusion/blob/21f890f9da3cfbeaba8e2ac3c425ee9e998d5229/Stable_Diffusion_v1_Model_Card.md)中核对。

Stable Diffusion v1 的训练资源也只能按模型卡描述：硬件为 **32×8 张 A100**，梯度累积 2，全局 Batch 2048，AdamW，学习率在 10k warmup 后保持 $10^{-4}$。排放估算部分写了 150,000 A100-hours 与 A100 PCIe 40GB；它没有给出端到端墙钟时间、利用率、失败实验和数据处理成本，不能把这个数直接当成完整复现预算。

因此最准确的关系是：

> **LDM 论文发明并验证了 Stable Diffusion 的系统骨架；Stable Diffusion v1 把条件器、数据课程、分辨率、CFG 训练和权重发布做成了后来真正流行的产品化研究制品。**

## 十一、工程上最值得带走的六个细节

1. **先确认状态空间。** 同样叫 Diffusion，像素、VAE latent、离散 token 或视频 latent 的算力与误差边界完全不同。
2. **把 `scale_factor` 当模型契约。** 编码后乘缩放，解码前必须除回去；错配会改变 latent 的 SNR，表现为颜色、对比度和采样稳定性异常。
3. **第一阶段冻结不是实现偶然。** 它让重建上限和生成先验解耦，也让多个任务复用同一表示；要联合微调时必须重新处理两类目标的权衡。
4. **Cross-Attention 的方向不能写反。** 图像空间特征给 Query，条件 token 给 Key/Value；对控制分支做改造时，应先明确条件是 token 语义还是空间对齐信号。
5. **训练一次预测，推理重复预测。** 训练随机抽一个 $t$；推理才循环多步。采样器、步数与去噪网络是不同设计轴。
6. **“latent 更省”不等于任意扩大分辨率。** Attention 仍随空间 token 数增长，卷积式外推还会遇到训练分辨率统计、SNR 和全局构图问题。

原始 Stable Diffusion v1 README 声称参考实现可在至少 10GB VRAM 的 GPU 上运行，但这只是 2022 年具体代码与默认参数的最低入口，不是本文实测，也不是现代部署的通用推荐值。论文没有给出低显存优化、并发吞吐或 P95 延迟。生产系统还需要模型常驻、批处理、OOM 降级、输入输出审核、内容来源记录、水印、数据与权重许可证治理；官方参考脚本也专门加入了 Safety Checker 和不可见水印，说明“能采样”从来不等于“可直接上线”。

## 十二、边界条件：这条路线在哪里停止奏效

### 12.1 论文明确承认

- **采样仍然串行。** latent 降低每一步成本，但没有变成 GAN 那样的一次前向。
- **自编码器是有损瓶颈。** 需要严格像素精度的任务会受到限制，论文认为超分已经部分触及这一边界。
- **数据偏见与滥用没有被效率改进解决。** 更低的训练和生成成本也降低了伪造、垃圾内容与有害使用的门槛。
- **训练数据可能被记忆。** 论文把隐私泄露视为尚未充分理解的问题；后来的 SD v1 模型卡进一步说明数据未额外去重，重复样本存在一定记忆现象。

### 12.2 从机制推导、论文没有完全回答

- **重建好不等于 latent 适合生成。** R-FID、PSNR 和最终生成 FID 衡量不同对象；怎样评价“既可重建又易建模”的表示仍不是一个单指标问题。
- **大分辨率卷积式采样不保证全局一致。** 局部卷积可处理更大画布，但训练时未见过的 token 数、长程关系和位置统计可能让构图失控。
- **Cross-Attention 提供接口，不保证组合推理。** Figure 7 的错字已经说明“看起来像某概念”与“满足离散约束”之间有明显距离。
- **Figure 5 隔离的是系统选择，不是纯理论变量。** Batch、学习率和 U-Net 细节随 $f$ 调整，因此它证明的是工程甜点区，而非一个与所有配置无关的普适最优 $f$。

## 十三、它在知识库里的位置

这篇论文把几条已有知识线索接了起来：

- [[努力做一个可以让人记住的Diffusion推导]] 负责解释为什么噪声预测能学习反向过程；本文只把其中的 $x_t$ 换成 $z_t$，并解释为什么值得换。
- [[论文解读：Attention Is All You Need]] 给出 Q/K/V 的通用机制；本文展示它怎样变成图像空间 Query 读取文本或布局 token 的接口。
- [[论文解读：U-Net: Convolutional Networks for Biomedical Image Segmentation]] 解释多尺度 U 形骨架；LDM 保留这个空间归纳偏置，但内部块已加入 timestep 调制、残差与 Transformer。
- [[论文解读：Scalable Diffusion Models with Transformers]] 继续沿用 VAE latent 和扩散外循环，只把去噪主干从 U-Net 换成 Transformer。
- [[论文解读：Stable Video Diffusion: Scaling Latent Video Diffusion Models to Large Datasets]] 又在这条 latent 管线里加入时间模块与视频数据课程。

## 十四、一周后应该记住什么

1. **LDM 的创新不是新扩散公式，而是把感知压缩与语义生成拆成两个阶段。**
2. **压缩率存在甜点区：太轻省不了算力，太重先毁掉生成上限；Figure 5 比样片更能说明这篇论文。**
3. **Cross-Attention 把条件变成通用接口；Stable Diffusion v1 在此骨架上更换了文本编码器、数据与训练配方，它不是论文模型的同义词。**

## 参考资料与固定证据

### 论文与补充材料

- Rombach et al. [High-Resolution Image Synthesis with Latent Diffusion Models](https://arxiv.org/abs/2112.10752v2), CVPR 2022。
- [CVF 论文页面与正式 PDF](https://openaccess.thecvf.com/content/CVPR2022/html/Rombach_High-Resolution_Image_Synthesis_With_Latent_Diffusion_Models_CVPR_2022_paper.html)。
- [CVPR 2022 补充材料](https://openaccess.thecvf.com/content/CVPR2022/supplemental/Rombach_High-Resolution_Image_Synthesis_CVPR_2022_supplemental.pdf)：扩散推导、超参数、计算资源、用户研究与自编码器目标。

### 官方源码与模型资料

- CompVis. [latent-diffusion，固定提交 `a506df5`](https://github.com/CompVis/latent-diffusion/tree/a506df5756472e2ebaf9078affdde2c4f1502cd4)：MIT 许可，包含论文模型、配置与采样脚本。
- CompVis. [stable-diffusion，固定提交 `21f890f`](https://github.com/CompVis/stable-diffusion/tree/21f890f9da3cfbeaba8e2ac3c425ee9e998d5229)：Stable Diffusion v1 配置、模型卡、参考推理与安全组件。
- CompVis. [Stable Diffusion v1 Model Card](https://github.com/CompVis/stable-diffusion/blob/21f890f9da3cfbeaba8e2ac3c425ee9e998d5229/Stable_Diffusion_v1_Model_Card.md)：数据阶段、硬件、Batch、训练步数、限制、偏见与排放估算。

### 文中官方仓库图片的许可声明

文中 `official-ldm-model-figure.png`、`official-ldm-reconstruction.png` 与 `official-ldm-text2img-preview.png` 是作者官方仓库相应资产的未修改副本。版权与许可声明如下；`ldm-compression-sweet-spot.svg` 为本文自绘，不属于该声明的覆盖范围。

<details>
<summary>MIT License（CompVis/latent-diffusion）</summary>

Copyright (c) 2022 Machine Vision and Learning Group, LMU Munich

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

</details>
