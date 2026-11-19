// 잠스쿨 씨드페이먼츠 한국 중계 — Supabase Edge Function 판(함수 이름 seed-relay, 서울 ap-northeast-2 로 강제 실행)
//
// 왜: 씨드 승인 서버가 해외 IP(Railway 미국)를 403 으로 막는다. 이 함수를 서울 리전에서 돌리면 서울 IP 로 나간다.
// 규칙은 seed-relay.py·lambda/index.mjs 와 같다(우리 서버 seedpay.mjs 는 그대로 쓴다).
//   POST /seed/<op>        op = approval | netCancel | cancel  → https://pay.seedpayments.co.kr/payment/v1/<op>
//   POST /seed/test/<op>   씨드 테스트 서버(devpay)로
//   GET  /health           씨드 승인 주소가 이 함수를 받아 주는지(가짜 상점 demotest0m), 실행 리전·나가는 IP
//   - X-Relay-Key 헤더가 맞아야 한다(아니면 403). 그 밖의 주소는 404. 본문은 기록하지 않는다.
// 설정: 함수 비밀값 RELAY_KEY_SHA256 = 키 원문의 SHA-256(원문 키는 Railway SEEDPAY_RELAY_KEY 에만)
//       JWT 검증 끔(우리 서버는 X-Relay-Key 로만 인증)
// Railway: SEEDPAY_RELAY_URL=https://<프로젝트>.supabase.co/functions/v1/seed-relay?forceFunctionRegion=ap-northeast-2
//          (seedpay.mjs 가 이 값을 보고 x-region 헤더도 같이 보낸다)
// 타입 표기 없이 쓴다 — Supabase(Deno)에서도, 이 PC 의 Node 시험에서도 그대로 돈다.

const OPS = new Set(['approval', 'netCancel', 'cancel']);
const MAX_BODY = 64 * 1024;
const TIMEOUT = 25000;
const STARTED = Date.now();
const stats = { ok: 0, fail: 0, last: '' };
let healthCache = { at: 0, data: null };

const env = k => (globalThis.Deno ? globalThis.Deno.env.get(k) : globalThis.process?.env?.[k]) || '';
const upstream = which => which === 'test'
  ? (env('RELAY_UPSTREAM_TEST') || 'https://devpay.seedpayments.co.kr')
  : (env('RELAY_UPSTREAM') || 'https://pay.seedpayments.co.kr');

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function authed(req) {
  const want = env('RELAY_KEY_SHA256').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) return false;
  const got = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(req.headers.get('x-relay-key') || '')));
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

async function forward(url, body, ctype) {
  const r = await fetch(url, {
    method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'Content-Type': ctype, 'User-Agent': 'jamschool-seed-relay/1' },
  });
  return { status: r.status, raw: new Uint8Array(await r.arrayBuffer()), ctype: r.headers.get('content-type') || 'application/json' };
}

const kstStamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\D/g, '').slice(0, 14);

async function egressIp() {
  if (env('RELAY_SKIP_IP')) return '';
  try { const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) }); return (await r.json()).ip || ''; } catch { return ''; }
}

// Supabase 무료 프로젝트는 일주일 동안 DB 사용이 없으면 일시정지된다 → 상태 확인 때마다 relay_ping 한 줄을 갱신한다.
// (표 relay_ping 은 SQL 로 만들어 둠: id int primary key, at timestamptz, region text — service_role 만 쓰기)
// jamschool.kr 서버가 6시간마다 /health 를 부르므로 결제가 없는 날에도 DB 가 쓰인다.
function serviceKey() {
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY'); if (legacy) return legacy;
  const raw = env('SUPABASE_SECRET_KEYS'); if (!raw) return '';
  try { const j = JSON.parse(raw); return typeof j === 'string' ? j : (j.default || Object.values(j)[0] || ''); } catch { return raw.startsWith('sb_secret_') ? raw : ''; }
}
async function touchDb() {
  const url = env('SUPABASE_URL'), key = serviceKey();
  if (!url || !key) return { ok: false, error: 'no key' };
  try {
    const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
    const r = await fetch(`${url}/rest/v1/relay_ping?on_conflict=id`, {
      method: 'POST', headers, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ id: 1, at: new Date().toISOString(), region: env('SB_REGION') || null }),
    });
    return r.ok ? { ok: true, status: r.status } : { ok: false, status: r.status, error: (await r.text()).slice(0, 120) };
  } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 80) }; }
}

async function health() {
  const c = healthCache;
  if (c.data && Date.now() - c.at < (c.data.ok ? 60e3 : 15e3)) return c.data;
  const body = new URLSearchParams({
    nonce: 'probe', tid: 'demotest0m01012611180000000000', ediDate: kstStamp(), mid: 'demotest0m',
    goodsAmt: '1000', mbsReserved: '', hashString: '0'.repeat(64), payData: 'probe',
  }).toString();
  let seed;
  const dbP = touchDb();
  try {
    const r = await forward(upstream('real') + '/payment/v1/approval', body, 'application/x-www-form-urlencoded; charset=utf-8');
    seed = { status: r.status, body: new TextDecoder().decode(r.raw).slice(0, 120) };
  } catch (e) {
    seed = { status: 0, error: String(e?.message || e).slice(0, 120) };
  }
  const data = {
    ok: seed.status === 200, seed, db: await dbP, region: env('SB_REGION'), ip: await egressIp(),
    uptime: Math.round((Date.now() - STARTED) / 1000), stats: { ...stats }, at: new Date().toISOString(),
  };
  healthCache = { at: Date.now(), data };
  return data;
}

export async function handle(req) {
  // 경로: /functions/v1/seed-relay/seed/approval 또는 /seed-relay/seed/approval → /seed/approval
  let parts = new URL(req.url).pathname.split('/').filter(Boolean);
  if (parts[0] === 'functions' && parts[1] === 'v1') parts = parts.slice(2);
  if (parts.length && parts[0] !== 'seed' && parts[0] !== 'health') parts = parts.slice(1);

  if (parts.length === 1 && parts[0] === 'health' && req.method === 'GET') {
    if (!(await authed(req))) return json(403, { error: 'forbidden' });
    return json(200, await health());
  }
  if (req.method !== 'POST') return json(404, { error: 'not found' });

  let which = 'real', op = '';
  if (parts.length === 3 && parts[0] === 'seed' && parts[1] === 'test') { which = 'test'; op = parts[2]; }
  else if (parts.length === 2 && parts[0] === 'seed') op = parts[1];
  if (!OPS.has(op)) return json(404, { error: 'not found' });
  if (!(await authed(req))) {
    console.log(`거절(키 불일치) ${op}`);
    return json(403, { error: 'forbidden' });
  }

  const body = new Uint8Array(await req.arrayBuffer());
  if (!body.length || body.length > MAX_BODY) return json(400, { error: 'bad body' });
  const ctype = req.headers.get('content-type') || '';
  if (!ctype.startsWith('application/x-www-form-urlencoded')) return json(415, { error: 'form only' });

  const t = Date.now();
  let r;
  try {
    r = await forward(`${upstream(which)}/payment/v1/${op}`, body, ctype);
  } catch (e) {
    stats.fail++; stats.last = `${op} 통신 실패`;
    console.log(`${op} 통신 실패 ${e?.name || 'Error'}`);
    return json(502, { error: 'upstream unreachable' });
  }
  stats[r.status === 200 ? 'ok' : 'fail']++; stats.last = `${op} ${r.status}`;
  console.log(`${which} ${op} → ${r.status} (${Date.now() - t}ms)`);
  return new Response(r.raw, {
    status: r.status,
    headers: { 'Content-Type': r.ctype, 'X-Upstream-Status': String(r.status), 'Cache-Control': 'no-store' },
  });
}

export const _test = { reset: () => { healthCache = { at: 0, data: null }; } };

if (globalThis.Deno) globalThis.Deno.serve(handle);
