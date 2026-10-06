/**
 * netmap → WireGuard peer 配置推导（C1 子线核心；纯函数，无时钟/随机/网络）。
 *
 * 上游核对（v1.102.3 tag 实拉 2026-10-02；经典实现 v1.48.2 nmcfg.go 交叉验证）：
 * - 现行架构：WG 设备按 peer 公钥懒创建，allowed_ips 由路由层实时供给
 *   （wgengine/wgcfg/device.go:24-40：Endpoint = bind.ParseEndpoint(公钥 64hex)，
 *   WG 层 endpoint 不是 ip:port —— C1 §7-7）；wgcfg.Config 只剩 PrivateKey +
 *   Addresses（wgengine/wgcfg/config.go:19-26）；
 * - AllowedIPs 是唯一前缀来源，禁止从 Addresses/PrimaryRoutes 拼路由
 *   （net/routemanager/routemanager.go:387-392, 404 注释 "AllowedIPs is the sole
 *   source of prefixes"）；
 * - 两个剪枝先行（routemanager.go:415-421 peerViewOf）：Expired ⇒ 不贡献前缀；
 *   DiscoKey 为零 && HomeDERP==0 && !IsWireGuardOnly ⇒ 不贡献前缀；剪完仍按
 *   ID/Key 跟踪（netmap 状态不删，支持复活）；
 * - isSelf 两个 OR 分支（routemanager.go:422-424）：单 IP 且 tsaddr.IsTailscaleIP，
 *   或前缀 ∈ n.Addresses；其余归 Routes；
 * - eligible（routemanager.go:824-841）：self 恒进（除非 tailnet 配置 DisableIPv4
 *   且是 v4）；kindRoute 且 IsExitRoute（精确 0.0.0.0/0 / ::/0，tsaddr.go:270-273）
 *   ⇒ 仅当该 peer 正是被选中的 exit node；其他 kindRoute ⇒ 仅当 prefs.RouteAll；
 *   kindExtra 恒进（conn25 Transit IPs 注入面，本阶段不产生，常量保留）；
 * - 返回空 ⇒ 该 peer 不应存在于 WG 设备（routemanager.go:263-266 注释 +
 *   userspace.go:699-718 SyncDevicePeer 查不到前缀即 RemovePeer）；
 * - 排序后返回（tsaddr.SortPrefixes，routemanager.go:295）；重复前缀在 contribs
 *   的 map 里去重、kind 按 bit 并集（routemanager.go:668-687）；
 * - 归一化防御：4-in-6 Unmap + host bits 置位 ⇒ 跳过并记日志，不是替换
 *   （routemanager.go:655-687 normalizePrefix/contribs）；
 * - 自机只取 SelfNode.Addresses 作接口地址（ipn/ipnlocal/local.go:6100-6110 +
 *   types/netmap/netmap.go:91-99 GetAddresses）；SelfNode.AllowedIPs 不进 WG 配置；
 * - MasqAddr（SelfNodeV4MasqAddrForThisPeer）是 SNAT 数据面属性，一期透传记录，
 *   不是 allowed_ips 也不是 endpoint（ts-main/tailcfg.go:514-542）；
 * - PersistentKeepalive：两代上游 WG 配置都未设置（nmcfg.go / config.go），
 *   勿自加 keepalive（C1 §7-13）。
 *
 *ArkTS：纯字段 interface + 模块级纯函数；依赖 common 与同包 netmap/netaddr。
 */

import { hexEncode } from '@ohos-tailscale/common';
import {
  isExitRoute,
  isTailscaleIp,
  maskedPrefix,
  parsePrefix,
  prefixEqual,
  prefixIsSingleIp,
  prefixToString,
  sortPrefixes,
  unmapPrefix,
  type IpPrefix,
} from './netaddr.ts';
import { NetmapState, type NetmapPeerState } from './netmap.ts';

/** contribKind 位掩码（routemanager.go:155-163 kindSelf/kindRoute/kindExtra）。 */
const KIND_SELF: number = 1;
const KIND_ROUTE: number = 2;
// kindExtra（conn25 Transit IPs 扩展注入）本阶段无来源，位保留：
// const KIND_EXTRA: number = 4;

/** 推导偏好（routemanager.go:106-128 Prefs 子集；ExitNodeSelected 由两 ID 推得）。 */
export interface DerivePrefs {
  /** 被选中的 exit node 的 NodeID；0 = 未选。 */
  exitNodeNodeId: number;
  /** 被选中的 exit node 的 StableNodeID；'' = 未选（与 NodeID 任一匹配即选中）。 */
  exitNodeStableId: string;
  /** 接受所有 peer 的子网路由（非 exit 路由的 kindRoute 进 allowed_ips 的条件）。 */
  routeAll: boolean;
  /** tailnet 配置：禁 IPv4 ⇒ self 的 v4 地址不进 allowed_ips（routemanager.go:828-832）。 */
  disableIPv4: boolean;
}

/** 归一化跳过诊断（routemanager 的 logf 旁路；测试断言用）。 */
export interface DeriveDiagnostics {
  /** host bits 置位被跳过的原始前缀串（"<peerId> <prefix>"）。 */
  skippedHostBitsPrefixes: string[];
}

/** 单 peer 的 WG 配置推导产物。 */
export interface WgPeerDerived {
  /** netmap 侧稳定主键（StableID 优先）。 */
  canonicalId: string;
  /** WG 层 peerId/endpoint = 公钥 64 小写 hex（wgcfg/device.go:30）。 */
  peerId: string;
  /** 静态公钥 32B（WgPeerTable.registerPeer 的入参）。 */
  staticPublic: Uint8Array;
  /** disco 公钥 32B（发现层用；全零 = 无 disco）。 */
  discoKey: Uint8Array;
  /** 进 WG allowed_ips 的前缀（规范化、去重、ComparePrefix 升序）。 */
  allowedIPs: string[];
  /** home DERP region ID（0 = 无；发现层假地址 127.3.3.40:<region>）。 */
  homeDerpRegionId: number;
  /** 候选 UDP 端点（发现层用，绝不进 WG 握手层）。 */
  endpoints: string[];
  isWireGuardOnly: boolean;
  expired: boolean;
  /** SNAT 数据面属性透传（一期不消费；'' = 未下发）。 */
  masqAddr4: string;
  masqAddr6: string;
}

/** 整机推导产物（wgcfg.Config 的 peer 面等价物）。 */
export interface WgDerivedConfig {
  /** 自机接口地址 = SelfNode.Addresses（canonical 字符串，服务器序）。 */
  selfAddresses: string[];
  /** 有 allowed_ips 的 peer（排序与 allowed_ips 同序规则）。 */
  peers: WgPeerDerived[];
}

/** WG 设备差集（routemanager Result / userspace SyncDevicePeer 的操作语义）。 */
export interface WgPeerDiff {
  /** 需登记/更新的 peer（当前不存在，或 allowed_ips 与现状不同）。 */
  upserts: WgPeerDerived[];
  /** 需从 WG 设备移除的 peerId（allowed_ips 清空/剪枝/key 轮换都会体现为移除）。 */
  removals: string[];
}

interface Contribution {
  prefix: IpPrefix;
  kindMask: number;
}

/** 该 peer 是否为当前选中的 exit node（eligible 的 exit 分支条件）。 */
function isSelectedExitNode(peer: NetmapPeerState, prefs: DerivePrefs): boolean {
  if (prefs.exitNodeNodeId !== 0 && peer.nodeId === prefs.exitNodeNodeId) {
    return true;
  }
  if (prefs.exitNodeStableId !== '' && peer.stableId === prefs.exitNodeStableId) {
    return true;
  }
  return false;
}

/**
 * 单 peer 推导（peerViewOf + contribs + eligible + PeerAllowedIPs 的合成）。
 * 返回 null ⇒ 该 peer 不应存在于 WG 设备（两个剪枝或 allowed_ips 为空）。
 */
export function deriveWgPeer(
  peer: NetmapPeerState,
  prefs: DerivePrefs,
  diag: DeriveDiagnostics,
): WgPeerDerived | null {
  // 剪枝一：Expired（routemanager.go:416-418）。
  if (peer.expired) {
    return null;
  }
  // 剪枝二：无 disco 且无 DERP 且非 WireGuardOnly（routemanager.go:419-421）。
  const discoZero: boolean = isZeroKey(peer.discoKey);
  if (discoZero && peer.homeDerp === 0 && !peer.isWireGuardOnly) {
    return null;
  }

  // isSelf 判定要用 Addresses（只参与判定，不直接成为前缀）。
  const addresses: IpPrefix[] = [];
  if (peer.addresses !== null) {
    for (const s of peer.addresses) {
      addresses.push(parsePrefix(s));
    }
  }

  // contribs：去重 map + kind 并集 + 归一化跳过（routemanager.go:668-687）。
  const contribs: Map<string, Contribution> = new Map();
  for (const raw of peer.allowedIPsUpgraded) {
    let p: IpPrefix = parsePrefix(raw);
    p = unmapPrefix(p);
    const masked: IpPrefix = maskedPrefix(p);
    if (!prefixEqual(p, masked)) {
      // host bits 置位 ⇒ 跳过并记录（routemanager.go:677-681，是跳过不是替换）。
      diag.skippedHostBitsPrefixes.push(peer.keyHex + ' ' + prefixToString(p));
      continue;
    }
    const isSelf: boolean =
      (prefixIsSingleIp(p) && isTailscaleIp(p.addr)) || containsPrefixIn(addresses, p);
    const kind: number = isSelf ? KIND_SELF : KIND_ROUTE;
    const key: string = prefixToString(masked);
    const existing: Contribution | undefined = contribs.get(key);
    if (existing === undefined) {
      const c: Contribution = { prefix: masked, kindMask: kind };
      contribs.set(key, c);
    } else {
      existing.kindMask = existing.kindMask | kind;
    }
  }

  // eligible 过滤（routemanager.go:824-841）。
  const eligible: IpPrefix[] = [];
  contribs.forEach((c: Contribution): void => {
    if ((c.kindMask & KIND_SELF) !== 0) {
      if (!(c.prefix.addr.is4 && prefs.disableIPv4)) {
        eligible.push(c.prefix);
        return;
      }
    }
    if ((c.kindMask & KIND_ROUTE) !== 0) {
      if (isExitRoute(c.prefix)) {
        if (isSelectedExitNode(peer, prefs)) {
          eligible.push(c.prefix);
        }
        return;
      }
      if (prefs.routeAll) {
        eligible.push(c.prefix);
      }
    }
    // kindExtra：恒进 allowed_ips（本阶段无来源）；缺失即等价 false。
  });
  if (eligible.length === 0) {
    // 空 ⇒ 该 peer 不应在 WG 设备中存在（routemanager.go:263-266）。
    return null;
  }
  sortPrefixes(eligible);
  const allowed: string[] = [];
  for (const p of eligible) {
    allowed.push(prefixToString(p));
  }
  const derived: WgPeerDerived = {
    canonicalId: peer.stableId !== '' ? peer.stableId : '#' + String(peer.nodeId),
    peerId: hexEncode(peer.key),
    staticPublic: peer.key.slice(),
    discoKey: peer.discoKey.slice(),
    allowedIPs: allowed,
    homeDerpRegionId: peer.homeDerp,
    endpoints: peer.endpoints === null ? [] : peer.endpoints.slice(),
    isWireGuardOnly: peer.isWireGuardOnly,
    expired: peer.expired,
    masqAddr4: peer.masqAddr4,
    masqAddr6: peer.masqAddr6,
  };
  return derived;
}

/** 整机推导：self 接口地址 + 全部 peer。 */
export function deriveWgConfig(state: NetmapState, prefs: DerivePrefs, diag: DeriveDiagnostics): WgDerivedConfig {
  const selfAddresses: string[] = [];
  const self: NetmapPeerState | null = state.self();
  // 自机只取 SelfNode.Addresses（local.go:6100-6110）；SelfNode.AllowedIPs 不进 WG。
  if (self !== null && self.addresses !== null) {
    for (const s of self.addresses) {
      selfAddresses.push(prefixToString(parsePrefix(s)));
    }
  }
  const peers: WgPeerDerived[] = [];
  const all: NetmapPeerState[] = state.allPeers();
  for (const peer of all) {
    const derived: WgPeerDerived | null = deriveWgPeer(peer, prefs, diag);
    if (derived !== null) {
      peers.push(derived);
    }
  }
  const cfg: WgDerivedConfig = { selfAddresses: selfAddresses, peers: peers };
  return cfg;
}

/**
 * WG 设备差集：current = 当前 WG 设备里的 peerId → allowed_ips 投影。
 * upsert：新 peer 或 allowed_ips 变化；removals：desired 之外的现役 peerId
 * （key 轮换 = 旧 id 出现在 removals + 新 id 出现在 upserts —— 三处联动之 WG 层）。
 */
export function diffWgPeers(current: Map<string, string[]>, desired: WgDerivedConfig): WgPeerDiff {
  const upserts: WgPeerDerived[] = [];
  const removals: string[] = [];
  const desiredIds: Map<string, boolean> = new Map();
  for (const peer of desired.peers) {
    desiredIds.set(peer.peerId, true);
    const cur: string[] | undefined = current.get(peer.peerId);
    if (cur === undefined || !stringArrayEqual(cur, peer.allowedIPs)) {
      upserts.push(peer);
    }
  }
  const currentIds: string[] = [];
  current.forEach((_ips: string[], peerId: string): void => {
    currentIds.push(peerId);
  });
  for (const peerId of currentIds) {
    if (!desiredIds.has(peerId)) {
      removals.push(peerId);
    }
  }
  const diff: WgPeerDiff = { upserts: upserts, removals: removals };
  return diff;
}

// ---- 内部工具 ----

function isZeroKey(key: Uint8Array): boolean {
  for (let i: number = 0; i < key.length; i += 1) {
    if (key[i] !== 0) {
      return false;
    }
  }
  return true;
}

function containsPrefixIn(list: IpPrefix[], p: IpPrefix): boolean {
  for (const item of list) {
    if (prefixEqual(item, p)) {
      return true;
    }
  }
  return false;
}

function stringArrayEqual(a: string[], b: string[]): boolean {
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
