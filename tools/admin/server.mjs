// 잠스쿨 관리자 어드민(/admin) — tools/serve.mjs 가 요청을 먼저 여기로 넘긴다
//   화면: tools/admin/public/ (로그인 → 블로그·상품·상세페이지, 관리자 전용 메뉴)
//   API : /api/admin/* (쿠키 로그인, 쓰기 요청은 X-Jam-Admin 헤더 필수 — 다른 사이트에서 몰래 보내는 요청 차단)
//   저장: store.mjs (운영 = GitHub 커밋 → 자동 재배포, 로컬 = 파일 직접 + 빌드)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { ROLES, canWriteUsers, cookieHeader, hashPassword, loadUsers, login, newPassword, ready, saveUsers, sessionUser } from './auth.mjs';
import { makeStore } from './store.mjs';
import { summary as statsSummary, flushNow as statsFlush, forgetCache as statsForget, resetOrderStats, ordersSince } from './stats.mjs';
import { FORMATS as SHIP_FORMATS, shipExport } from '../pay/ship-export.mjs';
import * as BACKUP from './backup.mjs';
import { cleanOpts, canon } from './options.mjs';
import { parseFrontmatter, renderMarkdown } from '../blog/lib.mjs';
import { CATEGORIES, checkPost, similar } from '../blog-ai/rules.mjs';
import * as PAY from '../pay/seedpay.mjs';
import * as NOTIFY from '../pay/notify.mjs';
import { clientIp } from '../client-ip.mjs';
import { BLOCKS, MENUS, ICONS, IMG_PATH, cleanBlock } from './blocks.mjs';
import { EDIT_FILES, listEdits, normText } from './edits.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PUB = path.join(HERE, 'public');
const store = makeStore(ROOT);
BACKUP.ensureMarker();   // 볼륨이 처음 쓰인 시각(재배포 뒤에도 같으면 볼륨이 붙어 있음)
const MAX_BODY = 40 * 1024 * 1024, MAX_FILE = 10 * 1024 * 1024;
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const CSP = "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const need = (cond, status, msg, extra) => { if (!cond) throw new HttpError(status, msg, extra); };
function send(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...headers });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(new HttpError(413, '한 번에 올릴 수 있는 용량(40MB)을 넘었습니다')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new HttpError(400, '요청 형식 오류')); } });
    req.on('error', reject);
  });
}
// 업로드: data:image/...;base64,... → { base64, ext }
function decodeImage(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
  need(m, 400, '사진 형식은 JPG·PNG·WebP·GIF 만 올릴 수 있습니다');
  need(m[2].length * 0.75 <= MAX_FILE, 400, '사진 한 장은 10MB 이하로 올려 주세요');
  return { base64: m[2], ext: m[1] === 'jpeg' ? 'jpg' : m[1] };
}
const stamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\D/g, '').slice(2, 14);
const oneLine = s => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
const msg = (u, what) => `어드민: ${what}\n\n${ROLES[u.role] || u.role} ${u.name} (${u.id}) · ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} KST`;

// ── 사이트 데이터 읽기(항상 저장소 최신본 기준)
// fresh: 저장 직전 읽고-고쳐-쓰는 파일은 GitHub 최신본으로(store.mjs 참고)
async function readText(p, fresh) { const f = await store.read(p, { fresh: !!fresh }); return f ? f.text : null; }
async function readJson(p, def, fresh) { const t = await readText(p, fresh); return t ? JSON.parse(t) : def; }
function evalData(src, overrides) {
  const ctx = { window: { WEBP: new Set(), JAM_OVERRIDES: overrides || {} }, console };
  ctx.globalThis = ctx.window; vm.createContext(ctx);
  vm.runInContext(src.replace(/typeof window !== 'undefined' \? window : globalThis/, 'window'), ctx);
  return ctx.window.JAM;
}
async function products(fresh) {
  const src = await readText('assets/js/data.js');
  const site = await readJson('content/site.json', { products: {}, options29: {} }, fresh);
  const base = evalData(src, {}), cur = evalData(src, site);
  return { base, cur, site };
}
const POST_DIR = 'content/blog';
let postCache = null;
async function listPosts() {
  if (postCache && Date.now() - postCache.at < 20000) return postCache.list;
  const files = (await store.list(POST_DIR)).filter(f => f.name.endsWith('.md') && !f.name.startsWith('_'));
  const list = [];
  for (const f of files) {
    const t = await readText(f.path); if (!t) continue;
    try { const { meta } = parseFrontmatter(t); list.push({ ...meta, tags: (meta.tags || []).join(', '), file: f.name, slug: meta.slug || f.name.replace(/\.md$/, ''), draft: meta.draft === 'true' }); } catch { list.push({ slug: f.name.replace(/\.md$/, ''), title: `(형식 오류) ${f.name}`, file: f.name }); }
  }
  list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  postCache = { at: Date.now(), list };
  return list;
}
const detailPath = id => `assets/js/detail-${id}.js`;
function parseDetail(src) {
  const m = src.match(/^([\s\S]*?)\(window\.DETAIL = window\.DETAIL \|\| \{\}\)\[(\d+)\] = (\[[\s\S]*\])\s*;?\s*$/);
  need(m, 500, '상세 파일 형식을 읽지 못했습니다');
  return { head: m[1], items: JSON.parse(m[3]) };
}

// ── 화면 파일
let shellCache = null;
function adminShell() {
  if (shellCache) return shellCache;
  const ver = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(PUB, f))).digest('hex').slice(0, 10);
  shellCache = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
    .replace('/admin/admin.css"', `/admin/admin.css?v=${ver('admin.css')}"`).replace('/admin/admin.js"', `/admin/admin.js?v=${ver('admin.js')}"`);
  return shellCache;
}
function serveStatic(req, res, p) {
  const rel = p.replace(/^\/admin\/?/, '') || 'index.html';
  const file = path.join(PUB, path.normalize(rel));
  const target = file.startsWith(PUB + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(PUB, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  // 화면 틀(index.html)의 admin.js·admin.css 주소에 파일 내용 해시를 붙인다 — Cloudflare 가 js·css 를 브라우저에 4시간 붙잡아 두어
  // 배포 뒤에도 옛 화면이 보이던 문제(주소가 바뀌면 새 파일을 받는다)
  if (path.basename(target) === 'index.html') { res.end(adminShell()); return; }
  res.end(fs.readFileSync(target));
}

// ── API
const routes = [];
const route = (method, pattern, role, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), role, fn });

route('GET', '/api/admin/me', null, async ({ user }) => ({
  user: user && { id: user.id, name: user.name, role: user.role, roleName: ROLES[user.role] }, ready: ready(), store: store.kind, storeReady: store.ready(), canWriteUsers: canWriteUsers(), categories: CATEGORIES }));

// 대시보드: 최근 변경·반영 상태
route('GET', '/api/admin/dashboard', 'client', async () => {
  const recent = await store.recent(8);
  const last = recent[0];
  return { recent, status: last ? await store.status(last.sha) : null, posts: (await listPosts()).length };
});
route('GET', '/api/admin/status/:sha', 'client', async ({ params }) => store.status(params.sha));

// 유입·주문 집계(사이트 자체 집계, 개인정보 없음)
route('GET', '/api/admin/stats', 'client', async ({ query }) => {
  const n = Math.min(90, Math.max(1, +query.get('days') || 7));
  const { cur } = await products();
  const posts = await listPosts();
  const prev = statsSummary(n, n);   // 바로 앞 같은 기간(증감 비교)
  return { ...statsSummary(n), prev: { days: prev.days, total: { pv: prev.total.pv, uv: prev.total.uv, entries: prev.total.entries, sources: prev.total.sources, devices: prev.total.devices, events: prev.total.events } }, names: Object.fromEntries(cur.PRODUCTS.map(p => [p.id, p.short])), titles: Object.fromEntries(posts.map(p => [`/blog/${p.slug}`, p.title])) };
});

// 블로그
route('GET', '/api/admin/posts', 'client', async () => ({ posts: await listPosts() }));
route('GET', '/api/admin/posts/:slug', 'client', async ({ params }) => {
  need(/^[a-z0-9-]+$/.test(params.slug), 400, '주소 형식 오류');
  const t = await readText(`${POST_DIR}/${params.slug}.md`); need(t, 404, '글을 찾지 못했습니다');
  const { meta, body: b } = parseFrontmatter(t);
  return { meta: { ...meta, tags: (meta.tags || []).join(', ') }, body: b };
});
route('POST', '/api/admin/preview', 'client', async ({ data }) => ({ html: renderMarkdown(String(data.body || '')).html }));
route('POST', '/api/admin/posts', 'client', async ({ data, user }) => {
  const m = data.meta || {}, isNew = !m.slug;
  const slug = isNew ? `post-${kst().replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6)}` : String(m.slug);
  need(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), 400, '글 주소(slug)는 영문 소문자·숫자·하이픈만');
  const posts = await listPosts();
  const old = posts.find(p => p.slug === slug);
  need(isNew || old, 404, '수정할 글을 찾지 못했습니다');
  let text = String(data.body || '').replace(/\r/g, '');
  const files = [];
  // 본문 사진: 화면에서 tmp:<id> 로 넣은 자리를 실제 경로로
  for (const [i, up] of (data.uploads || []).entries()) {
    const img = decodeImage(up.data), p = `assets/img/blog/${slug}-${stamp()}${i}.${img.ext}`;
    text = text.split(`(tmp:${up.tmp})`).join(`(${p})`); files.push({ path: p, base64: img.base64 });
  }
  need(!/\(tmp:/.test(text), 400, '올리지 못한 사진이 남아 있습니다');
  let image = old && old.image ? old.image : '';
  if (data.thumb) { const img = decodeImage(data.thumb); image = `assets/img/blog/${slug}.${img.ext}`; files.push({ path: image, base64: img.base64 }); }
  const title = oneLine(m.title); need(title.length >= 4, 400, '제목을 입력해 주세요');
  const category = CATEGORIES.includes(m.category) ? m.category : CATEGORIES[0];
  const firstPara = text.split(/\n\s*\n/).map(s => s.trim()).find(s => s && !s.startsWith('#') && !s.startsWith('!')) || '';
  const description = oneLine(m.description) || oneLine(firstPara.replace(/[*#>\[\]()]/g, '')).slice(0, 80);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(m.date || '') ? m.date : (old && old.date) || kst();
  const draft = !!data.draft;
  const fm = { title, description, slug, date, category, tags: oneLine(m.tags || ''), keyword: oneLine(m.keyword), product: /^\d+$/.test(String(m.product || '')) ? String(m.product) : '',
    image, author: oneLine(m.author) || (old && old.author) || '잠스쿨 편집팀', source: old && old.source && old.source !== 'admin' ? old.source : 'admin', ...(draft ? { draft: 'true' } : {}) };
  const md = `---\n${Object.entries(fm).filter(([, v]) => v !== '').map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${text.trim()}\n`;
  const { meta } = parseFrontmatter(md);
  const r = checkPost(md, meta, text, posts.filter(p => p.slug !== slug && !p.draft));
  if (!draft && r.block.length) throw new HttpError(400, '발행하기 전에 고쳐야 할 내용이 있습니다(임시저장은 가능)', r);
  files.push({ path: `${POST_DIR}/${slug}.md`, text: md });
  const c = await store.commit(files, msg(user, `${draft ? '블로그 임시저장' : isNew ? '블로그 새 글 발행' : '블로그 글 수정'} 「${title}」`), user.name);
  postCache = null;
  return { ok: true, slug, commit: c.sha, ...r };
});
route('DELETE', '/api/admin/posts/:slug', 'owner', async ({ params, user }) => {
  need(/^[a-z0-9-]+$/.test(params.slug), 400, '주소 형식 오류');
  const p = (await listPosts()).find(x => x.slug === params.slug); need(p, 404, '글을 찾지 못했습니다');
  const files = [{ path: `${POST_DIR}/${p.file}`, delete: true }];
  const c = await store.commit(files, msg(user, `블로그 글 삭제 「${p.title}」`), user.name);
  postCache = null;
  return { ok: true, commit: c.sha };
});

// 상품
const EDITABLE = ['name', 'short', 'summary', 'list', 'price', 'badges', 'points', 'imgs', 'store', 'rating', 'reviews'];
route('GET', '/api/admin/products', 'client', async () => {
  const { cur } = await products();
  return { products: cur.PRODUCTS.map(p => ({ id: p.id, name: p.name, short: p.short, price: p.price, list: p.list, img: p.imgs[0], from: !!p.from, opts: cur.OPT.of(p) ? cur.OPT.of(p).groups.map(g => g.name) : [] })) };
});
route('GET', '/api/admin/products/:id', 'client', async ({ params }) => {
  const { cur, base } = await products();
  const p = cur.PRODUCTS.find(x => String(x.id) === params.id); need(p, 404, '상품을 찾지 못했습니다');
  const b = base.PRODUCTS.find(x => x.id === p.id), o = cur.OPT.of(p), ob = b && base.OPT.of(b);
  return { product: Object.fromEntries(['id', 'cat', ...EDITABLE].map(k => [k, p[k] ?? ''])), opts: o ? JSON.parse(JSON.stringify(o)) : null, optsBase: ob ? JSON.parse(JSON.stringify(ob)) : null,
    optsChanged: canon(o || null) !== canon(ob || null), priceByOpts: !!(o && o.groups.some(g => g.price)) };
});
route('POST', '/api/admin/products/:id', 'client', async ({ params, data, user }) => {
  const { base, site, cur } = await products(true);
  const b = base.PRODUCTS.find(x => String(x.id) === params.id); need(b, 404, '상품을 찾지 못했습니다');
  const co = cur.OPT.of(cur.PRODUCTS.find(x => x.id === b.id));
  const f = data.product || {}, files = [];
  const imgs = [];
  for (const it of f.imgs || []) {
    if (it && it.data) { const img = decodeImage(it.data), p = `assets/img/products/${b.id}/up-${stamp()}${imgs.length}.${img.ext}`; files.push({ path: p, base64: img.base64 }); imgs.push(p); }
    else if (typeof it === 'string' && /^assets\/img\/[\w\-./]+\.(jpe?g|png|webp|gif)$/i.test(it)) imgs.push(it);
  }
  need(imgs.length, 400, '대표 사진이 한 장은 있어야 합니다');
  const next = { name: oneLine(f.name), short: oneLine(f.short), summary: oneLine(f.summary), list: Math.round(+f.list || 0), price: Math.round(+f.price || 0),
    badges: (f.badges || []).map(oneLine).filter(Boolean).slice(0, 4), points: (f.points || []).map(oneLine).filter(Boolean).slice(0, 8), imgs, store: oneLine(f.store),
    rating: Math.round(+f.rating * 100) / 100, reviews: Math.round(+f.reviews) };
  need(next.name && next.short, 400, '상품명과 짧은 이름을 입력해 주세요');
  need(next.rating >= 0 && next.rating <= 5, 400, '평점은 0~5 사이 숫자로 넣어 주세요');
  need(next.reviews >= 0 && next.reviews < 1e7, 400, '구매평 수를 숫자로 넣어 주세요');
  need(!next.store || /^https:\/\/smartstore\.naver\.com\//.test(next.store), 400, '스토어 링크는 스마트스토어 주소만');
  if (co && co.groups.some(g => g.price)) { delete next.price; delete next.list; }   // 옵션 가격표가 있으면 대표 가격은 거기서(가장 싼 조합)
  else need(next.price > 0 && next.list >= next.price, 400, '판매가는 0보다 크고 정가 이하여야 합니다');
  const ov = {}; for (const [k, v] of Object.entries(next)) if (JSON.stringify(v) !== JSON.stringify(b[k] ?? (Array.isArray(v) ? [] : ''))) ov[k] = v;
  site.products = site.products || {};
  if (Object.keys(ov).length) site.products[b.id] = ov; else delete site.products[b.id];
  files.push({ path: 'content/site.json', text: JSON.stringify(site, null, 2) + '\n' });
  const c = await store.commit(files, msg(user, `상품 정보 수정 「${b.short}」`), user.name);
  return { ok: true, commit: c.sha };
});

// 상품 옵션(사이즈·두께·색상 등 묶음과 선택지, 조합별 판매가·정가·품절) — content/site.json 의 opts.<상품>(처음 값과 다를 때만, null = 옵션 없음)
route('POST', '/api/admin/products/:id/options', 'client', async ({ params, data, user }) => {
  const { base, site, cur } = await products(true);
  const b = base.PRODUCTS.find(x => String(x.id) === params.id); need(b, 404, '상품을 찾지 못했습니다');
  const p = cur.PRODUCTS.find(x => x.id === b.id), ob = base.OPT.of(b) || null;
  site.opts = site.opts || {};
  if (data.reset) delete site.opts[b.id];
  else {
    const o = cleanOpts(data.opts, p);
    if (!(o && o.groups.some(g => g.price))) need(p.price > 0 || (b.price > 0), 400, '가격이 달라지는 묶음이 없으면 기본 정보의 판매가로 팝니다. 판매가를 먼저 넣어 주세요');
    if (canon(o) === canon(ob)) delete site.opts[b.id]; else site.opts[b.id] = o;
  }
  if (b.id === 29) delete site.options29;   // 예전 3단 가격표 저장 형식은 옵션 가격표로 옮겨졌다
  if (!Object.keys(site.opts).length) delete site.opts;
  const c = await store.commit([{ path: 'content/site.json', text: JSON.stringify(site, null, 2) + '\n' }], msg(user, `상품 옵션 ${data.reset ? '처음 값으로' : '수정'} 「${b.short}」`), user.name);
  return { ok: true, commit: c.sha };
});

// 상세페이지
route('GET', '/api/admin/detail/:id', 'client', async ({ params }) => {
  need(/^\d+$/.test(params.id), 400, '상품 번호 오류');
  const t = await readText(detailPath(params.id));
  return { items: t ? parseDetail(t).items : [] };
});
route('POST', '/api/admin/detail/:id', 'client', async ({ params, data, user }) => {
  need(/^\d+$/.test(params.id), 400, '상품 번호 오류');
  const { cur } = await products(); const p = cur.PRODUCTS.find(x => String(x.id) === params.id); need(p, 404, '상품을 찾지 못했습니다');
  const t = await readText(detailPath(params.id), true);
  const prev = t ? parseDetail(t) : { head: `/* 상품 ${params.id} 상세 — 어드민에서 만든 상세. 빌드 전용 데이터(build.mjs detailHTML). */\n`, items: [] };
  const okSrc = s => typeof s === 'string' && /^assets\/(img|video)\/[\w\-./가-힣]+\.(jpe?g|png|webp|gif|mp4)$/i.test(s);
  const files = [], items = [];
  for (const it of data.items || []) {
    if (it.t === 't') { const lines = (Array.isArray(it.text) ? it.text : String(it.text || '').split('\n')).map(oneLine).filter(Boolean); if (lines.length) items.push({ t: 't', text: lines }); continue; }
    if (it.data) {
      const img = decodeImage(it.data), src = `assets/img/detail/${params.id}/up-${stamp()}${items.length}.${img.ext}`;
      need(+it.w > 0 && +it.h > 0, 400, '사진 크기를 읽지 못했습니다'); files.push({ path: src, base64: img.base64 });
      items.push({ t: 'i', src, w: Math.round(+it.w), h: Math.round(+it.h), alt: oneLine(it.alt) }); continue;
    }
    const old = prev.items.find(x => x.src === it.src && x.t === it.t) || (it.t === 'y' && prev.items.find(x => x.t === 'y' && x.id === it.id));
    need(old && (it.t === 'y' || okSrc(old.src)), 400, '알 수 없는 상세 항목이 있습니다');
    items.push(it.t === 'i' ? { ...old, alt: oneLine(it.alt) } : old);
  }
  need(items.some(x => x.t !== 't'), 400, '상세에는 사진이나 영상이 한 개는 있어야 합니다');
  const head = prev.head.replace(/\n?\/\/ 어드민 마지막 수정:.*\n?$/, '\n') + `// 어드민 마지막 수정: ${kst()} ${user.name}\n`;
  files.push({ path: detailPath(params.id), text: `${head.replace(/\n+$/, '\n')}(window.DETAIL = window.DETAIL || {})[${params.id}] = ${JSON.stringify(items)};\n` });
  const c = await store.commit(files, msg(user, `상세페이지 수정 「${p.short}」 (${items.length}개 항목)`), user.name);
  return { ok: true, commit: c.sha };
});

// ── 사이트 꾸미기: 목록(blocks.mjs)·페이지 문구·사진(edits.mjs)·상품정보 제공고시 — 모두 content/site.json 한 파일에 '바뀐 것만'
const SITE_JSON = 'content/site.json';
const saveSite = (site, files, user, what) => {
  for (const k of ['blocks', 'text', 'img', 'notice']) if (site[k] && !Object.keys(site[k]).length) delete site[k];
  files.push({ path: SITE_JSON, text: JSON.stringify(site, null, 2) + '\n' });
  return store.commit(files, msg(user, what), user.name);
};
// 사진 올리기: data:image → assets/img/up/<앞머리>-<시각><번호>.<확장자>. 이미 있는 주소는 형식만 검사
function imageSaver(files, prefix, ctx) {
  let i = 0;
  return (v, f, label) => {
    const base = (f && f.base) || '';
    if (v && typeof v === 'object' && v.data) {
      const img = decodeImage(v.data), p = `assets/img/up/${prefix}-${stamp()}${i++}.${img.ext}`;
      files.push({ path: p, base64: img.base64 });
      if (ctx && f && f.sizeKey) ctx.lastSize = Math.round(+v.w) || 0;
      return p.slice(base.length);
    }
    const s = typeof v === 'string' ? v : (v && v.src) || '';
    need(IMG_PATH.test(base + s), 400, `${label || '사진'}: 사진을 골라 주세요`);
    return s;
  };
}
route('GET', '/api/admin/blocks/:name', 'client', async ({ params }) => {
  const def = BLOCKS[params.name]; need(def, 404, '없는 항목');
  const { base, cur, site } = await products();
  return { name: params.name, def, menu: MENUS[def.menu], value: cur[params.name], base: base[params.name], changed: !!(site.blocks || {})[params.name],
    products: cur.PRODUCTS.map(p => ({ id: p.id, short: p.short })), icons: ICONS, siblings: Object.entries(BLOCKS).filter(([, d]) => d.menu === def.menu).map(([k, d]) => ({ name: k, label: d.label, changed: !!(site.blocks || {})[k] })) };
});
route('POST', '/api/admin/blocks/:name', 'client', async ({ params, data, user }) => {
  const def = BLOCKS[params.name]; need(def, 404, '없는 항목');
  const { base, site } = await products(true), files = [];
  const ctx = { products: base.PRODUCTS.map(p => p.id), lastSize: 0 };
  ctx.image = imageSaver(files, params.name.toLowerCase().replace(/_/g, '-'), ctx);
  site.blocks = site.blocks || {};
  if (data.reset) delete site.blocks[params.name];
  else {
    const v = await cleanBlock(params.name, data.value, ctx);
    let same = false;   // 기본값과 같으면 저장하지 않는다(data.js 를 고치면 그대로 따라가게)
    try { same = JSON.stringify(v) === JSON.stringify(await cleanBlock(params.name, base[params.name], { ...ctx, image: imageSaver([], 'x') })); } catch { /* 기본값이 정의와 다르면 다르게 본다 */ }
    if (same) delete site.blocks[params.name]; else site.blocks[params.name] = v;
  }
  const c = await saveSite(site, files, user, `${MENUS[def.menu]} · ${def.label} ${data.reset ? '처음 값으로 되돌림' : '수정'}`);
  return { ok: true, commit: c.sha };
});
// 페이지 문구·사진
route('GET', '/api/admin/texts', 'client', async () => {
  const site = await readJson(SITE_JSON, {}), T = site.text || {}, I = site.img || {};
  const files = [];
  for (const f of EDIT_FILES) {
    const items = listEdits(await readText(f.file) || '');
    files.push({ key: f.key, label: f.label, page: f.page, count: items.length, changed: items.filter(x => (x.kind === 'img' ? I : T)[x.key] != null).length });
  }
  return { files };
});
route('GET', '/api/admin/texts/:file', 'client', async ({ params }) => {
  const f = EDIT_FILES.find(x => x.key === params.file); need(f, 404, '없는 페이지');
  const site = await readJson(SITE_JSON, {}), T = site.text || {}, I = site.img || {};
  const items = listEdits(await readText(f.file) || '').map(x => x.kind === 'img' ? { ...x, cur: I[x.key] || null } : { ...x, cur: T[x.key] ?? null });
  return { file: { key: f.key, label: f.label, page: f.page }, items };
});
route('POST', '/api/admin/texts/:file', 'client', async ({ params, data, user }) => {
  const f = EDIT_FILES.find(x => x.key === params.file); need(f, 404, '없는 페이지');
  const byKey = new Map(listEdits(await readText(f.file) || '').map(x => [x.key, x]));
  const site = await readJson(SITE_JSON, {}, true), files = [], save = imageSaver(files, `txt-${f.key}`);
  site.text = site.text || {}; site.img = site.img || {};
  let n = 0;
  for (const [k, v] of Object.entries(data.text || {})) {
    const it = byKey.get(k); need(it && it.kind === 'text', 400, '이 페이지에 없는 칸이 있습니다');
    const t = v == null ? '' : normText(v); need([...t].length <= 3000, 400, '한 칸은 3,000자 이내로 적어 주세요');
    if (!t || t === it.text) delete site.text[k]; else site.text[k] = t;
    n++;
  }
  for (const [k, v] of Object.entries(data.img || {})) {
    const it = byKey.get(k); need(it && it.kind === 'img', 400, '이 페이지에 없는 사진 칸이 있습니다');
    n++;
    if (v == null) { delete site.img[k]; continue; }
    const src = save(v.data ? v : (v.src || ''), null, '사진'), alt = oneLine(v.alt).slice(0, 120);
    if (src === it.src && (!alt || alt === it.alt)) delete site.img[k];
    else site.img[k] = { src, w: Math.round(+v.w) || it.w, h: Math.round(+v.h) || it.h, ...(alt && alt !== it.alt ? { alt } : {}) };
  }
  need(n, 400, '바꾼 내용이 없습니다');
  const c = await saveSite(site, files, user, `페이지 문구·사진 수정 「${f.label}」 ${n}칸`);
  return { ok: true, commit: c.sha };
});
// 상품정보 제공고시(상품 페이지 아래 표): [항목, [줄…]] 목록
route('GET', '/api/admin/notice/:id', 'client', async ({ params }) => {
  need(/^\d+$/.test(params.id), 400, '상품 번호 오류');
  const { base, cur, site } = await products();
  return { rows: cur.NOTICE[params.id] || [], base: base.NOTICE[params.id] || [], changed: !!(site.notice || {})[params.id] };
});
route('POST', '/api/admin/notice/:id', 'client', async ({ params, data, user }) => {
  need(/^\d+$/.test(params.id), 400, '상품 번호 오류');
  const { base, site } = await products(true);
  const p = base.PRODUCTS.find(x => String(x.id) === params.id); need(p, 404, '상품을 찾지 못했습니다');
  site.notice = site.notice || {};
  if (data.reset) delete site.notice[params.id];
  else {
    const rows = (Array.isArray(data.rows) ? data.rows : []).map(r => [oneLine(r && r[0]), (Array.isArray(r && r[1]) ? r[1] : String((r && r[1]) || '').split('\n')).map(oneLine).filter(Boolean)]).filter(r => r[0] || r[1].length);
    need(rows.length <= 25, 400, '항목은 25개까지');
    for (const [t, lines] of rows) { need(t && [...t].length <= 40, 400, '항목 이름을 40자 이내로 적어 주세요'); need(lines.length && lines.length <= 12 && lines.every(l => [...l].length <= 400), 400, `「${t}」 내용을 적어 주세요(한 줄 400자, 12줄 이내)`); }
    if (JSON.stringify(rows) === JSON.stringify(base.NOTICE[params.id] || [])) delete site.notice[params.id]; else site.notice[params.id] = rows;
  }
  const c = await saveSite(site, [], user, `상품정보 제공고시 ${data.reset ? '처음 값으로 되돌림' : '수정'} 「${p.short}」`);
  return { ok: true, commit: c.sha };
});

// ── 관리자 전용
route('GET', '/api/admin/settings', 'owner', async () => ({ tags: await readJson('src/site-tags.json', {}) }));
route('POST', '/api/admin/settings', 'owner', async ({ data, user }) => {
  const cur = await readJson('src/site-tags.json', {}, true), next = { ...cur };
  for (const k of ['naverSiteVerification', 'googleSiteVerification', 'bingSiteVerification', 'gtm', 'ga4', 'naverAnalytics']) {
    const v = oneLine((data.tags || {})[k]); need(!v || /^[\w-]+$/.test(v), 400, `${k}: 영문·숫자·-·_ 만`); next[k] = v;
  }
  const c = await store.commit([{ path: 'src/site-tags.json', text: JSON.stringify(next, null, 2) + '\n' }], msg(user, '소유확인·추적 코드 설정 변경'), user.name);
  return { ok: true, commit: c.sha };
});
route('GET', '/api/admin/topics', 'owner', async () => ({ topics: await readJson(`${POST_DIR}/_topics.json`, []) }));
route('POST', '/api/admin/topics', 'owner', async ({ data, user }) => {
  const list = data.topics; need(Array.isArray(list), 400, '형식 오류');
  const seen = new Set();
  const out = list.map(t => {
    const id = oneLine(t.id) || `topic-${stamp()}`; need(/^[a-z0-9-]+$/.test(id), 400, `주제 id 형식 오류: ${id}`); need(!seen.has(id), 400, `주제 id 중복: ${id}`); seen.add(id);
    need(oneLine(t.keyword) && oneLine(t.title), 400, '주제마다 대표 키워드와 가제가 필요합니다');
    return { ...t, id, keyword: oneLine(t.keyword), title: oneLine(t.title), category: CATEGORIES.includes(t.category) ? t.category : CATEGORIES[0], status: t.status === 'done' ? 'done' : 'todo' };
  });
  const c = await store.commit([{ path: `${POST_DIR}/_topics.json`, text: JSON.stringify(out, null, 1) + '\n' }], msg(user, `자동 발행 대기열 수정(남은 주제 ${out.filter(t => t.status === 'todo').length}편)`), user.name);
  return { ok: true, commit: c.sha };
});
// 키워드 점검(매일 PC 에서 도는 keyword-check 와 같은 기준의 간단판)
route('GET', '/api/admin/check', 'owner', async () => {
  const posts = (await listPosts()).filter(p => !p.draft), topics = await readJson(`${POST_DIR}/_topics.json`, []);
  const warn = [], kws = new Map();
  for (const p of posts) { if (!p.keyword) continue; if (kws.has(p.keyword)) warn.push(`대표 키워드 중복 「${p.keyword}」: ${kws.get(p.keyword)} · ${p.title}`); else kws.set(p.keyword, p.title); }
  for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++) { const s = similar(posts[i].title || '', posts[j].title || ''); if (s >= 0.5) warn.push(`제목이 비슷함(${s.toFixed(2)}): ${posts[i].title} · ${posts[j].title}`); }
  const todo = topics.filter(t => t.status === 'todo');
  for (const t of todo) if (kws.has(t.keyword)) warn.push(`대기열 「${t.keyword}」이 이미 발행된 키워드와 같음`);
  const last = posts.map(p => p.date).filter(Boolean).sort().pop();
  return { warn, posts: posts.length, todo: todo.length, last };
});
// ── 결제 주문(홈페이지 결제, tools/pay/seedpay.mjs) — 주문은 DATA_DIR 에 있고 GitHub 저장소와 상관없다
// 잠스쿨 관리자에게는 주문·결제 켜짐 여부만(상점 ID·결제통보·중계·알림 설정은 총괄 관리자만)
route('GET', '/api/admin/payments', 'client', async ({ query, user }) => {
  const owner = user.role === 'owner', st = PAY.adminStatus();
  const base = { enabled: st.enabled, canCancel: owner, orders: PAY.listOrders({ all: query.get('all') === '1', from: query.get('from') || '', to: query.get('to') || '' }), todo: PAY.todoCount(),
    formats: Object.entries(SHIP_FORMATS).map(([k, f]) => [k, f.label]), since: ordersSince() };
  return owner ? { ...st, ...base, notify: NOTIFY.notifyStatus() } : base;
});
// 고른 결제 완료 주문: 발송 처리 한꺼번에 / 택배사·3PL 엑셀
route('POST', '/api/admin/payments-ship', 'client', async ({ data, user }) => PAY.shipMany(data.moids, data.status === 'new' ? 'new' : 'shipped', user));
route('POST', '/api/admin/payments-export', 'client', async ({ data, user }) => {
  const orders = PAY.ordersForExport(data.moids), f = shipExport(orders, String(data.format || ''));
  console.log(`[admin] 발송 엑셀 ${user.id} ${data.format} ${orders.length}건`);
  return { __file: f };
});
// 시험 기록 정리(총괄 관리자): 결제 주문은 보관 폴더로, 주문 흐름은 오늘부터 새로
route('POST', '/api/admin/payments-reset', 'owner', async ({ data, user }) => {
  need(data.confirm === '정리', 400, '확인 문구가 맞지 않습니다');
  statsFlush();
  const a = PAY.archiveOrders(user), s = resetOrderStats(user.id);
  console.log(`[admin] 시험 기록 정리 ${user.id}: 주문 ${a.archived}건 보관, 주문 흐름 ${s.since}부터`);
  return { ok: true, ...a, ...s };
});
// 주문 알림(텔레그램) 시험 — 대화방 ID 가 없으면 봇에게 말을 건 대화방을 찾아 준다(tools/pay/notify.mjs)
route('POST', '/api/admin/payments-notify-test', 'owner', async ({ user }) => NOTIFY.notifyTest(user));
// 결제 서버 연결 점검 — 이 서버의 나가는 IP·나라, 씨드 승인 주소가 받아 주는지(403 이면 씨드가 이 서버 IP 를 막음)
route('GET', '/api/admin/payments-probe', 'owner', async () => PAY.pgProbe());
route('GET', '/api/admin/payments/:moid', 'client', async ({ params, user }) => ({ order: PAY.getOrderAdmin(params.moid), canCancel: user.role === 'owner' }));
route('POST', '/api/admin/payments/:moid/fulfil', 'client', async ({ params, data, user }) => ({ order: PAY.setFulfil(params.moid, data.status, user) }));
route('POST', '/api/admin/payments/:moid/cancel', 'owner', async ({ params, data, user }) => ({ order: await PAY.cancelOrder(params.moid, data.reason, user) }));
route('POST', '/api/admin/payments-settings', 'owner', async ({ data, user }) => {
  // 켜기 전에 씨드 승인 서버에 닿는지 확인 — 막혀 있으면 켜지 않는다(카드 인증 뒤 승인 실패 주문 방지)
  if (data.enabled) { const p = await PAY.pgProbe(); need(p.verdict === 'ok', 400, p.via === 'relay' ? `중계 서버 이상(${(p.relay && p.relay.error) || '응답 없음'})이라 켤 수 없습니다. '결제 서버 연결 점검'을 확인해 주세요.` : '씨드 승인 서버가 이 서버를 막고 있어(HTTP 403) 켤 수 없습니다. 한국 중계 서버(SEEDPAY_RELAY_*)를 먼저 연결해 주세요.'); }
  return PAY.setSettings({ enabled: !!data.enabled }, user);
});
// ── 데이터 옮기기(Railway 볼륨 DATA_DIR ↔ 파일 한 개) — tools/admin/backup.mjs
const reqHost = req => String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
route('GET', '/api/admin/data', 'owner', async ({ req }) => BACKUP.volumeInfo(reqHost(req)));
route('POST', '/api/admin/data-export', 'owner', async ({ req }) => { statsFlush(); return BACKUP.exportBundle(reqHost(req)); });
route('POST', '/api/admin/data-import', 'owner', async ({ data, user }) => {
  const r = BACKUP.importBundle(data.bundle, { before: statsFlush });
  statsForget();
  console.log(`[admin] 데이터 가져오기 ${user.id}: 파일 ${r.written}개(덮어씀 ${r.replaced})`);
  return r;
});
route('GET', '/api/admin/log', 'owner',async () => ({ commits: await store.recent(30) }));
route('GET', '/api/admin/users', 'owner', async () => ({ users: loadUsers().map(u => ({ id: u.id, name: u.name, role: u.role, roleName: ROLES[u.role] })), canWrite: canWriteUsers() }));
route('POST', '/api/admin/users', 'owner', async ({ data, user }) => {
  const list = loadUsers(), act = data.action, id = oneLine(data.id);
  if (act === 'create') {
    need(/^[a-z0-9_.-]{3,20}$/.test(id), 400, '아이디는 영문 소문자·숫자 3~20자'); need(!list.some(u => u.id === id), 400, '이미 있는 아이디');
    const pw = newPassword(); list.push({ id, name: oneLine(data.name) || id, role: data.role === 'owner' ? 'owner' : 'client', hash: hashPassword(pw), created: kst() }); saveUsers(list);
    return { ok: true, password: pw };
  }
  const u = list.find(x => x.id === id); need(u, 404, '계정을 찾지 못했습니다');
  if (act === 'reset') { const pw = newPassword(); u.hash = hashPassword(pw); u.changed = kst(); saveUsers(list); return { ok: true, password: pw }; }
  if (act === 'delete') { need(u.id !== user.id, 400, '내 계정은 지울 수 없습니다'); saveUsers(list.filter(x => x.id !== id)); return { ok: true }; }
  throw new HttpError(400, '알 수 없는 요청');
});
route('POST', '/api/admin/me/password', 'client', async ({ data, user }) => {
  const r = login(user.id, data.current, 'pw:' + user.id); need(r.user, 400, '지금 비밀번호가 맞지 않습니다');
  const next = String(data.next || ''); need(next.length >= 10 && /[a-zA-Z]/.test(next) && /\d/.test(next), 400, '새 비밀번호는 10자 이상, 영문과 숫자를 섞어 주세요');
  const list = loadUsers(); const u = list.find(x => x.id === user.id); u.hash = hashPassword(next); u.changed = kst(); saveUsers(list);
  return { ok: true };
});

// ── 진입점: 처리했으면 true
export async function handleAdmin(req, res) {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  if (p === '/admin' || p.startsWith('/admin/')) { if (req.method === 'GET' || req.method === 'HEAD') { serveStatic(req, res, p); return true; } return false; }
  if (!p.startsWith('/api/admin/')) return false;
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https');
  try {
    if (p === '/api/admin/login' && req.method === 'POST') {
      need(req.headers['x-jam-admin'] === '1', 403, '잘못된 요청');
      need(ready(), 503, '어드민 초기 설정이 필요합니다(계정·SESSION_SECRET)');
      const d = await body(req);
      const r = login(d.id, d.pw, clientIp(req));
      if (r.error) return send(res, 401, { error: r.error }), true;
      send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(r.cookie, secure) }); return true;
    }
    if (p === '/api/admin/logout' && req.method === 'POST') { send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', secure) }); return true; }
    const user = sessionUser(req.headers.cookie);
    for (const r of routes) {
      const m = r.method === req.method && p.match(r.re); if (!m) continue;
      if (r.role) {
        need(user, 401, '로그인이 필요합니다');
        need(r.role === 'client' || user.role === 'owner', 403, '관리자만 쓸 수 있는 메뉴입니다');
      }
      if (req.method !== 'GET') need(req.headers['x-jam-admin'] === '1', 403, '잘못된 요청');
      if (r.role && req.method !== 'GET' && !p.startsWith('/api/admin/me') && p !== '/api/admin/preview' && p !== '/api/admin/users' && !p.startsWith('/api/admin/payments') && !p.startsWith('/api/admin/data')) need(store.ready(), 503, '저장소(GitHub) 연결이 안 되어 있습니다 — Railway 변수 GITHUB_TOKEN');
      const data = req.method === 'GET' ? {} : await body(req);
      const out = await r.fn({ req, user, data, params: m.groups || {}, query: url.searchParams }) || { ok: true };
      if (out.__file) {   // 내려받을 파일(발송 엑셀)
        res.writeHead(200, { 'Content-Type': out.__file.type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(out.__file.name)}`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
        res.end(out.__file.buf); return true;
      }
      send(res, 200, out); return true;
    }
    send(res, 404, { error: '없는 요청' }); return true;
  } catch (e) {
    const status = e.status && e.status < 600 ? e.status : 500;
    if (status >= 500) console.error('[admin]', e);
    send(res, status, { error: status >= 500 && !(e instanceof HttpError) ? `처리 중 오류: ${e.message}` : e.message, ...(e.extra || {}) }); return true;
  }
}
