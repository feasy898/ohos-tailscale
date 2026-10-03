// 用途：A1/A2/A4/A5/G0-6 现行基线守门（TESTS-2026-10-03，TESTS.md §1 矩阵行 a-criteria）。
// 预期状态：现在就该绿——这些是「已有门在开发全程不许回退」的地板，红锚实现期间它们保持绿才有意义。
// 测量纪律：退出码与被测进程直连（spawnSync 数组形态，无管道）；`# skipped/todo/cancelled = 0` 是零成本高价值断言
// （堵 test.skip/todo 绕过——轨迹 minimax-1 M4）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './lib/spawn.mjs';

const num = (out, re) => {
  const m = re.exec(out);
  assert.ok(m, `输出中找不到 ${re}（输出尾部：${out.slice(-200)}）`);
  return Number(m[1]);
};

test('T-A1 npm test 全绿且计数只增不减（≥495，skipped/todo/cancelled 全 0）', { timeout: 120000 }, () => {
  const r = run('npm', ['test'], { timeoutMs: 110000 });
  assert.equal(r.status, 0, `npm test 应 exit 0，实测 ${r.status}\n${r.stdout.slice(-400)}`);
  const tests = num(r.stdout, /^# tests (\d+)$/m);
  const pass = num(r.stdout, /^# pass (\d+)$/m);
  const fail = num(r.stdout, /^# fail (\d+)$/m);
  assert.ok(tests >= 495, `# tests ${tests} 必须 ≥495（只增不减）`);
  assert.equal(fail, 0, `# fail ${fail} 必须 0`);
  assert.equal(pass, tests, '# pass 必须等于 # tests');
  for (const field of ['skipped', 'todo', 'cancelled']) {
    assert.equal(num(r.stdout, new RegExp(`^# ${field} (\\d+)$`, 'm')), 0, `# ${field} 必须 0（防 skip/todo 绕过断言）`);
  }
});

test('T-A2 npm run typecheck 根类型检查 exit 0', { timeout: 120000 }, () => {
  const r = run('npm', ['run', 'typecheck'], { timeoutMs: 110000 });
  assert.equal(r.status, 0, `typecheck 应 exit 0，实测 ${r.status}\n${r.stdout.slice(-400)}${r.stderr.slice(-200)}`);
});

test('T-A4 npm run test:bridge 地板（≥30 且 fail 0）', { timeout: 60000 }, () => {
  const r = run('npm', ['run', 'test:bridge'], { timeoutMs: 50000 });
  assert.equal(r.status, 0, `test:bridge 应 exit 0，实测 ${r.status}`);
  const tests = num(r.stdout, /^# tests (\d+)$/m);
  const fail = num(r.stdout, /^# fail (\d+)$/m);
  assert.ok(tests >= 30, `# tests ${tests} 必须 ≥30（P0-1 后 ≥31，P1-4 后 ≥36——地板语义 min）`);
  assert.equal(fail, 0);
});

test('T-A5 npm run validate:shell 壳机检 ≥66 passed / 0 failed', { timeout: 60000 }, () => {
  const r = run('npm', ['run', 'validate:shell'], { timeoutMs: 50000 });
  assert.equal(r.status, 0);
  const passed = num(r.stdout, /summary: (\d+) passed/);
  const failed = num(r.stdout, /summary: \d+ passed, (\d+) failed/);
  assert.ok(passed >= 66, `passed ${passed} 必须 ≥66（只增不减）`);
  assert.equal(failed, 0);
});

test('T-G06 upload_server 路径穿越实证 exit 0', { timeout: 60000 }, () => {
  const r = run('npm', ['run', '--silent', 'interop:test:upload'], { timeoutMs: 50000 });
  assert.equal(r.status, 0, `interop:test:upload 应 exit 0（需 python 在 PATH），实测 ${r.status}\n${(r.stdout + r.stderr).slice(-400)}`);
  assert.ok(/8 pass \/ 0 fail/.test(r.stdout), '单元层应 8/0');
  assert.ok(/7 pass \/ 0 fail/.test(r.stdout), '集成层应 7/0');
});
