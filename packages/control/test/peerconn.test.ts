/**
 * peer 连接状态机测试（C2：事件驱动、时钟注入、超时/心跳）。
 *
 * 锚点：endpoint.go:455-467（候选删除三分支）、:583-600（发送三分支）、
 * :820-886（心跳）、:946-970（wantFullPing/外部发送触发）、:1187-1202（ping 超时）、
 * :1724-1817（Pong 配对与信任续期）、:1885-1941（betterAddr 打分/1% 迟滞）、
 * :1947-2027（CMM）、:525-541（wireguard-only 收包学习）、
 * magicsock.go:2350-2354（CMM 只许 DERP）、:2653-2694（CMM 前置 27s 新鲜度）、
 * derp.go:71-89/159-296/484-510/622-628/989-1033（路由学习/home 门控/空闲回收）。
 * 全部超时为注入 FixedClock 手动推拍（确定性，无真实等待）；Pong 延迟 =
 * 回放时刻 - Ping 发出时刻，用推拍量精确控制。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayRng, FixedClock } from '@ohos-tailscale/common';
import {
  DerpRouteTable,
  DiscoPingPurpose,
  HEARTBEAT_INTERVAL_MS,
  PeerEndpoint,
  PING_TIMEOUT_MS,
  SendRejection,
  TRUST_UDP_ADDR_DURATION_MS,
  WIREGUARD_ONLY_RECV_TRUST_MS,
  type PeerSink,
  type SelfEndpointsView,
  type TimeoutScheduler,
} from '../src/index.ts';

const NODE_KEY_HEX: string = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const DISCO_A: string = 'discokey:1111111111111111111111111111111111111111111111111111111111111111';
const DISCO_B: string = 'discokey:2222222222222222222222222222222222222222222222222222222222222222';
const EP_A: string = '203.0.113.10:1000';
const EP_B: string = '203.0.113.11:2000';

/** 手动推拍的确定性调度器：job 按 due 排序触发，不递归（期间重挂的留下一轮）。 */
class ManualScheduler implements TimeoutScheduler {
  private clock: FixedClock;
  private jobs: Map<string, number> = new Map();
  private seq: Map<string, number> = new Map();
  private seqCounter: number = 0;

  constructor(clock: FixedClock) {
    this.clock = clock;
  }

  public after(id: string, ms: number): void {
    this.jobs.set(id, this.clock.monotonicMs() + ms);
    this.seq.set(id, this.seqCounter);
    this.seqCounter += 1;
  }

  public cancel(id: string): void {
    this.jobs.delete(id);
    this.seq.delete(id);
  }

  public hasJob(id: string): boolean {
    return this.jobs.has(id);
  }

  /** 触发所有 due ≤ 当前单调时刻的任务，返回被触发的 id 列表。 */
  public fireDue(): string[] {
    const now: number = this.clock.monotonicMs();
    const due: string[] = [];
    this.jobs.forEach((t: number, id: string): void => {
      if (t <= now) {
        due.push(id);
      }
    });
    due.sort((a: string, b: string): number => {
      return this.seq.get(a)! - this.seq.get(b)!;
    });
    const fired: string[] = [];
    for (const id of due) {
      this.jobs.delete(id);
      fired.push(id);
    }
    return fired;
  }
}

/** 模拟真实调度器：摘除到期 job 并回调状态机的对应入口（hb:→heartbeat，ping:→超时）。 */
function dispatchDue(fx: PeerFixture): string[] {
  const fired: string[] = fx.scheduler.fireDue();
  for (const id of fired) {
    if (id.startsWith('hb:')) {
      fx.ep.heartbeat();
    } else if (id.startsWith('ping:')) {
      fx.ep.discoPingTimeout(id.slice('ping:'.length));
    }
  }
  return fired;
}

/** 记录型出口：断言状态机的对外行为（不发任何真实报文）。 */
class RecordingSink implements PeerSink {
  public pings: Array<{ peerId: string; to: string; txidHex: string; purpose: number }> = [];
  public pongs: Array<{ peerId: string; to: string; txidHex: string; src: string }> = [];
  public callMeMaybes: number[] = [];
  public probes: string[] = [];

  public sendDiscoPing(peerId: string, toAddrPort: string, txid: Uint8Array, purpose: number): void {
    let hex: string = '';
    for (const b of txid) {
      hex += b.toString(16).padStart(2, '0');
    }
    this.pings.push({ peerId: peerId, to: toAddrPort, txidHex: hex, purpose: purpose });
  }

  public sendPong(peerId: string, toAddrPort: string, txid: Uint8Array, observedSrcAddrPort: string): void {
    let hex: string = '';
    for (const b of txid) {
      hex += b.toString(16).padStart(2, '0');
    }
    this.pongs.push({ peerId: peerId, to: toAddrPort, txidHex: hex, src: observedSrcAddrPort });
  }

  public sendCallMeMaybe(peerId: string, viaDerpRegionId: number): void {
    this.callMeMaybes.push(viaDerpRegionId);
  }

  public sendWireGuardOnlyProbe(peerId: string, toAddrPort: string): void {
    this.probes.push(toAddrPort);
  }

  public lastPingTo(): string {
    return this.pings.length === 0 ? '' : this.pings[this.pings.length - 1].to;
  }

  public lastPingTxid(): string {
    return this.pings.length === 0 ? '' : this.pings[this.pings.length - 1].txidHex;
  }

  public pingTxidTo(addr: string): string {
    for (let i: number = this.pings.length - 1; i >= 0; i -= 1) {
      if (this.pings[i].to === addr) {
        return this.pings[i].txidHex;
      }
    }
    return '';
  }
}

/** 自端点新鲜度可编程视图。 */
class FakeSelfEndpoints implements SelfEndpointsView {
  public lastRefresh: number = 0;
  public refreshRequests: string[] = [];

  public lastRefreshMonoMs(): number {
    return this.lastRefresh;
  }

  public requestRefresh(why: string): void {
    this.refreshRequests.push(why);
  }
}

interface PeerFixture {
  clock: FixedClock;
  scheduler: ManualScheduler;
  sink: RecordingSink;
  selfEndpoints: FakeSelfEndpoints;
  ep: PeerEndpoint;
}

function makeEndpoint(rngPool: number[] = [], selfRefreshAt: number = -100_000): PeerFixture {
  const clock: FixedClock = new FixedClock(1_000_000);
  // 单调轴前移一个基准量，避免"从未发送/从未刷新"的 0 值哨兵与 t=0 撞车
  // （FixedClock 的 mono 从 0 起步；上游 mono.Time 零值语义同源）。
  clock.advanceMs(1_000);
  const scheduler: ManualScheduler = new ManualScheduler(clock);
  const sink: RecordingSink = new RecordingSink();
  const selfEndpoints: FakeSelfEndpoints = new FakeSelfEndpoints();
  selfEndpoints.lastRefresh = selfRefreshAt;
  // 默认 Rng 池 = 0..63 递增序列：保证各 txid（12B/个）互不相同，
  // 且首个 randomIndex 取字节 [0,1,2,3] → v=0x03020100（偶数 → idx 0）。
  if (rngPool.length === 0) {
    for (let i: number = 0; i < 64; i += 1) {
      rngPool.push(i);
    }
  }
  const ep: PeerEndpoint = new PeerEndpoint(NODE_KEY_HEX, {
    clock: clock,
    rng: new ArrayRng(new Uint8Array(rngPool)),
    scheduler: scheduler,
    sink: sink,
    selfEndpoints: selfEndpoints,
  });
  const fx: PeerFixture = { clock: clock, scheduler: scheduler, sink: sink, selfEndpoints: selfEndpoints, ep: ep };
  return fx;
}

/** 标准喂入：一个 netmap 候选 EP_A + home DERP 17 + disco key。 */
function feedStandard(fx: PeerFixture): void {
  fx.ep.updateFromNode({
    discoKeyHex: DISCO_A,
    homeDerpRegionId: 17,
    endpoints: [EP_A],
    expired: false,
    isWireGuardOnly: false,
  });
}

/** 回一个 Pong（src=真实 UDP 地址，非 DERP 假地址；延迟 = 推拍量）。 */
function replyPong(fx: PeerFixture, txidHex: string, src: string): void {
  fx.ep.handlePong(txidHex, src, src);
}

test('send 降级稳态：无 bestAddr ⇒ DERP 兜底 + 触发全 ping（CMM 走 fresh 通道）', () => {
  const fx = makeEndpoint([], -100_000); // 自端点 100s 前刷新 ⇒ 已过期（27s 线）
  feedStandard(fx);
  const decision = fx.ep.send(0);
  assert.equal(decision.sent, true);
  assert.equal(decision.udpAddr, '', '无 bestAddr ⇒ 无 UDP 直连');
  assert.equal(decision.derpRegionId, 17, '降级稳态走 DERP（region 17）');
  // 出站流量本身就是打洞触发器（endpoint.go:1066-1071）⇒ 全 ping 发现候选。
  assert.equal(fx.sink.pings.length, 1, '对 netmap 候选发出 discovery ping');
  assert.equal(fx.sink.pings[0].purpose, DiscoPingPurpose.Discovery);
  // 自端点不新鲜（27s 线）⇒ CMM 挂起 + 请求刷新（magicsock.go:2662-2679）。
  assert.equal(fx.sink.callMeMaybes.length, 0, '端点不新鲜，CMM 不得立刻发');
  assert.equal(fx.ep.hasPendingCallMeMaybe(), true);
  assert.deepEqual(fx.selfEndpoints.refreshRequests, ['refresh-for-peering']);
  // 心跳被外部发送启动（noteTxActivityExtTrigger，endpoint.go:965-970）。
  assert.equal(fx.scheduler.hasJob('hb:' + NODE_KEY_HEX), true, '外部发送启动 3s 心跳');
});

test('CMM 释放：STUN 刷新完成回调后补发（onEndpointRefreshed 语义）', () => {
  const fx = makeEndpoint([], -100_000);
  feedStandard(fx);
  fx.ep.send(0);
  assert.equal(fx.ep.hasPendingCallMeMaybe(), true);
  fx.selfEndpoints.lastRefresh = fx.clock.monotonicMs(); // 刷新完成
  fx.ep.onSelfEndpointsRefreshed();
  assert.equal(fx.ep.hasPendingCallMeMaybe(), false);
  assert.deepEqual(fx.sink.callMeMaybes, [17], '补发 CMM 经 home DERP region 17');
});

test('自端点新鲜（27s 内）⇒ 全 ping 直接伴随 CMM 发出（endpoint.go:1394-1402）', () => {
  const fx = makeEndpoint([], -10_000); // 11s 前刷新 ⇒ 新鲜
  feedStandard(fx);
  fx.ep.send(0);
  assert.deepEqual(fx.sink.callMeMaybes, [17], '新鲜 ⇒ 立即经 DERP 发 CMM');
  assert.equal(fx.ep.hasPendingCallMeMaybe(), false);
  assert.equal(fx.selfEndpoints.refreshRequests.length, 0);
});

test('Pong 配对：已知 TxID ⇒ setBestAddr + 信任 6.5s；未知 TxID ⇒ 忽略不迁移', () => {
  const fx = makeEndpoint();
  feedStandard(fx);
  fx.ep.send(0);
  const txid: string = fx.sink.lastPingTxid();
  // 未知 TxID（防伪造/重放）：绝不迁移 bestAddr（endpoint.go:1730-1734）。
  assert.equal(fx.ep.handlePong('deadbeefdeadbeefdeadbeef', EP_A, EP_A), false, '未知 TxID 返回 false');
  assert.equal(fx.ep.bestAddr(), '');
  replyPong(fx, txid, EP_A);
  assert.equal(fx.ep.bestAddr(), EP_A, '已知 TxID ⇒ bestAddr 迁移');
  assert.equal(fx.ep.trustBestAddrUntil(), fx.clock.monotonicMs() + TRUST_UDP_ADDR_DURATION_MS, '信任期 = now + 6.5s');
});

test('Pong 经 DERP 折返（src=127.3.3.40:region）：只消费 TxID，不迁移也不续期信任', () => {
  // 场景一：无 bestAddr 时，DERP 折返 Pong 不得建立 UDP 路径信任
  // （endpoint.go:1787 `if !isDerp` 把迁移/续期整块包住）。
  const fx = makeEndpoint();
  feedStandard(fx);
  fx.ep.send(0);
  const txid: string = fx.sink.lastPingTxid();
  assert.equal(fx.ep.handlePong(txid, '127.3.3.40:17', ''), true, 'TxID 配对成功仍返回 true');
  assert.equal(fx.ep.bestAddr(), '', 'DERP 源 Pong ⇒ 不建立 bestAddr');
  assert.equal(fx.ep.trustBestAddrUntil(), 0, 'DERP 源 Pong ⇒ 不续期信任');
  assert.equal(fx.ep.sentPingCount(), 0, 'sentPing 表项已消费');

  // 场景二：已有 UDP bestAddr（UDP pong 建立）时，DERP 折返 Pong 不得刷新延迟/
  // 续期信任——否则直连死路径永不退回双发稳态（discoPingTimeout 恢复路径被吞）。
  const fx2 = makeEndpoint();
  feedStandard(fx2);
  fx2.ep.send(0);
  assert.equal(fx2.ep.handlePong(fx2.sink.lastPingTxid(), EP_A, EP_A), true, 'UDP pong 建立 bestAddr');
  assert.equal(fx2.ep.bestAddr(), EP_A);
  const trustAfterUdpPong: number = fx2.ep.trustBestAddrUntil();
  fx2.clock.advanceMs(5000); // 越过候选 5s 限速窗
  fx2.ep.sendDiscoPings(fx2.clock.monotonicMs(), false);
  const txid2: string = fx2.sink.lastPingTxid();
  assert.notEqual(txid2, '', '已发新一轮 discovery ping');
  assert.equal(fx2.ep.handlePong(txid2, '127.3.3.40:17', ''), true);
  assert.equal(fx2.ep.bestAddr(), EP_A, 'bestAddr 保持 UDP 直连路径不变');
  assert.equal(fx2.ep.trustBestAddrUntil(), trustAfterUdpPong, '信任期不被 DERP 折返 Pong 续期');
  // 对照：同路径的 ping 若 Pong 来自 UDP 源则必须续期（门控差异即本用例的断言点）。
  fx2.clock.advanceMs(5000);
  fx2.ep.sendDiscoPings(fx2.clock.monotonicMs(), false);
  const txid3: string = fx2.sink.lastPingTxid();
  fx2.clock.advanceMs(10);
  assert.equal(fx2.ep.handlePong(txid3, EP_A, EP_A), true);
  assert.equal(fx2.ep.trustBestAddrUntil(), fx2.clock.monotonicMs() + TRUST_UDP_ADDR_DURATION_MS, 'UDP 源 Pong ⇒ 同址续期 6.5s');
});

test('send 直连稳态：bestAddr 在信任期内 ⇒ 仅 UDP 直连、不并发 DERP、不再全 ping', () => {
  const fx = makeEndpoint([], -100_000);
  feedStandard(fx);
  fx.ep.send(0);
  replyPong(fx, fx.sink.lastPingTxid(), EP_A);
  const pingCountBefore: number = fx.sink.pings.length;
  const decision = fx.ep.send(0);
  assert.equal(decision.sent, true);
  assert.equal(decision.udpAddr, EP_A, '直连稳态：UDP 唯一路径');
  assert.equal(decision.derpRegionId, 0, '直连稳态不并发 DERP（endpoint.go:586-588）');
  assert.equal(fx.sink.pings.length, pingCountBefore, '稳态不再触发全 ping');
});

test('send 直连降级：信任期一过 ⇒ UDP(过期 bestAddr) + DERP 双发（不是二选一）', () => {
  const fx = makeEndpoint([], -100_000);
  feedStandard(fx);
  fx.ep.send(0);
  replyPong(fx, fx.sink.lastPingTxid(), EP_A);
  fx.clock.advanceMs(TRUST_UDP_ADDR_DURATION_MS + 1);
  const decision = fx.ep.send(0);
  assert.equal(decision.udpAddr, EP_A, '过期 bestAddr 仍随包发出（endpoint.go:597-599）');
  assert.equal(decision.derpRegionId, 17, '同时并发 DERP');
});

test('心跳循环：每 3s ping bestAddr；Pong 续期信任（闭环）；idle>45s 自停；silent disco 禁用', () => {
  const fx = makeEndpoint([], -100_000);
  feedStandard(fx);
  fx.ep.send(0); // t=1000（基准偏移后）
  replyPong(fx, fx.sink.lastPingTxid(), EP_A); // 信任到 1000+6500
  const trustAfterPong: number = fx.ep.trustBestAddrUntil();

  // 第 1 拍（t+3000）：ping bestAddr（Heartbeat 用途）；信任不被 ping 本身续期。
  fx.clock.advanceMs(HEARTBEAT_INTERVAL_MS);
  const fired: string[] = dispatchDue(fx);
  assert.deepEqual(fired, ['hb:' + NODE_KEY_HEX], '3s 心跳定时器触发');
  assert.equal(fx.sink.lastPingTo(), EP_A, '心跳 ping bestAddr');
  assert.equal(fx.sink.pings[fx.sink.pings.length - 1].purpose, DiscoPingPurpose.Heartbeat);
  assert.equal(fx.ep.trustBestAddrUntil(), trustAfterPong, '信任只由 Pong 续期，心跳拍本身不动信任');
  assert.equal(fx.scheduler.hasJob('hb:' + NODE_KEY_HEX), true, '心跳自续（下一拍）');
  // 心跳 Ping 的 Pong 回来 ⇒ 信任续期到 now+6.5s（endpoint.go:1804-1814 闭环）。
  replyPong(fx, fx.sink.pings[fx.sink.pings.length - 1].txidHex, EP_A);
  assert.equal(fx.ep.trustBestAddrUntil(), fx.clock.monotonicMs() + TRUST_UDP_ADDR_DURATION_MS);

  // idle：推进 46s（无外部发送）⇒ 下一拍停跳（endpoint.go:841-869）。
  fx.clock.advanceMs(46_000);
  const fired2: string[] = dispatchDue(fx);
  assert.deepEqual(fired2, ['hb:' + NODE_KEY_HEX], '上次挂的心跳拍触发');
  assert.equal(fx.scheduler.hasJob('hb:' + NODE_KEY_HEX), false, 'idle>45s ⇒ 心跳停止（不再武装）');
  // 停跳拍不再 ping：总 ping 数 = discovery 1 + heartbeat 1。
  assert.equal(fx.sink.pings.length, 2);

  // silent disco knob：重新触发后不再武装、不 ping。
  const fx2 = makeEndpoint([], -100_000);
  feedStandard(fx2);
  fx2.ep.setHeartbeatDisabled(true);
  fx2.ep.send(0);
  assert.equal(fx2.scheduler.hasJob('hb:' + NODE_KEY_HEX), false, 'heartbeatDisabled ⇒ 不启动心跳');
});

test('ping 超时：bestAddr 已过信任期 ⇒ 清 bestAddr（退 DERP-only）；信任期内不动作', () => {
  const fx = makeEndpoint([], -100_000);
  feedStandard(fx);
  fx.ep.send(0);
  replyPong(fx, fx.sink.lastPingTxid(), EP_A);
  assert.equal(fx.ep.bestAddr(), EP_A);

  // 推进到信任期外 ⇒ send 触发新一轮全 ping（新在途 ping），不回 Pong 让其超时。
  fx.clock.advanceMs(TRUST_UDP_ADDR_DURATION_MS + 1000);
  fx.ep.send(0);
  assert.equal(fx.sink.pings.length >= 2, true);
  const newTxid: string = fx.sink.lastPingTxid();
  fx.clock.advanceMs(PING_TIMEOUT_MS);
  fx.scheduler.fireDue(); // 超时定时器到期（状态机由调用方分派回调）
  fx.ep.discoPingTimeout(newTxid);
  assert.equal(fx.ep.bestAddr(), '', 'bestAddr 失信任且该地址 ping 超时 ⇒ 清除（endpoint.go:1187-1202）');

  // 信任期内超时不动作。
  const fx2 = makeEndpoint([], -100_000);
  feedStandard(fx2);
  fx2.ep.send(0);
  const txid2: string = fx2.sink.lastPingTxid();
  replyPong(fx2, txid2, EP_A);
  fx2.clock.advanceMs(1000); // 仍在 6.5s 信任期内
  fx2.ep.discoPingTimeout('ffffffffffffffffffffffff'); // 未知 txid 无副作用
  assert.equal(fx2.ep.bestAddr(), EP_A, '信任期内状态不动');
});

test('betterAddr：100→99ms 改进 1% 不切换（迟滞）；显著改进才切换；bestUntrusted 强制接管', () => {
  const fx = makeEndpoint([], -100_000);
  fx.ep.updateFromNode({
    discoKeyHex: DISCO_A,
    homeDerpRegionId: 17,
    endpoints: [EP_A, EP_B],
    expired: false,
    isWireGuardOnly: false,
  });
  fx.ep.send(0); // t=0：全 ping A、B
  assert.equal(fx.sink.pings.length, 2);

  fx.clock.advanceMs(100);
  replyPong(fx, fx.sink.pingTxidTo(EP_A), EP_A); // A 延迟 100ms ⇒ bestAddr=A
  assert.equal(fx.ep.bestAddr(), EP_A);

  fx.clock.advanceMs(4900); // t=5000：候选 lastPing 恰满 5s 限速窗口
  fx.ep.sendDiscoPings(fx.clock.monotonicMs(), false);
  assert.equal(fx.sink.pings.length, 4, '限速窗口过后两候选重新可 ping');

  fx.clock.advanceMs(99);
  replyPong(fx, fx.sink.pingTxidTo(EP_B), EP_B); // B 延迟 99ms
  assert.equal(
    fx.ep.bestAddr(),
    EP_A,
    'aPoints = 100-floor(99*100/100)=1 ≤1 且 bPoints=0 ⇒ 不切换（endpoint.go:1928-1938）',
  );

  fx.clock.advanceMs(5000); // t=10099：再满限速窗口
  fx.ep.sendDiscoPings(fx.clock.monotonicMs(), false);
  fx.clock.advanceMs(50);
  replyPong(fx, fx.sink.pingTxidTo(EP_B), EP_B); // B 延迟 50ms ⇒ 显著改进
  assert.equal(fx.ep.bestAddr(), EP_B, 'aPoints = 100-floor(50*100/100)=50 > 0 ⇒ 切换');

  // bestUntrusted：信任期过后，即使更差的延迟也先到先得。
  fx.clock.advanceMs(TRUST_UDP_ADDR_DURATION_MS + 1000); // 信任期过
  fx.ep.sendDiscoPings(fx.clock.monotonicMs(), false);
  fx.clock.advanceMs(200); // A 的 pong 延迟 200ms（比 B 的 50ms 差）
  replyPong(fx, fx.sink.pingTxidTo(EP_A), EP_A);
  assert.equal(fx.ep.bestAddr(), EP_A, 'bestUntrusted ⇒ 第一个 pong 接管（endpoint.go:1789-1790）');
});

test('入站 Ping：源登记为候选并回 Pong（Src=观察地址）；同 TxID 重复 ping 判重不回', () => {
  const fx = makeEndpoint([], -100_000);
  feedStandard(fx);
  const txid: Uint8Array = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const accepted: boolean = fx.ep.handlePing('198.51.100.77:5555', txid);
  assert.equal(accepted, true);
  assert.equal(fx.sink.pongs.length, 1);
  assert.equal(fx.sink.pongs[0].src, '198.51.100.77:5555', 'Pong.Src = 观察到的来包地址（disco.go:250-262）');
  assert.equal(fx.sink.pongs[0].to, '198.51.100.77:5555', 'Pong 发回来源地址');
  assert.equal(fx.ep.candidateAddrs().indexOf('198.51.100.77:5555') >= 0, true, '运行时候选已登记');
  // 同候选同 TxID 的重复 ping ⇒ 判重，不回 Pong（endpoint.go:1605-1615 duplicatePing）。
  const accepted2: boolean = fx.ep.handlePing('198.51.100.77:5555', txid);
  assert.equal(accepted2, false, '重复 TxID 判重');
  assert.equal(fx.sink.pongs.length, 1);
});

test('候选删除三分支：netmap 候选按哨兵删、运行时候选 45s 删、CMM 候选永不删', () => {
  const fx = makeEndpoint([], -100_000);
  feedStandard(fx); // netmap 候选 EP_A（index=0）
  fx.ep.handlePing('198.51.100.77:5555', new Uint8Array(12)); // 运行时候选
  assert.equal(fx.ep.handleCallMeMaybe(['198.51.100.80:6000'], true), true); // CMM 候选
  assert.equal(fx.ep.candidateCount(), 3);

  // netmap 刷新：EP_A 不再下发 ⇒ 哨兵删除；运行时与 CMM 候选豁免（endpoint.go:1557-1596）。
  fx.ep.setEndpoints([EP_B]);
  assert.equal(fx.ep.candidateAddrs().indexOf(EP_A), -1, 'netmap 候选不在新帧 ⇒ 删');
  assert.equal(fx.ep.candidateAddrs().indexOf('198.51.100.77:5555') >= 0, true, '运行时候选豁免');
  assert.equal(fx.ep.candidateAddrs().indexOf('198.51.100.80:6000') >= 0, true, 'CMM 候选豁免');

  // 运行时候选 45s 无入站 ping ⇒ 回收（sessionActiveTimeout）。
  fx.clock.advanceMs(46_000);
  fx.ep.setEndpoints([EP_B]);
  assert.equal(fx.ep.candidateAddrs().indexOf('198.51.100.77:5555'), -1, '运行时候选 45s 超时回收');
  assert.equal(fx.ep.candidateAddrs().indexOf('198.51.100.80:6000') >= 0, true, 'CMM 候选仍豁免');

  // 旧一轮 CMM 不在新消息 ⇒ 删除；本消息里的保留。
  assert.equal(fx.ep.handleCallMeMaybe(['198.51.100.81:6001'], true), true);
  assert.equal(fx.ep.candidateAddrs().indexOf('198.51.100.80:6000'), -1, '旧 CMM 端点删除');
  assert.equal(fx.ep.candidateAddrs().indexOf('198.51.100.81:6001') >= 0, true);
});

test('CMM 通道约束与防循环：UDP 通道丢弃；处理内互 ping 不回 CMM 且绕过 5s 限速', () => {
  const fx = makeEndpoint([], -100_000);
  feedStandard(fx);
  // UDP 通道的 CallMeMaybe 直接丢弃（magicsock.go:2350-2354）。
  assert.equal(fx.ep.handleCallMeMaybe(['198.51.100.90:7000'], false), false);
  assert.equal(fx.ep.candidateCount(), 1, '不产生候选');

  // DERP 通道：接受，并立即互 ping（lastPing 清零绕过限速），但不回 CMM（防死循环）。
  assert.equal(fx.ep.handleCallMeMaybe(['198.51.100.90:7000'], true), true);
  assert.equal(fx.ep.candidateCount(), 2);
  assert.equal(fx.sink.pings.length, 2, 'netmap 候选与 CMM 候选都被立即 ping');
  assert.equal(fx.sink.callMeMaybes.length, 0, 'sendCallMeMaybe=false ⇒ 不回 CMM（endpoint.go:2008-2009）');
});

test('expired peer：send 直接拒发（errExpired 语义，endpoint.go:1053-1057）', () => {
  const fx = makeEndpoint([], -100_000);
  feedStandard(fx);
  fx.ep.updateFromNode({
    discoKeyHex: DISCO_A,
    homeDerpRegionId: 17,
    endpoints: [EP_A],
    expired: true,
    isWireGuardOnly: false,
  });
  const decision = fx.ep.send(17);
  assert.equal(decision.sent, false);
  assert.equal(decision.rejection, SendRejection.Expired, '过期 peer 双重防御之一（推导层已剪，状态机再拒）');
});

test('无路径：无候选且无 home 且无学习路由 ⇒ 拒发；有学习路由 ⇒ 兜底 DERP', () => {
  const fx = makeEndpoint([], -100_000);
  fx.ep.updateFromNode({
    discoKeyHex: DISCO_A,
    homeDerpRegionId: 0, // 无 home
    endpoints: [],
    expired: false,
    isWireGuardOnly: false,
  });
  const none = fx.ep.send(0);
  assert.equal(none.sent, false);
  assert.equal(none.rejection, SendRejection.NoUdpOrDerp, 'errNoUDPOrDERP（endpoint.go:1076-1086）');
  const fallback = fx.ep.send(9);
  assert.equal(fallback.sent, true);
  assert.equal(fallback.derpRegionId, 9, 'fallbackDERPRegionForPeer 学到的 region 9 兜底');
});

test('updateFromNode：DiscoKey 轮换只换 key 不动路径；HomeDERP 迁移改写假地址 derp', () => {
  const fx = makeEndpoint([], -100_000);
  feedStandard(fx);
  fx.ep.send(0);
  replyPong(fx, fx.sink.lastPingTxid(), EP_A);
  assert.equal(fx.ep.bestAddr(), EP_A);
  assert.equal(fx.ep.candidateCount(), 1);

  // disco key 轮换（≠ node key 轮换）：bestAddr/候选不重置（endpoint.go:1521-1529）。
  fx.ep.updateFromNode({
    discoKeyHex: DISCO_B,
    homeDerpRegionId: 17,
    endpoints: [EP_A],
    expired: false,
    isWireGuardOnly: false,
  });
  assert.equal(fx.ep.discoKeyHex, DISCO_B);
  assert.equal(fx.ep.bestAddr(), EP_A, 'discokey 轮换不丢路径状态');
  assert.equal(fx.ep.candidateCount(), 1);

  // HomeDERP 迁移 + Endpoints 换血。
  fx.ep.updateFromNode({
    discoKeyHex: DISCO_B,
    homeDerpRegionId: 9,
    endpoints: [EP_B],
    expired: false,
    isWireGuardOnly: false,
  });
  assert.equal(fx.ep.derpHomeRegion(), 9, 'home 迁移（127.3.3.40:9 假地址语义）');
  assert.equal(fx.ep.candidateAddrs().indexOf(EP_B) >= 0, true);
  assert.equal(fx.ep.candidateAddrs().indexOf(EP_A), -1);
});

test('wireguard-only：无延迟随机挑（Rng 注入）只信 1s；收包学习信 5s；探测限速 10s', () => {
  const fx = makeEndpoint([5, 0, 0, 0], -100_000); // ArrayRng 首字 0x05 → idx = 5 % 2 = 1
  fx.ep.updateFromNode({
    discoKeyHex: '',
    homeDerpRegionId: 0,
    endpoints: [EP_A, EP_B],
    expired: false,
    isWireGuardOnly: true,
  });
  const decision = fx.ep.send(0);
  assert.equal(decision.sent, true);
  assert.equal(decision.derpRegionId, 0, 'wireguard-only 无 DERP 路径');
  assert.equal(decision.udpAddr, EP_B, '随机挑中第 2 个候选（Rng 确定性，endpoint.go:646）');
  assert.equal(fx.ep.trustBestAddrUntil(), fx.clock.monotonicMs() + 1000, '随机挑选只信 1s（endpoint.go:650-655）');
  assert.deepEqual(
    fx.sink.probes,
    [EP_A, EP_B],
    '多候选且从未 ping ⇒ 触发延迟探测（ICMP 等价 hook，endpoint.go:1408-1416）',
  );

  // 收包学习：源即路径，信 5s（endpoint.go:531-536）。
  fx.ep.noteRecvActivity(EP_A);
  assert.equal(fx.ep.bestAddr(), EP_A);
  assert.equal(fx.ep.trustBestAddrUntil(), fx.clock.monotonicMs() + WIREGUARD_ONLY_RECV_TRUST_MS);

  // 10s 探测限速：推进 5s 后再触发 wireguardOnlyPing ⇒ 不重复探测。
  fx.clock.advanceMs(5000);
  fx.ep.send(0);
  assert.equal(fx.sink.probes.length, 2, '距上次 full ping <10s ⇒ 探测被限速');
});

test('noteBadEndpoint/noteConnectivityChange：清 bestAddr + 候选派生态（候选保留）', () => {
  const fx = makeEndpoint([], -100_000);
  feedStandard(fx);
  fx.ep.send(0);
  replyPong(fx, fx.sink.lastPingTxid(), EP_A);
  assert.equal(fx.ep.bestAddr(), EP_A);
  fx.ep.noteBadEndpoint(EP_A);
  assert.equal(fx.ep.bestAddr(), '', '端点已坏 ⇒ 清 bestAddr（endpoint.go:1655-1666）');
  assert.equal(fx.ep.candidateAddrs().indexOf(EP_A) >= 0, true, '候选仍在，下轮重新评估');
  fx.ep.noteConnectivityChange();
  assert.equal(fx.ep.bestAddr(), '', 'Rebind 后全部重评估（endpoint.go:1668-1680）');
});

test('stopAndReset：回 DERP-only——清 bestAddr/sentPing/心跳定时器', () => {
  const fx = makeEndpoint([], -100_000);
  feedStandard(fx);
  fx.ep.send(0);
  assert.equal(fx.ep.sentPingCount(), 1);
  assert.equal(fx.scheduler.hasJob('hb:' + NODE_KEY_HEX), true);
  fx.ep.stopAndReset();
  assert.equal(fx.ep.sentPingCount(), 0, '在途 ping 清空（定时器一并取消）');
  assert.equal(fx.scheduler.hasJob('hb:' + NODE_KEY_HEX), false, '心跳定时器取消');
  assert.equal(fx.ep.bestAddr(), '');
});

test('状态快照：Active=lastSendExt<45s；CurAddr=直连时才填；Relay=home region', () => {
  const fx = makeEndpoint([], -100_000);
  feedStandard(fx);
  let snap = fx.ep.populatePeerStatus();
  assert.equal(snap.active, false, '从未外部发送 ⇒ 非 Active（endpoint.go:2041）');
  assert.equal(snap.relayRegionId, 17);
  fx.ep.send(0);
  replyPong(fx, fx.sink.lastPingTxid(), EP_A);
  snap = fx.ep.populatePeerStatus();
  assert.equal(snap.active, true);
  assert.equal(snap.curAddr, EP_A, '直连稳态 CurAddr=bestAddr');
  fx.clock.advanceMs(46_000);
  snap = fx.ep.populatePeerStatus();
  assert.equal(snap.active, false, '45s 活动线：Active 熄灭');
});

// ---- DERP 路由表 ----

test('DerpRouteTable：入站/发送学习路由 + 兜底查询 + PeerGone 删除 + 连接断清空该连接路由', () => {
  const clock: FixedClock = new FixedClock(0);
  const table: DerpRouteTable = new DerpRouteTable(clock, new ArrayRng(new Uint8Array([1, 0, 0, 0])), new ManualScheduler(clock));
  table.noteConnected(17);
  table.addPeerRoute(NODE_KEY_HEX, 17); // 入站 DERP 流量学习（derp.go:622-628）
  assert.equal(table.fallbackRegionForPeer(NODE_KEY_HEX), 17, '学习路由兜底（derp.go:71-89）');
  assert.equal(table.removePeerRoute('unknown'), false);
  table.noteSendToPeer('peer-x', 9); // 发送路径学习（derp.go:484-510）
  assert.equal(table.fallbackRegionForPeer('peer-x'), 9);
  // 连接断开 ⇒ 该连接上的路由全清（derp.go:563-598）。
  table.noteConnectionClosed(17, true);
  assert.equal(table.fallbackRegionForPeer(NODE_KEY_HEX), 0, '连接级清空');
  assert.equal(table.fallbackRegionForPeer('peer-x'), 9, '其他连接路由不受影响');
});

test('DerpRouteTable：home 迁移门控——离线不迁；UDP 全断但有 home ⇒ 保持；仅 homeless 才随机', () => {
  const clock: FixedClock = new FixedClock(0);
  const table: DerpRouteTable = new DerpRouteTable(clock, new ArrayRng(new Uint8Array([5, 0, 0, 0])), new ManualScheduler(clock));
  table.maybeSetNearestDerp(17, true, [17, 9]);
  assert.equal(table.homeRegion(), 17);
  // 控制面长轮询不在线 ⇒ 不迁移（derp.go:177-195）。
  const keep = table.maybeSetNearestDerp(9, false, [17, 9]);
  assert.equal(keep.changed, false);
  assert.equal(keep.regionId, 17);
  // UDP 全断（report=0）但已有 home ⇒ 保持不动（derp.go:138 `if c.myDerp != 0`，
  // 防 NotePreferred 风暴与对端路由失效——"we want to stay on it"）。
  const stayHome = table.maybeSetNearestDerp(0, true, [17, 9]);
  assert.equal(stayHome.changed, false, '已有 home ⇒ UDP 全断也不随机漂移');
  assert.equal(stayHome.regionId, 17);
  // 在线正常迁移。
  const moved = table.maybeSetNearestDerp(9, true, [17, 9]);
  assert.equal(moved.changed, true);
  assert.equal(moved.regionId, 9);

  // 仅 homeless（home==0）时才随机 fallback：字节 0x05 → 5%2=1 → region 9。
  const clock2: FixedClock = new FixedClock(0);
  const homeless: DerpRouteTable = new DerpRouteTable(clock2, new ArrayRng(new Uint8Array([5, 0, 0, 0])), new ManualScheduler(clock2));
  const fb = homeless.maybeSetNearestDerp(0, true, [17, 9]);
  assert.equal(fb.changed, true, 'homeless + UDP 全断 ⇒ 随机选定（derp.go:141-146，Rng 注入）');
  assert.equal(fb.regionId, 9, 'ArrayRng 字节 0x05 → idx 1 → 第二个 region');
});

test('DerpRouteTable：非 home 连接 60s 空闲回收，扫描仅在仍有连接时续期', () => {
  const clock: FixedClock = new FixedClock(0);
  const scheduler: ManualScheduler = new ManualScheduler(clock);
  const table: DerpRouteTable = new DerpRouteTable(clock, new ArrayRng(new Uint8Array([0, 0, 0, 0])), scheduler);
  // 真实调度器派发回调前会摘除 job：此处用"摘除 + 回调"模拟一次定时器触发。
  const fireDerpCleanup = (): void => {
    scheduler.cancel('derpclean');
    table.onCleanupTimer();
  };
  table.maybeSetNearestDerp(17, true, [17]);
  table.noteConnected(17); // home
  table.noteConnected(9); // 非 home
  table.addPeerRoute('p', 9);
  assert.equal(scheduler.hasJob('derpclean'), true, '有连接 ⇒ 15s 扫描定时器武装');
  clock.advanceMs(61_000);
  fireDerpCleanup();
  assert.equal(table.connCount(), 1, 'home 连接不因空闲回收（derp.go:997-1000）');
  assert.equal(table.homeRegion(), 17, 'home 标记不变');
  assert.equal(table.fallbackRegionForPeer('p'), 0, '被回收连接的学习路由连带清空');
  assert.equal(table.isCleanupArmed(), true, '仍有 home 连接 ⇒ 扫描续期');
  assert.equal(scheduler.hasJob('derpclean'), true);
  clock.advanceMs(15_000);
  fireDerpCleanup();
  assert.equal(table.connCount(), 1);
  // home 也关闭 ⇒ 无连接 ⇒ 扫描不再武装。
  table.noteConnectionClosed(17, false);
  clock.advanceMs(15_000);
  fireDerpCleanup();
  assert.equal(table.isCleanupArmed(), false, '无连接 ⇒ 定时器不再续期（derp.go:1029-1031）');
  assert.equal(scheduler.hasJob('derpclean'), false);
});

test('DerpRouteTable：regionForWrite 复用——请求 region 有连接直用；无连接查不到 ⇒ 0', () => {
  const clock: FixedClock = new FixedClock(0);
  const table: DerpRouteTable = new DerpRouteTable(clock, new ArrayRng(new Uint8Array([0, 0, 0, 0])), new ManualScheduler(clock));
  table.noteConnected(17);
  table.addPeerRoute('peer-x', 9); // 对端曾从 region 9 出现（Issue 150 语义）
  const direct = table.regionForWrite(17, 'peer-x');
  assert.equal(direct.regionId, 17);
  assert.equal(direct.reusedLearnedRoute, false);
  const none = table.regionForWrite(9, 'peer-x');
  assert.equal(none.regionId, 0, 'region 9 无连接 ⇒ 0（调用方新建连接后回填）');
  table.noteConnected(9);
  const via9 = table.regionForWrite(9, 'peer-x');
  assert.equal(via9.regionId, 9);
});
