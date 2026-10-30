// 잠스쿨 관리자 어드민(/admin) — tools/serve.mjs 가 요청을 먼저 여기로 넘긴다
//   화면: tools/admin/public/ (로그인 → 블로그·상품·상세페이지, 관리자 전용 메뉴)
//   API : /api/admin/* (쿠키 로그인, 쓰기 요청은 X-Jam-Admin 헤더 필수 — 다른 사이트에서 몰래 보내는 요청 차단)
//   저장: store.mjs (운영 = GitHub 커밋 → 자동 재배포, 로컬 = 파일 직접 + 빌드)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { ROLES, canWriteUsers, cookieHeader, hashPassword, loadUsers, login, newPassword, ready, saveUsers, sessionUser } from './auth.mjs';
import { makeStore } from './store.mjs';
import { summary as statsSummary } from './stats.mjs';
import { parseFrontmatter, renderMarkdown } from '../blog/lib.mjs';
import { CATEGORIES, checkPost, similar } from '../blog-ai/rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PUB = path.join(HERE, 'public');
const store = makeStore(ROOT);
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
async function readText(p) { const f = await store.read(p); return f ? f.text : null; }
async function readJson(p, def) { const t = await readText(p); return t ? JSON.parse(t) : def; }
function evalData(src, overrides) {
  const ctx = { window: { WEBP: new Set(), JAM_OVERRIDES: overrides || {} }, console };
  ctx.globalThis = ctx.window; vm.createContext(ctx);
  vm.runInContext(src.replace(/typeof window !== 'undefined' \? window : globalThis/, 'window'), ctx);
  return ctx.window.JAM;
}
async function products() {
  const src = await readText('assets/js/data.js');
  const site = await readJson('content/site.json', { products: {}, options29: {} });
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
function serveStatic(req, res, p) {
  const rel = p.replace(/^\/admin\/?/, '') || 'index.html';
  const file = path.join(PUB, path.normalize(rel));
  const target = file.startsWith(PUB + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(PUB, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
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
  return { ...statsSummary(n), names: Object.fromEntries(cur.PRODUCTS.map(p => [p.id, p.short])), titles: Object.fromEntries(posts.map(p => [`/blog/${p.slug}`, p.title])) };
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
const EDITABLE = ['name', 'short', 'summary', 'list', 'price', 'badges', 'points', 'imgs', 'store'];
route('GET', '/api/admin/products', 'client', async () => {
  const { cur } = await products();
  return { products: cur.PRODUCTS.map(p => ({ id: p.id, name: p.name, short: p.short, price: p.price, list: p.list, img: p.imgs[0], full: !!p.full })) };
});
route('GET', '/api/admin/products/:id', 'client', async ({ params }) => {
  const { cur } = await products();
  const p = cur.PRODUCTS.find(x => String(x.id) === params.id); need(p, 404, '상품을 찾지 못했습니다');
  return { product: Object.fromEntries(['id', 'cat', ...EDITABLE, 'full'].map(k => [k, p[k] ?? ''])), options29: p.id === 29 ? { price: cur.OPTIONS_29.price, list: cur.OPTIONS_29.list, size: cur.OPTIONS_29.size, thickness: cur.OPTIONS_29.thickness } : null };
});
route('POST', '/api/admin/products/:id', 'client', async ({ params, data, user }) => {
  const { base, site } = await products();
  const b = base.PRODUCTS.find(x => String(x.id) === params.id); need(b, 404, '상품을 찾지 못했습니다');
  const f = data.product || {}, files = [];
  const imgs = [];
  for (const it of f.imgs || []) {
    if (it && it.data) { const img = decodeImage(it.data), p = `assets/img/products/${b.id}/up-${stamp()}${imgs.length}.${img.ext}`; files.push({ path: p, base64: img.base64 }); imgs.push(p); }
    else if (typeof it === 'string' && /^assets\/img\/[\w\-./]+\.(jpe?g|png|webp|gif)$/i.test(it)) imgs.push(it);
  }
  need(imgs.length, 400, '대표 사진이 한 장은 있어야 합니다');
  const next = { name: oneLine(f.name), short: oneLine(f.short), summary: oneLine(f.summary), list: Math.round(+f.list || 0), price: Math.round(+f.price || 0),
    badges: (f.badges || []).map(oneLine).filter(Boolean).slice(0, 4), points: (f.points || []).map(oneLine).filter(Boolean).slice(0, 8), imgs, store: oneLine(f.store) };
  need(next.name && next.short, 400, '상품명과 짧은 이름을 입력해 주세요');
  need(!next.store || /^https:\/\/smartstore\.naver\.com\//.test(next.store), 400, '스토어 링크는 스마트스토어 주소만');
  if (b.full) { delete next.price; delete next.list; }   // 3단은 옵션 가격표에서 정한다
  else need(next.price > 0 && next.list >= next.price, 400, '판매가는 0보다 크고 정가 이하여야 합니다');
  const ov = {}; for (const [k, v] of Object.entries(next)) if (JSON.stringify(v) !== JSON.stringify(b[k] ?? (Array.isArray(v) ? [] : ''))) ov[k] = v;
  site.products = site.products || {};
  if (Object.keys(ov).length) site.products[b.id] = ov; else delete site.products[b.id];
  if (b.full && data.options29) {
    const o = {}; for (const k of ['price', 'list']) { o[k] = {}; for (const [key, v] of Object.entries(data.options29[k] || {})) if (key in base.OPTIONS_29[k] && +v > 0 && +v !== base.OPTIONS_29[k][key]) o[k][key] = Math.round(+v); }
    for (const key of Object.keys(base.OPTIONS_29.price)) { const pr = +(data.options29.price || {})[key] || base.OPTIONS_29.price[key], li = +(data.options29.list || {})[key] || base.OPTIONS_29.list[key]; need(pr <= li, 400, `옵션 ${key}: 판매가가 정가보다 큽니다`); }
    site.options29 = Object.fromEntries(Object.entries(o).filter(([, v]) => Object.keys(v).length));
  }
  files.push({ path: 'content/site.json', text: JSON.stringify(site, null, 2) + '\n' });
  const c = await store.commit(files, msg(user, `상품 정보 수정 「${b.short}」`), user.name);
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
  const t = await readText(detailPath(params.id));
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

// ── 관리자 전용
route('GET', '/api/admin/settings', 'owner', async () => ({ tags: await readJson('src/site-tags.json', {}) }));
route('POST', '/api/admin/settings', 'owner', async ({ data, user }) => {
  const cur = await readJson('src/site-tags.json', {}), next = { ...cur };
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
route('GET', '/api/admin/log', 'owner', async () => ({ commits: await store.recent(30) }));
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
      const r = login(d.id, d.pw, String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim());
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
      if (r.role && req.method !== 'GET' && !p.startsWith('/api/admin/me') && p !== '/api/admin/preview' && p !== '/api/admin/users') need(store.ready(), 503, '저장소(GitHub) 연결이 안 되어 있습니다 — Railway 변수 GITHUB_TOKEN');
      const data = req.method === 'GET' ? {} : await body(req);
      send(res, 200, await r.fn({ user, data, params: m.groups || {}, query: url.searchParams }) || { ok: true }); return true;
    }
    send(res, 404, { error: '없는 요청' }); return true;
  } catch (e) {
    const status = e.status && e.status < 600 ? e.status : 500;
    if (status >= 500) console.error('[admin]', e);
    send(res, status, { error: status >= 500 && !(e instanceof HttpError) ? `처리 중 오류: ${e.message}` : e.message, ...(e.extra || {}) }); return true;
  }
}
