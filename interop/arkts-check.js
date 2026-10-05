// 驱动华为 ets-loader 内置 ArkTSLinter 对本仓 packages/ 做官方 ArkTS 检查
// 用法: node arkts-check.js [repoRoot]
// ARKTS_SDK_HOME=<SDK 根目录> 可选；未设或空串时仅输出 SKIP 信息并 exit 0
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire as cr } from 'node:module';

const repo = process.argv[2] || fileURLToPath(new URL('.', import.meta.url));

function loadTypeScript() {
  const sdkRoot = process.env.ARKTS_SDK_HOME;
  if (!sdkRoot) {
    console.log('SKIP: ARKTS_SDK_HOME is not set or empty');
    console.log('ARKTS_SDK_HOME=' + JSON.stringify(sdkRoot) + '，跳过扫描');
    process.exit(0);
  }
  const candidate = path.join(sdkRoot, 'ets/ets/build-tools/ets-loader/node_modules/typescript');
  try {
    const stats = fs.statSync(candidate);
    if (!stats.isDirectory()) {
      console.error('ARKTS_SDK_HOME 不存在或 SDK 目录无效: ' + sdkRoot);
      console.error('typescript 候选路径不存在或非目录: ' + candidate);
      process.exit(2);
    }
  } catch (e) {
    console.error('ARKTS_SDK_HOME 不存在或 SDK 目录无效: ' + sdkRoot);
    console.error('候选路径异常: ' + candidate + ' (' + (e.code || 'error') + ')');
    process.exit(2);
  }
  const require2 = cr(import.meta.url);
  return require2(candidate);
}

// 把 scanRootReal 限定在 repo 根下（防 symlink/相对路径逃逸；与 Mimosa 路径穿越提示闭环）。
const repoReal = fs.realpathSync(repo);
function walk(dir, ext, out) {
  // lstat（不 follow symlink），symlink 一律跳过——避免越界出 repo。
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      walk(p, ext, out);
    } else if (e.isFile() && p.endsWith(ext)) {
      out.push(p);
    }
  }
  return out;
}

const ts = loadTypeScript();

const scanExt = process.env.SCAN_EXT || '.ts';
const scanRootEnv = process.env.SCAN_ROOT || path.join(repo, 'packages');
// 二次校验：scanRootReal 必须落在 repoReal 下；否则拒绝启动。
// 例外：`ARKTS_SCAN_ALLOW_EXTERNAL=1` 由 arkts-mirror.sh 显式声明，因为该脚本
// 在 $HOME/arkts-scan/ 下做 .ts → .ets 镜像后扫描（属于 A-2 复建路径的离线工作流）；
// 没有该环境变量时 SCAN_ROOT 逃逸出仓库直接退出。
const allowExternal = process.env.ARKTS_SCAN_ALLOW_EXTERNAL === '1';
const scanRootReal = fs.realpathSync(scanRootEnv);
if (!(scanRootReal === repoReal || scanRootReal.startsWith(repoReal + path.sep))) {
  if (!allowExternal) {
    console.error('SCAN_ROOT escapes repo root: ' + scanRootEnv + ' -> ' + scanRootReal);
    console.error('提示：本仓库内扫描使用默认值即可；若通过 arkts-mirror.sh 做 .ets 镜像后离线扫描，');
    console.error('     请设 ARKTS_SCAN_ALLOW_EXTERNAL=1 显式声明（见 docs/arkts-linter-rebuild.md）。');
    process.exit(2);
  }
  console.warn('SCAN_ROOT escapes repo root but ARKTS_SCAN_ALLOW_EXTERNAL=1：' + scanRootReal);
}
const files = walk(scanRootReal, scanExt, []);
console.log('scanning ' + files.length + ' ' + scanExt + ' files under ' + scanRootReal);
const options = {
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  strict: true,
  allowImportingTsExtensions: true,
  types: [],
};
const host = ts.createWatchCompilerHost(
  files,
  options,
  ts.sys,
  ts.createSemanticDiagnosticsBuilderProgram,
  () => undefined,
  () => undefined,
);
host.afterProgramCreate = (builderProgram) => {
  let diags = [];
  try {
    const linter = ts.ArkTSLinter_1_0 || ts.ArkTSLinter_1_1;
    diags = linter.runArkTSLinter(builderProgram, undefined, undefined, 'ArkTS_1_0');
  } catch (e) {
    console.error('runArkTSLinter threw:', e && e.message);
    process.exit(2);
  }
  console.log('arkts linter diagnostics: ' + diags.length);
  const byFile = new Map();
  for (const d of diags) {
    const f = d.file;
    let loc = '<no-file>';
    if (f) {
      const pos = f.getLineAndCharacterOfPosition(d.start || 0);
      loc = f.fileName.replace(scanRootReal + '/', '').replace(repo + '/', '') + ':' + (pos.line + 1) + ':' + (pos.character + 1);
    }
    const msg = typeof d.messageText === 'string' ? d.messageText : JSON.stringify(d.messageText);
    const fileKey = loc.split(':')[0];
    if (!byFile.has(fileKey)) byFile.set(fileKey, []);
    byFile.get(fileKey).push(loc + ' [' + d.code + '] ' + msg);
  }
  for (const [f, lines] of byFile) {
    console.log('== ' + f + ' (' + lines.length + ')');
    for (const l of lines.slice(0, 6)) console.log('   ' + l.slice(0, 220));
  }
  process.exit(0);
};
ts.createWatchProgram(host);
