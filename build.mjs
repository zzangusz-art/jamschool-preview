// 잠스쿨 공식홈 정적 빌드: src/*.tpl.html + assets/js/data.js → index.html, product-<id>.html, shop·cart·checkout·order-complete, blog/, sitemap.xml, llms.txt
// 실행: node build.mjs   (데이터 수정은 assets/js/data.js 한 곳에서)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadPosts } from './tools/blog/lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// 공식 홈 주소(정식 주소·사이트맵·구조화 데이터 기준). 공식몰(jamschool.co.kr, 로그인·약관·구매평)은 다른 사이트라 따로 링크한다
const SITE = 'https://jamschool.kr/';
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 소유확인·추적 코드(src/site-tags.json, 비어 있는 항목은 넣지 않음): 모든 .html 의 <head> 첫머리, <body> 바로 뒤(GTM noscript), </body> 앞
const TAGS = JSON.parse(rd('src/site-tags.json'));
const tag = k => (typeof TAGS[k] === 'string' && /^[\w-]+$/.test(TAGS[k].trim()) ? TAGS[k].trim() : '');
const HEAD_TAGS = [
  tag('naverSiteVerification') && `<meta name="naver-site-verification" content="${tag('naverSiteVerification')}">`,
  tag('googleSiteVerification') && `<meta name="google-site-verification" content="${tag('googleSiteVerification')}">`,
  tag('bingSiteVerification') && `<meta name="msvalidate.01" content="${tag('bingSiteVerification')}">`,
  tag('gtm') && `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${tag('gtm')}');</script>`,
  tag('ga4') && `<script async src="https://www.googletagmanager.com/gtag/js?id=${tag('ga4')}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${tag('ga4')}');</script>`,
].filter(Boolean).join('\n');
const BODY_OPEN = tag('gtm') ? `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${tag('gtm')}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>` : '';
// 주요 클릭(스마트스토어·N Pay, 구매하기, 장바구니, 전화, 카카오, 공식몰 이동)을 dataLayer·GA4 이벤트로
const TRACK_JS = (tag('gtm') || tag('ga4')) ? `<script>(function(){var w=window;w.dataLayer=w.dataLayer||[];function send(n,p){w.dataLayer.push(Object.assign({event:n},p));if(typeof w.gtag==='function')w.gtag('event',n,p);}
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a,button');if(!a)return;var h=a.getAttribute('href')||'',id=a.id||'',t=(a.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40);
if(/smartstore\\.naver\\.com/.test(h))send('jam_store_click',{link_url:h,label:t});else if(/^tel:/.test(h))send('jam_call_click',{link_url:h});
else if(/kakao/.test(h))send('jam_kakao_click',{link_url:h});else if(/jamschool\\.co\\.kr/.test(h))send('jam_mall_click',{link_url:h,label:t});
else if(/^(pd-buy|bb-buy|sh-buy)$/.test(id))send('jam_buy_click',{label:t});else if(id==='sh-cart')send('jam_cart_click',{label:t});},true);})();</script>` : '';
const BODY_END = [
  TRACK_JS,
  tag('naverAnalytics') && `<script src="https://wcs.naver.net/wcslog.js"></script>\n<script>if(!wcs_add) var wcs_add = {};wcs_add["wa"] = "${tag('naverAnalytics')}";if(window.wcs) { wcs_do(); }</script>`,
].filter(Boolean).join('\n');
// 어드민 값이 있으면 data.js 바로 앞에 넣는다(OVERRIDES 는 아래에서 읽고, 이 함수는 페이지를 쓸 때 불린다)
const ovTag = () => Object.values(OVERRIDES).some(v => v && typeof v === 'object' && Object.keys(v).length)
  ? `<script>window.JAM_OVERRIDES=${JSON.stringify(OVERRIDES).replace(/</g, '\\u003c')}</script>\n` : '';
const withTags = s => {
  const ov = ovTag();
  if (ov) s = s.replace(/<script src="[^"]*assets\/js\/data\.js"><\/script>/, m => ov + m);
  if (HEAD_TAGS) s = s.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${HEAD_TAGS}`);
  if (BODY_OPEN) s = s.replace(/<body[^>]*>/, m => `${m}\n${BODY_OPEN}`);
  if (BODY_END) s = s.replace(/<\/body>(?![\s\S]*<\/body>)/, `${BODY_END}\n</body>`);
  // CSS·JS 주소에 파일 내용 버전(?v=)을 붙인다 → 배포하면 바뀐 파일만 브라우저·Cloudflare 캐시와 상관없이 바로 새로 받음
  return s.replace(/(href|src)="(assets\/(?:css|js)\/[\w.-]+\.(?:css|js))"/g, (m, a, rel) => { const v = verOf(rel); return v ? `${a}="${rel}?v=${v}"` : m; });
};
const VER = new Map();
function verOf(rel) {
  if (!VER.has(rel)) { const f = path.join(ROOT, rel); VER.set(rel, fs.existsSync(f) ? crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex').slice(0, 8) : ''); }
  return VER.get(rel);
}
// 검색 제목·설명 길이(네이버 서치어드바이저 권장 제목 40자·설명 80자 이내): 색인되는 페이지만 빌드 끝에 알림
const SEO_LONG = [];
const unent = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function seoCheck(p, s) {
  if (/<meta name="robots" content="noindex/.test(s)) return;
  const t = unent((s.match(/<title>([^<]*)<\/title>/) || [])[1] || ''), d = unent((s.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
  if ([...t].length > 40) SEO_LONG.push(`${p} 제목 ${[...t].length}자`);
  if ([...d].length > 80) SEO_LONG.push(`${p} 설명 ${[...d].length}자`);
}
const wr = (p, s) => { if (p.endsWith('.html')) { s = withTags(s); seoCheck(p, s); } fs.writeFileSync(path.join(ROOT, p), s); };

// WebP 폴백: assets/img 의 jpg/png 옆에 실제로 있는 .webp 만 <picture> 로 쓴다(없으면 원본 img 그대로)
const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
const IMGS = walk('assets/img');
const WEBP = new Set(IMGS.filter(f => f.endsWith('.webp')));
const noWebp = IMGS.filter(f => /\.(jpe?g|png)$/i.test(f) && !WEBP.has(f.replace(/\.(jpe?g|png)$/i, '.webp')));

// 어드민에서 고친 상품 값(content/site.json): 빌드(vm)와 각 페이지(window.JAM_OVERRIDES)에 똑같이 넣는다
const OVERRIDES = fs.existsSync(path.join(ROOT, 'content/site.json')) ? JSON.parse(rd('content/site.json')) : {};
delete OVERRIDES._설명;
const ctx = { window: { WEBP, JAM_OVERRIDES: OVERRIDES }, console };
ctx.globalThis = ctx.window;
vm.createContext(ctx);
// 상품 상세 매니페스트: assets/js/detail-<id>.js → window.DETAIL[id] (빌드 전용, 페이지에서는 불러오지 않음)
const DETAIL_FILES = fs.readdirSync(path.join(ROOT, 'assets/js')).filter(f => /^detail-\d+\.js$/.test(f)).map(f => `assets/js/${f}`);
for (const f of ['assets/js/data.js', 'assets/js/render.js', ...DETAIL_FILES]) vm.runInContext(rd(f).replace(/typeof window !== 'undefined' \? window : globalThis/, 'window'), ctx);
const { JAM, RENDER: R, DETAIL = {} } = ctx.window;
const { PRODUCTS, OPTIONS_29: O, REVIEWS, SHORT_REVIEWS, TESTS, FAQ, USES, FEATURES, MARKET, CHECKS, NOTICE = {} } = JAM;
const POSTS = loadPosts(path.join(ROOT, 'content/blog'));
// 썸네일(tools/blog/thumb.mjs)이 실제로 있을 때만 쓴다 — 없으면 카드는 글자만, 공유 이미지는 상품 사진
for (const p of POSTS) p.thumb = p.image && fs.existsSync(path.join(ROOT, p.image)) ? p.image : null;
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
  '@type': 'Organization', '@id': SITE + '#org', name: '잠스쿨', legalName: '잠스쿨', alternateName: ['JAMSCHOOL'], url: SITE, taxID: '841-45-00474',
  logo: SITE + 'assets/img/brand/logo.png', email: 'jamsale33@gmail.com',
  contactPoint: { '@type': 'ContactPoint', telephone: '+82-10-9610-8868', contactType: 'customer service', areaServed: 'KR', availableLanguage: 'ko', hoursAvailable: { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '17:00' } },
  address: { '@type': 'PostalAddress', streetAddress: '강서로45길 104, 101동 305호 (내발산동, 대성유니드아파트)', addressLocality: '강서구', addressRegion: '서울특별시', addressCountry: 'KR' },
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
// 홈 베스트: 큰 썸네일 3열(모바일 2열) — 3×3 으로 맞추려고 잠스쿨 브랜드 9개만, 전체는 shop.html
idx = fill(idx, 'products', PRODUCTS.filter(p => !p.brand).slice(0, 9).map(p => R.productCard(p)).join(''));
// 히어로 슬라이드(쇼릴 다음): data.js HERO_SLIDES
{
  const SL = JAM.HERO_SLIDES;
  const slide = (d, i) => {
    const p = d.id ? PRODUCTS.find(x => x.id === d.id) : null;
    const label = p ? p.short : d.title.join('');
    const T = i === 0 ? 'h1' : 'h2';
    const price = p ? `<p class="hs__price"><span class="rate">${R.rate(p)}%</span><b>${won(p.price)}</b>${p.full ? '부터' : ''}</p>` : '';
    const cta = p
      ? `<a class="btn btn--primary" href="${R.href(p)}">제품 보기</a>${d.cta2 ? `<a class="btn btn--line" href="${esc(d.cta2[1])}">${esc(d.cta2[0])}</a>` : `<button class="btn btn--line" type="button" data-quick="${p.id}">빠른 보기</button>`}`
      : `<button class="btn btn--primary" type="button" data-open="coupon">쿠폰 받기</button><a class="btn btn--line" href="shop.html">전체 상품 보기</a>`;
    return `<article class="hs${d.dark ? ' hs--dark' : ''}${d.render ? ' hs--render' : ''}${i === 0 ? ' is-on' : ''}" id="hs-${i}" role="group" aria-roledescription="slide" aria-label="${i + 1} / ${SL.length}: ${esc(label)}" style="--hs-bg:${d.bg}${d.render ? `;--hs-img-bg:${d.render}` : ''}"${i ? ' aria-hidden="true" inert' : ''}>
      <div class="hs__img">${R.pic(d.img, `alt="" width="${d.size || 1000}" height="${d.size || 1000}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async"`)}</div>
      <div class="hs__copy"><p class="hs__eyebrow">${esc(d.eyebrow.replace('{rv}', p ? p.reviews.toLocaleString('ko-KR') : ''))}</p><${T} class="hs__title"${i === 0 ? ' id="hero-t"' : ''}>${esc(d.title[0])}<em>${esc(d.title[1])}</em></${T}><p class="hs__sub">${esc(d.sub)}</p><ul class="hs__chips">${d.chips.map(c => `<li>${esc(c)}</li>`).join('')}</ul>${price}<div class="hs__cta">${cta}</div></div>
    </article>`;
  };
  idx = fill(idx, 'slides', SL.map(slide).join(''));
  idx = fill(idx, 'slide-dots', SL.map((d, i) => `<button class="hs__dot" type="button" aria-label="${i + 1}번 슬라이드" aria-controls="hs-${i}" aria-current="${i === 0}"><i></i></button>`).join(''));
  idx = fill(idx, 'slide-n', String(SL.length));
}
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
idx = fill(idx, 'ourswon', won(MARKET.ours.v));
idx = fill(idx, 'couponwon', won(Math.min(...Object.values(O.price)) - 10000));
idx = fill(idx, 'checks', R.checksHTML(CHECKS));
idx = fill(idx, 'bento', R.bentoHTML({ T: TESTS, M: MARKET, P: PRODUCTS.find(p => p.id === 29) }));
idx = fill(idx, 'checks-acc', R.accItem('why-chk', '다른 제품과 비교할 때 확인할 7가지', R.checksHTML(CHECKS)));
idx = fill(idx, 'posts', POSTS.slice(0, 3).map(p => R.postCard(p)).join('') || '<p class="note">첫 글을 준비하고 있습니다.</p>');
idx = fill(idx, 'jsonld', ld({
  '@context': 'https://schema.org',
  '@graph': [ORG,
    { '@type': 'WebSite', '@id': SITE + '#site', url: SITE, name: '잠스쿨', alternateName: '잠스쿨 공식 홈페이지', inLanguage: 'ko-KR', publisher: { '@id': SITE + '#org' } },
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
// 가격 아래 신뢰 배지(3단 접이식): 출고·보증은 조건 시트, 국내 생산·시험은 홈 해당 섹션으로(14일 체험은 바로 아래 '진행 중인 혜택'에 있어 뺐다)
function trustHTML29(p) {
  if (p.id !== 29) return '';
  const it = [
    ['button', 'data-open="terms"', 'i-truck', '오후 1시 당일 출고', '주말·공휴일 제외'],
    ['button', 'data-open="terms"', 'i-shield', '2년 폼 교체', '꺼지면 무상'],
    ['a', 'href="index.html#korea"', 'i-flag', '국산 100%', '폼부터 겉커버까지'],
    ['a', 'href="index.html#safety"', 'i-layers', '시험성적서 공개', 'KATRI · SGS · 한일원자력'],
  ];
  return `<ul class="pd-trust" aria-label="구매 조건과 근거">${it.map(([tag, attr, ic, t, sub]) => `<li><${tag} class="pd-trust__i" ${tag === 'button' ? 'type="button" ' : ''}${attr}>${svg(ic)}<span><b>${esc(t)}</b>${esc(sub)}</span></${tag}></li>`).join('')}</ul>`;
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
    ${trustHTML29(p)}
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
    if (d.t === 't') return `<div class="dt-txt">${d.text.map(x => `<p>${esc(x)}</p>`).join('')}</div>`;
    if (d.t === 'v') return `<figure ${box}>${sk}<video data-src="${esc(d.src)}" poster="${esc(d.poster)}" muted loop playsinline preload="none" width="${d.w}" height="${d.h}" aria-hidden="true"></video></figure>`;
    if (d.t === 'y') return `<figure ${box}>${sk}${R.pic(d.poster, `alt="" width="1280" height="720" loading="lazy" decoding="async"`)}<button class="dt-yt" type="button" data-yt="${esc(d.id)}" data-title="${esc(d.title)}" aria-label="영상 재생: ${esc(d.title)}">${svg('i-play')}</button><figcaption class="sr-only">${esc(d.title)}</figcaption></figure>`;
    return `<figure ${box}>${sk}${R.pic(d.src, `alt="${esc(d.alt || `${p.short} 상세 이미지 ${i + 1}`)}" width="${d.w}" height="${d.h}" loading="lazy" decoding="async"`)}</figure>`;
  }).join('');
}
// 상품정보 제공고시(공식몰 원문, data.js NOTICE)
function noticeHTML(p) {
  const rows = NOTICE[p.id]; if (!rows) return '';
  return `<h3 class="pd-h3">상품정보 제공고시</h3><table class="info-tbl info-tbl--notice"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v.map(esc).join('<br>')}</td></tr>`).join('')}</tbody></table>`;
}
// 3단 상세 위 '한눈에 보기' — 상세 이미지 속 핵심 수치를 텍스트로 한 번 더(TESTS·OPTIONS 데이터에서)
function keysHTML(p) {
  if (p.id !== 29) return '';
  const k = [
    ['폼 밀도', '31.30kg/m³', 'KATRI 시험성적서 측정값'],
    ['내구성', '10만 회', '반복 압축 시험 KS M 6672:2016'],
    ['유해물질', '미검출', 'SGS 6대 유해물질 · KATRI 폼알데하이드'],
    ['라돈', '7.6Bq/m³ 미만', '한일원자력 · 환경부 권고 148Bq/m³'],
    ['두께', '7cm · 12cm', '침대형 · 바닥형'],
    ['생산', '대한민국', '폼부터 겉커버까지 국내 생산'],
  ];
  return `<section class="pd-keys" aria-labelledby="pd-keys-t"><h3 class="pd-keys__t" id="pd-keys-t">한눈에 보는 3단 접이식 매트리스</h3><dl class="pd-keys__g">${k.map(([a, b, c]) => `<div><dt>${esc(a)}</dt><dd><b>${esc(b)}</b><span>${esc(c)}</span></dd></div>`).join('')}</dl><p class="note">특허 제10-2378668호 「다층구조의 침대 매트리스」 · 시험 결과는 시료 기준이며, 성적서 이미지는 <a href="index.html#safety">홈 ‘기술력과 안전성’</a>에서 볼 수 있습니다.</p></section>`;
}
function specHTML(p) {
  return specBase(p) + noticeHTML(p);
}
function specBase(p) {
  if (p.id === 29) {
    const rows = [
      ['제품명', p.name], ['두께', '침대형 7cm · 바닥형 12cm'], ['사이즈', '멀티싱글 75 × 200cm · 슈퍼싱글 110 × 200cm · 퀸 150 × 200cm'],
      ['색상', '그레이 · 아이보리'], ['내장재', '4세대 고밀도 폼 (밀도 31kg/m³, KATRI 측정값 31.30kg/m³) · 100% 국산 폼'],
      ['커버', '에어론 솜을 넣은 누빔 커버 · 3개 지퍼로 분리 · 바닥면 미끄럼 방지 코팅'], ['원산지', '대한민국 (내장재 폼부터 겉커버까지 국내 생산)'],
      ['배송 형태', '압축 포장 (원래 크기로 복원까지 약 2일)'], ['세탁', '커버 찬물 단독 세탁 · 중성세제와 세탁망 권장 · 뜨거운 물과 건조기는 수축 원인'],
      ['보증', '2년 안에 폼이 꺼지면 폼 무상 교체'], ['판매원', '잠스쿨'],
    ];
    return `<table class="info-tbl"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table><h3 class="pd-h3">옵션별 크기 · 무게 · 판매가</h3>${R.specTable(O)}<p class="note" style="margin-top:10px">접은 크기는 폭 × 깊이 × 높이입니다. 정가와 할인가는 3단 상세페이지 이벤트 가격표(2026년 10월) 기준이며 쿠폰 적용 전 금액입니다.</p>`;
  }
  const rows = [['제품명', p.name], ['특징', p.points.length ? p.points.join(' · ') : p.summary], ['원산지', '대한민국'], ['판매원', '잠스쿨']];
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
    <nav class="crumb" aria-label="현재 위치"><a href="index.html">홈</a>${svg('i-right')}<a href="shop.html?cat=${p.cat}">${cat}</a>${svg('i-right')}<span aria-current="page">${esc(p.short)}</span></nav>
    <div class="pd__top">${galleryHTML(p)}${infoHTML(p)}</div>
  </div>
  <nav class="pd-tabs" aria-label="상품 정보 메뉴"><div class="wrap"><a href="#detail" aria-current="true">상세정보</a><a href="#spec">제품 정보</a><a href="#reviews">구매평 <small>${p.reviews.toLocaleString('ko-KR')}</small></a><a href="#qna">Q&amp;A</a><a href="#ship">배송·교환</a></div></nav>
  <section class="pd-sec" id="detail" aria-labelledby="detail-t"><div class="wrap wrap--narrow"><h2 class="pd-h2" id="detail-t">상세정보</h2>${keysHTML(p)}<div class="dt-wrap is-folded" id="dt-wrap">${detailHTML(p)}<div class="dt-more"><button class="btn btn--line" type="button" id="dt-more" aria-expanded="false" aria-controls="dt-wrap">상세정보 펼쳐보기${svg('i-down')}</button></div></div></div></section>
  <section class="pd-sec" id="spec" aria-labelledby="spec-t"><div class="wrap wrap--narrow"><h2 class="pd-h2" id="spec-t">제품 정보</h2>${specHTML(p)}</div></section>
  <section class="pd-sec" id="reviews" aria-labelledby="reviews-t"><div class="wrap wrap--narrow"><h2 class="pd-h2" id="reviews-t">구매평</h2>${reviewsHTMLp(p)}</div></section>
  <section class="pd-sec" id="qna" aria-labelledby="qna-t"><div class="wrap wrap--narrow"><h2 class="pd-h2" id="qna-t">자주 묻는 질문</h2>${qnaHTML(p)}</div></section>
  <section class="pd-sec" id="ship" aria-labelledby="ship-t"><div class="wrap wrap--narrow"><h2 class="pd-h2" id="ship-t">배송 · 교환 · 반품</h2>${SHIP}</div></section>
  <section class="section section--soft" aria-labelledby="rel-t"><div class="wrap"><div class="sec-head"><h2 class="h-sec" id="rel-t" style="font-size:clamp(22px,5vw,30px)">함께 보면 좋은 상품</h2></div><div class="pgrid">${related.map(x => R.productCard(x)).join('')}</div></div></section>
</main>
<div class="buybar" id="buybar"><button class="icon-btn pd-wish" type="button" data-wish="${p.id}" aria-pressed="false" aria-label="찜하기">${R.ICON.heart}</button><a class="buybar__rv" href="#reviews"><span>구매평</span><b>${p.reviews.toLocaleString('ko-KR')}</b></a><button class="btn btn--primary" type="button" id="bb-buy">구매하기</button></div>
<div class="layer sheet" id="buy" role="dialog" aria-modal="true" aria-labelledby="buy-t" aria-hidden="true" hidden><div class="layer__dim"></div><div class="sheet__box"><div class="sheet__grip" aria-hidden="true"></div><div class="drawer__head" style="border:0"><h2 id="buy-t">옵션 선택</h2><button class="icon-btn" type="button" data-close aria-label="닫기">${svg('i-x')}</button></div><div class="drawer__body" id="buy-slot"></div><div class="drawer__foot"><div class="pd-btns" style="margin:0"><button class="btn btn--line" type="button" id="sh-cart">장바구니</button><button class="btn btn--primary" type="button" id="sh-buy">구매하기</button></div></div></div></div>`;
}
function productLD(p) {
  const url = SITE + `product-${p.id}.html`;
  const offers = p.full
    ? { '@type': 'AggregateOffer', priceCurrency: 'KRW', lowPrice: Math.min(...Object.values(O.price)), highPrice: Math.max(...Object.values(O.price)), offerCount: Object.keys(O.price).length * O.color.length, availability: 'https://schema.org/InStock', url, seller: { '@id': SITE + '#org' } }
    : { '@type': 'Offer', priceCurrency: 'KRW', price: p.price, availability: 'https://schema.org/InStock', url, seller: { '@id': SITE + '#org' } };
  // 별점·리뷰(aggregateRating·review)는 넣지 않는다: 구매평이 모두 스마트스토어(다른 사이트)에서 모은 것이라
  // 구글 리뷰 스니펫 정책("다른 사이트의 리뷰·평점을 모아 표시하지 말 것") 위반 → 수동 조치 위험. 화면 표시는 출처와 함께 그대로.
  const prod = {
    '@type': 'Product', '@id': url + '#product', name: p.name, description: p.summary + (p.points.length ? ' · ' + p.points.join(' · ') : ''),
    image: p.imgs.slice(0, 4).map(i => SITE + i), brand: { '@type': 'Brand', name: '잠스쿨' }, sku: `JAM-${p.id}`, countryOfOrigin: 'KR', offers,
  };
  if (p.id === 29) {
    prod.additionalProperty = [
      { '@type': 'PropertyValue', name: '폼 밀도', value: '31.30', unitText: 'kg/m³' },
      { '@type': 'PropertyValue', name: '두께', value: '7cm(침대형), 12cm(바닥형)' },
      { '@type': 'PropertyValue', name: '펼친 크기', value: '75×200, 110×200, 150×200cm' },
      { '@type': 'PropertyValue', name: '라돈 검출', value: '7.6Bq/m³ 미만(한일원자력)' },
      { '@type': 'PropertyValue', name: '특허', value: '제10-2378668호 다층구조의 침대 매트리스' },
    ];
  }
  const graph = [ORG, prod, { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: '홈', item: SITE }, { '@type': 'ListItem', position: 2, name: '전체 상품', item: SITE + 'shop.html' }, { '@type': 'ListItem', position: 3, name: p.short, item: url }] }];
  if (p.id === 29) graph.push({ '@type': 'FAQPage', mainEntity: FAQ.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.join(' ') } })) });
  return ld({ '@context': 'https://schema.org', '@graph': graph });
}
for (const p of PRODUCTS) {
  let s = tpl;
  // 검색 제목·설명: 네이버 권장 40자·80자 이내, 수치 대신 브랜드·상품명 위주(2026-10-30 서치어드바이저 간단 체크)
  // '국내에서 만든'은 근거가 확인된 상품만: 제공고시 제조국 대한민국(30·36) 또는 상세 이미지 'Made in Korea·100% 국내 생산'(29·37·38·39·40·44). 41·43 미확인
  const MADE_KR = new Set([29, 30, 36, 37, 38, 39, 40, 44]);
  const title = p.id === 29 ? '잠스쿨 3단 접이식 매트리스 | 탄탄한 바닥·침대 겸용 매트리스' : `잠스쿨 ${p.short} | 공식 홈페이지`;
  const desc = p.id === 29
    ? '잠스쿨 3단 접이식 매트리스. 바닥과 침대 위 모두 쓰는 탄탄한 접는 매트리스로, 국내에서 만들고 겉커버를 분리해 세탁할 수 있습니다.'
    : `${p.name}. ${p.summary.split(' · ')[0]}. ${MADE_KR.has(p.id) ? '국내에서 만든 잠스쿨 제품, 공식' : '잠스쿨 공식'} 홈페이지에서 자세히 보세요.`;
  s = fill(s, 'title', esc(title)); s = fill(s, 'desc', esc(desc)); s = fill(s, 'canonical', SITE + `product-${p.id}.html`);
  s = fill(s, 'ogimg', SITE + p.imgs[0]); s = fill(s, 'jsonld', productLD(p)); s = fill(s, 'main', mainHTML(p));
  s = fill(s, 'extra-js', '');
  wr(`product-${p.id}.html`, picturize(s));
}

// ───────── 진열·장바구니·주문서·주문 완료 (src/page.tpl.html + src/pages/*.html)
const { CATEGORIES, CHECKOUT } = JAM;
const pageTpl = includes(rd('src/page.tpl.html'));
const NOINDEX = '<meta name="robots" content="noindex, nofollow">';
const steps = n => `<ol class="steps" aria-label="주문 단계">${['장바구니', '주문서', '주문 완료'].map((t, i) => `<li${i + 1 === n ? ' aria-current="step"' : i + 1 < n ? ' class="is-done"' : ''}><span>${i + 1 < n ? svg('i-check') : i + 1}</span>${t}</li>`).join('')}</ol>`;
function page(file, o) {
  let s = pageTpl;
  s = fill(s, 'robots', o.noindex ? NOINDEX : '');
  s = fill(s, 'title', esc(o.title)); s = fill(s, 'desc', esc(o.desc)); s = fill(s, 'canonical', SITE + file);
  s = fill(s, 'ogimg', SITE + (o.ogimg || 'assets/video/hero-desktop.jpg')); s = fill(s, 'jsonld', o.jsonld || '');
  s = fill(s, 'bodyclass', o.bodyclass); s = fill(s, 'main', o.main);
  s = fill(s, 'js', o.js.map(f => `<script src="assets/js/${f}"></script>`).join('\n'));
  wr(file, picturize(s));
}

// 전체 상품(진열)
function shopMain() {
  const p29 = PRODUCTS.find(p => p.id === 29);
  const n = id => PRODUCTS.filter(p => p.cat === id).length;
  const mat = PRODUCTS.filter(p => p.cat === 'mattress');
  const cmp = mat.map(p => `<tr><th scope="row"><a href="${R.href(p)}">${R.pic(p.imgs[0], 'alt="" width="64" height="64" loading="lazy"')}<span>${esc(p.short)}</span></a></th><td data-k="특징">${esc(p.summary)}</td><td data-k="판매가"><b>${won(p.price)}${p.full ? '부터' : ''}</b></td><td data-k="구매평"><span class="star1" aria-hidden="true">★</span> ${p.rating.toFixed(2)} <span class="cmp-tbl__n">(${p.reviews.toLocaleString('ko-KR')})</span></td></tr>`).join('');
  return `<main id="main" class="shop">
  <div class="wrap">
    <nav class="crumb" aria-label="현재 위치"><a href="index.html">홈</a>${svg('i-right')}<span aria-current="page">전체 상품</span></nav>
    <header class="shop-head">
      <div class="shop-head__txt"><p class="eyebrow">SHOP</p><h1 class="shop-head__t">잠스쿨 전체 상품</h1><p class="shop-head__d">매트리스부터 베개·쿠션까지, 공식몰에서 파는 상품 ${PRODUCTS.length}가지를 한곳에 모았습니다.</p></div>
      <ul class="shop-perks">
        <li>${svg('i-truck')}<span><b>기본 무료배송</b>오후 1시 이전 결제 시 당일 출고</span></li>
        <li>${svg('i-cal')}<span><b>14일 무료체험</b>3단 접이식 매트리스 · 기간 한정</span></li>
        <li>${svg('i-shield')}<span><b>2년 폼 교체 보증</b>3단 접이식 매트리스</span></li>
        <li>${svg('i-star')}<span><b>결제 금액 1% 적립</b>공식몰 회원 주문</span></li>
      </ul>
    </header>
    <a class="shop-feat" href="${R.href(p29)}">
      <div class="shop-feat__img">${R.pic(p29.imgs[0], 'alt="" width="600" height="600" fetchpriority="high"')}</div>
      <div class="shop-feat__txt"><p class="shop-feat__k"><span class="badge badge--best">BEST</span>구매평 ${p29.reviews.toLocaleString('ko-KR')}건 · 평점 ${p29.rating.toFixed(2)}</p><h2 class="shop-feat__t">${esc(p29.short)}</h2><p class="shop-feat__d">${esc(p29.summary)}</p><p class="shop-feat__p"><span class="rate">${R.rate(p29)}%</span><b>${won(p29.price)}</b>부터</p><span class="link-more">두께·사이즈 고르러 가기${svg('i-right')}</span></div>
    </a>
    <div class="shop-list">
    <div class="shop-bar" id="shop-bar">
      <div class="chips shop-cats" role="tablist" aria-label="상품 분류" id="shop-cats">
        <button class="chip" type="button" role="tab" aria-selected="true" data-f="all">전체<span class="chip__n">${PRODUCTS.length}</span></button>
        ${CATEGORIES.map(c => `<button class="chip" type="button" role="tab" aria-selected="false" tabindex="-1" data-f="${c.id}">${esc(c.label)}<span class="chip__n">${n(c.id)}</span></button>`).join('')}
        <button class="chip" type="button" role="tab" aria-selected="false" tabindex="-1" data-f="wish">찜한 상품<span class="chip__n" id="wish-n">0</span></button>
      </div>
      <p class="shop-count" aria-live="polite"><b id="shop-n">${PRODUCTS.length}</b>개 상품</p>
      <div class="shop-sort">
        <label class="sr-only" for="shop-sort">정렬</label>
        <select class="inp select select--sm" id="shop-sort"><option value="reco">추천순</option><option value="rv">구매평 많은순</option><option value="rating">평점 높은순</option><option value="low">낮은 가격순</option><option value="high">높은 가격순</option><option value="rate">할인율 높은순</option></select>
      </div>
    </div>
    <p class="shop-desc" id="shop-desc" aria-live="polite"></p>
    <div class="pgrid shop-grid" id="shop-grid">${PRODUCTS.map(p => R.productCard(p)).join('')}</div>
    <div class="shop-empty" id="shop-empty" hidden><p class="cp-empty__t">아직 찜한 상품이 없습니다</p><p class="cp-empty__d">상품 사진의 하트를 누르면 이곳에 모입니다.</p></div>
    </div>
    <section class="shop-cmp" aria-labelledby="cmp-t">
      <div class="sec-head" style="margin-bottom:18px"><p class="eyebrow">COMPARE</p><h2 class="shop-cmp__t" id="cmp-t">매트리스 ${mat.length}종 한눈에 보기</h2><p class="shop-cmp__d">쿠션감과 두께를 먼저 보고 고르세요. 3단 접이식은 두께와 사이즈에 따라 가격이 달라집니다.</p></div>
      <div class="cmp-wrap"><table class="cmp-tbl"><thead><tr><th scope="col">상품</th><th scope="col">특징</th><th scope="col">판매가</th><th scope="col">구매평</th></tr></thead><tbody>${cmp}</tbody></table></div>
      <p class="note" style="margin-top:10px">판매가는 할인가 기준, 구매평 수는 2026년 10월 공식몰 기준입니다.</p>
    </section>
    <section class="cp-more" id="shop-recent" aria-labelledby="recent-t" hidden><h2 class="cp-more__t" id="recent-t">최근 본 상품</h2><div class="mini-row" id="recent-row"></div></section>
  </div>
</main>`;
}
page('shop.html', {
  title: '잠스쿨 전체 상품 | 3단 접이식 매트리스·토퍼·베개',
  desc: '잠스쿨 전체 상품. 3단 접이식 매트리스와 떡실신·양면 매트리스, 메모리폼 토퍼, 경추 베개·다리베개·쿨매트까지 한곳에서 보세요.',
  bodyclass: 'page-shop', main: shopMain(), js: ['shop.js'], ogimg: PRODUCTS[0].imgs[0],
  jsonld: ld({ '@context': 'https://schema.org', '@graph': [ORG,
    { '@type': 'CollectionPage', '@id': SITE + 'shop.html#page', name: '잠스쿨 전체 상품', url: SITE + 'shop.html', inLanguage: 'ko-KR', isPartOf: { '@id': SITE + '#site' },
      mainEntity: { '@type': 'ItemList', numberOfItems: PRODUCTS.length, itemListElement: PRODUCTS.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + R.href(p), name: p.name })) } },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: '홈', item: SITE }, { '@type': 'ListItem', position: 2, name: '전체 상품', item: SITE + 'shop.html' }] }] }),
});

// 장바구니·주문서·주문 완료: 검색 노출 안 함(운영에서도 noindex)
{
  let main = rd('src/pages/cart.html');
  main = fill(main, 'steps', steps(1)); main = fill(main, 'shipnote', esc(CHECKOUT.shipNote));
  main = fill(main, 'recos', PRODUCTS.filter(p => p.cat === 'bedding').map(p => R.productCard(p)).join(''));
  page('cart.html', { title: '장바구니 | 잠스쿨', desc: '잠스쿨 장바구니', noindex: true, bodyclass: 'page-cart', main, js: ['cart.js'] });
}
{
  const PAY = CHECKOUT.pay.map((m, i) => `<button class="paym__opt${m.id === 'npay' ? ' paym__opt--npay' : ''}" type="button" role="radio" aria-checked="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-v="${m.id}">${m.id === 'npay' ? '<b class="npay-mark" aria-hidden="true">N</b>' : ''}${esc(m.label)}</button>`).join('');
  const dl = rows => `<dl class="agree__dl">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  const AGREE = [
    { id: 'ag-order', t: '주문할 상품의 정보와 결제 금액을 확인했으며, 결제에 동의합니다' },
    { id: 'ag-priv', t: '개인정보 수집·이용에 동의합니다 (비회원 주문)', body: dl([
      ['수집 항목', '주문하는 분 이름·휴대폰 번호·이메일(선택), 받는 분 이름·휴대폰 번호·주소·배송 메모, 결제 기록'],
      ['이용 목적', '주문 확인, 상품 배송, 결제·환불, 교환·반품과 고객 상담'],
      ['보유 기간', '전자상거래법에 따라 계약·청약철회·대금결제·재화 공급 기록은 5년, 소비자 불만·분쟁 처리 기록은 3년 보관한 뒤 파기합니다.'],
      ['처리 위탁', `상품 배송을 위해 ${CHECKOUT.couriers}에 받는 분 정보를 맡깁니다.`],
    ]) + '<p>동의하지 않을 수 있으며, 동의하지 않으면 비회원으로 주문할 수 없습니다.</p>' },
    { id: 'ag-mat', mat: true, t: '매트리스는 압축 포장으로 배송되며, 포장을 연 뒤에는 단순 변심 반품이 어려울 수 있음을 확인했습니다', body: '<p>14일 무료체험 대상 상품은 체험 조건을 따릅니다(반품 시 왕복 배송비 매트리스 36,000원 고객 부담). 교환·반품은 받은 날부터 7일 이내에 고객센터(010-9610-8868)로 먼저 요청해 주세요. 제품 하자는 배송비를 받지 않습니다.</p>' },
  ];
  const agree = AGREE.map(a => `<div class="agree__item"${a.mat ? ' data-mat hidden' : ''}><label class="ck"><input type="checkbox" class="ag" id="${a.id}"${a.mat ? ' disabled' : ''}><span class="ck__box" aria-hidden="true"></span><span><em class="agree__req">필수</em>${esc(a.t)}</span></label>${a.body ? `<button class="agree__more" type="button" aria-expanded="false" aria-controls="${a.id}-d">내용 보기</button><div class="agree__d" id="${a.id}-d" hidden>${a.body}</div>` : ''}</div>`).join('');
  let main = rd('src/pages/checkout.html');
  main = fill(main, 'steps', steps(2)); main = fill(main, 'shipnote', esc(CHECKOUT.shipNote)); main = fill(main, 'couriers', esc(CHECKOUT.couriers));
  main = fill(main, 'paym', PAY); main = fill(main, 'agree', agree);
  main = fill(main, 'pvnote', CHECKOUT.mode === 'pg' ? '' : '<p class="co-pv" role="note"><b>미리보기</b>결제 연동 전이라 마지막 단계에서 실제 결제는 진행되지 않습니다. 화면 흐름만 확인해 주세요.</p>');
  page('checkout.html', { title: '주문서 작성 | 잠스쿨', desc: '잠스쿨 주문서', noindex: true, bodyclass: 'page-checkout', main, js: ['checkout.js'] });
}
{
  let main = rd('src/pages/order-complete.html');
  main = fill(main, 'steps', steps(3));
  page('order-complete.html', { title: '주문 완료 | 잠스쿨', desc: '잠스쿨 주문 완료', noindex: true, bodyclass: 'page-done', main, js: ['complete.js'] });
}
console.log('shop pages: shop.html, cart.html, checkout.html, order-complete.html');

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
  s = fill(s, 'canonical', SITE + 'blog/'); s = fill(s, 'ogimg', SITE + ((POSTS.find(p => p.thumb) || {}).thumb || 'assets/video/hero-desktop.jpg'));
  s = fill(s, 'cats', ['<button class="chip" type="button" aria-pressed="true" data-f="all">전체</button>', ...CATS.map(c => `<button class="chip" type="button" aria-pressed="false" data-f="${esc(c)}">${esc(c)}</button>`)].join(''));
  s = fill(s, 'list', POSTS.map(p => R.postCard(p).replace('<article class="post-card">', `<article class="post-card" data-c="${esc(p.category)}">`)).join('') || '<p class="note">첫 글을 준비하고 있습니다.</p>');
  s = fill(s, 'jsonld', ld({ '@context': 'https://schema.org', '@graph': [ORG, { '@type': 'Blog', '@id': SITE + 'blog/#blog', name: '잠스쿨 수면 가이드', url: SITE + 'blog/', inLanguage: 'ko-KR', publisher: { '@id': SITE + '#org' }, blogPost: POSTS.map(p => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE}blog/${p.slug}.html`, datePublished: p.date })) }] }));
  wr('blog/index.html', picturize(s));
}
for (const p of POSTS) {
  const url = `${SITE}blog/${p.slug}.html`;
  let s = blogShell('blog-post.tpl.html', `blog/${p.slug}.html`);
  s = fill(s, 'title', esc([...p.title].length + 6 <= 40 ? `${p.title} | 잠스쿨` : p.title)); s = fill(s, 'desc', esc(p.description)); s = fill(s, 'canonical', url);
  const prod = PRODUCTS.find(x => String(x.id) === String(p.product || 29)) || P29card;
  const img = p.thumb || prod.imgs[0];
  s = fill(s, 'ogimg', SITE + img); s = fill(s, 'date', esc(p.date));
  s = fill(s, 'hero', p.thumb ? `<figure class="post__hero">${R.pic(p.thumb, `alt="${esc(p.title)}" width="1200" height="630" fetchpriority="high" decoding="async"`)}</figure>` : ''); s = fill(s, 'datetxt', esc(p.date.replace(/-/g, '.')));
  s = fill(s, 'cat', esc(p.category)); s = fill(s, 'author', esc(p.author || '잠스쿨 편집팀')); s = fill(s, 'minutes', String(p.minutes));
  s = fill(s, 'toc', p.toc.length > 2 ? `<nav class="post__toc" aria-label="목차"><p>이 글의 순서</p><ol>${p.toc.map(t => `<li><a href="blog/${esc(p.slug)}.html#${t.id}">${esc(t.t)}</a></li>`).join('')}</ol></nav>` : '');
  s = fill(s, 'body', p.html);
  s = fill(s, 'faq', p.faq.length ? `<section class="post-faq" aria-labelledby="pf-t"><h2 id="pf-t">자주 묻는 질문</h2><div class="acc">${p.faq.map((f, i) => R.accItem(`pf-${i}`, f.q, f.html)).join('')}</div></section>` : '');
  s = fill(s, 'cta', `<aside class="post-cta" aria-label="관련 상품">${R.pic(prod.imgs[0], `alt="" width="96" height="96" loading="lazy"`)}<div><b>${esc(prod.name)}</b><span>${esc(prod.summary)} · ${won(prod.price)}${prod.full ? '부터' : ''}</span><a class="btn btn--primary btn--sm" href="${R.href(prod)}">상품 보기</a></div></aside>`);
  // 함께 읽을 글: 같은 상품 글 먼저, 그다음 최신순
  const rel = POSTS.filter(x => x.slug !== p.slug).map((x, i) => [x, (String(x.product || 29) === String(p.product || 29) ? 0 : 1000) + i]).sort((a, b) => a[1] - b[1]).slice(0, 3).map(a => a[0]);
  s = fill(s, 'related', rel.length ? `<section class="post-related" aria-labelledby="pr-t"><h2 id="pr-t">함께 읽으면 좋은 글</h2><div class="post-grid">${rel.map(x => R.postCard(x)).join('')}</div></section>` : '');
  const graph = [ORG,
    { '@type': 'BlogPosting', '@id': url + '#post', headline: p.title, description: p.description, datePublished: p.date, dateModified: p.updated || p.date, inLanguage: 'ko-KR', url, mainEntityOfPage: url, image: SITE + img, author: { '@type': 'Organization', name: p.author || '잠스쿨 편집팀', url: SITE }, publisher: { '@id': SITE + '#org' }, keywords: p.tags.join(', '), about: { '@type': 'Product', name: prod.name, url: SITE + R.href(prod) } },
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
wr('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${SITE}</loc><lastmod>${today}</lastmod></url>\n<url><loc>${SITE}shop.html</loc><lastmod>${today}</lastmod></url>\n${PRODUCTS.map(p => `<url><loc>${SITE}product-${p.id}.html</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n<url><loc>${SITE}blog/</loc><lastmod>${today}</lastmod></url>\n${POSTS.map(p => `<url><loc>${SITE}blog/${p.slug}.html</loc><lastmod>${p.updated || p.date}</lastmod></url>`).join('\n')}\n</urlset>\n`);
wr('robots.txt', `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${SITE}sitemap.xml\n`);
const P29 = PRODUCTS[0];
wr('llms.txt', `# 잠스쿨 (JAMSCHOOL)

> 잠스쿨은 국내 생산 매트리스 브랜드입니다. 대표 제품은 3단 접이식 매트리스이며, 폼부터 겉커버까지 국내에서 생산합니다.

## 대표 제품: 잠스쿨 허리에 좋은 3단 접이식 매트리스
- 두께: 침대형 7cm(침대 프레임 위), 바닥형 12cm(바닥 또는 침대). 고객의 70% 이상이 바닥형을 선택.
- 사이즈(펼침): 멀티싱글 75×200cm, 슈퍼싱글 110×200cm, 퀸 150×200cm. 접으면 깊이 67cm, 높이 21cm(7cm형)·36cm(12cm형).
- 무게: 7cm형 3.5/5/6.5kg, 12cm형 5.5/8/11.5kg (멀티싱글/슈퍼싱글/퀸).
- 할인가(정가) — 상세페이지 이벤트 가격표 기준, 멀티싱글/슈퍼싱글/퀸: 7cm ${['MS', 'SS', 'Q'].map(z => `${won(O.price['7-' + z])}(${won(O.list['7-' + z])})`).join(' / ')}, 12cm ${['MS', 'SS', 'Q'].map(z => `${won(O.price['12-' + z])}(${won(O.list['12-' + z])})`).join(' / ')}.
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

## 그 밖의 제품 (전체 목록 ${SITE}shop.html)
${PRODUCTS.slice(1).map(p => `- ${p.name}: ${p.summary}. ${won(p.price)}. ${SITE}product-${p.id}.html`).join('\n')}

## 가격대 (${MARKET.source} ${MARKET.basis}, ${MARKET.date} 조회)
${MARKET.bands.map(b => `- ${b.k}(${b.sub}): ${won(b.lo)}~${won(b.hi)}`).join('\n')}
- 잠스쿨 바닥형 12cm 슈퍼싱글: ${won(MARKET.ours.v)} — 폼 매트리스 중 높은 가격대, 스프링 내장·천연라텍스와 비슷한 가격대.

## 수면 가이드 (블로그)
${POSTS.map(p => `- ${p.title}: ${p.description} ${SITE}blog/${p.slug}.html`).join('\n') || '- 준비 중'}

## 판매처
공식몰 ${SITE}, 네이버 스마트스토어 https://smartstore.naver.com/healingq, 11번가, 오늘의집, GS샵, 현대Hmall

## 회사
상호 잠스쿨 · 대표 노치영 · 사업자등록번호 841-45-00474 · 통신판매업신고 제2019-서울강서-2200호 · 서울특별시 강서구 강서로45길 104, 101동 305호 (내발산동, 대성유니드아파트) · 고객센터 010-9610-8868(평일 09:00~17:00) · jamsale33@gmail.com
`);
console.log('built: index.html,', PRODUCTS.map(p => `product-${p.id}.html`).join(', '), ', sitemap.xml, robots.txt, llms.txt');
console.log(`detail manifests: ${Object.keys(DETAIL).join(', ') || '없음'}`);
if (SEO_LONG.length) console.log(`검색 제목·설명 권장 길이 초과(제목 40·설명 80자): ${SEO_LONG.join(', ')}`);
if (noWebp.length) console.warn(`WebP 없는 이미지 ${noWebp.length}개(원본 img 로 출력됨) — python ../motion/tools/to_webp.py assets/img 로 만들 수 있음:\n  ${noWebp.slice(0, 10).join('\n  ')}`);
