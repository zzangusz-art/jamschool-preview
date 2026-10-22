/* 마크업 렌더러 — 브라우저(런타임)와 Node(build.mjs 정적 생성)에서 같이 쓴다 */
(function (G) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => n.toLocaleString('ko-KR') + '원';
  // 할인율: 정가 대비 할인가, 소수점 아래 버림(네이버 스마트스토어 표기와 같은 방식)
  const rateOf = (list, price) => Math.floor((1 - price / list) * 100 + 1e-9);
  const rate = p => rateOf(p.list, p.price);
  const href = p => `product-${p.id}.html`;
  // WebP: assets/img 의 jpg/png 는 같은 이름 .webp 가 옆에 있다(원본은 폴백). 빌드는 G.WEBP(실제 있는 파일 목록)로 확인
  const webp = s => String(s).replace(/\.(jpe?g|png)$/i, '.webp');
  const hasWebp = s => /^assets\/img\/.+\.(jpe?g|png)$/i.test(s) && (!G.WEBP || G.WEBP.has(webp(s)));
  const pic = (src, attrs = '') => hasWebp(src)
    ? `<picture><source srcset="${esc(webp(src))}" type="image/webp"><img src="${esc(src)}" ${attrs}></picture>`
    : `<img src="${esc(src)}" ${attrs}>`;
  // <picture> 안의 img 주소를 바꿀 때(라이트박스·빠른보기) source 도 같이 바꾼다
  function swap(img, src) {
    const s = img.parentElement && img.parentElement.tagName === 'PICTURE' && img.parentElement.querySelector('source');
    if (s) { if (hasWebp(src)) s.srcset = webp(src); else s.removeAttribute('srcset'); }
    img.src = src;
  }
  const ICON = {
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.3 0 5.6 3.1 4.4 6.6C19.5 15.9 12 20.5 12 20.5z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7"/></svg>',
  };
  function badge(b) {
    const m = { BEST: 'best', SALE: 'sale', MD: 'md', '오늘출발': 'today' };
    return `<span class="badge badge--${m[b] || 'md'}">${esc(b === 'MD' ? 'MD추천' : b)}</span>`;
  }
  function productCard(p, wished = false) {
    return `<article class="pcard is-loading" data-id="${p.id}" data-cat="${p.cat}">
      <div class="pcard__thumb"><div class="sk" aria-hidden="true"></div>
        ${pic(p.imgs[0], `alt="${esc(p.name)}" loading="lazy" width="600" height="600" decoding="async"`)}
        ${p.imgs[1] ? pic(p.imgs[1], 'class="alt" alt="" loading="lazy" width="600" height="600" decoding="async"') : ''}
        <div class="pcard__badges">${p.badges.map(badge).join('')}</div>
        <div class="pcard__acts">
          <button class="pcard__act" type="button" data-wish="${p.id}" aria-pressed="${wished}" aria-label="${esc(p.short)} 찜하기">${ICON.heart}</button>
          <button class="pcard__act" type="button" data-quick="${p.id}" aria-label="${esc(p.short)} 빠른 보기">${ICON.eye}</button>
        </div>
      </div>
      <div class="pcard__body">
        <p class="pcard__brand">${esc(p.brand || '잠스쿨')}</p>
        <h3 class="pcard__name">${esc(p.name)}</h3>
        <p class="pcard__list"><span class="sr-only">정가</span>${won(p.list)}</p>
        <p class="pcard__price"><span class="rate">${rate(p)}%</span><span><span class="sr-only">판매가</span>${won(p.price)}${p.full ? '~' : ''}</span></p>
        <p class="pcard__rv"><span class="star1" aria-hidden="true">★</span><b><span class="sr-only">평점 </span>${p.rating.toFixed(2)}</b><span class="pcard__rvn">· 리뷰 ${p.reviews.toLocaleString('ko-KR')}</span></p>
      </div>
      <a class="pcard__link" href="${href(p)}" aria-label="${esc(p.name)} 상세 보기"></a>
    </article>`;
  }
  function accItem(id, q, body, tag) {
    return `<div class="acc__item"><h3 class="acc__h"><button class="acc__btn" type="button" aria-expanded="false" aria-controls="${id}" id="${id}-b">${tag ? `<span class="tag">${esc(tag)}</span>` : ''}<span class="q">${esc(q)}</span><span class="pm" aria-hidden="true"></span></button></h3><div class="acc__panel" id="${id}" role="region" aria-labelledby="${id}-b"><div>${body}</div></div></div>`;
  }
  function faqHTML(list, prefix = 'faq') {
    return list.map((f, i) => `<div data-c="${f.c}">${accItem(`${prefix}-${i}`, f.q, f.a.map(p => `<p>${esc(p)}</p>`).join(''))}</div>`).join('');
  }
  function testsHTML(list) {
    return list.map((t, i) => accItem(`test-${i}`, t.q,
      `<table class="result-table"><tbody><tr><th scope="row">시험 기관</th><td>${esc(t.org)}</td></tr>${t.rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>${t.note ? `<p class="note" style="margin-top:10px">${esc(t.note)}</p>` : ''}<button class="btn btn--line btn--sm cert-btn" type="button" data-cert="${i}">성적서 이미지 보기</button>`, t.tag)).join('');
  }
  function reviewsHTML(list) {
    return list.map((r, i) => `<article class="rv"><div class="rv__top"><span class="stars" style="--v:5" aria-label="별점 5점"></span><span class="rv__best">BEST 구매평</span></div><p class="rv__text" id="rv-${i}">${esc(r.text)}</p><button class="rv__more" type="button" aria-expanded="false" aria-controls="rv-${i}">더보기</button><p class="rv__foot">${esc(r.id)} · 스마트스토어 구매평</p></article>`).join('');
  }
  function usesHTML(list) {
    const tabs = list.map((u, i) => `<button class="tab" role="tab" id="use-t${i}" aria-controls="use-p" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(u.t)}</button>`).join('');
    const u = list[0];
    return { tabs, panel: usePanel(u) };
  }
  function usePanel(u) {
    return `<div class="use"><div class="use__img">${pic(u.img, `alt="${esc(u.t)} 사용 장면" width="860" height="560" loading="lazy"`)}</div><div><h3>${esc(u.t)}</h3><p>${esc(u.d)}</p><ul>${u.li.map(l => `<li>${ICON.ok}<span>${esc(l)}</span></li>`).join('')}</ul></div></div>`;
  }
  function specTable(o) {
    const rows = [];
    for (const t of o.thickness) for (const s of o.size) {
      const k = `${t.id}-${s.id}`;
      rows.push(`<tr><th scope="row">${esc(t.label)} ${esc(t.sub)} · ${esc(s.label)}</th><td>${s.w} × ${o.length} × ${t.id}cm</td><td>${s.w} × ${o.depthFolded} × ${o.folded[t.id]}cm</td><td>${o.weight[k]}kg</td><td><s class="spec-tbl__list">${won(o.list[k])}</s> ${won(o.price[k])}</td></tr>`);
    }
    return `<div class="tbl-wrap"><table class="spec-tbl"><caption class="sr-only">3단 접이식 매트리스 옵션별 크기·무게·판매가</caption><thead><tr><th scope="col">옵션</th><th scope="col">펼친 크기</th><th scope="col">접은 크기</th><th scope="col">무게</th><th scope="col">정가 · 할인가</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  // ── 기능
  function featuresHTML(list) {
    return `<div class="feat-grid">${list.map((f, i) => `<article class="feat" data-reveal="${(i % 3) + 1}"><span class="feat__ic"><svg aria-hidden="true"><use href="#${f.icon}"/></svg></span><p class="feat__tag">${esc(f.tag)}</p><h3>${esc(f.t)}</h3><p>${esc(f.d)}</p></article>`).join('')}</div>`;
  }
  // ── 가격 (두께 탭 × 사이즈 카드). 보증 2년(730일) 기준 하루 비용은 단순 나눗셈
  const perDay = v => Math.round(v / 730);
  function priceHTML(o) {
    const tabs = o.thickness.map((t, i) => `<button class="tab" role="tab" id="pr-t${t.id}" aria-controls="pr-p${t.id}" aria-selected="${t.id === '12'}" tabindex="${t.id === '12' ? 0 : -1}">${esc(t.label)} ${esc(t.sub)}</button>`).join('');
    const panels = o.thickness.map(t => `<div class="price-grid" role="tabpanel" id="pr-p${t.id}" aria-labelledby="pr-t${t.id}"${t.id === '12' ? '' : ' hidden'}>${o.size.map(s => {
      const k = `${t.id}-${s.id}`, v = o.price[k], L = o.list[k], hot = k === '12-SS';
      return `<article class="pc${hot ? ' pc--hot' : ''}">${hot ? '<p class="pc__badge">성인 1인 추천</p>' : ''}
        <h3 class="pc__name">${esc(s.label)}<span>${s.w} × 200 × ${t.id}cm</span></h3>
        <p class="pc__list"><span class="sr-only">정가 </span><s>${won(L)}</s></p>
        <p class="pc__price"><span class="rate">${rateOf(L, v)}%</span><b><span class="sr-only">할인가 </span>${won(v)}</b></p>
        <p class="pc__day">2년 보증 기준 하루 약 <b>${perDay(v).toLocaleString('ko-KR')}원</b></p>
        <dl class="pc__spec"><div><dt>접은 크기</dt><dd>${s.w} × ${o.depthFolded} × ${o.folded[t.id]}cm</dd></div><div><dt>무게</dt><dd>${o.weight[k]}kg</dd></div><div><dt>추천</dt><dd>${esc(s.note)}</dd></div></dl>
        <div class="pc__cta"><button class="btn ${hot ? 'btn--primary' : 'btn--line'} btn--block" type="button" data-add29="${t.id}-${s.id}">장바구니 담기</button></div>
      </article>`;
    }).join('')}</div>`).join('');
    return { tabs, panels };
  }
  // ── 시세 비교 (유형별 가격 범위 + 잠스쿨 위치)
  const man = v => (v / 10000).toFixed(1).replace(/\.0$/, '') + '만';
  function marketHTML(m) {
    const pct = v => (v / m.max * 100).toFixed(2) + '%';
    const rows = m.bands.map(b => `<li class="mk__row"><p class="mk__k">${esc(b.k)}<span>${esc(b.sub)}</span></p><div class="mk__track"><span class="mk__bar" style="left:${pct(b.lo)};width:calc(${pct(b.hi)} - ${pct(b.lo)})"></span></div><p class="mk__v">${man(b.lo)}~${man(b.hi)}원<span class="sr-only"> (${won(b.lo)}~${won(b.hi)})</span></p></li>`).join('');
    const ours = `<li class="mk__row mk__row--ours"><p class="mk__k">${esc(m.ours.k)}<span>${esc(m.ours.sub)}</span></p><div class="mk__track"><span class="mk__dot" style="left:${pct(m.ours.v)}"></span></div><p class="mk__v">${man(m.ours.v)}원<span class="sr-only"> (${won(m.ours.v)})</span></p></li>`;
    const axis = [0, 100000, 200000, 300000, 400000].map(v => `<span style="left:${pct(v)}">${v ? man(v) : '0'}</span>`).join('');
    return `<figure class="mk"><figcaption class="mk__cap">3단 접이식 매트리스 슈퍼싱글 가격대</figcaption><ul class="mk__list">${rows}${ours}</ul><div class="mk__axis" aria-hidden="true">${axis}</div><p class="note mk__src">${esc(m.source)} 등록 상품 ${esc(m.basis)}, ${esc(m.date)} 조회. 상품마다 구성과 두께가 달라 유형별 범위로만 적었습니다. 잠스쿨은 할인가(상세페이지 이벤트 가격표) 기준입니다.</p></figure>`;
  }
  function checksHTML(list) {
    return `<div class="chk"><div class="chk__head" aria-hidden="true"><span>확인할 것</span><span>잠스쿨</span><span>시중 제품 볼 때</span></div>${list.map(c => `<div class="chk__row"><p class="chk__q">${esc(c.q)}</p><p class="chk__a"><b>${esc(c.a)}</b><span>${esc(c.s)}</span></p><p class="chk__m">${esc(c.m)}</p></div>`).join('')}</div>`;
  }
  // ── 비교 근거 인포그래픽: 시험성적서·조사 수치를 그래프로(값은 TESTS·MARKET·OPTIONS 에서만)
  function proofHTML({ T, M, C }) {
    const t = f => T.findIndex(x => x.cert === `certs/${f}.jpg`);
    const tip = q => { const c = C.find(x => x.q === q); return c ? `<p class="pf__tip"><b>다른 제품 볼 때</b>${esc(c.m)}</p>` : ''; };
    const cert = (i, label = '성적서 보기') => i < 0 ? '' : `<button class="pf__cert" type="button" data-proof-cert="${i}">${esc(label)}</button>`;
    const foot = (src, ...certs) => `<footer class="pf__foot"><span>${esc(src)}</span>${certs.length ? `<span class="pf__certs">${certs.join('')}</span>` : ''}</footer>`;
    const head = (tag, q) => `<header class="pf__head"><p class="pf__tag">${esc(tag)}</p><h4 class="pf__q">${esc(q)}</h4></header>`;
    const ref = i => i > -1 && T[i].ref ? ` · ${T[i].ref}` : '';
    const iR = t('radon'), iC = t('katri-compression'), iD = t('katri-density'), iS = t('sgs'), iF = t('katri-formaldehyde'), iH = t('katri-heavy'), iM = t('katri-mite');
    const radonRatio = Math.floor(7.6 / 148 * 1000) / 10;   // 5.1 (버림)

    // 1) 라돈: 권고 기준 대비 막대
    const radon = `<article class="pf pf--7" data-reveal>${head('라돈', '유해물질·라돈 성적서가 있나요?')}
      <div class="pf__big"><b data-count="${radonRatio}">${radonRatio}</b><span>% 미만</span><em>환경부 실내 라돈 권고 기준 대비</em></div>
      <div class="pf-bars" role="img" aria-label="환경부 실내 권고 기준 148 Bq/m³, 잠스쿨 매트리스 폼 7.6 Bq/m³ 미만">
        <div class="pf-bar"><span class="pf-bar__k">환경부 실내 권고 기준</span><span class="pf-bar__t"><i data-bar style="--w:100%"></i></span><b>148<small> Bq/m³</small></b></div>
        <div class="pf-bar pf-bar--ours"><span class="pf-bar__k">잠스쿨 매트리스 폼</span><span class="pf-bar__t"><i data-bar style="--w:${(7.6 / 148 * 100).toFixed(2)}%"></i></span><b>&lt; 7.6<small> Bq/m³</small></b></div>
      </div>
      ${foot(`한일원자력${ref(iR)}`, cert(iR))}${tip('유해물질·라돈 성적서가 있나요?')}</article>`;

    // 2) 내구성: 10만 회 반복 압축 뒤 두께
    const comp = `<article class="pf pf--5" data-reveal="2">${head('내구성', '내구성 시험을 했나요?')}
      <div class="pf__big"><b data-count="1">1</b><span>%</span><em>10만 번 눌러도 남은 영구 줄음률</em></div>
      <div class="pf-keep" role="img" aria-label="시험 전 두께 100%, 10만 회 반복 압축 뒤 99%">
        <div><span>시험 전</span><span class="pf-keep__t"><i data-bar style="--w:100%"></i></span><b>100%</b></div>
        <div class="pf-keep--after"><span>10만 회 뒤</span><span class="pf-keep__t"><i data-bar style="--w:99%"></i></span><b>99%</b></div>
      </div>
      <p class="pf__note">KS M 6672:2016 반복 압축 100,000회 · 경도 129.3N</p>
      ${foot(`KATRI${ref(iC)}`, cert(iC))}${tip('내구성 시험을 했나요?')}</article>`;

    // 3) 밀도: 표기 범위 게이지 + 조사 표본 중 밀도를 적은 제품 수
    const lo = 20, hi = 40, pos = v => ((v - lo) / (hi - lo) * 100).toFixed(2) + '%';
    const waffle = Array.from({ length: M.density.total }, (_, i) => `<i${i < M.density.listed ? ' class="on"' : ''}></i>`).join('');
    const dens = `<article class="pf pf--5" data-reveal>${head('밀도', '폼 밀도가 숫자로 적혀 있나요?')}
      <div class="pf__big"><b data-count="31.30">31.30</b><span>kg/m³</span><em>KATRI 시험성적서 측정값</em></div>
      <div class="pf-gauge" role="img" aria-label="표기 기준 29~33 kg/m³ 안의 31.30 kg/m³">
        <span class="pf-gauge__track"><span class="pf-gauge__band" style="left:${pos(29)};width:calc(${pos(33)} - ${pos(29)})"></span><span class="pf-gauge__mk" style="left:${pos(31.3)}"></span></span>
        <span class="pf-gauge__ax"><span style="left:0">20</span><span style="left:${pos(25)}">25</span><span style="left:${pos(30)}">30</span><span style="left:${pos(35)}">35</span><span style="left:100%">40</span></span>
      </div>
      <p class="pf__note">진한 구간 = 표기 기준 31 ± 2 kg/m³ (KS M 6672)</p>
      <div class="pf-waffle"><div class="pf-waffle__g" aria-hidden="true">${waffle}</div><p><b>${M.density.total}개 중 ${M.density.listed}개</b>다나와 사양란에 밀도를 적은 일반 폼 3단 접이식 (${esc(M.date)} 조회)</p></div>
      ${foot(`KATRI 시험연구원${ref(iD)}`, cert(iD))}</article>`;

    // 4) 두께: 같은 축척(0~16cm) 단면 막대
    const cm = v => (v / 16 * 100).toFixed(2) + '%';
    const col = (k, a, b, ours) => `<div class="pf-col${ours ? ' pf-col--ours' : ''}"><span class="pf-col__bar"><i data-bar style="--h:${cm(b)}"></i>${a !== b ? `<i class="pf-col__lo" style="--h:${cm(a)}"></i>` : ''}</span><b>${a === b ? a : `${a}~${b}`}<small>cm</small></b><span class="pf-col__k">${esc(k)}</span></div>`;
    const thin = M.thick.find(x => x.k === '얇은 폼'), thick = M.thick.find(x => x.k === '두꺼운 폼');
    const thk = `<article class="pf pf--7" data-reveal="2">${head('두께', '두께를 고를 수 있나요?')}
      <div class="pf__big"><b>7</b><span>cm</span><b class="pf__b2">12</b><span>cm</span><em>침대 위엔 침대형, 바닥엔 바닥형</em></div>
      <div class="pf-cols" role="img" aria-label="얇은 폼 5~6cm, 잠스쿨 침대형 7cm, 잠스쿨 바닥형 12cm, 두꺼운 폼 10~16cm">
        ${col(thin.k, thin.lo, thin.hi)}${col('잠스쿨 침대형', 7, 7, true)}${col('잠스쿨 바닥형', 12, 12, true)}${col(thick.k, thick.lo, thick.hi)}
      </div>
      ${foot(`시중 제품: ${M.source} 유형별 두께 범위 (${M.date} 조회)`)}${tip('두께를 고를 수 있나요?')}</article>`;

    // 5) 유해물질: 항목별 결과
    const subs = [['중금속', '카드뮴·납·수은', '미검출'], ['PBBs', '브롬계 난연제', '미검출'], ['PBDEs', '브롬계 난연제', '미검출'], ['HBCDD', '브롬계 난연제', '미검출'], ['폼알데하이드', '', '검출 안 됨'], ['아릴아민', '5mg 미만', '통과'], ['알레르기성 염료', '5mg 미만', '통과']];
    const haz = `<article class="pf pf--7" data-reveal>${head('유해물질', '어떤 유해물질을 시험했나요?')}
      <div class="pf__big"><b data-count="${subs.length}">${subs.length}</b><span>개 항목</span><em>SGS · KATRI 시험에서 모두 미검출 또는 통과</em></div>
      <ul class="pf-subs">${subs.map(([a, b, r]) => `<li><svg aria-hidden="true"><use href="#i-check"/></svg><span><b>${esc(a)}</b>${b ? `<small>${esc(b)}</small>` : ''}</span><em>${esc(r)}</em></li>`).join('')}</ul>
      ${foot('SGS 6대 유해물질 · KATRI 중금속·폼알데하이드 시험', cert(iS, 'SGS'), cert(iH, 'KATRI 중금속'), cert(iF, 'KATRI 폼알데하이드'))}</article>`;

    // 6) 진드기: 같은 축척 크기 비교
    const mite = `<article class="pf pf--5" data-reveal="2">${head('진드기', '진드기가 커버를 지날 수 있나요?')}
      <div class="pf__big"><b data-count="10">10</b><span>배 작은 틈</span><em>가장 작은 진드기(0.2mm)보다 커버 최대 기공(0.02mm)이</em></div>
      <div class="pf-scale" role="img" aria-label="진드기 0.2mm와 커버 최대 기공 0.02mm 크기 비교">
        <figure><span class="pf-scale__c pf-scale__c--mite"></span><figcaption><b>0.2mm</b>진드기 최소 크기</figcaption></figure>
        <figure><span class="pf-scale__c pf-scale__c--pore"></span><figcaption><b>0.02mm</b>커버 최대 기공</figcaption></figure>
      </div>
      ${foot('KATRI 한국의류시험연구원 · 두 원은 같은 축척', cert(iM))}</article>`;

    // 7) 제조국
    const origin = `<article class="pf pf--5" data-reveal>${head('제조국', '어디서 만들었나요?')}
      <div class="pf__big"><b>100</b><span>%</span><em>폼부터 겉커버까지 국내 생산</em></div>
      <ul class="pf-origin">${[['내장재 폼', '대한민국'], ['누빔 겉커버', '대한민국'], ['특허', '제10-2378668호']].map(([a, b]) => `<li><span>${esc(a)}</span><b>${esc(b)}</b></li>`).join('')}</ul>
      ${tip('어디서 만들었나요?')}</article>`;

    // 8) 체험·보증: 날짜 타임라인
    const day = Math.round(M.ours.v / 730);
    const trial = (14 / 730 * 100).toFixed(2) + '%';
    const warr = `<article class="pf pf--7" data-reveal="2">${head('체험 · 보증', '써 보고 반품할 수 있나요? 폼이 꺼지면요?')}
      <div class="pf__big"><b data-count="730">730</b><span>일</span><em>2년 폼 무상 교체 보증 · 그 앞 14일은 무료체험</em></div>
      <div class="pf-time" role="img" aria-label="받은 날부터 14일 무료체험, 730일까지 폼 무상 교체 보증">
        <span class="pf-time__bar"><i data-bar style="--w:100%"></i><i class="pf-time__trial" style="--w:${trial}"></i></span>
        <span class="pf-time__mk pf-time__mk--start" style="left:0"><b>0일</b>받는 날</span>
        <span class="pf-time__mk pf-time__mk--trial" style="left:${trial}"><b>14일</b>무료체험</span>
        <span class="pf-time__mk" style="left:50%"><b>365일</b>1년</span>
        <span class="pf-time__mk pf-time__mk--end" style="left:100%"><b>730일</b>폼 교체 보증</span>
      </div>
      <p class="pf__note">바닥형 12cm 슈퍼싱글 ${won(M.ours.v)} ÷ 730일 = 하루 약 <b>${day.toLocaleString('ko-KR')}원</b></p>
      ${tip('써 보고 반품할 수 있나요?')}${tip('폼이 꺼지면 어떻게 되나요?')}</article>`;

    return `<div class="pf-grid">${radon}${comp}${dens}${thk}${haz}${mite}${origin}${warr}</div>`;
  }
  // ── 롤링 후기 (두 줄, 반대 방향). 복제본은 보조기기에서 숨긴다
  function reviewRollHTML(best, shorts) {
    const card1 = (r, i, dup) => `<button class="roll-card" type="button" data-rv="${i}"${dup ? ' tabindex="-1" aria-hidden="true"' : ''}><span class="roll-card__top"><span class="stars" style="--v:5" aria-hidden="true"></span><span class="rv__best">BEST</span></span><span class="roll-card__text">${esc(r.text)}</span><span class="roll-card__foot">${esc(r.id)}${r.opt ? ` · ${esc(r.opt)}` : ''} · 스마트스토어 구매평</span></button>`;
    const card2 = (t, dup) => `<p class="roll-quote"${dup ? ' aria-hidden="true"' : ''}>“${esc(t)}”<span>공식몰 포토 구매평</span></p>`;
    const row1 = best.map((r, i) => card1(r, i)).join('') + best.map((r, i) => card1(r, i, true)).join('');
    const row2 = shorts.map(t => card2(t)).join('') + shorts.map(t => card2(t, true)).join('');
    return `<div class="roll" aria-label="구매평 롤링"><div class="roll__row"><div class="roll__track">${row1}</div></div><div class="roll__row roll__row--rev"><div class="roll__track">${row2}</div></div></div>`;
  }
  // ── 블로그 카드
  function postCard(p, base = '') {
    return `<article class="post-card"><a href="${base}blog/${esc(p.slug)}.html"><p class="post-card__cat">${esc(p.category)}</p><h3>${esc(p.title)}</h3><p class="post-card__desc">${esc(p.description)}</p><p class="post-card__meta"><time datetime="${esc(p.date)}">${esc(p.date.replace(/-/g, '.'))}</time> · ${p.minutes}분 읽기</p></a></article>`;
  }
  G.RENDER = { esc, won, rate, rateOf, href, webp, pic, swap, badge, productCard, accItem, faqHTML, testsHTML, reviewsHTML, usesHTML, usePanel, specTable, featuresHTML, priceHTML, marketHTML, checksHTML, proofHTML, reviewRollHTML, postCard, perDay, ICON };
})(typeof window !== 'undefined' ? window : globalThis);
