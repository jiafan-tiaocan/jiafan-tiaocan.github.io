"""Editable, example-led role map for chapter 10; Python standard library only."""
from html import escape
from pathlib import Path

OUT = Path(__file__).with_name('05-knowledge-relationships.svg')
INK, GREEN, MUTED = '#243c36', '#2f6657', '#53695f'

def text(x, y, value, size=14, weight=400, anchor='start', fill=INK):
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" font-weight="{weight}" fill="{fill}">{escape(value)}</text>'

def rect(x, y, w, h, fill='#fff'):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="#bdcfc3"/>'

def arrow(d, dashed=False, both=False):
    return (f'<path d="{d}" fill="none" stroke="{GREEN}" stroke-width="1.7" marker-end="url(#arrow)"'
        + (' marker-start="url(#arrow)"' if both else '')
        + (' stroke-dasharray="4 3"' if dashed else '') + '/>')

body = '<rect width="560" height="468" rx="14" fill="#f7f5ef"/>'
body += text(20, 28, '9 月线上净收入：同一案例，六种职责', 18, 600)
body += '<rect x="8" y="42" width="544" height="418" rx="10" fill="none" stroke="#93ad9c"/>'
body += text(22, 66, '知识管理｜复核 P1：退款按发生月扣减', 16, 600)

body += rect(24, 82, 512, 54, '#e8f1ea')
body += text(36, 103, '本体｜先定义对象与关系', 16, 600)
body += text(36, 124, '退款事件关联订单；退款发生月与业务归属月是不同属性')
body += arrow('M139 136V152', True) + arrow('M421 136V152', True)

body += rect(24, 154, 230, 98)
body += text(36, 176, 'OKF｜交付知识文件', 16, 600)
body += text(36, 197, 'metrics/net-revenue.md')
body += text(36, 218, '链接政策 P1 与计算文件')
body += text(36, 239, '保存口径、来源、复核记录')

body += rect(306, 154, 230, 98)
body += text(318, 176, '知识图谱｜连接具体对象', 16, 600)
body += text(318, 197, '退款 R：20 元，confirmed')
body += arrow('M328 202V225')
body += text(340, 218, '关联订单')
body += text(318, 242, '订单 B：200 元，paid，线上')
body += arrow('M139 252V277') + arrow('M421 252V277')
body += text(280, 270, '读取定义与关系', anchor='middle', fill=MUTED)

body += rect(24, 279, 512, 58, '#e8f1ea')
body += text(36, 301, '知识检索｜问题：9 月线上净收入？', 16, 600)
body += text(36, 324, '取齐：P1 口径、计算入口、订单与退款表定义')
body += arrow('M139 337V370')
body += text(157, 359, '本轮依据', fill=MUTED)
body += arrow('M449 370V339')
body += text(466, 359, '下次召回', fill=MUTED)

body += rect(24, 372, 232, 78)
body += text(36, 394, 'Agent｜读取数据并执行', 16, 600)
body += text(36, 416, '核验：100 + 200 − 20 = 280')
body += text(36, 438, '取消 50 不计；结果附执行依据')

body += rect(322, 372, 214, 78, '#fbefe6')
body += text(334, 394, '记忆系统｜保留这次经历', 16, 600)
body += text(334, 416, '记住：9 月线上 280 元')
body += text(334, 438, '连同 P1 与本次执行依据')
body += text(289, 398, '写入', anchor='middle')
body += arrow('M258 416H320')

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="560" height="468" viewBox="0 0 560 468" role="img" aria-labelledby="title desc">
<title id="title">用 9 月线上净收入 280 元的教学案例解释六种知识职责</title>
<desc id="desc">教学政策 P1 将符合条件的退款按发生月扣减。知识管理复核该口径，本体区分退款发生月与业务归属月。OKF 用 metrics/net-revenue.md 链接政策与计算文件，图谱记录退款 R 关联订单 B 的关系。检索取齐口径、计算入口和表定义；Agent 读取数据、执行并核验 100 加 200 减 20 得 280，取消订单的 50 元不计。记忆保留范围、政策及执行依据供下次按需召回。虚线表示可选语义约束，并非必须部署的流水线；旧结果不能替代下次的口径与数据核验。</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="{GREEN}"/></marker></defs>
<g font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif">{body}</g>
</svg>'''
OUT.write_text(svg, encoding='utf-8')
print(OUT.name)
