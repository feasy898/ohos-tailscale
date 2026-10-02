/**
 * 引擎侧地址载体与 IP 字面量解析（上游 netip.AddrPort 的最小替身）。
 *
 * 上游引擎全部用 netip.AddrPort（netcheck.go:240 SendPacket、:686 addNodeLatency
 * 的 ipp 等）。核心库禁 node:*（P3），无 netip，这里用纯字段接口 + 手写
 * 字面量解析（dotted-quad IPv4 / RFC 4291 §2.2 IPv6，含 "::" 压缩与 v4 尾部）。
 * 解析只做字符串→字节，无任何网络行为（D4）。
 *
 * 地址族判定沿用字节长：4B=IPv4、16B=IPv6（与 stun.ts 的 fam 0x01/0x02 约定一致）。
 */

/** IP:端口（纯字段接口；ip 为 4B 或 16B 原始字节）。 */
export interface NetAddr {
  ip: Uint8Array;
  port: number;
}

/** 上游 netip.AddrPort.IsValid() 的空值语义（netcheck.go:724 gotEP4 哨兵、:139 GlobalV4）。 */
export function addrValid(a: NetAddr | null): boolean {
  return a !== null && (a.ip.length === 4 || a.ip.length === 16);
}

export function addrIs4(a: NetAddr): boolean {
  return a.ip.length === 4;
}

export function addrIs6(a: NetAddr): boolean {
  return a.ip.length === 16;
}

/** 逐字节 + 端口相等（上游 netip.AddrPort == 比较，:728 gotEP4 != ipp）。 */
export function addrEqual(a: NetAddr | null, b: NetAddr | null): boolean {
  if (a === null || b === null) {
    return a === null && b === null;
  }
  if (a.port !== b.port || a.ip.length !== b.ip.length) {
    return false;
  }
  for (let i: number = 0; i < a.ip.length; i += 1) {
    if (a.ip[i] !== b.ip[i]) {
      return false;
    }
  }
  return true;
}

/** 端点作 map 键的稳定字符串（counter 键；GetGlobalAddrs 的确定性排序也用它）。 */
export function endpointKey(a: NetAddr): string {
  let out: string = '';
  for (let i: number = 0; i < a.ip.length; i += 1) {
    const b: number = a.ip[i];
    out += b.toString(16).padStart(2, '0');
  }
  return out + '/' + String(a.port);
}

/** 深拷贝（clone 面用；Uint8Array 视图不共享底层内存）。 */
export function cloneAddr(a: NetAddr): NetAddr {
  const out: NetAddr = { ip: a.ip.slice(), port: a.port };
  return out;
}

function parseV4(s: string): Uint8Array | null {
  // netip.ParseAddr 对 IPv4 拒绝空组、>255、超长组；这里同口径。
  const parts: string[] = s.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const out: Uint8Array = new Uint8Array(4);
  for (let i: number = 0; i < 4; i += 1) {
    const p: string = parts[i];
    if (p.length < 1 || p.length > 3) {
      return null;
    }
    let v: number = 0;
    for (let j: number = 0; j < p.length; j += 1) {
      const c: number = p.charCodeAt(j);
      if (c < 0x30 || c > 0x39) {
        return null;
      }
      v = v * 10 + (c - 0x30);
    }
    if (v > 255) {
      return null;
    }
    out[i] = v;
  }
  return out;
}

function hexGroupVal(p: string): number | null {
  if (p.length < 1 || p.length > 4) {
    return null;
  }
  let v: number = 0;
  for (let j: number = 0; j < p.length; j += 1) {
    const c: number = p.charCodeAt(j);
    let d: number = -1;
    if (c >= 0x30 && c <= 0x39) {
      d = c - 0x30;
    } else if (c >= 0x61 && c <= 0x66) {
      d = c - 0x61 + 10;
    } else if (c >= 0x41 && c <= 0x46) {
      d = c - 0x41 + 10;
    }
    if (d < 0) {
      return null;
    }
    v = v * 16 + d;
  }
  return v;
}

/** 解析 IPv6 字面量（含 "::" 一次压缩与末组 dotted-quad）；失败返回 null。 */
function parseV6(s: string): Uint8Array | null {
  if (s.length < 2) {
    return null;
  }
  const dcPos: number = s.indexOf('::');
  if (s.indexOf('::', dcPos + 1) !== -1) {
    return null; // "::" 只能出现一次
  }
  const groups: number[] = [];
  const pushV4Tail = (txt: string): boolean => {
    const b: Uint8Array | null = parseV4(txt);
    if (b === null) {
      return false;
    }
    groups.push((b[0] << 8) | b[1]);
    groups.push((b[2] << 8) | b[3]);
    return true;
  };
  if (dcPos === -1) {
    // 无压缩：恰 8 组（末组可为 v4 尾部 = 2 组）
    const parts: string[] = s.split(':');
    for (let i: number = 0; i < parts.length; i += 1) {
      if (parts[i].indexOf('.') !== -1) {
        if (i !== parts.length - 1 || !pushV4Tail(parts[i])) {
          return null;
        }
        break;
      }
      const v: number | null = hexGroupVal(parts[i]);
      if (v === null) {
        return null;
      }
      groups.push(v);
    }
  } else {
    const head: string = s.slice(0, dcPos);
    const tail: string = s.slice(dcPos + 2);
    if (head !== '') {
      const hp: string[] = head.split(':');
      for (let i: number = 0; i < hp.length; i += 1) {
        if (hp[i].indexOf('.') !== -1) {
          return null; // v4 尾部只允许在末尾
        }
        const v: number | null = hexGroupVal(hp[i]);
        if (v === null) {
          return null;
        }
        groups.push(v);
      }
    }
    // 预留压缩空洞
    const holeAt: number = groups.length;
    groups.push(-1);
    if (tail !== '') {
      const tp: string[] = tail.split(':');
      for (let i: number = 0; i < tp.length; i += 1) {
        if (tp[i].indexOf('.') !== -1) {
          if (i !== tp.length - 1 || !pushV4Tail(tp[i])) {
            return null;
          }
          break;
        }
        const v: number | null = hexGroupVal(tp[i]);
        if (v === null) {
          return null;
        }
        groups.push(v);
      }
    }
    // 空洞填零，总组数须 ≤ 8
    const filled: number = groups.length - 1;
    if (filled > 8) {
      return null;
    }
    const zeros: number = 8 - filled;
    if (zeros < 1) {
      return null; // "::" 至少压缩一个零组（否则应写成完整形式）
    }
    groups.splice(holeAt, 1);
    for (let z: number = 0; z < zeros; z += 1) {
      groups.splice(holeAt, 0, 0);
    }
  }
  if (groups.length !== 8) {
    return null;
  }
  const out: Uint8Array = new Uint8Array(16);
  for (let i: number = 0; i < 8; i += 1) {
    out[i * 2] = (groups[i] >> 8) & 0xff;
    out[i * 2 + 1] = groups[i] & 0xff;
  }
  return out;
}

/**
 * 解析 IP 字面量为原始字节（4B/16B）；非字面量（含 "none"、DNS 名、带 zone）返回 null。
 * 口径对齐上游 netip.ParseAddr + Is4/Is6 的判定链（nodeMight4/6 netcheck.go:589-610、
 * nodeAddrPort :1673-1703；derpmap.go:216-228 "none"=禁该族 的机制就是 ParseAddr 失败）。
 */
export function parseIpLiteral(s: string): Uint8Array | null {
  if (s === '' || s.indexOf('%') !== -1) {
    return null;
  }
  if (s.indexOf(':') !== -1) {
    return parseV6(s);
  }
  const v4: Uint8Array | null = parseV4(s);
  return v4;
}
