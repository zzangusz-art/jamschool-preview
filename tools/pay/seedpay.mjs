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
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { clientIp } from '../client-ip.mjs';
import { notifyOrder } from './notify.mjs';
import { applyFulfil, applyClaim, addRefund, refundedOf, stageOf, fulfilNow, customerView, shipSettings, saveShipSettings, saveSettleSettings, settleSettings, settlement, tplItemName, courierName, trackUrl, claimLabel, claimOpen, refundSuggest, FulfilError, COURIERS, CLAIM_TYPE, shipDue, isLate, dueLabel, customerClaim } from './fulfil.mjs';
import { notifyClaim } from './notify.mjs';
import * as MEMBER from '../member/store.mjs';   // 홈페이지 회원·적립금(주문에 회원 표시, 적립금 사용·적립·회수)   // 손님이 직접 한 취소·반품·교환 요청을 텔레그램으로
import { sendSms, msgSettings, saveMsgSettings, smsStatus, orderVars, fill, MSG_EVENTS } from './sms.mjs';   // 손님 안내 문자(솔라피)   // 배송·취소·반품·교환·환불·정산   // 결제 완료·확인 필요 주문 텔레그램 알림(기다리지 않음, 실패는 로그만)

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
// 바로 열기는 휴대폰에서만: PC 화면 위 결제창 안에서는 카카오페이 인증 화면이 뜨지 않았다(2026-11-11 운영 확인).
// PC 는 씨드 기본 결제창(신용/체크카드·카카오페이·N Pay 탭)을 열어 손님이 고른다. 판단 기준은 pgAsistant.js checkPlatform 과 같게
function isMobileUA(ua) {
  ua = String(ua || '').toLowerCase();
  // 문자열 위치가 아니라 이 순서대로 먼저 맞는 것(안드로이드 UA 의 'linux' 보다 'android' 가 앞선다)
  const m = ['ipad', 'ipod', 'windows phone', 'iphone', 'kindle', 'silk', 'android', 'win', 'mac', 'linux', 'cros', 'playbook', 'bb', 'blackberry'].find(k => ua.includes(k)) || '';
  return ['android', 'bb', 'blackberry', 'ipad', 'iphone', 'ipod', 'kindle', 'playbook', 'silk', 'windows phone'].includes(m);
}
const TIMEOUT = 30000;
// 한국 중계 서버(tools/pay/relay/seed-relay.py): 씨드 승인 서버가 해외 IP(Railway 미국)를 403 으로 막아서
// 승인·망취소·취소 요청만 한국 IP 서버를 거쳐 보낸다. URL·KEY 둘이 있으면 켜짐:
//   SEEDPAY_RELAY_URL · SEEDPAY_RELAY_KEY(중계 쪽 키 원문)
//   · SEEDPAY_RELAY_CA(자체 서명 서버일 때만 — 그 인증서 base64 또는 PEM. AWS Lambda 함수 URL(tools/pay/relay/lambda)은 정식 인증서라 비움)
const RELAY = () => (process.env.SEEDPAY_RELAY_URL || '').trim().replace(/\/+$/, '');
// 키: SEEDPAY_RELAY_KEY 가 있으면 그 값, 없으면 상점키에서 한 방향으로 만든 값(HMAC — 상점키는 드러나지 않음).
//   중계 쪽에는 이 키의 SHA-256(관리자 결제 화면 '중계 키 해시')만 RELAY_KEY_SHA256 으로 넣는다 → 비밀값을 옮겨 적을 일이 없다.
const RELAY_KEY = () => { const v = (process.env.SEEDPAY_RELAY_KEY || '').trim(); if (v) return v; const mk = KEY(); return mk ? crypto.createHmac('sha256', mk).update('jamschool-seed-relay/v1').digest('hex') : ''; };
export const relayKeyHash = () => { const k = RELAY_KEY(); return k ? crypto.createHash('sha256').update(k, 'utf8').digest('hex') : ''; };
const RELAY_CA = () => { const v = (process.env.SEEDPAY_RELAY_CA || '').trim(); if (!v) return undefined; return v.includes('BEGIN CERTIFICATE') ? v.replace(/\\n/g, '\n') : Buffer.from(v, 'base64').toString('utf8'); };
const relayOn = () => !!(RELAY() && RELAY_KEY());
// 중계 서버 요청: 인증서는 SEEDPAY_RELAY_CA 로 고정(그 인증서로 서명된 서버만 믿는다)
function relayCall(method, pathname, body, timeout = TIMEOUT) {
  return new Promise((resolve, reject) => {
    // 주소 뒤 ?쿼리는 유지(Supabase: ?forceFunctionRegion=ap-northeast-2 → 같은 값을 x-region 헤더로도)
    let u; try { const b = new URL(RELAY()); u = new URL(b.origin + b.pathname.replace(/\/+$/, '') + pathname + b.search); } catch { reject(Object.assign(new Error('중계 주소 형식 오류'), { kind: 'network' })); return; }
    const headers = { 'X-Relay-Key': RELAY_KEY(), 'User-Agent': 'jamschool-pay' };
    const region = u.searchParams.get('forceFunctionRegion'); if (region) headers['x-region'] = region;
    if (body != null) Object.assign(headers, { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    const rq = https.request(u, { method, headers, ca: RELAY_CA(), timeout }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, upstream: res.headers['x-upstream-status'] ? +res.headers['x-upstream-status'] : null, text: Buffer.concat(chunks).toString('utf8') }));
    });
    rq.on('timeout', () => rq.destroy(Object.assign(new Error('응답 시간 초과'), { name: 'TimeoutError' })));
    rq.on('error', e => reject(Object.assign(new Error(`중계 서버 통신 실패: ${e.name === 'TimeoutError' ? '응답 시간 초과' : e.code || e.message}`), { kind: 'network' })));
    if (body != null) rq.write(body);
    rq.end();
  });
}
// 중계 서버 상태(결제창 열기 전에 확인, 정상 60초·실패 20초 기억)
let relayHealthCache = { at: 0, ok: false, data: null };
export async function relayHealth(force) {
  if (!relayOn()) return { on: false };
  const c = relayHealthCache;
  if (!force && c.data && Date.now() - c.at < (c.ok ? 60e3 : 20e3)) return c.data;
  let data;
  try {
    const r = await relayCall('GET', '/health', null, 8000);
    let j = {}; try { j = JSON.parse(r.text); } catch { /* 아래 */ }
    data = { on: true, ok: r.status === 200 && !!j.ok, status: r.status, seed: j.seed || null, db: j.db || null, region: j.region || '', uptime: j.uptime ?? null, stats: j.stats || null, error: r.status === 403 ? '중계 키(SEEDPAY_RELAY_KEY)가 맞지 않음' : r.status !== 200 ? `HTTP ${r.status}` : !j.ok ? `씨드 응답 ${j.seed && (j.seed.status || j.seed.error)}` : '' };
  } catch (e) { data = { on: true, ok: false, error: e.message }; }
  relayHealthCache = { at: Date.now(), ok: data.ok, data };
  return data;
}

// 중계 상태를 6시간마다 확인(Supabase 무료 프로젝트는 일주일 DB 무사용이면 정지 — 중계의 상태 확인이 DB 를 한 번 쓴다).
// 결제가 없는 날에도 돈다. 서버가 뜬 1분 뒤 한 번, 그 뒤 6시간마다. 실패해도 결제 흐름에는 영향 없음(결제창 열 때 다시 확인).
{ const tick = () => { if (relayOn()) relayHealth(true).then(d => { if (!d.ok || (d.db && !d.db.ok)) log('relay', `중계 상태 이상: ${d.error || ''} db=${JSON.stringify(d.db)}`); }).catch(() => {}); };
  const t1 = setTimeout(tick, 60e3), t2 = setInterval(tick, 6 * 3600e3); t1.unref?.(); t2.unref?.(); }

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
  const q = toInt(qty);
  if (!(q >= 1 && q <= 99)) throw new PayError(400, '수량을 확인해 주세요');
  const k = String(key || '');
  // 옵션 상품: key = 상품번호-값-값…(data.js JAM.OPT 와 같은 규칙, 가격은 옵션 조합 가격표)
  const m = k.match(/^(\d+)-(.+)$/);
  if (m) {
    const p = J.PRODUCTS.find(x => x.id === +m[1]), x = p && J.OPT.parse(p, k);
    if (!x) throw new PayError(400, '주문할 수 없는 옵션이 있습니다');
    if (x.off) throw new PayError(400, '품절된 옵션이 있습니다');
    return { key: x.key, id: p.id, name: p.name, gname: gname(p), opt: x.label, qty: q, price: x.price, img: x.img, cat: p.cat };
  }
  const p = /^\d+$/.test(k) && J.PRODUCTS.find(x => x.id === +k);
  if (!p || J.OPT.of(p) || !(p.price > 0)) throw new PayError(400, '주문할 수 없는 상품이 있습니다');
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
// 손님 안내 문자(tools/pay/sms.mjs): 어드민에서 켜 둔 단계만, 기다리지 않는다. 결과는 주문 처리 기록에(번호·문구는 남기지 않음)
const holidays = () => settleSettings(DIR()).holidays;
const wonK = n => `${(Math.round(+n || 0)).toLocaleString('ko-KR')}원`;
function tell(o, ev, extra = {}) {
  try {
    const m = msgSettings(DIR())[ev];
    if (!m || !m.on || !o.buyer || !o.buyer.tel) return null;
    const p = sendSms(o.buyer.tel, fill(m.text, orderVars(o, extra))).then(r => {
      if (r.skipped) return r;
      const x = load(o.moid); if (x) { hist(x, '손님 문자', `${MSG_EVENTS[ev].label} ${r.ok ? `보냄(${r.type})` : `실패 — ${r.error}`}`); save(x); }
      return r;
    }).catch(e => ({ ok: false, error: e.message }));
    TELL.add(p); p.finally(() => TELL.delete(p));
    return p;
  } catch (e) { log('문자 준비 실패', o && o.moid, e.message); return null; }
}
const TELL = new Set();
export const tellSettled = () => Promise.allSettled([...TELL]);   // 시험용
const shipVars = f => ({ 택배사: courierName(f.courier), 송장번호: f.invoice || '', 배송조회: trackUrl(f.courier, f.invoice) });
// 배송 단계를 바꾼 뒤: 송장이 새로 들어가면 발송 안내, 배송 완료로 바뀌면 배송 완료 안내(기본 꺼짐)
function afterFulfil(o, before) {
  const f = o.fulfil || {};
  if (f.status === 'shipped' && f.invoice && (before.status !== 'shipped' || before.invoice !== f.invoice)) tell(o, 'shipped', shipVars(f));
  if (f.status === 'delivered' && before.status !== 'delivered') tell(o, 'delivered');
}
function settings() { try { return { enabled: false, ...JSON.parse(fs.readFileSync(path.join(DIR(), 'settings.json'), 'utf8')) }; } catch { return { enabled: false }; } }
const newId = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return 'JS' + kstStamp() + Array.from(crypto.randomBytes(6), b => A[b % A.length]).join(''); };

// ───────── 씨드페이먼츠 서버 요청(UTF-8 form, 응답 JSON)
async function postPg(url, params) {
  if (relayOn()) {   // 한국 중계 서버 경유 — 주소는 우리가 아는 세 가지(approval·netCancel·cancel)만
    const op = (String(url).match(/\/payment\/v1\/(approval|netCancel|cancel)$/) || [])[1];
    if (!op) throw Object.assign(new Error('알 수 없는 결제 요청'), { kind: 'http' });
    const r = await relayCall('POST', `/seed/${TEST() ? 'test/' : ''}${op}`, new URLSearchParams(params).toString());
    if (r.status === 502) throw Object.assign(new Error('중계 서버 → 씨드 통신 실패'), { kind: 'network' });
    if (r.upstream == null) throw Object.assign(new Error(`중계 서버 HTTP ${r.status}`), { kind: r.status === 403 ? 'http' : 'network' });
    if (r.status !== 200) throw Object.assign(new Error(`HTTP ${r.status}(중계)`), { kind: 'http' });
    try { const j = JSON.parse(r.text.trim()); if (j && typeof j === 'object') return j; } catch { /* 아래 */ }
    throw Object.assign(new Error('응답 형식 오류'), { kind: 'parse' });
  }
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
  // 중계 서버가 꺼졌거나 씨드가 막고 있으면 결제창을 열지 않는다(카드 인증 뒤 승인 실패로 손님이 기다리게 되는 일 방지)
  if (relayOn() && !(await relayHealth()).ok) { log('ready', '중계 서버 이상 — 결제창 열지 않음'); throw new PayError(503, '지금은 홈페이지 결제를 쓸 수 없습니다. 잠시 뒤 다시 시도하거나 고객센터로 연락해 주세요.'); }
  let d; try { d = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8')); } catch (e) { throw e instanceof PayError ? e : new PayError(400, '요청 형식 오류'); }
  const J = siteData();
  const m = pgMethods().find(x => x.id === d.method);
  if (!m) throw new PayError(400, '결제 수단을 다시 골라 주세요.');
  if (!Array.isArray(d.items) || !d.items.length || d.items.length > 20) throw new PayError(400, '주문 상품을 확인해 주세요.');
  const items = d.items.map(x => lineFor(J, x && x.key, x && x.qty));
  const sub = items.reduce((a, x) => a + x.price * x.qty, 0), ship = toInt(J.CHECKOUT.shipFee) > 0 ? toInt(J.CHECKOUT.shipFee) : 0, total = sub + ship;
  if (!(total > 0 && total <= 99999999)) throw new PayError(400, '결제 금액을 확인해 주세요.');
  const b = d.buyer || {}, r = d.receiver || {};
  const name = clean(b.name).slice(0, 20), tel = digits(b.tel), mail = String(b.email || '').trim().slice(0, 60);
  const rname = clean(r.name).slice(0, 20), rtel = digits(r.tel), zip = digits(r.zip), a1 = String(r.addr1 || '').trim().slice(0, 200), a2 = String(r.addr2 || '').trim().slice(0, 100);
  const tel_ok = t => /^01[016789]\d{7,8}$/.test(t);
  if (name.length < 2 || !tel_ok(tel) || rname.length < 2 || !tel_ok(rtel) || zip.length !== 5 || !a1 || !a2) throw new PayError(400, '주문자·배송지 정보를 확인해 주세요.');
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) throw new PayError(400, '이메일 주소 형식을 확인해 주세요.');
  // 회원 주문: 로그인 쿠키로 회원을 알아보고, 쓰려는 적립금은 잡아 둔다(결제 승인 때 차감, 실패하면 풀어 줌). 결제창 금액 = 주문 금액 - 적립금
  const moid = newId(), mem = MEMBER.fromReq(req), wantPts = Math.max(0, toInt(d.points) || 0);
  if (wantPts > 0 && !mem) throw new PayError(401, '로그인이 풀렸습니다. 다시 로그인한 뒤 적립금을 써 주세요.');
  let used = 0;
  if (mem && wantPts > 0) { try { used = MEMBER.hold(mem.id, moid, wantPts, total); } catch (e) { throw new PayError(e.status || 400, e.message); } }
  const amount = total - used, pc = MEMBER.pointCfg();
  const o = {
    moid, token: crypto.randomBytes(24).toString('base64url'), status: 'ready', method: m.id, payMethod: METHOD[m.id], payLabel: m.label,
    amount, total, pointsUsed: used, sub, ship, items, buyNow: !!d.buyNow, createdAt: nowIso(), pgEnv: TEST() ? 'test' : 'real',
    ...(mem ? { member: { id: mem.id, login: mem.login }, pointRate: pc.on ? pc.rate : 0 } : {}),
    buyer: { name, tel, email: mail }, receiver: { name: rname, tel: rtel, zip, addr1: a1, addr2: a2, memo: String(r.memo || '').trim().slice(0, 100), jeju: !!r.jeju || /^63/.test(zip) },
    fulfil: { status: 'new' }, history: [], device: isMobileUA(req.headers['user-agent']) ? '휴대폰' : 'PC',
  };
  hist(o, 'ready', `${m.label} ${amount}원${used ? ` (주문 ${total}원 - 적립금 ${used}원)` : ''}${mem ? ` · 회원 ${mem.login}` : ''}`); save(o);
  if (mem) MEMBER.addOrder(mem.id, moid);
  const first = clean(items.length > 1 ? items[0].gname : items[0].name), more = items.length > 1 ? ` 외 ${items.length - 1}건` : '';
  const edi = kstStamp(), amt = String(amount), u = URLS();
  log('ready', o.moid, amt, m.id, TEST() ? 'test' : '');
  return {
    moid: o.moid, script: u.script, mode: TEST() ? 'TEST' : 'REAL', base: BASE(), returnUrl: `${origin(req)}/api/pay/return`,
    fields: {
      method: o.payMethod, mid: MID(), trxCd: '0', goodsNm: first.slice(0, 40 - more.length) + more, ordNo: o.moid, goodsAmt: amt,
      ordNm: name.slice(0, 30), ordTel: tel, ordEmail: mail, ...(ip && ip.length <= 20 ? { ordIp: ip } : {}),
      mbsReserved: o.moid, returnUrl: `${origin(req)}/api/pay/return`, ediDate: edi, hashString: sha256(MID() + edi + amt + KEY()),
      ...(isMobileUA(req.headers['user-agent']) ? DIRECT[m.id] || {} : {}),
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
      // stage: approval = 카드 인증까지 마친 뒤 승인 단계에서 안 됨, auth = 결제창에서 취소·인증 실패·확인 실패(승인 요청 전)
      o.status = status; o.fail = { msg: String(msg || '').slice(0, 300), stage: o.pg && o.pg.tid ? 'approval' : 'auth' }; hist(o, status, msg);
      if (status === 'failed' && o.member && o.pointsUsed) try { MEMBER.release(o.member.id, o.moid); } catch { /* 3시간 뒤 저절로 풀림 */ }
      if (status === 'check') notifyOrder(o, 'check', o.fail.msg);   // 돈이 빠져나갔을 수 있는 주문 — 저장이 실패해도 알리도록 저장보다 먼저
      save(o); log(status, o.moid, msg); return done;
    };
    if (str(data.resultCd) !== '0000') { hist(o, '씨드 인증 응답', seedReply({ resultCd: data.resultCd, resultMsg: data.resultMsg, method: data.method, ediDate: data.ediDate })); return fail('failed', str(data.resultMsg) || '결제를 취소했거나 인증에 실패했습니다'); }
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
    if (str(r.resultCd) !== '0000') {
      // 씨드 응답을 처리 기록에 남긴다(카드 번호·암호화 값 제외) — '미지정 오류(9999)'처럼 짧은 문구만 올 때 원인을 찾기 위해
      hist(o, '씨드 승인 응답', seedReply(r));
      const out = fail('failed', `${str(r.resultMsg) || '승인 거절'} (${str(r.resultCd) || '코드 없음'})${str(r.resultCd) === '9999' ? ' — 카드사 승인이 되지 않았습니다. 다른 카드나 네이버페이·카카오페이로 다시 시도해 주세요' : ''}`);
      notifyOrder(o, 'failed', o.fail.msg);   // 손님이 카드 인증까지 했는데 승인이 안 된 주문 — 관리자가 바로 알고 연락할 수 있게
      return out;
    }
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
    memberPaid(o);
    notifyOrder(o, 'paid');
    tell(o, 'paid', { 출고예정: dueLabel(shipDue(o, shipSettings(DIR()), holidays())) });
    return done;
  } finally { BUSY.delete(o.moid); }
}

// 씨드 응답 요약(처리 기록용): 카드 번호·암호화 값·서명은 빼고 짧게
const seedReply = r => Object.entries(r || {}).filter(([k]) => !/card(No|Num)|payData|nonce|sign|hash|key/i.test(k)).map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join(' · ').slice(0, 290);

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
    // 가맹점 관리자에서 한 취소·망취소(부분 포함)를 환불 기록에 더한다. 어드민에서 한 취소는 같은 취소 거래번호가 이미 있어 건너뛴다
    const full = str(d.partCanFlg) !== '1';
    if (o.pg && o.pg.tid && otid === o.pg.tid && o.status !== 'cancelled' && !(o.refunds || []).some(r => r.tid && r.tid === tid)) {
      const amt = full ? o.amount - refundedOf(o) : toInt(d.ccAmt);
      if (amt > 0) { addRefund(o, { amount: amt, part: !full, reason: st === '9' ? '망취소(결제통보)' : '가맹점 관리자 취소(결제통보)', by: 'seed', via: 'seed', tid, ccSeq: str(d.ccSeq) }); memberRefunded(o, amt); if (st !== '9') tell(o, 'refunded', { 환불금액: wonK(amt) }); }
    }
    hist(o, '결제통보 · 취소', `${toInt(d.ccAmt) >= 0 ? toInt(d.ccAmt) + '원' : ''} ${full ? '전체' : '부분'} 취소 · ${tid}`); save(o); return 200;
  }
  // 승인 통보: 승인 응답을 놓쳐 '승인 중'·'확인 필요'로 남은 주문만 결제 완료로 맞춘다(금액·거래번호가 같을 때)
  if (['approving', 'check'].includes(o.status) && o.pg && o.pg.tid === tid && toInt(d.goodsAmt) === o.amount) {
    o.status = 'paid'; o.paidAt = nowIso(); o.fail = undefined;
    o.pg = { ...o.pg, authCode: str(d.appNo), authDate: `${str(d.trDt)}${str(d.trTm)}`, cardName: str(d.fnNm), cardNo: str(d.cardNo), cardQuota: str(d.quotaMon) };
    hist(o, '결제통보 · 결제 완료로 맞춤', `${o.amount}원 승인 ${o.pg.authCode}`); save(o);
    memberPaid(o);
    notifyOrder(o, 'paid');
    tell(o, 'paid', { 출고예정: dueLabel(shipDue(o, shipSettings(DIR()), holidays())) });
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

// ───────── 회원 주문과 적립금
// 결제 완료 → 잡아 둔 적립금 차감
function memberPaid(o) { if (o.member && o.pointsUsed) try { MEMBER.useHold(o.member.id, o.moid, o.pointsUsed); } catch (e) { log('적립금 차감 실패', o.moid, e.message); } }
// 환불 뒤: 전부 취소면 쓴 적립금을 돌려주고, 이미 적립했으면 환불 금액 × 적립률만큼 회수(부분 환불은 쓴 적립금을 돌려주지 않음)
function memberRefunded(o, amount) {
  if (!o.member) return;
  try {
    if (o.status === 'cancelled' && o.pointsUsed) { const n = MEMBER.restoreUse(o.member.id, o.moid, '주문 취소로 돌려줌'); if (n) hist(o, '적립금', `사용한 ${n}원 돌려줌`); }
    if (o.pointRate) { const n = MEMBER.revoke(o.member.id, o.moid, Math.floor(amount * o.pointRate / 100), '환불로 적립 회수'); if (n) hist(o, '적립금', `적립 ${n}원 회수`); }
  } catch (e) { log('적립금 환불 처리 실패', o.moid, e.message); }
}
// 적립: 배송 완료 뒤 정한 날 수(기본 7일 = 반품 기간)가 지나고 진행 중인 취소·반품·교환이 없으면 (결제 금액 - 환불) × 주문 때 적립률. 주문마다 한 번
export function earnSweep(memberId) {
  const cfg = shipSettings(DIR()), pc = MEMBER.pointCfg(), now = Date.now(); let n = 0;
  for (const id of memberId ? [memberId] : MEMBER.allIds()) {
    const m = MEMBER.get(id); if (!m || m.status !== 'active') continue;
    for (const moid of m.orders || []) {
      if ((m.earned || {})[moid] != null) continue;
      const o = load(moid); if (!o || o.status !== 'paid' || !o.pointRate || !o.member || o.member.id !== id) continue;
      const f = fulfilNow(o, cfg); if (f.status !== 'delivered' || !f.deliveredAt || now < Date.parse(f.deliveredAt) + pc.earnDays * 864e5) continue;
      if (o.claim && claimOpen(o.claim)) continue;
      const amt = Math.floor((o.amount - refundedOf(o)) * o.pointRate / 100);
      if (amt > 0 && MEMBER.earn(id, moid, amt)) { hist(o, '적립금', `구매 적립 ${amt}원`); save(o); n++; }
    }
  }
  return n;
}
// 마이페이지 주문 내역(결제 완료·취소·확인 필요만). t = 주문 조회 키(본인에게만 보냄)
export function memberOrders(memberId) {
  const m = MEMBER.get(memberId); if (!m) return [];
  const cfg = { ...shipSettings(DIR()), holidays: holidays() };
  return (m.orders || []).map(load).filter(o => o && o.member && o.member.id === memberId && ['paid', 'cancelled', 'check'].includes(o.status)).map(o => {
    const v = ['paid', 'cancelled'].includes(o.status) ? customerView(o, cfg) : null, earned = (m.earned || {})[o.moid], refunded = refundedOf(o);
    return { no: o.moid, t: o.token, at: o.paidAt || o.createdAt, status: o.status, stage: v ? v.stage : LABEL[o.status], total: o.total || o.amount, amount: o.amount, points: o.pointsUsed || 0, refunded,
      items: o.items.map(({ id, name, opt, qty, img }) => ({ id, name, opt, qty, img })), earned: earned || 0,
      earnPlan: earned == null && o.status === 'paid' && o.pointRate ? Math.floor((o.amount - refunded) * o.pointRate / 100) : 0,
      canReview: o.status === 'paid' && ['shipped', 'delivered'].includes(fulfilNow(o, cfg).status) };
  });
}

// 주문 조회 횟수 제한(IP 마다 10분에 10번)
const LOOK = new Map();
function lookLimited(ip) { const now = Date.now(), a = (LOOK.get(ip) || []).filter(t => now - t < 600e3); a.push(now); LOOK.set(ip, a); if (LOOK.size > 5000) LOOK.clear(); return a.length > 10; }

// ───────── 4) 주문 완료 화면용(가린 요약)
const mask = s => { s = String(s || ''); return s.length <= 1 ? s : s.length === 2 ? s[0] + '*' : s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]; };
function publicView(o) {
  const QUOTA = q => !q || +q === 0 ? '일시불' : `${+q}개월`;
  return {
    no: o.moid, status: o.status, mode: 'pg', pay: o.method,
    canReview: o.status === 'paid' && ['shipped', 'delivered'].includes(fulfilNow(o, shipSettings(DIR())).status),   // 보낸 뒤부터 구매평(반품·교환 요청 중이어도)
    payLabel: o.status === 'paid' && o.pg && o.pg.cardName ? `${o.payLabel} (${o.pg.cardName} · ${QUOTA(o.pg.cardQuota)})` : o.payLabel,
    total: o.amount, orderTotal: o.total || o.amount, points: o.pointsUsed || 0, member: !!o.member, sub: o.sub, ship: o.ship, items: o.items.map(({ id, name, opt, qty, price, img, cat }) => ({ id, name, opt, qty, price, img, cat })),
    name: mask(o.receiver.name), tel: `${o.receiver.tel.slice(0, 3)}-****-${o.receiver.tel.slice(-4)}`, addr: `(${o.receiver.zip}) ${o.receiver.addr1} · 상세 주소 생략`,
    memo: o.receiver.memo, jeju: o.receiver.jeju, buyNow: o.buyNow, ship: ['paid', 'cancelled'].includes(o.status) ? customerView(o, { ...shipSettings(DIR()), holidays: holidays() }) : null, fail: o.status === 'paid' ? '' : (o.fail && o.fail.msg) || '',
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
    // 주문 조회(주문 완료 화면 주소를 잃어버린 손님): 주문번호 + 주문하신 분·받는 분 휴대폰 번호가 맞으면 조회 주소(토큰)를 돌려준다
    if (p === '/api/pay/lookup' && req.method === 'POST') {
      if (lookLimited(clientIp(req))) { json(res, 429, { error: '조회를 너무 많이 했습니다. 10분 뒤 다시 시도해 주세요.' }); return true; }
      let d; try { d = JSON.parse((await readBody(req, 2048)).toString('utf8')); } catch { d = {}; }
      const id = str(d.no).toUpperCase().replace(/\s/g, ''), tel = digits(d.tel), o = /^JS[0-9A-Z]{10,30}$/.test(id) ? load(id) : null;
      const telOk = o && tel.length >= 10 && [o.buyer && o.buyer.tel, o.receiver && o.receiver.tel].includes(tel);
      if (!telOk || ['ready', 'failed'].includes(o.status)) { json(res, 404, { error: '주문번호와 휴대폰 번호가 맞는 주문이 없습니다. 다시 확인해 주세요.' }); return true; }
      json(res, 200, { o: o.moid, t: o.token }); return true;
    }
    // 손님 취소·반품·교환 요청(주문 조회 화면): 조회 주소의 토큰이 맞아야 한다. 관리자에게 텔레그램, 손님에게 접수 문자
    if (p === '/api/pay/claim' && req.method === 'POST') {
      if (lookLimited(clientIp(req))) { json(res, 429, { error: '요청을 너무 많이 했습니다. 10분 뒤 다시 시도해 주세요.' }); return true; }
      let d; try { d = JSON.parse((await readBody(req, 4096)).toString('utf8')); } catch { d = {}; }
      const o = load(str(d.o));
      if (!o || !same(d.t, o.token)) { json(res, 404, { error: '주문 정보를 찾을 수 없습니다' }); return true; }
      if (BUSY.has(o.moid)) { json(res, 409, { error: '처리 중인 주문입니다. 잠시 뒤 다시 시도해 주세요.' }); return true; }
      try { hist(o, '클레임', customerClaim(o, d, shipSettings(DIR()))); }
      catch (e) { if (e instanceof FulfilError) { json(res, 400, { error: e.message }); return true; } throw e; }
      save(o); log('claim', o.moid, o.claim.type);
      notifyClaim(o, CLAIM_TYPE[o.claim.type], o.claim.reason);
      tell(o, 'claim', { 요청: CLAIM_TYPE[o.claim.type] });
      json(res, 200, publicView(o)); return true;
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
// 결제 서버 연결 점검(관리자 어드민) — 이 서버가 밖으로 나가는 IP·나라와, 씨드 승인 주소가 이 서버의 요청을 받는지.
//   승인 주소에는 씨드 공개 예시 상점(demotest0m)·가짜 값만 보낸다(실제 상점·거래와 무관). 정상이면 200 + resultCd 9999(FAIL), 막히면 403
export async function pgProbe() {
  const get = async (url, opt = {}) => {
    try { const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000), ...opt }); const t = await r.text().catch(() => ''); return { status: r.status, server: r.headers.get('server') || '', text: t, body: t.replace(/\s+/g, ' ').slice(0, 160) }; }
    catch (e) { return { status: 0, error: e.name === 'TimeoutError' ? '응답 시간 초과' : e.message }; }
  };
  const ipr = await get('https://api.ipify.org?format=json');
  let ip = ''; try { ip = JSON.parse(ipr.text).ip || ''; } catch { /* 없음 */ }
  let geo = {}; if (ip) { const g = await get(`https://ipinfo.io/${ip}/json`); try { const j = JSON.parse(g.text); geo = { country: j.country || '', city: j.city || '', org: j.org || '' }; } catch { /* 없음 */ } }
  const u = URLS();
  const body = new URLSearchParams({ nonce: 'probe', tid: 'demotest0m01012611180000000000', ediDate: kstStamp(), mid: 'demotest0m', goodsAmt: '1000', mbsReserved: '', hashString: '0'.repeat(64), payData: 'probe' }).toString();
  const approval = await get(u.approval, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' }, body });
  const script = await get(u.script);
  const blocked = approval.status === 403;
  const relay = await relayHealth(true);
  if (relay.on) {   // 중계 서버를 쓰는 중이면 판정은 중계 서버 기준(이 서버의 직접 요청은 막혀도 상관없음)
    const v = relay.ok ? 'ok' : relay.seed && relay.seed.status === 403 ? 'blocked' : 'error';
    return { at: new Date().toISOString(), ip, ...geo, region: process.env.RAILWAY_REPLICA_REGION || '', via: 'relay', relayUrl: RELAY().replace(/^(https:\/\/[^/:]+).*/, '$1'), relayKeyHash: relayKeyHash(), relay,
      direct: { status: approval.status }, approval: relay.seed ? { status: relay.seed.status || 0, server: '', body: relay.seed.body || '', error: relay.seed.error || relay.error || '' } : { status: 0, error: relay.error || '' },
      script: { status: script.status, error: script.error || '' }, verdict: v };
  }
  return { at: new Date().toISOString(), ip, ...geo, region: process.env.RAILWAY_REPLICA_REGION || '', via: 'direct', approvalUrl: u.approval, approval: { status: approval.status, server: approval.server || '', body: approval.body || '', error: approval.error || '' }, script: { status: script.status, error: script.error || '' },
    verdict: approval.status === 200 ? 'ok' : blocked ? 'blocked' : 'error' };
}
export function adminStatus() {
  const k = KEY(), host = (process.env.CANONICAL_HOST || 'jamschool.kr').trim();
  return { keySet: !!k, mid: MID(), enabled: settings().enabled, dataDir: !!process.env.DATA_DIR, methods: k ? pgMethods() : [], test: TEST(), notiUrl: `https://${host}/api/pay/noti`, relay: { on: relayOn(), url: RELAY().replace(/^(https:\/\/[^/:]+).*/, '$1'), keyHash: relayKeyHash() } };
}
// 주문 날짜(한국 시각): from·to = YYYY-MM-DD(주문 일시 기준, 둘 다 포함)
const kday = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const ktime = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(11, 16);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const allOrders = () => { let names = []; try { names = fs.readdirSync(DIR()).filter(f => /^JS\w+\.json$/.test(f)); } catch { names = []; } return names.map(f => load(f.slice(0, -5))).filter(Boolean); };
// 결제창만 열고 1시간이 지나도록 결과가 없는 주문(창을 닫음·인증 중단) — 목록에서는 '결제 중단'
const abandoned = o => o.status === 'ready' && Date.now() - Date.parse(o.createdAt) > 3600e3;
const failStage = o => o.status === 'failed' ? ((o.fail && o.fail.stage) || (o.pg && o.pg.tid ? 'approval' : 'auth')) : abandoned(o) ? 'abandon' : '';
export function listOrders({ all = false, from = '', to = '' } = {}) {
  const cfg = shipSettings(DIR()), hol = holidays();
  return allOrders()
    .filter(o => all || ['paid', 'check', 'cancelled', 'approving', 'failed'].includes(o.status) || abandoned(o))
    .filter(o => (!isDay(from) || kday(o.createdAt) >= from) && (!isDay(to) || kday(o.createdAt) <= to))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 1000)
    .map(o => {
      const f = fulfilNow(o, cfg), st = stageOf(o, cfg), c = o.claim;
      return { moid: o.moid, createdAt: o.createdAt, day: kday(o.createdAt), time: ktime(o.createdAt), paidAt: o.paidAt || '', status: o.status, statusName: abandoned(o) ? '결제 중단' : LABEL[o.status] || o.status, amount: o.amount, payLabel: o.payLabel,
        failStage: failStage(o), buyer: o.buyer ? o.buyer.name : '', member: o.member ? o.member.login || '' : '', lines: o.items.map(x => ({ id: String(x.id), qty: x.qty })),
        items: o.items.map(x => `${x.name}${x.opt ? ` (${x.opt})` : ''} × ${x.qty}`), qty: o.items.reduce((a, x) => a + x.qty, 0), receiver: o.receiver.name, tel: o.receiver.tel, zip: o.receiver.zip,
        addr: `${o.receiver.addr1} ${o.receiver.addr2}`.trim(), memo: o.receiver.memo || '', jeju: !!o.receiver.jeju, fail: (o.fail || {}).msg || (abandoned(o) ? '결제창에서 결제를 끝내지 않았습니다(창을 닫았거나 인증을 중단함)' : ''),
        fulfil: f.status, shippedAt: f.shippedAt || '', courier: f.invoice ? courierName(f.courier) : '', invoice: f.invoice || '', track: f.invoice ? trackUrl(f.courier, f.invoice) : '',
        stage: st.key, stageName: st.label, stageTone: st.tone, refunded: refundedOf(o), memo2: o.adminMemo || '',
        due: o.paidAt ? shipDue(o, cfg, hol) : '', late: isLate(o, cfg, hol),
        claim: c ? { type: c.type, status: c.status, open: claimOpen(c), label: claimLabel(c), byCustomer: c.by === 'customer' } : null };
    });
}
// 날짜와 상관없이 결제 완료·발송 전(신규·상품 준비 중, 취소 요청 아님) 주문 수(목록 위 안내)
export const todoCount = () => { const cfg = shipSettings(DIR()); return allOrders().filter(o => o.status === 'paid' && ['new', 'prep'].includes(fulfilNow(o, cfg).status) && !claimOpen(o.claim)).length; };
// 어드민 홈 '처리할 일': 날짜와 상관없이 지금 손이 가야 하는 주문 수
export function taskCounts() {
  const cfg = shipSettings(DIR()), hol = holidays(), t = { new: 0, prep: 0, late: 0, claim: 0, claimCustomer: 0, check: 0, failed: 0 }, day = Date.now() - 864e5;
  for (const o of allOrders()) {
    if (o.status === 'check') t.check++;
    if (failStage(o) === 'approval' && Date.parse(o.createdAt) > day) t.failed++;   // 최근 24시간 카드 승인 안 된 결제(손님에게 연락할 수 있게)
    if (o.status !== 'paid') continue;
    if (claimOpen(o.claim)) { t.claim++; if (o.claim.by === 'customer' && o.claim.status === 'requested') t.claimCustomer++; continue; }
    const f = fulfilNow(o, cfg).status;
    if (f === 'new') t.new++; else if (f === 'prep') t.prep++;
    if (isLate(o, cfg, hol)) t.late++;
  }
  return t;
}
// 구매평 쓰기용 구매 확인(tools/reviews/api.mjs): 조회 주소(o·t) 또는 주문번호+휴대폰. 보낸 뒤(배송 중·배송 완료)부터 쓸 수 있다
export function reviewOrder({ o, t, no, tel } = {}) {
  let x = null;
  if (o && t) { x = load(str(o)); if (!x || !same(t, x.token)) return null; }
  else {
    const id = str(no).toUpperCase().replace(/\s/g, ''), d = digits(tel);
    x = /^JS[0-9A-Z]{10,30}$/.test(id) ? load(id) : null;
    if (!x || d.length < 10 || ![x.buyer && x.buyer.tel, x.receiver && x.receiver.tel].includes(d)) return null;
  }
  if (!['paid', 'cancelled'].includes(x.status)) return null;
  const f = fulfilNow(x, shipSettings(DIR()));
  return { moid: x.moid, token: x.token, buyerName: x.buyer ? x.buyer.name : '', items: x.items.map(i => ({ id: i.id, name: i.name, opt: i.opt || '' })), can: x.status === 'paid' && ['shipped', 'delivered'].includes(f.status) };
}
// 관리자 메모(주문마다 하나, 손님에게는 안 보임)
export function setMemo(id, memo, user) {
  const o = load(id); if (!o) throw new PayError(404, '주문을 찾을 수 없습니다');
  o.adminMemo = String(memo || '').normalize('NFC').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500); hist(o, '관리자 메모', `${o.adminMemo ? '고침' : '지움'} — ${user.name}(${user.id})`); save(o);
  return getOrderAdmin(id);
}
// 손님 안내 문자 설정·상태·시험 발송
export const msgCfg = () => ({ events: msgSettings(DIR()), status: smsStatus() });
export const saveMsg = (d, user) => ({ events: saveMsgSettings(DIR(), d, user), status: smsStatus() });
export async function smsTest(to, ev, user) {
  const m = msgSettings(DIR())[ev] || msgSettings(DIR()).shipped;
  const sample = { moid: 'JS20261119123000SAMPLE', token: 'sample', amount: 239000, buyer: { name: user.name || '홍길동' }, items: [{ name: '3단 접이식 매트리스', gname: '잠스쿨 3단 접이식 매트리스' }] };
  const text = fill(m.text, orderVars(sample, { 출고예정: '오늘 출고 예정', 택배사: '로젠택배', 송장번호: '12345678901', 배송조회: trackUrl('logen', '12345678901'), 요청: '반품', 환불금액: '239,000원' }));
  const r = await sendSms(to, `[시험] ${text}`);
  log('sms-test', user.id, r.ok ? 'ok' : r.error);
  return { ...r, text };
}
// 발송용 엑셀·일괄 처리: 고른 주문 중 결제 완료만(고른 순서대로)
const pickPaid = moids => { const ids = [...new Set((Array.isArray(moids) ? moids : []).map(String))].slice(0, 1000); return ids.map(load).filter(o => o && o.status === 'paid').map(o => ({ ...o, statusName: LABEL[o.status] })); };
export function ordersForExport(moids) {
  const list = pickPaid(moids); if (!list.length) throw new PayError(400, '결제 완료된 주문을 골라 주세요');
  return list;
}
// 3PL 발주서 품목명·발송지 등 엑셀에 필요한 값
export const exportCtx = () => ({ J: siteData(), cfg: shipSettings(DIR()), tplName: (x, J, cfg) => tplItemName(x, J, cfg) });
// 고른 주문 배송 단계 한꺼번에: new(신규로) · prep(발주 확인) · shipped(발송 처리, 송장은 그대로) · delivered(배송 완료)
export function shipMany(moids, status, user) {
  const list = pickPaid(moids); if (!list.length) throw new PayError(400, '결제 완료된 주문을 골라 주세요');
  const to = ['new', 'prep', 'shipped', 'delivered'].includes(status) ? status : 'shipped';
  let n = 0; const skipped = [];
  for (const x of list) {
    const o = load(x.moid); if (!o || fulfilNow(o).status === to) continue;
    try { const before = { ...(o.fulfil || {}) }; hist(o, '배송', applyFulfil(o, { status: to }, user)); save(o); afterFulfil(o, before); n++; }
    catch (e) { if (e instanceof FulfilError) skipped.push(`${o.moid} — ${e.message}`); else throw e; }
  }
  log('ship-many', to, n, user.id);
  return { ok: true, changed: n, picked: list.length, skipped };
}
// 송장 일괄 입력: 한 줄에 주문번호와 송장번호(3PL·택배사 엑셀에서 두 열을 복사해 붙여 넣기). 같은 줄에 택배사 이름이 있으면 그 택배사
export function invoiceMany(text, courier, user) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 1000);
  if (!lines.length) throw new PayError(400, '주문번호와 송장번호를 붙여 넣어 주세요');
  if (!COURIERS.some(c => c.code === courier)) throw new PayError(400, '택배사를 골라 주세요');
  const done = [], errors = [];
  for (const ln of lines) {
    const id = ((ln.match(/JS\d{14}[0-9A-Z]{6}/i) || [])[0] || '').toUpperCase(), rest = id ? ln.replace(new RegExp(id, 'i'), ' ') : ln;
    const inv = ((rest.match(/(?:^|\D)(\d{9,15})(?!\d)/) || [])[1]) || ((rest.match(/\d{3,6}-\d{3,6}-\d{3,6}/) || [])[0] || '').replace(/-/g, '');
    const named = COURIERS.find(c => c.code !== 'etc' && rest.includes(c.name.replace(/택배$/, '')));
    if (!id || !inv) { errors.push(`${ln.slice(0, 50)} — 주문번호(JS…)나 송장번호를 찾지 못했습니다`); continue; }
    const o = load(id);
    if (!o) { errors.push(`${id} — 없는 주문입니다`); continue; }
    try { const before = { ...(o.fulfil || {}) }; hist(o, '배송', applyFulfil(o, { status: 'shipped', courier: named ? named.code : courier, invoice: inv, needInvoice: true }, user)); save(o); afterFulfil(o, before); done.push(o.moid); }
    catch (e) { if (e instanceof FulfilError || e instanceof PayError) errors.push(`${id} — ${e.message}`); else throw e; }
  }
  log('invoice-many', done.length, errors.length, user.id);
  return { ok: true, changed: done.length, lines: lines.length, errors };
}
// 시험 기록 정리(총괄 관리자): 주문 파일을 orders/_archive/<시각>/ 로 옮긴다(지우지 않음). 결제 켜기 설정(settings.json)은 그대로.
//   방금 결제창을 연 주문(결제 전, 1시간 안)은 손님이 결제 중일 수 있어 남긴다
export function archiveOrders(user) {
  if (BUSY.size) throw new PayError(409, '승인 처리 중인 결제가 있습니다. 잠시 뒤 다시 해 주세요');
  const d = DIR(), rel = `_archive/${kstStamp()}-${String(user.id || '').replace(/\W/g, '')}`, dest = path.join(d, ...rel.split('/'));
  const recent = Date.now() - 3600e3; let n = 0, kept = 0;
  for (const o of allOrders()) {
    if (o.status === 'ready' && Date.parse(o.createdAt) > recent) { kept++; continue; }
    fs.mkdirSync(dest, { recursive: true }); fs.renameSync(fileOf(o.moid), path.join(dest, `${o.moid}.json`)); n++;
  }
  log('archive', n, kept, user.id);
  return { archived: n, keptReady: kept, keptIn: n ? `orders/${rel}` : '' };
}
export function getOrderAdmin(id) {
  const o = load(id); if (!o) throw new PayError(404, '주문을 찾을 수 없습니다');
  const { token, ...rest } = o, cfg = shipSettings(DIR()), f = fulfilNow(o, cfg), c = o.claim;
  return { ...rest, statusName: LABEL[o.status] || o.status, stage: stageOf(o, cfg), fulfilNow: f, refunded: refundedOf(o), remain: o.amount - refundedOf(o),
    due: o.paidAt ? dueLabel(shipDue(o, cfg, holidays())) : '', late: isLate(o, cfg, holidays()),
    track: f.invoice ? trackUrl(f.courier, f.invoice) : '', courierName: f.invoice ? courierName(f.courier) : '',
    claimView: c ? { ...c, label: claimLabel(c), open: claimOpen(c), typeName: CLAIM_TYPE[c.type],
      pickupTrack: c.pickup && c.pickup.invoice ? trackUrl(c.pickup.courier, c.pickup.invoice) : '', pickupName: c.pickup ? courierName(c.pickup.courier) : '',
      resendTrack: c.resend ? trackUrl(c.resend.courier, c.resend.invoice) : '', resendName: c.resend ? courierName(c.resend.courier) : '' } : null,
    suggest: refundSuggest(o, cfg) };
}
// 배송 단계 하나(발주 확인·송장 입력·배송 완료·되돌리기). 예전 화면은 status 글자만 보낸다
export function setFulfil(id, d, user) {
  const o = load(id); if (!o) throw new PayError(404, '주문을 찾을 수 없습니다');
  const before = { ...(o.fulfil || {}) };
  hist(o, '배송', applyFulfil(o, typeof d === 'string' ? { status: d === 'shipped' ? 'shipped' : 'new' } : d || {}, user)); save(o);
  afterFulfil(o, before);
  return getOrderAdmin(id);
}
// 취소·반품·교환 요청과 단계(회수 접수·회수 완료·재발송·완료·철회·메모)
export function claimOrder(id, d, user) {
  const o = load(id); if (!o) throw new PayError(404, '주문을 찾을 수 없습니다');
  if (BUSY.has(o.moid)) throw new PayError(409, '처리 중인 주문입니다. 잠시 뒤 다시 시도해 주세요');
  hist(o, '클레임', applyClaim(o, d || {}, user)); save(o);
  if (d && d.action === 'request') tell(o, 'claim', { 요청: CLAIM_TYPE[o.claim.type] });
  if (d && d.action === 'resend') tell(o, 'resent', shipVars(o.claim.resend));
  return getOrderAdmin(id);
}
// 환불: via=pg 는 씨드페이먼츠 결제 취소(전액 = 처음 한 번에 전부, 그 밖은 부분취소 partCanFlg=1 · ccAmt),
//       via=manual 은 계좌 이체 등 결제 밖에서 돌려준 것을 기록만(결제 취소 안 함). 다 돌려주면 주문은 결제 취소
export async function refundOrder(id, d, user) {
  const o = load(id); if (!o) throw new PayError(404, '주문을 찾을 수 없습니다');
  if (o.status !== 'paid') throw new PayError(400, '결제 완료된 주문만 환불할 수 있습니다(부분 환불한 주문 포함)');
  const refunded = refundedOf(o), remain = o.amount - refunded, amount = toInt(d && d.amount), via = d && d.via === 'manual' ? 'manual' : 'pg';
  if (!(amount >= 1 && amount <= remain)) throw new PayError(400, `환불 금액은 1원 ~ ${remain.toLocaleString('ko-KR')}원 사이로 넣어 주세요`);
  const reason = clean((d && d.reason) || '').slice(0, 40) || '관리자 환불', who = `${user.name}(${user.id})`;
  if (via === 'manual') {
    addRefund(o, { amount, part: amount < remain || refunded > 0, reason, by: user.id, via, memo: clean((d && d.memo) || '').slice(0, 100) });
    memberRefunded(o, amount);
    hist(o, '환불 기록(결제 밖 환불)', `${amount}원 · ${reason} — ${who}`); save(o); log('refund-manual', o.moid, amount);
    tell(o, 'refunded', { 환불금액: wonK(amount) });
    return getOrderAdmin(id);
  }
  if (!o.pg || !o.pg.tid) throw new PayError(400, '결제 거래번호가 없어 결제 취소를 할 수 없습니다(결제 밖 환불로 기록해 주세요)');
  if (!KEY()) throw new PayError(503, '가맹점 키(SEEDPAY_MERCHANT_KEY)가 없습니다');
  if (BUSY.has(o.moid)) throw new PayError(409, '처리 중인 주문입니다. 잠시 뒤 다시 시도해 주세요');
  BUSY.add(o.moid);
  try {
    const full = amount === o.amount && !refunded, edi = kstStamp();
    let r;
    try {
      r = await postPg(URLS().cancel, { tid: o.pg.tid, mid: MID(), ordNo: o.moid, ccMsg: reason, ccNm: clean(user.name).slice(0, 30), ccId: String(user.id || '').slice(0, 10),
        partCanFlg: full ? '0' : '1', ...(full ? {} : { ccAmt: String(amount) }), ediDate: edi, hashString: sha256(MID() + edi + o.pg.tid + KEY()) });
    } catch (e) { throw new PayError(502, `취소 요청을 보내지 못했습니다(${e.message}). 씨드페이먼츠 가맹점 관리자에서 취소 여부를 확인해 주세요`); }
    if (str(r.resultCd) !== '0000') {
      hist(o, '환불 실패', `${amount}원 · ${str(r.resultCd)} ${str(r.resultMsg)} — ${who}`); save(o);
      throw new PayError(400, `환불되지 않았습니다: ${str(r.resultMsg) || str(r.resultCd)}${['2028', '2029', '2030', '2031', '2032', '2033', '2034'].includes(str(r.resultCd)) ? ' (부분취소가 막힌 거래입니다. 씨드페이먼츠에 문의하거나 전액 취소 후 다시 결제를 안내해 주세요)' : ''}`);
    }
    const got = r.ccAmt == null || str(r.ccAmt) === '' ? amount : toInt(r.ccAmt), tidOk = !str(r.otid) || str(r.otid) === o.pg.tid;
    const check = got === amount && tidOk ? 'ok' : '응답 금액·원거래 불일치(가맹점 관리자에서 확인)';
    addRefund(o, { amount, part: !full, reason, by: user.id, via: 'pg', tid: str(r.tid), ccSeq: str(r.ccSeq), check });
    if (o.status === 'cancelled') o.cancel = { at: nowIso(), by: user.id, msg: reason, code: '0000', cancelNum: str(r.tid), check };
    memberRefunded(o, amount);
    hist(o, full ? 'cancelled' : '부분 환불', `${amount}원 · ${reason} — ${who}${check === 'ok' ? '' : ' · ' + check}`); save(o);
    log(full ? 'cancelled' : 'refund-part', o.moid, amount, str(r.tid));
    tell(o, 'refunded', { 환불금액: wonK(amount) });
    return getOrderAdmin(id);
  } finally { BUSY.delete(o.moid); }
}
// 예전 '결제 취소(전액)' 버튼: 남은 금액 전부 환불
export async function cancelOrder(id, reason, user) {
  const o = load(id); if (!o) throw new PayError(404, '주문을 찾을 수 없습니다');
  return refundOrder(id, { amount: o.amount - refundedOf(o), reason: reason || '관리자 취소', via: 'pg' }, user);
}
// 배송 설정·정산(설정 파일은 주문과 같은 볼륨 DATA_DIR/orders)
export const shipCfg = () => shipSettings(DIR());
export const saveShip = (d, user) => saveShipSettings(DIR(), d || {}, user);
export const saveSettle = (d, user) => saveSettleSettings(DIR(), d || {}, user);
export function settleReport({ from = '', to = '' } = {}) {
  const cfg = settleSettings(DIR());
  return { cfg, ...settlement(allOrders().filter(o => o.paidAt), cfg, { from: isDay(from) ? from : '', to: isDay(to) ? to : '' }) };
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
export const _test = { sha256, parseForm, lineFor, siteData, load, URLS, postPg };
