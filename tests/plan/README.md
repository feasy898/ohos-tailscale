# tests/plan/ —— 真机前规划的可见验收测试集（TESTS-2026-10-03）

来源与完整说明：**docs/pre-device-plan/TESTS.md**（测试总矩阵、裁决附录、集成补丁待应用 diff 均在那里）。

## 怎么跑

```bash
node scripts/test-plan.mjs
```

不改 package.json（本套件落地时禁改既有文件）。输出四态：GREEN_OK / ANCHOR_RED_OK（红锚确认，
实现前的正确状态）/ UNEXPECTED_RED（意外红，失败）/ STALE_ANCHOR（红锚转绿，须核实后翻转
expected.json）。exit 0 = 全部工作项验收面收口。

## 文件一览

| 文件 | 测什么 |
|---|---|
| a-criteria.test.mjs | A1/A2/A4/A5/G0-6 现行基线地板（现在就该绿） |
| p0-1-peerapi.test.mjs | TS2353 修复：正控制组语义 + 行为零漂移 + 计数副断言 + CI step |
| p0-2-generator.test.mjs | stun.ts Generator 清零 grep 红锚 + netcheck 84 例语义钉 |
| p0-3-arkts-gate.test.mjs | validate:arkts 门三件套（script/文件/yml/exit 0） |
| p0-4-gate-d4-meta.test.mjs | gate:d4 抽脚本 + yml 无裸 grep + bash -n + 等价 grep 基线 |
| p0-5-regress-selftest.test.mjs | selftest 门 / 假 key 清除 / h2c CLI / --out 落盘 / ENV_UNREACHABLE |
| p0-6-stagedocs.test.mjs | 交接包七件套 + check-stage-docs + 三处 handover 修复 + S5b 留痕步骤 |
| p0-7-gitignore.test.mjs | A14 双向判据 + secrets/工具目录不被击穿 |
| p0-8-arktscheck.test.mjs | arkts-check.js 不崩 + SKIP 点名变量 + 假路径可读错 |
| a13-a16-docs.test.mjs | A13 oracle/raw 清零 + A16 旧数字语境断言 + caliber 无值结构 |
| handoff-antipoison.test.mjs | 交接文档防毒扫描（黑/白名单+边界正则，含扫描器自检） |
| decision-trees.test.mjs | 判定树完备性五断言（含五个内置坏树负对照） |
| env-ready.test.mjs | env-ready 校验器机制演练（值+证据+时间戳三元组） |
| p1-redanchors.test.mjs | P1 各项落地物存在性/形态红锚（kat/vpn-config/platform-ports/…） |
| gates-registry.test.mjs | 门注册表三条独立断言 + yml 假绿逃逸面 + 门数注释防漂移 |
| holdout-sentinel.test.mjs | holdout 物理隔离哨兵（仓内无判定内容） |

lib/：spawn.mjs（直连执行器）、handoff-scanner.mjs、tree-check.mjs、env-ready-validator.mjs
（后三者是 P0-6/P1-12 交付物的规格内核，落地时收编为 scripts/ 下正式门）。

expected.json：用例名 → 预期状态清单（green / red-anchor）。改测试必须同步改它，
runner 对未登记用例与失踪用例都报错（防悄悄删锚点）。
