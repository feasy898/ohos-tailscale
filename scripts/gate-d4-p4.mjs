#!/usr/bin/env node
/**
 * D4/P4 机检门 —— PLAN P0-4。
 *
 * 存在的理由：G0-5 原先在 yml 里内联裸 grep，有三处坏——
 *   ①引号 bug：正则里的 `['\"]` 提前闭合外层单引号，整段 `bash -n` 都过不了（语法死=从未执行）；
 *   ②死过滤器：yml 里那条「行首空白 + 行注释」的 grep -v 规则从不命中——grep -n 输出以
 *     `path:lineno:` 开头，行首永远不是空白，该规则等于没过滤；注释行实际靠后面的
 *     「空格 星号 空格」过滤器侥幸挡掉；
 *   ③人工复核路径与 CI 路径各写一份，改一处就漂。
 * 抽成脚本后二者同工具同声明面。
 *
 * 检索面（每次运行都会打印，"沉默只扫一部分"不允许）：
 *   packages 各包的 src 子目录  +  app/bridge/src   —— R9 已批准扩面（app/bridge/src 三段现值 0 命中）
 * app/entry 的 .ets 面归 validate:arkts (b) 面，两门检索面交集为空。
 * app/entry/src/main/ets/platform/ 纪律面（PLAN §3.3）现无机检，作为已登记缺口记录，
 * 不假装 R9 覆盖了它。
 *
 * --root <dir> 禁令：仅限 meta 测试/临时副本运行。CI 与生产调用必须走默认根。
 *
 * 用法：node scripts/gate-d4-p4.mjs [--root <dir>]
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, realpathSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

/** 规则级豁免（R13）。默认空集——app/tools/perf 在面外是事实不是豁免。 */
const EXEMPTIONS = [
  // { path: 'packages/x/src/y.ts', rule: 'P4', reason: '为什么必须豁免（不得留空）' }
];

/** 检索面：目录 glob 的展开在 scanSurface 里做。 */
const SURFACE = ['packages/*/src', 'app/bridge/src'];

const RULES = [
  {
    id: 'P4',
    title: 'P4 · 非确定性来源（Date.now / Math.random）',
    pattern: 'Date\\.now|Math\\.random',
    surface: SURFACE,
    skipTests: true,
    note: '核心库禁直接取时钟/随机源，一律经 common 注入',
  },
  {
    id: 'NODE',
    title: 'node: builtin 导入（非测试源码）',
    // 三形态：from 'node:' / import('node:') / require('node:')。
    // 裸 `node:` 字面量会误报 app/bridge/src/mock-localapi.ts:229 的 `const node:` 型标注（R9 反例）。
    pattern: "from ['\"]node:|import\\(['\"]node:|require\\(['\"]node:",
    surface: SURFACE,
    skipTests: true,
    note: '协议核心包不得依赖 Node builtin',
  },
  {
    id: 'D4',
    title: 'D4 · 网络能力（fetch / XHR / WebSocket）与 builtin 模块导入',
    pattern: "fetch\\(|XMLHttpRequest|WebSocket|from ['\"](net|dgram|http|https|tls|dns|fs|path|os|child_process|crypto)['\"]",
    surface: SURFACE,
    skipTests: true,
    note: 'D4 核心库零网络：协议包不得引入任何传输能力',
  },
  {
    id: 'O4',
    title: 'O4 · 核心包零 CLI 面（console. / process. / globalThis）',
    pattern: 'console\\.|process\\.|globalThis',
    surface: ['packages/*/src'],
    skipTests: true,
    note: 'tsc 在 types:["node"] 下拦不住 process，只有真机才炸——防 CLI 面渗入冻结包',
  },
];

/** 把带星号的目录 glob 展开成真实目录。 */
function expandSurface(root, globs) {
  const out = [];
  for (const g of globs) {
    if (!g.includes('*')) {
      if (existsDir(join(root, g))) out.push(g);
      continue;
    }
    // 注意：'a/*/b'.split('*') 只有 2 段（'a/' 与 '/b'），星号本身不占位——
    // 用解构空位取尾段会把 tail 取成 undefined，glob 静默展开成空面。
    const parts = g.split('*');
    const head = parts[0];
    const tail = parts[parts.length - 1];
    const parent = join(root, head);
    if (!existsDir(parent)) continue;
    let n = 0;
    for (const name of readdirSync(parent)) {
      const rel = (head + name + tail).split(sep).join('/');
      if (existsDir(join(root, rel))) {
        out.push(rel);
        n += 1;
      }
    }
    if (n === 0) {
      throw new Error(`检索面 glob "${g}" 展开成 0 个目录（根：${root}）——拒绝"沉默只扫一部分"`);
    }
  }
  return out;
}

function existsDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function countTsFiles(root, relDir) {
  const abs = join(root, relDir);
  const stack = [abs];
  let n = 0;
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(p);
      else if (name.endsWith('.ts')) n += 1;
    }
  }
  return n;
}

/** 注释行判定：替掉 yml 里那两条半失效的过滤器。 */
function isComment(content) {
  const t = content.trim();
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/');
}

function exempted(hitPath, ruleId) {
  return EXEMPTIONS.find((e) => e.rule === ruleId && e.path === hitPath) ?? null;
}

function runRule(root, rule, relDirs) {
  const hits = [];
  for (const relDir of relDirs) {
    const abs = join(root, relDir);
    const r = spawnSync('grep', ['-rEn', rule.pattern, relDir, '--include=*.ts'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (r.error) {
      console.error(`gate:d4 无法执行 grep：${r.error.message}`);
      process.exit(2);
    }
    // grep -n 输出形如 `path:lineno:content`——第二段是行号，第三段起才是内容。
    for (const line of r.stdout.split(/\r?\n/)) {
      if (line === '') continue;
      const parts = line.split(':');
      if (parts.length < 3) continue;
      const hitPath = `${parts[0]}:${parts[1]}`;
      const content = parts.slice(2).join(':');
      if (rule.skipTests && parts[0].includes('.test.ts')) continue;
      if (isComment(content)) continue;
      if (exempted(hitPath, rule.id)) continue;
      hits.push(`  ${hitPath}:${content.trim()}`);
    }
  }
  return hits;
}

function main() {
  const argv = process.argv.slice(2);
  let root = REPO_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') {
      const given = argv[i + 1];
      if (given === undefined) {
        console.error('FAIL: --root 需要一个目录参数');
        process.exit(2);
      }
      root = realpathSync(resolve(process.cwd(), given));
      i += 1;
    } else {
      console.error(`FAIL: 未知参数 ${argv[i]}`);
      process.exit(2);
    }
  }

  const isCopy = root !== REPO_ROOT;
  let relDirs;
  try {
    relDirs = expandSurface(root, SURFACE);
  } catch (e) {
    console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  if (relDirs.length === 0) {
    console.error('FAIL: 检索面为空——脚本扫了个寂寞（"沉默只扫一部分"不允许）');
    process.exit(2);
  }

  console.log('=== D4/P4 机检门 ===');
  console.log(`根目录：${root}${isCopy ? '（--root 副本运行：仅限 meta 测试/临时副本，CI 与生产必须用默认根）' : ''}`);
  console.log(`检索面（${relDirs.length} 个目录）：${relDirs.join(', ')}`);
  console.log(
    `豁免清单（R13 规则级，默认 ${EXEMPTIONS.length === 0 ? '空集' : `${EXEMPTIONS.length} 条`}）：` +
      (EXEMPTIONS.length === 0
        ? '（空集）'
        : EXEMPTIONS.map((e) => `${e.rule} ${e.path} — ${e.reason}`).join('；')),
  );
  if (EXEMPTIONS.length > 0) {
    for (const e of EXEMPTIONS) {
      if (e.path === undefined || e.path === '' || e.reason === undefined || e.reason === '') {
        console.error('FAIL: 存在缺 path 或缺 reason 的豁免——豁免必须规则级且写明理由');
        process.exit(2);
      }
      if (!RULES.some((r) => r.id === e.rule)) {
        console.error(`FAIL: 豁免引用了不存在的规则 ${e.rule}——豁免不得凭空造段`);
        process.exit(2);
      }
    }
    // 非全集：某规则的豁免数不得覆盖该规则整个检索面（那等于把门关掉而不是登记例外）。
    for (const r of RULES) {
      const ruleDirs = expandSurface(root, r.surface);
      const faceSize = ruleDirs.reduce((acc, d) => acc + countTsFiles(root, d), 0);
      const exemptCount = EXEMPTIONS.filter((e) => e.rule === r.id).length;
      if (exemptCount > 0 && faceSize > 0 && exemptCount >= faceSize) {
        console.error(`FAIL: 规则 ${r.id} 的豁免覆盖了整个检索面（${exemptCount} >= ${faceSize}）——这不是豁免，是把门关掉`);
        process.exit(2);
      }
    }
  }
  console.log('面外（已登记缺口，不假装覆盖）：app/entry 的 .ets 面归 validate:arkts(b)；app/entry/.../platform/ 纪律面现无机检。');
  console.log('');

  // --root 副本自证等价：被检面文件数必须与仓内一致，否则副本是残缺的，结论不可移植。
  if (isCopy) {
    const baseDirs = expandSurface(REPO_ROOT, SURFACE);
    const baseCount = baseDirs.reduce((acc, d) => acc + countTsFiles(REPO_ROOT, d), 0);
    const copyCount = relDirs.reduce((acc, d) => acc + countTsFiles(root, d), 0);
    console.log(`等价自证：仓内被检 .ts ${baseCount} 个 vs 副本 ${copyCount} 个`);
    if (baseCount !== copyCount) {
      console.error(`FAIL: 副本与仓内被检面文件数不一致（${baseCount} ≠ ${copyCount}）——副本残缺，结论不可移植`);
      process.exit(2);
    }
    console.log('');
  }

  let failed = 0;
  for (const rule of RULES) {
    const ruleDirs = expandSurface(root, rule.surface);
    const hits = runRule(root, rule, ruleDirs);
    console.log(`--- ${rule.title} ---`);
    console.log(`    面：${ruleDirs.join(', ')}｜${rule.note}`);
    if (hits.length === 0) {
      console.log('    0 命中 ✓');
    } else {
      failed += 1;
      console.log(`    ${hits.length} 命中 ✗`);
      for (const h of hits) console.log(h);
    }
    console.log('');
  }

  if (failed > 0) {
    console.error(`D4/P4 机检未通过：${failed}/${RULES.length} 段有命中`);
    process.exit(1);
  }
  console.log(`D4/P4 全 ${RULES.length} 段 0 命中 ✓`);
}

main();
