# 思考轨迹 · minimax-3：端到端验收与人类配合（剧本倒推视角）

> 视角：以「真机 agent + 人类」的完整剧本为核心，**从「拿到真机 → tailnet 数据面通」倒推全部前置工作**。
> 读者：GLM53 合并人。本文是推理留痕，不是成品规划。
> 基线：`docs/baseline-audit/BASELINE.md`（基准 90ed53e，2026-10-03）。本文中未重新执行的门禁我标注「BASELINE 实测」，本次亲自跑的我标注命令与输出。

---

## 0. 我怎么切入这个问题

人类意图的落点是「**之后**只要有一个真机 agent + 一份人类配合说明，就能由该真机 agent 完成后续开发」。这句话里有两个被大多数人读漏的词：

- 「**之后**」——前置工作的产出不是「能跑通」，而是「**让不熟悉的 agent 不需要在真机上做决策**」；
- 「**只做后续开发**」——意味着**所有会卡住真机 agent 的分支决策，必须在规划阶段就替他做掉**，否则他会在真机上花掉全部时间做本该由我们做的判断。

所以我的切法不是「把 A/B/C/D/E 子线的遗留项列一遍」，而是**先把整条剧本铺开（谁在第几分钟需要什么），再对每一格问：这一格现在有没有人替它准备好？**。空格就是前置工作项。

**这条切法的代价我先认下来**：剧本视角会产出一些「不产生代码、只产生文档」的工作项（如决策预埋清单、人类配合说明书），在 git diff 上几乎不可见，容易在后续批次被当成「没干正事」砍掉。我在 §9 给了对抗办法（把文档变成机检）。

---

## 1. 事实认定（与本题直接相关，逐条带出处）

### 1.1 剧本的环境前提：规划机什么都跑不了

我本次在本机实测（这是**本次亲自执行**）：

```
$ for t in hdc hvigorw hvigor docker deveco sdkmgr ohpm; do printf "%s: " "$t"; command -v "$t" || echo "NOT FOUND"; done
hdc: NOT FOUND   hvigorw: NOT FOUND   hvigor: NOT FOUND   docker: NOT FOUND
deveco: NOT FOUND sdkmgr: NOT FOUND  ohpm: NOT FOUND
$ ls -d ~/DevEco* /c/DevEco* "/c/Program Files/DevEco"* 2>/dev/null || echo none
none
$ node -v && npm -v   →  v22.23.2 / 10.9.8
$ git log --oneline | wc -l && git rev-parse --short HEAD  →  22 / 90ed53e
```

**推论（对本规划是决定性的）**：「真机前全部工作」中，**任何需要 DevEco/SDK/hvigor/hdc/docker/headscale 的步骤，在规划机上 0 可验证性**。所以完成定义必须劈成 A 类（本机可机检）与 B 类（真机 agent 首答），**严禁把 B 类写成 A 类的门**——那是本目标最容易高估的地方（详见 §11）。

`docs/build-feasibility-linux.md:44-47` 的三个卡点（账号墙 / 华为仓不可达 / hvigor 无公开分发）与本次实测一致：**没有华为开发者账号 + 官方 DevEco/commandline-tools，app/ 在物理上无法编译**。这不是可以靠 agent 努力绕过的。

### 1.2 【最关键发现】控制面有两条互不兼容的代码路径，真机 agent 必然踩

我在本次会话里逐个文件读出来并交叉验证：

| 路径 | 组件 | 证据 | 能否对真 headscale |
|---|---|---|---|
| **A：interop 已验证路径** | `noise/controlbase.ts` + `control/tailcfg.ts` + HTTP/2 层 | `packages/noise/src/controlbase.ts:41` `CONTROLBASE_PROLOGUE_PREFIX='Tailscale Control Protocol v'`，:94 拼版本号；`packages/control/src/tailcfg.ts:57-59` `TailcfgRegisterAuth{AuthKey}`，:68-90 `encodeRegisterRequest` 出 JSON | **能**（09-29 INTEROP PASS 即此路径） |
| **B：桥接/mock 路径** | `control/client.ts` + TLV 消息 | `packages/control/src/client.ts:73` `CONTROL_NOISE_PROLOGUE='ohos-tailscale-control-ts2021'`（文件头:70 自陈「本地契约」）；`packages/control/src/messages.ts:167-178` `registerRequestEncode` 只有 NodeKey/DiscoKey/Endpoints，`kind` 还被设为 `MapRequest` | **不能**（prologue 不匹配 + 载荷格式不对） |

**致命交叉点**：`app/bridge/src/shell-session.ts:127` 调的是 `registerRequestEncode`（路径 B）。也就是说 `ShellControlSession`——壳（`VpnExtensionAbility.ets:24-26` TODO 明确说「此处读取并交给核心库」要用的那个门面）——**在结构上就无法向 headscale 注册**。文件头:10-12 其实自己承认了：「精简版 RegisterRequest（TLV）无 auth 字段……真实注册扩展在前」。

**第三块拼图缺失**（本次 grep 实测）：

```
$ grep -c "process.argv" interop/h2c.node.ts        → 0     （无 CLI 入口）
$ grep -rn "H2OverNoise" packages/                  → 0 命中（HTTP/2 层不在 packages/）
```

即：真实路径需要的 **HTTP/2 over Noise 层（`H2OverNoise`）只活在 `interop/h2c.node.ts` 这个 Node 侧胶水文件里**，而该文件 `interop/register.node.ts:17` / `derp.node.ts:28` 用相对路径 import packages/，且整个文件不在 8 包冻结面内。

> **合并人请重点看这条**：如果规划里不预埋这个决策，真机 agent 会照 `app/README-app.md:66-71`「平台注入层 HttpTransport → 注入 control 包」做，然后卡死在 S6（注册）——**而且卡得毫无线索**，因为 `ControlClient` 的测试全绿、`ShellControlSession` 的 30 个用例全绿，两处都「看起来是对的」。

### 1.3 headscale 配置对手机是死路，且与现有红线互斥

`interop/headscale.yaml`（本次实读全文）：

```yaml
server_url: http://127.0.0.1:8080     # :2  ← 客户端可见的控制面地址
listen_addr: 0.0.0.0:8080             # :4
private_key_path: /home/dev/interop/noise_private.key   # :13  WSL 硬编码
sqlite.path: /home/dev/interop/headscale.db             # :33  WSL 硬编码
unix_socket: /home/dev/interop/headscale.sock           # :44  WSL 硬编码
stun_listen_addr: "0.0.0.0:3478"                        # :20
```

`interop/start-headscale.sh:4` 也是 `cd "$HOME/interop"`，同样 WSL 形态。

**推论 1**：`server_url` 是 headscale 下发给客户端的控制面地址。手机拿到 netmap 后去连 `127.0.0.1:8080`，连的是**手机自己**。→ 设备侧必须有一份**改过 server_url 的配置**。
**推论 2**：`docs/handover/agent-interop-regression.md:57` 的红线原文「一切 HTTP 只对 `http://127.0.0.1:8080`；不发起任何对外域名/100.64.0.0/10 注册请求」与「手机要连开发机的 LAN 地址」**直接冲突**。这条红线是为 Node 侧同机回归写的，**照搬会让真机自锁**。
**推论 3**：该 yaml 里的 WSL 绝对路径意味着它**在非 WSL 环境连起都起不来**。

### 1.4 剧本里现成的命令有四条是假的（agent 会照抄）

| # | 假命令 | 出处 | 实情（本次实测） |
|---|---|---|---|
| 1 | `hvigorw assembleHap --mode module -p product=default` | `docs/handover/owner-with-real-device.md:60` | `find app -name "hvigorw*"` → **0 命中**。`app/` 下无 wrapper；`HARMONY_AGENT_TASK.md:§2.1` 却说「app/ 下应有包装脚本」。hvigor 只能由 DevEco 注入（`app/hvigorfile.ts:2` import `@ohos/hvigor-ohos-plugin`，而 `build-feasibility-linux.md:22-23` 实测该包 npm/ohpm 均 404） |
| 2 | `git clone git://203.0.113.10:9418/…` | `HARMONY_AGENT_TASK.md:13` | TEST-NET-3 不可路由；`PUBLIC-SCRUB-NOTE.md:14` 自己列了替换表，但 `:20` 的免责只覆盖 `:8090/upload` 那行。真实 remote 是 github.com/feasy898/ohos-tailscale（handover/owner:21）。（此发现已由 `synthesis-minimax-m31-flash.md:127,:160` 单方实证，我复核原文属实） |
| 3 | HTTP 收件箱回传 `curl -X POST …/upload/[UPLOAD-TOKEN-REDACTED]/` | `HARMONY_AGENT_TASK.md:63-65` | 令牌已被 scrub 成占位符，`PUBLIC-SCRUB-NOTE.md:20` 明说「不代表可用通道」 |
| 4 | 「npm test 期望 238/238」 | `HARMONY_AGENT_TASK.md:9/:49/:82/:88` | 实际 495（BASELINE §2.2）。agent 照此验收会**误判回归为失败并报 issue** |

这四条都属于「一句话就能修、但会让真机 agent 剧本第一步就断」的东西。**这是本视角下性价比最高的一类前置工作。**

### 1.5 壳的现状：322 行 .ets，零产物，注入层目录不存在

- `VpnExtensionAbility.ets:40-48` `addresses/routes/dnsAddresses` 三个空数组 + TODO「真实调用会失败——桩仅示意流程」；:70 提醒 socket fd 必须 `conn.protect(fd)` 防环路；:72 自陈「fs 读写 fd 的同步阻塞方式会卡扩展进程，需评估 worker/线程池」——**这是真机上第一个会咬人的运行时问题**。
- `app/entry/src/main/ets/` 下只有 `entryability/ pages/ vpnextensionability/`，**没有 `platform/`**（本次 `ls` 实测），而 `README-app.md:66-71` 的五个注入点全在 `platform/` 里。
- `app/build-profile.json5:3-4` `signingConfigs: []`（空）；`entry/oh-package.json5:11-14` 核心库集成是纯注释 TODO，**三方案一个都没选**。
- `app/entry/src/main/module.json5:58` `"type": "vpn"` + `README-app.md:42` 官方已知「DevEco 校验器可能不识别，需手改 SDK 的 `toolchains\modulecheck\module.json`」——**这是一个要人改 SDK 安装目录的步骤，agent 无权做**。
- `README-app.md:104` bundleName `com.ohostailscale.app` 仍是占位，正式发布前要改且**两处必须同步**（`app.json5` + `Index.ets:14`）。

### 1.6 剧本的 S2 段（协议自检）当前是坏的

BASELINE §8-2 已钉死 `interop/regress.mjs` 三重缺陷，本次亲读确认：`:52` 假 preauthkey `regress-dummy-preauthkey`；`:54-56` 给两参的 `derp.node.ts` 只传 1 参；`:57-59` 调无 CLI 的 `h2c.node.ts`。我本次实测 `grep -c process.argv interop/h2c.node.ts` = 0，与 BASELINE 一致。

另：`.github/workflows/g0-gates.yml` 本次通读——`typecheck:bridge` **不在**六 step 内（BASELINE §5.1）；`:83` 的 D4 grep 引号语法死（BASELINE §2.9a）；`:106/:112` 的 `awk '{print $7}'` 对 `# fail 0` 恒取空；`:21` 仍自称「G0 五门」而实为六 step。**在真机 agent 开始改代码之前，这些门必须先修好**，否则他改 app/ 时没有任何回归护栏，而 8 包接口是冻结的。

---

## 2. 目标拆解思路：为什么按「剧本」切

我考虑过三种切法：

| 切法 | 优点 | 为什么（部分）否决 |
|---|---|---|
| **按子线切**（A/B/C/D/E 的遗留项） | 与 TASK.md 一致，可追溯 | 「谁做」的视角。「E 解冻」在 TASK.md:2.5 是一句冻结声明，看不出里面藏着多少「必须人做」的动作。**漏掉整个环境维度** |
| **按包切**（common/crypto/…/app/） | 与源码结构对齐 | 协议的缺口不在包内（BASELINE §3.0：495 用例都在），缺口全在包**之间**和包**之外**。切错维度 |
| **按剧本阶段切**（我采用） | 唯一能同时暴露「代码缺口」和「人的缺口」的切法；每格都能问「现在有人替它准备了吗」 | 产出的非代码项容易被砍（§0 认下） |

**我采用的阶段划分**（编号本身就是交接协议的分节号）：

```
S0 环境与基线    S1 剧本自检(新增)   S2 协议自检     S3 首编译
S4 签名与安装    S5 冷启动冒烟        S6 控制面注册   S7 DERP      S8 端到端数据面
```

**S1 是我自己加的一级**，理由：现有剧本（`HARMONY_AGENT_TASK.md` / `owner-with-real-device.md`）是「拿到设备就开工」，没有「先证明剧本本身没烂」这一步。§1.4 的四条假命令、§1.1 的本机零工具，都说明**剧本在第一格就会断**。S1 的产出是「假命令全部修掉 + 每条命令标注了在本机/真机/人类侧哪一类可执行」。

---

## 3. 完整剧本：每阶段谁做、通过标准、失败处置

> 记号：`A`=agent 可独立完成；`H`=必须人出手；`AH`=人机协作。「机检」列写不出可执行判据的，我明写「人工」。

### S0 环境与基线（AH）
- **人提供**：华为开发者账号（含实名/权限）、DevEco Studio 6.x 或 commandline-tools、HarmonyOS SDK（API 12+）、鸿蒙 NEXT 真机 + 开发者模式 + USB 调试授权、`hdc list targets` 能看到 SN。
- **agent 做**：拿到工具链后立刻在**有工具链的机器**上复跑 `npm test` / `typecheck` / `test:bridge` / `validate:shell` / `typecheck:bridge`。
- **通过标准**：`validate:shell ≥66/0` + `test:bridge ≥30/0` + `npm test ≥495/0` + `typecheck exit 0`（`owner-with-real-device.md:27` 的四门，我加 `typecheck:bridge`——见 §5 缺陷 1）。**全绿才准进 S1**。
- **失败处置**：`test:bridge` 或 `validate:shell` 红 → 停，回 Node 侧修，不许改测试凑绿（`owner-with-real-device.md:88` 红线）。`npm test` < 495 → 先查是不是 clone 到了旧版（§1.4 第 2 条）。
- **注意**：`owner-with-real-device.md:23` 让 agent 跑 `npm install`。若目标是「agent 只做后续开发」，**依赖应已 vendored 或由人类预先装好**——真机上 `npm install` 失败会让剧本第一步就断，且失败原因（无网/registry）会被误判为代码问题。

### S1 剧本自检（**A**，全部本机可机检 → P0）
- **做什么**：修 §1.4 四条假命令；把 `HARMONY_AGENT_TASK.md` 的「六包 238」全部改 495；把回传通道从已失效的 HTTP 收件箱换成人类当面接收 + 可选 git push；给 `app/entry/oh-package.json5` 的三方案 TODO **落一个明确选定**（或写明「按判定树现场选，见 DECISIONS D5」）；`docs/handover/owner-with-real-device.md` 的命令逐条标注可执行性。
- **通过标准（机检）**：一份 `docs/pre-device/STAGE-CHECKLIST.md`，其中每条命令带 `[local]` / `[device]` / `[human]` 标签；一个校验脚本断言「标签全集 = 剧本引用到的命令全集，差集为空」；`grep -rn "238\|六包" docs/ *.md` 零命中。
- **失败处置**：漏标签 → 校验脚本红，补到绿。这是我唯一敢设成硬门的东西，因为它 100% 可机检。

### S2 协议自检（**A**，Node 侧；是 S6/S7 的**对照基线**）
- **做什么**：修 `regress.mjs` 三缺陷（preauthkey 读环境变量、derp 补第 2 参、h2c 加 CLI 入口或从编排器移除）；修 CI D4 引号 + 把 `typecheck:bridge` 加进六 step；修 `docs-consistency` 的 awk 取值；新增 **`interop/regress.mjs --selftest`**（无 headscale 时断言三阶段 argv 与预期一致，退出码 0）。
- **通过标准**：`npm run interop:regress -- --selftest` exit 0 且输出三阶段 argv 逐条；CI yml 原样 `bash` 跑 exit 0；`typecheck:bridge` exit 0。
- **失败处置**：selftest 红 = 脚本没修好，**不许上机**。理由：S6 失败时，agent 需要一个「Node 侧同协议栈已经通了」的对照才能区分是协议栈坏了还是手机网络坏了；没有对照，一次失败会烧掉半天且归因不了。
- **本机不能验的**：`INTEROP PASS` 本身需要有 headscale 的机器。本机无 docker/headscale（§1.1 实测），所以「真机前」的 A 类完成定义只能到 selftest；`INTEROP PASS` 属 B 类。

### S3 首编译（**AH**，人拿鼠标，agent 读日志）
- **顺序**（这是 `owner-with-real-device.md:42-48` 的顺序，我加了前置）：
  1. **3.0 最小探针（人 5 分钟 + agent 10 分钟）**：用 DevEco 新建一个空工程，编一个只有一个 `Index.ets` 的 HAP；再加第二个模块，只做一件事——`import { x } from './y.ts'`。**在最小面上把 CU6 与 SDK 版本问题解决掉**，不要在 37 文件的壳上试。这是 `HARMONY_AGENT_TASK.md:33` 说的「全项目最大未知数」。
  2. 3.1 打开 `app/`，hvigor 同步，编 unsigned HAP。
  3. 3.2 逐条消错，按 §1.5 清单（`@kit.*` 路径、`type:vpn`、compatibleSdkVersion）。
- **通过标准**：产出 `app/entry/build/*/outputs/*/*.hap`（`HARMONY_AGENT_TASK.md:§2.4` 给了路径形态）；3.0 的探针给出 CU6 的**明确 yes/no**。
- **失败处置树**：
  - `type: vpn` 不识别 → **升级给人**（要改 SDK 安装目录里的 `modulecheck/module.json`，`README-app.md:42`；agent 不该有 SDK 目录写权限）
  - `@ohos/hvigor-ohos-plugin` 找不到 → 人检查 DevEco 是否完整安装（含 command-line-tools）
  - 探针里 `.ts` specifier 失败 → 进 D5 判定树（见 §6）
- **这一步最容易低估**：工程是「按官方文档手写、从未编译」（`README-app.md:6`、`HARMONY_AGENT_TASK.md:§2.2`「首次构建必然报错」），**报错面不在仓库里**，无法提前枚举。任何声称「真机前可以把编译错误清零」的目标都是不可信的。我的完成定义只承诺「**错误分类与处置树已备**」，不承诺「零错误」。

### S4 签名与安装（**H** 提供证书/账号，**A** 出命令）
- **人**：自动签名勾选（`README-app.md:40`，需登录华为账号）或提供 p12/csr；决定用调试签名还是未签名。
- **agent 出**：`hdc install <hap>` + `hdc shell am start -n com.ohostailscale.app/.EntryAbility`（路径形态来自 `owner-with-real-device.md:62-63`，注意 :61 自己提示 bundleName 来自 `app.json5:3`，而我实测是 `com.ohostailscale.app`/`com.ohostailscale.app`）。
- **通过标准**：`hdc list targets` 有 SN；`hdc install` 退出码 0；应用能在设备上被拉起。
- **失败处置**：签名失败 → 人（证书/账号问题，agent 无法裁决）；安装被拒（签名与设备不匹配）→ 人重签，**不许改 bundleName 试**（会牵动 `Index.ets:14`，`README-app.md:104` 明说两处必须同步）。

### S5 冷启动冒烟（**AH**：人点屏幕，agent 读 hilog）
- **人**：点「连接」，在系统弹窗上点「同意」VPN 授权（`HARMONY_AGENT_TASK.md:§3.2`：「弹窗出现即算本阶段成功」）。
- **agent**：`hdc shell hilog` 抓 `OhosTsIndex`（DOMAIN 0x0001）与 `OhosTsVpnExt`（DOMAIN 0x0200）两个 tag。
- **通过标准**：`Index.ets:152` `startVpnExtensionAbility success` + `VpnExtensionAbility.ets:21` onCreate 日志出现 + `create(config)` 返回 fd（:52 `tun fd = %d`）。**注意此时 fd 后面必然失败是预期的**（:41-43 空数组）。
- **失败处置**：授权弹窗不出现 → 回 S3（`type:vpn` 声明没被系统认到）；`create` 报 2203002 → 设备上已有别的 VPN，人去关（`README-app.md:56`）。
- **关键判据**：这一阶段过了，**只证明「系统认得这个扩展」**，`HARMONY_AGENT_TASK.md:§3.2` 自己也这么界定。别把它当「VPN 通了」。

### S6 控制面注册（**AH**，全剧本最难）
- **人**：提供 headscale 主机的 **LAN 可达地址**、生成一次性 preauthkey、保证手机与 headscale 主机在同一网段/可路由。
- **前置（本视角的核心预埋）**：必须先有 §6 的 **D1（代码路径）** 与 **D3（headscale 设备侧配置）** 两条裁定，否则 agent 无法开工。
- **通过标准**：`headscale nodes list` 出现 `ohos-interop-<hostname>`；设备侧日志出现「注册成功 + 收到首个 MapResponse + 分配到 100.64.0.0/10 内地址」。**证据形式建议对齐 `interop/register.node.ts:264` 的 `INTEROP PASS` 语义，但必须标明是设备侧**（不能与 Node 侧字符串混为一谈）。
- **失败处置树**（按概率降序）：
  1. **prologue 不匹配 / 载荷格式错** → 100% 是 §1.2 的 D1 没定/走错路径。处置：回读 D1，不是改协议代码
  2. **连不上控制面**（`127.0.0.1` 陷阱，§1.3） → 换 D3 的设备侧配置
  3. **401/403** → preauthkey 过期/已被用/用户无效 → 人重新生成
  4. **可达但握手超时** → 手机网络有代理/仅 IPv6/防火墙 → 人抓包

### S7 DERP（**AH**）
- **人**：保证 headscale 的 DERP + STUN 端口对手机可达（`headscale.yaml:20` `stun_listen_addr: 0.0.0.0:3478`，容器化时需 `-p 3478:3478` 之类；`agent-interop-regression.md:22-26` 的 docker 命令**没有映射 DERP/STUN 端口**——本次实读确认，是个真缺口）。
- **通过标准**：设备侧 DerpClient 收到 `ServerKey`→`ClientInfo`→`ServerInfo`；`Ping/Pong` 往返成功（对齐 `interop/derp.node.ts:194-201,:321` 的日志形态）。
- **失败处置**：DERP 握手失败但控制面正常 → DERP 地址通告问题（回 D3）；STUN 全败 → 退化为直连（`netcheck` 有 OnlySTUN/UDP 全败回退逻辑，BASELINE §3.1 netcheck 行），**不是致命**，S8 可继续。

### S8 端到端数据面（**AH**，验收终点）
- **人**：提供第二个 peer 节点。**这是个必须提前定的拓扑问题**（见 §6 D7）：手机 ↔ Node 侧节点（复用 `interop/derp.node.ts` 的 A/B 身份）？还是两台手机？
- **通过标准**（建议三层，逐层加严）：
  1. **控制面证据**：注册 + netmap（peer 列表非空、含 100.64.0.0/10 地址）
  2. **链路证据**：对端 `RecvPacket` 收到本端发的 disco/keepalive 载荷（对齐 `derp.node.ts:345` 的 `RecvPacket ←` 形态）
  3. **业务证据**：从手机侧 `100.100.100.100`（MagicDNS）或对端 100.64.x.y 发起一次真实 IP 包，收回 echo
- **失败处置**：1 过 2 不过 → disco/UDP relay 路径（`VpnExtensionAbility.ets:66-68` 的「读 tunFd → 分发 → UDP 发出」这段是纯 TODO）；2 过 3 不过 → PacketFilter/路由（BASELINE §3.3 明列 PacketFilter 四元组执行体**不存在**），这属二期，不是本剧本的失败。

---

## 4. 人类配合说明书骨架（我的设计）

现有人类文档（`docs/handover/owner-with-real-device.md`）是**给「有设备的 owner agent」看的**，不是**给「人」看的**——它通篇祈使句是冲着 agent 的。这是我要补的一块。骨架：

```
docs/pre-device/OWNER-GUIDE.md
├─ 0. 你要提供什么（一次性资产清单 + 获取方式 + 每个的常见坑）
│    0.1 华为开发者账号（实名 + 签名权限；坑：子账号无签名权限）
│    0.2 DevEco Studio 6.x / commandline-tools（坑：完整安装才带 hvigor 插件）
│    0.3 HarmonyOS SDK API 12+（坑：只装 ets 不装 native/previewer 会在构建时炸）
│    0.4 鸿蒙 NEXT 真机（开发者模式 + USB 调试授权 + 信任此电脑）
│    0.5 headscale 主机（与手机同网段；坑：容器要额外映射 DERP 3478 与 gRPC）
│    0.6 一次性 preauthkey（用后即弃、不入仓，遵 agent-interop-regression.md:58）
│    0.7 第二个 peer 节点（拓扑见 DECISIONS D7）
├─ 1. 按阶段：你做什么 / 你决定什么 / 什么算过（表格，一行一动作，全部祈使句）
│    S0 … S8，每阶段：人类动作 / 人类决策点 / 通过判据 / 常见卡点
├─ 2. 决策点清单（只有你能拍的：账号、签名、拓扑、红线豁免、预算）
├─ 3. 你会看到什么回报（每个阶段的机器可读判据，见 §5）
└─ 4. 出事怎么办（升级路径 + 何时该叫停，见 §7）
```

**写作纪律（我给自己定的）**：每条必须是祈使句 + 可勾选；不写 FAQ；不写「详见某文档」（agent 不会跳）；凡涉及账号/密钥的一律写「到哪里拿、拿不到找谁」。

---

## 5. 可验收的「真机前全部工作完成」定义

分两类。**A 类（规划机必须全绿，硬门）**：

| # | 门 | 命令/判据 | 现在状态 |
|---|---|---|---|
| A1 | 全仓测试 | `npm test` → `# fail 0` 且 `# tests ≥495` | ✅ BASELINE §2.2 |
| A2 | 类型 | `npm run typecheck` → exit 0 | ✅ BASELINE §2.3 |
| A3 | **壳类型（本轮新增门）** | `npm run typecheck:bridge` → **exit 0** | ❌ **我本次实测 exit 2**（`peerapi-tun.test.ts(246,5) TS2353`），且不在 CI（BASELINE §5.1）。**真机前必须修**——理由不是"数字好看"，而是 agent 改 app/ 时若带着这个红灯，「类型红」会淹没「真机错误」 |
| A4 | bridge 运行时 | `npm run test:bridge` → `≥30 / 0` | ✅ BASELINE §2.5 |
| A5 | 壳静态机检 | `npm run validate:shell` → `≥66 passed / 0 failed` | ✅ BASELINE §2.6 |
| A6 | D4/P4 | 等价 grep 0 命中 **且 CI 脚本本体 exit 0** | ⚠️ 代码面净、**脚本本体 exit 2**（BASELINE §2.9a）。两句都要 |
| A7 | 互操作脚本自检 | `npm run interop:regress -- --selftest` → exit 0，三阶段 argv 断言 | ❌ 尚不存在；`interop:regress` 本次可跑但必败 |
| A8 | 剧本自检 | `node scripts/check-stage-docs.mjs`（新增）→ 阶段清单与剧本引用命令差集为空；`grep -rn "238\|六包" docs/ *.md` 0 命中 | ❌ 尚不存在（§1.4 四条假命令） |
| A9 | 决策预埋 | `docs/pre-device/DECISIONS.md` 含 D1–D10，每条有裁定+签署人+日期，无 `TBD` | ❌ 尚不存在 |
| A10 | 人类说明书 | `docs/pre-device/OWNER-GUIDE.md` 存在，且 S0–S8 每阶段都有「人做什么/决定什么/通过判据」三栏，无空栏 | ❌ 尚不存在 |
| A11 | 环境 schema | `docs/pre-device/env-ready.schema.json` 存在，且 S4/S5 阶段脚本消费它 | ❌ 尚不存在 |

**B 类（真机 agent 首答，规划阶段**不**承诺、只承诺「有判定树」）**：CU2 BigInt、CU5 Object.keys、CU6 `.ts` specifier、CU7 平台 Clock/Rng 签名、CU8 hypium 复用、S3 首编译零错误、S6/S7/S8 全链通。
> 来源：`docs/arkts-constraints.md:798-812`（CU1–CU10）；`BASELINE §7` 同口径。**把 B 类写进 A 类是本目标最典型的自欺。**

---

## 6. 「真机 agent 只做后续开发」⇒ 决策预埋清单

**这是本视角的核心产出**。以下每一条，若不在规划阶段定死，真机 agent 就要在 S3–S6 花掉数小时做本不该由我们做的判断，且他的选择会悄悄改变架构：

| ID | 决策 | 我的推荐 | 若不定会怎样 |
|---|---|---|---|
| **D1** | 控制面代码路径：走 tailcfg+controlbase+h2c（路径 A），还是 TLV `ControlClient`（路径 B）？ | **必须走 A**。`client.ts:73` 的本地 prologue 与 `messages.ts:167-178` 的无 auth TLV 载荷在结构上不可能被 headscale 接受。`ShellControlSession` 降级为 UI 状态门面 | S6 必败，且失败现场无任何线索（两侧测试全绿） |
| **D2** | `H2OverNoise`（现只在 `interop/h2c.node.ts`）落到哪里？ | 新增第 9 包或在 `control` 包内新增 `h2c.ts`（需走 `architecture.md §10.3` 版本记录 + 接口冻结流程）。**我不能单方面定**，但必须由人/架构师在真机前拍 | 违反「8 包接口冻结」红线（`docs/handover/README.md:19`），且无 h2c 就无法走 D1 |
| **D3** | headscale 设备侧配置：形态与红线边界 | 另起 `interop/headscale.device.yaml`（server_url 改 LAN 地址、路径参数化去掉 WSL 硬编码），**不改原 yaml**；红线由 owner 书面豁免「仅本任务的设备侧使用」 | agent 现场改 `interop/headscale.yaml`，污染 D 子线复现基线（§1.3 推论 2/3） |
| **D4** | CU6 判定树：先试哪个方案、什么错误码对应哪个 | 先 `ohpm file:../../packages/*`（最轻）→ 失败则**源码并入 + 脚本化改后缀**（最可预测）→ 最后 HAR。判定点在**最小探针**上做（S3.0），不在壳上做 | agent 在 37 文件的壳里边试边改，失败时无法二分定位 |
| **D5** | 核心库集成方式三选一 | 同 D4：**在规划阶段只定「判定树 + 二分顺序」，不预先锁死方案**。理由：CU6 未验证，锁死等于猜 | `entry/oh-package.json5:11-14` 的 TODO 一直空着，agent 现场随便挑一个 |
| **D6** | 签名方式 | 优先 DevEco 自动签名（需账号）；准备 p12 手工签名作为账号受限时的退路；未签名 HAP 仅用于 S3 编译验证 | S3 做完、S4 卡在签名，S3 的成果无法装机验证 |
| **D7** | peer 拓扑：S8 拿谁当对端？ | 推荐**手机 ↔ Node 侧节点**（复用 `interop/derp.node.ts` 的 A/B 身份，一次部署两台设备） | 拓扑不定 → S8 验收标准无法预先写成判据 |
| **D8** | mock 桥的处置 | `mock-localapi/mock-peerapi/mock-tun` **保留在仓内继续服务单测**，但真机路径另写 `platform/` 实现。`validate-shell` V9 的 12 条 bridge 纪律检要明确它检的是 mock 不是真实现 | agent 以为「把 mock 换掉」就要删文件，删掉后 30 个 bridge 用例直接红 |
| **D9** | hostinfo/版本/命名口径 | `hostname` 建议 `ohos-interop-<设备短名>`（对齐 `register.node.ts:45` 默认 `ohos-interop-node` 与 `derp.node.ts:218` 打印），`OS` 字段按 tailcfg 语义填 | 设备上出现两个同名节点，S6 诊断混乱 |
| **D10** | 升级条件与叫停权（见 §7） | 见下 | agent 遇阻后「硬改测试凑绿」或「无限重试」 |

---

## 7. 升级条件与回退路径

**升级给人的触发条件**（写死，避免 agent 无限自旋）：
1. 需要修改 **SDK 安装目录**（`type:vpn` 的 `modulecheck/module.json`，`README-app.md:42`）；
2. 需要**华为账号 / 证书 / 设备解锁**；
3. 需要**改动 D3 的红线**（监听地址、server_url、对外请求）；
4. 需要**改动 8 包导出**（触发 `architecture.md §10.3` 版本流程，`docs/handover/README.md:19`）；
5. 同一错误**连续 2 次**尝试无进展（防止 patch 凑 PASS，`agent-interop-regression.md:52` 的纪律）；
6. 涉及 `BundleName` / 签名的任何变更（牵动两处同步，`README-app.md:104`）。

**回退路径（按剧本倒序）**：
- S8 失败 → 退 S7（只验控制面证据 + DERP 包交换，**这是 09-29 已有先例的层级**，`derp.node.ts:361` 证明该层可达）；跳过业务层，属二期。
- S6 失败 → 退 S2（用 Node 侧同协议栈复跑 `register.node.ts`，把「协议栈 vs 网络」二分）。
- S5 失败 → 退 S3（重新编译，产物换新 HAP）。
- S3 失败 → 退 S3.0 最小探针（把问题缩到最小面）。
- **总回退**：退回 Node 侧全部绿灯 + 只交付「决策预埋 + 人类说明书 + 修好的 regress/CI」，真机线继续冻结 WAITING_EVENT。**这是一个可接受的终局，不是失败**——因为交接契约与人类说明书本身就独立增值。

---

## 8. 备选方案与取舍（含我否决的）

| 方案 | 结论 | 理由 |
|---|---|---|
| 把完成定义定为「真机 agent 一次跑通 tailnet」 | **否决** | CU2/CU5/CU6/CU7/CU8 只能在真机首答（`arkts-constraints.md:798-812`）。承诺「一次跑通」= 承诺一件不可验收的事，等于把完成定义作废 |
| 直接改 `interop/headscale.yaml` 让其 LAN 可达（最省事） | **否决** | ①它是 D 子线复现 09-29 PASS 的基线资产，被真机实验污染后 D 的复跑不可比；②`agent-interop-regression.md:57` 的红线明文，agent 无权豁免 |
| 另起一份 headscale 配置（我推荐） | **采纳** | 隔离实验面与基线面；红线豁免变成 owner 的一次显式签字而不是 agent 的现场绕过 |
| headscale 部署与真机分给两个 agent | **否决** | S6/S7 的失败诊断需要同一个人同时持有「手机 + headscale 主机 + 抓包」。拆开 = 把网络可达性问题变成两个 agent 互相甩锅 |
| 把「协议自检 S2」删掉（理由：09-29 已经 PASS 过了） | **否决** | `regress.mjs` 三重缺陷意味着**当前形态任何环境都出不了 PASS**（BASELINE §8-2）。没有 Node 侧对照，S6 失败无法归因 |
| 人类配合说明书写成 FAQ | **否决** | agent 不读 FAQ。agent 需要的是**按阶段编号、祈使句、可勾选**的执行清单 |
| 现在就去申请 headscale/真机资源 | **部分采纳** | 「写清单」我能做，「拿到设备」只有人能做。但**申请动作本身是人的前置任务**，必须在 S0 前发起，否则设备到位前剧本没准备好，人设备两空 |
| 把「ArkTS 约束 A1–A36 对新写 .ets 的离线扫描」放进 P0 | **采纳（有限）** | `interop/arkts-check.js` 本机不可跑（BASELINE §2.11 实测 exit 1，ESM/CJS 冲突 + 硬编码 WSL SDK 路径）。**修好它属于 P0**（全仓唯一零实证的修复，BASELINE §8-4），但「跑官方 linter」需要 SDK，属 B 类 |

---

## 9. 最容易掉链子的三个环节 + 缓解

**环节 ①：S3 首编译。** 掉链子原因：工程从未编译，**报错面不在仓库里**（`HARMONY_AGENT_TASK.md:§2.2`「首次构建必然报错」），无法提前枚举；且 CU6 的答案决定后续所有工作的形态。
> **缓解**：把 CU6 从「在壳上发现」提前到「在最小探针上发现」（S3.0）；S1 阶段先修好 `arkts-check.js`（§8 末行）以获得一个离线 ArkTS 静态检查通道；把 `README-app.md:93-105` 的 11 项未验证事项**逐条转成带判定树的检查表**（每条：怎么观察、看到什么算过、失败走哪条分支）。

**环节 ②：S6 控制面注册。** 掉链子原因：§1.2 的 D1 未定 + §1.3 的 D3 未定 + preauthkey/网络可达三件事**同时错位**，且任一失败的表现都是「连不上/注册失败」，无法区分。
> **缓解**：A7 的 `--selftest` 先在 Node 侧确认脚本本身健康；D1/D3 在规划阶段定死；S6 的失败处置树按「先查 D1 → 再查 D3 → 再查 key → 最后抓包」的顺序排，不允许跳序。

**环节 ③：S4→S6 之间密集的人工确认点。** 签名授权、hdc 信任、VPN 授权弹窗、开发者模式、preauthkey 生成——**五个点任意一个没过，agent 都会误判为代码问题并开始改代码**。这是自动化 agent 最典型的失败模式：它倾向于「修东西」而不是「问人」。
> **缓解**：把环境就绪做成**机器可读的检查表文件**（A11 的 `env-ready.json`），由人在 S4 末尾一次性逐条确认打勾；**S5/S6 的第一步强制是「先读 env-ready.json，全绿才继续」**。这条比任何文字提醒都有效，因为它把「是否问过人」变成了一次可判定的 IO。

---

## 10. 真机 agent 交接契约骨架

```
你拿到：
  ① 决策预埋（DECISIONS.md：D1–D10 已裁定，附理由与签署人）—— 你的自由度只剩「按判定树执行」
  ② 阶段清单（STAGE-CHECKLIST.md：S0–S8，每条命令标 [local]/[device]/[human]）
  ③ 人类说明书（OWNER-GUIDE.md：人会做什么、会在哪等你）
  ④ 环境就绪文件（env-ready.json + schema）
  ⑤ 剧本自检门（A1–A11 全绿 + CI 护栏就位）
  ⑥ 冻结面与红线（8 包接口、D4/P4、隔离 headscale、凭据纪律）

你做：
  按 S3.0 → S8 顺序推进；每阶段结束产出「机器可读判据 + hilog 片段 + 截图/文本」
  遇到 §6 D1–D10 未覆盖的新分叉 → 按 §7 六条触发条件升级，不自决

决策边界：
  可自决：实现细节、错误分类、UI 文本、日志级别、测试补充
  须升级：SDK 目录改动 / 账号证书 / 红线豁免 / 8 包导出 / BundleName / 连续 2 次无进展

禁则：
  不改测试凑绿 · 不碰生产 tailnet · 不把凭据写进仓 · 不改 packages/ 导出（除非走 §10.3）
  不修改 interop/headscale.yaml（D3 另起设备侧配置） · 不用 want.parameters 传密钥（VpnExtensionAbility.ets:26）

回报格式（每阶段一份，缺项即视为未完成）：
  阶段号 | 通过/未通过 | 判据原文 | 命令与完整输出 | hilog 片段 | 截图/界面文本
  | 触碰的决策点 | 新发现的分叉 | 遗留项
```

---

## 11. 人类在每阶段提供/决定什么（速查表）

| 阶段 | 人提供 | 人决定 |
|---|---|---|
| S0 | 账号 / DevEco / SDK / 真机 + 开发者模式 + USB 信任 | 是否解冻子线 E |
| S1 | — | — |
| S2 | headscale 主机（可后置） | — |
| S3 | 鼠标操作 DevEco、点「是」授权首次 SDK 同步 | **`type:vpn` 无法识别时是否手改 SDK 目录** |
| S4 | 签名方式、证书 | 自动签名 / p12 / 未签名 |
| S5 | 点 VPN 授权弹窗 | 是否已连其他 VPN（2203002 场景） |
| S6 | **headscale 的 LAN 可达地址 + preauthkey** | **红线豁免（server_url 改 LAN）** |
| S7 | 手机↔headscale 主机网络可达（含 3478 端口） | 允许暴露的端口范围 |
| S8 | 第二个 peer 节点 | 验收层级（1/2/3 层，见 §3 S8） |

---

## 12. 最容易被高估或做错的项（我认为本题的 Top5）

1. **「真机前把编译错误清零」——不可能。** 报错面不在仓库里。只能承诺「错误分类 + 处置树 + 最小探针」。
2. **把 B 类（CU2/5/6/7/8、编译零错、全链通）写进完成定义。** 本机零工具链（§1.1 实测），承诺不了。
3. **以为 495 用例绿 = 协议栈能连真机。** BASELINE §3.0 说得极清楚：全部是向量/交叉验证，**从未与真实对端对拍**；而当前 regress 脚本连「能跑」都不成立。
4. **低估「人」这个变量。** 剧本里至少 6 个人工确认点（§11），每一个失败都会让 agent 误诊为代码问题。D1 这条「两条控制面路径」更隐蔽——两侧测试都全绿。
5. **以为 `handover/owner-with-real-device.md` 是可直接执行的剧本。** 它有至少 2 条不可执行命令（hvigorw、238 期望值），且没提 D1/D3。

---

## 13. 不确定性清单（谁、在什么条件下复核）

| # | 我的判断 | 置信 | 复核条件与责任人 |
|---|---|---|---|
| U-1 | D1「必须走 tailcfg 路径」 | **高** | 依据是 `client.ts:70-73` 自陈本地契约 + `messages.ts:167-178` 无 auth 字段。若有人在真机上证伪（即 TLV 路径也能被 headscale 接受），全盘重估 |
| U-2 | headscale `server_url` 会下发给客户端 | **中高** | 依赖 headscale v0.29.x 行为，我**本机无 headscale 可查**（§1.1）。由 S2 阶段跑通 `register.node.ts` 时顺带验证 |
| U-3 | 「一格 3478 + 8080 即可」 | **中** | DERP advertise 的地址/端口规则未查（需 headscale 源码或实测）。D3 落地时由执行者核 |
| U-4 | DevEco 6.x 与 hvigor modelVersion 5.0.0 匹配 | **中** | `build-feasibility-linux.md` 未覆盖版本矩阵。S0 时人确认 |
| U-5 | 「最小探针能在 15 分钟内给出 CU6 答案」 | **中** | 探针本身也可能撞上 SDK/版本问题。由 S3 执行者实测修正，不影响我给的判定树 |
| U-6 | `docs/pre-device/` 目录名与最终产出路径 | **低** | 这是我提议的路径，非既有约定。合并人可改 |
| U-7 | 我对本机零工具链的判断会随时间失效 | **低但重要** | 规划者换机器后须重跑 §1.1 的 `command -v` 循环 |

---

## 14. 风险与依赖

- **单点依赖：华为开发者账号**。没有它，S3 起全部不可执行（`build-feasibility-linux.md:44` 卡点 A）。这是**唯一的人类关键路径**，建议规划一落地就由人发起申请。
- **网络依赖**：真机侧到 headscale 的可达性（LAN/WiFi），企业网络常见「AP 隔离」「客户端隔离」会静默阻断——S6 失败的高频真实原因。
- **红线张力**：现有 `agent-interop-regression.md` 红线是为同机 Node 回归设计的，真机场景必须**书面豁免**部分条款（§6 D3）。**这需要 owner 签字，不是 agent 能自行决定的**。
- **冻结面张力**：D2（h2c 落包）可能触及 8 包接口冻结。若架构师裁定「不许新增包」，则 h2c 只能落在 `app/` 侧——**这会改变整个 S6 的形态**，必须在真机前定。
- **成本估计（我给合并人的判断）**：P0 全部可在规划机完成，估计 1–2 个 agent-session；S1–S8 的真机执行是**人类日历时间**（DevEco 安装、账号实名、固件、授权弹窗），不是 agent 计算时间。人应据此安排资源。
