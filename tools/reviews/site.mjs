// 손님이 홈페이지에서 쓴 구매평 — 저장: DATA_DIR/reviews/site.json(글) · DATA_DIR/reviews/img/(사진). 저장소(GitHub)가 아니라 서버 볼륨이라 바로 반영된다
//   이 홈페이지는 회원가입 없이 비회원 주문만 받는다. 그래서
//     · 홈페이지에서 산 손님: 주문번호+휴대폰(또는 주문 조회 주소)으로 구매 확인 → 바로 게시('홈페이지 구매' 표시), 주문 상품마다 한 번
//     · 공식몰 회원·스마트스토어 등 다른 곳에서 산 손님: 구매처·이름을 받고 '승인 대기' → 관리자가 게시
//   이름은 가려서 보인다(김*수). 사진은 손님 브라우저가 줄인 JPEG 만 받는다(최대 3장, 장당 1.5MB)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = () => process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'reviews') : (process.env.SITE_REVIEWS_DIR || path.join(ROOT, '.data', 'reviews'));
const FILE = () => path.join(DIR(), 'site.json'), IMG = () => path.join(DIR(), 'img');
export class ReviewError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }
const bad = (m, s) => { throw new ReviewError(m, s); };
export const SOURCES = { site: '홈페이지', mall: '이전 공식몰(jamschool.co.kr)', smartstore: '네이버 스마트스토어', etc: '그 밖의 판매처' };
export const STATUS = { shown: '게시', pending: '승인 대기', hidden: '숨김' };

let CACHE = { m: -1, list: [] }, VER = 0;   // VER: 이 서버가 고친 횟수(파일 시각이 같아도 목록 캐시를 새로)
export function all() {
  let m = 0; try { m = fs.statSync(FILE()).mtimeMs; } catch { m = 0; }
  if (m !== CACHE.m) { let a = []; try { a = JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { a = []; } CACHE = { m, list: Array.isArray(a) ? a : [] }; }
  return CACHE.list;
}
export const version = () => `${(all(), CACHE.m)}.${(ssState(), SSC.m)}.${VER}`;
function write(list) {
  fs.mkdirSync(DIR(), { recursive: true });
  const tmp = `${FILE()}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(list, null, 1)); fs.renameSync(tmp, FILE());
  CACHE = { m: -1, list: [] }; VER++;
}
const mask = s => { s = String(s || '').replace(/\s+/g, ''); const a = [...s]; return a.length <= 1 ? (a[0] || '') + '*' : a.length === 2 ? a[0] + '*' : a[0] + '*'.repeat(a.length - 2) + a[a.length - 1]; };
const clean = (s, max) => String(s ?? '').normalize('NFC').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const newId = () => 'R' + new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\D/g, '').slice(0, 14) + crypto.randomBytes(3).toString('hex').toUpperCase();

// 사진: data:image/jpeg;base64,... → img/<글번호>-<n>.jpg
function savePhotos(id, photos) {
  const out = [];
  for (const [k, d] of (Array.isArray(photos) ? photos : []).slice(0, 3).entries()) {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(d || ''));
    if (!m) bad('사진은 JPG 로 올려 주세요');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 1.5 * 1024 * 1024) bad('사진이 너무 큽니다(장당 1.5MB까지)');
    if (buf[0] !== 0xff || buf[1] !== 0xd8) bad('사진 형식을 확인해 주세요');
    fs.mkdirSync(IMG(), { recursive: true });
    const name = `${id}-${k + 1}.jpg`; fs.writeFileSync(path.join(IMG(), name), buf); out.push(name);
  }
  return out;
}
export function imgFile(name) {
  if (!/^R\d{14}[0-9A-F]{6}-[1-3]\.jpg$/.test(String(name || ''))) return null;
  const f = path.join(IMG(), name); return fs.existsSync(f) ? f : null;
}

// 쓰기. order = 구매 확인된 주문({ moid, items:[{id}], buyerName }) 또는 null
export function add(d, order) {
  const pid = +d.pid, stars = Math.round(+d.stars), text = clean(d.text, 1000);
  if (!(pid > 0)) bad('상품을 골라 주세요');
  if (!(stars >= 1 && stars <= 5)) bad('별점을 골라 주세요');
  if ([...text].length < 10) bad('구매평은 10자 이상 써 주세요');
  const list = all();
  let src = 'site', name = '', verified = false, opt = '';
  if (order) {
    const it = order.items.find(x => +x.id === pid); if (!it) bad('이 주문에 없는 상품입니다');
    if (list.some(r => r.moid === order.moid && r.pid === pid && r.status !== 'deleted')) bad('이 상품은 이미 구매평을 쓰셨습니다');
    name = mask(order.buyerName); verified = true; opt = clean(it.opt, 80);
  } else {
    src = SOURCES[d.src] && d.src !== 'site' ? d.src : bad('어디서 사셨는지 골라 주세요');
    const nm = clean(d.name, 10); if ([...nm].length < 2) bad('이름(별명)을 2자 이상 적어 주세요');
    name = mask(nm);
  }
  const id = newId(), photos = savePhotos(id, d.photos);
  const r = { id, pid, stars, text, photos, name, src, verified, ...(order ? { moid: order.moid } : {}), ...(opt ? { opt } : {}), status: verified ? 'shown' : 'pending', at: new Date().toISOString() };
  write([r, ...list]);
  return r;
}
export function update(id, d, user) {
  const list = all().map(r => ({ ...r })), r = list.find(x => x.id === id); if (!r) bad('구매평을 찾을 수 없습니다', 404);
  if (d.status != null) { if (!STATUS[d.status]) bad('상태를 확인해 주세요'); r.status = d.status; r.by = user.id; r.changedAt = new Date().toISOString(); }
  if (d.reply != null) { const t = clean(d.reply, 500); r.reply = t ? { text: t, at: new Date().toISOString(), by: user.name || user.id } : undefined; }
  write(list); return r;
}
// 손님 화면용(구매평 모아 보기 카드와 같은 모양): w = 홈페이지 구매평, v = 구매 확인, src = 구매처 이름, ps = 사진 여러 장, rp = 판매자 답글
export function publicItems(pid) {
  return all().filter(r => r.pid === +pid && r.status === 'shown').map(r => ({
    n: r.id, i: r.name, d: r.at.slice(0, 10), s: r.stars, t: r.text, w: 1, ...(r.verified ? { v: 1 } : { src: SOURCES[r.src] || '' }),
    ...(r.opt ? { o: r.opt } : {}), ...(r.photos.length ? { p: `/api/reviews/img/${r.photos[0]}`, ps: r.photos.map(f => `/api/reviews/img/${f}`) } : {}), ...(r.reply ? { rp: r.reply.text } : {}),
  }));
}
export const counts = () => { const c = { shown: 0, pending: 0, hidden: 0 }; for (const r of all()) c[r.status] = (c[r.status] || 0) + 1; return c; };

// ── 스마트스토어(가져온) 구매평 관리: 숨기기·잠스쿨 답글 — DATA_DIR/reviews/ss-admin.json(서버 볼륨, 배포 없이 바로 반영)
//   { hidden: { <리뷰글번호>: { at, by } }, reply: { <리뷰글번호>: { text, at, by } } }
//   예전 방식(content/reviews/hidden.json 커밋)도 그대로 함께 본다(api.mjs hiddenSet)
const SSF = () => path.join(DIR(), 'ss-admin.json');
let SSC = { m: -1, d: { hidden: {}, reply: {} } };
export function ssState() {
  let m = 0; try { m = fs.statSync(SSF()).mtimeMs; } catch { m = 0; }
  if (m !== SSC.m) {
    let d = {}; try { d = JSON.parse(fs.readFileSync(SSF(), 'utf8')); } catch { d = {}; }
    SSC = { m, d: { hidden: d && typeof d.hidden === 'object' && d.hidden ? d.hidden : {}, reply: d && typeof d.reply === 'object' && d.reply ? d.reply : {} } };
  }
  return SSC.d;
}
function ssWrite(d) {
  fs.mkdirSync(DIR(), { recursive: true });
  const tmp = `${SSF()}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(d, null, 1)); fs.renameSync(tmp, SSF());
  SSC = { m: -1, d: { hidden: {}, reply: {} } }; VER++;
}
const ssNo = no => /^\d{5,}$/.test(String(no || '')) ? String(no) : bad('스마트스토어 구매평 번호를 확인해 주세요');
export function ssHide(no, hide, user) {
  no = ssNo(no); const d = ssState(), next = { hidden: { ...d.hidden }, reply: { ...d.reply } };
  if (hide) next.hidden[no] = { at: new Date().toISOString(), by: user.id }; else delete next.hidden[no];
  ssWrite(next); return { no, hidden: !!hide };
}
export function ssReply(no, text, user) {
  no = ssNo(no); const t = clean(text, 500), d = ssState(), next = { hidden: { ...d.hidden }, reply: { ...d.reply } };
  if (t) next.reply[no] = { text: t, at: new Date().toISOString(), by: user.name || user.id }; else delete next.reply[no];
  ssWrite(next); return { no, reply: t };
}
export const _test = { mask, DIR };
