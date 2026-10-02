/**
 * PeerAPI 最小面 —— HTTP-over-WireGuard 节点间 API 的纯逻辑部分（C3 子线）。
 *
 * ✅ 上游核对（v1.102.3 tag 实拉逐行核对，2026-10-03 本会话复拉验证；行号均指该 tag）：
 * - 考古结论：v1.102.3 已无 ipn/peerapi 包（contents API 404），PeerAPI 服务器整体在
 *   ipn/ipnlocal/peerapi.go；ServiceProto 常量在 tailcfg/tailcfg.go:784-786
 *   （PeerAPI4="peerapi4"、PeerAPI6="peerapi6"、PeerAPIDNS="peerapi-dns-proxy"）。
 * - 端口推导（peerapi.go:106-121）：best-effort 确定性 —— tryPort =
 *   (32<<10) | uint16(crc32.ChecksumIEEE(ip16 末 3 字节，首字节 += try))，
 *   连试 5 次；失败退临时端口 ":0"；再失败且非 iOS → 假监听器（Addr 报 ip:1，
 *   Accept 永久阻塞，peerapi.go:1022-1066）——通告端口 1 是合法值。
 * - 对端发现（local.go:7648-7662 peerAPIPorts）：读 peer.Hostinfo.Services 的
 *   peerapi4/peerapi6 端口；自机通告（local.go:5642-5663 peerAPIServicesLocked）：
 *   每 listener 一条 peerapi4/6，主流 OS 另加 {PeerAPIDNS, Port:1}（仅能力版本标记）。
 * - peerAPIBase（peerapi.go:994-1020）：self 有 v4 且对端 p4≠0 → 用对端 v4；否则
 *   self 有 v6 且 p6≠0 → 对端 v6；否则空串。URL = "http://<ip>:<port>"（无 TLS）。
 * - 请求校验（peerapi.go:258-297）：任何 Referer/Origin 拒绝；Host 须为字面量
 *   "peer" 或 "ip:port" 且地址经 isAddressValid（peerapi.go:262-273：对端有
 *   MasqAddr 时地址须等于 masq 地址，否则须 ∈ self Addresses）。
 * - ExitDNS 资格（local.go:7908-7924 peerCanProxyDNS）：peer.Cap >= 26，或旧式
 *   Services 里含 PeerAPIDNS 且 Port >= 1（老控制面兜底）。
 * - 授权链（peerapi.go:683-752 replyToDNSQueries）：isSelf 恒答；否则须
 *   本机 offers exit node / app connector 且 PacketFilter 放行
 *   remote → 0.0.0.0:53（v6 对端用 2000:::53）（filter.CheckTCP）。
 *
 * 说明：本模块只做「URL/端口/校验/资格」纯逻辑；HTTP 实体（需 TCP over WG）
 * 由 app/ 侧 mock 载体表达（鸿蒙 userspace 形态与 Android 同构：假监听器 +
 * 用户态分发即可，peerapi.go:1033-1045 注释）。crc32-IEEE 在本包内自实现
 * （D2：control 不得 import netcheck，尽管 netcheck 的 STUN FINGERPRINT 已有同算法）。
 */

import { addrToString, parseIpPort, prefixContainsAddr, parsePrefix, type IpAddr } from './netaddr.ts';

/** ServiceProto 的 PeerAPI 元服务词表（tailcfg/tailcfg.go:784-786 @v1.102.3）。 */
export interface PeerApiProtoE {
  PeerAPI4: string;
  PeerAPI6: string;
  PeerAPIDNS: string;
}

export const PeerApiProto: PeerApiProtoE = {
  PeerAPI4: 'peerapi4',
  PeerAPI6: 'peerapi6',
  PeerAPIDNS: 'peerapi-dns-proxy',
};

/** 校验 v 是否为已知 PeerAPI 服务词表值；已知返回原值，未知返回 null。 */
export function parsePeerApiProto(v: string): string | null {
  if (v === PeerApiProto.PeerAPI4 || v === PeerApiProto.PeerAPI6 || v === PeerApiProto.PeerAPIDNS) {
    return v;
  }
  return null;
}

/** 假监听器的通告端口（peerapi.go:1022-1066：Addr 报 ip:1，"1 seems pretty safe to use"）。 */
export const PEERAPI_FAKE_LISTENER_PORT: number = 1;

/** 确定性端口推导的尝试次数（peerapi.go:109 `for try := range uint8(5)`）。 */
export const PEERAPI_PORT_TRIES: number = 5;

/** Host 头的合法字面量（peerapi.go:276 `if r.Host == "peer"`）。 */
export const PEERAPI_HOST_LITERAL: string = 'peer';

// ---- crc32-IEEE（纯 TS；对齐 Go hash/crc32 ChecksumIEEE，反射多项式 0xEDB88320） ----

/** CRC-32/IEEE 查表（模块加载期确定性构造；无随机/时钟）。 */
const CRC32_TABLE: Uint32Array = (() => {
  const table: Uint32Array = new Uint32Array(256);
  for (let n: number = 0; n < 256; n += 1) {
    let c: number = n;
    for (let k: number = 0; k < 8; k += 1) {
      if ((c & 1) !== 0) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32/IEEE（同 Go crc32.ChecksumIEEE）：初值 0xFFFFFFFF 反射计算后异或。 */
export function crc32Ieee(data: Uint8Array): number {
  let c: number = 0xffffffff;
  for (let i: number = 0; i < data.length; i += 1) {
    c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 第 try 次尝试的确定性候选端口（peerapi.go:107-115 逐行对齐）：
 * hashData = ip16 末 3 字节的拷贝、首字节 += try；tryPort = (32<<10) | crc32(hashData)，
 * 落在 [32768, 65535]。
 */
export function derivePeerApiPort(ip16: Uint8Array, tryIndex: number): number {
  if (ip16.length !== 16) {
    throw new Error('peerapi: ip16 must be 16 bytes');
  }
  const hashData: Uint8Array = new Uint8Array(3);
  hashData[0] = ip16[13];
  hashData[1] = ip16[14];
  hashData[2] = ip16[15];
  hashData[0] = (hashData[0] + tryIndex) & 0xff;
  return (32 << 10) | (crc32Ieee(hashData) & 0xffff);
}

/** 自机一条 PeerAPI 监听（initPeerAPIListener 装配结果；local.go:6420-6473）。 */
export interface PeerApiListenerView {
  /** 监听地址字符串（v4 点分/v6 原样，不带方括号）。 */
  ip: string;
  port: number;
}

/** Hostinfo.Services 的一条 Service（tailcfg.Service 子集）。 */
export interface TailcfgServiceView {
  proto: string;
  port: number;
}

/**
 * 自机通告的 PeerAPI 服务表（local.go:5642-5663 peerAPIServicesLocked）：
 * 每 listener 一条 peerapi4/peerapi6（按地址族），末尾追加
 * {PeerAPIDNS, Port:1}（仅作能力版本标记，非真实端口）。
 */
export function peerApiServices(listeners: PeerApiListenerView[]): TailcfgServiceView[] {
  const out: TailcfgServiceView[] = [];
  for (const ln of listeners) {
    const is6: boolean = ln.ip.indexOf(':') >= 0;
    const svc: TailcfgServiceView = {
      proto: is6 ? PeerApiProto.PeerAPI6 : PeerApiProto.PeerAPI4,
      port: ln.port,
    };
    out.push(svc);
  }
  const dnsSvc: TailcfgServiceView = { proto: PeerApiProto.PeerAPIDNS, port: 1 };
  out.push(dnsSvc);
  return out;
}

/** peerAPIPorts 结果（local.go:7648-7662）：peer 的 Services 里 peerapi4/6 端口。 */
export interface PeerApiPorts {
  p4: number;
  p6: number;
}

/** 从 peer 的 Services 读 peerapi4/peerapi6 端口（无则 0；后者=该族不可达）。 */
export function peerApiPortsOf(services: TailcfgServiceView[]): PeerApiPorts {
  const out: PeerApiPorts = { p4: 0, p6: 0 };
  for (const s of services) {
    if (s.proto === PeerApiProto.PeerAPI4) {
      out.p4 = s.port;
    } else if (s.proto === PeerApiProto.PeerAPI6) {
      out.p6 = s.port;
    }
  }
  return out;
}

/**
 * peerAPIBase（peerapi.go:994-1020）：按 self 地址族选对端地址——
 * self 有 v4 且 p4≠0 → "http://<peerV4>:p4"；否则 self 有 v6 且 p6≠0 → v6；
 * 都不满足 → ""（对端 PeerAPI 不可达）。
 */
export function peerApiBase(selfHave4: boolean, selfHave6: boolean, peerV4: string, peerV6: string, ports: PeerApiPorts): string {
  if (selfHave4 && ports.p4 !== 0 && peerV4 !== '') {
    return 'http://' + peerV4 + ':' + String(ports.p4);
  }
  if (selfHave6 && ports.p6 !== 0 && peerV6 !== '') {
    // v6 URL 形态对齐 netip.AddrPort.String()：方括号包裹（netaddr.ts ipPortToString 同口径）。
    return 'http://[' + peerV6 + ']:' + String(ports.p6);
  }
  return '';
}

/** PeerAPI 请求视图（HTTP over WG 的明文 HTTP/1 请求头子集；peerapi.go 无 TLS）。 */
export interface PeerApiRequestView {
  method: string;
  /** Host 头原值（'peer' 字面量或 ip:port）。 */
  host: string;
  referer: string;
  origin: string;
  path: string;
}

/**
 * validatePeerAPIRequest（peerapi.go:289-297）：任何 Referer → "unexpected Referer"；
 * 任何 Origin → "unexpected Origin"；再 validateHost。返回 null = 放行。
 * isAddrValid 对齐 isAddressValid（peerapi.go:262-273）：MasqAddr 优先语义由调用方
 * 在回调内实现（先比 masq 地址、再比 self Addresses 包含）。
 */
export function validatePeerApiRequest(req: PeerApiRequestView, isAddrValid: (addr: IpAddr) => boolean): string | null {
  if (req.referer !== '') {
    return 'unexpected Referer';
  }
  if (req.origin !== '') {
    return 'unexpected Origin';
  }
  if (req.host === PEERAPI_HOST_LITERAL) {
    return null;
  }
  // Host 形如 "ip:port"（netip.ParseAddrPort 语义；v6 带方括号）。
  let ipPort;
  try {
    ipPort = parseIpPort(req.host);
  } catch (e) {
    return 'invalid Host "' + req.host + '": ' + String(e);
  }
  if (!isAddrValid(ipPort.addr)) {
    return addrToString(ipPort.addr) + ' not found in self addresses';
  }
  return null;
}

/**
 * peerCanProxyDNS（local.go:7908-7924）：peer.Cap >= 26 ⇒ true；
 * 否则（老控制面无 Cap）Services 里有 PeerAPIDNS 且 Port >= 1 ⇒ true。
 */
export function peerCanProxyDNS(capVersion: number, services: TailcfgServiceView[]): boolean {
  if (capVersion >= 26) {
    return true;
  }
  for (const s of services) {
    if (s.proto === PeerApiProto.PeerAPIDNS && s.port >= 1) {
      return true;
    }
  }
  return false;
}

/**
 * replyToDNSQueries 授权链（peerapi.go:683-752）：isSelf 恒答；
 * 否则本机须 offers exit node / app connector 且 PacketFilter 放行
 * remote → 0.0.0.0:53（v6 对端 2000:::53）——filter 判定结果由调用方以
 * filterAcceptsTcp53 传入（PacketFilter 语义属二期另一件，此处只锚定挂点）。
 */
export function replyToDnsQueries(isSelf: boolean, offersExitNodeOrAppConnector: boolean, filterAcceptsTcp53: boolean): boolean {
  if (isSelf) {
    return true;
  }
  return offersExitNodeOrAppConnector && filterAcceptsTcp53;
}

/**
 * isAddressValid 的标准实现（peerapi.go:262-273）：对端有任一 MasqAddr 时，
 * 地址必须等于某个 masq 地址；否则地址（作 /128、/32 单机前缀）须 ∈ self Addresses。
 */
export function peerApiAddrIsValid(addr: IpAddr, masqV4: string, masqV6: string, selfAddressPrefixes: string[]): boolean {
  const hasMasq: boolean = masqV4 !== '' || masqV6 !== '';
  if (hasMasq) {
    const s: string = addrToString(addr);
    return (masqV4 !== '' && s === masqV4) || (masqV6 !== '' && s === masqV6);
  }
  for (const p of selfAddressPrefixes) {
    let prefix;
    try {
      prefix = parsePrefix(p);
    } catch (e) {
      continue;
    }
    if (prefixContainsAddr(prefix, addr)) {
      return true;
    }
  }
  return false;
}
