# 真机前工作总体规划（PLAN）

> **版本 v1.1（2026-10-03，O/R 代拍修订）**：owner 于 2026-10-03 授权拍板人（GLM53）对 §4.2 拍板点 O1–O7 与 [TESTS.md](TESTS.md) §0.3 修订建议 R1–R13 共 20 项代 owner 做出决策。§4.2 改写为「拍板点决策记录」（六要素结构化）；受影响工作项文本就地更新（子条款标注「O/R-2026-10-03」）；完成定义扩为 A1–A17。五份决策思考轨迹（同目录 thinking-decision-*）为裁决输入。物理上必须人类的项（O1 远端观测、O3 正式签发、O6 数值、O7-b/c）拍「处理框架」，显式标注「人类闭合项」。v1.0（同日初版）为五份规划轨迹合并稿，工作项 ID 与编号体系不变。

# 0. 元信息与方法

- **成文日期**：2026-10-03
- **基准**：git `90ed53e`（`90ed53e20fb998cc6c0005ece9147a3855cd7785`，main，本地 22 提交）
- **环境**：win32 / Git Bash / node v22.23.2 / npm 10.9.8，node_modules 在盘；本机 hdc/hvigorw/hvigor/docker/deveco/sdkmgr/ohpm 全部 NOT FOUND（轨迹5 实测，规划沿用——这决定了「本机结构性不可达」的边界）。
- **输入材料**：
  1. [docs/baseline-audit/BASELINE.md](../baseline-audit/BASELINE.md) —— 权威事实基线（本文一切事实判断以其为准，引用格式「BASELINE §x」）。
  2. 五份规划思考轨迹（同目录）：
     - [thinking-plan-glm53flash-1.md](thinking-plan-glm53flash-1.md)（协议运行时风险，下称「轨迹1」）
     - [thinking-plan-glm53flash-2.md](thinking-plan-glm53flash-2.md)（壳与真机交接面，下称「轨迹2」）
     - [thinking-plan-minimax-1.md](thinking-plan-minimax-1.md)（缺陷清零与门禁，下称「轨迹3」）
     - [thinking-plan-minimax-2.md](thinking-plan-minimax-2.md)（互操作与证据链，下称「轨迹4」）
     - [thinking-plan-minimax-3.md](thinking-plan-minimax-3.md)（端到端验收与人类配合，下称「轨迹5」）
- **方法**：合并人（GLM53）通读 BASELINE 与五份轨迹 → 对轨迹新发现的关键事实抽样亲验（stun.ts:176 Generator、regress.mjs:42-59 判据与传参、.gitignore:27、headscale.yaml、shell-session.ts:127 / client.ts:73 / controlbase.ts:41 / tailcfg.ts:57-90 双路径、owner-with-real-device.md:60 假命令、TASK.md:54 D-1 契约原文、linter 报告 disco/netcheck 0 命中、49/49 测试文件 import node:、h2c.node.ts 仅 type-import 且零 node: 导入——最后一条为本规划新增亲验）→ 对十个思考员分歧逐条裁决（附录 B）→ 成文。
- **本文件性质**：规划文档，不修改任何既有文件。全部工作项（第 2 节）由后续执行 agent 在本机落地；真机侧只做本机结构性不可达的事（第 3 节剧本）。
- **红线继承**：8 包接口冻结、D4/P4 注入纪律、隔离 headscale、凭据不入仓、不硬改测试凑绿、禁 npm install、禁擅自 git commit。

## 0.1 术语与编号体系（全文统一，防歧义）

| 记号 | 含义 |
|---|---|
| A 类 | 本机 agent 可机检的完成判据（§1.1，A1–A17；A17 由 R1 于 2026-10-03 批准新增） |
| B 类 | 真机 agent 首答项/探针（§1.2，B1–B8）——**绝不混入 A 类完成定义** |
| P0-/P1-/P2-n | 本规划工作项稳定 ID（§2；后续测试设计按此引用） |
| Sn | 真机 agent 任务序列阶段（§3.2，S0–S8，含 S3.0/S5b） |
| Dn | 决策预埋（§5，D1–D13）：规划阶段已替真机 agent 做掉的决策 |
| On | owner 拍板点（§4.2，O1–O7）：触及验收契约/红线/口径、agent 无权自决 |
| 活文档面 | A13/A16 的 grep 范围：README.md、CONTEXT.md、TASK.md、DELIVERY_REPORT.md、HARMONY_AGENT_TASK.md、docs/handover/、docs/pre-device/、docs/architecture.md |
| 历史档案面 | docs/baseline-audit/、docs/pre-device-plan/、docs/research/、worklog.md——保留原文不追改，它们是证据不是说明书 |
| 轨迹n §x-Nn | 引用思考轨迹内部编号时前缀「轨迹n」，避免与本规划 P/D/O 编号混淆 |

# 1. 目标与完成定义

**目标**（人类意图转述）：完成鸿蒙真机开发前的全部工作——此后只要有一个真机上的 agent 和一份写清楚的人类配合说明书，后续开发即可由真机 agent 完成；真机 agent 只做真机上才能做的事。

「真机前全部工作完成」的可机检定义劈成两类。**A 类是本规划的完成判据（本机 agent 全责）；B 类绝不混入 A 类完成定义**——B 类只承诺「已变成有判定树、有探针、有回报格式的便宜实验」，不承诺答案。

## 1.1 A 类完成定义（本机可机检，全部 exit 0 才算完成）

| # | 门 | 命令 / 判据 | 当前状态 |
|---|---|---|---|
| A1 | 全仓测试 | `npm test` → `# fail 0` 且 `# tests ≥495`（数字只增不减） | 已绿（BASELINE §2.2） |
| A2 | 根类型 | `npm run typecheck` → exit 0 | 已绿（§2.3） |
| A3 | 壳类型 | `npm run typecheck:bridge` → exit 0 | **当前 exit 2（TS2353）**，P0-1 修 |
| A4 | bridge 运行时 | `npm run test:bridge` → `# fail 0` 且 tests ≥31（P1-4 后 ≥36） | 30/0，P0-1 增至 31 |
| A5 | 壳静态机检 | `npm run validate:shell` → `≥66 passed / 0 failed` | 已绿（§2.6） |
| A6 | ArkTS 机检门（新） | `npm run validate:arkts` → exit 0；注入违规样本（function*/enum/`let x!:`/`as const`/`@ts-ignore` 等）→ exit 非 0 | 不存在，P0-3 建 |
| A7 | D4/P4 机检门（新） | `npm run gate:d4` → exit 0 且 0 命中；注入负例 fixture → exit 非 0 | 脚本不存在，P0-4 建（CI 内联版当前 exit 2） |
| A8 | 互操作离线自检（新） | `npm run interop:regress -- --selftest` → exit 0（无需网络/headscale） | 不存在，P0-5 建 |
| A9 | KAT 可移植层（新） | `npm run test:kat` → 全绿（≥60 例）；`grep -rn "node:" packages/kat/src` → 0 命中 | 不存在，P1-1 建 |
| A10 | 聚合门（新） | `npm run gates` → exit 0（聚合 A1–A9 + 文档门） | 不存在，P1-14 建 |
| A11 | 剧本自检（新） | `node scripts/check-stage-docs.mjs` → exit 0（命令标签差集为空） | 不存在，P0-6 建 |
| A12 | interop 类型覆盖 | `npx tsc --noEmit -p . --listFiles \| grep -c "interop/"` ≥3 | 当前 0，P1-8 修 |
| A13 | 悬空引用清零 | `grep -rn "oracle/raw" <活文档面>` → 0 命中 | 多处命中，P1-2 修 |
| A14 | 证据不被吞 | `git check-ignore evidence/interop-20261003/regress.log` → exit 1（非 0） | 当前被 `*.log` 吞，P0-7 修 |
| A15 | 交接包存在性 | `docs/pre-device/` 下 AGENT-TASK.md / STAGE-CHECKLIST.md / DECISIONS.md（D1–D13 全裁 + O1–O7 决策记录抄录、签署/追认栏可空；O3 豁免令 HS-DEV-001 文本随附）/ OWNER-GUIDE.md / CU-CARDS.md / EVIDENCE-SPEC.md / env-ready.schema.json 齐备；CU 卡每项有二值判定；OWNER-GUIDE 每阶段「人提供/人决定/通过判据」三栏无空 | 不存在，P0-6/P1 建齐 |
| A16 | 文档门（升级） | docs-consistency 本地等价 → exit 0：fail 数参与判据 + 旧数字否定断言（280/13/54/238/「六包」等 0 命中于活文档面）；落地物=caliber.json 无值结构 + scripts/doc-consistency.mjs 消费器（R6，O/R-2026-10-03） | 当前假绿，P1-3 修 |
| A17 | meta 门自检（新，R1 已批准） | `node scripts/test-plan.mjs` → exit 0：UNEXPECTED_RED=0 且 UNKNOWN_TEST=0 且 STALE_ANCHOR=0；批次四收口后另须 `tests/plan/expected.json` 无 red-anchor 条目（全 green）。用例总数不写死（当前快照 79 条=25 绿+54 红锚，以 expected.json 为唯一真值源——防数字漂移） | 套件已落地（TESTS-2026-10-03）；过程态 exit 0 今日为真 |

## 1.2 B 类（真机 agent 首答项；规划只交付探针+判定树+回报格式）

| # | 项 | 交付物（本机完成） | 首答载体 |
|---|---|---|---|
| B1 | CU2 BigInt 支持与性能 | CU-CARDS 卡 + KAT 真机外壳 + perf-x25519-arkts | S5b |
| B2 | CU5 Object.keys/Record 语义 | CU 卡（最坏手写键枚举预案，影响面收敛在 netmap patch 单文件） | S5b 后按需 |
| B3 | CU6 `.ts` specifier 可否被 ets loader 接受 | S3.0 最小探针 + D4 判定树 + integration-mirror 工具 | S3.0 |
| B4 | CU7 平台 Clock/Rng API 签名 | CU 卡 + platform-ports 契约（禁凭记忆写，查 SDK .d.ts） | S3–S4 |
| B5 | CU8 hypium 复用 node:test 形态 | KAT 双 runner 设计（答案只剩外壳问题） | S5b |
| B6 | 官方 linter 对 disco/netcheck 复扫 | arkts-check.js 修复（P0-8）+ 复扫步骤入任务书 | S2 |
| B7 | hvigor 首编译真实报错面 | 报错分类 + 处置树 + 最小探针（**不承诺零报错**，轨迹2 §1.6 强定义） | S3 |
| B8 | INTEROP PASS 真复现 / 真机 perf 数字 / 58 份上游补档与真 diff / S4–S8 | 重建包 + 证据规范 + 对拍脚本 dry-run + S 序列剧本 | S2/S5b/S6–S8（O/R-2026-10-03：O7-a 已实测闭合，环境链可通——待 O7-b 拉镜像授权与 O7-c preauthkey 签发，见 §4.2-O7） |

# 2. 工作分解

通则：每项给出稳定 ID、内容、涉及文件、验收标准、依赖、规模（S≤半天 / M≈1 天 / L≈2 天级）、来源。执行 agent 遵守：新增测试只增不减；一切 `packages/` 既有导出不改（新增包/新增导出走 O4/O5）；完成一项跑一次相关门。

## 2.1 P0 —— 不做则真机窗口被占用、门禁失真、真机 agent 迷路（全部本机可机检）

### P0-1 修 typecheck:bridge 红灯（TS2353）并入 CI
- **内容**：`app/bridge/test/peerapi-tun.test.ts:245` 改为向 `makePeerServer` 传**真函数**（形态 C）：
  `makePeerServer(() => ({ rcode: 0, negative: false, answers: [], forwardResolvers: null }))`；
  同文件**新增 1 条合法 q 正控制组**（合法 FQDN → 200 且 body 为空答案 JSON）。禁用 `answerDns: null`（实测 400→503 挂测试，轨迹3 §3.1 探针数据）与 `as unknown as` 压制（把编译器关掉不是修类型）。
- **文件**：app/bridge/test/peerapi-tun.test.ts；.github/workflows/g0-gates.yml（加 `npm run typecheck:bridge` step）。
- **验收**：
  - `npm run typecheck:bridge` → exit 0（当前 2）；
  - `npm run test:bridge` → `# tests 31 / # fail 0`，且畸形 q 各条仍 400、body 含 `malformed q`（与修复前逐条一致——行为零漂移）；
  - yml 含该 step。
- **依赖**：无。**规模**：S。**来源**：轨迹3 §3（形态 C 实测）；BASELINE 缺陷#1/缺口1。裁决见附录 B-1。

### P0-2 修 ArkTS A23 硬违规（Generator）
- **内容**：`packages/netcheck/src/stun.ts:176` 的 `function* foreachAttr` 展开为 while+游标 walker（或回调式迭代），调用点 :215/:382 同步改写；语义由 netcheck 既有 84 例钉住。**只修这一处**——无证据表明 `??`/模板字符串/async 违规，不扩大 diff（轨迹1 备选 D 否决理由成立）。
- **文件**：packages/netcheck/src/stun.ts。
- **验收**：
  - `npm test` netcheck 84/0；
  - `grep -rEn "function\*|yield " packages/*/src --include='*.ts'` → 0 命中（P0-3 门接管后由门常驻保证）。
- **依赖**：无。**规模**：S。**来源**：轨迹1 F5/R2（BASELINE 未列的新发现；本规划亲验 :176 属实）。

### P0-3 新门 `validate:arkts`（.ets 镜像 tsc + 双面禁则扫描）
- **内容**：新建 `app/tools/ets-mirror-check.mjs` + npm script `validate:arkts`，两面：
  - (a) **packages 面**：对 `packages/*/src` 扫可枚举禁则（function*/yield/Object.assign/freeze/defineProperty/delete/for-in/#私有/Symbol/globalThis/apply/call/bind/函数表达式）→ 0 命中；
  - (b) **app 面**：镜像 `app/entry/src/main/ets/**/*.ets` → 临时 `.mirror.ts`；EntryAbility/VpnExtensionAbility 两纯类文件过 tsc（`erasableSyntaxOnly` + strict + `app/tools/types/kit-stub.d.ts` 手写 declare module，面=壳现有 import 面，<15 符号）；Index.ets 的 ArkUI struct 不做 tsc（TS1146，轨迹2 E7），退行级正则扫同一禁则集 + 语义禁则。
  - 语义禁则集（tsc 拦不住的，轨迹2 E5 实证放行）：A5 `let x!:`、A7/A8/A9 解构、A13/A14 索引访问形态、A18 `as const`、A25 throw 非 Error、A26 catch 标注、A30 Symbol/globalThis、A33 `@ts-ignore`。
  - **负对照**：探针样本（enum、`let x!: T`、`as const`、function*、`@ts-ignore`）逐个被抓（exit 非 0）。
- **文件**：app/tools/ets-mirror-check.mjs、app/tools/types/kit-stub.d.ts、package.json、g0-gates.yml（加 step）。stub 头注明「语法/结构级保障，API 签名以真机 SDK .d.ts 为准，首构日回报 stub 与真实 d.ts 的 diff 反向校准」。
- **验收**：
  - `npm run validate:arkts` → exit 0；
  - 负对照逐项 exit 非 0；
  - CI 加 step。
- **依赖**：P0-2（否则 (a) 面红）。**规模**：M。**来源**：轨迹2 E4–E7 实验形状 + §4-P0-2、轨迹1 G-A2；裁决「入 P0」见附录 B-6。

### P0-4 D4/P4 机检抽脚本 + CI G0-5 改调
- **内容**：新建 `scripts/gate-d4-p4.mjs`（内容=BASELINE §9 等价 grep 三段：P4 / node: / D4，修正引号、修正 `grep -v '^\s*//'` 死过滤器）；npm script `gate:d4`；g0-gates.yml G0-5 段改为 `node scripts/gate-d4-p4.mjs`，yml 内不再有裸内联 grep。**不引入 rg/grep -P 新依赖**（轨迹3 §5 理由：人工复核路径与 CI 路径必须同工具）。
- **O/R-2026-10-03 增补（R2/R9/R13/O4 裁决落地）**：
  - **检索面=枚举声明**：`packages/*/src` + `app/bridge/src`（R9 已批准扩面；app/bridge/src 三段等价 grep 现值 0 命中——三位思考员独立亲测吻合）。脚本头注释**且每次运行输出**声明检索面与豁免清单（「沉默只扫一部分」不允许；holdout h03 验证声明面==实际面）。app/entry 的 .ets 面归 validate:arkts (b) 面，两门检索面交集保持空并在声明句写明；`app/entry/src/main/ets/platform/` 纪律面（§3.3）现无机检，作为已登记缺口记录，不假装 R9 覆盖了它。
  - **pattern 必须区分 import 形态**：node: 段用 `from ['\"]node:` / `import('node:` / `require('node:` 三形态（T-P1-1b 先例），防 `app/bridge/src/mock-localapi.ts:229` `const node:` 型类型标注误报（裸 `node:` 字面量实测会假红）。
  - **EXEMPTIONS 规则级豁免结构**（R13）：`{path, rule, reason}` 形态放脚本内常量，**默认空集**（app/tools/perf 在面外是事实不是豁免）；仅当未来检索面扩至 app/tools 时启用，meta 断言「每条豁免 reason 非空且规则级、非全集」。
  - **第四段断言**（O4 联动）：`packages/*/src` 零 `console.` / `process.` / `globalThis`（tsc 在 `types:["node"]` 下拦不住 process，只有真机炸——防 CLI 面渗入冻结包）。
  - **--root <dir> 支持**（R2）：仅限 meta 测试/临时副本，CI 与生产调用必须用默认根（脚本头写明禁令）；副本须自证等价（被检面文件数一致）。
- **文件**：scripts/gate-d4-p4.mjs、package.json、.github/workflows/g0-gates.yml（:83 引号 bug 与 :72 死过滤器一并消灭）。
- **验收**：
  - `npm run gate:d4` → exit 0 且输出 0 命中（检索面含 app/bridge/src）；
  - 负例 fixture（临时文件含 `Date.now()` 非注释行 / `from 'net'`）→ exit 非 0（证明鉴别力，轨迹3 F10 同法）；`const node:` 型标注不误报（R9 反例）；
  - yml 无裸 grep；`bash -n` 对改后 run 块通过；
  - `--root` 指向临时副本运行与仓内等价；声明面与实际面一致（h03）。
- **依赖**：无。**规模**：M（原 S，因 R9/R13 增补上浮）。**来源**：轨迹3 §5 方案 A；BASELINE 缺陷#3/缺口2/缺口4；O/R-2026-10-03 R2/R9/R13/O4。

### P0-5 regress 可归因改造 + 离线 selftest 门
- **内容**：
  1. `interop/regress.mjs`：每阶段声明专属 marker（`INTEROP PASS` / `DERP INTEROP PASS` / `H2C PASS`），成功判据改 `exit 0 && stdout 含本阶段 marker && !usage`（废弃「stdout 非空」这个错误信号源）。**O/R-2026-10-03（O2 裁决）：marker 判据必须行锚**——register=`/^INTEROP PASS/m`、derp=`/^DERP INTEROP PASS/m`、h2c=`/^H2C PASS/m`，且三 marker 互不为子串。依据：思考员4 实测 `'DERP INTEROP PASS'.includes('INTEROP PASS')===true`（拍板人本地复验为 true）——includes 判据会让 derp 输出串台伪造 register 阶段 PASS，行锚是防串台的唯一零依赖手段。失败分类枚举 `{PASS, ENV_UNREACHABLE, ENV_AUTH_REJECTED, SCRIPT_USAGE, SCRIPT_SILENT, PROTOCOL_REJECT}`；summary.json 每阶段扩 `{name,status,exitCode,durationMs,reason,markerSeen,stdoutTail,stderrTail}`；无 headscale 时 TCP 预检（3 行 net.connect）归类 `ENV_UNREACHABLE` 并跳过协议阶段（非崩溃）。
  2. 三缺陷修复：preauthkey 改读环境变量 `HS_PREAUTHKEY`（删除 `regress-dummy-preauthkey` 硬编码）；derp 阶段补第 2 参（authKey）；**h2c 阶段给 `interop/h2c.node.ts` 加 CLI 薄壳**（建 Noise 会话+发一次 h2 请求+打印 `H2C PASS`，参数形态对齐 register/derp 的 `<baseUrl> <authKey>` 两参）。**O2 已裁：补 CLI、保留阶段 3、TASK.md D-1 契约不动**；CLI 薄壳留 interop/（O4 落包后 h2c.node.ts 仅持 process.argv/console.log，类本体 import 自 packages/control/src/h2c.ts——包内零 process 面）。
  3. **O/R-2026-10-03（R3 裁决，批次二阻塞项）**：`--out <dir>` 落盘参数（realpath 锚定，拒绝越界路径——upload_server 同类安全债不重演），默认仍 tmpdir；summary 增 `runId`/`startedAt` 批次标识与 E4 环境指纹四元组（headscale image tag+digest、node 版本、脚本 git sha、时间戳）；同一次运行同批产出 `regress.log`（stdout+stderr 合并）+ `summary.json` + `state.sha256` 三件；归档 runbook 的 `sha256sum state/*` 死命令（仓根无 state/ 实测 exit 1）改写为可执行形态。
  4. 新增 `--selftest` 分支（全离线，轨迹4 §3.3 + O/R 增补）：
     - S1 每个 child 的 usage 必填占位符数 == regress 传参数（今天红：derp 1≠2）；
     - S2 每个 child 至少 1 处 `process.argv`（今天红：h2c=0）；
     - S3 零参调用 child → exit 1 且 stderr 含 `usage:`；
     - S4 无 HS → 归类 `ENV_UNREACHABLE` 并跳过；
     - S5 summary 每阶段 `reason` 非空；
     - S6（历史回归）「exit 0 + stdout 无 marker + 无 usage」假 child → 判 `SCRIPT_SILENT` 而非 PASS；「exit 0 + 打 usage」→ `SCRIPT_USAGE`；
     - S7 marker 互不串：三 marker 在代码里独立出现，**行锚判据下** derp/h2c 阶段不得被 `INTEROP PASS` 串台（O2）。
     **记录「修复前 selftest 红 → 修复后绿」轨迹入 worklog**（门有效性的证据，轨迹4 R2）。
- **文件**：interop/regress.mjs、interop/h2c.node.ts（加 CLI）、docs/handover/agent-interop-regression.md（归档命令改写）、package.json（如需）。
- **验收**：
  - `npm run interop:regress -- --selftest` → exit 0（离线）；
  - 无 headscale 跑 `npm run interop:regress` → exit 1 且 summary 显示 `reason=ENV_UNREACHABLE`（不再是不可归因的 false）；
  - `--out` 落盘三件齐且同批（T-P0-5-d）；
  - 红→绿轨迹已记录。
- **依赖**：O2 已裁（不阻塞）。**规模**：M。**来源**：轨迹4 A1/A2/§3.2/§3.3、轨迹3 §5、轨迹5 §3-S2；BASELINE 缺陷#2；附录 B-3；O/R-2026-10-03 O2/R3。

### P0-6 交接包 v1：AGENT-TASK 重写 + STAGE-CHECKLIST + DECISIONS + 剧本自检门
- **内容**：新建 `docs/pre-device/`：
  - `AGENT-TASK.md`：以 HARMONY_AGENT_TASK.md 骨架重写的真机任务书。硬勘误与必备件：
    - 8 包/495（非「六包/238」）；
    - 克隆地址用真实 remote（github.com/feasy898/ohos-tailscale，非 `git://203.0.113.10:9418` TEST-NET-3 死地址）；
    - 回传通道改为「人类当面接收 + 可选 git push」（HTTP 收件箱令牌已 scrub，不得再引用）；
    - API 名 `@ohos.net.vpnExtension`（非 `@ohos.net.vpn`）；
    - entry 现状「尚无 @ohos-tailscale import，CU6 验证载体=按 P1-7 工具接入后的最小探针」；
    - 首章载 D1 控制面路径结论与 S6 失败处置树；
    - 附「反模式清单」：`makePeerServer(null)`（实测 400→503 挂测试）、`as unknown as` 压制、改断言凑绿、删负例用例。
  - `STAGE-CHECKLIST.md`：S0–S8 每条命令标 `[local]`/`[device]`/`[human]`。**O/R-2026-10-03（R4/O6/O7 裁决）增补**：①S5b 必含「随机字节快照落 evidence」步骤——三配套：触发时机（S5b 跑 KAT/perf 前先开快照环形缓冲，非失败后补采）、落点与回传命令（`hdc file recv` → `evidence/interop-<date>/rng-snapshot/`；`.bin` 不在 .gitignore 吞噬面，P0-7 断言覆盖）、check-stage-docs 断言步骤文本含回传命令；②S5b 含 O6 三档判据与「>50 ms/op 停并升人」显式指令（不扩 D10 编号）；③O7 owner 答复落地前不写任何主机信息（env-alias 黑名单联动，见 §4.2-O7）。
  - `DECISIONS.md`：第 5 节 D1–D13 抄录 + O1–O7 拍板决策记录（§4.2 v1.1 抄录）+ owner 签署/追认栏（可空，签署前标「待拍板」；O3 豁免令 HS-DEV-001 文本随附）。
  - `scripts/check-stage-docs.mjs`：断言「标签全集==剧本引用命令全集，差集空」+ 活文档面旧数字 grep 0 命中 + CU 卡无空分支占位。**注意（R6）**：六断言不得要求 caliber.json 存在（批次四落地物不卡批次二收口）。
  - **O/R-2026-10-03（R7 裁决）新增 `scripts/check-decision-trees.mjs`**：判定树完备性五断言，为 `tests/plan/lib/tree-check.mjs` 规格内核的**等价收编**（重写须过同等自检，禁重写规格）；覆盖树清单在原五棵之外追加 **S5b perf 触发树**（>50 停并升人分支，O6 联动）。
  - 同步修 `docs/handover/owner-with-real-device.md` 三处：:60 假命令 `hvigorw ...`（改「DevEco 内 Build > Build HAP(s)，或 commandline-tools 下 hvigor assembleHap」）；:47 `@ohos.net.vpn`→`@ohos.net.vpnExtension`；Day1 基线命令补 `typecheck:bridge`（轨迹3 F16：已渗进交接契约的漏项）。
  - `HARMONY_AGENT_TASK.md` 顶部加一行废弃指向（指向 AGENT-TASK.md）。
- **验收**：
  - `node scripts/check-stage-docs.mjs` → exit 0；
  - `grep -rn "238\|六包\|203.0.113.10\|hvigorw assembleHap" docs/pre-device/ docs/handover/ HARMONY_AGENT_TASK.md README.md CONTEXT.md TASK.md` → 0 命中；
  - AGENT-TASK 内每个 CU 探针有「接受/不接受」二值判定与分支。
- **依赖**：P0-1/P0-3/P0-4/P0-5 定稿后写数字（可先立结构后补数字）。**规模**：M。**来源**：轨迹5 §1.4 四条假命令/S1、轨迹2 §4-P0-4；BASELINE §6 勘误表。

### P0-7 修 .gitignore 证据吞噬
- **内容**：`.gitignore` 在 `*.log`（:27）之后补**限定式**否定规则 `!evidence/` 与 `!evidence/**/*.log`（禁全局 `!*.log`），使证据规范（P1-11）要求的 `evidence/interop-<date>/regress.log` 可入仓——否则 D-3「复跑留证」在当前规则下是空操作。
- **文件**：.gitignore。
- **验收（O/R-2026-10-03 R5 裁决：双向判据，T-P0-7-e 为主断言）**：
  - 正向：`git check-ignore evidence/interop-20261003/regress.log` → exit 1（不再被忽略）；`git check-ignore evidence/interop-X/state.sha256` → exit 1（现状已如此，不得回归）；
  - 反向（不该进的没进）：`evidence/x/y.p12` 仍被吞（secrets 段不击穿）；`.zcode/.mimosa/node_modules` 仍被吞；**仓根散落 `foo.log` 仍被吞（主断言——全局豁免的唯一鉴别器：node_modules/x.log 由 `node_modules/` 目录规则吞，git 语义下被排除目录内文件不可再纳入，即使 `!*.log` 也翻不动，T-P0-7-d 对该滥用不敏感；foo.log 命中 :27 `*.log`，`!*.log` 会翻它）**。
- **依赖**：无。**规模**：S。**来源**：轨迹4 A11（git check-ignore 实测命中 :27）；BASELINE 未列，本规划亲验吻合；O/R-2026-10-03 R5（思考员3 实测断言权重修正，拍板人按 .gitignore:2/:27 规则来源复核采纳）。

### P0-8 修 arkts-check.js（ESM/CJS + SDK 路径参数化）
- **内容**：`interop/arkts-check.js` 的 `require` 改 ESM import（根 package.json `"type":"module"` 冲突，加载即崩）；硬编码 `/home/dev/sdk/...`（:7）与陈旧默认仓路径 `/mnt/c/Users/Administrator/.zcode/...`（:6，指向已不存在的 workspace）一并改环境变量 `ARKTS_SDK_HOME`，缺 SDK 时输出可读 `SKIP` 与缺失变量名，不崩。
- **文件**：interop/arkts-check.js。
- **验收（O/R-2026-10-03 R10 裁决：两档 + 行为级断言）**：
  - 无 SDK → exit 0 带 SKIP，或明确的非崩溃退出码+可读信息；设假 SDK 路径时报「路径不存在」而非语法崩（第一档）；
  - **第二档：`ARKTS_SDK_HOME` 指向「存在但不是 SDK 目录」的路径 → 报可读错而非崩**（第一档易过，第二档才证明真做了路径校验；现会在 :33 realpathSync 抛错）。断言写在**行为级**（可读错 + 非 ReferenceError/SyntaxError/Cannot find module），**不锁「什么是 SDK 目录」的具体判据**（跨 SDK 版本脆弱；无 SDK 在盘不可实证）。
- **依赖**：无。**规模**：S。**来源**：轨迹4 I-10、轨迹5 §8；BASELINE 缺陷#4（e136900 全仓唯一零实证修复的通道）；O/R-2026-10-03 R10（含思考员4 陈旧默认路径子例）。

## 2.2 P1 —— 真机日效率放大器 + 让「绿」有约束力

### P1-1 KAT 剥离为双 runner 纯函数集（`packages/kat/`）
- **内容**：新增 workspace 包 `packages/kat/`（**依赖 O5——已批（2026-10-03）**；kat 定位=顶层测试消费者非协议包，措辞与「8 包协议核心 + kat 可移植层」钉死口径见 §4.2-O5）：
  - `src/vectors/`：死值向量常量（自 crypto/noise/wireguard/netcheck/derp/common 测试剥离为无依赖 .ts 常量——部分向量现写死在 .test.ts 内，须搬出成独立数据模块）；
  - `src/run.ts`：`runKat(): KatResult[]` 纯函数集合，**零 node: 导入**；
  - Node 外壳 `test/node.test.ts`（node:test 包装，npm script `test:kat`）；真机侧外壳（hypium/裸脚本）只留接口约定不实现。
  - 最小覆盖集（≥60 例起步）：x25519 RFC 7748 全向量+迭代+低阶点全零；ChaCha20-Poly1305 RFC 8439；XChaCha draft A.1；SHA-256/HMAC RFC 4231；BLAKE2s；HKDF RFC 5869 TC3；Noise cacophony msgA/msgB/握手哈希；WG 148B/92B hex 锚；STUN RFC 5769 §2.2/§2.3；DERP Magic 帧；hex/base64/utf8 编码 KAT（编码层最先给「运行时算术/字符串行为正常」信号）。
- **文件**：packages/kat/**（新）、package.json（仅增 `test:kat` script——workspaces `packages/*` 已覆盖新包，**无需改**，O/R-2026-10-03 O5 修正）、scripts。
- **验收**：`npm run test:kat` 全绿；`grep -rn "node:" packages/kat/src` → 0；`npm run validate:arkts` (a) 面对 kat 0 命中。
- **依赖**：O5；P0-3（门收编）。**规模**：L。**来源**：轨迹1 §5/G-A3/F9（49/49 import node: 亲验吻合）。裁决见附录 B-5。

### P1-2 文档口径清零（先清后立门的「清」）
- **内容**：活文档面逐条落地 BASELINE §6 勘误表全部 8 条 + 2 条工具头注释 + yml「五门」注释；另含：
  - README 双表删旧（280/13/54 残留）、:10 规模、:12 用例数、:54 已知问题过期口径；
  - CONTEXT.md 世界观更新（已 git 化有 CI；29→30 时序注记）；
  - DELIVERY_REPORT.md :60 control 规模、:78/:151 oracle/raw 悬空引用（引用处改指「本节即唯一现存记录」+ 标注【实测（二手转述，原始转储未入库，不可复核）】）；
  - TASK.md G0 数字改「≥」断言式现行口径；
  - 新增用例带来的数字联动（30→31→≥36 等）一次性改齐（轨迹3 R2）。
- **文件**：README.md、CONTEXT.md、TASK.md、DELIVERY_REPORT.md、docs/oracle/protocol-notes.md、interop/upload_server.test.mjs 头注、app/tools/validate-shell.mjs 头注、.github/workflows/g0-gates.yml。
- **验收**：A13 grep 0 命中；A16 否定断言清单在活文档面 0 命中。**O/R-2026-10-03（O5/R8 裁决）增补**：①范围加「8包→9包」叙述同步——全部「8 包」落点（实测 8 处：architecture.md:5/:529、TASK.md:10、README.md:10、DELIVERY_REPORT.md:231、handover/owner-with-real-device.md:73、handover/README.md:19、reviewer-pr-style.md:12/:106）改为钉死措辞「8 包协议核心 + packages/kat 可移植层（第 9 workspace 包）」（AGENT-TASK 同措辞，T-HANDOFF-c 正则零改动兼容）；②验收记法：P1-3 建成前记「**暂不判定**」——清零事实以一次性脚本留 worklog 一行（含命令与输出），不装成门（防一次性 grep 自证制造第二次假绿）；**T-A13/T-A16-1 红锚严禁摘除**（UNKNOWN_TEST 纪律），批次四照常翻转。
- **依赖**：P0-1（31 定数）、P1-4（36 定数）、P1-1（kat 建包后叙述同步才可落笔）。**规模**：M。**来源**：BASELINE §6；轨迹3 §6-P1-5/R2、轨迹4 §3.4-c；O/R-2026-10-03 O5/R8。

### P1-3 docs-consistency 升级为阻断式否定断言门
- **内容（O/R-2026-10-03 R6 裁决后口径）**：落地物定为两件：`docs/pre-device/caliber.json`（**无值结构**：口径条目 `{id,cmd,extract,relation}`，relation∈{min,eq}；min 条目必须双字段 `floor`（只增不减）+`current`（现行值）；豁免表入 caliber.json 且每条带非空 reason）+ `scripts/doc-consistency.mjs`（消费器，支持 `--docs-root`/`--root`，R2）；g0-gates.yml docs-consistency job 改调仓内脚本：修 `awk '{print $7}'` 恒空（fail 数参与判据）；S_PASS/S_FAIL/T_FAIL/B_FAIL 全部使用；扫描列表补 HARMONY_AGENT_TASK.md/TASK.md；对旧数字做**否定断言**（280/13/54/238/「六包」/1066 行等任一命中即红）；`warning` → 阻断。**三句硬约束**：①`cmd` 必须是真命令（跑出来取数，`current` 由门写回、不许手填——常量式门=把门改成输出期望值，写成显式断言而非注释）；②扫描面=活文档面 ∪ docs/pre-device/**（并集——现两套可见扫描各漏一半：STALE_PATTERNS 不扫 docs/pre-device，黑名单不含数字规则）；③caliber.json 是批次四落地物，check-stage-docs（批次二）六断言不得要求其存在。
- **文件**：docs/pre-device/caliber.json、scripts/doc-consistency.mjs（新）、.github/workflows/g0-gates.yml。
- **验收**：本地等价脚本对「注入 `280 pass` 的 README 副本」（--docs-root）→ 红；对清零后真文档 → 绿；min 条目 floor/current 双字段与真命令输出一致。**必须在 P1-2 之后启用阻断**。
- **依赖**：P1-2（及 O5 叙述同步先于 eq 条目点亮）。**规模**：M。**来源**：轨迹3 §6-P1-1/2/3、F5/F6/F7；BASELINE 缺口3；附录 B-8；O/R-2026-10-03 R6。

### P1-4 VpnConfig 组装纯函数（桩空数组的第一块真肉）
- **内容**：新增 `app/bridge/src/vpn-config.ts`：`buildVpnConfig(netmap, opts) → {addresses, routes, dnsAddresses, mtu}`，消费 control 包 wgderive 输出；地址语义用 common 常量（CGNAT 100.64.0.0/10、ULA fd7a:115c:a1e0::/48、MagicDNS 100.100.100.100）；一期 routes 取 0.0.0.0/0 兜底（桩注释口径），dnsAddresses 可选项化，mtu 默认 1280 且校验 [576,1500]。加 ≥5 用例：空 netmap / 带 self 地址 / 带子网路由 / DNS 开关 / mtu 越界拒绝。
- **文件**：app/bridge/src/vpn-config.ts、app/bridge/test/vpn-config.test.ts。
- **验收**：`npm run test:bridge` ≥36/0；`npm run typecheck:bridge` exit 0。
- **依赖**：P0-1。**规模**：M。**来源**：轨迹2 §4-P0-3；BASELINE §3.2「TUN 壳层 fd 未接线」中真机前唯一可落地部分。裁决见附录 B-7。

### P1-5 platform 注入层契约 + 回退桩
- **内容**：新增 `app/bridge/src/platform-ports.ts`：
  - `UdpSocketFactoryPort`（bind/send/recv/close + protect(fd) 挂点，以 mock-udp-bus 的 UdpSocket 语义为蓝本）；
  - 真机 TunDevice 适配器 TSDoc 契约（单包同伦、PacketStartOffset=0、worker 线程评估点——fs 同步阻塞会卡扩展进程）；
  - `DeviceClock` 双轴条款：wallMs/monotonicMs 语义保真（引用 C2 笔记「超时判定一律 mono、挂钟只落日志」；**禁止真机 adapter 两轴都用 Date.now**——否则 bestAddr 信任期/重传去抖被用户改时间打穿）；
  - `DeviceRng` 契约 + 「填满 into」断言骨架 + 预取池可选件设计注记（同步 API 透传 / 异步 API 走池，两答案下兼容）；
  - 驱动权条款（controlbase 长轮询 read loop 由谁驱动显式化）；
  - 随机字节留痕钩子约定（D13 复现包的前置）。**O/R-2026-10-03（R4 裁决）**：留痕为**环形缓冲 + 显式 dump**（非全量落盘），buffer 开关由 adapter 参数控制（默认关，D13 需要时开）；快照必须与失败运行**同批**（同一 batch id、同一目录），否则是「某次随机数」而非「那次失败的随机数」；触发点=STAGE-CHECKLIST S5b 步骤（P0-6），钩子与步骤缺一即机制空转。
  FixedClock/ArrayRng 回退桩使 Node 侧可加载验证。
- **文件**：app/bridge/src/platform-ports.ts、app/bridge/test/platform-ports.test.ts（桩加载+填满断言）。
- **验收**：进 typecheck:bridge 面；`npm run test:bridge` 相应用例绿；mock-udp-bus 现有 UdpSocket 声明对齐 port（结构性验证，改动最小）。
- **依赖**：P0-1。**规模**：M。**来源**：轨迹1 §4/R6/G-A4、轨迹2 §4-P1-5。

### P1-6 CU 问答卡五张
- **内容**：`docs/pre-device/CU-CARDS.md`：CU2/5/6/7/8 每项——30 分钟内最小探针写法（源码级）、二值判定标准（如 CU6：`import { x } from '../core/common/src/index.ts'` 编译过=接受）、两种答案各自的下一步分支、答案落点（报告节名）。CU6 是决策树根（定集成方案）。
- **文件**：docs/pre-device/CU-CARDS.md。
- **验收**：每卡有「接受/不接受」二值判定 + 两分支预案无空占位（check-stage-docs.mjs 断言）。
- **依赖**：P1-7（CU6 分支引用工具）。**规模**：S。**来源**：轨迹1 §7/CU 卡、轨迹2 §4-P0-4。

### P1-7 集成三方案工具化 + 判定树
- **内容**：`app/tools/integration-mirror.mjs`：方案 2 生成器（packages/*/src → entry 镜像 + `.ts`→`.ets`/保留双模式 + specifier 改写，参数化）；`--dry-run` 输出文件清单不落盘。README-app §4 三方案各补一行「选定判据」（什么证据出现选哪个）。**明确**：镜像过 tsc 不等于 ets loader 接受（CU6 只能真机首答，任务书必须写明）。
- **文件**：app/tools/integration-mirror.mjs、app/README-app.md。
- **验收**：`node app/tools/integration-mirror.mjs --dry-run` 在当前仓内容上输出清单且不落盘；临时执行模式产物过 P0-3 门后清理。
- **依赖**：P0-3。**规模**：M。**来源**：轨迹2 §3.1（否决预执行、采纳工具化）+§4-P1-6。

### P1-8 interop/*.ts 纳入类型检查（先摸底后纳入）
- **内容**：第一步摸底：`npx tsc --noEmit interop/register.node.ts interop/derp.node.ts interop/h2c.node.ts` 记录错误数入 worklog；第二步按摸底结果修型或加显式例外清单（`// @ts-nocheck` 只允许逐文件登记理由），最终纳入 tsconfig（新增 interop/tsconfig.json 或并入根 include）。
- **文件**：interop/*.ts、tsconfig（新或改）。
- **验收**：A12（listFiles 覆盖 ≥3）+ `npm run typecheck` exit 0；例外清单若非空须逐条有理由注释。
- **依赖**：无（但**排 P1 末尾执行**，避免首批 tsc 错误挤占 P0 预算）。**规模**：M（含未知修复量）。**来源**：轨迹3 §6-P1-7/U5、轨迹4 A3/U8（BASELINE 未列的第五门禁缺口）。裁决见附录 B-9。

### P1-9 headscale 重建包（基线修复 + 设备侧配置）
- **内容**：
  1. **基线面修复**：`interop/headscale.yaml` 绑定 `0.0.0.0` → `127.0.0.1`（:3/:21，对齐 D-plan R1/R5——当前配置违反本项目自己的红线且方向更不安全）；`/home/dev/interop/*` 硬编码路径参数化；新增 `interop/bootstrap-headscale.sh`（生成 noise/derp 私钥、建 sqlite 目录——现无任何 runbook 生成这些文件，缺 key 时 headscale 起不来）；版本 v0.29.4 从注释钉进可执行命令（runbook/compose 显式 tag）。
  2. **设备面新增**（依赖 O3 书面豁免）：`interop/headscale.device.yaml`——`server_url` 改开发机 LAN 地址（占位 + 环境变量注入）、监听边界按 O3 裁定、路径参数化；原 yaml 语义不动。
  3. `interop/env-check.mjs` 环境自检：docker 可达？镜像可拉？端口空闲？`/health` 通？逐项输出 OK/SKIP（非崩溃）。
  4. handover 的 docker 命令补 DERP/STUN 端口映射（3478 等——现有命令未映射，轨迹5 §3-S7 实读确认）。
- **文件**：interop/headscale.yaml、interop/headscale.device.yaml（新）、interop/bootstrap-headscale.sh（新）、interop/env-check.mjs（新）、docs/handover/agent-interop-regression.md。
- **验收**：`grep -c "0.0.0.0" interop/headscale.yaml` = 0；device.yaml 存在且 server_url 非 127.0.0.1；`node interop/env-check.mjs` 无 docker 时逐项 SKIP、exit 0；版本号出现在至少一条可执行命令中。
- **依赖**：O3。**规模**：M。**来源**：轨迹4 §3.5 步 0–5/A9/A10、轨迹5 §1.3/D3。

### P1-10 上游 provenance manifest + 行号对拍门 + 欠账登记
- **内容**：
  - `docs/upstream/manifest.json`：每份快照 `{path, source_url, fetched_at, upstream_commit|null, note}`——**缺 SHA 显式 null 注明原因，不许空不许编**（ts-main 现无任何 provenance）；
  - `scripts/upstream-lineref.mjs` 行号对拍：从 architecture.md §10.2 与 research 笔记抽 `file.go:LNNN` 引用，断言目标行存在且含声称符号（AU1–AU3 三处抽验已全中，可机检），入 gates；
  - `docs/upstream/UNRESOLVED.md`：登记 58 份未归档 .go（路径+被哪份笔记引用+影响哪条 AU）——不补文件只登记欠账（无网补不了，凭笔记反推=伪造）；
  - `interop/upstream-diff.mjs`：输入 manifest 的 commit，输出 diff 影响面；`--dry-run` 无网可验（写脚本无网，写结果需网）。
- **文件**：docs/upstream/manifest.json、UNRESOLVED.md（新）、scripts/upstream-lineref.mjs、interop/upstream-diff.mjs（新）。
- **验收**：manifest 覆盖 docs/upstream 全部快照；行号对拍对 AU1–AU3 全绿；UNRESOLVED 覆盖 58 份；`node interop/upstream-diff.mjs --dry-run` exit 0。
- **依赖**：无。**规模**：M。**来源**：轨迹4 §3.6/A5/A6；BASELINE §7「快照与真上游 diff 无人做过」。

### P1-11 证据链规范 + 校验器
- **内容**：`docs/pre-device/EVIDENCE-SPEC.md` 六条：
  - E1 死值锚定：每条「实测发现」必须有独立副本常量+逐字节断言（范例 packages/derp/test/client.test.ts:37/:273-277 的 MeshKey 处理）；禁止只在注释写「实测发现」；
  - E2 来源可追：协议语义断言指向 docs/upstream/ 的 file:line 或 evidence/<批次>/ 具体文件；
  - E3 结论分级：复用 BASELINE §0 五级口径，勿另立标准；
  - E4 环境指纹：headscale 版本 tag+digest、node 版本、脚本 git sha、运行时间戳；
  - E5 敏感边界：私钥/凭据/内网域名不入仓，只留公钥前缀+哈希；
  - E6 可重跑性：做不到的标 `ran=false` 诚实降级。
  配 `interop/evidence-manifest.mjs` 校验器（对缺 reason / 缺 marker / 缺环境指纹三类分别报错）。
- **文件**：docs/pre-device/EVIDENCE-SPEC.md、interop/evidence-manifest.mjs（新）。
- **验收**：校验器对三类缺陷样本分别报错；对合法样本 exit 0。
- **依赖**：P0-5（marker/reason 定义）。**规模**：M。**来源**：轨迹4 §3.7/A8。

### P1-12 OWNER-GUIDE + env-ready schema
- **内容**：`docs/pre-device/OWNER-GUIDE.md`（第 4 节骨架落地：0.x 一次性资产清单+每阶段三栏+拍板点+回报样例+出事怎么办；写作纪律：祈使句+可勾选、不写 FAQ、不写「详见某文档」）；「填 env-ready」列为 **S4 末一次性动作**（防摩擦挤压 S5 窗口）；每阶段「怎么拿 evidence 原文」给一条可复制命令。`docs/pre-device/env-ready.schema.json`（S4/S5 前人类逐条确认的环境就绪文件 schema：SN 可见、签名方式已选、VPN 授权预期、headscale LAN 地址、preauthkey 已备、第二 peer 已定）。
- **O/R-2026-10-03（R11 裁决）**：①每项为**「值+证据+时间戳」三元组**（非裸 bool）；`evidence` 允许「同目录文件路径 + 一行摘要」二选一（防长输出致空填）；`at` 用 ISO8601 带时区；schema 外多出的键也必须带 evidence；②schema 为键清单形态 `{key:{type,enum?,pattern?,why}}`，校验器读同一 schema 驱动（无 ajv 且禁装依赖），`why` 必须出现在报错文案中；③**新增两键**：`s6.headscale_waiver_id`（引 DECISIONS O3 豁免令编号 HS-DEV-001 签署态）与 `s6.host_pseudonym`（O7 主机化名，**不是**别名/IP 真值——红线豁免与主机身份进三向对齐）；④三向对齐（OWNER-GUIDE 判据栏 ↔ schema 键 ↔ 剧本引用点字面一致）；⑤诚实边界「防漏填不防填假」写进 OWNER-GUIDE，真机前桌面演练一轮测空填率。
- **文件**：docs/pre-device/OWNER-GUIDE.md、env-ready.schema.json（新）。
- **验收**：OWNER-GUIDE S0–S8 每阶段三栏无空（脚本断言每阶段标题下三个小节齐备）；schema 为可加载 JSON 且含两新键；O3/O4/O5 签署态有对应确认字段。
- **依赖**：P0-6、P1-9。**规模**：M。**来源**：轨迹5 §4/A10/A11；O/R-2026-10-03 R11（含 O3/O7 联动两键）。

### P1-13 perf 四件套 ArkTS 源码 + Node 参照基线
- **内容**：四份源码入仓：`perf-x25519-arkts`（perf-baseline.mjs 同测法：200 iter/20 warmup/sink 防 DCE/JSON 输出同构）、`perf-aead-throughput`（1MB chacha20-poly1305 wall time）、`perf-hash`（BLAKE2s/SHA-256 各 1MB）、`perf-handshake-e2e`（一次 WG initiator 握手 wall time）；**Node 侧同口径补测** aead/hash 吞吐与握手总耗时作参照系（当前只有 x25519 单点，数据面吞吐在 Node 都没测过）。
- **O/R-2026-10-03（O6/R13 裁决）增补**：
  - **方法学字段（O6 已裁，立即生效）**：每条 perf 记录必带 `{iter=200, warmup=20, sink 防 DCE, 3 次取中位（附原始数）, 机型, API 版本, 充电状态/温度}`；数值阈值一律不设（门只看格式不看值，D12 记录制；阈值=S5b 数据后 owner 裁）。
  - **perf 源码可执行副本（思考员5 V7 实测约束）**：`app/tools/perf/` 不在任何模块 srcPath 内（build-profile modules 仅 entry），其中的 .ets **不进 HAP、真机跑不了**——必须另落可执行副本于 `app/entry/src/main/ets/`（自测入口，与 O5 真机外壳同路线）或 ohosTest；仓内 `app/tools/perf/` 定位为**源码母本**（评审面），此句写进 P0-6 交接物说明，否则真机 agent 在 S5b 发现「文件在但跑不了」。
  - **豁免纪律（R13）**：perf 目录在 D4/P4 扫描面之外是**面声明的事实**（非豁免）；仅当检索面扩至 app/tools 时启用规则级 EXEMPTIONS（见 P0-4）。
- **文件**：app/tools/perf/（母本）+ app/entry/src/main/ets/ 下可执行副本（新）；scripts/perf-baseline.mjs 不动。
- **验收**：Node 参照数字实测入 worklog/README（方法学字段齐）；ArkTS 源码过 `npm run validate:arkts`；可执行副本在 entry 模块 srcPath 内（真机可跑的唯一形态）。
- **依赖**：P0-3。**规模**：M。**来源**：轨迹1 §6/§10-3；BASELINE §3.4；O/R-2026-10-03 O6/R13。

### P1-14 `npm run gates` 聚合入口
- **内容**：聚合 A1–A9 + 文档门本地等价为一条命令（scripts/gates.mjs）；真机 agent Day1 与本规划 A 类验收共用同一判据。
- **文件**：scripts/gates.mjs、package.json。
- **验收**：`npm run gates` exit 0 ⇔ 各分门全绿；人为弄红任一分门 → 聚合红。
- **依赖**：全部门存在（最后做）。**规模**：S。**来源**：轨迹3 §5-B。

## 2.3 P2 —— 本机可做、不阻塞真机（防误读/扩面）

| ID | 内容 | 文件 | 验收 | 规模 | 来源 |
|---|---|---|---|---|---|
| P2-1 | upload_server 实证从 importlib 直调扩为真 HTTP server 层（起真 server + 重放攻击向量）。**O/R-2026-10-03（R12 裁决）验收细化**：原 8+7 条向量**逐条**仍绿（非只看总数）+ 注入 `..%2f`/`%2E%2E` 大小写混写/`..\`/超长/NUL 变体必红（变异取样优先大小写变体——现 8 条覆盖最弱的一类）+ Python 视角 inbox **字节级**只含合法文件、不看返回码（注：字节级判定 upload_server.test.mjs:187 已存在，本项据实收窄为「逐条 + 条数钉 8/7 + 注入必红」三件） | interop/upload_server.test.mjs | 新增集成层全过且原 8+7 逐条不回归 | M | BASELINE §2.7 注；轨迹3 §6-P2；O/R-2026-10-03 R12 |
| P2-2 | 冗余快照去重：headscale-noise.go 与 -full.go sha256 相同，保留一份，manifest 记哈希 | docs/upstream/ | manifest 记录该 sha256；删除后活文档面无悬空引用 | S | 轨迹4 A7 |
| P2-3 | 权限/签名/bundleName 一页事实卡（两权限 normal/system_grant 依据、VPN 授权走系统弹窗不走权限系统、未签名 HAP 可构建、bundleName 双处同步） | docs/pre-device/FACTS-APP.md | agent 可单页引用；与 README-app §3 无矛盾 | S | 轨迹2 §4-P2-8 |

## 2.4 依赖与顺序

```
P0-1 ─┬─► P1-4 ─► P1-2(数字联动+O5 叙述同步) ─► P1-3(门阻断) ─► P1-14
P0-2 ─► P0-3 ─┬─► P1-7 ─► P1-6(CU6 分支)
              ├─► P1-13(O6 方法学/perf 可执行副本)
              └─► P1-1(kat 过门)
P0-4 ─► (CI 绿基线) ─► O1(owner 确认远端,人类项)
P0-5(O2 已裁补 CLI;R3 --out 为批次二阻塞判据) ─► O4 落包(D2 执行,批次三/四;h2c.node.ts 变薄壳)
P0-6 ←─ P0-1/P0-3/P0-4/P0-5(数字定稿) ; P0-6 ─► P1-12
P0-7、P0-8 独立
P1-9 ←─ O3(签署生效,人类项) ; P1-1 ←─ O5(已批) ; P1-8 排 P1 末(先摸底)
O7-a 已闭合(2026-10-03 实测) ; O7-b/c(owner) ─► S2 真跑/S6
```

**O/R-2026-10-03 注**：依赖图新增两条硬边——①O2↔O4：O2 的 CLI 薄壳落 interop/h2c.node.ts，O4 落包后该文件变薄壳（import packages/control/src/h2c.ts），两项必须一致执行，禁「删阶段且落包」组合（h2c 将无任何 CLI 载体，D-1 双重改动）；②O5→P1-2：kat 建包先于「8包→9包」叙述落笔，否则 P1-3 eq 条目上线即红。

## 2.5 执行批次建议（给后续执行 agent 的排期参考）

- **批次一（止血）**：P0-1、P0-2、P0-4（含 R9 扩面与 R2 --root）、P0-7、P0-8（含 R10 两档）——除 P0-4 外互不依赖；收口判据=A3 转绿 + A7 门在（检索面含 app/bridge/src）+ A14 通过 + arkts-check 两档不崩。
- **批次二（立门）**：P0-3、P0-5（**R3 升格阻塞项：收口判据含 T-P0-5-d/--out 翻转**）、P0-6（含 R4 快照步骤、R7 check-decision-trees、O6 停并升人指令）——依赖批次一的 P0-2；收口判据=A6/A8/A11 三门绿 + selftest 红→绿轨迹入 worklog。
- **批次三（赋义）**：P1-4、P1-5、P1-7、P1-9（**前置：O3 owner 签署**）、P1-10、P1-11（R3 五件套校验器）、P1-13——真机效率放大器；收口判据=对应各项验收门。
- **批次四（收口）**：P1-1（O5 已批）、P1-2（含 O5 叙述同步；R8 暂不判定）、P1-3、P1-6、P1-12（R11 两键）、P1-8（末位）、P1-14、P2-*——文档清零→门阻断→聚合门，最后全量跑 A1–A17；**O4 落包执行挂本批或批次三末（D2）**。
- 每批收口跑 `npm run gates`（批次四前以分门代替）；worklog append-only 记录每批数字。

# 3. 真机 agent 交接契约

## 3.1 它拿到什么

1. **仓库**（A 类全绿态）：8 包协议核心 + packages/kat 可移植层（第 9 workspace 包，O5 已批）+ packages/control/src/h2c.ts（O4 已批，类本体，零 process/console 面）+ app/（含 platform-ports / vpn-config / integration-mirror / perf 源码母本 **及其 entry 内可执行副本**）+ interop/（修好的 regress / h2c CLI 薄壳 / arkts-check / headscale 双 yaml / env-check / upstream-diff）+ docs/pre-device/ 交接包。
2. **任务书重写版**：docs/pre-device/AGENT-TASK.md（含反模式清单与 D1 结论首章）。
3. **探针包**：CU-CARDS.md 五张（CU6 为根）、S3.0 最小探针工程素材（空工程 HAP + `.ts` import 探针源码与判定标准）、perf 四件套源码、KAT 真机外壳接口约定、STAGE-CHECKLIST.md（S0–S8 全命令带标签）。
4. **决策预埋**：DECISIONS.md（D1–D13 已裁 + O1–O7 签署态）。
5. **人类侧**：OWNER-GUIDE.md + env-ready 机制（人类将在 S4 末逐条确认）。

## 3.2 任务序列（S0–S8；S3.0 为最小探针，S5b 为真机 KAT/perf 首测）

- **S0 环境与基线（AH）**
  - 人提供：账号 / DevEco / SDK / 真机开发者模式 + USB 信任（判据：`hdc list targets` 见 SN）。
  - agent 做：在**有工具链的机器**复跑 `npm run gates`。
  - 通过标准：全绿。失败处置：不全绿即停并回报，不往下走（`npm test <495` 先查是否 clone 到旧版）。
- **S1 剧本自检（A）**
  - `node scripts/check-stage-docs.mjs` 绿；通读 AGENT-TASK/DECISIONS；核对仓库 HEAD 与规划基准无未解释漂移。
- **S2 协议自检（A/Node 侧对照）**
  - `npm run interop:regress -- --selftest` 绿（红=脚本没修好，**不许上机**）；
  - 若 headscale 主机已备：跑通 Node 侧 regress 三阶段取得三条 PASS——这是 S6 失败时区分「协议栈 vs 手机网络」的对照基线；
  - 用 SDK 复扫官方 ArkTS linter（补 disco/netcheck 盲区）+ `node interop/arkts-check.js`（带 `ARKTS_SDK_HOME`）。
- **S3.0 最小探针（AH，人 5 分钟 + agent 15 分钟）**
  - DevEco 新建空工程编单 `Index.ets` HAP；加第二模块只做 `import { x } from './y.ts'`。
  - **在最小面上首答 CU6 与 SDK 版本问题**，按 D4 判定树选集成方案；探针失败先二分（SDK 版本 vs loader 拒绝），不在 37 文件壳上试错。
- **S3 首编译（AH）**
  - 按判定树接入核心库 → 编 unsigned HAP → 按 AGENT-TASK 报错处置树逐项消错（`@kit.*` 路径、`type:vpn` 识别、compatibleSdkVersion）。
  - **预期报错，不视为失败**（报错面不在仓库里，任何「零报错」承诺不可信）；`type:vpn` 不识别需改 SDK 安装目录 → 升级人类。
  - 通过标准：产出 `app/entry/build/*/outputs/*/*.hap`；S3.0 已给出 CU6 明确 yes/no。
- **S4 签名与安装（H+A）**
  - 人决定签名方式（D6：自动签名优先/p12 退路）；agent 出 `hdc install` 与拉起命令。
  - 人类填写 env-ready.json 全绿后才进 S5（把「是否问过人」变成可判定 IO）。
- **S5 冷启动冒烟（AH）**
  - 人点「连接」并在系统弹窗点「同意」VPN 授权——**弹窗出现即本阶段成功**；fd 后续失败是预期（数据面未接线）。
  - agent 抓 hilog（`OhosTsIndex` / `OhosTsVpnExt` tag）；`create(config)` 报 2203002 → 设备已有别的 VPN，人去关。
- **S5b KAT + perf 首测（A）**
  - 真机跑 KAT runner（`runKat()` 外壳，entry 内自测入口优先——O5 已裁）——**「协议核心在 ArkTS 运行时与向量一致」的第一个证明**（495 例对真机证明力为零的补全：KAT 在 Node 绿 → 同一 KAT 在真机绿 → 才能说一致）。
  - perf 四件套按记录制跑（先记录后判定；软参考 x25519 ≤25 ms/op）。
  - **O/R-2026-10-03（R4/O6 裁决）**：①跑前先开随机字节快照环形缓冲，跑后 dump 并 `hdc file recv` 回传至 `evidence/interop-<date>/rng-snapshot/`（D13 复现包数据源，与本次运行同批）；②perf 三档：≤25 记录不设门继续；25–50 记录不阻塞但须同时给 perf-handshake-e2e 握手总耗时；**>50 ms/op 停止 S5b、回报 owner 触发 O6（不自动换库，不往下走）**——该指令同时写在 STAGE-CHECKLIST 与判定树（perf 触发树），不扩 D10 编号。
- **S6 控制面注册（AH，全剧本最难）**
  - 用 headscale.device.yaml 环境 + 一次性 preauthkey；走 **D1 路径 A**（tailcfg + controlbase + h2c）。
  - 失败处置树**按序**：①查 D1 路径（不是改协议代码）→ ②查 D3 配置（127.0.0.1 陷阱）→ ③查 key（401/403 → 人重签）→ ④抓包（网络/代理/AP 隔离）。
  - 通过标准：`headscale nodes list` 出现 `ohos-interop-<device>`；设备侧收到首个 MapResponse 与 100.64.0.0/10 内地址。
- **S7 DERP（AH）**
  - 判据：ServerKey→ClientInfo→ServerInfo + Ping/Pong 往返；STUN 全败可退化为直连继续，**非致命**（netcheck 有 OnlySTUN/UDP 全败回退）。
- **S8 端到端数据面（AH，验收终点）**
  - 三层逐级：①控制面证据（netmap peer 非空）→ ②链路证据（对端 RecvPacket 收到本端载荷）→ ③业务证据（手机侧对 100.64.x.y 或 MagicDNS 发真实 IP 包收回 echo）。
  - ②过③不过属 PacketFilter/路由二期，不算本剧本失败（BASELINE §3.3 明列不存在项）。
- **回退路径（剧本倒序）**：S8 败→退 S7 层级（09-29 已有先例）；S6 败→退 S2（Node 侧同栈复跑二分归因）；S5 败→退 S3；S3 败→退 S3.0。**总回退=退回 Node 全绿 + 只交付交接物，真机线继续冻结——这是可接受终局，不是失败**（轨迹5 §7 定性）。

## 3.3 决策边界与禁则（不许真机 agent 改的）

- **冻结面**：`packages/` 八包与 kat 的既有导出一律不改（新问题 → 回报，走 architecture §10.3 流程由 owner 决）；mock 文件不删（回归资产，D8）。
- **纪律面**：D4/P4 边界不变——真机上网络 API 只允许出现在 `app/entry/src/main/ets/platform/`（platform/ 之外不得出现 `@ohos.net.*`/cryptoFramework 导入）。**O/R-2026-10-03（O4）新增**：`packages/*/src` 内零 `process.`/`console.`/`globalThis`（CLI/宿主符号只允许在 interop/ 与 app 侧；gate-d4-p4.mjs 第四段断言在岗）——tsc 在 `types:["node"]` 下拦不住 process，只有真机才炸。
- **契约面**：验收契约（TASK.md D-1、G0 数字、marker 字符串）不改；`interop/headscale.yaml` 基线不动（设备侧只用 headscale.device.yaml，边界以 O3 豁免文本为准）。
- **行为禁则**：不硬改测试凑绿；不碰生产 tailnet；不凭记忆写平台 API/协议语义（查 SDK .d.ts / docs/upstream/，查不到就停）；错误处理只认 code 不解析 message；authKey/preauthkey 不进 want.parameters/日志/evidence；同一错误连续 2 次无进展 → 升级人类（D10）。
- **升人触发（六条，写死）**：①需改 SDK 安装目录；②需华为账号/证书/设备解锁；③需动 D3 红线边界；④需改 8 包导出；⑤连续 2 次无进展；⑥任何 BundleName/签名变更。

## 3.4 回报格式与证据规范

- 每阶段一份回报，固定字段：阶段号 | 通过/未通过 | 判据原文 | 命令与**完整原始输出** | hilog 片段 | 截图/界面文本 | 触碰的决策点 | 新发现的分叉 | 遗留项。**贴原始输出而非结论**（防绿灯幻觉）。
- 总报告 `HARMONY_PC_REPORT.md` 固定六节：环境判定逐项 / 构建成败+git diff 清单+每修理由 / CU 六项二值答案（附探针文件与输出原文）/ 冒烟证据 / 门禁自跑数字 / 遗留清单。
- 证据目录结构（P0-7 保证可入仓；**O/R-2026-10-03 R3 五件套闭环**：`--out` 落盘 + 同批三件 + 同批校验 + E4 入 summary + E5 主机化名）：
  - `evidence/interop-<date>/README.md`（环境/时间/执行者 sha/三条 PASS 字符串位置）
  - `evidence/interop-<date>/regress.log`（stdout+stderr 合并原文）、`summary.json`（结构化原件：含每阶段 `{status,exitCode,durationMs,reason,markerSeen}`、`runId`/`startedAt` 批次标识与 E4 四元组）、`state.sha256`（可执行命令产出——现 runbook 该条在仓根 exit 1 属死命令，P0-5 改写）
  - 同批校验（P1-11 校验器）：summary 的 `runId`/`startedAt` 与 regress.log 首行 batch id 一致，目录内不得出现跨批文件
  - 环境指纹四元组必附（E4）；主机一律用化名（如 `interop-host-A`），真实 IP/别名不得复制进 evidence 与 OWNER-GUIDE（E5）
  - 协议层被真实对端拒（PROTOCOL_REJECT）→ **严禁改脚本/代码凑 PASS，停下回报**（违反即作废本批全部证据）
  - 涉及 evidence/ 的真机侧文件经 `hdc file recv` 回传，回报须含目标路径与 sha256（R4/O7 联动）
- 失败复现包（D13）：触发参数 hex + 最近随机字节快照 + 时钟轴快照 → 回 Node 用 FixedClock/ArrayRng 重放。
- CU 答案与门禁复跑数字 append-only 记入 worklog.md。

# 4. 人类配合说明书（骨架；落地文件 OWNER-GUIDE.md，P1-12）

## 4.1 分阶段配合表

| 阶段 | 人类提供什么 | 人类决定什么 | 如何确认完成 |
|---|---|---|---|
| 环境（S0 前） | 华为开发者账号（实名+签名权限，坑：子账号可能无签名权限）；DevEco Studio 6.x 完整安装（含 commandline-tools/ets/native/toolchains，坑：缺组件构建时炸）；HarmonyOS SDK API 12+；真机开开发者模式+USB 调试授权+信任此电脑 | 是否解冻子线 E；DevEco vs commandline-tools 路线（出网可达性是 build-feasibility 卡点 B 的 owner 裁定） | `hdc list targets` 见 SN；DevEco 打开无红叉 |
| 编译（S3） | 鼠标操作 DevEco、首次 SDK 同步点「是」；S3.0 探针的 5 分钟配合 | `type:vpn` 不被识别时**是否手改 SDK 安装目录** modulecheck/module.json | 产出 `app/entry/build/*/outputs/*/*.hap`；S3.0 给出 CU6 明确 yes/no |
| 签名（S4） | 登录账号自动签名，或提供 p12/csr | 自动签名 vs p12 手动 vs 仅未签名（未签名只够 S3 验证） | 签名配置生成且 HAP 重签成功 |
| 安装（S4） | 信任此电脑、允许安装 | （无） | `hdc install` exit 0；应用可拉起 |
| 注册（S6） | headscale 主机 LAN 可达地址（同一网段，警惕 AP/客户端隔离静默阻断）；一次性 preauthkey（用后即弃）；3478/8080 端口对手机可达 | **红线豁免 O3**（server_url 指 LAN）；preauthkey 签发授权 | `headscale nodes list` 出新节点；设备收到 MapResponse |
| 数据面（S8） | 第二个 peer 节点（D7：手机↔Node 侧节点） | 验收层级（三层逐级，接受到第几层） | 对端 RecvPacket / echo 返回 |

## 4.2 拍板点决策记录（2026-10-03 代拍；O1–O7 + R1–R13 共 20 项）

**总则**：owner 于 2026-10-03 授权拍板人（GLM53）对 O1–O7 与 TESTS §0.3 R1–R13 代 owner 做出决策（授权来源下文各条不再重复注明，均为此授权）。输入=五份决策思考轨迹（thinking-decision-glm53flash-1/2、thinking-decision-minimax-1/2/3，下称「思考员1–5」）。每项六要素：决定/依据/授权来源（统一如上）/生效条件/owner 追认位/重审触发。**人类闭合项**（O1 远端观测、O3 正式签发、O6 数值、O7-b/c）拍的是处理框架（保守推定/授权模板/降级链），不是事实本身。拍板人对思考员实测新事实做了本地可做的抽验（h2c TextEncoder 计数、marker 子串串台、T-P0-7-d 规则来源、mock-localapi.ts:229 裸 node: 字面量、P0-3 禁则集对 h2c 0 命中——五项全部吻合）；远端 ssh 事实采信思考员4 会话实测记录（C7/C8）并标注来源，拍板人未复连远端。

### O1 远端 GitHub Actions 状态确认 ——【人类闭合项：处理框架】

- **决定**：采保守推定三句口径并立即生效；定性闭合仍须 owner 观测远端 Actions（物理上必须人类：本机无 gh 无网，思考员3 亲跑 `gh: command not found`；五方一致）。预埋三态回报格式把 owner 成本压到一分钟。
- **推定口径（三句，替代原单句「一直红」）**：①G0 job 的 D4 机检 step 自 51b70c3 起每次运行恒红（`set -eu` 下 yml:83 语法错 → exit 2）；②P4 与 node: 两段在语法错前**照跑且 0 命中**（bash 逐条解析——思考员4 C10、思考员5 V2 独立实测）；③D4 段本身从未执行。推论：整 job 自 51b70c3 从未绿过（本地推定）。
- **三态回报格式（预埋进 OWNER-GUIDE）**：owner 打开仓库 Actions 页，回报三选一原文——红（附 51b70c3 之后 run 列表首屏）/绿/从未运行；并须同时确认「P0-4 修复后的 step 在远端为绿」（思考员4 补充条款，否则「CI 绿基线」是空头承诺）。
- **生效条件**：推定口径立即（§6-R3 已按此改写）；闭合=P0-4 合入后 owner 动作（排序约束维持：先让它绿，再去看它绿没绿）。
- **owner 追认位**：＿＿＿＿（三态回报原文）＿＿＿ 建议期限：P0-4 合入后 3 个工作日内。
- **重审触发**：owner 回报与推定不符；尤其「从未运行」→ 触发 yml 触发器/push 权限排查（升级为新 P0 级事项）。

### O2 regress 阶段 3 处置 ——【已代拍：履约不改约】

- **决定**：补 h2c CLI、保留阶段 3、TASK.md D-1 契约一字不动；marker 判据必须**行锚**（`/^INTEROP PASS/m`、`/^DERP INTEROP PASS/m`、`/^H2C PASS/m`，三 marker 互不为子串）；CLI 薄壳留 interop/（与 O4 联动）。
- **依据**：D-1 原文「register/h2c/derp 全部 exit 0」（TASK.md:54，五方亲验）——补 CLI 是履约，删阶段是改约（须 owner 追认，思考员3 权限层论证保留为记录：履约/改约判定表见其 §7.3）；**marker 子串串台**（思考员4 实测 `'DERP INTEROP PASS'.includes('INTEROP PASS')===true`，拍板人本地复验为 true）——includes 判据会让 derp 输出伪造 register 阶段 PASS，行锚是唯一零依赖防线；测试面不对称（补 CLI→T-P0-5-c 按期翻转、selftest/D-1/矩阵零改动；删阶段→七处连锁改写+规格变更+T-P0-5-c 死锁致 A17 终态不可达——思考员2 论证）；风险时刻错位（删阶段把 h2c 首个独立验证从 Node 便宜环境推迟到真机最贵时刻——思考员1）。五方全部倾向补 CLI。
- **生效条件**：立即（P0-5 子项 2 已按此改写）。
- **owner 追认位**：＿＿＿＿ 建议期限：真机窗口开启前（非阻塞——履约性决策，默认按本条执行）。
- **重审触发**：P0-5 执行中 CLI 被迫引入 packages/ 改动或规模超 M；O4 落包使 CLI 依赖面变化。

### O3 headscale.device.yaml 红线豁免 ——【人类闭合项：豁免令已代拟，签署生效】

- **决定**：代拍起草「限域书面豁免令」（编号 **HS-DEV-001**，仅此一件有效），四要素齐备；正式签发属 owner——未签前 P1-9 第 2 子项判「阻塞」非「红」（默认不动约的那一边）。
- **豁免令要素（落地文本随 DECISIONS.md 模板）**：
  1. **授权人**：owner 签署栏（追认位见下）。
  2. **范围**：仅 `interop/headscale.device.yaml`、仅本任务设备联调；基线 `interop/headscale.yaml` 不豁免。
  3. **监听边界（字段白名单）**：`server_url`（开发机 LAN 地址）、`listen_addr`、`derp.server.stun_listen_addr` 三字段仅限「开发机所在 LAN」——**必须含 STUN/DERP 端口（3478 等），漏掉则 S7 判据物理断线**（思考员1：写窄的最坏形态是真机 agent 误诊改代码）；`metrics_listen_addr`/`grpc_listen_addr` 仍 127.0.0.1；绑定形态默认「绑开发机 LAN IP」，0.0.0.0 仅 LAN IP 动态分配时允许且须回报记录；device.yaml 落地时加「非 0.0.0.0」负断言（思考员2 发现的可见面 gap，登记 expected.json）。
  4. **失效条件**：自签署起至 S8 验收完成/任务关闭/真机线冻结即自动失效；撤销条件任一即失效（出现 0.0.0.0/:: 绑定、容器未 --rm、preauthkey 入 evidence/日志）。
  - **负面清单（不豁免、继续全文有效）**：R2 不碰生产 tailnet、R3/R4 凭据/私钥不入仓、R6 ssh 只读运维、**禁 --network host 不豁免**（用 `-p <LAN-IP>:8080:8080` 定向发布达成 LAN 可达）、preauthkey 用后即弃。
  - **基线不变式**：interop/headscale.yaml :3/:21 修回 127.0.0.1 与豁免同批（先归位再谈例外，例外才成例外——思考员1/3 同判；基线现值 0.0.0.0×2 本就违红线，P1-9-1 是红线归位不是豁免）。
- **依据**：红线原文（docs/research/2026-10-02-D-interop-plan-public.md §2 R1/R5；agent-interop-regression.md:54-62——思考员1/3 各自独立重建条文）；T-P1-9a/b 分文件反向断言已按「豁免只给设备侧」形状写好；五方收敛「四要素+负面清单+有效期缺一不可，先例漏洞的封口在失效条件不在拒绝豁免」。
- **生效条件**：豁免令文本立即起草（随 P0-6 DECISIONS.md 交付）；**生效=owner 签署**（批次三 P1-9-2 动工前）。
- **owner 追认位**：＿＿＿＿（签署/否决/改判）＿＿＿ 建议期限：批次三动工前；不签则 P1-9-2 阻塞、S6 顺延，不单方面放宽。
- **重审触发**：联调需开 metrics/grpc、跨网段、设备侧拟超出任一层限定；dev-env 变更。

### O4 H2OverNoise 落包位置 ——【已代拍：落 control 包 + 三条执行约束】

- **决定**：H2OverNoise 类本体落 `packages/control/src/h2c.ts`（走 architecture §10.3 版本记录条目 + §10.2 增 AU 行——**引用勘误：§10.3 实为版本记录非「只增流程」，v1.0 D2/O4 表述据此修正**）；CLI 薄壳留 interop/；barrel **默认不加导出**（interop 走深路径 import，导出面 396 不变、holdout h09 不动；若 CU6 后集成方案需要经 barrel 取用，仅追加具名导出并随版本记录）。
- **三条执行约束（v1.0 低估落包成本的补账，全部为落地验收项）**：
  1. TextEncoder/TextDecoder 5 处 → 改用 common 的 utf8（packages/common/src/index.ts:9 export utf8）；**落地验收第一步先验证 common utf8 满足 h2c 的解码用法**（思考员1 自陈未试跑流式语义）——不可行则降级为保留 interop 不落包并回本项重审。
  2. `:218 Array<[string, string]>` tuple → interface（architecture §9.4 规则 4 无 tuple）。
  3. noisehttp.ts（HTTP/1.1 over Noise 头注）与 h2c（纯 HTTP/2、无回退）语义矛盾 → **仅在版本记录注记，不改既有导出**（缺证据：headscale 响应帧格式实物，本机无 headscale 不可对拍；09-29 互通实际走 h2.post，AU1/h2c 更可信——顺修=碰冻结面，禁止）。
  - **防护条款**：包文件零 `process.`/`console.`/`globalThis`（gate-d4-p4.mjs 第四段断言，P0-4 联动——tsc 在 `types:["node"]` 下拦不住 process，ArkTS 运行时无此全局，是「本机门全绿、真机首日崩」的定时炸弹——思考员5 V8）。
- **依据**：思考员1 亲验 h2c.node.ts 有 5 处 TextEncoder/Decoder 与 1 处 tuple、**P0-3 计划禁则集对它 0 命中**（拍板人本地复验三项全部吻合——即两条架构违规「落包后现有门禁全绿」，正是「当时绿、事后腐化」实例，故约束必须写死为验收项而非依赖门）；h2c 零 node: 导入、仅 type-import（五方亲验）；h09 frozen-exports 已预留 O4 授权域；control→noise 依赖边已存在不加新边（思考员5 V6）；五方全部倾向 control 包。
- **生效条件**：决策立即；执行挂 D2（批次三末/批次四，与 P1-8 摸底同批；register.node.ts:36 / derp.node.ts:27 两行 import 同步改写）。
- **owner 追认位**：＿＿＿＿ 建议期限：执行动工前（触及冻结面边缘，h09 ⊇ 断言兼容但留痕）。
- **重审触发**：改造验证不可行；validate:arkts (a) 面判红且改写超 M；CU6 判定树出结果（镜像集成下 h2c.ts 自动进 .ets 镜像面）；真机首答 TextEncoder/TextDecoder 不可用（处置=退回 interop/，不改门）。

### O5 新增 packages/kat/（第 9 workspace 包）——【已代拍：批准 + 口径钉死】

- **决定**：批准 packages/kat 第 9 workspace 包；**措辞钉死「8 包协议核心 + packages/kat 可移植层（第 9 workspace 包）」**（T-HANDOFF-c 的 `/8\s*包/` 正则零改动兼容——AGENT-TASK 只写「9 包」会卡死批次二）；强制同步改全部「8 包」叙述（实测 8 处落点：architecture.md:5/:529、TASK.md:10、README.md:10、DELIVERY_REPORT.md:231、handover/owner-with-real-device.md:73、handover/README.md:19、reviewer-pr-style.md:12/:106——属 P1-2 文档清零范围，architecture 版本记录在 kat 建包时同批）；kat 定位=**顶层测试消费者，非协议包**（minimax-3，写入版本记录定位句）；holdout frozen-exports 联动（kat 导出自建成时点冻结、只增不减）。
- **依据**：冻结的可机检内核=导出名集合只增不减（frozen-exports ⊇ 断言，包计数不出现在断言中——思考员3）；B 案（塞 common/src/kat）造 common 反向依赖它所测的包，触 D2「common 不得 import 任何包」（思考员3/5）；思考员1 亲验四个自动收编面（根 package.json workspaces `packages/*` 已覆盖新包、npm test glob、tsconfig include、validate:arkts (a) 面）——边际成本≈0，**P1-1「改根 package.json workspaces」一句修正为「无需改，仅增 test:kat script」**；npm test glob 双跑口径（kat 测试文件落 packages/kat/test/ 会被 npm test 与 test:kat 双跑——P1-1 落地时避开该 glob 形态或接受双跑并记口径，T-A1 floor 语义不受影响）；真机外壳走「entry 内自测入口（非 hypium）优先、ohosTest 兜底」（思考员5 建议，CU8 首答后定——hypium 仓内 0 命中、无 ohosTest 模块，S5b 现搭脚手架是隐藏账）。
- **生效条件**：立即（P1-1/P1-2 文本已按此修正）。
- **owner 追认位**：＿＿＿＿（知悉性，默认通过）＿＿＿ 若 owner 认为冻结含包计数 → 转 C 案（kat 暂不入仓放 interop/kat/），回本项重裁。
- **重审触发**：CU2 答案=否（BigInt 不支持则 KAT 覆盖面缩至编码层+非 BigInt 部分，重估规模）；owner 否决。

### O6 真机性能阈值与逃生门 ——【人类闭合项：只拍方法学与决策规则，数值留 S5b】

- **决定**：现在只拍方法学字段与决策规则；数值阈值留 S5b 真机数据到手后由 owner 裁（物理上必须人类：真机 ArkTS 零数据）。
  - **方法学字段（立即生效，入 P1-13）**：iter=200 / warmup=20 / sink 防 DCE / 3 次取中位（附原始数）/ 记录机型、API 版本、充电状态与温度。
  - **三档决策规则**：≤25 ms/op 记录不设门继续；25–50 记录不阻塞但**须同时给 perf-handshake-e2e 握手总耗时**（仓内无重键周期常量，「一次握手慢 50ms 可否接受」纸面无法回答——思考员5 V9；且 x25519 只在握手路径、不拖每包吞吐，「>50 就换库」叙事的最大反证）；**>50 ms/op 停并升人**（停止 S5b、回报 owner 触发 O6，不自动换库）。
  - **评审顺序（写死，防跳步）**：①先优化现有实现（BigInt 热路径/预取池）→ ②cryptoFramework 等价探针实测（新增 CU 探针，拿数据比架构）→ ③Go .so 方案 B（VpnExtensionAbility.ets:74-78 预留，**仅 owner 可开**）。降级路径三阶：降用法→降频→换实现。
  - **指令落位**：「>50 停并升人」写进 STAGE-CHECKLIST 与判定树（新增 perf 触发树，R7 联动）；**不扩 D10 六条编号**（tree-check 第③断言按编号校验——思考员5 方案）。
- **依据**：真机零数据 + Node 同机方差 17%（BASELINE §3.4）；定松=门失灵+口径锁死、定紧=误触架构级重写+诱发改测凑数（R10 病）；五方一致「数值不可代拍、规则可代拍」。
- **生效条件**：方法学与三档立即（P1-13/§3.2-S5b/P0-6 已按此改写）；数值=S5b 数据齐备后 owner。
- **owner 追认位**：数值栏 ＿＿＿＿（触发即裁）；另固化元规则「阈值转门即须 owner 追认」（思考员3）。
- **重审触发**：S5b 记录落地日（触发即重开本项）。

### O7 headscale 环境供给确认 ——【拆三项：a 已实测闭合；b/c 人类闭合项】

- **决定**：O7 不是整体一项，拆三项分别闭合——
  - **O7-a（ssh 别名/出网/docker 有效性）：已实测闭合（2026-10-03）**。采信思考员4 会话实测记录（C7/C8/C12/C14，本批唯一远端实测；拍板人未复连远端，来源标注=thinking-decision-minimax-2.md §0）：`ssh dev-env-with-gpu` exit 0（主机 anolis-gpu-01、Docker 29.8.1、node v22.23.2）；端口 8080/3478/19090 空闲；仓库在位 /opt/gpumachine/projects/ohos-tailscale；**无 headscale 镜像**；磁盘 39G 余。原「环境完全缺失」前提被推翻（v1.0 §4.2-O7 据此改写）。**B8 相应从「需另备环境」改判「真机 agent Day-1/S2 任务（环境链已实测可通，待 b/c 闭合）」**。操作坑随记录：陈旧 ControlMaster 套接字会以「连接重置」形态失败，探针须带 `-o ControlMaster=no -o ControlPath=none`（固化进 P1-9 env-check.mjs，防 ENV_UNREACHABLE 假环境故障）。
  - **O7-b（拉取镜像）：须 owner 一行授权，人类闭合项**（远端状态变更，R6 只读红线射程之外）。预埋授权文本模板：「owner 授权：在 dev-env-with-gpu 上执行 `docker pull headscale/headscale:v0.29.4`，记录 image digest 与拉取时刻（E4）」。默认钉 v0.29.4 不跟 latest（09-29 历史口径可比性；tag+digest 双锚定，缺 digest 则 E4 四元组不完整）。
  - **O7-c（preauthkey 签发 + LAN 地址）：不可代拍，人类闭合项**（凭据签发=对控制面的授权行为；LAN 地址=owner 网络私人事实）。默认 owner 签发、用后即弃；地址以占位符入仓，真值只进 env-ready 三元组（`s6.host_pseudonym` 化名制，R11 联动）。
  - **附加联动（env-alias 防毒规则同批处置）**：handoff-scanner 的 env-alias-premature 规则（现 10 命中，全在 docs/handover/ 两文件、P0-6 修复清单之外——思考员2 亲验）须与 owner 对 O7 的正式答复**同批处置**：答 yes → 规则收窄为「仅 docs/pre-device/ 禁预写」（BLACKLIST 8→7，T-HANDOFF-b 的 ≥7 地板仍绿）并把真值写进 OWNER-GUIDE；答 no/换机 → 规则保留并清理 handover 两文件别名引用。**不处置则批次二 T-HANDOFF-a 永红、A17 终态不可达**（思考员2 论证，采纳；也不得沉默删规则——退役须在 worklog 记一行理由）。
  - **降级链（维持）**：O7-b/c 未闭合前 S0–S5b 不依赖 headscale 主机；S2「若 headscale 主机已备」条件句保留；S6 依赖 b+c+O3 签署。
- **依据**：思考员4 C7/C8（本拍板采信并标注来源）；思考员2 黑名单耦合发现；五方一致 b/c 物理不可代拍。
- **生效条件**：a 立即（今日闭合）；b/c=owner 授权/签发时（建议 S2 前闭合）。
- **owner 追认位**：b 授权 ＿＿＿＿；c 签发人 ＿＿＿＿；建议期限：真机窗口开启前。
- **重审触发**：GPU 机 IP/凭据变更、别名失效、镜像仓库不可达、O3 豁免到期。

### R1 新增 A17 判据（meta 门自检）——【已批准，采动态终态判据】

- **决定**：采纳两段式 A17，但终态不写死 79——判据=`node scripts/test-plan.mjs` exit 0（UNEXPECTED_RED=0 且 UNKNOWN_TEST=0 且 STALE_ANCHOR=0）+ 批次四收口后 `tests/plan/expected.json` 无 red-anchor 条目；用例总数由 UNKNOWN_TEST=0 与 expected.json（唯一真值源）保证，当前快照 79 条（25 绿+54 红锚）只作 owner 核对参考数。
- **依据**：runner 已实测可用（四态 25/54/0/0/0 exit 0，思考员1/2/4/5 各自亲跑一致）；写死 79 会让 A 类判据表本身成为数字漂移源——「门自己制造它要抓的病」（思考员4 收窄案，胜过照录原文案：分歧裁决见 TESTS §5-O/R-8）。锚点全翻须各有 worklog 红→绿一行。
- **生效条件**：立即（A17 行已入 §1.1；过程态 exit 0 今日为真）；终态=批次四收口。
- **owner 追认位**：无需（规格并入已获授权；ci:true 收编时点=批次四收口+holdout 全 PASS 两条件与，由 owner 手动改）。
- **重审触发**：runner 四态语义变更、expected.json 结构变更。

### R2 三道新门支持 `--root <dir>` ——【已批准，附默认根禁令与副本自证】

- **决定**：gate-d4-p4 / ets-mirror-check / doc-consistency 三门全部支持 `--root`（三门一起，部分采纳=副本等价约定出例外，例外就是下一个缺口）；**CI/生产调用必须用默认根**（脚本头写明「--root 仅供 meta 测试/临时副本」——防 `--root <干净副本>` 恒绿形态静默掏空门，思考员3 禁令）；副本须自证等价（被检面文件数+关键文件 sha256 前后一致——思考员4 增补）；`--selfcheck` 与 `--root` 共存；p0-5 不在本列（它要的是 `--out`，两个参数不混写）。
- **依据**：TESTS §5-U1 裁决（Windows 文件锁残留非零、CI 并发脏树、checkout 掩盖责任）；E6 实测 validate-shell 可搬走跑；h03/h04/h05 注入断言的唯一干净通道。
- **生效条件**：批次一/二（P0-3/P0-4 落地时实现）、批次四（P1-3）；各新增一条「--root 副本运行与仓内等价」可见断言（先登记 expected.json）。
- **owner 追认位**：无需。
- **重审触发**：某门 --root 副本与仓内结果不一致（等价性破）→ 暂停该门注入验收。

### R3 P0-5 验收补 `--out` ——【已批准并升格批次二阻塞项 + 五件套闭环】

- **决定**：采纳并升格：`--out <dir>`（realpath 锚定、拒绝越界路径——本地诊断脚本也防 upload_server 同类安全债）为 P0-5 必交付、批次二收口判据（T-P0-5-d 翻转）；配套**五件套闭环**（TESTS 原案只有前两件，思考员4 补全）：①`--out`；②一条命令同批产出三件（regress.log=stdout+stderr 合并原文、summary.json 结构化原件、state.sha256——同一 runId/startedAt）；③同批校验（P1-11：summary 的 runId/startedAt 与 log 首行 batch id 相等，目录内无跨批文件——「一致」具体化为可机检相等）；④E4 四元组写入 summary（顺带解决双侧指纹可比）；⑤E5 主机化名制（真实 IP/别名不进 evidence/OWNER-GUIDE）。归档 runbook 的 `sha256sum state/*` 死命令（仓根 exit 1，思考员4 C6 实测）一并改写为可执行。
- **依据**：regress.mjs:71-74 写 `mkdtempSync(tmpdir())`、路径只打 stderr 一次、归档只 tee stdout——PLAN §3.4「summary 原件入 evidence」在当前形态下**物理不可满足**（五方亲读一致）；只做 --out 不收口=「目录里有 log 与 json 但互不印证，比没有更危险」。
- **生效条件**：批次二（P0-5）；P1-11 校验器批次三配套。
- **owner 追认位**：无需。
- **重审触发**：regress 归档形态变化、P0-7 gitignore 方案变更（A14 与本项一起复核）。

### R4 STAGE-CHECKLIST 含 S5b 随机字节快照步骤 ——【已批准，升级三配套】

- **决定**：采纳并从「加一条步骤」升级为「步骤+触发时机+回传命令」三配套：①S5b 跑 KAT/perf **前**先开快照环形缓冲（非失败后补采）；②落点与回传（`hdc file recv` → `evidence/interop-<date>/rng-snapshot/`；`.bin` 不在吞噬面，P0-7 断言覆盖）；③check-stage-docs 断言步骤文本含回传命令。快照=环形缓冲+显式 dump、默认关、D13 需要时开（P1-5 钩子同条款）。
- **依据**：钩子无剧本步骤触发=机制空转（D13 复现包是「真机失败归因的唯一确定性底座」）；快照不与失败运行同批=「看起来能重放、实际不能」，比没有更坏（思考员4/5 同判）。
- **生效条件**：批次二（P0-6 交付）；P1-5 钩子批次三同批。
- **owner 追认位**：无需。
- **重审触发**：真机确认 VpnExtensionAbility 进程内同步写卡扩展进程 → 改 hilog 输出或移 UI 进程写。

### R5 P0-7 验收补「不该进的没进」——【已批准，T-P0-7-e 升主断言】

- **决定**：采纳双向判据；修法必须限定式（`!evidence/` + `!evidence/**/*.log`），禁全局 `!*.log`；**T-P0-7-e（仓根 foo.log 仍被吞）升为该组主断言**——鉴别力权重修正：node_modules/x.log 由 `.gitignore:2` 目录规则吞，git 语义下被排除目录内文件不可再纳入，全局豁免也翻不动（T-P0-7-d 对该滥用不敏感）；foo.log 命中 :27 `*.log`，`!*.log` 会翻它——e 是唯一鉴别器（思考员3 实测发现，拍板人按规则来源复核采纳）。c/d 降为回归地板。
- **依据**：gitignore 否定规则的经典事故面是「放开过头」（p12 击穿=凭据入 git 历史不可撤）；c/d/e 三条现绿是地板，零成本。
- **生效条件**：立即（P0-7 验收已按此改写）。
- **owner 追认位**：无需。
- **重审触发**：.gitignore 结构变化。

### R6 caliber.json 无值结构 ——【已批准，附三句现状差距硬约束】

- **决定**：采纳 `docs/pre-device/caliber.json`（无值结构 {id,cmd,extract,relation∈{min,eq}}，min 双字段 floor+current，豁免表每条非空 reason）+ `scripts/doc-consistency.mjs` 消费器（--docs-root/--root）；**三句硬约束**：①`cmd` 必须是真命令、`current` 由门写回不许手填（写成显式断言而非注释——常量式门=自证）；②扫描面=活文档面 ∪ docs/pre-device/**（并集，堵「docs/pre-device 新包里出现 280 pass 两个可见测试都抓不到」的缺口）；③check-stage-docs 六断言不得要求 caliber.json 存在（批次二不被批次四落地物卡死——同构 R12 爆红教训）。floor 硬断言；eq 条目（如包数叙述）在 O5 叙述同步完成后才点亮。
- **依据**：awk 恒空=假绿门（BASELINE §5.2-3）；min/eq+floor/current 调和「≥495 只增不减」与「写现行口径」；思考员2 三句差距说明全部核实（caliber 不在 P0-6 七件套、两套可见扫描存在并集缺口、h05 是真值锚判定力所在）。
- **生效条件**：批次四（P1-3）；P1-2 先清（附录 B-8 顺序锁）。
- **owner 追认位**：无需。
- **重审触发**：口径数字变更；「cmd 指向假脚本」类作弊由 T-REG-3 先行拦截。

### R7 新增 scripts/check-decision-trees.mjs ——【已批准，等价收编禁重写】

- **决定**：采纳独立脚本（不并入 check-stage-docs——按演进速度拆分，U-handoff 原则）；为 `tests/plan/lib/tree-check.mjs` 规格内核的**等价收编**（支持 --root、保留同等自检负对照），**禁止重写规格**（重写须过同等自检+规格变更走决策条目）；覆盖树清单在原五棵（S3 报错处置/S6 四步/CU 卡×5/回退倒序）之外**追加 S5b perf 触发树**（>50 停并升人分支——O6 联动，树外出口必含）。
- **依据**：树有洞=真机 agent 自由发挥=R1 风险直接入口；内核已实装且自带五坏树负对照（T-TREE-a/b 绿，四思考员亲跑一致）；R1–R13 中性价比最高的一条（思考员5）。
- **生效条件**：批次二（P0-6 交付，package.json 补丁 TESTS §2.5 已含）。
- **owner 追认位**：无需。
- **重审触发**：行法规格变更（TESTS §4.2）。

### R8 P1-2 在 P1-3 建成前验收记「暂不判定」——【已批准，红锚严禁摘除】

- **决定**：采纳：P1-2 落地后验收记「暂不判定」（清零事实以一次性脚本留 worklog 一行，含命令与输出，不装成门）；P1-3 建成后转正式。**T-A13/T-A16-1 红锚严禁因「暂不判定」摘除**（UNKNOWN_TEST 机制自伤；红锚红着本身就是未完成态的显式记录，不解除压力）。
- **依据**：一次性 grep 自证=第二次假绿形态（本仓三次假绿前科）；与 A17/R6 不冲突（作用层不同：A17 管 meta 健康、R8 管验收记法、红锚管完成定义——思考员2 三者一致性推演采纳）。
- **生效条件**：立即（口径）；批次四（P1-2 收口时执行记法）。
- **owner 追认位**：无需。
- **重审触发**：P1-2 收口、P1-3 建成。

### R9 D4/P4 扫描面扩到 app/bridge/src ——【已批准扩 bridge/src，拒绝扩全 app/】

- **决定**：检索面=`packages/*/src` + `app/bridge/src`（枚举声明+脚本头注释+运行时输出三重声明；h03 验证声明面==实际面）；**拒绝扩到全 app/**（perf 源码计时 Date.now 撞 P4、entry platform/ 按设计用宿主 API——扩全 app/ 强制立即引入豁免机制，违背「先定 pattern 再谈豁免」顺序）；pattern 必须区分 import 形态（三形态，防 mock-localapi.ts:229 `const node:` 假红——拍板人亲验该行属实）；app/entry .ets 面归 validate:arkts (b) 面、两门交集保持空；platform/ 纪律面现无机检作为已登记缺口记录（不假装 R9 覆盖）。T-P0-4-g 绿地板同步扩 app/bridge/src 段（扩绿地板覆盖=扩规格，登记后改；两端都 0 命中，结果不变）。
- **依据**：app/bridge/src 三段等价 grep 现值 0 命中（思考员1/2/3 独立亲测吻合，零迁移负担）；bridge/src 是壳↔库唯一活动面、其 node: 导入在真机 ets 构建必炸；「门只扫一半的面」=typecheck:bridge 缺口#1 同构。分歧裁决：思考员4 主张扩全 app/（今天与 bridge/src 等价）——**不采**：其自陈「今天等价」恰恰说明收益当期为零而未来误报面确定非零（perf/platform），且与 R13 的豁免启用条件绑定后，「扩面」成为需要 owner 再批一次的规格变更，不如一次拍在零误报面上（详见 TESTS §5-O/R-9）。
- **生效条件**：立即（规格）；执行=批次一（P0-4 落地）。
- **owner 追认位**：无需（收紧类，合法性最强——扩面从不需要豁免权）。
- **重审触发**：新增 workspace 包或 app/ 下新 src 面（如 platform/ 出现 .ts 形态）→ 走 R13 豁免条款而非缩面。

### R10 P0-8 验收补第二档路径校验 ——【已批准，行为级断言】

- **决定**：采纳第二档（`ARKTS_SDK_HOME` 指向存在但非 SDK 目录 → 可读错而非崩）；断言写在**行为级**（可读错+非 ReferenceError/SyntaxError/Cannot find module），**不锁「什么是 SDK 目录」的判据**（跨 SDK 版本脆弱、无 SDK 在盘不可实证）；思考员4 的陈旧默认路径子例（:6 指向已不存在的 workspace，会让无参运行炸出与 SDK 无关的错误）并入——P0-8 实现时把 :6 一并参数化/删除。
- **依据**：第一档 existsSync 即过，第二档才证明真做了存在性之外的形态校验；现会在 :33 realpathSync 抛错。
- **生效条件**：批次一（P0-8）；第二档断言落地时新增（先登记 expected.json）。
- **owner 追认位**：无需。
- **重审触发**：SDK 获取渠道变化。

### R11 env-ready 三元组 ——【已批准，补两键与填写减负】

- **决定**：每项「值+证据+时间戳」三元组；schema 键清单 `{key:{type,enum?,pattern?,why}}`、校验器同 schema 驱动、why 出现在报错文案；**新增两键** `s6.headscale_waiver_id`（引 DECISIONS O3/HS-DEV-001 签署态）与 `s6.host_pseudonym`（O7 主机化名，非别名/IP 真值）；evidence 允许「同目录文件路径+一行摘要」二选一（防长输出致空填）；`at` ISO8601 带时区；schema 外多出的键也必须带 evidence；「填 env-ready」列为 S4 末一次性动作；真机前桌面演练一轮测空填率。
- **依据**：裸 bool=「人写了没写」都不防；三元组是 PLAN §3.4「贴原始输出而非结论」在人类配合面的落实；校验器已实装三绿（T-ENV-a/b/c，四思考员亲跑一致）；两键把红线豁免与主机身份纳入三向对齐（思考员4）；减负条款防「太麻烦而空填」（思考员5）。
- **生效条件**：批次三（P1-12）。
- **owner 追认位**：无需。
- **重审触发**：schema 键增删；桌面演练空填率>30%。

### R12 P2-1 验收细化 ——【已批准，据实收窄为三件】

- **决定**：原 8+7 条**逐条**仍绿 + 条数钉 8/7 + 注入 `..%2f`/`%2E%2E` 大小写混写/`..\`/超长/NUL 变体必红（变异取样优先大小写变体——现 8 条覆盖最弱的一类）；Python 视角 inbox **字节级**只含合法文件、不看返回码。**据实收窄注记**：字节级判定 upload_server.test.mjs:187（`assert.deepEqual(files,['x.bmp'])`）已在盘（思考员4 亲读），勿重复建设——R12 净增量=逐条+条数钉+注入必红三件。
- **依据**：总数判据对「删一条负例换一条正例」是盲的（T-P0-1-e 同一教训）；upload_server 是全仓最强真代码实证（fcaf962），判据强度决定「安全修复有实证」的含金量。
- **生效条件**：P2 落地时（批次四/后）。
- **owner 追认位**：无需。
- **重审触发**：向量集变更。

### R13 perf 目录豁免纪律 ——【已批准：规则级豁免 + 默认不开 + perf 可执行副本落 entry】

- **决定**：豁免必须是**规则级**（`{path, rule, reason, added_at, added_by}`）而非路径级（路径级=一次性关掉该路径下所有规则，「测性能」目录成 D4 盲区）；EXEMPTIONS 放 gate-d4-p4.mjs 门内常量（不进 gates.registry.json——registry 管门在不在 CI，不管门内扫哪，两者生命周期不同步）；**默认不开任何豁免**（app/tools/perf 在面外是面声明的事实）；触发条件写死「仅当检索面扩至含 app/tools/perf 时条款生效」；meta 断言「每条豁免 reason 非空、规则级、非全集」；与 R9 同批生效。**另裁（思考员5 V7 实测约束）**：`app/tools/perf/` 不在模块 srcPath 内、.ets 不进 HAP 真机跑不了——perf 源码必须另有 entry 内可执行副本（P1-13 已按此改写），仓内 perf 目录定位为源码母本。
- **依据**：R9/R13 是同一扇门的三个自由度（--root 怎么注入、扫哪里、哪里不扫），一揽子拍；「为空集开洞=给未来的沉默缩小发预授权」。
- **生效条件**：与 R9 同批（立即规格；豁免条款生效条件=面扩至 app/tools）。
- **owner 追认位**：无需。
- **重审触发**：R9 扩面决定变更；perf 源码改落位（如移 entry/ets/perf/）→ 豁免表同步。

# 5. 决策预埋清单（规划阶段已替真机 agent 做好的决策）

| ID | 决策 | 理由（证据） |
|---|---|---|
| D1 | 真机控制面走**路径 A**（tailcfg JSON + controlbase 真 prologue + h2c）；`ShellControlSession`（client.ts:70-73 本地 prologue + messages.ts:167-178 无 auth TLV）定性为本地 mock 门面，**真机不用它注册** | 两条路径互不兼容且壳现接线走 B（shell-session.ts:127 亲验）；B 结构上无法被真 headscale 接受；不预埋则 S6 必败且无线索（两侧测试全绿，失败现场无任何线索） |
| D2 | H2OverNoise 落位=O4（**2026-10-03 已裁**：control 包新增 h2c.ts，走 §10.3 版本记录条目 + §10.2 增 AU 行）；落包保持零 node: 导入**且零 process/console/globalThis**，三条执行约束与 barrel 默认不加导出见 §4.2-O4 | h2c 仅 type-import noise（亲验）；TextEncoder×5/tuple×1 与 P0-3 禁则集 0 命中（思考员1 亲验、拍板人复验）；8 包冻结边缘已经 owner 授权代拍，追认位留 §4.2 |
| D3 | headscale 双配置：基线 yaml 修回 127.0.0.1；设备侧另起 headscale.device.yaml（O3 豁免令 HS-DEV-001，**已代拟待 owner 签署**，四要素+负面清单见 §4.2-O3） | server_url=127.0.0.1 对手机是死路（连到手机自己）；绑 0.0.0.0 违 R1/R5；改基线污染 D 子线复现性 |
| D4 | CU6 判定树：先 `ohpm file:../../packages/*`（最轻）→ 失败则源码镜像脚本（P1-7，最可预测）→ 最后 HAR；判定点在 S3.0 最小探针，不在壳上 | 探针上失败可二分；壳上边试边改无法定位 |
| D5 | 集成三方案**不预锁死**，只交付判定树+工具 | CU6 未答前锁死=猜（轨迹2 §3.1 否决预执行的理由成立） |
| D6 | 签名：自动签名优先、p12 退路、未签名仅 S3 编译验证 | README-app §2.3 既有事实 |
| D7 | S8 peer 拓扑=手机↔Node 侧节点（复用 derp.node.ts A/B 身份） | 一次部署双端；两台手机拓扑成本高且无先例 |
| D8 | mock 桥保留服务单测；真机数据面走 platform/ 新实现；V9 12 条检的语义标注「检的是 mock 纪律」 | 删 mock=30+ bridge 用例直接红；mock 是回归资产 |
| D9 | 设备命名 `ohos-interop-<设备短名>`；hostinfo OS 字段按 tailcfg 语义填 | 对齐 register.node.ts:45 既有惯例；避免双节点同名干扰 S6 诊断 |
| D10 | 升级条件六条 + 连续 2 次无进展强制升人（见 3.3） | 防 agent 无限自旋/patch 凑 PASS |
| D11 | 测试证据分层迁移：KAT 死值层上真机；node:crypto 交叉层永留 Node；自洽层低优先 | 49/49 测试文件 import node:（亲验）；「真机复跑 495 例」是陷阱（轨迹1 备选 A 否决成立） |
| D12 | 性能记录制：先记录后定阈值；软参考 x25519 ≤25 ms/op（≈6× Node 上界），>50 触发 O6 | 真机零数据下定阈值要么松到无意义要么诱发凑数；BASELINE §3.4 方差教训（17% 波动） |
| D13 | 失败复现包格式：参数 hex+随机快照+时钟轴快照 → FixedClock/ArrayRng 回 Node 重放 | 真机失败归因的唯一确定性底座；须 adapter 第一天留随机快照钩子（P1-5 契约含） |

# 6. 风险登记与缓解（概率×影响）

| # | 风险 | P×I | 缓解 |
|---|---|---|---|
| R1 | 真机 agent 把环境/人工确认点失败**误诊为代码问题并开始改代码**（签名、hdc 信任、VPN 弹窗、preauthkey、AP 隔离任一未过都会如此） | 高×高 | env-ready.json 强制门（S5/S6 第一步先读、全绿才继续）；六条升人触发；禁则清单；OWNER-GUIDE 让人预知每个确认点 |
| R2 | TS2353 修复者选 `answerDns:null` → 测试 400→503 挂 → 改断言拔掉 e136900 安全钉 | 中×高 | 反模式实测输出原样进 AGENT-TASK 反模式清单；正控制组把「合法 q 应 200」钉死 |
| R3 | CI 自 51b70c3 一直红（本地推定三句口径：整 step 恒红；P4/node: 两段真跑且绿；D4 段从未执行——O/R-2026-10-03 O1）→ 新回归被当作「本来就是红」忽略 | 中×中 | O1 owner 确认（三态回报格式已预埋）；P0-4 合入后建立「CI 绿基线」；gates 聚合让本机也有同一判据 |
| R4 | 真机 agent 照 app/README「注入 control 包」走 B 路径 → S6 无线索卡死 | 高×高（不预埋时） | D1 已裁并置 AGENT-TASK 首章；ShellControlSession 定性写明 |
| R5 | 127.0.0.1 自锁：手机连自己 / 红线照搬锁死真机 | 中×高 | D3 双配置 + O3 书面豁免；S6 失败处置树第②步 |
| R6 | `*.log` 吞掉 regress.log，证据归档成空操作 | 确定×中 | P0-7 一行修复 + A14 判据 |
| R7 | 新增用例推高口径数字（30→31→36…）引发文档漂移回潮 | 高×低 | P1-2 数字联动一次改齐；P1-3 否定断言门防旧数字回流 |
| R8 | KAT/h2c 落包触碰 8 包接口冻结 | 中×中 | 只增不改原则；O4/O5 拍板；kat 独立包不碰既有 barrel |
| R9 | @kit stub 假绿/假红误导首构排障 | 中×低 | stub 面最小化（壳现有 import 面）；首构日回报 stub 与真实 d.ts 的 diff 反向校准 |
| R10 | 先写死性能阈值诱发「改测凑数」 | 低×高 | D12 记录制；阈值裁定权归 O6 |
| R11 | 真机 agent 编译压力下顺手改 packages/「让它编过」 | 中×高 | 冻结面禁则 + D8 + validate:arkts 对 packages 面持续在岗 |
| R12 | 文档门先立后清 → 全仓爆红噪音 → 门被整体禁用 | 中×中 | 顺序锁死：P1-2 清零 → P1-3 阻断（附录 B-8） |
| R13 | selftest 变走过场（只加断言不记录红→绿轨迹） | 中×中 | P0-5 验收明列「红→绿轨迹入 worklog」为交付物 |
| R14 | owner 拍板点积压，真机 agent 拿着未签署 DECISIONS 开工 | 中×中 | O1–O7 在规划落地时即递交 owner；O3/O4/O5 属真机前必须签署，O6/O7 可后置但标注触发条件 |
| R15 | 人类日历时间是关键路径（DevEco 安装、账号实名、授权弹窗），agent 计算时间无法替代 | 高×中 | OWNER-GUIDE 把申请动作列为 S0 前置一次性发起；规划落地即提醒 owner 启动账号申请 |

# 7. 与 BASELINE 的衔接

| 工作项 | 对应 BASELINE 发现/缺口/缺陷 |
|---|---|
| P0-1 | 缺陷#1、缺口1（typecheck:bridge 不在 CI）、§2.4/§5.1 |
| P0-2 | BASELINE 外新发现（轨迹1 F5；stun.ts:176 亲验）——补 §3.2「linter src=0 只对 6 旧包」的实锤 |
| P0-3 | §3.2（.ets 零编译器覆盖/linter 盲区）、§8-4 关联；轨迹2 E4–E7 |
| P0-4 | 缺陷#3、缺口2（D4 段语法死）、缺口4（死过滤器）、§2.9 |
| P0-5 | 缺陷#2（regress 三重缺陷）、§2.10；新增「不可归因」缺口（轨迹4 A1） |
| P0-6 | §6 勘误表全量 + 轨迹5 §1.4 四条假命令 |
| P0-7 | BASELINE 外新发现（轨迹4 A11 gitignore 冲突） |
| P0-8 | 缺陷#4（arkts-check.js 本机不可跑） |
| P1-1 | §3.0（测试证据三层）、§7 CU8；轨迹1 F9 |
| P1-2/P1-3 | 缺口3（docs-consistency 失明）、§6 |
| P1-4 | §3.2/§4.2（TUN 壳层 fd 未接线——真机前唯一可落地部分） |
| P1-5 | §3.1 注入接口、§7 CU7 |
| P1-6 | §7 CU 清单（CU2/5/6/7/8） |
| P1-7 | §4.2（oh-package TODO 三方案未选） |
| P1-8 | 第五门禁缺口（interop 零类型覆盖，轨迹3 F14/轨迹4 A3；BASELINE 未列） |
| P1-9 | §7（需 headscale+docker）、§4.3；轨迹4 A9/A10 红线冲突 |
| P1-10 | §7（上游快照未对拍）+ 轨迹4 A5 归档缺 58 份（BASELINE 外） |
| P1-11 | §7（09-29 证据性质=历史口径）、§3.3；轨迹4 A8 好范式 |
| P1-12 | §7（需真机/人类配合边界） |
| P1-13 | §3.4（perf 正确读法与单点缺口） |
| P1-14 | §5.1（CI 覆盖矩阵的本地等价统一入口） |
| P2-1/P2-2/P2-3 | §2.7 注（importlib 直调）、轨迹4 A7、轨迹2 §4-P2-8 |

# 8. 附录 A：五份思考轨迹的采纳/修改/拒绝记录（逐份）

**轨迹1（glm53flash-1，协议运行时风险）**
- 采纳：R2 Generator 修复列 P0-2；KAT 双 runner（G-A3）列 P1-1；CU 卡（G-A5 部分）列 P1-6；注入层桩+驱动权+预取池+随机留痕（G-A4/R6/§4）并入 P1-5/D13；perf 四件套与记录制（§6）列 P1-13/D12；证据分层迁移（§2 第二原则）定为 D11；备选 A/B/C/D/E/F/G 的否决全部维持。
- 修改：G-A2 机检并入 P0-3 双面门（packages 面+app 面）；KAT 位置在其二选项中裁决为 packages/kat/（O5）；其「门禁红灯修复归口由合并人裁定」的谦让由本规划认领为 P0-1/P0-4。
- 拒绝：无。

**轨迹2（glm53flash-2，壳与交接面）**
- 采纳：其 §4 的 P0-1/P0-2(ets 门)/P0-3(VpnConfig)/P0-4(任务书)/P1-5/P1-6/P1-7/§4-P2-8 各项结构与验收门；E4–E7 实验形状整体吸收为本规划 P0-3 技术方案；§3.5 Index.ets 排除裁决、§3.4 stub 三处置、§1.6「报错枚举而非清零」强定义全部采纳。
- 修改：validate:arkts 升 P0（其风险 1 自陈孤例，裁决入 P0 并扩 packages 面）；交接物路径定为 docs/pre-device/（其未指定）；任务书范围扩为交接包（含 DECISIONS/STAGE-CHECKLIST/check 脚本）。
- 拒绝：无。

**轨迹3（minimax-1，缺陷清零与门禁）**
- 采纳：TS2353 形态 C + 正控制组（本规划核心裁决之一）；D4 抽脚本方案 A；变异负例纪律（每个 P0 门配负对照）；O1 排序约束（P0-4 之后）；文档门「先清后立」；P1-8 摸底前置；R1 反模式风险处置。
- 修改：U2「作者本意」疑虑以「行为零漂移 + 正控制组钉语义」原则关闭（不等待 git 考古）；R2 数字联动并入 P1-2 不单列 owner 项（数字跟真值走是默认纪律）。
- 拒绝：无（其「gates 聚合属 P0.5」微调为 P1-14 收尾项）。

**轨迹4（minimax-2，互操作与证据链）**
- 采纳：「可归因>可核验>可复跑>真跑」优先序整体；I-1~I-3（marker/reason 枚举/selftest 五断言）为 P0-5 核心；I-5 步 0–5 为 P1-9；I-6=P0-7；I-7=P1-10；I-8（oracle 诚实化）并入 P1-2；I-4（证据规范+校验器）=P1-11；h2c 补 CLI（方案 A）为 O2 建议方案；A8 死值锚定范式升格为 E1。
- 修改：I-9（interop tsc）从其 P0 表移至 P1 末（尊重其自陈 U8 与轨迹3 同判：不阻塞真机窗口且首纳可能爆错）；I-14~I-17 重分类为 B 类/真机 agent 任务（本规划 P2 仅收本机可做项）。
- 拒绝：无（其「真机前不硬搭环境」的反对意见采纳，环境确认转 O7）。

**轨迹5（minimax-3，端到端验收与人类配合）**
- 采纳：S0–S8 剧本与 S1 剧本自检级、S3.0 最小探针（全规划最重要的流程创新）；D1–D10 决策预埋骨架（本规划 D1–D10 直接继承）；env-ready.json 机制（其 A11/R-环节③缓解）；六条升人触发与回退路径；OWNER-GUIDE 骨架与写作纪律；四条假命令清单；「总回退是可接受终局」定性。
- 修改：D2 由「我不能单方面定」推进为带新证据的 O4 建议方案（h2c 零 node: 导入亲验）；U-6 路径裁决 docs/pre-device/；A9/A10/A11 并入 A15 判据；其 D4/D5 合并表述为本规划 D4（判定树）+D5（不预锁死）。
- 拒绝：无。

**跨轨迹矛盾核对**：五份轨迹间无正面冲突的事实主张；分歧集中在十处方法论/优先级（附录 B）。BASELINE §10.3 已裁决的数字矛盾（netcheck 84 非 64 等）本规划直接沿用，未再引入新口径。

# 附录 B：十个分歧的裁决表

| # | 分歧 | 各方 | 裁决 | 理由 | owner 拍板 |
|---|---|---|---|---|---|
| 1 | TS2353 修法 | 轨迹3：传真函数（形态 C）；BASELINE §8 字面：「修传参为合法 answerDns 形态」 | **传真函数 + 正控制组** | `answerDns:null` 实测 400→503 挂测试；形态 C 是唯一同时满足类型绿+行为零漂移的修法，且消灭「合法 q → TypeError」未捕获雷；正控制组即防再犯钉 | 否（证据可定） |
| 2 | CI D4 定性 | 轨迹3：「一直红（大声报警没人看）」；BASELINE：「从未真正执行（静默失效）」 | 采**「一直红」**为本地推定口径（step exit 2 变红非静默），远端实际状态标不可证；**owner 确认远端 Actions = P0 人类项（O1）** | `set -eu` 下第 15 行语法错 → exit 2 → step 红；轨迹3 F13 证明配置已推远端；「从未有约束力的绿」这一定性只有 owner 能闭合 | **是（O1）** |
| 3 | regress 阶段 3 | 轨迹3：删除（H2OverNoise 已在 derp:200/register:228 实例化，阶段冗余）；轨迹4：补 CLI（TASK.md:54 把 h2c 写进 D-1 契约，删=改契约） | **默认补 CLI**；因触及验收契约边缘 → O2 owner 拍板，建议补 CLI | D-1 明文「register/h2c/derp 全部 exit 0」（亲验 TASK.md:54）；h2c 是唯一未独立验证的链路，独立 marker 才可归因；删阶段的成本节约很小（CLI 为 S 级增量） | **是（O2）** |
| 4 | oracle/raw 17 份 | 轨迹4：诚实化+新证据规范（重建=伪造证据） | **诚实化+新证据规范** | 转储取自已不存在的 tailnet 状态（fork 版 1.102.3 特定机器），重跑不可复现同批字节；从笔记反推生成 raw/ 是伪证，比缺文件危险——它会让复核者以为原始物证存在 | 否（技术事实） |
| 5 | KAT 模块位置 | 轨迹1：packages/kat/ 或 common/src/kat/ 二选一 | **packages/kat/ 新包（O5 知悉性拍板）** | 不改 common 任何文件/barrel=接口冻结最安全满足；独立 tsconfig/测试入口清晰，node:test 与未来 hypium 外壳互不干扰；代价是「8 包」口径变 9，故留签署 | **是（O5，建议默认通过）** |
| 6 | validate:arkts 是否 P0 | 轨迹2 提议并自陈孤例 | **P0** | .ets 零编译器覆盖是最大验证空档（E4–E7 实证）；F5 Generator 实锤现有门禁对 ArkTS 禁则全盲（function* 是普通 JS 语法，strip-only 与 tsc 均不拦）；不修则真机窗口被占用 | 否 |
| 7 | VpnConfig 组装位置 | 轨迹2：app/bridge（并否决 packages/改 wgderive） | **app/bridge** | 8 包接口冻结红线明文，壳侧语义不回灌；bridge 是壳侧半边且能进 test:bridge/typecheck:bridge 双门（新工作自带护栏） | 否（红线可判） |
| 8 | 文档门顺序 | 轨迹3：先清文档后立门（依赖结构内建） | **先清后立** | 先立门→活文档面全红→噪音→门被禁用；且 L1 修复先于 L3 机检才能把门锚定在正确行为上（本仓默认失败模式是「当时绿、事后腐化」，机检必须后锚） | 否 |
| 9 | interop/*.ts 类型检查时机 | 轨迹4 列 P0；轨迹3 列 P1-7 且警告首纳爆错 | **P1 末尾，先摸底后纳入** | 939 行从未过 tsc，首纳错误量未知（轨迹4 U8 自陈未试跑）；不阻塞真机窗口（interop 脚本靠 strip-types 运行不靠 tsc）；摸底数据入 worklog 后再排修复量 | 否 |
| 10 | D1 控制面路径 | 轨迹5：必须走路径 A，h2c 落位不能单方定 | **路径 A 预埋（D1）+ h2c 落位 O4（建议 control 包新文件）**；真机 agent 拿到 DECISIONS D1/D2 结论 + AGENT-TASK 首章 + S6 失败处置树① | B 路径 prologue/载荷结构上不可能被 headscale 接受（client.ts:73 本地 prologue vs controlbase.ts:41 真 prologue、messages.ts:167-178 无 auth vs tailcfg.ts:57-90 真 RegisterRequest，四方亲验）；落包触冻结须 owner；新证据（h2c 零 node: 导入）降低 O4 成本 | **是（O4；路径结论本身否）** |

---

*本规划的完成判据=第 1.1 节 A1–A17 全绿 + O1–O7 已裁（2026-10-03 代拍，§4.2；人类闭合项——O1 远端观测、O3 签署、O6 数值、O7-b/c——已留 owner 追认位与期限建议，不缺位）。B 类答案、INTEROP PASS、真机数字一概不在本机承诺范围内——那是真机 agent 与人类的剧本。写作纪律：宁细勿粗、不粉饰、每条验收可跑。*
