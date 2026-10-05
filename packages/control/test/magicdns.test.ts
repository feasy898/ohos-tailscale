/**
 * MagicDNS 解析核心测试：dnsname 归一化、反解区推导、dnsConfigForNetmap 规则、
 * compileConfig、resolver 决策序（NOERROR 空与 NXDOMAIN 之辨）、magicDNSAddrs
 * v6 隐藏、TTL/截断常量。
 *
 * 语义锚点（v1.102.3 实拉，2026-10-03 本会话复核）：
 * - util/dnsname/dnsname.go:14-66（label≤63/总长≤254/恒尾点）；
 * - ipn/ipnlocal/local.go:6479-6501（65 条权威后缀）；
 * - ipn/ipnlocal/node_backend.go:1456-1649（dnsConfigForNetmap 逐条）、:1295-1299
 *   （lowercase+去尾点、裸名须 Proxied）、:1318-1350（v6 隐藏）；
 * - net/dns/manager.go:306-330（空 resolver 路由 → LocalDomains）、net/dns/config.go:79-100
 *   （serviceIPs 双栈/仅 v6）；
 * - net/dns/resolver/tsdns.go:45-68（符号名/TTL/4095）、:723-838（resolveLocal 决策序）、
 *   :903-958（反解）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DNS_SYMBOLIC_FQDN,
  DnsRCode,
  DnsType,
  MAGIC_DNS_NEGATIVE_TTL_S,
  MAGIC_DNS_POSITIVE_TTL_S,
  MAX_DNS_RESPONSE_BYTES,
  ResolverCore,
  TAILSCALE_SERVICE_IP_V4,
  TAILSCALE_SERVICE_IP_V6,
  ULA_REVERSE_ZONE,
  canonicalNodeName,
  compileMagicDnsConfig,
  dnsConfigForNetmap,
  dnsNameContains,
  ipToPtrFqdn,
  magicDNSRootDomains,
  magicDnsAddrs,
  parentOf,
  ptrFqdnToIp,
  selfIsV6Only,
  shouldTruncate,
  toFqdn,
  type MagicDnsCompiled,
  type MagicDnsHostSource,
  type NetmapDnsView,
  type DnsResolveOutcome,
} from '../src/index.ts';
import { parseIp } from '../src/netaddr.ts';

/** 组装一个最小合法 netmap DNS 视图（Proxied 开、CorpDNS 开）。 */
const baseView = (): NetmapDnsView => {
  const view: NetmapDnsView = {
    netmapPresent: true,
    selfExpired: false,
    corpDns: true,
    selfAddresses: ['100.64.0.1/32', 'fd7a:115c:a1e0::1/128'],
    wantAAAA: false,
    goos: 'harmonyos',
    selfNodeValid: true,
    magicDnsSuffix: 'tail-net.example.ts.net',
    selfName: 'self.tail-net.example.ts.net.',
    peers: [],
    resolvers: [],
    routes: [],
    fallbackResolvers: [],
    domains: ['tail-net.example.ts.net'],
    proxied: true,
    extraRecords: [],
    exitNodeDohUrl: null,
    exitNodeSelected: false,
  };
  return view;
};

// ---- dnsname ----

test('toFqdn：恒补尾点；""/"." 归一为 "."；label>63 与总长>254 抛错', () => {
  assert.equal(toFqdn('host.example'), 'host.example.', '无尾点 ⇒ 补尾点（dnsname.go:23-66）');
  assert.equal(toFqdn('host.example.'), 'host.example.', '已有尾点保持');
  assert.equal(toFqdn(''), '.', '空名归一为根');
  assert.equal(toFqdn('.'), '.');
  assert.equal(toFqdn('.lead.example'), 'lead.example.', '首导点剥除');
  const longLabel: string = 'a'.repeat(64) + '.example';
  assert.throws(() => toFqdn(longLabel), /label/, 'label > 63 拒绝（RFC 1035 上限）');
  const longName: string = 'b'.repeat(250) + '.example';
  assert.throws(() => toFqdn(longName), /too long/, '总长 > 254 拒绝');
  assert.equal(dnsNameContains('tail-net.example.ts.net.', 'host.tail-net.example.ts.net.'), true, '权威后缀包含');
  assert.equal(dnsNameContains('tail-net.example.ts.net.', 'tailnet.example.ts.net.'), false, '前缀撞车不算包含');
  assert.equal(parentOf('host.tail-net.example.ts.net.'), 'tail-net.example.ts.net.', 'Parent 去首 label');
  assert.equal(parentOf('tld.'), '', '到根返回终止哨兵');
});

// ---- 权威后缀 ----

test('magicDNSRootDomains：suffix + ip6.arpa 反解区 + 64 条 100.in-addr.arpa = 66 条', () => {
  // 研究笔记 §3.3 的「合计 65 条」是算术口误：上游 local.go:6479-6501 返回
  // 1（MagicDNSSuffix）+ 1（ip6.arpa）+ 64（64..127 的 /16 分片）= 66；
  // oracle netmap 的 DNS.Routes「64+1=65 条」是 control 侧下发值（不含 suffix 本身），两者不矛盾。
  const roots: string[] = magicDNSRootDomains('tail-net.example.ts.net');
  assert.equal(roots.length, 66, 'local.go:6479-6501：2+64');
  assert.equal(roots[0], 'tail-net.example.ts.net.', '首条 = MagicDNSSuffix（带尾点）');
  assert.equal(roots[1], ULA_REVERSE_ZONE, 'fd7a:115c:a1e0::/48 的 nibble 反转 ip6.arpa 区逐字');
  assert.equal(roots[2], '64.100.in-addr.arpa.', 'CGNAT /10 的 /16 分片从 64 起');
  assert.equal(roots[65], '127.100.in-addr.arpa.', '到 127 止（100.127.x.x 仍在 /10 内）');
  assert.deepEqual(magicDNSRootDomains(''), [], '无 MagicDNS suffix ⇒ 无权威区');
});

// ---- 反解名 ----

test('ipToPtrFqdn/ptrFqdnToIp：v4 四组反序、v6 32 nibble 反序，往返等价', () => {
  const v4 = parseIp('100.64.0.1');
  const v4ptr: string = ipToPtrFqdn(v4);
  assert.equal(v4ptr, '1.0.64.100.in-addr.arpa.', 'PTR 名 = 八位组反序 + in-addr.arpa.');
  const back4 = ptrFqdnToIp(v4ptr);
  assert.notEqual(back4, null);
  assert.equal(back4?.is4, true);
  assert.deepEqual(back4?.bytes, v4.bytes, 'v4 反解往返等价');

  const v6 = parseIp('fd7a:115c:a1e0::1');
  const v6ptr: string = ipToPtrFqdn(v6);
  assert.equal(v6ptr.endsWith('.ip6.arpa.'), true);
  assert.equal(v6ptr.startsWith('1.0.0.0.'), true, '低位 nibble 在前（反序）');
  const back6 = ptrFqdnToIp(v6ptr);
  assert.notEqual(back6, null);
  assert.equal(back6?.is4, false);
  assert.deepEqual(back6?.bytes, v6.bytes, 'v6 反解往返等价');

  assert.equal(ptrFqdnToIp('not-arpa.example.'), null, '非 arpa 名不可反解');
  assert.equal(ptrFqdnToIp('1.2.3.in-addr.arpa.'), null, 'label 数不符拒绝');
});

// ---- dnsConfigForNetmap ----

test('dnsConfigForNetmap：nil netmap→null；self 过期→空配置；!CorpDNS→提前返回', () => {
  const absent: NetmapDnsView = baseView();
  absent.netmapPresent = false;
  assert.equal(dnsConfigForNetmap(absent), null, 'netmap 为 nil ⇒ nil（node_backend.go:1457-1459）');

  const expired: NetmapDnsView = baseView();
  expired.selfExpired = true;
  expired.resolvers = [{ addr: '223.5.5.5', useWithExitNode: false }];
  const expiredCfg = dnsConfigForNetmap(expired);
  assert.notEqual(expiredCfg, null);
  assert.equal(expiredCfg?.acceptDns, false, '过期 ⇒ 空 Config：避免把仅 tailnet 可达的 resolver 写进 OS 打断连通性');

  const noCorp: NetmapDnsView = baseView();
  noCorp.corpDns = false;
  noCorp.resolvers = [{ addr: '223.5.5.5', useWithExitNode: false }];
  const noCorpCfg = dnsConfigForNetmap(noCorp);
  assert.notEqual(noCorpCfg, null);
  assert.equal(noCorpCfg?.acceptDns, false);
  assert.equal(noCorpCfg?.routes.length, 0, '!CorpDNS 提前返回：Routes 不装（:1538-1540）');
  assert.equal(noCorpCfg?.defaultResolvers.length, 0, '!CorpDNS 提前返回：DefaultResolvers 不装');
});

test('dnsConfigForNetmap：Proxied 开 ⇒ root domains 进 Routes（权威）；关 ⇒ MagicDNSHostsUnrouted', () => {
  const proxied = dnsConfigForNetmap(baseView());
  assert.notEqual(proxied, null);
  assert.equal(proxied?.routes.length, 66, 'Proxied ⇒ 每条 root domain Routes[dom]=nil（权威内部解析，共 66 条）');
  assert.equal(proxied?.routes[0].resolvers, null, '值=null 形态（Go nil slice）');
  assert.equal(proxied?.magicDnsHostsUnrouted, false);

  const unproxied: NetmapDnsView = baseView();
  unproxied.proxied = false;
  unproxied.routes = [{ suffix: 'example.com.', resolvers: [{ addr: '8.8.8.8', useWithExitNode: false }] }];
  const cfg = dnsConfigForNetmap(unproxied);
  assert.notEqual(cfg, null);
  assert.equal(cfg?.routes.length, 1, 'Proxied=false ⇒ root domains 不进 Routes');
  assert.equal(cfg?.magicDnsHostsUnrouted, true, '关但仍保留 quad-100 于 OS resolver 路径（:1553-1561）');

  const invalidSelf: NetmapDnsView = baseView();
  invalidSelf.proxied = false;
  invalidSelf.selfNodeValid = false;
  assert.equal(dnsConfigForNetmap(invalidSelf)?.magicDnsHostsUnrouted, false, 'SelfNode 无效 ⇒ false');
});

test('dnsConfigForNetmap：Resolvers→DefaultResolvers；ExtraRecords→Hosts（非 Windows 不装节点名）', () => {
  const view: NetmapDnsView = baseView();
  view.resolvers = [{ addr: '223.5.5.5', useWithExitNode: false }];
  view.extraRecords = [{ name: 'extra.example.', type: 'A', data: '100.100.1.2' }];
  view.peers = [{ fqdn: 'peer1.tail-net.example.ts.net.', addresses: ['100.64.0.2/32'] }];
  const cfg = dnsConfigForNetmap(view);
  assert.notEqual(cfg, null);
  assert.equal(cfg?.defaultResolvers.length, 1, 'len(DNS.Resolvers)>0 ⇒ DefaultResolvers（:1602-1606）');
  assert.equal(cfg?.hosts.length, 1, '非 Windows 平台 Hosts 只装 ExtraRecords（:1518-1536）');
  assert.equal(cfg?.hosts[0].fqdn, 'extra.example.');
  assert.equal(cfg?.searchDomains[0], 'tail-net.example.ts.net.', 'Domains → SearchDomains（ToFQDN 形态）');

  const win: NetmapDnsView = baseView();
  win.goos = 'windows';
  win.peers = [{ fqdn: 'peer1.tail-net.example.ts.net.', addresses: ['100.64.0.2/32'] }];
  const winCfg = dnsConfigForNetmap(win);
  assert.notEqual(winCfg, null);
  assert.equal(winCfg?.hosts.length, 2, '仅 Windows 装 self+全部 peer 名（hosts 文件回退路径）');
});

test('dnsConfigForNetmap：exit node DoH 命中 ⇒ DefaultResolvers=UseWithExitNode 或 dohURL，且提前返回', () => {
  const view: NetmapDnsView = baseView();
  view.exitNodeDohUrl = 'http://100.64.0.9:40001/dns-query';
  view.resolvers = [
    { addr: '223.5.5.5', useWithExitNode: false },
    { addr: '119.29.29.29', useWithExitNode: true },
  ];
  const cfg = dnsConfigForNetmap(view);
  assert.notEqual(cfg, null);
  assert.equal(cfg?.defaultResolvers.length, 1, '只取带 UseWithExitNode 标记的全局 resolver（:1586-1600）');
  assert.equal(cfg?.defaultResolvers[0].addr, '119.29.29.29');

  const noMarked: NetmapDnsView = baseView();
  noMarked.exitNodeDohUrl = 'http://100.64.0.9:40001/dns-query';
  const cfg2 = dnsConfigForNetmap(noMarked);
  assert.notEqual(cfg2, null);
  assert.equal(cfg2?.defaultResolvers.length, 1, '无标记 ⇒ 兜底 [peerAPIBase+"/dns-query"]');
  assert.equal(cfg2?.defaultResolvers[0].addr, 'http://100.64.0.9:40001/dns-query');
});

// ---- compileConfig ----

test('compileMagicDnsConfig：空 resolver 路由 → LocalDomains（权威 NXDOMAIN）；serviceIPs 双栈', () => {
  const cfg = dnsConfigForNetmap(baseView());
  assert.notEqual(cfg, null);
  const compiled: MagicDnsCompiled = compileMagicDnsConfig(cfg as NonNullable<ReturnType<typeof dnsConfigForNetmap>>);
  assert.equal(compiled.resolver.localDomains.length, 66, '空 resolver 条目全转 LocalDomains（manager.go:313-322）');
  assert.deepEqual(compiled.os.nameservers, [TAILSCALE_SERVICE_IP_V4, TAILSCALE_SERVICE_IP_V6], 'quad-100 双栈（config.go:79-100）');

  const v6OnlyView: NetmapDnsView = baseView();
  v6OnlyView.selfAddresses = ['fd7a:115c:a1e0::1/128'];
  assert.equal(selfIsV6Only(v6OnlyView.selfAddresses), true, 'self 仅 v6 判定');
  const cfg6 = dnsConfigForNetmap(v6OnlyView);
  const compiled6 = compileMagicDnsConfig(cfg6 as NonNullable<ReturnType<typeof dnsConfigForNetmap>>);
  assert.deepEqual(compiled6.os.nameservers, [TAILSCALE_SERVICE_IP_V6], 'OnlyIPv6 ⇒ 仅 v6 服务地址');

  // 混合路由：权威区 + 转发区并存。
  const mixed = dnsConfigForNetmap(baseView());
  mixed?.routes.push({ suffix: 'corp.internal.', resolvers: [{ addr: '10.0.0.53', useWithExitNode: false }] });
  const compiledMixed = compileMagicDnsConfig(mixed as NonNullable<ReturnType<typeof dnsConfigForNetmap>>);
  assert.equal(compiledMixed.resolver.localDomains.length, 66);
  assert.equal(compiledMixed.resolver.routes.length, 1, '非空 resolver 路由保留转发');
  assert.equal(compiledMixed.os.matchDomains[0], 'corp.internal.', 'MatchDomains = 转发路由键');
});

// ---- resolver 决策核 ----

/** 组装带 hosts/localDomains/routes 的 resolver（含按需 magicHosts 桩）。 */
const makeResolver = (magicHosts: MagicDnsHostSource | null): ResolverCore => {
  const cfg = dnsConfigForNetmap(baseView());
  const compiled = compileMagicDnsConfig(cfg as NonNullable<ReturnType<typeof dnsConfigForNetmap>>);
  compiled.resolver.hosts.push({ fqdn: 'host.tail-net.example.ts.net.', addrs: ['100.64.0.2', 'fd7a:115c:a1e0::2'] });
  compiled.resolver.hosts.push({ fqdn: 'v4only.tail-net.example.ts.net.', addrs: ['100.64.0.3'] });
  compiled.resolver.subdomainHosts.push('svc.tail-net.example.ts.net.');
  const r: ResolverCore = new ResolverCore(compiled);
  if (magicHosts !== null) {
    r.setMagicDnsHosts(magicHosts);
  }
  return r;
};

test('resolver：Hosts 精确命中 → A/AAAA 首 record，TTL=5', () => {
  const r: ResolverCore = makeResolver(null);
  const a: DnsResolveOutcome = r.query('HOST.TAIL-NET.EXAMPLE.TS.NET', DnsType.A);
  assert.equal(a.rcode, DnsRCode.NOERROR, '命中 → NOERROR（匹配统一 lowercase，node_backend.go:1295）');
  assert.equal(a.answers.length, 1);
  assert.equal(a.answers[0].data, '100.64.0.2', 'A 取该族首个');
  assert.equal(a.answers[0].ttlSec, MAGIC_DNS_POSITIVE_TTL_S, '正答 TTL=5s（tsdns.go:58）');

  const aaaa: DnsResolveOutcome = r.query('host.tail-net.example.ts.net.', DnsType.AAAA);
  assert.equal(aaaa.answers[0].data, 'fd7a:115c:a1e0::2', 'AAAA 取 v6 族首个');
});

test('resolver：名字存在但无该类型记录 = NOERROR 空（非 NXDOMAIN），负答带 SOA/TTL=10 语义', () => {
  const r: ResolverCore = makeResolver(null);
  const out: DnsResolveOutcome = r.query('v4only.tail-net.example.ts.net.', DnsType.AAAA);
  assert.equal(out.rcode, DnsRCode.NOERROR, '名字存在但无 AAAA ⇒ NOERROR 空（tsdns.go:786-789 注释明言非 NXDOMAIN）');
  assert.equal(out.answers.length, 0);
  assert.equal(out.negative, true, '负答：respond 附 SOA、TTL=10（RFC 2308，:52-68）');
});

test('resolver：权威区内未知名 = NXDOMAIN；区外 = REFUSED 且按最长后缀给转发路由', () => {
  const r: ResolverCore = makeResolver(null);
  const nx: DnsResolveOutcome = r.query('nope.tail-net.example.ts.net.', DnsType.A);
  assert.equal(nx.rcode, DnsRCode.NXDOMAIN, 'LocalDomains 权威区未命中 ⇒ 权威 NXDOMAIN（:773-781）');
  assert.equal(nx.negative, true);

  const fwd: DnsResolveOutcome = r.query('example.com.', DnsType.A);
  assert.equal(fwd.rcode, DnsRCode.REFUSED, '非权威 ⇒ REFUSED（内部哨兵，交 forwarder）');
  assert.equal(fwd.forwardResolvers, null, '无匹配路由 ⇒ 上层 SERVFAIL');

  // 加一条转发路由后，REFUSED 应带最长后缀路由。
  const view = baseView();
  view.routes.push({ suffix: 'com.', resolvers: [{ addr: '8.8.8.8', useWithExitNode: false }] });
  view.routes.push({ suffix: 'example.com.', resolvers: [{ addr: '9.9.9.9', useWithExitNode: false }] });
  const compiled = compileMagicDnsConfig(dnsConfigForNetmap(view) as NonNullable<ReturnType<typeof dnsConfigForNetmap>>);
  const r2: ResolverCore = new ResolverCore(compiled);
  const out2: DnsResolveOutcome = r2.query('www.example.com.', DnsType.A);
  assert.equal(out2.rcode, DnsRCode.REFUSED);
  assert.equal(out2.forwardSuffix, 'example.com.', '最长后缀匹配（forwarder 语义）');
  assert.equal(out2.forwardResolvers?.[0].addr, '9.9.9.9');
});

test('resolver：.onion 恒 NXDOMAIN（RFC 7686）；符号名 → quad-100 双栈；未知类型 NOERROR 空', () => {
  const r: ResolverCore = makeResolver(null);
  const onion: DnsResolveOutcome = r.query('x.onion', DnsType.A);
  assert.equal(onion.rcode, DnsRCode.NXDOMAIN, '.onion 永不出网（RFC 7686，:727-731）');

  const symA: DnsResolveOutcome = r.query(DNS_SYMBOLIC_FQDN, DnsType.A);
  assert.equal(symA.answers[0].data, TAILSCALE_SERVICE_IP_V4, '符号名 A = 100.100.100.100（tsdns.go:736-743）');
  const symAAAA: DnsResolveOutcome = r.query(DNS_SYMBOLIC_FQDN, DnsType.AAAA);
  assert.equal(symAAAA.answers[0].data, TAILSCALE_SERVICE_IP_V6, '符号名 AAAA = fd7a:115c:a1e0::53');

  const unknown: DnsResolveOutcome = r.query('host.tail-net.example.ts.net.', 9824);
  assert.equal(unknown.rcode, DnsRCode.NOERROR, '未知类型：名字存在 ⇒ NOERROR 空（dig -t TYPE9824 语义）');

  const v4onlyUnknown: DnsResolveOutcome = r.query('v4only.tail-net.example.ts.net.', DnsType.TXT);
  assert.equal(v4onlyUnknown.rcode, DnsRCode.NOERROR);
  assert.equal(v4onlyUnknown.negative, true);
});

test('resolver：NS/SOA/AXFR/HINFO → NOTIMP，但仅限权威命中的名字（NOTIMP 不得截胡转发）', () => {
  const r: ResolverCore = makeResolver(null);
  const notimp: DnsResolveOutcome = r.query('host.tail-net.example.ts.net.', DnsType.NS);
  assert.equal(notimp.rcode, DnsRCode.NOTIMP, '名字在 Hosts 且查 NS ⇒ NOTIMP（:824-826）');

  // 权威区（LocalDomains）内未知名查 NS：应 NXDOMAIN 而非 NOTIMP——名字不存在。
  const nx: DnsResolveOutcome = r.query('nope.tail-net.example.ts.net.', DnsType.NS);
  assert.equal(nx.rcode, DnsRCode.NXDOMAIN, '后缀检查先于类型分流（:782-784 重构注释）');

  // 非权威名查 NS：应 REFUSED 转发而非 NOTIMP。
  const view = baseView();
  view.routes.push({ suffix: 'com.', resolvers: [{ addr: '8.8.8.8', useWithExitNode: false }] });
  const compiled = compileMagicDnsConfig(dnsConfigForNetmap(view) as NonNullable<ReturnType<typeof dnsConfigForNetmap>>);
  const r2: ResolverCore = new ResolverCore(compiled);
  const out2: DnsResolveOutcome = r2.query('example.com.', DnsType.NS);
  assert.equal(out2.rcode, DnsRCode.REFUSED, '"this must happen after we check suffixes"：该转发的请求不能被 NOTIMP');
});

test('resolver：反解——服务 IP → 符号名；Hosts IP → 节点名；权威反解区未命中 → NXDOMAIN', () => {
  const r: ResolverCore = makeResolver(null);
  const svcPtr: DnsResolveOutcome = r.query(ipToPtrFqdn(parseIp(TAILSCALE_SERVICE_IP_V4)), DnsType.PTR);
  assert.equal(svcPtr.answers[0].data, DNS_SYMBOLIC_FQDN, '反解 quad-100 ⇒ 符号名（tsdns.go:936-941）');

  const nodePtr: DnsResolveOutcome = r.query(ipToPtrFqdn(parseIp('100.64.0.2')), DnsType.PTR);
  assert.equal(nodePtr.rcode, DnsRCode.NOERROR);
  assert.equal(nodePtr.answers[0].data, 'host.tail-net.example.ts.net.', 'ipToHost 反查（:943-944）');

  // 权威反解区内、无记录 → NXDOMAIN（LocalDomains 含查询名，:949-954）。
  const revNx: DnsResolveOutcome = r.query('9.9.64.100.in-addr.arpa.', DnsType.PTR);
  assert.equal(revNx.rcode, DnsRCode.NXDOMAIN, '100.64/10 反解区权威 ⇒ NXDOMAIN');

  // 区外反解名 → REFUSED 转发。
  const revFwd: DnsResolveOutcome = r.query('1.0.0.127.in-addr.arpa.', DnsType.PTR);
  assert.equal(revFwd.rcode, DnsRCode.REFUSED, '127/8 不在权威区 ⇒ 转发');
});

test('resolver：magicHosts 按需命中 + SubdomainHost 父域兜底（活索引路径）', () => {
  const magic: MagicDnsHostSource = {
    lookupHost: (fqdn: string): string[] | null => {
      if (fqdn === 'ondemand.tail-net.example.ts.net.') {
        return ['100.64.0.7'];
      }
      if (fqdn === 'svc.tail-net.example.ts.net.') {
        return ['100.64.0.8'];
      }
      return null;
    },
    lookupPtr: (addr: { is4: boolean; bytes: Uint8Array }): string | null => {
      return addr.is4 && addr.bytes[3] === 7 ? 'ondemand.tail-net.example.ts.net.' : null;
    },
    subdomainHost: (fqdn: string): boolean => {
      return fqdn === 'svc.tail-net.example.ts.net.';
    },
  };
  const r: ResolverCore = makeResolver(magic);
  const onDemand: DnsResolveOutcome = r.query('ondemand.tail-net.example.ts.net.', DnsType.A);
  assert.equal(onDemand.answers[0].data, '100.64.0.7', 'Hosts 未命中 → magicHosts.LookupHost（:756-759）');

  // 子域 foo.svc.…：Hosts 无此名，magicHosts 亦无，但 SubdomainHost(svc.…)=true
  // → 按需查父域地址（:760-771 的 magicHosts.SubdomainHost 分支）。
  const sub: DnsResolveOutcome = r.query('foo.svc.tail-net.example.ts.net.', DnsType.A);
  assert.equal(sub.rcode, DnsRCode.NOERROR);
  assert.equal(sub.answers[0].data, '100.64.0.8', '沿 Parent() 逐级查子域资格并回父域地址');

  // 反解走 magicHosts.LookupPTR。
  const ptr: DnsResolveOutcome = r.query(ipToPtrFqdn(parseIp('100.64.0.7')), DnsType.PTR);
  assert.equal(ptr.answers[0].data, 'ondemand.tail-net.example.ts.net.');
});

test('resolver：!AcceptDNS 时上游不装 resolver（compileConfig 只透传，决策核不受影响）', () => {
  const view = baseView();
  view.corpDns = false;
  const cfg = dnsConfigForNetmap(view);
  assert.equal(cfg?.acceptDns, false, 'AcceptDNS=prefs.CorpDNS（:1477）');
  const compiled = compileMagicDnsConfig(cfg as NonNullable<ReturnType<typeof dnsConfigForNetmap>>);
  assert.equal(compiled.resolver.acceptDns, false);
});

// ---- magicDNSAddrs / 名字规范化 ----

test('magicDnsAddrs：self 非 v6-only 时隐藏 peer 的 v6（除非 wantAAAA）；v6-only 全回 v6', () => {
  const peer: string[] = ['100.64.0.2/32', 'fd7a:115c:a1e0::2/128'];
  assert.deepEqual(magicDnsAddrs(peer, false, false), ['100.64.0.2'], 'peer 有 v4 ⇒ v6 隐藏（issue 1152）');
  assert.deepEqual(magicDnsAddrs(peer, false, true), ['100.64.0.2', 'fd7a:115c:a1e0::2'], 'wantAAAA ⇒ 保留 v6');
  assert.deepEqual(magicDnsAddrs(peer, true, false), ['fd7a:115c:a1e0::2'], 'self v6-only ⇒ 只回 peer v6');

  const v6OnlyPeer: string[] = ['fd7a:115c:a1e0::3/128'];
  assert.deepEqual(magicDnsAddrs(v6OnlyPeer, false, false), ['fd7a:115c:a1e0::3'], 'peer 只有 v6 ⇒ v6 保留（否则不可达）');
});

test('canonicalNodeName：统一 lowercase+去尾点；裸主机名仅 Proxied 才解析', () => {
  assert.equal(canonicalNodeName('Host.Example.', true), 'host.example', 'lowercase + 去尾点（node_backend.go:1295）');
  assert.equal(canonicalNodeName('barehost', true), 'barehost', 'Proxied 开 ⇒ 裸名可解析');
  assert.equal(canonicalNodeName('barehost', false), null, 'Proxied 关 ⇒ 裸名拒绝（:1296-1299）');
});

test('TTL/截断常量：正答 5s、负答 10s、>4095B 置 TC', () => {
  assert.equal(MAGIC_DNS_POSITIVE_TTL_S, 5, 'defaultTTL=5s（写死别的数字破坏对端缓存行为）');
  assert.equal(MAGIC_DNS_NEGATIVE_TTL_S, 10, 'negativeTTL=10s+SOA');
  assert.equal(MAX_DNS_RESPONSE_BYTES, 4095, '应答上限 4095B');
  assert.equal(shouldTruncate(4095), false, '恰 4095 不截断');
  assert.equal(shouldTruncate(4096), true, '超限 ⇒ TC');
});
