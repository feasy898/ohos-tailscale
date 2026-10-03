// 用途：交接文档防毒扫描器验收（TESTS-2026-10-03，TESTS.md §4.4）。
// T-HANDOFF-b 现在就该绿（扫描器自检——测的是本套件自带的 lib/handoff-scanner.mjs，负/正对照齐）；
// T-HANDOFF-a 是真红锚：对现有 handover 文档实测应抓出已知假命令（owner-with-real-device.md:60 hvigorw、
// :47 裸 vpn 模块名、HARMONY_AGENT_TASK.md 死地址/git://——BASELINE §6 + 轨迹亲验）；
// T-HANDOFF-c 是 P0-6 后生效的白名单断言（AGENT-TASK 必须有解药：真克隆地址/现行数字/正确 API 全名/Day1 完整命令）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText, SELF_CHECK_SAMPLES, BLACKLIST } from './lib/handoff-scanner.mjs';
import { run, readRepo, repoPathExists } from './lib/spawn.mjs';

const SURFACE = [
  'README.md', 'CONTEXT.md', 'TASK.md', 'DELIVERY_REPORT.md', 'HARMONY_AGENT_TASK.md',
  'docs/handover/README.md', 'docs/handover/owner-with-real-device.md',
  'docs/handover/agent-interop-regression.md', 'docs/handover/reviewer-pr-style.md',
  'docs/architecture.md',
  'docs/pre-device/AGENT-TASK.md', 'docs/pre-device/STAGE-CHECKLIST.md',
  'docs/pre-device/DECISIONS.md', 'docs/pre-device/CU-CARDS.md',
  'docs/pre-device/OWNER-GUIDE.md', 'docs/pre-device/EVIDENCE-SPEC.md',
];

test('T-HANDOFF-b 扫描器自检：正/负对照全中（现在就该绿）', () => {
  for (const s of SELF_CHECK_SAMPLES) {
    const hits = scanText(s.text, '<selfcheck>');
    if (s.mustHit) {
      assert.ok(hits.length >= 1, `必须命中：${s.note}（文本=${JSON.stringify(s.text)}）`);
    } else {
      assert.equal(hits.length, 0, `不得误杀：${s.note}（文本=${JSON.stringify(s.text)}，命中=${hits.map((h) => h.id).join(',')}）`);
    }
  }
  assert.ok(BLACKLIST.length >= 7, '黑名单规则集应 ≥7 条（防规则被悄悄删空）');
});

test('T-HANDOFF-a 交接面黑名单 0 命中——TDD 红锚（现值：owner 文档假 hvigorw + 裸 vpn 模块名 + HAT 死地址等）', () => {
  const all = [];
  for (const f of SURFACE) {
    if (!repoPathExists(f)) continue;
    all.push(...scanText(readRepo(f), f));
  }
  assert.deepEqual(all.map((h) => `${h.file}:${h.line}[${h.id}]`), [],
    `交接/活文档面毒串必须清零（P0-6）。实测命中（每条都是已知毒点）：\n${all.map((h) => `  ${h.file}:${h.line} [${h.id}] ${h.why}`).join('\n')}`);
});

test('T-HANDOFF-c AGENT-TASK.md 白名单（解药在场）——TDD 红锚（P0-6 后生效）', () => {
  assert.ok(repoPathExists('docs/pre-device/AGENT-TASK.md'), 'docs/pre-device/AGENT-TASK.md 必须存在（P0-6 建立后本断言才有内容可查）');
  const doc = readRepo('docs/pre-device/AGENT-TASK.md');
  // 克隆地址以运行时真值为准（git remote get-url origin），不硬编码——防 remote 变更时白名单自己变假阳性源。
  const remote = run('git', ['remote', 'get-url', 'origin']);
  assert.equal(remote.status, 0);
  const originUrl = remote.stdout.trim();
  const originHttps = originUrl.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/').replace(/^git@github\.com\//, 'https://github.com/');
  assert.ok(doc.includes('github.com/feasy898/ohos-tailscale') || doc.includes(originHttps),
    `必须含真实克隆地址（以 origin 运行时真值 ${originHttps} 为准，非 git:// 死地址）`);
  assert.ok(/@ohos\.net\.vpnExtension/.test(doc), '必须出现正确全名 @ohos.net.vpnExtension');
  assert.ok(/typecheck:bridge/.test(doc), 'Day1 命令必须含 typecheck:bridge（交接契约漏项防再犯）');
  assert.ok(/(8\s*包|八包)/.test(doc) && /495/.test(doc), '必须写现行口径 8 包/495');
  if (/makePeerServer\(null\)|as unknown as/.test(doc)) {
    assert.ok(/反模式/.test(doc), 'makePeerServer(null)/as unknown as 只允许出现在「反模式」语境（防毒写法被误引为示范）');
  }
});
