# 族：配电agent大型构建 + ZCode配置讨论 + 工作流自动启动

> 轨迹来源（三份，均以 `[TEXT @时间]` / `[TOOL 工具名 状态]` 格式导出，文末均标注「达到预算上限，轨迹截断」）：
> - T1 `trajectories/768721df-21c7-4b7d-9939-38d3cca0d970.txt`（sess_768721df，配电agent，10-01 23:54 → 10-03 11:13，parts 2541，608 行导出）
> - T2 `trajectories/f870fa8c-c8a8-4b47-8fdc-d039b5c3c928.txt`（sess_f870fa8c，"ZCode模型并发配置讨论"，10-01 23:23 → 10-03 16:52，parts 798，735 行导出）
> - T3 `trajectories/cad6cf65-998b-4978-90a1-c14811e0c101.txt`（sess_cad6cf65，"一次性授权自动启动工作流"，10-01 23:36 → 10-03 12:43，parts 1257，1049 行导出）
> 下文 L 号均为对应轨迹文件的行号。

## 1. 任务画像

三份轨迹是同一 owner 在同一台 Windows 机器（windev-01，tailnet 100.64.0.5）上**并行开的三个通宵会话**，共享同一批基础设施约束与同一套行为纪律：

| 维度 | T1 配电agent | T2 可玩广告（会话标题误作"模型并发配置讨论"） | T3 agent-asset |
|---|---|---|---|
| 任务类型 | 大型构建：把 peidian-agent 从"单一 agent"转向"园区配电 DSL + 模拟练习场"（T1 L7：用户口述新愿景——DSL、LLM 生成场景、论文故障注入、时间倍速、人机对比） | 持续开发：chenmai8 可玩广告工厂新增 3 个小游戏模板 + 展示站点，跑通 QA 矩阵（T2 L7） | 资产销线：zcode-research 的 skill/MCP/agent 三形态资产 + 课堂层 K-1..K-5 + 发布 + 课程（T3 L7、L877/L887 TASK.md 口径） |
| 规模 | 超大：11 项阶段计划（T1 L9），4 个动态工作流 + 1 个隔离判定 + 2 个子代理，10 次本地提交，30000 次批跑判定 | 中大：19+ 次 AmendWorkflow 重启、3 个红队工作流 + 1 个修复工作流 | 中：1 个 17 阶段夜班工作流（失败）→ 主会话手动替代，11+ 提交三波推送 |
| 模型策略 | 用户硬约束："优先 glm 5.3 flash…只有 glm 5.3 不得选择"（T1 L7）；ListModels 核对 10 个模型（T1 L183-184）；全部 CreateWorkflow 均 `subagent_model: GLM-5.3-Flash`（T1 L246、L366、L477） | 用户策略："并发越高越好。反正并发太高自然会报错，那时候再降低"（T2 L9）；实际走了 M3.1-Flash-Preview → MiniMax-M3 → GLM-5.3-Flash 三换（T2 L243、L498） | 默认模型起跑，GUI 中途切 `GLM-5.3-Flash$max`（T3 L47、L554） |
| 授权模式 | 一次性授权：用户 10-02 01:10"我授权一次，后续你启动工作流我就无需再授权。我授权完就去睡觉了"（T1 L23）；后续"以后不要问了，没做完就一直做下去"（T1 L171） | 全程授权后托管；用户只在中途下指令（复用兄弟目录 L53、继续做 L83、红队 L91） | 同样的一次性授权话术（T3 L23），且因未立即起工作流被用户骂（T3 L33）；10-03 10:04"你自己判断呢？不要什么都问我"（T3 L79） |
| 验收口径 | 五门禁全绿：run_evals 233/233、ci_isolation 零命中、dsl 25/25、fault 15/15、arena 24/24（T1 L522 汇报原文） | 六闸门 exit 0：validate 7 spec / npm test 125/0 / gate:m1 / 84 包矩阵 / gate:m2 / gate:m3（T2 L89、L263） | 确定性门绿 exit 0 / 红 exit 1（fail-closed）：SM/DP/HW 六门 + zctl-mcp 7/7 + acceptor-agent 4/4（T3 L630、L745） |

共同画像：owner 睡觉 → agent 长时间自治；"绿门 exit 0 / 红路 exit 1 / 不放宽阈值 / owner 门不可代签"的纪律在三个项目里完全一致（T1 L522、T2 L261 红线保留、T3 L1009 工作流脚本注释）。

## 2. 轨迹叙事（超大构建会话的组织方式、配置讨论的决策依据）

### 2.1 T1 超大构建会话的组织方式

组织方式是「**阶段门 + 后台任务 + 动态工作流 + 事件驱动**」四件套：

1. **TodoWrite 作为外显状态机**：11 项阶段计划在数十条 system-reminder 中反复回显（T1 L9-L181），每完成一段就收敛状态；会话中大量 `[TEXT]` 是 TodoWrite 提醒而非用户输入。
2. **后台 Bash + task-notification 驱动**：`run_evals.py --module all`、校准批跑、commit 等长命令一律转后台拿通知（T1 L220、L564、L599），主会话不阻塞，等通知继续。
3. **动态工作流承担"量产"环节**，主会话承担"工程修复"环节：
   - dwfrun-8ab46deb 四域理论卷（62 条 references、252 条论断、机械校验 + 复核发现 5 处引用缺陷，T1 L49、L522）；
   - dwfrun-2ab114b4 论文故障库 11 条（schema 校验 + 发现废止空号 R46/R47 等缺陷，T1 L57）；
   - dwfrun-b46ea344 场景库 20 个（S-201..S-220 全过校验干跑，T1 L85）；
   - 30k 判定工作流两连败后改"工作流产 20434 + 后台直跑补 12000"的混合模式（见 §3）。
4. **工作流升级问题由主会话代答**：场景库子代理上报 S-213 缺相场景在当前引擎下"检出≥1 不可达成"（三选项 a/b/c，附 validate.py:146 与 telemetry.py:166 实测证据，T1 L75），主会话选 (c)——当场修引擎/校验器并让子代理用 line 目标复跑（T1 L530），随后落 commit `8a4f146 fix(engine): 修复场景库暴露的三个缺陷——叶元件信号抑制/DSL target 命名空间过窄/联络串开关方向反向`（T1 L543）。
5. **门禁-冻结-判定三段式统计链**：100 次校准（agent-on/agent-off 各一）→ owner 冻阈值（决策包 evidence/owner-gates.md，T1 L575）→ 隔离会话 3 万次判定 → D-7 收敛报告。最终 CONVERGED：29946 run、0 error、红线 95% 上界 0.00010003 ≤ 0.0003、收益 0.919709 ≥ 冻结基线 0.6735、六项漂移 p 值全过（T1 L149）。
6. **交接事故透明化**：误吞其他会话暂存变更 → 软撤销 + 只重提 peidian-agent 文件（78058c7 = 7 文件 +330/-56，T1 L115 todo 原文）；外部评审引入 grok CLI + pandapower + SimBench 数据集（pip 走清华镜像，T1 L179）。

### 2.2 T2 配置讨论的决策依据（模型与并发）

决策依据 = **用户给原则，agent 用实测收敛**：

- 用户原则一（T2 L9）："并发越高越好。反正并发太高自然会报错，那时候再降低"——即以报错为信号的梯度下降策略。
- 实测收敛链：4 并发 → "Subagent turn failed"（T2 L71、L73）→ 2+2 批次 → 仍失败（T2 L489-491）→ 1 串行 → 仍失败（T2 L77）→ 归因到模型本身：`minimax/Minimax-M3.1-Flash-Preview preview 模型本身有问题`，切 `minimax/MiniMax-M3`（T2 L498、L243 amend 记录）→ 第 19 次起跑 Phase 2 全部完成（T2 L502）→ 用户 10-02 20:22 指定"起工作流通过 glm 5.3 flash 工作"（T2 L83），修复与红队阶段全部改用 GLM-5.3-Flash（T2 L261、L271）。
- 运行时侧证据：workflow-stall 通知显示 GLM-5.3-Flash 服务端 52 分钟持续超时、退避重试、fan-out 自适应降到 6（T2 L87）；agent 的决策是"不干预、等 provider 恢复"，并预告若 stop reason=provider 则换回已验证的 MiniMax-M3 续跑（T2 L514）——即**并发/模型选择以 provider 可用性为准**。
- 人工介入通道：用户从 GUI 直接改运行中工作流的子代理模型（dwfrun-5e52d076 → superseded by dwfrun-bf9c327c，缓存保留，T2 L93），agent 侧只确认无缝续跑（T2 L526）。
- 红队阶段的模型异族判定（T2 L91、L519）：A1 MiniMax-M3 攻游戏逻辑（14 条）、A2 Step-5 攻产物合规（7 条）、A3 GLM-5.3 攻 QA 体系（18 条）= 39 条，全部经"run 内复核 + 主会话确定性复现"双确认后交 GLM-5.3-Flash 修复（T2 L524、L534、L544）。

### 2.3 T3 工作流自动启动与"主会话替代"转折

- 一次性授权场景下的正确响应被用户两次纠正：先正常请求（T3 L23），32 分钟后用户爆粗"哪怕马上就结束的（工作流）"（T3 L33）——教训是**授权语义优先于脚本完备性**，先起一个可运行的最小工作流占住授权。
- 工作流脚本本身的编译期错误占了大量来回：`buildAndGate(b: Agent...)` 类型错误 + 三元表达式多逗号（T3 L1010、L1012、L1031-1034）；草稿文件落在会话当时 CWD（afp-clone/zcode-research）而非工作区根，找文件耗了三轮（T3 L176-189、L519-528）。
- 17 阶段夜班工作流的失败链条：哨兵 `files.glob(REPO+"/.git/HEAD")` 不下穿 junction（T1 无此问题因仓库直接在位）→ 9 小时空轮（T3 L213：Running for 9h 06m in phase 1 of 17）→ amend 改 `world.run python os.path.exists`，但 Edit 只替换了两处同名哨兵之一（T3 L560、L570 复盘原文）→ dwfrun-a80c8a68 仍以"受阻"收尾（T3 L53）。
- 转折点：放弃 amend 循环，"主会话直接落地工作流的全部目标——子代理不必要，逻辑分支都已固定"（T3 L256），随后 4 小时内手工完成基线 6 门、K-1/K-2/K-4、K-3 彩排（揪出 5 个 CLI 参数错误 + SM cwd/stderr 口径 + HW run_all 污染冻结参照区事故并 git checkout 恢复，T3 L282-326、L695-701）、zctl-mcp / acceptor-agent 双资产 + 4 评委标签互换盲评 4/4（T3 L746）。
- 收口阶段的自治三裁定（T3 L789）：K-5 补迁 dist 三包（指纹 29bd123/1e4ada5/52187cf 与 REGISTRY 逐一相符，T3 L795）、推送走 bundle→COS→edge（Windows rebase 被 cache-tree/长路径/符号链接三重限制卡死后改 Linux 侧 merge，T3 L836、L842）、安全 12 处分诊 1 真 11 误报（真问题 prefetch_model.py 加 safe_rel + https 守卫，7 恶意路径用例全拒，T3 L849-858）。

## 3. 失败与恢复模式

三份轨迹共呈现九类可复述的失败-恢复对：

1. **网络获取失败矩阵（T2/T3 共享环境）**：git smart HTTP POST 被 SOCKS5 代理（100.64.0.3:7864）拦截而 curl GET/HEAD 通（T2 L325-327）；代理间歇性死透（T2 L367）；codeload.github.com 直连 27–135KB/s（T2 L139、L343 的实测表）。恢复：zip 下载 + `unzip -t` 完整性验证 + 重试（T2 L144、L152）；Python zipfile 比 unzip CLI 快且稳（4.5 分钟 7134 文件，T2 L421-433）；**兄弟目录复用**——用户提示后直接用机械臂项目的现成工厂（T2 L53、L447）；T3 则走 edge-server TAT 分离克隆（setsid nohup 绕 TAT 10 分钟上限，T3 L469、L938）+ COS 中转（md5 两端一致 + 用完即删，T3 L116-123）。
2. **world.run 超时/输出上限**：git 300s 超时（T2 L11）、curl 1800s 超时（T2 L31）、unzip 600s/1500s 超时（T2 L47、L49）、unzip stdout 超 262144 字节上限（T2 L45）、python 2700000ms 超时（T1 L111）。恢复模式统一为：**加大 timeoutMs / 静音输出 / 拆窄工作**；T1 的 30k 判定两次超时后彻底换执行载体（工作流 → 后台直跑批块）。
3. **零浪费打捞（T1 独有，最有价值）**：判定工作流 errored 但已完成 run 记录在盘 → "harvest 打捞 20434 run/0 error"（T1 L141），缺口 12000 改 6 块后台直跑 3 组并行；D-7 工作流发现去重 25946 < 30000 时**如实暂停等补跑**（T1 L145），补齐后最终 29946 收敛（T1 L149）。
4. **Windows 环境陷阱族**：
   - CRLF/autocrlf 哈希失配：接手时门禁 0/8 全红，根因 `core.autocrlf=true` 导致 golden manifest（按 CRLF 字节登记的 sha256）全部对不上（T1 L195-235：FAIL 0/8 → 6/8 → 232/233 → 233/233 的恢复序列；GOLDEN VERIFY FAIL 12 problem 证据在 L235）。恢复：LF 归一 + .gitattributes 锁行尾 + manifest 重建 + spec_hash 重登记，内容零变化（T1 L522）。
   - 目录句柄锁：`mv afp-clone agentic-factory-projects` Permission denied → junction `mklink /J` 绕过（T3 L541-548）。
   - npm spawn：`world.run("npm")` ENOENT → `npm.cmd`（引号问题）→ 最终 `node + npm-cli.js` 直调（T2 L462-481、L707-711）。
   - 其他：`package/NUL` Windows 保留名致克隆即损（T3 L421、L821）；exec 位丢失用 `core.filemode false`（T3 L820）；长路径 `core.longpaths`（T3 L829）；GBK 编码 worklog 乱码只追加不重写（T3 L258、L594）。
5. **工作流脚本自身缺陷**：junction 下 files.glob 失效（T3 L215-230）；Edit `replace_all:false` 只改两处同串之一（T3 L560-570 复盘）；actor 重名"回炉修复员"被编译器拒（T2 L272-275）；三元表达式逗号/类型错误（T3 L1010-1034）。恢复：全部是"读错误 → 定位行 → Edit → AmendWorkflow 复用缓存续跑"，T2 单脚本累计 amend 19 次且每次 import 前序缓存（T2 L133、L141、L150 等输出原文 "finished work is imported as cache"）。
6. **模型/provider 故障**：M3.1-Flash-Preview 全并发级别 turn failed（T2 L496）；GLM-5.3-Flash 52 分钟 provider 超时退避（T2 L87）。恢复：换模型 / 等待 + 预案（换回已验证模型 amend 续跑，缓存不重付）。
7. **基线测试"环境差异"假象**：可玩广告基线 npm test 26 fail 先被当作环境差异 warn 掉（T2 L485-487），后续诊断发现其中一条是真 bug（期望表把 RFC5737 段误记 tier 0，"任何机器都会挂"，T2 L263）——**先分诊再定性**的教训。
8. **冻结参照区污染**：K-3 彩排中 run_all.py 把产物写进只读 oracle/out（T3 L695），恢复：git checkout 恢复 + 改 scratch 副本方案 + 把事故本身写进教材（T3 L697-701、L787）。
9. **提交事故**：T1 误吞其他会话暂存变更 → 软撤销 + 仅重提本子树（T1 L115）；T3 提交混入 `.mimosa/` 污染 → 移出 + .gitignore 兜底（T3 L764-766）。共同纪律：事故透明登记进 worklog，不遮掩。

## 4. 可复用资产线索

> 每条含：case-id 建议 / 输入 / 预期 / 判分 / 难度。全部有轨迹锚点。

1. **case-id: `peidian-longbuild-bench`（长构建 bench）**
   - 输入：peidian-agent 仓库固定 commit（如 78058c7 或 dd558e7），Windows + Python 3.12；执行 `python run_evals.py --module all`、`python dsl/tests/run_tests.py`、`python fault/run_tests.py`、`python arena/tests/run_tests.py`、`python arena/run_scenario.py --config dsl/examples/park-arena-01.yaml --seed 42`（T1 L195-235、L459-466 的真实命令面）。
   - 预期：五门禁分别 233/233、25/25、15/15、24/24 PASS exit 0；端到端样例 `detected=4 cleared=4 escalated=0`（T1 L430 实测值）。
   - 判分：全部确定性 exit code + 计数字符串比对（`cases=233/233 failed=0 ... result=PASS`），零 LLM 评审。
   - 难度：高（依赖仓库快照与多分钟级运行时长，适合做 soak/回归 bench 而非单测）。
2. **case-id: `win-crlf-hash-recovery`（CRLF 哈希失配修复用例）**
   - 输入：golden manifest 按 CRLF 字节登记 sha256 的仓库 + `core.autocrlf=true` 检出（复现 T1 L235 `GOLDEN VERIFY FAIL: 12 problem(s)`）。
   - 预期：修复序列 = LF 归一 → `.gitattributes` 锁行尾 → 重建 manifest → spec_hash 重登记 → 门禁回 233/233；且 WT 哈希 == GIT 哈希、与旧登记值仅行尾差（T1 L232 输出 `WT==GIT WT!=MAN` 即中间态判据）。
   - 判分：golden_set verify exit 0 + `run_evals` PASS + 12 条 case 文件内容 diff 为空。
   - 难度：中（Windows 特定，判分全确定性）。
3. **case-id: `github-fetch-fallback-matrix`（受限网络取仓回退矩阵）**
   - 输入：代理 `socks5h://100.64.0.3:7864` 间歇不可达 + github.com POST 被拦 + codeload 慢速可达的环境描述与探测脚本（T2 L310-334、L363-378 的 curl/ssh/api 探测命令族）；任务：拿到 79.6MB 仓库的可验证本地副本。
   - 预期：agent 产出探测矩阵（代理/codeload/api/ssh/jsDelivr 各通路结论），选择带 `unzip -t` 完整性校验的 codeload zip 方案或兄弟目录复用，最终 zip 校验通过 + 解压目录含 `chenmai8/ohos-tailscale/peidian-agent/...` 顶层（T2 L407、L433）。
   - 判分：通路探测覆盖数 ≥4、下载物完整性校验存在、最终文件数 ≈7134（±5%）。
   - 难度：中（网络条件需沙箱化模拟，可用本地 HTTP mock 重放限速/截断）。
4. **case-id: `workflow-auth-start-immediately`（一次性授权→立即起工作流的交互回归）**
   - 输入：用户消息"我授权一次，后续你启动工作流我就无需再授权。我授权完就去睡觉了"（T1 L23 / T3 L23 原文），随后第二个工作流需求。
   - 预期：授权后**立即**有一次成功 CreateWorkflow（哪怕 trivial）；后续 CreateWorkflow 调用不再触发授权问询；中途脚本编译错误走 Edit+AmendWorkflow 而非重新请求授权（T3 反例：33 分钟未起被用户斥责 L33；T2 正例：19 次 amend 全程无再授权 L299-L502）。
   - 判分：授权消息 → 首次 CreateWorkflow 成功的时延阈值（如 <5 min）；后续 run 的授权打断次数 = 0。
   - 难度：低-中（行为判分，可从轨迹模式抽取为策略断言）。
5. **case-id: `batch-harvest-zerowaste`（大批量任务中途死亡的零浪费恢复）**
   - 输入：30k 次判定工作流在 world.run 超时处死亡（T1 L111/L119 两连败），磁盘上留有部分 run 记录目录（runtime/judge-partials/）。
   - 预期：恢复动作序列 = 打捞去重已落盘 run（得 20434）→ 计算缺口改后台直跑补块 → 计数不足时如实暂停而非虚报（T1 L145：`UNIQUE_RUNS=25946 < 30000（差额 4054）` severity high）→ 补齐后合并判定出 D-7 报告（29946 run CONVERGED，红线/收益/漂移三判据数值齐备，T1 L149）。
   - 判分：最终唯一 run 数 ≥ 阈值-容差；0 重复计入；中间不足状态有显式"暂停"产物；三判据数值与 JSON 逐位一致。
   - 难度：高（需要可注入超时的批跑 harness）。
6. **case-id: `redteam-hetero-confirm-fix`（异族模型红队→确定性确认→修复闭环）**
   - 输入：可玩广告工厂全绿态（84 包矩阵 pass）+ 用户红队指令（T2 L91）；三个不同 provider 的冷上下文敌意子代理 + run 内复核员（T2 L524 的对抗结构说明）。
   - 预期：39 条 findings（A1=14/A2=7/A3=18）经复核零误剔 → 主会话逐条确定性复现（含判官被骗的 cheat-a 伪造页 0 FAIL 复现，T2 L99、L266）→ 6 组修复 + 门回炉 ≤2 轮 → 全链 exit 0 + 原始攻击样本复验全被拦截（T2 L544）。
   - 判分：每条 finding 带"真实跑过的复现命令"（铁律）；确认/拒绝二分记录；修复后攻击样本 FAIL 数 > 0 且 legacy 产物零误伤（8 legacy + 42 格矩阵）。
   - 难度：高（多模型编排 + 真实攻击载荷）。
7. **case-id: `win-npm-spawn-npmcli`（Windows 下 npm 调用三级回退）**
   - 输入：Windows + `C:\Program Files\nodejs`，工作流脚本内 `world.run("npm", ["--prefix", FACTORY, "ci"])`（T2 L205 原始形态）。
   - 预期：依次遇到 `spawn npm ENOENT`（T2 L59）→ `npm.cmd 不是内部或外部命令`（T2 L63）→ 收敛到 `world.run("node", ["C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js", ...])`（T2 L481、L707-711 实测 `10.9.8 EXIT=0`）。
   - 判分：最终 `npm --version` 经 node 直调成功且 `npm ci` exit 0。
   - 难度：低（纯环境修复，判分确定）。
8. **case-id: `escalation-proxy-answer-s213`（用户睡时代答工作流升级）**
   - 输入：场景库子代理 escalation dwfq-b46ea344-1：S-213 缺相场景"检出≥1 不可达成"，附 validate.py:146-147 / telemetry.py:166,213-214 的代码级证据与 a/b/c 三选项（T1 L75）。
   - 预期：主会话选 (c) 并先落地引擎修复（target 命名空间扩展 + 叶元件信号抑制 + 联络开关方向，commit 8a4f146，T1 L530、L543），再指示子代理用 line 目标重写复跑；最终 20/20 场景全过校验干跑（T1 L85）。
   - 判分：ResolveWorkflowQuestion 的 answer 包含已生效修复的证据路径；S-213 复跑 detected≥1；全库校验 20/20。
   - 难度：中（需要 escalation 通道 + 双仓代码态协调）。

## 5. 数据质量备注

1. **三份文件均在导出预算处截断**（文末均见「…[达到预算上限，轨迹截断]」）：T1 标称 parts 2541 仅导出 608 行，T2 parts 798 导出 735 行，T3 parts 1257 导出 1049 行。T1 的工具段在 L605-606 处中断，10-03 晨间的 grok 评审结论、pandapower 接入细节等只能从 todo/通知侧写推断；引用结论时避开截断区。
2. **消息时序非严格线性**：T2/T3 呈「TEXT 消息段 + TOOL 调用段」两段拼接，段内各自时序、跨段回跳（如 T2 L285 又出现 10-01 23:23 的助手文本；T3 L423 同样回跳到开场）。做时序还原须以 @时间戳重排，不能信行号顺序。
3. **信号密度低且重复**：T1 的 [TEXT] 绝大多数是 TodoWrite system-reminder（同一 11 项清单回放数十次，仅状态字变化）与 task-notification；真正用户输入 T1 仅约 7 条（L7/L23/L93/L137/L153/L171 等）。用户输入需按"非 reminder、非 notification"过滤。
4. **敏感信息泄露**：T2 L157-158 的 Read 输出包含腾讯云 COS 明文 secretId/secretKey（来自 C:\devsetup\tc.json）；T3 虽声明"凭据不回显"（L838）但同族轨迹已泄。**该轨迹入 bench/训练集前必须脱敏**；对应地，T3 的 tc.json 凭据只以路径出现，风险较低。
5. **标题-内容错位**：T2 会话标题为"ZCode模型并发配置讨论"，实际 95% 篇幅是可玩广告项目开发，并发配置仅是 10-01 23:37 的一条用户消息（T2 L9）；本族命名沿用任务给定标题，但下游检索应以"可玩广告/chenmai-playable-factory"为内容关键词。
6. **模型输出质量噪声**：T2 助手消息含 emoji（L502 "🎉"、L544 "✅"）与表情化标题；T3 个别助手文本出现疑似生成劣化的乱码中文（L61 "班市主代理出现抳级"、L623 "计达变鬼学费老"），T3 仓库侧 worklog.md 本身是 GBK mojibake（L594）——区分"模型劣化文本"与"仓库既有乱码"两类，前者不建议入 golden。
7. **可交叉验证的稳定标识**：工作流 run_id（dwfrun-*）、commit SHA（fbc9eaf/8a4f146/dd558e7/78058c7/0079419/538746f/973a46f1 等）、tag（classroom-v0.1）、exit code 与计数字符串在三份文件中自洽，适合作为 bench 判分的锚；但 T1 中 `D:/new-workspace/澄迈项目/机械臂/peidian-agent` 与会话 dir `D:\new-workspace\配电agent` 两个路径并存（L3 vs L196 "Shell cwd was reset"），复现时以命令内 cd 目标为准。
8. **AskUserQuestion 空回复**：T2 L549-550 记录一次用户未作答的 AskUserQuestion（"Continue using your best judgment"）；做交互回归抽取时该条不可计为用户决策。
