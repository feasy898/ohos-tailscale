/**
 * app/bridge 公开入口（壳侧 TS 桥）。
 *
 * 八块：
 * - mock 注入层：MockHttpTransport（脚本化 HttpTransport）+ MockControlPlane（ts2021 假控制面）；
 * - mock 数据面：UdpDatagramBus（确定性 mock UDP + NAT 仿真）+ MockStunServer（STUN Binding 服务端）；
 * - 壳状态模型：ShellSessionState/ShellConnState/ShellStatus（Index.ets ConnState 镜像）；
 * - 壳会话门面：ShellControlSession（装配校验 + login/pollMap/statusSnapshot/close + authKey 纪律）；
 * - 壳发现面：ShellDiscoClient（disco Ping/Pong/CallMeMaybe 打洞会话）+ ShellStunProbe（STUN 公网映射探测）；
 * - 壳 LocalAPI/IPC 面（C3）：MockIpnBackend（状态机+prefs+bus）+ MockLocalApiServer（HTTP 形态）
 *   + callLocalApi（客户端纪律：Host local-tailscaled.sock / 无 Referer/Origin）；
 * - 壳 PeerAPI 面（C3）：MockPeerApiServer（HTTP-over-WG 明文面 + 授权链 + ExitDNS 注入）；
 * - 壳 TUN 数据面（C3）：FakeTunDevice/MemoryTunDevice（NewFake 无 fd 桩）+ TsTunWrapper
 *   （cork/过滤/注入）+ TunCable（双端内存网线）。
 * 真机实现（@ohos.net.http / @ohos.net.socket + protect(fd) / cryptoFramework 包装）按 README-app.md §4 替换 mock 即可。
 */

export {
  MockBodyStream,
  MockHttpTransport,
  type MockRoute,
  type MockRouteHandler,
  type MockRouteParams,
} from './mock-http-transport.ts';

export { MockControlPlane } from './mock-control-plane.ts';

export {
  mapIp16FromV4,
  MockStunServer,
  parseEndpoint,
  UdpDatagramBus,
  UdpSocket,
  type EndpointParts,
  type UdpInbound,
  type UdpSocketParams,
} from './mock-udp-bus.ts';

export {
  ShellDiscoClient,
  ShellDiscoEventKind,
  ShellStunProbe,
  type ShellDiscoClientParams,
  type ShellDiscoEvent,
  type ShellDiscoEventKindE,
  type ShellStunProbeParams,
  type ShellStunResult,
} from './shell-discovery.ts';

export {
  buildDetail,
  idleStatus,
  ShellConnState,
  ShellSessionState,
  uiConnStateOf,
  type ShellConnStateE,
  type ShellSessionStateE,
  type ShellStatus,
} from './shell-status.ts';

export { ShellControlSession, type ShellSessionParams } from './shell-session.ts';

// ---- C3：LocalAPI/IPC + PeerAPI + TUN 数据面 mock 接线 ----

export {
  MOCK_TAILSCALE_CAP,
  MOCK_TAILSCALE_VERSION,
  MockIpnBackend,
  MockIpnWatch,
  MockLocalApiServer,
  callLocalApi,
  parseNotifyLine,
  type MockLocalApiParams,
} from './mock-localapi.ts';

export {
  MockPeerApiServer,
  advertisePeerApiServices,
  peerApiBaseFor,
  peerCanProxyDnsFor,
  type DnsAnswerFn,
  type MockPeerApiConfig,
  type MockPeerApiRequest,
  type MockPeerApiResponse,
} from './mock-peerapi.ts';

export {
  FakeTunDevice,
  MemoryTunDevice,
  TsTunWrapper,
  TunCable,
  TUN_FAKE_MTU,
  TUN_FAKE_NAME,
  TunEventBits,
  type TunDevice,
  type TunEventBitsE,
} from './mock-tun.ts';
