# INTENT · Owner 开发意图与项目目标（新 agent 冷启动必读）

> 编制于 2026-10-05。
> 来源＝本机 ZCode 会话历史中 owner 真实发言的逐条汇编（本项目相关共 389 条，每条含时间戳与会话 ID，汇编留存于 windev 本机 intent-src/ohos-tailscale.txt）。
> 标注约定：
> - 【owner 原话】＝逐字引用（注日期）；
> - 【owner 拍板】＝owner 明确决定（注日期）；
> - 【owner 授权指令】＝owner 一次性授权后由编排侧写定、owner 认可并反复复用的任务纪律（注日期）；
> - 【推断】＝编制者依据证据推断，可被 owner 推翻。
> 本文不含任何密钥/口令/token；holdout 真实路径一律以 `<HOLDOUT_DIR>` 占位。

## 1. 这个项目是什么（一句话+业务背景）

**一句话**：HarmonyOS/OpenHarmony（鸿蒙）上的 Tailscale 兼容客户端——以纯 TypeScript（ArkTS 兼容）实现的协议核心库为主体，外加一个尚未编译过的鸿蒙工程壳 `app/` 与 `interop/` 互操作脚本，控制面对接自建 Headscale。

- 协议核心库＝npm workspace 多包结构：
  - common / crypto / noise / wireguard / derp / disco / control / netcheck 共 8 包（2026-10-03 起）；
  - 另经拍板批准新增 kat 第 9 包（已知答案测试 KAT 的可移植层，见 §5）。
- `app/`＝鸿蒙工程壳（bridge/ + entry/），本机无 DevEco 工具链，从未编译，开发期冻结。
- `interop/`＝与真实 headscale 的互操作脚本、上传服务器与证据规范。
- CI＝`.github/workflows/g0-gates.yml`（G0 门禁，双平台）。

业务背景【推断，有 owner 发言佐证】：

- owner 是"一人软件公司"，运营一个多节点 tailnet（Windows 开发机 windev-01、GPU 训练机、香港出口网关、鸿蒙相关 VM 等约 8 个节点），并自建 Headscale 控制面，重度依赖它做内网互联与境外出口。
- 2026-09 下旬起官方 Tailscale 客户端在 owner 的机器上反复出问题（9-30 控制面同步超时导致登出；10-03 GPU 机掉线；10-04 owner 抱怨"一旦建立tailscale隧道，就 整机网络就断了……这个网络是真的 烦人啊"）。
- 同时 owner 的设备版图里有鸿蒙侧节点，而鸿蒙平台没有可用的 Tailscale 客户端。
- 本项目＝把 Tailscale 客户端协议栈用纯 TS 移植到鸿蒙，让鸿蒙设备能加入自建 tailnet。
- 选纯 TS 的理由【推断】：ArkTS 兼容让代码可直接进鸿蒙工程；协议层（noise/wireguard/derp/disco/netcheck/control）都是可纯计算的逻辑，天然适合"零网络、确定性、可机检"的核心库形态；平台相关的 TUN/VPN 与网络 API 全部经接口注入，留给壳与真机阶段。

项目起点并非从零开始：

- 最初是 github.com/feasy898/agentic-factory-projects 下的一个子项目；
- 2026-09-29 前后已有 6 包、238 测试基线、ArkTS 官方 linter 告警 76 条清零的记录；
- 2026-10-02 owner 下令继续开发并拆为独立仓库，即本仓 feasy898/ohos-tailscale。

## 2. Owner 的目标与动机（时间线叙述，穿插原话引用）

### 2.1 前身期（2026-09-17 ~ 09-30）：tailnet 运营实践

- owner 持续搭建与运营 tailnet：
  - 9-19、9-26、9-28：香港出口节点接入与对 LLM API/GitHub/HuggingFace 的连通性测试；
  - 9-28："编写提示词：外部机器主动加入Tailscale网络"；
  - 10-02：自建 headscale 以加固形态重建（ACL 最小权限、节点有效期、控制面公网可靠可达）。
- owner 定策原话（转述于 10-02 调度指令）：headscale 重建"不是修修补补"。
- 此期立下运维铁律（塑造了本项目的风险观）：
  - 9-20 owner 原话（因未测全局切流导致整机断网后）："不要在没测试过的情况下就把整个机器流量给切了，这样你自己死了都不知道！"
  - 10-02 调度指令："公网 SSH 保命路永不断"；"先备份后动手"；"密钥纪律：preauth key/token 只从 Bao 远端取远端用，值不入任何文件/日志/对话"。
- 2026-09-29（早期开发期）：derp 包按上游协议对齐、官方 ArkTS linter 告警清零（基线 238 测试全绿）【owner 授权指令佐证】。确立刻骨教训并写进此后所有任务卡："写任何协议语义前必须实读对应上游文件——本项目曾因凭记忆写协议犯过 5 处真实语义错误。"

### 2.2 立项重启（2026-10-02）

- 10-02 00:03【owner 原话】："github.com/feasy898/agentic-factory-projects 这个项目下，有一个鸿蒙系统的tailscale在开发。请继续开发，多用工作流派遣子代理。除了glm 5.3模型，工作流可以派发其他任意子代理继续工作。想办法一路推进到鸿蒙真机验证之前，然后推送到github上，建立一个新仓库装这个项目。"
  - 三个要点：继续开发、推进到真机验证之前、建独立新仓。
- 10-02 01:05【owner 原话】："你马上启动一个工作流，我授权一次，后续你启动工作流我就无需再授权。我授权完就去睡觉了"
  - 授权风格：一次授权、异步推进、只要结果。
- 10-02 当晚起：工作流并行派遣协议研究员实读上游源码，产出 7 份研究笔记：
  - B1 disco UDP relay 0x04-0x09；B2 netcheck 探测调度；B3 DERP region 随机选节点；
  - C1 netmap→WireGuard peer 推导；C2 peer 连接状态机；C3 LocalAPI/PeerAPI/MagicDNS；
  - D headscale 隔离互操作方案。
- 10-03 11:15：双独立冷上下文评审代理 A/B 对 main HEAD 交叉复审（A 实跑 G0 五门+Mimosa 4 处复核+交接文档评价；B 对照研究笔记逐包核对协议对齐度），产出 approve/请求修改意见并回流修复。

### 2.3 边界、基线与规划（2026-10-03）

- 10-03 09:48【owner 原话】："接下来还需要做什么，如果给你真机，需要如何做？以及给后续的agent需要说什么交接什么"
- 10-03 10:02【owner 原话】："凡是不需要真机的工作，都由你 完成。包括你需要评审，可以通过冷上下文子代理，以及grok build cli（本机有）去调用完成。"
  - ⇒ 本机/真机边界：本机 agent 包揽一切非真机工作；真机 agent 只做真机上才能做的事；人类只按说明书配合。
- 10-03 12:45【owner 原话】：派三个不同模型族（GLM 5.3 Flash / MiniMax M3.1 Flash / Step Router V1）独立盘点项目能力："这个文档的目的：建立一整个正式的基线认知。这个认知不仅仅是静态的建设了什么，重点是真实能做什么，而且通过实际的测试验证了。"
  - ⇒ 产出 docs/baseline-audit/BASELINE.md：声明 vs 实证对照（A=实测验证/B=存在未运行/C=仅文档声明/D=与实测矛盾），并勘误文档口径（如两套测试数字并存问题）。
- 10-03 14:10【owner 原话】："基本目标仍然是这样：完成在鸿蒙真机开发前的全部工作。使得接下来只要有一个鸿蒙真机上的agent，以及明确说明清楚需要人类怎么配合，就可以由这个真机agent完成后续开发工作。"
  - 方法（同一条发言）："5个子代理形成思考轨迹，最后一个GLM53子代理拍板然后修改"的同构流水线：
    - 规划：5 份思考轨迹（2×GLM5.3flash+3×MiniMax）→ GLM53 合并定稿 PLAN.md；
    - 测试：同样五思考 → GLM53 定稿 TESTS.md（开发者可见测试 + holdout 测试两类）；
    - "最终，输出最终版本的规划和测试。后续我安排其他agent开发。"
- 10-03 16:53【owner 原话】："所有这些需要我拍板和修订建议的部分，全部遵循原来的方法，5个子代理形成思考轨迹，最后一个GLM53子代理拍板然后修改。接着,我非起一个调度agent，他可以看holdout，以及他可以把holdout先藏起来。你给我一套给这个agent的提示词"
  - ⇒ 授权拍板人代裁 O1-O7/R1-R13 共 20 项（PLAN/TESTS 升版 v1.1）；holdout 包移出仓外并设"调度 agent（测试执行者）"角色藏卷。

### 2.4 协作平面流水线（2026-10-03 晚 ~ 10-04）

- 10-03 18:55 起：项目接入本机多项目协作平面 local-plane（planner/worker/merger 文件驱动，任务前缀 OT-）。
- OT-0001"首会话四连"（holdout 迁移/仓内路径清洗/回归基线确认/owner 报告）设为项目铁律级前置门：完成前禁派任何其他 OT 任务。
- 批次一（P0 缺陷清零）：
  - OT-0002：四缺陷四提交+14 红锚翻转（TS2353、stun.ts Generator 等一对一批次一 P0 项）；
  - OT-0003：P0-7（.gitignore 吞证据文件）+P0-8（arkts-check.js ESM/SDK 参数化）两缺陷两提交+调度侧收口；
  - 10-04 收口：可见测试新基线 43 绿+37 红锚+0 意外红，exit 0；expected.json 唯一真值源。
- OT-0004（P0-5 regress 可归因改造+离线 selftest 门+--out 落 evidence/）经五槽 ensemble 完成任务卡设计，排队待派工。

### 2.5 资产化与保全（2026-10-04 ~ 10-05）

- 10-04 19:17【owner 原话】："盘点本机过去5天的所有会话，并且从中进行轨迹的总结和分析，进而围绕这些真实任务，形成一批bench, 回归测试、用例等资产。你可以大量派出你的GLM53子代理帮你工作"
  - ⇒ owner 开始把开发过程本身转化为可复用资产（session-analysis/）。
- 10-05：owner 指令把项目推上公开仓 github.com/feasy898/ohos-tailscale（含 WIP 留底分支）。
  - 背景【推断，调度指令佐证】：windev 本机计划于 2026-10-06/07 销毁，一切长期产物必须离机保全；
  - 公开仓硬红线：密钥零入库、holdout 路径不入库、大文件不入库。

### 2.6 上位动机

- owner 原话（2026-10-02 19:11）："你也知道我是一人软件公司……我人类以后希望我就是收结果，而不是我天天要来启动工作流，还要处理各种子代理的问题。这样很累。"
- ⇒ ohos-tailscale 是"owner 只收结果"的多 agent 自动开发模式下的旗舰项目之一；项目沉淀的 PLAN/TESTS/holdout/任务卡/验收方法论，本身就是 owner 想要的可复制资产。

## 3. 需求与验收口径

### 3.1 范围与分工

- 真机前的全部工作由本机 agent 完成【owner 原话 10-03，见 §2.3】。
- 真机 agent 只做真机上才能做的事：剧本 S0-S8 已预写（含每阶段人类配合说明、判定树、探针、回报格式）。
- "后续我安排其他agent开发"【owner 原话 10-03】⇒ 一切产物必须冷上下文自包含：任务卡+验收文件可让从未见过规划的 agent 直接开工。

### 3.2 目标形态

- 纯 TS 协议核心库（8+1 包）全部机检门通过；
- `app/` 壳达到"真机 agent 拿到即可编译"的交接态（命令、依赖、SDK 要求写清且无漂移）；
- interop 对隔离 headscale 实例可做端到端回归，证据入 evidence/；
- 一切交接文档自洽：无死链、无假命令、无过期口径（文档口径一致性有专门扫描门）。

### 3.3 A 类完成定义（本机可机检，A1-A17，全部 exit 0 才算完成）

权威口径在 docs/pre-device-plan/PLAN.md §1.1；关键门速览【owner 授权的 PLAN 口径】：

- A1 全仓测试：`npm test` → fail 0 且 `# tests ≥495`（数字只增不减）；
- A2 根类型：`npm run typecheck` → exit 0；
- A3 壳类型：`npm run typecheck:bridge` → exit 0；
- A4 bridge 运行时：`npm run test:bridge` → fail 0 且 tests ≥31；
- A5 壳静态机检：`npm run validate:shell` → ≥66 passed / 0 failed；
- A6 ArkTS 机检门（新）：`npm run validate:arkts` → exit 0，注入违规样本必红；
- A7 D4/P4 机检门（新）：`npm run gate:d4` → exit 0 且 0 命中，注入负例必红；
- A8 互操作离线自检（新）：`npm run interop:regress -- --selftest` → exit 0（无需网络/headscale）；
- A9 KAT 可移植层（新）：`npm run test:kat` 全绿（≥60 例）且 packages/kat/src 零 node: 导入；
- A10 聚合门（新）：`npm run gates` → exit 0；
- A11 剧本自检（新）：`node scripts/check-stage-docs.mjs` → exit 0；
- A12 interop 类型覆盖、A13 悬空引用清零、A14 证据不被 .gitignore 吞噬、A15 交接包齐备、A16/A17 口径与动态判据……（全文以 PLAN.md 为准）。

### 3.4 可见测试体系

- 实体：`tests/plan/`（可见验收测试）+ `node scripts/test-plan.mjs`（runner）+ `scripts/gates.registry.json`（门注册表）。
- 当前基线（2026-10-04 批次一收口）：43 绿+37 红锚+0 意外红，exit 0。
- 红锚语义：37 条红锚＝批次二起待实现项的 TDD 锚（先红后绿）；翻转权在调度侧 planner（逐条亲验实现落地后才翻），worker 不翻锚。
- expected.json 是唯一真值源；UNEXPECTED_RED 必须=0。

### 3.5 holdout 测试（防过拟合）

- 划分原则：定义"正确"的测试与全部规格对开发 agent 可见；验证"门没被骗/没被掏空"的判定内容只在 holdout；两者永不改同一份规格。
- 防过拟合四件套：
  1. 哨兵值泄漏检测（RFC 保留段植入字面量，跑完全仓 grep 命中即 LEAK_SUSPECTED）；
  2. 测试名清单冻结（删负例即变可机检）；
  3. 采样不可预知（哈希种子验收时才定）；
  4. 变体生成器（同语义不同输入）。
- 物理隔离：holdout 内容出仓（`<HOLDOUT_DIR>`）；runner fail-closed（无题即红）；绝不进 package.json scripts 与 CI。
- 角色分离：开发 agent 禁读 holdout；测试执行者按 SCHEDULER-PROMPT 执行且只回 verdict。

### 3.6 每道门的验收三件套

- 正控制：干净态绿；
- 负对照：注入已知违规必红，且红在可定位标识上；
- 结构断言：npm script 名 / CI step 名 / 门注册表含此门。
- 教训（TESTS.md 记录）：只断言 exit≠0 不够——G0-5 曾"红在 syntax error 上"被误认有约束力。

### 3.7 协议正确性与诚实纪律

- 一切协议语义必须实读 docs/upstream/ 上游源码，结论带路径+行号证据【owner 授权指令；起因＝"曾因凭记忆写协议犯过 5 处真实语义错误"】。
- 测试风格：node:test + node:assert；中文用例名；断言消息解释协议语义；期望字节按上游写死。
- 基线口径【owner 原话 10-03 派生】：回答"真实能做什么，哪些说法经实际测试验证"；声明逐条标 A/B/C/D；"宁实勿虚，每个数字可溯源"；不确定就写不确定，绝不编造、绝不拿" narrower check"冒充本体检。

## 4. 红线与约束（owner 明令）

1. **D4 核心库零网络**：packages/ 下非测试源文件禁止任何网络 API；禁止导入 node:*。
2. **P4 确定性**：禁止 Date.now/Math.random；时钟与随机一律经 common 包注入接口。
3. **ArkTS 禁则 A1-A36**（权威清单 docs/arkts-constraints.md）：
   - 禁 any/enum/tuple/Generator（function*/yield）等；
   - 对象字面量实现接口用 class implements；
   - 字符串取字符用 charAt；相对导入写 .ts 后缀；
   - validate:shell / validate:arkts 机检把关。
4. **禁 npm install**：node_modules 已在盘；确需依赖走 PLAN 决策流程。
5. **提交纪律**：
   - 实现期禁止擅自 git commit（编排/调度侧统一做）；
   - local-plane 时代 worker 仅本地 commit，push 到本仓 origin 属常规操作；
   - 不硬改测试凑绿：绝不删测试、绝不放宽断言语义（owner 授权指令："绝不许删测试或放宽到空断言"）。
6. **holdout 保密**：
   - 开发 agent 禁读 holdout；仓内文档一律写 `<HOLDOUT_DIR>` 占位；
   - 含真实路径的文件永不原样 commit；commit 前 `git grep` 自检零命中。
7. **不碰生产 tailnet**：互操作测试只用隔离 headscale 实例；临时凭据用后即弃。
8. **凭据零落盘**：token/密钥只经 OpenBao 或 askpass 现取现用，绝不写入文件/日志/对话/commit；公开仓入库前必扫密钥（owner 10-05 指令的显式扫描清单）。
9. **app/ 壳冻结**：本机无 DevEco/hvigorw/hdc 工具链（结构性不可达），壳编译与真机事项冻结给真机阶段，开发期不碰。
10. **运维风格延续**：先备份后动手；变更全部留痕；不做未测试的全局切换（源自 9-20 断网事故与 10-02 headscale 重建铁律）。
11. **产出规范**：中文、UTF-8、LF；报告宁可短不可虚。

## 5. 已拍板的关键决策（注日期）

- **2026-10-02【owner 拍板】**
  - 继续开发鸿蒙 Tailscale，一路推进到"真机验证之前"；
  - 新建独立 GitHub 仓库（脱离 agentic-factory-projects monorepo）；
  - 工作流一次授权、后续免批。
- **2026-10-03【owner 拍板】**
  - 完成定义劈成 A 类（本机可机检）/B 类（真机探针），绝不混入；
  - 确立"多模型 ensemble 独立思考 → GLM53 合并/拍板"方法论，贯穿基线、规划、测试、决策四轮；
  - holdout 物理出仓，设调度 agent（测试执行者）角色藏卷；
  - 项目接入 local-plane 协作平面，任务前缀 OT-；OT-0001 为前置门。
- **2026-10-03【owner 授权，拍板人代裁 O1-O7/R1-R13 共 20 项，落 PLAN/TESTS v1.1】**，要点：
  - O1：远端 GitHub Actions 观测列为"物理上必须人类"的闭合项，代拍部分预埋三态回报格式；
  - O2：补 h2c CLI、保留回归阶段 3、不动 D-1 契约；判据必须行锚 marker（防子串伪造 PASS）；
  - O3：headscale 设备开发走限域书面豁免令（四要素框架已拟，留 owner 追认位；负面清单保留禁 --network host）；
  - O4：H2OverNoise 落 packages/control/src/h2c.ts，CLI 薄壳留 interop/，TextEncoder 改注入；
  - O5：批准新增 packages/kat 第 9 包，强制同步改"8 包"叙述；
  - O6：性能方法论先定（iter=200 / warmup=20 / 3 次取中位 / 记录机型温度），数值阈值留真机数据后 owner 裁；>50ms 停并升人；
  - O7：拆三项——ssh 可用性已闭合；docker pull 镜像待 owner 一行授权；preauthkey 签发不可代拍（授权行为）。
- **2026-10-04【owner 授权的平面决策】**
  - worker 缩为单族 glm（planner 侧保留三族 ensemble）；
  - 批次一 planner 侧全闭合（OT-0002/0003 done）；
  - 批次二以 P0-5 为首开卡（走 ensemble 开卡流程）。
- **2026-10-05【owner 拍板】**
  - 项目推送 GitHub 公开仓（含 WIP 留底分支）；
  - 公开仓安全红线生效：密钥扫描、holdout 路径不入库、超大文件不入库。

## 6. 未决/待 owner 拍板事项

- **O1**：远端 GitHub Actions 的 G0 job 是否曾绿过，需 owner 人工观测确认（本机无 gh 无网）。
- **O3**：headscale 设备开发豁免令（HS-DEV-001）框架已拟，待 owner 正式签发/追认。
- **O6**：性能数值阈值待 S5b 真机数据产出后由 owner 裁。
- **O7-b / O7-c**：
  - 远端 docker pull headscale 镜像（待 owner 一行授权）；
  - preauthkey 签发（授权行为，不可代拍）；
  - 对应 ESC-009/010/011 已登未清（不阻塞批次一纯代码任务）。
- **批次二及以后**：OT-0004（P0-5）已设计待派工；其后 P0-3/P0-6 与 P1 线（KAT、聚合门、文档口径清零、interop 类型覆盖等，对应 37 条红锚的实现）。
- **分支合流**：规划/测试/基线/交接文档与批次一成果目前在 ot-0003-batch1-closeout 分支（main＝协议核心+基础文档），合回 main 属 merger 待办。
- **真机阶段**：待 owner 提供鸿蒙真机与 DevEco 环境；真机 agent 按 S0-S8 剧本执行，人类按 OWNER-GUIDE 配合。
- **互操作端到端**：interop:regress 完整回归依赖隔离 headscale 环境（与 O7-c 联动）。
- **零散尾巴**：T-REG-6（g0-gates.yml"五门"注释勘误）登记为批次一尾巴候选；个别报告文件 commit 前的 holdout 路径占位符化处置。

## 7. 仓内文档地图（冷启动阅读次序）

1. **INTENT.md**（本文）——owner 是谁、要什么、红线是什么。
2. **README.md**——项目自述与验收基线口径。
3. **CONTEXT.md / TASK.md**——项目结构、约束与任务台账。
4. **docs/baseline-audit/BASELINE.md**——2026-10-03 多模型交叉盘点的权威事实基线（真实能力分级、门禁健康度四缺口、文档勘误表、已知缺陷清单、不可验证边界）。
5. **docs/pre-device-plan/PLAN.md（v1.1）**——真机前工作总规划：
   - 25 个工作项 P0-1…P2-3（稳定 ID）；
   - 完成定义 A1-A17（本机可机检）与 B1-B8（真机探针）；
   - 剧本 S0-S8（真机 agent 任务序列）；
   - 决策预埋 D1-D13；§4.2 二十项 O/R 决策记录。
6. **docs/pre-device-plan/TESTS.md（v1.1）**——最终实现测试：
   - 可见测试实体：tests/plan/ + scripts/test-plan.mjs + scripts/gates.registry.json；
   - holdout 机制说明（卷本体在仓外 `<HOLDOUT_DIR>`）；
   - 红锚协议（§0.7）与 expected.json 真值源。
7. **docs/architecture.md**——架构与 §10.2 验收单元（AU）台账。
8. **docs/arkts-constraints.md**——ArkTS 禁则 A1-A36 权威清单。
9. **docs/oracle/protocol-notes.md 与 docs/research/**——协议语义笔记（每条结论带上游文件+行号证据）；docs/upstream/＝上游 tailscale 源码档案。
10. **docs/handover/**——owner / 真机 agent / reviewer 三身份最小可执行手册（含 owner-with-real-device.md 真机配合说明）。
11. **packages/ 八包源码与测试**（`npm test` / `node --test "packages/**/*.test.ts"`）。
12. **app/**（鸿蒙壳，冻结勿编译）、**interop/**（互操作脚本与证据规范）、**scripts/**、**tests/**（可见验收测试）、**.github/workflows/g0-gates.yml**（CI 门）。
13. **worklog.md / DELIVERY_REPORT.md / docs/baseline-audit/ 各盘点报告 / docs/pre-device-plan/ 下 thinking-* 与 reports/**——历史档案面：保留原文不追改，它们是证据不是说明书。

> 分支注记：main 分支当前以协议核心+基础文档为主；docs/pre-device-plan/、docs/baseline-audit/、docs/handover/、tests/、session-analysis/ 等规划与治理产物在 ot-0003-batch1-closeout 分支（合流属 §6 待办）。
>
> 仓外配套（不属本仓，勿在仓内找）：
> - 协作平面 D:\workspace\local-plane\projects\ohos-tailscale\（CONTEXT / CURRENT-STATE / EXPECTED-STATE / BOARD / journal / tasks）；
> - holdout 包 `<HOLDOUT_DIR>`（永不入仓，开发 agent 禁读）。
>
> 冷启动一句话：先读本文与 BASELINE 建立事实观，再按 PLAN 的 P 项与 TESTS 的红锚找活干；任何协议语义先查 upstream 实据，任何门先跑再信。
