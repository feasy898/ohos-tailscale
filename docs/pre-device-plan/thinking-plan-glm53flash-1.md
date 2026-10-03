# 思考轨迹 · 协议核心库 → 真机 ArkTS 运行时的风险与可前置验证项（GLM53 Flash #1）

> 成文 2026-10-03 · 读者是 GLM53 合并人：你要的是我怎么想的，不是成品规划。
> 主轴：8 包协议库放进真实 ArkTS 运行时（非 Node）会遇到什么；哪些风险能在无真机的 host 上提前压缩；哪些必须留给真机、怎么写进交接契约。
> 纪律：每个判断锚定「我读过的 文件:行」或「我跑过的命令+输出」；没跑的检查如实写「未跑」。

## 0. 证据底座：我读了什么、跑了什么

**通读**：`docs/baseline-audit/BASELINE.md` 全文（下称 BASELINE，唯一权威事实底座）；`docs/arkts-constraints.md` 全文（A1–A36 官方禁则 + P1–P7 工程约束 + U1–U10 未验证项）；`packages/common/src/clock.ts`、`packages/common/src/random.ts` 全文；`packages/crypto/src/x25519.ts` 全文；`packages/crypto/src/errors.ts` 头 60 行；`docs/build-feasibility-linux.md` 全文；`docs/handover/owner-with-real-device.md` 全文与 `docs/handover/README.md` 头 60 行；`DELIVERY_REPORT.md` §2.3–§6.4；`scripts/perf-baseline.mjs` 全文；`app/entry/src/main/ets/vpnextensionability/VpnExtensionAbility.ets` 全文；`HARMONY_AGENT_TASK.md` §0–§3；`docs/architecture.md` 注入接口块（:118–160）与 AU7–AU9 行（:543–553）。

**本轮亲手跑过的检索**（grep 仅取证，无门禁性质宣称；标注 cwd）：

1. BigInt 分布（cwd=packages/）：`grep -rln "bigint\|BigInt" */src --include='*.ts'` → 12 个 src 文件；`grep -rc` 逐文件计数见 §3-R1。
2. ArkTS 禁则构造批量扫描：对 `Object.keys / Object.assign / Object.freeze / for..in / Symbol( / globalThis / delete / #私有字段 / .apply( / .bind( / function 表达式 / function* / as const / async / await / ?. / ?? / getter / yield` 逐一 `grep -rEn`。
3. TypedArray 方法面：`grep -rEoh "\.(subarray|slice|set|fill|copyWithin|reverse|sort|join|from|of|buffer|byteOffset|byteLength)\(" packages/*/src --include='*.ts' | sort | uniq -c`。
4. Generator 定位：`grep -rn foreachAttr` → netcheck/src/stun.ts 4 处；`sed -n 170,200p` 亲读源码。
5. linter 报告覆盖面（cwd=仓库根）：`wc -l docs/arkts-linter-report-raw.txt` = 270 行；按文件前缀计数 common 3 / control 30 / crypto 11 / derp 10 / noise 25 / wireguard 19；`grep -c "stun"` 与 `grep -c "engine"` 均 0。
6. 测试可移植性：`head -30 packages/crypto/test/x25519.test.ts` 亲读；`grep -rln "from 'node:" packages/*/test --include='*.ts' | wc -l` = **49/49**。
7. 平台 API 既有锚点（cwd=仓库根）：`grep -rn "cryptoFramework\|systemDateTime\|Monoton\|单调" app docs README.md`（排除 baseline-audit）→ cryptoFramework 有多处锚（app/README-app.md:69 等）；`systemDateTime` **0 命中**。
8. tailcfg JSON 形态：亲读 `packages/control/src/tailcfg.ts:20` 头注与 :88/:117/:168/:189。

**未跑**：npm test / typecheck / test:bridge / validate:shell / perf:baseline —— BASELINE §2 已是 2026-10-03 当日权威复跑，不重复；本文引用门禁数字一律转引 BASELINE 章节号。任何需要 SDK/DevEco/真机的检查无环境（§9 标注）。

## 1. 事实认定（F*，后文按号引用）

- **F1 零平台依赖形态成立**：packages/*/src 无一处 node: 导入、无 Date.now/Math.random（BASELINE §2.9 等价 grep 0 命中）；网络/时钟/随机全经注入（D4/P4）。这是「能搬进 ArkTS」的前提，且已被机检钉住。
- **F2 注入接口已冻结且很窄**：`Clock` 两轴（clock.ts:9-14 wallMs/monotonicMs）、`Rng.randomBytes(into)`（random.ts:12-15）、`HttpTransport/HttpBodyStream`（architecture.md:143-158）。平台实现按 R2 裁定放 app/ 侧（architecture.md:49）。**真机侧要写的只是这几个接口的实现**，核心库零改动。
- **F3 BigInt 是全库横切依赖**：12 个 src 文件含 bigint，逐文件计数（我 grep 实测）：x25519 35 处 / common bytes 14 / wireguard transport 12 / crypto aead 11 / disco relay 8 / control messages 5 / derp region 5 / noise transport 4 / wireguard tai64n 3 / control localapi 2 / common constants 1。热点：x25519 的 254 轮 Montgomery 阶梯 + 结尾 254 轮 modPow（x25519.ts:104,63-75,145）；aead 的 poly1305 是逐 17B 块 BigInt 累加（aead.ts:139-164）；noise/wireguard 传输层 BE64/LE64 nonce（BASELINE §3.1）。
- **F4 TypedArray 面很窄**：全 src 只用 slice(173)/set(109)/subarray(18)/sort(6)/from(3)/join(2) 六种方法（grep 实测）；无 Buffer、无 DataView、无 TextEncoder/TextDecoder（utf8 手写，utf8.ts:4 头注自述按 U3 规避）。下标访问被 A14 明文豁免（arkts-constraints.md:246）。
- **F5 【本轮新发现】存在一处 ArkTS 硬禁则违规**：`packages/netcheck/src/stun.ts:176` `function* foreachAttr(...): Generator<StunAttrView>` + :190 `yield`，调用点 :215/:382——直接违反 A23 `arkts-no-generators`（arkts-constraints.md:376）。**Node strip-only 能跑它、tsc 也不拦**（generator 是普通 JS 语法，erasableSyntaxOnly 只拦 enum/namespace/参数属性，constraints P1:564-566），netcheck 84 例照常绿——所以现有全部门禁对它零感知，只有 ArkTS 编译器会拦。
- **F6 linter「src=0」只对 09-29 的 6 包成立**：docs/arkts-linter-report-raw.txt（270 行，头行 scanning 76 .ets / diagnostics 477）里 disco/netcheck 出现 0 次；两包恰是 2026-10-02 二期 1c9b85b 才完整化的（BASELINE §6.2），**从未被官方 ArkTSLinter 扫过**。F5 的 Generator 正落在扫描盲区里——两件事互为印证。
- **F7 动态键与 JSON 的位置已知且收敛**：Object.keys 仅 netmap.ts 4 处代码（:446/:475/:486/:868），代码自注释标 U5 未真机验证（:444-445）；JSON 仅 control 包 tailcfg（parse/stringify 实码 4 处 :88/:117/:168/:189）+ localapi 7 处 + netmap 2 处，tailcfg.ts:20 自定「parse 返回值立即 as 具名 interface」约定。
- **F8 其余语法面**：async/await 在 5 个 src 文件（control/client、control/noisehttp、derp/client、derp/regiondial、noise/controlbase）；`??` 2 处（netcheck/engine.ts:823、plan.ts:197）；`?.` 0 处；模板字符串 42 行；getter 4 处（common/bytes.ts:19/:23/:154、disco/relay.ts:661）；for..in/Symbol/globalThis/delete/apply/bind/函数表达式/as const 全部 0 命中（grep 实测）。throw 已合规（141 处 `as Error`，DELIVERY §5.4）。
- **F9 测试整体不可直接上真机，但 KAT 可以剥离**：49/49 测试文件 import node:（最低限度 node:test/node:assert）；x25519.test.ts 是双层结构——RFC 7748 死值向量 + node:crypto 实时交叉（x25519.test.ts:1-30 头注 + import 块）。死值层可移植，交叉层不可移植。
- **F10 性能权威区间**：x25519 标量乘 win32/Node22 七样本 3.51–4.10 ms/op ≈ 247–285 ops/s，17% 波动属机器负载（BASELINE §3.4）；测法见 perf-baseline.mjs（200 iter/20 warmup/sink 防 DCE/webcrypto 注入 :17-22,41-53）。真机零数据（BASELINE §7）。
- **F11 性能热点结构**：aead 的 chacha20Block 手写 u32 读写循环（aead.ts:28-32,68,95）；x25519.ts:10-12 头注自认「BigInt 运算本身不保证常时」——实现层面作者已预判运行时敏感。
- **F12 真机时钟/随机的候选 API 仓内只有半个答案**：随机候选 cryptoFramework（app/README-app.md:69「Rng/Clock 实现 → @ohos.security.cryptoFramework 随机数 + 系统时钟（U7：API 签名未验证）」）；**单调时钟 API 仓内零锚点**（systemDateTime grep 0 命中），只有语义要求：超时判定一律 mono、挂钟只落日志（docs/research/2026-10-02-C2-statemachine.md:342 经我 grep 定位）。
- **F13 app 侧接线蓝图已画好**：VpnExtensionAbility.ets:61-82 注释给出方案 A（fs 轮询 fd + 注入层 + conn.protect 防环路）与方案 B（Go .so）双轨；五注入点落位 `app/entry/src/main/ets/platform/`（DELIVERY_REPORT.md:163）；三数组空桩带 TODO（:41-43，BASELINE §2.11）。
- **F14 未验证项的官方编号体系在盘**：U1–U10（arkts-constraints.md:798-810），CU2=BigInt、CU5=Object.keys 静态类型、CU6=.ts specifier、CU7=平台 Rng/Clock API、CU8=hypium 复用 node:test（编号映射见 constraints:798 与 BASELINE §7:418）。真机日待办七步已有（DELIVERY §6.3）。

## 2. 目标拆解思路：按「消除风险所需的手段」切，不按模块切

把「真机前全部工作」的候选项按**消除它需要的手段**分三类，这是我整篇的骨架：

- **甲类：纯 host 手段可消除**（Node/静态分析/文档，无需真机）。典型：F5 Generator 违规修复、F6 扫描盲区自查、F9 的 KAT 剥离、perf harness 的 ArkTS 源码版、注入层「接口+回退桩」文件、CU 问答卡。
- **乙类：必须真机，但可打包成 30 分钟内可答的问题**。典型：CU2/5/6/7/8。这类不值得让真机 agent「研究」，值得让它「照卡执行并抄录输出」。
- **丙类：必须真机且是真工程**。平台注入层真实现、TUN fd 接线、HAP 编译签名、headscale 联调。

理由：规划的价值在于把丙类里混着的甲/乙成分提前剥出来。真机时间受人类配合窗口限制（build-feasibility-linux.md 证明连编译环境都要账号墙，§卡点 A/B），真机 agent 的产能应全部投入丙类；任何能在 host 上做完的事留在真机日做，都是对最贵资源的浪费。

**第二条拆解原则：证据分层迁移**。BASELINE §3.0 把测试证据分三层（上游官方向量/交叉实现对照/仓内自洽断言）。真机层只承接**死值向量层**（F9：KAT 是 hex 常量，运行时无关）；node:crypto 交叉层永远留在 Node（真机没有 node:crypto）；自洽层（往返/状态机）可上真机但优先级低。不按这条分层，就会有人试图「在真机上复跑全部 495 例」——那是个陷阱（见 §9-(5)）。

## 3. ArkTS 运行时差异逐项评估（R1–R12，每项：差异/依据/置信度/对策落点）

**R1 BigInt 运行时支持与性能（CU2）——最大单点不确定。**
差异：核心库 12 文件横切 BigInt（F3）。依据：constraints U2「官方指南未见专门章节，未在真机验证」（:801）；x25519 热点结构（x25519.ts:104 254 轮）。置信度：**支持性 60%**（ArkTS 运行时若源自标准 ES2020 语义则 BigInt 应有；但无任何真机数据，U2 明文存疑）；**性能 10%**（零数据）。量级推算：单次 x25519 ≈ 254 轮 × 每轮 ~15 次 BigInt 乘/模 + 一次 254 轮 modPow；WG initiator 一次完整握手 ≈ 2 次标量乘 + 若干 AEAD/BLAKE2s——Node 上标量乘 3.5-4.1 ms，握手纯计算粗估 10–15 ms（**推算未实测**）。若真机 BigInt 慢 10×，握手 ~100–150 ms，对 3s 心跳预算仍可接受；若完全不支持 → U2 已给后路（number+进位/字符串编码），但 x25519/poly1305 重写量大。对策：进 CU 问答卡首答；poly1305 列为第二测量点。

**R2 Generator 硬违规（F5）——本轮发现，确定性 100%，host 可修。**
stun.ts:176 违反 A23。修法机械：把 generator 展开成 while+游标的手写 walker（两个调用点 :215/:382 改同步迭代或回调），语义由 netcheck 既有 84 例钉住，改完跑门禁即知。**这是 P0**：现在不修，就得占用真机窗口修，且真机上修完还要重编译验证。

**R3 disco/netcheck 从未被官方 linter 扫过（F6）——确定性 100%。**
对策双轨：(a) host 侧先按 A 规则做 grep 自查（本轮已跑一轮，除 F5 外未再发现硬禁则——但 grep 只能查「规则名可枚举」的构造，语义类如 A2 无类型字面量查不全）；(b) 人类拿到 SDK 环境后补一轮 linter 复扫（人类配合项，非 agent 项）。

**R4 Object.keys / Record（CU5）**：4 处集中在 netmap patch 路径——那是增量 MapResponse 的核心语义路径，不是边角。依据：netmap.ts:444-445 自注释 + constraints U5（:804）。置信度：可用性 70%（官方 sanctioned 形态）。对策：CU 问答卡；最坏情况手写键枚举（把 Record 换成数组对），影响面已收敛在单文件。

**R5 JSON.parse 的 ArkTS 语义（无 CU 编号，属 U3/U5 同族）**：tailcfg 是连真实 headscale 的必经层（BASELINE §3.1 control 行）。依据：tailcfg.ts:20 头注自定约定；DELIVERY §3.3 明示「ArkTS 运行时差异未验证」。置信度：50%。对策：CU 卡；fallback 手写小 JSON 解析器成本高，列为最后手段，先用「parse 后立即 as interface」实测。

**R6 async/await 与事件循环（F8）**：置信度可用性 85%（async 属常见 JS 子集）；真正的风险不是语法而是**调度语义**——controlbase 长轮询（noise/controlbase.ts 动态缓冲 :250/:274 接收）与 control client 的 receive 循环假设「谁驱动 read loop」。Node 由事件循环驱动，真机在 VpnExtensionAbility 的 worker/主线程模型里由谁驱动未定义（VpnExtensionAbility.ets:72 自注 TODO「fs 同步阻塞会卡扩展进程，需评估 worker」）。对策：注入层接口设计时把「驱动权」显式化——这是 host 侧现在就能写清楚的接口条款，写进 P1 的注入层接口文件。

**R7 异常语义**：throw 已合规（F8）；剩余两点：catch (e) 无标注后访问 e.message 的写法在 ArkTS 的类型语义（A26 禁 catch 类型标注，constraints:425）；instanceof 自定义 Error 子类在运行时的可靠性。置信度：75%。对策：**契约层约定「错误只认 code 字段不解析 message」**——errors.ts 全部子类已带 code（errors.ts:27-33 CryptoError 形态），这条不依赖运行时细节，是最稳的收敛。

**R8 TypedArray**：方法面窄（F4）+ A14 豁免下标 → 正确性风险低（置信度 90% subarray/slice 语义不变）；风险转移到**量**：173 处 slice 意味着每包加解密多次拷贝，这是性能项不是正确性项，归并进 §6。

**R9 模块系统（CU6）**：`.ts` specifier + `@ohos-tailscale/*` 包名导入，三种集成方式全部未实测（DELIVERY §3.3）。对策：CU6 是公认首答（DELIVERY §6.3、owner-with-real-device.md:50）；host 侧现在能做的是把「CU6 两种答案的动作分支」写成决策树（答案=接受→直接集成；拒绝→app 侧 .ets 适配 re-export 或脚本化改后缀，旧任务书 :52-55 已有雏形但停留在 6 包时代，需按 8 包重写）。

**R10 整体性能特征**：ArkCompiler(AOT) vs V8(JIT) 常识预期 JS 逻辑 1–3×，但本库字节循环密集 + BigInt 不明（R1），**预期只能给区间不能给点值：x25519 真机 5–40 ms/op（置信度低）**。测量方案见 §6。

**R11 数字端序与工具函数**：无 DataView，全部手写 readU32le/writeU32le（aead.ts:28-32）→ 零平台差异面；sort 比较器稳定性低风险。此类不设工作项，只进问答卡兜底。

**R12 测试链路（CU8）**：node:test 不可上真机（F9）。对策 = §5 的双 runner 设计，这是把 CU8 从「未知」变成「已设计、待执行」的关键。

## 4. D4/P4 在真机形态怎么落地（真机的时钟/随机从哪来）

**D4 不是放松而是换边界**。核心库继续 0 平台导入；真机上网络 API 只允许出现在 `app/entry/src/main/ets/platform/`（F13 落位）。建议把 G0-5 的 grep 思路延伸出一条 app 侧目录纪律机检（validate-shell V10 候选）：platform/ 目录之外不得出现 @ohos.net.*、cryptoFramework 导入——这是 host 可机检的。

**时钟（P4 的真机侧）**：wallMs → ArkTS 的 Date.now()（标准对象，置信度 85% 可用）；monotonicMs → 仓内零锚点（F12），候选 API 我不点名（见 §9 第一条：我印象里有系统单调时间 API 但仓内无证据，**不许按我的印象写**）。关键点：**Clock 双轴语义必须原样保真**——C2 笔记钉死了超时判定一律 mono、挂钟只落展示（F12 引 :342），真机 adapter 若图省事两轴都用 Date.now，bestAddr 信任期/重传去抖会被用户改时间打穿，这是语义 bug 不是实现细节。对策：注入层接口文件里预写 `DeviceClock` 的双轴 TODO + 注释引用 C2:342。

**随机（P4 的真机侧）**：候选 cryptoFramework（F12）。两个预先可设计的点：
1. **契约保真**：Rng 实现必须填满 into（random.ts:13 冻结契约），adapter 写完要有一条单元断言「填满」——host 可先写好这个测试骨架。
2. **同步性风险**：若平台 API 只有异步形态，同步 `randomBytes` 需要预取池模式（启动攒池、低于水位异步补充、池空抛错）——这是我建议预先设计成可选件的原因：它不依赖 API 答案，两种答案下都兼容（同步 API 直接透传，异步 API 走池）。

**FixedClock/ArrayRng 在真机形态的新角色**：不再只是测试工具，而是**失败复现的确定性底座**——真机上失败的握手/状态机场景，把当时的随机字节快照 + 时钟轴快照成 hex，回 Node 用 FixedClock/ArrayRng 重放复现。这套「复现包」格式应现在定义（见 §8-(3) 契约回报格式），因为随机快照能否拿到取决于 adapter 是否从第一天就把「每次取随机留痕最近 N 字节」做进去——设计决策，host 期写定。

## 5. KAT/上游取证锚定怎么延续到真机

**机制建议：KAT 断言剥离成双 runner 共享的纯函数集**。新增（建议）`packages/common/src/kat/` 或独立 `packages/kat/`：导出 `runKat(): KatResult[]` 纯函数集合，**零 node: 导入**；Node 侧用 node:test 包装跑（`npm run test:kat`），真机侧用 hypium 或裸脚本包装跑同一函数。一份断言两个 runner，CU8 之争就只剩「runner 外壳」问题。

**最小覆盖集**（向量全是死值在盘，DELIVERY §2.3）：x25519 RFC 7748 全向量+迭代向量+低阶点全零；ChaCha20-Poly1305 RFC 8439；XChaCha draft A.1；SHA-256/HMAC RFC 4231/BLAKE2s blake2-kat/ HKDF RFC 5869 TC3；Noise cacophony msgA/msgB/握手哈希；wireguard 148B/92B hex 锚；STUN RFC 5769 §2.2/§2.3；DERP Magic 帧。加 hex/base64/utf8 的 common 编码 KAT（ArkTS 运行时最先验证的其实应是编码层——它最简单，最先给出「运行时算术/字符串行为正常」的信号）。

**一个坑要提前写**：部分向量现在写死在 .test.ts 里而非独立数据模块，剥离时要把向量搬成无依赖的 .ts 常量文件，Node/真机共享同一份。工作量估计 1–2 天（拍脑袋级，见 §9）。

**上游取证锚定（AU1–AU3 已清账，BASELINE §7 标注「快照与真上游 diff 无人做过」）**：真机侧不新增取证责任——真机 agent 遇协议语义问题只许查 `docs/upstream/` 快照不许凭记忆（handover/README.md 硬约束已有，含一期 5 处凭记忆写协议的教训，DELIVERY §6.4）。**「字节级一致」主张的传递链**：KAT 在 Node 绿（今天）→ 同一 KAT 在真机绿（真机日）→ 才能说「协议核心在 ArkTS 运行时与向量一致」；缺后半个箭头，现有 495 例对真机的证明力为零——这句话要原样进交接契约，防真机 agent 复用「测试全绿」叙事自我说服。

## 6. 性能：Node 3.51–4.10 ms/op 对真机意味着什么 + 测量方案

**正确读法**（BASELINE §3.4 已定调）：这是 win32/Node22/V8 的 BigInt 实现数字，17% 方差是机器负载；与真机的关系只有一个——**它是「实现算法成本」的参照系，不是「真机预期」**。

**对真机的推演**（置信度低，全部标注）：若 ArkTS 运行时 BigInt 实现是常规水准（比 V8 慢 2–10×），x25519 落 5–40 ms/op：握手（2 次标量乘）纯计算 10–150 ms，3s 心跳预算内可活；若 >100 ms/op，netcheck 的 RTT 测量会被计算噪声污染、长轮询建立变慢，需要升级。**真正可能先爆的是数据面吞吐**：chacha20 手写 u32 循环 + 173 处 slice 拷贝，1280 MTU 下每包全程拷贝 3–5 次——这在 Node 都没测过吞吐（未跑，如实说），真机只会更差。

**测量方案四件套**（建议进契约，首日跑，先记录后判定）：
1. `perf-x25519-arkts`：perf-baseline.mjs 的 ArkTS 源码版（同 200/20 测法、同 sink 技巧、同 JSON 输出格式）——host 期写好源码入仓，真机直接跑；
2. `perf-aead-throughput`：1 MB 流 chacha20-poly1305 加密 wall time（数据面指标，Node 侧也应补测一次作参照）；
3. `perf-hash`：BLAKE2s/SHA-256 各 1 MB；
4. 端到端一次 WG initiator 握手 wall time（真机侧集成后）。
纪律对齐 BASELINE §3.4 教训：每组测 3 次取中位、记录机型/API 版本/充电温度；**先记录再定阈值**——建议软阈值 x25519 ≤ 25 ms/op（≈6× Node 上界）为「可用」，> 50 ms/op 升级 owner 裁定（届时可讨论是否绕自研库走 cryptoFramework 硬件路径，但那牵动 D1/D4 架构，只能 owner 裁定，agent 不得自作）。

## 7. host 可压缩 vs 必须留真机（分界线即交接契约的目录）

**host 侧现在就能做（每项 host 可验收）**：
- Generator 修复 + arkts-audit 机检脚本（R2/R3，把 A 规则可枚举子集变门禁）；
- KAT 剥离 + Node runner 全绿 + kat 模块 0 node: 导入的 grep 机检（§5）；
- CU 问答卡五张（CU2/5/6/7/8：跑什么/抄什么输出/两种结果各走哪个分支）；
- 注入层接口文件：`platform/` 下 DeviceClock/DeviceRng/DeviceHttpTransport 的 .ts 签名 + FixedClock/ArrayRng 回退桩（R6 驱动权条款、§4 预取池可选件、Rng 填满断言）；
- perf harness ArkTS 源码版四件套；
- 回放纪律文档 + 复现包格式定义（§4）；
- 非我主轴但顺带建议：typecheck:bridge 红灯修复+入 CI、G0-5 D4 段引号修复（BASELINE 缺陷 #1/#3）——「真机前门禁可信」是契约引用门禁的前提，归口由合并人裁定。

**必须留真机**：CU 答案本体；注入层真实现；HAP 编译/签名/权限；TUN fd 接线；headscale/DERP/WG 真实对端联调。

**留给真机的项怎么写进契约**（原则：每项 = 动作命令 + 原样抄录的输出 + 两种结果各自的下一步分支 + 禁止事项），具体内容见 §9-(3)。

## 8. 备选方案与放弃理由（我否决了什么，合并人可复审）

- **备选 A：在真机上复跑全部 495 例。** 否决。F9：49/49 测试文件 import node:，node:test/node:assert/node:crypto 在真机全不存在（CU8 未答）；硬搬只会浪费真机窗口制造假进度。改为 §5 的双 runner KAT 层——承接能承接的，其余留 Node。
- **备选 B：预先写死真机性能阈值（如 x25519 ≤ 10 ms/op）并要求真机达标。** 否决。真机零数据（BASELINE §7）下定阈值，要么松到无意义要么紧到诱发「改测试凑绿」——本仓对「硬改测试凑绿」已有红线（owner-with-real-device.md:89）。改为记录制 + 数据到手后再由 owner 定阈值（§6）。
- **备选 C：host 期把平台注入层用 Node 模拟「完整实现」一遍，让真机日只剩拷贝。** 大部分否决。app/bridge 的 30 例 mock 全绿并未让壳离真机更近（BASELINE §3.2 定级「仅 mock/桥接形态」），再造一层 Node 假平台只会复刻这个错觉。只采纳其中可保留的部分：**接口签名 + FixedClock/ArrayRng 回退桩 + Rng 填满断言骨架**（G-A4）——桩的价值是让真机实现变成填空并预先钉住契约细节（双轴、填满、驱动权），不是假装平台已通。
- **备选 D：既然 R2 发现 Generator 违规，顺手把 `??`、模板字符串、async/await 等「拿不准」的构造也全部改写以求保险。** 否决。无任何证据表明它们违规（constraints 未禁 + F8 计数在盘），扩大 diff 反而违反最小修改纪律、稀释 495 例对改动的钉住力。只修有双证据（规则文本+源码）的 F5。
- **备选 E：KAT 断言放进现有 8 包的 .test.ts 里 export 出去复用。** 否决。污染测试文件形态、让「真机 runner 只加载 test 文件」变成对 node:test 的变相依赖；且 test 文件不在「src 合规」的保护范围。改为独立无 node: 依赖的 KAT 模块 + 双 runner 外壳（§5），并把「0 node: 导入」做成机检（G-A3）。
- **备选 F：性能灾难时的逃生门——直接走方案 B（Go libtailscale.so，VpnExtensionAbility.ets:74-78 预留）绕开 ArkTS 运行时。** 不采纳为主路线（与纯 TS 仓库路线冲突，且 app/README-app.md §4 的三集成方案都基于 TS 库），但**不删除**该预留：若 R1/R10 的真机数据灾难级（x25519 > 50 ms/op 且无优化空间），它是 owner 裁定项而不是 agent 决策项。
- **备选 G：把 Generator 修复推迟到官方 linter 复跑之后一起做（等 SDK 环境）。** 否决。A23 规则文本（constraints:376）+ 源码（stun.ts:176）双证据已足，修复纯 host 可验（netcheck 84 例钉语义）；linter 复跑解决的是 F6 盲区里「语义类违规」的发现，不是拖延已知修复的理由。

## 9. 共性五答

### (1) 「真机前全部工作完成」的可验收完成定义（尽量机检）

- **G-A1 既有门禁全绿且可信**：BASELINE §9 十条命令照跑；其中两条已知异常必须先消除——`typecheck:bridge` 从 exit 2 转 0 且入 CI，G0-5 D4 段脚本从 exit 2 转正常执行（修引号或抽脚本）。理由：契约里「G0 全绿再动手」的红线引用的是这套门禁，它自身带红灯则契约失真。
- **G-A2 ArkTS 合规机检门**：新增 `node scripts/arkts-audit.mjs`（或等价）对 packages/*/src 扫可枚举禁则（function*/yield/Object.assign/freeze/defineProperty/delete/for-in/#私有/Symbol/globalThis/apply/call/bind/函数表达式）→ 0 命中；并把本轮发现项（F5）修复后由 netcheck 84 例钉住。
- **G-A3 KAT 可移植层**：`npm run test:kat` 全绿（建议 ≥60 例起步：§5 最小集）；`grep -rn "node:" packages/*/src/kat`（或等价路径）0 命中。
- **G-A4 harness 与桩**：perf 四件套 ArkTS 源码版 + platform 接口/回退桩文件入仓，Node 侧可加载（桩实现跑 FixedClock/ArrayRng 路径全绿）。
- **G-A5 三文档互引一致**：交接契约、人类配合说明书、CU 问答卡存在且数字口径与 BASELINE 一致（docs-consistency 式 grep：引用 495/30/66/8包 不得出现 238/280/54/6包 旧口径——BASELINE §6 勘误表）。
- **G-A6 遗留收敛**：真机侧剩余工作收敛为两份清单——「CU 卡答案」「platform 填空实现」，每项有验收判据；不存在第三类「未分类遗留」。
真机本身不在此定义内；定义的是「真机 agent 拿到就能干活」的状态。

### (2) 工作分解与优先序

- **P0**（不做就占用真机窗口或让真机 agent 迷路）：R2 Generator 修复 + G-A2 机检门；G-A3 KAT 剥离；CU 问答卡定稿；G-A1 两处门禁红灯修复。理由：全是 host 可验收、且每项延迟的代价都落在真机日。
- **P1**（真机日效率的放大器）：G-A4 harness+桩；回放纪律与复现包格式；R6 驱动权条款写进注入层接口；G-A5 文档一致性。
- **P2**（真机联调要用但不阻塞前四项）：interop/regress.mjs 三重缺陷修复（BASELINE 缺陷 #2，属互操作线）；headscale 环境准备文档化（人类侧）。
排序依据：依赖方向（P0 产物是契约的引用对象）× 不可替代性（真机窗口无法补偿 host 功课）。

### (3) 真机 agent 交接契约应包含什么

- **拿到什么**：本仓（8 包 + app 壳 + 三文档）+ 人类环境（DevEco/commandline-tools + 真机 + 可选 headscale）；一份「第一日顺序卡」。
- **做什么（顺序）**：①环境判定与基线复跑（G-A1 期望值写死，不符即停——沿 owner-with-real-device.md:27 模式）；②CU 问答卡逐张执行，输出原样抄录（CU6→CU7→CU2→CU5→CU8，CU6 决定集成方式是决策树根）；③按答案填 platform 空桩（Rng 填满断言、Clock 双轴、HttpTransport）；④perf 四件套首测（记录制）；⑤HAP 编译→安装→VPN 授权弹窗冒烟（DELIVERY §6.3 七步）；⑥headscale 隔离联调（若人类侧就绪）。
- **决策边界**： packages/ 一律不改（compliance 修复已在 P0 清完；若真机暴露新问题→回报不擅改，8 包冻结 + 版本修订走 architecture §10.3，handover/README.md 硬约束原文引用）；platform/ 填空许改；性能阈值裁定权、绕库走硬件加速、runtimeOS 切换（build-feasibility §3）三类属 owner。
- **禁则**：不碰生产 tailnet；不凭记忆写平台 API/协议语义（抄 .d.ts/查 docs/upstream）；错误处理只认 code 不解析 message（R7）；不试图在真机复跑 node:crypto 交叉层（F9）；authKey 不进 want.parameters/日志（VpnExtensionAbility.ets:26 既有纪律）。
- **回报格式**：每项 = 命令 + 原样输出 + 结论 + 证据 hash；失败附**复现包**（触发参数 hex + 最近随机字节快照 + 时钟轴快照，§4 机制）+ DELIVERY §7 真机节续写 + worklog append-only（沿 owner-with-real-device.md:77-83 模式但按 8 包口径重写）。

### (4) 人类配合说明书应覆盖什么

按阶段：**环境获取**（华为开发者账号、DevEco 或 commandline-tools 下载——账号墙是 build-feasibility §4 卡点 A 的唯一解，属人类独占动作）；**签名**（调试证书自动签名流程/是否提供账号）；**真机**（开发者模式/USB 调试授权/保持亮屏充电——perf 测温纪律需要）；**网络裁定**（GPU 机/办公网出网路由到华为仓——卡点 B；headscale 隔离实例的 docker 环境；preauthkey 签发与用后即弃）；**裁定项清单**（性能阈值确认、runtimeOS/开源 SDK 是否可接受、是否允许绕自研库的硬件加速）；**时间承诺**（真机窗口时段、agent 阻塞时的人工介入方式）。每项写明：人提供什么、人决定什么、agent 该在什么时候把什么问题递给人类。

### (5) 最容易被高估或做错的项

1. **高估「ArkTS 合规已解决」**：linter src=0 是 6 包旧口径（F6），且有实锤反例（F5 Generator）。合并人若直接采信 DELIVERY §5.4 的 src=0 叙事会漏掉整个 disco/netcheck。
2. **高估「测试全绿=真机能跑」**：495 例全部是 Node 侧证据（BASELINE §7「真机零数据」），契约必须写明 KAT 承接链（§5 末段）。
3. **做错「把 node:crypto 交叉层也搬上真机」**：不可移植层硬搬只会浪费真机窗口。
4. **做错「在真机上凭记忆写平台 API 签名」**：仓内连单调时钟 API 名都没有（F12），一期 5 处凭记忆教训在案（DELIVERY §6.4）。
5. **低估「先记录后定阈值」的顺序**：先写死阈值再测量会诱发凑数——BASELINE §3.4 的方差叙事（17% 波动）就是同一纪律的 Node 版先例。
6. **低估 CU6 否决分支的成本**：旧任务书写「预计 1 天工作量」（owner-with-real-device.md:55）是 6 包时代口径；现 8 包 72 文件/16904 行（BASELINE §2.11），批量改后缀或加 .ets 适配层的**回归验证成本**要按 495+30+66 三门口径重估——契约里的 CU6 决策树必须把回退分支的验证步骤写全，不能只写「改」。

## 10. 不确定性清单（我可能错在哪、谁在什么条件下复核）

1. **平台 API 候选名是我的印象不是仓内证据**：§4 提到的 Date.now 可用性（85%）、单调时钟 API——我未点名就是因为仓内零锚点且我无法联网核对华为文档（BASELINE §7 网络受限同因）。复核条件：真机 agent 查设备上 SDK .d.ts（CU7 卡执行时），我给的置信度全部让位。
2. **ArkTS/Panda 运行时各构造支持度的置信度分级**（R1/R4/R5/R6/R7）：依据是 constraints 转述的官方规则文本（2026-09-28 GitHub 镜像抓取，constraints U1 自标「在线文档可能漂移，发布前对 DevEco 内置文档核对」）+ 业界常识；**复核条件：DevEco/SDK 到位后跑一轮官方 linter + CU 卡**。
3. **握手 10–15 ms、真机 5–40 ms/op 均为推算**：未实测。复核条件：真机 perf 首测；Node 侧握手总耗时也建议补一次实测再定参照。
4. **KAT 剥离工作量 1–2 天**：经验估计，未拆到文件级；复核条件：实施者拆清单后修正。
5. **我只抽读了 x25519.test.ts 头部**确认双层结构，未逐条核对全部 49 个测试文件的向量形态；「KAT 死值集中在 crypto/noise/wireguard/netcheck/derp 五包」基于 DELIVERY §2.3 与 BASELINE §3.1 的转述。复核条件：实施 KAT 剥离时逐包盘点。
6. **我对「Node strip-only 与 tsc 均不拦 generator」的判断**基于：constraints P1:564-566 列举的拦截面（enum/namespace/参数属性/import=/export=）不含 generator + BASELINE §2.2 netcheck 84 例实测全绿（generator 代码在跑）。置信度高但属推理非亲测——亲测很容易：`echo 'function* f(){}' > /tmp/g.ts && node /tmp/g.ts`。

## 11. 风险与依赖

- **环境依赖（人类独占）**：账号墙 + 华为仓网络可达性（build-feasibility-linux.md §4 卡点 A/B）——无解则甲类工作全部白做不了真机验证，甲类仍是净收益（host 门禁与 KAT 层自洽），但要如实告知 owner。
- **结构依赖**：KAT 剥离若动 packages/ 目录，触碰「8 包接口冻结」约束的边缘——建议新增目录/包而非改既有导出（handover/README.md 硬约束：common index 不可改；新增比修改安全），最终形态由合并人裁定。
- **叙事风险**：本仓文档漂移史悠久（BASELINE §6 至少 8 处），本思考轨迹里的所有数字请合并人按 BASELINE §2 章节号复核后采信；我未复跑门禁（§0 已声明）。
- **跨视角依赖**：G-A1 中两处门禁红灯修复属门禁健康视角（BASELINE 缺陷 #1/#3），我在此仅声明其为主轴前置条件，归属由合并人协调，避免五位思考员重复规划同一项。

---

*写作时间 2026-10-03 · 全部引用可回溯至 §0 所列读物与检索；未跑检查均已如实标注。*
