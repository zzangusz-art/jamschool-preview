/* 전체 상품(진열): 분류 탭(?cat=), 찜한 상품, 정렬, 최근 본 상품. 카드는 빌드 때 HTML 로 들어가 있고 여기서는 보이기·순서만 바꾼다 */
(function () {
  const { $, $$, esc, tabs, wish, readyThumbs, reduce, store } = UI;
  const { PRODUCTS, CATEGORIES } = JAM;
  const grid = $('#shop-grid'); if (!grid) return;
  const cards = $$('.pcard', grid);
  const byId = id => PRODUCTS.find(p => p.id === id);
  const order = new Map(PRODUCTS.map((p, i) => [p.id, i]));
  const SORT_K = 'jam_shop_sort';
  const SORTS = {
    reco: (a, b) => order.get(a.id) - order.get(b.id),
    rv: (a, b) => b.reviews - a.reviews,
    rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
    low: (a, b) => a.price - b.price,
    high: (a, b) => b.price - a.price,
    rate: (a, b) => RENDER.rate(b) - RENDER.rate(a),
  };
  const st = { f: 'all', sort: 'reco' };
  const sortSel = $('#shop-sort'), countEl = $('#shop-n'), empty = $('#shop-empty'), desc = $('#shop-desc');

  readyThumbs(grid);
  $$('[data-wish]', grid).forEach(b => b.setAttribute('aria-pressed', wish.has(+b.dataset.wish)));

  function apply(animate) {
    const list = cards.map(c => ({ c, p: byId(+c.dataset.id) })).sort((x, y) => SORTS[st.sort](x.p, y.p));
    let n = 0;
    list.forEach(({ c, p }) => {
      const show = st.f === 'all' || (st.f === 'wish' ? wish.has(p.id) : p.cat === st.f);
      c.hidden = !show; grid.appendChild(c);
      if (show) { n++; if (animate && !reduce) c.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.22,.8,.2,1)' }); }
    });
    countEl.textContent = n;
    empty.hidden = n > 0;
    const cat = CATEGORIES.find(c => c.id === st.f);
    desc.textContent = cat ? cat.desc : '';
    desc.hidden = !cat;
  }

  // 분류 탭 ↔ 주소(?cat=) 동기화
  const ids = $$('[role="tab"]', $('#shop-cats')).map(t => t.dataset.f);
  const select = tabs($('#shop-cats'), (i, t) => {
    st.f = t.dataset.f; apply(true);
    const u = new URL(location.href);
    if (st.f === 'all') u.searchParams.delete('cat'); else u.searchParams.set('cat', st.f);
    history.replaceState(null, '', u.pathname.split('/').pop() + u.search);
  });
  const q = new URLSearchParams(location.search).get('cat');
  const qi = ids.indexOf(q);
  if (qi > 0) select(qi);

  // 정렬 (마지막 선택을 기억)
  const saved = store.get(SORT_K, 'reco');
  if (SORTS[saved]) { st.sort = saved; sortSel.value = saved; }
  sortSel.addEventListener('change', () => { st.sort = sortSel.value; store.set(SORT_K, st.sort); apply(true); });

  // 찜 개수: 하트를 누르면 갱신(찜한 상품 탭에서는 목록도 다시)
  const wishN = $('#wish-n');
  const syncWish = () => { wishN.textContent = PRODUCTS.filter(p => wish.has(p.id)).length; };
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-wish]')) return;
    setTimeout(() => { syncWish(); if (st.f === 'wish') apply(false); }, 0);
  });
  syncWish();
  apply(false);

  // 최근 본 상품
  const rec = SHOP.recent.ids();
  if (rec.length) {
    $('#recent-row').innerHTML = rec.map(id => SHOP.miniCard(byId(id))).join('');
    $('#shop-recent').hidden = false;
  }
})();
