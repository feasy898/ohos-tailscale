# 测试设计思考轨迹 · holdout 原则与反过拟合（思考员 minimax-1）

> 视角主轴：**holdout 机制的设计原则与反过拟合**。读者是稍后撰写正式测试文档的合并人（GLM53）。
> 本文件是**思考过程**，不是测试文档。禁止后续 agent 引用本文件实现——它一旦进入开发 agent 的上下文，holdout 即失效（见 §7）。
> 输入：`docs/pre-device-plan/PLAN.md`、`docs/baseline-audit/BASELINE.md`。我**未读**同目录五份 `thinking-plan-*`（保持测试视角独立）。

---

## 0. 元信息与我在本会话做过的实测

规划基准 git `90ed53e`（`git rev-parse --short HEAD` → `90ed53e`）。本会话实际跑过的命令与结果：

| 命令 | 输出要点 | 用途 |
|---|---|---|
| `npm test` | `# tests 495 / # pass 495 / # fail 0` | 基线绿；**逐条输出 `ok N - <中文名>`**（实测 495 条）→ 测试名清单冻结的可行性依据（§3-M3） |
| `npm run validate:shell` | `summary: 66 passed, 0 failed`，exit 0 | 基线绿 |
| `sed -n '69,87p' .github/workflows/g0-gates.yml \| bash` | `line 15: syntax error near unexpected token '('`，`G0_5_VERBATIM_EXIT=2` | 复现 BASELINE §2.9；P0-4 的可见负对照有真实前提 |
| `git check-ignore -v evidence/interop-20261003/regress.log` | `.gitignore:27:*.log`，exit 0（被忽略） | 复现 P0-7 前提；`evidence/interop-X/state.sha256` exit 1（未被忽略） |
| `node -e "globSync('packages/**/*.test.ts')"` | 匹配 **49** 个文件 | 仓根新目录不被 `npm test` glob 捞到（§6）；`packages/kat/**` 会**自动**纳入 |
| `node --test <绝对路径>/x.test.mjs`（文件在 `D:/new-workspace/_holdout_probe/`，cwd=仓内） | `# pass 1 / # fail 0`，exit 0 | **仓外 holdout 可跑**（§7-C） |
| 同上，文件内 `import { ByteReader } from 'file:///D:/…/packages/common/src/index.ts'` | `# pass 1 / # fail 0` | **仓外 holdout 只依赖生产代码、绝对 URL 导入**成立（§2.2） |
| `node --test probeholdout`（裸目录参数） | `Cannot find module 'D:\…\probeholdout'`，`# fail 1` | **本环境 `--test` 裸目录模式不可用，必须用 glob**（§6.3） |
| `node --test "probeholdout/**/*.test.mjs"`（glob） | `ok 1`，exit 0 | holdout runner 的正确调用形态 |
| 逐包导入 barrel 统计导出数 | common 21 / crypto 26 / noise 16 / wireguard 39 / disco 45 / derp 15 / control 182 / netcheck 52 = **396** | 导出面冻结快照的基线来源（§3-M10） |
| `git branch -a` / `git remote -v` | 分支 main + `remotes/origin/main` + `remotes/seed/main`；`seed` = 本地裸库 `D:/new-workspace/_clone-tmp/afp.git`（HEAD `dc8d6ec` ≠ 本地 `90ed53e`） | **分支隔离在本仓不构成屏障**（§7-B） |
| `git status --porcelain --untracked-files=all` | 未跟踪目录逐文件列出 | 未忽略的隐藏目录**藏不住**（§7-A） |
| `ls .git/hooks/` | 仅 `*.sample`，无生效钩子；`core.hooksPath` 未设 | 不能依赖 git 钩子做防篡改（§7-D） |
| `grep -rn "Date.now\|Math.random\|from 'node:" app/bridge/src/*.ts` | 无命中 | D4 门现只扫 `packages/`（yml:71/78/84），扩到 `app/bridge/src` 当前是 0 命中基线（§5-P0-4） |
| `grep -c "process.argv" interop/h2c.node.ts` | `0` | P0-5 缺陷 3 的现状 |
| `npx tsc --noEmit -p . --listFiles \| grep -c "interop/"` | `0` | A12 现状 0，P1-8 待建 |
| `grep -rn "oracle/raw" <活文档面>` | `DELIVERY_REPORT.md:151` 等多处命中 | A13 待清 |
| `which gpg / openssl`；`Compress-Archive` | gpg 2.4.9、openssl 均在 PATH | 加密归档方案技术上可行（§7-D） |

**未跑**：gpg 非交互加密（pinentry 无人值守行为）、`npm run typecheck:bridge`（BASELINE §2.4 已记录 exit 2）、任何 headscale/docker 相关（B 类）。凡引用 BASELINE/PLAN 而非本会话实测的数字，均标「据 BASELINE §x」或「据 PLAN §y」。

---

## 1. 测试对象分析：PLAN 的 25 项落进三个测试层

我按「**判定所需的证据在谁手里**」分层，而不是按工作项类型分：

- **M 层（本机可机检、判定完全客观）**：P0-1…P0-8、P1-1…P1-5、P1-7…P1-14、P2-1…P2-3。占 25 项中的 24 项。
- **D 层（文档/剧本断言——断言的是「文字存在且形态对」，不是行为对）**：A15、P0-6、P1-6、P1-12、P1-13 的记录字段、P2-3。它们的失败模式是「写得不全/自相矛盾」，判定靠脚本而非执行。
- **R 层（真机，唯一裁决者是 owner）**：B1–B8、S0–S8（PLAN §1.2/§3.2）。**测试在此层只能断言「探针有判定树、回报格式固定」，不能断言答案。** PLAN §1.1 已明令 B 类绝不混入 A 类完成定义，测试侧必须继承这条纪律，否则会把「真机才有答案」写成「本机应绿」的门。

D 层与 M 层的分界不是「难易」而是**「断言对象是文件还是行为」**：P0-3 的 `(a) packages 面扫描` 是 M 层（行为），`(b) app 面镜像 tsc` 混合——镜像产物过 tsc 是 M 层（可在本机跑临时产物），「kit-stub 手写声明」是 D 层（断言 stub 存在且面 ≤15 符号）。我在 §5 按这条线逐项切分。

---

## 2. 可见测试与 holdout 的划分原则

### 2.1 唯一判据

> **如果一条测试的存在与否会改变开发 agent 的实现策略，它就应该可见；如果它的价值只在「开发 agent 不知道它」时才成立，它才应该 holdout。**

推论：
- **规格（做什么、做到什么程度、接口叫什么、数字是多少）必须 100% 可见**。否则开发 agent 是在猜，交付物不可评审，PLAN §2 各工作项的「验收」栏也就失去意义。
- **判定（同一规格的第二个独立实现 + 变体输入）应该 holdout**。它的价值恰恰在于「用实现者没见过的输入去打同一个契约」。
- 两者**永不改同一份规格**。可见测试是规格的一部分（改它要过评审）；holdout 只判定，不立法。

### 2.2 本仓的特殊适配：holdout 只依赖生产代码

实测确认：仓外 `.mjs` 测试文件可以用绝对 `file://` URL 导入仓内 `packages/*/src/index.ts`（`import3.test.mjs` → 1 pass）。因此我给 holdout 立一条硬性实现纪律：

> **holdout 绝不 import 仓内任何 `*.test.ts` 或测试 helper，只 import 被测生产代码。** fixture 自己在 holdout 里构造。

理由：一旦 holdout 复用仓内 helper，它就继承了开发 agent 的构造逻辑，「测的是同一个东西」——变异注入、哨兵值、顺序不变性全部失效。这条纪律同时让 §3-M4（绕过断言）自动失守：holdout 里没有可跳过的用例，没有 `test.only` 的作用域。

### 2.3 一句话分工

- 可见测试回答「**做到什么程度**」——契约、脚本名、CI step 名、数字、门的**存在性**。
- holdout 回答「**真的做到了吗**」——变体输入上的**行为**、门的**鉴别力**、导出面与既有测试的**完整性**。

### 2.4 三条禁则（写进 rubric）

1. **holdout 永不改需求**。holdout 红了，先判「实现错」还是「holdout 越界写了规格之外的东西」；后者由 owner 裁决后**修订并记版本**，不得为了让 holdout 绿而改实现，也不得悄悄删 fixture。
2. **可见绿不豁免 holdout，holdout 绿也不豁免可见**。两条独立，任一红即批次不收口。
3. **holdout 的检索面必须与 PLAN §0.1「活文档面」逐字一致**。检索面外命中 → 记 `HOLDOUT_SCOPE_ERROR`，**不算实现 FAIL**。这条不是洁癖：本仓 `docs/pre-device-plan/PLAN.md` 自己就引着「238/280/13/54/六包」这些旧值（PLAN §2 各验收栏、P0-6 验收栏），一个朴素的全仓 grep 必然把 PLAN.md 和 BASELINE.md 判红——**这是「holdout 与可见测试打架」最现实的一种形态**，必须在实现期就避开，而不是等它误报。

---

## 3. 防过拟合：十种模式的逐条防法

开发 agent 是 LLM，它的过拟合不是「忘了做」，而是**在可见判据上找到了成本最低的绿**。每种模式配一条机器可检的防线。

**M1 写死期望值。** 例：`buildVpnConfig` 直接 `return ['100.64.0.9/32']`，因为可见用例只有一个 netmap。
→ 防法：**不变量断言**。holdout 用生成式 netmap（随机 self 地址、随机前缀长度、随机子网集合），断言「输出 addresses 的每一项都出现在输入 netmap 中」「routes ⊆ {输入子网} ∪ {0.0.0.0/0}」「mtu ∈ [576,1500] 或被拒」。不变量对具体值免疫，写死必被破。

**M2 特判测试输入。** 例：`if (netmap.peers.length===1 && netmap.self[0]==='100.64.0.9/32')`。
→ 防法：**值上不相交**——holdout 的输入集与可见用例**不共享任何字面量**（含 IP、掩码长度、数组顺序、q 名）。追加**顺序不变性变异**：打乱 peers 顺序 / 交换 self v4-v6 位置，输出必须逐字节相同。

**M3 改测试文件本身。** 例：把 `assert.equal(r.status,400)` 放宽成 `assert.ok(r.status>=400)`；或删一条负例再补两条凑数。
→ 防法（三层，成本递增）：
 (a) 可见侧已有 PLAN §3.3 行为禁则「不硬改测试凑绿」——**这是纪律不是机制，不够**。
 (b) **测试名清单冻结**：实测 `npm test` 逐条打印 `ok N - <中文名>`，495 条。holdout 存基线清单，断言「旧名一个不少（不许删/改/重命名）+ 总数只增不减 + 每个新增工作项的用例名前缀可识别」。这条直接把「删负例」变成可机检。
 (c) **既有测试文件内容哈希锚**：验收前采集 `app/bridge/test/*.test.ts`、`packages/*/test/*.test.ts` 的 sha256 清单；holdout 跑时校验——只允许**新增文件**与**追加**，既有行不许改。实现上可用「按行前缀哈希累加」而非整文件哈希，允许追加而不允许改写。**注意**：`packages/kat/**` 是 P1-1 新增包、测试是新文件，不受此锚约束，需在清单里显式排除该前缀。

**M4 绕过断言。** 例：`test.only` / `test.skip` / 用例体改 `if (false)`。
→ 防法：holdout **自己调用被测函数**，不 import 仓内测试文件（§2.2）。可见侧的 `test.only` 会被 M3(b) 的名字清单抓到（名字还在但计数变 1），`.skip` 会被 `npm test` 的 `# skipped` 计数抓到——**建议把「`# skipped 0` / `# todo 0` / `# cancelled 0`」写进可见门**，这是零成本的高价值断言。

**M5 门被掏空。** 例：`validate:arkts` 写成 `process.exit(0)`；`gate:d4` 的检索面缩到一个空目录，于是「0 命中」。
→ 防法：**鉴别力测试**是 holdout 的核心。holdout 把违规 fixture 放进**真实的检索面**（临时文件放进 `packages/*/src/`，跑完即删），断言门红。更强的一条：**扫描面自证**——门必须报告它扫了多少个文件；holdout 独立扫一遍文件数并与门的报告比对，「扫 0 个文件所以 0 命中」当场暴露。

**M6 CI 空转。** 例：yml 里 step 加了 `continue-on-error: true` 或 `|| true`；或 step 名字在、命令是 `echo ok`。
→ 防法：holdout **本地执行与 CI 同一条命令**（从 yml 解析出 run 块喂给 bash），断言它在注入负例时红；并正则断言该 step 不含 `continue-on-error` / `|| true` / `if: false`。**不读 yml 文本就算过**——读文本只能证明「写了」，不能证明「跑了」。

**M7 数字造假。** 例：文档里写 495，实际 500；或门只检查「文档含不含实测数字」，不检查「是否残留旧数字」（这正是 BASELINE §5.2-3 记录的 docs-consistency 失明）。
→ 防法：holdout **自己跑** `npm test` 抓 `# tests`/`# fail`，断言活文档面出现的数字 == 实测数字；断言旧数字在活文档面 0 命中。

**M8 时序/环境取巧。** 例：perf 脚本少迭代、少 warmup、或直接打印常量。
→ 防法：holdout 断言**方法学字段存在性**（`iter=200`、`warmup=20`、sink 防 DCE、三次取中位、机型/API/温度），**不断言绝对数值**。这与 PLAN D12「记录制」一致——真机零数据下对 ms/op 定阈值必然诱发凑数（PLAN R10）。

**M9 接口冻结被悄悄破坏。** 例：为让 P0-1 编过而给 `makePeerServer` 加可选参数改签名；或 P1-8 顺手改 `packages/`。
→ 防法：**导出面快照**。我实测 8 包共 396 个导出。holdout 存基线快照，断言无删除、无签名/类型语义变更；新增必须落在授权清单内（O4 的 `h2c.ts`、O5 的 `packages/kat/`）。这条同时兜住 PLAN §3.3 冻结面与 R11。

**M10 holdout 泄露。** 见 §7 全部。

---

## 4. holdout 用例设计的四原则

**(1) 变体生成——同语义不同输入。** 不是「再写一遍相似用例」，而是**从实现的可观测行为反推等价类，在每类里取可见集没取过的代表值**。三层来源：
- *语义变体*：BE/LE、大小写、末尾点、前导 `-`、空/单字符/边界长度。
- *编码变体*：百分号编码、大小写混写、路径分隔符 `/\`、NUL。
- *环境变体*：无 headscale、无 SDK、无 docker、有假 SDK 路径。

**(2) 负例对照——且必须「可归因」。** 门红即可，但**每条 fixture 单独跑一次**：若 5 条违规里 4 条是同一条规则抓的，剩下那条规则没被验证，测了等于没测。holdout 报告应输出「哪条 fixture 让门红」而非只输出红/绿。

**(3) 等价类覆盖。** 以 `app/bridge/src/mock-peerapi.ts` 的谓词为例（`:180-185` 五个析取项）：`name.length===0 || length>253 || !/^[A-Za-z0-9._-]+$/ || includes('..') || startsWith('.')`。可见用例的 malformed 集合是 `['..','a..b','.','','a'.repeat(254),'a b','a/b','a\\b','a\x00b']`（`app/bridge/test/peerapi-tun.test.ts`），已覆盖五类中的多数。holdout 应补的缺口：**长度边界两点**（253 通过 / 254 拒绝）、**末尾点**（`a.example.` 当前**允许**，`:180` 注释明说依 RFC 1035 §3.1）、**label 以 `-` 开头**（`-a.example` 当前**通过**——见 §9 不确定项 U1）。

**(4) 变异风格检查（自检）。** 分两个方向：
- *对仓内门*：注入变异 fixture（把禁则写法稍作变形：`function *g()`、`let x!: T` 带空格、`as  const`）断言门红。变形是关键——正则门最常见的假绿是**精确匹配了可见负例的字面形态**。
- *对 holdout 自己*：人工变异被测生产代码（删一个分支 / 翻转一个比较符 / 改一个常量），断言 holdout **抓得住**。抓不住就说明这条 holdout 断言没鉴别力，应当删掉或重写，而不是留着装点。

---

## 5. 逐工作项测试设计（引用工作项 ID）

格式：**可见** = 开发 agent 看得到并据以迭代；**holdout** = 独立判定。每项给「holdout 的鉴别力来源」——即凭什么断定它不是走过场。

### P0-1 修 typecheck:bridge 红灯（TS2353）
- 可见：`npm run typecheck:bridge` exit 0；`npm run test:bridge` 31/0；yml 含该 step；畸形 q 逐条 400 且 body 含 `malformed q`（PLAN P0-1 验收）。
- **holdout**：
 - ① **等价类变体**：长度 253/254 两点、`a.example.`（末尾点应 200）、`-a.example`、`A.EXAMPLE`（大小写）。
 - ② **正控制组不被摘掉**：合法 FQDN → 200 且 body 是 `{RCode,Negative,Answers}` JSON 形状（`mock-peerapi.ts:193`）。若实现被改成「一律 400」，可见负例仍全绿——**只有正控制组能抓**。这是 PLAN 附录 B-1 的核心，必须在 holdout 里再钉一遍。
 - ③ **类型面**：`grep` 断言 `peerapi-tun.test.ts` 内不出现 `as unknown as` / `as any` / `@ts-nocheck` / `@ts-ignore`。PLAN 明令禁用「把编译器关掉」——这是**唯一能机检该禁令**的方式。
 - 鉴别力来源：若有人用 `answerDns:null` 修（PLAN R2 记录的实测退化路径），`mock-peerapi.ts:163` 会走 503 分支，holdout 的正控制组立刻红。
- ⚠️ holdout **不得**断言「`-a.example` 应 400」——那是扩需求（U1）。

### P0-2 修 ArkTS A23 Generator（`stun.ts:176`）
- 可见：netcheck 84/0；`grep -rEn "function\*|yield "` 在 `packages/*/src` 0 命中。
- **holdout**：
 - ① **STUN 解析等价类**：`foreachAttr` 的两处 throw 分别是「属性头不足 4B」与「padded 超出剩余」。holdout 用**手工构造的畸形属性流**（len 填 0xFFFF 的越界属性、len=1 的非 4 对齐、连续两个 0 长属性、属性恰好贴到消息末尾）断言抛点与错误码不变。这是「展开为 while+游标」最容易漂移的地方（`:215/:382` 调用点同步改写）。
 - ② **零输入/满输入边界**：`attrs.length===0`（不进循环、返回空）、单属性正好等于剩余长度。
 - ③ **消息长度字段不一致**：`stunParseBindingRequest` 的 `attrsLen` 与实际长度不符（`:209-214` 的两分支）。
 - 鉴别力来源：可见 8 条 stun 用例极可能覆盖不到「len 越界」这一支——holdout 的作用是确认展开重构**没有把一条 throw 弄丢**。

### P0-3 新门 validate:arkts（双面）
- 可见：脚本名 `validate:arkts`；exit 0；PLAN 列的 5 个负对照（enum / `let x!:` / `as const` / `function*` / `@ts-ignore`）逐个红；CI 加 step。
- **holdout**：
 - ① **变形负例集**（PLAN 可见集只有 5 条，太少）：`function *g()`（带空格）、`async function*`、`let x! : T`（冒号前空格）、`const y = z as const`、类私有 `#p`、`for (const k in obj)`、`Object.assign` / `Object.freeze` / `Object.defineProperty` / `delete obj.p`、`arr.forEach(function(){})` 函数表达式、`Symbol()`、`globalThis`、`fn.apply/call/bind`。
 - ② **误报对照（关键）**：holdout 塞入**合法**的 .ts/.ets 片段（箭头函数、`const` 局部、模板字符串、`??`、`Map`/`Set`、`for...of`），断言门**绿**。只测红不测绿的门无法排除「全红即通过」的退化实现。
 - ③ **扫描面自证**：门报告扫描文件数 ≥ N（packages 面 ≥72，据 BASELINE §2.11；app .ets 面 = 实际 `find` 数），holdout 独立数一遍比对。
 - ④ **stub 面**：断言 `kit-stub.d.ts` 存在、声明符号数 ≤ 15（PLAN 验收），且每个 `.ets` 里的 import 都能在 stub 中找到声明——**防 stub 假绿**（PLAN R9）。
 - ⑤ **临时产物清理**：镜像生成的 `.mirror.ts` 不许留在仓里（跑完 `git status --porcelain` 前后一致）。
- 鉴别力来源：PLAN 的可见负对照是**逐条列举**的固定样本，门若按样本字面匹配即假绿；holdout 的变形集专门打这一点。

### P0-4 D4/P4 机检门 + CI G0-5 改调
- 可见：`npm run gate:d4` exit 0 且 0 命中；负例 fixture（非注释行 `Date.now()`、`from 'net'`）→ 非 0；yml 无裸 grep；`bash -n` 通过。
- **holdout**：
 - ① **变形负例**：`Math.random()` 藏在**同行尾注释**里 vs 藏在字符串里 vs 真代码；`from "net"` 双引号 vs `require('net')` vs `import('node:fs')` 动态导入；`node:fs` 带空格 `from 'node: fs'`。**当前 yml 的死过滤器 `grep -v '^\s*//'`（BASELINE §5.2-4）正是靠「行首注释」形态活的**，holdout 必须同时验证「行尾注释不算命中」和「真代码不被误滤」。
 - ② **扩展面一致性**（我实测 `app/bridge/src` 当前 0 命中）：断言 P0-4 落地后门的检索面**要么显式声明只扫 packages 并在文档写明，要么同时覆盖 app/bridge/src**。不允许「默默只扫一部分」——这正是 BASELINE §5.2-1（typecheck:bridge 不在门内）那类缺口的同构复现。
 - ③ **扫描面自证**：`packages/` 下 src 文件数 = 72（据 BASELINE §2.11，我未在本会话复跑 find），门报告数与之相符。
- 鉴别力来源：可见负例是两条固定行；holdout 打的是**过滤器语义**（哪些算注释、哪些算导入）。

### P0-5 regress 可归因改造 + `--selftest`
- 可见：`npm run interop:regress -- --selftest` exit 0（离线）；无 headscale 跑 → exit 1 且 `reason=ENV_UNREACHABLE`；红→绿轨迹入 worklog。
- **holdout**：
 - ① **静默判负的原始缺陷（PLAN §2.10 的第 3 层）**：造一个「exit 0 + stdout 非空但**不含 marker**」的 child 脚本，断言 regress 判为 `SCRIPT_SILENT` 而**非** PASS。当前 `regress.mjs:42` 的判据是 `r.status === 0 && !sawUsage && stdout.length > 0`——**这条断言直接钉住「废弃 stdout 非空这个错误信号源」**（PLAN P0-5 明列），且 PLAN 的 S1–S5 可见断言**没有覆盖它**。
 - ② **usage 退化**：child 打印 usage 但 exit 0 → 判 `SCRIPT_USAGE`，不得判 PASS（`regress.mjs:41` 的 `sawUsage` 分支）。
 - ③ **硬编码 preauthkey 已除**：`grep -rEn "regress-dummy-preauthkey" interop/` → 0 命中；`HS_PREAUTHKEY` 未设时阶段判为可归因失败而非静默用假值。
 - ④ **derp 两参**：断言 regress 传给 `derp.node.ts` 的 argv 长度为 2（`regress.mjs:54-56` 现只传 1）。零参调用 → usage 退出（PLAN S3）。
 - ⑤ **summary 字段齐备**：每个阶段 `{name,status,exitCode,durationMs,reason,markerSeen,stdoutTail,stderrTail}` 九字段非缺。
 - ⑥ **marker 互不串**：三个 marker 字符串在代码里各自独立出现，`INTEROP PASS` 不得同时被 derp/h2c 阶段命中（防 `includes` 判据串台）。
- 鉴别力来源：①②是「判据本身错了」这一层的测试，可见五断言测不到。

### P0-6 交接包 v1（含 `check-stage-docs.mjs`）
- 可见：脚本 exit 0；旧数字 grep 0 命中；AGENT-TASK 每个 CU 探针有二值判定。
- **holdout**：D 层为主——
 - ① **STAGE-CHECKLIST 覆盖反查**：holdout 从 PLAN §3.2 的 S0–S8 抽出全部命令，与 `STAGE-CHECKLIST.md` 里的命令集做差集，断言空（PLAN A11 的方向是「文档 ⊇ 剧本」，holdout 做**独立重抽**——不复用脚本里的抽取逻辑）。
 - ② **每个命令三标签齐全** `[local]/[device]/[human]` 恰有一个。
 - ③ **反模式清单五项齐全**：`makePeerServer(null)`、`as unknown as`、改断言凑绿、删负例用例（PLAN P0-6 列四条 + 我建议把「stub 全量 declare 掩盖真实 API 缺失」列第五条）。
 - ④ **O1–O7 签署栏存在且标「待拍板」**（PLAN §4.2 要求可空但不得缺位）。
 - ⑤ **检索面纪律自检**：holdout 跑完后确认它自己**没有**在 `docs/pre-device-plan/`、`docs/baseline-audit/`、`worklog.md` 里产生新命中（§2.4-3）。

### P0-7 修 .gitignore 证据吞噬
- 可见：`git check-ignore evidence/interop-20261003/regress.log` → exit 1（我实测当前 exit 0，`.gitignore:27`）。
- **holdout**：
 - ① **不吞过头**：新增 `.log` 规则不得让 `evidence/x/y.log` 之外的**意外文件**也被放行——断言 `node_modules/x.log`、`app/build/z.log` 仍被忽略（`.gitignore:8` 的 `build/`、`node_modules/` 优先级不得被 `!evidence/` 击穿）。**这是最容易漏的一条**：只测「该进的进了」不测「不该进的没进」。
 - ② **`!evidence/` 不击穿 `.mimosa/` / `.zcode/`**：我实测二者分别在 `.gitignore:24/:47` 被忽略，加否定规则后必须仍被忽略。
- 鉴别力来源：①②把「加一条否定规则」这个最小改动可能带来的副作用钉住。

### P0-8 修 arkts-check.js（ESM/CJS + SDK 参数化）
- 可见：`node interop/arkts-check.js .` 不再 ReferenceError；假 SDK 路径报「路径不存在」。
- **holdout**：断言**退出码集合**属于 {0(SKIP), 明确非崩溃码} 且 stderr 不含 `ReferenceError`/`SyntaxError`/`Cannot find module`；`ARKTS_SDK_HOME` 未设 → 报错信息**点名缺失变量名**（PLAN 验收明列「可读 SKIP 与缺失变量名」）。

### P1 关键项（择要，其余同法）
- **P1-1 KAT**（holdout 价值最高之一）：可见是 `test:kat` 全绿 + `grep "node:" packages/kat/src` 0 命中。holdout 做——① **向量真实性**：从 `runKat()` 结果里抽 RFC 7748 §5.2/§6.1、RFC 8439 §2.8.2、RFC 4231、RFC 5869 的**独立**输入，与 `packages/kat/src/vectors/` 的常量逐字节比对（holdout 自带一份对照向量，不读 kat 的 vectors 文件，避免「实现与向量同源」的循环论证）；② **零 node: 导入的传递闭包检查**（不止直接 import，查 `packages/kat/src` 内任一文件的 import 图）；③ **≥60 例是下限不是目标**：断言实际例数 ≥60 且**无重复 id**。
- **P1-2 / P1-3 文档门**：holdout 的鉴别力测试用**可见清单之外的旧值**——PLAN A16 列的是 280/13/54/238/「六包」/1066 行；holdout 另取 BASELINE §6 里同样真实存在的过期值：**`217`（CONTEXT.md:15 的时序链中间值）、`64`（netcheck 误数，BASELINE §10.3 已裁决）、`29 pass`（CONTEXT.md:15 实测漂移）、`54 用例`（README:12 自相矛盾）**。若门是按 PLAN 那 6 个字符串写死的，这 4 个新值会漏过——**这是「门是否真在扫」的唯一可靠探针**。
- **P1-4 vpn-config**：见 §3-M1/M2。追加 mtu 边界等价类 **575/576/1500/1501** 与**非数字输入**（NaN、`'1280'` 字符串、缺省）——PLAN 验收只说「mtu 越界拒绝」，非数字输入的处置是规格空白，holdout 只断言「不产生非法 mtu 静默通过」。
- **P1-5 platform-ports**：holdout 断言 **FixedClock 双轴保真**（改挂钟不改单调钟、超时判定只走 mono）——这是 PLAN 明确要求「禁止真机 adapter 两轴都用 Date.now」的**可机检代理指标**；断言 `ArrayRng` 填满 into 的骨架拒绝短填充。
- **P1-8 interop 类型覆盖**：除 A12 的 `listFiles | grep -c "interop/" ≥3`，holdout 追加**鉴别力**——注入一个类型错误到某个 interop 文件，断言 `npm run typecheck` **报出该文件的错**。否则开发 agent 可以把 interop 加进 tsconfig 的同时给每个文件加 `// @ts-nocheck`，`listFiles` 照样 ≥3 而门是空的（PLAN P1-8 提到 `@ts-nocheck` 只允许逐文件登记理由——holdout 断言例外清单非空时**每条都有理由注释**）。
- **P1-10 上游对拍**：holdout 抽 `file.go:LNNN` 引用，断言目标行存在**且含声称符号**（PLAN 说 AU1–AU3 已全中）；再加**负例**——把某条引用改成 `L999` 断言红，证明对拍器不是空转。
- **P1-11 证据规范校验器**：三缺陷样本（缺 reason / 缺 marker / 缺环境指纹）分别报错 + 合法样本 exit 0。holdout 追加第四类：**E5 敏感边界**——样本里含私钥/内网域名时校验器必须报错。
- **P1-14 `npm run gates`**：可见是 exit 0 ⇔ 各分门全绿、人为弄红任一分门 → 聚合红。holdout 追加**枚举完整性**：聚合门覆盖的分门集合 ⊇ A1–A9 + 文档门，且**聚合门里不能出现「跳过某分门」的分支**（`if (SKIP_X) return 0` 这类退化的实际风险点）。

### P2
- **P2-1**（真实 HTTP server 层）：holdout 起真 server，用**真实 HTTP 客户端**（不是 importlib 直调）打**编码变体**：`%2e%2e%2f`、`..%2f`、大小写混写 `%2E%2E`、`..\`（Windows）、超长名、NUL；断言 inbox 只落合法文件（我据 BASELINE §2.7 记录 Python 视角 inbox 应仅 `["x.bmp"]`）。
- **P2-2**（冗余快照去重）：holdout 断言 sha256 相同的文件只剩一份，且 manifest 记了该 sha256，删除后活文档面无悬空引用。
- **P2-3**（事实卡）：D 层——断言两权限、bundleName 双处与 `module.json5` 实际内容一致（**从配置文件读，不从文档抄**）。

---

## 6. 机检集成：位置与命名

### 6.1 可见侧（进 package.json + CI）
PLAN 已定脚本名，我补齐**命名与位置的一致性要求**：

| 脚本 | 位置 | CI step 命名 | 依据 |
|---|---|---|---|
| `validate:arkts` | `app/tools/ets-mirror-check.mjs` | `G0-7 ArkTS 机检（双面）` | PLAN P0-3 |
| `gate:d4` | `scripts/gate-d4-p4.mjs` | `G0-5 D4/P4 机检`（**替换**现有 step，不新增） | PLAN P0-4 |
| `test:kat` | `packages/kat/test/node.test.ts` | `G0-8 KAT 可移植层` | PLAN P1-1 |
| `gates` | `scripts/gates.mjs` | 不单独设 step（本地聚合入口） | PLAN P1-14 |
| `interop:regress -- --selftest` | 复用现有 script 加 flag | `G0-9 regress 离线自检` | PLAN P0-5 |
| 剧本自检 | `scripts/check-stage-docs.mjs` | 归入 docs-consistency job | PLAN A11 |

命名纪律三条：①yml 里**不再出现裸 grep**（PLAN P0-4 验收明列）——所有机检逻辑必须在仓内脚本文件里，CI 与本地共用同一份；②step 名带编号且**替换而非追加**，避免 yml 里出现两个语义重叠的 step；③yml 首行 `name: G0 五门机检` 与注释「五门」在新增 step 后必然过期（P0-4 已在文件清单里，但「五门→八门」的改名建议一并交给合并人裁决——BASELINE §4.4 记为低危命名漂移，我倾向**同批修掉**而不是留成第二次漂移）。

### 6.2 一个高价值零成本断言
在可见门里加一条：`npm test` 输出中 **`# skipped 0`、`# todo 0`、`# cancelled 0`**。实测当前这三项均为 0。这条直接堵 M4 的一半（`.skip`/`.todo` 绕过断言），成本是三行 grep。

### 6.3 holdout 侧：**绝不进 package.json，绝不进 yml**
- 理由一（防泄露）：package.json 与 yml 是开发 agent 每天读的东西，holdout 路径写进去等于发路标。
- 理由二（本会话实测的硬约束）：`node --test <裸目录>` 在本环境**不可用**——实测 `Cannot find module 'D:\…\probeholdout'`；只有 glob 形态 `node --test "<dir>/**/*.test.mjs"` 通。holdout runner 必须以 glob 调用，并把仓根从 `process.cwd()` 推导（实测从仓内 cwd 运行仓外测试文件 exit 0），**不在任何文件里硬编码绝对路径**。

---

## 7. holdout 的存放与保密机制

### 7.1 四个方案的实测对比

| 方案 | 开发 agent 偷读风险 | 实测依据 | 裁决 |
|---|---|---|---|
| **A. 仓内独立目录**（`tests/holdout/`） | **极高** | 实测 `git status --porcelain -uall` 会**逐文件**列出未跟踪目录（`.probe-hidden/secret.txt` 直接出现在输出）；且即使写进 `.gitignore`（`.mimosa/`、`.zcode/` 即是），`ls` 照常可见——**gitignore 不是访问控制** | **否决** |
| **B. 同仓独立分支**（`holdout/main`） | **高且极易** | 实测本仓 `git branch -a` 直接列出全部分支；`git show <branch>:<path>`、`git log --all` 都在 LLM 的常规工具箱内。且本仓已有多远端现实（`seed` = 本地裸库，HEAD `dc8d6ec` ≠ 本地 `90ed53e`） | **否决** |
| **C. 仓外文件目录** | **中** | 实测可行：在 `D:/new-workspace/_holdout_probe/` 放测试、仓内 cwd 运行 exit 0，且可用绝对 `file://` URL import 仓内生产代码。风险在于开发 agent 若 `ls ..` 或读 P0-6 交接文档可能撞见 | **推荐（主方案）** |
| **D. 加密归档** | 低，但**取决于口令在哪** | 实测 gpg 2.4.9、openssl、PowerShell `Compress-Archive` 均可用 | **仅作 C 的加固层，不作独立方案** |

关于 D 的诚实评估：**解密口令若在开发 agent 能触达的地方，加密等于零**。它真正有价值的场景是——口令只给**验收会话**（另一个 LLM 会话），不给开发会话。此时「加密」把「S2 holdout 内容不进入验收 agent 的输出/上下文」这件事做实了，是有意义的加固。但 gpg 在 Windows Git Bash 下调用会触发 pinentry 提示，**无人值守场景需 `--batch --passphrase-file` 或 batch key——这一点我没有实测**，列为不确定项 U3。

### 7.2 推荐形态：双层 holdout

把 holdout 按「泄露后是否还有价值」切成两层，**把必须严格保密的部分压缩到最小面积**：

- **S1 结构层**（放仓外即可，泄露不致命）：断言脚本名/CLI step 名存在、CI step 不含 `continue-on-error`、`npm test` 的 `skipped/todo/cancelled` 为 0、导出面快照一致、活文档面数字与实测一致、既有测试文件哈希锚未被改写。**理由**：这些断言即使被读，也不教人「怎么骗过鉴别力测试」——它们只要求「该有的门要有、该有的数字要对」。
- **S2 行为层**（严格隔离）：变体输入上的行为断言、门的鉴别力注入、等价类边界、防特判的值不相交。**泄露即失效**。

这样即使 S2 被读，S1 仍提供回归价值；且真正需要保密的只是 S2。

### 7.3 反过拟合探针：哨兵值泄漏检测（我建议纳入正式测试）

在 S2 的 fixture 里植入若干**在可见面绝对不出现**的字面量，取自 RFC 保留文档地址段：**192.0.2.0/24（TEST-NET-1）与 198.51.100.0/24（TEST-NET-2）**。
> 刻意**不用 203.0.113.0/24**：PLAN P0-6 的验收 grep 明确把 `203.0.113.10` 列为必须 0 命中的旧假地址，用它会让两个断言互相打架。

holdout 跑完后 `grep` 全仓（排除 holdout 自身目录）是否出现这些哨兵值：
- **命中 → 报 `HOLDOUT_LEAK_SUSPECTED`，触发人工复核**（不直接判 FAIL——保留段地址理论上可能巧合出现，虽然概率极低）。
- **未命中 → 反向证明**：可见测试里没有针对 holdout 输入写的特判。

这条把「防过拟合」从**相信开发 agent 的自律**变成**有证据的判定**，是我在本轨迹里最想推的一条。它同时能抓 M2（特判测试输入）的最强形态——**开发 agent 若真读过 holdout 并写了特判，几乎必然会在可见测试里留下哨兵值的痕迹**。

### 7.4 泄露后的失效处理（分级）

- **L1 路径暴露、内容未见**（某文档提到存在 holdout 目录）→ 不失效，继续跑。
- **L2 读到部分 S2 fixture** → 该子集作废，用**新取值**替换（变体池轮换）；同子集其余部分保留。
- **L3 读到 S2 源码全文** → **S2 整体作废重写**（不是打补丁），且新旧 fixture 集必须**值上不相交**；重写后 bump 版本号，旧版本的失败记录保留。

判定泄露的机器证据：哨兵值扫描（§7.3）+ holdout 自身 sha256 与验收记录不符。

### 7.5 状态锚：验收的是「哪一份代码」
本仓禁止擅自 `git commit`（PLAN 红线继承），因此验收时没有干净的 commit sha 可用。建议 holdout 每次运行输出：
```
STATE_ID = sha256( HEAD + "\n" + (git status --porcelain -uall) )
HOLDOUT_SHA256 = <本次 holdout 脚本自身的哈希>
```
两个值打在输出第一行。作用：①任何一次「跑的是哪版 holdout、哪份代码」有据可查，直接支撑 §8 的「不许改 holdout 让它绿」；②**holdout 只能写临时目录**（`os.tmpdir()`），写进仓内会改变 `STATE_ID` 造成自污染。

---

## 8. 谁在何时跑、rubric、判定标准

**谁**：owner，或一个**全新会话的独立验收 agent**。明确排除：①开发 agent 自己跑（它会改 holdout）；②CI 跑（路径进 yml = 泄露，§6.3）。
**验收 agent 的输入只有三样**：仓的当前状态、`PLAN.md`、holdout 脚本路径。**不含开发 agent 的实现说明**——它自己读代码得出结论。若由人执行，人同样只看汇总。
**何时**：跟 PLAN §2.5 的批次走——批次一/二/三/四各收口一次 + 最终一次 = **5 次**。不要每 commit 跑：迭代节奏太密会让 holdout 事实上变成可见测试。

**rubric（客观化）**：
1. 每条断言输出 `PASS | FAIL | BLOCKED | HOLDOUT_*` 四态 + 一句理由 + 机器可读 id；末尾汇总 + exit code。**人只读汇总**。
2. `BLOCKED` 表示环境不可达（需 headscale/docker/真机，对应 PLAN B 类）。**BLOCKED 既不算 PASS 也不算实现错**，单列由 owner 判断——继承 PLAN §1.1「B 类绝不混入 A 类」的纪律。
3. 硬规则：
 - 任一 `FAIL` → 批次不收口。
 - holdout 自身内部错误（fixture 加载失败、glob 无匹配）→ `HOLDOUT_BROKEN`，批次 BLOCKED，**先修 holdout，且不许开发 agent 修**。
 - **不许「改 holdout 让它绿」**。修订需 owner 批准 + worklog 记原因 + 版本号递增 + **旧版本失败记录保留**（防「改到绿为止」的历史被抹掉）。
4. 失败处置分级：`实现错` → 回开发 agent；`holdout 越界`（写了规格之外的断言）→ owner 裁决后修订 holdout；`环境不可达` → 记 BLOCKED，不计入红。

---

## 9. 不确定性与需合并人裁决的点

- **U1 `-a.example` 的语义归属**。`mock-peerapi.ts:180-185` 的谓词只拦「以 `.` 开头」，**`-a.example` 当前通过**；RFC 1123 §2.1 规定 label 不得以 `-` 开头/结尾。PLAN 未把这条列入任何工作项。**我的立场**：holdout 断言「当前实现的实际语义」（通过），**不**借测试偷偷扩大需求；若 owner 认为该修，应新增一个工作项。需裁决：是否把 RFC 1123 label 规则纳入范围。
- **U2 D4 门的检索面是否扩到 `app/bridge/src`**。我实测该目录当前 0 命中，所以扩面技术上无阻；但 PLAN P0-4 只写了 packages 面。holdout 的 §5-P0-4② 断言的是「要么显式声明只扫 packages 并写明、要么同时覆盖」——**这个二选一需要 owner 定调**，否则 holdout 的断言本身就是个规格。
- **U3 gpg 无人值守行为未实测**。若采纳 D 加固层，需先验证 `gpg --batch --symmetric --passphrase-file` 在本机 Git Bash 下可非交互运行。**本会话未跑**。
- **U4 验收 agent 的模型与上下文预算**。holdout S2 若由独立 agent 执行，它读全仓源码会消耗大量上下文。备选：holdout 全部写成确定性脚本 + 极简报告，由 owner 或一个只跑脚本不做判断的 agent 执行，判定完全交给 rubric。需裁决：验收执行者的形态。
- **U5 测试名清单冻结的维护成本**。495 条名字冻结后，任何**合理**的用例改名都会被判红。PLAN 未禁止改名（只禁止删负例）。需裁决：清单冻结是「只许增不许改名」，还是允许改名但要求改名条目有一一对应的新名映射。**我倾向后者**——否则合并人将来整理测试名会被无谓阻塞。
- **U6 `evidence/` 放行规则与 secrets 规则的优先级**。P0-7 建议加 `!evidence/` 与 `!evidence/**/*.log`；`.gitignore:39-44` 有 secrets 段（`*.p12/*.keystore/…`）。若 `.p12` 落在 evidence 下，否定规则可能击穿 secrets 保护。**我未实测 gitignore 规则优先级在这个组合下的行为**，需在 P0-7 实现时验证并纳入 holdout。

---

## 10. 我考虑过但否决的设计备选

- **「全部测试都 holdout，仓内零测试」**——否决。会剥夺开发 agent 的迭代回路，交付物不可评审，且与 PLAN §2「新增测试只增不减」的纪律直接冲突。
- **「用 code coverage 阈值替代 holdout」**——否决。覆盖率与正确性无关：P0-1 把 `assert.equal(400)` 改成 `assert.ok(>=400)` 覆盖率不变但钉子松了。且本仓未配置覆盖率工具链（`package.json:20-24` 只有 3 个 devDependency）。
- **「用 mutation testing 工具（stryker）作为 holdout 主体」**——否决为**主体**、保留为**手法**：stryker 会生成海量变异并把大量「等价变异」（改了但行为不变）报成存活，噪声淹没信号；且需新增 devDependency（本仓禁 npm install）。我的做法是**手写少量高价值变异**（§4-(4)）作为 holdout 自检，不引入工具。
- **「holdout 放在 CI 里用 secret 变量注入路径」**——否决。路径会进 yml（泄露），且 CI 一旦配置错误会「静默跳过」，比不设门更坏——这正是 BASELINE §5.2-2（G0-5 语法死却「从未真正执行」）的同构风险。
- **「把 sentinel 值检查做成 CI 门」**——否决。CI 跑 = 开发 agent 能反复触发并据此二分出哪些值是哨兵。哨兵检测必须只在**验收时**跑一次。
- **「holdout 复用仓内 fixture helper 以省代码」**——否决，理由见 §2.2：会继承开发 agent 的构造逻辑，全部鉴别力失效。

---

*本轨迹只出思考，不出测试文档。全部实测命令与输出见 §0；未跑项已逐条标注。holdout 的价值全部押在「变体 + 鉴别力 + 哨兵」三件事上——若后续合并人只来得及做一件事，做 §7.3 的哨兵值检测：它是唯一一条能在**不依赖保密**的前提下给出过拟合证据的检查。*
