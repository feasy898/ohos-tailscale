交叉综合 · MiniMax M3.1 Flash · HEAD 90ed53e · 2026-10-03

# 0 元信息

| 项 | 值 |
|---|---|
| 审校人 | MiniMax M3.1 Flash（第二轮三位独立交叉审校之一；已通读三份盘点全文） |
| 被审对象 | `docs/baseline-audit/inventory-{glm53-flash,minimax-m31-flash,step-router-v1}.md` |
| 基准 | `git rev-parse HEAD` = `90ed53e20fb998cc6c0005ece9147a3855cd7785`（短 `90ed53e`），分支 main，工作区仅 `?? docs/baseline-audit/` |
| 环境 | win32 / Git Bash / node v22.23.2 / npm 10.9.8（`package.json:5` 有 `"type":"module"`） |
| 我亲自跑过的命令 | `npm run typecheck:bridge`；`npm run perf:baseline`；`npm run interop:regress`；`sed -n '69,87p' .github/workflows/g0-gates.yml \| bash`；修正引号后的等价 D4 grep；`node --test packages/netcheck/test/*.test.ts`（+ 逐文件）；`node --test app/bridge/test/*.test.ts`（逐文件）；`node interop/arkts-check.js .`；`node --experimental-strip-types interop/h2c.node.ts http://127.0.0.1:8080`；`git ls-files`×N；`gh --version`；`git ls-remote origin` |
| 我**没有**跑的 | 全量 `npm test`（任务明确免除）、`npm run typecheck`、`test:bridge`、`validate:shell`、`interop:test:upload` 的整体（只逐文件跑了 bridge 与 netcheck） |
| 纪律 | 未修改任何既有文件；本文件是本次唯一新增物。所有裁决只基于我本会话取得的输出；引用他方结论处均注明"他方" |

**判读口径**：**代码事实**（能跑命令/读文件确认）与**他方转述**严格分开。凡我未跑的一律标"未跑"。

---

# 1 三方一致结论（已逐条核对其取证方式是否真的到位）

| # | 一致结论 | 三方各自的取证 | 我的核对 |
|---|---|---|---|
| C1 | `npm test` 495 pass / 0 fail | GLM §2.2 TAP 摘要+逐包和；MiniMax §2.2 同+逐包和；Step §2.1 #2 | 采信（未重跑，任务免除）。三方口径一致，无人提出异议 |
| C2 | **`npm run typecheck:bridge` 红灯 exit 2，TS2353 @ `app/bridge/test/peerapi-tun.test.ts:246`** | 三方均贴同一行错误原文 | **我亲自跑，钉死**：`npm run typecheck:bridge` → `app/bridge/test/peerapi-tun.test.ts(246,5): error TS2353: … 'selfAddresses' does not exist in type 'DnsAnswerFn'.`，`TC_BRIDGE_EXIT=2`。根因三方可复核：`peerapi-tun.test.ts:81` `makePeerServer = (answerDns: MockPeerApiConfig['answerDns'])`（单参）、`:245` 传整份 config 字面量、`mock-peerapi.ts:60` `export type DnsAnswerFn = (name: string, qtype: number) => DnsResolveOutcome`；`git log --oneline -1 -S"selfAddresses" -- app/bridge/test/peerapi-tun.test.ts` → 引入者 `e136900` |
| C3 | CI 五门/六门**不含** `typecheck:bridge`，故该红灯无门禁拦截 | 三方均查 yml | 我通读 `.github/workflows/g0-gates.yml` 全文 128 行，step 列表为 checkout / setup-node / npm ci / G0-1 / setup-python / upload 实证 / G0-2 / G0-3 / G0-4 / G0-5 —— **确无 typecheck:bridge** |
| C4 | README 同页两套基线：现行 495/30/66（:35-40） vs 过期 280/13/54（:42-46） | 三方均 `sed` 读 README 并跑三门反驳旧数 | 我 `sed -n '35,46p' README.md` 原文核对：上表 `495 / exit 0 / 30 / 66 / 0 命中 / 3.62 ms-op`，下表 `280 / exit 0 / 13 / 54 / 全部 0 命中`。行号为 GLM 口径（35-40 与 42-46）最准 |
| C5 | README:10 "约 8400 行" 过期 | GLM、MiniMax 提；Step 未提 | 采信 GLM/MiniMax 的一致实测（16904）；我自己用 `git ls-files` 逐包 `wc -l` 复核得 src 合计 **16904**，行数口径成立 |
| C6 | README:12 "validate:shell 54 用例" 与同文件 :38 的 66 自相矛盾 | GLM、MiniMax 提 | 采信（我未重跑 validate:shell，但两处文本矛盾本身不需跑） |
| C7 | README:54 "二期未做项"六项已被 `1c9b85b` 实现，仅 TUN 壳层 fd 接线未做 | 三方一致（Step 标 B，GLM/MiniMax 标 A） | 争议仅在"证据等级"不在"事实"，见 §2 争议 9 |
| C8 | 09-29 INTEROP PASS / DERP INTEROP PASS 仓内无原始证据文件 | GLM（`evidence/` 不存在 + `git log --all -- docs/oracle/raw` 空）；MiniMax（`git ls-files` 无产物）；Step（`git ls-files \| grep -i evidence` 空） | **我复跑两条**：`git ls-files \| grep -ci evidence` = **0**，`ls evidence` = *No such file or directory*，`git log --all --oneline -- docs/oracle/raw \| wc -l` = **0**。而 `docs/oracle/` 下仅 1 个文件 `protocol-notes.md`（258 行），其文件头自称对应"`raw/` 下转储文件"——转储确不存在。**三方一致成立** |
| C9 | `app/` 壳从未编译 | 三方负面证据（无 .hap/.har/build/oh_modules/.hvigor；VpnExtensionAbility 桩） | 采信三方一致的负面证据；我未重跑（成本高、结论不争议） |
| C10 | `upload_server.py` 路径穿越防御实证 单元 8 + 集成 7 全过（G0-6） | 三方均贴同一段输出 | 采信三方一致（我未重跑） |
| C11 | CI 远端 Actions 真实运行史**不可查** | GLM 明说"无 gh CLI" | 我复核：`gh --version` → `command not found`；`git ls-remote origin` → `Permission denied (publickey)`。**确无网络与 gh**，任何"CI 现在是红是绿"的说法在本地不可证 |

---

# 2 分歧与裁决

## 争议 1：`interop:regress` 失败归因（清单指定）

| 方 | 说法 |
|---|---|
| GLM | 纯环境缺失（ECONNREFUSED 127.0.0.1:8080，非产品缺陷） |
| MiniMax | 环境缺失 **+** `regress.mjs:59-61` 给两参的 `derp.node.ts` 只传 1 参，有 headscale 也必失败（另：`:57` 假 preauthkey） |
| Step | 环境缺失 **+** stage2 缺 authKey 传参 |

**我的复验过程**

1. 读 `interop/regress.mjs` 全文 75 行，三处调用点：`:51-53` register 传 `['interop/register.node.ts', HS, 'regress-dummy-preauthkey']`；`:54-56` derp 传 `['interop/derp.node.ts', HS]`（**仅 1 个实参**）；`:57-59` h2c 传 `['interop/h2c.node.ts', HS]`。默认 `HS` 在 `:28`。
2. 读被调函数签名 `interop/derp.node.ts:37-40`：
   ```ts
   const [, , baseUrlArg, authKeyArg] = process.argv;
   if (baseUrlArg === undefined || authKeyArg === undefined) {
     fail('usage: node --experimental-strip-types interop/derp.node.ts <baseUrl> <authKey>');
   }
   ```
   → `authKeyArg === undefined` 恒成立即 `fail()`。**与 headscale 是否在跑无关。**
3. 我自己跑 `npm run interop:regress`，原样输出与三方一致（`INTEROP FAIL` / `DERP INTEROP FAIL`，`REGRESS_EXIT=1`），并注意到 **stage3 那行 `>>> 阶段：HTTP/2 over Noise（h2c）` 之后完全没有输出**。
4. 追查 stage3：`grep -n` `interop/h2c.node.ts` 只有 `:16` 一个 import 和 `:29 export class H2OverNoise`，**没有任何 `process.argv`、没有 CLI 入口、没有顶层调用**。我实跑 `node --experimental-strip-types interop/h2c.node.ts http://127.0.0.1:8080` → 退出码 0、**`STDOUT_LEN=0`**。而 `regress.mjs:42` 的判定是 `r.status === 0 && !sawUsage && stdout.length > 0` → 静默判负。

**裁决：MiniMax 的结论正确、GLM 的结论错误；三方都不完整。**

- GLM 判"纯环境缺失"**不成立**——阶段 2、3 在结构上不可能通过，补齐环境也不会变。
- MiniMax 判"阶段 2 传参不足"**成立**，但**行号全错**：实为 `regress.mjs:54-56`（非 59-61）；假 preauthkey 实为 `regress.mjs:52`（非 :57）；默认 HS 实为 `:28`（他方或写 :27 或写 :30）。
- Step 的"stage2 缺 authKey 传参"与 MiniMax 同义，成立。
- **我补出的、三方都没有的第三处硬伤**：`h2c.node.ts` 无 CLI 入口，stage3 恒为 `stdout.length === 0` → 恒 false。MiniMax 把 stage3 标为"未独立取证（B）"，我把它升级为已实证。
- 合并结论：`npm run interop:regress` **在任何环境下都不可能输出 `INTEROP PASS`**，三阶段各自有独立硬伤（stage1 假 key、stage2 少传参、stage3 无入口）。历史 PASS 只能由 `register.node.ts:264` / `derp.node.ts:361` 单独跑取得（我已 grep 到这两个 PASS 串），与 `docs/research/2026-10-02-D-interop-plan.md:104` 写的判定口径一致。注意 `regress.mjs` 是 `5c3db5e` 才入仓的，而 D-interop-plan（10-02）早于它——计划假设这个脚本能跑，脚本实现时带了 bug。

## 争议 2：CI G0-5 的 D4 检查（清单指定）

| 方 | 说法 |
|---|---|
| GLM | yml 里该 step 的 bash 脚本自身语法错误（exit 2），D4 从未真正跑过；修引号后等价 grep 0 命中 |
| MiniMax | "复跑 CI 原样 grep"，三门各 0 命中 |
| Step | "D4/P4 grep（网络/builtin 特征）`__NO_MATCH__`" |

**我的复验过程**

1. **原样喂 bash**：`sed -n '69,87p' .github/workflows/g0-gates.yml | bash`，输出：
   ```
   --- P4: Date.now / Math.random（非注释行）---
   --- P4/D4: 非测试源码 node: 导入 ---
   --- D4: 网络/builtin 特征（仅 src） ---
   bash: line 15: syntax error near unexpected token `(' while looking for matching `)'
   G0_5_VERBATIM_EXIT=2
   ```
   **语法错误可复现，与 GLM 逐字一致。**
2. **根因**（`g0-gates.yml:83`）：`NET=$(grep -rEn 'fetch\(|…|from ['\"](net|…|crypto)['\"]' \` —— 单引号串里嵌了 `['\"]`，那个内层 `'` 提前闭合了外层引号，其后 `\"` 变裸 `"`、`(` 被当成命令替换起始 → 语法错。
3. **历史**：`git log -L 82,86:.github/workflows/g0-gates.yml` 显示该行在 `51b70c3`（工作流初版）就带着这个坏引号，`5c3db5e` 只把过滤器从 `\.test\.ts$` 改成 `\.test\.ts:`，**没碰引号**。即 D4 从工作流诞生起就没执行过。
4. **P4/node: 两段确实有效且真的 0 命中**（我的原样跑在第 15 行才死，前两段都过了）。我另取原始命中数核对过滤器是否名副其实：`Date\.now|Math\.random` 原始 **4 条**，全在注释（`packages/common/src/clock.ts:2`、`clock.ts:5`、`random.ts:2`、`packages/derp/src/region.ts:16`）；`from ['\"]node:` 原始 **103 条**，其中落在 `.test.ts:` 的 **103 条**（100%）。
5. **修正引号后的等价 D4 我自己跑**：`NET=$(grep -rEn "fetch\(|XMLHttpRequest|WebSocket|from ['\"](net|dgram|…|crypto)['\"]" …)` → `D4: 0 hits`。

**裁决：GLM 对，MiniMax 与 Step 错在"方法"而非"结论"。**

- 迷你两家贴的输出（`P4 after filters: (empty)`、`__NO_MATCH__`）**不是 yml 原文里的字符串**——yml 里对应位置是 `echo "P4 命中：$P4"; exit 1`。可见两家跑的是自己重写/改写的等价 grep，而不是 CI 脚本本体。这不能证伪 CI 脚本。
- 结论应拆成两句写进总文：**（a）代码面 D4/P4 纪律成立**（修正引号后 D4 0 命中，原始 4 条 P4 与 103 条 node: 全被有效滤除——我已验证滤除是真的有效，不是碰巧空）；**（b）CI 里 D4 这一节从未执行过**，G0-5 step 在 GitHub 上会以 exit 2 失败。
- **我不能证的**：GitHub Actions 远端现在到底红不红。`gh` 不存在、`git ls-remote origin` 被 publickey 拒绝 → 远端运行史本地不可查，这一点三份报告都标注了，我复核属实。

## 争议 3：perf x25519 数字（清单指定）

| 方 | 数字（mean ms/op） |
|---|---|
| GLM | 4.0098 / 4.0978（两次） |
| MiniMax | 3.5723 |
| Step | 3.8325 |
| **我** | **3.6617**（`p50=3.5034 p95=4.8305 p99=5.3458 ops/s=273.1`，`PERF_EXIT=0`） |

**裁决：五样本区间 3.57–4.10 ms/op，同一数量级，无矛盾。** 呈现建议：基线总文写 **"x25519 200 iter/20 warmup，同机同测法实测区间 3.6–4.1 ms/op（约 250–280 ops/s）"**，并注明：① 波动来自共享 Windows 机器负载，p95/p99 抖动到 4.8/5.3 ms；② README 记的 3.62 落在区间内，**不构成文档漂移**，不应被写进"文档矛盾"清单；③ 09-29 的 5.25 ms/op 是同测法纵向比较（快 30%），跨机不可比；④ 该数字是 win32+Node22 的 BigInt 标量乘，**与真机 ArkTS 运行时性能无关**。

## 清单之外，我另找出的分歧

| # | 分歧 | 各方说法 | 我的复验 | 裁决 |
|---|---|---|---|---|
| 4 | `packages/` src 文件数 | GLM 72、MiniMax 72、**Step 63**（其逐包为 crypto 6/noise 6/wireguard 8/derp 5/control 15/disco 4） | `git ls-files` 逐包 `grep -c '\.ts$'`：common 9、crypto 8、noise 7、wireguard 10、derp 6、disco 5、control 17、netcheck 10 = **72**；`git ls-files packages \| grep '\.ts$' \| wc -l` = 121 = 72+49 | **72 正确，Step 的 63 错**（Step 大概漏数了 `index.ts`/barrel 之类）。Step 唯一对的是总文件数 121 |
| 5 | `packages/` test 行数 | GLM **13170**、MiniMax 11570、Step ~13268 | 我逐包 `wc -l` 相加：524+1001+1881+2074+1302+797+3697+1894 = **13170** | **13170 正确**。MiniMax 是数字转置笔误（11570 ↔ 13170）；Step 的 13268 无来源 |
| 6 | netcheck 用例数 | GLM §3.1 表与 §7.7 均写 **64**（把 `history.test.ts` 记成 3 例）；MiniMax 写 84 | `node --test packages/netcheck/test/*.test.ts` → `# tests 84 / # pass 84 / # fail 0`；逐文件 engine 34、**history 23**、plan 19、stun 8 | **84 正确，GLM 的表错**。连带后果：GLM §3.1 逐包用例相加 = 40+35+39+60+58+38+141+**64** = **475**，与其自称"逐包之和恰为 495"自相矛盾（其 §2.2 实跑记录本身写的是 84，是转表时抄错） |
| 7 | `interop/arkts-check.js` 能否运行 | Step 表格"本机可跑？**是**（需 ohos-sdk）"；MiniMax"实测 exit 1：ESM/CJS 冲突" | 我跑 `node interop/arkts-check.js .` → `ReferenceError: require is not defined in ES module scope … 'package.json' contains "type": "module"`，`ARKTS_EXIT=1`（`package.json:5` 有 `"type":"module"`，而该文件用 `require`） | **MiniMax 对，Step 错**。它连模块都加载不进来，谈不上"需 SDK"。连带：Step 说"本次未跑"，却给了"可跑"的结论 |
| 8 | CONTEXT.md:15 "bridge 29" 是否算矛盾 | Step §4 行 13 与 MiniMax §4.3③ 判为 D（过期）；GLM §3.6 只把它列进"关键声明清单"，**未判真假** | 我读 `CONTEXT.md:15` 原文："test:bridge **29 pass / 0 fail**"；`worklog.md:36`（10-02 收口）也写 29 → 说明当时属实，是 `5c3db5e`（peerapi-tun 负例拆分）后才变 30。**我逐文件跑 bridge：bridge 7 + disco-netcheck 6 + localapi 8 + peerapi-tun 9 = 30** | 真相 30，**Step/MiniMax 判 D 正确**；GLM 未表态不算冲突，属覆盖不全。此项为"10-02 属实 → 现已过期"的时间性漂移，应写进总文的"已知陈旧"而不是"文档说谎" |
| 9 | `1c9b85b` 二期实现的证据等级 | Step 标 **B**（"代码存在，部分测试通过"）；GLM、MiniMax 标 **A** | 我跑了 netcheck（84/84）与 bridge 逐文件（7/6/8/9），全绿 | 争议是"标签"不是"事实"。按"代码+测试且本次亲跑全绿"的口径，**A 成立**（我补跑了两个包）；但 TUN 壳层 fd 接线未做（`VpnExtensionAbility.ets` 桩）三方一致，总文必须保留这个限定 |

---

# 3 盲区与补救（三份都只转抄没实证，或干脆没提）

| # | 盲区 | 为什么是盲区 | 我的补验（已跑的写清楚） | 结论 |
|---|---|---|---|---|
| B1 | **`HARMONY_AGENT_TASK.md:13` 的克隆地址不可用** | 三份盘点**全文无一提及此文件**（我 grep 过三份报告的目录列表与正文，均无 `HARMONY_AGENT_TASK`） | `git remote -v` → `origin git@github.com:feasy898/ohos-tailscale.git`；`HARMONY_AGENT_TASK.md:13` → `git clone git://203.0.113.10:9418/ohos-tailscale.git`。`203.0.113.10` 是 TEST-NET-3 文档保留段，**不可路由** | **新发现的真实缺陷**：脱敏把唯一一份"自包含、可独立执行"的鸿蒙 agent 任务书的克隆指令改成了死地址。`PUBLIC-SCRUB-NOTE.md:14` 自己列了替换表（`203.0.113.10`=内部出口网关公网 IP → TEST-NET-3），`:20` 只对 `:8090/upload` 那行做了"示例命令"免责，**没覆盖 `:13` 的 clone 与 `:68` 的 push URL** |
| B2 | `HARMONY_AGENT_TASK.md` 的规模口径过期 | 无报告提及 | 同文件 `:9` "**六包**…Node 侧测试全绿 **238/238**"、`:49` "期望 238/238"、`:82` "六包契约"、`:88` "不要动 `packages/` **六包**源码" | 真相 8 包 495。此项**顺带回答了 MiniMax §4.3⑦ 的悬案**（"CONTEXT 的『6 包』是否已改"）：`CONTEXT.md:6` 已改成"八个"，**但 `HARMONY_AGENT_TASK.md` 的四处"六包/238"没人改** |
| B3 | `CONTEXT.md` 整段是"未 git 化"世界观 | 三方都只引 `CONTEXT.md:15` 的 29/30，无人读全文 | `CONTEXT.md:8` "**未纳入 git 管理**（.gitignore 已为 git 化预留），**无 CI**"；实况：`git log --oneline \| wc -l` = 22 个提交，且 `.github/workflows/g0-gates.yml` 存在 | 漂移级别高于数字漂移——验收人若照 `CONTEXT.md` 的"目标"节理解项目，会以为连 CI 都没有。**总文必收** |
| B4 | `docs-consistency` job 的 awk 取值恒空 | 三方都点评了这个 job"只防漏写不防错写"（MiniMax 最细），但没人跑过它的取值逻辑 | `echo "# fail 0" \| awk '{print $3}'` → `0`；`{print $7}'` → **空**。对照 `g0-gates.yml:104-113`：`T_FAIL`/`B_FAIL` 恒为空串。且 `:121-126` 的断言只用 `grep -q "$T_TOTAL"` | 该 job **从不校验 fail==0**，也从不校验 `validate:shell` 的数（`S_PASS`/`S_FAIL` 算了但没用）。它实质只做一件事：四个文档里有没有出现字符串 "495" |
| B5 | P4 过滤器有一条恒失效的分支 | 无人检查 | `g0-gates.yml:72` 的 `grep -v '^\s*//'`：由于 `grep -rEn` 输出行以**路径**开头（`packages/...:2: * 注释`），`^\s*//` 永远匹配不到 | 那 4 条 P4 原始命中是被**第三条**过滤器 `grep -v ' \* '` 滤掉的。当前无害（4 条确实都是块注释），但这是一条死代码式的脆弱点，改代码时容易误判 |
| B6 | `DELIVERY_REPORT.md:60` "control 6 文件 / 1066 行" | 仅 MiniMax 指出 | `sed -n '60p' DELIVERY_REPORT.md` → "### 1.6 `packages/control` — 控制面客户端（6 文件 / 1066 行）"；实测 control = 17 文件 / 7303 行 | 采信 MiniMax（我已复核原文行） |
| B7 | `docs/upstream/`（27 文件）、`docs/research/`（8 文件）的内容覆盖 | MiniMax 只把 upstream 记为"B 未做代码级 diff"；GLM、Step 基本没提 | 抽样：`docs/upstream/2026-10-01-phase2/` 含 `disco.go`、`key-disco.go`、`stun.go`、`wg-device-cookie.go`、`wg-device-constants.go`、`rfc5769.txt`、`draft-irtf-cfrg-xchacha-03.txt` | 这些正是"测试名声称对齐上游行号"的锚点源文件。三份都**没有一份**核对过"仓内快照 vs 真上游"是否一致，也没有任何测试真的去读 `docs/upstream/`。**这是我补不了的关键盲区**（需要网络拉上游对拍） |
| B8 | `e136900` 对 `arkts-check.js` 的修复零验证 | 仅 MiniMax 指出 | 我复跑确认 `ARKTS_EXIT=1`（ESM/CJS） | 采信：这是两次安全修复中唯一**本机无法执行**的一处，等于零实证。Step 把它记成"可跑（需 SDK）"会误导 |
| B9 | `docs/oracle/protocol-notes.md` 声称的 `raw/` 转储 | GLM 指出 `docs/oracle/raw/` 不存在 | `docs/oracle/` 仅 1 个文件（`protocol-notes.md`，258 行），其 `:5` 自述"对应 `raw/` 下转储文件"；`git log --all --oneline -- docs/oracle/raw \| wc -l` = 0 | 采信 GLM：协议笔记的【实测】标注全部失去了原始转储背书，只能当二手散文 |

**我补不了的**：① GitHub Actions 远端运行史（无 `gh`、无网络）；② headscale 三阶段真实复跑（无二进制/无凭据）；③ ArkTS linter 复跑（无 WSL+SDK）；④ `docs/upstream/` 快照与真上游的一致性（需联网）；⑤ 任何真机/DevEco 事实。

---

# 4 给最终基线总文的必收要点（按重要性排序）

| # | 要点 | 验证等级 |
|---|---|---|
| 1 | **`npm run typecheck:bridge` 是红的（exit 2，TS2353 @ `app/bridge/test/peerapi-tun.test.ts:246`），且 CI 六门全不含它** —— 门禁体系目前唯一的真实红灯 | **三方实证**（我亦亲跑，`TC_BRIDGE_EXIT=2`） |
| 2 | 根因是 `peerapi-tun.test.ts:81` 单参 helper 被 `:245` 当双参用，引入者 `e136900`；运行时 30/30 仍绿是因为畸形 q 在 400 校验层就被拒，早于 `answerDns` 调用 | **三方实证**（我复核了 `:81`/`:245`/`mock-peerapi.ts:60` 三处原文） |
| 3 | **`npm run interop:regress` 在任何环境下都不可能输出 `INTEROP PASS`**：stage1 假 key(`regress.mjs:52`)、stage2 少传参(`:54-56` vs `derp.node.ts:37-40`)、stage3 `h2c.node.ts` 无 CLI 入口（实跑 exit 0 且 stdout 长度 0，被 `regress.mjs:42` 静默判负） | **单方实证**（我；MiniMax 覆盖了 stage2，stage1/stage3 为我新增） |
| 4 | **CI G0-5 的 D4 段自工作流初版 `51b70c3` 起就是 bash 语法错误**（`g0-gates.yml:83` 单引号内嵌 `'`），`5c3db5e` 只修了过滤器没修引号；原样喂 bash 必得 `syntax error near unexpected token '('` + exit 2 | **单方实证**（我；`git log -L` 佐证历史） |
| 5 | 但**代码面 D4/P4 纪律是真的**：P4 原始命中恰 4 条且全在注释、node: 原始 103 条且 103 条全在 `.test.ts`、修正引号后的等价 D4 0 命中。表述必须是"门禁脚本坏 + 代码干净"两句，不可只说一半 | **双方实证**（MiniMax 的原始计数 + 我的原样复跑与修正 grep） |
| 6 | 09-29 INTEROP PASS / DERP INTEROP PASS **仓内查无原始证据**（`git ls-files \| grep -ci evidence`=0；`evidence/` 目录不存在；`docs/oracle/raw/` 从未入 git 历史） | **三方实证**（我亦跑了两条 git 命令） |
| 7 | 真实规模：`packages/` 8 包 = src **72 文件 / 16904 行** + test **49 文件 / 13170 行 / 495 用例**；`git ls-files packages \| grep '\.ts$' \| wc -l` = 121。README:10"约 8400 行"低估一半 | **双方实证**（GLM/MiniMax 一致，我用 git ls-files 逐包复核；Step 的 63/13268 不采信） |
| 8 | README 同页两表并列（`:35-40` 现行 495/30/66 vs `:42-46` 过期 280/13/54），表头同为 G0-1…G0-5，读者无从分辨；README:12 "54 用例" 与同文件 :38 的 66 自相矛盾 | **三方实证** |
| 9 | `docs-consistency` job **实质只检查"四个文档里有没有出现字符串 495"**：`T_FAIL`/`B_FAIL` 因 `awk '{print $7}'` 对 `# fail 0` 恒取空串而失效，`S_PASS`/`S_FAIL` 算了但从不参与断言；且只 `grep -q` 是否"含"，不查"是否还残留旧数"，warning 不阻断 | **单方实证**（我） |
| 10 | `app/` 壳从未编译：`VpnExtensionAbility.ets` 三个数组（addresses/routes/dnsAddresses）全空并自带 `TODO(核心库对接)`；全仓无 `.hap/.har/build/oh_modules/.hvigor`。即便编译通过 `VpnConnection.create()` 也会失败 | **三方实证** |
| 11 | README:54"二期未做项"六项（disco 0x04-0x09、netcheck 调度、DERP 随机选点、netmap→WG、状态机、LocalAPI/PeerAPI/MagicDNS）已被 `1c9b85b` 实现且有测试；**唯一属实的"未做"是 TUN fd 接线** | **三方实证** |
| 12 | disco 0x04–0x09 只到"编解码 + bind 握手状态机"，全仓无 UDP relay 数据面消费者；`control` 包不 import `disco`。写"已实现"时必须带这个限定 | **双方实证**（GLM、MiniMax） |
| 13 | `interop/arkts-check.js` **本机无法执行**（`package.json:5` `"type":"module"` 与文件内 `require` 冲突 → exit 1），故 `e136900` 对它的路径穿越修复**零实证** | **单方实证**（我复跑 exit 1；MiniMax 首报，Step 误记为"可跑"） |
| 14 | perf x25519：同机同测法实测区间 **3.6–4.1 ms/op（约 250–280 ops/s）**，200 iter/20 warmup。README 的 3.62 落在区间内，**不算文档漂移**；09-29 的 5.25 是纵向对比。必须在 win32+Node22 条件下读，真机 ArkTS 性能无任何数据 | **双方实证**（五样本含我本次 3.6617） |
| 15 | `CONTEXT.md:15` "test:bridge 29 pass" 已过期（真相 30；`worklog.md:36` 证明 10-02 时 29 属实，是 `5c3db5e` 之后漂移）；`CONTEXT.md:8` 仍写"未纳入 git 管理、**无 CI**"，整节世界观过期 | **单方实证**（我读原文 + 逐文件跑 bridge 7/6/8/9=30） |
| 16 | **`HARMONY_AGENT_TASK.md:13` 的 `git clone git://203.0.113.10:9418/…` 是死地址**（TEST-NET-3 不可路由；真实 remote 为 `git@github.com:feasy898/ohos-tailscale.git`），`:68` push URL 同病；脱敏时只对 `:8090/upload` 做了免责。同一文件 `:9/:49/:82/:88` 仍写"六包/238/238" | **单方实证**（我；**三份盘点全部未提及此文件**） |
| 17 | `DELIVERY_REPORT.md:60` "control 6 文件 / 1066 行" 过期（实测 17 / 7303）；`:151/:78` 引用的 `docs/oracle/raw/` 17 份转储从未入 git | **单方实证**（我复核原文行） |
| 18 | `docs/oracle/protocol-notes.md`（258 行）的【实测】标注全部依赖不存在的 `raw/` 转储，只能当二手散文读 | **双方实证**（GLM 首报，我复核文件存在性与 git 历史） |
| 19 | 明确列出"**三份都只转抄、无人实证**"的一类：`docs/upstream/` 27 份上游快照（disco.go / stun.go / wg-device-*.go / rfc5769.txt / xchacha draft）与"测试对齐上游行号"这一核心方法论**从未被对拍验证**——测试里写的行号与仓内快照、与真上游三者是否一致，无人检查 | **未实证**（我抽样确认文件在仓，但无法联网对拍真上游） |
| 20 | GitHub Actions 远端真实运行史**不可查**（`gh: command not found`；`git ls-remote origin` → `Permission denied (publickey)`）。因此"G0-5 在远端会变红"只能表述为**基于同 bash 语义的本地推定**，不得写成既成事实 | **未实证**（我复核了不可用性） |

---

*本综合报告的全部裁决只使用我本会话亲自运行的命令输出与亲自读取的文件行；引用他方结论处均标注为"他方"。我未运行的检查（`npm test` 全量、`typecheck`、`validate:shell`、`interop:test:upload`、headscale 复跑、ArkTS linter、Actions 远端）一律在文中标为未跑/未实证。盘点期间未修改仓库任何既有文件。*
