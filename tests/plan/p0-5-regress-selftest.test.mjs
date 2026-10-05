// 用途：P0-5 regress 可归因改造 + 离线 selftest 门的验收红锚（TESTS-2026-10-03，TESTS.md §1 矩阵行 P0-5）。
// 现值锚点（亲验）：regress.mjs:42 判据 stdout.length>0（错误信号源）；:52 硬编码假 preauthkey；
// :54-56 derp 只传 1 参；h2c.node.ts process.argv=0（无 CLI）；:71-74 summary.json 写 OS tmpdir（证据原件必丢）。
// 新发现已入验收（TESTS.md §0.3 修订建议 R3）：--out 落盘参数——归档命令只 tee stdout，「summary 入 evidence」现状是空操作。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, readRepo } from './lib/spawn.mjs';

test('T-P0-5-a npm run interop:regress -- --selftest 离线 exit 0——TDD 红锚', { timeout: 120000 }, () => {
  const r = run('npm', ['run', 'interop:regress', '--', '--selftest'], { timeoutMs: 110000 });
  assert.equal(r.status, 0, `selftest 应离线全绿 exit 0（S1–S5 五断言）。实测 ${r.status}：\n${(r.stdout + r.stderr).slice(-400)}`);
});

test('T-P0-5-b interop/ 无 regress-dummy-preauthkey 硬编码——TDD 红锚（现值：regress.mjs:52）', () => {
  const src = readRepo('interop/regress.mjs');
  assert.ok(!src.includes('regress-dummy-preauthkey'), '必须改读环境变量 HS_PREAUTHKEY，删除硬编码假 key（真 headscale 也必 401 拒）');
  assert.ok(/HS_PREAUTHKEY/.test(src), 'regress.mjs 必须出现 HS_PREAUTHKEY（P0-5 三缺陷修复之一）');
});

test('T-P0-5-c h2c.node.ts 有 CLI 入口（process.argv ≥1 处）——TDD 红锚（现值 0）', () => {
  const src = readRepo('interop/h2c.node.ts');
  const n = (src.match(/process\.argv/g) || []).length;
  assert.ok(n >= 1, `h2c.node.ts 必须有 CLI 入口（现值 0=纯模块，exit 0 且 stdout 空被判负——O2 默认补 CLI）。实测 ${n}`);
});

test('T-P0-5-d regress.mjs 支持 --out/<落盘路径>（summary.json 不再只写 OS tmpdir）——TDD 红锚', () => {
  const src = readRepo('interop/regress.mjs');
  assert.ok(
    /--out|OUT_DIR|EVIDENCE_DIR|summary.*evidence/i.test(src),
    'summary.json 必须可指定落盘路径（--out 或等价）：现 :71-74 写 mkdtempSync(tmpdir())，归档只 tee stdout，「summary 原件入 evidence」在当前形态下是空操作（TESTS.md 修订建议 R3）',
  );
});

test('T-P0-5-e 无 headscale 时 interop:regress exit 1（非 0——环境缺失不得假绿）', { timeout: 120000 }, () => {
  const r = run('npm', ['run', 'interop:regress'], { timeoutMs: 110000, env: { HS: 'http://127.0.0.1:1' } });
  assert.equal(r.status, 1, `无 headscale 时 regress 必须 exit 1。实测 ${r.status}`);
});

test('T-P0-5-f 无 headscale 失败可归因：输出含 ENV_UNREACHABLE——TDD 红锚', { timeout: 120000 }, () => {
  const r = run('npm', ['run', 'interop:regress'], { timeoutMs: 110000, env: { HS: 'http://127.0.0.1:1' } });
  assert.ok(
    /ENV_UNREACHABLE/.test(r.stdout + r.stderr),
    `环境缺失必须归类 ENV_UNREACHABLE（不再是不可归因的 false）。输出尾部：${(r.stdout + r.stderr).slice(-300)}`,
  );
});
