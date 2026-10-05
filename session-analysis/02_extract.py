#!/usr/bin/env python3
"""把代表性会话的完整轨迹导出为可读文本（供子代理分析）。"""
import sqlite3, json, os, sys, datetime

DB = r'C:/Users/Administrator/.zcode/cli/db/db.sqlite'
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'trajectories')
os.makedirs(OUT_DIR, exist_ok=True)
LOCAL_TZ = datetime.timezone(datetime.timedelta(hours=8))

con = sqlite3.connect(DB)
cur = con.cursor()

def fmt(ms):
    if not ms:
        return ''
    return datetime.datetime.fromtimestamp(ms / 1000, tz=LOCAL_TZ).strftime('%m-%d %H:%M')

def clip(s, n):
    s = s or ''
    s = ' '.join(s.split())
    return s[:n] + ('…[截断]' if len(s) > n else '')

def extract(sid, budget=140000):
    meta = cur.execute('select title, directory, time_created, time_updated from session where id=?', (sid,)).fetchone()
    title, directory, tc, tu = meta
    parts = cur.execute('''
        select p.data, p.time_created from part p where p.session_id=? order by p.sequence
    ''', (sid,)).fetchall()
    out = []
    out.append(f"# SESSION {sid}")
    out.append(f"title: {clip(title, 200)}")
    out.append(f"dir: {directory}")
    out.append(f"time: {fmt(tc)} -> {fmt(tu)} | parts: {len(parts)}")
    out.append("=" * 80)
    used = 0
    for (pdata, ptime) in parts:
        d = json.loads(pdata)
        t = d.get('type')
        if t == 'text':
            role = d.get('role', '')
            txt = d.get('text', '')
            # 区分用户输入与助手输出：用户 part 通常带 role=user 或紧跟 user 消息
            line = f"\n[TEXT @{fmt(ptime)}] {clip(txt, 1500)}"
            out.append(line); used += len(line)
        elif t == 'reasoning':
            pass  # 推理略去，保留文本与工具即可
        elif t == 'tool':
            st = d.get('state', {})
            status = st.get('status', '?')
            tool = d.get('tool', '?')
            inp = json.dumps(st.get('input', {}), ensure_ascii=False)
            outp = st.get('output', '') or ''
            if not isinstance(outp, str):
                outp = json.dumps(outp, ensure_ascii=False)
            line = (f"\n[TOOL {tool} {status}] in: {clip(inp, 220)}\n"
                    f"  out: {clip(outp, 280)}")
            out.append(line); used += len(line)
        if used > budget:
            out.append("\n…[达到预算上限，轨迹截断]")
            break
    return title, '\n'.join(out)

if __name__ == '__main__':
    sids = sys.argv[1:]
    for sid in sids:
        title, text = extract(sid)
        fn = os.path.join(OUT_DIR, sid.replace('sess_', '') + '.txt')
        with open(fn, 'w', encoding='utf-8') as f:
            f.write(text)
        print(f"{sid} -> {fn} ({len(text)} chars) | {clip(title, 60)}")
