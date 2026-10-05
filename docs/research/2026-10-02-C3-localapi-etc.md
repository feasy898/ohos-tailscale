# C3 研究笔记：LocalAPI/IPC 接口面 + PeerAPI + MagicDNS 核心语义 + 数据面 TUN 接线（为纯 TS mock 做准备）

- 日期：2026-10-02；子线 C（TASK.md §2.3「LocalAPI/IPC、PeerAPI、MagicDNS、TUN fd 接线形态」）前置上游实读。
- 作者角色：协议研究员（S-研究）。本笔记只读取证，不写任何代码；每条结论给上游文件+行号。
- 版本锚定（两份对照）：
  1. **上游 tag `v1.102.3` 实拉**（oracle 是同版本 fork，`docs/oracle/protocol-notes.md:14`；方法同 C1 笔记第 7 行的先例）。本次会话用
     `curl https://raw.githubusercontent.com/tailscale/tailscale/v1.102.3/<path>`（个别文件经 `https://cdn.jsdelivr.net/gh/tailscale/tailscale@v1.102.3/<path>` 兜底）实拉到
     仓外临时目录逐行实读，**未入仓**（遵守本轮只读纪律）；行号均指 v1.102.3 下载副本。已实读文件清单：
     `ipn/localapi/localapi.go`(1958 行)、`ipn/ipnserver/server.go`(578)、`ipn/backend.go`(663)、`ipn/prefs.go`(1190)、`ipn/ipnstate/ipnstate.go`(841)、
     `ipn/ipnlocal/local.go`(9208)、`ipn/ipnlocal/node_backend.go`(1650)、`ipn/ipnlocal/peerapi.go`(1073)、`util/dnsname/dnsname.go`(278)、
     `net/dns/config.go`(221)、`net/dns/manager.go`(701)、`net/dns/resolver/tsdns.go`(1597)、`net/dns/resolver/forwarder.go`(1480，定点)、
     `wgengine/userspace.go`(1575)、`net/tstun/wrap.go`(1536)、`net/tstun/tun.go`(147)、`net/tstun/fake.go`(58)、`wgengine/mem_ios.go`(20)、
     `safesocket/safesocket.go`(127)、`safesocket/unixsocket.go`(91)、`safesocket/pipe_windows.go`(201)、`tsd/tsd.go`(258)、
     `client/tailscale/apitype/apitype.go`(123)、`paths/paths.go`(节选)、`net/tsaddr/tsaddr.go`(节选)、`cmd/tailscaled/tailscaled.go`(节选)。
     wireguard-go 侧：`github.com/tailscale/wireguard-go@2e01ba5b00f0` 的 `tun/tun.go`(76) 与 `device/{constants,noise-protocol,queueconstants_default}.go`（节选）
     —— 该 fork 正是 v1.102.3 `go.mod:116` 锁定的依赖（`github.com/tailscale/wireguard-go v0.0.0-20260715223240-2e01ba5b00f0`）。
     > 复核方式：按同 URL 复拉即可逐行核对；如需离线引用，建议 S-执行按 TASK.md B-1 惯例把上述文件归档到 `docs/upstream/`。
  2. **仓内归档**：`docs/upstream/ts-main/tailcfg.go`（main 快照，capver=148，用于 DNSConfig/Service 字段行号）与
     `docs/upstream/2026-10-01-phase2/wg-device-constants.go`（wireguard-go master constants）。
- 一个重要的考古结论（防走错文件）：**v1.102.3 已不存在 `ipn/peerapi` 包**（GitHub contents API 对
  `ipn/peerapi?ref=v1.102.3` 返回 Not Found），PeerAPI 服务器实现已整体并入 `ipn/ipnlocal/peerapi.go`；
  同理 `wgengine/tstun` 已迁至 `net/tstun`（`wgengine` 目录清单无 tstun，userspace.go:40 import `tailscale.com/net/tstun`）。
  旧教程/记忆中的 `ipn/peerapi/peerapi.go`、`wgengine/tstun/wrapper.go` 在该版本会 404。

---

## 1. LocalAPI / IPC 接口面

### 1.1 传输形态与安全模型（HTTP over 本地字节流）

- **协议形态 = 普通 HTTP/1.1 + JSON**，承载在 unix socket（非 Windows）或命名管道（Windows）上：
  `safesocket.Listen(path)` 按 OS 分派（safesocket.go:86-90 → unixsocket.go:24-71 / pipe_windows.go:33-46）；
  tailscaled 主程序在 `cmd/tailscaled/tailscaled.go:555` 调 `safesocket.Listen(args.socketpath)`，随后
  `ipnserver.Server.Run(ctx, ln)` 用标准 `http.Server` 服务它（server.go:503-548，Handler=serveHTTP，server.go:533-540）。
- **默认 socket 路径**（paths/paths.go:24-49）：Windows `\\.\pipe\ProtectedPrefix\Administrators\Tailscale\tailscaled`（:26）、
  macOS `/var/run/tailscaled.socket`（:29）、Linux 通用 `/var/run/tailscale/tailscaled.sock`（:46-48，另有 Synology/Gokrazy/QNAP 特例）。
  Windows 管道 SDDL = `O:BAG:BAD:PAI(A;OICI;GWGR;;;BU)(A;OICI;GWGR;;;SY)`（pipe_windows.go:31）——所有用户+SYSTEM 可读写；
  unix socket 权限：有 peer-creds 的 OS（linux/darwin/freebsd/solaris/illumos，safesocket.go:121-127）chmod 0666，否则 0600（unixsocket.go:83-91）。
- **客户端 Host 头是约定值 `local-tailscaled.sock`**（apitype.go:13-14 `LocalAPIHost` 常量）；服务端 `validHost`
  只接受空、该常量、以及 RequiredPassword 非空时的 localhost/loopback（localapi.go:285-306）。任何 Referer/Origin 头 → 403（localapi.go:249-252）。
- **鉴权/权限模型**：连接身份 → `ipnauth.Actor`；`actor.Permissions(operatorUID)`（server.go:336-355）：
  Windows 恒 read=write=true（:337-347）；unix socket read=true、write=`!IsReadonlyConn(operatorUID)`（:351-353）——
  **root 或 operator 用户才可写**。三把权限位 `PermitRead/PermitWrite/PermitCert` 在 server.go:217-222 装配，
  每个 handler 自行检查对应位（如 localapi.go:845-847、953-956）。沙盒 macOS 另有 HTTP BasicAuth 一次性口令
  `RequiredPassword`（localapi.go:207-211 注释 + 259-271 常时比较）。
- **多用户互斥**：已有活跃连接时其他用户连接报 `inUseOtherUserError`（server.go:255-287），Windows SYSTEM 恒放行（:266-268）；
  watch-ipn-bus 在被占用时改为推一条 `State: InUseOtherUser` 的 Notify（localapi.go:869-885）。
- 传输无关性的实证：oracle 取证时 LocalAPI 曾经 `127.0.0.1` HTTP 代理访问成功（`/localapi/v0/status`，
  protocol-notes.md:47-50）——鸿蒙端可自由选本地 IPC 载体，**协议语义层（URL/方法/JSON）与载体解耦**。
- 响应头固定携带 `Tailscale-Version` 与 `Tailscale-Cap`（capver 数值，localapi.go:254-255）——mock 对齐时 Useful。

### 1.2 端点全表

路由规则：路径必须是 `/localapi/v0/<name>`（localapi.go:314-321）；先精确匹配 handler 表，再按「含尾斜杠的键」做前缀匹配（:322-335）。

静态注册表（localapi.go:71-97）+ 条件注册（localapi.go:99-165，按 buildfeatures）：

| 端点 | 方法 | 权限 | 语义（实读位置） |
|---|---|---|---|
| `/` | GET | - | 根路径回 `tailscaled\n`（localapi.go:347-349）；Windows 另有 HTML 状态页（server.go:232-238） |
| `/status` | GET | read | `?peers=`（默认 true）→ `ipnstate.Status` JSON，缩进 tab（localapi.go:844-859） |
| `/prefs` | GET/HEAD/PATCH | read / write | GET 返回 `ipn.PrefsView`；PATCH body=`ipn.MaskedPrefs`（掩码合并，见 §1.4）（localapi.go:998-1041） |
| `/checkprefs` | POST | write | body=完整 `ipn.Prefs`，仅校验返回 `{error}`（localapi.go:1047-1068） |
| `/start` | POST | write | body=`ipn.Options` JSON（backend.go:651-663：`FrontendLogID`/`UpdatePrefs`/`AuthKey`）→ `LocalBackend.Start`（localapi.go:953-979）；state store 不健康时 500 |
| `/login-interactive` | POST | write | 触发 `StartLoginInteractiveAs`，成功 204（localapi.go:936-951） |
| `/logout` | POST | write | `Logout`，成功 204（localapi.go:981-996） |
| `/watch-ipn-bus` | GET | read | **长连 JSON 流**（见 §1.3） |
| `/derpmap` | GET | （无检查） | 当前 DERPMap JSON（localapi.go:1104-1113） |
| `/dns-config` | read | read | 返回 netmap 的 `DNS`（= `tailcfg.DNSConfig` 原文）；无 netmap → 503（localapi.go:1134-1148） |
| `/dns-query` | GET | **write** | `?name=&type=`（类型表 localapi.go:1783-1816）→ `apitype.DNSQueryResponse{Bytes,Resolvers}`；**要 PermitWrite（隐私考量）**（localapi.go:1741-1779） |
| `/ping` | POST | （无检查） | `?ip=&type=&size=`，size 仅 disco ping 支持（localapi.go:1263-1308） |
| `/peer-by-id` | GET | read | `?id=<int64 NodeID>` → 完整 `tailcfg.Node`；404=不在 netmap（localapi.go:1165-1189） |
| `/user-profile` | GET | read | `?id=<UserID>` → `tailcfg.UserProfile`（localapi.go:1204-1230） |
| `/whois` | GET | read | `?addr=<ip[:port]|nodekey:…>` → `apitype.WhoIsResponse{Node,UserProfile,CapMap}`（localapi.go:515-599；apitype.go:33-42） |
| `profiles/` | 前缀 | 混合 | 登录档案管理（localapi.go:1534 起） |
| `cert-domains` / `set-dns` / `set-expiry-sooner` / `shutdown` / `reload-config` / `services` 等 | - | 见表 | localapi.go:77-97 注册表 + 各 handler 体 |
| debug 族：`bugreport`/`pprof`/`metrics`/`goroutines`/`logtap`/`id-token`/`alpha-set-device-attrs`… | - | 见表 | localapi.go:121-164 条件注册 |
| `/server-status`（非 /localapi 前缀） | GET | - | backend 未就绪时等 `?wait=`（Windows GUI 用，server.go:120-149） |

日志纪律：非安全方法（非 GET/HEAD/OPTIONS）记一行 `localapi: [METHOD] route`（localapi.go:338-345）。

### 1.3 watch-ipn-bus：IPN 总线（壳 UI 的数据通道）

- 客户端 `GET /localapi/v0/watch-ipn-bus?mask=<十进制 uint64>`；mask 文本解码 = `ParseUint(base10)`（backend.go:264-271），
  服务端解析失败→400（localapi.go:898-904）；`NotifyInProcessNoDisconnect` 仅限进程内订阅者，HTTP 客户端请求即 400（localapi.go:905-908 + backend.go:162-175）。
- 响应为 **每行一个 `ipn.Notify` JSON 对象**（Content-Type application/json，逐条 flush；localapi.go:920-933）。
- **mask 位表**（backend.go:82-195；值=十进制）：

| 位 | 值 | 语义 |
|---|---|---|
| NotifyWatchEngineUpdates | 1<<0=1 | 引擎统计推送 |
| NotifyInitialState | 1<<1=2 | 首条带 State+BrowseToURL+SessionID |
| NotifyInitialPrefs | 1<<2=4 | 首条带 Prefs |
| NotifyInitialNetMap | 1<<3=8 | 首条带 NetMap（遗留） |
| NotifyNoPrivateKeys | 1<<4=16 | no-op（现已恒脱敏） |
| NotifyInitialDriveShares | 1<<5=32 | 首条带 DriveShares |
| NotifyInitialOutgoingFiles | 1<<6=64 | 首条带外发文件 |
| NotifyInitialHealthState | 1<<7=128 | 首条带 health.State |
| NotifyRateLimit | 1<<8=256 | netmap 限频（与新式位互斥） |
| NotifyHealthActions | 1<<9=512 | health 带 PrimaryActions |
| NotifyInitialSuggestedExitNode | 1<<10=1024 | 首条带建议 exit node |
| NotifyInitialClientVersion | 1<<11=2048 | 首条带 ClientVersion |
| NotifyPeerChanges | 1<<12=4096 | 订阅 peer 全节点增删改（PeersChanged/PeersRemoved） |
| NotifyNoNetMap | 1<<13=8192 | 抑制后续 NetMap（仅仍发 NetMap 的平台） |
| NotifyInitialStatus | 1<<14=16384 | 首条带 `InitialStatus`（新式快照，优先用它） |
| NotifyPeerPatches | 1<<15=32768 | 窄字段 patch（PeerChangedPatch）；**蕴含 NotifyPeerChanges** |
| NotifyInProcessNoDisconnect | 1<<16=65536 | 仅进程内；LocalAPI 禁用 |
| NotifySysPolicyChanges | 1<<17=131072 | 策略快照 |
| NotifyPeerWireGuardState | 1<<18=262144 | WG 会话态 |

- **`ipn.Notify` 结构**（backend.go:300-481）：`Version`、`SessionID`（**仅首条消息携带**，:304-308）、`ErrMessage`、
  `LoginFinished`、`State *State`、`Prefs *PrefsView`、`SelfChange *tailcfg.Node`（:318-327，自节点变化）、
  `InitialStatus *ipnstate.Status`（:329-334）、`NetMap *netmap.NetworkMap`（:338-352，**Deprecated：仅 Windows 平台在后续消息里继续推**）、
  `PeerChangedPatch []*tailcfg.PeerChange`（:354-372，对应 MapResponse.PeerChangedPatch 词表：Online/LastSeen/DERPHome/Endpoints）、
  `PeersChanged []*tailcfg.Node`（:374-385，upsert by NodeID）、`PeersRemoved []NodeID`（:387-391）、
  `UserProfiles`（:393-416）、`Engine *EngineStatus`、`BrowseToURL *string`（登录跳转，:423）、`Health`、`SuggestedExitNode` 等。
  遇到不认识的 PeerChange 字段 → 用 `peer-by-id` 拉 O(1) 全量（:367-371 注释明文）。
- `NotifyRateLimit` 与 `NotifyPeerChanges|NotifyNoNetMap|NotifyInitialStatus|NotifyPeerPatches` 组合直接 400（backend.go:273-290 ValidateNotifyWatchOpt，localapi.go:909-912）。

### 1.4 prefs 读写：MaskedPrefs 掩码语义

- `Prefs` 字段全表（ipn-prefs.go:59-322）：`ControlURL`(:75)、`RouteAll`(:81)、`ExitNodeID/ExitNodeIP`(:98-99)、
  `CorpDNS`(:135)、`WantRunning`(:150)、`LoggedOut`(:158)、`ShieldsUp`(:164)、`AdvertiseTags`(:170)、`Hostname`(:174)、
  `AdvertiseRoutes`(:204)、`Sync`(:216) 等；`DefaultControlURL = "https://controlplane.tailscale.com"`（:42）。
- **PATCH 必须用 `MaskedPrefs`**：`Prefs` 内嵌 + 每 field 一个 `XxxSet bool` 掩码位（ipn-prefs.go:356-393，
  如 `CorpDNSSet`/`WantRunningSet`/`RouteAllSet`）；`ApplyEdits` 只拷贝掩码为 true 的字段（:419-427）。
  LocalAPI 没有「整对象 PUT」语义（servePrefs 仅 GET/HEAD/PATCH 三分支，localapi.go:1004-1036）。
- oracle 实测「LocalAPI 对外从不吐私钥」（protocol-notes.md:214-216）与上游 `NotifyNoPrivateKeys` no-op 注释（backend.go:92）一致。

### 1.5 BackendState 状态机

- 状态值（backend.go:27-35）：`NoState=0, InUseOtherUser=1, NeedsLogin=2, NeedsMachineAuth=3, Stopped=4, Starting=5, Running=6`；
  字符串形态 `stateStrings`（:41-49，status JSON 的 `BackendState` 用它，ipnstate.go:39-42）。
- 转移中枢 `enterStateLocked`（local.go:6724-6808）：每次转移先 `sendLocked(Notify{State})` 广播到 bus（:6771），再按目标态执行：
  - `NeedsLogin`：封引擎更新（blockEngineUpdates，:6779），并 fallthrough 到
  - `Stopped`/`NoState`：**向引擎 Reconfig 三份空配置**（wgcfg/router/dns 全空 = 拆数据面，:6781-6787）；
  - `Starting`/`NeedsMachineAuth`：`authReconfigLocked()`（装 netmap→引擎，:6792-6795）；
  - `Running`：systemd 状态汇报（:6796-6804）。
  - 离开 Running 时关闭 PeerAPI 监听（:6754-6759，联动 §2）。
- 上游自注：状态翻转并非全部经过此函数（:6718-6721 注释）——mock 实现「状态名↔行为」对照即可，不必复刻内部调用图。
- `WantRunning=false` 单独短路 reconfig（local.go:6072-6075）——「Stopped 且有 netmap」时控制面长轮询会被暂停（:1114-1136）。

### 1.6 status JSON 的结构锚点（与 oracle 对拍）

- `Status`（ipnstate.go:31-90）：`Version`/`TUN`(bool，:35-37)/`BackendState`(字符串)/`AuthURL`/`TailscaleIPs`/`Self *PeerStatus`/
  `Health []string`(:55-58)/`MagicDNSSuffix`(:60-63，legacy)/`CurrentTailnet *TailnetStatus`/`CertDomains`/`ExtraRecords`/
  **`Peer map[key.NodePublic]*PeerStatus`（key 是节点公钥，非数组，:79-80）**/`User map[UserID]UserProfile`。
- `TailnetStatus`（:171-186）：`Name`、`MagicDNSSuffix`（**无包围点**，:175-180）、`MagicDNSEnabled`。
- `PeerStatus`（:233-290+）：`DNSName` 形如 `host.<MagicDNSSuffix>.` **尾点必带**（:239-241）、`TailscaleIPs`、`AllowedIPs`、
  `Addrs/CurAddr/Relay(DERP region code)/PeerRelay`(:263-267)、`RxBytes/TxBytes/Created/LastSeen/LastHandshake/Online/ExitNode/ExitNodeOption/Active`(:269-284)、
  `PeerAPIURL []string`(:286-287)。与 oracle 实测逐字段吻合（protocol-notes.md:82-112）。

---

## 2. PeerAPI（HTTP over WireGuard 的节点间 API）

### 2.1 监听装配与端口

- 每个自机地址一个 TCP listener（v4+v6 各一），由 `initPeerAPIListener` 在 netmap 到达时装配
  （local.go:6420-6473：`peerAPIServer{b, resolver: DNSManager.Resolver()}` :6420-6426；netstack 模式第二个地址起 skipListen 复用端口 :6433/6462-6463；
  `urlStr = "http://<ip>:<port>"` :6467；端口表 `b.peerAPIPorts` :6471-6473）。
- **端口推导（best-effort 确定性）**（peerapi.go:98-115）：`tryPort = (32<<10) | crc32.ChecksumIEEE(ip16 末 3 字节, 首字节 += try)`
  ——即落在 [32768, 65535]，同机 v4/v6 通常同端口；连试 5 次失败 → 退随机临时端口 `:0`（:117）；再失败且非 iOS → 假监听器（:119-123）。
- **假监听器形态**（peerapi.go:1022-1066）：`Addr()` 报告 `ip:1`（端口 1 是「对外通告值」），Accept 永久阻塞——
  Android（:63-65）与 netstack 环境靠 netstack 截获 TCP 后直通 peerapi（:1033-1045 注释）。
  **鸿蒙 userspace 形态与 Android 同构：不需要内核 listener，通告端口+用户态分发即可。**
- 每连接 `ServeConn`（:187-216）：`WhoIs("tcp", src)` 用**源 Tailscale IP** 反查 peer 身份（:189-194，查不到即断）；
  `isSelf = 自节点 User == peer User`（:203）；每连接独立 `http.Server`，**同时开 HTTP/1 与「未加密 HTTP/2」**
  （:213-214，over WireGuard 无 TLS）。

### 2.2 请求校验与路由

- `validatePeerAPIRequest`（peerapi.go:289-297）：拒绝任何 `Referer`/`Origin`；Host 头必须是 `peer` 字面量
  或本机地址 `ip:port`（`validateHost` :275-287；`isAddressValid` :262-273 会把 peer 的 MasqAddr 也认作有效目的——即经 4via6/Masq 伪装后的地址同样可访问）。
- 浏览器识别（Accept-Encoding deflate / Mozilla UA / Accept-Language）→ 加 CSP/XFO/nosniff 安全头，Go 客户端则省字节（:299-330, :369-373）。
- 路由（:358-429）：前缀表（含尾斜杠键，:374-379）→ **`/dns-query`**（:380-384）→ debug `/v0/{goroutines,env,metrics,magicsock,dnsfwd,interfaces,sockstats}`（:385-409）→
  `RegisterPeerAPIHandler` 注册表（feature 包注册，如 Taildrop/Drive；:332-348, :410-413）→ `/` 返回「Hello, <peer 显示名>」页（:414-428）。

### 2.3 对端发现：Hostinfo.Services 词表

- 自机通告（local.go:5642-5663 `peerAPIServicesLocked`）：每个 listener 一条 `{Proto: "peerapi4"|"peerapi6", Port: <port>}`；
  另在主流 OS 上追加 `{Proto: "peerapi-dns-proxy", Port: 1}`（port=1 仅作**能力版本标记**）。
  三个 Proto 常量定义在仓内归档 `docs/upstream/ts-main/tailcfg.go:809-811`（`PeerAPI4="peerapi4"`、`PeerAPI6="peerapi6"`、`PeerAPIDNS="peerapi-dns-proxy"`；`Service` 结构 :825）。
- 对端解析（local.go:7648-7662 `peerAPIPorts`）：从 peer 的 `Hostinfo.Services` 读 `peerapi4/peerapi6` 端口；
  `peerAPIBase`（peerapi.go:994-1020）按**本机地址族**选择：self 有 v4 且对端有 p4 → `http://<peer v4>:p4`，否则 v6，都不满足 → 空串。
  oracle 的交叉验证（PeerAPIURL ↔ Hostinfo.Services peerapi4/6 一致，protocol-notes.md:105）与此同源。

### 2.4 DoH-over-WireGuard（ExitDNS）

- `/dns-query` 是 **RFC 8484 DoH 语义但跑在明文 HTTP-over-WG 上**（peerapi.go:754-755 注释）；
  resolver 来自 `dns.Manager.Resolver()`（local.go:6423-6425）。
- 授权链 `replyToDNSQueries`（peerapi.go:683-704）：`isSelf` 恒答；否则走 hook
  `offersExitNodeOrAppConnectorAndPeerHasAutogroupInternet`（:715-752）：**本机是 exit node 或 app connector，且
  PacketFilter 会放行 `remote → 0.0.0.0:53`（IPv6 用 `2000::`:53）**（filter.CheckTCP，:750-751）——PacketFilter 是 peerapi 绕过 wgengine 后的独立第二道门。
- 请求形态：POST wire-format DoH；GET `?q=<name>&t=<type>` 为调试形态（:765-773, :817-850）；成功应答
  `Content-Type: application/dns-message`（:812）；超时 5s（:781-783）。
- resolver 侧入口 `HandlePeerDNSQuery`（tsdns.go:474-541）：拒答名→RCodeRefused（:486-490）；
  Unix 系读 OS stub resolver（:502-524，resolv.conf 指向 quad-100 时防回环直接用内置默认，:513-517）→ 复用 forwarder 竞速（:526）。
- **与 MagicDNS 的耦合**：exit node 的 DoH base URL = `peerAPIBase(nm, peer) + "/dns-query"`（local.go:7863-7880）；
  资格判定 `peerCanProxyDNS` = `peer.Cap >= 26` 或旧式 Services 里有 PeerAPIDNS（:7908-7924）。

---

## 3. MagicDNS 核心语义

### 3.1 全链数据流（control 下发 → OS/quad-100）

```
MapResponse.DNS (tailcfg.DNSConfig)
  → dnsConfigForNetmap(nm, peers, prefs, selfExpired, goos)   [node_backend.go:1456-1649]
  → dns.Config{AcceptDNS, DefaultResolvers, Routes, SearchDomains, Hosts, SubdomainHosts, OnlyIPv6, MagicDNSHostsUnrouted}
  → Manager.compileConfig(cfg)                                 [manager.go:306-461]
      → resolver.Config{AcceptDNS, Routes, Hosts, LocalDomains, SubdomainHosts}   （quad-100 内核）
      → OSConfig{Nameservers, SearchDomains, MatchDomains, Hosts(windows)}        （OS 侧）
```

- `tailcfg.DNSConfig` 字段（仓内归档 ts-main/tailcfg.go:1788-1826）：`Resolvers`（全局，"override local DNS"）、
  `Routes map[string][]*Resolver`（**值可为空数组=权威应答**，capver 注释 :66/:75）、`FallbackResolvers`、`Domains`（搜索域）、
  `Proxied bool`（:1812-1816，**注释原文 "Proxied turns on automatic resolution of hostnames" = MagicDNS 开关**）、
  `Nameservers`、`CertDomains`、`ExtraRecords []DNSRecord`。
- oracle 环境（protocol-notes.md:175-177）：`Domains:["edgenet.lan"]`、`Proxied:true`、`Resolvers:[223.5.5.5,119.29.29.29]`、
  Routes=64 条 `100.in-addr.arpa` 分片 + 1 条 `fd7a:115c:a1e0` ip6.arpa、值均为空数组——与 §3.3 的 rootDomains 推导完全对上。

### 3.2 dnsConfigForNetmap 的推导规则（逐条，node_backend.go:1456-1649）

1. netmap 为 nil → nil（:1457-1459）；build 无 DNS → 空 Config（:1460-1462）。
2. **自机 key 过期 → 返回空 Config**（:1472-1474；注释：避免把「只经 tailnet 可达的 DNS 服务器」写进 OS 打断连通性）。
3. `AcceptDNS = prefs.CorpDNS`（:1477）。
4. 自机仅有 v6 地址 → `OnlyIPv6=true` + `selfV6Only` 标志（:1482-1488）；`AllCaps` 含 `NodeAttrMagicDNSPeerAAAA` → `wantAAAA`（:1489-1491）。
5. Hosts 装载策略：**仅 Windows** 把 self+全部 peer 的名字→地址写满 `Hosts`（hosts 文件回退路径，:1502-1517）；
   其他平台 Hosts 只装 `DNS.ExtraRecords`（A/AAAA 按值推断，:1518-1536）——节点记录由 quad-100 **按需**从活索引拉
   （`magicDNSHostAddrs`，见 §3.4；注释 :1493-1501 引 issue #1886）。
6. `!CorpDNS` → 提前返回（此时只有 Hosts/OnlyIPv6，:1538-1540）。
7. `DNS.Domains` → `SearchDomains`（非 FQDN 记日志但仍加，:1542-1548）。
8. **`DNS.Proxied == true`（即 MagicDNS 开）→ 对每个 root domain `Routes[dom] = nil`（= 权威内部解析）**（:1549-1552）；
   否则 `MagicDNSHostsUnrouted = SelfNode 有效`（:1553-1561，保住 quad-100 在 OS resolver 路径里的位置）。
9. exit node 场景（:1586-1600）：所选 exit node 可 DoH 代理 → 全局 DNS 走它：
   `DefaultResolvers = DNS.Resolvers 里带 UseWithExitNode 标记者`，没有则 `[peerAPIBase+"/dns-query"]`；
   Routes 叠加 `useWithExitNodeRoutes` 后**提前 return**。
10. `len(DNS.Resolvers)>0` → `DefaultResolvers = DNS.Resolvers`（:1602-1606）；否则 WireGuard-only exit node 的
    `ExitNodeDNSResolvers`（:1607-1611；字段定义仓内归档 tailcfg.go:554-556）。
11. `DNS.Routes` 全量进 `Routes`（**空 resolver 数组也建条目 = 权威 NXDOMAIN**，issue 2706 注释 :1574-1579；:1613-1614）。
12. FallbackResolvers 兜底（:1623-1647）：仅当「无 DefaultResolvers 且选了（老）exit node」时用 `DNS.FallbackResolvers`。

### 3.3 MagicDNS 的名字空间：rootDomains 与节点名

- `magicDNSRootDomains(nm)`（local.go:6479-6501）＝ `nm.MagicDNSSuffix()` + **两条反解区**：
  - IPv6：`0.e.1.a.c.5.1.1.a.7.d.f.ip6.arpa.`（即 fd7a:115c:a1e0::/48 的 nibble 反转，:6488）
  - IPv4：`64.100.in-addr.arpa.` … `127.100.in-addr.arpa.`（CGNAT 100.64/10 覆盖的 64–127 共 64 条，:6490-6496）
  → 合计 65 条权威后缀。**oracle netmap 里「64 条 100.in-addr.arpa 分片 + 1 条 ip6.arpa」（protocol-notes.md:175-177）就是 control 把它们下发在 DNS.Routes 的样子。**
- 节点名记录（按需，非 Windows）：
  - `magicDNSHostAddrs(fqdn)`（node_backend.go:1214-1239）：`nodeByFQDNLocked` 查节点 → `magicDNSAddrs(n.Addresses(), flags)`。
  - `nodeByFQDNLocked`（:1287-1305）：**统一 lowercase、去尾点匹配**（:1295）；**裸主机名（无点）仅 Proxied=true 才解析**（:1296-1299）。
  - `magicDNSAddrs`（:1320-1350）应答规则：self 是 v6-only → 返回 peer 全部 v6；否则 **peer 的 v6 地址被隐藏**（若 peer 同时有 v4），
    除非 `wantAAAA`（历史原因 issue #1152 注释 :1337-1343）。
  - PTR：`magicDNSPTR`（:1243-1262）按 `nodeByAddr` 反查名字；子域解析资格由 `NodeAttrDNSSubdomainResolve` 控制（:1264-1281）。
- 名字字符串语义（util/dnsname/dnsname.go）：`ToFQDN` 归一化出**恒带尾点**的 FQDN、label ≤63、总长 ≤254（:13-18, :23-66）；
  `Contains`=后缀包含（:86-95）；`HasSuffix` 忽略首尾点（:180-186）；`SanitizeHostname` 先剪 `.local/.localdomain/.lan` 再净化 label（:200-213）。
  本仓未来实现一律存「带尾点」形态（PeerStatus.DNSName 同样尾点，ipnstate.go:239-241）。

### 3.4 quad-100 内核（resolver）决策序

- 决策序文档（tsdns.go:84-89）：①精确命中 Hosts（含按需 MagicDNSHosts）→ 应答；②命中 LocalDomains → 权威 NXDOMAIN；
  ③ Routes 取**最长后缀匹配**转发；④无路由 → SERVFAIL。
- `resolveLocal`（tsdns.go:725-839）细节：
  - `.onion` 恒 NXDOMAIN（RFC 7686，:727-731）；
  - 反解 quad-100 本身 → 符号名 **`magicdns.localhost-tailscale-daemon.`**（:45, :736-743；正向查该名返回 service IP :739-741；fqdnForIPLocked :939-941）；
  - Hosts 未命中 → `magicHosts.LookupHost` 按需（:756-759）；再沿 `Parent()` 逐级查 SubdomainHosts（:760-771）；
  - 名字存在但无该类型记录 → **NOERROR 空应答（非 NXDOMAIN）**（:785-838，A/AAAA/ALL 分支）；
  - NS/SOA/AXFR/HINFO → NOTIMP（:824-826）；未知类型 → NOERROR（:828-837）；
  - 既不在 Hosts 也不在任何 LocalDomains → **RCodeRefused = 请求转发**（:780-782；`respond` 把它映射成哨兵 errNotOurName :1479-1480；
    `Query` 捕获后交给 forwarder :420-431，超时 10s :406）。
  - 4via6 名字（`<v4-用连字符>-via-<siteid>[...]`）合成 AAAA（:841-900）。
- 反解（PTR）：`resolveLocalReverse`（:903-931）解析 in-addr.arpa/ip6.arpa → 反查 Hosts/按需 PTR（:934-958）；
  先试 6to4 段（:922-929）。
- TTL 与报文上限：正答 TTL **5s**、负答（含 SOA，RFC 2308）**10s**（:52-68）；应答上限 **4095B 超限置 TC**（:47-50）。
- 转发器（forwarder.go，定点核对）：resolver addr 形如 `https://…` 走 DoH 客户端（对 urlBase 做 Happy-Eyeballs 竞速拨号，
  forwarder.go:521-523；:648-666 分派）；常规 UDP 查询后跟 TCP 竞速（:743-744 注释）。

### 3.5 Manager.compileConfig：OS 侧怎么配（manager.go:306-461）

- resolver.Config 恒拿 `Hosts/SubdomainHosts/AcceptDNS`；Routes 里**空 resolver 条目转为 `LocalDomains`**（:313-322）；
  搜索域恒下发 OS（:324-325）；Windows 需要时另出 hosts 文件条目（:326-328 + compileHostEntries :237-282）。
- 分支表：
  - 无需 OS resolver（无 DefaultResolvers 且无 Routes）→ 只下发搜索域（:332-336）；
  - 仅「普通 IP:53 默认 resolver」且无未覆盖 Hosts → 直接把 resolver 写 OS（:337-349）；
  - **有 DefaultResolvers 且还有别的 → quad-100 全代理**：`ocfg.Nameservers = serviceIPs()`、`rcfg.Routes["."] = DefaultResolvers`（:350-356）；
  - OS 原生支持 split DNS 且全部路由同 resolver → OS 直配 + MatchDomains（:385-393）；
  - 其余（含 Windows WSL workaround、Apple）→ quad-100 split（:395-404）；OS 不支持 split DNS → 读 OS 基线并进 Routes["."]（:416-450）。
- **quad-100 服务地址**（config.go:79-94 + net/tsaddr/tsaddr.go:52-54/:60-67）：
  v4 = `100.100.100.100`，v6 = `fd7a:115c:a1e0::53`；默认双栈都下，控制面 knob 可强制 v4-only，self v6-only 时仅 v6。
  本仓 common/constants.ts 目前**没有**这两个常量（grep 无命中）——mock/推导要用时需新增。
- OSConfig 里 MatchDomains 是「哪些后缀应指到 quad-100」（=Routes 键排序，:189-199 config.go）。
- quad-100 同时听 UDP+TCP（Manager.Query :487-511；HandleTCPConn :639-650）。

---

## 4. 数据面 TUN fd 接线（上游形态 → TS mock 蓝本）

### 4.1 底层抽象：wireguard-go `tun.Device` 接口（tailscale fork）

`github.com/tailscale/wireguard-go@2e01ba5b00f0/tun/tun.go`：

```go
type Device interface {                     // tun.go:20-53
    File() *os.File                          // :22  —— fd 暴露（netns 绑定用）
    Read(bufs [][]byte, sizes []int, offset int) (n int, err error)   // :29  批量读「待发往 WG 的 IP 包」
    Write(bufs [][]byte, offset int) (int, error)                     // :35  批量写「WG 解密出的 IP 包」进 OS
    MTU() (int, error)                       // :38
    Name() (string, error)                   // :41
    Events() <-chan Event                    // :44
    Close() error                            // :47
    BatchSize() int                          // :52  生命周期内不变
}
// Event 位：EventUp=1, EventDown=2, EventMTUUpdate=4（tun.go:12-18）
// GRODevice = Device + DisableUDP/TCPGRO()（tun.go:70-76）
```

- **语义方向**（与 net/tstun/wrap.go:146-158 注释一致）：`Read` = 从 OS 收 IP 包（发往 WG 加密）；`Write` = 向 OS 注入 IP 包（WG 解密所得）。
- 真实 fd 的创建在平台层：`tstun.New(logf, tunName)`（net/tstun/tun.go:36-98）→ `tun.CreateTUN(tunName, DefaultTUNMTU())`（:65，
  Linux 即 /dev/net/tun + TUNSETIFF，属 wireguard-go 平台文件，本轮未展开）→ `waitInterfaceUp(dev, 90s)`（:81）→ 返回设备与接口名。
- **内存/无 fd 形态 `tstun.NewFake()`**（net/tstun/fake.go:19-58）：`Read` 阻塞至 Close 后返 EOF（:36-39）、`Write` 恒 `(1,nil)`（:41-48）、
  MTU=1500（:54）、Name="FakeTUN"（:51/:55）、`IsFakeTun()=true`（:58）。这是「userspace-networking/netstack 模式」与**我们 TS mock 的直接对应物**。
- （`wgengine/mem_ios.go` 只有 iOS 内存队列调参，与 TUN 抽象无关——20 行已全读，勿被文件名误导。）

### 4.2 装配链（谁把 fd 接进引擎）

`NewUserspaceEngine(logf, conf)`（wgengine/userspace.go:304 起）：

1. `conf.Tun tun.Device` 为 nil → `tstun.NewFake()`（userspace.go:316-319；Config 定义 :168-264，`Tun` 字段注释「与 OS 交换报文的设备」:170-173）。
2. 包一层 ts 增强：`tsTUNDev = tstun.Wrap(logf, conf.Tun, metrics, bus)`（:339-344；TAP 走 WrapTAP :340-342）。
3. `tunName, _ := conf.Tun.Name()` 喂 dialer（:405-406）；`tsTUNDev.SetDiscoKey(...)`（:460）；
   过滤钩子装配：`PostFilterPacketInboundFromWireGuard = echoRespondToAll`（fake 模式 ICMP 应答，:462-464）、
   `PreFilterPacketOutboundToWireGuardEngineIntercept = handleLocalPackets`（quad-100 本地报文截获，:465）。
4. **WireGuard 设备直接吃掉 TUN**：`e.wgdev = wgcfg.NewDevice(e.tundev, e.magicConn.Bind(), e.wgLogger.DeviceLogger)`（:511-513）
   ——此后 **wireguard-go 内部 goroutine 自旋调用 `tun.Device.Read/Write`**；引擎自己**不做** TUN 读写循环，
   只旁路监听升降事件 `for event := range e.tundev.EventsUpDown()`（:521-535）。
5. 引擎对 TUN 的其余动作全是「注入/过滤」：`tundev.InjectOutbound(...)` 发诊断 ICMP/TSMP 包（:1348/:1395/:1413）、`SetFilter/SetJailedFilter`（:955-967）。
6. 守护进程装配图（tsd/tsd.go）：`System.Tun SubSystem[*tstun.Wrapper]`（:60）；`Set()` 时探测 `Unwrap().(interface{ IsFakeTun() bool })`
   决定 `onlyNetstack`（:148-155, :184-187）——**「是否有真 fd」在系统装配层就是一个布尔开关**。

### 4.3 tstun.Wrapper：过滤/注入层（net/tstun/wrap.go）

- `Wrapper augments a tun.Device with packet filtering and injection`（wrap.go:93-97）；**Read 在 `Start()` 前软木塞**
  （:95-96 注释、started 标志 :104-105、`awaitStart` 每 1s 打日志 :857-869）——`Start()` 置位并关门（:274-277）。
- 缓冲常量：`PacketStartOffset = device.MessageTransportHeaderSize`（:52，**读写缓冲头部预留空间**，避免 wireguard-go 内部重分配 :49-51）；
  `MaxPacketSize = device.MaxContentSize`（:56）；`maxBufferSize = device.MaxMessageSize`（:47）。
  **tailscale fork 的实际数值**（fork device/noise-protocol.go:65-80）：`MessageTransportHeaderSize = 16`（=type4+receiver4+counter8 对齐内容起点，
  偏移常量 receiver=4/counter=8/content=16 :76-80）、`MessageTransportSize = 16+16(tag)`、`MessageKeepaliveSize = 32`；
  `MaxSegmentSize = (1<<16)-1 = 65535`（fork device/queueconstants_default.go:17）；
  fork 的 `MaxContentSize = 65535 - 32 - 8`（fork device/constants.go:32，比原版多扣 8B encapsulating）。
  ⚠ 仓内归档 `docs/upstream/2026-10-01-phase2/wg-device-constants.go:30-32` 是 **master 原版口径**（无 encapsulating 扣减），两份不要混用。
- 队列与方向（wrap.go:119-163）：`vectorOutbound` 是「包离开 TUN 去往 WG」的通道（Read 消费，容量 1 :299）；
  `pollVector` goroutine 从 `tdev.Read` 批量拉包（wrap() :321-326）；事件被 `pumpEvents` 拆到 `eventsUpDown`/`eventsOther`（:160-163, :409-449）。
- **两个数据面入口**：
  - `Read(...)`（:871-939，OS→WG）：从 vectorOutbound 取包 → `filterPacketOutboundToWireGuard`（drop 计数 :901-908）→ SNAT（:917）→ 拷入 buffs；
  - `Write(...)`（:1229-1273，WG→OS）：`pc.dnat(p)`（:1239）→ `filterPacketInboundFromWireGuard`（PacketFilter 主门；drop 即静默丢弃+计数 :1246-1248）→ `tdevWrite` → 底层 `t.tdev.Write`（:1262-1270, :1275-1284）。
  - 两个过滤函数体（:745-835 / :1097-1228）**本轮未逐行实读**（PacketFilter 语义属二期另一件）；此处只锚定其挂点与时序。
- 注入 API：`InjectOutbound`（:1447，把包当成「来自本机」送进 WG 方向）；`InjectInboundDirect/Copy/PacketBuffer`
  （:1383/:1402/:1318，把「合成包」交给 OS 且**不过入站过滤**，netstack 用它交付 TCP 栈回应）。
- filter 挂接：`SetFilter/SetJailedFilter`（:1289-1300，atomic 指针 :165-171）；调用链 local.go:3532-3534（`b.e.SetFilter(f)` + magicsock 侧）。
- `PeerAPIPort func(netip.Addr) (port, ok)` 钩子（:211-213）：netstack 把 peerapi 目的 TCP 流截给 peerapi 时用它识别端口（§2.1 假监听器的另一半）。

### 4.4 对纯 TS mock 的映射建议（C-2 输入）

1. **接口面**照 `tun.Device` 收敛为窄接口（TS 侧命名示例，非契约）：
   `TunDevice { readBatch(): Uint8Array[]（阻塞语义用 Promise/注入队列表达）; writeBatch(pkts: Uint8Array[]): number; events: TunEvent 位掩码回调; mtu(): number; name(): string; close(): void }`
   ——事件位 1/2/4、MTU 1500、名 "FakeTUN" 直接对齐 fake.go:51-58。
2. **先做 NewFake 形态**（无 fd、恒空转）再在其上叠 mock 互连（两台 mock 引擎用内存「网线」对接），先例即
   `app/bridge/src/mock-udp-bus.ts`（UdpDatagramBus 内存总线 + NAT 仿真，mock-udp-bus.ts:1-13）。
3. **PacketStartOffset 在 TS mock 中可固定 0**（上游 16B 头部空间是为 wireguard-go 内部优化，wrap.go:49-52）；
   本仓 `WgSendSession.encryptPacket` 输出完整 16B 头报文（architecture.md §5.1），无需重叠缓冲。
4. **Wrapper 的职责拆开 mock**：TunDevice（纯 IO）与 TsTunWrapper（过滤+注入+ cork/Start 语义）分开建模；
   「Read 前 Start cork」建议照抄（防 mock 测试假绿——没 Start 就该读不出包）。
5. 数据通路测试断言可锚定：出站过滤丢弃不改写、入站 DNAT 先于过滤（wrap.go:1239 在 1245 前）、
   事件 Up/Down 只从 EventsUpDown 出（userspace.go:521-535）。

---

## 5. 与本仓现有实现的衔接点

| # | 衔接点 | 现状（文件:行） | C3/后续要做的事 |
|---|---|---|---|
| 1 | **JSON 边界裁定** | R3 明文「JSON 只允许出现在 app/ 侧 LocalAPI 展示层」（docs/architecture.md:50 R3）；`packages/control/src/tailcfg.ts:20-22` 自述「全仓唯一触碰 JSON 的模块」 | LocalAPI/IPN bus/PeerAPI 的 JSON 语义实现只能落在这两处之一：展示/IPC 层 → `app/`（mock 期即 app/bridge）；控制面 tailcfg 层 → tailcfg.ts 延伸。不得新开第三处 JSON |
| 2 | tailcfg DNSConfig 解码 | `tailcfg.ts:188-206` 的 `decodeMapResponseSummary` 只读 KeepAlive/Peers.length | MagicDNS 落地时在此扩展：`DNS{Resolvers,Routes,FallbackResolvers,Domains,Proxied}`（ts-main/tailcfg.go:1788-1826），**Routes 值 null/[]/缺失三态**（§6-12） |
| 3 | 状态机建模 | `app/bridge/src/shell-session.ts:86-87`（ShellSessionState Idle/Connecting/Online 三态）、`shell-status.ts` | 对齐上游 `ipn.State` 0-6（backend.go:27-35）+ 字符串名（:41-49）；`statusSnapshot` 应能表达 NeedsLogin/NeedsMachineAuth/Stopped |
| 4 | 长连流载体 | `packages/common/src/http.ts:33-52`（HttpBodyStream + HttpTransport.open 已冻结） | watch-ipn-bus 的「逐行 JSON Notify」可直接用 open() 流表达（按 `\n` 分帧）；mock 传输已有先例 mock-http-transport.ts |
| 5 | 注入纪律 | P3/P4（docs/arkts-constraints.md:597-661）；D4（architecture.md:40） | LocalAPI mock 不引 node:*；状态机时间（LastSeen/过期）全走 `Clock`；PeerAPI 端口推导的 crc32 用纯 TS 实现（crypto 包已有 BLAKE2s/CRC 先例——crc32-IEEE 在 netcheck STUN FINGERPRINT 已实现，packages/netcheck，worklog 2026-10-01 夜班面 4） |
| 6 | 常量增补 | `packages/common/src/constants.ts` 现无 quad-100/service v6 | 建议增补 `TS_SERVICE_IP_V4='100.100.100.100'`、`TS_SERVICE_IP_V6='fd7a:115c:a1e0::53'`（tsaddr.go:52-54/:67）、MagicDNS TTL 5s/10s、DNS 反解区模板；枚举类（ipn.State、NotifyWatchOpt 位、PeerAPI proto 串）按 R5「常量对象+parseXxx」建（A18） |
| 7 | PeerAPI 可先行部分 | `packages/control/src/messages.ts` TLV NetworkMapPeer 无 Services 字段 | 纯逻辑可先做：peerAPIBase 的地址族选择（peerapi.go:994-1020）、Services 通告结构（peerapi4/peerapi6/peerapi-dns-proxy, ts-main/tailcfg.go:809-825）；HTTP-over-WG 实体（需 TCP）属远期，mock 只锁「URL 语义」 |
| 8 | MagicDNS 纯函数核 | 无（net/dns 系列全部未实现） | `resolveLocal` 决策序（tsdns.go:84-89, 725-839）是纯函数（输入 dns.Config 视图+FQDN → (IP,RCode)），适合落成可测模块；落位（control 包内 vs 新包）涉及 D1/D2 拓扑修订，需架构师裁定（AU 清单增补） |
| 9 | TUN mock 桩 | `app/bridge/` 已有 mock-udp-bus（内存 UDP 总线）与 disco/netcheck 对接测试（13/13） | C-2 按 §4.4 蓝图新增 TunDevice 接口 + FakeTunDevice + 双端内存网线；`npm run test:bridge` 只增不回归（TASK.md C-2） |
| 10 | oracle 对拍面 | protocol-notes.md §2 status 字段、§4 netmap DNS、§6 prefs | 本笔记 §1.6/§3.1 已逐一对上；实现期可直接拿 raw/ 转储做 golden 用例（打码字段除外） |

---

## 6. 实现陷阱清单（按危害排序）

1. **JSON 蔓延即违约**：LocalAPI/PeerAPI/IPN bus 全部是 JSON 协议——只能在 R3 划定的两处实现（§5-1）； TLV 层（messages.ts）不要为它们扩字段。
2. **Routes 空值三态**：`Routes[suffix]` 空数组/nil = 权威应答（config.go:42-44 + node_backend.go:1574-1579 + manager.go:316-318 转 LocalDomains）；JSON 解码必须区分 `null`/`[]`/缺失（与 C1 笔记陷阱 1 同型）。
3. **`Routes[dom]=nil`（MagicDNS 开）与 `MagicDNSHostsUnrouted`（关）语义相反方向**：开=内部解析（node_backend.go:1549-1552）；关=仍保留 quad-100 在 OS 路径（:1553-1561）。别把 Proxied=false 当「全走系统」一刀切。
4. **mask 是十进制字符串**（backend.go:264-271），`NotifyRateLimit` 与新式位互斥会 400（:273-290）；`NotifyInProcessNoDisconnect` 对 LocalAPI 客户端恒非法（localapi.go:905-908）。
5. **SessionID 只在首条 Notify**（backend.go:304-308）；后续消息没有——客户端必须自己存。
6. **别消费 legacy NetMap**：bus 上的 NetMap 仅 Windows 平台继续推送且已 Deprecated（backend.go:338-352）；新客户端用 `NotifyInitialStatus(1<<14) + SelfChange + PeersChanged/PeerChangedPatch`，patch 未知字段用 `peer-by-id` 兜底（:367-371）。
7. **PeerChanges 门控**：不设 `NotifyPeerChanges(1<<12)` 时 peer 增删**根本不上 bus**；`NotifyPeerPatches` 蕴含它（backend.go:106-127, 147-160）。
8. **prefs 只能 PATCH+掩码**（MaskedPrefs，ipn-prefs.go:356-393）；没有整对象写。
9. **`/dns-query` 要写权限**（localapi.go:1750-1754）——mock 的权限模型若做成「读=全部放行」会在该端点上与上游语义相反。
10. **PeerAPI 端口非固定**：确定性公式只是 best-effort（peerapi.go:106-117）；对端永远以 `Hostinfo.Services` 下发的 port 为准（local.go:7648-7662）。通告端口 1（假监听器）是合法值（peerapi.go:1022-1045）。
11. **PeerAPI 无 TLS + Host 校验**：明文 HTTP/1+h2c over WG（peerapi.go:209-214）；Referer/Origin 恒 403、Host 须为 `peer` 或自身 ip:port（:275-297）；MasqAddr 也算有效（:262-273）。
12. **ExitDNS 资格=PacketFilter 第二用法**：`filter.CheckTCP(remote, 0.0.0.0:53 / 2000:::53)`（peerapi.go:726-751）——实现 PacketFilter 时要保留「探测性查询」入口。
13. **名字一律带尾点 FQDN + lowercase 匹配**（dnsname.go:23-66；node_backend.go:1295）；裸主机名仅 Proxied=true 才可解析（:1296-1299）。
14. **A/AAAA 应答不是全量地址**：self v6-only 才回 peer 的 v6；否则 peer 的 v6 隐藏（除非 wantAAAA）——node_backend.go:1320-1350。
15. **「名字存在但无该类型记录」= NOERROR 空，不是 NXDOMAIN**（tsdns.go:785-838）；NS/SOA/AXFR/HINFO=NOTIMP；未知类型=NOERROR。
16. **TTL 5s/负答 10s+SOA、应答 4095B 截断置 TC**（tsdns.go:47-68）——写死别的数字会破坏对端缓存行为。
17. **反解区是 65 条**：suffix + `0.e.1.a.c.5.1.1.a.7.d.f.ip6.arpa.` + `64..127.100.in-addr.arpa.`（local.go:6486-6497）；漏 ip6.arpa 或写 100.in-addr.arpa. 整段都错。
18. **quad-100 双栈**：`100.100.100.100` + `fd7a:115c:a1e0::53`（tsaddr.go:52-54/:67）；还有符号名 `magicdns.localhost-tailscale-daemon.`（tsdns.go:45）。
19. **TUN 缓冲 offset**：上游 Read/Write 缓冲带 16B 头部空间（wrap.go:52 + fork noise-protocol.go:68）；TS mock 用 0 offset 即可，但文档别把 16 写成「报文前缀」。
20. **Wrapper cork**：未 `Start()` 时 Read 永久阻塞（wrap.go:95-96, 857-869）——mock 照抄可防测试假绿。
21. **WG→OS 方向过滤失败是静默丢弃**（wrap.go:1246-1248），不向 WG 回错——mock 别做「丢包报错」。
22. **fork 与原版 wireguard-go 常量不同**：fork 的 MaxContentSize 多扣 8B（fork constants.go:32 vs 仓内归档 master 版 :32）；引用时先声明用的是哪份。
23. **状态→引擎联动**：NeedsLogin/Stopped/NoState 都会 Reconfig 三份空配置（local.go:6781-6787）；离开 Running 会关 PeerAPI（:6754-6759）——mock 状态机要带这两条副作用，否则「下线」不干净。
24. **NodeID 是 int64 查询参数**（localapi.go:1174-1179）；JSON number 超 2^53 精度问题同 C1 陷阱 15，peer-by-id 入参用字符串传大 ID。
25. **LocalAPI 客户端必须带 `Host: local-tailscaled.sock`**（apitype.go:14 + localapi.go:285-306）且不带 Referer/Origin（:249-252）——mock/测试直连 localhost 时最容易踩。

---

## 7. 未决 / 未验证项（不猜，如实记录）

- **v1.102.3 文件未入仓**：本笔记全部 v1.102.3 行号来自本次会话实拉的仓外临时副本（URL 见版本锚定；临时目录已清理）。
  如需离线复核，按 URL 复拉即可；建议 S-执行按 TASK.md B-1 惯例把 §1/§3/§4 涉及的 10 个左右核心文件归档 `docs/upstream/`。
- **tstun 两个过滤函数体未逐行实读**（wrap.go:745-835 / 1097-1228）：PacketFilter（netmap 四元组过滤）语义属二期另一件，本笔记只锚定挂点。
- **client/local/tailscale.go（LocalAPI Go 客户端）未实读**：客户端 URI 拼装细节未验证；但 Host 头语义已由服务端 localapi.go:285-306 与 apitype.go:13-14 双侧钉死，mock 不受影响。
- **golang.zx2c4 原版 wireguard-go 的常量对照未完成**（其 master 上 device/noise-protocol.go 已 404/仓库改组，API 限流）：本笔记 wireguard-go 侧一律以 **tailscale fork @2e01ba5b00f0**（v1.102.3 go.mod 锁定）为准。
- **Taildrop/Drive 等 feature 注册的 PeerAPI 路径**（RegisterPeerAPIHandler 的 feature 包侧）本轮未逐个实读，只确认注册机制（peerapi.go:332-348）。
- **forwarder.go 只做定点核对**（DoH 分派 :521-523/:648-666、UDP/TCP 竞速 :743-744），未全读；竞速细节（REFUSED 软错误等）未取证。
- **netstack（userspace-networking）内部未展开**（仅确认 wgengine/netstack 存在与 tsd 的 IsFakeTun 判定）；鸿蒙 userspace 形态若要复刻 netstack TCP，是独立大件。
- **ArkTS 运行时项**（U2 BigInt / U5 Object.keys / U6 `.ts` specifier）维持约束文档既有未验证状态，本笔记不新增裁定。
- 本机未跑任何测试/构建（本轮纯只读，遵守「实现期不跑全量 npm test」与「不写代码」纪律）。
