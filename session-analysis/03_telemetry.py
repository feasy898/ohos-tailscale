#!/usr/bin/env python3
"""全局 + local-plane 族遥测聚合：失败模式、工具错误率、重试、上下文超限。"""
import sqlite3, json, os, datetime

DB = r'C:/Users/Administrator/.zcode/cli/db/db.sqlite'
OUT = os.path.dirname(os.path.abspath(__file__))
con = sqlite3.connect(DB)
cur = con.cursor()
CUTOFF = 1790611200000  # 2026-09-30 00:00 UTC+8

rep = {}

# 1) 模型请求失败聚合
rows = cur.execute('''
    select status, error_type, count(*), sum(retry_count), sum(case when context_exceeded then 1 else 0 end)
    from model_usage where started_at >= ?
    group by status, error_type order by count(*) desc
''', (CUTOFF,)).fetchall()
rep['model_status'] = [
    {'status': r[0], 'error_type': r[1], 'n': r[2], 'retries': r[3], 'ctx_exceeded': r[4]} for r in rows]

# 2) 失败请求的错误类型 top
rows = cur.execute('''
    select error_type, error_code, substr(coalesce(error_message,''),1,160), count(*)
    from model_usage where started_at >= ? and status != 'completed'
    group by error_type, error_code, substr(coalesce(error_message,''),1,160)
    order by count(*) desc limit 15
''', (CUTOFF,)).fetchall()
rep['model_errors'] = [
    {'error_type': r[0], 'error_code': r[1], 'msg': r[2], 'n': r[3]} for r in rows]

# 3) 工具错误率 by tool
rows = cur.execute('''
    select tool_name, count(*), sum(case when status!='completed' then 1 else 0 end),
           sum(retry_count), avg(duration_ms), sum(case when exit_code not in (0) then 1 else 0 end)
    from tool_usage where started_at >= ?
    group by tool_name order by count(*) desc limit 25
''', (CUTOFF,)).fetchall()
rep['tool_stats'] = [
    {'tool': r[0], 'calls': r[1], 'fails': r[2], 'retries': r[3],
     'avg_ms': round(r[4] or 0), 'nonzero_exit': r[5]} for r in rows]

# 4) local-plane 三角色运行统计（cron 每30分钟一族）
rows = cur.execute('''
    select s.title, count(distinct s.id),
           sum(case when mu.status!='completed' then 1 else 0 end),
           sum(mu.duration_ms)/1000.0, sum(mu.output_tokens)
    from session s join model_usage mu on mu.session_id = s.id
    where s.time_created >= ? and s.directory like '%local-plane%'
    group by case when s.title like '%planner%' then 'planner'
                  when s.title like '%worker%' then 'worker'
                  when s.title like '%merger%' then 'merger' else 'other' end
''', (CUTOFF,)).fetchall()
rep['local_plane_roles'] = [dict(zip(['role_sessions_hint','sessions','model_fails','total_model_sec','out_tokens'], r)) for r in rows]

# 5) local-plane 按角色（修正版）
rows = cur.execute('''
    select case when s.title like '%planner%' then 'planner'
                when s.title like '%worker%' then 'worker'
                when s.title like '%merger%' then 'merger' else 'other' end role,
           count(distinct s.id),
           sum(case when mu.status!='completed' then 1 else 0 end),
           round(sum(mu.duration_ms)/60000.0),
           sum(mu.output_tokens)
    from session s join model_usage mu on mu.session_id = s.id
    where s.time_created >= ? and s.directory like '%local-plane%'
    group by 1
''', (CUTOFF,)).fetchall()
rep['local_plane_roles'] = [
    {'role': r[0], 'sessions': r[1], 'model_fails': r[2], 'model_min': r[3], 'out_tokens': r[4]} for r in rows]

# 6) workflow 运行面
rows = cur.execute('''
    select status, count(*), round(sum(spent_tokens)/1e6, 1)
    from dwf_run where time_created >= ? group by status
''', (CUTOFF,)).fetchall()
rep['dwf_runs'] = [{'status': r[0], 'n': r[1], 'spent_Mtok': r[2]} for r in rows]

# 7) local-plane 工具失败 top（他们最容易踩的坑）
rows = cur.execute('''
    select tu.tool_name, tu.error_type, substr(coalesce(tu.error_message,''),1,140), count(*)
    from tool_usage tu join session s on s.id = tu.session_id
    where tu.started_at >= ? and s.directory like '%local-plane%' and tu.status != 'completed'
    group by 1,2,3 order by count(*) desc limit 12
''', (CUTOFF,)).fetchall()
rep['local_plane_tool_errors'] = [
    {'tool': r[0], 'error_type': r[1], 'msg': r[2], 'n': r[3]} for r in rows]

with open(os.path.join(OUT, 'telemetry.json'), 'w', encoding='utf-8') as f:
    json.dump(rep, f, ensure_ascii=False, indent=1)
print(json.dumps(rep, ensure_ascii=False, indent=1)[:4000])
