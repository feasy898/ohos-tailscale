/**
 * peer 连接状态机（C2 子线：magicsock per-peer endpoint 的纯 TS 复合建模）。
 *
 * 上游没有单一"peer 连接状态机"，本类是 v1.102.3 wgengine/magicsock/endpoint.go
 * 的 per-peer `endpoint` + `endpointState`（候选层）复合体，事件驱动、时钟/随机/
 * 定时器/出口全部构造注入（P4；定时器接口 TimeoutScheduler 定义在本包不进 common，
 * 对齐 architecture.md §10.1 冻结规则）。全部行号为 v1.102.3 实拉核对（2026-10-02）：
 *
 * - 状态载体：bestAddr(addrQuality: 地址+延迟)+bestAddrAt+trustBestAddrUntil
 *   （endpoint.go:63-107, 1841-1846）、sentPing 表（:387-394）、endpointState 候选表
 *   （:396-435）、derpAddr=127.3.3.40:regionID 假地址（:1540；ts-main/tailcfg.go:3072-3079）；
 * - 候选删除三分支 shouldDeleteLocked（endpoint.go:455-467）：CMM 候选永不删；
 *   netmap 候选按 index 哨兵；运行时候选按 lastGotPing 超 sessionActiveTimeout(45s)；
 * - 发送决策 addrForSendLocked（endpoint.go:583-600）：bestAddr 有效且在信任期内 ⇒
 *   仅 UDP 直连（不并发 DERP）；wireguard-only ⇒ 有延迟选最低（同延迟 v6 优先，
 *   :628-636）/ 无数据随机挑只信 1s（:640-655）；其余 ⇒ 过期 bestAddr + DERP 双发；
 * - 心跳 heartbeat（endpoint.go:820-886）：由外部发送触发（noteTxActivityExtTrigger
 *   :965-970，wireguard-go/CLI 发包才启动 3s 心跳）；idle(lastSendExt)>45s 停；
 *   有 bestAddr 则 ping 它；wantFullPingLocked（:946-963）⇒ 全 ping + CMM；
 * - Pong 处理 handlePongConnLocked（endpoint.go:1724-1817）：未知 TxID 直接忽略
 *   （不迁移！防伪造/重放）；非 DERP 源记候选 pong；betterAddr（:1885-1941 打分制，
 *   改进 ≤1% 不切换防抖）或 bestUntrusted ⇒ setBestAddr；同址 ⇒ 只刷新延迟 +
 *   信任续期 6.5s（:1804-1814，心跳⇒信任续期闭环）；
 * - Ping 超时 discoPingTimeout（endpoint.go:1187-1202）：仅当超时的是 bestAddr 且
 *   已过信任期 ⇒ clearBestAddr（回退 DERP-only）；信任期内超时不动作；
 * - CallMeMaybe（endpoint.go:1947-2027）：只许 DERP 通道（magicsock.go:2350-2354，
 *   UDP 来的 CMM 丢弃）；旧一轮 CMM 端点不在新消息 ⇒ 删除；全部候选 lastPing 清零
 *   后立即 sendDiscoPingsLocked(now, **false**)（防 CMM 死循环）；CMM 前置自端点
 *   新鲜度 27s（magicsock.go:2653-2694，不新鲜先 ReSTUN 挂起，完成后补发）；
 * - 入站 Ping（magicsock.go:2547-2644）：源登记为候选（已在表且 TxID 重复 ⇒ 判重
 *   不回 Pong）；Pong.Src = 观察到的来包地址（对方借此学自端点）；
 * - netmap 事件 updateFromNode（endpoint.go:1500-1555）：expired 记录；DiscoKey
 *   变化只 updateDiscoKey（bestAddr/候选不重置，旧 key 在途包解封失败被静默）；
 *   HomeDERP=0 清 derp，否则假地址；setEndpointsLocked 全量重建候选（先全标
 *   indexSentinelDeleted → 回填/新建 → 删掉不在 netmap 又非运行时候选）；
 * - expired peer 的 send 直接拒发（endpoint.go:1053-1057 errExpired）；
 * - noteRecvActivity（endpoint.go:525-541）：wireguard-only ⇒ bestAddr=源、信 5s；
 *   普通 peer 仅在心跳被禁且同址时续期信任；
 * - noteBadEndpoint/noteConnectivityChange（endpoint.go:1655-1680）：清 bestAddr +
 *   候选派生态（clear() 保留 index/lastGotPing，endpoint.go:427-433）；
 * - 状态快照 populatePeerStatus（endpoint.go:2029-2050）：Active = lastSendExt 距今
 *   <45s；CurAddr = bestAddr 直连时才填；Relay = derpAddr region。
 *
 * 边界（不实现，如实记录）：UDP peer-relay/relayManager 与 disco 0x04-0x09 属子线
 * B1；netcheck/周期 ReSTUN 调度属 B2（本类只经 SelfEndpointsView 消费"自端点新鲜度"
 * 与 refresh 请求）；MTU 探测（peer-mtu-enable knob）不在本类。
 */

import { type Clock, type Rng, hexEncode } from '@ohos-tailscale/common';
import {
  isDerpMagicAddrPort,
  isLinkLocalUnicastAddr,
  isLoopbackAddr,
  isPrivateAddr,
  tryParseIpPort,
  type IpAddr,
  type IpPort,
} from './netaddr.ts';
import {
  CANDIDATE_PRUNE_THRESHOLD,
  DiscoPingPurpose,
  DISCO_PING_INTERVAL_MS,
  ENDPOINTS_FRESH_ENOUGH_MS,
  GOOD_ENOUGH_LATENCY_MS,
  HEARTBEAT_INTERVAL_MS,
  INDEX_SENTINEL_DELETED,
  PING_TIMEOUT_MS,
  PONG_HISTORY_COUNT,
  SendRejection,
  SESSION_ACTIVE_TIMEOUT_MS,
  TRUST_UDP_ADDR_DURATION_MS,
  UPGRADE_UDP_DIRECT_INTERVAL_MS,
  WIREGUARD_ONLY_PROBE_MIN_INTERVAL_MS,
  WIREGUARD_ONLY_RECV_TRUST_MS,
  WIREGUARD_PING_INTERVAL_MS,
} from './smconsts.ts';

/**
 * 超时调度注入接口（C2 §8；上游 time.AfterFunc 的最小化形态）。
 * after 注册"ms 毫秒后回调 onTimeout(id)"，cancel 取消；实现方负责与同一 Clock
 * 的单调轴联动（app/bridge 先给确定性实现，测试用手动推拍）。
 */
export interface TimeoutScheduler {
  after(id: string, ms: number): void;
  cancel(id: string): void;
}

/** 状态机的对外发送出口（disco 报文与 wireguard-only 探测的注入点）。 */
export interface PeerSink {
  /** 发 disco Ping（txid 12B 随机；purpose 见 DiscoPingPurpose）。 */
  sendDiscoPing(peerId: string, toAddrPort: string, txid: Uint8Array, purpose: number): void;
  /** 回 disco Pong；observedSrcAddrPort = 观察到的来包地址（Pong.Src 语义）。 */
  sendPong(peerId: string, toAddrPort: string, txid: Uint8Array, observedSrcAddrPort: string): void;
  /** 经 DERP 发 CallMeMaybe（MyNumber = 自端点列表由 sink 层携带）。 */
  sendCallMeMaybe(peerId: string, viaDerpRegionId: number): void;
  /** wireguard-only 候选延迟探测（上游为 ICMP ping，endpoint.go:1436）。 */
  sendWireGuardOnlyProbe(peerId: string, toAddrPort: string): void;
}

/** 自端点（STUN 映射）新鲜度视图（ReSTUN 调度属 B2，本类只消费/请求）。 */
export interface SelfEndpointsView {
  /** 自端点集合最近一次刷新的单调 ms；0 = 从未。 */
  lastRefreshMonoMs(): number;
  /** 请求刷新（上游 ReSTUN("refresh-for-peering")，magicsock.go:2673-2679）。 */
  requestRefresh(why: string): void;
}

/** 状态机构造依赖（全部注入，P4）。 */
export interface PeerEndpointDeps {
  clock: Clock;
  rng: Rng;
  scheduler: TimeoutScheduler;
  sink: PeerSink;
  selfEndpoints: SelfEndpointsView;
}

/** netmap 喂入口参数（endpoint.updateFromNode 消费的 Node 字段子集）。 */
export interface PeerNodeView {
  discoKeyHex: string;
  homeDerpRegionId: number;
  endpoints: string[];
  expired: boolean;
  isWireGuardOnly: boolean;
}

/** send() 的决策结果（endpoint.go:1052-1149 send 的返回面）。 */
export interface SendDecision {
  /** false = 拒发（expired 或无路径）。 */
  sent: boolean;
  /** sent=false 时的原因（SendRejection 常量；sent=true 时为 0）。 */
  rejection: number;
  /** UDP 直连目的（'' = 无）。 */
  udpAddr: string;
  /** DERP 目的 region ID（0 = 无）。 */
  derpRegionId: number;
  /** wireguard-only 候选需要延迟探测（addrForSend 的 sendWGPing）。 */
  wireguardOnlyPing: boolean;
}

/** 候选 pong 记录（pongReply，endpoint.go:437-442）。 */
export interface PongReply {
  latencyMs: number;
  atMonoMs: number;
  fromAddrPort: string;
  /** 对端报告的"它眼中的我"（Pong.Src 原样记录）。 */
  reportedSrc: string;
}

/** 候选地址状态（endpointState，endpoint.go:396-435）。 */
interface PeerCandidate {
  addrPort: string;
  /** 本候选上次出站 ping（单调 ms；0 = 从未；心跳 ping 也写、也占限速额度）。 */
  lastPingMonoMs: number;
  /** 非 0 = 运行时从入站 ping 学习的候选（不在 netmap）；0 = netmap 下发。 */
  lastGotPingMonoMs: number;
  lastGotPingWallMs: number;
  lastGotPingTxIdHex: string;
  /** 非 0 = 本轮 CallMeMaybe 广告过的端点（永不删，shouldDelete 第一分支）。 */
  callMeMaybeWallMs: number;
  /** netmap Endpoints 序号（刷新期先标哨兵）。 */
  index: number;
  /** pong 环形历史（尾部 = 最新 = latencyLocked 的"最近一次"）。 */
  recentPongs: PongReply[];
}

/** 在途 disco Ping 记录（sentPing，endpoint.go:387-394）。 */
interface SentPingRecord {
  toAddrPort: string;
  atMonoMs: number;
  purpose: number;
}

/** 状态快照（populatePeerStatus，endpoint.go:2029-2050）。 */
export interface PeerStatusSnapshot {
  /** lastSendExt 距今 <45s（外部发送活动线，三处共用）。 */
  active: boolean;
  /** bestAddr 直连时才有值（'' = 无）。 */
  curAddr: string;
  /** derpAddr 的 region ID（0 = 无 home）。 */
  relayRegionId: number;
}

/** 心跳定时器 id 前缀（per-peer 唯一）。 */
const HB_TIMER_PREFIX: string = 'hb:';
/** 在途 ping 超时定时器 id 前缀（txid 唯一）。 */
const PING_TIMER_PREFIX: string = 'ping:';

export class PeerEndpoint {
  /** 对端 node 公钥 64 hex（= WG 层 endpoint = peerId）。 */
  public readonly peerId: string;
  /** disco 公钥 hex（变化只 updateDiscoKey，不重置路径状态）。 */
  public discoKeyHex: string = '';
  public expired: boolean = false;
  public isWireGuardOnly: boolean = false;
  /** silent disco knob 映射（heartbeatDisabled，endpoint.go:830-833）。 */
  public heartbeatDisabled: boolean = false;

  private deps: PeerEndpointDeps;
  private candidates: Map<string, PeerCandidate> = new Map();
  private sentPings: Map<string, SentPingRecord> = new Map();
  private bestAddrPort: string = '';
  private bestAddrLatencyMs: number = 0;
  private bestAddrAtMonoMs: number = 0;
  private trustBestAddrUntilMonoMs: number = 0;
  private derpRegionId: number = 0;
  private heartbeatArmed: boolean = false;
  private lastSendExtMonoMs: number = 0;
  private lastSendAnyMonoMs: number = 0;
  private lastFullPingMonoMs: number = 0;
  private lastPingFromAddr: string = '';
  private lastPingWallMs: number = 0;
  /** CMM 因自端点不新鲜而挂起（onEndpointRefreshed 释放，magicsock.go:2662-2679）。 */
  private pendingCallMeMaybe: boolean = false;

  constructor(peerId: string, deps: PeerEndpointDeps) {
    this.peerId = peerId;
    this.deps = deps;
  }

  // ---- netmap 喂入口（C1↔C2 接缝） ----

  /**
   * updateFromNode（endpoint.go:1500-1555）：expired/DiscoKey/HomeDERP/Endpoints。
   * DiscoKey 变化只换 key（候选与 bestAddr 不动）；HomeDERP 变化改写假地址 derp；
   * Endpoints 全量重建候选（哨兵法）。
   */
  public updateFromNode(view: PeerNodeView): void {
    this.expired = view.expired;
    this.isWireGuardOnly = view.isWireGuardOnly;
    if (this.discoKeyHex !== view.discoKeyHex) {
      // updateDiscoKey：不重置 bestAddr/候选（endpoint.go:1521-1529）。
      this.discoKeyHex = view.discoKeyHex;
    }
    this.setDerpHome(view.homeDerpRegionId);
    this.setEndpoints(view.endpoints);
  }

  /** setDERPHome（endpoint.go:2107-2114）：region 0 = 清 derp；否则假地址改写。 */
  public setDerpHome(regionId: number): void {
    this.derpRegionId = regionId > 0 ? regionId : 0;
  }

  /** setEndpointsLocked（endpoint.go:1557-1596）：哨兵重建 + shouldDelete 清理。 */
  public setEndpoints(endpoints: string[]): void {
    this.candidates.forEach((st: PeerCandidate): void => {
      st.index = INDEX_SENTINEL_DELETED;
    });
    for (let i: number = 0; i < endpoints.length; i += 1) {
      const ep: string = endpoints[i];
      const existing: PeerCandidate | undefined = this.candidates.get(ep);
      if (existing !== undefined) {
        existing.index = i;
      } else {
        const st: PeerCandidate = emptyCandidate(ep, i);
        this.candidates.set(ep, st);
      }
    }
    const now: number = this.deps.clock.monotonicMs();
    const stale: string[] = [];
    this.candidates.forEach((st: PeerCandidate, ep: string): void => {
      if (shouldDeleteCandidate(st, now)) {
        stale.push(ep);
      }
    });
    for (const ep of stale) {
      this.deleteCandidate(ep);
    }
  }

  // ---- 发送路径 ----

  /**
   * send（endpoint.go:1052-1149）：expired 直接拒；算路径；非稳态触发全 ping+CMM；
   * 记外部发送活动（启动心跳）。fallbackDerpRegionId = DerpRouteTable 学习的兜底
   * region（fallbackDERPRegionForPeer，endpoint.go:1076-1086；0 = 无）。
   */
  public send(fallbackDerpRegionId: number): SendDecision {
    if (this.expired) {
      const rejected: SendDecision = {
        sent: false,
        rejection: SendRejection.Expired,
        udpAddr: '',
        derpRegionId: 0,
        wireguardOnlyPing: false,
      };
      return rejected;
    }
    const now: number = this.deps.clock.monotonicMs();
    const paths: SendPaths = this.addrForSend(now);
    if (this.isWireGuardOnly) {
      if (paths.wireguardOnlyPing) {
        this.sendWireGuardOnlyPings(now);
      }
    } else if (!isDirectAddr(paths.udpAddr) || now > this.trustBestAddrUntilMonoMs) {
      // 出站流量本身就是打洞触发器（endpoint.go:1066-1071）。
      this.sendDiscoPings(now, true);
    }
    this.noteTxActivityExtTrigger(now);
    this.lastSendAnyMonoMs = now;

    let udpAddr: string = paths.udpAddr;
    let derpRegion: number = paths.derpRegionId;
    if (udpAddr === '' && derpRegion === 0) {
      if (fallbackDerpRegionId !== 0) {
        derpRegion = fallbackDerpRegionId;
      } else {
        const noPath: SendDecision = {
          sent: false,
          rejection: SendRejection.NoUdpOrDerp,
          udpAddr: '',
          derpRegionId: 0,
          wireguardOnlyPing: false,
        };
        return noPath;
      }
    }
    const decision: SendDecision = {
      sent: true,
      rejection: 0,
      udpAddr: udpAddr,
      derpRegionId: derpRegion,
      wireguardOnlyPing: paths.wireguardOnlyPing,
    };
    return decision;
  }

  /** addrForSendLocked（endpoint.go:583-600）三分支。 */
  private addrForSend(now: number): SendPaths {
    if (this.bestAddrPort !== '' && now <= this.trustBestAddrUntilMonoMs) {
      // 直连稳态：唯一路径，不并发 DERP。
      const steady: SendPaths = {
        udpAddr: this.bestAddrPort,
        derpRegionId: 0,
        wireguardOnlyPing: false,
      };
      return steady;
    }
    if (this.isWireGuardOnly) {
      return this.addrForWireGuardSend(now);
    }
    // 直连降级稳态：过期 bestAddr + DERP 双发（不是二选一）。
    const degraded: SendPaths = {
      udpAddr: this.bestAddrPort,
      derpRegionId: this.derpRegionId,
      wireguardOnlyPing: false,
    };
    return degraded;
  }

  /** addrForWireGuardSendLocked（endpoint.go:610-657）。 */
  private addrForWireGuardSend(now: number): SendPaths {
    let lowestLatencyMs: number = Number.MAX_SAFE_INTEGER;
    let chosen: string = '';
    let oldestPing: number = 0;
    let oldestSet: boolean = false;
    this.candidates.forEach((st: PeerCandidate, ep: string): void => {
      // 上游零值语义：任何候选从未 ping 过 ⇒ oldestPing 停在零 ⇒ needPing=true。
      if (!oldestSet) {
        oldestPing = st.lastPingMonoMs;
        oldestSet = true;
      } else if (st.lastPingMonoMs < oldestPing) {
        oldestPing = st.lastPingMonoMs;
      }
      const latency: number = latestPongLatency(st);
      if (latency >= 0) {
        if (
          chosen === '' ||
          latency < lowestLatencyMs ||
          (latency === lowestLatencyMs && isV6AddrPort(ep) && !isV6AddrPort(chosen))
        ) {
          lowestLatencyMs = latency;
          chosen = ep;
        }
      }
    });
    // 上游零值语义：mono.Time 零值经 Sub 得到大间隔 ⇒ 从未 ping 过 ⇒ needPing=true。
    const oldestNever: boolean = oldestPing === 0;
    const needPing: boolean =
      this.candidates.size > 1 &&
      (oldestNever || now - oldestPing > WIREGUARD_PING_INTERVAL_MS);
    if (chosen === '') {
      // 无延迟数据 ⇒ 随机挑一个（Rng 注入；endpoint.go:646）。
      const keys: string[] = [];
      this.candidates.forEach((_st: PeerCandidate, ep: string): void => {
        keys.push(ep);
      });
      if (keys.length > 0) {
        const idx: number = randomIndex(this.deps.rng, keys.length);
        chosen = keys[idx];
      }
    }
    if (chosen !== '') {
      this.bestAddrPort = chosen;
      // 只信 1s，防随机抖动（endpoint.go:650-655）；延迟字段保持旧值。
      this.trustBestAddrUntilMonoMs = now + 1000;
    }
    const out: SendPaths = {
      udpAddr: chosen,
      derpRegionId: 0,
      wireguardOnlyPing: needPing,
    };
    return out;
  }

  /** sendWireGuardOnlyPingsLocked（endpoint.go:1408-1416）：10s 限速 + 逐候选探测。 */
  private sendWireGuardOnlyPings(now: number): void {
    if (now - this.lastFullPingMonoMs < WIREGUARD_ONLY_PROBE_MIN_INTERVAL_MS && this.lastFullPingMonoMs !== 0) {
      return;
    }
    this.lastFullPingMonoMs = now;
    this.candidates.forEach((_st: PeerCandidate, ep: string): void => {
      this.deps.sink.sendWireGuardOnlyProbe(this.peerId, ep);
    });
  }

  // ---- 心跳 ----

  /** 心跳定时器回调（每 3s 一拍；endpoint.go:820-886）。 */
  public heartbeat(): void {
    this.heartbeatArmed = false;
    if (this.heartbeatDisabled) {
      return;
    }
    if (this.lastSendExtMonoMs === 0) {
      // 上游 "Shouldn't happen"：心跳只因外部发送启动。
      return;
    }
    const now: number = this.deps.clock.monotonicMs();
    if (now - this.lastSendExtMonoMs > SESSION_ACTIVE_TIMEOUT_MS) {
      // 会话空闲，停止心跳（endpoint.go:841-869）。
      return;
    }
    if (this.bestAddrPort !== '') {
      // 心跳 ping bestAddr（占候选 5s 限速额度——刻意防风暴，endpoint.go:1310-1320）。
      this.startDiscoPing(this.bestAddrPort, now, DiscoPingPurpose.Heartbeat);
    }
    if (this.wantFullPing(now)) {
      this.sendDiscoPings(now, true);
    }
    this.armHeartbeat();
  }

  /** wantFullPingLocked（endpoint.go:946-963）。 */
  private wantFullPing(now: number): boolean {
    if (!isDirectAddr(this.bestAddrPort) || this.lastFullPingMonoMs === 0) {
      return true;
    }
    if (now > this.trustBestAddrUntilMonoMs) {
      return true;
    }
    if (this.bestAddrLatencyMs <= GOOD_ENOUGH_LATENCY_MS) {
      return false;
    }
    if (now - this.lastFullPingMonoMs >= UPGRADE_UDP_DIRECT_INTERVAL_MS) {
      return true;
    }
    return false;
  }

  /** noteTxActivityExtTriggerLocked（endpoint.go:965-970）：外部发送 ⇒ 启动心跳。 */
  private noteTxActivityExtTrigger(now: number): void {
    this.lastSendExtMonoMs = now;
    if (!this.heartbeatArmed && !this.heartbeatDisabled) {
      this.armHeartbeat();
    }
  }

  private armHeartbeat(): void {
    if (this.heartbeatArmed || this.heartbeatDisabled) {
      return;
    }
    this.heartbeatArmed = true;
    this.deps.scheduler.after(HB_TIMER_PREFIX + this.peerId, HEARTBEAT_INTERVAL_MS);
  }

  // ---- 全 ping / 单 ping ----

  /**
   * sendDiscoPingsLocked（endpoint.go:1367-1405）：逐候选（限速 5s 内跳过）；
   * sentAny && sendCallMeMaybe && 有 DERP ⇒ 请求 CMM（fresh 门控）。
   * sendCallMeMaybe=false 是 handleCallMeMaybe 的防循环关键（endpoint.go:2008-2009）。
   */
  public sendDiscoPings(now: number, sendCallMeMaybe: boolean): void {
    this.lastFullPingMonoMs = now;
    let sentAny: boolean = false;
    const toDelete: string[] = [];
    this.candidates.forEach((st: PeerCandidate, ep: string): void => {
      if (shouldDeleteCandidate(st, now)) {
        toDelete.push(ep);
        return;
      }
      if (st.lastPingMonoMs !== 0 && now - st.lastPingMonoMs < DISCO_PING_INTERVAL_MS) {
        return;
      }
      sentAny = true;
      this.startDiscoPing(ep, now, DiscoPingPurpose.Discovery);
    });
    for (const ep of toDelete) {
      this.deleteCandidate(ep);
    }
    if (sentAny && sendCallMeMaybe && this.derpRegionId !== 0) {
      this.requestCallMeMaybe();
    }
  }

  /** startDiscoPingLocked（endpoint.go:1299-1341）。 */
  private startDiscoPing(addrPort: string, now: number, purpose: number): void {
    if (purpose !== DiscoPingPurpose.Cli) {
      const st: PeerCandidate | undefined = this.candidates.get(addrPort);
      if (st === undefined) {
        // 不 ping 已不活跃的候选（endpoint.go:1313-1316）。
        return;
      }
      st.lastPingMonoMs = now;
    }
    const txid: Uint8Array = new Uint8Array(12);
    this.deps.rng.randomBytes(txid);
    const txidHex: string = hexEncode(txid);
    const record: SentPingRecord = { toAddrPort: addrPort, atMonoMs: now, purpose: purpose };
    this.sentPings.set(txidHex, record);
    this.deps.scheduler.after(PING_TIMER_PREFIX + txidHex, PING_TIMEOUT_MS);
    this.deps.sink.sendDiscoPing(this.peerId, addrPort, txid, purpose);
  }

  /** 在途 ping 数（诊断/测试）。 */
  public sentPingCount(): number {
    return this.sentPings.size;
  }

  // ---- CallMeMaybe ----

  /** enqueueCallMeMaybe（magicsock.go:2653-2694）：27s 新鲜度门控 + 挂起补发。 */
  public requestCallMeMaybe(): void {
    if (this.derpRegionId === 0) {
      return;
    }
    const now: number = this.deps.clock.monotonicMs();
    const last: number = this.deps.selfEndpoints.lastRefreshMonoMs();
    const fresh: boolean = last !== 0 && now - last <= ENDPOINTS_FRESH_ENOUGH_MS;
    if (!fresh) {
      this.pendingCallMeMaybe = true;
      this.deps.selfEndpoints.requestRefresh('refresh-for-peering');
      return;
    }
    this.deps.sink.sendCallMeMaybe(this.peerId, this.derpRegionId);
  }

  /** ReSTUN 完成回调：释放挂起的 CMM（onEndpointRefreshed，magicsock.go:2662-2679）。 */
  public onSelfEndpointsRefreshed(): void {
    if (!this.pendingCallMeMaybe) {
      return;
    }
    this.pendingCallMeMaybe = false;
    if (this.derpRegionId !== 0) {
      this.deps.sink.sendCallMeMaybe(this.peerId, this.derpRegionId);
    }
  }

  /** 挂起中的 CMM（诊断/测试）。 */
  public hasPendingCallMeMaybe(): boolean {
    return this.pendingCallMeMaybe;
  }

  // ---- 入站事件 ----

  /**
   * handlePongConnLocked（endpoint.go:1724-1817）。返回是否配到在途 TxID；
   * 未知 TxID 一律 false 且不做任何迁移（防伪造/重放）。
   * 经 DERP 折返的 Pong（src=127.3.3.40:region 假地址）只消费 TxID 配对——
   * recentPongs 记录、bestAddr 迁移与同址 6.5s 信任续期整块都在 `!isDerp`
   * 门控内（endpoint.go:1787-1815）：UDP 单向不通、Pong 经 DERP 折返时
   * 不得为 UDP 路径建立/续期信任，否则直连死路径无法经 discoPingTimeout
   * 退回"UDP+DERP 双发"稳态。
   */
  public handlePong(txidHex: string, srcAddrPort: string, reportedSrc: string): boolean {
    const sp: SentPingRecord | undefined = this.sentPings.get(txidHex);
    if (sp === undefined) {
      return false;
    }
    this.deps.scheduler.cancel(PING_TIMER_PREFIX + txidHex);
    this.sentPings.delete(txidHex);

    const now: number = this.deps.clock.monotonicMs();
    const latencyMs: number = now - sp.atMonoMs;
    const isDerpSrc: boolean = isDerpMagicAddrPort(srcAddrPort);
    if (!isDerpSrc) {
      const st: PeerCandidate | undefined = this.candidates.get(sp.toAddrPort);
      if (st === undefined) {
        // 候选已删 ⇒ "no longer an endpoint we care about"，早退不迁移
        // （endpoint.go:1754-1758 的裸 return；knownTxID 仍为 true）。
        return true;
      }
      const reply: PongReply = {
        latencyMs: latencyMs,
        atMonoMs: now,
        fromAddrPort: srcAddrPort,
        reportedSrc: reportedSrc,
      };
      st.recentPongs.push(reply);
      if (st.recentPongs.length > PONG_HISTORY_COUNT) {
        st.recentPongs.shift();
      }
      // bestAddr 迁移：betterAddr 或 bestUntrusted ⇒ setBestAddr（非 DERP 源限定）。
      const bestUntrusted: boolean = now > this.trustBestAddrUntilMonoMs;
      const candidateQuality: AddrQuality = { addrPort: sp.toAddrPort, latencyMs: latencyMs };
      const currentQuality: AddrQuality = { addrPort: this.bestAddrPort, latencyMs: this.bestAddrLatencyMs };
      if (betterAddr(candidateQuality, currentQuality) || bestUntrusted) {
        this.setBestAddr(sp.toAddrPort, latencyMs, now);
      }
      if (this.bestAddrPort === sp.toAddrPort) {
        // 同址：刷新延迟 + 信任续期 6.5s（心跳⇒信任续期闭环，endpoint.go:1804-1814）。
        this.bestAddrLatencyMs = latencyMs;
        this.bestAddrAtMonoMs = now;
        this.trustBestAddrUntilMonoMs = now + TRUST_UDP_ADDR_DURATION_MS;
      }
    }
    return true;
  }

  /**
   * handlePingLocked（magicsock.go:2547-2644）的 per-peer 面：源登记/刷新为候选，
   * 判重（同候选同 TxID 的重复 ping 不回 Pong），回 Pong（Src=观察地址）。
   */
  public handlePing(srcAddrPort: string, txid: Uint8Array): boolean {
    const nowWall: number = this.deps.clock.wallMs();
    // likelyHeartBeat 只影响日志（magicsock.go:2548），不影响处理。
    this.lastPingFromAddr = srcAddrPort;
    this.lastPingWallMs = nowWall;
    const txidHex: string = hexEncode(txid);
    const dup: boolean = this.addCandidateEndpoint(srcAddrPort, txidHex);
    if (dup) {
      return false;
    }
    this.deps.sink.sendPong(this.peerId, srcAddrPort, txid, srcAddrPort);
    return true;
  }

  /** addCandidateEndpoint（endpoint.go:1605-1644）。 */
  public addCandidateEndpoint(addrPort: string, forRxPingTxIdHex: string): boolean {
    const existing: PeerCandidate | undefined = this.candidates.get(addrPort);
    const nowMono: number = this.deps.clock.monotonicMs();
    const nowWall: number = this.deps.clock.wallMs();
    if (existing !== undefined) {
      let dup: boolean = forRxPingTxIdHex === existing.lastGotPingTxIdHex;
      if (!dup) {
        existing.lastGotPingTxIdHex = forRxPingTxIdHex;
      }
      if (existing.lastGotPingMonoMs === 0) {
        // 已知 netmap 候选：只刷新 TxID，不转运行时来源。
        return dup;
      }
      existing.lastGotPingMonoMs = nowMono;
      existing.lastGotPingWallMs = nowWall;
      return dup;
    }
    const st: PeerCandidate = emptyCandidate(addrPort, INDEX_SENTINEL_DELETED);
    st.lastGotPingMonoMs = nowMono;
    st.lastGotPingWallMs = nowWall;
    st.lastGotPingTxIdHex = forRxPingTxIdHex;
    this.candidates.set(addrPort, st);
    if (this.candidates.size > CANDIDATE_PRUNE_THRESHOLD) {
      const stale: string[] = [];
      this.candidates.forEach((c: PeerCandidate, ep: string): void => {
        if (shouldDeleteCandidate(c, nowMono)) {
          stale.push(ep);
        }
      });
      for (const ep of stale) {
        this.deleteCandidate(ep);
      }
    }
    return false;
  }

  /**
   * handleCallMeMaybe（endpoint.go:1947-2027）。viaDerpChannel=false ⇒ 丢弃
   * （CMM 只许 DERP 通道，magicsock.go:2350-2354）。返回是否被接受。
   */
  public handleCallMeMaybe(endpoints: string[], viaDerpChannel: boolean): boolean {
    if (!viaDerpChannel) {
      return false;
    }
    const nowWall: number = this.deps.clock.wallMs();
    // 上一轮 CMM 端点先标记待复核。
    const previousCmm: string[] = [];
    this.candidates.forEach((st: PeerCandidate, ep: string): void => {
      if (st.callMeMaybeWallMs !== 0) {
        previousCmm.push(ep);
      }
    });
    for (const ep of endpoints) {
      if (isV6LinkLocalAddrPort(ep)) {
        // v6 链路本地忽略（endpoint.go:1961-1965）。
        continue;
      }
      const existing: PeerCandidate | undefined = this.candidates.get(ep);
      if (existing !== undefined) {
        existing.callMeMaybeWallMs = nowWall;
        removeString(previousCmm, ep);
      } else {
        const st: PeerCandidate = emptyCandidate(ep, INDEX_SENTINEL_DELETED);
        st.callMeMaybeWallMs = nowWall;
        this.candidates.set(ep, st);
      }
    }
    // 旧一轮 CMM 端点不在本消息里 ⇒ 删除（endpoint.go:1994-2001）。
    for (const ep of previousCmm) {
      this.deleteCandidate(ep);
    }
    // 全部候选 lastPing 清零后立即互 ping，sendCallMeMaybe=false 防死循环。
    this.candidates.forEach((st: PeerCandidate): void => {
      st.lastPingMonoMs = 0;
    });
    const nowMono: number = this.deps.clock.monotonicMs();
    this.sendDiscoPings(nowMono, false);
    return true;
  }

  /** noteRecvActivity（endpoint.go:525-541）。 */
  public noteRecvActivity(srcAddrPort: string): void {
    const now: number = this.deps.clock.monotonicMs();
    if (this.isWireGuardOnly) {
      // wireguard-only：源即路径，信 5s。
      this.bestAddrPort = srcAddrPort;
      this.bestAddrAtMonoMs = now;
      this.trustBestAddrUntilMonoMs = now + WIREGUARD_ONLY_RECV_TRUST_MS;
      return;
    }
    if (this.heartbeatDisabled && this.bestAddrPort === srcAddrPort) {
      this.trustBestAddrUntilMonoMs = now + TRUST_UDP_ADDR_DURATION_MS;
    }
  }

  /** discoPingTimeout（endpoint.go:1187-1202）。 */
  public discoPingTimeout(txidHex: string): void {
    const sp: SentPingRecord | undefined = this.sentPings.get(txidHex);
    if (sp === undefined) {
      return;
    }
    const now: number = this.deps.clock.monotonicMs();
    const bestUntrusted: boolean = now > this.trustBestAddrUntilMonoMs;
    if (sp.toAddrPort === this.bestAddrPort && bestUntrusted) {
      this.clearBestAddr();
    }
    this.sentPings.delete(txidHex);
  }

  /** noteBadEndpoint（endpoint.go:1655-1666）：UDP 发送报"端点已坏"类错误时调用。 */
  public noteBadEndpoint(addrPort: string): void {
    this.clearBestAddr();
    const st: PeerCandidate | undefined = this.candidates.get(addrPort);
    if (st !== undefined) {
      clearCandidateDerived(st);
    }
  }

  /** noteConnectivityChange（endpoint.go:1668-1680）：Rebind/网络切换。 */
  public noteConnectivityChange(): void {
    this.clearBestAddr();
    this.candidates.forEach((st: PeerCandidate): void => {
      clearCandidateDerived(st);
    });
  }

  /** setHeartbeatDisabled（endpoint.go:889-894；silent disco knob）。 */
  public setHeartbeatDisabled(v: boolean): void {
    this.heartbeatDisabled = v;
  }

  /** stopAndReset（endpoint.go:2056-2067 + resetLocked 2074-2093）：回 DERP-only。 */
  public stopAndReset(): void {
    this.lastSendExtMonoMs = 0;
    this.lastFullPingMonoMs = 0;
    this.clearBestAddr();
    this.candidates.forEach((st: PeerCandidate): void => {
      st.lastPingMonoMs = 0;
    });
    const txids: string[] = [];
    this.sentPings.forEach((_sp: SentPingRecord, txid: string): void => {
      txids.push(txid);
    });
    for (const txid of txids) {
      this.deps.scheduler.cancel(PING_TIMER_PREFIX + txid);
      this.sentPings.delete(txid);
    }
    this.heartbeatArmed = false;
    this.deps.scheduler.cancel(HB_TIMER_PREFIX + this.peerId);
    this.pendingCallMeMaybe = false;
  }

  /** populatePeerStatus（endpoint.go:2029-2050）。 */
  public populatePeerStatus(): PeerStatusSnapshot {
    const now: number = this.deps.clock.monotonicMs();
    const snapshot: PeerStatusSnapshot = {
      active: this.lastSendExtMonoMs !== 0 && now - this.lastSendExtMonoMs < SESSION_ACTIVE_TIMEOUT_MS,
      curAddr: '',
      relayRegionId: this.derpRegionId,
    };
    if (this.lastSendExtMonoMs === 0) {
      return snapshot;
    }
    const paths: SendPaths = this.addrForSend(now);
    if (paths.udpAddr !== '' && paths.derpRegionId === 0) {
      snapshot.curAddr = paths.udpAddr;
    }
    return snapshot;
  }

  // ---- 内部状态操作 ----

  private setBestAddr(addrPort: string, latencyMs: number, now: number): void {
    this.bestAddrPort = addrPort;
    this.bestAddrLatencyMs = latencyMs;
    this.bestAddrAtMonoMs = now;
    this.trustBestAddrUntilMonoMs = now + TRUST_UDP_ADDR_DURATION_MS;
  }

  private clearBestAddr(): void {
    this.bestAddrPort = '';
    this.bestAddrLatencyMs = 0;
    this.bestAddrAtMonoMs = 0;
    this.trustBestAddrUntilMonoMs = 0;
  }

  private deleteCandidate(addrPort: string): void {
    this.candidates.delete(addrPort);
    if (this.bestAddrPort === addrPort) {
      // deleteEndpointLocked 的 bestAddr 联动（endpoint.go:503-511）。
      this.clearBestAddr();
    }
  }

  /** 候选数（诊断/测试）。 */
  public candidateCount(): number {
    return this.candidates.size;
  }

  /** 候选地址列表（Map 插入序；诊断/测试）。 */
  public candidateAddrs(): string[] {
    const out: string[] = [];
    this.candidates.forEach((_st: PeerCandidate, ep: string): void => {
      out.push(ep);
    });
    return out;
  }

  /** bestAddr 视图（诊断/测试）。 */
  public bestAddr(): string {
    return this.bestAddrPort;
  }

  /** bestAddr 信任截止（单调 ms；诊断/测试）。 */
  public trustBestAddrUntil(): number {
    return this.trustBestAddrUntilMonoMs;
  }

  /** derp home region（诊断/测试）。 */
  public derpHomeRegion(): number {
    return this.derpRegionId;
  }
}

// ---- 模块级工具（A22：不用嵌套函数声明） ----

interface SendPaths {
  udpAddr: string;
  derpRegionId: number;
  wireguardOnlyPing: boolean;
}

interface AddrQuality {
  addrPort: string;
  latencyMs: number;
}

function emptyCandidate(addrPort: string, index: number): PeerCandidate {
  const st: PeerCandidate = {
    addrPort: addrPort,
    lastPingMonoMs: 0,
    lastGotPingMonoMs: 0,
    lastGotPingWallMs: 0,
    lastGotPingTxIdHex: '',
    callMeMaybeWallMs: 0,
    index: index,
    recentPongs: [],
  };
  return st;
}

/** shouldDeleteLocked（endpoint.go:455-467）三分支。 */
function shouldDeleteCandidate(st: PeerCandidate, nowMonoMs: number): boolean {
  if (st.callMeMaybeWallMs !== 0) {
    return false;
  }
  if (st.lastGotPingMonoMs === 0) {
    // netmap 下发候选：本轮 netmap 不再含它（index 哨兵）。
    return st.index === INDEX_SENTINEL_DELETED;
  }
  // 运行时学习候选：45s 无入站 ping 回收。
  return nowMonoMs - st.lastGotPingMonoMs > SESSION_ACTIVE_TIMEOUT_MS;
}

/** clear()：只保留 index/lastGotPing*，清派生态（endpoint.go:427-433）。 */
function clearCandidateDerived(st: PeerCandidate): void {
  st.lastPingMonoMs = 0;
  st.callMeMaybeWallMs = 0;
  st.recentPongs = [];
}

/** latencyLocked：最近一次 pong 的延迟；无 pong 返回 -1（endpoint.go:470-476）。 */
function latestPongLatency(st: PeerCandidate): number {
  if (st.recentPongs.length === 0) {
    return -1;
  }
  return st.recentPongs[st.recentPongs.length - 1].latencyMs;
}

/** isDirect：地址有效（非空）且非 DERP 假地址（endpoint.go:1826-1830 的直连判定）。 */
function isDirectAddr(addrPort: string): boolean {
  return addrPort !== '' && !isDerpMagicAddrPort(addrPort);
}

/**
 * betterAddr（endpoint.go:1885-1941，去 vni/MTU 面）：直连比较；延迟百分差打分；
 * 环回 +50 / 链路本地 +30 / 私网 +20 / IPv6 +10；改进 ≤1% 不切换（防抖）。
 */
function betterAddr(a: AddrQuality, b: AddrQuality): boolean {
  if (a.addrPort === b.addrPort) {
    // 同址比较依赖 MTU 面（本类不带 MTU 探测）⇒ 恒 false（走同址续期分支）。
    return false;
  }
  if (b.addrPort === '') {
    return true;
  }
  if (a.addrPort === '') {
    return false;
  }
  let aPoints: number = 0;
  let bPoints: number = 0;
  if (a.latencyMs > b.latencyMs && a.latencyMs > 0) {
    bPoints = Math.floor(100 - (b.latencyMs * 100) / a.latencyMs);
  } else if (b.latencyMs > 0) {
    aPoints = Math.floor(100 - (a.latencyMs * 100) / b.latencyMs);
  }
  if (isLoopbackAddrPort(a.addrPort)) {
    aPoints += 50;
  } else if (isLinkLocalAddrPort(a.addrPort)) {
    aPoints += 30;
  } else if (isPrivateAddrPort(a.addrPort)) {
    aPoints += 20;
  }
  if (isLoopbackAddrPort(b.addrPort)) {
    bPoints += 50;
  } else if (isLinkLocalAddrPort(b.addrPort)) {
    bPoints += 30;
  } else if (isPrivateAddrPort(b.addrPort)) {
    bPoints += 20;
  }
  if (isV6AddrPort(a.addrPort)) {
    aPoints += 10;
  }
  if (isV6AddrPort(b.addrPort)) {
    bPoints += 10;
  }
  if (aPoints <= 1 && bPoints === 0) {
    return false;
  }
  return aPoints > bPoints;
}

/** Rng → [0, n) 确定性取模（测试用 ArrayRng 钉死序列）。 */
function randomIndex(rng: Rng, n: number): number {
  const buf: Uint8Array = new Uint8Array(4);
  rng.randomBytes(buf);
  const v: number = ((buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) >>> 0);
  return v % n;
}

function removeString(list: string[], v: string): void {
  for (let i: number = 0; i < list.length; i += 1) {
    if (list[i] === v) {
      list.splice(i, 1);
      return;
    }
  }
}

// ---- 地址属性判定（经 netaddr 解析；AddrPort 线格式见 netaddr.parseIpPort） ----

function addrOf(addrPort: string): IpAddr | null {
  const parsed: IpPort | null = tryParseIpPort(addrPort);
  return parsed === null ? null : parsed.addr;
}

function isV6AddrPort(addrPort: string): boolean {
  const a: IpAddr | null = addrOf(addrPort);
  return a !== null && !a.is4;
}

function isLoopbackAddrPort(addrPort: string): boolean {
  const a: IpAddr | null = addrOf(addrPort);
  return a !== null && isLoopbackAddr(a);
}

function isLinkLocalAddrPort(addrPort: string): boolean {
  const a: IpAddr | null = addrOf(addrPort);
  return a !== null && isLinkLocalUnicastAddr(a);
}

function isPrivateAddrPort(addrPort: string): boolean {
  const a: IpAddr | null = addrOf(addrPort);
  return a !== null && isPrivateAddr(a);
}

function isV6LinkLocalAddrPort(addrPort: string): boolean {
  return isV6AddrPort(addrPort) && isLinkLocalAddrPort(addrPort);
}
