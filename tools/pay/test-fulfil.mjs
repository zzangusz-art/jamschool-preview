// 배송·취소·반품·교환·환불·주문 조회·정산 시험 — node tools/pay/test-fulfil.mjs
//   가짜 가맹점 키·임시 폴더만 쓰고 씨드페이먼츠로는 아무 요청도 보내지 않는다(fetch 를 바꿔 끼움)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-fulfil-'));
process.env.DATA_DIR = TMP; process.env.SEEDPAY_MID = 'testmid00m';
process.env.SEEDPAY_MERCHANT_KEY = 'TEST-ONLY-KEY-' + crypto.randomBytes(8).toString('hex');
delete process.env.SEEDPAY_ENV; delete process.env.NOTIFY_TELEGRAM_TOKEN;
const KEY = process.env.SEEDPAY_MERCHANT_KEY, MID = process.env.SEEDPAY_MID;
const DIR = path.join(TMP, 'orders'); fs.mkdirSync(DIR, { recursive: true });
const PAY = await import('./seedpay.mjs');
const F = await import('./fulfil.mjs');
const origLog = console.log; console.log = (...a) => { if (!String(a[0]).startsWith('[pay]')) origLog(...a); };
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
let n = 0; const ok = s => console.log('ok', ++n, s);

// 가짜 씨드페이먼츠 취소
const CANCEL = 'https://pay.seedpayments.co.kr/payment/v1/cancel';
let calls = [], plan = null;
let smsSent = [], smsPlan = null;   // 가짜 솔라피
globalThis.fetch = async (url, opt) => {
  if (String(url) === 'https://api.solapi.com/messages/v4/send-many') {
    const body = JSON.parse(opt.body); smsSent.push({ auth: opt.headers.Authorization, body });
    const out = smsPlan ? smsPlan(body) : { groupId: 'G1', count: { total: 1, registeredSuccess: 1, registeredFailed: 0 } };
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  const params = Object.fromEntries(new URLSearchParams(opt.body)); calls.push({ url, params });
  if (url !== CANCEL || !plan) throw new Error('예상 못 한 요청 ' + url);
  return new Response(JSON.stringify(plan(params)), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const okCancel = p => ({ resultCd: '0000', resultMsg: '취소 성공', tid: 'C' + crypto.randomBytes(6).toString('hex'), otid: p.tid, mid: p.mid, ccAmt: p.ccAmt || '', partCanFlg: p.partCanFlg, ccSeq: '1', trxStCd: '1' });
let ipN = 0;
async function call(method, url, body, headers = {}) {
  const buf = Buffer.from(body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body));
  const req = Readable.from([buf]); Object.assign(req, { method, url, headers: { host: 'jamschool.kr', ...headers }, socket: { remoteAddress: '127.0.0.' + (++ipN % 250) } });
  const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b ? String(b) : ''; } };
  await PAY.handlePay(req, res); let j = null; try { j = JSON.parse(res.body); } catch { j = null; }
  return { code: res.code, json: j, body: res.body };
}

// 주문 파일 만들기(결제 완료, 거래번호 있음)
let seq = 0;
const mk = (o = {}) => {
  const moid = 'JS2026111912' + String(1000 + ++seq) + 'ABCDEF';
  const items = o.items || [{ key: '29-12-SS-gray', id: 29, name: '잠스쿨 허리에 좋은 3단 접이식 매트리스', gname: '잠스쿨 3단 접이식 매트리스', opt: '바닥형 12cm / 슈퍼싱글 110 × 200 / 그레이', qty: 1, price: 239000, cat: 'mattress' }];
  const amount = items.reduce((a, x) => a + x.price * x.qty, 0), paidAt = o.paidAt || '2026-11-20T02:00:00.000Z';
  fs.writeFileSync(path.join(DIR, moid + '.json'), JSON.stringify({ moid, token: 'tok' + seq, status: 'paid', method: 'card', payLabel: '신용·체크카드', amount, sub: amount, ship: 0, items,
    createdAt: paidAt, paidAt, pgEnv: o.pgEnv || 'real', buyer: { name: '주문자', tel: '01011112222', email: '' }, receiver: { name: '받는이', tel: '01033334444', zip: '06236', addr1: '서울 강남구 테헤란로 1', addr2: '101호', memo: '', jeju: !!o.jeju },
    fulfil: { status: 'new' }, history: [], pg: { tid: 'testmid00m0101' + String(seq).padStart(16, '0'), authCode: '1234', cardName: '신한' } }));
  return moid;
};
const owner = { id: 'boss', name: '총괄', role: 'owner' }, client = { id: 'jam01', name: '잠스쿨 담당자', role: 'client' };
const read = id => JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8'));

// 1) 배송 단계: 발주 확인(일괄) → 송장 일괄 입력(붙여 넣기) → 배송 완료, 송장 형식·결제 완료만
const a = mk(), b = mk(), c = mk();
assert.equal(PAY.shipMany([a, b], 'prep', client).changed, 2);
assert.equal(read(a).fulfil.status, 'prep'); assert.ok(read(a).fulfil.prepAt);
const paste = `${a}\t로젠택배\t123-4567-8901\n주문번호\t송장\n${b} 대신 3456789012\nJS20261119999999ZZZZZZ 1234567890`;
const iv = PAY.invoiceMany(paste, 'logen', client);
assert.equal(iv.changed, 2); assert.equal(iv.errors.length, 2);
assert.deepEqual([read(a).fulfil.courier, read(a).fulfil.invoice, read(a).fulfil.status], ['logen', '12345678901', 'shipped']);
assert.deepEqual([read(b).fulfil.courier, read(b).fulfil.invoice], ['daesin', '3456789012']);
assert.throws(() => PAY.setFulfil(c, { status: 'shipped', courier: 'logen', invoice: '12<script>', needInvoice: true }, client), /송장번호는/);
assert.throws(() => PAY.setFulfil(c, { status: 'delivered' }, client), /발송한 주문만/);
const d1 = PAY.setFulfil(a, { status: 'delivered' }, client);
assert.equal(d1.fulfilNow.status, 'delivered'); assert.match(d1.track, /^https:\/\/www\.ilogen\.com\/web\/personal\/trace\/12345678901$/);
const row = PAY.listOrders({}).find(o => o.moid === b);
assert.equal(row.stageName, '배송 중'); assert.equal(row.courier, '대신택배'); assert.match(row.track, /ds3211/);
assert.equal(PAY.todoCount(), 1);
ok('배송 단계: 발주 확인(일괄)·송장 일괄 입력(택배사 이름·하이픈 처리, 못 찾은 줄 알림)·송장 형식 검사·배송 완료·조회 주소·발송 전 수');

// 2) 발송 전 취소: 요청 → 전액 환불(씨드 전체 취소 partCanFlg 0) → 결제 취소·취소 완료
assert.throws(() => PAY.claimOrder(a, { action: 'request', type: 'cancel', reason: '변심' }, client), /반품으로/);
PAY.claimOrder(c, { action: 'request', type: 'cancel', reason: '주소 잘못 넣음' }, client);
assert.equal(PAY.listOrders({}).find(o => o.moid === c).stageName, '취소 요청');
assert.throws(() => PAY.setFulfil(c, { status: 'prep' }, client), /취소 요청 중/);
plan = okCancel; calls = [];
const cc = await PAY.refundOrder(c, { amount: 239000, reason: '고객 요청 취소', via: 'pg' }, owner);
assert.equal(cc.status, 'cancelled'); assert.equal(cc.claim.status, 'done'); assert.equal(cc.stage.label, '취소 완료(전액 환불)');
const p0 = calls[0].params; assert.equal(p0.partCanFlg, '0'); assert.ok(!('ccAmt' in p0)); assert.equal(p0.hashString, sha(MID + p0.ediDate + read(c).pg.tid + KEY));
ok('발송 전 취소: 요청(발송 후엔 반품으로)·요청 중 발송 막음·전액 환불(전체 취소, hashString)·취소 완료');

// 3) 반품(고객 사유): 요청 → 회수 접수 → 회수 완료 → 반품비 뺀 부분 환불(partCanFlg 1 · ccAmt) → 반품 완료 / 남은 금액 환불하면 결제 취소
PAY.claimOrder(a, { action: 'request', type: 'return', reason: '단순 변심', fault: 'buyer' }, client);
PAY.claimOrder(a, { action: 'pickup', courier: 'logen', invoice: '99887766554' }, client);
const col = PAY.claimOrder(a, { action: 'collected', note: '포장 훼손 없음' }, client);
assert.equal(col.claimView.label, '반품 회수 완료 · 환불 대기'); assert.equal(col.suggest.deduct, 36000); assert.equal(col.suggest.amount, 239000 - 36000);
calls = [];
const pr = await PAY.refundOrder(a, { amount: col.suggest.amount, reason: '반품 환불(왕복 배송비 차감)', via: 'pg' }, owner);
assert.equal(calls[0].params.partCanFlg, '1'); assert.equal(calls[0].params.ccAmt, '203000');
assert.equal(pr.status, 'paid'); assert.equal(pr.refunded, 203000); assert.equal(pr.remain, 36000); assert.equal(pr.claim.status, 'done'); assert.match(pr.stage.label, /부분 환불 203,000원/);
await assert.rejects(PAY.refundOrder(a, { amount: 50000, via: 'pg' }, owner), /1원 ~ 36,000원/);
const last = await PAY.refundOrder(a, { amount: 36000, reason: '배송비도 돌려드림', via: 'pg' }, owner);
assert.equal(calls[1].params.partCanFlg, '1'); assert.equal(calls[1].params.ccAmt, '36000'); assert.equal(last.status, 'cancelled'); assert.equal(last.refunded, 239000);
ok('반품: 요청·회수 접수(송장)·회수 완료(검수 메모)·반품비 36,000원 제안·부분취소(ccAmt)·반품 완료·남은 금액 부분취소로 전액 → 결제 취소');

// 4) 교환: 요청 → 회수 → 회수 완료 → 재발송(송장 필수) → 교환 완료 / 철회
PAY.claimOrder(b, { action: 'request', type: 'exchange', reason: '색상 교환', fault: 'buyer' }, client);
assert.throws(() => PAY.claimOrder(b, { action: 'resend', courier: 'logen', invoice: '1234567890' }, client), /회수가 끝난 뒤/);
PAY.claimOrder(b, { action: 'collected' }, client);
assert.throws(() => PAY.claimOrder(b, { action: 'resend', courier: 'logen', invoice: '' }, client), /송장번호를 넣어/);
PAY.claimOrder(b, { action: 'resend', courier: 'cj', invoice: '5556667778' }, client);
const ex = PAY.claimOrder(b, { action: 'done' }, client);
assert.equal(ex.claim.status, 'done'); assert.match(ex.stage.label, /교환 완료/); assert.match(ex.claimView.resendTrack, /cjlogistics.*5556667778/);
const e2 = mk(); PAY.setFulfil(e2, { status: 'shipped', courier: 'logen', invoice: '1112223334' }, client);
PAY.claimOrder(e2, { action: 'request', type: 'return', reason: '불량', fault: 'seller' }, client);
assert.equal(PAY.getOrderAdmin(e2).suggest.deduct, 0);
assert.throws(() => PAY.claimOrder(e2, { action: 'reject' }, client), /사유를/);
assert.equal(PAY.claimOrder(e2, { action: 'reject', note: '고객이 철회' }, client).claim.status, 'rejected');
ok('교환: 회수 전 재발송 막음·재발송 송장 필수·교환 완료·재발송 조회 주소 / 판매자 귀책 반품은 차감 0원 / 철회는 사유 필수');

// 5) 결제 밖 환불 기록·환불 권한·결제통보(가맹점 관리자 부분취소)
const m = mk();
calls = [];
const mr = await PAY.refundOrder(m, { amount: 10000, reason: '계좌 환불', via: 'manual' }, client);
assert.equal(calls.length, 0); assert.equal(mr.refunded, 10000); assert.equal(mr.refunds[0].via, 'manual');
const tid = read(m).pg.tid, ntid = 'N' + tid.slice(1);
const noti = d => call('POST', '/api/pay/noti', d, { 'content-type': 'application/json', 'x-real-ip': '13.125.71.243' });
let r = await noti({ resultCd: '0000', tid: ntid, otid: tid, mid: MID, trxStCd: '1', ccAmt: '20000', ordNo: m, partCanFlg: '1', ccSeq: '2' });
assert.equal(r.code, 200); assert.equal(read(m).refunds.length, 2); assert.equal(read(m).refunds[1].via, 'seed');
r = await noti({ resultCd: '0000', tid: ntid, otid: tid, mid: MID, trxStCd: '1', ccAmt: '20000', ordNo: m, partCanFlg: '1', ccSeq: '2' });
assert.equal(read(m).refunds.length, 2, '재전송 무시');
assert.equal(F.refundedOf(read(m)), 30000);
ok('결제 밖 환불은 기록만(씨드 요청 없음)·가맹점 관리자 부분취소 결제통보를 환불에 더함·재전송 무시');

// 6) 손님 주문 조회: 주문번호 + 휴대폰 → 조회 주소, 배송 단계·택배 조회 링크
r = await call('POST', '/api/pay/lookup', { no: b.toLowerCase(), tel: '010-3333-4444' }, { 'content-type': 'application/json' });
assert.equal(r.code, 200); assert.equal(r.json.o, b); assert.equal(r.json.t, read(b).token);
r = await call('POST', '/api/pay/lookup', { no: b, tel: '010-9999-0000' }, { 'content-type': 'application/json' }); assert.equal(r.code, 404);
const v = await call('GET', `/api/pay/order?o=${b}&t=${read(b).token}`);
assert.equal(v.json.ship.stage, '배송 중 · 교환 완료'); assert.equal(v.json.ship.courier, '대신택배'); assert.match(v.json.ship.track, /ds3211/);
assert.deepEqual(v.json.ship.steps.map(s => s.done), [true, true, true, false]); assert.equal(v.json.ship.claim.resend.courier, 'CJ대한통운');
let limited = 0; for (let i = 0; i < 12; i++) { const x = await call('POST', '/api/pay/lookup', { no: b, tel: '0' }, { 'content-type': 'application/json', 'x-real-ip': '9.9.9.9' }); if (x.code === 429) limited++; }
assert.ok(limited >= 1, '조회 횟수 제한');
ok('주문 조회: 주문번호(대소문자 무관)·휴대폰 일치 → 조회 주소, 틀리면 404, 10분 10번 제한 · 손님 화면 배송 단계·택배사·조회 링크·교환 재발송');

// 7) 배송 설정: 저장·검사, 환불 권한은 총괄 관리자만
const s1 = PAY.saveShip({ from: { name: '잠스쿨 물류', tel: '02-123-4567', zip: '08502', addr1: '서울 금천구 가산디지털2로 95', addr2: '904호' }, ret: { same: true }, courier: 'daesin', tpl: { suffix: '(홈)', names: { 30: '떡실신 매트리스' } } }, client);
assert.equal(s1.from.tel, '021234567'); assert.equal(s1.courier, 'daesin'); assert.equal(s1.tpl.suffix, '(홈)'); assert.equal(s1.tpl.names[29], '3단 매트리스');
assert.throws(() => PAY.saveShip({ from: { zip: '123' } }, client), /우편번호/);
assert.equal(PAY.saveShip({ ret: { same: false, name: '반품센터', tel: '1588-1234', zip: '10881', addr1: '경기 파주시 회동길 1', addr2: '물류동' } }, client).ret.tel, '15881234');
assert.throws(() => PAY.saveShip({ from: { tel: '12-34' } }, client), /전화번호/);
assert.equal(PAY.saveShip({ refundRole: 'owner' }, client).refundRole, undefined, '환불 권한 설정은 없음');
ok('배송 설정: 발송지·회수지(직접 입력·대표번호 1588)·기본 택배사·3PL 판매처 표시·상품별 이름, 우편번호·전화 검사, 환불 권한 설정 없음(관리자 모두)');

// 8) 정산: 결제 다음 영업일(주말·공휴일 건너뜀), 취소·환불은 그날 기준 다음 정산에서 차감, 수수료·부가세, 테스트 서버 주문 제외, 입금 확인
assert.equal(F.bizDay('2026-11-20', 1, F.HOLIDAYS), '2026-11-23'); assert.equal(F.bizDay('2026-12-24', 1, F.HOLIDAYS), '2026-12-28'); assert.equal(F.bizDay('2026-09-23', 1, F.HOLIDAYS), '2026-09-28');
mk({ pgEnv: 'test' });
assert.equal(PAY.settleReport({}).cfg.feeRate, 2.2); assert.equal(PAY.settleReport({}).cfg.vat, true);
PAY.saveSettle({ check: { date: '2026-11-20', done: true } }, client); assert.equal(PAY.settleReport({}).cfg.feeRate, 2.2, '입금 확인만 저장해도 기본 수수료 유지');
const r22 = PAY.settleReport({}).rows.flatMap(x => x.list).find(x => x.kind === 'pay'); assert.equal(r22.fee, Math.round(r22.amount * 0.022)); assert.equal(r22.vat, Math.round(r22.fee * 0.1));
PAY.saveSettle({ feeRate: 3.3, vat: true }, client);
const rep = PAY.settleReport({});
const d23 = rep.rows.find(x => x.date === '2026-11-23');
assert.ok(d23 && d23.payN === 5 && d23.list.every(e => e.day === '2026-11-20' || e.kind === 'refund'));
assert.ok(!rep.rows.some(x => x.list.some(e => read(e.moid).pgEnv === 'test')), '테스트 서버 주문 제외');
const e = d23 ? d23.list.find(x => x.kind === 'pay') : null; assert.equal(e.fee, Math.round(239000 * 0.033)); assert.equal(e.vat, Math.round(e.fee * 0.1));
const refundRow = rep.rows.flatMap(x => x.list).filter(x => x.kind === 'refund');
assert.ok(refundRow.length >= 4 && refundRow.every(x => x.amount < 0));
assert.equal(rep.total.net, rep.total.payAmt - rep.total.refAmt - rep.total.fee - rep.total.vat);
const s2 = PAY.saveSettle({ check: { date: '2026-11-23', done: true, memo: '입금 확인' } }, client);
assert.ok(s2.checks['2026-11-23']);
assert.throws(() => PAY.saveSettle({ feeRate: 50 }, client), /0~10/);
assert.throws(() => PAY.saveSettle({ holidays: '2026/12/25' }, client), /날짜 형식/);
ok(`정산: 기본 수수료 2.2%+부가세(입금 확인만 저장해도 유지)·다음 영업일(금→월, 성탄절·추석 건너뜀)·환불 차감·수수료율 바꾸기·테스트 서버 주문 제외·입금 확인 · 정산 예정 ${rep.rows.length}일`);

// 9) 출고 예정일·출고 지연, 손님 직접 요청(주문 조회), 손님 안내 문자(솔라피), 관리자 메모·처리할 일
assert.equal(F.shipDue({ paidAt: '2026-11-20T03:00:00.000Z' }), '2026-11-20');   // 금 12:00 → 그날
assert.equal(F.shipDue({ paidAt: '2026-11-20T05:00:00.000Z' }), '2026-11-23');   // 금 14:00 → 월
assert.equal(F.shipDue({ paidAt: '2026-12-24T06:00:00.000Z' }), '2026-12-28');   // 목 15:00 → 성탄절·주말 건너 월
const late = mk({ paidAt: '2026-11-02T01:00:00.000Z' });
assert.equal(PAY.listOrders({}).find(o => o.moid === late).late, true); assert.ok(PAY.taskCounts().late >= 1);
const sm = mk();
const claimApi = (o, t, d) => call('POST', '/api/pay/claim', { o, t, ...d }, { 'content-type': 'application/json', 'x-real-ip': '10.0.0.' + (++ipN) });
let cr = await claimApi(sm, 'bad', { type: 'cancel', reason: '단순 변심' }); assert.equal(cr.code, 404);
cr = await claimApi(sm, read(sm).token, { type: 'return', reason: '단순 변심' }); assert.equal(cr.code, 400); assert.match(cr.json.error, /반품·교환을 요청할 수 있는 기간/);
cr = await claimApi(sm, read(sm).token, { type: 'cancel', reason: '기타' }); assert.equal(cr.code, 400); assert.match(cr.json.error, /사유를 적어/);
const v0 = await call('GET', `/api/pay/order?o=${sm}&t=${read(sm).token}`);
assert.match(v0.json.ship.due, /출고 예정/); assert.deepEqual(v0.json.ship.can, { cancel: true, ret: false });
process.env.SOLAPI_API_KEY = 'TESTKEY'; process.env.SOLAPI_API_SECRET = 'TESTSECRET'; process.env.SOLAPI_SENDER = '02-123-4567';
smsSent = [];
cr = await claimApi(sm, read(sm).token, { type: 'cancel', reason: '주소·옵션을 잘못 넣음', detail: '주소 오타' });
assert.equal(cr.code, 200); assert.equal(read(sm).claim.by, 'customer'); assert.equal(read(sm).claim.reason, '주소·옵션을 잘못 넣음 — 주소 오타');
assert.equal(cr.json.ship.claim.label, '취소 요청'); assert.deepEqual(cr.json.ship.can, { cancel: false, ret: false });
await PAY.tellSettled();
assert.equal(smsSent.length, 1);
const m0 = smsSent[0], a0 = m0.auth.match(/^HMAC-SHA256 apiKey=TESTKEY, date=(\S+), salt=([0-9a-f]{32}), signature=([0-9a-f]{64})$/);
assert.ok(a0, m0.auth); assert.equal(a0[3], crypto.createHmac('sha256', 'TESTSECRET').update(a0[1] + a0[2]).digest('hex'));
assert.equal(m0.body.messages[0].to, '01011112222'); assert.equal(m0.body.messages[0].from, '021234567');
assert.match(m0.body.messages[0].text, /주문자님, 취소 요청을 접수했습니다/); assert.match(m0.body.messages[0].text, new RegExp(`order-complete\\.html\\?o=${sm}&t=`));
assert.ok(read(sm).history.some(h => h.ev === '손님 문자' && /취소·반품·교환 요청 접수 보냄/.test(h.note)));
// 발송(송장 입력) 문자: 송장이 새로 들어갈 때 한 번, 같은 송장으로 다시 저장하면 안 보냄
const sx2 = mk(); smsSent = [];
PAY.setFulfil(sx2, { status: 'shipped', courier: 'cj', invoice: '5556667778' }, client); await PAY.tellSettled();
PAY.setFulfil(sx2, { status: 'shipped', courier: 'cj', invoice: '5556667778' }, client); await PAY.tellSettled();
assert.equal(smsSent.length, 1); assert.match(smsSent[0].body.messages[0].text, /CJ대한통운 5556667778/); assert.match(smsSent[0].body.messages[0].text, /cjlogistics/); assert.equal(smsSent[0].body.messages[0].type, 'LMS');
// 문구 끄기·바꾸기, 실패는 기록만
PAY.saveMsg({ shipped: { on: false }, refunded: { text: '[잠스쿨] #{환불금액} 환불 완료 #{없는칸}' } }, client);
smsSent = []; const sx3 = mk(); PAY.setFulfil(sx3, { status: 'shipped', courier: 'logen', invoice: '1231231231' }, client); await PAY.tellSettled(); assert.equal(smsSent.length, 0);
smsPlan = () => ({ count: { total: 1, registeredSuccess: 0, registeredFailed: 1 } });
await PAY.refundOrder(sx3, { amount: 10000, via: 'manual', reason: '일부' }, client); await PAY.tellSettled();
assert.equal(smsSent[0].body.messages[0].text, '[잠스쿨] 10,000원 환불 완료'); assert.ok(read(sx3).history.some(h => h.ev === '손님 문자' && /실패/.test(h.note)));
smsPlan = null;
const pv = await PAY.smsTest('010-1111-2222', 'paid', client); assert.equal(pv.ok, true); assert.match(pv.text, /오늘 출고 예정/);
assert.throws(() => PAY.saveMsg({ paid: { text: '   ' } }, client), /비어 있습니다/);
// 관리자 메모
assert.equal(PAY.setMemo(sx3, '고객 통화: 오후 배송 원함', client).adminMemo, '고객 통화: 오후 배송 원함');
assert.equal(PAY.listOrders({}).find(o => o.moid === sx3).memo2, '고객 통화: 오후 배송 원함');
delete process.env.SOLAPI_API_KEY; delete process.env.SOLAPI_API_SECRET; delete process.env.SOLAPI_SENDER;
ok('출고 예정일(마감·주말·공휴일)·출고 지연 · 손님 취소 요청(토큰·기간·사유 검사, 손님 표시) · 솔라피 문자(HMAC 서명·발신/수신·문구 칸·조회 주소·LMS·같은 송장 한 번·끄기·실패 기록) · 관리자 메모');

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n배송·클레임·환불·정산 시험 ${n}개 통과`);
