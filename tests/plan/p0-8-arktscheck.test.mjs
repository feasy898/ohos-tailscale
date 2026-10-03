// 用途：P0-8 修 interop/arkts-check.js（ESM/CJS 冲突 + SDK 路径参数化）验收（TESTS-2026-10-03，TESTS.md §1 矩阵行 P0-8）。
// 现值锚点（亲验，BASELINE §2.11）：`node interop/arkts-check.js .` → ReferenceError: require is not defined in ES
// module scope，exit 1（根 package.json "type":"module" 与文件内 require 冲突；第二层阻塞是硬编码 /home/dev/sdk 路径）。
// 防假绿：只断言 exit 0 会被「直接 return 0」骗过——必须断言 SKIP 字样 + 缺失变量名；假路径须报「路径不存在」而非崩溃。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './lib/spawn.mjs';

test('T-P0-8-a 无 SDK 时 exit 0 且输出 SKIP + 缺失变量名 ARKTS_SDK_HOME——TDD 红锚', { timeout: 60000 }, () => {
  const r = run('node', ['interop/arkts-check.js', '.'], { timeoutMs: 55000, env: { ARKTS_SDK_HOME: '' } });
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 0, `无 SDK 应 exit 0 带 SKIP。实测 exit ${r.status}：\n${out.slice(0, 300)}`);
  assert.ok(/SKIP/i.test(out), '输出必须含 SKIP 字样（仅 exit 0 会被「直接 return 0」骗过）');
  assert.ok(/ARKTS_SDK_HOME/.test(out), '输出必须点名缺失环境变量 ARKTS_SDK_HOME（PLAN P0-8 验收明列）');
});

test('T-P0-8-b 假 SDK 路径报「路径不存在」类可读错，非 ReferenceError/SyntaxError——TDD 红锚', { timeout: 60000 }, () => {
  const r = run('node', ['interop/arkts-check.js', '.'], { timeoutMs: 55000, env: { ARKTS_SDK_HOME: 'D:/definitely-not-an-sdk-dir' } });
  const out = r.stdout + r.stderr;
  assert.ok(!/ReferenceError|SyntaxError|Cannot find module/.test(out), `不得崩溃类报错（ESM/CJS 冲突必须已修）。实测输出：\n${out.slice(0, 300)}`);
  assert.ok(/不存在|not exist|not found|no such/i.test(out), '假路径必须报可读的「路径不存在」类信息（证明真做了路径校验，而非只修加载崩溃）');
});
