/* 쇼핑 공통: 3단 옵션 버튼, 빠른 보기, 장바구니 담기, 최근 본 상품, 주문서로 넘기기
   홈·진열·상품 상세·장바구니에서 같이 쓴다. ui.js 다음에 불러온다. */
(function () {
  const { $, $$, won, esc, toast, openLayer, closeLayer, cart, store } = UI;
  const { PRODUCTS, OPTIONS_29: O, CHECKOUT } = JAM;
  const P = id => PRODUCTS.find(p => p.id === +id);

  // ───────── 3단 옵션(두께·사이즈·색상) 라디오 버튼
  function optButtons(kind, list, sel) {
    return list.map(o => `<button type="button" role="radio" class="${kind === 's' ? 'size-opt' : kind === 'c' ? 'color-opt' : ''}" aria-checked="${o.id === sel}" data-v="${o.id}">${kind === 'c' ? `<i style="background:${o.hex}"></i>${esc(o.label)}` : kind === 's' ? `<b>${esc(o.label)}</b><small>${o.w} × 200</small>` : `${esc(o.label)}<small>${esc(o.sub)}</small>`}</button>`).join('');
  }
  function bindRadios(root, onPick) {
    $$('[role="radiogroup"]', root).forEach(g => {
      const bs = $$('[role="radio"]', g);
      bs.forEach((b, i) => {
        b.tabIndex = b.getAttribute('aria-checked') === 'true' || (i === 0 && !bs.some(x => x.getAttribute('aria-checked') === 'true')) ? 0 : -1;
        b.addEventListener('click', () => pick(b));
        b.addEventListener('keydown', ev => {
          const d = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
          if (!d) return; ev.preventDefault(); const n = bs[(i + d + bs.length) % bs.length]; n.focus(); pick(n);
        });
      });
      function pick(b) { bs.forEach(x => { x.setAttribute('aria-checked', x === b); x.tabIndex = x === b ? 0 : -1; }); onPick(g.dataset.k, b.dataset.v); }
    });
  }
  function optLabel(st) {
    const t = O.thickness.find(x => x.id === st.t), s = O.size.find(x => x.id === st.s), c = O.color.find(x => x.id === st.c);
    return `${t.label} ${t.sub} / ${s.label} ${s.w}×200 / ${c.label}`;
  }
  // 장바구니·주문서에 들어가는 한 줄. 3단은 옵션 조합마다 key 가 다르다
  function itemFor(p, st, qty = 1) {
    return st
      ? { key: `29-${st.t}-${st.s}-${st.c}`, id: 29, name: p.name, opt: optLabel(st), st: { t: st.t, s: st.s, c: st.c }, price: O.price[`${st.t}-${st.s}`], img: st.c === 'ivory' ? p.imgs[8] : p.imgs[0], qty }
      : { key: String(p.id), id: p.id, name: p.name, opt: '', price: p.price, img: p.imgs[0], qty };
  }
  function addToCart(p, st, qty = 1) {
    cart.add(itemFor(p, st, qty));
    toast('장바구니에 담았습니다.', { action: '보기', onAction: () => openLayer('cart') });
  }

  // ───────── 빠른 보기 (상품 카드의 눈 아이콘)
  function openQuick(id, opener) {
    const p = P(id); if (!p || !$('#quick')) return;
    const st = { t: '12', s: 'SS', c: 'gray' };
    const price = () => p.full ? O.price[`${st.t}-${st.s}`] : p.price;
    const body = $('#quick-body');
    body.innerHTML = `<div class="qv">
      <div class="qv__gal"><div class="qv__main">${RENDER.pic(p.imgs[0], `alt="${esc(p.name)}" width="1000" height="1000"`)}</div>
        <div class="qv__thumbs">${p.imgs.slice(0, 6).map((s, i) => `<button type="button" aria-label="${i + 1}번째 이미지" aria-current="${i === 0}">${RENDER.pic(s, 'alt="" width="120" height="120" loading="lazy"')}</button>`).join('')}</div></div>
      <div class="qv__info">
        <div class="pd-info__badges">${p.badges.map(RENDER.badge).join('')}</div>
        <h3 class="qv__name">${esc(p.name)}</h3>
        <p class="pcard__rv"><span class="stars" style="--v:${p.rating}" aria-hidden="true"></span><b>${p.rating.toFixed(2)}</b><span>구매평 ${p.reviews.toLocaleString('ko-KR')}</span></p>
        <p class="pcard__list" style="margin-top:12px" id="qv-list">${won(p.list)}</p>
        <p class="qv__price"><span class="rate" id="qv-rate">${RENDER.rate(p)}%</span><b id="qv-price">${won(price())}</b></p>
        ${p.full ? `<div class="field" style="margin-top:18px"><p class="field__label">두께</p><div class="seg" role="radiogroup" data-k="t" aria-label="두께">${optButtons('t', O.thickness, st.t)}</div></div>
        <div class="field"><p class="field__label">사이즈</p><div class="sizes" role="radiogroup" data-k="s" aria-label="사이즈">${optButtons('s', O.size, st.s)}</div></div>
        <div class="field"><p class="field__label">색상</p><div class="colors" role="radiogroup" data-k="c" aria-label="색상">${optButtons('c', O.color, st.c)}</div></div>`
        : `<ul class="qv__pts">${(p.points.length ? p.points : [p.summary]).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`}
        <div class="qv__btns"><a class="btn btn--line" href="${RENDER.href(p)}">상세 보기</a><button class="btn btn--primary" type="button" id="qv-add">장바구니 담기</button></div>
      </div></div>`;
    $('#quick-t').textContent = p.short;
    const main = $('.qv__main img', body);
    $$('.qv__thumbs button', body).forEach((b, i) => b.addEventListener('click', () => {
      RENDER.swap(main, p.imgs[i]); $$('.qv__thumbs button', body).forEach(x => x.setAttribute('aria-current', x === b));
    }));
    const syncPrice = () => { const v = price(), base = v === p.price; $('#qv-price').textContent = won(v); $('#qv-list').hidden = !base; $('#qv-rate').hidden = !base; };
    bindRadios(body, (k, v) => { st[k] = v; syncPrice(); });
    syncPrice();
    $('#qv-add').addEventListener('click', () => { addToCart(p, p.full ? st : null); closeLayer($('#quick')); });
    openLayer('quick', opener);
  }
  document.addEventListener('click', e => {
    const q = e.target.closest('[data-quick]');
    if (q) { e.preventDefault(); openQuick(+q.dataset.quick, q); }
  });

  // ───────── 최근 본 상품 (상품 상세에서 기록, 진열·장바구니에서 보여 줌)
  const RECENT_K = 'jam_recent_v1';
  const recent = {
    ids() { return store.get(RECENT_K, []).filter(id => P(id)); },
    push(id) { store.set(RECENT_K, [id, ...this.ids().filter(x => x !== id)].slice(0, 8)); },
  };
  const miniCard = p => `<a class="mini" href="${RENDER.href(p)}">${RENDER.pic(p.imgs[0], 'alt="" width="200" height="200" loading="lazy"')}<span class="mini__n">${esc(p.short)}</span><b>${won(p.price)}${p.full ? '~' : ''}</b></a>`;

  // ───────── 주문서로
  // 바로 구매는 sessionStorage 로 넘기고 장바구니는 건드리지 않는다. 장바구니 주문은 고른 key 만 넘긴다
  const BUY_K = 'jam_buynow', SEL_K = 'jam_checkout_keys';
  function openOrderModal(items, opener) {
    const p = P(items && items[0] ? items[0].id : 29) || P(29);
    $('#order-mall').href = p.mall;
    const np = $('#order-npay');
    if (p.store) { np.hidden = false; np.href = p.store; } else np.hidden = true;
    openLayer('order', opener);
  }
  function buyNow(items, opener) {
    if (CHECKOUT.mode === 'handoff') { openOrderModal(items, opener); return; }
    store.sset(BUY_K, JSON.stringify(items));
    location.href = 'checkout.html?buy=now';
  }
  function checkoutCart(keys, opener) {
    if (CHECKOUT.mode === 'handoff') { openOrderModal(cart.items, opener); return; }
    if (keys) store.sset(SEL_K, JSON.stringify(keys)); else store.sset(SEL_K, '');
    location.href = 'checkout.html';
  }

  window.SHOP = { P, optButtons, bindRadios, optLabel, itemFor, addToCart, openQuick, recent, miniCard, buyNow, checkoutCart, openOrderModal, BUY_K, SEL_K };
})();
