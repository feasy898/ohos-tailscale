# 决策思考轨迹：20 项待决项 × 测试体系自洽（thinking-decision-glm53flash-2）

- **成文**：2026-10-03。思考员：glm53flash-2（五分之一，专属主轴=拍板与既有测试体系的一致性）。
- **方法**：通读 PLAN.md（§4 拍板点、附录 B）、TESTS.md（§0.3 R1–R13、§1 矩阵、§2.6/2.7、§4、§5 裁决）、BASELINE.md 全文；逐文件读 tests/plan/ 16 文件中的 10 个关键文件与 lib/handoff-scanner.mjs、scripts/test-plan.mjs、scripts/gates.registry.json、interop/regress.mjs、h2c.node.ts、g0-gates.yml、package.json、TASK.md D-1 段。
- **本会话亲验**（全部本机实跑）：
  1. `node scripts/test-plan.mjs` → 16 文件｜GREEN_OK 25｜ANCHOR_RED_OK 54｜意外红 0｜STALE_ANCHOR 0｜UNKNOWN_TEST 0——与 TESTS.md §1 声明基线逐字一致，测试体系当前健康。
  2. `node -e` 调 lib/handoff-scanner.mjs 全扫描面计数 → 黑名单命中 30 条：env-alias-premature（dev-env-with-gpu）**10 条**、六包 8、238 类 4、死地址 3、hvigorw 2、git://、token、裸 vpn 各 1——**别名规则占三分之一且全在 docs/handover/ 两文件**（agent-interop-regression.md 8 + handover/README.md 2）。
  3. R9 前提亲验：对 app/bridge/src 跑 P4（`grep -rEn 'Date\.now|Math\.random'` 过注释）、node: 导入、fetch/XHR/WebSocket、完整 D4 内建模块导入四条 grep → 全部 0 命中（exit 1）——「扩面无技术阻碍」在我这里复核为真。
- **纪律披露**：未读 docs/pre-device-plan/thinking-* 任何文件（含历轮思考轨迹）；全仓 grep `dev-env-with-gpu` 时副产物匹配到两份轨迹的行，未采信、判断不依赖它们。未跑仓外 holdout（TESTS.md §3.5：holdout 只在 owner/独立验收会话跑，我以 TESTS.md §3.2 记录的首跑结果为准）。未改任何既有文件。
- **写作约定**：每项给【选项】【证据约束】【倾向与推理链】【反方最强】【拍错后果】【可代拍性与连锁】。连锁=该项拍板后 tests/plan/ 红锚/绿地板、expected.json、gates.registry.json、TESTS.md 矩阵行、PLAN 批次表哪些东西必须跟着动。

---

## O1 远端 GitHub Actions 状态确认

- 【选项】a. owner 亲自开 Actions 页回报；b. agent 用 gh/API 代查；c. 不确认，维持「本地推定一直红」口径。
- 【证据约束】BASELINE §7「CI 远端不可查：无 gh CLI、无网络」；PLAN 附录 B-2 裁「owner 确认=P0 人类项」；PLAN §4.2-O1 排序约束「须在 P0-4 合入后进行」。
- 【倾向】a，且严格排在 P0-4 合入之后。先让它绿再去看它绿没绿，否则分不清旧红新红（B-2 原文）。
- 【反方】「等 P0-4 合入」可能拖延数日，O1 结论（门禁是否曾有约束力）其实现在就能看。驳：现在看只能确认「G0-5 一直红/从未运行」，无法确认「修好后能绿」——而后者才是 R3 风险（新回归被当作本来就红）的闭合条件。
- 【拍错后果】低（O1 本身不动任何代码）；但跳过它则 R3 缓解失效，远端长期红可能被 team 默许。
- 【可代拍】**否，物理必须人类**：需要网络 + GitHub 页面访问 + 仓库 owner 身份。测试面连锁：**零断言变化**——T-P0-6-f 只要求 DECISIONS.md 有 O1 签署栏存在（p0-6-stagedocs.test.mjs:50），签署态可空；registry 无 O1 相关门。拍板记录条件：回报「51b70c3 之后 G0 run 红绿/从未运行」三选一原文；重审触发：若回报「从未运行」→ 触发 yml 触发器/push 权限排查（新的 P0 级事项）。

## O2 regress 阶段 3（h2c）处置：补 CLI vs 删阶段

- 【选项】a. 补 h2c CLI（PLAN 建议）；b. 删阶段 3（=改 TASK.md D-1 契约）；c. 维持现状（regress 永败）——c 已被 P0-5 整体否定，不成立。
- 【证据约束】TASK.md D-1 原文「register/h2c/derp 全部 exit 0」（TASK.md §2.4-D-1，PLAN 附录 B-3 亲验引用）；h2c.node.ts 现 process.argv=0（亲读）；**测试面不对称是本视角的决定性证据**：
  - 补 CLI（a）→ T-P0-5-c（`p0-5-regress-selftest.test.mjs:20-24`，断言 h2c.node.ts process.argv≥1）可翻转；selftest S2（每 child ≥1 处 process.argv）、S7（H2C PASS marker 独立在岗）、registry A8 行、TASK.md D-1、TESTS.md 矩阵 P0-5 行**全部零改动**。
  - 删阶段（b）→ T-P0-5-c **永久不可翻转**（h2c.node.ts 保持纯模块，断言对象消失，红锚死锁在 expected.json 里），必须重写该断言为反向（「regress stages 不含 h2c」）=改断言=改规格=owner 审+TESTS.md 版本递增（TESTS.md 版本纪律）；同时 S2/S7、expected.json 44 行、TESTS.md §1.2 五断言、PLAN P0-5 子项 2、TASK.md D-1、批次二收口表七处连锁修改。
- 【倾向】a（置信高）。删阶段的唯一收益是省一个 S 级 CLI；代价是把一个已经实体化进红锚的判据连根改写。
- 【反方】「h2c 链路已在 derp:200/register:228 实例化，阶段 3 冗余」（轨迹3 立场）。驳：冗余性是结构判断，「独立 marker 才可归因」是运行判断——BASELINE §2.10 阶段 3 的原始失败形态（exit 0 + 零输出被静默判负）恰恰证明没有独立探针就看不见 h2c 层的死活。
- 【拍错后果】选 b：批次二 T-P0-5-c 卡死 → test-plan 永远 exit 1（锚点不翻）→ A17 终态（79/79）不可达；且 D-1 契约变更在真机 agent 眼里是「验收标准中途缩水」。
- 【可代拍】**是**。属技术-证据问题非偏好问题（PLAN 附录 B-3 已给建议）。拍板记录条件：「O2=补 CLI；h2c 阶段保留；marker=H2C PASS；TASK.md D-1 不动」；重审触发：P0-5 执行中若 CLI 实现被迫引入 packages/ 内代码改动（触 8 包冻结）或规模超 M——届时回本项重裁。

## O3 headscale.device.yaml 红线豁免

- 【选项】a. 书面豁免（仅设备侧、仅本任务，基线 yaml 同步修回 127.0.0.1）；b. 不豁免；c. 豁免但连基线 yaml 一起放开（违 D3）。
- 【证据约束】D3 双配置设计（PLAN §5-D3）；T-P1-9a（基线面 0.0.0.0 清零，`p1-redanchors.test.mjs:48-52`）与 T-P1-9b（device.yaml server_url≠127.0.0.1，:54-60）**分文件反向断言、明确防张冠李戴**——测试已经按「豁免只给设备侧」的形状写好了；T-P1-9a/c 不依赖 O3，T-P1-9b 依赖。
- 【倾向】a（置信中高）。b 的物理后果是 S6 永败（127.0.0.1 对手机是死路），等于否决整个真机控制面剧本；c 击穿 D3 复现性红线，被 T-P1-9a 直接钉死。
- 【反方】豁免面写「监听边界按设备联调需要」过宽，可能被解读为允许 0.0.0.0。驳：成立——建议拍板文本收窄为「server_url 可指开发机 LAN 地址；监听绑 LAN 接口而非 0.0.0.0」（T-P1-9a 只钉基线面，device.yaml 监听边界目前无断言，属可见面 gap，建议 P1-9 落地时给 device.yaml 加「非 0.0.0.0」负断言，登记 expected.json）。
- 【拍错后果】不豁免→S6 死、真机线冻结；豁免过宽→设备侧 headscale 暴露面失控（安全回退）。
- 【可代拍】**有条件是**。红线豁免名义上是 owner 专属（PLAN §0.1 On 定义），但 owner 已授权代拍流程（2026-10-03），且豁免边界可机检（T-P1-9b 就是它的机检化身）。拍板记录条件：豁免文本三要素（仅设备侧文件/仅本任务/基线 yaml 同步修回）+ 监听边界收窄句；重审触发：真机联调发现 LAN 绑定不够（如跨网段）→ 重新豁免并记录。

## O4 H2OverNoise 落包位置

- 【选项】a. 并入 control 包新增 h2c.ts（PLAN 建议）；b. 独立第 10 包；c. 留 app 侧 TS 副本。
- 【证据约束】h2c.node.ts 零 node: 导入、仅 type-import noise/controlbase（PLAN §4.2-O4 亲验记录，我亲读 :13 import type 证实）；h09 frozen-exports（396 名，TESTS.md §3.3-5）明文「新增只应落在 O4 h2c.ts/O5 kat 授权域」——测试体系已预签此选项；validate:arkts (a) 面扫 packages/*/src，落包即自动收编。
- 【倾向】a（置信中高）。b 制造第 10 包叙事+registry 无对应门+「一文件一包」的口径负担；c 造成 Node 侧与真机侧两份实现分叉——D1 路径 A 的 S6 失败归因会变成三变量问题。
- 【反方】control 包已是最重包（7303 行/141 例，BASELINE §4.1），再塞 h2c 加重；且 h2c 现为「interop 胶水」，升格进包=承诺维护。驳：h2c 语义上就是控制面应用层（BASELINE §3.1 noise 行明载「h2c 仅 interop 胶水；升级握手在 control.client/noisehttp」），归位是修正不是加重；不过量承诺可由「h2c.ts 只迁类本体、CLI 留 interop」实现。
- 【拍错后果】选 c：真机与 Node 双实现漂移 → S6 失败无法二分；选 b：叙事/注册表双负担，属可逆低害。
- 【可代拍】**是**。连锁：A1 npm test 计数合法增长（T-A1 是 ≥495 floor，`a-criteria.test.mjs`）；h09 superset 断言兼容新增；无红锚需改。记录条件：「O4=control/src/h2c.ts，类本体迁移，CLI 留 interop/h2c.node.ts（O2 联动）」；重审触发：tsc 镜像后 h2c.ts 过不了 validate:arkts 禁则且改写成本超 M。

## O5 新增 packages/kat/（第 9 workspace 包）

- 【选项】a. 通过独立包（PLAN 建议）；b. 塞 common/src/kat/；c. 不建 KAT 层。
- 【证据约束】49/49 测试文件 import node:（BASELINE/PLAN D11）——KAT 必须零 node: 才能上真机；T-P1-1a/b 红锚已按独立包形状写死（`p1-redanchors.test.mjs:11-25`：packages/kat/src + test:kat script + 三形态零 node: 断言）；**T-HANDOFF-c 断言 `(8\s*包|八包)` 必须出现于 AGENT-TASK**（`handoff-antipoison.test.mjs:55`，「必须写现行口径 8 包/495」）。
- 【倾向】a（置信高）。b 动 common barrel=碰 8 包冻结红线最敏感处；c 放弃 D11 的唯一真机证明通道。
- 【反方】「第 9 包打破 8 包叙事，交接文档/白名单都要改」。驳：不需要改断言——拍板文本**钉死措辞**「8 包协议核心 + packages/kat 可移植层（第 9 workspace 包）」：`/8\s*包/` 仍匹配（正则只要求「8 包」字样在场），T-HANDOFF-c 零改动翻转。若反过来把 T-HANDOFF-c 断言改成「9 包」，就是一次不必要的规格变更（改断言=owner 审+TESTS.md 递增）。
- 【拍错后果】选 b：导出面快照 h09 对 common 的 superset 断言被新增导出顶穿风险+冻结红线争议；措辞不慎（AGENT-TASK 只写「9 包」无「8 包」）→ T-HANDOFF-c 批次二卡死。
- 【可代拍】**是**（知悉性拍板，PLAN 附录 B-5 建议默认通过）。连锁另有一条执行期注意：npm test glob 是 `packages/**/*.test.ts`（package.json 亲读），kat 的 node.test.ts 落 packages/kat/test/ 会被 npm test 与 test:kat **双跑重复计数**——P1-1 落地时要么外壳测试避开该 glob 形态，要么接受双跑并在 P1-2 数字联动时记口径（T-A1 floor 语义不受影响）。记录条件：措辞钉死+双跑口径记录；重审触发：无（只增不改，无回退理由）。

## O6 真机性能阈值与逃生门

- 【选项】a. 现在拍定阈值；b. 后置到 S5b 数据到手（PLAN 设计）；c. 不设阈值。
- 【证据约束】BASELINE §3.4：真机 ArkTS **零数据**，Node 侧方差 17%（七样本 3.51–4.10）；D12 记录制已预埋（软参考 25 / 硬触发 50）；PERF 门 registry ci:false+reason（`gates.registry.json` PERF 行）。
- 【倾向】b。现在拍=在零数据上掷骰子：松则门无意义，紧则诱发「改测凑数」（R10/D12 点名的历史病）。
- 【反方】「后置=真机 agent 没有硬判据，S5b 结果无人裁决」。驳：S5b 判据是**记录制**（格式门，TESTS.md §1 矩阵 P1-13「门只看格式不看值」），O6 是记录之后的裁决动作，两者不冲突。
- 【拍错后果】现在硬拍：x25519 真机数字一出来，阈值要么被要求重裁（白拍）要么被硬凑（R10 灾难）。
- 【可代拍】**否，物理必须人类+真机数据**（O6 触发条件本身写明「真机数据到手后」）。测试面连锁：零（现有断言均不依赖阈值）。拍板记录条件：S5b 三次取中位+机型/API/温度齐备后裁；重审触发即其触发条件本身（>50 ms/op 或优化空间枯竭）。

## O7 headscale 环境供给确认（别名有效性/docker 主机/preauthkey 签发人）

- 【选项】a. owner 回答 yes/no（别名是否仍有效）+供机方式；b. agent 自行 ssh 探测；c. 挂起等真机 agent 到现场再说。
- 【证据约束】BASELINE §7 无网无 gh；`dev-env-with-gpu` 是 2026-10-02 现场记录（docs/research/2026-10-02-D-interop-plan-public.md:12）；**本视角核心发现**：黑名单规则 env-alias-premature（`handoff-scanner.mjs:14`，理由「O7 未答前不得预写」）当前贡献 10 处命中，全部位于 docs/handover/agent-interop-regression.md 与 handover/README.md——这两文件**不在 P0-6 修复清单内**（P0-6 只修 owner-with-real-device.md 三处，PLAN §2.1-P0-6）→ 即使 O7=yes 且 P0-6 全落地，T-HANDOFF-a 仍钉死在 10 处命中上，批次二收口表（TESTS.md §2.7 含 T-HANDOFF-a/c）永不可达。
- 【倾向】a 必须人类；且**必须与黑名单规则处置同批拍**：O7=yes → env-alias-premature 规则退役或收窄为「仅 docs/pre-device/ 禁预写」（退役后 BLACKLIST 8→7，T-HANDOFF-b 地板 `BLACKLIST.length >= 7`（:30）仍绿，无需改断言）；O7=no/换机 → 规则保留，P1-9 顺手清理 handover 两文件的别名引用。c 是最坏选项：把死锁从「待拍板」变成「不可见死锁」。
- 【反方】「O7 未答前先删规则=防毒门被提前掏空」。驳：规则的存在理由（O7 未答）与答案互为条件；规则退役时在 expected.json/worklog 记一行理由，与 T-HANDOFF-b 的 ≥7 地板共同防「顺手删空」。真正不能做的是**沉默删规则**。
- 【拍错后果】O7=yes 而规则不动：批次二假性卡死，团队误判为「防毒测试有 bug」→ 诱发对测试体系的整体不信任（比卡死本身更贵）。
- 【可代拍】**O7 本体否**（远端环境有效性只有 owner/有网者能观测）；**其测试面配套（规则退役/收窄/保留）可代拍且必须随答案落地**。记录条件：答案原文+规则处置二选一+worklog 记录；重审触发：环境变更（换机/别名失效）→ 规则按需复活。

## R1 新增 A17 判据（meta 门自检）

- 【选项】a. 采纳两段式 A17（过程态四态全清 + 终态 79/79 GREEN_OK）；b. 只采纳过程态；c. 不采纳。
- 【证据约束】A17 的机器实体**已在跑**：scripts/test-plan.mjs 亲验 exit 0；registry 已有 A17 行（ci:false+reason「红锚故意红，进 PR 门长期红噪音；批次四后 owner 可转 true」）；TESTS.md §1.2 已给出可原文并入 PLAN §1.1 的判据行。
- 【倾向】a。与批次不冲突的关键在语义：**过程态 exit 0 今天已为真**（红锚如实红不算失败），所以「A17 生效」不需要等任何批次——需要防的是把 exit 0 误读为「测试体系完工」。终态（79/79）按 §2.7 批次表逐批核对 green 数，与 R8（P1-2 暂不判定）正交：R8 改的是 P1-2 工作项验收记法，T-A13/T-A16-1 红锚照常在岗、批次四照常翻转，两机制不打架。
- 【反方】「A17 exit 0 恒真（今天就是 0），作为判据无区分度」。驳：区分度在 green 数与批次表的对照（TESTS.md §1.2 明文「owner 验收看两样」）+ STALE_ANCHOR/UNKNOWN_TEST 的 fail-closed 语义；恒真的只是「没坏事」，这正是 meta 门的本职。
- 【拍错后果】选 b/c：79 条红锚的翻转无完成定义，批次四收口回到「各自声称」状态——「我们又一次加了门而没东西测它」。
- 【可代拍】**是**。连锁：PLAN §1.1 表加一行（R1 建议原文照抄 TESTS.md §1.2）；registry/expected.json 零改动。记录条件：ci=true 收编时点=批次四收口+holdout 全 PASS 两条件与，由 owner 手动改。

## R2 三道新门支持 `--root <dir>`

- 【选项】a. 采纳（gate-d4-p4 / ets-mirror-check / doc-consistency 三门 + 等价性约定）；b. 不采纳，注入式 meta 用真检索面临时落盘；c. 只给 gate:d4 加。
- 【证据约束】U1 裁决已定 --root 为主（TESTS.md §5：Windows 文件锁使落盘→删除残留率非零；X9 三理由成立）；registry A7 mutationWitness 明文「必须支持 --root」；validate-shell 可搬走跑已被实测（E6）。
- 【倾向】a，且三门一起（部分采纳会让「副本等价」约定出现例外，例外就是下一个缺口）。对 p0-3/p0-4/p0-5 红锚文件的语义影响：**纯加法**——T-P0-3-d/T-P0-4-c（干净仓 exit 0）在 `--root` 默认=仓根时语义不变；建议 P0-3/P0-4 落地时各**新增**一条可见断言（--root 指向临时副本运行与仓内等价；副本注入违规必红），先登记 expected.json 再加（UNKNOWN_TEST 纪律，test-plan.mjs:54-56 实现了这道闸）。**p0-5 不受 R2 影响**——regress 需要的是 `--out`（R3），两个参数别混写进同一条验收。
- 【反方】「--root 增加门自身复杂度，门 bug 的风险大于收益」。驳：门复杂度已被 mutationWitness+三段式覆盖；而不支持 --root 的注入 meta 只能脏改工作树——CI 并发/中断留脏树是测试体系自己制造污染源。
- 【拍错后果】选 b：holdout h03/h04 的注入手法失去主方案（U1 降级路径就是为否决 b 准备的）；选 c：doc-consistency 的 h05（批次四解锁）无 --root 即无法注入副本验收。
- 【可代拍】**是**。连锁：PLAN P0-3/P0-4/P1-3 验收各加一句；TESTS.md 矩阵 P0-3/P0-4 行已有「门支持 --root」字样，无需改；新断言登记 2 条。记录条件：三门 --root 行为与仓内等价的验证命令入 P0-6 前定稿；重审触发：某门 --root 副本运行与仓内结果不一致（等价性破）→ 暂停该门注入验收。

## R3 P0-5 验收补 `--out`（summary 原件可落 evidence）

- 【选项】a. 采纳；b. 不采纳（summary 留 tmpdir）。
- 【证据约束】regress.mjs:71-74 亲读：summary 写 `mkdtempSync(tmpdir())`，归档只 tee stdout——PLAN §3.4「summary 原件入 evidence」在现状下是空操作；T-P0-5-d 红锚已实体化（`p0-5-regress-selftest.test.mjs:26-32`）。
- 【倾向】a。这是 B 类证据链（L2 留证层）的物理前提：TESTS.md §4.6 直言 summary 入 evidence 是 holy grail。
- 【反方】「evidence 里有 regress.log 就够，summary 可后补」。驳：§3.8 双侧指纹一致性（S2 Node 侧 vs S6 真机侧 summary 的 E4 四元组可比）明确消费 summary 原件，无原件则该判定降级为人工比对。
- 【拍错后果】不采纳：P1-11 校验器「断言 evidence 目录内 summary.json 存在且同批」永假 → 该断言只能跳过 → 证据链缺一角。
- 【可代拍】**是**。连锁：PLAN P0-5 验收加第 4 条；测试面零新增（T-P0-5-d 在岗）。记录条件：--out 参数形态与 P1-11 的同批校验字段（时间戳/阶段字段）在 P1-11 动工前对齐。

## R4 STAGE-CHECKLIST 含 S5b 随机字节快照步骤

- 【选项】a. 采纳；b. 不采纳（靠 P1-5 钩子自觉触发）。
- 【证据约束】D13 失败复现包依赖随机快照；T-P0-6-e 红锚已实体化（`p0-6-stagedocs.test.mjs:40-44`）。
- 【倾向】a。理由一句话：**钩子无剧本步骤触发=机制空转**——这正是「决策→测试面连锁」的反例教材：P1-5 建了钩子、P0-6 不写步骤，两件都绿但链路是断的，只有 T-P0-6-e 这条红锚看见断点。
- 【反方】「加步骤=剧本膨胀」。驳：一行命令一个标签，check-stage-docs 的标签闭包断言本来就要它登记。
- 【拍错后果】不采纳：真机首日故障若涉随机性，D13 复现包缺料 → 回 Node 重放失败 → 归因退化为猜。
- 【可代拍】**是**。连锁：PLAN P0-6 内容清单加一条；测试面零新增。

## R5 P0-7 验收补「不该进的没进」

- 【选项】a. 采纳；b. 只修吞证据方向。
- 【证据约束】T-P0-7-c/d/e 三条绿地板已实体化（`expected.json` 12–14 行；secrets/工具目录/仓根散落 log 仍须被吞）——豁免不能击穿 secrets 段是 gitignore 否定规则的经典事故面。
- 【倾向】a。测试已绿、零成本，纯 PLAN 文本并入。
- 【反方】无实质反方（唯一可辩的是「验收条目冗余」——三条断言已在岗，写不写 PLAN 都在跑）。驳：PLAN 是验收契约的正文，断言在测试里而契约不提，恰是「文档声称与实测漂移」的同构小样。
- 【拍错后果】近零（测试兜底）；唯一风险是未来有人以「PLAN 没写」为由简化 gitignore。
- 【可代拍】**是**。连锁：PLAN P0-7 验收补一句；零测试改动。

## R6 caliber.json 无值结构 + doc-consistency 消费器

- 【选项】a. 采纳（无值结构 {id,cmd,extract,relation(min|eq)}，min 带 floor+current，豁免表带 reason）；b. 值写死在结构里；c. 维持 yml 内联 awk。
- 【证据约束】c 已被 BASELINE §5.2-3 判死（awk 恒空=假绿门）；T-A16-2 红锚已按 a 的形状写死（`a13-a16-docs.test.mjs:52-66`：entries≥3 覆盖 tests/bridge/shell、relation 枚举、min 双字段、exemptions 逐条 reason）。
- 【倾向】a（置信高），但**拍板文本必须带三句现状差距说明**（本视角重点核对项）：
  1. **caliber.json 不在 P0-6 七件套内**（`p0-6-stagedocs.test.mjs:9-12` 的 PRE_DEVICE_FILES 无它）——它是批次四（P1-3）落地物而 docs/pre-device/ 批次二就建：check-stage-docs 的六断言**不得**要求 caliber.json 存在，否则批次二被批次四落地物卡死（同构 R12 爆红教训）。
  2. **可见面扫描存在并集缺口**：STALE_PATTERNS（280/13/54/1066/8400 等 8 形状）只扫 ACTIVE_DOCS 10 文件，防毒黑名单扫 16 文件但不含数字类规则——「docs/pre-device/ 新包里出现 280 pass」两个可见测试都抓不到（六包/238 被黑名单抓，280 类无人抓）。拍板应写明：doc-consistency 消费器扫描面=活文档面 ∪ docs/pre-device/**，规则源=a13-a16 的 STALE_PATTERNS+黑名单+caliber 豁免表三合一。
  3. T-A16-2 只验结构不验「真值锚=跑真命令」——消费器行为断言（注入副本逐个红）在 spec 层+holdout h05，可见面无对应物：接受（这正是可见/holdout 划分第一原则的应用），但拍板记录要写「h05 是该判据的判定力所在」，防将来有人以为 caliber 结构对=门有效。
- 【反方】「无值结构+运行时真值=门输出自己验自己」。驳：cmd 取的是真命令输出（npm test 等），真值锚是被测物不是断言自身；真要作弊得改 cmd 指向假脚本——那会先被 T-REG-3（yml 出现未登记 script 即红）看见。
- 【拍错后果】选 b（写死数值）：每次计数增长门必假红或被改值——P1-2 的 30→31→36 数字联动直接撞门；选 c：维持假绿。
- 【可代拍】**是**。连锁：PLAN P1-3 落地物定义改写；TESTS.md 矩阵 P1-3 行补扫描面并集一句；零现有断言改动。

## R7 新增 scripts/check-decision-trees.mjs

- 【选项】a. 采纳（五断言独立成门）；b. 并入 check-stage-docs；c. 不建。
- 【证据约束】tree-check.mjs 规格内核已在盘且自检（T-TREE-a/b 绿：五个坏树负对照+好树正控）；T-TREE-c/d 红锚已实体化（AGENT-TASK 树块过五断言 + 脚本在盘）。
- 【倾向】a。R7 的本质理由：树有洞=真机 agent 自由发挥=R1 风险（环境失败误诊为代码问题）的直接入口；独立脚本使其可被 P1-14 gates 聚合单独点名叫红（TESTS.md §1.2 P1-14「弄红任一分门→输出含该门 id」的可归因性要求）。
- 【反方】「并入 check-stage-docs 少一个进程」。驳：U-handoff 裁决已确立「按演进速度拆分放置」原则——树规则静态、stage-docs 规则随 marker 演进，混在一起会把静态门的失败掩盖在演进门的噪音里。
- 【拍错后果】不建：树块只有 lib 内核没有常驻门，AGENT-TASK 手改坏树无人拦。
- 【可代拍】**是**。连锁：PLAN P0-6 交付物加一行；package.json 补丁（TESTS.md §2.5 已含 check:decision-trees 条目）；零现有断言改动。

## R8 P1-2 在 P1-3 建成前验收记「暂不判定」

- 【选项】a. 采纳；b. 维持 PLAN 附录 B-8（先清后立）原表述。
- 【证据约束】PLAN B-8 只锁「顺序」，R8 进一步锁「记法」——防清零靠一次性 grep 自证（第二次假绿的形态）；T-A13/T-A16-1 红锚在岗（现红），批次四翻转。
- 【倾向】a。与 R1 联合看（本任务指定的联合项）：**A17 与批次不冲突、R8 与 A17 也不冲突**，因为三者作用层不同——A17 管 meta 健康（四态），R8 管 P1-2 的验收记法（一次性脚本记录清零事实，不装成门），红锚管完成定义（翻转时点）。三者一致的场景推演：批次四中 P1-2 清零完成 → T-A13/A16-1 转 STALE_ANCHOR → 核实翻转 → P1-3 建门 → A16-2/3 翻转 → A17 终态 green 数到位。任何一处提前或跳序，runner 的 STALE/UNKNOWN 语义都会叫停。
- 【反方】「暂不判定=给 P1-2 开软口子，清零可以拖」。驳：红锚红着本身就是未完成态的显式记录（TESTS.md §2.7 注：锚点比绿门更诚实）；「暂不判定」针对的是**工作项验收行文**，不解除红锚压力。
- 【拍错后果】不采纳：P1-2 可能以「跑了一次 grep 全绿」的截图交付，P1-3 建成后才发现没清干净 → 否定断言门爆红 → R12 历史重演。
- 【可代拍】**是**。连锁：PLAN P1-2 验收文本改写；tests/plan 零改动（T-A13/A16-1 留在 expected.json，**严禁**因「暂不判定」摘除——摘除即 UNKNOWN_TEST 机制自伤）。

## R9 D4/P4 扫描面扩到 app/bridge/src

- 【选项】a. 采纳扩面；b. 维持 packages/；c. 扩到整个 app/（含 app/tools、entry）。
- 【证据约束】亲验：app/bridge/src 四条 D4/P4/node: grep 全 0 命中（本会话第 3 条亲验）——a 无技术阻碍；PLAN P0-4 原文检索面=packages/（b 是现行规格）；app/tools/perf 未来落 perf 源码（P1-13），**c 会把 perf 源码圈进扫描面**——perf 源码若含计时用 Date.now 即撞 P4（P1-13 spec 自身要求「Node 参照数字只断言记录存在」，计时实现未必避开 Date.now）→ c 强制引入豁免机制（R13 联动）。
- 【倾向】a（置信高），显式拒绝 c 于本时点。关键连锁：**T-P0-4-g（等价 grep 0 命中绿地板）现只扫 packages/**（`p0-4-gate-d4-meta.test.mjs:75-88`）——门扩面后可见锚与门检索面不一致，「沉默缩小」病的镜像形态（这次是测试比门窄）→ P0-4 落地时 T-P0-4-g 应同步加 app/bridge/src 段（改绿地板的覆盖=扩规格，须 owner 审记一笔；因两端都 0 命中，测试结果不变，风险可控）。registry A7 mutationWitness 补「检索面声明在脚本头注释，meta 核对声明面=实际面」。
- 【反方】「app/bridge/src 是 mock 层，将来合法需要 node: 类型/计时工具，扩面提前上锁」。驳：mock 层的 node: 需求（若有）应走显式豁免而不是预设盲区——U-d4face 的原判「测试反对的不是只扫一部分，而是沉默的缩小」同样适用于「沉默的扩大豁免」。
- 【拍错后果】选 c：P1-13 perf 源码落地即撞门，被迫在无准备时开豁免（最容易裸奔的形态）；选 b：typecheck:bridge 缺口#1 的同构复刻（bridge 面永不设防）。
- 【可代拍】**是**（TESTS.md U-d4face 已给「建议扩面」倾向，缺的就是这声 owner 批）。记录条件：检索面声明句入脚本头注释；重审触发：app/bridge/src 出现合法 node: 需求 → 走豁免条款（R13 机制）而非缩面。

## R10 P0-8 验收补第二档路径校验

- 【选项】a. 采纳；b. 只留第一档（假路径）。
- 【证据约束】T-P0-8-b 现按「第一档+崩溃类排除」写（TESTS.md §0.3-R10 自述），第二档（路径存在但不是 SDK 目录 → 报可读错）留 spec。
- 【倾向】a。第一档挡不住「随便 mkdir 一个目录糊弄校验」——第二档才证明真做了存在性之外的形态校验；这是判据强度问题，不是风格问题。
- 【反方】「SDK 目录形态难定义，第二档实现成本高」。驳：可检形态很弱（如断言报错文案含「不是有效的 SDK 目录」类可读错而非 crash），与第一档同一断言骨架。
- 【拍错后果】不采纳：假 SDK 校验形同虚设，arkts-check 在真机环境带病运行的通道不闭合。
- 【可代拍】**是**。连锁：PLAN P0-8 验收补一句；落地时新增 1 条断言（先登记 expected.json）；T-P0-8-a/b 不动。

## R11 env-ready 三元组（值+证据+时间戳）+ schema 键清单

- 【选项】a. 采纳；b. 裸 bool；c. 引入 ajv。
- 【证据约束】lib/env-ready-validator.mjs 已实现且 T-ENV-a/b/c 三绿（合法放行/缺键报 why/坏值逐类拦）；无 ajv 且禁装依赖（node_modules 仅 5 包，实测口径 TESTS.md V17）→ c 被环境直接排除。
- 【倾向】a。三元组把 PLAN §3.4「贴原始输出而非结论」落到人类配合面——「人做没做」变成可判定 IO（TESTS.md §4.3 原判）。
- 【反方】「让人类填 evidence 字段=增加配合摩擦」。驳：摩擦正是目的的一部分（只填结论不留证据=绿灯幻觉的入口）；且缺键时报错自带 why 文案，人类不是没有脚手架。
- 【拍错后果】选 b：S5 前的环境确认退化为一排 true，R1 风险（误诊）的防线名存实亡。
- 【可代拍】**是**。连锁：PLAN P1-12 文本改写；零测试改动（规格内核已自检在岗）。

## R12 P2-1 验收细化（逐条回归+字节级 inbox）

- 【选项】a. 采纳；b. 维持「8+7 总数不回归」。
- 【证据约束】fcaf962 修复后现状=单元 8/8+集成 7/7（BASELINE §2.7 亲跑记录）；总数判据对「改掉单条向量」是盲的。
- 【倾向】a。`..%2f` 向量必红+Python 视角 inbox 字节级只含合法文件（不看返回码）——返回码可被服务端「友好拒绝」污染，字节级才防「防线上有洞但洞不在这条向量」的误判。
- 【反方】「P2 本来就不阻塞真机，细化是镀金」。驳：P2-1 是全仓唯一真代码实证通道（BASELINE 一页结论语），它的判据强度决定「安全修复有实证」这句话的含金量。
- 【拍错后果】不采纳：未来重构 upload_server 时单条向量静默失效，G0-6 仍绿——安全门回归盲区。
- 【可代拍】**是**。连锁：PLAN P2-1 验收改写；落地时新增 spec 断言（登记）；T-G06 绿地板不动。注意 P2-1 要改既有文件 interop/upload_server.test.mjs——执行期由 PLAN 工作项授权，非本思考阶段动作。

## R13 perf 豁免带理由 + 与 registry 豁免机制的统一写法

- 【选项】a. 采纳条件性条款（若开显式豁免，每条带非空 reason+meta 断言）；b. 不留豁免机制；c. 现在就为 app/tools/perf 开豁免。
- 【证据约束】现状：app/tools/perf 在 packages/ 扫描面之外是**事实不是豁免**（P0-4 原文检索面=packages/）；R9 只扩到 app/bridge/src，仍不含 app/tools/perf——所以 c 在本时点是给不存在的问题开洞；registry 的既有惯例是「显式决定必须带非空 reason」（T-REG-1 对 ci=false 的强制，`gates-registry.test.mjs:21-24`）。
- 【倾向】a，且**统一写法=复用 T-REG-1 哲学而非复用 registry 文件**：豁免是「门内检索面属性」不是「门注册表属性」，EXEMPTIONS 数组放 gate-d4-p4.mjs 自己的头注释/常量里（{path,reason}），meta 断言逐条 reason 非空——**不要**把豁免塞进 gates.registry.json（单一职责：registry 管门在不在 CI，不管门内部扫哪）。若 R9 将来扩到 app/ 全树（本轨迹建议暂不），perf 源码的 Date.now 计时才真需要豁免条款，届时逐条写理由（如「app/tools/perf/x25519.ts: 计时采样需 wall clock，P4 豁免——D4 面不适用 perf 工具」）。
- 【反方】「豁免清单和 registry 分两处=两处要同步」。驳：两者生命周期不同步（registry 随门增减、EXEMPTIONS 随检索面增减），强并反而制造假同步；meta 断言各守各的。
- 【拍错后果】选 c：为空集开洞=给未来的沉默缩小发预授权；选 b：R9 扩面后 perf 落地即死锁。
- 【可代拍】**是**。连锁：PLAN P1-13 验收加条件句；registry 零改动；落地时 EXEMPTIONS 断言登记。记录条件：触发条件写死「仅当检索面扩至含 app/tools/perf 时条款生效」；重审触发=R9 扩面决定变更。

---

# 共性必答五节

## (1) 20 项倾向汇总表

| 项 | 倾向 | 置信度 | 最依赖的前提 |
|---|---|---|---|
| O1 | owner 亲查，排 P0-4 合入后 | 高（定性）/—（结论） | P0-4 已合入使远端可分辨新旧 |
| O2 | 补 h2c CLI | 高 | T-P0-5-c 红锚与 D-1 契约的零改动对称性 |
| O3 | 书面豁免（收窄监听边界句） | 中高 | 豁免文本三要素可机检（T-P1-9a/b 分文件） |
| O4 | control 包新增 h2c.ts | 中高 | h09 授权域预留 + 零 node: 亲验 |
| O5 | 通过 kat 第 9 包，措辞钉「8 包协议核心+kat」 | 高 | T-HANDOFF-c `/8\s*包/` 正则兼容措辞 |
| O6 | 后置至 S5b 数据到手 | 高 | D12 记录制已覆盖其间判据 |
| O7 | owner 答 yes/no；**与黑名单规则处置同批拍** | 高（联动必要性） | env-alias 10 命中全在 P0-6 清单外（亲验） |
| R1 | 采纳 A17 两段式 | 高 | exit 0≠完成，须配 §2.7 批次表 |
| R2 | 采纳三门 --root | 高 | 副本等价性约定（U1/X9） |
| R3 | 采纳 --out | 高 | P1-11 同批校验字段对齐 |
| R4 | 采纳 S5b 快照步骤 | 高 | T-P0-6-e 在岗 |
| R5 | 采纳不击穿条款 | 高 | T-P0-7-c/d/e 绿地板在岗 |
| R6 | 采纳，附三句现状差距说明 | 高 | 批次二不得依赖批次四落地物 |
| R7 | 采纳独立脚本 | 高 | tree-check 内核已自检 |
| R8 | 采纳暂不判定记法 | 高 | 红锚不摘除（UNKNOWN_TEST 纪律） |
| R9 | 采纳扩 app/bridge/src；拒扩全 app | 高 | 0 命中亲验 + T-P0-4-g 同步扩 |
| R10 | 采纳第二档 | 高 | 断言骨架与第一档同构 |
| R11 | 采纳三元组 | 高 | 校验器三绿在岗 |
| R12 | 采纳细化 | 高 | fcaf962 实证为地板 |
| R13 | 采纳条件性条款；豁免放门内不放 registry | 中高 | R9 扩面决定为触发条件 |

## (2) 决策依赖图（必须一致地拍）

- **组A｜O2 ↔ P0-5/TASK.md D-1**：O2 的答案决定 T-P0-5-c 的存在意义与 S2/S7 断言集。拍 O2 时必须同时声明 TASK.md D-1 是否改文（补 CLI=不改）。
- **组B｜O3 ↔ P1-9 ↔ 批次三**：O3 未签则 T-P1-9b 不翻 → 批次三收口表（TESTS.md §2.7）不满足。O3 拍板必须落在批次三动工前。
- **组C｜O4+O5+O7 ↔ 交接面断言**：O5 决定 AGENT-TASK 措辞（T-HANDOFF-c 的 8 包断言）；O4 与 O5 联合决定 workspace 叙事（9 包 vs 10 包）；O7 决定 env-alias-premature 规则存废（T-HANDOFF-a 批次二翻转）。三者都通过「措辞/规则」作用于同两个测试（T-HANDOFF-a/c），**必须一次拍齐**，否则批次二收口判据内部互相矛盾。
- **组D｜R1+R6+R8 ↔ 批次四**：A17 终态、caliber 消费器、P1-2 记法三者共享「P1-2 清零→P1-3 建门→79/79」一条时序链，任何一处单独拍都可能造出「批次二依赖批次四落地物」（R6 gap 1）或「摘红锚」类新洞。
- **组E｜R2+R9+R13 ↔ 门检索面**：--root（怎么注入）、扩面（扫哪里）、豁免（哪里不扫）是同一个门的三个自由度，必须作为一揽子拍，检索面声明句一次写全。
- **独立**：O1（人类项，仅排序约束）、O6（后置）、R3/R4/R5/R7/R10/R11/R12（单点采纳，无交叉）。

## (3) 拍板后需改 PLAN 文本 vs 只需记录

- **需改 PLAN 工作项/验收文本**：R1（§1.1 加 A17 行）、R2（P0-3/P0-4/P1-3 验收各一句）、R3（P0-5 第 4 条+P1-11）、R4（P0-6 内容）、R5（P0-7 验收）、R6（P1-3 落地物定义+扫描面并集句）、R7（P0-6 交付物）、R8（P1-2 验收记法）、R9（P0-4 检索面声明）、R10（P0-8 验收）、R11（P1-12）、R12（P2-1 验收）、R13（P1-13 条件句）、O2（若删阶段才需改 P0-5+TASK.md D-1；补 CLI 则零改）、O4（D2 结论落 §5）、O5（§3.1 仓库清单与叙事措辞）。
- **只需记录决定（DECISIONS.md/DECISIONS 签署栏）**：O1（定性三选一原文）、O3（豁免文本三要素+收窄句）、O6（后置+触发条件）、O7（答案原文）。**特例**：O7 的测试面配套（env-alias 规则退役/收窄）是 tests/plan 规格变更——按 TESTS.md 版本纪律走 owner 审+expected.json/worklog 记录，属「记录+一处测试规格修订」复合动作。

## (4) 最容易被轻率拍错的 2–3 项

1. **O7 拍了 yes 但不动 env-alias-premature 规则**：10 处命中全在 P0-6 修复清单之外的两文件（本会话亲验计数），T-HANDOFF-a 在批次二后仍红 → 批次二收口/A17 终态静默死锁，且表象像「防毒测试误报」，最易诱发对整个红锚体系的不信任。正确形态：O7 答案与规则处置同批落、worklog 记一行。
2. **O5 通过后把 AGENT-TASK 写成只说「9 包」**：T-HANDOFF-c 断言 `(8\s*包|八包)` 失配 → 批次二/四卡死；或者反向过度反应去改断言（不必要的规格变更连锁）。正确形态：拍板文本钉死措辞「8 包协议核心 + kat 可移植层（第 9 workspace 包）」，断言零改动。
3. **O2 被「h2c 冗余」论说服选删阶段**：T-P0-5-c 红锚死锁 + D-1 契约变更 + TESTS 矩阵/selftest 断言七处连锁改写；而补 CLI 是 S 级增量且让全部现有断言原样翻转。测试面不对称性应作为此拍板的头号论据。

## (5) 证据不足项的保守默认建议

- **O7 未答期间**：env-alias 规则**保留**（禁预写语义不变），handover 清理动作挂起等答案；GLM53 拍板人应把 O7 列为「第一批递交 owner 的最低成本项」（yes/no 一句话，PLAN §4.2 原判），其答案解锁批次二的最终收口。**不确定点**：我无法验证远端环境有效性——缺的就是 owner 的一次观测，agent 侧无替代手段（BASELINE §7）。
- **O6**：维持后置；其间判据=记录制格式门 + 软参考 25/硬触发 50（D12 已预埋，不新造）。
- **O1**：若 owner 短期不可达，保守默认=维持 BASELINE 口径「远端状态不可证，本地推定一直红」并把 O1 挂起项写进 DECISIONS 签署栏（待拍板态，T-P0-6-f 允许可空）。
- **A17 终态时点**：证据不足（批次四尚未发生）时保守默认=ci 维持 false；转 true 的条件写死「批次四收口且 holdout 全 PASS 零 BLOCKED 两条件与」，不因 exit 0 提前收编。
- **R9 扩面边界**：对「是否扩到 entry/.ets 面」证据不足（.ets 走 P0-3 的 (b) 面镜像门，与 gate:d4 职责边界未验）——保守默认=只扩 app/bridge/src，entry 面留给 validate:arkts，两门检索面交集保持空并在声明句写明。
- **R6 的扫描面并集**：我的「缺口 2」判断基于对两份可见测试扫描面的逐行比对（a13-a16-docs.test.mjs:10-15 vs handoff-scanner.mjs:18-36），置信高；但「check-stage-docs 断言 6 是否已隐式覆盖」属 spec 层（TESTS.md §1.2），无法在落地前机检——保守默认=把并集句写进拍板文本，宁可冗余。

---

*本轨迹全部事实锚定：PLAN.md/TESTS.md/BASELINE.md 正文 + tests/plan/ 与 scripts/ 源码逐行 + 三组本会话亲验命令（test-plan 全套、扫描面黑名单计数、app/bridge/src D4/P4 四 grep）。未跑 holdout、未读历轮思考轨迹、未改任何既有文件。*
