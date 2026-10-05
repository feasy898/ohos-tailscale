# 测试设计思考轨迹——真机侧与交接面（glm53flash-2）

> 五位测试设计思考员之一；主轴：PLAN 的 B 类项（CU 探针、首编译报错面、S0–S8 剧本、INTEROP PASS、真机 perf）
> 的「测试」形态，env-ready 机制、判定树自检、交接包防毒、holdout 真机用法。读者=稍后撰写正式测试的合并人。
> 本文件是推理轨迹，不是测试文档；备选与放弃理由全部留下。

## 0. 元信息与亲验记录

- 输入：PLAN.md（25 工作项/A1–A16/S0–S8/D1–D13/O1–O7）、BASELINE.md；未读同目录其余文件（保持独立）。
- 本会话亲验（下列结论均出自本次实跑/实读，非转引）：
  - `git remote -v` → `origin git@github.com:feasy898/ohos-tailscale.git`（白名单数据源）；另有 `seed` remote 指本地路径 `D:/new-workspace/_clone-tmp/afp.git`——**交接包克隆地址检测必须只认 origin 形态，且 seed 这种本地路径串也应入黑名单**（泄本机路径给真机 agent 无害但属脏数据）。
  - `grep -rEn "function\*|yield " packages/*/src --include='*.ts'` → 恰 2 命中：stun.ts:176/:190，**当前无注释误报**（P0-2 修复后应为 0）。
  - `grep -rn "@ohos.net.vpn" app/entry ...` → **前缀陷阱实锤**：Index.ets:2 写的是正确的 `@ohos.net.vpnExtension`，会被裸 pattern `@ohos.net.vpn` 误命中；owner-with-real-device.md:47 是真错。
  - `node -e "require.resolve('ajv')"` → ABSENT；node_modules 仅 @ohos-tailscale/@types/tweetnacl/typescript/undici-types——**无 schema 校验库且禁 npm install，env-ready 校验必须手写**。
  - 亲读 HARMONY_AGENT_TASK.md：:9/:49「六包/238」、:13 `git://203.0.113.10:9418`、:68 `ssh://root@203.0.113.10`、:71 `[UPLOAD-TOKEN-REDACTED]`、:82/:88「六包」。
  - 亲读 owner-with-real-device.md：:24 Day1 命令缺 `typecheck:bridge`、:47 `@ohos.net.vpn`、:60 `hvigorw assembleHap`。
  - 亲读 agent-interop-regression.md：:19/:26 可执行命令里是 `<VERSION>` 死占位（P1-9 验收「版本号出现在可执行命令」正是防它）。
  - 亲读 interop/regress.mjs：:42 判据 `status===0 && !sawUsage && stdout.length>0`、:52 假 key、:54-56 derp 缺参、:57-59 h2c 无 CLI；**新发现：:71-74 summary.json 写进 `mkdtempSync(tmpdir())` 即 OS 临时目录**，而 agent-interop-regression.md:35-39 归档只 `tee regress.log` + `state.sha256`——PLAN §3.4 要求 evidence 含「summary.json（原件）」，当前脚本形态下原件必然丢失。见 §10-U6。
  - `ls scripts/` 仅 perf-baseline.mjs——check-stage-docs.mjs / gates.mjs / gate-d4-p4.mjs 均未存在（与 PLAN「新建」表述一致）。

## 1. 测试对象分析：我的四分类（比 PLAN 的 A/B 二分多切两刀）

PLAN 已把完成定义劈成 A（本机可机检）/B（真机首答）。测试设计还需要两刀：

| 记号 | 对象 | 现在能测吗 | 测试形态 | 主责思考员 |
|---|---|---|---|---|
| C 类 | A1–A16 的实现项 | 能（exit code 级） | 命令门 + 负对照 | 其他四人 |
| **D 类** | 交接包文档断言（AGENT-TASK/STAGE-CHECKLIST/DECISIONS/OWNER-GUIDE/CU-CARDS/EVIDENCE-SPEC 的内容正确性） | **能**（全部是文本机检） | 黑名单/白名单/结构断言/标签闭包 | 本文 |
| **E 类** | 人类配合 IO（env-ready.json、OWNER-GUIDE 三栏、O1–O7 签署态） | 能测「机制」，不能测「人类填的值」 | 纯函数校验器 + 三向对齐检查 | 本文 |
| B 类 | 真机首答项 B1–B8 | **不能测答案，只能测「答案的容器」** | 两层（见 §2） | 本文 |

分类判据一句话：**凡是「事实存在于仓库文本/命令行为里」的都是 C/D 类现在可机检；凡是「事实存在于真机/人类/远端 Actions」的只能交付判定容器**。BASELINE §2.9「远端实际状态无 gh 不可查」与 §7「需真机/DevEco」「需 headscale+docker」两节就是这条判据的既有实例。

D 类的关键认知：**交接包文档是「即将执行的测试用例」**——S0–S8 剧本每步的命令与判据就是给真机 agent 的测试脚本，文档里的假命令（BASELINE 已证 6+ 处，我亲验见 §0）等于「测试用例本身带毒」。所以 D 类检测不是普通文档校对，是**元测试**：测试「将要被当测试执行的文档」。

## 2. B 类项的测试形态：四要素判定树 + 两层结构

### 2.1 两层结构（本文核心主张）

B 类项「不能现在跑」，但可测的东西劈成两层，**两层都现在可机检**：

- **L1 容器层（本机现在跑）**：真机 agent 将拿到的判定树/探针素材/回报格式的**结构完备性**。测的是「工具齐不齐、树闭不闭、格式能不能机检」。
- **L2 留证层（真机将来跑，本机事后验）**：真机 agent 执行时按规范留下**机器可判定的 IO**（marker 字符串、固定字段 JSON、原始输出文件），使任何人事后能不重跑真机而裁决「该步过没过」。

设计原则：**让 B 类答案天然以可机检 IO 的形态产生，而不是事后从散文报告里抽取**。PLAN §3.4「贴原始输出而非结论（防绿灯幻觉）」就是这个原则的既有表述；我的贡献是把它落到「每步一个四要素表」。

### 2.2 四要素法（输入/执行/留证/判定）

每个 S 步和每个 CU 探针用四要素表定义，这是 L1 的断言对象：

| 要素 | 内容 | L1 怎么测它 |
|---|---|---|
| 输入 | 探针工程素材、判定树、env-ready.json、环境（headscale/SDK） | 文件存在性 + 内容断言（素材里引用的路径/命令在仓内真实存在） |
| 执行 | 真机 agent 跑的命令序列 | 每条命令在 STAGE-CHECKLIST 带 `[local]/[device]/[human]` 标签；命令与仓内脚本/文档一致 |
| 留证 | 落盘什么（evidence/ 文件、marker、JSON） | EVIDENCE-SPEC 的文件清单逐项有校验器对应；marker 字符串在脚本源码中真实存在 |
| 判定 | 谁用什么命令裁决 | 判定命令本身可离线重放（对着留证文件跑，不需要真机） |

### 2.3 逐 B 项四要素设计

**B3/CU6（.ts specifier，决策树根）**
- 输入：S3.0 最小探针工程素材（PLAN §3.1 第 3 条承诺「空工程 HAP + `.ts` import 探针源码与判定标准」）。
- 执行：DevEco 编单模块 HAP（人类 5 分钟 GUI + agent 15 分钟）。
- 留证：**这是全剧本最难机检点**——GUI 构建无 stdout。诚实降级方案见 §10-U1。
- 判定：二值「编译产物存在=接受 / 编译报错含 specifier 类错误=不接受」；接 D4 判定树选方案。判定命令对留证文件离线可跑。

**B7（首编译报错面）**——注意 PLAN 的强定义：**预期报错，不承诺零报错**。
- 判定标准不是「exit 0」而是「**报错分类计数 ≥0 且每类命中判定树对应分支；树外报错→升人**」。
- 留证：每类报错的原始文本 + 修法 + git diff 清单（HARMONY_PC_REPORT §2 固定节）。
- L1 测试点：判定树必须含「树外报错」出口（完备性自检覆盖，见 §2.5）。
- 反过拟合设计：不把报错清单写死成白名单（真机报错面不可预知），树只收编已知三类（@kit.* 路径/type:vpn/compatibleSdkVersion），其余一律走升人出口。

**B8/INTEROP PASS**
- 输入：headscale.device.yaml（O3 豁免）+ 一次性 preauthkey（env 变量，不入仓）。
- 执行：S6 走 D1 路径 A；先跑 P0-5 改造后的 regress。
- 留证：evidence/interop-<date>/{regress.log, summary.json 原件, state.sha256, README.md} + E4 环境指纹四元组。
- 判定：marker（`INTEROP PASS`/`DERP INTEROP PASS`，大小写敏感）+ exit 0 + summary 每阶段 `reason` 非空且 =PASS + **PROTOCOL_REJECT 时严禁改脚本凑 PASS（PLAN §3.4 已写死：违反即作废全批）**。
- 归因对照：S2 留的 Node 侧三条 PASS 是 S6 失败时二分「协议栈 vs 手机网络」的基线——两侧 summary 的环境指纹必须可比（holdout 比对点，见 §5.4）。

**B1（CU2 BigInt + perf）/ B2（CU5）/ B4（CU7）/ B5（CU8）**
- 容器=CU 卡：每卡必须含「30 分钟探针写法（源码级）+ 二值判定 + 两分支预案 + 答案落点节名」（P1-6 验收已定）。
- L1 测试：check-stage-docs 断言每卡四要素齐、无空占位（`待填|TODO|TBD|待定` 0 命中于 CU-CARDS.md）。
- CU7 特有：卡里必须写「禁凭记忆写，查 SDK .d.ts」的执行留证=粘贴 .d.ts 相关声明原文（PLAN B4 措辞已是禁则，测试把它变成可查的留证要求）。
- CU8 特有：KAT 双 runner 的「真机外壳只留接口约定不实现」（P1-1）——L1 断言接口约定文件存在且不含实现体。

**真机 perf（B1 的 S5b）**
- 判定=记录制（D12）：**断言「记录完整性」不断言「数字好坏」**——JSON 同构字段（iter/warmup/sink/mean/p50/p95/p99）+ 机型/API 版本/温度元数据 + 3 次取中位；软参考 ≤25 ms/op、>50 触发 O6 的**分支存在性**由树完备性自检保证，数字本身不进门。
- 这条是 R10（先写死阈值诱发凑数）的测试侧对应物：**门只看格式，不看值**。

### 2.4 S0–S8 逐步检查表骨架（L1 断言对象）

S0: gates 复跑全绿（红→停，`<495` 先查旧版克隆）｜S1: check-stage-docs 绿 + HEAD 无未解释漂移｜S2: regress selftest 绿（红=脚本没修好**不许上机**）+ Node 侧三条 PASS 留证 + linter 复扫｜S3.0: CU6 二值首答｜S3: unsigned HAP 产出 + 报错分类走树｜S4: 签名方式落 DECISIONS D6 + `hdc install` exit 0 + **env-ready.json 全绿才进 S5**｜S5: VPN 弹窗出现即成功（fd 失败是预期）+ hilog 两 tag 抓取｜S5b: KAT 全绿 + perf 记录完整｜S6: 四步处置树按序 + 节点出现在 `headscale nodes list`｜S7: Ping/Pong 往返（STUN 全败可退化，非致命）｜S8: 三层逐级（②过③不过=PacketFilter 二期，不算剧本失败）。
每步的失败处置都已在 PLAN §3.2/§3.3 定向；测试化就是把它们翻成 §2.5 的树格式并自检。

### 2.5 判定树完备性自检（给真机 agent 的判定树本身要不要也来一层自检——要）

**主张：要，且这是 L1 最有价值的一层。** 真机 agent 在高压环境下按树行事，树有洞=agent 自由发挥=R1 风险（把环境失败误诊为代码问题）的直接入口。

- 载体格式：判定树以 ```tree 代码块内嵌于 AGENT-TASK.md（文档即数据，无双源）。节点行约定 `- [条件] → 动作 | 子节点`，叶子带 `回报:` 与 `升人?` 标记。
- 自检脚本（建议名 `scripts/check-decision-trees.mjs`，并入 A11 门）断言五条：
  1. 每个条件节点恰有两个互斥出边（二值/编号子步）；
  2. 每条路径终止于叶子，无悬空中间节点；
  3. 每个叶子含 {动作, 回报字段, 是否升人} 三元组——升人叶子必须映射到 D10 六条之一（编号引用）；
  4. 无「见上文/同上/详见」式悬空引用；
  5. 树内引用的工具/文件（scripts/…、interop/…）在仓内存在（把 agent-interop-regression.md:19 `<VERSION>` 式死占位一网打尽：**引用占位符 `<...>` 出现在可执行命令行即红**）。
- 覆盖树清单：S3 报错处置树（含树外出口）、S6 四步树、CU 卡二值分支 ×5、回退路径倒序树（S8→S7→S6→S2→总回退=可接受终局）。
- **负对照（防自检假绿）**：注入缺叶子的树/含悬空引用的树/叶子缺回报字段的树 → 各自 exit 非 0。负例常驻为脚本 `--selfcheck` 模式（内置样本字符串，不依赖临时文件——理由见 §9-3）。

## 3. env-ready.json 机制怎么测（E 类：人类配合步骤完成与否变成可判定 IO）

### 3.1 约束与决策

ajv 缺席且禁 npm install（§0 亲验）→ **不引入 schema 库**。备选：
- a) schema 用 JSON Schema 全量语法 + 自写子集校验器——放弃：解析 JSON Schema 本身就是造轮子，负例空间大。
- b) **schema 文件退化为机器可读键清单**（`{"<key>": {"type": "...", "pattern": "...", "enum": [...], "why": "..."}}`），校验器 `scripts/check-env-ready.mjs` **读同一 schema 文件驱动校验**——采纳：单源，schema 本身就是测试断言的数据。

### 3.2 测试点（全部本机现在可跑，纯函数）

1. 合法样本 → exit 0（样本文件与被校验文件分开放：fixtures 路径放仓内 `docs/pre-device/fixtures/` 或脚本内置字符串）。
2. 缺键 → exit 非 0 且报键名与 why（错误信息里带 why=把 OWNER-GUIDE 的解释自动带给人）。
3. 类型错/枚举外值/正则不匹配 → 各一负例。
4. **剧本门位置**：STAGE-CHECKLIST 的 S5 第一步命令= `node scripts/check-env-ready.mjs docs/pre-device/env-ready.json`；真机 agent 回报必须含该命令原始输出。L1 断言：该命令字符串在 STAGE-CHECKLIST S5 节存在且带 `[human→local]` 标签。
5. **三向对齐**（E 类独有检查）：OWNER-GUIDE 每个确认点的「通过判据」列 ↔ env-ready schema 的键 ↔ S 剧本引用点，三者名字面一致。机检：从 schema 抽键名集合，断言每个键在 OWNER-GUIDE 中出现且在 STAGE-CHECKLIST 对应阶段出现。这防的是「人类照 A 文档填，agent 照 B 文档查」的错位——正是 env-ready 机制要消灭的失配的元版本。

### 3.3 机制级测试（不需要真机即可全演练）

env-ready 校验器是纯函数 → **S4→S5 的门在本机可全真演练**：构造全绿/缺 `vpn_dialog_seen`/填 false 三种样本，断言门分别放行/拦截/拦截。「人做没做」=JSON 里有没有 true——机制的证明不需要人。

## 4. 交接包假命令/死地址检测自动化（D 类元测试）

### 4.1 黑名单（否定断言；扫描面=PLAN §0.1 活文档面全集，含新增 docs/pre-device/）

| pattern | 毒点出处（我亲验） | 注意事项 |
|---|---|---|
| `203\.0\.113\.10` | HARMONY_AGENT_TASK.md:13/:68/:71（TEST-NET-3） | 简单字面 |
| `UPLOAD-TOKEN-REDACTED` | 同 :71 | 已 scrub 令牌不得再引用 |
| `git://` | 同 :13 | git 协议克隆 |
| `238` | :9/:49 | **数字类黑名单要防误伤**：`238` 可能出现在哈希/行号语境；建议带语境 `238/238` 与 `六包` 双条目，且仅扫活文档面（历史档案面豁免，见 §4.4） |
| `六包` | :9/:82/:88 | 字面即可 |
| `hvigorw assembleHap` | owner-with-real-device.md:60 | **精确串级**：P0-6 修法允许 `hvigor assembleHap`（无 w）——黑名单条目必须禁 `hvigorw` 而放过 `hvigor `，不能一刀切禁 hvigor |
| `@ohos\.net\.vpn([^Ea-z\w]|$)` | owner-with-real-device.md:47 | **前缀陷阱（§0 亲验）**：`@ohos.net.vpn` 是 `@ohos.net.vpnExtension` 的前缀，裸 grep 把正确行也抓进来，开发者会「修门」而不是「修文档」；必须边界断言。禁用 grep -P（P0-4 纪律：CI 与人工同工具），`grep -E '…[^E]|$'` 够用 |
| `dev-env-with-gpu` 出现在 docs/pre-device/ | agent-interop-regression.md:9-11（owner 环境别名） | O7 未答前不得预写死主机别名进真机任务书 |

### 4.2 白名单（肯定断言——只查「没有毒」会漏「没有药」）

1. 真克隆地址：`github.com/feasy898/ohos-tailscale` ≥1 命中于 AGENT-TASK.md（数据源=我亲验的 origin remote；**以 `git remote get-url origin` 运行时取值为准，不硬编码**——防 remote 将来变更时白名单自己变成假阳性源）。
2. 现行数字：`8 包|495|30|66` 于 AGENT-TASK/README 各 ≥1（与 A16 正向锚定互补，A16 只做否定断言）。
3. `@ohos\.net\.vpnExtension` 于 AGENT-TASK ≥1（有白名单后，前缀陷阱的残余风险只剩「拼错全名」，黑名单边界断言兜底）。
4. Day1 命令完整性：AGENT-TASK 的 Day1/Day1 等价节必须含 `typecheck:bridge`（轨迹3 F16 漏项的防再犯钉）。
5. 版本钉死：`v0\.29\.4` 出现在 agent-interop-regression.md 至少一条可执行命令行内（P1-9 验收的常驻化）。

### 4.3 结构断言与标签闭包（check-stage-docs.mjs 的六断言）

1. 标签闭包：STAGE-CHECKLIST 每条命令带 `[local]/[device]/[human]` 标签；**从 AGENT-TASK 代码块抽出的命令行 ⊆ 标签全集，差集空**（P0-6 验收原文）。抽命令的启发式（代码块内以已知动词/命令名开头的行）有漏报风险——负对照：STAGE-CHECKLIST 加一条无标签命令→红；AGENT-TASK 塞一条剧本外命令→红。
2. CU 卡二值分支无空占位（§2.3）。
3. OWNER-GUIDE S0–S8 每阶段「人提供/人决定/通过判据」三小节齐备（结构 grep）。
4. 交接包内相对链接目标存在（`docs/pre-device/*.md` 引用的 schema/spec 文件逐一存在；可顺带全仓 handover 面）。
5. DECISIONS.md 含 D1–D13 逐条 + O1–O7 签署栏（可空但必须存在且标「待拍板」）。
6. 判定树完备性（§2.5，可同脚本或独立脚本，倾向独立以保持单一职责）。

### 4.4 扫描边界（防门爆红）

黑名单只扫活文档面（README/CONTEXT/TASK/DELIVERY_REPORT/HARMONY_AGENT_TASK/docs/handover/docs/pre-device/docs/architecture.md）；历史档案面（baseline-audit/pre-device-plan/research/worklog）豁免——它们是证据不是说明书（PLAN §0.1 术语表）。**本思考文件自己所在的 docs/pre-device-plan/ 引用了毒串做举证，正是豁免必要性的现成例子。**

## 5. holdout 机制（真机侧侧重）

### 5.1 划分原则（共性必答 1）

- **必须可见**：判据被 PLAN 明文写成命令级的（A1–A16）；文档防毒黑/白名单（§4——毒点已在 BASELINE 公开，无保密价值，公开反而让修复者可自查）；判定树结构自检（防的是疏忽不是作弊）；env-ready 机制演练（§3.3）。
- **必须 holdout**：①负对照样本全集（开发 agent 应知道「门有负对照」但不应知道全集——防定点绕过，例如知道要注入 `Date.now()` 就可能顺带把注释过滤器改宽）；②真机证据抽验的采样参数（见下）；③已知陷阱的变体再生集（把 BASELINE 缺陷换壳再注入，测门鉴别力而非测门存在）。
- 原则一句话：**凡是「注入已知缺陷看门抓不抓」的测试，缺陷样本集本身是保护对象；凡是「断言结构存在」的测试，公开无损。**

### 5.2 真机侧 holdout 的特殊性（本视角核心）

真机 agent 是**唯一能接触真机的人**——holdout 无法对它保密执行环境，它能看到全部真机产物与留证。结论：**真机侧 holdout 的保密点必须从「测试内容」移到「采样不可预知」**。真机 agent 知道「会被抽验」但不知道抽哪几条、按什么规则抽。

### 5.3 存放与保密（共性必答 4）

- **holdout 本体永不入仓**（owner 手持：本地私有目录或仓外私有库）。理由不只是防读：**git 历史不可撤**——BASELINE §7 oracle/raw 教训（filter-repo 之后「曾存在/从未提交」本地无法分辨）。一旦 commit 过，禁读声明形同虚设。
- 仓内只留**存在性声明**：EVIDENCE-SPEC 写一句「验收含 holdout 抽验，内容不公开」，无内容无指纹（连 sha256 都不留——指纹+公开的判定逻辑=可反推内容）。
- 「开发 agent 禁读」的落实机制=**物理不在其可达面**：开发 agent 拿到的 clone（origin main）天然不含 holdout；本机开发 agent 的工作目录同样不投递 holdout 文件。不依赖任何「禁读指令」类软约束——软约束对一个会 `grep -r holdout /` 的 agent 无效。
- 本机侧负对照全集同理仓外保管；CI 里只跑门本身，负对照由门的 `--selfcheck` 内置最小集承担（内置集=防回归的下限，仓外全集=验收时的加强集，两层不冲突）。

### 5.4 holdout 判定清单草案（真机侧）

owner/合并人在真机 agent 回传后、验收签字前执行（每条对着留证文件离线可判）：
1. 采样抽验：对 HARMONY_PC_REPORT 的「实测发现」按**验收时才定的哈希种子**（如 evidence 文件名 sha256 排序取模）抽 2–3 条，逐条要求 evidence/ 有原始输出文件且**字节级含**报告引用的字符串（防转述造假/绿灯幻觉）。
2. 双侧指纹一致性：S2 Node 侧 summary 与 S6 真机侧 summary 的环境指纹四元组（E4）字段齐且可比（headscale 版本一致、脚本 git sha 一致）。
3. 敏感边界：evidence/ 内 `preauthkey|authKey|BEGIN PRIVATE` 0 命中（E5 的机器侧；诚实标注：值未知时这是弱检查，配合 manifest 声明字段用）。
4. 判定树走查：抽 1 条报告里的报错原文，反向确认能在判定树找到对应分支（树外报错应有升人记录，若无=agent 违树自走，按 PLAN §3.4 精神该批证据降级）。
5. 反模式扫描：`makePeerServer(null)|as unknown as` 在最终 diff 中 0 命中（AGENT-TASK 反模式清单的验收侧执行）。

## 6. 机检集成（共性必答 3）

npm scripts 增补（命名对齐 PLAN 已定名，新增的用语义前缀）：

| script | 出处 | CI 位置 |
|---|---|---|
| `validate:arkts` | P0-3（已定名） | g0 job 新 step（G0-4 后） |
| `gate:d4` | P0-4（已定名） | **替换** G0-5 内联块（yml 无裸 grep 成为验收） |
| `interop:regress -- --selftest` | P0-5 | CI 不跑（离线自检进 A8/gates） |
| `check:stage-docs` | P0-6（PLAN 写 `node scripts/check-stage-docs.mjs`，建议同时注册 npm script 便于 gates 聚合） | 新 step（建议紧邻 docs-consistency，同属文档面） |
| `check:decision-trees` | 本文新增（§2.5） | 同上或并入 A11 门 |
| `check:env-ready` | 本文新增（§3.1） | 不进 CI（无样本可校），进 gates 的自演练模式 |
| `interop:evidence` | P1-11 evidence-manifest.mjs | gates 聚合含（对仓内既有 evidence 目录校验，无则 SKIP——SKIP 必须显式输出非静默） |
| `gates` | P1-14（已定名） | 聚合入口；真机 agent S0 与本规划 A 类验收共用同一判据 |

CI step 编号现状是 G0-1…G0-6 + docs-consistency（yml 亲读）；新增 step 建议**用语义名不抢编号**（编号已漂过一次：注释还写「五门」实际六 step——BASELINE 4.4）。A11 门=`check:stage-docs` + `check:decision-trees` 合并判定。

## 7. 判定标准（共性必答 5）：谁跑、何时跑、什么算过、失败处置

| 跑者 | 何时 | 跑什么 | 过的标准 | 失败处置 |
|---|---|---|---|---|
| 开发 agent（本机） | 每完成一项 / 每批收口 | 相关分门；批次四后 `npm run gates` | exit 0 + 负对照自检绿 | 停在当前项修到绿；不硬改测试凑绿（红线继承） |
| CI | push/PR | G0 全 step + 文档门（P1-3 后阻断） | step 全绿 | 红=合流被拦；与本地 gates 数字不一致时以 CI 为准并查环境差 |
| 真机 agent | 每阶段执行时 | S1 自检门；该阶段机检命令；S5b 后 evidence-manifest 自检 | 每阶段判据=其四要素表的「判定」栏 | 自检红→停在该阶段按树走；连续 2 次无进展→D10 升人；**PROTOCOL_REJECT 严禁改脚本凑 PASS** |
| owner/合并人 | 真机回报后、验收前 | holdout 清单（§5.4）+ O1–O7 核对 | 抽验全过 + 签署齐 | holdout 红→该批证据作废重验（沿用 PLAN §3.4「违反即作废全批」先例）；O 未签署→验收不成立（R14） |

真机 agent 自跑 vs 本机事后验证据的分界线：**凡是纯文本/纯命令可重放的（marker、summary、grep、JSON 校验）→ 事后验证据即可，不需要真机在场；凡依赖设备物理状态的（弹窗出现、hdc install 成功、真机 perf）→ 只能采信带环境指纹的原始留证，holdout 抽验是唯一复核手段**。这条分界就是四要素表「判定」栏的填写规则。

## 8. 逐工作项测试设计思路（共性必答 2：全部 P0 + 关键 P1）

- **P0-1**：C 类。验收三断言（A3 exit 0 / test:bridge 31 且畸形 q 行为零漂移 / yml 含 step）。防假绿核心=**正控制组**（合法 q→200）——它同时是「测试的测试」：把 e136900 拔安全钉的路径堵死（R2）。holdout 候选：holdout 可要求「临时回退 :245 → typecheck:bridge 必须红」证门鉴别力；可见侧用 `--selfcheck` 内置负例即可不必 holdout。
- **P0-2**：C 类。grep 0 命中（我亲验当前恰 2 命中、无注释误报）+ netcheck 84 例钉语义。测试设计风险提示：验收 grep **无注释过滤器**——与 BASELINE 5.2-4 死过滤器教训同族；倾向保持 filterless（注释里写 `yield ` 触门=廉价误报，可接受；过滤器=昂贵复杂度），是否加显式豁免→U5 合并人裁。
- **P0-3**：C 类+D 类交叉。双面门 + 五负例逐个被抓。负例承载方式→`--selfcheck` 内置（§9-3）。D 类交叉：kit-stub.d.ts 头注释必须含「首构日回报 stub 与真实 d.ts diff」承诺——这句是 B 类留证要求（S3 报告须含 stub diff 节），check-stage-docs 应断言该句存在。
- **P0-4**：C 类。gate:d4 绿 + 负例 fixture 红 + yml 无裸 grep + `bash -n` 过。负例 fixture 用临时文件写死两个样本（`Date.now()` 非注释行 / `from 'net'`）——这两个样本可公开（判据已写死在 A7），与 §5.1 划分一致。
- **P0-5**：C 类+L2 底座。五断言 selftest + 无 HS 时 `ENV_UNREACHABLE` 可归因 + 红→绿轨迹入 worklog（**grep worklog 是验收的一部分——门有效性证据本身是被测物**，R13 的测试化）。L2 关联：summary 六字段是 S6 归因的数据结构；我发现的 tmpdir 断点（§0）应补进验收→U6。
- **P0-6**：D 类主战场。check-stage-docs 六断言（§4.3）+ 黑/白名单（§4.1/4.2）+ 三处 owner 文档修复的反向断言。E 类交叉：OWNER-GUIDE 三栏断言。
- **P0-7**：C 类。`git check-ignore` 两断言（A14 原文）——一行门，测试成本最低、漏测后果是整条证据链空转（R6），属「最便宜的最重要门」。
- **P0-8**：C 类。不崩 + 假 SDK 路径报「路径不存在」+ SKIP 可读。注意验收口径：exit 0 带 SKIP **或**明确非崩溃退出码——测试须钉死一种（建议：SKIP 语义下 exit 0 + stdout 含 `SKIP` 与缺失变量名，避免「非崩溃退出码」这种多义判据进 CI）。
- **P1-1**：C 类。test:kat 全绿 + `grep -rn "node:" packages/kat/src` 0 命中 + validate:arkts (a) 面 0 命中。L2 关联：KAT 是「真机绿→Node 绿→才说一致」的证据链节点（S5b），KAT 结果结构必须 JSON 可序列化（真机外壳留证格式的前提）——建议补此验收：`runKat()` 返回值可 JSON.stringify。
- **P1-4/P1-5**：C 类。test:bridge/typecheck:bridge 门内。P1-5 的 D13 随机留痕钩子有 L2 断言：STAGE-CHECKLIST S5b 必须含「随机字节快照落 evidence」命令（否则钩子无人触发，D13 复现包空转）——建议进 check-stage-docs 断言集。
- **P1-6**：D 类。CU 卡四要素+二值无空占位（§2.3）。
- **P1-7**：C 类。`--dry-run` 输出清单且不落盘（`git status --porcelain` 干净作为留证断言）。L2 关联：CU6 判定树引用此工具——树内工具存在性自检（§2.5 第 5 条）覆盖。
- **P1-8**：C 类。A12 listFiles ≥3 + 例外清单逐条理由。摸底数字先入 worklog（先摸底后纳入的测试侧含义：**第一次跑 tsc 的错误数本身要留痕**，否则「修了多少」不可归因）。
- **P1-9**：D 类+C 类。`grep -c "0.0.0.0" interop/headscale.yaml` = 0；device.yaml 存在且 server_url 非 127.0.0.1（这是**唯一一处肯定要求含 0.0.0.0 语义相反断言的地方**——device.yaml 的 O3 豁免与基线红线的方向相反，两个断言必须写清楚各自扫哪个文件，防测试自己张冠李戴）；env-check 无 docker 逐项 SKIP exit 0；版本号在可执行命令（§4.2-5）。
- **P1-10**：C 类。manifest 覆盖 + lineref AU1–AU3 绿 + UNRESOLVED 58 份登记（不补文件只登记——防伪证的测试表达：**UNRESOLVED 条目数与 upstream 目录文件数的差值断言**）。
- **P1-11**：C 类+L2 核心。三类缺陷样本各报错 + 合法样本绿 + evidence 无则 SKIP 显式。这是 holdout §5.4-3 的工具载体。
- **P1-12**：D 类+E 类。OWNER-GUIDE 三栏脚本断言 + schema 可加载（§3）。三向对齐检查（§3.2-5）归入此门的测试。
- **P1-13**：C 类+L2。ArkTS 源码过 validate:arkts；Node 参照数字**只断言记录存在不断言值**（D12/R10 的门侧表达，§2.3）。
- **P1-14**：C 类。弄红一分门→聚合红（负对照）+ 全绿⇔exit 0 双向。
- **P2-1/2/3**：常规 C/D 类；P2-3 事实卡进活文档面黑名单扫描范围（含 bundleName 双处一致性可机检：app.json5 与 module.json5 字面比对——V6 已有，事实卡与其无矛盾=字面一致）。

## 9. 设计备选与放弃理由

1. **把 S0–S8 做成 npm scripts（`stage:s5`…）**——放弃：剧本混合人类动作/真机命令/判定，npm 化产出一堆只能 exit 1 的空壳，制造「已自动化」幻觉；真机 agent 需要的是带标签的检查表+每步独立机检命令（§2.4 采纳形态）。
2. **holdout 进仓但加密/混淆**——放弃：混淆防不住能读脚本的 agent，且违背仓内可复现纪律；git 历史不可撤（§5.3）。物理不入仓是唯一可靠机制。
3. **负例用临时文件注入 vs 门内置 `--selfcheck`**——采纳后者为主：临时文件方式依赖执行环境（Windows 路径/清理残留/CI 工作目录权限），且容易被后续开发者「清理」掉导致负对照消失；内置样本字符串随门走，门在哪自检在哪。保留临时文件方式作仓外 holdout 加强集（§5.1③）。
4. **判定树自制 DSL**——放弃：文档描述与 DSL 双源必然漂移（BASELINE 文档漂移 8 处的教训推广）；markdown 受限子集让文档即数据。
5. **真机 agent 复跑 495 例作验收**——放弃（D11 已裁）：CU8 未答（node:test 在 ArkTS 可用性未知）时把未知数放进验收路径是循环依赖；KAT 双 runner 是正确分层。
6. **对 S3 报错面写死报错白名单门**——放弃：报错面在仓外不可预知（PLAN B7 强定义），白名单门必假红/假绿；树+升人出口是唯一诚实形态。
7. **黑名单一刀切禁 `hvigor` / 禁 `@ohos.net.vpn`**——放弃：前者误杀 P0-6 修法允许的 `hvigor assembleHap`，后者前缀误杀 `@ohos.net.vpnExtension`（两处均 §0 亲验）；精确边界是必须的。

## 10. 不确定性与需合并人裁决的点

- **U1 S3.0/S3 纯 GUI 构建的留证形态**：commandline-tools 存在时 `hvigor assembleHap` 有 stdout 可留证；纯 DevEco GUI 时无文本流。建议 EVIDENCE-SPEC 引入 `machine_checkable: false` 诚实降级字段（类比 E6 ran=false），降级时留证=界面文本抄录+截图、判定升人类目验——但降级格式与触发条件需合并人定稿。这是真机侧最难完全机检化的一点，我未找到第三条路。
- **U2 判定树载体格式**：我建议 ```tree 代码块+节点行约定（§2.5），解析器规范（缩进容差、行文法）需合并人定稿后才能写 check-decision-trees.mjs。
- **U3 holdout 宿主**：owner 本地目录 vs 仓外私有库 vs 合并人手持——涉及谁能验收，超出我可裁范围。
- **U4 env-ready schema 表达力**：扁平键+enum/pattern 足够 S4/S5 场景；若合并人预期嵌套结构（如按阶段分组），校验器复杂度上升一档。我建议一期扁平（键名带阶段前缀如 `s4.signing_mode`）。
- **U5 P0-2 验收 grep 的注释豁免**：filterless（我倾向）vs 显式豁免清单（BASELINE 5.2-4 教训的另一解）。
- **U6 regress summary.json 落盘断点（本文新发现）**：regress.mjs:71-74 写 tmpdir + agent-interop-regression.md 归档不含 summary.json 原件 → PLAN §3.4「summary.json（原件）入 evidence」当前不可满足。建议 P0-5 验收补一条：`--out <path>`（或环境变量）指定 summary 落盘路径，且 P1-11 校验器断言 evidence 目录内 summary.json 存在并与 regress.log 同批（时间戳/阶段字段一致）。是否并入 P0-5 范围由合并人裁（属对其验收条款的增补）。
- **U7 `seed` remote**：本地路径 remote 是否入黑名单/是否应提示 owner 清理，超出测试设计范围，仅登记。

## 11. 收束：本视角的一句话

真机侧测试设计的本质是**把「将来才发生的测试」今天造成「可机检的容器」**：判定树今天测完备性，剧本今天测标签闭包与命令真实性，人类配合今天测机制演练，真机答案天然以 marker/JSON/原始输出落盘，holdout 保密的不是题库而是采样——最后一切回归到 PLAN §3.4 那句防绿灯幻觉的铁律：贴原始输出，不贴结论。
