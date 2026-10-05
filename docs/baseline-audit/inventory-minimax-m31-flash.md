独立盘点 · MiniMax M3.1 Flash · HEAD 90ed53e · 2026-10-03

> 本报告为三份互不通气的独立盘点之一。未读取 `docs/baseline-audit/` 下任何既有内容；
> 未修改仓库任何既有文件（唯一新增文件即本文件）。所有数字均来自第 2 节的运行记录，
> 环境为 Windows / Git Bash / Node v22.23.2 / npm 10.9.8。

---

## 0. 元信息

| 项 | 值 |
|----|----|
| 仓库 | `D:\new-workspace\ohos-tailscale` |
| HEAD | `90ed53e`（`git rev-parse --short HEAD` 实跑） |
| 分支 | `main`，工作区 clean |
| 提交总数 | 22（`git log --oneline \| wc -l`） |
| 运行时 | Node v22.23.2（`node -v`，perf 输出内嵌 `{"node":"v22.23.2"}`）；平台 win32 |
| Python | 可用（`interop:test:upload` 集成层实跑调用成功） |
| 缺席工具链 | DevEco Studio、HarmonyOS SDK、headscale 二进制 |
| 盘点方法 | 只报告本次亲自运行验证过的事实；未运行的一律标 B/C |

**标记约定**：A=本次实测验证通过（附命令与输出摘录）；B=代码存在但本次未运行；C=仅文档/历史声明本次无法验证；D=与实测矛盾。

---

## 1. 执行摘要（10 条硬结论）

1. **协议核心库是本仓唯一真正站得住的资产。** `npm test` 实测 495/495/0 失败、退出码 0。逐包复跑得 40+35+39+60+58+38+141+84 = **495**，与全量精确对齐，无隐藏跳过。
2. **README 的"495/30/66"是当前真相，"280/13/54"是过期残留。** 但 README 同一文件内**并列保留了两张门禁表**（`README.md:35-38` 与 `:42-45`），表头同为 G0-1…G0-5，读者无从分辨。实测前者全对，后者全错。
3. **`npm run typecheck:bridge` 红灯——CI 完全不跑这一门。** 实测 exit 2：`peerapi-tun.test.ts(246,5): error TS2353: 'selfAddresses' does not exist in type 'DnsAnswerFn'`。由安全修复 commit `e136900` 引入（`git log -S"selfAddresses"` 确认），而 `g0-gates.yml` 六个 step 里没有它——**绿灯掩盖了一个真实类型错误**。
4. **D4/P4 机检实跑为真。** 复跑 CI 原样 grep：P4/node:/D4 三门均 0 命中。原始 4 处 `Date.now|Math.random` 全在注释（`common/src/clock.ts:2,5`、`random.ts:2`、`derp/src/region.ts:16`），103 处 `node:` 导入全在 `*/test/*.test.ts`。
5. **`app/` 壳"从未编译"属实。** 全仓 `find` 零构建产物（无 `.hap/.har/.app/build/oh_modules/.hvigor`）；`VpnExtensionAbility.ets:41-43` 三个数组全空并自带 `TODO(核心库对接)`。壳是配置与桩。
6. **09-29 "INTEROP PASS" 仓内无任何原始证据文件。** `git ls-files` 无 summary/evidence/result 产物，仅以 Markdown 散文存在于 README.md:48、DELIVERY_REPORT.md:208、TASK.md:67 等。**本次无法复跑验证（无 headscale 二进制）**，按 C 处理。
7. **`interop:regress` 的失败不只是缺环境，脚本自身也走不到 PASS。** 阶段 1 `ECONNREFUSED 127.0.0.1:8080`（环境缺失），但阶段 2 是 `usage: … <baseUrl> <authKey>`——`regress.mjs:59-61` 只传 1 个参数给 2 参脚本，**headscale 起来也必失败**；阶段 1 还硬编码假 preauthkey（`:57`）。
8. **commit 1c9b85b 的二期功能基本都真实落地并有测试**，与 README「已知问题 3」把其中 6 项列为"未做"**直接矛盾**（D）。唯一名副其实的是"TUN fd 接线"。
9. **两次安全修复证据强度不一。** `fcaf962` 的 `upload_server.test.mjs` 我实跑通过（单元 8/8 + 集成 7/7，Python 视角 inbox 仅 `["x.bmp"]`，exit 0）且已进 CI G0-6；`e136900` 的 `mock-peerapi` 负例被 `test:bridge` 覆盖并通过；但 `e136900` 改的 `arkts-check.js` **本机根本跑不起来**（exit 1），修复零验证。
10. **文档漂移已漂到代码描述层。** README:10 称"约 8400 行"（实测 **16904 行**）、README:12 称 54 用例（同文件 :38 写 66）、CONTEXT.md:15 写 bridge 29 pass（实测 30）、DELIVERY_REPORT.md:60 写 control "6 文件/1066 行"（实测 17/7303）、TASK.md 门槛仍 `≥280`/`≥54`。

---

## 2. 实测验证记录

### 2.1 `git rev-parse --short HEAD`

```
$ git rev-parse --short HEAD
90ed53e
```

退出码 0。解读：盘点基线为 `90ed53e chore: gitignore 补 Python __pycache__…`。

### 2.2 `npm test`（全仓测试）

```
$ npm test
…
1..495
# tests 495
# suites 0
# pass 495
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 16167.1757
EXITCODE=0
```

解读：**A**。495 通过 / 0 失败 / 0 跳过，退出码 0。这是本仓最硬的一条。

**逐包复跑**（确认 495 的分布）：

```
$ for p in common crypto noise wireguard derp disco control netcheck; do
    node --test packages/$p/test/*.test.ts | grep -E '^# (tests|fail)'
  done
common: tests=40 fail=0     crypto: tests=35 fail=0
noise:  tests=39 fail=0     wireguard: tests=60 fail=0
derp:   tests=58 fail=0     disco:  tests=38 fail=0
control: tests=141 fail=0   netcheck: tests=84 fail=0
```

合计 **495**，与全量一致。注：`grep -rhoE "^\s*(test|it)\("` 粗计得 475，低估 20 条（netcheck 65→84），**粗计法不可用**，以本表为准。

### 2.3 `npm run typecheck`

```
$ npm run typecheck
> tsc --noEmit -p .
EXIT=0
```

**A**。无任何输出，退出码 0。注意此门只覆盖根 `tsconfig.json`（即 `packages/**`），**不含 `app/bridge`**。

### 2.4 `npm run typecheck:bridge` —— 真实失败

```
$ npm run typecheck:bridge
> tsc --noEmit -p app/bridge
app/bridge/test/peerapi-tun.test.ts(246,5): error TS2353: Object literal may only
specify known properties, and 'selfAddresses' does not exist in type 'DnsAnswerFn'.
EXIT=2
```

按要求**重试一次**，结果完全相同（`EXIT=2`）；另用 `npx tsc --noEmit -p app/bridge` 独立复跑，同样 `EXIT2=2`。故非瞬态，**判定为真实失败而非环境问题**。

根因（本次亲自读到）：
- `app/bridge/test/peerapi-tun.test.ts:81` — `const makePeerServer = (answerDns: MockPeerApiConfig['answerDns']): MockPeerApiServer => {`
- `app/bridge/src/mock-peerapi.ts:60` — `export type DnsAnswerFn = (name: string, qtype: number) => DnsResolveOutcome;`
- `app/bridge/test/peerapi-tun.test.ts:245` — 传入的是一个**整份 config 对象字面量**（含 `selfAddresses/peerPackets/listeners/answerDns/offersExitNodeOrAppConnector/filterAcceptsTcp53`），被当成 `answerDns` 位置参数。
- `git log --oneline -1 -S"selfAddresses" -- app/bridge/test/peerapi-tun.test.ts` → 引入者正是 `e136900`（安全修复 commit）。

为何 495/30/66 仍然全绿：`node --test` 对 TS 只做类型擦除不做类型检查，该测试在运行时只断言 9 条 `status === 400`（畸形 q 全部在校验层被拒，**早于** `answerDns` 被调用），所以错位传参在运行时无害、在编译期致命。**CI 不跑此门**（见 §3.5.1），因此该类型错误从未被任何门禁捕获。

### 2.5 `npm run test:bridge`

```
$ npm run test:bridge
1..30
# tests 30
# pass 30
# fail 0
# duration_ms 954.3851
EXIT=0
```

**A**。逐文件复跑：`bridge.test.ts`=7、`disco-netcheck.test.ts`=6、`localapi.test.ts`=8、`peerapi-tun.test.ts`=9，合计 **30**，吻合。

### 2.6 `npm run validate:shell`

```
$ npm run validate:shell
…
[PASS] V9 bridge index exports C3 wiring — C3 三面（LocalAPI/PeerAPI/TUN）经 barrel 对壳可见
summary: 66 passed, 0 failed
EXIT=0
```

**A**。按检查前缀分桶（我对 66 行 `[PASS]` 输出做 `grep -c`）：

| 前缀 | 含义（据 `app/tools/validate-shell.mjs:7-16,236-238`） | 条数 |
|------|------|------|
| V1 | .json5/.json 可解析 + hvigor 文件存在 | 14 |
| V2 | module.json5 abilities/extensionAbilities srcEntry 在盘、type==="vpn"、mainElement | 4 |
| V3 | INTERNET + GET_NETWORK_INFO 权限声明 | 2 |
| V4 | main_pages.json 路由 ↔ pages/*.ets 双向对账 | 2 |
| V5 | .ets 内 `$r(app.string/color/media.*)` ↔ 资源定义 | 20 |
| V5b | module.json5 内 `$string:/$color:/$media:` 对账 | 7 |
| V6 | bundleName：app.json5 ↔ Index.ets 常量 | 1 |
| V7 | VPN_ABILITY_NAME ↔ module.json5 | 1 |
| V8 | 占位图标 PNG IHDR 尺寸 216×216 / 96×96 | 3 |
| V9 | bridge 三 mock 的纪律机检 + barrel 导出 | 12 |
| **合计** | | **66** |

**54 → 66 的构成已实证**：V9 是 commit `1c9b85b`（`git show 1c9b85b -- app/tools/validate-shell.mjs`，+39 行）新增的唯一一组，恰为 12 条 = 3 文件 ×（no node: 导入 + no Date.now/Math.random + 接线锚定）9 条 + 2 条"测试文件在盘" + 1 条"barrel 导出 C3 三面"。**54 + 12 = 66** 成立。

口径问题：脚本文件头 `validate-shell.mjs:6-16` 自述只列到 V8，**V9 未入文件头注释**——docstring 与实现脱节。

### 2.7 `npm run interop:test:upload`

```
$ npm run interop:test:upload
[1] 单元层（修复后判定）：8 pass / 0 fail（共 8 条攻击向量）
[1] path.resolve 二次校验：4 条全部判定正确 ✓
[2] 集成层：直接调 upload_server.H.do_POST
[2] inbox 落盘文件（Python 视角，已用 os.listdir 同进程读取）：["x.bmp"]
[2] 集成层：7 pass / 0 fail（共 7 条）
=== upload_server.py 路径穿越防御实证 PASS（单元 + 集成） ===
EXIT=0
```

**A**。这是 fcaf962 修复的实证闭环，单元 + 集成双层，Python 视角确认攻击未落盘。我读 `upload_server.py:24-49` 确认修复本体：先 `urllib.parse.unquote(self.path)`（:24）再 `strip("/").split("/")`（:25），随后显式拒 `parts[2]` 含 `/`（:34）、`\`（:35）、`\x00`（:36），再白名单 `^[A-Za-z0-9._-]{1,255}$`（:16,:41），最后 `os.path.realpath` 二次锚定（:46-47）。与"inbox 仅 x.bmp"一致。

**测试文件自身注释陈旧**：`upload_server.test.mjs:10-11` 头注释写"13 条攻击向量 / 实跑 Python server + curl"，实际是 **8 条**向量（`:39-48` 数组实长 8）、集成层为 importlib 直调 `H.do_POST`（`:83-85` 自陈"不起 Python HTTP server"）。头注释为改前残留。

### 2.8 D4 / P4 机检（复跑 CI 原样 grep）

`g0-gates.yml:66-87` 的三段 grep 逐字复跑（脚本置于仓库外 `%TEMP%\inv-d4.sh`，因 Write 工具被安全钩子拒绝对仓库内写脚本）：

```
--- P4: Date.now / Math.random（非注释行）---
P4 after filters: (empty)
--- node: 导入（非测试文件）---
node: after filter: (empty)
--- D4: 网络/builtin 特征 ---
raw D4 pattern hits: (none)
(D4 empty: 0 hits)
```

**A，三门全部 0 命中**，与 CI 一致。透明起见，报告过滤前的原始命中：

- `Date\.now|Math\.random` 原始 4 条，**全部是注释行**：`packages/common/src/clock.ts:2,5`、`packages/common/src/random.ts:2`、`packages/derp/src/region.ts:16`（均为 `* P4：…禁 Date.now()/Math.random()` 之类说明文字）。
- `from 'node:` 原始 **103 条**，逐条核对后**全部位于 `packages/*/test/*.test.ts`**，被 CI 的 `grep -v '\.test\.ts:'` 正确滤除。
- D4 网络特征（`fetch(`/`XMLHttpRequest`/`WebSocket`/`from 'net|dgram|http|…'`）原始即 0。

结论：核心库"零网络 + 无非确定来源"这一硬约束**在 grep 口径上真实成立**（A）。局限须注明：grep 只证明"没有这些字面量"，不排除其他 I/O 途径（如经注入的 transport 回调做网络 I/O）——`packages/common/src/http.ts` 与 `packages/control/src/noisehttp.ts` 正是注入式 HTTP 抽象。

### 2.9 `npm run perf:baseline`

```
$ npm run perf:baseline
{"node":"v22.23.2","iter":200,"warmup":20,"mean_ms":3.5723,"p50_ms":3.4862,
 "p95_ms":4.3839,"p99_ms":4.882,"ops_per_sec":279.93,"sink":"0"}
  mean=3.5723 ms/op (~279.93 ops/s)
基线 09-29: 5.25 ms/op ~190 ops/s（同一测法；本机 win32 / Node v22.23.2）
vs 基线：0.68× （快31%）
EXIT=0
```

**A**。x25519 标量乘 **3.5723 ms/op**（200 iter / 20 warmup，注入真实 node crypto 随机源，`sink:0` 证明结果未被优化掉）。README 标称 3.62、commit `0962ada` 标称 3.62，本次实测 **3.5723**——同量级、微优于文档值，非矛盾。9-29 基线 5.25 → 现 3.57，快约 32%（脚本自报 31%）。**注意**：这是同机同测法纵向比较，非跨机基准；未在真机 ArkTS 运行时复测。

### 2.10 `npm run interop:regress` —— 失败，性质需拆分

```
$ npm run interop:regress
>>> 阶段：控制面注册（RegisterRequest + MapRequest）
FAIL: connect ECONNREFUSED 127.0.0.1:8080
>>> 阶段：DERP 客户端 + Ping/Pong
FAIL: usage: node --experimental-strip-types interop/derp.node.ts <baseUrl> <authKey>
>>> 阶段：HTTP/2 over Noise（h2c）
=== 判定字符串 ===
INTEROP FAIL
DERP INTEROP FAIL
摘要写入：C:\Users\ADMINI~1\AppData\Local\Temp\1\interop-regress-rAxuyS\summary.json
EXIT=1
```

**逐阶段定性（关键：不能一概归为"环境缺失"）**：

| 阶段 | 现象 | 定性 |
|------|------|------|
| 1 控制面注册 | `ECONNREFUSED 127.0.0.1:8080` | **C — 环境缺失**。本机确无 headscale（`HS` 默认 `http://127.0.0.1:8080`，`regress.mjs:30`）。 |
| 2 DERP | `usage: … <baseUrl> <authKey>` | **D — 产品/脚本缺陷**。`regress.mjs:59-61` 只传 `[ 'interop/derp.node.ts', HS ]`（1 个参数），而 `interop/derp.node.ts:39` 要求 2 个。**与 headscale 是否在跑无关，必失败。** |
| 3 h2c | 无输出，被前序判定吞掉 | 未独立取证（B）。 |

另有一处即便补齐环境也会挡路：`regress.mjs:57` 给阶段 1 硬编码了假 preauthkey `'regress-dummy-preauthkey'`，真实 headscale 会拒绝该 key。

`runStage`（`regress.mjs:35-47`）本身写得对——用 PASS 标记串 + usage 检测而非仅看退出码；但由于阶段 2 传参错误，**该脚本当前形态不可能输出 `INTEROP PASS`**。历史 PASS 只能靠手工分别跑三个 `.node.ts` 取得（与 README:48"一次性历史证据"自洽）。

### 2.11 附加实跑：`interop/arkts-check.js` 无法运行

```
$ node interop/arkts-check.js .
file:///D:/new-workspace/ohos-tailscale/interop/arkts-check.js:4
const fs = require('fs');
           ^
ReferenceError: require is not defined in ES module scope
… because … 'D:\new-workspace\ohos-tailscale\package.json' contains "type": "module".
EXIT=1
```

**两层阻塞**：(1) 根 `package.json` 有 `"type": "module"`，而该文件是 CommonJS（用 `require`），`.js` 扩展名在 Node 22 下被当 ESM → 立即崩；(2) 即便修好，`interop/arkts-check.js:5` 硬编码 `require('/home/dev/sdk/ets/ets/build-tools/ets-loader/node_modules/typescript')`，是 WSL 下的华为 SDK 路径，Windows 本机不存在。

**结论：`e136900` 对 `arkts-check.js` 的路径穿越修复（`walk` 改用 `withFileTypes` 跳过 symlink + `scanRootReal` 必须落在 `repoReal` 下否则 `exit(2)`）在本次盘点中完全无法验证，记为 B。** 这是两次安全修复中唯一未被任何测试覆盖的一处。

---

## 3. 组件级清单

### 3.1 `packages/` 逐包（8 个 workspace 包）

规模由本次 `wc -l` 与 `node --test` 实测；用例数为该包独立复跑值。

| 包 | 职责（据文件名与导出） | src 文件/行 | test 文件/行 | 用例 | 失败 | 主要对外能力 |
|----|------|----|----|----|----|------|
| `common` | 底层原语：bytes/base64/hex/utf8/clock/random 注入/http 抽象/常量 | 9 / 747 | 7 / 524 | 40 | 0 | `bytes.ts` `hex.ts` `base64.ts` `utf8.ts`；`clock.ts` `random.ts`（P4 注入接口）；`http.ts`（transport 抽象） |
| `crypto` | 密码学：x25519/xchacha20-poly1305/aead/chacha20poly1305/blake2s/sha256/hmac/nacl box | 8 / 1354 | 6 / 1001 | 35 | 0 | `x25519.ts` `xchacha.ts` `aead.ts` `hash.ts` `naclbox.ts` |
| `noise` | Noise 协议：握手/帧/对称态/transport + controlbase v148 | 7 / 898 | 7 / 1881 | 39 | 0 | `handshake.ts` `frame.ts` `symmetric.ts` `controlbase.ts` `transport.ts`；含 `external-vector.test.ts` 外部向量比对 |
| `wireguard` | WireGuard 数据面：握手/cookie/reply/replay/dispatch/peers/tai64n | 10 / 1952 | 7 / 2074 | 60 | 0 | `handshake.ts` `cookie.ts` `cookie-reply.ts` `dispatch.ts` `peers.ts` `tai64n.ts` |
| `derp` | DERP 中继：client/frame/region 选点/regiondial | 6 / 977 | 4 / 1302 | 58 | 0 | `client.ts` `frame.ts` `region.ts`（`DerpRegionPicker`/`pickNode`/`pickHomeRegionFallback`/`rngIntN`）`regiondial.ts` |
| `disco` | disco 发现协议：消息编解码 + relay 家族 0x04–0x09 | 5 / 1385 | 3 / 797 | 38 | 0 | `messages.ts`（类型码表 0x01–0x09）`relay.ts`（`DiscoRelayMessageType` 0x04–0x09）`wrapper.ts` |
| `control` | 控制面与语义核心：netmap/tailcfg/LocalAPI/PeerAPI/MagicDNS/netmap→WG/连接状态机/noise HTTP | 17 / 7303 | 11 / 3697 | 141 | 0 | `netmap.ts` `localapi.ts` `peerapi.ts` `magicdns.ts` `wgderive.ts` `peerconn.ts` `derproute.ts` `netaddr.ts` `tlv.ts` `smconsts.ts` `client.ts` `noisehttp.ts` |
| `netcheck` | 网络探测：engine/plan/stun/regions/report/opt/probe/addr | 10 / 2288 | 4 / 1894 | 84 | 0 | `engine.ts`（`NetcheckEngine`）`plan.ts`（`makeProbePlan`）`stun.ts` `regions.ts` `report.ts` |
| **合计** | | **72 / 16904** | **49 / 11570** | **495** | **0** | |

`git ls-files packages | grep -c '\.ts$'` = 121（72 src + 49 test，与上表自洽）。

**测试密度观察**：测试行数（11570）多于 src 行数（16904 的 68%），`noise`（1881/898=2.1×）与 `wireguard`（2074/1952=1.06×）、`netcheck`（1894/2288）偏高。`control` 虽最大（7303 行）但测试比最低（3697/7303=0.51×），是密度最薄的包——而它恰是二期功能最密集处。

### 3.2 `app/`（鸿蒙工程壳）——真实形态

```
app/  （37 个文件）
├─ AppScope/（app.json5 + string.json + app_icon.png 216×216）
├─ build-profile.json5  ├─ hvigorfile.ts  ├─ oh-package.json5  ├─ hvigor/hvigor-config.json5
├─ entry/（build-profile.json5 + hvigorfile.ts + oh-package.json5）
│  └─ src/main/  module.json5（权限 + EntryAbility + VpnExtensionAbility type:vpn）
│     ├─ ets/entryability/EntryAbility.ets
│     ├─ ets/pages/Index.ets        ← BUNDLE_NAME / VPN_ABILITY_NAME 常量所在
│     ├─ ets/vpnextensionability/VpnExtensionAbility.ets
│     └─ resources/base/（element/*.json、media/*.png、profile/main_pages.json）
├─ bridge/  ← 唯一"有真实逻辑并被测试"的部分
│  ├─ src/（10 文件 / 2274 行：mock-localapi 662、mock-peerapi 203、mock-tun 311、
│  │        shell-discovery 247、mock-udp-bus 192、shell-session 193、
│  │        mock-http-transport 153、mock-control-plane 144、index 97、shell-status 72）
│  └─ test/（4 文件 / 1174 行 = 7+6+8+9 = 30 用例）
└─ tools/validate-shell.mjs（66 项机检）
```

**"从未编译"的证据（三条，本次亲自取得）**：
1. **无任何构建产物**：全仓 `find`（排除 node_modules/.git）搜 `*.hap`、`*.har`、`*.app`、`build/`、`oh_modules/`、`.hvigor/`、`output/` —— **零命中**。`git ls-files` 中无任何产物文件（仓内仅有 15 个 `.json`，全是配置）。
2. **源码自陈桩状态**：`app/entry/src/main/ets/vpnextensionability/VpnExtensionAbility.ets:41-43`
   ```ts
   addresses: [],        // TODO(核心库对接)：填入 LinkAddress[]（当前为空，真实调用会失败——桩仅示意流程）
   routes: [],           // TODO(核心库对接)：填入 RouteInfo[]
   dnsAddresses: [],     // TODO(核心库对接)：['100.100.100.100']（MagicDNS，可选）
   ```
   即：即便编译通过，`VpnConnection.create()` 也会失败——**TUN fd 与核心库的收发接线确实未做**（这是 README「已知问题 3」中唯一属实的条目）。
3. **文档自陈**：`app/README-app.md:5` "本机**无 DevEco Studio 与 HarmonyOS SDK，本工程从未编译**"；`app/tools/validate-shell.mjs:5` 同义；`docs/build-feasibility-linux.md` 成文论证。

**结论：`app/` 不是一个可运行的客户端，而是「配置骨架 + 一个被测得很扎实的 bridge mock 层 + 一份 66 项静态资源校验器」。** bridge 层是真代码真测试（30 用例全绿），但它跑在 Node 里，**与鸿蒙运行时之间没有任何已验证的连接**。

### 3.3 `interop/`（12 个文件，1286 行 mjs/py/ts）

| 文件 | 是什么 | 本机可跑？ |
|------|------|------|
| `regress.mjs`（75 行） | 三阶段 headscale 回归编排器，输出 `INTEROP PASS`/`DERP INTEROP PASS` 判定串 | **否**（实测 exit 1：阶段 1 缺 headscale；阶段 2 传参错误，必失败） |
| `register.node.ts`（291 行） | 阶段 1 实现：RegisterRequest + MapRequest，需 `<baseUrl> <authKey>` | 否（需 headscale + 有效 preauthkey） |
| `derp.node.ts`（367 行） | 阶段 2 实现：DERP 客户端 + Ping/Pong，需 `<baseUrl> <authKey>` | 否（同上） |
| `h2c.node.ts`（281 行） | 阶段 3 实现：HTTP/2 over Noise（h2c） | 否（同上） |
| `headscale.yaml`（996 B） | 隔离 headscale 实例配置样例 | 配置件 |
| `start-headscale.sh`（567 B） | 起隔离 headscale 容器/实例 | 需 Docker + 网络 |
| `upload_server.py`（76 行） | hk-gateway 回传收件箱真服务端（`/srv/inbox`，一次性 token，仅写不读） | 是（本次被 G0-6 实证驱动调用） |
| `upload_server.test.mjs`（196 行） | fcaf962 路径穿越防御实证（单元 8 + 集成 7） | **是 —— 实测 exit 0** |
| `arkts-check.js`（~4 KB） | 驱动华为 ets-loader 内置 ArkTSLinter 扫 `packages/` | **否**（实测 exit 1：ESM/CJS 冲突 + 缺 WSL SDK 路径） |
| `arkts-mirror.sh`（1.2 KB） | `.ts → .ets` 镜像，供 arkts-check 离线复建路径（`ARKTS_SCAN_ALLOW_EXTERNAL=1`） | 否（依赖上条） |
| `__pycache__/` | fcaf962 误提交的 `.pyc` | 已在 `90ed53e` 加入 .gitignore |

### 3.4 `scripts/`（1 个文件）

| 文件 | 是什么 | 本机可跑？ |
|------|------|------|
| `perf-baseline.mjs`（91 行） | x25519 标量乘性能基线，200 iter / 20 warmup，注入真实 node crypto 随机源 | **是 —— 实测 exit 0，3.5723 ms/op** |

`scripts/` 是全仓唯一"纯本机、无外部依赖、可直接产出可复现数字"的目录。

### 3.5 工程与质量体系专章

#### 3.5.1 `g0-gates.yml` 逐 job 解读

**Job `g0`（name: `G0 五门 / <os>`）** —— 双平台矩阵 `[ubuntu-latest, windows-latest]`，`fail-fast: false`，`shell: bash`。环境：Node 22（`setup-node@v4`，`cache: npm`）+ `npm ci --no-audit --no-fund`。六个 step：

| Step | 命令 | 平台 | 本次本地复跑结果 |
|------|------|------|------|
| G0-1 | `npm test` | 双平台 | ✅ 495/0，exit 0 |
| **G0-6** | `npm run --silent interop:test:upload` | 双平台（前置 `setup-python@v5`，Python 3.11） | ✅ 单元 8/8 + 集成 7/7，exit 0 |
| G0-2 | `npm run typecheck` | 双平台 | ✅ exit 0 |
| G0-3 | `npm run test:bridge` | 双平台 | ✅ 30/0，exit 0 |
| G0-4 | `npm run validate:shell` | 双平台 | ✅ 66/0，exit 0 |
| G0-5 | 内联 bash 三段 grep（P4 / node: / D4） | 双平台（`shell: bash` 强制） | ✅ 三门 0 命中 |

**G0-6 是什么**：`fcaf962` 新增的第 6 个门（`g0-gates.yml:48-55`），是**本仓唯一的真服务端安全实证门**——在 CI 里装 Python 3.11，用 `interop/upload_server.test.mjs` 驱动真实的 `upload_server.py`（importlib 直调 `H.do_POST`），对路径穿越攻击向量断言必拒，并验证合法请求落盘仅 `x.bmp`。它的意义在于：这是唯一一个"测的是外部真代码、而非本仓 TS 逻辑"的门，直接回应 Mimosa L2 的 `..%2f` 任意覆盖漏洞。

**G0-5 的两处工程细节**（`g0-gates.yml:76-79` 注释）：grep -n 输出形如 `path:line:content`，行末是**行号**不是文件名，所以排除测试文件必须匹配路径里的 `.test.ts:` 而不能用 `$` 锚定——该注释与 commit `5c3db5e` 修复的过滤器 bug 对应，是真实踩坑记录。

**未被任何门覆盖的**：❌ `npm run typecheck:bridge`（红灯，见 §2.4）❌ `npm run interop:regress`（需 headscale，CI 明确不跑）❌ `npm run perf:baseline`（perf 不设门）❌ `interop/arkts-check.js`（需 WSL+SDK）。

**Job `docs-consistency`（name: `文档口径一致`）** —— `runs-on: ubuntu-latest` 单平台。逻辑（`g0-gates.yml:99-127`）：实跑 `npm test`/`test:bridge`/`validate:shell` 抓取真实数字，再 `grep -q` 检查 `README.md` `CONTEXT.md` `DELIVERY_REPORT.md` `docs/architecture.md` 是否**包含**实测值；不含则发 `::warning`。

**这个 job 的严重缺陷（本次实证）**：它只检查"文档**含不含**该数字"，不检查"文档**是否还含旧数字**"。因此 §1.10 点名的全部漂移（README 的 280/13/54 并存、README:12 的 54、CONTEXT.md:15 的 29 pass、DELIVERY_REPORT.md:60 的 1066 行）**全部能通过这个门**——实测 `npm test` 给出 495，而 README.md 里 495、280 两个数都在，`grep -q 495` 判过。**它是一个只防"漏写"、不防"错写"的一致性检查，且 warning 不阻断（无 `exit 1`）。**

#### 3.5.2 两次安全修复的实证强度评级

| 修复 | 修的对象 | 对应实证 | 本次是否运行 | 强度 |
|------|------|------|------|------|
| **e136900** ① | `app/bridge/src/mock-peerapi.ts` `answerDns` 输入校验（长度 ≤253、字符集 `[A-Za-z0-9._-]`、拒 `..`、拒前导 `.`） | `app/bridge/test/peerapi-tun.test.ts:244-260` 负例：9 个畸形 q（`..`/`a..b`/`.`/`''`/254 字符/`a b`/`a/b`/`a\b`/`a\x00b`）全断言 400 | ✅ 经 `npm run test:bridge`（30/30）覆盖 | **强**：真代码 + 真断言 + 真跑过 |
| **e136900** ② | `interop/upload_server.py` 白名单 + realpath 二次校验 + 截断丢弃 | 被 `fcaf962` 的 `upload_server.test.mjs` 覆盖升级 | ✅ 见下 | **强** |
| **e136900** ③ | `interop/arkts-check.js` walk 跳 symlink + `scanRoot` realpath 须落在 `repoReal` | **无任何测试** | ❌ 本机跑不起来（§2.11） | **弱**：仅代码存在，无法验证，且本机根本执行不了 |
| **fcaf962** | `upload_server.py` unquote 顺序（先 decode 再 split）+ 显式拒 `parts[2]` 含 `/`/`\` | `interop/upload_server.test.mjs`：单元 8 向量 + path.resolve 4 例 + 集成 7 条 | ✅ 实测 exit 0，且已进 CI G0-6 | **最强**：单元+集成双层、Python 视角验落盘、CI 双平台常驻 |

**fcaf962 修复的必要性有实测支撑**：`upload_server.py:19-23` 的注释精确复述了漏洞：旧顺序下 `/upload/<token>/..%2fetc%2fpasswd` 的 `parts[2]` 是**未解码的字面量**，`basename(unquote(...))` 得 `"passwd"`，绕过了 `..` 拒绝但**仍落 DST 覆盖任意同名单文件**。本次实测的 8 条向量中第 3 条 `/upload/__TOKEN__/..%2f..%2fetc%2fpasswd` 正是该向量，且集成层确认 DST 侧只有 `x.bmp`——**攻击未落盘，可信**。

#### 3.5.3 质量体系的其余观察

- **双重门禁覆盖不一致**：`packages/**` 被 `npm test`（运行时）+ `tsc -p .`（编译期）+ G0-5 grep（纪律）三重覆盖；`app/bridge/**` 只有 `node --test`（**无类型检查**）一重。e136900 的类型错误正是这个缺口的直接产物。
- **测试文件自身注释陈旧**：`upload_server.test.mjs:10-11` 写"13 条向量/curl"，实为 8 条/importlib（§2.7）；`validate-shell.mjs` 文件头只列 V1–V8，漏 V9。
- **命名与实现漂移**：`g0-gates.yml:1` 注释称"G0 五门"，实际 6 个 step（G0-6 由 `fcaf962` 新增），注释未更新。
- **无 lint / 无 formatter / 无 coverage 门**：`package.json` 无 eslint/prettier/c8 脚本；`tsconfig.json` 无覆盖率配置。

---

## 4. 声明 vs 实证对照表

### 4.1 必查项逐条裁定

| # | 声明（出处） | 裁定 | 证据 |
|---|------|------|------|
| 1 | 验收基线 **495 / 30 / 66**（README.md:35-38） | **A — 为当前真相** | §2.2 `npm test` 495/0；§2.5 `test:bridge` 30/0；§2.6 `validate:shell` 66/0 |
| 2 | 验收基线 **280 / 13 / 54**（README.md:42-45，与上一表并列） | **D — 过期残留但仍在发布面上** | 同上三跑推翻全部三个数。`worklog.md:21,23` 显示这是 2026-10-01 前的基线；`worklog.md:36` 记录 280→495 净增 +215。**README 未删除该表，属发布口径自相矛盾** |
| 3 | `app/` 壳**从未编译**（README.md:52、app/README-app.md:5） | **A — 属实** | §3.2：零构建产物 + `VpnExtensionAbility.ets:41-43` 空数组 TODO + 文档自陈 |
| 4 | 09-29 真实 headscale **INTEROP PASS**（README.md:48、DELIVERY_REPORT.md:208、TASK.md:67、docs/research/2026-10-02-D-interop-plan*.md） | **C — 仓内无原始证据，本次不可验证** | `git ls-files` 无任何 summary/evidence/result 产物；仅 Markdown 散文转引。缺 headscale 二进制 + 有效 preauthkey。**证据文件路径：不存在**（此即问题本身） |
| 5 | D4 核心库零网络 / P4 无非确定来源 | **A — 成立** | §2.8：三门 grep 全 0；原始 4 处 P4 命中全在注释、103 处 node: 全在测试文件 |
| 6 | 官方 ArkTS linter src 告警 154 → 0（README.md:48） | **C — 不可验证** | 需 WSL + OpenHarmony 7.0 SDK ets-loader。原始报告 `docs/arkts-linter-report-raw.txt` 在仓内可读（28387 B），但 `arkts-check.js` 本机 exit 1 无法复跑（§2.11） |
| 7 | x25519 perf 3.62 ms/op（README:40、commit 0962ada） | **A — 实测 3.5723 ms/op，略优于文档值** | §2.9 `{"mean_ms":3.5723,…,"ops_per_sec":279.93}` |
| 8 | 09-29 基线 5.25 ms/op | **A（同测法纵向）** | §2.9 脚本自算 `vs 基线：0.68× （快31%）` |
| 9 | `interop:regress` 失败因缺 headscale（README.md:53 隐含） | **D — 只对了一半** | §2.10：阶段 1 确为环境缺失；阶段 2 是 `regress.mjs:59-61` 传参 bug，**有 headscale 也必失败**；阶段 1 还硬编码假 key（:57） |
| 10 | CI 双平台跑 G0 五门（`g0-gates.yml`） | **A — 六个 step 本地全绿** | §2.2/2.3/2.5/2.6/2.7/2.8 六跑全过；`docs-consistency` job 逻辑见 §3.5.1 |

### 4.2 commit `1c9b85b` 二期功能逐条裁定

| 二期功能（commit message 声称） | 实现 | 测试 | 裁定 |
|------|------|------|------|
| disco relay 0x04–0x09 | `packages/disco/src/messages.ts:65,92`（类型码表 0x01–0x09）、`relay.ts`（`DiscoRelayMessageType`） | `disco/test/relay.test.ts` 12 条，含整帧 hex 断言、bind 家族、UDPRelayEndpoint 124B+18N、0x07 CallMeMaybeVia | **A — 真实落地且测试扎实**（disco 38/0） |
| netcheck 探测调度 | `packages/netcheck/src/engine.ts:200 NetcheckEngine`、`plan.ts:103,140 makeProbePlan*` | `netcheck/test/engine.test.ts` `plan.test.ts` `history.test.ts` `stun.test.ts` | **A — 真实落地**（netcheck 84/0） |
| DERP region 随机选节点 | `packages/derp/src/region.ts:111 DerpRegionPicker`、`:80 rngIntN`、`:61 derpUsableNodes`；`regiondial.ts` | `derp/test/regionpick.test.ts` 12 条，含"同 seed 可复现/不同 seed 不同结果"、"未注入 Rng 抛 Error"（P4） | **A — 真实落地**（derp 58/0） |
| netmap → WG 推导 | `packages/control/src/wgderive.ts:135 deriveWgPeer`、`:230 deriveWgConfig`、`:256 diffWgPeers` | `control/test/wgderive.test.ts` 11 条，含 exit 路由、剪枝、DisableIPv4、diff 语义 | **A — 真实落地**（control 141/0） |
| 连接状态机 | `packages/control/src/peerconn.ts:188 PeerEndpoint` | `control/test/peerconn.test.ts` 14 条，覆盖直连/DERP 降级、信任期、迟滞、CMM 释放、候选三分支删除、expired 拒发 | **A — 真实落地** |
| LocalAPI / PeerAPI / MagicDNS | `control/src/localapi.ts` `peerapi.ts` `magicdns.ts`（MagicDNS 含 ULA 反向区、TTL 常量、DnsType/RCode 表） | `control/test/localapi.test.ts` `peerapi.test.ts` `magicdns.test.ts` | **A — 真实落地** |
| TUN mock 接线 | `app/bridge/src/mock-tun.ts`（311 行）+ `index.ts` barrel 导出 `TsTunWrapper`/`MockIpnBackend` | `app/bridge/test/peerapi-tun.test.ts` 9 条（含双端内存网线 TunCable） | **B/D 分裂**：`app/bridge` 内**是 mock 且有测试**（A）；但 `app/entry/.../VpnExtensionAbility.ets:41-43` 的**真 fd 接线未做**（桩） |

**综合裁定**：`1c9b85b` 的 7 项宣称，**6 项真实落地且有实质测试**（多为逐条对齐上游 Go 源码行号的锚定测试，质量明显高于一般"测自己实现"的水平）；TUN 一项在 bridge mock 层成立、在鸿蒙壳层不成立。**而 README.md:54「已知问题 3」把这 6 项已实现项列为"二期未做项"，与实测直接矛盾（D）。**

### 4.3 全仓文档口径矛盾点名清单

| 矛盾 | 甲说法 | 乙说法 | 实测真相 |
|------|------|------|------|
| ① 门禁数字 | README.md:35-38 `495/30/66` | README.md:42-45 `280/13/54`（表头同为 G0-1…G0-5） | **495/30/66**（§2.2/2.5/2.6） |
| ② README 内部 | README.md:12 "validate:shell **54 用例**" | README.md:38 "**66** passed" | **66**（§2.6） |
| ③ bridge 用例数 | CONTEXT.md:15 "test:bridge **29 pass** / 0 fail" | README:37 / architecture.md:552 / docs/handover/README.md:17 / owner-with-real-device.md:27 / reviewer-pr-style.md:35 均写 30 | **30**（§2.5） |
| ④ 核心库规模 | README.md:10 "约 **8400 行**" | DELIVERY_REPORT.md:105 "六个包 … 5503 行"；DELIVERY_REPORT.md:60 "control 6 文件 / **1066 行**" | `packages/*/src` 实测 **16904 行 / 72 文件**；control **7303 行 / 17 文件**（§3.1）。**README 低估约一半；DELIVERY_REPORT 的"六包"口径已被其自身 §231 承认作废但正文未改** |
| ⑤ 二期状态 | README.md:54 列 disco 0x04-0x09、netcheck 调度、DERP 随机选点、netmap→WG、状态机、LocalAPI/PeerAPI/MagicDNS 为"**二期未做项**" | commit `1c9b85b` 声称全部实现；architecture.md:552 亦称已实现 | **已实现**（§4.2，仅 TUN 壳层未做） |
| ⑥ 门槛数字 | TASK.md:18 "tests **≥ 280**"、:21 "validate:shell **≥54**"、:60 "E-1 维持 ≥54"、:67 "280 测试全绿…bridge 13 用例" | README/architecture/handover 均为 495/30/66 | **495/30/66**。TASK 门槛因写"只增不减"故不误报，但**文本已过期** |
| ⑦ CONTEXT 自身 | CONTEXT.md:15 "495 pass…交付基线 217→一期 238→二期 495" | 同句 "test:bridge **29**"；且 TASK.md:28 仍把"A-3 修正 CONTEXT.md 的『6 包』『238 pass』"列为**未完成**待办 | CONTEXT 的 495 已改完，但**"6 包"是否已改需自查**（本次 grep 未在 CONTEXT 命中"六包/八包"，倾向已改） |
| ⑧ G0 门数 | `g0-gates.yml:1` name/注释"G0 **五门**" | 同文件实际 6 个 step（G0-6，`fcaf962` 新增） | **六门**；注释未更新 |
| ⑨ upload 测试规模 | `interop/upload_server.test.mjs:10-11` 头注释"13 条攻击向量 / curl" | `:39-48` 数组实长 **8**；`:83-85` 自陈"不起 Python HTTP server" | **8 条 / importlib 直调**（§2.7） |
| ⑩ validate-shell 自述 | `app/tools/validate-shell.mjs:6-16` 文件头只述 V1–V8 | 实现含 V9 共 10 类前缀 66 项 | **V9 存在但未入文件头**（§2.6） |
| ⑪ CI 文档一致性门能力 | `g0-gates.yml:121-126` 只 `grep -q` 数字"是否含" | 上述 ①②③④⑤⑥ 全部能过该门 | **该门只防漏写、不防错写，且 warning 不阻断**（§3.5.1） |

---

## 5. 未验证与不可验证项

### 5.1 需真机 / 需 DevEco（本机完全不可及）

- `app/` 壳编译（hvigor/DevEco 构建 HAP）——无 DevEco Studio、无 HarmonyOS SDK；`app/README-app.md:5` 自陈"从未编译"
- 官方 ArkTS linter（154 → 0）——需 WSL + OpenHarmony 7.0 SDK ets-loader
- **`e136900` 的 `arkts-check.js` 路径穿越修复**——**不可验证**：无测试、脚本本机跑不起来（§2.11）。**本仓唯一一处"安全修复零实证"的改动**
- VpnExtensionAbility 真实 fd 收发——源码自陈为空数组桩
- `app/bridge` 在 ArkTS 上可编译——bridge 是 Node 风格 TS，未在 ArkTS 编译器下验证
- 性能在真机 ArkTS 运行时——§2.9 的 3.57 ms/op 是 win32+Node22 数字；Perf 数字亦非跨机基准

### 5.2 需 headscale / 需外部网络

| 项 | 状态 | 缺什么 |
|----|------|-------|
| 09-29 `INTEROP PASS` + `DERP INTEROP PASS` 复现 | **C，不可验证** | headscale v0.29.4 二进制 + 隔离实例（`start-headscale.sh`+`headscale.yaml`）+ 有效 preauthkey（不入仓）。**且仓内无原始证据文件** |
| `npm run interop:regress` 跑到 PASS | **C + D** | 环境侧缺上述；**脚本侧另有硬伤**：`regress.mjs:59-61` 传参数不足、`:57` 假 preauthkey |
| 三个 `.node.ts` 单独复跑 | B | 同上 |
| 与真实 Headscale 的协议一致性 | C | 495 用例为仓内自洽测试 + 上游源码行号锚定断言（测试名可见 `disco.go:405-409`、`derphttp_client.go:637-657`），**但从未与真实服务端对拍** |

### 5.3 其他

- **`npm run typecheck:bridge`：非"不可验证"，而是实测失败**（§2.4），且 CI 不覆盖
- CI workflow 在 GitHub Actions 上的**真实**运行结果：**C**。本次只验证了 6 个 step 的本地等价命令全绿；未触发 Actions，`docs-consistency` job 的实际行为未观测
- `.mimosa/`（Mimosa 扫描工具状态目录）：仓库内存在但与产品能力无关，本次未审计
- `PUBLIC-SCRUB-NOTE.md` 所称历史脱敏是否彻底：**C**。抽样见测试已用 `100.64.0.x`（CGNAT 保留段），未做全仓外网 IP 扫描
- `docs/upstream/ts-main/`（上游快照）：**B**。文件在仓内，本次未做代码级 diff 比对

---

## 6. 结论：真实能力基线

**一段话**：这个仓库的真相是——**一个质量相当高、但完全没有接触过真实世界的协议核心库**。`packages/` 八个包的 495 个测试在本次盘点中全绿（逐包复跑 40+35+39+60+58+38+141+84=495，与全量精确对齐），测试风格偏向"对齐上游 Go 源码行号"的锚定断言而非自证式快照，D4/P4 纪律经 CI 原样 grep 复跑确认为真，两次安全修复中可验证的那一次（upload_server 路径穿越）做到了单元+集成双层、Python 视角验落盘、并已升格为 CI 常驻门 G0-6。但从"库"到"产品"的最后一段路——鸿蒙壳编译、真实 headscale 对拍、真机 fd 收发——**一段都没有走通过**：`app/` 无任何构建产物且 VPN 配置是空数组桩，INTEROP PASS 在仓内查无原始证据文件，回归脚本自身还有传参硬伤。更值得警惕的是**文档层**：同一份 README 里并排放着两套互相矛盾的验收数字，把已实现的 6 项二期功能列为"未做"，而 CI 那个专门防漂移的 `docs-consistency` 门恰恰因为只 `grep -q` "含不含 495"、而对"是否还残留 280"完全失明——**目前唯一挡在红灯前面的是它把 warning 当成了通过。**

### 分级清单

**✅ 实测可用（本次亲自跑过、退出码 0、结果符合声明）**
- `packages/` 八包协议核心：495 用例 / 0 失败 / 0 跳过（`npm test` + 逐包复跑双重确认）
- 密码学与协议正确性基座：x25519 标量乘 3.5723 ms/op（`npm run perf:baseline`）
- D4「核心库零网络」+ P4「无非确定来源」纪律（CI 原样 grep 复跑，三门 0 命中）
- `npm run typecheck`（根 tsconfig，覆盖 `packages/**`）exit 0
- `app/bridge` mock 集成层：30 用例 / 0 失败
- `upload_server.py` 路径穿越防御：单元 8/8 + 集成 7/7，攻击未落盘
- `app/` 静态资源一致性：66 项 / 0 失败
- CI `g0` job 的 6 个 step 本地等价命令全绿

**🟡 代码 + 测试通过，但从未接触真实环境**
disco relay 0x04–0x09 家族（逐字节 hex 锚定上游）· netcheck 引擎与探测调度 · DERP region 随机选节点（seed 可复现性已测）· netmap → WireGuard 推导 · peerconn 连接状态机（直连/DERP 降级、迟滞、CMM 释放）· LocalAPI/PeerAPI/MagicDNS 语义 · Noise 协议（对外部向量比对）· WireGuard 数据面（cookie/reply/replay/dispatch）· `app/bridge` 的 LocalAPI/PeerAPI/TUN mock 三面

**🔵 仅 mock / 仅桩（形态存在，接线未通）**
鸿蒙 VPN 扩展（`VpnExtensionAbility.ets:41-43` 三数组全空，源码自陈"真实调用会失败"）· TUN fd ↔ 核心库收发接线（仅 `app/bridge` 内存网线 `TunCable`，无真 fd 通路）· `mock-udp-bus` NAT 公网映射仿真与 `MockStunServer`（确定性内存桩）· shell 发现/会话层（跑在 Node，无 ArkTS 编译验证）

**⚪ 仅文档/历史声明（本次无法验证）**
09-29 真实 headscale v0.29.4 `INTEROP PASS` + `DERP INTEROP PASS`（**仓内无原始证据文件**）· 官方 ArkTS linter src 告警 154 → 0（需 WSL + SDK）· `app/` 壳可编译性（`docs/build-feasibility-linux.md` 的成文论证）· 6 个 npm 包在 DevEco/ohpm 下的本地依赖集成路径（`app/README-app.md:57` 自陈"均未在 DevEco/ohpm 实测"）

**❌ 不存在 / 红灯**
**`npm run typecheck:bridge` 红灯**（exit 2，TS2353 @ `peerapi-tun.test.ts:246`，由 `e136900` 引入，**CI 不覆盖**）· **`npm run interop:regress` 当前形态不可能输出 `INTEROP PASS`**（`regress.mjs:59-61` 传参数不足 + `:57` 假 preauthkey）· **`interop/arkts-check.js` 本机无法执行**（ESM/CJS 冲突 + 缺 WSL SDK 路径）· 真机 VPN 隧道、真实 Headscale 对拍、真实 TUN 收发：**从未发生**

### 给下一轮的三条最小行动建议（按性价比排序）

1. **把 `npm run typecheck:bridge` 加进 `g0-gates.yml`**（一个 step，五行），并修 `peerapi-tun.test.ts:245` 的传参——否则 `app/bridge` 永久处于"只有运行时检查、没有编译期检查"的状态，下一个同类错误会再次静默通过。
2. **修 `regress.mjs:57-62`**：给 derp 阶段补第二个参数、把硬编码 preauthkey 改为读环境变量。否则"INTEROP 回归脚本"是一具永远打印 FAIL 的空壳，会持续污染可信度。
3. **删掉 `README.md:41-46` 的第二张门禁表，并把 README:54 的"二期未做项"改成"已实现（bridge mock 形态）+ TUN 壳层未接线"**；同时把 `docs-consistency` job 从"只 grep 是否含"升级为"含 495 且不含 280/238/217/13/54/29"。当前文档矛盾已经多到会误导验收人，而唯一的防漂移门对此完全失明。

---

*本报告全部结论可溯源至第 2 节运行记录；未运行项已在第 4 节按 B/C 标注。盘点期间未修改仓库任何既有文件。*
