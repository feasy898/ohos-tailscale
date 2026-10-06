/**
 * MockIpnBackend + MockLocalApiServer —— LocalAPI/IPC 的壳侧 mock 接线。
 *
 * 协议语义全部来自 @ohos-tailscale/control 的 localapi.ts（v1.102.3 实拉对齐）；
 * 本文件只做「内存后端 + HTTP 形态」的装配（app/ 展示/IPC 层是 R3 允许的 JSON
 * 落点；control 侧 localapi.ts 的 JSON 延伸口径见其文件头）。
 *
 * 上游形态锚点（v1.102.3；行号见 control/localapi.ts 头注与各方法内标注）：
 * - 传输 = HTTP/1.1 + JSON over 本地字节流；mock 载体 = 进程内函数调用
 *   （safesocket 的替代；协议语义层与载体解耦——oracle 曾以 127.0.0.1 HTTP
 *   代理访问成功，protocol-notes.md:47-50）；
 * - 状态机副作用经 control.localStateEffect 驱动（NeedsLogin/Stopped/NoState ⇒
 *   数据面三份空配置；离开 Running ⇒ 关 PeerAPI）；
 * - watch-ipn-bus = 逐行 ipn.Notify JSON；SessionID 仅首条；
 *   PeerChanges/PeerPatches 位门控 peer 增删上 bus；
 * - prefs 只能 PATCH+掩码（MaskedPrefs），无整对象写；
 * - /dns-query = write 权限 + 仅 GET + ?name=&type=。
 */

import { utf8Decode, utf8Encode, type HttpRequest, type HttpResponse } from '@ohos-tailscale/common';
import {
  NotifyWatchOptBits,
  ResolverCore,
  IpnState,
  applyMaskedPrefs,
  buildLocalApiRequest,
  checkLocalApiGuards,
  cloneIpnPrefs,
  decodeIpnNotifyLine,
  decodeMaskedPrefs,
  defaultIpnPrefs,
  dnsMessageTypeForString,
  emptyIpnNotify,
  encodeIpnNotifyLine,
  encodeNotifyStream,
  encodeStatusJson,
  ipnStateToString,
  localApiBaseHeaders,
  localApiLogLine,
  localStateEffect,
  parseLocalApiTarget,
  parseNotifyWatchMask,
  parseUrlQuery,
  queryBool,
  validateNotifyWatchMask,
  type IpnNotify,
  type IpnPrefs,
  type IpnPrefsMask,
  type MaskedPrefsView,
  type NotifyNodeView,
  type StatusJsonView,
} from '@ohos-tailscale/control';

/** mock 后端版本串（响应头 Tailscale-Version 的值）。 */
export const MOCK_TAILSCALE_VERSION: string = '1.102.3-mock';

/** mock 后端 capver（tailcfg.CurrentCapabilityVersion 对齐值）。 */
export const MOCK_TAILSCALE_CAP: number = 148;

/** 一个 watch-ipn-bus 订阅（每订阅独立队列；mask 决定增量类别）。 */
export class MockIpnWatch {
  public readonly mask: number;
  public readonly sessionId: string;
  private pending: IpnNotify[] = [];
  private closed: boolean = false;

  public constructor(mask: number, sessionId: string) {
    this.mask = mask;
    this.sessionId = sessionId;
  }

  public push(notify: IpnNotify): void {
    if (this.closed) {
      return;
    }
    this.pending.push(notify);
  }

  /** 取走当前积压并编码为逐行 JSON（mock 的「响应增量」形态）。 */
  public drainLines(): string[] {
    const lines: string[] = [];
    for (const n of this.pending) {
      lines.push(encodeIpnNotifyLine(n));
    }
    this.pending = [];
    return lines;
  }

  public close(): void {
    this.closed = true;
  }

  public isClosed(): boolean {
    return this.closed;
  }
}

/**
 * MockIpnBackend —— ipnlocal.LocalBackend 的内存桩：状态机 + prefs + watches
 * + 数据面副作用计数（供测试断言 enterStateLocked 的可观测行为）。
 */
export class MockIpnBackend {
  public version: string = MOCK_TAILSCALE_VERSION;
  public capVer: number = MOCK_TAILSCALE_CAP;
  public state: number = IpnState.NoState;
  public prefs: IpnPrefs = defaultIpnPrefs();
  /** netmap 到位后的 self 地址（status JSON TailscaleIPs）。 */
  public selfTailscaleIps: string[] = [];
  public magicDnsSuffix: string = '';
  public certDomains: string[] = [];
  /** peer 表（NodeID → Notify 词表视图；status Peer 以 nodekey 为键）。 */
  public peers: Map<number, NotifyNodeView> = new Map();
  public peerKeys: Map<number, string> = new Map();
  /** /dns-config 下发的 tailcfg.DNSConfig 原文形态（结构化视图，非 JSON 文本）。 */
  public dnsConfigRaw: Record<string, unknown> | null = null;
  /** /dns-query 背后的解析核（MagicDNS 逻辑在 control 包）。 */
  public resolver: ResolverCore | null = null;

  // —— enterStateLocked 副作用计数（local.go:6724-6808 的可观测面） ——
  public reconfigEmptyCount: number = 0;
  public authReconfigCount: number = 0;
  public engineUpdatesBlocked: boolean = false;
  /** 离开 Running 时置位（:6752-6758 关 PeerAPI 监听）。 */
  public peerApiClosed: boolean = false;

  private watches: MockIpnWatch[] = [];
  private watchSeq: number = 0;

  /** enterStateLocked（local.go:6724-6808）：副作用推导 + State 广播。 */
  public enterState(newState: number): void {
    const eff = localStateEffect(this.state, newState);
    if (eff.closePeerApi) {
      this.peerApiClosed = true;
    }
    if (eff.blockEngineUpdates) {
      this.engineUpdatesBlocked = true;
    } else {
      this.engineUpdatesBlocked = false;
    }
    if (eff.reconfigEmptyDataPlane) {
      this.reconfigEmptyCount += 1;
    }
    if (eff.authReconfig) {
      this.authReconfigCount += 1;
    }
    const old: number = this.state;
    this.state = newState;
    if (eff.sendStateNotify) {
      this.broadcast((version: string): IpnNotify => {
        const n: IpnNotify = emptyIpnNotify(version);
        n.state = newState;
        return n;
      }, 0, old);
    }
  }

  /** EditPrefsAs 的掩码合并简化（PATCH /prefs 后端动作）。 */
  public patchPrefs(jsonBody: Uint8Array): IpnPrefs {
    const masked = decodeMaskedPrefs(utf8Decode(jsonBody));
    this.prefs = applyMaskedPrefs(this.prefs, masked);
    return cloneIpnPrefs(this.prefs);
  }

  /** WantRunning=false / true 的状态联动（上游 local.go:6072-6075 短路语义的 mock 面）。 */
  public applyWantRunning(): void {
    if (!this.prefs.WantRunning && this.state === IpnState.Running) {
      this.enterState(IpnState.Stopped);
    }
  }

  /** 注册一个 bus 订阅（watch-ipn-bus 的后端动作；返回带 SessionID 的订阅）。 */
  public openWatch(mask: number): MockIpnWatch {
    this.watchSeq += 1;
    const w: MockIpnWatch = new MockIpnWatch(mask, 'sess-' + String(this.watchSeq));
    // 首条批量（backend.go 语义：InitialState/InitialPrefs/InitialStatus 各自带一份；
    // SessionID 仅首条携带）。
    const first: IpnNotify = emptyIpnNotify(this.version);
    first.sessionId = w.sessionId;
    if ((mask & NotifyWatchOptBits.InitialState) !== 0) {
      first.state = this.state;
    }
    if ((mask & NotifyWatchOptBits.InitialPrefs) !== 0) {
      first.prefs = cloneIpnPrefs(this.prefs);
    }
    if ((mask & NotifyWatchOptBits.InitialStatus) !== 0) {
      first.initialStatus = this.statusJson();
    }
    w.push(first);
    this.watches.push(w);
    return w;
  }

  /**
   * 广播一条 Notify 到所有订阅。gating：peer 增删仅在订阅位含
   * NotifyPeerChanges 或 NotifyPeerPatches 时投递（backend.go 词表；
   * 不设位时 peer 增删根本不上 bus——C3 陷阱 7）。
   */
  private broadcast(build: (version: string) => IpnNotify, peerGatingBit: number, _fromState: number): void {
    for (const w of this.watches) {
      if (peerGatingBit !== 0 && (w.mask & (NotifyWatchOptBits.PeerChanges | NotifyWatchOptBits.PeerPatches)) === 0) {
        continue;
      }
      w.push(build(this.version));
    }
  }

  /** PeersChanged 广播（完整 Node upsert；需 PeerChanges/Patches 位）。 */
  public notifyPeersChanged(nodes: NotifyNodeView[]): void {
    this.broadcast((version: string): IpnNotify => {
      const n: IpnNotify = emptyIpnNotify(version);
      n.peersChanged = nodes;
      return n;
    }, 4096, this.state);
  }

  /** PeersRemoved 广播（需 PeerChanges/Patches 位）。 */
  public notifyPeersRemoved(nodeIds: number[]): void {
    this.broadcast((version: string): IpnNotify => {
      const n: IpnNotify = emptyIpnNotify(version);
      n.peersRemoved = nodeIds;
      return n;
    }, 4096, this.state);
  }

  /** ipnstate.Status 视图（/status 与 InitialStatus 共用）。 */
  public statusJson(): StatusJsonView {
    const peerMap: Record<string, { DNSName?: string; Online?: boolean }> = {};
    this.peerKeys.forEach((nodeKey: string, nodeId: number): void => {
      const node: NotifyNodeView | undefined = this.peers.get(nodeId);
      const view: { DNSName?: string; Online?: boolean } = {};
      if (node !== undefined) {
        if (node.Hostname !== undefined && this.magicDnsSuffix !== '') {
          view.DNSName = node.Hostname + '.' + this.magicDnsSuffix + '.';
        }
        view.Online = node.Online === true;
      }
      peerMap[nodeKey] = view;
    });
    const status: StatusJsonView = {
      Version: this.version,
      TUN: true,
      BackendState: ipnStateToString(this.state),
      TailscaleIPs: this.selfTailscaleIps.slice(),
      MagicDNSSuffix: this.magicDnsSuffix,
      CertDomains: this.certDomains.slice(),
      Peer: peerMap,
    };
    return status;
  }
}

/** UTF-8 解码统一走 common.utf8Decode（严格校验；mock 请求体恒合法）。 */

/** mock 服务的权限装配（ipnauth.Actor 的 PermitRead/PermitWrite 位）。 */
export interface MockLocalApiParams {
  permitRead: boolean;
  permitWrite: boolean;
  /** 沙盒 macOS 形态的一次性口令（'' = 无 BasicAuth）。 */
  requiredPassword: string;
}

/** LocalAPI 响应小构造。 */
const jsonResponse = (status: number, headers: Record<string, string>, body: Uint8Array): HttpResponse => {
  const resp: HttpResponse = { status: status, headers: headers, body: body };
  return resp;
};

const textBody = (s: string): Uint8Array => {
  return utf8Encode(s);
};

/**
 * MockLocalApiServer —— localapi.Handler 的 mock 形态：守卫 → 路由 → 权限 →
 * handler。请求一律经 control.buildLocalApiRequest 构造（Host 纪律）。
 */
export class MockLocalApiServer {
  public readonly backend: MockIpnBackend;
  private params: MockLocalApiParams;
  /** 非 GET/HEAD/OPTIONS 请求的日志行（logRequest 的留痕，测试断言用）。 */
  public logLines: string[] = [];

  public constructor(backend: MockIpnBackend, params: MockLocalApiParams) {
    this.backend = backend;
    this.params = params;
  }

  /** 处理一个请求（HttpRequest → HttpResponse；载体=进程内调用）。 */
  public handle(req: HttpRequest): HttpResponse {
    const headers: Record<string, string> = localApiBaseHeaders(this.backend.version, this.backend.capVer);
    // 守卫（localapi.go:249-271）：Referer/Origin/Host/BasicAuth。
    const referer: string = req.headers['referer'] === undefined ? '' : req.headers['referer'];
    const origin: string = req.headers['origin'] === undefined ? '' : req.headers['origin'];
    const host: string = req.headers['host'] === undefined ? '' : req.headers['host'];
    const basicAuth: string | undefined = req.headers['authorization'];
    let basicPassword: string = '';
    let basicProvided: boolean = false;
    if (basicAuth !== undefined && basicAuth.startsWith('Basic ')) {
      basicProvided = true;
      basicPassword = decodeBasicPassword(basicAuth.slice(6));
    }
    const guard = checkLocalApiGuards(host, referer, origin, this.params.requiredPassword, basicPassword, basicProvided);
    if (guard !== null) {
      return jsonResponse(guard.status, headers, textBody(guard.body + '\n'));
    }

    const logLine: string | null = localApiLogLine(req.method, req.url);
    if (logLine !== null) {
      this.logLines.push(req.method + ' ' + req.url);
    }

    // handlerForPath 吃的是 r.URL.Path（不含查询串；localapi.go:314 注释）。
    const qIdx: number = req.url.indexOf('?');
    const urlPath: string = qIdx >= 0 ? req.url.slice(0, qIdx) : req.url;
    const target = parseLocalApiTarget(urlPath);
    if (target === null) {
      return jsonResponse(404, headers, textBody('404 page not found\n'));
    }
    if (target.isRoot) {
      // localapi.go:347-349：根路径回 "tailscaled\n"。
      return jsonResponse(200, headers, textBody('tailscaled\n'));
    }

    const query: Record<string, string> = parseUrlQuery(req.url);
    const bodyText: string = utf8Decode(req.body);

    if (target.route === 'status') {
      return this.serveStatus(query, headers);
    }
    if (target.route === 'prefs') {
      return this.servePrefs(req.method, bodyText, headers);
    }
    if (target.route === 'check-prefs') {
      return this.serveCheckPrefs(req.method, bodyText, headers);
    }
    if (target.route === 'watch-ipn-bus') {
      return this.serveWatchIpnBus(query, headers);
    }
    if (target.route === 'login-interactive') {
      return this.serveLoginInteractive(req.method, headers);
    }
    if (target.route === 'logout') {
      return this.serveLogout(req.method, headers);
    }
    if (target.route === 'start') {
      return this.serveStart(req.method, bodyText, headers);
    }
    if (target.route === 'dns-config') {
      return this.serveDnsConfig(headers);
    }
    if (target.route === 'dns-query') {
      return this.serveDnsQuery(req.method, query, headers);
    }
    // 未装配的端点：已知路由统一 501（mock 面只承诺接线清单内的端点）。
    return jsonResponse(501, headers, textBody('not wired in mock\n'));
  }

  private requireRead(headers: Record<string, string>, what: string): HttpResponse | null {
    if (!this.params.permitRead) {
      return jsonResponse(403, headers, textBody(what + ' access denied\n'));
    }
    return null;
  }

  private requireWrite(headers: Record<string, string>, what: string): HttpResponse | null {
    if (!this.params.permitWrite) {
      return jsonResponse(403, headers, textBody(what + ' access denied\n'));
    }
    return null;
  }

  /** serveStatus（:844-859）：?peers= 缺省 true；ipnstate.Status JSON 制表缩进。 */
  private serveStatus(query: Record<string, string>, headers: Record<string, string>): HttpResponse {
    const denied = this.requireRead(headers, 'status');
    if (denied !== null) {
      return denied;
    }
    const withPeers: boolean = queryBool(query, 'peers', true);
    const status: StatusJsonView = this.backend.statusJson();
    if (!withPeers) {
      status.Peer = undefined;
    }
    return jsonResponse(200, headers, encodeStatusJson(status));
  }

  /** servePrefs（:1004-1036）：GET/HEAD 读；PATCH 需写权限+掩码体；其余 405。 */
  private servePrefs(method: string, bodyText: string, headers: Record<string, string>): HttpResponse {
    const denied = this.requireRead(headers, 'prefs');
    if (denied !== null) {
      return denied;
    }
    if (method === 'PATCH') {
      const deniedWrite = this.requireWrite(headers, 'prefs write');
      if (deniedWrite !== null) {
        return deniedWrite;
      }
      let masked;
      try {
        masked = decodeMaskedPrefs(bodyText);
      } catch (e) {
        return jsonResponse(400, headers, textBody(String(e) + '\n'));
      }
      this.backend.prefs = applyMaskedPrefs(this.backend.prefs, masked);
      return jsonResponse(200, headers, textBody(JSON.stringify(this.backend.prefs, undefined, '\t') + '\n'));
    }
    if (method === 'GET' || method === 'HEAD') {
      return jsonResponse(200, headers, textBody(JSON.stringify(this.backend.prefs, undefined, '\t') + '\n'));
    }
    return jsonResponse(405, headers, textBody('unsupported method\n'));
  }

  /** serveCheckPrefs（:1047-1068）：POST + 完整 Prefs，仅校验返回 {Error}。 */
  private serveCheckPrefs(method: string, bodyText: string, headers: Record<string, string>): HttpResponse {
    const denied = this.requireWrite(headers, 'checkprefs');
    if (denied !== null) {
      return denied;
    }
    if (method !== 'POST') {
      return jsonResponse(405, headers, textBody('unsupported method\n'));
    }
    let error: string = '';
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      if (typeof parsed.ControlURL === 'string' && parsed.ControlURL === '') {
        error = 'empty ControlURL';
      }
    } catch (e) {
      error = 'invalid JSON body';
    }
    return jsonResponse(200, headers, textBody(JSON.stringify({ Error: error }) + '\n'));
  }

  /** serveWatchIPNBus（:893-933）：mask 十进制 → 首批逐行 Notify（长连的缓冲等价）。 */
  private serveWatchIpnBus(query: Record<string, string>, headers: Record<string, string>): HttpResponse {
    const denied = this.requireRead(headers, 'watch ipn bus');
    if (denied !== null) {
      return denied;
    }
    const maskText: string | undefined = query['mask'];
    let mask: number = 0;
    if (maskText !== undefined && maskText !== '') {
      try {
        mask = parseNotifyWatchMask(maskText);
      } catch (e) {
        return jsonResponse(400, headers, textBody('bad mask\n'));
      }
    }
    const invalid: string | null = validateNotifyWatchMask(mask);
    if (invalid !== null) {
      return jsonResponse(400, headers, textBody(invalid + '\n'));
    }
    const watch: MockIpnWatch = this.backend.openWatch(mask);
    const lines: string[] = watch.drainLines();
    return jsonResponse(200, headers, encodeNotifyStream(lines));
  }

  private serveLoginInteractive(method: string, headers: Record<string, string>): HttpResponse {
    const denied = this.requireWrite(headers, 'login-interactive');
    if (denied !== null) {
      return denied;
    }
    if (method !== 'POST') {
      return jsonResponse(405, headers, textBody('unsupported method\n'));
    }
    // StartLoginInteractiveAs 成功 → 204（:947-951）。
    return jsonResponse(204, headers, new Uint8Array(0));
  }

  private serveLogout(method: string, headers: Record<string, string>): HttpResponse {
    const denied = this.requireWrite(headers, 'logout');
    if (denied !== null) {
      return denied;
    }
    if (method !== 'POST') {
      return jsonResponse(405, headers, textBody('unsupported method\n'));
    }
    return jsonResponse(204, headers, new Uint8Array(0));
  }

  /** serveStart（:953-979）：body=ipn.Options（UpdatePrefs）；mock 应用后转 Starting。 */
  private serveStart(method: string, bodyText: string, headers: Record<string, string>): HttpResponse {
    const denied = this.requireWrite(headers, 'start');
    if (denied !== null) {
      return denied;
    }
    if (method !== 'POST') {
      return jsonResponse(405, headers, textBody('unsupported method\n'));
    }
    try {
      const opts = JSON.parse(bodyText) as { UpdatePrefs?: Partial<IpnPrefs> };
      const update: Partial<IpnPrefs> | undefined = opts.UpdatePrefs;
      if (update !== undefined) {
        // start 的 UpdatePrefs 是完整 Prefs 语义——mock 以全掩码应用。
        const masked: MaskedPrefsView = maskedPrefsFromPartial(update);
        this.backend.prefs = applyMaskedPrefs(this.backend.prefs, masked);
      }
    } catch (e) {
      return jsonResponse(400, headers, textBody(String(e) + '\n'));
    }
    this.backend.enterState(IpnState.Starting);
    return jsonResponse(200, headers, new Uint8Array(0));
  }

  /** serveDNSConfig（:1134-1148）：netmap 的 DNS 原文；无 → 503。 */
  private serveDnsConfig(headers: Record<string, string>): HttpResponse {
    const denied = this.requireRead(headers, 'dns-config');
    if (denied !== null) {
      return denied;
    }
    if (this.backend.dnsConfigRaw === null) {
      return jsonResponse(503, headers, textBody('no netmap\n'));
    }
    return jsonResponse(200, headers, textBody(JSON.stringify(this.backend.dnsConfigRaw) + '\n'));
  }

  /**
   * serveDNSQuery（:1741-1779）：仅 GET；**要写权限**（隐私考量）；?name=&type=；
   * 响应 {RCode,Answers,Resolvers} —— wire dns-message 打包不在 mock 范围，
   * 以结构化解析视图替代（上游字段 Bytes 的内容形态偏差已在测试锚定说明）。
   */
  private serveDnsQuery(method: string, query: Record<string, string>, headers: Record<string, string>): HttpResponse {
    if (method !== 'GET') {
      return jsonResponse(405, headers, textBody('only GET allowed\n'));
    }
    const denied = this.requireWrite(headers, 'dns-query');
    if (denied !== null) {
      return denied;
    }
    const name: string | undefined = query['name'];
    if (name === undefined || name === '') {
      return jsonResponse(400, headers, textBody('missing name\n'));
    }
    let qtype: number = 1; // dnsmessage.TypeA 缺省
    const typeText: string | undefined = query['type'];
    if (typeText !== undefined && typeText !== '') {
      const parsed: number | null = dnsMessageTypeForString(typeText);
      if (parsed === null) {
        return jsonResponse(400, headers, textBody('unknown DNS message type: ' + typeText + '\n'));
      }
      qtype = parsed;
    }
    if (this.backend.resolver === null) {
      return jsonResponse(500, headers, textBody('no resolver\n'));
    }
    const out = this.backend.resolver.query(name, qtype);
    const payload: Record<string, unknown> = {
      RCode: out.rcode,
      Negative: out.negative,
      Answers: out.answers,
      Resolvers: out.forwardResolvers === null ? [] : out.forwardResolvers,
    };
    return jsonResponse(200, headers, textBody(JSON.stringify(payload) + '\n'));
  }
}

/** 全掩码视图（start 的 UpdatePrefs 完整 Prefs 语义；逐字段提取，禁 spread）。 */
function maskedPrefsFromPartial(update: Partial<IpnPrefs>): MaskedPrefsView {
  const prefs: IpnPrefs = defaultIpnPrefs();
  if (update.ControlURL !== undefined) {
    prefs.ControlURL = update.ControlURL;
  }
  if (update.CorpDNS !== undefined) {
    prefs.CorpDNS = update.CorpDNS;
  }
  if (update.WantRunning !== undefined) {
    prefs.WantRunning = update.WantRunning;
  }
  if (update.Hostname !== undefined) {
    prefs.Hostname = update.Hostname;
  }
  if (update.ShieldsUp !== undefined) {
    prefs.ShieldsUp = update.ShieldsUp;
  }
  if (update.LoggedOut !== undefined) {
    prefs.LoggedOut = update.LoggedOut;
  }
  if (update.RouteAll !== undefined) {
    prefs.RouteAll = update.RouteAll;
  }
  if (update.AdvertiseTags !== undefined) {
    prefs.AdvertiseTags = update.AdvertiseTags.slice();
  }
  if (update.AdvertiseRoutes !== undefined) {
    prefs.AdvertiseRoutes = update.AdvertiseRoutes.slice();
  }
  if (update.ExitNodeID !== undefined) {
    prefs.ExitNodeID = update.ExitNodeID;
  }
  const mask: IpnPrefsMask = {
    ControlURLSet: true,
    CorpDNSSet: true,
    WantRunningSet: true,
    HostnameSet: true,
    ShieldsUpSet: true,
    LoggedOutSet: true,
    RouteAllSet: true,
    AdvertiseTagsSet: true,
    AdvertiseRoutesSet: true,
    ExitNodeIDSet: true,
  };
  const out: MaskedPrefsView = { prefs: prefs, mask: mask };
  return out;
}

/** BasicAuth 口令段解码（base64 user:pass 的 mock 简化：只解 user:pass 明文）。 */
function decodeBasicPassword(b64: string): string {
  const table: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean: string = b64.replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer: number = 0;
  let bits: number = 0;
  for (let i: number = 0; i < clean.length; i += 1) {
    const v: number = table.indexOf(clean.charAt(i));
    if (v < 0) {
      return '';
    }
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  let out: string = '';
  let colonSeen: boolean = false;
  for (const b of bytes) {
    if (!colonSeen) {
      if (b === 0x3a) {
        colonSeen = true;
        continue;
      }
      continue; // 跳过 user 段
    }
    out += String.fromCharCode(b);
  }
  return out;
}

/** mock 客户端便捷调用：一律经 control.buildLocalApiRequest（Host 纪律在库里）。 */
export const callLocalApi = (
  server: MockLocalApiServer,
  method: string,
  url: string,
  body: Uint8Array,
  extraHeaders?: Record<string, string>,
): HttpResponse => {
  const req: HttpRequest = buildLocalApiRequest(method, url, body);
  if (extraHeaders !== undefined) {
    const keys: string[] = Object.keys(extraHeaders);
    for (const k of keys) {
      const v: string | undefined = extraHeaders[k];
      if (v !== undefined) {
        req.headers[k] = v;
      }
    }
  }
  return server.handle(req);
};

/** 逐行 Notify 解析帮助（测试断言用；line → IpnNotify）。 */
export const parseNotifyLine = (line: string): IpnNotify => {
  return decodeIpnNotifyLine(line);
};
