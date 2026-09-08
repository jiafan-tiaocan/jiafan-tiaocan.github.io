"""Editable source for chapter 10's role map; uses Python standard library only."""
from html import escape
from pathlib import Path

OUT = Path(__file__).with_name('05-knowledge-relationships.svg')
INK, GREEN, MUTED = '#243c36', '#2f6657', '#53695f'
def text(x, y, value, size=16, weight=400, anchor='middle', fill=INK):
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" font-weight="{weight}" fill="{fill}">{escape(value)}</text>'
def box(x,y,w,h,title,detail='',fill='#fff'):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="{fill}" stroke="#bdcfc3"/>'
        + text(x+w/2,y+(27 if detail else h/2+6),title,19,600)
        + (text(x+w/2,y+49,detail,14,fill=MUTED) if detail else ''))
def arrow(d,dashed=False,both=False):
    return (f'<path d="{d}" fill="none" stroke="{GREEN}" stroke-width="1.8" marker-end="url(#arrow)"'
        + (' marker-start="url(#arrow)"' if both else '')
        + (' stroke-dasharray="5 4"' if dashed else '') + '/>')

body = f'<rect width="560" height="468" rx="14" fill="#f7f5ef"/><rect x="8" y="8" width="544" height="450" rx="12" fill="none" stroke="#93ad9c"/>'
body += text(24,36,'知识管理：贯穿来源、版本、复核与更新',18,600,'start')
body += box(150,64,260,58,'本体','概念、关系与约束','#e8f1ea')
body += arrow('M240 122V140H133V162',True)+arrow('M320 122V140H427V162',True)
body += text(280,150,'可采用语义约束',14)
body += box(32,164,202,66,'OKF','文件约定 · 来源与时效')
body += box(326,164,202,66,'知识图谱','实体与关系的显式表达')
body += text(280,188,'可映射',14)+arrow('M242 205H318',True,True)
body += arrow('M133 230V267')+arrow('M427 230V267')
body += box(32,269,496,58,'知识检索','围绕当前问题选取证据','#e8f1ea')
body += arrow('M127 327V379')+text(179,355,'本轮证据',14)
body += arrow('M427 374V328')+text(477,355,'召回经验',14)
body += box(32,381,190,54,'Agent 当前任务',fill='#fff')
body += box(324,376,204,66,'Agent 记忆系统','状态、事实与经历','#fbefe6')
body += text(273,396,'记录经历',14)+arrow('M223 413H322')

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="560" height="468" viewBox="0 0 560 468" role="img" aria-labelledby="title desc">
<title id="title">OKF、本体、知识管理、知识检索、知识图谱和记忆系统的协作关系</title>
<desc id="desc">知识管理表示贯穿各部分的治理职责。本体可约束文件和图的语义；OKF与知识图谱可按需建立映射。检索从知识表达和记忆中选取本轮证据，Agent把经历写回记忆。经历转成共享规则仍须治理，不存在自动真值升级。</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="{GREEN}"/></marker></defs>
<g font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif">{body}</g>
</svg>'''
OUT.write_text(svg, encoding='utf-8')
print(OUT.name)
