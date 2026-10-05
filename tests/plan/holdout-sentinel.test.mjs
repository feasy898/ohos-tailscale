// 用途：holdout 物理隔离哨兵（TESTS-2026-10-03，TESTS.md §3.2）。
// 主方案已落地：holdout 内容在仓外 <HOLDOUT_DIR>（owner 本机，不进 git）。
// 本测试钉住「仓内永远不出现 holdout 判定内容」：
//   ① docs/pre-device-plan/holdout-staging/ 不存在（回退方案未启用——若它出现=有人把 holdout 内容放回仓内）；
//   ② 仓内任何 .mjs/.json 不含 holdout 专属测试文件名前缀 h0（tests/plan 自身豁免——机制文档允许引用路径，不允许内容）。
// 路径暴露（L1 级）不等于内容暴露——本哨兵防的是内容入仓（git 历史不可撤，oracle/raw 教训）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoPathExists, listFiles, REPO_ROOT } from './lib/spawn.mjs';
import { readFileSync } from 'node:fs';

test('T-SENTINEL-1 docs/pre-device-plan/holdout-staging/ 不存在（holdout 未回退入仓）——现在就该绿', () => {
  assert.ok(!repoPathExists('docs/pre-device-plan/holdout-staging'), 'holdout 判定内容必须在仓外（<HOLDOUT_DIR>）。staging 目录出现=泄密事故，owner 须立即移出并按 TESTS.md §3.4 泄露分级处置');
});

test('T-SENTINEL-2 仓内无 holdout 判定文件（h0 前缀测试文件 / frozen-495 名单）——现在就该绿', () => {
  const offenders = [];
  for (const root of ['tests', 'scripts', 'docs', 'interop', 'app']) {
    for (const f of [...listFiles(root, '.mjs'), ...listFiles(root, '.json'), ...listFiles(root, '.txt')]) {
      const rel = f.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
      // 豁免：本套件自身（机制文件，不含判定内容）与历史档案面（证据不是说明书）
      if (rel.startsWith('docs/pre-device-plan/') || rel.startsWith('docs/baseline-audit/')) continue;
      const base = rel.split('/').pop();
      if (/^h0\d-/.test(base) || /^frozen-495/.test(base) || /^frozen-exports/.test(base)) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], `仓内不得出现 holdout 判定物（变体集/哨兵集/名冻清单）。实测：${offenders.join('、')}`);
});
