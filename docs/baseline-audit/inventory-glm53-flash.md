独立盘点 · GLM 5.3 Flash · HEAD 90ed53e · 2026-10-03

# 0. 元信息

- 盘点人：GLM 5.3 Flash（三模型族独立盘点之一；未读取 docs/baseline-audit/ 内他人文件，未修改任何仓库现有文件）
- 盘点对象：D:\new-workspace\ohos-tailscale @ git `90ed53e`（全哈希 `90ed53e20fb998cc6c0005ece9147a3855cd7785`，2026-10-03 11:46:57 +0800，"chore: gitignore 补 Python __pycache__…"）
- 环境：win32 / Git Bash / node v22.23.2 / npm 10.9.8（`node --version`、`npm --version` 实测）
- 方法：10 项必做命令全部亲自运行并记录原样输出；静态盘点全部亲自 `find`/`grep`/`git log` 取证；每个数字可溯源到第 2 节。
- 标注口径：A=本次实测验证通过；B=代码/文件在盘但我未运行；C=仅文档/历史声明，本次无法验证；D=与实测矛盾（附证据）。

# 1. 执行摘要（10 条硬结论）

1. **G0 五门中四门本次实测全绿**：`npm test` 495/0（exit 0）、`typecheck` exit 0、`test:bridge` 30/0、`validate:shell` 66/0；另 G0-6 upload_server 防御实证 单元 8/0 + 集成 7/0 全过。
2. **`typecheck:bridge` 当前是红的（exit 2）**：`app/bridge/test/peerapi-tun.test.ts(246,5)` TS2353——helper `makePeerServer`（:81）只收单参 `answerDns`，末例却传整包 config。回归由 e136900（"新增跨包污点负例 test"）引入、5c3db5e 加断言未修。CI 五门不含此命令（g0-gates.yml 无此 step），故门禁未拦截；运行时测试仍 30/30 绿（mock 对 q 的校验先于 answerDns 调用），属类型级缺陷。
3. **CI 的 G0-5 脚本自身有 bash 语法错误**：从 yml 原文逐字提取（`sed -n '69,87p' | bash`）复跑——P4 段、node: 导入段执行且 0 命中，但第 15 行（D4 网络 grep）报 `syntax error near unexpected token '('`，**D4 机检从未真正运行过**（同 bash 语义下 GitHub Actions 该 step 也应 exit 2；远端实际运行史无 gh CLI 不可查）。修引号后的等价 D4 grep 实测 0 命中——代码面是干净的，坏的是门禁脚本。
4. **README 同页两套基线，现行真相是 495/30/66**（本次实测一致）；280/13/54 是 2026-10-01 夜班旧基线残留（worklog.md:21,23,36 佐证）。README 另有两处陈旧：line 12 "validate:shell 54 用例"（实为 66）、line 10 "约 8400 行"（实测 8 包 src 共 16904 行）、line 54 "已知问题 3 二期未做项"（与 commit 1c9b85b 实际内容矛盾，该提交已实现所列各项）。
5. **"app/ 壳从未编译" 成立（负面证据实证）**：app/ 37 个文件中无 oh_modules/、.hvigor/、build/、entry/build/，全仓无 *.hap/*.abc/*.har；根 tsconfig `exclude: ["app"]`；VpnExtensionAbility.ets 为桩（8 处 TODO，`addresses: []` 注明"真实调用会失败"）。
6. **09-29 真实 headscale INTEROP PASS 是转引历史证据，仓内无原始日志**：唯一详述在 DELIVERY_REPORT.md §5.2–5.5（:180–208）；`evidence/` 目录不存在；`docs/oracle/raw/`（DELIVERY §1.8/§3.4 引用的 17 份转储）**从未入 git 历史**（`git log --all -- docs/oracle/raw` 为空）；本次 `interop:regress` 复跑因无 headscale 实例 ECONNREFUSED 失败（符合预期，环境缺失非产品缺陷）。
7. **commit 1c9b85b（+215 测试）属实**：`git show --stat` 列明全部新增文件；所列二期功能在 HEAD 均有实现+测试且本次全绿。但**接线程度需打折**：disco relay 0x04–0x09 只是编解码+bind 握手状态机，未接任何 UDP relay 数据面（peerconn.ts:44 自述"UDP peer-relay/relayManager 与 disco 0x04-0x09 属子线（不实现，如实记录）"）。
8. **规模实测**：packages/ 8 包 = src 72 文件/16904 行 + 测试 49 文件/13170 行/495 用例（逐包之和恰为 495）；app/bridge 3448 行 TS、4 测试文件 30 用例；app .ets 仅 3 文件 322 行。
9. **perf 复跑**：x25519 mean 4.01–4.10 ms/op（200 iter/20 warmup，两次运行），与 README 基线 3.62 ms/op 同数量级（本次偏慢 ~10%，机器负载差异，如实记录）；脚本 exit 0、总耗时 3.4s。
10. **CI 工作流两处设计缺陷**：不含 `typecheck:bridge`（第 2 条回归因此漏网）；G0-5 脚本第 15 行语法错误（第 3 条）。docs-consistency job 只发 warning 不 fail。

# 2. 实测验证记录（每条：命令 + 输出摘录 + 解读）

## 2.1 `git rev-parse --short HEAD`
```
90ed53e
90ed53e20fb998cc6c0005ece9147a3855cd7785 2026-10-03 11:46:57 +0800 chore: gitignore 补 Python __pycache__…
v22.23.2 / 10.9.8
```
【A】盘点基准确认。

## 2.2 `npm test`
```
1..495
# tests 495
# pass 495
# fail 0
# duration_ms 34989.974   （首跑）
```
复跑捕获退出码：`NPM_TEST_EXIT=0`（第二次 duration_ms 7766.79）。
逐包单跑（`node --test packages/<pkg>/test/*.test.ts`）：
```
common: 40/40   crypto: 35/35   noise: 39/39     wireguard: 60/60
derp:   58/58   disco:  38/38   control: 141/141 netcheck: 84/84
```
【A】40+35+39+60+58+38+141+84 = 495，与全仓一致；README/CONTEXT 的 495 口径被复现。

## 2.3 `npm run typecheck`
```
> tsc --noEmit -p .
TYPECHECK_EXIT=0
```
【A】零错误。

## 2.4 `npm run typecheck:bridge` —— **失败**
```
app/bridge/test/peerapi-tun.test.ts(246,5): error TS2353: Object literal may only specify
known properties, and 'selfAddresses' does not exist in type 'DnsAnswerFn'.
TC_BRIDGE_EXIT=2    （复跑两次结果一致）
```
根因取证：`app/bridge/test/peerapi-tun.test.ts:81` 定义 `makePeerServer = (answerDns: MockPeerApiConfig['answerDns']): MockPeerApiServer =>`（单参，类型即 `DnsAnswerFn|null`，定义在 `app/bridge/src/mock-peerapi.ts:60`）；:245 的用例 "ExitDNS：name 跨包污点边界" 却传 `{ selfAddresses:…, peerPackets:…, listeners:…, answerDns:null, offersExitNodeOrAppConnector:true, filterAcceptsTcp53:false }`。`git log -S selfAddresses` 定位引入提交 e136900；5c3db5e 在其上加断言未修签名。运行时仍绿（30/30，见 2.5）的原因：MockPeerApiServer 对畸形 q 的 400 校验先于 answerDns 调用，断言不触及被忽略的字段。**运行时行为与类型契约在此用例上已分叉**。CI（g0-gates.yml）五门不含此命令——门禁盲区。

## 2.5 `npm run test:bridge`
```
1..30
# pass 30
# fail 0
# duration_ms 1104.2977
TEST_BRIDGE_EXIT=0
```
【A】4 个测试文件（bridge 7 + disco-netcheck 6 + localapi 8 + peerapi-tun 9 = 30）。

## 2.6 `npm run validate:shell`
```
[PASS] V9 bridge/src/mock-tun.ts tstun anchors — TUN mock 蓝本锚定 net/tstun（fake/wrap）
[PASS] V9 bridge index exports C3 wiring — C3 三面（LocalAPI/PeerAPI/TUN）经 barrel 对壳可见
summary: 66 passed, 0 failed
VALIDATE_SHELL_EXIT=0
```
【A】V1–V9 九组静态机检 66/0。README line 12 "54 用例" 为陈旧口径。

## 2.7 `npm run interop:test:upload`
```
[1] 单元层（修复后判定）：8 pass / 0 fail（共 8 条攻击向量）
[1] path.resolve 二次校验：4 条全部判定正确 ✓
[2] 集成层：直接调 upload_server.H.do_POST
[2] inbox 落盘文件（Python 视角，已用 os.listdir 同进程读取）：["x.bmp"]
[2] 集成层：7 pass / 0 fail（共 7 条）
UPLOAD_EXIT=0
```
【A】Python 真服务端路径穿越防御（fcaf962 修复项）本机可复跑且全过。

## 2.8 G0-5 D4/P4 机检原样复跑
命令：`sed -n '69,87p' .github/workflows/g0-gates.yml | bash`（把 CI 脚本块逐字喂给 bash）
```
--- P4: Date.now / Math.random（非注释行）---
--- P4/D4: 非测试源码 node: 导入 ---
--- D4: 网络/builtin 特征（仅 src） ---
bash: line 15: syntax error near unexpected token `(' while looking for matching `)'
G0_5_EXIT=2
```
独立计数（同过滤器手跑）：
```
P4 非注释 Date.now/Math.random 命中 = 0
非测试源码 node: 导入命中 = 0
修引号等价 D4：'fetch\(|XMLHttpRequest|WebSocket' = 0；"from ['\"](net|dgram|http|https|tls|dns|fs|path|os|child_process|crypto)['\"]" = 0
```
【D→A】CI 脚本原文中 D4 grep 的引号拼接（`'…from ['\"](net|…)['\"]'`）在 `$( )` 内产生未引用 `(`，**该检查在任何 bash 下都是语法错误**；P4 与 node: 两段有效且 0 命中；等价改写后 D4 亦 0 命中——代码符合 D4，但"机检在岗"的说法对 D4 一节不成立。远端 Actions 是否真跑过、跑出什么，无 gh CLI 不可查（remote 存在：git@github.com:feasy898/ohos-tailscale.git）。

## 2.9 `npm run perf:baseline`
```
{"node":"v22.23.2","iter":200,"warmup":20,"mean_ms":4.0098,"p50_ms":3.8022,"p95_ms":5.1003,"p99_ms":5.5662,"ops_per_sec":249.39,"sink":"0"}
基线 09-29: 5.25 ms/op ~190 ops/s（同一测法；本机 win32 / Node v22.23.2）
vs 基线：0.76× （快23%）
```
带 `time` 复跑：`mean=4.0978 ms/op`，`real 0m3.407s`（总耗时）。【A】脚本可复跑 exit 0；本次实测 4.01–4.10 ms/op，较 README 记载的 3.62 ms/op（HEAD 0962ada 时点）慢约 10–13%——同数量级，未精确复现，机器负载差异所致，如实记录。

## 2.10 `npm run interop:regress` —— 按预期失败
```
>>> 阶段：控制面注册（RegisterRequest + MapRequest）
FAIL: connect ECONNREFUSED 127.0.0.1:8080
>>> 阶段：DERP 客户端 + Ping/Pong
FAIL: usage: node --experimental-strip-types interop/derp.node.ts <baseUrl> <authKey>
=== 判定字符串 ===
INTEROP FAIL
DERP INTEROP FAIL
REGRESS_EXIT=1
```
解读：regress.mjs 默认 `HS=http://127.0.0.1:8080`（interop/regress.mjs:27），本机无 headscale 实例 → 控制面连接被拒；DERP 阶段因拿不到 authKey 参数退化为 usage 报错。**失败属环境缺失（无隔离 headscale），非产品缺陷**；脚本自身启动正常、错误处理与判定字符串输出符合其设计。

# 3. 组件级清单

## 3.1 packages/（8 个 npm workspace 包，逐包实测数字）

| 包 | src 文件/行 | 测试文件/行/用例 | 依赖 | 职责一句话 |
|---|---|---|---|---|
| common | 9 / 747 | 7 / 524 / 40 | 无 | ByteReader/Writer、hex/base64/utf8、Clock/Rng/HttpTransport 注入接口、常量 |
| crypto | 8 / 1354 | 6 / 1001 / 35 | 无 | x25519、ChaCha20-Poly1305、SHA-256/HMAC/BLAKE2s/HKDF、naclbox、XChaCha20 |
| noise | 7 / 898 | 7 / 1881 / 39 | 无 | Noise IK 握手 + controlbase(ts2021) + 帧层 + 传输 cipher |
| wireguard | 10 / 1952 | 7 / 2074 / 60 | 无 | WG 握手/传输/反重放/MAC1·2/Cookie Reply/type1-4 分发/peer 表 |
| derp | 6 / 977 | 4 / 1302 / 58 | common | DERP 帧编解码(u32BE+0x01-0x15)、客户端状态机、region 选择/拨号策略 |
| disco | 5 / 1385 | 3 / 797 / 38 | common, crypto | "TS💬" wrapper、Ping/Pong/CallMeMaybe(0x01-03)、relay 家族(0x04-09) |
| netcheck | 10 / 2288 | 4 / 1894 / 64 | common | STUN 编解码、探测计划、引擎调度、历史窗、报告聚合 |
| control | 17 / 7303 | 11 / 3697 / 141 | common, noise, crypto | TLV/tailcfg/netmap/wgderive/peerconn/derproute/localapi/peerapi/magicdns |
| **合计** | **72 / 16904** | **49 / 13170 / 495** | | 依赖单向无环（各包 package.json 实证，§3.1 末注） |

注：control 包实际只 import `@ohos-tailscale/common`(8 处)/`noise`(1)/`crypto`(1)——对 disco/wireguard 的依赖边"预留未用"（grep 实证）；derp→common、disco→common+crypto、netcheck→common，与 architecture.md §1 拓扑一致。

## 3.2 app/（鸿蒙工程壳，37 个文件）

- 结构：AppScope(app.json5/图标)、工程级 build-profile.json5/hvigorfile.ts/oh-package.json5/hvigor 配置、entry（module.json5、3 个 .ets 共 322 行、资源 5 件）、bridge/（src 10 文件 + test 4 文件 + tsconfig，共 3448 行）、tools/validate-shell.mjs（V1–V9 共 66 检）。
- **从未编译的证据（A 级负面实证）**：`ls app/oh_modules .hvigor build entry/build` 全部 "No such file or directory"；`find app -name '*.abc' -o -name '*.hap' -o -name '*.har'` 零命中；根 tsconfig `"exclude": ["app"]`（typecheck 不覆盖 app）；`VpnExtensionAbility.ets` 为桩——8 处 TODO，`addresses: []` 行注释自述"当前为空，真实调用会失败——桩仅示意流程"（:41）。
- bridge 是壳↔库唯一活动面：MockHttpTransport/MockControlPlane/shell-session（桥接 control 包）、mock-udp-bus+shell-discovery（消费 netcheck/disco 包）、mock-localapi/mock-peerapi/mock-tun（消费 control C3 面）。30 用例全绿但全部是内存 mock。

## 3.3 interop/（11 个文件）

| 文件 | 是什么 | 本机可跑？ |
|---|---|---|
| regress.mjs | 子线 D 一键回归（三阶段，判定 INTEROP PASS / DERP INTEROP PASS） | ❌ 需 headscale（本次 exit 1，见 2.10） |
| register.node.ts | 真控制面注册：/key→/ts2021 升级→Noise IK→h2c 注册/地图 | ❌ 需 headscale + authKey |
| derp.node.ts | A/B 双节点真实 DERP 互通 | ❌ 需 headscale（内嵌 DERP） |
| h2c.node.ts | 极简 HTTP/2(h2c) 客户端（Noise 之上的控制面应用层，仅 Node 侧胶水） | 作为库被上两者引用 |
| start-headscale.sh | WSL 内起 headscale serve | ❌ 需 headscale 二进制 |
| headscale.yaml | headscale 配置 | 配置件 |
| upload_server.py | 真 Python 服务端（结果回传收件箱，fcaf962 修路径穿越） | ✅ 由下项驱动 |
| upload_server.test.mjs | 上述实证（单元 8 + 集成 7） | ✅ 已跑全过（2.7） |
| arkts-check.js | 驱动华为 ets-loader 内置 ArkTSLinter（硬编码 `/home/dev/sdk/...` 路径） | ❌ 需 WSL+华为 SDK |
| arkts-mirror.sh | packages/ 镜像为 .ets 供 linter 扫 | ❌ 同上 |
| \_\_pycache\_\_/ | 本机跑 upload 实证生成的 .pyc（未跟踪，90ed53e 已补 gitignore） | 本地产物 |

## 3.4 scripts/
仅 `perf-baseline.mjs`（BigInt X25519 基线，200 iter/20 warmup，注入真实 node crypto 随机源）——本机可跑，已跑（2.9）。

## 3.5 CI（.github/workflows/g0-gates.yml，逐 job 解读）

- **job `g0`**（matrix：ubuntu-latest + windows-latest）：npm ci → G0-1 `npm test` → G0-6 upload 实证（setup-python 3.11）→ G0-2 `typecheck` → G0-3 `test:bridge` → G0-4 `validate:shell` → G0-5 D4/P4 机检（bash 脚本块，见 2.8：**P4/node: 两段有效，D4 段语法错误从未执行**）。
- **job `docs-consistency`**（ubuntu）：实跑三命令抓真实数字（tests/bridge/shell），grep README/CONTEXT/DELIVERY_REPORT/architecture 是否含该数字，缺失仅 `::warning` 不 fail。
- **实证结论**：CI 不跑 `typecheck:bridge`（2.4 的回归因此漏网）、不跑互操作（README:29 声明属实）；G0-5 若在 GitHub 原样运行，该 step 会因语法错误 exit 2 变红——远端实际状态不可查（无 gh）。

## 3.6 根文档与 docs/（重要能力声明清单化）

| 文件 | 关键声明（行号实测） |
|---|---|
| README.md | :22/:35 基线 495/0；:35-40 现行基线表 495·0·30·66·D4/P4 0·perf 3.62ms/op（标注 2026-10-02 HEAD 0962ada）；:41-46 **无标题旧表残留 280/13/54**；:48 09-29 INTEROP PASS"一次性历史证据"；:52 app 从未编译；:53 互操作不可复跑（转引）；:54 "二期未做项"清单（**已过时，见 §4-7**）；:12 "validate:shell 54 用例"（陈旧）；:10 "约 8400 行"（陈旧） |
| DELIVERY_REPORT.md | §5.2（:180-188）09-29 WSL headscale v0.29.4 注册互通双侧验证；§5.3（:194）09-29 真实 DERP A→B 包交换；§5.4（:196-203）官方 ArkTS linter src 154→0；§5.5（:208）238/238+INTEROP PASS 复跑；§6（:219-225）10-02 五门 495/29/66；:151/:78 引用 `docs/oracle/raw/` 17 份转储（**实际不存在**） |
| TASK.md | :18-22 G0 数字契约（≥280/≥13/≥54 旧口径）；:54 子线 D 判定=INTEROP PASS+DERP INTEROP PASS；:62 子线 E 冻结 WAITING_EVENT |
| CONTEXT.md | :15 495/0（10-02 实跑）+bridge 29+shell 66；:6 app 从未编译 |
| worklog.md | :21 280 基线（dispatch 7 用例）；:23 bridge 13/54 shell；:34-37 10-02 收口 495/29/66+commit 1c9b85b；:31 声明"npm run typecheck:bridge → EXIT=0"（当时真，**现已被 e136900 破坏**）；:38 Mimosa 4 处扫描遗留 |
| docs/handover/（3 手册） | 共同硬约束：G0 五门 ≥495/30/66、D4/P4、"不信任 commit message 自报数字"、Mimosa 4 处已知误报识别 |
| docs/architecture.md | §10.2 AU1-AU4【已核对✅ 09-29】+ AU5-AU9【新增 10-02 ✅】；v1.3 修订记录（AU7 语义勘误：随机仅在 region 级兜底） |
| docs/arkts-linter-report-raw.txt | 270 行原始 linter 输出（首行 "scanning 76 .ets files"、"diagnostics: 477"）——09-29 官方 linter 运行的在盘物证（B 级：在盘未复跑） |

# 4. 声明 vs 实证对照表

| # | 声明（出处） | 判定 | 证据（本次运行/读取） |
|---|---|---|---|
| 1 | 基线 495/30/66（README:35-38） | **A** | 2.2/2.5/2.6 全部复现，exit 0 |
| 2 | 同页旧表 280/13/54（README:42-45） | **D** | 与实测矛盾；worklog.md:21,23,36 证明是 10-01 夜班旧基线（280=dispatch 后、13=bridge 两文件期、54=V1-V8 期）。当前真相=495/30/66 |
| 3 | "validate:shell 54 用例"（README:12） | **D** | 实测 66（2.6）；line 25 自己也写 66——同文件自相矛盾 |
| 4 | "约 8400 行"（README:10） | **D** | 实测 8 包 src 16904 行（§3.1 统计命令），低估一半 |
| 5 | "app/ 壳从未编译"（README:52 等） | **A** | §3.2 负面证据链（无产物目录/文件、tsconfig exclude、桩 TODO） |
| 6 | 09-29 INTEROP PASS + DERP INTEROP PASS（README:48、DELIVERY §5.2-5.5） | **C** | 唯一详述 DELIVERY_REPORT.md:180-208；`evidence/` 不存在（find 零命中）；`docs/oracle/raw/` 从未入 git（`git log --all -- docs/oracle/raw` 空）；本次复跑 ECONNREFUSED（2.10）。README:53 自认"转引历史证据" |
| 7 | 官方 ArkTS linter src=0（09-29，README:48/DELIVERY §5.4） | **C**（物证在盘 B） | docs/arkts-linter-report-raw.txt 270 行在盘（头行 "scanning 76 .ets files…diagnostics: 477"），但 linter 需华为 SDK+WSL，本次未复跑 |
| 8 | commit 1c9b85b 二期功能（提交信息） | **A（存在性与测试）+ 限定（接线度）** | `git show --stat 1c9b85b` 列明全部文件；功能测试在本 HEAD 全绿（2.2）。但 disco 0x04-0x09=编解码+bind 状态机，数据面接线明确不实现（packages/control/src/peerconn.ts:44 自述）；netcheck 引擎=注入接口驱动，无真实 socket |
| 9 | README:54 "二期未做项：disco 0x04-0x09、netcheck 调度、DERP 随机选节点、netmap→WG、状态机、LocalAPI/PeerAPI/MagicDNS、TUN mock" | **D** | 与 1c9b85b（其祖先提交）逐项相抵——上述各项均已实现+测试（§7 逐包清单）；该行是 10-02 之前的陈旧口径未更新 |
| 10 | "D4/P4 机检 0 命中"（README:39、DELIVERY §6.1） | **半 D** | P4=0、node:=0（A，2.8）；但 CI 的 D4 grep 脚本本身语法错误从未运行（D）——"机检在岗"对 D4 一节不成立；修引号等价 grep=0 说明代码面 D4 仍真 |
| 11 | worklog.md:31 "typecheck:bridge → EXIT=0"（10-03 C-B 轮） | **当时 A、现在 D** | e136900 引入回归后当前 exit 2（2.4） |
| 12 | perf 3.62 ms/op（README:40、DELIVERY §3.4 v2） | **A⁻** | 脚本 exit 0 可复跑；本次 4.01-4.10 ms/op，同数量级未精确复现（2.9） |
| 13 | oracle/raw/ 17 份转储（DELIVERY:78,151） | **D** | 目录不存在且从未入 git 历史；仅 protocol-notes.md 在盘 |
| 14 | "CI 不跑互操作"（README:29） | **A** | g0-gates.yml 无互操作 job（G0-6 upload 实证除外） |
| 15 | 五门"双平台并行 ubuntu/windows"（g0-gates.yml:26） | **B** | yml 在盘已读；远端实际执行不可查（无 gh） |
| 16 | 495=+215 于 280 基线（1c9b85b 提交信息） | **A（间接）** | 280 有 worklog:21 背书；495 本次实测；+215 的文件明细在 `git show --stat` |

# 5. 未验证与不可验证项

**需真机 + DevEco（子线 E，冻结 WAITING_EVENT）**：app/ 首编译、HAP 安装、VPN 冒烟、CU1–CU10（`.ts` specifier 是否被 ets loader 接受=CU6、BigInt=CU2、平台 Rng/Clock API 签名=CU7、hypium 复用 node:test=CU8 等）。任何协议代码在 ArkTS runtime 的真实表现=零数据。

**需 headscale + docker（子线 D，ran=false）**：`interop:regress` 三阶段、register/h2c/derp 脚本。本次实测确认当前机器不可跑（2.10）。09-29 的 PASS 因此永远只能是转引，直到有人按 docs/handover/agent-interop-regression.md 重建环境。

**需华为 SDK + WSL**：ArkTS linter 复跑（arkts-check.js 硬编码 `/home/dev/sdk/ets/...` 路径）。

**需 GitHub 访问**：Actions 远端运行史——特别是 G0-5 语法错误在远端的真实表现（本地同 bash 语义推定必红，但未证实）。

**结构性不可验证（D4 设计使然）**：所有包的网络行为（真实 UDP/TLS/STUN/DERP/控制面长轮询）在 packages/ 内无一处真实 socket——全部经注入接口；真实网络语义只存在于 interop/ Node 胶水与 09-29 历史会话中。

**未复跑的历史步骤**：WG 握手向量的跨语言第三实现复现（DELIVERY §1.4 自述"该步骤记录于头注，更新轮未复跑"）——我亦未复跑。

# 6. 结论：真实能力基线

**一段话**：这个仓库的真实形态是一套在 Node 环境下被 495+30 个用例钉住的纯 TS 协议核心库（8 包 16904 行，密码学原语到控制面状态机逐层有上游向量或交叉验证锚定，本次全数复绿），外加一个从未编译过的鸿蒙工程壳（322 行 .ets 桩 + 3448 行内存 mock 桥）和一份只在 2026-09-29 当天真实联通过 headscale v0.29.4 的互操作脚本组（无原始证据入仓，本次复跑 ECONNREFUSED）。"协议正确性"有同级较强的本地证据；"能在鸿蒙上跑、能连真实网络"没有任何本次可验证的证据。门禁体系有实效但带两处真实缺口：typecheck:bridge 红而被 CI 盲区掩盖、D4 机检脚本自身语法错误从未运行过。

**分级清单**：
- **实测可用（本次亲手跑通）**：8 包全量测试 495/0；typecheck exit 0；bridge 30/0；validate:shell 66/0；upload_server 路径穿越防御实证 8+7 全过；perf 脚本（x25519 ≈4.0ms/op）；G0-5 的 P4/node: 检查（0 命中）与修引号后的 D4 等价检查（0 命中）。
- **代码+测试通过但未上真机/未对真实网络**：全部协议功能——Noise IK+controlbase、WG 握手/传输/反重放/Cookie Reply/分发、DERP 帧/客户端/region 策略、disco 0x01–0x09 编解码+bind 状态机、netcheck STUN/计划/引擎、control 全家（tailcfg/netmap/wgderive/peerconn/localapi/peerapi/magicdns）。证据等级=Node 内单测+注入接口，向上兼容 ArkTS 仅为静态规避（linter 09-29 一役+66 检机检）。
- **仅 mock**：app 壳全部数据面——VpnExtensionAbility（桩，addresses=[]）、TUN（Fake/Memory/TsTunWrapper）、UDP（UdpDatagramBus+NAT 仿真）、LocalAPI/PeerAPI 服务器（MockIpnBackend/MockPeerApiServer）、控制面 transport（MockHttpTransport）。
- **仅文档/历史声明（本次不可验证）**：09-29 INTEROP PASS 与 DERP INTEROP PASS（转引，无日志）；09-29 ArkTS linter src=0（有 270 行 raw 报告物证，未复跑）；CI 远端双平台绿；perf 3.62 ms/op 精确值。
- **不存在（文档声称有而实际没有）**：docs/oracle/raw/ 17 份转储；evidence/interop-* 证据目录；disco 0x04-0x09 的 UDP relay 数据面接线（peerconn.ts:44 明示不实现）；PacketFilter 四元组过滤执行体（netmap 仅存在性探测）；DNS wire format（dnsmessage 打包，DoH Bytes 以 501 表达）；4via6 合成名；任何真实 socket/TLS/ICMP 实现层。
- **与文档矛盾（D 级要点回收）**：README:41-46 旧表、README:12"54 用例"、README:10"8400 行"、README:54"二期未做"清单、DELIVERY 引用的 oracle/raw、worklog:31 的 typecheck:bridge=0（已被后续提交破坏）。

# 7. 附加侧重：协议能力面逐包深挖（已实现有测试 vs 仅接口/mock/未实现）

测试名全部由本会话从测试文件逐一提取（`node -e` 逐文件 matchAll），下述每项的"证据"=测试文件路径+用例数（用例数与 2.2 逐包计数吻合）。

## 7.1 common（40 用例）
- **已实现且有测试**：ByteReader/Writer u8–u64 BE/LE+LEB128 uvarint+越界防护（bytes.test.ts，11 例）；hex 编解码（hex.test.ts，4）；base64 RFC 4648 严格 canonical（base64.test.ts，5）；手写 UTF-8 严格校验（utf8.test.ts，5）；Clock/FixedClock 双轴单调（clock.test.ts，5）；Rng/ArrayRng（random.test.ts，5）；HttpTransport 接口+常量+barrel（index.test.ts，3）。
- **仅接口**：http.ts 只有 `HttpTransport`/`HttpBodyStream` 接口与 NullBodyStream 形态——无任何真实网络实现（D4 设计）。

## 7.2 crypto（35 用例）
- **已实现且有测试**：x25519（RFC 7748 §5.2/§6.1+迭代向量+node:crypto diffieHellman 交叉+低阶点全零，x25519.test.ts，8）；ChaCha20-Poly1305 AEAD（RFC 8439 全向量+node:crypto 交叉+篡改拒绝，aead.test.ts，6）；SHA-256/HMAC-SHA256/BLAKE2s（无键/键控/HMAC，blake2-kat+CPython 参考+RFC 4231）/HKDF²³（RFC 5869 TC3）（hash.test.ts，6）；constTimeEqual/wipe（util.test.ts，2）；naclbox 标准构造（beforenm=HSalsa20，tweetnacl 双向字节互验）（naclbox.test.ts，5）；XChaCha20-Poly1305+HChaCha20（draft-irtf-cfrg-xchacha-03 §2.2.1+附录 A.1 全 KAT）（xchacha.test.ts，5）。
- **仅内部不导出**：chacha20Block/poly1305Mac/blake2sCore 等（index.ts 头注明示）。无未实现项。

## 7.3 noise（39 用例）
- **已实现且有测试**：Noise IK 握手 initiator/responder（cacophony 权威向量逐字节锚定 msgA/msgB/握手哈希/counter=0 密文，external-vector.test.ts；handshake.test.ts 12 例含确定性冻结向量、prologue/密钥不匹配→DECRYPT、状态机 STATE）；controlbase ts2021（101B initiation 常量、版本=148 prologue、record 帧 1B+2B BE、上限 4096/明文 4077、错误帧、真实 prologue 往返，controlbase.test.ts 4）；帧层 2B BE+NoiseFrameReader 分片/粘包重组（frame.test.ts 6）；传输 cipher BE64 nonce（controlbase 语义，跨 2^32/2^53+1/MAXNONCE、篡改不推进计数器，transport.test.ts 9+reference.test.ts 4+roundtrip.test.ts 4）。
- **边界**：HTTP/2 层不在本包（h2c 只在 interop 胶水）；服务器端只到 responder 原语，无 controlhttp 完整客户端状态机（升级握手细节在 control.client/noisehttp）。

## 7.4 wireguard（60 用例）
- **已实现且有测试**：握手 initiator/responder（148B/92B 字节级向量三重锁定、键调度独立推导、TAI64N 时间戳、错误密钥→MAC 先拦，handshake.test.ts 16）；TAI64N（tai64n.test.ts 5）；传输 Send/Recv 会话（LE64 nonce 与 OpenSSL 逐字节对照、2048 位反重放窗口含 2^31/2^53+1 边界、keepalive，transport.test.ts 11）；MAC1/MAC2/CookieCache（cookie.test.ts 8，白皮书 5.4.4/5.4.7+wireguard-go cookie.go）；**Cookie Reply type=3**（64B 编解码+responder/consumer 端到端+R_m 120s 轮换，cookie-reply.test.ts 8）；**type=1/2/3/4 分发器**（dispatch.test.ts 7：type=4 配对解密、type=3 awaited 配对消费、type=1/2 under-load 回 Cookie Reply）；WgPeerTable（重钥顶替/级联删除，peers.test.ts 5）。
- **仅接口/未实现**：真实 UDP socket 与 protect（无）；重钥定时器/过期剔除调度（WgPeerTable 无，DELIVERY §3.4 如实声明）；under-load 的真实负载检测（上游 load 且 sleep 语义未做，只有"无回调即视为 under-load"的回包路径）；与真实 WireGuard 对端互操作=从未发生（DELIVERY §2.3 自认）。

## 7.5 derp（58 用例）
- **已实现且有测试**：帧层 u32BE+0x01–0x15 码表+Magic+1MiB 上限+reader 分片/粘包/半帧（frame.test.ts 14，死字节对照上游 derp.go）；DerpClient 状态机 Idle→Connecting→Ready→Closed（ServerKey(Magic+key)→ClientInfo(naclbox JSON)→ServerInfo 握手、订阅集合、RecvPacket/PeerGone/ServerPing→Pong/KeepAlive/NotePreferred、sendPing RTT 注入 Clock，client.test.ts 21）；region 选择（homeRegion 最小延迟/全未测兜底，region.test.ts 9）；**region 级随机兜底+节点级按序回退**（pickNode stunOnly 过滤对齐 derphttp_client.go:640-650、pickHomeRegionFallback 注入 Rng+Lemire rngIntN 钉死区间、derpDialRegion firstErr 语义，regionpick.test.ts 14）。
- **仅接口/未实现**：真实 TLS 拨号（DerpDialer 注入）；regiondial.ts 是策略层非网络层；headscale 实测发现的"MeshKey 必须整字段省略"已修入 client.ts（DELIVERY §5.3，本次未对真机复验）。

## 7.6 disco（38 用例）
- **已实现且有测试**：wrapper "TS💬"(54 53 f0 9f 92 ac)+发端公钥+nonce+secretbox（tweetnacl 双向互验，wrapper.test.ts 6）；Ping/Pong/CallMeMaybe 0x01–0x03 编解码（宽松解析语义逐条保留：CallMeMaybe 畸形→空列表不抛错，messages.test.ts 7）；**relay 家族 0x04–0x09**：Bind 0x04/05/06（74B 整帧 hex 锚、version 字节不检查）、UDPRelayEndpoint（124B+18N、bigint 槽位）、CallMeMaybeVia 0x07（encode 允许 N=0 而 decode 拒绝的非对称如实保留）、Allocate 0x08/09（70B/130+18N 整帧 hex）、bind 握手状态机（Init→BindSent→AnswerSent/AnswerReceived，非法迁移抛 RANGE）、Generation 经注入 Rng（relay.test.ts 25）。
- **未接线（关键限定）**：0x04–0x09 只到"编解码+握手状态机"为止，全仓无任何 UDP relay 客户端/数据面消费它；peerconn.ts:44 原文"边界（不实现，如实记录）：UDP peer-relay/relayManager 与 disco 0x04-0x09 属子线"；control 包也**不 import disco**（§3.1 导入面 grep 实证）——peerconn 的 disco Ping/Pong/CMM 是经 PeerSink 注入接口的语义位，实际密封/收发由 bridge 的 ShellDiscoClient 在 mock 总线上演练（disco-netcheck.test.ts 6 例）。

## 7.7 netcheck（64 用例）
- **已实现且有测试**：STUN Binding 编解码（SOFTWARE="tailnode"+FINGERPRINT CRC32-IEEE、RFC 5769 §2.2/§2.3 官方向量、MAPPED 回退、StunTransaction 配对，stun.test.ts 8）；探测计划（initial/增量全系列上游向量：v6 轮换、try_harder_for_preferred_derp 的 0/12/124/186 手算锚、home 强制纳入、sortRegions，plan.test.ts 19）；**引擎调度**（端到端回包脚本、重传去抖、3-region 早停、OnlyTCP443/OnlySTUN、UDP 全败回退候选、captive portal 强制全量、全量 5min 周期、并发重入显式报错、HTTPS/ICMP 回退合并、Report.clone 深拷，engine.test.ts 34）；历史窗（305s 边界、每分钟一场不变量，history.test.ts 3）。
- **仅接口/未实现**：真实 UDP socket/ICMP/HTTPS 探测与端口映射协议（UPnP/PMP 全部经 sender/DNS/PortMapper 注入）；唯一包外消费者是 bridge mock（mock-udp-bus+shell-discovery）。

## 7.8 control（141 用例）
- **已实现且有测试**：TLV 本地契约层（tlv.test.ts 10）；类型化消息 RegisterRequest/Response/NetworkMap（messages.test.ts 9）；tailcfg JSON 层（Version=148、AuthKey、nodekey: 前缀、MapRequest Stream+DiscoKey）与 HttpOverNoiseReader（chunked/Content-Length）（interop.test.ts 8）；ControlClient 全生命周期（dial/send/receive、跨 chunk+backlog、会话恢复、AEAD 失步→close+dial 重建、尺寸预检 65519B、错误路径 body.close，client.test.ts 14）；netaddr 前缀算术（9）；**netmap 状态机**（全量/增量裁决序、patch 字段级、过期防御+badOldPrefix 破钥、ControlTime 时钟偏移、knob 只从 self CapMap，netmap.test.ts 14）；**netmap→WG 推导**（self 地址/子网路由/exit node/双剪枝/diffWgPeers upsert-removal，wgderive.test.ts 11）；**peer 连接状态机**（bestAddr 信任期 6.5s、心跳 3s/idle 45s、迟滞切换、候选删除三分支、CMM 防循环、expired 拒发、wireguard-only 探测限速，peerconn.test.ts 24）+DerpRouteTable（home 迁移门控/60s 回收）；**LocalAPI**（ipn.State 表、watch mask 位表、handlerForPath、Referer/Origin/Host/BasicAuth 守卫、MaskedPrefs、ipn.Notify 行编解码、状态机副作用，localapi.test.ts 14）；**PeerAPI**（crc32 端口推导公式、Services 通告、validate 请求、ExitDNS 授权链，peerapi.test.ts 9）；**MagicDNS**（66 条权威后缀、dnsConfigForNetmap 规则、ResolverCore 决策序（.onion→NXDOMAIN/符号名→quad-100/NOTIMP 不截胡/TTL 5·10/TC 4095）、PTR 反解（magicdns.test.ts 19）。
- **仅接口/mock/未实现**：LocalAPI/PeerAPI 只有协议语义纯逻辑层+bridge mock server，无真实 IPC socket/HTTP listener；PacketFilter 只"存在性探测"不执行（netmap.test.ts 末例明示）；DNS wire format（dnsmessage 打包）未做——/dns-query 的 Bytes 字段与 POST DoH 以 501/结构化视图表达（worklog.md:32 遗留）；4via6 合成名未做（同处）；derp/UDP 数据面注集均为注入接口。

## 7.9 app/bridge（30 用例，mock 层）
- **已实现且有测试**：MockHttpTransport（路由/留痕/断网注入，bridge.test.ts 7）；壳会话 login→pollMap+authKey 明文零传输字节级断言（同上）；STUN 探测+disco Ping/Pong/CMM 全链路在内存总线（disco-netcheck.test.ts 6）；MockLocalApiServer 守卫→路由→权限→handler+watch 流（localapi.test.ts 8）；MockPeerApiServer 校验+ExitDNS+畸形 q 负例（peerapi-tun.test.ts 前 4 例）；TUN mock 三件（FakeTunDevice NewFake 语义、TsTunWrapper cork/出入站过滤/DNAT、TunCable 双端网线，peerapi-tun.test.ts 后 5 例）。
- **本质**：全部为内存 mock——这是壳侧唯一存在的"集成"形态，真机数据面为零。

---

*本报告所有数字出自第 2 节命令的原样输出与第 3 节的 find/grep/git 统计；未运行过的检查一律标注为未运行。报告生成后未改动仓库任何既有文件。*
