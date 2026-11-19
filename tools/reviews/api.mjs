// 구매평 API — tools/serve.mjs 가 /api/reviews* 를 여기로 넘긴다
//   GET  /api/reviews?pid=30&f=all|photo|month|best|r4|site&k=<주제>&q=<찾을 말>&sort=rec|new|star|photo&page=1&n=10   상품 페이지 '구매평'(하나로 합친 목록)
//   GET  /api/reviews/img/<파일>                       손님이 올린 구매평 사진
//   POST /api/reviews/verify { o,t | no,tel }          구매 확인(홈페이지 주문) → 쓸 수 있는 상품
//   POST /api/reviews/write  { pid, stars, text, photos[], o,t | src,name }   구매평 쓰기(tools/reviews/site.mjs)
//   한 상품의 목록 = 잠스쿨이 고른 BEST(어드민 '구매평' › BEST 구매평) → 홈페이지 손님 구매평(게시) → 네이버 스마트스토어 구매평(content/reviews, 숨긴 글 제외)
//   스마트스토어 파일은 tools/reviews/import-ss.py 가 추천순으로 저장한다. 고른 조건별 순서는 300개까지 기억하고, 글이 바뀌면 다시 만든다
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as SITE from './site.mjs';
import { clientIp } from '../client-ip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = () => process.env.REVIEWS_DIR || path.join(ROOT, 'content', 'reviews');
let SUM = null, TOP = null, HID = { m: -1, set: new Set() }, JAM = { stamp: '', jam: null };
const DATA = new Map(), IDX = new Map();
const mtime = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
// 숨긴 스마트스토어 글(어드민 '구매평 관리' › 숨기기 → content/reviews/hidden.json)
export function hiddenSet() {
  const f = path.join(DIR(), 'hidden.json'), m = mtime(f);
  if (m !== HID.m) { let a = []; try { a = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { a = []; } HID = { m, set: new Set((Array.isArray(a) ? a : []).map(String)) }; }
  return HID.set;
}
const summary = () => { if (!SUM) { try { SUM = JSON.parse(fs.readFileSync(path.join(DIR(), 'summary.json'), 'utf8')); } catch { SUM = { products: {} }; } } return SUM; };
const topics = () => { if (!TOP) { try { TOP = JSON.parse(fs.readFileSync(path.join(DIR(), 'topics.json'), 'utf8')); } catch { TOP = { topics: {}, sets: {}, products: {} }; } } return TOP; };
export const topicsOf = (pid, text) => { const T = topics(), set = T.sets[T.products[String(pid)]] || []; return set.filter(k => { try { return new RegExp(T.topics[k].re).test(text); } catch { return false; } }); };
// 잠스쿨이 고른 BEST 구매평(data.js + 어드민 고친 값). 파일이 바뀌면 다시 읽는다
function jam() {
  const files = ['assets/js/data.js', 'content/site.json'].map(f => path.join(ROOT, f)), stamp = files.map(mtime).join(':');
  if (JAM.stamp !== stamp) {
    try {
      let ov = {}; try { ov = JSON.parse(fs.readFileSync(files[1], 'utf8')); } catch { ov = {}; }
      const ctx = { window: { WEBP: new Set(), JAM_OVERRIDES: ov } }; ctx.globalThis = ctx.window; vm.createContext(ctx);
      vm.runInContext(fs.readFileSync(files[0], 'utf8').replace(/typeof window !== 'undefined' \? window : globalThis/, 'window'), ctx);
      JAM = { stamp, jam: ctx.window.JAM };
    } catch (e) { console.error('[reviews] data.js', e.message); JAM = { stamp, jam: { REVIEWS: [] } }; }
  }
  return JAM.jam;
}
const norm = t => String(t || '').replace(/\s+/g, '').slice(0, 60);
function data(pid) {
  hiddenSet(); jam();
  const v = `${SITE.version()}|${JAM.stamp}|${HID.m}`;
  const hit = DATA.get(pid); if (hit && hit.v === v) return hit;
  let ss = []; try { ss = JSON.parse(fs.readFileSync(path.join(DIR(), `${pid}.json`), 'utf8')); } catch { ss = []; }
  const picks = (JAM.jam.REVIEWS || []).filter(r => String(r.pid) === String(pid) && r.text).map((r, i) => ({ n: `B${pid}-${i + 1}`, i: r.id || '', d: '', s: 5, t: r.text, b: 1, pk: 1, ...(r.opt ? { o: r.opt } : {}), k: topicsOf(pid, r.text) }));
  const mine = SITE.publicItems(pid).map(x => ({ ...x, k: topicsOf(pid, x.t) }));
  const seen = new Set(picks.map(x => norm(x.t)));
  const list = [...picks, ...mine, ...ss.filter(x => !seen.has(norm(x.t)))];
  const idx = list.map((x, i) => i);
  const out = { v, list,
    byNew: idx.slice().sort((a, b) => (list[b].d || '').localeCompare(list[a].d || '') || a - b),
    byStar: idx.slice().sort((a, b) => (list[b].s - list[a].s) || a - b),
    byPhoto: idx.slice().sort((a, b) => ((list[b].p ? 1 : 0) - (list[a].p ? 1 : 0)) || a - b) };
  DATA.set(pid, out);
  return out;
}
const F = { all: () => true, photo: x => !!x.p, month: x => !!x.m, best: x => !!x.b, r4: x => x.s === 4, site: x => !!x.w };
// vis: 'show'(손님: 숨긴 스마트스토어 글 빼기) | 'all'(어드민: 다) | 'hidden'(어드민: 숨긴 글만)
function order(pid, f, k, sort, vis = 'show') {
  const H = hiddenSet(), D = data(pid), key = `${pid}|${D.v}|${f}|${k}|${sort}|${vis}`;
  if (IDX.has(key)) { const val = IDX.get(key); IDX.delete(key); IDX.set(key, val); return val; }
  const { list } = D, base = sort === 'new' ? D.byNew : sort === 'star' ? D.byStar : sort === 'photo' ? D.byPhoto : list.map((x, i) => i);
  const hv = i => { const h = typeof list[i].n === 'number' && H.has(String(list[i].n)); return vis === 'all' ? true : vis === 'hidden' ? h : !h; };
  const out = base.filter(i => hv(i) && F[f](list[i]) && (!k || (list[i].k || []).includes(k)));
  IDX.set(key, out); if (IDX.size > 300) IDX.delete(IDX.keys().next().value);
  return out;
}
export function query(params, { admin = false } = {}) {
  const S = summary(), pid = String(params.get('pid') || '');
  if (!S.products[pid] && !data(pid).list.length) return { status: 404, body: { error: '구매평이 없는 상품입니다' } };
  const f = F[params.get('f')] ? params.get('f') : 'all', sort = ['new', 'star', 'photo'].includes(params.get('sort')) ? params.get('sort') : 'rec';
  const k = String(params.get('k') || ''), q = String(params.get('q') || '').trim().slice(0, 20).toLowerCase();
  const T = topics(), set = T.sets[T.products[pid]] || [];
  if (k && !set.includes(k)) return { status: 400, body: { error: '없는 주제입니다' } };
  const n = Math.min(30, Math.max(1, parseInt(params.get('n'), 10) || 10)), page = Math.max(1, parseInt(params.get('page'), 10) || 1);
  const { list } = data(pid);
  let idx = order(pid, f, k, sort, admin ? (params.get('vis') === 'hidden' ? 'hidden' : 'all') : 'show');
  if (q) idx = idx.filter(i => list[i].t.toLowerCase().includes(q) || (admin && String(list[i].n) === q));
  const H = hiddenSet(), items = idx.slice((page - 1) * n, page * n).map(i => admin ? { ...list[i], hid: H.has(String(list[i].n)) || undefined } : list[i]);
  return { status: 200, body: { total: idx.length, page, pages: Math.ceil(idx.length / n), n, site: SITE.publicItems(pid).length, items } };
}
// 어드민: 리뷰글번호로 한 건(BEST 로 올리기)
export function one(pid, no) { const { list } = data(String(pid)); return list.find(x => String(x.n) === String(no)) || null; }
export const summaryOf = () => summary();
export const topicSets = () => topics();

// ── 쓰기: 구매 확인은 결제 주문 모듈이 한다(serve.mjs 가 connect 로 넣어 준다)
let ORDER = null;   // ({ o, t, no, tel }) → { moid, token, buyerName, items:[{id,name,opt}], can } | null
let NOTIFY = null;  // (review) → 관리자 알림
export function connect({ reviewOrder, notifyReview }) { ORDER = reviewOrder; NOTIFY = notifyReview; }
const LIM = new Map();
const limited = (ip, max) => { const now = Date.now(), a = (LIM.get(ip) || []).filter(t => now - t < 600e3); a.push(now); LIM.set(ip, a); if (LIM.size > 5000) LIM.clear(); return a.length > max; };
function readBody(req, max) {
  return new Promise((ok, no) => { const chunks = []; let n = 0; req.on('data', c => { n += c.length; if (n > max) { no(Object.assign(new Error('너무 큽니다'), { status: 413 })); req.destroy(); } else chunks.push(c); }); req.on('end', () => ok(Buffer.concat(chunks))); req.on('error', no); });
}
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); res.end(JSON.stringify(body)); };
function verifyOut(o) {
  const done = new Set(SITE.all().filter(r => r.moid === o.moid).map(r => r.pid));
  return { o: o.moid, t: o.token, can: o.can, items: o.items.map(x => ({ pid: x.id, name: x.name, opt: x.opt || '', done: done.has(+x.id) })) };
}
async function handleWrite(req, res, p) {
  if (limited(p + '|' + clientIp(req), p === '/api/reviews/write' ? 6 : 15)) return json(res, 429, { error: '잠시 뒤 다시 시도해 주세요(10분에 몇 번까지만 됩니다).' });
  let d; try { d = JSON.parse((await readBody(req, 7 * 1024 * 1024)).toString('utf8')); } catch (e) { return json(res, e.status || 400, { error: e.status === 413 ? '사진이 너무 큽니다' : '요청 형식 오류' }); }
  if (!ORDER) return json(res, 503, { error: '지금은 구매평을 쓸 수 없습니다' });
  if (p === '/api/reviews/verify') {
    const o = ORDER({ o: d.o, t: d.t, no: d.no, tel: d.tel });
    if (!o) return json(res, 404, { error: '주문번호와 휴대폰 번호가 맞는 주문이 없습니다' });
    return json(res, 200, verifyOut(o));
  }
  let order = null;
  if (d.o || d.t) {
    order = ORDER({ o: d.o, t: d.t });
    if (!order) return json(res, 404, { error: '주문 정보를 찾을 수 없습니다' });
    if (!order.can) return json(res, 400, { error: '상품을 보낸 뒤부터 구매평을 쓸 수 있습니다' });
  }
  try {
    const r = SITE.add(d, order);
    DATA.delete(String(r.pid));
    console.log('[reviews] 새 구매평', r.id, r.pid, r.status, r.photos.length);
    try { if (NOTIFY) NOTIFY(r); } catch { /* 알림 실패는 무시 */ }
    return json(res, 200, { ok: true, id: r.id, status: r.status });
  } catch (e) { if (e instanceof SITE.ReviewError) return json(res, e.status, { error: e.message }); throw e; }
}
// serve.mjs 연결: 처리했으면 true
export async function handleReviews(req, res) {
  const u = new URL(req.url || '/', 'http://x');
  if (u.pathname !== '/api/reviews' && !u.pathname.startsWith('/api/reviews/')) return false;
  try {
    if (u.pathname.startsWith('/api/reviews/img/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const f = SITE.imgFile(decodeURIComponent(u.pathname.slice('/api/reviews/img/'.length)));
      if (!f) { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); return true; }
      const st = fs.statSync(f);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': st.size, 'Cache-Control': 'public, max-age=2592000, immutable', 'X-Robots-Tag': 'noindex' });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(f).pipe(res);
      return true;
    }
    if ((u.pathname === '/api/reviews/verify' || u.pathname === '/api/reviews/write') && req.method === 'POST') { await handleWrite(req, res, u.pathname); return true; }
    if (u.pathname !== '/api/reviews') { json(res, 404, { error: '없는 요청' }); return true; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET' }); res.end(); return true; }
    const r = query(u.searchParams), body = JSON.stringify(r.body);
    res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': r.status === 200 ? 'public, max-age=60' : 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (e) { console.error('[reviews]', e); if (!res.headersSent) json(res, 500, { error: '구매평을 불러오지 못했습니다' }); }
  return true;
}
export const _test = { reset: () => { SUM = null; TOP = null; DATA.clear(); IDX.clear(); HID = { m: -1, set: new Set() }; JAM = { stamp: '', jam: null }; } };
