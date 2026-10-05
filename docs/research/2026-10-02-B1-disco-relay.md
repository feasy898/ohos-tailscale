# B1 研究笔记：disco UDP relay 家族报文类型 0x04–0x09 完整语义

- 日期：2026-10-02 ｜ 子线 B-1（TASK.md:32「上游对齐先于编码」）｜ 类型：S-研究（TASK.md:82）
- 上游实读范围：`docs/upstream/2026-10-01-phase2/`（disco.go、key-disco.go 及其 README）与 `docs/upstream/ts-main/`（tailcfg.go、derp_client.go、derpserver.go）
- 本仓对照物：`docs/oracle/protocol-notes.md`、`docs/architecture.md`、`worklog.md`、`packages/disco/**`、`packages/derp/**`、`app/bridge/src/**`
- 纪律声明：**本笔记每条协议语义均给出上游归档文件的路径+行号**；归档中没有的语义（见 §9）一律标注「未归档/不可证」，不做任何凭记忆的补写（README.md:45 教训条）。

---

## 0. 证据边界（先读这里）

本仓归档里**有**的上游证据（全部为 tailscale main 原文，2026-10-01 经 jsdelivr 实拉，`docs/upstream/2026-10-01-phase2/README.md:3-16`）：

| 归档文件 | 对应上游 | 支撑面 |
|---|---|---|
| `docs/upstream/2026-10-01-phase2/disco.go` | tailscale main `disco/disco.go` | 0x01–0x09 类型码表、全部帧布局、Parse 分发、bind 三次握手状态枚举 |
| `docs/upstream/2026-10-01-phase2/key-disco.go` | tailscale main `types/key/disco.go` | disco 键类型、box.Precompute 共享密钥、Seal/Open、DiscoPublic.Compare |
| `docs/upstream/ts-main/tailcfg.go` | tailscale main `tailcfg/tailcfg.go` | capability 版本 120/121（peer relay）、Node.DiscoKey、Hostinfo.PeerRelay、PingResponse.PeerRelay、relay 开关属性 |
| `docs/upstream/ts-main/derp_client.go`、`derpserver.go` | tailscale main `derp/` | DERP 按 **node 公钥**寻址转发（SendPacket 帧），承载 disco 密封包 |

本仓归档里**没有**、因此本笔记不写其内部语义的上游面（只记录存在性与接口面，见 §9）：

- `net/udprelay`（relay 服务端实现：分配策略、lifetime 缺省值、Geneve 数据面、Challenge 生成/校验规则、LamportID 推进规则）——disco.go:314-315 只给出包路径引用；
- magicsock `conn.go`（disco 报文的发送调度：何时发 Allocate 请求、bind 握手重传/超时、路径择优）——`docs/upstream/2026-10-01-phase2/README.md:18-20` 明确「未归档但已核对……封装侧」；
- `util/capmin`/`nodecap`/`peercap` 包（`Relay`/`RelayTarget`/`DisableRelayServer`/`DisableRelayClient` 能力串的字面量）——tailcfg.go 只引用常量名，字面量不在本仓。

以下所有行号如无特别说明均指上述归档文件（简写：`disco.go` = `docs/upstream/2026-10-01-phase2/disco.go`，`key-disco.go` = 同目录 `key-disco.go`，`tailcfg.go` = `docs/upstream/ts-main/tailcfg.go`）。

---

## 1. 总体帧层：wrapper 与密封内层（0x04–0x09 与 0x01–0x03 完全同构）

所有 disco 消息（含 relay 家族）走同一个 UDP 包级密封结构（`disco.go:4-19` 包头注原文）：

```
UDP 载荷 = magic[6] ‖ senderDiscoPub[32] ‖ nonce[24] ‖ nacl box(secretbox)
  magic   = "TS💬" = 0x54 53 f0 9f 92 ac        （disco.go:34-35）
  senderDiscoPub = 发送端 disco 公钥（32B 原始值） （disco.go:11, key-disco.go:17-28）
  nonce   = 24B 随机（nacl box nonce）            （disco.go:39-40, key-disco.go:219-226）
  box     = secretbox 输出：tag(16B) ‖ 密文（MAC 前置）
密封内层（解密后）= messageType(1B) ‖ messageVersion(1B) ‖ message-payload
                                                  （disco.go:16-18, 118-119）
```

要点（每条附证据）：

- wrapper 判定：长度 ≥ 6+32+24 且前 6 字节等于 magic（`LooksLikeDiscoWrapper`，disco.go:62-67）；发端公钥取 `wrapper[6:38]`（`Source`，disco.go:72-77）。
- 共享密钥 = `box.Precompute(peerPub, myPriv)`，即 HSalsa20(X25519(myPriv, peerPub), 0)（`DiscoPrivate.Shared`，key-disco.go:76-84）；`Seal` 输出 = 随机 nonce(24B) ‖ `box.SealAfterPrecomputation` 结果（key-disco.go:216-226）——nonce 在输出最前，与 wrapper 头第 3 段是同一份字节；`Open` 要求 ≥24B，nonce 取前 24B（key-disco.go:231-240）。
- disco 私钥生成时即 clamp（`NewDisco` → `clamp25519Private`，key-disco.go:37-43）。
- 版本字节当前恒 0（`const v0 = byte(0)`，disco.go:56），且头注写明向前兼容规则「always ignore bytes at the end」（disco.go:18）。
- **本仓 wrapper 层已实现且与上述逐字节同构**：`packages/disco/src/wrapper.ts:32-39`（magic/nonce/头长常量）、`:90-112`（discoSeal：nonce 由调用方注入，P4）、`:126-149`（discoOpen），并经 tweetnacl 互开互验（`packages/disco/test/wrapper.test.ts:1-18`）。**0x04–0x09 无需改 wrapper 层任何代码。**

---

## 2. 类型码表全表（disco.go:44-54，原文照录）

| 值 | 上游常量 | 名称（disco.go MessageSummary，:287-310） | 通道 | 本仓现状 |
|---|---|---|---|---|
| 0x01 | `TypePing` | ping | UDP（对端端点）或 DERP | ✅ messages.ts |
| 0x02 | `TypePong` | pong | 同上 | ✅ messages.ts |
| 0x03 | `TypeCallMeMaybe` | call-me-maybe | **仅 DERP**（disco.go:191-193） | ✅ messages.ts |
| 0x04 | `TypeBindUDPRelayEndpoint` | bind-udp-relay-endpoint | **普通 UDP → relay 服务端** | ❌ 二期（抛 TYPE） |
| 0x05 | `TypeBindUDPRelayEndpointChallenge` | bind-udp-relay-endpoint-challenge | relay 服务端 → 客户端（UDP） | ❌ 同上 |
| 0x06 | `TypeBindUDPRelayEndpointAnswer` | bind-udp-relay-endpoint-answer | 客户端 → relay 服务端（UDP） | ❌ 同上 |
| 0x07 | `TypeCallMeMaybeVia` | call-me-maybe-via | **仅 DERP**（disco.go:625-628） | ❌ 同上 |
| 0x08 | `TypeAllocateUDPRelayEndpointRequest` | allocate-udp-relay-endpoint-request | **仅 DERP**（disco.go:463-465） | ❌ 同上 |
| 0x09 | `TypeAllocateUDPRelayEndpointResponse` | allocate-udp-relay-endpoint-response | **仅 DERP**（disco.go:507-509） | ❌ 同上 |

`MessageType` 底层类型是 `byte`——线上就是 1 字节（disco.go:42）。

任务口径说明：TASK.md:32 把 0x04–0x09 称为「disco UDP relay 家族」，与归档码表完全吻合——这 6 个类型全部是 peer-relay（节点互为中继）协议面；0x04–0x06 是客户端↔relay 服务端的 bind 三次握手，0x07–0x09 是两条客户端之间经 DERP 交换的 relay 端点协商。

---

## 3. 逐类型字节级格式

以下长度全部可从上游常量推出，密封内层布局（已含 2B 头 type+ver）：

### 3.1 公共块 `BindUDPRelayEndpointCommon`（72B，0x04/0x05/0x06 共用）

常量 `bindUDPRelayEndpointCommonLen = 72`（disco.go:340-342）、`BindUDPRelayChallengeLen = 32`（disco.go:344-346）。字段序 = `encode` 写出序（disco.go:372-382）：

| 偏移 | 长度 | 字段 | 编码 | 语义（原文行号） |
|---|---|---|---|---|
| 0 | 4 | VNI | u32 **BE** | Geneve 头 VNI，接收时必须与「disco 密封值」一致，不一致=明文 Geneve 头被篡改/损坏（disco.go:354-357） |
| 4 | 4 | Generation | u32 BE | 握手代次；客户端每次新握手必须取**新的非零**值（disco.go:358-360） |
| 8 | 32 | RemoteKey | 原始 32B | 参与本 relay 端点的**远端 peer** 的 disco 公钥（disco.go:361-363） |
| 40 | 32 | Challenge | 原始 32B | 服务端在 0x05 设置、客户端在 0x06 原样回显（disco.go:364-366）；在 0x04 中无意义，仅作**填充，保证三种握手报文等长**（disco.go:366-369） |

`decode` 校验：输入 < 72B → `errShort`（disco.go:384-397）。

### 3.2 0x04 BindUDPRelayEndpoint / 0x05 Challenge / 0x06 Answer（三者同布局）

- 结构体与文档：0x04「客户端发往 relay 服务端的**第一条**握手报文」（disco.go:399-401）；0x05「服务端收到 0x04 后回给客户端」（disco.go:420-423）；0x06「客户端收到 0x05 后回给服务端」（disco.go:442-444）。
- 布局：`type(1B) ‖ ver(1B)=0 ‖ 72B 公共块`，**总长 74B**（三者 AppendMarshal 都以 `bindUDPRelayEndpointCommonLen` 为 dataLen，disco.go:405-409、427-431、448-452）。
- 解析（disco.go:411-418、433-440、454-461）：只做公共块 decode（≥72B），**不检查 version 字节**（与 0x07/0x08/0x09 的 ver≠0 宽松返回不同，见 §5.3 陷阱 P-4）。
- 密封层语义提醒：0x04–0x06 也是走 §1 的 disco wrapper 密封的——VNI 字段注释「this disco-sealed value」（disco.go:355-356）即为证；relay 服务端在数据面用它做防篡改一致性校验。

### 3.3 公共结构 `UDPRelayEndpoint`（124B + 18N，0x07/0x09 载荷体）

常量 `udpRelayEndpointLenMinusAddrPorts = DiscoPublicRawLen + DiscoPublicRawLen*2 + 8 + 4 + 8 + 8 = 32+64+8+4+8+8 = 124`（disco.go:539-544）；端点条目复用 `epLength = 16+2 = 18`（disco.go:219）。字段序 = `encode` 写出序（disco.go:566-591）：

| 偏移 | 长度 | 字段 | 编码 | 语义（原文行号） |
|---|---|---|---|---|
| 0 | 32 | ServerDisco | 原始 32B | relay 服务端的 disco 公钥（disco.go:550-551） |
| 32 | 32 | ClientDisco[0] | 原始 32B | 两个参与客户端的 disco 公钥（disco.go:552-553） |
| 64 | 32 | ClientDisco[1] | 原始 32B | ↑ |
| 96 | 8 | LamportID | u64 BE | `net/udprelay/endpoint.ServerEndpoint.LamportID` 的镜像（disco.go:554-555）；推进规则在未归档包内（§9） |
| 104 | 4 | VNI | u32 BE | 同上镜像（disco.go:556-557） |
| 108 | 8 | BindLifetime | u64 BE | Go `time.Duration` 纳秒数（disco.go:558-559，编码 :580-581） |
| 116 | 8 | SteadyStateLifetime | u64 BE | 同上（disco.go:560-561，编码 :582-583） |
| 124 | 18×N | AddrPorts[] | 16B IP（v4 用 v4-mapped）‖ u16 BE 端口 | relay 服务端的 UDP 端点候选列表（disco.go:562-563）；解码做 `Unmap()`（disco.go:613-621） |

该结构「同时被 0x07 CallMeMaybeVia 与 0x09 AllocateUDPRelayEndpointResponse 携带」（disco.go:546-548）。

`decode` 校验（disco.go:593-598）：`len(b) < 124+18` **或** `(len(b)-124) % 18 != 0` → `errShort`——即**至少要有一个 AddrPort**（N ≥ 1）。

### 3.4 0x07 CallMeMaybeVia

- 语义（disco.go:625-639 原文）：**仅经 DERP 发送**，请求对端尝试打开经中继（通常是 `net/udprelay.Server`）的回程路径；使用其中候选路径前需要 0x04/0x05/0x06 三次握手；**直连路径（CallMeMaybe 通告的）优先级高于 CallMeMaybeVia 路径**（disco.go:636-639）；对端若对现有路径满意可以选择不回应。
- 布局：`type(1B) ‖ ver(1B)=0 ‖ 124B UDPRelayEndpoint ‖ 18×N AddrPorts`，**总长 2+124+18N**（AppendMarshal，disco.go:644-649）。
- 解析（disco.go:651-658）：`ver != 0` → 返回**空** CallMeMaybeVia 且**无错误**（宽松忽略）；否则走 UDPRelayEndpoint.decode（≥142B 且 18 对齐，N≥1）。

### 3.5 0x08 AllocateUDPRelayEndpointRequest

- 语义（disco.go:463-473 原文）：**仅经 DERP 发送**，向 `net/udprelay.Server`（peer-relay 部署下即对端/第三方节点上跑的 relay 服务）请求分配 relay 端点；`ClientDisco` 是**允许与该端点握手**的两个客户端 disco 公钥；`Generation` 是分配请求代次，**服务端必须在 0x09 中回显**以便客户端做请求-响应对齐。
- 布局：`type(1B) ‖ ver(1B)=0 ‖ ClientDisco[0](32B) ‖ ClientDisco[1](32B) ‖ Generation(u32 BE)`；常量 `allocateUDPRelayEndpointRequestLen = 32*2+4 = 68`（disco.go:475-478），**总长 70B**（AppendMarshal 顺序见 disco.go:480-489）。
- 解析（disco.go:491-505）：`ver != 0` → 返回**零值**请求且无错误；载荷 < 68B → `errShort`。

### 3.6 0x09 AllocateUDPRelayEndpointResponse

- 语义（disco.go:507-515 原文）：**仅经 DERP** 回应 0x08；`Generation` 必须**回显** 0x08 的值（disco.go:510-513）；内嵌完整 `UDPRelayEndpoint`（ServerDisco、双方 ClientDisco、LamportID、VNI、两条 lifetime、服务端 AddrPorts）。
- 布局：`type(1B) ‖ ver(1B)=0 ‖ Generation(u32 BE) ‖ 124B UDPRelayEndpoint ‖ 18×N`，**总长 130+18N**（AppendMarshal：先写 Generation，再 `UDPRelayEndpoint.encode`，disco.go:517-524）。
- 解析（disco.go:526-537）：`ver != 0` → 空响应无错误；载荷 < 4B → `errShort`；随后对剩余部分走 UDPRelayEndpoint.decode（可再抛 `errShort`）。

---

## 4. 收发状态机

### 4.1 bind 三次握手状态机（上游唯一在档状态机，disco.go:312-338）

`BindUDPRelayHandshakeState` 枚举（iota 序，客户端/服务端两角色混用一个枚举，原文注释照录）：

| 值 | 常量 | 角色 | 进入时机 |
|---|---|---|---|
| 0 | `BindUDPRelayHandshakeStateInit` | 双方 | 任何报文发送前的初始态（disco.go:319-321） |
| 1 | `BindUDPRelayHandshakeStateBindSent` | 客户端 | 发出 0x04 后的第一态（disco.go:322-324） |
| 2 | `BindUDPRelayHandshakeStateChallengeSent` | 服务端 | 收到 0x04 并回出 0x05 后（disco.go:325-328） |
| 3 | `BindUDPRelayHandshakeStateAnswerSent` | 客户端 | 收到 0x05、回出 0x06 后（disco.go:329-332） |
| 4 | `BindUDPRelayHandshakeStateAnswerReceived` | 服务端 | 收到**正确的** 0x06 后（disco.go:333-337） |

状态转移图（由上行号直接导出）：

```
客户端: Init --发0x04--> BindSent --收0x05,发0x06--> AnswerSent
服务端:          收0x04,发0x05--> ChallengeSent --收正确0x06--> AnswerReceived
```

「正确」的判定要素（可证的仅限这些）：Answer 必须回显 Challenge（disco.go:364-366），四个公共字段在握手全生命周期应保持一致（`BindUDPRelayEndpointCommon` 的文档句「All 4 field values are expected to be consistent for the lifetime of a handshake」，disco.go:348-351）；服务端如何校验 disco 密封、是否比对 RemoteKey 与 ClientDisco——**在未归档的 net/udprelay 内，不可证（§9），不要杜撰**。

### 4.2 全家族消息级协议流（每步都有一手注释证据）

peer-relay 一次完整建立（A=发起客户端，B=对端客户端，R=担当 relay 服务端的节点）：

1. A →(DERP)→ R：0x08 Allocate 请求（「sent only over DERP」，disco.go:463-465）。peer-relay 部署下 R 是志愿节点：tailcfg.go:171（capability 120 注释「implements peer client and relay server functions」）+ Hostinfo.PeerRelay 上报（tailcfg.go:965「if the client is willing to relay traffic for other peers」）。
2. R →(DERP)→ A：0x09 Allocate 响应（disco.go:507-509），Generation 回显（disco.go:469-473、510-513），携带 `UDPRelayEndpoint`（含 R 的 ServerDisco 与 UDP AddrPorts）。
3. A →(普通 UDP，目的=R.AddrPorts[])→ R：0x04 Bind（disco.go:399-401）；状态 Init→BindSent。RemoteKey 填 **B** 的 disco 公钥（disco.go:361-363「the disco key of the remote peer participating over this relay endpoint」）。
4. R →(UDP)→ A：0x05 Challenge（disco.go:420-423）；服务端 ChallengeSent。
5. A →(UDP)→ R：0x06 Answer（回显 Challenge，disco.go:442-444）；客户端 AnswerSent / 服务端 AnswerReceived（disco.go:333-337）。B 对 R 做对称的 0x04–0x06（ClientDisco[0]/[1] 就是为此把两个客户端关联到同端点，disco.go:466-468、552-553）。
6. A →(DERP)→ B：0x07 CallMeMaybeVia，携带同一 `UDPRelayEndpoint`（「carried in both CallMeMaybeVia and AllocateUDPRelayEndpointResponse」，disco.go:546-548；「sent only over DERP」，:625-628）。B 也可走 1–5 后回发 0x07。
7. 双方按需经 R 的 UDP 端点做 WireGuard 数据面（VNI 属 Geneve 封装，disco.go:354-357）；**直连优先于 relay 路径**（disco.go:636-639）。

角色不对称的线索：`DiscoPublic.Compare` 的注释明确「situations requiring only one node in a pair to perform some operation, e.g. probing UDP path lifetime」（key-disco.go:179-185；成对排序容器 `SortedPairOfDiscoPublic` :86-108）——即"两端中字典序较小者负责探测/保活"这类职责分配在上游是按 disco 公钥字典序决定的；**具体哪种操作归谁，除该注释外无在档细则，实现保活职责时可按此语义自行裁定并在代码留痕**。

### 4.3 Parse 分发与错误路径（disco.go:81-109）

- 分发按 1 字节 type switch 到 9 个 parse 函数（disco.go:86-105）；**未知类型 → `unknown message type 0x%02x` 错误**（disco.go:106-108）。这就是旧客户端收到新类型即丢弃的兼容路径（配合 disco.go:18「ignore bytes at the end」）。
- `errShort`（disco.go:58）为各 parse 的长度错误。各类型的最短载荷与 ver 宽松语义汇总：

| 类型 | ver≠0 时 | 长度不足时 | 证据 |
|---|---|---|---|
| 0x04/0x05/0x06 | **不检查**（照常解析） | <72 → errShort | disco.go:411-418/433-440/454-461 + 384-397 |
| 0x07 | 返回空消息、**无错** | <142 或非 18 对齐（N≥1 才合法）→ errShort | disco.go:651-658 + 593-598 |
| 0x08 | 返回零值消息、**无错** | <68 → errShort | disco.go:491-505 |
| 0x09 | 返回空消息、**无错** | <4 → errShort；其后 decode 可再 errShort | disco.go:526-537 |

- 注意：**密封内层长度不足 2B（无 type/ver）**在 `Parse` 顶部统一 `errShort`（disco.go:82-84）。

---

## 5. 与 relay/DERP 的关系

### 5.1 通道矩阵（本节结论全部已在上文给出行号）

- **经 DERP 的**（0x03/0x07/0x08/0x09）：这些 disco 密封包作为不透明字节，装进 DERP `SendPacket` 帧发往对端。DERP 的寻址键是 **node 公钥**：`func (c *Client) Send(dstKey key.NodePublic, pkt []byte)`（docs/upstream/ts-main/derp_client.go:254-257；服务器按 `lookupDest(dstKey)` 转发，derpserver.go:1409-1418、1470-1501）。
- **不经 DERP 的**（0x04/0x05/0x06）：在客户端与 relay 服务端之间的**普通 UDP** 上直接交换（0x04 文档「towards UDP relay server」，disco.go:399-401；服务端实现是 `net/udprelay` 的 Server，disco.go:314-315）。0x01/0x02（ping/pong）走对端 UDP 端点或 DERP（Pong 语义同 STUN 响应，disco.go:249-252）。
- **键空间分离是硬事实**：DERP 寻址/订阅用 nodekey（derp_client.go:254-257）；disco 密封与 wrapper 内的 `senderDiscoPub` 用 discokey（disco.go:11；key-disco.go:17-28 前缀 `discokey:`）。nodekey↔discokey 的对应关系来自 netmap（tailcfg.go:388-392 Node.Key/Node.DiscoKey 两字段并列；本仓取证 docs/oracle/protocol-notes.md:119-124 同证）。
- DERP 层与 disco 层的先后：DERP 只是承载；收到 RecvPacket 后由 disco 层判 wrapper、用**自己的 disco 私钥**解 box、再按 type 分发。0x04–0x06 与 0x08–0x09 的差别只在「对端是谁」——前者对端是 relay 服务端节点，后者对端是 tailnet peer，两者都可能先经 DERP 或 UDP 到达，**类型分发不依赖通道**。

### 5.2 控制面钩子（capability / 开关 / 展示）

- capability 120（2025-07-15）：「Client understands peer relay disco messages, and implements peer client and relay server functions」；capability 121（2025-07-19）：「Client understands peer relay endpoint alloc with [disco.AllocateUDPRelayEndpointRequest] & [disco.AllocateUDPRelayEndpointResponse]」（tailcfg.go:171-172）。当前 `CurrentCapabilityVersion = 148`（tailcfg.go:200）——本仓 control 包 tailcfg 层已按 148 对齐（docs/architecture.md §10.2 AU3）。
- peer 能力：`PeerCapabilityRelay = peercap.Relay`、`PeerCapabilityRelayTarget = peercap.RelayTarget`（tailcfg.go:1620-1621），存于 `PeerCapMap`（tailcfg.go:1678）。**字面量串在未归档的 peercap 包里，本仓不可证**（§9）。
- 节点开关：`NodeAttrDisableRelayServer` / `NodeAttrDisableRelayClient`（tailcfg.go:2559-2560，字面量同样在未归档的 nodecap 包）。
- 自愿声明：`Hostinfo.PeerRelay bool`（tailcfg.go:965）。
- 观测/展示：`PingResponse.PeerRelay` 形如 `"{ip}:{port}:vni:{vni}"`（tailcfg.go:1962-1964）；`PingType = "disco"`（tailcfg.go:1878-1879）；`Endpoint`（直连时 "{ip}:{port}"，:1958-1960）与 `DERPRegionID/Code`（走 DERP 时，:1966-1973）三者互斥地刻画一条路径的归属。
- 键变更增补路径：`PeerChange.DiscoKey`（tailcfg.go:3058-3060）——discokey 可在运行期经 netmap patch 下发，缓存 peer discokey 必须支持热更新。
- WireGuard-only peer 不参与 disco/DERP：「not expected to speak Disco or DERP」（tailcfg.go:544-547）。
- 本仓历史取证佐证：被观测 tailnet 中 `peer-relay-servers.json = []`、disco 计数器只有 ping/pong/callmemaybe 非零（docs/oracle/protocol-notes.md:225-227）——即真实环境里 relay 家族是「在野但低频」的面，二期实现后应能被静默丢弃路径覆盖。

---

## 6. 与本仓现有实现的衔接点（只读盘点）

1. **类型码表**：`packages/disco/src/messages.ts:48-59` 的 `DiscoMessageType` 常量对象（R5 模式，禁 enum）目前只含 0x01–0x03；`messages.ts:21-24` 头注明确「0x04–0x09 …… 本轮不实现——解码层对它们与未知类型一样抛 DiscoError('TYPE')……二期随 UDP relay 扩展」。二期扩表即在此对象加 6 个成员 + 同步 `isSupportedType`（messages.ts:61-64）。
2. **解码载体**：`DiscoDecodedMessage`（messages.ts:248-254）用可空字段模拟联合（ArkTS 无联合类型）；二期需为 6 个新类型各加一个可空字段，或按消息族分两个载体接口。
3. **分发函数**：`discoMessageParse`（messages.ts:260-303）现按 0x01–0x03 三分支；0x04–0x09 加入后走同一 wrapper（`discoOpen`）→ 同一分发点。现错误消息已自带占位提示「0x04-0x09 upstream UDP-relay family not implemented」（messages.ts:268-270）。
4. **密封层零改动**：`wrapper.ts` 的 discoSeal/discoOpen（wrapper.ts:90-149）对 6 个新类型原样可用；naclbox 原语已在 crypto 包与 tweetnacl 互验（wrapper.test.ts:1-18）。
5. **错误码集合**：`DiscoError` code ∈ {'SHORT','TYPE','RANGE'}（errors.ts:4-7）——上游 relay 家族的全部失败路径（errShort/unknown type）都能被这三个 code 表达，无需扩集合。
6. **DERP 承载点**：`DerpClient.sendPacket(dstKey, packet)`（packages/derp/src/client.ts:196-206）= SendPacket 帧 `payload = dstKey(32B) ‖ packet`；接收侧 `receive()` 产出 `DerpClientEvent.RecvPacket{srcKey, packet}`（client.ts:248-267）。0x03/0x07/0x08/0x09 的「only over DERP」在本仓即：`sendPacket(peerNodeKey, discoSeal(...).wrapper)`；`packet` 处进 `looksLikeDisco → discoOpen → discoMessageParse`。注意 subscribePeer 用 **nodekey**（client.ts:322-332）。
7. **UDP 直发承载点**（0x04–0x06 用）：壳侧已有 `UdpDatagramBus` mock 总线（app/bridge/src/mock-udp-bus.ts）与 `ShellDiscoClient`（app/bridge/src/shell-discovery.ts:95-183，poll→归类→自动 Pong 的骨架）；relay bind 握手的确定性集成测试可沿同一形态扩展（真机 socket 由 app 侧注入，D4 零网络，docs/architecture.md:40）。
8. **端点/IP 工具复用**：`ip16IsV4Mapped`/`unmapIp16`（messages.ts:306-324）可直接服务 UDPRelayEndpoint.AddrPorts 的 18B 条目（格式与 CallMeMaybe 完全一致，disco.go:219、585-590）。
9. **u64 槽位**：`ByteReader.readU64be()/ByteWriter.writeU64be(bigint)` 已在 common 冻结 API（docs/architecture.md:75-77、91）——LamportID/BindLifetime/SteadyStateLifetime 按架构裁定 R8 用 `bigint`（docs/architecture.md:55）。
10. **依赖边**：disco 包现依赖 common+crypto（packages/disco/package.json dependencies）；relay 家族不需要新依赖。「经 DERP 发送」的组合发生在调用层（未来 magicsock 形态的模块），**disco 包本身不得 import derp**（D2 禁跨支边，docs/architecture.md:38）。
11. **AU 清单同步义务**：新条目按 TASK.md B-3 记入 docs/architecture.md §10.2（现有 AU1–AU4 形态，docs/architecture.md:535-540）。

---

## 7. 实现陷阱清单（给 S-执行）

- **P-1 端序**：disco 密封内层**全部大端**（u16/u32/u64 均 BE，见 §3 各表）；同仓 wireguard 包报文是**小端**（docs/architecture.md:247「所有整数小端」）。两个包并排写时极易串味。
- **P-2 u64 → BigInt**：LamportID、BindLifetime、SteadyStateLifetime 都是 u64 BE；Duration 是**纳秒**（Go time.Duration），日常值如 120s = 120×10⁹ > 2³²，绝不能塞 number 位宽假设；R8/P6 强制 bigint。lifetime 的**缺省值/含义**在未归档的 net/udprelay，不要编造（§9）；编解码只做原样搬运。
- **P-3 等长握手报文**：0x04 的 Challenge 字段是**纯填充**，砍掉它会让三种握手报文不等长、破坏上游「ensuring all handshake messages are equal in size」的设计（disco.go:366-369）。
- **P-4 version 字节语义不对称**：0x04–0x06 不查 ver；0x07/0x08/0x09 在 ver≠0 时返回**空消息且不报错**（§4.3 表）。本地实现若统一「ver≠0 即抛错」就是语义偏离；若统一「ver≠0 返回空」则又与 Bind 族不符。逐类型照抄。
- **P-5 N=0 端点列表不对称**：0x07/0x09 的 encode 允许任意 N（disco.go:518、645），但 decode 要求 **N≥1**（disco.go:595）。本地测试要覆盖「自己 encode 出的 N=0 报文被自己 decode 拒绝」这一非对称事实，勿把它当 bug 修掉。
- **P-6 键空间混淆**：DERP SendPacket 的 dstKey / subscribePeer 是 **nodekey**；wrapper 头与 box 用 **discokey**。测试里用同一对字节冒充两种键会得出假阴性互操作结论（§5.1）。
- **P-7 Sealed 输出的 nonce 位置**：上游 `DiscoShared.Seal` 输出 = nonce‖box（key-disco.go:225），而本仓把 nonce 放 wrapper 头第 3 段、seal 只出 tag‖密文（wrapper.ts:96-109）——两者字节级等价，但**扩 relay 家族时不得再往 boxOut 前拼一次 nonce**（双拼是照抄上游 Seal 签名时最常见的错）。
- **P-8 未知类型必须可丢弃**：0x0A+ 或对端未来新类型的密封内层报文，按上游走 `unknown message type` 错误路径后被静默丢弃（disco.go:106-108 + disco.go:18）；壳侧 `ShellDiscoClient.poll` 已把 TYPE/SHORT 归为 None 事件（宽松语义注释 app/bridge/src/shell-discovery.ts:118-121，poll 本体 :123 起），relay 家族上线后**不得**改成抛穿轮询循环。
- **P-9 ArkTS 形态**：新消息接口用纯字段 interface（A2）；类型集合走 R5 常量对象 + `parseX` 校验（禁 enum/字面量联合，A18/A34）；解码载体可空字段而非联合（现仓模式，messages.ts:248-254）；全函数显式返回类型（R6/A36）；相对导入带 `.ts`（P2）；disco src 继续**零 node:*、零时钟/随机直读**——Generation 的取值、nonce/txid 的随机性都由调用方经 `Rng`/`Clock` 注入（P4；本仓 wrapper.ts:20 已立此规）。
- **P-10 VNI/Generation 是一致性字段不是本地状态**：客户端实现只负责「新握手取新非零 Generation」（disco.go:358-360）与原样回显/比对；对 VNI 不匹配做任何"自动纠正"都是无证据的自创行为（disco.go:354-357 只定义了"必须一致"）。
- **P-11 测试锚定方式**：现仓测试把上游 marshal 代码逐字段翻成 hex 断言（messages.test.ts:1-8 的做法）。relay 家族没有官方 KAT 向量可用，锚定应：①按 §3 布局表写死整帧 hex 断言（含 BE 端序与 v4-mapped IP）；②encode→decode 往返；③把 §4.3 表中每条 errShort/宽松 ver 行为各立一个中文用例名用例（node:test + node:assert/strict，对齐 TASK.md 纪律 5）。

---

## 8. 与 0x01–0x03 既有语义的连续性对照（防回归）

| 语义 | 0x01–0x03（已实现） | 0x04–0x09（二期） |
|---|---|---|
| 密封 | 同一 wrapper（§1） | 同一 wrapper |
| 类型分发 | discoMessageParse 三分支 | 同函数扩 6 分支 |
| 宽松解析 | Ping 超长计 padding、CMM 畸形返回空表（messages.ts:135-159、217-242，对应 disco.go:169-189、232-247） | ver≠0 空消息、Bind 族不查 ver（§4.3） |
| 端点条目 | 18B ip16+u16be（epLength，disco.go:219） | 同一 epLength（AddrPorts） |
| 通道 | Ping/Pong UDP 或 DERP；CMM 仅 DERP | 0x07–0x09 仅 DERP；0x04–0x06 对 relay 服务端 UDP |

---

## 9. 明确不可证清单（本笔记不写、实现也不得杜撰）

1. `net/udprelay.Server` 内部：端点分配策略、BindLifetime/SteadyStateLifetime 缺省值与到期行为、Challenge 的生成/校验算法、LamportID 推进规则、Geneve 数据面封装细节（唯一在档线索 = disco.go:314-315 的包路径引用与 :354-357 的 VNI 一致性要求）。
2. magicsock 调度：何时触发 0x08、bind 握手的重传/超时参数、relay 路径与直连/DERP 路径的打分择优（「direct 优先」一句除外，disco.go:636-639）。归档 README 已注明该面「未归档但已核对」仅限 wrapper 布局（docs/upstream/2026-10-01-phase2/README.md:18-20）。
3. `peercap.Relay`/`RelayTarget`、`nodecap.DisableRelayServer/DisableRelayClient` 的能力串字面量（tailcfg.go:1620-1621、2559-2560 只引用常量名）。
4. relay 服务端如何用 ServerDisco/ClientDisco/RemoteKey 三把 disco 公钥做握手校验的精确规则（字段语义有档，校验过程无档）。

若二期需要以上任何一条，正确路径是把对应上游文件补入 `docs/upstream/`（TASK.md:36 B-1：对齐笔记含路径+行号归档 docs/upstream/），而不是凭记忆补写（README.md:45 教训条）。

---

## 10. 结论速览

- 0x04–0x09 全部是 peer-relay 协议面：三种 bind 握手（74B 等长帧，客户端↔relay 服务端 UDP）+ CallMeMaybeVia（2+124+18N，仅 DERP）+ Allocate 请求/响应（70B / 130+18N，仅 DERP）。
- 帧层与 0x01–0x03 同构（同一 wrapper/头/分发），本仓 messages.ts 的扩表点、wrapper 零改动结论、DerpClient/UdpDatagramBus 两个承载衔接点都已定位到文件行。
- 状态机以上游 `BindUDPRelayHandshakeState` 五态为准（disco.go:318-338）；全家族消息流有逐条注释证据（§4.2）。
- 服务端语义（net/udprelay）与调度语义（magicsock）不在本仓归档，属不可证区（§9）；二期实现客户端编解码 + 确定性状态机 + DERP 承载已绰绰有余，且每一步都可被本笔记行号锚定。
