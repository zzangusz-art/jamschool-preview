// 홈페이지 회원 — 가입·로그인·내 정보·탈퇴와 적립금 장부
//   저장: DATA_DIR/members/(Railway 볼륨, 공개 저장소 밖) — m-<회원번호>.json 한 사람 한 파일, settings.json(적립금 규칙), .secret(로그인 서명 키, SESSION_SECRET 없을 때)
//   비밀번호는 scrypt 해시만. 로그인 쿠키 jam_m(HttpOnly, 서명) + 화면용 표시 쿠키 jam_mn=1(값 없음)
//   적립금: 주문서에서 쓰면 '잡아 둠'(holds) → 결제 승인 때 차감, 실패하면 풀어 줌(3시간 지나면 자동으로 풀림)
//           배송 완료 뒤 정한 날 수(기본 7일, 반품 기간)가 지나면 결제 금액 × 적립률 적립(seedpay.mjs earnSweep)
//           환불하면 쓴 적립금은 돌려주고, 이미 적립했으면 그만큼 회수(잔액이 0 밑으로 갈 수 있음 — 다음 적립에서 메움)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = () => process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'members') : (process.env.MEMBERS_DIR || path.join(ROOT, '.data', 'members'));
export class MemberError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }
const bad = (m, s) => { throw new MemberError(m, s); };
const nowIso = () => new Date().toISOString();
const kstDay = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
const clean = (s, max) => String(s ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const digits = s => String(s ?? '').replace(/\D/g, '');

// ───────── 적립금 규칙(어드민 '회원·적립금'에서 바꿈)
export const POINT_DEFAULT = { on: true, rate: 1, minUse: 1000, minPay: 1000, earnDays: 7, joinBonus: 0 };
export function pointCfg() {
  let s = {}; try { s = JSON.parse(fs.readFileSync(path.join(DIR(), 'settings.json'), 'utf8')); } catch { s = {}; }
  return { ...POINT_DEFAULT, ...s };
}
export function savePointCfg(d, user) {
  const c = pointCfg(), n = { ...c };
  const int = (v, lo, hi, what) => { const x = Math.round(+v); if (!(x >= lo && x <= hi)) bad(`${what}을(를) 확인해 주세요(${lo}~${hi})`); return x; };
  if (d.on != null) n.on = !!d.on;
  if (d.rate != null) { const r = Math.round(+d.rate * 10) / 10; if (!(r >= 0 && r <= 20)) bad('적립률을 확인해 주세요(0~20%)'); n.rate = r; }
  if (d.minUse != null) n.minUse = int(d.minUse, 0, 1000000, '최소 사용 금액');
  if (d.minPay != null) n.minPay = int(d.minPay, 100, 1000000, '최소 결제 금액');
  if (d.earnDays != null) n.earnDays = int(d.earnDays, 0, 60, '적립 시점(배송 완료 뒤 날 수)');
  if (d.joinBonus != null) n.joinBonus = int(d.joinBonus, 0, 100000, '가입 적립금');
  n.at = nowIso(); n.by = user.id;
  fs.mkdirSync(DIR(), { recursive: true }); fs.writeFileSync(path.join(DIR(), 'settings.json'), JSON.stringify(n, null, 1));
  return pointCfg();
}

// ───────── 회원 파일
const okId = id => /^M\d{8}[A-Z0-9]{6}$/.test(String(id || ''));
const fileOf = id => path.join(DIR(), `m-${id}.json`);
export function get(id) { if (!okId(id)) return null; try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { return null; } }
function put(m) {
  fs.mkdirSync(DIR(), { recursive: true });
  m.updatedAt = nowIso();
  const tmp = `${fileOf(m.id)}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 1)); fs.renameSync(tmp, fileOf(m.id));
  if (IDX) { for (const [k, v] of IDX.login) if (v === m.id) IDX.login.delete(k); if (m.status === 'active') IDX.login.set(m.login, m.id); }
  return m;
}
// 아이디 → 회원번호(처음 한 번 폴더를 읽어 만든다)
let IDX = null;
function index() {
  if (!IDX) {
    IDX = { login: new Map() };
    let files = []; try { files = fs.readdirSync(DIR()).filter(f => /^m-M\w+\.json$/.test(f)); } catch { files = []; }
    for (const f of files) { try { const m = JSON.parse(fs.readFileSync(path.join(DIR(), f), 'utf8')); if (m.status === 'active') IDX.login.set(m.login, m.id); } catch { /* 깨진 파일은 건너뜀 */ } }
  }
  return IDX;
}
export const allIds = () => [...index().login.values()];
export function list() {
  let files = []; try { files = fs.readdirSync(DIR()).filter(f => /^m-M\w+\.json$/.test(f)); } catch { files = []; }
  return files.map(f => { try { return JSON.parse(fs.readFileSync(path.join(DIR(), f), 'utf8')); } catch { return null; } }).filter(Boolean);
}
const newId = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return 'M' + kstDay().replace(/-/g, '') + Array.from(crypto.randomBytes(6), b => A[b % A.length]).join(''); };

// ───────── 비밀번호
function hashPw(pw) { const s = crypto.randomBytes(16); return `scrypt$${s.toString('base64')}$${crypto.scryptSync(pw, s, 32).toString('base64')}`; }
function checkPw(pw, stored) {
  const [k, s, h] = String(stored || '').split('$'); if (k !== 'scrypt' || !s || !h) return false;
  const a = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), 32), b = Buffer.from(h, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const RESERVED = /^(admin|administrator|root|jamschool|jam|master|manager|test|guest|support|help|official|system)$/;
function pwRule(pw, login) {
  pw = String(pw || '');
  if (pw.length < 8 || pw.length > 64) bad('비밀번호는 8~64자로 정해 주세요');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) bad('비밀번호에 영문과 숫자를 함께 넣어 주세요');
  if (login && pw.toLowerCase().includes(login)) bad('비밀번호에 아이디를 넣을 수 없습니다');
  return pw;
}
export const newTempPassword = () => { const A = 'abcdefghjkmnpqrstuvwxyz'; const B = '23456789'; const r = n => crypto.randomBytes(n); return Array.from(r(5), x => A[x % A.length]).join('') + Array.from(r(3), x => B[x % B.length]).join(''); };

// ───────── 가입
const telOk = t => /^01[016789]\d{7,8}$/.test(t);
const mailOk = m => !m || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m);
export const loginOk = l => /^[a-z0-9][a-z0-9_]{3,19}$/.test(l) && !RESERVED.test(l);
export function loginTaken(login) { return index().login.has(String(login || '').toLowerCase()); }
export function join(d) {
  const login = String(d.login || '').trim().toLowerCase();
  if (!loginOk(login)) bad('아이디는 영문 소문자·숫자 4~20자로 정해 주세요(밑줄 _ 가능, 첫 글자는 영문·숫자)');
  if (loginTaken(login)) bad('이미 쓰고 있는 아이디입니다');
  const pw = pwRule(d.pw, login);
  const name = clean(d.name, 20); if ([...name].length < 2) bad('이름을 2자 이상 적어 주세요');
  const tel = digits(d.tel); if (!telOk(tel)) bad('휴대폰 번호를 확인해 주세요');
  const email = String(d.email || '').trim().slice(0, 60); if (!mailOk(email)) bad('이메일 주소 형식을 확인해 주세요');
  if (!d.agreeTerms || !d.agreePrivacy || !d.age14) bad('필수 약관에 동의해 주세요(이용약관·개인정보 수집·이용·만 14세 이상)');
  if (list().some(m => m.status === 'active' && m.tel === tel)) bad('이미 이 휴대폰 번호로 가입한 회원이 있습니다. 아이디 찾기를 이용해 주세요');
  const at = nowIso(), cfg = pointCfg();
  const m = { id: newId(), login, hash: hashPw(pw), name, tel, email, addr: null, status: 'active', created: at,
    agree: { terms: at, privacy: at, age14: at }, marketing: { sms: !!d.mkSms, email: !!d.mkEmail, at },
    points: 0, holds: {}, earned: {}, orders: [], log: [] };
  if (cfg.on && cfg.joinBonus > 0) addLog(m, 'join', cfg.joinBonus, { memo: '가입 적립금' });
  return put(m);
}

// ───────── 로그인(아이디·IP마다 15분 10번 실패, 아이디마다 30번 실패면 15분 막음)
const FAILS = new Map(), WIN = 15 * 60e3;
const locked = (k, max) => { const f = FAILS.get(k); return !!f && f.n >= max && Date.now() < f.until; };
const bump = k => { const f = FAILS.get(k), now = Date.now(); FAILS.set(k, { n: (f && now < f.until ? f.n : 0) + 1, until: now + WIN }); if (FAILS.size > 5000) for (const [x, v] of FAILS) if (now >= v.until) FAILS.delete(x); };
export function login(loginId, pw, ip) {
  const l = String(loginId || '').trim().toLowerCase().slice(0, 40), kIp = `ip:${ip}|${l}`, kId = `id:${l}`;
  if (locked(kIp, 10) || locked(kId, 30)) bad('로그인 실패가 많아 15분 동안 막혔습니다. 잠시 뒤 다시 시도해 주세요', 429);
  const id = index().login.get(l), m = id && get(id);
  if (!m || m.status !== 'active' || !checkPw(pw, m.hash)) { bump(kIp); bump(kId); bad('아이디 또는 비밀번호가 맞지 않습니다', 401); }
  FAILS.delete(kIp); m.lastLogin = nowIso(); put(m);
  return m;
}

// ───────── 로그인 쿠키(서명). 비밀번호를 바꾸면 기존 로그인은 끊긴다
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET + ':member';
  const f = path.join(DIR(), '.secret');
  try { return fs.readFileSync(f, 'utf8'); } catch { fs.mkdirSync(DIR(), { recursive: true }); const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(f, s); return s; }
}
const b64 = s => Buffer.from(s).toString('base64url');
const sign = p => crypto.createHmac('sha256', secret()).update(p).digest('base64url');
const KEEP = 30 * 864e5, SHORT = 12 * 3600e3;
export function sessionCookies(m, keep, secure) {
  const exp = Date.now() + (keep ? KEEP : SHORT), p = b64(JSON.stringify({ i: m.id, v: m.hash.slice(-10), e: exp }));
  const life = keep ? `; Max-Age=${KEEP / 1000}` : '';
  return [`jam_m=${p}.${sign(p)}; Path=/; HttpOnly; SameSite=Lax${life}${secure ? '; Secure' : ''}`, `jam_mn=1; Path=/; SameSite=Lax${life}${secure ? '; Secure' : ''}`];
}
export const clearCookies = secure => [`jam_m=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`, `jam_mn=; Path=/; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`];
export function fromCookie(cookieHeader) {
  const c = String(cookieHeader || '').match(/(?:^|;\s*)jam_m=([^;]+)/); if (!c) return null;
  const [p, s] = c[1].split('.'); if (!p || !s) return null;
  const want = sign(p); if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
  let x; try { x = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return null; }
  if (!x || !x.e || x.e < Date.now()) return null;
  const m = get(x.i); return m && m.status === 'active' && m.hash.slice(-10) === x.v ? m : null;
}
export const fromReq = req => fromCookie(req.headers && req.headers.cookie);

// ───────── 내 정보
const mask = s => { const a = [...String(s || '')]; return a.length <= 2 ? a[0] + '*' : a[0] + '*'.repeat(a.length - 2) + a[a.length - 1]; };
export function view(m) {
  const c = pointCfg();
  return { login: m.login, name: m.name, tel: m.tel, email: m.email || '', addr: m.addr || null, created: m.created, marketing: m.marketing || {}, tempPw: !!m.tempPw,
    points: m.points, available: available(m), cfg: { on: c.on, rate: c.rate, minUse: c.minUse, minPay: c.minPay, earnDays: c.earnDays } };
}
export function update(id, d) {
  const m = get(id); if (!m || m.status !== 'active') bad('회원 정보를 찾을 수 없습니다', 404);
  if (d.name != null) { const n = clean(d.name, 20); if ([...n].length < 2) bad('이름을 2자 이상 적어 주세요'); m.name = n; }
  if (d.tel != null) { const t = digits(d.tel); if (!telOk(t)) bad('휴대폰 번호를 확인해 주세요'); if (t !== m.tel && list().some(x => x.status === 'active' && x.id !== m.id && x.tel === t)) bad('이 휴대폰 번호로 가입한 다른 회원이 있습니다'); m.tel = t; }
  if (d.email != null) { const e = String(d.email || '').trim().slice(0, 60); if (!mailOk(e)) bad('이메일 주소 형식을 확인해 주세요'); m.email = e; }
  if (d.addr !== undefined) {
    if (!d.addr) m.addr = null;
    else { const zip = digits(d.addr.zip), a1 = clean(d.addr.addr1, 200), a2 = clean(d.addr.addr2, 100); if (zip.length !== 5 || !a1) bad('주소를 확인해 주세요'); m.addr = { zip, addr1: a1, addr2: a2, name: clean(d.addr.name, 20) || m.name, tel: digits(d.addr.tel) || m.tel }; }
  }
  if (d.marketing) m.marketing = { sms: !!d.marketing.sms, email: !!d.marketing.email, at: nowIso() };
  return put(m);
}
export function changePassword(id, cur, next) {
  const m = get(id); if (!m) bad('회원 정보를 찾을 수 없습니다', 404);
  if (!checkPw(cur, m.hash)) bad('지금 비밀번호가 맞지 않습니다', 401);
  m.hash = hashPw(pwRule(next, m.login)); m.tempPw = false; m.pwChanged = nowIso();
  return put(m);
}
// 탈퇴: 개인정보(이름·연락처·주소·이메일·비밀번호)를 지우고 적립금은 없어진다. 주문 기록은 법정 보관(5년)이라 주문 파일에 남는다
export function withdraw(id, pw, byAdmin) {
  const m = get(id); if (!m || m.status !== 'active') bad('회원 정보를 찾을 수 없습니다', 404);
  if (!byAdmin && !checkPw(pw, m.hash)) bad('비밀번호가 맞지 않습니다', 401);
  const keep = { id: m.id, status: 'withdrawn', created: m.created, withdrawnAt: nowIso(), by: byAdmin ? byAdmin.id : 'self', orders: m.orders, pointsLost: m.points, earned: m.earned };
  for (const k of Object.keys(m)) delete m[k];
  Object.assign(m, keep);
  return put(m);
}
// 아이디 찾기: 이름+휴대폰이 맞으면 가린 아이디(앞 2자·끝 1자)와 가입일
const FIND = new Map();
export function findLogin(name, tel, ip) {
  const now = Date.now(), a = (FIND.get(ip) || []).filter(t => now - t < 600e3); a.push(now); FIND.set(ip, a); if (FIND.size > 5000) FIND.clear();
  if (a.length > 10) bad('잠시 뒤 다시 시도해 주세요(10분에 10번까지)', 429);
  const n = clean(name, 20), t = digits(tel);
  return list().filter(m => m.status === 'active' && m.name === n && m.tel === t)
    .map(m => ({ login: m.login.slice(0, 2) + '*'.repeat(Math.max(1, m.login.length - 3)) + m.login.slice(-1), created: kstDay(Date.parse(m.created)) }));
}
// 비밀번호 찾기: 아이디·이름·휴대폰이 맞으면 임시 비밀번호(문자로 보냄 — 값은 화면에 보이지 않음). 문자 연결 전이면 null
export function resetForSms(loginId, name, tel, ip) {
  const r = findLogin(name, tel, ip); if (!r.length) return null;
  const id = index().login.get(String(loginId || '').trim().toLowerCase()), m = id && get(id);
  if (!m || m.name !== clean(name, 20) || m.tel !== digits(tel)) return null;
  const pw = newTempPassword(); m.hash = hashPw(pw); m.tempPw = true; m.pwChanged = nowIso(); put(m);
  return { m, pw };
}
export function adminReset(id) {
  const m = get(id); if (!m || m.status !== 'active') bad('회원 정보를 찾을 수 없습니다', 404);
  const pw = newTempPassword(); m.hash = hashPw(pw); m.tempPw = true; m.pwChanged = nowIso(); put(m);
  return pw;
}

// ───────── 적립금 장부
const HOLD_MS = 3 * 3600e3;
function liveHolds(m) { const now = Date.now(), h = {}; for (const [k, v] of Object.entries(m.holds || {})) if (now - Date.parse(v.at) < HOLD_MS) h[k] = v; return h; }
export function available(m) { return Math.max(0, (m.points || 0) - Object.values(liveHolds(m)).reduce((a, h) => a + h.amount, 0)); }
function addLog(m, type, amount, x = {}) {
  m.points = (m.points || 0) + amount;
  (m.log ||= []).unshift({ at: nowIso(), type, amount, balance: m.points, ...x });
  if (m.log.length > 500) m.log.length = 500;
}
// 주문서에서 쓰기: 규칙 확인 뒤 잡아 둔다(결제 전)
export function hold(id, moid, amount, total) {
  const m = get(id); if (!m || m.status !== 'active') bad('로그인이 풀렸습니다. 다시 로그인해 주세요', 401);
  const c = pointCfg(), a = Math.round(+amount || 0);
  if (!(a > 0)) return 0;
  if (!c.on) bad('지금은 적립금을 쓸 수 없습니다');
  if (a < c.minUse) bad(`적립금은 ${c.minUse.toLocaleString('ko-KR')}원 이상부터 쓸 수 있습니다`);
  if (a > available(m)) bad('쓸 수 있는 적립금보다 많습니다. 주문서를 새로 불러와 주세요');
  if (total - a < c.minPay) bad(`결제 금액이 ${c.minPay.toLocaleString('ko-KR')}원 이상 남도록 적립금을 줄여 주세요`);
  m.holds = { ...liveHolds(m), [moid]: { amount: a, at: nowIso() } };
  put(m); return a;
}
export function release(id, moid) { const m = get(id); if (!m || !m.holds || !m.holds[moid]) return; delete m.holds[moid]; put(m); }
// 결제 승인: 잡아 둔 것을 실제로 차감(같은 주문 두 번 안 됨)
export function useHold(id, moid, amount) {
  const m = get(id); if (!m) return;
  if (m.holds) delete m.holds[moid];
  if (!(amount > 0) || (m.log || []).some(l => l.moid === moid && l.type === 'use')) { put(m); return; }
  addLog(m, 'use', -amount, { moid, memo: '주문에 사용' }); put(m);
}
// 주문 전체 취소·환불: 쓴 적립금 돌려주기(한 번만)
export function restoreUse(id, moid, why) {
  const m = get(id); if (!m || m.status !== 'active') return 0;
  const used = (m.log || []).filter(l => l.moid === moid && l.type === 'use').reduce((a, l) => a - l.amount, 0);
  const back = (m.log || []).filter(l => l.moid === moid && l.type === 'restore').reduce((a, l) => a + l.amount, 0);
  const amt = used - back; if (!(amt > 0)) return 0;
  addLog(m, 'restore', amt, { moid, memo: why || '주문 취소로 돌려줌' }); put(m); return amt;
}
// 적립(seedpay earnSweep): 주문마다 한 번
export function earn(id, moid, amount) {
  const m = get(id); if (!m || m.status !== 'active' || !(amount > 0) || (m.earned || {})[moid] != null) return 0;
  (m.earned ||= {})[moid] = amount; addLog(m, 'earn', amount, { moid, memo: '구매 적립' }); put(m); return amount;
}
// 적립한 뒤 환불: 그만큼 회수(적립한 것보다 많이는 안 함)
export function revoke(id, moid, amount, why) {
  const m = get(id); if (!m || m.status !== 'active') return 0;
  const got = (m.earned || {})[moid] || 0, gone = (m.log || []).filter(l => l.moid === moid && l.type === 'revoke').reduce((a, l) => a - l.amount, 0);
  const amt = Math.min(Math.round(+amount || 0), got - gone); if (!(amt > 0)) return 0;
  addLog(m, 'revoke', -amt, { moid, memo: why || '환불로 적립 회수' }); put(m); return amt;
}
export function adjust(id, amount, memo, user) {
  const m = get(id); if (!m || m.status !== 'active') bad('회원 정보를 찾을 수 없습니다', 404);
  const a = Math.round(+amount || 0); if (!a || Math.abs(a) > 10000000) bad('금액을 확인해 주세요');
  const why = clean(memo, 100); if (!why) bad('사유를 적어 주세요');
  addLog(m, 'admin', a, { memo: why, by: user.name || user.id }); return put(m);
}
export function addOrder(id, moid) { const m = get(id); if (!m) return; if (!(m.orders ||= []).includes(moid)) { m.orders.unshift(moid); if (m.orders.length > 1000) m.orders.length = 1000; put(m); } }
export const _test = { mask, DIR, reset: () => { IDX = null; FAILS.clear(); FIND.clear(); } };
