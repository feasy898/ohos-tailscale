/**
 * netcheck 引擎状态机测试：FixedClock 驱动 + 确定性对端（TestPeer 充当 app 侧
 * UDP 桥的极小同构物——发送即按脚本回包，回包经真实 stunResponse 编码喂
 * onPacket，端到端过 stun.ts 线格式）。
 *
 * 语义锚定（2026-10-02 实拉 @3ce5e209971d）：
 * - 组内回包即停同组（netcheck.go:1619-1624）、probeWouldHelp 早停（:645-673/:1603-1606）；
 * - 3-region 早停定时器 max×2（全量）/×1（增量）（:694-706）、3s STUN 截止（:62-66）；
 * - MappingVariesByDestIP 三态守卫（:727-733）、GlobalV4 首见/GlobalV6 末见（:715,:724-727）；
 * - TestMultiGlobalAddressMapping（netcheck_test.go:81-109）、
 *   TestSTUNResponseProvesCanSend（:111-131）向量原样移植；
 * - hairpin 迟到回声静默忽略（:331-341）；UDP 全败回退判定与合并（:1003-1058）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayRng, FixedClock, hexEncode } from '@ohos-tailscale/common';
import {
  NetcheckEngine,
  NetcheckError,
  NetcheckReport,
  PHASE_END,
  REPORT_TIMEOUT_MS,
  STUN_PROBE_TIMEOUT_MS,
  ICMP_PROBE_TIMEOUT_MS,
  HTTPS_PROBE_TIMEOUT_MS,
  OptBool,
  StunTransaction,
  stunRequest,
  stunResponse,
  stunTxid,
  type DnsLookupResult,
  type DnsResolver,
  type EngineConfig,
  type GetReportOpts,
  type NetAddr,
  type NetcheckDerpMap,
  type NetcheckNode,
  type NetcheckRegion,
  type PortMapResult,
  type PortMapperProbe,
  type StunSender,
} from '../src/index.ts';

/** 确定性 TxID 池（240B = 20 个互异 TxID，避免 inFlight 键碰撞）。 */
function makeRngPool(): Uint8Array {
  const out: Uint8Array = new Uint8Array(240);
  for (let i: number = 0; i < 240; i += 1) {
    out[i] = i & 0xff;
  }
  return out;
}

function v4(bytes: number[], port: number): NetAddr {
  const ip: Uint8Array = new Uint8Array(4);
  for (let i: number = 0; i < 4; i += 1) {
    ip[i] = bytes[i];
  }
  const a: NetAddr = { ip: ip, port: port };
  return a;
}

function v6(bytes: number[], port: number): NetAddr {
  const ip: Uint8Array = new Uint8Array(16);
  for (let i: number = 0; i < 16; i += 1) {
    ip[i] = bytes[i];
  }
  const a: NetAddr = { ip: ip, port: port };
  return a;
}

function addrStr(a: NetAddr): string {
  return hexEncode(a.ip) + ':' + String(a.port);
}

function mkNode(name: string, regionId: number, ipv4: string, ipv6: string): NetcheckNode {
  return { name: name, regionId: regionId, hostName: name + '.invalid', ipv4: ipv4, ipv6: ipv6, stunPort: 0, stunOnly: false, stunTestIp: '' };
}

function mkRegion(regionId: number, nodes: NetcheckNode[]): NetcheckRegion {
  return { regionId: regionId, regionCode: 'r' + String(regionId), nodes: nodes, noMeasureNoHome: false, avoid: false };
}

function mkMap(regions: NetcheckRegion[]): NetcheckDerpMap {
  const m: NetcheckDerpMap = { regions: regions, regionScore: null };
  return m;
}

/** 每次发送的回包脚本项；ep=null = 该发无回包（超时路径）。 */
interface ReplyScriptEntry {
  rttMs: number;
  ep: NetAddr | null;
}

interface PendingReply {
  dueMs: number;
  resp: Uint8Array;
  src: NetAddr;
}

class TestPeer implements StunSender {
  private readonly clock: FixedClock;
  private script: ReplyScriptEntry[] = [];
  private scriptIdx: number = 0;
  public sends: number[] = [];
  public dests: string[] = [];
  private pending: PendingReply[] = [];

  constructor(clock: FixedClock, script: Array<NetAddr | null>, rttMs: number = 10) {
    this.clock = clock;
    for (const ep of script) {
      const e: ReplyScriptEntry = { rttMs: rttMs, ep: ep };
      this.script.push(e);
    }
  }

  public sendPacket(data: Uint8Array, dest: NetAddr): number {
    const at: number = this.clock.monotonicMs();
    this.sends.push(at);
    this.dests.push(addrStr(dest));
    const entry: ReplyScriptEntry | undefined = this.script[this.scriptIdx];
    this.scriptIdx += 1;
    if (entry !== undefined && entry.ep !== null) {
      const pr: PendingReply = {
        dueMs: at + entry.rttMs,
        resp: stunResponse(stunTxid(data), entry.ep.ip, entry.ep.port),
        src: dest,
      };
      this.pending.push(pr);
    }
    return data.length;
  }

  /** 换下一场的回包脚本（引擎与 peer 同寿命，sender 固定）。 */
  public setScript(script: Array<NetAddr | null>, rttMs: number = 10): void {
    this.script = [];
    for (const ep of script) {
      const e: ReplyScriptEntry = { rttMs: rttMs, ep: ep };
      this.script.push(e);
    }
    this.scriptIdx = 0;
  }

  public nextReplyDueMs(): number | null {
    let next: number | null = null;
    for (const p of this.pending) {
      if (next === null || p.dueMs < next) {
        next = p.dueMs;
      }
    }
    return next;
  }

  public drainDueReplies(engine: NetcheckEngine): void {
    const now: number = this.clock.monotonicMs();
    const due: PendingReply[] = [];
    const rest: PendingReply[] = [];
    for (const p of this.pending) {
      if (p.dueMs <= now) {
        due.push(p);
      } else {
        rest.push(p);
      }
    }
    this.pending = rest;
    for (const p of due) {
      engine.onPacket(p.resp, p.src);
    }
  }
}

class FakeDns implements DnsResolver {
  private res: DnsLookupResult;

  constructor(ipList: Uint8Array[]) {
    this.res = { ipv4: ipList, ipv6: [] };
  }

  public lookup(host: string): DnsLookupResult {
    return this.res;
  }
}

class FakePortMapper implements PortMapperProbe {
  private res: PortMapResult;

  constructor(upnp: boolean, pmp: boolean, pcp: boolean) {
    this.res = { upnp: upnp, pmp: pmp, pcp: pcp };
  }

  public probe(): PortMapResult {
    return this.res;
  }
}

class ThrowingSender implements StunSender {
  public sendPacket(data: Uint8Array, dest: NetAddr): number {
    throw new Error('network unreachable');
  }
}

function noOpts(): GetReportOpts {
  const o: GetReportOpts = { onlyTcp443: false, onlyStun: false, activity: null };
  return o;
}

function mkEngine(map: NetcheckDerpMap, clock: FixedClock, peer: StunSender | null, overrides?: (c: EngineConfig) => void): NetcheckEngine {
  const cfg: EngineConfig = {
    clock: clock,
    rng: new ArrayRng(makeRngPool()),
    derpMap: map,
    sender: peer,
    osHasIpv6: false,
    haveV4: true,
    haveV6: false,
    skipExternalNetwork: false,
    portMapper: null,
    dns: null,
    forcePreferredDERP: 0,
    enoughRegionsOverride: 0,
  };
  if (overrides !== undefined) {
    overrides(cfg);
  }
  return new NetcheckEngine(cfg);
}

/** 桥接驱动循环：推进时钟 → 到点回包先合并 → 引擎 onTimer；阶段结束后继续收迟到包。 */
function drive(engine: NetcheckEngine, peer: TestPeer, clock: FixedClock): void {
  for (;;) {
    const ed: number | null = engine.nextDueMonoMs();
    const rd: number | null = peer.nextReplyDueMs();
    if (ed === null && rd === null) {
      return;
    }
    let due: number = ed as number;
    if (ed === null) {
      due = rd as number;
    } else if (rd !== null && rd < ed) {
      due = rd;
    }
    clock.advanceMs(due - clock.monotonicMs());
    let rd2: number | null = peer.nextReplyDueMs();
    while (rd2 !== null && rd2 <= clock.monotonicMs()) {
      peer.drainDueReplies(engine);
      rd2 = peer.nextReplyDueMs();
    }
    if (!engine.stunPhaseDone()) {
      engine.onTimer();
    }
  }
}

/** 无回包场景的驱动循环（sender 为 null/抛错/全 null 脚本）。 */
function driveNoSend(engine: NetcheckEngine, clock: FixedClock): void {
  for (;;) {
    const due: number | null = engine.nextDueMonoMs();
    if (due === null) {
      return;
    }
    clock.advanceMs(due - clock.monotonicMs());
    engine.onTimer();
  }
}

test('超时常量守恒：ReportTimeout ≥ stun/icmp/https 预算（上游 TestReportTimeouts，netcheck_test.go:1090-1100）', () => {
  assert.ok(REPORT_TIMEOUT_MS >= STUN_PROBE_TIMEOUT_MS);
  assert.ok(REPORT_TIMEOUT_MS >= ICMP_PROBE_TIMEOUT_MS);
  assert.ok(REPORT_TIMEOUT_MS >= HTTPS_PROBE_TIMEOUT_MS);
  assert.equal(REPORT_TIMEOUT_MS, 5000);
  assert.equal(STUN_PROBE_TIMEOUT_MS, 3000);
});

test('端到端：单 region 单节点一回包 → UDP/延迟/首见端点/home 全部落表', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.10', 'none')])]);
  const peer: TestPeer = new TestPeer(clock, [v4([192, 0, 2, 1], 41641)]);
  const engine: NetcheckEngine = mkEngine(map, clock, peer);
  engine.startReport(noOpts());
  drive(engine, peer, clock);
  assert.equal(engine.stunPhaseDone(), true);
  assert.equal(engine.phaseEndReason(), PHASE_END.AllGroupsDone, '唯一组被回包取消 → 全组结算');
  assert.equal(engine.anyUdp(), true);
  const rep: NetcheckReport = engine.finishReport();
  assert.equal(rep.udp, true);
  assert.equal(rep.ipv4, true);
  assert.equal(rep.ipv4CanSend, true, 'STUN 回包本身证明可发送（netcheck.go:710-713）');
  assert.equal(rep.regionLatency.get(1), 10, 'RTT = 发送→回包的单调差（脚本 rtt=10ms）');
  assert.ok(rep.globalV4 !== null && addrStr(rep.globalV4 as NetAddr) === 'c0000201:41641', 'GlobalV4 = 回包 XOR-MAPPED 端点');
  assert.equal(rep.preferredDERP, 1, '首份报告历史唯一 region → home=1（改在 finishReport 的克隆上）');
  const ga = rep.getGlobalAddrs();
  assert.equal(ga.v4.length, 1);
  assert.equal(addrStr(ga.v4[0]), addrStr(rep.globalV4 as NetAddr));
});

test('端到端 RTT 记账：回包脚本 rtt=7 → 表内延迟恰为 7ms（sent 取在 DNS 之后，netcheck.go:1617）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const node: NetcheckNode = mkNode('1a', 1, '', 'none'); // 无显式 IP → 走 DNS 注入
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [node])]);
  const peer: TestPeer = new TestPeer(clock, [v4([192, 0, 2, 1], 9999)], 7);
  const engine: NetcheckEngine = mkEngine(map, clock, peer, (c: EngineConfig): void => {
    c.dns = new FakeDns([new Uint8Array([192, 0, 2, 5])]);
  });
  engine.startReport(noOpts());
  drive(engine, peer, clock);
  const rep: NetcheckReport = engine.finishReport();
  assert.equal(rep.regionLatency.get(1), 7, 'RTT 恰等于回包脚本延迟（同步查表 DNS 不计入）');
  assert.equal(peer.dests.length, 1);
  assert.ok(peer.dests[0].endsWith(':3478'), 'STUNPort 缺省 → 3478（netcheck.go:1670-1672）');
});

test('重传去抖：同组 0/100/200ms 三发，首包 0ms 回包 → 后续重传全部取消（netcheck.go:1619-1624）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.10', 'none')])]);
  const peer: TestPeer = new TestPeer(clock, [v4([192, 0, 2, 1], 1000), null, null], 0);
  const engine: NetcheckEngine = mkEngine(map, clock, peer);
  engine.startReport(noOpts());
  drive(engine, peer, clock);
  assert.deepEqual(peer.sends, [0], '回包即 cancelSet：只发 0ms 一发');
  assert.equal(engine.phaseEndReason(), PHASE_END.AllGroupsDone);
});

test('无回包：0/100/200ms 三发齐全，3s STUN 截止结束阶段并满足回退前提（netcheck.go:62-66,:1003）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.10', 'none')])]);
  const peer: TestPeer = new TestPeer(clock, [null, null, null]);
  const engine: NetcheckEngine = mkEngine(map, clock, peer);
  engine.startReport(noOpts());
  drive(engine, peer, clock);
  assert.deepEqual(peer.sends, [0, 100, 200], '初始计划三发 delay=try×100ms');
  assert.equal(engine.phaseEndReason(), PHASE_END.StunTimeout);
  assert.equal(engine.shouldTryHttpsFallback(), true, 'UDP 全败且 5s 预算未尽 → 允许 HTTPS/ICMP 回退');
  const rep: NetcheckReport = engine.finishReport();
  assert.equal(rep.udp, false);
  assert.equal(rep.preferredDERP, 0, '无任何延迟数据 → home 未知');
  assert.equal(rep.ipv4CanSend, true, '发送成功即置 CanSend（netcheck.go:1643-1653），与有无回包无关');
});

test('probeWouldHelp：region 有数据但 MappingVaries 未知 → v4 重传仍放行（netcheck.go:667 三态活输入）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([
    mkRegion(1, [mkNode('1a', 1, '192.0.2.10', 'none')]),
    mkRegion(2, [mkNode('2a', 2, '192.0.2.20', 'none')]),
  ]);
  // t0：region1 首发回端点1、region2 首发无回包；region1 第二发 @100ms：region1
  // 已有数据但 varies 未知 → 第三问放行；回包端点不同 → varies=true 并 cancelSet
  const peer: TestPeer = new TestPeer(
    clock,
    [v4([192, 0, 2, 1], 1111), null, v4([192, 0, 2, 2], 2222)],
    0,
  );
  const engine: NetcheckEngine = mkEngine(map, clock, peer, (c: EngineConfig): void => {
    c.enoughRegionsOverride = 99; // 关闭 3-region 早停干扰
  });
  engine.startReport(noOpts());
  drive(engine, peer, clock);
  assert.equal(peer.sends.length, 3, 'region1 两发 + region2 一发；varies 已知后 region1 第三发被早停取消');
  assert.equal(peer.sends[2] - peer.sends[0], 100, '放行的正是 100ms 重传');
  const rep: NetcheckReport = engine.finishReport();
  assert.equal(rep.mappingVariesByDestIp.equalBool(true), true, '两个不同 v4 端点 → varies=true（:728-729）');
});

test('MappingVariesByDestIP：同端点再现且未知 → 置 false（netcheck.go:730-732）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  // 上游语义：任一回包取消整个组（:1622-1623），因此两次 v4 观察必须来自两个组
  const map: NetcheckDerpMap = mkMap([
    mkRegion(1, [mkNode('1a', 1, '192.0.2.10', 'none')]),
    mkRegion(2, [mkNode('2a', 2, '192.0.2.20', 'none')]),
  ]);
  const ep: NetAddr = v4([192, 0, 2, 1], 1111);
  const peer: TestPeer = new TestPeer(clock, [ep, ep], 0);
  const engine: NetcheckEngine = mkEngine(map, clock, peer, (c: EngineConfig): void => {
    c.enoughRegionsOverride = 99;
  });
  engine.startReport(noOpts());
  drive(engine, peer, clock);
  assert.equal(peer.sends.length, 2, '两 region 各一发；各自回包只取消各自的组');
  const rep: NetcheckReport = engine.finishReport();
  assert.equal(rep.mappingVariesByDestIp.equalBool(false), true, '第二次观察到同端点 → 未知态定为 false');
});

test('MappingVariesByDestIP：一旦 true 不会被同端点回包改回（守卫只在未知态生效，:730-732）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.10', 'none')])]);
  const engine: NetcheckEngine = mkEngine(map, clock, null, (c: EngineConfig): void => {
    c.enoughRegionsOverride = 99;
  });
  engine.startReport(noOpts());
  engine.mergeStunResponseForTest(1, v4([192, 0, 2, 1], 1), 10);
  engine.mergeStunResponseForTest(1, v4([192, 0, 2, 2], 2), 11); // varies=true
  engine.mergeStunResponseForTest(1, v4([192, 0, 2, 1], 1), 12); // 同端点再现
  engine.mergeStunResponseForTest(1, v4([192, 0, 2, 2], 2), 13);
  const rep: NetcheckReport = engine.finishReport();
  assert.equal(rep.mappingVariesByDestIp.equalBool(true), true);
});

test('TestMultiGlobalAddressMapping 向量：port1/port2/port3/port3 → [port1, port3]（netcheck_test.go:81-109）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.10', 'none')])]);
  const engine: NetcheckEngine = mkEngine(map, clock, null);
  engine.startReport(noOpts());
  engine.mergeStunResponseForTest(1, v4([127, 0, 0, 1], 1234), 10); // port1：首见
  engine.mergeStunResponseForTest(1, v4([127, 0, 0, 1], 2345), 11); // port2：单次
  engine.mergeStunResponseForTest(1, v4([127, 0, 0, 1], 3456), 12); // port3：两次
  engine.mergeStunResponseForTest(1, v4([127, 0, 0, 1], 3456), 13);
  const rep: NetcheckReport = engine.finishReport();
  const ga = rep.getGlobalAddrs();
  assert.equal(ga.v4.length, 2, '单次出现的 port2 排除（疑似 hard NAT 临时映射，:144-150）');
  assert.equal(addrStr(ga.v4[0]), '7f000001:1234', 'GlobalV4（首见）在前');
  assert.equal(addrStr(ga.v4[1]), '7f000001:3456');
});

test('TestSTUNResponseProvesCanSend 向量：v4/v6 回包分别置 IPv4CanSend/IPv6CanSend（netcheck_test.go:111-131）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.10', '2001:db8::10')])]);
  const e4: NetcheckEngine = mkEngine(map, clock, null);
  e4.startReport(noOpts());
  e4.mergeStunResponseForTest(1, v4([192, 0, 2, 1], 1234), 1);
  const rep4: NetcheckReport = e4.finishReport();
  assert.equal(rep4.ipv4CanSend, true);
  assert.equal(rep4.ipv6CanSend, false);

  const e6: NetcheckEngine = mkEngine(map, clock, null, (c: EngineConfig): void => {
    c.haveV6 = true;
  });
  e6.startReport(noOpts());
  e6.mergeStunResponseForTest(1, v6([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 1234), 1);
  const rep6: NetcheckReport = e6.finishReport();
  assert.equal(rep6.ipv6CanSend, true);
  assert.equal(rep6.ipv4CanSend, false);
  assert.equal(rep6.ipv6, true);
  assert.ok(rep6.globalV6 !== null && addrStr(rep6.globalV6 as NetAddr) === '20010db8000000000000000000000001:1234');
});

test('GlobalV4 首见 / GlobalV6 末见不对称（netcheck.go:715 vs :724-727）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.10', 'none')])]);
  const engine: NetcheckEngine = mkEngine(map, clock, null);
  engine.startReport(noOpts());
  engine.mergeStunResponseForTest(1, v4([192, 0, 2, 1], 100), 10);
  engine.mergeStunResponseForTest(1, v4([192, 0, 2, 9], 900), 10);
  engine.mergeStunResponseForTest(1, v6([0x20, 1, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5], 100), 10);
  engine.mergeStunResponseForTest(1, v6([0x20, 1, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6], 100), 10);
  const rep: NetcheckReport = engine.finishReport();
  assert.ok(rep.globalV4 !== null && addrStr(rep.globalV4 as NetAddr) === 'c0000201:100', 'v4 首见哨兵 gotEP4：记住第一个');
  assert.ok(rep.globalV6 !== null && addrStr(rep.globalV6 as NetAddr) === '20010db8000000000000000000000006:100', 'v6 每次覆盖取最新');
});

test('getGlobalAddrs 其余端点排序裁定：计数降序 → 键升序（上游 Go map 序不定的固定化）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.10', 'none')])]);
  const engine: NetcheckEngine = mkEngine(map, clock, null);
  engine.startReport(noOpts());
  engine.mergeStunResponseForTest(1, v4([192, 0, 2, 1], 100), 10); // 首见
  engine.mergeStunResponseForTest(1, v4([192, 0, 2, 3], 300), 10); // ×3
  engine.mergeStunResponseForTest(1, v4([192, 0, 2, 3], 300), 10);
  engine.mergeStunResponseForTest(1, v4([192, 0, 2, 3], 300), 10);
  engine.mergeStunResponseForTest(1, v4([192, 0, 2, 2], 200), 10); // ×2
  engine.mergeStunResponseForTest(1, v4([192, 0, 2, 2], 200), 10);
  const rep: NetcheckReport = engine.finishReport();
  const ga = rep.getGlobalAddrs();
  assert.deepEqual(
    [addrStr(ga.v4[0]), addrStr(ga.v4[1]), addrStr(ga.v4[2])],
    ['c0000201:100', 'c0000203:300', 'c0000202:200'],
    'GlobalV4 首位；其余按计数降序（3 次 > 2 次）',
  );
});

test('sender 注入为 null：每发都置双 CanSend=false（netcheck.go:1626-1632）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.10', 'none')])]);
  const engine: NetcheckEngine = mkEngine(map, clock, null);
  engine.startReport(noOpts());
  driveNoSend(engine, clock);
  const rep: NetcheckReport = engine.finishReport();
  assert.equal(rep.ipv4CanSend, false);
  assert.equal(rep.ipv6CanSend, false);
});

test('sender 抛错：不置 CanSend（上游 err!=nil 路径，netcheck.go:1643-1653）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.10', 'none')])]);
  const engine: NetcheckEngine = mkEngine(map, clock, new ThrowingSender());
  engine.startReport(noOpts());
  driveNoSend(engine, clock);
  const rep: NetcheckReport = engine.finishReport();
  assert.equal(rep.ipv4CanSend, false);
});

test('3-region 早停：听到 3 region 挂 max×2（全量）定时器，未结算组在场 → 提前收尾（netcheck.go:694-706）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const regions: NetcheckRegion[] = [];
  for (let rid: number = 1; rid <= 4; rid += 1) {
    regions.push(mkRegion(rid, [mkNode(rid + 'a', rid, '192.0.2.' + String(10 + rid), 'none')]));
  }
  const map: NetcheckDerpMap = mkMap(regions);
  // 4 region 各首发；region1/2/3 回包（rtt 均 10 → t=10 同时到），region4 永不回包
  const peer: TestPeer = new TestPeer(
    clock,
    [v4([192, 0, 2, 1], 1), v4([192, 0, 2, 2], 2), v4([192, 0, 2, 3], 3), null],
    10,
  );
  const engine: NetcheckEngine = mkEngine(map, clock, peer);
  engine.startReport(noOpts());
  drive(engine, peer, clock);
  assert.equal(engine.phaseEndReason(), PHASE_END.SawEnoughRegions);
  // t=10 第 3 个 region 入表 → 定时 max(10,10,10)×2 = 20 → t=30 早停 < 3s STUN 截止
  assert.equal(clock.monotonicMs(), 30);
  assert.equal(peer.sends.length, 4, '每 region 一发；region4 的 100/200ms 重传未到早停即终止');
});

test('3-region 早停增量 ×1：同样场景增量报告定时为 max×1（netcheck.go:700-704）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([
    mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')]),
    mkRegion(2, [mkNode('2a', 2, '192.0.2.2', 'none')]),
  ]);
  const peer: TestPeer = new TestPeer(clock, [v4([192, 0, 2, 1], 1), null], 10);
  // enoughRegionsOverride=1：首个回包即足 → 全量定时 = rtt×2
  const engine: NetcheckEngine = mkEngine(map, clock, peer, (c: EngineConfig): void => {
    c.enoughRegionsOverride = 1;
  });
  engine.startReport(noOpts());
  drive(engine, peer, clock);
  assert.equal(engine.phaseEndReason(), PHASE_END.SawEnoughRegions);
  assert.equal(clock.monotonicMs(), 30, '全量：回包 t=10 + max(10)×2 = 30');
  engine.finishReport();

  // 第二场（同一引擎 → 增量，home=region1）：region1 首包回包 → 定时 = rtt×1
  peer.setScript([v4([192, 0, 2, 1], 1), null, null, null, null, null], 10);
  engine.startReport(noOpts());
  drive(engine, peer, clock);
  assert.equal(engine.phaseEndReason(), PHASE_END.SawEnoughRegions);
  assert.equal(clock.monotonicMs(), 50, '增量：回包 t=40 + max(10)×1 = 50（无 ×2）');
  engine.finishReport();
});

test('UDP 全败回退候选：STUNOnly/NoMeasureNoHome/Avoid 各自排除（netcheck.go:1005-1010,:1756-1763）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const stunOnlyReg: NetcheckRegion = mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')]);
  stunOnlyReg.nodes[0].stunOnly = true;
  const noMeasure: NetcheckRegion = mkRegion(3, [mkNode('3a', 3, '192.0.2.3', 'none')]);
  noMeasure.noMeasureNoHome = true;
  const avoid: NetcheckRegion = mkRegion(4, [mkNode('4a', 4, '192.0.2.4', 'none')]);
  avoid.avoid = true;
  const map: NetcheckDerpMap = mkMap([
    stunOnlyReg,
    mkRegion(2, [mkNode('2a', 2, '192.0.2.2', 'none')]),
    noMeasure,
    avoid,
  ]);
  const peer: TestPeer = new TestPeer(clock, [null, null, null, null]);
  const engine: NetcheckEngine = mkEngine(map, clock, peer);
  engine.startReport(noOpts());
  driveNoSend(engine, clock);
  assert.equal(engine.phaseEndReason(), PHASE_END.StunTimeout);
  const cands: NetcheckRegion[] = engine.httpsFallbackCandidates();
  const ids: number[] = [];
  for (const c of cands) {
    ids.push(c.regionId);
  }
  assert.deepEqual(ids, [2], '仅 region2 入选（缺延迟数据且有非 STUNOnly 节点）');
});

test('OnlyTCP443：不产 STUN 计划、ICMP 回退被排除（netcheck.go:941-944,:1015）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  const engine: NetcheckEngine = mkEngine(map, clock, new TestPeer(clock, []));
  const opts: GetReportOpts = { onlyTcp443: true, onlyStun: false, activity: null };
  engine.startReport(opts);
  driveNoSend(engine, clock);
  assert.equal(engine.phaseEndReason(), PHASE_END.AllGroupsDone, '空计划 = 上游 WaitGroupChan 计 0 即刻 Done（:959-972）');
  assert.equal(engine.shouldTryHttpsFallback(), true, 'OnlyTCP443 时仍走 HTTPS（只禁 STUN 与 ICMP）');
  assert.equal(engine.icmpFallbackAllowed(), false);
});

test('OnlySTUN：UDP 全败也不做回退（netcheck.go:1003 !onlySTUN）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  const engine: NetcheckEngine = mkEngine(map, clock, new TestPeer(clock, [null, null, null]));
  const opts: GetReportOpts = { onlyTcp443: false, onlyStun: true, activity: null };
  engine.startReport(opts);
  driveNoSend(engine, clock);
  assert.equal(engine.phaseEndReason(), PHASE_END.StunTimeout);
  assert.equal(engine.shouldTryHttpsFallback(), false);
});

test('并发重入显式报错；finishReport 后方可开新场（netcheck.go:861-865）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  const engine: NetcheckEngine = mkEngine(map, clock, new TestPeer(clock, []));
  engine.startReport(noOpts());
  assert.throws(
    (): void => {
      engine.startReport(noOpts());
    },
    (e: unknown): boolean => e instanceof NetcheckError && e.code === 'STATE',
  );
  engine.finishReport();
  engine.startReport(noOpts()); // 不抛 = 会话已清（上游 defer curState=nil，:908-912）
  engine.finishReport();
});

test('OnlySTUN 与 OnlyTCP443 同设 → RANGE（netcheck.go:833-839）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  const engine: NetcheckEngine = mkEngine(map, clock, null);
  const opts: GetReportOpts = { onlyTcp443: true, onlyStun: true, activity: null };
  assert.throws(
    (): void => {
      engine.startReport(opts);
    },
    (e: unknown): boolean => e instanceof NetcheckError && e.code === 'RANGE',
  );
});

test('全量/增量判定：首场全量 → 带历史后增量（home 4 try@0/12/124/186）→ makeNextReportFull 回全量', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  const peer: TestPeer = new TestPeer(clock, [null, null, null]);
  const e1: NetcheckEngine = mkEngine(map, clock, peer, (c: EngineConfig): void => {
    c.enoughRegionsOverride = 99;
  });
  // 场1：全量（3 发 @0/100/200），无回包
  e1.startReport(noOpts());
  driveNoSend(e1, clock);
  assert.deepEqual(peer.sends.slice(0, 3), [0, 100, 200]);
  const full: NetcheckReport = e1.finishReport();
  full.regionLatency.set(1, 10); // 模拟场1测得 10ms（测试专用直改，对齐上游向量构造）
  full.preferredDERP = 1; // 上游向量同样在 last 上直接设 PreferredDERP（netcheck_test.go:756）

  // 场2（同一引擎，last 与 lastFull 均在场）：历史有数据 → 增量 home 4 发
  clock.advanceMs(1000);
  peer.setScript([null, null, null, null]);
  e1.startReport(noOpts());
  driveNoSend(e1, clock);
  assert.deepEqual(
    peer.sends.slice(3),
    [4000, 4012, 4124, 4186],
    '增量 home 4 发：0 / 1×12 / 2×12+2×50=124 / 3×12+3×50=186（相对 4000）',
  );
  e1.finishReport();

  // 场3：MakeNextReportFull 强制回全量
  e1.makeNextReportFull();
  peer.setScript([null, null, null]);
  e1.startReport(noOpts());
  driveNoSend(e1, clock);
  const s3: number[] = peer.sends.slice(7);
  assert.equal(s3.length, 3);
  assert.equal(s3[1] - s3[0], 100, '全量计划重现为 0/100/200ms');
  e1.finishReport();
});

test('全量周期：距上次全量 5min 以上 → 自动全量（netcheck.go:887-890）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  const peer: TestPeer = new TestPeer(clock, [null, null, null]);
  const e1: NetcheckEngine = mkEngine(map, clock, peer, (c: EngineConfig): void => {
    c.enoughRegionsOverride = 99;
  });
  // 场1：fresh 引擎首场必为全量（lastFull=-1 哨兵 = 上游零值 time），并留下 10ms 历史
  e1.startReport(noOpts());
  driveNoSend(e1, clock);
  const full: NetcheckReport = e1.finishReport();
  assert.deepEqual(peer.sends.slice(0, 3), [0, 100, 200]);
  full.regionLatency.set(1, 10);
  full.regionV4Latency.set(1, 10);
  full.preferredDERP = 1;
  // 场2（同一引擎、挂钟未推进 5min）：last 有数据 → 增量形态（home 重传间隔 10×1.2=12ms）
  peer.setScript([null, null, null, null]);
  e1.startReport(noOpts());
  driveNoSend(e1, clock);
  const s2: number[] = peer.sends.slice(3);
  assert.equal(s2.length, 4);
  assert.equal(s2[1] - s2[0], 12, '增量形态（10ms×1.2）');
  e1.finishReport();
  // 场3（同一引擎、挂钟推进 300001ms）：fullReportInterval 到 → 自动全量（3 发，间隔 100ms）
  clock.setWallMs(clock.wallMs() + 300001);
  peer.setScript([null, null, null]);
  e1.startReport(noOpts());
  driveNoSend(e1, clock);
  const s3: number[] = peer.sends.slice(7);
  assert.equal(s3.length, 3, '5min 周期到 → 全量计划');
  assert.equal(s3[1] - s3[0], 100);
  e1.finishReport();
});

test('captive portal 反馈环：UDP=false 且 CaptivePortal=true → 下一场强制全量（netcheck.go:891-897）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  const e1: NetcheckEngine = mkEngine(map, clock, new TestPeer(clock, [null, null, null]), (c: EngineConfig): void => {
    c.enoughRegionsOverride = 99;
  });
  e1.startReport(noOpts());
  driveNoSend(e1, clock); // 推进到 3s 截止（mono=3000）
  e1.setCaptivePortal(true);
  e1.finishReport();
  // 第二场：last.UDP=false && CaptivePortal=true → doFull（初始计划三发 @0/100/200）
  const peer2: TestPeer = new TestPeer(clock, [null, null, null]);
  const e2: NetcheckEngine = mkEngine(map, clock, peer2, (c: EngineConfig): void => {
    c.enoughRegionsOverride = 99;
  });
  e2.startReport(noOpts());
  driveNoSend(e2, clock);
  assert.deepEqual(peer2.sends, [3000, 3100, 3200], '虽刚做过报告，仍为全量形态（captive portal 反馈环）');
  e2.finishReport();
});

test('端口映射注入：结果写三态；缺省保持未知（netcheck.go:750-771；nil PortMapper 语义）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  const e2: NetcheckEngine = mkEngine(map, clock, null, (c: EngineConfig): void => {
    c.portMapper = new FakePortMapper(true, false, true);
  });
  e2.startReport(noOpts());
  const got: NetcheckReport = e2.finishReport();
  assert.equal(got.upnp.equalBool(true), true);
  assert.equal(got.pmp.equalBool(false), true);
  assert.equal(got.pcp.equalBool(true), true);
  assert.equal(got.anyPortMappingChecked(), true);

  const e3: NetcheckEngine = mkEngine(map, clock, null);
  e3.startReport(noOpts());
  const got3: NetcheckReport = e3.finishReport();
  assert.equal(got3.upnp.isUnknown(), true, 'PortMapper 为空 → 三态保持未知（上游 nil 语义）');
  assert.equal(got3.anyPortMappingChecked(), false);
});

test('skipExternalNetwork：置位则不调端口映射探测（netcheck.go:934/:994）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  let probed: number = 0;
  class CountingMapper implements PortMapperProbe {
    public probe(): PortMapResult {
      probed += 1;
      const r: PortMapResult = { upnp: true, pmp: true, pcp: true };
      return r;
    }
  }
  const engine: NetcheckEngine = mkEngine(map, clock, null, (c: EngineConfig): void => {
    c.skipExternalNetwork = true;
    c.portMapper = new CountingMapper();
  });
  engine.startReport(noOpts());
  const rep: NetcheckReport = engine.finishReport();
  assert.equal(probed, 0);
  assert.equal(rep.upnp.isUnknown(), true);
});

test('hairpin 迟到回声静默忽略：合法 Binding Request 不合并不崩溃（netcheck.go:331-341）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  const peer: TestPeer = new TestPeer(clock, [v4([192, 0, 2, 1], 1000), null, null]);
  const engine: NetcheckEngine = mkEngine(map, clock, peer);
  engine.startReport(noOpts());
  // 推进到首发；喂入一条「别人的」Binding Request（旧版 hairpin 回声形态）
  const firstDue: number | null = engine.nextDueMonoMs();
  assert.ok(firstDue !== null);
  clock.advanceMs(firstDue - clock.monotonicMs());
  engine.onTimer();
  const strangerTx: StunTransaction = new StunTransaction(new ArrayRng(new Uint8Array([9, 9, 9, 9])), clock);
  engine.onPacket(stunRequest(strangerTx.txid), v4([192, 0, 2, 1], 3478));
  assert.equal(engine.anyUdp(), false, '迟到回声被静默忽略，不产生 UDP 证据');
  engine.onPacket(new Uint8Array([1, 2, 3, 4, 5]), v4([192, 0, 2, 1], 3478)); // 垃圾字节
  assert.equal(engine.anyUdp(), false);
  // 真回包仍正常合并
  drive(engine, peer, clock);
  assert.equal(engine.anyUdp(), true);
  engine.finishReport();
});

test('未配对/迟到的合法响应被丢弃；会话外 onPacket 无害（:327-329 rs==nil 路径）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  const engine: NetcheckEngine = mkEngine(map, clock, null, (c: EngineConfig): void => {
    c.enoughRegionsOverride = 99;
  });
  const strangerTx: StunTransaction = new StunTransaction(new ArrayRng(new Uint8Array([7, 7, 7, 7])), clock);
  const stray: Uint8Array = stunResponse(strangerTx.txid, new Uint8Array([192, 0, 2, 9]), 9);
  engine.onPacket(stray, v4([192, 0, 2, 9], 9)); // 无会话
  engine.startReport(noOpts());
  engine.onPacket(stray, v4([192, 0, 2, 9], 9)); // 有会话但 TxID 未配对
  assert.equal(engine.anyUdp(), false);
  engine.finishReport();
  engine.onPacket(stray, v4([192, 0, 2, 9], 9)); // 会话结束后
});

test('phaseDone 后、finishReport 前的迟到回包仍合并（上游 inFlight 存活至 GetReport 返回）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  // 定迟发送：3s 截止时 onTimer 才补发 0ms 探测（sent=3000），回包 rtt=500 → 3500 到
  const peer: TestPeer = new TestPeer(clock, [v4([192, 0, 2, 1], 500), null, null], 500);
  const engine: NetcheckEngine = mkEngine(map, clock, peer);
  engine.startReport(noOpts());
  clock.advanceMs(3000);
  engine.onTimer();
  assert.equal(engine.stunPhaseDone(), true);
  assert.equal(engine.shouldTryHttpsFallback(), true, '回退判定发生在 3s 截止时刻（此刻 anyUDP=false）');
  clock.advanceMs(500);
  peer.drainDueReplies(engine); // t=3500 迟到回包仍并入
  assert.equal(engine.anyUdp(), true);
  const rep: NetcheckReport = engine.finishReport();
  assert.equal(rep.udp, true, '迟到回包在 finish 前仍有效（上游 :1003 判定点之后的回包同样并入 rs.report）');
});

test('HTTPS/ICMP 回退合并：缺则写、不大于旧值才覆盖、按族置位（netcheck.go:1036-1052,:1256-1264）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([
    mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')]),
    mkRegion(2, [mkNode('2a', 2, '192.0.2.2', 'none')]),
  ]);
  const engine: NetcheckEngine = mkEngine(map, clock, new TestPeer(clock, []));
  const opts: GetReportOpts = { onlyTcp443: true, onlyStun: false, activity: null };
  engine.startReport(opts);
  engine.mergeHttpsLatency(1, 50, v4([192, 0, 2, 30], 443));
  engine.mergeHttpsLatency(1, 40, null); // 40 ≤ 50 → 覆盖
  engine.mergeHttpsLatency(1, 60, null); // 60 > 40 → 保留（latency >= d 才覆盖）
  engine.mergeIcmpLatency(2, 30);
  const rep: NetcheckReport = engine.finishReport();
  assert.equal(rep.regionLatency.get(1), 40);
  assert.equal(rep.regionLatency.get(2), 30);
  assert.equal(rep.ipv4, true);
  assert.equal(rep.icmpV4, true, 'ICMP 合并置 IPv4+ICMPv4（上游现只发 v4 ICMP）');
  assert.equal(rep.udp, false, '回退路径不置 UDP（UDP 只来自 STUN 往返）');
});

test('mergeStunResponseForTest / finishReport 无会话 → STATE 错误', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  const engine: NetcheckEngine = mkEngine(map, clock, null);
  assert.throws(
    (): void => {
      engine.mergeStunResponseForTest(1, v4([192, 0, 2, 1], 1), 1);
    },
    (e: unknown): boolean => e instanceof NetcheckError && e.code === 'STATE',
  );
  assert.throws(
    (): void => {
      engine.finishReport();
    },
    (e: unknown): boolean => e instanceof NetcheckError && e.code === 'STATE',
  );
});

test('Report.clone 深拷：改动克隆不影响原件（上游 :175-186 四张 map 深拷）', () => {
  const clock: FixedClock = new FixedClock(1729624521000);
  const map: NetcheckDerpMap = mkMap([mkRegion(1, [mkNode('1a', 1, '192.0.2.1', 'none')])]);
  const engine: NetcheckEngine = mkEngine(map, clock, null);
  engine.startReport(noOpts());
  engine.mergeStunResponseForTest(1, v4([192, 0, 2, 1], 100), 10);
  const rep: NetcheckReport = engine.finishReport();
  const rep2: NetcheckReport = rep.clone();
  rep2.regionLatency.set(1, 999);
  const c2 = rep2.globalV4Counters.get('c0000201/100');
  assert.ok(c2 !== undefined);
  c2.count = 77;
  if (rep2.globalV4 !== null) {
    rep2.globalV4.port = 1;
  }
  rep2.mappingVariesByDestIp.set(true);
  assert.equal(rep.regionLatency.get(1), 10, '延迟表深拷');
  const c0 = rep.globalV4Counters.get('c0000201/100');
  assert.ok(c0 !== undefined);
  assert.equal(c0.count, 1, '计数表深拷');
  assert.ok(rep.globalV4 !== null && (rep.globalV4 as NetAddr).port === 100, '端点对象深拷');
  assert.equal(rep.mappingVariesByDestIp.equalBool(true), false, '三态对象也是深拷');
});

test('OptBool 三态行为面（上游 opt.Bool：未知态参与 probeWouldHelp，netcheck.go:667）', () => {
  const b: OptBool = new OptBool();
  assert.equal(b.isUnknown(), true);
  assert.equal(b.isSet(), false);
  assert.equal(b.get(), null);
  assert.equal(b.equalBool(false), false, '未知不等于任何布尔（上游 EqualBool）');
  b.set(false);
  assert.equal(b.equalBool(false), true);
  assert.equal(b.equalBool(true), false);
  b.set(true);
  assert.equal(b.get(), true);
});

test('FixedClock 双轴：wall 驱动历史窗、mono 驱动截止（研究笔记 §7.3 移植映射）', () => {
  const clock: FixedClock = new FixedClock(1000);
  clock.advanceMs(5);
  assert.equal(clock.wallMs(), 1005);
  assert.equal(clock.monotonicMs(), 5);
  clock.setWallMs(9000);
  assert.equal(clock.wallMs(), 9000);
  assert.equal(clock.monotonicMs(), 5, 'setWallMs 只平移挂钟轴');
});
