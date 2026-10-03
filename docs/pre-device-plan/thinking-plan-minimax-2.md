# 思考轨迹：互操作线与证据链（minimax-m2）

> 视角声明：本文只从**互操作线**与**证据链**这一条主轴思考。其余四条主轴（壳/ArkTS、门禁、任务编排、人类配合流程）我只在与本轴有交界处提及，不越界规划。
> 方法纪律：每条事实标注「出处 + 我是否亲验」。凡我未亲验的，标注**未验**。
> 读者：稍后写正式规划的 GLM53 合并人。我给的是**怎么想的**，不是成品。

---

## 1. 事实认定

### A1. 互操作回归当前是「三重失败叠加」，且失败**不可归因**

BASELINE §2.10/§8-2 断言 regress.mjs 有三重缺陷。我亲跑复现（`npm run interop:regress`，exit 1）：

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
```

我自己读了 `interop/regress.mjs:31-43` 的判据：`return r.status === 0 && !sawUsage && stdout.length > 0`。
**关键观察（我读出来的、BASELINE 没点破的）**：这个判据把「脚本缺陷」和「环境缺失」压成同一个 `false`。三个阶段在产物里长得一模一样。

我读了 regress 写的 summary.json（本次运行实际产物）：

```json
{"hs":"http://127.0.0.1:8080","stages":{"register":false,"derp":false,"h2c":false},"final":"INTEROP FAIL"}
```

没有 exit code、没有 stderr、没有阶段耗时、没有 headscale 版本、没有错误分类。
**判断**：即使明天 headscale 环境就位、真机 agent 拿到这份 summary.json，他也无法回答「我该修代码还是修环境」。这是互操作线**最致命的缺口**——不是「跑不通」，是「跑不通且说不清为什么」。

### A2. 三个子脚本的 CLI 契约状态（我逐个探针实测，无网络）

```
$ node --experimental-strip-types interop/register.node.ts          → exit 1 + usage（stderr）✓ 契约完整
$ node --experimental-strip-types interop/derp.node.ts              → exit 1 + usage（stderr）✓ 契约完整
$ node --experimental-strip-types interop/h2c.node.ts http://…      → exit 0，stdout+stderr 全空 ✗ 无 CLI
```

静态计数（我实跑 `grep -c`）：

| 脚本 | `process.argv` 出现 | `usage:` 出现 |
|---|---|---|
| register.node.ts | 1 | 1 |
| derp.node.ts | 1 | 1 |
| h2c.node.ts | **0** | **0** |

**这是本轴最有价值的一条发现**：`h2c.node.ts` 的「无 CLI」是**静态可判定**的（`process.argv` 计数为 0）。同样，regress 给 derp 只传 1 参而 derp 声明需要 2 参，也是**静态可判定**的（child usage 串的必填占位符个数 vs regress argv 数组长度）。
→ 两个缺陷**都能在没有 headscale 的情况下被机器拦住**。BASELINE 只说「无 headscale 环境下不可能 PASS」，没说「这两个缺陷本来跟 headscale 毫无关系、可以离线拦住」。这是我这条线最硬的一条主张。

### A3. `interop/` 全目录不在任何类型检查覆盖内（我实跑证明）

```
$ npx tsc --noEmit -p . --listFiles | grep -c "interop/"    → 0
$ npx tsc --noEmit -p . --listFiles | grep -c "packages/"   → 121
```

`tsconfig.json` 的 `include` 只有 `["packages/**/*.ts"]`。
**后果**：全仓唯一会跟真实网络对拍的三份代码（`register/derp/h2c.node.ts` 共 939 行）**零编译期检查**。这直接解释了 A2 两个缺陷为什么能存活：它们是典型的「参数契约/入口缺失」类错误，正是类型系统能拦的那一类。

### A4. 09-29 证据缺口的真实形状

- `docs/oracle/` 下只有 `protocol-notes.md`（20152 字节）。`docs/oracle/raw/` **不存在**。
- `DELIVERY_REPORT.md:151` 仍在引用 `docs/oracle/raw/README.txt` 和 `docs/oracle/raw/derp-map.json` —— **悬空引用**。`protocol-notes.md` 正文里直接引用 `raw/version.txt`、`raw/prefs.json`、`raw/derp-map.json` 等文件名，同样悬空。
- **但**：protocol-notes.md 自身已部分脱敏（`headscale.example.internal` 是占位域名，`198.51.100.30` 是 RFC 5737 TEST-NET-3 文档保留地址）。所以旧转储即便找回，也不是「一入库就泄密」的状态。唯一的 09-29 详述在 `DELIVERY_REPORT §5.2 / §5.3 / §5.5`（散文）。

**我自己的判断（与 BASELINE §7 一致但更具体）**：17 份转储**不可重建**。它们取自 2026-09-28/29 一台装了 fork 版 tailscale `1.102.3-t9329c3677-ga522f65e9`（`-dirty`）的 Windows Server 机器。那台机器的 tailnet 状态、netmap、prefs 今天不存在了，任何「重跑一遍 tailscale debug」都不可能复现同一批字节。**所以「补救」不能理解成「把文件补回来」。**

### A5. 上游快照：provenance 缺失 + 归档面严重不全（我实跑统计）

- `docs/upstream/ts-main/` 16 份 .go，**没有 README / 没有 manifest**：无抓取日期、无源 URL、无上游 commit SHA。唯一的间接锚是 `tailcfg.go:197-199` 自身的变更日志注释（capability 146/147/148 对应 2026-09-02/09-09/09-15）——这是**推断**，不是**记录**。
- `docs/upstream/2026-10-01-phase2/README.md` 有 provenance（jsdelivr + 2026-10-01 + 文件用途表），但**同样没有上游 commit SHA**。连「今天是哪个版本」都无法回答，只能回答「大约是 2026-10-01 的 main」。
- 归档不全（我实跑集合差）：B1–C3 六份研究笔记引用的 .go（去重）**74 份**；`docs/upstream/` 下实际存在的 .go（去重）**24 份**；**引用了但未归档 58 份**。缺失名单含 `localapi.go` `peerapi.go` `magicsock.go` `netcheck.go` `routemanager.go` `endpoint.go` `controlknobs.go` `ipn-prefs.go` `derpmap.go` `paths.go` …
**即 AU5–AU9 这五项（1c9b85b 那一整批 +215 测试的核心工作）的上游原文，一份都没归档**，只有 30–45KB 的二手研究笔记。BASELINE §7 只说「快照与真上游的 diff 无人做过」——**它没说归档面本身缺 58 份**，这一条是我补的。

### A6. 快照内部一致性是好的（我做了正向抽验）

AU3 声称「实读 tailcfg.go L1318/L1372/L1436」。我实跑：

```
$ sed -n '1318p' docs/upstream/ts-main/tailcfg.go → type RegisterRequest struct {
$ sed -n '1372p' docs/upstream/ts-main/tailcfg.go → type RegisterResponse struct {
$ sed -n '1436p' docs/upstream/ts-main/tailcfg.go → type MapRequest struct {
```

**三处全中。** 说明 ts-main 快照与一期的行号引用是自洽的。
**这条很重要**：它把「快照可信」和「快照 provenance 可核」区分开了。A5 缺的是"这是哪个 commit"，不是"内容被改过"。**引用行号本身可机检**，这是零成本可上 CI 的门。

### A7. `headscale-noise.go` 与 `headscale-noise-full.go` 字节相同

```
$ sha256sum docs/upstream/headscale-noise.go docs/upstream/headscale-noise-full.go
39d3b4b8bed6a194c1ecb5720b344b332107ba6d9089cb6698c1e0ef35542e5f  headscale-noise.go
39d3b4b8bed6a194c1ecb5720b344b332107ba6d9089cb6698c1e0ef35542e5f  headscale-noise-full.go
```

同 sha256。纯冗余。低危，但属于证据面卫生。

### A8. 仓内已有一个**好的**证据范式可以推广

`packages/derp/test/client.test.ts` 对 09-29「MeshKey 必须整字段省略」这个**实测发现**的处理：
- `client.test.ts:37` **独立重定义**了一份 `CLIENT_INFO_JSON` 常量（不 import 自 src）；
- `client.test.ts:273-277` 断言解封出的明文字节**逐字节等于**该独立常量。
- 因此若有人把 MeshKey 加回 `packages/derp/src/client.ts:90`，测试**必然红**。

**这就是「实测发现 → 可回归证据」的正确形态：死值锚定（dead-value anchoring）+ 独立副本**。
对比之下，`packages/derp/src/client.ts:86` 的注释只是散文。我主张把 client.test.ts:37 这个模式**提升为全仓互操作结论的证据链规范**（见 §4 I-4）。

### A9. headscale 隔离配置的绑定地址**违反本项目自己的红线**（我实跑 grep）

`interop/headscale.yaml:3` `listen_addr: 0.0.0.0:8080`、`:21` `stun_listen_addr: "0.0.0.0:3478"`，对照 `docs/research/2026-10-02-D-interop-plan-public.md:16`（R1）「headscale 监听只绑 `127.0.0.1`」与 `:20`（R5）「headscale/embedded DERP/STUN 都绑 `127.0.0.1`」。
**这是仓内文档与仓内配置的正面冲突，且冲突方向是「更不安全」。** 红线 R1/R5 写在 P0 容器路径里，而违例的 yaml 是 P1 本地二进制路径（`start-headscale.sh` 用的那份）——**恰恰是降级路径不安全**。

另外 `headscale.yaml:9/:22/:31/:44` 硬编码 `/home/dev/interop/{noise_private.key, derp_server_private.key, headscale.db, headscale.sock}`，而**任何 runbook 都没有生成这些文件的步骤**。`start-headscale.sh` 直接 `./headscale serve --config headscale.yaml`，缺 key 文件时 headscale 不会起来。

### A10. 两条 headscale 执行路径互相不一致

- `interop/start-headscale.sh`：WSL 内、`cd "$HOME/interop"`、跑**本地预编译二进制** `./headscale serve`。
- `docs/handover/agent-interop-regression.md:19-27` P0 方案：`docker run headscale/headscale:<VERSION>`，**用环境变量不用 yaml**。

**两条路径不共用配置**。而且 handover 里版本是占位符 `<VERSION>`，`interop/headscale.yaml:1` 注释写「v0.29.4」但没有任何地方把版本钉进可执行命令。
→ **「09-29 是在 v0.29.4 上跑通的」这个前提，在今天的可执行路径上没有被钉住。** 这是复现性的实质漏洞。

### A11. 证据归档路径与 .gitignore 正面冲突（我实跑 git check-ignore）

```
$ git check-ignore -v evidence/interop-20261003/regress.log
.gitignore:27:*.log    evidence/interop-20261003/regress.log      exit 0（= 被忽略）
$ git check-ignore -v evidence/interop-20261003/state.sha256
                                                                  exit 1（= 未被忽略）
```

而 runbook 规定的证据文件名正是 `regress.log`（`agent-interop-regression.md:39`、`2026-10-02-D-interop-plan-public.md:51` 都写 `| tee evidence/interop-<日期>/regress.log`），
`evidence/` 目录当前不存在、也**不在** .gitignore 里（即允许入库）。
**结论：D-3「复跑留证」与 D-plan §6「把证据目录 commit」在当前 .gitignore 下不可能同时成立**——git 会静默丢掉主证据文件。
这是我实跑出来的、BASELINE 完全没提的一条。**优先级 P0**，因为它让整个 D-3 变成空操作。

### A12. D-1 的验收口径把 h2c 写进了契约（这决定了我否决哪个方案）

`TASK.md:54`：
> D-1 | 隔离互操作复建复跑 | 用隔离 headscale 实例（容器，用后即弃）跑 `interop/start-headscale.sh` + register/h2c/derp：全部 exit 0 且输出含 `INTEROP PASS` 与 `DERP INTEROP PASS`

`h2c` 被**明文列进 D-1 的必跑清单**。→ 任何「从 regress 里删掉阶段 3」的方案都是**修改验收契约**，必须走 owner 裁定，不能由 agent 自行决定。这条事实直接决定了 §3 的方案取舍。

---

## 2. 目标拆解思路

人类意图是「真机前全部工作完成」。但**互操作线在这句话里的含义需要重新定义**——因为子线 D 的真正阻塞不是「不会跑」，而是「跑了也不算数」。

我把互操作线切成三段，切法依据是**「无网络条件下每一步能产出什么可机检的东西」**：

**段① 可归因（Attributable）** —— 让 regress 的失败能被分类。依据 A1：当前三个阶段在产物里都是 `false`。这一段**完全无网可做 100%**，且是其余一切的前置。
**段② 可复跑（Reproducible）** —— 让 headscale 隔离环境能被一次性重建。依据 A9/A10/A11：环境不是「缺一个 docker」，而是「配置与红线冲突、路径无 bootstrap、版本没钉、证据被 gitignore 吞」。这一段**能做完的是「重建包」而不是「跑通记录」**——跑通必须有网络与 docker，二者今天都不在。
**段③ 可核验（Verifiable）** —— 让每条互操作结论都挂着可复核工件。依据 A4/A5/A7：09-29 的结论目前是散文 + 悬空引用 + 58 份未归档上游。这一段**大部分无网可做**（provenance manifest、行号对拍机检、悬空引用修复、证据规范），只有「真 diff」必须等网。

**为什么是这个顺序**：段①不做，段②跑通了真机 agent 也不知道该改什么；段②不做，段③规范再严也没有真实工件可挂。所以段①是硬前置。
**我给自己的争议定位**：我主张把「可归因」排在「搭环境」之前。这与常见的「先把 docker 环境搭起来跑一次再说」直觉相反。理由是 A2 的发现——**当前两个脚本缺陷跟 headscale 毫无关系，headscale 到位也照样必败**。先花时间搭环境，得到的是一个仍然 exit 1、且 exit 1 的原因仍然不可知的系统。

---

## 3. 备选方案与取舍

### 3.1 阶段 3（h2c）怎么修 —— 两个方案，选 A 否决 B

**方案 A（采纳）：给 `interop/h2c.node.ts` 加真正的 CLI 入口。** `h2c.node.ts` 是 281 行真实实现（`export class H2OverNoise`，:29），不是空壳。加 CLI = 建 Noise 会话 + 发一次 h2 请求 + 打印 `H2C PASS`。理由：保 D-1 契约（A12）；阶段 3 有独立可归因价值（它是「HTTP/2 over Noise」这条唯一未独立验证的链路）。
**方案 B（否决）：从 regress 中删除阶段 3。** (1) 直接违反 `TASK.md:54` 的 D-1 明文清单，属于改验收契约；(2) h2c 能力本身仍存在于 register/derp 脚本内部（`register.node.ts:228` `new H2OverNoise(...)`），删掉编排阶段不等于能力被验证，只是把它藏进别的阶段的 stdout 里。
**方案 B'（否决，我认为最容易被误选）：阶段 3 改成「复用阶段 1 的会话，断言一个 h2 专用 marker」。** 阶段 1 与阶段 3 共享同一次连接，一旦失败无法区分是「注册挂了」还是「h2 挂了」——**违背段①「可归因」的核心目标**。故留下记录。

### 3.2 regress 判据怎么改

**采纳：每阶段声明专属 marker 字符串 + 失败分类枚举。** `runStage(label, args, {marker})`；成功 = `exit 0 && stdout 含 marker && !usage`。失败分类 `reason ∈ {PASS, ENV_UNREACHABLE, ENV_AUTH_REJECTED, SCRIPT_USAGE, SCRIPT_SILENT, PROTOCOL_REJECT}`。summary.json 扩为每阶段 `{name, status, exitCode, durationMs, reason, markerSeen, stdoutTail, stderrTail, hsProbe}`。

**否决：只看 exit code。** regress.mjs:37-39 的作者自己已写注释反对它（「仅看 exit码会漏过 usage 错误退出等退化情形」）——阶段 3 就是活证据（exit 0 但什么都没干）。我认同原作者的判断。
**否决：保留「stdout 非空」作为兜底判据。** 它是当前阶段 3 被静默判负的**唯一**机制，但它是错的信号来源：stdout 非空不等于该阶段成功。改成「非空但无 marker」= `SCRIPT_SILENT`，这才是正确的归因。

### 3.3 「先验证脚本自身正确、失败仅因环境」怎么做 —— 离线自检门

**采纳：`npm run interop:regress -- --selftest`（或独立 `interop/regress.selftest.mjs`），全离线，五条断言：**

| # | 断言 | 依据 | 今天跑会怎样 |
|---|---|---|---|
| S1 | 每个 stage child 的 `usage:` 必填占位符数 == regress 传参数 | A2 | **红**（derp 1≠2） |
| S2 | 每个 stage child 至少引用一次 `process.argv` | A2 | **红**（h2c = 0） |
| S3 | `node child.ts`（零参）→ exit 1 且 stderr 含 `usage:` | A2 实测 | 绿 |
| S4 | HS 端点 TCP 预检，ECONNREFUSED 归类 `ENV_UNREACHABLE` 并**跳过**协议阶段 | A1 | 绿（当前是 ENV） |
| S5 | `summary.json` 每个阶段都有 `reason` 字段且非空 | A1 | **红**（当前无 reason） |

**这五条全部不需要 headscale、不需要网络。** 我已在本次会话实跑确认 S1/S2/S3 的原始信号可提取（grep 计数 + 三次探针），S4 需要一个 3 行的 `net.connect` 预检，S5 是 JSON schema 断言。
**关键性质**：S1/S2 今天就是红的 —— **这证明这道门有效（它真的能抓住现存缺陷），而不是走过场。** 我会把「门在修复前红、修复后绿」作为验收规格写进规划。

**否决的替代方案：录一份 headscale 的 mock server（假 /key + 假 /ts2021）做假阳性联调。**
　否决理由：投入产出比极差，且会产生「互操作通过」的**误导性绿灯**——BASELINE §1 已经在为「09-29 仅文档声明」头疼，再造一个假绿灯是雪上加霜。离线自检只回答「脚本自己有没有毛病」，不回答「协议对不对」，**边界必须写死**。

### 3.4 `docs/oracle/raw` 17 份转储怎么补 —— 四个子选项，只活两个

(a) **重建同批转储 → 否决**：不可行。取自一台装了 fork 版 1.102.3 的特定机器，tailnet 状态不可复现（A4）。做出来的不是同一份东西。
(b) **从 protocol-notes.md 反推生成 `raw/` → 强烈否决**：这是**伪造证据**。用二手笔记伪装成一手转储，比缺文件危险得多——它会让未来的复核者以为原始物证存在。
(c) **修悬空引用 + 降级口径 → 采纳**：把 `DELIVERY_REPORT.md:151` 与 protocol-notes.md 里对 `raw/*` 的引用改指到「本节即唯一现存记录」，并加显式降级标注：【实测（二手转述，原始转储未入库，不可复核）】。成本极低，收益是消灭所有悬空链接。
(d) **抓一批新的、真正可复现的 oracle → 采纳，排在段②之后**：等 headscale 环境就位时，保存容器版本 tag/digest、`/key` 响应原文、`/machine/register` 响应原文、`/machine/map` 首帧前若干字节、DERP 握手帧序列。**这些今天就能被重新生成**——与 17 份陈旧转储性质不同。

**「入不入仓」的回答**：(d) 新证据**入仓**（脱敏后，私钥/凭据不入，只留公钥前缀+哈希，沿用 D-plan R3/R4）；旧的 17 份**不重建、不入仓**；(c) 的口径修正**入仓**。**理由**：入仓的价值不在「文件多」，在「未来的 agent 能重跑并得到同样字节」。旧转储永远做不到这一点，新证据可以。

### 3.5 headscale 隔离环境重建 —— 分几步、哪些真机前能做完

**采纳的切分：**

| 步 | 内容 | 真机前可做？ | 依赖 |
|---|---|---|---|
| 0 | 修 `headscale.yaml` 绑定地址为 127.0.0.1（A9 红线冲突） | ✅ 可做 | 无 |
| 1 | 参数化所有 `/home/dev/interop/*` 硬编码路径（A9） | ✅ 可做 | 无 |
| 2 | 写 bootstrap：生成 noise/derp 私钥、建 sqlite 目录、chmod（A9 缺口） | ✅ 可做 | 无 |
| 3 | 版本钉死：`headscale.yaml` 头注的 v0.29.4 → 写进 compose/runbook 的显式 tag + 首次运行打印版本到证据（A10） | ✅ 可做 | 无 |
| 4 | 统一 P0/P1 两条路径共用同一份配置（A10 两条路径不共用配置） | ✅ 可做 | 无 |
| 5 | 环境自检脚本：docker 可达？镜像可拉？端口空闲？`/health` 通？逐项输出 SKIP/OK 而非直接跑 regress | ✅ 可做 | 无 |
| 6 | **真跑一次 regress 并归档 evidence** | ❌ **不可做** | 网络 + docker/ssh |
| 7 | `evidence/` 入仓（修 .gitignore 冲突，A11） | ⚠️ **半可做** | 规则可先改，实际工件要等步 6 |

**我明确反对的方案：在真机前硬搭环境。**
　否决理由：本机无网络（BASELINE §7 明载）、无 docker（D-plan §1 三问已答）、`dev-env-with-gpu` ssh 别名是否仍可用**未知**。硬搭的失败模式是「花大量时间在一个今天注定跑不通的链路上」，且失败原因（网络/凭据/镜像）三者都不可归因——正是我要消灭的那类问题。
**替代主张**：真机前把「搭环境」这件事本身**变成可执行、可归因、可交接的工件**（步 0–5），把「跑通」这一动作留给真机 agent 或有网环境，作为它的第一个任务。

### 3.6 上游对拍的无网可前置部分

**采纳三件（全部无网可做）：**
1. **provenance manifest**：`docs/upstream/manifest.json`，每份快照记 `{path, source_url, fetched_at, upstream_commit, note}`。**已知无法填的字段（commit SHA）必须显式写 `null` 并注明原因**，不许留空不许编。这一条本身就是证据链规范的样板。
2. **行号对拍机检**：从 `docs/architecture.md §10.2` 与 `docs/research/*.md` 抽出所有「`file.go:L123`」形式的引用，逐条断言目标行在快照里存在且**包含笔记声称的符号名**。我已手工验证 A6 的三处全中，说明这个断言可实现且会绿。这条把「测试对齐上游行号」这个核心方法论**从散文变成 CI 门**。
3. **缺失面显式登记**：58 份未归档文件写成 `docs/upstream/UNRESOLVED.md` 的清单（文件路径 + 被哪份笔记引用 + 影响哪条 AU）。**不补文件，只登记欠账。** 理由：没有网，补不了；凭笔记反推等于伪造。登记之后，真机/有网 agent 拿到的是一张明确的取件单。

**否决的方案：真 diff。** 无网绝对做不到（BASELINE §7 已确认）。
**但我要预先写好对拍脚本与判据**：一个 `interop/upstream-diff.mjs`，输入 = manifest 里的 upstream_commit，输出 = 「新增/删除/变更行数 + 受影响的 AU 条目」，使得有网 agent 一条命令拿到结果。**写脚本无网，写结果需要网。**

### 3.7 证据链规范的形式

**采纳：机器可检的 manifest + 校验脚本，配一份人读的规范文本**（共性必答要求「完成定义尽量可机检」——纯 Markdown 规范无法机检）。规范条目（草案，基于 A8 的好范式推广）：
- **E1 死值锚定**：每条「实测发现」必须有一个独立副本的常量 + 逐字节断言（范例：`packages/derp/test/client.test.ts:37/:273-277`）。禁止只在代码注释里写「实测发现」。
- **E2 来源可追**：每条协议语义断言必须指向 `docs/upstream/` 的 `file:line`，或指向 `evidence/<批次>/` 的具体文件。
- **E3 结论分级**：每条结论标 `【自测】`/`【交叉验证】`/`【实测对拍】`/`【仅文档声明】`（BASELINE §0 口径已存在，直接复用，勿另立标准）。
- **E4 环境指纹**：任何互操作结论必须附 headscale 版本 tag+**digest**、node 版本、脚本 git sha、运行时间戳。
- **E5 敏感边界**：私钥/凭据/内网域名不入仓；只留公钥前缀 + 哈希（沿用 D-plan R3/R4）。
- **E6 可重跑性**：入仓的 evidence 必须能被后来者用**记录下来的命令**重跑得到等价结论；做不到的标 `ran=false` 诚实降级。

---

## 4. 建议工作项与验收门（P0/P1/P2）

**P0 —— 无网络、本机 100% 可完成、且是其余一切的前置**

| ID | 工作项 | 验收门（可机检） |
|---|---|---|
| **I-1** | regress 阶段化判据 + 失败分类枚举 + summary.json 扩字段 | `summary.json` 每阶段含 `reason`/`exitCode`/`durationMs`/`stderrTail`；三类失败各有可复现样本 |
| **I-2** | 修 regress 三重缺陷：preauthkey 读环境变量、derp 补第 2 参、h2c 加 CLI 入口 | **`--selftest` 五条断言全绿**；且 selftest 在修复**前**是红的（红→绿轨迹本身是证据） |
| **I-3** | `interop/regress.selftest.mjs` 离线自检门 | `npm run interop:regress:selftest` exit 0，**不需要网络**；纳入 CI |
| **I-4** | 证据链规范文本 + `interop/evidence-manifest.mjs` 校验器 | 校验器能对「缺 reason」「缺 marker」「缺环境指纹」三类分别报错 |
| **I-5** | headscale 隔离环境重建包（§3.5 步 0–5） | 环境自检脚本逐项输出 OK/SKIP；`headscale.yaml` 内 `0.0.0.0` 出现次数 = 0；版本号出现在可执行命令中而非仅注释 |
| **I-6** | 修 .gitignore 冲突（A11） | `git check-ignore evidence/interop-X/regress.log` 返回 **非 0**（即不再被忽略）；同时 runbook 文件名与规则一致 |
| **I-7** | 上游 provenance manifest + 行号对拍机检 + UNRESOLVED 欠账清单 | manifest 覆盖率 100%（缺失字段显式 `null`）；行号对拍对 AU1–AU3 全绿；UNRESOLVED 覆盖全部 58 份 |
| **I-8** | 09-29 证据口径诚实化（§3.4 选项 c） | 仓内 `grep -rn "oracle/raw"` 命中数 = 0（悬空引用清零），且替换为显式降级标注 |
| **I-9** | `interop/*.ts` 纳入类型检查 | `tsc -p . --listFiles \| grep -c interop/` > 0（当前 = 0，A3） |
| **I-10** | `interop/arkts-check.js` 可执行（ESM/CJS + SDK 路径参数化） | `node interop/arkts-check.js` 不再 exit 1 于加载期；缺 SDK 时给出可读 SKIP 而非崩 |

**P1 —— 真机前可做，但收益依赖环境是否就位**

| ID | 工作项 | 验收门 |
|---|---|---|
| **I-11** | `interop/upstream-diff.mjs` 对拍脚本（写得出、跑不出） | 脚本 `--dry-run` 在无网下能列出「将比对哪些 commit、哪些文件、影响哪些 AU」 |
| **I-12** | 真机 agent 交接契约中的互操作验收剧本（§5.3） | 剧本每步有「必须留下的工件」与「判定字符串」两栏，无空栏 |
| **I-13** | 删 `headscale-noise.go` / `headscale-noise-full.go` 冗余（A7） | 保留一份，sha256 记录在 manifest |

**P2 —— 必须等环境（真机 agent / 有网环境的第一批任务）**

| ID | 工作项 | 触发条件 |
|---|---|---|
| **I-14** | 真跑一次 regress，归档 `evidence/interop-<date>/`，入仓 | 有 docker 或 ssh 别名可用 |
| **I-15** | 抓新 oracle（§3.4 选项 d） | 同上 |
| **I-16** | 58 份上游文件补归档 + 真 diff | 有网 |
| **I-17** | 复现 09-29 两条 PASS 字符串 | I-14 完成后 |

**优先序理由**：I-1/I-2/I-3 是段①，一个都不能少且互为前提；I-4/I-6/I-7/I-8 是段③，成本低、纯本地、立刻提升可信度；I-5 是段②的「可交接部分」；I-9/I-10 是被其他线反复引用的阻塞点（I-10 直接卡住 `owner-with-real-device.md` Day 2）。

---

## 5. 共性必答五题（从互操作/证据链视角）

### (1)「真机前全部工作完成」的可验收完成定义（互操作线切片）

**总判据（一句话）**：`npm run interop:regress:selftest` exit 0 **且** `--selftest` 在修复前红过（有红→绿轨迹记录）**且** `npm run interop:regress` 的失败能被分类为 `ENV_*` **且** 仓内 `grep -rn "oracle/raw"` = 0 **且** `git check-ignore evidence/…/regress.log` 非 0。

**逐条机检项**（合并人可直接落成 CI/脚本；与 §4 各工作项的验收门是同一组断言，此处只做汇总索引）：
S1 child usage 必填占位符数 == regress 传参｜S2 child 至少 1 处 `process.argv`｜S3 零参调用 → exit 1 且 stderr 含 `usage:`｜S4 无 HS → 判 `ENV_UNREACHABLE` 并跳过协议阶段（非崩溃）｜S5 `summary.json` 每阶段 `reason` ∈ 枚举且非空｜S6 `headscale.yaml` 中 `0.0.0.0` 计数 == 0｜S7 headscale 版本号出现在可执行命令中（非仅注释）｜S8 `tsc -p . --listFiles` 覆盖 `interop/` 全部 `.ts`｜S9 `docs/upstream/manifest.json` 存在且每份快照有 provenance（缺字段显式 `null`）｜S10 `grep -rn "oracle/raw"` 仓库命中 == 0｜S11 `git check-ignore evidence/interop-X/regress.log` 返回非 0｜S12 `docs/upstream/UNRESOLVED.md` 覆盖 B1–C3 笔记引用的全部未归档 `.go`。

**明确不作为完成判据的**：`INTEROP PASS` 字符串出现。**理由**：它必须有 headscale，而 headscale 必须有网络/容器——不在「真机前」的能力边界内。把它写进完成定义会让整个规划变成不可达目标。
**这是我与「把 09-29 那两条 PASS 复现出来当作互操作线完成标志」这一直觉的正面分歧。**

### (2) 工作分解与优先序（P0/P1/P2）

见 §4。核心优先序主张：**可归因（I-1~I-3）> 可核验（I-4/I-6~I-8）> 可复跑（I-5）> 真跑（I-14~I-17）**。
**理由**：前两段零外部依赖、纯本地、收益立竿见影（消灭悬空引用、消灭不可归因的 exit 1）；第三段只能交付「重建包」；第四段不是「工作」而是「事件」。

### (3) 真机 agent 交接契约应包含什么（互操作线部分）

**拿到什么**：
- `docs/pre-device-plan/` 的正式规划（合并人产出）+ 本文这类思考轨迹的索引
- `interop/` 现状说明：脚本清单、各自 CLI 契约、环境变量（`HS` / preauthkey 变量名）
- headscale 重建包（I-5）与环境自检脚本
- `interop:regress:selftest`（应已绿）作为「先证明脚本自己没毛病」的入口

**做什么（互操作验收剧本，逐步留证）**：

| 步 | 动作 | 必须留下的工件 | 判定 |
|---|---|---|---|
| A1 | 跑 `interop:regress:selftest` | 完整 stdout + exit code | 全绿（若红，**停**，先修脚本） |
| A2 | 环境自检（docker/镜像/端口/health） | 自检脚本逐项输出 | 每项 OK/SKIP 有明确归因 |
| A3 | 起隔离 headscale，钉版本 | 版本 tag + **digest** + 容器/进程 id | 与 yaml 声明版本一致 |
| A4 | 建 preauthkey | **只记 sha256，key 本身不入仓不落 evidence** | 哈希行存在 |
| A5 | 跑 `interop:regress` 阶段 1（register） | stdout/stderr/exit/duration + summary.json | `register=PASS`，`INTEROP PASS` 标记出现 |
| A6 | 阶段 2（DERP A→B） | 同上 + A/B node 公钥前缀 | `derp=PASS`，`DERP INTEROP PASS` 出现 |
| A7 | 阶段 3（h2c 独立） | 同上 | `h2c=PASS` |
| A8 | 抓新 oracle（§3.4-d） | `/key`、`/machine/register`、`/machine/map` 首帧、DERP 握手帧序列 | 文件入 `evidence/<批次>/`，已脱敏 |
| A9 | 归档入仓 | `evidence/interop-<date>/` + README（环境/时间/执行者 sha/两条 PASS 字符串位置） | `git check-ignore` 非 0 且已 commit |

**决策边界**：
- **可自决**：环境搭建细节、端口、临时目录、抓哪些额外工件。
- **必须停下来问 owner**：① 出现 `PROTOCOL_REJECT`（协议层被真实对端拒——可能意味着我方语义错，**严禁改脚本凑 PASS**）；② 需要改动 `packages/` 的 8 包冻结接口；③ 任何真实凭据/私钥有泄露风险。
- **硬禁则**（沿用既有，不新立）：`--network host`、改远端 `authorized_keys`、生产 tailnet 上任何操作、私钥进 evidence/、为凑 PASS 而 patch interop 脚本（D-plan 与 handover 均已明文禁止，我完全采信并建议在契约里升格为「违反即作废本批证据」）。

**回报格式**：一份 `evidence/interop-<date>/README.md` + summary.json 原件 + 环境指纹四元组（E4）+ 明确的 `ran=true/false`。**禁止**用「已验证通过」这类无工件散文回报。

### (4) 人类配合说明书应覆盖什么（互操作线部分）

| 阶段 | 人提供什么 | 人决定什么 |
|---|---|---|
| 规划期（现在） | 是否接受「真机前不追求 INTEROP PASS 字符串」这一完成定义（我的核心分歧点） | 完成定义的口径；D-1 是否允许调整 |
| 环境准备 | docker 主机可达性 / ssh 别名是否仍有效 / 允许拉哪个镜像 | 是否提供远端 docker；是否允许版本升级（v0.29.4 是复现 09-29 的前提） |
| 执行期 | 一次性批准 preauthkey 签发（用后即弃） | 是否授权在隔离实例上注册节点 |
| 证据审查 | 审 `evidence/` 的脱敏是否合格 | 哪些工件可入公开仓 |
| 真机期 | 真机 + DevEco + SDK（与本线解耦，但 D-3 归档共用） | 何时解冻子线 E |

**一条给人类的提醒（我认为是本线最容易被忽略的人类配合项）**：`dev-env-with-gpu` 这个 ssh 别名和 `<GPU-PUBLIC-IP>` 是**2026-10-02 的现场记录**（D-plan §1），今天是否仍有效**没人验证过**。人类只需回答「这个别名现在还能用吗」——一个 yes/no 就能决定 I-14 是 P2 还是 P1。**这是成本最低、信息量最大的一次人类配合。**

### (5) 这个目标下最容易被高估或做错的项

1. **高估「搭好 headscale 环境 = 互操作线完成」。** 搭好之后 regress 仍然 exit 1，因为 A2 的两个脚本缺陷与 headscale 无关。**必须先过 selftest 再谈环境。**
2. **高估「补一份 oracle/raw 就补齐了 09-29 证据」。** 补不了（A4）。做出来的多半是伪造证据，比缺文件更危险。
3. **低估 `.gitignore` 这一条。** A11 显示 D-3/D-plan §6 的证据归档在当前规则下**根本无法 commit**。这是一条 1 行的修复，但它决定了整个 D-3 是否是空操作。它不在任何现有 BASLINE 缺口清单里。
4. **误以为「上游快照在仓内 = 上游对齐已核」。** A5：58/74 份被引用的上游文件根本没归档，AU5–AU9（+215 测试那批）的原文一份没有；且 ts-main 无 commit SHA。**「对齐」的证据基础是二手笔记。**
5. **把「新增一份 spec 文档」当成证据链建设。** 规范不配校验器 = 又一份散文。A4 的教训正是「散文不算证据」。
6. **（本线特有）为了让 `INTEROP PASS` 出现而改 interop 脚本。** handover 与 D-plan 都已明文禁止，我建议升格为「违反即作废本批全部证据」。**互操作线的价值全部建立在「PASS 不可伪造」上。**

---

## 6. 不确定性清单

| # | 我的判断 | 可能错在哪 | 谁能复核、什么条件下 |
|---|---|---|---|
| U1 | 17 份 oracle/raw 不可重建 | 若那台 oracle 机器/其 tailnet 仍在，且能重跑 `tailscale debug` 系列命令 | 人类 owner 一句话即可证伪：oracle 机器是否还在 |
| U2 | 「58 份上游未归档」是重大缺口 | 我只统计了 B1–C3 六份笔记的 `.go` 引用；可能部分文件在 `docs/research/*.md` 里以长路径或非 .go 后缀引用，或已在别处归档 | 合并人可跑 `grep -rhoE '[\w/.-]+\.go' docs/research/*.md \| sort -u` 与 `find docs/upstream -name '*.go'` 复核（我已跑，数字为 74/24/58） |
| U3 | 行号对拍机检可实现且会绿 | 我只抽验了 AU3 的 3 处；全量抽验可能有失配（笔记里行号可能随上游漂移） | 合并人跑一次全量抽验即可裁决 |
| U4 | 真机前不该硬搭 headscale 环境 | 若 owner 恰好有可用的远端 docker 且网络通畅，这项就从 P2 升 P1 | 人类回答 U6 的问题即可定 |
| U5 | 阶段 3 应加 CLI 而非删除 | 若 owner 认为 D-1 可以改，删除方案成本更低 | owner 裁定（这正是 §5(4) 里「人决定什么」的一条） |
| U6 | `dev-env-with-gpu` 是否仍有效 | 2026-10-02 的记录，今天未验 | **人类 owner 一句话** |
| U7 | headscale v0.29.4 是复现 09-29 的必要版本 | 更高版本可能已修 MeshKey 之外的其它差异；但换版本就失去「复现 09-29」的意义 | 需有网 agent 实测；在此之前我建议钉死 v0.29.4 |
| U8 | interop/*.ts 纳入 tsc 不会暴露大量错误 | 939 行从未被类型检查过，首次纳入可能爆出一批错（`--experimental-strip-types` 下 node 胶水与 strict 模式可能冲突） | 合并人可先跑 `npx tsc --noEmit --strict interop/register.node.ts` 探一次（我**未跑**） |
| U9 | 新证据「入仓、旧证据不重建」是 owner 偏好 | 有人可能主张「全部历史物证都该保留」 | owner 裁定 |

---

## 7. 风险与依赖

**R1（高）｜「可归因优先」这一排序若被推翻，本线全部优先级作废。**
　如果合并人/owner 认为「先搭环境跑一次」更重要，那么 I-1~I-3 会被推迟，而它们是其余一切的前置。**这是本线最需要被外部裁决的一条。**

**R2（中）｜selftest 门可能变成走过场。**
　若只加断言不记录「修复前是红的」，就失去了「这道门真的有效」的证据。**必须把红→绿轨迹本身作为交付物。**

**R3（中）｜证据入仓与脱敏的边界会在真机期反复拉扯。**
　D-plan R3/R4 是为 headscale 场景写的；真机期的工件（设备 SN、hdc 输出、可能含用户名的日志）没有对应规则。**真机 agent 需要一份延伸的脱敏清单，否则要么全不交要么全泄。**

**R4（中）｜上游补归档（I-16）会随时间越来越贵。**
　manifest 若不钉 commit，58 份文件将来按哪个版本补都是含糊的。**钉不上的字段必须显式 null 并写明「未知」，不许事后编。**

**R5（低）｜arkts-check.js 与 interop:regress:selftest 的归属可能与 A-2 线重叠。**
　我把它划进互操作线（因为文件在 `interop/` 且阻断 owner Day 2），但 A-2 视角可能主张归自己。**建议以「文件所在目录」为归属依据，并在规划里显式声明，避免两线都做或都不做。**

**R6（低）｜`interop/*.ts` 纳入 tsc 可能触发 `verbatimModuleSyntax` / `erasableSyntaxOnly` 下的胶水代码报错。**
　U8 未验。建议以「先探后纳、允许一个显式的 `// @ts-nocheck` 例外清单」作为退路，而不是放弃纳入。

---

*本文所有数字与命令均为本会话在 `D:\new-workspace\ohos-tailscale` @ `90ed53e` 原样执行所得；凡未亲验者已标注「未验」。未修改任何既有文件。*
