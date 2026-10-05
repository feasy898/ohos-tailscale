#!/usr/bin/env python3
"""按族选取代表性会话（信号最强：模型调用多 / 有失败 / 任务典型）。"""
import sqlite3, json, os

DB = r'C:/Users/Administrator/.zcode/cli/db/db.sqlite'
con = sqlite3.connect(DB)
cur = con.cursor()

# (会话id获取SQL条件, 取几个, 标签)
picks = [
    ("directory like '%ohos-tailscale%'", 2, 'ohos-tailscale'),
    ("directory like '%local-plane%' and title like '%planner%'", 1, 'local-plane-planner'),
    ("directory like '%local-plane%' and title like '%worker%'", 1, 'local-plane-worker'),
    ("directory like '%local-plane%' and title like '%merger%'", 1, 'local-plane-merger'),
    ("directory like '%chenmai-bean-eye%'", 2, 'bean-eye-vision'),
    ("directory like '%开源贡献%'", 2, 'opensource'),
    ("directory like '%fwcmp%' and title like '%测试子代理%'", 1, 'fwcmp-test'),
    ("directory like '%专业软件们研究%'", 1, 'prosoft'),
    ("directory like '%可玩广告%'", 1, 'playableads'),
    ("directory like '%factory-board%'", 1, 'factory-board'),
    ("directory like '%一剧N国%' and title like '%基线盘点%'", 1, 'drama-baseline'),
    ("directory like '%政务AI安全%'", 1, 'gov-ai-sec'),
    ("directory like '%配电agent%'", 1, 'peidian'),
    ("directory like '%全面迁移%' and title like '%srv-1%'", 1, 'srv1-migration'),
    ("title like '%排查zcode用量%'", 1, 'incident-zcode-usage'),
    ("title like '%GPU开发机%'", 1, 'incident-ssh'),
    ("directory like '%协作研究%' and title like '%一人软件公司%'", 1, 'collab-research'),
    ("title like '%查询Higress%'", 1, 'higress-proxy'),
    ("directory like '%学情agent%'", 1, 'xueqing'),
    ("directory like '%agentcore%' or directory like '%agent-asset%'", 2, 'agentcore'),
]

selected = []
for cond, n, label in picks:
    rows = cur.execute(f'''
        select s.id, s.title, s.time_created,
               (select count(*) from message m where m.session_id=s.id) msgs,
               (select count(*) from model_usage mu where mu.session_id=s.id) calls,
               (select sum(case when mu2.status!='completed' then 1 else 0 end) from model_usage mu2 where mu2.session_id=s.id) fails
        from session s
        where s.time_created >= 1790611200000 and s.time_archived is null
          and s.id not like 'sess_dwf-%' and {cond}
        order by (calls) desc limit {n}
    ''').fetchall()
    for r in rows:
        selected.append({'label': label, 'id': r[0], 'title': (r[1] or '')[:100],
                         'msgs': r[2+0+2], 'calls': r[4], 'fails': r[5] if r[5] is not None else 0})
        print(f"{label:<22} msgs={r[3]:>4} calls={r[4]:>4} fails={r[5]} {r[0]} | {(r[1] or '')[:60]}")

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'selected.json'), 'w', encoding='utf-8') as f:
    json.dump(selected, f, ensure_ascii=False, indent=1)
print(f"\n共选中 {len(selected)} 个会话")
