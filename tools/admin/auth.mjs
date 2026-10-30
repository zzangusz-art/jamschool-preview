// 어드민 계정·로그인. 저장소가 공개라 계정 정보는 절대 git 에 넣지 않는다.
//   계정 파일: DATA_DIR(Railway 볼륨)/admin-users.json → 비밀번호 변경·계정 관리 가능
//              없으면 환경변수 ADMIN_USERS(JSON, 읽기 전용) / 로컬은 ADMIN_USERS_FILE
//              처음 켤 때 파일이 없고 ADMIN_USERS 가 있으면 그 값으로 파일을 만든다
//   비밀번호: scrypt(소금값 포함) 해시만 저장. 로그인 상태: SESSION_SECRET 으로 서명한 쿠키(재배포돼도 유지, 12시간)
//   역할: owner(관리자 — 설정·계정·작업 기록·자동 발행 대기열까지) / client(클라이언트 — 블로그·상품·상세페이지)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FILE = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'admin-users.json') : (process.env.ADMIN_USERS_FILE || '');
const SECRET = process.env.SESSION_SECRET || (process.env.ADMIN_STORE === 'local' ? crypto.randomBytes(32).toString('hex') : '');
const TTL = 12 * 3600e3;

export const ROLES = { owner: '관리자', client: '클라이언트' };
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${crypto.scryptSync(pw, salt, 32).toString('base64')}`;
}
function checkPassword(pw, stored) {
  const [k, s, h] = String(stored || '').split('$');
  if (k !== 'scrypt' || !s || !h) return false;
  const a = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 32), b = Buffer.from(h, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const newPassword = () => crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '').slice(0, 14);

export function loadUsers() {
  if (FILE) {
    if (!fs.existsSync(FILE) && process.env.ADMIN_USERS) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(JSON.parse(process.env.ADMIN_USERS), null, 1)); }
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  }
  return process.env.ADMIN_USERS ? JSON.parse(process.env.ADMIN_USERS) : [];
}
export const canWriteUsers = () => !!FILE;
export function saveUsers(list) {
  if (!FILE) throw Object.assign(new Error('계정을 바꾸려면 Railway 볼륨(DATA_DIR)이 필요합니다'), { status: 400 });
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(list, null, 1)); fs.renameSync(FILE + '.tmp', FILE);
}
export const ready = () => !!SECRET && loadUsers().length > 0;

// 로그인 시도 제한: 같은 IP·같은 아이디로 15분에 10번 실패하면 잠시 막음(같은 사무실의 다른 계정은 영향 없음)
const fails = new Map();
export function login(id, pw, ip) {
  const key = `${ip}|${String(id || '').trim()}`, f = fails.get(key);
  if (f && f.n >= 10 && Date.now() < f.until) return { error: '로그인 실패가 많아 15분 동안 막혔습니다' };
  const u = loadUsers().find(x => x.id === String(id || '').trim());
  if (!u || !checkPassword(String(pw || ''), u.hash)) {
    const n = (f && Date.now() < f.until ? f.n : 0) + 1; fails.set(key, { n, until: Date.now() + 15 * 60e3 });
    return { error: '아이디 또는 비밀번호가 맞지 않습니다' };
  }
  fails.delete(key);
  return { user: u, cookie: sign({ u: u.id, v: u.hash.slice(-10), exp: Date.now() + TTL }) };
}
const b64 = s => Buffer.from(s).toString('base64url');
function sign(payload) { const p = b64(JSON.stringify(payload)); return `${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; }
export function sessionUser(cookieHeader) {
  const m = String(cookieHeader || '').match(/(?:^|;\s*)jam_admin=([^;]+)/);
  if (!m || !SECRET) return null;
  const [p, sig] = m[1].split('.');
  const want = crypto.createHmac('sha256', SECRET).update(p || '').digest('base64url');
  if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  let s; try { s = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return null; }
  if (!s.exp || s.exp < Date.now()) return null;
  const u = loadUsers().find(x => x.id === s.u);
  return u && u.hash.slice(-10) === s.v ? u : null;   // 비밀번호를 바꾸면 기존 로그인은 끊김
}
export const cookieHeader = (value, secure) => `jam_admin=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${value ? TTL / 1000 : 0}${secure ? '; Secure' : ''}`;
