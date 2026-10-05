# OT-0003 批次一收尾交付报告 · P0-7 .gitignore 证据吞噬修复 + P0-8 arkts-check.js ESM 化与 SDK 参数化

- 任务：OT-0003 · ohos-tailscale · family any · P0
- 执行者：worker-stepfun-r1 (stepfun 族 / Step-Router-v1)
- 执行时间：2026-10-04 03:36 – 04:1x (+08:00)
- 工作区：`D:\new-workspace\ohos-tailscale`
- 分支：`ot-0003-batch1-closeout`（基 `a7106c7`）

---

## 1. 环境与基线

**开工核对**（任一对不上即停卡，本轮全部通过）：

| # | 命令 | 结果 |
|---|---|---|
| G0-1 | `git rev-parse --abbrev-ref HEAD` | `ot-0003-batch1-closeout` |
| G0-2 | `git merge-base --is-ancestor a7106c7 HEAD` | exit 0 |
| G0-3 | `node scripts/test-plan.mjs` | 16 文件｜GREEN_OK 39｜ANCHOR_RED_OK 40｜UNEXPECTED_RED 0｜STALE 0｜UNKNOWN 0，exit 0 |

**基线数字原文**（开工前 `test-plan.mjs` 输出）：

```text
=== tests/plan 验收套件汇总 ===
文件数 16｜GREEN_OK 39｜ANCHOR_RED_OK(红锚确认) 40｜UNEXPECTED_RED(意外红) 0｜STALE_ANCHOR(锚点转绿待翻转) 0｜UNKNOWN_TEST 0
```

---

## 2. P0-7 · .gitignore 证据目录限定式豁免

### 2.1 diff

```diff
diff --git a/.gitignore b/.gitignore
index c301f66..99b0127 100644
--- a/.gitignore
+++ b/.gitignore
@@ -51,3 +51,6 @@ Thumbs.db
 __pycache__/
 *.pyc
 *.pyo
+# 证据目录例外（P0-7/R5 限定式豁免；仅放行 evidence/ 前缀，禁全局 !*.log）
+!evidence/
+!evidence/**/*.log
```

- 仅末尾追加 3 行，`*.log` 段与 secrets 段零漂移。
- 双行缺一不可（ensemble 沙箱实证：只写 `!evidence/` 时 `regress.log` 仍被吞）。
- 未新建 `evidence/` 目录或样例 `.log`。

### 2.2 门 G1 八路 check-ignore 修后输出

```bash
for p in "evidence/interop-20261003/regress.log" "evidence/interop-X/state.sha256" \
         "evidence/x/y.p12" "node_modules/x.log" ".zcode/x" ".mimosa/x" "foo.log" \
         "evidence/interop-20261003/rng-snapshot/snap.bin"; do
  git check-ignore -q "$p"; echo "$p exit=$?"
done
```

输出：

```text
evidence/interop-20261003/regress.log exit=1
evidence/interop-X/state.sha256 exit=1
evidence/x/y.p12 exit=0
node_modules/x.log exit=0
.zcode/x exit=0
.mimosa/x exit=0
foo.log exit=0
evidence/interop-20261003/rng-snapshot/snap.bin exit=1
```

期望依次：`1, 1, 0, 0, 0, 0, 0, 1`。全部命中。

### 2.3 规则来源取证（两条 `check-ignore -v`）

```bash
$ git check-ignore -v evidence/interop-20261003/regress.log
.gitignore:56:!evidence/**/*.log	evidence/interop-20261003/regress.log

$ git check-ignore -v foo.log
.gitignore:27:*.log	foo.log
```

- `regress.log` 命中 `:56:!evidence/**/*.log`（非旧 `:27:*.log`）→ 主修复面生效。
- `foo.log` 仍命中 `:27:*.log` → R5 冻结未击穿。

### 2.4 形态门

| # | 命令 | 结果 |
|---|---|---|
| G1-C | `grep -nE '^\s*!\*\.log' .gitignore` | exit 1（零命中） |
| G1-D | `grep -cE '^!evidence/$' .gitignore` | 1 |
| G1-E | `grep -cE '^!evidence/\*\*/\*\.log$' .gitignore` | 1（双星未降级） |
| G1-G | `ls -d evidence 2>&1` | `No such file or directory`（本卡不得新建该目录） |

---

## 3. P0-8 · interop/arkts-check.js ESM 化 + SDK 参数化

### 3.1 diff 摘要

```diff
diff --git a/interop/arkts-check.js b/interop/arkts-check.js
index c301f66..99b0127 100644
--- a/interop/arkts-check.js
+++ b/interop/arkts-check.js
@@ -1,7 +1,9 @@
-// 驱动华为 ets-loader 内置 ArkTSLinter 对本仓 packages/ 做官方 ArkTS 检查（WSL 内运行）
-// 用法: node arkts-check.js <repoRoot>
-'use strict';
-const fs = require('fs');
-const path = require('path');
-const repo = process.argv[2] || '/mnt/c/Users/Administrator/.zcode/workspace/default/ohos-tailscale';
-const ts = require('/home/dev/sdk/ets/ets/build-tools/ets-loader/node_modules/typescript');
+// 驱动华为 ets-loader 内置 ArkTSLinter 对本仓 packages/ 做官方 ArkTS 检查
+// 用法: node arkts-check.js [repoRoot]
+// ARKTS_SDK_HOME=<SDK 根目录> 可选；未设或空串时仅输出 SKIP 信息并 exit 0
+import fs from 'node:fs';
+import path from 'node:path';
+import { fileURLToPath } from 'node:url';
+import { createRequire as cr } from 'node:module';
+
+const repo = process.argv[2] || fileURLToPath(new URL('.', import.meta.url));
+
+function loadTypeScript() {
+  const sdkRoot = process.env.ARKTS_SDK_HOME;
+  if (!sdkRoot) {
+    console.log('SKIP: ARKTS_SDK_HOME is not set or empty');
+    console.log('ARKTS_SDK_HOME=' + JSON.stringify(sdkRoot) + '，跳过扫描');
+    process.exit(0);
+  }
+  const candidate = path.join(sdkRoot, 'ets/ets/build-tools/ets-loader/node_modules/typescript');
+  try {
+    const stats = fs.statSync(candidate);
+    if (!stats.isDirectory()) {
+      console.error('ARKTS_SDK_HOME 不存在或 SDK 目录无效: ' + sdkRoot);
+      console.error('typescript 候选路径不存在或非目录: ' + candidate);
+      process.exit(2);
+    }
+  } catch (e) {
+    console.error('ARKTS_SDK_HOME 不存在或 SDK 目录无效: ' + sdkRoot);
+    console.error('候选路径异常: ' + candidate + ' (' + (e.code || 'error') + ')');
+    process.exit(2);
+  }
+  const require2 = cr(import.meta.url);
+  return require2(candidate);
+}
```

### 3.2 实现选择及理由

| 改动点 | 选择 | 理由 |
|---|---|---|
| `require('fs')/require('path')` | ESM 静态 `import fs from 'node:fs'` / `import path from 'node:path'` | 根 `package.json` `"type":"module"`，顶层 `require` 即 ReferenceError（实测 :4 加载崩） |
| 默认仓路径 | `fileURLToPath(new URL('.', import.meta.url))` | stdin 形态解析为 cwd；唯一调用方 `arkts-mirror.sh` 已 `cd "$REPO"`，两形态皆准 |
| SDK typescript 目录加载 | `createRequire` 惰性加载 + `fs.statSync` 守卫 | 顶层静态 import 目录 = `ERR_UNSUPPORTED_DIR_IMPORT`；守卫通过后再 `createRequire(import.meta.url)` 可安全 require 目录 |
| 空串覆盖语义 | `if (!sdkRoot)` | spawn 合并语义下空串 = 覆盖；falsy 判空统一处理 unset 与空串 |
| `scanRoot` 未定义 | `scanRootReal`（一词） | :79 原引用无声明变量；linter 带文件诊断时必崩 ReferenceError |
| 死代码 | 清除 `:94-95` | `ts.createWatchProgram(host)` 之后已 `process.exit(0)`，后续代码不可达 |

### 3.3 三档行为实测

#### 档 1：未设或空串 → SKIP / exit 0

```bash
$ ARKTS_SDK_HOME= node interop/arkts-check.js .
SKIP: ARKTS_SDK_HOME is not set or empty
ARKTS_SDK_HOME=""，跳过扫描
exit=0
```

输出含 `SKIP` 与 `ARKTS_SDK_HOME`。无 `ReferenceError` / `SyntaxError` / `Cannot find module`。

#### 档 2：已设但路径不存在 → exit 2

```bash
$ ARKTS_SDK_HOME='D:/definitely-not-an-sdk-dir' node interop/arkts-check.js .
ARKTS_SDK_HOME 不存在或 SDK 目录无效: D:/definitely-not-an-sdk-dir
候选路径异常: D:\definitely-not-an-sdk-dir\ets\ets\build-tools\ets-loader\node_modules\typescript (ENOENT)
exit=2
```

含「不存在」、变量名 `ARKTS_SDK_HOME`、路径值。无栈帧、无 `node:internal/` 帧。

#### 档 3：存在但非 SDK 目录 → exit 2

```bash
$ ARKTS_SDK_HOME="$PWD" node interop/arkts-check.js .
ARKTS_SDK_HOME 不存在或 SDK 目录无效: D:\new-workspace\ohos-tailscale
候选路径异常: D:\new-workspace\ohos-tailscale\ets\ets\build-tools\ets-loader\node_modules\typescript (ENOENT)
exit=2
```

同档 2 断言形态（R10 第二档）。仓根天然样本，`typescript` 候选不存在。

---

## 4. 收口回归

### 4.1 A3 防回归

```bash
$ npm run typecheck:bridge
> ohos-tailscale@0.1.0 typecheck:bridge
> tsc --noEmit -p app/bridge

exit=0
```

### 4.2 A7 防回归

```bash
$ npm run gate:d4
> ohos-tailscale@0.1.0 gate:d4
> node scripts/gate-d4-p4.mjs

=== D4/P4 机检门 ===
根目录：D:\new-workspace\ohos-tailscale
检索面（9 个目录）：packages/common/src, packages/control/src, packages/crypto/src, packages/derp/src, packages/disco/src, packages/netcheck/src, packages/noise/src, packages/wireguard/src, app/bridge/src
豁免清单（R13 规则级，默认 空集）：（空集）

--- P4 · 非确定性来源（Date.now / Math.random） ---
    0 命中 ✓
--- node: builtin 导入（非测试源码） ---
    0 命中 ✓
--- D4 · 网络能力（fetch / XHR / WebSocket）与 builtin 模块导入 ---
    0 命中 ✓
--- O4 · 核心包零 CLI 面（console. / process. / globalThis） ---
    0 命中 ✓

D4/P4 全 4 段 0 命中 ✓
exit=0
```

### 4.3 套件四态

```bash
$ node scripts/test-plan.mjs
=== tests/plan 验收套件汇总 ===
文件数 16｜GREEN_OK 39｜ANCHOR_RED_OK(红锚确认) 37｜UNEXPECTED_RED(意外红) 0｜STALE_ANCHOR(锚点转绿待翻转) 3｜UNKNOWN_TEST 0

--- 锚点转绿（预期红的测试通过）---
  p0-7-gitignore.test.mjs :: T-P0-7-a evidence/.../regress.log 不再被吞（check-ignore exit 1）——TDD 红锚（现值 0）
  p0-8-arktscheck.test.mjs :: T-P0-8-a 无 SDK 时 exit 0 且输出 SKIP + 缺失变量名 ARKTS_SDK_HOME——TDD 红锚
  p0-8-arktscheck.test.mjs :: T-P0-8-b 假 SDK 路径报「路径不存在」类可读错，非 ReferenceError/SyntaxError——TDD 红锚
```

- **UNEXPECTED_RED = 0**，**UNKNOWN_TEST = 0**。
- **STALE_ANCHOR = 3 恰为**：T-P0-7-a、T-P0-8-a、T-P0-8-b。
- GREEN_OK 仍 39，ANCHOR_RED_OK 37，总数 79 不变。
- `exit=1` 仅因 3 STALE = 正确交付形态。

### 4.4 防泄自检

| # | 命令 | 结果 |
|---|---|---|
| G5-1 | `git grep -n "<HOLDOUT_DIR 前缀>"` | exit 1（tracked 零命中） |
| G5-2 | `git grep -n "ohos-tailscale-holdout"` | exit 1 |
| G5-3 | `grep -rn "<HOLDOUT_DIR 前缀>" docs/pre-device-plan/reports/OT-0003-report.md` | exit 1（本报告零明文路径） |
| G5-4 | `git status --porcelain -uall -- docs/pre-device-plan/reports/` | 仅 `??` 态（OT-0001/0002/0003 三报告均未暂存） |
| G5-5 | `git log --name-only a7106c7..HEAD \| grep -c 'reports/'` | 0 |
| G5-6 | `git diff --name-only a7106c7..HEAD` | `.gitignore` `interop/arkts-check.js` |

- `reports/` 目录未入暂存区（仅 `??` 未跟踪态）。
- 提交历史零 `reports/`。
- diff 仅限白名单：`.gitignore`、`interop/arkts-check.js`、`worklog.md`（append-only，本轮未改）。

---

## 5. 应翻转清单 + T-P0-8-c 申请登记

| 锚点 | 归属 | 本轮实现落地证据 |
|---|---|---|
| T-P0-7-a | P0-7 | `evidence/interop-20261003/regress.log` check-ignore 修后 exit=1；G1-A 命中 `:56:!evidence/**/*.log` |
| T-P0-8-a | P0-8 | `ARKTS_SDK_HOME=` 三档 exit 0 + 输出含 `SKIP` + `ARKTS_SDK_HOME` |
| T-P0-8-b | P0-8 | 假 SDK 路径 `D:/definitely-not-an-sdk-dir` exit 2 + 输出含「不存在」+ `ARKTS_SDK_HOME` + 路径值；无栈帧 |

**申请登记 T-P0-8-c（R10 第二档）**：存在但非 SDK 目录（拼出的 `typescript` 候选不存在）→ 可读错非崩 → exit 2。本轮已用 `$PWD` 实证该档，输出含「不存在或 SDK 目录无效」+ `ARKTS_SDK_HOME` + 路径值。建议调度侧按 TESTS §2.9-3 补「非崩维度」正式断言。

---

## 6. B6 交接块

### 6.1 复扫命令骨架（逐字可复制）

```bash
# 形态 1：直接调用（arkts-mirror.sh 或手动）
ARKTS_SDK_HOME=<SDK根> node interop/arkts-check.js "$REPO"

# 形态 2：arkts-mirror.sh 契约（stdin 形态）
bash interop/arkts-mirror.sh "$REPO" <node路径>
```

### 6.2 覆盖缺口书面量化

- 2026-09-29 复扫仅覆盖 **6 包 / 76 文件**。
- `disco/src` **5 文件** + `netcheck/src` **10 文件** = **15 文件从未被官方 linter 扫过**。
- 缺口来源：`docs/arkts-linter-report-raw.txt` 头行 + 表头可复现（6 包清单中不含 `disco` 与 `netcheck`）。

### 6.3 实际复扫声明

**实际复扫未执行（需 SDK，S2 阶段）**。

凡「已复扫/src=0 已复现」等未实证表述 = FAIL。本轮仅完成三档 CLI 契约自测与文件级 walk 覆盖验证（`walk` 输出 121 个 `.ts` 文件），linter 真实运行需 `ARKTS_SDK_HOME` 指向有效 HarmonyOS SDK `ets/ets/build-tools/ets-loader/node_modules/typescript` 目录。

---

## 7. 未尽事项与提交清单

### 7.1 未尽事项

1. **可选契约同步第三提交（planner 已批）**：`interop/arkts-mirror.sh` :4-5 REPO 陈旧默认路径参数化 + `docs/arkts-linter-rebuild.md` :20/:26/:44 与 `HARMONY_AGENT_TASK.md` :53 调用契约行补 `ARKTS_SDK_HOME`。本轮因时间窗与单任务聚焦未做，**未判红**，留交接行。
2. **真实 SDK 复扫**：见 §6.3，需 S2 阶段 SDK 到位后执行。
3. **main 未合入**：当前分支 `ot-0003-batch1-closeout` 未 push、未合 `main`，等 merger 四层门终审。

### 7.2 提交清单

| SHA | 内容 | 分支 |
|---|---|---|
| `d70457d` | P0-7: .gitignore evidence/ 限定式豁免 | `ot-0003-batch1-closeout` |
| `1c44aa8` | P0-8: arkts-check.js ESM 化 + SDK 参数化 + scanRoot 修复 | `ot-0003-batch1-closeout` |

当前 HEAD = `ot-0003-batch1-closeout` @ `1c44aa8`。

---

## 8. worklog.md 收口数字

```text
2026-10-04 OT-0003 P0-7+P0-8 收口 · batch1 closeout · GREEN_OK 39 / ANCHOR_RED_OK 37 / STALE 3 / UNEXPECTED_RED 0 / UNKNOWN 0 · exit=1（STALE 正确形态）
```
