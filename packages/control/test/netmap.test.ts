/**
 * netmap 解码与状态存储测试：MapResponse 三态解码、upgradeNode、全量/增量裁决、
 * PeersChangedPatch、过期防御、knob 派生。
 *
 * 语义锚点（v1.102.3 实拉 2026-10-02）：
 * - control/controlclient/map.go:384-416（upgradeNode）、:790-812（裁决）、
 *   :853-901（patch）、:418-421（disable-delta-updates）、:299-307（Capabilities 并集）；
 * - ipn/ipnlocal/expiry.go:20-33, 65-135（clockDelta/epoch/flagExpiredPeers）；
 * - ts-main/key-node.go:224-237（badOldPrefix）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixedClock } from '@ohos-tailscale/common';
import {
  ControlError,
  ControlKnobs,
  decodeMapResponseFrame,
  breakKeyWithBadOldPrefix,
  canonicalPeerId,
  mergeLegacyCapabilities,
  NetmapState,
  NodeAttrName,
  capMapContains,
  parseNodeAttrName,
  type MapResponseNode,
  type NetmapPeerState,
} from '../src/index.ts';

/** 取 peer 状态（null 即断言失败；避免 postfix 非空断言，ArkTS 卫生）。 */
function mustPeer(state: NetmapState, id: string): NetmapPeerState {
  const p: NetmapPeerState | null = state.peerById(id);
  assert.notEqual(p, null, 'peer ' + id + ' 应存在');
  return p as NetmapPeerState;
}

/** 取帧的 Peers 数组（同上）。 */
function mustPeers(f: ReturnType<typeof decodeMapResponseFrame>): MapResponseNode[] {
  assert.notEqual(f.peers, null, '帧应带 Peers 数组');
  return f.peers as MapResponseNode[];
}

const KEY_HEX_A: string = 'nodekey:6a204c5c19842d5e2bf1d8a255cd2e542501e58c0b091f12f0a3e8d1c68193d2';
const KEY_HEX_B: string = 'nodekey:2b5e5c9e0a1f4c3d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d';
const DISCO_HEX_A: string = 'discokey:1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70819283a4b5c6d7e8f9';

/** 构造最小合法 peer JSON。 */
function peerJson(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ID: id,
    StableID: 'n' + String(id),
    Key: KEY_HEX_A,
    DiscoKey: DISCO_HEX_A,
    Addresses: ['100.100.0.' + String(id) + '/32'],
    AllowedIPs: ['100.100.0.' + String(id) + '/32'],
    Endpoints: ['203.0.113.10:41641'],
    HomeDERP: 17,
    Cap: 142,
  };
  const keys: string[] = Object.keys(overrides);
  for (const k of keys) {
    base[k] = overrides[k];
  }
  return base;
}

test('帧解码：AllowedIPs 三态区分——缺失/null ⇒ 视同 Addresses，[] ⇒ 显式空', () => {
  // map.go:406-407：nil ⇒ slices.Clone(Addresses)；[] 保持空（C1 §7-1）。
  const absent: string = JSON.stringify({ Peers: [peerJson(1, { AllowedIPs: undefined })] });
  // 直接构造 null 值 JSON（对象字面量无法表达 null 字段）：
  const nullField: string = '{"Peers":[{"ID":1,"StableID":"n1","Key":"' + KEY_HEX_A +
    '","DiscoKey":"' + DISCO_HEX_A + '","Addresses":["100.100.0.1/32"],"AllowedIPs":null,"HomeDERP":17}]}';
  const explicitEmpty: string = JSON.stringify({ Peers: [peerJson(1, { AllowedIPs: [] })] });

  const fAbsent = decodeMapResponseFrame(absent);
  const fNull = decodeMapResponseFrame(nullField);
  const fEmpty = decodeMapResponseFrame(explicitEmpty);

  assert.equal(mustPeers(fAbsent)[0].allowedIPs, null, '字段缺失 ⇒ null（未 upgrade 前的三态保留）');
  assert.equal(mustPeers(fNull)[0].allowedIPs, null, 'JSON null ⇒ null');
  assert.deepEqual(mustPeers(fEmpty)[0].allowedIPs, [], 'JSON [] ⇒ 显式空数组，语义与 null 不同');
});

test('帧解码：非法输入拒绝——坏 key 前缀/坏 hex/bits 越界/bad RFC3339 → ControlError(HTTP)', () => {
  const badKey: string = JSON.stringify({ Peers: [peerJson(1, { Key: 'bogus:1234' })] });
  assert.throws(
    () => decodeMapResponseFrame(badKey),
    (e: Error) => e instanceof ControlError && e.code === 'HTTP',
    'Key 必须是 "nodekey:<64hex>"',
  );
  const badPrefix: string = JSON.stringify({ Peers: [peerJson(1, { AllowedIPs: ['100.100.0.1/33'] })] });
  assert.throws(() => decodeMapResponseFrame(badPrefix), /out of range/, 'bits 越界在解码层抛出');
  const badTime: string = JSON.stringify({ Peers: [peerJson(1, { KeyExpiry: 'not-a-time' })] });
  assert.throws(() => decodeMapResponseFrame(badTime), /RFC3339/, '非法 KeyExpiry 抛解码错');
});

test('upgradeNode：legacy "DERP":"127.3.3.40:9" 并入 HomeDERP 并清空（headscale 老版本兼容）', () => {
  const state: NetmapState = new NetmapState();
  const clock: FixedClock = new FixedClock(1000000);
  // 仅 legacy 字段（HomeDERP 缺省 0）⇒ 解析出 region 9（map.go:388-401）。
  state.ingestFrame(decodeMapResponseFrame(JSON.stringify({
    Peers: [peerJson(1, { HomeDERP: 0, DERP: '127.3.3.40:9' })],
  })), clock);
  const peer: NetmapPeerState = mustPeer(state, 'n1');
  assert.equal(peer.homeDerp, 9, 'HomeDERP==0 时 legacy DERP 解析为 region 9');
  assert.equal(peer.legacyDerp, '', 'legacy 字段升级后清掉');

  // HomeDERP 已非零时 legacy 不覆盖，但仍被清空（map.go:389-401 的结构：
  // 解析仅在 HomeDERP==0 分支，清空在块尾无条件执行）。
  state.ingestFrame(decodeMapResponseFrame(JSON.stringify({
    Peers: [peerJson(2, { HomeDERP: 17, DERP: '127.3.3.40:9' })],
  })), clock);
  const peer2: NetmapPeerState = mustPeer(state, 'n2');
  assert.equal(peer2.homeDerp, 17, 'HomeDERP 非零 ⇒ 不被 legacy 覆盖');
  assert.equal(peer2.legacyDerp, '', 'legacy 字段仍然清空');
});

test('upgradeNode：UnsignedPeerAPIOnly ⇒ AllowedIPs 钳为 Addresses（map.go:410-414）', () => {
  const state: NetmapState = new NetmapState();
  const frame: string = JSON.stringify({
    Peers: [peerJson(1, {
      UnsignedPeerAPIOnly: true,
      AllowedIPs: ['100.100.0.1/32', '10.0.0.0/24'],
    })],
  });
  state.ingestFrame(decodeMapResponseFrame(frame), new FixedClock(0));
  const peer = state.peerById('n1');
  assert.deepEqual(
    mustPeer(state, 'n1').allowedIPsUpgraded,
    ['100.100.0.1/32'],
    '未签名 peerAPI 节点不允许被授予子网路由，AllowedIPs 强制=Addresses',
  );
});

test('全量帧裁决：Peers 非空 ⇒ 全量替换（keep-set 外全删）且忽略其他 delta', () => {
  // map.go:790-812 "Peers precludes all other delta operations"。
  const state: NetmapState = new NetmapState();
  const clock: FixedClock = new FixedClock(0);
  state.ingestFrame(decodeMapResponseFrame(JSON.stringify({ Peers: [peerJson(1), peerJson(2)] })), clock);
  assert.equal(state.peerCount(), 2);

  // 全量帧只含 peer1，且同帧携带 OnlineChange/patch（必须被忽略）。
  const full: string = JSON.stringify({
    Peers: [peerJson(1, { Online: true })],
    OnlineChange: { '2': true },
    PeersChangedPatch: { '2': { DERPRegion: 3 } },
  });
  const outcome = state.ingestFrame(decodeMapResponseFrame(full), clock);
  assert.equal(outcome.fullRebuild, true, 'Peers 非空 ⇒ fullRebuild');
  assert.equal(state.peerCount(), 1, 'keep-set 之外的 peer2 被删除');
  assert.equal(state.peerById('n2'), null);
  const p1: NetmapPeerState = mustPeer(state, 'n1');
  assert.equal(p1.online, true, '全量帧自身字段生效');
});

test('增量裁决顺序：PeersRemoved → PeersChanged → Seen → Online → Patch', () => {
  const state: NetmapState = new NetmapState();
  const clock: FixedClock = new FixedClock(0);
  state.ingestFrame(decodeMapResponseFrame(JSON.stringify({ Peers: [peerJson(1), peerJson(2), peerJson(3)] })), clock);

  const delta: string = JSON.stringify({
    PeersRemoved: [2],
    PeersChanged: [peerJson(3, { Endpoints: ['198.51.100.20:41641'] })],
    OnlineChange: { '3': true },
    PeerSeenChange: { '3': true },
    PeersChangedPatch: {
      '1': { DERPRegion: 5, Endpoints: ['203.0.113.99:1'], Online: false },
      '99': { DERPRegion: 7 },
    },
  });
  const outcome = state.ingestFrame(decodeMapResponseFrame(delta), clock);
  assert.equal(outcome.fullRebuild, false, '纯增量帧不触发全量重建');
  assert.equal(outcome.removedCount, 1, 'PeersRemoved 删除 1 个');
  assert.equal(state.peerById('n2'), null);
  const p1: NetmapPeerState = mustPeer(state, 'n1');
  assert.equal(p1.homeDerp, 5, 'patch DERPRegion ⇒ HomeDERP（map.go:860-862）');
  assert.deepEqual(p1.endpoints, ['203.0.113.99:1'], 'patch Endpoints 非空 ⇒ 整体替换（map.go:866-868）');
  assert.equal(p1.online, false, 'patch Online 指针语义：false 也是有效替换（map.go:884-886）');
  const p3: NetmapPeerState = mustPeer(state, 'n3');
  assert.deepEqual(p3.endpoints, ['198.51.100.20:41641'], 'PeersChanged 整 Node 覆盖');
  assert.equal(p3.online, true, 'OnlineChange 只改 Online');
  assert.notEqual(p3.lastSeenRfc3339, '', 'PeerSeenChange seen ⇒ 记 LastSeen');
  assert.equal(outcome.touched.indexOf('n1') >= 0, true, 'patch 命中的 peer 记入 touched');
  assert.equal(outcome.touched.indexOf('99'), -1, '未知 NodeID 的 patch 直接忽略（map.go:854-857）');
});

test('patch：Key/DiscoKey/KeyExpiry 字段级替换（key 轮换联动入口）', () => {
  const state: NetmapState = new NetmapState();
  const clock: FixedClock = new FixedClock(0);
  state.ingestFrame(decodeMapResponseFrame(JSON.stringify({ Peers: [peerJson(1)] })), clock);
  const patch: string = JSON.stringify({
    PeersChangedPatch: {
      '1': { Key: KEY_HEX_B, KeyExpiry: '2030-01-01T00:00:00Z' },
    },
  });
  state.ingestFrame(decodeMapResponseFrame(patch), clock);
  const p1: NetmapPeerState = mustPeer(state, 'n1');
  assert.equal(p1.keyHex, KEY_HEX_B, 'patch.Key 非 nil ⇒ 公钥替换（map.go:870-872）');
  assert.equal(p1.keyExpiryRfc3339, '2030-01-01T00:00:00Z', 'patch.KeyExpiry ⇒ 过期时间替换');
});

test('过期防御：KeyExpiry ≤ controlNow ⇒ Expired + 清端点/home + badOldPrefix 破坏公钥', () => {
  // expiry.go:80-135：flagExpiredPeers 每帧执行；peer 不从状态删除。
  const state: NetmapState = new NetmapState();
  const clock: FixedClock = new FixedClock(1000000);
  state.ingestFrame(
    decodeMapResponseFrame(JSON.stringify({
      Peers: [peerJson(1, { KeyExpiry: '2030-01-01T00:00:00Z' }), peerJson(2)],
    })),
    clock,
  );
  // 推进到过期之后（挂钟轴）。
  clock.setWallMs(Date.parse('2030-01-01T00:00:01Z'));
  const expiredCount: number = state.flagExpiredPeers(clock);
  assert.equal(expiredCount, 1, '恰好一个 peer 过期');
  // mustPeer 断言 n1 仍在状态中 ⇒ 过期 peer 不从 netmap 删除（离线保留，protocol-notes §2.3）。
  const p1: NetmapPeerState = mustPeer(state, 'n1');
  assert.equal(p1.expired, true);
  assert.deepEqual(p1.endpoints, [], '过期清 Endpoints（expiry.go:122-126）');
  assert.equal(p1.homeDerp, 0, '过期清 HomeDERP');
  const rawKey: Uint8Array = p1.key;
  assert.deepEqual(
    Array.from(rawKey.slice(0, 6)),
    [109, 167, 116, 213, 215, 116],
    '公钥前 6 字节被替换为 badOldPrefix（key-node.go:229；C1 §1.3 纵深防御）',
  );
  assert.equal(mustPeer(state, 'n2').expired, false, '未设 KeyExpiry 的 peer 不受影响');
});

test('ControlTime：差 >1min 记 clockDelta，过期判定随之偏移；早于 epoch 忽略', () => {
  const state: NetmapState = new NetmapState();
  const clock: FixedClock = new FixedClock(Date.parse('2030-01-01T00:00:00Z'));
  // 控制面时钟快 10 分钟 ⇒ 本地 00:00 等价 controlNow 00:10。
  state.ingestFrame(
    decodeMapResponseFrame(JSON.stringify({
      ControlTime: '2030-01-01T00:10:00Z',
      Peers: [peerJson(1, { KeyExpiry: '2030-01-01T00:05:00Z' })],
    })),
    clock,
  );
  assert.equal(state.clockDelta(), 600000, 'delta = ControlTime - 本地 = +10min');
  assert.equal(mustPeer(state, 'n1').expired, true, 'controlNow(00:10) 已过 KeyExpiry(00:05) ⇒ 过期');

  // 差 <1min ⇒ delta 归零（expiry.go:70-73）。
  const state2: NetmapState = new NetmapState();
  const clock2: FixedClock = new FixedClock(Date.parse('2030-01-01T00:00:00Z'));
  state2.ingestFrame(
    decodeMapResponseFrame(JSON.stringify({
      ControlTime: '2030-01-01T00:00:30Z',
      Peers: [peerJson(1, { KeyExpiry: '2030-01-01T00:05:00Z' })],
    })),
    clock2,
  );
  assert.equal(state2.clockDelta(), 0, '30s 差 < 1min ⇒ delta=0');
  assert.equal(mustPeer(state2, 'n1').expired, false);

  // 早于 epoch（2023-01-10）的 ControlTime 忽略（expiry.go:18-23）。
  const state3: NetmapState = new NetmapState();
  const clock3: FixedClock = new FixedClock(1000);
  state3.ingestFrame(
    decodeMapResponseFrame(JSON.stringify({ ControlTime: '1999-01-01T00:00:00Z' })),
    clock3,
  );
  assert.equal(state3.clockDelta(), 0, 'epoch 之前的 ControlTime 不采信');
});

test('nextExpiryWallMs：最近过期时刻（供调用方在 +10s 处排重查，local.go:1856-1858）', () => {
  const state: NetmapState = new NetmapState();
  state.ingestFrame(
    decodeMapResponseFrame(JSON.stringify({
      Peers: [
        peerJson(1, { KeyExpiry: '2030-06-01T00:00:00Z' }),
        peerJson(2, { KeyExpiry: '2030-03-01T00:00:00Z' }),
      ],
    })),
    new FixedClock(0),
  );
  assert.equal(state.nextExpiryWallMs(), Date.parse('2030-03-01T00:00:00Z'), '取最近者');
});

test('knob 派生：只从 self Node.CapMap，peer CapMap 永不参与（map.go:307）', () => {
  const state: NetmapState = new NetmapState();
  const frame: string = JSON.stringify({
    Node: {
      ID: 1,
      Key: KEY_HEX_A,
      Capabilities: [],
      CapMap: { 'disable-delta-updates': [], 'one-cgnat?v=true': [] },
    },
    Peers: [peerJson(1, { CapMap: { 'disable-delta-updates': [] } })],
  });
  const outcome = state.ingestFrame(decodeMapResponseFrame(frame), new FixedClock(0));
  assert.equal(state.knobs.disableDeltaUpdates, true, 'self CapMap ⇒ knob');
  assert.equal(state.knobs.oneCGNAT, true, 'one-cgnat?v=true ⇒ tri-state true');
  assert.equal(outcome.fullRebuild, true, 'disable-delta-updates ⇒ 整帧按全量重建（map.go:418-421）');

  // 无 self Node 的增量帧：knob 保持（零值=不变）。
  const delta: string = JSON.stringify({ Peers: [peerJson(2)] });
  state.ingestFrame(decodeMapResponseFrame(delta), new FixedClock(0));
  assert.equal(state.knobs.disableDeltaUpdates, true, '无 Node 帧 knob 不变');

  // 新 self Node 不再下发该 knob ⇒ 重算为关（UpdateFromNodeAttributes 全量重算语义）。
  const frame2: string = JSON.stringify({
    Node: { ID: 1, Key: KEY_HEX_A, CapMap: {} },
  });
  state.ingestFrame(decodeMapResponseFrame(frame2), new FixedClock(0));
  assert.equal(state.knobs.disableDeltaUpdates, false, '属性缺失 ⇒ 关闭（controlknobs.go:145-213）');
  assert.equal(state.knobs.oneCGNAT, null, 'one-cgnat 未下发 ⇒ tri-state null');
});

test('旧服务器 Capabilities 并集进 CapMap（map.go:299-306）', () => {
  const merged = mergeLegacyCapabilities(
    { 'existing-cap': ['[]'] },
    ['legacy-cap', 'existing-cap'],
  );
  assert.equal(capMapContains(merged, 'legacy-cap'), true, 'legacy 能力并入');
  assert.equal(capMapContains(merged, 'existing-cap'), true, '已有能力不被覆盖');
  assert.deepEqual(merged!['existing-cap'], ['[]'], '已有 value 保留');
  assert.equal(new ControlKnobs().disableDeltaUpdates, false, '默认全关（oracle control-knobs 全 false）');
  assert.equal(parseNodeAttrName(NodeAttrName.DisableDeltaUpdates), NodeAttrName.DisableDeltaUpdates, '已知短名校验通过');
  assert.equal(parseNodeAttrName('https://evil.example/not-a-knob'), null, '未知串校验拒绝');
});

test('canonicalPeerId：StableID 优先；NodeID 索引兜底（2^53 精度边界备注）', () => {
  assert.equal(canonicalPeerId('srv-7', 42), 'srv-7', '有 StableID 用字符串主键');
  assert.equal(canonicalPeerId('', 42), '#42', '无 StableID 用 NodeID 派生键');
  assert.equal(breakKeyWithBadOldPrefix(new Uint8Array(32)).length, 32, '破钥函数返回 32B');
});

test('DERPMap/PacketFilter 存在性仅探不解（边界标注）', () => {
  const frame = decodeMapResponseFrame(JSON.stringify({
    DERPMap: { Regions: {} },
    PacketFilter: [],
    Peers: [],
  }));
  assert.equal(frame.derpMapPresent, true);
  assert.equal(frame.packetFilterPresent, true);
  assert.equal(frame.keepAlive, false);
});
