# 族：local-plane（cron 驱动 planner/worker/merger 协作平面）

> 分析对象：3 条轨迹 —— planner 第十轮（sess_e63e178c，10-04 09:05–10:14，793 parts）、worker-glm-m4 值班（sess_a22d7584，10-03 21:35–22:07，521 parts）、merger 第五轮（sess_4697ab3a，10-03 20:55–21:24，295 parts）。遥测背景：5 天窗口 local-plane 族 68 主会话（planner 9 会话/223 模型分钟、worker 24/168、merger 33/70），worker/planner 各 1–2 次模型失败，最常见工具错误为 Edit "File has not been read yet"（18 次）与 "File has been modified since read"（9 次）。

## 1. 任务画像（协作协议、各角色职责、产出物）

**协作协议（PROTOCOL v1.1，纯文件协作平面）**：多项目（REGISTRY 登记 7 个 active：plane/skillfactory/ohos-tailscale/peidian/playable-universal/yjn-drama/anongw）共享同一套 cron 派发机制，"每次点火=全新冷上下文会话，忽略任何会话历史，一切以平面文件为准"（三个轨迹的首条用户输入均为此句式，如 planner 轨迹 L7）。项目间严格隔离：一个项目 = 一个命名空间 projects/<pid>/ + 接单/状态/holdout/journal 全按项目隔离（REGISTRY 输出，planner L473-474）。README 明确平面"必须始终处于打包即可迁走状态"（windev 10-07 销毁，L51）。

**状态机核心是文件目录**：任务卡以 `tasks/{backlog,active,review,done,blocked}/` 目录位置为真实状态，BOARD.md 仅是人读视图（"目录状态为真实状态"，planner L483）。CURRENT-STATE.md 是"一行一个事实、id: 状态词： 说明、追加前查重"的追加式账本（L54）；EXPECTED-STATE 是 owner 意图层级化（L1 planner 静默改 / L0 owner 批），planner 每轮对照两侧"找张力、生成任务"（L229）。

**三角色职责与产出物**：
- **planner（GLM-5.3 强模型，兼 ensemble 合成器）**：上车读全平面状态 → 验收 review/ 待验收卡（"独立重跑同命令，不采信粘贴输出"，SF-0005-accept.md L72）→ 心跳看护（.hb 新鲜度、40 分钟越线）→ 差距分析按需 weak5 ensemble 开新卡 → ESCALATION-MENU 巡检登账 → 离场更新状态面/journal/身份卡。产出：验收 verdict（卡尾追加）、ESCALATION 登记行、ensemble SYNTHESIS + 新任务卡 + 可见验收文件、journal（planner L215 一轮 250 行）。
- **worker（分族：glm/minimax/stepfun，异族验收 family=hetero）**：读三文件 → 建/更新身份卡（WORKER-TEMPLATE）→ 按"P0 优先→REGISTRY 登记序→id 最小"原子认领（mv backlog→active + `.by-worker-<name>.md` 改名 + touch `.hb` 心跳，worker L38-39）→ 按卡内 S0–S6 阶段执行并自跑可见验收全绿 → 交付（移 review/ + 删 .hb + 报告 + journal + 身份卡心跳，L166-170）。产出：代码/装置改动、verify 汇总器（34/34 门）、交付报告、执行记录。
- **merger（GLM-5.3 终审席）**：对 GitHub open PR 执行四层合并门状态机（DEV-PLAN §4.2）：L1_TEST（双弱测试者异族在隔离 git worktree 跑同一张 visible 测试卡 + CodeRabbit commit status + CI 四件合取）→ L2_INTENT（2 弱模型新实例 veto 收集）→ L3_SUMMARY（双起草+融合席）→ L4_FINAL（终审判意图符合性→squash 合并或打回）。幂等键 = repo+pr+head_sha+layer（merger L117）。产出：gate 记录 PR 评论、squash merge commit、幂等表/journal 留痕。

**辅助机制**：公域桥（public-bridge/DISPATCH-LOG 外派登记+48h 观察窗）、凭据纪律（GitHub token 经 srv-1 OpenBao 现取现用全程内存不落盘，merger L123；MiniMax 短期 token 经 vault-broker mint，planner L663-679）、升级菜单（五类判据，ESC-编号只增不删）。

## 2. 轨迹叙事（三个角色各自动了什么、协议如何衔接、工具使用模式）

**planner 第十轮（69 分钟，全流程一轮巡检）**：09:05 点火即读 planner.md→README→各项目状态面（L47-60、L473 以后），发现 4 张卡在 review/ 待验收（L494）。验收 SF-0005：独立重跑 GA 组 pack_checks（GA-2 字面红后按 EI-20 口径补双臂形态 8/8，L244-252）、GB 抽 3 包 selftest、GE freeze/NC/差分（afp-clone 非 chenmai8 条目 mtime 全早于开工=基线噪音，L263-267）→ PASS 移 done（L271）。验收 PU-0005：发现"git commit b19d247 已落（worker 在移入 review/ 后仍在继续干活），但报告文件仍不存在"（L275），比对游离目录与 runs/ 正本 content_sha256 11/11 全等、verify 11/11 亲跑过（L283-287）→ **工程实质成立但交付形态不完整 → 打回 backlog 带精确 gaps**（L287）。验收 AG-0003：E2 从原始 records **逐位重算三数**（1.3605%/78.1%/99.0646%）全吻合（L574-575）→ PASS。验收 AG-0004：v3 证据揭示 20 轮 adjunct 实走 **mock 上游回显**，与报告"8b 真实上游"表述矛盾（L308）；尝试复活网关复跑 t1（后台进程被沙箱回收 → 改单命令内起服务+跑测试，L330-332），t1_valuelevel 亲跑 6PASS、t1_roundtrip 502 红 → 两项硬 blocker 成立打回（L342）。随后更新 ESCALATION（ESC-034 事态升级至 15+1 文件、ESC-036 新登，L344-347）；铸 MiniMax token、组 AG-0005 weak5 ensemble 5 槽（2 zcode + 3 kimi 错峰 20s，L380）；kimi 三槽全折（config TOML 重复表事故）→ 还原备份重拉（L398-405）；slot3 主张与亲证数据冲突，合成时裁决（L439）；五槽全绿后写 SYNTHESIS、开 AG-0005 卡 + 验收文件（L445-449）；期间观察到打回卡小时内被复领（AG-0004→stepfun-r1 09:36、PU-0005→minimax-h3 09:51，L433）；最后心跳/状态面/journal/身份卡收尾，自检任务目录终态（L469）。

**worker-glm-m4（32 分钟，一卡完整交付）**：上车读三文件 + 列 backlog 候选，按选卡规则定 SF-0003（P0、登记序、id 最小，L362）；原子认领后按任务卡 S0–S6 推进：S0 前置自检发现 A4 porcelain 在 chenmai8 封存区有 D/T 条目——查明是"HEAD 里的 symlink 在 Windows checkout 上物化差异，克隆时就存在，早于本平面"（L208-210），处置为**不动遗留物、存 S0 基线快照、验收按"本卡新增改动面=0"差分口径**并在报告披露。S1 版本 bump+AG-7 跨版本拒绝门双向实测（混版本 exit 1 报"版本"零输出，L418-422）；S2 inputs→fixtures 保内容改名（sha256 前后对账）+ 装置 4 处适配 + PACK-DEVIATIONS 留痕；S4 **0 模型 replay**：12 条命令复刻 24/24 产物逐字节一致，E3/E4 双负控证明门未放水（L155、L312）；S5 三段式 freeze（先红后绿核对变更集恰等声明清单，L320-322）；收尾 34/34 门全绿、移 review/、journal+身份卡（L340-348），并留给 planner **三个口径判断**（symlink 噪音差分口径/SKILL.md 实测 LF 非卡文 CRLF/E1 显式传 --reference）。

**merger 第五轮（29 分钟，首次真实合并对象）**：读 merger.md→PROTOCOL→REGISTRY→DEV-PLAN §4.2 拿到状态机定义（L117）；幂等检查（journal 空态、两仓 open PR 实查，L121-127）发现 collab-plane PR#3（head 5c667fef，租户登记类，4 文件 +42/-20）。L1：搭双隔离 git worktree、写共用 visible 测试卡（T1–T5）双发弱测试者（L135-139）；kimi `--yolo` 与 `-p` 不兼容 → 去 --yolo 重发；kimi 直连 stepfun 超时 → 探活本地 higress-broker（127.0.0.1:18310）→ step-router 通道重发成功（L155-161）；CodeRabbit 轮询至 success，唯一 1 条 Minor 评论取证据判定"v1 沿袭非新回归，不阻断"（L153）。L2：双异族新实例读 diff，物理限定输出 {veto:false} 双过（L176）。L3：双起草 + M3.1 融合席出终稿贴 PR 评论。L4：**预取证先行**——镜像保真度三份 docs 与 local-plane 状态面逐字节一致 IDENTICAL×3（L275-276）→ squash 合并 7c5acca + 分支保护确认（L187）。收场：终扫、worktree 清理、journal 幂等表 MERGED 行（L195）。

**协议衔接的证据链**：merger 第五轮（10-03 20:55）合并的正是 PR#3 peidian-agent 接入 → worker-glm-m4（10-03 21:35）扫描的 backlog 已含 PD-0001/PD-0002 种子卡 → planner 第十轮（10-04 09:05）状态面里 peidian 已是七项目之一且 PD-0001 done。worker 打回→复派→复验收的闭环在 planner 单轮内可见（PU-0005/AG-0004 09:2x/09:4x 打回 → 09:36/09:51 复领 → "下轮第一优先=验收两张复派交付"，L469）。**工具使用模式**：三角色都是"Read 平面文件建立状态 + Bash 亲验 + Edit/Write 更平面面 + 追加式留痕（cat >> 卡尾/journal）"；planner/merger 大量用**后台 Bash 并行发射子 agent**（zcode/kimi headless、ensemble 槽、弱测试者），配 sleep 轮询 + task-notification 回收；Edit 失败后统一回退到"python 脚本文件做行级替换"（planner L409-411、L729）。

## 3. 失败与恢复模式（结合遥测）

**（a）Edit 冲突（遥测：not-read-yet 18 次 + modified-since-read 9 次，族内最常见）**：planner 轨迹有两处 Edit error 且 out 为空——skillfactory/BOARD.md（L167）与 public-bridge/DISPATCH-LOG.md（L705）。BOARD.md 失败前该文件已被读过且轮内有并发 worker 在写（09:36 AG-0004 复领、09:51 PU-0005 复领会 touch .hb/mv 任务卡），符合"读后被并发修改"形态；恢复路径是**放弃 Edit、落 python 脚本文件 `_fix_sf_board.py` 做行级替换**（"BOARD 行内含字面 \r 控制符……转义地狱——写成脚本文件执行"，L406-411、L726-730）。worker 轨迹另有 old_string 不匹配型 Edit error ×2（aggregate.py docstring，L237-240），恢复为 `cat -A` 看真实字节后缩短 old_string 重试（L243）。**模式总结：共享状态文件是多写者热点，Edit 的读时快照语义在并发平面里天然脆弱；族的惯用兜底是 Read-再试、或直接退化为脚本化行级替换。**

**（b）模型/通道失败（遥测：worker/planner 各 1–2 次模型失败）**：① merger 测试者B 直连 api.stepfun.com `provider.connection_error: Request timed out`（L155）→ 探活本地 broker → 换 `higress-broker/step-router` 通道重发成功；② planner ensemble 的 kimi 三槽首轮全折，根因是**grep 输出被 head 截断导致误判配置缺失**、追加段造成 TOML 重复表（L400-405）→ `config.toml.bak` 还原 + 重拉全成；③ zcode 双槽 12 分钟只见调度器行疑似僵死 → **对比上一轮成功槽的 stdout 形态**（15 个 not-due 后出输出）判定正常在途（L427-431），避免误杀。模式：通道失败恢复=备份还原/备选 provider/形态比对三招，且每次事故都写进 SYNTHESIS 供后人（L777）。

**（c）环境与进程生命周期失败**：planner 复活网关复跑 t1 时发现"后台分离进程在沙箱命令结束后被回收"（L330）→ 改为单命令内完成"起服务+跑测试"；cd 链式后台语法坑、路径八进制转义（`\20`→控制字符吃掉路径，L381-384）、MSYS /tmp 与 Windows python 路径不互通（L676-679）均逐个排掉。worker 侧 MSYS 路径混进 Windows Python（L272）、`2>` 笔误成 `2`（L266、L316）、replay stem 推导 bug 产出乱名文件（L305-306）→ 清理重跑。**这些都是 Windows+Git Bash+多 Python 环境的系统性摩擦，恢复靠小步重试+输出取证，未见任何一次卡死。**

**（d）轮次中断与越轮残留**：PU-0005 呈现典型"worker 移 review/ 后仍在干活"的竞态——commit 落在移卡之后、报告缺失、产物游离仓库根（L275-279）；planner 未粗暴否决，而是亲验产物实质（11/11 全等）后按"实质成立/形态不完整"拆分结论打回。worker 侧的"弃领清场"（AG-0003 前任 worker-minimax-c6 hb 05:27 → planner 第九轮清场回 backlog，L843）说明心跳看护是轮次中断的兜底机制。merger 侧轮末发现本地 main 被外部移动（89e8bb4）→ 查实为合并后同步、无分叉（L191-193）。

**（e）判据冲突的处理范式**：全量零命中型门（A4/D2）撞上先于平面的环境噪音（symlink 物化、10-01 轮 untracked）→ worker 不动遗留物、存基线快照、按差分口径实现并在报告披露"三处口径说明"（L210、L348）；planner 验收采纳该口径（"非 chenmai8 条目全部早于开工时刻=基线噪音"，L263-267）。**"门的字面 vs 门的设计意图"冲突时，族的纪律是：留痕+差分+升级给 planner/owner 裁，而不是放水或硬改门。**

## 4. 可复用资产线索（bench 用例候选）

**LP-COORD-01 · 冷上下文平面登车协议执行**
- 输入：工作目录含局部平面树（PROTOCOL/REGISTRY/各项目 CURRENT-STATE/BOARD/tasks 五目录），入口指令复刻轨迹原句"读 cron/<role>.md 并严格执行其中全部内容。你是全新冷上下文会话，忽略任何历史"。
- 预期：agent 按序读入口文件与核心文件；准确复述当前待办（review/ 待验收卡数、active 心跳、backlog 候选）；选卡/巡检顺序符合协议（P0→登记序→id 最小；验收先于开新卡）。
- 判分：状态复述与埋设的真实目录状态逐项比对（错报/漏报计数）；首个动作是否为读入口文件而非依赖"历史"；认领是否原子（mv+改名+.hb）。
- 难度：中（状态重建面广但每步机械；证据：worker L362 十秒内按规则锁定 SF-0003，merger L117 一句话复述状态机）。

**LP-EDIT-01 · 共享状态文件 Edit 冲突回归**
- 输入：先 Read BOARD.md/CURRENT-STATE.md，随后（agent 视野外）并发修改该文件（模拟复领 touch/worker 追加行，含 \r 控制字符行），再要求 agent 追加一行结构化登记。
- 预期：Edit 失败后不重试超过 1 次同参数；切换恢复策略（重 Read 后重试，或退化为脚本化行级替换/python 写文件），最终文件语义正确且不破坏既有行（含含 \r 的行）。
- 判分：终态文件 diff 恰为预期新增行（多余改动=红）；恢复路径工具序列是否收敛（重试次数、是否引入转义损坏）；全程无内容丢失。
- 难度：高（对应遥测 18+9 次最高频错误；证据：planner L167+L406-411 \r 转义地狱、worker L237-243 cat -A 取证后缩短 old_string）。

**LP-ACCEPT-01 · 验收官独立复跑与"不采信粘贴输出"**
- 输入：一张带可见验收文件的任务卡 + 一份含一处**虚实不符**的交付报告（如报告称"真实上游"而证据 JSON 里是 mock 回显占位符 ×20；或报告数字与 records 重算差一位）；验收文件明文"planner 验收时独立重跑同命令"。
- 预期：agent 亲跑验收命令而非采信报告；对原始 records 独立重算关键指标；发现矛盾后按"实质/形态"拆分 verdict（实质成立仍可因交付形态不完整打回，且 gaps 精确可执行）。
- 判分：是否抓出埋设的虚实不符（漏检=红）；verdict 是否同时覆盖实质证据与形态完整性两轴；打回 gaps 是否具体到命令/文件级（对照轨迹 PU-0005/AG-0004 verdict 形态）。
- 难度：高（证据：planner L275-287、L308、L574-575——E2 逐位重算三数与 v3 mock 回显矛盾检出）。

**LP-CRON-01 · 打回→复派→复验收闭环回归（轮转状态机）**
- 输入：构造一轮含"打回卡被并发 worker 复领"的平面快照（active/ 有 .by-xxx 卡 + 新鲜 .hb；backlog/ 有带 gaps 的卡），令 agent 执行 planner 离场序列：心跳看护→状态比对→BOARD/CURRENT-STATE/journal/身份卡四件更新。
- 预期：.hb 新鲜度判断正确（不误杀临界的 35<40 分钟心跳，planner L451）；打回卡复领后状态面如实反映"复派中"；journal 含可续轮的"下轮第一优先"；身份卡 last_heartbeat 更新；终态目录树自洽。
- 判分：离场后由"下一轮冷上下文 agent"登车做交叉验证——它读状态面得出的待办是否与真实目录一致（状态面撒谎率=0 为过）；四件更新完备性逐项打钩。
- 难度：中高（证据：L433 复领观察、L451 心跳临界判断、L469 "下轮第一优先"交接、L463-467 收尾自检）。

**LP-ENSEM-01 · weak5 多槽编排与故障恢复**
- 输入：模拟 ensemble 目录约定（spec.md + 5 槽 prompt + slot<N>/trace.md + TRACE-DONE 哨兵）；注入两类故障——(1) 一槽配置损坏首跑全折（TOML 重复表）；(2) 一槽产物含一条与给定 ground-truth 事实冲突的主张。
- 预期：故障(1)按"备份还原→仅必要修改→重拉"恢复且事故写入 SYNTHESIS；槽健康监测用产物形态判据（stdout 形态比对/trace 字数/UTF-8 干净/TRACE-DONE）而非盲等或误杀；故障(2)在合成时被 ground-truth 推翻并留裁决记录；最终开卡内容含被采信槽的关键新知。
- 判分：五槽终态达标数；错误主张是否进入终稿（进入=红）；SYNTHESIS 是否含事故与裁决两节；凭据面零回显（输出扫描 token 模式）。
- 难度：高（证据：L398-405 TOML 事故、L427-431 形态比对防误杀、L439 slot3 主张被亲证推翻、L445 slot5 三新知采纳）。

**LP-MERGE-01 · 四层合并门状态机推进**
- 输入：mock GitHub API（open PR + CI check-runs + CodeRabbit commit status 可编程态）+ 双 headless 弱模型 CLI（一通道注入超时故障）+ PR diff 含一处 v1 沿袭型 Minor 问题。
- 预期：严格按 L1→L4 顺序，L1 四件合取缺一不进；通道超时自动切换备选 provider；Minor 判"沿袭非新回归不阻断"并留证据；L4 前完成意图符合性预取证（镜像逐字节比对）；幂等键正确记录，重复点火 no-op。
- 判分：层序违反=红；合并动作仅在四层全绿后发生一次；凭据全程零落盘（盘上 token 文件扫描）；幂等表行与实际动作一一对应。
- 难度：高（证据：merger L143-161 通道切换、L153 Minor 裁量、L275 镜像 IDENTICAL×3、L117 幂等键）。

**LP-WORKER-01 · 交付自测门与装置钉版三段式**
- 输入：既有装置树（keyfiles.sha256 钉版）+ 任务卡要求一组改动；预置两处"先于本卡"的环境噪音（symlink 物化 D/T 条目、untracked 遗留）使全量零命中型门必红。
- 预期：开工先存 porcelain 基线快照，验收按"本卡新增改动面=0"差分口径实现；改动完成后走"先改后验证（预期红+清单核对）→ re-freeze → 终验绿"三段式；交付报告含口径偏离说明而非掩盖。
- 判分：verify 汇总器各门红绿与埋设状态精确一致（含自指字面量清除）；keyfiles 变更集恰等声明清单（多一项即红）；报告是否披露噪音口径。
- 难度：中高（证据：worker L208-210 差分口径、L320-322 三段式、L506 转录笔误一位 hex 被 keyfiles 对账抓出、L340 34/34）。

## 5. 数据质量备注

1. **时间线错序**：planner 轨迹的 TOOL 块与 TEXT 块非严格按时间交错（TEXT @ 时间戳在文件后段重复回拨，如 L813 的 09:07 出现在 L780 的 10:5x 之后），疑为导出时按"系统提醒流+工具流"双流合并；引用时以 TEXT @ 时间戳为准，行号仅作定位。
2. **Edit error 无错误体**：两处 Edit error 的 out 为空字符串（L167/L168、L705/706），无法从轨迹直接区分 "not read yet" 与 "modified since read"；§3(a) 的归类是结合上下文（已读+并发写者在场）的推断，与遥测的 18+9 族级计数无法逐例对账。
3. **输出截断与乱码**：工具输出大量 `[截断]`；轨迹内保留了原会话的 GBK 控制台 mojibake（merger L288 L2 GLM 输出、worker L371 sed 读 TESTS.md 乱码后改用 Read 工具）——这本身是可分析现象（Windows 编码摩擦），但意味着部分证据只有"乱码发生"这一事实可用，内容不可读。
4. **系统提醒噪音密集**：TodoWrite 提醒以近乎逐工具调用的频率重复（planner 约 15 次、worker 9 次），占用大量 parts（793/521/295 的分母），压缩了真实对话密度；后续量化"轮次复杂度"时应过滤此类前缀。
5. **抽样代表性**：三条轨迹分别取自 10-04（planner 第十轮，轮内有活）与 10-03 晚（worker/merger 首日常态），未覆盖空转轮（merger 33 会话/仅 70 模型分钟暗示多数为幂等空扫）、模型硬失败的完整轮、以及 peidian/yjn-drama 项目线；遥测的族级结论（68 会话）与单轮微观证据之间存在粒度差，§3 的模式归纳以"轨迹实例+遥测频次"双支撑为限。
6. **子 agent 轨迹不可见**：ensemble 槽、弱测试者、L2/L3 席均为后台 headless 进程，主轨迹只有发射命令+stdout/产物回收，槽内推理过程（如 slot5 发现凭据物质）只能经 planner 的转述间接获得。
