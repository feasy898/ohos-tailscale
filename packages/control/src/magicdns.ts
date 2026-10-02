/**
 * MagicDNS 名字解析核心（net/dns 纯逻辑子集：dnsname + dnsConfigForNetmap +
 * compileConfig 决策 + resolver 决策序）（C3 子线）。
 *
 * ✅ 上游核对（v1.102.3 tag 实拉逐行核对，2026-10-03 本会话复拉验证；行号均指该 tag）：
 * - util/dnsname/dnsname.go:14-17（label ≤63 / 总长 ≤254）、:23-66 ToFQDN
 *   （返回恒带尾点；"" 与 "." 归一为 "."）；节点名匹配统一 lowercase + 去尾点
 *   （ipn/ipnlocal/node_backend.go:1295），裸主机名仅 Proxied 才解析（:1296-1299）。
 * - magicDNSRootDomains（ipn/ipnlocal/local.go:6479-6501）＝ MagicDNSSuffix +
 *   "0.e.1.a.c.5.1.1.a.7.d.f.ip6.arpa."（fd7a:115c:a1e0::/48 nibble 反转）+
 *   64..127 共 64 条 "<i>.100.in-addr.arpa."（CGNAT /10 的 /16 分片）＝ 65 条。
 * - dnsConfigForNetmap（node_backend.go:1456-1649，本会话逐条复核）：
 *   ①nil netmap→nil；②self key 过期→空 Config（防把仅 tailnet 可达的 resolver
 *   写进 OS）；③AcceptDNS=prefs.CorpDNS；④self 仅 v6→OnlyIPv6；⑤AllCaps 含
 *   NodeAttrMagicDNSPeerAAAA="magicdns-aaaa"（tailcfg/tailcfg.go:2766 @v1.102.3）→wantAAAA；
 *   ⑥Hosts 装载：仅 Windows 装 self+全部 peer 名（hosts 文件回退），其他平台只装
 *   DNS.ExtraRecords；⑦!CorpDNS 提前返回；⑧Domains→SearchDomains；⑨Proxied=true→
 *   Routes[root]=nil（权威内部解析）否则 MagicDNSHostsUnrouted=SelfNode.Valid()
 *   （保住 quad-100 在 OS resolver 路径）；⑩exit node DoH：默认 resolver=
 *   DNS.Resolvers 里 UseWithExitNode 者，无则 [peerAPIBase+"/dns-query"]，叠加
 *   exit 路由后提前返回；⑪len(Resolvers)>0→DefaultResolvers；⑫Routes 全量进
 *   （**空数组也是条目=权威 NXDOMAIN，issue 2706**）；⑬FallbackResolvers 仅
 *   「无 DefaultResolvers 且选了老 exit node」时用。
 * - compileConfig（net/dns/manager.go:306-330）：Routes 里 len(resolvers)==0 的条目
 *   转 resolver.Config.LocalDomains（权威区）；OS 恒拿搜索域；
 *   serviceIPs（net/dns/config.go:79-100）：OnlyIPv6→[v6]，否则默认 [v4,v6]
 *   （knob 可强制 v4-only）。
 * - resolver 决策序（net/dns/resolver/tsdns.go:723-838，本会话逐行复核）：
 *   ①.onion→NXDOMAIN（RFC 7686）；②名字==dnsSymbolicFQDN→A=100.100.100.100 /
 *   AAAA=fd7a:115c:a1e0::53（tsaddr.go:66-68）；③Hosts 精确→magicHosts.LookupHost
 *   →沿 Parent() 查 SubdomainHosts/magicHosts.SubdomainHost；④未命中→LocalDomains
 *   后缀包含→权威 NXDOMAIN；否则 RCodeRefused（内部哨兵，交给 forwarder 按最长
 *   后缀 Routes 转发）；⑤命中后才按类型分流：A/AAAA 取该族首个，无该族记录→
 *   **NOERROR 空（非 NXDOMAIN）**；ALL 取首个；NS/SOA/AXFR/HINFO→NOTIMP
 *   （**必须在后缀检查之后**，否则该转发的请求被 NOTIMP）；未知类型→NOERROR 空。
 * - 反解（tsdns.go:903-958 resolveLocalReverse/fqdnForIPLocked）：quad-100 两个
 *   服务 IP → 符号名 dnsSymbolicFQDN="magicdns.localhost-tailscale-daemon."（:45）；
 *   ipToHost 精确→magicHosts.LookupPTR；否则 LocalDomains 包含**查询名**→NXDOMAIN；
 *   否则 REFUSED。
 * - TTL 与上限：正答 TTL 5s（:58）、负答 10s+SOA（:68，RFC 2308）、应答 >4095B
 *   置 TC（:50）、转发查询超时 10s（:406）。
 * - magicDNSAddrs（node_backend.go:1308-1350）：self v6-only→peer 全部 v6；否则
 *   peer 的 v6 在 peer 同时有 v4 且未设 wantAAAA 时隐藏（issue 1152）。
 *
 * 范围裁定：本模块是「名字→(RCode,记录)」的纯函数核 + 配置推导；DNS wire format
 * （dnsmessage 打包）与 UDP/TCP 监听不在本包（app/ 侧载体）。4via6 合成名
 * （tsdns.go:841-900）依赖 4via6 前缀推导，属二期另一件，未实现（resolveLocal
 * 中该分支上游位于符号名之后、Hosts 之前，本实现留注释锚点）。
 *
 * JSON 边界：本模块不触碰 JSON（R3）——输入一律结构化视图，tailcfg JSON 解码
 * 由 tailcfg.ts/netmap.ts/localapi.ts 承担。
 */

import {
  addrToString,
  parseIp,
  parsePrefix,
  tryParseIp,
  type IpAddr,
  type IpPrefix,
} from './netaddr.ts';

// ---- dnsname（util/dnsname/dnsname.go 子集） ----

/** RFC 1035 label 上限（dnsname.go:14）。 */
export const MAX_DNS_LABEL_LEN: number = 63;
/** DNS 名总长上限（dnsname.go:16；含尾点语义见 ToFQDN :34-38）。 */
export const MAX_DNS_NAME_LEN: number = 254;

/**
 * ToFQDN（dnsname.go:23-66）：归一化出恒带尾点的 FQDN。"" 与 "." 返回 "."；
 * 首导点剥除；任一 label 空或 >63、总长（缺尾点补 1 计入）>254 → 抛 Error。
 * 不做大小写折叠（匹配层统一 lowercase，node_backend.go:1295）。
 */
export function toFqdn(s: string): string {
  if (s.length === 0 || s === '.') {
    return '.';
  }
  let t: string = s;
  if (t.charAt(0) === '.') {
    t = t.slice(1);
  }
  let body: string = t;
  let total: number = t.length;
  if (body.charAt(body.length - 1) === '.') {
    body = body.slice(0, body.length - 1);
  } else {
    total += 1;
  }
  if (total > MAX_DNS_NAME_LEN) {
    throw new Error('dnsname: "' + s + '" is too long to be a DNS name');
  }
  let start: number = 0;
  for (let i: number = 0; i <= body.length; i += 1) {
    if (i === body.length || body.charAt(i) === '.') {
      const labelLen: number = i - start;
      if (labelLen === 0 || labelLen > MAX_DNS_LABEL_LEN) {
        throw new Error('dnsname: invalid DNS label in "' + s + '"');
      }
      start = i + 1;
    }
  }
  return body + '.';
}

/** FQDN 是否带尾点（宽松：非空即视为 FQDN 形态由 toFqdn 保证）。 */
export function withTrailingDot(name: string): string {
  if (name.length === 0 || name.charAt(name.length - 1) === '.') {
    return name;
  }
  return name + '.';
}

/** 去尾点（dnsname.WithoutTrailingDot 语义；"." 除外——返回 ""）。 */
export function withoutTrailingDot(name: string): string {
  if (name.length > 1 && name.charAt(name.length - 1) === '.') {
    return name.slice(0, name.length - 1);
  }
  if (name === '.') {
    return '';
  }
  return name;
}

/** HasSuffix（dnsname.go:180-186 语义）：忽略 name 首点与 suffix 尾点后的后缀包含。 */
export function dnsNameHasSuffix(name: string, suffix: string): boolean {
  const n: string = withoutTrailingDot(withTrailingDot(name).toLowerCase());
  const s: string = withoutTrailingDot(suffix.toLowerCase());
  if (s.length === 0) {
    return true;
  }
  return n.endsWith(s);
}

/**
 * Contains（dnsname.go:86-95 语义）：suffix 权威区包含 name（后缀包含且边界对齐）。
 * 两边统一 lowercase（匹配纪律，node_backend.go:1295）。
 */
export function dnsNameContains(suffix: string, name: string): boolean {
  return dnsNameHasSuffix(name, suffix);
}

/** Parent()（dnsname.go:88 附近语义）：去首 label；到根返回 ""（终止哨兵）。 */
export function parentOf(fqdn: string): string {
  const n: string = withTrailingDot(fqdn);
  if (n === '.') {
    return '';
  }
  const idx: number = n.indexOf('.');
  const rest: string = n.slice(idx + 1);
  if (rest === '.') {
    return '';
  }
  return rest;
}

// ---- 常量 ----

/** 正答 TTL（tsdns.go:58 defaultTTL = 5s；写死别的数字会破坏对端缓存行为）。 */
export const MAGIC_DNS_POSITIVE_TTL_S: number = 5;

/** 负答 TTL（tsdns.go:68 negativeTTL = 10s，含 SOA，RFC 2308）。 */
export const MAGIC_DNS_NEGATIVE_TTL_S: number = 10;

/** 应答上限：>4095B 截断置 TC（tsdns.go:47-50 maxResponseBytes）。 */
export const MAX_DNS_RESPONSE_BYTES: number = 4095;

/** 转发查询超时（tsdns.go:406 dnsQueryTimeout = 10s）。 */
export const DNS_QUERY_TIMEOUT_MS: number = 10000;

/** quad-100 符号名（tsdns.go:45）：反解服务 IP 得此名，正向查此名得服务 IP。 */
export const DNS_SYMBOLIC_FQDN: string = 'magicdns.localhost-tailscale-daemon.';

/** quad-100 服务 IPv4（net/tsaddr/tsaddr.go:66 TailscaleServiceIPString）。 */
export const TAILSCALE_SERVICE_IP_V4: string = '100.100.100.100';

/** quad-100 服务 IPv6（net/tsaddr/tsaddr.go:67 TailscaleServiceIPv6String）。 */
export const TAILSCALE_SERVICE_IP_V6: string = 'fd7a:115c:a1e0::53';

/** fd7a:115c:a1e0::/48 的 ip6.arpa 反解区（local.go:6488 逐字）。 */
export const ULA_REVERSE_ZONE: string = '0.e.1.a.c.5.1.1.a.7.d.f.ip6.arpa.';

/**
 * magicDNSRootDomains（local.go:6479-6501）：suffix 非空 → [suffix, ip6.arpa 区,
 * 64..127 的 100.in-addr.arpa 共 64 条] = 65 条；空 suffix → []（无 MagicDNS）。
 */
export function magicDNSRootDomains(magicDnsSuffix: string): string[] {
  if (magicDnsSuffix === '') {
    return [];
  }
  const out: string[] = [];
  out.push(toFqdn(magicDnsSuffix.toLowerCase()));
  out.push(ULA_REVERSE_ZONE);
  for (let i: number = 64; i <= 127; i += 1) {
    out.push(String(i) + '.100.in-addr.arpa.');
  }
  return out;
}

// ---- DNS 类型/RCode 常量（RFC 1035 标准值；localapi.go:1783-1816 同表） ----

export interface DnsTypeE {
  A: number;
  NS: number;
  CNAME: number;
  SOA: number;
  PTR: number;
  HINFO: number;
  MINFO: number;
  MX: number;
  TXT: number;
  AAAA: number;
  SRV: number;
  OPT: number;
  WKS: number;
  AXFR: number;
  ALL: number;
}

export const DnsType: DnsTypeE = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  HINFO: 13,
  MINFO: 14,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  OPT: 41,
  WKS: 11,
  AXFR: 252,
  ALL: 255,
};

export interface DnsRCodeE {
  NOERROR: number;
  SERVFAIL: number;
  NXDOMAIN: number;
  NOTIMP: number;
  REFUSED: number;
}

export const DnsRCode: DnsRCodeE = { NOERROR: 0, SERVFAIL: 2, NXDOMAIN: 3, NOTIMP: 4, REFUSED: 5 };

// ---- 反解名字（tsdns.go rdnsNameToIPv4/6 与 ip → arpa 名） ----

/** IP → PTR 查询名（v4: 4 组反序八位组 + in-addr.arpa.；v6: 32 nibble 反序 + ip6.arpa.）。 */
export function ipToPtrFqdn(addr: IpAddr): string {
  const labels: string[] = [];
  if (addr.is4) {
    for (let i: number = 3; i >= 0; i -= 1) {
      labels.push(String(addr.bytes[i]));
    }
    return labels.join('.') + '.in-addr.arpa.';
  }
  for (let i: number = 15; i >= 0; i -= 1) {
    const b: number = addr.bytes[i];
    labels.push(HEX_NIBBLE[b & 0x0f]);
    labels.push(HEX_NIBBLE[(b >> 4) & 0x0f]);
  }
  return labels.join('.') + '.ip6.arpa.';
}

const HEX_NIBBLE: string[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];

/**
 * arpa 名 → IP（tsdns.go rdnsNameToIPv4/6 语义）：不是合法反解名返回 null
 * （v4 须恰 4 组十进制 label；v6 须恰 32 组 nibble label）。
 */
export function ptrFqdnToIp(name: string): IpAddr | null {
  const lower: string = withTrailingDot(name.toLowerCase());
  if (dnsNameHasSuffix(lower, '.in-addr.arpa.')) {
    const base: string = withoutTrailingDot(lower.slice(0, lower.length - '.in-addr.arpa.'.length));
    const labels: string[] = base.split('.');
    if (labels.length !== 4) {
      return null;
    }
    const bytes: Uint8Array = new Uint8Array(4);
    for (let i: number = 0; i < 4; i += 1) {
      const v: number = Number(labels[i]);
      if (!Number.isInteger(v) || v < 0 || v > 255 || labels[i].length === 0) {
        return null;
      }
      bytes[3 - i] = v;
    }
    const out: IpAddr = { is4: true, bytes: bytes };
    return out;
  }
  if (dnsNameHasSuffix(lower, '.ip6.arpa.')) {
    const base: string = withoutTrailingDot(lower.slice(0, lower.length - '.ip6.arpa.'.length));
    const labels: string[] = base.split('.');
    if (labels.length !== 32) {
      return null;
    }
    const bytes: Uint8Array = new Uint8Array(16);
    for (let i: number = 0; i < 32; i += 1) {
      const nib: number = HEX_NIBBLE.indexOf(labels[i]);
      if (nib < 0) {
        return null;
      }
      // label 0 是 byte15 的低位 nibble：byteIdx = 15 - floor(i/2)；
      // 偶数 label = 低位 nibble、奇数 label = 高位 nibble。
      const byteIdx: number = 15 - Math.floor(i / 2);
      if (i % 2 === 0) {
        bytes[byteIdx] = (bytes[byteIdx] & 0xf0) | nib;
      } else {
        bytes[byteIdx] = (bytes[byteIdx] & 0x0f) | (nib << 4);
      }
    }
    const out: IpAddr = { is4: false, bytes: bytes };
    return out;
  }
  return null;
}

// ---- dnsConfigForNetmap（node_backend.go:1456-1649） ----

/** dnstype.Resolver 子集（Addr + UseWithExitNode，exit node DoH 过滤用）。 */
export interface DnsResolverSpec {
  addr: string;
  useWithExitNode: boolean;
}

/** tailcfg.DNSConfig.Routes 的一个条目：null = 权威应答（Routes[dom]=nil 形态）；[] 亦然。 */
export interface DnsRouteEntry {
  suffix: string;
  /** null/[] = 权威区（compileConfig 转 LocalDomains）；非空 = 转发目标。 */
  resolvers: DnsResolverSpec[] | null;
}

/** tailcfg.DNSRecord（ts-main/tailcfg.go DNSConfig.ExtraRecords 元素）。 */
export interface DnsExtraRecord {
  name: string;
  type: string;
  data: string;
}

/** peer 名→地址视图（Windows hosts 装载与按需 MagicDNSHosts 的输入）。 */
export interface DnsNodeHostView {
  /** 节点 FQDN（MagicDNS 全名，尾点可带可不带；装载时统一 toFqdn+lowercase）。 */
  fqdn: string;
  /** 节点全部地址（prefix 字符串，取 /32、/128 单机地址）。 */
  addresses: string[];
}

/** dnsConfigForNetmap 的输入视图（netmap+prefs+self 状态的解耦快照）。 */
export interface NetmapDnsView {
  /** netmap 是否已到达（nil netmap → 返回 null，node_backend.go:1457-1459）。 */
  netmapPresent: boolean;
  /** self node key 已过期（→ 空 Config，:1472-1474）。 */
  selfExpired: boolean;
  /** prefs.CorpDNS（→ AcceptDNS，:1477）。 */
  corpDns: boolean;
  /** self 地址 prefix 列表（判 v6-only，:1482-1488）。 */
  selfAddresses: string[];
  /** AllCaps 含 NodeAttrMagicDNSPeerAAAA="magicdns-aaaa"（:1489-1491）。 */
  wantAAAA: boolean;
  /** goos（仅 "windows" 装节点 Hosts，:1502-1517；鸿蒙走非 Windows 路径）。 */
  goos: string;
  /** self 节点有效（Proxied=false 时 MagicDNSHostsUnrouted 取值，:1553-1561）。 */
  selfNodeValid: boolean;
  /** MagicDNSSuffix（无包围点形态，如 "tail-scale.ts.net"）。 */
  magicDnsSuffix: string;
  /** self 节点名 FQDN（Windows hosts 用）。 */
  selfName: string;
  /** 全部 peer（Windows hosts 装载用；其他平台忽略）。 */
  peers: DnsNodeHostView[];
  /** tailcfg.DNSConfig 解码视图。 */
  resolvers: DnsResolverSpec[];
  routes: DnsRouteEntry[];
  fallbackResolvers: DnsResolverSpec[];
  /** 搜索域（tailcfg.DNSConfig.Domains，无尾点形态）。 */
  domains: string[];
  /** Proxied = MagicDNS 开关（tailcfg.go 注释原文 "turns on automatic resolution of hostnames"）。 */
  proxied: boolean;
  extraRecords: DnsExtraRecord[];
  /** 选中的 exit node 可 DoH 代理时的 base URL（exitNodeCanProxyDNS 成功值；null=否）。 */
  exitNodeDohUrl: string | null;
  /** 是否选择了（老）exit node（FallbackResolvers 分支，:1623-1647）。 */
  exitNodeSelected: boolean;
}

/** dns.Config 的 TS 形态（node_backend 输出 / manager 输入）。 */
export interface DnsConfigForNetmap {
  acceptDns: boolean;
  defaultResolvers: DnsResolverSpec[];
  routes: DnsRouteEntry[];
  searchDomains: string[];
  /** {fqdn(带尾点), addrs(IP 字符串)}；非 Windows 只含 ExtraRecords。 */
  hosts: DnsHostEntry[];
  subdomainHosts: string[];
  onlyIpv6: boolean;
  magicDnsHostsUnrouted: boolean;
}

export interface DnsHostEntry {
  fqdn: string;
  addrs: string[];
}

/** 推导出的 MagicDNS root domains（供 Routes 叠加与测试对拍）。 */
export function rootDomainsOf(view: NetmapDnsView): string[] {
  return magicDNSRootDomains(view.magicDnsSuffix);
}

/** self 是否 v6-only（node_backend.go:1482-1488：地址全部 Is6）。 */
export function selfIsV6Only(selfAddresses: string[]): boolean {
  if (selfAddresses.length === 0) {
    return false;
  }
  for (const p of selfAddresses) {
    let addr: IpAddr;
    try {
      addr = parsePrefix(p).addr;
    } catch (e) {
      return false;
    }
    if (addr.is4) {
      return false;
    }
  }
  return true;
}

/** ExtraRecords → Hosts（node_backend.go:1518-1536：A/AAAA/"" 按值推断地址族）。 */
export function extraRecordsToHosts(records: DnsExtraRecord[]): DnsHostEntry[] {
  const out: DnsHostEntry[] = [];
  for (const rec of records) {
    const t: string = rec.type === undefined ? '' : rec.type;
    if (t !== '' && t !== 'A' && t !== 'AAAA') {
      continue;
    }
    let fqdn: string;
    try {
      fqdn = toFqdn(rec.name.toLowerCase());
    } catch (e) {
      continue;
    }
    const entry: DnsHostEntry = { fqdn: fqdn, addrs: [rec.data] };
    out.push(entry);
  }
  return out;
}

/**
 * dnsConfigForNetmap（node_backend.go:1456-1649 逐条规则，顺序保真）。
 * 返回 null = 上游返回 nil（无 netmap）。
 */
export function dnsConfigForNetmap(view: NetmapDnsView): DnsConfigForNetmap | null {
  if (!view.netmapPresent) {
    return null;
  }
  const empty: DnsConfigForNetmap = {
    acceptDns: false,
    defaultResolvers: [],
    routes: [],
    searchDomains: [],
    hosts: [],
    subdomainHosts: [],
    onlyIpv6: false,
    magicDnsHostsUnrouted: false,
  };
  if (view.selfExpired) {
    // 「self key 过期返回空 Config」：避免把仅经 tailnet 可达的 resolver 写进 OS。
    return empty;
  }
  const cfg: DnsConfigForNetmap = {
    acceptDns: view.corpDns,
    defaultResolvers: [],
    routes: [],
    searchDomains: [],
    hosts: [],
    subdomainHosts: [],
    onlyIpv6: false,
    magicDnsHostsUnrouted: false,
  };
  const v6Only: boolean = selfIsV6Only(view.selfAddresses);
  cfg.onlyIpv6 = v6Only;

  // Hosts 装载（:1502-1536）：仅 Windows 装 self+peers；其他平台只装 ExtraRecords。
  if (view.goos === 'windows') {
    const selfEntry: DnsHostEntry = { fqdn: toFqdn(view.selfName.toLowerCase()), addrs: selfAddrStrings(view.selfAddresses) };
    cfg.hosts.push(selfEntry);
    for (const peer of view.peers) {
      const peerEntry: DnsHostEntry = { fqdn: toFqdn(peer.fqdn.toLowerCase()), addrs: selfAddrStrings(peer.addresses) };
      cfg.hosts.push(peerEntry);
    }
  }
  const extra: DnsHostEntry[] = extraRecordsToHosts(view.extraRecords);
  for (const e of extra) {
    cfg.hosts.push(e);
  }

  if (!view.corpDns) {
    // 提前返回（:1538-1540）：只有 Hosts/OnlyIPv6。
    return cfg;
  }

  // 搜索域（:1542-1548）：非 FQDN 上游记日志仍加；这里 toFqdn 失败跳过（同一宽容度）。
  for (const d of view.domains) {
    try {
      cfg.searchDomains.push(toFqdn(d));
    } catch (e) {
      // 上游 logf("[unexpected] non-FQDN search domain") 后 continue 语义等价。
    }
  }

  // MagicDNS 开关（:1549-1561）。
  const roots: string[] = magicDNSRootDomains(view.magicDnsSuffix);
  if (view.proxied) {
    for (const dom of roots) {
      const entry: DnsRouteEntry = { suffix: dom, resolvers: null };
      cfg.routes.push(entry);
    }
  } else {
    cfg.magicDnsHostsUnrouted = view.selfNodeValid;
  }

  // exit node DoH（:1586-1600）：命中则叠加后提前返回。
  if (view.exitNodeDohUrl !== null && view.exitNodeDohUrl !== '') {
    for (const r of view.resolvers) {
      if (r.useWithExitNode) {
        cfg.defaultResolvers.push(r);
      }
    }
    if (cfg.defaultResolvers.length === 0) {
      const doh: DnsResolverSpec = { addr: view.exitNodeDohUrl, useWithExitNode: false };
      cfg.defaultResolvers.push(doh);
    }
    const exitRoutes: DnsRouteEntry[] = useWithExitNodeRoutes(view.routes);
    for (const e of exitRoutes) {
      cfg.routes.push(e);
    }
    return cfg;
  }

  // DefaultResolvers（:1602-1606）。
  for (const r of view.resolvers) {
    cfg.defaultResolvers.push(r);
  }

  // Routes 全量（:1613-1614 + :1574-1579 issue 2706 注释：空数组也建条目=权威 NXDOMAIN）。
  for (const e of view.routes) {
    cfg.routes.push(e);
  }

  // FallbackResolvers（:1623-1647）：仅「无 DefaultResolvers 且选了（老）exit node」。
  if (cfg.defaultResolvers.length === 0 && view.exitNodeSelected) {
    for (const r of view.fallbackResolvers) {
      cfg.defaultResolvers.push(r);
    }
  }
  return cfg;
}

function selfAddrStrings(selfAddresses: string[]): string[] {
  const out: string[] = [];
  for (const p of selfAddresses) {
    let addr: IpAddr;
    try {
      addr = parsePrefix(p).addr;
    } catch (e) {
      continue;
    }
    out.push(addrToString(addr));
  }
  return out;
}

/** useWithExitNodeRoutes：exit node 场景下仅保留带 UseWithExitNode resolver 的路由。 */
function useWithExitNodeRoutes(routes: DnsRouteEntry[]): DnsRouteEntry[] {
  const out: DnsRouteEntry[] = [];
  for (const e of routes) {
    if (e.resolvers === null) {
      continue;
    }
    const filtered: DnsResolverSpec[] = [];
    for (const r of e.resolvers) {
      if (r.useWithExitNode) {
        filtered.push(r);
      }
    }
    if (filtered.length > 0) {
      const entry: DnsRouteEntry = { suffix: e.suffix, resolvers: filtered };
      out.push(entry);
    }
  }
  return out;
}

// ---- compileConfig（manager.go:306-330） ----

/** resolver 侧配置（manager.compileConfig 输出 rcfg 的 TS 形态）。 */
export interface MagicDnsResolverConfig {
  hosts: DnsHostEntry[];
  subdomainHosts: string[];
  acceptDns: boolean;
  /** 权威区（Routes 里空 resolver 条目转换；manager.go:313-322）。 */
  localDomains: string[];
  /** 非空转发路由。 */
  routes: DnsRouteEntry[];
}

/** OS 侧配置（ocfg 子集）。 */
export interface MagicDnsOsConfig {
  nameservers: string[];
  searchDomains: string[];
  matchDomains: string[];
}

export interface MagicDnsCompiled {
  resolver: MagicDnsResolverConfig;
  os: MagicDnsOsConfig;
}

/**
 * compileConfig 核心（manager.go:306-330）+ serviceIPs（config.go:79-100）：
 * Routes 空 resolver 条目 → LocalDomains；OS 恒拿搜索域；Nameservers=
 * serviceIPs（OnlyIPv6→[v6]，否则 [v4,v6]）。
 */
export function compileMagicDnsConfig(cfg: DnsConfigForNetmap): MagicDnsCompiled {
  const localDomains: string[] = [];
  const routes: DnsRouteEntry[] = [];
  for (const e of cfg.routes) {
    if (e.resolvers === null || e.resolvers.length === 0) {
      localDomains.push(e.suffix);
    } else {
      routes.push(e);
    }
  }
  const serviceIps: string[] = cfg.onlyIpv6 ? [TAILSCALE_SERVICE_IP_V6] : [TAILSCALE_SERVICE_IP_V4, TAILSCALE_SERVICE_IP_V6];
  const osCfg: MagicDnsOsConfig = {
    nameservers: serviceIps,
    searchDomains: cfg.searchDomains,
    // MatchDomains = 应指到 quad-100 的后缀（config.go:189-199：Routes 键）。
    matchDomains: routes.map((e: DnsRouteEntry): string => e.suffix),
  };
  const rcfg: MagicDnsResolverConfig = {
    hosts: cfg.hosts,
    subdomainHosts: cfg.subdomainHosts,
    acceptDns: cfg.acceptDns,
    localDomains: localDomains,
    routes: routes,
  };
  const out: MagicDnsCompiled = { resolver: rcfg, os: osCfg };
  return out;
}

// ---- resolver 决策核（tsdns.go:723-958） ----

/** 按需 MagicDNS 主机源（resolver.MagicDNSHosts 接口的 TS 形态；tsdns.go:270-287）。 */
export interface MagicDnsHostSource {
  /** LookupHost：节点 FQDN → 地址（v6 隐藏规则由实现侧用 magicDnsAddrs 完成）。 */
  lookupHost(fqdn: string): string[] | null;
  /** LookupPTR：IP → 节点 FQDN。 */
  lookupPtr(addr: IpAddr): string | null;
  /** SubdomainHost：fqdn 是否为节点的可解析子域资格（NodeAttrDNSSubdomainResolve 门控）。 */
  subdomainHost(fqdn: string): boolean;
}

/** 一条应答记录（A/AAAA/PTR；data=IP 字符串或符号名）。 */
export interface DnsAnswer {
  name: string;
  type: number;
  ttlSec: number;
  data: string;
}

/** 解析结果（对齐 tsdns respond 语义；R5：无字面量联合，用 rcode+负答标志表达）。 */
export interface DnsResolveOutcome {
  /** DnsRCode 值：NOERROR/NXDOMAIN/NOTIMP/REFUSED。 */
  rcode: number;
  /** 命中记录（TTL=5）。 */
  answers: DnsAnswer[];
  /** 负答（NXDOMAIN 或名字存在但无该类型记录）：带 SOA、TTL=10（RFC 2308）。 */
  negative: boolean;
  /** rcode=REFUSED 时的转发路由（最长后缀匹配；无路由 null → 上层 SERVFAIL）。 */
  forwardResolvers: DnsResolverSpec[] | null;
  forwardSuffix: string;
}

/**
 * ResolverCore —— quad-100 决策序纯逻辑核（tsdns.go:723-958）。
 * hosts/subdomainHosts/localDomains/routes 为 compileConfig 产物；magicHosts 为
 * 按需节点记录源（非 Windows 路径的活索引）。
 */
export class ResolverCore {
  private hosts: Map<string, string[]> = new Map();
  /** Hosts 的反解索引（fqdnForIPLocked 的 ipToHost）。 */
  private ipToHost: Map<string, string> = new Map();
  private subdomainHosts: string[] = [];
  private localDomains: string[] = [];
  private routes: DnsRouteEntry[] = [];
  private magicHosts: MagicDnsHostSource | null = null;
  private acceptDns: boolean = true;

  public constructor(compiled: MagicDnsCompiled) {
    for (const e of compiled.resolver.hosts) {
      this.hosts.set(e.fqdn.toLowerCase(), e.addrs.slice());
    }
    for (const e of compiled.resolver.hosts) {
      for (const a of e.addrs) {
        const ip: IpAddr | null = tryParseIp(a);
        if (ip !== null && !this.ipToHost.has(addrToString(ip))) {
          this.ipToHost.set(addrToString(ip), e.fqdn.toLowerCase());
        }
      }
    }
    for (const s of compiled.resolver.subdomainHosts) {
      this.subdomainHosts.push(s.toLowerCase());
    }
    for (const s of compiled.resolver.localDomains) {
      this.localDomains.push(s.toLowerCase());
    }
    for (const r of compiled.resolver.routes) {
      this.routes.push(r);
    }
    this.acceptDns = compiled.resolver.acceptDns;
  }

  /** 安装按需节点记录源（local.go:623 SetMagicDNSHosts）。 */
  public setMagicDnsHosts(source: MagicDnsHostSource): void {
    this.magicHosts = source;
  }

  public acceptsDns(): boolean {
    return this.acceptDns;
  }

  /**
   * 查询入口（tsdns.go Query 前半 + resolveLocal/resolveLocalReverse）。
   * name 不带尾点亦可（内部归一化 + lowercase）；type 取 DnsType 值。
   */
  public query(rawName: string, qtype: number): DnsResolveOutcome {
    const name: string = withTrailingDot(rawName.toLowerCase());
    if (qtype === DnsType.PTR) {
      return this.resolveLocalReverse(name);
    }
    return this.resolveLocal(name, qtype);
  }

  /** resolveLocal（tsdns.go:723-838，逐分支保序）。 */
  private resolveLocal(name: string, qtype: number): DnsResolveOutcome {
    // ① .onion → NXDOMAIN（RFC 7686，:727-731）。
    if (dnsNameHasSuffix(withoutTrailingDot(name), '.onion')) {
      return negativeOutcome(DnsRCode.NXDOMAIN);
    }
    // ② 符号名 → 服务 IP（:736-743；A/AAAA 之外的类型继续往下走）。
    if (name === DNS_SYMBOLIC_FQDN) {
      if (qtype === DnsType.A) {
        return answerOutcome(name, DnsType.A, TAILSCALE_SERVICE_IP_V4);
      }
      if (qtype === DnsType.AAAA) {
        return answerOutcome(name, DnsType.AAAA, TAILSCALE_SERVICE_IP_V6);
      }
    }
    // （4via6 合成名分支 tsdns.go:841-900 属二期：位于符号名之后、Hosts 之前。）

    // ③ Hosts 精确 → magicHosts 按需 → 沿 Parent() 查子域（:753-771）。
    let found: string[] | null = null;
    let foundName: string = '';
    const exact: string[] | undefined = this.hosts.get(name);
    if (exact !== undefined) {
      found = exact;
      foundName = name;
    }
    if (found === null && this.magicHosts !== null) {
      const onDemand: string[] | null = this.magicHosts.lookupHost(name);
      if (onDemand !== null) {
        found = onDemand;
        foundName = name;
      }
    }
    if (found === null) {
      for (let parent: string = parentOf(name); parent !== ''; parent = parentOf(parent)) {
        const sub: string = withTrailingDot(parent).toLowerCase();
        if (this.subdomainHosts.indexOf(sub) >= 0) {
          const parentAddrs: string[] | undefined = this.hosts.get(sub);
          if (parentAddrs !== undefined) {
            found = parentAddrs;
            foundName = sub;
            break;
          }
        }
        if (this.magicHosts !== null && this.magicHosts.subdomainHost(sub)) {
          const viaMagic: string[] | null = this.magicHosts.lookupHost(sub);
          if (viaMagic !== null) {
            found = viaMagic;
            foundName = sub;
            break;
          }
        }
      }
    }
    if (found === null) {
      // ④ LocalDomains → 权威 NXDOMAIN（:773-781）。
      for (const suffix of this.localDomains) {
        if (dnsNameContains(suffix, name)) {
          return negativeOutcome(DnsRCode.NXDOMAIN);
        }
      }
      // ⑤ 非权威 → REFUSED（内部哨兵）：按最长后缀选转发路由（Query → forwarder）。
      return this.refusedWithRoute(name);
    }

    // ⑥ 命中后按类型分流（:784-838；注释明言必须在后缀检查之后）。
    const addrs: string[] = found;
    if (qtype === DnsType.A) {
      return firstOfFamily(name, DnsType.A, addrs, true);
    }
    if (qtype === DnsType.AAAA) {
      return firstOfFamily(name, DnsType.AAAA, addrs, false);
    }
    if (qtype === DnsType.ALL) {
      if (addrs.length === 0) {
        return negativeNoDataOutcome();
      }
      const ans: DnsAnswer = { name: foundName, type: DnsType.ALL, ttlSec: MAGIC_DNS_POSITIVE_TTL_S, data: addrs[0] };
      const ok: DnsResolveOutcome = { rcode: DnsRCode.NOERROR, answers: [ans], negative: false, forwardResolvers: null, forwardSuffix: '' };
      return ok;
    }
    if (qtype === DnsType.NS || qtype === DnsType.SOA || qtype === DnsType.AXFR || qtype === DnsType.HINFO) {
      // NS/SOA/AXFR/HINFO → NOTIMP（:824-826）。
      const out: DnsResolveOutcome = { rcode: DnsRCode.NOTIMP, answers: [], negative: false, forwardResolvers: null, forwardSuffix: '' };
      return out;
    }
    // 未知类型 → NOERROR 空（:828-837，"dig -t TYPE9824" 语义）。
    return negativeNoDataOutcome();
  }

  /** resolveLocalReverse（tsdns.go:903-958）。 */
  private resolveLocalReverse(name: string): DnsResolveOutcome {
    const ip: IpAddr | null = ptrFqdnToIp(name);
    if (ip === null) {
      // 形不合法：交上游（:910-915 注释 "try kicking it up to them"）。
      return this.refusedWithRoute(name);
    }
    // quad-100 服务 IP → 符号名（:936-941）。
    if (addrToString(ip) === TAILSCALE_SERVICE_IP_V4 || addrToString(ip) === TAILSCALE_SERVICE_IP_V6) {
      return answerOutcome(name, DnsType.PTR, DNS_SYMBOLIC_FQDN);
    }
    // ipToHost 精确（:943-944）。
    const host: string | undefined = this.ipToHost.get(addrToString(ip));
    if (host !== undefined) {
      return answerOutcome(name, DnsType.PTR, host);
    }
    // magicHosts.LookupPTR（:945-947）。
    if (this.magicHosts !== null) {
      const ptr: string | null = this.magicHosts.lookupPtr(ip);
      if (ptr !== null) {
        return answerOutcome(name, DnsType.PTR, ptr);
      }
    }
    // LocalDomains 包含查询名 → 权威 NXDOMAIN（:949-954）。
    for (const suffix of this.localDomains) {
      if (dnsNameContains(suffix, name)) {
        return negativeOutcome(DnsRCode.NXDOMAIN);
      }
    }
    return this.refusedWithRoute(name);
  }

  /** REFUSED → 最长后缀路由匹配（tsdns.go Query 捕获 errNotOurName 后 forwarder 语义）。 */
  private refusedWithRoute(name: string): DnsResolveOutcome {
    let best: DnsRouteEntry | null = null;
    let bestLen: number = -1;
    for (const r of this.routes) {
      if (!dnsNameContains(r.suffix, name)) {
        continue;
      }
      const len: number = withoutTrailingDot(r.suffix).length;
      if (len > bestLen) {
        best = r;
        bestLen = len;
      }
    }
    const out: DnsResolveOutcome = {
      rcode: DnsRCode.REFUSED,
      answers: [],
      negative: false,
      forwardResolvers: best === null ? null : (best.resolvers === null ? [] : best.resolvers.slice()),
      forwardSuffix: best === null ? '' : best.suffix,
    };
    return out;
  }
}

function answerOutcome(name: string, type: number, data: string): DnsResolveOutcome {
  const ans: DnsAnswer = { name: name, type: type, ttlSec: MAGIC_DNS_POSITIVE_TTL_S, data: data };
  const out: DnsResolveOutcome = { rcode: DnsRCode.NOERROR, answers: [ans], negative: false, forwardResolvers: null, forwardSuffix: '' };
  return out;
}

function firstOfFamily(name: string, type: number, addrs: string[], want4: boolean): DnsResolveOutcome {
  for (const a of addrs) {
    const ip: IpAddr | null = tryParseIp(a);
    if (ip !== null && ip.is4 === want4) {
      return answerOutcome(name, type, a);
    }
  }
  // 名字存在但无该类型记录 → NOERROR 空（非 NXDOMAIN；tsdns.go:786-789 注释）。
  return negativeNoDataOutcome();
}

function negativeNoDataOutcome(): DnsResolveOutcome {
  const out: DnsResolveOutcome = { rcode: DnsRCode.NOERROR, answers: [], negative: true, forwardResolvers: null, forwardSuffix: '' };
  return out;
}

function negativeOutcome(rcode: number): DnsResolveOutcome {
  const out: DnsResolveOutcome = { rcode: rcode, answers: [], negative: true, forwardResolvers: null, forwardSuffix: '' };
  return out;
}

/** 应答是否超限需置 TC（tsdns.go:47-50：>4095B 截断）。 */
export function shouldTruncate(responseLenBytes: number): boolean {
  return responseLenBytes > MAX_DNS_RESPONSE_BYTES;
}

/**
 * magicDNSAddrs（node_backend.go:1318-1350）：A/AAAA 应答地址集。
 * self v6-only → 只回 peer 的 v6；否则 peer 的 v6 在「peer 同时有 v4 且未设
 * wantAAAA」时隐藏（issue 1152）。
 */
export function magicDnsAddrs(peerAddressPrefixes: string[], selfV6OnlyFlag: boolean, wantAAAAFlag: boolean): string[] {
  let have4: boolean = false;
  for (const p of peerAddressPrefixes) {
    const ip: IpAddr | null = tryParsePrefixAddr(p);
    if (ip !== null && ip.is4) {
      have4 = true;
      break;
    }
  }
  const out: string[] = [];
  for (const p of peerAddressPrefixes) {
    const ip: IpAddr | null = tryParsePrefixAddr(p);
    if (ip === null) {
      continue;
    }
    if (selfV6OnlyFlag) {
      if (!ip.is4) {
        out.push(addrToString(ip));
      }
      continue;
    }
    if (!ip.is4 && have4 && !wantAAAAFlag) {
      continue;
    }
    out.push(addrToString(ip));
  }
  return out;
}

function tryParsePrefixAddr(p: string): IpAddr | null {
  let prefix: IpPrefix;
  try {
    prefix = parsePrefix(p);
  } catch (e) {
    return null;
  }
  return prefix.addr;
}

/**
 * nodeByFQDN 的名字规范化（node_backend.go:1295-1299）：统一 lowercase、去尾点；
 * 裸主机名（无点）仅 Proxied=true 才可解析。
 */
export function canonicalNodeName(fqdn: string, magicDnsProxied: boolean): string | null {
  const canon: string = withoutTrailingDot(fqdn.toLowerCase());
  if (!magicDnsProxied && canon.indexOf('.') < 0) {
    return null;
  }
  return canon;
}

/** parseIp 的便捷包装（extraRecords/hosts 装载用）。 */
export function parseDnsIp(s: string): IpAddr {
  return parseIp(s);
}
