/**
 * DERP 路由与连接状态表（C2 §3：activeDerp 连接表 + derpRoute 学习路由）。
 *
 * 上游核对（v1.102.3 wgengine/magicsock/derp.go 实拉 2026-10-02）：
 * - activeDerp：region → 连接状态（创建/最近写时刻），非 home 连接空闲
 *   derpInactiveCleanupTime(60s) 关闭，derpCleanStaleInterval(15s) 周期扫描，
 *   仅在仍有连接时续期（derp.go:91-101, 989-1033, 1070-1076）；
 * - derpRoute：per-peer 的"对端最近出现在哪个 region"学习表；只来自**入站**
 *   DERP 流量（addDerpPeerRoute，derp.go:622-628）与本端发送路径
 *   （setPeerLastDerp，derp.go:484-510）；不要在 netmap 处理时凭空造路由
 *   （C2 陷阱 16）；PeerGone 帧删单条（derp.go:652-666）、连接断开清该连接上
 *   全部路由（derp.go:563-598）、node key 轮换/RemovePeer 同删；
 * - fallbackDERPRegionForPeer（derp.go:71-89）：无候选且无 home 时的兜底 region
 *   （endpoint.go:1076-1086 消费）；
 * - home 迁移门控（derp.go:159-296 maybeSetNearestDERP）：控制面长轮询不在线且
 *   已有 home ⇒ 不迁移（无法通知 peers）；netcheck 报告 PreferredDERP==0（UDP 全断）
 *   ⇒ pickDERPFallback 随机 region（derp.go:114-148，随机经注入 Rng，P4）；
 *   netcheck 侧 10ms/2-3 迟滞属 B2（netcheck.go:1440-1490），本表不重复实现；
 * - 写路径 derpWriteChanForRegion（derp.go:339-382）：复用已有 region 连接；
 *   否则查 derpRoute[peer] 复用对端出现过的 region 的连接（Issue 150 语义）；
 * - 写队列深 32、3 次尝试入队失败即丢包不阻塞（magicsock.go:1692-1711；
 *   derp.go:329）——丢包不迁移状态，与 UDP"端点已坏"清 bestAddr 是两条失败路径。
 *
 * 本表是纯逻辑状态（无 IO）；连接的建立/关闭由 app 侧 DERP 客户端执行后回填。
 */

import { type Clock, type Rng } from '@ohos-tailscale/common';
import {
  DERP_CLEAN_STALE_INTERVAL_MS,
  DERP_INACTIVE_CLEANUP_MS,
} from './smconsts.ts';

/** 单 region 连接状态（activeDerp 的值，derp.go:91-101 的时间字段子集）。 */
export interface DerpConnState {
  regionId: number;
  /** 建立时刻（单调 ms）。 */
  createdAtMonoMs: number;
  /** 最近一次写入时刻（单调 ms；空闲回收依据）。 */
  lastWriteMonoMs: number;
}

/** home 迁移决策结果。 */
export interface DerpHomeChange {
  changed: boolean;
  /** 变更后（或保持的）home region；0 = 无 home（含 fallback 失败）。 */
  regionId: number;
}

/** 写路径决策（derpWriteChanForRegion 的 region 选择面）。 */
export interface DerpWriteRoute {
  /** 用于写的 region（0 = 当前不可写：无连接且无路由）。 */
  regionId: number;
  /** true = 复用了 derpRoute 学习的 region（而非请求的 region 自身连接）。 */
  reusedLearnedRoute: boolean;
}

/** 清理扫描结果（cleanStaleDerp）。 */
export interface DerpCleanupResult {
  closedRegions: number[];
}

export class DerpRouteTable {
  private clock: Clock;
  private rng: Rng;
  private scheduler: TimeoutSchedulerRef;
  private home: number = 0;
  private conns: Map<number, DerpConnState> = new Map();
  private peerRoutes: Map<string, number> = new Map();
  private cleanupArmed: boolean = false;

  constructor(clock: Clock, rng: Rng, scheduler: TimeoutSchedulerRef) {
    this.clock = clock;
    this.rng = rng;
    this.scheduler = scheduler;
  }

  /** 当前 home region（0 = 无）。 */
  public homeRegion(): number {
    return this.home;
  }

  /**
   * maybeSetNearestDERP（derp.go:159-296）：report 为 netcheck 的 PreferredDERP。
   * 迁移门控：控制面不在线且已有 home ⇒ 保持；UDP 全断 ⇒ 随机 fallback。
   */
  public maybeSetNearestDerp(reportPreferredRegion: number, controlPlaneOnline: boolean, knownRegions: number[]): DerpHomeChange {
    if (!controlPlaneOnline && this.home !== 0) {
      // 无法通知 peers，不迁移（derp.go:177-195）。
      const keep: DerpHomeChange = { changed: false, regionId: this.home };
      return keep;
    }
    let target: number = reportPreferredRegion;
    if (target === 0) {
      target = this.pickDerpFallback(knownRegions);
    }
    if (target === this.home) {
      const same: DerpHomeChange = { changed: false, regionId: this.home };
      return same;
    }
    this.home = target;
    const change: DerpHomeChange = { changed: true, regionId: target };
    return change;
  }

  /**
   * pickDERPFallback（derp.go:112-148）：UDP 全断（netcheck 报告 region 0）时的
   * fallback。已有先前选定的 home ⇒ 保持不动（derp.go:138 `if c.myDerp != 0`，
   * 注释 "we want to stay on it"——防止 UDP 中断期间每次报告都随机漂移 home、
   * 触发 NotePreferred 风暴与对端路由失效）；仅 homeless 才随机挑。
   */
  private pickDerpFallback(knownRegions: number[]): number {
    if (knownRegions.length === 0) {
      // No DERP regions in non-nil map（derp.go:121-124）。
      return 0;
    }
    if (this.home !== 0) {
      // If we already had selected something in the past … we want to stay on it
      // （derp.go:133-140）。
      return this.home;
    }
    const buf: Uint8Array = new Uint8Array(4);
    this.rng.randomBytes(buf);
    const v: number = (buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) >>> 0;
    return knownRegions[v % knownRegions.length];
  }

  /** 连接建立（reader goroutine ServerInfo 后回填）。 */
  public noteConnected(regionId: number): void {
    const now: number = this.clock.monotonicMs();
    const existing: DerpConnState | undefined = this.conns.get(regionId);
    if (existing !== undefined) {
      return;
    }
    const st: DerpConnState = {
      regionId: regionId,
      createdAtMonoMs: now,
      lastWriteMonoMs: now,
    };
    this.conns.set(regionId, st);
    this.armCleanup();
  }

  /** 本端向该 region 写入（sendAddr 投递成功路径；刷新 lastWrite）。 */
  public noteWriteToRegion(regionId: number): void {
    const st: DerpConnState | undefined = this.conns.get(regionId);
    if (st !== undefined) {
      st.lastWriteMonoMs = this.clock.monotonicMs();
    }
  }

  /**
   * 连接关闭。clearPeerRoutes=true ⇒ 该连接上的全部 peer 路由一并清空
   * （读错误路径 derp.go:563-598；PeerGone 不关连接、只删单条路由）。
   */
  public noteConnectionClosed(regionId: number, clearPeerRoutes: boolean): void {
    this.conns.delete(regionId);
    if (clearPeerRoutes) {
      const stale: string[] = [];
      this.peerRoutes.forEach((region: number, peerId: string): void => {
        if (region === regionId) {
          stale.push(peerId);
        }
      });
      for (const peerId of stale) {
        this.peerRoutes.delete(peerId);
      }
    }
  }

  /** addDerpPeerRoute：入站 DERP 流量学习（derp.go:622-628）。 */
  public addPeerRoute(peerId: string, regionId: number): void {
    this.peerRoutes.set(peerId, regionId);
  }

  /** setPeerLastDerp：发送路径学习（derp.go:484-510）。 */
  public noteSendToPeer(peerId: string, regionId: number): void {
    this.peerRoutes.set(peerId, regionId);
  }

  /** removeDerpPeerRoute：PeerGone / key 轮换 / RemovePeer（derp.go:652-666 等）。 */
  public removePeerRoute(peerId: string): boolean {
    return this.peerRoutes.delete(peerId);
  }

  /** fallbackDERPRegionForPeer（derp.go:71-89）：学习路由兜底；无则 0。 */
  public fallbackRegionForPeer(peerId: string): number {
    const region: number | undefined = this.peerRoutes.get(peerId);
    return region === undefined ? 0 : region;
  }

  /**
   * derpWriteChanForRegion 的 region 选择面（derp.go:339-382）：
   * 请求 region 已有连接 → 用它；否则查 derpRoute[peer] 的学习 region（需有连接，
   * Issue 150）；否则 0（调用方新建连接后回填 noteConnected）。
   */
  public regionForWrite(requestedRegion: number, peerId: string): DerpWriteRoute {
    if (this.conns.has(requestedRegion)) {
      const direct: DerpWriteRoute = { regionId: requestedRegion, reusedLearnedRoute: false };
      return direct;
    }
    const learned: number | undefined = this.peerRoutes.get(peerId);
    if (learned !== undefined && learned !== 0 && this.conns.has(learned)) {
      const reused: DerpWriteRoute = { regionId: learned, reusedLearnedRoute: true };
      return reused;
    }
    const none: DerpWriteRoute = { regionId: 0, reusedLearnedRoute: false };
    return none;
  }

  /**
   * cleanStaleDerp（derp.go:989-1033）：非 home 且 lastWrite 超 60s ⇒ 关闭
   * （连带清该 region 学习路由）。返回本轮关闭列表。
   */
  public cleanStale(): DerpCleanupResult {
    const now: number = this.clock.monotonicMs();
    const closed: number[] = [];
    const stale: number[] = [];
    this.conns.forEach((st: DerpConnState, region: number): void => {
      if (region !== this.home && now - st.lastWriteMonoMs > DERP_INACTIVE_CLEANUP_MS) {
        stale.push(region);
      }
    });
    for (const region of stale) {
      this.noteConnectionClosed(region, true);
      closed.push(region);
    }
    const result: DerpCleanupResult = { closedRegions: closed };
    return result;
  }

  /** 清理定时器回调：扫描 + 仍有连接则续期 15s（derp.go:1029-1031）。 */
  public onCleanupTimer(): void {
    this.cleanupArmed = false;
    this.cleanStale();
    if (this.conns.size > 0) {
      this.cleanupArmed = true;
      this.scheduler.after('derpclean', DERP_CLEAN_STALE_INTERVAL_MS);
    }
  }

  /** 清理定时器是否在跑（诊断/测试）。 */
  public isCleanupArmed(): boolean {
    return this.cleanupArmed;
  }

  /** 空闲回收扫描定时器只在仍有连接时武装。 */
  private armCleanup(): void {
    if (this.cleanupArmed) {
      return;
    }
    if (this.conns.size === 0) {
      return;
    }
    this.cleanupArmed = true;
    this.scheduler.after('derpclean', DERP_CLEAN_STALE_INTERVAL_MS);
  }

  /** 连接数（诊断/测试）。 */
  public connCount(): number {
    return this.conns.size;
  }

  /** 学习路由条数（诊断/测试）。 */
  public routeCount(): number {
    return this.peerRoutes.size;
  }
}

/** 最小调度契约（与 peerconn.TimeoutScheduler 同签名；本包内不跨模块导入以保持独立）。 */
export interface TimeoutSchedulerRef {
  after(id: string, ms: number): void;
  cancel(id: string): void;
}
