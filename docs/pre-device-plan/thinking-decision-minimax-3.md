# 思考轨迹 · 决策思考员 MiniMax-3（视角：真机剧本与执行面）

- **身份**：五位决策思考员之一（模型族 minimax/MiniMax-M3.1-Flash-Preview），主轴 = **真机剧本与执行面**（真机 agent 拿到什么、拿不到什么、剧本哪一步会卡死）。
- **成文日期**：2026-10-03；基准 git `90ed53e`（未改动任何既有文件）。
- **禁读遵守**：未读 `docs/pre-device-plan/thinking-*.md`（历轮轨迹一律不读）；只读 PLAN.md / TESTS.md / BASELINE.md / 仓库源码与既有文档。
- **产出定位**：思考轨迹，**不拍板**。倾向全部标注置信度与前提；证据不足处写「不确定 + 缺什么证据」。

# 0. 本会话亲验清单（全部本轮实跑，命令与结果原样）

| # | 命令 | 结果 |
|---|---|---|
| V1 | `sed -n '68,87p' .github/workflows/g0-gates.yml \| bash -n` | **exit 2**，`syntax error near unexpected token '('`，报错行 = 文件第 83 行（D4 段 grep）。与 BASELINE §2.9 一致，本轮复现。 |
| V2 | `printf 'echo LINE1_RAN\nX=$(...)\nY=$(grep -E "a[\"]b" )\n...' \| bash` | `LINE1_RAN` 打出后才语法错、**exit 2** ⇒ bash 逐条解析，语法错**之前的命令照跑**。这修正了「整块 G0-5 从未执行」的可能误读。 |
| V3 | `sed -n '55,130p' .github/workflows/g0-gates.yml` 逐行读 | `|| true` 只出现在 `$( ... )` 内（:72/:79/:85），作用是让 grep 无命中时不触发 `set -eu`；真正的失败路径是三个 `exit 1`。**`|| true` 不吞 step 结果**。 |
| V4 | 读 `interop/h2c.node.ts` 全文（281 行） | 全文**唯一一条 import**：`:16 import type { ControlBaseSession, ControlBaseDuplex } from '../packages/noise/src/controlbase.ts'`。**零 node: 导入、零 process/console、零 node 内建**（PLAN O4 的「零 node: 导入」属实）。 |
| V5 | `grep -rn "h2c\|H2OverNoise" --include="*.ts"` | 消费者只有两处：`interop/register.node.ts:36`（用点 :228）与 `interop/derp.node.ts:27`（用点 :200）。落包要改的就是这两行 import。 |
| V6 | `grep -rhoE "from '(@ohos-tailscale/[a-z]+\|\.\./[a-z]+/src/[a-z]+\.ts)'" packages/*/src/*.ts` | 包内跨包只用**包名**（common 32 / crypto 10 / noise 1），仓内无 `../xxx/src/` 形态。`packages/control/src/client.ts:65` 已 import `@ohos-tailscale/noise` ⇒ h2c 落 control **不新增依赖边**（architecture D1 允许 control→noise）。 |
| V7 | `cat app/build-profile.json5` / `app/entry/build-profile.json5` / `find app -name "*.ets"` | **modules 只有 `entry`（srcPath `./entry`）；entry 的 targets 只有 `default`；全仓仅 3 个 .ets，无 `ohosTest/`、无 hypium 依赖**。⇒ 任何**放在模块 srcPath 之外**的 .ets（含 P1-13 拟放的 `app/tools/perf/`、P1-1 的真机外壳）**都不进 HAP**。 |
| V8 | `cat tsconfig.json` | 根面 `types: ["node"]` + `erasableSyntaxOnly` + `allowImportingTsExtensions`；`include: packages/**/*.ts`、`exclude: ["app"]`。⇒ 包内写 `process.argv` 会 **tsc 绿但 ArkTS 运行时炸**（`process` 无此全局），tsc 不会拦。 |
| V9 | `grep -rn "x25519\|scalarMult" packages/wireguard/src/*.ts` | x25519 **只出现在 `handshake.ts`**（:142 scalarMult、:217/:251/:449/:586 公钥导出）；`transport.ts` 不调用（每包走 AEAD）。另 `grep -rn "REKEY\|rekey" packages/wireguard/src/*.ts` 只命中 cookie 的 `WG_COOKIE_REFRESH_MS=120000`（cookie-reply.ts:42），**仓内无重键周期常量**。 |
| V10 | `grep -rEn 'Date\.now\|Math\.random'` / `from ['\"]node:` / D4 特征 三段扫 `app/bridge/src`（10 文件） | 三段各 **exit 1（0 命中）** ⇒ TESTS R9「现实测 0 命中」本轮复现属实。 |
| V11 | `grep -rl "node:" packages/*/test/*.test.ts \| wc -l` = **49** / `find packages -name "*.test.ts" \| wc -l` = **49** | 49/49 测试文件都 import node: ⇒ D11「真机复跑 495 例是陷阱」有据。 |
| V12 | `node scripts/test-plan.mjs` | `16 文件｜GREEN_OK 25｜ANCHOR_RED_OK 54｜UNEXPECTED_RED 0｜STALE_ANCHOR 0｜UNKNOWN_TEST 0`（TESTS 交付的 runner 本轮可跑、四态分类正确）。 |
| V13 | `ls -d evidence` → 不存在；`ls app/tools/` → 只有 `validate-shell.mjs`；`git status --porcelain` | `evidence/` 目录不存在、`app/tools/perf/` 不存在、`docs/pre-device/` 不存在（未跟踪项只有 baseline-audit/pre-device-plan/gates.registry.json/test-plan.mjs/tests/）。 |
| V14 | `grep -rn "8 包\|八个包" <活文档面>` | 8 处落点：README.md:10 / TASK.md:10 / DELIVERY_REPORT.md:231 / handover/owner-with-real-device.md:73 / handover/README.md:19 / handover/reviewer-pr-style.md:12,:106 / architecture.md:5,:529。 |
| V15 | `grep -n "D-1" -A 12 TASK.md` | D-1 原文（:54）：「…跑 `interop/start-headscale.sh` + register/h2c/derp：**全部 exit 0** 且输出含 `INTEROP PASS` 与 `DERP INTEROP PASS`」。**契约里没有第三种 marker**。 |
| V16 | `grep -n "hypium" -r .`（排除 node_modules） | hypium 只出现在**文档**里（arkts-constraints.md:807 U8、DELIVERY_REPORT.md:143），**代码/配置里 0 命中**。 |

# 1. 深挖五项（我的主轴）

## O4 H2OverNoise 落包位置

- **选项枚举**：A 并入 `packages/control/src/h2c.ts`（PLAN 建议）；B 新增独立第 9 包（如 `packages/h2c/`）；C 维持现状留 `interop/h2c.node.ts`；D 复制一份到 `app/entry` 侧（分叉）。
- **证据约束**：
  1. h2c 281 行、**唯一 import 是 type-only**（V4）⇒ 落包无运行时依赖搬迁，PLAN 说「成本低于轨迹 5 当时预估」有据。
  2. 落 control **不加依赖边**（V6，architecture.md:37 D1 已允许 control→noise；:39 D3 要求跨包用包名 + 包内相对导入带 `.ts`，正好把 `../packages/noise/src/controlbase.ts` 改成 `@ohos-tailscale/noise`）。
  3. 改 import 的面就是两行（V5：register.node.ts:36 / derp.node.ts:27）。
  4. **决定性约束（PLAN 未写出）**：V7 显示 HAP 只编 `app/entry` 一个模块 ⇒ **`interop/` 里的任何 .ts 都到不了真机**。真机 S6 要用 H2OverNoise，只有两条路：落进包（走 P1-7 镜像 / ohpm file: 集成），或在 S6 时由真机 agent 手工把它拷进 entry——后者正是 D5「不预锁死」和 R1「环境失败误诊为代码问题」要禁的自由发挥。
  5. 反向约束：落包后 `validate:arkts` (a) 面会扫到它（P0-3 扫描面=packages/*/src），它用了 `Array<[string,string]>` 元组 + 大量 `buf[i]` 下标（h2c.node.ts:219/246-253 等）。元组类型是否触发 A13/A14 语义禁则**我无法在本机验证**（门未建），这是唯一未验证的落包风险。
- **倾向**：**A（置信度 中高）**。依赖前提：①O2 裁定为「补 CLI」；②落包时 CLI **不写进包文件**（见下）。
- **反方最强论证**：「h2c 是 interop 联调胶水、不是协议库的一部分，落包会让 packages 混入一个带 HPACK/HTTP2 帧层的手写实现，扩大 8 包冻结面并把『只增不改』变成常态先例；真机侧镜像方案 2 已经能解决取用问题，犯不着动包结构。」
- **选错后果**：选 C 且真机走到 S6 → 真机 agent 面临「把 interop/h2c.node.ts 拷进 entry」，这会同时踩三条红线：validate:arkts (a) 面扫不到它（假绿）、改动不在 git 冻结面的评审视野内、D8「mock/胶水不上设备」的隐含前提被打破；S6 是全剧本最难一环，失败后连二分线索都没有。选 B（独立第 9 包）则额外制造 O5 刚要制造的「9 包 vs 10 包」口径混乱，且破坏 D1 依赖图（h2c 依赖 noise+controlbase，独立包要么复制要么再开一条边）。
- **可代拍性**：**可代拍**。应记录条件：落位 `packages/control/src/h2c.ts`；`import` 改为 `@ohos-tailscale/noise` 的 type-only 形式；**barrel 是否加导出单独裁决**（不加导出 → interop 走深路径 `../packages/control/src/h2c.ts`，导出面 396 不变、holdout h09 不动；加导出 → h09 是 ⊇ 断言仍通过，但 TESTS §4.4 白名单「8 包/495 现行口径」与 architecture.md:5 措辞要跟着改）。重审触发：CU6 答案为「否」且镜像路线确立后；或 validate:arkts 落地后 h2c 被 (a) 面判红。
- **⚠ 与 O2 的耦合（我发现的、PLAN 未点破的一条）**：若 O2=补 CLI 且 CLI 写进 `packages/control/src/h2c.ts`，则包内出现 `process.argv/console.log`——tsc 会绿（V8：`types:["node"]`），**但 ArkTS 运行时没有 `process` 全局**，这是一个「本机门全绿、真机首日崩」的定时炸弹。正确形态是：**包内只放类，CLI 薄壳留 `interop/h2c.cli.ts`**（`process.argv` + 调用包内类 + 打 `H2C PASS`），regress 阶段 3 改指薄壳。这样 O2 与 O4 可以同时成立而互不污染。

## O5 kat 第 9 包

- **选项枚举**：A 新增 `packages/kat/`（PLAN 建议）；B 放 `packages/common/src/kat/`（动 common = 破冻结，附录 B 已否决）；C 不落包、KAT 留在 app/bridge 或 scripts 下；D 维持不动（不做 KAT）。
- **证据约束**：
  1. PLAN 的「只增不改、接口冻结最安全」成立：architecture.md:529 冻结原文是「`packages/common/src/index.ts` 公开 API 冻结 + 八个包只 import 不修改 common」——**新增一个包不修改任何既有文件**（architecture.md:5 措辞是「本文是 `packages/` 下八个包的实现契约」，新增第 9 包不使本文失效，只是「八」这个数过时）。
  2. 代价是可数的：V14 实测 8 处「8 包」落点要改，其中 architecture.md:5 属实现契约文档，改它按 §10.3 走版本记录（v1..v1.3 三条先例，:549-553）；README.md:10 同句还带着「约 8400 行」旧数字（P1-2 已在清）。
  3. **真机取用路径（V7 的硬事实）**：hypium 在仓内代码/配置 0 命中（V16），无 `ohosTest/` 模块、无 test target。P1-1 原文「真机侧外壳只留接口约定不实现」是诚实的，但代价是：**S5b 当天真机 agent 要自己搭 ohosTest 模块脚手架（module.json5 + hypium 依赖 + test target + ability）**，而 S3/S3.0 已经预期编译报错（PLAN §3.2 S3）。这是把一个「L 级」工作塞进真机第一天的隐藏账。
  4. CU2 是硬闸：x25519.ts 有 35 处 bigint、aead.ts 11 处（实测 grep）⇒ 若 ArkTS 不支持 BigInt（arkts-constraints.md:801 U2），**KAT 里最值钱的两组向量（x25519 / ChaCha20-Poly1305）在真机上一条都跑不了**，只剩编码层 KAT 有信号。所以 O5 的「真机价值」高度条件化于 CU2。
  5. 依赖方向：`packages/kat/src` 必然 import crypto/noise/wireguard 等（向量要与实现交叉验证）⇒ kat 是**依赖方**（D2「禁止反向边」不冲突，因为 kat 不是被依赖方）。但它把 packages 依赖图从「单向无环的 8 包」变成「9 包 + 1 个顶层消费者」，若日后再有第二个顶层消费者，口径会重复讨论。
- **倾向**：**A（置信度 高）**，但**必须附三个记录条件**：①kat 定位写死为「顶层测试消费者，非协议包」，进 architecture.md §10.3 版本记录时明写此定位；②真机外壳的**落位决策前移到 O5 一起拍**（见下）；③T-HANDOFF-c 白名单（「8 包/495 现行口径」，TESTS §4.4）随 O5 通过同步改为「9 包/495」。
- **关于「真机外壳落位」的分叉（我建议一并拍，PLAN 未拆）**：选项 i = hypium 测试模块（标准做法，但要新建 ohosTest 脚手架，CU8 首答成本最高）；选项 ii = **不用测试框架**：在 `app/entry/src/main/ets/` 下加一个「自测」入口（Index.ets 上加一个按钮或复用 S5 冒烟路径），调用 `runKat()` 与 perf 四件套，把 JSON 写到应用沙箱，`hdc file recv` 拉回。我倾向 **ii 优先、i 兜底**：KAT 的目的只是「同一份向量在 ArkTS 运行时给出同一批结论」，不需要测试框架的断言/报告能力；ii 绕开整个 ohosTest 脚手架与 CU8，直接落在已经要建的 entry 模块里（S5 冒烟本来就要人点按钮）。反方会说 ii「不是测试、正规性差、以后接不上 CI」——但 CI 上跑真机 KAT 本来就不在本仓 CI 能力内（无 SDK/无设备）。
- **反方最强论证**：「第 9 包改的是架构文档的基数，而收益要等真机、且真机当天还要自己搭 hypium 脚手架——为了一个尚未证明能在 ArkTS 上跑的向量集（CU2 未答）先动冻结面，是典型的过早承诺。」
- **选错后果**：选 D（不做）→ S5b 无任何「协议核心与向量一致」的真机证据，退回 495 例对真机证明力为零的原状，B1/B5 两张 CU 卡失去载体，S5b 阶段整个作废。选 C（放 app/bridge）→ bridge 是 mock 层、tsconfig 面是 node types、KAT 与 protocol 真值同源，h07 类「实现与向量同源」的循环论证风险直接引入。
- **可代拍性**：**可代拍**（知悉性）。记录条件：定位=顶层测试消费者；不改任何既有包文件；kat 内部零 `node:` 导入（TESTS T-P1-1b 已钉）；arch 真机外壳走 ii 优先。**重审触发**：CU2 答案=否（则 KAT 覆盖面从「密码学全量」缩到「编码层 + 非 BigInt 部分」，需重估 KAT 规模）；或 CU6=否（则取用路径改镜像，需重录 O5 的理由段）。

## O6 真机性能阈值与 >50ms 逃生门

- **选项枚举**：A 纯记录制（先记录、阈值后定，PLAN D12）；B 预设硬阈值 ≤25ms/op；C 分档：≤25 绿 / 25–50 观察 / >50 触发决策；D 现在就裁定「>50ms 即改走 cryptoFramework/Go .so」。
- **证据约束**：
  1. 软参考 25ms ≈ Node 区间上界（3.51–4.10，BASELINE §3.4）的 6 倍——这是一个**没有真机数据支撑的先验倍数**，只能当提问起点，不能当判据。
  2. **x25519 只在握手路径**（V9：handshake.ts 四处，transport.ts 不调用）⇒ x25519 慢**不拖慢每包吞吐**，只拖慢握手/重键。这是「>50ms 就要换库」这一叙事的最大反证。
  3. 但仓内**没有重键周期常量**（V9 grep 无 REKEY_TIME/REJECT_AFTER_TIME）⇒ 「一次握手慢 50ms 可不可接受」无法在纸面回答，**必须等 perf-handshake-e2e 的握手总耗时**（P1-13 已含该件套）。这恰好说明 O6 不该在真机数据前定死。
  4. BASELINE §3.4 的 17% 波动（同机负载）说明即便真机也要 3 次取中位，单次数字不可用。
  5. 逃生门若指向 cryptoFramework/Go .so，成本量级完全不同：后者在 VpnExtensionAbility.ets:74-78 明确与「纯 TS 实现」路线冲突（PLAN O6 引用行号属实，我读了原文 :74-78）。
- **倾向**：**C（置信度 中）**。具体形态建议拍板文本写成：
  - ≤25 ms/op：按当前纯 TS 实现继续，不做任何架构动作；
  - 25–50：记录，不阻塞，但**必须在报告里同时给出 perf-handshake-e2e 的握手总耗时**；
  - >50：**触发 owner 裁决 O6，不自动换库**；真机 agent 的动作被限定为三件事——测、记、按判定树停在 S5b 不往下走、回报「是否影响 S6/S8 可达」的判断。
- **「谁触发/真机 agent 拿到什么指令」的具体化（PLAN 未写，我补）**：D10 六条升人触发（PLAN §3.3）**没有 perf 这一条**——这是一个条款缺口。要么在 O6 裁定里新增第 ⑦条「真机 perf 超阈值 → 停并升人」，要么在 STAGE-CHECKLIST 的 S5b 步骤上写死「>50 → 停止 S5b，回报 owner」。我倾向后者（不改动 D10 编号体系，避免判定树五断言的 `升人: 是(D10-①…⑥)` 编号集被迫扩容——tree-check 第③断言按编号校验，TESTS §4.2）。
- **降级路径是什么（PLAN 完全没写）**：>50 时的降级**不是换库**，而是三条按代价递增的路径：
  1. 降用法：接受慢握手，只要握手总耗时仍在控制面超时预算内（headscale/controlclient 的超时以包内常量为准，可机检）；
  2. 降频：把重键/换密钥路径的频率限制在可接受范围（不改协议语义，属 app 侧调度）；
  3. 换实现：cryptoFramework 硬件路径或 Go .so（VpnExtensionAbility.ets:74-78 预留），**这一步只由 owner 在 O6 里开**。
- **反方最强论证**：「设任何阈值都会在真机数据到手后被追认为『当时定错了』；D12 的记录制已经足够，O6 应该整项后置到有数据那天，现在讨论等于给假数字上户口。」
- **选错后果**：B（预设硬阈 25）→ 真机若测出 30ms，agent 会认为自己「不合格」，诱发改 perf 脚本/改测法凑数（R10 的失效形态）；D（现在裁定换库）→ 在零数据下把整个实现路线推向 Go .so，代价是作废 16904 行纯 TS 实现与 495 用例。选 A（纯记录）→ 与 PLAN 一致但缺了「>50 时 agent 到底该干嘛」的指令，真机 agent 会自由发挥（正是 R1 的形态）。
- **可代拍性**：**阈值不可代拍**（需真机数据）；但**「记录制 + 三档形态 + 触发即停 + 指令文本」现在就可代拍**，且必须在 O6 被数据触发前就写进 STAGE-CHECKLIST，否则真机 agent 拿到的剧本里这一格是空的。

## R4 S5b 随机字节快照步骤 × D13 复现包闭环

- **选项枚举**：A 采纳（R4：STAGE-CHECKLIST 必须含该步骤 + check-stage-docs 断言存在性）；B 只在 P1-5 契约里留钩子、剧本不写步骤；C 快照只在失败后补采；D 取消 D13 机制。
- **证据约束**：
  1. Rng 接口冻结在 `packages/common/src/random.ts:12-15`，`ArrayRng`（:21-37）按游标循环取字节——**回 Node 重放的载体已经存在且是死值**（用 ArrayRng + FixedClock 注入即可复现）。D13 的技术底座是现成的。
  2. 但**真机上没有 ArrayRng**：真机 adapter 是 cryptoFramework 的安全随机（P1-5 的 `DeviceRng` 契约，尚未存在）。要留快照，adapter 必须在每次 `randomBytes(into)` 后把字节追加写入一个环形缓冲。
  3. 缺口在「存哪」：V13 实测 `evidence/` 目录不存在。真机沙箱里的文件要落到 host，只能经 `hdc file recv`；PLAN §3.4 的证据目录结构全是 host 侧路径，**没有一条写「真机侧文件怎么进 evidence/」**。这是 R4 落地时必须补的一句话，否则步骤写了也执行不了。
  4. 与 R3 的耦合：host 侧 summary.json 现在只写 `mkdtempSync(tmpdir())`（regress.mjs:71-73，我读了原文），TESTS R3 已指出 `--out` 是断点。**设备侧要对称地有 `--out` 等价物**（快照落盘路径），否则「原件入 evidence」在两侧都不成立。
- **倾向**：**A（置信度 高）**，但必须把 R4 从「加一条步骤」升级为「加一条步骤 + 三个配套物」：①STAGE-CHECKLIST 的 S5b 步骤写明**触发时机**（每次 S5b 跑 KAT/perf 前先开快照缓冲，而不是只在失败后采）；②快照落点与回传命令（`hdc file recv` → `evidence/interop-<date>/rng-snapshot.bin`，含 `.bin` 是否被 `.gitignore` 吞的确认——`.gitignore` 命中的是 `*.log`/secrets 后缀，二进制 `.bin` 不在内，属安全）；③check-stage-docs 的存在性断言之外，再加一条「步骤文本里必须含回传命令」。
- **反方最强论证**：「快照钩子会污染热路径（每次 randomBytes 多一次数组拷贝），且 99% 的 S5b 都是通过的，为不发生的失败付性能与复杂度不划算；不如在 S6/S8 真失败后再按判定树回头补采。」
- **选错后果**：选 B/C → D13 空转，真机失败时拿不到随机字节，S6 的失败归因退回「贴原始输出 + 猜」，R1 风险直接兑现。选 D → 同上，且失去唯一确定性底座。选 A 的成本是可估的（环形缓冲 + 一次 recv），比事后归因便宜。
- **可代拍性**：**可代拍**。记录条件：快照是**环形缓冲 + 显式 dump**，不是全量落盘；buffer 开关由 adapter 参数控制（默认关，D13 需要时开）；触发时机写进剧本。**重审触发**：真机确认 `@ohos.file.fs` 在 VpnExtensionAbility 进程内同步写会卡扩展进程（P1-5 已预警 worker 线程评估点）→ 改为 hilog 输出或移到 UI 进程写。

## R11 env-ready 三元组对 OWNER-GUIDE 的改动量

- **选项枚举**：A 采纳三元组（值+证据+时间戳）；B 维持裸 bool；C 二元组（值+证据，TESTS 测轨5 原案）。
- **证据约束**：
  1. 现有唯一的人类配合说明书是 `docs/handover/owner-with-real-device.md`（89 行，结构 = 前置 + Day1..Day7 七段 + 红线 + 完成后必做 + 找不到时怎么办），**不是** PLAN §4.1 的「每阶段三栏」形态。OWNER-GUIDE.md 是新建文件（V13：`docs/pre-device/` 不存在）。
  2. 所以改动量不是「改三栏为三元组」，而是**从 Day-Narrative 重写为 S0–S8 × 三栏 × 每栏一个 env-ready 键**。量级估算：9 阶段 × 3 栏 = 27 个小节 + env-ready 键数（TESTS §4.3 已给 `s0.sn_visible` 等形态），加一段「怎么用 hdc 输出填 evidence」。
  3. TESTS §4.3 已把校验器实现好并自测通过（T-ENV-a/b/c 现绿），R11 的增量只在 schema 形态与 OWNER-GUIDE 文案，**机检侧成本低**。
  4. 三向对齐要求（OWNER-GUIDE 判据栏 ↔ schema 键 ↔ 剧本引用点字面一致）是真正的成本来源：改任一处要同步三处，否则 check-stage-docs 第四断言红。
- **倾向**：**A（置信度 高）**。附一条我认为应写进拍板文本的细节：**evidence 字段要有可粘贴的原文长度上限提示**（hdc 输出可能几十行，全贴进 JSON 会让人类不想填），建议 schema 允许 `evidence` 指向一个同目录文件 + 一行摘要，否则三元组会因「太麻烦」而空填，反而制造 R1 残余。
- **反方最强论证**：「三元组把人类的动作量从『勾 6 个框』抬到『填 6 个 JSON 对象带时间戳』，在 S4 那个时间点（人正在被签名流程折磨）很可能直接空填；env-ready 防漏填不防填假（R1 残余，PLAN 自认），那多出来的两个字段到底买到了什么？」
- **选错后果**：选 B（裸 bool）→ 人填「已完成」而实际没做，agent 无从分辨，T-ENV 全绿但 S5/S6 照样卡住；且这与 TESTS「贴原始输出而非结论」的纪律正面冲突。选 A 的风险是**空填率**，缓解办法是 OWNER-GUIDE 每阶段把「怎么拿 evidence 原文」写成一条可复制命令。
- **可代拍性**：**可代拍**。记录条件：`evidence` 允许「文件路径 + 摘要」二选一；`at` 用 ISO8601 带时区；schema 外多出的键也必须带 evidence（TESTS §4.3 已定）。重审触发：OWNER-GUIDE 试填一轮后空填率 > 30%（这个数字要在真机前用一次桌面演练测）。

# 2. 其余 15 项逐项

## O1 远端 Actions 状态确认
- **选项**：A owner 登录看（PLAN 原案）；B 代拍保守推定「从未绿过」并后置确认；C 声明不可知、不影响任何门禁决策。
- **证据**：V1/V2/V3——G0-5 的 D4 段是**解析期语法错误**、step 必然非零；`|| true` 不吞结果；job 无 continue-on-error（TESTS V7）⇒ **该 step 自 51b70c3 起每次运行都红**（本地推定）。但「是否推送过、是否有人看过红」本机不可知（BASELINE §3.2「仅文档声明（本地不可查）」）。V2 还修正了一点：P4/node: 两段在语法错之前**照跑**，所以口径应是「D4 段从未执行，整 step 一直红」，不是「整块从未执行」。
- **倾向**：**B（置信度 高）**——现在就把定性口径定为「CI 自 51b70c3 从未绿过（本地推定，待 owner 一句话证实或证伪）」，R3 的缓解（P0-4 合入后建立绿基线）照做，O1 作为不阻塞项挂在 DECISIONS 上。
- **反方**：把「推定」写进活文档面等于制造新的待证实断言；应当直接留空等 owner。
- **后果**：选 C 且 owner 长期不回 → R3 无缓解口径，新回归被当「本来就红」；选 A 并把 P0-4 合入后才查（PLAN 的排序约束正确）→ 最省。
- **可代拍性**：**推定可代拍，事实不可**。必须人类的一分钟动作：登录 Actions 页回报一句 yes/no。

## O2 regress 阶段 3 处置
- **选项**：A 补 h2c CLI（PLAN 建议）；B 删阶段（改契约）；C 保留阶段但不在 regress 里跑（=B 的变体）。
- **证据**：TASK.md:54 明文「register/h2c/derp 全部 exit 0」（V15）——A 是履约、B 是改约。**我新发现的关键约束**：`DERP INTEROP PASS` 字符串**包含** `INTEROP PASS` 作为子串，若 P0-5 的 marker 判据用 `includes('INTEROP PASS')`，derp 阶段会串台满足 register 阶段的 marker——TESTS §1.2 S7 已经点出这条，但要真正实现必须按**每阶段专属 marker**判（`INTEROP PASS` / `DERP INTEROP PASS` / `H2C PASS`），且判据得是「该阶段 marker 出现在该阶段子进程 stdout」而不是全局扫。
- **倾向**：**A（置信度 高）**，且**必须附带 O4 的薄壳形态**（见 §1 O4 的耦合段）：CLI 留 `interop/h2c.cli.ts`，不写进包。
- **反方**：h2c 在 register.node.ts:228 与 derp.node.ts:200 里都已被间接用到（它们各自建 `new H2OverNoise(...)`），独立阶段 3 只是「再连一次」，信息量边际；且它多一个进程、多一个失败归因点。
- **后果**：选 B → 必须改 TASK.md D-1 与 owner-with-real-device 交付项，等于用一次静默的能力收缩换 0.3 天工时；选 A 但把 CLI 写进包文件 → 见 O4 的定时炸弹。
- **可代拍性**：**可代拍**（触及验收契约边缘，故 owner 追认位需留）。

## O3 headscale.device.yaml 红线豁免
- **选项**：A 出书面豁免（PLAN 建议，限定设备侧）；B 不豁免，改用另一套机制（如端口转发/隧道）；C 不做设备侧配置（放弃 S6 真跑）。
- **证据**：D3/D5 已定双配置；`agent-interop-regression.md:56-57` 红线原文「headscale 监听只绑 127.0.0.1」「一切 HTTP 只对 127.0.0.1:8080」——豁免必须**指名道姓地写「本条红线在设备联调场景下由 headscale.device.yaml 承接，基线 yaml 不动」**，否则红线文本与配置会长期互相矛盾。另外 :19/:26 的 `<VERSION>` 死占位与 :59「ssh 仅走 dev-env-with-gpu 别名」都指向 O7 未答前不能预写环境别名（TESTS §4.4 黑名单已把 `dev-env-with-gpu` 列入）。
- **倾向**：**A（置信度 中高）**，范围限「本任务、设备侧、LAN 联调期、有效至 S8 结束或 owner 撤销」。
- **反方**：豁免一旦写下没有撤销机制就会变成先例——下一个子线 D 的执行者会援引它把基线 yaml 也改成 0.0.0.0。
- **后果**：选 B → 手机连不上 headscale，S6 必败且难二分；选 C → 全剧本终点消失（等于回退到「只交付交接物」的可接受终局）。
- **可代拍性**：**豁免令文本可代拍**；**「谁撤销、何时撤销」可代拍**；但**具体 LAN 地址/是否可达必须人类确认**（需真实网络观测）。

## O7 headscale 环境供给确认
- **选项**：A 沿用 `dev-env-with-gpu` ssh；B 本机 docker；C 另一台机器；D 暂不提供（真跑 regress 推迟）。
- **证据**：BASELINE §3.2「interop 三脚本真控制面联通=仅文档声明、本机不可跑」；`agent-interop-regression.md:72` headscale windows amd64 从未发布 ⇒ 本机直跑被物理排除，选项 B 若指「本机 docker」在 win32 上也不成立，只能是 WSL。三个未知量（别名是否仍有效 / 谁提供 docker / preauthkey 谁签发）**物理上只有 owner 能答**。
- **倾向**：**保持待人类**，但**代拍一个默认**：默认按 D（暂不提供），并把 S2 的「若 headscale 主机已备」条件句保留（PLAN §3.2 已如此写，写法正确）——即真机剧本必须能在**没有 headscale 主机**的情况下继续推进到 S5b，这样 O7 不会阻塞关键路径。
- **反方**：O7 不答则 S6 无对照基线，S6 失败时无法二分「协议栈 vs 手机网络」（PLAN §3.2 S2 已把这条写成对照价值）。
- **后果**：默认 D → 真机 agent 首日只能到 S5b，S6 之后全部顺延；这与 PLAN §3.2 的「总回退=可接受终局」相容，不算失败。
- **可代拍性**：**必须人类**（需外部环境事实与授权）。

## R1 A17 判据 / R2 三门 `--root` / R3 P0-5 补 `--out`
- **R1**：可代拍（A17 = `node scripts/test-plan.mjs` 四态全清）。证据：我本轮跑通（V12），25 绿/54 红锚/0 意外。风险是「批次四后 79 全绿」这个终态断言会被真机 agent 当成可跳过的目标——建议在 A17 行加一句「锚点全翻须各有一条 worklog 红→绿记录」。**倾向：采纳**。
- **R2**：可代拍。三门（gate-d4-p4 / ets-mirror-check / doc-consistency）必须支持 `--root`。我亲验的门是 `validate:shell`（现有）与 `test-plan.mjs`（新增），TESTS U1 已实测 validate-shell 可搬走跑。**倾向：采纳**；但要提醒：`--root` 副本运行要求门**不写回被检树**（镜像产物不落盘残留，TESTS T-P0-3 已列）。**选错后果**：不采纳 → 注入式 meta 只能脏改工作树，与「禁改既有文件」纪律冲突。
- **R3**：可代拍，且**我从真机剧本侧补一条**：设备侧需要 `--out` 的对称物（见 §1 R4 段）。证据：regress.mjs:71-73 实测写 tmpdir。**倾向：采纳**。

## R5 P0-7 验收补「不该进的没进」 / R6 caliber.json 无值结构
- **R5**：可代拍。证据：`.gitignore` 中 `*.log`(:27) 与 secrets 段（`*.p12` 等）共存（我读了 :20-50）。TESTS 给了三条负例（evidence 下 .p12 仍被吞 / 工具目录不击穿 / 仓根 foo.log 仍被吞）。**倾向：采纳**——这条对真机侧尤其重要，因为真机回报的原始输出常以 `.log` 落盘，而凭据也可能在同一目录。
- **R6**：可代拍（`{id,cmd,extract,relation}`，min 双字段 floor+current）。从执行面看它有个副作用要注意：caliber.json 会成为「数字的唯一真值源」，那么 **P1-2 改文档时不再手写数字**，而是门跑出来写回——这是对的，但要写清「谁在什么时候跑」否则会有人手填 current。**倾向：采纳 + 加「current 由门跑出来写回，不许手填」**。

## R7 check-decision-trees / R8 P1-2 暂不判定 / R9 D4/P4 扩面 app/bridge/src
- **R7**：可代拍。**从真机剧本侧我认为这是 R1–R13 里性价比最高的一条**：判定树有洞 = 真机 agent 在 S3/S6 自由发挥。规格内核与五个坏树负对照已在 `tests/plan/lib/tree-check.mjs` 且自测通过（TESTS §2.2）。**倾向：采纳**，并建议追加两条覆盖：CU 卡树 + **S5b/perf 触发树**（§1 O6 缺口）。
- **R8**：可代拍。理由成立（防「一次性 grep 自证」制造第二次假绿）。**倾向：采纳**。
- **R9**：可代拍但**必须带声明义务**。我本轮实测 `app/bridge/src`（10 文件）三段全 0 命中（V10）⇒ 扩面零技术阻碍。反方最强论证是「bridge 里将来会有 `platform-ports.ts` 的 `protect(fd)` 之类，真正的 D4 风险面在 `app/entry`，扩 bridge 不解决主要问题，反而会让门在 app/entry 面前继续沉默」。我的回应：扩 bridge 仍值得（它现在就 0 命中且是唯一活动面），但**扩面必须同时把 `app/entry/src/main/ets/platform/` 的纪律写成声明**，否则是「换了个更省事的面」。**倾向：采纳 + 门头注释必须列全检索面**。

## R10 P0-8 第二档路径校验 / R12 P2-1 验收细化 / R13 perf 豁免带理由
- **R10**：可代拍。「存在但不是 SDK 目录」的第二档是真正证明做了校验的形态（第一档易蒙混）。**倾向：采纳**。
- **R12**：可代拍。P2-1 从 importlib 直调扩到真 HTTP server 层，且「Python 视角 inbox **字节级**只含合法文件」——我核过 BASELINE §2.7 的现值（单元 8 + 集成 7，集成是 importlib 直调），所以「原 8 条逐条仍绿」是可执行断言。**倾向：采纳**。
- **R13**：可代拍但**我的立场比 TESTS 更保守一档**：问题不只是「豁免要带理由」，而是 **`app/tools/perf/` 根本不在任何模块 srcPath 里（V7）⇒ 里面的 .ets 不进 HAP ⇒ 真机跑不了**。所以 R13 应与 O6/P1-13 一起解决：perf 源码的**可执行副本**必须落在 `app/entry/src/main/ets/`（或 ohosTest）下，仓内保留的 `app/tools/perf/` 是**源码母本**而非可执行体——这一句必须写进拍板文本，否则真机 agent 会在 S5b 发现「文件在但跑不了」。豁免面本身的处理（同 R9：声明 + 非空理由 + meta 断言）我同意。

# 3. 20 项倾向汇总表

| 项 | 倾向 | 置信度 | 最依赖的前提 |
|---|---|---|---|
| O1 | 代拍保守推定「CI 自 51b70c3 从未绿过」，owner 一句话后置证实 | 高 | 远端 Actions 真值只 owner 可见 |
| O2 | 补 CLI，且 CLI 薄壳留 interop 不进包 | 高 | O4 同拍；marker 不串台（S7） |
| O3 | 出书面豁免，限设备侧 + 期限 + 可撤销 | 中高 | 需真实网络观测确认 LAN 可达 |
| O4 | 落 `packages/control/src/h2c.ts`，CLI 不进包 | 中高 | CU6 答案未定；barrel 导出不加 |
| O5 | 通过 `packages/kat/`（第 9 包），附三条件 | 高 | CU2（BigInt）未答则覆盖面缩水 |
| O6 | 三档记录制；阈值不可代拍，指令文本可代拍 | 中 | 需真机 perf + 握手总耗时 |
| O7 | 默认 D（暂不提供），不阻塞 S0–S5b | 中 | 外部环境事实只有 owner 知道 |
| R1 | 采纳 A17 | 高 | runner 已可跑（V12） |
| R2 | 采纳三门 `--root` | 高 | 门落地时不写回被检树 |
| R3 | 采纳 `--out`，并补设备侧对称物 | 高 | regress.mjs:71-73 断点属实 |
| R4 | 采纳，且升级为「步骤 + 触发时机 + 回传命令」 | 高 | 需确认 hdc file recv 路径 |
| R5 | 采纳三条负例 | 高 | .gitignore 结构已亲读 |
| R6 | 采纳 caliber.json + 「current 由门写回」 | 中高 | 单源写入纪律需写死 |
| R7 | 采纳，追加 perf 触发树 | 高 | tree-check 内核已自测 |
| R8 | 采纳「暂不判定」 | 高 | P1-3 建成后翻转 |
| R9 | 采纳扩面 + 强制声明检索面 | 中高 | 同时声明 app/entry 的纪律面 |
| R10 | 采纳第二档 | 高 | P0-8 实现者按两档写 |
| R11 | 采纳三元组；evidence 允许「文件 + 摘要」 | 高 | 试填一轮测空填率 |
| R12 | 采纳逐条 + 字节级 | 高 | 真 HTTP server 需能起 |
| R13 | 采纳豁免带理由，但**另加「perf 源码须有可执行副本落 entry」** | 中 | 与 O6 耦合 |

# 4. 决策依赖图（必须一致地拍）

```
O2 ──(CLI 落位)──► O4 ──(barrel/导出面 + 8包措辞)──► O5 ──(9包措辞 + T-HANDOFF-c 白名单)──► P1-2/P1-3
 │                                                                            │
 └──(marker 集合 INTEROP/DERP/H2C PASS)──► P0-5 selftest S7 ──► R3(--out) ─► R4(设备侧快照)

O5 ──(CU2/CU6 依赖)──► D4 判定树 ──► P1-7 镜像面 ──► O4(取用路径)
O6 ──(perf 可执行副本落 entry)──► R13 ──► P1-13 ──► O6 的真机数据
O3 ──(设备侧配置)──► O7(环境供给)──► S6 判定树
R11 ──(三元组)──► OWNER-GUIDE 重写 ──► P1-12 ──► check-stage-docs 第四断言(三向对齐)
R7 ──(树完备性)──► STAGE-CHECKLIST ──► O6 的「>50 停并升人」指令只能落在树里
```

**必须一致拍的四组**：①{O2,O4}（CLI 落位）；②{O4,O5}（包结构与措辞连带）；③{O6,R13,P1-13}（perf 源码可执行性）；④{R7,O6}（超阈值指令必须有树，否则无处安放）。

# 5. 拍板后需改 PLAN 文本 / 验收 vs 只需记录决定

- **必须改 PLAN 工作项文本与验收**（改动进入 A/T 类判据）：
  - O2 → P0-5 子项 2 与 3 的文本（阶段 3 指向薄壳文件）、以及 marker 枚举；
  - O4 → D2 决策文本（落位 + import 形态 + CLI 不进包）、P0-5 子项 2 的文件名；
  - O5 → P1-1 内容（定位=顶层测试消费者）+ 新增「arch 真机外壳落位」子项 + A15 交接包清单措辞；
  - O6 → S5b 阶段文本（三档 + >50 停并升人）、STAGE-CHECKLIST 命令集（加一条判定命令）；
  - R3/R4 → P0-5 验收第 4 条、P0-6 的 STAGE-CHECKLIST 步骤、P1-5 钩子条款；
  - R6/R8 → P1-2/P1-3 验收文本（暂不判定的时序 + caliber.json）；
  - R9/R13 → P0-4/P1-13 验收文本（声明检索面 / 可执行副本落位）；
  - R11 → P1-12 内容（OWNER-GUIDE 结构 + schema 形态）。
- **只需记录决定**（进 DECISIONS.md 签署栏，不改工作项）：O1（推定口径）、O3（豁免令全文与撤销条件）、O7（默认 D 与触发条件）、R1（A17 追加一行）、R10（两档写法）、R12（逐条断言清单）。
- **不在本规划范围、需另行记档**：真机侧 `evidence/` 目录首次创建（V13 证实不存在）、`app/entry` 内新增自测入口（若 O5 采纳 ii 方案）。

# 6. 最容易被轻率拍错的 2–3 项

1. **O4（落包）**——最易错。它看起来只是「挪个文件」，但真正的后果是**包内首次出现 CLI/`process` 面**（V8 证明 tcs 拦不住、只有真机炸）与**ArkTS 禁则首次扫到 HPACK/HTTP2 手写实现**。拍「落包」而不写「CLI 留在 interop 薄壳」，等于把一颗真机首日的定时炸弹签了字。
2. **O6（性能阈值）**——最易错，因为它同时被两种相反的轻率夹击：拍死数字（诱发凑数，R10）或者干脆不拍（真机 agent 拿到空格，自由发挥，R1）。正确形态是**只拍形态不拍数字**，并把「>50 停并升人」的指令写进 STAGE-CHECKLIST/判定树而不是只写进 DECISIONS。
3. **R13（perf 豁免）**——最易错，因为它掩盖了一个更根本的问题：**`app/tools/perf/` 不在任何模块 srcPath 里（V7）**，里面的 ArkTS 源码不进 HAP。只谈「豁免要带理由」会把一个「跑不了」的问题当成「纪律问题」处理掉。

# 7. 证据不足项的保守默认（建议 GLM53 拍板人采用）

| 项 | 缺什么证据 | 保守默认 |
|---|---|---|
| O1 | 远端 Actions 真值（本机不可查，BASELINE §3.2） | 定性为「自 51b70c3 从未绿过（本地推定）」；P0-4 合入后建立绿基线；owner 一句话可推翻 |
| O4 | validate:arkts 未建 → h2c 落包是否触发 A13/A14（元组/下标）未验证 | 按「落包 + CLI 留薄壳 + barrel 不加导出」拍；把「(a) 面是否判红」列为 P0-3 落地后的显式复核项 |
| O5 | CU2（BigInt）未答；hypium 复用形态未答 | 拍「通过」，但把 KAT 真机覆盖面写成条件句（CU2=否则覆盖面缩至编码层）；真机外壳走「非 hypium 入口」优先 |
| O6 | 真机 perf 零数据；仓内无重键周期常量（V9） | 只拍记录制与三档形态；阈值留空并写死「>50 停并升人」 |
| O7 | 外部环境/授权事实 | 默认「暂不提供」，S0–S5b 不依赖它 |
| R11 | 三元组的真实填写负担未知 | 先按「evidence 可为文件路径 + 摘要」写，真机前桌面演练一次填一轮 |
| R13 | perf 源码在设备上的可执行形态未验证 | 默认要求「entry 内可执行副本」，仓内母本只作源码与评审面 |

# 8. 这批决策落文档后，PLAN §3 真机 agent 交接契约需同步改写的条款

| §3 条款 | 需改什么 |
|---|---|
| §3.1-1「仓库」清单 | 加 `packages/kat/`（O5）、`packages/control/src/h2c.ts`（O4）；并**明说 `app/tools/perf/` 是母本不是可执行体**（R13/O6） |
| §3.1-3「探针包」 | KAT 真机外壳改为「entry 内自测入口 + 接口约定」（若 O5 采纳 ii）；加「自测入口如何在 UI 上触发」的说明 |
| §3.2 S5b | 加三档判据与「>50 停并升人」指令；加随机字节快照步骤（R4：开缓冲 → 跑 → dump → `hdc file recv` → evidence/） |
| §3.2 S2/S6 | 若 O7 默认 D，S2 的「若 headscale 主机已备」保留；S6 失败处置树加一节「无 headscale 主机时的降级终点」 |
| §3.3 纪律面 | 明确「包内不出现 `process`/CLI」这条由 O4 引入的新纪律（否则 §3.3 只禁 socket，禁不住 process） |
| §3.3 升人触发六条 | **不改编号**；perf 超阈值改走 STAGE-CHECKLIST 显式指令（避免 tree-check 的 D10-①…⑥ 编号集被撑大，TESTS §4.2） |
| §3.4 回报格式 | 「命令与完整原始输出」增一条：涉及 evidence/ 的步骤须回报 `hdc file recv` 的目标路径与 sha256 |
| §3.4 失败复现包 D13 | 补「真机侧文件如何进入 evidence/」这一环（现文本只有 host 侧目录结构） |
| §3.4 证据目录 | 首次创建 `evidence/`（V13 证实不存在），并把 `.bin` 快照纳入 P0-7 的 check-ignore 双向断言 |

# 9. 可代拍性总判（提交拍板人参考）

- **物理上必须人类**：O1（登录远端看 Actions）、O7（外部环境事实与授权）、O3 的「LAN 可达性实测」、O6 的**阈值数字**（需真机数据）、S5/S6 的人类动作（签名、VPN 弹窗、preauthkey 签发）。
- **可代拍但需留追认位**：O2、O3（豁免令文本）、O4、O5、R1–R13 全部。其中 O4/O5 因触及 8 包冻结面与验收契约边缘，建议 DECISIONS.md 留「owner 追认」栏。
- **我不能确定、已写明缺什么的**：O4 的 ArkTS 禁则风险、O5 的 CU2 依赖、O6 的重键预算、R11 的填写负担、R13 的设备可执行形态。

---

*本轨迹只做推理留痕，不构成决定；每条倾向均标注置信度与前提，凡「不确定」处已写明缺哪条证据。全程未修改任何既有文件，未读任何 thinking-* 轨迹文件。*
