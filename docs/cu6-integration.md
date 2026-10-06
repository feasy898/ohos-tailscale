# CU6 集成层实证报告：纯 TS 协议库 × HAP 工程（2026-10-06）

> **CU6 答案：能。** 协议库（根 `packages/*` 纯 TS npm workspace 包）可以被 HAP 工程引用并随构建打包，
> 已用官方 CLT（devecocli 1.3.0-stable + command-line-tools 26.0.0.851）在本机 Linux 真实构建验证。
> 胜出方案 = **B：hvigor HAR 模块化**（`app/core-har/*`，`file:` 目录依赖），零配置偏离
> （`useNormalizedOHMUrl` 保持原值 `true`）。
>
> 环境：`docs/build-linux.md` 配方；工作目录 `/home/pan-ding/ohos-build-wt`（git worktree，分支 `probe/cu6`）。

## 0. 基线

```
cd /home/pan-ding/ohos-build-wt/app && devecocli build --build-mode debug
→ BUILD SUCCESSFUL（增量 805ms）
产物 entry/build/default/outputs/default/entry-default-unsigned.hap = 41,708 B（未接协议库）
```

判据（三方案统一）：
1. `BUILD SUCCESSFUL`；
2. hap 体积显著增长（协议代码进包）；
3. ets 侧能 import 到 noise/wireguard 的至少一个纯函数——构建期不可运行，以
   **模块解析成功（import 被 loader 接受）+ 协议符号出现在打包产物 `ets/modules.abc`** 为准；
   入口页 `Index.ets` 真实调用点：渲染 `NOISE_PROTOCOL_NAME`（noise 版本协议名常量）、
   `WG_CONSTRUCTION`（wireguard 构造串）与纯函数 `parseWgMessageType(1)` 求值结果。

## 1. 方案 A：`file:` 目录依赖直指 `packages/*` —— ❌ 失败（保留证据）

接线：`packages/{common,crypto,noise,wireguard}` 各加 `oh-package.json5`（`main: src/index.ts`，
`package.json` 未动、npm workspace 不受影响）；`app/entry/oh-package.json5` dependencies 声明
`"file:../../packages/<p>"`。

- `ohpm install` **成功**：依赖以软链落地 `app/entry/oh_modules/@ohos-tailscale/<p> → ../../../../packages/<p>`。
- 传递依赖写版本区间 `"^0.1.0"` 时 ohpm 去 registry 拉取 → `404 / 00617101 Fetch Pkg Info Failed`；
  改 `file:../common` 相对路径后 install 通过。

CompileArkTS 三种配置形态均失败（错误码各不相同，精确记录）：

| # | 配置 | 报错 | 规模 |
|---|------|------|------|
| A1 | `useNormalizedOHMUrl: true`（原配置） | `00309001 Cannot import files from an external module using relative paths. Import statement: './errors.ts'. At file: …/packages/crypto/src/xchacha.ts` | 65 errors |
| A2 | `= false`，无根 oh_modules | `10505001 Cannot find module '@ohos-tailscale/common' … At File: …/packages/crypto/src/aead.ts:16:73`（loader 沿**真实路径**上溯，packages/ 上方无 oh_modules） | 4 errors |
| A3 | `= false` + 仓根手工 `oh_modules/@ohos-tailscale/*` 软链 | 裸说明符可解析，但 `10311002 Failed to resolve OhmUrl. Failed to get a resolved OhmUrl for "…/packages/noise/src/index.ts" imported by "…/pages/Index.ets"` | 88 errors |

**根因（读 CLT 源码钉死）**：`sdk/default/openharmony/ets/build-tools/ets-loader/lib/ark_utils.js`
的 `getOhmUrlByFilepath → processPackageDir` 只给两类文件路径分配 OhmUrl：
(a) 路径落在 `*/oh_modules/` 之下；(b) 路径落在 `modulePathMap` 某个 hvigor 模块目录之下。
软链被 realpath 解析到 `packages/…`（两不属）→ A3 必炸；而 `useNormalizedOHMUrl: true` 下
外部模块（ohpm 包）内部相对导入（`./errors.ts`）被 00309001 规则禁止（提示改写为 `{pkgName}/xxxx`），
改写会破坏 npm 侧 `node --test`（ESM 必须带 `.ts` 后缀）→ 源码两难，方案 A 判死。

提交：`42b11fe probe(cu6): 方案A file: 本地目录依赖 → 构建失败（保留证据）`。

## 2. 方案 B：hvigor HAR 模块化 —— ✅ 成功（胜出，已落地）

> CLT 的 ohpm（1.3.0-stable）**没有 `pack` 子命令**（`ohpm pack` → `unknown command`），
> HAR 化走 hvigor 原生路径：HAR 模块 + `harTasks`。

接线（提交 `d8dfdad` + 本轮终验）：
- `app/tools/sync-core-har.mjs`：把 `packages/{common,crypto,noise,wireguard}/src/*.ts` **字节级**
  同步到 `app/core-har/<p>/src/main/ets/`（协议源码零改动，`./x.ts` 相对导入原样保留），并生成
  壳模板（`oh-package.json5` / `hvigorfile.ts`(harTasks) / `build-profile.json5` / `src/main/module.json5`）；
- `app/build-profile.json5` `modules` 增加 4 个 HAR 模块（即"同步根 hvigor 配置"）；
- `app/entry/oh-package.json5`：`"@ohos-tailscale/<p>": "file:../core-har/<p>"`。

实测踩坑（逐一用报错钉死）：
1. HAR 模块必须有 `src/main/module.json5`，否则 `00304064 module.json5 file not found`（hvigor sync 期）；
2. HAR 公开入口若用 `Index.ets`（ArkTS barrel），纯 TS 源 import 它触发
   `10605999 Importing ArkTS files in JS and TS files is forbidden`——`main` 改指
   `src/main/ets/index.ts`（TS 入口）后消失；
3. 工程出现多模块后 `devecocli build` 要求显式 `--modules entry`（否则 `Multiple entry modules found`）；
4. HAR 模块自身的跨包依赖在其 `oh-package.json5` 里用 `file:../common`（目录依赖，模块互引）。

判据实测（全部通过）：

```
node app/tools/sync-core-har.mjs && ohpm install && \
devecocli build --build-mode debug --modules entry
→ BUILD SUCCESSFUL（57 tasks）
entry-default-unsigned.hap：41,708 B → 386,391 B（9.2×）

# 协议符号进包（unzip hap 后 grep ets/modules.abc，204,368 B）：
Noise_IK_25519_ChaChaPoly_BLAKE2s        FOUND   (noise NOISE_PROTOCOL_NAME)
Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s    FOUND   (wireguard WG_CONSTRUCTION)
WireGuard v1 zx2c4 Jason@zx2c4.com       FOUND   (WG_IDENTIFIER)
parseWgMessageType / NoiseIkInitiator / WgPeerTable / controlbaseBuildInitiation  FOUND

# HAR 产物（--modules common@default crypto@default noise@default wireguard@default → BUILD SUCCESSFUL）：
core-har/common.har 9,072 B | crypto.har 17,675 B | noise.har 13,865 B | wireguard.har 22,539 B

# useNormalizedOHMUrl=true（原配置）复验 → BUILD SUCCESSFUL（零配置偏离）
```

## 3. 方案 C：`.ets` 镜像进 `entry/src` —— ✅ 可行（备选，未采用）

接线（提交 `c7ee18b`）：`app/tools/mirror-core-ets.mjs` 把 34 个 `.ts` 镜像为
`entry/src/main/ets/protocol/<pkg>/*.ets`（改后缀 + import 重写：`'./x.ts'→'./x'`、
`'@ohos-tailscale/<pkg>'→'../<pkg>/index'`，逻辑零改动），ohpm 依赖清空作独立判据。

```
devecocli build --build-mode debug --modules entry → BUILD SUCCESSFUL
entry-default-unsigned.hap = 383,608 B；modules.abc 205,080 B
abc 符号：Noise_IK_…/parseWgMessageType/WgPeerTable/controlbaseBuildInitiation 全 FOUND
ArkTS 严格模式：34 个镜像 .ets 零警告（仅 Index.ets 既有 UI 警告：Circle fill 需 SDK 26、
showToast 弃用——与协议库无关，协议包代码全量通过 ArkTS 严格模式）
```

未采用原因：镜像是复制品（类型检查/495 测试只能跑 `packages/` 原件，镜像无测试覆盖）、
import 说明符被重写（镜像≠源）、34 个文件进 entry 源码树需脚本防漂移。

## 4. 结论与落地形态

| 方案 | 判据1 构建 | 判据2 体积 | 判据3 符号进 abc | 结论 |
|------|-----------|-----------|------------------|------|
| A `file:` 直指 packages | ❌ 00309001/10505001/10311002 | — | — | **不可行**（loader OhmUrl 归属规则 + 归一化 URL 相对导入禁令，源码两难） |
| B HAR 模块化 | ✅ | 41708→386391 B | ✅ 7/7 | **胜出，已落地** |
| C `.ets` 镜像 | ✅ | 41708→383608 B | ✅ 5/5 | 可行备选 |

落地清单（工作树现状）：
- `app/core-har/{common,crypto,noise,wireguard}`：HAR 模块（源 = `packages/*`，脚本同步）；
- `app/tools/sync-core-har.mjs`：同步脚本（改协议包后重跑即可，`ohpm install` + build）；
- `app/build-profile.json5`：modules 注册 4 个 HAR；
- `app/entry/oh-package.json5`：4 个 `file:../core-har/<p>` 依赖；
- `app/entry/src/main/ets/pages/Index.ets`：真实调用点——`import { NOISE_PROTOCOL_NAME } from '@ohos-tailscale/noise'`、
  `import { WG_CONSTRUCTION, parseWgMessageType } from '@ohos-tailscale/wireguard'`，
  首页渲染 `noise: Noise_IK_25519_ChaChaPoly_BLAKE2s` 与
  `wireguard: Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s · msgType(1)=1`；
- 终验：`BUILD SUCCESSFUL`，hap **386,407 B**，abc 符号 FOUND。

## 5. 回归验证（本机实跑）

```
npm test          → ℹ tests 495 / ℹ pass 495 / ℹ fail 0   （与基线 495 一致）
npm run typecheck → exit 0
npm run validate:shell → 68 passed, 0 failed
```

注意：本机 PATH 默认 node v22.16.0 **跑不了** `.ts` 测试（`ERR_UNKNOWN_FILE_EXTENSION`，
type-stripping 未启用）；须用 CLT 自带 node v24.14.1：
`PATH=/home/pan-ding/deveco/command-line-tools/tool/node/bin:$PATH npm test`。
历史 worklog 记录的 495 基线即在本机以新 node 跑通。

## 6. 后续步骤（真机前）

1. **补齐剩余四包**：`control/derp/disco/netcheck` 同样 HAR 化（`sync-core-har.mjs` 的 `PACKAGES`
   数组加名字即可；control 无内部依赖，derp→common，disco→common+crypto，netcheck→common）；
2. **真机/模拟器冒烟**：Index.ets 自检文案真机可见 + hilog 打点（模拟器需 `devecocli auth login`）；
3. **平台注入层**：`HttpTransport`/`Rng`/`Clock`/UDP socket（`@ohos.net.http` / cryptoFramework /
   `@ohos.net.socket` + `vpnConnection.protect(fd)`）按 README-app.md §4 注入；
4. **签名**：CSR→AGC→`devecocli signature`（材料已备：鸿蒙tailscale-certs/ohos-debug.csr）；
5. **CI**：CNB 流水线加 `node app/tools/sync-core-har.mjs` + `devecocli build` 步骤
   （云端等价路径已验证可产同款未签名 HAP，见 build-linux.md）。
