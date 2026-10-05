# 独立盘点 · Step Router V1 · HEAD 90ed53e · 2026-10-03

## 1. 执行摘要（硬结论）

1. **G0-1 `npm test` 实测 495 pass / 0 fail**，与 README.md 基线一致；TAP 摘要行 `# tests 495 / # pass 495 / # fail 0` 已捕获。
2. **`npm run typecheck:bridge` 失败**：`app/bridge/test/peerapi-tun.test.ts:246` `selfAddresses` 不存在于 `DnsAnswerFn`，退出码 2。这与 README.md 声称的 "bridge 全绿" 矛盾，属真实产品缺陷（类型错误），非环境问题。
3. **G0-2/G0-3/G0-4/G0-5 全过**：typecheck exit 0；test:bridge 30/0；validate:shell 66/0；D4/P4 grep 三组全 0 命中。
4. **G0-6 `interop:test:upload` PASS**：单元 8/8 + 集成 7/7，upload_server.py 路径穿越防御实证通过。
5. **perf:baseline x25519 = 3.8325 ms/op（260.93 ops/s）**，较 README 记录的 09-29 基线 5.25 ms/op 快约 27%，但略高于 DELIVERY_REPORT §6.1 表列的 3.62 ms/op（差异原因：本次注入真实 node:crypto 随机源，与 v2 基线同法但 Node v22.23.2 本机波动）。
6. **`interop:regress` 失败属环境缺失**：阶段 1 `ECONNREFUSED 127.0.0.1:8080`（无 headscale）；阶段 2 传参错误（缺 `<authKey>` 导致 usage）。无 headscale 二进制 + 无有效 preauthkey，无法复跑 09-29 历史 PASS。
7. **09-29 INTEROP PASS 无仓内原始证据文件**：`git ls-files | grep -i evidence` 空；仅存于 Markdown 散文（README.md:48、DELIVERY_REPORT.md:208、TASK.md:67、docs/research/2026-10-02-D-interop-plan*.md）。
8. **app/ 壳确实未编译**：本盘点 `dir /s /b app\*.hap ...` 空；无任何 HAP/APK/build 产物。仓内证据链完整（README.md:52、DELIVERY_REPORT.md:73、docs/build-feasibility-linux.md）。
9. **commit 1c9b85b 真实存在且交付了二期代码**：git show 确认新增 `packages/disco/src/relay.ts`、`packages/netcheck/src/*.ts`、`packages/control/src/{netmap,wgderive,peerconn,derproute,smconsts,localapi,peerapi,magicdns,netaddr}.ts`、`app/bridge/src/{mock-localapi,mock-peerapi,mock-tun}.ts` 及对应测试，共 +215 测试。
10. **README.md 验收基线表存在两套数字**：上方表为 495/30/66（10-02 实测），下方表为 280/13/54（09-29/10-01 历史基线）。当前 HEAD 90ed53e 的真相是 495/30/66。

## 2. 实测验证记录

### 2.1 命令与输出

| # | 命令 | 关键输出原样摘录 | 退出码/计数 | 解读 |
|---|---|---|---|---|
| 1 | `git rev-parse --short HEAD` | `90ed53e` | 0 | 盘点基准点 |
| 2 | `npm test` | `# tests 495 / # pass 495 / # fail 0 / # duration_ms 34508.3993` | 0 | G0-1 通过；495 个用例全绿 |
| 3 | `npm run typecheck` | `(无输出)` | 0 | G0-2 通过；tsc 零错误 |
| 4 | `npm run typecheck:bridge` | `app/bridge/test/peerapi-tun.test.ts(246,5): error TS2353: Object literal may only specify known properties, and 'selfAddresses' does not exist in type 'DnsAnswerFn'.` | **2** | **FAILURE**；bridge 类型检查不通过 |
| 5 | `npm run test:bridge` | `# tests 30 / # pass 30 / # fail 0` | 0 | G0-3 通过；30 用例全绿（运行时） |
| 6 | `npm run validate:shell` | `summary: 66 passed, 0 failed` | 0 | G0-4 通过；66 项壳静态资源校验全过 |
| 7 | D4/P4 grep（Date.now/Math.random） | `__NO_MATCH__` | 0 | P4 通过；非注释行 0 命中 |
| 8 | D4/P4 grep（node: 导入） | `__NO_MATCH__` | 0 | P4/D4 通过；非测试源码 0 命中 |
| 9 | D4/P4 grep（网络/builtin 特征） | `__NO_MATCH__` | 0 | D4 通过；非测试源码 0 命中 |
| 10 | `npm run interop:test:upload` | `[1] 单元层（修复后判定）：8 pass / 0 fail（共 8 条攻击向量）... [2] 集成层：7 pass / 0 fail（共 7 条） === upload_server.py 路径穿越防御实证 PASS ===` | 0 | G0-6 通过 |
| 11 | `npm run perf:baseline` | `{"mean_ms":3.8325,"p50_ms":3.7643,"p95_ms":4.6232,"p99_ms":5.1594,"ops_per_sec":260.93}` | 0 | x25519 200 iter/20 warmup |
| 12 | `npm run interop:regress` | `FAIL: connect ECONNREFUSED 127.0.0.1:8080` / `FAIL: usage: node --experimental-strip-types interop/derp.node.ts <baseUrl> <authKey>` / `=== 判定字符串 === INTEROP FAIL / DERP INTEROP FAIL` | 1 | 环境缺失（无 headscale）+ 阶段 2 传参错误 |

### 2.2 npm test 最终摘要（TAP 格式）

```
1..495
# tests 495
# suites 0
# pass 495
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 34508.3993
```

该摘要位于本次运行输出文件末尾（`chatcmpl-tool-ab3872340a663e9d-stdout.log` 最后 20 行），与命令 #2 同一输出流。

## 3. 组件级清单

### 3.1 packages/ 逐包

| 包 | src 文件数 | src 行数 | test 文件数 | test 行数 | 主要导出 | 备注 |
|---|---|---|---|---|---|---|
| common | 9 | 747 | 8 | 524 | ByteReader/Writer, hex/base64/utf8, Clock/Rng/HttpTransport, constants | API 冻结；零平台依赖 |
| crypto | 6 | 1,354 | 6 | 1,001 | x25519, aead, sha256/hmac/blake2s, kdf2/kdf3, constTimeEqual/wipe | 手写原语；与 node:crypto 交叉验证 |
| noise | 6 | 898 | 4 | 1,881 | NoiseIkInitiator/Responder, NoiseTransportCipher, noiseFrame*, ControlBaseDuplex | 含 controlbase.ts（ts2021） |
| wireguard | 8 | 1,952 | 6 | 2,074 | WgHandshakeInitiator/Responder, WgSend/RecvSession, WgPeerTable, cookie | 一期不生成/消费 Cookie Reply |
| derp | 5 | 977 | 5 | 1,302 | DerpFrame*, DerpRegion/Node/Picker, DerpClient | 帧格式 u32BE；ClientInfo naclbox |
| control | 15 | 7,303 | 10 | 3,697 | ControlClient, TLV, tailcfg, noisehttp, netmap, wgderive, peerconn, derproute, localapi, peerapi, magicdns | 二期大幅扩展 |
| disco | 4 | 1,385 | 3 | 797 | relay (0x04-0x09), messages, wrapper, errors | 二期新增 relay 家族 |
| netcheck | 10 | 2,288 | 4 | 1,894 | engine, plan, addr, opt, regions, report, stun, probe | 二期完整化 |
| **合计** | **63** | **~16,904** | **46** | **~13,268** | — | 全仓 `.ts` 文件 121 个（含 test），总行数 ~30,074 |

### 3.2 app/ 真实形态

| 路径 | 存在 | 说明 |
|---|---|---|
| `app/entry/src/main/ets/vpnextensionability/VpnExtensionAbility.ets` | ✓ | **纯 stub**：`createVpnConnection` 返回 `VpnConfig`（addresses 为空，真实调用会失败），tun fd → 核心库对接全部为 TODO |
| `app/entry/src/main/ets/pages/Index.ets` | ✓ | 登录页骨架（auth key 输入/状态展示/连接开关，ArkTS 禁则写法） |
| `app/entry/src/main/ets/entryability/EntryAbility.ets` | ✓ | 加载 Index |
| `app/bridge/src/*.ts` | ✓ | 10 个 mock 模块（mock-localapi/mock-peerapi/mock-tun/mock-udp-bus 等），3,448 行 |
| `app/bridge/test/*.test.ts` | ✓ | 4 个测试文件（bridge/disco-netcheck/localapi/peerapi-tun） |
| `app/tools/validate-shell.mjs` | ✓ | 壳静态资源离线校验（V1-V9 共 66 检） |
| `app/*.hap / app/*.apk / app/build/` | **不存在** | `dir /s /b` 空结果；无任何编译产物 |

**编译证据链**：
- 本盘点空结果（#2.1 行 "app/ 壳确实未编译"）
- README.md:52 "app/ 壳从未编译"
- DELIVERY_REPORT.md:73 "本机无 DevEco Studio 与 HarmonyOS SDK...该目录所有文件未经任何编译器检验"
- docs/build-feasibility-linux.md §4 结论："GPU 机不可编译 app/ 壳"

### 3.3 interop/ 与 scripts/

| 文件 | 性质 | 本机可跑？ | 说明 |
|---|---|---|---|
| `interop/register.node.ts` | Node 驱动脚本 | **否**（需 headscale + authKey） | 控制面注册 + MapRequest |
| `interop/derp.node.ts` | Node 驱动脚本 | **否**（需 headscale + authKey） | DERP 互通 + Ping/Pong |
| `interop/h2c.node.ts` | Node 模块 | **否**（需已建立的 Noise 连接） | 极简 h2c 客户端 |
| `interop/regress.mjs` | 回归编排器 | **否**（需 headscale 实例） | 三阶段编排；当前 `derp.node.ts` 传参错误（缺 authKey） |
| `interop/upload_server.py` | Python 服务端 | **是**（本地起服务） | `interop:test:upload` 已实证路径穿越防御 |
| `interop/upload_server.test.mjs` | 实证驱动 | **是** | 单元 + 集成 15/15 PASS |
| `interop/arkts-check.js` | ArkTS linter 驱动 | **是**（需 ohos-sdk） | 当前环境无 SDK，本次未跑 |
| `interop/headscale.yaml` | 配置模板 | — | 需 headscale 二进制 |
| `interop/start-headscale.sh` | 启动脚本 | — | 需 Linux + docker/二进制 |
| `scripts/perf-baseline.mjs` | 性能基线 | **是** | 已跑，3.8325 ms/op |

### 3.4 CI（g0-gates.yml）

| Job | 平台 | 跑什么 | 门禁 |
|---|---|---|---|
| `g0` | ubuntu-latest + windows-latest 双矩阵 | npm ci → G0-1 test → G0-6 upload_server → G0-2 typecheck → G0-3 test:bridge → G0-4 validate:shell → G0-5 D4/P4 grep | 495/0 · 30/0 · 66/0 · 0 命中 · upload PASS |
| `docs-consistency` | ubuntu-latest | 锚定 README/CONTEXT/DELIVERY_REPORT 数字与实际 `npm test`/`test:bridge`/`validate:shell` 输出比对 | warning 级；数字漂移不上报失败 |

## 4. 声明 vs 实证对照表

| # | 声明来源 | 声明内容 | 实证结果 | 证据 |
|---|---|---|---|---|
| 1 | README.md 验收基线上表 | `npm test` 495 pass / 0 fail | **A 通过** | 本次 #2.1 #2：`# tests 495 / # pass 495` |
| 2 | README.md 验收基线上表 | `npm run typecheck` exit 0 | **A 通过** | 本次 #2.1 #3：tsc 零错误 |
| 3 | README.md 验收基线上表 | `npm run test:bridge` 30 pass / 0 fail | **A 通过** | 本次 #2.1 #5：`# tests 30 / # pass 30` |
| 4 | README.md 验收基线上表 | `npm run validate:shell` 66 passed / 0 failed | **A 通过** | 本次 #2.1 #6：`summary: 66 passed, 0 failed` |
| 5 | README.md 验收基线上表 | D4/P4 grep 0 命中 | **A 通过** | 本次 #2.1 #7-9：三组 grep 全 `__NO_MATCH__` |
| 6 | README.md 验收基线下表 | `npm test` 280 pass / 0 fail | **D 矛盾（历史基线）** | 当前 HEAD 为 495；280 是 10-01 历史数字 |
| 7 | README.md 验收基线下表 | `npm run test:bridge` 13 pass / 0 fail | **D 矛盾（历史基线）** | 当前 HEAD 为 30；13 是 10-01 历史数字 |
| 8 | README.md 验收基线下表 | `npm run validate:shell` 54 passed / 0 failed | **D 矛盾（历史基线）** | 当前 HEAD 为 66；54 是 10-01 历史数字 |
| 9 | README.md:52 | "app/ 壳从未编译" | **A 通过** | 本次 #3.2：无任何编译产物 |
| 10 | README.md:48 | 09-29 真实 headscale INTEROP PASS + DERP INTEROP PASS | **C 无法验证** | 无 headscale 二进制；仓内无原始 evidence/ 目录或 summary.json（仅 Markdown 散文转引） |
| 11 | commit 1c9b85b 标题 | 二期：disco relay 0x04-0x09、netcheck 调度、DERP region 随机选节点、netmap→WG 推导、状态机、LocalAPI/PeerAPI/MagicDNS、TUN mock | **B 代码存在，部分测试通过** | git show 确认文件新增；但 `typecheck:bridge` 失败说明 bridge 类型未完全收敛 |
| 12 | README.md:23 | `npm run typecheck:bridge` 在 README 构建命令表列出但未标基线 | **A 通过**（作为附加检查） | 本次 #2.1 #4：exit 2（失败） |
| 13 | DELIVERY_REPORT.md §6.1 | `test:bridge` 29/0 fail（10-02） | **D 矛盾** | 当前 HEAD 为 30/0；29 是 1c9b85b 刚入库时的数字，后续 commit 5c3db5e/90ed53e 提到 "+1" |
| 14 | docs/build-feasibility-linux.md | app/ 壳在 GPU 机不可编译（账号墙 + 网络墙 + hvigor 无公开分发） | **A 通过（静态证据链）** | curl 状态码记录 + npm registry 查询 + 本盘点无产物 |
| 15 | docs/handover/ 三份手册 | owner/interop/reviewer 三身份最小可执行手册 | **B 代码/文档存在** | 文件存在，内容已读；未按手册执行完整流程（缺环境） |

## 5. 未验证与不可验证项

### 5.1 需真机 / DevEco 的（子线 E 冻结项）

- `app/` 首次 `hvigorw assembleHap` 编译（缺 DevEco Studio 6.x + HarmonyOS SDK API 12+）
- 鸿蒙 NEXT 真机 VPN 权限授权 + `hdc install` + `am start` 冒烟
- CU6：ets loader 是否接受 `.ts` specifier（需真机编译环境）
- CU7：`cryptoFramework` / `@ohos.net.socket` / `@ohos.net.vpn` 实际签名核对
- CU8：hypium 测试链路对 `node:test` 用例的复用
- CU2：ArkTS 运行时 BigInt 行为（lint 静态已过，运行时未核）

### 5.2 需 headscale / 隔离环境的（子线 D 冻结项）

- `interop/regress.mjs` 三阶段全链复跑（需 docker 远端或本地 headscale 二进制）
- 09-29 INTEROP PASS / DERP INTEROP PASS 原始证据复现（缺环境 + 缺历史日志文件）
- `interop/register.node.ts` / `derp.node.ts` / `h2c.node.ts` 单脚本实证

### 5.3 本次未跑但代码+测试已通过的（B 类）

- `npm run typecheck:bridge` **失败**（见 §1 #2），属待修复缺陷，不归入 B 类
- `interop/arkts-check.js`（需 ohos-sdk 7.0 ets-loader；本次环境无 SDK）
- Mimosa 安全扫描（非本次必做项；DELIVERY_REPORT §6.4 已记录已知项）

## 6. 结论：真实能力基线

**一句话**：项目当前是"协议核心库完整 + 鸿蒙壳骨架 + mock 集成层 + 二期协议扩展 + 历史互操作证据"形态，Node 侧 8 包测试/类型/壳机检/D4-P4 五门基本全绿，但 bridge 类型检查存在 1 处真实错误；app/ 壳从未编译；09-29 真实 headscale 互通仅有 Markdown 散文转引，无原始日志证据；互操作回归脚本当前因缺 headscale 且 stage2 传参错误而不可能产出 PASS。

### 分级清单

| 级别 | 内容 | 数量/证据 |
|---|---|---|
| **实测可用** | `npm test` 全仓、`typecheck`、`test:bridge`（运行时）、`validate:shell`、D4/P4 grep、`interop:test:upload`、`perf:baseline` | 495/0 · 0 · 30/0 · 66/0 · 0/0/0 · 15/15 · 3.83ms/op |
| **代码+测试通过但未上真机** | 8 npm 协议包 + `app/bridge/` mock 集成（30 用例） | 121 `.ts` 文件 / ~30k 行 |
| **仅 mock / 仅文档声明** | `VpnExtensionAbility.ets` stub、`mock-tun/mock-peerapi/mock-localapi`、`docs/build-feasibility-linux.md` "不可编译"裁定 | 待 DevEco + 真机 |
| **仅文档/历史声明，本次无法验证** | 09-29 INTEROP PASS / DERP INTEROP PASS、AU1-AU3 上游核对真实互通、ArkTS linter src=0（09-29） | 缺 headscale / 缺 SDK |
| **存在但未修复的真实缺陷** | `app/bridge/test/peerapi-tun.test.ts:246` `selfAddresses` 类型错误导致 `typecheck:bridge` exit 2 | 1 处 TS2353 |

---
*本报告由 Step Router V1 于 2026-10-03 独立盘点生成，所有数字均来自本次会话实测输出。*
