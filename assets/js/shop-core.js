/* 쇼핑 공통: 3단 옵션 버튼, 빠른 보기, 장바구니 담기, 최근 본 상품, 주문서로 넘기기
   홈·진열·상품 상세·장바구니에서 같이 쓴다. ui.js 다음에 불러온다. */
(function () {
  const { $, $$, won, esc, toast, openLayer, closeLayer, cart, store } = UI;
  const { PRODUCTS, OPT, CHECKOUT } = JAM;
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
  // 옵션 묶음(JAM.OPT) 한 줄의 라디오 버튼 — 빠른 보기·장바구니 옵션 변경에서 쓴다(상품 페이지는 빌드가 그린다)
  function groupField(g, sel) {
    const style = g.values.some(v => v.hex) ? 'colors' : g.values.length <= 2 ? 'seg' : 'sizes';
    const btn = v => `<button type="button" role="radio" class="${style === 'colors' ? 'color-opt' : style === 'sizes' ? 'size-opt' : ''}" aria-checked="${v.id === sel}" data-v="${esc(v.id)}"${v.off ? ' disabled' : ''}>${style === 'colors' ? `<i style="background:${esc(v.hex || '#D5DCE3')}"></i>${esc(v.label)}` : style === 'sizes' ? `<b>${esc(v.label)}</b>${v.sub ? `<small>${esc(v.sub)}</small>` : ''}` : `${esc(v.label)}${v.sub ? `<small>${esc(v.sub)}</small>` : ''}`}${v.off ? '<small>품절</small>' : ''}</button>`;
    return `<div class="field"><p class="field__label">${esc(g.name)}</p><div class="${style}" role="radiogroup" data-k="${esc(g.id)}" aria-label="${esc(g.name)}">${g.values.map(btn).join('')}</div></div>`;
  }
  // 처음 고를 값: 묶음마다 살 수 있는 첫 값(조합이 품절이면 다음 조합)
  function firstVals(p) {
    const o = OPT.of(p); if (!o) return null;
    return OPT.combos(o.groups).find(v => { const x = OPT.info(p, v); return x && !x.off; }) || OPT.combos(o.groups)[0];
  }
  // 예전 형식({t,s,c})도 받는다(홈 3단 안내에서 담을 때)
  const valsOf = (p, st) => { const o = OPT.of(p); return !o || !st ? null : Array.isArray(st) ? st : o.groups.map(g => st[g.id]); };
  // 장바구니·주문서에 들어가는 한 줄. 옵션 상품은 조합마다 key 가 다르다(상품번호-값-값…)
  function itemFor(p, st, qty = 1) {
    const vals = valsOf(p, st), x = vals && OPT.info(p, vals);
    return x
      ? { key: x.key, id: p.id, name: p.name, opt: x.label, st: x.vals, price: x.price, img: x.img, qty }
      : { key: String(p.id), id: p.id, name: p.name, opt: '', price: p.price, img: p.imgs[0], qty };
  }
  function addToCart(p, st, qty = 1) {
    const x = OPT.of(p) && OPT.info(p, valsOf(p, st) || []);
    if (OPT.of(p) && (!x || x.off)) { toast('품절된 옵션입니다. 다른 옵션을 골라 주세요.'); return; }
    cart.add(itemFor(p, st, qty));
    toast('장바구니에 담았습니다.', { action: '보기', onAction: () => openLayer('cart') });
  }

  // ───────── 빠른 보기 (상품 카드의 눈 아이콘)
  function openQuick(id, opener) {
    const p = P(id); if (!p || !$('#quick')) return;
    const o = OPT.of(p), st = firstVals(p);
    const cur = () => (o ? OPT.info(p, st) : null);
    const price = () => (cur() ? cur().price : p.price);
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
        ${o ? `<div style="margin-top:18px">${o.groups.map((g, i) => groupField(g, st[i])).join('')}</div>`
        : `<ul class="qv__pts">${(p.points.length ? p.points : [p.summary]).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`}
        <div class="qv__btns"><a class="btn btn--line" href="${RENDER.href(p)}">상세 보기</a><button class="btn btn--primary" type="button" id="qv-add">장바구니 담기</button></div>
      </div></div>`;
    $('#quick-t').textContent = p.short;
    const main = $('.qv__main img', body);
    $$('.qv__thumbs button', body).forEach((b, i) => b.addEventListener('click', () => {
      RENDER.swap(main, p.imgs[i]); $$('.qv__thumbs button', body).forEach(x => x.setAttribute('aria-current', x === b));
    }));
    // 3단은 고른 옵션의 정가·할인율로 바꿔 보여 준다
    const syncPrice = () => {
      const x = cur(), v = price(), L = x ? x.list : p.list;
      $('#qv-price').textContent = won(v); $('#qv-list').textContent = L > v ? won(L) : ''; $('#qv-rate').textContent = L > v ? `${RENDER.rateOf(L, v)}%` : '';
    };
    bindRadios(body, (k, v) => { const i = o.groups.findIndex(g => g.id === k); if (i >= 0) st[i] = v; syncPrice(); });
    syncPrice();
    $('#qv-add').addEventListener('click', () => { const x = cur(); if (o && (!x || x.off)) { toast('품절된 옵션입니다. 다른 옵션을 골라 주세요.'); return; } addToCart(p, o ? st : null); closeLayer($('#quick')); });
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
  const miniCard = p => `<a class="mini" href="${RENDER.href(p)}">${RENDER.pic(p.imgs[0], 'alt="" width="200" height="200" loading="lazy"')}<span class="mini__n">${esc(p.short)}</span><b>${won(p.price)}${p.from ? '~' : ''}</b></a>`;

  // ───────── 주문서로
  // 바로 구매는 sessionStorage 로 넘기고 장바구니는 건드리지 않는다. 장바구니 주문은 고른 key 만 넘긴다
  const BUY_K = 'jam_buynow', SEL_K = 'jam_checkout_keys';
  function openOrderModal(items, opener) {
    const p = P(items && items[0] ? items[0].id : 29) || P(29);
    $('#order-mall').href = RENDER.href(p);
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

  // 예전에 담긴 장바구니 금액을 지금 가격으로 맞춘다(가격표가 바뀌어도 장바구니·주문서 금액이 같게)
  // 옵션이 바뀌어 더 없는 조합(또는 옵션이 생겨 고르지 않은 줄)은 장바구니에서 뺀다 — 결제 서버도 같은 규칙으로 막는다
  (function syncCart() {
    let changed = false;
    cart.items = cart.items.filter(x => {
      const p = P(x.id); if (!p) return true;
      if (OPT.of(p)) {
        const y = OPT.parse(p, x.key); if (!y) { changed = true; return false; }
        if (y.price !== x.price || y.label !== x.opt) { Object.assign(x, { price: y.price, opt: y.label, st: y.vals }); changed = true; }
        return true;
      }
      if (String(x.key) !== String(p.id)) { changed = true; return false; }
      if (p.price !== x.price) { x.price = p.price; changed = true; }
      return true;
    });
    if (changed) cart.save();
  })();

  window.SHOP = { P, optButtons, bindRadios, groupField, firstVals, itemFor, addToCart, openQuick, recent, miniCard, buyNow, checkoutCart, openOrderModal, BUY_K, SEL_K };
})();
