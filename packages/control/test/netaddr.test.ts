/**
 * netaddr（netip 子集）测试：前缀/地址解析、掩码归一化、Tailscale 范围、
 * exit 路由判定、排序序、AddrPort 解析与 DERP 假地址识别。
 *
 * 语义锚点：net/routemanager/routemanager.go:655-687（normalizePrefix）、
 * net/tsaddr/tsaddr.go:31-37, 70-98, 257-278（v1.102.3 实拉核对 2026-10-02）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addrToString,
  isDerpMagicAddrPort,
  isExitRoute,
  isTailscaleIp,
  maskedPrefix,
  parseIp,
  parseIpPort,
  parsePrefix,
  prefixContainsAddr,
  prefixHasHostBits,
  prefixIsSingleIp,
  prefixToString,
  sortPrefixes,
  tryParseIpPort,
  unmapPrefix,
  type IpPrefix,
} from '../src/index.ts';

test('parsePrefix/规范化："100.100.0.4/32" 与 v6 ULA 前缀往返', () => {
  const p4: IpPrefix = parsePrefix('100.100.0.4/32');
  assert.equal(p4.addr.is4, true, '点分十进制应解析为 IPv4');
  assert.equal(p4.bits, 32);
  assert.equal(prefixToString(p4), '100.100.0.4/32', 'v4 规范化应与输入一致');

  const p6: IpPrefix = parsePrefix('fd7a:115c:a1e0::/48');
  assert.equal(p6.addr.is4, false, '冒号形式应解析为 IPv6');
  assert.equal(p6.bits, 48);
  assert.equal(prefixToString(p6), 'fd7a:115c:a1e0::/48', 'v6 规范化输出（最长零串压缩）');

  const v6Host: IpPrefix = parsePrefix('fd7a:115c:a1e0::1234/128');
  assert.equal(prefixToString(v6Host), 'fd7a:115c:a1e0::1234/128');
});

test('parsePrefix 畸形输入在解析层抛错（bits 越界/缺 bits/坏 IP）', () => {
  // C1 §7-6：bits 越界（v4 >32）必须在解析层抛错。
  assert.throws(() => parsePrefix('100.100.0.4/33'), /out of range/, 'v4 /33 越界应抛错');
  assert.throws(() => parsePrefix('fd7a::1/129'), /out of range/, 'v6 /129 越界应抛错');
  assert.throws(() => parsePrefix('100.100.0.4'), /missing/, '缺 "/bits" 应抛错');
  assert.throws(() => parsePrefix('300.1.2.3/24'), /invalid/, '非法 v4 应抛错');
  assert.throws(() => parsePrefix('fd7a::zz/48'), /invalid/, '非法 v6 组应抛错');
});

test('maskedPrefix/prefixHasHostBits：host bits 置位的非法前缀可检出（跳过而非替换）', () => {
  const bad: IpPrefix = parsePrefix('100.100.0.4/24');
  assert.equal(prefixHasHostBits(bad), true, '100.100.0.4/24 host bits 置位');
  const masked: IpPrefix = maskedPrefix(bad);
  assert.equal(prefixToString(masked), '100.100.0.0/24', 'Masked 应清掉 host bits');
  const good: IpPrefix = parsePrefix('10.1.2.0/24');
  assert.equal(prefixHasHostBits(good), false, '已掩码前缀无 host bits');
  assert.equal(prefixIsSingleIp(parsePrefix('100.64.5.1/32')), true, '/32 是单 IP 前缀');
  assert.equal(prefixIsSingleIp(parsePrefix('10.0.0.0/8')), false, '/8 不是单 IP 前缀');
  // 非整字节边界（bits%8≠0）：掩码不得误伤部分字节内的合法前缀位。
  // 回归锚点：routemanager.go:677-681 的 pfx != Masked() 检查曾被错误清零部分字节。
  const cgnat: IpPrefix = parsePrefix('100.64.0.0/10');
  assert.equal(prefixHasHostBits(cgnat), false, '100.64.0.0/10 已是规范掩码（/10 部分字节 0x40）');
  assert.equal(prefixToString(maskedPrefix(cgnat)), '100.64.0.0/10', '/10 掩码后不变');
  const badHalf: IpPrefix = parsePrefix('100.64.0.0/9');
  assert.equal(prefixHasHostBits(badHalf), true, '100.64.0.0/9 host bits 置位（部分字节 0x40 & 0x80=0）');
});

test('isExitRoute：只有精确 0.0.0.0/0 与 ::/0；0.0.0.0/1 不是 exit 路由', () => {
  // tsaddr.go:270-273：IsExitRoute = p == allIPv4 || p == allIPv6。
  assert.equal(isExitRoute(parsePrefix('0.0.0.0/0')), true, '0.0.0.0/0 是 exit 路由');
  assert.equal(isExitRoute(parsePrefix('::/0')), true, '::/0 是 exit 路由');
  assert.equal(isExitRoute(parsePrefix('0.0.0.0/1')), false, '0.0.0.0/1 是子网路由，不是 exit');
  assert.equal(isExitRoute(parsePrefix('::/1')), false, '::/1 同理');
  assert.equal(isExitRoute(parsePrefix('10.0.0.0/8')), false);
});

test('isTailscaleIP：CGNAT/ULA 内为真，刨除 ChromeOS 100.115.92.0/23', () => {
  assert.equal(isTailscaleIp(parseIp('100.64.0.1')), true, 'CGNAT 起始');
  assert.equal(isTailscaleIp(parseIp('100.100.0.4')), true, '典型 tailscale v4');
  assert.equal(isTailscaleIp(parseIp('100.115.92.5')), false, 'ChromeOS VM 段须刨除（tsaddr.go:83-86）');
  assert.equal(isTailscaleIp(parseIp('100.115.93.255')), false, 'ChromeOS 段尾同样刨除');
  assert.equal(isTailscaleIp(parseIp('100.115.94.1')), true, 'ChromeOS /23 之外恢复 CGNAT 判定');
  assert.equal(isTailscaleIp(parseIp('100.127.255.255')), true, '100.64/10 末地址（100.64–100.127）');
  assert.equal(isTailscaleIp(parseIp('100.128.0.1')), false, '100.64/10 之外');
  assert.equal(isTailscaleIp(parseIp('100.63.255.255')), false, '/10 之下界外');
  assert.equal(isTailscaleIp(parseIp('fd7a:115c:a1e0::1')), true, 'Tailscale ULA');
  assert.equal(isTailscaleIp(parseIp('fd7a:115c:a1e0:b1a::1')), true, 'ULA 内 via 子段仍属 ULA /48');
  assert.equal(isTailscaleIp(parseIp('2001:db8::1')), false, '非 ULA');
  assert.equal(isTailscaleIp(parseIp('192.168.1.1')), false, '私网不是 tailscale IP');
});

test('sortPrefixes：ComparePrefix 序——v4 先于 v6，再字节序，再 bits', () => {
  const list: IpPrefix[] = [
    parsePrefix('fd7a:115c:a1e0::/48'),
    parsePrefix('100.100.0.1/32'),
    parsePrefix('0.0.0.0/0'),
    parsePrefix('100.64.0.0/10'),
    parsePrefix('::/0'),
  ];
  sortPrefixes(list);
  const out: string[] = [];
  for (const p of list) {
    out.push(prefixToString(p));
  }
  assert.deepEqual(
    out,
    ['0.0.0.0/0', '100.64.0.0/10', '100.100.0.1/32', '::/0', 'fd7a:115c:a1e0::/48'],
    '排序应为 v4 升序在前、v6 在后（netipx.ComparePrefix 族序）',
  );
});

test('unmapPrefix：4-in-6 解包并以新族最大值钳位（/128、/64 → /32）', () => {
  const mapped: IpPrefix = unmapPrefix(parsePrefix('::ffff:100.100.0.4/128'));
  assert.equal(prefixToString(mapped), '100.100.0.4/32', '::ffff:x/128 解包为 x/32');
  const short: IpPrefix = unmapPrefix(parsePrefix('::ffff:10.0.0.0/64'));
  assert.equal(prefixToString(short), '10.0.0.0/32', '越界 bits 钳到 /32（安全口径，见实现注）');
  const plain: IpPrefix = unmapPrefix(parsePrefix('fd7a::/48'));
  assert.equal(prefixToString(plain), 'fd7a::/48', '非映射前缀原样返回');
});

test('parseIpPort：v4 裸形式与 v6 方括号形式；非法端口拒绝', () => {
  const v4 = parseIpPort('203.0.113.10:41641');
  assert.equal(addrToString(v4.addr), '203.0.113.10');
  assert.equal(v4.port, 41641);
  const v6 = parseIpPort('[fd7a:115c:a1e0::1]:41641');
  assert.equal(addrToString(v6.addr), 'fd7a:115c:a1e0::1');
  assert.equal(v6.port, 41641);
  assert.equal(tryParseIpPort('nope'), null, '缺端口返回 null 不抛');
  assert.throws(() => parseIpPort('1.2.3.4:99999'), /invalid port/, '端口越界抛错');
});

test('isDerpMagicAddrPort：识别 127.3.3.40:N 假地址（DERP home 编码）', () => {
  // endpoint.go:1540：HomeDERP 编码为 127.3.3.40:regionID。
  assert.equal(isDerpMagicAddrPort('127.3.3.40:17'), true, 'region 17 的 home 假地址');
  assert.equal(isDerpMagicAddrPort('127.3.3.40:999'), true);
  assert.equal(isDerpMagicAddrPort('127.3.3.41:17'), false, 'IP 不符不是假地址');
  assert.equal(isDerpMagicAddrPort('203.0.113.10:41641'), false, '真实 UDP 地址不是假地址');
  assert.equal(
    prefixContainsAddr(parsePrefix('100.64.0.0/10'), parseIp('100.100.100.100')),
    true,
    'MagicDNS 服务 IP 100.100.100.100 在 CGNAT 内（附带覆盖 prefixContainsAddr）',
  );
});
