/**
 * peer 连接状态机常量表（C2 研究笔记 §1，全部经 v1.102.3 上游实拉逐行核对，
 * 2026-10-02；消费一律经注入 Clock，P4 禁直读时钟）。
 *
 * R5/A18：常量集中本模块，禁止散落魔法数；"枚举类"取值用常量对象 +
 * 运行时校验模式（不用 enum / 字面量联合）。
 */

// ---- magicsock 层（v1.102.3 wgengine/magicsock/magicsock.go:4024-4076） ----

/** sessionActiveTimeout：45s "活动"线，心跳停止/状态 Active/periodic ReSTUN 停三处共用（:4024）。 */
export const SESSION_ACTIVE_TIMEOUT_MS: number = 45000;

/** upgradeUDPDirectInterval：延迟 >5ms 时重发全 ping 升级路径的周期（:4028）。 */
export const UPGRADE_UDP_DIRECT_INTERVAL_MS: number = 60000;

/** discoverUDPRelayPathsInterval：relay 路径发现最小间隔（:4036）。 */
export const DISCOVER_UDP_RELAY_PATHS_INTERVAL_MS: number = 30000;

/** heartbeatInterval：心跳 disco Ping bestAddr 的周期（:4040）。 */
export const HEARTBEAT_INTERVAL_MS: number = 3000;

/** trustUDPAddrDuration：bestAddr 唯一路径的可信时长；心跳 Pong 续期（:4044）。 */
export const TRUST_UDP_ADDR_DURATION_MS: number = 6500;

/** goodEnoughLatency：延迟 ≤5ms 不再尝试升级（:4048）。 */
export const GOOD_ENOUGH_LATENCY_MS: number = 5;

/** endpointsFreshEnoughDuration：发 CallMeMaybe 前自端点新鲜度门槛（:4053）。 */
export const ENDPOINTS_FRESH_ENOUGH_MS: number = 27000;

/** pingTimeoutDuration：disco Ping 等待 Pong 超时（:4060 + tsconst/ping.go:11）。 */
export const PING_TIMEOUT_MS: number = 5000;

/** discoPingInterval：同一候选两次 disco Ping 最小间隔（限速；:4066 + tsconst/ping.go:15）。 */
export const DISCO_PING_INTERVAL_MS: number = 5000;

/** wireguardPingInterval：wireguard-only 候选延迟探测间隔判定（:4071）。 */
export const WIREGUARD_PING_INTERVAL_MS: number = 5000;

/** indexSentinelDeleted：netmap 刷新期间候选"待删"哨兵（:4076）。 */
export const INDEX_SENTINEL_DELETED: number = -1;

/** 运行时候选表上限；超过触发一轮清理（endpoint.go:1630-1638）。 */
export const CANDIDATE_PRUNE_THRESHOLD: number = 100;

/** pongHistoryCount：每候选 pong 环形历史长度（endpoint.go:436）。 */
export const PONG_HISTORY_COUNT: number = 64;

/** wireguard-only peer 收包学习 bestAddr 的信任时长（endpoint.go:532-536，5s）。 */
export const WIREGUARD_ONLY_RECV_TRUST_MS: number = 5000;

/** wireguard-only 候选延迟探测的最小间隔（endpoint.go:1412，10s）。 */
export const WIREGUARD_ONLY_PROBE_MIN_INTERVAL_MS: number = 10000;

// ---- DERP 路由层（v1.102.3 wgengine/magicsock/derp.go） ----

/** derpInactiveCleanupTime：非 home DERP 连接空闲多久后关闭（derp.go:1070-1072）。 */
export const DERP_INACTIVE_CLEANUP_MS: number = 60000;

/** derpCleanStaleInterval：空闲 DERP 清理扫描周期（derp.go:1074-1076）。 */
export const DERP_CLEAN_STALE_INTERVAL_MS: number = 15000;

/** derpWriteQueueDepth：每 DERP 连接写队列深度（derp.go:329；队列满丢包不阻塞）。 */
export const DERP_WRITE_QUEUE_DEPTH: number = 32;

// ---- 过期防御（v1.102.3 ipn/ipnlocal/expiry.go、ts-main key-node.go） ----

/** minClockDelta：ControlTime 与本地差 >1min 才记 clockDelta（expiry.go:27-28）。 */
export const MIN_CLOCK_DELTA_MS: number = 60000;

/** flagExpiredPeersEpoch：ControlTime 早于此值忽略（expiry.go:20-23，time.Unix(1673373066,0)）。 */
export const FLAG_EXPIRED_PEERS_EPOCH_MS: number = 1673373066000;

/** 过期主动重查定时器的 +10s 迟滞（ipn/ipnlocal/local.go:1856-1858）。 */
export const EXPIRY_RECHECK_SLACK_MS: number = 10000;

/**
 * badOldPrefix：过期 peer 公钥前 6 字节替换值（"bad01" 可读标记，
 * key-node.go:224-237；C1 §1.3 纵深防御）。
 */
export const BAD_OLD_PREFIX_BYTES: Uint8Array = new Uint8Array([109, 167, 116, 213, 215, 116]);

/** DerpMagicIP：DERP home 的假地址 IP（ts-main/tailcfg.go:3072-3079）。 */
export const DERP_MAGIC_IP: string = '127.3.3.40';

// ---- 常量对象（R5：禁 enum / 字面量联合） ----

/** disco Ping 用途（上游 pingDiscovery/pingHeartbeat/pingCLI 非导出常量的类型化建模）。 */
export interface DiscoPingPurposeE {
  Discovery: number;
  Heartbeat: number;
  Cli: number;
}

export const DiscoPingPurpose: DiscoPingPurposeE = {
  Discovery: 1,
  Heartbeat: 2,
  Cli: 3,
};

/** 校验 v 是否为已知 disco Ping 用途；已知返回 v 原值，未知返回 null。 */
export function parseDiscoPingPurpose(v: number): number | null {
  if (v === DiscoPingPurpose.Discovery || v === DiscoPingPurpose.Heartbeat || v === DiscoPingPurpose.Cli) {
    return v;
  }
  return null;
}

/** send() 拒发原因（endpoint.go:1045-1048 errExpired/errNoUDPOrDERP 的类型化建模）。 */
export interface SendRejectionE {
  Expired: number;
  NoUdpOrDerp: number;
}

export const SendRejection: SendRejectionE = {
  Expired: 1,
  NoUdpOrDerp: 2,
};
