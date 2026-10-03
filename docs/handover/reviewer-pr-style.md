# 接手任务：评审 ohos-tailscale 的 PR / 复审 main HEAD

## 你要做什么

对仓库做**独立复审**——不复信任 commit message 自报数字，**一切结论来自你亲自跑过的命令或亲自读过的文件**。

## 必读（不要跳）

1. `README.md` —— 项目总览与硬约束位置
2. `TASK.md` —— 子线裁定与冻结状态
3. `DELIVERY_REPORT.md §6` —— 2026-10-02 二期批次验收节（最新实测数字 + 移交清单）
4. `docs/architecture.md` —— 8 包接口契约 + AU/CU 清单
5. `docs/research/2026-10-02-*-*.md` —— 7 份研究笔记（B1/B2/B3/C1/C2/C3/D）
6. `docs/arkts-constraints.md` —— ArkTS 禁则全集
7. PR 涉及的源文件 + 对应研究笔记 + 对应上游 `docs/upstream/` 文件

## 不可放过的红线

### G0 五门复跑（必做）

```bash
npm ci
npm test
npm run typecheck
npm run test:bridge
npm run validate:shell
# D4/P4 grep（macOS/Linux/Windows 通用）
grep -rEn 'Date\.now|Math\.random' packages/ --include='*.ts' | grep -v '^\s*//' | grep -v ':\s*//' | grep -v ' \* '
grep -rEn "from ['\"]node:" packages/ --include='*.ts' | grep -v '\.test\.ts$'
```

**实际跑**，不要相信自报数字。基线（2026-10-02 末轮）：495 / 0 · 0 · 30 / 0 · 66 / 0 · 0 / 0。

### 协议语义对照（必做）

任何改 `packages/` 下包内协议语义的 PR：**必对照 `docs/upstream/`** 对应文件:行号，发现凭记忆写的迹象 → 直接 reject。

### 已知误报清单（防误卡）

Mimosa 在以下行**持续标 high**，但都是 pattern-match 误识，**已修复 commit `e136900`**：

| 位置 | Mimosa 标的 | 真实状态 |
|------|-----------|---------|
| `interop/upload_server.py:38` | [high] 路径穿越 | 已加 filename 白名单 + realpath 二次校验 + 截断丢弃 |
| `interop/arkts-check.js:34` | [high] walk 是 path-traversal 入口 | 已 skip symlink + scanRoot realpath 必须落在 repoReal 内 |
| `app/bridge/src/mock-peerapi.ts:192` | [high] answerDns 是 sql-injection 入口 | **非 SQL 注入**——路径无 SQL 字符串拼接，仅函数调用 |
| `app/bridge/src/mock-peerapi.ts:192` | [medium] 跨文件污点 | 已加 input validation（FQDN 字符集 + 长度 + `..` 拒），负例已 commit |

**评审时请亲自读这 4 段代码**，结论要写到 PR 评论里。如果修复不够或 regress → reject。

### 冻结面

- `packages/common/src/index.ts` 不可改；
- 其它包改导出必须同步升小版本号 + `docs/architecture.md §10.3` 版本记录；
- 子线 E 保持冻结 WAITING_EVENT——PR 不应尝试 `app/` 编译/真机集成；
- 子线 D 真实互操作回归不要求每个 PR 都跑，但 PR 触及 `interop/` 时必须保持脚本可读、不破坏一键入口。

## 评审报告写到 PR 评论

至少覆盖：

1. **基线复跑**（五门数字与上面基线对比）；
2. **改动文件清单**（与 PR description 一致性）；
3. **AU5–AU8 状态复核**（如 PR 涉及 B/C 面）；
4. **4 处已知误报的二次确认**（如代码行号变了，重新打开看）；
5. **整体评级**：approve / request changes / block。

模板：

```
## 评审：<PR # / 提交简述>

### 基线复跑（本地实跑）
| 门 | 实测 |
|----|------|
| npm test | tests=… / fail=… |
| typecheck | exit=… |
| test:bridge | tests=… / fail=… |
| validate:shell | passed=… / failed=… |
| D4/P4 | 命中=… |

### 改动文件
…

### 协议面复核（如有）
…

### Mimosa 4 处已知误报二次确认
- upload_server.py:38 → 真名=… 字符集白名单 ✓
- arkts-check.js:34 → symlink skip + realpath 校验 ✓
- mock-peerapi.ts:192 → input validation ✓；非 SQL 注入（路径无 SQL 拼接）✓
- mock-peerapi.ts:192 → 跨包污点边界已校验 ✓

### 整体评级
approve / request changes / block
```

## 找不到时怎么办

- **协议语义疑问** → 查 `docs/upstream/` 对应文件:行号；
- **ArkTS 禁则疑问** → 查 `docs/arkts-constraints.md`；
- **G0 失败** → 不要在 review 里"凑合绿"；让 PR 作者修；
- **遇到新增协议面**（不在 8 包冻结内） → 报 issue 给架构师，不在 PR 里扩张。
