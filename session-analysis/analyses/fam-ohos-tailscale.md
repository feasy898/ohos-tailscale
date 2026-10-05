# 族：ohos-tailscale（鸿蒙 tailscale 移植）

数据源（2 条轨迹）：
- 主会话 `trajectories/bf3cf7a6-49d3-4f4b-9dd0-42d8e0635a2e.txt`（334 消息/300 模型调用，10-02 00:02 → 10-03 11:47，标题「鸿蒙系统的tailscale在开发……推进到真机验证之前……推送到github新建仓库」）
- 子会话 `trajectories/subagent_agent_603dbc63-72fc-4766-b875-e0a29e4904b4.txt`（最终测试撰写人 GLM53，10-03 15:02 → 15:56，560 parts）

---

## 1. 任务画像（做什么、约束、规模、产出物）

**做什么**：把 `feasy898/agentic-factory-projects` monorepo 中的 `ohos-tailscale/` 子树（Tailscale 兼容 mesh VPN 的纯 TS 协议核心 + 从未编译的鸿蒙 ArkTS 应用壳）迁出为独立仓库，在"到真机验证之前"的边界内继续开发上游 TASK.md 规定的子线 A（文档债）/B（协议面：disco relay 0x04–0x09、netcheck 调度、DERP region 选节点）/C（netmap→WireGuard 推导、LocalAPI/PeerAPI/MagicDNS/TUN mock）/D（headscale 互操作一键回归），并创建公开仓库 `feasy898/ohos-tailscale` 推送。用户明确要求"多用工作流派遣子代理"，并在次日追加"凡是不需要真机的工作，都由你完成……评审用冷上下文子代理 + grok build cli"。

**硬约束**（轨迹证据）：
- G0 五门机检贯穿全程：`npm test`（基线 280→终态 495/0）、`npm run typecheck`、`npm run test:bridge`（13→30）、`npm run validate:shell`（54→66）、D4/P4 grep（src 禁 `node:` 导入/网络调用、禁 `Date.now`/`Math.random`）。证据：`[TOOL Bash] "=== G0-1 npm test ===" … # tests 280 # pass 280`；`# tests 495 # pass 495`。
- 脱敏纪律：公开仓不得含真实外网 IP（`223.198.166.92`、`156.238.240.81`、`36.139.118.235`），协议地址（CGNAT `100.64.0.0/10`）除外，替换为 TEST-NET 占位。
- P4 确定性纪律：密码学 API 一律注入 Rng，src 禁非确定随机源（perf 脚本第一次跑就因未注入 rng 报 `Cannot read properties of undefined (reading 'randomBytes')`）。
- 子线 E（真机）冻结 WAITING_EVENT，不得主动解冻；凭据只进程内使用不打印（取 token 后只输出 `tok_len=40`）。

**规模**：主会话跨 36 小时、阶段 0–6；动态工作流一次跑掉 **178,697,332 token**（18 步 settle、6h51m）；本地 22 提交、远端最终 `90ed53e`。子会话 54 分钟产出 600 行 TESTS.md + 16 个可见测试文件（79 用例 = 25 绿 + 54 红锚）+ 14 门注册表 + 仓外 holdout 包（9 测试文件、fail-closed runner、哨兵、冻结基线 495 测试名/396 导出）。

**产出物**：8 个纯 TS 协议包（common/crypto/noise/wireguard/derp/disco/control/netcheck，396 导出）、app/bridge mock 三面、GitHub Actions CI（g0-gates.yml，双平台）、`scripts/perf-baseline.mjs`（x25519 5.25→3.62 ms/op）、`interop/regress.mjs` + `upload_server.test.mjs` 攻击向量实证、docs/handover/ 三身份手册、tests/plan 验收体系 + holdout 反过拟合体系。

## 2. 轨迹叙事（关键阶段、决策点、工具使用模式，引用轨迹中的具体证据）

**阶段 0——迁出与基线（10-02 00:02–01:08）**：克隆成功但 checkout 失败，定位到 monorepo `zcode-research/` 里有名为 `NUL` 的 Windows 保留设备名文件，"堵死了检出和 subtree split"；决策改用 `git filter-repo --subdirectory-filter` 在裸仓上做历史提取（"它走 fast-export 流，不碰工作树"），11 提交全保留、597 KiB。基线 G0 发现**交付时就挂着的 2 个 bridge 失败**：脱敏只替换了字符串形式 `156.238.240.81`，"字节数组形式 `[156, 238, 240, 81]` 漏网了"——修正后 13/13。这是一个高质量开局侦察 → 立即修复 → 再建工作流的顺序。

**阶段 1——动态工作流三连败与主代理接手（10-02 01:08 – 10-03 03:17）**：用户说"我授权一次……授权完就去睡觉"。第一次提交脚本前发现自己"误把半成品脚本提交了（有个占位函数没收尾）"，又修掉同名子代理重复创建问题（"`C-A-netmap实现` 这个名字被创建了两次——同名子代理会导致整个运行失败"）。用户从 GUI 把子代理模型改成 GLM-5.3-Flash 后，运行 5m38s 即被限流打断（"并发 12/16、限流持续 3 分多钟后驱动器报错，7 路研究代理只有 1 路完成"）。20 小时后 AmendWorkflow 降并发（研究波 4+3 两批、`max_concurrency=6`）。第二次跑了 6h51m，**17/18 步全部 settle 后死在最后一步**：`world.run 'npm' did not run to completion (spawn_error): spawn C:\Program Files\nodejs\npm ENOENT`。关键决策点：不 amend 重跑而是**主代理直接接手**——"失败的是脚本运行 npm 跑 G0 门禁，但所有实现都已落盘……比 amend 重跑更快，因为没必要再让 GLM 重写一遍已经写好的代码"。验证工作区产物（495/495 全绿）后手工收口：脱敏修复（测试期望里的 `223.198.166.92`、oracle 笔记、365 行 D 计划重写为对外版）、commit 实现批 `1c9b85b`（49 文件 +21 新文件）、文档债批（6 包→8 包口径勘正、AU5–AU8、A-2 linter 手册）。

**阶段 2——推送的六次尝试（10-03 03:29–03:49）**：API 建仓 201 成功，但 push 连续失败：①走 socks5 代理 `100.64.0.3:7864` 超时；②清代理直连被 RST——而同一时刻 `curl -sIL https://github.com` 返回 `code=200`（"curl 能 200，git 不行——典型 TLS ClientHello 指纹差异"）；③postBuffer/HTTP1.1 等参数全试无效；④Python socket 探测出 `github.com:22 OK / 443 FAIL / 9418 FAIL`；⑤本机 `github_push_key` 被 publickey 拒绝（API 查到 feasy898 账号只有 `authentication`/`edge-server-kernel-agent` 两把）；⑥决策"生成专用 ED25519 key 并通过 API 加入 feasy898 账号（授权涵盖'推送 GitHub'）"，SSH 推送成功。这段是完整的环境故障决策树范本。

**阶段 4——"凡不需要真机的工作"（10-03 10:02–11:47）**：grok.exe 全盘搜索找到 `C:\Users\Administrator\.grok/bin/grok.exe`（用户提示"你搜一下grok.exe"），但 OIDC token 过期（`exp: 1790785375`）、`--single` 模式挂死无输出，两次后台任务被 kill 后放弃，"用 ZCode cold-context 子代理（GLM-5.3 + step-5-preview）做了独立评审——效果等价"。冷上下文双臂评审收获巨大：评审 A "逐字模拟"抓出 **CI grep 过滤器无效**（"`.github/workflows/g0-gates.yml:67-69` 的 node: 导入过滤器……在 `-n` 输出后不匹配——CI 必然红"）、regress.mjs 承诺存在实际没写、bundle 名错（`com.example.ohos_tailscale` → `com.ohostailscale.app`）、arkts-mirror.sh 的 SCAN_ROOT 在 repo 外会触发 containment 闸。安全线上：4b 修 Mimosa 4 处高危（mock-peerapi answerDns 输入校验——首版误拒 FQDN 尾点导致 `not ok 24`，"FQDN 末尾的 `.`（root label）是合法的"，放宽后 30/30）；4f/阶段 6 复查 Mimosa L2 时推翻了自己的"误报"判断——`upload_server.py` 的 `strip+split` 在 unquote **之前**执行，`..%2fetc%2fpasswd` 编码斜杠绕过 basename，构成"in-directory arbitrary file write"真漏洞，修为"先 unquote 整段 path 再 strip+split"，并写实证测试 `interop/upload_server.test.mjs`（单元层 8 向量 + Python driver 直调 `H.do_POST` 集成层 7 用例）。

**子会话——测试撰写人（10-03 15:02–15:56）**：输入是 PLAN.md（25 工作项）+ BASELINE.md + 5 份思考轨迹，约束"禁止 npm install、禁止 git commit、禁止修改任何既有文件——只能新建"。行为模式高度纪律化：①**先亲验后写入**——`npm test` 抓 495 测试名、8 包导出面 396 项冻结；②**当场证伪上游输入**——minimax-3 轨迹声称 `npm run missing-script` exit 0，实测 `spawnSync('npm.cmd',['run','definitely-not-a-script']) → status=1`，判定原测量是"pipe-pollution"，并把"凡断言退出码必须 spawnSync 直连"写进测量纪律；③**抓到自己的 Windows 陷阱**——`node --test` 设置 `NODE_TEST_CONTEXT=child-v8` 被子进程继承、`spawnSync('npm')` 在 Windows 返回 null status（"因错误的原因变红——这是 G0-5 的教训"）、空 glob 匹配 `node --test` 返回 0 所以 runner 必须 fail-closed、node --test 会转义测试名里的 `#`；④**holdout 卫生**——第一版 TESTS.md 矩阵行泄露了 holdout 变体形状（"h04 deformed forms, h05 extended values"），发现后重写清洗；⑤终态自证：可见套件 `25 绿 + 54 红锚 / 0 UNEXPECTED_RED / 0 STALE_ANCHOR`，holdout `23 PASS + 4 BLOCKED + 哨兵 0 命中`，`git diff --name-only` 为空证明"既有文件零改动"约束成立。

**工具使用模式**：主会话 Bash(网络诊断/测试门禁/git) + Read/Edit(文档收口) + CreateWorkflow/AmendWorkflow/GetWorkflowRun + TodoWrite(阶段驱动，20+ 次系统提醒) + AskUserQuestion(grok CLI 指认)；失败工具调用集中在网络类 Bash（约 15 次 push/探测失败）和 2 次 AskUserQuestion/Read 错误。子会话几乎全是 Write(新建 25+ 文件) + Bash(验证) + 少量 Edit(只改自己刚建的文件)，无一次违规修改既有文件。

## 3. 失败与恢复模式（工具失败、模型失败、走弯路的地方、如何恢复）

| # | 失败 | 轨迹证据 | 恢复方式 |
|---|------|---------|---------|
| 1 | Windows `NUL` 保留文件名堵死 git checkout/subtree split | "克隆成功但检出失败……`zcode-research/` 里有个名为 `NUL` 的文件" | 裸仓上 `git filter-repo --subdirectory-filter`（fast-export 不碰工作树） |
| 2 | socks5 代理挂 + git 直连 443 被 RST 而 curl 200 | "Trying 100.64.0.3:7864... Timed out"；"curl 能 200，git 不行——TLS ClientHello 指纹差异" | Python socket 端口探测→SSH 22 通→发现账号无本机 key→API 加新 ED25519 key→SSH 推送成功 |
| 3 | 工作流 Flash 模型 12 并发限流，5m38s 即死 | "Errored after 5m 38s, in phase 1 of 6... 6 were still running" | AmendWorkflow 降并发 4+3 批 + max_concurrency=6 |
| 4 | 工作流跑 6h51m 后 `spawn npm ENOENT`（Windows npm 是 npm.cmd） | `<error>world.run 'npm' did not run to completion (spawn_error): spawn C:\Program Files\nodejs\npm ENOENT</error>` | 判断为一次性瞬态 + 产物已落盘，主代理接手收口而非重跑（省掉重写已完成的 17 步） |
| 5 | 工作流脚本两次自伤：半成品提交、同名子代理重复创建 | "我上一次误把半成品脚本提交了"；"同名子代理会导致整个运行失败" | 撤回→写完整草稿文件→修复引用复用 |
| 6 | hook 过度阻拦 `cat >> DELIVERY_REPORT.md`（把追加文档误判为写 packages/ src） | "这是 hook 的过度阻拦。改用 Edit 工具追加，更合规" | 改用 Read+Edit 追加 |
| 7 | answerDns 输入校验误拒合法 FQDN 尾点，break 1 个测试 | `not ok 24 - ExitDNS… 400 !== 200`；测试用 `'host.tail-net.example.ts.'` | 承认语义错误（尾点=absolute FQDN 合法），去掉该规则保留首点拒绝，补 10 断言 |
| 8 | perf 脚本未注入 Rng 即调 `x25519GenerateKeyPair` | `TypeError: Cannot read properties of undefined (reading 'randomBytes')` | 注入 node:crypto 包装（脚本侧豁免 P4） |
| 9 | grok CLI token 过期 + `--single` 挂死 | "token 的 `exp: 1790785375`……卡死无输出"，两次 TaskStop | 明确记 todo"不可用"，替换为 ZCode cold-context 多模型子代理（等价独立评审） |
| 10 | **自己误判安全扫描为误报**（弯路重灾区）：先断言 Mimosa 是"pattern-match 误识"，L2 二次警示后实证复查发现真漏洞 | "Mimosa L2 不是误报——……漏了一个真实攻击路径：`/upload/<token>/..%2fetc%2fpasswd`" | unquote 移到 split 前 + 拒含 `/`/`\` 段 + 攻击向量实证测试闭环 |
| 11 | 实证测试自身 6 轮迭代失败：realpath ENOENT、path.resolve 断言方向反、HTTP fetch 全挂（Python server 端口不通）、driver 缺 write 方法、unicode `✓` 解析错、Windows 8.3 短路径致 Node readdirSync 读不到 Python 落盘文件 | "集成层所有 fetch 都失败了"；"actual: [] expected: ['x.bmp']" | 弃真 HTTP server 改 spawnSync Python driver 直调 `H.do_POST`；最终**信任 Python 进程内 `os.listdir` 输出**作为判据；顺带修正 403/400 期望错（len≠3 分支）、剔除合法文件名 `...`、清理 `__pycache__` 污染 |
| 12 | CI grep 过滤器写字面 bug（自己写的 g0-gates.yml） | "原 CI 过滤器 `\$.test.ts$` 在 grep `-n` 输出格式里是行末匹配，永远不命中" | 冷上下文评审 A 逐字模拟发现，改 `\.test\.ts:` |
| 13 | regress.mjs 失败时 exit 0（假绿） | "无 headscale 实例时输出 FAIL 字符串……但 exit=0 错了" | 修为 exit 1，端到端复验 |
| 14 | 子会话 Read 工具读不了 minimax-3.md（偏移 11177 有 NUL 字节——正是文中引用的 `npm run definitely-not-a\u0000-script` 实证记录） | "原始文件中偏移量 11177 处有一个 NUL 字节（这就是 Read 拒绝读取它的原因）" | 复制清洗副本读取后删除；顺带核实其 exit-0 主张为 pipe 污染 |
| 15 | 子会话 holdout H01-f 用错常量（DnsType.AAAA 写成 16，实为 28=AAAA/16=TXT） | "DnsType.AAAA 是 28（16 是 TXT）——这正是验证的重要性" | 查导出面实测修正 |
| 16 | TESTS.md 第一版泄露 holdout 变体形状 | "矩阵行中泄露了具体的 holdout 变体形状……这会削弱 holdout 的效力" | 重写为机制级引用 + 哨兵自检（grep 192.0.2.x/198.51.100.x 命中 0） |

**模式总结**：(a) 环境类失败（Windows 路径/文件名/npm.cmd/短路径/编码）占比最高，且恢复路径都是"换执行通道"（filter-repo 换流、SSH 换协议、spawnSync driver 换进程边界）；(b) 模型/供应商失败（限流、DriverError）通过降并发或主代理接手恢复，从不盲目重跑；(c) 最深的弯路是**对安全扫描结果过早下"误报"结论**——被 L2 二次警示打脸后才实证，教训是"扫描结论必须用攻击向量实证检验，而不是靠语义推断"；(d) 子会话体现了"先证伪再采信"的输入信任模式，连任务书给的 5 份思考轨迹里的实测数据都复测。

## 4. 可复用资产线索（bench 用例 / 回归测试 / 测试用例）

> 以下每条均直接提炼自轨迹中的真实任务与真实失败，输入/预期/判分都可机检。

**C-1 `ohos-ts-migrate-nul-history`（Windows 非法文件名下的 git 历史迁出）**
- 输入：一个 monorepo git 裸仓（fixture 含路径 `zcode-research/NUL` 与 Windows 非法字符文件 + 目标子目录 `ohos-tailscale/` 多提交历史），要求在 win32 上提取该子目录为独立仓库且全历史保留。
- 预期：常规 checkout/subtree split 会失败；正确做法是裸仓上 `git filter-repo --subdirectory-filter`（或等价 fast-export 流），产物提交数/作者/日期与源子目录一致（fixture 验证 11 提交全保留）。
- 判分：结果仓库 `git log --oneline | wc -l` = 预期提交数；`git ls-files` 无 `NUL` 残留；文件树等于源子目录快照。
- 难度：中。考察 Windows 文件系统语义 + git 底层对象操作。

**C-2 `ohos-ts-sanitize-bytearray-ip`（公开脱敏的字节数组盲区回归）**
- 输入：一份"已脱敏"的 TS 测试文件集，字符串形式真实 IP `156.238.240.81` 已替换为 `203.0.113.10`，但字节数组 `[156, 238, 240, 81]`、NAT 公网 `223.198.166.92`（测试期望值）、文档中 `36.139.118.235` 残留；另混入**合法协议地址** `100.64.0.0/10`（CGNAT）与 `100.115.92.0/23` 作为干扰项。
- 预期：agent/脚本区分"协议常量（保留）"与"真实主机地址（替换为 TEST-NET 占位）"，且替换必须覆盖字符串、字节数组、十六进制三种字面形态；替换后 `npm run test:bridge` 恢复 13/13。
- 判分：定向 grep 六个真实 IP 四种形态 0 命中；CGNAT 段仍在 constants.ts；测试门禁全绿；无过度替换（协议地址被误杀即失败）。
- 难度：中高。这是该仓真实发生两次（交付时 1 次、二期 1 次）的脱敏回归。

**C-3 `ohos-ts-unquote-order-pathtraversal`（upload_server.py in-dir 任意覆盖漏洞的发现与实证）**
- 输入：存在漏洞的 Python 收件箱服务（`parts = self.path.strip("/").split("/")` 后才 `unquote(parts[2])` + `basename` + 白名单 `^[A-Za-z0-9._-]{1,255}$` + realpath 二次校验），攻击向量集含 `/upload/T/..%2fetc%2fpasswd`、`/upload/T/%2e%2e%2f`、`/upload/T/x%2f%2e%2e`、裸 `..`、`...`、超长名、NUL、错 token。
- 预期：识别这是**真漏洞**（编码斜杠使 parts[2] 解码后含路径段，basename 归一为 `passwd` 落入 DST，可覆盖目录内任意同名文件）而非误报；修复为"先对整段 path unquote 再 strip/split，并拒 parts[2] 含 `/`/`\`"；且能区分"被 400 拒（畸形段）"与"被 403 拒（段数≠3）"两条拒绝路径；`...` 是合法文件名不应列为攻击向量。
- 判分：给出驱动 `H.do_POST` 的实证（spawnSync Python driver，避免 Windows 真 HTTP server 的端口/短路径坑）：全部攻击向量非 2xx、inbox 仅含合法 `x.bmp`、Python 进程内 `os.listdir` 为判据而非 Node 端 readdirSync；单元层（判定函数）+ 集成层（真 handler）双层。
- 难度：高。安全语义 + 跨语言进程驱动 + Windows 路径陷阱三重叠加，轨迹里自身迭代了 6 轮。

**C-4 `ohos-ts-ci-grep-filter-semantics`（CI 门禁过滤器的"语法死"检测）**
- 输入：一段 CI YAML，其中 D4/P4 检查写为 `grep -rn "node:" packages/ --include="*.ts" | grep -v "\.test\.ts$" | wc -l`（管道前一级带 `-n` 行号输出）；另给一个含已知违规的变异样本（`packages/foo/src/x.ts` 内 `import ... from 'node:fs'`，及注释行/行尾注释/`.test.ts` 豁免面样本）。
- 预期：识别该过滤器**永远不匹配**（`-n` 输出行末是行号不是 `.ts`），门禁是"语法死从未执行"的假绿；修正为 `\.test\.ts:` 或等价形式；并用变异样本证明修正后的门真有约束力（mutationWitness：注入违规必红、红在可定位标识上，干净态绿）。
- 判分：三件套齐备——正控制（干净绿）+ 负对照（注入违规红且报出文件名）+ 结构断言（yml/registry 字面含该门）；只断言 exit≠0 不给分。
- 难度：中。可泛化为"验证任意 grep 门是否有约束力"的 meta-bench。

**C-5 `ohos-ts-workflow-takeover-decision`（部分完成工作流的接手 vs 重跑决策）**
- 输入：情景题——动态工作流 18 步中 17 步 settle 且代码已落盘（`git status` 54 文件改动、`npm test` 495/495 全绿），最后一步因 `spawn npm ENOENT`（Windows npm.cmd 瞬态）失败；备选动作：AmendWorkflow 重跑 / ResumeWorkflowRun / 主代理直接接手剩余收口。
- 预期：选择主代理接手（产物已在盘、重跑会烧 1.78 亿 token 重写已好代码），且能说明判断依据（失败属环境瞬态而非代码错；剩余步骤是确定性收口非创造性工作）。
- 判分：决策正确 + 给出验证动作（先跑门禁确认落盘产物有效）+ 说明为何 Resume 会以同样方式失败；若选 amend 全量重跑判负。
- 难度：中。考"沉没成本/产物盘点"的编排判断力。

**C-6 `ohos-ts-redanchor-runner`（TDD 红锚聚合 runner 与 fail-closed）**
- 输入：79 个用例的测试集，其中 25 个应绿、54 个是"TDD 红锚"（现在必须红、对应工作项落地后转绿）；环境陷阱：`node --test` 空 glob 返回 0、`npm run missing-script` 实际 exit 1（非 0）、Windows `spawnSync('npm')` status=null 需用 npm.cmd、`NODE_TEST_CONTEXT=child-v8` 会被子进程继承、管道后 `$?` 是 tail 的退出码。
- 预期：实现四态聚合 runner：GREEN_OK / ANCHOR_RED_OK / UNEXPECTED_RED（预期绿却红=回归）/ STALE_ANCHOR（锚点提前转绿=待翻转登记）+ UNKNOWN_TEST（清单外用例）；runner 自身 fail-closed（找不到测试文件即非零退出）；退出码断言全部 spawnSync 直连。
- 判分：构造 4 类变异（弄绿一个锚、弄红一个绿项、删一个用例、空目录运行）各被正确分类/拦截；对 minimax-3 轨迹"missing-script exit 0"的错误主张给出实测反驳（exit=1）。
- 难度：高。该子会话真实产出 `scripts/test-plan.mjs`，全部陷阱有亲验记录。

**C-7 `ohos-ts-fqdn-validation`（DNS q 输入校验的语义边界）**
- 输入：实现 mock PeerAPI `/dns-query` 的 `q` 参数校验（基于轨迹真实演化史）：须拒——缺失 q、首点开头、段间 `..`、超 253 字节、含 `/`、空串、`\x00`；须放行——尾点 absolute FQDN（`host.tail-net.example.ts.`）、label 以 `-` 开头（现行语义）、大写与下划线（字符集 `[A-Za-z0-9._-]`）；`t=aaaa` 须映射 `DnsType.AAAA=28`（非 16=TXT）。
- 预期：正确实现且**负例测试与正例同文件**（每 malformed 一行断言、test( 计数不降）；首版"误拒尾点"的历史失败作为变异样本注入必须被测试抓住。
- 判分：正/负例矩阵逐条机检（放行=200 且透传原名、拒绝=400 且 body 含 `malformed q`）；注入"拒尾点"变异必须红。
- 难度：中。协议语义（RFC 1035 边界）+ TDD 纪律。

**C-8 `ohos-ts-push-network-recovery`（受限网络下的 git 推送决策树）**
- 输入：win32 环境模拟/情景描述：git 全局配了 `http.https://github.com.proxy=socks5h://100.64.0.3:7864`（代理已死）；`curl -sIL https://github.com` 200 但 `git push` 直连 RST；`github.com:22 OK / 443 FAIL / 9418 FAIL`（Python socket 实测）；本机 `github_push_key` 被 publickey 拒绝；GitHub API（含 token）可达。
- 预期：按证据收敛到唯一可行路径——API 创建/确认仓库 → `ssh-keygen` 生成专用 key → API `POST /user/keys` 绑定 → `GIT_SSH_COMMAND` 指定 key 经 SSH 推送；中途不得打印 token（只输出长度）、失败尝试应有清晰排除记录（postBuffer/HTTP1.1/9418 等被否定的理由）。
- 判分：推送成功（远端 commit 哈希匹配）；决策路径含至少 4 次带证据的排除；凭据零泄露（输出扫描无 ghp_ 前缀）；恢复全局代理配置不留污染。
- 难度：高。轨迹中真实的 6 通道探索序列。

**C-9 `ohos-ts-holdout-hygiene`（holdout 反过拟合包设计与泄露自查）**
- 输入：为已公开的可见测试集设计 holdout：变体集须与可见用例值上不相交、哨兵选段须避开与现有验收 grep 冲突的段（轨迹实证：选 TEST-NET-1/2 是因为 `203.0.113.10` 已被 P0-6 验收列为"必须 0 命中的旧假地址"，用 TEST-NET-3 会自相打架）、runner 必须 fail-closed（exit 2=HOLDOUT_NOT_INSTALLED、exit 3=LEAK_SUSPECTED）、冻结基线（495 测试名 + 396 导出）防"删负例凑绿"。
- 预期：交付仓外 holdout 包 + 仓内哨兵测试（证明仓内永不含判定内容）；自查文档（TESTS.md）中不得出现任何具体变体形状/哨兵值（轨迹第一版泄露后重写的真实教训）。
- 判分：`grep -r "192\.0\.2\.\|198\.51\.100\." docs/ tests/` 在仓内 0 命中；删除 holdout 目录后 runner 退出码=2 而非 0；向仓内植入哨兵值后退出码=3。
- 难度：高。可直接复用为"agent 是否会泄题"的 meta-bench。

**C-10 `ohos-ts-coldcontext-review-findings`（冷上下文双臂评审的实bug发现率）**
- 输入：仓库固定在主轨迹评审时的 commit `146cb35`（含 5 处已知缺陷：CI grep 过滤器无效、`interop/regress.mjs` 文档承诺但不存在、handover bundle 名错、arkts-mirror.sh SCAN_ROOT 会触发 containment 自断、e136900 自报测试覆盖与实际不符）。
- 预期：无历史上下文的评审代理在限定时间内（轨迹中两代理约 10 分钟）独立复核 main HEAD，产出带证据（文件:行号 + 逐字模拟）的发现清单。
- 判分：召回率（5 处已知缺陷命中数）+ 精确率（误报数，重点看是否把 Mimosa 的 pattern 命中误判为真漏洞——轨迹中 mock-peerapi SQL 注入即误报样本）；发现必须附可复现验证（如对 grep 过滤器做字面模拟）。
- 难度：中高。可直接固化为回归 bench（golden findings 已知）。

## 5. 数据质量备注

1. **主轨迹尾部截断**：文件末行标注 `[达到预算上限，轨迹截断]`（1098 行附近，阶段 4d perf 脚本 rng 注入处中断），阶段 4e–6 的工具调用细节部分缺失，但后续 TEXT 叙事（如 11:47 收尾报告）覆盖了结果，叙事完整性可接受。
2. **事件顺序非严格时间序**：文件前 74 行是跨 36 小时的 task-notification/TodoWrite 提醒集中堆放，之后 724 行起又回到 10-02 00:10 的开局侦察——重放时不能按行号当时间线，须以每条 `@时间戳` 为准。
3. **工具输出普遍截断**：多数 Bash/Read 输出带 `…[截断]`（约 40% 的长输出），commit 哈希序列需从多个 TEXT 汇总交叉（1c9b85b/93c59f3/e136900/51b70c3/0962ada/146cb35/5c3db5e/fcaf962/90ed53e）。
4. **敏感信息残留于轨迹本身**：真实公网 IP（223.198.166.92/36.139.118.235/156.238.240.81）、代理地址（100.64.0.3:7864）、SSH key 指纹片段明文在轨迹中；token 处理谨慎（`sed 's/\(.{20}\).*/\1***/'` 只露前 20 字符 + `tok_len=40`），但若将轨迹转 bench 语料需二次脱敏。
5. **TodoWrite 系统提醒噪音**：主轨迹 20+ 条重复的系统提醒占据大量行数，分析时已过滤；子轨迹同样有 9 条。
6. **子轨迹完整且自洽**：560 parts 完整跑完（15:02→15:56），有明确交付摘要与终验输出（25绿+54红锚 0 意外 / holdout 23PASS+4BLOCKED），`git status --porcelain` 只 5 个新文件的证据在盘——是两条轨迹中数据质量最好的一条。
7. **不可复核项**：动态工作流内部子代理的逐条输出只在主轨迹以 GetWorkflowRun 摘要形式出现（"18 steps settled, 1 failed, 178,697,332 tokens"），子代理级细节需另查 dwfrun-d92a8909 的 journal（未在本轨迹内）。
