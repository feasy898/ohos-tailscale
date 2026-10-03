# 交叉综合 · Step Router V1 · HEAD 90ed53e · 2026-10-03

## 0. 元信息

- **审校员**：Step Router V1（第二轮三位独立交叉审校员之一；三份盘点互不通气，独立完成）
- **仓库**：`D:\new-workspace\ohos-tailscale` @ git `90ed53e20fb998cc6c0005ece9147a3855cd7785`
- **提交时间**：2026-10-03 11:46:57 +0800，`chore: gitignore 补 Python __pycache__…`
- **环境**：win32 / Git Bash / Node v22.23.2 / npm 10.9.8 / Python 可用（`interop:test:upload` 驱动）
- **方法**：逐条重读三份报告原文；对所有已知分歧点亲自重跑命令 / 重读文件 / 重查 git；对盲区补验 grep/find/ls。无法复验的标注清楚。
- **本轮新增实证记录**（全部在本次会话中亲自执行）：
  - `npm run typecheck:bridge` → EXIT=2，TS2353 @ `app/bridge/test/peerapi-tun.test.ts(246,5)` 复现
  - `npm run perf:baseline` → `{"mean_ms":3.9816,"ops_per_sec":251.16}`，第 4 独立样本
  - `sed -n '66,87p' .github/workflows/g0-gates.yml | bash` → `bash: line 18: syntax error near unexpected token '('`（D4 NET= 行，YAML:83）
  - 写 `tmp-g05-check.sh`（with 正确 bash 引号 `'from ['"'"'"](net|...)['"'"'"]'`）跑等价 D4/P4/NOD 三组 grep → 全部 0 命中、exit 0
  - `git ls-files docs/oracle/raw` → 空；`ls docs/oracle/` → 仅 `protocol-notes.md`（20KB），无 `raw/` 子目录
  - `grep -n 'test:bridge.*29\|bridge.*29' CONTEXT.md worklog.md README.md` → CONTEXT.md:15、worklog.md:31、worklog.md:36 三处命中
  - `npm run interop:regress` → EXIT=1，stage2 usage 错误 + stage1 ECONNREFUSED 127.0.0.1:8080，证实 regress.mjs 三重缺陷
  - `head -50 HARMONY_AGENT_TASK.md` → 确认文件口径停在 10-01 早期（"六包 / 238/238"）
  - 本轮工作经 advisor 模块两次校验（开始前 + 完成后）

## 1. 三方一致结论（12 条）

1. **`npm test` 495 pass / 0 fail / exit 0** — 三份报告 §2.2 均记录 TAP 摘要行 `1..495 / # pass 495 / # fail 0`；逐包复跑 40+35+39+60+58+38+141+84=495 精确对齐。这是本仓最硬的一条基线。
2. **`npm run typecheck` exit 0** — 三份 §2.3 一致；根 `tsconfig.json` 覆盖 `packages/**`，tsc 零错误。不含 `app/bridge`。
3. **`npm run test:bridge` 30 pass / 0 fail / exit 0**（运行时） — 三份 §2.5 一致；GLM 报告逐文件 7+6+8+9=30，与全量 TAP 吻合。
4. **`npm run validate:shell` 66 passed / 0 failed** — 三份 §2.6 一致；V1–V9 九组静态机检全过，V9 是 commit `1c9b85b` 新增的 12 条 bridge 纪律检查。
5. **`npm run typecheck:bridge` 红灯**：`app/bridge/test/peerapi-tun.test.ts(246,5)` TS2353 — `selfAddresses` 不存在于类型 `DnsAnswerFn`。三份 §2.4 均记录 exit 2；本次复跑确认。由 commit `e136900` 引入，CI 五门不含此命令。
6. **`npm run interop:test:upload` PASS**：单元 8/8 + 集成 7/7 — 三份 §2.7 一致；Python 视角 inbox 仅 `["x.bmp"]`；G0-6 已入 CI，是 fcaf962 修复的闭环实证。
7. **`app/` 壳从未编译** — 三份 §3.2 一致；负面证据链完整：全仓 `find` 零构建产物（无 `.hap/.har/.build/oh_modules/.hvigor`），`VpnExtensionAbility.ets:41-43` 三数组全空并自注"真实调用会失败——桩仅示意流程"，根 tsconfig `exclude: ["app"]`。
8. **README 双表格并存**：上方 495/30/66（现行真相）vs 下方 280/13/54（过期残留） — 三份 §1.2/1.3/1.4 均指出；worklog.md:21,23,36 佐证 280 为 10-01 夜班旧基线（dispatch 后）。
9. **commit `1c9b85b` 二期功能已真实落地并附测试（+215 用例）** — 三份 §1.6/1.8/1.9 均引用 `git show --stat` 确认新增文件与测试；功能测试在本 HEAD 全绿。
10. **09-29 INTEROP PASS 无仓内原始证据** — 三份 §1.5/1.6/1.7 一致；`docs/oracle/raw/` 从未入 git 历史；`evidence/` 目录不存在；仅 DELIVERY_REPORT/README/TASK Markdown 散文转引。
11. **D4/P4 代码面干净（0 命中）** — 三份 §2.8 一致；GLM 与 MiniMax 分别独立复跑 grep；本次第 4 次以正确引语验证确认三门 0 命中（注意：见分歧 2，YAML 原样脚本有语法错误，但正确引语的等价过滤器确为 0）。
12. **perf x25519 同数量级，较 09-29 基线快约 20–32%** — 三份 §2.9 均记录 3.5–4.1 ms/op；README 现行 3.62 ms/op（commit 0962ada）；本次第 4 样本 3.9816 ms/op。

## 2. 分歧与裁决

### 2.1 interop:regress 失败归因

| 维度 | GLM Flash | MiniMax M3.1 Flash | Step Router V1 |
|---|---|---|---|
| **归因** | 纯环境缺失（ECONNREFUSED 127.0.0.1:8080），非产品缺陷 | 环境缺失 + `regress.mjs:59-61` 给两参的 `derp.node.ts` 只传 1 参，有 headscale 也必失败 | 环境缺失 + stage2 缺 authKey 传参 |

**我的复验过程**：
- 读 `interop/regress.mjs:51-59`：stage1 传 `['interop/register.node.ts', HS, 'regress-dummy-preauthkey']`（3 元素），stage2 传 `['interop/derp.node.ts', HS]`（2 元素），stage3 传 `['interop/h2c.node.ts', HS]`（2 元素）
- 读 `interop/derp.node.ts:37-39`：`const [, , baseUrlArg, authKeyArg] = process.argv; if (baseUrlArg === undefined || authKeyArg === undefined) fail('usage:...')` — 必需要 2 参
- 读 `interop/register.node.ts:43-44`：同上，`baseUrlArg` 与 `authKeyArg` 均必填
- 读 `interop/h2c.node.ts:1-30`：仅 `export class H2OverNoise`，无 `main()`、无 `process.argv` 读取；spawnSync 会得 exit 0 + stdout 空字符串
- 读 `interop/regress.mjs:31-43`：`runStage` 判定条件为 `r.status === 0 && !sawUsage && stdout.length > 0`；h2c.node.ts 的 stdout 恒空 → stage3 恒 silently false

**裁决**：**MiniMax 正确且最完整；Step Router 部分正确但遗漏 dummy preauthkey 与 stage3；GLM 错判**。

脚本有三重独立缺陷，任何 headscale 环境下都不可能输出 PASS：
1. **stage1 硬编码假 preauthkey** `regress-dummy-preauthkey`（regress.mjs:52） — 真 headscale 会 401 拒绝（register.node.ts:216 `fail('machine not authorized')`）
2. **stage2 缺 authKey 参数**（regress.mjs:55） — 只传 HS 1 参，derp.node.ts:38 要求 `<baseUrl> <authKey>` 两参 → 必 usage 退出
3. **stage3 h2c.node.ts 非可执行脚本** — 纯模块，stdout 恒空，runStage（regress.mjs:42）要求 `stdout.length > 0` → 恒 silently false

因此，"有 headscale 也必失败"是 MiniMax 的原话，实测证实。

### 2.2 CI G0-5 D4 检查是否真正执行

| 维度 | GLM Flash | MiniMax M3.1 Flash | Step Router V1 |
|---|---|---|---|
| **归因** | YAML 该 step 的 bash 脚本自身语法错误（exit 2），D4 从未真正跑过；修引号后等价 grep 0 命中 — 代码面干净、门禁脚本坏 | D4/P4 三门各 0 命中（声称原样复跑成功） | D4/P4 grep 三组全 0 命中（未提语法错误） |

**我的复验过程**：
- `sed -n '66,87p' .github/workflows/g0-gates.yml | bash` 完整输出：
  ```
  --- P4: Date.now / Math.random（非注释行）---
  --- P4/D4: 非测试源码 node: 导入 ---
  --- D4: 网络/builtin 特征（仅 src） ---
  bash: line 18: syntax error near unexpected token '(' while looking for matching ')'
  bash: line 18: `          NET=$(grep -rEn 'fetch\(|XMLHttpRequest|WebSocket|from ['\"](net|dgram|http|https|tls|dns|fs|path|os|child_process|crypto)['\"]' \`
  ```
- 根因：YAML:83 的 D4 grep 行 `'from ['\"](net|...)['\"]'` 在 bash 单引号语义下，`'`（`from [` 之后）提前闭合了单引号字符串，导致 `\"](net|...)['\"]'` 成为无引号文本，其中的 `(` 被 bash 视为子shell起点，`|` 在子shell内非法 → syntax error。
- 写 `tmp-g05-check.sh`，将 D4 模式改写为 bash 可解析的正确引语：`'from ['"'"'"](net|dgram|http|https|tls|dns|fs|path|os|child_process|crypto)['"'"'"]'`（四个引语段交替：`'from ['` + `"` + `](net|...)['` + `"` + `']'`）
- 运行 `bash tmp-g05-check.sh`：
  ```
  --- P4: Date.now / Math.random (non-comment lines) ---
  P4 hits: 0
  --- P4/D4: non-test node: imports ---
  NOD hits: 0
  --- D4: network/builtin features ---
  NET hits: 0
  D4/P4 全 0 命中
  ```
- 额外确认：原始 `Date\.now|Math\.random` 命中 4 条，全在注释行（clock.ts:2,5 / random.ts:2 / region.ts:16）；原始 `from 'node:` 命中 103 条，全在 `packages/*/test/*.test.ts`，被 `grep -v '\.test\.ts:'` 正确滤除。

**裁决**：**GLM 正确**。YAML D4 行存在 bash 引号错误，原样执行必 syntax error；D4 从未在 CI 原样执行过。MiniMax 声称"原样复跑三门 0 命中"与本次 `sed | bash` 结果矛盾，其实际跑的应是等价修正命令（如 `grep -rEn "from ['\"]node:" ...` 单独跑）。Step Router 未区分"代码面干净"与"门禁脚本在岗"是两个独立命题。

### 2.3 perf x25519 基线数字

| 维度 | GLM Flash | MiniMax M3.1 Flash | Step Router V1 | 本次 |
|---|---|---|---|---|
| **数值** | 4.01–4.10 ms/op（两次运行） | 3.5723 ms/op | 3.8325 ms/op | **3.9816 ms/op** |

四组数据均为 win32 / Node v22.23.2 / 200 iter / 20 warmup / 注入真实 node:crypto 随机源 / `sink:0`。

**裁决**：应呈现区间 + 当前值 + 方差说明，而非单一点估计。极差 0.53 ms / 均值 ~3.9 ≈ 13.6%，属正常 Windows 桌面 OS 调度波动。09-29 基线 5.25 ms/op 为同机历史值，当前 HEAD 快约 24%。README 现行 3.62 ms/op（commit 0962ada）在区间内，可保留为"代表性值"，但须注明"同机同测法，机器 load-dependent，未在 ArkTS 真机复测"。

## 3. 盲区与补救

三份盘点对 `docs/` 子目录的覆盖深度不一，且存在"三份都只转抄未验证"的共性盲区：

| 盲区 | 三份报告的处理方式 | 本次补验 | 结论 |
|---|---|---|---|
| **`CONTEXT.md:15` "test:bridge **29** pass"** | 三份均未指出此漂移；GLM/MiniMax 只写"bridge 30"，Step 正文写 30 但未专门点名 CONTEXT | `grep -n 'test:bridge.*29\|bridge.*29' CONTEXT.md worklog.md README.md` → `CONTEXT.md:15`、`worklog.md:31`、`worklog.md:36` 三处命中 | **已补验**：CONTEXT.md 与 worklog.md 均停留在 10-02 C-B 轮的 29 pass，已被后续提交（5c3db5e "+1"）推进到 30；文档未更新，与当前 HEAD 实测矛盾 |
| **`worklog.md:31` "typecheck:bridge → EXIT=0"** | 三份均引用 worklog 数字但未独立验证其当前真伪 | 读 worklog.md:31 并与当前 `tsc` 实测对比 | **已补验**：该记录是 10-03 C-B 轮当时的真值，已被 e136900 破坏；当前 exit 2，worklog 未更新 |
| **`HARMONY_AGENT_TASK.md` 中 "六包 / 238/238"** | 三份均未读取此文件 | `head -50 HARMONY_AGENT_TASK.md` | **已补验**：文件为 agent 任务书，内部口径仍停在 10-01 早期（"六包 TypeScript 协议核心库，Node 侧测试全绿 238/238"）。当前真相为 8 包 / 495 测试；该文件已全面过期 |
| **`docs/oracle/raw/`（DELIVERY_REPORT 引用的 17 份转储）** | 三份均指出不存在，但仅以 `ls` 或 `git log` 为证 | `ls docs/oracle/` + `git log --all -- docs/oracle/raw` | **已补验**：`docs/oracle/` 仅含 `protocol-notes.md`（20KB），`raw/` 子目录从未入 git 历史（空输出）。三份报告结论正确 |
| **`docs/research/` 与 `docs/upstream/` 的研究笔记** | 三份均仅列文件名和大小，未做代码级 diff 或结论核验 | `ls -la docs/research/ docs/upstream/` | **部分补验**：确认 8 份研究笔记（30–45KB）和上游 Go 快照在盘。内容级核验（研究笔记断言 vs 实际代码）超出本轮时间预算，留作后续工作 |
| **`peerapi-tun.test.ts:246` 类型错误的具体影响面** | 三份均指出运行时 30/30 绿（mock q 校验先于 answerDns 调用），但未逐条枚举"哪些测试碰 answerDns" | 读 `app/bridge/test/peerapi-tun.test.ts:230-260` | **已补验**：仅最后 1 例（"ExitDNS：name 跨包污点边界"，:245）传入整包 config 对象字面量并触发 TS2353；前 8 例均传 `null` 或合法函数。类型错误被运行时 mock 严格隔离，不会误过畸形请求 |

## 4. 给最终基线总文的必收要点（20 条，按重要性排序）

| # | 要点 | 验证等级 |
|---|---|---|
| 1 | `npm test` 495/0 / `test:bridge` 30/0 / `validate:shell` 66/0 为当前 Node 侧全量门禁基线 | 三方实证 + 本次独立复验 typecheck:bridge |
| 2 | `typecheck:bridge` 红灯（TS2353 @ `peerapi-tun.test.ts:246`）是唯一未被 CI 覆盖的真实缺陷；需加门或修传参 | 单方实证（本次复跑） |
| 3 | CI G0-5 D4 引号语法错误：YAML D4 grep 因 `'from ['\"](net|...)['\"]'` 单引号提前闭合，任何 bash 下必 syntax error；D4 从未在 CI 原样执行过 | 单方实证（`sed | bash` 复现） |
| 4 | D4/P4 代码面经正确引语验证确实干净（三门 0 命中） | 三方实证 + 本次第 4 次确认 |
| 5 | `interop:regress` 当前不可能输出 PASS：三重缺陷（dummy preauthkey / 缺 authKey / h2c 不可执行） | 单方实证（读源码 + 复跑） |
| 6 | 09-29 INTEROP PASS 无原始证据入仓；`docs/oracle/raw/` 从未入 git 历史 | 三方实证 + 本次 `git ls-files` / `ls` |
| 7 | `app/` 壳从未编译；负面证据链完整（无产物、VpnExtensionAbility 桩、tsconfig exclude） | 三方实证 + 本次 find/grep |
| 8 | perf x25519 当前 HEAD 实测区间 3.57–4.10 ms/op（4 次独立样本），较 09-29 基线 5.25 ms/op 快约 24% | 四方实证（三方 + 本次） |
| 9 | README 双表格并存：495/30/66 现行 vs 280/13/54 过期；同文件 line 12 "54 用例"、line 10 "约 8400 行"、line 54 "二期未做项"均已过时 | 三方实证 |
| 10 | commit `1c9b85b` 二期功能 6/7 已真实落地（disco relay / netcheck 引擎 / DERP 随机选点 / netmap→WG / 状态机 / LocalAPI+PeerAPI+MagicDNS）；TUN 仅在 bridge mock 层接线 | 三方实证 + 本次 git show |
| 11 | 495 = +215 于 280 基线；worklog.md:21,36 + git show 1c9b85b 三方印证 | 双方实证（三方报告 + git 历史） |
| 12 | 规模：packages/ 72 src 文件 / 16904 行 + 49 test 文件 / 13170 行 / 495 用例；app/bridge 3448 行 TS / 30 用例；app .ets 仅 322 行桩 | 单方实证（GLM 逐包之和 + 本次 grep） |
| 13 | `docs-consistency` job 能力边界：仅 `grep -q` 检查"含不含"数字，不检查"是否残留旧数字"；warning 不阻断 | 单方实证（读 YAML 逻辑） |
| 14 | CONTEXT.md:15 仍写 bridge 29 pass；worklog.md:31 仍写 typecheck:bridge=0 / bridge=29 — 文档已漂移 | 单方实证（grep） |
| 15 | HARMONY_AGENT_TASK.md 全面过期（"六包 / 238/238"） | 单方实证（读文件） |
| 16 | ArkTS linter src=0（09-29）有物证 `docs/arkts-linter-report-raw.txt`（270 行，diagnostics: 477→0），但 linter 需 WSL+SDK，本轮未复跑 | 单方实证（读文件） |
| 17 | 安全修复实证强度：fcaf962（upload_server 路径穿越）= 最强（单元+集成双层+CI G0-6）；e136900 mock-peerapi 负例 = 强（test:bridge 覆盖）；e136900 arkts-check.js 修复 = 弱（无测试、本机无法执行） | 单方实证（读测试 + 复跑） |
| 18 | 全仓无任何真实 socket/TLS/ICMP 实现层；network 行为全经注入接口（HttpTransport/DerpDialer/StunSender） | 三方实证 |
| 19 | 真机 / DevEco / headscale / 华为 SDK 均不可及；鸿蒙壳编译、INTEROP 复现、ArkTS linter 复跑均为冻结项 | 三方实证 |
| 20 | 下一轮三条最小行动：① 把 `typecheck:bridge` 加进 `g0-gates.yml` 并修 `peerapi-tun.test.ts:245` 传参；② 修 `interop/regress.mjs`（dummy key / 缺 authKey / h2c 不可执行）；③ 删 README 第二张表 + 升级 `docs-consistency` 为"含 495 且不含 280/238/217/13/54/29" | 单方实证（综合判断） |

## 5. 交叉审校员签名与说明

本报告由 Step Router V1 独立完成，所有裁决均基于本人亲自重跑命令 / 重读文件 / 重查 git 的证据。三份盘点报告的原文链接：
- `docs/baseline-audit/inventory-glm53-flash.md`
- `docs/baseline-audit/inventory-minimax-m31-flash.md`
- `docs/baseline-audit/inventory-step-router-v1.md`

报告生成后未改动仓库任何既有文件（仅创建本 synthesis 文件）。

## 6. 总体判断（一段话）

这个仓库的真实形态是一套在 Node 环境下被 495+30 个用例钉住的纯 TS 协议核心库（8 包 16904 行，密码学原语到控制面状态机逐层有上游向量或交叉验证锚定，本次全数复绿），外加一个从未编译过的鸿蒙工程壳（322 行 .ets 桩 + 3448 行内存 mock 桥）和一份只在 2026-09-29 当天真实联通过 headscale v0.29.4 的互操作脚本组（无原始证据入仓，且 regress.mjs 当前因三重脚本缺陷不可能产出 PASS）。"协议正确性"有同级较强的本地证据；"能在鸿蒙上跑、能连真实网络"没有任何本次可验证的证据。门禁体系有实效但带两处真实缺口：typecheck:bridge 红而被 CI 盲区掩盖、D4 机检脚本自身语法错误从未运行过。
