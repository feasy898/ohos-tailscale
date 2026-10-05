/**
 * B3：DERP region 内选节点策略测试（上游对齐锚定）。
 *
 * 语义出处（docs/research/2026-10-02-B3-derp-pick.md，全部实读上游验证）：
 * - 节点级无随机：dialRegion 按数组序回退、跳 STUNOnly、firstErr（derphttp_client.go:637-657）；
 * - 随机只在 region 级兜底 pickDERPFallback（ms-derp.go:114-152）：已有 home 复用优先、
 *   随机定义域 = 排序后的全体 region id（derpmap.go:39-46 RegionIDs）、随机源可注入；
 * - rands.IntN = Lemire 乘法归约 + 拒绝采样（cheap.go:28-34）——本文件用固定 ArrayRng
 *   钉死采样输出，证明「随机经注入、可复现」（P4/G0-5）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayRng } from '@ohos-tailscale/common';
import { type DerpConnection, type DerpDialer } from '../src/connection.ts';
import { DerpError } from '../src/frame.ts';
import { type DerpNode, type DerpRegion, DerpRegionPicker, derpUsableNodes, rngIntN } from '../src/region.ts';
import { derpDialRegion } from '../src/regiondial.ts';

function mkNode(name: string, stunOnly: boolean = false): DerpNode {
  const n: DerpNode = {
    name: name,
    hostName: name + '.example.com',
    certName: '',
    ipv4: '198.51.100.30',
    ipv6: '',
    stunPort: 0,
    derpPort: 0,
    stunOnly: stunOnly,
    canPort80: true,
  };
  return n;
}

function mkRegion(id: number, code: string, nodes: DerpNode[]): DerpRegion {
  const r: DerpRegion = {
    regionId: id,
    regionCode: code,
    regionName: 'Region ' + code,
    nodes: nodes,
    latencyMs: -1,
  };
  return r;
}

/**
 * 8 字节大端池：rngIntN 按大端读 u64，x=firstByte·2^56（见各用例的区间换算）。
 * 注意不用全零字节流：x=0 时 Lemire 拒绝采样恒重抽（lo=0 < thresh），上游
 * rands.uint64n 面对全零熵源同样无限重抽（病理输入，真实概率 n/2^64）——
 * 测试用 x=2^60 表达「idx0」，既过界又不进拒绝窗。
 */
function u64Pool(firstByte: number): Uint8Array {
  return Uint8Array.from([firstByte, 0, 0, 0, 0, 0, 0, 0]);
}

class FakeConn implements DerpConnection {
  public async write(data: Uint8Array): Promise<void> {
    // 测试桩：不真正发送
  }

  public async read(): Promise<Uint8Array | null> {
    return null;
  }

  public close(): void {
    // 测试桩：无需清理
  }
}

/** 按节点名脚本化拨号：outcomes 命中 → 抛该错误；未命中 → 成功。记录调用顺序。 */
class ScriptedDialer implements DerpDialer {
  public called: string[] = [];
  private outcomes: Map<string, Error>;

  constructor(outcomes: Map<string, Error>) {
    this.outcomes = outcomes;
  }

  public async dial(node: DerpNode): Promise<DerpConnection> {
    this.called.push(node.name);
    const err: Error | undefined = this.outcomes.get(node.name);
    if (err !== undefined) {
      throw err;
    }
    return new FakeConn();
  }
}

// ---------------------------------------------------------------------------
// pickNode / derpUsableNodes：节点级按序回退（无随机）
// ---------------------------------------------------------------------------

test('pickNode：stunOnly 节点按序跳过，返回首个非 stunOnly 节点（对齐 dialRegion derphttp_client.go:640-650）', (): void => {
  const region: DerpRegion = mkRegion(1, 'a', [
    mkNode('a0', true), // STUNOnly：不能承载 DERP，必须跳过（derpmap.go:235-237）
    mkNode('a1', false),
    mkNode('a2', true),
    mkNode('a3', false),
  ]);
  const picker: DerpRegionPicker = new DerpRegionPicker([region]);
  const n: DerpNode = picker.pickNode(region);
  assert.equal(n.name, 'a1', 'Nodes 是控制面排好的优先序（derpmap.go:171-183），dialRegion 首个可连即用——这里是首个非 stunOnly 者');
});

test('pickNode：全部 stunOnly → RANGE，文本对齐上游 firstErr "no non-STUNOnly nodes"（derphttp_client.go:641-644）', (): void => {
  const region: DerpRegion = mkRegion(7, 's', [mkNode('s0', true), mkNode('s1', true)]);
  const picker: DerpRegionPicker = new DerpRegionPicker([region]);
  assert.throws(
    (): void => { picker.pickNode(region); },
    (e: Error): boolean =>
      e instanceof DerpError && e.code === 'RANGE' && e.message.indexOf('no non-STUNOnly nodes') >= 0,
    '上游 dialRegion 对全 STUNOnly region 的 firstErr 即此文本（derphttp_client.go:642）',
  );
});

test('usableNodes：保持数组序过滤 stunOnly；返回独立数组（修改返回值不影响后续调用）', (): void => {
  const region: DerpRegion = mkRegion(1, 'a', [mkNode('a0', true), mkNode('a1', false), mkNode('a2', false)]);
  const picker: DerpRegionPicker = new DerpRegionPicker([region]);
  const first: DerpNode[] = picker.usableNodes(region);
  assert.deepEqual(first.map((n: DerpNode): string => n.name), ['a1', 'a2'], '遍历域剔除 stunOnly 且保序（derpUsableNodes 对齐 :640-647 的 continue 语义）');
  first.push(mkNode('injected'));
  const second: DerpNode[] = picker.usableNodes(region);
  assert.equal(second.length, 2, 'usableNodes 每次返回独立数组，与 derpDialRegion 的调用方隔离');
  // 模块级函数与 picker 方法同源
  assert.equal(derpUsableNodes(region).length, 2);
});

// ---------------------------------------------------------------------------
// pickHomeRegionFallback：region 级随机兜底（pickDERPFallback 对齐）
// ---------------------------------------------------------------------------

test('pickHomeRegionFallback：已有 home 原样复用且不进随机分支（ms-derp.go:139-140 `if c.myDerp != 0`）', (): void => {
  const r1: DerpRegion = mkRegion(1, 'a', [mkNode('a0')]);
  const r2: DerpRegion = mkRegion(2, 'b', [mkNode('b0')]);
  // 注入「若走随机会选中 idx1（region 2）」的字节流：x=2^63 → floor(2^63*2/2^64)=1
  const picker: DerpRegionPicker = new DerpRegionPicker([r1, r2], new ArrayRng(u64Pool(0x80)));
  const got: DerpRegion | null = picker.pickHomeRegionFallback(1);
  assert.notEqual(got, null);
  if (got !== null) {
    assert.equal(got.regionId, 1, '上游先查 myDerp 再谈随机：已有 home 永远复用（哪怕该 region 无延迟数据）');
  }
});

test('pickHomeRegionFallback：随机定义域 = 按 regionId 升序的全体 region，不按声明序、不按有无节点过滤（derpmap.go:39-46 + ms-derp.go:121）', (): void => {
  // 声明序故意乱序 + 混入空节点 region（上游 RegionIDs() 排序且不过滤 Nodes，实测 @main 与 v1.36.0 一致）
  const r30: DerpRegion = mkRegion(30, 'empty', []);
  const r10: DerpRegion = mkRegion(10, 'a', [mkNode('a0')]);
  const r20: DerpRegion = mkRegion(20, 'b', [mkNode('b0')]);
  // n=3：idx0 需 x < 2^64/3≈0x5555…（取 2^60，避开 x=0 的拒绝窗）；idx1 需 x ≥ 2^64/3（取 2^63）；idx2 需 x ≥ 2·2^64/3≈0xAAAA…（取 0xF0·2^56）
  const p0: DerpRegionPicker = new DerpRegionPicker([r30, r10, r20], new ArrayRng(u64Pool(0x10)));
  const p1: DerpRegionPicker = new DerpRegionPicker([r30, r10, r20], new ArrayRng(u64Pool(0x80)));
  const p2: DerpRegionPicker = new DerpRegionPicker([r30, r10, r20], new ArrayRng(u64Pool(0xf0)));
  const g0: DerpRegion | null = p0.pickHomeRegionFallback(0);
  assert.notEqual(g0, null);
  if (g0 !== null) {
    assert.equal(g0.regionId, 10, 'idx0 是 regionId 最小者——证明随机前先按 regionId 排序（RegionIDs），而非声明序（声明序首为 30）');
  }
  const g1: DerpRegion | null = p1.pickHomeRegionFallback(0);
  assert.notEqual(g1, null);
  if (g1 !== null) {
    assert.equal(g1.regionId, 20);
  }
  const g2: DerpRegion | null = p2.pickHomeRegionFallback(0);
  assert.notEqual(g2, null);
  if (g2 !== null) {
    assert.equal(g2.regionId, 30, '空节点 region 也在随机域内（上游不过滤）：随中后由 derpDialRegion 报 no nodes for');
    assert.equal(g2.nodes.length, 0);
  }
});

test('pickHomeRegionFallback：同 seed 可复现、不同 seed 不同结果（随机一律经注入 Rng，P4/G0-5）', (): void => {
  const r1: DerpRegion = mkRegion(1, 'a', [mkNode('a0')]);
  const r2: DerpRegion = mkRegion(2, 'b', [mkNode('b0')]);
  const a: DerpRegion | null = new DerpRegionPicker([r1, r2], new ArrayRng(u64Pool(0x10))).pickHomeRegionFallback(0);
  const b: DerpRegion | null = new DerpRegionPicker([r1, r2], new ArrayRng(u64Pool(0x10))).pickHomeRegionFallback(0);
  const c: DerpRegion | null = new DerpRegionPicker([r1, r2], new ArrayRng(u64Pool(0x80))).pickHomeRegionFallback(0);
  assert.notEqual(a, null);
  assert.notEqual(b, null);
  assert.notEqual(c, null);
  if (a !== null && b !== null && c !== null) {
    assert.equal(a.regionId, b.regionId, '同字节流两次构造 → 同结果（上游 rands.IntN 同 seed 确定性，cheap.go:28-34）');
    assert.equal(c.regionId, 2, '不同字节流 → 按采样算法落到 idx1');
  }
});

test('pickHomeRegionFallback：未知 homeId 视为无 home 进入随机；无 region → null；未注入 Rng 抛 Error（P4）', (): void => {
  const r10: DerpRegion = mkRegion(10, 'a', [mkNode('a0')]);
  const r20: DerpRegion = mkRegion(20, 'b', [mkNode('b0')]);
  const r30: DerpRegion = mkRegion(30, 'c', [mkNode('c0')]);
  // 未知 homeId=99 → 防御性按无 home 处理（上游 myDerp 恒合法，本 API 由调用方传 id）
  const g: DerpRegion | null = new DerpRegionPicker([r10, r20, r30], new ArrayRng(u64Pool(0x80))).pickHomeRegionFallback(99);
  assert.notEqual(g, null);
  if (g !== null) {
    assert.equal(g.regionId, 20, 'n=3、x=2^63 → idx1（regionId 升序的第 2 个）');
  }
  assert.equal(new DerpRegionPicker([], new ArrayRng(u64Pool(0))).pickHomeRegionFallback(0), null, '上游 len(ids)==0 → 0（ms-derp.go:121-124）');
  assert.throws(
    (): void => { new DerpRegionPicker([r10]).pickHomeRegionFallback(0); },
    (e: Error): boolean => e instanceof Error && e.message.indexOf('Rng') >= 0,
    '随机分支必须有注入 Rng——确定性复用路径（已有 home）不在此列，构造时不强制注入',
  );
});

// ---------------------------------------------------------------------------
// rngIntN：Lemire 乘法归约 + 拒绝采样（rands.IntN 采样算法的可移植移植）
// ---------------------------------------------------------------------------

test('rngIntN：n=1 恒为 0；n 非正整数 → RANGE', (): void => {
  const rng: ArrayRng = new ArrayRng(u64Pool(0xff));
  assert.equal(rngIntN(rng, 1), 0, '上游 IntN(seed, 1) 恒 0');
  assert.throws((): void => { rngIntN(rng, 0); }, (e: Error): boolean => e instanceof DerpError && e.code === 'RANGE');
  assert.throws((): void => { rngIntN(rng, -3); }, (e: Error): boolean => e instanceof DerpError && e.code === 'RANGE');
  assert.throws((): void => { rngIntN(rng, 1.5); }, (e: Error): boolean => e instanceof DerpError && e.code === 'RANGE');
});

test('rngIntN：输出落 [0,n) 且钉死 Lemire 区间边界（cheap.go uint64n：hi=floor(x*n/2^64)，lo<thresh 重抽）', (): void => {
  // x=0x10·2^56 < 2^64/3 → 0；x=2^63 ∈ [2^64/3, 2·2^64/3) → 1；x=0xF0·2^56 ≥ 2·2^64/3 → 2
  const rng: ArrayRng = new ArrayRng(Uint8Array.from([
    0x10, 0, 0, 0, 0, 0, 0, 0,
    0x80, 0, 0, 0, 0, 0, 0, 0,
    0xf0, 0, 0, 0, 0, 0, 0, 0,
  ]));
  assert.deepEqual([rngIntN(rng, 3), rngIntN(rng, 3), rngIntN(rng, 3)], [0, 1, 2], '拒绝采样与朴素 x%n 不同：这是乘法归约的确定性输出，钉死即证明大端读数 + Lemire 归约两端都对');
});

test('rngIntN：拒绝路径真实存在且收敛（n=6、x=2^63 时 lo=0<thresh=4 重抽一次后接受，cheap.go `goto again` 形态）', (): void => {
  // 第一抽 x=2^63：m=6·2^63=3·2^64 → hi=3, lo=0 < thresh=(2^64-6)%6=4 → 重抽；
  // 第二抽 x=2^60：m=0.375·2^64 → lo 巨大 ≥ 4 → 接受，hi=0。共耗 16 字节。
  const rng: ArrayRng = new ArrayRng(Uint8Array.from([
    0x80, 0, 0, 0, 0, 0, 0, 0,
    0x10, 0, 0, 0, 0, 0, 0, 0,
  ]));
  assert.equal(rngIntN(rng, 6), 0, '重抽只发生在 lo<thresh 的窄窗（真实概率 n/2^64 量级），拒绝后继续采下一抽并收敛');
});

// ---------------------------------------------------------------------------
// derpDialRegion：region 内按序拨号回退（dialRegion 编排）
// ---------------------------------------------------------------------------

test('derpDialRegion：按数组序尝试、首个可连即用、后续节点不再拨（derphttp_client.go:637-657）', async (): Promise<void> => {
  const region: DerpRegion = mkRegion(1, 'a', [mkNode('a0'), mkNode('a1'), mkNode('a2')]);
  const dialer: ScriptedDialer = new ScriptedDialer(new Map<string, Error>([['a0', new Error('dial a0: refused')]]));
  const result = await derpDialRegion(dialer, region);
  assert.deepEqual(dialer.called, ['a0', 'a1'], '严格数组序：a0 失败原地继续 a1；a2 不应被拨（首个可连即用）');
  assert.equal(result.node.name, 'a1');
  assert.equal(result.isIdealNode, false, '连到 Nodes[1]：非理想节点（上游据此发 Ideal-Node 头，纯统计）');
});

test('derpDialRegion：全败抛第一个节点的错误对象（firstErr 只记第一个，derphttp_client.go:651-656）', async (): Promise<void> => {
  const region: DerpRegion = mkRegion(1, 'a', [mkNode('a0'), mkNode('a1'), mkNode('a2')]);
  const e0: Error = new Error('dial a0: no route');
  const e1: Error = new Error('dial a1: tls timeout');
  const e2: Error = new Error('dial a2: refused');
  const dialer: ScriptedDialer = new ScriptedDialer(
    new Map<string, Error>([['a0', e0], ['a1', e1], ['a2', e2]]),
  );
  let caught: Error | null = null;
  try {
    await derpDialRegion(dialer, region);
  } catch (e) {
    caught = e as Error;
  }
  assert.notEqual(caught, null, '全败必须抛错');
  assert.equal(caught, e0, '抛的是第一个错误对象本身（对象同一性），不是最后一个——上游 firstErr 仅在为 nil 时覆写');
  assert.deepEqual(dialer.called, ['a0', 'a1', 'a2'], '全败时每个可用节点都被试过');
});

test('derpDialRegion：stunOnly 节点不进入拨号；连上 Nodes[0] 时 isIdealNode=true（Ideal-Node 头判定源，纯统计 #12724）', async (): Promise<void> => {
  const region: DerpRegion = mkRegion(1, 'a', [mkNode('a0'), mkNode('a1', true), mkNode('a2')]);
  const dialer: ScriptedDialer = new ScriptedDialer(new Map<string, Error>());
  const result = await derpDialRegion(dialer, region);
  assert.deepEqual(dialer.called, ['a0'], 'a1 是 STUNOnly 不承载 DERP；a0 成功后 a2 也不拨');
  assert.equal(result.node.name, 'a0');
  assert.equal(result.isIdealNode, true, 'isIdealNode = (node === Nodes[0])，上游 idealNodeInRegion（derphttp_client.go:436-440）');
});

test('derpDialRegion：空 region / 全 stunOnly → RANGE（文本对齐上游 firstErr，:637/:642）', async (): Promise<void> => {
  const dialer: ScriptedDialer = new ScriptedDialer(new Map<string, Error>());
  const empty: DerpRegion = mkRegion(2, 'b', []);
  await assert.rejects(
    derpDialRegion(dialer, empty),
    (e: Error): boolean => e instanceof DerpError && e.code === 'RANGE' && e.message.indexOf('no nodes for') >= 0,
    '上游 `no nodes for %s`（derphttp_client.go:637-639）',
  );
  const allStun: DerpRegion = mkRegion(3, 'c', [mkNode('c0', true)]);
  await assert.rejects(
    derpDialRegion(dialer, allStun),
    (e: Error): boolean => e instanceof DerpError && e.code === 'RANGE' && e.message.indexOf('no non-STUNOnly nodes') >= 0,
    '全 stunOnly 时 dialer 一次都不该被调（上游 continue 不拨号）',
  );
  assert.equal(dialer.called.length, 0, '两种前置 RANGE 都发生在任何 dial 之前');
});
