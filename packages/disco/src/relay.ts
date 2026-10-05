/**
 * disco UDP relay 家族（0x04–0x09）消息编解码与收发辅助。
 *
 * 上游实读依据（docs/upstream/2026-10-01-phase2/disco.go，2026-10-01 实拉
 * tailscale main；下文「disco.go:N」均指该归档文件；对齐笔记见
 * docs/research/2026-10-02-B1-disco-relay.md，本文件逐条语义与其行号锚定一致）：
 *
 * - 类型码 0x04–0x09：disco.go:44-54（TypeBindUDPRelayEndpoint /
 *   TypeBindUDPRelayEndpointChallenge / TypeBindUDPRelayEndpointAnswer /
 *   TypeCallMeMaybeVia / TypeAllocateUDPRelayEndpointRequest /
 *   TypeAllocateUDPRelayEndpointResponse）。
 * - 0x04/0x05/0x06 是 UDP relay 客户端 ↔ relay 服务端（net/udprelay.Server，
 *   disco.go:314-315 仅给出包路径引用，服务端内部语义未归档、本仓不补写）的
 *   三次 bind 握手报文；三种报文同为 74B 等长帧（2B 头 + 72B 公共块，
 *   Challenge 字段在 0x04 中纯粹为等长填充，disco.go:366-369）。
 * - 0x07/0x08/0x09 是仅经 DERP 交换（"sent only over DERP"，disco.go:625-628、
 *   :463-465、:507-509）的 relay 端点协商报文；密封层与 0x01–0x03 完全同构
 *   （同一 wrapper，disco.go:4-19），本文件不重复密封，调用方经 wrapper.ts
 *   的 discoSeal/discoOpen 进出。
 *
 * 端序：密封内层全部大端（u16/u32/u64 BE）——注意与同仓 wireguard 包的小端
 * 相反（docs/architecture.md:247）。
 *
 * P4：Generation 的随机取值经注入的 Rng（newBindUDPRelayHandshakeGeneration），
 * 本模块零时钟/随机直读。
 */

import { ByteReader, ByteWriter, type Rng } from '@ohos-tailscale/common';
import { DiscoError } from './errors.ts';
import type { DiscoEndpoint } from './messages.ts';

/**
 * 密封内层报文头长（type u8 + version u8；上游 MessageHeaderLen = 2，
 * disco.go:118-119）。与 messages.ts 各持一份上游常量锚定，避免本模块与
 * messages.ts 相互运行时导入。
 */
const RELAY_MSG_HEADER_LEN: number = 2;

/** v0 版本字节（上游 const v0 = byte(0)，disco.go:56）。 */
const RELAY_MSG_VERSION: number = 0;

/**
 * 端点条目长度 = IP 16B + Port 2B（上游 epLength，disco.go:219；与
 * messages.ts 的 DISCO_EP_LEN_BYTES 同一上游常量，此处独立锚定以保持
 * relay.ts → messages.ts 仅类型级依赖）。
 */
const DISCO_EP_ENTRY_LEN: number = 18;

/** 密钥/公钥长度（32B；上游 key.DiscoPublicRawLen，key-disco.go:25-28）。 */
const RELAY_KEY_LEN_BYTES: number = 32;

/**
 * bind 握手公共块长度 = VNI 4 + Generation 4 + RemoteKey 32 + Challenge 32
 * （上游 bindUDPRelayEndpointCommonLen = 72，disco.go:340-342）。
 */
export const DISCO_BIND_UDP_RELAY_COMMON_LEN: number = 72;

/** bind Challenge 字段长度（上游 BindUDPRelayChallengeLen = 32，disco.go:344-346）。 */
export const DISCO_BIND_UDP_RELAY_CHALLENGE_LEN: number = 32;

/**
 * UDPRelayEndpoint 不含 AddrPorts 的基块长度 = ServerDisco 32 + ClientDisco 64 +
 * LamportID 8 + VNI 4 + BindLifetime 8 + SteadyStateLifetime 8
 * （上游 udpRelayEndpointLenMinusAddrPorts = 124，disco.go:539-544）。
 */
export const DISCO_UDP_RELAY_ENDPOINT_BASE_LEN: number = 124;

/**
 * Allocate 请求载荷长度 = ClientDisco 2×32 + Generation 4 = 68
 * （上游 allocateUDPRelayEndpointRequestLen，disco.go:475-478）；加 2B 头总长 70B。
 */
export const DISCO_ALLOCATE_UDP_RELAY_ENDPOINT_REQUEST_LEN: number = 68;

/** relay 家族类型码（0x04–0x09；值锚定 disco.go:44-54，messages.ts 的全表引用本对象）。 */
export interface DiscoRelayMessageTypeE {
  BindUDPRelayEndpoint: number;
  BindUDPRelayEndpointChallenge: number;
  BindUDPRelayEndpointAnswer: number;
  CallMeMaybeVia: number;
  AllocateUDPRelayEndpointRequest: number;
  AllocateUDPRelayEndpointResponse: number;
}

export const DiscoRelayMessageType: DiscoRelayMessageTypeE = {
  BindUDPRelayEndpoint: 0x04,
  BindUDPRelayEndpointChallenge: 0x05,
  BindUDPRelayEndpointAnswer: 0x06,
  CallMeMaybeVia: 0x07,
  AllocateUDPRelayEndpointRequest: 0x08,
  AllocateUDPRelayEndpointResponse: 0x09,
};

/**
 * bind 三次握手公共块（上游 BindUDPRelayEndpointCommon，disco.go:352-370）。
 * 四字段在握手全生命周期应保持一致（Challenge 除外——它在 0x04 中无关紧要，
 * disco.go:348-351）。
 */
export interface DiscoBindUDPRelayEndpoint {
  /**
   * Geneve 头 VNI；接收方必须与 disco 密封值一致，不一致 = 明文 Geneve 头被
   * 篡改/损坏（disco.go:353-357）。一致性字段，不做任何自动纠正（对齐笔记 P-10）。
   */
  vni: number;
  /** 握手代次；客户端每次新握手必须取新的非零值（disco.go:358-360）。 */
  generation: number;
  /** 参与本 relay 端点的远端 peer 的 disco 公钥（32B 原始值，disco.go:361-363）。 */
  remoteKey: Uint8Array;
  /**
   * 服务端在 0x05 设置、客户端在 0x06 原样回显（disco.go:364-366）；
   * 在 0x04 中无意义，仅作填充以保证三种握手报文等长（disco.go:366-369）。
   */
  challenge: Uint8Array;
}

/**
 * UDPRelayEndpoint：net/udprelay/endpoint.ServerEndpoint 的线上镜像
 * （disco.go:546-548、549-564），同时被 0x07 CallMeMaybeVia 与
 * 0x09 AllocateUDPRelayEndpointResponse 携带。字段语义详注归档在未归档的
 * net/udprelay 包内（研究笔记 §9 不可证区），本仓只做原样搬运，不编造
 * lifetime 缺省值等内部语义。
 */
export interface DiscoUDPRelayEndpoint {
  /** relay 服务端的 disco 公钥（32B 原始值，disco.go:550-551）。 */
  serverDisco: Uint8Array;
  /**
   * 允许与该端点握手的两个客户端 disco 公钥（上游 [2]key.DiscoPublic，
   * disco.go:552-553、468）；ArkTS 无元组，用长度恒为 2 的数组表达。
   */
  clientDisco: Uint8Array[];
  /**
   * 上游 net/udprelay/endpoint.ServerEndpoint.LamportID 的镜像（disco.go:554-555）；
   * u64 BE（disco.go:605），推进规则未归档，原样搬运（P6：bigint）。
   */
  lamportId: bigint;
  /** ServerEndpoint.VNI 镜像（disco.go:556-557），u32 BE。 */
  vni: number;
  /**
   * Go time.Duration（纳秒）槽位（disco.go:558-559、编码 :581），u64 BE；
   * 例：120s = 120×10⁹ ns 已超 2³²，必须 bigint。
   */
  bindLifetime: bigint;
  /** 同 BindLifetime（disco.go:560-561、编码 :583），u64 BE 纳秒。 */
  steadyStateLifetime: bigint;
  /**
   * relay 服务端的 UDP 端点候选列表（disco.go:562-563）；条目与 CallMeMaybe
   * 端点同构：16B IP（IPv4 用 v4-mapped 原样保存，unmapIp16 可去映射）‖
   * u16 BE 端口（disco.go:585-590、613-621）。上游解码做 netip Unmap()，本仓
   * 保持线上原样 16B 并提供 unmapIp16（与 0x02/0x03 既有模式一致）。
   */
  addrPorts: DiscoEndpoint[];
}

/** 0x07 CallMeMaybeVia：仅经 DERP 发送（disco.go:625-639）。 */
export interface DiscoCallMeMaybeVia {
  endpoint: DiscoUDPRelayEndpoint;
}

/** 0x08 AllocateUDPRelayEndpointRequest：仅经 DERP 发送（disco.go:463-473）。 */
export interface DiscoAllocateUDPRelayEndpointRequest {
  /** 允许与所分配端点握手的两个客户端 disco 公钥（disco.go:466-468）。 */
  clientDisco: Uint8Array[];
  /** 分配请求代次；服务端必须在 0x09 中回显以对齐请求-响应（disco.go:469-473）。 */
  generation: number;
}

/** 0x09 AllocateUDPRelayEndpointResponse：仅经 DERP 回应 0x08（disco.go:507-515）。 */
export interface DiscoAllocateUDPRelayEndpointResponse {
  /** 必须回显 0x08 的 Generation（disco.go:510-513）。 */
  generation: number;
  endpoint: DiscoUDPRelayEndpoint;
}

function relayError(code: string, message: string): Error {
  return new DiscoError(code, message) as Error;
}

/* ------------------------------------------------------------------ *
 * 0x04 / 0x05 / 0x06 bind 三次握手（74B 等长帧）
 * ------------------------------------------------------------------ */

/** 写公共块（字段序 = 上游 encode，disco.go:372-382；全 BE）。 */
function writeBindCommon(w: ByteWriter, m: DiscoBindUDPRelayEndpoint): void {
  w.writeU32be(m.vni);
  w.writeU32be(m.generation);
  w.writeBytes(m.remoteKey);
  w.writeBytes(m.challenge);
}

/** 编码公共校验：RemoteKey/Challenge 必须 32B（上游 [32]byte 定长字段，disco.go:361-369）。 */
function checkBindCommon(m: DiscoBindUDPRelayEndpoint): void {
  if (m.remoteKey.length !== RELAY_KEY_LEN_BYTES) {
    throw relayError(
      'RANGE',
      'bind udp relay encode: remoteKey must be ' + String(RELAY_KEY_LEN_BYTES) +
        ' bytes, got ' + String(m.remoteKey.length),
    );
  }
  if (m.challenge.length !== DISCO_BIND_UDP_RELAY_CHALLENGE_LEN) {
    throw relayError(
      'RANGE',
      'bind udp relay encode: challenge must be ' + String(DISCO_BIND_UDP_RELAY_CHALLENGE_LEN) +
        ' bytes, got ' + String(m.challenge.length),
    );
  }
}

/** 三种 bind 报文共享的编码主体（AppendMarshal 仅类型字节不同，disco.go:405-409、427-431、448-452）。 */
function encodeBindMessage(type: number, m: DiscoBindUDPRelayEndpoint): Uint8Array {
  checkBindCommon(m);
  const w: ByteWriter = new ByteWriter(RELAY_MSG_HEADER_LEN + DISCO_BIND_UDP_RELAY_COMMON_LEN);
  w.writeU8(type);
  w.writeU8(RELAY_MSG_VERSION);
  writeBindCommon(w, m);
  return w.toUint8Array();
}

/**
 * 三种 bind 报文共享的解析主体。上游三个 parse 只做公共块 decode（<72B →
 * errShort）且完全不检查 version 字节（disco.go:411-418、433-440、454-461、
 * 384-397）——注意这与 0x07/0x08/0x09 的「ver≠0 返回空消息」宽松语义不同
 * （对齐笔记 P-4，逐类型照抄，不得统一）。对超长尾部宽松：只读前 72B
 * （Go decode 对 len(b) ≥ 72 切片读取，余量忽略）。
 */
function parseBindMessage(expectedType: number, p: Uint8Array): DiscoBindUDPRelayEndpoint {
  if (p.length < RELAY_MSG_HEADER_LEN + DISCO_BIND_UDP_RELAY_COMMON_LEN) {
    throw relayError(
      'SHORT',
      'bind udp relay parse: message too short, got ' + String(p.length) +
        ' (need ' + String(RELAY_MSG_HEADER_LEN + DISCO_BIND_UDP_RELAY_COMMON_LEN) + ')',
    );
  }
  const r: ByteReader = new ByteReader(p);
  const t: number = r.readU8();
  if (t !== expectedType) {
    throw relayError(
      'TYPE',
      'bind udp relay parse: type must be 0x' + expectedType.toString(16) + ', got 0x' + t.toString(16),
    );
  }
  const ver: number = r.readU8();
  void ver; // 上游 bind 家族不检查 version（disco.go:411-418 等）
  const vni: number = r.readU32be(); // disco.go:389
  const generation: number = r.readU32be(); // disco.go:391
  const remoteKey: Uint8Array = r.readBytes(RELAY_KEY_LEN_BYTES); // disco.go:393
  const challenge: Uint8Array = r.readBytes(DISCO_BIND_UDP_RELAY_CHALLENGE_LEN); // disco.go:395
  const m: DiscoBindUDPRelayEndpoint = { vni: vni, generation: generation, remoteKey: remoteKey, challenge: challenge };
  return m;
}

/**
 * 编码 0x04 BindUDPRelayEndpoint——客户端发往 relay 服务端的第一条握手报文
 * （disco.go:399-401）；总长 74B。Challenge 字段原样写出（0x04 中它是等长
 * 填充，砍掉即破坏上游「ensuring all handshake messages are equal in size」
 * 设计，disco.go:366-369，对齐笔记 P-3）。
 */
export function bindUDPRelayEndpointEncode(m: DiscoBindUDPRelayEndpoint): Uint8Array {
  return encodeBindMessage(DiscoRelayMessageType.BindUDPRelayEndpoint, m);
}

/** 解析 0x04（disco.go:411-418：不查 version，<72B 载荷抛 SHORT）。 */
export function bindUDPRelayEndpointParse(p: Uint8Array): DiscoBindUDPRelayEndpoint {
  return parseBindMessage(DiscoRelayMessageType.BindUDPRelayEndpoint, p);
}

/**
 * 编码 0x05 BindUDPRelayEndpointChallenge——服务端收到 0x04 后回给客户端
 * （disco.go:420-423）；Challenge 字段由服务端设置。
 */
export function bindUDPRelayChallengeEncode(m: DiscoBindUDPRelayEndpoint): Uint8Array {
  return encodeBindMessage(DiscoRelayMessageType.BindUDPRelayEndpointChallenge, m);
}

/** 解析 0x05（disco.go:433-440）。 */
export function bindUDPRelayChallengeParse(p: Uint8Array): DiscoBindUDPRelayEndpoint {
  return parseBindMessage(DiscoRelayMessageType.BindUDPRelayEndpointChallenge, p);
}

/**
 * 编码 0x06 BindUDPRelayEndpointAnswer——客户端收到 0x05 后回给服务端，
 * Challenge 必须原样回显（disco.go:442-444、364-366）。
 */
export function bindUDPRelayAnswerEncode(m: DiscoBindUDPRelayEndpoint): Uint8Array {
  return encodeBindMessage(DiscoRelayMessageType.BindUDPRelayEndpointAnswer, m);
}

/** 解析 0x06（disco.go:454-461）。 */
export function bindUDPRelayAnswerParse(p: Uint8Array): DiscoBindUDPRelayEndpoint {
  return parseBindMessage(DiscoRelayMessageType.BindUDPRelayEndpointAnswer, p);
}

/* ------------------------------------------------------------------ *
 * UDPRelayEndpoint 公共结构（124B + 18N，0x07/0x09 载荷体）
 * ------------------------------------------------------------------ */

/** 客户端/服务端数量硬校验（上游 [2]key.DiscoPublic，disco.go:468、553）。 */
function checkClientDiscoPair(clientDisco: Uint8Array[]): void {
  if (clientDisco.length !== 2) {
    throw relayError(
      'RANGE',
      'udp relay endpoint: clientDisco must hold exactly 2 keys, got ' + String(clientDisco.length),
    );
  }
  if (clientDisco[0].length !== RELAY_KEY_LEN_BYTES || clientDisco[1].length !== RELAY_KEY_LEN_BYTES) {
    throw relayError(
      'RANGE',
      'udp relay endpoint: each clientDisco key must be ' + String(RELAY_KEY_LEN_BYTES) + ' bytes',
    );
  }
}

/**
 * 编码 UDPRelayEndpoint 裸块（124B + 18×N；无消息头——上游它是嵌在
 * 0x07/0x09 载荷里的公共结构）。字段序 = 上游 encode（disco.go:566-591），
 * 全 BE。AddrPorts 允许 N=0（上游 AppendMarshal 不设下限，disco.go:645-646、
 * 517-520）——但 decode 要求 N≥1（disco.go:595），encode/decode 存在非对称
 * 是上游原样事实（对齐笔记 P-5），本地不得"修复"。
 */
export function udpRelayEndpointEncode(m: DiscoUDPRelayEndpoint): Uint8Array {
  if (m.serverDisco.length !== RELAY_KEY_LEN_BYTES) {
    throw relayError(
      'RANGE',
      'udp relay endpoint encode: serverDisco must be ' + String(RELAY_KEY_LEN_BYTES) +
        ' bytes, got ' + String(m.serverDisco.length),
    );
  }
  checkClientDiscoPair(m.clientDisco);
  const w: ByteWriter = new ByteWriter(DISCO_UDP_RELAY_ENDPOINT_BASE_LEN + DISCO_EP_ENTRY_LEN * m.addrPorts.length);
  w.writeBytes(m.serverDisco); // disco.go:569-571
  w.writeBytes(m.clientDisco[0]); // disco.go:572-576
  w.writeBytes(m.clientDisco[1]);
  w.writeU64be(m.lamportId); // disco.go:577
  w.writeU32be(m.vni); // disco.go:579
  w.writeU64be(m.bindLifetime); // disco.go:581（time.Duration 纳秒）
  w.writeU64be(m.steadyStateLifetime); // disco.go:583
  for (let i: number = 0; i < m.addrPorts.length; i += 1) {
    const ep: DiscoEndpoint = m.addrPorts[i];
    if (ep.ip16.length !== 16) {
      throw relayError(
        'RANGE',
        'udp relay endpoint encode: addrPort ip must be 16 bytes, got ' + String(ep.ip16.length),
      );
    }
    w.writeBytes(ep.ip16); // disco.go:586-588（As16 后原样 16B）
    w.writeU16be(ep.port); // disco.go:588
  }
  return w.toUint8Array();
}

/**
 * 解析 UDPRelayEndpoint 裸块。上游 decode 校验（disco.go:593-598）：
 * len < 124+18 **或** (len−124) % 18 ≠ 0 → errShort——即至少要有一个
 * AddrPort（N ≥ 1，对齐笔记 P-5 非对称事实）。超长尾部不宽松：非 18 对齐
 * 即 SHORT（Go 循环消费全部字节，disco.go:613-621）。
 */
export function udpRelayEndpointParse(b: Uint8Array): DiscoUDPRelayEndpoint {
  if (
    b.length < DISCO_UDP_RELAY_ENDPOINT_BASE_LEN + DISCO_EP_ENTRY_LEN ||
    (b.length - DISCO_UDP_RELAY_ENDPOINT_BASE_LEN) % DISCO_EP_ENTRY_LEN !== 0
  ) {
    throw relayError(
      'SHORT',
      'udp relay endpoint parse: need 124+18N bytes (N>=1), got ' + String(b.length),
    );
  }
  const r: ByteReader = new ByteReader(b);
  const serverDisco: Uint8Array = r.readBytes(RELAY_KEY_LEN_BYTES); // disco.go:599
  const c0: Uint8Array = r.readBytes(RELAY_KEY_LEN_BYTES); // disco.go:601-604
  const c1: Uint8Array = r.readBytes(RELAY_KEY_LEN_BYTES);
  const clientDisco: Uint8Array[] = [c0, c1];
  const lamportId: bigint = r.readU64be(); // disco.go:605
  const vni: number = r.readU32be(); // disco.go:607
  const bindLifetime: bigint = r.readU64be(); // disco.go:609（Duration 纳秒）
  const steadyStateLifetime: bigint = r.readU64be(); // disco.go:611
  const addrPorts: DiscoEndpoint[] = [];
  while (!r.atEnd()) {
    const ip16: Uint8Array = r.readBytes(16);
    const port: number = r.readU16be();
    const ep: DiscoEndpoint = { ip16: ip16, port: port };
    addrPorts.push(ep);
  }
  const m: DiscoUDPRelayEndpoint = {
    serverDisco: serverDisco,
    clientDisco: clientDisco,
    lamportId: lamportId,
    vni: vni,
    bindLifetime: bindLifetime,
    steadyStateLifetime: steadyStateLifetime,
    addrPorts: addrPorts,
  };
  return m;
}

/* ------------------------------------------------------------------ *
 * 0x07 CallMeMaybeVia（仅经 DERP）
 * ------------------------------------------------------------------ */

/**
 * 编码 0x07：2B 头 ‖ 124B UDPRelayEndpoint ‖ 18×N（总长 2+124+18N，
 * disco.go:644-649）。仅经 DERP 发送的通道约束在调用层承载（disco 包不依赖
 * derp，docs/architecture.md D2）；直连路径（CallMeMaybe 通告的）优先级高于
 * CallMeMaybeVia 路径（disco.go:636-639，属于 magicsock 调度语义，本仓不实现）。
 */
export function callMeMaybeViaEncode(m: DiscoCallMeMaybeVia): Uint8Array {
  const block: Uint8Array = udpRelayEndpointEncode(m.endpoint);
  const w: ByteWriter = new ByteWriter(RELAY_MSG_HEADER_LEN + block.length);
  w.writeU8(DiscoRelayMessageType.CallMeMaybeVia);
  w.writeU8(RELAY_MSG_VERSION);
  w.writeBytes(block);
  return w.toUint8Array();
}

/**
 * 解析 0x07（disco.go:651-658）：ver≠0 → 返回零值消息且**无错误**（宽松忽略，
 * 与 bind 家族「不查 ver」不同，对齐笔记 P-4）；否则按 UDPRelayEndpoint.decode
 * 解析剩余载荷（<142B 或非 18 对齐 → SHORT）。
 */
export function callMeMaybeViaParse(p: Uint8Array): DiscoCallMeMaybeVia {
  if (p.length < RELAY_MSG_HEADER_LEN) {
    throw relayError('SHORT', 'callMeMaybeVia parse: too short, got ' + String(p.length));
  }
  const r: ByteReader = new ByteReader(p);
  const t: number = r.readU8();
  if (t !== DiscoRelayMessageType.CallMeMaybeVia) {
    throw relayError(
      'TYPE',
      'callMeMaybeVia parse: type must be 0x07, got 0x' + t.toString(16),
    );
  }
  const ver: number = r.readU8();
  if (ver !== RELAY_MSG_VERSION) {
    return zeroCallMeMaybeVia();
  }
  const out: DiscoCallMeMaybeVia = { endpoint: udpRelayEndpointParse(r.takeRemaining()) };
  return out;
}

/* ------------------------------------------------------------------ *
 * 0x08 AllocateUDPRelayEndpointRequest（仅经 DERP）
 * ------------------------------------------------------------------ */

/**
 * 编码 0x08：2B 头 ‖ ClientDisco[0] ‖ ClientDisco[1] ‖ Generation(u32 BE)，
 * 总长 70B（AppendMarshal 顺序 disco.go:480-489）。
 */
export function allocateUDPRelayEndpointRequestEncode(m: DiscoAllocateUDPRelayEndpointRequest): Uint8Array {
  checkClientDiscoPair(m.clientDisco);
  const w: ByteWriter = new ByteWriter(RELAY_MSG_HEADER_LEN + DISCO_ALLOCATE_UDP_RELAY_ENDPOINT_REQUEST_LEN);
  w.writeU8(DiscoRelayMessageType.AllocateUDPRelayEndpointRequest);
  w.writeU8(RELAY_MSG_VERSION);
  w.writeBytes(m.clientDisco[0]); // disco.go:482-486
  w.writeBytes(m.clientDisco[1]);
  w.writeU32be(m.generation); // disco.go:487
  return w.toUint8Array();
}

/**
 * 解析 0x08（disco.go:491-505）：ver≠0 → 零值消息且无错误；载荷 <68B →
 * SHORT；对超长尾部宽松（只读前 68B）。
 */
export function allocateUDPRelayEndpointRequestParse(p: Uint8Array): DiscoAllocateUDPRelayEndpointRequest {
  if (p.length < RELAY_MSG_HEADER_LEN) {
    throw relayError('SHORT', 'allocate request parse: too short, got ' + String(p.length));
  }
  const r: ByteReader = new ByteReader(p);
  const t: number = r.readU8();
  if (t !== DiscoRelayMessageType.AllocateUDPRelayEndpointRequest) {
    throw relayError(
      'TYPE',
      'allocate request parse: type must be 0x08, got 0x' + t.toString(16),
    );
  }
  const ver: number = r.readU8();
  if (ver !== RELAY_MSG_VERSION) {
    return zeroAllocateRequest();
  }
  if (p.length - RELAY_MSG_HEADER_LEN < DISCO_ALLOCATE_UDP_RELAY_ENDPOINT_REQUEST_LEN) {
    throw relayError(
      'SHORT',
      'allocate request parse: payload too short, got ' + String(p.length - RELAY_MSG_HEADER_LEN) +
        ' (need ' + String(DISCO_ALLOCATE_UDP_RELAY_ENDPOINT_REQUEST_LEN) + ')',
    );
  }
  const c0: Uint8Array = r.readBytes(RELAY_KEY_LEN_BYTES);
  const c1: Uint8Array = r.readBytes(RELAY_KEY_LEN_BYTES);
  const clientDisco: Uint8Array[] = [c0, c1];
  const generation: number = r.readU32be();
  const m: DiscoAllocateUDPRelayEndpointRequest = { clientDisco: clientDisco, generation: generation };
  return m;
}

/* ------------------------------------------------------------------ *
 * 0x09 AllocateUDPRelayEndpointResponse（仅经 DERP）
 * ------------------------------------------------------------------ */

/**
 * 编码 0x09：2B 头 ‖ Generation(u32 BE) ‖ 124B UDPRelayEndpoint ‖ 18×N
 * （总长 130+18N；AppendMarshal 先写 Generation 再写 endpoint，disco.go:517-524）。
 */
export function allocateUDPRelayEndpointResponseEncode(m: DiscoAllocateUDPRelayEndpointResponse): Uint8Array {
  const block: Uint8Array = udpRelayEndpointEncode(m.endpoint);
  const w: ByteWriter = new ByteWriter(RELAY_MSG_HEADER_LEN + 4 + block.length);
  w.writeU8(DiscoRelayMessageType.AllocateUDPRelayEndpointResponse);
  w.writeU8(RELAY_MSG_VERSION);
  w.writeU32be(m.generation); // disco.go:521
  w.writeBytes(block); // disco.go:522（m.encode(d[4:])）
  return w.toUint8Array();
}

/**
 * 解析 0x09（disco.go:526-537）：ver≠0 → 零值消息且无错误；载荷 <4B → SHORT；
 * Generation 之后对剩余部分走 UDPRelayEndpoint.decode（可再抛 SHORT）——
 * 两段式长度校验原样保留。
 */
export function allocateUDPRelayEndpointResponseParse(p: Uint8Array): DiscoAllocateUDPRelayEndpointResponse {
  if (p.length < RELAY_MSG_HEADER_LEN) {
    throw relayError('SHORT', 'allocate response parse: too short, got ' + String(p.length));
  }
  const r: ByteReader = new ByteReader(p);
  const t: number = r.readU8();
  if (t !== DiscoRelayMessageType.AllocateUDPRelayEndpointResponse) {
    throw relayError(
      'TYPE',
      'allocate response parse: type must be 0x09, got 0x' + t.toString(16),
    );
  }
  const ver: number = r.readU8();
  if (ver !== RELAY_MSG_VERSION) {
    return zeroAllocateResponse();
  }
  if (p.length - RELAY_MSG_HEADER_LEN < 4) {
    throw relayError(
      'SHORT',
      'allocate response parse: need >=4 bytes of payload, got ' + String(p.length - RELAY_MSG_HEADER_LEN),
    );
  }
  const generation: number = r.readU32be(); // disco.go:534
  const endpoint: DiscoUDPRelayEndpoint = udpRelayEndpointParse(r.takeRemaining()); // disco.go:535
  const m: DiscoAllocateUDPRelayEndpointResponse = { generation: generation, endpoint: endpoint };
  return m;
}

/* ------------------------------------------------------------------ *
 * 零值消息（上游 parse 在 ver≠0 时返回的 zero value，disco.go:491-505、
 * 526-537、651-658：Go 零值 = 零键 + 零数值 + 空端点表）
 * ------------------------------------------------------------------ */

function zeroKey32(): Uint8Array {
  return new Uint8Array(RELAY_KEY_LEN_BYTES);
}

function zeroUDPRelayEndpoint(): DiscoUDPRelayEndpoint {
  const clientDisco: Uint8Array[] = [zeroKey32(), zeroKey32()];
  const addrPorts: DiscoEndpoint[] = [];
  const m: DiscoUDPRelayEndpoint = {
    serverDisco: zeroKey32(),
    clientDisco: clientDisco,
    lamportId: 0n,
    vni: 0,
    bindLifetime: 0n,
    steadyStateLifetime: 0n,
    addrPorts: addrPorts,
  };
  return m;
}

function zeroCallMeMaybeVia(): DiscoCallMeMaybeVia {
  const m: DiscoCallMeMaybeVia = { endpoint: zeroUDPRelayEndpoint() };
  return m;
}

function zeroAllocateRequest(): DiscoAllocateUDPRelayEndpointRequest {
  const clientDisco: Uint8Array[] = [zeroKey32(), zeroKey32()];
  const m: DiscoAllocateUDPRelayEndpointRequest = { clientDisco: clientDisco, generation: 0 };
  return m;
}

function zeroAllocateResponse(): DiscoAllocateUDPRelayEndpointResponse {
  const m: DiscoAllocateUDPRelayEndpointResponse = { generation: 0, endpoint: zeroUDPRelayEndpoint() };
  return m;
}

/* ------------------------------------------------------------------ *
 * bind 握手状态机（收发辅助）
 * ------------------------------------------------------------------ */

/**
 * bind 三次握手状态（上游 BindUDPRelayHandshakeState 五态 iota，客户端/服务端
 * 两角色混用一个枚举，disco.go:312-338）。R5 常量对象模式（禁 enum/A34）。
 */
export interface DiscoBindUDPRelayHandshakeStateE {
  /** 任何报文发送前的初始态（disco.go:319-321）。 */
  Init: number;
  /** 客户端：发出 0x04 后的第一态（disco.go:322-324）。 */
  BindSent: number;
  /** 服务端：收到 0x04 并回出 0x05 后（disco.go:325-328）。 */
  ChallengeSent: number;
  /** 客户端：收到 0x05、回出 0x06 后（disco.go:329-332）。 */
  AnswerSent: number;
  /** 服务端：收到**正确的** 0x06 后（disco.go:333-337）。 */
  AnswerReceived: number;
}

export const DiscoBindUDPRelayHandshakeState: DiscoBindUDPRelayHandshakeStateE = {
  Init: 0,
  BindSent: 1,
  ChallengeSent: 2,
  AnswerSent: 3,
  AnswerReceived: 4,
};

/** 校验 v 是否为合法握手状态值；非法返回 null（R5 模式）。 */
export function parseDiscoBindUDPRelayHandshakeState(v: number): number | null {
  if (v === DiscoBindUDPRelayHandshakeState.Init) {
    return v;
  }
  if (v === DiscoBindUDPRelayHandshakeState.BindSent) {
    return v;
  }
  if (v === DiscoBindUDPRelayHandshakeState.ChallengeSent) {
    return v;
  }
  if (v === DiscoBindUDPRelayHandshakeState.AnswerSent) {
    return v;
  }
  if (v === DiscoBindUDPRelayHandshakeState.AnswerReceived) {
    return v;
  }
  return null;
}

/**
 * 判定 0x06 Answer 是否原样回显了 0x05 的 Challenge（上游「正确 Answer」的
 * 唯一在档判定要素，disco.go:364-366；研究笔记 §4.1：服务端如何做其余校验
 * 在未归档的 net/udprelay 内，不杜撰）。
 */
export function bindUDPRelayChallengeEchoed(answer: DiscoBindUDPRelayEndpoint, challenge: Uint8Array): boolean {
  if (answer.challenge.length !== challenge.length) {
    return false;
  }
  for (let i: number = 0; i < challenge.length; i += 1) {
    if (answer.challenge[i] !== challenge[i]) {
      return false;
    }
  }
  return true;
}

/**
 * bind 握手单侧状态推进辅助（确定性，零时钟/随机；迁移表逐条锚定
 * disco.go:319-337）。上游枚举本身不带迁移逻辑（用法在未归档的 magicsock/
 * net/udprelay），本类是本仓裁定：非法迁移抛 DiscoError('RANGE') 而非静默
 * 跳变——与 P-10「一致性字段不做自动纠正」同一保守取向。
 *
 * 客户端：onSentBindEndpoint → onSentAnswer
 * 服务端：onSentChallenge → onReceivedAnswer
 */
export class DiscoBindUDPRelayHandshake {
  private stateValue: number = DiscoBindUDPRelayHandshakeState.Init; // disco.go:319-321

  /** 当前状态（DiscoBindUDPRelayHandshakeState 之一）。 */
  public get state(): number {
    return this.stateValue;
  }

  /** 客户端：发出 0x04（Init → BindSent，disco.go:322-324）。 */
  public onSentBindEndpoint(): void {
    this.requireState(DiscoBindUDPRelayHandshakeState.Init, 'onSentBindEndpoint');
    this.stateValue = DiscoBindUDPRelayHandshakeState.BindSent;
  }

  /** 服务端：收到 0x04 并回出 0x05（Init → ChallengeSent，disco.go:325-328）。 */
  public onSentChallenge(): void {
    this.requireState(DiscoBindUDPRelayHandshakeState.Init, 'onSentChallenge');
    this.stateValue = DiscoBindUDPRelayHandshakeState.ChallengeSent;
  }

  /** 客户端：收到 0x05 后回出 0x06（BindSent → AnswerSent，disco.go:329-332）。 */
  public onSentAnswer(): void {
    this.requireState(DiscoBindUDPRelayHandshakeState.BindSent, 'onSentAnswer');
    this.stateValue = DiscoBindUDPRelayHandshakeState.AnswerSent;
  }

  /**
   * 服务端：收到 0x06。仅当 Challenge 被正确回显时迁移到 AnswerReceived 并返回
   * true（disco.go:333-337「a correct BindUDPRelayEndpointAnswer」+ :364-366）；
   * 回显不匹配则停留原状态并返回 false（不抛错——错误 Answer 不推进握手）。
   */
  public onReceivedAnswer(answer: DiscoBindUDPRelayEndpoint, expectedChallenge: Uint8Array): boolean {
    this.requireState(DiscoBindUDPRelayHandshakeState.ChallengeSent, 'onReceivedAnswer');
    if (!bindUDPRelayChallengeEchoed(answer, expectedChallenge)) {
      return false;
    }
    this.stateValue = DiscoBindUDPRelayHandshakeState.AnswerReceived;
    return true;
  }

  private requireState(expected: number, action: string): void {
    if (this.stateValue !== expected) {
      throw relayError(
        'RANGE',
        'bind udp relay handshake: ' + action + ' requires state ' + String(expected) +
          ', got ' + String(this.stateValue),
      );
    }
  }
}

/**
 * 为一次新 bind 握手取非零随机 Generation（disco.go:358-360「Clients must set
 * a new, nonzero value at the start of every handshake」）。随机性一律经注入
 * Rng（P4，对齐笔记 P-9）；字节序 u32 BE 手工组装（乘法避免 << 符号位问题）。
 */
export function newBindUDPRelayHandshakeGeneration(rng: Rng): number {
  for (;;) {
    const buf: Uint8Array = new Uint8Array(4);
    rng.randomBytes(buf);
    const v: number = buf[0] * 0x1000000 + buf[1] * 0x10000 + buf[2] * 0x100 + buf[3];
    if (v !== 0) {
      return v;
    }
  }
}
