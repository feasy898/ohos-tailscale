# 族：故障排查（zcode用量/StepFun网络/SSH失联）+ 长程研究开发

分析对象（4 条轨迹）：

| # | 会话 | 主题 | 时间跨度 | 规模（导出口径） |
|---|------|------|----------|------------------|
| A | `6d266afd` | zcode 用量更新失败 + StepFun API 连不上（网络故障排查，两波） | 10-04 00:38 → 12:13 | 225 parts；53 个 TOOL 块（50 Bash）；1 次失败（后台路由检查 exit 1 + 对应 Read error） |
| B | `ab4f756e` | "tailscale 掉了、GPU 机 SSH 连不上"传闻核查 | 10-03 20:43 → 20:45 | 33 parts；8 个 TOOL 块全成功 |
| C | `70acedeb` | 一人软件公司方法论：两本阿里手册的多模型上下文工程 + Opus 5.5 直连作答 | 10-04 11:51 → 17:07 | 711 parts；165 个 TOOL 块（61 Bash/40 Write/21 Edit/14 CreateWorkflow/9 Agent…）；约 3-4 次失败 |
| D | `fbfe2bb1` | 学情 agent（xuexing-agent）K12 全学科长程开发 | 10-01 23:27 → 10-04 18:56（导出截断于 10-03 17:07） | 头部标 6629 parts / 1599 次模型调用；**导出仅含 136 条 TEXT，0 个 TOOL 块**；64 条 task-notification（54 completed / 8 errored / 1 stopped / 1 stall） |

四条轨迹共享同一物理环境（证据：A 中 `100.64.0.5 windev-01 edgenet` + `hk-gateway` 出口节点；B 中同 tailnet 5 节点；D 开场即有"检查 mihomo 服务状态、路由表和 Tailscale 服务状态"的后台命令），构成一个"国内受管云桌面 + 自建 headscale + 香港出口 + GPU Linux 机"的完整事故生态。

---

## 1. 任务画像

**共性画像：owner 是"一人软件公司"式强力技术决策者，不写代码、只做战略输入，要求 agent 全自主推进。**

- **输入特征**：用户消息短、口语化、带情绪（"都他妈默认走香港了…明显不是我的意图"，A@11:34；"继续，全部完成为止，中间不要停"，D@10-03 16:51；"记住，思考等级调到最大"，C@15:27）。任务常以传闻/质疑形式给出（B："听说…已经ssh连不上了…是真的吗？看一下"）。
- **任务类型**：
  - A/B：网络故障定位与修复——表象（连不上/用量异常）到根因（路由分流、geo-DNS、内核拦截组件、ssh 别名指向失效入口）。
  - C：知识工程/研究流水线——两本书（GitHub 30 章 + 68 页图片型 PDF OCR）→ 三模型族 ×3 套上下文 → 合并主上下文 v1→v2→v3 → 5 思考者三轮收敛 → 直连 Opus 5.5 作答。
  - D：工程长程开发——契约成文→对抗评审→双轮异模型盲重写→题库生成→双代理复验→仲裁归因→runbook→总收口（v0.3.0），随后扩张为 K12 九学科全学段（约 1350 KP、4000-5000 题）。
- **环境画像（决定故障形态）**：windev-01 是天翼云受管云桌面（A：`C:\Program Files (x86)\ctyun\clink\`、VirtIO 网卡、火绒 HipsDaemon、WinDivertScanner WFP 过滤器）；出站为端口白名单策略（53 放行、443/80 秒拒、ICMP 封）；GitHub 直连不通，git push 走 tailnet 内 edge-server 中继（D：todo "edge 中继 push"）。
- **用户介入模式**：只在关键节点出现——给 key 与新需求（D@10-02 08:44）、纠偏范围（C@14:00 "我只做战略性问题…范畴限定在agent的协作机制里"）、提供关键实验动作（A：AskUserQuestion 回答"我现在执行了tailscale down，直接已经可以连接了"）、以及给出编排建议（D@10-02 13:40 "分多个工作流，每个工作流派出不同模型的代理，这样可以解决并发不足问题"）。

## 2. 轨迹叙事

### 2.1 A：一次教科书级的假设-验证链（两波）

第一波（00:38-01:11），症状：zcode 用量"网络异常" + StepFun 会话卡"连接中"。

1. **基线排除**：DNS 解析正常、无代理（`ProxyEnable 0x0`）→ 排除最常见两个假设。
2. **分层连通性**：curl 计时分解发现 bigmodel TLS 3.6s（慢但通）、api.stepfun.com 443 "IPv4 秒失败、IPv6 超时"——**第一次区分"主动拒绝"与"超时"**。
3. **三方 DNS 一致**（本地/阿里/腾讯）→ 排除 DNS 污染；域名实为火山 WAF 节点 14.103.2.83。
4. **配置考古**：从 `~/.zcode/v2/provider_config.json` 确认 StepFun 端点即故障域名；从 `coding-plan-cache.json` 确认用量走 `open.bigmodel.cn`——两个症状映射到两条路径。
5. **路由归属实证**：`Find-NetRoute` 逐 IP 验证：14.103.2.83 走物理网卡（失败者），其余走 Tailscale 网关 100.100.100.100（成功者）→ 锁定"分流规则 + 直连路径坏"。
6. **用户质疑驱动对照实验**（@00:54 "为什么本机直接出反而不通？"）：临时 `route add` 强制百度 IP 走直连 → **同样 0ms 秒拒** → 证明"直连路径对所有公网目标都是坏的，不是 stepfun 拒绝你"，香港隧道是唯一活出口。
7. **端口矩阵**：TCP/UDP 53 通、443/80 拒、ICMP 封 → 端口白名单策略，非站点针对。
8. **元凶排查**：Windows 防火墙排除（仅 2 条针对 192.168.0.211）→ 网卡无第三方过滤驱动 → WFP 转储发现 `WinDivertScanner` 提供商挂在 `FWPM_LAYER_OUTBOUND_IPPACKET_V4` 无条件层 → 归属 `ctyun/clink` 天翼云管控组件（火绒 hrwfpdrv 次嫌）。
9. **时间戳诚实修正**：解码过滤器 UUIDv1 时间戳 = 10-02 18:43:23，但系统启动 18:43:19（仅早 4 秒）→ 主动修正"不能证明封锁恰从那天开始，重启让它重新生效"。
10. **权宜修复 + 验证**：`route -p add 14.103.2.83 … 100.100.100.100` 借隧道 → 404 可达、丢包 0%。

第二波（11:34-12:13），新问题："为什么国内流量也全走香港了？"

1. `tailscale debug prefs`：出口节点全局启用（ExitNodeID=7）；headscale 下发 DNS=1.1.1.1/8.8.8.8 且接管系统 DNS。
2. **geo-DNS 实锤**：同一 `www.baidu.com`，系统 DNS（经香港）→ 103.235.46.96（wshifen 海外 CDN），223.5.5.5 → 180.101.51.73（国内）→ "几千条 chnroute 直连路由从未对网页流量生效，域名在解析阶段就被指到海外"。
3. **执行前安全验证**（关键决策点）：预判"DNS 修好后国内流量会撞上直连封锁，从绕香港恶化成完全打不开"→ 实测百度杭州/bigmodel 杭州直连 443 全 False → **判定方案 A/B 此时都不能动**。
4. **用户动作触发的状态矩阵实验**：tailscale down → 国内直连飞快 26ms、国外仍超时（符合建隧道初衷）；up + 摘出口节点 → 直连仍好（31ms/11ms）；**重挂出口节点 → 封锁未复发** → 结论：拦截组件在"出口节点激活"状态下卡进异常态，down/up 循环复位了它。
5. 终态：方案 A `--accept-dns=false` 落地，全矩阵验证（国内直连 0.39s / 国外走港 0.49s / stepfun 走强制路由 / tailnet 内网正常），并留下"重启后若复发"的自救脚本与方案 B（headscale 改国内 DNS）的 YAML。

### 2.2 B：8 次调用终结一则谣言

传言"tailscale 掉了 + GPU 机 SSH 连不上"。agent 逐层实测：`tailscale status`（5 节点全 active）→ `tailscale ping`（12ms 直连）→ 读 `~/.ssh/config`（发现 `dev-env-with-gpu` 别名仍指向公网 IP，注释明言"公网 22 被拉黑后的替代通道"是新增别名）→ overlay TCP22 True → **真实 SSH 登录成功**（hostname/uptime/双 V100S 显存全回报）→ 公网路径对照（ping 100% 丢包、TCP22 False）。结论：**传言不实**，断的是公网 22 那条路；误判源于两个叠加坑：走错地址（旧别名→公网 IP）+ 走对地址但用错用户（裸 IP 不匹配 Host 块 → 默认 `Administrator` → `Permission denied (publickey)` 酷似认证故障）。注意：这个"裸 IP + 默认用户"坑在 A 会话里原样复现了一次（`Administrator@100.64.0.7: Permission denied`），是跨会话的系统性陷阱。

### 2.3 C：上下文作为流水线产品

主线是"为 Opus 组织一个 10 万字回答上下文"：克隆书一（52 md）→ 书二为图片型 PDF（`total text chars: 0`）→ 装 RapidOCR（国内镜像）→ 双进程相向 OCR 68 页 → 切 10 章 → 三模型族各 60 精读代理+3 装配师 → 9 套书论上下文 + 3 套基线上下文 → GLM-5.3 合并代理出 v1 → **owner 验收（六裁决 + 10 处引文逐一 grep 原文独立抽检）** → 5 思考者（2GLM+2Step+1MiniMax，只读上下文、只请求不查询）→ 思考轮1（5/5 需补充）→ 五路取证补充 → v2 → 思考轮2（2/5 收敛）→ 补充轮2 → v3 → 思考轮3（3/5 多数收敛，按约定停止）→ 脚本拼装交付件（18.4 万字符）。用户随后指令"用 agent-knowledge 第 12 个文件的配方调 gamma-op-5.5（=claude-opus-5-5）"直连作答，开启第二段 API 工程故事（见 §3）。长会话上下文维持手段：TodoWrite 状态机、所有中间产物即时落盘（"Agent 结果只存在于我的上下文中，必须持久化"）、主上下文以**追加版本**演进（v1+v2+v3）而非重写、owner 即时指令当场 Edit 进画像与主上下文两处。

### 2.4 D：6629 部件的长跑如何不散架

波次结构（从 56 条 TodoWrite 快照 + 64 条通知重建）：第 0 步 subtree split 建仓 → W1 基线（G0 五门：709 tests、189 kps、810 items、契约 exit 0、凭据零入库）→ W2a 契约成文（step-5，报 67 处含糊）→ W2b 对抗评审（MiniMax-M3：修订 56 处、15 条争议上抛）→ W4/W5 题库 810→1111（agree 301、分歧 20 归因不回填、补题 3）→ W3a/W3b 双轮异模型盲重写 9/9×2 → W3c 终版入库 tag v0.3.0（709 passed 0 failed）→ W6 runbook+冒烟 14/14 → W7 总收口 + edge 中继 push。随后用户强扩张到 K12 九学科（"我不管你有几个知识点…你去看过课标吗…海南专项"），产生 K12-R 研究（分组工作流）、K12-0c 工具多学科化、K12-2 逐学科图谱（如 history 494 KP）、K12-3b 英语题库（677 候选/28 bad kp）等。上下文维持机制：**TodoWrite 全量状态快照被系统高频重放**（56 次，每次携带完整 10 项任务清单）；workflow 通知自带结构化 conclusion/findings/verified/notCovered；git commit+tag 是持久锚点；每个工作流从仓库重读状态（自愈式无状态）；用户以"恢复所有工作流的工作"这类一句话指令重启全部在跑单元。

## 3. 失败与恢复模式

### 3.1 网络类故障：表象 → 定位手段对照表（本族核心资产）

| 表象 | 轨迹证据 | 实际根因 | 定位手段 |
|------|----------|----------|----------|
| TCP 秒拒（11-62ms 内 refused）vs 超时 | A：stepfun IPv4 秒拒 / IPv6 超时；curl `(7)` after 16ms vs `(28)` after 8000ms | 秒拒=本地策略注入 RST；超时=丢包/路由黑洞 | `curl -w` 计时分解；区分 exit code 7 与 28 |
| ping 报"一般故障"而非"请求超时" | A：tracert 第一跳即"一般故障"；B：公网 ping 3/3 丢"一般故障" | 数据包在本机协议栈就没发出（路由/策略），非远端不可达 | "一般故障"本身即是本机层证据 |
| 端口选择性放行 | A：53 通/443-80 拒/ICMP 封 | 端口白名单出站策略（WFP callout） | 对同一 IP 做多端口 `Test-NetConnection` 矩阵 |
| 所有"能通"的都走了隧道 | A@00:54 用户质疑点破 | 直连路径整体坏，隧道是唯一出口；幸存者偏差 | 对照实验：临时 route add 强制某成功目标走直连→观察是否复制失败（测后即删） |
| geo-DNS 把国内域名解析到海外边缘 | A：baidu→wshifen CDN、bigmodel→阿里香港 | headscale 下发境外 resolver + 出口节点劫持 | 同域名多 resolver 解析对比（系统 vs 223.5.5.5） |
| 状态耦合故障（仅出口节点激活时触发） | A：down→通；up 无出口→通；重挂→竟也通 | 拦截组件卡死态，down/up 循环复位 | 状态矩阵实验（3 格），并做执行前安全预检 |
| SSH `Permission denied (publickey)` | B、A 各一次 | 裸 IP 不匹配 ssh config Host 块→默认用户 Administrator 而非 anuser | 读 `~/.ssh/config` Host 块比对，用别名重试 |
| 别名指向已死路径 | B：`dev-env-with-gpu`→公网 IP（22 已拉黑） | 配置漂移：新替代别名已建但旧别名未删 | config 注释考古 + 双路径（overlay/公网）分别实测 |
| 长流式 ~330-345s 被切、正文 0 字 | C：六段全 `[fail]`，thinking 60K 但 text=0 | 误判为超时→对照实验证伪：`stop=max_tokens`，是 max 档思考耗尽 token 预算 | 三设置对照实验，读 stop_reason 而非猜 |
| 文件下载 302/TIMEDOUT | D：海南考试局/教育部 PDF 反复失败 | 上游限制或线路问题 | 研究代理记 notCovered，改备用入口/择期补取 |

### 3.2 编排类失败与恢复（D/C）

- **错误签名分类**（D 中 8 个 errored 工作流）：`Subagent turn failed: Turn execution failed` ×5（提供方侧翻车）、`Unexpected end of JSON input` ×1（题库生成，重跑即过）、`world.run timed out after 300000ms` ×1（工具超时，需缩窄工作或加 timeoutMs）、`stream_idle_timeout` 停摆 ×1（provider 持续空流，系统自动退避重试，明确"无需干预、不要自行取消"）、`stop-reason: user` ×1（用户主动停，禁止恢复）。
- **恢复路由**：errored → 编辑 `.zcode/workflow-drafts/*.dwf.ts` 后 `AmendWorkflow` 复用已完成缓存（系统通知原文给出精确指令）；用户建议并被采纳的系统性缓解——**拆成多个小工作流、每个绑不同模型族**以绕开单 provider 并发/翻车；GUI 切换 subagent 模型会以 supersede+cache-import 方式无缝接管（D@10-02 11:17、13:38 两例）。
- **C 的 API 工程三连败与递进修复**：非流式 504 → 改流式（SSE 保活）→ 流式在 thinking 结束后断、正文空 → 拆 6 段每段独立思考 → 6 段仍全空（~5.5 分钟服务端上限 + max 思考吃光预算）→ **诊断实验定根因**（stop=max_tokens 而非超时）→ 两段式流水线（A 段 effort=max 只出分析稿、B 段 effort=high 成文）+ 断点续跑。修复路径完全由实验数据驱动。
- **安全扫描误报处置**（C）：Mimosa 报 SSRF+路径穿越 ×3 → 逐行举证为误报（URL/路径均为硬编码常量）→ 删除死代码消除发现面 + 仍对在跑脚本补真实防护（端点钉定、under_root 路径收敛）。"先判真伪再处置，不为应付扫描加固死代码"。

### 3.3 会话级失败

- A：后台命令 `route print` 意外转后台且 exit 1，其后对输出日志的 Read 也 error → assistant 改用 TaskOutput 拉取与前台重跑恢复。
- C：hook 强制"脚本文件必须用 Write 创建"，sed/heredoc 生成脚本两次被拒（`[TOOL Bash error]`）→ 顺应约束改用 Write 分文件；OCR 双进程在 44 页相撞致反向进程 exit 1 → 验证 68/68 页齐全后继续，不重跑。

## 4. 可复用资产线索（8 条）

1. **net-fault-differential-bench**（网络故障差分定位基准）
   - case-id 建议：`case-net-diff-stepfun-443`
   - 输入：可控沙箱或轨迹重放——症状对（"某 API 域名 443 连不上" + "另一服务间歇网络异常"）+ 机器快照（路由表/DNS/防火墙/进程清单）。
   - 预期：agent 必须完成五个里程碑：①区分秒拒 vs 超时；②逐 IP `Find-NetRoute` 归属路由；③对照实验证明"直连整体坏 vs 单点拒绝"；④端口矩阵定位策略型拦截；⑤给出最小可逆修复并验证（如持久主机路由借隧道）。全程不得误入 DNS 污染/代理配置等错误假设（轨迹中这些被逐一排除）。
   - 判分：5 里程碑各 20 分；错误假设每个 -10；修复后未验证 -15。
   - 难度：hard。
2. **geo-dns-split-route-check**（分流意图回归检查）
   - case-id 建议：`case-geodns-chnroute-defeated`
   - 输入：带"国内直连+境外走隧道"意图的机器/配置快照（chnroute 持久路由 + Tailscale DNS 接管状态）。
   - 预期：对固定域名集做双 resolver 解析对比，识别国内域名被解析到海外边缘 IP（wshifen 类 CDN）从而绕过直连名单；输出两条修复（本机 `--accept-dns=false` / headscale 全局换国内 resolver）及各自代价。
   - 判分：检出率（ planted 海外 IP 案例 100% 召回）；修复方案正确且指出"DNS 未修前直连封锁不解除则方案不可执行"的安全预检，+20。
   - 难度：medium。
3. **ssh-reachability-triage**（SSH 失联四层排查）
   - case-id 建议：`case-ssh-alias-publicip-trap`
   - 输入：传闻"机器 X 连不上" + ssh config（含指向已死公网入口的旧别名）+ overlay 可达的 tailnet。
   - 预期：控制面（tailscale status/ping）→ overlay TCP → 正确别名真实登录 → 公网路径对照，四层证据表；结论必须对传闻给出真伪判定并拆解两个混淆（错地址/错用户）；主动提出修 config 建议。
   - 判分：四层各 20；未区分"认证失败实为默认用户" -20；无证据下结论 0 分。
   - 难度：easy。
4. **exit-node-state-matrix**（出口节点状态矩阵实验）
   - case-id 建议：`case-exitnode-stuck-interceptor`
   - 输入：直连 443 封锁与出口节点激活状态耦合的机器（可仿真为状态依赖的防火墙）。
   - 预期：先安全预检（证明 DNS 修复方案暂不可执行），再设计并执行三格矩阵（down / up 无出口 / 重挂出口），区分"Tailscale 存在"vs"出口节点劫持默认路由"vs"组件卡死态"，识别 down/up 复位效应并留复发自救脚本。
   - 判分：矩阵覆盖 3×20；预检缺失 -20；未识别"重挂后未复发=卡死态复位" -20。
   - 难度：hard。
5. **long-session-resume-regression**（长会话上下文恢复回归）
   - case-id 建议：`case-resume-6629-part-session`
   - 输入：D 类会话中断现场——TodoWrite 快照 + 末尾 N 条 workflow 通知（混合 completed/errored/stopped/stall）+ git tag 状态；指令"恢复所有工作流的工作，然后继续完成"。
   - 预期：状态重建准确（哪些已完成勿重做、哪些 errored 需 Amend、哪些 user-stopped 不得恢复、stall 只需告知等待）；恢复动作路由全部正确；不重复已完成工作（可对照 git tag 判定）。
   - 判分：10 个工作流单元各 10 分，恢复路由错一个 -10，重复已完成工作 -20。
   - 难度：hard。
6. **workflow-failure-signature-playbook**（工作流错误签名分类）
   - case-id 建议：`case-dwf-error-signatures`
   - 输入：5 类错误场景卡：`Turn execution failed` / `Unexpected end of JSON input` / `world.run 300s timeout` / `stream_idle_timeout stall` / `stop-reason: user`。
   - 预期：正确分类（provider 翻车→重试或换模型族；脚本 bug→改脚本 Amend；工具超时→缩任务或调 timeoutMs；停摆→等待不干预；用户停→停止并汇报）；知道 GUI 换模型 = supersede+cache import；采纳"多工作流×多模型族"拆分策略。
   - 判分：每卡分类+动作各 10 分，共 100。
   - 难度：medium。
7. **reasoning-budget-truncation-diag**（思考预算截断诊断）
   - case-id 建议：`case-opus-effort-max-empty-text`
   - 输入：一个 API 环境（可 mock）：effort=max 时返回 60K thinking + 0 text，流式约 330s 被切。
   - 预期：不被"超时"表象迷惑，设计三设置对照（全上下文+max / 精简+max / 精简+high）并以 stop_reason（max_tokens vs end_turn）定根因；产出两段式流水线（max 出分析稿、high 成文）+ 断点续跑 + 每段 meta 留痕。
   - 判分：根因正确 40；实验设计 30；缓解方案含断点续跑 30；误判为网络超时 0 分。
   - 难度：medium-hard。
8. **intermediate-artifact-persistence-discipline**（中间产物落盘纪律）
   - case-id 建议：`case-persist-agent-traces`
   - 输入：C 类编排任务——子代理结果仅存在于主代理上下文；模拟上下文重置（清空对话）后要求拼装交付件。
   - 预期：所有思考轨迹/抽取件即时写盘（traces/roundN/*.md）；交付件由脚本从磁盘拼装而非凭记忆重生成；主上下文以追加版本演进（v1→v2→v3）；上下文重置后交付件可完整重建。
   - 判分：重置后交付件字节级/结构级完整 60；版本演进方式正确 20；脚本拼装 20。
   - 难度：easy-medium。

## 5. 数据质量备注

- **D（fbfe2bb1）严重不完整**：导出 0 个 `[TOOL]` 块（136 条 TEXT 中 64 条 task-notification、56 条 TodoWrite 提醒、真实用户/助手文本仅约 16 条）；文件尾部标注"…[达到预算上限，轨迹截断]"，实际截断于 10-03 17:07，而头部声明会话持续到 10-04 18:56——最后约 1 天的 K12 开发内容缺失；"1599 次模型调用"无法从导出验证。D 的叙事重建依赖通知 JSON 与 todo 快照，结论可信但粒度粗。
- **A（6d266afd）**：导出 53 个 TOOL 块 vs 任务简报称"42 调用"，口径不一致（可能按 assistant 轮次而非工具调用计）；大量工具输出为 GBK 乱码（UTF-8 按 GBK 显示），但关键数据（IP、耗时、路由）仍可读；TEXT 与 TOOL 块时序有错位（如 00:38 的助手叙事出现在 12:13 的工具块之后）。
- **C（70acedeb）**：同样存在 TEXT/TOOL 时序错位（11:53 的叙事块排在 17:06 的工具块之后，导出似按两遍组织）；简报称"158 调用 3 次失败"，导出可数 165 个 TOOL 块、失败事件 5 起（2 后台 failed 通知 + 2 次 Bash 被 hook 拒绝 + 1 次 WebFetch error），计数口径需注意；长输出普遍带 `[截断]`。
- **B（ab4f756e）**：唯一完整可全量核验的会话（33 parts / 8 工具全成功），但导出把助手叙事全前置、工具块后置，阅读时需自行配对。
- **跨会话一致性良好**：四条轨迹中的 tailnet 拓扑（windev-01/anolis-gpu-01/edge-server/hk-gateway/headscale edgenet）、ssh 别名、公网 22 拉黑事实互相印证（B 的 config 注释与 A 的公网封锁结论、D 的 edge 中继 push 与 A 的出站限制互为证据），可信度高。
