/**
 * disco UDP relay 家族（0x04–0x09）编解码测试。
 *
 * 锚定方式（研究笔记 §7 P-11）：relay 家族无官方 KAT 向量，整帧 hex 断言按
 * docs/research/2026-10-02-B1-disco-relay.md §3 布局表（每字段行号锚定上游
 * disco.go）独立手工组帧后写死——含 u32/u64 BE 端序、v4-mapped IP、u16be
 * 端口；另覆盖 encode→decode 往返、§4.3 表逐条 errShort/宽松 ver 行为、
 * bind 握手状态机（disco.go:312-338）与 P-5 的 encode/decode N=0 非对称。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayRng, hexDecode, hexEncode } from '@ohos-tailscale/common';
import { x25519PublicKeyFromPrivate } from '@ohos-tailscale/crypto';
import {
  DiscoBindUDPRelayHandshake,
  DiscoBindUDPRelayHandshakeState,
  DiscoError,
  DiscoMessageType,
  DiscoRelayMessageType,
  allocateUDPRelayEndpointRequestEncode,
  allocateUDPRelayEndpointRequestParse,
  allocateUDPRelayEndpointResponseEncode,
  allocateUDPRelayEndpointResponseParse,
  bindUDPRelayAnswerEncode,
  bindUDPRelayAnswerParse,
  bindUDPRelayChallengeEchoed,
  bindUDPRelayChallengeEncode,
  bindUDPRelayChallengeParse,
  bindUDPRelayEndpointEncode,
  bindUDPRelayEndpointParse,
  callMeMaybeViaEncode,
  callMeMaybeViaParse,
  discoMessageParse,
  discoOpen,
  discoSeal,
  ip16IsV4Mapped,
  newBindUDPRelayHandshakeGeneration,
  parseDiscoBindUDPRelayHandshakeState,
  udpRelayEndpointEncode,
  udpRelayEndpointParse,
  unmapIp16,
  type DiscoBindUDPRelayEndpoint,
  type DiscoSealed,
  type DiscoUDPRelayEndpoint,
  type DiscoUnsealed,
} from '../src/index.ts';

/** 32B 递增序列（start..start+31），键位锚定可读。 */
function seqBytes(start: number): Uint8Array {
  const out: Uint8Array = new Uint8Array(32);
  for (let i: number = 0; i < 32; i += 1) {
    out[i] = (start + i) & 0xff;
  }
  return out;
}

const REMOTE_KEY: Uint8Array = seqBytes(0x01); // 01..20
const CHALLENGE: Uint8Array = seqBytes(0x21); // 21..40
const SERVER_DISCO: Uint8Array = seqBytes(0x10); // 10..2f
const CLIENT_DISCO_0: Uint8Array = seqBytes(0x30); // 30..4f
const CLIENT_DISCO_1: Uint8Array = seqBytes(0x50); // 50..6f
const EP0_IP16: Uint8Array = hexDecode('00000000000000000000ffffc6336415'); // ::ffff:198.51.100.21（v4-mapped）
const EP1_IP16: Uint8Array = hexDecode('20010db8000000000000000000000001');

/** 独立锚点帧（手工组帧所得，勿改动字节）：0x04 bind 帧 = 2B 头 + VNI/Gen u32be + 2×32B。 */
const BIND_FRAME_HEX: string =
  '0400a1b2c3d411223344' +
  '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20' +
  '2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40';

/** 独立锚点帧：UDPRelayEndpoint 裸块（124B 基块 + 2×18B 端点 = 160B）。 */
const ENDPOINT_BLOCK_HEX: string =
  '101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f' +
  '303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f' +
  '505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f' +
  '0102030405060708' + // LamportID u64be
  '0000beef' + // VNI u32be
  '0000001bf08eb000' + // BindLifetime u64be = 120000000000 ns（120s，超 2^32 必须 bigint）
  '00000045d964b800' + // SteadyStateLifetime u64be = 300000000000 ns
  '00000000000000000000ffffc6336415a2a9' + // 端点0：v4-mapped + 端口 41641 u16be
  '20010db800000000000000000000000101bb'; // 端点1：IPv6 + 端口 443 u16be

const BIND_COMMON: DiscoBindUDPRelayEndpoint = {
  vni: 0xa1b2c3d4,
  generation: 0x11223344,
  remoteKey: REMOTE_KEY,
  challenge: CHALLENGE,
};

const ENDPOINT: DiscoUDPRelayEndpoint = {
  serverDisco: SERVER_DISCO,
  clientDisco: [CLIENT_DISCO_0, CLIENT_DISCO_1],
  lamportId: 0x0102030405060708n,
  vni: 0xbeef,
  bindLifetime: 120000000000n,
  steadyStateLifetime: 300000000000n,
  addrPorts: [
    { ip16: EP0_IP16, port: 41641 },
    { ip16: EP1_IP16, port: 443 },
  ],
};

function assertDiscoError(e: unknown, code: string): boolean {
  return e instanceof DiscoError && e.code === code;
}

test('relay 家族类型码表锚定：0x04–0x09（disco.go:44-54）', () => {
  assert.equal(DiscoMessageType.BindUDPRelayEndpoint, 0x04);
  assert.equal(DiscoMessageType.BindUDPRelayEndpointChallenge, 0x05);
  assert.equal(DiscoMessageType.BindUDPRelayEndpointAnswer, 0x06);
  assert.equal(DiscoMessageType.CallMeMaybeVia, 0x07);
  assert.equal(DiscoMessageType.AllocateUDPRelayEndpointRequest, 0x08);
  assert.equal(DiscoMessageType.AllocateUDPRelayEndpointResponse, 0x09);
  // messages.ts 全表与 relay.ts 家族表同源（单一事实源，防漂移）
  assert.equal(DiscoMessageType.BindUDPRelayEndpoint, DiscoRelayMessageType.BindUDPRelayEndpoint);
  assert.equal(DiscoMessageType.CallMeMaybeVia, DiscoRelayMessageType.CallMeMaybeVia);
  assert.equal(DiscoMessageType.AllocateUDPRelayEndpointResponse, DiscoRelayMessageType.AllocateUDPRelayEndpointResponse);
});

test('0x04 Bind 编码：74B 等长帧整帧 hex 断言（u32be VNI/Generation + Challenge 等长填充）', () => {
  const frame: Uint8Array = bindUDPRelayEndpointEncode(BIND_COMMON);
  assert.equal(frame.length, 2 + 72, '上游 bind 握手三报文等长设计：2B 头 + 72B 公共块');
  assert.equal(hexEncode(frame), BIND_FRAME_HEX, '整帧 = type‖ver‖VNI u32be‖Generation u32be‖RemoteKey 32B‖Challenge 32B');
  // P-3：0x04 的 Challenge 字段是纯填充，但必须原样写出（disco.go:366-369），
  // 砍掉它即破坏三种握手报文的等长设计（帧内偏移 = 2B 头 + 4+4+32 = 42）
  assert.equal(hexEncode(frame.slice(42, 74)), hexEncode(CHALLENGE));
});

test('0x04/0x05/0x06 三种 bind 报文仅类型字节不同（等长帧，disco.go:405-409/427-431/448-452）', () => {
  const bind: Uint8Array = bindUDPRelayEndpointEncode(BIND_COMMON);
  const challenge: Uint8Array = bindUDPRelayChallengeEncode(BIND_COMMON);
  const answer: Uint8Array = bindUDPRelayAnswerEncode(BIND_COMMON);
  assert.equal(challenge.length, 74);
  assert.equal(answer.length, 74);
  assert.equal(challenge[0], 0x05);
  assert.equal(answer[0], 0x06);
  assert.equal(hexEncode(challenge.slice(1)), hexEncode(bind.slice(1)), '除 type 字节外逐字节相同');
});

test('bind 家族编解码往返：VNI/Generation/RemoteKey/Challenge 原样往返', () => {
  const backBind: DiscoBindUDPRelayEndpoint = bindUDPRelayEndpointParse(bindUDPRelayEndpointEncode(BIND_COMMON));
  assert.equal(backBind.vni, 0xa1b2c3d4);
  assert.equal(backBind.generation, 0x11223344);
  assert.equal(hexEncode(backBind.remoteKey), hexEncode(REMOTE_KEY));
  assert.equal(hexEncode(backBind.challenge), hexEncode(CHALLENGE));

  const backChallenge: DiscoBindUDPRelayEndpoint = bindUDPRelayChallengeParse(
    bindUDPRelayChallengeEncode(BIND_COMMON),
  );
  assert.equal(hexEncode(backChallenge.challenge), hexEncode(CHALLENGE));
  const backAnswer: DiscoBindUDPRelayEndpoint = bindUDPRelayAnswerParse(bindUDPRelayAnswerEncode(BIND_COMMON));
  assert.equal(backAnswer.generation, 0x11223344);
});

test('bind 家族解析完全不检查 version 字节（disco.go:411-418 宽松语义，P-4 非对称）', () => {
  // 注意：0x07/0x08/0x09 在 ver≠0 时返回空消息，bind 家族则是照常解析——
  // 两种语义并存是上游原样事实，不得统一
  const frame: Uint8Array = bindUDPRelayEndpointEncode(BIND_COMMON);
  frame[1] = 0xff;
  const back: DiscoBindUDPRelayEndpoint = bindUDPRelayEndpointParse(frame);
  assert.equal(back.vni, 0xa1b2c3d4, 'ver=0xff 仍按 v0 布局解析');
  assert.equal(hexEncode(back.remoteKey), hexEncode(REMOTE_KEY));
});

test('bind 家族解析对超长尾部宽松：只读前 72B 载荷（Go decode 切片语义）', () => {
  const frame: Uint8Array = bindUDPRelayChallengeEncode(BIND_COMMON);
  const withTail: Uint8Array = new Uint8Array(frame.length + 5);
  withTail.set(frame, 0);
  withTail[withTail.length - 1] = 0xaa; // 尾部脏字节
  const back: DiscoBindUDPRelayEndpoint = bindUDPRelayChallengeParse(withTail);
  assert.equal(back.vni, 0xa1b2c3d4);
  assert.equal(hexEncode(back.challenge), hexEncode(CHALLENGE), '尾部 5B 不影响 Challenge 字段');
});

test('bind 家族解析：载荷 <72B 抛 SHORT（disco.go:384-397 → errShort）', () => {
  assert.throws((): void => { bindUDPRelayAnswerParse(new Uint8Array(2 + 71)); },
    (e: unknown): boolean => assertDiscoError(e, 'SHORT'));
  assert.throws((): void => { bindUDPRelayEndpointParse(new Uint8Array(2)); },
    (e: unknown): boolean => assertDiscoError(e, 'SHORT'));
  // 边界：74B（恰好 72B 载荷）合法
  const frame: Uint8Array = bindUDPRelayAnswerEncode(BIND_COMMON);
  assert.doesNotThrow((): void => { bindUDPRelayAnswerParse(frame); });
  // 类型字节不符抛 TYPE
  const wrongType: Uint8Array = frame.slice();
  wrongType[0] = 0x03;
  assert.throws((): void => { bindUDPRelayAnswerParse(wrongType); },
    (e: unknown): boolean => assertDiscoError(e, 'TYPE'));
});

test('UDPRelayEndpoint 编码：124B 基块 + 18N 端点整块 hex 断言（u64be bigint 槽位 + BE 端序）', () => {
  const block: Uint8Array = udpRelayEndpointEncode(ENDPOINT);
  assert.equal(block.length, 124 + 18 * 2);
  assert.equal(hexEncode(block), ENDPOINT_BLOCK_HEX);
  // u64 槽位必须 BigInt（P6/R8）：120s = 120×10⁹ ns 已超 2³²，number 位宽假设即错
  assert.equal(ENDPOINT.bindLifetime, 120000000000n);
  assert.equal(hexEncode(block.slice(96, 104)), '0102030405060708', 'LamportID u64be');
  assert.equal(hexEncode(block.slice(104, 108)), '0000beef', 'VNI u32be');
  assert.equal(hexEncode(block.slice(108, 116)), '0000001bf08eb000', 'BindLifetime u64be 纳秒');
});

test('UDPRelayEndpoint 往返：bigint 槽位 >2^32 原样保留，v4-mapped 线上原样', () => {
  const back: DiscoUDPRelayEndpoint = udpRelayEndpointParse(udpRelayEndpointEncode(ENDPOINT));
  assert.equal(hexEncode(back.serverDisco), hexEncode(SERVER_DISCO));
  assert.equal(back.clientDisco.length, 2);
  assert.equal(hexEncode(back.clientDisco[0]), hexEncode(CLIENT_DISCO_0));
  assert.equal(hexEncode(back.clientDisco[1]), hexEncode(CLIENT_DISCO_1));
  assert.equal(back.lamportId, 0x0102030405060708n);
  assert.equal(back.vni, 0xbeef);
  assert.equal(back.bindLifetime, 120000000000n);
  assert.equal(back.steadyStateLifetime, 300000000000n);
  assert.equal(back.addrPorts.length, 2);
  assert.equal(hexEncode(back.addrPorts[0].ip16), hexEncode(EP0_IP16), 'ip16 保持线上 v4-mapped 原样');
  assert.ok(ip16IsV4Mapped(back.addrPorts[0].ip16));
  assert.equal(hexEncode(unmapIp16(back.addrPorts[0].ip16)), 'c6336415', 'unmapIp16 得 198.51.100.21');
  assert.equal(back.addrPorts[0].port, 41641);
  assert.equal(hexEncode(back.addrPorts[1].ip16), hexEncode(EP1_IP16));
  assert.equal(back.addrPorts[1].port, 443);
});

test('UDPRelayEndpoint 解析：N=0 / <142B / 非 18 对齐 → SHORT（decode 要求 N≥1，disco.go:595）', () => {
  const block: Uint8Array = hexDecode(ENDPOINT_BLOCK_HEX);
  // 124B：只有基块、零端点 → N=0 拒绝（P-5）
  assert.throws((): void => { udpRelayEndpointParse(block.slice(0, 124)); },
    (e: unknown): boolean => assertDiscoError(e, 'SHORT'));
  // 141B：不足 124+18
  assert.throws((): void => { udpRelayEndpointParse(block.slice(0, 141)); },
    (e: unknown): boolean => assertDiscoError(e, 'SHORT'));
  // 159B：124+35，35 非 18 倍数
  assert.throws((): void => { udpRelayEndpointParse(block.slice(0, 159)); },
    (e: unknown): boolean => assertDiscoError(e, 'SHORT'));
});

test('0x07 CallMeMaybeVia 编码：整帧 hex（2+124+18N）+ 往返（仅经 DERP 的通道语义）', () => {
  const frame: Uint8Array = callMeMaybeViaEncode({ endpoint: ENDPOINT });
  assert.equal(frame.length, 2 + 124 + 18 * 2);
  assert.equal(hexEncode(frame), '0700' + ENDPOINT_BLOCK_HEX, '头 = type 0x07 ‖ ver 0，其后为裸块');
  const back: ReturnType<typeof callMeMaybeViaParse> = callMeMaybeViaParse(frame);
  assert.equal(back.endpoint.lamportId, 0x0102030405060708n);
  assert.equal(back.endpoint.addrPorts.length, 2);
  assert.equal(hexEncode(back.endpoint.serverDisco), hexEncode(SERVER_DISCO));
});

test('0x07 encode 允许 N=0 而 decode 拒绝（上游 AppendMarshal/decode 非对称，P-5 勿修）', () => {
  const noEps: DiscoUDPRelayEndpoint = {
    serverDisco: SERVER_DISCO,
    clientDisco: [CLIENT_DISCO_0, CLIENT_DISCO_1],
    lamportId: 7n,
    vni: 1,
    bindLifetime: 0n,
    steadyStateLifetime: 0n,
    addrPorts: [],
  };
  // encode 允许 N=0（disco.go:644-649 无下限）
  const frame: Uint8Array = callMeMaybeViaEncode({ endpoint: noEps });
  assert.equal(frame.length, 2 + 124);
  // decode 拒绝 N=0（disco.go:595 要求 ≥124+18）——这是上游原样事实，不是 bug
  assert.throws((): void => { callMeMaybeViaParse(frame); },
    (e: unknown): boolean => assertDiscoError(e, 'SHORT'));
});

test('0x07 ver≠0 → 返回零值消息且不报错（disco.go:651-658 宽松版本语义）', () => {
  const frame: Uint8Array = callMeMaybeViaEncode({ endpoint: ENDPOINT });
  frame[1] = 0x01;
  const back: ReturnType<typeof callMeMaybeViaParse> = callMeMaybeViaParse(frame);
  // Go 零值镜像：零键 + 零数值 + 空端点表
  assert.equal(hexEncode(back.endpoint.serverDisco), '00'.repeat(32));
  assert.equal(back.endpoint.clientDisco.length, 2);
  assert.equal(hexEncode(back.endpoint.clientDisco[0]), '00'.repeat(32));
  assert.equal(back.endpoint.lamportId, 0n);
  assert.equal(back.endpoint.vni, 0);
  assert.equal(back.endpoint.bindLifetime, 0n);
  assert.equal(back.endpoint.addrPorts.length, 0);
});

test('0x08 Allocate 请求编码：70B 整帧 hex + 往返（disco.go:480-489 字段序）', () => {
  const frame: Uint8Array = allocateUDPRelayEndpointRequestEncode({
    clientDisco: [CLIENT_DISCO_0, CLIENT_DISCO_1],
    generation: 7,
  });
  assert.equal(frame.length, 2 + 68, 'allocateUDPRelayEndpointRequestLen=68 + 2B 头（disco.go:475-478）');
  assert.equal(
    hexEncode(frame),
    '0800' +
    '303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f' +
    '505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f' +
    '00000007',
    'ClientDisco[0]‖ClientDisco[1]‖Generation u32be',
  );
  const back: ReturnType<typeof allocateUDPRelayEndpointRequestParse> = allocateUDPRelayEndpointRequestParse(frame);
  assert.equal(back.clientDisco.length, 2);
  assert.equal(hexEncode(back.clientDisco[0]), hexEncode(CLIENT_DISCO_0));
  assert.equal(hexEncode(back.clientDisco[1]), hexEncode(CLIENT_DISCO_1));
  assert.equal(back.generation, 7);
});

test('0x08 ver≠0 → 零值消息不报错；载荷 <68B 抛 SHORT（disco.go:491-505）', () => {
  const good: Uint8Array = allocateUDPRelayEndpointRequestEncode({
    clientDisco: [CLIENT_DISCO_0, CLIENT_DISCO_1],
    generation: 7,
  });
  const badVer: Uint8Array = good.slice();
  badVer[1] = 0x02;
  const back: ReturnType<typeof allocateUDPRelayEndpointRequestParse> = allocateUDPRelayEndpointRequestParse(badVer);
  assert.equal(back.generation, 0, 'ver≠0 返回零值请求');
  assert.equal(hexEncode(back.clientDisco[0]), '00'.repeat(32));

  assert.throws((): void => { allocateUDPRelayEndpointRequestParse(good.slice(0, 2 + 67)); },
    (e: unknown): boolean => assertDiscoError(e, 'SHORT'));
  // 超长尾部宽松（只读前 68B 载荷）
  const withTail: Uint8Array = new Uint8Array(good.length + 3);
  withTail.set(good, 0);
  assert.doesNotThrow((): void => { allocateUDPRelayEndpointRequestParse(withTail); });
});

test('0x08 编码校验：clientDisco 数量≠2 或键长≠32 → RANGE（上游 [2]DiscoPublic 定长）', () => {
  assert.throws((): void => {
    allocateUDPRelayEndpointRequestEncode({ clientDisco: [CLIENT_DISCO_0], generation: 1 });
  }, (e: unknown): boolean => assertDiscoError(e, 'RANGE'));
  assert.throws((): void => {
    allocateUDPRelayEndpointRequestEncode({ clientDisco: [new Uint8Array(31), CLIENT_DISCO_1], generation: 1 });
  }, (e: unknown): boolean => assertDiscoError(e, 'RANGE'));
  assert.throws((): void => {
    bindUDPRelayEndpointEncode({ vni: 1, generation: 1, remoteKey: new Uint8Array(31), challenge: CHALLENGE });
  }, (e: unknown): boolean => assertDiscoError(e, 'RANGE'));
});

test('0x09 Allocate 响应编码：130+18N 整帧 hex，Generation 紧随头部（disco.go:517-524）', () => {
  const frame: Uint8Array = allocateUDPRelayEndpointResponseEncode({ generation: 42, endpoint: ENDPOINT });
  assert.equal(frame.length, 2 + 4 + 124 + 18 * 2);
  assert.equal(hexEncode(frame), '09000000002a' + ENDPOINT_BLOCK_HEX, 'type‖ver‖Generation u32be‖endpoint 裸块');
  const back: ReturnType<typeof allocateUDPRelayEndpointResponseParse> = allocateUDPRelayEndpointResponseParse(frame);
  assert.equal(back.generation, 42, 'Generation 必须可回显 0x08 的请求代次（disco.go:510-513）');
  assert.equal(back.endpoint.lamportId, 0x0102030405060708n);
  assert.equal(back.endpoint.addrPorts.length, 2);
  assert.equal(hexEncode(back.endpoint.addrPorts[1].ip16), hexEncode(EP1_IP16));
});

test('0x09 ver≠0 → 零值不报错；两段式 SHORT：<4B 或 Generation 后端点段不齐（disco.go:526-537）', () => {
  const good: Uint8Array = allocateUDPRelayEndpointResponseEncode({ generation: 42, endpoint: ENDPOINT });
  const badVer: Uint8Array = good.slice();
  badVer[1] = 0x7f;
  const back: ReturnType<typeof allocateUDPRelayEndpointResponseParse> = allocateUDPRelayEndpointResponseParse(badVer);
  assert.equal(back.generation, 0);
  assert.equal(back.endpoint.serverDisco.length, 32);
  assert.equal(hexEncode(back.endpoint.serverDisco), '00'.repeat(32));

  // 第一段：<4B 载荷 → SHORT
  assert.throws((): void => { allocateUDPRelayEndpointResponseParse(good.slice(0, 4)); },
    (e: unknown): boolean => assertDiscoError(e, 'SHORT'));
  // 第二段：Generation 合法但其后端点段 124B（N=0）→ endpoint decode 再抛 SHORT
  const nulBlock: Uint8Array = udpRelayEndpointEncode({
    serverDisco: SERVER_DISCO,
    clientDisco: [CLIENT_DISCO_0, CLIENT_DISCO_1],
    lamportId: 0n,
    vni: 0,
    bindLifetime: 0n,
    steadyStateLifetime: 0n,
    addrPorts: [],
  });
  const two: Uint8Array = new Uint8Array(2 + 4 + nulBlock.length);
  two[0] = 0x09;
  two.set(nulBlock, 6);
  assert.throws((): void => { allocateUDPRelayEndpointResponseParse(two); },
    (e: unknown): boolean => assertDiscoError(e, 'SHORT'));
});

test('discoMessageParse 分发 relay 家族 6 类型；未知类型 0x0A 仍抛 TYPE（P-8 可丢弃）', () => {
  const bindMsg: ReturnType<typeof discoMessageParse> = discoMessageParse(bindUDPRelayEndpointEncode(BIND_COMMON));
  assert.equal(bindMsg.kind, DiscoMessageType.BindUDPRelayEndpoint);
  assert.ok(bindMsg.bindUDPRelayEndpoint !== null && bindMsg.bindUDPRelayEndpoint.vni === 0xa1b2c3d4);
  assert.ok(bindMsg.callMeMaybeVia === null);

  const chMsg: ReturnType<typeof discoMessageParse> = discoMessageParse(bindUDPRelayChallengeEncode(BIND_COMMON));
  assert.equal(chMsg.kind, DiscoMessageType.BindUDPRelayEndpointChallenge);
  assert.ok(chMsg.bindUDPRelayChallenge !== null);

  const anMsg: ReturnType<typeof discoMessageParse> = discoMessageParse(bindUDPRelayAnswerEncode(BIND_COMMON));
  assert.equal(anMsg.kind, DiscoMessageType.BindUDPRelayEndpointAnswer);
  assert.ok(anMsg.bindUDPRelayAnswer !== null);

  const viaMsg: ReturnType<typeof discoMessageParse> = discoMessageParse(callMeMaybeViaEncode({ endpoint: ENDPOINT }));
  assert.equal(viaMsg.kind, DiscoMessageType.CallMeMaybeVia);
  assert.ok(viaMsg.callMeMaybeVia !== null && viaMsg.callMeMaybeVia.endpoint.vni === 0xbeef);

  const reqMsg: ReturnType<typeof discoMessageParse> = discoMessageParse(
    allocateUDPRelayEndpointRequestEncode({ clientDisco: [CLIENT_DISCO_0, CLIENT_DISCO_1], generation: 7 }),
  );
  assert.equal(reqMsg.kind, DiscoMessageType.AllocateUDPRelayEndpointRequest);
  assert.ok(reqMsg.allocateUDPRelayRequest !== null && reqMsg.allocateUDPRelayRequest.generation === 7);

  const respMsg: ReturnType<typeof discoMessageParse> = discoMessageParse(
    allocateUDPRelayEndpointResponseEncode({ generation: 42, endpoint: ENDPOINT }),
  );
  assert.equal(respMsg.kind, DiscoMessageType.AllocateUDPRelayEndpointResponse);
  assert.ok(respMsg.allocateUDPRelayResponse !== null);

  // 未来类型（0x0A）走 unknown message type 路径（disco.go:106-107），调用方静默丢弃
  const future: Uint8Array = new Uint8Array(8);
  future[0] = 0x0a;
  assert.throws((): void => { discoMessageParse(future); },
    (e: unknown): boolean => assertDiscoError(e, 'TYPE'));
});

test('relay 家族经 discoSeal/discoOpen 密封往返（与 0x01–0x03 同一 wrapper 密封层）', () => {
  const aPriv: Uint8Array = new Uint8Array(32).fill(0x11);
  const bPriv: Uint8Array = new Uint8Array(32).fill(0x22);
  const bPub: Uint8Array = x25519PublicKeyFromPrivate(bPriv);
  const nonce: Uint8Array = hexDecode('000102030405060708090a0b0c0d0e0f1011121314151617');
  const inner: Uint8Array = callMeMaybeViaEncode({ endpoint: ENDPOINT });
  const sealed: DiscoSealed = discoSeal(inner, aPriv, bPub, nonce);
  // wrapper 布局不变：6 magic ‖ 32 发端 disco 公钥 ‖ 24 nonce ‖ tag‖密文（P-7：nonce 不双拼）
  assert.equal(sealed.wrapper.length, 62 + inner.length + 16);
  assert.equal(hexEncode(sealed.wrapper.slice(0, 6)), '5453f09f92ac');
  const opened: DiscoUnsealed | null = discoOpen(sealed.wrapper, bPriv);
  assert.ok(opened !== null);
  const msg: ReturnType<typeof discoMessageParse> = discoMessageParse(opened.message);
  assert.equal(msg.kind, DiscoMessageType.CallMeMaybeVia);
  assert.ok(msg.callMeMaybeVia !== null);
  assert.equal(msg.callMeMaybeVia.endpoint.bindLifetime, 120000000000n);
  assert.equal(msg.callMeMaybeVia.endpoint.addrPorts.length, 2);
});

test('bind 握手状态机·客户端：Init→BindSent→AnswerSent（disco.go:319-332）', () => {
  const hs: DiscoBindUDPRelayHandshake = new DiscoBindUDPRelayHandshake();
  assert.equal(hs.state, DiscoBindUDPRelayHandshakeState.Init);
  hs.onSentBindEndpoint(); // 发出 0x04
  assert.equal(hs.state, DiscoBindUDPRelayHandshakeState.BindSent);
  hs.onSentAnswer(); // 收到 0x05 后回出 0x06
  assert.equal(hs.state, DiscoBindUDPRelayHandshakeState.AnswerSent);
});

test('bind 握手状态机·服务端：仅 Challenge 正确回显才迁移 AnswerReceived（disco.go:333-337、364-366）', () => {
  const hs: DiscoBindUDPRelayHandshake = new DiscoBindUDPRelayHandshake();
  hs.onSentChallenge(); // 收到 0x04 并回出 0x05
  assert.equal(hs.state, DiscoBindUDPRelayHandshakeState.ChallengeSent);
  // 错误回显：不迁移、不抛错（错误 Answer 不推进握手）
  const wrong: DiscoBindUDPRelayEndpoint = {
    vni: 0xa1b2c3d4,
    generation: 0x11223344,
    remoteKey: REMOTE_KEY,
    challenge: new Uint8Array(32),
  };
  assert.equal(hs.onReceivedAnswer(wrong, CHALLENGE), false);
  assert.equal(hs.state, DiscoBindUDPRelayHandshakeState.ChallengeSent);
  // 正确回显
  const right: DiscoBindUDPRelayEndpoint = {
    vni: 0xa1b2c3d4,
    generation: 0x11223344,
    remoteKey: REMOTE_KEY,
    challenge: CHALLENGE,
  };
  assert.ok(bindUDPRelayChallengeEchoed(right, CHALLENGE));
  assert.equal(hs.onReceivedAnswer(right, CHALLENGE), true);
  assert.equal(hs.state, DiscoBindUDPRelayHandshakeState.AnswerReceived);
});

test('bind 握手状态机：非法迁移抛 RANGE（本仓裁定：不做隐式状态修复，P-10 同取向）', () => {
  const hs: DiscoBindUDPRelayHandshake = new DiscoBindUDPRelayHandshake();
  assert.throws((): void => { hs.onSentAnswer(); },
    (e: unknown): boolean => assertDiscoError(e, 'RANGE'), 'Init 不能直接发 Answer');
  hs.onSentBindEndpoint();
  assert.throws((): void => { hs.onSentBindEndpoint(); },
    (e: unknown): boolean => assertDiscoError(e, 'RANGE'), 'BindSent 不能重复发 Bind');
  assert.throws((): void => { hs.onSentChallenge(); },
    (e: unknown): boolean => assertDiscoError(e, 'RANGE'), '客户端态不能走服务端迁移');
  const server: DiscoBindUDPRelayHandshake = new DiscoBindUDPRelayHandshake();
  assert.throws((): void => { server.onReceivedAnswer(BIND_COMMON, CHALLENGE); },
    (e: unknown): boolean => assertDiscoError(e, 'RANGE'), '未出 Challenge 不能收 Answer');
});

test('握手状态常量值 = 上游 iota 序 0..4（disco.go:318-338）+ 校验函数', () => {
  assert.equal(DiscoBindUDPRelayHandshakeState.Init, 0);
  assert.equal(DiscoBindUDPRelayHandshakeState.BindSent, 1);
  assert.equal(DiscoBindUDPRelayHandshakeState.ChallengeSent, 2);
  assert.equal(DiscoBindUDPRelayHandshakeState.AnswerSent, 3);
  assert.equal(DiscoBindUDPRelayHandshakeState.AnswerReceived, 4);
  assert.equal(parseDiscoBindUDPRelayHandshakeState(3), 3);
  assert.equal(parseDiscoBindUDPRelayHandshakeState(5), null, '0..4 之外非法');
  assert.equal(parseDiscoBindUDPRelayHandshakeState(-1), null);
  assert.equal(parseDiscoBindUDPRelayHandshakeState(255), null);
});

test('newBindUDPRelayHandshakeGeneration：经注入 Rng 取非零 u32（P4；全零重取、无符号组装）', () => {
  // 前 4B 全零（Generation 禁零）→ 重取，后 4B = 01 02 03 04
  const pool: Uint8Array = new Uint8Array(8);
  pool.set([0x01, 0x02, 0x03, 0x04], 4);
  const g1: number = newBindUDPRelayHandshakeGeneration(new ArrayRng(pool));
  assert.equal(g1, 0x01020304, 'u32be 手工组装');
  // 0xffffffff 组装为 4294967295，不得出现 << 符号位负数
  const g2: number = newBindUDPRelayHandshakeGeneration(
    new ArrayRng(new Uint8Array([0xff, 0xff, 0xff, 0xff])),
  );
  assert.equal(g2, 4294967295);
  assert.ok(g2 > 0);
});
