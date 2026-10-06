/**
 * DERP region 内拨号编排（B3：region 内「选节点」的上游对齐实现）。
 *
 * 上游语义（实读归档 docs/upstream/ts-main/derphttp_client.go，2026-09 基线 ≈ main；
 * 逐条行号见 docs/research/2026-10-02-B3-derp-pick.md §4）：
 * - DERPRegion.Nodes 是控制面为当前客户端排好的优先序（derpmap.go:171-183）——客户端
 *   **不做** region 内随机洗牌，本编排严格按数组序回退（dialRegion，:637-657）；
 * - STUNOnly 节点不是 DERP relay，必须跳过且不计入拨号（:640-647）；
 * - 首个可连即用（:648-650）；全败返回**第一个**节点的错误对象（firstErr 只在为 nil 时
 *   覆写，:651-656）——不是最后一个错误；
 * - 单节点拨号预算 1500ms（dialNodeTimeout，:728）、整场（DNS+TCP+TLS+HTTP 升级+DERP
 *   升级）10s（:355-359）：核心库 P3/P4 禁计时（无 timer 注入不引入 node: 计时），
 *   两个预算由注入 DerpDialer 的实现侧执行（app/ 侧拥有计时器），本编排只负责顺序、
 *   跳过与错误语义；
 * - 连到非 Nodes[0] 时，上游在 HTTP 升级请求带 `Ideal-Node: <Nodes[0].Name>` 头，纯
 *   统计用途，主动迁回首节点是未实现的 TODO（:511-524，tracking issue #12724）——本
 *   结果以 isIdealNode 表达该判定，头由 app/ 侧 TLS/HTTP 层自行发送；**不要**据此实现
 *   「定期迁回 Nodes[0]」并声称对齐上游。
 */

import { type DerpConnection, type DerpDialer } from './connection.ts';
import { DerpError } from './frame.ts';
import { type DerpNode, type DerpRegion, derpUsableNodes } from './region.ts';

/** derpDialRegion 的成功结果。 */
export interface DerpRegionDialResult {
  conn: DerpConnection;
  node: DerpNode; // 实际连上的节点（可连给 DerpClient 的 cfg.node）
  isIdealNode: boolean; // node === region.nodes[0]（上游 idealNodeInRegion，derphttp_client.go:436-440）
}

/**
 * region 内按序拨号回退（上游 derphttp Client.dialRegion 的核心库形态，:637-657）：
 * 按数组序对每个非 stunOnly 节点调 dialer.dial，首个成功即返回；某节点失败则原地继续
 * 下一个；全部失败时抛**第一个**节点的错误对象（保持对象同一性，供调用方归因）。
 * 空 region 抛 DerpError('RANGE', 'no nodes for …')；全 stunOnly 抛
 * DerpError('RANGE', 'no non-STUNOnly nodes for …')（对齐上游 firstErr 文本，:637/:642）。
 */
export async function derpDialRegion(dialer: DerpDialer, region: DerpRegion): Promise<DerpRegionDialResult> {
  if (region.nodes.length === 0) {
    throw new DerpError('RANGE', 'no nodes for derp-' + String(region.regionId)) as Error;
  }
  const usable: DerpNode[] = derpUsableNodes(region);
  if (usable.length === 0) {
    throw new DerpError('RANGE', 'no non-STUNOnly nodes for derp-' + String(region.regionId)) as Error;
  }
  let firstErr: Error | null = null;
  for (const n of usable) {
    let conn: DerpConnection | null = null;
    try {
      conn = await dialer.dial(n);
    } catch (e) {
      const err: Error = e as Error;
      if (firstErr === null) {
        firstErr = err; // 上游 firstErr 只记第一个错误（derphttp_client.go:651-656）
      }
      continue;
    }
    const result: DerpRegionDialResult = { conn: conn, node: n, isIdealNode: region.nodes[0] === n };
    return result;
  }
  throw firstErr !== null ? firstErr : (new DerpError('STATE', 'derp dial failed without attempts') as Error);
}
