// 어드민 '홈 화면'·'구매평'·'자주 묻는 질문'·'기본 정보' 에서 고치는 목록(assets/js/data.js 의 값)
//   저장: content/site.json 의 blocks[이름] — data.js 가 원래 값 대신 쓴다(목록은 통째로, 묶음(CS·MARKET)은 바뀐 칸만 덮어씀)
//   화면은 이 정의(BLOCKS)를 그대로 받아 입력 칸을 그린다(admin.js blockEdit). 저장할 때 서버가 같은 정의로 검사한다(cleanBlock)
//   칸 종류(t): text 한 줄 · area 여러 줄 · lines 한 줄에 하나(배열) · pair 두 칸(배열 2개) · image 사진 · color 색 · check 켜고 끄기
//              select 고르기(opts) · icon 아이콘 · product 상품 · num 숫자 · table 표(cols, tuple 이면 [a,b] 배열) · date 날짜(YYYY-MM-DD)
//   check(o, where): 칸끼리 맞는지 마지막에 검사(예: 마지막 날 ≥ 시작일)
// 버튼 이동 주소: #구역 · 사이트 안 페이지(shop.html, blog/, product-29.html#detail) · /로 시작 · https:// (javascript: 같은 것은 막음)
const SAFE_LINK = /^(#[\w-]+|\/[^\s"'<>]*|https:\/\/[^\s"'<>]+|[\w-]+(?:\/[\w-]*)*(?:\.html)?(?:#[\w-]+)?)$/;
const LINK_MSG = '이동 주소는 #구역, 페이지 이름(shop.html), /로 시작하는 주소, https:// 주소만';
const PERIOD = [
  { k: 'start', t: 'date', label: '시작일', optional: true, help: '비우면 저장하자마자' },
  { k: 'end', t: 'date', label: '마지막 날', optional: true, help: '비우면 끌 때까지. 이날 밤 12시까지 보입니다' },
];
const periodOk = what => (o, where) => { if (o.start && o.end && o.end < o.start) bad(`${where}${what}: 마지막 날이 시작일보다 빠릅니다`); };
export const ICONS = [['i-star', '별'], ['i-flag', '깃발(국산)'], ['i-cal', '달력'], ['i-shield', '방패(보증)'], ['i-truck', '트럭(배송)'], ['i-layers', '층(폼·시험)'], ['i-drop', '물방울(세탁·방수)'], ['i-check', '체크'], ['i-tel', '전화'], ['i-kakao', '카카오'], ['i-share', '공유']];
export const FAQ_CATS = [['product', '제품'], ['size', '사이즈'], ['price', '가격'], ['ship', '배송·반품']];

export const BLOCKS = {
  HERO_SLIDES: { menu: 'home', label: '첫 화면 슬라이드', desc: '15초 영상이 끝나면 넘어가는 큰 배너입니다. 위에서부터 순서대로 보입니다. 상품을 고르면 가격·할인율·버튼은 상품 정보에서 자동으로 나옵니다.', list: true, min: 1, max: 10, title: 'sub', anchor: '/#top',
    keep: { size: 'num', render: 'color', event: 'text' },
    fields: [
      { k: 'id', t: 'product', label: '연결 상품', help: '“상품 없음”이면 이벤트 배너로 보입니다(버튼은 「두 번째 버튼」 칸, 비우면 전체 상품 보기)' },
      { k: 'img', t: 'image', label: '사진', ratio: 1, maxW: 1000, sizeKey: 'size', help: '정사각형(1000×1000)으로 맞춰 올립니다' },
      { k: 'bg', t: 'color', label: '배경색' },
      { k: 'dark', t: 'check', label: '어두운 배경(글자를 흰색으로)' },
      { k: 'eyebrow', t: 'text', label: '윗줄 작은 글', max: 30, help: '{rv} 라고 쓰면 그 상품의 구매평 수가 들어갑니다' },
      { k: 'title', t: 'pair', label: '큰 제목', labels: ['앞부분', '강조(색 다르게)'], max: 24, space: true },
      { k: 'sub', t: 'text', label: '설명 한 줄', max: 40 },
      { k: 'chips', t: 'lines', label: '작은 표시', help: '한 줄에 하나, 최대 4개', maxItems: 4, max: 20, optional: true },
      { k: 'cta2', t: 'pair', label: '두 번째 버튼(선택)', labels: ['버튼 글자', '이동 주소(예: #guide, shop.html)'], max: 60, optional: true, link: true },
    ] },
  TRUST: { menu: 'home', label: '신뢰 띠', desc: '첫 화면 바로 아래 옆으로 흐르는 띠입니다.', list: true, min: 1, max: 10, title: 'text', anchor: '/#best',
    fields: [
      { k: 'icon', t: 'icon', label: '아이콘' },
      { k: 'text', t: 'text', label: '문구', max: 50, help: '**글자** = 굵게 · {rating} = 3단 평점 · {reviews} = 3단 구매평 수' },
    ] },
  FEATURES: { menu: 'home', label: '제품 기능', desc: '「매일 접고 펴는 매트리스라서」 아래 기능 카드입니다.', list: true, min: 1, max: 9, title: 't', anchor: '/#features',
    fields: [
      { k: 'icon', t: 'icon', label: '아이콘' },
      { k: 'tag', t: 'text', label: '작은 분류', max: 12 },
      { k: 't', t: 'text', label: '제목', max: 30 },
      { k: 'd', t: 'area', label: '설명', max: 200 },
    ] },
  USES: { menu: 'home', label: '사용 장면', desc: '「자취방에서, 거실에서, 차 안에서」 탭입니다. 첫 번째가 처음에 열립니다.', list: true, min: 1, max: 8, title: 't', anchor: '/#use',
    keep: { k: 'text' },
    fields: [
      { k: 't', t: 'text', label: '탭 이름', max: 12 },
      { k: 'img', t: 'image', label: '사진', maxW: 1200, help: '가로 사진(860×560 비율)이 가장 잘 맞습니다' },
      { k: 'd', t: 'area', label: '설명', max: 200 },
      { k: 'li', t: 'lines', label: '체크 표시 줄', help: '한 줄에 하나', maxItems: 4, max: 40, optional: true },
    ] },
  TESTS: { menu: 'home', label: '시험·인증', desc: '「잠스쿨의 기술력과 안전성」 아래 성적서 목록입니다. 성적서 사진은 눌렀을 때 크게 보입니다.', list: true, min: 1, max: 16, title: 'q', anchor: '/#safety',
    fields: [
      { k: 'tag', t: 'text', label: '분류', max: 10 },
      { k: 'q', t: 'text', label: '제목', max: 40 },
      { k: 'org', t: 'text', label: '시험 기관', max: 40 },
      { k: 'rows', t: 'table', label: '결과 표', tuple: true, cols: [{ k: 0, label: '항목', max: 40 }, { k: 1, label: '내용', max: 120 }], maxItems: 8 },
      { k: 'cert', t: 'image', label: '성적서 사진', base: 'assets/img/', maxW: 1600 },
      { k: 'ref', t: 'text', label: '성적서 번호·날짜(선택)', max: 80, optional: true },
      { k: 'note', t: 'text', label: '아래 작은 설명(선택)', max: 120, optional: true },
    ] },
  CHECKS: { menu: 'home', label: '비교할 때 확인할 것', desc: '「왜 잠스쿨」의 비교 표(7가지)입니다.', list: true, min: 1, max: 10, title: 'q', anchor: '/#why',
    fields: [
      { k: 'q', t: 'text', label: '확인할 것', max: 30 },
      { k: 'a', t: 'text', label: '잠스쿨(굵게)', max: 16 },
      { k: 's', t: 'text', label: '잠스쿨 설명', max: 40 },
      { k: 'm', t: 'area', label: '시중 제품 볼 때', max: 200 },
    ] },
  MARKET: { menu: 'home', label: '가격대 비교', desc: '「더 싼 접이식 매트리스도 많습니다」의 가격 막대입니다. 금액은 원 단위 숫자로 넣습니다.', anchor: '/#why',
    fields: [
      { k: 'date', t: 'text', label: '조사 날짜', max: 20 },
      { k: 'source', t: 'text', label: '조사한 곳', max: 30 },
      { k: 'basis', t: 'text', label: '기준', max: 40 },
      { k: 'max', t: 'num', label: '막대 끝 금액', min: 100000, max: 3000000 },
      { k: 'bands', t: 'table', label: '유형별 가격 범위', cols: [{ k: 'k', label: '유형', max: 16 }, { k: 'sub', label: '두께', max: 12 }, { k: 'lo', label: '최저(원)', t: 'num' }, { k: 'hi', label: '최고(원)', t: 'num' }], maxItems: 6 },
      { k: 'ours', t: 'table', label: '잠스쿨 위치', one: true, cols: [{ k: 'k', label: '이름', max: 20 }, { k: 'sub', label: '두께', max: 12 }, { k: 'v', label: '가격(원)', t: 'num' }] },
    ] },
  REVIEWS: { menu: 'reviews', label: 'BEST 구매평', desc: '홈 리뷰 롤링 윗줄(전체 상품)과 그 상품 페이지의 구매평에 보입니다. 원문 그대로 옮기고, 아이디는 가려서(예: osy6***) 적어 주세요. 스마트스토어에서 가져온 구매평 2만여 건은 「구매평 관리」에서 상품별로 보고 숨기기·답글·BEST로 올리기를 합니다.', list: true, min: 1, max: 60, title: 'text', anchor: '/#review', byProduct: true,
    fields: [
      { k: 'pid', t: 'product', label: '상품', need: true },
      { k: 'id', t: 'text', label: '아이디(가림)', max: 20 },
      { k: 'opt', t: 'text', label: '옵션(선택)', max: 30, optional: true },
      { k: 'text', t: 'area', label: '구매평', max: 1200 },
    ] },
  SHORT_REVIEWS: { menu: 'reviews', label: '짧은 구매평', desc: '홈 리뷰 롤링 아랫줄에 흐르는 한두 문장 구매평입니다(전체 상품).', list: true, min: 1, max: 80, title: 'text', anchor: '/#review', byProduct: true,
    fields: [{ k: 'pid', t: 'product', label: '상품', need: true }, { k: 'text', t: 'area', label: '구매평', max: 200 }] },
  PHOTOS: { menu: 'reviews', label: '포토 구매평 사진', desc: '홈 리뷰 아래 사진 줄(전체 상품)과 그 상품 페이지에 보입니다. 누르면 크게 보입니다.', list: true, min: 1, max: 80, anchor: '/#review', byProduct: true, grid: true,
    fields: [{ k: 'pid', t: 'product', label: '상품', need: true }, { k: 'src', t: 'image', label: '사진', ratio: 1, maxW: 1000 }] },
  REVIEW_BASIS: { menu: 'reviews', label: '구매평 수 기준', desc: '홈 리뷰 제목 옆 「3단 접이식 매트리스, …」 뒤에 붙는 기준 문구입니다. 구매평 수·평점은 상품 정보에서 고칩니다.', scalar: { t: 'text', max: 60 }, anchor: '/#review' },
  FAQ: { menu: 'faq', label: '자주 묻는 질문', desc: '홈 FAQ, 3단 상품 페이지 Q&A(배송·반품 질문은 모든 상품 페이지)에 보이고, 검색엔진에도 질문·답으로 알려집니다.', list: true, min: 1, max: 40, title: 'q', anchor: '/#faq',
    fields: [
      { k: 'c', t: 'select', label: '분류', opts: FAQ_CATS },
      { k: 'q', t: 'text', label: '질문', max: 60 },
      { k: 'a', t: 'lines', label: '답', help: '한 줄이 한 문단입니다', maxItems: 5, max: 400, rows: 4 },
    ] },
  CS: { menu: 'info', label: '고객센터', desc: '주문서·결제 안내에 나오는 고객센터 정보입니다. 바닥글·약관 문구는 \'페이지 문구·사진\'에서 고칩니다.',
    fields: [
      { k: 'tel', t: 'text', label: '전화번호', max: 20, re: /^[0-9-]{8,15}$/, reMsg: '숫자와 - 만(예: 010-9610-8868)' },
      { k: 'hours', t: 'text', label: '운영 시간', max: 60 },
      { k: 'mail', t: 'text', label: '이메일', max: 60, re: /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i, reMsg: '이메일 주소 형식' },
      { k: 'kakao', t: 'text', label: '카카오톡 상담 주소', max: 120, re: /^https:\/\/[^\s"'<>]+$/, reMsg: 'https:// 로 시작하는 주소' },
    ] },
  // 팝업·이벤트: 기간(시작일·마지막 날)은 손님 브라우저에서 한국 날짜로 확인한다(assets/js/ui.js) → 날짜가 바뀌면 다시 배포하지 않아도 켜지고 꺼짐
  POPUPS: { menu: 'event', label: '팝업', desc: '사이트에 들어오면 뜨는 알림 창입니다. 「보이기」를 켠 것 중 기간 안의 것만 뜨고, 여러 개면 위에서부터 하나씩 차례로 뜹니다. 손님이 「오늘 하루 보지 않기」를 누르면 그날은 다시 뜨지 않고, 닫기만 누르면 그 방문 동안 뜨지 않습니다. 장바구니·주문서·주문 완료 화면에는 뜨지 않습니다.', list: true, min: 0, max: 5, title: 'title', anchor: '/',
    fields: [
      { k: 'on', t: 'check', label: '보이기(끄면 저장해 둔 채 숨김)', def: true },
      { k: 'title', t: 'text', label: '제목', max: 40, optional: true, help: '사진만 올릴 때는 비워도 됩니다' },
      { k: 'text', t: 'area', label: '내용', max: 300, optional: true, rows: 4 },
      { k: 'img', t: 'image', label: '사진(선택)', maxW: 900, optional: true, help: '가로 900px 이하로 줄여 올립니다' },
      { k: 'btn', t: 'pair', label: '버튼(선택)', labels: ['버튼 글자', '누르면 갈 곳(예: product-29.html, https://…)'], max: 200, optional: true, link: true },
      { k: 'where', t: 'select', label: '보여 줄 곳', opts: [['home', '홈 첫 화면에서만'], ['all', '모든 페이지']] },
      ...PERIOD,
    ],
    check: (o, where) => { if (!o.title && !o.img) bad(`${where}팝업: 제목이나 사진 중 하나는 있어야 합니다`); periodOk('팝업')(o, where); } },
  EVENTS: { menu: 'event', label: '상단 띠 배너', desc: '모든 페이지 맨 위에 한 줄로 보이는 이벤트·공지 배너입니다. 「보이기」를 켠 것 중 기간 안의 것 하나만 보이고(위에 있는 것 먼저), 없으면 띠가 사라집니다. 손님이 ✕를 누르면 그 방문 동안은 숨겨집니다.', list: true, min: 0, max: 10, title: 'text', anchor: '/',
    fields: [
      { k: 'on', t: 'check', label: '보이기(끄면 저장해 둔 채 숨김)', def: true },
      { k: 'em', t: 'text', label: '강조 글자(선택)', max: 12, optional: true, help: '문구 앞 흰 상자 안에 보입니다(예: 무료배송, 최대 50%)' },
      { k: 'text', t: 'text', label: '문구', max: 40 },
      { k: 'link', t: 'text', label: '누르면 갈 곳(선택)', max: 200, optional: true, re: SAFE_LINK, reMsg: LINK_MSG },
      ...PERIOD,
    ],
    check: periodOk('상단 띠 배너') },
};
export const MENUS = { home: '홈 화면', reviews: '구매평', faq: '자주 묻는 질문', info: '기본 정보', event: '팝업·이벤트' };

// ── 검사: 정의에 맞게 다듬는다(모르는 칸은 버림). image(v, field) 는 사진(data:) 을 파일로 올리고 경로를 돌려준다
class BadInput extends Error { constructor(m) { super(m); this.status = 400; } }
const bad = m => { throw new BadInput(m); };
const line = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const para = s => String(s ?? '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const cut = (s, max, label) => { if (max && [...s].length > max) bad(`${label}: ${max}자 이내로 줄여 주세요(지금 ${[...s].length}자)`); return s; };
export const IMG_PATH = /^assets\/img\/[\w\-./가-힣]+\.(jpe?g|png|webp|gif)$/i;

async function field(f, v, ctx, where) {
  const label = `${where}${f.label || ''}`;
  switch (f.t) {
    case 'text': { const s = cut(line(v), f.max, label); if (!s && !f.optional) bad(`${label}: 비어 있습니다`); if (s && f.re && !f.re.test(s)) bad(`${label}: ${f.reMsg || '형식을 확인해 주세요'}`); return s; }
    case 'area': { const s = cut(para(v), f.max, label); if (!s && !f.optional) bad(`${label}: 비어 있습니다`); return s; }
    case 'lines': { const a = (Array.isArray(v) ? v : String(v ?? '').split('\n')).map(line).filter(Boolean); if (f.maxItems && a.length > f.maxItems) bad(`${label}: 최대 ${f.maxItems}줄`); a.forEach(x => cut(x, f.max, label)); if (!a.length && !f.optional) bad(`${label}: 한 줄 이상 적어 주세요`); return a; }
    case 'pair': { const a = (Array.isArray(v) ? v : []).slice(0, 2).map(line); while (a.length < 2) a.push(''); a.forEach(x => cut(x, f.max, label)); if (f.optional && !a[0] && !a[1]) return undefined; if (!a[0] && !a[1]) bad(`${label}: 비어 있습니다`); if (f.optional && (!a[0] || !a[1])) bad(`${label}: 두 칸을 모두 채우거나 모두 비워 주세요`); if (f.link && a[1] && !SAFE_LINK.test(a[1])) bad(`${label}: 이동 주소는 #구역, 페이지 이름(shop.html), /로 시작하는 주소, https:// 주소만`); if (f.space && a[0]) a[0] += ' '; return a; }   // space: 앞부분 뒤 띄어쓰기(제목 앞·강조 사이)
    case 'color': { const s = line(v); if (!/^#[0-9a-f]{6}$/i.test(s)) bad(`${label}: 색은 #RRGGBB 형식`); return s; }
    case 'check': return !!v;
    case 'select': { const s = line(v); if (!f.opts.some(([k]) => k === s)) bad(`${label}: 고를 수 없는 값`); return s; }
    case 'icon': { const s = line(v); if (!ICONS.some(([k]) => k === s)) bad(`${label}: 고를 수 없는 아이콘`); return s; }
    case 'product': { if (v === '' || v == null) { if (f.need) bad(`${label}: 상품을 골라 주세요`); return undefined; } const id = +v; if (!ctx.products.includes(id)) bad(`${label}: 없는 상품`); return id; }
    case 'num': { const n = Math.round(+v); if (!Number.isFinite(n) || (f.min != null && n < f.min) || (f.max != null && n > f.max)) bad(`${label}: 숫자 범위를 확인해 주세요`); return n; }
    case 'image': if (f.optional && (v == null || v === '')) return undefined; return ctx.image(v, f, label);
    case 'date': { const s = line(v); if (!s) { if (!f.optional) bad(`${label}: 날짜를 골라 주세요`); return ''; } if (!/^20[0-9]{2}-[01][0-9]-[0-3][0-9]$/.test(s) || Number.isNaN(Date.parse(s))) bad(`${label}: 날짜 형식(예: 2026-12-01)`); return s; }
    case 'table': {
      const rows = f.one ? [v || {}] : (Array.isArray(v) ? v : []);
      if (f.maxItems && rows.length > f.maxItems) bad(`${label}: 최대 ${f.maxItems}줄`);
      const out = rows.map(r => {
        const o = f.tuple ? [] : {};
        for (const c of f.cols) { const raw = r == null ? '' : r[c.k]; o[c.k] = c.t === 'num' ? (Number.isFinite(+raw) && +raw >= 0 ? Math.round(+raw) : bad(`${label} ${c.label}: 숫자`)) : cut(line(raw), c.max, `${label} ${c.label}`); }
        return o;
      }).filter(o => (f.tuple ? o : Object.values(o)).some(x => x !== '' && x !== 0));
      if (!out.length) bad(`${label}: 한 줄 이상 적어 주세요`);
      return f.one ? out[0] : out;
    }
    default: bad(`알 수 없는 칸 ${f.k}`);
  }
}
async function item(def, v, ctx, where) {
  if (def.prim) return field({ ...def.prim, label: '' }, v, ctx, where);
  const src = v && typeof v === 'object' ? v : {}, o = {};
  for (const f of def.fields) {
    const r = await field(f, src[f.k], ctx, where);
    if (r !== undefined && !(f.optional && r === '')) o[f.k] = r;
    if (f.t === 'image' && f.sizeKey && ctx.lastSize) { o[f.sizeKey] = ctx.lastSize; ctx.lastSize = 0; }
  }
  if (def.check) def.check(o, where);
  for (const [k, t] of Object.entries(def.keep || {})) {
    if (o[k] != null || src[k] == null) continue;
    const s = src[k];
    if (t === 'num' && Number.isFinite(+s) && +s > 0 && +s < 5000) o[k] = Math.round(+s);
    else if (t === 'color' && /^#[0-9a-f]{6}$/i.test(String(s))) o[k] = String(s);
    else if (t === 'text' && /^[\w-]{1,20}$/.test(String(s))) o[k] = String(s);
  }
  return o;
}
// 정의대로 다듬은 값. ctx = { products: [상품 번호], image(v, f, label) → 경로(사진 올리기는 server 가) }
export async function cleanBlock(name, value, ctx) {
  const def = BLOCKS[name]; if (!def) bad('없는 항목');
  if (def.scalar) return field({ ...def.scalar, label: def.label }, value, ctx, '');
  if (!def.list) return item(def, value, ctx, '');
  if (!Array.isArray(value)) bad('형식 오류');
  if (value.length < (def.min || 0)) bad(`${def.label}: ${def.min}개 이상 있어야 합니다`);
  if (def.max && value.length > def.max) bad(`${def.label}: 최대 ${def.max}개`);
  const out = [];
  for (const [i, v] of value.entries()) {
    const r = await item(def, v, ctx, `${i + 1}번 `);
    if (name === 'HERO_SLIDES') { if (r.id) delete r.event; else r.event = 'banner'; }
    out.push(r);
  }
  return out;
}
