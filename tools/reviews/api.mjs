// 구매평 모아 보기 API — tools/serve.mjs 가 /api/reviews 를 여기로 넘긴다
//   GET /api/reviews?pid=30&f=all|photo|month|best|r4&k=<주제>&q=<찾을 말>&sort=rec|new&page=1&n=10
//   데이터: content/reviews/<상품번호>.json(tools/reviews/import-ss.py 가 추천순으로 저장) · summary.json(개수·주제) · topics.json(주제 이름·말)
//   상품 파일은 처음 부를 때 메모리에 올리고, 고른 조건(상품·종류·주제·정렬)별 순서는 300개까지 기억한다
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = () => process.env.REVIEWS_DIR || path.join(ROOT, 'content', 'reviews');
let SUM = null;
const DATA = new Map(), IDX = new Map();
const summary = () => { if (!SUM) { try { SUM = JSON.parse(fs.readFileSync(path.join(DIR(), 'summary.json'), 'utf8')); } catch { SUM = { products: {} }; } } return SUM; };
function data(pid) {
  if (!DATA.has(pid)) {
    let list = []; try { list = JSON.parse(fs.readFileSync(path.join(DIR(), `${pid}.json`), 'utf8')); } catch { list = []; }
    const byNew = list.map((x, i) => i).sort((a, b) => list[b].d.localeCompare(list[a].d) || String(list[b].n).localeCompare(String(list[a].n)));
    DATA.set(pid, { list, byNew });
  }
  return DATA.get(pid);
}
const F = { all: () => true, photo: x => !!x.p, month: x => !!x.m, best: x => !!x.b, r4: x => x.s === 4 };
function order(pid, f, k, sort) {
  const key = `${pid}|${f}|${k}|${sort}`;
  if (IDX.has(key)) { const v = IDX.get(key); IDX.delete(key); IDX.set(key, v); return v; }
  const { list, byNew } = data(pid), base = sort === 'new' ? byNew : list.map((x, i) => i);
  const out = base.filter(i => F[f](list[i]) && (!k || (list[i].k || []).includes(k)));
  IDX.set(key, out); if (IDX.size > 300) IDX.delete(IDX.keys().next().value);
  return out;
}
export function query(params) {
  const S = summary(), pid = String(params.get('pid') || ''), P = S.products[pid];
  if (!P) return { status: 404, body: { error: '구매평이 없는 상품입니다' } };
  const f = F[params.get('f')] ? params.get('f') : 'all', sort = params.get('sort') === 'new' ? 'new' : 'rec';
  const k = String(params.get('k') || ''), q = String(params.get('q') || '').trim().slice(0, 20).toLowerCase();
  if (k && !P.topics.some(t => t[0] === k)) return { status: 400, body: { error: '없는 주제입니다' } };
  const n = Math.min(30, Math.max(1, parseInt(params.get('n'), 10) || 10)), page = Math.max(1, parseInt(params.get('page'), 10) || 1);
  const { list } = data(pid);
  let idx = order(pid, f, k, sort);
  if (q) idx = idx.filter(i => list[i].t.toLowerCase().includes(q));
  const items = idx.slice((page - 1) * n, page * n).map(i => list[i]);
  return { status: 200, body: { total: idx.length, page, pages: Math.ceil(idx.length / n), n, items } };
}
// serve.mjs 연결: 처리했으면 true
export function handleReviews(req, res) {
  const u = new URL(req.url || '/', 'http://x');
  if (u.pathname !== '/api/reviews') return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET' }); res.end(); return true; }
  let r; try { r = query(u.searchParams); } catch (e) { console.error('[reviews]', e); r = { status: 500, body: { error: '구매평을 불러오지 못했습니다' } }; }
  const body = JSON.stringify(r.body);
  res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': r.status === 200 ? 'public, max-age=300' : 'no-store', 'X-Robots-Tag': 'noindex' });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
export const _test = { reset: () => { SUM = null; DATA.clear(); IDX.clear(); } };
