# 描述

<!-- 一两句话：做什么；为什么。引用 docs/architecture.md §10.3 版本记录如有协议面改动。 -->

# 改动类型

- [ ] 协议面（packages/ 下任一包）→ 已对照 docs/upstream/ 实读
- [ ] 文档（docs/、README、CONTEXT、DELIVERY_REPORT、worklog）
- [ ] 工程（CI / scripts / interop）
- [ ] app/（壳工程）→ **注意：子线 E 冻结 WAITING_EVENT；编译/真机不在本仓 CI 范围**

# G0 五门自检（实跑退出码与数字）

| 门 | 命令 | 实测 |
|----|------|------|
| G0-1 | `npm test` | tests=… / fail=… |
| G0-2 | `npm run typecheck` | exit=… |
| G0-3 | `npm run test:bridge` | tests=… / fail=… |
| G0-4 | `npm run validate:shell` | passed=… / failed=… |
| G0-5 | D4/P4 grep | 命中=0 |

# 协议面同步（如有改动）

- [ ] 新增 AU 项 → docs/architecture.md §10.2
- [ ] 接口变更（packages/ 任一包的导出）→ docs/architecture.md §10.3 版本记录
- [ ] common 包冻结面变更 → 单独走架构师修订

# 文档同步（如有改动）

- [ ] README.md 的五门数字
- [ ] CONTEXT.md 的「6 包」→「8 包」+ 测试数字
- [ ] DELIVERY_REPORT.md 续写 §批次元节（append-only）
- [ ] worklog.md 追加（append-only）

# 不需要真机/SDK 的工作（如勾选，请说明）

<!-- 本仓 CI 不依赖 DevEco/SDK；任何提交如声称「在真机上验证过」需另附证据目录 evidence/<日期>/。 -->

# 已知风险

<!-- 例如 mock-peerapi.ts:175 跨包污点边界已校验；Mimosa 仍 pattern-match 误识为 SQL 注入——这是已知误报，修复已 commit e136900。 -->

# 关联 issue

<!-- 如有 -->
