#!/usr/bin/env node
// 用途：tests/plan 可见验收测试套件的聚合 runner（TESTS-2026-10-03，docs/pre-device-plan/TESTS.md §2.3）。
// 不改 package.json（禁改既有文件）——直接 `node scripts/test-plan.mjs` 运行；集成补丁（待应用 diff）见 TESTS.md §2.5。
// 语义：
//   1. 枚举 tests/plan/*.test.mjs，逐文件 `node --test <绝对路径>`（glob 形态是本环境唯一可用形态；裸目录实测 MODULE_NOT_FOUND）。
//   2. 解析 TAP 顶层用例，与 tests/plan/expected.json 逐名比对，输出四态：
//      GREEN_OK      预期绿且绿
//      ANCHOR_RED_OK 预期红锚且红（实现落地前这是正确状态）
//      UNEXPECTED_RED 预期绿却红——意外红，失败
//      STALE_ANCHOR  预期红锚却绿——锚点转绿，须核实对应工作项落地后翻转 expected.json（防删锚点/盲翻），以非 0 退出强制显式化
//      UNKNOWN_TEST  未登记用例——先登记 expected.json 再运行（防悄悄加测试），失败
//   3. 汇总行 + exit code：四类问题任一非零即 exit 1；全部分类正确且无意外红 → exit 0（此刻=全部工作项落地完毕的终态）。
// 测量纪律：退出码与被测进程直连（spawnSync 逐文件，无管道）。
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAN_DIR = join(HERE, '..', 'tests', 'plan');
const expected = JSON.parse(readFileSync(join(PLAN_DIR, 'expected.json'), 'utf8'));
const expectedState = new Map();
for (const name of expected.green ?? []) expectedState.set(name, 'green');
for (const name of expected['red-anchor'] ?? []) expectedState.set(name, 'red-anchor');

const files = readdirSync(PLAN_DIR).filter((f) => f.endsWith('.test.mjs')).sort();
if (files.length === 0) {
  console.error('FAIL-CLOSED: tests/plan/ 下没有 *.test.mjs（套件被掏空=红，不允许「没题就当过」）');
  process.exit(2);
}

const results = { GREEN_OK: [], ANCHOR_RED_OK: [], UNEXPECTED_RED: [], STALE_ANCHOR: [], UNKNOWN_TEST: [] };
const seen = new Set();

for (const f of files) {
  const r = spawnSync(process.execPath, ['--test', join(PLAN_DIR, f)], {
    encoding: 'utf8',
    timeout: 300000,
    cwd: join(HERE, '..'),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const tests = [];
  for (const line of (r.stdout || '').split(/\r?\n/)) {
    const m = /^(not )?ok \d+ - (.+)$/.exec(line);
    if (m) tests.push({ name: m[2].trim(), ok: !m[1] });
  }
  if (tests.length === 0) {
    results.UNEXPECTED_RED.push(`${f}：<没有任何顶层用例被解析——文件加载即崩或零用例（fail-closed）>\n${out.slice(-500)}`);
    continue;
  }
  for (const t of tests) {
    seen.add(t.name);
    const exp = expectedState.get(t.name);
    if (exp === undefined) {
      results.UNKNOWN_TEST.push(`${f} :: ${t.name}`);
    } else if (exp === 'green') {
      (t.ok ? results.GREEN_OK : results.UNEXPECTED_RED).push(`${f} :: ${t.name}`);
    } else {
      (t.ok ? results.STALE_ANCHOR : results.ANCHOR_RED_OK).push(`${f} :: ${t.name}`);
    }
  }
}

// expected.json 里登记但本轮没出现的名字（被删/改名）= 清单被掏空
for (const name of expectedState.keys()) {
  if (!seen.has(name)) results.UNKNOWN_TEST.push(`<expected.json 登记但未运行（被删/改名）> :: ${name}`);
}

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log('=== tests/plan 验收套件汇总 ===');
console.log(`文件数 ${files.length}｜GREEN_OK ${results.GREEN_OK.length}｜ANCHOR_RED_OK(红锚确认) ${results.ANCHOR_RED_OK.length}｜UNEXPECTED_RED(意外红) ${results.UNEXPECTED_RED.length}｜STALE_ANCHOR(锚点转绿待翻转) ${results.STALE_ANCHOR.length}｜UNKNOWN_TEST ${results.UNKNOWN_TEST.length}`);
if (results.UNEXPECTED_RED.length) {
  console.log('\n--- 意外红（预期绿的测试失败——回归，必须先修）---');
  for (const x of results.UNEXPECTED_RED) console.log('  ' + x.split('\n')[0]);
}
if (results.STALE_ANCHOR.length) {
  console.log('\n--- 锚点转绿（预期红的测试通过）---');
  console.log('  若因对应工作项落地：核实后把 expected.json 中该用例移入 green 并在 worklog 记一行；');
  console.log('  若你并未实现对应工作项却转绿=锚点被绕过（如删断言/改语义），按 TESTS.md §3 处置。');
  for (const x of results.STALE_ANCHOR) console.log('  ' + x);
}
if (results.UNKNOWN_TEST.length) {
  console.log('\n--- 未登记/失踪用例（expected.json 必须与实际用例集一一对应）---');
  for (const x of results.UNKNOWN_TEST) console.log('  ' + x);
}
if (results.ANCHOR_RED_OK.length && !results.UNEXPECTED_RED.length && !results.STALE_ANCHOR.length && !results.UNKNOWN_TEST.length) {
  console.log('\n红锚按预期红（TDD 状态健康）；全部锚点转绿并翻转清单后，本命令 exit 0 = 25 个工作项验收面收口。');
}
const bad = results.UNEXPECTED_RED.length + results.STALE_ANCHOR.length + results.UNKNOWN_TEST.length;
process.exit(bad === 0 ? 0 : 1);
