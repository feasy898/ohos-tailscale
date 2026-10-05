// 用途：P0-3 新门 validate:arkts 的结构三件套红锚（TESTS-2026-10-03，TESTS.md §1 矩阵行 P0-3）。
// 本文件只钉「门在不在、CI 跑不跑、干净基线绿不绿」——负对照矩阵（变形样本）在 holdout（H1）。
// 教训（BASELINE 缺口#1）：门存在≠门在岗——每道新门必须同时有 npm script、CI step、可运行三件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, readRepo, repoPathExists } from './lib/spawn.mjs';

test('T-P0-3-a package.json 含 validate:arkts script——TDD 红锚', () => {
  const pkg = JSON.parse(readRepo('package.json'));
  assert.ok(pkg.scripts && typeof pkg.scripts['validate:arkts'] === 'string', 'package.json.scripts 必须含 validate:arkts（PLAN P0-3）');
});

test('T-P0-3-b app/tools/ets-mirror-check.mjs 在盘——TDD 红锚', () => {
  assert.ok(repoPathExists('app/tools/ets-mirror-check.mjs'), 'app/tools/ets-mirror-check.mjs 必须存在（双面门主体）');
});

test('T-P0-3-c g0-gates.yml 含 validate:arkts step——TDD 红锚', () => {
  const yml = readRepo('.github/workflows/g0-gates.yml');
  assert.ok(yml.includes('npm run validate:arkts'), 'yml 必须含 npm run validate:arkts step（防缺口#1 复刻）');
});

test('T-P0-3-d 干净基线绿：npm run validate:arkts exit 0——TDD 红锚', { timeout: 120000 }, () => {
  const r = run('npm', ['run', 'validate:arkts'], { timeoutMs: 110000 });
  assert.equal(r.status, 0, `validate:arkts 对当前仓应 exit 0（三件套之①正控制）。实测 ${r.status}：\n${(r.stdout + r.stderr).slice(-400)}`);
});
