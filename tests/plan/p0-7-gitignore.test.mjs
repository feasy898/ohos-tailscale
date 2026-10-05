// 用途：P0-7 修 .gitignore 证据吞噬的验收（TESTS-2026-10-03，TESTS.md §1 矩阵行 P0-7 / 判据 A14）。
// 双向判据 + 「不该进的没进」（TESTS.md §0.3 修订建议 R5 采纳）：
// 现值锚点（亲验）：evidence/interop-20261003/regress.log 被 .gitignore:27 `*.log` 吞（check-ignore exit 0）；
// state.sha256 未吞（exit 1）。豁免必须锚定 evidence/ 前缀——.zcode/.mimosa/node_modules/secrets 不得被击穿。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './lib/spawn.mjs';

const ignoreExit = (p) => run('git', ['check-ignore', p]).status;
// git check-ignore 约定：exit 0 = 被忽略（吞）；exit 1 = 未被忽略（能入仓）。

test('T-P0-7-a evidence/.../regress.log 不再被吞（check-ignore exit 1）——TDD 红锚（现值 0）', () => {
  assert.notEqual(ignoreExit('evidence/interop-20261003/regress.log'), 0, 'A14 判据：regress.log 必须可入仓（当前被 *.log 吞——D-3 复跑留证在现行规则下是空操作）');
});

test('T-P0-7-b evidence/.../state.sha256 保持不被吞（不得回归侧，现绿）', () => {
  assert.equal(ignoreExit('evidence/interop-X/state.sha256'), 1, 'state.sha256 现已可入仓，P0-7 改动不得回归');
});

test('T-P0-7-c secrets 不被击穿：evidence/ 下 *.p12 仍被吞', () => {
  assert.equal(ignoreExit('evidence/x/y.p12'), 0, 'secrets 段（*.p12/*.keystore…）优先级不得被 !evidence/ 否定规则击穿——否则私钥可借 evidence/ 目录入仓');
});

test('T-P0-7-d 工具目录不被击穿：node_modules/x.log、.zcode/x、.mimosa/x 仍被吞', () => {
  assert.equal(ignoreExit('node_modules/x.log'), 0, 'node_modules 下 .log 仍须被吞（豁免只锚定 evidence/ 前缀）');
  assert.equal(ignoreExit('.zcode/x'), 0, '.zcode/ 仍须被吞');
  assert.equal(ignoreExit('.mimosa/x'), 0, '.mimosa/ 仍须被吞');
});

test('T-P0-7-e 仓根散落 foo.log 仍被吞（防 !*.log 式全局豁免）', () => {
  assert.equal(ignoreExit('foo.log'), 0, '仓根 foo.log 仍须被 *.log 吞——豁免必须锚定 evidence/ 前缀，不得全局放行');
});
