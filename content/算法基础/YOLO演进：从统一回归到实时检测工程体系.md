---
title: "YOLO 演进：从统一回归到实时检测工程体系"
description: "沿着统一回归、Anchor、多尺度、训练技巧、Anchor-Free、动态标签分配与部署优化七次责任迁移，系统解释截至 2023 年 5 月的 YOLO 论文与代码谱系。"
tags:
  - 论文解读
  - YOLO
  - 目标检测
  - 计算机视觉
  - 实时检测
  - Anchor-Free
  - Object-Detection
date: 2023-05-01
noteType: paper
publish: true
evidence_cutoff: 2023-05-31
last_verified: 2026-08-03
code_revision:
  - "ultralytics/ultralytics@fd94d312da626f9557e43adb7b339afa459e497f (8.0.111)"
  - "ultralytics/yolov5@915bbf294bb74c859f0b41f1c23bc395014ea679 (v7.0)"
---

# YOLO 演进：从统一回归到实时检测工程体系

![YOLO 从 2015 年统一回归、2016 年 Anchor、2018 年多尺度预测、2020 年训练系统化、2021 年 Anchor-Free，演进到 2022—2023 年工业部署体系；下方拆出 Backbone、Neck、Head、Assigner 与 Runtime 等稳定责任层](assets/yolo-evolution/01-yolo-causal-route.svg)

*图 1　YOLO 的因果演进。时间线不是按数字大小排队，而是标出每一代解决的瓶颈及随之暴露的新问题；底部是截至 2023 年 5 月已逐渐稳定的检测系统责任分层。本文依据 YOLOv1/v2/v3/v4、YOLOX、YOLOv6、YOLOv7 论文以及 YOLOv5/v8 固定版本源码归纳。*

> **核心判断：YOLO 最持久的贡献不是某一版 Backbone，而是把目标检测持续压缩成一条可联合优化、可按硬件缩放的密集预测路径。** v1 取消候选区域与分类器串联；v2 用 Anchor 把任意框回归改造成先验附近的偏移；v3 让多个特征尺度共同负责大小目标；v4 把数据增强、损失和网络组件变成可组合的训练系统；YOLOX 又删除 Anchor、拆开分类与定位，并把“哪个位置负责哪个目标”提升为动态优化问题。到 v6、v7、v8，竞争主场已经从单个结构创新迁移到重参数化、标签分配、量化、导出、许可证与整条工具链。

## 一、为什么实时检测不是“把分类器多跑几次”

假设一条视频流每秒送来 30 帧。系统不只要回答“画面里有狗”，还要在每帧给出狗的位置、类别和置信度；如果同一只狗产生十个重叠框，还要在帧预算内消重。早期做法往往先产生候选区域，再逐块提特征、分类、修框。每个模块都合理，但串起来就有三个问题：重复计算、分阶段训练，以及候选数量随场景变复杂而膨胀。

给定图像 $I\in\mathbb{R}^{H\times W\times3}$，检测器最终输出一个集合：

$$
\mathcal{D}(I)=\{(b_i,c_i,s_i)\}_{i=1}^{N},
$$

其中 $b_i=(x_1,y_1,x_2,y_2)$ 是框，$c_i$ 是类别，$s_i$ 是用于排序和阈值过滤的分数。围绕这份输出契约，实时检测器必须同时回答五个问题：

1. 在哪里产生候选框，候选数量怎样受控？
2. 大目标和小目标由哪一层特征负责？
3. 一个真值框应该监督哪些预测位置？
4. 分类正确与定位准确怎样进入同一个训练目标？
5. 模型离线指标很好时，能否在目标 GPU、CPU 或 NPU 上按时交付结果？

YOLO 的每次重要转向，都在重写其中一项责任。

## 二、先拆掉一个误解：v1 到 v8 不是同一团队的线性版本

YOLOv1、YOLO9000/YOLOv2、YOLOv3 是 Joseph Redmon 等人的直接论文序列。YOLOv4 由 Alexey Bochkovskiy、Chien-Yao Wang、Hong-Yuan Mark Liao 提出；YOLOv5 与 YOLOv8 来自 Ultralytics 的代码和产品体系；YOLOX 来自旷视；YOLOv6 来自美团；YOLOv7 又回到 Wang、Bochkovskiy、Liao 团队。

因此，**“v8 一定继承 v7，v7 一定继承 v6”在学术谱系上并不成立。** 数字标签更像多个团队争夺同一工程范式的品牌语言。比较时必须固定论文版本或代码提交，并同时对齐数据集、输入尺寸、精度、batch、硬件、推理引擎和是否包含后处理。

截至 2023 年 5 月，可把主线压成下表：

| 节点 | 一手证据 | 主要变化 | 它真正解决了什么 | 新的代价 |
|---|---|---|---|---|
| YOLOv1，2015/2016 | CVPR 论文 | 整图到框和类别的统一回归 | 取消候选区域流水线，获得实时性 | 粗网格、定位误差、成群小目标 |
| YOLOv2 / YOLO9000，2016/2017 | CVPR 论文 | Anchor、聚类先验、全卷积、多尺度训练、WordTree | 提高召回，允许同一权重在多分辨率运行 | Anchor 需要数据集相关调参 |
| YOLOv3，2018 | 技术报告 | Darknet-53、三尺度预测、独立 Logistic 类别 | 更好覆盖小中大目标与多标签类别 | Head 和训练配方继续复杂化 |
| YOLOv4，2020 | arXiv 论文 | CSPDarknet53 + SPP + PAN；BoF/BoS；Mosaic、CIoU 等 | 把大量技巧放进可复验组合，强调单 GPU 训练 | 组件多、结果依赖完整配方 |
| YOLOv5，2020– | 官方仓库 / Release | PyTorch 工具链、训练验证导出、检测/分割等任务 | 降低落地门槛，工程迭代速度快 | 没有同名同行评议论文；版本持续漂移 |
| YOLOX，2021 | arXiv 论文 | Anchor-Free、解耦头、SimOTA | 减少先验和输出负担，让正样本动态匹配 | 训练分配器成为新的复杂核心 |
| YOLOv6，2022 | 技术报告与官方仓库 | 重参数化、TAL、自蒸馏、量化 | 面向 T4/CPU 等目标硬件设计整套模型族 | 训练、量化与部署路径更强绑定 |
| YOLOv7，2022/2023 | arXiv / CVPR 论文 | E-ELAN、计划式重参数化、辅助头标签分配 | 不增加推理成本地增强训练 | 论文结构和训练细节理解成本高 |
| YOLOv8，2023-01 至 05 | 固定源码 `8.0.111` | Anchor-Free 解耦头、DFL、TAL、统一 CLI/API | 把检测、分割、姿态、导出收进一套体验 | 学术主张只能从固定源码审计，不能假装有论文 |

## 三、第一次责任迁移：YOLOv1 把检测改写为单次回归

### 3.1 从“候选框之后再分类”变成“整张图一次输出”

下面这张原图值得先看输入和输出，中间网络细节反而是其次。关键变化是：候选区域生成、特征提取、分类和框回归不再由独立模块串联，整张图只执行一次卷积网络；NMS 仍在网络之后消除重复框。

![YOLOv1 从整图输入，经一次卷积网络产生候选检测，再用非极大值抑制得到人、狗和马三个最终框](assets/yolo-evolution/02-yolov1-fig01-detection-system.png)

*图 2　YOLOv1 的完整检测路径。原论文 Figure 1，裁剪自 [You Only Look Once: Unified, Real-Time Object Detection](https://arxiv.org/abs/1506.02640v5)，版权归原作者。它证明的是“单网络前向 + 后处理”的系统边界，不是“完全没有 NMS”。*

YOLOv1 把图像分成 $S\times S$ 网格。若对象中心落在某个网格，该网格负责预测对象。每格输出 $B$ 个框和一组类别概率，因此输出张量为：

$$
\mathbf{Y}\in\mathbb{R}^{S\times S\times(B\cdot5+C)}.
$$

在 PASCAL VOC 设置中，$S=7$、$B=2$、$C=20$，最终是 $7\times7\times30$。每个框预测 $(x,y,w,h)$ 与置信度。论文将置信度定义为：

$$
\operatorname{conf}=P(\text{Object})\cdot\operatorname{IoU}(b,\hat b),
$$

再与条件类别概率相乘，得到类别特定分数：

$$
P(c\mid\text{Object})\cdot\operatorname{conf}
=P(c)\cdot\operatorname{IoU}(b,\hat b).
$$

这一步把“这里有没有东西”“它是什么”“框得准不准”压进同一分数，也埋下了后续分类质量与定位质量是否对齐的问题。

### 3.2 v1 的损失为何会预测出它自己的失败模式

原始损失可概括为：

$$
\mathcal{L}
=\lambda_{coord}\mathcal{L}_{xywh}
+\mathcal{L}_{obj}
+\lambda_{noobj}\mathcal{L}_{noobj}
+\mathcal{L}_{cls},
$$

其中 $\lambda_{coord}=5$，$\lambda_{noobj}=0.5$；宽高使用平方根后再做平方误差，以降低大框绝对误差的支配。一个真值只分配给当前 IoU 最高的框预测器。

论文自己已经明确列出三类局限：每格只能给出有限框且共享一组类别概率，因此拥挤的小目标容易漏；多次下采样导致定位特征粗；平方误差与最终 AP/IoU 并不完全对齐。换句话说，v1 的 45 FPS 与 Fast YOLO 的 155 FPS 证明了统一回归的速度潜力，但 63.4 mAP（VOC 2007）不能掩盖定位仍是主要错误来源。

下一代必须保留“只看一次”，又要让框更容易学。

## 四、第二次责任迁移：YOLOv2 用 Anchor 把任意框变成先验附近的偏移

### 4.1 Anchor 不是多画几个框，而是改变回归坐标系

YOLOv2 删除全连接检测层，在每个卷积位置为若干形状先验预测偏移。先验宽高不是手工挑选，而是用 IoU 距离对训练集框做 k-means：

$$
d(b,c)=1-\operatorname{IoU}(b,c).
$$

这样聚类关心形状重合，而不是大框在欧氏距离中天然占优。读下图时，虚线框是先验 $(p_w,p_h)$，蓝框是解码后的预测；中心被 Sigmoid 约束在当前网格附近，宽高则在先验上做指数缩放。

![YOLOv2 在网格位置以先验宽高为基础，用 Sigmoid 约束中心偏移、用指数函数解码宽高](assets/yolo-evolution/03-yolov2-fig03-anchor-decoding.png)

*图 3　YOLOv2 的 Anchor 解码。原论文 Figure 3，裁剪自 [YOLO9000: Better, Faster, Stronger](https://arxiv.org/abs/1612.08242v1)，版权归原作者。图中的 $c_x,c_y$ 是网格偏移，$p_w,p_h$ 是聚类得到的先验；它解释了参数化，不等于证明 Anchor 在所有数据集上都优于 Anchor-Free。*

解码公式为：

$$
\begin{aligned}
b_x&=\sigma(t_x)+c_x, & b_y&=\sigma(t_y)+c_y,\\
b_w&=p_w e^{t_w}, & b_h&=p_h e^{t_h}.
\end{aligned}
$$

这比从零回归绝对宽高稳定，但也把数据集形状分布写进了 Anchor。换到长条 Logo、遥感小目标或极端纵横比数据时，先验常需重聚类；这正是后来 Anchor-Free 路线要删除的人工结构。

### 4.2 v2 不只是 Anchor：它第一次把速度—精度变成运行时旋钮

YOLOv2 还加入 BatchNorm、高分辨率分类器预训练、Darknet-19、细粒度 passthrough，并采用多尺度训练。由于网络全卷积且总下采样为 32，训练中每 10 个 batch 在 $\{320,352,\ldots,608\}$ 之间更换输入尺寸。相同权重可以在 288、416 或 544 等分辨率运行：论文在 VOC 2007 上分别报告 91 FPS/69.0 mAP、67 FPS/76.8 mAP、40 FPS/78.6 mAP。

这是一项长期保留下来的工程思想：**速度—精度不一定要靠换整套模型，有时可以先调输入尺寸。** 但分辨率提高会近似按像素面积增加计算，也不能凭空恢复训练集中没有的小目标证据。

YOLO9000 的另一条线用 WordTree 联合训练 COCO 检测与 ImageNet 分类，扩到 9000 多类。它证明分类数据能扩展类别语义，却没有解决所有类别都缺少精确框监督的问题；这条开放类别路线与后来视觉语言检测并非同一个机制。

## 五、第三次责任迁移：YOLOv3 让多个特征尺度共同负责检测

YOLOv2 仍主要在较粗特征图上输出。小目标经过多次下采样后只剩几个激活，很难靠更好的 Anchor 补回空间信息。YOLOv3 用 Darknet-53 主干，在三个尺度上分别预测，并通过上采样和横向连接把深层语义与较细位置结合，形成类似特征金字塔的路径。

同时，它做了三项容易被版本号掩盖的修改：

- 每个尺度使用分配到该尺度的 Anchor；
- 类别从 Softmax 改为独立 Logistic，使一个框可以具有多个非互斥标签；
- Objectness 与框回归仍按负责的先验训练，推理继续使用 NMS。

YOLOv3 在 COCO 的 $AP_{50:95}$ 上不一定压倒当时所有方法，但在旧的 $AP_{50}$ 口径和延迟上形成了强折中：论文报告 608 输入时 $33.0$ AP、$57.9$ $AP_{50}$；320 输入时 22 ms、28.2 AP。这里不能把 57.9 与 28.2 直接比较成“翻倍”，因为它们不是同一 IoU 口径。

到这一阶段，YOLO 已经出现后来长期稳定的三段式骨架：Backbone 提特征、Neck 融合尺度、Head 做密集预测。下一个瓶颈不再是缺少单个模块，而是好用的模块和训练技巧太多，怎样组合才真的有效。

## 六、第四次责任迁移：YOLOv4 把“技巧”变成系统设计对象

YOLOv4 的方法论价值高于它的版本号。论文把不会增加推理成本的训练技巧称为 Bag of Freebies（BoF），把只带来少量推理成本的插件称为 Bag of Specials（BoS），再用消融实验筛组合。最终系统以 CSPDarknet53 为 Backbone、SPP 扩大感受野、PAN 聚合多尺度特征，并结合 Mosaic、SAT、DropBlock、CmBN、CIoU、Mish 等方法。

读下面的 Mosaic 图，重点不是“四张图拼在一起”这个视觉效果，而是一次训练样本同时改变对象尺度、上下文和裁切边界；一个 batch 中出现更多场景，也缓解了单 GPU 小 mini-batch 下 BatchNorm 统计不足的问题。

![YOLOv4 论文展示六个 Mosaic 训练样本，每个样本由四张来源图在随机切分点拼接，并保留变换后的目标框](assets/yolo-evolution/04-yolov4-fig03-mosaic.png)

*图 4　Mosaic 数据增强。原论文 Figure 3，裁剪自 [YOLOv4: Optimal Speed and Accuracy of Object Detection](https://arxiv.org/abs/2004.10934v1)，版权归原作者。它支持“多上下文、变尺度、降低大 batch 依赖”的机制解释；它不证明 Mosaic 对任意小数据集都必然增益。*

YOLOv4 特别强调普通硬件可训练：论文称在单张 GTX 1080 Ti 或 RTX 2080 Ti、8–16 GB 显存上完成训练，并在检测实验中使用 batch 64、mini-batch 4 或 8 的多尺度方案。论文报告 COCO 上 43.5 AP、65.7 $AP_{50}$，约 65 FPS（Tesla V100）。但这些数字仍不能和 YOLOv2 的 VOC mAP 横比，也不能把 V100 模型时间当作摄像头到业务结果的端到端延迟。

更重要的是，v4 之后“YOLO 改进”越来越少是一个孤立模块，越来越多是**结构、数据、损失、正样本分配和硬件实现的共同配方**。

## 七、第五次责任迁移：YOLOX 删除 Anchor，并拆开分类与定位

### 7.1 为什么分类和回归不该挤在同一个头里

分类需要对平移和局部形变相对不敏感，定位却恰恰要保留精确位置。YOLOX 将每个 FPN 层先用 $1\times1$ 卷积统一到 256 通道，再分成分类支路和回归/IoU 支路。图中上半是 YOLOv3–v5 的耦合头，下半是解耦头。

![YOLOX 对比耦合检测头与解耦检测头：同一 FPN 特征分别进入分类分支和回归加 IoU 分支](assets/yolo-evolution/05-yolox-fig02-decoupled-head.png)

*图 5　YOLOX 解耦头。原论文 Figure 2，裁剪自 [YOLOX: Exceeding YOLO Series in 2021](https://arxiv.org/abs/2107.08430v2)，版权归原作者。论文消融中解耦头让基线 AP 从 38.5 升至 39.6，并更快收敛，但在 V100、batch=1 下增加约 1.1 ms；“解耦”不是无成本。*

YOLOX 随后把每个位置的预测从多个 Anchor 减为一个 Anchor Point，直接预测框相对位置。Anchor-Free 并不意味着“没有参考点”，而是没有预设宽高模板。若参考点为 $a=(a_x,a_y)$，预测到四边距离 $d=(l,t,r,b)$，则：

$$
\hat b=(a_x-l,\ a_y-t,\ a_x+r,\ a_y+b).
$$

这样减少了每位置预测数量与先验调参，但也让另一个问题更突出：一个目标附近有很多位置，究竟哪些位置应该作为正样本？

### 7.2 SimOTA：把“谁负责谁”从固定规则改成动态匹配

YOLOX 先扩大中心区域的候选，再根据分类和回归损失计算预测 $p_j$ 与真值 $g_i$ 的匹配代价：

$$
c_{ij}=\mathcal{L}^{cls}_{ij}+\lambda\mathcal{L}^{reg}_{ij}.
$$

每个真值根据候选 IoU 动态确定 $k$，再选择代价最低的 top-$k$ 位置作为正样本。它保留 OTA 的质量感知和全局视角，却省掉 Sinkhorn-Knopp 最优传输求解。YOLOX 的逐步消融显示：Anchor-Free 本身把 42.0 AP 提到 42.9，中心多正样本到 45.0，SimOTA 再到 47.3。真正的大增益来自**表示变化与分配策略配合**，不能只把功劳归给“删除 Anchor”。

论文训练配置也揭示了代价：主实验在 COCO 上训练 300 epoch、默认总 batch 128、典型 8 GPU，输入在 448–832 间变化；速度以 V100、FP16、batch=1 且不含后处理测量。报告称单 GPU 也能训练，不等于所有型号都在单卡上经济可复现。

## 八、从模型到体系：v5、v6、v7、v8 分别补了什么

### 8.1 YOLOv5：没有同名论文，但工程影响不能被“无论文”抹掉

截至本文证据边界，YOLOv5 的一手材料是 Ultralytics 仓库和 Release，而不是一篇名为 YOLOv5 的同行评议论文。它的重要性在于 PyTorch 训练、验证、推理、导出与模型尺度形成稳定工作流，并把检测之外的分割等任务收进同一仓库。[v7.0 Release](https://github.com/ultralytics/yolov5/releases/tag/v7.0) 固定于提交 [`915bbf2`](https://github.com/ultralytics/yolov5/tree/915bbf294bb74c859f0b41f1c23bc395014ea679)。

因此评价 YOLOv5 时应说“这个固定版本的代码与权重做了什么”，不能虚构论文贡献，也不能拿持续更新的 `master` 结果回填到 2020 年。

### 8.2 YOLOv6：训练时多分支，推理时折叠成硬件友好单路

YOLOv6 将结构重参数化用于 Backbone 和 Neck：训练时 RepVGG 式多分支更易优化，推理前把卷积和 BN 等价折叠到单个 $3\times3$ RepConv；小模型使用 EfficientRep/Rep-PAN，大模型改用 CSPStackRep，Head 则采用更轻的解耦结构。报告进一步把 TAL、蒸馏、PTQ/QAT 与 TensorRT 图优化放进同一框架。

这代表一个重要边界变化：模型不再只对 FLOPs 负责，还要对目标算子、内存访问、量化敏感层和推理引擎负责。报告的训练使用 8 张 A100，速度在 T4 + TensorRT 上测试；YOLOv6-S 的 43.5 AP、batch=32 下 495 FPS，以及量化版本 869 FPS 都是特定吞吐条件，不是边缘设备 batch=1 延迟。

### 8.3 YOLOv7：让更强监督只存在于训练期

YOLOv7 继续研究“可训练的 Bag of Freebies”：E-ELAN 扩展特征基数但维持梯度路径；计划式重参数化根据残差或拼接结构决定 RepConv 是否保留 identity；辅助头只在训练期提供深监督，推理仍由 Lead Head 输出。

下图从左到右依次是无辅助头、有辅助头、独立分配、Lead Head 引导，以及粗到细分配。最后一种方案让能力较弱的辅助头学习更宽松、偏召回的 coarse 标签，让最终 Lead Head 学更严格的 fine 标签。

![YOLOv7 从普通模型增加辅助头，并比较独立、Lead Head 引导与粗到细 Lead Head 引导三种标签分配](assets/yolo-evolution/06-yolov7-fig05-label-assignment.png)

*图 6　YOLOv7 辅助头标签分配。原论文 Figure 5，裁剪自 [YOLOv7: Trainable Bag-of-Freebies Sets New State-of-the-Art for Real-Time Object Detectors](https://arxiv.org/abs/2207.02696v1)，版权归原作者。图中辅助头是训练结构，不能据此推断部署时必须保留多个输出头。*

论文在 COCO 上从零训练、不使用额外检测数据，报告 YOLOv7 640 输入为 51.4 AP / 161 FPS，YOLOv7-E6E 1280 输入为 56.8 AP / 36 FPS。速度表以 V100 为主；大模型的高 AP 与普通模型的高 FPS代表两个不同服务点，不是一项模型同时达到。

### 8.4 YOLOv8：把论文结论和源码事实分开

按 Asia/Shanghai 时区截至 2023-05-31，Ultralytics 仓库最新提交为 [`fd94d31`](https://github.com/ultralytics/ultralytics/tree/fd94d312da626f9557e43adb7b339afa459e497f)，版本号 `8.0.111`。它没有同名论文可供归因，因此下面只陈述固定源码事实：

- [`Detect`](https://github.com/ultralytics/ultralytics/blob/fd94d312da626f9557e43adb7b339afa459e497f/ultralytics/nn/modules/head.py) 用独立 `cv2` 和 `cv3` 分支预测框分布与类别；输出通道为 $4\cdot reg\_max+C$，没有单独 Objectness 通道；
- `reg_max=16`，四条边各预测 16 档分布，再经 DFL 期望解码；
- [`v8DetectionLoss`](https://github.com/ultralytics/ultralytics/blob/fd94d312da626f9557e43adb7b339afa459e497f/ultralytics/yolo/utils/loss.py) 使用 Box、Class、DFL 三项损失；
- [`TaskAlignedAssigner`](https://github.com/ultralytics/ultralytics/blob/fd94d312da626f9557e43adb7b339afa459e497f/ultralytics/yolo/utils/tal.py) 以分类分数和 CIoU 共同选择 top-$k$ 正样本，检测损失中配置为 $topk=10,\alpha=0.5,\beta=6.0$。

这个固定实现先把 CIoU 截断到非负质量 $q_{ij}$，再计算对齐度：

$$
q_{ij}=\max\!\left(\operatorname{CIoU}(b_j,g_i),0\right),
\qquad
m_{ij}=s_{ij}^{\alpha}q_{ij}^{\beta}.
$$

这意味着“分类相信它”与“框确实贴合”必须同时成立。v1 已经尝试把类别、Objectness 与 IoU 组合为分数；v8 的变化是把这种对齐深入正样本分配和分布式框回归。

## 九、统一数学视角：七代变化其实集中在三件事

### 9.1 框怎样表示

| 路线 | 预测变量 | 优点 | 代价 |
|---|---|---|---|
| v1 直接网格回归 | 相对网格中心 $x,y$，相对整图 $w,h$ | 简单、输出少 | 异常形状难学，粗网格限制强 |
| v2–v5 Anchor-Based | 相对先验的 $t_x,t_y,t_w,t_h$ | 先验降低回归难度 | 聚类与每尺度 Anchor 是超参数 |
| YOLOX/v6 Anchor-Point | 相对参考点的偏移或 $l,t,r,b$ | 减少预测数和形状先验 | 更依赖正样本分配 |
| v8 DFL | 每条边的离散距离分布 | 表达不确定性并提供更细梯度 | 通道数和解码计算增加 |

DFL 将一条边的连续距离 $d$ 表示为 $K$ 个离散桶概率 $p_k$，解码为期望：

$$
\hat d=\sum_{k=0}^{K-1}k\cdot\operatorname{softmax}(z)_k.
$$

下面的可运行骨架只复现“Anchor Point + DFL 期望 + 四边距离解码”，不包含 Backbone、标签分配、损失权重或 NMS：

```python
import torch
from torch import Tensor


def dfl_expectation(logits: Tensor) -> Tensor:
    """logits: [batch, points, 4, reg_max] -> ltrb distances."""
    if logits.ndim != 4 or logits.shape[2] != 4:
        raise ValueError("expected [batch, points, 4, reg_max]")
    bins = torch.arange(logits.shape[-1], device=logits.device,
                        dtype=logits.dtype)
    return (logits.softmax(dim=-1) * bins).sum(dim=-1)


def dist2bbox(anchor_xy: Tensor, ltrb: Tensor, stride: Tensor) -> Tensor:
    """anchor_xy: [points, 2]; ltrb: [batch, points, 4]."""
    if anchor_xy.ndim != 2 or anchor_xy.shape[-1] != 2:
        raise ValueError("anchor_xy must be [points, 2]")
    left_top = anchor_xy[None] - ltrb[..., :2]
    right_bottom = anchor_xy[None] + ltrb[..., 2:]
    return torch.cat((left_top, right_bottom), dim=-1) * stride


if __name__ == "__main__":
    raw = torch.randn(2, 8400, 4, 16)
    points = torch.rand(8400, 2) * 80
    boxes_xyxy = dist2bbox(points, dfl_expectation(raw), torch.tensor(8.0))
    assert boxes_xyxy.shape == (2, 8400, 4)
```

### 9.2 谁被分配为正样本

v1 让 IoU 最高的框预测器负责；v2/v3 先按 Anchor 形状与尺度分配；YOLOX 的 SimOTA 根据当前预测质量动态选 top-$k$；v6/v8 的 TAL 又把分类可信度与定位质量直接组合。**Assigner 不只是训练实现细节，它决定梯度从哪些空间位置进入模型。** 小目标、拥挤场景和类别不平衡常在这里被放大或缓解。

### 9.3 训练期能力怎样折叠到推理期

Mosaic、蒸馏、辅助头、EMA、重参数化和 QAT 都在训练时增加信息或结构，但它们对部署的影响不同：

- Mosaic 与普通蒸馏可以在推理时完全消失；
- 辅助头若只做深监督，部署时可移除；
- RepConv 要在导出前正确融合分支与 BN；
- QAT 会改变权重与量化图，必须在目标引擎重新验精度；
- NMS 仍可能在 CPU 或独立算子执行，模型前向快不等于端到端快。

这也是从 v4 到 v8 最明显的收敛方向：研究不再只问“网络学到了什么”，还问“哪些训练复杂度能在部署前被折叠掉”。

## 十、怎样读性能表，才不会得出错误的版本排名

目标检测最常见的 IoU 为：

$$
\operatorname{IoU}(B_p,B_g)=\frac{|B_p\cap B_g|}{|B_p\cup B_g|}.
$$

$AP_{50}$ 只要求 IoU 至少 0.5；COCO 主指标 $AP_{50:95}$ 在 0.50 到 0.95、步长 0.05 上平均，更严格地惩罚定位偏差。VOC 2007 mAP、COCO AP、COCO $AP_{50}$ 不是同一量尺。

| 报告 | 代表数字 | 数据 / 输入 | 速度条件 | 可以说明 | 不能说明 |
|---|---:|---|---|---|---|
| YOLOv1 | 63.4 mAP / 45 FPS | VOC 2007，448 | Titan X，论文实现 | 统一回归达到实时 | 比现代 COCO 模型更准或更慢 |
| YOLOv2 | 76.8 mAP / 67 FPS | VOC 2007，416 | Titan X | 同一权重可调分辨率 | Anchor 在所有域都最优 |
| YOLOv3 | 33.0 AP；57.9 $AP_{50}$ | COCO，608 | Titan X，51 ms | 严格 AP 与 AP50 差异大 | 57.9 可直接和 33.0 相除 |
| YOLOv4 | 43.5 AP / 约 65 FPS | COCO，608 | V100，batch=1 | 配方获得强速度—精度点 | 摄像头端到端就是 15 ms |
| YOLOX-L | 50.0 AP / 68.9 FPS | COCO，640 | V100、FP16、batch=1，不含后处理 | Anchor-Free + SimOTA 可形成强基线 | NMS、预处理和传输免费 |
| YOLOv6-S | 43.5 AP / 495 FPS | COCO，640 | T4 TensorRT、batch=32 | 高 batch 吞吐优化有效 | 单路实时延迟是 $1/495$ 秒 |
| YOLOv7 | 51.4 AP / 161 FPS | COCO，640 | V100 | 该服务点兼顾 AP 与吞吐 | 任意框架、精度都能复现 |
| YOLOv8n `8.0.111` | 37.3 AP / 0.99 ms | COCO，640 | A100 TensorRT，仓库表格 | 固定版本提供可复验声明 | CPU、消费卡、业务图像同速 |

生产比较至少要固定：同一数据切分、相同输入尺寸、相同精度、batch=1 与目标 batch 分开、相同预处理和 NMS、同一硬件与引擎，并报告 P50/P95 延迟和峰值显存。否则“更快”可能只是换了 GPU、TensorRT、FP16 或 batch 口径。

## 十一、工程落地：最低能跑、推荐可用与生产还缺什么

### 11.1 最低可运行配置

以 2023-05-31 的 Ultralytics `8.0.111` 为例，官方 README 要求 Python ≥ 3.7 与 PyTorch ≥ 1.7，预训练 `yolov8n.pt` 可在 CPU 或受支持 GPU 上推理。**仓库没有给出一个可泛化的“最低内存/显存”数字**；CPU 能启动不等于满足实时预算，必须在自己的输入尺寸与并发下测试。

### 11.2 推荐可用配置

先选最小模型在目标硬件做 batch=1 端到端基线，再逐级增大模型或输入尺寸，直到达到业务 Recall/Precision 门禁。若部署到 NVIDIA GPU，应同时测 PyTorch 与导出的 ONNX/TensorRT；若是 CPU/NPU，应先确认算子、动态尺寸、NMS 和量化路径。训练卡数不应从论文 batch 反推：YOLOX 明确给出典型 8 GPU，YOLOv6 报告 8 A100，YOLOv7 的主论文没有给出足够信息支持统一成本估算。

### 11.3 从 Demo 到生产还缺什么

![YOLO 生产闭环从任务契约和标签规范开始，经固定版本训练、离线门禁、目标硬件验证、灰度上线到线上监控；困难样本和业务代价再回流数据与回归集](assets/yolo-evolution/07-yolo-production-loop.svg)

*图 7　YOLO 生产闭环。本文归纳。模型版本只占中间一段；回归集、阈值、导出图、目标硬件、监控和回滚共同决定可用性。*

一个固定版本的最小推理封装应至少校验输入、空结果、数值范围和越界框，并保存可追溯输出。下面代码对应 `ultralytics==8.0.111` 的公开 API；它省略服务队列、模型预热、批处理、指标上报和模型注册表：

```python
from pathlib import Path
from typing import Any

from ultralytics import YOLO


MODEL = YOLO("yolov8n.pt")  # 服务启动时加载一次，生产中应改为版本化本地权重


def detect_image(image_path: str, device: str = "cpu") -> list[dict[str, Any]]:
    path = Path(image_path).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(path)

    results = MODEL.predict(
        source=str(path), imgsz=640, conf=0.25, iou=0.70,
        device=device, verbose=False
    )
    if len(results) != 1:
        raise RuntimeError(f"expected one result, got {len(results)}")

    result = results[0]
    height, width = result.orig_shape
    if result.boxes is None or len(result.boxes) == 0:
        return []
    detections: list[dict[str, Any]] = []
    for xyxy, confidence, class_id in zip(
        result.boxes.xyxy.cpu().tolist(),
        result.boxes.conf.cpu().tolist(),
        result.boxes.cls.cpu().tolist(),
    ):
        x1, y1, x2, y2 = xyxy
        if not (0 <= x1 <= x2 <= width and 0 <= y1 <= y2 <= height):
            raise ValueError(f"out-of-bounds box: {xyxy}")
        detections.append({
            "xyxy": [x1, y1, x2, y2],
            "confidence": float(confidence),
            "class_id": int(class_id),
        })
    return detections
```

商业落地还要检查许可证。固定提交 `8.0.111` 的 README 和源码标注 AGPL-3.0，并提供 Enterprise License 路径；能否用于某种闭源分发或网络服务属于具体法律判断，不能从“代码可下载”直接推导。

## 十二、YOLO 的边界：框不是 Mask，更不是可编辑对象

检测框只回答“某类对象大致在哪里”。它不提供像素轮廓、Alpha、遮挡关系或图层结构。YOLO 后续仓库虽加入分割 Head，也不能反推历史项目使用了实例分割版本。

知识库中已有的图生模版复盘记录了一个恰当例子：YOLOv7 只负责 Logo 的 BBox，项目随后直接保留矩形图块，因为字标、小字、描边和阴影一旦被错误抠掉，品牌损伤比少量背景耦合更严重。需要像素轮廓时，系统另用 Grounding DINO + SAM 2；需要业务角色时，再引入全局视觉语言模型。详见：[从 Bounding Box 到可编辑图层：图像分割技术综述与图生模版实践](../AIGC/从Bounding%20Box到可编辑图层：图像分割技术综述与图生模版实践.md)。

这正是 YOLO 最健康的使用方式：按输出契约给它分配职责，而不是因为它很快就让它代表整套视觉系统。

## 十三、结论：架构已趋同，增益正在转向数据、分配器和 Runtime

回看 2015 到 2023 年 5 月，YOLO 的核心路线可以压成七次迁移：

1. 从候选区域流水线迁移到整图统一回归；
2. 从绝对框迁移到 Anchor 先验附近的偏移；
3. 从单一粗尺度迁移到多尺度特征金字塔；
4. 从单点结构创新迁移到训练配方与消融；
5. 从 Anchor 和耦合头迁移到 Anchor Point、解耦头与动态标签分配；
6. 从训练网络迁移到可折叠、可量化、面向硬件的模型族；
7. 从“一个检测模型”迁移到训练、验证、导出、监控与许可证共同组成的产品体系。

Backbone–Neck–Head 的总体形态已经相当稳定；仍在快速变化的是 Assigner、Loss、数据增强、蒸馏、量化和 Runtime。下一次真正有价值的改进，不一定再叫更大的 vN。它更可能来自更准确的任务契约、更有代表性的困难样本、更一致的分类—定位质量，以及不丢精度的端到端部署。

## 公开一手资料

1. [You Only Look Once: Unified, Real-Time Object Detection](https://arxiv.org/abs/1506.02640v5)
2. [YOLO9000: Better, Faster, Stronger](https://arxiv.org/abs/1612.08242v1)
3. [YOLOv3: An Incremental Improvement](https://arxiv.org/abs/1804.02767v1)
4. [YOLOv4: Optimal Speed and Accuracy of Object Detection](https://arxiv.org/abs/2004.10934v1)
5. [Ultralytics YOLOv5 v7.0 Release](https://github.com/ultralytics/yolov5/releases/tag/v7.0)
6. [YOLOX: Exceeding YOLO Series in 2021](https://arxiv.org/abs/2107.08430v2)
7. [YOLOv6: A Single-Stage Object Detection Framework for Industrial Applications](https://arxiv.org/abs/2209.02976v1)
8. [YOLOv7: Trainable Bag-of-Freebies Sets New State-of-the-Art for Real-Time Object Detectors](https://arxiv.org/abs/2207.02696v1)
9. [Ultralytics `8.0.111` 固定源码](https://github.com/ultralytics/ultralytics/tree/fd94d312da626f9557e43adb7b339afa459e497f)
