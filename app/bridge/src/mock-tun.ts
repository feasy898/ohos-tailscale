/**
 * TunDevice / TsTunWrapper / FakeTunDevice / TunCable —— 数据面 TUN 的纯 TS mock
 *（C-2：TUN 以纯 TS mock 先行，不做真实 fd）。
 *
 * 上游蓝本（v1.102.3 tag 实拉，2026-10-03 本会话复核；行号均指该 tag）：
 * - wireguard-go（tailscale fork @2e01ba5b00f0）tun.Device 接口（tun/tun.go:20-53）：
 *   Read=从 OS 收 IP 包（发往 WG 加密）、Write=向 OS 注入 IP 包（WG 解密所得）；
 *   Event 位 EventUp=1/EventDown=2/EventMTUUpdate=4（:12-18）。
 * - net/tstun/fake.go:19-58 NewFake（无 fd 桩，本 mock 的直接对应物）：
 *   Read 阻塞至 Close 后返 EOF、Write 恒 (1,nil)、MTU=1500、Name="FakeTUN"、
 *   IsFakeTun()=true。
 * - net/tstun/wrap.go（Wrapper）：Read 在 Start() 前软木塞（:95-96、started :104-105、
 *   awaitStart :857-869——未 Start 永久阻塞，防测试假绿）；PacketStartOffset=16 是
 *   **读写缓冲头部预留空间**（:49-52，wireguard-go 内部优化），不是报文前缀——
 *   TS mock 用 0 offset；Write 路径先 DNAT 再入站过滤（:1239 在 :1245 前），
 *   过滤失败是**静默丢弃 + 计数**，不向 WG 回错（:1246-1248）；InjectOutbound
 *   把包当成「来自本机」送进 WG 方向（:1447）；InjectInboundDirect 把合成包交给
 *   OS 且**不过入站过滤**（:1383，netstack 交付 TCP 栈回应用）。
 * - 引擎装配（wgengine/userspace.go:316-319, :339-344, :511-513, :521-535）：
 *   Tun 为 nil → NewFake；包一层 tstun.Wrap；WG 设备自旋读写 TUN，引擎只旁路
 *   监听升降事件。
 *
 * mock 简化（与上游的有意偏差，均已在测试锚定）：
 * - 批量 Read/Write(bufs+sizes+offset) → 单包同步 read()/write()：「阻塞」以
 *   「读不到包返回 null」同伦表达（cork 语义另行建模）；
 * - PacketStartOffset 恒 0（上游 16B 头部空间是为 wireguard-go 重分配优化，
 *   研究笔记 §4.4-3 与 C3 陷阱 19）；
 * - 两个 PacketFilter 函数体（wrap.go:745-835/:1097-1228，netmap 四元组过滤）属
 *   二期另一件——此处以注入式谓词钩子表达挂点与时序。
 */

/** tun.Event 位（fork tun/tun.go:12-18）。 */
export interface TunEventBitsE {
  Up: number;
  Down: number;
  MTUUpdate: number;
}

export const TunEventBits: TunEventBitsE = { Up: 1, Down: 2, MTUUpdate: 4 };

/** NewFake 的 MTU（tstun/fake.go:54）。 */
export const TUN_FAKE_MTU: number = 1500;

/** NewFake 的设备名（tstun/fake.go:51/:55）。 */
export const TUN_FAKE_NAME: string = 'FakeTUN';

/**
 * 纯 IO 设备接口（wireguard-go tun.Device 的 TS 窄接口；单包同步形态）。
 * read() 返回 null = 当前无包（上游阻塞语义的同伦表达；Close 后恒 null=EOF）。
 */
export interface TunDevice {
  /** OS→WG：取一个待加密 IP 包；无包/已关 → null。 */
  read(): Uint8Array | null;
  /** WG→OS：注入一个解密出的 IP 包；返回写入数。 */
  write(pkt: Uint8Array): number;
  mtu(): number;
  name(): string;
  close(): void;
  isFake(): boolean;
}

/**
 * FakeTunDevice —— tstun.NewFake 的 TS 形态（fake.go:19-58）：
 * 无 fd、读恒无包（阻塞至关闭的桩）、写恒接受且丢弃（netstack 模式的 TUN 桩）。
 */
export class FakeTunDevice implements TunDevice {
  private closed: boolean = false;
  private written: number = 0;

  public read(): Uint8Array | null {
    // 上游：阻塞至 Close 后返 EOF。mock 同伦：恒「无包」；closed 状态单独可见。
    return null;
  }

  public write(pkt: Uint8Array): number {
    if (this.closed) {
      return 0;
    }
    this.written += 1;
    return 1;
  }

  public mtu(): number {
    return TUN_FAKE_MTU;
  }

  public name(): string {
    return TUN_FAKE_NAME;
  }

  public close(): void {
    this.closed = true;
  }

  public isFake(): boolean {
    return true;
  }

  public isClosed(): boolean {
    return this.closed;
  }

  /** 累计写入数（恒接受计数；上游 Write 恒 (1,nil) 的可观测面）。 */
  public writeCount(): number {
    return this.written;
  }
}

/**
 * MemoryTunDevice —— 带内存「网线」端点的设备：write 的包经 sink 交给网线，
 * 网线对端 feed() 的包进入读队列（OS 入方向的 mock）。
 */
export class MemoryTunDevice implements TunDevice {
  private queue: Uint8Array[] = [];
  private closed: boolean = false;
  private deviceName: string;
  private deviceMtu: number;
  /** WG→OS 侧的下游（网线接法后指向对端设备的 feed）。 */
  public sink: ((pkt: Uint8Array) => void) | null = null;

  public constructor(name: string, mtu: number) {
    this.deviceName = name;
    this.deviceMtu = mtu;
  }

  /** 网线注入（OS 收到一个包 → 可被 read() 取走发往 WG）。 */
  public feed(pkt: Uint8Array): void {
    if (this.closed) {
      return;
    }
    this.queue.push(pkt.slice());
  }

  public read(): Uint8Array | null {
    const next: Uint8Array | undefined = this.queue.shift();
    return next === undefined ? null : next;
  }

  public write(pkt: Uint8Array): number {
    if (this.closed) {
      return 0;
    }
    if (this.sink !== null) {
      this.sink(pkt.slice());
    }
    return 1;
  }

  public mtu(): number {
    return this.deviceMtu;
  }

  public name(): string {
    return this.deviceName;
  }

  public close(): void {
    this.closed = true;
    this.queue = [];
  }

  public isFake(): boolean {
    return true;
  }

  public isClosed(): boolean {
    return this.closed;
  }

  public queued(): number {
    return this.queue.length;
  }
}

/**
 * TsTunWrapper —— tstun.Wrapper 的 TS 形态：cork/Start + 过滤 + 注入。
 * 方向纪律：read = OS→WG（出站，过 outboundFilter）；write = WG→OS
 * （先 DNAT 再过 inboundFilter，失败静默丢弃）。
 */
export class TsTunWrapper {
  private device: TunDevice;
  private started: boolean = false;
  private eventsValue: number = 0;
  /** 出站过滤（OS→WG）：返回 false = 静默丢弃（wrap.go:901-908 drop 计数语义）。 */
  public filterOutboundToWireGuard: ((pkt: Uint8Array) => boolean) | null = null;
  /** 入站 DNAT（WG→OS）：先于入站过滤执行（wrap.go:1239 在 :1245 前）。 */
  public dnatInbound: ((pkt: Uint8Array) => Uint8Array) | null = null;
  /** 入站过滤（PacketFilter 主门）：返回 false = 静默丢弃 + 计数，不回错（:1246-1248）。 */
  public filterInboundFromWireGuard: ((pkt: Uint8Array) => boolean) | null = null;
  /** 静默丢弃计数（出站/入站分列）。 */
  public droppedOutbound: number = 0;
  public droppedInbound: number = 0;
  /** cork 期间被挡的读次数（防假绿的可观测面）。 */
  public corkedReads: number = 0;
  /** InjectOutbound 注入队列（read() 优先消费；wrap.go:1447）。 */
  private injected: Uint8Array[] = [];

  public constructor(device: TunDevice) {
    this.device = device;
  }

  /** Start()（wrap.go:274-277）：置位并关门——此前 Read 永久阻塞（:95-96）。 */
  public start(): void {
    this.started = true;
  }

  public isStarted(): boolean {
    return this.started;
  }

  /** OS→WG 读（wrap.go:871-939）：cork → 注入队列优先 → 底层设备 → 出站过滤。 */
  public read(): Uint8Array | null {
    if (!this.started) {
      this.corkedReads += 1;
      return null;
    }
    const injectedPkt: Uint8Array | undefined = this.injected.shift();
    if (injectedPkt !== undefined) {
      return this.applyOutboundFilter(injectedPkt);
    }
    const pkt: Uint8Array | null = this.device.read();
    if (pkt === null) {
      return null;
    }
    return this.applyOutboundFilter(pkt);
  }

  private applyOutboundFilter(pkt: Uint8Array): Uint8Array | null {
    if (this.filterOutboundToWireGuard !== null && !this.filterOutboundToWireGuard(pkt)) {
      this.droppedOutbound += 1;
      return null;
    }
    return pkt;
  }

  /** WG→OS 写（wrap.go:1229-1273）：DNAT 先行 → 入站过滤（静默丢弃）→ 底层设备。 */
  public write(pkt: Uint8Array): number {
    let out: Uint8Array = pkt;
    if (this.dnatInbound !== null) {
      out = this.dnatInbound(pkt);
    }
    if (this.filterInboundFromWireGuard !== null && !this.filterInboundFromWireGuard(out)) {
      this.droppedInbound += 1;
      return 1;
    }
    return this.device.write(out);
  }

  /** InjectInboundDirect（wrap.go:1383）：合成包直达 OS，不过入站过滤。 */
  public injectInboundDirect(pkt: Uint8Array): number {
    return this.device.write(pkt);
  }

  /** InjectOutbound（wrap.go:1447）：把包当成来自本机送进 WG 方向（过出站过滤）。 */
  public injectOutbound(pkt: Uint8Array): void {
    this.injected.push(pkt.slice());
  }

  /** 引擎旁路监听的升降事件（userspace.go:521-535 形态；位见 TunEventBits）。 */
  public emitEvent(bit: number): void {
    this.eventsValue = this.eventsValue | bit;
  }

  public eventsUpDown(): number {
    return this.eventsValue;
  }

  public mtu(): number {
    return this.device.mtu();
  }

  public name(): string {
    return this.device.name();
  }

  public close(): void {
    this.device.close();
  }

  public underlying(): TunDevice {
    return this.device;
  }
}

/**
 * TunCable —— 两台 mock 引擎之间的内存网线：A 的 WG→OS 出包（write）即 B 的
 * OS 入包（feed → read 可见），对向同理。直连 L3 形态（无 NAT/丢包；需要时在
 * UdpDatagramBus 上做发现面仿真，本网线只管数据面）。
 */
export class TunCable {
  public deliveredAtoB: number = 0;
  public deliveredBtoA: number = 0;

  public constructor(a: TsTunWrapper, b: TsTunWrapper) {
    const devA: TunDevice = a.underlying();
    const devB: TunDevice = b.underlying();
    if (!(devA instanceof MemoryTunDevice) || !(devB instanceof MemoryTunDevice)) {
      throw new Error('tun cable: both ends must be MemoryTunDevice');
    }
    const memA: MemoryTunDevice = devA;
    const memB: MemoryTunDevice = devB;
    memA.sink = (pkt: Uint8Array): void => {
      memB.feed(pkt);
      this.deliveredAtoB += 1;
    };
    memB.sink = (pkt: Uint8Array): void => {
      memA.feed(pkt);
      this.deliveredBtoA += 1;
    };
  }
}
