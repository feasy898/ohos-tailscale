// 用途：P0-4 D4/P4 机检门 + CI G0-5 改调的验收（TESTS-2026-10-03，TESTS.md §1 矩阵行 P0-4）。
// 混合态：T-P0-4-g 现在就该绿（等价 grep 证明代码面干净——BASELINE §2.9(b)）；其余为 TDD 红锚
// （脚本不存在 / yml 内联裸 grep 在盘 / bash -n 对 D4 段红——G0-5 语法死从未执行的实锤）。
// 「与 CI 行为一致」= 两个可观测物：①yml G0-5 逐字调 scripts/gate-d4-p4.mjs（无裸 grep 回潮）；
// ②脚本对干净仓 exit 0、注入 fixture exit≠0（负对照变体在 holdout H2）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, readRepo, repoPathExists } from './lib/spawn.mjs';

test('T-P0-4-a package.json 含 gate:d4 script——TDD 红锚', () => {
  const pkg = JSON.parse(readRepo('package.json'));
  assert.ok(typeof pkg.scripts['gate:d4'] === 'string', 'package.json.scripts 必须含 gate:d4');
});

test('T-P0-4-b scripts/gate-d4-p4.mjs 在盘——TDD 红锚', () => {
  assert.ok(repoPathExists('scripts/gate-d4-p4.mjs'), 'scripts/gate-d4-p4.mjs 必须存在（CI 与本地共用同一份）');
});

test('T-P0-4-c 干净基线绿：npm run gate:d4 exit 0 且 0 命中——TDD 红锚', { timeout: 60000 }, () => {
  const r = run('npm', ['run', 'gate:d4'], { timeoutMs: 55000 });
  assert.equal(r.status, 0, `gate:d4 对当前仓应 exit 0（代码面 D4/P4 干净为真，BASELINE §2.9(b)）。实测 ${r.status}`);
});

test('T-P0-4-d yml G0-5 段改调 node scripts/gate-d4-p4.mjs（无裸内联 grep）——TDD 红锚', () => {
  const yml = readRepo('.github/workflows/g0-gates.yml');
  assert.ok(yml.includes('node scripts/gate-d4-p4.mjs'), 'G0-5 run 块必须逐字为 node scripts/gate-d4-p4.mjs（人工复核路径与 CI 路径同工具）');
});

test('T-P0-4-e yml 无裸 grep -rE / awk 机检行——TDD 红锚', () => {
  const yml = readRepo('.github/workflows/g0-gates.yml');
  const hits = [];
  yml.split(/\r?\n/).forEach((line, i) => {
    if (/grep -rE|awk '/.test(line)) hits.push(`yml:${i + 1}: ${line.trim().slice(0, 80)}`);
  });
  assert.deepEqual(hits, [], `yml 内不得有裸机检行（G0-5 与 docs-consistency 均应改调仓内脚本）。实测：\n${hits.join('\n')}`);
});

test('T-P0-4-f yml 每个 run 块过 bash -n（D4 段现值 exit 2 语法死）——TDD 红锚', () => {
  const yml = readRepo('.github/workflows/g0-gates.yml');
  const lines = yml.split(/\r?\n/);
  const blocks = [];
  let cur = null;
  let runIndent = 0;
  for (const line of lines) {
    const m = /^([ ]*)run:\s*\|\s*$/.exec(line);
    if (m) {
      cur = [];
      runIndent = m[1].length;
      continue;
    }
    if (cur !== null) {
      if (line.trim() === '') {
        cur.push('');
        continue;
      }
      const ind = (/^[ ]*/.exec(line))[0].length;
      if (ind <= runIndent) {
        blocks.push(cur);
        cur = null;
      } else {
        cur.push(line);
      }
    }
  }
  if (cur) blocks.push(cur);
  assert.ok(blocks.length >= 2, `应至少抽出 2 个 run:| 块（G0-5 内联 + docs-consistency），实测 ${blocks.length}（若 0=抽取器自己破了）`);
  for (const b of blocks) {
    const script = b.join('\n');
    if (script.trim() === '') continue;
    const r = run('bash', ['-n'], { stdin: script });
    assert.equal(r.status, 0, `run 块必须过 bash -n（语法死=从未执行，G0-5 教训）。失败块前几行：\n${script.split('\n').slice(0, 6).join('\n')}\nstderr: ${r.stderr.slice(0, 200)}`);
  }
});

test('T-P0-4-g 等价 grep 0 命中：代码面 D4/P4/node: 干净（现行基线，现在就该绿）', () => {
  // 与 CI 同过滤器同检索面的修正引号版（BASELINE §9）。P4 段注释豁免规则与 yml 等价。
  const p4 = run('grep', ['-rEn', 'Date\\.now|Math\\.random', 'packages/', '--include=*.ts']);
  const p4Hits = p4.stdout.split(/\r?\n/).filter((l) => l && !/:\s*\/\//.test(l) && !/ \* /.test(l));
  assert.deepEqual(p4Hits, [], `P4 非注释命中应为空（原始 4 条全在注释，BASELINE §2.9(b)）。实测：${p4Hits.join(' | ')}`);

  const nod = run('grep', ['-rEn', "from ['\"]node:", 'packages/', '--include=*.ts']);
  const nodHits = nod.stdout.split(/\r?\n/).filter((l) => l && !/\.test\.ts:/.test(l));
  assert.deepEqual(nodHits, [], `node: 导入在非测试文件应为空。实测：${nodHits.join(' | ')}`);

  const d4 = run('bash', ['-c', "grep -rEn \"fetch\\(|XMLHttpRequest|WebSocket|from ['\\\"]?(net|dgram|http|https|tls|dns|fs|path|os|child_process|crypto)['\\\"]\" packages/ --include='*.ts' | grep -v '\\.test\\.ts:' | grep -v '^\\s*//' || true"]);
  const d4Hits = d4.stdout.split(/\r?\n/).filter((l) => l.trim());
  assert.deepEqual(d4Hits, [], `D4 特征在非测试 src 应为空（原始即 0）。实测：${d4Hits.join(' | ')}`);
});
