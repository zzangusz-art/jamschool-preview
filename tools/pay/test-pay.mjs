// 홈페이지 결제 서버(tools/pay/seedpay.mjs) 시험 — 씨드페이먼츠 응답을 흉내 내 실제 결제 없이 흐름을 확인한다
//   node tools/pay/test-pay.mjs
// 가짜 가맹점 키·가짜 텔레그램 토큰·임시 폴더만 쓰고, 씨드페이먼츠·텔레그램으로는 아무 요청도 보내지 않는다(fetch 를 바꿔 끼움).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-pay-'));
process.env.DATA_DIR = TMP;
process.env.SEEDPAY_MID = 'testmid00m';
process.env.SEEDPAY_MERCHANT_KEY = 'TEST-ONLY-KEY-' + crypto.randomBytes(8).toString('hex');
delete process.env.SEEDPAY_ENV;
process.env.CANONICAL_HOST = 'jamschool.kr';
process.env.NOTIFY_TELEGRAM_TOKEN = '123456789:TEST-ONLY-' + crypto.randomBytes(8).toString('hex');
process.env.NOTIFY_TELEGRAM_CHAT_ID = '-1001234567890';
const KEY = process.env.SEEDPAY_MERCHANT_KEY, MID = process.env.SEEDPAY_MID, TG = process.env.NOTIFY_TELEGRAM_TOKEN, CHAT = process.env.NOTIFY_TELEGRAM_CHAT_ID;
const PAY = await import('./seedpay.mjs');
const NOTIFY = await import('./notify.mjs');
// 알림 로그는 화면에 찍지 않고 모아서 확인한다
const notifyLogs = [], origLog = console.log;
console.log = (...a) => { if (a[0] === '[notify]') notifyLogs.push(a.join(' ')); else origLog(...a); };
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// ── 요청·응답 흉내
async function call(method, url, body, headers = {}) {
  const buf = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const req = Readable.from([buf]); Object.assign(req, { method, url, headers: { host: 'jamschool.kr', ...headers }, socket: { remoteAddress: '127.0.0.' + (++ipN % 250) } });
  const res = { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; }, end(b) { this.body = b ? String(b) : ''; } };
  const handled = await PAY.handlePay(req, res);
  assert.ok(handled, `${url} 처리 안 됨`);
  let j = null; try { j = JSON.parse(res.body); } catch { j = null; }
  return { ...res, json: j };
}
let ipN = 0;
const form = o => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
// 가짜 씨드페이먼츠: 요청을 기록하고 정해 둔 응답을 돌려준다
let calls = [], plan = {};
let tgSent = [], tgPlan = null;   // 가짜 텔레그램: 보낸 것을 모으고, tgPlan 이 없으면 성공 응답
globalThis.fetch = async (url, opt) => {
  if (String(url).startsWith('https://api.telegram.org/')) {
    const body = JSON.parse(opt.body); tgSent.push({ url: String(url), body });
    const out = tgPlan ? await tgPlan(body, String(url)) : { ok: true, result: { message_id: tgSent.length } };
    if (out instanceof Error) throw out;
    return new Response(JSON.stringify(out), { status: out.ok ? 200 : 401, headers: { 'Content-Type': 'application/json' } });
  }
  const params = Object.fromEntries(new URLSearchParams(opt.body));
  calls.push({ url, params, raw: opt.body, type: opt.headers['Content-Type'] });
  const h = plan[url];
  if (!h) throw new Error('예상 못 한 요청 ' + url);
  const out = await h(params);
  if (out instanceof Error) throw out;
  return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const BASE = 'https://pay.seedpayments.co.kr';
const APPROVE = `${BASE}/payment/v1/approval`, NETC = `${BASE}/payment/v1/netCancel`, CANCEL = `${BASE}/payment/v1/cancel`;
const okApprove = p => ({ resultCd: '0000', resultMsg: '정상 처리', tid: p.tid, mid: p.mid, method: '01', spmCd: '01', ediDate: p.ediDate, ordNo: lastMoid, goodsNm: '상품', goodsAmt: p.goodsAmt,
  ordNm: '김시험', trxCd: '0', trDt: '20261111', trTm: '153000', fnNm: '신한', cardNo: '4518****1234', appNo: '12345678', appCardCd: '06', acqCardCd: '06', quotaMon: '00', noIntFlg: '0', pointFlg: '0', ezpAuthCd: '' });
const okNet = p => ({ resultCd: '0000', resultMsg: '망취소 성공', tid: 'N' + p.tid.slice(1), otid: p.tid, mid: p.mid, netCanFlg: '1', trxStCd: '9' });
let lastMoid = '';

const ORDER = {
  method: 'card', items: [{ key: '29-12-SS-gray', qty: 1 }, { key: '30', qty: 2 }],
  buyer: { name: '김시험', tel: '010-1234-5678', email: 'test@example.com' },
  receiver: { name: '김시험', tel: '01012345678', zip: '06236', addr1: '서울 강남구 테헤란로 1', addr2: '101호', memo: '문 앞에 놓아 주세요' },
};
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const UA_PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
async function readyOrder(over = {}, ua = UA_PC) {
  const r = await call('POST', '/api/pay/ready', { ...ORDER, ...over }, { 'content-type': 'application/json', 'user-agent': ua });
  assert.equal(r.code, 200, JSON.stringify(r.json)); lastMoid = r.json.moid; return r.json;
}
// 결제창 인증 결과(씨드 → returnUrl). signData = tid + mid + ediDate + goodsAmt + ordNo + 가맹점 키
let tidN = 0;
function auth(f, over = {}) {
  const tid = `${f.mid}01012611111530${String(1000 + ++tidN)}`, edi = '20261111153001';
  return { resultCd: '0000', resultMsg: '인증 성공', nonce: 'NONCE' + crypto.randomBytes(6).toString('hex'), tid, mid: f.mid, method: '01', ordNo: f.ordNo, goodsAmt: f.goodsAmt,
    mbsReserved: f.mbsReserved, ediDate: edi, payData: 'ENC' + crypto.randomBytes(12).toString('base64'), signData: sha(tid + f.mid + edi + f.goodsAmt + f.ordNo + KEY),
    approvalUrl: APPROVE, netCancelUrl: NETC, ...over };
}
const ret = data => call('POST', '/api/pay/return', form(data), { 'content-type': 'application/x-www-form-urlencoded' });
const order = moid => JSON.parse(fs.readFileSync(path.join(TMP, 'orders', moid + '.json'), 'utf8'));
let n = 0; const ok = t => console.log(`OK ${++n}. ${t}`);
const won = v => `${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;

// 1. 설정
{ const r = await call('GET', '/api/pay/config'); assert.equal(r.json.ready, true); assert.equal(r.json.enabled, false); assert.equal(r.json.test, false);
  assert.deepEqual(r.json.methods.map(m => m.id), ['card', 'npay', 'kakaopay']); ok('설정: 키 있음 · 꺼짐 · 운영 서버 · 카드·네이버페이·카카오페이'); }
// 2. 준비: 금액은 서버 계산(3단 바닥형 슈퍼싱글 239,000 + 떡실신 64,000×2), hashString = mid + ediDate + goodsAmt + 가맹점 키
let f;
{
  const r = await readyOrder(); f = r.fields;
  const J = PAY._test.siteData(), expect = J.OPTIONS_29.price['12-SS'] + J.PRODUCTS.find(p => p.id === 30).price * 2;
  assert.equal(f.goodsAmt, String(expect)); assert.equal(f.mid, MID); assert.equal(f.method, 'CARD'); assert.equal(f.ordNo, r.moid); assert.equal(f.mbsReserved, r.moid);
  assert.equal(f.hashString, sha(MID + f.ediDate + f.goodsAmt + KEY)); assert.match(f.ediDate, /^\d{14}$/);
  assert.equal(f.returnUrl, 'https://jamschool.kr/api/pay/return'); assert.equal(r.returnUrl, f.returnUrl); assert.equal(f.ordNm, '김시험'); assert.equal(f.ordTel, '01012345678');
  assert.equal(r.script, `${BASE}/js/pgAsistant.js`); assert.equal(r.mode, 'REAL'); assert.equal(r.base, BASE);
  assert.ok(f.goodsNm.length <= 40 && f.goodsNm.includes('외 1건'), f.goodsNm); assert.ok(!('directType' in f));
  assert.ok(!JSON.stringify(r).includes(KEY), '가맹점 키가 브라우저로 나감');
  assert.equal(order(r.moid).status, 'ready');
  ok(`준비: ${f.goodsAmt}원 서버 계산 · hashString 일치 · 결제창 pgAsistant.js(REAL) · 상품명 「${f.goodsNm}」 · 키 노출 없음`);
}
// 3. 잘못된 주문은 거절
for (const [why, over] of [['없는 옵션', { items: [{ key: '29-12-XL-gray', qty: 1 }] }], ['수량 0', { items: [{ key: '30', qty: 0 }] }], ['없는 상품', { items: [{ key: '999', qty: 1 }] }],
  ['3단을 옵션 없이', { items: [{ key: '29', qty: 1 }] }], ['결제수단', { method: 'payco' }], ['전화번호', { buyer: { ...ORDER.buyer, tel: '123' } }]]) {
  const r = await call('POST', '/api/pay/ready', { ...ORDER, ...over }); assert.equal(r.code, 400, why);
}
ok('준비 거절: 없는 옵션·수량 0·없는 상품·3단 옵션 누락·결제수단·전화번호');
// 4. 정상 승인
{
  calls = []; plan = { [APPROVE]: okApprove }; tgSent = [];
  const r = await ret(auth(f));
  assert.equal(r.code, 303); const o = order(f.ordNo);
  assert.equal(r.headers.Location, `/order-complete.html?o=${o.moid}&t=${o.token}`);
  assert.equal(o.status, 'paid'); assert.equal(o.pg.authCode, '12345678'); assert.equal(o.pg.cardName, '신한'); assert.equal(calls.length, 1);
  const p = calls[0].params;
  assert.equal(calls[0].url, APPROVE); assert.match(calls[0].type, /x-www-form-urlencoded/);
  assert.equal(p.goodsAmt, f.goodsAmt); assert.equal(p.mid, MID); assert.ok(p.nonce && p.payData && p.tid); assert.equal(p.mbsReserved, o.moid);
  assert.equal(p.hashString, sha(MID + p.ediDate + p.goodsAmt + KEY)); assert.ok(!calls[0].raw.includes(KEY));
  ok('승인: signData 확인 → 승인 요청(nonce·tid·payData·hashString) → 응답 거래번호·금액 확인 → 결제 완료');
  // 결제 완료 알림: 주문번호·상품·수량·금액·받는 분·어드민 링크만, 전화번호·주소·이메일·카드번호·키 없음
  await NOTIFY.settled();
  assert.equal(tgSent.length, 1, '결제 완료 알림 1건');
  const m = tgSent[0], t = m.body.text;
  assert.equal(m.url, `https://api.telegram.org/bot${TG}/sendMessage`); assert.equal(m.body.chat_id, CHAT); assert.equal(m.body.parse_mode, 'HTML');
  assert.match(t, /새 결제 주문/); assert.ok(t.includes(`주문번호 ${o.moid}`));
  for (const x of o.items) assert.ok(t.includes(x.name) && t.includes(`× ${x.qty}`), x.name);
  assert.ok(t.includes(won(o.amount)), won(o.amount)); assert.ok(t.includes('받는 분 김시험'));
  assert.ok(t.includes(`<a href="https://jamschool.kr/admin#/payments/${o.moid}">`), '어드민 상세 링크');
  for (const bad of ['01012345678', '010-1234-5678', '1234-5678', '06236', '테헤란로', '101호', '문 앞에', 'test@example.com', '4518****', o.token, KEY, TG]) assert.ok(!t.includes(bad), `알림에 들어가면 안 되는 값: ${bad}`);
  ok(`결제 완료 알림: 텔레그램 1건 · ${won(o.amount)} · 어드민 링크 · 전화번호·주소·이메일·카드번호 없음`);
  // 같은 인증 결과를 다시 보내도 두 번 승인하지 않음
  calls = []; const r2 = await ret(auth(f)); assert.equal(r2.code, 303); assert.equal(calls.length, 0); assert.equal(order(f.ordNo).status, 'paid');
  await NOTIFY.settled(); assert.equal(tgSent.length, 1, '중복 전송에 알림 또 보냄');
  ok('중복 전송: 승인 요청·알림을 다시 보내지 않음');
  // 주문 완료 화면 조회
  const v = await call('GET', `/api/pay/order?o=${o.moid}&t=${o.token}`); assert.equal(v.json.status, 'paid'); assert.equal(v.json.name, '김*험'); assert.ok(!JSON.stringify(v.json).includes('101호'));
  assert.match(v.json.payLabel, /신한 · 일시불/);
  const bad = await call('GET', `/api/pay/order?o=${o.moid}&t=wrong`); assert.equal(bad.code, 404);
  ok('완료 화면: 조회키로만 열림 · 이름 가림 · 상세 주소 없음');
}
// 5. 위조·오류 — 승인 요청을 보내지 않고 실패 처리
for (const [why, mk] of [
  ['signData 위조', a => ({ ...a, signData: 'a'.repeat(64) })],
  ['금액 위조(signData 까지 맞춤)', a => ({ ...a, goodsAmt: '1000', signData: sha(a.tid + a.mid + a.ediDate + '1000' + a.ordNo + KEY) })],
  ['다른 상점', a => ({ ...a, mid: 'other00m' })],
  ['승인 주소 위조', a => ({ ...a, approvalUrl: 'https://evil.example.com/payment/v1/approval' })],
  ['망취소 주소 위조', a => ({ ...a, netCancelUrl: 'https://evil.example.com/payment/v1/netCancel' })],
  ['payData 없음', a => ({ ...a, payData: '' })],
  ['인증 실패', a => ({ ...a, resultCd: '9999', resultMsg: '사용자 취소' })],
]) {
  const g = await readyOrder(); calls = []; plan = { [APPROVE]: okApprove }; tgSent = [];
  const r = await ret(mk(auth(g.fields))); assert.equal(r.code, 303); assert.equal(order(g.moid).status, 'failed', why); assert.equal(calls.length, 0, why);
  await NOTIFY.settled(); assert.equal(tgSent.length, 0, why + ': 실패 주문은 알리지 않음');
}
ok('거절: signData 위조·금액 위조·다른 상점·승인/망취소 주소 위조·payData 없음·인증 실패 → 승인 요청·알림 안 보냄');
// 6. 승인 응답이 없거나 이상하면 망취소(hashString = mid + ediDate + tid + 가맹점 키)
for (const [why, approve, net, status] of [
  ['승인 시간 초과', () => Object.assign(new Error('timeout'), { name: 'TimeoutError' }), okNet, 'failed'],
  ['승인 응답 금액 불일치', p => ({ ...okApprove(p), goodsAmt: '100' }), okNet, 'failed'],
  ['승인 응답 거래번호 불일치', p => ({ ...okApprove(p), tid: 'other' }), okNet, 'failed'],
  ['승인 시간 초과 + 망취소 실패', () => new Error('reset'), () => ({ resultCd: '2020', resultMsg: '망상취소 허용시간 초과' }), 'check'],
]) {
  const g = await readyOrder(); calls = []; plan = { [APPROVE]: approve, [NETC]: net }; tgSent = [];
  const a = auth(g.fields); const r = await ret(a); assert.equal(r.code, 303);
  const o = order(g.moid); assert.equal(o.status, status, why);
  const nc = calls.find(c => c.url === NETC); assert.ok(nc, why + ': 망취소 안 함');
  assert.equal(nc.params.tid, a.tid); assert.equal(nc.params.ordNo, g.moid); assert.ok(nc.params.ccMsg); assert.equal(nc.params.hashString, sha(MID + nc.params.ediDate + a.tid + KEY));
  await NOTIFY.settled();
  if (status === 'check') {
    assert.equal(tgSent.length, 1, why + ': 확인 필요 알림');
    const t = tgSent[0].body.text; assert.match(t, /결제 확인 필요/); assert.match(t, /사유 .*망취소/); assert.ok(t.includes(`주문번호 ${g.moid}`)); assert.ok(t.includes(`/admin#/payments/${g.moid}`));
  } else assert.equal(tgSent.length, 0, why + ': 망취소된 주문은 알리지 않음');
}
ok('망취소: 승인 시간 초과·응답 금액/거래번호 불일치 → 망취소, 망취소도 실패하면 \'확인 필요\' + 텔레그램 알림(사유 포함)');
// 7. 승인 거절(카드 한도 등)은 망취소 없이 실패
{ const g = await readyOrder(); calls = []; plan = { [APPROVE]: () => ({ resultCd: '3011', resultMsg: '카드 한도 초과' }) };
  await ret(auth(g.fields)); const o = order(g.moid); assert.equal(o.status, 'failed'); assert.match(o.fail.msg, /한도/); assert.ok(!calls.some(c => c.url === NETC)); ok('승인 거절: 실패 표시, 망취소 없음'); }
// 8. 관리자: 목록·발송·취소·켜기
{
  const list = PAY.listOrders(); assert.ok(list.some(x => x.moid === f.ordNo && x.status === 'paid')); assert.ok(list.every(x => x.status !== 'failed'));
  assert.ok(PAY.listOrders({ all: true }).length > list.length);
  const u = { id: 'owner1', name: '관리자', role: 'owner' };
  assert.equal(PAY.setFulfil(f.ordNo, 'shipped', u).fulfil.status, 'shipped');
  const tid = order(f.ordNo).pg.tid;
  calls = []; plan = { [CANCEL]: p => ({ resultCd: '0000', resultMsg: '취소 성공', tid: 'C' + p.tid.slice(1), otid: p.tid, mid: p.mid, ccAmt: order(f.ordNo).amount, partCanFlg: '0', trxStCd: '1' }) };
  const c = await PAY.cancelOrder(f.ordNo, '고객 요청 취소', u);
  assert.equal(c.status, 'cancelled'); assert.equal(c.cancel.check, 'ok'); assert.ok(!('token' in c));
  const p = calls[0].params; assert.equal(p.tid, tid); assert.equal(p.ordNo, f.ordNo); assert.equal(p.partCanFlg, '0'); assert.equal(p.hashString, sha(MID + p.ediDate + tid + KEY));
  assert.equal(p.ccMsg, '고객 요청 취소'); assert.match(calls[0].raw, /ccMsg=%EA%B3%A0%EA%B0%9D/, '취소 사유 UTF-8 인코딩');
  await assert.rejects(PAY.cancelOrder(f.ordNo, 'x', u), /결제 완료된 주문만/);
  const s = PAY.setSettings({ enabled: true }, u); assert.equal(s.enabled, true); assert.equal(s.notiUrl, 'https://jamschool.kr/api/pay/noti');
  const cfg = await call('GET', '/api/pay/config'); assert.equal(cfg.json.enabled, true);
  ok('관리자: 결제 주문 목록 · 발송 처리 · 전액 취소(hashString·UTF-8 사유) · 중복 취소 막음 · 결제 켜기');
}
// 8-2. 네이버페이·카카오페이 버튼: 휴대폰은 바로 열기(directType=1 · directCardCode=00 · ezpAuthCd 02·05), PC 는 기본 결제창
for (const [id, ezp, label] of [['kakaopay', '02', '카카오페이'], ['npay', '05', '네이버페이']]) {
  for (const ua of [UA_PHONE, UA_IPHONE]) {
    const g = await readyOrder({ method: id }, ua);
    const x = g.fields; assert.equal(x.method, 'CARD'); assert.equal(x.directType, '1'); assert.equal(x.directCardCode, '00'); assert.equal(x.ezpAuthCd, ezp);
    assert.equal(x.directCardQuota, '00'); assert.equal(x.directCardPointFlag, '0'); assert.equal(x.hashString, sha(MID + x.ediDate + x.goodsAmt + KEY));
    calls = []; plan = { [APPROVE]: p => ({ ...okApprove(p), ezpAuthCd: ezp }) };
    await ret(auth(x)); const o = order(g.moid); assert.equal(o.status, 'paid', id); assert.equal(o.method, id); assert.ok(o.pg.cardName.startsWith(label), o.pg.cardName);
  }
  const pc = await readyOrder({ method: id }, UA_PC);
  for (const k of ['directType', 'directCardCode', 'ezpAuthCd', 'directCardQuota', 'directCardPointFlag']) assert.ok(!(k in pc.fields), `PC 에 ${k}`);
  assert.equal(pc.fields.method, 'CARD');
}
ok('간편결제: 휴대폰(안드로이드·아이폰)은 카카오페이 02·네이버페이 05 바로 열기 · 승인까지 · PC 는 기본 결제창(바로 열기 값 없음)');
// 8-3. 결제통보(Webhook): 허용 IP만 · 가맹점 관리자 취소 반영 · 승인 놓친 거래 맞추기 · 재전송 무시
{
  const SEED_IP = { 'x-real-ip': '13.125.71.243' }, noti = (d, h = SEED_IP) => call('POST', '/api/pay/noti', d, { 'content-type': 'application/json', ...h });
  let r = await noti({ resultCd: '0000', mid: MID, ordNo: 'x' }, { 'x-real-ip': '8.8.8.8' }); assert.equal(r.code, 403);
  r = await noti({ resultCd: '0000', mid: MID, ordNo: 'x' }, { 'x-real-ip': '8.8.8.8', 'cf-connecting-ip': '13.125.71.243' }); assert.equal(r.code, 403, 'CF-Connecting-IP 위조');
  // 결제 완료 주문 → 가맹점 관리자에서 전체 취소 통보
  const g = await readyOrder(); calls = []; plan = { [APPROVE]: okApprove }; await ret(auth(g.fields));
  const tid = order(g.moid).pg.tid;
  const cancelNoti = { resultCd: '0000', resultMsg: '취소', tid: 'C' + tid.slice(1), otid: tid, mid: MID, trxStCd: '1', method: '01', ccAmt: String(order(g.moid).amount), ordNo: g.moid, partCanFlg: '0', netCanFlg: '0' };
  r = await noti(cancelNoti); assert.equal(r.code, 200); assert.equal(r.body, 'OK');
  assert.equal(order(g.moid).status, 'cancelled'); assert.equal(order(g.moid).cancel.by, 'seed');
  const h1 = order(g.moid).history.length; r = await noti(cancelNoti); assert.equal(r.code, 200); assert.equal(order(g.moid).history.length, h1, '재전송은 무시');
  // 승인 응답을 놓쳐 '확인 필요'로 남은 주문 → 승인 통보로 결제 완료
  const k = await readyOrder(); calls = []; plan = { [APPROVE]: () => new Error('reset'), [NETC]: () => ({ resultCd: '2020', resultMsg: '허용시간 초과' }) }; tgSent = [];
  const a = auth(k.fields); await ret(a); assert.equal(order(k.moid).status, 'check');
  r = await noti({ resultCd: '0000', tid: a.tid, mid: MID, method: '01', ordNo: k.moid, goodsAmt: k.fields.goodsAmt, appNo: '99887766', fnNm: '국민', quotaMon: '03', trDt: '20261111', trTm: '153500' });
  assert.equal(r.code, 200); const o = order(k.moid); assert.equal(o.status, 'paid'); assert.equal(o.pg.authCode, '99887766');
  await NOTIFY.settled(); assert.equal(tgSent.filter(x => /새 결제 주문/.test(x.body.text)).length, 1, '맞춘 뒤 결제 완료 알림');
  // 금액이 다른 승인 통보는 결제 완료로 바꾸지 않는다 · 다른 상점·없는 주문은 200 으로 끝(재전송 막기)
  const m = await readyOrder(); calls = []; plan = { [APPROVE]: () => new Error('reset'), [NETC]: () => ({ resultCd: '2020' }) }; const b = auth(m.fields); await ret(b);
  r = await noti({ resultCd: '0000', tid: b.tid, mid: MID, ordNo: m.moid, goodsAmt: '100' }); assert.equal(r.code, 200); assert.equal(order(m.moid).status, 'check');
  assert.equal((await noti({ resultCd: '0000', mid: 'other00m', ordNo: m.moid })).code, 200); assert.equal((await noti({ resultCd: '0000', mid: MID, ordNo: 'JS00000000000000AAAAAA' })).code, 200);
  assert.equal((await noti('not json')).code, 400);
  ok('결제통보: 허용 IP만(위조 차단) · 관리자 취소 반영 · 승인 놓친 거래를 결제 완료로 · 금액 다르면 그대로 · 재전송 무시');
}
// 9. 결과 인코딩: utf-8(기본)·euc-kr 모두 읽는다
{ const d = PAY._test.parseForm(Buffer.from('resultMsg=%C0%CE%C1%F5+%BC%BA%B0%F8&ordNo=JS1')); assert.equal(d.resultMsg, '인증 성공');
  const u = PAY._test.parseForm(Buffer.from('resultMsg=' + encodeURIComponent('인증 성공'))); assert.equal(u.resultMsg, '인증 성공'); ok('결과 인코딩: utf-8·euc-kr 모두 읽음'); }
// 9-2. 테스트 서버(SEEDPAY_ENV=test): devpay 주소·TEST 모드
{ process.env.SEEDPAY_ENV = 'test'; const r = await readyOrder(); assert.equal(r.script, 'https://devpay.seedpayments.co.kr/js/pgAsistant.js'); assert.equal(r.mode, 'TEST');
  assert.equal(PAY._test.URLS().approval, 'https://devpay.seedpayments.co.kr/payment/v1/approval'); delete process.env.SEEDPAY_ENV; ok('테스트 서버 전환: SEEDPAY_ENV=test → devpay·TEST'); }
// 10. 주문 알림(텔레그램): 실패·지연이 결제를 막지 않음 · 변수 없으면 안 보냄 · 문구 이스케이프 · 어드민 시험/대화방 찾기
const payOnce = async () => { const g = await readyOrder(); calls = []; plan = { [APPROVE]: okApprove }; const r = await ret(auth(g.fields)); return { g, r, o: order(g.moid) }; };
{
  // 텔레그램이 응답하지 않는 동안에도 승인·저장·완료 화면 이동은 바로 끝난다
  let release; tgPlan = () => new Promise(res => { release = res; }); tgSent = []; notifyLogs.length = 0;
  const a = await payOnce();
  assert.equal(a.r.code, 303); assert.match(a.r.headers.Location, /^\/order-complete\.html\?o=JS/); assert.equal(a.o.status, 'paid');
  assert.equal(tgSent.length, 1); assert.equal(typeof release, 'function', '알림 요청이 아직 끝나지 않은 상태');
  release(new Error('network down')); await NOTIFY.settled();
  assert.ok(notifyLogs.some(l => l.includes('실패') && l.includes(a.g.moid) && l.includes('network down')), notifyLogs.join('\n'));
  // 토큰이 틀린 응답(401)·fetch 예외(메시지에 토큰이 섞여도 로그에는 가림)
  for (const plan2 of [() => ({ ok: false, error_code: 401, description: 'Unauthorized' }), () => { throw new Error('boom ' + TG); }]) {
    tgPlan = plan2; notifyLogs.length = 0;
    const b = await payOnce(); assert.equal(b.r.code, 303); assert.equal(b.o.status, 'paid');
    await NOTIFY.settled(); assert.ok(notifyLogs.some(l => l.includes('실패') && l.includes(b.g.moid)), notifyLogs.join('\n'));
    assert.ok(!notifyLogs.join('\n').includes(TG), '로그에 텔레그램 토큰이 찍힘');
  }
  assert.ok(notifyLogs.join('\n').includes('***'));
  tgPlan = null;
  ok('알림 실패: 응답 없음·401·예외여도 결제 완료·완료 화면 이동은 그대로, 실패는 로그만(토큰 가림)');
}
{
  // 변수 하나라도 없으면 보내지 않음
  for (const k of ['NOTIFY_TELEGRAM_CHAT_ID', 'NOTIFY_TELEGRAM_TOKEN']) {
    const keep = process.env[k]; delete process.env[k]; tgSent = [];
    const a = await payOnce(); assert.equal(a.o.status, 'paid'); await NOTIFY.settled(); assert.equal(tgSent.length, 0, k + ' 없이 보냄');
    process.env[k] = keep;
  }
  ok('알림 변수(NOTIFY_TELEGRAM_TOKEN·CHAT_ID) 없으면: 결제는 그대로, 알림 요청 없음');
}
{
  // HTML 이스케이프·금액 쉼표·여러 대화방
  const t = NOTIFY.orderText({ moid: 'JS1', items: [{ name: '<b>매트&리스', opt: 'A/B', qty: 3 }], amount: 1234567, payLabel: '카드', receiver: { name: '김<i>' } }, 'check', '망취소 실패 <x>');
  assert.ok(t.includes('&lt;b&gt;매트&amp;리스 (A/B) × 3')); assert.ok(t.includes('1,234,567원')); assert.ok(!t.includes('<i>')); assert.ok(t.includes('사유 망취소 실패 &lt;x&gt;')); assert.match(t, /^<b>⚠️ \[잠스쿨\] 결제 확인 필요<\/b>/);
  process.env.NOTIFY_TELEGRAM_CHAT_ID = `${CHAT}, 5551234 ,abc`; tgSent = [];
  assert.deepEqual(NOTIFY.notifyStatus(), { channel: 'telegram', token: true, chats: 2, badChats: 1 });
  const a = await payOnce(); await NOTIFY.settled(); assert.deepEqual(tgSent.map(x => x.body.chat_id), [CHAT, '5551234']); assert.equal(a.o.status, 'paid');
  process.env.NOTIFY_TELEGRAM_CHAT_ID = CHAT;
  ok('알림 문구: HTML 이스케이프 · 금액 쉼표 · 대화방 여러 곳(형식 틀린 ID 는 빼고 어드민에 표시)');
}
{
  // 어드민 시험 알림 · 대화방 ID 찾기
  const u = { id: 'owner1', name: '관리자', role: 'owner' };
  tgSent = []; let r = await NOTIFY.notifyTest(u);
  assert.equal(r.ok, true, r.msg); assert.equal(tgSent.length, 1); assert.match(tgSent[0].body.text, /주문 알림 시험/); assert.ok(tgSent[0].url.endsWith('/sendMessage'));
  delete process.env.NOTIFY_TELEGRAM_CHAT_ID; tgSent = [];
  tgPlan = (b, url) => url.endsWith('/getUpdates') ? { ok: true, result: [
    { update_id: 1, message: { chat: { id: 5551234, type: 'private', first_name: '잠스쿨', last_name: '대표' } } },
    { update_id: 2, my_chat_member: { chat: { id: -100777, type: 'supergroup', title: '잠스쿨 주문' } } },
    { update_id: 3, message: { chat: { id: 5551234, type: 'private', first_name: '잠스쿨' } } }] } : { ok: false, description: '예상 못 한 요청' };
  r = await NOTIFY.notifyTest(u);
  assert.equal(r.ok, false); assert.deepEqual(r.chats, [{ id: '5551234', type: 'private', name: '잠스쿨 대표' }, { id: '-100777', type: 'supergroup', name: '잠스쿨 주문' }]); assert.match(r.msg, /NOTIFY_TELEGRAM_CHAT_ID/);
  assert.equal(tgSent.length, 1); assert.ok(tgSent[0].url.endsWith('/getUpdates'));
  tgPlan = () => ({ ok: false, description: 'Unauthorized' }); r = await NOTIFY.notifyTest(u); assert.equal(r.ok, false); assert.match(r.msg, /Unauthorized/); assert.ok(!r.msg.includes(TG));
  delete process.env.NOTIFY_TELEGRAM_TOKEN; r = await NOTIFY.notifyTest(u); assert.equal(r.ok, false); assert.match(r.msg, /NOTIFY_TELEGRAM_TOKEN/);
  process.env.NOTIFY_TELEGRAM_TOKEN = TG; process.env.NOTIFY_TELEGRAM_CHAT_ID = CHAT; tgPlan = null;
  ok('어드민: 시험 알림 보내기 · 대화방 ID 없으면 봇에게 말 건 대화방 찾기(중복 제거) · 토큰 오류·변수 없음 안내');
}
console.log = origLog;

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n결제 서버 시험 ${n}개 통과`);
