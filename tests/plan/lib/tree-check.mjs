// 用途：判定树完备性自检器（TESTS-2026-10-03，TESTS.md §4.2）。
// 断言对象是「给真机 agent 的判定树」本身——树有洞 = agent 自由发挥 = R1（环境失败误诊为代码问题）入口。
// 树载体：Markdown ```tree 代码块（文档即数据，无双源）。行文法（缩进 2 空格一层）：
//   Q <条件问句>                 —— 二元条件节点（恰有两个互斥出边 Y/N）
//     Y → <动作或子问句引用>      —— 出边：动作行或直接嵌下一个 Q
//     N → <动作或子问句引用>
//       动作: <做什么>            —— 叶子三元组之一
//       回报: <回报字段>          —— 叶子三元组之二
//       升人: 否 | 是(D10-<编号>) —— 叶子三元组之三；「是」必须映射 D10 六条之一
// 五断言：①Q 恰两出边（Y/N 齐）②路径终于叶子（三元组齐）③升人叶映射 D10 ④无悬空引用（详见/见上文/同上/占位符 <...> 出现在可执行动作行即红）⑤动作行引用的仓内工具/文件真实存在。
// 本模块是 P0-6 交付物 scripts/check-decision-trees.mjs 的规格内核。
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const D10_IDS = ['D10-①', 'D10-②', 'D10-③', 'D10-④', 'D10-⑤', 'D10-⑥', 'D10-1', 'D10-2', 'D10-3', 'D10-4', 'D10-5', 'D10-6'];
const DANGLING_RE = /详见|见上文|同上|待填|TODO|TBD|待定/;

/** 抽出文本中全部 ```tree 代码块。 */
export function extractTreeBlocks(text) {
  const blocks = [];
  const lines = text.split(/\r?\n/);
  let inTree = false;
  let cur = null;
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^```tree\s*$/.test(lines[i].trim())) {
      inTree = true;
      cur = [];
      startLine = i + 2;
      continue;
    }
    if (inTree && /^```\s*$/.test(lines[i].trim())) {
      blocks.push({ lines: cur, startLine });
      inTree = false;
      cur = null;
      continue;
    }
    if (inTree) cur.push(lines[i]);
  }
  if (inTree) throw new Error(`tree 块未闭合（起于第 ${startLine - 1} 行附近）`);
  return blocks;
}

const indentOf = (s) => {
  const m = /^[ ]*/.exec(s);
  return m ? m[0].length : 0;
};

/** 校验单个 tree 块。返回错误数组（空=通过）。repoRoot 用于第 5 断言的工具存在性。 */
export function checkTree(block, repoRoot) {
  const errs = [];
  const rows = block.lines
    .map((raw, idx) => ({ raw, idx: idx + block.startLine, text: raw.trim(), indent: indentOf(raw) }))
    .filter((r) => r.text.length > 0);

  // 直接子行 = 从父行之后连续的更深缩进行中，缩进恰为父+2 的行（嵌套更深的属子树，跨兄弟不得串门——实测首版按全块 indent 过滤会把兄弟的叶子算进自己的孩子）
  const directKids = (parentIdx) => {
    const kids = [];
    for (let j = parentIdx + 1; j < rows.length; j++) {
      if (rows[j].indent <= rows[parentIdx].indent) break;
      if (rows[j].indent === rows[parentIdx].indent + 2) kids.push(rows[j]);
    }
    return kids;
  };

  // ① 每个 Q 节点恰有 Y/N 两出边
  const qRows = rows.map((r, i) => ({ ...r, i })).filter((r) => /^Q\s/.test(r.text));
  for (const q of qRows) {
    const edges = directKids(q.i).filter((r) => /^[YN] →/.test(r.text));
    const ys = edges.filter((e) => e.text.startsWith('Y →'));
    const ns = edges.filter((e) => e.text.startsWith('N →'));
    if (ys.length !== 1 || ns.length !== 1) {
      errs.push(`L${q.idx}: Q 节点必须恰有一对 Y/N 出边（实测 Y=${ys.length} N=${ns.length}）——「${q.text.slice(0, 40)}」`);
    }
  }
  if (qRows.length === 0) errs.push('tree 块内没有任何 Q 节点（空树/纯文本不是判定树）');

  // ② 每条出边必须终于叶子三元组（动作:/回报:/升人: 三行齐）或嵌下一个 Q
  const edgeRows = rows.map((r, i) => ({ ...r, i })).filter((r) => /^[YN] →/.test(r.text));
  for (const e of edgeRows) {
    const kids = directKids(e.i);
    const hasLeaf = ['动作:', '回报:', '升人:'].every((k) => kids.some((r) => r.text.startsWith(k)));
    const hasSubQ = kids.some((r) => /^Q\s/.test(r.text));
    if (!hasLeaf && !hasSubQ) {
      errs.push(`L${e.idx}: 出边未终于叶子（动作:/回报:/升人: 三元组缺）也未嵌子 Q——「${e.text.slice(0, 40)}」`);
    }
  }

  // ③ 升人: 是(...) 必须映射 D10 六条之一
  for (const r of rows.filter((r) => r.text.startsWith('升人:'))) {
    if (/^升人:\s*是/.test(r.text)) {
      if (!D10_IDS.some((d) => r.text.includes(d))) {
        errs.push(`L${r.idx}: 升人叶必须映射 D10 六条之一（编号引用）——「${r.text.slice(0, 40)}」`);
      }
    } else if (!/^升人:\s*否/.test(r.text)) {
      errs.push(`L${r.idx}: 升人字段只允许 是(...)/否 两种取值——「${r.text.slice(0, 40)}」`);
    }
  }

  // ④ 悬空引用 / 空占位
  for (const r of rows) {
    if (DANGLING_RE.test(r.text)) {
      errs.push(`L${r.idx}: 悬空引用或空占位（详见/见上文/同上/待填/TODO/TBD/待定）——「${r.text.slice(0, 40)}」`);
    }
  }

  // ⑤ 动作行引用的仓内工具/文件必须存在（node/bash/sh/npx 的目标按路径查；npm run 的目标是脚本名不查路径）。
  //    占位符 <...> 出现在动作行即红。
  for (const r of rows.filter((r) => r.text.startsWith('动作:'))) {
    const m = /(?:^|\s)(?:node|npx|bash|sh)\s+([^\s]+)/.exec(r.text);
    const ref = m ? m[1].replace(/[),.;]$/, '') : null;
    if (/<[A-Za-z][^>]*>/.test(r.text)) {
      errs.push(`L${r.idx}: 动作行含未替换占位符 <...>（死占位进可执行命令即红）——「${r.text.slice(0, 50)}」`);
    }
    if (ref && !ref.startsWith('-') && !/^npm/.test(ref)) {
      const p = isAbsolute(ref) ? ref : join(repoRoot, ref);
      if (!existsSync(p)) {
        errs.push(`L${r.idx}: 动作引用的工具/文件不在仓内——「${ref}」`);
      }
    }
  }
  return errs;
}

/** 便捷入口：对整篇 Markdown 的全部 tree 块跑五断言。返回 {blockCount, errs}。 */
export function checkMarkdownTrees(text, repoRoot) {
  const blocks = extractTreeBlocks(text);
  let errs = [];
  for (const b of blocks) errs = errs.concat(checkTree(b, repoRoot));
  return { blockCount: blocks.length, errs };
}
