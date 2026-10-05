/**
 * 探测计划生成（纯函数）：初始计划（全 region 扫描）与增量计划（最快 region + home）。
 *
 * 上游实读依据（2026-10-02，tailscale main @3ce5e209971d，net/netcheck/netcheck.go）：
 * - 常量：defaultActiveRetransmitTime=200ms（:75-81）、
 *   defaultInitialRetransmitTime=100ms（:82-87）、numIncrementalRegions=3（:438-441）；
 * - 初始计划 makeProbePlanInitial（:559-587）：全 region（跳 NoMeasureNoHome 与
 *   空 nodes）×3 try、delay=try×100ms（0/100/200ms）、节点轮换 try%len(nodes)、
 *   v4/v6 收录条件 `n.IPv4 != "none" && ((HaveV4 && nodeMight4) || IsTestNode)`（:572-577）；
 * - 增量计划 makeProbePlan（:455-557）：sortRegions 按上次延迟升序、无数据排最后
 *   （:411-436）；home 强制包含（#13969，:466-494）；tries 默认 1、最快两名(ri<2)
 *   或 home 2、双栈机第 3 名起 ri%2 交替（:500-514）；!home && !fastestTwo && !had6
 *   → 砍 v6（:515-517）；home 4 try（:519-524）；try!=0 && !had6 → v6 只发一发
 *   （:531-532）；重传基距 = last×120/100（Go 整数除法，TS 用 Math.floor；
 *   0/缺席 → 200ms，cmp.Or 语义 :535-537）；delay = try×基距，try>1 再 +try×50ms
 *   （:538-541）。
 * - 【上游测试锚定】netcheck_test.go:560-817 TestMakeProbePlan 七个向量与本实现
 *   逐项对照（initial_v6/initial_no_v6/second_v4_no_6if/second_v4_only_with_6if/
 *   second_mixed/only_v6_initial/try_harder_for_preferred_derp/
 *   ensure_home_region_inclusion）。
 *
 * 【有意分歧】上游 plan 是 Go map（迭代随机）、sortRegions 用不稳定排序且并列
 * 依赖 map 迭代序。本实现输出确定性数组（region 按 sortRegions 序、v4 组先于
 * v6 组），排序并列显式按 regionId 升序——并列时的相对顺序上游本就不确定，
 * 固定化只为可测，不改变任何单组内容。
 */

import { type NetcheckRegion, type NetcheckDerpMap, PROTO, nodeIsTestNode, nodeMight4, nodeMight6 } from './regions.ts';
import { type NetcheckReport } from './report.ts';

/** 稳态（有历史无该 region 数据）重传基距（上游 :75-81）。 */
export const DEFAULT_ACTIVE_RETRANSMIT_MS: number = 200;

/** 首轮重传基距（上游 :82-87）。 */
export const DEFAULT_INITIAL_RETRANSMIT_MS: number = 100;

/** 增量报告扫描的最快 region 数（上游 :438-441）。 */
export const NUM_INCREMENTAL_REGIONS: number = 3;

/** 单条探测（上游 probe{delay,node,proto,wait}，:376-393；wait 是死字段——
 * netcheck.go 全文无读取点——不建模，见研究笔记 §8.8）。 */
export interface ProbeSpec {
  node: string;
  regionId: number;
  proto: number;
  /** 相对报告开始的发送延时（毫秒）。 */
  delayMs: number;
}

/** 一个并发组：同 key 内任一探测得到答案即取消其余（netcheck.go:395-406、:1619-1624）。 */
export interface ProbeGroup {
  key: string;
  probes: ProbeSpec[];
}

/**
 * 上游 sortRegions（netcheck.go:411-436）：先滤 NoMeasureNoHome 与
 * Avoid（home 例外），再按 last.RegionLatency 升序、无数据排最后。
 * 【分歧】并列按 regionId 升序（上游为不稳定排序 + map 迭代序）。
 */
export function sortRegions(regions: NetcheckRegion[], lastRegionLatency: Map<number, number>, preferredDERP: number): NetcheckRegion[] {
  const kept: NetcheckRegion[] = [];
  for (const reg of regions) {
    if (reg.noMeasureNoHome) {
      continue;
    }
    if (reg.avoid && reg.regionId !== preferredDERP) {
      continue;
    }
    kept.push(reg);
  }
  const cmp = (a: NetcheckRegion, b: NetcheckRegion): number => {
    // 上游以 duration 零值表示「无数据」（:424-434 的 da==0/db==0 判断）：
    // 这里同时把 缺席 与 显式 0 视为无数据，逐字对齐 Go 零值语义。
    const da: number | undefined = lastRegionLatency.get(a.regionId);
    const db: number | undefined = lastRegionLatency.get(b.regionId);
    const aHas: boolean = da !== undefined && da !== 0;
    const bHas: boolean = db !== undefined && db !== 0;
    if (aHas && bHas) {
      const va: number = da as number;
      const vb: number = db as number;
      if (va !== vb) {
        return va - vb;
      }
      return a.regionId - b.regionId;
    }
    if (aHas) {
      return -1; // 非零排零前（上游 :426-427）
    }
    if (bHas) {
      return 1; // 零不能排任何东西前（上游 :429-431）
    }
    return a.regionId - b.regionId;
  };
  kept.sort(cmp);
  return kept;
}

/**
 * 初始计划（上游 makeProbePlanInitial，netcheck.go:559-587）。
 * makeProbePlan 在 last==nil 或 last.RegionLatency 空时路由到此（:456-458）。
 */
export function makeProbePlanInitial(map: NetcheckDerpMap, haveV4: boolean, haveV6: boolean): ProbeGroup[] {
  const groups: ProbeGroup[] = [];
  for (const reg of map.regions) {
    if (reg.noMeasureNoHome || reg.nodes.length === 0) {
      continue;
    }
    const p4: ProbeSpec[] = [];
    const p6: ProbeSpec[] = [];
    for (let tryI: number = 0; tryI < 3; tryI += 1) {
      const n = reg.nodes[tryI % reg.nodes.length];
      const delayMs: number = tryI * DEFAULT_INITIAL_RETRANSMIT_MS;
      if (n.ipv4 !== 'none' && ((haveV4 && nodeMight4(n)) || nodeIsTestNode(n))) {
        const spec: ProbeSpec = { node: n.name, regionId: reg.regionId, proto: PROTO.IPv4, delayMs: delayMs };
        p4.push(spec);
      }
      if (n.ipv6 !== 'none' && ((haveV6 && nodeMight6(n)) || nodeIsTestNode(n))) {
        const spec: ProbeSpec = { node: n.name, regionId: reg.regionId, proto: PROTO.IPv6, delayMs: delayMs };
        p6.push(spec);
      }
    }
    if (p4.length > 0) {
      const g: ProbeGroup = { key: 'region-' + String(reg.regionId) + '-v4', probes: p4 };
      groups.push(g);
    }
    if (p6.length > 0) {
      const g: ProbeGroup = { key: 'region-' + String(reg.regionId) + '-v6', probes: p6 };
      groups.push(g);
    }
  }
  return groups;
}

/**
 * 增量计划（上游 makeProbePlan，netcheck.go:455-557）。last 为上一份报告
 * （全量场景被置 null，:898-903）；preferredDERP 独立传入，因为全量时 last
 * 被藏起（:443-447 注释）。
 */
export function makeProbePlan(map: NetcheckDerpMap, haveV4: boolean, haveV6: boolean, last: NetcheckReport | null, preferredDERP: number): ProbeGroup[] {
  if (last === null || last.regionLatency.size === 0) {
    return makeProbePlanInitial(map, haveV4, haveV6);
  }
  const had4: boolean = last.regionV4Latency.size > 0;
  const had6: boolean = last.regionV6Latency.size > 0;
  const hadBoth: boolean = haveV6 && had4 && had6;
  // #13969：home 必须在计划内；无历史 home 则无事可保（:480）
  let planContainsHome: boolean = preferredDERP === 0;
  const sorted: NetcheckRegion[] = sortRegions(map.regions, last.regionLatency, preferredDERP);
  const groups: ProbeGroup[] = [];
  for (let ri: number = 0; ri < sorted.length; ri += 1) {
    const reg: NetcheckRegion = sorted[ri];
    const regIsHome: boolean = reg.regionId === preferredDERP;
    if (ri >= NUM_INCREMENTAL_REGIONS) {
      if (planContainsHome) {
        break; // 最快 3 个 + home 已齐
      }
      if (!regIsHome) {
        continue; // 只放行 home（:491-493）
      }
    }
    let do4: boolean = haveV4;
    let do6: boolean = haveV6;
    let tries: number = 1;
    const isFastestTwo: boolean = ri < 2;
    if (isFastestTwo || regIsHome) {
      tries = 2;
    } else if (hadBoth) {
      // 双栈机第 3 名起 v4/v6 交替（:506-514）
      if (ri % 2 === 0) {
        do4 = true;
        do6 = false;
      } else {
        do4 = false;
        do6 = true;
      }
    }
    if (!regIsHome && !isFastestTwo && !had6) {
      do6 = false; // 无 v6 历史时非重点 region 不打 v6（:515-517）
    }
    if (regIsHome) {
      // home 多打两发防 flip-flop（:519-524）
      tries = 4;
      planContainsHome = true;
    }
    const p4: ProbeSpec[] = [];
    const p6: ProbeSpec[] = [];
    for (let tryI: number = 0; tryI < tries; tryI += 1) {
      if (reg.nodes.length === 0) {
        continue; // 上游 :527-530
      }
      if (tryI !== 0 && !had6) {
        do6 = false; // 无 v6 历史时 v6 只发一发不重试（:531-532）
      }
      const n = reg.nodes[tryI % reg.nodes.length];
      // 重传基距：last×120/100（Go 整数除法→floor）；0/缺席 → 200ms（cmp.Or :535-537）
      let prevLatency: number = Math.floor(((last.regionLatency.get(reg.regionId) ?? 0) * 120) / 100);
      if (prevLatency === 0) {
        prevLatency = DEFAULT_ACTIVE_RETRANSMIT_MS;
      }
      let delayMs: number = tryI * prevLatency;
      if (tryI > 1) {
        delayMs += tryI * 50; // try>1 的追加间隔（:538-541）
      }
      // 增量收录条件只查 "none" 字面量（与初始计划的 nodeMight 链不同，:542-547）
      if (n.ipv4 !== 'none' && (do4 || nodeIsTestNode(n))) {
        const spec: ProbeSpec = { node: n.name, regionId: reg.regionId, proto: PROTO.IPv4, delayMs: delayMs };
        p4.push(spec);
      }
      if (n.ipv6 !== 'none' && (do6 || nodeIsTestNode(n))) {
        const spec: ProbeSpec = { node: n.name, regionId: reg.regionId, proto: PROTO.IPv6, delayMs: delayMs };
        p6.push(spec);
      }
    }
    if (p4.length > 0) {
      const g: ProbeGroup = { key: 'region-' + String(reg.regionId) + '-v4', probes: p4 };
      groups.push(g);
    }
    if (p6.length > 0) {
      const g: ProbeGroup = { key: 'region-' + String(reg.regionId) + '-v6', probes: p6 };
      groups.push(g);
    }
  }
  return groups;
}
