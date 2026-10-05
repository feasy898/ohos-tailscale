# 思考轨迹 2：app/ 壳从「从未编译」到「真机 agent 拿到即可编译运行」

> 视角主轴：壳构建就绪性 / mock→真实适配层 / TUN fd 接线 / 禁则机检 / 真机 agent 契约。
> 读者：GLM53 合并人。这是推理过程，不是成品规划。2026-10-03，基线 git 90ed53e。

## 0. 我跑了什么（本会话实证清单）

先报实验，后报推理——本文每个关键结论都能落到下面某一条。

| # | 命令/实验 | 结果 |
|---|---|---|
| E1 | `npm run validate:shell` | `summary: 66 passed, 0 failed`，exit 0（与 BASELINE §2.6 一致） |
| E2 | `npm run test:bridge` | `# tests 30 / # fail 0`，exit 0（与 BASELINE §2.5 一致） |
| E3 | `npm run typecheck:bridge`（重定向后取真实退出码） | **exit 2，TS2353 @ app/bridge/test/peerapi-tun.test.ts(246,5)**（与 BASELINE §2.4 一致；第一次管道接 tail 吞了退出码显示 0，重跑修正） |
| E4 | /tmp 探针工程：tsc `include: ["**/*.ets"]` | **TS18003 no inputs**——tsc 默认扩展集不含 `.ets`，直接检查不可行 |
| E5 | 同工程，`.ets` 镜像拷贝为 `.ts` + `erasableSyntaxOnly` + strict | **exit 0**：A5 `let x!: T`、A7 解构、A18 `as const` 全部放行 |
| E6 | 同工程加 `enum Bad {A=1}` 探针 + `@kit.NetworkKit` stub（`declare module`）+ 类型错误探针 | **TS1294（enum 拦）+ TS2322（类型错拦）**，@kit 导入经 stub 正常解析 → exit 2，两条拦截都真实生效 |
| E7 | 同工程加 ArkUI `struct Index { @State ... }` 探针 | **TS1146 Declaration expected**——`struct` 非法 TS 语法，ArkUI 页面无法直接镜像过 tsc |

E4–E7 是 BASELINE 之外的新实证，直接影响 §4 的 P0-2 工作项形态。

## 1. 事实认定（每条带出处）

### 1.1 壳的构建配置：骨架完整、静态一致、语义零验证

- 配置齐全：工程级 `app/build-profile.json5`（signingConfigs 空、`compatibleSdkVersion: "5.0.0(12)"`、`runtimeOS: "HarmonyOS"`、strictMode 两项）、`app/hvigor/hvigor-config.json5`（modelVersion 5.0.0）、两级 hvigorfile（appTasks/hapTasks）、`app/oh-package.json5` dependencies 空、`app/entry/oh-package.json5` 只有 TODO 注释（候选写法 `"@ohos-tailscale/common": "file:../../packages/common"`，:9-11）。
- 模块清单：`module.json5` 声明两权限 INTERNET/GET_NETWORK_INFO（:19-21，均 normal/system_grant）+ EntryAbility + VpnExtensionAbility `"type": "vpn"`（:51 段）。
- 静态一致性已被机检：validate:shell V1 配置可解析/V2 模块清单/V3 权限/V4 路由/V5+V5b 资源对账/V6 bundleName/V7 ability 名/V8 图标（`app/tools/validate-shell.mjs:7-15` 头注）；V9 的 12 条管 bridge 纪律（:242-272）。**但这 66 检全是「自洽性」检查——没有任何一项验证配置符合 hvigor 真实 schema**。E1 复跑 66/0 证明校验器活着，不证明壳能编译（BASELINE §3.2「实测可用的是校验器，不是壳本身」）。
- .ets 现状：3 文件 322 行。Index.ets:40 自述「核心库尚未接入」；**entry/ 的 .ets 目前不 import 任何 @ohos-tailscale/* 包**（grep 亲验），即壳与 bridge 目前零耦合——bridge 只活在 Node 侧。
- VpnExtensionAbility.ets:41-43 三空数组 + TODO「真实调用会失败——桩仅示意流程」（BASELINE §4.2 亲读一致）。

### 1.2 编译不可达是三卡点，不是态度问题

`docs/build-feasibility-linux.md`（2026-10-01 GPU 机实测 curl 状态码）：卡点 A 商业 SDK 登录墙（commandline-tools/SDK 需华为账号）；卡点 B `repo.huawei.com`/`mirrors.openharmony.cn` 整域不可达；卡点 C `@ohos/hvigor` 不在任何可达 registry（npm/npmmirror 均 Not found）。结论（:47-50）：GPU 机「不可得」，真编译需 owner 裁定的账号+出网环境。

**对我的推论**：`app/hvigorfile.ts` import 的 `@ohos/hvigor-ohos-plugin` 本机永远装不上（禁止 npm install 也不解决——包根本不在公共 npm）。所以壳构建链**在本机是结构性缺失**，前置工作必须以「不依赖 hvigor 可验证」为设计约束。这是本文全部取舍的第一约束。

### 1.3 bridge：接口冻结度比想象的高，但只冻结了「壳侧半边」

- `app/bridge/src/index.ts` barrel 导出八块（:18-97）；`ShellSessionParams`（shell-session.ts:44-63）已经把控制面注入面钉死：controlUrl/machineKeyPair/nodeKeyPair/discoKey/serverStaticPublic/authKey/`transport: HttpTransport`(:58)/`clock: Clock`(:60)/`rng: Rng`(:62)。HttpTransport/Clock/Rng 是 common 冻结接口（architecture.md:118-151，R2 裁定平台实现不进 common）。
- 数据面窄接口已存在：`TunDevice`（mock-tun.ts:51-65，单包同步 read/write/mtu/name/close/isFake，锚定 wireguard-go tun.Device + net/tstun fake/wrap）；`UdpDatagramBus`/`UdpSocket`（mock-udp-bus.ts）。但 mock-tun.ts:28-31 明示两个 PacketFilter 函数体属二期，mock 以注入式谓词钩子表达挂点。
- **缺口一**：bridge 的 30 用例测的全是 mock 装配 mock（BASELINE §3.2「仅 mock/桥接形态」），没有任何「真实实现如何插进来」的形态物——mock 与真实实现之间没有共同的 port 命名/目录约定，真机 agent 要自己发明。
- **缺口二**：`typecheck:bridge` 红灯 exit 2 且不在 CI（BASELINE 缺陷 #1；E3 亲证）。壳线的一切 TS 纪律都建立在这个 tsconfig 上，它红着——前置工作绕不过它。
- **缺口三**：netmap → VpnConfig 的组装函数不存在。control 包已有 wgderive（netmap→WG 推导，BASELINE §3.1），但 wgderive 输出到 `vpnExtension.VpnConfig{addresses,routes,dnsAddresses,mtu}` 的映射（壳侧最后一跳）无实现无测试，桩里只有注释（VpnExtensionAbility.ets:33-39）。

### 1.4 禁则机检 vs 官方 linter：差距的形状（E4–E7 定义的形状）

- 官方 ArkTSLinter 需 SDK（arkts-linter-rebuild.md 全文）；`interop/arkts-check.js` 本机 exit 1（ESM/CJS 冲突 + 硬编码 WSL 路径，BASELINE 缺陷 #4）。所以「等官方 linter」在本机不是选项。
- `.ets` 目前**零编译器覆盖**：根 tsconfig `exclude: ["app"]`（BASELINE §4.2），bridge tsconfig 只管 .ts。
- E5/E6/E7 给出差距的精确形状，分三层：
  1. **tsc 镜像可拦**：enum/namespace/参数属性（erasableSyntaxOnly TS1294）+ 全部类型错误（strict）+ 可带 @kit stub 解析导入；
  2. **tsc 镜像拦不住**：A5/A7/A8/A9/A13/A14/A18/A25/A26/A30 这类**语义禁则**（「可擦除」≠「ArkTS 合规」——E5 实证三者全放行），需自写 AST/正则检查器；
  3. **tsc 解析都过不去**：ArkUI `struct`/`@Entry`（E7 TS1146）→ Index.ets 要么做 struct→class 文本转换，要么退到行级正则扫描。
- CU/U 清单（arkts-constraints.md §6，:798 编号说明）：U2 BigInt/U3 TextEncoder/U4 Web API/U5 Object.keys/U6 .ts specifier/U7 平台 Clock-Rng/U8 hypium——本质全是「必须 DevEco/真机的未知数」，文档自己警告「不得当既定规则执行」。前置工作的正确定位是**把它们变成首日便宜实验**，不是提前猜答案。

### 1.5 已有交接资产及其漂移（重写素材，不宜从零起）

- `HARMONY_AGENT_TASK.md`：自包含真机任务书雏形（环境判定→首构→CU6→回传三通道→红线），结构可继承；但 :9 写「六包 238/238」（BASELINE §6 勘误表点名：应为 8 包/495，按它验收必误判）；:33 说 entry 的代码已 import @ohos-tailscale/*——与 1.1 的实况（零 import）不符，CU6 的验证载体描述超前于现状。
- `docs/handover/owner-with-real-device.md`：人类前置清单（DevEco 6.x/SDK/真机开发者模式/hdc）+ Day1-7 依赖序 + 红线，可用作骨架；:47 把替换目标写作 `@ohos.net.vpn`（实际 API 是 `@ohos.net.vpnExtension`，VpnExtensionAbility.ets:9 亲读），agent 照抄会走错门。
- 回传通道（git push / HTTP 收件箱 / 粘贴兜底）已在 HARMONY_AGENT_TASK §6 成型，直接复用。

### 1.6 一个值得写进规划的错位认知

「真机 agent 拿到即可编译运行」如果被读成「真机首编译零报错」，那是做不到的：手写骨架对 hvigor 真实 schema、SDK .d.ts 签名、DevEco 版本基线的偏差是结构性的（README-app.md §6 列了 11 项未验证、HARMONY_AGENT_TASK.md:29 自己说「首次构建必然报错」）。**可做到的强定义是**：报错面已被压缩到可枚举、每类报错有预案和判定标准、决策点都有分支工具。本文所有工作项都朝这个定义收敛。

## 2. 目标拆解思路

**第一刀：按「可验证性」切，不按「模块」切。** 编译不可达（1.2）逼出二分：

- **能在 Node 侧机检/测试的** → 前置做掉，且做成可重复执行的门禁（不是一次性动作）——因为后续开发由别的 agent 执行，人类不再盯过程，唯一可信的交接物是「跑这条命令必须绿」。
- **必须 DevEco/真机才知道的**（CU2/5/6/7/8、hvigor 首构报错、签名、授权弹窗）→ 不硬闯，转成三件东西：最小探针 + 判定标准 + 分支预案，打包进真机 agent 任务书。

这一刀和 BASELINE 的五级验证口径同构：前置工作本质是把 1/2 级（实测可用）的地盘最大化，把 3/4 级（mock/仅文档）显式标注后移交。

**第二刀：壳的前置工作分三条线**（对应我的专属任务四个覆盖点）：

- 线 A **构建与机检就绪**（hvigor/oh-package/禁则机检）：把「未知的报错」变成「已枚举的报错」。
- 线 B **接口冻结与适配层设计**（bridge→真实、TUN fd 接线）：把「mock 的经验」变成「真实的插槽」。
- 线 C **交接物**（agent 任务契约 + 人类配合说明书）：把线 A/B 的产出装配成「真机 agent + 人类」两个角色都能执行的包。

**为什么不是按 app/ 文件树切**（build-profile 一个工作项、module.json5 一个工作项……）：因为文件的修改几乎都发生在真机 agent 手里（首构修复），前置阶段的文件工作只有三类——加机检、加纯函数、写文档——按线组织才能说清每件的验收门。

## 3. 备选方案与取舍（含否决项）

### 3.1 【否决】预执行 README-app §4 的某个核心库集成方案

考虑过：现在就把方案 2（packages 源码镜像进 entry + .ts→.ets 重命名）跑掉，agent 到手即编译。
否决理由：(a) CU6（ets loader 是否接受 .ts specifier）答案未知，若「接受」则方案 1（ohpm file: 依赖）更干净且无需镜像，预执行方案 2 白做还要回滚；(b) 预生成的镜像文件会立刻污染 validate:shell 的检查面并制造双源真相；(c) build-feasibility 明示集成方式验证属「拿到环境后按原文验证」的 owner 裁定项。
**采纳**：工具化不预执行——把方案 2 的机械部分做成生成脚本（镜像 + 后缀改写 + specifier 同步），三方案各配一行「什么证据出现就选它」的判定规则（§4 P1-6）。agent 首日跑 CU6 探针，按结果选方案。

### 3.2 【否决】等官方 ArkTSLinter / 修好 arkts-check.js 再说机检

arkts-check.js 连模块都加载不进来（BASELINE 缺陷 #4），修它只恢复「09-29 那条通道」，且它本身要 SDK。前置阶段不该把任何门禁押在「需要 SDK 的工具」上。
**采纳**：本机 tsc 镜像 + 自写禁则扫描（P0-2），官方 linter 降级为真机侧 Day 2 动作（handover 文档已有此安排）。

### 3.3 【否决】把 VpnConfig 组装逻辑写进 packages/（或改 wgderive）

packages 八包接口冻结（handover 红线、architecture.md §8），壳侧语义不回灌。
**采纳**：放 app/bridge 作为纯 TS 函数 + node:test 用例——bridge 的定位本来就是「壳侧半边」（bridge/README 头注），且这样它能进 test:bridge/typecheck:bridge 两个既有门。真机 .ets 侧只消费。

### 3.4 【权衡】@kit stub 的假绿/假红风险

E6 证明 stub 可行，但 stub 签名是我手写的，与真实 SDK `.d.ts` 必有漂移：假红（stub 比 SDK 严）浪费 agent 时间排查幻影错误；假绿（stub 比 SDK 松）给人虚假安全感。
**处置**：(a) stub 只覆盖壳现有 3 个 .ets 用到的 API 面（Want/vpnExtension 三方法/hilog/promptAction/BusinessError——surface 很小，亲数不到 15 个符号）；(b) stub 文件头与产出报告都明示「stub 是语法/结构级保障，API 签名以真机 SDK .d.ts 为准」；(c) 首构日把 stub 与真实 d.ts 的 diff 列为回报项，反向校准 stub。这个权衡我认为值得做——322 行的壳在真机前完全无编译反馈，代价太高。

### 3.5 【权衡】Index.ets：struct→class 转换 vs 排除出 tsc 面

转换（E7 后的正则预处理）能把 Index.ets 也纳入 tsc，但转换器本身成为新故障点，且 @State/@Link 等装饰器语义 tsc 完全不懂，收益边际递减。
**采纳**：Index.ets 退到行级正则禁则扫描 + validate:shell 的 V4/V5/V6/V7 既有资源面机检；tsc 镜像面只收 EntryAbility/VpnExtensionAbility 两个纯类文件（协议接线的主体恰恰在这两个文件）。

### 3.6 【否决】现在写「真实 adapter 的 .ets 骨架代码」进 entry/

写了没有编译器验证它，等于新增一批「第 12 项未验证事项」；真机 agent 反而要先读懂再判断对错。
**采纳**：adapter 的**可验证部分前置**（VpnConfig 组装纯函数、port 接口 TSDoc 契约、错误码处理表——都是 TS/文档，可机检可测试），adapter 的**不可验证部分**（@ohos API 调用薄壳）留给 agent 按契约写。边界判据一句话：**决策逻辑进可测纯 TS，副作用薄壳进 .ets**。

## 4. 建议工作项与验收门（P0/P1/P2，保留推理链）

### P0-1 修 typecheck:bridge 红灯并把它放进 CI 门

BASELINE 缺陷 #1 的标准修法已给（:245 传参改合法 answerDns 形态 + g0-gates.yml 加 step）。放 P0 的壳线理由：P0-2/P0-3 全部要靠这个 tsconfig 兜底，红灯不清，新工作没有干净地基。验收门：`npm run typecheck:bridge` exit 0；g0-gates.yml 含该 step。

### P0-2 .ets 机检门（本视角核心新增项）：`npm run validate:arkts`

按 E4–E7 的实测形状实现 `app/tools/ets-mirror-check.mjs`：
1. 镜像 `app/entry/src/main/ets/**/*.ets` → 临时 `.ts`（文件名带 `.mirror.` 避免误入其他门）；
2. Index.ets 的 `struct` 做最小文本转换（`struct X` → `class X`）或按 3.5 排除——实现时两法都试，取在 E7 探针上稳定者；
3. 配 `@kit` stub d.ts（types/kit-stub.d.ts，面 = 壳现有 import 面）+ `erasableSyntaxOnly` + strict 跑 tsc；
4. 附加语义禁则扫描（E5 证明 tsc 拦不住的）：A5 `let x!:`、A7/A8/A9 解构、A13/A14 索引访问、A18 `as const`、A25 throw 非 Error、A26 catch 标注、A30 Symbol/globalThis、A33 @ts-ignore——可用 typescript compiler API（对能解析的文件）+ 行级正则（对 ArkUI 文件）双轨；
5. 现有 3 个 .ets 全过（应为零违规——README-app.md §1.5 自称按禁则写，正好反向验证机检器灵敏度）。
验收门：`npm run validate:arkts` exit 0；向探针注入违规样本（E5/E7 的写法）能被抓（负对照）。CI 加 step。

### P0-3 VpnConfig 组装纯函数 + 测试（桩空数组的第一块真肉）

新增 `app/bridge/src/vpn-config.ts`：`buildVpnConfig(netmap, opts) → {addresses, routes, dnsAddresses, mtu}`，消费 control 包 wgderive 输出；地址语义用 common 常量（CGNAT 100.64.0.0/10、ULA fd7a:115c:a1e0::/48、MagicDNS 100.100.100.100——VpnExtensionAbility.ets:33-37 TODO 注释与 README-app.md §5 已写明该语义）。一期 routes 取 0.0.0.0/0 兜底（桩注释口径），dnsAddresses 可选项化，mtu 默认 1280 并校验 [576,1500]。
验收门：并入 `npm run test:bridge`（新用例 ≥ 覆盖：空 netmap/带 self 地址/带子网路由/DNS 开关/mtu 越界拒绝）；`npm run typecheck:bridge` 仍 0。这同时就是 BASELINE §3.2 「TUN 壳层 fd 未接线」中唯一能在真机前落地的部分。

### P0-4 真机 agent 任务书重写（勘误版）+ CU 探针清单

以 HARMONY_AGENT_TASK.md 骨架为基础重写（形态见 §5.3 契约），三处硬勘误：8 包/495（BASELINE §6）、entry 尚无 @ohos-tailscale import（1.1 实况，CU6 验证载体改为「按 P1-6 工具接入后验证」）、API 名 vpnExtension（1.5）。为 CU2/3/4/5/6/7/8 每项写：30 分钟内的最小探针写法、判定标准（如 CU6：一条 `import { x } from '../core/common/src/index.ts'` 编译过=接受）、答案落点（报告哪一节）。验收门：任务书内每个探针都有「接受/不接受」二值判定与对应分支预案；文档数字与 BASELINE §2 全量一致（可机检：grep 数字）。

### P1-5 数据面端口预定义（TUN fd 接线的接口冻结）

不写实现，写契约：`app/bridge/src/platform-ports.ts` 定 `UdpSocketFactoryPort`（bind/send/recv/close + protect(fd) 挂点——mock-udp-bus 的 UdpSocket 语义为蓝本）与真机 TunDevice 适配器的 TSDoc 契约（单包同伦语义如何映射阻塞 fd、PacketStartOffset=0 的既有约定、worker 线程评估点——mock-tun.ts 头注释 :26-31 与 VpnExtensionAbility.ets:65-72 已把素材写好，缺的只是聚合成契约文档 + 类型）。错误路径表：2203002（已有 VPN）→ UI 处理；create/protect 失败 → onDestroy 清理序（VpnExtensionAbility.ets:55-58 已有雏形）。
验收门：port 类型进 typecheck:bridge 面；mock-udp-bus 现有 UdpSocket 声明为实现该 port（结构性验证，改动最小）。

### P1-6 集成三方案工具化 + 判定规则

`scripts/` 或 `app/tools/` 增加方案 2 生成器（packages/*/src → entry/src/main/ets/core 镜像 + `.ts`→`.ets`/`.ts` 保留双模式 + import specifier 改写，参数化）；README-app §4 三方案各补一行「选定判据」。验收门：生成器在仓库当前内容上 dry-run 出文件清单且不落盘（--dry-run）；执行模式产出的镜像能通过 P0-2 机检（这一步验证生成器，同时就是 CU6 的预备验证——**注意**：这测的是「tsc 眼里的镜像」，不是 ets loader 眼里的，两者不等价，任务书里必须写明）。

### P1-7 人类配合说明书（素材见 §5.4）

验收门：一个没读过本仓的人按它能在一天内备齐环境；每步有「成功长什么样」的判据（hdc list targets 看到 SN、DevEco 打开无红叉等）。

### P2-8 低危清理（不挡真机，防 agent 误读）

权限/签名事实卡（两权限 normal/system_grant 依据、VPN 授权走系统弹窗不走权限系统、未签名 HAP 可构建、AGC 受限权限是发布期事项——README-app §3 已有八成，补成 agent 可引用的一页）；README-app §6.10 bundleName 双处同步（V6 已机检覆盖）；图标占位提醒（V8 已覆盖尺寸，仅提醒不挡调试）。

**优先序理由**：P0 全部是「不做则真机 agent 的每个决定都没有地基」——红灯不清（P0-1）则无类型门、禁则无机检（P0-2）则 322 行壳带着未知违规上真机、VpnConfig 无函数（P0-3）则桩空数组继续空、任务书带错误数字（P0-4）则 agent 第一天就被误导（BASELINE §6 明证按旧任务书验收会误判失败）。P1 是「能显著省真机时间但不挡路」。P2 防误读。

## 5. 共性必答

### 5.1 「真机前全部工作完成」的可验收完成定义（机检优先）

壳视角的完成 = 以下命令在干净克隆上全绿（按现 npm script 面，新增项括注）：
```
npm test                    # 495/0
npm run typecheck           # exit 0
npm run typecheck:bridge    # exit 0（P0-1 后；当前 2）
npm run test:bridge         # ≥30/0（P0-3 加用例）
npm run validate:shell      # 66/0
npm run validate:arkts      # exit 0 + 负对照成立（P0-2 新增）
npm run interop:test:upload # 8+7 exit 0
```
加三件非机检物，各有机械判据：(a) 任务书与 BASELINE 数字零矛盾（grep 可查）；(b) CU 探针清单每项有二值判定；(c) 人类说明书每步有成功判据。**明确不在完成定义内**：任何 hvigor/DevEco 产物、CU 答案、签名——那些是真机阶段的产出，前置阶段的义务是让它们变成「有判据的实验」而非「开放问题」。

### 5.2 工作分解与优先序

见 §4：P0-1…P0-4、P1-5…P1-7、P2-8 及理由。与其他视角的边界建议：本视角不认领 headscale/interop 修复（BASELINE 缺陷 #2 属互操作视角）、不认领 CI D4 段修复（缺陷 #3 属门禁视角）——但 P0-1 与两者共享「CI 改动」动作，合并人可打包成一个 PR。

### 5.3 真机 agent 交接契约

- **拿到什么**：全仓（P0 完成态）+ 任务书（P0-4）+ 人类已备好的环境（§5.4）。
- **做什么**（按依赖序）：Day1 复跑 §5.1 全门（不全绿即停、报 issue——handover 文档纪律）；Day2 官方 linter 复跑（arkts-linter-rebuild.md §2）；Day3-5 DevEco 首构错误清零（按预期报错表逐项对预案）；Day6 跑 CU 探针首答（CU6 优先，它定集成方案；按 P1-6 判据选方案）；Day7 安装 + VPN 冒烟（授权弹窗出现 = 本阶段成功，数据面不接线——HARMONY_AGENT_TASK §3 口径）。
- **决策边界**：CU 探针的**首答权**在 agent（按判定标准，不需要人批准），但**方案级选择**（集成方案、hvigor 版本升级、compatibleSdkVersion 调整）要在报告里给出证据链供 owner 追认；协议语义疑问停下查 docs/upstream/，查不到就停（handover 红线原文）。
- **禁则**：不改 packages/ 八包；不硬闯登录墙；密钥/证书不入库；不硬改测试凑绿；mock 文件不删（它们是回归资产）。
- **回报格式**：`HARMONY_PC_REPORT.md` 固定六节（环境判定逐项/构建成败+git diff 清单+每修理由/CU 六项二值答案/冒烟截图或文本/门禁自跑数字/遗留清单），回传三通道沿用 HARMONY_AGENT_TASK §6；CU 答案必须附探针文件与命令输出原文。

### 5.4 人类配合说明书覆盖面

按阶段给「人提供什么/决定什么」：
1. **账号与凭证（决定项）**：注册华为开发者账号（真机调试签名必需）；决定 bundleName 是否沿用占位 `com.ohostailscale.app`（发布前要改，调试期建议沿用以保 V6 机检有效）。
2. **环境（提供项）**：一台 Win/Mac 装 DevEco Studio 6.x + API 12+ SDK 组件（ets/native/previewer/toolchains）；或按 build-feasibility §1 走 commandline-tools 路线（需出网可达华为仓——build-feasibility 卡点 B 的 owner 裁定项）。
3. **设备（提供项）**：鸿蒙真机/鸿蒙电脑，开开发者模式 + USB 调试授权，`hdc list targets` 出 SN 为成功判据。
4. **签名（决定项）**：自动签名（登录即得）vs 手动证书；说明未签名 HAP 可构建但安装受限（README-app §2.3）。
5. **验收（决定项）**：对 `HARMONY_PC_REPORT.md` 的 CU 首答追认或驳回；headscale 隔离实例是否随行准备（D 子线，可与本任务解耦——handover 前置节已如此裁定）。

### 5.5 最容易被高估或做错的项

1. **高估「前置能把首编译报错清零」**。做不到也不该追求（§1.6）；前置的产出是报错的枚举与预案。若规划写成「真机 agent 到手即零报错编译」，验收时必然落空。
2. **高估 tsc/erasableSyntaxOnly 对 ArkTS 禁则的覆盖**。E5 实证 A5/A7/A18 全放行——「可擦除」和「ArkTS 合规」是两个集合，把 erasableSyntaxOnly 当 ArkTS 门禁是错的。
3. **把 CU 探针的 tsc 验证当成 ets loader 验证**。P1-6 生成的镜像能过 tsc 不代表 hvigor/ets-loader 接受——CU6 只能由真机 agent 首答，前置只能让这个实验变便宜。
4. **动 packages/ 或删 mock**。真机 agent 在编译压力下最容易顺手改协议包「让它编译过去」——这毁掉全部 495 锚定（handover 红线的存在就是因为这事真会发生）。
5. **按旧任务书数字验收**（六包/238 vs 8 包/495）：BASELINE §6 已证三份盘点都漏读，合并人必须把数字勘误写进新任务书正文而不是脚注。

## 6. 不确定性清单（我可能错的）

- **U-a**：P0-2 的 struct→class 转换对 Index.ets 可能引入比收益多的边角（装饰器上下文、@Builder 语法……我只测了最小 struct）。复核条件：实现者跑 E7 全量 ArkUI 语法探针；若不稳，退 3.5 的排除方案——工作项不死，验收门不变。
- **U-b**：@kit stub 面「<15 个符号」是我数壳现状的结果；agent 首构若发现更多 @kit 用法（如 ams/commonEventManager），stub 要扩。这是预期内的维护面，不是设计缺陷。
- **U-c**：P0-3 的「一期 routes=0.0.0.0/0 兜底」取自桩注释口径（VpnExtensionAbility.ets:36），是否与 wgderive 输出天然衔接（它输出的是剪枝后的 peer 级路由）需实现时对 architecture.md §control 节核对；若冲突，以 wgderive 语义为准并回头修桩注释。
- **U-d**：`file:../../packages/common` 形态 ohpm 是否接受——我无法验证（无 ohpm），README-app §4 也只标「按优先级试错」。任务书里必须保持三方案并列，不得暗示方案 1 已倾向成立。
- **U-e**：CI 远端真实状态不可查（无 gh/网络，BASELINE §7）；「g0-gates 加 step」的改法在远端是否绿，属推定域。
- **U-f**：本机实验用的 tsc 是仓内 TS 5.9（node_modules），E4–E7 结论对 DevEco 内嵌的华为魔改 TS 4.9.5（arkts-linter-rebuild.md §1）外推有限——这正是 P0-2 与官方 linter 双轨并存的理由。

## 7. 风险与依赖

- **依赖**：P0-1 是 P0-2/P0-3 的地基（同一 tsconfig）；P0-4 依赖全部 P0 完成后定稿（探针清单引用 P0-2 的门、P1-6 的工具）；人类说明书依赖 owner 对账号/设备供给的裁定（build-feasibility §4 的两个前置）。
- **风险 1**：五个思考员若只有我提 validate:arkts，合并时它是孤例——建议合并人裁决是否入 P0（我的立场：入，理由是 .ets 零编译器覆盖是当前最大验证空档，E4–E7 是可复现证据）。
- **风险 2**：新增 npm script/工具文件落在 app/tools 或 scripts/ 的属地争议（历史：validate-shell 在 app/tools、perf 在 scripts/）——建议随 validate:shell 放 app/tools/ets-mirror-check.mjs。
- **风险 3**：P0-3 把壳侧语义写进 bridge 会加大 bridge 与「未来真实 adapter」的漂移面——缓解：P1-5 的 port 契约 + TSDoc 标注「真机实现消费同一函数」。
- **红线提醒（继承）**：本文全部建议不改 packages/、不删 mock、不 git commit、不 npm install（环境约束）；G0 既有三门数字（495/30/66）不得因新工作倒退——新增用例只增不减。
