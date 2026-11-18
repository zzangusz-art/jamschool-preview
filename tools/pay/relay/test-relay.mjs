// 한국 중계 서버 시험 — node tools/pay/relay/test-relay.mjs (python3·openssl 필요)
//   seed-relay.py 를 이 PC 에서 띄우고(자체 서명 인증서, 127.0.0.1), 씨드 대신 가짜 씨드 서버를 뒤에 둔다.
//   --real 을 붙이면 마지막에 진짜 씨드 승인 주소(가짜 상점 demotest0m)로도 한 번 확인한다(이 PC 가 한국 IP 일 때 200).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-relay-'));
const PY = process.platform === 'win32' ? 'python' : 'python3';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const ok = s => console.log('ok', ++n, s);

execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=test-relay',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', path.join(T, 'key.pem'), '-out', path.join(T, 'cert.pem')], { stdio: 'ignore' });
const KEY = 'k'.repeat(40);

// 가짜 씨드
const got = [];
const seed = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    got.push({ url: req.url, ctype: req.headers['content-type'], body: b });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url.endsWith('/approval') && b.includes('mid=demotest0m') ? { resultCd: '9999', resultMsg: 'FAIL' } : { resultCd: '0000', resultMsg: '정상', tid: 'T1' }));
  });
}).listen(0, '127.0.0.1');
await new Promise(r => seed.on('listening', r));
const SEED = `http://127.0.0.1:${seed.address().port}`;

function startRelay(port, upstream) {
  const env = { ...process.env, RELAY_KEY: KEY, RELAY_PORT: String(port), RELAY_CERT: path.join(T, 'cert.pem'), RELAY_KEYFILE: path.join(T, 'key.pem'), PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' };
  if (upstream) Object.assign(env, { RELAY_UPSTREAM: upstream, RELAY_UPSTREAM_TEST: upstream });
  const p = spawn(PY, [path.join(HERE, 'seed-relay.py')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  return { p, log: () => out };
}
const PORT = 18443;
const relay = startRelay(PORT, SEED);
await sleep(1500);

process.env.SEEDPAY_RELAY_URL = `https://127.0.0.1:${PORT}`;
process.env.SEEDPAY_RELAY_KEY = KEY;
process.env.SEEDPAY_RELAY_CA = fs.readFileSync(path.join(T, 'cert.pem')).toString('base64');
process.env.SEEDPAY_MERCHANT_KEY = 'test-merchant-key';
const PAY = await import('../seedpay.mjs');
const { postPg, URLS } = PAY._test;

try {
  const h = await PAY.relayHealth(true);
  assert.equal(h.ok, true, JSON.stringify(h)); assert.equal(h.seed.status, 200); ok('중계 상태: 정상(뒤의 씨드 승인 주소 200)');

  const r = await postPg(URLS().approval, { tid: 'T1', mid: 'Startz002m', goodsAmt: '12900', ediDate: '20261118190000', hashString: 'h'.repeat(64), payData: 'p&q=1', nonce: 'n' });
  assert.equal(r.resultCd, '0000');
  const last = got[got.length - 1];
  assert.equal(last.url, '/payment/v1/approval'); assert.match(last.ctype, /^application\/x-www-form-urlencoded/);
  assert.equal(new URLSearchParams(last.body).get('payData'), 'p&q=1'); ok('승인 요청: 중계 서버를 거쳐 같은 본문·형식으로 씨드에 전달, 응답 그대로');

  await postPg(URLS().netCancel, { tid: 'T1' }); await postPg(URLS().cancel, { tid: 'T1' });
  assert.deepEqual(got.slice(-2).map(x => x.url), ['/payment/v1/netCancel', '/payment/v1/cancel']); ok('망취소·취소도 같은 길');

  await assert.rejects(postPg('https://evil.example/payment/v1/other', {}), /알 수 없는 결제 요청/); ok('세 가지 말고는 보내지 않음');

  process.env.SEEDPAY_RELAY_KEY = 'wrong'.repeat(8);
  await assert.rejects(postPg(URLS().approval, { tid: 'x' }), e => e.kind === 'http' && /403/.test(e.message));
  assert.equal((await PAY.relayHealth(true)).ok, false); ok('키가 틀리면 중계 서버가 거절(403)');
  process.env.SEEDPAY_RELAY_KEY = KEY;

  process.env.SEEDPAY_RELAY_CA = Buffer.from('-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ0FfYWtl\n-----END CERTIFICATE-----\n').toString('base64');
  await assert.rejects(postPg(URLS().approval, { tid: 'x' }), e => e.kind === 'network'); ok('인증서가 다르면 연결하지 않음(고정 인증서)');
  process.env.SEEDPAY_RELAY_CA = fs.readFileSync(path.join(T, 'cert.pem')).toString('base64');

  relay.p.kill(); await sleep(500);
  await assert.rejects(postPg(URLS().approval, { tid: 'x' }), e => e.kind === 'network');
  assert.equal((await PAY.relayHealth(true)).ok, false); ok('중계 서버가 꺼지면 통신 실패로 처리(승인 단계는 망취소 시도, 결제창은 열지 않음)');

  if (process.argv.includes('--real')) {
    const real = startRelay(PORT + 1, '');
    await sleep(1500);
    process.env.SEEDPAY_RELAY_URL = `https://127.0.0.1:${PORT + 1}`;
    const rh = await PAY.relayHealth(true);
    console.log('진짜 씨드(가짜 상점 demotest0m) 응답:', JSON.stringify(rh.seed));
    assert.equal(rh.seed.status, 200); ok('진짜 씨드 승인 주소까지 중계 성공(이 PC IP 기준)');
    real.p.kill();
  }
} finally {
  try { relay.p.kill(); } catch { /* 이미 끝남 */ }
  seed.close();
  fs.rmSync(T, { recursive: true, force: true });
}
console.log(`\n중계 서버 시험 ${n}개 통과`);
process.exit(0);
