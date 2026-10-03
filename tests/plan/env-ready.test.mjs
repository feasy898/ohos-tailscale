// 用途：env-ready 校验器验收（TESTS-2026-10-03，TESTS.md §4.3）。
// T-ENV-a/b/c 现在就该绿：对自带 lib/env-ready-validator.mjs 的机制演练——S4→S5 的门在本机可全真演练
// （构造全绿/缺键/坏值样本，断言放行/拦截/拦截——「人做没做」= JSON 里有没有真值+证据+时间戳三元组，机制的证明不需要人）。
// T-ENV-d 是 TDD 红锚：docs/pre-device/env-ready.schema.json 为 P1-12 落地物。
// 诚实边界：本校验器防「漏填」不防「填假」（R1 残余风险）——写进 TESTS.md，不假装关掉。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSchemaShape, validateEnvReady } from './lib/env-ready-validator.mjs';
import { readRepo, repoPathExists } from './lib/spawn.mjs';

const SCHEMA = {
  's0.sn_visible': { type: 'boolean', why: 'S0 判据：hdc list targets 见 SN' },
  's4.signing_mode': { type: 'string', enum: ['auto', 'p12', 'unsigned'], why: 'D6：自动签名优先/p12 退路/未签名仅 S3' },
  's6.headscale_lan_addr': { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+\\.\\d+$', why: 'O3 豁免的设备侧 server_url（LAN 地址，非 127.0.0.1）' },
};

const triple = (value, evidence = 'hdc list targets 输出原文', at = '2026-10-03T14:00+08:00') => ({ value, evidence, at });

test('T-ENV-a 合法样本全绿放行——现在就该绿', () => {
  const errs = validateEnvReady({
    's0.sn_visible': triple(true),
    's4.signing_mode': triple('auto', 'DevEco 签名配置截图路径 + 生成记录'),
    's6.headscale_lan_addr': triple('192.168.1.10', '开发机 ipconfig 输出原文'),
  }, SCHEMA);
  assert.deepEqual(errs, [], `合法 env-ready 必须放行（否则 S4→S5 门自锁）。实测：${errs.join(' / ')}`);
  assert.deepEqual(checkSchemaShape(SCHEMA), []);
});

test('T-ENV-b 缺键报键名与 why（把解释自动带给人）——现在就该绿', () => {
  const errs = validateEnvReady({ 's0.sn_visible': triple(true) }, SCHEMA);
  assert.equal(errs.length, 2, `缺 2 键应报 2 条。实测：${errs.join(' | ')}`);
  assert.ok(errs.every((e) => /s4\.signing_mode|s6\.headscale_lan_addr/.test(e)), '错误必须点名缺失键');
  assert.ok(errs.some((e) => e.includes('自动签名')), '错误信息必须带 schema 的 why（解释带给人）');
});

test('T-ENV-c 坏值/空证据/坏时间戳/枚举外逐类拦截——现在就该绿', () => {
  const cases = [
    { obj: { 's0.sn_visible': triple('yes') }, match: /须为 boolean/ },
    { obj: { 's4.signing_mode': triple('magic') }, match: /不在枚举/ },
    { obj: { 's6.headscale_lan_addr': triple('headscale.local') }, match: /不匹配 pattern/ },
    { obj: { 's0.sn_visible': { value: true, evidence: '  ', at: '2026-10-03T14:00' } }, match: /缺非空 evidence/ },
    { obj: { 's0.sn_visible': { value: true, evidence: 'ok', at: 'yesterday' } }, match: /时间戳/ },
  ];
  for (const c of cases) {
    const errs = validateEnvReady(c.obj, SCHEMA);
    assert.ok(errs.length >= 1 && c.match.test(errs.join('\n')), `样本 ${JSON.stringify(c.obj).slice(0, 60)} 必须按类别拦截（实测：${errs.join(' / ')}）`);
  }
});

test('T-ENV-d docs/pre-device/env-ready.schema.json 在盘且过 schema 形状校验——TDD 红锚（P1-12 落地物）', () => {
  assert.ok(repoPathExists('docs/pre-device/env-ready.schema.json'), 'env-ready.schema.json 必须存在（A15 七件套之一）');
  const schema = JSON.parse(readRepo('docs/pre-device/env-ready.schema.json'));
  const errs = checkSchemaShape(schema);
  assert.deepEqual(errs, [], `schema 键清单形状必须合法。实测：${errs.join(' / ')}`);
  for (const key of Object.keys(schema)) {
    assert.ok(/^s\d/.test(key) || /sign|sn|vpn|headscale|preauth|peer/i.test(key), `键 ${key} 应可追溯到剧本阶段或 PLAN §1.2 六项确认点`);
  }
});
