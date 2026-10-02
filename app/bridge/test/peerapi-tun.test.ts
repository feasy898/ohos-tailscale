/**
 * app/bridge PeerAPI + TUN 数据面 mock 测试 —— 壳 ↔ PeerAPI/TUN 接线（确定性）。
 *
 * 覆盖（协议语义锚定 v1.102.3；行号见 control/src/peerapi.ts 与 bridge/src/mock-tun.ts 头注）：
 * 1) PeerAPI 端口推导与通告：确定性公式落在 [32768,65535]、peerapi4/6 + PeerAPIDNS:1、
 *    假监听器通告端口 1 合法、peerAPIBase 地址族选择；
 * 2) 请求校验：Host 'peer'/自身 ip:port/MasqAddr 合法，Referer/Origin 恒 403；
 * 3) ExitDNS：授权链（isSelf / exit+PacketFilter）、/dns-query 注入应答、POST 501、无能力 503；
 * 4) TUN：FakeTunDevice（NewFake 语义）、TsTunWrapper cork（未 Start 读不到——防测试假绿）、
 *    出站过滤静默丢弃、入站 DNAT 先于过滤、过滤失败静默不回错、InjectInboundDirect
 *    不过入站过滤、InjectOutbound、事件位；
 * 5) TunCable：双端内存网线（A 的 WG→OS 出包即 B 的 OS→WG 入包）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DnsRCode,
  DnsType,
  ResolverCore,
  compileMagicDnsConfig,
  derivePeerApiPort,
  dnsConfigForNetmap,
  type NetmapDnsView,
} from '@ohos-tailscale/control';
import {
  FakeTunDevice,
  MemoryTunDevice,
  MockPeerApiServer,
  TunCable,
  TunEventBits,
  TUN_FAKE_MTU,
  TUN_FAKE_NAME,
  TsTunWrapper,
  advertisePeerApiServices,
  peerApiBaseFor,
  peerCanProxyDnsFor,
  type MockPeerApiConfig,
  type MockPeerApiRequest,
} from '../src/index.ts';

const ip16Of = (tail: number[]): Uint8Array => {
  const out: Uint8Array = new Uint8Array(16);
  out[10] = 0xff;
  out[11] = 0xff;
  out[13] = tail[0];
  out[14] = tail[1];
  out[15] = tail[2];
  return out;
};

const makeResolver = (): ResolverCore => {
  const view: NetmapDnsView = {
    netmapPresent: true,
    selfExpired: false,
    corpDns: true,
    selfAddresses: ['100.64.0.9/32', 'fd7a:115c:a1e0::9/128'],
    wantAAAA: false,
    goos: 'harmonyos',
    selfNodeValid: true,
    magicDnsSuffix: 'tail-net.example.ts.net',
    selfName: 'exit.tail-net.example.ts.net.',
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
  const cfg = dnsConfigForNetmap(view);
  assert.notEqual(cfg, null);
  const compiled = compileMagicDnsConfig(cfg as NonNullable<ReturnType<typeof dnsConfigForNetmap>>);
  compiled.resolver.hosts.push({ fqdn: 'host.tail-net.example.ts.net.', addrs: ['100.64.0.2'] });
  return new ResolverCore(compiled);
};

/** 组装 PeerAPI mock：exit node 形态（offers exit + filter 放行 :53）。 */
const makePeerServer = (answerDns: MockPeerApiConfig['answerDns']): MockPeerApiServer => {
  const config: MockPeerApiConfig = {
    displayName: 'exit-node-a',
    selfAddressPrefixes: ['100.64.0.9/32', 'fd7a:115c:a1e0::9/128'],
    masqV4: '',
    masqV6: '',
    listeners: [{ ip: '100.64.0.9', port: 40001 }],
    answerDns: answerDns,
    offersExitNodeOrAppConnector: true,
    filterAcceptsTcp53: true,
  };
  return new MockPeerApiServer(config);
};

const peerRequest = (overrides: Partial<MockPeerApiRequest>): MockPeerApiRequest => {
  const req: MockPeerApiRequest = {
    method: 'GET',
    host: 'peer',
    referer: '',
    origin: '',
    path: '/',
    params: {},
  };
  if (overrides.method !== undefined) {
    req.method = overrides.method;
  }
  if (overrides.host !== undefined) {
    req.host = overrides.host;
  }
  if (overrides.referer !== undefined) {
    req.referer = overrides.referer;
  }
  if (overrides.origin !== undefined) {
    req.origin = overrides.origin;
  }
  if (overrides.path !== undefined) {
    req.path = overrides.path;
  }
  if (overrides.params !== undefined) {
    req.params = overrides.params;
  }
  if (overrides.isSelfQuery !== undefined) {
    req.isSelfQuery = overrides.isSelfQuery;
  }
  return req;
};

test('PeerAPI 端口与通告：确定性公式 + peerapi4/6 + PeerAPIDNS:1 + peerAPIBase 地址族', () => {
  const ip16: Uint8Array = ip16Of([0x01, 0x02, 0x03]);
  const ports: number[] = [];
  for (let tryIndex: number = 0; tryIndex < 5; tryIndex += 1) {
    const p: number = derivePeerApiPort(ip16, tryIndex);
    assert.ok(p >= 32768 && p <= 65535, '候选端口落在 [32768,65535]（peerapi.go:107-115）');
    ports.push(p);
  }
  assert.equal(new Set(ports).size >= 1, true, '5 次尝试各有候选（失败则退临时端口/假监听器）');

  // 通告端口 1（假监听器）合法——netstack 截获形态（peerapi.go:1022-1066）。
  const svcs = advertisePeerApiServices([
    { ip: '100.64.0.9', port: ports[0] },
    { ip: 'fd7a:115c:a1e0::9', port: 1 },
  ]);
  assert.equal(svcs.length, 3);
  assert.equal(svcs[0].proto, 'peerapi4');
  assert.equal(svcs[1].proto, 'peerapi6');
  assert.equal(svcs[1].port, 1, '通告端口 1 是合法通告值');
  assert.equal(svcs[2].proto, 'peerapi-dns-proxy');
  assert.equal(svcs[2].port, 1, 'PeerAPIDNS port=1 仅能力标记');

  // peerAPIBase：self 有 v4 且对端 p4≠0 → v4；通告端口 1 亦照用（对端永远以 Services 为准）。
  assert.equal(peerApiBaseFor(true, true, '100.64.0.9', 'fd7a:115c:a1e0::9', svcs), 'http://100.64.0.9:' + String(ports[0]));
  assert.equal(peerCanProxyDnsFor(148, svcs), true, 'cap>=26 ⇒ 可代理 ExitDNS');
  assert.equal(peerCanProxyDnsFor(25, [{ proto: 'peerapi-dns-proxy', port: 1 }]), true, '老控制面 Services 兜底');
});

test('PeerAPI 校验：Host peer/自身 ip:port/MasqAddr 合法；Referer/Origin 恒 403', () => {
  const server: MockPeerApiServer = makePeerServer(null);
  const hello = server.handle(peerRequest({ path: '/' }));
  assert.equal(hello.status, 200);
  assert.equal(hello.body, 'Hello, exit-node-a', "'/' 问候页（peerapi.go:414-428）");

  const selfHost = server.handle(peerRequest({ path: '/', host: '100.64.0.9:40001' }));
  assert.equal(selfHost.status, 200, 'Host=自身 ip:port 合法（isAddressValid ∈ self Addresses）');

  const masqServer: MockPeerApiServer = new MockPeerApiServer({
    displayName: 'masq-node',
    selfAddressPrefixes: ['100.64.0.9/32'],
    masqV4: '10.9.9.9',
    masqV6: '',
    listeners: [{ ip: '100.64.0.9', port: 40001 }],
    answerDns: null,
    offersExitNodeOrAppConnector: false,
    filterAcceptsTcp53: false,
  });
  const viaMasq = masqServer.handle(peerRequest({ path: '/', host: '10.9.9.9:40001' }));
  assert.equal(viaMasq.status, 200, 'MasqAddr 也算有效目的（4via6/伪装，peerapi.go:262-273）');
  const viaReal = masqServer.handle(peerRequest({ path: '/', host: '100.64.0.9:40001' }));
  assert.equal(viaReal.status, 403, '有 Masq 后真实地址不再直接合法（isAddressValid 的 masq 分支）');

  const withReferer = server.handle(peerRequest({ path: '/', referer: 'https://evil.test/' }));
  assert.equal(withReferer.status, 403, '任何 Referer 恒拒');
  const withOrigin = server.handle(peerRequest({ path: '/', origin: 'https://evil.test' }));
  assert.equal(withOrigin.status, 403, '任何 Origin 恒拒');
  const foreign = server.handle(peerRequest({ path: '/', host: '10.1.2.3:9999' }));
  assert.equal(foreign.status, 403, '非自身地址拒绝');
  const unknownPath = server.handle(peerRequest({ path: '/v0/goroutines' }));
  assert.equal(unknownPath.status, 404, '未接线的 debug 族 → 404（mock 面只承诺 / 与 /dns-query）');
});

test('ExitDNS：授权链放行/拒绝 + 注入应答；POST 501；无能力 503', () => {
  const core: ResolverCore = makeResolver();
  const server: MockPeerApiServer = makePeerServer((name: string, qtype: number) => core.query(name, qtype));

  // 对端非 self：须 exit node/app connector 且 PacketFilter 放行 :53（都为 true）。
  const ok = server.handle(peerRequest({ path: '/dns-query', params: { q: 'host.tail-net.example.ts.net', t: 'a' } }));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['content-type'], 'application/json');
  const payload = JSON.parse(ok.body) as { RCode: number; Answers: { data: string }[] };
  assert.equal(payload.RCode, DnsRCode.NOERROR);
  assert.equal(payload.Answers[0].data, '100.64.0.2', 'ExitDNS 经注入的 ResolverCore 适配应答');

  const noExit: MockPeerApiServer = new MockPeerApiServer({
    displayName: 'plain-node',
    selfAddressPrefixes: ['100.64.0.9/32'],
    masqV4: '',
    masqV6: '',
    listeners: [{ ip: '100.64.0.9', port: 40001 }],
    answerDns: (name: string, qtype: number): ReturnType<ResolverCore['query']> => core.query(name, qtype),
    offersExitNodeOrAppConnector: false,
    filterAcceptsTcp53: true,
  });
  const rejected = noExit.handle(peerRequest({ path: '/dns-query', params: { q: 'host.tail-net.example.ts.' } }));
  assert.equal(rejected.status, 403, '非 exit/app-connector ⇒ 授权链拒绝（peerapi.go:683-752）');

  const filterBlocked: MockPeerApiServer = new MockPeerApiServer({
    displayName: 'exit-no-filter',
    selfAddressPrefixes: ['100.64.0.9/32'],
    masqV4: '',
    masqV6: '',
    listeners: [{ ip: '100.64.0.9', port: 40001 }],
    answerDns: null,
    offersExitNodeOrAppConnector: true,
    filterAcceptsTcp53: false,
  });
  const blocked = filterBlocked.handle(peerRequest({ path: '/dns-query', params: { q: 'host.tail-net.example.ts.' } }));
  assert.equal(blocked.status, 403, 'PacketFilter 不放行 :53 ⇒ 拒绝（独立第二道门）');

  const selfQuery = server.handle(peerRequest({ path: '/dns-query', params: { q: 'host.tail-net.example.ts.' }, isSelfQuery: true }));
  assert.equal(selfQuery.status, 200, 'isSelf 恒答');

  const post = server.handle(peerRequest({ path: '/dns-query', method: 'POST', params: { q: 'x.' } }));
  assert.equal(post.status, 501, 'wire DoH 打包不在 mock 范围（语义偏差已锚定）');

  const noDnsServer: MockPeerApiServer = makePeerServer(null);
  const unavailable = noDnsServer.handle(peerRequest({ path: '/dns-query', params: { q: 'x.' } }));
  assert.equal(unavailable.status, 503, '无 DNS 能力 → 503');

  const missing = server.handle(peerRequest({ path: '/dns-query', params: {} }));
  assert.equal(missing.status, 400, '缺 q → 400');
});

// ---- TUN 数据面 ----

test('FakeTunDevice：NewFake 语义（写恒接受、读恒无包、MTU 1500、名 FakeTUN、isFake）', () => {
  const dev: FakeTunDevice = new FakeTunDevice();
  assert.equal(dev.isFake(), true, 'IsFakeTun()=true（fake.go:58）');
  assert.equal(dev.mtu(), TUN_FAKE_MTU, 'MTU=1500（fake.go:54）');
  assert.equal(dev.name(), TUN_FAKE_NAME, 'Name=FakeTUN（fake.go:51）');
  assert.equal(dev.read(), null, '无包可读（上游阻塞至 Close 的 mock 同伦）');
  assert.equal(dev.write(new Uint8Array([0x45, 0x00])), 1, 'Write 恒 (1,nil)（fake.go:41-48）');
  assert.equal(dev.writeCount(), 1);
  dev.close();
  assert.equal(dev.isClosed(), true, 'Close 后 EOF 状态可见');
  assert.equal(dev.write(new Uint8Array([0x45])), 0, '关闭后写拒绝');
});

test('TsTunWrapper cork：未 Start() 读不到包（防 mock 测试假绿），Start 后可读', () => {
  const dev: MemoryTunDevice = new MemoryTunDevice('tun0', 1400);
  const wrapper: TsTunWrapper = new TsTunWrapper(dev);
  dev.feed(new Uint8Array([0x01]));
  assert.equal(wrapper.read(), null, '未 Start ⇒ Read 永久阻塞（wrap.go:95-96）——mock 表达为读不到');
  assert.equal(wrapper.corkedReads, 1, 'cork 期读被计数');
  wrapper.start();
  const pkt: Uint8Array | null = wrapper.read();
  assert.notEqual(pkt, null, 'Start() 置位并关门（wrap.go:274-277）');
  assert.deepEqual(pkt, new Uint8Array([0x01]));
});

test('出站过滤：静默丢弃 + 计数（不回错）；入站 DNAT 先于过滤、失败静默丢弃', () => {
  const dev: MemoryTunDevice = new MemoryTunDevice('tun0', 1400);
  const wrapper: TsTunWrapper = new TsTunWrapper(dev);
  wrapper.start();

  // OS→WG：出站过滤 drop（wrap.go:901-908 drop 计数）。过滤规则：拒绝 0xff 开头的探测包。
  wrapper.filterOutboundToWireGuard = (pkt: Uint8Array): boolean => pkt[0] !== 0xff;
  dev.feed(new Uint8Array([0xff, 0x00]));
  assert.equal(wrapper.read(), null, '被出站过滤丢弃 ⇒ 读不到');
  assert.equal(wrapper.droppedOutbound, 1);
  dev.feed(new Uint8Array([0x45, 0x00]));
  assert.notEqual(wrapper.read(), null, '放行 ⇒ 可读');

  // WG→OS：DNAT 先行（wrap.go:1239 在 :1245 前），过滤看的是改写后的包。
  let seenByFilter: number = 0;
  wrapper.dnatInbound = (pkt: Uint8Array): Uint8Array => {
    const out: Uint8Array = pkt.slice();
    out[0] = 0x77;
    return out;
  };
  wrapper.filterInboundFromWireGuard = (pkt: Uint8Array): boolean => {
    seenByFilter = pkt[0];
    return true;
  };
  let sunk: number = 0;
  dev.sink = (pkt: Uint8Array): void => {
    sunk = pkt[0];
  };
  wrapper.write(new Uint8Array([0x45]));
  assert.equal(seenByFilter, 0x77, '入站过滤看到的是 DNAT 改写后的包（时序锚定）');
  assert.equal(sunk, 0x77, '放行 ⇒ 到达 OS 侧');

  // 过滤失败 = 静默丢弃 + 计数，不向 WG 回错（wrap.go:1246-1248）。
  wrapper.filterInboundFromWireGuard = (): boolean => false;
  assert.equal(wrapper.write(new Uint8Array([0x45])), 1, 'Write 仍返回已消费数（不回错）');
  assert.equal(wrapper.droppedInbound, 1, '静默丢弃计数');
  assert.equal(sunk, 0x77, '底层未收到新包（上一个 sunk 值未被覆盖）');
});

test('InjectInboundDirect 不过入站过滤；InjectOutbound 走出站过滤；事件位 1/2/4', () => {
  const dev: MemoryTunDevice = new MemoryTunDevice('tun0', 1400);
  const wrapper: TsTunWrapper = new TsTunWrapper(dev);
  wrapper.start();
  wrapper.filterInboundFromWireGuard = (): boolean => false;
  let sunkCount: number = 0;
  dev.sink = (): void => {
    sunkCount += 1;
  };
  wrapper.injectInboundDirect(new Uint8Array([0x45]));
  assert.equal(sunkCount, 1, '合成包直达 OS、不过入站过滤（wrap.go:1383，netstack 交付 TCP 栈回应）');
  assert.equal(wrapper.droppedInbound, 0, '注入不计入过滤丢弃');

  wrapper.filterOutboundToWireGuard = (): boolean => false;
  wrapper.injectOutbound(new Uint8Array([0x45]));
  assert.equal(wrapper.read(), null, 'InjectOutbound 进入 WG 方向并受出站过滤（wrap.go:1447）');
  assert.equal(wrapper.droppedOutbound, 1);

  assert.equal(TunEventBits.Up, 1, 'EventUp=1（fork tun/tun.go:12-18）');
  assert.equal(TunEventBits.Down, 2);
  assert.equal(TunEventBits.MTUUpdate, 4);
  wrapper.emitEvent(TunEventBits.Up);
  assert.equal(wrapper.eventsUpDown(), 1, '引擎只旁路监听升降事件（userspace.go:521-535）');
  wrapper.emitEvent(TunEventBits.Down);
  assert.equal(wrapper.eventsUpDown(), 3, '位累加');
});

test('TunCable：双端内存网线——A 的 WG→OS 出包即 B 的 OS→WG 入包（ cork 后按序可读）', () => {
  const devA: MemoryTunDevice = new MemoryTunDevice('tun-a', 1500);
  const devB: MemoryTunDevice = new MemoryTunDevice('tun-b', 1500);
  const a: TsTunWrapper = new TsTunWrapper(devA);
  const b: TsTunWrapper = new TsTunWrapper(devB);
  const cable: TunCable = new TunCable(a, b);
  a.start();
  b.start();

  // A 的 WG 解密出站（write）→ 网线 → B 的 OS 入方向（read 出去往 WG）。
  a.write(new Uint8Array([0x01, 0x02]));
  assert.equal(cable.deliveredAtoB, 1, '网线投递计数');
  const atB: Uint8Array | null = b.read();
  assert.notEqual(atB, null);
  assert.deepEqual(atB, new Uint8Array([0x01, 0x02]), 'B 读到 A 发的原始字节');

  // 对向同理。
  b.write(new Uint8Array([0x03]));
  const atA: Uint8Array | null = a.read();
  assert.deepEqual(atA, new Uint8Array([0x03]));
  assert.equal(cable.deliveredBtoA, 1);

  // 未 Start 的 cork 语义在网线两端同样成立。
  const devC: MemoryTunDevice = new MemoryTunDevice('tun-c', 1500);
  const c: TsTunWrapper = new TsTunWrapper(devC);
  new TunCable(a, c);
  a.write(new Uint8Array([0x09]));
  assert.equal(c.read(), null, '未 Start ⇒ 读不到（cork 在网线对端同样生效）');
  c.start();
  assert.deepEqual(c.read(), new Uint8Array([0x09]));

  // 非内存设备不能接线（NewFake 无 OS 侧队列语义）。
  const fakeWrap: TsTunWrapper = new TsTunWrapper(new FakeTunDevice());
  assert.throws(() => new TunCable(a, fakeWrap), /MemoryTunDevice/, 'Fake 桩不参与网线（无 OS 侧语义）');
});
