// 홈페이지 회원·적립금 시험 — node tools/member/test-member.mjs
//   임시 폴더(DATA_DIR)·가짜 가맹점 키만 쓰고, 씨드페이먼츠로는 아무 요청도 보내지 않는다(fetch 를 바꿔 끼움)
//   가입·로그인·쿠키·찾기·탈퇴, 주문서 적립금(잡아 둠 → 승인 차감 / 실패 풀림), 배송 완료 7일 뒤 적립, 부분 환불 회수, 전체 취소 돌려줌, 회원 API
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-mem-'));
Object.assign(process.env, { DATA_DIR: TMP, SEEDPAY_MID: 'testmid00m', SEEDPAY_MERCHANT_KEY: 'TEST-ONLY-KEY-' + crypto.randomBytes(8).toString('hex'), CANONICAL_HOST: 'jamschool.kr' });
delete process.env.SEEDPAY_ENV; delete process.env.NOTIFY_TELEGRAM_TOKEN; delete process.env.SESSION_SECRET; delete process.env.SOLAPI_API_KEY;
const KEY = process.env.SEEDPAY_MERCHANT_KEY, MID = process.env.SEEDPAY_MID;
const M = await import('./store.mjs');
const PAY = await import('../pay/seedpay.mjs');
const { handleMember } = await import('./api.mjs');
const origLog = console.log; console.log = (...a) => { if (!/^\[(pay|member|notify|sms)\]/.test(String(a[0]))) origLog(...a); };
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
let n = 0; const ok = t => origLog(`ok ${++n} ${t}`);

// ── 가짜 요청·응답
let ipN = 0;
function mkReq(method, url, body, headers = {}) {
  const buf = body == null ? Buffer.alloc(0) : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const req = Readable.from([buf]); Object.assign(req, { method, url, headers: { host: 'jamschool.kr', 'x-forwarded-proto': 'https', ...headers }, socket: { remoteAddress: '10.1.0.' + (++ipN % 250) } });
  return req;
}
const mkRes = () => ({ code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; }, end(b) { this.body = b ? String(b) : ''; } });
async function api(method, url, body, cookie, extra = {}) {
  const res = mkRes(), h = { ...(method === 'POST' ? { 'content-type': 'application/json', 'x-jam-member': '1' } : {}), ...(cookie ? { cookie } : {}), ...extra };
  assert.ok(await handleMember(mkReq(method, url, body, h), res), url);
  let j = null; try { j = JSON.parse(res.body); } catch { j = null; }
  return { code: res.code, json: j, cookies: [].concat(res.headers['Set-Cookie'] || []) };
}
async function pay(method, url, body, headers = {}) {
  const res = mkRes(); assert.ok(await PAY.handlePay(mkReq(method, url, body, headers), res), url);
  let j = null; try { j = JSON.parse(res.body); } catch { j = null; } return { code: res.code, json: j, headers: res.headers };
}
const cookieOf = cs => cs.map(c => c.split(';')[0]).filter(c => /^jam_m=./.test(c)).join('; ');
// ── 가짜 씨드페이먼츠
const BASE = 'https://pay.seedpayments.co.kr', APPROVE = `${BASE}/payment/v1/approval`, CANCEL = `${BASE}/payment/v1/cancel`;
let cancelCalls = [];
globalThis.fetch = async (url, opt) => {
  const p = Object.fromEntries(new URLSearchParams(opt.body));
  let out;
  if (url === APPROVE) out = { resultCd: '0000', resultMsg: '정상', tid: p.tid, mid: p.mid, goodsAmt: p.goodsAmt, ordNo: p.mbsReserved, trDt: '20261120', trTm: '120000', fnNm: '신한', cardNo: '4518****1234', appNo: 'A1', quotaMon: '00' };
  else if (url === CANCEL) { cancelCalls.push(p); out = { resultCd: '0000', resultMsg: '취소', tid: 'C' + crypto.randomBytes(4).toString('hex'), otid: p.tid, ccAmt: p.ccAmt || '' }; }
  else throw new Error('예상 못 한 요청 ' + url);
  return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const ORDER = { method: 'card', items: [{ key: '43', qty: 2 }], buyer: { name: '김회원', tel: '01022223333', email: '' }, receiver: { name: '김회원', tel: '01022223333', zip: '06236', addr1: '서울 강남구 테헤란로 1', addr2: '101호' } };
let tidN = 0;
const auth = (f, over = {}) => { const tid = `${f.mid}0101261120${String(100000 + ++tidN)}`, edi = '20261120120001';
  return { resultCd: '0000', nonce: 'N' + tidN, tid, mid: f.mid, method: '01', ordNo: f.ordNo, goodsAmt: f.goodsAmt, mbsReserved: f.mbsReserved, ediDate: edi, payData: 'ENC', signData: sha(tid + f.mid + edi + f.goodsAmt + f.ordNo + KEY), approvalUrl: APPROVE, ...over }; };
const ret = d => pay('POST', '/api/pay/return', new URLSearchParams(d).toString(), { 'content-type': 'application/x-www-form-urlencoded' });
const orderFile = id => path.join(TMP, 'orders', id + '.json'), order = id => JSON.parse(fs.readFileSync(orderFile(id), 'utf8'));
const admin = { id: 'tester', name: '시험' };

try {
  // 1) 가입 규칙
  const base = { login: 'sleepy01', pw: 'abcd1234', name: '김회원', tel: '010-2222-3333', email: 'a@b.co', agreeTerms: true, agreePrivacy: true, age14: true };
  const bad = (d, re) => assert.throws(() => M.join({ ...base, ...d }), re);
  bad({ login: 'Ab' }, /아이디/); bad({ login: 'admin' }, /아이디/); bad({ pw: 'abcdefgh' }, /영문과 숫자/); bad({ pw: 'sleepy01x9' }, /아이디를/); bad({ name: '김' }, /이름/);
  bad({ tel: '0212345678' }, /휴대폰/); bad({ email: 'x@' }, /이메일/); bad({ age14: false }, /필수/);
  const m1 = M.join(base);
  assert.match(m1.id, /^M\d{8}[A-Z0-9]{6}$/); assert.match(m1.hash, /^scrypt\$/); assert.ok(!JSON.stringify(m1).includes('abcd1234'));
  bad({ tel: '01099998888' }, /이미 쓰고 있는 아이디/); bad({ login: 'other02' }, /휴대폰 번호로 가입/);
  ok('가입: 아이디·비밀번호·이름·휴대폰·이메일·필수 동의 확인, 비밀번호는 해시만, 같은 아이디·같은 휴대폰 막음');

  // 2) 로그인·쿠키·잠금·비밀번호 바꾸기
  assert.throws(() => M.login('sleepy01', 'wrong999', '1.1.1.1'), /맞지 않습니다/);
  const lm = M.login('SLEEPY01', 'abcd1234', '1.1.1.1'); assert.equal(lm.id, m1.id);
  const ck = M.sessionCookies(lm, true, true); assert.match(ck[0], /HttpOnly/); assert.match(ck[0], /Max-Age=2592000/); assert.match(ck[1], /^jam_mn=1/);
  const cookie = ck[0].split(';')[0]; assert.equal(M.fromCookie(cookie).id, m1.id);
  assert.equal(M.fromCookie(cookie.slice(0, -2) + 'xx'), null, '서명 위조');
  for (let i = 0; i < 10; i++) assert.throws(() => M.login('sleepy01', 'nope' + i + 'aa', '2.2.2.2'));
  assert.throws(() => M.login('sleepy01', 'abcd1234', '2.2.2.2'), /15분/);
  assert.equal(M.login('sleepy01', 'abcd1234', '3.3.3.3').id, m1.id, '다른 IP 는 그대로');
  M.changePassword(m1.id, 'abcd1234', 'newpass77'); assert.equal(M.fromCookie(cookie), null, '비밀번호 바꾸면 기존 로그인 끊김');
  const cookie2 = M.sessionCookies(M.get(m1.id), false, true)[0].split(';')[0];
  ok('로그인: 대소문자 무시, 서명 쿠키(30일 유지/HttpOnly), 위조 거부, IP·아이디 10번 실패 15분 잠금, 비밀번호 바꾸면 로그인 끊김');

  // 3) 아이디 찾기·내 정보
  assert.deepEqual(M.findLogin('김회원', '01022223333', '4.4.4.4').map(x => x.login), ['sl*****1']);
  assert.deepEqual(M.findLogin('김회원', '01000000000', '4.4.4.4'), []);
  M.update(m1.id, { addr: { zip: '06236', addr1: '서울 강남구 테헤란로 1', addr2: '101호' }, marketing: { sms: true } });
  assert.equal(M.get(m1.id).addr.name, '김회원'); assert.equal(M.get(m1.id).marketing.sms, true);
  ok('아이디 찾기(앞 2자·끝 1자만), 기본 배송지·광고 수신 저장');

  // 4) 주문서 적립금: 규칙 확인 → 잡아 둠 → 결제창 금액 = 주문 금액 - 적립금
  M.adjust(m1.id, 5000, '시험 지급', admin);
  const total = PAY._test.siteData().PRODUCTS.find(p => p.id === 43).price * 2;
  const H = (c = cookie2) => ({ 'content-type': 'application/json', cookie: c });
  assert.equal((await pay('POST', '/api/pay/ready', { ...ORDER, points: 3000 }, { 'content-type': 'application/json' })).code, 401, '로그인 없이 적립금');
  assert.match((await pay('POST', '/api/pay/ready', { ...ORDER, points: 500 }, H())).json.error, /1,000원 이상/);
  assert.match((await pay('POST', '/api/pay/ready', { ...ORDER, points: 9000 }, H())).json.error, /쓸 수 있는 적립금보다/);
  const r1 = await pay('POST', '/api/pay/ready', { ...ORDER, points: 3000 }, H());
  assert.equal(r1.code, 200, JSON.stringify(r1.json)); assert.equal(+r1.json.fields.goodsAmt, total - 3000);
  const o1 = order(r1.json.moid); assert.equal(o1.total, total); assert.equal(o1.amount, total - 3000); assert.equal(o1.pointsUsed, 3000); assert.equal(o1.member.id, m1.id); assert.equal(o1.pointRate, 1);
  assert.equal(M.available(M.get(m1.id)), 2000, '잡아 둔 만큼 못 씀'); assert.equal(M.get(m1.id).points, 5000, '아직 차감 안 됨');
  // 결제 승인 → 차감
  const a1 = await ret(auth(r1.json.fields)); assert.equal(order(r1.json.moid).status, 'paid', JSON.stringify(a1));
  let mm = M.get(m1.id); assert.equal(mm.points, 2000); assert.deepEqual(Object.keys(mm.holds), []); assert.equal(mm.log[0].type, 'use');
  // 비회원 주문은 그대로
  const g = await pay('POST', '/api/pay/ready', ORDER, { 'content-type': 'application/json' }); assert.equal(+g.json.fields.goodsAmt, total); assert.ok(!order(g.json.moid).member);
  ok(`주문서 적립금: 로그인 없으면 401·1,000원 미만·보유보다 많으면 거절, 3,000원 쓰면 결제창 ${total - 3000}원·잡아 둠 → 승인 때 차감(5,000→2,000), 비회원 주문 그대로`);

  // 5) 결제 실패 → 잡아 둔 적립금 풀림
  const r2 = await pay('POST', '/api/pay/ready', { ...ORDER, points: 1500 }, H());
  assert.equal(M.available(M.get(m1.id)), 500);
  await ret({ ...auth(r2.json.fields), resultCd: '9999', resultMsg: '사용자 취소' });
  assert.equal(order(r2.json.moid).status, 'failed'); assert.equal(M.available(M.get(m1.id)), 2000); assert.equal(M.get(m1.id).points, 2000);
  ok('결제 실패: 잡아 둔 1,500원 바로 풀림, 잔액 그대로');

  // 6) 적립: 배송 완료 7일 뒤(반품 기간)부터, 한 번만
  const o = order(r1.json.moid), paid = o.amount;
  o.fulfil = { status: 'delivered', shippedAt: new Date(Date.now() - 9 * 864e5).toISOString(), deliveredAt: new Date(Date.now() - 3 * 864e5).toISOString(), courier: 'logen', invoice: '123456789012' };
  fs.writeFileSync(orderFile(o.moid), JSON.stringify(o));
  assert.equal(PAY.earnSweep(), 0, '7일 전에는 적립 안 함');
  o.fulfil.deliveredAt = new Date(Date.now() - 8 * 864e5).toISOString(); fs.writeFileSync(orderFile(o.moid), JSON.stringify(o));
  assert.equal(PAY.earnSweep(m1.id), 1); assert.equal(PAY.earnSweep(), 0, '두 번 적립 안 함');
  const earned = Math.floor(paid / 100); mm = M.get(m1.id); assert.equal(mm.points, 2000 + earned); assert.equal(mm.earned[o.moid], earned);
  ok(`적립: 배송 완료 3일째는 안 함, 8일째 ${earned}원(결제 ${paid}원 × 1%) 한 번만`);

  // 7) 환불: 부분 → 그만큼 적립 회수, 나머지 전체 → 쓴 적립금 돌려줌 + 남은 적립 회수
  await PAY.refundOrder(o.moid, { amount: 10000, reason: '부분 환불', via: 'pg' }, admin);
  mm = M.get(m1.id); assert.equal(mm.points, 2000 + earned - 100); assert.equal(mm.log[0].type, 'revoke');
  await PAY.refundOrder(o.moid, { amount: paid - 10000, reason: '나머지 환불', via: 'pg' }, admin);
  const oc = order(o.moid); assert.equal(oc.status, 'cancelled');
  mm = M.get(m1.id); assert.equal(mm.points, 2000 + 3000, '쓴 3,000원 돌려받고 적립은 모두 회수');
  assert.deepEqual(mm.log.slice(0, 2).map(l => l.type).sort(), ['restore', 'revoke']);
  await PAY.refundOrder(o.moid, { amount: 1, reason: 'x', via: 'manual' }, admin).catch(() => null);
  assert.equal(M.get(m1.id).points, 5000, '두 번 돌려주지 않음');
  ok('환불: 부분 10,000원 → 적립 100원 회수, 나머지 전부 → 주문 취소·쓴 3,000원 돌려줌·남은 적립 회수, 두 번 안 함');

  // 8) 회원 API(HTTP): 헤더 없는 POST 막기, 가입→쿠키, me·주문·적립금, 아이디 찾기, 비밀번호 찾기(문자 연결 전 안내), 로그아웃
  assert.equal((await api('POST', '/api/member/login', { login: 'sleepy01', pw: 'newpass77' }, null, { 'x-jam-member': '' })).code, 403);
  const j = await api('POST', '/api/member/join', { ...base, login: 'mint_22', tel: '01055556666', pw: 'mintpass9' });
  assert.equal(j.code, 200, JSON.stringify(j.json)); const jc = cookieOf(j.cookies); assert.ok(jc && j.cookies.some(c => /^jam_mn=1/.test(c)));
  const me = await api('GET', '/api/member/me', null, jc); assert.equal(me.json.member.login, 'mint_22'); assert.equal(me.json.member.cfg.rate, 1);
  assert.equal((await api('GET', '/api/member/me')).json.member, null);
  assert.equal((await api('GET', '/api/member/orders')).code, 401);
  const lo = await api('POST', '/api/member/login', { login: 'sleepy01', pw: 'newpass77', keep: true }); const lc = cookieOf(lo.cookies);
  const ords = (await api('GET', '/api/member/orders', null, lc)).json.orders;
  assert.deepEqual(ords.map(x => x.no), [r1.json.moid], '실패 주문은 빼고 회원 주문만'); assert.equal(ords[0].points, 3000); assert.ok(ords[0].t);
  const pts = (await api('GET', '/api/member/points', null, lc)).json; assert.equal(pts.points, 5000); assert.ok(pts.log.length >= 5);
  assert.deepEqual((await api('POST', '/api/member/find-id', { name: '김회원', tel: '01055556666' })).json.list.map(x => x.login), ['mi****2']);
  assert.deepEqual((await api('POST', '/api/member/find-pw', { login: 'mint_22', name: '김회원', tel: '01055556666' })).json, { sent: false, cs: true });
  assert.equal((await api('GET', '/api/member/check?login=mint_22')).json.taken, true);
  const out = await api('POST', '/api/member/logout', {}, jc); assert.ok(out.cookies.every(c => /Max-Age=0/.test(c)));
  ok('회원 API: 헤더 없는 POST 403, 가입 → 로그인 쿠키, me·주문 내역(결제된 회원 주문만)·적립금 내역, 아이디 찾기, 문자 연결 전 비밀번호 찾기 안내, 로그아웃');

  // 9) 탈퇴: 개인정보·적립금 지움, 로그인 안 됨, 주문 파일은 남음
  const w = await api('POST', '/api/member/withdraw', { pw: 'newpass77' }, lc); assert.equal(w.code, 200);
  const gone = M.get(m1.id); assert.equal(gone.status, 'withdrawn'); assert.ok(!gone.name && !gone.tel && !gone.hash && !gone.login && !gone.email);
  assert.throws(() => M.login('sleepy01', 'newpass77', '5.5.5.5'), /맞지 않습니다/); assert.ok(fs.existsSync(orderFile(r1.json.moid)));
  assert.equal(M.loginTaken('sleepy01'), false, '탈퇴한 아이디는 다시 쓸 수 있음');
  ok('탈퇴: 이름·연락처·이메일·비밀번호·아이디 지움, 로그인 안 됨, 주문 기록은 남음, 아이디 다시 쓸 수 있음');

  // 10) 어드민: 임시 비밀번호·적립금 규칙
  const m2 = M.get(M.allIds()[0]); const tp = M.adminReset(m2.id);
  assert.match(tp, /^[a-z]{5}\d{3}$/); assert.equal(M.login('mint_22', tp, '6.6.6.6').tempPw, true);
  assert.throws(() => M.savePointCfg({ rate: 50 }, admin), /적립률/);
  M.savePointCfg({ on: false }, admin); assert.equal(M.pointCfg().on, false);
  const mc = M.sessionCookies(M.get(m2.id), false, true)[0].split(';')[0];
  M.adjust(m2.id, 5000, 'x', admin);
  assert.match((await pay('POST', '/api/pay/ready', { ...ORDER, points: 2000, buyer: { ...ORDER.buyer, tel: '01055556666' } }, H(mc))).json.error, /적립금을 쓸 수 없습니다/);
  ok('어드민: 임시 비밀번호(로그인하면 바꾸라고 표시), 적립률 범위 확인, 적립금 끄면 주문서에서 못 씀');
} finally { console.log = origLog; fs.rmSync(TMP, { recursive: true, force: true }); }
origLog(`\n회원·적립금 시험 ${n}개 통과`);
process.exit(0);
