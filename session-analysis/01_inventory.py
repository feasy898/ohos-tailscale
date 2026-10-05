#!/usr/bin/env python3
"""盘点过去5天的会话清单 + 基础遥测聚合。"""
import sqlite3, json, datetime, os

DB = r'C:/Users/Administrator/.zcode/cli/db/db.sqlite'
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_TZ = datetime.timezone(datetime.timedelta(hours=8))

con = sqlite3.connect(DB)
cur = con.cursor()

now_ms = 1791112963584  # 最新会话时间（约 2026-10-04）
# 过去5天：2026-09-30 00:00 本地时间（UTC+8）= 2026-09-29T16:00Z
cutoff_dt = datetime.datetime(2026, 9, 30, 0, 0, 0, tzinfo=LOCAL_TZ)
cutoff_ms = int(cutoff_dt.timestamp() * 1000)

def fmt(ms):
    if not ms:
        return ''
    return datetime.datetime.fromtimestamp(ms / 1000, tz=LOCAL_TZ).strftime('%m-%d %H:%M')

sessions = cur.execute('''
    select s.id, s.title, s.directory, s.task_type, s.time_created, s.time_updated,
           s.parent_id, s.version
    from session s
    where s.time_created >= ? and s.time_archived is null
    order by s.time_created
''', (cutoff_ms,)).fetchall()

# 交互式主会话 = 非 workflow actor 的会话
main_sessions = [s for s in sessions if not s[0].startswith('sess_dwf-')]
actor_sessions = [s for s in sessions if s[0].startswith('sess_dwf-')]
print(f"窗口内总会话: {len(sessions)} | 主会话(交互式): {len(main_sessions)} | workflow actor: {len(actor_sessions)}")

report = []
for s in main_sessions:
    sid, title, directory, task_type, tc, tu, parent, version = s
    # 消息数
    msg_n = cur.execute('select count(*) from message where session_id=?', (sid,)).fetchone()[0]
    # 用户消息样本（用于还原任务）
    user_msgs = cur.execute('''
        select m.data from message m where m.session_id=? order by m.time_created limit 200
    ''', (sid,)).fetchall()
    # 模型用量
    mu = cur.execute('''
        select count(*), sum(coalesce(m.duration_ms,0)), sum(coalesce(m.input_tokens,0)), sum(coalesce(m.output_tokens,0)),
               sum(case when m.status!='completed' then 1 else 0 end)
        from model_usage m where m.session_id=?
    ''', (sid,)).fetchone()
    # 工具用量 top
    tools = cur.execute('''
        select tool_name, count(*), sum(case when status!='completed' then 1 else 0 end)
        from tool_usage where session_id=? group by tool_name order by count(*) desc limit 8
    ''', (sid,)).fetchall()
    report.append({
        'id': sid, 'title': (title or '')[:120], 'directory': directory,
        'task_type': task_type, 'created': fmt(tc), 'updated': fmt(tu),
        'messages': msg_n, 'model_calls': mu[0], 'model_ms': mu[1],
        'in_tokens': mu[2], 'out_tokens': mu[3], 'model_fail': mu[4],
        'tools': [{'name': t[0], 'calls': t[1], 'fails': t[2]} for t in tools],
    })

with open(os.path.join(OUT_DIR, 'session_inventory.json'), 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=1)

print(f"\n主会话明细 ({len(report)}):")
for r in report:
    print(f"- [{r['created']}] msgs={r['messages']:>4} calls={r['model_calls']:>4} "
          f"tok={r['in_tokens']}/{r['out_tokens']} fail={r['model_fail']} "
          f"dir={((r['directory'] or '').replace(chr(92),'/').split('/')[-1] or '?')[:28]:<28} "
          f"| {(r['title'] or '(无标题)')[:70]}")
