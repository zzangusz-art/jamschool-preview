// 홈페이지 회원 API(/api/member/*) — tools/serve.mjs 가 넘긴다. 저장·규칙은 store.mjs, 주문·적립은 tools/pay/seedpay.mjs
//   GET  me · orders · points · check?login=
//   POST join · login · logout · update · password · withdraw · find-id · find-pw   (POST 는 X-Jam-Member: 1 헤더 필수 — 다른 사이트에서 몰래 보내는 요청 차단)
import * as M from './store.mjs';
import { earnSweep, memberOrders } from '../pay/seedpay.mjs';
import { sendSms, smsReady } from '../pay/sms.mjs';
import { countEvent } from '../admin/stats.mjs';
import { clientIp } from '../client-ip.mjs';

const json = (res, code, body, cookies) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...(cookies ? { 'Set-Cookie': cookies } : {}) });
  res.end(JSON.stringify(body));
};
const secureOf = req => String(req.headers['x-forwarded-proto'] || '').includes('https') || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers.host || ''));
function readBody(req, max = 16 * 1024) {
  return new Promise((ok, no) => { const c = []; let n = 0; req.on('data', d => { n += d.length; if (n > max) { no(new M.MemberError('요청이 너무 큽니다', 413)); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); });
}
// 가입은 IP마다 10분에 5번
const JOIN = new Map();
const joinLimited = ip => { const now = Date.now(), a = (JOIN.get(ip) || []).filter(t => now - t < 600e3); a.push(now); JOIN.set(ip, a); if (JOIN.size > 5000) JOIN.clear(); return a.length > 5; };

export async function handleMember(req, res) {
  const u = new URL(req.url || '/', 'http://x'), p = u.pathname;
  if (!p.startsWith('/api/member/')) return false;
  const act = p.slice('/api/member/'.length), ip = clientIp(req), secure = secureOf(req);
  try {
    if (req.method === 'GET') {
      const me = M.fromReq(req);
      if (act === 'me') { const c = M.pointCfg(); return json(res, 200, { member: me ? M.view(me) : null, cfg: { on: c.on, rate: c.rate, minUse: c.minUse, earnDays: c.earnDays } }), true; }
      if (act === 'check') { const l = String(u.searchParams.get('login') || '').trim().toLowerCase(); return json(res, 200, { ok: M.loginOk(l) && !M.loginTaken(l), taken: M.loginTaken(l), valid: M.loginOk(l) }), true; }
      if (!me) return json(res, 401, { error: '로그인해 주세요' }), true;
      if (act === 'orders') { earnSweep(me.id); return json(res, 200, { orders: memberOrders(me.id) }), true; }
      if (act === 'points') { earnSweep(me.id); const m = M.get(me.id); return json(res, 200, { points: m.points, available: M.available(m), log: (m.log || []).slice(0, 100), cfg: M.view(m).cfg }), true; }
      return json(res, 404, { error: '없는 주소' }), true;
    }
    if (req.method !== 'POST') return json(res, 405, { error: '허용되지 않는 요청' }), true;
    if (req.headers['x-jam-member'] !== '1') return json(res, 403, { error: '잘못된 요청' }), true;
    let d; try { d = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch (e) { return json(res, e.status || 400, { error: e.status === 413 ? e.message : '요청 형식 오류' }), true; }
    if (act === 'join') {
      if (joinLimited(ip)) return json(res, 429, { error: '잠시 뒤 다시 시도해 주세요' }), true;
      const m = M.join(d);
      try { countEvent(req, { e: 'member_join' }); } catch { /* 집계 실패 무시 */ }
      console.log('[member] 가입', m.id);
      return json(res, 200, { member: M.view(m) }, M.sessionCookies(m, false, secure)), true;
    }
    if (act === 'login') { const m = M.login(d.login, d.pw, ip); return json(res, 200, { member: M.view(m) }, M.sessionCookies(m, !!d.keep, secure)), true; }
    if (act === 'logout') return json(res, 200, { ok: true }, M.clearCookies(secure)), true;
    if (act === 'find-id') return json(res, 200, { list: M.findLogin(d.name, d.tel, ip) }), true;
    if (act === 'find-pw') {
      // 맞는지 틀린지 알려 주지 않는다(가입 여부를 알아내는 데 쓰이지 않게). 문자 연결 전이면 고객센터 안내
      if (!smsReady()) return json(res, 200, { sent: false, cs: true }), true;
      const r = M.resetForSms(d.login, d.name, d.tel, ip);
      if (r) await sendSms(r.m.tel, `[잠스쿨] 임시 비밀번호: ${r.pw}\n로그인한 뒤 마이페이지에서 비밀번호를 바꿔 주세요.`).catch(() => null);
      return json(res, 200, { sent: true }), true;
    }
    const me = M.fromReq(req);
    if (!me) return json(res, 401, { error: '로그인이 풀렸습니다. 다시 로그인해 주세요' }), true;
    if (act === 'update') { const m = M.update(me.id, d); return json(res, 200, { member: M.view(m) }), true; }
    if (act === 'password') { const m = M.changePassword(me.id, d.cur, d.next); return json(res, 200, { ok: true }, M.sessionCookies(m, !!d.keep, secure)), true; }
    if (act === 'withdraw') { M.withdraw(me.id, d.pw); console.log('[member] 탈퇴', me.id); return json(res, 200, { ok: true }, M.clearCookies(secure)), true; }
    return json(res, 404, { error: '없는 주소' }), true;
  } catch (e) {
    if (e instanceof M.MemberError) return json(res, e.status, { error: e.message }), true;
    console.error('[member]', e);
    return json(res, 500, { error: '처리 중 오류가 났습니다. 잠시 뒤 다시 시도해 주세요' }), true;
  }
}
