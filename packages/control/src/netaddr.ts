/**
 * netip/netipx 纯 TS 子集（netmap→WG 推导的地址/前缀算术）。
 *
 * 只实现 C1 推导面用到的语义，逐条对齐上游（v1.102.3 tag 实拉核对，2026-10-02）：
 * - IpAddr/IpPrefix 的解析与规范化字符串输出（netip.ParsePrefix 接受 "ip/bits"，
 *   bits 越界在解析层抛错 —— C1 笔记 §7-6）；
 * - Masked()/IsSingleIP()/Contains()（net/routemanager/routemanager.go:655-661 的
 *   normalizePrefix 语义：host bits 置位 ⇒ 原样 != Masked ⇒ 跳过该前缀，不是替换）；
 * - 4-in-6 Unmap（routemanager.go:657, 684 的 pfx.Addr().Unmap()）；
 * - ComparePrefix 排序序（tsaddr.SortPrefixes = slices.SortFunc(netipx.ComparePrefix)，
 *   tsaddr.go:276-278；族序 v4 < v6，再按字节，再按 bits）；
 * - IsExitRoute = 精确 "0.0.0.0/0" 或 "::/0"（tsaddr.go:257-258, 270-273）；
 * - IsTailscaleIP = CGNAT 100.64.0.0/10 且非 ChromeOS 100.115.92.0/23（v4）∪
 *   fd7a:115c:a1e0::/48（v6）（tsaddr.go:35, 72-98 实读）；
 * - AddrPort 解析（Endpoints 的 netip.AddrPort.String() 线格式："ip:port"，v6 带方括号）；
 * - IsLoopback/IsLinkLocalUnicast/IsPrivate（betterAddr 打分用，endpoint.go:1903-1917）。
 *
 * ArkTS：纯字段 interface（A2）+ 模块级函数；throw 只抛 Error 子类（A25/R7）。
 * 解析失败抛 Error（对齐 netip.Parse* 的 error 语义），由解码层包装为 ControlError。
 */

/** IP 地址（v4 = 4 字节、v6 = 16 字节，大端）。 */
export interface IpAddr {
  is4: boolean;
  bytes: Uint8Array;
}

/** IP 前缀（addr + bits；不保证已掩码 —— 用 prefixHasHostBits 检查）。 */
export interface IpPrefix {
  addr: IpAddr;
  bits: number;
}

/** IP:port（AddrPort 的解析视图）。 */
export interface IpPort {
  addr: IpAddr;
  port: number;
}

const ZERO_V4: string = '0.0.0.0';
const ZERO_V6: string = '::';

/** 两地址是否相等（族 + 字节）。 */
export function addrEqual(a: IpAddr, b: IpAddr): boolean {
  if (a.is4 !== b.is4 || a.bytes.length !== b.bytes.length) {
    return false;
  }
  for (let i: number = 0; i < a.bytes.length; i += 1) {
    if (a.bytes[i] !== b.bytes[i]) {
      return false;
    }
  }
  return true;
}

/** 解析 IPv4 点分十进制；非法抛 Error（拒绝前导零，对齐 netip.ParseAddr）。 */
export function parseIpv4(s: string): IpAddr {
  const parts: string[] = s.split('.');
  if (parts.length !== 4) {
    throw new Error('netaddr: invalid IPv4 "' + s + '"');
  }
  const out: Uint8Array = new Uint8Array(4);
  for (let i: number = 0; i < 4; i += 1) {
    const part: string = parts[i];
    if (part.length === 0 || part.length > 3) {
      throw new Error('netaddr: invalid IPv4 octet in "' + s + '"');
    }
    if (part.length > 1 && part.charAt(0) === '0') {
      throw new Error('netaddr: leading zero octet in "' + s + '"');
    }
    const v: number = Number(part);
    if (!Number.isInteger(v) || v < 0 || v > 255) {
      throw new Error('netaddr: invalid IPv4 octet "' + part + '" in "' + s + '"');
    }
    out[i] = v;
  }
  const addr: IpAddr = { is4: true, bytes: out };
  return addr;
}

function hexNibble(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code - 0x30;
  }
  if (code >= 0x61 && code <= 0x66) {
    return code - 0x61 + 10;
  }
  if (code >= 0x41 && code <= 0x46) {
    return code - 0x41 + 10;
  }
  return -1;
}

/** 解析一段 1-4 位 hex 组；非法抛 Error。 */
function parseIpv6Group(s: string): number {
  if (s.length === 0 || s.length > 4) {
    throw new Error('netaddr: invalid IPv6 group "' + s + '"');
  }
  let v: number = 0;
  for (let i: number = 0; i < s.length; i += 1) {
    const n: number = hexNibble(s.charCodeAt(i));
    if (n < 0) {
      throw new Error('netaddr: invalid IPv6 group "' + s + '"');
    }
    v = v * 16 + n;
  }
  return v;
}

/** 解析 IPv6（含 "::" 压缩与尾部内嵌 IPv4）；非法抛 Error。 */
export function parseIpv6(s: string): IpAddr {
  if (s.indexOf('%') >= 0) {
    throw new Error('netaddr: IPv6 zone not supported "' + s + '"');
  }
  const out: Uint8Array = new Uint8Array(16);
  const doubleColon: number = s.indexOf('::');
  let head: string = s;
  let tail: string = '';
  let hasCompress: boolean = false;
  if (doubleColon >= 0) {
    if (s.indexOf('::', doubleColon + 1) >= 0) {
      throw new Error('netaddr: multiple "::" in "' + s + '"');
    }
    hasCompress = true;
    head = s.slice(0, doubleColon);
    tail = s.slice(doubleColon + 2);
  }
  const headGroups: number[] = [];
  const tailGroups: number[] = [];
  let headV4Bytes: Uint8Array | null = null;
  let tailV4Bytes: Uint8Array | null = null;
  if (head.length > 0) {
    const headParts: string[] = head.split(':');
    for (let i: number = 0; i < headParts.length; i += 1) {
      if (headParts[i].indexOf('.') >= 0) {
        if (i !== headParts.length - 1) {
          throw new Error('netaddr: embedded IPv4 must be last in "' + s + '"');
        }
        headV4Bytes = parseIpv4(headParts[i]).bytes;
      } else {
        headGroups.push(parseIpv6Group(headParts[i]));
      }
    }
  }
  if (tail.length > 0) {
    const tailParts: string[] = tail.split(':');
    for (let i: number = 0; i < tailParts.length; i += 1) {
      if (tailParts[i].indexOf('.') >= 0) {
        if (i !== tailParts.length - 1) {
          throw new Error('netaddr: embedded IPv4 must be last in "' + s + '"');
        }
        tailV4Bytes = parseIpv4(tailParts[i]).bytes;
      } else {
        tailGroups.push(parseIpv6Group(tailParts[i]));
      }
    }
  }
  let total: number = headGroups.length + tailGroups.length;
  if (headV4Bytes !== null) {
    total += 2;
  }
  if (tailV4Bytes !== null) {
    total += 2;
  }
  if (hasCompress) {
    if (total > 7) {
      throw new Error('netaddr: too many groups for "::" in "' + s + '"');
    }
  } else if (total !== 8) {
    throw new Error('netaddr: IPv6 requires 8 groups in "' + s + '"');
  }
  let pos: number = 0;
  for (const g of headGroups) {
    out[pos] = g >> 8;
    out[pos + 1] = g & 0xff;
    pos += 2;
  }
  if (headV4Bytes !== null) {
    out.set(headV4Bytes, pos);
    pos += 4;
  }
  if (hasCompress) {
    const zeros: number = 16 - pos - (tailGroups.length * 2 + (tailV4Bytes !== null ? 4 : 0));
    pos += zeros;
  }
  for (const g of tailGroups) {
    out[pos] = g >> 8;
    out[pos + 1] = g & 0xff;
    pos += 2;
  }
  if (tailV4Bytes !== null) {
    out.set(tailV4Bytes, pos);
    pos += 4;
  }
  if (pos !== 16) {
    throw new Error('netaddr: internal IPv6 fill error for "' + s + '"');
  }
  const addr: IpAddr = { is4: false, bytes: out };
  return addr;
}

/** 解析 IP 地址（含 '.' 走 v4，含 ':' 走 v6）；非法抛 Error。 */
export function parseIp(s: string): IpAddr {
  if (s.length === 0) {
    throw new Error('netaddr: empty IP string');
  }
  if (s.indexOf('.') >= 0 && s.indexOf(':') < 0) {
    return parseIpv4(s);
  }
  return parseIpv6(s);
}

/** 解析失败返回 null（不抛）。 */
export function tryParseIp(s: string): IpAddr | null {
  let out: IpAddr | null = null;
  try {
    out = parseIp(s);
  } catch (e) {
    out = null;
  }
  return out;
}

/** 规范化小写字符串输出（v4 点分；v6 RFC5952 压缩：最长 ≥2 组零串用 "::"）。 */
export function addrToString(addr: IpAddr): string {
  if (addr.is4) {
    return (
      String(addr.bytes[0]) + '.' + String(addr.bytes[1]) + '.' +
      String(addr.bytes[2]) + '.' + String(addr.bytes[3])
    );
  }
  const groups: number[] = [];
  for (let i: number = 0; i < 8; i += 1) {
    groups.push((addr.bytes[i * 2] << 8) | addr.bytes[i * 2 + 1]);
  }
  // 找最长（平取最左）的零组串，长度 ≥2 才压缩。
  let bestStart: number = -1;
  let bestLen: number = 0;
  let curStart: number = -1;
  let curLen: number = 0;
  for (let i: number = 0; i < 8; i += 1) {
    if (groups[i] === 0) {
      if (curStart < 0) {
        curStart = i;
        curLen = 1;
      } else {
        curLen += 1;
      }
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  let out: string = '';
  if (bestLen < 2) {
    for (let i: number = 0; i < 8; i += 1) {
      if (i > 0) {
        out += ':';
      }
      out += groups[i].toString(16);
    }
    return out;
  }
  // RFC5952：head "::" tail；head/tail 各自 join('')，空段特判。
  let head: string = '';
  for (let i: number = 0; i < bestStart; i += 1) {
    head += groups[i].toString(16);
    if (i < bestStart - 1) {
      head += ':';
    }
  }
  let tail: string = '';
  for (let i: number = bestStart + bestLen; i < 8; i += 1) {
    tail += groups[i].toString(16);
    if (i < 7) {
      tail += ':';
    }
  }
  if (head === '' && tail === '') {
    return '::';
  }
  if (tail === '') {
    return head + '::';
  }
  if (head === '') {
    return '::' + tail;
  }
  return head + '::' + tail;
}

/** 前缀最大 bits（v4=32 / v6=128）。 */
export function prefixMaxBits(p: IpPrefix): number {
  return p.addr.is4 ? 32 : 128;
}

/** 解析 "ip/bits"；bits 非法/越界抛 Error（解析层，C1 §7-6）。 */
export function parsePrefix(s: string): IpPrefix {
  const slash: number = s.lastIndexOf('/');
  if (slash < 0) {
    throw new Error('netaddr: prefix missing "/bits" in "' + s + '"');
  }
  const ipPart: string = s.slice(0, slash);
  const bitsPart: string = s.slice(slash + 1);
  if (bitsPart.length === 0) {
    throw new Error('netaddr: prefix missing bits in "' + s + '"');
  }
  const bits: number = Number(bitsPart);
  if (!Number.isInteger(bits) || bits < 0) {
    throw new Error('netaddr: invalid prefix bits "' + bitsPart + '" in "' + s + '"');
  }
  const addr: IpAddr = parseIp(ipPart);
  const max: number = addr.is4 ? 32 : 128;
  if (bits > max) {
    throw new Error(
      'netaddr: prefix bits ' + String(bits) + ' out of range for /' +
      String(max) + ' in "' + s + '"',
    );
  }
  const out: IpPrefix = { addr: addr, bits: bits };
  return out;
}

/** 规范化字符串 "ip/bits"。 */
export function prefixToString(p: IpPrefix): string {
  return addrToString(p.addr) + '/' + String(p.bits);
}

/** Masked()：地址按 bits 掩码后的新前缀。 */
export function maskedPrefix(p: IpPrefix): IpPrefix {
  const bytes: Uint8Array = p.addr.bytes.slice();
  const fullBytes: number = Math.floor(p.bits / 8);
  const rem: number = p.bits % 8;
  // 含部分字节的位（rem≠0）必须保留并掩码，只清其后的整字节。
  const clearFrom: number = rem === 0 ? fullBytes : fullBytes + 1;
  for (let i: number = clearFrom; i < bytes.length; i += 1) {
    bytes[i] = 0;
  }
  if (rem !== 0 && fullBytes < bytes.length) {
    bytes[fullBytes] = bytes[fullBytes] & ((0xff << (8 - rem)) & 0xff);
  }
  const out: IpPrefix = { addr: { is4: p.addr.is4, bytes: bytes }, bits: p.bits };
  return out;
}

/** host bits 是否置位（原样 != Masked ⇒ true，routemanager contribs 的跳过条件）。 */
export function prefixHasHostBits(p: IpPrefix): boolean {
  const m: IpPrefix = maskedPrefix(p);
  return !prefixEqual(p, m);
}

/** 是否单 IP 前缀（bits == 最大值；peerViewOf isSelf 分支一的条件之一）。 */
export function prefixIsSingleIp(p: IpPrefix): boolean {
  return p.bits === prefixMaxBits(p);
}

/** 前缀相等（族 + 字节 + bits）。 */
export function prefixEqual(a: IpPrefix, b: IpPrefix): boolean {
  return a.bits === b.bits && addrEqual(a.addr, b.addr);
}

/** addr 是否在前缀内。 */
export function prefixContainsAddr(p: IpPrefix, addr: IpAddr): boolean {
  if (p.addr.is4 !== addr.is4) {
    return false;
  }
  const a: Uint8Array = p.addr.bytes;
  const b: Uint8Array = addr.bytes;
  const fullBytes: number = Math.floor(p.bits / 8);
  for (let i: number = 0; i < fullBytes; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  const rem: number = p.bits % 8;
  if (rem !== 0) {
    const mask: number = (0xff << (8 - rem)) & 0xff;
    if ((a[fullBytes] & mask) !== (b[fullBytes] & mask)) {
      return false;
    }
  }
  return true;
}

/** 前缀包含前缀（b 的 bits ≥ p 且前 p.bits 位一致）。 */
export function prefixContainsPrefix(p: IpPrefix, b: IpPrefix): boolean {
  return b.bits >= p.bits && prefixContainsAddr(p, b.addr);
}

/** 4-in-6（::ffff:a.b.c.d）解包为 v4；非映射原样返回。 */
export function unmapAddr(addr: IpAddr): IpAddr {
  if (addr.is4) {
    return addr;
  }
  for (let i: number = 0; i < 10; i += 1) {
    if (addr.bytes[i] !== 0) {
      return addr;
    }
  }
  if (addr.bytes[10] !== 0xff || addr.bytes[11] !== 0xff) {
    return addr;
  }
  const out: IpAddr = { is4: true, bytes: addr.bytes.slice(12) };
  return out;
}

/**
 * Unmap + 前缀版（routemanager.go:656-658 normalizePrefix：
 * netip.PrefixFrom(p.Addr().Unmap(), p.Bits()).Masked()）。
 * 4-in-6 前缀的 bits 以新族最大值钳位（/64、/128 → /32）。说明：上游对越界 bits
 * 的病态输入走 netip 零前缀路径（真实控制面不下发 4-in-6 前缀），本实现取
 * 确定性安全钳位，测试按此口径钉死。
 */
export function unmapPrefix(p: IpPrefix): IpPrefix {
  const unmapped: IpAddr = unmapAddr(p.addr);
  if (unmapped.is4 === p.addr.is4) {
    return p;
  }
  let bits: number = p.bits;
  if (bits > 32) {
    bits = 32;
  }
  const out: IpPrefix = { addr: unmapped, bits: bits };
  return out;
}

/** ComparePrefix 序：v4 < v6，再字节序，再 bits（netipx.ComparePrefix）。 */
export function comparePrefix(a: IpPrefix, b: IpPrefix): number {
  if (a.addr.is4 !== b.addr.is4) {
    return a.addr.is4 ? -1 : 1;
  }
  const ab: Uint8Array = a.addr.bytes;
  const bb: Uint8Array = b.addr.bytes;
  for (let i: number = 0; i < ab.length; i += 1) {
    if (ab[i] !== bb[i]) {
      return ab[i] < bb[i] ? -1 : 1;
    }
  }
  if (a.bits !== b.bits) {
    return a.bits < b.bits ? -1 : 1;
  }
  return 0;
}

/** tsaddr.SortPrefixes：原地排序（slices.SortFunc(netipx.ComparePrefix)）。 */
export function sortPrefixes(prefixes: IpPrefix[]): void {
  prefixes.sort(comparePrefix);
}

const V4_ALL: IpPrefix = maskedPrefix({ addr: parseIp(ZERO_V4), bits: 0 });
const V6_ALL: IpPrefix = maskedPrefix({ addr: parseIp(ZERO_V6), bits: 0 });

/** IsExitRoute：精确 0.0.0.0/0 或 ::/0（tsaddr.go:270-273；0.0.0.0/1 不是）。 */
export function isExitRoute(p: IpPrefix): boolean {
  return prefixEqual(p, V4_ALL) || prefixEqual(p, V6_ALL);
}

const CGNAT_RANGE: IpPrefix = { addr: parseIp('100.64.0.0'), bits: 10 };
const CHROMEOS_VM_RANGE: IpPrefix = { addr: parseIp('100.115.92.0'), bits: 23 };
const TAILSCALE_ULA_RANGE: IpPrefix = { addr: parseIp('fd7a:115c:a1e0::'), bits: 48 };

/** CGNAT 100.64.0.0/10（tsaddr.go:31-37）。 */
export function cgnatRange(): IpPrefix {
  return CGNAT_RANGE;
}

/** ChromeOS host↔VM 段 100.115.92.0/23（Tailscale 不从中分配，须从 CGNAT 刨除）。 */
export function chromeOsVmRange(): IpPrefix {
  return CHROMEOS_VM_RANGE;
}

/** Tailscale ULA fd7a:115c:a1e0::/48（tsaddr.go:92-98）。 */
export function tailscaleUlaRange(): IpPrefix {
  return TAILSCALE_ULA_RANGE;
}

/** IsTailscaleIP（tsaddr.go:72-80：v4 = CGNAT 且非 ChromeOS；v6 = ULA）。 */
export function isTailscaleIp(addr: IpAddr): boolean {
  if (addr.is4) {
    return prefixContainsAddr(CGNAT_RANGE, addr) && !prefixContainsAddr(CHROMEOS_VM_RANGE, addr);
  }
  return prefixContainsAddr(TAILSCALE_ULA_RANGE, addr);
}

/** 解析 AddrPort 线格式："1.2.3.4:41641" / "[fd7a::1]:41641"；非法抛 Error。 */
export function parseIpPort(s: string): IpPort {
  if (s.length === 0) {
    throw new Error('netaddr: empty ip:port string');
  }
  if (s.charAt(0) === '[') {
    const close: number = s.indexOf(']');
    if (close < 0 || close + 2 > s.length || s.charAt(close + 1) !== ':') {
      throw new Error('netaddr: invalid bracketed ip:port "' + s + '"');
    }
    const port: number = Number(s.slice(close + 2));
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('netaddr: invalid port in "' + s + '"');
    }
    const out: IpPort = { addr: parseIpv6(s.slice(1, close)), port: port };
    return out;
  }
  const colon: number = s.lastIndexOf(':');
  if (colon <= 0) {
    throw new Error('netaddr: missing port in "' + s + '"');
  }
  const port: number = Number(s.slice(colon + 1));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('netaddr: invalid port in "' + s + '"');
  }
  const out: IpPort = { addr: parseIp(s.slice(0, colon)), port: port };
  return out;
}

/** 解析失败返回 null（不抛）。 */
export function tryParseIpPort(s: string): IpPort | null {
  let out: IpPort | null = null;
  try {
    out = parseIpPort(s);
  } catch (e) {
    out = null;
  }
  return out;
}

/** AddrPort 字符串输出（v6 自动加方括号，对齐 netip.AddrPort.String()）。 */
export function ipPortToString(addr: IpAddr, port: number): string {
  const ip: string = addrToString(addr);
  if (addr.is4) {
    return ip + ':' + String(port);
  }
  return '[' + ip + ']:' + String(port);
}

/** IsLoopback（127/8、::1）。 */
export function isLoopbackAddr(addr: IpAddr): boolean {
  if (addr.is4) {
    return addr.bytes[0] === 127;
  }
  for (let i: number = 0; i < 15; i += 1) {
    if (addr.bytes[i] !== 0) {
      return false;
    }
  }
  return addr.bytes[15] === 1;
}

/** IsLinkLocalUnicast（169.254/16、fe80::/10）。 */
export function isLinkLocalUnicastAddr(addr: IpAddr): boolean {
  if (addr.is4) {
    return addr.bytes[0] === 169 && addr.bytes[1] === 254;
  }
  return addr.bytes[0] === 0xfe && (addr.bytes[1] & 0xc0) === 0x80;
}

/** IsPrivate（RFC1918 三段；v6 fc00::/7）。 */
export function isPrivateAddr(addr: IpAddr): boolean {
  if (addr.is4) {
    const b0: number = addr.bytes[0];
    const b1: number = addr.bytes[1];
    if (b0 === 10) {
      return true;
    }
    if (b0 === 172 && (b1 & 0xf0) === 16) {
      return true;
    }
    if (b0 === 192 && b1 === 168) {
      return true;
    }
    return false;
  }
  return (addr.bytes[0] & 0xfe) === 0xfc;
}

const DERP_MAGIC_BYTES: Uint8Array = new Uint8Array([127, 3, 3, 40]);

/** DERP home 假地址 ip 部分（tailcfg.go:3072-3079 DerpMagicIP="127.3.3.40"）。 */
export function isDerpMagicAddr(addr: IpAddr): boolean {
  if (!addr.is4) {
    return false;
  }
  for (let i: number = 0; i < 4; i += 1) {
    if (addr.bytes[i] !== DERP_MAGIC_BYTES[i]) {
      return false;
    }
  }
  return true;
}

/** addrPort 是否为 DERP 假地址形态 "127.3.3.40:<regionID>"（endpoint.go:1540）。 */
export function isDerpMagicAddrPort(addrPort: string): boolean {
  const parsed: IpPort | null = tryParseIpPort(addrPort);
  if (parsed === null) {
    return false;
  }
  return isDerpMagicAddr(parsed.addr);
}
