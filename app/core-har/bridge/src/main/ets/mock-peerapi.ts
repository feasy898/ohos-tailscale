/**
 * MockPeerApiServer —— HTTP-over-WireGuard 节点间 API 的壳侧 mock 面。
 *
 * 载体裁定：真机形态 = netstack 截获 TCP 后直通 peerapi（Android 同构，
 * peerapi.go:1033-1045——「通告端口 + 用户态分发」即可，无需内核 listener）；
 * mock 以进程内函数调用表达该分发（发起侧不做真实 TCP over WG）。
 *
 * 协议语义全部经 @ohos-tailscale/control 的 peerapi.ts（v1.102.3 实拉对齐）：
 * - validatePeerAPIRequest：Referer/Origin 恒拒、Host 'peer'/'ip:port'（MasqAddr
 *   亦合法，peerapi.go:262-297）；
 * - 明文 HTTP（无 TLS）、每连接独立（:209-214）；
 * - 路由（:358-429）：'/' →「Hello, <peer 显示名>」页；/dns-query → ExitDNS；
 * - /dns-query：RFC 8484 DoH 语义跑在明文 HTTP-over-WG 上（:754-755）；GET
 *   调试形态 ?q=<name>&t=<type>（:817-850）；授权链 replyToDNSQueries（:683-752）；
 *   wire dns-message 打包不在 mock 范围（返回结构化解析视图，偏差在测试锚定）。
 *   mock 的 t 参数仅支持 a/aaaa（未知值回落 A——上游对未知 t 回 400，mock 简化
 *   为宽松解析，语义偏差在测试锚定）；
 * - 对端发现：peerAPIBase 按本机地址族选 peerapi4/6（:994-1020）；通告端口 1
 *   （假监听器）合法（:1022-1066）——对端永远以 Hostinfo.Services 为准。
 *
 * 解析核注入：ExitDNS 的名字应答以 answerDns 函数注入（适配 ResolverCore），
 * 本文件不直接持有解析器——服务只管授权链与请求形态，与 MagicDNS 核解耦。
 */

import {
  DnsType,
  peerApiAddrIsValid,
  peerApiBase,
  peerApiPortsOf,
  peerCanProxyDNS,
  replyToDnsQueries,
  validatePeerApiRequest,
  type DnsResolveOutcome,
  type PeerApiListenerView,
  type PeerApiRequestView,
  type TailcfgServiceView,
} from '@ohos-tailscale/control';

/** PeerAPI mock 请求视图（明文 HTTP/1 请求头子集 + 已解析的 URL 参数）。 */
export interface MockPeerApiRequest {
  method: string;
  host: string;
  referer: string;
  origin: string;
  path: string;
  /** URL 参数表（?q=&t= 已按 & 与 = 切分）。 */
  params: Record<string, string>;
  /** true = 来源 peer 与 self 同用户（isSelf，peerapi.go:203）。 */
  isSelfQuery?: boolean;
}

/** PeerAPI mock 响应（明文 HTTP；无 TLS）。 */
export interface MockPeerApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** ExitDNS 的名字应答入口（注入；生产装配 = ResolverCore 的适配）。 */
export type DnsAnswerFn = (name: string, qtype: number) => DnsResolveOutcome;

/** mock 服务装配参数（self 侧视图）。 */
export interface MockPeerApiConfig {
  /** 对端显示名（'/' 的问候页）。 */
  displayName: string;
  /** self 地址 prefix 列表（Host 校验与 isAddressValid 用）。 */
  selfAddressPrefixes: string[];
  /** self 对该 peer 的 MasqAddr（4via6/伪装；'' = 无）。 */
  masqV4: string;
  masqV6: string;
  /** self 的 PeerAPI 监听表（端口推导结果；假监听器端口 1 合法）。 */
  listeners: PeerApiListenerView[];
  /** ExitDNS 应答入口（null = DNS 能力关闭，/dns-query 回 503）。 */
  answerDns: DnsAnswerFn | null;
  /** 本机是否 offers exit node / app connector（授权链输入）。 */
  offersExitNodeOrAppConnector: boolean;
  /** PacketFilter 是否放行 remote → :53（filter.CheckTCP 的预判定输入）。 */
  filterAcceptsTcp53: boolean;
}

/** 组装 self 的 Services 通告（peerapi4/6 + PeerAPIDNS 标记）。 */
export const advertisePeerApiServices = (listeners: PeerApiListenerView[]): TailcfgServiceView[] => {
  const svcs: TailcfgServiceView[] = [];
  for (const ln of listeners) {
    const is6: boolean = ln.ip.indexOf(':') >= 0;
    const svc: TailcfgServiceView = { proto: is6 ? 'peerapi6' : 'peerapi4', port: ln.port };
    svcs.push(svc);
  }
  const dnsSvc: TailcfgServiceView = { proto: 'peerapi-dns-proxy', port: 1 };
  svcs.push(dnsSvc);
  return svcs;
};

/**
 * 发起侧视图：从 peer 的 Services 与 self 地址族推导 peerAPIBase（URL 语义）。
 * 返回 '' = 对端 PeerAPI 不可达（两族端口皆缺或 self 族不匹配）。
 */
export const peerApiBaseFor = (
  selfHave4: boolean,
  selfHave6: boolean,
  peerV4: string,
  peerV6: string,
  services: TailcfgServiceView[],
): string => {
  return peerApiBase(selfHave4, selfHave6, peerV4, peerV6, peerApiPortsOf(services));
};

/** ExitDNS 资格的组合判定（peerCanProxyDNS 的桥接：cap 或 Services 词表）。 */
export const peerCanProxyDnsFor = (capVersion: number, services: TailcfgServiceView[]): boolean => {
  return peerCanProxyDNS(capVersion, services);
};

/** MockPeerApiServer —— 一端 peer 节点的 PeerAPI 服务（netstack 分发后的入口）。 */
export class MockPeerApiServer {
  private config: MockPeerApiConfig;

  public constructor(config: MockPeerApiConfig) {
    this.config = config;
  }

  /** 处理一个请求（netstack 截获 TCP 后直通的等价入口）。 */
  public handle(req: MockPeerApiRequest): MockPeerApiResponse {
    // validatePeerAPIRequest（peerapi.go:289-297）：Referer/Origin/Host。
    const view: PeerApiRequestView = {
      method: req.method,
      host: req.host,
      referer: req.referer,
      origin: req.origin,
      path: req.path,
    };
    const invalid: string | null = validatePeerApiRequest(
      view,
      (addr): boolean => peerApiAddrIsValid(addr, this.config.masqV4, this.config.masqV6, this.config.selfAddressPrefixes),
    );
    if (invalid !== null) {
      // 校验失败文案不回显请求输入（Referer/Origin/Host 细节只进服务端日志面）。
      return this.text(403, 'invalid peerapi request');
    }

    if (req.path === '/') {
      // peerapi.go:414-428：'/' 返回「Hello, <peer 显示名>」页。
      const greetParts: string[] = ['Hello, ', this.config.displayName];
      return this.text(200, greetParts.join(''));
    }
    if (req.path === '/dns-query') {
      return this.serveExitDns(req);
    }
    return this.text(404, '404 page not found');
  }

  /**
   * /dns-query（peerapi.go:380-384, :683-852）：授权链 → GET 调试形态 ?q=&t=。
   * POST wire DoH 返回 501（dns-message 打包属二期）。
   */
  private serveExitDns(req: MockPeerApiRequest): MockPeerApiResponse {
    // 授权链（:683-752）：isSelf 恒答；否则 exit/app-connector + PacketFilter 放行 :53。
    if (!replyToDnsQueries(req.isSelfQuery === true, this.config.offersExitNodeOrAppConnector, this.config.filterAcceptsTcp53)) {
      return this.text(403, 'DNS not permitted for this peer');
    }
    if (req.method === 'POST') {
      return this.text(501, 'wire dns-message packing not in mock scope');
    }
    if (this.config.answerDns === null) {
      return this.text(503, 'DNS feature unavailable');
    }
    const fields: Record<string, string> = req.params;
    const name: string | undefined = fields['q'];
    if (name === undefined || name === '') {
      return this.text(400, 'missing q');
    }
    // 输入校验（mock-peerapi → control ResolverCore 跨包污点边界）：
    //  1) 长度上限 253B（单 FQDN 最长 253 字节，per RFC 1035 §2.3.4）；超长直接拒绝。
    //  2) 字符集收紧到 RFC 1035 LDH + .：仅 [A-Za-z0-9._-]；不含空字节/控制符；
    //     mock 不解析 IDN/punycode/转义，超集字符一律拒绝而非透传给 answerDns。
    //  3) 拒绝 `..` 段（FQDN 禁止 ..，路径前缀敏感）；允许末尾 `.`（absolute FQDN，RFC 1035 §3.1）；
    //     不允许以 `.` 开头（label 必须以字母或数字开头/结尾，RFC 1123 §2.1）。
    // Mimosa 误判为 SQL 注入——本路径无 SQL 字符串拼接，仅是函数调用；
    // 但跨文件污点（用户输入 → ResolverCore）是真的，故显式校验兜底。
    // 污点复审结论（2026-10-06，全 sink 逐点核过）：误报——污点 name 在 ResolverCore.query
    // （control/src/magicdns.ts:737）只进纯字符串变换（toLowerCase/withTrailingDot）、
    // hosts Map **读**（:765 get，构造期键写入全部来自 config 派生值 :700-722）、
    // endsWith 后缀判定（:126-141，无 RegExp 构造 → 无 ReDoS）；应答经 JSON.stringify
    // 序列化（本文件 :195），无注入语境；PTR 反解路径 mock 不可达（qtype 仅 A/AAAA）。
    // 本校验保留为纵深防御（边界收口后污点不再越过 LDH 形态）；攻击样例
    // q=__proto__（过白名单直达 Map 读）见 peerapi-tun.test.ts 跨包污点边界用例。
    if (
      name.length === 0 ||
      name.length > 253 ||
      !/^[A-Za-z0-9._-]+$/.test(name) ||
      name.includes('..') ||
      name.startsWith('.')
    ) {
      return this.text(400, 'malformed q');
    }
    let qtype: number = DnsType.A;
    if (fields['t'] === 'aaaa') {
      qtype = DnsType.AAAA;
    }
    const out: DnsResolveOutcome = this.config.answerDns(name, qtype);
    const payload: Record<string, unknown> = { RCode: out.rcode, Negative: out.negative, Answers: out.answers };
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const resp: MockPeerApiResponse = { status: 200, headers: headers, body: JSON.stringify(payload) };
    return resp;
  }

  private text(status: number, body: string): MockPeerApiResponse {
    const resp: MockPeerApiResponse = { status: status, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: body };
    return resp;
  }
}
