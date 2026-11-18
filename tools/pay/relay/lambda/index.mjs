// 잠스쿨 씨드페이먼츠 한국 중계 — AWS Lambda(서울 ap-northeast-2) + 함수 URL 판
//
// 왜: 씨드 승인 서버가 해외 IP(Railway 미국)를 403 으로 막는다. 이 함수를 서울 리전에 두면 AWS 서울 IP 로 나간다.
// 규칙은 seed-relay.py 와 같다(우리 서버 seedpay.mjs 는 둘 중 어느 쪽이든 그대로 쓴다).
//   POST /seed/<op>        op = approval | netCancel | cancel  → https://pay.seedpayments.co.kr/payment/v1/<op>
//   POST /seed/test/<op>   씨드 테스트 서버(devpay)로
//   GET  /health           씨드 승인 주소가 이 함수를 받아 주는지(가짜 상점 demotest0m 로 확인)
//   - X-Relay-Key 헤더가 맞아야 한다(아니면 403). 그 밖의 주소는 404. 본문은 기록하지 않는다.
// 다른 점: 키 원문 대신 SHA-256 해시만 환경 변수 RELAY_KEY_SHA256 에 둔다(원문 키는 Railway SEEDPAY_RELAY_KEY 에만).
//          HTTPS 는 AWS 정식 인증서라 Railway 에 SEEDPAY_RELAY_CA 를 넣지 않는다.
// 설정: 런타임 Node.js 22 이상, 핸들러 index.handler, 제한 시간 30초, 메모리 128MB, 함수 URL 인증 NONE.
// 의존성 없음(파일 하나).
import crypto from 'node:crypto';

const OPS = new Set(['approval', 'netCancel', 'cancel']);
const MAX_BODY = 64 * 1024;
const TIMEOUT = 25000;
const STARTED = Date.now();
const stats = { ok: 0, fail: 0, last: '' };
let healthCache = { at: 0, data: null };

const upstream = env => env === 'test'
  ? (process.env.RELAY_UPSTREAM_TEST || 'https://devpay.seedpayments.co.kr')
  : (process.env.RELAY_UPSTREAM || 'https://pay.seedpayments.co.kr');

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

function authed(headers) {
  const want = (process.env.RELAY_KEY_SHA256 || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) return false;
  const got = crypto.createHash('sha256').update(String(headers['x-relay-key'] || ''), 'utf8').digest();
  return crypto.timingSafeEqual(got, Buffer.from(want, 'hex'));
}

async function forward(url, body, ctype) {
  const r = await fetch(url, {
    method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'Content-Type': ctype, 'User-Agent': 'jamschool-seed-relay/1' },
  });
  return { status: r.status, raw: Buffer.from(await r.arrayBuffer()), ctype: r.headers.get('content-type') || 'application/json' };
}

const kstStamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\D/g, '').slice(0, 14);

async function health() {
  const c = healthCache;
  if (c.data && Date.now() - c.at < (c.data.ok ? 60e3 : 15e3)) return c.data;
  const body = new URLSearchParams({
    nonce: 'probe', tid: 'demotest0m01012611180000000000', ediDate: kstStamp(), mid: 'demotest0m',
    goodsAmt: '1000', mbsReserved: '', hashString: '0'.repeat(64), payData: 'probe',
  }).toString();
  let seed;
  try {
    const r = await forward(upstream('real') + '/payment/v1/approval', body, 'application/x-www-form-urlencoded; charset=utf-8');
    seed = { status: r.status, body: r.raw.toString('utf8').slice(0, 120) };
  } catch (e) {
    seed = { status: 0, error: String(e?.message || e).slice(0, 120) };
  }
  const data = {
    ok: seed.status === 200, seed, region: process.env.AWS_REGION || '', uptime: Math.round((Date.now() - STARTED) / 1000),
    stats: { ...stats }, at: new Date().toISOString(),
  };
  healthCache = { at: Date.now(), data };
  return data;
}

export async function handler(event) {
  const method = event?.requestContext?.http?.method || event?.httpMethod || 'GET';
  const path = String(event?.rawPath || event?.path || '/').replace(/\/+$/, '') || '/';
  const headers = Object.fromEntries(Object.entries(event?.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));

  if (path === '/health' && method === 'GET') {
    if (!authed(headers)) return json(403, { error: 'forbidden' });
    return json(200, await health());
  }
  if (method !== 'POST') return json(404, { error: 'not found' });

  const parts = path.replace(/^\/+/, '').split('/');
  let env = 'real', op = '';
  if (parts.length === 3 && parts[0] === 'seed' && parts[1] === 'test') { env = 'test'; op = parts[2]; }
  else if (parts.length === 2 && parts[0] === 'seed') op = parts[1];
  if (!OPS.has(op)) return json(404, { error: 'not found' });
  if (!authed(headers)) {
    console.log(`거절(키 불일치) ${event?.requestContext?.http?.sourceIp || '-'} ${op}`);
    return json(403, { error: 'forbidden' });
  }

  const body = event.body == null ? Buffer.alloc(0) : Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  if (!body.length || body.length > MAX_BODY) return json(400, { error: 'bad body' });
  const ctype = String(headers['content-type'] || '');
  if (!ctype.startsWith('application/x-www-form-urlencoded')) return json(415, { error: 'form only' });

  const t = Date.now();
  let r;
  try {
    r = await forward(`${upstream(env)}/payment/v1/${op}`, body, ctype);
  } catch (e) {
    stats.fail++; stats.last = `${op} 통신 실패`;
    console.log(`${op} 통신 실패 ${e?.name || 'Error'}`);
    return json(502, { error: 'upstream unreachable' });
  }
  stats[r.status === 200 ? 'ok' : 'fail']++; stats.last = `${op} ${r.status}`;
  console.log(`${env} ${op} → ${r.status} (${Date.now() - t}ms)`);
  return {
    statusCode: r.status,
    headers: { 'Content-Type': r.ctype, 'X-Upstream-Status': String(r.status), 'Cache-Control': 'no-store' },
    body: r.raw.toString('base64'),
    isBase64Encoded: true,
  };
}

export const _test = { reset: () => { healthCache = { at: 0, data: null }; } };
