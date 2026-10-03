# 测试设计思考轨迹（minimax-2 / 门禁层 meta 测试）

> **思考轨迹**，不是测试文档。读者是稍后撰写正式测试的合并人（GLM53）。
> 我是五位测试设计思考员之一，独立思考，未读其他四份轨迹。
> 主轴：**测「门本身」的测试**——每道新门/修复门凭什么算有约束力，怎么用机器裁决。

---

## 0. 元信息与亲验清单

凡与门禁相关的数字我全部自己跑过，未采信转述。合并人可直接复现：

| # | 命令 | 实测输出 | 用途 |
|---|---|---|---|
| E1 | `sed -n '69,87p' .github/workflows/g0-gates.yml \| bash` | `bash: line 15: syntax error near unexpected token '('`；exit 2 | D4 段语法死**亲验** |
| E2 | `echo "# fail 0" \| awk '{print $7}'` | 空串，exit 0 | docs-consistency fail 取值恒空**亲验** |
| E3 | `npx tsc --noEmit -p . --listFiles \| grep -c "interop/"` | `0`（`\| grep -c "/app/"` 亦 `0`） | A12 当前 0；tsconfig.json:16 `include:["packages/**/*.ts"]`、:17 `exclude:["app"]` |
| E4 | `npx tsc --noEmit --erasableSyntaxOnly ...`，内容 `function* g(){yield 1}` | **exit 0 —— 抓不到 generator** | validate:arkts 必须 tsc 面 + 正则面**两道** |
| E5 | 同上，内容 `enum E { A }` | `TS1294`，exit 2 | enum 由 `erasableSyntaxOnly`（tsconfig.json:9）白送 |
| E6 | 复制 `app/` 到临时目录跑 `node <tmp>/app/tools/validate-shell.mjs` | `66 passed, 0 failed`，exit 0 | 门**可搬走跑**→注入式 meta 可行 |
| E7 | 删副本 `VpnExtensionAbility.ets` | `65 passed, 2 failed` | 注入违规→红**亲验** |
| E8 | 副本 `mock-peerapi.ts` 加 `from 'node:fs'` + `Date.now()` | `63 passed, 4 failed` | 语义禁则注入→红**亲验** |
| E9 | D4/P4 原型 grep 打向自造 fixture | 三段全中（`Date.now()` / `node:net` / `'net'`） | gate:d4 负例鉴别力**亲验可行** |
| E10 | `node --test <目录>` | `MODULE_NOT_FOUND`，exit 1 | **裸目录不被支持**→meta 必须用 glob |
| E11 | `node --test "<tmp>/*.test.mjs"` / `"**/*.test.mjs"` | 各 `1 pass / 0 fail` | glob 发现可用 |
| E12 | `git check-ignore -v evidence/interop-20261003/regress.log` | `.gitignore:27:*.log`，exit 0（被吞） | A14 当前红**亲验** |
| E13 | `npx tsc --noEmit [--strict] interop/{register,derp,h2c}.node.ts` | **strict 与非 strict 均 2 条**，全在 `derp.node.ts`（TS2741 `stunOnly`@:290、`wallMs`@:305） | **对 PLAN P1-8 假设的实测修正**，见 §8-1 |
| E14 | `grep -cE "run: npm" .github/workflows/g0-gates.yml` | `7`（2 条是 `npm ci`；yml:68 与 yml:101 是内联 `run: \|` 块） | CI 门集合精确基线 |
| E15 | `grep -cnE "continue-on-error\|::warning" .github/workflows/g0-gates.yml` | `1`（yml:124 的 `::warning`；`continue-on-error` 为 0） | 假绿逃逸面基线 |
| E16 | `node -e "console.log(Object.keys(require('./package.json').scripts))"` | `test\|typecheck\|test:bridge\|typecheck:bridge\|validate:shell\|interop:regress\|interop:test:upload\|perf:baseline` | **typecheck:bridge / interop:regress / perf:baseline 不在 CI**；G0-5 连 script 都没有 |

**我踩到的一个真实坑（对设计影响最大）**：E7 之前我先 `rm` 了一个**猜错路径**的文件
（猜 `ets/entryability/VpnExtensionAbility.ets`，实际是 `ets/vpnextensionability/…`），`rm -f` 静默无操作，
门依然 `66 passed, 0 failed` exit 0。**一次没落地的变异，和「门根本没有约束力」在输出上完全一样。**
这条直接决定了 §3.1 的三段式契约，是本篇最重要的设计结论。仓库未被我改动：`git status --porcelain` 仅两行未跟踪目录（`docs/baseline-audit/`、`docs/pre-device-plan/`）。

---

## 1. 测试对象分析：25 个工作项怎么分类

我不用 PLAN 的 A/B 二分（那是**完成定义**的分层），而用**测试可判定形态**四分。同一工作项常横跨两类。

| 类 | 判据 | 归属 |
|---|---|---|
| **甲 本机可机检** | 命令 + exit code + 输出断言，host 机可裁决 | P0-1/2/3/4/5/6/7/8；P1-1/2/3/4/5/7/8/9/10/11/13/14；P2-1/2/3 |
| **乙 只能真机判定** | 答案不在仓内，规划只承诺「变成便宜的实验」 | B1–B8；S0–S8 真机段；CU2/5/6/7/8；O6 阈值 |
| **丙 文档/剧本断言** | 无 exit 语义，靠脚本对 Markdown 结构做断言 | P0-6、P1-2、P1-3、P1-6、P1-12、P2-3、S 序列标签差集 |
| **丁 门自身的元判据（本篇主轴）** | 断言的不是产物，是「检查器有鉴别力」 | 每道新增/修复门各一条 + CI 完整性 + 变异落点 + 门被改弱 |

**三条结论（给合并人）**：① 甲类里 **P0-3 / P0-4 / P0-5 / P1-3 / P1-14 / P1-8 六项交付的是检查器，不是功能**——
对这六项「跑通了」几乎无意义，**唯一有意义的测试是丁类**，这是本篇存在的理由；
② P1-3（docs 门阻断化）表面是文档工作、实际是门改造 → **同时是甲类和丁类**，
其 meta 断言（注入旧数字必须红）是 BASELINE 缺口 3 的唯一闭环手段；
③ 乙类**本轮不测**，只交付「CU 卡二值判定是否可机检（丙类）」与「S 序列命令标签差集是否为空（A11）」——
对真机结果既不预判也不设门，设了就是给假绿开门。

---

## 2. 可见 / holdout 划分原则（必答一）

> **判据能否被「针对测试」绕过，决定它属于可见还是 holdout。**

| 档 | 内容 | 理由 |
|---|---|---|
| **P1 可见** | 门的存在性（门在不在、跑没跑、exit 是否 0） | 门的存在性是开发 agent 的**工作契约**。BASELINE 全部缺口（typecheck:bridge 不在 CI、G0-5 语法死、docs 门失明）都是「门在但没生效」，可见的存在性判据让它在**第一个工作项**暴露，而不是攒到最后 |
| **P2 可见（每门仅 1 条）** | 注入一条已知违规必须红 | 「门有牙齿」的最低证明，成本实测 <2 秒（E6–E8）。**每门只公开 1 条**——公开全部样本等于公布攻击面，agent 会只堵那一条 |
| **P3 holdout** | 每门 N−1 条变异 | 与 P2 同构但不可见。P2 是教学，P3 是考试 |
| **P4 holdout（最该藏）** | meta-meta：对门自身变异（`\|\| true`、`exit 0`、registry 删项、yml 加 `continue-on-error`、注释门数造假） | 「把检查器变弱」的通用手法一旦公开，任何后续 agent 都优先检查这几个位置。BASELINE §5.2-4 的死过滤器就是这么活的——**因为没有任何测试试图发现它** |

**可见侧必须包含「干净基线必须绿」这一半**：只测「注入必须红」的门在恒红时也会绿（假绿）。我的 E6/E7/E8 就是双向的，请保留。

**三条反对意见与处置**：「holdout 藏不住」→ **这条反对是对的**，故机制不是「藏文件」而是「移出仓」（§6）；
「变异要动文件、CI 变慢变脆」→ 全部在临时目录（E6 证可行），并把「门必须能以可指定根运行」写成**对实现的硬约束**（§3.2 前置约定）；
「P2 可见会诱导 agent 调到刚好过可见负例」→ 接受，这正是必须有 P3/P4 的理由。

---

## 3. 门禁 / CI 层 meta 测试设计（主轴）

### 3.1 元模型：三段式契约（由我自己的失败直接推出）

任何「注入已知违规必须红」的断言必须是三段，缺一段即自欺：

```
① 落地确认：变异确实写进了被检面（canary）
   —— 违反后果 = E7：rm 猜错路径，门仍 66/0，测试却「通过」
② 必须红：被检门 exit≠0，且输出出现该违规的**可定位标识**（文件:行 或 规则名）
   —— 只断言 exit≠0 不够：门可能因别的原因红。E1 是活教材：D4 段红，但红在 syntax error 上
③ 还原必须绿：移除变异后同一命令 exit==0（防「门被改成一恒红」）
```

第 ② 条最常被省掉，也最关键：**「红了」不等于「因为对的原因红了」**。

### 3.2 逐门 meta 设计

**前置约定（对实现的硬要求，应写进 PLAN 验收）**：三道新门必须接受**可参数化的被检根**（`--root` / 环境变量 / cwd 相对定位），且**在临时目录副本上运行结果与仓内等价**。
E6 已证 `validate-shell.mjs` 满足（ROOT 取自脚本自身位置）；`ets-mirror-check.mjs`、`gate-d4-p4.mjs`、docs 门**必须**满足，否则它们的 meta 断言写不出来。

| 门 | 干净基线绿 | 负例（红 + 可定位标识） | 额外 meta 断言 | 档位 |
|---|---|---|---|---|
| **A6/P0-3 `validate:arkts`** | 仓内 exit 0 | enum / `let x!: T` / `as const` / `function*` / `@ts-ignore` 逐个 exit≠0 | **分层归属断言**（E4/E5）：`enum` 必须由 tsc 面抓（TS1294），`function*` **必须**由正则面抓（tsc 面 exit 0）。显式记录每条禁则归属哪一面，防止有人误以为 tsc 兜住了 generator 而删「冗余」regex 面 | 可见 1（enum），余 4 holdout |
| **A7/P0-4 `gate:d4`** | exit 0 且 0 命中 | fixture：`Date.now()` 非注释行 + `from 'net'`（E9 原型三段全中） | ① **注释盲区专项**：`Date.now()` 放行尾注释与独立注释行 → 都必须 0 命中（专打死过滤器）；② **豁免规则本身要被测**：`from 'node:crypto'` 在 `.test.ts` → 0 命中，同内容在 `src` → 红。否则「全部豁免」也是绿的 | 可见 1，余 holdout |
| **A8/P0-5 `--selftest`** | exit 0 离线 | S1–S5 各自变异 | **★最该做的一条历史回归**：造**假 child**（exit 0、stdout 空、无 usage）→ regress 判 `SCRIPT_SILENT` 而**非 PASS**。这正是 h2c 当年的原始失败形态（BASELINE §2.10 阶段 3）。要求 regress 支持可注入 child 列表 | 可见 1（假 child），S1/S2/S4/S5 holdout |
| **A16/P1-3 docs 门** | 干净活文档面 exit 0 | 注入 `280 pass`/`六包`/`238`/`1066` 到**副本** → 逐个红 | ① **盲区回归**：对 `# fail 1` 跑 awk 取值必须非空并参与判据（E2 当前取空）；② **fail 参与判据**：注入 `npm test` 假输出使 fail=1 → 红（现设计 fail 算了不用）；③ **禁 warning 化**：docs job 段不得有 `::warning` 与 `continue-on-error`（E15 当前有 1 处 `::warning`） | 可见 1（`280`），余 holdout |
| **A10/P1-14 `gates`** | 全绿 exit 0 | 逐门人为弄红 → 聚合红 | ① **集合等价**：gates 门集合 == A1–A9+文档门，差集空（照抄 A11 的差集范式）；② **传播性**：聚合输出必须**指名道姓**说是哪门红（「红了但不知道为什么」= 下一个门禁缺口的复刻）；③ 脚本内不得出现 `\|\| true` / `process.exit(0)` 兜底 | 可见 1，传播性细节 holdout |
| **A12/P1-8 interop 类型** | listFiles 含 ≥3 interop（E3 现 0） | tsconfig include 指向含类型错误的 fixture 目录 → tsc exit≠0 | ① **覆盖不是空转**：`interop/*.ts` 确实出现在 `--listFiles`（防 include 被 exclude 抵消）；② **例外有界**：`// @ts-nocheck` 条数 ≤ 登记数且每条带理由；③ 用 E13 的 2 条真实错误做 fixture，修完归零 | 可见 1，余 holdout |
| **P0-1 `typecheck:bridge` 入 CI** | exit 0（当前 2） | 注入原传参形态 → 红且 TS2353 定位到行 | 核心风险不是修错，是**修完不入 CI** → 由 §3.3 覆盖 | 可见 |
| **P0-6 `check-stage-docs`** | exit 0 | 副本里删一条命令标签 / 留空分支占位 → 红 | **差集对称性**：既查「标签 ⊄ 引用」也查「引用 ⊄ 标签」（单向差集是常见半盲） | 可见 1，余 holdout |
| **P0-7 / A14 `.gitignore`** | `check-ignore` exit 1 | 加回 `*.log` 吞规则 → exit 0 | 双向：加更多形态（`evidence/x/y.log`、大小写）逐个判；`state.sha256` 保持 exit 1 作不退化对照（E12 亲验基线） | 可见 |

### 3.3 CI 完整性测试（防「本地有门 CI 没跑」）

**门逃逸出 CI 的三条路径**（按 E14/E16 逐条对过）：

| 路径 | 本仓现状 | 对策 |
|---|---|---|
| **A 门没有 script** | G0-5 是 yml 内联 bash（yml:68），本地无孪生 | ① yml 内**不得**出现裸 `grep`/`awk` 机检行（PLAN P0-4 已列）；② 任何内联机检必须有同名 script 孪生 |
| **B 有 script 但 yml 不调** | `typecheck:bridge`/`interop:regress`/`perf:baseline` 不在 yml | **注册表双向差集断言**（下） |
| **C yml 调了但调不响** | `continue-on-error` / step 名与门不符 / `::warning` 降级 | 断言门段无 `continue-on-error`、无 `::warning` |

**注册表设计（关键取舍）**——三种源我逐一否决：
- *从 package.json 反推*：会把「自认不设门」的 `perf:baseline` 也要求进 CI，**越权**。否决。
- *从 yml 反推*：CI 没跑的门就消失了，**恰好放过 B 类逃逸**——正是要防的那条。否决。
- **★显式注册表 `scripts/gates.registry.json`**（由 P1-14 的 `gates.mjs` 读），字段
  `{id, script, ci:bool, ciJob, reason}`，`ci:false` 必须带非空 `reason`。
  **「不进 CI」应是需要显式声明并说明理由的决定，而不是沉默的默认**——这正是 typecheck:bridge 的病根。

**三条互相独立的断言**（防「改注册表凑绿」）：
1. `∀ registry[ci=true]` → yml 全文**字面**出现该 script 名（字符串级，不经注册表，防循环自证）
2. `∀ yml 中 `npm run X`（排除 `npm ci`）` → X ∈ registry（无论 ci 真假）
3. `∀ registry[ci=false]` → `reason` 非空

**门数注释防漂移（廉价高值）**：yml:1 标题与 :3-8 注释自称「G0 五门」而实际有 6 个门 step（E14）。
加断言：**yml 头注释声明的门数 == registry 中 `ci:true` 的门数**。让门自己成为被门测的对象。

**⚠ 防过拟合警告**：断言 1/2 一旦公开，agent 只要「加一个 `ci:false` + 随便写个 reason」就绕过。
**故断言 4 放 holdout**：`ci:false` 条目必须落在「PLAN/README 自认不设门」的白名单内
（目前仅 `interop:regress`、`perf:baseline`，见 BASELINE §5.1 表末行），新增 `ci:false` 须对照该白名单。
**这是整个 meta 体系里最容易被绕过、也最需要 holdout 的一条。**

### 3.4 变异测试的轻量形态（不引框架）

评估过 Stryker 等框架，**否决**三条理由：① 本仓 495 例按设计大量锚在上游向量与字节级死值上，
变异存活率天然高（删一个 `throw` 可能被 5 条向量各自锚住），噪声淹没信号；② 变异 `.ts` 需引 AST 依赖，
而 PLAN **禁 npm install**；③ 本仓的缺陷形态不是「代码被改错」，是「**门没约束力**」——变异对象应是**门**。

**采用：受控 fixture 注入**，四条纪律：① **只变异门与被检配置**，不变异业务源码（源码变异由 495 例的向量锚定负责）；
② 全部在 `mkdtemp` 临时目录、**绝不写回工作树**（E6 证可搬）；③ 变异库存档为「门 × 违规类别」矩阵（非随机变异），
每格有例或显式 `n/a` + 理由；④ 每条变异走 §3.1 三段式。规模建议：可见 ≤12 条（CI 友好），holdout 20–35 条。

### 3.5 门禁自身的红→绿轨迹留证

PLAN P0-5 已要求 selftest 记「红→绿」。我主张**推广到全部新门**——理由是 E1 的教训：
门一旦建成就再没人知道它**从来没红过**（G0-5 活了五个 commit）。形式：worklog.md append-only 记
`门ID | 建门前 exit | 注入负例 exit(建门前) | 建门后 exit | 注入负例 exit(建门后)`，
且**「注入负例 exit≠0」这一格不允许为空**——留空 = 门未被证明有牙齿 = 不算建成。
★**让留证可执行**：registry 每道丁类门带 `mutationWitness` 字段且非空，runner 实跑该 witness 并核对 exit；
否则 worklog 里一句话谁都能编。

### 3.6 放可见还是 holdout / 放哪

| 内容 | 档位 | 位置 |
|---|---|---|
| 门存在性 + 双向 smoke（每门 1 负例） | 可见 | `npm run test:meta`，CI step **`G0-7 meta 门自检`** |
| CI 完整性三条断言 | 可见 | 同上 |
| 变异矩阵余项 + 全部 meta-meta | **holdout** | 仓外 fixture + 独立 runner（§5） |
| selftest 假 child 回归（`SCRIPT_SILENT`） | 可见（历史事故，防再犯价值 > 保密价值） | `test:meta`，并被 A8 覆盖 |
| yml 门数注释 == registry 门数 | 可见 | `test:meta` |

**为什么 meta 必须独立 CI step 而非并进 `npm test`**：`npm test` 的 glob 是 `packages/**/*.test.ts`
（package.json:11），而 A1 判据是「`# tests ≥495` 只增不减」——把 meta 塞进去会让 A1 数字与「协议核心用例数」
继续混口径，**这正是 BASELINE §6 反复出问题的根源**。独立入口 + 独立数字，是避免新增一类口径债的唯一做法。

---

## 4. 逐工作项测试设计思路（必答二）

甲/丙/丁见 §1；★ = 本篇主轴。

**P0-1 修 typecheck:bridge（TS2353）入 CI** — 甲：exit 0；`test:bridge` ≥31/0；
**畸形 q 逐条仍 400 且 body 含 `malformed q`**（行为零漂移，逐条比不能只看总数）；
**合法 q 正控制组断言 `200` + 空答案 JSON**（缺了它「全拒」也是绿的）；
★丁：注入回原形态必红且 TS2353 定位到行 + §3.3 断言 2 自动覆盖「修了不入 CI」。
否决：不接受「只加 CI step 不加正控制组」——那正是 R2 里 `answerDns:null` 修法的形状。

**P0-2 修 Generator** — netcheck 84/0；`grep -rEn "function\*|yield " packages/*/src` 0 命中。
★**不单列测试**：它就是 A6 负例矩阵的一格，可把 P0-2 验收并入 A6，减少重复门。

**P0-3 `validate:arkts`** — 见 §3.2。要点：★**分层归属断言**（E4/E5）必须写死；
`Index.ets` 因 ArkUI struct 走退行正则（TS1146），要单独断言它**覆盖到语义禁则集**；
`kit-stub.d.ts` 符号数 <15 可断言（stub 面最小化）。

**P0-4 `gate:d4` + G0-5 改调** — 见 §3.2。★PLAN 的 `bash -n` 应升级为**逐个 `run: |` 块**都过语法检查——
这就是防「D4 段再次语法死」的那条断言，成本一行。接受 PLAN 的「不引 rg/grep -P」，
并要求**门与 fixture 测试用同一套 grep 逻辑**（不能 rg 跑 fixture、grep 验门）。

**P0-5 regress 可归因 + selftest** — 见 §3.2。甲：无 headscale 跑 → exit 1 **且每阶段 `reason` 非空**、
阶段 1 归 `ENV_UNREACHABLE` 而非 `PROTOCOL_REJECT`（防把环境问题报成协议问题）；
`HS_PREAUTHKEY` 缺失时**不得回落硬编码串**（断言子进程参数里 grep 不到 `regress-dummy-preauthkey`）；丙：`summary.json` 8 字段逐字段非空。

**P0-6 交接包 + 剧本自检门** — `check-stage-docs.mjs` exit 0；旧数字/假命令 grep 0 命中
（`238`/`六包`/`203.0.113.10`/`hvigorw assembleHap`）；★差集对称性；
**`@ohos.net.vpnExtension` 必须写成负断言**（`grep -c "@ohos\.net\.vpn[^E]"`=0）——
因为 `@ohos.net.vpnExtension` 含 `@ohos.net.vpn` 子串，正则不设好就是恒绿。

**P0-7 `.gitignore`** — 见 §3.2（E12 基线）。

**P0-8 `arkts-check.js`** — 不再 `ReferenceError`；无 `ARKTS_SDK_HOME` 时输出含变量名的可读 SKIP；
★**PLAN 未列的第二档**：注入「路径存在但不是 SDK 目录」→ 也必须报可读错而非崩（第一档容易过，第二档才证明真做了路径校验）。
否决：只改 `.cjs` 逃逸 ESM 冲突而不修 SDK 路径（那是半个 P0-8）。

**P1-1 KAT 双 runner** — `test:kat` 全绿 ≥60；★`grep -rn "node:"`（PLAN 原文）会被注释误伤，
应断言 **`from 'node:` / `import('node:` / `require('node:` 三种 import 形态均为 0** 而非字面为 0；
★丁：往 kat `run.ts` 副本注入 `function*` → A6 必红（验证「门收编新包」真发生了）；丙：向量文件不得含 `.test.ts` 引用（防「KAT 只是把测试搬个地方」）。

**P1-2 文档清零** — 丙。★**其验收不可独立判定**：正确性由 P1-3 的门在**点亮之后**才成立。
建议 P1-2 验收在 P1-3 完成前记「暂不判定」，避免用一次性 grep 制造第二次假绿（见 §8-6）。

**P1-3 docs 门阻断化** — 见 §3.2。**这是缺口 3 的唯一闭环手段**，其 meta 测试质量 = 整个「门有约束力」命题的证据。

**P1-4 VpnConfig** — `test:bridge` ≥36/0，逐用例覆盖（空 netmap/带 self/子网路由/DNS 开关/mtu 越界）；
★**mtu 越界用例必须是负用例**（抛错），只断言「返回 mtu=1280」不够。

**P1-5 platform-ports** — `FixedClock` wall/mono 语义分离（P4 纪律的正面证明）；
★契约里「**禁止真机 adapter 两轴都用 Date.now**」目前只是文字 → 建议断言
`platform-ports.ts` 中 `Date.now` 出现次数 == 0（给禁令配一道门）。

**P1-6 CU 卡五张** — 每卡二值判定 + 两分支无空占位（由 `check-stage-docs.mjs` 断言）。
★关键：CU 卡的可机检性在于「每卡分支数 == 2 且每支有下一步动作」，**不检查卡的内容正确性**——
那要真机才知道，检查内容就是伪机检。

**P1-7 integration-mirror** — ★**唯一真正重要的断言**：`--dry-run` 跑完前后
`git status --porcelain` **逐字相同**（工具不得写盘）；
★丁：造含 `function*` 的临时源 → 镜像产物过 A6 必红（验证两工具串联有效）。

**P1-8 interop 纳入 tsc** — 见 §3.2 + **§8-1 的实测修正**。

**P1-9 headscale 重建包** — `grep -c "0.0.0.0" interop/headscale.yaml`=0；device.yaml 存在且 `server_url`≠127.0.0.1；
无 docker 时 `env-check.mjs` 逐项 SKIP 且 **exit 0**（不崩是唯一判据）；
★依赖 O3 未签署时测试应判「阻塞」而非「红」——判定树要区分这两种失败。

**P1-10 provenance + 行号对拍** — manifest 覆盖断言必须是**集合相等**（只写「都覆盖了」对「多出未登记文件」是绿的）；
AU1–AU3 全绿；★**PLAN 只写了正向验收**：必须补反向断言——往 manifest 塞不存在的 `file.go:L999999` → 必红。
这是典型的「检查器没被测过」。

**P1-11 证据链校验器** — 三类缺陷样本分别报错、合法样本 exit 0。
★**合法样本的 exit 0 必须被测**：只测「坏样本会红」的校验器，可以用一个「永远红」的假校验器通过。

**P1-12 OWNER-GUIDE + env-ready schema** — 三栏无空；schema 可加载 JSON；
★schema 应含 `required` 齐 + **O3/O4/O5（真机前必须签署）在 schema 里有对应确认字段**——
schema 是把「是否问过人」变成可判定 IO 的载体，漏字段 = S4 末才发现没问人（呼应 R14）。

**P1-13 perf 四件套** — ArkTS 源码过 `validate:arkts`；Node 参照数字入 worklog/README。
★**真实冲突**：perf 测量必然用时钟，而 D4/P4 禁 `Date.now`/`Math.random`。
建议：perf 源码放 `app/tools/perf/`（不在 `packages/` 扫描面）并开**显式路径豁免**，
且加 meta 断言：**豁免列表非空时每条必须带非空理由**（否则「全仓豁免」也是绿的）。

**P1-14 `gates`** — 见 §3.2 + §3.3 注册表。

**P2-1 upload_server 扩真 HTTP 层** — 原 8 条向量**逐条**仍绿（不是只看总数 8+7）；
★反向：注入 `..%2f` 向量 → 必红，且**Python 视角 inbox 只含 x.bmp**（字节级，不看返回码）。

**P2-2 冗余快照去重** — manifest 记 sha256；★**反向断言**：删快照后 `upstream-lineref` 必须红
（否则「去重」可能制造悬空引用）。

**P2-3 FACTS-APP** — 与 README-app §3 无矛盾（同一断言在两份文档上都跑 = 交叉矛盾检测）；
★断言 **V6 与 FACTS-APP 卡片指向同一 bundleName 字面**，防卡片自说自话。

---

## 5. 测试如何机检集成：位置与命名（必答三）

| 产物 | 路径 | 命令 | CI step |
|---|---|---|---|
| 门注册表 | `scripts/gates.registry.json` | 被 `scripts/gates.mjs` 读 | — |
| 可见 meta 测试 | `tests/meta/*.test.mjs` | `test:meta` = `node --test "tests/meta/**/*.test.mjs"` | **`G0-7 meta 门自检`**（随 g0 job 双矩阵） |
| 注入运行器（可见部分） | `tests/meta/inject.mjs` + `tests/meta/fixtures/` | 同上 | 同上 |
| holdout runner | **仓外** `%LOCALAPPDATA%/ohos-ts-holdout/{run.mjs,fixtures/}` | 独立命令，**不挂 npm** | 独立 holdout job（**非 PR 门**，§6） |
| CI 完整性断言 | `tests/meta/ci-completeness.test.mjs` | 并入 `test:meta` | 同 G0-7 |

**实测约束（E10/E11）**：`node --test <目录>` 在本机 Node v22.23.2 报 `MODULE_NOT_FOUND`（exit 1），
glob（`*.test.mjs` / `**/*.test.mjs`）可用 → `test:meta` **必须写 glob 不能写目录**（与现有 `test`/`test:bridge` 一致）。
**实测约束（E3）**：`tests/` **不进根 tsconfig**（tsconfig.json:16），故 meta 测试天然不受 `npm run typecheck` 管。两个选择：
(a) 保持 `.mjs` 不受 tsc 管；
(b) 新增 `tests/tsconfig.json` 并在 `test:meta` 前跑 `tsc -p tests`。
**我倾向 (a)**：meta 的价值在「红/绿」不在类型；引 (b) 会新增一道门，而新增门本身又需要 meta 测试（无限 regress）。**留合并人裁决。**

**命名纪律**：meta step 名写「测什么」不写「跑什么」——`G0-7 meta 门自检` 而非 `G0-7 run test:meta`（统一改名现有 step 属 PLAN 范围外，可选）。

---

## 6. holdout 的存放与保密机制（必答四）

**结论：纯仓内保密在本仓不可行。** 开发 agent 有全仓读权限 + 可跑任意命令；
任何仓内藏法（加密、gzip、base64）都能在一次会话内还原。我**否决**这三种方案（静态扫描可绕、运行时解码必被读、纪律零技术强制）。

**采用：内容出仓 + 存在性在仓（双轨）**

| 组成 | 位置 | 可见性 | 防什么 |
|---|---|---|---|
| **题型说明书**（几道门、每门几类违规通道、判定规则、红绿定义、留证要求） | 仓内 `docs/pre-device/HOLDOUT-SPEC.md` | 可见 | 防「不知道被测」；**不含具体样本与期望输出** |
| **题库 fixture** | **仓外** `%LOCALAPPDATA%/ohos-ts-holdout/fixtures/` | 仅合并人/owner | 防过拟合的唯一有效手段 |
| **runner 逻辑** | 仓外 `run.mjs`；仓内只留入口契约（fixture 目录布局 + 结果 JSON schema） | 契约可见、逻辑不可见 | 防「改 runner 凑绿」 |
| **存在性哨兵** | 仓内 `.holdout/`（gitignore，只允许空目录 + 一个 sentinel） | 可见但无内容 | 防「删掉整个机制」 |
| **哨兵断言** | 可见 meta 测试断言 `.holdout/` 存在 → 缺失即红并提示 owner | 可见 | 唯一**技术强制**的一环：删了让**可见**测试红，但 agent 仍看不到内容 |

**runner 必须 fail-closed**：仓外 fixture 目录不存在时 **非零退出并报「holdout 未安装」**，绝不能「没题就当过」。**默认绿的 holdout 比没有 holdout 更危险**（这是 holdout 自身的 meta 断言）。

**保密纪律（流程层）**：
- 任务书**不出现**「holdout 里有 N 条」的具体数字（知道数量就能针对性优化到刚好 N 条）。
- 跑完**只回「哪一格未被捕获」（门 ID + 违规类别名）**，不回期望输出原文、不回 fixture 内容（回原文等于下一轮就学会）。
- 题库**每轮重生成/重洗**（随机化文件名与违规符号名），防「记住样本」。

---

## 7. 判定标准（必答五）

### 7.1 可见 meta 测试
| 维度 | 判据 |
|---|---|
| 谁跑 | 开发 agent 每个工作项收口自跑；CI 每次 push/PR（`G0-7`，随 g0 job 双矩阵） |
| 何时 | 与该工作项其他门同批；P1-14 建成后并入 `npm run gates` |
| 什么算过 | 全部可见 meta 用例 `# fail 0`，**且**每道丁类门在 registry 有非空 `mutationWitness` 且实跑红 |
| 失败处置 | 该工作项不算完成。**不许改门、不许改 meta 测试、不许加豁免**。若判定是门本身写错 → 记 worklog 并在下一工作项修，不允许「先禁用后修」 |

### 7.2 holdout
| 维度 | 判据 |
|---|---|
| 谁跑 | 合并人（GLM53）或 owner 指定的独立验收 agent。**开发 agent 全程不跑** |
| 何时 | 两个时点：① P0 全部收口 + P1-3 阻断化之后（门体系成型）；② P2 结束、全量 A1–A16 之前（终验）。**不在 P0 中途跑**——门未建完时跑只会得到「门不存在」的无信息失败 |
| 什么算过 | 矩阵每格要么被正确捕获（红 + 可定位标识），要么显式 `n/a` 且有非空理由。**没有「部分通过」** |
| 失败处置 | 按格回溯到对应工作项返工。**禁止**：(a) 改 holdout fixture（题库由合并人冻结）；(b) 让开发 agent 预跑 holdout 再针对性修补（**这会永久破坏 holdout 独立性，是流程红线**）；(c) 连续两轮同一格失败 → 升级 owner（呼应 D10） |

### 7.3 与 PLAN 判据的挂接（**给合并人的结构性请求**）
- 建议把「`npm run test:meta` 绿」**新增为第 17 条 A 类判据（A17）**。
  否则 A1–A16 全绿而 meta 门可选 = **我们又一次「加了门」，而这一次也没有任何东西在测它**。
- 建议「holdout 全绿」写进 PLAN §2.5 批次四的收口条件，而非留作验收环节的额外步骤。

---

## 8. 考虑过但否决的方案

| # | 方案 | 否决理由 |
|---|---|---|
| X1 | Stryker 等变异测试框架 | 依赖违反禁 npm install；变异对象应是**门**不是业务源码（§3.4 三理由） |
| X2 | holdout 题库存仓内 + 编码/加密 | agent 有全仓读权限 + 可执行任意解码，一次会话即可还原（§6） |
| X3/X4 | 从 package.json scripts 反推 / 从 yml 反推应进 CI 的门 | 前者会把自认不设门的 `perf:baseline` 也要求进 CI（**越权**，E16）；后者会让 CI 没跑的门从集合消失，**恰好放过「本地有门 CI 没跑」**——正是要防的那条 |
| X5/X6 | meta 测试并进 `npm test` 或放 `packages/` 蹭它跑 | A1 的「≥495 只增不减」会把「协议核心用例数」与「门自检用例数」混成一个口径，重演 BASELINE §6 漂移 |
| X7 | `node --test <目录>` 跑 meta | **实测不可行**（E10 `MODULE_NOT_FOUND`），必须用 glob |
| X8 | 只测注入不测还原（单向） | 门被改成一恒红时测试照样绿，违反双向原则（§3.1 第 ③ 段） |
| X9/X10 | 注入违规直接改工作树、跑完 `git checkout` 还原 | 违反「禁改既有文件」纪律；CI 并发/中断留脏树；`git checkout` 还会掩盖「谁改的」。改用临时副本（E6 证可行）；且 docs 门**必须支持 `--docs-root`**，否则注入测试只能脏改工作树——**这是对实现的硬要求，应写进 P1-3 验收** |
| X11 | 给 perf 源码开 D4/P4 白名单（裸开） | 可开（§P1-13 已论证），但须同时要求白名单每条带非空理由 + meta 断言，否则「全仓豁免」也是绿的 |
| X12 | 随机变异而非类别矩阵 | 噪声淹没信号、不可复现、无法做「红→绿留证」（同 X1①） |
| X13 | 让开发 agent 自跑 holdout 自查 | 永久破坏 holdout 独立性（§7.2 处置 b） |
| X14 | 给 holdout 设「部分通过」档 | 门禁体系已有「部分红被当全绿」前科（docs 门 warning 化）。不给档 |

---

## 9. 不确定性与需要合并人裁决

1. **【事实修正，影响 P1-8 排期】** PLAN §P1-8 与分歧 9 均按「首纳可能爆错」估算风险。
   我实测（E13 完整命令见 §0）：以 `--strict`（与根 tsconfig 对齐）跑三个 interop 入口文件，
   **只有 2 条错误，全在 `interop/derp.node.ts`**（TS2741 缺 `stunOnly`@:290、缺 `wallMs`@:305）。
   注意此数字**不等于**纳入 tsconfig `include` 后的完整错误数，但它说明 PLAN
   「排 P1 末尾以免挤占 P0 预算」的依据可能偏重。**建议合并人复核**；若完整 include 下错误数仍在个位数，
   P1-8 可考虑提前（它同时是缺口 5）。
2. **根 tsconfig 对 `.ets` 镜像临时产物的处置未定**：放哪、是否进 `.gitignore`、如何保证清理——**我没裁决**，
   建议列为 P0-3 验收的显式要求（临时产物必须落在 gitignore 面且跑完自动清理）。
3. **`tests/` 是否纳入类型检查**（§5）：我倾向 (a) 不纳入，但这是取舍不是定论，请拍板。
4. **holdout 物理位置**（`%LOCALAPPDATA%` vs 仓外 sibling）：CI runner 上 ubuntu 无 `%LOCALAPPDATA%`，
   需为双平台各定一份路径约定——未决。
5. **`ci:false` 白名单的授权来源**（§3.3）：建议以「PLAN/README 自认不设门」为依据，
   但 PLAN 目前只对 `interop:regress`/`perf:baseline` 有自认。**P1-8/A12 完成后该门是否自动进 CI，PLAN 未定义**——请裁决。
6. **P1-3 与 P1-2 的验收时序**：我主张 P1-2 在 P1-3 完成前「暂不判定」，比附录 B-8 的「先清后立」更严格
   （PLAN 只说顺序，没说 P1-2 期间如何避免自欺）。若合并人认为过严，退路是 P1-2 期间用**一次性脚本**记录清零事实
   （不装成门），P1-3 建成后重跑。
7. **我未跑的检查**（据实声明）：未跑 `npm test` / `typecheck` / `test:bridge` 的完整回归——
   §0 中 E6–E8 跑的是**临时副本**的 `validate-shell.mjs`（同文件、不同路径），非仓内原件；
   未跑 `interop:test:upload`（Python 依赖）、`perf:baseline`（长跑）、`interop:regress`（需 headscale）——与本篇主轴关系不大；
   未逐一验证 `bash -n` 对 yml 各 run 块的判据强度（E1 只复现了整体 exit 2）；
   **未读其他四份规划思考轨迹**（按分工保持独立），故 §4 的逐项设计可能与轨迹 1/3/4/5 存在未发现的交叠或冲突。

---

## 10. 收束：五条关键判断

1. **本仓的缺陷形态不是「代码错」，是「门没约束力」**——G0-5 语法死、typecheck:bridge 不在 CI、
   docs 门 awk 恒空、`grep -v` 死过滤器，四者全属此类（E1/E2/E16 亲验）。故测试主轴必须是**测门**：
   对 P0-3/P0-4/P0-5/P1-3/P1-14/P1-8 六项，「跑通了」不构成验收，「注入违规它会红」才构成验收。
2. **双向验证必须三段式（落地确认 / 必须红且可定位 / 还原必须绿）**——来自我自己的失败：
   `rm` 猜错路径后门依然 `66 passed, 0 failed`。**一次没落地的变异与一道没约束力的门，输出上完全一样。**
   「可定位标识」同样关键：G0-5 被误认成有约束力，正是因为它「红了但红在语法错误上」。
3. **CI 完整性的根因是「门的归属没被声明」**——8 个 script 里 3 个不在 CI、G0-5 连 script 都没有（E16）。
   解法不是「记得加进 CI」，而是**显式注册表 + `ci:false` 必须带非空理由**（§3.3）；
   其 holdout 部分（对照授权白名单）是整个体系里最容易被绕过的一环。
4. **holdout 的有效形式是「内容出仓、存在性在仓」**——仓内藏不住题库（X2），但可以让「删掉整个机制」
   触发可见测试的红，从而保住机制的物理存在（§6）；runner 必须 **fail-closed**，否则默认绿的 holdout 比没有更危险。
5. **请把「`npm run test:meta` 绿」写成第 17 条 A 类判据（A17）**——
   否则会重演本仓最核心的失败模式：我们又一次「加了门」，而这一次也没有任何东西在测它。
