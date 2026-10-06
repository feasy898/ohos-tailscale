/**
 * DERP region/节点数据结构与 home region 选择（架构契约 §8.2）。
 *
 * 取证对齐（docs/oracle/protocol-notes.md §3/§5）：
 * - CertName 在实测 derp-map 中全部缺省：TLS 校验层必须实现"CertName 优先、HostName 回退"，
 *   本结构只保证字段语义（certName = '' 表示未配置）；
 * - stunPort/derpPort = 0 表示未显式下发，消费方按 STUN_DEFAULT_PORT(3478)/DERP_DEFAULT_PORT(443) 兜底；
 * - latencyMs = -1 表示未测出延迟，region 选择必须能兜底（实测 region 999 测不出延迟仍可通信）。
 *
 * B3 上游对齐（docs/research/2026-10-02-B3-derp-pick.md，实读 jsdelivr @main 2026-10-02）：
 * - 上游在 region 内**不做**随机选节点：DERPRegion.Nodes 是控制面为当前客户端排好的
 *   优先序（derpmap.go:171-183），客户端 derphttp dialRegion 严格按数组序回退、跳过
 *   STUNOnly、全败返回第一个错误（derphttp_client.go:637-657）——本文件的 pickNode/
 *   derpUsableNodes 即该语义；「随机」只存在于 region 级兜底 pickDERPFallback
 *   （wgengine/magicsock/derp.go:114-152），本文件 pickHomeRegionFallback 对齐之，
 *   随机源一律经 common 注入 Rng（P4/G0-5，禁 Math.random）。
 */

import { type Rng } from '@ohos-tailscale/common';
import { DerpError } from './frame.ts';

export interface DerpNode {
  name: string;
  hostName: string; // DNS 解析 + TLS SNI
  // '' = 未配置 → TLS 校验回退 hostName；非空且以 'sha256-raw:' 开头时，其余部分为
  // 期望证书的 SHA256 hex（钉扎，自签自建 DERP 的唯一可用形态；此时 hostName 常为 IP
  // 字面量。上游 derpmap.go:204-214，tls 层 derphttp_client.go:669-675——钉扎校验在
  // app/ 侧 TLS 层实现，本包只保证字段语义不丢失）。
  certName: string;
  // '' = 走 DNS 解析 hostName 的 A 记录；'none' = 显式禁用 IPv4；既非合法 IPv4 又非
  // 'none' 的字符串同样按禁用处理（上游 derpmap.go:216-221 + shouldDialProto
  // derphttp_client.go:714-721）。
  ipv4: string;
  // 同 ipv4（AAAA 记录；上游 derpmap.go:222-228）。
  ipv6: string;
  stunPort: number; // 0 = 未显式下发（按 STUN_DEFAULT_PORT=3478）；负值 = 该节点不做 STUN（上游 STUNPort，derpmap.go:230-233）
  derpPort: number; // 0 = 未显式下发（按 DERP_DEFAULT_PORT=443，derpmap.go:239-243）
  // true = 该节点只是 STUN 服务器、不是 DERP relay——DERP 拨号必须跳过（上游
  // DERPNode.STUNOnly，derpmap.go:235-237；dialRegion 跳过逻辑 derphttp_client.go:640-647）。
  stunOnly: boolean;
  canPort80: boolean;
}

export interface DerpRegion {
  regionId: number;
  regionCode: string; // status --json 的 Relay 字段取值
  regionName: string;
  // 控制面为当前客户端排好的节点优先序（上游 derpmap.go:171-183），本包不做洗牌；
  nodes: DerpNode[];
  latencyMs: number; // -1 = 未测出
}

/** u64 掩码（Lemire 拒绝采样用，P6：>2^53 一律 BigInt）。 */
const MASK64: bigint = (1n << 64n) - 1n;

/**
 * dialRegion 的遍历定义域：按数组序、剔除 stunOnly 节点（上游 derphttp_client.go:640-647
 * 的 `for _, n := range reg.Nodes` + `if n.STUNOnly { continue }`）。
 * 返回独立数组；节点对象与调用方共享。
 */
export function derpUsableNodes(region: DerpRegion): DerpNode[] {
  const out: DerpNode[] = [];
  for (const n of region.nodes) {
    if (!n.stunOnly) {
      out.push(n);
    }
  }
  return out;
}

/**
 * 经注入 Rng 取均匀分布的 [0, n) 整数（对齐上游 util/rands.IntN 的采样算法：
 * Lemire 乘法归约 + 拒绝采样，cheap.go:28-34 `uint64n` 的 `hi, lo := bits.Mul64(x, n)`、
 * `thresh := -n % n`、`lo < thresh` 重抽）。
 *
 * 与上游的差异（研究笔记 §8.9）：上游的种子取 Conn 指针地址（`unsafe.Pointer(c)`，
 * 每实例一次定型）——JS 无对应物，取种方式交给注入方（本包只消费 Rng.randomBytes 的
 * 字节流，按大端读 u64）；拒绝采样保证无偏，与直接 `x % n` 不同。
 */
export function rngIntN(rng: Rng, n: number): number {
  if (!Number.isInteger(n) || n <= 0) {
    throw new DerpError('RANGE', 'rngIntN: n must be a positive integer, got ' + String(n)) as Error;
  }
  const bn: bigint = BigInt(n);
  // Go uint64 算术 thresh := -n % n 即 (2^64 - n) mod n。
  const thresh: bigint = (MASK64 + 1n - bn) % bn;
  for (;;) {
    const buf: Uint8Array = new Uint8Array(8);
    rng.randomBytes(buf);
    let x: bigint = 0n;
    for (let i: number = 0; i < 8; i += 1) {
      x = (x << 8n) | BigInt(buf[i]);
    }
    const m: bigint = x * bn;
    if ((m & MASK64) >= thresh) {
      return Number(m >> 64n); // hi ∈ [0, n)
    }
  }
}

/** regionId 升序比较器（pickHomeRegionFallback 的随机定义域排序，对齐 DERPMap.RegionIDs）。 */
const byRegionId = (a: DerpRegion, b: DerpRegion): number => a.regionId - b.regionId;

/**
 * home region 选择器（构造时持有 region 列表；setLatency 覆盖值存内部表，不改调用方对象）。
 *
 * B3 增补：可选注入 Rng，仅用于 region 级随机兜底 pickHomeRegionFallback
 * （对齐上游唯一的随机点 pickDERPFallback，wgengine/magicsock/derp.go:114-152）；
 * 节点级选择不使用随机（见 pickNode 注释）。
 */
export class DerpRegionPicker {
  private regions: DerpRegion[];
  private latencies: Map<number, number> = new Map<number, number>();
  private rng: Rng | null;

  constructor(regions: DerpRegion[], rng?: Rng) {
    this.regions = regions.slice(); // 数组浅拷贝；region/node 对象与调用方共享
    this.rng = rng !== undefined ? rng : null;
  }

  /** 记录某 region 实测延迟；regionId 未知抛 DerpError('RANGE')。 */
  public setLatency(regionId: number, latencyMs: number): void {
    const target: DerpRegion | null = this.regionById(regionId);
    if (target === null) {
      throw new DerpError('RANGE', 'unknown derp region id: ' + String(regionId)) as Error;
    }
    this.latencies.set(regionId, latencyMs);
  }

  /**
   * home region：最小非负 latencyMs（并列取先声明者）；
   * 全部未测出（<0）→ nodes 非空的第一个 region；
   * 无 region → null。
   */
  public homeRegion(): DerpRegion | null {
    let best: DerpRegion | null = null;
    let bestLatency: number = -1;
    for (const r of this.regions) {
      const latency: number = this.latencyOf(r);
      if (latency < 0) {
        continue;
      }
      if (best === null || latency < bestLatency) {
        best = r;
        bestLatency = latency;
      }
    }
    if (best !== null) {
      return best;
    }
    for (const r of this.regions) {
      if (r.nodes.length > 0) {
        return r;
      }
    }
    return null;
  }

  /** 按 id 查 region；无则 null。 */
  public regionById(id: number): DerpRegion | null {
    for (const r of this.regions) {
      if (r.regionId === id) {
        return r;
      }
    }
    return null;
  }

  /**
   * region 内选节点（B3 勘误后的上游对齐语义）：按数组序返回第一个非 stunOnly 节点。
   *
   * 上游依据：DERPRegion.Nodes 是控制面为当前客户端排好的优先序（derpmap.go:171-183），
   * 客户端 dialRegion 按数组序取第一个可连节点（derphttp_client.go:637-657），**节点级
   * 无随机**——本方法不是「随机洗牌」，随机只在 region 级兜底（pickHomeRegionFallback）。
   * 核心库无拨号能力，「可连」以非 stunOnly 过滤表达（derpUsableNodes）；真正的按序
   * 拨号回退见 regiondial.ts 的 derpDialRegion。
   *
   * 错误约定（对齐上游 firstErr 文本，derphttp_client.go:637/642）：空 region →
   * DerpError('RANGE', 'no nodes for derp-<id>')；全 stunOnly →
   * DerpError('RANGE', 'no non-STUNOnly nodes for derp-<id>')。
   */
  public pickNode(region: DerpRegion): DerpNode {
    if (region.nodes.length === 0) {
      throw new DerpError('RANGE', 'no nodes for derp-' + String(region.regionId)) as Error;
    }
    const usable: DerpNode[] = derpUsableNodes(region);
    if (usable.length === 0) {
      throw new DerpError('RANGE', 'no non-STUNOnly nodes for derp-' + String(region.regionId)) as Error;
    }
    return usable[0];
  }

  /** derpDialRegion 的遍历定义域（按数组序、剔除 stunOnly；返回独立数组，节点对象共享）。 */
  public usableNodes(region: DerpRegion): DerpNode[] {
    return derpUsableNodes(region);
  }

  /**
   * region 级随机兜底（对齐上游 pickDERPFallback，wgengine/magicsock/derp.go:114-152）：
   * netcheck 无延迟数据（如 UDP 被封、STUN 全无响应）时 home 的选法。
   *
   * 语义逐条对齐上游：
   * - 已有 home → 原样复用（`if c.myDerp != 0 { return c.myDerp }`，ms-derp.go:139-140），
   *   且不消耗随机数；上游 myDerp 恒为当前 map 内合法值（setDERPMap 维护），本 API 由
   *   调用方传入，未知 id 防御性视为「无 home」进入随机分支；
   * - 无 region → null（上游 `len(ids) == 0 → 0`，ms-derp.go:121-124）；
   * - 否则经注入 Rng 随机取一个 region。随机定义域 = **按 regionId 升序的全体 region**
   *   （上游 `c.derpMap.RegionIDs()` 返回排序后的全部 region id，derpmap.go:39-46），
   *   不按「有无节点」过滤（@main 与 v1.36.0 均如此，实测实拉对照）——空 region 被
   *   随中时的拨号失败由 derpDialRegion 的 'no nodes for' 错误表达。
   *
   * 未注入 Rng 且走到随机分支 → 抛 Error（P4：随机必须经注入；确定性复用路径不需要 Rng）。
   */
  public pickHomeRegionFallback(currentHomeRegionId: number): DerpRegion | null {
    if (currentHomeRegionId !== 0) {
      const current: DerpRegion | null = this.regionById(currentHomeRegionId);
      if (current !== null) {
        return current;
      }
    }
    if (this.regions.length === 0) {
      return null;
    }
    if (this.rng === null) {
      throw new Error(
        'pickHomeRegionFallback requires an injected Rng (P4: core src forbids nondeterministic randomness)',
      );
    }
    const sorted: DerpRegion[] = this.regions.slice().sort(byRegionId);
    return sorted[rngIntN(this.rng, sorted.length)];
  }

  private latencyOf(r: DerpRegion): number {
    const override: number | undefined = this.latencies.get(r.regionId);
    if (override !== undefined) {
      return override;
    }
    return r.latencyMs;
  }
}
