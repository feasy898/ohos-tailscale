// 用途：P1 批次的存在性/形态红锚集（TESTS-2026-10-03，TESTS.md §1 矩阵 P1 各行）。
// 全部为 TDD 红锚：依赖的落地物（packages/kat、vpn-config、platform-ports、headscale 双 yaml、
// manifest、evidence 校验器、perf 源码、gates 聚合、A12 类型覆盖）现全部不存在（亲验）。
// 详细行为断言（KAT 向量数 ≥60、mtu 边界 575/576/1500/1501、env-check SKIP 形态等）见 TESTS.md 矩阵
// 「规格」列——由各工作项落地时以分门形态实现，本文件只钉「该建的建了吗」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, readRepo, repoPathExists, listFiles } from './lib/spawn.mjs';
import { readFileSync } from 'node:fs';

test('T-P1-1a packages/kat/ 存在且 test:kat script 在——TDD 红锚', () => {
  assert.ok(repoPathExists('packages/kat/src'), 'packages/kat/ 必须存在（O5 建议通过的第 9 workspace 包）');
  const pkg = JSON.parse(readRepo('package.json'));
  assert.ok(typeof pkg.scripts['test:kat'] === 'string', 'package.json.scripts 必须含 test:kat');
});

test('T-P1-1b packages/kat/src 零 node: 导入（三种 import 形态）——TDD 红锚（vacuous-safe：目录存在先决）', () => {
  const files = listFiles('packages/kat/src', '.ts');
  assert.ok(files.length >= 1, 'kat/src 应有源码文件');
  const re = /from ['"]node:|import\(['"]node:|require\(['"]node:/;
  const hits = files.flatMap((f) =>
    readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => re.test(l)).map((l) => `${f}:${l.trim().slice(0, 60)}`),
  );
  assert.deepEqual(hits, [], `KAT 可移植层必须零 node: 导入（字面 "node:" grep 会被注释误伤——断言三种 import 形态）。实测：${hits.join(' | ')}`);
});

test('T-P1-4a app/bridge/src/vpn-config.ts 在盘——TDD 红锚', () => {
  assert.ok(repoPathExists('app/bridge/src/vpn-config.ts'), 'vpn-config.ts 必须存在（buildVpnConfig 纯函数——桩空数组的第一块真肉）');
});

test('T-P1-5a app/bridge/src/platform-ports.ts 在盘且零 Date.now——TDD 红锚', () => {
  assert.ok(repoPathExists('app/bridge/src/platform-ports.ts'), 'platform-ports.ts 必须存在（注入层契约 + 回退桩）');
  const src = readRepo('app/bridge/src/platform-ports.ts');
  assert.ok(!/Date\.now/.test(src), 'platform-ports.ts 契约层不得出现 Date.now（DeviceClock 双轴条款：禁止真机 adapter 两轴都用 Date.now——给禁令配门）');
});

test('T-P1-7a app/tools/integration-mirror.mjs 在盘——TDD 红锚', () => {
  assert.ok(repoPathExists('app/tools/integration-mirror.mjs'), 'integration-mirror.mjs 必须存在（集成三方案工具化，CU6 判定树引用它）');
});

test('T-P1-8a A12：interop/*.ts 进 tsc 面（listFiles 覆盖 ≥3，现值 0）——TDD 红锚', { timeout: 180000 }, () => {
  const r = run('npx', ['tsc', '--noEmit', '-p', '.', '--listFiles'], { timeoutMs: 170000 });
  assert.equal(r.status, 0, `typecheck 本身应 exit 0（A12 只测覆盖面）。实测 ${r.status}：${r.stdout.slice(0, 300)}`);
  const n = r.stdout.split(/\r?\n/).filter((l) => l.includes('interop/')).length;
  assert.ok(n >= 3, `interop/ 文件在 tsc listFiles 中应 ≥3（A12 判据，第五门禁缺口）。实测 ${n}`);
});

test('T-P1-9a headscale 基线面：0.0.0.0 绑定清零（现值 2 处）——TDD 红锚', () => {
  const yaml = readRepo('interop/headscale.yaml');
  const n = (yaml.match(/0\.0\.0\.0/g) || []).length;
  assert.equal(n, 0, `headscale.yaml 的 0.0.0.0 绑定必须清零（修回 127.0.0.1，对齐 D-plan R1/R5——当前配置违反本项目自己的红线）。实测 ${n} 处`);
});

test('T-P1-9b 设备面：headscale.device.yaml 存在且 server_url 非 127.0.0.1——TDD 红锚', () => {
  assert.ok(repoPathExists('interop/headscale.device.yaml'), 'headscale.device.yaml 必须存在（O3 豁免的设备侧配置，原 yaml 语义不动）');
  const y = readRepo('interop/headscale.device.yaml');
  const m = /server_url:\s*(\S+)/.exec(y);
  assert.ok(m, 'device.yaml 必须有 server_url');
  assert.notEqual(m[1], 'http://127.0.0.1:8080', `设备侧 server_url 不得是 127.0.0.1（手机会连到自己——D3）；应为 LAN 地址占位 + 环境变量注入`);
});

test('T-P1-9c interop/env-check.mjs 存在且无 docker 逐项 SKIP exit 0——TDD 红锚', { timeout: 60000 }, () => {
  assert.ok(repoPathExists('interop/env-check.mjs'), 'env-check.mjs 必须存在（环境自检：docker 可达/镜像可拉/端口空闲/健康检查）');
  const r = run('node', ['interop/env-check.mjs'], { timeoutMs: 55000 });
  assert.equal(r.status, 0, `无 docker 时 env-check 必须 exit 0（逐项 SKIP 非崩溃）。实测 ${r.status}：${(r.stdout + r.stderr).slice(0, 300)}`);
  assert.ok(/SKIP/i.test(r.stdout), '输出必须逐项 SKIP（显式，非静默）');
});

test('T-P1-10a provenance：manifest.json + UNRESOLVED.md + 行号对拍脚本在盘——TDD 红锚', () => {
  assert.ok(repoPathExists('docs/upstream/manifest.json'), 'docs/upstream/manifest.json 必须存在（每份快照 {path,source_url,fetched_at,upstream_commit|null,note}——缺 SHA 显式 null 不许编）');
  assert.ok(repoPathExists('docs/upstream/UNRESOLVED.md'), 'UNRESOLVED.md 必须存在（58 份未归档 .go 欠账登记——无网补不了，凭笔记反推=伪造）');
  assert.ok(repoPathExists('scripts/upstream-lineref.mjs'), 'upstream-lineref.mjs 必须存在（file.go:LNNN 行号对拍门）');
});

test('T-P1-11a 证据链：EVIDENCE-SPEC.md + evidence-manifest.mjs 在盘——TDD 红锚', () => {
  assert.ok(repoPathExists('docs/pre-device/EVIDENCE-SPEC.md'), 'EVIDENCE-SPEC.md 必须存在（E1–E6 六条规范）');
  assert.ok(repoPathExists('interop/evidence-manifest.mjs'), 'evidence-manifest.mjs 必须存在（缺 reason/缺 marker/缺环境指纹三类分别报错）');
});

test('T-P1-13a perf 四件套源码在盘（app/tools/perf/ ≥4 份）——TDD 红锚', () => {
  const files = listFiles('app/tools/perf', '.').filter((f) => /\.(ts|ets|mjs)$/.test(f));
  assert.ok(files.length >= 4, `app/tools/perf/ 应 ≥4 份源码（x25519/aead-throughput/hash/handshake-e2e）。实测 ${files.length}`);
});

test('T-P1-14a gates 聚合：scripts/gates.mjs + npm script 在——TDD 红锚', () => {
  assert.ok(repoPathExists('scripts/gates.mjs'), 'scripts/gates.mjs 必须存在（聚合 A1–A9+文档门，真机 agent Day1 与 A 类验收共用同一判据）');
  const pkg = JSON.parse(readRepo('package.json'));
  assert.ok(typeof pkg.scripts.gates === 'string', 'package.json.scripts 必须含 gates');
});
