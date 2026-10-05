// 用途：tests/plan 共用执行器（TESTS-2026-10-03，docs/pre-device-plan/TESTS.md §0.4 测量纪律）。
// 纪律：凡断言退出码，必须与被测进程直连——`cmd | tail; $?` 捕到的是 tail 的退出码（轨迹实测踩过）。
// 本 helper 一律 spawnSync 直取 status/stdout/stderr，不做任何管道中转。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as fs from 'node:fs';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** 直连执行：返回 {status, stdout, stderr}。cmd 用数组形态，不经 shell 分词。
 * 两个实测坑的防御：
 *  ① node --test 会给被测文件进程注入 NODE_TEST_CONTEXT=child-v*——不剥离则子进程 node --test/npm test
 *    进入 child 模式（exit 0 但 stdout 无 TAP 汇总——假绿形态，亲验）；
 *  ② win32 下 npm/npx 是 .cmd——spawnSync('npm') 不经 shell 会 ENOENT（status=null，红在别处）。
 */
export function run(cmd, args = [], opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  delete env.NODE_TEST_CONTEXT;
  const needsShell = process.platform === 'win32' && /^(npm|npx)$/.test(cmd);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || REPO_ROOT,
    encoding: 'utf8',
    env,
    timeout: opts.timeoutMs || 120000,
    input: opts.stdin,
    shell: needsShell,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 以 file:// 绝对 URL 导入仓内生产代码（禁 import 仓内 *.test.ts / 测试 helper——holdout 纪律，可见集同守）。 */
export async function importRepo(relPath) {
  return import('file:///' + join(REPO_ROOT, relPath).replace(/\\/g, '/'));
}

/** 读仓内文件文本。 */
export function readRepo(relPath) {
  return fs.readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

export function repoPathExists(relPath) {
  return fs.existsSync(join(REPO_ROOT, relPath));
}

/** 递归枚举目录下匹配后缀的文件（绝对路径数组）。目录不存在返回 []。 */
export function listFiles(relDir, suffix) {
  const out = [];
  const walk = (abs) => {
    let ents;
    try {
      ents = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(suffix)) out.push(p);
    }
  };
  walk(join(REPO_ROOT, relDir));
  return out;
}

/** 从 node --test 的 TAP 输出解析顶层用例结果（缩进子 test 不计）。返回 [{name, ok}]。 */
export function parseTap(testOutput) {
  const res = [];
  for (const line of testOutput.split(/\r?\n/)) {
    const m = /^(not )?ok \d+ - (.+)$/.exec(line);
    if (m) res.push({ name: m[2].trim(), ok: !m[1] });
  }
  return res;
}
