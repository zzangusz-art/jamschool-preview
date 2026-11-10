// 홈페이지 결제: 씨드페이먼츠(나이스페이 웹표준 인증결제와 같은 규격) — tools/serve.mjs 가 /api/pay/* 를 여기로 넘긴다
//   규격: developers.nicepay.co.kr/docs/pg/auth/{payment-window, authorization, net-cancel, payment-cancel}
//   흐름: 주문서 → POST /api/pay/ready(서버가 상품 데이터로 금액 계산·주문 저장·SignData) → 결제창 goPay()
//         → 인증 결과 POST /api/pay/return(서명·금액 확인 → NextAppURL 승인 → 응답 서명 확인 → 결제 완료)
//         → 303 /order-complete.html?o=주문번호&t=조회키 → GET /api/pay/order 로 가린 요약을 보여 준다
//   승인 응답을 못 받거나 확인에 실패하면 망취소(NetCancelURL). 관리자 취소는 cancel_process.jsp.
// 환경 변수(Railway): SEEDPAY_MERCHANT_KEY(상점키, 필수·비밀), SEEDPAY_MID(상점 ID, 기본 Startz002m),
//   DATA_DIR(주문 저장 볼륨, 예 /data → /data/orders). 상점키는 저장소·로그·브라우저로 절대 내보내지 않는다.
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
const DIR = () => process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'orders') : (process.env.ORDERS_DIR || path.join(ROOT, '.data', 'orders'));
export const SCRIPT_URL = 'https://pg-web.nicepay.co.kr/v3/common/js/nicepay-pgweb.js';
// 인증 응답의 NextAppURL·NetCancelURL 은 이 목록과 정확히 같을 때만 쓴다(응답이 준 주소로 바로 요청하지 않는다)
const APPROVE_HOSTS = ['dc1-api.nicepay.co.kr', 'dc2-api.nicepay.co.kr', 'webapi.nicepay.co.kr'];
const CANCEL_URL = 'https://pg-api.nicepay.co.kr/webapi/cancel_process.jsp';
const SUCCESS = { CARD: '3001', BANK: '4000', VBANK: '4100', CELLPHONE: 'A000' };
const METHOD = { card: 'CARD', npay: 'CARD', kakaopay: 'CARD', bank: 'BANK', vbank: 'VBANK' };
// 간편결제 단독 버튼: 나이스페이 결제창을 건너뛰고 제휴사 창을 바로 연다(docs/pg/auth/payment-window-skip). 승인 결과는 카드(3001)와 같다
// 결제창 약관이 생략되므로 주문서가 결제대행 약관 동의를 따로 받는다(checkout.js ag-pg)
const DIRECT = {
  kakaopay: { DirectShowOpt: 'CARD', DirectEasyPay: 'E016' },
  npay: { DirectShowOpt: 'CARD', DirectEasyPay: 'E020', EasyPayMethod: 'E020=CARD' },   // 네이버페이 포인트·머니는 'E020=POINT'(복합결제 불가)
};
const TIMEOUT = 30000;

// ───────── 공통
class PayError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a || '').trim().toLowerCase()), y = Buffer.from(String(b || '').toLowerCase()); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
const kstStamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\D/g, '').slice(0, 14);   // YYYYMMDDHHMISS
const nowIso = () => new Date().toISOString();
const toInt = v => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return Number.isSafeInteger(n) ? n : -1; };
const log = (...a) => console.log('[pay]', ...a);
// 결제창 필드 크기는 euc-kr 바이트 기준(한글 2바이트)
const ebytes = s => [...s].reduce((n, c) => n + (c.charCodeAt(0) < 0x80 ? 1 : 2), 0);
function ecut(s, max) { let out = '', n = 0; for (const c of s) { const b = c.charCodeAt(0) < 0x80 ? 1 : 2; if (n + b > max) break; out += c; n += b; } return out; }
const clean = s => String(s ?? '').normalize('NFC').replace(/[^가-힣ㄱ-ㆎ\w .,·()/×\-]/g, ' ').replace(/\s+/g, ' ').trim();
const digits = s => String(s ?? '').replace(/\D/g, '');

// euc-kr(cp949) 인코딩: 취소 사유처럼 한글을 서버에서 보낼 때. TextDecoder 로 역표를 한 번 만든다
let EUC = null;
function eucMap() {
  if (EUC) return EUC;
  EUC = new Map(); const dec = new TextDecoder('euc-kr');
  for (let a = 0x81; a <= 0xFE; a++) for (let b = 0x41; b <= 0xFE; b++) {
    const ch = dec.decode(Uint8Array.from([a, b]));
    if (ch.length === 1 && ch !== '�' && !EUC.has(ch)) EUC.set(ch, [a, b]);
  }
  return EUC;
}
function encodeEucKr(s) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0);
    if (c < 0x80) { out += /[A-Za-z0-9\-_.*]/.test(ch) ? ch : ch === ' ' ? '+' : '%' + c.toString(16).toUpperCase().padStart(2, '0'); continue; }
    const bytes = eucMap().get(ch); if (!bytes) { out += '+'; continue; }
    out += bytes.map(x => '%' + x.toString(16).toUpperCase()).join('');
  }
  return out;
}
const formBody = obj => Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeEucKr(v)}`).join('&');
// x-www-form-urlencoded 를 바이트로 풀고 값마다 utf-8(실패하면 euc-kr)로 읽는다 — PC 는 euc-kr, 모바일은 CharSet(utf-8) 로 온다
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
// 결제창 상품명(40바이트): 짧은 이름으로. 입점 브랜드(하픽 등)는 '잠스쿨'을 붙이지 않는다
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

// ───────── 나이스페이 서버 요청
async function postPg(url, params) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT), headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=euc-kr' }, body: formBody(params) });
  } catch (e) { throw Object.assign(new Error(`통신 실패: ${e.name === 'TimeoutError' ? '응답 시간 초과' : e.message}`), { kind: 'network' }); }
  const buf = new Uint8Array(await r.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { kind: 'http' });
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('euc-kr').decode(buf); }
  text = text.trim();
  try { const j = JSON.parse(text); if (j && typeof j === 'object') return j; } catch { /* KV 로 시도 */ }
  if (/^\w+=/.test(text)) return Object.fromEntries(text.split('&').map(x => { const i = x.indexOf('='); return [x.slice(0, i), decodeURIComponent(x.slice(i + 1).replace(/\+/g, ' '))]; }));
  throw Object.assign(new Error('응답 형식 오류'), { kind: 'parse' });
}
function pgUrl(u, file) {
  try { const x = new URL(String(u || '')); return x.protocol === 'https:' && APPROVE_HOSTS.includes(x.hostname) && x.pathname === `/webapi/${file}` && !x.search ? `https://${x.hostname}/webapi/${file}` : null; } catch { return null; }
}
async function netCancel(o, tid, authToken, netUrl) {
  const url = pgUrl(netUrl, 'cancel_process.jsp');
  if (!url) return { ok: false, msg: '망취소 주소 없음' };
  const edi = kstStamp(), amt = String(o.amount);
  try {
    const r = await postPg(url, { TID: tid, AuthToken: authToken, MID: MID(), Amt: amt, EdiDate: edi, NetCancel: '1', SignData: sha256(authToken + MID() + amt + edi + KEY()), CharSet: 'utf-8', EdiType: 'JSON' });
    const ok = String(r.ResultCode || '').trim() === '2001';
    return { ok, msg: `${r.ResultCode || ''} ${r.ResultMsg || r.ErrorMsg || ''}`.trim() };
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
    amount, sub, ship, items, buyNow: !!d.buyNow, createdAt: nowIso(),
    buyer: { name, tel, email: mail }, receiver: { name: rname, tel: rtel, zip, addr1: a1, addr2: a2, memo: String(r.memo || '').trim().slice(0, 100), jeju: !!r.jeju || /^63/.test(zip) },
    fulfil: { status: 'new' }, history: [],
  };
  hist(o, 'ready', `${m.label} ${amount}원`); save(o);
  const first = clean(items.length > 1 ? items[0].gname : items[0].name), more = items.length > 1 ? ` 외 ${items.length - 1}건` : '';
  const edi = kstStamp(), amt = String(amount);
  log('ready', o.moid, amt, m.id);
  return {
    moid: o.moid, action: '/api/pay/return', script: SCRIPT_URL,
    fields: {
      PayMethod: o.payMethod, GoodsName: ecut(first, 40 - ebytes(more)) + more, Amt: amt, MID: MID(), Moid: o.moid,
      BuyerName: ecut(name, 30), BuyerTel: tel, BuyerEmail: mail, ReturnURL: `${origin(req)}/api/pay/return`,
      EdiDate: edi, SignData: sha256(edi + MID() + amt + KEY()), ReqReserved: o.moid, CharSet: 'utf-8', GoodsCl: '1',
      ...(DIRECT[m.id] || {}),
    },
  };
}

// ───────── 2) 인증 결과 → 승인
const BUSY = new Set();
async function approve(data) {
  const id = String(data.Moid || data.ReqReserved || '').trim(), o = load(id);
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
    if (String(data.AuthResultCode || '').trim() !== '0000') return fail('failed', data.AuthResultMsg || '결제를 취소했거나 인증에 실패했습니다');
    const token = String(data.AuthToken || '').trim(), tid = String(data.TxTid || '').trim(), amt = String(data.Amt || '').trim();
    const nextUrl = pgUrl(data.NextAppURL, 'pay_process.jsp');
    const bad = !token || !tid ? '인증 응답 값 누락'
      : String(data.MID || '').trim() !== MID() ? 'MID 불일치'
      : toInt(amt) !== o.amount ? '금액 불일치'
      : String(data.PayMethod || o.payMethod).trim().toUpperCase() !== o.payMethod ? '결제수단 불일치'
      : !same(data.Signature, sha256(token + MID() + amt + KEY())) ? '인증 서명 불일치'
      : !nextUrl ? '승인 주소가 허용 목록에 없음' : '';
    if (bad) return fail('failed', `결제 확인 실패(${bad})`);   // 승인 전이라 돈은 빠져나가지 않는다
    o.status = 'approving'; o.pg = { tid }; hist(o, 'approving'); save(o);
    const edi = kstStamp(), a = String(o.amount);
    let r;
    try {
      r = await postPg(nextUrl, { TID: tid, AuthToken: token, MID: MID(), Amt: a, EdiDate: edi, SignData: sha256(token + MID() + a + edi + KEY()), CharSet: 'utf-8', EdiType: 'JSON' });
    } catch (e) {
      const nc = await netCancel(o, tid, token, data.NetCancelURL);
      return fail(nc.ok ? 'failed' : 'check', `승인 응답을 받지 못해 ${nc.ok ? '결제를 취소했습니다' : '망취소도 실패 — 나이스페이 관리자에서 거래 확인 필요'} (${e.message} / ${nc.msg})`);
    }
    const code = String(r.ResultCode || '').trim();
    if (code !== SUCCESS[o.payMethod]) return fail('failed', `${r.ResultMsg || '승인 거절'} (${code || '코드 없음'})`);
    const rbad = String(r.MID || '').trim() !== MID() ? 'MID' : String(r.Moid || '').trim() !== o.moid ? '주문번호'
      : String(r.TID || '').trim() !== tid ? '거래번호' : toInt(r.Amt) !== o.amount ? '금액'
      : !same(r.Signature, sha256(String(r.TID || '').trim() + String(r.MID || '').trim() + String(r.Amt || '').trim() + KEY())) ? '서명' : '';
    if (rbad) {
      const nc = await netCancel(o, tid, token, data.NetCancelURL);
      return fail(nc.ok ? 'failed' : 'check', `승인 응답 확인 실패(${rbad}) — ${nc.ok ? '결제를 취소했습니다' : '망취소 실패, 나이스페이 관리자에서 거래 확인 필요'} (${nc.msg})`);
    }
    o.status = 'paid'; o.paidAt = nowIso();
    o.pg = { tid, authCode: r.AuthCode || '', authDate: r.AuthDate || '', resultCode: code, resultMsg: r.ResultMsg || '',
      cardName: r.CardName || '', cardNo: r.CardNo || '', cardQuota: r.CardQuota || '', cardCl: r.CardCl || '', bankName: r.BankName || '' };
    hist(o, 'paid', `${o.payLabel} ${o.amount}원 승인 ${o.pg.authCode}`);
    try { save(o); } catch (e) {
      const nc = await netCancel(o, tid, token, data.NetCancelURL);
      log('저장 실패', o.moid, e.message, nc.msg);
      if (!nc.ok) notifyOrder(o, 'check', `결제는 승인됐지만 주문 저장 실패 · 망취소도 실패 — 나이스페이 관리자에서 거래 확인 필요 (${nc.msg})`);
      return `/order-complete.html?e=save`;
    }
    log('paid', o.moid, o.amount, o.pg.authCode);
    notifyOrder(o, 'paid');
    return done;
  } finally { BUSY.delete(o.moid); }
}

// ───────── 3) 주문 완료 화면용(가린 요약)
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
      json(res, 200, { ready: !!KEY(), enabled: !!(KEY() && s.enabled), methods: KEY() ? pgMethods() : [] }); return true;
    }
    if (p === '/api/pay/ready' && req.method === 'POST') { json(res, 200, await ready(req)); return true; }
    if (p === '/api/pay/return' && req.method === 'POST') {
      const data = parseForm(await readBody(req, 64 * 1024));
      const to = KEY() ? await approve(data) : null;
      redirect(res, to || '/order-complete.html?e=1'); return true;
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
  const k = KEY();
  return { keySet: !!k, mid: MID(), enabled: settings().enabled, dataDir: !!process.env.DATA_DIR, methods: k ? pgMethods() : [] };
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
  if (!KEY()) throw new PayError(503, '상점키(SEEDPAY_MERCHANT_KEY)가 없습니다');
  if (BUSY.has(o.moid)) throw new PayError(409, '처리 중인 주문입니다. 잠시 뒤 다시 시도해 주세요');
  BUSY.add(o.moid);
  try {
    const edi = kstStamp(), amt = String(o.amount), msg = clean(reason || '관리자 취소').slice(0, 40) || '관리자 취소';
    let r;
    try {
      r = await postPg(CANCEL_URL, { TID: o.pg.tid, MID: MID(), Moid: o.moid, CancelAmt: amt, CancelMsg: msg, PartialCancelCode: '0', EdiDate: edi, SignData: sha256(MID() + amt + edi + KEY()), CharSet: 'utf-8', EdiType: 'JSON' });
    } catch (e) { throw new PayError(502, `취소 요청을 보내지 못했습니다(${e.message}). 나이스페이 관리자에서 취소 여부를 확인해 주세요`); }
    const code = String(r.ResultCode || '').trim();
    if (code !== '2001' && code !== '2211') {
      hist(o, '취소 실패', `${code} ${r.ResultMsg || r.ErrorMsg || ''} — ${user.id}`); save(o);
      throw new PayError(400, `취소되지 않았습니다: ${r.ResultMsg || r.ErrorMsg || code}`);
    }
    const sigOk = same(r.Signature, sha256(String(r.TID || '').trim() + String(r.MID || '').trim() + String(r.CancelAmt || '').trim() + KEY()));
    o.status = 'cancelled';
    o.cancel = { at: nowIso(), by: user.id, msg, code, cancelNum: r.CancelNum || '', signature: sigOk ? 'ok' : '불일치(나이스페이 관리자에서 확인)' };
    hist(o, 'cancelled', `${msg} — ${user.name}(${user.id})${sigOk ? '' : ' · 응답 서명 불일치'}`); save(o);
    log('cancelled', o.moid, code);
    return getOrderAdmin(id);
  } finally { BUSY.delete(o.moid); }
}
export function setSettings({ enabled }, user) {
  if (enabled && !KEY()) throw new PayError(400, '상점키(SEEDPAY_MERCHANT_KEY)가 Railway 에 없어 켤 수 없습니다');
  fs.mkdirSync(DIR(), { recursive: true });
  const s = { ...settings(), enabled: !!enabled, by: user.id, at: nowIso() };
  fs.writeFileSync(path.join(DIR(), 'settings.json'), JSON.stringify(s, null, 1));
  log('settings', enabled ? 'on' : 'off', user.id);
  return adminStatus();
}
// 시험용(tools/pay/test-pay.mjs)
export const _test = { sha256, parseForm, encodeEucKr, lineFor, siteData, pgUrl, ecut, ebytes, load };
