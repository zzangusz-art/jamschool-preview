// 발송(날짜별 목록·일괄 발송·택배/3PL 엑셀)·시험 기록 정리 시험 — node tools/pay/test-ship.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-ship-'));
process.env.ORDERS_DIR = path.join(T, 'orders'); process.env.STATS_DIR = path.join(T, 'analytics');
delete process.env.DATA_DIR;
let n = 0; const ok = s => console.log('ok', ++n, s);
fs.mkdirSync(process.env.ORDERS_DIR, { recursive: true }); fs.mkdirSync(process.env.STATS_DIR, { recursive: true });

const kd = back => new Date(Date.now() + 9 * 3600e3 - back * 864e5).toISOString().slice(0, 10);
let seq = 0;
const mk = (backMin, status, o = {}) => {
  const t = Date.now() - backMin * 60e3;
  const moid = 'JS' + new Date(t + 9 * 3600e3).toISOString().replace(/\D/g, '').slice(0, 14) + String(++seq).padStart(6, '0').replace(/\d/g, d => 'ABCDEFGHJK'[d]);
  const items = o.items || [{ key: '29-7-MS-gray', id: 29, name: '3단', gname: '잠스쿨 3단 접이식 매트리스', opt: '침대형 7cm / 멀티싱글 75×200 / 그레이', qty: 1, price: 139000 }];
  fs.writeFileSync(path.join(process.env.ORDERS_DIR, moid + '.json'), JSON.stringify({ moid, status, payLabel: '신용·체크카드', amount: items.reduce((a, x) => a + x.price * x.qty, 0), ship: 0, items,
    createdAt: new Date(t).toISOString(), paidAt: status === 'paid' ? new Date(t).toISOString() : '', buyer: { name: '주문자', tel: '01011112222', email: 'a@b.kr' },
    receiver: { name: o.name || '받는이', tel: o.tel || '01033334444', zip: '08502', addr1: '서울 금천구 가산디지털2로 95', addr2: '904호', memo: o.memo || '', jeju: !!o.jeju },
    fulfil: { status: o.shipped ? 'shipped' : 'new' }, history: [], pg: status === 'paid' ? { tid: 'T', authCode: '1234', cardName: '비씨', cardQuota: '00' } : undefined }));
  return moid;
};
const today = mk(5, 'paid', { name: '오늘손님', memo: '경비실', items: [{ key: '43-0', id: 43, name: '베개', gname: '잠스쿨 거북목 경추 베개', opt: '', qty: 2, price: 12900 }, { key: '29-12-SS-ivory', id: 29, name: '3단', gname: '잠스쿨 3단 접이식 매트리스', opt: '바닥형', qty: 1, price: 189000 }] });
const jeju = mk(30, 'paid', { name: '제주손님', tel: '0647100000', jeju: true });
const old = mk(3 * 1440, 'paid', { name: '지난손님', shipped: true });
const cancelled = mk(60, 'cancelled', { name: '취소손님' });
const ready = mk(10, 'ready', { name: '결제중' });
mk(5 * 60, 'ready', { name: '버려진' });
fs.writeFileSync(path.join(process.env.ORDERS_DIR, 'settings.json'), JSON.stringify({ enabled: true }));

const PAY = await import('./seedpay.mjs');
const { shipExport } = await import('./ship-export.mjs');
const STATS = await import('../admin/stats.mjs');

// 1) 날짜별 목록·발송 전 수
const all = PAY.listOrders({});
// 결제창을 연 지 1시간이 넘은 주문은 '결제 중단'(결제 실패 탭)으로 보이고, 방금 연 결제창(10분 전)은 빠진다
assert.deepEqual(all.map(o => o.status).sort(), ['cancelled', 'paid', 'paid', 'paid', 'ready']);
const gone = all.find(o => o.status === 'ready'); assert.equal(gone.statusName, '결제 중단'); assert.equal(gone.failStage, 'abandon'); assert.match(gone.fail, /결제창/);
assert.ok(!all.some(o => o.moid === ready));
const todayList = PAY.listOrders({ from: kd(0), to: kd(0) });
assert.ok(todayList.every(o => o.day === kd(0)) && todayList.some(o => o.moid === today), '오늘');
assert.ok(!todayList.some(o => o.moid === old));
assert.equal(PAY.listOrders({ from: kd(3), to: kd(3) })[0].moid, old);
assert.equal(PAY.todoCount(), 2);
const t0 = all.find(o => o.moid === today);
assert.equal(t0.qty, 3); assert.equal(t0.tel, '01033334444'); assert.equal(t0.memo, '경비실'); assert.match(t0.time, /^\d{2}:\d{2}$/);
ok('날짜별 목록(한국 날짜 from~to)·발송 전 수·받는 분 연락처·주소·메모·수량');

// 2) 엑셀 세 가지: 결제 완료만, 전화·우편번호는 글자(앞자리 0 유지), 3PL 은 상품마다 한 줄
assert.throws(() => PAY.ordersForExport([cancelled]), e => e.status === 400);
const orders = PAY.ordersForExport([today, jeju, cancelled]);
assert.equal(orders.length, 2);
const unzip = buf => {
  const out = {}; let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const csz = buf.readUInt32LE(i + 18), nl = buf.readUInt16LE(i + 26), xl = buf.readUInt16LE(i + 28), name = buf.slice(i + 30, i + 30 + nl).toString();
    out[name] = zlib.inflateRawSync(buf.slice(i + 30 + nl + xl, i + 30 + nl + xl + csz)).toString('utf8'); i += 30 + nl + xl + csz;
  }
  return out;
};
const cells = xml => [...xml.matchAll(/<row r="(\d+)">([\s\S]*?)<\/row>/g)].map(m => [...m[2].matchAll(/<c r="[A-Z]+\d+"([^>]*)>(?:<is><t[^>]*>([\s\S]*?)<\/t><\/is>|<v>([^<]*)<\/v>)<\/c>/g)].map(c => c[3] != null ? +c[3] : c[2].replace(/&amp;/g, '&')));
const c = shipExport(orders, 'courier'), cz = unzip(c.buf), cr = cells(cz['xl/worksheets/sheet1.xml']);
assert.ok(cz['[Content_Types].xml'] && cz['xl/workbook.xml'] && cz['xl/styles.xml']);
assert.match(c.name, /^잠스쿨_택배접수_\d{8}-\d{4}_2건\.xlsx$/);
assert.equal(cr.length, 3); assert.equal(cr[0][1], '수하인명');
const rowT = cr.find(r => r[1] === '오늘손님');
assert.equal(rowT[2], '010-3333-4444'); assert.equal(rowT[4], '08502'); assert.equal(rowT[7], 3); assert.match(rowT[6], /거북목 경추 베개 2개, .*3단.*1개/); assert.equal(rowT[8], '경비실');
const rowJ = cr.find(r => r[1] === '제주손님'); assert.equal(rowJ[2], '064-710-0000'); assert.equal(rowJ[3], ''); assert.equal(rowJ[9], 'Y');
// 3PL 발주서(업체 샘플 열): 상품 1개 = 1줄(수량 2 → 2줄), 받는분 뒤 판매처 표시, 품목명 = 상품별 이름 + 두께형(cm)_사이즈 / 색상, 운임구분 1
const ctx = PAY.exportCtx();
const p3 = cells(unzip(shipExport(orders, '3pl', ctx).buf)['xl/worksheets/sheet1.xml']);
assert.deepEqual(p3[0], ['받는분', '받는분우편번호', '받는분주소(전체, 분할)', '받는분전화번호', '받는분기타연락처', '운임구분', '', '품목명', '품목명', '배송메세지1', '주문번호']);
assert.equal(p3.length, 1 + 2 + 1 + 1);
assert.ok(p3.slice(1).every(r => /\(공\)$/.test(r[0]) && r[5] === 1));
assert.deepEqual(p3.slice(1).map(r => r[7]).sort(), ['3단 매트리스 바닥형(12cm)_슈퍼싱글 / 아이보리', '3단 매트리스 침대형(7cm)_멀티싱글 / 그레이', '정착베개', '정착베개']);
const fu = cells(unzip(shipExport(orders, 'full', ctx).buf)['xl/worksheets/sheet1.xml']);
assert.equal(fu[0].length, 25); assert.equal(fu[0][4], '배송 단계');
const cs = cells(unzip(shipExport(orders, 'courier', ctx).buf)['xl/worksheets/sheet1.xml']); assert.equal(cs[0][10], '송하인명'); assert.equal(fu.find(r => r[15] === '오늘손님')[9], 214800);
ok('택배 접수용(주문 1줄·전화 하이픈·우편번호 08502·제주 표시·송하인)·3PL 발주서(샘플 열·상품 1개 1줄·품목명·판매처 표시)·전체 정보(배송 단계·송장·환불), 결제 완료만');

// 3) 일괄 발송·되돌리기
const u = { id: 'tester', name: '시험' };
assert.deepEqual(PAY.shipMany([today, jeju, cancelled], 'shipped', u), { ok: true, changed: 2, picked: 2, skipped: [] });
assert.equal(PAY.todoCount(), 0);
assert.equal(PAY.shipMany([today], 'shipped', u).changed, 0);
assert.equal(PAY.shipMany([today], 'new', u).changed, 1); assert.equal(PAY.todoCount(), 1);
ok('고른 결제 완료 주문 한꺼번에 발송 처리·발송 전으로, 취소 주문은 빠짐');

// 4) 시험 기록 정리: 주문은 보관 폴더로(1시간 안 결제 전 주문만 남김), 설정 그대로 / 주문 흐름은 오늘부터, 방문은 그대로
fs.writeFileSync(path.join(process.env.STATS_DIR, `${kd(2)}.json`), JSON.stringify({ date: kd(2), pv: 10, uv: 5, entries: 3, pages: {}, sources: { '직접 방문': 3 }, refs: {}, ai: {}, devices: {}, bots: {},
  events: { buy_click: 4 }, products: { 29: { views: 7, buy: 2 } }, orders: { n: 1, sum: 139000, items: { 29: 1 }, pay: { card: 1 } } }));
const before = STATS.summary(7); assert.equal(before.total.events.buy_click, 4); assert.equal(before.total.orders.n, 1);
const a = PAY.archiveOrders(u);
assert.equal(a.archived, 5); assert.equal(a.keptReady, 1); assert.match(a.keptIn, /^orders\/_archive\/\d+-tester$/);
assert.deepEqual(fs.readdirSync(process.env.ORDERS_DIR).filter(f => f.startsWith('JS')), [`${ready}.json`]);
assert.ok(fs.existsSync(path.join(process.env.ORDERS_DIR, 'settings.json')));
assert.equal(fs.readdirSync(path.join(process.env.ORDERS_DIR, ...a.keptIn.split('/').slice(1))).length, 5);
assert.equal(PAY.listOrders({}).length, 0); assert.equal(PAY.todoCount(), 0);
const r = STATS.resetOrderStats('tester'); assert.equal(r.since, kd(0)); assert.equal(STATS.ordersSince(), kd(0));
const after = STATS.summary(7);
assert.equal(after.total.events.buy_click, undefined); assert.equal(after.total.orders.n, 0); assert.equal(after.total.uv, 5); assert.equal(after.ordersSince, kd(0));
assert.ok(fs.readdirSync(process.env.STATS_DIR).some(f => f.startsWith('_before-reset-')));
ok(`정리: 주문 ${a.archived}건 보관(결제 중 1건 남김·설정 유지), 주문 흐름 숫자는 ${kd(0)}부터, 방문 숫자는 그대로`);

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n발송·정리 시험 ${n}개 통과`);
process.exit(0);
