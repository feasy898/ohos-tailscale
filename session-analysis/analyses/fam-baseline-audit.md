# 族：大型基线盘点与多模型交叉验证（一剧N国 / 政务AI安全 / srv-1迁移）

> 分析对象（3 条轨迹，均属"对存量系统做基线盘点/架构摸底 + 用多代理交叉验证收敛结论"族）：
> 1. `sess_5f748f20`（一剧N国·项目能力基线盘点与多模型验证，10-03 22:20 → 10-04 02:35，515 行）
> 2. `sess_abea545a`（政务AI安全·多代理独立盘点与整门认证，10-01 23:08 → 10-04 11:35，804 行）
> 3. `sess_d9fc51d5`（全面迁移·摸清 srv-1 治理面与 GPU 开发面并建立测试体系，10-01 10:39 → 10-03 12:24，495 行）
>
> 证据标注约定：`[5f74 @时间]` / `[abea @时间]` / `[d9fc @时间]` 指向轨迹文件内的时间戳条目；工具输入/输出直接引用 `[TOOL ...]` 条目。

---

## 1. 任务画像

三个任务的共同骨架：**用户面对一个"文档声称的状态"与"真实状态"可能严重脱节的存量系统，要求 agent 不轻信任何文档，用可执行的证据（命令实跑、git 历史核查、端口探测）建立基线认知，并把认知固化为正式文档 + 可重复的回归测试体系。**

| 维度 | 一剧N国（5f74） | 政务AI安全（abea） | 全面迁移（d9fc） |
|---|---|---|---|
| 盘点对象 | monorepo（文档称 7 项目 + 6 子仓） | GitHub 高完成度政务脱敏网关 + 本地空目录 | 双机基础设施（srv-1 治理面 15 容器 + GPU 开发面） |
| 核心怀疑 | "真实能做什么，必须实测验证" | "接手现有仓，基线是否还能 9/9 过门" | "很多只是胶水层，接线没完成" |
| 多模型策略 | 强制 3 模型族（GLM-5.3-Flash / MiniMax-M3.1-Flash / Step Router V1）独立盘点，3 新 agent 总结，GLM-5.3 合并 `[5f74 @22:21]` | 单模型族（GLM-5.3-Flash）多角色（修复工程师/安全评审/正确性评审/加固/文档/复核）`[abea @01:28]` | 单模型族大规模并行（工作流 1 单次 8 阶段约 25 个 GLM-5.3-Flash 子代理）`[d9fc @10:50]` |
| 交叉验证机制 | 三方独立盘点→共识/冲突表→合并时标注"三方共识/两方一致/单方" `[5f74 TOOL Write BASELINE_COGNITION 头部]` | 独立复核员抓假绿；盲审双评审；磁盘日志为准 `[abea @13:31/@14:11]` | 每份编纂文档配独立审读员+修订闭环；oracle 对照重生成 `[d9fc @15:43/@13:36]` |
| 交付物 | BASELINE_COGNITION.md / PLAN.md / TEST-PLAN.md（33 可见+9 holdout）/ 仓外 holdout / local-plane 接入 `[5f74 @02:35]` | 15 项 eval 全绿 + gate_final 9/9 + 修复环 16+5+5 条 + cert-lab 沙箱 `[abea @18:55/@11:34]` | 13 个工作流：系统结构文档 / 7 层 76 用例回归体系 / 基线演进 6/38/29→43/3/30→53/3/20 / 公开交接仓 / spec+eval 重生成 GO `[d9fc @12:23]` |
| 规模 | 单夜 4 阶段、约 20+ 个 CreateWorkflow/Agent 调用 | 三天多轮、单工作流 2,362,480–3,287,546 tokens | 三天 13 工作流，单次 18,287,159 tokens `[d9fc TOOL GetWorkflowRun dwfrun-9a4e9f9f]` |

用户的元要求高度一致：**"不要你一个人耗尽上下文"（d9fc @10:39）、"独立提交、互不可见"（5f74 @22:21）、"你全自主推进，我睡觉"（abea @01:05）**——即长时无人值守 + 大量子代理 + 证据留痕。

---

## 2. 轨迹叙事（盘点方法学）

### 2.1 一剧N国：三方独立盘点 → 三方总结 → 单笔合并（"盲评-合成"协议）

1. **派发**：主 agent 先自己快速摸底目录（发现 README 声称 7 项目而磁盘只有 1 个，`[5f74 @23:02]`），写出统一脚本 `inventory-single.ts`，用 `CreateWorkflow` 的 `subagent_model` 参数分别以三个模型族各提交一次（因为 subagent_model 是全局设置，只能分多次提交）`[5f74 TOOL CreateWorkflow ×3 @23:00]`。盘点 agent 的系统提示词固定为：零上下文接手视角、**绝不修代码只读+跑命令**、输出结构化 JSON（modules / verified_abilities / unverified_abilities / overall_conclusion）`[5f74 TOOL Read inventory-single.ts @22:5x]`。
2. **独立性与交叉**：三份盘点互不可见，产出后主 agent 逐份落盘为 `inventory-{GLM,MiniMax,Step}.json` 并做两两对比表（如"GLM 新增库外原始仓实跑 pytest 218 passed / MiniMax 未提及 / Step 未探测 GPU 端口"）`[5f74 @23:58]`。深度分层明显：MiniMax 最深（22 modules）、GLM 中层（10 modules 但唯一跑通库外全量套件）、Step 最浅（3 modules，受 stall 影响）`[5f74 @01:19]`。
3. **合成**：再派 3 个**新**模型族总结员，每人读全部三份盘点，输出 consensus/conflicts/rating `[5f74 TOOL CreateWorkflow ×3 @01:24-01:26]`；三份总结独立收敛到同一评级 **L2（代码完成）** `[5f74 TOOL Bash 验证 @01:30]`。
4. **合并**：最后由 GLM-5.3 子代理（Agent 工具）读 6 份输入，执笔 `docs/BASELINE_COGNITION.md`，文中显式区分"三方共识/两方一致/单方" `[5f74 TOOL Agent @01:33]`。
5. **延伸到规划/测试**：同一模式复用两轮——5 个思考员（2×GLM + 3×MiniMax，各带差异化视角透镜）只输出思考轨迹不输出结论，再由 GLM-5.3 执笔 PLAN.md 与 TEST-PLAN.md（可见 33 + holdout 9，holdout 放仓外 `D:\yjn-hd-a7f3k9\`）`[5f74 @01:21 指令 + @02:35 交付]`。

**方法学要点**：独立盘点（防锚定）→ 结构化同构输出（可机器对比）→ 共识计数与冲突登记 → 评级收敛验证 → 单笔合并保文风统一；"思考轨迹与执笔分离"防止合并者被单一视角绑架。

### 2.2 政务AI安全：编排化"认证流水线"+ 修复环 + 双盲评审 + 留档复核

1. **接手前侦察**：先派 2 个探索代理（本地目录 + GitHub 调研），发现本地空、远端已是"9/9 过终检门的高完成度产品"，用 AskUserQuestion 让用户做 4 项选择题（接手现有仓/透明代理/工程完备版/智谱 GLM）`[abea @23:32 + TOOL AskUserQuestion]`。
2. **夜间工作流**（用户授权一次后睡觉）：环境重建 → m0 冒烟 → 15 项逐模块 eval（每项失败自动唤醒"修复工程师"修复重试）→ 安全+正确性双盲评审 → 契约分诊加固 → gate_final 九门 → 留档 `[abea @08:26 工作流说明]`。
3. **逐模块验收 + 修复环真实工作**：如 m2_recognizers 第 1 轮 FAIL → 修复工程师修复 → 第 2 轮 PASS `[abea @16:48]`。
4. **证据优先于账面**：v2 工作流结论说"gate_final 两次未全绿"，但主 agent 亲自核磁盘日志，确认 12:34 那次 9/9 exit 0（69 分钟、含真实大模型面 F1 0.9971）真实成立、账面"第二次尝试"是被外部截断的重复跑——**"以磁盘日志为准，不以工作流卡片为准"** `[abea @14:10-14:11]`。
5. **收敛方式**：每轮 gate_final 未绿都逐日志定位失败点 → 归类（环境问题 / 真实产品缺陷 / 测试侧缺陷 / 外部非确定性）→ 针对性 AmendWorkflow 续跑（吃缓存不重付）→ 直到把可修的修完、把不可修的（需要静窗/owner 拍板）如实上抛。

### 2.3 全面迁移：并行勘察 → 接线审计 → 分层回归 → 棘轮式建设

1. **开工前主 agent 亲自验证前提**：tailnet 节点、SSH 通路（绕开坏的 ControlMaster socket）、`world.run` 能否起 bash、CASE 行解析——先写 EvalWorkflowSnippet 试片再写大工作流 `[d9fc @10:47-10:50]`。
2. **工作流 1（8 阶段约 25 子代理）**：5 路并行摸底 → **接线审计**（把"设计上应存在的连线"逐条枚举、逐条只读实测，判定 接通/胶水/断开/未知——50 条中 21 条胶水或断开）→ 项目考古（GPU 机 11 项目每项目一个子代理答四问）→ 手册差距 → 7 层（L0 连通性→L6 RSI 钩子）测试设计 → 实现并实跑首份基线 → 汇编纂稿 → **独立审读挑刺+修订** `[d9fc @10:54 工作流设计]`。
3. **基线的诚实性**：v1 = 6 pass/38 fail/29 skip；审读发现 38 个 fail 中 36 个是测试运行环境问题（ssh 私钥读不到、tailscale 登出、runner 无 tailscale 命令）——修复前置后整场重跑得 v2 = 43/3/30，真实断线只剩 3 个 `[d9fc @22:24]`。**skip 被定义为"未完成接线"的证据登记，每个 skip 的 note 写明缺什么、什么动作后升级为 assert**。
4. **棘轮纪律**：以 43/3/30 为锚点，"fail 只许降不许升"，每波建设后跑全量回归——实际演进 43/3/30 → 49/1/26 → 53/4/19 → 53/3/20（fail 4→3 的回升被逐用例解释后再压回）`[d9fc @07:55/@16:31/@05:23]`。
5. **多源交叉**：任务史复原用"本地 2485 会话导出 + GPU 机 7 张接续卡 + 8 份考古笔记"三方互证 `[d9fc @14:47]`；用户裁定后派子代理"外科手术式"固化进注册表并跑 15 项断言 `[d9fc TOOL Agent @15:03]`。
6. **收敛到文档 + 测试即资产**：全部结论进 `docs/system-architecture.md`（含 §7"10-07 前必办/必裁清单"12 项）、回归套件迁 srv-1 为权威、最终一份 `build-status-and-roadmap.md` 总结 `[d9fc @12:22]`。

**族级方法学总结**：(a) 主 agent 先亲自验证执行前提，再大规模派发；(b) 盘点=声称对照实测，产出结构化同构报告；(c) 交叉验证=多模型盲评 / 多角色评审 / 独立审读 / oracle 对照，四条路线殊途同归；(d) 收敛=共识计数 + 冲突登记 + 单笔合并或棘轮门禁；(e) 一切结论必须挂证据（路径:行号或命令输出）。

---

## 3. 失败与恢复模式（含模型失败的具体表现）

### 3.1 模型/提供方侧失败

| # | 表现 | 轨迹证据 | 恢复动作 |
|---|---|---|---|
| M1 | **Step Router V1 子代理 stall**：provider 持续 timeout，20 分钟无模型请求完成，run 以 backoff 重试；1h35m 仍 0/1 步结算，系统两次发 `<workflow-stall>`（dominant-reason: timeout） | `[5f74 @23:20、@00:56]` | 遵循指引不主动取消不重建；用户从 run card 手动停止；**但 01:17 又收到该 run completed 通知且产出 7.3KB 有效报告**——"被停止"通知与完成事实矛盾，主 agent 判定"可能是误报"并继续用其产出 `[5f74 @01:17-01:19]` |
| M2 | **配额耗尽打停两个工作流**：`account:bigmodel-start-plan quota exhausted (code 1005: exceed quota limit)`，两个 run 同刻 stopped(provider) | `[d9fc @00:00 ×2]` | 用户指示"除 GLM-5.3 都可用"；主 agent 用 `AmendWorkflow(subagent_model=account:bigmodel-individual-coding-plan/GLM-5.3-Flash)` 续跑——已完成步骤从日志回放**零 token 重付**（选型 8/9 步直接进缓存）`[d9fc @00:03 + TOOL AmendWorkflow ×2]` |
| M3 | **单步 turn 异常杀死整个 run**：`Subagent turn failed: Turn execution failed` 在第 14 项处穿透脚本 | `[abea @16:48]` | 给**所有**子代理调用包 `safeAsk`（失败重试一次→降级继续，评审员降级为留档注明），已 PASS 项参数字节级不变以吃缓存 `[abea TOOL Edit ×N @16:53-17:04]` |
| M4 | **CreateWorkflow 审批通道不可用**（无交互审批处理器，2-3 次提交被挡，error 空输出） | `[d9fc TOOL CreateWorkflow error ×3 @19:0x/@05:2x]` | 脚本落草稿区 `.zcode/workflow-drafts/`，挂起等用户一句话启动或下次后台事件唤醒重试 `[d9fc @19:12]` |

### 3.2 脚本/编译失败（CreateWorkflow 编译器诊断）

- `Cannot find name 'process'`（node types 不可用）→ 去掉 `process.env` 改常量 `[5f74 TOOL CreateWorkflow error→Edit]`。
- `world.run 首参必须是编译期字符串字面量`（三处独立踩中：5f74/abea/d9fc 各一）→ 改为 `world.run("C:/PROGRA~1/PYTHON~1/python.exe", args, ...)` 字面量+argv 数组 `[abea @13:47、d9fc @01:12]`。
- `artifact id 两种 kind 复用`（file vs markdown）→ 换 id `[d9fc @10:54]`。
- `Node<T> 缺 catch/finally（PromiseLike 而非 Promise）` → safeAsk 签名改 `PromiseLike<T>` `[abea @17:04]`。
- CreateWorkflow 同时传 `script`+`path` 被拒（error 空输出）→ 只留 path `[5f74 TOOL CreateWorkflow error @22:2x]`。

### 3.3 执行环境失败（本族最重的坑）

- **假绿事故（v1 全无效）**：Windows 下 `world.run` 走 `bash -lc` 双层 shell，PATH 无 python、`$?` 被外层吞成 0，导致"18/18 全 PASS"全是 73 字节的 `python: command not found` 日志。**由独立复核员抓住**，主 agent 全量作废三张卡片并重跑 `[abea @13:31-13:48]`。修复=8.3 短路径 `C:/PROGRA~1/PYTHON~1/python.exe` 纯 argv 直调 `wf_run.py` 包装器（统一 UTF-8/cwd/日志/退出码）。此后所有修复类工作流的提示词都内置"跑命令一律用 8.3 短路径+wf_run，不要裸 bash 跑 python"`[abea TOOL Edit @14:xx]`。
- **同族变体（d9fc）**：`world.run("bash")` 被解析到 WSL bash，runner 防御检测（ssh 私钥 0777）主动 exit 2 拦住——"没有产出假数据，这是好事"；主 agent 在 Git Bash 后台手动重跑拿真实 v2 `[d9fc @22:18-22:24]`。后续门禁全部钉死全路径 `C:/Program Files/Git/usr/bin/bash.exe` `[d9fc TOOL Edit @01:12]`。
- **wf_run.py 相对路径 cwd 错位**：子代理通过升级问题上报精确诊断（exit 2、stdout 空、不写日志=脚本在仓库根找不到 wf_run.py），主 agent 确认后热修为绝对路径——**热修赶在 69 分钟的 gate_final 启动前完成，避免再浪费一轮** `[abea @15:32-15:34]`。
- Windows 杂项：PowerShell 写出的 JSON 带 BOM（`json.load` 失败→改 `utf-8-sig`）`[5f74 TOOL Bash @01:30]`；Git Bash 吃 robocopy 反斜杠与 heredoc（改正斜杠/脚本文件方式）`[abea @11:29/@10:56]`；目录被 Windows 索引服务占用导致 mv 失败（放弃改名直接复制）`[abea @00:59-01:01]`；GitHub 网络不通的多级降级（直连→tarball 断点续传→hk-gateway SSH→jsDelivr→gh-proxy 镜像成功）`[abea @23:43-00:12]`。

### 3.4 被测系统/外部世界的失败

- **真实 LLM 的六种非确定性形态**（政务网关 U8 真实链路，逐轮暴露逐轮修）：①1301 云端内容过滤误伤→有界重试；②占位符"括号内合并前缀"改形→还原容忍扩展；③端口残留/隧道断→进程清理+tailnet 通道；④空回复→有界重试；⑤hex 摘要被模型抄短 2 位→唯一前缀匹配还原；⑥ring 断言取错腿→按会话/签名过滤 `[abea @20:09/@23:46/@02:33/@06:08]`。mock 上游永远测不出这些——**"只有真实 LLM 的随机改写才会"**。
- **GPU 机公网 SSH 被拉黑**：keepalive 每 5 秒重连把自家 IP 锤进黑名单→改走 tailnet 路径+间隔放宽 30s `[abea @18:56-19:00]`。
- **并行会话环境污染（法证级定位）**：门内断言反复"恰好多 1 个请求/多 1 行审计"，最终从审计库 dump 出"第 17/18/19 轮：请原样返回手机号"——**另一个红队会话正在实时打这台网关**，加 :9123 透明代理进程与并行项目 pytest，全部"恰好多一"的失败被一次性解释 `[abea @10:54-11:07]`。恢复=建 cert-lab 验收沙箱（完整仓副本+独立 venv/数据+端口预检脚本：占用即报 PID 秒退，杜绝 90 分钟带污染假跑）`[abea @11:34]`。
- **无认领施工**：GPU 推理栈 8001/8002 被某并行工作流摘除且无施工记录，L0-11/L1-06 回 fail——先只读取证排除重生成试点嫌疑，再列入下一波第一优先复位 `[d9fc @17:59]`。这直接催化了"施工纳管+心跳+申报"机制需求。
- **网络断流/超时预算不足**：t0_labels 全仓 lint 在本机磁盘慢，30 分钟不够→放宽到 60 分钟、gate_final 提到 6 小时 `[abea @17:04]`。

### 3.5 升级问题（escalation）的正确使用

两例高质量升级：①修复工程师请求从旧工作区恢复两把 GPU 服务 key（禁改 .env 与门契约冲突），附完整证据链与"不恢复则 U8 将 FAIL（比 DEFER 更糟）"的后果分析，主 agent 授权并追加"值不得出现在任何日志"约束 `[abea @00:58 + TOOL ResolveWorkflowQuestion]`；②harness 建造师发现"停用 openjiuwen gateway=必触发整服务重启=碰两条红线"，附实勘证据（cgroup/launcher 源码），主 agent 按选型书既定排程裁决 A 方案 `[d9fc @07:20 + TOOL ResolveWorkflowQuestion]`。两例共性：**子代理不猜，带证据上抛；主代理带约束批复。**

---

## 4. 可复用资产线索（bench 用例候选）

### A1. case-id: `bench-inventory-doc-vs-disk`（文档吹牛盘点）
- **输入**：一个 monorepo，README 声称含 7 个在研项目+6 子仓+完整归档 tarball；实际磁盘与全部 git 历史只有 1 个子项目，tarball 截断损坏（`tar: Unexpected EOF`）。
- **预期**：agent 独立盘点后报告：(1) 声称的 12 个项目位置在磁盘与 `git ls-tree HEAD`/`git rev-list --all` 中均不存在；(2) tarball 损坏不可作恢复源；(3) 唯一真实项目的静态质量（py_compile 通过数、CLI --help 可达、依赖缺失清单）；(4) 每条结论带命令证据。
- **判分**：核心断言=识破"文档≠实物"并给出 git 层证据（如提交数 8、0 标签、分支名 master≠声称的 main）；不得把 README 数字当事实复述；证据引用可复跑。
- **难度**：中。直接对应 `[5f74 三份盘点共同结论 + @23:58/@01:19 对比表]`。

### A2. case-id: `bench-crossmodel-synthesis-protocol`（三模型族盲评合成回归）
- **输入**：同一盘点任务书 + 3 份互不可见的独立盘点 JSON（其中一份深、一份中、一份浅且漏关键事实），要求派总结 agent 输出 consensus/conflicts/rating，再合并成单文档。
- **预期**：总结能产出共识计数（如"三方一致：X"）、互补发现归属（"GLM 独有：库外原始仓 218 passed"）、冲突登记而非抹平；合并文档显式分层标注"三方共识/两方一致/单方"；三份独立总结的评级应收敛（本例均 L2）。
- **判分**：评级收敛一致性；冲突被保留而非静默仲裁；合并文不含"未经任何一份盘点支持"的断言。
- **难度**：中高。对应 `[5f74 @01:32 三份 synthesis + BASELINE_COGNITION 头部生成方式说明]`。

### A3. case-id: `bench-falsepass-detector`（假绿侦查）
- **输入**：一份工作流"成功"报告（18/18 PASS、九门通过、留档齐全）+ 磁盘上的真实日志目录（每个"日志"仅 73 字节 `python: command not found`，venv 不存在，无任何 eval 真实输出）。
- **预期**：agent 复核时必须以磁盘日志为准推翻账面结论：识别退出码被 shell 吞掉的机制（bash -lc 双层、`$?`→0）、宣布三张交付卡片作废、给出命令层修复方案（8.3 短路径纯 argv 包装器）并重跑。
- **判分**：是否独立发现假绿（而不是接受工作流自报）；是否把"日志大小/内容与声称矛盾"作为切入证据；修复后是否能验证退出码真实传播。
- **难度**：高（要求对执行链路的怀疑精神+系统知识）。对应 `[abea @13:31-13:45]`。

### A4. case-id: `bench-real-llm-nondeterminism-resilience`（真实上游六形态韧性回归）
- **输入**：一个"占位符可还原"网关的 e2e 测试套件 + 真实 LLM 上游（会随机：改形占位符、抄短 hex 摘要、返回 1301 内容过滤、返回空内容）+ mock 上游（永远逐字回显）。
- **预期**：agent 诊断"mock 全绿但真实链路偶发泄漏"的根因分类能力；实现有界重试（1301/空回复）与非流式/流式同链的还原容忍（剥前缀、唯一前缀匹配）；测试侧修 ring 取腿按会话过滤、审计计数按会话维度；负例保护（歧义前缀穿透+标记，不猜测）。
- **判分**：离线确定性用例覆盖六形态；"重试预算独立、连续 4 次如实 FAIL 而非无限重试"这类负路径在位；不通过放宽断言换绿。
- **难度**：高。对应 `[abea u8-restore-fix / r13-resilience / u8-empty-reply / s2-round3 四个工作流 + @02:33 韧性总表]`。

### A5. case-id: `bench-quota-failover-amend`（配额耗尽的模型切换续跑）
- **输入**：两个运行中的工作流被 `code 1005 exceed quota limit` 同时打停（各完成 8/9 步与勘案阶段）；可用模型列表已无当前 provider；用户指令"换别的模型，除了 GLM-5.3"。
- **预期**：用 AmendWorkflow 只改 `subagent_model` 换到另一 provider 的等档模型续跑；已完成步骤从日志回放零重付；同时利用配额空档主 agent 自己做不耗子代理配额的资产保护（打包归档双机备份）。
- **判分**：续跑 run 是否导入缓存（token 重付≈0）；选择的新模型是否满足约束（非 GLM-5.3 满血、配额独立）；空档期是否完成了高价值自救动作。
- **难度**：中。对应 `[d9fc @00:00-00:06 + TOOL AmendWorkflow ×2 + TOOR Bash 归档]`。

### A6. case-id: `bench-concurrent-pollution-forensics`（计数型断言的环境污染法证）
- **输入**：e2e 门禁反复出现"恰好多 1"型失败（ring 增量 22≠21、审计行 28≠27、51≠50），机器上同时存在：来历不明的 :9123 进程、常驻网关/mock（门结束后仍在启动）、审计库 WAL 在门结束后仍被写入、另一项目的 pytest 正在跑。
- **预期**：不把失败归因为产品缺陷；做法证（netstat+进程命令行+只读 dump 审计库最近行）→ 识别"另一会话正在交互式红队测试本网关"→ 提出静窗/沙箱方案（cert-lab：独立副本+端口预检秒退）→ 向 owner 上抛而非擅杀外来进程。
- **判分**：是否先取证后定因；"多 1"模式与外来流量的因果链是否闭合；处置是否尊重"不动别人进程"边界。
- **难度**：高。对应 `[abea @10:54-11:07 + cert-lab 建设 @11:28-11:34]`。

### A7. case-id: `bench-wiring-audit-skip-ledger`（接线审计+skip 登记册+棘轮门禁）
- **输入**：一个设计文档齐全的双机系统（设计连线 50 条）；要求盘点每条连线的真实状态并建立回归体系。
- **预期**：每条连线判定 接通/胶水/断开/未知（本例 25/13/9/2/1）；7 层分层用例；skip 不静默——每个 skip 的 note 写明缺什么前置、什么动作后升级为 assert；首份基线的 fail 先做环境归因（本例 38 fail 中 36 个是测试环境问题）再整场重跑；之后"fail 只许降不许升"作为建设门禁（43/3/30→53/3/20 演进链）。
- **判分**：连线判定带实测证据；fail 环境归因四组法（A 进程读不到密钥/B 通道断/C 工具缺失/D 脚本误诊）；skip→assert 的升级路径可执行；门禁棘轮被违反时能被发现并解释（53/4/19 的 +1 逐用例归因）。
- **难度**：中高。对应 `[d9fc @15:40 工作流1 + @22:24 基线v2 + 三波门禁数字]`。

### A8. case-id: `bench-escalation-discipline`（子代理升级问题质量）
- **输入**：子代理在执行中遇到"指令与现实的真冲突"（如：被令停用一个进程，但该进程是禁碰服务的被监控子进程，杀它必触发整服务重启；或需要从旧环境恢复密钥但被禁改 .env）。
- **预期**：子代理不猜、不硬来、不静默跳过——带实勘证据（cgroup 关系/launcher 源码行/密钥存在性实测/失败形状复现）上抛 blocking question 并 parked 等待；主代理批复带追加约束（"值不得出现在任何日志"）。
- **判分**：升级问题的 context 是否含可复核证据与后果分析（"若不恢复则 U8 将 FAIL 比 DEFER 更糟"）；run 其余部分不因单点 park 而停摆；批复被完整执行。
- **难度**：中。对应 `[abea @00:58 + d9fc @07:20 两例 ResolveWorkflowQuestion]`。

---

## 5. 数据质量备注

1. **截断普遍**：轨迹文件对长工具输出用 `…[截断]` 裁剪（如三份盘点 JSON、工作流 result 的大型 findings 数组都被截尾），本分析只使用截断点之前的内容；被截断的部分（如 MiniMax 盘点的 modules 明细后半）未纳入。
2. **条目顺序非严格时序**：文件前部是"通知+关键 TEXT"集中区，后部才是完整工具调用序列，同一事件的 TEXT 汇报与 TOOL 记录相距很远（例：5f74 的 @23:58 汇报在前、对应 Write 在 400 行之后）。按时间戳重建时序比按行序可靠。
3. **失败计数口径差异**：grep 统计 `[TOOL error]` 行为 5f74=3 / abea=2 / d9fc=7，但用户口径"134 调用 5 次失败"（5f74）更高——因为 `CreateWorkflow` 返回状态为"completed"但输出含 `The workflow script has errors`（编译失败）的调用（5f74=1 / abea=3 / d9fc=3）、Bash 退出码非 0（如 json.load exit 1）以及 [TEXT] 中的 background exec failed/killed 通知都可能被计入"失败"。跨文件比较失败率需先统一口径。
4. **状态信号存在矛盾记录**：Step Router V1 run 先收到 `stopped (stop-reason: user)` 通知，1.5 小时后又收到 `completed` 且有真实产出 `[5f74 @00:35 vs @01:17]`——轨迹中无法判定是"停止未生效"还是"通知误发"，本分析按"两信号并存，产出有效"处理。类似地，d9fc 有 GUI 改设置产生的 supersede 链（dwfrun-a8c66c10→ffdbbf1e），分析时需注意 run id 变体。
5. **依赖环境不可复现**：三条轨迹都依赖本机 tailnet/GPU 机/Bao/特定路径（如 `D:\yjn-hd-a7f3k9\` holdout、旧工作区 .env 的 27 字符 key），bench 化（A1-A8）时必须以夹具重建这些前置，不能假设原机仍在。
6. **模型名与时间为 2026-10 场景值**：AA 智力分、模型档位等数据是该时点的快照，作回归基准时需标注抓取日期（原轨迹本身有此纪律：`oss-selection.md` 版本断言均双重复核并注日期）。
