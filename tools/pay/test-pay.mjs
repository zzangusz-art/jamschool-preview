// 홈페이지 결제 서버(tools/pay/nicepay.mjs) 시험 — 나이스페이 응답을 흉내 내 실제 결제 없이 흐름을 확인한다
//   node tools/pay/test-pay.mjs
// 가짜 상점키·임시 폴더만 쓰고, 나이스페이로는 아무 요청도 보내지 않는다(fetch 를 바꿔 끼움).
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
process.env.CANONICAL_HOST = 'jamschool.kr';
const KEY = process.env.SEEDPAY_MERCHANT_KEY, MID = process.env.SEEDPAY_MID;
const PAY = await import('./nicepay.mjs');
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
// 가짜 나이스페이: 요청을 기록하고 정해 둔 응답을 돌려준다
let calls = [], plan = {};
globalThis.fetch = async (url, opt) => {
  const params = Object.fromEntries(new URLSearchParams(opt.body));
  calls.push({ url, params, raw: opt.body });
  const h = plan[url];
  if (!h) throw new Error('예상 못 한 요청 ' + url);
  const out = await h(params);
  if (out instanceof Error) throw out;
  return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const APPROVE = 'https://dc1-api.nicepay.co.kr/webapi/pay_process.jsp', NETC = 'https://dc1-api.nicepay.co.kr/webapi/cancel_process.jsp', CANCEL = 'https://pg-api.nicepay.co.kr/webapi/cancel_process.jsp';
const okApprove = p => ({ ResultCode: '3001', ResultMsg: '카드 결제 성공', TID: p.TID, MID: p.MID, Moid: lastMoid, Amt: p.Amt.padStart(12, '0'), AuthCode: '12345678', AuthDate: '261110153000', CardName: '신한', CardNo: '4518****1234', CardQuota: '00', PayMethod: 'CARD', Signature: sha(p.TID + p.MID + p.Amt.padStart(12, '0') + KEY) });
const okNet = p => ({ ResultCode: '2001', ResultMsg: '취소 성공', TID: p.TID, MID: p.MID, CancelAmt: p.Amt, Signature: sha(p.TID + p.MID + p.Amt + KEY) });
let lastMoid = '';

const ORDER = {
  method: 'card', items: [{ key: '29-12-SS-gray', qty: 1 }, { key: '30', qty: 2 }],
  buyer: { name: '김시험', tel: '010-1234-5678', email: 'test@example.com' },
  receiver: { name: '김시험', tel: '01012345678', zip: '06236', addr1: '서울 강남구 테헤란로 1', addr2: '101호', memo: '문 앞에 놓아 주세요' },
};
async function readyOrder(over = {}) {
  const r = await call('POST', '/api/pay/ready', { ...ORDER, ...over }, { 'content-type': 'application/json' });
  assert.equal(r.code, 200, JSON.stringify(r.json)); lastMoid = r.json.moid; return r.json;
}
function auth(f, over = {}) {
  const tid = 'testmid00m01012611101530001234', token = 'AUTHTOKEN' + crypto.randomBytes(8).toString('hex');
  const amt = f.Amt.padStart(12, '0');
  return { AuthResultCode: '0000', AuthResultMsg: '인증 성공', AuthToken: token, PayMethod: 'CARD', MID: f.MID, Moid: f.Moid, Amt: amt, ReqReserved: f.Moid,
    TxTid: tid, NextAppURL: APPROVE, NetCancelURL: NETC, Signature: sha(token + f.MID + amt + KEY), ...over };
}
const ret = data => call('POST', '/api/pay/return', form(data), { 'content-type': 'application/x-www-form-urlencoded' });
const order = moid => JSON.parse(fs.readFileSync(path.join(TMP, 'orders', moid + '.json'), 'utf8'));
let n = 0; const ok = t => console.log(`OK ${++n}. ${t}`);

// 1. 설정
{ const r = await call('GET', '/api/pay/config'); assert.equal(r.json.ready, true); assert.equal(r.json.enabled, false); assert.deepEqual(r.json.methods.map(m => m.id), ['card']); ok('설정: 키 있음 · 꺼짐 · 카드'); }
// 2. 준비: 금액은 서버 계산(3단 바닥형 슈퍼싱글 239,000 + 떡실신 64,000×2)
let f;
{
  f = await readyOrder();
  const J = PAY._test.siteData(), expect = J.OPTIONS_29.price['12-SS'] + J.PRODUCTS.find(p => p.id === 30).price * 2;
  assert.equal(f.fields.Amt, String(expect)); assert.equal(f.fields.MID, MID); assert.equal(f.fields.PayMethod, 'CARD');
  assert.equal(f.fields.SignData, sha(f.fields.EdiDate + MID + f.fields.Amt + KEY)); assert.match(f.fields.EdiDate, /^\d{14}$/);
  assert.equal(f.fields.ReturnURL, 'https://jamschool.kr/api/pay/return'); assert.ok(PAY._test.ebytes(f.fields.GoodsName) <= 40, f.fields.GoodsName);
  assert.equal(f.fields.BuyerTel, '01012345678'); assert.ok(!JSON.stringify(f).includes(KEY), '상점키가 브라우저로 나감');
  assert.equal(order(f.moid).status, 'ready');
  ok(`준비: ${f.fields.Amt}원 서버 계산 · SignData 일치 · 상품명 「${f.fields.GoodsName}」 · 키 노출 없음`);
}
// 3. 잘못된 주문은 거절
for (const [why, over] of [['없는 옵션', { items: [{ key: '29-12-XL-gray', qty: 1 }] }], ['수량 0', { items: [{ key: '30', qty: 0 }] }], ['없는 상품', { items: [{ key: '999', qty: 1 }] }],
  ['3단을 옵션 없이', { items: [{ key: '29', qty: 1 }] }], ['결제수단', { method: 'npay' }], ['전화번호', { buyer: { ...ORDER.buyer, tel: '123' } }]]) {
  const r = await call('POST', '/api/pay/ready', { ...ORDER, ...over }); assert.equal(r.code, 400, why);
}
ok('준비 거절: 없는 옵션·수량 0·없는 상품·3단 옵션 누락·결제수단·전화번호');
// 4. 정상 승인
{
  calls = []; plan = { [APPROVE]: okApprove };
  const r = await ret(auth(f.fields));
  assert.equal(r.code, 303); const o = order(f.moid);
  assert.equal(r.headers.Location, `/order-complete.html?o=${o.moid}&t=${o.token}`);
  assert.equal(o.status, 'paid'); assert.equal(o.pg.authCode, '12345678'); assert.equal(calls.length, 1);
  const p = calls[0].params; assert.equal(p.Amt, f.fields.Amt); assert.equal(p.SignData, sha(p.AuthToken + MID + p.Amt + p.EdiDate + KEY)); assert.equal(p.CharSet, 'utf-8');
  ok('승인: 인증 서명 확인 → 승인 요청 SignData 일치 → 응답 서명 확인 → 결제 완료');
  // 같은 인증 결과를 다시 보내도 두 번 승인하지 않음
  calls = []; const r2 = await ret(auth(f.fields)); assert.equal(r2.code, 303); assert.equal(calls.length, 0); assert.equal(order(f.moid).status, 'paid');
  ok('중복 전송: 승인 요청을 다시 보내지 않음');
  // 주문 완료 화면 조회
  const v = await call('GET', `/api/pay/order?o=${o.moid}&t=${o.token}`); assert.equal(v.json.status, 'paid'); assert.equal(v.json.name, '김*험'); assert.ok(!JSON.stringify(v.json).includes('101호'));
  assert.match(v.json.payLabel, /신한 · 일시불/);
  const bad = await call('GET', `/api/pay/order?o=${o.moid}&t=wrong`); assert.equal(bad.code, 404);
  ok('완료 화면: 조회키로만 열림 · 이름 가림 · 상세 주소 없음');
}
// 5. 위조·오류 — 승인 요청을 보내지 않고 실패 처리
for (const [why, over] of [['인증 서명 위조', { Signature: 'a'.repeat(64) }], ['금액 위조', { Amt: '000000001000' }], ['다른 상점', { MID: 'other00m' }],
  ['승인 주소 위조', { NextAppURL: 'https://evil.example.com/webapi/pay_process.jsp' }], ['인증 실패', { AuthResultCode: '9999', AuthResultMsg: '사용자 취소' }]]) {
  const g = await readyOrder(); calls = []; plan = { [APPROVE]: okApprove };
  const a = auth(g.fields); const data = { ...a, ...over };
  if (over.Amt) data.Signature = sha(a.AuthToken + MID + over.Amt + KEY);   // 금액만 바꾸고 서명은 맞춘 경우도 막는지
  const r = await ret(data); assert.equal(r.code, 303); assert.equal(order(g.moid).status, 'failed', why); assert.equal(calls.length, 0, why);
}
ok('거절: 인증 서명 위조·금액 위조(서명까지 맞춰도)·다른 상점·승인 주소 위조·인증 실패 → 승인 요청 안 보냄');
// 6. 승인 응답이 없거나 이상하면 망취소
for (const [why, approve, net, status] of [
  ['승인 시간 초과', () => Object.assign(new Error('timeout'), { name: 'TimeoutError' }), okNet, 'failed'],
  ['승인 응답 서명 불일치', p => ({ ...okApprove(p), Signature: 'b'.repeat(64) }), okNet, 'failed'],
  ['승인 응답 금액 불일치', p => { const x = okApprove(p); x.Amt = '000000000100'; x.Signature = sha(x.TID + x.MID + x.Amt + KEY); return x; }, okNet, 'failed'],
  ['승인 시간 초과 + 망취소 실패', () => new Error('reset'), () => ({ ResultCode: '2003', ResultMsg: '실패' }), 'check'],
]) {
  const g = await readyOrder(); calls = []; plan = { [APPROVE]: approve, [NETC]: net };
  const r = await ret(auth(g.fields)); assert.equal(r.code, 303);
  const o = order(g.moid); assert.equal(o.status, status, why);
  const nc = calls.find(c => c.url === NETC); assert.ok(nc, why + ': 망취소 안 함');
  assert.equal(nc.params.NetCancel, '1'); assert.equal(nc.params.SignData, sha(nc.params.AuthToken + MID + nc.params.Amt + nc.params.EdiDate + KEY));
}
ok('망취소: 승인 시간 초과·응답 서명/금액 불일치 → 망취소, 망취소도 실패하면 \'확인 필요\'');
// 7. 승인 거절(카드 한도 등)은 망취소 없이 실패
{ const g = await readyOrder(); calls = []; plan = { [APPROVE]: p => ({ ResultCode: '3011', ResultMsg: '카드 한도 초과' }) };
  await ret(auth(g.fields)); const o = order(g.moid); assert.equal(o.status, 'failed'); assert.match(o.fail.msg, /한도/); assert.ok(!calls.some(c => c.url === NETC)); ok('승인 거절: 실패 표시, 망취소 없음'); }
// 8. 관리자: 목록·발송·취소·켜기
{
  const list = PAY.listOrders(); assert.ok(list.some(x => x.moid === f.moid && x.status === 'paid')); assert.ok(list.every(x => x.status !== 'failed'));
  assert.ok(PAY.listOrders({ all: true }).length > list.length);
  const u = { id: 'owner1', name: '관리자', role: 'owner' };
  assert.equal(PAY.setFulfil(f.moid, 'shipped', u).fulfil.status, 'shipped');
  calls = []; plan = { [CANCEL]: p => ({ ResultCode: '2001', ResultMsg: '취소 성공', TID: p.TID, MID: p.MID, CancelAmt: p.CancelAmt, CancelNum: '00000001', Signature: sha(p.TID + p.MID + p.CancelAmt + KEY) }) };
  const c = await PAY.cancelOrder(f.moid, '고객 요청 취소', u);
  assert.equal(c.status, 'cancelled'); assert.equal(c.cancel.signature, 'ok'); assert.ok(!('token' in c));
  const p = calls[0].params; assert.equal(p.SignData, sha(MID + p.CancelAmt + p.EdiDate + KEY)); assert.equal(p.PartialCancelCode, '0'); assert.equal(p.Moid, f.moid);
  assert.match(calls[0].raw, /CancelMsg=%B0%ED%B0%B4/, '취소 사유 euc-kr 인코딩');   // '고객' = B0ED B0B4
  await assert.rejects(PAY.cancelOrder(f.moid, 'x', u), /결제 완료된 주문만/);
  const s = PAY.setSettings({ enabled: true }, u); assert.equal(s.enabled, true);
  const cfg = await call('GET', '/api/pay/config'); assert.equal(cfg.json.enabled, true);
  ok('관리자: 결제 주문 목록 · 발송 처리 · 전액 취소(SignData·euc-kr 사유) · 중복 취소 막음 · 결제 켜기');
}
// 9. 휴대폰·PC 결과 인코딩: euc-kr 로 온 한글도 읽는다
{ const d = PAY._test.parseForm(Buffer.from('AuthResultMsg=%C0%CE%C1%F5+%BC%BA%B0%F8&Moid=JS1')); assert.equal(d.AuthResultMsg, '인증 성공');
  const u = PAY._test.parseForm(Buffer.from('AuthResultMsg=' + encodeURIComponent('인증 성공'))); assert.equal(u.AuthResultMsg, '인증 성공'); ok('결과 인코딩: euc-kr·utf-8 모두 읽음'); }

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n결제 서버 시험 ${n}개 통과`);
