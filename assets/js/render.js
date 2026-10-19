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
        <h3 class="pcard__name">${esc(p.name)}</h3>
        <p class="pcard__list"><span class="sr-only">정가</span>${won(p.list)}</p>
        <p class="pcard__price"><span class="rate">${rate(p)}%</span><span><span class="sr-only">판매가</span>${won(p.price)}${p.full ? '~' : ''}</span></p>
        <p class="pcard__rv"><span class="star1" aria-hidden="true">★</span><b><span class="sr-only">평점 </span>${p.rating.toFixed(2)}</b><span>(${p.reviews.toLocaleString('ko-KR')}<span class="sr-only">건</span>)</span></p>
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
  G.RENDER = { esc, won, rate, href, webp, pic, swap, badge, productCard, accItem, faqHTML, testsHTML, reviewsHTML, usesHTML, usePanel, specTable, ICON };
})(typeof window !== 'undefined' ? window : globalThis);
