/**
 * tailcfg MapResponse 解码 + netmap 状态存储（C1 子线：netmap→WG peer 推导的输入端）。
 *
 * 上游核对（v1.102.3 tag 实拉，2026-10-02；本仓归档 ts-main/tailcfg.go 交叉对照）：
 * - MapResponse 全字段"零值=不变"（ts-main/tailcfg.go:1996-2005 总注）；
 * - 全量/增量裁决：`Peers` 非空 ⇒ 全量替换（keep-set 之外全删）且忽略一切其他
 *   delta（control/controlclient/map.go:790-812，"Peers precludes all other delta
 *   operations"）；否则依次 PeersRemoved → PeersChanged（整 Node 覆盖）→
 *   PeerSeenChange（只改 LastSeen）→ OnlineChange（只改 Online）→
 *   PeersChangedPatch（字段级，只对已知 NodeID 生效，map.go:853-901）；
 * - disable-delta-updates knob：增量路径整体关闭、整帧按全量重建
 *   （map.go:418-421 tryHandleIncrementally 首行 return false）；
 * - upgradeNode（map.go:384-416，对 Node/Peers[]/PeersChanged[] 每项）：
 *   ① legacy `"DERP":"127.3.3.40:N"` → HomeDERP=N（HomeDERP==0 时）并清掉该字段；
 *   ② AllowedIPs JSON null/缺失 ⇒ clone(Addresses)；[] 保持空（null 与 [] 语义不同，
 *      capver 112 起，ts-main/tailcfg.go:163 + map.go:406-407）；
 *   ③ UnsignedPeerAPIOnly ⇒ AllowedIPs 钳为 Addresses（map.go:410-414）；
 * - 旧服务器只发 Capabilities ⇒ 并集进 CapMap（key 存在、value=nil）再统一处理
 *   （map.go:299-306）；knob 只从 MapResponse.Node.CapMap 派生（map.go:307）；
 * - 过期防御 flagExpiredPeers（ipn/ipnlocal/local.go:1838-1840 + expiry.go:80-135）：
 *   KeyExpiry 非零且 ≤ (本地时间+clockDelta) ⇒ Expired=true、清 Endpoints、
 *   HomeDERP=0、公钥前 6 字节换 badOldPrefix（key-node.go:224-237）；peer 不从
 *   状态删除（离线保留，oracle harmony-vm 案例 protocol-notes.md:114-124）；
 *   ControlTime 与本地差 >1min ⇒ 记 clockDelta（expiry.go:27-28, 65-74），
 *   ControlTime 早于 flagExpiredPeersEpoch 忽略（expiry.go:20-23）；
 * - knob 属性串是"短名"非 URL（v1.102.3 tailcfg.go:2474-2480 注释 + 2574-2829 常量表
 *   实读；oracle 同版本 fork，protocol-notes.md:14）。peer 的 CapMap 永不参与 knob。
 *
 * ArkTS/JSON：本文件与 tailcfg.ts 同属"触碰 JSON 的模块"（R3 例外落点）；
 * JSON.parse 返回值一律立即 `as` 到具名 interface。解码错误抛 ControlError('HTTP')
 * （payload 层，与 decodeRegisterResponse 同口径）。
 */

import { hexDecode, hexEncode, type Clock } from '@ohos-tailscale/common';
import { ControlError } from './errors.ts';
import { parsePrefix, prefixToString, type IpPrefix } from './netaddr.ts';
import {
  BAD_OLD_PREFIX_BYTES,
  FLAG_EXPIRED_PEERS_EPOCH_MS,
  MIN_CLOCK_DELTA_MS,
} from './smconsts.ts';

/** 旧版 Capabilities（Deprecated）出现时并进 CapMap 的 value 形态（空数组）。 */
const MERGED_CAP_EMPTY_VALUE: string[] = [];

/**
 * self CapMap 的 knob 属性短名（v1.102.3 tailcfg.go:2574-2829 实读值；
 * 注意 cache-network-maps 与研究笔记草稿所记 main 版 "cache-netmap" 不同——
 * 以 oracle 同版本 v1.102.3 实拉为准）。
 */
export interface NodeAttrNameE {
  OnlyTCP443: string;
  DebugForceBackgroundSTUN: string;
  DebugDisableWGTrim: string;
  DebugDisableUPnP: string;
  DisableDeltaUpdates: string;
  RandomizeClientPort: string;
  SilentDisco: string;
  OneCGNATEnable: string;
  OneCGNATDisable: string;
  ProbeUDPLifetime: string;
  PeerMTUEnable: string;
  CacheNetworkMaps: string;
  DisableRelayServer: string;
  DisableRelayClient: string;
}

export const NodeAttrName: NodeAttrNameE = {
  OnlyTCP443: 'only-tcp-443',
  DebugForceBackgroundSTUN: 'debug-always-stun',
  DebugDisableWGTrim: 'debug-no-wg-trim',
  DebugDisableUPnP: 'debug-disable-upnp',
  DisableDeltaUpdates: 'disable-delta-updates',
  RandomizeClientPort: 'randomize-client-port',
  SilentDisco: 'silent-disco',
  OneCGNATEnable: 'one-cgnat?v=true',
  OneCGNATDisable: 'one-cgnat?v=false',
  ProbeUDPLifetime: 'probe-udp-lifetime',
  PeerMTUEnable: 'peer-mtu-enable',
  CacheNetworkMaps: 'cache-network-maps',
  DisableRelayServer: 'disable-relay-server',
  DisableRelayClient: 'disable-relay-client',
};

/** 校验 v 是否为已知 knob 属性短名；已知返回 v 原值，未知返回 null。 */
export function parseNodeAttrName(v: string): string | null {
  const names: string[] = [
    NodeAttrName.OnlyTCP443,
    NodeAttrName.DebugForceBackgroundSTUN,
    NodeAttrName.DebugDisableWGTrim,
    NodeAttrName.DebugDisableUPnP,
    NodeAttrName.DisableDeltaUpdates,
    NodeAttrName.RandomizeClientPort,
    NodeAttrName.SilentDisco,
    NodeAttrName.OneCGNATEnable,
    NodeAttrName.OneCGNATDisable,
    NodeAttrName.ProbeUDPLifetime,
    NodeAttrName.PeerMTUEnable,
    NodeAttrName.CacheNetworkMaps,
    NodeAttrName.DisableRelayServer,
    NodeAttrName.DisableRelayClient,
  ];
  for (const n of names) {
    if (n === v) {
      return v;
    }
  }
  return null;
}

/**
 * CapMap 值形态：cap 短名 → JSON 原文数组（ts-main/tailcfg.go:1626-1670，
 * 值是 json.RawMessage；本阶段只消费 key 存在性 Contains，不解值内容）。
 * Record 取值按可能 undefined 处理（A17/U10）。
 */
export type NodeCapMap = Record<string, string[]>;

/** Contains 语义：key 存在即为有此能力（值为 nil/空数组亦然，tailcfg.go:1662-1668）。 */
export function capMapContains(capMap: NodeCapMap | null, name: string): boolean {
  if (capMap === null) {
    return false;
  }
  return capMap[name] !== undefined;
}

/**
 * ControlKnobs（control/controlknobs.go:20-143 Knobs 的本阶段相关子集）。
 * 更新语义对齐 UpdateFromNodeAttributes（controlknobs.go:145-213）：每次以当前
 * CapMap 全量重算——属性缺失 ⇒ 关闭（控制面不下发就不启用，oracle 实测全关）。
 * oneCGNAT 为 tri-state：null=未下发 / true / false（controlknobs.go:170-175）。
 */
export class ControlKnobs {
  public disableUPnP: boolean = false;
  public randomizeClientPort: boolean = false;
  public disableDeltaUpdates: boolean = false;
  public forceBackgroundSTUN: boolean = false;
  public silentDisco: boolean = false;
  public probeUDPLifetime: boolean = false;
  public peerMtuEnable: boolean = false;
  public cacheNetworkMaps: boolean = false;
  public disableRelayServer: boolean = false;
  public disableRelayClient: boolean = false;
  public onlyTcp443: boolean = false;
  public oneCGNAT: boolean | null = null;

  /** 以 self CapMap 全量重算全部 knob（UpdateFromNodeAttributes 语义）。 */
  public updateFromCapMap(capMap: NodeCapMap | null): void {
    this.disableUPnP = capMapContains(capMap, NodeAttrName.DebugDisableUPnP);
    this.randomizeClientPort = capMapContains(capMap, NodeAttrName.RandomizeClientPort);
    this.disableDeltaUpdates = capMapContains(capMap, NodeAttrName.DisableDeltaUpdates);
    this.forceBackgroundSTUN = capMapContains(capMap, NodeAttrName.DebugForceBackgroundSTUN);
    this.silentDisco = capMapContains(capMap, NodeAttrName.SilentDisco);
    this.probeUDPLifetime = capMapContains(capMap, NodeAttrName.ProbeUDPLifetime);
    this.peerMtuEnable = capMapContains(capMap, NodeAttrName.PeerMTUEnable);
    this.cacheNetworkMaps = capMapContains(capMap, NodeAttrName.CacheNetworkMaps);
    this.disableRelayServer = capMapContains(capMap, NodeAttrName.DisableRelayServer);
    this.disableRelayClient = capMapContains(capMap, NodeAttrName.DisableRelayClient);
    this.onlyTcp443 = capMapContains(capMap, NodeAttrName.OnlyTCP443);
    if (capMapContains(capMap, NodeAttrName.OneCGNATEnable)) {
      this.oneCGNAT = true;
    } else if (capMapContains(capMap, NodeAttrName.OneCGNATDisable)) {
      this.oneCGNAT = false;
    } else {
      this.oneCGNAT = null;
    }
  }
}

// ---- JSON 解码层 ----

/** JSON 里 Node 对象的原样形态（字段全部可选；类型不符在访问处纠正）。 */
interface ParsedNodeJson {
  ID?: number;
  StableID?: string;
  Key?: string;
  DiscoKey?: string;
  Addresses?: string[] | null;
  AllowedIPs?: string[] | null;
  Endpoints?: string[] | null;
  HomeDERP?: number;
  DERP?: string;
  Expired?: boolean;
  KeyExpiry?: string;
  Online?: boolean;
  LastSeen?: string;
  Cap?: number;
  Capabilities?: string[];
  CapMap?: Record<string, string[]> | null;
  IsWireGuardOnly?: boolean;
  UnsignedPeerAPIOnly?: boolean;
  IsJailed?: boolean;
  SelfNodeV4MasqAddrForThisPeer?: string;
  SelfNodeV6MasqAddrForThisPeer?: string;
  Hostinfo?: { Hostname?: string };
}

interface ParsedPatchJson {
  NodeID?: number;
  DERPRegion?: number;
  Cap?: number;
  CapMap?: Record<string, string[]> | null;
  Endpoints?: string[] | null;
  Key?: string;
  KeySignature?: string;
  DiscoKey?: string;
  Online?: boolean | null;
  LastSeen?: string | null;
  KeyExpiry?: string | null;
}

interface ParsedMapResponseJson {
  KeepAlive?: boolean;
  ControlTime?: string;
  Node?: ParsedNodeJson;
  Peers?: ParsedNodeJson[] | null;
  PeersRemoved?: number[];
  PeersChanged?: ParsedNodeJson[];
  PeersChangedPatch?: Record<string, ParsedPatchJson>;
  PeerSeenChange?: Record<string, boolean>;
  OnlineChange?: Record<string, boolean>;
  /** 只探存在性，不解内容（DERPMap/PacketFilter 属其他子线）。 */
  DERPMap?: object;
  PacketFilter?: object;
  PacketFilters?: object;
}

/**
 * 解码后的 MapResponse 帧（三态保留：字段缺失/JSON null ⇒ null，与 [] 区分）。
 * Node/Peer 的 AllowedIPs：null = "缺失或 JSON null ⇒ 视同 Addresses"（map.go:406-407），
 * [] = 服务器显式清空前缀 ⇒ 推导出 0 条 allowed_ips（peer 从 WG 设备移除）。
 */
export interface MapResponseNode {
  nodeId: number;
  stableId: string;
  keyHex: string;
  key: Uint8Array;
  discoKey: Uint8Array;
  /** null = 缺失/JSON null（未 upgrade）；[] = 显式空。 */
  addresses: string[] | null;
  /** null = 缺失/JSON null；[] = 显式空（capver 112 起 null 视同 Addresses）。 */
  allowedIPs: string[] | null;
  /** null = 字段缺失（增量语义"不变"）；[] = 显式清空。 */
  endpoints: string[] | null;
  homeDerp: number;
  legacyDerp: string;
  expired: boolean;
  keyExpiryRfc3339: string;
  online: boolean;
  lastSeenRfc3339: string;
  capVersion: number;
  capabilities: string[];
  capMap: NodeCapMap | null;
  isWireGuardOnly: boolean;
  unsignedPeerAPIOnly: boolean;
  isJailed: boolean;
  masqAddr4: string;
  masqAddr6: string;
  hostname: string;
}

/** PeersChangedPatch 单条（tailcfg.PeerChange，v1.102.3 tailcfg.go:3348-3387）。 */
export interface PeerPatchFrame {
  nodeId: number;
  /** null = 字段缺失（不生效）；非 null 才替换（指针/非零语义）。 */
  derpRegion: number;
  capVersion: number;
  capMap: NodeCapMap | null;
  endpoints: string[] | null;
  key: Uint8Array | null;
  keyHex: string;
  discoKey: Uint8Array | null;
  online: boolean | null;
  lastSeenRfc3339: string | null;
  keyExpiryRfc3339: string | null;
}

/** PeerSeenChange / OnlineChange 单条。 */
export interface PeerBoolChange {
  nodeId: number;
  value: boolean;
}

/** 解码后的 MapResponse 帧。 */
export interface MapResponseFrame {
  keepAlive: boolean;
  /** RFC3339；'' = 缺失。 */
  controlTimeRfc3339: string;
  /** self node；null = 缺失（零值=不变）。 */
  node: MapResponseNode | null;
  /** null = 缺失/JSON null；[] = 空数组（Go len==0 不触发全量替换，map.go:790）。 */
  peers: MapResponseNode[] | null;
  peersRemovedNodeIds: number[];
  peersChanged: MapResponseNode[];
  peersChangedPatch: PeerPatchFrame[];
  peerSeenChange: PeerBoolChange[];
  onlineChange: PeerBoolChange[];
  derpMapPresent: boolean;
  packetFilterPresent: boolean;
}

function decodeError(what: string, detail: string): ControlError {
  return new ControlError('HTTP', 'netmap decode: ' + what + ': ' + detail);
}

/** 解析 RFC3339 时间字符串；非法抛解码错（对齐 Go encoding/json 严格性）。 */
export function parseRfc3339Ms(s: string, what: string): number {
  const ms: number = new Date(s).getTime();
  if (Number.isNaN(ms)) {
    throw decodeError(what, 'invalid RFC3339 "' + s + '"') as Error;
  }
  return ms;
}

/** "nodekey:"/"discokey:" + 64 hex → 32B（key-node.go:333-347 前缀语义）。 */
function decodeKeyField(value: string, prefix: string, what: string): Uint8Array {
  if (value.length !== prefix.length + 1 + 64 || !value.startsWith(prefix + ':')) {
    throw decodeError(what, 'expect "' + prefix + ':<64 hex>", got length ' + String(value.length)) as Error;
  }
  const hexPart: string = value.slice(prefix.length + 1);
  let key: Uint8Array;
  try {
    key = hexDecode(hexPart);
  } catch (e) {
    throw decodeError(what, 'bad hex: ' + String(e)) as Error;
  }
  return key;
}

/** 前缀列表解码：逐条 parsePrefix（bits 越界/非法在解析层抛错）。 */
export function decodePrefixList(values: string[] | null, what: string): IpPrefix[] | null {
  if (values === null) {
    return null;
  }
  const out: IpPrefix[] = [];
  for (const v of values) {
    let p: IpPrefix;
    try {
      p = parsePrefix(v);
    } catch (e) {
      throw decodeError(what, String(e)) as Error;
    }
    out.push(p);
  }
  return out;
}

function decodeNode(raw: ParsedNodeJson, what: string): MapResponseNode {
  const keyHex: string = typeof raw.Key === 'string' ? raw.Key : '';
  const key: Uint8Array = keyHex === '' ? new Uint8Array(32) : decodeKeyField(keyHex, 'nodekey', what + '.Key');
  const discoHex: string = typeof raw.DiscoKey === 'string' ? raw.DiscoKey : '';
  const discoKey: Uint8Array = discoHex === '' ? new Uint8Array(32) : decodeKeyField(discoHex, 'discokey', what + '.DiscoKey');
  const keyExpiry: string = typeof raw.KeyExpiry === 'string' && raw.KeyExpiry !== '' ? raw.KeyExpiry : '';
  if (keyExpiry !== '') {
    parseRfc3339Ms(keyExpiry, what + '.KeyExpiry');
  }
  const lastSeen: string = typeof raw.LastSeen === 'string' && raw.LastSeen !== '' ? raw.LastSeen : '';
  if (lastSeen !== '') {
    parseRfc3339Ms(lastSeen, what + '.LastSeen');
  }
  // 前缀字段在解码层即校验（对齐 Go encoding/json → netip.Prefix 的严格反序列化：
  // "ip/bits" 非法/bits 越界 ⇒ 整帧拒绝；C1 §7-6）。
  if (raw.Addresses !== undefined && raw.Addresses !== null) {
    decodePrefixList(raw.Addresses, what + '.Addresses');
  }
  if (raw.AllowedIPs !== undefined && raw.AllowedIPs !== null) {
    decodePrefixList(raw.AllowedIPs, what + '.AllowedIPs');
  }
  const node: MapResponseNode = {
    nodeId: typeof raw.ID === 'number' ? raw.ID : 0,
    stableId: typeof raw.StableID === 'string' ? raw.StableID : '',
    keyHex: keyHex,
    key: key,
    discoKey: discoKey,
    addresses: raw.Addresses === undefined ? null : raw.Addresses,
    allowedIPs: raw.AllowedIPs === undefined ? null : raw.AllowedIPs,
    endpoints: raw.Endpoints === undefined ? null : raw.Endpoints,
    homeDerp: typeof raw.HomeDERP === 'number' ? raw.HomeDERP : 0,
    legacyDerp: typeof raw.DERP === 'string' ? raw.DERP : '',
    expired: raw.Expired === true,
    keyExpiryRfc3339: keyExpiry,
    online: raw.Online === true,
    lastSeenRfc3339: lastSeen,
    capVersion: typeof raw.Cap === 'number' ? raw.Cap : 0,
    capabilities: raw.Capabilities === undefined || raw.Capabilities === null ? [] : raw.Capabilities,
    capMap: raw.CapMap === undefined ? null : raw.CapMap,
    isWireGuardOnly: raw.IsWireGuardOnly === true,
    unsignedPeerAPIOnly: raw.UnsignedPeerAPIOnly === true,
    isJailed: raw.IsJailed === true,
    masqAddr4: typeof raw.SelfNodeV4MasqAddrForThisPeer === 'string' ? raw.SelfNodeV4MasqAddrForThisPeer : '',
    masqAddr6: typeof raw.SelfNodeV6MasqAddrForThisPeer === 'string' ? raw.SelfNodeV6MasqAddrForThisPeer : '',
    hostname: raw.Hostinfo !== undefined && raw.Hostinfo !== null && typeof raw.Hostinfo.Hostname === 'string'
      ? raw.Hostinfo.Hostname
      : '',
  };
  return node;
}

/** JSON 数字键 → NodeID（>2^53 有精度风险，C1 §7-15；headscale 实测小整数）。 */
function nodeIdFromString(s: string, what: string): number {
  const v: number = Number(s);
  if (!Number.isInteger(v) || v < 0) {
    throw decodeError(what, 'invalid NodeID key "' + s + '"') as Error;
  }
  return v;
}

/** 解码一行 MapResponse JSON（chunked 流的一行一个对象）。 */
export function decodeMapResponseFrame(jsonText: string): MapResponseFrame {
  const raw = JSON.parse(jsonText) as ParsedMapResponseJson;
  const frame: MapResponseFrame = {
    keepAlive: raw.KeepAlive === true,
    controlTimeRfc3339: typeof raw.ControlTime === 'string' && raw.ControlTime !== '' ? raw.ControlTime : '',
    node: raw.Node === undefined || raw.Node === null ? null : decodeNode(raw.Node, 'Node'),
    peers: raw.Peers === undefined || raw.Peers === null ? null : [],
    peersRemovedNodeIds: [],
    peersChanged: [],
    peersChangedPatch: [],
    peerSeenChange: [],
    onlineChange: [],
    derpMapPresent: raw.DERPMap !== undefined && raw.DERPMap !== null,
    packetFilterPresent: raw.PacketFilter !== undefined || raw.PacketFilters !== undefined,
  };
  if (frame.controlTimeRfc3339 !== '') {
    parseRfc3339Ms(frame.controlTimeRfc3339, 'ControlTime');
  }
  const rawPeers: ParsedNodeJson[] | null | undefined = raw.Peers;
  if (rawPeers !== undefined && rawPeers !== null && frame.peers !== null) {
    const peersOut: MapResponseNode[] = frame.peers;
    for (let i: number = 0; i < rawPeers.length; i += 1) {
      peersOut.push(decodeNode(rawPeers[i], 'Peers[' + String(i) + ']'));
    }
  }
  if (raw.PeersRemoved !== undefined && raw.PeersRemoved !== null) {
    for (const id of raw.PeersRemoved) {
      frame.peersRemovedNodeIds.push(id);
    }
  }
  if (raw.PeersChanged !== undefined && raw.PeersChanged !== null) {
    for (let i: number = 0; i < raw.PeersChanged.length; i += 1) {
      frame.peersChanged.push(decodeNode(raw.PeersChanged[i], 'PeersChanged[' + String(i) + ']'));
    }
  }
  if (raw.PeersChangedPatch !== undefined && raw.PeersChangedPatch !== null) {
    // 动态键遍历：for..in 被 A24 禁用，Object.keys 是唯一途径（ArkTS 静态类型
    // 口径见约束文档 §6-U5，未真机验证；Record + Object.keys 为官方 sanctioned 形态）。
    const keys: string[] = Object.keys(raw.PeersChangedPatch);
    for (const k of keys) {
      const p: ParsedPatchJson | undefined = raw.PeersChangedPatch[k];
      if (p === undefined) {
        continue;
      }
      const patch: PeerPatchFrame = {
        nodeId: typeof p.NodeID === 'number' ? p.NodeID : nodeIdFromString(k, 'PeersChangedPatch'),
        derpRegion: typeof p.DERPRegion === 'number' ? p.DERPRegion : 0,
        capVersion: typeof p.Cap === 'number' ? p.Cap : 0,
        capMap: p.CapMap === undefined ? null : p.CapMap,
        endpoints: p.Endpoints === undefined ? null : p.Endpoints,
        key: p.Key === undefined || p.Key === null ? null : decodeKeyField(p.Key, 'nodekey', 'Patch.Key'),
        keyHex: typeof p.Key === 'string' ? p.Key : '',
        discoKey: p.DiscoKey === undefined || p.DiscoKey === null ? null : decodeKeyField(p.DiscoKey, 'discokey', 'Patch.DiscoKey'),
        online: p.Online === undefined ? null : p.Online === true,
        lastSeenRfc3339: p.LastSeen === undefined || p.LastSeen === null || p.LastSeen === '' ? null : p.LastSeen,
        keyExpiryRfc3339: p.KeyExpiry === undefined || p.KeyExpiry === null || p.KeyExpiry === '' ? null : p.KeyExpiry,
      };
      if (patch.lastSeenRfc3339 !== null) {
        parseRfc3339Ms(patch.lastSeenRfc3339, 'Patch.LastSeen');
      }
      if (patch.keyExpiryRfc3339 !== null) {
        parseRfc3339Ms(patch.keyExpiryRfc3339, 'Patch.KeyExpiry');
      }
      frame.peersChangedPatch.push(patch);
    }
  }
  if (raw.PeerSeenChange !== undefined && raw.PeerSeenChange !== null) {
    const keys: string[] = Object.keys(raw.PeerSeenChange);
    for (const k of keys) {
      const v: boolean | undefined = raw.PeerSeenChange[k];
      if (v === undefined) {
        continue;
      }
      const change: PeerBoolChange = { nodeId: nodeIdFromString(k, 'PeerSeenChange'), value: v === true };
      frame.peerSeenChange.push(change);
    }
  }
  if (raw.OnlineChange !== undefined && raw.OnlineChange !== null) {
    const keys: string[] = Object.keys(raw.OnlineChange);
    for (const k of keys) {
      const v: boolean | undefined = raw.OnlineChange[k];
      if (v === undefined) {
        continue;
      }
      const change: PeerBoolChange = { nodeId: nodeIdFromString(k, 'OnlineChange'), value: v === true };
      frame.onlineChange.push(change);
    }
  }
  return frame;
}

// ---- netmap 状态存储 ----

/** 已 upgrade 的 peer 状态（map session ms.peers 的 TS 形态）。 */
export interface NetmapPeerState extends MapResponseNode {
  /** upgrade 后恒为数组（null 已按 Addresses clone 填充，map.go:406-407）。 */
  allowedIPsUpgraded: string[];
  /** legacy DERP 已并入 homeDerp 并清空（map.go:390-401）。 */
  upgraded: boolean;
}

/** ingest 结果（调用方据此决定全量重建还是只重推 touched）。 */
export interface NetmapIngestOutcome {
  /** true ⇒ 消费方应对全部 peer 重建 WG 配置（全量帧或 disable-delta-updates）。 */
  fullRebuild: boolean;
  /** 本帧有变化的 peer canonical id（全量帧时为全部）。 */
  touched: string[];
  removedCount: number;
  /** 本帧 flagExpiredPeers 新标记的过期 peer 数。 */
  expiredCount: number;
}

/** canonical id：优先 StableID（字符串，跨控制面稳定）；否则 '#'+NodeID。 */
export function canonicalPeerId(stableId: string, nodeId: number): string {
  if (stableId !== '') {
    return stableId;
  }
  return '#' + String(nodeId);
}

/**
 * netmap 状态存储：应用 MapResponse 帧（全量/增量裁决）+ upgradeNode +
 * flagExpiredPeers 过期防御 + knob 更新。过期/离线 peer 不删除
 * （routemanager.go:397-402 剪后仍按 ID/Key 跟踪，支持复活）。
 */
export class NetmapState {
  /** self CapMap 派生的 knob（map.go:307 唯一更新点）。 */
  public readonly knobs: ControlKnobs = new ControlKnobs();

  private peers: Map<string, NetmapPeerState> = new Map();
  private nodeIdIndex: Map<number, string> = new Map();
  private selfNode: NetmapPeerState | null = null;
  private clockDeltaMs: number = 0;

  /** 应用一帧；clock 为注入时钟（P4）。 */
  public ingestFrame(frame: MapResponseFrame, clock: Clock): NetmapIngestOutcome {
    const touched: string[] = [];
    let removedCount: number = 0;
    let fullRebuild: boolean = false;

    // ControlTime → clockDelta（expiry.go:65-74；早于 epoch 忽略，expiry.go:20-23）。
    if (frame.controlTimeRfc3339 !== '') {
      const controlMs: number = parseRfc3339Ms(frame.controlTimeRfc3339, 'ControlTime');
      if (controlMs >= FLAG_EXPIRED_PEERS_EPOCH_MS) {
        const delta: number = controlMs - clock.wallMs();
        this.clockDeltaMs = delta > MIN_CLOCK_DELTA_MS || delta < -MIN_CLOCK_DELTA_MS ? delta : 0;
      }
    }

    // self node：upgrade + knob 更新（map.go:294-308）。
    if (frame.node !== null) {
      this.selfNode = upgradeNode(frame.node);
      const merged: NodeCapMap | null = mergeLegacyCapabilities(this.selfNode.capMap, this.selfNode.capabilities);
      this.knobs.updateFromCapMap(merged);
    }

    // 全量 vs 增量裁决（map.go:790-812）。
    if (frame.peers !== null && frame.peers.length > 0) {
      fullRebuild = true;
      const keep: Map<string, boolean> = new Map();
      for (const rawPeer of frame.peers) {
        const peer: NetmapPeerState = upgradeNode(rawPeer);
        const cid: string = canonicalPeerId(peer.stableId, peer.nodeId);
        keep.set(cid, true);
        this.peers.set(cid, peer);
        this.nodeIdIndex.set(peer.nodeId, cid);
        touched.push(cid);
      }
      const stale: string[] = [];
      this.peers.forEach((_state: NetmapPeerState, cid: string): void => {
        if (!keep.has(cid)) {
          stale.push(cid);
        }
      });
      for (const cid of stale) {
        const removed: NetmapPeerState | undefined = this.peers.get(cid);
        if (removed !== undefined) {
          this.nodeIdIndex.delete(removed.nodeId);
        }
        this.peers.delete(cid);
        removedCount += 1;
      }
    } else {
      for (const nodeId of frame.peersRemovedNodeIds) {
        const cid: string | undefined = this.nodeIdIndex.get(nodeId);
        if (cid !== undefined) {
          this.nodeIdIndex.delete(nodeId);
          this.peers.delete(cid);
          removedCount += 1;
        }
      }
      for (const rawPeer of frame.peersChanged) {
        const peer: NetmapPeerState = upgradeNode(rawPeer);
        const cid: string = canonicalPeerId(peer.stableId, peer.nodeId);
        this.peers.set(cid, peer);
        this.nodeIdIndex.set(peer.nodeId, cid);
        touched.push(cid);
      }
      for (const seen of frame.peerSeenChange) {
        const cid: string | undefined = this.nodeIdIndex.get(seen.nodeId);
        if (cid === undefined) {
          continue;
        }
        const peer: NetmapPeerState | undefined = this.peers.get(cid);
        if (peer !== undefined) {
          peer.lastSeenRfc3339 = seen.value ? new Date(clock.wallMs()).toISOString() : '';
          this.pushUnique(touched, cid);
        }
      }
      for (const oc of frame.onlineChange) {
        const cid: string | undefined = this.nodeIdIndex.get(oc.nodeId);
        if (cid === undefined) {
          continue;
        }
        const peer: NetmapPeerState | undefined = this.peers.get(cid);
        if (peer !== undefined) {
          peer.online = oc.value;
          this.pushUnique(touched, cid);
        }
      }
      for (const patch of frame.peersChangedPatch) {
        const applied: boolean = this.applyPatch(patch);
        if (applied) {
          const cid: string | undefined = this.nodeIdIndex.get(patch.nodeId);
          if (cid !== undefined) {
            this.pushUnique(touched, cid);
          }
        }
      }
    }

    // disable-delta-updates knob ⇒ 整帧按全量重建（map.go:418-421）。
    if (this.knobs.disableDeltaUpdates) {
      fullRebuild = true;
    }

    // 每帧过期防御（local.go:1838-1840）。
    const expiredCount: number = this.flagExpiredPeers(clock);

    const outcome: NetmapIngestOutcome = {
      fullRebuild: fullRebuild,
      touched: touched,
      removedCount: removedCount,
      expiredCount: expiredCount,
    };
    return outcome;
  }

  /** 按 canonical id 取 peer 状态。 */
  public peerById(canonicalId: string): NetmapPeerState | null {
    const s: NetmapPeerState | undefined = this.peers.get(canonicalId);
    return s === undefined ? null : s;
  }

  /** 全部 peer（Map 插入序）。 */
  public allPeers(): NetmapPeerState[] {
    const out: NetmapPeerState[] = [];
    this.peers.forEach((s: NetmapPeerState): void => {
      out.push(s);
    });
    return out;
  }

  /** peer 数。 */
  public peerCount(): number {
    return this.peers.size;
  }

  /** self node（已 upgrade）；未收到带 Node 的帧时 null。 */
  public self(): NetmapPeerState | null {
    return this.selfNode;
  }

  /** clockDelta（挂钟 ms；expiry.go:30-33 语义：localNow + delta == ControlTime）。 */
  public clockDelta(): number {
    return this.clockDeltaMs;
  }

  /**
   * 全部 peer 中最近的 KeyExpiry（挂钟 ms；无过期者返回 0）。
   * 调用方据此在 expiry+10s 处安排重查（local.go:1856-1858 的 +10s 迟滞）。
   */
  public nextExpiryWallMs(): number {
    let next: number = 0;
    this.peers.forEach((p: NetmapPeerState): void => {
      if (p.keyExpiryRfc3339 === '' || p.expired) {
        return;
      }
      const ms: number = parseRfc3339Ms(p.keyExpiryRfc3339, 'KeyExpiry');
      if (next === 0 || ms < next) {
        next = ms;
      }
    });
    return next;
  }

  /**
   * flagExpiredPeers（expiry.go:80-135）：KeyExpiry 非零且 ≤ controlNow（=本地+delta）
   * ⇒ Expired=true、清 Endpoints/HomeDERP、公钥前 6 字节换 badOldPrefix。
   * 返回本次新标记数；已标记者跳过；peer 不从状态删除。
   */
  public flagExpiredPeers(clock: Clock): number {
    const controlNow: number = clock.wallMs() + this.clockDeltaMs;
    let count: number = 0;
    this.peers.forEach((peer: NetmapPeerState): void => {
      if (peer.keyExpiryRfc3339 === '' || peer.expired) {
        return;
      }
      const expiryMs: number = parseRfc3339Ms(peer.keyExpiryRfc3339, 'KeyExpiry');
      if (expiryMs > controlNow) {
        return;
      }
      peer.expired = true;
      peer.endpoints = [];
      peer.homeDerp = 0;
      peer.key = breakKeyWithBadOldPrefix(peer.key);
      peer.keyHex = 'nodekey:' + hexEncode(peer.key);
      count += 1;
    });
    return count;
  }

  /** PeersChangedPatch 应用（map.go:853-901）：只对已知 NodeID 生效，字段非空才替换。 */
  private applyPatch(patch: PeerPatchFrame): boolean {
    const cid: string | undefined = this.nodeIdIndex.get(patch.nodeId);
    if (cid === undefined) {
      return false;
    }
    const peer: NetmapPeerState | undefined = this.peers.get(cid);
    if (peer === undefined) {
      return false;
    }
    if (patch.derpRegion !== 0) {
      peer.homeDerp = patch.derpRegion;
    }
    if (patch.capVersion !== 0) {
      peer.capVersion = patch.capVersion;
    }
    if (patch.endpoints !== null) {
      peer.endpoints = patch.endpoints;
    }
    if (patch.key !== null) {
      peer.key = patch.key;
      peer.keyHex = patch.keyHex;
    }
    if (patch.discoKey !== null) {
      peer.discoKey = patch.discoKey;
    }
    if (patch.online !== null) {
      peer.online = patch.online;
    }
    if (patch.lastSeenRfc3339 !== null) {
      peer.lastSeenRfc3339 = patch.lastSeenRfc3339;
    }
    if (patch.keyExpiryRfc3339 !== null) {
      peer.keyExpiryRfc3339 = patch.keyExpiryRfc3339;
    }
    if (patch.capMap !== null) {
      peer.capMap = patch.capMap;
    }
    return true;
  }

  private pushUnique(list: string[], v: string): void {
    for (const item of list) {
      if (item === v) {
        return;
      }
    }
    list.push(v);
  }
}

/** 公钥前 6 字节换 badOldPrefix（key-node.go:233-240 NodePublicWithBadOldPrefix）。 */
export function breakKeyWithBadOldPrefix(key: Uint8Array): Uint8Array {
  const out: Uint8Array = key.slice();
  for (let i: number = 0; i < BAD_OLD_PREFIX_BYTES.length && i < out.length; i += 1) {
    out[i] = BAD_OLD_PREFIX_BYTES[i];
  }
  return out;
}

/**
 * upgradeNode（map.go:384-416）：① legacy DERP 并入 HomeDERP；② AllowedIPs
 * null ⇒ clone(Addresses)；③ UnsignedPeerAPIOnly ⇒ AllowedIPs 钳为 Addresses。
 * 返回新对象（不修改入参）；前缀字符串原样保留（规范化在推导层做，
 * routemanager normalizePrefix 属 contribs 阶段）。
 */
export function upgradeNode(node: MapResponseNode): NetmapPeerState {
  let homeDerp: number = node.homeDerp;
  let legacyDerp: string = node.legacyDerp;
  if (legacyDerp !== '') {
    // 仅当 HomeDERP==0 时解析 legacy（map.go:390-401）；清空无条件（map.go:402）。
    if (homeDerp === 0) {
      const colon: number = legacyDerp.lastIndexOf(':');
      if (colon > 0) {
        const ipPart: string = legacyDerp.slice(0, colon);
        const port: number = Number(legacyDerp.slice(colon + 1));
        if (ipPart === '127.3.3.40' && Number.isInteger(port) && port >= 0) {
          homeDerp = port;
        }
      }
    }
    legacyDerp = '';
  }
  const addresses: string[] = node.addresses === null ? [] : node.addresses;
  let allowedIPs: string[] = node.allowedIPs === null ? addresses.slice() : node.allowedIPs;
  if (node.unsignedPeerAPIOnly && !stringSlicesEqual(allowedIPs, addresses)) {
    allowedIPs = addresses.slice();
  }
  const out: NetmapPeerState = {
    nodeId: node.nodeId,
    stableId: node.stableId,
    keyHex: node.keyHex,
    key: node.key.slice(),
    discoKey: node.discoKey.slice(),
    addresses: node.addresses,
    allowedIPs: node.allowedIPs,
    endpoints: node.endpoints,
    homeDerp: homeDerp,
    legacyDerp: legacyDerp,
    expired: node.expired,
    keyExpiryRfc3339: node.keyExpiryRfc3339,
    online: node.online,
    lastSeenRfc3339: node.lastSeenRfc3339,
    capVersion: node.capVersion,
    capabilities: node.capabilities,
    capMap: node.capMap,
    isWireGuardOnly: node.isWireGuardOnly,
    unsignedPeerAPIOnly: node.unsignedPeerAPIOnly,
    isJailed: node.isJailed,
    masqAddr4: node.masqAddr4,
    masqAddr6: node.masqAddr6,
    hostname: node.hostname,
    allowedIPsUpgraded: allowedIPs,
    upgraded: true,
  };
  return out;
}

/** 字符串切片相等（slices.Equal 的字符串版；升级钳制用）。 */
function stringSlicesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i: number = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** 旧 Capabilities 并集进 CapMap（map.go:299-306；key 存在、value 空）。 */
export function mergeLegacyCapabilities(capMap: NodeCapMap | null, capabilities: string[]): NodeCapMap | null {
  if (capabilities.length === 0) {
    return capMap;
  }
  const out: NodeCapMap = {};
  if (capMap !== null) {
    const keys: string[] = Object.keys(capMap);
    for (const k of keys) {
      const v: string[] | undefined = capMap[k];
      out[k] = v === undefined ? MERGED_CAP_EMPTY_VALUE : v;
    }
  }
  for (const c of capabilities) {
    if (out[c] === undefined) {
      out[c] = MERGED_CAP_EMPTY_VALUE;
    }
  }
  return out;
}

/** 便于诊断：peer 的 allowedIPsUpgraded 规范化字符串列表（解析失败抛错）。 */
export function upgradedAllowedIpStrings(peer: NetmapPeerState): string[] {
  const out: string[] = [];
  for (const s of peer.allowedIPsUpgraded) {
    out.push(prefixToString(parsePrefix(s)));
  }
  return out;
}
