/**
 * LocalAPI/IPC 接口面 —— HTTP/1.1+JSON over 本地字节流（unix socket/命名管道）的
 * 请求解析与响应构造纯逻辑（C3 子线）。
 *
 * ✅ 上游核对（v1.102.3 tag 实拉逐行核对，2026-10-03 本会话复拉验证；行号均指该 tag）：
 * - 传输形态：普通 HTTP/1.1 + JSON 承载在 safesocket（safesocket.go:86-90 分派），
 *   ipnserver 用标准 http.Server 服务（server.go:503-548）；协议语义层（URL/方法/JSON）
 *   与载体解耦（oracle 曾经 127.0.0.1 HTTP 代理访问成功，protocol-notes.md:47-50）。
 * - 客户端 Host 头约定 "local-tailscaled.sock"（client/tailscale/apitype/apitype.go:13-14
 *   LocalAPIHost）；服务端 validHost 只接受空、该常量、以及 RequiredPassword 非空时的
 *   localhost/loopback（localapi.go:285-306）；任何 Referer/Origin → 403
 *   "invalid localapi request"（:249-252）。响应恒带 Tailscale-Version/Tailscale-Cap
 *   + CSP/X-Frame-Options: DENY/X-Content-Type-Options: nosniff（:253-258）。
 * - 路由（:314-345 handlerForPath）："/" → 根；必须前缀 "/localapi/v0/"；先精确匹配
 *   handler 表（:71-97 静态 + :99-165 条件注册），再按「首个 '/' 前缀含尾斜杠键」
 *   前缀匹配（如 "profiles/"）。非安全方法（非 GET/HEAD/OPTIONS）记一行
 *   "localapi: [METHOD] route"（:338-345）。
 * - 端点权限（各 handler 体）：status/watch-ipn-bus/dns-config/peer-by-id/user-profile/
 *   whois = PermitRead；prefs GET/HEAD=Read、PATCH 另需 Write；check-prefs/start/
 *   login-interactive/logout = Write；**dns-query = Write（隐私考量，:1752-1756，
 *   仅 GET，非 GET → 405）；derpmap/ping 无检查**。
 * - watch-ipn-bus（:893-933）：mask 文本 UnmarshalText=strconv.ParseUint(base10)
 *   （backend.go:264-271，十进制字符串），失败 → 400 "bad mask"；
 *   NotifyInProcessNoDisconnect(1<<16) 对 HTTP 客户端恒 400（:905-908）；
 *   ValidateNotifyWatchOpt：NotifyRateLimit(1<<8) 与新式位
 *   PeerChanges|NoNetMap|InitialStatus|PeerPatches 互斥 → 400（backend.go:273-290）。
 *   响应 Content-Type application/json，**每行一个 ipn.Notify JSON**（:920-933）。
 * - ipn.Notify（backend.go:300-481）：SessionID 仅首条携带（:304-308，omitzero，
 *   "Clients must store it on their side"）；State 指针非 nil 才编码；PeerChangedPatch/
 *   PeersChanged/PeersRemoved omitzero；未知 PeerChange 字段用 peer-by-id 兜底（:367-371）。
 * - mask 位表（backend.go:82-195，值=十进制）：见 NotifyWatchOptBits。
 * - ipn.State（backend.go:27-49）：NoState=0..Running=6 + stateStrings 数组。
 * - MaskedPrefs（ipn-prefs.go:356-393 + ApplyEdits :417-437）：PATCH 体是
 *   Prefs 内嵌 + 每 field 一个 XxxSet 掩码位（Go 匿名内嵌 → JSON 字段平铺）；
 *   ApplyEdits 只拷贝 XxxSet==true 的字段；LocalAPI 无整对象 PUT（servePrefs 仅
 *   GET/HEAD/PATCH 三分支，:1004-1036）。
 * - 状态机副作用（ipn/ipnlocal/local.go:6724-6808 enterStateLocked）：每次转移先
 *   sendLocked(Notify{State})（仅 old!=new，:6771）；离开 Running 关 PeerAPI
 *   （:6754-6759）；NeedsLogin 封引擎更新（:6779）并 fallthrough 到 Stopped/NoState
 *   → Reconfig 三份空配置（:6781-6787）；Starting/NeedsMachineAuth → authReconfig
 *   （:6792-6795）。
 * - /dns-query 类型表（:1783-1816 dnsMessageTypeForString）：AAAA/ALL/A/CNAME/HINFO/
 *   MINFO/MX/NS/OPT/PTR/SOA/SRV/TXT/WKS（数值为 RFC 1035/标准 DNS 类型码，
 *   即 Go dnsmessage.Type* 别名值）；响应 apitype.DNSQueryResponse{Bytes,Resolvers}。
 * - /status（:844-859）：?peers=（FormValue 默认 true）→ ipnstate.Status JSON，
 *   SetIndent("", "\t") 制表缩进。
 *
 * JSON 边界（R3 演进口径）：R3 原文「JSON 只允许出现在 app/ 侧 LocalAPI 展示层」，
 * AU3 核对后增补 tailcfg.ts 为控制面 JSON 落点，C1 增补 netmap.ts（同口径头注）。
 * 本模块为 LocalAPI/IPC 的 JSON 协议语义落点（第三处同族延伸，理由：本包是
 * LocalAPI 协议语义的唯一家，拆去 app/ 会把端点表/掩码语义/Notify 词表散落到
 * 展示层无法机检）。JSON.parse 返回值一律立即 `as` 到具名 interface；
 * 编码一律经具名 interface + JSON.stringify（undefined 字段 = omit-empty）。
 */

import { type HttpRequest } from '@ohos-tailscale/common';
import { DnsType } from './magicdns.ts';
import { ControlError } from './errors.ts';

/** 客户端约定的 Host 头值（apitype.go:13-14 LocalAPIHost）。 */
export const LOCAL_API_HOST: string = 'local-tailscaled.sock';

/** 默认 socket 路径（paths/paths.go:24-49；鸿蒙壳可自由选本地 IPC 载体，语义层不变）。 */
export const LOCAL_API_DEFAULT_SOCKET_PATH_LINUX: string = '/var/run/tailscale/tailscaled.sock';

// ---- ipn.State（backend.go:27-49） ----

export interface IpnStateE {
  NoState: number;
  InUseOtherUser: number;
  NeedsLogin: number;
  NeedsMachineAuth: number;
  Stopped: number;
  Starting: number;
  Running: number;
}

export const IpnState: IpnStateE = {
  NoState: 0,
  InUseOtherUser: 1,
  NeedsLogin: 2,
  NeedsMachineAuth: 3,
  Stopped: 4,
  Starting: 5,
  Running: 6,
};

/** stateStrings（backend.go:41-49 数组；status JSON 的 BackendState 用它）。 */
export function ipnStateToString(state: number): string {
  const names: string[] = ['NoState', 'InUseOtherUser', 'NeedsLogin', 'NeedsMachineAuth', 'Stopped', 'Starting', 'Running'];
  if (!Number.isInteger(state) || state < 0 || state >= names.length) {
    return 'unknown';
  }
  return names[state];
}

/** StateFromString（backend.go:50 附近）：未知返回 null。 */
export function parseIpnState(s: string): number | null {
  const names: string[] = ['NoState', 'InUseOtherUser', 'NeedsLogin', 'NeedsMachineAuth', 'Stopped', 'Starting', 'Running'];
  for (let i: number = 0; i < names.length; i += 1) {
    if (names[i] === s) {
      return i;
    }
  }
  return null;
}

// ---- watch-ipn-bus mask（backend.go:82-195, 264-290） ----

export interface NotifyWatchOptBitsE {
  WatchEngineUpdates: number;
  InitialState: number;
  InitialPrefs: number;
  InitialNetMap: number;
  NoPrivateKeys: number;
  InitialDriveShares: number;
  InitialOutgoingFiles: number;
  InitialHealthState: number;
  RateLimit: number;
  HealthActions: number;
  InitialSuggestedExitNode: number;
  InitialClientVersion: number;
  PeerChanges: number;
  NoNetMap: number;
  InitialStatus: number;
  PeerPatches: number;
  InProcessNoDisconnect: number;
  SysPolicyChanges: number;
  PeerWireGuardState: number;
}

/** 位值 = 十进制（backend.go:82-195 `1 << n` 逐项）。 */
export const NotifyWatchOptBits: NotifyWatchOptBitsE = {
  WatchEngineUpdates: 1,          // 1<<0
  InitialState: 2,                // 1<<1
  InitialPrefs: 4,                // 1<<2
  InitialNetMap: 8,               // 1<<3（遗留）
  NoPrivateKeys: 16,              // 1<<4（no-op，恒脱敏）
  InitialDriveShares: 32,         // 1<<5
  InitialOutgoingFiles: 64,       // 1<<6
  InitialHealthState: 128,        // 1<<7
  RateLimit: 256,                 // 1<<8（与新式位互斥）
  HealthActions: 512,             // 1<<9
  InitialSuggestedExitNode: 1024, // 1<<10
  InitialClientVersion: 2048,     // 1<<11
  PeerChanges: 4096,              // 1<<12（不设则 peer 增删不上 bus）
  NoNetMap: 8192,                 // 1<<13
  InitialStatus: 16384,           // 1<<14（新式快照，优先用它）
  PeerPatches: 32768,             // 1<<15（窄字段 patch；蕴含 PeerChanges）
  InProcessNoDisconnect: 65536,   // 1<<16（仅进程内；LocalAPI 恒 400）
  SysPolicyChanges: 131072,       // 1<<17
  PeerWireGuardState: 262144,     // 1<<18
};

const MAX_UINT64_BI: bigint = 18446744073709551615n;

/**
 * ParseNotifyWatchOpt（backend.go:264-271 UnmarshalText）：十进制字符串 → 数值。
 * 非十进制/超 uint64 → ControlError（服务端形态即 400 "bad mask"）。
 * 已知位最高 1<<18，返回 number 安全；>2^53 的合法 uint64 值高位不影响语义。
 */
export function parseNotifyWatchMask(text: string): number {
  if (!/^\d+$/.test(text)) {
    throw new ControlError('HTTP', 'bad mask') as Error;
  }
  const v: bigint = BigInt(text);
  if (v > MAX_UINT64_BI) {
    throw new ControlError('HTTP', 'bad mask') as Error;
  }
  return Number(v);
}

/**
 * ValidateNotifyWatchOpt 的 LocalAPI 形态（backend.go:273-290 + localapi.go:905-912）。
 * 返回 null = 合法；否则返回错误文本（服务端以 400 + 该文本回）。
 * ①NotifyInProcessNoDisconnect 仅进程内订阅者，HTTP 客户端恒非法；
 * ②NotifyRateLimit 与新式位 PeerChanges|NoNetMap|InitialStatus|PeerPatches 互斥。
 */
export function validateNotifyWatchMask(mask: number): string | null {
  if ((mask & NotifyWatchOptBits.InProcessNoDisconnect) !== 0) {
    return 'NotifyInProcessNoDisconnect is only valid for in-process IPN bus subscribers';
  }
  const incompatible: number =
    NotifyWatchOptBits.PeerChanges | NotifyWatchOptBits.NoNetMap | NotifyWatchOptBits.InitialStatus | NotifyWatchOptBits.PeerPatches;
  if ((mask & NotifyWatchOptBits.RateLimit) !== 0 && (mask & incompatible) !== 0) {
    return 'NotifyRateLimit is incompatible with new-style IPN bus subscription bits';
  }
  return null;
}

// ---- 路由表与请求行解析（localapi.go:71-165, 314-345） ----

/** 端点权限位（各 handler 首行的 PermitRead/PermitWrite 检查；None=无检查）。 */
export interface LocalApiPermitE {
  None: number;
  Read: number;
  Write: number;
}

export const LocalApiPermit: LocalApiPermitE = { None: 0, Read: 1, Write: 2 };

export interface LocalApiRouteInfo {
  /** "/localapi/v0/" 之后的键（前缀键含尾斜杠）。 */
  name: string;
  permit: number;
  /** true = 前缀匹配键（如 "profiles/"）。 */
  prefix: boolean;
}

const ROUTE_TABLE: LocalApiRouteInfo[] = [
  // 前缀匹配键（localapi.go:73 "The prefix match handlers end with a slash"）。
  { name: 'profiles/', permit: LocalApiPermit.Read, prefix: true },
  // 精确键（localapi.go:74-97 静态表 + :99-165 条件注册表；权限取各 handler 体首行）。
  { name: 'cert-domains', permit: LocalApiPermit.Read, prefix: false },
  { name: 'check-prefs', permit: LocalApiPermit.Write, prefix: false },
  { name: 'check-so-mark-in-use', permit: LocalApiPermit.Read, prefix: false },
  { name: 'derpmap', permit: LocalApiPermit.None, prefix: false },
  { name: 'dns-config', permit: LocalApiPermit.Read, prefix: false },
  { name: 'dns-query', permit: LocalApiPermit.Write, prefix: false },
  { name: 'goroutines', permit: LocalApiPermit.Read, prefix: false },
  { name: 'login-interactive', permit: LocalApiPermit.Write, prefix: false },
  { name: 'logout', permit: LocalApiPermit.Write, prefix: false },
  { name: 'peer-by-id', permit: LocalApiPermit.Read, prefix: false },
  { name: 'ping', permit: LocalApiPermit.None, prefix: false },
  { name: 'prefs', permit: LocalApiPermit.Read, prefix: false },
  { name: 'reload-config', permit: LocalApiPermit.Write, prefix: false },
  { name: 'reset-auth', permit: LocalApiPermit.Write, prefix: false },
  { name: 'services', permit: LocalApiPermit.Read, prefix: false },
  { name: 'set-expiry-sooner', permit: LocalApiPermit.Write, prefix: false },
  { name: 'shutdown', permit: LocalApiPermit.None, prefix: false },
  { name: 'start', permit: LocalApiPermit.Write, prefix: false },
  { name: 'status', permit: LocalApiPermit.Read, prefix: false },
  { name: 'user-profile', permit: LocalApiPermit.Read, prefix: false },
  { name: 'watch-ipn-bus', permit: LocalApiPermit.Read, prefix: false },
  { name: 'whois', permit: LocalApiPermit.Read, prefix: false },
];

/** 端点是否在注册表内（条件注册表一并视为已知——mock 覆盖全量语义）。 */
export function isKnownLocalApiRoute(route: string): boolean {
  for (const r of ROUTE_TABLE) {
    if (r.name === route) {
      return true;
    }
  }
  return false;
}

/** 路由的权限要求（未知路由 null）。 */
export function localApiRoutePermit(route: string): number | null {
  for (const r of ROUTE_TABLE) {
    if (r.name === route) {
      return r.permit;
    }
  }
  return null;
}

/** handlerForPath 的解析结果（localapi.go:314-335）。 */
export interface LocalApiTarget {
  /** '' = 根路径 "/"；否则为路由键（精确名或含尾斜杠前缀名）。 */
  route: string;
  isRoot: boolean;
}

/**
 * handlerForPath（localapi.go:314-335）："// 精确后缀 → 前缀（截首个 '/' 含之）"。
 * 非 /localapi/v0/ 前缀 → null（404 形态）。
 */
export function parseLocalApiTarget(urlPath: string): LocalApiTarget | null {
  if (urlPath === '/') {
    const root: LocalApiTarget = { route: '', isRoot: true };
    return root;
  }
  const prefix: string = '/localapi/v0/';
  if (urlPath.length <= prefix.length || urlPath.slice(0, prefix.length) !== prefix) {
    return null;
  }
  let suff: string = urlPath.slice(prefix.length);
  if (isKnownLocalApiRoute(suff)) {
    const hit: LocalApiTarget = { route: suff, isRoot: false };
    return hit;
  }
  const slash: number = suff.indexOf('/');
  if (slash >= 0) {
    suff = suff.slice(0, slash + 1);
    if (isKnownLocalApiRoute(suff)) {
      const hit: LocalApiTarget = { route: suff, isRoot: false };
      return hit;
    }
  }
  return null;
}

/** 安全方法不记日志（localapi.go:338-345 logRequest）。 */
export function isSafeHttpMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

/** logRequest 文本（非安全方法："localapi: [METHOD] /localapi/v0/<route>"）。 */
export function localApiLogLine(method: string, route: string): string | null {
  if (isSafeHttpMethod(method)) {
    return null;
  }
  return 'localapi: [' + method + '] /localapi/v0/' + route;
}

// ---- 请求守卫与响应头（localapi.go:249-258, 285-306） ----

/**
 * serveHTTP 首段守卫（:249-271）：任何 Referer/Origin、或 Host 非法 → 403
 * "invalid localapi request"；RequiredPassword 非空时要求 BasicAuth（缺失 → 401
 * "auth required"；口令不符 → 403 "bad password"）。返回 null = 放行。
 */
export function checkLocalApiGuards(
  host: string,
  referer: string,
  origin: string,
  requiredPassword: string,
  basicAuthPassword: string,
  basicAuthProvided: boolean,
): LocalApiGuardResult | null {
  if (referer !== '' || origin !== '' || !localApiValidHost(host, requiredPassword)) {
    const out: LocalApiGuardResult = { status: 403, body: 'invalid localapi request' };
    return out;
  }
  if (requiredPassword !== '') {
    if (!basicAuthProvided) {
      const out: LocalApiGuardResult = { status: 401, body: 'auth required' };
      return out;
    }
    if (!constTimeEqualText(basicAuthPassword, requiredPassword)) {
      const out: LocalApiGuardResult = { status: 403, body: 'bad password' };
      return out;
    }
  }
  return null;
}

export interface LocalApiGuardResult {
  status: number;
  body: string;
}

/**
 * validHost（localapi.go:285-306）：'' 或 apitype.LocalAPIHost 恒可；
 * localhost/loopback 仅 RequiredPassword 非空时可（"only allow localhost with
 * basic auth or in tests"）。
 */
export function localApiValidHost(hostname: string, requiredPassword: string): boolean {
  if (hostname === '' || hostname === LOCAL_API_HOST) {
    return true;
  }
  if (requiredPassword === '') {
    return false;
  }
  // net.SplitHostPort 语义：v6 须为 "[h]:p" 形态；无端口的裸地址报错 → false。
  let hostPart: string = '';
  if (hostname.charAt(0) === '[') {
    const close: number = hostname.indexOf(']');
    if (close < 0 || hostname.charAt(close + 1) !== ':') {
      return false;
    }
    hostPart = hostname.slice(1, close);
  } else {
    const colon: number = hostname.lastIndexOf(':');
    if (colon < 0) {
      return false;
    }
    hostPart = hostname.slice(0, colon);
  }
  if (hostPart === 'localhost') {
    return true;
  }
  return isLoopbackText(hostPart);
}

function isLoopbackText(host: string): boolean {
  if (host === '::1') {
    return true;
  }
  const parts: string[] = host.split('.');
  if (parts.length !== 4) {
    return false;
  }
  const first: number = Number(parts[0]);
  return Number.isInteger(first) && first === 127;
}

/** 常时字符串比较（对齐 subtle.ConstantTimeCompare 的语义：等长逐字节）。 */
function constTimeEqualText(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff: number = 0;
  for (let i: number = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * serveHTTP 的固定响应头（:253-258）：版本/capver + 安全三件套。
 * headers 键为小写（common HttpResponse 响应键约定）。
 */
export function localApiBaseHeaders(version: string, capVer: number): Record<string, string> {
  const headers: Record<string, string> = {};
  headers['content-type'] = 'application/json';
  headers['tailscale-version'] = version;
  headers['tailscale-cap'] = String(capVer);
  headers['content-security-policy'] = "default-src 'none'; frame-ancestors 'none'; script-src 'none'; script-src-elem 'none'; script-src-attr 'none'";
  headers['x-frame-options'] = 'DENY';
  headers['x-content-type-options'] = 'nosniff';
  return headers;
}

// ---- URL 查询参数（Go r.FormValue 语义子集） ----

/** 解析 URL 查询串为键值表（首个 '=' 分割；'+' 视为空格；%XX 解码失败保留原文）。 */
export function parseUrlQuery(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q: number = url.indexOf('?');
  if (q < 0) {
    return out;
  }
  const query: string = url.slice(q + 1);
  const parts: string[] = query.split('&');
  for (const part of parts) {
    if (part === '') {
      continue;
    }
    const eq: number = part.indexOf('=');
    let rawKey: string = part;
    let rawValue: string = '';
    if (eq >= 0) {
      rawKey = part.slice(0, eq);
      rawValue = part.slice(eq + 1);
    }
    out[decodeQueryComponent(rawKey)] = decodeQueryComponent(rawValue.replace(/\+/g, ' '));
  }
  return out;
}

function decodeQueryComponent(s: string): string {
  if (s.indexOf('%') < 0) {
    return s;
  }
  const bytes: number[] = [];
  let i: number = 0;
  while (i < s.length) {
    const ch: string = s.charAt(i);
    if (ch === '%' && i + 2 < s.length) {
      const hex: string = s.slice(i + 1, i + 3);
      const v: number = Number.parseInt(hex, 16);
      if (!Number.isNaN(v)) {
        bytes.push(v);
        i += 3;
        continue;
      }
    }
    const code: number = s.charCodeAt(i);
    bytes.push(code & 0xff);
    i += 1;
  }
  let out: string = '';
  for (const b of bytes) {
    out += String.fromCharCode(b);
  }
  return out;
}

/** FormValue 缺省语义（如 status 的 ?peers= 缺省 true，localapi.go:849）。 */
export function queryBool(query: Record<string, string>, key: string, dflt: boolean): boolean {
  const v: string | undefined = query[key];
  if (v === undefined || v === '') {
    return dflt;
  }
  return v !== '0' && v !== 'false';
}

// ---- 客户端请求构造（apitype.go:13-14 + localapi.go:285-306 的对偶） ----

/**
 * 构造一个 LocalAPI 客户端请求：Host 必须 "local-tailscaled.sock"、
 * 不得携带 Referer/Origin（服务端 403 线）。url 为完整路径（含查询串）。
 */
export function buildLocalApiRequest(method: string, url: string, body: Uint8Array): HttpRequest {
  const headers: Record<string, string> = {};
  headers['host'] = LOCAL_API_HOST;
  const req: HttpRequest = { method: method, url: url, headers: headers, body: body };
  return req;
}

// ---- prefs / MaskedPrefs（ipn-prefs.go） ----

/** DefaultControlURL（ipn-prefs.go:42）。 */
export const IPN_DEFAULT_CONTROL_URL: string = 'https://controlplane.tailscale.com';

/** ipn.Prefs 的本阶段子集（字段名 = Go 导出名 = JSON 键）。 */
export interface IpnPrefs {
  ControlURL: string;
  CorpDNS: boolean;
  WantRunning: boolean;
  Hostname: string;
  ShieldsUp: boolean;
  LoggedOut: boolean;
  RouteAll: boolean;
  AdvertiseTags: string[];
  AdvertiseRoutes: string[];
  ExitNodeID: string;
}

/** 缺省 Prefs（ipn-prefs.go:747 附近：CorpDNS/WantRunning 缺省 true）。 */
export function defaultIpnPrefs(): IpnPrefs {
  const prefs: IpnPrefs = {
    ControlURL: IPN_DEFAULT_CONTROL_URL,
    CorpDNS: true,
    WantRunning: true,
    Hostname: '',
    ShieldsUp: false,
    LoggedOut: false,
    RouteAll: false,
    AdvertiseTags: [],
    AdvertiseRoutes: [],
    ExitNodeID: '',
  };
  return prefs;
}

/** MaskedPrefs 的 XxxSet 掩码位（ipn-prefs.go:359-393 的本阶段子集）。 */
export interface IpnPrefsMask {
  ControlURLSet: boolean;
  CorpDNSSet: boolean;
  WantRunningSet: boolean;
  HostnameSet: boolean;
  ShieldsUpSet: boolean;
  LoggedOutSet: boolean;
  RouteAllSet: boolean;
  AdvertiseTagsSet: boolean;
  AdvertiseRoutesSet: boolean;
  ExitNodeIDSet: boolean;
}

export interface MaskedPrefsView {
  prefs: IpnPrefs;
  mask: IpnPrefsMask;
}

/** JSON 里 MaskedPrefs 的原样形态（匿名内嵌 → 字段平铺；全部可选）。 */
interface ParsedMaskedPrefsJson {
  ControlURL?: string;
  CorpDNS?: boolean;
  WantRunning?: boolean;
  Hostname?: string;
  ShieldsUp?: boolean;
  LoggedOut?: boolean;
  RouteAll?: boolean;
  AdvertiseTags?: string[];
  AdvertiseRoutes?: string[];
  ExitNodeID?: string;
  ControlURLSet?: boolean;
  CorpDNSSet?: boolean;
  WantRunningSet?: boolean;
  HostnameSet?: boolean;
  ShieldsUpSet?: boolean;
  LoggedOutSet?: boolean;
  RouteAllSet?: boolean;
  AdvertiseTagsSet?: boolean;
  AdvertiseRoutesSet?: boolean;
  ExitNodeIDSet?: boolean;
}

/** 解码 PATCH /prefs 的 MaskedPrefs JSON 体（localapi.go:1014-1018 的解码对偶）。 */
export function decodeMaskedPrefs(jsonText: string): MaskedPrefsView {
  const raw = JSON.parse(jsonText) as ParsedMaskedPrefsJson;
  const prefs: IpnPrefs = {
    ControlURL: typeof raw.ControlURL === 'string' ? raw.ControlURL : '',
    CorpDNS: raw.CorpDNS === true,
    WantRunning: raw.WantRunning === true,
    Hostname: typeof raw.Hostname === 'string' ? raw.Hostname : '',
    ShieldsUp: raw.ShieldsUp === true,
    LoggedOut: raw.LoggedOut === true,
    RouteAll: raw.RouteAll === true,
    AdvertiseTags: raw.AdvertiseTags === undefined || raw.AdvertiseTags === null ? [] : raw.AdvertiseTags,
    AdvertiseRoutes: raw.AdvertiseRoutes === undefined || raw.AdvertiseRoutes === null ? [] : raw.AdvertiseRoutes,
    ExitNodeID: typeof raw.ExitNodeID === 'string' ? raw.ExitNodeID : '',
  };
  const mask: IpnPrefsMask = {
    ControlURLSet: raw.ControlURLSet === true,
    CorpDNSSet: raw.CorpDNSSet === true,
    WantRunningSet: raw.WantRunningSet === true,
    HostnameSet: raw.HostnameSet === true,
    ShieldsUpSet: raw.ShieldsUpSet === true,
    LoggedOutSet: raw.LoggedOutSet === true,
    RouteAllSet: raw.RouteAllSet === true,
    AdvertiseTagsSet: raw.AdvertiseTagsSet === true,
    AdvertiseRoutesSet: raw.AdvertiseRoutesSet === true,
    ExitNodeIDSet: raw.ExitNodeIDSet === true,
  };
  const out: MaskedPrefsView = { prefs: prefs, mask: mask };
  return out;
}

/** Prefs 深拷贝（ApplyEdits 的接收端语义：mutates p——本实现返回新对象）。 */
export function cloneIpnPrefs(p: IpnPrefs): IpnPrefs {
  const out: IpnPrefs = {
    ControlURL: p.ControlURL,
    CorpDNS: p.CorpDNS,
    WantRunning: p.WantRunning,
    Hostname: p.Hostname,
    ShieldsUp: p.ShieldsUp,
    LoggedOut: p.LoggedOut,
    RouteAll: p.RouteAll,
    AdvertiseTags: p.AdvertiseTags.slice(),
    AdvertiseRoutes: p.AdvertiseRoutes.slice(),
    ExitNodeID: p.ExitNodeID,
  };
  return out;
}

/**
 * ApplyEdits（ipn-prefs.go:417-437）：对每个 XxxSet==true 的掩码位，
 * 把 MaskedPrefs.Prefs 的对应字段拷进基础 Prefs；掩码为 false 的字段保持不变。
 */
export function applyMaskedPrefs(base: IpnPrefs, masked: MaskedPrefsView): IpnPrefs {
  const out: IpnPrefs = cloneIpnPrefs(base);
  const src: IpnPrefs = masked.prefs;
  const mask: IpnPrefsMask = masked.mask;
  if (mask.ControlURLSet) {
    out.ControlURL = src.ControlURL;
  }
  if (mask.CorpDNSSet) {
    out.CorpDNS = src.CorpDNS;
  }
  if (mask.WantRunningSet) {
    out.WantRunning = src.WantRunning;
  }
  if (mask.HostnameSet) {
    out.Hostname = src.Hostname;
  }
  if (mask.ShieldsUpSet) {
    out.ShieldsUp = src.ShieldsUp;
  }
  if (mask.LoggedOutSet) {
    out.LoggedOut = src.LoggedOut;
  }
  if (mask.RouteAllSet) {
    out.RouteAll = src.RouteAll;
  }
  if (mask.AdvertiseTagsSet) {
    out.AdvertiseTags = src.AdvertiseTags.slice();
  }
  if (mask.AdvertiseRoutesSet) {
    out.AdvertiseRoutes = src.AdvertiseRoutes.slice();
  }
  if (mask.ExitNodeIDSet) {
    out.ExitNodeID = src.ExitNodeID;
  }
  return out;
}

// ---- ipn.Notify 构造与 JSON 编码（backend.go:300-481） ----

/** tailcfg.Node 的 Notify 词表子集（PeersChanged 元素；消费按 NodeID upsert）。 */
export interface NotifyNodeView {
  ID: number;
  StableID?: string;
  Online?: boolean;
  Hostname?: string;
  Addresses?: string[];
}

/** ipnstate.Status 的 Notify 词表子集（InitialStatus / /status 响应共用）。 */
export interface StatusJsonView {
  Version?: string;
  TUN?: boolean;
  BackendState?: string;
  AuthURL?: string;
  TailscaleIPs?: string[];
  MagicDNSSuffix?: string;
  Health?: string[];
  CertDomains?: string[];
  CurrentTailnet?: CurrentTailnetJsonView;
  Peer?: Record<string, PeerStatusJsonView>;
  User?: Record<string, UserProfileJsonView>;
}

export interface CurrentTailnetJsonView {
  Name?: string;
  MagicDNSSuffix?: string;
  MagicDNSEnabled?: boolean;
}

export interface PeerStatusJsonView {
  DNSName?: string;
  TailscaleIPs?: string[];
  Online?: boolean;
  Relay?: string;
  RxBytes?: number;
  TxBytes?: number;
  PeerAPIURL?: string[];
}

export interface UserProfileJsonView {
  ID?: number;
  LoginName?: string;
  DisplayName?: string;
}

/** ipn.Notify 的构造视图（null/空 = 不编码，对齐 Go 指针/omitzero 语义）。 */
export interface IpnNotify {
  version: string;
  /** 仅会话首条携带（backend.go:304-308）；'' = 不编码。 */
  sessionId: string;
  /** 非空 = ErrMessage。 */
  errMessage: string;
  /** null = State 指针为 nil（不编码）。 */
  state: number | null;
  prefs: IpnPrefs | null;
  initialStatus: StatusJsonView | null;
  selfChange: NotifyNodeView | null;
  peersChanged: NotifyNodeView[];
  /** NodeID 列表（tailcfg.NodeID = int64 JSON number）。 */
  peersRemoved: number[];
  browseToUrl: string;
}

/** 空 Notify（全不携带）。 */
export function emptyIpnNotify(version: string): IpnNotify {
  const n: IpnNotify = {
    version: version,
    sessionId: '',
    errMessage: '',
    state: null,
    prefs: null,
    initialStatus: null,
    selfChange: null,
    peersChanged: [],
    peersRemoved: [],
    browseToUrl: '',
  };
  return n;
}

/** Notify 的 JSON 线上形态（undefined 字段被 JSON.stringify 省略 = omitzero/omitempty）。 */
interface IpnNotifyJson {
  Version?: string;
  SessionID?: string;
  ErrMessage?: string;
  State?: number;
  Prefs?: IpnPrefs;
  InitialStatus?: StatusJsonView;
  SelfChange?: NotifyNodeView;
  PeersChanged?: NotifyNodeView[];
  PeersRemoved?: number[];
  BrowseToURL?: string;
}

/**
 * 单条 Notify → 一行 JSON（json.Encoder.Encode 语义：末尾带 '\n'）。
 * SessionID 仅在非空时编码——调用方必须只在会话首条设置（backend.go:304-308）。
 */
export function encodeIpnNotifyLine(notify: IpnNotify): string {
  const wire: IpnNotifyJson = {};
  if (notify.version !== '') {
    wire.Version = notify.version;
  }
  if (notify.sessionId !== '') {
    wire.SessionID = notify.sessionId;
  }
  if (notify.errMessage !== '') {
    wire.ErrMessage = notify.errMessage;
  }
  if (notify.state !== null) {
    wire.State = notify.state;
  }
  if (notify.prefs !== null) {
    wire.Prefs = notify.prefs;
  }
  if (notify.initialStatus !== null) {
    wire.InitialStatus = notify.initialStatus;
  }
  if (notify.selfChange !== null) {
    wire.SelfChange = notify.selfChange;
  }
  if (notify.peersChanged.length > 0) {
    wire.PeersChanged = notify.peersChanged;
  }
  if (notify.peersRemoved.length > 0) {
    wire.PeersRemoved = notify.peersRemoved;
  }
  if (notify.browseToUrl !== '') {
    wire.BrowseToURL = notify.browseToUrl;
  }
  return JSON.stringify(wire) + '\n';
}

/** 解码一行 Notify JSON（客户端侧；未携字段 = 空值语义同构造视图）。 */
export function decodeIpnNotifyLine(line: string): IpnNotify {
  const raw = JSON.parse(line) as IpnNotifyJson;
  const n: IpnNotify = {
    version: typeof raw.Version === 'string' ? raw.Version : '',
    sessionId: typeof raw.SessionID === 'string' ? raw.SessionID : '',
    errMessage: typeof raw.ErrMessage === 'string' ? raw.ErrMessage : '',
    state: typeof raw.State === 'number' ? raw.State : null,
    prefs: raw.Prefs === undefined || raw.Prefs === null ? null : cloneIpnPrefs(raw.Prefs),
    initialStatus: raw.InitialStatus === undefined || raw.InitialStatus === null ? null : raw.InitialStatus,
    selfChange: raw.SelfChange === undefined || raw.SelfChange === null ? null : raw.SelfChange,
    peersChanged: raw.PeersChanged === undefined || raw.PeersChanged === null ? [] : raw.PeersChanged,
    peersRemoved: raw.PeersRemoved === undefined || raw.PeersRemoved === null ? [] : raw.PeersRemoved,
    browseToUrl: typeof raw.BrowseToURL === 'string' ? raw.BrowseToURL : '',
  };
  return n;
}

/** 逐行 Notify 流拼接（watch-ipn-bus 响应体；每行一条、逐条 flush 的缓冲等价）。 */
export function encodeNotifyStream(lines: string[]): Uint8Array {
  let text: string = '';
  for (const line of lines) {
    text += line;
  }
  return utf8Encode(text);
}

/** 纯 TS UTF-8 编码（本模块只需 ASCII 与常见 UTF-8；不引任何平台内置模块）。 */
function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i: number = 0; i < s.length; i += 1) {
    const code: number = s.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6));
      out.push(0x80 | (code & 0x3f));
    } else {
      out.push(0xe0 | (code >> 12));
      out.push(0x80 | ((code >> 6) & 0x3f));
      out.push(0x80 | (code & 0x3f));
    }
  }
  const bytes: Uint8Array = new Uint8Array(out.length);
  for (let i: number = 0; i < out.length; i += 1) {
    bytes[i] = out[i];
  }
  return bytes;
}

/** /status 响应体（serveStatus：SetIndent("", "\t") 制表缩进）。 */
export function encodeStatusJson(status: StatusJsonView): Uint8Array {
  return utf8Encode(JSON.stringify(status, undefined, '\t'));
}

// ---- /dns-query 类型表（localapi.go:1783-1816） ----

/**
 * dnsMessageTypeForString（localapi.go:1783-1816）：大写化 + TrimSpace 后查表；
 * 数值为标准 DNS 类型码（DnsType）。未知 → null（400 形态）。
 */
export function dnsMessageTypeForString(s: string): number | null {
  const t: string = s.replace(/\s/g, '').toUpperCase();
  if (t === 'A') {
    return DnsType.A;
  }
  if (t === 'AAAA') {
    return DnsType.AAAA;
  }
  if (t === 'ALL') {
    return DnsType.ALL;
  }
  if (t === 'CNAME') {
    return DnsType.CNAME;
  }
  if (t === 'HINFO') {
    return DnsType.HINFO;
  }
  if (t === 'MINFO') {
    return DnsType.MINFO;
  }
  if (t === 'MX') {
    return DnsType.MX;
  }
  if (t === 'NS') {
    return DnsType.NS;
  }
  if (t === 'OPT') {
    return DnsType.OPT;
  }
  if (t === 'PTR') {
    return DnsType.PTR;
  }
  if (t === 'SOA') {
    return DnsType.SOA;
  }
  if (t === 'SRV') {
    return DnsType.SRV;
  }
  if (t === 'TXT') {
    return DnsType.TXT;
  }
  if (t === 'WKS') {
    return DnsType.WKS;
  }
  return null;
}

// ---- 状态机副作用（ipn/ipnlocal/local.go:6724-6808 enterStateLocked） ----

/** 一次状态转移的引擎/监听副作用集合（mock 后端据此驱动数据面）。 */
export interface LocalStateEffect {
  /** sendLocked(Notify{State})：仅 old != new（:6769-6771）。 */
  sendStateNotify: boolean;
  /** blockEngineUpdates(true)：NeedsLogin（:6777-6780）。 */
  blockEngineUpdates: boolean;
  /** Reconfig(&wgcfg.Config{}, &router.Config{}, &dns.Config{})：NeedsLogin(fallthrough)/Stopped/NoState（:6781-6787）。 */
  reconfigEmptyDataPlane: boolean;
  /** authReconfigLocked()：Starting/NeedsMachineAuth（:6792-6795）。 */
  authReconfig: boolean;
  /** closePeerAPIListenersLocked：离开 Running（:6752-6758）。 */
  closePeerApi: boolean;
}

/**
 * enterStateLocked 的可观测副作用推导（local.go:6724-6808 逐分支）。
 * 注意顺序：closePeerApi 与 sendStateNotify 互不影响；old == new 时上游在
 * pauseOrResumeControlClientLocked 后提前 return（:6770-6773），一切副作用为 false。
 */
export function localStateEffect(oldState: number, newState: number): LocalStateEffect {
  const eff: LocalStateEffect = {
    sendStateNotify: false,
    blockEngineUpdates: false,
    reconfigEmptyDataPlane: false,
    authReconfig: false,
    closePeerApi: false,
  };
  if (oldState === newState) {
    return eff;
  }
  eff.sendStateNotify = true;
  if (oldState === IpnState.Running) {
    eff.closePeerApi = true;
  }
  if (newState === IpnState.NeedsLogin) {
    eff.blockEngineUpdates = true;
    // fallthrough 到 Stopped/NoState 分支（Go switch fallthrough，:6781）。
    eff.reconfigEmptyDataPlane = true;
    return eff;
  }
  if (newState === IpnState.Stopped || newState === IpnState.NoState) {
    eff.reconfigEmptyDataPlane = true;
    return eff;
  }
  if (newState === IpnState.Starting || newState === IpnState.NeedsMachineAuth) {
    eff.authReconfig = true;
    return eff;
  }
  return eff;
}
