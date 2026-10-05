// 用途：P0-6 交接包 v1 的存在性与三处修复红锚（TESTS-2026-10-03，TESTS.md §1 矩阵行 P0-6）。
// docs/pre-device/ 现不存在（亲验）——全部为 TDD 红锚。A15 七件套存在性 + check-stage-docs 门
// + HARMONY_AGENT_TASK 废弃指向 + owner-with-real-device 三处修复（:47 裸 vpn 模块名 / :60 假 hvigorw / Day1 缺 typecheck:bridge）
// + S5b「随机字节快照落 evidence」步骤存在性（D13 复现包机制不断链——TESTS.md 修订建议 R4）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, readRepo, repoPathExists } from './lib/spawn.mjs';

const PRE_DEVICE_FILES = [
  'AGENT-TASK.md', 'STAGE-CHECKLIST.md', 'DECISIONS.md',
  'OWNER-GUIDE.md', 'CU-CARDS.md', 'EVIDENCE-SPEC.md', 'env-ready.schema.json',
];

test('T-P0-6-a A15 存在性：docs/pre-device/ 七件套齐备（JSON 可解析）——TDD 红锚', () => {
  const missing = PRE_DEVICE_FILES.filter((f) => !repoPathExists(`docs/pre-device/${f}`));
  assert.deepEqual(missing, [], `docs/pre-device/ 下缺：${missing.join('、')}（A15 判据——现全部不存在，P0-6 建）`);
  if (repoPathExists('docs/pre-device/env-ready.schema.json')) {
    assert.doesNotThrow(() => JSON.parse(readRepo('docs/pre-device/env-ready.schema.json')), 'env-ready.schema.json 必须可 JSON.parse');
  }
});

test('T-P0-6-b scripts/check-stage-docs.mjs 在盘且 exit 0——TDD 红锚', { timeout: 60000 }, () => {
  assert.ok(repoPathExists('scripts/check-stage-docs.mjs'), 'check-stage-docs.mjs 必须存在（A11 剧本自检门）');
  const r = run('node', ['scripts/check-stage-docs.mjs'], { timeoutMs: 55000 });
  assert.equal(r.status, 0, `check-stage-docs 应 exit 0（标签差集空 + 旧数字 0 命中 + CU 卡无空占位）。实测 ${r.status}：\n${(r.stdout + r.stderr).slice(-300)}`);
});

test('T-P0-6-c HARMONY_AGENT_TASK.md 顶部有废弃指向——TDD 红锚', () => {
  const head = readRepo('HARMONY_AGENT_TASK.md').split(/\r?\n/).slice(0, 8).join('\n');
  assert.ok(/AGENT-TASK\.md|废弃/.test(head), '顶部必须加一行废弃指向（指向 docs/pre-device/AGENT-TASK.md）——旧任务书含 4 处毒数据，继续被当说明书用会误导');
});

test('T-P0-6-d owner-with-real-device.md 三处修复（裸 vpn 模块名/假 hvigorw/Day1 补 typecheck:bridge）——TDD 红锚', () => {
  const doc = readRepo('docs/handover/owner-with-real-device.md');
  assert.ok(!/@ohos\.net\.vpn(?!Extension)/.test(doc), ':47 裸 @ohos.net.vpn 必须改为 @ohos.net.vpnExtension（边界断言防误杀正确全名）');
  assert.ok(!/hvigorw assembleHap/.test(doc), ':60 假命令 hvigorw assembleHap 必须移除（正确：DevEco Build>Build HAP(s) 或 hvigor assembleHap 无 w）');
  assert.ok(/typecheck:bridge/.test(doc), 'Day1 基线命令必须补 typecheck:bridge（已渗进交接契约的漏项）');
});

test('T-P0-6-e STAGE-CHECKLIST 含 S5b 随机字节快照落 evidence 步骤——TDD 红锚（D13 机制防断链）', () => {
  assert.ok(repoPathExists('docs/pre-device/STAGE-CHECKLIST.md'), 'STAGE-CHECKLIST.md 必须存在');
  const doc = readRepo('docs/pre-device/STAGE-CHECKLIST.md');
  assert.ok(/随机字节快照|random.*snapshot|ArrayRng.*快照/i.test(doc), 'S5b 必须含「随机字节快照落 evidence」步骤——否则 P1-5 的留痕钩子无人触发，D13 失败复现包机制空转（TESTS.md 修订建议 R4）');
});

test('T-P0-6-f DECISIONS.md 覆盖 D1–D13 与 O1–O7 签署栏（可空但不得缺位）——TDD 红锚', () => {
  assert.ok(repoPathExists('docs/pre-device/DECISIONS.md'), 'DECISIONS.md 必须存在');
  const doc = readRepo('docs/pre-device/DECISIONS.md');
  for (let i = 1; i <= 13; i++) assert.ok(new RegExp(`\\bD${i}\\b`).test(doc), `DECISIONS.md 缺 D${i}`);
  for (let i = 1; i <= 7; i++) assert.ok(new RegExp(`\\bO${i}\\b`).test(doc), `DECISIONS.md 缺 O${i} 签署栏（可空但必须存在且标「待拍板」——R14）`);
});
