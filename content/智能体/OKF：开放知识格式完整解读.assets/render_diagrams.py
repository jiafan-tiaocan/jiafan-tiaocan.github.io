"""Editable source for the four article diagrams. Python standard library only."""
from html import escape
from pathlib import Path

OUT = Path(__file__).parent
INK, GREEN, ORANGE = '#243c36', '#2f6657', '#a35432'

def text(x, y, value, size=18, color=INK, weight=400, anchor='middle'):
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" font-weight="{weight}" fill="{color}">{escape(value)}</text>'

def box(x,y,w,h,title,detail='',kind='normal'):
    fill, stroke = {'normal':('#ffffff','#c9d6ce'),'green':('#e8f1ea',GREEN),'orange':('#fbefe6',ORANGE)}[kind]
    content=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{stroke}"/>'
    content+=text(x+w/2,y+(h/2+6 if not detail else 28),title,19,weight=600)
    if detail: content+=text(x+w/2,y+51,detail,16)
    return content

def line(points, dashed=False):
    return f'<path d="{points}" fill="none" stroke="{GREEN}" stroke-width="2" marker-end="url(#arrow)"'+(' stroke-dasharray="5 4"' if dashed else '')+'/>'

def save(name,title,height,body):
    svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="560" height="{height}" viewBox="0 0 560 {height}" role="img" aria-label="{escape(title)}">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="{GREEN}"/></marker></defs>
<rect width="560" height="{height}" rx="14" fill="#f7f5ef"/>
<g font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif">{text(24,32,title,20,weight=600,anchor='start')}{body}</g></svg>'''
    (OUT/name).write_text(svg,encoding='utf-8')

save('01-case-route.svg','280 元：每一层提供不同依据',382,
    box(24,60,246,70,'原始记录','100 + 200；退款 20')+
    box(290,60,246,70,'业务政策','排除取消订单；确认退款')+
    line('M147 130V151H280V175')+line('M413 130V151H280')+
    box(64,177,432,72,'OKF 知识','定义 · 来源 · 复核 · 时效','green')+
    line('M280 249V284')+
    box(64,286,432,65,'消费者给出本次回答','按认可计算执行并核对：280 元'))

save('02-concept-links.svg','目录收纳，链接连接知识',378,
    box(156,61,248,70,'净收入 · Metric','metrics/net-revenue')+
    line('M195 131V173H143V208')+line('M365 131V173H417V208')+
    text(135,162,'遵循口径',16)+text(423,162,'生成数值',16)+
    box(24,210,238,67,'收入政策','Policy')+
    box(298,210,238,67,'净收入计算','Attested Computation','green')+
    line('M280 131V316')+
    box(130,318,300,42,'订单表与退款表')+
    text(291,299,'取数依据',16,anchor='start'))

save('03-attestation.svg','一次计算：定义与运行证据分开',450,
    box(32,58,496,65,'认可的计算 + 声明的参数','存于知识 Bundle','green')+
    line('M280 123V153')+
    box(32,155,496,62,'Executor 执行并生成 receipt','回执与运行记录位于 Bundle 外')+
    line('M280 217V247')+
    box(32,249,496,72,'Attester 独立核对','认可版本 · 参数 · 运行记录 · 展示值','green')+
    line('M528 90H544V285H529',True)+
    line('M280 321V350')+
    box(32,352,496,56,'通过才展示；失败返回原因',kind='orange')+
    text(280,432,'定义过期仍需由消费策略另外判断',16))

save('04-publish-consume.svg','接入现有系统：选择性投影',436,
    box(42,60,476,60,'现有知识源','文档 · 数据库 · 代码 · 审核记录')+
    line('M280 120V151')+
    box(42,153,476,62,'选择、映射与验证','权限范围 · 类型 · 来源 · 链接')+
    line('M280 215V246')+
    box(42,248,476,62,'可追溯的 OKF 快照','跨工具共享，可由源重新生成','green')+
    line('M280 310V341')+
    box(42,343,476,64,'Agent 消费策略','判断当前任务如何使用知识','orange'))

print('Rendered 4 SVG diagrams at 560 px width; minimum font 16 px.')
