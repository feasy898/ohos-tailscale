/**
 * 报告历史与 PreferredDERP 迟滞测试：用例表逐项移植上游
 * TestAddReportHistoryAndSetPreferredDERP（netcheck_test.go:184-503，2026-10-02
 * 实拉 @3ce5e209971d）+ TestRecentReportsRetainFullNetcheck（:505-558）+
 * 历史窗 305s 严格大于边界（netcheck.go:1414-1421）。
 *
 * 数值锚定说明：上游 step 里报告延迟多为秒级 time.Duration；本仓延迟统一毫秒，
 * 向量换算 ×1000（如 d1=2s → 2000ms；4ms/1ms 等毫秒向量保持原值）。
 * rs.start 对齐上游测试 = 每步 now-100ms；活动窗 8s/120s 全为挂钟轴（绝对时刻）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixedClock, type Rng } from '@ohos-tailscale/common';
import {
  NetcheckEngine,
  NetcheckReport,
  REPORT_HISTORY_MAX_AGE_MS,
  type DerpActivitySource,
  type EngineConfig,
  type NetcheckDerpMap,
} from '../src/index.ts';

const BASE: number = 1700000000000;

function mkReport(pairs: number[]): NetcheckReport {
  const r: NetcheckReport = new NetcheckReport();
  for (let i: number = 0; i + 1 < pairs.length; i += 2) {
    r.regionLatency.set(pairs[i], pairs[i + 1]);
  }
  return r;
}

class ZeroRng implements Rng {
  public randomBytes(into: Uint8Array): void {
    for (let i: number = 0; i < into.length; i += 1) {
      into[i] = 0;
    }
  }
}

/** 活动表注入（绝对挂钟 ms；0 = 从未）。 */
class MapActivity implements DerpActivitySource {
  private m: Map<number, number>;

  constructor(m: Map<number, number>) {
    this.m = m;
  }

  public getLastDerpActivity(regionId: number): number {
    const v: number | undefined = this.m.get(regionId);
    return v === undefined ? 0 : v;
  }
}

function mkHistEngine(clock: FixedClock, forceDERP: number, regionScore: Map<number, number> | null): NetcheckEngine {
  const map: NetcheckDerpMap = { regions: [], regionScore: regionScore };
  const cfg: EngineConfig = {
    clock: clock,
    rng: new ZeroRng(),
    derpMap: map,
    sender: null,
    osHasIpv6: false,
    haveV4: true,
    haveV6: false,
    skipExternalNetwork: true,
    portMapper: null,
    dns: null,
    forcePreferredDERP: forceDERP,
    enoughRegionsOverride: 0,
  };
  return new NetcheckEngine(cfg);
}

/** 一条迟滞用例的步进驱动（对齐上游测试循环：rs.start = now-100ms）。 */
interface HistStep {
  afterMs: number;
  report: number[];
}

interface HistCase {
  name: string;
  steps: HistStep[];
  homeParamsScore: Map<number, number> | null;
  activity: Map<number, number> | null; // regionId → 绝对挂钟 ms
  forcedDERP: number;
  wantDERP: number;
  wantPrevLen: number;
}

function scoreOf(rid: number, v: number): Map<number, number> {
  const m: Map<number, number> = new Map<number, number>();
  m.set(rid, v);
  return m;
}

function activityOf(pairs: number[]): Map<number, number> {
  const m: Map<number, number> = new Map<number, number>();
  for (let i: number = 0; i + 1 < pairs.length; i += 2) {
    m.set(pairs[i], BASE + pairs[i + 1]);
  }
  return m;
}

function runHistCase(c: HistCase): void {
  const clock: FixedClock = new FixedClock(BASE);
  const engine: NetcheckEngine = mkHistEngine(clock, c.forcedDERP, c.homeParamsScore);
  const act: DerpActivitySource | null = c.activity === null ? null : new MapActivity(c.activity);
  let nowMs: number = 0;
  let finalReport: NetcheckReport = mkReport([]);
  for (const s of c.steps) {
    nowMs += s.afterMs;
    clock.setWallMs(BASE + nowMs);
    finalReport = mkReport(s.report);
    // 上游 rs.start = fakeTime.Add(-100ms)（绝对时刻）；activity 亦为绝对挂钟
    engine.addReportHistoryForTest(finalReport, BASE + nowMs - 100, act);
  }
  assert.equal(engine.historySize(), c.wantPrevLen, c.name + '：历史窗份数');
  assert.equal(finalReport.preferredDERP, c.wantDERP, c.name + '：PreferredDERP');
}

/** 上游用例表原样移植（netcheck_test.go:228-475；秒级向量换算 ms）。 */
const CASES: HistCase[] = [
  {
    name: 'first_reading',
    steps: [{ afterMs: 0, report: [1, 2000, 2, 3000] }],
    homeParamsScore: null,
    activity: null,
    forcedDERP: 0,
    wantDERP: 1,
    wantPrevLen: 1,
  },
  {
    name: 'with_two',
    steps: [
      { afterMs: 0, report: [1, 2000, 2, 3000] },
      { afterMs: 1000, report: [1, 4000, 2, 3000] },
    ],
    homeParamsScore: null,
    activity: null,
    forcedDERP: 0,
    wantDERP: 1, // t0 的 d1=2s 仍是历史最优
    wantPrevLen: 2,
  },
  {
    name: 'but_now_d1_gone',
    steps: [
      { afterMs: 0, report: [1, 2000, 2, 3000] },
      { afterMs: 1000, report: [1, 4000, 2, 3000] },
      { afterMs: 2000, report: [2, 3000] },
    ],
    homeParamsScore: null,
    activity: null,
    forcedDERP: 0,
    wantDERP: 2, // 唯一选项
    wantPrevLen: 3,
  },
  {
    name: 'd1_is_back',
    steps: [
      { afterMs: 0, report: [1, 2000, 2, 3000] },
      { afterMs: 1000, report: [1, 4000, 2, 3000] },
      { afterMs: 2000, report: [2, 3000] },
      { afterMs: 3000, report: [1, 4000, 2, 3000] },
    ],
    homeParamsScore: null,
    activity: null,
    forcedDERP: 0,
    wantDERP: 1, // t0 的 d1=2s 仍在窗内
    wantPrevLen: 4,
  },
  {
    name: 'things_clean_up',
    steps: [
      { afterMs: 0, report: [1, 1000, 2, 2000] },
      { afterMs: 1000, report: [1, 1000, 2, 2000] },
      { afterMs: 1000, report: [1, 1000, 2, 2000] },
      { afterMs: 1000, report: [1, 1000, 2, 2000] },
      { afterMs: 600000, report: [3, 3000] },
    ],
    homeParamsScore: null,
    activity: null,
    forcedDERP: 0,
    wantDERP: 3,
    wantPrevLen: 1, // t=[0..3]s 全部超 305s 窗被清
  },
  {
    name: 'preferred_derp_hysteresis_no_switch',
    steps: [
      { afterMs: 0, report: [1, 4000, 2, 5000] },
      { afterMs: 1000, report: [1, 4000, 2, 3000] },
    ],
    homeParamsScore: null,
    activity: null,
    forcedDERP: 0,
    wantDERP: 1, // 2 没有快过历史最优
    wantPrevLen: 2,
  },
  {
    name: 'preferred_derp_hysteresis_no_switch_absolute',
    steps: [
      { afterMs: 0, report: [1, 4, 2, 5] },
      { afterMs: 1000, report: [1, 4, 2, 1] },
    ],
    homeParamsScore: null,
    activity: null,
    forcedDERP: 0,
    wantDERP: 1, // 快了 80%，但绝对差 3ms < 10ms → 保旧
    wantPrevLen: 2,
  },
  {
    name: 'preferred_derp_hysteresis_do_switch',
    steps: [
      { afterMs: 0, report: [1, 4000, 2, 5000] },
      { afterMs: 1000, report: [1, 4000, 2, 1000] },
    ],
    homeParamsScore: null,
    activity: null,
    forcedDERP: 0,
    wantDERP: 2, // 差 3s ≥10ms 且 1s < 4s×2/3 → 换
    wantPrevLen: 2,
  },
  {
    name: 'derp_home_params',
    homeParamsScore: scoreOf(1, 2.0 / 3),
    steps: [{ afterMs: 1000, report: [1, 10000, 2, 8000] }],
    activity: null,
    forcedDERP: 0,
    wantDERP: 1, // 10000×2/3≈6667 压过 8000
    wantPrevLen: 1,
  },
  {
    name: 'derp_home_params_high_latency',
    homeParamsScore: scoreOf(1, 2.0 / 3),
    steps: [{ afterMs: 1000, report: [1, 100000, 2, 10000] }],
    activity: null,
    forcedDERP: 0,
    wantDERP: 2, // 缩放后仍差一个量级 → 换
    wantPrevLen: 1,
  },
  {
    name: 'derp_home_params_invalid',
    homeParamsScore: (() => {
      const m: Map<number, number> = new Map<number, number>();
      m.set(1, 0.0);
      m.set(2, -1.0);
      return m;
    })(),
    steps: [{ afterMs: 1000, report: [1, 4000, 2, 5000] }],
    activity: null,
    forcedDERP: 0,
    wantDERP: 1, // score ≤0 被忽略
    wantPrevLen: 1,
  },
  {
    name: 'saw_derp_traffic',
    steps: [
      { afterMs: 0, report: [1, 2000, 2, 3000] },
      { afterMs: 2000, report: [1, 4000, 2, 3000] },
      { afterMs: 2000, report: [2, 3000] },
    ],
    homeParamsScore: null,
    activity: activityOf([1, 2000 + 4000]), // start+2s+8s/2：第 3 步（t=4s）的 8s 窗内
    forcedDERP: 0,
    wantDERP: 1, // 本轮无 d1 延迟但 8s 内听到过 → 保旧
    wantPrevLen: 3,
  },
  {
    name: 'saw_derp_traffic_history',
    steps: [
      { afterMs: 0, report: [1, 2000, 2, 3000] },
      { afterMs: 2000, report: [1, 4000, 2, 3000] },
      { afterMs: 2000, report: [2, 3000] },
    ],
    homeParamsScore: null,
    activity: activityOf([1, 4000 - 8000 - 1]), // 窗外 1ms
    forcedDERP: 0,
    wantDERP: 2,
    wantPrevLen: 3,
  },
  {
    name: 'preferred_derp_hysteresis_no_switch_pct',
    steps: [
      { afterMs: 0, report: [1, 34, 2, 35] },
      { afterMs: 1000, report: [1, 34, 2, 23] },
    ],
    homeParamsScore: null,
    activity: null,
    forcedDERP: 0,
    wantDERP: 1, // 差 11ms ≥10ms 但 23 > floor(34/3)×2=22 → 保旧
    wantPrevLen: 2,
  },
  {
    name: 'forced_two',
    steps: [
      { afterMs: 1000, report: [1, 2000, 2, 3000] },
      { afterMs: 2000, report: [1, 4000, 2, 3000] },
    ],
    homeParamsScore: null,
    activity: null,
    forcedDERP: 2,
    wantDERP: 2,
    wantPrevLen: 2,
  },
  {
    name: 'forced_two_unavailable',
    steps: [
      { afterMs: 1000, report: [1, 2000, 2, 1000] },
      { afterMs: 2000, report: [1, 4000] },
    ],
    homeParamsScore: null,
    activity: null,
    forcedDERP: 2,
    wantDERP: 1, // 强制 region 无样本无活动 → 不强制
    wantPrevLen: 2,
  },
  {
    name: 'forced_two_no_probe_recent_activity',
    steps: [
      { afterMs: 1000, report: [1, 2000] },
      { afterMs: 2000, report: [1, 4000] },
    ],
    homeParamsScore: null,
    activity: activityOf([1, 0, 2, 1000]),
    forcedDERP: 2,
    wantDERP: 2, // 8s 窗内有活动即强制
    wantPrevLen: 2,
  },
  {
    name: 'forced_two_no_probe_no_recent_activity',
    steps: [
      { afterMs: 1000, report: [1, 2000] },
      { afterMs: 9000, report: [1, 4000] }, // PreferredDERPFrameTime+1s
    ],
    homeParamsScore: null,
    activity: activityOf([1, 0, 2, 0]),
    forcedDERP: 2,
    wantDERP: 1,
    wantPrevLen: 2,
  },
  {
    name: 'no_data_keep_home',
    steps: [
      { afterMs: 0, report: [1, 2000, 2, 3000] },
      { afterMs: 30000, report: [] },
      { afterMs: 2000, report: [] },
      { afterMs: 2000, report: [] },
      { afterMs: 2000, report: [] },
      { afterMs: 2000, report: [] },
    ],
    homeParamsScore: null,
    activity: activityOf([1, 0]), // 120s 保活窗内（末步 t=38s < 120s）
    forcedDERP: 0,
    wantDERP: 1,
    wantPrevLen: 6,
  },
  {
    name: 'no_data_home_expires',
    steps: [
      { afterMs: 0, report: [1, 2000, 2, 3000] },
      { afterMs: 30000, report: [] },
      { afterMs: 120000, report: [] }, // 2×derp.KeepAlive 后出保活窗
    ],
    homeParamsScore: null,
    activity: activityOf([1, 0]),
    forcedDERP: 0,
    wantDERP: 0, // 无数据且 120s 窗外 → home 归零
    wantPrevLen: 3,
  },
];

for (const c of CASES) {
  test('迟滞表·' + c.name + '（上游 netcheck_test.go 向量）', (): void => {
    runHistCase(c);
  });
}

test('历史窗边界：maxAge=305s 严格大于（netcheck.go:1417-1420 now.Sub(t) > maxAge）', () => {
  const clock: FixedClock = new FixedClock(BASE);
  const engine: NetcheckEngine = mkHistEngine(clock, 0, null);
  clock.setWallMs(BASE);
  engine.addReportHistoryForTest(mkReport([1, 100]), BASE, null);
  assert.equal(engine.historySize(), 1);
  // 恰好 305000ms：305000 > 305000 不成立 → 保留
  clock.setWallMs(BASE + REPORT_HISTORY_MAX_AGE_MS);
  engine.addReportHistoryForTest(mkReport([1, 100]), BASE + REPORT_HISTORY_MAX_AGE_MS - 100, null);
  assert.equal(engine.historySize(), 2, '边界值等于 maxAge 不清除（严格大于）');
  // 再 +1ms：最旧报告 305001 > 305000 → 清除
  clock.setWallMs(BASE + REPORT_HISTORY_MAX_AGE_MS + 1);
  engine.addReportHistoryForTest(mkReport([1, 100]), BASE + REPORT_HISTORY_MAX_AGE_MS, null);
  assert.equal(engine.historySize(), 2, '超窗 1ms 即清除最旧一份');
});

test('历史窗不变量：每分钟一场、增量只测 1/2，RecentRegionLatency 恒覆盖全 region（TestRecentReportsRetainFullNetcheck，netcheck_test.go:505-558）', () => {
  const clock: FixedClock = new FixedClock(BASE);
  const engine: NetcheckEngine = mkHistEngine(clock, 0, null);
  const allRegions: number[] = [1, 2, 3];
  const incrementalRegions: number[] = [1, 2]; // home + 最快；永不含 region 3
  const TICK: number = 60000;
  let lastFullMs: number = -1;
  for (let i: number = 0; i < 60; i += 1) {
    const nowMs: number = i * TICK;
    clock.setWallMs(BASE + nowMs);
    // 镜像 GetReport 的全量判定（上游测试同样手动镜像）
    const doFull: boolean = lastFullMs < 0 || nowMs - lastFullMs > 300000;
    const regions: number[] = doFull ? allRegions : incrementalRegions;
    if (doFull) {
      lastFullMs = nowMs;
    }
    const r: NetcheckReport = mkReport([]);
    for (const rid of regions) {
      r.regionLatency.set(rid, 10);
    }
    engine.addReportHistoryForTest(r, BASE + nowMs - 100, null);
    const recent: Map<number, number> = engine.recentRegionLatency();
    for (const rid of allRegions) {
      assert.ok(
        recent.has(rid),
        '第 ' + String(i) + ' 场后 region ' + String(rid) + ' 必须仍在历史窗（maxAge=5min+5s 保证至少一份全量在场）',
      );
    }
  }
});

test('addReportHistoryForTest 路径直接改传入报告的 home（上游 AddReportHistoryForTest 同语义）', () => {
  const clock: FixedClock = new FixedClock(BASE);
  const engine: NetcheckEngine = mkHistEngine(clock, 0, null);
  const r: NetcheckReport = mkReport([1, 2000, 2, 3000]);
  engine.addReportHistoryForTest(r, BASE, null);
  assert.equal(r.preferredDERP, 1);
});
