交叉综合 · GLM 5.3 Flash · HEAD 90ed53e · 2026-10-03

# 0. 元信息

- 审校人：GLM 5.3 Flash（第二轮三交叉审校员之一）。
- 输入 = 三份互相独立的盘点报告：
  - `docs/baseline-audit/inventory-glm53-flash.md`（下称 [G]）
  - `docs/baseline-audit/inventory-minimax-m31-flash.md`（下称 [M]）
  - `docs/baseline-audit/inventory-step-router-v1.md`（下称 [S]）
- 方法：
  - 一致项：核对三份的取证表述确属同证同果后固化为共识；
  - 分歧项：只依我本会话亲手重跑的命令、重读的文件、重查的 git 裁决，不以多数投票代替复验；
  - 盲区：三份都未验证或只转抄处，抽关键项亲自补验。
- 纪律：未修改任何既有文件；唯一新建文件即本报告。
- 我本会话亲手跑过的命令（证据基准，下文引用时不再重复声明"亲跑"）：
  - `sed -n '69,87p' .github/workflows/g0-gates.yml | bash`（G0-5 逐字复跑）
  - 修正引号的等价三段 grep（P4 / node: 导入 / D4 网络特征）
  - `npm run typecheck:bridge`
  - `npm run perf:baseline`
  - `npm run interop:regress`
  - `npm run test:bridge`、`npm run validate:shell`
  - `node interop/arkts-check.js .`
  - `find packages … | wc -l`、`cat … | wc -l`（src/test 文件数与行数、逐包文件数、bridge 行数）
  - `git log --all -S selfAddresses`、`git show e136900`、`git show --stat 1c9b85b`
  - `git show ec5b99f:app/bridge/test/peerapi-tun.test.ts | grep -cE '^\s*test\('`（与 HEAD 同法对比）
  - `git log --all -- docs/oracle/raw`、`git ls-files docs/research`、`git ls-files interop`
- 我**未**复跑的项（遵任务指示省时；三方已各自实测且结论一致）：
  - 全量 `npm test`（三方均 495/0，[G]§2.2 / [M]§2.2 / [S]§2.1）
  - 根 `npm run typecheck`（三方均 exit 0）
  - `npm run interop:test:upload`（三方均单元 8/8 + 集成 7/7）
  - 这三项在总文中按"三方实证"收录，我不添独立样本。
- 环境：win32 / Git Bash / node v22.23.2 / npm 10.9.8，与三方一致。

# 1. 三方一致结论（核对三份表述后固化，附证据出处）

1. **G0 基线 495/30/66 是当前真相。**
   - `npm test` 495/0：[G]§2.2、[M]§2.2、[S]§2.1 各自实测（我未复跑）。
   - `test:bridge` 30/0：我亲跑复现（`# tests 30 / # pass 30 / # fail 0`，TB_EXIT=0）。
   - `validate:shell` 66/0：我亲跑复现（`summary: 66 passed, 0 failed`，VS_EXIT=0）。
2. **`typecheck:bridge` 红灯 TS2353，本次最重要的新发现，我已亲自钉死。**
   - 亲跑：`app/bridge/test/peerapi-tun.test.ts(246,5): error TS2353: … 'selfAddresses' does not exist in type 'DnsAnswerFn'`，exit 2。
   - 引入提交：`git log --all -S selfAddresses -- <该测试文件>` 唯一命中 e136900；
     `git show e136900` diff 亲见 `+ makePeerServer({ + selfAddresses: […] + answerDns: null`——
     e136900 把整包 config 塞给单参 helper（helper 定义在测试文件 ：245，参数类型 `MockPeerApiConfig['answerDns']` 即 `DnsAnswerFn|null`）。
   - 行号亲读：:245 是 `const server: MockPeerApiServer = makePeerServer({`，:246 是 `selfAddresses: […]`，与 tsc 报错位置吻合。
   - 5c3db5e 在其上加独立断言未修签名（commit message 自述，git log 日期 e136900 11:00 → 5c3db5e 11:29）。
3. **CI 不含 typecheck:bridge，红灯被门禁盲区掩盖。**
   - 我通读 `.github/workflows/g0-gates.yml` 全文：g0 job 六 step（G0-1 test / G0-6 upload / G0-2 typecheck / G0-3 test:bridge / G0-4 validate:shell / G0-5 D4P4）+ docs-consistency job——无此命令。
   - 运行时仍 30/30 绿的原因（[G]§2.4 分析，代码在盘）：mock 对畸形 q 的 400 校验先于 answerDns 被调用，错位传参在运行时无害。
4. **README 同页双表格自相矛盾。**
   - 亲读 README.md:31-40 现行表 495/30/66 + perf 3.62；:41-46 无表头残表 280/13/54。
   - 旧表来源钉死：worklog.md:23（10-01 夜班实跑 280/13/54，"bridge 13/13"）。
   - 中间态：10-02 收口 495/**29**/66（worklog.md:36 亲读）。
   - 29→30：`git show ec5b99f:…peerapi-tun.test.ts` 8 个 `test(` → HEAD 9 个（亲测），即 5c3db5e 加的第 9 个用例。
5. **README 其余漂移（逐条亲验）。**
   - :10 "约 8400 行" vs 我实测 packages 8 包 src = 72 文件 / 16904 行——低估一半。
   - :12 "validate:shell 54 用例" vs :25 "66 用例"同文件互斥；实测 66。
   - :54 "已知问题 3"列二期未做 7 项——`git show --stat 1c9b85b` 亲见 relay/engine/regionpick/wgderive/peerconn/localapi/peerapi/magicdns/mock-tun 全部落地（+215 测试），6 项已实现；
     仅"数据面 TUN fd 接线"属实未做：VpnExtensionAbility.ets:41-43 `addresses: [] / routes: [] / dnsAddresses: []` 带 TODO"真实调用会失败"（亲读）。
6. **app/ 壳从未编译（负面证据亲验）。**
   - `find app -name '*.hap' -o -name '*.abc' -o -name '*.har' -o -name '*.app'` = 0。
   - `app/oh_modules`、`app/build`、`app/entry/build` 均不存在。
   - [G]§3.2、[M]§3.2、[S]§3.2 同证。
7. **09-29 INTEROP PASS / DERP INTEROP PASS 无原始证据，仅 Markdown 转引。**
   - `evidence/` 不存在、`docs/oracle/raw/` 不存在（ls 亲验）。
   - `git log --all -- docs/oracle/raw` 为空——从未进入本地 git 历史。
   - 唯一详述在 DELIVERY_REPORT.md §5.2–5.5（:180-208 亲读）。
   - 本次 `interop:regress` 复跑阶段 1 `ECONNREFUSED 127.0.0.1:8080`（亲跑复现，与三方一致）。
8. **CONTEXT.md:15 "test:bridge 29 pass" 过期，现值 30。**
   - [G]§3.6、[M]§4.3③、[S]对照#13（[S] 归到 DELIVERY §6.1 同源）三方都点名；成因见 §2-D6。
9. **interop:test:upload（G0-6）单元 8/8 + 集成 7/7 全过。**
   - 三方各自实测，我未复跑。
   - 但 upload_server.test.mjs:10-11 头注释"13 条攻击向量/实跑 Python server + curl"已过期（亲读；实际 8 条向量依据 [M]§2.7 数组计数，单方）。
10. **官方 ArkTS linter src=0 属"物证在盘、未复跑"。**
    - docs/arkts-linter-report-raw.txt 270 行在盘；头两行亲读："scanning 76 .ets files under /home/dev/arkts-scan/packages"、"arkts linter diagnostics: 477"。
    - 复跑需华为 SDK + WSL，三方均未复跑。
11. **两次安全修复的实证强度分层。**
    - fcaf962（upload_server unquote 顺序 + 显式拒 `/\`）：单元 + 集成 + CI 常驻门 G0-6，最强。
    - e136900 ① mock-peerapi answerDns 校验：被 test:bridge 覆盖（我亲跑 30/0），强。
    - e136900 ② arkts-check.js 路径穿越修复：**零实证**——脚本本机加载即崩（§2-D5）。
12. **结构性边界（三方结论一致）。**
    - packages/ 内无一处真实 socket，网络行为全经注入接口（D4 设计使然）。
    - 真机编译、真 headscale 对拍、真机 linter 三条环境线冻结。
    - "能在鸿蒙上跑 / 能连真实网络"没有任何本地可验证证据。

# 2. 分歧与裁决

| # | 分歧点 | 各方说法 | 我的复验过程 | 裁决 | 证据 |
|---|--------|----------|--------------|------|------|
| D1 | interop:regress 失败归因 | [G]：纯环境缺失（ECONNREFUSED，非产品缺陷）。[M]：环境缺失 + regress.mjs:59-61 只给 2 参的 derp.node.ts 传 1 参（有 headscale 也必败）+ :57 硬编码假 preauthkey。[S]：环境缺失 + stage2 缺 authKey 传参 | 亲读 regress.mjs 全文、derp.node.ts:37-39、register.node.ts:43-45、h2c.node.ts（grep 证实无 argv/env 解析）；亲跑 `npm run interop:regress` | **[M][S] 对，[G] 错。** 阶段 1 ECONNREFUSED 属环境缺失；但阶段 2 是脚本缺陷：regress.mjs:54-56 只传 `[derp.node.ts, HS]` 1 参，derp.node.ts:37-39 要求 `<baseUrl> <authKey>` 2 参——与 headscale 无关必败。阶段 1 另硬编码 `regress-dummy-preauthkey`（实际 ：52；红线自述 key 用后即弃不入仓，硬编码必无效）。阶段 3 h2c.node.ts 只导出 `H2OverNoise` 类（:29）、无 CLI 入口，我复跑时该阶段零输出。**当前脚本形态不可能输出 INTEROP PASS** | regress.mjs:51-59；derp.node.ts:37-39；h2c.node.ts:29；我的三阶段复跑输出与三方观察一致。[M] 引用行号有偏差（59-61 实为 54-56、57 实为 52），derp.node.ts:39 引用精确 |
| D2 | CI G0-5 的 D4 检查 | [G]：该 step bash 自身语法错误 exit 2，D4 从未真正跑过；修引号等价 grep 0 命中——代码面干净、门禁脚本坏。[M]：D4/P4 三门各 0 命中。[S]：D4/P4 三组全 0 命中 | ① `sed -n '69,87p' .github/workflows/g0-gates.yml \| bash` 逐字复跑；② 手跑修正引号的等价三段 grep | **[G] 对。** 逐字复跑 exit 2：`bash: line 15: syntax error near unexpected token '('`（提取脚本第 15 行 = yml:83；D4 grep 的 `'…from ['\"](net\|…)['\"]'` 引号拼接使 `(net\|…)` 落在引号外）——**CI 里 D4 段从未执行**。P4 / node: 两段有效且 0 命中（亲测 0/0）。[M][S] 的"三门 0 命中"实为等价改写的结果（[M] 自述把脚本重抄进 %TEMP%，无意中修好引号）。修正引号等价 D4 = 0 命中——**代码面干净为真，"机检在岗"对 D4 一节不成立** | 我复跑 exit 2 原样输出；等价 grep 0/0/0；g0-gates.yml:83 原文亲读 |
| D3 | perf x25519 数字 | [G] 4.01–4.10；[M] 3.5723；[S] 3.8325 ms/op（三方并发实测的正常波动） | 亲跑 `npm run perf:baseline` → **3.5089 ms/op**（284.99 ops/s，exit 0，sink=0） | **呈现为区间 + 条件。** 同机同法（win32 / Node v22.23.2、200 iter/20 warmup、注入真实 node crypto 随机源）五次独立运行 3.51–4.10 ms/op（我的新样本在低端）。README/0962ada 单点 3.62 落于区间内，不必判错。建议总文写："x25519 ≈3.5–4.1 ms/op（五次运行区间，机器负载致 ~±8% 波动）；09-29 基线 5.25 → 快 27–33%" | 我的输出 `{"mean_ms":3.5089,…}`；[M]§2.9、[S]§2.1#11、[G]§2.9 |
| D4（新发现） | packages 规模计数 | [G] 72 src 文件/16904 行、49 test 文件/13170 行。[M] 72/16904、49 test 但总行写 **11570**。[S] 63 src/46 test、~16904/~13268 | `find packages -path '*/src/*' -name '*.ts'` = 72、`cat\|wc -l` = 16904；test 同法 = 49 / 13170；逐包文件数：common 9 / crypto 8 / noise 7 / wireguard 10 / derp 6 / disco 5 / control 17 / netcheck 10 | **[G] 全对。[M] 的 11570 是自身表格的加总算术错**（其逐包 524+1001+1881+2074+1302+797+3697+1894 恰 = 13170）。**[S] 行数近似对但文件数错**（63/46 实为 72/49；crypto 6→8、control 15→17 等逐包全偏）。总文采：72 src/16904 行 + 49 test/13170 行 + 495 用例 | 我的 find/wc 输出（左列逐包数即实测值） |
| D5（新发现） | arkts-check.js 本机可跑性 | [M]：exit 1，`ReferenceError: require is not defined in ES module scope`（根 package.json "type":"module"）；e136900 对它的修复零实证。[S]：表标"本机可跑（需 ohos-sdk）"。[G]：未测，标"需 WSL+华为 SDK" | 亲跑 `node interop/arkts-check.js .` | **[M] 对，[S] 错。** exit 1：`ReferenceError: require is not defined in ES module scope`——CommonJS 文件 + 根 "type":"module"，根本加载不了，谈不到 SDK 层。第二层阻塞也在：`require('/home/dev/sdk/ets/…')` 硬编码（:6 亲读；另 ：5 硬编码默认 repo 路径）。**e136900 的 arkts-check.js 路径穿越修复本机零实证**成立 | 我复跑 exit 1 原样报错；arkts-check.js:3-6 |
| D6（新发现） | 桥基线 29 vs 30 的成因 | [G][M][S] 均判 DELIVERY/CONTEXT 的 29 过期，但 29→30 何时发生无人考证 | `git show ec5b99f:app/bridge/test/peerapi-tun.test.ts \| grep -cE '^\s*test\('` = 8；HEAD 同法 = 9；git log：ec5b99f（10-03 03:29）报 495/29/66，5c3db5e（11:29）自述"负例 test 加独立断言" | **非矛盾，是时序。** 29 在 1c9b85b/ec5b99f 时点为真；5c3db5e +1 → 30；CONTEXT.md:15 / DELIVERY §6.1 停在 29 未更新。[S]"29 是 1c9b85b 刚入库时的数字，后续 +1"方向正确，我补齐了提交级证据 | git show 两次计数 8→9；git log 日期线 |

# 3. 盲区与补救（三份都只转抄未验证处 + 我的补验结果）

1. **HARMONY_AGENT_TASK.md——三份全部未盘点。**（我补验，亲读前 60 行）
   - 写给鸿蒙电脑 agent 的自包含任务书。
   - §0 仍写"packages/（**六包**…全绿 **238/238**）"；§4 期望 `node --test` = **238/238**。
   - 现状 8 包 / 495——按此任务书执行验收**必误判为失败**。
   - 另载"x86 linter 基线 src=0 / test=321"转述与 TEST-NET 克隆地址。
   - 结论：与 README"已知问题 3"同级过期，总文必须点名。
2. **CONTEXT.md:8 / :28"未纳入 git 管理、无 CI，目录即唯一副本"。**（我补验）
   - 与现状直接矛盾：本地 22 个提交、`.github/workflows/g0-gates.yml` 在盘（亲读全文）。
   - 三份均未点名此漂移。
3. **worklog.md:35"D-interop-plan.md 原文件不入公仓 commit 链"。**（我补验）
   - `git ls-files docs/research` = 8 份全部已跟踪，含内部版 `2026-10-02-D-interop-plan.md`。
   - "不入公仓"是否指另一个推送目标，本地无法验证（无 gh / 无远端访问）——如实标注，建议 owner 核对远端可见性。
4. **docs/upstream/ts-main（上游 Go 快照）+ headscale 三文件。**
   - 三份均标 B 未 diff；我亦未 diff（如实记录）。
   - "逐条锚定上游 行号"的全部测试断言，最终依据都在这批快照里。
   - 总文应把"上游快照在盘但本轮未比对"写成明示边界。
5. **docs/oracle/raw/ 17 份转储的去向。**
   - 目录不存在，且本地全历史无此路径（`git log --all` 亲验）。
   - DELIVERY_REPORT:151 仍引用其中 `derp-map.json` / `README.txt`。
   - 结合 a3642ea"filter-repo 于副本执行"的公开清洗提交，"曾存在后被历史剥离"与"从未提交"两种可能并存，本地无法分辨。
   - 总文按"当前仓内不存在、引用失效"记录即可，不必裁定成因。
6. **docs/research/ 8 份笔记与 docs/oracle/protocol-notes.md。**
   - 三方只当引用源；我确认在盘（B 级，内容未逐份复核）。
7. **docs-consistency 门"只防漏写、不防错写"。**（[M]§3.5.1 独家分析）
   - 我亲读 yml:121-126 证实：仅 `grep -q "$T_TOTAL"` 查"含不含"，且 `::warning` 无 exit 1。
   - README 同时含 495 与 280 时该门照过——分析成立，升为共识。
8. **测试/工具注释自陈漂移。**（[M] 独家，我抽验证实两处）
   - upload_server.test.mjs:10-11"13 条/curl"——过期（亲读）；实际 8 条向量的计数依据 [M]（单方）。
   - app/tools/validate-shell.mjs 头注释只列 V1–V8、V9 未入（grep 亲验 V1@:7、V8@:15、头注释无 V9）。

# 4. 给最终基线总文的必收要点（≤20 条，按重要性排序，附验证等级）

1. 【三方实证】真实能力一句话：Node 侧被 495+30 用例钉住的 8 包纯 TS 协议核心（72 文件/16904 行）+ 从未编译的鸿蒙壳（322 行 .ets 桩 + 3448 行 mock 桥）+ 仅 09-29 一天联通过真 headscale 的互操作脚本组（无原始证据入仓）。
2. 【三方实证，本人钉死】`typecheck:bridge` exit 2（TS2353@peerapi-tun.test.ts:246），e136900 引入、5c3db5e 加断言未修、CI 六 step 不含此门——唯一现役红灯，被门禁盲区掩盖；运行时 30/30 仍绿。
3. 【三方各执一词，本人裁决】CI G0-5 的 D4 grep 段语法错误（yml:83）：本地逐字复跑 exit 2，D4 机检从未在岗；P4/node: 0 命中、修引号等价 D4 0 命中——代码面干净、门禁脚本坏。远端 Actions 实际表现不可查（无 gh）。
4. 【双方实证 + 本人钉死】`interop:regress` 当前形态不可能输出 INTEROP PASS：阶段 2 少传 authKey（必败）、阶段 1 硬编码假 preauthkey、阶段 3 无 CLI 入口零输出；阶段 1 另需 headscale 环境。
5. 【三方实证（缺失方向），本人复核】09-29 INTEROP PASS / DERP INTEROP PASS、linter src=0：转引或物证在盘，本轮全部不可复跑（缺 headscale、缺华为 SDK）；`docs/oracle/raw/`、`evidence/` 不存在且从未入本地 git 历史。
6. 【三方实证，本人逐条复核】README 漂移清单：双表 495/30/66 vs 280/13/54（旧表=10-01 夜班基线，worklog:23）、:12"54"vs:25"66"、:10"约8400行"vs 实测 16904、:54"二期未做"7 项中 6 项已实现（1c9b85b），仅 TUN 真 fd 接线未做（VpnExtensionAbility.ets:41-43 空数组桩）。
7. 【双方点名 + 本人补验】CONTEXT.md 漂移：:15 "bridge 29"（29→30 发生于 5c3db5e，提交级证据 8→9 个 test）、:8/:28"未 git 化/无 CI"（现状 22 commits + CI 工作流在盘）。
8. 【单方实证（本人补验，三份盘点盲区）】HARMONY_AGENT_TASK.md 仍写"六包 238/238"并以此设验收期望——按现状必误判。
9. 【三方实证】perf x25519 呈现为区间 3.5–4.1 ms/op（同机同法五次独立运行，含本人新样本 3.5089）；README 单点 3.62 落于区间内；09-29 基线 5.25 → 快 27–33%。不设门、非跨机基准。
10. 【三方实证】1c9b85b 二期 7 项宣称：6 项真实落地且有实质测试（多为上游 行号 锚定），TUN 仅 bridge mock 形态。
11. 【三方行数一致，文件数本人钉死】规模定数：8 包 src 72 文件/16904 行、test 49 文件/13170 行、495 用例（逐包 40+35+39+60+58+38+141+84）。[S] 文件数、[M] 总行数各自有误。
12. 【双方实证 + 本人钉死第三层】两次安全修复分层：fcaf962 upload_server（单元 8+集成 7+CI 常驻 G0-6）最强；e136900 mock-peerapi 负例（test:bridge 覆盖）强；e136900 arkts-check.js 修复零实证（本机加载即崩 + 硬编码 SDK 路径）。
13. 【双方实证 + 本人亲读 yml】CI 设计缺陷合计：不含 typecheck:bridge；G0-5 D4 段语法死；docs-consistency 只防漏写、warning 不阻断——对全部已点名文档漂移失明。
14. 【双方实证（[G] 定性 + [M] 计数）】D4/P4 纪律的边界：grep 只证"无这些字面量"（P4 原始 4 处全在注释、node: 导入 103 处全在 test），不排除经注入 transport 的真实 I/O（common/http.ts、control/noisehttp.ts 即注入抽象）。
15. 【单方实证（本人）】互操作内部研究笔记 `2026-10-02-D-interop-plan.md` 实际已入 git（`git ls-files` 亲验），与 worklog:35"不入公仓 commit 链"表述冲突；远端可见性待 owner 核对。
16. 【双方实证（[M] + 本人）】arkts-check.js 本机不可执行（ESM/CJS 冲突）；[S] 表标"可跑"系错误，采 [M]。
17. 【三方实证（转引性质一致）】互操作真实通过史：唯一详述 DELIVERY §5.2–5.5（09-29 WSL headscale v0.29.4，注册/DERP 双向验证、ClientInfo 的 MeshKey 必须整字段省略为实测发现）——作历史叙事保留，证据等级 C。
18. 【未实证，明示边界】上游快照 docs/upstream/ts-main + headscale 三文件在盘，但三份盘点（含本轮）均未做代码级 diff——"上游对齐"声明的最终依据未被独立复核。
19. 【单方实证（[M]），本人未重算——采信并标注】无 lint/formatter/coverage 门；control 包测试密度最低（3697/7303≈0.51×）且恰是二期功能最密集处。
20. 【三方实证】本地可复现集 = `npm test` / `typecheck` / `test:bridge` / `validate:shell` / `interop:test:upload` / `perf:baseline` / G0-5 有效两段；三条环境冻结线（DevEco 真机、headscale+docker、华为 SDK+WSL）之外，这就是总文"可依赖"的边界。

---

*本报告全部裁决基于本会话亲手取得的命令输出 / 文件原文 / git 对象；未运行项如实标注"未复跑"。未修改仓库任何既有文件。*
