---
title: 大模型与强化学习的协同演进
description: 以强化学习的五个核心优化难题为主线，从策略梯度、优势估计和 PPO 讲到偏好学习、DPO 与 GRPO，再解释这些算法为何进入大模型后训练，以及 SFT 和 RL 各自应该解决什么问题。
tags:
  - 大模型
  - 强化学习
  - LLM-Post-Training
  - RLHF
  - Reasoning-Model
date: 2026-04-16
last_verified: 2026-08-03
noteType: technical
publish: true
---
# 大模型与强化学习的协同演进

![强化学习从策略梯度、优势估计、近端更新、偏好反馈演进到组相对优化的五次关键突破](assets/rl-optimization-roadmap.svg)

*图 1　强化学习的五次关键优化。主线不是“哪个缩写替代哪个缩写”，而是奖励不可微、梯度高方差、策略更新失稳、反馈昂贵和 critic 昂贵依次逼出了新的估计与约束；大模型只是把这些老问题放大到了超长离散动作空间。本文归纳，依据 [REINFORCE](https://link.springer.com/article/10.1007/BF00992696)、[GAE](https://arxiv.org/abs/1506.02438)、[TRPO](https://arxiv.org/abs/1502.05477)、[PPO](https://arxiv.org/abs/1707.06347)、[DPO](https://arxiv.org/abs/2305.18290) 与 [DeepSeekMath](https://arxiv.org/abs/2402.03300)。*

先想一个很具体的问题：模型做一道数学题，生成了 800 个 Token，最后答案错了。我们只有一个终局分数 `0`，没有标准推理过程，也不知道究竟是第 37 个 Token 的代数变形错了，还是第 760 个 Token 抄错了数字。怎样让模型下次更可能走对？

这才是强化学习真正要解决的问题：**不是把正确答案再教一遍，而是在模型自己的行为分布里，用结果反推哪些行为应该更常发生。**

围绕这个目标，几十年的算法突破可以压缩成五个问题：

1. 奖励和采样动作不可微，梯度从哪里来？
2. 一条轨迹的分数噪声很大，怎样判断某个动作是否真的更好？
3. 策略一更新，数据分布也跟着变化，怎样避免一步把模型推坏？
4. 人类偏好难写成标准答案，怎样把比较信号变成优化目标？
5. 专门预测未来回报的价值模型（critic）太贵，而奖励常常只在结尾出现，能不能不用它？

PPO、DPO、GRPO 分别回答了其中不同的问题。它们不是版本号，也不是同一个旋钮上的新旧三代。

# 一、先建立最小强化学习直觉

## 1.1 监督学习给动作，强化学习只给结果

监督学习的数据通常长这样：

$$
(x,y^*)\quad\text{题目与标准答案}
$$

每个目标 Token 都提供直接监督。强化学习的数据更像：

$$
\tau=(s_0,a_0,s_1,a_1,\ldots,s_T),\qquad R(\tau)\in\mathbb{R}
$$

智能体自己选择动作 $a_t$，环境产生下一状态 $s_{t+1}$，最后只告诉它整条轨迹得了多少分。优化目标是最大化期望回报：

$$
J(\theta)=\mathbb{E}_{\tau\sim\pi_\theta}[R(\tau)]
$$

这里的 $\pi_\theta(a\mid s)$ 是策略：在状态 $s$ 下选择动作 $a$ 的概率。

把语言模型放进这个定义并不神秘：

- 状态 $s_t$：提示词与已经生成的前缀 $(x,y_{<t})$；
- 动作 $a_t$：下一个 Token $y_t$；
- 策略 $\pi_\theta$：模型的 next-token 概率；
- 环境转移：把新 Token 拼进上下文；
- 奖励：人类偏好分、数学正确率、代码测试结果或工具任务是否完成。

![语言模型把提示与已生成前缀作为状态、把下一个Token作为动作，并在完整回答或工具交互后获得奖励](assets/llm-mdp-loop.svg)

*图 2　语言模型的强化学习映射。单轮问答在任务层面接近 contextual bandit，即给定上下文后只做一次整体回答并获得结果；从 Token 生成看，它仍是终局奖励稀疏的长序列。进入工具调用后，外部 observation 会真正改变环境，问题才成为更完整的 MDP。本文归纳。*

每一步环境立刻给出的分数叫奖励 $r_t$；从某一步开始能获得的累计折扣奖励叫回报：

$$
G_t=\sum_{k=t}^{T}\gamma^{k-t}r_k
$$

$\gamma$ 越小，越重视近期结果。单轮 LLM 任务常取 $\gamma\approx 1$，并且除最后一步外 $r_t$ 几乎都是零；这正是信用分配困难的来源。

这一映射解释了为什么大模型适合用策略梯度：词表是巨大的离散动作空间，策略本来就显式给出了每个动作的概率。

## 1.2 优化点一：奖励不可微，也能优化策略

奖励可能来自编译器、真人或远程环境，通常无法对模型参数求导。REINFORCE 使用 likelihood-ratio trick：

$$
\begin{aligned}
\nabla_\theta J(\theta)
&=\nabla_\theta\sum_\tau p_\theta(\tau)R(\tau)\\
&=\sum_\tau p_\theta(\tau)R(\tau)\nabla_\theta\log p_\theta(\tau)\\
&=\mathbb{E}_{\tau\sim\pi_\theta}
\left[R(\tau)\sum_t\nabla_\theta\log\pi_\theta(a_t\mid s_t)\right].
\end{aligned}
$$

直觉比公式简单：

- 一条轨迹得分高，就提高其中动作的 log-probability；
- 得分低，就降低这些动作的概率；
- 不需要对奖励函数本身求导。

最小实现只有几行：

```python
import torch


def masked_mean(x: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    return (x * mask).sum() / mask.sum().clamp_min(1)


def reinforce_loss(
    token_logp: torch.Tensor,
    trajectory_return: torch.Tensor,
    response_mask: torch.Tensor,
) -> torch.Tensor:
    """
    token_logp/response_mask: [batch, response_tokens]
    trajectory_return: [batch], one return per sampled response
    """
    weight = trajectory_return.detach().unsqueeze(-1)
    return -masked_mean(token_logp * weight, response_mask)
```

代码能运行，不代表它好用。若模型做三道难度完全不同的题，`1、0、0` 三个分数同时包含题目难度、采样运气和动作质量。直接拿回报乘梯度，估计方差会非常大。

# 二、优化点二：用 Baseline 和 Advantage 降低方差

## 2.1 “得了 1 分”不等于“每一步都做得好”

强化学习真正想知道的不是绝对回报，而是：

> 在当前状态下，这个动作比通常能做到的水平好多少？

这就是优势函数：

$$
A^\pi(s,a)=Q^\pi(s,a)-V^\pi(s)
$$

$Q^\pi(s,a)$ 表示先执行动作 $a$ 后的期望回报，$V^\pi(s)$ 表示处于状态 $s$ 时通常能获得的回报。两者相减，题目本身难不难、这个状态本来就好不好，会被 baseline 抵消一部分。

为什么减 baseline 不会改变期望梯度？只要 $b(s)$ 不依赖当前动作：

$$
\mathbb{E}_{a\sim\pi}
\left[b(s)\nabla_\theta\log\pi_\theta(a\mid s)\right]
=b(s)\nabla_\theta\sum_a\pi_\theta(a\mid s)=0
$$

它改变方差，不改变期望方向。

![终局奖励同时作用于整条生成轨迹，减去同题平均基线后，成功轨迹得到正优势、失败轨迹得到负优势](assets/policy-gradient-credit.svg)

*图 3　从回报到优势。同题三条轨迹的平均奖励可以作为最简单的 baseline；Actor-Critic 学习状态价值 $V(s)$，GRPO 则直接用同题多回答的组内统计。示例数字仅用于解释，不是实验结果。*

## 2.2 Actor-Critic：让一个模型学习“通常水平”

Actor 是策略 $\pi_\theta$，负责选择动作；critic 学习价值函数 $V_\psi(s)$，负责估计从当前状态继续下去通常能得多少分。最简单的时序差分误差是：

$$
\delta_t=r_t+\gamma V_\psi(s_{t+1})-V_\psi(s_t)
$$

只看一步的 $delta_t$ 方差小，但会继承 critic 偏差；整条 Monte Carlo return 偏差小，方差却高。GAE 用参数 $λ$ 在两者之间插值：

$$
\hat A_t^{\mathrm{GAE}}
=\sum_{l=0}^{T-t-1}(\gamma\lambda)^l\delta_{t+l}
$$

```python
def generalized_advantage_estimation(
    rewards: torch.Tensor,
    values: torch.Tensor,
    mask: torch.Tensor,
    gamma: float = 1.0,
    lam: float = 0.95,
) -> tuple[torch.Tensor, torch.Tensor]:
    """All tensors are [batch, time]; values includes V(s_t)."""
    advantages = torch.zeros_like(rewards)
    last_advantage = torch.zeros(rewards.size(0), device=rewards.device)
    next_value = torch.zeros_like(last_advantage)

    for t in reversed(range(rewards.size(1))):
        valid = mask[:, t]
        delta = rewards[:, t] + gamma * next_value - values[:, t]
        last_advantage = (delta + gamma * lam * last_advantage) * valid
        advantages[:, t] = last_advantage
        next_value = values[:, t] * valid

    returns = advantages + values
    return advantages, returns
```

对大模型而言，这一步的代价也被放大了：critic 通常要读取完整前缀并逐 Token 输出价值，规模可能接近 policy。长回答、稀疏终局奖励又让价值估计非常难学。后面的 RLOO 和 GRPO，本质上都会重新追问：**能否找到一个便宜 baseline，而不训练大 critic？**

# 三、优化点三：用 TRPO/PPO 限制一次更新的破坏力

## 3.1 策略梯度为什么容易“学崩”

监督学习的数据集通常固定；在线强化学习的数据来自当前策略。参数一变，模型生成的数据分布也变。若在同一批旧轨迹上更新太多次，新策略可能已经和采样策略相差很远，梯度估计便不再可靠。

TRPO 的思路是给更新加一个 KL 信赖域：

$$
\max_\theta\;
\mathbb{E}_t\left[\rho_t(\theta)\hat A_t\right]
\quad\text{s.t.}\quad
\mathbb{E}_t\left[D_{\mathrm{KL}}(
\pi_{\theta_{\mathrm{old}}}\|\pi_\theta)
\right]\le\delta
$$

其中 importance ratio 为：

$$
\rho_t(\theta)=
\frac{\pi_\theta(a_t\mid s_t)}
{\pi_{\theta_{\mathrm{old}}}(a_t\mid s_t)}
$$

TRPO 的理论边界清楚，但二阶近似和共轭梯度实现较重。PPO 用裁剪的一阶目标换取工程简单：

$$
\mathcal{L}_{\mathrm{PPO}}
=-\mathbb{E}_t\left[
\min\left(
\rho_t\hat A_t,
\operatorname{clip}(\rho_t,1-\epsilon,1+\epsilon)\hat A_t
\right)
\right]
$$

```python
def ppo_clip_loss(
    new_logp: torch.Tensor,
    old_logp: torch.Tensor,
    advantage: torch.Tensor,
    response_mask: torch.Tensor,
    epsilon: float = 0.2,
) -> torch.Tensor:
    ratio = (new_logp - old_logp).exp()
    unclipped = ratio * advantage.detach()
    clipped = ratio.clamp(1 - epsilon, 1 + epsilon) * advantage.detach()
    return -masked_mean(torch.minimum(unclipped, clipped), response_mask)
```

PPO 不是保证策略绝不移动，而是让超出近端范围的样本不再继续提供同方向梯度。

## 3.2 两个经常混淆的“旧模型”

LLM RLHF 通常同时出现 $π_{old}$ 和 $π_{ref}$：

| 模型 | 作用 | 是否随训练更新 |
|---|---|---|
| old policy $π_{old}$ | 生成当前 rollout，并作为 PPO importance ratio 分母 | 每轮采样后刷新 |
| reference policy $π_{ref}$ | 约束模型不要偏离 SFT/base 行为太远 | 通常冻结，也可能按策略同步 |

PPO clipping 约束的是**相邻策略更新**；reference KL 约束的是**与行为锚点的长期距离**。把两者混为一个 KL，是理解 RLHF 时最常见的错误之一。

## 3.3 为什么 PPO 会进入大模型 RLHF

人类对开放式回答往往写不出唯一标准答案，却能比较两个回答哪个更好。InstructGPT 把这件事组织成 SFT、奖励建模和 PPO 三阶段。

![InstructGPT原论文三阶段流程：先收集示范做SFT，再排序多条回答训练奖励模型，最后用PPO根据奖励更新策略](assets/paper-instructgpt-fig2-rlhf-pipeline.png)

*图 4　从左到右看：示范给出可用初始策略；比较数据把人类判断压缩成奖励模型；PPO 再在新提示上采样并优化该奖励。原论文 Figure 2，[Training language models to follow instructions with human feedback](https://arxiv.org/abs/2203.02155)，裁剪自原 PDF，版权归原作者。*

奖励模型常用 Bradley-Terry 偏好概率：

$$
P(y_w\succ y_l\mid x)
=\sigma\left(r_\phi(x,y_w)-r_\phi(x,y_l)\right)
$$

训练好奖励模型后，policy 优化一个带参考约束的期望奖励：

$$
\max_\theta\;
\mathbb{E}_{y\sim\pi_\theta(\cdot\mid x)}
\left[r_\phi(x,y)
-\beta\log\frac{\pi_\theta(y\mid x)}{\pi_{ref}(y\mid x)}\right]
$$

PPO 被采用并不是因为它为语言而生，而是因为它同时满足三件事：支持离散随机策略、能复用 rollout 多个 minibatch、又能限制高维生成策略的一次更新。

代价也很清楚：经典实现同时维护 policy、old/reference、reward model 和 value model，还要持续生成新回答。更危险的是，policy 会主动寻找奖励模型的漏洞。proxy reward 上升不等于真实质量持续上升，这也是 [reward model overoptimization](https://arxiv.org/abs/2210.10760) 必须用独立评测、KL、早停和红队约束的原因。

# 四、优化点四：把昂贵反馈变成可训练目标

## 4.1 奖励模型解决“不会写标签”，却引入一套在线系统

偏好比较比绝对打分更容易收集，但 RM + PPO 的系统成本很高。到开放权重模型普及时，许多团队拥有 chosen/rejected 数据，却没有持续 rollout 和四模型训练集群。

DPO 回答的问题不是“怎样做更好的在线 RL”，而是：

> 在固定偏好对已经存在时，能不能直接求出符合这些偏好的策略？

![DPO原论文对比RLHF与DPO：RLHF先训练奖励模型并在线采样更新策略，DPO直接从偏好对训练最终语言模型](assets/paper-dpo-fig1-rlhf-vs-dpo.png)

*图 5　左侧 RLHF 把偏好先变成显式奖励，再运行在线 RL；右侧 DPO 直接用最大似然式分类目标训练最终 policy。原论文 Figure 1，[Direct Preference Optimization](https://arxiv.org/abs/2305.18290)，裁剪自原 PDF，版权归原作者。*

## 4.2 DPO 怎样消掉显式奖励模型

对 KL 正则化的奖励最大化问题，最优策略满足：

$$
\pi^*(y\mid x)
=\frac{1}{Z(x)}\pi_{ref}(y\mid x)
\exp\left(\frac{r^*(x,y)}{\beta}\right)
$$

反解奖励并代回 Bradley-Terry 偏好模型，同一提示下的 $Z(x)$ 会在 chosen/rejected 差分中消掉，得到：

$$
\mathcal{L}_{\mathrm{DPO}}
=-\mathbb{E}\log\sigma\left(
\beta\left[
\log\frac{\pi_\theta(y_w\mid x)}{\pi_{ref}(y_w\mid x)}
-\log\frac{\pi_\theta(y_l\mid x)}{\pi_{ref}(y_l\mid x)}
\right]\right)
$$

这里的 $\log\pi_\theta(y\mid x)$ 是回答部分各 Token log-probability 的和；prompt、padding 和被截断的无效位置不能混进去。

```python
import torch.nn.functional as F


def dpo_loss(
    pi_chosen_logp: torch.Tensor,
    pi_rejected_logp: torch.Tensor,
    ref_chosen_logp: torch.Tensor,
    ref_rejected_logp: torch.Tensor,
    beta: float = 0.1,
) -> torch.Tensor:
    policy_margin = pi_chosen_logp - pi_rejected_logp
    reference_margin = ref_chosen_logp - ref_rejected_logp
    preference_logit = beta * (policy_margin - reference_margin)
    return -F.logsigmoid(preference_logit).mean()
```

DPO 的训练过程像监督学习：固定数据、没有环境交互、没有当前策略 rollout，也没有显式信用分配。因此更准确的说法是：

- 它的**理论来源**是 KL 正则化 RLHF；
- 它的**训练过程**是离线直接偏好优化，不是经典在线 RL。

它省掉显式 RM、critic 和在线采样，也相应失去探索能力。若偏好对来自很旧的模型，当前 policy 新出现的失败和 reward hacking 不会自动进入数据。DPO 最适合“反馈已经变成高质量固定 pair”的场景，而不是所有 RLHF 场景的普遍替代品。

# 五、优化点五：不用 Critic，也能构造 Advantage

## 5.1 从 RLOO 到 GRPO：让同题多条回答互相做 Baseline

数学、代码和结构化输出有一个重要变化：奖励可以由 exact match、编译器、单元测试或几何规则自动给出。对同一道题采样多条回答后，不再一定需要 value model 预测每个 Token 的未来价值。

RLOO 对第 $i$ 条回答使用其他回答的平均奖励作为 baseline：

$$
b_i=\frac{1}{G-1}\sum_{j\ne i}R_j,qquad
\hat A_i=R_i-b_i
$$

GRPO 通常使用整组均值和标准差：

$$
\hat A_i=
\frac{R_i-\operatorname{mean}(R_1,\ldots,R_G)}
{\operatorname{std}(R_1,\ldots,R_G)+\varepsilon}
$$

然后把序列级 advantage 广播到回答 Token，并使用 PPO 式近端更新。

![DeepSeekMath原论文比较PPO与GRPO：PPO训练价值模型并通过GAE得到优势，GRPO对同一问题采样多条回答并从组内奖励计算优势](assets/paper-deepseekmath-fig4-ppo-vs-grpo.png)

*图 6　最值得看的是黄色 value model：PPO 需要训练它，再经 GAE 得到 $A$；GRPO 把同题多个输出的奖励送入 Group Computation，直接得到组相对优势。原论文 Figure 4，[DeepSeekMath](https://arxiv.org/abs/2402.03300)，裁剪自原 PDF，版权归原作者。*

```python
def grpo_loss(
    new_logp: torch.Tensor,
    old_logp: torch.Tensor,
    rewards: torch.Tensor,
    response_mask: torch.Tensor,
    epsilon: float = 0.2,
) -> torch.Tensor:
    """
    new_logp/old_logp/response_mask: [batch, group, tokens]
    rewards: [batch, group]
    """
    mean = rewards.mean(dim=1, keepdim=True)
    std = rewards.std(dim=1, keepdim=True, unbiased=False)
    advantage = ((rewards - mean) / (std + 1e-6)).detach()

    ratio = (new_logp - old_logp).exp()
    unclipped = ratio * advantage.unsqueeze(-1)
    clipped = ratio.clamp(1 - epsilon, 1 + epsilon) * advantage.unsqueeze(-1)
    token_objective = torch.minimum(unclipped, clipped)

    per_response = (token_objective * response_mask).sum(-1)
    per_response /= response_mask.sum(-1).clamp_min(1)
    return -per_response.mean()
```

这段代码只是机制骨架。真实训练还要处理 reference KL、EOS、截断样本、生成与训练引擎 log-prob 不一致、分布式组统计、奖励缺失和多目标聚合。

## 5.2 为什么 GRPO 会与大模型推理同时流行

它恰好匹配四个条件：

1. **结果可验证**：数学答案和代码测试比开放式 helpfulness 更客观；
2. **同题可多采样**：不同思路天然组成 group；
3. **critic 太贵**：长 CoT 的 value model 占用显存，还很难逐 Token 估准；
4. **需要在自身分布中搜索**：模型必须生成、失败、重试，而不是只模仿一条标准推理。

但 GRPO 没有解决所有信用分配问题：一条回答里的所有 Token 仍常共享同一终局 advantage。组内全对或全错时，优势也会退化为零。模型若完全采样不到成功轨迹，再漂亮的相对优化也没有正样本可学。

## 5.3 后续算法主要在修“优化器偷偷偏向了什么”

GRPO 之后的缩写很多，不必逐个背。它们主要对应三种具体偏差：

| 偏差 | 代表修正 | 核心变化 |
|---|---|---|
| 长度与题目难度改变样本权重 | [Dr. GRPO](https://arxiv.org/abs/2503.20783) | 去掉组内 reward-std 缩放，并用固定生成预算代替每条回答自身长度归一化 |
| 零方差组、截断与 loss 聚合浪费训练 | [DAPO](https://arxiv.org/abs/2503.14476) | 动态采样、非对称 clip、Token 级聚合、超长软惩罚 |
| Token 级 ratio 与序列级奖励不一致 | [GSPO](https://arxiv.org/abs/2507.18071) | 用长度归一化的序列 likelihood ratio 做序列级裁剪 |

这张表的重点不是新名字，而是一个审计方法：**发现 RL 后回答变长、模板词增多或 MoE 失稳时，先查 advantage、normalization、aggregation 和 clipping 的单位，再谈“能力涌现”。**

# 六、当回答变成多轮环境，Critic 又可能重新有价值

单轮数学题常只有一个 prompt、若干回答和终局验证。Agent 则会搜索网页、调用工具、执行代码并读取 observation：

$$
\tau=(s_0,a_0,o_1,a_1,o_2,\ldots,a_T),qquad R=R(\tau)
$$

此时早期一次错误搜索可能几十步后才暴露；轨迹长度不同；工具状态会真正改变；失败也可能来自环境超时而非策略。只用同题完整轨迹的组相对终局分数，信用分配往往太粗。

因此算法选择会重新分叉：

- 能给步骤级反馈、轨迹很长时，actor-critic / value-based 方法可能值得额外成本；
- 能并行采样完整轨迹、只关心最终成功时，RLOO/GRPO 类方法仍可作为强基线；
- 环境昂贵或不可重放时，先做 trajectory SFT、rejection sampling 和离线偏好学习，通常比直接在线 RL 更现实；
- 无论使用什么优化器，都要把超时、工具错误、安全违规和任务失败分开记录，不能压成一个含义不明的 `0`。

知识库里的两个应用能说明反馈结构为什么比算法名称更重要：

- 在[[图生模版：从多模型工作流到端到端视觉语言模型|图生模版]]中，元素集合、格式和坐标 IoU 可以自动验证，所以适合在 SFT 后加入 GRPO；但平均 IoU 不能表达角色错配、遮挡和层级，奖励必须先过解析与集合门禁。
- 在[[VLA技术演进与最新模型版图|VLA]]中，自主 rollout 会进入策略自己造成的状态，机器人成功、人工介入和失败轨迹构成经验闭环；这里的长程状态价值比单轮文本答案更重要。

## 6.1 奖励函数必须是可审计接口

真实系统不应只返回一个 float。下面的骨架把解析失败、正确性与安全门禁分开，便于监控 reward hacking：

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


class Verifier(Protocol):
    def parse(self, text: str) -> Any: ...
    def is_correct(self, parsed: Any, target: Any) -> bool: ...
    def is_safe(self, parsed: Any) -> bool: ...


@dataclass(frozen=True)
class RewardResult:
    total: float
    valid: bool
    correct: bool
    safe: bool
    reason: str


def score_rollout(
    answer: str,
    target: Any,
    verifier: Verifier,
    max_chars: int = 20_000,
) -> RewardResult:
    if not answer.strip():
        return RewardResult(0.0, False, False, True, "empty")
    if len(answer) > max_chars:
        return RewardResult(0.0, False, False, True, "overlong")

    try:
        parsed = verifier.parse(answer)
    except (TypeError, ValueError) as exc:
        return RewardResult(0.0, False, False, True, f"parse:{type(exc).__name__}")

    safe = verifier.is_safe(parsed)
    correct = safe and verifier.is_correct(parsed, target)
    total = 1.0 if correct else 0.0
    return RewardResult(total, True, correct, safe, "ok" if correct else "wrong")
```

训练日志至少应分别记录 `valid_rate`、`correct_rate`、`safe_rate`、长度分布、每个 reward component、零方差 group 比例和 holdout verifier 表现。否则 reward 上升时，我们无法判断模型是在解决任务，还是更擅长绕过评分器。

# 七、SFT 与 RL 分别学到了什么

## 7.1 SFT 学“目标动作长什么样”

SFT 最小化专家答案的负对数似然：

$$
\mathcal{L}_{\mathrm{SFT}}
=-\mathbb{E}_{(x,y^*)\sim D}
\sum_t\log\pi_\theta(y_t^*\mid x,y_{<t}^*)
$$

它在专家前缀上逐 Token 给出稠密监督，擅长：

- 注入明确知识、术语和标准步骤；
- 学习 JSON、工具 schema、语言风格和拒答格式；
- 用示范建立一个不会到处乱跑的初始策略；
- 快速教会模型“合法动作是什么”。

它的盲点是 teacher forcing：训练时总站在正确前缀上。模型自己生成错误前缀后如何恢复，如果示范没覆盖，它就没有直接学过。

## 7.2 RL 学“哪些自身轨迹更值得重复”

RL 优化的是模型自己采样轨迹的期望结果：

$$
\max_\theta\;\mathbb{E}_{y\sim\pi_\theta}[R(x,y)]
$$

它擅长：

- 在多种可行答案中重新分配概率；
- 利用失败、比较和环境结果，而不只学习专家正例；
- 优化不可微指标，如测试通过率、任务成功率和人类偏好；
- 学习重试、验证、预算分配和错误恢复。

它的盲点同样明确：reward 只说“得分高不高”，不自动提供正确知识。base model 几乎采样不到成功轨迹时，policy gradient 无米下锅；verifier 有漏洞时，RL 会把漏洞利用得越来越熟练。

![SFT沿专家前缀提供逐Token监督，强化学习在模型自身采样的多条轨迹之间依据结果重分配概率](assets/sft-vs-rl-learning.svg)

*图 7　SFT 与 RL 的数据分布不同。SFT 规定起点、接口和示范；RL 在当前策略造成的状态与轨迹中做结果驱动的概率重排。生产中更常见的关系是先 SFT 建立行为流形，再用 RL 探索，而不是二选一。本文归纳。*

## 7.3 症状决定优化方式

| 真实症状 | 首先应该优化什么 | 原因 |
|---|---|---|
| 不知道领域事实、术语或标准步骤 | 持续预训练或高质量 SFT | 需要直接写入目标内容，稀疏 reward 不适合承担知识注入 |
| 不会按格式输出、不会合法调用工具 | SFT | 示范给逐 Token 稠密信号，样本效率最高 |
| 已有固定 chosen/rejected 对，只需改善偏好 | DPO / IPO / KTO 等离线偏好优化 | 数据接口匹配，不必支付在线 rollout 与 critic 成本 |
| 数学、代码、结构化输出且验证器可靠 | SFT 打底后用 GRPO/RLOO；必要时 PPO | 结果可自动打分，同题多采样有自然 baseline |
| 多轮搜索、工具和机器人控制 | trajectory SFT + 在线 actor-critic / trajectory RL | 需要学习策略自己造成的状态和延迟回报 |
| reward 只能说“感觉更好” | 先改标注协议与评测 | 没有可信目标，换更强优化器只会更快过拟合 |

一个稳健的实验顺序通常是：

$$
\text{Base 评测}
\rightarrow\text{SFT}
\rightarrow\text{Best-of-}N/\text{Rejection Sampling}
\rightarrow\text{DPO}
\rightarrow\text{RLOO/GRPO}
\rightarrow\text{PPO/长程环境 RL}
$$

每次升级都应回答：前一个方法缺的是探索、负样本、信用分配，还是仅仅缺更好的数据？

# 八、从教学代码到真实训练系统

本文的代码展示目标函数，不是可直接扩展到集群的训练器。为核对工程边界，我固定检查了 [Hugging Face TRL 提交 `bb455b8`](https://github.com/huggingface/trl/tree/bb455b8f7a7af289e8fd3f507923209ccf815ea6)：

- [PPOTrainer](https://github.com/huggingface/trl/blob/bb455b8f7a7af289e8fd3f507923209ccf815ea6/trl/experimental/ppo/ppo_trainer.py) 位于 experimental 路径，显式维护 policy、reference、reward 和 value model；
- [DPOTrainer](https://github.com/huggingface/trl/blob/bb455b8f7a7af289e8fd3f507923209ccf815ea6/trl/trainer/dpo_trainer.py) 对 completion Token 单独做 mask，并允许预计算冻结 reference 的 log-prob，从而不必训练时常驻 reference；
- [GRPOTrainer](https://github.com/huggingface/trl/blob/bb455b8f7a7af289e8fd3f507923209ccf815ea6/trl/trainer/grpo_trainer.py) 区分 group/batch/none reward scaling、Token/序列级 importance sampling、不同 loss normalization，并处理截断样本、缺失奖励和 vLLM 生成—训练概率不一致。

这说明生产成本主要不在损失函数本身，而在 rollout、模型副本、KV cache、mask、分布式组统计和策略版本同步。

## 8.1 资源边界：哪些是公开事实，哪些没有披露

| 级别 | 可确认的公开条件 | 不能据此推出什么 |
|---|---|---|
| 机制验证 | 本文四段损失代码可在 CPU 小张量上运行 | 不能说明真实模型会收敛 |
| DPO 快速示例 | 固定 TRL 文档以 Qwen3-0.6B + UltraFeedback 演示 | 文档未给统一 GPU、显存和耗时，不能写成单卡性能结论 |
| GRPO 快速示例 | 固定 TRL 文档以 Qwen2.5-0.5B + DeepMath-103K 演示；8 GPU 约 1 天 | GPU 型号、单卡显存和完整吞吐口径未披露，不能换算通用成本 |
| 论文级 GRPO | DeepSeekMath 训练 7B 模型，并报告 120B 数学相关继续预训练 Token | 论文没有给出足以复现全部阶段成本的统一硬件账单 |
| 大模型 PPO | 至少要容纳或分片 policy、reference、reward、value 及 rollout 状态 | 参数量不能直接换算卡数；序列长度、精度、ZeRO/FSDP 与 KV cache 都会改变峰值显存 |

最低可运行配置不是“某张卡”，而是先缩小问题：小模型、短 completion、小 group、参数高效微调和可重复 verifier。推荐的可用配置则应把生成与训练资源分离或明确共置策略，并记录模型版本、精度、最大长度、group size、每设备 batch、梯度累积、生成引擎和 reward 各分项。

从研究 Demo 走向生产，还缺三类能力：

1. **评测隔离**：训练 verifier 与 holdout verifier 分开，防止针对固定测试集投机；
2. **数据闭环**：保留失败类型、环境版本和策略版本，支持回放与回滚；
3. **运行治理**：监控 KL、entropy、clip fraction、长度、零方差组、超时、安全违规和单位成功成本。

# 九、结论：算法演进就是不断改进“怎样相信一次结果”

回到开头那道只在最后得分的数学题，强化学习的演进可以重新读一遍：

- REINFORCE 证明终局结果也能给随机策略提供梯度；
- baseline、Actor-Critic 和 GAE 试图从结果里分离动作贡献；
- TRPO/PPO 约束更新幅度，避免策略在自己的非平稳数据上学崩；
- 奖励模型把人类比较变成可优化信号，DPO 又在固定偏好数据上省掉在线 RL；
- RLOO/GRPO 用同题多采样替代昂贵 critic，让可验证推理成为新的在线 RL 主场；
- Dr. GRPO、DAPO、GSPO 则提醒我们，归一化和聚合方式本身也会制造“看起来像能力”的偏差。

因此，大模型不是让强化学习从头发明了一遍，而是改变了各项成本的比例：策略变得极大，动作变成长序列，critic 变贵，rollout 变慢；与此同时，代码测试、数学验证器和工具环境又提供了过去难以获得的反馈。

最终选择仍然很朴素：**需要直接教会模型什么，就用 SFT；需要模型在自己的行为里根据结果做选择、探索和恢复，就用 RL；而在优化任何 reward 之前，先证明这个 reward 值得被优化。**
