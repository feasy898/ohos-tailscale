/**
 * netcheck 探测引擎调度：注入时钟驱动的纯状态机。
 *
 * 【移植形态】上游探测并发是 goroutine + time.AfterFunc + channel select
 * （netcheck.go:959-992、:1585-1656），核心库禁线程/定时器（P3/P4），故移植为
 * 「计划生成（plan.ts，纯函数）+ 事件推进（onTimer/onPacket）+ 下一时钟提示
 * （nextDueMonoMs）」；真实定时器/UDP/DNS/端口映射由 app 侧桥接翻译成事件注入。
 * FixedClock.advanceMs 驱动即可全确定性复现上游时序（P4）。
 *
 * 上游实读依据（2026-10-02 实拉 @3ce5e209971d，net/netcheck/netcheck.go，行号为当日原文）：
 * - 常量：ReportTimeout=5s（:59-61）、stunProbeTimeout=3s（:62-66）、
 *   icmpProbeTimeout=1s（:67-69）、httpsProbeTimeout=ReportTimeout（:70-74）、
 *   fullReportInterval=5min（:1373-1379）、preferredDERPAbsoluteDiff=10ms（:1380-1387）、
 *   PreferredDERPFrameTime=8s（:1388-1392）、PreferredDERPKeepAliveTimeout=2×derp.KeepAlive
 *   =120s（:1393-1401；derp/derp.go:44 KeepAlive=60s 实拉确认）、历史窗
 *   maxAge=5min+ReportTimeout=305s（:1414-1421，严格大于，先入后清）。
 * - GetReport 骨架（:832-1064）：参数互斥（:833-839）→ 5s 预算（:849）→
 *   并发互斥（:861-865）→ 全量/增量判定（:887-905）→ 生成计划并按组并发（:941-972）→
 *   select 四路（3s/ctx/全组完成/听到足够 region，:974-992）→ UDP 全败回退
 *   HTTPS+ICMP（:1000-1058）→ finishAndStoreReport（:1066-1075）。
 * - runProbe（:1585-1656）：等 delay → probeWouldHelp 假则取消整组（:1603-1606）→
 *   取地址 → 生成 TxID/请求（:1614-1615，sent 在 DNS 之后 :1617）→ 登记 inFlight →
 *   SendPacket；回包回调 = addNodeLatency + cancelSet（:1619-1624）。
 * - addNodeLatency（:686-735）：UDP=true、RegionLatency 最小合并、听到 enoughRegions
 *   个 region 挂早停定时器（max×增量1/全量2，:694-706）；v6 末见/计数、v4 首见
 *   （gotEP4 哨兵）+ MappingVariesByDestIP 三态守卫（:708-734）。
 * - probeWouldHelp（:645-673）。
 * - 迟到 hairpin 回声静默忽略（:331-341；上游已删主动 hairpin 探测，勿"补全"）。
 * - UDP 全败回退合并（:1036-1052 HTTPS、:1256-1264 ICMP）。
 * - addReportHistoryAndSetPreferredDERP（:1426-1531）与 bestRecentLatencyLocked
 *   （:1536-1546）、addReportAndPruneExpired（:1406-1422）。
 * - GetReportOpts（:784-798）、MakeNextReportFull（:302-308）、enoughRegions
 *   （:276-286，测试可覆盖）。
 *
 * 【与上游的有意分歧】（另见各方法内注释与研究笔记 §8）
 * 1. Go map 迭代序不定处一律固定为确定性序：home 初选并列按 regionId 升序、
 *    getGlobalAddrs 其余端点按 计数降序→键升序、回退候选按 regionId 升序；
 * 2. 时钟双轴：上游全部用墙钟 time.Time；此处历史窗/迟滞窗口用 wallMs、
 *    RTT/重传/截止用 monotonicMs（FixedClock 双轴同步推进时与上游等价）；
 * 3. lastFullMs 用 -1 哨兵表达上游零值 time.Time（"从未全量"）；
 * 4. 端口映射与 captive portal 检测本体不在核心（app 注入/回调，见接口注释）。
 */

import { type Clock, type Rng, hexEncode } from '@ohos-tailscale/common';
import { NetcheckError } from './errors.ts';
import { type NetAddr, addrEqual, addrIs4, addrIs6, addrValid, cloneAddr } from './addr.ts';
import {
  type DnsResolver,
  type NetcheckDerpMap,
  type NetcheckNode,
  type NetcheckRegion,
  PROTO,
  nodeAddrPort,
  regionHasDerpNode,
} from './regions.ts';
import { type ProbeGroup, type ProbeSpec, makeProbePlan } from './plan.ts';
import { NetcheckReport, bumpEndpointCounter, maxDurationValue, updateLatency } from './report.ts';
import { type StunParsedResponse, stunIs, stunParseBindingRequest, stunParseResponse } from './stun.ts';
import { StunTransaction } from './probe.ts';

/** 单次报告总预算（上游 ReportTimeout，netcheck.go:59-61）。 */
export const REPORT_TIMEOUT_MS: number = 5000;
/** STUN 阶段上限，超时转 HTTP 探测（上游 stunProbeTimeout，:62-66）。 */
export const STUN_PROBE_TIMEOUT_MS: number = 3000;
/** ICMP 探测预算（上游 icmpProbeTimeout，:67-69）。 */
export const ICMP_PROBE_TIMEOUT_MS: number = 1000;
/** HTTPS 探测预算 = ReportTimeout（上游 httpsProbeTimeout，:70-74）。 */
export const HTTPS_PROBE_TIMEOUT_MS: number = REPORT_TIMEOUT_MS;
/** 全量报告最大间隔（上游 fullReportInterval，:1373-1379）。 */
export const FULL_REPORT_INTERVAL_MS: number = 300000;
/** 报告历史保留窗（上游 maxAge = fullReportInterval + ReportTimeout，:1414-1421）。 */
export const REPORT_HISTORY_MAX_AGE_MS: number = FULL_REPORT_INTERVAL_MS + REPORT_TIMEOUT_MS;
/** 换 home 的最小绝对差（上游 preferredDERPAbsoluteDiff，:1380-1387）。 */
export const PREFERRED_DERP_ABSOLUTE_DIFF_MS: number = 10;
/** DERP 帧回看窗（上游 PreferredDERPFrameTime，:1388-1392）。 */
export const PREFERRED_DERP_FRAME_TIME_MS: number = 8000;
/** DERP 保活间隔（上游 derp.KeepAlive，derp/derp.go:44 实拉 = 60s）。 */
export const DERP_KEEP_ALIVE_MS: number = 60000;
/** home 无数据时的保活窗 = 2×KeepAlive = 120s（上游 :1393-1401；非直觉的 2s）。 */
export const PREFERRED_DERP_KEEPALIVE_TIMEOUT_MS: number = 2 * DERP_KEEP_ALIVE_MS;
/** 「听到足够 region」默认值（上游 enoughRegions，:276-286）。 */
export const ENOUGH_REGIONS_DEFAULT: number = 3;

/** STUN 阶段结束原因（上游 select 四路的对应物；R5 常量对象）。 */
export interface PhaseEndReasonE {
  None: number;
  /** stunProbeTimeout 3s 自然到点（:978）。 */
  StunTimeout: number;
  /** 5s 总预算用尽（:979 ctx.Done）——此后连回退都不做（:1003）。 */
  ReportDeadline: number;
  /** 全部探测组结算（每都被回包/早停取消，:980-985）。 */
  AllGroupsDone: number;
  /** 听到足够多 region 的早停定时器到点（:986-991）。 */
  SawEnoughRegions: number;
}

export const PHASE_END: PhaseEndReasonE = {
  None: 0,
  StunTimeout: 1,
  ReportDeadline: 2,
  AllGroupsDone: 3,
  SawEnoughRegions: 4,
};

/** 发包注入（上游 Client.SendPacket，:238-240）：返回发送字节数，失败抛 Error。 */
export interface StunSender {
  sendPacket(data: Uint8Array, dest: NetAddr): number;
}

/** DERP 非-STUN 活动查询（上游 GetReportOpts.GetLastDERPActivity，:792）：挂钟毫秒；0 = 零值时间。 */
export interface DerpActivitySource {
  getLastDerpActivity(regionId: number): number;
}

/** 端口映射探测结果（上游 portmappertype.ProbeResult 的三布尔切片）。 */
export interface PortMapResult {
  upnp: boolean;
  pmp: boolean;
  pcp: boolean;
}

/**
 * 端口映射探测注入（上游 Client.PortMapper，:247-249；probePortMapServices :750-771）。
 * 【裁定】UPnP/PMP/PCP 协议本体不在本包（上游 net/portmapper 未读，研究笔记 §10）；
 * 注入非空时引擎先置三态 false 再写结果（:753-770），注入为空则保持未知（nil 语义）。
 * 同步注入：探测自身的超时策略归 app 侧实现。
 */
export interface PortMapperProbe {
  probe(): PortMapResult;
}

/** 上游 GetReportOpts（:784-798）。 */
export interface GetReportOpts {
  /** 只测 TCP 443（与 onlyStun 互斥，:833-839）；置位时不生成 STUN 计划（:941-944）。 */
  onlyTcp443: boolean;
  /** 只测 STUN（:796-797）。 */
  onlyStun: boolean;
  /** 上游 GetLastDERPActivity（:792）；null = 不提供（一律零值时间）。 */
  activity: DerpActivitySource | null;
}

/** 引擎构造配置（上游 Client 字段的可注入子集，:222-274）。 */
export interface EngineConfig {
  clock: Clock;
  rng: Rng;
  derpMap: NetcheckDerpMap;
  /** 上游 SendPacket；null 时每发探测都置 IPv4CanSend/IPv6CanSend=false（:1626-1632）。 */
  sender: StunSender | null;
  /** 上游 udp6 [::1]:0 bind 探测（:928-932）的注入结果。 */
  osHasIpv6: boolean;
  /** 上游 netmon InterfaceState 的 HaveV4/HaveV6（:924、:459-460）。 */
  haveV4: boolean;
  haveV6: boolean;
  /** 上游 SkipExternalNetwork（:242-245）：置位则跳过端口映射探测。 */
  skipExternalNetwork: boolean;
  portMapper: PortMapperProbe | null;
  dns: DnsResolver | null;
  /** 上游 ForcePreferredDERP（:260-262）；非零且可达时强制 home。 */
  forcePreferredDERP: number;
  /** 上游 testEnoughRegions（:265）；0 = 默认 3。 */
  enoughRegionsOverride: number;
}

/** 运行中的探测组（上游 per-set goroutine + setCtx，:962-971）。 */
interface GroupRuntime {
  key: string;
  probes: ProbeSpec[];
  /** 下一条未发射探测下标。 */
  nextIdx: number;
  /** setCtx 是否仍存活（回包/早停取消后为 false）。 */
  alive: boolean;
}

/** inFlight 表值（上游 map[stun.TxID]func(netip.AddrPort)，:623；回调展开为字段）。 */
interface InFlightEntry {
  group: GroupRuntime;
  regionId: number;
  tx: StunTransaction;
}

/** 一次 GetReport 的现场（上游 reportState，:613-626）。 */
interface ReportSession {
  report: NetcheckReport;
  groups: GroupRuntime[];
  inFlight: Map<string, InFlightEntry>;
  startWallMs: number;
  startMonoMs: number;
  stunDeadlineMonoMs: number;
  reportDeadlineMonoMs: number;
  /** 早停定时器（上游 time.AfterFunc stopProbes，:694-706）；null = 未挂。 */
  sawEnoughDeadlineMonoMs: number | null;
  phaseDone: boolean;
  phaseEnd: number;
  /** 上游 rs.gotEP4（:624）：v4 首见哨兵（跨 region 跨节点共享）。 */
  gotEP4: NetAddr | null;
  opts: GetReportOpts;
  incremental: boolean;
}

export class NetcheckEngine {
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly derpMap: NetcheckDerpMap;
  private readonly sender: StunSender | null;
  private readonly osHasIpv6: boolean;
  private readonly haveV4: boolean;
  private readonly haveV6: boolean;
  private readonly skipExternalNetwork: boolean;
  private readonly portMapper: PortMapperProbe | null;
  private readonly dns: DnsResolver | null;
  private forcePreferredDERP: number;
  private readonly enoughRegionsOverride: number;

  /** 上游 c.nextFull（:268）。 */
  private nextFull: boolean = false;
  /** 上游 c.prev（:269）：挂钟毫秒 → 报告。 */
  private prev: Map<number, NetcheckReport> = new Map<number, NetcheckReport>();
  /** 上游 c.last（:270）。 */
  private last: NetcheckReport | null = null;
  /** 上游 c.lastFull（:271）；-1 = 从未（上游零值 time.Time 语义）。 */
  private lastFullMs: number = -1;
  /** 上游 c.curState（:272）：非空表示一场报告进行中。 */
  private session: ReportSession | null = null;

  constructor(cfg: EngineConfig) {
    this.clock = cfg.clock;
    this.rng = cfg.rng;
    this.derpMap = cfg.derpMap;
    this.sender = cfg.sender;
    this.osHasIpv6 = cfg.osHasIpv6;
    this.haveV4 = cfg.haveV4;
    this.haveV6 = cfg.haveV6;
    this.skipExternalNetwork = cfg.skipExternalNetwork;
    this.portMapper = cfg.portMapper;
    this.dns = cfg.dns;
    this.forcePreferredDERP = cfg.forcePreferredDERP;
    this.enoughRegionsOverride = cfg.enoughRegionsOverride;
  }

  /** 上游 SetForcePreferredDERP（:809-813）。 */
  public setForcePreferredDERP(region: number): void {
    this.forcePreferredDERP = region;
  }

  /** 上游 MakeNextReportFull（:302-308）：强制下一场全量。 */
  public makeNextReportFull(): void {
    this.nextFull = true;
  }

  /** 上游 enoughRegions（:276-286；Verbose→100 的分支不移植，核心无 verbose）。 */
  private enoughRegions(): number {
    if (this.enoughRegionsOverride > 0) {
      return this.enoughRegionsOverride;
    }
    return ENOUGH_REGIONS_DEFAULT;
  }

  /**
   * 开始一场报告（上游 GetReport :832-944 的同步前半段：校验/全量判定/计划生成）。
   * delay=0 的探测不在此处发——由驱动循环经 nextDueMonoMs()==开始时刻 触发首次 onTimer。
   */
  public startReport(opts: GetReportOpts): void {
    if (opts.onlyStun && opts.onlyTcp443) {
      throw new NetcheckError('RANGE', 'netcheck: only one of OnlySTUN or OnlyTCP443 may be set in opts') as Error;
    }
    if (this.session !== null) {
      // 上游 :861-865：重入显式报错，不静默覆盖（研究笔记 §8.2）
      throw new NetcheckError('STATE', 'invalid concurrent call to GetReport') as Error;
    }
    const nowWall: number = this.clock.wallMs();
    const nowMono: number = this.clock.monotonicMs();
    let last: NetcheckReport | null = this.last;
    let preferredDERP: number = 0;
    if (last !== null) {
      preferredDERP = last.preferredDERP;
    }
    // 全量/增量判定（:887-905）。-1 哨兵 = 上游零值 time（从未全量 → 必全量）
    let doFull: boolean = this.nextFull || this.lastFullMs < 0 || nowWall - this.lastFullMs > FULL_REPORT_INTERVAL_MS;
    if (!doFull && last !== null) {
      // captive portal 反馈环（:891-897）
      doFull = !last.udp && last.captivePortal.equalBool(true);
    }
    if (doFull) {
      last = null; // 逼出初始计划（:899）
      this.nextFull = false;
      this.lastFullMs = nowWall;
    }
    const incremental: boolean = last !== null;

    const report: NetcheckReport = new NetcheckReport();
    report.osHasIpv6 = this.osHasIpv6;
    if (!this.skipExternalNetwork && this.portMapper !== null) {
      // probePortMapServices：先三置 false，再写探测结果（:750-771）
      report.upnp.set(false);
      report.pmp.set(false);
      report.pcp.set(false);
      const res: PortMapResult = this.portMapper.probe();
      report.upnp.set(res.upnp);
      report.pmp.set(res.pmp);
      report.pcp.set(res.pcp);
    }
    // OnlyTCP443 → 无 STUN 计划（:941-944）
    const plan: ProbeGroup[] = opts.onlyTcp443
      ? []
      : makeProbePlan(this.derpMap, this.haveV4, this.haveV6, last, preferredDERP);
    const groups: GroupRuntime[] = [];
    for (const g of plan) {
      const gr: GroupRuntime = { key: g.key, probes: g.probes, nextIdx: 0, alive: true };
      groups.push(gr);
    }
    const session: ReportSession = {
      report: report,
      groups: groups,
      inFlight: new Map<string, InFlightEntry>(),
      startWallMs: nowWall,
      startMonoMs: nowMono,
      stunDeadlineMonoMs: nowMono + STUN_PROBE_TIMEOUT_MS,
      reportDeadlineMonoMs: nowMono + REPORT_TIMEOUT_MS,
      sawEnoughDeadlineMonoMs: null,
      phaseDone: false,
      phaseEnd: PHASE_END.None,
      gotEP4: null,
      opts: opts,
      incremental: incremental,
    };
    this.session = session;
  }

  /** 是否有一场报告在途（startReport 起、finishReport 止；上游 curState 生命周期）。 */
  public reportActive(): boolean {
    return this.session !== null;
  }

  /** STUN 阶段是否已结束（select 已返回）；此后才可查 phaseEnd/回退并 finishReport。 */
  public stunPhaseDone(): boolean {
    const rs: ReportSession | null = this.session;
    if (rs === null) {
      return false;
    }
    return rs.phaseDone;
  }

  /** STUN 阶段结束原因（PHASE_END；未结束 = None）。 */
  public phaseEndReason(): number {
    const rs: ReportSession | null = this.session;
    if (rs === null) {
      return PHASE_END.None;
    }
    return rs.phaseEnd;
  }

  /**
   * 下一事件时刻（单调轴绝对毫秒）：due 探测发送 / 3s STUN 截止 / 5s 报告截止 /
   * 早停定时器。null = 无活动会话或 STUN 阶段已结束（桥接循环退出条件）。
   */
  public nextDueMonoMs(): number | null {
    const rs: ReportSession | null = this.session;
    if (rs === null || rs.phaseDone) {
      return null;
    }
    let next: number | null = null;
    const consider = (t: number): void => {
      if (next === null || t < next) {
        next = t;
      }
    };
    for (const g of rs.groups) {
      if (!g.alive || g.nextIdx >= g.probes.length) {
        continue;
      }
      consider(rs.startMonoMs + g.probes[g.nextIdx].delayMs);
    }
    consider(rs.stunDeadlineMonoMs);
    consider(rs.reportDeadlineMonoMs);
    if (rs.sawEnoughDeadlineMonoMs !== null) {
      // 早停定时器到点即触发；上游 ctx cancel 会 stop 掉它（:998 stopTimers），
      // 故只有早于报告截止的早停才可能被观察到
      consider(rs.sawEnoughDeadlineMonoMs);
    }
    return next;
  }

  /**
   * 时钟事件：处理当下所有 due 的探测发送并判定截止（上游 select :974-992 与
   * runProbe :1585-1656 的时间推进面）。桥接先推进注入时钟，再调用本方法。
   * STUN 阶段结束后调用为无害空操作。
   */
  public onTimer(): void {
    const rs: ReportSession | null = this.session;
    if (rs === null || rs.phaseDone) {
      return;
    }
    const now: number = this.clock.monotonicMs();
    for (const g of rs.groups) {
      while (g.alive && g.nextIdx < g.probes.length) {
        const spec: ProbeSpec = g.probes[g.nextIdx];
        if (rs.startMonoMs + spec.delayMs > now) {
          break;
        }
        g.nextIdx += 1;
        this.fireProbe(rs, g, spec);
      }
    }
    // 截止判定。上游 select 多路同时 ready 时取一（Go 随机）；此处按确定优先序：
    // 全组结算 > 早停(<5s) > 5s 总预算 > 3s STUN 预算。早停定时器若晚于 5s，
    // 上游也是 ctx.Done 先结束（定时器随后被 stopTimers 丢弃，:998）。
    if (this.allGroupsSettled(rs)) {
      this.endPhase(rs, PHASE_END.AllGroupsDone);
      return;
    }
    if (rs.sawEnoughDeadlineMonoMs !== null && now >= rs.sawEnoughDeadlineMonoMs && now < rs.reportDeadlineMonoMs) {
      this.endPhase(rs, PHASE_END.SawEnoughRegions);
      return;
    }
    if (now >= rs.reportDeadlineMonoMs) {
      this.endPhase(rs, PHASE_END.ReportDeadline);
      return;
    }
    if (now >= rs.stunDeadlineMonoMs) {
      this.endPhase(rs, PHASE_END.StunTimeout);
    }
  }

  /** 收到一条 UDP 载荷（上游 ReceiveSTUNPacket :314-353；src 仅审计用，
   * 合并用回包内 XOR-MAPPED 端点——上游 onDone(addrPort) 传的是解析结果）。 */
  public onPacket(buf: Uint8Array, src: NetAddr): void {
    const rs: ReportSession | null = this.session;
    if (rs === null) {
      return; // 上游 rs==nil 直接丢弃（:327-329）；finishReport 后亦然
    }
    if (!stunIs(buf)) {
      return; // standalone 读环的非 STUN 过滤（standalone.go:82-84）
    }
    let resp: StunParsedResponse;
    try {
      resp = stunParseResponse(buf);
    } catch (e) {
      // 解析失败：若是合法 Binding Request → 旧版 hairpin 探测的迟到回声，
      // 静默忽略（:331-341；上游另记日志，核心静默）。两类失败都不合并。
      try {
        stunParseBindingRequest(buf);
      } catch (e2) {
        // 非 hairpin 的意外报文：与上游一致仅记录并丢弃
      }
      return;
    }
    const key: string = hexEncode(resp.txid);
    const entry: InFlightEntry | undefined = rs.inFlight.get(key);
    if (entry === undefined) {
      return; // 未配对的响应丢弃（:345-352 ok=false 路径）
    }
    rs.inFlight.delete(key);
    const rttMs: number = entry.tx.rttMs(); // 到包那一刻采样（上游 time.Since(sent)，:1621）
    this.addNodeLatency(rs, entry.regionId, resp, rttMs);
    entry.group.alive = false; // cancelSet：回包即停同组（:1622-1623）
  }

  /** captive portal 检测结果回填（上游 hook 的 setCaptivePortal 回调，:953-955）。
   * 检测本体与启停时机归 app 桥接；无活动会话时为无害空操作（上游写死亡报告）。 */
  public setCaptivePortal(found: boolean): void {
    const rs: ReportSession | null = this.session;
    if (rs === null) {
      return;
    }
    rs.report.captivePortal.set(found);
  }

  /** 当前场是否已有任一 UDP 往返（上游 rs.anyUDP，:628-632）。 */
  public anyUdp(): boolean {
    const rs: ReportSession | null = this.session;
    if (rs === null) {
      return false;
    }
    return rs.report.udp;
  }

  /**
   * 上游测试直接驱动 reportState.addNodeLatency（netcheck_test.go:86-101
   * TestMultiGlobalAddressMapping、:121-125 TestSTUNResponseProvesCanSend）的
   * 对应测试口：绕过调度配对直接合并一条 STUN 观测。仅测试使用。
   */
  public mergeStunResponseForTest(regionId: number, endpoint: NetAddr, rttMs: number): void {
    const rs: ReportSession | null = this.session;
    if (rs === null) {
      throw new NetcheckError('STATE', 'netcheck: mergeStunResponseForTest outside an active report') as Error;
    }
    const fake: StunParsedResponse = { txid: new Uint8Array(12), ip: endpoint.ip, port: endpoint.port };
    this.addNodeLatency(rs, regionId, fake, rttMs);
  }

  /**
   * 是否应做 HTTPS/ICMP 回退（上游 :1003 `!rs.anyUDP() && ctx.Err() == nil && !onlySTUN`）。
   * ReportDeadline（5s 用尽）即上游 ctx.Err()!=nil，连回退都不做。
   */
  public shouldTryHttpsFallback(): boolean {
    const rs: ReportSession | null = this.session;
    if (rs === null || !rs.phaseDone) {
      return false;
    }
    if (rs.report.udp || rs.opts.onlyStun) {
      return false;
    }
    return rs.phaseEnd !== PHASE_END.ReportDeadline;
  }

  /** ICMP 回退是否被 OnlyTCP443 排除（上游 :1015 buildfeatures.HasUDPTransport && !OnlyTCP443）。 */
  public icmpFallbackAllowed(): boolean {
    const rs: ReportSession | null = this.session;
    if (rs === null) {
      return false;
    }
    return !rs.opts.onlyTcp443;
  }

  /**
   * HTTPS/ICMP 回退候选（上游 :1005-1010）：缺延迟数据 && 有非 STUNOnly 节点
   * （regionHasDERPNode :1756-1763）&& !Avoid && !NoMeasureNoHome。
   * 【分歧】上游遍历 Go map；此处按 regionId 升序输出。
   */
  public httpsFallbackCandidates(): NetcheckRegion[] {
    const rs: ReportSession | null = this.session;
    const out: NetcheckRegion[] = [];
    if (rs === null) {
      return out;
    }
    const sorted: NetcheckRegion[] = this.derpMap.regions.slice();
    const cmp = (a: NetcheckRegion, b: NetcheckRegion): number => a.regionId - b.regionId;
    sorted.sort(cmp);
    for (const reg of sorted) {
      if (!rs.report.regionLatency.has(reg.regionId) && regionHasDerpNode(reg) && !reg.avoid && !reg.noMeasureNoHome) {
        out.push(reg);
      }
    }
    return out;
  }

  /** HTTPS 回退合并（上游 :1036-1052）：延迟最小合并（相等保留旧值）+ 按拨号地址族置 IPv4/IPv6。 */
  public mergeHttpsLatency(regionId: number, latencyMs: number, dialed: NetAddr | null): void {
    const rs: ReportSession | null = this.session;
    if (rs === null) {
      throw new NetcheckError('STATE', 'netcheck: mergeHttpsLatency outside an active report') as Error;
    }
    const existing: number | undefined = rs.report.regionLatency.get(regionId);
    if (existing === undefined) {
      rs.report.regionLatency.set(regionId, latencyMs);
    } else if (existing >= latencyMs) {
      rs.report.regionLatency.set(regionId, latencyMs);
    }
    if (dialed !== null) {
      // 上游注释承认 v4/v6 置位近似随机、无大用（:1042-1046），语义照录
      if (addrIs4(dialed)) {
        rs.report.ipv4 = true;
      }
      if (addrIs6(dialed)) {
        rs.report.ipv6 = true;
      }
    }
  }

  /** ICMP 回退合并（上游 :1256-1264）：同最小合并 + IPv4=true、ICMPv4=true（现只发 v4 ICMP）。 */
  public mergeIcmpLatency(regionId: number, latencyMs: number): void {
    const rs: ReportSession | null = this.session;
    if (rs === null) {
      throw new NetcheckError('STATE', 'netcheck: mergeIcmpLatency outside an active report') as Error;
    }
    const existing: number | undefined = rs.report.regionLatency.get(regionId);
    if (existing === undefined) {
      rs.report.regionLatency.set(regionId, latencyMs);
    } else if (existing >= latencyMs) {
      rs.report.regionLatency.set(regionId, latencyMs);
    }
    rs.report.ipv4 = true;
    rs.report.icmpV4 = true;
  }

  /**
   * 收口（上游 finishAndStoreReport :1066-1075 + GetReport 的 defer curState=nil :908-912）：
   * 克隆报告 → 历史 + home 迟滞（改的是克隆，:1068-1071）→ 返回克隆并结束会话。
   */
  public finishReport(): NetcheckReport {
    const rs: ReportSession | null = this.session;
    if (rs === null) {
      throw new NetcheckError('STATE', 'netcheck: finishReport outside an active report') as Error;
    }
    this.session = null;
    const report: NetcheckReport = rs.report.clone();
    this.addReportHistoryAndSetPreferredDERP(rs, report, this.clock.wallMs());
    return report;
  }

  /** 上游 RecentRegionLatency（:1548-1554）：历史窗内各 region 最低延迟（返回副本）。 */
  public recentRegionLatency(): Map<number, number> {
    const best: Map<number, number> = this.bestRecentLatencyLocked();
    return best;
  }

  /** 历史窗报告份数（上游 len(c.prev)；测试锚定用）。 */
  public historySize(): number {
    return this.prev.size;
  }

  /**
   * 上游 AddReportHistoryForTest（:1556-1563）的对应物：把一份外部构造的报告
   * 按指定时刻写入历史并重算 PreferredDERP（不启动报告会话）。测试迟滞用。
   */
  public addReportHistoryForTest(r: NetcheckReport, startWallMs: number, activity: DerpActivitySource | null): void {
    const pseudo: GetReportOpts = { onlyTcp443: false, onlyStun: false, activity: activity };
    const rs: ReportSession = {
      report: r,
      groups: [],
      inFlight: new Map<string, InFlightEntry>(),
      startWallMs: startWallMs,
      startMonoMs: startWallMs,
      stunDeadlineMonoMs: 0,
      reportDeadlineMonoMs: 0,
      sawEnoughDeadlineMonoMs: null,
      phaseDone: true,
      phaseEnd: PHASE_END.None,
      gotEP4: null,
      opts: pseudo,
      incremental: false,
    };
    this.addReportHistoryAndSetPreferredDERP(rs, r, this.clock.wallMs());
  }

  // ------------------------------------------------------------------ 内部

  private endPhase(rs: ReportSession, reason: number): void {
    rs.phaseDone = true;
    rs.phaseEnd = reason;
    rs.sawEnoughDeadlineMonoMs = null; // 上游 rs.stopTimers()（:998）
  }

  private allGroupsSettled(rs: ReportSession): boolean {
    // 上游 wg 计的是每组 setCtx 完成：组只有被 回包/probeWouldHelp 取消 才结算；
    // 发完所有探测但无回包的组会一直挂到父 ctx（5s）——不计入结算（:962-971）。
    // 空计划（如 OnlyTCP443）时上游 WaitGroupChan 计数 0 即刻 Done——同样视为结算。
    if (rs.groups.length === 0) {
      return true;
    }
    for (const g of rs.groups) {
      if (g.alive) {
        return false;
      }
    }
    return true;
  }

  /** 上游 runProbe（:1585-1656）单条探测在「到点时刻」的执行。 */
  private fireProbe(rs: ReportSession, g: GroupRuntime, spec: ProbeSpec): void {
    const node: NetcheckNode | null = namedNode(this.derpMap, spec.node);
    if (node === null) {
      return; // 上游 log 后 return，不取消组（:1587-1591）
    }
    if (!this.probeWouldHelp(rs, spec)) {
      g.alive = false; // cancelSet：不再有新信息则取消整组（:1603-1606）
      return;
    }
    const dest: NetAddr | null = nodeAddrPort(node, node.stunPort, spec.proto, this.dns);
    if (dest === null) {
      return; // 无该族地址：放弃本条，组继续等后续探测（:1608-1612）
    }
    const tx: StunTransaction = new StunTransaction(this.rng, this.clock); // TxID + sent（DNS 之后，:1614-1617）
    rs.inFlight.set(hexEncode(tx.txid), { group: g, regionId: spec.regionId, tx: tx });
    if (this.sender === null) {
      rs.report.ipv4CanSend = false; // 上游 :1626-1632
      rs.report.ipv6CanSend = false;
      return;
    }
    try {
      const req: Uint8Array = tx.requestBytes();
      const n: number = this.sender.sendPacket(req, dest);
      // 上游 :1643-1653：n==len && err==nil 才证明可发送（TreatAsLostUDP 为调试
      // envknob，不移植）；错误路径（抛出）不置位。
      if (n === req.length) {
        if (spec.proto === PROTO.IPv4) {
          rs.report.ipv4CanSend = true;
        } else if (spec.proto === PROTO.IPv6) {
          rs.report.ipv6CanSend = true;
        }
      }
    } catch (e) {
      // 发送失败：静默（上游 err!=nil → 不置 CanSend，探测自然无回包）
    }
  }

  /** 上游 probeWouldHelp（:645-673）：这条探测还能带来新信息吗。 */
  private probeWouldHelp(rs: ReportSession, spec: ProbeSpec): boolean {
    const rep: NetcheckReport = rs.report;
    if (!rep.regionLatency.has(spec.regionId)) {
      return true; // 该 region 还没任何延迟数据
    }
    if (spec.proto === PROTO.IPv6 && rep.regionV6Latency.size === 0) {
      return true; // 还没有任何 v6 结果
    }
    // v4：MappingVariesByDestIP 未知（""）时第二条 v4 证据仍有价值（三态是活输入）
    if (spec.proto === PROTO.IPv4 && rep.mappingVariesByDestIp.isUnknown()) {
      return true;
    }
    return false;
  }

  /** 上游 addNodeLatency（:686-735）。 */
  private addNodeLatency(rs: ReportSession, regionId: number, ipp: StunParsedResponse, dMs: number): void {
    const rep: NetcheckReport = rs.report;
    rep.udp = true;
    updateLatency(rep.regionLatency, regionId, dMs);
    // 听到足够 region：挂早停定时器（max 延迟，全量 ×2）（:694-706）
    if (rep.regionLatency.size === this.enoughRegions()) {
      let timeout: number = maxDurationValue(rep.regionLatency);
      if (!rs.incremental) {
        timeout *= 2;
      }
      rs.sawEnoughDeadlineMonoMs = this.clock.monotonicMs() + timeout;
    }
    const addr: NetAddr = { ip: ipp.ip, port: ipp.port };
    if (addrIs6(addr)) {
      // 回包即证明探测已发出（:709-713）
      rep.ipv6CanSend = true;
      updateLatency(rep.regionV6Latency, regionId, dMs);
      rep.ipv6 = true;
      rep.globalV6 = cloneAddr(addr); // v6 末见语义（:715）
      bumpEndpointCounter(rep.globalV6Counters, addr);
      // 上游注释：v6 不做 MappingVariesByDestIP（:717-718）
    } else if (addrIs4(addr)) {
      rep.ipv4CanSend = true;
      updateLatency(rep.regionV4Latency, regionId, dMs);
      rep.ipv4 = true;
      bumpEndpointCounter(rep.globalV4Counters, addr);
      // v4 首见哨兵 gotEP4（:724-733）：只记第一次端点；第二端点 → varies=true；
      // 同端点再现且未知 → false（一旦 true 不会被改回）
      if (!addrValid(rs.gotEP4)) {
        rs.gotEP4 = cloneAddr(addr);
        rep.globalV4 = cloneAddr(addr);
      } else {
        if (!addrEqual(rs.gotEP4, addr)) {
          rep.mappingVariesByDestIp.set(true);
        } else if (rep.mappingVariesByDestIp.isUnknown()) {
          rep.mappingVariesByDestIp.set(false);
        }
      }
    }
  }

  /** 上游 addReportAndPruneExpired（:1406-1422）：先入后清、严格大于 maxAge。 */
  private addReportAndPruneExpired(nowWallMs: number, r: NetcheckReport): void {
    r.nowMs = nowWallMs;
    this.prev.set(nowWallMs, r);
    this.last = r;
    const stale: number[] = [];
    for (const t of this.prev.keys()) {
      if (nowWallMs - t > REPORT_HISTORY_MAX_AGE_MS) {
        stale.push(t);
      }
    }
    for (const t of stale) {
      this.prev.delete(t);
    }
  }

  /** 上游 bestRecentLatencyLocked（:1536-1546）：历史窗内各 region 最小延迟。 */
  private bestRecentLatencyLocked(): Map<number, number> {
    const best: Map<number, number> = new Map<number, number>();
    for (const pr of this.prev.values()) {
      for (const rid of pr.regionLatency.keys()) {
        const d: number = pr.regionLatency.get(rid) as number;
        const bd: number | undefined = best.get(rid);
        if (bd === undefined || d < bd) {
          best.set(rid, d);
        }
      }
    }
    return best;
  }

  /**
   * 上游 addReportHistoryAndSetPreferredDERP（:1426-1531）：入历史 → bestRecent
   * → RegionScore 缩放 → 初选 → 换 home 两道迟滞 → Force → 120s 保活兜底。
   * 【分歧】初选遍历按 regionId 升序（上游 Go map 迭代序，严格小于比较下并列
   * 依赖迭代序——上游行为本就不确定，此处固定化，研究笔记 §8.3）。
   */
  private addReportHistoryAndSetPreferredDERP(rs: ReportSession, r: NetcheckReport, nowWallMs: number): void {
    let prevDERP: number = 0;
    if (this.last !== null) {
      prevDERP = this.last.preferredDERP;
    }
    this.addReportAndPruneExpired(nowWallMs, r);
    const bestRecent: Map<number, number> = this.bestRecentLatencyLocked();
    // RegionScore 缩放 bestRecent（:1442-1450；score≤0 忽略，absent=1.0）
    const scores: Map<number, number> | null = this.derpMap.regionScore;
    if (scores !== null) {
      const scaleIds: number[] = [];
      for (const rid of bestRecent.keys()) {
        scaleIds.push(rid);
      }
      for (const rid of scaleIds) {
        const score: number | undefined = scores.get(rid);
        if (score !== undefined && score > 0) {
          const d: number = bestRecent.get(rid) as number;
          bestRecent.set(rid, Math.trunc(d * score)); // Go: Duration(float64(d)*score) 截断
        }
      }
    }
    // 初选：候选 = 当前报告的 region，比较值 = 缩放后 bestRecent（:1454-1475）
    let bestAny: number = 0;
    let oldRegionCurLatency: number = 0;
    const candIds: number[] = [];
    for (const rid of r.regionLatency.keys()) {
      candIds.push(rid);
    }
    candIds.sort((a: number, b: number): number => a - b);
    for (const rid of candIds) {
      let d: number = r.regionLatency.get(rid) as number;
      if (scores !== null) {
        const score: number | undefined = scores.get(rid);
        if (score !== undefined && score > 0) {
          d = Math.trunc(d * score); // 不改报告原值（:1459-1465）
        }
      }
      if (rid === prevDERP) {
        oldRegionCurLatency = d;
      }
      const best: number = bestRecent.get(rid) ?? 0;
      if (r.preferredDERP === 0 || best < bestAny) {
        bestAny = best;
        r.preferredDERP = rid;
      }
    }
    // 换 home 的迟滞（:1477-1512）：旧 home 仍可达时，绝对差 <10ms 或
    // 新最优 > 旧×2/3（Go 整数除法 → floor(old/3)*2）任一命中即保旧
    let keepOld: boolean = false;
    const changingPreferred: boolean = prevDERP !== 0 && r.preferredDERP !== prevDERP;
    const activity: DerpActivitySource | null = rs.opts.activity;
    let prevRegionLastHeard: number = 0;
    if (activity !== null) {
      prevRegionLastHeard = activity.getLastDerpActivity(prevDERP);
    }
    let heardFromOldRegionRecently: boolean = false;
    if (changingPreferred) {
      heardFromOldRegionRecently = prevRegionLastHeard > rs.startWallMs;
      heardFromOldRegionRecently =
        heardFromOldRegionRecently || prevRegionLastHeard > nowWallMs - PREFERRED_DERP_FRAME_TIME_MS;
    }
    const oldRegionIsAccessible: boolean = oldRegionCurLatency !== 0 || heardFromOldRegionRecently;
    if (changingPreferred && oldRegionIsAccessible) {
      // bestAny ≤ 其余值，故差值 ≥ 0（上游 :1497 注释）
      if (oldRegionCurLatency - bestAny < PREFERRED_DERP_ABSOLUTE_DIFF_MS) {
        keepOld = true;
      }
      if (bestAny > Math.floor(oldRegionCurLatency / 3) * 2) {
        keepOld = true;
      }
    }
    if (keepOld) {
      r.preferredDERP = prevDERP; // 回写旧 home（:1508-1512）
    }
    // ForcePreferredDERP 覆盖（:1513-1524）：有样本或 8s 窗/开场后有活动即强制
    if (this.forcePreferredDERP !== 0) {
      const haveLatencySample: boolean = r.regionLatency.has(this.forcePreferredDERP);
      let lastHeard: number = 0;
      if (activity !== null) {
        lastHeard = activity.getLastDerpActivity(this.forcePreferredDERP);
      }
      let recentActivity: boolean = lastHeard > rs.startWallMs;
      recentActivity = recentActivity || lastHeard > nowWallMs - PREFERRED_DERP_FRAME_TIME_MS;
      if (haveLatencySample || recentActivity) {
        r.preferredDERP = this.forcePreferredDERP;
      }
    }
    // 兜底：无任何延迟数据但旧 home 的 KeepAlive 窗（120s）内听到过 → 保旧（:1525-1530）
    if (r.preferredDERP === 0 && prevRegionLastHeard > nowWallMs - PREFERRED_DERP_KEEPALIVE_TIMEOUT_MS) {
      r.preferredDERP = prevDERP;
    }
  }
}

/** 上游 namedNode（:1571-1583）：全 map 按 name 找节点（首个命中）。 */
function namedNode(map: NetcheckDerpMap, nodeName: string): NetcheckNode | null {
  for (const r of map.regions) {
    for (const n of r.nodes) {
      if (n.name === nodeName) {
        return n;
      }
    }
  }
  return null;
}
