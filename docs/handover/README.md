# 交接指南

本目录汇集"接手 ohos-tailscale 三种身份"的最小可执行手册与硬约束清单。每份文件都对一份**任务**——接到该任务的 owner/agent 不需要重读全仓就能动手。

## 文件清单

| 文件 | 接手什么 | 关键硬约束 |
|------|----------|-----------|
| [owner-with-real-device.md](owner-with-real-device.md) | **有真机 + DevEco** 的 owner agent（解冻子线 E） | 子线 E 解冻顺序；CU6 答案决定集成方式；首编译必报错；红线与 DELIVERY_REPORT §6.3 对齐 |
| [agent-interop-regression.md](agent-interop-regression.md) | **有 docker 远端** 的环境 agent（执行子线 D） | headscale 仅 127.0.0.1；preauthkey 用后即弃；私钥永不入仓；ssh 仅 `dev-env-with-gpu` 别名 |
| [reviewer-pr-style.md](reviewer-pr-style.md) | **接手 PR/复审** 的评审 agent | G0 五门实跑复现；不可信 commit message 自报数字；Mimosa 4 处已知误报识别 |

## 三方共同的硬约束（来自 TASK.md §"贯穿底线 G0" 与 docs/architecture.md）

- **D4** packages/ 非测试源文件禁止任何网络/磁盘/node:* 内置；时钟随机一律经 common 注入接口。
- **P4** packages/ 非测试源文件禁止 Date.now / Math.random（非注释行）。
- **G0 五门**收口：`npm test ≥495/0` · `typecheck exit 0` · `test:bridge ≥30/0` · `validate:shell ≥66/0` · D4/P4 0 命中。
- **协议面**任何变更：先实读 `docs/upstream/ts-main/` 与 `docs/upstream/2026-10-01-phase2/` 归档，再动笔——本项目一期就因凭记忆写协议犯过 5 处真实语义错误。
- **8 包接口**冻结：`packages/common/src/index.ts` 不可改；其它包改导出必须同步升小版本号 + `docs/architecture.md §10.3` 版本记录。
- **不碰生产 tailnet**——所有 headscale/控制面/100.64.0.0/10 操作只在隔离实例上做；ssh 仅走 `dev-env-with-gpu` 别名；不在远端执行任何改状态的 `tailscale` CLI。

## 入口

读这三份文档的顺序：

1. `README.md`（仓库根）—— 总览与硬约束位置
2. `TASK.md` —— 子线裁定与冻结状态
3. 本文件选定身份后看对应手册

完成后必读：

- `DELIVERY_REPORT.md §6` —— 2026-10-02 二期批次验收节（最新的实测数字 + 移交清单）
- `worklog.md` —— 历次 worklog（append-only 历史记录风格）
