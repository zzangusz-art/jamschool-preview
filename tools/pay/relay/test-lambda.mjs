// AWS Lambda 판 중계 시험 — node tools/pay/relay/test-lambda.mjs [--real]   (openssl 필요)
//   lambda/index.mjs 의 handler 를 이 PC 에서 함수 URL 처럼 감싸(HTTPS, 자체 서명) 띄우고, 뒤에는 가짜 씨드 서버를 둔다.
//   우리 결제 서버 코드(seedpay.mjs)가 실제로 쓰는 길(relayCall·postPg·relayHealth)로 확인한다.
//   --real: 마지막에 진짜 씨드 승인 주소(가짜 상점 demotest0m)로도 확인(이 PC 가 한국 IP 일 때 200).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-lambda-'));
let n = 0; const ok = s => console.log('ok', ++n, s);

execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=test-lambda',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', path.join(T, 'key.pem'), '-out', path.join(T, 'cert.pem')], { stdio: 'ignore' });
const KEY = crypto.randomBytes(32).toString('hex');

// 가짜 씨드
const got = [];
const seed = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    got.push({ url: req.url, ctype: req.headers['content-type'], body: b });
    res.writeHead(200, { 'Content-Type': 'application/json;charset=UTF-8' });
    res.end(JSON.stringify(req.url.endsWith('/approval') && b.includes('mid=demotest0m') ? { resultCd: '9999', resultMsg: 'FAIL' } : { resultCd: '0000', resultMsg: '정상', tid: 'T1' }));
  });
}).listen(0, '127.0.0.1');
await new Promise(r => seed.on('listening', r));
const SEED = `http://127.0.0.1:${seed.address().port}`;

process.env.RELAY_UPSTREAM = SEED;
process.env.RELAY_UPSTREAM_TEST = SEED;
process.env.RELAY_KEY_SHA256 = crypto.createHash('sha256').update(KEY).digest('hex');
process.env.AWS_REGION = 'ap-northeast-2';
const L = await import('./lambda/index.mjs');

// 함수 URL 흉내(페이로드 2.0): 헤더 소문자, 본문은 번갈아 base64/평문
let flip = false;
const fnUrl = https.createServer({ key: fs.readFileSync(path.join(T, 'key.pem')), cert: fs.readFileSync(path.join(T, 'cert.pem')) }, (req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', async () => {
    const raw = Buffer.concat(chunks); flip = !flip;
    const u = new URL(req.url, 'https://x');
    const event = {
      version: '2.0', rawPath: u.pathname, rawQueryString: u.search.slice(1), headers: req.headers,
      requestContext: { http: { method: req.method, path: u.pathname, sourceIp: req.socket.remoteAddress } },
      body: raw.length ? (flip ? raw.toString('base64') : raw.toString('utf8')) : undefined, isBase64Encoded: raw.length ? flip : false,
    };
    const out = await L.handler(event);
    res.writeHead(out.statusCode, out.headers || {});
    res.end(out.body == null ? '' : Buffer.from(out.body, out.isBase64Encoded ? 'base64' : 'utf8'));
  });
}).listen(0, '127.0.0.1');
await new Promise(r => fnUrl.on('listening', r));

process.env.SEEDPAY_RELAY_URL = `https://127.0.0.1:${fnUrl.address().port}`;
process.env.SEEDPAY_RELAY_KEY = KEY;
process.env.SEEDPAY_RELAY_CA = fs.readFileSync(path.join(T, 'cert.pem')).toString('base64');
process.env.SEEDPAY_MERCHANT_KEY = 'test-merchant-key';
const PAY = await import('../seedpay.mjs');
const { postPg, URLS } = PAY._test;

try {
  const h = await PAY.relayHealth(true);
  assert.equal(h.ok, true, JSON.stringify(h)); assert.equal(h.seed.status, 200); assert.equal(h.region, 'ap-northeast-2');
  ok('상태 확인: 정상(뒤의 씨드 승인 주소 200, 리전 표시)');

  const r = await postPg(URLS().approval, { tid: 'T1', mid: 'Startz002m', goodsAmt: '12900', ediDate: '20261118190000', hashString: 'h'.repeat(64), payData: 'p&q=1 한글', nonce: 'n' });
  assert.equal(r.resultCd, '0000');
  let last = got[got.length - 1];
  assert.equal(last.url, '/payment/v1/approval'); assert.match(last.ctype, /^application\/x-www-form-urlencoded/);
  assert.equal(new URLSearchParams(last.body).get('payData'), 'p&q=1 한글');
  await postPg(URLS().approval, { tid: 'T2', payData: '두번째 본문' });
  last = got[got.length - 1]; assert.equal(new URLSearchParams(last.body).get('payData'), '두번째 본문');
  ok('승인 요청: 함수를 거쳐 같은 본문(한글 포함, base64·평문 둘 다)으로 씨드에 전달, 응답 그대로');

  await postPg(URLS().netCancel, { tid: 'T1' }); await postPg(URLS().cancel, { tid: 'T1' });
  assert.deepEqual(got.slice(-2).map(x => x.url), ['/payment/v1/netCancel', '/payment/v1/cancel']); ok('망취소·취소도 같은 길');

  process.env.SEEDPAY_RELAY_KEY = crypto.randomBytes(32).toString('hex');
  await assert.rejects(postPg(URLS().approval, { tid: 'x' }), e => e.kind === 'http' && /403/.test(e.message));
  assert.equal((await PAY.relayHealth(true)).ok, false); ok('키가 틀리면 함수가 거절(403), 상태 확인도 실패');
  process.env.SEEDPAY_RELAY_KEY = KEY;

  // 함수 직접 호출: 막아야 하는 것들
  const call = (method, p, extra = {}) => L.handler({ rawPath: p, headers: { 'x-relay-key': KEY, 'content-type': 'application/x-www-form-urlencoded', ...(extra.headers || {}) }, requestContext: { http: { method } }, body: extra.body, isBase64Encoded: false });
  const before = got.length;
  assert.equal((await call('POST', '/seed/other', { body: 'a=1' })).statusCode, 404);
  assert.equal((await call('POST', '/payment/v1/approval', { body: 'a=1' })).statusCode, 404);
  assert.equal((await call('GET', '/seed/approval')).statusCode, 404);
  assert.equal((await call('GET', '/')).statusCode, 404);
  assert.equal((await call('POST', '/seed/approval', { body: '' })).statusCode, 400);
  assert.equal((await call('POST', '/seed/approval', { body: 'a=' + 'x'.repeat(70000) })).statusCode, 400);
  assert.equal((await call('POST', '/seed/approval', { body: '{"a":1}', headers: { 'content-type': 'application/json' } })).statusCode, 415);
  assert.equal(got.length, before); ok('정해진 세 주소·폼 본문(64KB 이하)만 씨드로 보냄, 나머지는 404·400·415');

  const saved = process.env.RELAY_KEY_SHA256;
  delete process.env.RELAY_KEY_SHA256;
  assert.equal((await call('POST', '/seed/approval', { body: 'a=1' })).statusCode, 403);
  process.env.RELAY_KEY_SHA256 = 'not-a-hash';
  assert.equal((await call('GET', '/health')).statusCode, 403);
  process.env.RELAY_KEY_SHA256 = saved; ok('해시 설정이 없거나 형식이 틀리면 모두 거절');

  const t = await call('POST', '/seed/test/approval', { body: 'mid=x' });
  assert.equal(t.statusCode, 200); assert.equal(t.headers['X-Upstream-Status'], '200'); ok('/seed/test/<op> 는 테스트 서버 쪽으로, 응답에 X-Upstream-Status');

  seed.close(); seed.closeAllConnections(); L._test.reset(); await new Promise(r => setTimeout(r, 200));
  await assert.rejects(postPg(URLS().approval, { tid: 'x' }), e => e.kind === 'network');
  assert.equal((await PAY.relayHealth(true)).ok, false); ok('씨드에 닿지 못하면 502 → 통신 실패로 처리, 상태 확인 실패');

  if (process.argv.includes('--real')) {
    delete process.env.RELAY_UPSTREAM; L._test.reset();
    const rh = await PAY.relayHealth(true);
    console.log('진짜 씨드(가짜 상점 demotest0m) 응답:', JSON.stringify(rh.seed));
    assert.equal(rh.seed.status, 200); ok('진짜 씨드 승인 주소까지 함수 경유 성공(이 PC IP 기준)');
  }
} finally {
  try { seed.close(); } catch { /* 이미 닫힘 */ }
  fnUrl.close();
  fs.rmSync(T, { recursive: true, force: true });
}
console.log(`\nLambda 중계 시험 ${n}개 통과`);
process.exit(0);
