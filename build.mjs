// 잠스쿨 공식홈 정적 빌드: src/*.tpl.html + assets/js/data.js → index.html, product-<id>.html, sitemap.xml, llms.txt
// 실행: node build.mjs   (데이터 수정은 assets/js/data.js 한 곳에서)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadPosts } from './tools/blog/lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITE = 'https://jamschool.co.kr/';
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const wr = (p, s) => fs.writeFileSync(path.join(ROOT, p), s);

// WebP 폴백: assets/img 의 jpg/png 옆에 실제로 있는 .webp 만 <picture> 로 쓴다(없으면 원본 img 그대로)
const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
const IMGS = walk('assets/img');
const WEBP = new Set(IMGS.filter(f => f.endsWith('.webp')));
const noWebp = IMGS.filter(f => /\.(jpe?g|png)$/i.test(f) && !WEBP.has(f.replace(/\.(jpe?g|png)$/i, '.webp')));

const ctx = { window: { WEBP }, console };
ctx.globalThis = ctx.window;
vm.createContext(ctx);
// 상품 상세 매니페스트: assets/js/detail-<id>.js → window.DETAIL[id] (빌드 전용, 페이지에서는 불러오지 않음)
const DETAIL_FILES = fs.readdirSync(path.join(ROOT, 'assets/js')).filter(f => /^detail-\d+\.js$/.test(f)).map(f => `assets/js/${f}`);
for (const f of ['assets/js/data.js', 'assets/js/render.js', ...DETAIL_FILES]) vm.runInContext(rd(f).replace(/typeof window !== 'undefined' \? window : globalThis/, 'window'), ctx);
const { JAM, RENDER: R, DETAIL = {} } = ctx.window;
const { PRODUCTS, OPTIONS_29: O, REVIEWS, SHORT_REVIEWS, TESTS, FAQ, USES, FEATURES, MARKET, CHECKS } = JAM;
const POSTS = loadPosts(path.join(ROOT, 'content/blog'));
const { esc, won } = R;

const partial = n => rd(`src/partials/${n}.html`);
const includes = s => s.replace(/<!--@include:(\w+)-->/g, (_, n) => partial(n));
const fill = (s, key, html) => {
  const pair = new RegExp(`<!--@${key}-->[\\s\\S]*?<!--/@${key}-->`);
  if (pair.test(s)) return s.replace(pair, `<!--@${key}-->${html}<!--/@${key}-->`);
  return s.split(`<!--@${key}-->`).join(html);
};
const ld = obj => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
// 템플릿에 직접 적은 <img src="assets/img/….jpg|png"> 도 <picture>(WebP + 원본 폴백)로 바꾼다. 이미 R.pic 으로 만든 것은 건너뜀
const picturize = html => html.replace(/(?<!type="image\/webp">)<img src="(assets\/img\/[^"]+\.(?:jpe?g|png))"([^>]*)>/g, (m, src, rest) => R.pic(src, rest.trim()));

const ORG = {
  '@type': 'Organization', '@id': SITE + '#org', name: '잠스쿨', alternateName: ['JAMSCHOOL', '(주)씨와이컴퍼니'], url: SITE,
  logo: SITE + 'favicon.svg', email: 'jamsale33@gmail.com',
  contactPoint: { '@type': 'ContactPoint', telephone: '+82-10-9610-8868', contactType: 'customer service', areaServed: 'KR', availableLanguage: 'ko', hoursAvailable: { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '17:00' } },
  address: { '@type': 'PostalAddress', streetAddress: '가산디지털2로 95 KM TOWER 9층 904호', addressLocality: '금천구', addressRegion: '서울특별시', postalCode: '08505', addressCountry: 'KR' },
  sameAs: ['https://smartstore.naver.com/healingq'],
};

// ───────── index
const TRUST = [
  ['i-star', '<b>4.87</b> 3단 접이식 구매평 6,661건'], ['i-flag', '폼부터 커버까지 <b>100% 국내 생산</b>'], ['i-cal', '<b>14일</b> 무료체험'],
  ['i-shield', '<b>2년</b> 폼 무상 교체'], ['i-truck', '오후 1시 이전 결제 시 <b>당일 출고</b>'], ['i-layers', 'KATRI · SGS · 한일원자력 <b>시험 완료</b>'],
];
const trustHTML = [0, 1].map(k => TRUST.map(([ic, t]) => `<p class="trust__item"${k ? ' aria-hidden="true"' : ''}><svg aria-hidden="true"><use href="#${ic}"/></svg><span>${t}</span></p>`).join('')).join('');
const uses = R.usesHTML(USES);
let idx = includes(rd('src/index.tpl.html'));
idx = fill(idx, 'trust', trustHTML);
idx = fill(idx, 'products', PRODUCTS.map(p => R.productCard(p)).join(''));
idx = fill(idx, 'spec', R.specTable(O));
idx = fill(idx, 'tests', R.testsHTML(TESTS));
idx = fill(idx, 'reviews', R.reviewsHTML(REVIEWS.slice(0, 3)));
idx = fill(idx, 'uses-tabs', uses.tabs);
idx = fill(idx, 'uses-panel', uses.panel);
idx = fill(idx, 'faq', R.faqHTML(FAQ));
idx = fill(idx, 'features', R.featuresHTML(FEATURES));
idx = fill(idx, 'roll', R.reviewRollHTML(REVIEWS, SHORT_REVIEWS));
const price = R.priceHTML(O);
idx = fill(idx, 'price-tabs', price.tabs);
idx = fill(idx, 'price-panels', price.panels);
idx = fill(idx, 'market', R.marketHTML(MARKET));
idx = fill(idx, 'perday', R.perDay(MARKET.ours.v).toLocaleString('ko-KR'));
idx = fill(idx, 'checks', R.checksHTML(CHECKS));
idx = fill(idx, 'posts', POSTS.slice(0, 3).map(p => R.postCard(p)).join('') || '<p class="note">첫 글을 준비하고 있습니다.</p>');
idx = fill(idx, 'jsonld', ld({
  '@context': 'https://schema.org',
  '@graph': [ORG,
    { '@type': 'WebSite', '@id': SITE + '#site', url: SITE, name: '잠스쿨 공식몰', inLanguage: 'ko-KR', publisher: { '@id': SITE + '#org' } },
    { '@type': 'FAQPage', '@id': SITE + '#faq', mainEntity: FAQ.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.join(' ') } })) },
  ],
}));
wr('index.html', picturize(idx));

// ───────── product pages
const tpl = includes(rd('src/product.tpl.html'));
const svg = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
function galleryHTML(p) {
  const slides = p.imgs.map((src, i) => `<figure class="pd-gal__slide">${R.pic(src, `alt="${esc(p.short)} 상품 이미지 ${i + 1}" width="1000" height="1000" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async"`)}</figure>`).join('');
  const thumbs = p.imgs.map((src, i) => `<button class="pd-gal__th" type="button" aria-label="${i + 1}번째 이미지" aria-current="${i === 0}">${R.pic(src, 'alt="" width="120" height="120" loading="lazy"')}</button>`).join('');
  return `<div class="pd-gal"><div class="pd-gal__main"><div class="pd-gal__track" id="gal-track" tabindex="0" aria-label="상품 이미지, 좌우로 넘겨 보기">${slides}</div><span class="pd-gal__count" aria-hidden="true"><b>1</b> / ${p.imgs.length}</span><button class="pd-gal__zoom" type="button" aria-label="이미지 크게 보기">${svg('i-search')}</button></div><div class="pd-gal__thumbs" id="gal-thumbs">${thumbs}</div></div>`;
}
function optionsHTML(p) {
  if (!p.full) return `<div class="pd-opt" id="pd-opt"><div class="pd-qty-row"><span>수량</span><div class="qty" id="pd-qty"><button type="button" data-q="-1" aria-label="수량 줄이기" disabled><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h12"/></svg></button><span>1</span><button type="button" data-q="1" aria-label="수량 늘리기"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg></button></div></div><div class="pd-total"><span>총 상품금액</span><b id="pd-total">${won(p.price)}</b></div></div>`;
  return `<div class="pd-opt" id="pd-opt">
    <div class="field"><p class="field__label" id="po-t">두께<span>침대 위엔 7cm, 바닥엔 12cm</span></p><div class="seg" role="radiogroup" aria-labelledby="po-t" id="po-t-g">${O.thickness.map(t => `<button type="button" role="radio" aria-checked="false" data-v="${t.id}">${esc(t.label)}<small>${esc(t.sub)}</small></button>`).join('')}</div></div>
    <div class="field"><p class="field__label" id="po-s">사이즈<span>폭 × 길이 200cm</span></p><div class="sizes" role="radiogroup" aria-labelledby="po-s" id="po-s-g">${O.size.map(s => `<button class="size-opt" type="button" role="radio" aria-checked="false" data-v="${s.id}"><b>${esc(s.label)}</b><small>${s.w} × 200</small><small class="size-opt__p" data-p></small></button>`).join('')}</div></div>
    <div class="field"><p class="field__label" id="po-c">색상</p><div class="colors" role="radiogroup" aria-labelledby="po-c" id="po-c-g">${O.color.map(c => `<button class="color-opt" type="button" role="radio" aria-checked="false" data-v="${c.id}"><i style="background:${c.hex}"></i>${esc(c.label)}</button>`).join('')}</div></div>
    <p class="pd-hint" id="pd-hint" aria-live="polite">두께와 사이즈, 색상을 고르면 아래에 담깁니다.</p>
    <ul class="pd-sel" id="pd-sel" aria-label="선택한 옵션"></ul>
    <div class="pd-total"><span>총 상품금액</span><b id="pd-total">0원</b></div>
  </div>`;
}
function eventsHTML(p) {
  if (p.id !== 29) return '';
  const ev = [['기간 한정', '14일 무료체험'], ['기간 한정', '구매 금액 상관없이 무료 배송'], ['선착순', '방수 속커버 무료 증정'], ['이벤트', '우수 구매평 5만원 이마트 상품권']];
  return `<div class="pd-events"><p class="pd-events__t">진행 중인 혜택</p><ul>${ev.map(([a, b]) => `<li><span>${esc(a)}</span>${esc(b)}</li>`).join('')}</ul><button class="link-more" type="button" data-open="terms" style="margin-top:8px;font-size:14px">조건 보기${svg('i-right')}</button></div>`;
}
function infoHTML(p) {
  const r = R.rate(p);
  return `<div class="pd-info">
    <div class="pd-info__badges">${p.badges.map(R.badge).join('')}</div>
    <h1 class="pd-info__name">${esc(p.name)}</h1>
    <p class="pd-info__sum">${esc(p.summary)}</p>
    <a class="pd-info__rv" href="#reviews"><span class="stars" style="--v:${p.rating}" aria-hidden="true"></span><b>${p.rating.toFixed(2)}</b><span>구매평 ${p.reviews.toLocaleString('ko-KR')}건</span></a>
    <div class="pd-price">
      <p class="pd-price__list"><span class="sr-only">정가</span>${won(p.list)}</p>
      <p class="pd-price__now"><b class="rate">${r}%</b><b id="pd-price">${won(p.price)}</b>${p.full ? '<span class="from">부터</span>' : ''}</p>
      ${p.id === 29 ? `<p class="pd-price__cp">회원 쿠폰 적용 시 <b>${won(p.price - 10000)}</b>부터<button class="pd-cp-btn" type="button" data-open="coupon">쿠폰 받기</button></p>` : ''}
    </div>
    ${eventsHTML(p)}
    <dl class="pd-meta">
      <div><dt>원산지</dt><dd>대한민국</dd></div>
      <div><dt>배송</dt><dd>택배 · 기본 무료<br><span class="note">오후 1시 이전 결제 확인 시 당일 출고 (주말·공휴일 제외)</span></dd></div>
      ${p.full ? '<div><dt>반품 배송비</dt><dd>편도 18,000원 (최초 배송비 무료인 경우 36,000원) · 교환 36,000원</dd></div>' : ''}
      <div><dt>적립</dt><dd>결제 금액의 1% 포인트</dd></div>
    </dl>
    <div class="pd-opt-slot" id="pd-opt-slot">${optionsHTML(p)}</div>
    <div class="pd-btns">
      <button class="icon-btn pd-wish" type="button" data-wish="${p.id}" aria-pressed="false" aria-label="찜하기">${R.ICON.heart}</button>
      <button class="btn btn--line" type="button" id="pd-cart">장바구니</button>
      <button class="btn btn--primary" type="button" id="pd-buy">구매하기</button>
    </div>
    <div class="pd-btns2">
      ${p.store ? `<a class="btn btn--npay btn--block" href="${esc(p.store)}" target="_blank" rel="noopener">N Pay 네이버페이로 구매</a>` : ''}
      <button class="btn btn--line btn--sm" type="button" id="pd-share">${svg('i-share')}공유하기</button>
    </div>
  </div>`;
}
// 상세 이미지: 상품별 매니페스트(t: i 이미지 · v 루프 영상(GIF 변환) · y 유튜브), 없으면 갤러리 이미지로 대신
function detailHTML(p) {
  const list = DETAIL[p.id];
  const sk = '<div class="sk" aria-hidden="true"></div>';
  if (!list) return p.imgs.map((src, i) => `<figure class="dt" style="aspect-ratio:1/1">${sk}${R.pic(src, `alt="${esc(p.short)} 상세 이미지 ${i + 1}" width="1000" height="1000" loading="lazy" decoding="async"`)}</figure>`).join('');
  return list.map((d, i) => {
    const box = `class="dt${d.t === 'y' ? ' dt--yt' : ''}" style="aspect-ratio:${d.w}/${d.h}"`;
    if (d.t === 'v') return `<figure ${box}>${sk}<video data-src="${esc(d.src)}" poster="${esc(d.poster)}" muted loop playsinline preload="none" width="${d.w}" height="${d.h}" aria-hidden="true"></video></figure>`;
    if (d.t === 'y') return `<figure ${box}>${sk}${R.pic(d.poster, `alt="" width="1280" height="720" loading="lazy" decoding="async"`)}<button class="dt-yt" type="button" data-yt="${esc(d.id)}" data-title="${esc(d.title)}" aria-label="영상 재생: ${esc(d.title)}">${svg('i-play')}</button><figcaption class="sr-only">${esc(d.title)}</figcaption></figure>`;
    return `<figure ${box}>${sk}${R.pic(d.src, `alt="${esc(d.alt || `${p.short} 상세 이미지 ${i + 1}`)}" width="${d.w}" height="${d.h}" loading="lazy" decoding="async"`)}</figure>`;
  }).join('');
}
function specHTML(p) {
  if (p.id === 29) {
    const rows = [
      ['제품명', p.name], ['두께', '침대형 7cm · 바닥형 12cm'], ['사이즈', '멀티싱글 75 × 200cm · 슈퍼싱글 110 × 200cm · 퀸 150 × 200cm'],
      ['색상', '그레이 · 아이보리'], ['내장재', '4세대 고밀도 폼 (밀도 31kg/m³, KATRI 측정값 31.30kg/m³) · 100% 국산 폼'],
      ['커버', '에어론 솜을 넣은 누빔 커버 · 3개 지퍼로 분리 · 바닥면 미끄럼 방지 코팅'], ['원산지', '대한민국 (내장재 폼부터 겉커버까지 국내 생산)'],
      ['배송 형태', '압축 포장 (원래 크기로 복원까지 약 2일)'], ['세탁', '커버 찬물 단독 세탁 · 중성세제와 세탁망 권장 · 뜨거운 물과 건조기는 수축 원인'],
      ['보증', '2년 안에 폼이 꺼지면 폼 무상 교체'], ['판매원', '(주)씨와이컴퍼니'],
    ];
    return `<table class="info-tbl"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table><h3 class="pd-h3">옵션별 크기 · 무게 · 판매가</h3>${R.specTable(O)}<p class="note" style="margin-top:10px">접은 크기는 폭 × 깊이 × 높이입니다. 판매가는 2026년 10월 공식몰 기준이며 쿠폰 적용 전 금액입니다.</p>`;
  }
  const rows = [['제품명', p.name], ['특징', p.points.length ? p.points.join(' · ') : p.summary], ['원산지', '대한민국'], ['판매원', '(주)씨와이컴퍼니']];
  return `<table class="info-tbl"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
}
function reviewsHTMLp(p) {
  const sum = `<div class="rv-sum"><p class="rv-sum__score">${p.rating.toFixed(2)}</p><div class="rv-sum__meta"><span class="stars" style="--v:${p.rating}" aria-hidden="true"></span><p>구매평 <b>${p.reviews.toLocaleString('ko-KR')}</b>건${p.photoReviews ? ` · 포토 ${p.photoReviews.toLocaleString('ko-KR')}건` : ''}</p><p class="note">2026년 10월 공식몰 기준</p></div><a class="btn btn--line btn--sm" href="${esc(p.mall)}#prod_detail_review">공식몰 구매평 보기</a></div>`;
  if (p.id !== 29) return sum;
  return sum + `<div class="photo-strip" id="photo-strip" aria-label="포토 구매평"></div><div class="rv-list rv-list--pd">${R.reviewsHTML(REVIEWS)}</div>`;
}
function qnaHTML(p) {
  const list = p.id === 29 ? FAQ : FAQ.filter(f => f.c === 'ship');
  return `<div class="acc">${R.faqHTML(list, 'pq')}</div>`;
}
const SHIP = `<div class="ship">
  <div><h3>배송</h3><ul><li>오후 1시 이전 결제(입금) 확인 건은 당일 출고합니다(주말·공휴일 휴무).</li><li>평균 1~3일 걸리며 도서산간 지역은 다소 늦어질 수 있습니다.</li><li>로젠택배·대신택배로 보내며 제주·도서산간은 추가 배송비가 발생합니다.</li></ul></div>
  <div><h3>교환·반품</h3><ul><li>교환·반품 전 반드시 고객센터(010-9610-8868)로 수거 요청을 해 주세요. 연락 없이 보내시면 반송될 수 있습니다.</li><li>단순 변심에 따른 교환·반품은 왕복 배송비를 고객이 부담합니다. 매트리스 36,000원 · 커버류 6,000원(편도 18,000원 · 3,000원).</li><li>제품 하자는 배송비를 받지 않습니다. 제주·도서산간은 7,000원이 추가됩니다.</li><li>요청 기간은 수령 후 7일 이내입니다. 제품을 먼저 회수해 검수한 뒤 진행합니다.</li></ul></div>
  <div><h3>반품이 어려운 경우</h3><ul><li>압축 포장을 연 경우(사이즈를 먼저 확인해 주세요)</li><li>시간이 지나 재판매가 곤란할 정도로 가치가 떨어진 경우(전자상거래법 제17조)</li><li>고객 부주의로 오염·훼손되었거나 사용·세탁한 경우</li><li>탈취제(섬유 유연제 등)를 사용한 경우</li></ul></div>
</div>`;
function mainHTML(p) {
  const related = PRODUCTS.filter(x => x.id !== p.id).slice(0, 4);
  const cat = p.cat === 'mattress' ? '매트리스' : '침구·건강용품';
  return `<main id="main" class="pd" data-id="${p.id}">
  <div class="wrap">
    <nav class="crumb" aria-label="현재 위치"><a href="index.html">홈</a>${svg('i-right')}<a href="index.html#best">${cat}</a>${svg('i-right')}<span aria-current="page">${esc(p.short)}</span></nav>
    <div class="pd__top">${galleryHTML(p)}${infoHTML(p)}</div>
  </div>
  <nav class="pd-tabs" aria-label="상품 정보 메뉴"><div class="wrap"><a href="#detail" aria-current="true">상세정보</a><a href="#spec">제품 정보</a><a href="#reviews">구매평 <small>${p.reviews.toLocaleString('ko-KR')}</small></a><a href="#qna">Q&amp;A</a><a href="#ship">배송·교환</a></div></nav>
  <section class="pd-sec" id="detail" aria-labelledby="detail-t"><div class="wrap wrap--narrow"><h2 class="pd-h2" id="detail-t">상세정보</h2><div class="dt-wrap is-folded" id="dt-wrap">${detailHTML(p)}<div class="dt-more"><button class="btn btn--line" type="button" id="dt-more" aria-expanded="false" aria-controls="dt-wrap">상세정보 펼쳐보기${svg('i-down')}</button></div></div></div></section>
  <section class="pd-sec" id="spec" aria-labelledby="spec-t"><div class="wrap wrap--narrow"><h2 class="pd-h2" id="spec-t">제품 정보</h2>${specHTML(p)}</div></section>
  <section class="pd-sec" id="reviews" aria-labelledby="reviews-t"><div class="wrap wrap--narrow"><h2 class="pd-h2" id="reviews-t">구매평</h2>${reviewsHTMLp(p)}</div></section>
  <section class="pd-sec" id="qna" aria-labelledby="qna-t"><div class="wrap wrap--narrow"><h2 class="pd-h2" id="qna-t">자주 묻는 질문</h2>${qnaHTML(p)}</div></section>
  <section class="pd-sec" id="ship" aria-labelledby="ship-t"><div class="wrap wrap--narrow"><h2 class="pd-h2" id="ship-t">배송 · 교환 · 반품</h2>${SHIP}</div></section>
  <section class="section section--soft" aria-labelledby="rel-t"><div class="wrap"><div class="sec-head"><h2 class="h-sec" id="rel-t" style="font-size:clamp(22px,5vw,30px)">함께 보면 좋은 상품</h2></div><div class="pgrid">${related.map(x => R.productCard(x)).join('')}</div></div></section>
</main>
<div class="buybar" id="buybar"><button class="icon-btn pd-wish" type="button" data-wish="${p.id}" aria-pressed="false" aria-label="찜하기">${R.ICON.heart}</button><button class="btn btn--primary" type="button" id="bb-buy">구매하기</button></div>
<div class="layer sheet" id="buy" role="dialog" aria-modal="true" aria-labelledby="buy-t" aria-hidden="true" hidden><div class="layer__dim"></div><div class="sheet__box"><div class="sheet__grip" aria-hidden="true"></div><div class="drawer__head" style="border:0"><h2 id="buy-t">옵션 선택</h2><button class="icon-btn" type="button" data-close aria-label="닫기">${svg('i-x')}</button></div><div class="drawer__body" id="buy-slot"></div><div class="drawer__foot"><div class="pd-btns" style="margin:0"><button class="btn btn--line" type="button" id="sh-cart">장바구니</button><button class="btn btn--primary" type="button" id="sh-buy">구매하기</button></div></div></div></div>`;
}
function productLD(p) {
  const url = SITE + `product-${p.id}.html`;
  const offers = p.full
    ? { '@type': 'AggregateOffer', priceCurrency: 'KRW', lowPrice: Math.min(...Object.values(O.price)), highPrice: Math.max(...Object.values(O.price)), offerCount: Object.keys(O.price).length * O.color.length, availability: 'https://schema.org/InStock', url, seller: { '@id': SITE + '#org' } }
    : { '@type': 'Offer', priceCurrency: 'KRW', price: p.price, availability: 'https://schema.org/InStock', url, seller: { '@id': SITE + '#org' } };
  const prod = {
    '@type': 'Product', '@id': url + '#product', name: p.name, description: p.summary + (p.points.length ? ' · ' + p.points.join(' · ') : ''),
    image: p.imgs.slice(0, 4).map(i => SITE + i), brand: { '@type': 'Brand', name: '잠스쿨' }, sku: `JAM-${p.id}`, countryOfOrigin: 'KR',
    aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating, bestRating: 5, reviewCount: p.reviews }, offers,
  };
  if (p.id === 29) {
    prod.additionalProperty = [
      { '@type': 'PropertyValue', name: '폼 밀도', value: '31.30', unitText: 'kg/m³' },
      { '@type': 'PropertyValue', name: '두께', value: '7cm(침대형), 12cm(바닥형)' },
      { '@type': 'PropertyValue', name: '펼친 크기', value: '75×200, 110×200, 150×200cm' },
      { '@type': 'PropertyValue', name: '라돈 검출', value: '7.6Bq/m³ 미만(한일원자력)' },
      { '@type': 'PropertyValue', name: '특허', value: '제10-2378668호 다층구조의 침대 매트리스' },
    ];
    prod.review = REVIEWS.slice(0, 3).map(r => ({ '@type': 'Review', author: { '@type': 'Person', name: r.id }, reviewRating: { '@type': 'Rating', ratingValue: 5, bestRating: 5 }, reviewBody: r.text }));
  }
  const graph = [ORG, prod, { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: '홈', item: SITE }, { '@type': 'ListItem', position: 2, name: p.short, item: url }] }];
  if (p.id === 29) graph.push({ '@type': 'FAQPage', mainEntity: FAQ.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.join(' ') } })) });
  return ld({ '@context': 'https://schema.org', '@graph': graph });
}
for (const p of PRODUCTS) {
  let s = tpl;
  const title = p.id === 29 ? '3단 접이식 매트리스 — 31kg/m³ 고밀도 국내산 폼 · 7cm/12cm | 잠스쿨 공식몰' : `${p.short} | 잠스쿨 공식몰`;
  const desc = p.id === 29
    ? '잠스쿨 3단 접이식 매트리스. 침대형 7cm·바닥형 12cm, 멀티싱글 75·슈퍼싱글 110·퀸 150cm. 밀도 31.30kg/m³(KATRI), 라돈 7.6Bq/m³ 미만, 특허 제10-2378668호. 118,000원부터, 14일 무료체험.'
    : `${p.name}. ${p.summary}. 판매가 ${won(p.price)}, 구매평 ${p.reviews.toLocaleString('ko-KR')}건 평점 ${p.rating.toFixed(2)}.`;
  s = fill(s, 'title', esc(title)); s = fill(s, 'desc', esc(desc)); s = fill(s, 'canonical', SITE + `product-${p.id}.html`);
  s = fill(s, 'ogimg', SITE + p.imgs[0]); s = fill(s, 'jsonld', productLD(p)); s = fill(s, 'main', mainHTML(p));
  s = fill(s, 'extra-js', '');
  wr(`product-${p.id}.html`, picturize(s));
}

// ───────── sitemap / robots / llms.txt

// ───────── 블로그 (content/blog/*.md → blog/index.html, blog/<slug>.html, blog/feed.xml)
fs.mkdirSync(path.join(ROOT, 'blog'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'blog'))) if (f.endsWith('.html') || f === 'feed.xml') fs.unlinkSync(path.join(ROOT, 'blog', f));
const P29card = PRODUCTS.find(p => p.id === 29);
// /blog/ 페이지는 <base href="../"> 를 쓴다. 본문 바로가기(#main)만 현재 글 주소로 고친다
const blogShell = (tplName, slugPath) => includes(rd(`src/${tplName}`)).split('href="#main"').join(`href="${slugPath}#main"`);
const CATS = [...new Set(POSTS.map(p => p.category))];
{
  let s = blogShell('blog-index.tpl.html', 'blog/');
  s = fill(s, 'canonical', SITE + 'blog/'); s = fill(s, 'ogimg', SITE + 'assets/video/hero-desktop.jpg');
  s = fill(s, 'cats', ['<button class="chip" type="button" aria-pressed="true" data-f="all">전체</button>', ...CATS.map(c => `<button class="chip" type="button" aria-pressed="false" data-f="${esc(c)}">${esc(c)}</button>`)].join(''));
  s = fill(s, 'list', POSTS.map(p => R.postCard(p).replace('<article class="post-card">', `<article class="post-card" data-c="${esc(p.category)}">`)).join('') || '<p class="note">첫 글을 준비하고 있습니다.</p>');
  s = fill(s, 'jsonld', ld({ '@context': 'https://schema.org', '@graph': [ORG, { '@type': 'Blog', '@id': SITE + 'blog/#blog', name: '잠스쿨 수면 가이드', url: SITE + 'blog/', inLanguage: 'ko-KR', publisher: { '@id': SITE + '#org' }, blogPost: POSTS.map(p => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE}blog/${p.slug}.html`, datePublished: p.date })) }] }));
  wr('blog/index.html', picturize(s));
}
for (const p of POSTS) {
  const url = `${SITE}blog/${p.slug}.html`;
  let s = blogShell('blog-post.tpl.html', `blog/${p.slug}.html`);
  s = fill(s, 'title', esc(p.title)); s = fill(s, 'desc', esc(p.description)); s = fill(s, 'canonical', url);
  s = fill(s, 'ogimg', SITE + (p.image || 'assets/img/products/29/01.jpg')); s = fill(s, 'date', esc(p.date)); s = fill(s, 'datetxt', esc(p.date.replace(/-/g, '.')));
  s = fill(s, 'cat', esc(p.category)); s = fill(s, 'author', esc(p.author || '잠스쿨 편집팀')); s = fill(s, 'minutes', String(p.minutes));
  s = fill(s, 'toc', p.toc.length > 2 ? `<nav class="post__toc" aria-label="목차"><p>이 글의 순서</p><ol>${p.toc.map(t => `<li><a href="blog/${esc(p.slug)}.html#${t.id}">${esc(t.t)}</a></li>`).join('')}</ol></nav>` : '');
  s = fill(s, 'body', p.html);
  s = fill(s, 'faq', p.faq.length ? `<section class="post-faq" aria-labelledby="pf-t"><h2 id="pf-t">자주 묻는 질문</h2><div class="acc">${p.faq.map((f, i) => R.accItem(`pf-${i}`, f.q, f.html)).join('')}</div></section>` : '');
  const prod = PRODUCTS.find(x => String(x.id) === String(p.product || 29)) || P29card;
  s = fill(s, 'cta', `<aside class="post-cta" aria-label="관련 상품">${R.pic(prod.imgs[0], `alt="" width="96" height="96" loading="lazy"`)}<div><b>${esc(prod.name)}</b><span>${esc(prod.summary)} · ${won(prod.price)}${prod.full ? '부터' : ''}</span><a class="btn btn--primary btn--sm" href="${R.href(prod)}">상품 보기</a></div></aside>`);
  const rel = POSTS.filter(x => x.slug !== p.slug).slice(0, 3);
  s = fill(s, 'related', rel.length ? `<section class="post-related" aria-labelledby="pr-t"><h2 id="pr-t">함께 읽으면 좋은 글</h2><div class="post-grid">${rel.map(x => R.postCard(x)).join('')}</div></section>` : '');
  const graph = [ORG,
    { '@type': 'BlogPosting', '@id': url + '#post', headline: p.title, description: p.description, datePublished: p.date, dateModified: p.updated || p.date, inLanguage: 'ko-KR', url, mainEntityOfPage: url, image: SITE + (p.image || 'assets/img/products/29/01.jpg'), author: { '@type': 'Organization', name: p.author || '잠스쿨 편집팀', url: SITE }, publisher: { '@id': SITE + '#org' }, keywords: p.tags.join(', '), about: { '@type': 'Product', name: prod.name, url: SITE + R.href(prod) } },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: '홈', item: SITE }, { '@type': 'ListItem', position: 2, name: '수면 가이드', item: SITE + 'blog/' }, { '@type': 'ListItem', position: 3, name: p.title, item: url }] }];
  if (p.faq.length) graph.push({ '@type': 'FAQPage', mainEntity: p.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/\*\*/g, '') } })) });
  s = fill(s, 'jsonld', ld({ '@context': 'https://schema.org', '@graph': graph }));
  wr(`blog/${p.slug}.html`, picturize(s));
}
const rssDate = d => new Date(d + 'T09:00:00+09:00').toUTCString();
wr('blog/feed.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>잠스쿨 수면 가이드</title><link>${SITE}blog/</link><description>3단 접이식 매트리스 고르는 법·쓰는 법</description><language>ko</language>
${POSTS.map(p => `<item><title>${esc(p.title)}</title><link>${SITE}blog/${p.slug}.html</link><guid>${SITE}blog/${p.slug}.html</guid><pubDate>${rssDate(p.date)}</pubDate><description>${esc(p.description)}</description></item>`).join('\n')}
</channel></rss>
`);
console.log(`blog: ${POSTS.length} posts`);

const today = new Date().toISOString().slice(0, 10);
wr('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${SITE}</loc><lastmod>${today}</lastmod></url>\n${PRODUCTS.map(p => `<url><loc>${SITE}product-${p.id}.html</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n<url><loc>${SITE}blog/</loc><lastmod>${today}</lastmod></url>\n${POSTS.map(p => `<url><loc>${SITE}blog/${p.slug}.html</loc><lastmod>${p.updated || p.date}</lastmod></url>`).join('\n')}\n</urlset>\n`);
wr('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
const P29 = PRODUCTS[0];
wr('llms.txt', `# 잠스쿨 (JAMSCHOOL)

> 잠스쿨은 (주)씨와이컴퍼니가 운영하는 국내 생산 매트리스 브랜드입니다. 대표 제품은 3단 접이식 매트리스이며, 폼부터 겉커버까지 국내에서 생산합니다.

## 대표 제품: 잠스쿨 허리에 좋은 3단 접이식 매트리스
- 두께: 침대형 7cm(침대 프레임 위), 바닥형 12cm(바닥 또는 침대). 고객의 70% 이상이 바닥형을 선택.
- 사이즈(펼침): 멀티싱글 75×200cm, 슈퍼싱글 110×200cm, 퀸 150×200cm. 접으면 깊이 67cm, 높이 21cm(7cm형)·36cm(12cm형).
- 무게: 7cm형 3.5/5/6.5kg, 12cm형 5.5/8/11.5kg (멀티싱글/슈퍼싱글/퀸).
- 판매가(공식몰, ${today} 기준): 7cm ${Object.entries(O.price).filter(([k]) => k.startsWith('7-')).map(([, v]) => won(v)).join(' / ')}, 12cm ${Object.entries(O.price).filter(([k]) => k.startsWith('12-')).map(([, v]) => won(v)).join(' / ')}.
- 폼 밀도 31kg/m³ (KATRI 시험성적서 측정값 31.30kg/m³, KS M 6672). 반복 압축 영구 줄음률 10만 회 시험(KS M 6672:2016).
- 안전 시험: SGS 6대 유해물질 미검출, KATRI 폼알데하이드 검출 안 됨, 한일원자력 라돈 7.6Bq/m³ 미만(환경부 권고 148Bq/m³), KATRI 진드기 차단(최대 기공 0.02mm).
- 특허: 제10-2378668호 「다층구조의 침대 매트리스」(2022-03-22 등록).
- 색상: 그레이, 아이보리. 커버는 3개 지퍼로 분리, 바닥 미끄럼 방지 코팅. 전기장판과 함께 사용 가능.
- 구매평: ${P29.reviews.toLocaleString('ko-KR')}건, 평균 ${P29.rating.toFixed(2)}점 (공식몰).
- 상세: ${SITE}product-29.html

## 구매 조건
- 14일 무료체험(반품 시 왕복 배송비 고객 부담), 2년 내 폼 꺼짐 시 폼 무상 교체.
- 오후 1시 이전 결제 확인 시 당일 출고(주말·공휴일 제외), 평균 1~3일.
- 교환·반품: 수령 후 7일 이내 고객센터 접수. 단순 변심 왕복 배송비 매트리스 36,000원.

## 그 밖의 제품
${PRODUCTS.slice(1).map(p => `- ${p.name}: ${p.summary}. ${won(p.price)}. ${SITE}product-${p.id}.html`).join('\n')}

## 가격대 (${MARKET.source} ${MARKET.basis}, ${MARKET.date} 조회)
${MARKET.bands.map(b => `- ${b.k}(${b.sub}): ${won(b.lo)}~${won(b.hi)}`).join('\n')}
- 잠스쿨 바닥형 12cm 슈퍼싱글: ${won(MARKET.ours.v)} — 폼 매트리스 중 높은 가격대, 스프링 내장·천연라텍스보다 낮은 가격대.

## 수면 가이드 (블로그)
${POSTS.map(p => `- ${p.title}: ${p.description} ${SITE}blog/${p.slug}.html`).join('\n') || '- 준비 중'}

## 판매처
공식몰 ${SITE}, 네이버 스마트스토어 https://smartstore.naver.com/healingq, 11번가, 오늘의집, GS샵, 현대Hmall

## 회사
(주)씨와이컴퍼니 · 대표 노치영 · 사업자등록번호 685-81-00023 · 서울특별시 금천구 가산디지털2로 95 KM TOWER 9층 904호 · 고객센터 010-9610-8868(평일 09:00~17:00) · jamsale33@gmail.com
`);
console.log('built: index.html,', PRODUCTS.map(p => `product-${p.id}.html`).join(', '), ', sitemap.xml, robots.txt, llms.txt');
console.log(`detail manifests: ${Object.keys(DETAIL).join(', ') || '없음'}`);
if (noWebp.length) console.warn(`WebP 없는 이미지 ${noWebp.length}개(원본 img 로 출력됨) — python ../motion/tools/to_webp.py assets/img 로 만들 수 있음:\n  ${noWebp.slice(0, 10).join('\n  ')}`);
