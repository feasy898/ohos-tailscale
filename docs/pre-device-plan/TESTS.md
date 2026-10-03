# 真机前工作最终实现测试（TESTS）

> **版本 v1.1（2026-10-03，O/R 拍板裁决）**：owner 于同日授权拍板人（GLM53）对 §0.3 修订建议 R1–R13 与 PLAN §4.2 拍板点 O1–O7 共 20 项代 owner 做出决策，裁决记录见 [PLAN.md](PLAN.md) §4.2（v1.1）；本档 §0.3 逐条标注裁决结果、§1 总矩阵更新判定口径、§5 增补「O/R 拍板裁决（2026-10-03）」、新增 §0.7 权限规则与 §2.9 待执行变更清单。**测试实体（tests/plan/、scripts/test-plan.mjs、scripts/gates.registry.json、仓外 holdout）本轮零改动**——需跟随的变更登记于 §2.9，由调度/验收侧执行。

# 0. 元信息与方法

- **成文日期**：2026-10-03（标识 TESTS-2026-10-03，所有新文件头注释携带）
- **被测对象**：[PLAN.md](PLAN.md)（25 个工作项 P0-1…P2-3、A 类完成定义 A1–A16 + A17（R1 已批，2026-10-03）、剧本 S0–S8、决策 D1–D13、拍板点 O1–O7——**已由 PLAN v1.1 §4.2 决策记录取代「待拍板」态**）
- **事实基线**：[../baseline-audit/BASELINE.md](../baseline-audit/BASELINE.md)（一切事实判断以其为准，引用格式「BASELINE §x」）
- **输入思考轨迹**（五份，收敛原则的落实索引见 §0.2；逐份采纳/修改/拒绝记录见 §0.5）：
  - [thinking-test-glm53flash-1.md](thinking-test-glm53flash-1.md)（host 自动化主轴，下称「测轨1」）
  - [thinking-test-glm53flash-2.md](thinking-test-glm53flash-2.md)（真机侧与交接面，下称「测轨2」）
  - [thinking-test-minimax-1.md](thinking-test-minimax-1.md)（holdout 原则与反过拟合，下称「测轨3」）
  - [thinking-test-minimax-2.md](thinking-test-minimax-2.md)（门禁 meta 测试，下称「测轨4」）
  - [thinking-test-minimax-3.md](thinking-test-minimax-3.md)（文档口径一致性与剧本检查表，下称「测轨5」）
  - 注：测轨5 文件内偏移 11177 处含一个 NUL 字节（读取器拒读），本合并人以净化副本通读全文，未改原文件。
- **本文件性质**：测试主文档。交付四件：①本文档；②可见测试实体（`tests/plan/` 16 文件 + `scripts/test-plan.mjs` + `scripts/gates.registry.json`）；③holdout 包（仓外 `<HOLDOUT_DIR>`，本档只述机制不含判定内容）；④对 PLAN 的修订建议（§0.3——**2026-10-03 更新：R1–R13 已由 owner 授权的拍板人裁决并入 PLAN.md v1.1 §4.2，本档原「不改 PLAN.md」的边界随该授权解除并留此记录；§0.3 保留原建议文本作审计对照**）。
- **可见性边界**（划分第一原则，测轨3 §2.1）：定义「正确」的测试与全部规格对开发 agent 可见；验证「门没被骗/没被掏空」的判定内容（变体集具体形态、哨兵值、采样种子、ci:false 白名单全集）只在 holdout。两者永不改同一份规格。
- **红线继承**：禁 npm install、禁擅自 git commit、不改任何既有文件（集成改动以「待应用 diff 清单」给出，§2.5）；开发 agent 可见本档与全部可见测试。

## 0.1 本合并人会话亲验清单（写入正式测试的每个事实都抽验过）

| # | 事实 | 验法 | 结论 |
|---|---|---|---|
| V1 | peerapi-tun.test.ts 的 `test(` 计数 | grep -cE '^\s*test\(' | **9**（P0-1 落地后应 10） |
| V2 | TS2353 现状 | BASELINE §2.4 复跑口径 + 亲读 :81 单参 helper / :245-249 整包字面量含 `answerDns: null` / mock-peerapi.ts:60 DnsAnswerFn | exit 2 属实 |
| V3 | stun.ts Generator | 亲读 + 全面 grep | :176 `function* foreachAttr`、:190 `yield`、调用点 :215/:382；packages/*/src 恰 2 命中、无注释误报 |
| V4 | /dns-query 分支语义 | 亲读 mock-peerapi.ts:152-200 + 实跑 | 空 q → 400 `missing q`；其余畸形 → 400 `malformed q`；`answerDns:null` → 503（R2 陷阱实锤）；合法 q → 200 且 body JSON 键集恰 {RCode,Negative,Answers}；末尾点/`-`开头/大写/下划线=放行（谓词 :180-190 与注释明示）；qtype `t=aaaa` → **DnsType.AAAA=28**（16 是 TXT——首版笔误经亲验纠正，正是「事实必须抽验」的实例） |
| V5 | regress.mjs 缺陷 | 亲读 :24-76 | :42 判据 `status===0 && !sawUsage && stdout.length>0`；:52 `'regress-dummy-preauthkey'`；derp 阶段仅传 1 参；h2c.node.ts `process.argv` 计数 0；**:71-74 summary 写 `mkdtempSync(tmpdir())`**（测轨2 新发现，本合并人复核属实，采纳进验收 R3） |
| V6 | .gitignore | 亲读 :24-47 + check-ignore 实测 | `*.log`@:27 吞 `evidence/interop-20261003/regress.log`（exit 0）；`evidence/interop-X/state.sha256` exit 1；secrets 段 `*.hwp/*.cer/*.p7b/*.p12/*.keystore`；`.mimosa/`@:24、`.zcode/`、`node_modules/` 均在忽略面 |
| V7 | g0-gates.yml | 亲读全文 | 六 step（G0-1/6/2/3/4/5）；G0-5 内联块 :68-87；**:72/:79/:85 有 `\|\| true`**；docs-consistency :90-127、awk 取值 :105-112；标题/注释自称「五门」；`continue-on-error` 0 处 |
| V8 | 交接面毒点 | 亲读 | HARMONY_AGENT_TASK.md:9「六包…238/238」/:13 `git://203.0.113.10:9418`/:68/:71 `[UPLOAD-TOKEN-REDACTED]`/:82/:88「六包」；owner-with-real-device.md:47 裸 `@ohos.net.vpn`/:60 `hvigorw assembleHap`/Day1 命令缺 typecheck:bridge；Index.ets:2 用的是正确全名 `@ohos.net.vpnExtension`（前缀陷阱实锤） |
| V9 | origin remote | git remote get-url origin | `git@github.com:feasy898/ohos-tailscale.git`（白名单以运行时真值比对，不硬编码） |
| V10 | npm test | 实跑 | 495/0；逐条 `ok N - <名>`；`# skipped/todo/cancelled` 全 0；netcheck 恰 84；test:bridge 30/0；validate:shell 66/0 |
| V11 | 导出面 | 逐包 barrel file:// 导入计数 | common 21 / crypto 26 / noise 16 / wireguard 39 / derp 15 / disco 45 / control 182 / netcheck 52 = **396**（与测轨3 实测一致；快照冻结入 holdout） |
| V12 | node --test 形态 | 实测 | 裸目录 → MODULE_NOT_FOUND；glob/显式文件列表可用；**glob 零匹配时 exit 0**（⇒ runner 必须 fail-closed 自查）；**`node --test` 给被测文件进程注入 `NODE_TEST_CONTEXT=child-v*`，子进程不剥离则其 npm test / node --test 假绿（exit 0 无 TAP 汇总）**；TAP 把用例名中的 `#` 转义为 `\#`（⇒ 用例命名避用 #） |
| V13 | win32 spawn | 实测 | `spawnSync('npm')` 不经 shell → status=null（npm 是 .cmd）；`npm run <不存在脚本>` → **exit 1**（测轨5 E11 邻项「退出码竟为 0」系管道污染误测，本合并人复正——两处独立证据都指向同一教训：退出码必须与被测进程直连） |
| V14 | 仓外可写性 | mkdir + 实跑全套 | `<HOLDOUT_DIR>` 可写、holdout runner 全套可跑（23 PASS + 4 BLOCKED + 哨兵 0 命中）——主方案落地，staging 回退未启用 |
| V15 | 其余红锚锚点 | grep/find 实测 | headscale.yaml `0.0.0.0` ×2（:3/:21 方向）；DELIVERY_REPORT:151 等 `oracle/raw` 命中；`docs/pre-device/` 不存在；`tests/` 不存在；app/tools 仅 validate-shell.mjs；scripts/ 仅 perf-baseline.mjs |
| V16 | type-strip | 实测 | node v22.23.2 上 `.mjs` 经 file:// URL 导入仓内 `.ts` 生产代码，无需 flag 即可（type stripping 默认开）——可见集与 holdout 的导入机制前提 |

## 0.2 五份思考收敛原则 → 落实索引

| 收敛原则 | 落实处 |
|---|---|
| 划分原则（定义正确的可见；验证「门没被骗」的进 holdout；规格 100% 可见，holdout 只装判别力，永不改同一份规格） | §2 可见集 / §3 holdout；tests/plan/ vs 仓外包 |
| 门三件套（正控制+负对照红在可定位标识+结构断言；只断言 exit≠0 不够——G0-5「红在 syntax error」曾被误认有约束力） | §1 矩阵「断言要点」列；tests/plan/p0-3/p0-4/gates-registry；holdout h03/h04 |
| meta 测试独立成组（不并入 npm test 的 495 口径）+ A17 判据建议 | scripts/test-plan.mjs 独立入口；§0.3 R1；裁决 U-meta |
| 门注册表 + yml 字面反向断言（ci:false 必须带非空理由） | scripts/gates.registry.json；tests/plan/gates-registry.test.mjs 六断言；holdout h08 白名单对照 |
| holdout 物理 isolation（内容出仓、fail-closed、glob 调用、绝不 import 仓内测试 helper、绝不进 package.json/CI） | 仓外包 run.mjs（无题 exit 2）；tests/plan/holdout-sentinel.test.mjs（仓内不存在性哨兵） |
| 防过拟合四件套（哨兵值泄漏检测/名冻/采样不可预知/变体生成器） | §3.3；holdout sentinels.txt、frozen-495-names.txt、--seed、h01–h07 |
| 文档一致性按「语境」不按「裸数字」（裸黑名单假阳性 46% 实测）+ 显式豁免表 + caliber 无值结构（min/eq + floor/current）+ 真值锚=跑真命令 | tests/plan/a13-a16-docs.test.mjs；§0.3 R6；holdout h05 |
| B 类两层（L1 容器结构现在机检 / L2 留证事后离线判）+ 判定树自检五断言 + env-ready「值+证据+时间戳」+ 交接防毒三段式 | §4；tests/plan/decision-trees / env-ready / handoff-antipoison |
| 测量纪律（退出码直连 / test( 计数防冲高 / canary 落地确认） | tests/plan/lib/spawn.mjs 头注；T-P0-1-e；§0.4 |

**本合并人新增的两条实测防御（V12/V13，五份轨迹均未覆盖）**：子进程环境剥离 `NODE_TEST_CONTEXT`；win32 npm/npx 经 shell 调用。已实装于两套 runner 的 helper——否则红锚会「红在 spawn 失败上」（G0-5 教训在 spawn 层的同构形态）。

## 0.3 对 PLAN 的修订建议（2026-10-03 已全部裁决；原建议文本保留作审计对照，裁决全文见 PLAN.md v1.1 §4.2）

| # | 建议 | 来源与理由 | 影响工作项 | **裁决（2026-10-03）** |
|---|---|---|---|---|
| R1 | **新增 A17 判据**：`node scripts/test-plan.mjs` 四态全清（意外红=0、未登记/失踪=0；批次四后锚点全数翻转 GREEN_OK=79） | 测轨4 §7.3：否则「我们又一次加了门，而这一次也没有任何东西在测它」 | A 类判据表 | **已批准（部分采纳——终态判据动态化）**：两段式采；「GREEN_OK=79」不写死，改为「expected.json 无 red-anchor 条目」，79 仅为当前快照参考数（expected.json 是唯一真值源）——写死 79 会让判据表成为数字漂移源（分歧裁决见 §5.1 O/R-8） |
| R2 | **三道新门必须支持可参数化被检根（`--root <dir>`）且临时副本上运行与仓内等价**（gate-d4-p4.mjs / ets-mirror-check.mjs / doc-consistency） | 测轨4 §3.2 前置约定（E6 实测 validate-shell 可搬走跑）；否则注入式 meta 只能脏改工作树（其 X9 否决项） | P0-3/P0-4/P1-3 验收各加一句 | **已批准（附加两条）**：①CI/生产调用必须用默认根（防 `--root <干净副本>` 恒绿形态）；②副本自证等价（被检面文件数+关键文件 sha256 一致）；p0-5 不在此列（它要 --out） |
| R3 | **P0-5 验收补第 4 条**：regress 支持 `--out <dir>`（或等价环境变量）指定 summary.json 落盘路径；P1-11 校验器断言 evidence 目录内 summary.json 存在且与 regress.log 同批（时间戳/阶段字段一致） | 测轨2 §10-U6 新发现（本合并人亲验 :71-74）：现归档命令只 tee stdout，「summary 原件入 evidence」在当前脚本形态下是空操作——PLAN §3.4 要求不可满足 | P0-5 / P1-11 | **已批准并升格**：批次二阻塞项；--out realpath 锚定拒越界；扩为五件套闭环（同批三件 + 同批校验具体化为 runId/startedAt 相等 + E4 四元组入 summary + E5 主机化名）；`sha256sum state/*` 死命令一并改写 |
| R4 | **P0-6 的 STAGE-CHECKLIST 必须含 S5b「随机字节快照落 evidence」步骤**，check-stage-docs 断言集加该步骤存在性 | 测轨2 §8-P1-5：P1-5 留痕钩子若无剧本步骤触发，D13 失败复现包机制空转 | P0-6 / P1-5 | **已批准（升级三配套）**：触发时机（跑前开环形缓冲非失败后补采）+ 落点与 `hdc file recv` 回传命令（断言步骤文本含回传命令）+ 与失败运行同批 |
| R5 | **P0-7 验收补「不该进的没进」**：`!evidence/` 否定规则不得击穿 secrets 段（`evidence/x/y.p12` 仍须被吞）、不得击穿 `.zcode/.mimosa/node_modules`、仓根散落 `*.log` 仍须被吞 | 测轨3 §5-P0-7①②（其 U6 未实测点由本套件 T-P0-7-c/d/e 直接机检） | P0-7 | **已批准（断言权重修正）**：修法限定式 `!evidence/`+`!evidence/**/*.log` 禁全局 `!*.log`；**T-P0-7-e 升为该组主断言**（node_modules 由目录规则吞、被排除目录内文件不可再纳入，T-P0-7-d 对全局豁免不敏感——思考员3 实测、拍板人按规则来源复核），c/d 降为回归地板 |
| R6 | **P1-3 落地物定为 `docs/pre-device/caliber.json`（无值结构）+ `scripts/doc-consistency.mjs`（消费器，支持 --docs-root）**；口径条目 `{id,cmd,extract,relation}`，relation∈{min,eq}；min 条目必须双字段 `floor`（只增不减）+`current`（现行值）；豁免表入 caliber.json 且每条带非空 reason | 测轨5 §3.1 S3 方案 + §3.4：调和 A1「≥495 只增不减」与 P1-2「写现行口径」的冲突（30≤31 时 min 不红、current 必须同步）；真值锚=跑真命令非脚本常量——防「把门改成输出期望值」 | P1-2 / P1-3 | **已批准（附三句硬约束）**：①`cmd` 必须是真命令、`current` 由门写回不许手填（升为显式断言）；②扫描面=活文档面 ∪ docs/pre-device/**（并集）；③check-stage-docs 六断言不得要求 caliber.json 存在（批次二不依赖批次四落地物）；eq 条目在 O5 叙述同步后点亮 |
| R7 | **P0-6 交付物新增 `scripts/check-decision-trees.mjs`**（判定树完备性五断言；行法规格=本档 §4.2；规格内核已在 tests/plan/lib/tree-check.mjs 实现并自带五个坏树负对照自检） | 测轨2 §2.5：树有洞=真机 agent 自由发挥=R1（环境失败误诊为代码问题）的直接入口 | P0-6 | **已批准（等价收编禁重写）**：独立脚本不并入 check-stage-docs；重写须过同等自检；覆盖树清单追加 S5b perf 触发树（O6 >50 停并升人分支） |
| R8 | **P1-2 在 P1-3 建成前验收记「暂不判定」**（一次性脚本记录清零事实，不装成门） | 测轨4 §9-6：比 PLAN 附录 B-8 更严——防「清零靠一次性 grep 自证」制造第二次假绿 | P1-2 | **已批准（一条禁令）**：T-A13/T-A16-1 红锚严禁因「暂不判定」摘除（UNKNOWN_TEST 机制自伤）；worklog 留一行含命令与输出 |
| R9 | **D4/P4 扫描面扩到 `app/bridge/src`**（现实测 0 命中，扩面无技术阻碍）；属规格变更，走 owner 批准；批前 gate:d4 实现必须显式声明检索面并在脚本头注释写明 | 测轨3 §5-P0-4②/U2：不允许「默默只扫一部分」——typecheck:bridge 不在 CI 缺口的同构复现 | P0-4 | **已批准（部分采纳——扩 app/bridge/src，拒扩全 app/）**：面声明三重化（头注释+运行时输出+h03 验证）；pattern 区分 import 形态（防 mock-localapi.ts:229 `const node:` 假红）；entry .ets 面归 validate:arkts，两门交集为空；platform/ 纪律面无机检作为已登记缺口；T-P0-4-g 同步扩段（扩规格登记后改）。思考员4「扩全 app/」案不采（今天等价、未来误报面确定非零——§5.1 O/R-9） |
| R10 | **P0-8 验收补第二档**：`ARKTS_SDK_HOME` 指向「存在但不是 SDK 目录」的路径 → 报可读错而非崩（第一档「假路径」易过，第二档才证明真做了路径校验） | 测轨4 §4-P0-8 ★；本套件 T-P0-8-b 已按第一档+崩溃类排除写，第二档留 spec | P0-8 | **已批准（行为级断言）**：不锁「什么是 SDK 目录」判据（跨版本脆弱）；:6 陈旧默认路径子例并入（一并参数化） |
| R11 | **P1-12 的 env-ready 每项为「值+证据+时间戳」三元组**（非裸 bool）；schema 为键清单形态 `{key:{type,enum?,pattern?,why}}`（无 ajv 且禁装依赖——V17/测轨2 亲验） | 测轨2 §3.2-L2 + 测轨5 §4.3：PLAN §3.4「贴原始输出而非结论」在人类配合面的落实 | P1-12 | **已批准（补两键与减负）**：新增 `s6.headscale_waiver_id`（引 O3/HS-DEV-001）与 `s6.host_pseudonym`（O7 化名）；evidence 允许「文件路径+摘要」二选一；填写列为 S4 末一次性动作；桌面演练测空填率 |
| R12 | **P2-1 验收细化**：原 8 条向量**逐条**仍绿（非只看总数 8+7）+ 注入 `..%2f` 类向量必红 + Python 视角 inbox **字节级**只含合法文件（不看返回码） | 测轨4 §4-P2-1 | P2-1 | **已批准（据实收窄为三件）**：逐条+条数钉 8/7+注入必红（变异取样优先 `%2E%2E` 大小写）；inbox 字节级 upload_server.test.mjs:187 已在盘，勿重复建设 |
| R13 | **P1-13 的 perf 源码目录（app/tools/perf/）在 D4/P4 扫描面之外属既定事实，若开显式豁免则每条必须带非空理由 + meta 断言**（否则「全仓豁免」也是绿的） | 测轨4 §4-P1-13 ★ | P1-13 | **已批准（规则级豁免 + 默认不开 + 可执行副本）**：豁免必须规则级 `{path,rule,reason,added_at,added_by}` 非路径级；EXEMPTIONS 放门内常量不进 registry；默认空集（perf 在面外是事实）；触发条件=面扩至 app/tools；与 R9 同批。另裁：app/tools/perf 不在模块 srcPath、.ets 不进 HAP——perf 须有 entry 内可执行副本，仓内目录为源码母本 |

## 0.4 测量纪律（写给所有后续执行 agent；违者测试无效）

1. **凡断言退出码，必须与被测进程直连**。管道后 `$?` 是 tail/grep 的退出码（测轨1 §0.1 自白；本档 V13 复证测轨5 的 npm 误测同源）。两套 runner 的 helper 均已 spawnSync 直取 status/stdout/stderr。
2. **test( 计数防冲高**：node --test 的 `# tests` 不数循环内断言——把循环拆成子 test 可「合法」冲高计数。对计数敏感项加「test( 计数不降」副断言（T-P0-1-e：peerapi-tun 现值 9，P0-1 后 10；`# tests` 从 30→31 只 +1 才是正确形态）。
3. **「变异没落地」与「门没约束力」输出相同**——注入式断言必须先确认 canary 落地（测轨4 E7 亲历：rm 猜错路径静默无操作，门照样 66/0「通过」）。三段式契约：①落地确认（fixture 确实在被检面）②必须红且红在**可定位标识**上（文件:行/规则名——G0-5「红在 syntax error」曾被误认有约束力）③还原后必须绿（防门被改成一恒红）。
4. **本环境三坑**（V12/V13）：node --test 裸目录不可用（用 glob/显式文件）；glob 零匹配 exit 0（runner 必须 fail-closed 自查文件数）；win32 npm/npx 是 .cmd（经 shell 调）；子进程环境剥离 NODE_TEST_CONTEXT。

## 0.5 五份测轨的采纳/修改/拒绝记录

- **测轨1（host 自动化）**：采纳其三分类法、P0-1 正控制组机理与计数口径、P0-4 一致性证明设计（yml 逐字+钉死三状态）、selftest 红→绿轨迹入 worklog、备选 1/5/6/7/8/9 全部维持否决。修改：其 U1 倾向「真检索面临时落盘」被 --root 副本方案取代（U1 裁决）；其「CI 加 G0-7 step」的 meta 落位改为本地独立入口+owner 收编（U-meta 裁决）。
- **测轨2（真机侧）**：采纳四要素法、L1/L2 两层（本档 §4 骨架）、判定树五断言与负对照内置、env-ready 三层与三向对齐、黑名单边界陷阱三条（前缀/精确串/死占位）、U6 新发现（→R3）、「丙类答案不进 A 类」纪律。修改：树行法由其「未定稿」到本档 §4.2 定稿（缩进+Q/Y/N+三元组文法）；env-ready 校验器从「定向断言函数」升为「schema 驱动」（测轨5 同判，单源原则）。
- **测轨3（holdout 原则）**：采纳唯一判据（§可见性边界）、十条防过拟合模式与防法（M1–M10 → holdout h07/h06/h08/h09 等）、变体生成四原则、S1/S2 分层思想（U2 裁决为标注式）、哨兵值检测（§3.3 第一件）、rubric 四态与 5 次执行时机、L1/L2/L3 泄露分级。修改：其 M3(c) 行前缀哈希锚以「名冻清单+映射登记」简化实现（U5）；其 U1「-a.example 应 400 是扩需求」立场采纳——h01 显式断言现行语义为放行。
- **测轨4（门禁 meta）**：采纳三段式契约（§0.4-3）、注册表设计与其三条独立断言+断言 4 holdout 化、六项「交付物是检查器」清单、mutationWitness 可执行化、E13 实测修正（interop tsc 仅 2 错——录入矩阵 P1-8 行）、fail-closed 原则。修改：其「test:meta 进 CI G0-7」被降为本地独立+owner 后收编（红锚长期红噪音，R12 同构）；其 §9-2 镜像临时产物处置并入 R2 的 --root 约定。
- **测轨5（文档口径）**：采纳 S3 无值结构路线（→R6）、46% 假阳性实测与三条边界（语境/豁免表/语义形状）、F1–F4 四类假命令检测、`npm run <不存在>` 须读键集（V13 复正其退出码结论）、差集双向性、env-ready「值+证据」二元组（本档升三元组加时间戳）。修改：其 H1「仓内分支放索引」否决（分支实测藏不住，U2）；其「validate:handoff 不进聚合」被合并进 check:stage-docs（U-handoff 裁决）。
- **跨轨迹矛盾核对**：五份间无正面冲突事实主张；六处方法论分歧（U1/U2/U3/U4/U5/U6 + 四项额外）已在 §5 逐条裁决。测轨5 的「npm run 缺失脚本 exit 0」与测轨3 的实测环境差异经本合并人复跑裁为管道污染误测（V13）——唯一一处事实层修正。
- **裁决之外的三个本合并人新增实测决定**（无轨迹分歧，纯新事实驱动，记录备考）：①子进程剥离 `NODE_TEST_CONTEXT`（V12——不剥离则嵌套 node --test 假绿，两套 helper 已实装）；②用例命名避用 `#`（TAP 转义致清单名不符，首例即 T-P0-1-f）；③DnsType.AAAA=28 非 16（h01 首版笔误经亲验纠正——「所有事实写入前抽验」纪律的自证）。

## 0.6 交付物清单（本任务新建的全部文件；既有文件零改动）

| 路径 | 用途 |
|---|---|
| docs/pre-device-plan/TESTS.md | 本档（测试主文档） |
| scripts/test-plan.mjs | 可见套件聚合 runner（四态/失败清单/exit 码语义/fail-closed） |
| scripts/gates.registry.json | 门注册表（14 门：existing 6 + planned 8；ci:false 带理由；丁类门带 mutationWitness） |
| tests/plan/README.md | 一页导览（怎么跑/文件一览） |
| tests/plan/expected.json | 79 用例预期状态清单（green 25 / red-anchor 54） |
| tests/plan/ 下 16 个 *.test.mjs | 可见测试文件（§2.1 逐文件一览；§2.6 逐用例清单） |
| tests/plan/lib/spawn.mjs | 直连执行器（V12/V13 防御实装；file:// 生产码导入；TAP 解析） |
| tests/plan/lib/handoff-scanner.mjs | 防毒扫描器（8 黑名单 + 自检样本；边界正则） |
| tests/plan/lib/tree-check.mjs | 判定树五断言（行法规范实现，R7 规格内核） |
| tests/plan/lib/env-ready-validator.mjs | env-ready 校验器（schema 驱动 + 三元组，R11 规格内核） |
| （仓外）<HOLDOUT_DIR> | holdout 包：README-owner.md、run.mjs、lib/helpers.mjs、tests/h01–h09、fixtures/frozen-495-names.txt、fixtures/frozen-exports.json、sentinels.txt（§3.6） |

**统计口径**（回应「现在的预期状态」三分类）：可见测试 **79 条 = 现在就该绿 25 + TDD 红锚 54**（runner 实测全分类正确、意外红 0、锚点错翻 0）；**规格级断言约 40 条**（§1.2 全文：P0-5 七条 selftest 断言、P0-6 六断言、P0-3 自检最小集、P1-1/P1-4/P1-5/P1-7/P1-8/P1-9/P1-10/P1-11/P1-12/P1-13/P1-14 分门 spec、P2-1/2/3）——依赖未实现物，由各工作项落地时以其分门/`--selfcheck` 形态实现后并入 A 类判据；holdout 判定内容 9 测试文件 + 2 冻结基线 + 哨兵集（仓外）。

## 0.7 权限规则（O/R-2026-10-03 拍板新增；防「开发 agent 弱化断言凑绿」）

1. **修改权限归属**：`tests/plan/**`（含 expected.json、lib/）、`scripts/test-plan.mjs`、`scripts/gates.registry.json` 的**修改权限归调度/验收侧**（owner 或其授权的调度 agent / 独立验收会话）。**开发 agent（工作项执行者）禁改上述任何文件**——包括：删锚点、改断言语义、放宽 expected.json 预期、动 registry 的 ci/reason 字段、改 runner 四态语义。
2. **红→绿翻转**：expected.json 的 red-anchor → green 迁移**由调度 agent 执行**（工作流 §2.3：核实确因实现落地、worklog 记一行后翻转）；开发 agent 只报「STALE_ANCHOR 清单」，不自行翻转。
3. **规格变更走决策**：改断言=改规格=须 owner 审（本档版本纪律）；R9 的 T-P0-4-g 扩段、R10 第二档、R2 --root 等价断言等新增断言，一律**先登记 expected.json 再落地**（UNKNOWN_TEST 闸门），登记动作由调度侧完成。
4. **holdout**：开发 agent 全程不跑不修（§3.5 既有红线不变）；本权限规则不改变 §3.4 的 holdout 修订纪律。
5. **理由**：可见测试是「定义正确」的规格面（划分第一原则）——被测方同时持笔是 G0-5「门在跑但没约束力」的人为复刻路径；A17/UNKNOWN_TEST/STALE_ANCHOR 机制的价值前提正是本条权限边界。

# 1. 测试总矩阵

状态记号：**绿**=现在就该绿（回归地板）；**红锚**=TDD 红锚（当前如实红，工作项落地后转绿并翻转 expected.json）；**spec**=依赖未实现物，本矩阵 §1.2 给出可执行级断言规格（由该工作项落地时以其分门/`--selfcheck` 形态实现）；**L1/L2**=B 类两层（§4）。实测基线：`node scripts/test-plan.mjs` → 16 文件｜GREEN_OK 25｜ANCHOR_RED_OK 54｜意外红 0｜锚点错翻 0｜未登记 0。

## 1.1 矩阵总表（25 项）

| 项 | 测试 ID（tests/plan/ 实体） | 断言要点（红=当前红锚锚点） | 状态 | 集成位 |
|---|---|---|---|---|
| **P0-1** | T-P0-1-a…f | a: typecheck:bridge exit 0（**现 exit 2**）；b: 合法 q→200 且 body 键集 {RCode,Negative,Answers}；c: 畸形 q 九项逐条 400（空 q=missing q，余=malformed q——行为零漂移）；d: 测试文件禁 `answerDns: null`/`as unknown as`/`@ts-ignore`/`@ts-nocheck`（**现含 null@:249**）；e: test( 计数=10（**现 9**）；f: yml 含 typecheck:bridge step（**现无**） | b/c 绿；a/d/e/f 红锚 | 可见 + G0-7 step（补丁） |
| **P0-2** | T-P0-2-a/b | a: packages/*/src 无 function*/yield（**现 2 命中 stun.ts:176/:190**；filterless 刻意无注释过滤器——廉价误报优于昂贵过滤器）；b: netcheck 恰 84/0 | b 绿；a 红锚 | 可见（常驻化归 P0-3 (a) 面） |
| **P0-3** | T-P0-3-a…d + 门 --selfcheck + holdout h04 | 结构三件套：script 在/**ets-mirror-check.mjs 在（现无）**/yml step 在（现无）/干净仓 exit 0；负对照=PLAN 公开 5 样本逐个红（门 --selfcheck 最小集）+ h04 变形负例与合法误报对照（形态不公开）；分层归属断言（enum 归 tsc 面 TS1294，function* 归正则面——tsc+erasableSyntaxOnly 实测抓不到 generator，测轨4 E4/E5）；stub 面差集=∅ 且 ≤15 符号；镜像产物不落盘残留 | 全红锚 | 可见 + G0-8 step + validate:arkts --selfcheck |
| **P0-4** | T-P0-4-a…g + holdout h03 | a/b/c: script+文件+干净仓 exit 0（**现全无**）；d: yml G0-5 逐字改调 `node scripts/gate-d4-p4.mjs`（**现内联块**）；e: yml 无裸 grep -rE/awk（**现有多处**）；f: 每 run 块过 bash -n（**D4 段现 exit 2**）；g: 等价 grep 三段 0 命中（现行代码面干净基线；**O/R-2026-10-03 R9：检索面=packages/*/src + app/bridge/src，落地时 T-P0-4-g 同步扩段（登记后改）**）；h03 过滤器语义变体（注释不误伤/引号形态/豁免面正确/干净绿——语义=BASELINE §9 等价 grep，具体 fixture 形态不公开）；门支持 --root（R2/R9）；pattern 区分 import 三形态（R9——防 mock-localapi.ts:229 `const node:` 假红）；第四段断言 packages 零 console./process./globalThis（O4 联动） | g 绿；余红锚 | 可见 + G0-5 替换（补丁） |
| **P0-5** | T-P0-5-a…f | a: selftest 离线 exit 0（**现 flag 不存在→跑真 regress exit 1**）；b: 无 regress-dummy-preauthkey 且有 HS_PREAUTHKEY（**现 :52 硬编码**）；c: h2c 有 CLI（**现 process.argv=0**；O2 已裁补 CLI，marker=H2C PASS）；d: 支持 --out 落盘（**现写 tmpdir**，R3——批次二阻塞判据）；e: 无 headscale exit 1（绿——环境缺失不得假绿）；f: ENV_UNREACHABLE 可归因（**现无**）；§1.2-P0-5 七断言全文（**S7 已按 O2 裁决强化为行锚**） | e 绿；余红锚 | 可见 + selftest 分支 + G0-9 step（补丁） |
| **P0-6** | T-P0-6-a…f + T-HANDOFF-a/b/c + T-TREE-a…d | a: docs/pre-device 七件套齐（**现无目录**）；b: check-stage-docs exit 0（六断言，§1.2-P0-6）；c: HARMONY_AGENT_TASK 顶部废弃指向（**现无**）；d: owner 文档三处修复（**:47 裸模块名/:60 假命令/Day1 缺 typecheck:bridge 全在**）；e: S5b 随机字节快照步骤（R4）；f: D1–D13+O1–O7 齐；HANDOFF-a: 黑名单 0 命中（**现红——实测抓出已知假命令，本身就是红锚**）；HANDOFF-b: 扫描器自检正/负对照全中（绿）；HANDOFF-c: 白名单解药在场（origin 真值/8包/495/vpnExtension/typecheck:bridge）；TREE-a/b: 五断言+好树（绿）；TREE-c/d: AGENT-TASK tree 块过五断言 + check-decision-trees.mjs 在盘（R7） | HANDOFF-b、TREE-a/b 绿；余红锚 | 可见 + check:stage-docs 门（docs-consistency job、P1-2 后阻断——U3） |
| **P0-7** | T-P0-7-a…e | a: regress.log check-ignore exit 1（**现 0 被 *.log@:27 吞**）；b: state.sha256 exit 1（不得回归侧）；c: evidence/x/y.p12 仍被吞（secrets 不击穿，R5）；d: node_modules/x.log、.zcode、.mimosa 仍被吞；e: 仓根 foo.log 仍被吞（豁免锚定 evidence/ 前缀；**O/R-2026-10-03 R5：e 升为该组主断言**——node_modules 由目录规则吞、被排除目录内文件不可再纳入，d 对全局 `!*.log` 豁免不敏感，e 是唯一鉴别器；修法限定式禁全局豁免） | b/c/d/e 绿；a 红锚 | 可见 |
| **P0-8** | T-P0-8-a/b | a: 无 SDK exit 0+SKIP+点名 ARKTS_SDK_HOME（**现 ReferenceError 崩 exit 1**）；b: 假路径报「不存在」类可读错且非 ReferenceError/SyntaxError/Cannot find module；**第二档（R10 已批准）：存在但非 SDK 目录 → 可读错非崩，行为级断言不锁判据；:6 陈旧默认路径一并参数化——落地时新增断言先登记** | 全红锚 | 可见 |
| **P1-1** | T-P1-1a/b + spec | a: packages/kat + test:kat script（**现无**）；b: kat/src 三种 node: import 形态 0 命中（`from 'node:`/`import('node:`/`require('node:`——字面 grep 会被注释误伤，测轨4 ★）；spec：≥60 例全绿无重复 id、向量模块纯常量、runKat() 可 JSON.stringify、向 kat 副本注入 function* → A6 必红（门收编真发生）、向量真实性独立对照（holdout） | 全红锚 | 可见 + test:kat 门 |
| **P1-2** | T-A13 + T-A16-1 | A13: oracle/raw 活文档面 0 命中（**现 DELIVERY_REPORT:151 等多处**）；A16-1: 旧数字语境断言 0 命中（语义形状 7 条 + 历史/增量标记豁免——**现 README 双表/HAT 六包等真命中**）；时序：P1-3 建成前「暂不判定」（R8） | 全红锚 | 可见（P1-3 点亮后门常驻） |
| **P1-3** | T-A16-2/3 + holdout h05 | caliber.json 无值结构（R6 规格，**现无**；O/R 裁决附三句硬约束：cmd 必须真命令且 current 门写回、扫描面=活文档面 ∪ docs/pre-device/**、check-stage-docs 不依赖它）；docs 门改调仓内脚本（**现 yml 内联 awk 恒空——假绿门**）；h05 扩展旧数字集（来源=仓内真实存在过的过期口径，具体选取不公开）；fail 数参与判据；`::warning` 降级禁止；注入副本逐个红（--docs-root，R2） | 全红锚 | 可见 + docs-consistency 改造（补丁） |
| **P1-4** | T-P1-4a + holdout h07 | a: vpn-config.ts 在盘（**现无**）；spec 5 用例（空 netmap/带 self/子网路由/DNS 开关/mtu 越界**抛错**——负用例）；死值锚（CGNAT `100.64.0.0/10`、ULA `fd7a:115c:a1e0::/48`、MagicDNS `100.100.100.100` 常量逐字节）；h07 生成式不变量（哨兵段输入值不相交、输出⊆输入、mtu 边界、乱序不变性）；test:bridge ≥36 | 全红锚 | 可见 + test:bridge 面 |
| **P1-5** | T-P1-5a + spec | a: platform-ports.ts 在盘且零 Date.now（**现无**；禁令配门——测轨4 ★）；spec：FixedClock 双轴分离（改挂钟不改单调钟、超时判定只走 mono）、ArrayRng 同 seed 同序列+填满 into（哨兵预填验证全覆盖）、mock-udp-bus UdpSocket 与 port 结构对齐（typecheck:bridge 面自动覆盖） | 全红锚 | 可见 + test:bridge/typecheck:bridge 面 |
| **P1-6** | T-P0-6-a/b 覆盖 + spec | spec：每卡四要素（30 分钟探针写法/二值判定/两分支预案/答案落点节名）；分支数恰 2 且每支有下一步动作（**不检内容正确性**——检内容=伪机检，测轨4 §4-P1-6）；CU7 卡含「查 SDK .d.ts」留证要求（粘贴声明原文）；CU8 接口约定文件不含实现体 | 全红锚 | 可见 + check:stage-docs 断言集 |
| **P1-7** | T-P1-7a + spec | a: integration-mirror.mjs 在盘（**现无**）；spec：--dry-run 前后 git status --porcelain 逐字相同；stdout 清单行数==镜像源文件数；含 function* 的临时源→镜像产物过 A6 必红（两工具串联）；README-app 写明「镜像过 tsc ≠ ets loader 接受」 | 全红锚 | 可见 |
| **P1-8** | T-P1-8a + spec | a: tsc listFiles interop/ ≥3（**现 0**；实测 tsc 全程约 15s）；spec：注入类型错误到 interop 文件→typecheck 报出该文件（防 @ts-nocheck 掏空面）；例外清单逐条理由；摸底数入 worklog（测轨4 E13 实测修正：三入口仅 2 错全在 derp.node.ts TS2741 stunOnly@:290/wallMs@:305——「首纳爆错」预估偏重，排序仍 P1 末） | 全红锚 | 可见 + typecheck 面 |
| **P1-9** | T-P1-9a/b/c | a: headscale.yaml 0.0.0.0=0（**现 2 处 :3/:21**）；b: device.yaml 在盘且 server_url≠127.0.0.1（方向相反断言分文件写明，防张冠李戴——测轨2 §8-P1-9）；c: env-check 无 docker 逐项 SKIP exit 0（**现无脚本**）；spec：v0.29.4 出现在可执行命令行（agent-interop-regression.md:19/:26 `<VERSION>` 死占位正是防它）；O3 未签署判「阻塞」非「红」 | 全红锚 | 可见 |
| **P1-10** | T-P1-10a + spec | a: manifest/UNRESOLVED/lineref 在盘（**现全无**）；spec：manifest path 集==upstream 快照集（**集合相等**非「都覆盖了」）；AU1–AU3 全绿 + **负例**塞 L999999 必红；UNRESOLVED 覆盖 58 份；`upstream-diff --dry-run` exit 0 | 全红锚 | 可见 + gates 收编 |
| **P1-11** | T-P1-11a + spec | a: EVIDENCE-SPEC.md + evidence-manifest.mjs 在盘（**现无**）；spec：三类缺陷样本（缺 reason/缺 marker/缺环境指纹）分别报错且文案指认类别；**合法样本 exit 0 必须被测**（只测坏样本=恒红假校验器可过，测轨4 ★）；E5 第四类（私钥/内网域名必报错）；evidence 无则显式 SKIP | 全红锚 | 可见 + interop:evidence（gates 含） |
| **P1-12** | T-ENV-d + spec | schema 在盘且过形状校验（键清单+why 非空，**现无**；O/R 裁决 R11 补两键 `s6.headscale_waiver_id`/`s6.host_pseudonym`、evidence 允许文件+摘要）；spec：OWNER-GUIDE 三栏「有形状」（人提供栏含可执行产物名/人决定栏含决策标记/通过判据栏含与脚本实际输出一致的 marker——P0-5 后校准，测轨5 §4.4）；三向对齐（判据↔schema 键↔剧本引用）；O3/O4/O5 签署态有对应确认字段 | 全红锚 | 可见 |
| **P1-13** | T-P1-13a + spec | a: app/tools/perf ≥4 源码（**现无**）；spec：ArkTS 源码过 validate:arkts；Node 参照数字只断言**记录存在**（方法学字段 iter=200/warmup=20/sink 防 DCE/3 次取中位/机型/API/温度——O6 已裁立即生效）不断言值（D12/R10：门只看格式不看值）；豁免纪律 R13（规则级、默认不开）；**O/R 裁决另裁：perf 须有 entry 内可执行副本（app/tools/perf 不在模块 srcPath、.ets 不进 HAP），仓内目录为源码母本** | 全红锚 | 可见 |
| **P1-14** | T-P1-14a + T-REG-1…6 + spec | a: gates.mjs+script 在盘（**现无**）；spec：全绿⇔exit 0 双向；人为弄红任一分门→聚合红且**指名道姓**（传播性——「红了但不知道为什么」=下一个门禁缺口复刻）；聚合集合==registry 差集空；脚本内无 `\|\| true`/process.exit(0) 兜底；每丁类门 mutationWitness 非空且实跑红 | 全红锚 | 可见 + gates 聚合 |
| **P2-1** | spec（R12 已批准，据实收窄三件） | 原 8+7 **逐条**仍绿 + 条数钉 8/7；真 HTTP server 层编码变体（百分号编码/`..%2f`/`..\`/超长/NUL；变异取样优先 `%2E%2E` 大小写混写——现 8 条覆盖最弱类）；Python 视角 inbox 字节级只含合法文件（**注：:187 已有 deepEqual 字节级判定，勿重复建设**） | 规格 | 门落地时建 |
| **P2-2** | spec | sha256 相同快照删至一份；manifest 记该 sha256；删后活文档面无悬空引用且 lineref 红（去重制造悬空=红，测轨4 ★） | 规格 | 同上 |
| **P2-3** | spec | 事实卡与 module.json5/app.json5 实际内容一致（**从配置文件读不从文档抄**）；与 README-app §3 同断言双向跑（交叉矛盾检测）；bundleName 字面与 V6 指向同一值 | 规格 | 同上 |

### A 类判据 → 测试落点对照

| 判据 | 落点 |
|---|---|
| A1 全仓测试 ≥495 | T-A1（绿：fail=0/tests≥495/pass=tests/skipped·todo·cancelled=0）+ holdout h06 名冻 + T-P0-2-b |
| A2 根类型 | T-A2（绿） |
| A3 壳类型 | T-P0-1-a（红锚）+ T-P0-1-f（CI 结构） |
| A4 bridge 运行时 | T-A4（地板 ≥30）+ P0-1（31）/P1-4/P1-5（≥36）计数联动 |
| A5 壳静态机检 | T-A5（绿：≥66/0） |
| A6 ArkTS 门 | T-P0-3-a…d + 门 --selfcheck 最小集 + holdout h04 变形矩阵 |
| A7 D4/P4 门 | T-P0-4-a…g + 门 fixture 负对照（公开 2 样本）+ holdout h03 |
| A8 selftest | T-P0-5-a…f + selftest 内置假 child 回归（§1.2-P0-5-S6） |
| A9 KAT | T-P1-1a/b + test:kat ≥60 + holdout 向量独立对照 |
| A10 聚合门 | T-P1-14a + T-REG-* + 弄红传播性 spec |
| A11 剧本自检 | T-P0-6-b + 差集对称性负例（§1.2-P0-6） |
| A12 interop 类型 | T-P1-8a + 注入鉴别力 spec |
| A13 悬空引用 | T-A13（红锚） |
| A14 证据不被吞 | T-P0-7-a…e 双向+不击穿 |
| A15 交接包存在性 | T-P0-6-a/f + T-ENV-d |
| A16 文档门 | T-A16-1/2/3 + holdout h05 |
| **A17（R1，已批准——终态判据动态化）** | `node scripts/test-plan.mjs` 四态全清；批次四后 expected.json 无 red-anchor 条目（当前快照 79 条，以 expected.json 为唯一真值源） |

## 1.2 规格级断言全文（矩阵「spec」项的可执行级展开；对应工作项落地时实现为其分门/`--selfcheck`）

### A17 判据的精确文本（R1 已批准，O/R-2026-10-03 终态判据动态化；原文已并入 PLAN §1.1 表尾）

> | A17 | meta 门自检（新） | `node scripts/test-plan.mjs` → exit 0：UNEXPECTED_RED=0 且 UNKNOWN_TEST=0 且 STALE_ANCHOR=0；批次四收口后另须 `tests/plan/expected.json` 无 red-anchor 条目（全 green，每条翻转各有一行 worklog 红→绿记录）。用例总数不写死——当前快照 79 条（25 绿+54 红锚）仅为 owner 核对参考数，以 expected.json 为唯一真值源 | 本套件落地即建（TESTS-2026-10-03）；过程态 exit 0 今日为真 |

四态与 exit 码语义（scripts/test-plan.mjs 头注释同文）：exit 0=四类问题全零（TDD 健康态与终态均满足——区别在于终态的 expected.json 已全 green）；exit 1=意外红/锚点错翻/未登记或失踪用例任一非零；exit 2=套件被掏空（tests/plan 无测试文件，fail-closed）。**owner 验收看两样**：exit 码与「green 数是否达到该批次应翻转数」（§2.7 对照表）——exit 0 但 green 数落后=工作项未收口，不是测试体系的问题。

### 各门 spec 全文（按工作项）

**P0-5 selftest 五断言 + 两条历史回归**（regress.mjs `--selftest` 分支内实现，全部离线）：
- S1 每 child 顶部 `export const USAGE` 常量，selftest 解析 `<占位符>` 计数 == regress 传参数组长度（今天红：derp 1≠2）；
- S2 每 child 源码 ≥1 处 `process.argv`（今天红：h2c=0）；
- S3 零参 spawnSync 实测（不许 stub runStage）：exit 1 且 stderr 含 `usage:`；
- S4 无 HS（`HS=http://127.0.0.1:1`）→ 阶段归类 `ENV_UNREACHABLE` 并跳过协议阶段（非崩溃）；
- S5 summary 每阶段 `{name,status,exitCode,durationMs,reason,markerSeen,stdoutTail,stderrTail}` 非缺、reason 非空；
- S6（★历史回归，测轨4）：可注入 child 列表中放「exit 0 + stdout 无 marker + 无 usage」假 child → 判 `SCRIPT_SILENT` 而非 PASS——h2c 当年原始失败形态（BASELINE §2.10 阶段 3）；「exit 0 + 打 usage」→ `SCRIPT_USAGE`；
- S7 marker 互不串：`INTEROP PASS`/`DERP INTEROP PASS`/`H2C PASS` 在代码里独立出现，derp/h2c 阶段不得被 `INTEROP PASS` 的 includes 判据串台（**O/R-2026-10-03 O2 裁决强化：阶段判据必须行锚**——register=`/^INTEROP PASS/m`、derp=`/^DERP INTEROP PASS/m`、h2c=`/^H2C PASS/m`，三 marker 互不为子串；依据=`'DERP INTEROP PASS'.includes('INTEROP PASS')===true` 实测，includes 判据会让 derp 输出伪造 register 阶段 PASS）；
- 输出逐断言标签（`S1 PASS`…）供复核 grep；红→绿轨迹（修复前全 FAIL 输出 + 修复后输出）append-only 入 worklog——门有效性的交付物证据。

**P0-6 check-stage-docs 六断言**（scripts/check-stage-docs.mjs；防毒内核=tests/plan/lib/handoff-scanner.mjs 等价收编）：
1. 标签闭包**双向**：AGENT-TASK 代码块抽出命令集 ⊆ STAGE-CHECKLIST 标签全集（高危侧：剧本让人跑没标的命令=R1 环境前置漏洞）；反向差集（冗余侧）为警告不阻断；
2. 每条命令标签 ∈ {[local],[device],[human]} 恰一；`<...>` 死占位出现在可执行命令行即红；
3. CU 卡二值分支无空占位（`待填|TODO|TBD|待定` 0 命中于 CU-CARDS.md）；分支数恰 2；
4. OWNER-GUIDE 每阶段（S0–S8 标题下）「人提供/人决定/通过判据」三小节齐备且非空壳（见 P1-12 形状 spec）；
5. 交接包内相对链接目标存在（引用的 schema/spec 文件逐一在盘）；
6. 旧数字/毒串语境断言（复用 a13-a16 与 handoff-scanner 的规则与豁免，单一规则源）；
负对照（门 --selfcheck 或内置样本）：删一条命令标签→红；留空分支占位→红；塞 [unknown] 标签→红。

**P0-3 门 --selfcheck 最小集**（PLAN 公开 5 样本逐个 exit≠0 且输出含规则名）：enum / `let x!:` / `as const` / function* / `@ts-ignore`；另加分层归属自检（enum 由 tsc 面报 TS1294、function* 由正则面报）与镜像保真自检（产物文件集==源 .ets 集减 Index）。

**P1-14 gates 聚合 spec**：逐门顺序执行+汇总 exit；弄红任一分门（临时副本，--root）→ 聚合 exit≠0 且输出含该门 id；registry 每丁类门 mutationWitness 实跑核对 exit≠0（三段式之②的可执行化）；SKIP 态门以「绿（SKIP:原因）」计但汇总单列 SKIP 数（U6 裁决）。

**P1-1 KAT 分门 spec**（packages/kat/ + npm script test:kat）：
- `npm run test:kat` 全绿且输出计数 ≥60、无重复用例 id；
- `grep -rn "node:" packages/kat/src` 的可执行形态断言（三种 import 形态 0 命中——T-P1-1b 已实体化为可见红锚）；
- 向量模块纯常量（`export const` 之外零导出——防向量被「现算」稀释死值锚定）；
- `runKat()` 返回值可 `JSON.stringify`（真机外壳留证格式的结构前提）；
- `npm run validate:arkts` (a) 面对 kat 0 命中（门收编新包）；
- meta：向 kat run.ts 的**副本**注入 `function*` → A6 必红（证明「收编」真发生而非 include 白名单）；
- holdout 侧向量真实性：独立向量源（不读 kat 的 vectors 文件——防「实现与向量同源」循环论证）。

**P1-10 manifest/lineref spec**：
- manifest 每条 `{path, source_url, fetched_at, upstream_commit|null, note}`；`upstream_commit:null` 必须带非空 note（缺 SHA 显式注明原因，不许空不许编）；
- 覆盖断言为**集合相等**：manifest path 集 == docs/upstream 快照文件集（双向差集空；只写「都覆盖了」对「多出未登记文件」是绿的）；
- 行号对拍：从 architecture.md §10.2 与 research 笔记抽 `file.go:LNNN`，断言目标行存在**且含声称符号**；负例：manifest 塞不存在行号必红；
- UNRESOLVED.md 覆盖 58 份未归档 .go（路径+被哪份笔记引用+影响哪条 AU）；P2-2 去重后：删除的快照不得留悬空引用（反向：删快照后 lineref 必红）。

**P2-1/P2-2/P2-3**（R12 与测轨4 §4 原文可执行级，择要）：
- P2-1：起真 HTTP server（非 importlib 直调），重放编码变体（`%2e%2e%2f`/`..%2f`/`%2E%2E` 大小写/`..\`/超长名/NUL）；断言 Python 视角 inbox **字节级**只含合法文件（不看返回码）；原 8 条向量逐条仍绿。
- P2-2：headscale-noise.go 与 -full.go sha256 相同→保留一份；manifest 记该 sha256；活文档面引用清零。
- P2-3：事实卡从 module.json5/app.json5 **读真值**（不从文档抄）；同一断言在事实卡与 README-app §3 双向跑（交叉矛盾检测）；bundleName 字面与 validate-shell V6 指向同一值。

# 2. 可见测试集说明

## 2.1 目录结构与用法

```
tests/plan/
  README.md                    一页导览（怎么跑/文件一览）
  expected.json                用例名→预期状态清单（green 25 / red-anchor 54）
  a-criteria.test.mjs          A1/A2/A4/A5/G0-6 现行基线地板（5 绿）
  p0-1-peerapi.test.mjs        TS2353：正控制组/零漂移/计数副断言/CI（2 绿 4 红锚）
  p0-2-generator.test.mjs      Generator grep 红锚 + netcheck 84 语义钉（1 绿 1 红）
  p0-3-arkts-gate.test.mjs     validate:arkts 结构三件套（4 红锚）
  p0-4-gate-d4-meta.test.mjs   gate:d4 抽脚本/yml 无裸 grep/bash -n/等价基线（1 绿 6 红）
  p0-5-regress-selftest.test.mjs  selftest/假 key/h2c CLI/--out/ENV_UNREACHABLE（1 绿 5 红）
  p0-6-stagedocs.test.mjs      七件套/门/废弃指向/三处修复/S5b 步骤/DECISIONS（6 红锚）
  p0-7-gitignore.test.mjs      A14 双向 + secrets/工具目录不击穿（4 绿 1 红）
  p0-8-arktscheck.test.mjs     不崩/SKIP 点名/假路径可读错（2 红锚）
  a13-a16-docs.test.mjs        A13 悬空引用 + A16 语境断言 + caliber 规格（4 红锚）
  handoff-antipoison.test.mjs  防毒三段式 + 扫描器自检（1 绿 2 红）
  decision-trees.test.mjs      判定树五断言 + 五坏树负对照 + 好树（2 绿 2 红）
  env-ready.test.mjs           env-ready 机制全真演练（3 绿 1 红）
  p1-redanchors.test.mjs       P1 落地物存在性/形态（13 红锚）
  gates-registry.test.mjs      注册表六断言（4 绿 2 红）
  holdout-sentinel.test.mjs    holdout 物理隔离哨兵（2 绿）
  lib/spawn.mjs                直连执行器（V12/V13 防御实装；file:// 生产码导入）
  lib/handoff-scanner.mjs      防毒扫描器（8 黑名单+自检样本；边界正则）
  lib/tree-check.mjs           判定树五断言（行法规范实现）
  lib/env-ready-validator.mjs  env-ready 校验器（schema 驱动+三元组）
scripts/test-plan.mjs          聚合 runner（不改 package.json，直接 node 调用）
scripts/gates.registry.json    门注册表（existing 6 + planned 8）
```

运行：`node scripts/test-plan.mjs`。四态语义：
- **GREEN_OK**：预期绿且绿（回归地板守住）；
- **ANCHOR_RED_OK**：红锚按预期红——实现前的正确状态（TDD 红锚的价值就在「如实红」：它证明断言真的在测）；
- **UNEXPECTED_RED**：预期绿却红——回归，exit 1，先修；
- **STALE_ANCHOR**：红锚意外转绿——核实确因实现落地（非删断言/改语义）后翻转 expected.json 并 worklog 记一行；否则 exit 1 强制显式化（防盲翻——锚点仍红时盲翻必以 UNEXPECTED_RED 暴露）；
- **UNKNOWN_TEST**：未登记或失踪用例——防悄悄删锚点/加测试，exit 1。
runner 自身 fail-closed：tests/plan 无 *.test.mjs 即 exit 2。

## 2.2 三个 lib 规格内核的收编关系

handoff-scanner / tree-check / env-ready-validator 是本套件自带、且已用 T-HANDOFF-b / T-TREE-a/b / T-ENV-a/b/c **自测通过**的实现（负/正对照齐——门三件套之②先施加于自身）。P0-6/P1-12 落地时收编为 scripts/check-stage-docs.mjs（防毒部分）、scripts/check-decision-trees.mjs、env-ready 校验入口：收编=等价逻辑+支持 --root 副本运行（R2）+保留同等自检；重写须过同等自检。

## 2.3 红锚工作流（给执行 agent；O/R-2026-10-03 起翻转动作归调度侧——§0.7）

1. 实现对应工作项 → `node scripts/test-plan.mjs`；
2. 对应锚点转绿（STALE_ANCHOR 列表给出）→ 核实确因实现 → **报调度/验收侧**：expected.json 该用例移入 green + worklog 一行「<测试名>：红→绿（<工作项 ID>）」（开发 agent 不自持笔——§0.7 权限规则）；
3. 全部 79 用例 GREEN_OK = 25 工作项验收面收口（A17 达成）；
4. 禁止只翻清单不动实现（锚点仍红必暴露）；禁止删锚点（UNKNOWN_TEST 拦截）；新增测试必须先登记清单（登记同样归调度侧）。

## 2.4 门注册表（scripts/gates.registry.json）

14 道门。existing 6：A1 test、A2 typecheck、A4 test:bridge、A5 validate:shell、G0-6 upload、INTEROP-REAL（ci:false：需 headscale，PLAN §5.1 自认不设门）、PERF（ci:false：perf 不设门，D12 记录制）。planned 8：A3 typecheck:bridge（P0-1）、A6 validate:arkts（P0-3）、A7 gate:d4（P0-4，ciCommand=`node scripts/gate-d4-p4.mjs`）、A8 selftest（P0-5）、A9 test:kat（P1-1）、A11 check:stage-docs（P0-6，ciAfter=P1-2）、A10 gates（ci:false：本地聚合与 CI 语义重复）、A17 plan-tests（ci:false：红锚实现前故意红，批次四后可转 true）。字段 `{id,name,script,ciCommand,ci,ciJob,status,reason,mutationWitness?,ciAfter?}`。消费方：tests/plan/gates-registry.test.mjs（六断言）、P1-14 gates.mjs（读表聚合+实跑 mutationWitness）、holdout h08（ci:false 白名单对照——白名单全集不公开）。

## 2.5 集成补丁——待应用 diff 清单（owner 批准后由执行 agent 应用；本档不代改既有文件）

**package.json scripts 增补**（现有 8 条之上）：

```json
"validate:arkts": "node app/tools/ets-mirror-check.mjs",
"gate:d4": "node scripts/gate-d4-p4.mjs",
"test:kat": "node --test packages/kat/test/*.test.ts",
"check:stage-docs": "node scripts/check-stage-docs.mjs",
"check:decision-trees": "node scripts/check-decision-trees.mjs",
"test:plan": "node scripts/test-plan.mjs",
"gates": "node scripts/gates.mjs",
"doc-consistency": "node scripts/doc-consistency.mjs"
```

**g0-gates.yml 变更**（job g0 内，npm ci 之后按依赖序）：

1. 新 step `壳类型检查`：`run: npm run typecheck:bridge`（P0-1 后）；
2. 新 step `ArkTS 双面机检`：`run: npm run validate:arkts`（P0-3 后）；
3. **G0-5 run 块整块替换**为 `run: node scripts/gate-d4-p4.mjs`（消灭 yml:83 引号 bug、:72 死过滤器、:72/:79/:85 三处 `|| true`，P0-4 后）；
4. 新 step `regress 离线自检`：`run: npm run interop:regress -- --selftest`（P0-5 后）；
5. 新 step `KAT 可移植层`：`run: npm run test:kat`（P1-1 后）；
6. docs-consistency job：run 块改为 `run: npm run doc-consistency`；P1-2 完成后追加 `run: npm run check:stage-docs`；删除内联 awk/grep（awk 恒空取值修复——fail 数参与判据）与 yml:124 `::warning` 降级；
7. 标题/注释「五门」全部更新（门数以 registry ci:true 计数为准——T-REG-6 钉住不再漂移）；
8. 自动核验：补丁应用后 T-REG-5/T-REG-6/T-P0-1-f/T-P0-3-c/T-P0-4-d/e/f/T-A16-3 应全部转绿（这就是「结构断言」三件套之③的兑现形态）。
9. step 命名用语义名不抢 G0-N 编号（编号已漂过一次——BASELINE §4.4；测轨2 §6 同判）。

**tsconfig**：不新增（tests/ 保持 .mjs 不进 tsc 面——裁决 U-tsc）。

### 2.6 完整用例清单（79 条：green 25 / red-anchor 54；与 expected.json 逐字一致——owner 审计面）

| # | 用例 | 状态 | 归属 |
|---|---|---|---|
| 1 | T-A1 npm test 全绿且计数只增不减（≥495，skipped/todo/cancelled 全 0） | 绿 | A1 |
| 2 | T-A2 npm run typecheck 根类型检查 exit 0 | 绿 | A2 |
| 3 | T-A4 npm run test:bridge 地板（≥30 且 fail 0） | 绿 | A4 |
| 4 | T-A5 npm run validate:shell 壳机检 ≥66 passed / 0 failed | 绿 | A5 |
| 5 | T-G06 upload_server 路径穿越实证 exit 0 | 绿 | G0-6 |
| 6 | T-P0-5-e 无 headscale 时 interop:regress exit 1（非 0——环境缺失不得假绿） | 绿 | P0-5 |
| 7 | T-P0-1-b 正控制组：合法 q → 200 且 body 为 {RCode,Negative,Answers} JSON（answerDns 传真函数形态） | 绿 | P0-1 |
| 8 | T-P0-1-c 行为零漂移：畸形 q 九项逐条 400（空 q=missing q，其余=malformed q，与现行逐条一致） | 绿 | P0-1 |
| 9 | T-P0-2-b netcheck 84 例语义钉（P0-2 改写后行为零漂移的地板） | 绿 | P0-2 |
| 10 | T-P0-4-g 等价 grep 0 命中：代码面 D4/P4/node: 干净（现行基线，现在就该绿） | 绿 | P0-4 |
| 11 | T-P0-7-b evidence/.../state.sha256 保持不被吞（不得回归侧，现绿） | 绿 | P0-7 |
| 12 | T-P0-7-c secrets 不被击穿：evidence/ 下 *.p12 仍被吞 | 绿 | P0-7 |
| 13 | T-P0-7-d 工具目录不被击穿：node_modules/x.log、.zcode/x、.mimosa/x 仍被吞 | 绿 | P0-7 |
| 14 | T-P0-7-e 仓根散落 foo.log 仍被吞（防 !*.log 式全局豁免） | 绿 | P0-7 |
| 15 | T-HANDOFF-b 扫描器自检：正/负对照全中（现在就该绿） | 绿 | HANDOFF-b |
| 16 | T-TREE-a 五断言对五个内置坏树各自拒绝（可定位标识）——现在就该绿 | 绿 | TREE-a |
| 17 | T-TREE-b 好树通过（防「全红即通过」的退化自检器）——现在就该绿 | 绿 | TREE-b |
| 18 | T-ENV-a 合法样本全绿放行——现在就该绿 | 绿 | ENV-a |
| 19 | T-ENV-b 缺键报键名与 why（把解释自动带给人）——现在就该绿 | 绿 | ENV-b |
| 20 | T-ENV-c 坏值/空证据/坏时间戳/枚举外逐类拦截——现在就该绿 | 绿 | ENV-c |
| 21 | T-REG-1 注册表结构合法（id/script/ci 必填；ci=false 必带非空 reason）——现在就该绿 | 绿 | REG-1 |
| 22 | T-REG-2 现有门全在 CI：∀ existing+ci=true → yml 字面含 ciCommand——现在就该绿 | 绿 | REG-2 |
| 23 | T-REG-3 CI 无漏登记：∀ yml 的 npm run X（排除 npm ci）→ X ∈ registry——TDD 红锚（规划门未入 yml 时本条仍绿；它抓的是「CI 有而注册表无」） | 绿 | REG-3 |
| 24 | T-SENTINEL-1 docs/pre-device-plan/holdout-staging/ 不存在（holdout 未回退入仓）——现在就该绿 | 绿 | SENTINEL-1 |
| 25 | T-SENTINEL-2 仓内无 holdout 判定文件（h0 前缀测试文件 / frozen-495 名单）——现在就该绿 | 绿 | SENTINEL-2 |
| 26 | T-REG-4 yml 无假绿逃逸面（continue-on-error / || true / if: false）——TDD 红锚（现值：G0-5 内联块 3 处 `|| true`，P0-4 集成补丁替换该块后转绿） | 红锚 | REG-4 |
| 27 | T-P0-1-a npm run typecheck:bridge exit 0（当前 exit 2：TS2353 @ peerapi-tun.test.ts）——TDD 红锚 | 红锚 | P0-1 |
| 28 | T-P0-1-d 禁则：peerapi-tun.test.ts 不得出现 answerDns: null / as unknown as / @ts-ignore / @ts-nocheck——TDD 红锚 | 红锚 | P0-1 |
| 29 | T-P0-1-e 计数副断言：peerapi-tun.test.ts 的 test( 计数 = 10（现值 9 + 正控制组 1）——TDD 红锚 | 红锚 | P0-1 |
| 30 | T-P0-1-f CI 结构断言：g0-gates.yml 含 typecheck:bridge step——TDD 红锚（缺口1：修完不入 CI） | 红锚 | P0-1 |
| 31 | T-P0-2-a packages/*/src 无 function*/yield（现值 2 命中：stun.ts:176/:190）——TDD 红锚 | 红锚 | P0-2 |
| 32 | T-P0-3-a package.json 含 validate:arkts script——TDD 红锚 | 红锚 | P0-3 |
| 33 | T-P0-3-b app/tools/ets-mirror-check.mjs 在盘——TDD 红锚 | 红锚 | P0-3 |
| 34 | T-P0-3-c g0-gates.yml 含 validate:arkts step——TDD 红锚 | 红锚 | P0-3 |
| 35 | T-P0-3-d 干净基线绿：npm run validate:arkts exit 0——TDD 红锚 | 红锚 | P0-3 |
| 36 | T-P0-4-a package.json 含 gate:d4 script——TDD 红锚 | 红锚 | P0-4 |
| 37 | T-P0-4-b scripts/gate-d4-p4.mjs 在盘——TDD 红锚 | 红锚 | P0-4 |
| 38 | T-P0-4-c 干净基线绿：npm run gate:d4 exit 0 且 0 命中——TDD 红锚 | 红锚 | P0-4 |
| 39 | T-P0-4-d yml G0-5 段改调 node scripts/gate-d4-p4.mjs（无裸内联 grep）——TDD 红锚 | 红锚 | P0-4 |
| 40 | T-P0-4-e yml 无裸 grep -rE / awk 机检行——TDD 红锚 | 红锚 | P0-4 |
| 41 | T-P0-4-f yml 每个 run 块过 bash -n（D4 段现值 exit 2 语法死）——TDD 红锚 | 红锚 | P0-4 |
| 42 | T-P0-5-a npm run interop:regress -- --selftest 离线 exit 0——TDD 红锚 | 红锚 | P0-5 |
| 43 | T-P0-5-b interop/ 无 regress-dummy-preauthkey 硬编码——TDD 红锚（现值：regress.mjs:52） | 红锚 | P0-5 |
| 44 | T-P0-5-c h2c.node.ts 有 CLI 入口（process.argv ≥1 处）——TDD 红锚（现值 0） | 红锚 | P0-5 |
| 45 | T-P0-5-d regress.mjs 支持 --out/<落盘路径>（summary.json 不再只写 OS tmpdir）——TDD 红锚 | 红锚 | P0-5 |
| 46 | T-P0-5-f 无 headscale 失败可归因：输出含 ENV_UNREACHABLE——TDD 红锚 | 红锚 | P0-5 |
| 47 | T-P0-6-a A15 存在性：docs/pre-device/ 七件套齐备（JSON 可解析）——TDD 红锚 | 红锚 | P0-6 |
| 48 | T-P0-6-b scripts/check-stage-docs.mjs 在盘且 exit 0——TDD 红锚 | 红锚 | P0-6 |
| 49 | T-P0-6-c HARMONY_AGENT_TASK.md 顶部有废弃指向——TDD 红锚 | 红锚 | P0-6 |
| 50 | T-P0-6-d owner-with-real-device.md 三处修复（裸 vpn 模块名/假 hvigorw/Day1 补 typecheck:bridge）——TDD 红锚 | 红锚 | P0-6 |
| 51 | T-P0-6-e STAGE-CHECKLIST 含 S5b 随机字节快照落 evidence 步骤——TDD 红锚（D13 机制防断链） | 红锚 | P0-6 |
| 52 | T-P0-6-f DECISIONS.md 覆盖 D1–D13 与 O1–O7 签署栏（可空但不得缺位）——TDD 红锚 | 红锚 | P0-6 |
| 53 | T-P0-7-a evidence/.../regress.log 不再被吞（check-ignore exit 1）——TDD 红锚（现值 0） | 红锚 | P0-7 |
| 54 | T-P0-8-a 无 SDK 时 exit 0 且输出 SKIP + 缺失变量名 ARKTS_SDK_HOME——TDD 红锚 | 红锚 | P0-8 |
| 55 | T-P0-8-b 假 SDK 路径报「路径不存在」类可读错，非 ReferenceError/SyntaxError——TDD 红锚 | 红锚 | P0-8 |
| 56 | T-A13 活文档面 oracle/raw 悬空引用 0 命中——TDD 红锚（现值：DELIVERY_REPORT 多处） | 红锚 | P1-2 |
| 57 | T-A16-1 旧数字语境断言：活文档面 0 命中——TDD 红锚（现值：README 双表/HAT 六包等多处） | 红锚 | A16-1 |
| 58 | T-A16-2 caliber.json 存在且为无值结构（min/eq + floor/current 双字段）——TDD 红锚（P1-3 落地物） | 红锚 | A16-2 |
| 59 | T-A16-3 否定断言门有鉴别力的前置：docs 门本地等价脚本存在——TDD 红锚（P1-3 落地物） | 红锚 | A16-3 |
| 60 | T-HANDOFF-a 交接面黑名单 0 命中——TDD 红锚（现值：owner 文档假 hvigorw + 裸 vpn 模块名 + HAT 死地址等） | 红锚 | HANDOFF-a |
| 61 | T-HANDOFF-c AGENT-TASK.md 白名单（解药在场）——TDD 红锚（P0-6 后生效） | 红锚 | HANDOFF-c |
| 62 | T-TREE-c AGENT-TASK.md 存在且全部 tree 块过五断言——TDD 红锚（P0-6 落地物） | 红锚 | TREE-c |
| 63 | T-TREE-d scripts/check-decision-trees.mjs 在盘（P0-6 收编为门）——TDD 红锚 | 红锚 | TREE-d |
| 64 | T-ENV-d docs/pre-device/env-ready.schema.json 在盘且过 schema 形状校验——TDD 红锚（P1-12 落地物） | 红锚 | ENV-d |
| 65 | T-P1-1a packages/kat/ 存在且 test:kat script 在——TDD 红锚 | 红锚 | P1-1 |
| 66 | T-P1-1b packages/kat/src 零 node: 导入（三种 import 形态）——TDD 红锚（vacuous-safe：目录存在先决） | 红锚 | P1-1 |
| 67 | T-P1-4a app/bridge/src/vpn-config.ts 在盘——TDD 红锚 | 红锚 | P1-4 |
| 68 | T-P1-5a app/bridge/src/platform-ports.ts 在盘且零 Date.now——TDD 红锚 | 红锚 | P1-5 |
| 69 | T-P1-7a app/tools/integration-mirror.mjs 在盘——TDD 红锚 | 红锚 | P1-7 |
| 70 | T-P1-8a A12：interop/*.ts 进 tsc 面（listFiles 覆盖 ≥3，现值 0）——TDD 红锚 | 红锚 | P1-8 |
| 71 | T-P1-9a headscale 基线面：0.0.0.0 绑定清零（现值 2 处）——TDD 红锚 | 红锚 | P1-9 |
| 72 | T-P1-9b 设备面：headscale.device.yaml 存在且 server_url 非 127.0.0.1——TDD 红锚 | 红锚 | P1-9 |
| 73 | T-P1-9c interop/env-check.mjs 存在且无 docker 逐项 SKIP exit 0——TDD 红锚 | 红锚 | P1-9 |
| 74 | T-P1-10a provenance：manifest.json + UNRESOLVED.md + 行号对拍脚本在盘——TDD 红锚 | 红锚 | P1-1 |
| 75 | T-P1-11a 证据链：EVIDENCE-SPEC.md + evidence-manifest.mjs 在盘——TDD 红锚 | 红锚 | P1-1 |
| 76 | T-P1-13a perf 四件套源码在盘（app/tools/perf/ ≥4 份）——TDD 红锚 | 红锚 | P1-1 |
| 77 | T-P1-14a gates 聚合：scripts/gates.mjs + npm script 在——TDD 红锚 | 红锚 | P1-1 |
| 78 | T-REG-5 规划门入册待入 CI：∀ planned+ci=true → yml 字面含 ciCommand——TDD 红锚（集成补丁应用后转绿） | 红锚 | REG-5 |
| 79 | T-REG-6 yml 门数注释防漂移：不再残留「五门」（实际六 step，注释陈旧）——TDD 红锚 | 红锚 | REG-6 |
## 2.7 批次 → 锚点翻转对照（owner 验收时的核对表）

| PLAN 批次 | 收口时应翻转的锚点（expected.json red-anchor → green） | 批次收口后应仍绿的地板 |
|---|---|---|
| 批次一（P0-1/2/4/7/8 + 首批集成补丁） | T-P0-1-a/d/e/f；T-P0-2-a；T-P0-4-a…f；T-P0-7-a；T-P0-8-a/b；T-REG-6（「五门」注释随补丁清理）；T-REG-5 中 typecheck:bridge 段（补丁应用即翻转） | T-A1/A2/A4/A5/G06、T-P0-1-b/c、T-P0-2-b、T-P0-4-g、T-P0-5-e、T-P0-7-b…e、T-HANDOFF-b、T-TREE-a/b、T-ENV-a/b/c、T-REG-1/2/3/4、T-SENTINEL-1/2 |
| 批次二（P0-3/5/6） | T-P0-3-a…d；T-P0-5-a/b/c/d/f；T-P0-6-a…f；T-HANDOFF-a/c；T-TREE-c/d | 同上全部 + 批次一翻转项 |
| 批次三（P1-4/5/7/9/10/11/13） | T-P1-4a；T-P1-5a；T-P1-7a；T-P1-9a/b/c；T-P1-10a；T-P1-11a；T-P1-13a | 同上累加 |
| 批次四（P1-1/2/3/6/12/8/14 + P2 + 全部补丁） | T-P1-1a/b；T-A13；T-A16-1/2/3；T-ENV-d；T-P1-8a；T-P1-14a；T-REG-5 余项（validate:arkts/gate:d4/selftest/test:kat/check:stage-docs 全入 yml） | **全部 79 条 GREEN_OK = A17 达成** |

注：若某锚点在所属批次后仍红——分门却显示绿——按 §0.4-3 三段式归因（常见形态：门建了但 CI step 没加、门对干净仓绿但负对照没红过、落地物存在但行为不符）。锚点比绿门更诚实：它断言的是「完成定义」而非「文件存在」。

**O/R-2026-10-03 增注（T-HANDOFF-a 翻转的 O7 前置耦合）**：T-HANDOFF-a 的 env-alias-premature 规则现贡献 10 处命中（全在 docs/handover/ 两文件，P0-6 修复清单之外）。该规则的处置与 owner 对 O7 的正式答复**同批执行**（答 yes→规则收窄为「仅 docs/pre-device/ 禁预写」，BLACKLIST 8→7、T-HANDOFF-b 的 ≥7 地板仍绿；答 no/换机→规则保留并清理 handover 两文件别名引用）——**不处置则批次二收口表中的 T-HANDOFF-a 永红、A17 终态不可达**（PLAN §4.2-O7 附加联动；处置动作属 §0.7 权限规则范围，由调度侧执行并 worklog 记一行理由）。

## 2.9 待执行变更清单（O/R-2026-10-03 拍板产生、需测试实体/门规格跟随的变更——**本档不动手**，按 §0.7 权限规则由调度/验收侧或对应工作项落地时执行）

| # | 变更 | 执行者 | 触发时点 | 现状 |
|---|---|---|---|---|
| 1 | T-P0-4-g 等价 grep 绿地板同步扩 `app/bridge/src` 段（R9——扩绿地板覆盖=扩规格，先登记 expected.json 再改；两端现值均 0 命中，结果不变） | 调度 agent（§0.7） | P0-4 落地时（批次一） | 待执行 |
| 2 | P0-3/P0-4 落地时各新增一条「--root 副本运行与仓内等价」可见断言（R2——先登记 expected.json） | 调度 agent | 批次一/二对应门落地时 | 待执行 |
| 3 | P0-8 落地时新增第二档断言（R10——存在但非 SDK 目录→可读错非崩，行为级；先登记） | 调度 agent | 批次一（P0-8） | 待执行 |
| 4 | P1-9 落地时给 headscale.device.yaml 加「非 0.0.0.0」负断言（O3 附加——思考员2 发现的可见面 gap；先登记） | 调度 agent | 批次三（P1-9，须 O3 已签署） | 待执行 |
| 5 | env-alias-premature 规则处置（收窄或保留+清理 handover 两文件 10 处命中）——与 owner O7 答复同批（见 §2.7 增注）；改 lib/handoff-scanner.mjs 属规格变更，worklog 记理由 | 调度 agent + owner 答复 | owner O7 答复落地时 | 待 owner |
| 6 | P1-12 落地时 env-ready schema 增 `s6.headscale_waiver_id`/`s6.host_pseudonym` 两键（R11——若同步更新 lib/env-ready-validator.mjs 的演练样本属规格变更） | 调度 agent | 批次三（P1-12） | 待执行 |
| 7 | registry A17 行 ci:false → true（R1——收编条件=批次四收口 + holdout 全 PASS 两条件与，owner 手动） | owner | 批次四后 | 待执行 |
| 8 | O4 落包执行（新文件 packages/control/src/h2c.ts + register.node.ts:36/derp.node.ts:27 两行 import 改写 + barrel 默认不动 + architecture §10.3 版本记录条目与 §10.2 AU 行 + noisehttp 矛盾注记）——挂 D2，执行 agent 按 PLAN §4.2-O4 三条约束 | 执行 agent（工作项） | 批次三末/批次四 | 待执行 |
| 9 | P0-5 落地时行锚 marker 判据 + --out + 五件套 + E4 四元组入 summary + `sha256sum state/*` 死命令改写（O2/R3——regress.mjs 实现侧） | 执行 agent（工作项） | 批次二（P0-5） | 待执行 |
| 10 | O5 落地时 AGENT-TASK/活文档面措辞按「8 包协议核心 + kat 可移植层」钉死口径书写（T-HANDOFF-c 正则零改动兼容——写错措辞会卡死批次二/四） | 执行 agent（工作项） | 批次二（P0-6）/批次四（P1-2） | 待执行 |
| 11 | holdout 侧：kat 建包后 frozen-exports.json 增列 kat 导出（O5——只增不减，396→396+kat；holdout 修订按 §3.4 纪律走 owner 批准+版本递增） | owner/holdout 维护者 | 批次四（P1-1）后 | 待执行 |
| 12 | P2-1 落地时新增逐条/条数钉断言（R12——先登记） | 调度 agent | P2 落地时 | 待执行 |

## 2.8 owner 执行剧本（这套测试最终怎么用）

一次完整的验收会话（约 30 分钟）按此走：

1. **开发 agent 报告某批次收口后**，owner 开独立会话（不复用开发会话——holdout 独立性红线）：

   ```bash
   node D:/new-workspace/ohos-tailscale/scripts/test-plan.mjs                  # 可见面：意外红必须为 0；该批次锚点应已翻转
   node <HOLDOUT_DIR>run.mjs --seed <现场任定hex>   # holdout：FAIL=0；BLOCKED 逐条核对是否属该批次预期
   ```

2. **核对锚点翻转记录**：worklog 里每条「红→绿（工作项 ID）」与 expected.json 的 green 名单一一对应；未翻转的锚点=该工作项未真正收口（哪怕分门显示绿——例如门建了但 CI step 没加，T-P0-1-f 类结构断言会钉住）。
3. **holdout 报告四查**：FAIL 逐格回溯工作项返工；BLOCKED 是否与批次表（§3.5）一致；哨兵扫描 0 命中；STATE_ID/HOLDOUT_SHA256 抄入验收记录（下次对比防「换了代码/换了题」）。
4. **五个批次各一次 + 终验一次**；终验（真机 agent 出发前）要求：可见 79 全 GREEN_OK、holdout 全 PASS 零 BLOCKED、O1–O7 人类闭合项已闭合（O1 三态回报/O3 签署/O6 触发裁决或书面豁免/O7-b 授权+c 签发——R14，PLAN v1.1 §4.2）、A1–A17 全绿。
5. **泄露处置**：哨兵命中或 holdout 内容出现在仓内 → 停止验收，按 §3.4 分级处置后重跑。
6. **日常（开发 agent 侧）**：每完成一项跑一次 test-plan；holdout 永不触碰；改 tests/plan 必须同步 expected.json（runner 对未登记/失踪用例都报错）。

# 3. holdout 机制说明（不含判定内容）

## 3.1 存放与保密

- **物理落点**：`<HOLDOUT_DIR>`（仓外 sibling；实测可写、全套可跑——V14）。不进 git、不进 package.json、不进 CI yml（防发路标，测轨3 §6.3）。
- **仓内只留两样**：本节机制说明 + `tests/plan/holdout-sentinel.test.mjs`（哨兵：staging 目录不出现、h0*/frozen-* 判定物不入仓——绿=健康；若红=泄密事故，按 §3.4 处置）。
- **诚实边界**（测轨3 §7.1 定性沿用）：开发 agent 能读盘上任何文件，「禁读」无技术强制；仓外存放防的是**无意撞见**与 **git 历史不可撤**（oracle/raw「曾存在后被剥离/从未提交」两说并存之教训），不是保险柜。真正的防线是 §3.3——即使读到也难以针对性通过（生成式输入、种子采样、值不相交原则）。
- 回退方案（仓外不可写→staging 入仓+移出指引+不存在性哨兵）**未启用**——本机仓外可写；哨兵测试常驻防「将来有人把内容放回仓内」。

## 3.2 runner 与判定形态

- 调用：`node <HOLDOUT_DIR>run.mjs --seed <验收时定> [--repo <path>]`。
- 输出首行 `STATE_ID`（sha256(HEAD + git status porcelain -uall)——验收的是哪份代码；holdout 只写临时目录不写仓内，防自污染 STATE_ID）与 `HOLDOUT_SHA256`（哪一版 holdout——防「改到绿为止」不留痕）。
- 四态报告：PASS / FAIL / BLOCKED（目标未建成或环境不可达——不计红，owner 按批次判断是否属预期状态）/ 哨兵扫描结果。报告只回「哪一格未被捕获」（门 ID+违规类别名），不回期望输出原文、不回 fixture 内容（回原文=下一轮就学会）。
- **fail-closed**：tests/ 无 *.test.mjs → exit 2（「默认绿的 holdout 比没有 holdout 更危险」——它自身的 meta 断言）。
- holdout 测试绝不 import 仓内 `*.test.ts`/测试 helper——一旦复用就继承开发 agent 的构造逻辑，变异注入/哨兵/顺序不变性全部失效（测轨3 §2.2）；只用绝对 file:// URL 导入生产代码（V16 实测）；以显式文件列表调 node --test（裸目录不可用——V12）。
- 本轮实测（2026-10-03）：h01×8/h02×8/h06×3/h08×2/h09×2 全 PASS；h03/h04/h05/h07 BLOCKED（四道目标门未建——批次一阶段的预期状态）；哨兵扫描仓内 0 命中。

## 3.3 防过拟合四件套（+ 第五件）

1. **哨兵值泄漏检测**：fixture 植入 RFC 保留文档段字面量（TEST-NET-1 `192.0.2.x` / TEST-NET-2 `198.51.100.x` 的具体取值不公开；**刻意避开 TEST-NET-3 `203.0.113.x`**——P0-6 验收 grep 明确把 `203.0.113.10` 列为须 0 命中的旧假地址，用了会让哨兵扫描与 P0-6 验收互相打架）。跑完全仓 grep（排除历史档案面 docs/baseline-audit、docs/pre-device-plan、docs/research、worklog 与 holdout 自身）：命中 → `HOLDOUT_LEAK_SUSPECTED` exit 3 触发人工复核（保留段理论上可巧合出现，故不直接判 FAIL）。未命中=反向证明可见测试里没有针对 holdout 输入的特判。**只在验收时跑**（进 CI 会被反复触发并二分出哨兵值——测轨3 否决项）。
2. **测试名清单冻结**：`fixtures/frozen-495-names.txt`（本合并人实跑冻结，V10）。h06 断言实跑名 ⊇ 冻结名单 + 总数只增不减 + `# skipped/todo/cancelled=0`（堵 test.skip/todo 绕过）。删负例/改断言凑绿由此变可机检。改名允许但须登记映射（U5 裁决）。
3. **采样不可预知**：`--seed` 验收当时才定（h07 生成式输入由确定性 PRNG 消费种子）——被验方知道「会被抽验」但不知道抽哪几条、按什么规则。
4. **变体生成器**：同语义不同输入（DNS q 等价类/STUN 属性流形态/门过滤器语义/禁则变形/旧口径扩展值）；与可见用例**值上不相交**（含 IP、掩码长度、q 名、顺序）；每条 fixture 单独跑并报「哪条让门红」（可归因——5 条违规若 4 条同规则抓、1 条没验=测了等于没测）。
5. **导出面快照**（测轨3 M9）：`fixtures/frozen-exports.json`（396 名冻结，V11）。h09 断言每包当前导出 ⊇ 冻结名单（接口冻结只增不减的可机检形态；新增只应落在 O4 h2c.ts/O5 kat 授权域）。

## 3.4 泄露失效分级与处置

- **L1 路径暴露、内容未见**（某文档提到 holdout 目录存在）→ 不失效，继续跑（本档公开路径即此级）；
- **L2 读到部分判定 fixture** → 该子集作废，变体池轮换新取值（值上不相交替换），其余保留；
- **L3 读到全部判定内容** → 整体作废重写（非打补丁），新旧集值不相交，HOLDOUT_SHA256 变更留档，旧版本失败记录保留；
- 判定泄露的机器证据：哨兵扫描命中 + HOLDOUT_SHA256 与验收记录不符。
- 修订纪律：**不许改 holdout 让它绿**——修订须 owner 批准 + 记原因 + 版本递增；「改到绿为止」的历史不可抹。

## 3.5 谁跑、何时跑（5 次，跟 PLAN §2.5 批次）

owner 或独立验收会话（**开发 agent 全程不跑**；禁止让开发 agent 预跑后针对性修补——永久破坏 holdout 独立性，流程红线，测轨4 §7.2-X13）：

| 时点 | 应然状态 |
|---|---|
| 批次一收口后（P0-1/2/4/7/8） | h01/h02/h06/h08/h09 全 PASS；h03/h04/h05/h07 仍 BLOCKED |
| 批次二收口后（P0-3/5/6） | h03/h04 转实跑且全 PASS |
| 批次三收口后（P1-4/5/7/9/10/11/13） | 维持；h07 仍 BLOCKED 属正常 |
| 批次四收口后（P1-1/2/3/6/12/8/14） | h05/h07 转实跑且全 PASS；全量 A1–A17 前 |
| 终验（真机 agent 出发前） | 全 PASS、零 BLOCKED、哨兵 0 命中 |

rubric：任一 FAIL → 批次不收口；HOLDOUT_BROKEN（fixture 加载失败/无匹配）→ 先修 holdout 且**不许开发 agent 修**；变异没被检出=测试体系失败须补测试，不许改实现迁就（测轨5 §6.4-3）；失败处置三分：实现错→回开发；holdout 越界（写了规格之外）→ owner 裁决后修订 holdout；环境不可达→BLOCKED 不计红。

## 3.6 holdout 包内容清单（机制级；判定细节不公开）

| 文件 | 类别 | 解锁批次 |
|---|---|---|
| README-owner.md | 使用/保密说明（owner 视角） | — |
| run.mjs | fail-closed runner + STATE_ID/SHA256 溯源 + 哨兵扫描 | — |
| lib/helpers.mjs | file:// 生产码导入 / BLOCKED 辅助 / 直连执行 / 种子 PRNG | — |
| tests/h01（DNS q 等价类）、h02（STUN 属性流） | 行为变体——生产码已在盘，现在就跑 | 批次一即跑 |
| tests/h03（gate:d4 过滤器语义）、h04（arkts 变形负例+合法对照） | 门鉴别力 | 批次二 |
| tests/h05（docs 门旧口径扩展值） | 门鉴别力 | 批次四 |
| tests/h06（名冻）、h09（导出面快照） | 完整性锚 | 批次一即跑 |
| tests/h07（vpn-config 生成式不变量，种子驱动） | 防写死/防特判 | 批次三 |
| tests/h08（ci:false 白名单对照） | 注册表最易绕断言 | 批次一即跑 |
| fixtures/frozen-495-names.txt、frozen-exports.json | 冻结基线（396 导出/495 名） | — |
| sentinels.txt | 哨兵字面量（仅 run.mjs 读取） | — |

## 3.7 holdout 与可见集的互不打架三纪律（测轨3 §2.4-3 的落实）

1. **检索面纪律**：holdout 的文档类断言检索面与 PLAN §0.1 活文档面逐字一致；面外命中记 `HOLDOUT_SCOPE_ERROR` 不算实现 FAIL。本仓 PLAN/BASELINE/测轨自身引用旧数字举证（「238/280/六包」等）是历史档案面豁免的现成例子——朴素全仓 grep 必把证据文档判红，两套测试的豁免面必须同源（都指向 PLAN §0.1 术语表）。
2. **禁则样本纪律**：PLAN 已公开的负对照样本（P0-3 的 5 条等）是公共知识，可见门 `--selfcheck` 用它们做最小集；holdout 变体集与公开集**值上不相交**且形态不公开（变形间距/引号/位置/干扰项）——开发 agent 面对「知道有负对照但不知道全集」的唯一稳定策略是真实现检测逻辑而非样本白名单。
3. **规格纪律**：holdout 永不改需求。holdout 红 → 先判「实现错」还是「holdout 越界写了规格之外的东西」；后者 owner 裁决后修订 holdout 并记版本，不得为绿改实现，也不得悄悄删 fixture（HOLDOUT_SHA256 变更留档使删除可发现）。

另两条运行纪律：holdout 测试文件只用绝对 file:// URL 导入生产代码（继承开发 agent 构造逻辑=鉴别力全失效）；判定输出不回期望原文（回原文=下一轮就学会）。

## 3.8 与真机侧的关系（真机 agent 出发后）

holdout 的真机侧用法（测轨2 §5.4 判定清单，owner 在真机回报后、验收签字前执行，每条对留证文件离线可判）：采样抽验（对 HARMONY_PC_REPORT 的「实测发现」按验收时才定的哈希种子抽 2–3 条，逐条要求 evidence/ 有原始输出文件且字节级含报告引用字符串）；双侧指纹一致性（S2 Node 侧与 S6 真机侧 summary 的 E4 四元组可比）；敏感边界（evidence/ 内 `preauthkey|authKey|BEGIN PRIVATE` 0 命中）；判定树走查（抽 1 条报错原文反向确认树内分支，树外报错应有升人记录）；反模式扫描（最终 diff 中 `makePeerServer(null)|as unknown as` 0 命中）。**真机侧 holdout 的保密点从「测试内容」移到「采样不可预知」**——真机 agent 能看到全部真机产物，但它不知道抽哪几条、按什么规则抽。

# 4. B 类两层测试设计

## 4.1 两层结构与纪律

- **L1 容器层（现在可机检）**：判定树完备性、剧本命令标签闭包、CU 卡二值分支、env-ready 机制演练、交接文档防毒——测「工具齐不齐、树闭不闭、格式能不能机检」。
- **L2 留证层（真机产生、本机事后离线判）**：真机答案天然以 marker 字符串/固定字段 JSON/原始输出文件落盘（evidence/ + E4 环境指纹），任何人事后不重跑真机即可裁决该步过没过。分界线（测轨2 §7）：纯文本/命令可重放的→事后验证据；依赖设备物理状态的（弹窗/hdc install/真机 perf）→只能采信带指纹的原始留证 + holdout 抽验。
- 纪律：B 类答案**绝不进 A 类完成定义**（PLAN §1.1 明文，测试侧继承）；乙类机检只防「缺件」不防「错件」——每个 L1 测试文件头标注「此断言通过≠内容正确」；真机 perf 判定=记录制（门只看格式不看值，D12/R10）。

## 4.2 判定树行法规格（P0-6 的 AGENT-TASK 写作必须遵循；tests/plan/lib/tree-check.mjs 为规范实现）

缩进 2 空格一层；节点行文法：

````text
```tree
Q <二元条件问句>
  Y → <动作或嵌套>
    动作: <做什么>（引用仓内工具须真实存在；占位符 <...> 入命令行即红）
    回报: <回报字段>
    升人: 否 | 是(D10-<①…⑥>)
  N → …（同构）
```
````

五断言：①每 Q 恰一对 Y/N 互斥出边；②每出边终于叶子三元组（动作/回报/升人）或嵌子 Q；③升人是→必须映射 D10 六条之一（编号引用）；④无悬空引用与空占位（详见/见上文/同上/待填/TODO/TBD/待定）；⑤动作行引用的 node/bash/sh/npx 目标与相对路径在仓存在（npm run 目标是脚本名不查路径；`<VERSION>` 式死占位入命令行即红——agent-interop-regression.md:19 实例）。
覆盖树清单：S3 报错处置树（含**树外报错→升人**出口——报错面在仓外不可预知，白名单门必假红/假绿）、S6 四步处置树、CU 卡二值树×5、回退倒序树（S8→S7→S6→S2→总回退=可接受终局）。自检负对照常驻（五个内置坏树——树自检器自身先被测，T-TREE-a 绿）。

## 4.3 env-ready 机制（E 类：人类配合步骤→可判定 IO）

- schema=键清单 `{"s0.sn_visible": {type:"boolean", why:"S0 判据：hdc list targets 见 SN"}, …}`——无 ajv 且禁装依赖（实测 node_modules 仅 5 包），校验器读同一 schema 驱动（单源，schema 本身即测试数据）；
- 每项**值+证据+时间戳三元组**（R11）：`{value, evidence:"hdc list targets 输出原文", at:"2026-10-03T14:00+08:00"}`——evidence 空即拦（只填结论不留证据=绿灯幻觉）；schema 外多出的键也必须带 evidence（防悄悄塞无证据项）；
- 机制级测试全真演练（T-ENV-a/b/c 现绿）：全绿放行/缺键报键名+why（把解释自动带给人）/坏值逐类拦截（类型/枚举/pattern/空证据/坏时间戳）——「人做没做」=JSON 里有没有真值，**机制的证明不需要人**；
- 三向对齐：OWNER-GUIDE 判据栏 ↔ schema 键 ↔ 剧本引用点名字面一致（防「人照 A 文档填、agent 照 B 文档查」——env-ready 要消灭的失配的元版本）；
- 剧本门位置：STAGE-CHECKLIST 的 S5 第一步命令=`node scripts/check-env-ready.mjs docs/pre-device/env-ready.json`（带 [human→local] 标签），真机回报必须含该命令原始输出；
- 诚实边界：防漏填不防填假（R1 残余）——写进 OWNER-GUIDE，不假装关掉。

## 4.4 交接文档防毒三段式

- **黑名单**（8 条，边界正则精确到陷阱级；tests/plan/lib/handoff-scanner.mjs）：
  `203.0.113.10`（TEST-NET-3 死地址）｜`git://`｜`UPLOAD-TOKEN-REDACTED`｜`hvigorw assembleHap`（**精确串**——P0-6 修法允许的 `hvigor assembleHap` 无 w 形态与 DevEco GUI 路径必须放过）｜`@ohos\.net\.vpn(?!Extension)`（**前缀陷阱**：Index.ets:2 的正确全名会被裸 pattern 误杀——实测；负向断言不可省）｜`六包`｜`238/238|238 pass|期望 238`｜`dev-env-with-gpu`（O7 owner 正式答复前不得预写 owner 环境别名——**O/R-2026-10-03 注：O7-a 已实测闭合但本规则处置仍挂 owner 答复，同批收窄/保留，见 §2.7 增注与 PLAN §4.2-O7**）。
- **白名单**（解药在场；P0-6 后生效）：真克隆地址（以 `git remote get-url origin` 运行时真值比对，**不硬编码**——remote 变更时白名单不该自杀成假阳性源）、8 包/495 现行口径、`@ohos.net.vpnExtension` 全名、Day1 含 typecheck:bridge；`makePeerServer(null)`/`as unknown as` 只允许出现在「反模式」语境。
- **扫描器自检**（T-HANDOFF-b 现绿）：正/负对照各 3 条全中（全名不误杀/无 w 不误杀/GUI 路径不误杀/假命令必中/裸模块名必中/git 协议+死地址必中）——扫描器自身先被测，再扫别人。
- 扫描面=活文档面（README/CONTEXT/TASK/DELIVERY_REPORT/HARMONY_AGENT_TASK/docs/handover/*/docs/architecture.md）+ docs/pre-device/**；历史档案面豁免——**本档与五份测轨引用毒串举证，正是豁免必要性的现成例子**。

## 4.5 S0–S8 逐阶段检查表（L1 断言面 / L2 留证物）

| 阶段 | L1（现在机检） | L2（真机留证，事后离线判） |
|---|---|---|
| S0 环境 | OWNER-GUIDE 一次性资产清单段存在；gates 复跑命令在 CHECKLIST 带 [local] | gates 全绿输出原件（真机侧机器跑）；`hdc list targets` 输出（人侧，入 env-ready.evidence） |
| S1 剧本自检 | check-stage-docs 绿；HEAD 与规划基准无未解释漂移的核对步骤存在 | 命令原始输出 |
| S2 协议自检 | selftest 绿才许上机（红=脚本没修好——CHECKLIST 写明）；linter 复扫步骤存在 | Node 侧三条 PASS 留证（S6 失败时二分「协议栈 vs 手机网络」的对照基线）；环境指纹四元组 |
| S3.0 最小探针 | 探针工程素材在仓；CU6 判定树引用工具存在 | 编译产物/报错原文；CU6 二值答案+判定依据 |
| S3 首编译 | 报错处置树五断言过（含树外出口） | `app/entry/build/*/outputs/*/*.hap` 存在性+每类报错原文+修法+git diff 清单；**预期报错，不承诺零报错** |
| S4 签名安装 | env-ready 校验命令在 S5 第一步（[human→local]）；签名方式落 DECISIONS D6 | `hdc install` exit 0 输出；env-ready.json（三元组全绿） |
| S5 冷启动 | hilog 两 tag（OhosTsIndex/OhosTsVpnExt）抓取命令在 CHECKLIST | 弹窗出现即成功的判定记录（界面文本/截图）；`create(config)` 2203002 处置分支 |
| S5b KAT+perf | KAT runner 外壳接口约定存在；随机字节快照步骤存在（R4）；perf 记录制格式 spec | runKat() 结果 JSON（可序列化）；perf 方法学字段+3 次取中位原始数；随机字节快照文件 |
| S6 注册 | 四步处置树按序；D1 路径 A 结论在 AGENT-TASK 首章；D3 陷阱在树内 | `headscale nodes list` 输出；首个 MapResponse 与 100.64.0.0/10 地址证据；PROTOCOL_REJECT 时严禁改脚本凑 PASS（违反作废全批） |
| S7 DERP | 判据=ServerKey→ClientInfo→ServerInfo+Ping/Pong；STUN 全败可退化直连（非致命） | marker 与原始帧交换记录 |
| S8 数据面 | 三层逐级判定写入 CHECKLIST（②过③不过=PacketFilter 二期，不算剧本失败） | ①netmap peer 非空 ②对端 RecvPacket 载荷 ③echo 返回——各层原始输出 |

回报格式固定字段（每阶段）：阶段号｜通过/未通过｜判据原文｜命令与完整原始输出｜hilog 片段｜截图/界面文本｜触碰的决策点｜新发现分叉｜遗留项——**贴原始输出而非结论**（防绿灯幻觉，PLAN §3.4）。

## 4.6 证据规范与校验器规格（P1-11 落地物）

E1 死值锚定（独立副本常量+逐字节断言；范例 derp/client.test.ts MeshKey 处理）｜E2 来源可追（协议语义断言指 docs/upstream/ file:line 或 evidence/<批次>/ 文件）｜E3 结论分级（复用 BASELINE §0 五级）｜E4 环境指纹（headscale tag+digest、node 版本、脚本 git sha、时间戳）｜E5 敏感边界（私钥/凭据/内网域名不入仓，公钥前缀+哈希）｜E6 可重跑性（做不到标 ran=false 诚实降级）。校验器三类缺陷样本分别报错（缺 reason/缺 marker/缺环境指纹，文案指认类别）+ 合法样本 exit 0 必须被测 + E5 第四类。holy grail：summary.json 原件入 evidence（R3——当前 tmpdir 断点修复后才可满足）。

## 4.7 升人触发六条与判定树/D10 的映射（L1 断言面）

PLAN §3.3 升人触发（写死）：①需改 SDK 安装目录②需华为账号/证书/设备解锁③需动 D3 红线边界④需改 8 包导出⑤连续 2 次无进展⑥任何 BundleName/签名变更。判定树的「升人: 是(D10-①…⑥)」叶子必须引用此编号体系（tree-check 第③断言强制）——映射样例：S3 `type:vpn` 不识别→是(D10-①)；S4 签名方式变更→是(D10-⑥)；S6 preauthkey 401/403 连续两次→是(D10-⑤)；需改 headscale.yaml 基线→是(D10-③)。**六条之外的新升人理由=树外行为**，验收时按「违树自走」降级该批证据（测轨2 §5.4-4）。

# 5. 裁决附录（分歧逐条）

| # | 分歧 | 各方 | 裁决 | 理由 |
|---|---|---|---|---|
| U1 | gate:d4 负对照 fixture 注入方式 | 测轨1 倾向真检索面临时落盘+git status 防残留（其备选 B）；测轨4 主张临时目录副本+--root（E6 实测 validate-shell 可搬走跑） | **--root 临时副本为主**（R2），真检索面临时落盘降为 holdout 可选手法 | Windows 文件锁使「落盘→删除」残留率非零；副本等价性由 R2 前置约定保证；git status 防残留保留为人工复核路径。测轨4 X9 三理由（禁改既有文件纪律/CI 并发脏树/checkout 掩盖责任）全部成立 |
| U2 | holdout 宿主 | 测轨3：仓外目录（C）+双层 S1/S2；测轨2：owner 手持（其 U3）；测轨5：H2 仓外+H1 仓内分支索引兜底 | **仓外目录（实测落地）**；S1/S2 双层**采纳为内容组织原则但不作物理分层**（同目录+文件头标注） | 本机无网（私有 repo 不可达）；分支/gitignore 实测藏不住（git branch -a 直列、gitignore 非访问控制）；S1/S2 物理分层的收益只在 L2 级泄露的损失分摊，标注可替代且省 owner 维护成本 |
| U3 | check:stage-docs 的 CI 落位与 P1-2 批次交叠防爆红 | 测轨1 U3：入 docs-consistency job 且 P1-2 后启用 | **入 docs-consistency job，ciAfter=P1-2**（registry 已登记）；本地先行（P0-6 交付即可跑，不阻断） | 放 g0 会阻塞双平台矩阵（R12 爆红教训）；「本地先跑、CI 后阻断」与测轨5「两个独立 script 拆生效点」同构；owner 无需额外动作——registry 的 ciAfter 字段即执行契约 |
| U4 | 历史档案段旧数字豁免边界 | 测轨5：DELIVERY 历史对比表/CONTEXT 时序链误伤 46%，须语境规则+豁免表；是否强制行内「（历史值）」标注未定 | **语境断言（当前态标记 ∧ 非历史/增量标记）+ 豁免表入 caliber.json（每条 reason）**；不强制行内标注 | `54→66（+12）` 类正面历史记录被逼删=与「证据不被吞」精神直接冲突；豁免表集中可审可改；行内标注在 P1-2 制造大规模 diff 噪音且仍是人造物 |
| U5 | 测试名冻结严格度 | 测轨3 U5：倾向允许改名但一一映射；死守原名阻塞合理整理 | **允许改名，须登记映射**：h06 报失踪名清单，owner/执行 agent 核对后在 frozen 名单尾补 `→ 新名` 行 | 冻结目的是抓「删负例」非抓改名；映射登记保留抓取力同时放行整理；未登记改名=红（防改名掩盖删除） |
| U6 | SKIP 态门在聚合门的降权 | 测轨1 U6：arkts-check 缺 SDK 时 exit 0+SKIP 是否降权标注 | **聚合输出契约：SKIP 态门以「绿（SKIP:原因）」计入、汇总行单列 SKIP 数；SKIP 必须 stdout 显式（静默 SKIP=门没跑成=红）** | 「绿但可见」折中：缺 SDK 是本机常态不应阻断；owner 扫汇总即知哪门没真跑；registry mutationWitness 另行钉住其负对照曾红过（门有牙齿的证据不因 SKIP 失效） |
| U-tsc | tests/ 面是否纳入 tsc | 测轨4 §5 倾向 (a) 保持 .mjs 不纳入 | **不纳入** | meta 价值在红绿不在类型；纳入=新增一门而新门又需 meta 测试（无限回归）；.mjs+node --check 已够语法防线 |
| U-meta | meta 测试独立 CI step vs 并入 npm test | 测轨4 §3.6：独立 step G0-7 进 CI（X5 否决并入 npm test） | **独立入口 `node scripts/test-plan.mjs`（补丁别名 test:plan）；不进 CI（registry ci:false 带理由）；批次四后 owner 可转 true** | 独立入口与 X5 同判（495 口径不混）；但比测轨4 更退半步——红锚在实现前**故意红**，进 PR 门=长期红噪音（R12 同构），开发期本地跑+owner 收编是唯一不制造噪音的形态 |
| U-d4face | D4/P4 扫描面是否扩 app/bridge/src | 测轨3 U2：现 0 命中、扩面无技术阻碍但超 PLAN P0-4 原文，需 owner 定调 | **建议扩面（R9）列修订建议；批前 gate:d4 必须显式声明检索面并写脚本头注释——「默默只扫一部分」不允许** | 扩面零成本；测试反对的不是「只扫 packages」而是沉默的缩小（typecheck:bridge 缺口同构）；holdout h03 会验证声明面与实际面一致 |
| U-handoff | validate:handoff 是否进 gates 聚合 | 测轨5：不进（marker/路径随 P0-5 演进，频繁红养成忽略习惯） | **防毒黑名单并入 check:stage-docs（进聚合）；依赖 marker 的白名单部分放验收侧不进门** | 黑名单是静态毒串（来自历史文档，修完即稳定，不随实现演进）——测轨5 担心的「频繁红」只适用于 marker 相关断言，拆开放置两全 |
| U-mut | 变异检测推广到全部 A 类门 | 测轨5 §8-1：只有 4 个 P0 门有负对照应推广；测轨4 §3.4：受控 fixture 矩阵（门×违规类别） | **推广到全部丁类门（交付物是检查器的六项：P0-3/4/5、P1-3/8/14）+ validate:shell 补结构断言③**；registry 每丁类门带非空 mutationWitness、gates.mjs 实跑核对 | 「跑通了」对检查器无验收意义，「注入违规它会红且红在可定位标识」才是验收；非检查器门（P0-7/P0-8 等）以可见红锚+三段式覆盖，不强加 fixture 矩阵（避免为矩阵而矩阵） |

## 5.1 O/R 拍板裁决（2026-10-03；拍板人 GLM53，owner 授权代拍，五份决策思考轨迹为输入，记录全文见 PLAN.md v1.1 §4.2）

五方对 20 项的倾向高度收敛（O2/O5/R1–R13 全部同向）；以下只记**存在实质分歧或需要拍板人加权**之处的裁决与理由，其余项按收敛倾向照准：

| # | 分歧点 | 各方 | 裁决 | 理由 |
|---|---|---|---|---|
| O/R-1 | O1 推定口径 | 思考员4：三句表述（整 step 恒红/P4+node: 真跑且绿/D4 段从未执行）；思考员5：单句「从未绿过」；BASELINE：两句并写 | **采三句**（思考员4） | bash 逐条解析实测（思考员4 C10、思考员5 V2 独立复现）推翻「整块从未执行」的可能误读；推定过宽会让 P0-4 修完只验 D4 段、P4/node: 两段被静默降级为无人复核——净损失 |
| O/R-2 | O2 marker 判据形态 | 五方均倾向补 CLI；思考员4 独补「行锚」硬约束（实测 `'DERP INTEROP PASS'.includes('INTEROP PASS')===true`） | **补 CLI + 行锚** | 拍板人本地复验子串包含为真——includes 判据会让 derp 输出伪造 register PASS，属「产出伪造 PASS 证据」级风险（本仓最贵错误类）；行锚是零依赖唯一防线。S7 规格已强化（§1.2） |
| O/R-3 | O3 豁免边界 | 思考员1：字段白名单必须含 STUN/DERP 端口+绑 LAN IP 默认；思考员2：监听边界收窄句+device.yaml 负断言；思考员3：四要素+到期/撤销+基线同批归位；思考员4：四元组机器可判 | **全部合并**（互不冲突，取并集成 HS-DEV-001） | 各方从风险后果/测试面/契约面/证据链四个正交视角给条款，无一条可删：漏 STUN/DERP 则 S7 物理断线、无失效条件则先例漏洞、基线不归位则红线从未守住、无负断言则可见面有 gap |
| O/R-4 | O4 落包约束 | 思考员1：三条执行约束（TextEncoder/tuple/矛盾注记）+「P0-3 禁则集 0 命中」事实；思考员5：CLI 不进包（V8：tsc 拦不住 process）+barrel 不加导出；思考员4：CLI 分离+第四段门断言；PLAN v1.0：成本低于预估 | **全部合并**；v1.0「成本低估」表述被思考员1 实测推翻并采信（拍板人复验 5 处 TextEncoder/1 处 tuple/0 命中三项吻合） | 落包本身五方同向；分歧只在防护面——tsc 在 `types:["node"]` 下拦不住 process 是「本机全绿、真机首日崩」定时炸弹（思考员5 V8 硬事实），第四段门断言是唯一机检防线 |
| O/R-5 | O5 措辞策略 | 思考员2：钉死「8 包协议核心+kat」使 T-HANDOFF-c 零改动；思考员3：强制改 architecture.md:10/TASK.md:10 两处叙述；思考员4：三处同步义务 | **合并**：措辞钉死 + 全部 8 处落点同步（思考员5 V14 实测 8 处，比思考员3 的 2 处更全） | 改断言是不必要的规格变更；不改叙述则 P1-3 门一开即红——两条都要 |
| O/R-6 | O6 指令落位 | 思考员5：写 STAGE-CHECKLIST 不扩 D10 编号（tree-check 第③断言按编号校验）；思考员1/3：评审顺序写死防跳步 | **采思考员5 落位 + 思考员1/3 顺序**，并追加 perf 触发树（R7 联动） | 编号集扩容会破坏既有判定树断言的闭合性；无树的指令=真机 agent 自由发挥（R1 形态） |
| O/R-7 | O7 拆分 | 思考员4：拆三项+实测闭合 a；思考员1/2/3/5：O7 整体必须人类 | **采拆分**（思考员4） | 「别名有效性」是可实测的观测事实（C7/C8 已闭合，B8 据此减负）；「拉镜像授权」与「preauthkey 签发」才是授权行为——混为一项会导致拿到「是」仍不知批准了什么（假闭合）。附 env-alias 规则同批处置（思考员2 耦合论证，§2.7 增注） |
| O/R-8 | R1 终态判据 | 测轨4/思考员2/5：写死 79；思考员4：expected.json 无 red-anchor 动态判据 | **采动态**（思考员4） | 本仓的病是数字漂移（BASELINE §6 八处）；写死 79 使 A 类判据表成为新的手工同步数字——门自己制造它要抓的病；UNKNOWN_TEST=0 + expected.json 已保证总数完整性 |
| O/R-9 | R9 扩面边界 | 思考员1/2/3/5：扩 app/bridge/src、拒全 app/；思考员4：扩全 app/（今天与 bridge/src 等价——C9：app/ 全域 node: 8 命中全在 *.test.ts 被现有过滤器排除） | **扩 app/bridge/src，拒全 app/** | 思考员4 自陈「今天等价」恰恰证伪其当期收益：perf 源码计时必撞 P4、entry platform/ 按设计用宿主 API——扩全 app/ 的未来误报面确定非零，且强制立即引入豁免机制，违背「先定 pattern 再谈豁免」的 R13 顺序；bridge/src 是壳↔库唯一活动面且现值 0 命中，收益全部保留 |
| O/R-10 | R13 豁免机制 | 思考员1：面声明式默认不开豁免；思考员4：规则级豁免（非路径级）+与面声明同处同打印 | **合并**：默认不开（面外是事实）+ 未来启用时必须规则级 | 两者不冲突——「不开」回答今天，「规则级」回答启用日；路径级豁免一次性关掉该路径所有规则，为「测性能」开出 D4 盲区 |
| O/R-11 | R5 断言权重 | TESTS 原案：c/d/e 并列；思考员3：T-P0-7-d 对全局豁免不敏感（node_modules 由目录规则吞），e 才是主断言 | **采思考员3**（拍板人按 .gitignore:2/:27 规则来源复核：被排除目录内文件不可再纳入，git 语义确证） | 断言权重错置会让「反向判据」在最危险的滥用形态上恰好失明——形式齐全、鉴别力空转 |
| O/R-12 | R3 闭环范围 | TESTS 原案：--out + 同批校验两件；思考员4：五件套（同批三件+校验具体化+E4 入 summary+E5 化名） | **采五件套**（思考员4） | 只做 --out 不收口=「目录里有 log 与 json 但互不印证，比没有更危险」；E4 入 summary 顺带解决 §3.8 双侧指纹可比的前提 |
| O/R-13 | R10 判据层级 | 思考员1：行为级断言不锁 SDK 判据；思考员4：三子例（含陈旧默认路径） | **合并**：两档+行为级+陈旧默认路径子例并入 | 判据形态本机无 SDK 不可实证（V-无盘），锁死即脆弱；陈旧默认路径会让第一档测试误以为覆盖了它 |

# 6. 速查卡（谁、何时、跑什么、看什么）

| 角色 | 时机 | 命令 | 看什么 |
|---|---|---|---|
| 开发 agent | 每完成一个工作项 | `node scripts/test-plan.mjs` | 意外红=0；本项锚点转绿后**报调度侧**翻转 expected.json+worklog 记录（§0.7，不自改） |
| 开发 agent | 每批次收口 | 同上 + 该批次相关分门（批次四起 `npm run gates`） | §2.7 对照表的该批次锚点全翻转 |
| CI | push/PR（集成补丁应用后） | g0 六 step + 新 step + docs-consistency | step 全绿；registry ci:true 与 yml 字面一致（T-REG-2/3 常驻） |
| owner/独立验收会话 | 每批次收口后（共 5 次） | `node …/test-plan.mjs` + `node …/<HOLDOUT_DIR>/run.mjs --seed <现场定>` | 可见意外红=0、锚点翻转与 worklog 一致；holdout FAIL=0、BLOCKED 符合批次表、哨兵 0 命中；STATE_ID/SHA256 留档 |
| owner | 真机 agent 回报后 | holdout 真机侧判定清单（§3.8） | 采样抽验字节级命中、指纹可比、无敏感泄漏、树内走查、反模式 0 命中 |

**术语**：红锚=TDD 式「实现前故意红、落地后转绿」的验收断言（§1）；三件套=正控制+负对照红在可定位标识+结构断言（§0.4-3）；丁类门=交付物是检查器的工作项（P0-3/4/5、P1-3/8/14）——对它们「跑通了」不构成验收（§5 U-mut）；S1/S2（holdout 语境）=泄露不致命的结构断言层/泄露即失效的行为判别层（§5 U2）；L1/L2（B 类语境）=容器结构现在机检/留证事后离线判（§4.1）；活文档面/历史档案面=PLAN §0.1 术语表。

**三个最常见的失败形态与对策**（本仓史实）：门存在但 CI 不跑（缺口#1→注册表+结构断言）；门在跑但没约束力（G0-5 语法死→三段式+mutationWitness）；文档声称与实测漂移（§6 八处→caliber 无值结构+语境断言+否定断言门）。本测试体系的全部设计，都是这三条的反构造。

**终态定义**（何时算「测试体系本身完工」）：①可见 79 用例全 GREEN_OK 且 expected.json 全 green（A17）；②holdout 全 PASS 零 BLOCKED 且哨兵 0 命中（批次四后与终验两次）；③O1–O7 已递交 owner（R14——测试体系不替代人类拍板）；④集成补丁全部应用、registry ci:true 与 yml 字面一致、T-REG 全绿。四条齐备后，真机 agent 拿到的仓库即 PLAN §3.1 承诺的「A 类全绿态」，且这个「绿」有约束力证据链（每道门都被证明过会红）。

**本档自身的局限（诚实声明）**：①红锚断言的是「完成定义」的机检面，不替代 code review 对实现质量的判断；②holdout 保密是概率性防御（L3 泄露即作废重写），非密码学保证；③B 类（真机答案）本档只交付容器与判定规则，答案本身仍属 S 剧本与人类配合；④测轨与 PLAN 已公开的部分禁则/旧值 dev agent 可自行读到——holdout 判别力建立在「具体选取与形态」的保密上，若 owner 认为这层保密不值得维护，可降级为纯验收回归集（机制不变，防过拟合价值减半，须 owner 明示决定并记录）。

---

## 版本与变更

- **TESTS-2026-10-03（初版）**：五份测轨收敛成文；可见套件 79 用例（25 绿 + 54 红锚）+ 规格 40 条 + holdout 9 文件；基线 STATE_ID 见 §3.2 实测记录，HOLDOUT_SHA256=e0d405ab…（首版，后续修订须 owner 批准+版本递增+变更留档）。
- **v1.1（2026-10-03，O/R 拍板裁决）**：owner 授权拍板人（GLM53）裁决 R1–R13 与 PLAN O1–O7 共 20 项；§0.3 逐条标注裁决结果（原建议文本保留作审计对照）、§1/§1.2 更新判定口径（T-P0-4 行扩面、T-P0-5 行锚、T-P0-7-e 主断言、A17 动态终态、P0-8 第二档、P1-3 三句硬约束、P1-12 两键、P1-13 可执行副本、P2-1 收窄三件）、新增 §0.7 权限规则与 §2.9 待执行变更清单、§2.7 增 O7/env-alias 耦合注、§5.1 记 13 条五方分歧裁决。**测试实体零改动**（12 条待执行变更见 §2.9）。
- 后续修订纪律：本档与 tests/plan/ 同步修订（改断言=改规格=过 owner 审）；**expected.json 的 green/red 迁移与 tests/plan、registry 的修改按 §0.7 权限规则由调度/验收侧执行**（开发 agent 禁改，防弱化断言）；holdout 侧任何修订按 §3.4；2026-10-03 起 R1–R13 裁决已并入 PLAN.md v1.1（该日授权记录见 §0 本档性质条），此后规格修订回归「owner 审」常态。
- 首版实测留档：`node scripts/test-plan.mjs` → 16 文件｜GREEN_OK 25｜ANCHOR_RED_OK 54｜意外红 0｜锚点错翻 0｜未登记 0（exit 0）；holdout 首跑 → h01×8/h02×8/h06×3/h08×2/h09×2 PASS、h03/h04/h05/h07 BLOCKED（批次一阶段的预期状态）、哨兵 0 命中（exit 0）。

*写作纪律：每个写入的事实先亲验（§0.1，V1–V16）；红锚必须如实红、绿项必须真绿（本轮实测 25 绿 + 54 红锚全分类正确、0 意外）；holdout 判定内容零入仓（哨兵测试在岗）；本档与 PLAN 的边界——2026-10-03 拍板授权已解除「不代改 PLAN」限制并留档，常态边界为：测试实体与判定内容的修改权限按 §0.7 归调度/验收侧。*
