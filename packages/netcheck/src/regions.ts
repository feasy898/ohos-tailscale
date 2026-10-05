/**
 * netcheck 引擎的最小 DERP map 输入视图与「发给谁」的地址规则。
 *
 * 【裁定】不在引擎里直接复用 packages/derp 的 DerpRegion/DerpNode： derp 缺
 * stunOnly/stunTestIP/noMeasureNoHome/avoid 等字段且引擎需要 per-family 双延迟表；
 * (b) architecture.md D1/D2 依赖图只定义 derp→common 单向边，新增 netcheck→derp
 * 边属架构变更须走 AU 修订。本包自定义最小视图（仓内惯例：各包自定义注入接口
 * 定义在本包内），app 侧从 tailcfg DERPMap / derp 包适配。
 *
 * 字段级语义逐条对齐上游 tailcfg/derpmap.go（2026-10-02 实拉 @3ce5e209971d）：
 * - Node.IPv4/IPv6：'' = 走 DNS；非 IP 字面量 = 不用该族；"none" = 禁该族（:216-228）；
 * - Node.STUNPort：0 = 3478；-1（负）= 禁 STUN（:230-233；netcheck.go:1667-1672）；
 * - Node.STUNOnly：纯 STUN 非 DERP 节点（:235-237），只影响 HTTPS/ICMP 回退候选
 *   （regionHasDERPNode，netcheck.go:1756-1763）；
 * - Node.STUNTestIP：测试覆盖 STUN 目标 IP（:249-251）；
 * - Region.Avoid：deprecated，排序跳过但 home 例外（derpmap.go:145-159）；
 * - Region.NoMeasureNoHome：整体不测、不做 home（:161-169）；
 * - HomeParams.RegionScore：缺省 1.0；≤0 忽略（:49-66）。
 */

import { STUN_DEFAULT_PORT } from '@ohos-tailscale/common';
import { type NetAddr, parseIpLiteral } from './addr.ts';

/** 探测协议族（上游 probeProto uint8，netcheck.go:355-362；R5 常量对象）。 */
export interface ProbeProtoE {
  IPv4: number;
  IPv6: number;
  Https: number;
}

export const PROTO: ProbeProtoE = { IPv4: 0, IPv6: 1, Https: 2 };

/** 上游 tailcfg.DERPNode 的引擎所需字段视图（字段语义见文件头注）。 */
export interface NetcheckNode {
  name: string;
  regionId: number;
  hostName: string;
  ipv4: string;
  ipv6: string;
  stunPort: number;
  stunOnly: boolean;
  stunTestIp: string;
}

/** 上游 tailcfg.DERPRegion 的引擎所需字段视图。 */
export interface NetcheckRegion {
  regionId: number;
  regionCode: string;
  nodes: NetcheckNode[];
  noMeasureNoHome: boolean;
  avoid: boolean;
}

/** 上游 tailcfg.DERPMap 的引擎输入视图（regionScore 即 HomeParams.RegionScore）。 */
export interface NetcheckDerpMap {
  regions: NetcheckRegion[];
  regionScore: Map<number, number> | null;
}

/** 上游 DERPNode.IsTestNode()（derpmap.go:258-260）。 */
export function nodeIsTestNode(n: NetcheckNode): boolean {
  return n.stunTestIp !== '' || n.ipv4 === '127.0.0.1';
}

/** 上游 nodeMight6（netcheck.go:589-599）：配置层面该节点是否可能走 v6 STUN。 */
export function nodeMight6(n: NetcheckNode): boolean {
  if (n.ipv6 === '') {
    return true;
  }
  const ip: Uint8Array | null = parseIpLiteral(n.ipv6);
  return ip !== null && ip.length === 16;
}

/** 上游 nodeMight4（netcheck.go:601-610）。 */
export function nodeMight4(n: NetcheckNode): boolean {
  if (n.ipv4 === '') {
    return true;
  }
  const ip: Uint8Array | null = parseIpLiteral(n.ipv4);
  return ip !== null && ip.length === 4;
}

/** DNS 预解析结果（按族分列；app 侧异步解析后注入的缓存视图）。 */
export interface DnsLookupResult {
  ipv4: Uint8Array[];
  ipv6: Uint8Array[];
}

/**
 * DNS 注入口（上游 net.DefaultResolver / dnscache，netcheck.go:1708-1753）。
 * 【裁定】核心态机不做异步 DNS：app 侧解析后以同步查表注入（显式 IP 节点
 * 无需此口）；RTT 起点取在解析之后（上游 :1617 sent 在 DNS 之后），同步注入
 * 天然满足「RTT 不含 DNS 时长」。
 */
export interface DnsResolver {
  lookup(host: string): DnsLookupResult;
}

/**
 * 上游 nodeAddrPort（netcheck.go:1665-1754）：STUN 探测的目标地址。
 * - port < 0 或 > 65535 → null（禁/非法）；port == 0 → 3478（:1667-1672）；
 * - STUNTestIP 覆盖且按 proto 过滤族（:1673-1685）；
 * - 显式 IPv4/IPv6 字面量优先，族不符 → null（:1687-1703）；
 * - 否则经注入 DNS 取该族第一个地址（:1708-1753）。
 */
export function nodeAddrPort(n: NetcheckNode, port: number, proto: number, dns: DnsResolver | null): NetAddr | null {
  if (port < 0 || port > 65535) {
    return null;
  }
  if (port === 0) {
    port = STUN_DEFAULT_PORT;
  }
  if (n.stunTestIp !== '') {
    const ip: Uint8Array | null = parseIpLiteral(n.stunTestIp);
    if (ip === null) {
      return null;
    }
    if (proto === PROTO.IPv4 && ip.length === 16) {
      return null;
    }
    if (proto === PROTO.IPv6 && ip.length === 4) {
      return null;
    }
    const out: NetAddr = { ip: ip, port: port };
    return out;
  }
  if (proto === PROTO.IPv4) {
    if (n.ipv4 !== '') {
      const ip: Uint8Array | null = parseIpLiteral(n.ipv4);
      if (ip === null || ip.length !== 4) {
        return null;
      }
      const out: NetAddr = { ip: ip, port: port };
      return out;
    }
  } else if (proto === PROTO.IPv6) {
    if (n.ipv6 !== '') {
      const ip: Uint8Array | null = parseIpLiteral(n.ipv6);
      if (ip === null || ip.length !== 16) {
        return null;
      }
      const out: NetAddr = { ip: ip, port: port };
      return out;
    }
  } else {
    return null; // 上游 default 分支（probeHTTPS 不在此取 STUN 地址，:1704-1706）
  }
  if (dns === null) {
    return null;
  }
  const res: DnsLookupResult = dns.lookup(n.hostName);
  const list: Uint8Array[] = proto === PROTO.IPv4 ? res.ipv4 : res.ipv6;
  for (const ip of list) {
    if (proto === PROTO.IPv4 && ip.length === 4) {
      const out: NetAddr = { ip: ip, port: port };
      return out;
    }
    if (proto === PROTO.IPv6 && ip.length === 16) {
      const out: NetAddr = { ip: ip, port: port };
      return out;
    }
  }
  return null;
}

/** 上游 regionHasDERPNode（netcheck.go:1756-1763）：是否有非 STUNOnly 节点。 */
export function regionHasDerpNode(r: NetcheckRegion): boolean {
  for (const n of r.nodes) {
    if (!n.stunOnly) {
      return true;
    }
  }
  return false;
}
