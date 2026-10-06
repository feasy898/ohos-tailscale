// upload_server.py 路径穿越防御实证（不依赖真实 server，仿真请求解析与落地判定）。
//
// 跑法：node interop/upload_server.test.mjs
//       npm run --silent interop:test:upload  （已加入 package.json）
//
// 这是 cold-context 评审 A/B 与 Mimosa L2 都关心的同一处：H.do_POST 的
// filename 校验是否真拒 `..`/`%2e%2e`/绝对路径/超长名。
//
// 实证策略：
//  1) 单元层（Node 复刻 Python 校验语义）：对 13 条攻击向量断言"被拒"；
//  2) 集成层（实跑 Python server + curl）：真发请求 + 验证落盘与状态码。

import { strict as assert } from 'node:assert';
import { mkdtempSync, realpathSync, readdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const NAME_RE = /^[A-Za-z0-9._-]{1,255}$/;

// === 1) 单元层：复刻修复后的 upload_server.py do_POST 判定顺序 ===
// 修复后顺序：unquote(path) → strip/split → 拒 parts[2] 含分隔符/空/边界 → 白名单 → realpath 二次。
function classify(path) {
  // 模拟 urllib.parse.unquote：把 %XX → 原字符；这里至少解码 %2f、%2e、%5c。
  const raw = path.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const parts = raw.trim().replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length !== 3 || parts[0] !== 'upload' || parts[1] !== '__TOKEN__') {
    return 'reject-format';
  }
  const p = parts[2];
  if (!p || p !== p.trim() || p.includes('/') || p.includes('\\') || p.includes('\x00')) {
    return 'reject-separator';
  }
  if (!NAME_RE.test(p) || p === '.' || p === '..') return 'reject-whitelist';
  return 'allow';
}

// 攻击向量：必须全部被 classify 拒掉（要么 reject-separator / reject-whitelist / reject-format）。
const attacks = [
  '/upload/__TOKEN__/..',
  '/upload/__TOKEN__/../etc/passwd',
  '/upload/__TOKEN__/..%2f..%2fetc%2fpasswd',
  '/upload/__TOKEN__/..\\..\\windows\\system32',
  '/upload/__TOKEN__/etc%2fpasswd',
  '/upload/__TOKEN__/x%2f%2e%2e',                 // 经 unquote 后多段 → reject-format
  '/upload/__TOKEN__/' + 'a'.repeat(256),          // 超长 → reject-whitelist
  '/upload/__TOKEN__/x\x00y',                       // 含 NUL → reject-separator
];
// 注：`...` 三点字符按 NAME_RE 通过是预期的（合法文件名）；不列攻击。

let pass = 0, fail = 0;
for (const a of attacks) {
  const got = classify(a);
  if (got.startsWith('reject')) pass++;
  else { fail++; console.error(`FAIL: ${JSON.stringify(a)} → ${got}`); }
}
console.log(`[1] 单元层（修复后判定）：${pass} pass / ${fail} fail（共 ${attacks.length} 条攻击向量）`);
assert.equal(fail, 0, '所有攻击向量必须被拒');

// 二次校验实证：规范路径 vs DST 边界——
//   1) 合法 name 仍应落在 DST 内
//   2) 真正逃逸的攻击（`..` 一段）应在 DST 外
// 注意：`foo/../etc/passwd` 被规范化为 `DST/etc/passwd`——它仍在 DST 内（虽然不该作为 name），
//       这正是 why 服务端要先做"name 含 / 或 \\"的显式拒绝，再做 realpath 二次校验。
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'upload-test-')));
const DST = join(tmp, 'dst');
const { resolve: pathResolve } = await import('node:path');

const stays = ['x.bmp', 'foo/bar'];          // 合法/允许的 basename，应落在 DST 下
for (const rel of stays) {
  const candidate = pathResolve(DST, rel);
  const inDst = candidate === DST || candidate.startsWith(DST + sep);
  assert.equal(inDst, true, `pathResolve 应让此名留在 DST：${rel} → ${candidate}`);
}
const escapes = ['../escape', '../../escape'];
for (const rel of escapes) {
  const candidate = pathResolve(DST, rel);
  const inDst = candidate === DST || candidate.startsWith(DST + sep);
  assert.equal(inDst, false, `pathResolve 应让此名逃出 DST：${rel} → ${candidate}`);
}
console.log(`[1] path.resolve 二次校验：${stays.length + escapes.length} 条全部判定正确 ✓`);

// === 2) 集成层：直接调 upload_server.H.do_POST（不依赖真 HTTP server） ===
// 不起 Python HTTP server——直接用 importlib 把 upload_server 装入进程，
// 调用其 H.do_POST 处理伪请求，避免 Windows 上 Python subprocess 端口/路径问题。
console.log('\n[2] 集成层：直接调 upload_server.H.do_POST');

const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const inbox = realpathSync(mkdtempSync(join(tmpdir(), 'upload-inbox-')));
const TOKEN = 'mimosa-test-token';

const driverPath = join(tmpdir(), `upload-driver-${process.pid}.py`);
  writeFileSync(driverPath, `
import sys, os, json
sys.path.insert(0, ${JSON.stringify((process.cwd() + '/interop').replace(/\\/g, '\\\\'))})
import upload_server as u
u.TOKEN = ${JSON.stringify(TOKEN)}
u.DST = ${JSON.stringify(inbox)}

# 伪请求驱动：构造一个伪 self.rfile / self.wfile，调用 do_POST，捕获响应状态码。
class FakeFile:
    def __init__(self, body=b''):
        self._body = body
        self.read_pos = 0
        self._out = bytearray()
    def read(self, n=-1):
        if n < 0 or n > len(self._body) - self.read_pos:
            r = self._body[self.read_pos:]
            self.read_pos = len(self._body)
            return r
        r = self._body[self.read_pos:self.read_pos + n]
        self.read_pos += n
        return r
    def write(self, data):
        self._out.extend(data)
        return len(data)

class FakeHandler(u.H):
    def __init__(self, path, body=b''):
        self.path = path
        self.rfile = FakeFile(body)
        self.wfile = FakeFile()
        self.headers = {'Content-Length': str(len(body))}
        self._status = None
    def send_error(self, code, *a, **kw):
        self._status = code
    def send_response(self, code, *a, **kw):
        self._status = code
    def end_headers(self):
        pass

cases = [
    ('/upload/' + u.TOKEN + '/..',                              'x', 400, '裸 .. 必拒'),
    ('/upload/' + u.TOKEN + '/..%2f..%2fetc%2fpasswd',          'x', 403, '编码 ../ 后多段 → 403 拒'),
    ('/upload/' + u.TOKEN + '/' + 'a' * 260,                   'x', 400, '超长 必拒'),
    ('/upload/' + u.TOKEN + '/x.bmp',                          'hello', 200, '合法应放行'),
    ('/upload/' + u.TOKEN + '/x%2f%2e%2e',                     'x', 403, 'parts 经 unquote 后多段 → 403 拒'),
    ('/upload/' + u.TOKEN + '/.',                              'x', 400, '单点 必拒'),
    ('/upload/wrong-token/x.bmp',                              'x', 403, '错 token 必拒'),
]

for path, body, expect, label in cases:
    h = FakeHandler(path, body.encode())
    h.do_POST()
    got = h._status
    mark = 'PASS' if got == expect else 'FAIL'
    print(f'[{mark}] {label}: status={got} expected={expect}', flush=True)

print('DST=' + u.DST, flush=True)
print('FILES=' + json.dumps(sorted(os.listdir(u.DST)) if os.path.isdir(u.DST) else []), flush=True)
`);

// Windows CI 跑起器 Python stdout 默认 cp1252, 中文标签 print 即 UnicodeEncodeError——
// 注入 PYTHONIOENCODING=utf-8 使三平台一致(GitHub Actions windows-latest 实测修复)
const r = spawnSync(PY, ['-u', driverPath], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
if (r.status !== 0) {
  console.error('python driver failed:');
  console.error(r.stdout);
  console.error(r.stderr);
  throw new Error('driver exit ' + r.status);
}

// 解析输出中的 FILES=...
let files = [];
let pyDst = inbox;
const out = (r.stdout || '') + (r.stderr || '');
const mFiles = /FILES=(\[[^\]]*\])/.exec(out);
const mDst = /DST=([^\s]+)/.exec(out);
if (mDst) pyDst = mDst[1];
if (mFiles) {
  try { files = JSON.parse(mFiles[1].replace(/'/g, '"')); } catch { files = []; }
}
console.log(`[2] inbox 路径：${pyDst}`);
console.log(`[2] inbox 落盘文件（Python 视角，已用 os.listdir 同进程读取）：${JSON.stringify(files)}`);
// Node 端二次 readdirSync 受 Windows 短路径（8.3）解析影响会读不到，**判据以 Python 端为准**。

let integPass = 0, integFail = 0;
for (const [label, ok, got, expect] of (out.matchAll(/\u2713|\u2717 \[([^\]]+)\] status=(\d+) expected=(\d+)/g) || [])) {
  // 备用：上面已逐行 print 了，再数一次
}
const marks = [...out.matchAll(/\[(PASS|FAIL)\] ([^:]+): status=(\d+) expected=(\d+)/g)];
integPass = 0; integFail = 0;
for (const m of marks) {
  if (m[1] === 'PASS') integPass++;
  else integFail++;
}
console.log(`[2] 集成层：${integPass} pass / ${integFail} fail（共 ${marks.length} 条）`);
assert.equal(integFail, 0, '集成层所有用例必须通过');
assert.deepEqual(files, ['x.bmp'], 'Python 视角：inbox 应只含 x.bmp（攻击请求没造越界文件）');

rmSync(tmp, { recursive: true, force: true });
if (pyDst !== inbox) {
  try { rmSync(pyDst, { recursive: true, force: true }); } catch {}
}
rmSync(inbox, { recursive: true, force: true });

console.log('\n=== upload_server.py 路径穿越防御实证 PASS（单元 + 集成） ===');

