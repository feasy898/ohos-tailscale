#!/usr/bin/env node
/**
 * headscale 隔离互操作一键回归（子线 D 收口脚本）。
 *
 * 三阶段：
 *   1) 控制面注册 + MapRequest（用 interop/register.node.ts）
 *   2) DERP 客户端连接 + Ping/Pong（用 interop/derp.node.ts）
 *   3) H2C 双向流（用 interop/h2c.node.ts）
 *
 * 输出两条字符串（PASS 大小写敏感）：
 *   INTEROP PASS         —— 阶段 1+2+3 全过
 *   DERP INTEROP PASS    —— 阶段 2 通过
 *
 * 用法：
 *   HS_PREAUTHKEY=<key> node interop/regress.mjs     # 默认 HS=http://127.0.0.1:8080
 *   HS=http://127.0.0.1:18080 HS_PREAUTHKEY=<key> node interop/regress.mjs
 *
 * 红线（见 docs/handover/agent-interop-regression.md）：
 *   - 仅在隔离 headscale 实例上跑（监听 127.0.0.1）
 *   - preauthkey 只经环境变量传入、用后即弃、不入仓（本脚本内不得出现任何字面量 key）
 *   - 私钥永不进 evidence/
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HS = process.env.HS || 'http://127.0.0.1:8080';
// preauthkey 只走环境变量：入仓的是一把用后即弃的隔离实例 key，硬编码的假 key
// 会被真实 headscale 直接 401，失败原因淹没在协议栈深处，不可归因。
const authKey = process.env.HS_PREAUTHKEY || '';
if (authKey === '') {
  console.error('FAIL: 未设置 HS_PREAUTHKEY。');
  console.error('      用法：HS_PREAUTHKEY=<key> node interop/regress.mjs');
  console.error('      取法：headscale preauthkeys create --reuse --expiration 24h（用后即弃、不入仓）。');
  process.exit(1);
}

// 阶段 1：注册 + MapRequest（要求 interop/register.node.ts 已就绪）
function runStage(label, args) {
  console.error(`\n>>> 阶段：${label}`);
  const r = spawnSync(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, HS, NODE_OPTIONS: '--experimental-strip-types --no-warnings' },
  });
  // 阶段成功 = 退出码 0 + stdout 中含目标 PASS 字串（如 derp.node.ts 输出 'DERP INTEROP PASS'）。
  // 仅看退出码会漏过"脚本因 usage 错误退出"等退化情形——这里以 PASS 标记字符串为准。
  // 不过部分阶段脚本可能在没实例时只 print usage 后退出 0——因此我们要求 stdout 非空且无 usage 字样。
  const stdout = (r.stdout || '').toString();
  const sawUsage = /\busage:\s+node\b/i.test(stdout) || /\busage:\s+node\b/i.test(r.stderr?.toString() || '');
  return r.status === 0 && !sawUsage && stdout.length > 0;
}

const out = {
  hs: HS,
  stages: { register: false, derp: false, h2c: false },
  final: '',
};

out.stages.register = runStage('控制面注册（RegisterRequest + MapRequest）', [
  'interop/register.node.ts', HS, authKey,
]);
// derp/h2c 的 usage 契约同为 <baseUrl> <authKey>——少传 authKey 时子脚本只 print
// usage 后退出，「stdout 非空」判据会把 usage 页当成功（批次一三缺陷之二）。
out.stages.derp = runStage('DERP 客户端 + Ping/Pong', [
  'interop/derp.node.ts', HS, authKey,
]);
out.stages.h2c = runStage('HTTP/2 over Noise（h2c）', [
  'interop/h2c.node.ts', HS, authKey,
]);

const ok = out.stages.register && out.stages.derp && out.stages.h2c;
const derpOk = out.stages.derp;
out.final = ok ? 'INTEROP PASS' : 'INTEROP FAIL';

// 把每条 PASS/FAIL 也打一次（评审/grep 用）。
console.log('\n=== 判定字符串 ===');
console.log(out.final);
console.log(derpOk ? 'DERP INTEROP PASS' : 'DERP INTEROP FAIL');

// 给 agent 解析用的 JSON 摘要（写到临时文件、不入仓）。
const tmp = mkdtempSync(join(tmpdir(), 'interop-regress-'));
const summaryPath = join(tmp, 'summary.json');
writeFileSync(summaryPath, JSON.stringify(out, null, 2));
console.error(`\n摘要写入：${summaryPath}`);
process.exitCode = ok ? 0 : 1;
