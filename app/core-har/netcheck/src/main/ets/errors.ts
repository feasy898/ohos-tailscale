/**
 * netcheck 包错误（R7 模式，对齐 derp/control/disco 的错误类形态）。
 *
 * code 集合严格为：
 * - 'NOT_STUN'：非 STUN 报文（上游 ErrNotSTUN）；
 * - 'NOT_SUCCESS'：非 Binding Success 响应（上游 ErrNotSuccessResponse）；
 * - 'NOT_REQUEST'：非 Binding Request（上游 ErrNotBindingRequest）；
 * - 'WRONG_SOFTWARE'：SOFTWARE 非 "tailnode"（上游 ErrWrongSoftware）；
 * - 'NO_FINGERPRINT'：末属性非 FINGERPRINT（上游 ErrNoFingerprint）；
 * - 'WRONG_FINGERPRINT'：CRC32 校验不符（上游 ErrWrongFingerprint）;
 * - 'MALFORMED'：属性区结构损坏（上游 ErrMalformedAttrs）；
 * - 'RANGE'：入参长度校验失败。
 */

export class StunError extends Error {
  public code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * netcheck 引擎调度错误（A25：throw 仅 Error 子类；与 StunError 分列避免
 * 扩大既有 code 集合）。code 集合严格为：
 * - 'STATE'：会话状态非法（并发重入 / 无活动会话，上游
 *   "invalid concurrent call to GetReport" netcheck.go:861-865）；
 * - 'RANGE'：入参校验失败（OnlySTUN 与 OnlyTCP443 同设，:833-839）。
 */
export class NetcheckError extends Error {
  public code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
