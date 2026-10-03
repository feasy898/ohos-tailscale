# 接手任务：在带真机的环境把 `app/` 编译成 HAP 并完成 VPN 冒烟

## 你要做什么

`app/` 工程从未编译（自 2026-09-28 起冻结为 WAITING_EVENT）。你的任务是**解冻子线 E**，按 DELIVERY_REPORT §6.3 七步清单走到「HAP 安装 + VPN 冒烟 + peer 互连证据」。

## 前置（一次性 owner 准备）

1. DevEco Studio 6.x（鸿蒙 NEXT 模板默认在 6.x 完整支持）；
2. HarmonyOS SDK（API 12+ ets/native/previewer 工具链）；
3. 鸿蒙 NEXT 真机："开发者模式" 打开，USB 调试授权；
4. `hdc list targets` 能看到真机 SN。

不需要的：GitHub 账号（已经在 feasy898/ohos-tailscale 公开）；headscale 二进制（D 子线走远端 docker，与本任务解耦）。

## 第一周任务顺序（按依赖序）

### Day 1：环境与基线复跑

```bash
git clone https://github.com/feasy898/ohos-tailscale.git
cd ohos-tailscale
npm install
npm test && npm run typecheck && npm run test:bridge && npm run validate:shell
```

**预期**：495/0 · 0 · 30/0 · 66/0 全绿。没全绿就停——8 个 npm 包接口冻结，回归成本极高，**先报 issue**。

### Day 2：ArkTS linter 复跑

按 [docs/arkts-linter-rebuild.md §2](../arkts-linter-rebuild.md) 三步：

```bash
bash interop/arkts-mirror.sh   # 拉镜像
node interop/arkts-check.js    # 跑 src 0 / test 321 / 负对照 = 小整数
```

实测数字写到 DELIVERY_REPORT §6 末尾作为 A-2 闭环证据。

### Day 3–5：DevEco 首次编译与错误清零

`File → Open → app/`，让 hvigor 同步。第一次必然报错，按频率从高到低处理：

- **`"type": "vpn"` 字段未识别**：参考 [docs/architecture.md §7.2](../architecture.md) 与 `app/README-app.md §2.5`。
- **`@kit.NetworkKit` / `@ohos.net.socket` / `@ohos.security.cryptoFramework` 导入路径**：编译器会自动提示正确路径。
- **`module.json5` 中 abilities 字段**：参考鸿蒙官方 sample；本仓 `app/AppScope/` 与 `app/entry/` 是骨架。
- **`VpnExtensionAbility.ets` 是 stub**（`app/entry/src/main/ets/vpnextensionability/VpnExtensionAbility.ets`，里面有 TODO 与空 addresses）：替换为真能力——调用 `@ohos.net.vpn` 创 vpn fd + `@ohos.security.cryptoFramework` 做 WG 握手 + `@ohos.net.socket` 收发 UDP wireguard 包。**最大的一块工作**。
- **`app/bridge/src/{mock-localapi,mock-peerapi,mock-tun}.ts`**：替换为真 `LocalAPI over HDC` / 真 `PeerAPI over HTTP+Noise` / 真 `tun fd` 读写。

### Day 6：首答 CU6（决定集成方式）

CU6 是「ets loader 是否接受 `.ts` specifier」——本仓所有 import 都是 `'xx.ts'`。

- **接受**：直接走。
- **不接受**：走 hvigor 构建前的 `.ts → .js` 批改，或开 ArkTS loader 自定义。预计 1 天工作量。

### Day 7：HAP 安装与 VPN 冒烟

```bash
hvigorw assembleHap --mode module -p product=default
hdc install entry/build/default/outputs/default/entry-default-signed-signed.hap
hdc shell am start -n com.example.ohos_tailscale/.EntryAbility
# 真机上点 VPN 权限授权 → 注册到隔离 headscale → 验证 peer 互连
```

预期：`ohos-interop-node*` 注册到 headscale，`100.100.x.y` 分配到设备。

## 红线（不可放宽）

- G0 五门必须维持全绿；
- 协议语义必先实读 `docs/upstream/`；
- 8 包接口不可改——改的话走架构师修订（同步升版本号 + `architecture.md §10.3`）；
- 不碰生产 tailnet；
- mock-peerapi.ts:175 等 4 处 Mimosa 标 high 的代码——**mock 是 mock**；真机上要把 mock 替换为真能力，mock 留作单元测试。

## 完成后必做

1. **DELIVERY_REPORT §6 续写 §7 真机节**：实测数字、首答 CU6、错误清零笔记、证据 commit hash；
2. **worklog.md 追加**（append-only）；
3. **CHANGELOG**（如不存在就建 `CHANGELOG.md`）标注 `0.2.0` 真机首发；
4. **au-subset D 复跑**：拿到 DevEco 环境后顺便复跑一次 headscale 隔离互操作（按 [agent-interop-regression.md](agent-interop-regression.md)）——这件事之前是分头做的，现在环境齐了一次过。

## 找不到时怎么办

- **任何协议语义问题** → 查 `docs/upstream/ts-main/` 对应文件:行号；不查就停下来等；
- **任何 ArkTS 编译错误** → 翻 `docs/arkts-constraints.md`；
- **任何 G0 门禁失败** → 不要硬改测试凑绿；先调查实现；
- **跨包改动** → 查 `docs/architecture.md §10.2 AU 清单 + §10.3 版本记录`，确认不破坏冻结面。
