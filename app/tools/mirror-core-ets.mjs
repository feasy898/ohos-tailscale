#!/usr/bin/env node
/**
 * CU6 方案 C 实验脚本：把协议包关键 .ts 源镜像进 entry 模块（app/entry/src/main/ets/protocol/）。
 *
 * 两种变体：
 *   node app/tools/mirror-core-ets.mjs          → 改后缀 .ets（ArkTS 严格模式编译）
 *   node app/tools/mirror-core-ets.mjs --ts     → 保留 .ts 后缀（按 TS 编译）
 *
 * 重写规则（只动 import 说明符，不动任何逻辑）：
 *   './x.ts'            → './x'（去 .ts 后缀，loader 按 .ets/.ts 解析）
 *   '@ohos-tailscale/<pkg>' → '../<pkg>/index'（镜像树内相对路径）
 *
 * 注意：本脚本属 CU6 探测；若方案 B（HAR 化）胜出，此文件仅作为失败/对照证据保留。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const asTs = process.argv.includes('--ts');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packagesDir = join(repoRoot, 'packages');
const outRoot = join(repoRoot, 'app', 'entry', 'src', 'main', 'ets', 'protocol');

const PACKAGES = ['common', 'crypto', 'noise', 'wireguard'];

if (existsSync(outRoot)) rmSync(outRoot, { recursive: true });

let n = 0;
for (const p of PACKAGES) {
  const srcDir = join(packagesDir, p, 'src');
  const dstDir = join(outRoot, p);
  mkdirSync(dstDir, { recursive: true });
  for (const f of readdirSync(srcDir)) {
    if (!f.endsWith('.ts')) continue;
    let text = readFileSync(join(srcDir, f), 'utf8');
    // 1) 相对导入去 .ts 后缀
    text = text.replace(/(from\s+')(\.\/[\w-]+)\.ts(')/g, "$1$2$3");
    // 2) 跨包裸说明符 → 镜像树相对路径
    text = text.replace(/(from\s+')@ohos-tailscale\/(\w+)(')/g, "$1../$2/index$3");
    const ext = asTs ? '.ts' : '.ets';
    writeFileSync(join(dstDir, f.replace(/\.ts$/, ext)), text);
    n++;
  }
}
console.log(`mirror-core-ets: ${n} 个文件镜像到 ${outRoot.replace(repoRoot + '/', '')}（变体=${asTs ? '.ts' : '.ets'}）`);
