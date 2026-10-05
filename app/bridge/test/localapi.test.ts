/**
 * app/bridge LocalAPI/IPC mock 测试 —— 壳 ↔ LocalAPI 语义接线（Node node:test，确定性）。
 *
 * 覆盖（协议语义全部锚定 v1.102.3，行号见 control/src/localapi.ts 头注）：
 * 1) 传输纪律：客户端 Host=local-tailscaled.sock、Referer/Origin → 403、根路径 tailscaled\n；
 * 2) watch-ipn-bus：十进制 mask、bad mask 400、InProcessNoDisconnect 400、
 *    RateLimit 互斥 400、首条 SessionID/后续无、PeerChanges 位门控；
 * 3) prefs：PATCH+掩码语义（无整对象写；PUT/POST → 405）、写权限 403；
 * 4) /status：BackendState 字符串、Peer 以 nodekey 为键、DNSName 恒尾点；
 * 5) /dns-query：写权限 403（隐私考量）、仅 GET 405、经 MagicDNS ResolverCore 应答；
 * 6) 状态机副作用：Running→Stopped 关 PeerAPI + Reconfig 空配置、NeedsLogin 封引擎；
 * 7) 日志纪律：非安全方法留痕、安全方法不留。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utf8Encode, type HttpResponse } from '@ohos-tailscale/common';
import {
  IpnState,
  NotifyWatchOptBits,
  ResolverCore,
  compileMagicDnsConfig,
  dnsConfigForNetmap,
  type NetmapDnsView,
} from '@ohos-tailscale/control';
import {
  MOCK_TAILSCALE_CAP,
  MOCK_TAILSCALE_VERSION,
  MockIpnBackend,
  MockLocalApiServer,
  callLocalApi,
  parseNotifyLine,
  type MockLocalApiParams,
} from '../src/index.ts';

/** 组装 MagicDNS 解析核（与 control 侧测试同构：Proxied 开 + Hosts 两条）。 */
const makeResolver = (): ResolverCore => {
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
  const cfg = dnsConfigForNetmap(view);
  assert.notEqual(cfg, null);
  const compiled = compileMagicDnsConfig(cfg as NonNullable<ReturnType<typeof dnsConfigForNetmap>>);
  compiled.resolver.hosts.push({ fqdn: 'host.tail-net.example.ts.net.', addrs: ['100.64.0.2', 'fd7a:115c:a1e0::2'] });
  return new ResolverCore(compiled);
};

/** 组装 (backend, server) 对：读+写权限、无口令。 */
const makeFixture = (): { backend: MockIpnBackend; server: MockLocalApiServer } => {
  const backend: MockIpnBackend = new MockIpnBackend();
  backend.resolver = makeResolver();
  const params: MockLocalApiParams = { permitRead: true, permitWrite: true, requiredPassword: '' };
  const server: MockLocalApiServer = new MockLocalApiServer(backend, params);
  return { backend: backend, server: server };
};

const bodyText = (resp: HttpResponse): string => {
  return Buffer.from(resp.body).toString('utf8');
};

test('传输纪律：约定 Host 放行、Referer/Origin 403、根路径 tailscaled\\n、非 localapi 前缀 404', () => {
  const fx = makeFixture();
  const ok = callLocalApi(fx.server, 'GET', '/localapi/v0/status', new Uint8Array(0));
  assert.equal(ok.status, 200, 'Host=local-tailscaled.sock（buildLocalApiRequest 内建）放行');
  assert.equal(ok.headers['tailscale-version'], MOCK_TAILSCALE_VERSION);
  assert.equal(ok.headers['tailscale-cap'], String(MOCK_TAILSCALE_CAP), 'Tailscale-Cap=capver 数值');
  assert.equal(ok.headers['x-frame-options'], 'DENY', '安全三件套随每个响应');
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');

  const withReferer = callLocalApi(fx.server, 'GET', '/localapi/v0/status', new Uint8Array(0), { referer: 'https://evil.test/' });
  assert.equal(withReferer.status, 403, '任何 Referer → 403 invalid localapi request');
  assert.match(bodyText(withReferer), /invalid localapi request/);

  const withOrigin = callLocalApi(fx.server, 'GET', '/localapi/v0/status', new Uint8Array(0), { origin: 'https://evil.test' });
  assert.equal(withOrigin.status, 403, '任何 Origin → 403');

  const root = callLocalApi(fx.server, 'GET', '/', new Uint8Array(0));
  assert.equal(root.status, 200);
  assert.equal(bodyText(root), 'tailscaled\n', '根路径回 tailscaled\\n（localapi.go:347-349）');

  const notFound = callLocalApi(fx.server, 'GET', '/nonlocalapi/status', new Uint8Array(0));
  assert.equal(notFound.status, 404, '非 /localapi/v0/ 前缀 → 404 形态');

  const unknown = callLocalApi(fx.server, 'GET', '/localapi/v0/unknown-endpoint', new Uint8Array(0));
  assert.equal(unknown.status, 404, '未知端点 → 404 形态');
});

test('watch-ipn-bus：首条批量带 SessionID/State/Prefs；后续 State 增量无 SessionID；PeerChanges 位门控', () => {
  const fx = makeFixture();
  fx.backend.enterState(IpnState.Running);
  fx.backend.peers.set(2, { ID: 2, Hostname: 'host', Online: true });
  fx.backend.peerKeys.set(2, 'nodekey:aaaa');

  // HTTP 形态：mask=InitialState|InitialPrefs|InitialStatus（2|4|16384=16390，十进制字符串）。
  const mask: number = NotifyWatchOptBits.InitialState | NotifyWatchOptBits.InitialPrefs | NotifyWatchOptBits.InitialStatus;
  const resp = callLocalApi(fx.server, 'GET', '/localapi/v0/watch-ipn-bus?mask=' + String(mask), new Uint8Array(0));
  assert.equal(resp.status, 200);
  assert.equal(resp.headers['content-type'], 'application/json');
  const lines: string[] = bodyText(resp).split('\n').filter((l: string): boolean => l.length > 0);
  assert.equal(lines.length, 1, '首批是一条聚合 Notify');
  const first = parseNotifyLine(lines[0]);
  assert.equal(first.sessionId.startsWith('sess-'), true, '首条携带 SessionID（backend.go:304-308）');
  assert.equal(first.state, IpnState.Running, 'InitialState ⇒ 首条带 State');
  assert.notEqual(first.prefs, null, 'InitialPrefs ⇒ 首条带 Prefs');
  assert.notEqual(first.initialStatus, null, 'InitialStatus ⇒ 首条带新式快照');
  assert.equal(first.initialStatus?.BackendState, 'Running');

  // 增量：openWatch 直连后端（HTTP 长连的流式形态由载体表达；语义层一致）。
  const watch = fx.backend.openWatch(NotifyWatchOptBits.InitialState);
  watch.drainLines(); // 清掉首条
  fx.backend.enterState(IpnState.Stopped);
  const deltaLines: string[] = watch.drainLines();
  assert.equal(deltaLines.length, 1, '状态转移广播一条 State Notify');
  const delta = parseNotifyLine(deltaLines[0]);
  assert.equal(delta.sessionId, '', '后续消息不得携带 SessionID——客户端必须自己存（C3 陷阱 5）');
  assert.equal(delta.state, IpnState.Stopped);

  // PeerChanges 门控：未设 4096/32768 位 ⇒ peer 增删不上 bus（C3 陷阱 7）。
  const noPeerWatch = fx.backend.openWatch(NotifyWatchOptBits.InitialState);
  const peerWatch = fx.backend.openWatch(NotifyWatchOptBits.PeerChanges);
  noPeerWatch.drainLines();
  peerWatch.drainLines();
  fx.backend.notifyPeersChanged([{ ID: 2, Online: true }]);
  assert.equal(noPeerWatch.drainLines().length, 0, '无 PeerChanges 位 ⇒ 不投递');
  const got = peerWatch.drainLines();
  assert.equal(got.length, 1, '有 PeerChanges 位 ⇒ 投递');
  assert.equal(parseNotifyLine(got[0]).peersChanged[0].ID, 2);

  fx.backend.notifyPeersRemoved([2]);
  assert.equal(peerWatch.drainLines().length, 1, 'PeersRemoved 同受位门控');
});

test('watch-ipn-bus 校验：非十进制 mask 400；InProcessNoDisconnect 400；RateLimit 互斥 400', () => {
  const fx = makeFixture();
  const bad = callLocalApi(fx.server, 'GET', '/localapi/v0/watch-ipn-bus?mask=0x10', new Uint8Array(0));
  assert.equal(bad.status, 400, 'mask 是十进制字符串（backend.go:264-271），0x10 → bad mask');
  assert.match(bodyText(bad), /bad mask/);

  const inProcess = callLocalApi(
    fx.server,
    'GET',
    '/localapi/v0/watch-ipn-bus?mask=' + String(NotifyWatchOptBits.InProcessNoDisconnect),
    new Uint8Array(0),
  );
  assert.equal(inProcess.status, 400, 'NotifyInProcessNoDisconnect 仅进程内，HTTP 客户端恒 400');
  assert.match(bodyText(inProcess), /in-process/);

  const rl = callLocalApi(
    fx.server,
    'GET',
    '/localapi/v0/watch-ipn-bus?mask=' + String(NotifyWatchOptBits.RateLimit | NotifyWatchOptBits.PeerChanges),
    new Uint8Array(0),
  );
  assert.equal(rl.status, 400, 'NotifyRateLimit 与新式位互斥（backend.go:273-290）');
  assert.match(bodyText(rl), /incompatible/);
});

test('prefs：PATCH+掩码（XxxSet 决定拷贝）；POST → 405；无写权限 PATCH → 403', () => {
  const fx = makeFixture();
  const patchBody: string = JSON.stringify({
    CorpDNS: false,
    CorpDNSSet: true,
    WantRunning: true,
    WantRunningSet: true,
    Hostname: 'should-not-apply',
    HostnameSet: false,
  });
  const patched = callLocalApi(fx.server, 'PATCH', '/localapi/v0/prefs', utf8Encode(patchBody));
  assert.equal(patched.status, 200);
  const prefs = JSON.parse(bodyText(patched)) as { CorpDNS: boolean; WantRunning: boolean; Hostname: string; ControlURL: string };
  assert.equal(prefs.CorpDNS, false, '掩码 true ⇒ 字段更新');
  assert.equal(prefs.WantRunning, true, '掩码 true ⇒ 字段更新');
  assert.equal(prefs.Hostname, '', '掩码 false ⇒ 基础值保持（ApplyEdits 语义）');
  assert.match(String(prefs.ControlURL), /controlplane\.tailscale\.com$/, '未触碰字段保持缺省');

  const wrongMethod = callLocalApi(fx.server, 'PUT', '/localapi/v0/prefs', utf8Encode('{}'));
  assert.equal(wrongMethod.status, 405, 'LocalAPI 无整对象写（仅 GET/HEAD/PATCH 三分支）');

  const roBackend: MockIpnBackend = new MockIpnBackend();
  const roServer: MockLocalApiServer = new MockLocalApiServer(roBackend, {
    permitRead: true,
    permitWrite: false,
    requiredPassword: '',
  });
  const denied = callLocalApi(roServer, 'PATCH', '/localapi/v0/prefs', utf8Encode(patchBody));
  assert.equal(denied.status, 403, 'PATCH 需 PermitWrite');
  assert.match(bodyText(denied), /access denied/);
});

test('/status：BackendState 字符串 + Peer 以 nodekey 为键 + DNSName 恒带尾点；?peers=false 清空 Peer', () => {
  const fx = makeFixture();
  fx.backend.enterState(IpnState.Running);
  fx.backend.magicDnsSuffix = 'tail-net.example.ts.net';
  fx.backend.peers.set(3, { ID: 3, Hostname: 'peerhost', Online: true });
  fx.backend.peerKeys.set(3, 'nodekey:cccc');

  const resp = callLocalApi(fx.server, 'GET', '/localapi/v0/status', new Uint8Array(0));
  assert.equal(resp.status, 200);
  const status = JSON.parse(bodyText(resp)) as { BackendState: string; Peer: Record<string, { DNSName?: string; Online?: boolean }> };
  assert.equal(status.BackendState, 'Running', 'BackendState 用 stateStrings 字符串形态');
  const peer = status.Peer['nodekey:cccc'];
  assert.notEqual(peer, undefined, 'Peer 键是节点公钥（ipnstate.go:79-80）');
  assert.equal(peer?.DNSName, 'peerhost.tail-net.example.ts.net.', 'DNSName 形如 host.<suffix>. 且尾点必带（ipnstate.go:239-241）');
  assert.equal(peer?.Online, true);

  const noPeers = callLocalApi(fx.server, 'GET', '/localapi/v0/status?peers=false', new Uint8Array(0));
  const status2 = JSON.parse(bodyText(noPeers)) as { Peer?: Record<string, unknown> };
  assert.equal(status2.Peer, undefined, '?peers=false → StatusWithoutPeers 形态');
});

test('/dns-query：写权限 403（隐私考量）、仅 GET 405、未知 type 400、经 ResolverCore 应答', () => {
  const fx = makeFixture();
  const ok = callLocalApi(fx.server, 'GET', '/localapi/v0/dns-query?name=host.tail-net.example.ts.net&type=A', new Uint8Array(0));
  assert.equal(ok.status, 200, '有写权限 → 200');
  const payload = JSON.parse(bodyText(ok)) as { RCode: number; Answers: { data: string }[] };
  assert.equal(payload.RCode, 0, 'NOERROR');
  assert.equal(payload.Answers.length, 1);
  assert.equal(payload.Answers[0].data, '100.64.0.2', 'MagicDNS 应答来自 ResolverCore（control 决策序）');

  const noWriteBackend: MockIpnBackend = new MockIpnBackend();
  noWriteBackend.resolver = fx.backend.resolver;
  const noWriteServer: MockLocalApiServer = new MockLocalApiServer(noWriteBackend, {
    permitRead: true,
    permitWrite: false,
    requiredPassword: '',
  });
  const denied = callLocalApi(noWriteServer, 'GET', '/localapi/v0/dns-query?name=x.', new Uint8Array(0));
  assert.equal(denied.status, 403, '/dns-query 要写权限（隐私考量，localapi.go:1752-1756——与「读=全放行」直觉相反）');
  assert.match(bodyText(denied), /dns-query access denied/);

  const post = callLocalApi(fx.server, 'POST', '/localapi/v0/dns-query?name=x.', new Uint8Array(0));
  assert.equal(post.status, 405, '仅 GET（:1746-1748）');

  const badType = callLocalApi(fx.server, 'GET', '/localapi/v0/dns-query?name=x.&type=BOGUS', new Uint8Array(0));
  assert.equal(badType.status, 400, '类型表外 → 400（dnsMessageTypeForString）');
});

test('状态机副作用：Running→Stopped 关 PeerAPI + Reconfig 空配置；NeedsLogin 封引擎更新', () => {
  const fx = makeFixture();
  fx.backend.enterState(IpnState.NeedsLogin);
  assert.equal(fx.backend.engineUpdatesBlocked, true, 'NeedsLogin 封引擎更新（:6777-6780）');
  assert.equal(fx.backend.reconfigEmptyCount, 1, 'NeedsLogin fallthrough ⇒ Reconfig 三份空配置（:6781-6787）');
  assert.equal(fx.backend.peerApiClosed, false);

  fx.backend.enterState(IpnState.Starting);
  assert.equal(fx.backend.authReconfigCount, 1, 'Starting ⇒ authReconfigLocked（:6792-6795）');
  assert.equal(fx.backend.engineUpdatesBlocked, false, '离开 NeedsLogin ⇒ 解封');

  fx.backend.enterState(IpnState.Running);
  fx.backend.enterState(IpnState.Stopped);
  assert.equal(fx.backend.peerApiClosed, true, '离开 Running ⇒ 关 PeerAPI（:6752-6758）');
  assert.equal(fx.backend.reconfigEmptyCount, 2, 'Stopped ⇒ 再拆一次数据面');

  const before: number = fx.backend.reconfigEmptyCount;
  fx.backend.enterState(IpnState.Stopped);
  assert.equal(fx.backend.reconfigEmptyCount, before, 'old == new ⇒ 提前 return，无副作用');
});

test('日志纪律：非安全方法留痕、GET 不留；login-interactive/logout 204；口令模式 401/403', () => {
  const fx = makeFixture();
  callLocalApi(fx.server, 'GET', '/localapi/v0/status', new Uint8Array(0));
  assert.equal(fx.server.logLines.length, 0, '安全方法不记日志（:338-345）');
  callLocalApi(fx.server, 'POST', '/localapi/v0/login-interactive', new Uint8Array(0));
  assert.equal(fx.server.logLines.length, 1, '非安全方法记一行');
  const login = callLocalApi(fx.server, 'POST', '/localapi/v0/login-interactive', new Uint8Array(0));
  assert.equal(login.status, 204, '成功 204（:947-951）');

  const pwBackend: MockIpnBackend = new MockIpnBackend();
  const pwServer: MockLocalApiServer = new MockLocalApiServer(pwBackend, {
    permitRead: true,
    permitWrite: true,
    requiredPassword: 'pw123',
  });
  const noAuth = callLocalApi(pwServer, 'GET', '/localapi/v0/status', new Uint8Array(0));
  assert.equal(noAuth.status, 401, '有口令但无 BasicAuth → 401 auth required');
  const wrong = callLocalApi(pwServer, 'GET', '/localapi/v0/status', new Uint8Array(0), {
    authorization: 'Basic ' + Buffer.from('user:wrong').toString('base64'),
  });
  assert.equal(wrong.status, 403, '口令不符 → 403 bad password');
  const right = callLocalApi(pwServer, 'GET', '/localapi/v0/status', new Uint8Array(0), {
    authorization: 'Basic ' + Buffer.from('user:pw123').toString('base64'),
  });
  assert.equal(right.status, 200, '口令相符放行（沙盒 macOS 形态）');
});
