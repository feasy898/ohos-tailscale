// 用途：P0-1 修 typecheck:bridge 红灯（TS2353）的验收测试（TESTS-2026-10-03，TESTS.md §1 矩阵行 P0-1）。
// 混合态文件：T-P0-1-b/c 现在就该绿（正控制组语义 + 畸形 q 行为零漂移——生产代码已满足）；
// T-P0-1-a/d/e/f 是 TDD 红锚（当前 exit 2 / answerDns: null 在盘 / test( 计数 9 / yml 无 step）。
// 关键机理：正控制组钉死「合法 q → 200」——answerDns:null 修法（R2 实测退化路径）下合法 q 会 503，只有它抓得住。
// 计数口径：畸形 q 是 test 内循环非子 test，node --test 的 # tests 不数循环——防「拆成子 test 冲高计数」用 test( 计数副断言。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, readRepo, importRepo, repoPathExists } from './lib/spawn.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TESTED = 'app/bridge/test/peerapi-tun.test.ts';

async function makeServer(answerDns) {
  const { MockPeerApiServer } = await importRepo('app/bridge/src/mock-peerapi.ts');
  return new MockPeerApiServer({
    displayName: 'exit-node-a',
    selfAddressPrefixes: ['100.64.0.9/32', 'fd7a:115c:a1e0::9/128'],
    masqV4: '',
    masqV6: '',
    listeners: [{ ip: '100.64.0.9', port: 40001 }],
    answerDns,
    offersExitNodeOrAppConnector: true,
    filterAcceptsTcp53: false,
  });
}

const req = (q) => ({
  method: 'GET', host: 'peer', referer: '', origin: '',
  path: '/dns-query', params: { q }, isSelfQuery: true,
});

test('T-P0-1-a npm run typecheck:bridge exit 0（当前 exit 2：TS2353 @ peerapi-tun.test.ts）——TDD 红锚', { timeout: 60000 }, () => {
  const r = run('npm', ['run', 'typecheck:bridge'], { timeoutMs: 55000 });
  assert.equal(r.status, 0, `A3 判据：typecheck:bridge 必须 exit 0。当前实测 exit ${r.status}：\n${r.stdout.slice(-400)}`);
});

test('T-P0-1-b 正控制组：合法 q → 200 且 body 为 {RCode,Negative,Answers} JSON（answerDns 传真函数形态）', async () => {
  const server = await makeServer((name, qtype) => ({
    rcode: 0, negative: false,
    answers: [{ name, qtype, data: '100.64.0.2' }],
  }));
  const r = server.handle(req('host.tail-net.example.ts.net'));
  assert.equal(r.status, 200, `合法 FQDN 必须 200（若 503=answerDns 被传 null，R2 退化路径）。实测 body=${r.body}`);
  const body = JSON.parse(r.body);
  assert.deepEqual(Object.keys(body).sort(), ['Answers', 'Negative', 'RCode']);
});

test('T-P0-1-c 行为零漂移：畸形 q 九项逐条 400（空 q=missing q，其余=malformed q，与现行逐条一致）', async () => {
  const server = await makeServer(() => ({ rcode: 0, negative: false, answers: [] }));
  const malformed = ['..', 'a..b', '.', '', 'a'.repeat(254), 'a b', 'a/b', 'a\\b', 'a\x00b'];
  for (const bad of malformed) {
    const r = server.handle(req(bad));
    assert.equal(r.status, 400, `畸形 q=${JSON.stringify(bad)} 必须 400`);
    const expectBody = bad === '' ? 'missing q' : 'malformed q';
    assert.ok(r.body.includes(expectBody), `body 必须含可定位标识 ${JSON.stringify(expectBody)}（实测 ${JSON.stringify(r.body)}）`);
  }
});

test('T-P0-1-d 禁则：peerapi-tun.test.ts 不得出现 answerDns: null / as unknown as / @ts-ignore / @ts-nocheck——TDD 红锚', () => {
  const src = readRepo(TESTED);
  for (const poison of ['answerDns: null', 'as unknown as', '@ts-ignore', '@ts-nocheck']) {
    assert.ok(!src.includes(poison), `P0-1 明文禁用 ${JSON.stringify(poison)}（实测在盘）——把编译器关掉不是修类型`);
  }
});

test('T-P0-1-e 计数副断言：peerapi-tun.test.ts 的 test( 计数 = 10（现值 9 + 正控制组 1）——TDD 红锚', () => {
  const src = readRepo(TESTED);
  const count = (src.match(/^\s*test\(/gm) || []).length;
  assert.equal(count, 10, `test( 计数必须 10（现值 9；P0-1 落地=+1 正控制组）。防把畸形 q 循环拆成子 test 冲高 # tests。实测 ${count}`);
});

test('T-P0-1-f CI 结构断言：g0-gates.yml 含 typecheck:bridge step——TDD 红锚（缺口1：修完不入 CI）', () => {
  const yml = readRepo('.github/workflows/g0-gates.yml');
  assert.ok(yml.includes('npm run typecheck:bridge'), 'yml 必须含 npm run typecheck:bridge（BASELINE 缺口#1 防再犯）');
});
