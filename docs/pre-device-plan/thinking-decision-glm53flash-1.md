# 决策思考轨迹：下游风险与后果推演主轴（thinking-decision-glm53flash-1）

## 0. 元信息与亲验清单

- **成文日期**：2026-10-03。被决对象：PLAN §4.2 O1–O7 + TESTS §0.3 R1–R13。
- **主轴**：每项决策的下游风险与后果推演——不是「哪个对」，是「拍错后哪一步炸、代价多大」。
- **输入**：PLAN.md、TESTS.md、BASELINE.md 全文；未读任何 thinking-* 文件（历轮轨迹隔离纪律）。
- **本轮亲验清单**（判断所锚的第一手证据，全部为本会话执行）：
  1. `node scripts/test-plan.mjs` → 16 文件｜GREEN_OK 25｜ANCHOR_RED_OK 54｜UNEXPECTED_RED 0｜STALE_ANCHOR 0｜UNKNOWN_TEST 0，exit 0（与 TESTS §1.1 声称一致——R1/A17 的 runner 真实可用）。
  2. D4/P4 三段等价 grep 对 `app/bridge/src` 全 0 命中（P4 段、node: 段、D4 网络段均 exit 1=无匹配）——R9「扩面零阻碍」证据自测成立。
  3. `grep -c "process.argv" interop/h2c.node.ts` = 0（T-P0-5-c 红锚现值）；TextEncoder/Decoder 5 处；`:218` `Array<[string, string]>` tuple 1 处；P0-3 包面禁则集对 h2c 0 命中——O4 风险证据。
  4. 亲读：interop/regress.mjs（:42 判据/:52 假 key/:54-56 derp 缺参/:57-59 h2c/:71-74 tmpdir）、interop/h2c.node.ts 全文、interop/register.node.ts（:36 import H2OverNoise，:228/:239/:257 实用）、interop/derp.node.ts（:27/:200/:213）、interop/headscale.yaml（0.0.0.0 ×2 @:3/:21）、interop/start-headscale.sh（版本号不在可执行命令中）、TASK.md §2.4 D-1、docs/research/2026-10-02-D-interop-plan-public.md §2（R1/R5 红线原文）、docs/handover/agent-interop-regression.md（红线/验收/降级链）、docs/architecture.md §9.4/§10.1/§10.2/§10.3、packages/control/src/index.ts、packages/control/src/noisehttp.ts 头注、根 package.json、tsconfig.json。
- **结论置信标注**：高=证据闭环；中=依赖一条未来事实；低=缺关键证据（已写明缺什么）。

---

## 1. 高争议项深推演（专属任务指定）

### 1.1 O2 regress 阶段 3：补 CLI vs 删阶段

**选项**：a) 补 h2c CLI（PLAN 建议/附录 B-3 默认）；b) 删阶段 3（轨迹3 立场）；c) 维持现状（三重缺陷必败，BASELINE §2.10，排除）。

**证据约束**：
- D-1 契约原文（TASK.md §2.4）：「跑 `interop/start-headscale.sh` + register/h2c/derp：全部 exit 0 且输出含 `INTEROP PASS` 与 `DERP INTEROP PASS`」——h2c 被写进验收契约。
- 关键物理事实（亲验）：**register.node.ts:228/239/257 与 derp.node.ts:200/213 已实例化并使用 H2OverNoise**——阶段 1/2 传递性依赖 h2c。轨迹3「阶段冗余」的执行层事实成立；但冗余的是「执行」，不是「信号」：h2c 无独立 marker，h2c 崩时两条 PASS 消失，归因落在 register/derp 头上。
- T-P0-5-c 红锚（h2c 有 CLI，现值 0 处）已入 expected.json——TESTS §2.3：删锚点被 UNKNOWN_TEST 机制拦截，改断言=改规格=owner 审。
- D1（PLAN §5）：真机控制面走路径 A = tailcfg + controlbase + **h2c**——h2c 是 S6 必经链路且 BASELINE §2.10 判「唯一未独立验证」。

**两条路的影响链**：
- **补 CLI**：D-1 契约零改动（原文兼容）；T-P0-5-c 按期翻转、selftest S1/S2/S6/S7 各多一个 child/marker 断言；复跑剧本（agent-interop-regression.md）两条 PASS 判据不变，evidence 多一条可 grep 的 `H2C PASS`；真机 agent 成本 +S 级（CLI 约 30–60 行，register/derp 有同构样板可抄），换来 S6 失败时二分「协议栈 vs 手机网络」的第三条对照腿（PLAN §3.2-S2）。
- **删阶段**：须改 TASK.md:54（register/h2c/derp → register/derp）——动验收契约，正是 O2 存在的原因；T-P0-5-c 红锚删除/改写走规格变更；S2 对照基线只剩两条 PASS；S6 若首败于 h2c，四步处置树之外需临时补测=树外行为，触 D10 纪律。本机省下的 S 级工作量，与真机日一次排障成本相比是负汇率。

**倾向与推理链**：补 CLI。决定性理由不是「契约不可改」而是**风险时刻错位**：删阶段把 h2c 链路的首个独立验证从「Node 侧便宜环境」推迟到「真机现场最贵时刻」。S6 是 PLAN 自认「全剧本最难」（§3.2），在那里引入一个新的未验证变量违背整个规划「便宜处首验」的方法论。

**反方最强论证**：h2c 已被阶段 1/2 传递覆盖，独立阶段是重复测试且要终身养 marker/selftest 断言；「未独立验证」可通过在 derp 阶段输出里 grep h2c 中间日志解决，不必新阶段。——驳：日志 grep 是脆弱判据（正 TESTS §0.4-1 的退出码直连教训同构），独立 marker 才是可归因信号；S 级维护成本 < 一次 S6 误归因。

**拍错的下游后果**：错删 → S6 首败归因树缺层，最坏情形真机 agent 现场写树外探针脚本（违 D10，证据降级）；错补 → 多养 1 个 child 断言与 1 条 marker，风险上限是 selftest 偶红，可定位可修。

**可代拍性**：可代拍。拍板应记录：①阶段 3 保留，h2c.node.ts 加 CLI，参数形态对齐 register/derp 的 `<baseUrl> <authKey>` 两参（S1 断言占位符数==传参数）；②marker=`H2C PASS`，S7 防串台；③D-1 契约原文不动；④O4 落包时 interop/h2c.node.ts 保留为薄 CLI 壳（import 自 packages/control）。触发重审：O4 落包使 CLI 依赖面变化时。

### 1.2 O3 headscale.device.yaml 红线豁免：豁免令怎么写才不是先例漏洞

**选项**：a) 书面豁免（限文件/字段/时间/隔离四层）；b) 不豁免（维持 127.0.0.1 闭环）；c) 全仓监听放宽。

**证据约束（红线原文，亲读）**：docs/research/2026-10-02-D-interop-plan-public.md §2——R1「只用隔离实例：headscale 监听只绑 127.0.0.1；禁 --network host」；R5「端口闭环：headscale/embedded DERP/STUN 都绑 127.0.0.1；映射到容器/远端用 SSH -L 转发即可」。R2（不碰生产 tailnet）、R3/R4（凭据/私钥）、R6（ssh 只读运维）不在豁免射程内。物理约束：手机无法做 SSH -L；server_url=127.0.0.1 对手机是死路（PLAN D3）；headscale.yaml 现值 0.0.0.0 ×2（:3/:21）比红线更宽，P1-9 要修回。

**豁免与红线并存的方式（本项核心）**：豁免令必须是**字段级白名单+负面清单+有效期**三段，而非一句「设备侧放宽」：
1. 对象：仅 `interop/headscale.device.yaml`；基线 `interop/headscale.yaml` 不豁免、按 P1-9 修回 127.0.0.1（T-P1-9a 钉 0 命中）。
2. 放宽字段白名单：`server_url`（开发机 LAN 地址）、`listen_addr`、`derp.server.stun_listen_addr`——三者仅限「开发机所在 LAN」；`metrics_listen_addr`/`grpc_listen_addr` 仍 127.0.0.1。绑定形态默认「绑开发机 LAN IP」，0.0.0.0 仅当 LAN IP 动态分配时允许且须在回报记录。**STUN/DERP 端口必须在白名单内**——漏掉它，S7 判据（ServerKey→Ping/Pong）物理不可达，剧本断在 S7。
3. 不豁免负面清单：R2/R3/R4/R6 原文继续有效；**禁 --network host 不豁免**（用 `-p <LAN-IP>:8080:8080` 定向发布即可达成 LAN 可达）；preauthkey 用后即弃不豁免；私钥不入 evidence 不豁免。
4. 有效期与撤销：仅设备联调窗口（env-ready 确认起、至 S6/S7 收口或容器销毁）；本豁免不构成先例——新场景重走 owner；S6 收口后 device.yaml 保留但实例必须销毁。

**倾向**：a（四层限定豁免）。**反方最强**：豁免一次必有第二次，不如让手机走 USB tether 维持回环语义。——驳：tether 后 headscale 仍须绑非回环接口才可能被手机访问，「回环」语义本来就守不住；PLAN §4.1 已把「红线豁免 O3」列为 S6 人类决定项、T-P1-9b（device.yaml server_url≠127.0.0.1）已按豁免设计机检——不豁免会让整套 P1-9 交付物失去裁决对象。真正防先例漏洞的不是「拒绝豁免」，是上面第 3/4 段的负面清单与撤销条款。

**拍错的下游后果**：写宽（如一句「设备联调需要」）→ 先例被引用把基线 yaml 回滚到 0.0.0.0（P1-9 白修）、R1/R5 对全项目失效、凭据纪律被连带松动；写窄（漏 STUN/DERP）→ S7 必败且归因为「协议问题」，真机 agent 误诊改代码（PLAN 风险 R1 的现实入口）。

**可代拍性**：文本可代拍，签署属 owner（DECISIONS.md O3 栏 + P1-9 验收「O3 未签署判阻塞非红」）。触发重审：设备侧配置拟超出任一层限定；或联调中发现需开放 metrics/grpc。

### 1.3 O4 H2OverNoise 落包：PLAN 低估的两个架构违规点

**选项**：a) 并入 control 新增 h2c.ts（PLAN 建议）；b) 独立第 10 包；c) 留 interop 不落包；d) app 侧 TS 副本。

**证据约束**：
- 落包技术前提成立（亲验）：h2c.node.ts 零 node: 导入、仅 1 处 type-import noise/controlbase；依赖方向 control→noise 已存在（BASELINE §4.1），无环。
- **PLAN 低估点一**：architecture.md §9.4 规则 8「src 内禁 node:*、禁 Date.now()/Math.random()/**TextEncoder**/Buffer」——h2c.node.ts 有 5 处 TextEncoder/TextDecoder；规则 4「无 tuple（R4）」——:218 `Array<[string, string]>`。落包必须改：TextEncoder→common utf8（packages/common/src/index.ts:9 export utf8），tuple→interface pair。
- **PLAN 低估点二**：我实测 P0-3 包面禁则集（function*/yield/Object.assign/…）对 h2c.node.ts **0 命中**——即落包后这两类违规**现有计划门禁全绿**，成为「架构规则破戒但机检绿」实例，正是 TESTS §6 末「当时绿、事后腐化」的失败形态。
- **包内分叉风险**：control 已有 noisehttp.ts（HTTP/1.1 over Noise，头注引 hscontrol/noise.go chi 路由），与 h2c.node.ts 头注（「Noise 之上是纯 HTTP/2，无 HTTP/1.1 回退」）及 AU1 定论（§10.2 U1：09-29 真实互通验证「升级后为 HTTP/2 over Noise」）**语义矛盾**。noisehttp.ts 消费面仅 index barrel + interop.test.ts（亲验 grep）。两者都自称 09-29 核对，本机无 headscale 无法对拍——**不确定项，缺证据：headscale 侧响应帧格式实物**。鉴于 09-29 互通实际走 h2.post（HTTP/2），AU1/h2c 更可信。
- 引用勘误：PLAN D2/O4 称「architecture §10.3 只增流程」，§10.3 实为版本记录（v1.2/v1.3 记录了 control 新增 tailcfg.ts 等只增先例）——机制存在，引用名不准，拍板文本应写「§10.3 版本记录条目 + §10.2 增 AU 行」。

**倾向**：a，但拍板必须附三条执行约束（TextEncoder/tuple 改造、与 noisehttp 的矛盾注记、CLI 壳保留见 O2）。

**反方最强**：BASELINE §3.1 明写「h2c 仅 interop 胶水」，落包让 8 包冻结面多一块真实协议层，若 D1 路径 A 有变，包里多一块死代码。——驳：「仅 interop 胶水」的定性正是 O4 要改写的；D1 已裁路径 A 必经 h2c；落包后受 tsc/validate:arkts/未来 kat 同款门管辖，比留 interop（P1-8 前零类型覆盖）更安全。d（app 副本）被 PLAN 否决的理由（分叉）成立。

**拍错的下游后果**：不落包 → 真机集成期 app 侧重写一份 h2c = 分叉，两份实现漂移后在 S6 排障时互相指认；落包但漏两条改造 → 架构规则 8 首例破戒且全门绿，validate:arkts 的公信力受损（它「证明过会红」的叙事多一个反例）。**另一风险**：若把 noisehttp.ts 矛盾一并「顺手修掉」=碰冻结面既有导出，违红线——只能注记不能删。

**可代拍性**：可。拍板应记录：①落点 packages/control/src/h2c.ts，走 §10.3 版本记录（v1.4 条目）+ §10.2 新 AU 行；②TextEncoder→common utf8、tuple→interface 为落地验收项；③noisehttp.ts 矛盾仅在版本记录注记（不改既有导出），待真 headscale 对拍后裁决；④D2 的「§10.3 只增流程」表述修正。触发重审：CU6 判定树出结果后（镜像集成方案下 h2c.ts 自动进 .ets 镜像面）。

### 1.4 O5 packages/kat 第 9 包：低成本的真实理由与一个连带改口

**选项**：a) 独立包（PLAN 建议）；b) common/src/kat/；c) 不建 KAT。

**证据约束**：common barrel 逐名显式导出（packages/control/src/index.ts 同构先例）——b 要改 common barrel=碰冻结面；我亲验四个自动收编面：根 package.json `workspaces: ["packages/*"]`（**已覆盖新包，PLAN P1-1「改 workspaces」一句实际无需执行**）、npm test glob `packages/**/*.test.ts`（kat 测试自动并入 A1 计数）、tsconfig `include: ["packages/**/*.ts"]`、validate:arkts (a) 面 `packages/*/src`——O5 边际成本≈0。holdout frozen-exports 396 名是每包超集断言（h09），新包新增导出合法。连带面：「8 包」口径出现于 README/CONTEXT/HARMONY_AGENT_TASK 与 **P0-6 防毒白名单（TESTS §4.4「8 包/495 现行口径」）**——O5 通过后 P1-2 写口径时须一次写齐「8 协议包 + kat KAT 包」，否则防毒白名单与文档互相打架。

**倾向**：a。**反方最强**：第 9 包稀释「8 包冻结」防线，holdout 名单与 A16 断言全要跟着动。——驳：冻结按包维护，新包自建 barrel 且建成即冻结；口径成本由 P1-2 一次性支付且有 P1-3 门防回流。c 不成立：D11 测试证据分层的真机载体就是 KAT（S5b 首测），没有 kat 则 B1/B5 无家。

**拍错的下游后果**：放 common → 冻结面破口，先例效应直指 8 包纪律；不建 → S5b 空转，D11 报废。A1 计数被 kat 自动推高（≥495+60）——注意这不是漂移而是既定方向（只增不减），但 P1-2 写现行数字时须同步，否则 A17 的名冻/计数断言错翻。

**可代拍性**：可（PLAN 已给建议默认通过）。拍板应记录：「第 9 包不改变 8 包冻结承诺的适用范围；kat 包导出面自建成时点起冻结；P1-1 文本中『改根 package.json workspaces』一句修正为『无需改（packages/* 已覆盖），仅增 test:kat script』」。触发重审：无。

### 1.5 R9 D4/P4 扩面 app/bridge/src：证据是否足够、扩错面误报几何

**选项**：a) 扩到 app/bridge/src（TESTS 建议）；b) 维持 packages/；c) 扩到全 app/。

**证据约束**：我亲测三段等价 grep 对 app/bridge/src 全 0 命中——「现值 0 命中」证据**足够**且零迁移负担；bridge/src 是壳↔库唯一活动面（BASELINE §4.2）、将来的真机半边；轨迹3 反对的是「沉默缩小」不是扩面（TESTS §5 U-d4face）。

**扩错面的误报代价**（本项核心）：扩到 c（全 app/）→ app/bridge/test 的 node:test/node:assert 全红、app/tools/perf 的计时 Date.now 必红——要么加过滤器（复杂化门）要么诱发 `|| true` 静音（G0-5 历史重演）。扩到 a → 误报面为零（现值 0），且 mock 层写 Date.now 恰是 P1-5 DeviceClock 条款（两轴都用挂钟被改时间打穿）要拦的对象——「误报」其实是设计内拦截。

**倾向**：a，且拍板文本用**面声明**而非豁免表述：gate:d4 脚本头注释显式声明检索面=packages/*/src + app/bridge/src，并写明「bridge/test、app/tools/（含未来 perf/）不在面内」；h03 验证声明面==实际面。

**反方最强**：D4 初衷是 packages 的 ArkTS 可移植性，bridge mock 层不参与 ets 编译，扩面是无收益的形式主义。——驳：bridge/src 的 node: 导入在真机 ets 构建必炸，現在拦比 S3 首编译时拦便宜一个量级（B7 报错面的一个本可避免的类别）；且「门只扫一半的面」正是 typecheck:bridge 缺口#1 的同构——不扩面等于复刻该病根。

**拍错的下游后果**：不扩 → bridge/src 未来引入 node:/Date.now 零拦截，炸点后移到真机构建；扩全 app/ → 误报噪音→门被静音→D4 纪律整体失效（比不扩更糟）。

**可代拍性**：可。拍板应记录：面声明文本（白名单式）+ 与 R13 的分工（面外目录不是「豁免」，未来把面扩到 app/tools 时才启用逐条带理由的豁免表）。触发重审：新增 workspace 包或 app/ 下出现新 src 面（如 platform/）时。

### 1.6 O6 性能阈值：两个错误方向各自的代价

**选项**：a) 今天定数值硬门；b) 记录制（D12）+今天只拍决策规则；c) 永不设门只记录。

**证据约束**：真机零数据（BASELINE §7「任何协议代码在 ArkTS runtime 的真实表现为零数据」）；Node 侧七样本 3.51–4.10 ms/op、**同机方差 17%**（BASELINE §3.4）——同机同测法都 17%，跨运行时拍数值不可信；D12 软参考 ≤25（≈6× Node 上界）、>50 触发 O6；R10（先写死阈值诱发凑数）；P1-13 门「只看格式不看值」（TESTS §1.1-P1-13）。

**两个方向的代价**：
- **定松**（如把 25 写成硬门而真机实为 15）：门检测不到真退化；数字入活文档面后被 P1-3 否定断言门「保护」，将来收紧=口径变更成本；真机卡顿在用户侧爆发（握手慢、重连）。
- **定紧**（按 Node 4ms 外推）：高概率误触发生命门——cryptoFramework 硬件路径或 Go .so 方案 B（VpnExtensionAbility.ets:74-78 预留）是架构级重写，牵动「自研库」的项目存在意义，且真机窗口被停下讨论架构（S5b 后停线）；同时诱发改测凑数（R10）。

**倾向**：b。今天只拍决策规则：S5b 数据到手后——≤25 带内：记录不设门；25–50：设观察项排优化（BigInt 热路径/预取池）；>50：触发 O6 逃生门评审，且评审顺序写死「先优化评审 → 再 cryptoFramework 等价探针实测 → 最后 Go .so 方案 B」，防止直接跳架构重写。逃生门评审的前置证据=先测 cryptoFramework 真实性能（新增 CU 探针），拿数据比架构。

**反方最强**：记录制=永远没有性能门，退化靠人眼。——驳：A 类判据可增（数据到手后随时建门），先建门后拆门成本更高；TESTS 已把「门只看格式不看值」写成 spec，改它=改规格。

**拍错的下游后果**：今天定死且定紧 → 真机日中途架构论战，PLAN 的「总回退=可接受终局」被打破；定松 → 性能退化静默通过，且数字被文档门锁死难改。

**可代拍性**：**数值不可代拍**（物理上需要尚不存在的真机数据）；决策规则可代拍。拍板应记录：上述三段决策规则+评审顺序，O6 栏标「待 S5b 数据，触发即重开」。触发重审：S5b 数据落地日。

---

## 2. 其余 14 项逐项推演（六要素紧凑版）

### 2.1 O1 CI 远端状态确认
- **选项**：a) owner 亲查 Actions 页；b) 维持本地推定不改；c) 授 agent gh 权限代查。
- **证据约束**：BASELINE §2.9/§5.2——D4 段 exit 2 仅是本地推定，远端无 gh 不可查；本机无网（BASELINE §7）；PLAN O1 明文「须在 P0-4 合入后进行」。
- **倾向**：a，但预埋**三态回报格式**（红/绿/从未运行+run 列表首屏截图），把 owner 成本压到一分钟。
- **反方**：本地 bash 语义推定够强，不必烦 owner——驳：推定闭合不了「门是否曾有约束力」的定性，而它是整个测试体系叙事的前提（TESTS 终态定义④）。
- **后果**：拍错（不查当绿）→ R3（新回归被当本来就红）；不查当红 → 把历史红误归因代码问题（实为脚本语法死）。
- **可代拍**：**不可**（需远端 GitHub 登录态）。条件：P0-4 合入后执行；重审：若「从未运行」→ 门禁有效性叙事重写。

### 2.2 O7 headscale 环境供给确认
- **选项**：a) owner 三问一句话；b) agent 自测 ssh 别名（本机无网，物理不可能）；c) 默认环境不存在走降级链。
- **证据约束**：agent-interop-regression.md 前置节（dev-env-with-gpu/Docker 29.8.1）；TESTS §4.4 黑名单含 `dev-env-with-gpu`（O7 未答前不得预写别名）；镜像默认钉 v0.29.4（PLAN O7）。
- **倾向**：a；三问=①别名今天是否有效 ②docker 主机归属 ③允许镜像版本。
- **反方**：按降级链默认环境不存在——驳：降级链终点 ran=false，S2 的 Node 侧对照基线（S6 二分前提）拿不到，真机日排障时间倍增；一句话成本 < 归因成本。
- **后果**：悬而不答 → S2「真跑 regress+归档 evidence」既不能列任务也不能删，剧本悬空。
- **可代拍**：**不可**（事实在 owner 远端环境）。条件：答案落地后黑名单自动解除、STAGE-CHECKLIST 才写主机信息；重审：别名失效走 P0→P1→P2 降级链。

### 2.3 R1 A17 判据
- **选项**：a) 采纳；b) 不采纳；c) 降级为参考指标。
- **证据约束**：亲跑 test-plan 25/54/0/0/0 exit 0——runner 真实可用；TESTS §0.3-R1 引测轨4「又加了门而这次也没东西测它」——本仓 G0-5 假绿史实背书。
- **倾向**：a。A1–A16 全绿而 test-plan 意外红完全可能（某工作项落地顺手改坏地板测试）——A17 把「验收工具自身健康」纳入完成定义。
- **反方**：无限回归（谁测 A17）——驳：四态计数自校验+fail-closed（exit 2），不是再套门。
- **后果**：不采纳 → 批次四「79 全 GREEN_OK」无机检，门禁健康度回到人记性。
- **可代拍**：可。按 TESTS §1.2 表尾原文并入 PLAN §1.1；重审：无。

### 2.4 R2 三门 --root
- **选项**：a) 采纳；b) 注入式 meta 脏改工作树。
- **证据约束**：TESTS §5-U1（Windows 文件锁残留非零/CI 并发脏树/checkout 掩盖责任）；E6 实测 validate-shell 可搬走跑。
- **倾向**：a——--root 是 h03/h04/h05 注入断言的唯一干净通道，脏改树违「不改既有文件」纪律。
- **反方**：副本运行与仓内不等价的风险——驳：等价性正是 R2 规定的一等验收项，不是假设。
- **后果**：不采纳 → 批次二/四 holdout 注入 BLOCKED 或脏改树，meta 覆盖缺位。
- **可代拍**：可。P0-3/P0-4/P1-3 验收各加一句（TESTS 已给文本）；重审：无。

### 2.5 R3 P0-5 补 --out
- **选项**：a) 采纳；b) 不补（evidence 只留 log 不留 summary 原件）。
- **证据约束**：亲读 regress.mjs:71-74——summary 写 `mkdtempSync(tmpdir())`，路径只在 stderr 打一次；PLAN §3.4 要求「summary.json（原件）」入 evidence——当前形态下该要求物理不可满足。
- **倾向**：a（TESTS 称之为 holy grail）。不补则 P1-11 校验器「summary 与 regress.log 同批」对真实证据永远无法执行。
- **反方**：--out 扩攻击面——驳：本地诊断脚本非安全边界，加目录前缀校验即可。
- **后果**：不补 → D-3 复跑留证半空转——与 P0-7 修「证据不被吞」形成讽刺对照：证据进得了仓，原件却没落在可进仓的位置。
- **可代拍**：可。记录 --out 语义与目录校验规则；重审：无。

### 2.6 R4 S5b 随机快照步骤
- **选项**：a) 采纳（STAGE-CHECKLIST 步骤+check 断言）；b) 依赖 P1-5 契约自觉。
- **证据约束**：P1-5 留痕钩子是契约不是触发点；D13 复现包三要素之一就是随机快照（PLAN §3.4/D13）。
- **倾向**：a。机制存在但无触发步骤=D13 空转；断言成本一行。
- **反方**：S5b 是 A 类阶段，加 check 增 P0-6 复杂度——驳：真机日第一次需要复现包时才暴露缺失，代价更高。
- **后果**：不加 → 真机失败无法回 Node FixedClock/ArrayRng 重放，D13 报废。
- **可代拍**：可。步骤文本含落点 `evidence/<批次>/rng-snapshot/`；重审：无。

### 2.7 R5 P0-7 双向判据
- **选项**：a) 采纳（豁免不击穿 secrets/工具目录/仓根 log）；b) 单向（只测 regress.log 放行）。
- **证据约束**：T-P0-7-c/d/e 已实体化（4 绿 1 红）；gitignore 豁免的典型事故是「放开过头」——p12 击穿=凭据入 git 历史不可撤（TESTS §3.1 教训原话）。
- **倾向**：a。c/d/e 三条是现状回归地板（现绿），新增成本仅两条负对照。
- **反方**：五个断言对一行 .gitignore 过重——驳：修复的两类失败形态（没放开/放开过头）各对应一组断言，对称才完整。
- **后果**：单向 → 泄露进历史，filter-repo 重演。
- **可代拍**：可。c/d/e 固定为 P0-7 验收项；重审：无。

### 2.8 R6 caliber.json 无值结构
- **选项**：a) 采纳；b) 维持 yml 内联 grep；c) 硬编码期望值。
- **证据约束**：awk `{print $7}` 恒空（BASELINE §2.11 亲验）；min/eq+floor/current 调和「≥495 只增」与「写现行口径」；真值锚=跑真命令。
- **倾向**：a。b 是被盘点的缺陷本体；c 是「把门锚死到常量」的反构造。
- **反方**：两件套比一段 grep 复杂——驳：复杂度换真值锚；内联形态的假绿三年没人发现。
- **后果**：不采纳 → A16 继续假绿，P1-2 清零成果无常驻防守。
- **可代拍**：可。豁免表每条 reason 非空；重审：无。

### 2.9 R7 check-decision-trees
- **选项**：a) 采纳独立脚本；b) 只留 tests/plan 内核。
- **证据约束**：tree-check.mjs 已实现且自带五坏树负对照（T-TREE-a 绿——亲跑套件确认）；树有洞=R1（环境失败误诊为代码问题）的直接入口。
- **倾向**：a。真机 agent 在 S1 就要跑它（剧本自检），须是独立 script 才能进 STAGE-CHECKLIST；收编关系 TESTS §2.2 已定。
- **反方**：五断言查结构不查内容（TESTS 自认）——驳：L1 定位就是防缺件；树外出口（升人）已强制，内容错由 holdout 抽验兜底。
- **后果**：不建 → AGENT-TASK 判定树无门，R1 回到无防护。
- **可代拍**：可。等价收编+--root+保留自检；重审：无。

### 2.10 R8 P1-2 暂不判定
- **选项**：a) 采纳（P1-3 建成前记「暂不判定」）；b) 维持 PLAN 原验收。
- **证据约束**：P1-2 的一次性 grep 自证与 G0-5「红在 syntax error 被误认有约束力」同构（TESTS §5-R8）。
- **倾向**：a。自证不是门——本仓的默认失败模式是「当时绿、事后腐化」。
- **反方**：已完成工作挂未验收状态别扭——驳：诚实状态+批次四一并收口（§2.7 对照表已排）。
- **后果**：不采纳 → 清零成果腐化无报警。
- **可代拍**：可。worklog 记一行「暂不判定（P1-3 后转正式）」；重审：无。

### 2.11 R10 P0-8 第二档路径校验
- **选项**：a) 采纳两档；b) 只测第一档（假路径）。
- **证据约束**：现状加载即崩（BASELINE §2.11 亲验 ReferenceError）；第一档 existsSync 即过，第二档才证明真校验。
- **倾向**：a，但**行为级断言**（报可读错、异常类型非 ReferenceError/SyntaxError/Cannot find module），不锁「什么是 SDK 目录」的具体判据——判据形态我不确定，缺证据：各 SDK 版本目录特征，留给 spec。
- **反方**：第二档判据跨 SDK 版本脆弱——驳：正因如此断言写在行为层不写在判据层。
- **后果**：只拍第一档 → SDK 指到错误但存在的目录时 SKIP 假绿，S2 linter 复扫（B6）静默缺失。
- **可代拍**：可。重审：无。

### 2.12 R11 env-ready 三元组
- **选项**：a) 采纳（值+证据+时间戳）；b) 裸 bool。
- **证据约束**：T-ENV-a/b/c 已实装并绿（亲跑套件确认）；「防漏填不防填假」诚实边界已写明（TESTS §4.3）。
- **倾向**：a。R1 的缓解依赖出事时能回溯「人当时看到什么」——裸 bool 做不到。
- **反方**：人类填三元组摩擦大——驳：校验器把 why 带给人（T-ENV-b），摩擦集中在 S4 末一次性，收益在 S6 排障。
- **后果**：不采纳 → env-ready 仪式化，R1 缓解失效。
- **可代拍**：可。三向对齐随 P1-12 落地；重审：无。

### 2.13 R12 P2-1 验收细化
- **选项**：a) 采纳（逐条+变体必红+inbox 字节级）；b) 维持总数 8+7。
- **证据约束**：BASELINE §2.7 现集成层即 importlib 直调（P2-1 本就要起真 server）；「总数判定掩盖单条回归」与 T-P0-1-e 同一教训（TESTS §0.4-2）。
- **倾向**：a。upload_server 是「全仓最强真代码实证」（BASELINE §1），回归面必须逐条钉。
- **反方**：Python 视角字节级跨语言维护贵——驳：os.listdir 同进程读取已在现测试使用，增量仅断言粒度。
- **后果**：不采纳 → fcaf962 安全钉的实证面退化，反模式清单失去最硬样例。
- **可代拍**：可。变体集形态 TESTS §1.2 已列；重审：无。

### 2.14 R13 perf 豁免带理由
- **选项**：a) 采纳（若开豁免逐条理由+meta 断言）；b) 不设防；c) 把 perf 也扫（不可行——计时本质需 Date.now）。
- **证据约束**：app/tools/perf/ 是 P1-13 落点且必须在扫描面外；风险形态=「全仓豁免也是绿的」。
- **倾向**：a，且与 R9 面声明机制合一：默认**不开豁免**——perf 在面外（面声明里写明），不是面内豁免；仅当未来把面扩到 app/tools 时启用逐条带理由豁免表。
- **反方**：「面外=灰色地带，与沉默缩小同构」——驳：差别在声明+h03 的声明面==实际面断言，沉默缩小无机可乘。
- **后果**：不设防 → 有人以 perf 为由给全 app/tools 开豁免 → 门对新源码失明。
- **可代拍**：可。与 R9 同一文本记录；重审：同 R9。

---

## 3. 共性必答

### 3.1 20 项倾向汇总表

| 项 | 倾向 | 置信度 | 最依赖的前提 |
|---|---|---|---|
| O1 | owner 人类项，预埋三态回报格式 | 高 | P0-4 先合入（PLAN O1 排序约束） |
| O2 | 补 CLI（阶段 3 保留） | 高 | D-1 契约原文不动；register/derp 已用 h2c（亲验） |
| O3 | 四层限定书面豁免（文件/字段/负面清单/有效期） | 中 | 真机与开发机同 LAN 且 STUN/DERP 端口随豁免放行 |
| O4 | 落 control 包 h2c.ts，附三条执行约束 | 中 | TextEncoder→common utf8、tuple→interface 可行（未试跑，缺实证） |
| O5 | 通过（独立第 9 包） | 高 | 四个自动收编面已亲验；P1-2 口径联动执行到位 |
| O6 | 只拍决策规则，数值留 S5b 后 | 高 | 真机零数据是硬事实 |
| O7 | owner 三问，不答前走降级链 | 高 | 别名有效性只有 owner 能证 |
| R1 | 采纳 A17 | 高 | 亲跑 test-plan 25/54/0/0/0 |
| R2 | 采纳 --root | 高 | 副本等价性作为一等验收项 |
| R3 | 采纳 --out | 高 | regress.mjs:71-74 tmpdir 现值（亲验） |
| R4 | 采纳 S5b 快照步骤 | 高 | D13 机制需要触发点 |
| R5 | 采纳双向判据 | 高 | c/d/e 现绿是地板 |
| R6 | 采纳 caliber 无值结构 | 高 | awk 恒空史实 |
| R7 | 采纳 check-decision-trees | 高 | tree-check 内核已实装且自测绿 |
| R8 | 采纳暂不判定 | 高 | 先清后立（附录 B-8）的延伸 |
| R9 | 扩面 app/bridge/src，面声明式 | 高 | 三段 grep 现值 0 命中（亲测） |
| R10 | 采纳第二档（行为级断言） | 中 | SDK 目录判据形态未定（已声明不确定） |
| R11 | 采纳三元组 | 高 | 校验器已实装并绿 |
| R12 | 采纳细化 | 高 | 总数判定教训同构 |
| R13 | 采纳（默认不开豁免，面声明为主） | 高 | 与 R9 机制合一 |

### 3.2 决策依赖图（必须一致地拍）

- **O2 ↔ O4**：O2 补 CLI 落在 interop/h2c.node.ts；O4 落包后它变薄壳。一致解：O2 先行（P0-5），O4 落地时保留 interop CLI 壳。若 O2 删阶段且 O4 落包 → h2c 无任何 CLI 载体，D-1 契约双重改动。
- **O4 ↔ O5 ↔ P1-2**：两项都改「8 包」叙事。P1-2 写现行口径必须同时知道两结果（8 协议包 + kat + control 新增 h2c.ts），否则 §10.3/A16/白名单二次返工。
- **O3 ↔ P1-9 ↔ O7**：P1-9 双 yaml 依赖 O3 豁免文本；T-P1-9b 是 O3 的机检形态；O7 答案决定 device.yaml server_url 占位符注入方式与 STAGE-CHECKLIST 能否写主机信息（黑名单）。
- **R9 ↔ R13 ↔ P0-4**：gate:d4 的面声明机制三处合一（声明面=packages/*/src+app/bridge/src；perf 在面外；豁免表仅未来启用）。
- **R1 ↔ 全批次**：A17 是总验收判据，§2.7 批次对照表按批次排好，O5/O4 通过会改变批次四的数字口径。
- **R8 ↔ P1-2/P1-3**：批次四内部顺序（清零→暂不判定→建门→转正）。
- **R4 ↔ D13/P1-5**：快照步骤是 P1-5 钩子的唯一触发点。
- **O6 ↔ O7**：O7 决定 S5b 能否排期，O6 数值在 S5b 之后——两拍板都后置但须在 DECISIONS.md 留触发条件。

### 3.3 拍板后需改 PLAN 文本/验收标准 vs 只记录

- **需改文本/验收标准**：R1（§1.1 加 A17 行）、R2（P0-3/P0-4/P1-3 验收各加一句）、R3（P0-5 验收补第 4 条）、R4（P0-6 交付物+check 断言集）、R5（P0-7 验收补 c/d/e）、R6（P1-3 落地物改口径）、R7（P0-6 交付物加脚本）、R9（P0-4 内容+面声明）、R10（P0-8 验收补第二档）、R11（P1-12 schema 形态）、R12（P2-1 验收）、R13（P1-13 联动面声明）；O4 通过（P0-5 子项与 D2 文本联动、architecture §10.2/§10.3 增行——既有文件走执行 agent diff 清单）；O5 通过（P1-1 workspaces 句修正为「无需改」、P1-2 口径、P0-6 白名单兼容「8+kat」）。
- **只记录决定**：O1（三态回报格式入 OWNER-GUIDE 骨架）、O2（DECISIONS.md 记录；PLAN P0-5 已预写「默认方案受 O2 约束」故无需改）、O3（DECISIONS.md 豁免文本；P1-9 已按豁免设计）、O6（决策规则入 DECISIONS.md 标「待 S5b」）、O7（三问答案入 DECISIONS.md，黑名单解除）。

### 3.4 最容易被轻率拍错的 2–3 项

1. **O4**：PLAN 的「落包=移动+类型对齐」叙述漏掉 TextEncoder（§9.4 规则 8）与 tuple（规则 4）两个违规点，且 P0-3 计划门禁不抓它们（亲测 0 命中）——轻率拍板会制造「架构破戒但全门绿」实例。拍板文本必须附执行约束。
2. **O3**：错不在「是否豁免」而在「豁免与红线怎么并存」——写宽成先例漏洞（基线 yaml 回滚、R1/R5 失效），写窄漏 STUN/DERP 端口则 S7 物理断线。四层限定+负面清单+有效期缺一不可。
3. **O6**：在零数据压力下拍数值，两个方向都错（松=门失灵+口径锁死；紧=误触架构级重写）。唯一正确形态是今天拍决策规则与评审顺序、数值留给 S5b。

### 3.5 证据不足项的保守默认（给拍板人 GLM53）

- **O1/O7 无回应**：默认「未确认=不可假设有效」——CI 按「无约束力绿」处理（门禁叙事不依赖远端）、环境按降级链 P2 规划；两项保留 owner 队列不删。
- **O3 绑定形态**：默认「绑开发机 LAN IP」；0.0.0.0 仅在 LAN IP 动态时允许且回报记录。
- **O4 noisehttp 矛盾**：本机无法对拍 headscale 实物（缺证据：headscale 响应帧格式）——默认不动 noisehttp.ts（冻结面），版本记录注记矛盾；09-29 互通实际走 HTTP/2（AU1+h2.post 亲验），故 h2c.ts 按 HTTP/2 实现，不依赖 noisehttp。
- **O4 改造可行性**：TextEncoder→common utf8、tuple→interface 我未试跑（缺证据：utf8Decode 是否满足 TextDecoder 的流式/部分解码用法）——保守默认：把「改造可行」列为 O4 落地验收的第一步验证项，不可行则降级为保留 interop 不落包。
- **O6 数值**：默认无门只记录；>50 触发评审的顺序写死（优化→cryptoFramework 探针→Go .so），防跳步。
- **O10/R10 的 SDK 判据**：无 SDK 在盘（hvigor/SDK 全 NOT FOUND，PLAN §0）——默认行为级断言不锁判据实现。

---

*本轨迹全部事实锚点见 §0 亲验清单与逐项引注；未亲验项已标「不确定」并写明缺口。写作纪律：每项倾向都给出反方最强论证与选错后果；不粉饰、不代拍。*
