// 페이지 문구·사진 편집 — 템플릿(src/**/*.html)에 붙인 표시를 읽고, 어드민이 고친 값을 빌드 때 덮어쓴다
//   글자: <h2 data-edit="home-012">…</h2>   → content/site.json 의 text["home-012"] (편집용 글)
//   사진: <img data-edit-img="home-img-1" src="assets/img/…"> → img["home-img-1"] = { src, w, h, alt }
//   편집용 글 규칙: 줄바꿈 = <br>, **글자** = 굵게(<b>), ==글자== = 강조(<em>). 그 밖의 태그는 쓸 수 없다(자동으로 글자로 바뀜)
//   요소 안의 아이콘(svg)·작은 글씨(span) 같은 부속은 앞뒤에 그대로 두고, 가운데 '글' 부분만 바꾼다(splitCore)
//   표시 붙이기: node tools/admin/mark-edits.mjs (새로 생긴 문구에만 번호를 이어서 붙인다)
//   쓰는 곳: build.mjs(적용·표시 지우기), tools/admin/server.mjs(목록·저장), mark-edits.mjs

// 편집 대상 파일: key = 표시 앞머리, label = 어드민에 보이는 이름, page = 사이트에서 볼 주소
export const EDIT_FILES = [
  { key: 'home', file: 'src/index.tpl.html', label: '홈(첫 화면)', page: '/' },
  { key: 'bento', file: 'src/partials/bento.html', label: '홈 · 이래서 잠스쿨을 고릅니다(카드)', page: '/#why' },
  { key: 'header', file: 'src/partials/header.html', label: '머리글·메뉴', page: '/' },
  { key: 'footer', file: 'src/partials/footer.html', label: '바닥글(회사 정보)', page: '/' },
  { key: 'layers', file: 'src/partials/layers.html', label: '팝업·검색·장바구니 창', page: '/' },
  { key: 'product', file: 'src/product.tpl.html', label: '상품 페이지 공통', page: '/product-29.html' },
  { key: 'pdtrust', file: 'src/partials/pd-trust.html', label: '상품 페이지 · 가격 아래 배지(3단)', page: '/product-29.html' },
  { key: 'pdev', file: 'src/partials/pd-events.html', label: '상품 페이지 · 진행 중인 혜택(3단)', page: '/product-29.html' },
  { key: 'ship', file: 'src/partials/ship.html', label: '상품 페이지 · 배송·교환·반품', page: '/product-29.html#ship' },
  { key: 'cart', file: 'src/pages/cart.html', label: '장바구니', page: '/cart.html' },
  { key: 'checkout', file: 'src/pages/checkout.html', label: '주문서', page: '/checkout.html' },
  { key: 'complete', file: 'src/pages/order-complete.html', label: '주문 완료', page: '/order-complete.html' },
  { key: 'blogidx', file: 'src/blog-index.tpl.html', label: '블로그 목록', page: '/blog/' },
  { key: 'blogpost', file: 'src/blog-post.tpl.html', label: '블로그 글 공통', page: '/blog/' },
  { key: 'terms', file: 'src/pages/terms.html', label: '이용약관', page: '/terms.html' },
  { key: 'privacy', file: 'src/pages/privacy.html', label: '개인정보처리방침', page: '/privacy.html' },
];

const SIMPLE = new Set(['br', 'b', 'strong', 'em']);
// 글 안에 둘 수 있는 태그: <br>, 속성 없는 <b>·<strong>·<em>(class 등이 붙은 것은 따로 꾸민 부속이라 앞뒤에 그대로 둔다)
const isSimple = n => n.type === 'el' && SIMPLE.has(n.tag) && (n.tag === 'br' || /^<(b|strong|em)>/i.test(n.s));
const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'source', 'hr', 'wbr', 'use', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'col', 'area', 'base', 'param', 'track', 'embed']);
const TAG_RE = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>|<!--[\s\S]*?-->/g;
const OPEN_RE = /^<([a-zA-Z][\w-]*)(?:\s+[\w:@.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/;

// 여는 태그 끝(openEnd)부터 같은 이름의 닫는 태그를 찾는다(같은 태그가 안에 또 있으면 깊이로 센다)
export function closeOf(html, tag, openEnd) {
  TAG_RE.lastIndex = openEnd; let depth = 1, m;
  const t = tag.toLowerCase();
  while ((m = TAG_RE.exec(html))) {
    if (m[0].startsWith('<!--') || (m[2] || '').toLowerCase() !== t) continue;
    if (m[1]) { if (--depth === 0) return { innerEnd: m.index, end: m.index + m[0].length }; }
    else if (!m[3] && !VOID.has(t)) depth++;
  }
  return null;
}
// 속성 이름=값 으로 요소를 찾는다 → { tag, start, openEnd, innerEnd, end, open }
export function findEl(html, attr, key, from = 0) {
  const at = html.indexOf(` ${attr}="${key}"`, from); if (at < 0) return null;
  const start = html.lastIndexOf('<', at); if (start < 0) return null;
  const om = html.slice(start).match(OPEN_RE); if (!om) return null;
  const openEnd = start + om[0].length;
  const tag = om[1].toLowerCase();
  if (VOID.has(tag)) return { tag, start, openEnd, innerEnd: openEnd, end: openEnd, open: html.slice(start, openEnd) };
  const c = closeOf(html, tag, openEnd); if (!c) return null;
  return { tag, start, openEnd, innerEnd: c.innerEnd, end: c.end, open: html.slice(start, openEnd) };
}
// 요소 안을 맨 위 단계 조각으로 나눈다: 글자 / 요소(통째) / 주석
function nodes(inner) {
  const out = []; let i = 0;
  while (i < inner.length) {
    if (inner.startsWith('<!--', i)) { const e = inner.indexOf('-->', i); const j = e < 0 ? inner.length : e + 3; out.push({ type: 'comment', s: inner.slice(i, j) }); i = j; continue; }
    const m = inner[i] === '<' && inner.slice(i).match(/^<([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/);
    if (m) {
      const tag = m[1].toLowerCase(), openEnd = i + m[0].length;
      if (m[2] || VOID.has(tag)) { out.push({ type: 'el', tag, s: m[0] }); i = openEnd; continue; }
      const c = closeOf(inner, tag, openEnd);
      if (!c) return null;   // 짝이 안 맞음 → 편집 안 함
      out.push({ type: 'el', tag, s: inner.slice(i, c.end), inner: inner.slice(openEnd, c.innerEnd) }); i = c.end; continue;
    }
    if (inner[i] === '<' && inner[i + 1] === '/') return null;   // 엉뚱한 닫는 태그
    const j = inner.indexOf('<', i + 1); const k = j < 0 ? inner.length : j;
    out.push({ type: 'text', s: inner.slice(i, k) }); i = k;
  }
  return out;
}
const simpleDeep = n => n.type === 'text' || (isSimple(n) && (n.inner == null || (nodes(n.inner) || [{ type: 'x' }]).every(x => x.type === 'text' || (x.type === 'el' && x.tag === 'br'))));
const HAS_WORD = /[가-힣A-Za-z]/;
// 앞뒤의 부속(아이콘·작은 글씨 등)과 가운데 글 부분으로 나눈다. 글 부분이 없거나 섞여 있으면 null
export function splitCore(inner) {
  if (/<!--@|\$\{|\{\{/.test(inner)) return null;   // 빌드가 채우는 자리(<!--@…-->, {{…}})가 있으면 편집 안 함
  const ns = nodes(inner); if (!ns) return null;
  const edge = n => n.type === 'comment' || (n.type === 'el' && !isSimple(n)) || (n.type === 'text' && !n.s.trim());
  let a = 0, b = ns.length;
  while (a < b && edge(ns[a])) a++;
  while (b > a && edge(ns[b - 1])) b--;
  const mid = ns.slice(a, b);
  if (!mid.length || !mid.every(simpleDeep)) return null;
  let core = mid.map(n => n.s).join('');
  let pre = ns.slice(0, a).map(n => n.s).join(''), post = ns.slice(b).map(n => n.s).join('');
  const lead = core.match(/^\s*/)[0], trail = core.match(/\s*$/)[0];
  core = core.slice(lead.length, core.length - trail.length); pre += lead; post = trail + post;
  if (!HAS_WORD.test(core.replace(/<[^>]*>/g, ''))) return null;
  return { pre, core, post };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', middot: '·', hellip: '…', ndash: '–', mdash: '—', times: '×', rarr: '→', larr: '←', copy: '©' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));
// 템플릿 HTML(글 부분) → 편집용 글
export function coreToText(core) {
  return decode(core.replace(/\s+/g, ' ')
    .replace(/\s*<br\b[^>]*>\s*/gi, '\n')
    .replace(/<\/?(?:b|strong)\b[^>]*>/gi, '**')
    .replace(/<\/?em\b[^>]*>/gi, '==')
    .replace(/<[^>]*>/g, '')).replace(/\*\*\*\*/g, '').replace(/====/g, '').trim();
}
const escHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// 편집용 글 → HTML
export function textToCore(text) {
  return escHtml(normText(text))
    .replace(/\*\*([^\n]+?)\*\*/g, '<b>$1</b>')
    .replace(/==([^\n]+?)==/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
    .replace(/ /g, '&nbsp;');   // 붙여 쓰기 칸(줄이 안 바뀌게)은 그대로 &nbsp; 로
}
export const normText = t => String(t ?? '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();

// 빌드: 고친 값 덮어쓰기
const IMG_OK = /^assets\/img\/[\w\-./가-힣]+\.(jpe?g|png|webp|gif|svg)$/i;
export function applyEdits(html, ov = {}) {
  for (const [key, val] of Object.entries(ov.text || {})) {
    let from = 0, el;
    while ((el = findEl(html, 'data-edit', key, from))) {   // 같은 조각이 한 파일에 두 번 들어가는 일은 없지만 안전하게 모두
      const sp = splitCore(html.slice(el.openEnd, el.innerEnd));
      if (!sp || typeof val !== 'string' || !normText(val)) { from = el.end; continue; }
      const next = sp.pre + textToCore(val) + sp.post;
      html = html.slice(0, el.openEnd) + next + html.slice(el.innerEnd);
      from = el.openEnd + next.length;
    }
  }
  for (const [key, v] of Object.entries(ov.img || {})) {
    const el = findEl(html, 'data-edit-img', key); if (!el || el.tag !== 'img' || !v || !IMG_OK.test(v.src || '')) continue;
    let tag = el.open.replace(/\ssrc="[^"]*"/, ` src="${escHtml(v.src)}"`);
    if (+v.w > 0 && +v.h > 0) tag = tag.replace(/\swidth="\d+"/, ` width="${Math.round(+v.w)}"`).replace(/\sheight="\d+"/, ` height="${Math.round(+v.h)}"`);
    if (typeof v.alt === 'string' && normText(v.alt)) tag = tag.replace(/\salt="[^"]*"/, ` alt="${escHtml(normText(v.alt).replace(/\n/g, ' '))}"`);
    html = html.slice(0, el.start) + tag + html.slice(el.openEnd);
  }
  return html;
}
export const stripEditAttrs = html => html.replace(/ data-edit(?:-img)?="[^"]*"/g, '');

// 어드민 목록: 파일 한 개의 편집 칸(기본값 = 템플릿 그대로)
const SEC_NAME = { top: '첫 화면(영상·슬라이드 버튼)', fold: '접고, 세우고, 펼치고' };
const plain = s => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
export function listEdits(html) {
  // 묶음: 감싸는 <section>(제목 = 안의 첫 h2), 없으면 바로 앞 h2·h3·h4
  const secs = [];
  for (const m of html.matchAll(/<section\b[^>]*>/g)) {
    const c = closeOf(html, 'section', m.index + m[0].length); if (!c) continue;
    const body = html.slice(m.index, c.end), h = body.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/), id = (m[0].match(/\sid="([^"]+)"/) || [])[1] || '';
    const eb = body.match(/<p class="eyebrow"[^>]*>([\s\S]*?)<\/p>/);
    secs.push({ start: m.index, end: c.end, id, label: plain(h ? h[1] : '') || (eb ? plain(eb[1]) : '') || SEC_NAME[id] || id });
  }
  const heads = [...html.matchAll(/<(h[234])\b[^>]*>([\s\S]*?)<\/\1>/g)].map(m => ({ at: m.index, label: plain(m[2]) }));
  const groupOf = at => {
    const s = secs.filter(x => x.start <= at && at < x.end).pop();
    if (s) return { group: s.label, anchor: s.id };
    const h = heads.filter(x => x.at < at).pop();
    return { group: h ? h.label : '', anchor: '' };
  };
  const out = [];
  for (const m of html.matchAll(/ data-edit="([\w-]+)"/g)) {
    const el = findEl(html, 'data-edit', m[1]); if (!el) continue;
    const sp = splitCore(html.slice(el.openEnd, el.innerEnd)); if (!sp) continue;
    out.push({ key: m[1], kind: 'text', tag: el.tag, text: coreToText(sp.core), multi: /<br/i.test(sp.core) || ['p', 'li', 'dd', 'td', 'blockquote'].includes(el.tag), ...groupOf(el.start) });
  }
  for (const m of html.matchAll(/ data-edit-img="([\w-]+)"/g)) {
    const el = findEl(html, 'data-edit-img', m[1]); if (!el) continue;
    const at = k => (el.open.match(new RegExp(`\\s${k}="([^"]*)"`)) || [])[1] || '';
    out.push({ key: m[1], kind: 'img', src: at('src'), w: +at('width') || 0, h: +at('height') || 0, alt: decode(at('alt')), ...groupOf(el.start) });
  }
  return out.sort((a, b) => html.indexOf(`"${a.key}"`) - html.indexOf(`"${b.key}"`));
}
