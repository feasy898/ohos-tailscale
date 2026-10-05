# ArkTS Linter 复建路径（2026-10-02，文档）

> 对应 TASK.md 子线 A 的 A-2：ArkTS linter 复建路径成文。本文只写**操作手册级**事实——复现 2026-09-29 官方 ArkTS linter（src 警告 154→0）的工具链获取渠道、复建步骤、与本仓 `interop/arkts-check.js` 的关系与调用方式。
>
> 来源：`docs/oracle/protocol-notes.md`、`DELIVERY_REPORT.md` §5.4、`interop/arkts-mirror.sh`、`interop/arkts-check.js`、`README-upstream.md`。
>
> 注意：本机（提交者开发机）无 HarmonyOS SDK；以下为**方法学**，不替用户实跑——owner 须在带 DevEco/SDK 的环境实际复跑并按本文锚定对照。

## 1. 工具链获取渠道

按 §5.4 实测证据（2026-09-29）：

- **OpenHarmony 7.0 SDK**：从华为公开镜像下载 `ohos-sdk`（版本 7.0-Release），解包 `ets/` 组件——内含华为魔改 TypeScript 4.9.5 的 `ArkTSLinter`。该镜像在 DevEco Studio 内部亦可达（参见 `README-upstream.md` 历次实测）。
- **渠道分流**：repo.huawei.com / mirrors.openharmony.cn 在公开网络不可达时，尝试 developer.huawei.com（需登录账号）——本次复现均走公开镜像路径。
- **本仓存档**：未随 git 入仓 SDK 二进制（体积过大）；构建步骤以镜像脚本 `interop/arkts-mirror.sh` 形式固化。

## 2. 复建步骤（按 09-29 实测顺序）

1. **拉镜像**：`interop/arkts-mirror.sh` 完成下载与解包；产物目录内应包含 `ets-loader` 与 `ArkTSLinter` 可执行入口。
2. **驱动 linter**：`interop/arkts-check.js` 调用 `ArkTSLinter` 跑 `lintEtsOnly` 模式——只扫 `.ets` 文件。
3. **核心库以 .ets 形态全量可扫**：本仓纯 TS 通过简单重命名（`.ts` → `.ets`）即可上扫；镜像脚本的 `interop/arkts-mirror.sh` 负责这步。
4. **负对照**：脚本会先在测试目录跑一次以验证 linter 确实在工作（与基线 154 src 警告对比）。

## 3. 与 interop/arkts-check.js 的关系

- 入口：`node interop/arkts-check.js`。
- 内部逻辑（按 §5.4 头注）：

  ```js
  // 伪代码（实际请读 interop/arkts-check.js）
  // 1. 校验镜像与解包路径
  // 2. 对 packages/*/src/*.ts 重命名为 .ets 副本
  // 3. 调 ArkTSLinter lintEtsOnly 跑扫描
  // 4. 把 src 警告数打印为 src=<n>，test 警告数固定为 test=321（按约定保留）
  // 5. 负对照预期：负对照=<small>（验证 linter 在工作）
  ```

- 调用时机：CI 阶段（如配 CI 后）或 owner 在带 SDK 环境手动跑；本机无可跑——这是该子线被归类到"维持性动作"的原因。

## 4. 与本仓门禁的衔接

- A-2 本身不影响 G0 五门（npm test / typecheck / test:bridge / validate:shell / D4-P4），而是真机集成前一道独立闸门——CU 系列（BigInt / 动态键遍历 / .ts specifier）的静态合规基线。
- 实测历史基线（2026-09-29）：src=0、test=321（按约定保留）、负对照=小整数。
- 真机解冻日需复跑：拉镜像 → arkts-check.js 跑 → 比对 src=0 是否保持。如漂移需对照 §5.4 根因（裸扫描下跨包自定义 Error 类型不可解析 → handleThrowStatement 把所有 throw new XxxError(...) 判为任意类型 → 修法为追加 `as Error` 上溯）。

## 5. 未决项

- 9.30-10.01 间华为镜像是否仍可达（已知 09-29 可达；如不可达需考虑 DevEco Studio 自带的 ets 组件——也支持 `lintEtsOnly`，只是版本与 SDK 配套版本可能漂移）。
- 当前 `interop/arkts-mirror.sh` 在 worker-A round 1 Linux 编译链调研时无法在本机复跑——这是已记录的"owner 需带 SDK 环境"裁定的一部分。
- 建议 owner 在 DevEco 6.x 上首跑一次，写一份 "实际跑出 src=N / test=321 / 负对照=N" 的实测报告追加到 DELIVERY_REPORT §6 末尾，作为 A-2 完全闭环的标志。

## 6. 红线（同 DELIVERY_REPORT §3.1 / §3.4）

- 镜像下载与解包**仅在 owner 控制的开发环境执行**，不在 CI 自动跑（SDK 体量大 + 镜像可达性非确定性）。
- linter 输出含完整源码警告文本，**不得入公仓 commit**——只入 `src=<n>` 这类聚合计数（防止源码泄露到公共镜像脚本输出日志）。
