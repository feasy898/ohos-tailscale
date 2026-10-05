/**
 * netmap→WireGuard peer 配置推导测试（C1 核心语义钉死）。
 *
 * 锚点：routemanager.go:263-297（PeerAllowedIPs 空 ⇒ 移除）、:387-432（peerViewOf，
 * AllowedIPs 唯一前缀来源 + 两剪枝 + isSelf）、:824-841（eligible）、
 * :655-687（归一化跳过）、tsaddr.go:270-273（exit 精确 /0）、
 * nmcfg.go(v1.48.2):54-133（经典实现交叉验证）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixedClock } from '@ohos-tailscale/common';
import {
  decodeMapResponseFrame,
  deriveWgConfig,
  deriveWgPeer,
  diffWgPeers,
  NetmapState,
  type DerivePrefs,
  type NetmapPeerState,
  type WgPeerDerived,
} from '../src/index.ts';

/** 断言 peer 状态非 null 并返回（避免 postfix 非空断言）。 */
function mustPeerState(v: NetmapPeerState | null): NetmapPeerState {
  assert.notEqual(v, null, 'netmap peer 状态应存在');
  return v as NetmapPeerState;
}

/** 断言非 null 并返回（避免 postfix 非空断言，ArkTS 卫生）。 */
function mustDerived(v: WgPeerDerived | null, what: string): WgPeerDerived {
  assert.notEqual(v, null, what + ' 应可推导');
  return v as WgPeerDerived;
}

/** 显式构造偏好（A27：禁对象展开）。 */
function withRouteAll(routeAll: boolean): DerivePrefs {
  const p: DerivePrefs = {
    exitNodeNodeId: 0,
    exitNodeStableId: '',
    routeAll: routeAll,
    disableIPv4: false,
  };
  return p;
}

const KEY_A: string = 'nodekey:1111111111111111111111111111111111111111111111111111111111111111';
const KEY_B: string = 'nodekey:2222222222222222222222222222222222222222222222222222222222222222';
const KEY_C: string = 'nodekey:3333333333333333333333333333333333333333333333333333333333333333';
const KEY_D: string = 'nodekey:4444444444444444444444444444444444444444444444444444444444444444';
const DISCO_A: string = 'discokey:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/** 带 disco+DERP 的普通 peer（不触发剪枝）。 */
function discoPeer(id: number, keyHex: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ID: id,
    StableID: 'p' + String(id),
    Key: keyHex,
    DiscoKey: DISCO_A,
    HomeDERP: 17,
    Cap: 142,
  };
  const keys: string[] = Object.keys(extra);
  for (const k of keys) {
    base[k] = extra[k];
  }
  return base;
}

const PREFS_PLAIN: DerivePrefs = {
  exitNodeNodeId: 0,
  exitNodeStableId: '',
  routeAll: true,
  disableIPv4: false,
};

function ingest(json: string, wallMs: number = 0): NetmapState {
  const state: NetmapState = new NetmapState();
  state.ingestFrame(decodeMapResponseFrame(json), new FixedClock(wallMs));
  return state;
}

test('self 推导：接口地址只取 SelfNode.Addresses；SelfNode.AllowedIPs 不进 WG 配置', () => {
  // local.go:6100-6110 + netmap.go:91-99（GetAddresses = SelfNode.Addresses）。
  const state: NetmapState = ingest(JSON.stringify({
    Node: {
      ID: 1,
      Key: KEY_A,
      Addresses: ['100.100.0.1/32', 'fd7a:115c:a1e0::1/128'],
      AllowedIPs: ['100.100.0.1/32', 'fd7a:115c:a1e0::1/128', '10.99.0.0/24'],
    },
  }));
  const diag: { skippedHostBitsPrefixes: string[] } = { skippedHostBitsPrefixes: [] };
  const cfg = deriveWgConfig(state, PREFS_PLAIN, diag);
  assert.deepEqual(
    cfg.selfAddresses,
    ['100.100.0.1/32', 'fd7a:115c:a1e0::1/128'],
    '自机只装 Addresses；AllowedIPs 里的 10.99.0.0/24 不得进入',
  );
});

test('allowed_ips：self 地址恒进；子网路由按 RouteAll；AllowedIPs 是唯一前缀来源', () => {
  // Addresses 含 100.100.0.5/32 但 AllowedIPs 没有 ⇒ 不产生前缀（routemanager.go:404 注释）。
  const state: NetmapState = ingest(JSON.stringify({
    Peers: [discoPeer(5, KEY_A, {
      Addresses: ['100.100.0.5/32'],
      AllowedIPs: ['100.100.0.5/32', '10.5.0.0/16'],
    })],
  }));
  const peer: NetmapPeerState | null = state.peerById('p5');
  const diag: { skippedHostBitsPrefixes: string[] } = { skippedHostBitsPrefixes: [] };
  const derived: WgPeerDerived | null = deriveWgPeer(peer!, PREFS_PLAIN, diag);
  assert.notEqual(derived, null);
  assert.deepEqual(
    mustDerived(derived, 'peer').allowedIPs,
    ['10.5.0.0/16', '100.100.0.5/32'],
    'ComparePrefix 序：v4 先按字节（10 < 100），self 与子网路由混排',
  );

  // RouteAll=false ⇒ 子网路由（不在 Addresses 的）剔除、self 保留（eligible kindRoute 分支）。
  const derivedNoRoute: WgPeerDerived | null = deriveWgPeer(mustPeerState(peer), withRouteAll(false), diag);
  assert.deepEqual(
    mustDerived(derivedNoRoute, 'peer(RouterAll=false)').allowedIPs,
    ['100.100.0.5/32'],
    'RouteAll=false ⇒ 只剩 self 地址',
  );

  // AllowedIPs 与 Addresses 都含同一 /16 ⇒ 判 self（Addresses 成员判定在前）⇒ RouteAll=false 仍保留。
  // （上游 peerViewOf：SliceContains(n.Addresses(), aip) 即 self，不问 bits——routemanager.go:422-424。）
  const stateSelf16: NetmapState = ingest(JSON.stringify({
    Peers: [discoPeer(15, KEY_C, {
      Addresses: ['100.100.0.5/32', '10.5.0.0/16'],
      AllowedIPs: ['100.100.0.5/32', '10.5.0.0/16'],
    })],
  }));
  const derivedSelf16: WgPeerDerived | null = deriveWgPeer(
    mustPeerState(stateSelf16.peerById('p15')), withRouteAll(false), diag,
  );
  assert.deepEqual(
    mustDerived(derivedSelf16, 'peer(/16 in Addresses)').allowedIPs,
    ['10.5.0.0/16', '100.100.0.5/32'],
    'AllowedIP ∈ Addresses ⇒ self ⇒ 不受 RouteAll 门控',
  );

  // Addresses 独有的前缀（不在 AllowedIPs）绝不进 allowed_ips。
  const state2: NetmapState = ingest(JSON.stringify({
    Peers: [discoPeer(6, KEY_B, {
      Addresses: ['100.100.0.6/32', '172.16.0.0/12'],
      AllowedIPs: ['100.100.0.6/32'],
    })],
  }));
  const derived2: WgPeerDerived | null = deriveWgPeer(mustPeerState(state2.peerById('p6')), PREFS_PLAIN, diag);
  assert.deepEqual(
    mustDerived(derived2, 'peer2').allowedIPs,
    ['100.100.0.6/32'],
    'Addresses 里的 172.16/12 不在 AllowedIPs ⇒ 不可路由（唯一前缀来源）',
  );
});

test('exit 路由：精确 0.0.0.0/0 与 ::/0 只装被选中的 exit node；0.0.0.0/1 走子网路由', () => {
  const exitJson: string = JSON.stringify({
    Peers: [discoPeer(7, KEY_A, {
      Addresses: ['100.100.0.7/32'],
      AllowedIPs: ['100.100.0.7/32', '0.0.0.0/0', '::/0', '0.0.0.0/1'],
    })],
  });
  const state: NetmapState = ingest(exitJson);
  const peer: NetmapPeerState = mustPeerState(state.peerById('p7'));
  const diag: { skippedHostBitsPrefixes: string[] } = { skippedHostBitsPrefixes: [] };

  // 未选 exit node ⇒ 两条 /0 剔除；0.0.0.0/1 是"半个默认路由"，按子网路由走 RouteAll。
  const none: WgPeerDerived | null = deriveWgPeer(peer, PREFS_PLAIN, diag);
  assert.deepEqual(
    mustDerived(none, 'peer(未选 exit)').allowedIPs,
    ['0.0.0.0/1', '100.100.0.7/32'],
    '未选 exit：/0 双双剔除，0.0.0.0/1 按 RouteAll 保留（tsaddr.go:270-273）',
  );

  // 选中该 peer（StableID 匹配）⇒ /0 双装。
  const selected: WgPeerDerived | null = deriveWgPeer(
    peer,
    { exitNodeNodeId: 0, exitNodeStableId: 'p7', routeAll: false, disableIPv4: false },
    diag,
  );
  assert.deepEqual(
    mustDerived(selected, 'peer(选中 exit)').allowedIPs,
    ['0.0.0.0/0', '100.100.0.7/32', '::/0'],
    '选中 exit node ⇒ 两条 /0 进 allowed_ips（即使 RouteAll=false）',
  );

  // NodeID 匹配同样生效；选中别的 peer ⇒ /0 剔除。
  const other: WgPeerDerived | null = deriveWgPeer(
    peer,
    { exitNodeNodeId: 999, exitNodeStableId: '', routeAll: true, disableIPv4: false },
    diag,
  );
  assert.equal(mustDerived(other, 'peer(exit 是别人)').allowedIPs.indexOf('0.0.0.0/0'), -1, 'exit node 是别人 ⇒ /0 剔除');
});

test('两个剪枝：Expired ⇒ 无前缀；（无 DiscoKey && 无 HomeDERP && 非 WireGuardOnly）⇒ 无前缀', () => {
  const state: NetmapState = ingest(JSON.stringify({
    Peers: [
      discoPeer(1, KEY_A, { Expired: true }),
      {
        ID: 2, StableID: 'p2', Key: KEY_B,
        DiscoKey: 'discokey:0000000000000000000000000000000000000000000000000000000000000000',
        HomeDERP: 0,
        Addresses: ['100.100.0.2/32'],
        AllowedIPs: ['100.100.0.2/32'],
      },
      // WireGuardOnly：无 disco/无 DERP 也能通（靠 Endpoints 直连，endpoint.go:590-595）。
      {
        ID: 3, StableID: 'p3', Key: KEY_C,
        IsWireGuardOnly: true,
        Endpoints: ['198.51.100.30:51820'],
        Addresses: ['203.0.113.77/32'],
        AllowedIPs: ['203.0.113.77/32', '10.9.0.0/16'],
      },
    ],
  }));
  const diag: { skippedHostBitsPrefixes: string[] } = { skippedHostBitsPrefixes: [] };
  assert.equal(deriveWgPeer(mustPeerState(state.peerById('p1')), PREFS_PLAIN, diag), null, 'Expired ⇒ 不产生 allowed_ips');
  assert.equal(deriveWgPeer(mustPeerState(state.peerById('p2')), PREFS_PLAIN, diag), null, '无 disco+无 DERP+非 WG-only ⇒ 剪枝');
  // 剪枝不从 netmap 删状态（复活保留）。
  assert.notEqual(state.peerById('p2'), null, '被剪枝的 peer 仍在 netmap 状态（routemanager.go:397-402）');

  const wgOnly: WgPeerDerived | null = deriveWgPeer(mustPeerState(state.peerById('p3')), PREFS_PLAIN, diag);
  assert.notEqual(wgOnly, null, 'IsWireGuardOnly 绕过第二剪枝');
  // 10.9.0.0/16 属子网路由 ⇒ RouteAll=true 时保留。
  assert.deepEqual(mustDerived(wgOnly, 'peer(WireGuardOnly)').allowedIPs, ['10.9.0.0/16', '203.0.113.77/32']);
});

test('AllowedIPs 显式 [] ⇒ 推导 null ⇒ peer 从 WG 设备移除（不删 netmap 状态）', () => {
  // routemanager.go:263-266：无前缀 ⇒ ok=false ⇒ 不应在 WG 设备存在。
  const state: NetmapState = ingest(JSON.stringify({
    Peers: [discoPeer(9, KEY_A, { AllowedIPs: [] })],
  }));
  const diag: { skippedHostBitsPrefixes: string[] } = { skippedHostBitsPrefixes: [] };
  assert.equal(deriveWgPeer(mustPeerState(state.peerById('p9')), PREFS_PLAIN, diag), null, '空 allowed_ips ⇒ null');
  assert.notEqual(state.peerById('p9'), null, 'netmap 状态保留');
});

test('归一化：host bits 置位的前缀跳过并记诊断；重复前缀去重', () => {
  // routemanager.go:677-681：跳过（不是替换）。
  const state: NetmapState = ingest(JSON.stringify({
    Peers: [discoPeer(4, KEY_A, {
      Addresses: ['100.100.0.4/32'],
      AllowedIPs: ['100.100.0.4/32', '100.100.0.4/32', '10.1.2.3/24', 'fd7a:115c:a1e0::9/128'],
    })],
  }));
  const diag: { skippedHostBitsPrefixes: string[] } = { skippedHostBitsPrefixes: [] };
  const derived: WgPeerDerived | null = deriveWgPeer(mustPeerState(state.peerById('p4')), PREFS_PLAIN, diag);
  assert.equal(diag.skippedHostBitsPrefixes.length, 1, '10.1.2.3/24 host bits 置位 ⇒ 跳过 1 条');
  assert.equal(diag.skippedHostBitsPrefixes[0].indexOf('10.1.2.3/24') >= 0, true, '诊断记录原始前缀');
  assert.deepEqual(
    mustDerived(derived, 'peer').allowedIPs,
    ['100.100.0.4/32', 'fd7a:115c:a1e0::9/128'],
    '重复 100.100.0.4/32 去重；v4 在前 v6 在后',
  );
});

test('isSelf：单 IP 判 TailscaleIP（含 CGNAT 子网例外）；非单 IP 落 Addresses 才算 self', () => {
  const state: NetmapState = ingest(JSON.stringify({
    Peers: [discoPeer(8, KEY_A, {
      Addresses: ['100.100.0.8/32'],
      AllowedIPs: ['100.100.0.8/32', '100.64.0.0/10', '192.168.1.1/32'],
    })],
  }));
  const diag: { skippedHostBitsPrefixes: string[] } = { skippedHostBitsPrefixes: [] };
  const derived: WgPeerDerived | null = deriveWgPeer(mustPeerState(state.peerById('p8')), withRouteAll(false), diag);
  // 100.100.0.8/32 单 IP TailscaleIP ⇒ self（恒进）；100.64.0.0/10 是子网 ⇒ RouteAll 门控；
  // 192.168.1.1/32 单 IP 但非 Tailscale IP ⇒ 子网路由（子网中的单 IP 不算 self，C1 §7-5）。
  assert.deepEqual(mustDerived(derived, 'peer').allowedIPs, ['100.100.0.8/32'], 'RouteAll=false ⇒ 只剩 self');
  const withRoute: WgPeerDerived | null = deriveWgPeer(mustPeerState(state.peerById('p8')), PREFS_PLAIN, diag);
  assert.deepEqual(
    mustDerived(withRoute, 'peer(RouteAll)').allowedIPs,
    ['100.64.0.0/10', '100.100.0.8/32', '192.168.1.1/32'],
    'RouteAll=true ⇒ CGNAT 大段与 192.168.1.1/32（非 self 单 IP）按子网路由进',
  );
});

test('DisableIPv4（tailnet 配置）⇒ self 的 v4 地址不进 allowed_ips；v6 不受影响', () => {
  const state: NetmapState = ingest(JSON.stringify({
    Peers: [discoPeer(2, KEY_A, {
      Addresses: ['100.100.0.2/32', 'fd7a:115c:a1e0::2/128'],
      AllowedIPs: ['100.100.0.2/32', 'fd7a:115c:a1e0::2/128'],
    })],
  }));
  const diag: { skippedHostBitsPrefixes: string[] } = { skippedHostBitsPrefixes: [] };
  const derived: WgPeerDerived | null = deriveWgPeer(
    mustPeerState(state.peerById('p2')),
    { exitNodeNodeId: 0, exitNodeStableId: '', routeAll: true, disableIPv4: true },
    diag,
  );
  assert.deepEqual(mustDerived(derived, 'peer').allowedIPs, ['fd7a:115c:a1e0::2/128'], 'DisableIPv4 ⇒ 只剩 v6 self');
});

test('MasqAddr 透传记录：是 SNAT 数据面属性，不混入 allowed_ips/endpoints', () => {
  const state: NetmapState = ingest(JSON.stringify({
    Peers: [discoPeer(3, KEY_A, {
      Addresses: ['100.100.0.3/32'],
      AllowedIPs: ['100.100.0.3/32'],
      SelfNodeV4MasqAddrForThisPeer: '100.100.0.3',
    })],
  }));
  const diag: { skippedHostBitsPrefixes: string[] } = { skippedHostBitsPrefixes: [] };
  const derived: WgPeerDerived | null = deriveWgPeer(mustPeerState(state.peerById('p3')), PREFS_PLAIN, diag);
  assert.equal(mustDerived(derived, 'peer').masqAddr4, '100.100.0.3', '透传记录');
  assert.equal(mustDerived(derived, 'peer').allowedIPs.indexOf('100.100.0.3'), -1, '不进 allowed_ips');
});

test('diffWgPeers：新增/allowed_ips 变化 ⇒ upsert；消失/剪枝/key 轮换 ⇒ removal', () => {
  const state: NetmapState = ingest(JSON.stringify({
    Peers: [
      discoPeer(1, KEY_A, { Addresses: ['100.100.0.1/32'], AllowedIPs: ['100.100.0.1/32'] }),
      discoPeer(2, KEY_B, { Addresses: ['100.100.0.2/32'], AllowedIPs: ['100.100.0.2/32', '10.0.0.0/8'] }),
    ],
  }));
  const diag: { skippedHostBitsPrefixes: string[] } = { skippedHostBitsPrefixes: [] };
  const cfg = deriveWgConfig(state, PREFS_PLAIN, diag);
  assert.equal(cfg.peers.length, 2);

  // 初始：空设备 ⇒ 两个 upsert。
  const empty: Map<string, string[]> = new Map();
  const d1 = diffWgPeers(empty, cfg);
  assert.equal(d1.upserts.length, 2);
  assert.equal(d1.removals.length, 0);

  // 现状一致 ⇒ 无操作。
  const current: Map<string, string[]> = new Map();
  for (const p of cfg.peers) {
    current.set(p.peerId, p.allowedIPs);
  }
  const d2 = diffWgPeers(current, cfg);
  assert.equal(d2.upserts.length, 0, 'allowed_ips 未变 ⇒ 不动');
  assert.equal(d2.removals.length, 0);

  // p2 剪枝（AllowedIPs 清空）+ p3 新增（独立 key）+ p1 key 轮换（KEY_A→KEY_C 同 NodeID）。
  const state2: NetmapState = ingest(JSON.stringify({
    Peers: [
      discoPeer(1, KEY_C, { Addresses: ['100.100.0.1/32'], AllowedIPs: ['100.100.0.1/32'] }),
      discoPeer(3, KEY_D, { Addresses: ['100.100.0.3/32'], AllowedIPs: ['100.100.0.3/32'] }),
    ],
  }));
  const cfg2 = deriveWgConfig(state2, PREFS_PLAIN, diag);
  const d3 = diffWgPeers(current, cfg2);
  const removalSet: string[] = d3.removals;
  assert.equal(removalSet.length, 2, 'p2 剪枝 + p1 旧 key 都表现为移除');
  assert.equal(removalSet.indexOf('1111111111111111111111111111111111111111111111111111111111111111') >= 0, true, '旧 key peerId 移除');
  assert.equal(removalSet.indexOf('2222222222222222222222222222222222222222222222222222222222222222') >= 0, true, '剪枝 peer 的 peerId 移除');
  assert.equal(d3.upserts.length, 2, 'p1 新 key + p3 新增');
  // 联动次序契约：调用方必须先 remove 旧 peerId 再 register 新 key（C1 §7-9）。
});

test('整机推导：peer 列表内 allowed_ips 一致排序；endpoints/homeDerp 供发现层', () => {
  const state: NetmapState = ingest(JSON.stringify({
    Peers: [
      discoPeer(1, KEY_A, {
        Addresses: ['100.100.0.1/32'],
        AllowedIPs: ['100.100.0.1/32'],
        Endpoints: ['203.0.113.10:41641'],
        HomeDERP: 17,
      }),
    ],
  }));
  const diag: { skippedHostBitsPrefixes: string[] } = { skippedHostBitsPrefixes: [] };
  const cfg = deriveWgConfig(state, PREFS_PLAIN, diag);
  assert.equal(cfg.peers.length, 1);
  const p: WgPeerDerived = cfg.peers[0];
  assert.equal(p.peerId, '1111111111111111111111111111111111111111111111111111111111111111', 'peerId = 公钥 64hex（WG 层 endpoint）');
  assert.equal(p.staticPublic.length, 32, '静态公钥 32B（WgPeerTable.registerPeer 入参）');
  assert.deepEqual(p.allowedIPs, ['100.100.0.1/32']);
  assert.equal(p.homeDerpRegionId, 17, 'home DERP region 提供给发现层（127.3.3.40:17 假地址语义）');
  assert.deepEqual(p.endpoints, ['203.0.113.10:41641'], 'endpoints 只进发现层，绝不进 WG 握手层');
});
