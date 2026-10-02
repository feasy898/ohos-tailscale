/**
 * LocalAPI/IPC 测试：ipn.State 表、watch mask 解析/校验、路由解析、请求守卫、
 * 响应头、MaskedPrefs 掩码合并、Notify 行编解码、/dns-query 类型表、状态机副作用。
 *
 * 语义锚点（v1.102.3 实拉，2026-10-03 本会话复核）：
 * - ipn/backend.go:27-49（State/stateStrings）、:82-195（mask 位表）、:264-290
 *   （UnmarshalText base10 + ValidateNotifyWatchOpt）、:300-481（Notify/SessionID）；
 * - ipn/localapi/localapi.go:249-258（Referer/Origin 403 + 响应头）、:285-306（validHost）、
 *   :314-345（handlerForPath/logRequest）、:893-933（watch-ipn-bus）、:1004-1036（prefs）、
 *   :1750-1756（dns-query 需写权限、仅 GET）、:1783-1816（类型表）；
 * - ipn/prefs.go:356-393（MaskedPrefs）、:417-437（ApplyEdits）；
 * - ipn/ipnlocal/local.go:6724-6808（enterStateLocked 副作用）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ControlError,
  IPN_DEFAULT_CONTROL_URL,
  IpnState,
  LOCAL_API_HOST,
  LocalApiPermit,
  NotifyWatchOptBits,
  applyMaskedPrefs,
  buildLocalApiRequest,
  checkLocalApiGuards,
  cloneIpnPrefs,
  decodeIpnNotifyLine,
  decodeMaskedPrefs,
  defaultIpnPrefs,
  dnsMessageTypeForString,
  emptyIpnNotify,
  encodeIpnNotifyLine,
  encodeNotifyStream,
  encodeStatusJson,
  ipnStateToString,
  isKnownLocalApiRoute,
  isSafeHttpMethod,
  localApiBaseHeaders,
  localApiLogLine,
  localApiRoutePermit,
  localApiValidHost,
  localStateEffect,
  parseIpnState,
  parseLocalApiTarget,
  parseNotifyWatchMask,
  parseUrlQuery,
  queryBool,
  validateNotifyWatchMask,
  type IpnNotify,
  type StatusJsonView,
} from '../src/index.ts';

test('ipn.State：0..6 与字符串表逐值锁定（backend.go:27-49）', () => {
  assert.equal(IpnState.NoState, 0);
  assert.equal(IpnState.InUseOtherUser, 1);
  assert.equal(IpnState.NeedsLogin, 2);
  assert.equal(IpnState.NeedsMachineAuth, 3);
  assert.equal(IpnState.Stopped, 4);
  assert.equal(IpnState.Starting, 5);
  assert.equal(IpnState.Running, 6);
  assert.equal(ipnStateToString(IpnState.Running), 'Running', 'status JSON 的 BackendState 用字符串形态');
  assert.equal(ipnStateToString(IpnState.NeedsMachineAuth), 'NeedsMachineAuth');
  assert.equal(ipnStateToString(99), 'unknown');
  assert.equal(parseIpnState('Stopped'), 4);
  assert.equal(parseIpnState('Bogus'), null);
});

test('watch mask：十进制字符串解析；InProcessNoDisconnect 恒 400；RateLimit 与新式位互斥', () => {
  // backend.go:264-271：UnmarshalText = strconv.ParseUint(base 10)。
  assert.equal(parseNotifyWatchMask('16384'), NotifyWatchOptBits.InitialStatus, '十进制文本（不是 hex！）');
  assert.equal(parseNotifyWatchMask('4096'), NotifyWatchOptBits.PeerChanges);
  assert.throws(() => parseNotifyWatchMask('0x10'), ControlError, '非十进制 → "bad mask" 400 形态');
  assert.throws(() => parseNotifyWatchMask('-1'), ControlError);
  assert.throws(() => parseNotifyWatchMask('18446744073709551616'), ControlError, '>uint64 拒绝');

  // localapi.go:905-908：NotifyInProcessNoDisconnect 仅进程内订阅者。
  const inProcess: string | null = validateNotifyWatchMask(NotifyWatchOptBits.InProcessNoDisconnect);
  assert.match(String(inProcess), /only valid for in-process/, 'HTTP 客户端恒 400');

  // backend.go:273-290：NotifyRateLimit 与新式位互斥。
  const rl: string | null = validateNotifyWatchMask(NotifyWatchOptBits.RateLimit | NotifyWatchOptBits.PeerChanges);
  assert.match(String(rl), /incompatible/, 'RateLimit+PeerChanges → 400');
  assert.equal(validateNotifyWatchMask(NotifyWatchOptBits.RateLimit | NotifyWatchOptBits.InitialNetMap), null, 'RateLimit+InitialNetMap(遗留) 合法');
  assert.equal(validateNotifyWatchMask(NotifyWatchOptBits.PeerChanges | NotifyWatchOptBits.PeerPatches), null, 'PeerPatches 蕴含 PeerChanges 可并用');
});

test('路由解析 handlerForPath：根/精确/前缀（profiles/）/非 localapi 前缀 404 形态', () => {
  const root = parseLocalApiTarget('/');
  assert.notEqual(root, null);
  assert.equal(root?.isRoot, true, '"/" → 根（回 tailscaled\\n，:347-349）');

  const status = parseLocalApiTarget('/localapi/v0/status');
  assert.notEqual(status, null);
  assert.equal(status?.route, 'status');

  const profiles = parseLocalApiTarget('/localapi/v0/profiles/abc123');
  assert.notEqual(profiles, null);
  assert.equal(profiles?.route, 'profiles/', '前缀匹配键含尾斜杠（:322-335）');

  assert.equal(parseLocalApiTarget('/nonlocalapi/status'), null, '非 /localapi/v0/ 前缀 → 404 形态');
  assert.equal(parseLocalApiTarget('/localapi/v0/unknown-endpoint'), null, '未知端点 → 404 形态');
  assert.equal(isKnownLocalApiRoute('dns-query'), true);
  assert.equal(isKnownLocalApiRoute('bogus'), false);
  assert.equal(localApiRoutePermit('dns-query'), LocalApiPermit.Write, '/dns-query 要写权限（隐私考量，:1752-1756）');
  assert.equal(localApiRoutePermit('derpmap'), LocalApiPermit.None, '/derpmap 无权限检查');
  assert.equal(localApiRoutePermit('status'), LocalApiPermit.Read);
  assert.equal(isSafeHttpMethod('GET'), true);
  assert.equal(isSafeHttpMethod('POST'), false);
  assert.equal(localApiLogLine('POST', 'start'), 'localapi: [POST] /localapi/v0/start', '非安全方法记一行（:338-345）');
  assert.equal(localApiLogLine('GET', 'status'), null, '安全方法不记日志');
});

test('请求守卫：Referer/Origin/非法 Host 恒 403；loopback 需 BasicAuth；口令常时比较', () => {
  // 无口令模式：Host 须为 '' 或 local-tailscaled.sock。
  assert.equal(checkLocalApiGuards(LOCAL_API_HOST, '', '', '', '', false), null, '约定 Host 放行');
  assert.equal(checkLocalApiGuards('', '', '', '', '', false), null, '空 Host 放行（本地直连形态）');
  const referer = checkLocalApiGuards(LOCAL_API_HOST, 'https://evil.test/', '', '', '', false);
  assert.equal(referer?.status, 403, '任何 Referer → 403（:249-252）');
  assert.equal(referer?.body, 'invalid localapi request');
  const origin = checkLocalApiGuards(LOCAL_API_HOST, '', 'https://evil.test', '', '', false);
  assert.equal(origin?.status, 403, '任何 Origin → 403');
  const evilHost = checkLocalApiGuards('evil.example:8080', '', '', '', '', false);
  assert.equal(evilHost?.status, 403, '非约定 Host 且无口令 → 403');
  const loopbackNoPw = checkLocalApiGuards('127.0.0.1:49999', '', '', '', '', false);
  assert.equal(loopbackNoPw?.status, 403, 'loopback 仅在有 RequiredPassword 时可（"only allow localhost with basic auth"）');

  // 口令模式（沙盒 macOS 形态）。
  assert.equal(checkLocalApiGuards('localhost:49999', '', '', 'pw123', '', false)?.status, 401, '有口令但无 BasicAuth → 401 auth required');
  assert.equal(checkLocalApiGuards('localhost:49999', '', '', 'pw123', 'wrong', true)?.status, 403, '口令不符 → 403 bad password');
  assert.equal(checkLocalApiGuards('localhost:49999', '', '', 'pw123', 'pw123', true), null, '口令相符放行');
});

test('validHost 单元：local-tailscaled.sock 恒可；loopback 判定', () => {
  assert.equal(localApiValidHost('local-tailscaled.sock', ''), true, 'apitype.LocalAPIHost（客户端约定值）');
  assert.equal(localApiValidHost('localhost', ''), false, '无口令时 localhost 拒绝');
  assert.equal(localApiValidHost('localhost', 'pw'), false, '裸 "localhost" 无端口 ⇒ SplitHostPort 报错 → false（:299-301）');
  assert.equal(localApiValidHost('localhost:8080', 'pw'), true, '带端口的 localhost 在口令模式下可');
  assert.equal(localApiValidHost('127.0.0.1:49999', 'pw'), true, '带端口 loopback 也认');
  assert.equal(localApiValidHost('fe80::1', 'pw'), false, '非 loopback v6 拒绝（且无端口形态 SplitHostPort 会报错）');
  assert.equal(localApiValidHost('::1', 'pw'), false, '裸 "::1" 无端口 ⇒ SplitHostPort 报错 → false');
  assert.equal(localApiValidHost('[::1]:53', 'pw'), true, '方括号形态 v6 loopback 可');
  assert.equal(localApiValidHost('10.0.0.9:49999', 'pw'), false, '私网非 loopback 拒绝');
});

test('parseUrlQuery/queryBool：?peers= 缺省 true（FormValue 语义）', () => {
  const q = parseUrlQuery('/localapi/v0/status?peers=false&x=1');
  assert.equal(q['peers'], 'false');
  assert.equal(queryBool(q, 'peers', true), false);
  assert.equal(queryBool(parseUrlQuery('/localapi/v0/status'), 'peers', true), true, '缺参 → FormValue 缺省 true（:849）');
  assert.equal(parseUrlQuery('/localapi/v0/status')['peers'], undefined);
});

test('响应头：Tailscale-Version/Tailscale-Cap + 安全三件套 + application/json', () => {
  const headers = localApiBaseHeaders('1.102.3-test', 148);
  assert.equal(headers['tailscale-version'], '1.102.3-test');
  assert.equal(headers['tailscale-cap'], '148', 'capver 数值（:254-255）');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.match(String(headers['content-security-policy']), /default-src 'none'/);
  assert.equal(headers['content-type'], 'application/json');
});

test('MaskedPrefs：解码平铺 JSON；ApplyEdits 只拷贝 XxxSet==true 的字段', () => {
  // ipn-prefs.go:356-393：Prefs 匿名内嵌 → JSON 字段平铺 + 每字段一个 Set 位。
  const body: string = JSON.stringify({
    CorpDNS: false,
    CorpDNSSet: true,
    WantRunning: true,
    WantRunningSet: true,
    Hostname: 'ignored',
    HostnameSet: false,
    RouteAll: true,
    RouteAllSet: true,
  });
  const masked = decodeMaskedPrefs(body);
  assert.equal(masked.mask.CorpDNSSet, true);
  assert.equal(masked.prefs.CorpDNS, false);

  const base: ReturnType<typeof defaultIpnPrefs> = defaultIpnPrefs();
  assert.equal(base.CorpDNS, true, '缺省 CorpDNS=true（prefs.go:747 附近）');
  assert.equal(base.ControlURL, IPN_DEFAULT_CONTROL_URL, 'DefaultControlURL（prefs.go:42）');
  const merged: ReturnType<typeof defaultIpnPrefs> = applyMaskedPrefs(base, masked);
  assert.equal(merged.CorpDNS, false, '掩码位 true ⇒ 字段被拷贝（ApplyEdits，:417-437）');
  assert.equal(merged.WantRunning, true, '掩码位 true ⇒ WantRunning 被拷贝');
  assert.equal(merged.Hostname, '', '掩码位 false ⇒ 基础值保持（不拷贝）');
  assert.equal(merged.RouteAll, true);
  assert.equal(merged.ControlURL, base.ControlURL, '未出现的掩码位 ⇒ 不动');
  assert.equal(base.CorpDNS, true, '基础对象不被就地修改（ApplyEdits 语义、mock 以新对象表达）');
  assert.notEqual(merged, base);
  assert.deepEqual(cloneIpnPrefs(base).AdvertiseTags, [], 'clone 后数组独立');
});

test('ipn.Notify：SessionID 仅首条编码；行式 JSON 带 \n；编解码往返', () => {
  const first: IpnNotify = emptyIpnNotify('1.102.3');
  first.sessionId = 'sess-abc';
  first.state = IpnState.NoState;
  const line1: string = encodeIpnNotifyLine(first);
  assert.equal(line1.endsWith('\n'), true, 'json.Encoder.Encode 语义：每行一条带 \n（:920-933）');
  assert.match(line1, /"SessionID":"sess-abc"/, '首条携带 SessionID（backend.go:304-308）');
  assert.match(line1, /"State":0/, 'State=NoState(0) 也须编码（指针非 nil 即编码）');

  const later: IpnNotify = emptyIpnNotify('1.102.3');
  later.state = IpnState.Running;
  const line2: string = encodeIpnNotifyLine(later);
  assert.equal(line2.includes('SessionID'), false, '后续消息不得携带 SessionID——客户端必须自己存');
  assert.match(line2, /"State":6/);

  const decoded: IpnNotify = decodeIpnNotifyLine(line1);
  assert.equal(decoded.sessionId, 'sess-abc');
  assert.equal(decoded.state, IpnState.NoState);
  assert.equal(decoded.version, '1.102.3');
  assert.equal(decoded.peersChanged.length, 0, '空数组 omitzero ⇒ 不编码 → 解码为空');
});

test('ipn.Notify：PeersChanged/PeersRemoved/BrowseToURL omit-empty；流拼接', () => {
  const n: IpnNotify = emptyIpnNotify('1.102.3');
  n.peersRemoved = [7, 9];
  n.browseToUrl = 'https://login.example/abc';
  const line: string = encodeIpnNotifyLine(n);
  assert.match(line, /"PeersRemoved":\[7,9\]/);
  assert.match(line, /"BrowseToURL"/, '登录跳转字段（:423）');
  assert.equal(line.includes('PeersChanged'), false, '空 PeersChanged 不编码');

  const stream: Uint8Array = encodeNotifyStream([encodeIpnNotifyLine(n), encodeIpnNotifyLine(n)]);
  const text: string = Buffer.from(stream).toString('utf8');
  assert.equal(text.split('\n').length - 1, 2, '逐行帧流：两条 Notify 两行');
});

test('/status 响应：ipnstate.Status JSON 制表缩进；Peer 以公钥为键的对象', () => {
  const status: StatusJsonView = {
    Version: '1.102.3',
    BackendState: ipnStateToString(IpnState.Running),
    TUN: true,
    MagicDNSSuffix: 'tail-net.example.ts.net',
    TailscaleIPs: ['100.64.0.1'],
    Peer: {
      'nodekey:abcd': { DNSName: 'host.tail-net.example.ts.net.', Online: true },
    },
  };
  const text: string = Buffer.from(encodeStatusJson(status)).toString('utf8');
  assert.match(text, /\n\t"Version"/, 'SetIndent("", "\t") 制表缩进（:856-858）');
  assert.match(text, /"DNSName": "host\.tail-net\.example\.ts\.net\."/);
});

test('/dns-query 类型表（localapi.go:1783-1816）', () => {
  assert.equal(dnsMessageTypeForString('A'), 1);
  assert.equal(dnsMessageTypeForString('aaaa'), 28, '大小写不敏感（服务端 ToUpper）');
  assert.equal(dnsMessageTypeForString(' a '), 1, 'TrimSpace 语义');
  assert.equal(dnsMessageTypeForString('PTR'), 12);
  assert.equal(dnsMessageTypeForString('ALL'), 255);
  assert.equal(dnsMessageTypeForString('SOA'), 6);
  assert.equal(dnsMessageTypeForString('TYPE9824'), null, '未知类型 → 400 形态');
});

test('buildLocalApiRequest：Host 必须为 local-tailscaled.sock 且不带 Referer/Origin', () => {
  const req = buildLocalApiRequest('GET', '/localapi/v0/status?peers=false', new Uint8Array(0));
  assert.equal(req.headers['host'], LOCAL_API_HOST, '客户端约定值（apitype.go:13-14）');
  assert.equal(req.headers['referer'], undefined, '服务端 403 线：客户端不得带 Referer');
  assert.equal(req.headers['origin'], undefined);
  assert.equal(req.url, '/localapi/v0/status?peers=false');
});

test('状态机副作用 enterStateLocked（local.go:6724-6808）', () => {
  // NeedsLogin：封引擎更新 + fallthrough ⇒ Reconfig 三份空配置 + State 广播。
  const toNeedsLogin = localStateEffect(IpnState.Running, IpnState.NeedsLogin);
  assert.equal(toNeedsLogin.sendStateNotify, true);
  assert.equal(toNeedsLogin.blockEngineUpdates, true, 'NeedsLogin 封引擎更新（:6777-6780）');
  assert.equal(toNeedsLogin.reconfigEmptyDataPlane, true, 'fallthrough 到 Stopped/NoState 分支 ⇒ 拆数据面（:6781-6787）');
  assert.equal(toNeedsLogin.closePeerApi, true, '离开 Running ⇒ 关 PeerAPI（:6752-6758）');

  const toStopped = localStateEffect(IpnState.Running, IpnState.Stopped);
  assert.equal(toStopped.closePeerApi, true);
  assert.equal(toStopped.reconfigEmptyDataPlane, true);
  assert.equal(toStopped.blockEngineUpdates, false, '封引擎更新仅 NeedsLogin');

  const toStarting = localStateEffect(IpnState.NeedsLogin, IpnState.Starting);
  assert.equal(toStarting.authReconfig, true, 'Starting/NeedsMachineAuth ⇒ authReconfigLocked（:6792-6795）');
  assert.equal(toStarting.reconfigEmptyDataPlane, false, '非空转分支');

  const same = localStateEffect(IpnState.Running, IpnState.Running);
  assert.equal(same.sendStateNotify, false, 'old == new ⇒ 提前 return，不广播（:6769-6773）');
  assert.equal(same.closePeerApi, false);

  const toRunning = localStateEffect(IpnState.Starting, IpnState.Running);
  assert.equal(toRunning.closePeerApi, false, '进入 Running 不关 PeerAPI');
  assert.equal(toRunning.sendStateNotify, true);
});
