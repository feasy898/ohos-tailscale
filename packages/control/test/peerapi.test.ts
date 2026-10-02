/**
 * PeerAPI 最小面测试：端口推导（crc32 对照 node:zlib）、服务通告表、peerAPIBase
 * 地址族选择、请求校验、ExitDNS 资格。
 *
 * 语义锚点（v1.102.3 实拉，2026-10-03 本会话复核）：
 * - ipn/ipnlocal/peerapi.go:106-121（tryPort=(32<<10)|crc32(ip16 末3字节,首字节+=try)×5 次
 *   → ":0" → 假监听器 ip:1）、:258-297（Referer/Origin 恒拒 + Host 'peer'/ip:port）、
 *   :994-1020（peerAPIBase 地址族选择）、:1022-1066（假监听器端口 1 合法）；
 * - ipn/ipnlocal/local.go:5642-5663（peerAPIServicesLocked + PeerAPIDNS port=1）、
 *   :7648-7662（peerAPIPorts 读 Hostinfo.Services）、:7908-7924（peerCanProxyDNS Cap>=26）；
 * - tailcfg/tailcfg.go:784-786 @v1.102.3（PeerAPI4/6/DNS 词表）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import {
  PeerApiProto,
  PEERAPI_FAKE_LISTENER_PORT,
  PEERAPI_HOST_LITERAL,
  crc32Ieee,
  derivePeerApiPort,
  parsePeerApiProto,
  peerApiAddrIsValid,
  peerApiBase,
  peerApiPortsOf,
  peerApiServices,
  peerCanProxyDNS,
  replyToDnsQueries,
  validatePeerApiRequest,
  type PeerApiRequestView,
  type TailcfgServiceView,
} from '../src/index.ts';

/** CGNAT v4 "100.64.0.1" 的 16 字节形态（v4-mapped）。 */
const ip16Of = (tail: number[]): Uint8Array => {
  const out: Uint8Array = new Uint8Array(16);
  out[10] = 0xff;
  out[11] = 0xff;
  for (let i: number = 0; i < tail.length; i += 1) {
    out[13 + i] = tail[i];
  }
  return out;
};

test('crc32Ieee：与 node:zlib crc32 对照（IEEE 反射多项式 0xEDB88320）', () => {
  const samples: Uint8Array[] = [
    new Uint8Array([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]), // "123456789"
    new Uint8Array([0x64, 0x00, 0x01]),
    new Uint8Array(0),
    new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]),
  ];
  for (const s of samples) {
    assert.equal(crc32Ieee(s), crc32(s), 'crc32Ieee 必须与 zlib IEEE 口径逐字节一致');
  }
});

test('derivePeerApiPort：确定性公式 =(32<<10)|crc32(ip16 末3字节) 且落在 [32768,65535]', () => {
  // peerapi.go:107-115：hashData = a16[len-3:]，hashData[0] += try，tryPort=(32<<10)|crc32。
  const ip16: Uint8Array = ip16Of([0x0a, 0x0b, 0x0c]);
  const port0: number = derivePeerApiPort(ip16, 0);
  const expected: number = (32 << 10) | (crc32(new Uint8Array([0x0a, 0x0b, 0x0c])) & 0xffff);
  assert.equal(port0, expected, '端口必须恰为 (32<<10)|crc32(末3字节)');
  assert.ok(port0 >= 32768 && port0 <= 65535, '公式天然落在 [32768,65535]（同机 v4/v6 通常同端口）');

  // try 参与 hashData[0]（首字节 += try）。
  const port1: number = derivePeerApiPort(ip16, 1);
  const expectedTry1: number = (32 << 10) | (crc32(new Uint8Array([0x0b, 0x0b, 0x0c])) & 0xffff);
  assert.equal(port1, expectedTry1, 'try 只加在末 3 字节的首字节上（peerapi.go:111）');

  // v4 与 v4-mapped v6 的末 3 字节相同 → 端口相同（上游注释 "same port number on both
  // address families"，peerapi.go:102-105）。
  const v6Form: Uint8Array = new Uint8Array(16);
  v6Form[13] = 0x0a;
  v6Form[14] = 0x0b;
  v6Form[15] = 0x0c;
  assert.equal(derivePeerApiPort(v6Form, 0), port0, '同尾 3 字节 ⇒ 同端口（best-effort 确定性）');

  // 长度校验。
  assert.throws(() => derivePeerApiPort(new Uint8Array(4), 0), /16 bytes/, '非 16 字节输入必须拒绝');
});

test('peerApiServices：每 listener 一条 peerapi4/6 + 追加 PeerAPIDNS port=1（能力标记）', () => {
  const svcs: TailcfgServiceView[] = peerApiServices([
    { ip: '100.64.0.1', port: 40001 },
    { ip: 'fd7a:115c:a1e0::1', port: 40001 },
  ]);
  assert.equal(svcs.length, 3);
  assert.equal(svcs[0].proto, PeerApiProto.PeerAPI4, 'v4 地址族 → peerapi4（local.go:5646-5650）');
  assert.equal(svcs[0].port, 40001);
  assert.equal(svcs[1].proto, PeerApiProto.PeerAPI6, 'v6 地址族 → peerapi6');
  assert.equal(svcs[2].proto, PeerApiProto.PeerAPIDNS);
  assert.equal(svcs[2].port, 1, 'PeerAPIDNS port=1 仅作能力版本标记（local.go:5659-5662）');
  assert.equal(parsePeerApiProto('peerapi4'), 'peerapi4');
  assert.equal(parsePeerApiProto('tcp'), null, 'tcp/udp 是普通 ServiceProto，不属 PeerAPI 元服务');
});

test('peerApiPortsOf + peerApiBase：按 self 地址族选 peerapi4/6，皆无则空串', () => {
  const svcs: TailcfgServiceView[] = [
    { proto: PeerApiProto.PeerAPI4, port: 40001 },
    { proto: PeerApiProto.PeerAPI6, port: 40002 },
  ];
  const ports = peerApiPortsOf(svcs);
  assert.equal(ports.p4, 40001);
  assert.equal(ports.p6, 40002);

  // self 有 v4 且 p4≠0 → 用对端 v4（peerapi.go:1008-1010）。
  assert.equal(peerApiBase(true, true, '100.64.0.2', 'fd7a:115c:a1e0::2', ports), 'http://100.64.0.2:40001');
  // self 仅 v6 → 对端 v6（v6 URL 方括号形态对齐 netip.AddrPort.String()）。
  assert.equal(peerApiBase(false, true, '100.64.0.2', 'fd7a:115c:a1e0::2', ports), 'http://[fd7a:115c:a1e0::2]:40002');
  // self 仅 v4 而对端 p4=0：have4&&p4≠0 与 have6&&p6≠0 两分支都不满足 → 空串。
  // （上游无「跨族回落」：self 没 v6 就不能用对端的 peerapi6，peerapi.go:1008-1019。）
  assert.equal(peerApiBase(true, false, '100.64.0.2', 'fd7a:115c:a1e0::2', { p4: 0, p6: 40002 }), '');
  // 两族都不满足 → 空串（对端 PeerAPI 不可达，peerapi.go:1017-1019）。
  assert.equal(peerApiBase(true, true, '100.64.0.2', 'fd7a:115c:a1e0::2', { p4: 0, p6: 0 }), '');
});

test('validatePeerApiRequest：Referer/Origin 恒拒；Host 为 peer 或自身 ip:port', () => {
  const isAddrValid = (addr: { is4: boolean; bytes: Uint8Array }): boolean => {
    return addr.is4 && addr.bytes[0] === 100 && addr.bytes[1] === 64;
  };
  const base: PeerApiRequestView = { method: 'GET', host: PEERAPI_HOST_LITERAL, referer: '', origin: '', path: '/' };
  assert.equal(validatePeerApiRequest(base, isAddrValid), null, "Host='peer' 字面量恒合法（peerapi.go:276-278）");

  const withReferer: PeerApiRequestView = { method: 'GET', host: 'peer', referer: 'https://evil.test/', origin: '', path: '/' };
  assert.equal(validatePeerApiRequest(withReferer, isAddrValid), 'unexpected Referer', '任何 Referer 拒绝（防 CSRF，:289-292）');

  const withOrigin: PeerApiRequestView = { method: 'GET', host: 'peer', referer: '', origin: 'https://evil.test', path: '/' };
  assert.equal(validatePeerApiRequest(withOrigin, isAddrValid), 'unexpected Origin', '任何 Origin 拒绝');

  const selfHost: PeerApiRequestView = { method: 'GET', host: '100.64.0.1:40001', referer: '', origin: '', path: '/' };
  assert.equal(validatePeerApiRequest(selfHost, isAddrValid), null, 'Host=自身 ip:port 合法');

  const foreignHost: PeerApiRequestView = { method: 'GET', host: '10.1.2.3:40001', referer: '', origin: '', path: '/' };
  assert.match(String(validatePeerApiRequest(foreignHost, isAddrValid)), /not found in self addresses/, '非自身地址拒绝');

  const badHost: PeerApiRequestView = { method: 'GET', host: 'not-an-addr', referer: '', origin: '', path: '/' };
  assert.match(String(validatePeerApiRequest(badHost, isAddrValid)), /invalid Host/, 'Host 解析失败拒绝');
});

test('peerCanProxyDNS：Cap>=26 恒真；否则 Services 含 PeerAPIDNS port>=1 兜底', () => {
  // local.go:7908-7924：>=26 走新路径（实际 25 起支持，26 起保证）。
  assert.equal(peerCanProxyDNS(26, []), true);
  assert.equal(peerCanProxyDNS(148, []), true);
  assert.equal(peerCanProxyDNS(25, [{ proto: PeerApiProto.PeerAPIDNS, port: 1 }]), true, '老控制面经 Services 词表兜底');
  assert.equal(peerCanProxyDNS(25, []), false, '两路都不满足 ⇒ 该 peer 不能代理 ExitDNS');
  assert.equal(peerCanProxyDNS(25, [{ proto: PeerApiProto.PeerAPIDNS, port: 0 }]), false, 'port=0 不算通告');
});

test('replyToDnsQueries：isSelf 恒答；否则须本机 exit/app-connector 且 PacketFilter 放行 :53', () => {
  // peerapi.go:683-752 授权链真值表。
  assert.equal(replyToDnsQueries(true, false, false), true, 'isSelf 恒答');
  assert.equal(replyToDnsQueries(false, true, true), true, 'exit node + filter.Accept(0.0.0.0:53) ⇒ 答');
  assert.equal(replyToDnsQueries(false, true, false), false, 'filter 不放行 ⇒ 不答（PacketFilter 是独立第二道门）');
  assert.equal(replyToDnsQueries(false, false, true), false, '非 exit node/app connector ⇒ 不答');
});

test('peerApiAddrIsValid：MasqAddr 优先语义（peerapi.go:262-273）', () => {
  const parse = (s: string): { is4: boolean; bytes: Uint8Array } => {
    const p: number[] = s.split('.').map((x: string): number => Number(x));
    return { is4: true, bytes: new Uint8Array(p) };
  };
  const selfPrefixes: string[] = ['100.64.0.1/32', 'fd7a:115c:a1e0::1/128'];
  // 无 masq：self 地址包含即合法。
  assert.equal(peerApiAddrIsValid(parse('100.64.0.1'), '', '', selfPrefixes), true);
  assert.equal(peerApiAddrIsValid(parse('100.64.0.9'), '', '', selfPrefixes), false);
  // 有 masq：只认 masq 地址（4via6/伪装场景，isAddressValid 的 masq 分支）。
  assert.equal(peerApiAddrIsValid(parse('100.64.0.1'), '10.9.9.9', '', selfPrefixes), false, '有 masq 后真实地址不再直接合法');
  assert.equal(peerApiAddrIsValid(parse('10.9.9.9'), '10.9.9.9', '', selfPrefixes), true);
});

test('假监听器常量：通告端口 1 合法（peerapi.go:1022-1066）', () => {
  assert.equal(PEERAPI_FAKE_LISTENER_PORT, 1);
  assert.equal(PEERAPI_HOST_LITERAL, 'peer');
});
