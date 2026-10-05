# 项目真实能力基线总文（BASELINE）

# 0. 元信息

- **基准**：git `90ed53e`（`90ed53e20fb998cc6c0005ece9147a3855cd7785`，2026-10-03 11:46:57 +0800，main 分支，本地共 22 个提交）
- **成文日期**：2026-10-03
- **环境**：win32 / Git Bash / node v22.23.2 / npm 10.9.8（本机实测）
- **盘点方法**：三个不同模型族（GLM 5.3 Flash / MiniMax M3.1 Flash / Step Router V1）各自独立完成全仓真实能力盘点并独立提交报告；
  随后另外三个同模型族新 agent 交叉比对三份盘点、对分歧逐条亲测裁决；
  最后由 GLM 5.3 Flash 通读六份报告、**亲自复跑全部权威门禁与关键事实抽验**（第 2 节全部命令为本合并人会话原样执行），
  合并成此文。与六份报告任何不一致处，以本合并人复验为准并在第 10 节末尾汇总注明。
- **六份上游报告**（证据细节去此处查，本文只收结论与关键证据）：
  - 独立盘点：[inventory-glm53-flash.md](inventory-glm53-flash.md) ｜ [inventory-minimax-m31-flash.md](inventory-minimax-m31-flash.md) ｜ [inventory-step-router-v1.md](inventory-step-router-v1.md)
  - 交叉综合：[synthesis-glm53-flash.md](synthesis-glm53-flash.md) ｜ [synthesis-minimax-m31-flash.md](synthesis-minimax-m31-flash.md) ｜ [synthesis-step-router-v1.md](synthesis-step-router-v1.md)
- **验证状态五级口径**（第 3 节使用）：
  1. **实测可用**——本机可复现跑通（本合并人本次亲手执行成功）
  2. **代码+测试通过但未上真机**——实现与测试在盘且本地全绿，但从未接触真机/真实网络
  3. **仅 mock/桥接形态**——只有内存 mock，无真实接线
  4. **仅文档声明**——只有 Markdown 声明，无原始证据可查
  5. **不存在**——文档声称有而实际没有

# 1. 一页结论

**项目真实形态一句话**：这是一套在 Node 环境下被 495+30 个用例钉住的纯 TypeScript 协议核心库
（8 包 72 文件/16904 行 src，密码学原语到控制面状态机逐层有上游向量或交叉验证锚定，本地门禁复跑全绿），
外加一个**从未编译过**的鸿蒙工程壳（322 行 .ets 桩 + 3448 行内存 mock 桥）
和一组只在 2026-09-29 一天真实联通过 headscale v0.29.4 的互操作脚本（无原始证据入仓，且回归脚本当前形态必败）。
「协议正确性」有较强的本地证据；「能在鸿蒙上跑、能连真实网络」**没有任何本次可验证的证据**。
门禁体系整体有实效但带真实缺口：typecheck:bridge 红灯被 CI 盲区掩盖、CI 的 D4 机检脚本自初版起就是坏的。

**能力基线速览**：

| 面 | 真实状态 | 一句话定性 |
|---|---|---|
| 协议核心库 packages/ 8 包 | 495 用例本地全绿（本合并人复跑 495/0，exit 0） | 站得住，但只对过向量和交叉验证，从未对真实对端 |
| app/bridge mock 桥 | 30 用例全绿（复跑 30/0），但 typecheck:bridge 红灯 exit 2 | 运行时绿、类型红，全部是内存 mock |
| app/ 鸿蒙壳 | 66 项静态机检全绿（复跑 66/0），零构建产物，VPN 桩空数组 | 配置骨架，从未编译，真机距离最远的一段 |
| 互操作 interop/ | regress 复跑 exit 1 必败（三重脚本缺陷）；09-29 PASS 仅文档转引 | 历史可能为真，当前不可复现也不可复跑 |
| 安全实证 upload_server | 单元 8/8 + 集成 7/7（复跑 exit 0），CI 常驻 G0-6 | 全仓最强的真代码实证 |
| 性能 x25519 | 复跑 4.0502 ms/op；七样本区间 3.51–4.10 | Node 侧数字，真机 ArkTS 无任何数据 |
| CI 门禁 | 六 step 本地等价全绿；但 D4 段脚本语法死 + typecheck:bridge 不在门内 | 门禁比宣传的弱：一段从未运行、一门从未入册 |
| 文档口径 | README/CONTEXT/HARMONY_AGENT_TASK/DELIVERY_REPORT 至少 8 处实质漂移 | 读文档会得出错误结论，以本文第 6 节为准 |

# 2. 权威实测记录（本合并人 2026-10-03 本机复跑，数字以此为准）

## 2.1 `git rev-parse --short HEAD`

```
90ed53e        （node v22.23.2 / npm 10.9.8）
```

基准确认，与六份报告一致。

## 2.2 `npm test`（G0-1）

```
1..495
# tests 495
# suites 0
# pass 495
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 6000.383
NPM_TEST_EXIT=0
```

**495/0，exit 0。** 逐包复跑：common 40 / crypto 35 / noise 39 / wireguard 60 / derp 58 / disco 38 / control 141 / netcheck 84，
合计恰为 495（netcheck 84 为准；GLM 盘点表格误写 64，经 MiniMax 综合裁决与本合并人复跑证实为 84）。

## 2.3 `npm run typecheck`（G0-2）

```
> tsc --noEmit -p .
TYPECHECK_EXIT=0        （零输出零错误）
```

**exit 0。** 注意此门只覆盖根 tsconfig（packages/**），不含 app/。

## 2.4 `npm run typecheck:bridge` —— 真实红灯（预期 exit 2，亲自确认）

```
> tsc --noEmit -p app/bridge
app/bridge/test/peerapi-tun.test.ts(246,5): error TS2353: Object literal may only
specify known properties, and 'selfAddresses' does not exist in type 'DnsAnswerFn'.
TC_BRIDGE_EXIT=2
```

**这是门禁体系当前唯一真实红灯。** 根因链（本合并人抽验三处吻合）：
- `app/bridge/test/peerapi-tun.test.ts:81` — `makePeerServer = (answerDns: MockPeerApiConfig['answerDns'])`（单参 helper）
- `app/bridge/test/peerapi-tun.test.ts:245` — 末例「ExitDNS：name 跨包污点边界」却传整包 config 字面量（含 `selfAddresses` 等字段）
- `app/bridge/src/mock-peerapi.ts:60` — `DnsAnswerFn = (name, qtype) => DnsResolveOutcome`，无 `selfAddresses`
- 引入者：`git log -S"selfAddresses"` 唯一命中 **e136900**（安全修复 commit）；5c3db5e 加独立断言未修签名
- CI（g0-gates.yml 六 step）**不含此命令**——红灯无门禁拦截；运行时 30/30 仍绿（畸形 q 的 400 校验先于 answerDns 调用，错位传参运行时无害）——运行时行为与类型契约已分叉

## 2.5 `npm run test:bridge`（G0-3）

```
# tests 30
# pass 30
# fail 0
# duration_ms 964.5815
TEST_BRIDGE_EXIT=0
```

**30/0，exit 0。** 4 个测试文件：bridge 7 + disco-netcheck 6 + localapi 8 + peerapi-tun 9 = 30。

## 2.6 `npm run validate:shell`（G0-4）

```
[PASS] V9 bridge index exports C3 wiring — C3 三面（LocalAPI/PeerAPI/TUN）经 barrel 对壳可见
summary: 66 passed, 0 failed
VALIDATE_SHELL_EXIT=0
```

**66/0，exit 0。** V1–V9 九组静态机检；V9（12 条 bridge 纪律检）为 1c9b85b 新增，54+12=66。

## 2.7 `npm run interop:test:upload`（G0-6）

```
[1] 单元层（修复后判定）：8 pass / 0 fail（共 8 条攻击向量）
[1] path.resolve 二次校验：4 条全部判定正确 ✓
[2] 集成层：直接调 upload_server.H.do_POST
[2] inbox 落盘文件（Python 视角，已用 os.listdir 同进程读取）：["x.bmp"]
[2] 集成层：7 pass / 0 fail（共 7 条）
=== upload_server.py 路径穿越防御实证 PASS（单元 + 集成） ===
UPLOAD_EXIT=0
```

**8+7 全过，exit 0。** fcaf962 修复（unquote 顺序 + 显式拒 `/`、`\`、`\x00` + realpath 二次锚定）的实证闭环。
注：集成层为 importlib 直调 `H.do_POST`，非起真 HTTP server（测试文件自身头注释「13 条/curl」为改前残留，实为 8 条）。

## 2.8 `npm run perf:baseline`

```
scalarMult  200 次取均值（预热 20 次）
  mean=4.0502 ms/op (~246.9 ops/s)
  p50=4.0785 ms  p95=4.8402 ms  p99=5.0857 ms
基线 09-29: 5.25 ms/op ~190 ops/s（同一测法；本机 win32 / Node v22.23.2）
vs 基线：0.77× （快22%）
PERF_EXIT=0
```

**exit 0。** 本样本 4.0502 ms/op 落在既有六样本区间 3.51–4.10 内，正确读法见 3.4。

## 2.9 CI G0-5 脚本复跑（两件事分开记录）

**（a）原样复跑**（把 yml 的 run 块逐字喂给 bash）：

```
$ sed -n '69,87p' .github/workflows/g0-gates.yml | bash
--- P4: Date.now / Math.random（非注释行）---
--- P4/D4: 非测试源码 node: 导入 ---
--- D4: 网络/builtin 特征（仅 src） ---
bash: line 15: syntax error near unexpected token `(' while looking for matching `)'
G0_5_VERBATIM_EXIT=2
```

第 15 行即 yml:83 的 D4 grep：`'…from ['\"](net|…)['\"]'` 单引号内嵌 `'` 提前闭合，`(net|…)` 裸露成语法错误。
**D4 段自初版 51b70c3 即坏、从未在 CI 真正执行过（5c3db5e 只修了过滤器没修引号）——亲自确认 exit 2。**
远端 Actions 该 step 应同样变红，但远端实际状态无 gh/网络不可查，此为同 bash 语义的本地推定。

**（b）修正引号的等价 grep**（与 yml 同过滤器、同检索面）：

```
P4_hits=0        （原始 4 条全在注释：common/src/clock.ts:2/:5、random.ts:2、derp/src/region.ts:16）
NOD_hits=0       （原始 103 条，103 条全部位于 .test.ts: 文件）
D4_hits=0        （原始即 0；另验 packages/*/src 内 from 'node:' 文件数 = 0）
```

**代码面 D4/P4 干净为真。正确表述必须两句并写：门禁脚本坏 + 代码面干净，不可只说一半。**

## 2.10 `npm run interop:regress` —— 按预期失败（exit 1）

```
>>> 阶段：控制面注册（RegisterRequest + MapRequest）
FAIL: connect ECONNREFUSED 127.0.0.1:8080
>>> 阶段：DERP 客户端 + Ping/Pong
FAIL: usage: node --experimental-strip-types interop/derp.node.ts <baseUrl> <authKey>
>>> 阶段：HTTP/2 over Noise（h2c）
（零输出）
=== 判定字符串 ===
INTEROP FAIL
DERP INTEROP FAIL
REGRESS_EXIT=1
```

失败性质三层（不能一概归为环境缺失）：
- 阶段 1：ECONNREFUSED 属**环境缺失**（本机无 headscale）；且 `regress.mjs:52` 硬编码假 preauthkey `'regress-dummy-preauthkey'`，有真 headscale 也会被 401 拒——**脚本缺陷**
- 阶段 2：`regress.mjs:54-56` 给两参的 derp.node.ts（:37-40 需 `<baseUrl> <authKey>`）只传 1 参——**与 headscale 无关必败**（注：MiniMax 盘点写行号 59-61 有误，正确为 54-56，经 MiniMax 综合勘误与本合并人亲读确认）
- 阶段 3：调 h2c.node.ts，但该文件仅 :29 `export class H2OverNoise`、无 CLI 入口（grep process.argv = 0），exit 0 且 stdout 空，被 runStage 的非空判据静默判负——**脚本缺陷**

**结论：任何 headscale 环境下都不可能输出 INTEROP PASS。**

## 2.11 补充抽验（与六份报告对齐处不再单列）

- 规模：`find packages -path '*/src/*' -name '*.ts'` = **72 文件 / 16904 行**；test = **49 文件 / 13170 行**；逐包 src 文件数 9/8/7/10/6/5/17/10（=72）。
- `node interop/arkts-check.js .` → `ReferenceError: require is not defined in ES module scope`，**exit 1**（根 package.json `"type":"module"` 与文件内 `require` 的 ESM/CJS 冲突；第二层阻塞是硬编码 WSL SDK 路径 `/home/dev/sdk/...`）。
- `git log --oneline -1 -S"selfAddresses" -- app/bridge/test/peerapi-tun.test.ts` → **e136900**。
- `git show ec5b99f:app/bridge/test/peerapi-tun.test.ts | grep -cE '^\s*test\('` = 8；HEAD 同法 = 9 —— 29→30 时序钉死（5c3db5e 加第 9 个用例）。
- `echo "# fail 0" | awk '{print $7}'` → **空串**（docs-consistency job 的 fail 取值恒空）。
- `git log --all --oneline -- docs/oracle/raw | wc -l` = 0；`ls docs/oracle/` 仅 protocol-notes.md —— oracle/raw 转储从未入 git。
- 壳负面证据：`find app -name '*.hap' -o -name '*.abc' -o -name '*.har'` = 0；app/oh_modules、app/.hvigor、app/build、app/entry/build 均不存在；根 tsconfig `exclude: ["app"]`；VpnExtensionAbility.ets:41-43 三数组全空带 TODO「真实调用会失败」。

# 3. 真实能力基线总表（核心章节）

## 3.0 总限定（适用于全部协议能力）

**packages/ 内无一处真实 socket/TLS/ICMP（D4 设计使然），网络与时钟/随机全部经注入接口；测试证据 = 上游官方向量 / 交叉实现对照 / 仓内自洽断言，从未与真实对端（WireGuard/DERP 服务器/headscale）对拍。** 因此下列协议能力统一为「代码+测试通过但未上真机」级；逐能力的具体限定随行标注。素材取自 GLM 盘点 §7（测试名级清单），经三方交叉核实。

## 3.1 协议能力逐包

### common（40 用例）——底层原语

| 能力 | 状态 | 证据 |
|---|---|---|
| ByteReader/Writer（u8–u64 BE/LE、LEB128、越界防护）；hex；base64（RFC 4648 严格 canonical）；手写严格 UTF-8；FixedClock 双轴单调；ArrayRng（P4 注入接口） | 代码+测试 | bytes 11 + hex 4 + base64 5 + utf8 5 + clock 5 + random 5 + index 3 例 |
| HttpTransport 真实现 | **不存在**（仅接口 + NullBodyStream，D4 使然） | common/src/http.ts |

### crypto（35 用例）——密码学原语（全手写，与 node:crypto 交叉验证）

| 能力 | 状态 | 证据 |
|---|---|---|
| x25519（RFC 7748 §5.2/§6.1 + 迭代向量 + node:crypto diffieHellman 交叉 + 低阶点全零） | 代码+测试 | x25519.test.ts 8 例；性能实测见 3.4 |
| ChaCha20-Poly1305（RFC 8439 全向量 + node:crypto 交叉 + 篡改拒绝）；XChaCha20-Poly1305 + HChaCha20（draft-irtf-cfrg-xchacha-03 §2.2.1 + 附录 A.1 全 KAT） | 代码+测试 | aead 6 + xchacha 5 例 |
| SHA-256 / HMAC / BLAKE2s（RFC 4231 / blake2-kat / CPython 参考）/ HKDF（RFC 5869 TC3）；naclbox（tweetnacl 双向互验）；constTimeEqual / wipe | 代码+测试 | hash 6 + naclbox 5 + util 2 例 |

### noise（39 用例）——Noise IK + controlbase

| 能力 | 状态 | 证据 |
|---|---|---|
| Noise IK 握手 initiator/responder（**cacophony 权威向量逐字节锚定** msgA/msgB/握手哈希/counter=0 密文）；controlbase ts2021（101B initiation 常量、版本 148 prologue、record 帧、4096/4077 上限、错误帧） | 代码+测试 | external-vector + handshake 12 + controlbase 4 例 |
| 帧层（2B BE + 分片/粘包重组）与传输 cipher（BE64 nonce、跨 2^32/2^53+1、篡改不推进计数器） | 代码+测试 | frame 6 + transport 9 + reference 4 + roundtrip 4 例 |
| HTTP/2(h2c) 层 / 完整 controlhttp 客户端状态机 | 不在包内（h2c 仅 interop 胶水；升级握手细节在 control.client/noisehttp） | 结构限定 |

### wireguard（60 用例）——数据面

| 能力 | 状态 | 证据 |
|---|---|---|
| 握手 initiator/responder（148B/92B 字节级向量三重锁定、键调度独立推导、TAI64N）；传输会话（**与 OpenSSL 逐字节对照**、2048 位反重放窗口含 2^31/2^53+1 边界、keepalive） | 代码+测试 | handshake 16 + tai64n 5 + transport 11 例 |
| MAC1/MAC2/CookieCache（白皮书 5.4.4/5.4.7 + wireguard-go 对照）；**Cookie Reply type=3**（64B 编解码 + R_m 120s 轮换）；**type=1/2/3/4 分发器**（under-load 回 Cookie Reply）；WgPeerTable（重键顶替/级联删除） | 代码+测试 | cookie 8 + cookie-reply 8 + dispatch 7 + peers 5 例 |
| 真实 UDP socket / protect / 重键定时器 / 与真实 WG 对端互通 | **不存在** | DELIVERY §2.3 自认从未发生 |

### derp（58 用例）——中继协议

| 能力 | 状态 | 证据 |
|---|---|---|
| 帧编解码（u32BE + 0x01–0x15 码表 + Magic + 1MiB 上限 + 分片/半帧，死字节对照上游 derp.go）；DerpClient 状态机（ServerKey→ClientInfo(naclbox)→ServerInfo、订阅集合、RecvPacket/PeerGone/Ping-Pong/KeepAlive/NotePreferred） | 代码+测试 | frame 14 + client 21 例 |
| region 选择（home 最小延迟/兜底）；**region 级随机兜底 + 节点级按序回退**（对齐 derphttp_client.go:640-650、Lemure rngIntN 区间钉死、firstErr 语义） | 代码+测试 | region 9 + regionpick 14 例 |
| 真实 TLS 拨号 | 注入（DerpDialer）；regiondial.ts 是策略层非网络层 | 结构限定 |
| headscale 实测发现「MeshKey 必须整字段省略」 | 已修入 client.ts，未对真机复验 | DELIVERY §5.3 |

### disco（38 用例）——发现协议

| 能力 | 状态 | 证据 |
|---|---|---|
| 「TS💬」wrapper（secretbox，tweetnacl 双向互验）；Ping/Pong/CallMeMaybe 0x01–0x03（宽松解析语义逐条保留） | 代码+测试 | wrapper 6 + messages 7 例 |
| **relay 家族 0x04–0x09**：Bind 0x04/05/06（74B 整帧 hex 锚）、UDPRelayEndpoint（124B+18N）、CallMeMaybeVia 0x07（非对称如实保留）、Allocate 0x08/09、bind 握手状态机、Generation 注入 Rng | 代码+测试（**仅编解码+状态机**） | relay.test.ts 25 例 |
| UDP relay 数据面接线 | **不存在**——全仓无消费者；control 包不 import disco；peerconn.ts:44 自述属子线不实现 | 结构限定 |

### netcheck（84 用例）——网络探测

| 能力 | 状态 | 证据 |
|---|---|---|
| STUN 编解码（SOFTWARE="tailnode"+FINGERPRINT CRC32、**RFC 5769 §2.2/§2.3 官方向量**、事务配对）；探测计划（v6 轮换、try_harder 0/12/124/186 手算锚、home 强制纳入、sortRegions） | 代码+测试 | stun 8 + plan 19 例 |
| **引擎调度**（端到端回放、重传去抖、3-region 早停、OnlyTCP443/OnlySTUN、UDP 全败回退、captive portal 强制全量、5min 周期、并发重入报错、HTTPS/ICMP 回退合并）；历史窗（305s 边界、每分钟一场不变量） | 代码+测试 | engine 34 + history 23 例 |
| 真实 UDP/ICMP/HTTPS 探测、UPnP/PMP | **不存在**（sender/DNS/PortMapper 全注入）；唯一包外消费者是 bridge mock | 结构限定 |

### control（141 用例）——控制面与语义核心

| 能力 | 状态 | 证据 |
|---|---|---|
| TLV 本地契约层；tailcfg JSON 层（Version=148、MapRequest Stream）；HttpOverNoiseReader；netaddr 前缀算术 | 代码+测试 | tlv 10 + interop 8 + netaddr 9 例 |
| ControlClient 全生命周期（dial/send/receive、跨 chunk+backlog、会话恢复、AEAD 失步重建、65519B 预检、错误路径） | 代码+测试 | client.test.ts 14 例 |
| **netmap 状态机**（全量/增量裁决序、patch 字段级、过期防御破键、ControlTime 偏移、knob 只从 self CapMap）；**netmap→WG 推导**（self 地址/子网路由/exit node/双剪枝/diffWgPeers） | 代码+测试 | netmap 14 + wgderive 11 例 |
| **peer 连接状态机**（bestAddr 信任期 6.5s、心跳 3s/idle 45s、迟滞切换、候选三分支、CMM 防循环、expired 拒发）+ DerpRouteTable（home 迁移门控/60s 回收） | 代码+测试 | peerconn 24 + derproute 例 |
| **LocalAPI 语义**（ipn.State 表、watch mask、handlerForPath、Referer/Origin/Host/BasicAuth 守卫、MaskedPrefs、Notify 编解码）；**PeerAPI**（crc32 端口推导、Services 通告、validate 请求、ExitDNS 授权链）；**MagicDNS**（66 条权威后缀、dnsConfigForNetmap、ResolverCore 决策序、PTR 反解） | 代码+测试（无真实 IPC/HTTP listener） | localapi 14 + peerapi 9 + magicdns 19 例 |
| PacketFilter 四元组执行体 / DNS wire format 打包 / 4via6 合成名 | **不存在**（netmap 仅存在性探测；/dns-query Bytes 以 501 表达） | worklog:32 遗留 |

## 3.2 bridge 集成 / 壳 / interop / perf / 门禁工具

| 能力 | 验证状态 | 证据 |
|---|---|---|
| app/bridge mock 集成层（MockHttpTransport、shell-session、mock-udp-bus + shell-discovery、MockLocalApiServer、MockPeerApiServer、mock-tun 三件 Fake/Wrapper/Cable） | **仅 mock/桥接形态**（30 用例全绿是实测，但全部为内存 mock，真机数据面为零） | test:bridge 30/0（复跑）；**typecheck:bridge exit 2——该层类型契约当前是红的** |
| app/ 鸿蒙工程壳（配置 + 3 个 .ets 322 行 + 66 项静态机检） | **不存在可运行物**：零构建产物、根 tsconfig exclude、VpnExtensionAbility.ets:41-43 空数组桩；到真机还差 DevEco 编译/签名/权限/TUN fd 接线 | find/ls 负面实证（复跑）；壳机检 66/0——实测可用的是**校验器**，不是壳本身 |
| interop 三脚本（register/derp/h2c）真控制面联通 | **仅文档声明（09-29 历史口径）**；本机不可跑（ECONNREFUSED 实测） | interop:regress exit 1（复跑）；regress.mjs 三重缺陷见第 8 节 |
| upload_server.py 路径穿越防御（fcaf962） | **实测可用**（单元 8/8 + 集成 7/7，Python 视角攻击未落盘；CI 常驻 G0-6；集成层为 importlib 直调非真 HTTP server） | interop:test:upload exit 0（复跑） |
| perf x25519 标量乘 | **实测可用**（脚本本机可复现；数字是 win32/Node22 的 BigInt 实现，与真机 ArkTS 运行时无关） | 4.0502 ms/op（复跑），见 3.4 |
| CI 六门本地等价命令 | **实测可用**（D4 段除外：脚本本身语法死，等价 grep 证明代码面干净） | 第 2 节 |
| 09-29 INTEROP PASS + DERP INTEROP PASS | **仅文档声明**（仓内无任何原始证据文件） | README:48、DELIVERY §5.2–5.5；oracle/raw 从未入 git（复验）；evidence/ 不存在 |
| 官方 ArkTS linter src 告警 154→0（09-29） | **仅文档声明（物证在盘未复跑）** | docs/arkts-linter-report-raw.txt 270 行在盘（头行 diagnostics: 477）；复跑需 WSL+SDK；arkts-check.js 本机 exit 1 加载即崩 |
| CI 在 GitHub Actions 上的远端真实运行状态 | **仅文档声明（本地不可查，无 gh/网络）** | yml 在盘逐行读；远端六 step 真实红绿不可证 |

## 3.3 明确「不存在」清单（文档声称有或容易误读为有的）

- `docs/oracle/raw/` 17 份转储（DELIVERY_REPORT:78/:151 引用）——目录不存在且从未入本地 git 历史
  （「曾存在后被 filter-repo 剥离」与「从未提交」两说并存，本地无法分辨）；`evidence/` 证据目录同不存在。
- disco 0x04–0x09 的 UDP relay 数据面接线（peerconn.ts:44 明示不实现）。
- PacketFilter 四元组过滤执行体（netmap 仅存在性探测）。
- DNS wire format（dnsmessage 打包，DoH Bytes 以 501 表达）、4via6 合成名。
- 任何真实 socket/TLS/ICMP 实现层（packages/ 内全为注入接口）。
- app/ 的任何构建产物与可安装 HAP。
- 与真实 WireGuard 对端、真实 DERP 服务器、真实 headscale 的**当前可复现**互通（仅 09-29 一次性历史声明）。

## 3.4 perf x25519 的正确读法

七个独立样本（win32 / Node v22.23.2 / 200 iter / 20 warmup / 注入真实 node:crypto 随机源 / sink 防 DCE）：

| 样本来源 | mean ms/op |
|---|---|
| GLM 盘点（两次） | 4.0098 / 4.0978 |
| MiniMax 盘点 | 3.5723 |
| Step 盘点 | 3.8325 |
| GLM 综合 | 3.5089 |
| MiniMax 综合 | 3.6617 |
| Step 综合 | 3.9816 |
| **本合并人** | **4.0502** |

区间 **3.51–4.10 ms/op（约 247–285 ops/s）**，极差约 17% 属共享 Windows 机器负载波动。
README 单点 3.62（commit 0962ada 时点）落在区间内，**可保留为代表性值但须注明方差**；
09-29 基线 5.25 为同机同测法纵向比较（快 22–33%），跨机不可比；该数字与真机 ArkTS 运行时性能无关（真机零数据）。

# 4. 组件明细

## 4.1 packages/（8 个 npm workspace 包，依赖单向无环）

| 包 | src 文件/行 | 测试文件/行/用例 | 职责 |
|---|---|---|---|
| common | 9 / 747 | 7 / 524 / 40 | 字节/编码/时钟/随机注入/HTTP 抽象/常量 |
| crypto | 8 / 1354 | 6 / 1001 / 35 | x25519、AEAD 族、哈希族、naclbox（全手写，与 node:crypto 交叉验证） |
| noise | 7 / 898 | 7 / 1881 / 39 | Noise IK + controlbase ts2021 + 帧层 + 传输 cipher |
| wireguard | 10 / 1952 | 7 / 2074 / 60 | WG 握手/传输/反重放/Cookie Reply/分发/peer 表 |
| derp | 6 / 977 | 4 / 1302 / 58 | DERP 帧编解码/客户端状态机/region 策略 |
| disco | 5 / 1385 | 3 / 797 / 38 | wrapper + 0x01–0x03 + relay 0x04–0x09（编解码+状态机） |
| control | 17 / 7303 | 11 / 3697 / 141 | TLV/tailcfg/netmap/wgderive/peerconn/derproute/localapi/peerapi/magicdns/noisehttp |
| netcheck | 10 / 2288 | 4 / 1894 / 84 | STUN/探测计划/引擎调度/历史窗/报告聚合 |
| **合计** | **72 / 16904** | **49 / 13170 / 495** | 用例逐包之和恰为 495（本合并人复跑） |

注：control 实际只 import common(8 处)/noise(1)/crypto(1)，对 disco/wireguard 的依赖边预留未用；
control 包测试密度最低（3697/7303≈0.51×）而恰是二期功能最密集处（MiniMax 盘点观察，采信）。

## 4.2 app/（37 个文件）

- 结构：AppScope + 工程级配置（build-profile/hvigorfile/oh-package/hvigor-config）+ entry（module.json5、3 个 .ets 共 322 行、资源 5 件）+ bridge（src 10 文件 2274 行 + test 4 文件 30 用例 + tsconfig）+ tools/validate-shell.mjs（V1–V9 共 66 检）。
- **从未编译**（负面证据实证，三方一致 + 本合并人复验）：零构建产物/产物目录、根 tsconfig `exclude: ["app"]`、VpnExtensionAbility.ets:41-43 三数组（addresses/routes/dnsAddresses）全空带 TODO「真实调用会失败——桩仅示意流程」。
- bridge 是壳↔库唯一活动面，全部为内存 mock。66 项机检覆盖静态资源一致性：V1 配置可解析(14)/V2 ability 在盘(4)/V3 权限(2)/V4 路由(2)/V5+V5b 资源对账(27)/V6 bundleName(1)/V7 VPN ability 名(1)/V8 图标尺寸(3)/V9 bridge 纪律(12，1c9b85b 新增，54+12=66)。

## 4.3 interop/（12 个文件）与 scripts/

- **本机可跑**：upload_server.py + upload_server.test.mjs（G0-6 实证，exit 0）；scripts/perf-baseline.mjs（exit 0，scripts/ 全仓唯一纯本机可复现数字的目录）。
- **需 headscale + 有效 preauthkey**：regress.mjs（编排器，当前三重缺陷必败）、register.node.ts / derp.node.ts（各需 2 参 CLI）、
  h2c.node.ts（纯模块无 CLI）、start-headscale.sh + headscale.yaml（隔离实例配置）。
- **本机不可执行**：arkts-check.js（ESM/CJS 冲突 exit 1 + 硬编码 WSL SDK 路径）、arkts-mirror.sh（依赖前者）。

## 4.4 CI（.github/workflows/g0-gates.yml）

- job `g0`（ubuntu+windows 双矩阵，fail-fast: false，shell: bash）：npm ci → G0-1 test → G0-6 upload 实证（setup-python 3.11）
  → G0-2 typecheck → G0-3 test:bridge → G0-4 validate:shell → G0-5 D4/P4 机检。六个 step 本地等价命令全绿（D4 段脚本本身语法死）。
- job `docs-consistency`（ubuntu）：抓真实数字后仅 `grep -q` 检查四个文档「含不含」，warning 不阻断——能力严重受限（第 5.2 节）。
- 文件名/注释仍自称「G0 五门」，实际六 step（G0-6 由 fcaf962 新增后注释未更新）——低危命名漂移。

# 5. 门禁体系健康度

## 5.1 CI 覆盖矩阵（以本地等价复跑为准）

| CI step | 本地等价结果 | 覆盖评估 |
|---|---|---|
| G0-1 npm test | 495/0 exit 0 | 有效，双平台 |
| G0-6 interop:test:upload | 8+7 exit 0 | 有效（唯一测真外部代码的门） |
| G0-2 typecheck | exit 0 | 有效，但只覆盖 packages/**（根 tsconfig exclude app） |
| G0-3 test:bridge | 30/0 exit 0 | 有效（运行时） |
| G0-4 validate:shell | 66/0 exit 0 | 有效（静态） |
| G0-5 D4/P4 | **原样脚本 exit 2**；P4/node: 两段有效 0 命中；D4 段语法死从未执行 | **半死** |
| （无此 step）typecheck:bridge | **exit 2（红）** | **不在门内——唯一真实红灯无人拦截** |
| （不设门）interop:regress / perf | — | 明确不跑（README:29 自认互操作不设门；perf 不设门） |

## 5.2 四个缺口

1. **typecheck:bridge 不在 CI**：`app/bridge/**` 只有 node --test 运行时一重检查、无编译期检查；
   e136900 引入的 TS2353 因此静默存活（运行时 30/30 仍绿，因 mock 对畸形 q 的 400 校验先于 answerDns 调用——运行时行为与类型契约已分叉）。
2. **G0-5 D4 段脚本死**：yml:83 引号拼接语法错误，自 51b70c3 初版即坏，5c3db5e 只修了 `\.test\.ts:` 过滤器没修引号；
   同 bash 语义下 GitHub Actions 该 step 应 exit 2 变红（远端实际状态无 gh 不可查，此为本地推定）。
   **正确表述必须两句并写：门禁脚本坏 + 代码面干净（等价 grep 0 命中）。**
3. **docs-consistency job 失明**：`awk '{print $7}'` 对 `# fail 0` 恒取空串（本合并人实测）——fail 数从不校验、
   S_PASS/S_FAIL 算了不用；只查「文档含不含实测数字」、不查「是否残留旧数字」；warning 不阻断——
   README 双表并存等全部文档漂移都能过该门。它只防漏写、不防错写。
4. **`grep -v '^\s*//'` 过滤器恒失效**（yml:72）：grep -rEn 输出行以路径开头，行首注释锚点永远匹配不到；
   当前无害（4 条 P4 原始命中被第三条 `grep -v ' \* '` 兜住），但属死代码式脆弱点，改代码时容易误判。

# 6. 文档口径勘误表（读旧文档前先看此表）

| 文档 | 位置 | 现写法 | 正确口径 | 证据 |
|---|---|---|---|---|
| README.md | :35-40 vs :41-46 | 同页两张 G0 表并列：495/30/66 与 280/13/54 | **495/30/66 现行**；280/13/54 为 10-01 过期残留（应删） | 本合并人三门复跑；worklog.md:21,23 佐证旧表时点 |
| README.md | :12 | 「validate:shell 54 用例」 | **66**（同文件 :38 自己也写 66，自相矛盾） | 复跑 summary: 66 passed |
| README.md | :10 | 「约 8400 行」 | **16904 行（72 文件）**，低估一半 | find+wc 实测 |
| README.md | :54「已知问题 3」 | 列 disco 0x04-0x09、netcheck 调度、DERP 随机选点、netmap→WG、状态机、LocalAPI/PeerAPI/MagicDNS 为「二期未做」 | **上述六项已被 1c9b85b 实现并有 +215 测试全绿；仅「TUN 壳层 fd 未接线」属实**（且 0x04-0x09 须带「仅编解码+状态机、无数据面」限定） | git show --stat 1c9b85b；逐包测试复跑 |
| CONTEXT.md | :8 / :28 | 「未纳入 git 管理、无 CI，目录即唯一副本」 | **已 git 化（22 提交）且有 CI（g0-gates.yml 在盘）**——整节世界观过期 | git log / yml 在盘（本合并人复验） |
| CONTEXT.md | :15 | 「test:bridge 29 pass」 | **30**；29 在 ec5b99f 时点为真，属时序漂移非说谎：5c3db5e 在 peerapi-tun.test.ts 增第 9 个用例（8→9）后总数 29→30 | 复跑 30/0；git show ec5b99f 8 例 vs HEAD 9 例（本合并人亲验） |
| HARMONY_AGENT_TASK.md | :9/:49/:82/:88（§0/§4） | 「六包 / 238/238」验收期望 | **8 包 / 495**；按该任务书执行验收必误判为失败（三份盘点全部漏读此文件，经两份综合补验） | 复跑 495；grep 原文 |
| DELIVERY_REPORT.md | :60 | 「control 6 文件 / 1066 行」 | **17 文件 / 7303 行** | find+wc 实测 |

另两处工具注释自陈漂移（低危）：upload_server.test.mjs:10-11 头注释写「13 条向量/curl」实为 8 条/importlib 直调；
validate-shell.mjs 文件头只列 V1–V8、V9 未入。

# 7. 历史证据与不可验证边界

- **09-29 INTEROP PASS 的证据性质**：唯一详述在 DELIVERY_REPORT §5.2–5.5（WSL headscale v0.29.4，注册/地图 + DERP A→B 双向包交换；
  MeshKey 整字段省略为当时实测发现）。仓内**无任何原始证据文件**（evidence/ 不存在；docs/oracle/raw 的 17 份转储从未入 git 历史，本合并人复验）。
  本次复跑 ECONNREFUSED。**采信等级：历史口径**——可作叙事保留，不可作可复现能力引用。
- **oracle/raw 两说并存**：结合 a3642ea「filter-repo 于副本执行」的公开清洗提交，「曾存在后被历史剥离」与「从未提交」本地无法分辨，
  本文按「当前仓内不存在、DELIVERY:78/:151 引用失效」记录；docs/oracle/protocol-notes.md（258 行）的【实测】标注因此只能当二手散文读。
- **上游快照未对拍**：docs/upstream/ts-main 及 phase2 快照（disco.go、stun.go、wg-device-*.go、rfc5769.txt、xchacha draft 等 27 份）在盘，
  但**快照与真上游的 diff 无人做过（本机无网络）**——「测试对齐上游行号」这一核心方法论的最终依据未被独立复核。
- **CI 远端不可查**：无 gh CLI、无网络；「G0-5 在远端会红」是基于同 bash 语义的本地推定，不是既成事实。
- **需真机/DevEco（子线 E 冻结 WAITING_EVENT）**：app/ 首编译（hvigor/DevEco 构建 HAP）、签名安装、VPN 权限授权、TUN fd 真实收发、
  CU2/CU6/CU7/CU8（BigInt 运行时、.ts specifier 是否被 ets loader 接受、平台 Rng/Clock API 签名、hypium 复用 node:test）——
  **任何协议代码在 ArkTS runtime 的真实表现为零数据**。
- **需 headscale+docker（子线 D）**：regress 三阶段真复跑、09-29 PASS 复现（另需有效 preauthkey，且须先修脚本三重缺陷）。
- **需 WSL+华为 SDK**：ArkTS linter 复跑、arkts-check.js 执行（先解决 ESM/CJS 冲突）。

# 8. 已知缺陷清单（按严重度排序；本文只记录不修复）

| # | 缺陷 | 位置 | 影响 | 建议修复方向 |
|---|---|---|---|---|
| 1 | **typecheck:bridge 红灯 TS2353**：单参 helper `makePeerServer`（:81，参数类型 `DnsAnswerFn`）在 :245 被传整包 config 字面量 | app/bridge/test/peerapi-tun.test.ts:246 | app/bridge 类型契约破裂且 CI 不拦（六 step 无此门）；运行时 30/30 假绿掩盖分叉；e136900 引入、5c3db5e 加断言未修 | 修 :245 传参为合法 answerDns 形态；同时把 `typecheck:bridge` 加进 g0-gates.yml（一个 step 五行） |
| 2 | **interop/regress.mjs 三重缺陷**：:52 硬编码假 preauthkey `'regress-dummy-preauthkey'`（真 headscale 必 401 拒）；:54-56 给两参的 derp.node.ts（:37-40 需 `<baseUrl> <authKey>`）只传 1 参（必 usage 退出）；:57-59 调 h2c.node.ts 但该文件无 CLI 入口（仅 :29 export class；exit 0 且 stdout 空，被 runStage「stdout 非空」判据静默判负） | interop/regress.mjs、interop/h2c.node.ts | **任何 headscale 环境下都不可能输出 INTEROP PASS**；互操作回归能力名存实亡，持续污染可信度 | preauthkey 改读环境变量；derp 阶段补第 2 参；给 h2c.node.ts 加 CLI 入口或从编排器移除该阶段 |
| 3 | **CI G0-5 D4 段引号语法错误**：单引号串内嵌 `['\"]` 提前闭合，`(net\|…)` 裸露成 syntax error | .github/workflows/g0-gates.yml:83 | D4 机检自 51b70c3 起从未执行；同 bash 语义下远端该 step 应红；「机检在岗」的说法对 D4 一节不成立 | 改用双引号包裹+转义，或把机检抽成仓内脚本文件供 CI 与本地共用（顺带消灭 5.2-4 的死过滤器） |
| 4 | **arkts-check.js 本机不可跑**：`require` 与根 package.json `"type":"module"` 冲突（加载即崩 exit 1）；且 :5-6 硬编码 `/home/dev/sdk/...` WSL 路径 | interop/arkts-check.js:4-6 | e136900 对它的路径穿越安全修复是**全仓唯一零实证的修复**；ArkTS linter 复跑通道断 | 重命名为 .cjs 或改 ESM import；SDK 路径参数化（环境变量） |

附带低危项（不单列缺陷）：docs-consistency 的 awk 取值恒空与「只防漏写」设计、grep -v '^\s*//' 死过滤器、
两处工具头注释陈旧、g0-gates.yml:1「五门」注释未更新为六 step——见第 5.2/6/4.4 节。

# 9. 如何复验（读者可照跑）

```bash
git rev-parse --short HEAD                 # 期望 90ed53e
npm test                                    # 期望 # tests 495 / # fail 0，exit 0
npm run typecheck                           # 期望 exit 0
npm run typecheck:bridge                    # 期望 exit 2：TS2353 @ peerapi-tun.test.ts(246,5)（当前已知红灯）
npm run test:bridge                         # 期望 # tests 30 / # fail 0，exit 0
npm run validate:shell                      # 期望 summary: 66 passed, 0 failed，exit 0
npm run interop:test:upload                 # 期望单元 8/8 + 集成 7/7，exit 0
npm run perf:baseline                       # 期望 exit 0，mean 落 3.5–4.1 ms/op 区间
sed -n '69,87p' .github/workflows/g0-gates.yml | bash   # 期望 exit 2（D4 段语法错误，脚本自身缺陷）
npm run interop:regress                     # 期望 exit 1（无 headscale 时环境失败；有 headscale 也会因脚本三重缺陷失败）

# D4/P4 等价复检（修正引号后与 CI 同义）：
grep -rEn 'Date\.now|Math\.random' packages/ --include='*.ts' | grep -v '^\s*//' | grep -v ':\s*//' | grep -v ' \* '
  # 期望空（原始 4 条全在注释）
grep -rEn "from ['\"]node:" packages/ --include='*.ts' | grep -v '\.test\.ts:'
  # 期望空（原始 103 条全在 .test.ts）
grep -rEn "fetch\(|XMLHttpRequest|WebSocket|from ['\"](net|dgram|http|https|tls|dns|fs|path|os|child_process|crypto)['\"]" \
  packages/ --include='*.ts' | grep -v '\.test\.ts:' | grep -v '^\s*//'
  # 期望空（原始即 0）
```

环境前提：node v22.23.2 / npm 10.9.8 / Windows Git Bash；node_modules 已在盘（禁止 npm install）。

# 10. 证据链与文件索引

## 10.1 六份报告路径

- `docs/baseline-audit/inventory-glm53-flash.md` / `inventory-minimax-m31-flash.md` / `inventory-step-router-v1.md`（三份独立盘点）
- `docs/baseline-audit/synthesis-glm53-flash.md` / `synthesis-minimax-m31-flash.md` / `synthesis-step-router-v1.md`（三份交叉综合）

## 10.2 关键数字溯源

- **495/0** → 本合并人 `npm test`（2.2）；三份盘点 §2.2 各自同值；逐包分布 → 本合并人逐包复跑（2.2）。
- **typecheck:bridge exit 2 / TS2353** → 本合并人复跑（2.4）；根因链（:81 单参 helper、:245 整包字面量、mock-peerapi.ts:60 类型、
  e136900 引入、5c3db5e 加断言未修、CI 无此门）→ GLM 综合 §1-2 + MiniMax 综合 C2/C3；本合并人抽验 :81/:246/e136900 三点吻合。
- **G0-5 原样 exit 2 + 等价 0 命中** → 本合并人复跑（2.9）；yml:83 原文亲读；历史（51b70c3 初版即坏、5c3db5e 只修过滤器）
  → MiniMax 综合 `git log -L` 取证，采信。
- **regress 三重缺陷（:52 / :54-56 / :57-59 + h2c 无 CLI）** → 本合并人亲读 regress.mjs:28/:52/:55/:58、derp.node.ts:37-40、
  h2c.node.ts（grep process.argv = 0）并复跑 exit 1（2.10）；MiniMax 综合首次钉死三重结构
  （注：MiniMax **盘点**写的行号 59-61 有误，正确为 54-56，按其综合勘误采信）。
- **perf 区间 3.51–4.10** → 六报告各自样本 + 本合并人 4.0502，共七样本（3.4 表）。
- **规模 72/16904 + 49/13170** → 本合并人 find/wc 实测（2.11）；与 GLM 盘点/综合一致
  （Step 盘点文件数 63、MiniMax 盘点测试行 11570 均误，经两份综合裁决不采）。
- **1c9b85b +215 与六项已实现** → 三份盘点 §4.2 + 两份综合复核；仅 TUN 壳层 fd 未接线（VpnExtensionAbility.ets:41-43 本合并人亲读）。
- **文档漂移各条** → 本合并人 sed/grep 亲验（README:10/:12/:35-46/:52-54、CONTEXT.md:6/:8/:15/:28、HARMONY_AGENT_TASK.md:9/:49/:82/:88）；
  29→30 时序 → ec5b99f 8 例 vs HEAD 9 例（本合并人 git show 计数）。
- **oracle/raw 从未入 git** → 本合并人 `git log --all -- docs/oracle/raw` 为空 + `ls docs/oracle/` 仅 protocol-notes.md。
- **docs-consistency awk 恒空** → 本合并人 `echo "# fail 0" | awk '{print $7}'` 空串实测；yml:99-127 亲读。

## 10.3 与六份报告的不一致处汇总（均以本合并人复验为准）

- netcheck 用例数采 **84** 非 64（GLM 盘点表格转抄误）。
- packages 文件数采 **72 src / 49 test** 非 63/46（Step 盘点漏数 barrel 等文件）。
- test 行数采 **13170** 非 11570（MiniMax 盘点加总笔误，其逐包数相加恰为 13170）。
- arkts-check.js 采「**本机不可跑**（exit 1 ESM/CJS 冲突）」（Step 盘点「可跑需 SDK」误——连模块都加载不进来，谈不到 SDK 层）。
- interop:regress 归因采「**环境缺失 + 三重脚本缺陷**」（GLM 盘点「纯环境缺失」不完整）。
- D4 采「**脚本坏 + 代码净两句并写**」（MiniMax/Step 盘点「三门 0 命中」未区分自己跑的是修正引号的等价命令而非 CI 脚本本体）。

---

*本总文所有数字可溯源至第 2 节命令的本合并人会话原样输出或第 10 节标注的亲验点；未复验项均已标注来源与采信等级。
写作纪律：宁实勿虚、不粉饰——红灯就是红灯。*
