// 배송·취소·반품·교환·환불 흐름 + 배송 설정 + 정산 계산 — 결제 주문(tools/pay/seedpay.mjs)이 쓰고 어드민이 화면에 보여 준다
//   주문 파일(DATA_DIR/orders/JS….json)에 붙는 값
//     fulfil : { status: new|prep|shipped|delivered, courier, invoice, prepAt, shippedAt, deliveredAt, at, by }
//     claim  : { type: cancel|return|exchange, status: requested|collecting|collected|resent|done|rejected, reason, fault: buyer|seller,
//                memo, requestedAt, by, pickup: { courier, invoice, at }, collectedAt, note, resend: { courier, invoice, at }, doneAt }
//     refunds: [{ at, amount, part, reason, by, via: pg|manual|seed, tid, ccSeq }]  — 합계가 결제 금액이 되면 주문 status = cancelled
//   설정 파일: DATA_DIR/orders/ship.json(발송지·회수지·택배사·반품 배송비·3PL·환불 권한), settle.json(수수료율·공휴일·입금 확인)
import fs from 'node:fs';
import path from 'node:path';

export class FulfilError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }
const bad = (m, s) => { throw new FulfilError(m, s); };
const nowIso = () => new Date().toISOString();
const line = (s, max) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const digits = s => String(s ?? '').replace(/\D/g, '');
const toInt = v => { const n = Math.round(Number(String(v ?? '').replace(/[^\d.-]/g, ''))); return Number.isFinite(n) ? n : NaN; };

// ── 택배사: 배송 조회 주소(2026-11-19 각 회사 조회 화면이 열리는 것 확인). 목록에 없는 곳은 네이버 배송 조회 검색으로
export const COURIERS = [
  { code: 'logen', name: '로젠택배', url: 'https://www.ilogen.com/web/personal/trace/{no}' },
  { code: 'daesin', name: '대신택배', url: 'https://www.ds3211.co.kr/freight/internalFreightSearch.ht?billno={no}' },
  { code: 'cj', name: 'CJ대한통운', url: 'https://trace.cjlogistics.com/next/tracking.html?wblNo={no}' },
  { code: 'hanjin', name: '한진택배', url: 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2={no}' },
  { code: 'lotte', name: '롯데택배', url: 'https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo={no}' },
  { code: 'epost', name: '우체국택배', url: 'https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1={no}' },
  { code: 'kdexp', name: '경동택배', url: 'https://kdexp.com/service/delivery/etc/delivery.do?barcode={no}' },
  { code: 'etc', name: '기타(화물·직접 배송)', url: '' },
];
export const courierName = c => (COURIERS.find(x => x.code === c) || {}).name || '';
const INVOICE = /^[0-9A-Za-z-]{6,30}$/;
export function trackUrl(code, no) {
  const n = String(no || '').replace(/[^0-9A-Za-z-]/g, ''); if (!n) return '';
  const c = COURIERS.find(x => x.code === code);
  if (c && c.url) return c.url.replace('{no}', encodeURIComponent(n));
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(`${c && c.code !== 'etc' ? c.name + ' ' : ''}${n} 배송조회`)}`;
}
const pickCourier = (code, label) => { if (!COURIERS.some(x => x.code === code)) bad(`${label}: 택배사를 골라 주세요`); return code; };
const pickInvoice = (no, label, need) => { const n = String(no ?? '').replace(/\s/g, ''); if (!n) { if (need) bad(`${label}: 송장번호를 넣어 주세요`); return ''; } if (!INVOICE.test(n)) bad(`${label}: 송장번호는 숫자·영문·- 6~30자`); return n; };

// ── 상태 이름
export const FULFIL_LABEL = { new: '신규 주문', prep: '상품 준비 중', shipped: '배송 중', delivered: '배송 완료' };
export const CLAIM_TYPE = { cancel: '취소', return: '반품', exchange: '교환' };
const CLAIM_STEP = {
  cancel: { requested: '취소 요청', done: '취소 완료', rejected: '취소 철회' },
  return: { requested: '반품 요청', collecting: '반품 회수 중', collected: '반품 회수 완료 · 환불 대기', done: '반품 완료', rejected: '반품 철회' },
  exchange: { requested: '교환 요청', collecting: '교환 회수 중', collected: '교환 회수 완료 · 재발송 대기', resent: '교환 재발송', done: '교환 완료', rejected: '교환 철회' },
};
export const claimLabel = c => c ? (CLAIM_STEP[c.type] || {})[c.status] || '' : '';
export const claimOpen = c => !!c && !['done', 'rejected'].includes(c.status);
export const refundedOf = o => (o.refunds || []).reduce((a, r) => a + (r.amount || 0), 0) || (o.status === 'cancelled' && o.cancel && !(o.refunds || []).length ? o.amount : 0);

// 발송 뒤 autoDeliverDays 일이 지나면 배송 완료로 본다(조회 API 없이 표시만, 저장은 하지 않음)
export function fulfilNow(o, cfg = SHIP_DEFAULT) {
  const f = { ...(o.fulfil || {}) }; let st = f.status || 'new', auto = false;
  if (st === 'shipped' && !f.shippedAt && f.at) f.shippedAt = f.at;   // 예전 '발송 처리'(송장 없이 상태만) 주문
  if (st === 'shipped' && cfg.autoDeliverDays > 0 && f.shippedAt && Date.now() - Date.parse(f.shippedAt) > cfg.autoDeliverDays * 864e5) { st = 'delivered'; auto = true; }
  return { ...f, status: st, auto };
}
// 목록·손님 화면에 보이는 한 단계(결제 상태 + 배송 + 클레임 + 환불)
export function stageOf(o, cfg = SHIP_DEFAULT) {
  const refunded = refundedOf(o), c = o.claim;
  if (o.status === 'cancelled') return c && c.type === 'return' ? { key: 'returned', label: '반품 환불 완료', tone: '' } : { key: 'cancelled', label: c && c.type === 'cancel' ? '취소 완료(전액 환불)' : '결제 취소(전액 환불)', tone: '' };
  if (o.status !== 'paid') return { key: o.status, label: '', tone: '' };
  if (claimOpen(c)) return { key: 'claim', label: claimLabel(c), tone: 'bad' };
  if (c && c.type === 'return' && c.status === 'done') return { key: 'returned', label: `반품 완료${refunded ? ` · 부분 환불 ${refunded.toLocaleString('ko-KR')}원` : ''}`, tone: '' };
  const f = fulfilNow(o, cfg);
  const lab = FULFIL_LABEL[f.status] + (f.auto ? '(발송 뒤 자동)' : '') + (c && c.status === 'done' && c.type === 'exchange' ? ' · 교환 완료' : '') + (refunded ? ` · 부분 환불 ${refunded.toLocaleString('ko-KR')}원` : '');
  return { key: f.status, label: lab, tone: f.status === 'new' ? 'draft' : f.status === 'delivered' ? 'live' : '' };
}

// ── 배송 상태 바꾸기(발주 확인 → 송장 입력·발송 → 배송 완료, 되돌리기)
export function applyFulfil(o, d, user) {
  if (o.status !== 'paid') bad('결제 완료된 주문만 배송 처리할 수 있습니다');
  if (claimOpen(o.claim) && o.claim.type === 'cancel') bad('취소 요청 중인 주문입니다. 환불하거나 취소 요청을 철회한 뒤 처리해 주세요');
  const f = { ...(o.fulfil || { status: 'new' }) }, to = String(d.status || '');
  if (!FULFIL_LABEL[to]) bad('배송 단계를 확인해 주세요');
  const t = nowIso();
  if (to === 'shipped') {
    const has = d.courier != null || d.invoice != null;
    if (has) { f.courier = pickCourier(d.courier, '택배사'); f.invoice = pickInvoice(d.invoice, '송장번호', !!d.needInvoice); }
    f.shippedAt = f.status === 'shipped' && f.shippedAt ? f.shippedAt : t;
  }
  if (to === 'prep' && !f.prepAt) f.prepAt = t;
  if (to === 'delivered') { if (!['shipped', 'delivered'].includes(f.status)) bad('발송한 주문만 배송 완료로 바꿀 수 있습니다'); f.deliveredAt = t; }
  if (to === 'new' || to === 'prep') { delete f.shippedAt; delete f.deliveredAt; if (to === 'new') delete f.prepAt; }
  const from = f.status; f.status = to; f.at = t; f.by = user.id;
  o.fulfil = f;
  const what = to === 'shipped' ? `발송 처리${f.invoice ? ` · ${courierName(f.courier)} ${f.invoice}` : ' · 송장 미입력'}` : to === 'prep' ? (from === 'new' ? '발주 확인(상품 준비 중)' : '상품 준비 중으로') : to === 'delivered' ? '배송 완료' : '신규 주문으로 되돌림';
  return `${what} — ${user.name}(${user.id})`;
}

// ── 취소·반품·교환
export function applyClaim(o, d, user) {
  const act = String(d.action || ''), c = o.claim, who = `${user.name}(${user.id})`, t = nowIso();
  if (o.status !== 'paid') bad('결제 완료된 주문만 취소·반품·교환을 받을 수 있습니다');
  const fs0 = fulfilNow(o).status, sent = ['shipped', 'delivered'].includes(fs0);
  if (act === 'request') {
    if (claimOpen(c)) bad(`진행 중인 ${CLAIM_TYPE[c.type]} 요청이 있습니다`);
    const type = String(d.type || '');
    if (!CLAIM_TYPE[type]) bad('취소·반품·교환 중에서 골라 주세요');
    if (type === 'cancel' && sent) bad('이미 발송한 주문은 반품으로 받아 주세요');
    if (type !== 'cancel' && !sent) bad('발송 전 주문은 취소로 받아 주세요(교환은 옵션을 바꿔 다시 주문하도록 안내)');
    const reason = line(d.reason, 200); if (!reason) bad('사유를 적어 주세요');
    const fault = type === 'cancel' ? 'buyer' : d.fault === 'seller' ? 'seller' : 'buyer';
    o.claim = { type, status: 'requested', reason, fault, memo: line(d.memo, 300), requestedAt: t, by: user.id };
    return `${CLAIM_TYPE[type]} 요청 접수 · ${reason}${type !== 'cancel' ? ` · ${fault === 'seller' ? '판매자 귀책(배송비 잠스쿨 부담)' : '고객 사유(왕복 배송비 고객 부담)'}` : ''} — ${who}`;
  }
  if (!claimOpen(c)) bad('진행 중인 취소·반품·교환이 없습니다');
  const T = CLAIM_TYPE[c.type];
  if (act === 'pickup') {
    if (c.type === 'cancel') bad('취소는 회수가 없습니다');
    if (!['requested', 'collecting'].includes(c.status)) bad('회수 접수는 요청·회수 중일 때만 고칠 수 있습니다');
    c.pickup = { courier: pickCourier(d.courier, '회수 택배사'), invoice: pickInvoice(d.invoice, '회수 송장번호', false), at: t };
    c.status = 'collecting';
    return `${T} 회수 접수 · ${courierName(c.pickup.courier)}${c.pickup.invoice ? ' ' + c.pickup.invoice : ' · 송장 미입력'} — ${who}`;
  }
  if (act === 'collected') {
    if (c.type === 'cancel') bad('취소는 회수가 없습니다');
    if (!['requested', 'collecting'].includes(c.status)) bad('회수 완료는 요청·회수 중일 때만 누를 수 있습니다');
    c.status = 'collected'; c.collectedAt = t; c.note = line(d.note, 300);
    return `${T} 상품 회수 완료${c.note ? ` · 검수: ${c.note}` : ''} — ${who}`;
  }
  if (act === 'resend') {
    if (c.type !== 'exchange') bad('재발송은 교환에서만 합니다');
    if (!['collected', 'resent'].includes(c.status)) bad('회수가 끝난 뒤 재발송해 주세요');
    c.resend = { courier: pickCourier(d.courier, '재발송 택배사'), invoice: pickInvoice(d.invoice, '재발송 송장번호', true), at: t };
    c.status = 'resent';
    return `교환 상품 재발송 · ${courierName(c.resend.courier)} ${c.resend.invoice} — ${who}`;
  }
  if (act === 'done') {
    if (c.type === 'cancel') bad('취소는 환불(전액)하면 자동으로 끝납니다');
    if (c.type === 'exchange' && c.status !== 'resent') bad('재발송한 뒤 교환 완료를 눌러 주세요');
    if (c.type === 'return' && !refundedOf(o) && c.fault !== 'seller') bad('반품은 환불한 뒤 끝냅니다(환불 금액이 0원이면 사유를 적고 철회로 닫아 주세요)');
    c.status = 'done'; c.doneAt = t;
    return `${T} 완료 — ${who}`;
  }
  if (act === 'reject') {
    const note = line(d.note, 200); if (!note) bad('철회·거부 사유를 적어 주세요');
    c.status = 'rejected'; c.doneAt = t; c.note = note;
    return `${T} 요청 철회·거부 · ${note} — ${who}`;
  }
  if (act === 'memo') { c.memo = line(d.memo, 300); return `${T} 메모 수정 — ${who}`; }
  bad('알 수 없는 처리');
}
// 반품 때 돌려줄 금액 제안: 고객 사유면 왕복 배송비(매트리스·그 밖)와 제주·도서산간 추가비를 뺀다
export function refundSuggest(o, cfg = SHIP_DEFAULT) {
  const remain = o.amount - refundedOf(o), c = o.claim;
  if (!c || c.type !== 'return' || c.fault === 'seller') return { amount: remain, deduct: 0, why: '' };
  const fee = cfg.returnFee || {}, mat = o.items.some(x => x.cat === 'mattress');
  const deduct = (mat ? fee.mattress : fee.other) + (o.receiver && o.receiver.jeju ? fee.jeju : 0);
  return { amount: Math.max(0, remain - deduct), deduct, why: `고객 사유 반품 왕복 배송비 ${mat ? '(매트리스)' : ''}${o.receiver && o.receiver.jeju ? ' + 제주·도서산간' : ''}` };
}
// 환불 기록(결제 취소 응답을 받은 뒤 seedpay 가 부른다). 다 돌려주면 주문은 결제 취소, 진행 중인 취소·반품은 완료
export function addRefund(o, r) {
  o.refunds = o.refunds || [];
  o.refunds.push({ at: nowIso(), ...r });
  const sum = refundedOf(o);
  if (sum >= o.amount) {
    o.status = 'cancelled';
    o.cancel = o.cancel || { at: nowIso(), by: r.by, msg: r.reason, code: '0000', cancelNum: r.tid || '' };
  }
  // 취소 요청은 전액 환불로, 반품은 환불(배송비를 뺀 금액이라도) 한 번으로 끝난다. 교환은 그대로(배송비 차액 환불일 수 있음)
  const c = o.claim;
  if (claimOpen(c) && ((c.type === 'cancel' && sum >= o.amount) || c.type === 'return')) { c.status = 'done'; c.doneAt = nowIso(); }
  return sum;
}

// ── 손님 화면(주문 조회)용 진행 단계
export function customerView(o, cfg = SHIP_DEFAULT) {
  const f = fulfilNow(o, cfg), c = o.claim, st = stageOf(o, cfg);
  const steps = [['결제 완료', o.paidAt], ['상품 준비 중', f.prepAt || (['shipped', 'delivered'].includes(f.status) ? f.shippedAt : '')], ['배송 중', f.shippedAt], ['배송 완료', f.deliveredAt || (f.auto ? 'auto' : '')]];
  const reached = { new: 1, prep: 2, shipped: 3, delivered: 4 }[f.status] || 1;   // 결제 완료부터 몇 단계까지 왔나
  return {
    stage: st.label, stageKey: st.key,
    steps: o.status === 'paid' ? steps.map(([label, t], i) => ({ label, done: i < reached, at: t && t !== 'auto' ? t : '' })) : [],
    courier: f.invoice ? courierName(f.courier) : '', invoice: f.invoice || '', track: f.invoice ? trackUrl(f.courier, f.invoice) : '',
    claim: c ? { type: CLAIM_TYPE[c.type], label: claimLabel(c), pickup: c.pickup && c.pickup.invoice ? { courier: courierName(c.pickup.courier), invoice: c.pickup.invoice, track: trackUrl(c.pickup.courier, c.pickup.invoice) } : null,
      resend: c.resend ? { courier: courierName(c.resend.courier), invoice: c.resend.invoice, track: trackUrl(c.resend.courier, c.resend.invoice) } : null } : null,
    refunded: refundedOf(o),
    due: o.status === 'paid' && ['new', 'prep'].includes(f.status) && !claimOpen(c) ? dueLabel(shipDue(o, cfg, cfg.holidays)) : '',
    can: customerCan(o, cfg), reasons: CUSTOMER_REASONS,
  };
}

// ── 배송 설정(DATA_DIR/orders/ship.json)
export const SHIP_DEFAULT = {
  from: { name: '잠스쿨', tel: '', zip: '', addr1: '', addr2: '' },              // 발송지(보내는 분) — 택배 접수 엑셀에 들어감
  ret: { same: true, name: '잠스쿨 반품', tel: '', zip: '', addr1: '', addr2: '' },  // 회수지(반품·교환 상품 받는 곳)
  courier: 'logen', contract: '', cutoff: '13:00',                                  // 기본 택배사·신용 계약 코드·당일 출고 마감
  returnFee: { mattress: 36000, other: 6000, jeju: 7000 },                          // 고객 사유 반품 왕복 배송비(공식몰 안내 기준)
  autoDeliverDays: 7,                                                               // 발송 뒤 이 날이 지나면 배송 완료로 보기(0 = 안 함)
  tpl: { suffix: '(공)', fare: '1', names: { 29: '3단 매트리스', 30: '떡실신 매트리스', 39: '양면 매트리스', 40: '엄마품 토퍼', 36: '다리베개', 37: '경추베개', 38: '삼각등쿠션', 43: '정착베개', 44: '듀라론 쿨매트', 41: '하픽 손목보호대' } },
};   // 환불(결제 취소)은 로그인한 관리자 모두(2026-11-19 요청) — 권한 설정 없음
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 1)); fs.renameSync(tmp, f); };
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return o; };
export const shipSettings = dir => merge(SHIP_DEFAULT, readJson(path.join(dir, 'ship.json'), {}));
const addr = (a, label, need) => {
  const o = { name: line(a.name, 30), tel: digits(a.tel).slice(0, 12), zip: digits(a.zip).slice(0, 5), addr1: line(a.addr1, 200), addr2: line(a.addr2, 100) };
  const any = o.tel || o.zip || o.addr1;
  if (need || any) {
    if (o.zip && o.zip.length !== 5) bad(`${label}: 우편번호 5자리`);
    if (o.tel && !/^(0\d{8,11}|1[5-9]\d{6})$/.test(o.tel)) bad(`${label}: 전화번호를 확인해 주세요(예: 02-123-4567, 010-1234-5678, 1588-1234)`);
  }
  return o;
};
export function saveShipSettings(dir, d, user) {
  const cur = shipSettings(dir), n = { ...cur };
  if (d.from) n.from = addr(d.from, '발송지');
  if (d.ret) n.ret = { same: !!d.ret.same, ...(d.ret.same ? { name: line(d.ret.name, 30) || '잠스쿨 반품', tel: '', zip: '', addr1: '', addr2: '' } : addr(d.ret, '회수지')) };
  if (d.courier != null) n.courier = pickCourier(d.courier, '기본 택배사');
  if (d.contract != null) n.contract = line(d.contract, 30);
  if (d.cutoff != null) { const s = line(d.cutoff, 5); if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s)) bad('출고 마감 시간은 13:00 형식'); n.cutoff = s; }
  if (d.returnFee) { const f = {}; for (const k of ['mattress', 'other', 'jeju']) { const v = toInt(d.returnFee[k]); if (!(v >= 0 && v <= 200000)) bad('반품 배송비를 확인해 주세요'); f[k] = v; } n.returnFee = f; }
  if (d.autoDeliverDays != null) { const v = toInt(d.autoDeliverDays); if (!(v >= 0 && v <= 30)) bad('자동 배송 완료 날 수는 0~30'); n.autoDeliverDays = v; }
  if (d.tpl) {
    const names = {}; for (const [k, v] of Object.entries(d.tpl.names || {})) { if (/^\d{1,4}$/.test(k) && line(v, 40)) names[k] = line(v, 40); }
    n.tpl = { suffix: line(d.tpl.suffix, 12), fare: line(d.tpl.fare, 4) || '1', names: { ...cur.tpl.names, ...names } };
  }
  n.at = nowIso(); n.by = user.id;
  writeJson(path.join(dir, 'ship.json'), n);
  return shipSettings(dir);
}
// 3PL 발주서 품목명: 상품별 이름 + 두께형(cm)_사이즈 / 색상 (예: 3단 매트리스 바닥형(12cm)_퀸 / 그레이, 삼각등쿠션 소형 / 오렌지)
export function tplItemName(item, J, cfg = SHIP_DEFAULT) {
  const p = J.PRODUCTS.find(x => x.id === item.id), base = (cfg.tpl.names || {})[item.id] || (p ? p.short : item.name);
  const o = p && J.OPT.of(p), m = String(item.key || '').match(/^\d+-(.+)$/);
  if (!o || !m) return base;
  const vals = m[1].split('-'), parts = [], colors = [];
  o.groups.forEach((g, i) => {
    const v = g.values.find(x => x.id === vals[i]); if (!v) return;
    const isColor = g.values.some(x => x.hex) || /색|컬러|color/i.test(g.name);
    if (isColor) colors.push(v.label);
    else parts.push(parts.length ? `_${v.label}` : `${v.label}${v.sub && /cm$/i.test(String(v.sub).trim()) ? `(${String(v.sub).trim()})` : ''}`);
  });
  return `${base}${parts.length ? ' ' + parts.join('') : ''}${colors.length ? ' / ' + colors.join(' ') : ''}`;
}

// ── 정산(DATA_DIR/orders/settle.json) — 결제 승인일(한국 날짜) 다음 영업일에 정산(익일 정산). 취소·환불은 그날 기준 다음 영업일 정산금에서 뺀다
//   수수료 = (결제 − 취소) × 수수료율, 부가세 별도면 수수료의 10% 를 더 뺀다. 실제 입금액은 씨드페이먼츠 가맹점 관리자 정산 내역으로 맞춰 본다
export const HOLIDAYS = [   // 은행 휴무(공휴일·대체공휴일·근로자의 날). 정부 발표가 바뀌면 어드민 '정산 › 정산 설정'에서 고친다
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-02', '2026-05-01', '2026-05-05', '2026-05-25', '2026-06-03', '2026-08-17',
  '2026-09-24', '2026-09-25', '2026-10-05', '2026-10-09', '2026-12-25',
  '2027-01-01', '2027-02-05', '2027-02-08', '2027-03-01', '2027-05-05', '2027-05-13', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16',
  '2027-10-04', '2027-10-11', '2027-12-27',
];
// 수수료: 씨드페이먼츠 계약 2.2%, 부가세 별도(2026-11-19 사용자). 정산 설정에서 직접 저장한 적이 없으면(feeSet 없음) 이 기본값을 쓴다
export const SETTLE_DEFAULT = { feeRate: 2.2, vat: true, days: 1, holidays: HOLIDAYS, checks: {} };
export const settleSettings = dir => { const s = readJson(path.join(dir, 'settle.json'), {}); if (!s.feeSet) { delete s.feeRate; delete s.vat; } return { ...SETTLE_DEFAULT, ...s }; };
export function saveSettleSettings(dir, d, user) {
  const cur = settleSettings(dir), n = { ...cur };
  if (d.feeRate != null) { const v = Number(d.feeRate); if (!(v >= 0 && v <= 10)) bad('수수료율은 0~10(%)'); n.feeRate = Math.round(v * 1000) / 1000; n.feeSet = true; }
  if (d.vat != null) { n.vat = !!d.vat; n.feeSet = true; }
  if (d.days != null) { const v = toInt(d.days); if (!(v >= 0 && v <= 10)) bad('정산 주기는 0~10 영업일'); n.days = v; }
  if (d.holidays != null) {
    const list = (Array.isArray(d.holidays) ? d.holidays : String(d.holidays).split(/[\s,]+/)).map(s => String(s).trim()).filter(Boolean);
    for (const s of list) if (!/^20[0-9]{2}-[01][0-9]-[0-3][0-9]$/.test(s)) bad(`공휴일 날짜 형식(예: 2026-12-25): ${s}`);
    n.holidays = [...new Set(list)].sort();
  }
  if (d.check) { const day = String(d.check.date || ''); if (!/^20[0-9]{2}-[01][0-9]-[0-3][0-9]$/.test(day)) bad('정산일을 확인해 주세요'); n.checks = { ...cur.checks }; if (d.check.done) n.checks[day] = { at: nowIso(), by: user.id, memo: line(d.check.memo, 100) }; else delete n.checks[day]; }
  n.at = nowIso(); n.by = user.id;
  writeJson(path.join(dir, 'settle.json'), n);
  return settleSettings(dir);
}
const kday = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const addDay = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export function bizDay(day, n, holidays) {
  const H = new Set(holidays || []); let d = day, left = n;
  const off = x => { const w = new Date(x + 'T00:00:00Z').getUTCDay(); return w === 0 || w === 6 || H.has(x); };
  if (n === 0) { while (off(d)) d = addDay(d, 1); return d; }
  while (left > 0) { d = addDay(d, 1); if (!off(d)) left--; }
  return d;
}
// 정산 표: 정산일별(결제·취소 건, 수수료, 정산 예정액, 상태). from·to 는 정산일 기준
export function settlement(orders, cfg, { from = '', to = '', today = kday(nowIso()) } = {}) {
  const ev = [];
  for (const o of orders) {
    if (o.pgEnv === 'test' || !o.paidAt) continue;   // 씨드 테스트 서버 주문·결제 안 된 주문은 정산 없음
    ev.push({ moid: o.moid, kind: 'pay', day: kday(o.paidAt), amount: o.amount, who: o.receiver ? o.receiver.name : '', items: o.items.map(x => `${x.name}${x.opt ? ` (${x.opt})` : ''} × ${x.qty}`).join(', ') });
    const rs = (o.refunds || []).length ? o.refunds : o.status === 'cancelled' && o.cancel ? [{ at: o.cancel.at, amount: o.amount, reason: o.cancel.msg }] : [];
    for (const r of rs) ev.push({ moid: o.moid, kind: 'refund', day: kday(r.at), amount: -r.amount, who: o.receiver ? o.receiver.name : '', items: r.reason || '환불' });
  }
  const rate = (cfg.feeRate || 0) / 100, rows = new Map();
  for (const e of ev) {
    const date = bizDay(e.day, cfg.days, cfg.holidays);
    e.fee = Math.round(e.amount * rate); e.vat = cfg.vat ? Math.round(e.fee * 0.1) : 0; e.settle = date;
    if (!rows.has(date)) rows.set(date, { date, payN: 0, payAmt: 0, refN: 0, refAmt: 0, fee: 0, vat: 0, net: 0, days: new Set(), list: [] });
    const r = rows.get(date);
    if (e.kind === 'pay') { r.payN++; r.payAmt += e.amount; } else { r.refN++; r.refAmt += -e.amount; }
    r.fee += e.fee; r.vat += e.vat; r.net += e.amount - e.fee - e.vat; r.days.add(e.day); r.list.push(e);
  }
  const out = [...rows.values()].filter(r => (!from || r.date >= from) && (!to || r.date <= to)).sort((a, b) => b.date.localeCompare(a.date)).map(r => {
    const chk = (cfg.checks || {})[r.date];
    return { ...r, days: [...r.days].sort(), list: r.list.sort((a, b) => a.day.localeCompare(b.day)), status: r.date > today ? 'plan' : chk ? 'done' : 'check', statusName: r.date > today ? '정산 예정' : chk ? '입금 확인' : '입금 확인 필요', checked: chk || null };
  });
  const sum = k => out.reduce((a, r) => a + r[k], 0);
  return { rows: out, total: { payN: sum('payN'), payAmt: sum('payAmt'), refN: sum('refN'), refAmt: sum('refAmt'), fee: sum('fee'), vat: sum('vat'), net: sum('net'),
    plan: out.filter(r => r.status === 'plan').reduce((a, r) => a + r.net, 0), check: out.filter(r => r.status === 'check').length } };
}

// ── 출고 예정일: 결제가 영업일 출고 마감(기본 13:00) 전이면 그날, 아니면 다음 영업일(주말·공휴일 건너뜀)
//    그날이 지나도록 발송 안 하면 '출고 지연'(스마트스토어 발송기한·발송지연과 같은 개념)
const kstNow = () => new Date(Date.now() + 9 * 3600e3).toISOString();
export function shipDue(o, cfg = SHIP_DEFAULT, holidays = HOLIDAYS) {
  if (!o.paidAt) return '';
  const t = new Date(Date.parse(o.paidAt) + 9 * 3600e3).toISOString(), day = t.slice(0, 10), hm = t.slice(11, 16);
  const H = new Set(holidays || []), w = new Date(day + 'T00:00:00Z').getUTCDay(), open = w !== 0 && w !== 6 && !H.has(day);
  return open && hm < (cfg.cutoff || '13:00') ? day : bizDay(day, 1, holidays);
}
export const isLate = (o, cfg = SHIP_DEFAULT, holidays = HOLIDAYS) => o.status === 'paid' && ['new', 'prep'].includes((o.fulfil || {}).status || 'new') && !claimOpen(o.claim) && !!o.paidAt && kstNow().slice(0, 10) > shipDue(o, cfg, holidays);
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const dueLabel = d => { if (!d) return ''; const today = kstNow().slice(0, 10); return d === today ? '오늘 출고 예정' : `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일(${WD[new Date(d + 'T00:00:00Z').getUTCDay()]}) 출고 예정`; };

// ── 손님이 주문 조회에서 직접 하는 요청: 발송 전 = 취소 요청, 발송 뒤 = 반품·교환 요청(받은 날부터 7일 — 배송 완료 전이면 발송일부터 14일까지)
export const CUSTOMER_REASONS = {
  cancel: ['단순 변심', '주소·옵션을 잘못 넣음', '다른 상품으로 다시 주문', '기타'],
  return: ['단순 변심', '상품 불량·파손', '주문과 다른 상품이 옴', '기타'],
  exchange: ['사이즈·색상 바꾸기', '상품 불량·파손', '주문과 다른 상품이 옴', '기타'],
};
const SELLER_FAULT = /불량|파손|다른 상품이 옴/;
export function customerCan(o, cfg = SHIP_DEFAULT) {
  if (o.status !== 'paid' || claimOpen(o.claim)) return { cancel: false, ret: false };
  const f = fulfilNow(o, cfg), sent = ['shipped', 'delivered'].includes(f.status);
  const until = f.deliveredAt ? Date.parse(f.deliveredAt) + 7 * 864e5 : f.shippedAt ? Date.parse(f.shippedAt) + 14 * 864e5 : 0;
  return { cancel: !sent, ret: sent && Date.now() <= until };
}
export function customerClaim(o, d, cfg = SHIP_DEFAULT) {
  const type = String(d.type || ''), can = customerCan(o, cfg), list = CUSTOMER_REASONS[type];
  if (!list) bad('요청 종류를 골라 주세요');
  if (type === 'cancel' ? !can.cancel : !can.ret) bad(type === 'cancel' ? '이미 발송했거나 요청이 진행 중이라 취소 요청을 할 수 없습니다. 반품으로 요청하거나 고객센터로 연락해 주세요.' : '반품·교환을 요청할 수 있는 기간(받은 날부터 7일)이 지났거나 요청이 진행 중입니다. 고객센터로 연락해 주세요.');
  const reason = list.includes(d.reason) ? d.reason : '';
  if (!reason) bad('사유를 골라 주세요');
  const detail = line(d.detail, 200);
  if (reason === '기타' && !detail) bad('사유를 적어 주세요');
  return applyClaim(o, { action: 'request', type, reason: detail ? `${reason} — ${detail}` : reason, fault: type === 'cancel' ? 'buyer' : SELLER_FAULT.test(reason) ? 'seller' : 'buyer', memo: '손님이 주문 조회에서 요청' }, { id: 'customer', name: '손님' });
}
