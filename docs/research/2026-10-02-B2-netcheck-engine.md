# B2 研究笔记：netcheck 引擎的探测调度（探测序列 / 周期 / 去抖 / Report 合并）

- 日期：2026-10-02 ｜ 角色：S-研究（子线 B · netcheck 引擎调度件）
- 上游版本锚定：**tailscale main @ `3ce5e209971d008f475836efd2ec16b75514bb4c`**（GitHub API commits/main，2026-10-02T09:59:48Z 取得）。
- 证据纪律：本笔记所有行号均为**当日实拉原文的原始行号**（raw 文件逐行编号，非转述）。上游 `net/netcheck.go` **不在仓内归档**（`docs/upstream/2026-10-01-phase2/` 只归档了 `net/stun/stun.go`，`docs/upstream/ts-main/` 无 netcheck 文件），本次按 TASK.md B-1 用 `curl -sSL https://raw.githubusercontent.com/tailscale/tailscale/main/<path>` 实拉到仓库外临时目录通读；**实现开工前应把这些原文按仓规归档进 `docs/upstream/`（本轮受"只写笔记"约束未归档，见 §0 文件清单）**。
- 结论标注：【上游】= 行号证据在手；【仓内】= 本仓文件行号；【裁定】= 依仓内既有文档/上游语义自行取舍项。

---

## 0. 本次实拉的上游文件清单（含拉取方式）

| 文件 | 上游路径 | 行数 | 拉取 URL（raw.githubusercontent.com@main，即上述 commit） | 用途 |
|---|---|---|---|---|
| netcheck.go | `net/netcheck/netcheck.go` | 1798 | `.../main/net/netcheck/netcheck.go` | 引擎主体（本笔记主证据） |
| netcheck_test.go | `net/netcheck/netcheck_test.go` | 1241 | `.../main/net/netcheck/netcheck_test.go` | 调度语义的测试向量锚定 |
| standalone.go | `net/netcheck/standalone.go` | 101 | `.../main/net/netcheck/standalone.go` | IO 边界形态（SendPacket/ReceiveSTUNPacket 自驱环） |
| derp.go | `derp/derp.go` | — | `.../main/derp/derp.go` | `KeepAlive = 60s`（:44），PreferredDERPKeepAliveTimeout 的因子 |
| tailcfg/derpmap.go | `tailcfg/derpmap.go` | 277 | `.../main/tailcfg/derpmap.go` | DERPMap/DERPRegion/DERPNode 字段级语义 |
| magicsock.go | `wgengine/magicsock/magicsock.go` | 4663 | `.../main/wgengine/magicsock/magicsock.go` | 调用方周期（periodic ReSTUN）与 NetInfo 消费 |

注意两点：
1. 上游已把 `net/netcheck.go` 拆为 **`net/netcheck/` 包**（GitHub contents API `net?ref=main` 实证目录存在，含 netcheck.go / netcheck_test.go / standalone.go 三文件）；旧笔记/旧归档路径 `net/netcheck.go` 会 404（jsdelivr 已实测返回 "Couldn't find the requested file"）。
2. 仓内 `docs/upstream/ts-main/conn.go` 头注实为 **`control/controlbase` 包**（conn.go:9 "Package controlbase"），不是 magicsock 的 conn.go——按文件名找调用方证据会扑空，调用方证据本次以实拉 `wgengine/magicsock/magicsock.go` 为准。

---

## 1. 引擎总览：调度是纯逻辑，IO 全部注入（与 P4/D4 天然同构）

【上游】`Client` 的所有外置能力都是**函数字段注入**：
- `TimeNow func() time.Time`（netcheck.go:235-236，兜底 time.Now :1366-1371）——挂钟；
- `SendPacket func([]byte, netip.AddrPort) (int, error)`（netcheck.go:238-240）——唯一的发包口；
- 收包口 `ReceiveSTUNPacket(pkt, src)`（netcheck.go:314-353），由外部把 STUN 回包路由进来（standalone.go:25-59 `Standalone` 绑定 udp4/6 并起读环转调它，readPackets :71-92；magicsock.go:1858 在自己的读环里转调）；
- `PortMapper`（netcheck.go:247-249）、`NetMon`（:224-226）、`UseDNSCache`（:251-258）、`SkipExternalNetwork`（:242-245）。
- `netcheck_test.go:480` 测试直接 `Client{TimeNow: ...}` 注入假时钟——**上游引擎本身就是"时钟注入、无全局取时"的形态**，本仓 P4（时钟经 common 注入）与它同构，移植不需要发明新形态。

调度核心数据结构：
- `probe{delay, node, proto, wait}`（netcheck.go:376-393）；`proto ∈ {probeIPv4, probeIPv6, probeHTTPS}`（:358-362）。
- `probePlan map[string][]probe`，key 形如 `"region-<id>-v4" / "region-<id>-v6"`（:395-406 语义注释 + :549-554 生成点）；plan 的值是**并发组**：同组内任意一个 probe 得到答案即取消其余（见 §4 去抖）。
- `reportState`（:613-626）：一次 GetReport 的现场——`inFlight map[stun.TxID]func(netip.AddrPort)`（TxID → 回调）、`stopProbeCh`、`gotEP4`、`timers`。

一次 `GetReport`（netcheck.go:832-1064）的骨架（顺序即调度顺序）：
1. 参数互斥校验：`OnlySTUN` 与 `OnlyTCP443` 不能同时（:833-839）；
2. ctx 超时 = `ReportTimeout` 5s（:849）；
3. **并发互斥**：`curState != nil` 直接报 "invalid concurrent call to GetReport"（:861-865）；
4. 全量/增量判定（见 §3.4）；
5. `OSHasIPv6`：尝试 bind `udp6 [::1]:0`（:928-932）——纯本机操作但仍是 socket，app 侧注入；
6. 端口映射探测 goroutine（UPnP/PMP/PCP，:934-937 + :750-771）；
7. 生成 probePlan 并按组并发跑 STUN（:941-944 + :959-972）；
8. **等待去抖**：select { 3s stunTimer / ctx.Done / 全组完成 / sawEnoughRegions }（:974-992）；
9. 等端口映射结束、停全部定时器（:994-998）；
10. UDP 全败才回退 HTTPS+ICMP（:1003-1058，见 §5.3）；
11. 等 captive portal（:1060-1061）→ `finishAndStoreReport`（:1066-1075，见 §5.4）。

---

## 2. 常量与周期总表（全部实读行号）

| 常量/周期 | 值 | 证据（均为 netcheck.go 除非另注） |
|---|---|---|
| ReportTimeout（单次报告总预算） | **5s** | :59-61 |
| stunProbeTimeout（STUN 阶段上限，超时转 HTTP 探测） | **3s** | :62-66 |
| icmpProbeTimeout | **1s** | :67-69 |
| httpsProbeTimeout | **= ReportTimeout（5s）** | :70-74 |
| defaultInitialRetransmitTime（首轮重传间隔） | **100ms** | :82-87 |
| defaultActiveRetransmitTime（稳态无历史时重传间隔） | **200ms** | :75-81 |
| 重传间隔（增量、有该 region 历史延迟） | **last×1.2**（整数运算 `*120/100`），无历史则 200ms | :535-537 |
| 重传 delay 公式（增量） | `delay = try×prevLatency; try>1 时再 + try×50ms` | :538-541 |
| 初始计划 delay | `try × 100ms`（即 0/100/200ms） | :571 |
| 每 region 初始探测次数 | **3 次**（`for try := range 3`） | :569 |
| enoughRegions（"测够几个 region 就早停"） | **3**（Verbose=100、测试可覆盖） | :276-286 |
| 早停定时（听到 3 个 region 后） | **max(RegionLatency)**，全量再 ×2，到点 stopProbes | :694-706 |
| numIncrementalRegions（增量扫最快几个 region） | **3** | :438-441 |
| home region 增量探测次数 | **4 次**（"try extra hard"） | :519-524 |
| fullReportInterval（全量报告最大间隔） | **5min** | :1373-1379 |
| 报告历史保留窗 maxAge | **5min + ReportTimeout = 305s** | :1414-1421 |
| preferredDERPAbsoluteDiff（换 home 的最小绝对差） | **10ms** | :1380-1387 |
| PreferredDERPFrameTime（收到 DERP 帧视为存活的回看窗） | **8s** | :1388-1392（注释注明必须 > derp 包 frameReceiveRecordRate） |
| PreferredDERPKeepAliveTimeout | **2×derp.KeepAlive = 120s** | :1393-1401；derp/derp.go:44 `KeepAlive = 60*time.Second`（实拉取证；**不是 2s**，测试 no_data_keep_home/no_data_home_expires 的步进边界 30s+2s×N 与 2×KeepAlive 步进对此为旁证，netcheck_test.go:443-474） |
| 调用方周期（magicsock periodic ReSTUN） | **随机 20–26s**（"just under 30s, a common UDP NAT timeout"） | magicsock.go:899-916（RandomDurationBetween 在 :904）；触发点 doPeriodicSTUN :877 |
| 空闲停测阈值 sessionActiveTimeout | **45s**（可被控制面 ForceBackgroundSTUN knob 推翻） | magicsock.go:4062、:3662-3690 |
| STUN 默认端口 / 禁用 | 0→3478；**负值→禁 STUN** | :1667-1672；tailcfg/derpmap.go:230-233 |

---

## 3. 探测序列（probe plan 的两条生成路径）

### 3.1 初始计划 `makeProbePlanInitial`（无历史：last==nil 或 RegionLatency 空，netcheck.go:455-458 → :559-587）

- 遍历**全部** region（跳过 `NoMeasureNoHome` 与空 nodes，:562-565）；
- 每 region 固定 **3 try**，`n := reg.Nodes[try % len(reg.Nodes)]` **节点轮换**（:569-570）；
- delay = try×100ms → **0 / 100 / 200ms**（:571）；
- v4 收录条件：`n.IPv4 != "none" && ((HaveV4 && nodeMight4(n)) || IsTestNode)`；v6 同理（:572-577）。`nodeMight4/6`（:589-610）只在字段**显式为 "none"（或非本族地址）**时返回 false，空串（走 DNS）返回 true。
- 【上游测试锚定】netcheck_test.go:612-641 "initial_v6 / initial_no_v6"：2 节点 region 的 v4 序列恰为 `a → b@100ms → a@200ms`（a→b→a 轮换）。

### 3.2 增量计划 `makeProbePlan`（有历史，netcheck.go:443-557）

排序：`sortRegions`（:411-436）按 **last.RegionLatency 升序**、**无数据（0 值）排最后**（:423-434 的比较：非零排零前）；跳过 `NoMeasureNoHome`（:414）；`Avoid` region 跳过**除非它是 home**（:417-420；Avoid 字段已 deprecated，tailcfg/derpmap.go:145-159，新字段 NoMeasureNoHome :161-169）。

逐 region（ri 为排序后下标）：
1. **home 强制包含**（#13969 修复，:466-494）：`planContainsHome := preferredDERP==0`；`ri >= 3` 时若 home 已在计划内 break，否则只放行 home region 本身（`continue` 其余）——保证"最近一次全量测出高延迟的 home 不会被增量漏测导致 home 漂移"。【上游测试锚定】netcheck_test.go:766-799 "ensure_home_region_inclusion"：home(50ms) 排第 4 仍被纳入并打 4 try，region-5（无数据）被 break 掉。
2. **tries**：默认 1；**最快两名（ri<2）或 home → 2**（:500-505）；否则双栈机（had4&&had6&&HaveV6）按 `ri%2` **v4/v6 交替**（:506-514）；`!home && !fastestTwo && !had6` → 砍 v6（:515-517）；home 最终 **tries=4**（:519-524）。
3. **delay**：`prevLatency = last.RegionLatency[rid]×120/100`（无则 200ms，:535-537）；`delay = try×prevLatency (+ try×50ms when try>1)`（:538-541）；节点轮换同初始（:534）。
4. try 环内还有一条：`try != 0 && !had6 → do6=false`（:531-532）——无 v6 历史时 v6 只打一发、不重试。
5. 入 plan 的 key：`region-<id>-v4` / `region-<id>-v6`（:549-554）。

【上游测试向量（可直接移植为本仓 KAT）】netcheck_test.go:738-764 "try_harder_for_preferred_derp"：last= {1:10ms(home), 2:20, 3:30, 4:40}，期望 plan：
```
region-1-v4: 1a@0, 1a@12ms, 1a@124ms, 1a@186ms   // 10×1.2=12; try2: 24+100=124; try3: 36+150=186
region-1-v6: 同上 4 发
region-2-v4/v6: 2a@0, 2b@24ms                     // 20×1.2=24，最快两名 2 try
region-3-v4: 3a@0                                 // ri=2：非最快两名，双栈交替 ri%2==0→只 v4，1 try
（region-4/5 无：ri>=3 且 home 已含 → break）
```
全部 delay 数值与 :538-541 公式逐项吻合，公式化验证通过（我在本次研究中对该向量做了逐项手算复核：12=10×1.2、124=2×12+2×50、186=3×12+3×50、24=20×1.2、36=30×1.2）。

### 3.3 地址解析（发给谁）`nodeAddrPort`（netcheck.go:1658-1754）

- 端口：`port<0 || port>65535 → false`；`port==0 → 3478`（:1667-1672）；
- `STUNTestIP` 覆盖（含按 proto 过滤族，:1673-1685）；
- 显式 `n.IPv4`/`n.IPv6` 优先（:1687-1703）；否则 DNS 解析 `HostName` 取第一个匹配族地址（:1708-1753，UseDNSCache 时经 dnscache）。
- tailcfg 语义（tailcfg/derpmap.go）：`IPv4/IPv6` 空串=DNS、"none"=禁用（:216-228）；`STUNPort` 0=3478、-1=禁 STUN（:230-233）；`STUNOnly`=纯 STUN 非 DERP（:235-237）；`IsTestNode = STUNTestIP!="" || IPv4=="127.0.0.1"`（:258-260）。

### 3.4 全量 vs 增量的周期判定（GetReport :887-905）

```
doFull = nextFull                                    // MakeNextReportFull() 置位（:302-308）
       || now - lastFull > 5min                      // fullReportInterval（:887-890）
       || (last.UDP==false && last.CaptivePortal==true)  // 上次被 captive portal 憋住→重测全量（:891-897）
doFull ⇒ last=nil（逼出初始计划）、nextFull=false、lastFull=now（:898-903）
rs.incremental = (last != nil)                       // :905
```
另【上游】`TestRecentReportsRetainFullNetcheck`（netcheck_test.go:505-558）锁死一个不变量：**历史窗内必须始终留有至少一份全量报告**（否则增量只测最快 3 个+home，冷 region 的 bestRecent 会被遗忘）——maxAge=5min+5s 的 +5s 就是为这个（:1414-1416 注释）。

---

## 4. 去抖（早停、防抖动、防 home 漂移）——四层机制

### 4.1 组内早停（probe 级）
- `runProbe`（:1585-1656）：先等 `probe.delay`（:1593-1601）；**`probeWouldHelp` 为假则取消整组**（:1603-1606）。`probeWouldHelp`（:645-673）三问：该 region 还没延迟数据？是 v6 且尚无任何 v6 结果？是 v4 且 `MappingVariesByDestIP` 还是未知（""）？——都不新鲜就不再发包。
- **收到应答即停同组**：`inFlight[txID]` 回调 = `addNodeLatency(...)` 后立刻 `cancelSet()`"abort other nodes in this set"（:1619-1624）。即：同 region 同族的 (0,100,200ms) 重传串，一旦有回包，后续重传全部取消——**这就是重传去抖**。

### 4.2 报告级早停（saw enough regions）
- `addNodeLatency` 里当 `len(RegionLatency) == enoughRegions()(3)` 时挂定时器：时长 = 当前最慢 region 延迟（全量 ×2），到点 `stopProbes`（:694-706、:737-742）。
- 主 select（:974-992）四路：3s stunTimer / ctx.Done / **全组完成**（此时若有 UDP 则顺带停 captive portal 检查）/ **stopProbeCh（saw enough regions）**。

### 4.3 PreferredDERP 迟滞（防 home 漂移，`addReportHistoryAndSetPreferredDERP` :1426-1531）
1. 报告先入历史 `c.prev[now]`、置 `c.last`，清理 5min+5s 之外的旧报告（:1406-1422）；
2. `bestRecent = 各 region 在历史窗内的**最小**延迟`（:1437-1438 + bestRecentLatencyLocked :1536-1546）；DERPMap `HomeParams.RegionScore` 对 bestRecent 与当前报告延迟**同时缩放**（score∈(0,1) 加权、(1,∞) 惩罚、0/负忽略；:1442-1450、:1458-1466；tailcfg/derpmap.go:49-66）；
3. 候选 = **当前报告** RegionLatency 的 region，比较值 = 缩放后的 bestRecent，取最小 → `r.PreferredDERP`（:1454-1475）；
4. **换 home 的两道迟滞**（:1477-1512）：仅当旧 home 本轮仍"可达"（本轮有延迟数据，或 8s 内/since start 收到过它的非 STUN 流量——`GetLastDERPActivity` 注入，:1483-1495）才考虑保旧：绝对差 <10ms → 保旧；新最优 > 旧×2/3 → 保旧（"about the same on a percentage basis"）；保旧 = 回写 `r.PreferredDERP = prevDERP`（:1508-1512）；
5. `ForcePreferredDERP` 覆盖：有延迟样本或 8s 窗内有活动即强制（:1513-1524）；
6. 兜底：本轮无任何延迟数据但旧 home 的 KeepAlive 窗（**120s**）内听到过 → 保旧不归零（:1525-1530）。

【上游测试锚定】netcheck_test.go:278-304 四个迟滞用例：4s/3s 不换（差 1s≥10ms 但 3s>4s×2/3）、4ms/1ms 不换（差 3ms<10ms，**即使快了 75%**）、4s/1s 换（1s<2.667s）、34ms/23ms 不换（差 11ms≥10ms 但 23>34×2/3）——两个条件是**与**关系下先到先判（任一命中即保旧）。RegionScore 用例 :306-350（66% 权重使 10s 压过 8s；但 100s vs 10s 照换）；流量保活用例 :351-380、无数据保 home :442-474（120s 窗内/窗外的边界步进）。

### 4.4 hairpin 残包忽略
【上游】收到的包解析失败且**能被解析成 Binding Request** → 视为自己旧版 hairpin 探测的迟到回声，静默忽略（:331-341，注释明确 "We no longer send hairpin checks"）。TS 移植：配对失败时先试 `stunParseBindingRequest`，成功则**不记日志静默 return**。

---

## 5. 结果合并成 netcheck Report

### 5.1 Report 结构（netcheck.go:90-131）与三态 opt.Bool
布尔字段分两类：
- 纯 bool：`UDP/IPv6/IPv4/IPv6CanSend/IPv4CanSend/OSHasIPv6/ICMPv4`（:93-99）；
- **三态 opt.Bool**：`MappingVariesByDestIP/UPnP/PMP/PCP/CaptivePortal`（:101-128）——Go `opt.Bool` 空值 = "未检测"，语义上等价 `boolean | null`。**移植陷阱**：`MappingVariesByDestIP == ""`（未知态）是 `probeWouldHelp`（:667）与去抖逻辑的活输入，不能塌缩成 false。
- 延迟表：`RegionLatency / RegionV4Latency / RegionV6Latency` 三张 map[regionID]duration（:115-118）+ `GlobalV4/V6` 与 `GlobalV4/V6Counters`（:120-124）+ `PreferredDERP`（:115）+ `Now`（:92，报告时刻）。

### 5.2 STUN 回包合并：`addNodeLatency`（:686-735）——逐字段规则
1. 任何 STUN 成功回包：`UDP=true`；`RegionLatency[rid]` 取**历史最小**（`updateLatency` :1565-1569：`!ok || d<prev` 才写）；
2. v6 回包：`IPv6CanSend=true`、`RegionV6Latency` 最小合并、`IPv6=true`、**`GlobalV6 = ipp`（每次覆盖，取最新）**、`GlobalV6Counters[ipp]++`（:709-718）；
3. v4 回包：`IPv4CanSend=true`、`RegionV4Latency` 最小合并、`IPv4=true`、`GlobalV4Counters[ipp]++`；**`GlobalV4` 只记第一次观察到的端点**（`gotEP4` 哨兵，:719-727）；第二个不同端点出现 → `MappingVariesByDestIP=true`；相同端点再现且当前为未知 → false（**一旦 true 不会被改回 false**，:727-733）。注释明确 v6 不做 MappingVariesByDestIP（:717-718）。
4. 发送侧独立证据：`SendPacket` 成功（n==len && err==nil，或 TreatAsLostUDP）→ `IPv4CanSend/IPv6CanSend=true`（:1643-1653）；`SendPacket==nil` → 两者置 false（:1626-1632）；STUN 回包本身也证明 CanSend（:710-713）。

### 5.3 UDP 全败的回退合并（HTTPS + ICMP，GetReport :1000-1058）
- 触发条件：`!anyUDP() && ctx 未过期 && !OnlySTUN`（:1003）；候选 = 缺延迟数据 && 有非 STUNOnly 节点 && !Avoid && !NoMeasureNoHome 的 region（:1005-1010 + regionHasDERPNode :1756-1763）；
- HTTPS（`measureHTTPSLatency` :1149-1228）：对 region **拨一次 region 级 TLS**（derphttp `DialRegionTLS`，:1161——不是每节点一次），再 `GET https://<node.HostName>/derp/latency-check` 计请求时长，状态码 >299 视为 MITM 拒绝不采信（:1198-1216）；
- 合并规则（:1036-1041）：`RegionLatency[rid]` 无则写入、**有且 `latency >= d` 才覆盖**（还是最小合并）；`IPv4/IPv6` 按 dialed IP 族置 true（注释承认随机性、无大用，:1042-1052）；
- ICMP（:1230-1308）并行跑（1s 预算）：ping `Nodes[0]`，payload = **node.Name 字节**（:1300 注释：用唯一 node 名降低回包错配概率）；`STUNPort<0` 的节点直接跳过（:1283-1286）；合并同"最小"规则并置 `IPv4=true, ICMPv4=true`（:1256-1264）。
- js/wasm 等 HTTP-only 平台走 `runHTTPOnlyChecks`（:914-922、:1079-1145）：`HEAD /derp/probe` 两连发（一次暖连接、一次计时）。

### 5.4 收口：`finishAndStoreReport`（:1066-1075）
`Clone`（深拷四张 map，:175-186）→ `addReportHistoryAndSetPreferredDERP`（§4.3）→ `logConciseReport`（:1310-1364，人类可读行，`tailscale netcheck` 的输出形态）→ 返回克隆。历史里的 `r.Now = now.UTC()`（:1410）。

### 5.5 端点清单输出：`GetGlobalAddrs`（:133-168）
返回顺序：**GlobalV4/GlobalV6 在前，其余 Counters>1 的端点在后**；单次出现的端点被排除（注释：疑似 hard NAT 的临时映射，Palo Alto 防火墙实测案例 :144-150）。【上游测试】netcheck_test.go:81-109：观察序列 port1、port2、port3、port3 → 输出 `[port1, port3]`（port2 单次被排除）。**注意陷阱**：GetGlobalAddrs 的文档注释说 "best latency endpoint first"（:134-135），但代码实际放最前的是 `GlobalV4/V6`，而 v4 的 GlobalV4=**第一个观察到的**端点（§5.2.3）、v6=**最新观察到的**（§5.2.2）——注释与实现有出入，移植以代码行为为准。

### 5.6 上层消费：Report → tailcfg.NetInfo（上报控制面）
【上游】magicsock `updateNetInfo`（magicsock.go:1025-1083）：`DERPLatency` 键为 `"<regionID>-v4"/"<regionID>-v6"`、值为 `d.Seconds()` 浮点秒（:1061-1066）；`WorkingIPv6/OSHasIPv6/WorkingUDP/WorkingICMPv4`、`MappingVariesByDestIP/UPnP/PMP/PCP`、`PreferredDERP` 逐一映射（:1055-1077）。与本仓取证【仓内】`docs/oracle/protocol-notes.md` §4 NetInfo 字段清单、§5 `tailscale netcheck` 输出（UDP/IPv4/IPv6/MappingVariesByDestIP/PortMapping/Nearest DERP/DERP latency 表）完全对应，可作为本仓引擎输出的验收镜。

---

## 6. 字节级/线级格式细节（引擎涉面）

引擎本身不定义新线格式，但锁死以下四条线级行为：
1. **STUN Binding Request 40B**：`type 0x0001 ‖ len u16be ‖ magic 21 12 a4 42 ‖ TxID 12B ‖ SOFTWARE(0x8022,"tailnode") ‖ FINGERPRINT(0x8028, CRC32-IEEE(前缀)^0x5354554e)`——仓内已实现并 KAT 锚定【仓内】`packages/netcheck/src/stun.ts:32-54,148-167`（上游 net/stun/stun.go 归档于 `docs/upstream/2026-10-01-phase2/stun.go`）。引擎侧只需 `TxID = Rng.randomBytes(12)`、`inFlight` 以 12B TxID 为键配对（上游 :1614-1624；TxID 提取 `b[8:20]`）。
2. **RTT 记账点**：`sent` 在 **DNS 解析之后**取（:1617），回包到达时 `time.Since(sent)`（:1621）——即 RTT 不含 DNS 时长。对应仓内 `StunTransaction`：构造（发请求）时记 `sentMonoMs`，**回包到达时**调 `rttMs()`（probe.ts:30-36,64-67）——引擎必须在收到回包的那一刻采样，不能延迟到合并时。
3. **HTTPS 延迟探测** = `GET https://<HostName>/derp/latency-check`（:1198），<299 才采信（:1214-1216），读掉 ≤8KB body（:1218）；HTTP-only 环境为 `HEAD /derp/probe` 双发暖连（:1118-1139）。
4. **ICMP payload = node.Name 的原始字节**（:1298-1300）。
5. 端口规则复述（字节级易错点）：STUN 端口 0→3478、**负→禁**（:1667-1672）；DERP 节点地址字段 `"none"` 字符串=禁用该族（tailcfg/derpmap.go:216-228）——`nodeMight4/6` 对 "none" 返回 false 的机制就是 ParseAddr 失败（:589-610）。

---

## 7. 与本仓现有实现的衔接点

| # | 本仓锚点 | 衔接方式 |
|---|---|---|
| 1 | 【仓内】`packages/netcheck/src/stun.ts`（Binding Request/Response 编解码、`stunIs/stunTxid/stunParseResponse`） | 引擎直接复用；**零改动**。stun.ts:26 头注已预留"引擎边界"：端点枚举/Multi-Dest/端口映射归引擎 |
| 2 | 【仓内】`packages/netcheck/src/probe.ts` `StunTransaction`（TxID 生成 + 请求字节 + 配对 + 单调 RTT） | 正是上游 `runProbe` :1614-1624 的单事务切片；引擎的 `inFlight` 表值类型即"事务+回调"。注意 probe.ts 定义了局部 `MonoClock`（probe.ts:21-23），引擎若统一用 common `Clock`，建议引擎层直接依赖 common.Clock（同形，无破坏） |
| 3 | 【仓内】`packages/common/src/clock.ts`（Clock.wallMs/monotonicMs + FixedClock.advanceMs） | 上游 `TimeNow func()`（netcheck.go:235-236）的 P4 对应物；**上游报告/历史/迟滞全部用挂钟轴**（`now.Sub(c.lastFull)`、`prevRegionLastHeard.After(now.Add(-8s))` 等，:888、:1490），RTT 用发送点本地计时——移植时：历史窗/8s/120s 窗用 wallMs，RTT/重传 delay 用 monotonicMs（FixedClock 双轴同步推进正好都确定） |
| 4 | 【仓内】`packages/common/src/random.ts` `Rng` | 上游 `stun.NewTxID()`（:1614）的注入源 |
| 5 | 【仓内】`packages/derp/src/region.ts` DerpNode/DerpRegion（stunPort 0=缺省/负=禁、latencyMs=-1 未测出） | 字段语义与 tailcfg/derpmap.go 一致（§3.3/§6.5），但**引擎输入不能直接复用 DerpRegion**：缺 `stunOnly/stunTestIP/noMeasureNoHome/avoid` 字段，且 netcheck 需要 per-family（v4/v6）延迟双表而非单一 latencyMs。【裁定】引擎在 netcheck 包内定义**最小输入视图 interface**（regionId/nodes{name,regionId,hostName,ipv4,ipv6,stunPort,stunOnly,stunTestIP,isTestNode…}），app 侧从 derp/tailcfg 适配——理由：architecture.md D2 只定义了 derp→common 单向边，新增 netcheck→derp 边属架构变更须走 AU 修订；本仓惯例是"各包自定义注入接口定义在本包内"（architecture.md §10.1），netcheck 现仅依赖 common（packages/netcheck/package.json dependencies 实查），维持单向最小边 |
| 6 | 【仓内】`app/bridge/src/mock-udp-bus.ts`（UdpDatagramBus + MockStunServer）+ `shell-discovery.ts` ShellStunProbe | 引擎测试的确定性 IO 底座已就位（worklog 2026-10-01 worker-A 第 2 轮）；引擎单测甚至不需要它——纯调度逻辑用 FixedClock 驱动即可，bridge 层做端到端冒烟 |
| 7 | 【仓内】`packages/derp/src/region.ts` `DerpRegionPicker.homeRegion()` | 本仓一期 home 选择=最小非负延迟，无迟滞。二期引擎落地后，**home 选择权威应移到 netcheck 的 PreferredDERP 迟滞逻辑**（§4.3），Picker 保留为展示层兜底；两处语义差异（并列取先声明者 vs 上游 10ms/2/3 迟滞）需在 AU 清单标注 |
| 8 | 【仓内】`docs/architecture.md` §10.2 AU 清单 | 须新增 AU 条目：netcheck 引擎调度上游核对（本笔记即证据），标注 ✅ 及 commit；D1 依赖图若维持 netcheck→common 则同时注明"DERP map 输入经 app 侧适配" |
| 9 | 【仓内】`packages/common/src/constants.ts` STUN_DEFAULT_PORT=3478 | 与上游 :1670-1672 一致；引擎内部硬编码 3478 时引此常量 |

---

## 8. 实现陷阱清单（Go→TS/ArkTS 移植专属）

1. **goroutine → 时钟驱动状态机**：上游一组 probe = goroutine + `time.AfterFunc` + channel select（:959-992）。核心库禁线程/定时器（P3/P4），移植形态只能是**纯函数状态机**：引擎暴露"计划生成（纯）+ 事件推进（`onTimer(nowMs)` / `onPacket(buf, src, nowMs)`）+ 下一个定时器提示"，由 app 侧桥把真实 timer/socket 翻译成事件。 FixedClock.advanceMs 驱动即可全确定性复现上游时序。
2. **并发互斥语义**：上游禁止 GetReport 并发（:861-865）。TS 单线程下自然满足，但**重入**（上一场未 finish 又 GetReport）要按上游语义显式抛错，不能静默覆盖 `curState`。
3. **Go map 迭代无序**：PreferredDERP 初选循环遍历 `r.RegionLatency`（:1458），并列时**谁先迭代谁当选**（条件是严格 `<`）。TS 侧 Map 也保插入序，但为确定性测试【裁定】并列显式按 regionId 升序打破，并在 AU 条目记录这一处有意分歧（上游依赖迭代序本质是不确定行为）。`GetGlobalAddrs` 的 counters 遍历（:151-166）同理——建议按"计数降序、region 无关、端点字节序升序"定死输出顺序。
4. **opt.Bool 三态**：`MappingVariesByDestIP` 的未知态参与调度判断（§5.1）；TS 建模 `number | null` 或 -1/0/1 常量对象（R5 禁字面量联合）。`MappingVariesByDestIP.Set(false)` 只在当前为未知时发生（:730-732）的守卫要保留。
5. **min-merge 的两处变体**：STUN 路径 `updateLatency`（:1565-1569）与 HTTPS/ICMP 路径 `!ok || latency >= d`（:1037-1041、:1256-1260）语义相同（取最小），但**相等时后者覆盖前者不覆盖**——上游两处写法行为一致（都保留旧值），移植统一为"严格小于才写"。
6. **整数算术**：`prevLatency = last×120/100` 是 Go 整数除法（:536）；TS 用 `Math.floor((last*120)/100)`（毫秒级 last 为非负整数，floor 正确）。`try>1` 时 `+ try×50ms` 别漏（:538-541）。
7. **GlobalV4 首见 / GlobalV6 末见的不对称**（§5.2.2/5.2.3）——凭直觉统一成"首见"或"末见"都会错一半；`gotEP4` 是 reportState 级状态（跨 region 跨节点共享），不是每 region 独立。
8. **`probe.wait` 字段是死的**：定义于 :390-392，netcheck.go 全文无读取点（本次 grep 实证），仅测试 String() 打印——移植可不建模，别为它发明语义。
9. **RegionLatency 零值 = 无数据**：sortRegions 用 `da==0` 判"没测过"排最后（:423-434）；TS 里 duration 用 `number`，需区分 0（合法但语义=无）——Go duration 零值恰好等于"0 纳秒"复用；TS 建议缺席即无（Map 无键），排序时显式处理"缺席排最后"，不要引入 0 值键。`RegionLatency.Compare`（:206-214，定义优先→延迟→regionId）目前在包外（ipnlocal 建议 exit node）消费，引擎内排序用 sortRegions 的简化版即可。
10. **Clone 必须深拷**：`Report.Clone` 克隆全部四张 map（:175-186）；TS 手写逐字段拷贝（A31 禁 Object.assign；A27 禁对象展开）。
11. **`history maxAge` 边界**：清理条件是 `now.Sub(t) > maxAge`（**严格大于**，:1417-1420），且先入后清（新报告先入 prev 再清旧，:1411-1419）——测试 "things_clean_up"（netcheck_test.go:267-277）用 10min 步进验证 4 份全清。
12. **STUNOnly / Avoid / NoMeasureNoHome 的生效点不同**：STUNOnly 只影响 HTTPS/ICMP 回退候选（regionHasDERPNode :1756-1763）；NoMeasureNoHome 在排序（:414）与初始计划（:563）两处整体跳过；Avoid 只在排序跳过且 home 例外（:417-420）。别把三者混成一个开关。
13. **UDP 被阻断的判定顺序**：HTTPS/ICMP 回退只在 `!anyUDP()` 且 **3s select 自然超时**（而非 sawEnough/全部完成）后发生；ctx 已过期（5s 用尽）则连回退都不做（:1003 `ctx.Err() == nil`）。5s 总预算 > 3s STUN 预算 > 1s ICMP 预算（netcheck_test.go:1090-1100 锁死该大小关系）。
14. **captive portal 反馈环**：`last.UDP==false && last.CaptivePortal==true` 触发下次全量（:891-897）——本仓一期可不做 portal 检测本体（hook 形态，:823），但 **Report.CaptivePortal 三态字段与该反馈规则要建模**，否则 upstream 语义缺一环。
15. **ArkTS 禁则对照**（validate:shell 会查）：无 any/unknown（报告 map 用 `Map<number, number>` 显式标注，A1/A13）；禁字面量联合（probeProto 用 R5 常量对象 `{ IPv4:0, IPv6:1, HTTPS:2 }` + parse 校验，A18/R5）；禁 tuple（delay+try 组别用纯字段 interface，R4）；禁嵌套函数/函数表达式（probe 回调提升为类方法，A22/R6）；throw 仅 Error 子类（复用 StunError 或新增 NetcheckError('STATE'|'RANGE')，A25/R7）；相对导入 `.ts` 后缀、跨包 `@ohos-tailscale/common`（P2/D3）。
16. **数值域**：regionId 上游保证 ≤2^53-1（tailcfg/derpmap.go:74,93-97 "fit in a JavaScript number"）——TS 直接 number，勿用 BigInt（P6 只管 u64 槽位）。延迟毫秒 number 足够。
17. **端口映射（UPnP/PMP/PCP）**：netcheck 只消费 `PortMapper.Probe()` 的三布尔结果（:750-771）；portmapper 包（net/portmapper）不在本次研究范围——【裁定】引擎预留 `PortMapperProbe` 注入接口（可空=不探测，字段保持三态未知），portmapper 语义另立研究件。这与 protocol-notes §5【实测】"portmap.txt 报 no gateway or self IP，三协议探测不可用"的兜底形态一致（未注入时 UPnP/PMP/PCP 保持空 = AnyPortMappingChecked()=false，:170-173）。
18. **上游已删 hairpin 主动探测**：只保留迟到回声的静默忽略（:333-339）——移植时不要"补全"主动 hairpin 检测，那是已移除的旧语义。

---

## 9. 建议的测试锚定（对齐本仓 node:test + 中文用例风格）

可从上游测试**直接移植向量**（不引 Go 测试框架，仅取数值与结构）：
1. **计划生成 KAT**：§3.2 的 try_harder/ensure_home_region_inclusion/initial_v6 三组向量（netcheck_test.go:612-799）→ 用例名如「增量计划：home region 打 4 发且重传间隔为上次延迟×1.2 加发」；
2. **迟滞步进**：netcheck_test.go:228-474 的 steps 表（尤其 4ms/1ms 不换、34/23 不换、120s 窗边界）→ FixedClock.setWallMs 推进挂钟轴；
3. **合并规则**：TestMultiGlobalAddressMapping（:81-109，端点计数与首见语义）、TestSTUNResponseProvesCanSend（:111-131）、updateLatency 最小合并；
4. **超时大小关系**：TestReportTimeouts（:1090-1100）→ 常量表守恒断言；
5. **历史保留不变量**：TestRecentReportsRetainFullNetcheck（:505-558）——每分钟一份增量报告跨一小时，断言 bestRecent 始终覆盖全部 region。
全部用 FixedClock/ArrayRng 注入，零真网络，符合 G0-5。

## 10. 本次研究的边界（如实未做）

- 未读 `net/portmapper`（UPnP/PMP/PCP 协议本体）——引擎只接其布尔结果，见 §8.17；
- 未读 `net/captivedetection` 与 `feature/captiveportal` hook 本体（:815-823 只读了 hook 签名）；
- 未读 `derphttp.DialRegionTLS` 实现体（HTTPS 回退的 TLS 拨号细节，region 级而非节点级——在 derphttp 包）；
- 未做任何实现与测试编写（本任务只读，唯一产物即本笔记）；未跑任何仓内测试命令（不适用于只读研究件；G0 各门由实现/验收会话执行）。
