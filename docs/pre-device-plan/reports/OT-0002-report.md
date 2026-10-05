# OT-0002 交付报告 · 批次一 P0 缺陷清零（首批四项）

- 任务：OT-0002 · ohos-tailscale · family any · P0
- 执行者：worker-minimax-88（minimax 族，MiniMax-M3.1-Flash-Preview）· 异族成立（planner-glm 验收）
- 执行时间：2026-10-03 21:50 – 23:0x (+08:00)
- 工作区：`D:\new-workspace\ohos-tailscale`
- 远端：`git@github.com:feasy898/ohos-tailscale.git`（origin，与本地 main 同账号，planner 21:2x 补注已确认 push 属常规操作）

---

## 0. 一句话结论

四项 P0 缺陷全部清零并各自独立成提交；可见验收面 **UNEXPECTED_RED=0 / UNKNOWN_TEST=0**；
**14 个红锚转绿待调度侧翻转**（本轮无权翻转，理由见 §5）；未 push，等 owner/merger 终审。

---

## 1. 前置门与接手状态核实

**OT-0001 门**：OT-0001 已在 `tasks/done/`（`OT-0001-first-session-four.by-worker-stepfun-r1.md`）→ 门开，本卡可领。

**planner 交班实况复核**（planner 21:1x 亲测结论，本轮逐条复核）：

| planner 记载 | 本轮核实 | 结论 |
|---|---|---|
| P0-2（stun.ts A23）已 commit `de920e1` | 在 `main` 上（不在 ot-fix 分支上），改动 `packages/netcheck/src/stun.ts` | 属实，但分支归属与 planner 记述略有出入，见 §2.0 |
| P0-1 修复未提交，工作区 2 文件改动 | 属实，但**只做了一半**——见 §2.1 | planner 记述偏乐观 |
| 回归 25 绿 + 51 红锚 + 0 意外红 + 3 STALE | 接手时亲跑完全一致 | 属实 |
| P0-3（interop:regress 三重缺陷）未动工 | 属实 | — |

---

## 2. 四项缺陷逐项交付

### 2.0 P0-2 · stun.ts A23 Generator 违规（已完成，本轮仅核实）

- 提交 `de920e1`，**落在 `main` 上**（前序会话直接提交在 main 并从 main 建了 ot-fix-peerapi 分支，故 planner 记作"落在 peerapi 分支上"；实测 `main == de920e1`）。
- 本轮核实：`npm test` netcheck 全绿、`grep -rEn "function\*|yield " packages/*/src` 0 命中，锚点 T-P0-2-a 转绿。
- **未改动该提交**。分支 `ot-fix-stun-a23` 已删（其 tip 就是 main，留着是误导）。

### 2.1 P0-1 · typecheck:bridge TS2353 + 缺口1 入 CI

**提交 `7a1b9db`（分支 `ot-fix-peerapi-ts2353`）**

planner 记为"修复已完成但未提交"，实测**只完成了一半**——工作区那份改动漏了两个红锚：

| 锚点 | planner 接手时 | 本轮处理 |
|---|---|---|
| T-P0-1-a typecheck exit 0 | 已绿 | 保持 |
| T-P0-1-f yml 含 typecheck:bridge step | 已绿 | 保持 |
| T-P0-1-d 禁则（无 `answerDns: null` 字面量） | **仍红** | 清除 `masq-node` / `exit-no-filter` 两处配置字面量里的 `answerDns: null` |
| T-P0-1-e 计数副断言（`test(` 计数 = 10） | **仍红** | 正控制组必须**独立成 test 块**，否则计数停在 9 |

- 根因：`:245` 向 `makePeerServer` 传了整份 config 对象，而该 helper 签名早已收窄为只收 `answerDns`（TS2353）。按 PLAN"形态 C"改传真函数。
- 正控制组独立成块 → `test:bridge` 由 30 例增至 **31 例**（PLAN P0-1 验收要求的 `# tests 31`），`test(` 计数 9→10。
- 拆出共享 `emptyAnswer` 替换全部 `answerDns: null` 形态。其中 `exit-no-filter` 改后 403 只能来自 PacketFilter 门——原先若门失效会返回 503，**判别力严格提升**。
- ⚠️ **一个易复发的坑**：T-P0-1-d 是**全文子串**判据，注释里写 `answerDns: null` 也会触发红。写注释时必须绕开该字面量（本轮踩过一次）。

验收：`npm run typecheck:bridge` exit 0（修复前 2）；`npm run test:bridge` 31/0；锚点 4/4 转绿。

### 2.2 P0-5 三缺陷 · interop/regress 可归因（PLAN P0-5 子项 2）

**提交 `655e6ea`（分支 `ot-fix-regress-triple`）**

| # | 缺陷（接入时点已知） | 修法 |
|---|---|---|
| 1 | `regress.mjs` 硬编码假 preauthkey | 改读 `HS_PREAUTHKEY`；未设置时显式失败并给出取 key 命令 |
| 2 | derp 阶段只传 1 参 | 补第 2 参 `authKey`（h2c 同步补） |
| 3 | `h2c.node.ts` 无 CLI（`process.argv` 命中 0） | 补 CLI 薄壳：`<baseUrl> <authKey>` → /key 发现 → initiation → POST /ts2021 → Noise IK → h2 POST /machine/register → `H2C PASS` |

**缺陷 2 的机理值得带走**：derp 少传 authKey 时子脚本按 usage 契约 print usage 后退出，而 `runStage` 的判据是「exit 0 且 stdout 非空且无 usage」——usage 页正好卡在判据盲区，阶段结果**不可归因**。（marker 判据本身属 P0-5 子项 1，批次二范围，本轮未动。）

**薄壳的可见性守卫**：`h2c.node.ts` 被 `register.node.ts` / `derp.node.ts` 以**模块形态** import，顶层若直接跑 CLI 会劫持这两个脚本。用 `isCliEntry`（`process.argv[1]` 结尾匹配）守卫，已实测：两者零参运行各自打印自己的 usage。

**⚠️ 我自己在这段代码里犯的两个错（已修，记录以免复现）**：
1. `cliMain` 引用了 `if` 块内 `const` 声明的 `baseUrl`/`authKey` —— 块作用域，模块级函数取不到。改为形参传入。
2. 噪声响应只调了一次 `receive()` 就假定读满 51 字节 —— TCP 分片下会短读。改为 `readExactAllowExtra` 循环读满。

### 2.3 P0-4 · D4/P4 机检抽脚本 + CI G0-5 改调

**提交 `c266aa4`（分支 `ot-fix-gate-d4-script`）**

G0-5 原先在 yml 里内联裸 grep，**三处坏**：

1. **引号 bug**：正则里的 `['\"]` 提前闭合外层单引号 → 整段 `bash -n` 都过不了。
   **即这段 CI 从未真正执行过**——D4/P4 门是"在跑"的假象。
2. **死过滤器**：`grep -v '^\s*//'` 从不命中（`grep -n` 输出以 `path:lineno:` 开头，行首永远不是空白），注释行实际靠另一条规则侥幸挡掉。
3. **两份实现**：人工复核路径与 CI 路径各写一份，改一处就漂。

新脚本 `scripts/gate-d4-p4.mjs`（npm `gate:d4`）：

- **四段**：P4 / node: / D4 / O4（O4 第四段 = 核心包零 `console.`/`process.`/`globalThis`）
- **检索面** `packages` 各包 `src` + `app/bridge/src`（R9 扩面），每次运行打印声明面与豁免清单；面外缺口（`.ets` 面、`platform/` 纪律面）明写出来，不假装覆盖
- **node: 三形态**（`from` / `import()` / `require()`），避开 `mock-localapi.ts` 的 `const node:` 型标注误报（R9 反例）
- **EXEMPTIONS 规则级结构默认空集**（R13）+ meta 断言：缺 reason 拒绝 / 引用不存在规则拒绝 / 豁免覆盖整面拒绝
- **`--root <dir>`** realpath 锚定，副本须自证等价（被检面 `.ts` 文件数一致）

**⚠️ 本轮抓到的最险一个 bug（新脚本自己的）**：glob 展开用 `const [head, , tail] = g.split('*')` —— `'packages/*/src'.split('*')` 只有 **2 段**（星号本身不占位），解构空位把 `tail` 取成了 `undefined`，**8 个 packages 目录全部静默消失**，门却照报"0 命中 ✓"、exit 0。
**一个只扫了 1/9 检索面却宣称全绿的安全门，比没有门更危险。** 已修，并在脚本里加了"glob 展开为 0 目录 → exit 2"的自杀断言。

yml 侧：G0-5 改调仓内脚本；docs-consistency 去掉裸 `awk`——**顺带修一个真 bug**：node 的 TAP 汇总每项独占一行（`# tests 30` / `# fail 0`），原代码按第 7 个字段取 `fail` 恒为空串，该数字**从未参与过任何断言**。已改为按行取。

**为什么 G0-5 保留多行 `run:` 块**：T-P0-4-f 的抽取器自检要求 `run: |` 块数 ≥2（现值为 1 时该锚点红）。改成单行 `run: node scripts/gate-d4-p4.mjs` 会让 T-P0-4-f 转红。已实测确认：单行版 → `not ok 6`。故保留 `shell: bash` + `set -eu` 的多行块。此处**不是任意选择，是被锚点逼出来的**，planner 若认为该改锚点请明示。

---

## 3. 验收证据

### 3.1 可见验收套件（卡内 acceptance：`UNEXPECTED_RED=0`）

```
$ node scripts/test-plan.mjs
文件数 16｜GREEN_OK 25｜ANCHOR_RED_OK 40｜UNEXPECTED_RED 0｜STALE_ANCHOR 14｜UNKNOWN_TEST 0
```

**总数守恒校验**：25 + 40 + 14 = **79**，与 TESTS §2.6 登记的 79 条逐字一致 → **没有锚点被删、没有用例失踪**（删锚点会被 UNKNOWN_TEST 拦截，此处独立复核一次）。

`exit 1` 的原因**仅是 14 个 STALE_ANCHOR**，而翻转动作本轮无权执行（§5）。

### 3.2 四项缺陷的锚点转绿清单（14 条，全部逐条核实确因实现落地）

| 锚点 | 归属工作项 |
|---|---|
| T-P0-1-a / -d / -e / -f | P0-1 |
| T-P0-2-a | P0-2 |
| T-P0-4-a / -b / -c / -d / -e / -f | P0-4 |
| T-P0-5-b / -c | P0-5 三缺陷之 1 与 3 |
| T-REG-4（yml 无假绿逃逸面） | P0-4（顺带：替换 G0-5 内联块后 3 处 `\|\| true` 一并消失） |

### 3.3 逐条命令输出

```
$ npm run typecheck            → exit 0
$ npm test                     → # tests 495 / # pass 495 / # fail 0
$ npm run test:bridge          → # tests 31 / # pass 31 / # fail 0
$ npm run validate:shell       → summary: 66 passed, 0 failed
$ npm run gate:d4              → D4/P4 全 4 段 0 命中 ✓   exit 0
$ node scripts/gate-d4-p4.mjs  → 检索面（9 个目录）… 四段 0 命中
$ node --test tests/plan/p0-4-gate-d4-meta.test.mjs → 7 pass / 0 fail
```

**P0-4 负例（证明门有鉴别力，非恒绿）**：

| 注入 | 期望 | 实测 |
|---|---|---|
| `packages/common/src` 下非注释 `Date.now()` | 命中退 1 | 1 命中 ✗，exit 1 |
| 同位置注释行 `// Date.now()` / `/* Math.random() */` | 0 命中退 0 | 0 命中 ✓，exit 0 |
| `import { x } from 'node:crypto'` | 命中退 1 | 1 命中 ✗，exit 1 |

（fixture 用完即删，`git status` 无残留。）

### 3.4 h2c 薄壳 CLI 契约实测

```
$ node --experimental-strip-types interop/h2c.node.ts
FAIL: usage: node --experimental-strip-types interop/h2c.node.ts <baseUrl> <authKey>   exit 1
$ node interop/regress.mjs          # 未设 HS_PREAUTHKEY
FAIL: 未设置 HS_PREAUTHKEY。 …  取法：headscale preauthkeys create --reuse --expiration 24h   exit 1
```

三个子脚本 usage 必填占位符数均 = regress 实际传参数（2），P0-5 selftest 的 S1 前提已满足。

### 3.5 提交纪律自检

- `git grep --cached -n "<HOLDOUT_DIR 前缀>"` → **exit 1，零命中**（holdout 路径未入暂存区）
- `docs/pre-device-plan/reports/` **未入仓**（OT-0001-report.md 含 holdout 绝对路径明文，按 CONTEXT 纪律永不原样 commit）
- 无 >2MB 文件；无凭据面命中；工作区仅剩 `reports/` 未跟踪

---

## 4. 提交与分支

| SHA | 内容 | 分支 | 相对 main |
|---|---|---|---|
| `de920e1` | P0-2 stun.ts A23（前序会话） | **在 main 上** | — |
| `7a1b9db` | P0-1 TS2353 + CI step | `ot-fix-peerapi-ts2353` | 1 |
| `655e6ea` | P0-5 三缺陷 | `ot-fix-regress-triple` | 2 |
| `c266aa4` | P0-4 机检抽脚本 + yml 改调 | `ot-fix-gate-d4-script` | 3 |
| `5a07e81` | 规划与验收面入仓（48 文件，逐字未改） | `ot-fix-gate-d4-script` | 4 |

当前 HEAD = `ot-fix-gate-d4-script` @ `5a07e81`，四缺陷线性堆叠、各一提交。
**`main` 仍停在 `de920e1`**（未合、未 push）——是否快进合并由 merger 终审决定。

**⚠️ 纪律偏离声明（请 planner 复核）**：卡内"工作法"写的是"每缺陷=新分支"，acceptance 写的是"每缺陷一提交"。二者对不齐——若每缺陷各开一条从 main 分叉的分支，则 `main` 永远停在坏基线（typecheck 红），批次一"止血"落空。本轮取"每缺陷一提交"为硬约束（它是可机器验收的那条），分支按缺陷命名且**线性堆叠**而非分叉，以便一次快进即可集成。若 planner 认为必须分叉，请回退重做。

---

## 5. 锚点翻转：本轮**未执行**，及理由

planner 交班时建议"接手者按 TES §3 核实后翻转 expected.json 并记 worklog"。**本轮没有照做**，因为 TESTS.md 的原文与该建议冲突：

> **§0.7.1**：`tests/plan/**`（含 expected.json、lib/）、`scripts/test-plan.mjs`、`scripts/gates.registry.json` 的修改权限**归调度/验收侧**……**开发 agent 禁改上述任何文件**。
> **§0.7.2**：红→绿翻转由调度 agent 执行；**开发 agent 只报「STALE_ANCHOR 清单」，不自行翻转**。
> **§2.3** 第 2 步同义重述。

理由条款写得很直白：可见测试是规格面，**被测方同时持笔就是 G0-5「门在跑但没约束力」的人为复刻**。本轮正是"跑完门、看着 14 个锚点、亲手把它们标绿"的角色——那正是这条禁令要防的动作。故按 §2.3 只报清单，§3.2 已逐条给出归属工作项，调度侧可直接照单翻转。

**另**：§0.7.3 要求"新增断言一律**先登记 expected.json 再落地**"。本轮**未新增任何断言**（14 个转绿全部是既有断言自然转绿），故不涉及登记。

> 如需 worker 代翻，请 planner 在任务卡或 ESCALATION 中显式授权（属规格面操作，需留痕）。

---

## 6. 未尽事项 / 供 planner 续卡

### 6.1 批次一清单里**尚未**在本卡范围内的项（PLAN §批次一 = P0-1/2/4/7/8）

| 工作项 | 状态 | 说明 |
|---|---|---|
| **P0-7** .gitignore 证据吞噬 | **未开工** | 本卡四项未含。建议续卡 |
| **P0-8** arkts-check.js（ESM/CJS + SDK 路径参数化） | **未开工** | 本卡四项未含。建议续卡 |

### 6.2 卡内点名但属 PLAN 批次二的 P0-5 其余子项

子项 1（marker 行锚判据 + 失败分类枚举）、子项 3（`--out` 落盘 + E4 指纹五件套）、子项 4（`--selftest` S1–S7 门）——本卡只做了子项 2（三缺陷）。对应红锚 T-P0-5-a / -d / -e / -f **仍红且应保持红**，等批次二。

### 6.3 顺带发现，建议登记

1. **文档数字漂移（CI 会 warning，不 fail）**：P0-1 把 `test:bridge` 由 30 例增至 31 例，README/CONTEXT 仍写 30 → docs-consistency job 会发 `::warning`。数字联动属 **P1-2**（批次三）范围，本卡未动。
2. **本卡四项修完后，`npm run interop:regress` 仍无法在本机端到端实证**——需 owner 侧隔离 headscale 实例。真实联调未做，h2c 薄壳的协议正确性目前只有 CLI 契约层面的证据。

---

## 7. 需要 owner / planner 拍板的事项

1. **§5 的锚点翻转授权**：由调度侧执行，还是显式授权 worker 代翻？（建议前者，符合 §0.7）
2. **§4 的分支堆叠 vs 分叉**：接受线性堆叠以便快进，还是要求每缺陷从 main 分叉？
3. **是否 push**：origin 已配置且属 owner 账号仓，planner 21:2x 补注称属常规操作。本轮**未 push**，等 merger 四层门终审。
4. **P0-7 / P0-8 是否即刻开卡**（本卡只覆盖四项，批次一尚未清零）。
