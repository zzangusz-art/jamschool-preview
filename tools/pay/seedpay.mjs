// 홈페이지 결제: 씨드페이먼츠 결제창 연동 — tools/serve.mjs 가 /api/pay/* 를 여기로 넘긴다
//   규격: 씨드페이먼츠 개발자센터 https://www.seedfinancial.co.kr/service/seedpayments/guide
//         (가맹점 연동 가이드(결제창) v1.0 2026-11-04 · 결제통보 가이드 v0.9.6 · 위변조 검증 hashString)
//   흐름: 주문서 → POST /api/pay/ready(서버가 상품 데이터로 금액 계산·주문 저장·hashString)
//         → 결제창 pgAsistant.js SendPay(payInit) → 인증 결과 POST /api/pay/return(resultCd·signData·금액 확인)
//         → 승인 /payment/v1/approval(nonce·tid·payData) → 결과 확인 → 303 /order-complete.html?o=주문번호&t=조회키
//   승인 응답을 못 받거나 확인·저장에 실패하면 망취소(/payment/v1/netCancel). 관리자 취소는 /payment/v1/cancel.
//   결제통보(Webhook): 씨드 → POST /api/pay/noti (JSON, 발신 IP 13.125.71.243·43.202.81.140) — 가맹점 관리자에서 URL 등록
// 환경 변수(Railway): SEEDPAY_MERCHANT_KEY(가맹점 키, 필수·비밀), SEEDPAY_MID(상점 ID, 기본 Startz002m),
//   SEEDPAY_ENV(test 면 테스트 서버 devpay, 그 밖은 운영 pay), DATA_DIR(주문 저장 볼륨 → DATA_DIR/orders).
//   가맹점 키는 저장소·로그·브라우저로 절대 내보내지 않는다.
// 결제 켜기/끄기: 관리자 어드민 '결제 주문'(DATA_DIR/orders/settings.json). 꺼져 있어도 checkout.html?pg=test 로 시험 결제 가능.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { clientIp } from '../client-ip.mjs';
import { notifyOrder } from './notify.mjs';   // 결제 완료·확인 필요 주문 텔레그램 알림(기다리지 않음, 실패는 로그만)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const MID = () => (process.env.SEEDPAY_MID || 'Startz002m').trim();
const KEY = () => (process.env.SEEDPAY_MERCHANT_KEY || '').trim();
const TEST = () => /^test$/i.test((process.env.SEEDPAY_ENV || '').trim());
const BASE = () => TEST() ? 'https://devpay.seedpayments.co.kr' : 'https://pay.seedpayments.co.kr';
const URLS = () => ({ script: `${BASE()}/js/pgAsistant.js`, approval: `${BASE()}/payment/v1/approval`, netCancel: `${BASE()}/payment/v1/netCancel`, cancel: `${BASE()}/payment/v1/cancel` });
const DIR = () => process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'orders') : (process.env.ORDERS_DIR || path.join(ROOT, '.data', 'orders'));
const NOTI_IPS = () => (process.env.SEEDPAY_NOTI_IPS || '13.125.71.243,43.202.81.140').split(',').map(s => s.trim()).filter(Boolean);
// 결제 수단: 모두 신용카드(method=CARD, 결과 method 01). 간편결제는 결제창을 건너뛰고 간편결제사 화면을 바로 연다
//   directType=1 · directCardCode=00 · ezpAuthCd(02 카카오페이, 05 네이버페이) · directCardQuota · directCardPointFlag 필수
const METHOD = { card: 'CARD', npay: 'CARD', kakaopay: 'CARD' };
const DIRECT = {
  kakaopay: { directType: '1', directCardCode: '00', ezpAuthCd: '02', directCardQuota: '00', directCardPointFlag: '0' },
  npay: { directType: '1', directCardCode: '00', ezpAuthCd: '05', directCardQuota: '00', directCardPointFlag: '0' },
};
const EZP = { '02': '카카오페이', '05': '네이버페이' };
const TIMEOUT = 30000;

// ───────── 공통
class PayError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a || '').trim().toLowerCase()), y = Buffer.from(String(b || '').toLowerCase()); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
const kstStamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\D/g, '').slice(0, 14);   // yyyyMMddHHmmss
const nowIso = () => new Date().toISOString();
const toInt = v => { const s = String(v ?? '').replace(/,/g, '').trim(); if (!/^\d+$/.test(s)) return -1; const n = Number(s); return Number.isSafeInteger(n) ? n : -1; };
const log = (...a) => console.log('[pay]', ...a);
const clean = s => String(s ?? '').normalize('NFC').replace(/[^가-힣ㄱ-ㆎ\w .,·()/×\-]/g, ' ').replace(/\s+/g, ' ').trim();
const digits = s => String(s ?? '').replace(/\D/g, '');
const str = v => String(v ?? '').trim();
// x-www-form-urlencoded(UTF-8) — 바이트로 풀고 값마다 utf-8(실패하면 euc-kr)로 읽는다
function parseForm(buf) {
  const out = {};
  const pct = s => { const b = []; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === 0x2B) b.push(0x20); else if (c === 0x25 && i + 2 < s.length) { b.push(parseInt(String.fromCharCode(s[i + 1], s[i + 2]), 16)); i += 2; } else b.push(c); } return Uint8Array.from(b.map(x => Number.isNaN(x) ? 0x3F : x)); };
  const txt = u8 => { try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch { return new TextDecoder('euc-kr').decode(u8); } };
  let start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i < buf.length && buf[i] !== 0x26) continue;
    const part = buf.subarray(start, i); start = i + 1; if (!part.length) continue;
    const eq = part.indexOf(0x3D);
    const k = txt(pct(eq < 0 ? part : part.subarray(0, eq))), v = eq < 0 ? '' : txt(pct(part.subarray(eq + 1)));
    if (k && !(k in out)) out[k] = v;
  }
  return out;
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > max) { reject(new PayError(413, '요청이 너무 큽니다')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }); res.end(JSON.stringify(obj)); };
const text = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); };
const redirect = (res, to) => { res.writeHead(303, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };

// ───────── 상품 데이터(가격은 브라우저 값이 아니라 여기서 다시 계산) — data.js + 어드민 수정값(content/site.json)
let DATA = null;
function siteData() {
  const files = ['assets/js/data.js', 'content/site.json'].map(f => path.join(ROOT, f));
  const stamp = files.map(f => fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs || 0).join(':');
  if (DATA && DATA.stamp === stamp) return DATA.jam;
  const src = fs.readFileSync(files[0], 'utf8');
  let ov = {}; try { ov = JSON.parse(fs.readFileSync(files[1], 'utf8')); } catch { ov = {}; }
  const ctx = { window: { WEBP: new Set(), JAM_OVERRIDES: ov } }; ctx.globalThis = ctx.window; vm.createContext(ctx);
  vm.runInContext(src.replace(/typeof window !== 'undefined' \? window : globalThis/, 'window'), ctx);
  DATA = { stamp, jam: ctx.window.JAM };
  return DATA.jam;
}
// 주문서의 한 줄(key, qty) → 서버 계산 값. checkout.js load() · shop-core.js itemFor() 와 같은 규칙
function lineFor(J, key, qty) {
  const O = J.OPTIONS_29, q = toInt(qty);
  if (!(q >= 1 && q <= 99)) throw new PayError(400, '수량을 확인해 주세요');
  const k = String(key || '');
  const m = k.match(/^29-(7|12)-(MS|SS|Q)-([a-z]+)$/);
  if (m) {
    const p = J.PRODUCTS.find(x => x.id === 29), t = O.thickness.find(x => x.id === m[1]), s = O.size.find(x => x.id === m[2]), c = O.color.find(x => x.id === m[3]);
    const price = O.price[`${m[1]}-${m[2]}`];
    if (!p || !t || !s || !c || !(price > 0)) throw new PayError(400, '주문할 수 없는 옵션이 있습니다');
    return { key: k, id: 29, name: p.name, gname: gname(p), opt: `${t.label} ${t.sub} / ${s.label} ${s.w}×200 / ${c.label}`, qty: q, price, img: c.id === 'ivory' ? p.imgs[8] : p.imgs[0], cat: p.cat };
  }
  const p = /^\d+$/.test(k) && J.PRODUCTS.find(x => x.id === +k);
  if (!p || p.full || !(p.price > 0)) throw new PayError(400, '주문할 수 없는 상품이 있습니다');
  return { key: k, id: p.id, name: p.name, gname: gname(p), opt: '', qty: q, price: p.price, img: p.imgs[0], cat: p.cat };
}
// 결제창 상품명: 여러 건이면 짧은 이름 + 외 N건. 입점 브랜드(하픽 등)는 '잠스쿨'을 붙이지 않는다
const gname = p => p.brand ? p.short : `잠스쿨 ${p.short}`;
export function pgMethods() {
  const J = siteData();
  return (J.CHECKOUT.pgPay || []).filter(m => METHOD[m.id]).map(({ id, label, note }) => ({ id, label, note }));
}

// ───────── 주문 저장(DATA_DIR/orders/<주문번호>.json — 공개 저장소 밖)
const okId = id => /^JS\d{14}[A-Z0-9]{6}$/.test(String(id || ''));
const fileOf = id => path.join(DIR(), `${id}.json`);
function load(id) { if (!okId(id)) return null; try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { return null; } }
function save(o) {
  fs.mkdirSync(DIR(), { recursive: true });
  o.updatedAt = nowIso();
  const tmp = fileOf(o.moid) + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o, null, 1)); fs.renameSync(tmp, fileOf(o.moid));
  return o;
}
const hist = (o, ev, note) => { (o.history ||= []).push({ at: nowIso(), ev, ...(note ? { note: String(note).slice(0, 300) } : {}) }); };
function settings() { try { return { enabled: false, ...JSON.parse(fs.readFileSync(path.join(DIR(), 'settings.json'), 'utf8')) }; } catch { return { enabled: false }; } }
const newId = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return 'JS' + kstStamp() + Array.from(crypto.randomBytes(6), b => A[b % A.length]).join(''); };

// ───────── 씨드페이먼츠 서버 요청(UTF-8 form, 응답 JSON)
async function postPg(url, params) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT), headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: new URLSearchParams(params).toString() });
  } catch (e) { throw Object.assign(new Error(`통신 실패: ${e.name === 'TimeoutError' ? '응답 시간 초과' : e.message}`), { kind: 'network' }); }
  const raw = (await r.text().catch(() => '')).trim();
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { kind: 'http' });
  try { const j = JSON.parse(raw); if (j && typeof j === 'object') return j; } catch { /* 아래 */ }
  throw Object.assign(new Error('응답 형식 오류'), { kind: 'parse' });
}
// 인증 결과가 준 approvalUrl·netCancelUrl 은 우리가 아는 주소와 같을 때만 받아들인다(다른 주소로는 절대 요청하지 않음)
const knownUrl = (u, want) => { const v = str(u); return !v || v === want; };
async function netCancel(o, tid, why) {
  const edi = kstStamp();
  try {
    const r = await postPg(URLS().netCancel, { tid, mid: MID(), ordNo: o.moid, ccMsg: why.slice(0, 40), ediDate: edi, hashString: sha256(MID() + edi + tid + KEY()) });
    return { ok: str(r.resultCd) === '0000', msg: `${str(r.resultCd)} ${str(r.resultMsg)}`.trim() };
  } catch (e) { return { ok: false, msg: e.message }; }
}

// ───────── 1) 결제 준비
const RATE = new Map();
function limited(ip) {
  const now = Date.now(), list = (RATE.get(ip) || []).filter(t => now - t < 10 * 60e3);
  list.push(now); RATE.set(ip, list);
  if (RATE.size > 5000) for (const [k, v] of RATE) if (!v.some(t => now - t < 10 * 60e3)) RATE.delete(k);
  return list.length > 20;
}
function origin(req) {
  const host = (process.env.CANONICAL_HOST || '').trim().toLowerCase();
  if (host) return `https://${host}`;
  const h = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!/^[\w.-]+(:\d+)?$/.test(h)) throw new PayError(400, '잘못된 요청');
  const proto = String(req.headers['x-forwarded-proto'] || '').includes('https') ? 'https' : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h) ? 'http' : 'https';
  return `${proto}://${h}`;
}
async function ready(req) {
  if (!KEY()) throw new PayError(503, '결제 설정이 아직 끝나지 않았습니다. 고객센터로 문의해 주세요.');
  const ip = clientIp(req);
  if (limited(ip)) throw new PayError(429, '잠시 뒤 다시 시도해 주세요.');
  let d; try { d = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8')); } catch (e) { throw e instanceof PayError ? e : new PayError(400, '요청 형식 오류'); }
  const J = siteData();
  const m = pgMethods().find(x => x.id === d.method);
  if (!m) throw new PayError(400, '결제 수단을 다시 골라 주세요.');
  if (!Array.isArray(d.items) || !d.items.length || d.items.length > 20) throw new PayError(400, '주문 상품을 확인해 주세요.');
  const items = d.items.map(x => lineFor(J, x && x.key, x && x.qty));
  const sub = items.reduce((a, x) => a + x.price * x.qty, 0), ship = toInt(J.CHECKOUT.shipFee) > 0 ? toInt(J.CHECKOUT.shipFee) : 0, amount = sub + ship;
  if (!(amount > 0 && amount <= 99999999)) throw new PayError(400, '결제 금액을 확인해 주세요.');
  const b = d.buyer || {}, r = d.receiver || {};
  const name = clean(b.name).slice(0, 20), tel = digits(b.tel), mail = String(b.email || '').trim().slice(0, 60);
  const rname = clean(r.name).slice(0, 20), rtel = digits(r.tel), zip = digits(r.zip), a1 = String(r.addr1 || '').trim().slice(0, 200), a2 = String(r.addr2 || '').trim().slice(0, 100);
  const tel_ok = t => /^01[016789]\d{7,8}$/.test(t);
  if (name.length < 2 || !tel_ok(tel) || rname.length < 2 || !tel_ok(rtel) || zip.length !== 5 || !a1 || !a2) throw new PayError(400, '주문자·배송지 정보를 확인해 주세요.');
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) throw new PayError(400, '이메일 주소 형식을 확인해 주세요.');
  const o = {
    moid: newId(), token: crypto.randomBytes(24).toString('base64url'), status: 'ready', method: m.id, payMethod: METHOD[m.id], payLabel: m.label,
    amount, sub, ship, items, buyNow: !!d.buyNow, createdAt: nowIso(), pgEnv: TEST() ? 'test' : 'real',
    buyer: { name, tel, email: mail }, receiver: { name: rname, tel: rtel, zip, addr1: a1, addr2: a2, memo: String(r.memo || '').trim().slice(0, 100), jeju: !!r.jeju || /^63/.test(zip) },
    fulfil: { status: 'new' }, history: [],
  };
  hist(o, 'ready', `${m.label} ${amount}원`); save(o);
  const first = clean(items.length > 1 ? items[0].gname : items[0].name), more = items.length > 1 ? ` 외 ${items.length - 1}건` : '';
  const edi = kstStamp(), amt = String(amount), u = URLS();
  log('ready', o.moid, amt, m.id, TEST() ? 'test' : '');
  return {
    moid: o.moid, script: u.script, mode: TEST() ? 'TEST' : 'REAL', base: BASE(), returnUrl: `${origin(req)}/api/pay/return`,
    fields: {
      method: o.payMethod, mid: MID(), trxCd: '0', goodsNm: first.slice(0, 40 - more.length) + more, ordNo: o.moid, goodsAmt: amt,
      ordNm: name.slice(0, 30), ordTel: tel, ordEmail: mail, ...(ip && ip.length <= 20 ? { ordIp: ip } : {}),
      mbsReserved: o.moid, returnUrl: `${origin(req)}/api/pay/return`, ediDate: edi, hashString: sha256(MID() + edi + amt + KEY()),
      ...(DIRECT[m.id] || {}),
    },
  };
}

// ───────── 2) 인증 결과 → 승인
const BUSY = new Set();
async function approve(data) {
  const id = str(data.ordNo) || str(data.mbsReserved), o = load(id);
  if (!o) { log('return: 주문 없음', id || '-'); return null; }
  const done = `/order-complete.html?o=${o.moid}&t=${o.token}`;
  if (o.status !== 'ready' || BUSY.has(o.moid)) return done;   // 새로고침·두 번 전송: 이미 처리 중이거나 끝난 주문
  BUSY.add(o.moid);
  try {
    const fail = (status, msg) => {
      o.status = status; o.fail = { msg: String(msg || '').slice(0, 300) }; hist(o, status, msg);
      if (status === 'check') notifyOrder(o, 'check', o.fail.msg);   // 돈이 빠져나갔을 수 있는 주문 — 저장이 실패해도 알리도록 저장보다 먼저
      save(o); log(status, o.moid, msg); return done;
    };
    if (str(data.resultCd) !== '0000') return fail('failed', str(data.resultMsg) || '결제를 취소했거나 인증에 실패했습니다');
    const tid = str(data.tid), nonce = str(data.nonce), payData = str(data.payData), amt = str(data.goodsAmt), edi = str(data.ediDate), u = URLS();
    const bad = !tid || !nonce || !payData || !edi ? '인증 결과 값 누락'
      : str(data.mid) !== MID() ? 'MID 불일치'
      : str(data.ordNo) !== o.moid ? '주문번호 불일치'
      : toInt(amt) !== o.amount ? '금액 불일치'
      : data.method != null && str(data.method) !== '' && str(data.method) !== '01' ? '결제수단 불일치'
      : !same(data.signData, sha256(tid + MID() + edi + amt + o.moid + KEY())) ? '인증 서명(signData) 불일치'
      : !knownUrl(data.approvalUrl, u.approval) || !knownUrl(data.netCancelUrl, u.netCancel) ? '승인·망취소 주소가 씨드페이먼츠 주소와 다름' : '';
    if (bad) return fail('failed', `결제 확인 실패(${bad})`);   // 승인 전이라 돈은 빠져나가지 않는다
    o.status = 'approving'; o.pg = { tid }; hist(o, 'approving'); save(o);
    const e2 = kstStamp(), a = String(o.amount);
    let r;
    try {
      r = await postPg(u.approval, { nonce, tid, ediDate: e2, mid: MID(), goodsAmt: a, mbsReserved: o.moid, hashString: sha256(MID() + e2 + a + KEY()), payData });
    } catch (e) {
      const nc = await netCancel(o, tid, '승인 응답 없음');
      return fail(nc.ok ? 'failed' : 'check', `승인 응답을 받지 못해 ${nc.ok ? '결제를 취소했습니다' : '망취소도 실패 — 씨드페이먼츠 가맹점 관리자에서 거래 확인 필요'} (${e.message} / ${nc.msg})`);
    }
    if (str(r.resultCd) !== '0000') return fail('failed', `${str(r.resultMsg) || '승인 거절'} (${str(r.resultCd) || '코드 없음'})`);
    const rbad = str(r.tid) !== tid ? '거래번호' : r.mid != null && str(r.mid) !== MID() ? 'MID'
      : r.ordNo != null && str(r.ordNo) !== '' && str(r.ordNo) !== o.moid ? '주문번호' : toInt(r.goodsAmt) !== o.amount ? '금액' : '';
    if (rbad) {
      const nc = await netCancel(o, tid, '승인 응답 확인 실패');
      return fail(nc.ok ? 'failed' : 'check', `승인 응답 확인 실패(${rbad}) — ${nc.ok ? '결제를 취소했습니다' : '망취소 실패, 씨드페이먼츠 가맹점 관리자에서 거래 확인 필요'} (${nc.msg})`);
    }
    const ezp = str(r.ezpAuthCd);
    o.status = 'paid'; o.paidAt = nowIso();
    o.pg = { tid, authCode: str(r.appNo), authDate: `${str(r.trDt)}${str(r.trTm)}`, resultCode: '0000', resultMsg: str(r.resultMsg),
      cardName: [EZP[ezp], str(r.fnNm)].filter(Boolean).join(' '), cardNo: str(r.cardNo), cardQuota: str(r.quotaMon), ezpAuthCd: ezp,
      chkcard: str(r.chkcardFlg), noInt: str(r.noIntFlg) };
    hist(o, 'paid', `${o.payLabel} ${o.amount}원 승인 ${o.pg.authCode}`);
    try { save(o); } catch (e) {
      const nc = await netCancel(o, tid, '주문 저장 실패');
      log('저장 실패', o.moid, e.message, nc.msg);
      if (!nc.ok) notifyOrder(o, 'check', `결제는 승인됐지만 주문 저장 실패 · 망취소도 실패 — 씨드페이먼츠 가맹점 관리자에서 거래 확인 필요 (${nc.msg})`);
      return `/order-complete.html?e=save`;
    }
    log('paid', o.moid, o.amount, o.pg.authCode);
    notifyOrder(o, 'paid');
    return done;
  } finally { BUSY.delete(o.moid); }
}

// ───────── 3) 결제통보(Webhook): 승인 응답을 놓친 거래·가맹점 관리자에서 한 취소를 주문 상태에 맞춘다
async function noti(req) {
  const ip = clientIp(req);
  if (!NOTI_IPS().includes(ip)) { log('noti: 허용 안 된 IP', ip); return 403; }
  let d; try { d = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8')); } catch { return 400; }
  if (!d || typeof d !== 'object') return 400;
  if (str(d.mid) && str(d.mid) !== MID()) { log('noti: 다른 상점', str(d.mid)); return 200; }
  const o = load(str(d.ordNo)) || load(str(d.mbsReserved));
  if (!o) { log('noti: 주문 없음', str(d.ordNo) || '-', str(d.tid)); return 200; }   // 홈페이지 밖 거래 — 다시 보내지 않게 200
  const tid = str(d.tid), otid = str(d.otid), st = str(d.trxStCd), ok = str(d.resultCd) === '0000';
  const isCancel = !!otid || ['1', '2', '9'].includes(st);
  const seen = (o.notis ||= []);
  const sig = `${isCancel ? 'cancel' : 'pay'}:${tid}:${str(d.ccSeq)}`;
  if (seen.includes(sig)) return 200;   // 재전송
  seen.push(sig);
  if (!ok) { hist(o, '결제통보', `${str(d.resultCd)} ${str(d.resultMsg)}`); save(o); return 200; }
  if (isCancel) {
    const full = str(d.partCanFlg) !== '1';
    if (o.pg && o.pg.tid && otid === o.pg.tid && full && o.status !== 'cancelled') {
      o.status = 'cancelled';
      o.cancel = { at: nowIso(), by: 'seed', msg: st === '9' ? '망취소(결제통보)' : '가맹점 관리자 취소(결제통보)', code: '0000', cancelNum: tid };
    }
    hist(o, '결제통보 · 취소', `${toInt(d.ccAmt) >= 0 ? toInt(d.ccAmt) + '원' : ''} ${full ? '전체' : '부분'} 취소 · ${tid}`); save(o); return 200;
  }
  // 승인 통보: 승인 응답을 놓쳐 '승인 중'·'확인 필요'로 남은 주문만 결제 완료로 맞춘다(금액·거래번호가 같을 때)
  if (['approving', 'check'].includes(o.status) && o.pg && o.pg.tid === tid && toInt(d.goodsAmt) === o.amount) {
    o.status = 'paid'; o.paidAt = nowIso(); o.fail = undefined;
    o.pg = { ...o.pg, authCode: str(d.appNo), authDate: `${str(d.trDt)}${str(d.trTm)}`, cardName: str(d.fnNm), cardNo: str(d.cardNo), cardQuota: str(d.quotaMon) };
    hist(o, '결제통보 · 결제 완료로 맞춤', `${o.amount}원 승인 ${o.pg.authCode}`); save(o);
    notifyOrder(o, 'paid');
    return 200;
  }
  if (o.status !== 'paid' && toInt(d.goodsAmt) === o.amount) {
    // 우리 쪽은 실패로 끝났는데 씨드에는 승인된 거래 — 사람이 확인해야 한다
    o.status = 'check'; o.fail = { msg: `결제통보로 승인 거래 확인(${tid}) — 가맹점 관리자에서 취소 또는 발송 결정 필요` };
    hist(o, '결제통보 · 확인 필요', tid); notifyOrder(o, 'check', o.fail.msg); save(o); return 200;
  }
  hist(o, '결제통보', `승인 ${tid}`); save(o);
  return 200;
}

// ───────── 4) 주문 완료 화면용(가린 요약)
const mask = s => { s = String(s || ''); return s.length <= 1 ? s : s.length === 2 ? s[0] + '*' : s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]; };
function publicView(o) {
  const QUOTA = q => !q || +q === 0 ? '일시불' : `${+q}개월`;
  return {
    no: o.moid, status: o.status, mode: 'pg', pay: o.method,
    payLabel: o.status === 'paid' && o.pg && o.pg.cardName ? `${o.payLabel} (${o.pg.cardName} · ${QUOTA(o.pg.cardQuota)})` : o.payLabel,
    total: o.amount, sub: o.sub, ship: o.ship, items: o.items.map(({ id, name, opt, qty, price, img, cat }) => ({ id, name, opt, qty, price, img, cat })),
    name: mask(o.receiver.name), tel: `${o.receiver.tel.slice(0, 3)}-****-${o.receiver.tel.slice(-4)}`, addr: `(${o.receiver.zip}) ${o.receiver.addr1} · 상세 주소 생략`,
    memo: o.receiver.memo, jeju: o.receiver.jeju, buyNow: o.buyNow, fail: o.status === 'paid' ? '' : (o.fail && o.fail.msg) || '',
  };
}

// ───────── serve.mjs 연결: 처리했으면 true
export async function handlePay(req, res) {
  const url = new URL(req.url || '/', 'http://x'), p = url.pathname;
  if (!p.startsWith('/api/pay/')) return false;
  try {
    if (p === '/api/pay/config' && req.method === 'GET') {
      const s = settings();
      json(res, 200, { ready: !!KEY(), enabled: !!(KEY() && s.enabled), methods: KEY() ? pgMethods() : [], test: TEST() }); return true;
    }
    if (p === '/api/pay/ready' && req.method === 'POST') { json(res, 200, await ready(req)); return true; }
    if (p === '/api/pay/return' && req.method === 'POST') {
      const data = parseForm(await readBody(req, 64 * 1024));
      const to = KEY() ? await approve(data) : null;
      redirect(res, to || '/order-complete.html?e=1'); return true;
    }
    if (p === '/api/pay/noti' && req.method === 'POST') {
      let code = 500;
      try { code = await noti(req); } catch (e) { console.error('[pay] noti', e); code = 500; }   // 200 이 아니면 씨드가 다시 보낸다
      text(res, code, code === 200 ? 'OK' : 'FAIL'); return true;
    }
    if (p === '/api/pay/order' && req.method === 'GET') {
      const o = load(url.searchParams.get('o'));
      if (!o || !same(url.searchParams.get('t'), o.token)) { json(res, 404, { error: '주문 정보를 찾을 수 없습니다' }); return true; }
      json(res, 200, publicView(o)); return true;
    }
    json(res, 404, { error: '없는 요청' }); return true;
  } catch (e) {
    const status = e instanceof PayError ? e.status : 500;
    if (status >= 500) console.error('[pay]', e);
    json(res, status, { error: e instanceof PayError ? e.message : '결제를 준비하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }); return true;
  }
}

// ───────── 관리자 어드민(tools/admin/server.mjs) — 로그인·권한은 어드민이 확인한다
const LABEL = { ready: '결제 전', approving: '승인 중', paid: '결제 완료', failed: '결제 안 됨', check: '확인 필요', cancelled: '결제 취소' };
export function adminStatus() {
  const k = KEY(), host = (process.env.CANONICAL_HOST || 'jamschool.kr').trim();
  return { keySet: !!k, mid: MID(), enabled: settings().enabled, dataDir: !!process.env.DATA_DIR, methods: k ? pgMethods() : [], test: TEST(), notiUrl: `https://${host}/api/pay/noti` };
}
export function listOrders({ all = false } = {}) {
  let names = []; try { names = fs.readdirSync(DIR()).filter(f => /^JS\w+\.json$/.test(f)); } catch { names = []; }
  return names.map(f => load(f.slice(0, -5))).filter(Boolean)
    .filter(o => all || ['paid', 'check', 'cancelled', 'approving'].includes(o.status))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 500)
    .map(o => ({ moid: o.moid, createdAt: o.createdAt, paidAt: o.paidAt || '', status: o.status, statusName: LABEL[o.status] || o.status, amount: o.amount, payLabel: o.payLabel,
      items: o.items.map(x => `${x.name}${x.opt ? ` (${x.opt})` : ''} × ${x.qty}`), receiver: o.receiver.name, fulfil: (o.fulfil || {}).status || 'new', fail: (o.fail || {}).msg || '' }));
}
export function getOrderAdmin(id) {
  const o = load(id); if (!o) throw new PayError(404, '주문을 찾을 수 없습니다');
  const { token, ...rest } = o;
  return { ...rest, statusName: LABEL[o.status] || o.status };
}
export function setFulfil(id, status, user) {
  const o = load(id); if (!o) throw new PayError(404, '주문을 찾을 수 없습니다');
  if (o.status !== 'paid') throw new PayError(400, '결제 완료된 주문만 발송 처리할 수 있습니다');
  const st = status === 'shipped' ? 'shipped' : 'new';
  o.fulfil = { status: st, at: nowIso(), by: user.id };
  hist(o, st === 'shipped' ? '발송 처리' : '발송 전으로', `${user.name}(${user.id})`); save(o);
  return getOrderAdmin(id);
}
export async function cancelOrder(id, reason, user) {
  const o = load(id); if (!o) throw new PayError(404, '주문을 찾을 수 없습니다');
  if (o.status !== 'paid' || !o.pg || !o.pg.tid) throw new PayError(400, '결제 완료된 주문만 취소할 수 있습니다');
  if (!KEY()) throw new PayError(503, '가맹점 키(SEEDPAY_MERCHANT_KEY)가 없습니다');
  if (BUSY.has(o.moid)) throw new PayError(409, '처리 중인 주문입니다. 잠시 뒤 다시 시도해 주세요');
  BUSY.add(o.moid);
  try {
    const edi = kstStamp(), msg = clean(reason || '관리자 취소').slice(0, 40) || '관리자 취소';
    let r;
    try {
      r = await postPg(URLS().cancel, { tid: o.pg.tid, mid: MID(), ordNo: o.moid, ccMsg: msg, ccNm: clean(user.name).slice(0, 30), ccId: String(user.id || '').slice(0, 10),
        partCanFlg: '0', ediDate: edi, hashString: sha256(MID() + edi + o.pg.tid + KEY()) });
    } catch (e) { throw new PayError(502, `취소 요청을 보내지 못했습니다(${e.message}). 씨드페이먼츠 가맹점 관리자에서 취소 여부를 확인해 주세요`); }
    if (str(r.resultCd) !== '0000') {
      hist(o, '취소 실패', `${str(r.resultCd)} ${str(r.resultMsg)} — ${user.id}`); save(o);
      throw new PayError(400, `취소되지 않았습니다: ${str(r.resultMsg) || str(r.resultCd)}`);
    }
    const amtOk = r.ccAmt == null || str(r.ccAmt) === '' || toInt(r.ccAmt) === o.amount, tidOk = !str(r.otid) || str(r.otid) === o.pg.tid;
    o.status = 'cancelled';
    o.cancel = { at: nowIso(), by: user.id, msg, code: '0000', cancelNum: str(r.tid), check: amtOk && tidOk ? 'ok' : '취소 금액·원거래 불일치(가맹점 관리자에서 확인)' };
    hist(o, 'cancelled', `${msg} — ${user.name}(${user.id})${amtOk && tidOk ? '' : ' · 응답 금액·원거래 불일치'}`); save(o);
    log('cancelled', o.moid, str(r.tid));
    return getOrderAdmin(id);
  } finally { BUSY.delete(o.moid); }
}
export function setSettings({ enabled }, user) {
  if (enabled && !KEY()) throw new PayError(400, '가맹점 키(SEEDPAY_MERCHANT_KEY)가 Railway 에 없어 켤 수 없습니다');
  fs.mkdirSync(DIR(), { recursive: true });
  const s = { ...settings(), enabled: !!enabled, by: user.id, at: nowIso() };
  fs.writeFileSync(path.join(DIR(), 'settings.json'), JSON.stringify(s, null, 1));
  log('settings', enabled ? 'on' : 'off', user.id);
  return adminStatus();
}
// 시험용(tools/pay/test-pay.mjs)
export const _test = { sha256, parseForm, lineFor, siteData, load, URLS };
