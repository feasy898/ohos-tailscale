# 思考轨迹：已知缺陷清零与门禁体系强化

> 视角主轴：把 BASELINE §5/§6/§8 的缺陷与漂移在真机前阶段清零，并用机检把「零已知缺陷」固化下来。
> 读者：稍后写正式规划的合并人（GLM53）。本文是推理过程，不是成品规划。
> 基准：`90ed53e`（本会话 `git rev-parse --short HEAD` 实测）。环境：win32 / Git Bash / node v22.23.2。
> 本文所有「实测」= 本思考员本会话亲手执行的命令与输出；引 BASELINE 处的标注为转引。

---

## 0. 一句话结论（先给判断，后给推理）

**我这一轴的核心结论和 BASELINE 的写法不一样：TS2353 不能按「修传参」的字面意思修。**
BASELINE §8 建议「修 :245 传参为合法 answerDns 形态」。我实测证明：把 :245 按**字面意图**改成
`answerDns: null`，测试会从 400 变成 **503**，直接挂。真正该做的是传一个**真函数**。
这一条决定了整个缺陷清零的顺序，也决定了「哪些修复本身需要负例保护」。

---

## 1. 事实认定

### 1.1 我本会话亲手复跑的（命令 → 结果）

| # | 命令 | 结果 | 用途 |
|---|---|---|---|
| F1 | `npm run typecheck:bridge` | `peerapi-tun.test.ts(246,5): error TS2353`，**exit 2** | 确认唯一红灯仍在 |
| F2 | `npm run test:bridge` | `1..30 / # pass 30 / # fail 0`，**exit 0** | 确认红灯与运行时绿并存 |
| F3 | `sed -n '69,87p' .github/workflows/g0-gates.yml \| bash` | `syntax error near unexpected token '('`，**exit 2** | 确认 D4 段语法死 |
| F4 | `bash --noprofile --norc -eo pipefail <file>`（抽出 D4 段成文件，模拟 GitHub Actions 的真实调用方式） | 同样 **exit 2**，且 `:13` 报语法错 | 排除「stdin vs 文件 / 缺 -eo pipefail 导致本地不复现」的可能 |
| F5 | `echo "# fail 0" \| awk '{print $7}'` | **空串**（`wc -c` = 1，即只有换行） | 确认 docs-consistency 的 fail 取值恒空 |
| F6 | `echo "summary: 66 passed, 0 failed" \| sed -E 's/.* ([0-9]+) passed.*/\1/'` | `S_PASS=66`、`S_FAIL=0` —— **算得出来，但 yml:121-126 的循环里一次都没用** | 确认「算了不用」 |
| F7 | 按 yml:121-126 的 `for` 循环语义模拟（T_TOTAL=495） | README/CONTEXT/DELIVERY_REPORT/docs/architecture **四个全部 PASS** —— 在有 8+ 处漂移的情况下 | 实证该门「只防漏写、不防错写」 |
| F8 | `grep -rEn 'Date\.now\|Math\.random' packages/ --include='*.ts' \| grep -v '^\s*//' ...` | 原始 4 条，**过完第一道 `grep -v '^\s*//'` 仍剩 4 条**，是第三道 `grep -v ' \* '` 才滤掉的 | 确认 yml:72 第一道过滤器恒失效 |
| F9 | BASELINE §9 的「修正引号等价门」三条 | `P4_hits=0 / NOD_hits=0 / D4_hits=0` | 代码面干净是事实 |
| F10 | 自建负例 fixture（`bad.ts` 含 `Date.now()`/`Math.random()`/`from 'net'`；`good.ts` 注释含 `Date.now()` 且 `from 'node:util'`），跑 F9 三条 | `P4_hits=2 / NOD_hits=1 / D4_hits=1`，注释里的 `Date.now()` **未被误报** | **证明修正后的门有鉴别力**，且注释过滤不误伤（fixture 已删） |
| F11 | `node interop/arkts-check.js .` | `ReferenceError: require is not defined in ES module scope`，**exit 1** | 确认 ESM/CJS 冲突，加载即崩 |
| F12 | `git show 51b70c3:.github/workflows/g0-gates.yml` | D4 那行原文与 HEAD **逐字相同**（`from ['\"]](net\|…)['\"]`） | 实证「自初版即坏，5c3db5e 只修过滤器」 |
| F13 | `git merge-base --is-ancestor 51b70c3 origin/main` + `git rev-parse --short origin/main` | 是（已推送）；`origin/main == main == 90ed53e` | **CI 配置确实在远端**（见 §4 争议点） |
| F14 | `npx tsc --noEmit --listFiles -p .` 与 `-p app/bridge` | `interop/*.ts` 被覆盖数 = **0** | **BASELINE 未列的第五个门禁缺口** |
| F15 | `grep -n 'H2OverNoise' interop/*.ts` | 实例化于 `derp.node.ts:200`、`register.node.ts:228` | 阶段 3 是**冗余重复**，不是补充 |
| F16 | 读 `docs/handover/owner-with-real-device.md:25-27` | Day 1 基线复跑命令是 4 条（test/typecheck/test:bridge/validate:shell），**没有 typecheck:bridge** | 缺陷已经渗进交接契约 |

### 1.2 我读源码确认的结构性事实

- **S1** `app/bridge/src/mock-peerapi.ts:60`：`DnsAnswerFn = (name, qtype) => DnsResolveOutcome`——是个**函数类型**，不是 config。
- **S2** `mock-peerapi.ts:155-200` `serveExitDns` 的判据顺序（逐行读出）：
  1. `replyToDnsQueries(isSelfQuery, offersExitNodeOrAppConnector, filterAcceptsTcp53)` → 不过则 **403**
  2. POST → **501**
  3. `answerDns === null` → **503**
  4. `name` 未定义或空串 → **400 "missing q"**
  5. FQDN 校验（长度/字符集/`..`/前导 `.`）→ **400 "malformed q"** ← e136900 加的安全兜底
  6. `this.config.answerDns(name, qtype)`
- **S3** `interop/h2c.node.ts` 全 281 行，`grep process.argv` = 0，唯一 export 是 `:29` 的 `class H2OverNoise`；`grep -rln H2OverNoise --include='*.test.ts' packages/ app/` = 空 → **零测试覆盖**。
- **S4** `interop/derp.node.ts:37-40` 强制两参；`interop/register.node.ts:43-50` 第三参 hostname **可选**（默认 `ohos-interop-node`）→ register 的两参调用结构上是对的，唯一问题是假 key。
- **S5** `interop/regress.mjs:42` 成功判据 `r.status === 0 && !sawUsage && stdout.length > 0`。
- **S6** `docs/handover/` 已有 owner / agent-interop / reviewer 三份手册（89 / 86 / 106 行），不是空白。
- **S7** 根 `tsconfig.json` `include: packages/**/*.ts`、`exclude: ["app","node_modules"]`；`app/bridge/tsconfig.json` `include: ["src/**/*.ts","test/**/*.ts"]`。两者 compilerOptions 完全一致。

### 1.3 我转引未复验的（诚实标注）

- 495/30/66 三个总数我只复跑了 bridge 的 30（F2）；495 与 66 我**本会话未跑**（跑了但与本轴无关，基线已复跑）。
- 远端 GitHub Actions 的真实红绿：**不可查**（本机无 gh、无网络）。F3/F4 只是同 bash 语义的本地推定。
- headscale / ArkTS SDK / DevEco：**本机不存在**，相关项一律标为「需外部环境」。

---

## 2. 目标拆解思路

「零已知缺陷」听起来是一个状态，但真正要交付的是**一个不会退化的状态**。所以我把目标切成三层，理由是这三层的失败模式完全不同：

- **L1 止血**：把当前已知的红灯/坏脚本修到能跑（typecheck:bridge、D4 段）。
- **L2 可达**：把「修了也没人知道」的那些通道接通（CI 真跑、文档口径落地）。
- **L3 防再犯**：给每一个修复配一个「坏了就会亮」的机检。

**为什么必须分层、不能一把梭**：L1 的修复本身会改变运行时行为（见 §5），如果先做 L3 再做 L1，机检会锁死在错误的行为上；反过来先做 L1 不做 L3，两个月后同样的洞会回来——e136900 引入 TS2353、51b70c3 引入引号错误，两个洞都是**「当时绿、事后红」**。这说明本仓的默认失败模式是「门禁当时绿，之后无声腐化」，所以 L3 的权重在我这里不低于 L1。

**我否决了「先重写门禁再修缺陷」的顺序**（先 L3 后 L1）：L3 的机检要以「正确的目标行为」为基准，而正确行为恰恰要在 L1 里被实证确定下来。特别是 TS2353，我在 §5 证明「字面意图 ≠ 当前行为」，如果先写机检，写的机检锚在哪个行为上就成了猜测。

---

## 3. 关键深挖：TS2353 的语义陷阱（本轴最有价值的一条）

BASELINE §2.4 说「运行时无害」——**这个说法需要修正**。它不是无害，是**恰好没被触发**。

### 3.1 探针实测（我写了临时探针直调 MockPeerApiServer，已删除）

复刻 `makePeerServer` 的内部装配，把 `:245` 那个整包 config 字面量原样当 `answerDns` 传进去（形态 A = 当前真实运行时）：

```
q=".."      -> 400 "malformed q"
q="a..b"    -> 400 "malformed q"
q="."       -> 400 "malformed q"
q=""        -> 400 "missing q"          <-- 注意：走的是 S2 的第 4 道，不是校验器
q="a"*254   -> 400 "malformed q"
q="a b"     -> 400 "malformed q"
q="a/b"     -> 400 "malformed q"
q="a\b"     -> 400 "malformed q"
q="a\x00b"  -> 400 "malformed q"
```

对照形态 B（按**字面意图** `answerDns: null`）：

```
q=".."  -> 503 "DNS feature unavailable"
q="a..b"-> 503 "DNS feature unavailable"
```

对照形态 A 喂一个**合法** q（`host.tail-net.example.ts.net.`）：

```
TypeError: this.config.answerDns is not a function
  at MockPeerApiServer.serveExitDns (mock-peerapi.ts:192)
```

### 3.2 这三条实测说明了什么

1. **当前形态是靠一个类型错误在「意外地」工作**。整包 config 被当成 `answerDns` 传下去，它**非 null**，所以 S2 第 3 道（503）不触发，8 条畸形 q 真的走到了第 5 道 FQDN 校验器。**e136900 的安全兜底在运行时确实被验证了**——这点我要替 BASELINE 补上：不是「运行时无害」，是「运行时因错成对」。
2. **字面修法会让测试直接挂**。`makePeerServer(null)` → 503 ≠ 400 → `assert.equal(r.status, 400)` 失败。好消息是这说明**测试有鉴别力**，坏消息是修复者会以为自己「改坏了测试」，进而可能去改断言——那才是真正的灾难（把安全回归钉子拔掉）。
3. **这颗雷现在没炸，只是因为测试全是负例**。当前测试只喂畸形 q，畸形 q 在第 5 道就被拦下，永远走不到第 6 道的函数调用。一旦有人加一条合法 q 的正例，立刻 `TypeError` 崩。也就是说：**这个类型错误已经在生产代码里埋了一个未捕获异常路径**，只是被测试的单侧覆盖挡住了。

### 3.3 由此得出的修法（形态 C，我已实测逐条一致）

```ts
// app/bridge/test/peerapi-tun.test.ts:245
const server = makePeerServer(() => ({ rcode: 0, negative: false, answers: [], forwardResolvers: null }));
```

实测结果：

```
形态C 9 条畸形 q：400/400/400/400/400/400/400/400/400，与形态A 逐条一致（body 也一致）
形态C 合法 q  ：200 {"RCode":0,"Negative":false,"Answers":[]}   <-- 新增的正控制组
```

它同时做到三件事：类型合法（过 TS2353）、运行时语义与今天**逐条相同**（不引入行为漂移）、并且让「合法 q 应 200」成为可断言的事实。**我建议把这条例正 q 的正控制组一并加进测试**——它就是这条修复的「防再犯钉子」：以后任何人再把 `answerDns` 搞成非函数，正例会立刻崩，而不是等到真机上。

### 3.4 顺带暴露的测试空洞

当前断言只看 `status`，不看 `body`。而 400 有**两个**来源（S2 第 4 道 missing q、第 5 道 malformed q）。空串 `''` 走第 4 道，断言照样通过。加一句 `assert.match(r.body, /malformed q/)`（对非空串那 8 条）能把 400 的来源钉死。**低成本、高价值，但严格说是 P1 不是 P0。**

---

## 4. D4 段：一个我不同意 BASELINE 定性的地方

BASELINE §5.2/§8 说 D4 段「从未在 CI 真正执行过」，暗示是**静默失效**。我认为更准确的说法是**它一直在大声报警，只是没人看**：

- 语法错在 `set -eu` 脚本的第 15 行（yml:83），前三段 echo 已经跑完才崩 → step **exit 2 → 变红**（F3/F4）。
- F13 证明 `51b70c3` 已在 `origin/main` 上，远端确实有这份配置。
- 所以推论：**自 51b70c3 起，每一次 G0 job 都是红的**。要么 owner 一直看着一个红 badge 没当回事，要么 Actions 没真正启用（私有仓额度 / 仓库设置）。

这个区别对规划很重要：
- 如果是「静默失效」，门禁体系的**可信度**是主要问题；
- 如果是「一直红」，那么**没有任何一次 CI 运行是有约束力的**——因为它从来没绿过，谈不上「守住」。这更强，但也意味着**「CI 真跑」这件事本身需要人来确认**，是一条 P0 的人类依赖项，不能由 agent 自行判定。

我把这一条标为**不确定**：本机无网络，`gh run list` 跑不了。**验证方法就一条**：让 owner 打开 `https://github.com/feasy898/ohos-tailscale/actions`，看一眼 51b70c3 之后的 run 是红是绿，或者根本没有 run。这一条建议直接写进「人类配合说明书」。

---

## 5. 备选方案与取舍（含我否决的）

### 关于 TS2353

| 方案 | 结果 | 取舍 |
|---|---|---|
| **A. 传真函数（推荐）** | 实测逐条一致 + 类型绿 + 加正控制组 | ✅ 采纳。唯一同时满足「类型契约正确」和「行为零漂移」 |
| B. `makePeerServer(null)`（字面意图） | 503，测试挂 | ❌ 否决。但**保留为必须写进交接文档的反例**——它是最容易被 agent 选中的「看起来最对」的写法 |
| C. 把 `makePeerServer` 放宽成 `Partial<MockPeerApiConfig>`，在 :245 传整包 | 类型绿，运行时 = 形态 A | ⚠️ 可行但**差**：保留了那颗未捕获 TypeError 雷，等于把缺陷 B 藏进 helper 签名里。否决 |
| D. 删掉这个负例用例 | 全绿 | ❌ 否决。删掉 e136900 唯一的跨包污点回归钉子 |
| E. 在 helper 里加 `as unknown as` 断言压掉 TS2353 | 全绿，行为不变 | ❌ 否决。这是把编译器关掉，不是修类型 |

### 关于 D4 段

| 方案 | 结果 | 取舍 |
|---|---|---|
| **A. 抽成仓内脚本（如 `scripts/gate-d4-p4.mjs`），CI 与本地共用同一入口（推荐）** | 一处改、双处生效；F10 已证明脚本本体有鉴别力 | ✅ 采纳。**额外好处**：顺手把 D4/P4 变成「本地 `npm run gate:d4` 可跑」，真机 agent Day 1 就能自查，不必等 CI |
| B. 只把单引号改成双引号+转义 | 能跑通，但四段内联 grep 继续散在 yml 里 | ⚠️ 兜底方案。若合并人只想做最小改动，选它；但它不解决 F8 的死过滤器 |
| C. 用 `grep -P` 或 `rg` 重写 | 更准 | ❌ 否决：`rg` 不在 CI 镜像的保证依赖里，`grep -P` 在部分 ubuntu 镜像缺 PCRE。**不引入新工具依赖**是这条的硬约束 |

**我否决「把 yml 的内联 grep 换成 rg」的另一个理由**：BASELINE §2.9 的等价门是**用 grep 写的**，合并人复核 D4 结论时手上只有 grep。换工具会让人工复核路径和 CI 路径分叉。

### 关于 regress 阶段 3

| 方案 | 结果 | 取舍 |
|---|---|---|
| **A. 删除阶段 3（推荐）** | F15 证明 `H2OverNoise` 已在 `derp.node.ts:200` 和 `register.node.ts:228` 被实例化，阶段 1/2 已经端到端跑过它。删掉的是**重复且不可达**的检查 | ✅ 采纳。同时消掉 S5 的 `stdout.length > 0` 静默判负陷阱 |
| B. 给 `h2c.node.ts` 加 CLI 入口 | 要新写一段 CLI 代码 + 一套参数校验 | ❌ 否决。为一个已有覆盖的路径再写 281 行文件的新入口，收益为零、风险为正 |
| C. 保留阶段 3 但把 `ok` 判据去掉 h2c | 阶段还在跑、还是空输出、还是污染日志 | ❌ 否决。半吊子最差 |

### 关于「零已知缺陷」的固化形式

| 方案 | 取舍 |
|---|---|
| **A. 每个修复配一条「变异—检测」负例（推荐，但只对 P0 做）** | ✅ 采纳。已用 F10 证明对 D4 门可行；对 TS2353 用 §3.3 的正控制组实现 |
| B. 建一个统一的 `npm run gates` 聚合入口 | ✅ 采纳（低成本、高回报：真机 agent 只需记一条命令） |
| C. 建「零缺陷」的总扫描器（扫全仓找 TODO/FIXME/XXX 等） | ❌ 否决。本仓 TODO 是**有意留的功能标记**（如 `VpnExtensionAbility.ets:41-43`），扫 TODO 会产出噪声 |
| D. 上外部 lint/安全工具（Mimosa 已在用） | ❌ 否决（对真机前）。新工具=新依赖=新失明点。**先修已知的失明点，再谈扩面** |

---

## 6. 建议工作项与验收门

### P0（挡住一切；建议 1 个批次内完成，互相无依赖）

| ID | 工作项 | 机检验收（可复跑） | 依据 |
|---|---|---|---|
| P0-1 | 修 `peerapi-tun.test.ts:245` 为传真函数 + **加 1 条合法 q 正控制组** | `npm run typecheck:bridge` → **exit 0**（当前 exit 2）；`npm run test:bridge` → **31/0**（当前 30/0，新增 1 例） | §3.3 实测 |
| P0-2 | D4/P4 机检抽成 `scripts/gate-d4-p4.mjs`，`npm run gate:d4` 入口 | `node scripts/gate-d4-p4.mjs` → **exit 0 且输出 0 命中**；把 §5 的形态 D 负例（临时注入违规文件）喂进去 → **必须 exit 非 0** | F9/F10 |
| P0-3 | CI 加 `typecheck:bridge` step（yml 五行），G0-5 段改为调 P0-2 脚本 | yml 里**不再出现任何裸 `grep` 行内联**；`bash -n` 语法检查通过 | F3/F4 |
| P0-4 | **owner 确认远端 Actions 真实状态**（人类依赖） | owner 回报一张 Actions 页面截图/链接 + 51b70c3 之后的 run 列表 | §4，不可由 agent 判定 |

> **顺序说明**：P0-1 与 P0-2/P0-3 互不依赖，可并行。P0-4 必须在 P0-3 之后做——先让 CI 变绿，再去看它绿没绿，否则分不清是新绿的还是老红。

### P1（让「绿」有约束力；建议在 P0 之后、P2 之前）

| ID | 工作项 | 验收 | 依据 |
|---|---|---|---|
| P1-1 | docs-consistency 升级为**阻断**，且**改成查「不该有的旧数字」** | 构造一份含 `280 pass` 的 README 副本 → 门必须红；真实 README（清零后）→ 绿 | F7 |
| P1-2 | 扫描列表补 `HARMONY_AGENT_TASK.md`、`TASK.md`、`README.md` 双表清理 | F7 证明现列表**没有** HARMONY_AGENT_TASK，而它恰恰含最危险的「238/238 期望」 | F7 |
| P1-3 | `T_FAIL`/`B_FAIL`/`S_PASS`/`S_FAIL` 四个变量**全部参与判据**（fail≠0 即红） | 把 `# fail 1` 喂进去 → 门必须红 | F5/F6 |
| P1-4 | 修 regress 阶段 1/2（preauthkey 读环境变量、derp 补第 2 参）并**删除阶段 3** | 无 headscale 时报「环境缺失」而非「脚本缺陷」；有 headscale 时能真跑到 401/成功 | §5、regress.mjs:52/54-56、F15 |
| P1-5 | 文档口径勘误落地（BASELINE §6 全部 8 条 + 2 条工具头注释） | 逐条 grep 反向确认旧数字已不存在 | F7、各文档行号 |
| P1-6 | `arkts-check.js` 改 ESM + SDK 路径参数化 | `node interop/arkts-check.js` → **不再 exit 1**（应 exit 0 或「SDK 缺失」的非 1 码），报错信息指向缺哪个环境变量 | F11 |
| P1-7 | 加 `interop/tsconfig.json` 或把它并入某个 tsconfig | `tsc --listFiles` 中 `interop/*.ts` 计数 **0 → 3** | F14 |
| P1-8 | 修 g0-gates.yml:1 注释「五门」→「六门」；README 双表删旧 | grep「五门」在 yml 首部无命中 | BASELINE §4.4 |

### P2（可以交给真机 agent 或直接不做）

- regress 接进一个**可选**的、需要 headscale 的门（不进 G0，因为环境不具备）；
- `npm run gates` 聚合入口（其实 P0-2/P0-3 做完就该有，属 P0.5）；
- upload_server 实证从 8/7 条扩到真 HTTP server（BASELINE §2.7 注明现在是 importlib 直调）。

---

## 7. 缺陷清零的相互依赖（我认为合并人最容易搞错的地方）

```
P0-1 (TS2353)  ──独立──►  但必须先于「真机 agent 首次基线复跑」
P0-2 (D4 脚本) ──独立──►
P0-3 (CI 接线) ──依赖 P0-2──►
P0-4 (人类确认 CI) ──依赖 P0-3──►
P1-1/P1-2/P1-3 (文档门升级) ──建议依赖 P1-5（文档先清零，再把门调成阻断）──►
                        └─ 若先调门后改文档，门会立刻红，噪音大
P1-4 (regress) ──独立，但**无法在本机验收**（需 headscale）──► 只能靠代码审读 + 负例
P1-6 (arkts)  ──无法在本机验收（需 SDK）──► 只能验「不再 exit 1」
P1-7 (interop typecheck) ──一旦加入，会**立刻暴露新错误**（interop/*.ts 从未被类型检查过）
                        └─ 这是好事，但意味着它不是一个「纯增量」任务，要预留修复量
```

**我特别标出 P1-7 的风险**：F14 证明那 3 个文件零类型检查。首次纳入 `tsc` 几乎必然报错（它们是 `--experimental-strip-types` 跑的胶水脚本，不是严格模式代码）。**建议把 P1-7 放在 P1 之后、或者先只做 `--noEmit` 试跑摸底**，别让它在真机前炸出一堆没人有上下文处理的错误。

---

## 8. 不确定性清单（我可能错的地方）

| # | 我的判断 | 不确定性 | 谁/何时复核 |
|---|---|---|---|
| U1 | 「CI 自 51b70c3 起一直红」 | **纯推定**。本机无网络无 gh，Actions 可能压根没跑过 | owner 看 Actions 页（§4） |
| U2 | 形态 C 是 TS2353 的正确修法 | 我只证明了**行为与今天一致**；没证明「测试作者本意就是走 FQDN 校验器」。若作者本意是测 503/403 路径，则 B 才对 | 真机 agent / 评审人读 `git show e136900` 的原始 diff 判断意图 |
| U3 | 空串 `''` 走 missing q 而非校验器 | 我只读了 `mock-peerapi.ts:168-169` 的判据顺序，**没有单测钉死这个归属** | P1 加 body 断言时钉死 |
| U4 | 删 regress 阶段 3 安全 | F15 证明 `H2OverNoise` 被实例化，但**没有测试**证明阶段 1/2 真的跑通了 H2 流 | 需真 headscale 复跑（人类/远端环境） |
| U5 | `interop/*.ts` 纳入 tsc 的修复量 | 我**没有试跑**，不知道是 3 个错还是 30 个错 | 建议合并人先跑一次 `tsc --noEmit` 摸底再排期 |
| U6 | 文档门升级为阻断后是否引入大量新红 | 我只模拟了**当前**状态下该门全绿（F7），没模拟清零后的行为 | P1-5 做完再调门 |
| U7 | 495/30/66 | 我本会话只复跑了 30（F2）。495/66 采信 BASELINE §2.2/§2.6 | 合并人若要对外承诺数字，请自己复跑 |

---

## 9. 风险

- **R1（最高）**：`makePeerServer(null)` 看起来是最自然的修法。任何不知情的 agent 都会选它，然后测试变红，然后它可能去改断言——**这一步会把 e136900 的安全回归钉子拔掉**。**对策：把 §3.2 的实测输出原样写进交接文档和 PR 模板**，让它成为有据可查的「反模式」。
- **R2**：P0-1 加了正控制组后，bridge 用例数 30 → 31。**所有写死 30 的地方都要跟着改**（README、CONTEXT、TASK、g0-gates.yml 注释）。这会让 P1-5 的勘误量上升。**建议合并人决策：要么接受 31 并一次性改齐，要么不加正例把正例放到单独文件**——我倾向前者，因为数字本就该跟着真值走。
- **R3**：P1-7 首次类型检查 interop 可能爆出一批错，挤占真机前的时间预算。
- **R4**：`interop/__pycache__` 目录在本地工作区存在（`ls interop/` 可见），但**未入 git 且被 .gitignore:51 覆盖**（`git ls-files interop/__pycache__/` 为空、`git check-ignore -v` 命中）。它说明实证脚本的副产物是靠**事后补规则**才被挡住的；新增脚本时容易重犯。

---

## 10. 共性必答

### (1)「真机前全部工作完成」的可验收完成定义（尽量机检）

我这一轴给的定义是**五条可机检的合取**，全部 exit 0 才算过：

1. `npm run typecheck:bridge` → **exit 0**（当前 exit 2，唯一的真红灯）
2. `node scripts/gate-d4-p4.mjs` → **exit 0 且 0 命中**；且**变异负例**（注入违规）→ **非 0**（证明门有鉴别力）
3. `npm test && npm run test:bridge && npm run validate:shell && npm run interop:test:upload && npm run perf:baseline` → 全 exit 0
4. **文档一致性扫描** exit 0，且满足：① fail 数参与判据；② 扫描列表含全部 5 份文档；③ 对**旧数字**（280/13/54/238/29/54/6 文件/1066 行）做**否定断言**——任一命中即红
5. `g0-gates.yml` 通过 `bash -n` 语法检查，且其中**不含任何裸内联 grep**（全部委托仓内脚本）；CI step 数与「六门」注释一致

**外加一条不可机检但必须有的**：owner 书面确认「远端 Actions 在 P0-3 之后是绿的」。

### (2) 工作分解与优先序及理由

- **P0 = 止血 + 通电**（TS2353、D4 脚本、CI 接线、人类确认）。理由：这四条是「红线本身是红的」的状态，其余工作都建立在「门禁可信」之上。
- **P1 = 赋义 + 落地**（文档门升级、文档勘误、regress、arkts、interop 类型覆盖、注释清理）。理由：P1 的价值在于「让绿有约束力」，但它全部依赖 P0 先把真红灯干掉，否则改文档时噪音大、验收不可判。
- **P2 = 扩面**（可选的 interop 门、upload 真 HTTP、gates 聚合）。理由：扩面是锦上添花，且每一项都引入新的失败模式。

我**特别强调 P0-4（人类确认 CI）必须排在 P0-3 之后**——先让它绿，再去看它绿不绿；顺序反了会得到「无法判断是修好了还是本来就绿」的结论。

### (3) 真机 agent 交接契约应包含什么

针对我这一轴，交接契约里**必须多出来的**是现有 `docs/handover/`（F16 实测 Day 1 命令漏了 typecheck:bridge）所缺的部分：

- **它拿到什么**：`npm run gates` 一条命令的全绿承诺 + 本文的缺陷清零结论；一份**带实测输出的「反模式清单」**（尤其 `makePeerServer(null)` 那条）。
- **它做什么**：Day 1 基线复跑**必须包含 `typecheck:bridge`**，且必须 exit 0；不一致就停并报，不要往下走。
- **决策边界**：**不要求**它修 interop/arkts/DevEco 相关的一切（那属 P1/P2 或子线 D）；但**要求**它一旦发现 gate 变红，先判定是「环境问题」还是「回归」，两者都**必须回报而不是绕过**。
- **禁则**：禁改 `packages/` 源码（沿用 HARMONY_AGENT_TASK.md:88 的口径并把「六包」改成「8 包」）；禁为了让门变绿而改断言；禁在 evidence/ 里放私钥/preauthkey。
- **回报格式**：固定小节——`gate 复跑原始输出` / `失败项的 exit code` / `判定：回归 or 环境` / `下一步建议`。**要求贴原始输出而不是结论**，这是防「绿灯幻觉」的唯一手段。

### (4) 人类配合说明书应覆盖什么

- **一次性准备**：`hdc list targets` 能看到真机（沿用 owner-with-real-device.md:7-14）。
- **本次新增的唯一硬需求**：**打开 GitHub Actions 页面，回报 51b70c3 之后的 run 状态**。理由见 §4——这是我唯一无法自行判定、且决定「门禁是否曾有约束力」的事实。
- **人要决定的事**（不是 agent 能定的）：① 是否接受 bridge 用例数 30→31 并同步改 5 份文档（§9 R2）；② P1-7（interop 纳入类型检查）的修复量是否挤占真机前预算（U5）；③ headscale 实例由谁提供、preauthkey 谁签发（红线：用后即弃、不入仓）。
- **人提供的东西**：真机 + DevEco + SDK；一个隔离 headscale；以及**对每个 agent 结论的抽查**（不要全信，要抽一条命令原样复跑）。

### (5) 这个目标下最容易被高估或做错的项

1. **「把 TS2353 修绿」被高估**。它不是一行改动，是一个**有语义陷阱的改动**（§3）。这是本轴最容易被做错的一条。
2. **「CI 门禁已存在」被高估**。存在 ≠ 跑过 ≠ 绿过。三个状态在 U1 未确认前是分不开的。
3. **「docs-consistency 在防漂移」被高估**。F7 实测：8+ 处漂移同时存在时它**四个文件全 PASS**。它防的是「漏写数字」，不是「写错数字」。
4. **「interop 能跑」被高估**。F14：那 3 个文件从未被任何 tsc 看过；S3：`H2OverNoise` 281 行零测试覆盖。它们只在「有 headscale 的机器上」才被跑过一次（09-29），而那次之后脚本就坏了。
5. **「零已知缺陷」被高估为一次性状态**。本仓的默认失败模式是「当时绿、事后腐化」（e136900 和 51b70c3 都是当场绿）。**没有机检的清零等于没清**——这是我把 L3 权重提到和 L1 齐平的理由。

---

*本文所有「实测」条目均在本思考员本会话执行，命令与输出一一列出；转引 BASELINE 处已标注；U1/U4/U5/U7 明确标为未验证。*
