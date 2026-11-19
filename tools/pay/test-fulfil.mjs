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
globalThis.fetch = async (url, opt) => {
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
assert.throws(() => PAY.saveShip({ refundRole: 'client' }, client), /총괄 관리자만/);
assert.equal(PAY.saveShip({ refundRole: 'client' }, owner).refundRole, 'client');
ok('배송 설정: 발송지·회수지(발송지와 같음)·기본 택배사·3PL 판매처 표시·상품별 이름, 우편번호 검사, 환불 권한은 총괄 관리자만');

// 8) 정산: 결제 다음 영업일(주말·공휴일 건너뜀), 취소·환불은 그날 기준 다음 정산에서 차감, 수수료·부가세, 테스트 서버 주문 제외, 입금 확인
assert.equal(F.bizDay('2026-11-20', 1, F.HOLIDAYS), '2026-11-23'); assert.equal(F.bizDay('2026-12-24', 1, F.HOLIDAYS), '2026-12-28'); assert.equal(F.bizDay('2026-09-23', 1, F.HOLIDAYS), '2026-09-28');
mk({ pgEnv: 'test' });
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
ok(`정산: 다음 영업일(금→월, 성탄절·추석 건너뜀)·환불 차감·수수료 3.3%+부가세·테스트 서버 주문 제외·입금 확인 · 정산 예정 ${rep.rows.length}일`);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n배송·클레임·환불·정산 시험 ${n}개 통과`);
