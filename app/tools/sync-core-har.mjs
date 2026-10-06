#!/usr/bin/env node
/**
 * CU6 方案 B 落地脚本：把仓库协议包（packages/*，纯 TS）同步进 app 的 hvigor
 * HAR 模块目录（app/core-har/*），供 entry 以本地依赖引用并随 HAP 打包。
 *
 * 用法（在仓根执行）：
 *   node app/tools/sync-core-har.mjs
 *
 * 原则：
 * - packages/ 仍是唯一源；本脚本只做「复制 + 壳模板」，不改协议源码一个字节
 *   （含 './x.ts' 相对导入与 '@ohos-tailscale/*' 裸说明符，保持 npm 侧可测）。
 * - 壳文件（oh-package.json5 / hvigorfile.ts / build-profile.json5 / Index.ets）
 *   仅在缺失时生成，不覆盖手工修改。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packagesDir = join(repoRoot, 'packages');
const harRoot = join(repoRoot, 'app', 'core-har');

// noise/wireguard 依赖 common/crypto；四包即 CU6 判据所需闭包。
const PACKAGES = ['common', 'crypto', 'noise', 'wireguard'];
const DEPS = {
  common: {},
  crypto: { '@ohos-tailscale/common': 'file:../common' },
  noise: { '@ohos-tailscale/common': 'file:../common', '@ohos-tailscale/crypto': 'file:../crypto' },
  wireguard: { '@ohos-tailscale/common': 'file:../common', '@ohos-tailscale/crypto': 'file:../crypto' },
};

const readDesc = (p) => JSON.parse(readFileSync(join(packagesDir, p, 'package.json'), 'utf8'));

let changed = 0;
for (const p of PACKAGES) {
  const srcDir = join(packagesDir, p, 'src');
  const dstEts = join(harRoot, p, 'src', 'main', 'ets');
  const desc = readDesc(p);

  // 1) 源码同步：清掉旧 .ts 再整目录拷贝（防删源残留）
  if (existsSync(dstEts)) {
    for (const f of readdirSync(dstEts)) {
      if (f.endsWith('.ts')) rmSync(join(dstEts, f));
    }
  }
  mkdirSync(dstEts, { recursive: true });
  for (const f of readdirSync(srcDir)) {
    if (!f.endsWith('.ts')) continue;
    if (!statSync(join(srcDir, f)).isFile()) continue;
    cpSync(join(srcDir, f), join(dstEts, f));
    changed++;
  }

  // 2) 壳模板（缺失才生成）
  const ohPkg = join(harRoot, p, 'oh-package.json5');
  if (!existsSync(ohPkg)) {
    const deps = Object.entries(DEPS[p])
      .map(([k, v]) => `    "${k}": "${v}"`)
      .join(',\n');
    writeFileSync(
      ohPkg,
      `// 由 app/tools/sync-core-har.mjs 生成（CU6 方案 B）：源 = packages/${p}\n` +
        `{\n  "name": "${desc.name}",\n  "version": "${desc.version}",\n` +
        `  "description": "${(desc.description || '').replace(/"/g, "'")}",\n` +
        `  "main": "src/main/ets/index.ts",\n  "author": "ohos-tailscale contributors",\n  "license": "BSD-3-Clause",\n` +
        (deps ? `  "dependencies": {\n${deps}\n  }\n` : '') +
        `}\n`
    );
    changed++;
  }
  const hvigorfile = join(harRoot, p, 'hvigorfile.ts');
  if (!existsSync(hvigorfile)) {
    writeFileSync(hvigorfile, `// HAR 模块（CU6 方案 B，模板生成）：静态库构建任务\nimport { harTasks } from '@ohos/hvigor-ohos-plugin';\n\nexport default {\n  system: harTasks,\n  plugins: []\n}\n`);
    changed++;
  }
  const buildProfile = join(harRoot, p, 'build-profile.json5');
  if (!existsSync(buildProfile)) {
    writeFileSync(
      buildProfile,
      `{\n  "apiType": "stageMode",\n  "buildOption": {\n  },\n  "targets": [\n    {\n      "name": "default"\n    }\n  ]\n}\n`
    );
    changed++;
  }
  const moduleJson = join(harRoot, p, 'src', 'main', 'module.json5');
  if (!existsSync(moduleJson)) {
    // hvigor 要求 HAR 模块也有 src/main/module.json5（00304064），type 固定 "har"
    writeFileSync(
      moduleJson,
      `{\n  "module": {\n    "name": "${p}",\n    "type": "har",\n    "deviceTypes": [\n      "phone",\n      "tablet"\n    ]\n  }\n}\n`
    );
    changed++;
  }
}
console.log(`sync-core-har: ${PACKAGES.length} 个 HAR 模块就绪（同步 ${changed} 个文件写入）→ ${harRoot.replace(repoRoot + '/', '')}`);
