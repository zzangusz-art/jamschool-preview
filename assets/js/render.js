/* 마크업 렌더러 — 브라우저(런타임)와 Node(build.mjs 정적 생성)에서 같이 쓴다 */
(function (G) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => n.toLocaleString('ko-KR') + '원';
  const rate = p => Math.round((1 - p.price / p.list) * 100);
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
      rows.push(`<tr><th scope="row">${esc(t.label)} ${esc(t.sub)} · ${esc(s.label)}</th><td>${s.w} × ${o.length} × ${t.id}cm</td><td>${s.w} × ${o.depthFolded} × ${o.folded[t.id]}cm</td><td>${o.weight[k]}kg</td><td>${won(o.price[k])}</td></tr>`);
    }
    return `<div class="tbl-wrap"><table class="spec-tbl"><caption class="sr-only">3단 접이식 매트리스 옵션별 크기·무게·판매가</caption><thead><tr><th scope="col">옵션</th><th scope="col">펼친 크기</th><th scope="col">접은 크기</th><th scope="col">무게</th><th scope="col">판매가</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
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
      const k = `${t.id}-${s.id}`, v = o.price[k], hot = k === '12-SS';
      return `<article class="pc${hot ? ' pc--hot' : ''}">${hot ? '<p class="pc__badge">성인 1인 추천</p>' : ''}
        <h3 class="pc__name">${esc(s.label)}<span>${s.w} × 200 × ${t.id}cm</span></h3>
        <p class="pc__price"><b>${won(v)}</b></p>
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
    return `<figure class="mk"><figcaption class="mk__cap">3단 접이식 매트리스 슈퍼싱글 가격대</figcaption><ul class="mk__list">${rows}${ours}</ul><div class="mk__axis" aria-hidden="true">${axis}</div><p class="note mk__src">${esc(m.source)} 등록 상품 ${esc(m.basis)}, ${esc(m.date)} 조회. 상품마다 구성과 두께가 달라 유형별 범위로만 적었습니다. 잠스쿨은 공식몰 판매가입니다.</p></figure>`;
  }
  function checksHTML(list) {
    return `<div class="chk"><div class="chk__head" aria-hidden="true"><span>확인할 것</span><span>잠스쿨</span><span>시중 제품 볼 때</span></div>${list.map(c => `<div class="chk__row"><p class="chk__q">${esc(c.q)}</p><p class="chk__a"><b>${esc(c.a)}</b><span>${esc(c.s)}</span></p><p class="chk__m">${esc(c.m)}</p></div>`).join('')}</div>`;
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
  G.RENDER = { esc, won, rate, href, webp, pic, swap, badge, productCard, accItem, faqHTML, testsHTML, reviewsHTML, usesHTML, usePanel, specTable, featuresHTML, priceHTML, marketHTML, checksHTML, reviewRollHTML, postCard, perDay, ICON };
})(typeof window !== 'undefined' ? window : globalThis);
