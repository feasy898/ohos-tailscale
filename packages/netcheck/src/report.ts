/**
 * netcheck 报告结构（上游 Report，netcheck.go:90-131）与结果合并规则。
 *
 * 上游实读依据（2026-10-02 实拉 @3ce5e209971d，net/netcheck/netcheck.go）：
 * - 纯 bool：UDP/IPv6/IPv4/IPv6CanSend/IPv4CanSend/OSHasIPv6/ICMPv4（:93-99）；
 * - 三态 opt.Bool：MappingVariesByDestIP/UPnP/PMP/PCP/CaptivePortal（:101-128）；
 * - 三张延迟表 map[regionID]duration（:115-118）+ PreferredDERP（0=未知）；
 * - GlobalV4/V6 与 Counters（:120-124）；
 * - Clone 深拷全部 map（:175-186）——TS 手写逐字段拷贝（A27 禁对象展开/A31 禁
 *   Object.assign）；
 * - GetGlobalAddrs（:137-168）：GlobalV4/V6 在前 + 计数>1 的其余端点
 *   （单次出现的端点疑似 hard NAT 临时映射，排除）；
 * - updateLatency 最小合并（:1565-1569：!ok || d<prev 才写）与
 *   maxDurationValue（:1765-1772）。
 *
 * 【陷阱】GlobalV4 与 GlobalV6 语义不对称（研究笔记 §8.7）：
 * - GlobalV4 = 第一次观察到的端点（reportState.gotEP4 哨兵，:724-727）；
 * - GlobalV6 = 每次覆盖取最新（:715）。
 * 该规则在 engine.addNodeLatency 中实现，本文件只承载字段。
 *
 * 【有意分歧】GetGlobalAddrs 的「其余端点」输出顺序：上游为 Go map 迭代序
 * （不确定），此处固定为 计数降序 → 端点键升序。文档注释 "best latency
 * endpoint first"（:134）与实现（首见/末见端点在前）有出入，以代码为准。
 */

import { OptBool } from './opt.ts';
import { type NetAddr, addrEqual, cloneAddr, endpointKey } from './addr.ts';

/** 端点观察计数载体。 */
export interface EndpointCounter {
  addr: NetAddr;
  count: number;
}

/** GetGlobalAddrs 的返回（v4/v6 两组端点）。 */
export interface GlobalAddrsResult {
  v4: NetAddr[];
  v6: NetAddr[];
}

/** 一次 netcheck 的结果（上游 Report）。 */
export class NetcheckReport {
  /** 报告时刻（挂钟毫秒；上游 r.Now = now.UTC()，netcheck.go:1410）。 */
  public nowMs: number = 0;
  /** UDP STUN 往返完成（:93）。 */
  public udp: boolean = false;
  public ipv6: boolean = false;
  public ipv4: boolean = false;
  public ipv6CanSend: boolean = false;
  public ipv4CanSend: boolean = false;
  public osHasIpv6: boolean = false;
  public icmpV4: boolean = false;

  public mappingVariesByDestIp: OptBool = new OptBool();
  public upnp: OptBool = new OptBool();
  public pmp: OptBool = new OptBool();
  public pcp: OptBool = new OptBool();
  public captivePortal: OptBool = new OptBool();

  /** home region；0 = 未知（:115）。 */
  public preferredDERP: number = 0;
  public regionLatency: Map<number, number> = new Map<number, number>();
  public regionV4Latency: Map<number, number> = new Map<number, number>();
  public regionV6Latency: Map<number, number> = new Map<number, number>();

  public globalV4Counters: Map<string, EndpointCounter> = new Map<string, EndpointCounter>();
  public globalV6Counters: Map<string, EndpointCounter> = new Map<string, EndpointCounter>();
  public globalV4: NetAddr | null = null;
  public globalV6: NetAddr | null = null;

  /** 上游 Clone（:175-186）：深拷四类 map 与三态对象，逐字段手写（A27/A31）。 */
  public clone(): NetcheckReport {
    const r2: NetcheckReport = new NetcheckReport();
    r2.nowMs = this.nowMs;
    r2.udp = this.udp;
    r2.ipv6 = this.ipv6;
    r2.ipv4 = this.ipv4;
    r2.ipv6CanSend = this.ipv6CanSend;
    r2.ipv4CanSend = this.ipv4CanSend;
    r2.osHasIpv6 = this.osHasIpv6;
    r2.icmpV4 = this.icmpV4;
    r2.mappingVariesByDestIp = this.mappingVariesByDestIp.copy();
    r2.upnp = this.upnp.copy();
    r2.pmp = this.pmp.copy();
    r2.pcp = this.pcp.copy();
    r2.captivePortal = this.captivePortal.copy();
    r2.preferredDERP = this.preferredDERP;
    for (const rid of this.regionLatency.keys()) {
      r2.regionLatency.set(rid, this.regionLatency.get(rid) as number);
    }
    for (const rid of this.regionV4Latency.keys()) {
      r2.regionV4Latency.set(rid, this.regionV4Latency.get(rid) as number);
    }
    for (const rid of this.regionV6Latency.keys()) {
      r2.regionV6Latency.set(rid, this.regionV6Latency.get(rid) as number);
    }
    for (const key of this.globalV4Counters.keys()) {
      const c: EndpointCounter = this.globalV4Counters.get(key) as EndpointCounter;
      const cp: EndpointCounter = { addr: cloneAddr(c.addr), count: c.count };
      r2.globalV4Counters.set(key, cp);
    }
    for (const key of this.globalV6Counters.keys()) {
      const c: EndpointCounter = this.globalV6Counters.get(key) as EndpointCounter;
      const cp: EndpointCounter = { addr: cloneAddr(c.addr), count: c.count };
      r2.globalV6Counters.set(key, cp);
    }
    if (this.globalV4 !== null) {
      r2.globalV4 = cloneAddr(this.globalV4);
    }
    if (this.globalV6 !== null) {
      r2.globalV6 = cloneAddr(this.globalV6);
    }
    return r2;
  }

  /**
   * 上游 GetGlobalAddrs（:137-168）：GlobalV4/V6 在前；其余只收 计数>1 的端点。
   * 【分歧】其余端点按 计数降序→键升序（上游 Go map 迭代序不定）。
   */
  public getGlobalAddrs(): GlobalAddrsResult {
    const v4: NetAddr[] = [];
    const v6: NetAddr[] = [];
    if (this.globalV4 !== null) {
      v4.push(cloneAddr(this.globalV4));
    }
    if (this.globalV6 !== null) {
      v6.push(cloneAddr(this.globalV6));
    }
    this.appendRepeated(v4, this.globalV4Counters, this.globalV4);
    this.appendRepeated(v6, this.globalV6Counters, this.globalV6);
    const out: GlobalAddrsResult = { v4: v4, v6: v6 };
    return out;
  }

  private appendRepeated(list: NetAddr[], counters: Map<string, EndpointCounter>, first: NetAddr | null): void {
    const rest: EndpointCounter[] = [];
    for (const c of counters.values()) {
      rest.push(c);
    }
    const sortCmp = (a: EndpointCounter, b: EndpointCounter): number => {
      if (a.count !== b.count) {
        return b.count - a.count; // 计数降序
      }
      const ka: string = endpointKey(a.addr);
      const kb: string = endpointKey(b.addr);
      if (ka !== kb) {
        return ka < kb ? -1 : 1; // 键升序
      }
      return 0;
    };
    rest.sort(sortCmp);
    for (const c of rest) {
      if (c.count <= 1) {
        continue; // 单次出现的端点排除（:155/:163）
      }
      if (addrEqual(c.addr, first)) {
        continue; // 与 GlobalV4/V6 重复（:152/:160）
      }
      list.push(cloneAddr(c.addr));
    }
  }

  /** 上游 AnyPortMappingChecked（:170-173）：任一端口映射协议已检测。 */
  public anyPortMappingChecked(): boolean {
    return this.upnp.isSet() || this.pmp.isSet() || this.pcp.isSet();
  }
}

/** 延迟表最小合并（上游 updateLatency，:1565-1569：缺席或更小才写）。 */
export function updateLatency(m: Map<number, number>, regionId: number, dMs: number): void {
  const prev: number | undefined = m.get(regionId);
  if (prev === undefined || dMs < prev) {
    m.set(regionId, dMs);
  }
}

/** 表内最大延迟（上游 maxDurationValue，:1765-1772；空表 0）。 */
export function maxDurationValue(m: Map<number, number>): number {
  let max: number = 0;
  for (const v of m.values()) {
    if (v > max) {
      max = v;
    }
  }
  return max;
}

/** 供计数器合并使用的递增（上游 mak.Set(&counters, ipp, counters[ipp]+1)）。 */
export function bumpEndpointCounter(counters: Map<string, EndpointCounter>, ipp: NetAddr): void {
  const key: string = endpointKey(ipp);
  const cur: EndpointCounter | undefined = counters.get(key);
  if (cur === undefined) {
    const fresh: EndpointCounter = { addr: cloneAddr(ipp), count: 1 };
    counters.set(key, fresh);
    return;
  }
  cur.count += 1;
}
