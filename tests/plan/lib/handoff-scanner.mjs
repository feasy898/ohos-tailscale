// 用途：交接文档防毒扫描器（TESTS-2026-10-03，TESTS.md §4.4）。
// 三段式：黑名单（毒串不得出现）+ 白名单（解药必须在场）+ 边界正则（防误杀/漏杀）。
// 边界陷阱（实测）：`@ohos.net.vpn` 是 `@ohos.net.vpnExtension` 的前缀——裸 grep 会把正确行也抓红；
// `hvigorw assembleHap` 是假命令，但 `hvigor assembleHap`（无 w）是 P0-6 认可的正确形态——必须精确串。
// 本模块是 P0-6 交付物 scripts/check-stage-docs.mjs 的防毒内核规格：P0-6 落地时以等价逻辑收编。
export const BLACKLIST = [
  { id: 'testnet3-dead-addr', re: /203\.0\.113\.10/, why: 'TEST-NET-3 死地址（HARMONY_AGENT_TASK.md:13/:68/:71 亲验）' },
  { id: 'git-proto-clone', re: /git:\/\//, why: 'git:// 协议克隆地址（scrub 后不得回潮）' },
  { id: 'scrubbed-token', re: /UPLOAD-TOKEN-REDACTED/, why: '已 scrub 的收件箱令牌不得再引用' },
  { id: 'fake-hvigorw', re: /hvigorw assembleHap/, why: '假命令（owner-with-real-device.md:60 亲验）；正确=DevEco Build>Build HAP(s) 或 hvigor assembleHap（无 w）' },
  { id: 'bare-vpn-module', re: /@ohos\.net\.vpn(?!Extension)/, why: '裸 @ohos.net.vpn 是错误写法（owner-with-real-device.md:47 亲验）；全名 @ohos.net.vpnExtension 不得被误杀' },
  { id: 'six-pkg-narrative', re: /六包/, why: '旧口径「六包」（8 包/495 为现行；HARMONY_AGENT_TASK.md:9/:82/:88 亲验）' },
  { id: 'legacy-238-tests', re: /238\s*\/\s*238|238\s*pass|期望\s*238/, why: '旧用例数口径（现行 495）' },
  { id: 'env-alias-premature', re: /dev-env-with-gpu/, why: 'O7 未答前不得把 owner 环境别名预写进交接文档' },
];

/** 扫描面：交接/活文档（历史档案面 docs/baseline-audit、docs/pre-device-plan、docs/research、worklog 豁免——证据不是说明书）。 */
export const SCAN_SURFACE = [
  'README.md',
  'CONTEXT.md',
  'TASK.md',
  'DELIVERY_REPORT.md',
  'HARMONY_AGENT_TASK.md',
  'docs/handover/README.md',
  'docs/handover/owner-with-real-device.md',
  'docs/handover/agent-interop-regression.md',
  'docs/handover/reviewer-pr-style.md',
  'docs/architecture.md',
  // P0-6 起的新交接面（现不存在，存在即扫）：
  'docs/pre-device/AGENT-TASK.md',
  'docs/pre-device/STAGE-CHECKLIST.md',
  'docs/pre-device/DECISIONS.md',
  'docs/pre-device/CU-CARDS.md',
  'docs/pre-device/OWNER-GUIDE.md',
  'docs/pre-device/EVIDENCE-SPEC.md',
];

/** 对一段文本跑黑名单。返回命中数组 [{file, line, id, text, why}]。 */
export function scanText(text, file) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const rule of BLACKLIST) {
      if (rule.re.test(lines[i])) {
        hits.push({ file, line: i + 1, id: rule.id, text: lines[i].trim().slice(0, 120), why: rule.why });
      }
    }
  }
  return hits;
}

/** 扫描器自检样本（内置字符串，防扫描器自身假绿/假红——门三件套之②的可机检形态）。 */
export const SELF_CHECK_SAMPLES = [
  { text: 'import vpn from @ohos.net.vpnExtension;', mustHit: false, note: '正确全名不得误杀（前缀陷阱反向例）' },
  { text: 'hvigor assembleHap --mode module', mustHit: false, note: '无 w 形态是 P0-6 认可的正确命令' },
  { text: '在 DevEco 中 Build > Build HAP(s)', mustHit: false, note: 'GUI 路径形态合法' },
  { text: 'hvigorw assembleHap --mode module -p product=default', mustHit: true, note: '假命令必须命中（精确串）' },
  { text: 'import vpn from "@ohos.net.vpn";', mustHit: true, note: '裸模块名必须命中（边界断言）' },
  { text: 'git clone git://203.0.113.10:9418/ohos-tailscale.git', mustHit: true, note: 'git 协议 + 死地址双命中' },
];

