// 用途：⑤路径穿越修复的攻击样例实证（Mimosa 标的 interop/arkts-check.js scanRoot 面，e136900/1c44aa8 修复）。
// 与 T-G06（upload_server.py）同构：构造 ../ 与绝对路径 payload，实测「被拒」（exit 2 + escapes 文案），
// 并以对照组证明守卫有鉴别力（仓内根照常扫描），以防「恒拒假绿」。
// 测法：不 mock arkts-check.js 本体——真进程 spawn，用可加载的 stub typescript 模块喂满
// ARKTS_SDK_HOME 的目录形状（loadTypeScript 只 statSync 目录 + require；escape 拒绝发生在
// require 之后、任何扫描之前，故空导出 stub 足以到达守卫，arkts-check.js:52-70）。
// 隔离纪律：SCAN_ROOT / ARKTS_SCAN_ALLOW_EXTERNAL 每个用例显式置值（run() 会透传宿主 env）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, REPO_ROOT } from './lib/spawn.mjs';

/** 造一个「statSync 是目录 + require 可加载」的最小 typescript stub（arkts-check.js:18-32 的形状）。 */
function makeStubSdk() {
  const root = mkdtempSync(join(tmpdir(), 'arkts-stub-sdk-'));
  const tsDir = join(root, 'ets', 'ets', 'build-tools', 'ets-loader', 'node_modules', 'typescript');
  mkdirSync(tsDir, { recursive: true });
  writeFileSync(join(tsDir, 'package.json'), JSON.stringify({ name: 'typescript', main: 'index.js' }));
  writeFileSync(
    join(tsDir, 'index.js'),
    [
      '// 测试 stub：守卫在扫描前，扫描所需 API 无需真实实现',
      'module.exports = {',
      '  ScriptTarget: { ES2022: 99 },',
      '  ModuleKind: { NodeNext: 199 },',
      '  ModuleResolutionKind: { NodeNext: 100 },',
      '  createWatchCompilerHost: () => ({}),',
      '  createWatchProgram: (host) => { host.afterProgramCreate(host); },',
      '};',
      '',
    ].join('\n'),
  );
  return root;
}

const SDK = makeStubSdk();
const baseEnv = { ARKTS_SDK_HOME: SDK, ARKTS_SCAN_ALLOW_EXTERNAL: '', SCAN_ROOT: '' };

test('T-SEC-1 arkts-check SCAN_ROOT 绝对路径越界（tmpdir）→ exit 2 + escapes 文案 + 未进扫描', { timeout: 60000 }, () => {
  const r = run('node', ['interop/arkts-check.js', '.'], {
    timeoutMs: 55000,
    env: { ...baseEnv, SCAN_ROOT: tmpdir() }, // 绝对路径，仓外（真机实证形态：/etc 等）
  });
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 2, `越界 SCAN_ROOT 应受控 exit 2，实测 ${r.status}\n${out.slice(0, 300)}`);
  assert.ok(/SCAN_ROOT escapes repo root/.test(out), `必须点名 escapes 文案。实测：\n${out.slice(0, 300)}`);
  assert.ok(!/scanning \d+ \.ts files/.test(out), '拒绝必须发生在任何文件扫描之前（防越界内容已被读取）');
});

test('T-SEC-2 arkts-check SCAN_ROOT ../ 穿越形态（repo/..）→ exit 2 + escapes 文案 + 未进扫描', { timeout: 60000 }, () => {
  const r = run('node', ['interop/arkts-check.js', '.'], {
    timeoutMs: 55000,
    env: { ...baseEnv, SCAN_ROOT: REPO_ROOT + '/../' }, // 经 realpath 归一后落在仓外
  });
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 2, `../ 穿越应受控 exit 2，实测 ${r.status}\n${out.slice(0, 300)}`);
  assert.ok(/SCAN_ROOT escapes repo root/.test(out), `必须点名 escapes 文案。实测：\n${out.slice(0, 300)}`);
  assert.ok(!/scanning \d+ \.ts files/.test(out), '拒绝必须发生在任何文件扫描之前');
});

test('T-SEC-3 对照组：仓内 packages 根正常进扫描、无 escapes 文案（守卫有鉴别力，非恒拒假绿）', { timeout: 60000 }, () => {
  const r = run('node', ['interop/arkts-check.js', '.'], {
    timeoutMs: 55000,
    env: { ...baseEnv }, // SCAN_ROOT 置空 → 脚本取默认 <repo>/packages
  });
  const out = r.stdout + r.stderr;
  assert.ok(/scanning \d+ \.ts files/.test(out), `仓内根必须真进扫描（stub 到 linter 才停）。实测：\n${out.slice(0, 300)}`);
  assert.ok(!/SCAN_ROOT escapes repo root/.test(out), '仓内根不得触发 escapes 拒绝');
});

test('T-SEC-4 外置根仅显式 ARKTS_SCAN_ALLOW_EXTERNAL=1 才放行（warn 可见 + 扫描确实进行）', { timeout: 60000 }, () => {
  const ext = mkdtempSync(join(tmpdir(), 'arkts-ext-scan-'));
  writeFileSync(join(ext, 'sample.ts'), 'export const x: number = 1;\n');
  try {
    const r = run('node', ['interop/arkts-check.js', '.'], {
      timeoutMs: 55000,
      env: { ...baseEnv, ARKTS_SCAN_ALLOW_EXTERNAL: '1', SCAN_ROOT: ext },
    });
    const out = r.stdout + r.stderr;
    assert.ok(
      /escapes repo root but ARKTS_SCAN_ALLOW_EXTERNAL=1/.test(out),
      `显式放行必须留 warn 痕迹（可审计）。实测：\n${out.slice(0, 300)}`,
    );
    assert.ok(/scanning 1 \.ts files/.test(out), '放行后必须真扫描到外置样本文件');
  } finally {
    rmSync(ext, { recursive: true, force: true });
  }
});
