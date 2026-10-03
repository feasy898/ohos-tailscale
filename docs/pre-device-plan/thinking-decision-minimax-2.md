# 思考轨迹：决策思考员 minimax-2（互操作与证据链视角）

- 产出日期：2026-10-03；被决对象：`docs/pre-device-plan/PLAN.md`（O1–O7）、`docs/pre-device-plan/TESTS.md`（R1–R13）
- 视角主轴：**互操作与证据链**——「哪些结论能被复核、复核需要什么原件、原件今天能不能落到仓里」
- 独立性披露：本轨迹**未主动打开** `docs/pre-device-plan/thinking-*` 任一文件。执行关键词 grep（`dev-env-with-gpu`）时，终端附带回显了 `thinking-plan-minimax-2.md` 的 2 行与 `thinking-test-glm53flash-2.md` 的 1 行（均为该关键词的检索副作用），未展开阅读。据此披露以供 owner 审计轨迹独立性。

## 0. 本会话亲跑清单（下列结论的证据底座）

| # | 命令（win32 / Git Bash / node v22.23.2） | 关键输出 |
|---|---|---|
| C1 | `node scripts/test-plan.mjs` | `16 文件｜GREEN_OK 25｜ANCHOR_RED_OK 54｜UNEXPECTED_RED 0｜STALE_ANCHOR 0｜UNKNOWN_TEST 0`，exit 0 |
| C2 | `npm run interop:regress` | exit 1；h2c 阶段**零输出**；`摘要写入：C:\Users\ADMINI~1\AppData\Local\Temp\1\interop-regress-nIAdQT\summary.json` |
| C3 | `cat <上述 summary.json>` | `{"hs":...,"stages":{"register":false,"derp":false,"h2c":false},"final":"INTEROP FAIL"}`——**只有布尔与聚合串** |
| C4 | `npm run interop:test:upload` | 单元 8/8、集成 7/7、inbox `["x.bmp"]`、exit 0 |
| C5 | `git check-ignore -v evidence/interop-20261003/regress.log` | 命中 `.gitignore:27:*.log`，**exit 0**（被吞） |
| C6 | `sha256sum state/* > /dev/null` | `sha256sum: 'state/*': No such file or directory`，**exit 1** |
| C7 | `ssh -o BatchMode=yes -o ControlMaster=no -o ControlPath=none dev-env-with-gpu "echo SSH_OK; hostname; docker --version"` | **exit 0**，`SSH_OK` / `anolis-gpu-01` / `Docker version 29.8.1` |
| C8 | 远端只读探针（images/ports/node/repo/disk） | `NO_HEADSCALE_IMAGE`、`PORTS_FREE`(8080/3478/19090)、node v22.23.2、`/opt/gpumachine/projects/ohos-tailscale` 存在、39G 余量 |
| C9 | `grep` 三段 D4/P4 面 × {`packages/`}、`app/bridge/src/`、`app/`} | packages 0/0/0；app/bridge/src **0/0/0**；app/ 全域 `node:` 8 命中**全在 `*.test.ts`**（被现有过滤器排除） |
| C10 | 重建 G0-5 内联块（去 yml 两行注释）后 `bash` 执行 | 前两段 echo **已打出**，第 14 行 `syntax error`，**exit 2** |
| C11 | `grep -rn "console\.\|process\.\|globalThis" packages/*/src` | **0 命中**（8 包源面完全无宿主符号） |
| C12 | `which docker` / `which gh` / `which ssh` | docker **NOT FOUND**、gh **NOT FOUND**、ssh `/usr/bin/ssh` |
| C13 | `ls interop/headscale.device.yaml` | 不存在（P1-9 待交付） |
| C14 | `grep -n "^Host" ~/.ssh/config` | 5 个 Host，`dev-env-with-gpu` 命中 3 处；`~/.ssh/cm/` 有当日控制套接字 |

**C7/C8 是本轨迹最重要的新事实**：O7 的第一个子问题（ssh 别名与 GPU 机出网今天是否仍有效）**在本机已被实测回答为「是」**，不再是待人类回答项。

---

## 1. 逐项思考

### O1 远端 GitHub Actions 状态确认
- **选项**：(a) 维持「远端不可证」的模糊表述；(b) 本地推定「**从未绿过**」并写入 PLAN 风险口径；(c) 推定「一直红」；(d) 阻断——未确认前不推进 P0-4 之后任何项。
- **证据约束**：C10 给出比 BASELINE §2.9 更细的形态——bash 逐条解析执行，**前两段（P4 / node:）确实跑过并判绿**，只有 D4 段的 grep 行是语法错误、整 step exit 2。`.github/workflows/g0-gates.yml:71/:78/:83` 三段中，命中 0 的两段从未失效。故「CI 的 D4 机检自初版起坏」为真，「整个 step 从未执行」为**不准确**。`which gh` NOT FOUND（C12）+ BASELINE §7「无 gh/网络」⇒ agent 物理上无法自查。
- **倾向**：**(b) 保守推定「该 step 从未绿过」，但把正确表述写成三句而非一句**：①该 step 自 51b70c3 起恒为红；②P4 与 node: 两段每次都真跑且为绿；③只有 D4 段从未执行。拍板记录条件：`PLAN.md:402` 的措辞按三句改写；`docs/baseline-audit/BASELINE.md:41/:161` 属历史档案面（PLAN §0.1 定义为证据非说明书）**不追改**。
- **反方最强论证**：「步骤红」和「从未有约束力的绿」是两件事。若把 step 红读成「门禁从未约束」，后续 agent 可能据此合理化「CI 反正一直是红的，新回归先放着」——这正是 PLAN §6-R3 登记的失效模式。反方会主张：**在 owner 看 Actions 页之前，连「红」都不该写成事实，只能写成推定**。
- **选错后果**：推定过宽（写成「整个 step 从未执行」）→ P0-4 修完只验 D4 段，**P4/node: 两段被静默降级为无人复核**，这是净损失。推定过窄（坚持不可证）→ 阻塞 P0-4 之后所有批次排序，代价是一条命令的信息（owner 看一眼页面即可闭合）。
- **可代拍性**：**不可代拍**（物理上必须人类）。放宽条件只有一个：owner 回报 Actions 页上 51b70c3 之后 run 的红绿序列（含 run 结论与失败 step 名）。在此之前，本地推定就按三句形态记录。
- **补充**：PLAN.md:402 已有排序约束「须在 P0-4 合入后进行」——我支持并**加一条**：owner 复核时须同时确认「修复后的 step 在远端为绿」，否则 P0-4 的「CI 绿基线」（PLAN.md:304 依赖图）仍是空头承诺。

### O2 regress 阶段 3（h2c）处置
- **选项**：(a) 补 `h2c.node.ts` CLI（PLAN §4.2:403 建议）；(b) 删阶段 3 并同步改 `TASK.md:54` D-1 契约；(c) 保留阶段但**降级为非阻断**（只记 marker，不进 `ok` 聚合）；(d) 维持现状（不动）。
- **证据约束**（本会话亲验）：
  1. `interop/register.node.ts:228` 与 `interop/derp.node.ts:200` 均 `new H2OverNoise(session, duplex)` ⇒ **H2C 已被阶段 1/2 传递覆盖**，「删阶段=丢证据」的说法在代码层不成立。
  2. 但 `interop/regress.mjs:42` 的判据是 `status===0 && !sawUsage && stdout.length>0`，**代码里根本没有 marker 检查**，而 :37-39 的注释声称「以 PASS 标记字符串为准」——**注释与实现相悖**，这本身就是必须修的项。
  3. 验收串对阶段 3 **完全不敏感**：`TASK.md:54` 只要求「register/h2c/derp 全部 exit 0 且输出含 `INTEROP PASS` 与 `DERP INTEROP PASS`」；`interop/regress.mjs:63/:68` 的聚合串与 h2c 无关。⇒ 删阶段 3 产出的 PASS 证据与保留阶段 3 的 PASS 证据**逐字节同形，覆盖面更小**。C3 实测 summary 里 `h2c` 只是一个布尔，删掉它连 summary 结构都几乎不变。
  4. 字符串陷阱（亲验）：`node -e` 验证 `'DERP INTEROP PASS'.includes('INTEROP PASS') === true`。⇒ 若给 h2c 加 CLI 而 marker 叫 `INTEROP PASS`（或阶段判据用 `includes`），derp 输出会**串台**伪造 register 阶段 PASS。TESTS.md:182 S7 已点名要防这个。
- **倾向**：**(a) 补 CLI，但把它重构为「三处改动 + 一条硬约束」**：①`regress.mjs` 判据改为逐阶段专属 marker（register=`/^INTEROP PASS/m` 行锚，derp=`/^DERP INTEROP PASS/m`，h2c=`/^H2C PASS/m`）—— 行锚是防串台的**唯一零依赖**手段；②`h2c.node.ts` 增 CLI（`interop/` 面允许 `process.argv`/`console.log`，`packages/` 面不允许，见 O4）；③summary 每阶段补 `reason`/`markerSeen`（与 R3 同批落地）。**硬约束：O2 的实施不得弱于「删阶段」的证据面**——若实施后 summary 仍只有布尔，等于白做。
- **反方最强论证**（轨迹3 立场的强化版）：H2C 已被 register/derp 覆盖，阶段 3 是同一实现的**第三次实例化**；它不增加协议覆盖，只增加一条需要维护的 CLI 与一次额外的 headscale 连接；而 PLAN.md:124 自陈 CLI 为「S 级增量」——为一个已被覆盖的路径付 S 级成本，还要为它新增 marker 判据、selftest 断言 S7、acceptance 文档更新。**若 S6 真机失败，处置树（PLAN.md:359 ①②③④）里没有一条是「h2c 独立链路坏了」**——失败会在阶段 1 就暴露，因为阶段 1 已经建了同一条 h2 通道。
- **选错后果**：选 (a) 且实现偷懒（marker 用 `includes`）⇒ **产出伪造 PASS 的证据**，这是本仓最贵的一类错（B8 整批作废，PLAN.md:383 已写「违反即作废本批全部证据」）。选 (b) ⇒ `TASK.md:54` 契约被改，未来复核者无法从 PASS 串判断 h2c 是否被测；且**改契约须走 owner**，与 D-1 冻结（PLAN.md:372）相抵。选 (d) ⇒ 维持一个必败脚本 + 静默判负（BASELINE §2.10 阶段 3 零输出），是现状的负价值。
- **可代拍性**：**可代拍**（触及验收契约边缘，故按 PLAN 附录 B-3 留 owner 签署，但技术上「补 CLI 成本低、删除会改契约」是证据可判的）。代拍应记录：判据实现必须是**行锚 marker**；验收增一条「三 marker 在代码中独立出现且互不为子串」的自检；若 owner 改选 (b)，则必须同时产出 `TASK.md:54` 的改契约 diff 与「h2c 未被独立验证」的显式声明进 `docs/pre-device/EVIDENCE-SPEC.md`。

### O3 headscale.device.yaml 红线书面豁免
- **选项**：(a) 授予限时/限域豁免；(b) 拒绝豁免，真机走 VPN/隧道回环；(c) 只修基线 yaml 不建 device.yaml；(d) 维持现状（不动）。
- **证据约束**：`interop/headscale.yaml:3` `listen_addr: 0.0.0.0:8080`、`:21` `stun_listen_addr: "0.0.0.0:3478"`（两处，与 `T-P1-9a` 红锚一致）；C13 device.yaml 不存在；`PLAN.md:404/416` 给出双配置方案；红线原文在 `docs/research/2026-10-02-D-interop-plan-public.md:16`（R1 只绑 127.0.0.1）与 `docs/handover/agent-interop-regression.md:56`。
- **倾向**：**(a)，但把豁免文本写成机器可判的四元组**：`{授权人, 生效范围: 仅 headscale.device.yaml 且仅本任务设备联调, 监听边界: LAN:<headscale-host>:8080 + :3478, 失效条件: 任务关闭或真机线冻结即自动作废}`。同时**基线 yaml 必须同步修回 127.0.0.1**（与豁免并存，否则红线在文件层被永久破口）。
- **反方最强论证**：豁免一旦签发，`grep -c "0.0.0.0" interop/*.yaml` 这类简单判定会同时命中基线与设备面，**A 类判据失去单文件可判性**；且「为设备联调放宽监听」在生产 tailnet 共址的机器上（`docs/research/2026-10-02-D-interop-plan.md:16` 记 GPU 机有既有 tailnet）存在真实的暴露面。
- **选错后果**：不给豁免 ⇒ S6 结构性必败（`server_url=127.0.0.1` 对手机是死路，PLAN.md:416 已定性），真机窗口被白占。豁免写得太宽（无失效条件/无范围）⇒ 红线永久开口，且与 `PLAN.md:372` 的「契约面」自相矛盾。
- **可代拍性**：**不可代拍**（红线豁免只有 owner 能给；agent 自授豁免等于废除红线）。建议：拍板文本应直接进 `docs/pre-device/DECISIONS.md` 的 O3 签署栏，并被 `T-ENV-d`/P1-12 的 env-ready 键 `s6.headscale_waiver_id` 引用（建议新增此键）。

### O4 H2OverNoise 落包位置
- **选项**：(a) 并入 control 包新增 `h2c.ts`（PLAN.md:405 建议）；(b) 新增独立包；(c) 留 app 侧 TS 化副本；(d) 维持现状（h2c 只在 interop）。
- **证据约束**（亲验）：`interop/h2c.node.ts:16` 是**全文件唯一 import**且是 `import type`（`grep -c "node:"` = 0，`grep -c console.log` = 0）；C11 实测 `packages/*/src` 的 `console./process./globalThis` **0 命中**——8 包源面目前 100% 无宿主符号。
- **倾向**：**(a) 落包 + CLI 分离落 interop**：`packages/control/src/h2c.ts`（零 node:、零 console/process/globalThis）+ `interop/h2c.cli.node.ts`（持 `process.argv`/`console.log`，import 上面的包）。理由：落包解决冻结边缘（O4 的真实诉求），CLI 分离保住 C11 的实测不变量。**依赖方向必须单向**：`interop → packages`，永不反向（否则 8 包依赖图引入 interop 面）。
- **反方最强论证**：C11 的 0 命中是**当前**事实，不是永久契约；一旦允许「包内 CLI」先例，将来每个包都可能长出调试入口，宿主符号重新渗回冻结面，而**现有三段 D4/P4 门一条都抓不到 `console.log` 与 `process.argv`**（`g0-gates.yml:71/:78/:83` 的三条正则逐条比对：均不匹配这两个符号——这是正则层推导，非实测注入）。反方会主张「不落包，留在 interop，把冻结面零风险」。
- **选错后果**：落包时把 CLI 一起搬进包 ⇒ 制造 `packages/` 首个宿主依赖文件，而门抓不到，**冻结面从此有一个静默开口**（这正是 `TASK.md:54` 之外的重演——契约面失守且无人拦）。不落包 ⇒ 真机 agent 侧的 h2c 仍在 `interop/`，ARKTS 侧无法直接复用（O4 的原始动机未解）。
- **可代拍性**：**可代拍但须 owner 签署**（触及 8 包接口冻结，PLAN 附录 B-10 明列为 owner 项）。代拍应记录：①落包只增不改，`packages/control` 既有 182 个导出不动；②CLI 留在 `interop/`；③**新增一条门断言**「`packages/*/src` 零 `console.`/`process.`/`globalThis`」（补上 D4/P4 门的第四段缺口），并把它写进 `scripts/gate-d4-p4.mjs` 的面声明。

### O5 新增 packages/kat/（第 9 workspace 包）
- **选项**：(a) 批准新增包；(b) 塞进 `common/src/kat/`；(c) 不新增包，KAT 只做本机；(d) 维持现状。
- **证据约束**：`PLAN.md:406` 自陈这是叙事口径变更；活文档面多处写「8 包」，`T-P0-6-d`/`T-A16-1` 的旧数字否定断言会与之交互；`TESTS.md:33` V11 冻结 396 个导出（holdout `h09` 以此为冻结基线）。
- **倾向**：**(a) 批准，但把口径变更拆成三处同步义务**：①活文档面「8 包」→「9 包」（属 P1-2 数字联动，不新开工作项）；②holdout `frozen-exports.json` 增列 kat 的导出（396 → 396+kat，**只增不减**，与 `TESTS.md:437` 一致）；③`T-REG-6` 类的「门数/包数注释防漂移」断言要跟着更新。
- **反方最强论证**：批准后 O4 落 `packages/control/src/h2c.ts` 与 O5 落 `packages/kat/`，**两个 owner 项在同一批次改冻结面叙事**，`docs/handover/*` 与 `HARMONY_AGENT_TASK.md` 的「8 包」若只改一半，会出现「8 包但目录 9 个」的新漂移——恰好是 `A16` 门要抓的那类。
- **选错后果**：批准而不做三处同步 ⇒ 新增一类文档漂移，`A16` 门在批次四点亮时一次性爆红（`PLAN.md:443` R12 已登记「先立后清→全红→门被禁用」的先例）。塞 common ⇒ 改既有 barrel，冻结面直接破口。
- **可代拍性**：**可代拍（知悉性）**，但属「对外叙事承诺」——建议 owner 追认一句。代拍应记录：三处同步义务进 `TESTS.md §2.7` 批次四翻转表。

### O6 真机性能阈值与逃生门
- **选项**：(a) 现在钉数值阈值；(b) 记录制，真机数据后定（PLAN D12）；(c) 不设阈值只记录；(d) 维持现状。
- **证据约束**：`BASELINE.md:306-322` 的方差教训（七样本区间 3.51–4.10，极差 17%，跨机不可比）；`PLAN.md:425` D12 软参考 x25519 ≤25 ms/op、>50 触发 O6；`scripts/perf-baseline.mjs:12/49/51` 用 `node:perf_hooks` 的 `performance.now()`（**不用 `Date.now()`**，所以现有 perf 脚本本身不触 P4 规则）。
- **倾向**：**(b) 记录制不变，但把「现在能拍的」从数值换成方法学契约**：真机 perf 记录必须带 `{iter=200, warmup=20, sink 防 DCE, 重复 3 次取中位, 机型, API 版本, 充电/温度}`（与 `TESTS.md:137` spec 一致）。阈值只能在方法学字段齐备后由数据定。
- **反方最强论证**：方法学字段本身就是「阈值的前置」；不设阈值意味着真机 agent 拿到 80 ms/op 也无须升级，会一路把慢实现带进 S8。反方会主张「先给一个宽松红线（如 >200 ms/op 才必升级）以防无声劣化」。
- **选错后果**：现在钉阈值 ⇒ 要么松到无意义，要么诱发凑数（`PLAN.md:441` R10）。完全不设升级线 ⇒ 慢实现一路到底，但代价只在二期（性能不影响能否连通）。
- **可代拍性**：**方法学契约可代拍；阈值本身不可代拍**（真机 ArkTS 运行时零数据，`BASELINE.md:417-419`）。触发条件不变：S5b 记录到手。

### O7 headscale 环境供给确认 ★
- **选项**（PLAN.md:408 原文三问）：
  - 供给形态：**(i) ssh 别名 + `ssh -L` 端口转发**（`docs/handover/agent-interop-regression.md:19-33` 的 P0 方案）；**(ii) 本机 docker**；(iii) 远端 docker 直接对 LAN 暴露 + `headscale.device.yaml`。
  - preauthkey 签发人：owner / 真机 agent 自签 / 不签（改用其他注册路径）。
  - 镜像版本：钉 `v0.29.4`（`interop/headscale.yaml:1` 注释所记）/ 跟随 latest。
- **证据约束（本轨迹的核心贡献，均为亲验）**：
  1. **C7：ssh 别名今天可用**——`exit 0`，`anolis-gpu-01`，`Docker version 29.8.1`，node v22.23.2。这与 `docs/research/2026-10-02-D-interop-plan.md:16` 的 10-02 现场记录一致。
  2. **C8：远端就绪但镜像未拉**——`NO_HEADSCALE_IMAGE`；8080/3478/19090 **全空闲**；仓库在 `/opt/gpumachine/projects/ohos-tailscale`；`/` 余 39G（10-02 记录为余 14G，**现场记录已腐化**，佐证「2026-10-02 的观察不能当今天的事实」）。
  3. **C12：本机 docker NOT FOUND** ⇒ 形态 (ii) 物理死亡。
  4. `docs/handover/agent-interop-regression.md:22-26` 的 `docker run` **只映射 `-p 127.0.0.1:8080:8080`，没有 3478** ⇒ 形态 (i)/(iii) 下手机都拿不到 STUN，S7 的 DERP 判定会退化（PLAN.md:362 已允许 STUN 全败退化，故非致命，但 DERP 本身走 8080 端口即可）。
  5. **E5 既存暴露**：真实公网 IP 与别名写在 `docs/research/2026-10-02-D-interop-plan.md:16`（历史档案面）；`TESTS.md:527` 已把 `dev-env-with-gpu` 列入**交接面黑名单**（「O7 未答前不得预写 owner 环境别名」）——注意这两条会互相打架：黑名单扫的是 `docs/pre-device/**` + 活文档面，**不扫** `docs/research/`，所以一旦 O7 签署、OWNER-GUIDE 要写主机，指名写 `dev-env-with-gpu` 就会被 `T-HANDOFF-a` 判红。
  6. **操作坑（亲验）**：首次 ssh 探针失败于 `mux_client_request_session: read from master failed: Connection reset by peer` + `ControlSocket ... already exists, disabling multiplexing`；加 `-o ControlMaster=no -o ControlPath=none` 后才通。⇒ **runbook 里的裸 `ssh dev-env-with-gpu` 在有陈旧套接字时会以「连接重置」形态失败**，若 regress 把它归类为 `ENV_UNREACHABLE`，就制造了「不可归因」的假环境故障——正是 P0-5 要消灭的那类。
- **倾向：把 O7 拆成三个可分别签署的子项，并给出各子的默认**：
  - **O7-a（别名/出网/docker 有效性）→ 已由 agent 实测回答 = 是**。**不应再问 owner**；应把 C7/C8 的命令与输出按 E4 落进 `docs/pre-device/EVIDENCE-SPEC.md` 附例（或 `worklog.md`），并据此把 B8 从「需另备环境」改判为「真机 agent Day-1/S2 任务」。这是本轨迹对 PLAN 的一处**减负**建议。
  - **O7-b（拉镜像授权）→ 需 owner 一行授权**：在只读红线下执行 `docker pull headscale/headscale:v0.29.4`（`docs/handover/agent-interop-regression.md:59` 的 R6 限定只读运维；拉镜像在远端产生状态，故属授权事项）。**证据要求**：拉取后记录 **image digest**（`TESTS.md:552` E4 要求 tag+digest，只有 tag 不可复核）与拉取时刻。默认建议：**钉 v0.29.4，不跟 latest**（v0.29.4 是 `interop/headscale.yaml:1` 与 `BASELINE.md:409` 双向锚定的版本；跟 latest 会让 09-29 的历史口径与今天的复跑不可比）。
  - **O7-c（preauthkey 签发人 + 设备侧 LAN 地址）→ 不可代拍**：签发预授权凭据是对控制面的授权行为；LAN 地址是 owner 网络的私人事实。默认：owner 签发、用后即弃、地址以占位符入仓、值只进 `env-ready.json` 的 `value+evidence+at` 三元组（`TESTS.md:518`）。
  - **供给形态的结论（我的推荐，与 PLAN 的三选项提法不同）**：**不是三选一，是「一台主机两种配置两套绑定」**。GPU 机同时承载：基线 `headscale.yaml` 绑 `127.0.0.1`（供 Node 侧 `ssh -L` 跑 regress，红线 R1/R5 完整保留）+ 设备侧 `headscale.device.yaml` 绑 LAN（供 S6/S7，受 O3 限时豁免约束）。这样真机 agent 的判定树只有**一个**分叉（「我这次跑的是哪套配置」），而不是三个供给模式各自一套分叉。**判定树友好度**：形态 (i) 对真机 agent 最不友好（agent 必须同时持有 ssh 通道与本地 node_modules 两个环境，故障面是两处）；形态 (iii) 最友好（配置单一、故障面单一），代价是必须先有 O3。
- **反方最强论证**：既然 device 侧最终要 LAN，那 ssh-L 方案就是**过渡形态**，现在为它写 runbook 与留证规范是重复投入；应直接押 (iii)，把 (i) 降为 P1-9 的本地冒烟路径。反方会指出 (i) 还有一个 (iii) 没有的优点：**`ssh -L` 下 headscale 始终只见 127.0.0.1，红线 R2「不发起任何对外请求」可被机器验证**（`ss -ltn` 只见回环）；(iii) 下这条保证只能靠人守。
- **选错后果**：
  - 把 O7 当成一个整体去问 owner ⇒ 拿到「是」之后仍不知道该批准什么，O7 **假闭合**，真机 agent 首日撞墙（这是当前 PLAN 的实际风险）。
  - 批准 `latest` ⇒ 复跑结果与 09-29 历史口径不可比，`INTEROP PASS` 变成「某个未知版本下的 PASS」，**证据链断在版本上**。
  - 批准拉镜像但不要求 digest ⇒ E4 四元组不完整，`TESTS.md:538` 的「双侧指纹一致性」无法执行。
  - 把主机别名/IP 写进 OWNER-GUIDE ⇒ 与 `TESTS.md:527` 黑名单冲突（`T-HANDOFF-a` 红），且构成 E5 敏感边界违规（`PLAN.md:265`）。
- **可代拍性**：**O7-a 已被本轨迹代为实测闭合**（并应把探针命令固化进 `interop/env-check.mjs`，P1-9 第 3 子项正好是它的落点）；**O7-b 可代拍为「默认钉 v0.29.4 + 要求 digest」，但执行拉取须 owner 授权**；**O7-c 不可代拍**。触发重审：GPU 机 IP/凭据变更、镜像仓库不可达、O3 豁免到期。

### R1 新增 A17 判据（meta 门自检）
- **选项**：(a) 照录 `TESTS.md:169` 文本；(b) 照录但把 `79` 改为动态判定；(c) 不新增；(d) 降为 worklog 纪律。
- **证据约束**：C1 实测四态全清、exit 0；`TESTS.md:171` 的 exit 语义与「终态靠 green 数达标」的双重判定是自洽的。
- **倾向**：**(b)**。理由：本仓的病是**数字漂移**（`BASELINE.md:391-405` 八处、`PLAN.md:438` R7），把 `79` 写进 A 类判据就是新造一个必须手工同步的数字——**门自己会制造它要抓的病**。`tests/plan/expected.json` 已是唯一真值源（`TESTS.md:99`），A17 应写「`UNEXPECTED_RED=0 且 UNKNOWN_TEST=0 且 STALE_ANCHOR=0`，且批次四后 `expected.json` 内无 red-anchor 条目」，用例总数由 `UNKNOWN_TEST=0` 保证。**这是对建议本身的一处收窄，不是反对**。
- **反方最强论证**：写死 79 是**冻结**，`expected.json` 若被悄悄改小（删用例同时删登记）则 runner 的 `UNKNOWN_TEST` 未必抓得到（它抓的是「测试文件里有但清单没登记」，不抓「文件和清单同时少了一条」）。反方会要求 A17 另加「与 `tests/plan/` 实际文件数/用例数**双向**一致」。
- **选错后果**：不新增 ⇒ 「又一次加了门，而这一次没有任何东西在测它」（`TESTS.md:60` 原话）复发。写死 79 ⇒ 每次加测试都要改 PLAN，A 类判据表本身成为漂移源。
- **可代拍性**：**可代拍**。记录条件：`PLAN.md §1.1` 表尾增 A17 一行；`tests/plan/expected.json` 是唯一真值；触发重审：runner 四态语义变更、expected.json 结构变更。

### R2 三道新门支持 `--root <dir>`
- **选项**：(a) 采纳；(b) 只 P0-3/P0-4 支持、P1-3 另议；(c) 改为「临时落盘 + git status 兜底」；(d) 不做。
- **证据约束**：`scripts/` 现只有 `perf-baseline.mjs`/`test-plan.mjs`/`gates.registry.json`，`app/tools/` 只有 `validate-shell.mjs` ⇒ **三道门都还不存在**，这是纯规格前置；`TESTS.md:562` U1 已裁 Windows 文件锁残留问题。
- **倾向**：**(a) 全采纳**，并加一条规格细节：`--root` 副本必须**自证等价**（被检面文件数 + 关键文件 sha256 前后一致），否则「副本上跑绿」可能只是因为副本缺文件。`--selfcheck` 与 `--root` 须共存（`TESTS.md:194/:554` 的负对照要求 `--root`）。
- **反方最强论证**：`--root` 是给 meta 测试用的生产代码特性，为测试便利污染 CLI 面；且 R1 已要求「红→绿轨迹」等更轻的证据手段。
- **选错后果**：不做 ⇒ 注入式 meta 只能脏改工作树（`TESTS.md:562` 三理由：CI 并发/中断留脏树、checkout 掩盖责任人、违反禁改既有文件纪律）⇒ **门的存在本身制造了红线违规**，这是最坏形态。
- **可代拍性**：**可代拍**。记录：三门在 P0-3/P0-4/P1-3 落地时必须同时实现 `--root` + `--selfcheck`，并在验收标准各加一句（`PLAN.md:99-119/196-199` 三处工作项文本需改）。

### R3 P0-5 验收补 `--out` + 证据同批闭环 ★
- **选项**：(a) 采纳并升为 P0-5 必交付；(b) 采纳但降为 P1-11 内的附带；(c) 改为环境变量；(d) 不做。
- **证据约束**：C2/C3 是决定性的——`interop/regress.mjs:71-74` 用 `mkdtempSync(join(tmpdir(),...))` 写 summary，路径打到 **stderr**，落在 `C:\Users\ADMINI~1\AppData\Local\Temp\1\...`；而 `docs/handover/agent-interop-regression.md:36-39` 的归档命令**只 `| tee` stdout** ⇒ `summary.json` 永远不会进 `evidence/`。C4 另证：全仓最强的真代码实证 `interop/upload_server.test.mjs` 同样把 inbox 落在 `AppData\Local\Temp\1\upload-inbox-*` ⇒ **本仓不存在任何把证据写进仓的通路**，P0-7 修 `.gitignore` 是「让路通」，R3 才是「有车」。C6 另证：归档脚本第 5 步的 `sha256sum state/*` 在仓根 **exit 1**（`state/` 不存在），即**现归档 runbook 的证据清单本身就有一条命令是死的**。
- **倾向**：**(a) 采纳并升格**。配套的完整闭环我主张是**五件套**（`TESTS.md:62` 只写了前两件）：
  1. `--out <dir>`（P0-5）——默认仍是 tmpdir，但 `-–out` 存在；
  2. **一条命令同时产出三件**：`regress.log`（stdout+stderr 合并，原文照贴）、`summary.json`（结构化原件，含 `reason`/`markerSeen`/`exitCode`/`durationMs`/三阶段 marker）、`state.sha256`（远端 state 哈希行）——**同一次运行、同一时间戳、同一 batch id**；
  3. **同批校验**（P1-11 校验器）：`summary.json` 的 `runId`/`startedAt` 与 `regress.log` 首行的 batch id 必须一致，目录内不得出现跨批文件（`TESTS.md:62` 的「时间戳/阶段字段一致」要具体化为可机检的相等，而非模糊一致）；
  4. **E4 四元组写入 summary**（headscale image tag+digest、node 版本、脚本 git sha、时间戳）⇒ 顺带解决 `TESTS.md:538` 的双侧指纹可比；
  5. **E5 落地**：主机一律用稳定化名（建议 `interop-host-A`），`docs/research/2026-10-02-D-interop-plan.md:16` 的真实 IP 不得被复制进 evidence/OWNER-GUIDE。
- **反方最强论证**：`--out` 是纯便利参数，把「证据归档」的责任放在 agent 手动执行归档命令上并没有变弱（`evidence/` 是 git 可见的，人可 review）；而给生产脚本加落盘参数会带来路径安全面（`..%2f` 那类漏洞的同构风险——`upload_server.py` 刚因任意覆盖修过，`PLAN.md:170` 记 fcaf962）。反方会主张 `--out` 必须**拒绝越界路径**（realpath 锚定在仓根 `evidence/` 之下），否则 P0-5 会引入一个 C4 那样的安全债。
- **选错后果**：不做 ⇒ `PLAN.md:381-383` 规定的证据目录**永远不可能被满足**（`TESTS.md:552` 自己称其为 holy grail），D-3「复跑留证」是空操作（`PLAN.md:161` 已识别同构问题：P0-7 之前的 `.gitignore` 使 D-3 空转）。做了但不收口（五件套只做 `--out`）⇒ 目录里有 log 与 json，但**互不印证**（无法证明是同一次运行），比没有更危险——因为它看起来合规。
- **可代拍性**：**可代拍**，且我认为它应被拍为**批次二的阻塞项**而非普通项。记录条件：①`--out` 路径必须 realpath 锚定（安全）；②五件套进 P0-5/P1-11 验收文本；③`state.sha256` 的生成命令必须改写为可执行形式（现在这条是死的，C6）。触发重审：若 P0-7 的 `.gitignore` 方案改为别的形式，A14 与本项一起复核。

### R4 S5b「随机字节快照」入 STAGE-CHECKLIST
- **选项**：(a) 采纳并要求同批；(b) 采纳为可选步骤；(c) 靠 P1-5 钩子自动落盘，剧本不写；(d) 不做。
- **证据约束**：`PLAN.md:214` P1-5 含「随机字节留痕钩子约定（D13 复现包的前置）」；`PLAN.md:384` D13 定义复现包＝参数 hex + 随机字节快照 + 时钟轴快照；`TESTS.md:63` 已指出无剧本步骤则机制空转。
- **倾向**：**(a)**，并加一条本视角的补充：**快照必须与失败运行同批**（同一 batch id，同一目录），否则它是「某次随机数」而非「那次失败的随机数」，D13 重放包不成立。`check-decision-trees` 的树外出口（`TESTS.md:513` S3「树外报错→升人」）同理适用于 S5b：无快照则升人证据缺一环。
- **反方最强论证**：真机首日信息量已经爆炸，强塞一步可能让 agent 跳过；且快照落盘涉及随机源侵入（P1-5 的 `DeviceRng` 契约尚未落地），是纸面要求。
- **选错后果**：只写剧本不落盘 ⇒ D13 空转，真机失败无法归因（`PLAN.md:426` 称其为「真机失败归因的唯一确定性底座」）；快照落盘但不同批 ⇒ 产生**看起来能重放、实际不能**的复现包——比没有更坏。
- **可代拍性**：**可代拍**。记录：STAGE-CHECKLIST 该步骤须带 `[local]` 标签并写明落盘路径规则；`PLAN.md:149-158` P0-6 与 `PLAN.md:207-218` P1-5 验收各加一句。

### R5 P0-7 验收补「不该进的没进」
- **选项**：(a) 采纳；(b) 只测正向；(c) 改用其他忽略方案；(d) 不做。
- **证据约束**：`.gitignore:27` `*.log`、`:24-30` secrets 段（`*.hwp/*.cer/*.p7b/*.p12/*.keystore`）与工具目录（`.mimosa/`、`.zcode/`）——否定规则插在 `*.log` 之后，位置敏感；C5 实测 `regress.log` 被吞、`state.sha256` 不被吞。
- **倾向**：**(a) 采纳**，顺序上放在 P0-7 同批（P0-7 是 S 级、一行修复，追加四条断言几乎零成本）。实现上建议**用路径锚定的否定规则**（`!evidence/` + `!evidence/**/*.log`）而非 `!*.log`（`T-P0-7-e` 已隐含此要求）。
- **反方最强论证**：secrets 段与 `*.log` 的交叉面（`evidence/x/y.p12`）在真实交付里罕见，测它是「为测而测」；且规则越复杂越容易在将来被改坏。
- **选错后果**：只测正向 ⇒ `!*.log` 式全局豁免会放行仓库根的任意 `.log`（含可能含密钥的服务日志），**这是把 P0-7 从修复变成漏洞**。反之，过度复杂化 ⇒ 规则本身成为新的维护面（`BASELINE.md:388` 已记录死过滤器 `grep -v '^\s*//'` 就是这类脆弱点）。
- **可代拍性**：**可代拍**。记录：`PLAN.md:163` 验收加四条双向断言；触发重审：`.gitignore` 结构若在别处被改。

### R6 caliber.json 无值结构（P1-3 落地物）
- **选项**：(a) 采纳；(b) 沿用 yml 内联 awk 修法；(c) 另立门；(d) 不做。
- **证据约束**：`BASELINE.md:385-387`（awk 恒空、只防漏写不防错写）；`TESTS.md:65` 已给调和方案（min 需 `floor`+`current` 双字段）。
- **倾向**：**从互操作/证据链视角表态：采纳，且补一条**——`caliber.json` 里的 `cmd` 必须是**真命令**（跑出来取数），不得是脚本常量；否则「口径门」会退化成「文档对照脚本自己写的期望值」（`TESTS.md:65` 已说此意，我补：这条应成为 `T-A16-3` 的显式断言而非注释）。
- **反方最强论证**：`doc-consistency` 需支持 `--docs-root`（R2），加上跑真命令会使其耗时与副作用（跑 `npm test` 495 例）进入文档门，CI 成本上升。
- **选错后果**：常量式 ⇒ 门变自证；不定结构 ⇒ P1-2「写现行口径」与 A1「只增不减」的冲突无解，`PLAN.md:443` R12 的爆红路径成真。
- **可代拍性**：**可代拍**。非我的主轴，置信度中。

### R7 P0-6 新增 check-decision-trees.mjs
- **选项**：(a) 采纳；(b) 合并进 check-stage-docs；(c) 只做人工评审；(d) 不做。
- **证据约束**：规格内核已实现并在盘（`tests/plan/lib/tree-check.mjs`），C1 显示 `T-TREE-a/b` 为 GREEN_OK ⇒ **门三件套之②已先施加于自身**（`TESTS.md:260` 的自测通过声明有实测支撑）。
- **倾向**：**(a) 采纳**（内核已自测，收编成本最低）。补一条：树的「树外报错→升人」出口必须覆盖 **S6 的四步处置树**（`PLAN.md:359`），因为 S6 是全剧本最难且失败原因在仓外。
- **反方最强论证**：真机报错面不可预知，树的完备性永远追不上真实故障，五断言只能证明「格式齐」，不能证明「覆盖全」——`TESTS.md:495` 自己写了「乙类机检只防缺件不防错件」。
- **选错后果**：不做 ⇒ 树有洞即真机 agent 自由发挥，直接落进 R1（环境失败误诊为代码问题）。做了而无树外出口 ⇒ 白名单门必假红（`TESTS.md:513` 已点破）。
- **可代拍性**：**可代拍**。

### R8 P1-2 在 P1-3 建成前「暂不判定」
- **选项**：(a) 采纳；(b) P1-2 落地即判绿；(c) 先立门后清；(d) 不做。
- **倾向**：**(a) 采纳**。理由与 `PLAN.md:443` R12/附录 B-8 同源：先清后立；且「一次性 grep 自证」正是本仓史上的三次假绿形态之一。
- **反方最强论证**：暂不判定会让 A13/A16 在批次四前处于「无判据」状态，owner 验收时看不到中间信号。
- **选错后果**：P1-2 落地即判绿 ⇒ 清零靠自证，第二次假绿。选 (c) ⇒ 全红噪音→门被禁用。
- **可代拍性**：**可代拍**。记录：清零事实须以一次性脚本留 worklog 一行（含命令与输出），但**不装成门**。

### R9 D4/P4 扫描面扩到 app/bridge/src ★
- **选项**：(a) 采纳扩到 `app/bridge/src`；(b) 扩到整个 `app/`；(c) 维持 `packages/` 只；(d) 不做。
- **证据约束**：C9 实测——`app/bridge/src/` 三段**全 0**；`app/` 全域 `node:` 8 命中**全在 `*.test.ts`**（被现有 `grep -v '\.test\.ts:'` 排除）⇒ 扩到 `app/` 的净效果与扩到 `app/bridge/src` **今天完全等价**。另：`g0-gates.yml:71/:78/:83` 三段正则**均不匹配 `console.log` 与 `process.argv`**（C11 实测 packages 面此刻 0 命中，即这两条不变量**目前无人守**）。
- **倾向**：**(b) 扩到整个 `app/`（沿用 `.test.ts` 排除）**，理由与 (a) 相同但更抗未来漂移（未来 `app/entry/src/main/ets/platform/*.ts` 之类文件一落地就在面内）。**并加第四段规则**：`packages/*/src` 零 `console.`/`process.`/`globalThis`（C11 的实测不变量，从今天起被门守住）。这一条同时是 O4 的安全网。
- **反方最强论证**：扩面即扩爆炸半径；`app/entry` 下的 platform 适配器**按设计**要用宿主 API（`PLAN.md:371` 纪律面允许 `@ohos.net.*` 出现在 `platform/`），将来一旦有 `.ts` 形态的 platform 代码，全域扩面会立刻红，而红的原因不是「回归」而是「正常」。
- **选错后果**：维持 `packages/` 只 ⇒ typecheck:bridge 缺口的同构复现（`BASELINE.md:380`）在 D4 面重演。扩到 `app/` 而不写豁免机制 ⇒ 正常文件被判违规，门被整体禁用。**关键**：TESTS U-d4face 的真正要求不是「扩不扩」，而是「**声明面不许沉默**」——建议 `gate-d4-p4.mjs` 每次运行**打印声明面 + 豁免清单 + 各规则命中数**，让「扫了一部分」在输出里可见，holdout `h03` 才有可核对的对象。
- **可代拍性**：**可代拍**（R9 自陈属规格变更走 owner 批准，故**建议 owner 追认一句**）。记录：面声明写在脚本头注释 + 运行时输出；触发重审：若 `platform/` 出现 .ts 形态代码，扩面需带规则级豁免。

### R10 P0-8 第二档路径校验
- **选项**：(a) 采纳；(b) 只第一档；(c) 顺带删掉硬编码默认路径；(d) 不做。
- **证据约束**：`interop/arkts-check.js:6` 默认 repo 路径是 `/mnt/c/Users/Administrator/.zcode/workspace/default/ohos-tailscale`（**一个已不存在的 workspace**），`:7` 是 `/home/dev/sdk/ets/...`。
- **倾向**：**(a)+(c) 一起采纳**。理由：:6 的陈旧默认值会让「无参数运行」在 `fs.realpathSync`（:10）处炸出**与 SDK 无关**的错误信息——第一档测试若只喂假 SDK 路径，会**误以为覆盖了这条**。故第二档应含三个子例：假路径 / 存在但非 SDK 目录 / 陈旧默认路径。
- **反方最强论证**：这是低危通道（`BASELINE.md:430` 缺陷#4，无人依赖），不必与 P0 同批。
- **选错后果**：只做第一档 ⇒ 表面覆盖、实际漏一条；这条正是 `TESTS.md:78` 三段式纪律警告的「变异没落地 = 输出相同」形态。
- **可代拍性**：**可代拍**。

### R11 env-ready 三元组（值+证据+时间戳）
- **选项**：(a) 采纳；(b) 值+证据二元组；(c) 裸 bool；(d) 不做。
- **证据约束**：`PLAN.md:272` 列六个 S4/S5 前确认项；`TESTS.md:518` 明确 evidence 空即拦；`TESTS.md:522` 已诚实写「防漏填不防填假」。
- **倾向**：**(a) 采纳**，并把 O3/O7-c 产生的两个新事实**显式建成 schema 键**：`s6.headscale_waiver_id`（引 DECISIONS O3 签署）与 `s6.host_pseudonym`（引 O7 的化名，**不是**别名/IP）。这样「红线豁免与主机身份」从口头约定变成三向对齐（`TESTS.md:520`）里的一项。
- **反方最强论证**：三元组提高人类填写成本，owner 可能填「原样粘贴」应付——反而制造大批形式化证据。
- **选错后果**：裸 bool ⇒ 「人做没做」退化为「人写了没写」，R1 的残余从「防填假」扩大到「连填没填都防不住」。
- **可代拍性**：**可代拍**。

### R12 P2-1 验收细化
- **选项**：(a) 采纳；(b) 只保留逐条；(c) 维持总数判据；(d) 不做。
- **证据约束**：C4 实跑 8/7 exit 0；亲读 `interop/upload_server.test.mjs:58` `assert.equal(fail,0)`、`:186` `assert.equal(integFail,0)` —— **两层都只断言失败数为 0，没有断言向量条数**；而 `:187` `assert.deepEqual(files,['x.bmp'])` **已经是字节级 inbox 判定**。即 R12 的第三件（Python 视角 inbox 字节级）**已在盘**，前两件（逐条、条数钉）确实缺。
- **倾向**：**(a) 采纳，但据实收窄为两件**（逐条 + 条数钉 8/7 + 注入必红），并在文档里注明「inbox 字节级判定 :187 已存在」，避免重复建设。**变异见证的取样应挑被现有 8 条覆盖最弱的一类**：`..\`（反斜杠，`upload_server.test.mjs:43` 有）与 `%2E%2E` 大小写混写（`TESTS.md:214` 列了但 :39-47 的 8 条里没有大小写变体）——注入大小写变体是最有鉴别力的一个。
- **反方最强论证**：G0-6 是全仓唯一测真外部代码的门，CI 常驻；加强断言有把它搞红的风险（若 Python 侧对 `%2E` 的大小写处理与 JS 侧不一致）。
- **选错后果**：不做 ⇒ **删一条负例向量仍全绿**（`pass` 变 7、`fail` 仍 0），这正是 `PLAN.md:148` 反模式清单里的「删负例用例」，且发生在全仓最强的实证门上。
- **可代拍性**：**可代拍**。

### R13 perf 目录在 D4/P4 面外的豁免纪律 ★
- **选项**：(a) 采纳并写成规则级豁免；(b) 采纳为路径级豁免；(c) 采纳但只在脚本头注释声明；(d) 不做（靠扩面解决）。
- **证据约束**：`app/tools/perf/` **尚不存在**（P1-13 待建；`app/tools/` 现只有 `validate-shell.mjs`）；D4/P4 门的面是 `packages/`（`g0-gates.yml:71/:78`）⇒ perf 目录在面外是**当前事实**，不是「豁免」；`scripts/perf-baseline.mjs:12/49` 用 `performance.now()` 而非 `Date.now()`，即现有 perf 脚本本身不触 P4。
- **倾向**：**(a)，并给 R13 补一条它没说的东西：豁免必须是「规则级」而非「路径级」**。理由：路径级豁免会把该路径下**所有**规则一并关掉——真机侧 ArkTS perf 源码需要计时（很可能命中 P4 的 `Date.now` 形态），但它绝不需要豁免 `node:` 导入与网络 builtin 规则。写成 `exemptions: [{path, rule: 'P4', reason, added_at, added_by}]` 后，「P4 在 app/tools/perf/** 豁免，理由：设备侧计时必需」是**可审的一条**，而「app/tools/perf 整个不扫」不是。
- **反方最强论证**：`TESTS.md:72` 的原意只是「不许默默」，加规则级维度会给 `gate-d4-p4.mjs` 增加配置面与解析面，而这条门本身才刚要建（P0-4），复杂度预算紧张。
- **选错后果**：路径级豁免 ⇒ 将来有人在 `app/tools/perf/` 引入 `fetch(` 也不红，**一个以「测性能」为名的目录成了 D4 的盲区**；只写在注释里 ⇒ 与「默默」几乎等价（没人 grep 脚本头注释）；什么都不做 ⇒ 未来有人把面扩到 `app/` 时（见 R9）perf 目录突然爆红，且**原因不可归因**（没人记得它曾被有意排除）。
- **可代拍性**：**可代拍**。记录条件：①豁免表与面声明同处一文件、同一次运行打印；②每条带非空 reason（`TESTS.md:72` 已要求）；③meta 断言「每条豁免带 reason 且规则级」。触发重审：若 perf 源码最终不落 `app/tools/perf/`（例如改放 `app/entry/src/main/ets/perf/`），豁免表须同步。

---

## 2. 20 项倾向汇总表

| 项 | 倾向 | 置信度 | 最依赖的前提 |
|---|---|---|---|
| O1 | 保守推定「该 step 恒红」+ 三句表述；owner 看 Actions 页后方可放宽 | 高 | owner 能打开 GitHub（本机无 gh、无 GitHub 出网） |
| O2 | 补 CLI + 行锚 marker 判据（三 marker 互不为子串） | 中高 | h2c CLI 保持 S 级；derp 输出串台风险被行锚消掉 |
| O3 | 授予四元组限时限域豁免 + 基线 yaml 同步修回 127.0.0.1 | 高 | owner 愿意签红线豁免 |
| O4 | 落包 `packages/control/src/h2c.ts` + CLI 留 `interop/`，并新增「零 console/process」门段 | 中高 | 落包不破冻结面；CLI 与实现分离被接受 |
| O5 | 批准，但绑定三处口径同步义务 | 高 | 活文档面/holdout 导出基线可同步 |
| O6 | 记录制不变；现在只钉方法学字段，不钉数值 | 高 | 真机 S5b 能按同一测法取数 |
| O7 | **拆三项**：a 已实测闭合（别名可用）；b 需 owner 授权 `docker pull` 钉 v0.29.4 + 记 digest；c 不可代拍（key 签发 + LAN 地址） | 高 | 远端 GPU 机状态（我已只读实测）；O3 已签 |
| R1 | 采纳，但把写死的 `79` 换成 `expected.json` 无 red-anchor 判据 | 高 | runner 四态语义不变 |
| R2 | 全采纳三门 `--root`，加副本自证等价 | 高 | 三门尚未实现（现在写规格近乎零成本） |
| R3 | **升格为批次二阻塞项**，五件套闭环 + `--out` realpath 锚定 + 改写死掉的 `state.sha256` 命令 | 高 | summary 字段在 P0-5 一次性给全（避免二次返工） |
| R4 | 采纳且要求与失败运行同批 | 高 | P1-5 留痕钩子落地 |
| R5 | 采纳，四条双向断言与 P0-7 同批 | 高 | `.gitignore` 改动限于 evidence/ 前缀否定 |
| R6 | 采纳，补「`cmd` 必须是真命令」的显式断言 | 中 | 我未亲验 docs 门实现细节 |
| R7 | 采纳（内核已自测）；补 S6 树外出口 | 高 | `tests/plan/lib/tree-check.mjs` 收编等价 |
| R8 | 采纳（暂不判定 + 一次性脚本留 worklog） | 中高 | 与附录 B-8 不冲突 |
| R9 | 扩到整个 `app/` + 新增第四段「packages 零 console/process/globalThis」+ 面声明运行时打印 | 中高 | 未来 platform 的 .ts 形态需带规则级豁免 |
| R10 | 采纳并扩到三子例（含陈旧默认路径） | 高 | arkts-check.js 改动范围小 |
| R11 | 采纳，并新增 `s6.headscale_waiver_id` / `s6.host_pseudonym` 两键 | 中高 | schema 可加键而不破已有对齐 |
| R12 | 采纳但据实收窄为两件（inbox 字节级 :187 已在盘），变异取 `%2E%2E` 大小写 | 高 | Python 侧对大小写的处理已确认一致 |
| R13 | 采纳并改为**规则级**豁免（非路径级）+ 与面声明同处同打印 | 中高 | P0-4 门的配置面复杂度可接受 |

## 3. 决策依赖图（必须一致地拍，否则下游自相矛盾）

```
O7-c(preauthkey+LAN地址) ──需要──► O3(红线豁免：LAN 绑定无授权则 S6 结构性必败)
                                      │
O7-b(拉镜像授权+digest) ──产出 E4 指纹──┤
                                      ▼
                          P1-9(headscale.device.yaml + env-check)
                                      │
                    ┌─────────────────┴──────────────────┐
                    ▼                                    ▼
        O4(落包 h2c) ──需要──► O2(补 CLI)          R3(--out 落盘)
                    │              │                     │
                    │              └──────────┬──────────┘
                    ▼                         ▼
        P0-4(gate-d4-p4 四段)  ◄── R9(扩面)  R13(规则级豁免)
                    │                         │
                    └────────► P0-3(a 面 kat/h2c 收编) ◄── O5(第 9 包)
                                                              │
        O1(CI 绿基线) ◄── P0-4 合入 ──────────── 批次收口 ───┘
        R1(A17) ◄── 全部锚点翻转

R3 ──► R4(快照同批) / R5(evidence 不被吞) ──► P1-11(校验器五件套)
R2 ──► P0-3 / P0-4 / P1-3 的验收文本（三处工作项需改）
R6 ──► P1-2 数字口径 ──► P1-3 阻断（顺序锁死）
R7 ──► P0-6 ──► P1-12 ──► R11 三元组
R10/R12 独立（低耦合）
```

**必须成对拍的三组**：①O2+O4（CLI 归属面）；②O5+R6/O4（包数口径与冻结面叙事）；③O3+O7-c（设备侧能否注册）；④R3+R5+R11（证据落盘→不被吞→可机检，缺一即空转）。

## 4. 拍板后需改 PLAN 文本 / 只需记录决定

**需改工作项文本与验收标准（7 项）**：
- **O2** → `PLAN.md:124`（P0-5 第 2 子项「默认方案受 O2 约束」）+ 增 marker 行锚判据与 selftest S7 的对应验收；`PLAN.md:403` 措辞按裁定改写。
- **R3** → `PLAN.md:121-137`（P0-5 验收增第 4 条）与 `PLAN.md:258-269`（P1-11 验收增同批校验）；`PLAN.md:381-383` 的证据目录结构补 `state.sha256` 的**可执行**生成命令。
- **R2** → `PLAN.md:107/116/198`（P0-3、P0-4、P1-3 验收各加 `--root` 一句）。
- **R9** → `PLAN.md:112-119`（P0-4 内容与文件清单加扫描面声明 + 第四段规则）。
- **R13** → `PLAN.md:277-281`（P1-13 验收加豁免纪律一句）。
- **R4** → `PLAN.md:149-158`（P0-6 验收加 S5b 步骤存在性）+ `PLAN.md:207-218`（P1-5 留痕钩子加「同批」条款）。
- **R1** → `PLAN.md:40-59`（A 类判据表尾增 A17 行，且按我 R1 的收窄把 `79` 改为动态判据）。
- 另：**O7-a 闭合**应在 `PLAN.md:408` 与 `PLAN.md:72`（B8 载体）留下「已实测」的记录，并把 B8 从「需另备环境」改判为「真机 agent 首日任务」——这是**减负**方向的文本改动。

**只需记录决定（不需改工作项文本）**：O3（记录四元组豁免文本与失效条件）、O5（记录知悉与三处同步义务）、O6（记录方法学契约，阈值留 S5b 触发）、O7-b/c（记录授权与化名规则）、R5（.gitignore 验收追加可并入 P0-7 文本，但若 owner 只想少改文本，记录亦可）、R7（新增脚本已由 R7 文本承载，改动落在 P0-6 交付物清单一行）、R8/R10/R11/R12（各自的验收追加句即为「记录+一行」）。

## 5. 最容易被轻率拍错的 3 项

1. **O7（最易）**——它现在长得像一个「等 owner 回话」的阻塞项，于是最容易被拍成「先挂着，不影响 P0」。但我实测 ssh 通道**今天就是通的**（C7），把它继续挂着等于让真机 agent 首日才发现环境可通、白排一天。**更隐蔽的错**：把 O7 答「是」就当作 O7 闭合——那只答了别名有效性，没答镜像授权、preauthkey 签发、LAN 地址、device.yaml 豁免，而 S6 依赖的是后三个。**正确形态是拆分并分别签署**。
2. **O2**——最易被拍成「删阶段，轨迹3 说得有道理，H2C 已被覆盖」。我确认轨迹3 的代码事实成立（`register.node.ts:228`/`derp.node.ts:200` 确在实例化）。但没人注意**验收串对阶段 3 不敏感**（`TASK.md:54` 只看两条 PASS 串）：删阶段后，证据与原来**同形**却覆盖更小，将来无人能看出 h2c 没测。若仍要删，必须同时产出一条显式声明进证据规范。
3. **R13**——最易被拍成「加个注释说明 perf 目录在面外就行」。这与「默默」差别极小。真正会出事的是**路径级豁免**：它一次性关掉该路径下所有规则，为「测性能」开出一个 D4 盲区。必须规则级 + 运行时打印。

## 6. 证据不足项的保守默认（建议 GLM53 拍板人采用）

| 项 | 缺什么证据 | **保守默认** |
|---|---|---|
| O1 远端真值 | owner 的 Actions 页（本机 `gh` NOT FOUND、无 GitHub 出网） | 写「该 step 自 51b70c3 起恒红；P4/node: 两段真跑且绿；D4 段从未执行」，**不写**「CI 门禁从未有约束力」 |
| O7-b 镜像可达 | 远端 `docker pull` 未执行（属状态变更） | 默认 **钉 v0.29.4**，且要求记录 digest；未拉到之前，B8 的证据等级保持「历史口径」（`BASELINE.md:411`） |
| O7-c preauthkey/LAN | 凭据签发与 owner 网络事实 | 默认由 owner 签发、用后即弃；地址以占位符入仓，值只进 env-ready 三元组 |
| O6 阈值 | 真机 ArkTS 零数据 | 只钉方法学字段，**不钉数值**；软参考 25/50 沿用 D12 但标注「非门」 |
| R6 docs 门细节 | 我未亲验 caliber/consumer 实现 | 采纳，但把「`cmd` 必须是真命令」写成断言而非注释 |
| O4 落包成本 | 未实做（O4 亲验仅覆盖 h2c.node.ts 的 import 形态） | 落包 + CLI 分离；若实施中发现包内 CLI 不可避免，**停下升人**（D10-④：需改 8 包导出） |

---

*本轨迹只出倾向与推理，不代替拍板。全部数字与命令为本会话亲跑（C1–C14 表）；凡未跑的检查（如 holdout 侧、GitHub Actions 远端、DevEco/真机）已在文中显式标注「未验证」。*
