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
  assert.equal(r.status, 2, `假路径应受控退出 exit 2（承袭 :39/:70 惯例；未捕获崩溃=exit 1）。实测 exit ${r.status}：\n${out.slice(0, 300)}`);
  assert.ok(!/ReferenceError|SyntaxError|Cannot find module/.test(out), `不得崩溃类报错（ESM/CJS 冲突必须已修）。实测输出：\n${out.slice(0, 300)}`);
  assert.ok(/不存在|not exist|not found|no such/i.test(out), '假路径必须报可读的「路径不存在」类信息（证明真做了路径校验，而非只修加载崩溃）');
});

test('T-P0-8-c 第二档：SDK 路径存在但非 SDK 目录（仓根样本）→ 可读错非崩，行为级断言不锁判据（R10）', { timeout: 60000 }, () => {
  const r = run('node', ['interop/arkts-check.js', '.'], { timeoutMs: 55000, env: { ARKTS_SDK_HOME: process.cwd() } });
  const out = r.stdout + r.stderr;
  // 非崩维度（2026-10-04 调度侧登记，TESTS §2.9-3/R10）：裸 ENOENT 堆栈含 "no such" 会骗过文本正则——
  // exit 码、栈帧行、node:internal 帧才是鉴别器。
  assert.equal(r.status, 2, `存在但非 SDK 目录应受控退出 exit 2（可读错非崩）。实测 exit ${r.status}：\n${out.slice(0, 300)}`);
  assert.ok(!/ReferenceError|SyntaxError|Cannot find module/.test(out), `不得崩溃类报错。实测输出：\n${out.slice(0, 300)}`);
  assert.ok(!/(?:^|\n)\s*at /.test(out), `不得有栈帧行（裸 ENOENT 堆栈会骗过文本正则）。实测输出：\n${out.slice(0, 300)}`);
  assert.ok(!/node:internal\//.test(out), `不得有 node:internal 帧。实测输出：\n${out.slice(0, 300)}`);
  assert.ok(/不存在|not exist|not found|no such|无效/i.test(out), '必须报可读的「路径不存在/无效」类信息（行为级：证明真做了 SDK 目录校验）');
  assert.ok(/ARKTS_SDK_HOME/.test(out), '输出必须点名变量 ARKTS_SDK_HOME');
});
