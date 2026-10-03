// 用途：P0-2 修 ArkTS A23 硬违规（stun.ts:176 Generator）验收（TESTS-2026-10-03，TESTS.md §1 矩阵行 P0-2）。
// T-P0-2-a 是 TDD 红锚（grep 现值 2 命中：stun.ts:176/:190，亲验）；T-P0-2-b 现在就该绿（netcheck 84 例钉语义零漂移）。
// 验收 grep 无注释过滤器（刻意 filterless）：注释里写 yield 触门=廉价误报可接受，过滤器=昂贵复杂度（死过滤器教训）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, listFiles } from './lib/spawn.mjs';
import { readFileSync } from 'node:fs';

test('T-P0-2-a packages/*/src 无 function*/yield（现值 2 命中：stun.ts:176/:190）——TDD 红锚', () => {
  const files = listFiles('packages', '.ts').filter((f) => /[\\/]packages[\\/][^\\/]+[\\/]src[\\/]/.test(f));
  assert.ok(files.length >= 70, `packages/*/src 的 .ts 文件应 ≥72（实测枚举 ${files.length}——若 <70 说明检索面自己破了）`);
  const re = /function\*|yield /;
  const hits = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push(`${f.replace(/^.*ohos-tailscale[\\/]/, '')}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], `A23 禁则（Generator）在 packages/*/src 必须 0 命中，实测：${hits.join(' | ')}（P0-2：stun.ts:176 foreachAttr 展开 while+游标 walker，:215/:382 调用点同步改写）`);
});

test('T-P0-2-b netcheck 84 例语义钉（P0-2 改写后行为零漂移的地板）', { timeout: 60000 }, () => {
  const r = run('node', ['--test', 'packages/netcheck/test/*.test.ts'], { timeoutMs: 55000 });
  // glob 形态是本环境 node --test 唯一可用形态（裸目录实测 MODULE_NOT_FOUND）。
  assert.equal(r.status, 0, `netcheck 测试应全绿，实测 exit ${r.status}\n${r.stdout.slice(-300)}`);
  const m = /^# tests (\d+)$/m.exec(r.stdout);
  const m2 = /^# fail (\d+)$/m.exec(r.stdout);
  assert.ok(m && m2, 'TAP 计数行缺失');
  assert.equal(Number(m[1]), 84, `netcheck 用例数必须 84（BASELINE §2.2 裁定口径），实测 ${m[1]}`);
  assert.equal(Number(m2[1]), 0);
});
