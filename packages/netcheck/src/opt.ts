/**
 * 三态布尔（上游 types/opt.Bool 的移植）。
 *
 * 上游 opt.Bool 底层是 string：""=未检测、"false"、"true"（netcheck.go 的
 * MappingVariesByDestIP/UPnP/PMP/PCP/CaptivePortal 都是它，netcheck.go:101-128）。
 * 【陷阱】未知态（""）是调度逻辑的活输入：probeWouldHelp 对 v4 探测在
 * MappingVariesByDestIP == "" 时放行（netcheck.go:667），且 Set(false) 只在
 * 未知态发生（:730-732）——移植不得塌缩成 boolean（R5：字面量联合禁用，
 * 故用常量对象 + number 状态建模，参照仓内 R5 惯例）。
 */

/** 三态取值集合（R5 常量对象模式）。 */
export interface OptStateE {
  Unknown: number;
  False: number;
  True: number;
}

export const OPT_STATE: OptStateE = { Unknown: 0, False: 1, True: 2 };

/** 三态布尔：构造即未知；set 后恒定（上游 opt.Bool 无 unset）。 */
export class OptBool {
  private state: number = OPT_STATE.Unknown;

  /** 是否仍为未知态（上游 == ""）。 */
  public isUnknown(): boolean {
    return this.state === OPT_STATE.Unknown;
  }

  /** 是否已被检测过（上游 != ""）。 */
  public isSet(): boolean {
    return this.state !== OPT_STATE.Unknown;
  }

  /** 上游 Get()：未知返回 null，否则返回布尔值。 */
  public get(): boolean | null {
    if (this.state === OPT_STATE.True) {
      return true;
    }
    if (this.state === OPT_STATE.False) {
      return false;
    }
    return null;
  }

  /** 上游 Set(b)。 */
  public set(v: boolean): void {
    this.state = v ? OPT_STATE.True : OPT_STATE.False;
  }

  /** 上游 EqualBool(b)：已检测且值等于 b（netcheck.go:896 CaptivePortal.EqualBool(true)）。 */
  public equalBool(v: boolean): boolean {
    const g: boolean | null = this.get();
    return g !== null && g === v;
  }

  /** 深拷贝（Report.Clone 的一部分；上游 string 值拷贝语义）。 */
  public copy(): OptBool {
    const out: OptBool = new OptBool();
    out.state = this.state;
    return out;
  }
}
