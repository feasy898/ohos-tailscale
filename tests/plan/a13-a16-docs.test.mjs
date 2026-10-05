// 用途：A13/A16 文档一致性红锚 + caliber 校验式规格（TESTS-2026-10-03，TESTS.md §1 矩阵行 P1-2/P1-3）。
// 口径纪律（轨迹 minimax-3 实测）：裸数字黑名单假阳性 46%——断言按「语境」不按「裸数字」：
// 命中行须声称当前状态（pass/passed/期望/现行/全绿/表格口径位），且不含历史/增量标记（基线|历史|时序|→|初版|上一轮）。
// 单一事实源走「无值结构 + 运行时真值」：docs/pre-device/caliber.json 只声明取法（cmd/extract/relation）不写死数值，
// 且 min/eq 双字段（floor 只增不减 + current 现行值）——调和 A1「≥495」与 P1-2「写现行口径」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, readRepo, repoPathExists } from './lib/spawn.mjs';

const ACTIVE_DOCS = [
  'README.md', 'CONTEXT.md', 'TASK.md', 'DELIVERY_REPORT.md', 'HARMONY_AGENT_TASK.md',
  'docs/handover/README.md', 'docs/handover/owner-with-real-device.md',
  'docs/handover/agent-interop-regression.md', 'docs/handover/reviewer-pr-style.md',
  'docs/architecture.md',
];

// 旧数字黑名单（带语义形状，非裸数字）+ 语境规则（A16 否定断言的可见最小集；扩展值集在 holdout H3）
const STALE_PATTERNS = [
  /280\s*pass/, /13\s*pass(?!\d)/, /54\s*passed/, /54\s*用例/, /238\s*\/\s*238/,
  /期望\s*238/, /六包/, /1066\s*行/, /约\s*8400\s*行/,
];
const HISTORICAL_MARK = /基线|历史|时序|初版|上一轮|更新轮|→|\+\d+|09-29|09-01|10-01/;

test('T-A13 活文档面 oracle/raw 悬空引用 0 命中——TDD 红锚（现值：DELIVERY_REPORT 多处）', () => {
  const hits = [];
  for (const f of ACTIVE_DOCS) {
    if (!repoPathExists(f)) continue;
    readRepo(f).split(/\r?\n/).forEach((line, i) => {
      if (/oracle\/raw/.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], `oracle/raw 引用必须清零（目录从未入 git，引用失效——P1-2 改指「本节即唯一现存记录」+实测标注）。实测：\n${hits.join('\n')}`);
});

test('T-A16-1 旧数字语境断言：活文档面 0 命中——TDD 红锚（现值：README 双表/HAT 六包等多处）', () => {
  const hits = [];
  for (const f of ACTIVE_DOCS) {
    if (!repoPathExists(f)) continue;
    readRepo(f).split(/\r?\n/).forEach((line, i) => {
      if (HISTORICAL_MARK.test(line)) return; // 历史/时序叙事豁免（DELIVERY 前后对比表、CONTEXT 时序链）
      for (const re of STALE_PATTERNS) {
        if (re.test(line)) {
          hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
          break;
        }
      }
    });
  }
  assert.deepEqual(hits, [], `旧口径在活文档面必须清零（P1-2）。实测残留：\n${hits.join('\n')}`);
});

test('T-A16-2 caliber.json 存在且为无值结构（min/eq + floor/current 双字段）——TDD 红锚（P1-3 落地物）', () => {
  assert.ok(repoPathExists('docs/pre-device/caliber.json'), 'docs/pre-device/caliber.json 必须存在（单一事实源：只声明取法不写死数值——防「把门改成输出期望值」）');
  const cal = JSON.parse(readRepo('docs/pre-device/caliber.json'));
  assert.ok(Array.isArray(cal.entries) && cal.entries.length >= 3, 'entries 至少覆盖 tests/bridge/shell 三个口径');
  for (const e of cal.entries) {
    assert.ok(e.id && e.cmd && e.extract, `条目 ${e.id} 缺 id/cmd/extract`);
    assert.ok(['min', 'eq'].includes(e.relation), `条目 ${e.id} relation 必须是 min|eq`);
    if (e.relation === 'min') {
      assert.ok(typeof e.floor === 'number' && typeof e.current === 'number', `条目 ${e.id} min 语义必须带 floor（只增不减）+current（现行值）双字段`);
    }
  }
  if (cal.exemptions) {
    for (const x of cal.exemptions) assert.ok(typeof x.reason === 'string' && x.reason.length > 0, `豁免条目 ${x.file || JSON.stringify(x).slice(0, 40)} 必须带非空 reason`);
  }
});

test('T-A16-3 否定断言门有鉴别力的前置：docs 门本地等价脚本存在——TDD 红锚（P1-3 落地物）', () => {
  assert.ok(
    repoPathExists('scripts/doc-consistency.mjs') || /doc-consistency/.test(readRepo('.github/workflows/g0-gates.yml').replace(/#.*$/gm, '')),
    'docs-consistency 必须改调仓内脚本（scripts/doc-consistency.mjs），yml 无裸 awk/grep（awk 恒空取值实测——fail 数从不参与判据的假绿门）',
  );
});
