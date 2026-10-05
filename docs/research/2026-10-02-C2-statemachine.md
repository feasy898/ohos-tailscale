# C2 研究笔记：peer 连接完整状态机（各状态、disco/STUN/DERP 事件驱动迁移、心跳与超时）

- 日期：2026-10-02；子线 C（TASK.md §2.3「完整状态机」）前置上游实读。
- 作者角色：协议研究员（S-研究）。本笔记只读取证，不写任何代码；引用一律给上游文件+行号。
- 版本锚定（三份对照）：
  1. **仓内归档**：`docs/upstream/ts-main/`（tailscale main 快照，`CurrentCapabilityVersion = 148`，ts-main/tailcfg.go:200；其中 tailcfg.go:3072-3079 有 DerpMagicIP；derp-frames.go:44 有 `KeepAlive=60s`；derpserver.go:2636 有服务端 keepalive 间隔）与 `docs/upstream/2026-10-01-phase2/`（disco.go / key-disco.go / wg-device-constants.go / wg-device-noise-protocol.go，README.md 有来源表）。
  2. **上游 tag `v1.102.3` 实拉**（oracle 是同版本 fork，protocol-notes.md:14）：本会话用 curl 从 `raw.githubusercontent.com`/`cdn.jsdelivr.net` 实拉以下文件到 `$TEMP/c2-upstream`（未入仓，遵守本轮只读纪律；**行号均以 v1.102.3 文件内容为准**，实现者复拉同 URL 即可复核）：
     `wgengine/magicsock/endpoint.go`(2114 行)、`wgengine/magicsock/magicsock.go`(4610 行)、`wgengine/magicsock/derp.go`(1077 行)、`wgengine/magicsock/peermap.go`(240 行)、`wgengine/magicsock/endpoint_tracker.go`(248 行)、`disco/disco.go`(653 行)、`net/netcheck/netcheck.go`(1758 行)、`tsconst/ping.go`、`wgengine/userspace.go`(节选)；另拉 tailscale wireguard-go fork master 的 `device/{peer,timers,send,receive}.go`（计时器为结构性稳定文件；constants.go 已有仓内归档 wg-device-constants.go）。
  3. **oracle 取证**：`docs/oracle/protocol-notes.md`（Offline peer harmony-vm 案例 §2.3、Relay/HomeDERP 映射 §2.2、metrics 证明 disco/patch 在用 §7）。
- 一个总体结论：**上游没有单一的"peer 连接状态机"，它是五层子状态机的复合体**：① WireGuard 会话层（wireguard-go 五计时器，握手→重钥→失效）；② magicsock 端点层（per-peer `endpoint`：bestAddr 信任/过期/清除）；③ 候选地址层（per-`endpointState`：netmap 候选 vs 运行时学习候选 vs CallMeMaybe 候选）；④ DERP 路由层（home 连接 + per-peer 路由学习 + 空闲回收）；⑤ 自发现层（netcheck/ReSTUN 调度，喂 ①②④ 的输入）。各层之间的全部耦合点是**时间戳字段 + 五类事件**，§7 给出事件→迁移总表。

---

## 1. 心跳/超时常量总表（全部为实读行号；实现时经注入 Clock 消费，P4）

### 1.1 magicsock 层（v1.102.3 `wgengine/magicsock/magicsock.go`，本表行号来自实拉的 magicsock.go）

| 常量 | 值 | 行号 | 语义 |
|---|---|---|---|
| `sessionActiveTimeout` | 45s | magicsock.go:4024 | "活动"定义：心跳停止线（endpoint.go:841）、status Active（endpoint.go:2041）、periodic ReSTUN 停止线（magicsock.go:3647）三处共用 |
| `upgradeUDPDirectInterval` | 1min | magicsock.go:4028 | 有直连但延迟 >5ms 时，重发全 ping 升级路径的周期 |
| `upgradeUDPRelayInterval` | 1min | magicsock.go:4032 | UDP peer-relay 路径升级周期 |
| `discoverUDPRelayPathsInterval` | 30s | magicsock.go:4036 | relay 路径发现最小间隔 |
| `heartbeatInterval` | **3s** | magicsock.go:4040 | 心跳 disco Ping bestAddr 的周期 |
| `trustUDPAddrDuration` | **6.5s** | magicsock.go:4044 | bestAddr 作为唯一路径（不并发 DERP）的可信时长；心跳 Pong 是它的续期机制 |
| `goodEnoughLatency` | 5ms | magicsock.go:4048 | 延迟 ≤5ms 就不再尝试升级 |
| `endpointsFreshEnoughDuration` | 27s | magicsock.go:4053 | 自端点（STUN 映射）新鲜度；发 CallMeMaybe 前置门槛（NAT 映射典型 30s 过期） |
| `pingTimeoutDuration` | 5s | magicsock.go:4060 + tsconst/ping.go:11 | disco Ping 等待 Pong 超时 |
| `discoPingInterval` | 5s | magicsock.go:4066 + tsconst/ping.go:15 | 同一候选两次 disco Ping 最小间隔（限速）；CallMeMaybe 可重置 |
| `wireguardPingInterval` | 5s | magicsock.go:4071 | wireguard-only 候选延迟探测间隔判定 |
| `indexSentinelDeleted` | -1 | magicsock.go:4076 | netmap 刷新期间候选的"待删"哨兵 |
| `derpWriteQueueDepth` | 32 | derp.go:329 | 每 DERP 连接写队列深度 |
| `derpInactiveCleanupTime` | 60s | derp.go:1072 | 非 home DERP 连接空闲多久后关闭 |
| `derpCleanStaleInterval` | 15s | derp.go:1076 | 空闲 DERP 清理扫描周期 |
| `frameReceiveRecordRate` | 5s | derp.go:41 | DERP 收帧时间记录节流（喂 netcheck 的保活证据） |
| `endpointTrackerLifetime` | 5min10s | endpoint_tracker.go:22 | 自端点缓存广告寿命（略长于一个 netcheck 全量周期） |
| `endpointTrackerMaxPerAddr` | 6 | endpoint_tracker.go:37 | 每 IP 最多缓存的端点数 |
| `discoKeyAdvertisementInterval` | 2min | endpoint.go:46 | TSMP disco key 广告间隔（仅 cache-netmap knob 开启时，magicsock.go:4576-4605，默认关闭） |
| `pongHistoryCount` | 64 | endpoint.go:436 | 每候选 pong 环形历史 |
| UDP 寿命探测 cliffs | 10/30/60s，周期 ≥24h | endpoint.go:269-276 | `probe-udp-lifetime` knob（默认关，C1 §5.2） |

### 1.2 netcheck 层（v1.102.3 `net/netcheck/netcheck.go`）

| 常量 | 值 | 行号 |
|---|---|---|
| `ReportTimeout`（单次报告总预算） | 5s | netcheck.go:60 |
| `stunProbeTimeout`（STUN 阶段超时后降级 HTTPS/ICMP） | 3s | netcheck.go:65 |
| `icmpProbeTimeout` | 1s | netcheck.go:68 |
| `httpsProbeTimeout` | =ReportTimeout | netcheck.go:73 |
| `defaultInitialRetransmitTime`（全量首轮 STUN 重试间隔） | 100ms | netcheck.go:86 |
| `defaultActiveRetransmitTime`（稳态无数据时的重试间隔） | 200ms | netcheck.go:80 |
| `numIncrementalRegions`（增量报告只测最快的 N 个 region） | 3 | netcheck.go:412 |
| `fullReportInterval` | 5min | netcheck.go:1339 |
| `preferredDERPAbsoluteDiff`（home 迁移绝对迟滞） | 10ms | netcheck.go:1347 |
| `PreferredDERPFrameTime`（DERP 帧接收视为 region 存活的窗口） | 8s | netcheck.go:1352 |
| `PreferredDERPKeepAliveTimeout`（=2×derp.KeepAlive） | 120s | netcheck.go:1361 |

### 1.3 WireGuard 会话层（仓内归档 `2026-10-01-phase2/wg-device-constants.go`；wireguard-go `device/timers.go`）

| 常量 | 值 | 行号 |
|---|---|---|
| `RekeyAfterMessages` | 2^60 | wg-device-constants.go:15 |
| `RejectAfterMessages` | 2^64−2^13−1 | wg-device-constants.go:16 |
| `RekeyAfterTime` | 120s | wg-device-constants.go:17 |
| `RekeyAttemptTime` | 90s | wg-device-constants.go:18 |
| `RekeyTimeout`（握手重试） | 5s | wg-device-constants.go:19 |
| `MaxTimerHandshakes` | 90/5=18 | wg-device-constants.go:20 |
| `RekeyTimeoutJitterMaxMs` | 334ms | wg-device-constants.go:21 |
| `RejectAfterTime` | 180s | wg-device-constants.go:22 |
| `KeepaliveTimeout`（被动 keepalive） | 10s | wg-device-constants.go:23 |
| `CookieRefreshTime` | 120s | wg-device-constants.go:24 |
| `HandshakeInitationRate`（握手 DoS 限速） | 1s/50=20ms | wg-device-constants.go:25 |
| persistent keepalive 间隔 | 上游 tailnet 配置**不设置**（C1 笔记 §7-13 已证：nmcfg.go 与现行 config 均无） | — |

---

## 2. magicsock 端点层状态机（per-peer `endpoint`，即本仓未来 PeerConn 的原型）

### 2.1 状态载体（v1.102.3 endpoint.go:63-107）

- `bestAddr addrQuality`（epAddr+latency+wireMTU，endpoint.go:1841-1846）+ `bestAddrAt`（确认时刻）+ `trustBestAddrUntil`（信任到期）——**直连路径的"当前态"**；
- `sentPing map[TxID]{to, at, timer, purpose, resCB}`（endpoint.go:387-394）——在途 disco Ping 表，Pong/超时的配对依据；
- `endpointState map[ip:port]*endpointState`（候选表，§2.2）；
- `isCallMeMaybeEP map[ip:port]bool`（本轮 CMM 广告过的端点，endpoint.go:96）；
- `derpAddr`（= `127.3.3.40:regionID` 假地址，tailcfg.go:3077；endpoint.go:1540）；`expired`/`isWireguardOnly`/`relayCapable`（endpoint.go:104-106）；
- 活动时间戳：`lastRecvWG`/`lastRecvUDPAny`（原子）、`lastSendExt`（外部触发发送，即 wireguard-go/CLI）、`lastSendAny`、`lastFullPing`（endpoint.go:65, 84-88）。

### 2.2 候选地址层：`endpointState` 三种来源与删除规则（endpoint.go:396-467）

字段：`lastPing`（本候选上次出站 ping）、`lastGotPing`/`lastGotPingTxID`（**非零 = 运行时从入站 ping 学习的候选，不在 netmap**）、`callMeMaybeTime`（被 CMM 广告时刻）、`recentPongs`（64 环）、`index`（netmap Endpoints 序号）。删除判定 `shouldDeleteLocked`（endpoint.go:455-467）：

| 候选来源 | 判定字段 | 删除条件 |
|---|---|---|
| CMM 广告 | `callMeMaybeTime != 0` | **永不删** |
| netmap 下发 | `lastGotPing == 0` | `index == indexSentinelDeleted`（本轮 netmap 不再含它） |
| 运行时学习 | `lastGotPing != 0` | 距 `lastGotPing` > `sessionActiveTimeout`(45s) |

运行时候选上限防御：`addCandidateEndpoint` 发现表 >100 条时做一轮清理（endpoint.go:1630-1638）。

### 2.3 发送决策：`addrForSendLocked` 的三分支（endpoint.go:583-600）

```
bestAddr 有效 且 now ≤ trustBestAddrUntil
    → 仅 UDP 直连（唯一路径；DERP 不并发）                    [直连稳态]
isWireguardOnly
    → addrForWireGuardSendLocked：有延迟数据选最低（同延迟 v6 优先，
      endpoint.go:628-636）；无数据随机挑一个、只信 1s（endpoint.go:640-655）；
      多候选且最旧 ping > wireguardPingInterval(5s) → 附加 ICMP 延迟探测
其余（bestAddr 过期/不存在，普通 disco peer）
    → 返回「过期 bestAddr + DERP」两个地址 → 调用方双发           [直连降级稳态]
```

`send()`（wireguard-go 每批出站包经 `Conn.Send` → `endpoint.send`，magicsock.go:1504-1529，endpoint.go:1052-1149）：

1. `expired` → 直接拒绝 `errExpired`（endpoint.go:1053-1057；与 C1 §1.3 过期防御联动）；
2. 非 wireguardOnly 且（无直连或 bestAddr 过期）→ 触发一轮全 ping + relay 发现（endpoint.go:1066-1071）——**出站流量本身就是打洞的触发器**；
3. `noteTxActivityExtTriggerLocked`：`lastSendExt=now`，**若心跳定时器为空则启动 3s 心跳**（endpoint.go:965-970）——心跳是"有外部发送"才启动的；
4. 双发执行：UDP 批发（失败且属"端点已坏"错误 → `noteBadEndpoint`，endpoint.go:1091-1096/1652-1666：清 bestAddr + 该候选状态清零）；DERP 走 `sendAddr`（§3.5）；两者都无地址时，用 `fallbackDERPRegionForPeer`（从**入站 DERP 流量学到的** region 路由）兜底，再无 → `errNoUDPOrDERP`（endpoint.go:1076-1086）。

### 2.4 发现阶段：全 ping + CallMeMaybe（endpoint.go:1365-1403）

`sendDiscoPingsLocked(now, sendCallMeMaybe)`：
- 逐候选：该候选将被删 → 删；距 `st.lastPing` < `discoPingInterval`(5s) → 跳过（endpoint.go:1381-1383）；
- 否则 `startDiscoPingLocked(pingDiscovery)`：登记 `sentPing[txid]` + 启动 5s 超时定时器（endpoint.go:1349-1353），候选 `lastPing=now`（endpoint.go:1310-1320，**心跳 Ping 也走这里、也占限速额度**，见 §10-12）；
- 若发了任意一个且 `sendCallMeMaybe=true` 且有 DERP home → `go enqueueCallMeMaybe(derpAddr, de)`（endpoint.go:1394-1402）。

`enqueueCallMeMaybe`（magicsock.go:2653-2694）：自端点不新鲜（`lastEndpointsTime` 距今 >27s）→ **先 `ReSTUN("refresh-for-peering")`，把自己挂进 `onEndpointRefreshed` 回调，STUN 完成后再发**（magicsock.go:2662-2679）；新鲜则直接经 DERP 发 `CallMeMaybe{MyNumber: 自端点列表}`（magicsock.go:2683-2687）。CMM 的契约：发送方**已经向对端发过 UDP**（防火墙映射已开），接收方"现在可以打回来"（仓内归档 disco.go:199-206 注释；endpoint.go:1943-1946 同义注释）。

### 2.5 disco Ping 超时与 Pong 事件（迁移核心）

- 超时 `discoPingTimeout`（endpoint.go:1187-1202）：从 `sentPing` 删除；**仅当超时的是 bestAddr 且 bestAddr 已过信任期** → `clearBestAddrLocked`（回退 DERP-only）。信任期内超时不动作（等心跳下一拍）。
- Pong `handlePongConnLocked`（endpoint.go:1724-1817，持 Conn.mu 调用）：
  1. `TxID` 不在 `sentPing` → 忽略（**未知 Pong 不产生任何迁移**，endpoint.go:1730-1734）；
  2. `latency = now - sp.at`；仅非 DERP 非 relay 的候选写 `endpointState.recentPongs`（endpoint.go:1750-1767）；
  3. **bestAddr 迁移**（endpoint.go:1785-1814）：非 DERP 源的 pong 构造 `thisPong{sp.to, latency, mtu}`；当 `betterAddr(thisPong, bestAddr)` 或 bestAddr 已过信任期（`bestUntrusted`）→ `setBestAddrLocked(thisPong)`（同端点换 MTU 也算迁移，endpoint.go:1855-1867）；**当 pong 来源 == 当前 bestAddr** → 只刷新 `latency`、`bestAddrAt=now`、`trustBestAddrUntil=now+6.5s`（endpoint.go:1804-1814）——这就是心跳→信任续期的闭环。
- `betterAddr` 打分制（endpoint.go:1855-1941）：直连 > Geneve relay；延迟换算百分点差；环回 +50 / 链路本地 +30 / 私网 +20 / IPv6 +10；**改进 ≤1% 不切换（迟滞防抖，endpoint.go:1928-1938）**。

### 2.6 入站 Ping / Pong / CallMeMaybe 的通道语义（magicsock.go:2201-2644）

`handleDiscoMessage` 总分发（封装解封见 §5）：
- 发端 discokey 不在 peerMap → 计数丢弃（magicsock.go:2229-2237）；解封失败 → 静默（旧 disco key 在途包，magicsock.go:2252-2270）；解析失败 → 静默（新版本类型，magicsock.go:2279-2291）；
- UDP 路径入站先记 `lastRecvUDPAny`（magicsock.go:2240-2246）；WG 数据包路径（UDP/DERP）都汇到 `ep.noteRecvActivity`（UDP: magicsock.go:1912-1914；DERP: derp.go:768；未知对端的 lazyEndpoint 握手消息: magicsock.go:4425-4433）；
- **Ping**（magicsock.go:2547-2644）：5s 内同源重复 ping 判为 heartbeat 静默处理（`likelyHeartBeat`，magicsock.go:2548）；`addCandidateEndpoint` 把源地址登记为候选（已在表→仅刷新 lastGotPing/TxID 去重；新地址→新建 endpointState，magicsock.go:1605-1640）；回 `Pong{TxID, Src: 被观察到的来包地址}`（magicsock.go:2638-2643）——**Pong.Src 就是给对方的 STUN 等价物**（仓内归档 disco.go:250-262 注释）；
- **Pong**：按 discokey 找到该端点集，逐个尝试配对 TxID，第一个认领的胜出（magicsock.go:2317-2335）；
- **CallMeMaybe**：**只允许 DERP 通道**（UDP 来的 CMM 直接丢弃并记日志，magicsock.go:2350-2354）；发端 discokey 必须与 netmap 中该 node 的 DiscoKey 一致（magicsock.go:2383-2395）。`handleCallMeMaybe`（endpoint.go:1947-2027）：忽略 v6 链路本地（endpoint.go:1961-1965）；旧一轮 CMM 端点不在新消息里 → 删除（endpoint.go:1994-2001）；新增候选 `endpointState{callMeMaybeTime}`；**把全部候选 `lastPing` 清零后立即 `sendDiscoPingsLocked(now, false)`**（endpoint.go:2003-2009）——绕过 5s 限速立刻互 ping，`false` 防止 CMM 无限循环。

### 2.7 心跳循环 `heartbeat`（endpoint.go:820-886）

每 3s 一拍（由出站流量启动，§2.3-3）：
1. 停自己 `heartBeatTimer=nil`；`heartbeatDisabled`（silent disco knob）→ 直接返回（endpoint.go:830-833）；
2. `now - lastSendExt > 45s` → **会话空闲，停止心跳**（endpoint.go:841-869）——注意以 `lastSendExt`（外部触发）为准，disco 自身的 ping 不会给自己续命；
3. 有 bestAddr → ping 它（`pingHeartbeat`，不重置 lastFullPing）（endpoint.go:871-875）；
4. `wantFullPingLocked`（endpoint.go:946-963）：无直连 bestAddr ∥ 从未 full ping ∥ bestAddr 过信任期 ∥ （延迟 >5ms 且距上次 full ping ≥1min）→ `sendDiscoPingsLocked(now, true)`（含 CMM）；
5. 重新武装 3s 定时器（endpoint.go:885）。

### 2.8 netmap/增量事件驱动的迁移（C2 与 C1 的接缝）

- 全量 `SetNetworkMap → updateNodes → upsertPeerLocked`（magicsock.go:3022-3297）：
  - **node key 轮换**（同 NodeID 不同 Key）→ 删除旧 endpoint 重建（magicsock.go:3205-3211）； derpRoute/peerLastDerp 同步清理（magicsock.go:3151-3158）；RemovePeer 同（magicsock.go:3354-3388）；
  - 零 DiscoKey 且非 WireGuardOnly → 拒收/删除（magicsock.go:3217-3227, 3261-3265）；
  - 新建 endpoint → `updateFromNode` 装入 discokey/HomeDERP/Endpoints（magicsock.go:3267-3296）；
  - 首批 peers 到达且有私钥 → `ReSTUN("non-zero-peers")`（magicsock.go:3163-3165）。
- `endpoint.updateFromNode`（endpoint.go:1500-1555）：`expired=n.Expired()`（endpoint.go:1513）；**DiscoKey 变化只 `updateDiscoKey`，不重置 bestAddr/候选**（endpoint.go:1521-1529，debug 标记名叫 resetLocked 但并不 reset——旧 disco key 的在途包解封失败被静默，见 §10-8）；`HomeDERP==0` → 清 derpAddr，否则 `127.3.3.40:regionID`（endpoint.go:1530-1550）；`setEndpointsLocked` 全量重建候选表（endpoint.go:1557-1596：先全部标 indexSentinelDeleted → 回填/新建 → 删掉不在 netmap 又非运行时候选）。
- 增量 `UpdateNetmapDelta` 只处理两类 mutation：`NodeMutationDERPHome → setDERPHome`、`NodeMutationEndpoints → setEndpointsLocked`（magicsock.go:3933-3956）——与 C1 §4 的 PeerChange 字段表吻合。
- `SetPrivateKey`（magicsock.go:2758-2802）：首次设钥 → ReSTUN；清零 → 关全部 DERP + 停 periodic ReSTUN + 全 endpoint `stopAndReset`；换钥 → 关全部 DERP 重连 home（旧 discoInfo/sharedKey 全部作废）。

### 2.9 peerMap：入包反查表（peermap.go:14-110）

`byEpAddr map[epAddr]*peerInfo`（UDP 源地址 → endpoint）+ `nodesOfDisco map[DiscoKey]Set[NodeKey]`（discokey 1:N）。`upsertEndpoint` 时把 endpoint 的**全部候选**注册进 byEpAddr（peermap.go:169）。UDP 收包按 `endpointForEpAddr` 反查（magicsock.go:1896-1914）；disco 收包按 `knownPeerDiscoKey` 收敛身份（magicsock.go:2229）。Ping 的 nodekey 消歧三级：DERP 层 nodekey → Ping 内嵌 NodeKey → 唯一匹配（magicsock.go:2514-2543）。

---

## 3. DERP 路由与连接状态机（v1.102.3 `wgengine/magicsock/derp.go`）

### 3.1 两个核心表

- `activeDerp map[regionID]{client, cancel, writeCh, lastWrite, createTime}`（derp.go:91-101）——本端到各 region 的**连接表**；
- `derpRoute map[NodeKey]{regionID, client}`（derp.go:47-50）——**per-peer 的"对端最近出现在哪个 region"学习表**。写入点：DERP 读循环见到新 peer → `addDerpPeerRoute`（derp.go:622-628）；本端向其写 → `setPeerLastDerpLocked`（derp.go:484-510，并区分 "shared home/their home/our home/alt"）。删除点：`PeerGone` 帧（NotHere/unknown reason）、连接断开（全清）、node key 轮换、RemovePeer。`fallbackDERPRegionForPeer` 消费它（derp.go:71-89；endpoint.go:1076-1086）。

### 3.2 连接建立与选择（derp.go:339-475）

`derpWriteChanForRegion(regionID, peer)`：网络断/无 derpMap/无私钥 → nil；已有该 region 连接 → 复用；无则查 `derpRoute[peer]`（对端曾从那个 region 来，直接用那个连接，Issue 150 语义，derp.go:368-382）；都没有 → 新建 `derphttp.NewRegionClient`，设 `NotePreferred(myDerp==regionID)`、`SetCanAckPings(true)`，启动 reader/writer 两条 goroutine（derp.go:399-464）。

### 3.3 home DERP 迁移（derp.go:159-296）

`maybeSetNearestDERP(report)`：**控制面长轮询不在线且已有 home → 不迁移**（无法通知 peers，derp.go:177-195）；`report.PreferredDERP==0`（UDP 全断）→ `pickDERPFallback` 随机 region（derp.go:114-148）；选定后 `setNearestDERP`：变化 → 对所有 activeDerp 发 `NotePreferred` + `goDerpConnect(newHome)`，并发布 `HomeDERPChanged{Old,New}` 事件给 ipnlocal 回写 netmap 缓存（derp.go:203-296）。netcheck 侧的迟滞见 §4.4。

### 3.4 读循环事件（derp.go:533-672）

`ServerInfo` → 置 region connected；`ReceivedPacket` → 新 sender 登记路由 + 投递给 bind（disco 形态的进 `handleDiscoMessage(derpRXPathDERP)`，derp.go:746-751；WG 形态反查 endpoint 后 `noteRecvActivity`，derp.go:758-775）；`PingMessage` → 自动回 Pong（derp.go:640-648）；`HealthMessage` → region 健康；`PeerGone` → 删路由（derp.go:652-666）；**读错误 → `ReSTUN("derp-recv-error")` + 退避重连（初始 5s backoff）**，并清空该连接上的全部 peer 路由（derp.go:563-598）。

### 3.5 发送与回收

- `sendAddr`（magicsock.go:1672-1712）：目的 IP == `127.3.3.40` → 按 region 写队列投递（深 32；3 次尝试入队失败即**丢包不阻塞**，magicsock.go:1692-1711）；否则 UDP。
- DERP Map 更新 `setDERPMap`（derp.go:813-876）：region 定义变化 → 关旧连接、若动到 home 则 home 清零 → `ReSTUN("derp-map-update")`。
- 空闲回收 `cleanStaleDerp`（derp.go:989-1033）：非 home 且 `lastWrite` >60s → 关闭；15s 周期扫描，仅在仍有非 home 连接时续期。
- 服务端侧参照：DERP 服务器每 `derp.KeepAlive(60s)+rand(5s)` 发 KeepAlive 帧（归档 ts-main/derpserver.go:2636；帧常量 ts-main/derp-frames.go:44）——客户端 idle 时靠它保持 TCP 与 NAT。

---

## 4. netcheck/STUN 与自端点枚举（喂给整个状态机的输入）

### 4.1 调度（magicsock.go）

- 触发：`ReSTUN(why)` 单飞（`endpointsUpdateActive`，magicsock.go:3664-3697）；周期定时器在每次 `updateEndpoints` 收尾时以 **20–26s 随机间隔**重排（magicsock.go:907-923）；
- 门控 `shouldDoPeriodicReSTUNLocked`（magicsock.go:3633-3656）：无 peers/无私钥/homeless/网络断 → 不做；**TUN idle >45s（`IdleFunc = tundev.IdleDuration`，userspace.go:429）→ 停**，除非 knob `debug-always-stun`（ForceBackgroundSTUN）；
- 其余触发源：DERP 读错误（derp.go:588）、DERP map 更新、Rebind 后（magicsock.go:3840-3859）、SetPrivateKey 首次、首批 peers、静态端点变更、CallMeMaybe 前置刷新（§2.4）。

### 4.2 端点枚举 `determineEndpoints`（magicsock.go:1292-1447）

顺序即优先级（STUN 派生最前，注释 magicsock.go:1433-1445）：端口映射 → netcheck 报告全局地址（`Report.GetGlobalAddrs`：最优延迟地址 + **出现次数 >1** 的其他映射，netcheck.go:136-167）→ 硬 NAT 固定端口补 `STUN4LocalPort` 候选（magicsock.go:1351-1360）→ 云公网 IP → **endpointTracker 缓存合并**（防端点抖动：上次报过且未过 5min10s 的继续报，endpoint_tracker.go:117-165）→ 静态端点 → 本机接口地址。`setEndpoints`：无 STUN 项且无 DERP map → 暂不上报（magicsock.go:972-984）；集合变化才 `epFunc(endpoints)` 上报控制面（MapRequest.Endpoints，C1 §1.1）并触发全部 `onEndpointRefreshed` 挂起回调（magicsock.go:987-990）。

### 4.3 `GetReport` 探测状态机（netcheck.go:799-1024）

1. 总预算 `ReportTimeout=5s`；并发保护 `curState`（netcheck.go:828-832）；
2. 全量 vs 增量：`nextFull ∥ 距上次全量 >5min ∥ 上次"无 UDP 且 captive portal"` → 全量（last=nil）；netcheck.go:854-870；
3. 探测计划 `makeProbePlan`：全量 = 每 region 3 重试、间隔 100ms（netcheck.go:530-558）；增量 = 延迟排序的前 `numIncrementalRegions(3)` + **home region 强制入计划且重试 4 次**（防 home 抖动，netcheck.go:437-495），重试间隔 = 上次 RTT×120% 或 200ms（netcheck.go:506-508）；
4. 等待：`stunProbeTimeout=3s` 超时 ∥ 全部完成 ∥ "saw enough regions"（netcheck.go:937-955）；
5. STUN 全失败 → 降级 HTTPS 延迟 + ICMP（UDP 被封假设，netcheck.go:963-1018）——对应 oracle 实测"region 999 测不出延迟仍可通信"（protocol-notes.md:206-208）。

### 4.4 PreferredDERP 迟滞（netcheck.go:1386-1491）

报告历史窗口 = 全量周期+5s（netcheck.go:1376）；选 region 取窗口内最优延迟 × regionScore；**迁移抑制**：旧 region 仍可达（有延迟 或 8s 内收到 DERP 帧）且（绝对差 <10ms 或 新最优 > 旧×2/3）→ 不迁移；强制 knob `ForcePreferredDERP`；完全无数据但 120s（2×KeepAlive）内有 keepalive 证据 → 保旧（netcheck.go:1440-1490）。

---

## 5. disco 报文字节级格式（通道约束 + 与本仓实现对照）

- **wrapper**（仓内归档 disco.go:35, 118-119；`packages/disco/src/wrapper.ts` 已对齐）：`"TS💬"`(6B, `54 53 f0 9f 92 ac`) ‖ 发端 disco 公钥(32B) ‖ nonce(24B) ‖ secretbox(内层报文)。共享密钥 = X25519(discokey 对)（key-disco.go）。入站形态判定：magicsock.go:2131-2179 `packetLooksLike`（STUN/Disco/WireGuard/Geneve 四分）。
- **内层**：`type u8 ‖ version u8(=0) ‖ payload`（MessageHeaderLen=2，归档 disco.go:118-119）。
  - Ping（type 0x01）：`TxID 12B ‖ NodeKey 32B（仅当非零，1.16+ 才带）‖ Padding×0B`（归档 disco.go:134-152；PingLen=44）——Padding 用于路径 MTU 探测（MaxDiscoPingSize = MaxPacketSize−28，endpoint.go:974）；
  - Pong（type 0x02）：`TxID 12B ‖ Src IP 16B(v4-mapped) ‖ Port u16be`（30B，归档 disco.go:250-262）；
  - CallMeMaybe（type 0x03）：`N × (IP 16B ‖ Port u16be)`（每条 18B，归档 disco.go:199-244）；
  - 0x04–0x09 UDP relay 家族：属子线 B1（`packages/disco/src/messages.ts:21-24` 已如实标注未实现）。
- **通道约束**（状态机强依赖）：CMM 只许走 DERP（magicsock.go:2350-2354）；Ping/Pong 可走 UDP 或 DERP（DERP 通道的 src = `127.3.3.40:regionID` 假地址 + DERP 层 nodekey，magicsock.go:2181-2194）；Pong 必须回 `Pong.Src = 对方眼中的我`（发 Ping 一方借此学自端点，无需等 netcheck）。
- 本仓解码层 `packages/disco/src/messages.ts`（Ping/Pong/CMM + 宽松解析语义）已与上述格式一致，可直接作状态机的事件源；缺的是**密封层的 NodeKey 消歧与 sentPing 配对逻辑**（上游 magicsock.go:2514-2543 + endpoint.go:1724-1734），需在状态机层补。

---

## 6. WireGuard 会话层计时器状态机（wireguard-go `device/timers.go`；每个 peer 五个定时器）

`timersInit`（timers.go:209-215）：`retransmitHandshake` / `sendKeepalive` / `newHandshake` / `zeroKeyMaterial` / `persistentKeepalive`。

| 事件（触发点 timers.go） | 动作 |
|---|---|
| 发出认证数据包 `timersDataSent`（146-150） | `newHandshake.Mod(10s+5s+jitter0..334ms)` ——≈15s 内对端无任何认证包则重握手 |
| 收到认证数据包 `timersDataReceived`（153-161） | `sendKeepalive.Mod(10s)`（已挂则置 `needAnotherKeepalive`） |
| 发出任意认证包 `timersAnyAuthenticatedPacketSent`（164-168） | `sendKeepalive.Del()` |
| 收到任意认证包 `timersAnyAuthenticatedPacketReceived`（171-175） | `newHandshake.Del()` |
| 发出握手 initiation `timersHandshakeInitiated`（178-182） | `retransmitHandshake.Mod(5s+jitter)` |
| 握手完成 `timersHandshakeComplete`（185-192） | `retransmitHandshake.Del`、attempts=0、lastHandshakeNano=now |
| 派生新会话 `timersSessionDerived`（195-199） | `zeroKeyMaterial.Mod(180s×3=540s)` |
| 任意包收发 `timersAnyAuthenticatedPacketTraversal`（202-207） | persistentKeepalive>0 才续期（上游不配置） |

超时回调：

- `expiredRetransmitHandshake`（79-111）：attempts>18 → 放弃（清 staged 包、540s 后清钥）；否则 attempts++、**`endpoint.ClearSrc()`（在 magicsock 的 endpoint 上是 no-op，endpoint.go:567）**、重发 initiation；
- `expiredSendKeepalive`（113-121）：发 keepalive（空传输包）；`needAnotherKeepalive` → 再挂 10s；
- `expiredNewHandshake`（123-132）：15s 无回音 → 重新 initiation；
- 主动重钥（发送侧）`keepKeyFreshSending`（send.go:200-209）：`nonce>2^60 ∥ (isInitiator && session>120s)` → initiation；**responder 不主动重钥**；
- 主动重钥（接收侧）`keepKeyFreshReceiving`（receive.go:57-66）：`isInitiator && since(created) > 180−10−5=165s` → 一次性 initiation（`sentLastMinuteHandshake` 位）；
- 硬失效：transport 包时间戳 >180s 直接丢（receive.go:165）；`SendHandshakeInitiation` 5s 节流（send.go:104-117）；`Peer.Start` 把 `lastSentHandshake` 回拨 6s 使首个包必触发握手（peer.go:185）。

**与 disco 层的耦合**：wireguard-go 的每次 Send 都打在 `endpoint.send()` 上（magicsock.go:1504-1529）——WG keepalive（10s 被动/握手重试）既刷新 `lastSendExt`（保住 disco 心跳与 45s 活动线），又是"bestAddr 过期→双发→Pong→bestAddr 迁移"这条链路的驱动源。

---

## 7. 事件 → 状态迁移总表（本节为 §2–§6 的浓缩，供实现直接对照）

| # | 事件（来源） | 证据 | 迁移 |
|---|---|---|---|
| 1 | netmap 全量/新 peer | magicsock.go:3196-3297, endpoint.go:1500-1555 | 建 endpoint；装入候选+DERP home；首批 peers → ReSTUN |
| 2 | netmap patch：Endpoints | magicsock.go:3946-3949 | 候选表重建（新者建、缺者删——运行时/CMM 候选豁免） |
| 3 | netmap patch：HomeDERP | magicsock.go:3944-3945, endpoint.go:2107-2114 | derpAddr 假地址改写；（有 peer relay 时额外通知 relayManager） |
| 4 | WG 出站包（任意原因） | endpoint.go:1052-1149 | 启动 3s 心跳（若未跑）；bestAddr 失效→全 ping+CMM；双发；lastSendExt 续期 |
| 5 | disco Ping（UDP/DERP） | magicsock.go:2547-2644 | 源登记/刷新为候选；回 Pong（Src=观察地址） |
| 6 | disco Pong（配对成功） | endpoint.go:1724-1814 | 更新候选延迟；betterAddr∥bestUntrusted → setBestAddr；同址→信任续期 6.5s |
| 7 | disco Ping 超时 | endpoint.go:1187-1202 | 超时候选出 sentPing；bestAddr 已失信任 → 清 bestAddr（退 DERP-only） |
| 8 | CallMeMaybe（必经 DERP） | magicsock.go:2350-2422, endpoint.go:1947-2027 | CMM 端点入候选（免删）；旧 CMM 端点删除；lastPing 清零→立即互 ping |
| 9 | STUN/self-endpoint 更新（ReSTUN 完成） | magicsock.go:895-997 | 集合变化→上报控制面；释放 onEndpointRefreshed → 挂起的 CMM 发出 |
| 10 | netcheck 报告（含 PreferredDERP） | magicsock.go:1033-1088, derp.go:159-296 | NetInfo 上报；home 迁移→NotePreferred+连 home+HomeDERPChanged 事件 |
| 11 | DERP 收到 peer 数据 | derp.go:613-628, 758-775 | derpRoute 学习；endpoint.noteRecvActivity（wireguardOnly→bestAddr=src 信 5s） |
| 12 | DERP PeerGone / 连接断 | derp.go:563-598, 652-666 | 删该连接全部 peer 路由；读错误→ReSTUN+退避重连 |
| 13 | DERP 写队列满/连接缺失 | magicsock.go:1672-1711 | 丢包（不迁移、不阻塞） |
| 14 | 心跳 tick（3s） | endpoint.go:820-886 | ping bestAddr；wantFullPing→全 ping；idle>45s→停心跳 |
| 15 | UDP 发送报"端点已坏"错误 | endpoint.go:1091-1096, 1652-1666 | 清 bestAddr+该候选状态 → 下次发送重评估 |
| 16 | WG 握手完成 / 会话派生 | timers.go:185-199 | retransmit 停、540s 清钥定时挂起（与 disco 无直接联动） |
| 17 | WG 15s 无认证回包 / 5s 握手重试超 18 次 | timers.go:79-132 | 重新 initiation；放弃后 flush staged（WG 层静默，等外层新流量再触发） |
| 18 | 会话空闲 45s（lastSendExt） | endpoint.go:841-869, magicsock.go:3633-3656 | 停 disco 心跳 + 停 periodic ReSTUN（省电锚点） |
| 19 | SetPrivateKey 变化/清零 | magicsock.go:2758-2802 | 关全部 DERP（重连 home）/ 全 endpoint stopAndReset |
| 20 | Rebind（网络切换） | magicsock.go:3840-3870 | 本地地址不匹配的 DERP 关闭、其余 Ping 探活（3s）；全部 endpoint `noteConnectivityChange`（清 bestAddr+候选派生态） |

---

## 8. 实现态建模建议（ArkTS 形态，R5/A18 常量对象模式）

按上游复合结构，建议本仓状态机拆四个纯 TS 类（全部 Clock/Rng/Scheduler 注入）：

1. `PeerEndpointState`（对应 endpointState）：`lastPingMs/lastGotPingMs/callMeMaybeMs/recentPongs 环/index`；`shouldDelete(now)` 三分支照 §2.2。
2. `PeerEndpoint`（对应 endpoint）：`bestAddr/bestAddrAt/trustBestAddrUntil/sentPing Map/endpointState Map/derpAddr(假地址编码)/expired/isWireguardOnly`；公开 `send()/heartbeat()/handlePong()/handlePing()/handleCallMeMaybe()/updateFromNode()/noteRecvActivity()/addrForSend()`。
3. `DerpRouteTable`（对应 activeDerp+derpRoute）：`regionById 连接复用 + per-peer 学习路由 + 60s 空闲回收`。
4. `SelfEndpointTracker`（对应 endpointTracker + periodic ReSTUN 调度）：20–26s 随机重排（Rng 注入）、45s idle 门控、5min10s 端点缓存。

事件源抽象：定时器上游是 `time.AfterFunc`——本仓 P4 只冻结了 Clock/Rng，**需要在本包定义 `TimeoutScheduler`（`after(ms, id)/cancel(id)`）注入接口**（放包内不进 common，符合 architecture.md §10.1 冻结规则），app/bridge 先给确定性实现（与 FixedClock 联动推进）。

---

## 9. 与本仓现有实现的衔接点

| # | 衔接点 | 现状（文件:行） | C2 实现要做的 |
|---|---|---|---|
| 1 | disco 报文编解码 | `packages/disco/src/messages.ts:55-59`（类型表）、`wrapper.ts`（密封） | 只消费不改动；0x04-0x09 维持 B1 边界 |
| 2 | sentPing/TxID 生成 | 上游 `stun.NewTxID()`（endpoint.go:1348）＝随机 12B | `ShellDiscoClient.sendPing` 已用 Rng 生成 txid（app/bridge/src/shell-discovery.ts:104-111），状态机需把它升级为带 `to/at/timer/purpose` 的 sentPing 表 |
| 3 | Pong 配对与 bestAddr | 尚无（bridge 只做事件归类 shell-discovery.ts:123-172） | 新状态机实现 §2.5（含 betterAddr 打分、1% 迟滞、6.5s 信任） |
| 4 | 心跳/超时驱动 | 尚无（`FixedClock.advanceMs` 测试形态已验证时钟注入可行） | 按本包新 `TimeoutScheduler` 接口；单测用 FixedClock 手动推拍（§8） |
| 5 | WG 会话层计时器 | `packages/wireguard/src/peers.ts:108-138`（installSession 重钥装订）、`dispatch.ts`（type=1/2/3/4 分发）、transport.ts（反重放） | 补 `WgPeerTimers` 纯逻辑类（五定时器状态 + §6 表），事件挂点：encryptPacket（DataSent）、decryptPacket 成功（DataReceived）、握手 finish（HandshakeComplete）；keepalive=零长度明文已有（peers.ts 头注 §5.1 架构） |
| 6 | DERP 连接状态机 | `packages/derp/src/client.ts:34-46` 已有 Idle/Connecting/Ready/Closed 四态 + Ping/Pong/PeerGone 事件 | 状态机层（home 迁移/路由学习/60s 回收）建在其上；`region.ts` DerpRegionPicker 提供候选 |
| 7 | netcheck/STUN | `packages/netcheck/src/probe.ts:25-68`（单事务配对+RTT） | 引擎层（probePlan/增量-全量/降级 HTTPS）属 B2 兄弟件；C2 只消费 Report 形状 |
| 8 | 控制面事件 | `app/bridge/src/shell-session.ts:140-160`（MapResponse→Online） | C1 的 tailcfg 解码层（PeersChangedPatch 的 Endpoints/HomeDERP/Key/DiscoKey）是 C2 的输入；衔接点同 C1 §6 表 |
| 9 | 状态快照 | oracle status 的 `CurAddr/Relay/Active/InMagicSock`（protocol-notes.md:95-110） | 上游 `populatePeerStatus`（endpoint.go:2029-2050）给出精确口径：`Active = lastSendExt 距今 <45s`；`CurAddr` = bestAddr 直连时才填；`Relay` = derpAddr.regionID → RegionCode |

---

## 10. 实现陷阱清单（按危害排序）

1. **心跳是"外部发送触发"而非常开**：`noteTxActivityExtTriggerLocked`（endpoint.go:965-970）只在 wireguard-go/CLI 发包时启动 3s 心跳；idle 45s 停（endpoint.go:841-869）。若做成全局定时器会永久维持 NAT 映射并耗电——语义完全错。
2. **`trustBestAddrUntil`(6.5s) 与 `heartbeatInterval`(3s) 必须成对**：心跳 Pong 就是信任续期机制（endpoint.go:1804-1814）；只抄其一会导致在"仅直连"与"双发"之间振荡。
3. **双发不是二选一**：bestAddr 过期时 UDP+DERP 同时发（endpoint.go:597-599）；仅直连稳态才不并发 DERP（endpoint.go:586-588）。
4. **CMM 防循环**：handleCallMeMaybe 里重 ping 时 `sendDiscoPingsLocked(now, false)`（endpoint.go:2008-2009）——第二参数 false 表示不再回 CMM；漏掉会两个 peer 互发 CMM 死循环。CMM 只许 DERP 通道（magicsock.go:2350-2354）。
5. **Pong 只信已知 TxID**：`sentPing` 表是唯一事实源（endpoint.go:1730-1734）；收到未发送过的 TxID 绝不能迁移 bestAddr（防伪造/重放）。
6. **`127.3.3.40:regionID` 假地址贯穿三层**（tailcfg.go:3072-3079；endpoint.go:1540；derp.go:746）：isDirect() 判定=有效且非该 IP 且无 vni（endpoint.go:1828-1830）；任何把它当真实 UDP 地址发送的实现都是错的。
7. **候选删除三分支**（endpoint.go:455-467）：netmap 候选按 index 哨兵、运行时候选按 45s、CMM 候选永不删；离线 peer（oracle harmony-vm，protocol-notes.md:114-124）正是靠"netmap 保留+DERP 兜底"维持可达性。
8. **disco key 轮换 ≠ node key 轮换**：前者只 updateDiscoKey（endpoint.go:1521-1529，bestAddr/候选不重置，旧 key 在途包解封失败静默丢弃 magicsock.go:2252-2270）；后者删 endpoint 重建（magicsock.go:3205-3211）。混淆会造成"换 discokey 丢会话"。
9. **WG 重钥的三个时间点都要 isInitiator 判定**：120s（发送侧主动）、165s（接收侧"最后一分钟"）、180s（硬失效）；responder 永不主动 initiation（send.go:206, receive.go:62）。两侧同时主动会造成握手风暴。
10. **WG `endpoint.ClearSrc()` 在 magicsock 上是 no-op**（endpoint.go:567）：握手重试的"清源地址"语义由上层 Rebind/noteConnectivityChange 承担，不要寻找一个不存在的"源地址"字段。
11. **DERP 写失败丢包不迁移**：写队列 3 次尝试后丢弃（magicsock.go:1692-1711）；只有 UDP 发送且命中"端点已坏"类错误才 `noteBadEndpoint` 清 bestAddr（endpoint.go:1091-1096）。两条失败路径的处理不同。
12. **心跳 ping 会占候选的 5s ping 限速额度**：`startDiscoPingLocked` 对所有非 CLI 直连 ping 都写 `st.lastPing=now`（endpoint.go:1310-1320），因此 full ping 循环会在 bestAddr 刚被心跳 ping 过 5s 内跳过它（endpoint.go:1381-1383）——这是刻意的防风暴，不要"修复"它。
13. **45s 是三处共用的活动线**：心跳停止（endpoint.go:841）、status Active（endpoint.go:2041）、periodic ReSTUN 停（magicsock.go:3647）——实现用同一个常量，否则 status 与实际行为漂移。
14. **CMM 前置 STUN 新鲜度 27s**：端点不新鲜先 ReSTUN 并挂起 CMM 到 `onEndpointRefreshed`（magicsock.go:2662-2679）——发 CMM 前 NAT 映射必须刚刷新过，否则对方拿到的是死端口。
15. **home DERP 迁移的门控**：控制面不在线不迁（derp.go:177-195）；netcheck 10ms/2/3 迟滞（netcheck.go:1440-1467）；UDP 全断才随机 fallback（derp.go:114-148，需 Rng 注入）。
16. ** derpRoute 是学习来的**：只来自入站 DERP 流量与发送路径（derp.go:622-628, 484-510）；`fallbackDERPRegionForPeer` 只在"无候选且无 home"时兜底（endpoint.go:1076-1086）。不要在 netmap 处理时凭空造路由。
17. **单调钟 vs 挂钟分工**：bestAddr 信任/lastPing/延迟全部单调钟；`lastGotPing/callMeMaybeTime` 用挂钟（endpoint.go:409, 419）——对应本仓 `Clock.monotonicMs()/wallMs()`，超时判定一律 mono，落日志/展示用 wall。
18. **随机源注入点**：候选随机挑选（endpoint.go:646）、随机 fallback DERP（derp.go:147）、ReSTUN 20-26s 抖动（magicsock.go:912）、WG 重试 jitter 0-334ms（timers.go:148,180）——本仓全部经 Rng（P4）；测试用 ArrayRng 固定序列。
19. **定时器即状态**：上游大量状态藏在 timer 的"是否在跑"（`heartBeatTimer nil=空闲`、sentPing.timer、derpCleanupTimerArmed）。TS 侧用 `TimeoutScheduler`（§8）后，所有"清定时器"路径必须显式建模，否则测试里 FixedClock 推拍会出现幽灵回调。
20. **expired peer 的双向防御**：endpoint.send 直接拒（endpoint.go:1053-1057）+ C1 的 badOldPrefix 键破坏（C1 §1.3）——状态机不要试图给 expired peer 打洞，先在推导层剔除。
21. ** ArkTS 常量表**：全部 §1 常量按 R5 常量对象模式集中一个模块（如 `packages/control/src/statemachine-consts.ts` 或状态机所属新模块），禁止散落魔法数；枚举类状态用"常量对象 + parseXxx 校验"（架构 R5）。

---

## 11. 未决 / 未验证项（不猜，如实记录）

- **UDP peer-relay / relayManager**（magicsock relaymanager.go，40KB）与 disco 0x04-0x09（CallMeMaybeVia/BindUDPRelayEndpoint/Allocate*）：属子线 B1 范围。C2 状态机只在两处留接口点：`betterAddr` 的 vni 分支（endpoint.go:1877-1882）与 `wantUDPRelayPathDiscoveryLocked`（endpoint.go:905-940）；本仓 `epAddr` 建模可先不带 vni 字段（保持 addrQuality 直连+DERP 两态）。
- **silent disco / probe-udp-lifetime**（endpoint.go:98-102 注释标注 WIP，issue #540）：knob 默认关（C1 §5.2 表）；一期不实现，但 `heartbeatDisabled` 字段与 `noteRecvActivity` 的对应分支（endpoint.go:533-541）建议保留为恒 false 的占位。
- **wireguard-go 版本漂移**：tailscale fork master 的 timers.go/send.go/receive.go 与 v1.102.3 go.mod 所钉 commit 可能有细微差异；常量数值以仓内归档 wg-device-constants.go 为准（2026-10-01 实拉自 master，README 有来源表）。本轮未逐一比对 go.mod。
- **v1.102.3 归档**：本笔记引用的 tag 文件按只读纪律未写入 `docs/upstream/`；建议 S-执行开工时优先归档 `wgengine/magicsock/endpoint.go`、`magicsock.go`（节选状态机段）、`derp.go`、`net/netcheck/netcheck.go`（节选 GetReport/makeProbePlan）、`tsconst/ping.go`，行号复核以归档为准（与 C1 §8 同一建议）。
- **ipn BackendState 顶层状态机**（NoState/NeedsLogin/NeedsMachineAuth/Stopped/Starting/Running，oracle §2.1/§8-12）：不属"peer 连接"粒度，本笔记不展开；它由 LocalBackend 驱动、与 peer 状态机仅通过 `SetPrivateKey(zero)`（=Stopped）和 netmap 下发（=Running 的输入）耦合（magicsock.go:2758-2802 已覆盖耦合点）。
- **`isBadEndpointErr` 的定义文件**：调用点语义明确（endpoint.go:1091-1096 → noteBadEndpoint），但该函数定义所在 magicsock 包文件（非 endpoint.go/magicsock.go/derp.go/peermap.go，疑在 peermtu.go 等）本轮未拉到，"哪些 errno 触发清 bestAddr"的精确清单未实读——实现时按 EHOSTUNREACH/ECONNREFUSED/ENETUNREACH 类保守子集并在测试注明依据缺口。
