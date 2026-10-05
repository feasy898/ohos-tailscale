# 测试设计思考轨迹（host 本机自动化主轴）—— thinking-test-glm53flash-1

# 0. 元信息与亲验记录

- **成文日期**：2026-10-03；**基准**：git `90ed53e`（本人 `git rev-parse --short HEAD` 实测吻合）。
- **视角主轴**：host（本机 win32/Git Bash/node v22.23.2）可跑的自动化测试设计。真机判定面只在分类时提及，不展开。
- **输入**：PLAN.md（25 工作项/A1–A16/S0–S8/D1–D13/O1–O7）、BASELINE.md（四缺口+第五缺口、缺陷#1–#4、§6 勘误表）。未读 docs/pre-device-plan/ 下任何其他文件（保持测试视角独立，含五份 thinking-plan-*）。
- **本轨迹性质**：推理轨迹，供合并人（GLM53）撰写正式测试用；不是测试文档本身。全文给的是「为什么这么测、备选为何放弃」，可执行断言以伪命令形态出现。

## 0.1 本次亲验记录（测试设计的全部事实锚点，均本人会话原样执行）

| # | 命令 | 实测结果 | 锚定谁 |
|---|---|---|---|
| V1 | `npm test`（输出重定向后取 exit，未经管道污染） | exit 0，`# tests 495 / # pass 495 / # fail 0` | A1 基线；P0-2 语义钉（84 例含其中） |
| V2 | `npm run test:bridge`（同法） | exit 0，`# pass 30` | A4 基线 30；P0-1 后 31 的起点 |
| V3 | `npm run typecheck:bridge`（同法） | **exit 2**，`peerapi-tun.test.ts(246,5): error TS2353 … 'selfAddresses'` | A3/P0-1 红灯现状 |
| V4 | `git check-ignore evidence/interop-20261003/regress.log` | exit **0**（被吞，输出该路径） | A14/P0-7 修复前态 |
| V5 | `git check-ignore evidence/interop-X/state.sha256` | exit **1**（未吞） | A14 的不得回归侧 |
| V6 | `grep -n '\*\.log' .gitignore` | `27:\*.log` | P0-7 插桩点 |
| V7 | `grep -cE '^\s*test\(' app/bridge/test/peerapi-tun.test.ts` | `9` | P0-1 正控制组 +1 → 10，合计 31 |
| V8 | `sed -n '75,90p' / '240,260p' peerapi-tun.test.ts` | :81 单参 helper `makePeerServer(answerDns)`；:245 传整包字面量含 `answerDns: null` | P0-1 修法与 TDD 红的可定义性 |
| V9 | `sed -n '170,182p' packages/netcheck/src/stun.ts` | :176 `function* foreachAttr` 在盘 | P0-2 红锚 |
| V10 | `head -12 interop/arkts-check.js` | `require` 于 :4/:7 + :5/:6 硬编码 `/home/dev/sdk/...` | P0-8 |
| V11 | `grep -c 'process.argv' interop/h2c.node.ts` | `0` | P0-5 S2 断言今天必红 |
| V12 | 读 interop/regress.mjs | runStage 判据 `status===0 && !sawUsage && stdout.length>0`；`'regress-dummy-preauthkey'` 硬编码；derp 阶段仅 1 参 | P0-5 五断言设计依据 |
| V13 | 读 .github/workflows/g0-gates.yml 全文 | G0-5 run 块 :68–87，D4 grep :83 单引号内嵌 `['\"]`；docs-consistency :99–127，`awk '{print $7}'` :106/:112；文件名自称「五门」实际六 step | P0-4 结构断言、P1-3 升级点 |
| V14 | `find app/entry/src/main/ets -name '*.ets'` | 恰 3 个：EntryAbility / Index / VpnExtensionAbility | P0-3 (b) 面两纯类 tsc + Index 正则的分工前提 |
| V15 | `ls docs/pre-device` | 不存在 | P0-6 全新目录，可「先立结构」 |
| V16 | `ls scripts/ app/tools/ packages/` | scripts 仅 perf-baseline.mjs；app/tools 仅 validate-shell.mjs；packages 恰 8 包；check-stage-docs/ets-mirror-check/gate-d4-p4/kat 均不存在 | 新门全为绿地；(a) 面检索面=8 包 |
| V17 | `grep -n '280\|13 pass\|54 passed\|六包' …` | README:42 `280 pass`、:44 `13 pass`、:45 `54 passed`；HARMONY_AGENT_TASK:9/:82/:88 `六包`；DELIVERY:14 `217` | A16 否定断言清单样本真实在盘（先清后立的反面教材） |
| V18 | `sed -n '50,58p' TASK.md` + `ls worklog.md` | D-1 契约明文「register/h2c/derp 全部 exit 0」；worklog.md 在盘 38 行 | P0-5 O2 约束与红→绿轨迹落点 |

测量瑕疵自白：V1–V3 第一遍经管道取 `$?`，捕到的是 `tail` 的退出码（TCB 误报 0）——即重定向复测才锚定 exit 2。这本身就是本轨迹第一条方法论：**凡断言退出码，捕获路径必须与被测进程直连**；正式测试里禁止 `cmd | grep; echo $?` 式伪测量。

# 1. 测试对象分析：25 个工作项的三分类

**分类判据只有一条：裁定「过/不过」的信息在谁手里。**
- **甲类（host 全机检）**：判据是 exit code / grep 命中数 / JSON 结构 / 字节断言，任何 agent 在本机跑同一命令得到同一结果。
- **乙类（host 检结构、真机/人类检内容）**：本机能检「文件在不在、字段齐不齐、脚本过不过自检」，但「内容是否正确/探针是否真答出」必须真机或人。
- **丙类（真机/人类专属）**：判据信息物理上不在本机。

| 项 | 类 | 裁定信息 | 测试形态 |
|---|---|---|---|
| P0-1 | 甲 | tsc exit + test:bridge 计数与畸形 q 行为断言（V2/V3/V7/V8） | 门 + 正控制组 + 行为零漂移断言 |
| P0-2 | 甲 | grep 0 命中 + netcheck 84/0（V9） | 负例 grep + 既有测试保绿 |
| P0-3 | 甲 | 门脚本对违规样本的 exit（V14 前提） | 双面门 + 负对照矩阵（meta-test） |
| P0-4 | 甲 | 门脚本 exit + yml 结构断言（V13） | 抽脚本 + fixture 注入红 + yml 结构检查 |
| P0-5 | 甲（selftest 部分） | selftest 五断言全离线（V11/V12） | selftest 门 + 红→绿轨迹留证 |
| P0-6 | 甲为主乙为辅 | 脚本门可机检；AGENT-TASK 内容正确性最终靠人读 | check-stage-docs 三断言 + 内容负例 |
| P0-7 | 甲 | git check-ignore 退出码（V4/V5/V6） | 双向判据 + 不得回归侧 |
| P0-8 | 甲 | 退出码 + 输出含 SKIP/路径不存在文案（V10） | 行为断言（含 SKIP 字样，非仅 exit 0） |
| P1-1 | 甲 | test:kat 绿 + kat/src 零 node: + (a) 面 0 命中 | 向量数下限 + 双 grep |
| P1-2 | 甲 | 勘误 8 条 grep 0 命中（V17 样本） | 否定断言清单 |
| P1-3 | 甲 | 本地等价门对注入旧数字的副本红 | 阻断门 + 副本注入负对照 |
| P1-4 | 甲 | test:bridge ≥36 + 类型绿 | 新模块标准 TDD（5 用例清单） |
| P1-5 | 甲 | 桩加载/填满断言 | FixedClock/ArrayRng 确定性测试 |
| P1-6 | 乙 | 二值判定**有无**可机检；CU 答案真机 | 结构断言（有判定行、无空占位） |
| P1-7 | 甲 | dry-run 清单输出 + 目录树不变 | 快照比对 + 产物过门后清理 |
| P1-8 | 甲 | listFiles 覆盖 ≥3 | 摸底数字入 worklog + 例外清单有理由注释 |
| P1-9 | 甲（本机部分） | `grep -c "0.0.0.0" headscale.yaml`=0 等 | env-check 逐项 SKIP 不崩 |
| P1-10 | 甲 | manifest 覆盖集==文件集、AU1–AU3 行号对拍 | 集合差断言 + 行号符号断言 |
| P1-11 | 甲 | 校验器对三类缺陷样本分别报错 | 与 P0-5 同款负对照三件套 |
| P1-12 | 乙 | 三栏无空/schema 可解析机检；内容人读 | 每阶段标题下三小节齐备断言 |
| P1-13 | 甲乙 | ArkTS 源码过 (a) 面机检；真机数字丙 | Node 参照系数字入 worklog |
| P1-14 | 甲 | 聚合 exit ⇔ 分门全绿（含「弄红一个→聚合红」） | 聚合行为测试（负例需 holdout 化） |
| P2-1 | 甲 | 真 HTTP 层 7 向量 + 原 8+7 不回归 | 起 server 集成测试 |
| P2-2 | 甲 | sha256 相同→删一份无悬空引用 | 哈希复算 + 引用清零 |
| P2-3 | 乙 | 与 README-app §3 无矛盾靠人读 | 存在性 + 关键词一致性弱断言 |
| B1–B8 / S0–S8 / O1–O7 | 丙 | 真机/人类 | 本机只交付探针与判定树，不设门 |

分类的防误用要点：甲类不等于「测了就真」。A16 文档门当前假绿正是甲类内部的假绿——**机检门的鉴别力本身需要被测**（第 4 节三件套）。乙类的机检部分只防「缺件」，不防「错件」，必须在正式测试文档标注「此断言通过≠内容正确」。

# 2. 共性必答五节

## 2.1 可见测试与 holdout 测试的划分原则

**第一原则：定义「正确」的测试必须可见；定义「门没被骗」的测试必须 holdout。**

三问分流法：
1. 这个测试是不是开发 agent 的日常护栏（完成一项要自跑一次）？是 → **可见**。例：`typecheck:bridge`、畸形 q 400 断言、check-stage-docs。藏护栏只会让开发 agent 在不知道靶子的情况下乱射，逼它跑偏。
2. 这个测试是不是证明「某门能抓住某类违规」的鉴别力证据（meta-test）？是 → **holdout**。可见的话，开发 agent 面对的压力是「让样本变红地绿」，最优解是把门写成针对样本的白名单——BASELINE 死过滤器（缺口 4）证明这种「针对已知输入写死」是本仓真实发生过的失败模式。
3. 这个测试是不是钉「行为零漂移」的负例（如畸形 q 逐条 400）？是 → **可见**。负例不是陷阱，是契约：PLAN P0-1 明文要求逐条一致，开发 agent 有权知道契约原文。

**已经公开、不能再算 holdout 的**：PLAN A6/P0-3 自己列出的负对照样本（enum、`let x!: T`、`as const`、function*、`@ts-ignore`）。这些一旦写入 PLAN 就成了公共知识，正式测试若把它们当保密件是自欺。真正的 holdout 增量在两处：(a) **样本生成器与扩展样本集**（每条禁则 ≥2 变体、落在不同包/不同位置/合法与非法混合干扰项），开发 agent 只见过 PLAN 最小集，无法背样本；(b) **跨门组合负例**（同时注入两类违规，验门的报错是否只报第一类即退出——漏报第二类）。

**什么必须 holdout（按此原则筛出的清单）**：
- H1：validate:arkts 双面的扩展负对照矩阵（生成器按禁则表程序化生成）；
- H2：gate:d4 的 fixture 注入变体（P4/node:/D4 三类 × 非注释/字符串/测试文件伪装等位置变体）；
- H3：P1-3 文档门「副本注入旧数字」的旧数字全集（含 PLAN 未列的历史数字，如 V17 实测的 `217`、`216`、`1066`、`5503`——旧口径不止 PLAN 点名那几个）；
- H4：P1-14 聚合门「弄红分门」的破坏手法（临时违规文件落点）；
- H5：check-stage-docs 的标签差集诱饵（带 `[unknown]` 标签的假命令、空分支占位变体）。

## 2.2 逐项测试设计（P0 全部 8 项 + 关键 P1）

### P0-1 修 TS2353（A3/A4）

- **正控制组防假绿的机理**：当前红灯是类型红（V3），运行时 30/0 是绿（V2）——行为与类型已分叉。只看「类型转绿」防不住两类假绿：① 修复者删掉 `:245` 末例（test:bridge 30→29，类型自然绿但删了负例资产）；② 修复者改 mock 让类型蒙混。正控制组钉住「合法 q → 200 且 body 为空答案 JSON」，使任何绕过 answerDns→ResolverCore 链的改法现形（V8 实测：当前 `answerDns: null` 下合法 q 会 503，正控制组修复前必红——天然 TDD 红锚）。
- **可见断言集**：`npm run typecheck:bridge` exit 0（V3 基线 2）；`npm run test:bridge` `# tests` ≥31 且 fail 0；末例畸形 q 九项逐条 400 且 body 含 `malformed q`（V8 确认现有断言形态，逐条子断言已按评审 A 拆分）；新增正控制组 1 条（V7：9→10）。**计数口径**：畸形 q 是 test 内循环非子 test，`# tests` 只 +1；正式测试须断言「peerapi-tun test( 数=10」防实现者把循环拆成子 test 冲高计数。
- **禁则断言（防 R2 复发）**：grep 断言文件内不出现 `as unknown as` 与 `answerDns: null`（PLAN P0-1 明文禁用）。此 grep 属可见护栏（契约明文）。
- **TDD 顺序**：先加正控制组（红：503≠200）→ 修 :245 为形态 C 传真函数 → 全绿。红→绿各留 worklog 一行。
- **CI 集成**：g0-gates.yml 加 step `G0-7 typecheck:bridge`（命名沿 G0-N 序）。

### P0-2 Generator 清零（A1 侧）

- **可见断言**：`npm test` 保持 495/0（修复只改写 :176 walker，84 例钉语义零漂移）；`grep -rEn "function\*|yield " packages/*/src --include='*.ts'` → 0 命中（V9 现值 1 命中 = 红锚）。
- **TDD**：半适用——「红」是 grep 现值，「绿」是 walker 改写后双绿。不先写新测试（既有 84 例就是测试）。
- **防同类语法再进来**：不靠 P0-2 自身，靠 P0-3 (a) 面常驻接管（依赖关系 PLAN 已定）。P0-2 收口到 P0-3 立门之间是裸奔窗口，窗口内唯一防线是 grep 命令本身——建议把该 grep 临时挂进收口清单而非写成脚本（避免与 P0-3 门重复建设）。

### P0-3 validate:arkts 双面门（A6）

- **门的三件套设计**（本轨迹对全部门的标准模板，见第 4 节）：
  - 正控制：`npm run validate:arkts` 对当前仓 exit 0；
  - 负对照矩阵：语法禁则（tsc 面）与语义禁则（正则面）**分面注入**——PLAN 负对照未分面，而 Index.ets 走的是退行级正则面，弱门的负对照若只打 tsc 面，正则面等于没测。每条禁则 ≥2 变体（如 `as const` 与 `as const` 嵌套对象、`@ts-ignore` 与 `@ts-expect-error`——后者 PLAN 没列，属扩展集）；
  - 结构断言：yml 含 `validate:arkts` step（防缺口 1 复刻：门存在但 CI 不跑）。
- **mirror 保真测试**（防假绿关键）：mirror 漏拷文件 → 被 tsc 的面缩小 → 假绿。断言：mirror 产物文件集合 == 源 .ets 集合（V14：恰 3 个，Index 除外则 2 个），且产物对 2 个纯类文件 tsc exit 0。
- **stub 面差集断言**（R9 的机检化）：kit-stub.d.ts 声明符号集合 − 壳 .ets 实际 import 符号集合 = 空集（stub 多写=掩盖真实缺失 API，少写=假红）。这是把「stub 面最小化」从纪律变成断言。
- **TDD**：负对照样本先于门存在（先写「对这些样本必须非 0」的规格测试），门实现后规格全绿。规格测试本身可见（它定义门的行为契约），样本生成器 holdout（H1）。
- **备选与放弃**：负对照样本常驻仓内 fixtures/ —— 放弃。理由：① 常驻违规样本会被 A16 否定断言和其他 grep 门误命中，制造门间打架；② 开发 agent 可见样本集后可把门写成样本白名单（过拟合通道）。改为生成器临时落盘、跑完即删。

### P0-4 gate:d4 抽脚本（A7）

- **「与 CI 行为一致」的证明设计**（本项专属难点）：一致性是两个可观测物——① yml G0-5 run 块逐字 == `node scripts/gate-d4-p4.mjs`（结构断言，机检读 yml 文本，拒绝任何裸 grep 回潮，V13 确认现 yml :68–87 是内联块）；② 脚本对三个已知状态给出钉死结果：干净仓 exit 0（V13 等价 grep 全 0 为基线）、注入 fixture exit 非 0。①②合起来=「CI 跑的就是本地跑的，且这个『跑』有鉴别力」。
- **fixture 注入的两种设计**：
  - 备选 A：脚本支持环境变量覆盖检索根（默认写死 `packages/`），fixture 落临时目录指向它。优点：不污染被测面、并发安全。缺点：检索根可变意味着「CI 路径」与「负对照路径」扫的不是同一棵树，理论上仍可能分叉。
  - 备选 B：fixture 文件临时落 `packages/` 内某子目录，try/finally 删除。优点：负对照扫的就是真实检索面，一致性无可争辩。缺点：崩溃残留会污染仓（Windows 文件锁使删除失败率非零）。
  - **本轨迹倾向 B 但标注残留风险**，加一条防御：负对照运行前后各跑一次 `git status --porcelain packages/` 断言无差异，残留即报警。请合并人裁决（第 6 节 U1）。
  - **注意一个坑**：`*.log` 类 fixture 名会与 P0-7 后 evidence 豁免规则交互；fixture 一律用 `.ts` 后缀（这正是三类禁则的天然载体）。
- **过滤器自检**（缺口 4 教训）：`grep -v '^\s*//'` 死过滤器曾恒失效——新脚本的每个过滤器必须有单测：喂构造输入（非注释命中行/行首注释行/行中注释行/jdoc 行）断言过滤输出。这是「过滤器的过滤器」。
- **TDD**：规格测试先行（对旧 yml 内联版跑规格=红：V13 已证 exit 2；抽脚本后绿）。

### P0-5 selftest 门（A8）

- **五断言的机检形态**（V11/V12 锚定今天全红，红锚真实存在）：
  - S1 需要把 usage 契约结构化：设计为每个 child 顶部 `export const USAGE` 常量，selftest 解析 `<占位符>` 计数并与 regress.mjs 传参数组长度对比（V12：derp 1≠2 现值红）。**备选**：正则扫 child 源码里的 usage 字符串——放弃，源码正则对重构脆弱且无法区分「声明的契约」与「碰巧的字符串」。
  - S2：`grep -c 'process.argv'`（V11 h2c=0）。
  - S3：零参 spawnSync 实测 exit 1 + stderr 含 `usage:`。
  - S4/S5：summary.json schema 断言（reason 枚举非空、ENV_UNREACHABLE 跳过而非崩溃）。
- **红→绿轨迹留证**：worklog append-only 两段——「修复前 selftest 输出全文（五断言逐条 FAIL 标签）」+「修复后输出全文」。**备选**：存 evidence/interop-*/selftest-red.log——放弃为首选方案，因为 P0-7 未修前 evidence 根本入不了仓（V4），时序上 selftest 红发生在 P0-7 之前或之后不确定；worklog 无此依赖。P0-7 合入后如需文件级证据可再归档，worklog 记指针。
- **防假绿**：S3 必须真 spawn（不能 stub runStage）；selftest 输出必须含逐断言标签（`S1 PASS`…），供 holdout grep 验证「不是只打了 PASS 总标」。
- **O2 分叉**：若 owner 裁删 h2c 阶段，S2 对 h2c 的断言随之删除——测试设计须把五断言写成「阶段清单驱动」而非硬编码三阶段，删阶段时 selftest 自动收缩（对齐 TASK.md:54 契约变更，V18）。

### P0-6 交接包 v1（A11/A15）

- **check-stage-docs 三断言的负对照**：标签差集（STAGE-CHECKLIST 标签全集 vs 剧本引用命令全集，差集必须空）——诱饵样本（`[unknown]` 假命令行）属 H5；旧数字 grep 活文档面 0 命中（V17 提供真实样本，P1-2 清零前这个门必红——**顺序锁死 P0-6 的门在 P1-2 后才准入 gates 聚合**，否则复刻 R12 爆红噪音）；CU 卡无空分支占位。
- **A15 存在性断言**：六文件 + env-ready.schema.json 可 `JSON.parse`；OWNER-GUIDE 每阶段标题下「人提供/人决定/通过判据」三小节齐备。
- **注意范围边界**：V17 实测旧数字分布在 README/DELIVERY/HARMONY_AGENT_TASK——check-stage-docs 的扫描列表必须覆盖 HARMONY_AGENT_TASK.md 与 TASK.md（P1-3 已列，此处防遗漏）。
- **乙类标注**：此门全绿≠AGENT-TASK 内容正确（如克隆地址、API 名替换是否彻底靠 grep 抽样，语义正确性最终人读）。正式测试文档必须写明此限。

### P0-7 .gitignore（A14）

- 双向判据：`git check-ignore evidence/interop-<date>/regress.log` exit 1（V4 现值 0=红锚）；`git check-ignore evidence/interop-X/state.sha256` exit 1（V5 现值已绿，**不得回归侧**）。加第三向：仓根外路径（如 `foo.log`）仍应被吞——豁免必须锚定在 `evidence/` 前缀，防 `!*.log` 全局豁免把 npm-debug.log 放进来。
- TDD：判据先写（红），改 .gitignore 一行转绿。

### P0-8 arkts-check.js（缺_sdk 通道修复）

- 断言设计防两型假绿：① 「exit 0 带 SKIP」必须断言 stdout 含 `SKIP` + 缺失变量名（`ARKTS_SDK_HOME`），仅断言 exit 0 会被「直接 return 0」骗过；② 设 `ARKTS_SDK_HOME=/nonexistent` → stderr 含「路径不存在」类文案且非 `ReferenceError`。
- 测试环境注意：本机无 SDK（PLAN §0 实测 NOT FOUND），两断言都跑在「无 SDK」路径上——恰好是最常见路径，真机 agent 带 SDK 复跑属 B6，不进 host 门。

### 关键 P1 逐项（略式，均套三件套模板）

- **P1-1 KAT**：`test:kat` 全绿 + 断言向量计数 ≥60（runner 输出结构含计数）；`grep -rn "node:" packages/kat/src` → 0；P0-3 (a) 面 0 命中。**meta 设计**：KAT 向量文件应为纯常量——断言向量模块无函数导出（`export const` 之外零导出），防向量被「现算」稀释死值锚定。TDD 适用：先搬向量（数据），runner 后写，向量本身即测试数据无红绿。
- **P1-2/P1-3 文档门**：P1-2 是「清」（否定断言清单在活文档面 0 命中，V17 为真样本）；P1-3 是「立」（awk 取数修正 + fail 数参与 + 否定断言阻断）。**负对照**：README 副本注入 `280 pass` → 门红（H3 扩展集含 217/216/5503/1066）。**顺序即测试**：P1-3 启用阻断前必须先证 P1-2 清零完成（门对真文档绿），否则爆红→门被禁用（R12）——这条顺序本身写进验收步骤。
- **P1-4 VpnConfig**：5 用例清单照 PLAN（空 netmap/self 地址/子网路由/DNS 开关/mtu 越界 [576,1500]）+ 死值锚定（CGNAT `100.64.0.0/10`、ULA `fd7a:115c:a1e0::/48`、MagicDNS `100.100.100.100` 常量逐字节断言）。标准 TDD：5 例先写（模块不存在=编译期红），实现后绿；`test:bridge` 30→≥36 计数联动 P1-2。
- **P1-5 platform-ports**：FixedClock 双轴单调性（wallMs 不动 monoMs 动）、ArrayRng 同 seed 同序列 + 「填满 into」断言（into 后数组无未写字节——用哨兵值预填验证全覆盖）。mock-udp-bus UdpSocket 与 port 结构对齐=typecheck:bridge 面（V3 绿后自动覆盖）。
- **P1-7 integration-mirror**：dry-run 前后目录树快照比对（不落盘）+ stdout 清单行数==镜像源文件数；临时执行模式产物 → 跑 P0-3 门 → 断言产物清理后目录为空。
- **P1-8 interop tsc**：先摸底（错误数入 worklog——这一步本身是「测试即产数据」），纳入后 A12 `listFiles | grep -c "interop/"` ≥3；例外清单逐条理由注释可 grep（`@ts-nocheck` 计数 == 登记数）。
- **P1-10 行号对拍**：manifest path 集合 == docs/upstream 快照文件集合（差集空，P2-2 去重后含哈希复算）；AU1–AU3 `file.go:LNNN` 断言目标行存在且含声称符号——这个门天然自带负对照（改 manifest 指向错误行号须红）。
- **P1-11 evidence-manifest**：三类缺陷样本（缺 reason/缺 marker/缺环境指纹）逐类报错且报错文案指认类别 + 合法样本 exit 0。依赖 P0-5 的 reason/marker 枚举（对齐 P0-5 分类枚举，防两套口径）。
- **P1-14 gates 聚合**：聚合行为测试需要「弄红一个分门」——破坏手法属 H4（holdout）。可见侧只断言「全绿时 exit 0 且输出含各分门名」。

## 2.3 机检集成（npm scripts / CI step / 门的位置与命名）

- **npm scripts 新增**（package.json:10–19 现有 8 条之上）：`validate:arkts`（P0-3）、`gate:d4`（P0-4）、`test:kat`（P1-1）、`gates`（P1-14）。PLAN A11 用 `node scripts/check-stage-docs.mjs` 直调——**建议同时补 npm script `check:stage-docs`**，理由：P0-4 的核心教训是「人工复核路径与 CI 路径必须同工具」，凡入 CI 的命令都该有 npm 别名，CI yml 只许写 `npm run X` 不许裸命令，统一防「CI 跑的和本地跑的不是同一段代码」。
- **CI step 命名与位置**（g0-gates.yml，job g0 内 npm ci 之后按依赖序）：`G0-7 typecheck:bridge`（P0-1）、`G0-8 validate:arkts`（P0-3，依赖 P0-2）、G0-5 改 `node scripts/gate-d4-p4.mjs`（P0-4）、`G0-9 interop selftest`（P0-5）、`check:stage-docs` 步（P0-6，**入 docs-consistency job 而非 g0**——它在 P1-2 清零前必红，放 g0 会阻塞全部平台矩阵，R12 教训）。
- **meta-gate（检门禁的门）落位**：yml 结构断言（step 存在性）放进 `gates` 聚合脚本而非 CI——CI 检自己没有递归终止问题（CI 里的结构断言过了不代表下一次 push 的 yml 还在）。`scripts/gates.mjs` 承担：各分门顺序执行 + yml 结构断言 + 汇总 exit。
- **数字连锁的机检化**：docs-consistency 升级版（P1-3）抓活数字做正反两向——正向（文档含活数字）保留、反向（旧数字否定断言）新增、fail 数参与判据（V13 :106 awk 恒空修复）。新增用例→`# tests` 变化→文档门自动核对：README 只许写「≥N」断言式（TASK.md G0 已改此口径，PLAN P1-2 跟齐）或活数字，写死旧数即红。这样「计数口径变化」不再靠人记得，由门强制。

## 2.4 holdout 的存放与保密机制

- **存放方案**：
  - 备选 A：独立私有 repo，验收时拉取。**放弃**：本机无网络（BASELINE §7：无 gh/网络实测），拉取不可行。
  - 备选 B：加密入仓（密文 + owner 持钥）。**放弃**：git 历史密文永存，密钥管理流程超出本仓现实，且仓内加密文件本身诱导开发 agent 花精力攻击而非开发。
  - **选 C：owner 本机仓外目录**（如 `%USERPROFILE%\.holdout-ohos\`，绝不在仓内、不进 .zcode/），内容 = 样本生成器脚本 + 扩展样本集 + H1–H5 素材；验收脚本经环境变量 `HOLDOUT_DIR` 指入，跑完不落任何仓内痕迹。
- **保密落实的诚实边界**：开发 agent「禁读」无法技术强制——它能读盘上任何文件。能做的三道闸：① 内容不出现在仓内任何文件（含本轨迹——故本文只写类别与生成规则，不写扩展样本正文）；② 生成器由 owner 在验收会话现场放置与删除；③ worklog/交接文档只记「holdout 已验过、结论 N/M 绿」，不记样本内容。**残余风险直白写明**：若开发 agent 在验收前扫描 owner 用户目录，保密失效——缓解靠时序（holdout 在开发完成、快照定稿后才落盘）。
- **防过拟合机理**：开发 agent 可见「禁则表」（必须可见，否则无从开发），不可见「样本生成规则与变体分布」。要把 holdout 全绿，唯一稳定策略是**真实现禁则检测**（理解语法而非匹配清单）——这正是我们要的开发行为。生成器每条禁则 ≥2 变体 + 干扰项（合法代码混入），并在不同包/不同行位落点，防「按文件名/按行号」作弊。
- **谁跑、何时**：开发 agent 不跑 holdout。跑的时点两处：① 开发 agent 快照定稿后、真机 agent 出发前，验收会话（或 owner）跑一遍；② 真机 agent S1 剧本自检时在有工具链机器复跑（S0 已含 `npm run gates`，holdout 是它的超集）。

## 2.5 判定标准

- **谁跑**：可见门=开发 agent 每项收口自跑 + CI 每次 push；holdout=验收会话跑（开发 agent 定稿后）；聚合 `gates`=批次收口（批次一~三以分门代替）+ 真机 agent S0 复跑。
- **何时算过**：三条件同时成立——① exit 0（或门定义的期望码）；② 数字口径只增不减（A1 ≥495、A4 ≥31、A5 ≥66）；③ 行为零漂移断言不回退（P0-1 畸形 q 九条、netcheck 84）。holdout 过=M/N 全绿，部分绿=门存在缺口，**不折算、不四舍五入**。
- **失败处置树**：门红 → 先归因三分（测试错 / 代码错 / 门错），写 worklog；禁改断言凑绿（PLAN 3.3 红线，agent 层面加 grep 审计：diff 中删除断言行即人工复核）；holdout 红 → 区分「门真弱」（补门）与「样本误报」（修生成器并记入 H1 台账），两种都阻塞 A 类闭环。
- **红→绿轨迹**：凡 TDD 项（P0-1/P0-4/P0-5/P0-7/P0-8/P1-4/P1-5），worklog 必须有红、绿两段输出——这是「门有效性」的证据（P0-5 最典型，V11/V12 证明今天红的五断言是真红不是摆设）。

# 3. TDD 适用性总表（25 项）

| 适用形态 | 项 | 红是什么 | 绿是什么 |
|---|---|---|---|
| 标准 TDD（测试先行） | P1-4、P1-5 | 模块不存在=tsc/运行时红 | 实现后全绿 |
| 判据先行的修复型 | P0-1、P0-7、P0-8 | V3/V4/V10 现状红 | 修复后转绿（正控制组对 P0-1 修复前也红：`answerDns:null`→503） |
| 规格先行的立门型 | P0-3、P0-4、P0-5(selftest)、P1-3 | 规格测试对旧状态红（yml exit 2 / selftest 五断言全 FAIL） | 门/脚本实现后规格全绿 |
| 语义钉住型（不可先写） | P0-2、P2-1 | 现状 grep 1 命中 / importlib 层无真 server | 改写后既有测试零漂移 + 新层绿 |
| 反 TDD（先内容后门） | P1-2→P1-3、P0-6(内容部分)、P1-6、P1-12 | 门先立会全仓爆红（R12） | 内容清零/填齐后门才准入 gates |
| 测试即产数据 | P1-8 摸底、P1-13 Node 参照系 | — | 产出入 worklog 作为后续阈值依据 |

关键反直觉点：**文档类项的 TDD 是倒序的**。P1-3 若在 P1-2 前启用阻断，V17 的存量旧数字会让门全红、噪音淹没信号、门被整体禁用——顺序本身就是测试设计的一部分，写进验收步骤第 0 步。

# 4. 防再犯/变异检测总设计（BASELINE 五缺口 → 五条教训）

| 缺口（BASELINE §5.2/§7） | 教训 | 制度化对策（对新门强制） |
|---|---|---|
| 1. typecheck:bridge 不在 CI（缺陷#1 静默存活） | 门存在≠门在岗 | 每个新门配「yml 含此 step」结构断言（meta 层，入 gates.mjs） |
| 2. G0-5 D4 段语法死从未执行（缺陷#3） | 没跑过的门=不存在的门 | 门必须有运行证据：正控制（干净态绿）首次入 CI 即留 run 记录；负对照（注入红）入 holdout |
| 3. docs-consistency 失明（awk 恒空、只防漏写） | 弱门比没门更危险（制造假绿信任） | 文档门必须双向：正向含活数字 + 反向旧数字否定断言 + fail 数参与 |
| 4. `grep -v '^\s*//'` 死过滤器 | 过滤器自身会烂 | 每个过滤器单测：构造输入→断言过滤输出（P0-4 落地首个范例） |
| 5. interop/*.ts 零类型覆盖（第五缺口） | 新增面必须当日入检查面 | 新包（kat）/新目录（docs/pre-device）落地同一 PR 内接入对应门，验收清单含「该面已入何门」字段 |

**统一模板「门三件套」**：① 正控制（对当前合法仓 exit 0）；② 负对照（注入已知违规 exit 非 0，样本=可见最小集（PLAN 已列）+ holdout 扩展集（生成器））；③ 结构断言（npm script 名 + CI step 名 + gates 聚合含此门）。P0-3/P0-4/P0-5/P1-3/P1-11 全部按此模板验收；validate:shell（既有门）与 test 系门补充 ③ 即可（它们已有 ①②事实在盘）。

# 5. 设计备选与放弃理由汇总

| # | 备选 | 放弃理由 | 去向 |
|---|---|---|---|
| 1 | 负对照样本常驻 fixtures/ 目录 | 门间误命中 + 开发 agent 可见样本集→白名单过拟合 | 生成器临时落盘（holdout H1） |
| 2 | gate:d4 fixture 参数化检索根 | 负对照扫的树≠CI 扫的树，一致性留缝 | 倾向真检索面临时落盘（U1 待裁） |
| 3 | selftest 红轨迹存 evidence/ | P0-7 未修前 evidence 入不了仓，时序倒挂 | worklog 首选，P0-7 后可补档 |
| 4 | holdout 私有 repo 拉取 / 加密入仓 | 本机无网络实测 / 密钥流程超现实且诱导攻击 | owner 仓外目录 + env 指入 |
| 5 | S1 断言用正则扫 child 源码 usage | 对重构脆弱、无法区分声明契约与偶发字符串 | USAGE 常量结构化导出 |
| 6 | 把 P0-2 的 grep 写成常驻脚本 | 与 P0-3 (a) 面重复建设，裸奔窗口极短 | 收口清单临时命令 |
| 7 | CI yml 里放 yml 结构自检 | 自检自身无递归保障 | 结构断言放本地 gates.mjs |
| 8 | P0-3 负对照只打 tsc 面 | Index.ets 走正则面，弱面无测试=没测 | 分面注入矩阵 |
| 9 | 计数断言用子 test 展开畸形 q | 冲高 `# tests` 计数、口径失真 | 断言 `test(` 计数=10 |

# 6. 不确定性与需合并人裁决的点

- **U1**：gate:d4 负对照的 fixture 注入方式（真检索面临时落盘 vs 参数化根）——涉及 CI/本地一致性纯度与 Windows 残留风险的取舍（§2.2 P0-4）。
- **U2**：holdout 落盘时序与物理位置的最终拍板——owner 目录方案是「本机无网」约束下的次优，若验收环境有网/有私有 repo，备选 A 更优。
- **U3**：check:stage-docs 的 CI 落位（docs-consistency job vs g0）——PLAN A11 未指定；我建议 docs-consistency 且在 P1-2 后启用，需合并人确认 P0-6 与 P1-2 的执行批次交叠时如何避免爆红噪音。
- **U4**：A16 否定断言清单的边界——V17 实测 DELIVERY_REPORT 存量旧数字（217/216/5503/1066）属历史档案面还是活文档面？PLAN 0.1 术语表把 DELIVERY_REPORT 列入活文档面、把 docs/baseline-audit 列为档案面，但 DELIVERY 内历史叙事段的旧数字是否豁免（只查表格区？）会影响否定断言的误报率。
- **U5**：`# tests` 计数口径的权威定义——node --test 的 `# tests` 对 test() 内循环不计数（V7/V8 佐证），但若实现者把既有循环改写为子 test，计数会虚高且仍「合法」。是否在 A1/A4 判据中加「test( 计数不降」副断言。
- **U6**：P0-8 的「exit 0 带 SKIP」与 P1-9 env-check 的「逐项 SKIP exit 0」形态相同但风险不同——前者 SKIP 可能掩盖「门没跑成」，是否给 arkts-check 的 SKIP 态在 gates 聚合中降权标注（绿但带 SKIP 徽标），请合并人定聚合门的输出契约。

# 7. 覆盖自查

共性五节：§2.1 划分原则 ✓｜§2.2 P0 全 8 项逐项 + P1 全部 14 项（P1-6/8/9/12/13 略式）+ P2 全 3 项 ✓｜§2.3 机检集成 ✓｜§2.4 holdout 机制 ✓｜§2.5 判定标准 ✓。专属视角：每 P0 项的可见验收测试设计（P0-1 正控制组/P0-2 防 grammar 复发/P0-3 负对照矩阵/P0-4 一致性证明/P0-5 红绿轨迹）✓、TDD 顺序 §3 ✓、防再犯 §4 ✓、计数口径 §2.2/§2.3/U5 ✓、集成位置 §2.3 ✓。亲验 18 项（V1–V18）全部本会话原样执行；未跑项：无（凡引用 PLAN/BASELINE 转述处已标注）。
