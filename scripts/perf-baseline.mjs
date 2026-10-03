// BigInt X25519 scalarMult 重测基线脚本
//
// 复现 DELIVERY_REPORT §3.4 的 09-29 桌面基线（5.25 ms/op, 200 次取均值 + 20 次预热）。
// 在本机实跑，输出 ms/op 与 ops/s；写到 stdout，不入仓（用户自行对比）。
//
// 用法:  node scripts/perf-baseline.mjs
//        node scripts/perf-baseline.mjs --iter=500 --warmup=50
//
// 输出格式：JSON 一行（便于机器消费）+ 人类可读总结。
// 不引外部依赖——只 import 本仓 packages/*。

import { performance } from 'node:perf_hooks';
import { webcrypto } from 'node:crypto';
import { x25519, x25519GenerateKeyPair } from '../packages/crypto/src/x25519.ts';

/** Node crypto 的真实随机源包装——用于脚本注入，不进 packages/ 源码（D4/P4 纪律）。 */
const systemRng = {
  randomBytes(into) {
    // webcrypto.getRandomValues 是同步且密码学安全；比 node:crypto.randomBytes 更稳。
    webcrypto.getRandomValues(into);
  },
};

function parseArgs(argv) {
  const args = { iter: 200, warmup: 20 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--iter=')) args.iter = Number(a.slice(7));
    else if (a.startsWith('--warmup=')) args.warmup = Number(a.slice(10));
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // 预生成一对 key（不进测量），避免 keygen 噪音混入。
  const kp = x25519GenerateKeyPair(systemRng);
  const base = x25519GenerateKeyPair(systemRng); // 用作基点（任意 32 字节即可；这里复用 keypair 走稳定路径）

  // 预热
  for (let i = 0; i < args.warmup; i++) {
    x25519(kp.privateKey, base.publicKey);
  }

  // 测量
  const samples = [];
  let sink = 0;
  for (let i = 0; i < args.iter; i++) {
    const t0 = performance.now();
    const r = x25519(kp.privateKey, base.publicKey);
    const dt = performance.now() - t0;
    samples.push(dt);
    sink ^= r[0] ^ r[r.length - 1]; // 防止 JIT 把它优化掉
  }

  samples.sort((a, b) => a - b);
  const sum = samples.reduce((s, x) => s + x, 0);
  const mean = sum / samples.length;
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const p99 = samples[Math.floor(samples.length * 0.99)];
  const opsPerSec = 1000 / mean;

  const summary = {
    node: process.version,
    iter: args.iter,
    warmup: args.warmup,
    mean_ms: Number(mean.toFixed(4)),
    p50_ms: Number(p50.toFixed(4)),
    p95_ms: Number(p95.toFixed(4)),
    p99_ms: Number(p99.toFixed(4)),
    ops_per_sec: Number(opsPerSec.toFixed(2)),
    sink: (sink >>> 0).toString(16), // 防优化
  };

  console.log(JSON.stringify(summary));

  console.log('\n=== 人类可读总结 ===');
  console.log(`Node ${summary.node}`);
  console.log(`scalarMult  ${summary.iter} 次取均值（预热 ${summary.warmup} 次）`);
  console.log(`  mean=${summary.mean_ms} ms/op (~${summary.ops_per_sec} ops/s)`);
  console.log(`  p50=${summary.p50_ms} ms  p95=${summary.p95_ms} ms  p99=${summary.p99_ms} ms`);
  console.log(`基线 09-29: 5.25 ms/op ~190 ops/s（同一测法；本机 win32 / Node v22.23.2）`);
  const ratio = summary.mean_ms / 5.25;
  console.log(`vs 基线：${ratio.toFixed(2)}× （${ratio < 1 ? '快' : '慢'}${Math.abs(1 - ratio) * 100 | 0}%）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
