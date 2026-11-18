// Supabase Edge Function 판 중계 시험 — node tools/pay/relay/test-supabase.mjs [--real]   (Node 22.6+ 의 .ts 읽기, openssl 필요)
//   supabase/seed-relay/index.ts 의 handle(Request) 를 이 PC 에서 HTTPS 로 감싸 띄우고, 뒤에는 가짜 씨드 서버를 둔다.
//   주소는 실제와 같은 모양(/functions/v1/seed-relay?forceFunctionRegion=ap-northeast-2)으로, seedpay.mjs 가 쓰는 길로 확인한다.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-supa-'));
let n = 0; const ok = s => console.log('ok', ++n, s);

execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=test-supa',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', path.join(T, 'key.pem'), '-out', path.join(T, 'cert.pem')], { stdio: 'ignore' });
const KEY = crypto.randomBytes(32).toString('hex');

const got = [];
const seed = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    got.push({ url: req.url, ctype: req.headers['content-type'], body: b });
    res.writeHead(200, { 'Content-Type': 'application/json;charset=UTF-8' });
    res.end(JSON.stringify(req.url.endsWith('/approval') && b.includes('mid=demotest0m') ? { resultCd: '9999', resultMsg: 'FAIL' } : { resultCd: '0000', resultMsg: '정상', tid: 'T1' }));
  });
}).listen(0, '127.0.0.1');
await new Promise(r => seed.on('listening', r));

Object.assign(process.env, {
  RELAY_UPSTREAM: `http://127.0.0.1:${seed.address().port}`, RELAY_UPSTREAM_TEST: `http://127.0.0.1:${seed.address().port}`,
  RELAY_KEY_SHA256: crypto.createHash('sha256').update(KEY).digest('hex'), SB_REGION: 'ap-northeast-2', RELAY_SKIP_IP: '1',
});
const F = await import('./supabase/seed-relay/index.ts');

const seen = [];   // 함수가 받은 주소·헤더
const edge = https.createServer({ key: fs.readFileSync(path.join(T, 'key.pem')), cert: fs.readFileSync(path.join(T, 'cert.pem')) }, (req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', async () => {
    seen.push({ url: req.url, region: req.headers['x-region'] });
    const body = Buffer.concat(chunks);
    const out = await F.handle(new Request(`https://edge.local${req.url}`, { method: req.method, headers: req.headers, body: body.length ? body : undefined }));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
}).listen(0, '127.0.0.1');
await new Promise(r => edge.on('listening', r));

process.env.SEEDPAY_RELAY_URL = `https://127.0.0.1:${edge.address().port}/functions/v1/seed-relay?forceFunctionRegion=ap-northeast-2`;
process.env.SEEDPAY_RELAY_KEY = KEY;
process.env.SEEDPAY_RELAY_CA = fs.readFileSync(path.join(T, 'cert.pem')).toString('base64');
process.env.SEEDPAY_MERCHANT_KEY = 'test-merchant-key';
const PAY = await import('../seedpay.mjs');
const { postPg, URLS } = PAY._test;

try {
  const h = await PAY.relayHealth(true);
  assert.equal(h.ok, true, JSON.stringify(h)); assert.equal(h.seed.status, 200); assert.equal(h.region, 'ap-northeast-2');
  assert.equal(seen[0].url, '/functions/v1/seed-relay/health?forceFunctionRegion=ap-northeast-2'); assert.equal(seen[0].region, 'ap-northeast-2');
  ok('상태 확인 정상 — 주소는 함수 이름 뒤에 경로, ?forceFunctionRegion 유지, x-region 헤더도 같이');

  const r = await postPg(URLS().approval, { tid: 'T1', mid: 'Startz002m', goodsAmt: '12900', payData: 'p&q=1 한글', nonce: 'n' });
  assert.equal(r.resultCd, '0000');
  const last = got[got.length - 1];
  assert.equal(last.url, '/payment/v1/approval'); assert.match(last.ctype, /^application\/x-www-form-urlencoded/);
  assert.equal(new URLSearchParams(last.body).get('payData'), 'p&q=1 한글'); ok('승인 요청: 같은 본문으로 씨드에 전달, 응답 그대로');

  await postPg(URLS().netCancel, { tid: 'T1' }); await postPg(URLS().cancel, { tid: 'T1' });
  assert.deepEqual(got.slice(-2).map(x => x.url), ['/payment/v1/netCancel', '/payment/v1/cancel']); ok('망취소·취소도 같은 길');

  process.env.SEEDPAY_RELAY_KEY = crypto.randomBytes(32).toString('hex');
  await assert.rejects(postPg(URLS().approval, { tid: 'x' }), e => e.kind === 'http' && /403/.test(e.message));
  assert.equal((await PAY.relayHealth(true)).ok, false); ok('키가 틀리면 거절(403), 상태 확인도 실패');
  process.env.SEEDPAY_RELAY_KEY = KEY;

  const call = (method, p, body, ctype = 'application/x-www-form-urlencoded') => F.handle(new Request(`https://edge.local${p}`, { method, headers: { 'x-relay-key': KEY, 'content-type': ctype }, body }));
  const before = got.length;
  assert.equal((await call('POST', '/seed-relay/seed/other', 'a=1')).status, 404);
  assert.equal((await call('POST', '/seed-relay/payment/v1/approval', 'a=1')).status, 404);
  assert.equal((await call('POST', '/seed-relay/x/seed/approval', 'a=1')).status, 404);
  assert.equal((await call('GET', '/seed-relay/seed/approval')).status, 404);
  assert.equal((await call('POST', '/seed-relay/seed/approval', '')).status, 400);
  assert.equal((await call('POST', '/seed-relay/seed/approval', 'a=' + 'x'.repeat(70000))).status, 400);
  assert.equal((await call('POST', '/seed-relay/seed/approval', '{"a":1}', 'application/json')).status, 415);
  assert.equal(got.length, before); ok('정해진 세 주소·폼 본문(64KB 이하)만 씨드로, 나머지는 404·400·415');

  const t = await call('POST', '/seed-relay/seed/test/approval', 'mid=x');
  assert.equal(t.status, 200); assert.equal(t.headers.get('x-upstream-status'), '200'); ok('/seed/test/<op> 는 테스트 서버로, X-Upstream-Status 붙음');

  const saved = process.env.RELAY_KEY_SHA256; delete process.env.RELAY_KEY_SHA256;
  assert.equal((await call('POST', '/seed-relay/seed/approval', 'a=1')).status, 403);
  process.env.RELAY_KEY_SHA256 = saved; ok('해시 설정이 없으면 모두 거절');

  delete process.env.SEEDPAY_RELAY_KEY;
  const hh = PAY.relayKeyHash(); assert.match(hh, /^[0-9a-f]{64}$/);
  assert.notEqual(hh, crypto.createHash('sha256').update('test-merchant-key').digest('hex'));
  process.env.RELAY_KEY_SHA256 = hh;
  assert.equal((await postPg(URLS().cancel, { tid: 'T9' })).resultCd, '0000');
  process.env.SEEDPAY_RELAY_KEY = KEY; process.env.RELAY_KEY_SHA256 = saved;
  ok('SEEDPAY_RELAY_KEY 없이 상점키에서 만든 키로도 동작(중계 쪽엔 해시만, 상점키 해시와 다름)');

  seed.close(); seed.closeAllConnections(); F._test.reset(); await new Promise(r => setTimeout(r, 200));
  await assert.rejects(postPg(URLS().approval, { tid: 'x' }), e => e.kind === 'network');
  assert.equal((await PAY.relayHealth(true)).ok, false); ok('씨드에 닿지 못하면 502 → 통신 실패, 상태 확인 실패');

  if (process.argv.includes('--real')) {
    delete process.env.RELAY_UPSTREAM; delete process.env.RELAY_SKIP_IP; F._test.reset();
    const rh = await PAY.relayHealth(true);
    console.log('진짜 씨드(가짜 상점 demotest0m) 응답:', JSON.stringify(rh.seed));
    assert.equal(rh.seed.status, 200); ok('진짜 씨드 승인 주소까지 함수 경유 성공(이 PC IP 기준)');
  }
} finally {
  try { seed.close(); } catch { /* 이미 닫힘 */ }
  edge.close();
  fs.rmSync(T, { recursive: true, force: true });
}
console.log(`\nSupabase 중계 시험 ${n}개 통과`);
process.exit(0);
