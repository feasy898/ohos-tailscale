# 族：多agent框架实测（AgentScope假LLM测试）+ 网关转发行为排查

- 轨迹 A（fwcmp）：`trajectories/subagent_agent_9a54ae89-0a16-4ba8-80b3-93bac4273f82.txt`，sess_subagent_agent_9a54ae89，2026-10-01 12:00 → 13:52，parts 522，工作目录 `D:\workspace\xunfei3\fwcmp`
- 轨迹 B（proxy）：`trajectories/f9a5a866-d528-4694-858a-79c50d8121ca.txt`，sess_f9a5a866，2026-09-30 23:05 → 10-01 00:10，parts 502（118 消息/104 调用），工作目录 `D:\workspace\阿里agent能力全调研`
- 成族理由：两条轨迹都是"零真实 API 成本的 LLM 基础设施行为学测试"——A 用假 LLM 服务器测多智能体框架的容错/并发/工具闭环，B 用日志审计+mock 上游测网关/路由器的转发决策与故障切换；共同方法论是把运行时行为转化为可计数证据（stats 端点 / ndjson 决策 trace / 响应头），再走假设-验证链。

## 1. 任务画像

| 维度 | 轨迹 A：fwcmp（AgentScope 2.x 实测） | 轨迹 B：proxy（Higress GLM-5.3-flash 转发排查） |
| --- | --- | --- |
| 角色 | 测试子代理（由协调者派发，"你是测试子代理"） | 主会话运维/排查 agent |
| 原始诉求 | 按统一测试计划 T0~T5 对 AgentScope 2.x 做真实模拟测试（假 LLM 服务器，不用任何真实 API key），写中文报告 | 查询 Higress 转发的请求有多少给到 glm-5.3-flash（23:00 后免费），判断状态原因，"暂时不做处理，等我安排" |
| 被测对象 | AgentScope 2.0.9（PyPI 正式版为主，克隆仓库 src 布局用于 T4） | Higress 2.2.4 网关（srv-1，tailscale 内）+ 本机 8777 auto-router 决策服务（v5.3→v8 演进） |
| 关键约束 | 端口 8124 独占（8123 归另一子代理）；pip 走清华源；绝不使用真实密钥；api_key="sk-mock"；T0~T3、T5 必须基于 PyPI 版，不得被 `-e` 安装污染 | 初始"只读不变更"，后获授权修复；key 零打印（stdin/变量传递）；备份先行（.bak）；有 Mimosa 安全钩子拦截写文件 |
| 交付物 | `results/agentscope_test_report.md`（中文）+ 关键数字摘要 | 三份阶段性结论报告（23:13 调查结论 / 23:31 v6 上线 / 00:10 v8 三级分层） |
| 实际走向 | 严格按计划推进，两处计划内降级（T4 dev 安装超时降级、pytest 运行方式降级） | 从"只查不动"三度被追加授权扩为：修 auto-router（v6/v6.1/v7/v8）+ 注册 step plan 通道 + 三级模型分层重构 |
| 环境 | Windows Server 2022 / Git Bash / Python 3.12.10 / venv 双份（as、as-repo） | 本机 Windows（无 python3）→ ssh `newbox`（srv-1，有 python3）/ bao 密钥库 / docker exec higress |

## 2. 轨迹叙事

### 2.1 轨迹 A：假 LLM 服务器怎么搭、测试怎么组织

**基建（预先存在、子代理只读接入）**：`harness/fake_llm_server.py` 是纯标准库、多线程的 OpenAI 兼容假服务器（轨迹 A L155-156 头注："Fake OpenAI-compatible LLM server... Stdlib only. Threaded... POST /v1/chat/completions OpenAI-compatible (streaming + non-streaming), GET /v1/models"）。控制面三件套：每场景前 `curl -X POST /reset` 清零、`curl /stats` 观测（total/ok/err500/inflight/max_inflight/flaky_keys，L78/L346 实测输出）、消息内嵌指令标记驱动故障（[FAIL500]/[FLAKY:n]/[HANG]/[SLOW:0.5]/[CALLTOOL:工具名]/[GARBAGE]，L7 任务书 + fake 服务器源码）。启动即遇到第一次失败：work 目录不存在导致重定向失败（exit 7，L343），`mkdir -p` 后重启（L345-346）。

**测试组织（T0~T5 矩阵，TESTPLAN.md 定义）**：
- **T0 安装**：venv + `pip install agentscope`（清华源）后台 745 秒装完 2.0.9，95 个依赖包、site-packages 245MB（todo @12:39 + L63 pip show 输出）。等待期间不空转，并行读克隆仓库源码研究 OpenAIChatModel/Agent/Msg API（L44-72）。
- **T1 最小示例**：先试错 API——`Msg(content=字符串)` 被 pydantic 拒绝（L193），确认 2.0.9 要求 content 为 block 列表、`UserMsg(name, content)` 首参是 name（L211/L364）；官方 quickstart 是交互式 console，改写为可自动化的"2 agent 对话 2 轮"，**一次跑通**但总耗时 49s，主动分解：import 19.37s + 模型构造 9.88s 冷启动、稳态每次 reply 仅 0.2s（L379 实测输出），"这本身是重要数据"（@12:23）。
- **T2 并发**：asyncio.gather 跑 N 个独立会话（每会话 2 次调用、[SLOW:0.5]）。N=30：并发相位 1.38s、30/30 成功、max_inflight=26；N=100：2.59s、100/100、max_inflight=83（L78/L388）——与服务端 stats 双向对账证明真并发。
- **T3 故障注入五场景**（详见 §3 失败链）：核心机制发现是**两层重试叠加**——框架层 `max_retries=3, retry_delay=1.0` 固定间隔无退避（L391 源码）× openai SDK 自身 2 次重试，FAIL500 最终 12 次请求、12.14s、抛 `openai.InternalServerError`（L90）；HANG+timeout6+框架默认重试放大到 81.13s、12 请求（L93）。
- **T4 仓库自带 pytest**：测试是 `*_test.py` 后缀 + unittest 风格（188 文件，L465/L290）；`-[dev]` 安装 15 分钟预算超时疑似卡依赖解析 → TaskStop 降级为核心 `-e .` + pytest（324s）→ 收集 733 例/132 文件错误，按缺失计数定向补包（apscheduler 挡 104 个文件、fakeredis 15、fastapi 8，L478）→ 2668 例可收集、仅 3 文件缺重依赖（moto/textual，L129）→ 全量运行历经"后台输出缓冲不可见→10 分钟上限被杀→孤儿进程→PowerShell Start-Process 独立进程+文件轮询→pytest-xdist -n 8 --dist loadfile"的完整降级链（@13:08-13:29），轨迹结束时套件在跑（约 12% 进度，L520）。
- **T5 工具闭环**：[CALLTOOL:get_weather] 驱动 tool_call；Part A（模型+Toolkit 层）拆三小步验证（tool_call 解析→执行→结果回灌再调），Part B（Agent ReAct 层）暴露权限挂起问题（§3.4）。

### 2.2 轨迹 B：Higress 排查的假设-验证链

**阶段一：只读审计（23:05-23:13），用户假设被数据证伪**。用户先验是"免费窗口内应优先 glm-5.3-flash"。agent 先读 SYSTEM-GUIDE.md 冷启动（@23:05），发现架构：Higress 七条路由，`model=glm-plan` 走 llm-plan→zcode-plan→GLM-5.3-Flash，而 auto/fast/deep/code/redteam 虚拟名走 llm-auto→**本机 8777 独立服务 auto-router**（非 Higress 内置，@23:07）。三源数据（gateway.log 结构化日志 889 请求、choices.ndjson 决策 trace 282 条、sticky.json 27 会话）交叉验证后给出决定性证据：**23:00 免费窗口开启后 139 个 llm-auto 请求中 glm-plan 命中 0 次**，118-129 个去付费按量 step-3.5-flash、10 个 MiniMax；近 5 天 889 请求 GLM 仅 16 次且全是白天测试调用（@23:09-23:11，23:13 总结报告）。

**根因三链（每条都代码级坐实）**：① 粘性表压倒一切——sticky 命中条件只查"模型在候选表+不超窗"，**无 TTL、无时间窗重评**，27 会话 25 个钉付费模型，一个 18:30 起的大会话（IP 113.58.30.72）独占 123 请求烧约 899 万 input tokens；② 免费窗口只是给判官 LLM 的**提示语不是硬规则**，fast 候选表根本没有 glm-plan，规则兜底默认 MiniMax-M3.1-Flash；③ 直连流量完全绕过智能层（显式指定 step-3.5-flash 走 llm-main）。数字闭环：llm-auto 139 = 第二层 llm-main 129 + llm-minimax 10（@23:11-23:12）。

**阶段二：修复 v6（23:15-23:31 获授权）**。用户坐实两问题：粘死按量付费、超限 429 原样透传不切换。agent 读转发层确认 `do_POST` 单发透传（@23:18），设计方案：step2.6 硬优先守卫（auto/fast 全天候硬选 glm-plan，压过粘性与判官；deep/code/redteam 保留判官裁量）+ failover 链（429/402/403/5xx/限流关键词/超时 → 按"套餐→按量"序至多 3 跳，参数类 400 仍透传，@23:19）。落地历经安全钩子与传输层四道坎（§3.7）。**验证三段式**：mock 双上游（9999 返 429 / 9998 返 200）+ 隔离 trace/sticky 的临时路由实例 8778/8779 → CASE1 头部 `X-Router-Failover: glm-plan->MiniMax-M3.1-Flash-Preview:http429` 最终 200、CASE2 `X-Router-Decision-Mode: hard-first`（@23:30）→ 清理测试进程 → 生产重启真实冒烟 auto→200 硬首选、deep→判官管线未被破坏（@23:31）。

**阶段三：step plan 通道注册（23:35-23:45），一次教科书式 404 假设排除**。用户提供 step plan key（23:35 消息，明文）。过程中三个重要发现：(1) **计费疑云解开**——该 key 与 stepfun-main 按量通道已配置的 apiToken 完全相同，即 llm-main 一直用 plan 的 key 打标准按量端点（@23:37）；(2) 404 排查链：先假设 pilot 未加载（证伪：日志显示第 9 条 ingress 已 PUSH）→ 再假设 envoy 无路由（证伪：config_dump 8 处 step-plan 命中、老路由 glm-plan 401/200 正常排除配置改坏）→ 抓响应体定位**404 来自 stepfun 上游**（`x-router-id: /step_plan/v1/chat/completions`，虚拟名"step-plan"模型不存在）→ 根因：Higress 的 modelMapping 不会从 ai-route 自动下沉，需手工在 model-mapper 插件加 matchRule（@23:41-23:44）→ 补后双模型 200；(3) 终验抓到**无 key 返回 200 的鉴权洞**（key-auth allow 列表按 ingress 绑定，新路由缺条目），补后 401/401/200 全链闭合（@23:45）。

**阶段四：并发冲突与合并（23:50-23:57）**。做 v6.1 时 PERSONAS 锚点失配 → 警觉"v6 疑似被回滚" → 核实文件 23:36 被第三方改动（783 行、HARD_FIRST 计 0）→ diff 后确认**不是回滚事故而是 owner 另一会话部署了 v5.4**（结构分层/饱和检测/SSRF 守卫）→ 不覆盖对方工作，以 v5.4 为基线合并出 v7（保留其全部机制+叠加硬优先/failover/step-plan/按量末位），mock 验证 glm 429→自动切 step-plan→200 后上线，并向用户明报"两会话并行改同一文件，请裁定归属"（@23:53-23:57）。

**阶段五：v8 三级分层（00:03-00:10）**。用户定义三级档位（高级/普通工作/垃圾任务），网关侧扩三模型映射（glm-5.3、step-router-v1、kimi-k2.8——kimi coding 端点直接接受实名免映射，实测全 200），auto-router 重构为 TIERS 三档+档内动态序（免费窗口 > 临期套餐 > 其他套餐 > 按量），硬首选仅在档首"正免费或临期"时触发；临期信号随免费额度 10-07 到期自动失效（@00:06-00:10）。收尾报告明示遗留：双会话写冲突未解、三个新模型窗口 128K 保守值待实测、4 个转录暴露 token 待轮换。

## 3. 失败与恢复模式

### 轨迹 A（fwcmp）

| # | 失败 | 恢复动作 | 证据 |
| --- | --- | --- | --- |
| A1 | 假服务器启动失败（work 目录不存在，exit 7） | mkdir 后重启，stats/reset 正常 | L342-346 |
| A2 | `Msg(content=str)` pydantic 校验失败，2.0.9 API 与直觉不符 | inspect 源码确认 content 必须 block 列表、UserMsg 首参是 name；后续脚本全部用正确构造 | L193/L211/L364 |
| A3 | T3a 标记丢失：agent 层注入 FAIL500 但服务器 total=1、未见标记（观测与预期不符） | **不接受表面结果**：先在模型层直发证实标记机制正常（12 请求/InternalServerError），再写 8126→8124 透传代理 dump_proxy.py 落盘实际 payload → 根因：Agent 在用户消息后追加注入的 system-reminder user 消息，标记不在"最后一条 user"；`inject_runtime_state=False` 关闭注入后数据干净 | L84-90、L399-400、@12:28-12:31 |
| A4 | T5 首版 ReAct 空转：假 LLM 每轮要工具 → 50 轮迭代、106 次 LLM 调用、工具 0 执行 | 拆层定位：Part A 模型+Toolkit 层闭环逐步打通；Part B 根因实证为 **DEFAULT 权限模式挂起工具调用等授权**（reply="I'm waiting for your permission..."，L454），显式 BYPASS 后工具执行 1 次、闭环成立 | @12:41-12:45、L102/L454 |
| A5 | 默认 stream=True 下 `model()` 返回异步生成器，直接当响应用报错 | 改为 `async for chunk` 消费取 final；非流式对照确认行为差异 | L108-123、@12:42 |
| A6 | T4 `-[dev]` 安装 15 分钟预算超（full extras 巨量云 SDK） | TaskStop 终止 → 降级核心 `-e .` + pytest（324s）→ 按收集错误计数定向补 8 个纯 Python 依赖（59s） | @12:49-13:04、L478-481 |
| A7 | 收集错误导致整轮中止 | `--continue-on-collection-errors` 重跑 | @13:08、L492 |
| A8 | 全量 pytest：后台任务经 tail 管道缓冲输出不可见；包装任务被 10 分钟上限杀掉；残留约 25 个 python 孤儿进程（含 ~287MB 的） | 改 PowerShell `Start-Process` 独立进程+输出落文件可轮询；进程清理前先 wmic 识别命令行，**只杀自己的 13388/4564，保护 8124 服务器与兄弟子代理进程**；加 pytest-xdist `-n 8 --dist loadfile` 与对照框架同参数 | @13:12-13:29、L504-508 |
| A9 | 轮询命令 `sleep 300; ...` 自身 6 分钟超时被中断 | 拆小等待粒度（sleep 20/90/180/480）分次轮询 | L331-332、L519 |
| A10 | 结构化输出：假 LLM 永不调结构化工具 | 记录为框架行为数据而非测试失败：55 次调用后优雅放弃（structured_output=None、无异常） | @12:47、L460 |

### 轨迹 B（proxy）

| # | 失败 | 恢复动作 | 证据 |
| --- | --- | --- | --- |
| B1 | 本机无 python3、heredoc 进 docker exec 失败 | 统计全部改在 srv-1 宿主机执行 | L42、@23:10-23:11 |
| B2 | Mimosa 安全钩子拦补丁落盘（转发 URL 模式 SSRF 误报），Write 两轮被拒、Bash cat 也被拦 | 承接扫描反馈实质改进补丁（上游 URL 锁 loopback/tailnet 白名单、trace/sticky 路径锁目录）；改走 `ssh python3 -` stdin 流式执行不落本地文件 | @23:22-23:25、L331-343 |
| B3 | 本地 Bash 对约 9KB 命令截断，PYEOF 定界符丢失 | 补丁拆 5 片独立 ssh 执行，片间用 /tmp wip 文件传状态，末片统一编译+原子替换 | @23:25 |
| B4 | 锚点串失配：传输层把 python 字符串里的 `\`+换行吃成行连接 | 锚点中反斜杠一律 `chr(92)` 构造绕开转义层；v8 再遇同类（v7 写入时续行被吃两行拼一行）时改**行号切片定位** | @23:27、@00:08 |
| B5 | ai-proxy YAML 追加段落在 `status: {}` 之后（head 截断误判文件尾） | 自带 YAML 校验器抓住 → 移除错位段，插到 `priority: 100` 前真正末尾，四文件复验 | @23:40、L400-404 |
| B6 | 新路由 404（三层假设逐一排除，见 §2.2 阶段三） | config_dump 命中数 + 响应体来源判别定位到缺 modelMapping → model-mapper 补 matchRule | @23:41-23:44、L427-443 |
| B7 | 新路由无 key 返回 200（鉴权洞） | key-auth allow 按 ingress 补条目 → 无 key 401/坏 key 401/带 key 200 | @23:45、L445-452 |
| B8 | v6 部署后文件被 23:36 第三方改动覆盖（另一会话部署 v5.4） | 先 diff 侦察识别对方工作价值，以 v5.4 为基线合并 v7 而非覆盖；向用户上报冲突请求裁定归属 | @23:53-23:57 |
| B9 | 脱敏正则漏 YAML 列表格式 → 4 个上游 token 明文进转录 | 主动安全上报（vllm-local/zcode-plan/kimi-plan/minimax-plan 列入轮换清单），教训固化为"脱敏要按 YAML 结构感知" | @23:37、23:45 报告 |
| B10 | v7 片 2 wip 路径笔误（写在服务目录而非 /tmp） | 看报错即改路径重跑，无半改态（锚点失配时文件未写盘） | @23:56、L478 |

**跨轨迹共性模式**：(1) 观测不符先抓证据再下结论（dump_proxy 落盘 payload / config_dump+响应体来源判别）；(2) 隔离测试不污染生产（独立 venv、独占端口、mock 上游+临时路由实例+隔离 trace 文件）；(3) 预算约束下优雅降级且不污染结论口径（PyPI 版与 repo 版分开；T0~T3、T5 始终基于 PyPI 版）；(4) 进程卫生（只杀自有 PID、按端口找测试进程清理）；(5) 框架失败=数据不是测试者失败（TESTPLAN.md 明文，A10/T3e 均如此处理）。

## 4. 可复用资产线索

1. **假 LLM 测试基建（harness 级）**
   - case-id 建议：`CASE-fwc-fakellm-harness`
   - 输入：起 `fake_llm_server.py <port>`（OpenAI 兼容 /v1/chat/completions 流式+非流式、/v1/models），客户端 base_url 指向它、api_key="sk-mock"；消息内嵌指令标记 [SLOW:x]/[FAIL500]/[FLAKY:n]/[HANG]/[CALLTOOL:name]/[GARBAGE]；场景前 POST /reset。
   - 预期：响应按标记语义执行（延迟/500/交替失败/挂起/返回 tool_call/坏响应）；GET /stats 准确给出 total/ok/err500/inflight/max_inflight/flaky_keys。
   - 判分：客户端观感与服务端 stats 双向对账；并发 N=100、每会话 2 调用 → total=201、ok=201、max_inflight 与并发原语实际并行度一致（轨迹实测 83）。
   - 难度：中（标记解析+线程安全计数；轨迹中实现已存在，可直接抽取为 bench 基建）。

2. **框架重试/故障注入五场景回归（含两层重试叠加观察）**
   - case-id 建议：`CASE-fwc-retry-stack`（子场景 a~e）
   - 输入：被测框架 OpenAI 兼容客户端接假服务器；场景 fail500 / flaky:2 / hang（timeout=6 与框架默认两组）/ 连接拒绝（指向无监听端口）/ garbage（流式与非流式对照）。
   - 预期：fail500 → 最终抛 `openai.InternalServerError`，请求总数 = 框架重试 × SDK 重试（AgentScope 2.0.9 实测 4×3=12 次、12.1s）；flaky:2 → 第 3 次成功无异常（total=3）；hang+timeout6+框架重试3 → 时延放大至 81s 级、12 请求；连接拒绝 → `openai.APIConnectionError`（32.9s）；garbage → **流式静默空回复（NO_EXCEPTION, reply=''）、非流式抛解析异常**。
   - 判分：stats 请求数、异常类型、耗时三指标对照基线；garbage 场景是"静默失败"高敏探针（回归中任何框架改动使其从静默变抛错/反之都值得报告）。
   - 难度：中高（需要能区分框架层与 SDK 层重试的对照开关，如 max_retries=0）。

3. **Agent 层消息注入透明度探针（payload 落盘代理）**
   - case-id 建议：`CASE-fwc-inject-passthrough`
   - 输入：8126→8124 透传代理（dump_proxy.py 模式）落盘 /v1/chat/completions 请求体；同一标记消息分别从"模型层直发"与"Agent 层发送"。
   - 预期：Agent 默认在用户消息**之后**追加注入的 system-reminder user 消息（标记因此不在最后一条 user）；`InjectionConfig(inject_runtime_state=False)` 后消息序列与直发一致。
   - 判分：落盘 payload 的消息条数、顺序、标记所在位置断言；对账"客户端发了什么 vs 框架实际发了什么"。
   - 难度：中。该模式通用于任何"框架是否篡改/追加请求"的可观测性测试。

4. **工具闭环 × 权限模式探针（ReAct 空转根因）**
   - case-id 建议：`CASE-fwc-permission-loop`
   - 输入：假 LLM 每轮返回 [CALLTOOL:x] 的 tool_call；注册假工具；分别以默认权限模式与 BYPASS 模式跑 Agent ReAct 循环，限 max_iters。
   - 预期：DEFAULT 模式下工具调用被挂起（回复"I'm waiting for your permission"、工具执行 0 次、循环空转到 max_iters=50、约 106 次 LLM 调用）；BYPASS 模式下 tool_call 解析→执行→结果回灌闭环成立（A1/A2/A3 三步可分别断言）。
   - 判分：工具执行次数、LLLM 调用次数、最终回复内容；"空转放大系数"（调用数/max_iters）作为框架级数据。
   - 难度：中。附产：结构化输出场景（假 LLM 永不调结构化工具 → 55 次调用后优雅放弃返回 None，无异常）可并为此 case 的第二断言组。

5. **网关流量分布三源审计（免费窗口/成本归因）**
   - case-id 建议：`CASE-gw-traffic-audit`
   - 输入：gateway.log（ai-statistics 结构化：model/route/upstream/token/调用方）、路由决策 trace（choices.ndjson：picked/mode/night_free）、粘性表（sticky.json）三源，按时间窗与决策模式聚合。
   - 预期：两层计数闭环（llm-auto 139 = 第二层 llm-main 129 + llm-minimax 10，差额 0）；能识别"免费窗口内付费上游命中数"（实测 GLM=0 为异常）、决策 mode 分布（sticky 占绝对多数 vs 判官终选 41 次）、异常会话集中度（3 会话之一独占 123 请求）。
   - 判分：对账差额=0；免费窗口付费流量能定位到会话 ID/来源 IP/起粘时间；结论必须同时给出机制根因（无 TTL 粘性/软提示免费/直连绕行）而非仅现象。
   - 难度：中（纯日志分析，不需变更权限，但需三源字段对齐）。

6. **超限自动切换 failover 链回归**
   - case-id 建议：`CASE-gw-failover-chain`
   - 输入：mock 双上游（9999 对首选候选返 429，9998 全 200）+ 隔离 trace/sticky 的临时路由实例；注入矩阵：429/402/403/5xx/超时/限流关键词/400 参数错。
   - 预期：限流类错误按链切换下一候选（至多 3 跳）最终 200，响应头 `X-Router-Failover: A->B:http429` 留痕、trace 记 failover-try 行与完整链；400 参数类原样透传**不切换**；链序符合"套餐→按量兜底"性质约束。
   - 判分：响应头 + trace + 最终状态码三重断言；400 不切为负向断言；生产冒烟复验头 `X-Router-Decision-Mode`。
   - 难度：中（需可配置上游 URL 的路由器实例；mock 上游代码可从轨迹复现）。

7. **网关新路由注册端到端判定树**
   - case-id 建议：`CASE-gw-route-register`
   - 输入：在 Higress 注册新 provider+路由的完整四件套（ai-proxy provider / mcpbridge registry / model-mapper 映射 / key-auth allow），curl 矩阵：无 key、坏 key、虚拟模型名、真实模型名。
   - 预期：无 key → 401（若 200 即鉴权洞）；虚拟名无映射 → **上游来源的 404**（响应体是上游错误格式，可与 envoy 无路由的 404 区分）；补映射后 → 200 且 x-router-id 指向预期端点；config_dump 中新路由名命中数 >0。
   - 判分：HTTP 码矩阵 + 响应体来源判别（envoy vs 上游）+ config_dump 命中计数；四处配置缺一即可被矩阵定位。
   - 难度：中高（需 Higress all-in-one 环境；判定树本身高度可复用——轨迹中 404→查 pilot→查 config_dump→查响应体的排除顺序就是用例脚本骨架）。

8. **OpenAI 兼容协议边缘行为兼容性回归**
   - case-id 建议：`CASE-compat-openai-edge`
   - 输入：同一客户端对假服务器分别以 stream=True/False 消费 garbage 响应；消息 content 分别用字符串与 block 列表构造；tool_call 结果回灌后再调。
   - 预期：流式 garbage → 空回复无异常；非流式 → 抛内置解析错误；content 字符串在强 schema 框架（AgentScope 2.0.9 pydantic）被拒、block 列表通过；默认 stream=True 的 model() 返回异步生成器需逐 chunk 消费。
   - 判分：异常类型/回复内容/构造接受性三类断言；适用于任何"OpenAI 兼容"宣称的框架/网关接入新客户端 SDK 时的冒烟。
   - 难度：中。

## 5. 数据质量备注

- **输出截断普遍**：两文件工具输出大量 `[截断]`。本分析中的关键数字均做了双源交叉：优先取完整输出（如 L78/L379/L388/L454 的实测 stdout），其次取 todo 摘要与助手叙述（两者在可见范围内一致）。引用行号为轨迹 txt 的行。
- **轨迹 A 未见终态**：轨迹止于约 13:52，T4 套件仍在后台跑（13:27 后约 7-12% 进度，L520），**最终 2668 例的通过/失败数、报告终稿数字、服务器是否按约杀掉均不可见**（todo @13:42 仍显示 T4 与"写报告+杀服务器" in_progress）。引用 T4 只能引用到"2668 例可收集、xdist 8 worker 运行中"。
- **轨迹 A 文件内时序交错**：TEXT 叙述块（L158-337）与 TOOL 记录块（L41-155、L342-553）分段聚集而非严格交错，重建顺序依赖 @时间戳；两段互证后无矛盾。
- **轨迹 B 口径差异需标注**：可见三组数字——128（choices.ndjson 23:00 后口径，@23:09）、139（gateway llm-auto 口径，@23:11）、278（gateway 23:00 后全口径含直连）。会话内已闭环解释（139=129+10 为两层转发对账），引用时必须带口径标签，不能混用。
- **敏感信息**：轨迹 B 23:35 用户消息含明文 step plan key（本分析不 reproduce）；会话自身在 23:45 报告承认脱敏正则漏 YAML 列表格式导致 4 个上游 token（vllm-local/zcode-plan/kimi-plan/minimax-plan）进入转录并列入轮换清单。若将本族语料用于训练/评测集构建，需先脱敏这两处。另 SSH 输出带 OpenSSH post-quantum 警告噪音（每条 ssh 输出前缀），清洗时注意。
- **会话性质不对称**：A 是子代理（任务书在首条 TEXT，含端口分配 8124/8123 的兄弟子代理协调线索）；B 是主会话（5 轮用户追加指令驱动范围扩张）。做 agent 行为对比时不能当同质样本。
- **可复现性**：A 的 harness（fake_llm_server.py、TESTPLAN.md、work/as 下 t1~t5 脚本、dump_proxy.py）与 B 的 mock 上游（base64 传输的 ThreadingHTTPServer）+ 临时路由实例参数（AUTO_ROUTER_PORT/TRACE/STICKUP 环境变量隔离）在轨迹中均有可提取的实现细节，是 §4 资产的直接来源；但两者均位于当时的工作机（D:\workspace\...），非本仓库。
