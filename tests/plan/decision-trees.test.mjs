// 用途：判定树完备性自检验收（TESTS-2026-10-03，TESTS.md §4.2）。
// T-TREE-a/b 现在就该绿：对自带 lib/tree-check.mjs 的自检——五个内置坏树各自被拒（可定位标识）、好树通过。
// 这是「测试的测试」：自检器若抓不住坏树，P0-6 的判定树自检门就是假绿。
// T-TREE-c/d 是 TDD 红锚：AGENT-TASK.md（含 tree 块）与 scripts/check-decision-trees.mjs 均为 P0-6 落地物。
// 树行法见 lib/tree-check.mjs 头注释——P0-6 的 AGENT-TASK 写作必须遵循（TESTS.md §4.2 为规格出处）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMarkdownTrees, checkTree } from './lib/tree-check.mjs';
import { REPO_ROOT, readRepo, repoPathExists } from './lib/spawn.mjs';

const GOOD_TREE = [
  'Q CU6：.ts specifier 编译过？',
  '  Y → 走方案 1：ohpm file: 依赖',
  '    动作: npm run test:bridge 复跑基线后改 oh-package.json5 依赖',
  '    回报: CU6=接受，集成方案=1（ohpm file:）',
  '    升人: 否',
  '  N → 走方案 2：源码镜像',
  '    动作: node app/tools/validate-shell.mjs 同级新建 integration-mirror 工具',
  '    回报: CU6=不接受，集成方案=2（镜像）',
  '    升人: 是(D10-② 需华为账号/证书时升级)',
];

test('T-TREE-a 五断言对五个内置坏树各自拒绝（可定位标识）——现在就该绿', () => {
  const badTrees = [
    {
      name: 'Q 缺 N 出边（非二元）',
      lines: ['Q 只有一个分支？', '  Y → ok', '    动作: x', '    回报: y', '    升人: 否'],
      expect: /恰有一对 Y\/N/,
    },
    {
      name: '叶子缺三元组（无回报字段）',
      lines: ['Q x?', '  Y → a', '    动作: 做事', '    升人: 否', '  N → b', '    动作: 做事', '    回报: r', '    升人: 否'],
      expect: /未终于叶子/,
    },
    {
      name: '升人是但未映射 D10',
      lines: ['Q x?', '  Y → a', '    动作: 做事', '    回报: r', '    升人: 是(问人)', '  N → b', '    动作: 做事', '    回报: r', '    升人: 否'],
      expect: /D10/,
    },
    {
      name: '悬空引用/空占位',
      lines: ['Q x?', '  Y → a', '    动作: 详见上文', '    回报: r', '    升人: 否', '  N → b', '    动作: 待填', '    回报: r', '    升人: 否'],
      expect: /悬空引用或空占位/,
    },
    {
      name: '动作引用仓内不存在的工具',
      lines: ['Q x?', '  Y → a', '    动作: node scripts/definitely-missing-tool.mjs', '    回报: r', '    升人: 否', '  N → b', '    动作: 做事', '    回报: r', '    升人: 否'],
      expect: /不在仓内/,
    },
  ];
  for (const bad of badTrees) {
    const errs = checkTree({ lines: bad.lines, startLine: 1 }, REPO_ROOT);
    assert.ok(errs.length >= 1, `坏树「${bad.name}」必须被拒绝`);
    assert.ok(bad.expect.test(errs.join('\n')), `坏树「${bad.name}」必须红在可定位标识上（实测错误：${errs.join(' / ')}——「红了但红在别处」=G0-5 教训）`);
  }
});

test('T-TREE-b 好树通过（防「全红即通过」的退化自检器）——现在就该绿', () => {
  const errs = checkTree({ lines: GOOD_TREE, startLine: 1 }, REPO_ROOT);
  assert.deepEqual(errs, [], `合法判定树必须通过（只测红不测绿的检查器无法排除恒红退化）。实测：${errs.join(' / ')}`);
});

test('T-TREE-c AGENT-TASK.md 存在且全部 tree 块过五断言——TDD 红锚（P0-6 落地物）', () => {
  assert.ok(repoPathExists('docs/pre-device/AGENT-TASK.md'), 'docs/pre-device/AGENT-TASK.md 必须存在');
  const { blockCount, errs } = checkMarkdownTrees(readRepo('docs/pre-device/AGENT-TASK.md'), REPO_ROOT);
  assert.ok(blockCount >= 1, `AGENT-TASK.md 至少含 1 个 \`\`\`tree 判定树块（S3 报错处置树/S6 四步树/CU 二值树/回退树）。实测 ${blockCount}`);
  assert.deepEqual(errs, [], `判定树五断言必须全过。实测：\n${errs.join('\n')}`);
});

test('T-TREE-d scripts/check-decision-trees.mjs 在盘（P0-6 收编为门）——TDD 红锚', () => {
  assert.ok(repoPathExists('scripts/check-decision-trees.mjs'), 'check-decision-trees.mjs 必须存在（本套件 lib/tree-check.mjs 的规格收编为 A11 门的一部分）');
});
