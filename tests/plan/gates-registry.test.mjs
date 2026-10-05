// 用途：门注册表与 CI 完整性 meta 测试（TESTS-2026-10-03，TESTS.md §2.4/§5-U7）。
// 注册表三条互相独立断言（防「改注册表凑绿」）：
//   ① ∀ registry[ci=true & status=existing] → yml 字面含 ciCommand；
//   ② ∀ yml 中 npm run X（排除 npm ci）→ X ∈ registry（无论 ci 真假）——防 CI 加了 step 却没登记；
//   ③ ∀ registry[ci=false] → reason 非空——「不进 CI」必须是显式决定。
// 加两条：④ yml 无 continue-on-error/|| true（假绿逃逸面，现值 0——现在就该绿）；
//        ⑤ planned+ci:true 的 ciCommand 未入 yml = TDD 红锚（集成补丁「待应用 diff」的机检形态）。
// holdout 侧另有：ci:false 白名单对照（防「加个 ci:false + 随便写 reason」绕过①——最易被绕的一条，故不公开白名单全集）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRepo } from './lib/spawn.mjs';

const loadRegistry = () => JSON.parse(readRepo('scripts/gates.registry.json'));

test('T-REG-1 注册表结构合法（id/script/ci 必填；ci=false 必带非空 reason）——现在就该绿', () => {
  const reg = loadRegistry();
  assert.ok(Array.isArray(reg.gates) && reg.gates.length >= 10, `注册表应 ≥10 道门（现有+规划）。实测 ${reg.gates.length}`);
  for (const g of reg.gates) {
    assert.ok(g.id && g.script, '每道门必须有 id 与 script');
    assert.ok(typeof g.ci === 'boolean', `门 ${g.id} 的 ci 必须是布尔`);
    if (g.ci === false) {
      assert.ok(typeof g.reason === 'string' && g.reason.trim().length >= 5, `ci=false 的门 ${g.id} 必须带非空 reason（沉默默认=typecheck:bridge 病根）`);
    }
    assert.ok(['existing', 'planned'].includes(g.status), `门 ${g.id} status 必须是 existing|planned`);
  }
});

test('T-REG-2 现有门全在 CI：∀ existing+ci=true → yml 字面含 ciCommand——现在就该绿', () => {
  const yml = readRepo('.github/workflows/g0-gates.yml');
  for (const g of loadRegistry().gates.filter((x) => x.ci && x.status === 'existing')) {
    assert.ok(yml.includes(g.ciCommand), `门 ${g.id} 声明 ci=true(existing) 但 yml 未字面包含 ${JSON.stringify(g.ciCommand)}`);
  }
});

test('T-REG-3 CI 无漏登记：∀ yml 的 npm run X（排除 npm ci）→ X ∈ registry——TDD 红锚（规划门未入 yml 时本条仍绿；它抓的是「CI 有而注册表无」）', () => {
  const yml = readRepo('.github/workflows/g0-gates.yml');
  const reg = loadRegistry();
  const normalize = (s) => {
    const m = /npm run (?:--[a-z]+ )?([A-Za-z][A-Za-z:_-]*)/.exec(s);
    if (m) return m[1];
    if (/^npm test$/.test(s.trim())) return 'test';
    return s.trim(); // node xxx.mjs / 其他形态保持原文（yml 里应逐字出现）
  };
  const known = new Set(reg.gates.map((g) => normalize(g.script)));
  const used = new Set();
  for (const m of yml.matchAll(/npm run (?:--[a-z]+ )?([A-Za-z][A-Za-z:_-]*)/g)) used.add(m[1]);
  for (const m of yml.matchAll(/^([^#\n]*?)\bnpm (test)\b/gm)) used.add('test');
  const orphan = [...used].filter((u) => !known.has(u));
  assert.deepEqual(orphan, [], `yml 中出现但注册表未登记的 script：${orphan.join('、')}（每个 CI 门必须在注册表有声明的归属）`);
});

test('T-REG-4 yml 无假绿逃逸面（continue-on-error / || true / if: false）——TDD 红锚（现值：G0-5 内联块 3 处 `|| true`，P0-4 集成补丁替换该块后转绿）', () => {
  const yml = readRepo('.github/workflows/g0-gates.yml');
  assert.ok(!/continue-on-error/.test(yml), 'yml 不得出现 continue-on-error（M6 CI 空转的主通道）');
  assert.ok(!/\|\| true/.test(yml), 'yml 不得出现 || true（现值：G0-5 P4/D4 内联块 :72/:79/:85——P0-4 抽脚本替换后必须消失）');
  assert.ok(!/if:\s*false/.test(yml), 'yml 不得出现 if: false');
});

test('T-REG-5 规划门入册待入 CI：∀ planned+ci=true → yml 字面含 ciCommand——TDD 红锚（集成补丁应用后转绿）', () => {
  const yml = readRepo('.github/workflows/g0-gates.yml');
  const missing = loadRegistry().gates
    .filter((g) => g.ci && g.status === 'planned' && g.ciCommand)
    .filter((g) => !yml.includes(g.ciCommand))
    .map((g) => `${g.id}(${g.ciCommand})`);
  assert.deepEqual(missing, [], `以下规划门声明 ci=true 但尚未入 yml（P0-1/P0-3/P0-4/P0-5/P0-6/P1-1 集成补丁「待应用 diff」——见 TESTS.md §2.5）：\n  ${missing.join('\n  ')}`);
});

test('T-REG-6 yml 门数注释防漂移：不再残留「五门」（实际六 step，注释陈旧）——TDD 红锚', () => {
  const yml = readRepo('.github/workflows/g0-gates.yml');
  assert.ok(!/五门/.test(yml), 'yml 标题/注释不得再自称「五门」（实际六 step 且将增至更多——BASELINE §4.4 命名漂移随集成补丁一并修）');
});
