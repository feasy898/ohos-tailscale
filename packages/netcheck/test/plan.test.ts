/**
 * 探测计划生成测试：向量逐项移植自上游 netcheck_test.go TestMakeProbePlan
 * （2026-10-02 实拉 @3ce5e209971d，netcheck_test.go:560-817）与 TestSortRegions
 * （:960-997），另覆盖地址/端口规则（netcheck.go:1658-1754、tailcfg/derpmap.go
 * :216-260）。全部数值为上游测试向量原值或按上游公式手算锚定。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexDecode, hexEncode } from '@ohos-tailscale/common';
import {
  NetcheckReport,
  PROTO,
  makeProbePlan,
  makeProbePlanInitial,
  nodeAddrPort,
  nodeIsTestNode,
  nodeMight4,
  nodeMight6,
  parseIpLiteral,
  regionHasDerpNode,
  sortRegions,
  type DnsResolver,
  type DnsLookupResult,
  type NetAddr,
  type NetcheckDerpMap,
  type NetcheckNode,
  type NetcheckRegion,
  type ProbeGroup,
} from '../src/index.ts';

/** 构造 basicMap 同构输入（netcheck_test.go:561-583）：region i 有 i 个节点
 * （ia、ib…），region 6 为 NoMeasureNoHome。 */
function basicMap(): NetcheckDerpMap {
  const regions: NetcheckRegion[] = [];
  for (let rid: number = 1; rid <= 6; rid += 1) {
    const nodes: NetcheckNode[] = [];
    for (let nid: number = 0; nid < rid; nid += 1) {
      nodes.push({
        name: String(rid) + String.fromCharCode('a'.charCodeAt(0) + nid),
        regionId: rid,
        hostName: 'derp' + String(rid) + '-' + String(nid),
        ipv4: String(rid) + '.0.0.' + String(nid),
        ipv6: String(rid) + '::' + String(nid),
        stunPort: 0,
        stunOnly: false,
        stunTestIp: '',
      });
    }
    regions.push({ regionId: rid, regionCode: 'r' + String(rid), nodes: nodes, noMeasureNoHome: rid === 6, avoid: false });
  }
  const m: NetcheckDerpMap = { regions: regions, regionScore: null };
  return m;
}

function latMap(pairs: number[]): Map<number, number> {
  const m: Map<number, number> = new Map<number, number>();
  for (let i: number = 0; i + 1 < pairs.length; i += 2) {
    m.set(pairs[i], pairs[i + 1]);
  }
  return m;
}

/** 上游向量里的 last *Report（RegionLatency + 可选 V4/V6 表 + PreferredDERP）。 */
function mkLast(rl: number[], v4: number[] | null, v6: number[] | null, preferred: number): NetcheckReport {
  const r: NetcheckReport = new NetcheckReport();
  r.regionLatency = latMap(rl);
  if (v4 !== null) {
    r.regionV4Latency = latMap(v4);
  }
  if (v6 !== null) {
    r.regionV6Latency = latMap(v6);
  }
  r.preferredDERP = preferred;
  return r;
}

/** 组内探测签名序列 "节点@延迟ms:协议"（协议 0=v4 1=v6）。 */
function sig(groups: ProbeGroup[], key: string): string[] {
  for (const g of groups) {
    if (g.key === key) {
      const out: string[] = [];
      for (const p of g.probes) {
        out.push(p.node + '@' + String(p.delayMs) + ':' + String(p.proto));
      }
      return out;
    }
  }
  return [];
}

function keys(groups: ProbeGroup[]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    out.push(g.key);
  }
  return out.sort();
}

const V4: number = PROTO.IPv4;
const V6: number = PROTO.IPv6;

/** 固定 DNS 查表（A2：带方法接口用类实现，不用对象字面量）。 */
class FakeDns implements DnsResolver {
  private res: DnsLookupResult;

  constructor(res: DnsLookupResult) {
    this.res = res;
  }

  public lookup(host: string): DnsLookupResult {
    return this.res;
  }
}

test('初始计划 initial_v6：全 region×3 try、delay 0/100/200ms、节点 a→b→a 轮换（上游 netcheck_test.go:612-628 向量）', () => {
  const dm: NetcheckDerpMap = basicMap();
  const plan: ProbeGroup[] = makeProbePlan(dm, true, true, null, 0);
  // region 6 NoMeasureNoHome 被跳过；region 1 有 1 节点 → 全 1a；region 2 → a,b,a
  assert.deepEqual(keys(plan), [
    'region-1-v4', 'region-1-v6', 'region-2-v4', 'region-2-v6', 'region-3-v4', 'region-3-v6',
    'region-4-v4', 'region-4-v6', 'region-5-v4', 'region-5-v6',
  ]);
  assert.deepEqual(sig(plan, 'region-1-v4'), ['1a@0:0', '1a@100:0', '1a@200:0']);
  assert.deepEqual(sig(plan, 'region-1-v6'), ['1a@0:1', '1a@100:1', '1a@200:1']);
  assert.deepEqual(sig(plan, 'region-2-v4'), ['2a@0:0', '2b@100:0', '2a@200:0']);
  assert.deepEqual(sig(plan, 'region-3-v4'), ['3a@0:0', '3b@100:0', '3c@200:0']);
});

test('初始计划 initial_no_v6：无 v6 接口时不产 v6 组（上游 :630-642）', () => {
  const plan: ProbeGroup[] = makeProbePlan(basicMap(), true, false, null, 0);
  assert.deepEqual(keys(plan), [
    'region-1-v4', 'region-2-v4', 'region-3-v4', 'region-4-v4', 'region-5-v4',
  ]);
  assert.deepEqual(sig(plan, 'region-2-v4'), ['2a@0:0', '2b@100:0', '2a@200:0']);
});

test('初始计划 only_v6_initial：无 v4 接口时只产 v6 组（上游 :724-736）', () => {
  const plan: ProbeGroup[] = makeProbePlan(basicMap(), false, true, null, 0);
  assert.deepEqual(keys(plan), [
    'region-1-v6', 'region-2-v6', 'region-3-v6', 'region-4-v6', 'region-5-v6',
  ]);
  assert.deepEqual(sig(plan, 'region-3-v6'), ['3a@0:1', '3b@100:1', '3c@200:1']);
});

test('初始计划收录条件：显式禁族节点即 test 节点也不打该族（"none" 优先，netcheck.go:572-577）', () => {
  const reg: NetcheckRegion = {
    regionId: 1,
    regionCode: 'r1',
    nodes: [
      { name: '1a', regionId: 1, hostName: 'h', ipv4: 'none', ipv6: '1::1', stunPort: 0, stunOnly: false, stunTestIp: '192.0.2.9' },
    ],
    noMeasureNoHome: false,
    avoid: false,
  };
  const m: NetcheckDerpMap = { regions: [reg], regionScore: null };
  // stunTestIp 非空 → IsTestNode true，但 ipv4=="none" 仍禁 v4
  const plan: ProbeGroup[] = makeProbePlanInitial(m, true, true);
  assert.deepEqual(keys(plan), ['region-1-v6']);
  assert.deepEqual(sig(plan, 'region-1-v6'), ['1a@0:1', '1a@100:1', '1a@200:1']);
});

test('增量 second_v4_no_6if：最快两名 2 try、第三名 1 try、ri>=3 且无 home 砍断（上游 :643-667）', () => {
  const last: NetcheckReport = mkLast([1, 10, 2, 20, 3, 30, 4, 40], [1, 10, 2, 20, 3, 30, 4, 40], null, 0);
  const plan: ProbeGroup[] = makeProbePlan(basicMap(), true, false, last, 0);
  assert.deepEqual(keys(plan), ['region-1-v4', 'region-2-v4', 'region-3-v4']);
  // 10ms×1.2=12、20ms×1.2=24：重传基距整数运算
  assert.deepEqual(sig(plan, 'region-1-v4'), ['1a@0:0', '1a@12:0']);
  assert.deepEqual(sig(plan, 'region-2-v4'), ['2a@0:0', '2b@24:0']);
  assert.deepEqual(sig(plan, 'region-3-v4'), ['3a@0:0']);
});

test('增量 second_v4_only_with_6if：无 v6 历史时 try>0 砍 v6、非重点 region 不打 v6（上游 :668-694）', () => {
  const last: NetcheckReport = mkLast([1, 10, 2, 20, 3, 30, 4, 40], [1, 10, 2, 20, 3, 30, 4, 40], null, 0);
  const plan: ProbeGroup[] = makeProbePlan(basicMap(), true, true, last, 0);
  assert.deepEqual(keys(plan), ['region-1-v4', 'region-1-v6', 'region-2-v4', 'region-2-v6', 'region-3-v4']);
  // 最快两名 v6 各打一发（try=0），重试发不打 v6（:531-532）
  assert.deepEqual(sig(plan, 'region-1-v6'), ['1a@0:1']);
  assert.deepEqual(sig(plan, 'region-2-v6'), ['2a@0:1']);
  assert.deepEqual(sig(plan, 'region-3-v4'), ['3a@0:0']);
});

test('增量 second_mixed：双栈机第 3 名（ri=2 偶）只打 v4（上游 :695-723）', () => {
  const last: NetcheckReport = mkLast(
    [1, 10, 2, 20, 3, 30, 4, 40],
    [1, 10, 2, 20],
    [3, 30, 4, 40],
    0,
  );
  const plan: ProbeGroup[] = makeProbePlan(basicMap(), true, true, last, 0);
  assert.deepEqual(keys(plan), ['region-1-v4', 'region-1-v6', 'region-2-v4', 'region-2-v6', 'region-3-v4']);
  assert.deepEqual(sig(plan, 'region-1-v6'), ['1a@0:1', '1a@12:1']);
  assert.deepEqual(sig(plan, 'region-3-v4'), ['3a@0:0']);
});

test('增量 try_harder_for_preferred_derp：home 4 try、重传 0/12/124/186 手算锚定（上游 :737-765）', () => {
  // 10×1.2=12；try2: 2×12+2×50=124；try3: 3×12+3×50=186；20×1.2=24
  const last: NetcheckReport = mkLast(
    [1, 10, 2, 20, 3, 30, 4, 40],
    [1, 10, 2, 20],
    [3, 30, 4, 40],
    1,
  );
  const plan: ProbeGroup[] = makeProbePlan(basicMap(), true, true, last, 1);
  assert.deepEqual(keys(plan), ['region-1-v4', 'region-1-v6', 'region-2-v4', 'region-2-v6', 'region-3-v4']);
  assert.deepEqual(sig(plan, 'region-1-v4'), ['1a@0:0', '1a@12:0', '1a@124:0', '1a@186:0']);
  assert.deepEqual(sig(plan, 'region-1-v6'), ['1a@0:1', '1a@12:1', '1a@124:1', '1a@186:1']);
  assert.deepEqual(sig(plan, 'region-2-v4'), ['2a@0:0', '2b@24:0']);
  assert.deepEqual(sig(plan, 'region-3-v4'), ['3a@0:0']);
});

test('增量 ensure_home_region_inclusion：home 排第 4 仍强制纳入打 4 try（#13969，上游 :766-799）', () => {
  // 排序 2(20),3(30),4(40),1(50=home),5(无数据)；50×1.2=60；2×60+100=220；3×60+150=330
  const last: NetcheckReport = mkLast(
    [1, 50, 2, 20, 3, 30, 4, 40],
    [1, 50, 2, 20],
    [3, 30, 4, 40],
    1,
  );
  const plan: ProbeGroup[] = makeProbePlan(basicMap(), true, true, last, 1);
  assert.deepEqual(keys(plan), ['region-1-v4', 'region-1-v6', 'region-2-v4', 'region-2-v6', 'region-3-v4', 'region-3-v6', 'region-4-v4']);
  assert.deepEqual(sig(plan, 'region-1-v4'), ['1a@0:0', '1a@60:0', '1a@220:0', '1a@330:0']);
  assert.deepEqual(sig(plan, 'region-2-v4'), ['2a@0:0', '2b@24:0']);
  assert.deepEqual(sig(plan, 'region-3-v4'), ['3a@0:0', '3b@36:0']);
  assert.deepEqual(sig(plan, 'region-4-v4'), ['4a@0:0']);
});

test('增量重传基距非整除：33ms×120/100=39（Go 整数除法→floor），追加 +try×50ms', () => {
  const dm: NetcheckDerpMap = basicMap();
  const last: NetcheckReport = mkLast([1, 33], [1, 33], null, 1);
  const plan: ProbeGroup[] = makeProbePlan(dm, true, false, last, 1);
  // 33×120/100=39.6→39；try2: 2×39+100=178；try3: 3×39+150=267
  assert.deepEqual(sig(plan, 'region-1-v4'), ['1a@0:0', '1a@39:0', '1a@178:0', '1a@267:0']);
});

test('增量无该 region 历史时重传基距取 200ms（cmp.Or 缺省，netcheck.go:535-537）', () => {
  // region 1 有数据（10ms），region 2 缺席 → prevLatency=200
  const dm: NetcheckDerpMap = basicMap();
  const last: NetcheckReport = mkLast([1, 10], [1, 10], null, 2);
  const plan: ProbeGroup[] = makeProbePlan(dm, true, false, last, 2);
  // 排序 1(10) 在前，home=2 无数据排最后；ri=0 region1（非 home、fastestTwo、2 try）
  assert.deepEqual(sig(plan, 'region-1-v4'), ['1a@0:0', '1a@12:0']);
  // ri=1 region2=home：4 try，0/200/2×200+100/3×200+150；region 2 有两节点 →
  // try 循环节点轮换 a,b,a,b（上游 :534 同规则适用于增量）
  assert.deepEqual(sig(plan, 'region-2-v4'), ['2a@0:0', '2b@200:0', '2a@500:0', '2b@750:0']);
});

test('sortRegions：按上次延迟升序、无数据排最后（上游 :960-997 向量 5,2,1,3,4）', () => {
  const regions: NetcheckRegion[] = [];
  for (let rid: number = 1; rid <= 5; rid += 1) {
    regions.push({
      regionId: rid,
      regionCode: 'r',
      nodes: [{ name: rid + 'a', regionId: rid, hostName: 'h', ipv4: '1.2.3.4', ipv6: 'none', stunPort: 0, stunOnly: false, stunTestIp: '' }],
      noMeasureNoHome: false,
      avoid: false,
    });
  }
  const last: NetcheckReport = mkLast([1, 5000, 2, 3000, 3, 6000, 4, 0, 5, 2000], null, null, 0);
  const sorted: NetcheckRegion[] = sortRegions(regions, last.regionLatency, 0);
  const ids: number[] = [];
  for (const r of sorted) {
    ids.push(r.regionId);
  }
  // rid 4 延迟 0 = 无数据（Go duration 零值语义，实现与其对齐）排最后
  assert.deepEqual(ids, [5, 2, 1, 3, 4]);
});

test('sortRegions：NoMeasureNoHome 整体跳过；Avoid 跳过但 home 例外（netcheck.go:414,:417-420）', () => {
  const mk = (rid: number, noMeasure: boolean, avoid: boolean): NetcheckRegion => ({
    regionId: rid,
    regionCode: 'r',
    nodes: [{ name: rid + 'a', regionId: rid, hostName: 'h', ipv4: '1.2.3.4', ipv6: 'none', stunPort: 0, stunOnly: false, stunTestIp: '' }],
    noMeasureNoHome: noMeasure,
    avoid: avoid,
  });
  const regions: NetcheckRegion[] = [mk(1, false, false), mk(2, true, false), mk(3, false, true), mk(4, false, true)];
  const last: NetcheckReport = new NetcheckReport();
  // home=3：avoid 的 region 3 保留、region 4 跳过
  let got: NetcheckRegion[] = sortRegions(regions, last.regionLatency, 3);
  let ids: number[] = [];
  for (const r of got) {
    ids.push(r.regionId);
  }
  assert.deepEqual(ids, [1, 3]);
  // home=0：avoid 全跳
  got = sortRegions(regions, last.regionLatency, 0);
  ids = [];
  for (const r of got) {
    ids.push(r.regionId);
  }
  assert.deepEqual(ids, [1]);
});

test('nodeAddrPort 端口规则：0→3478、负值→禁、>65535→非法（netcheck.go:1667-1672）', () => {
  const n: NetcheckNode = { name: '1a', regionId: 1, hostName: 'h', ipv4: '192.0.2.10', ipv6: 'none', stunPort: 0, stunOnly: false, stunTestIp: '' };
  const p0: NetAddr | null = nodeAddrPort(n, 0, PROTO.IPv4, null);
  assert.ok(p0 !== null);
  assert.equal(p0.port, 3478);
  assert.equal(nodeAddrPort(n, -1, PROTO.IPv4, null), null, 'STUNPort 负值 = 禁 STUN（derpmap.go:230-233）');
  assert.equal(nodeAddrPort(n, 65536, PROTO.IPv4, null), null);
  const p6: NetAddr | null = nodeAddrPort(n, 3479, PROTO.IPv4, null);
  assert.ok(p6 !== null);
  assert.equal(p6.port, 3479);
});

test('nodeAddrPort：STUNTestIP 覆盖并按族过滤；显式地址族不符拒绝（netcheck.go:1673-1703）', () => {
  const n: NetcheckNode = { name: '1a', regionId: 1, hostName: 'h', ipv4: '192.0.2.10', ipv6: 'none', stunPort: 0, stunOnly: false, stunTestIp: '198.51.100.7' };
  const a: NetAddr | null = nodeAddrPort(n, 3478, PROTO.IPv4, null);
  assert.ok(a !== null);
  assert.equal(hexEncode(a.ip), 'c6336407', 'STUNTestIP 198.51.100.7 覆盖实际下发地址');
  assert.equal(nodeAddrPort(n, 3478, PROTO.IPv6, null), null, 'STUNTestIP 是 v4，v6 探测取不到地址');
  const n6: NetcheckNode = { name: '1a', regionId: 1, hostName: 'h', ipv4: 'none', ipv6: '2001:db8::1', stunPort: 0, stunOnly: false, stunTestIp: '' };
  const b: NetAddr | null = nodeAddrPort(n6, 3478, PROTO.IPv6, null);
  assert.ok(b !== null);
  assert.equal(b.ip.length, 16);
  const bad: NetcheckNode = { name: '1a', regionId: 1, hostName: 'h', ipv4: 'not-an-ip', ipv6: 'none', stunPort: 0, stunOnly: false, stunTestIp: '' };
  assert.equal(nodeAddrPort(bad, 3478, PROTO.IPv4, null), null, '非 IP 字面量等价禁用该族');
});

test('nodeAddrPort：显式地址缺席时走注入 DNS 取该族首个地址（netcheck.go:1708-1753）', () => {
  const n: NetcheckNode = { name: '1a', regionId: 1, hostName: 'derp.example', ipv4: '', ipv6: '', stunPort: 0, stunOnly: false, stunTestIp: '' };
  const res: DnsLookupResult = {
    ipv4: [hexDecode('c0000201'), hexDecode('c0000202')],
    ipv6: [hexDecode('20010db8000000000000000000000001')],
  };
  const dns: FakeDns = new FakeDns(res);
  const a: NetAddr | null = nodeAddrPort(n, 3478, PROTO.IPv4, dns);
  assert.ok(a !== null);
  assert.equal(hexEncode(a.ip), 'c0000201', '取该族第一个地址');
  const b: NetAddr | null = nodeAddrPort(n, 3478, PROTO.IPv6, dns);
  assert.ok(b !== null);
  assert.equal(b.ip.length, 16);
  assert.equal(nodeAddrPort(n, 3478, PROTO.IPv4, null), null, '无 DNS 注入且无显式地址 → 无地址可发');
});

test('nodeMight4/6 与 IsTestNode：空串=true、"none"/异族字面量=false（netcheck.go:589-610、derpmap.go:258-260）', () => {
  const dual: NetcheckNode = { name: 'n', regionId: 1, hostName: 'h', ipv4: '192.0.2.1', ipv6: '2001:db8::1', stunPort: 0, stunOnly: false, stunTestIp: '' };
  assert.equal(nodeMight4(dual), true);
  assert.equal(nodeMight6(dual), true);
  assert.equal(nodeIsTestNode(dual), false);
  const none4: NetcheckNode = { name: 'n', regionId: 1, hostName: 'h', ipv4: 'none', ipv6: '', stunPort: 0, stunOnly: false, stunTestIp: '' };
  assert.equal(nodeMight4(none4), false, '"none" 经 ParseAddr 失败 → false');
  assert.equal(nodeMight6(none4), true, '空串走 DNS → true');
  const loopback: NetcheckNode = { name: 'n', regionId: 1, hostName: 'h', ipv4: '127.0.0.1', ipv6: '', stunPort: 0, stunOnly: false, stunTestIp: '' };
  assert.equal(nodeIsTestNode(loopback), true, 'IPv4=="127.0.0.1" 即测试节点');
  const v4str6: NetcheckNode = { name: 'n', regionId: 1, hostName: 'h', ipv6: '192.0.2.1', ipv4: '', stunPort: 0, stunOnly: false, stunTestIp: '' };
  assert.equal(nodeMight6(v4str6), false, '字段是 v4 字面量 → might6 false');
});

test('parseIpLiteral：dotted-quad、"::" 压缩、v4 尾部与非法输入（addr.ts 口径对齐 netip.ParseAddr）', () => {
  assert.equal(hexEncode(parseIpLiteral('1.2.3.4') as Uint8Array), '01020304');
  assert.equal(parseIpLiteral('none'), null);
  assert.equal(parseIpLiteral(''), null);
  assert.equal(parseIpLiteral('256.1.1.1'), null);
  const six: Uint8Array | null = parseIpLiteral('1::0');
  assert.ok(six !== null);
  assert.equal(six.length, 16);
  assert.equal(six[0], 0);
  assert.equal(six[1], 1);
  assert.equal(six[15], 0);
  const all: Uint8Array | null = parseIpLiteral('::');
  assert.ok(all !== null);
  let allZero: boolean = true;
  for (const b of all) {
    if (b !== 0) {
      allZero = false;
    }
  }
  assert.equal(allZero, true);
  const tail4: Uint8Array | null = parseIpLiteral('::ffff:192.0.2.1');
  assert.ok(tail4 !== null);
  assert.equal(hexEncode(tail4.slice(12)), 'c0000201');
  assert.equal(parseIpLiteral('1:2:3'), null, '组数不足且无压缩位');
  assert.equal(parseIpLiteral('fe80::1%eth0'), null, 'zone 不支持');
});

test('regionHasDerpNode：全部节点 STUNOnly → false（netcheck.go:1756-1763）', () => {
  const mk = (stunOnly: boolean): NetcheckNode => ({ name: 'n', regionId: 1, hostName: 'h', ipv4: '1.2.3.4', ipv6: 'none', stunPort: 0, stunOnly: stunOnly, stunTestIp: '' });
  const r1: NetcheckRegion = { regionId: 1, regionCode: 'r', nodes: [mk(true), mk(true)], noMeasureNoHome: false, avoid: false };
  const r2: NetcheckRegion = { regionId: 2, regionCode: 'r', nodes: [mk(true), mk(false)], noMeasureNoHome: false, avoid: false };
  assert.equal(regionHasDerpNode(r1), false);
  assert.equal(regionHasDerpNode(r2), true);
});
