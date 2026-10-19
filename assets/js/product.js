/* 상품 상세: 갤러리, 옵션 선택(선택 목록·수량), 장바구니·구매·찜·공유, 탭 스크롤스파이, 상세 접기, 모바일 구매바·시트 */
(function () {
  const { $, $$, won, esc, toast, openLayer, closeLayer, accordion, cart, wish, lightbox, readyThumbs, photoStrip, reduce } = UI;
  const { PRODUCTS, OPTIONS_29: O } = JAM;
  const root = $('.pd'); if (!root) return;
  const p = PRODUCTS.find(x => x.id === +root.dataset.id);

  // 찜 초기 상태
  $$(`[data-wish="${p.id}"]`).forEach(b => b.setAttribute('aria-pressed', wish.has(p.id)));

  // ───────── 갤러리: 스와이프 트랙 + 썸네일 + 라이트박스
  const track = $('#gal-track'), thumbs = $$('#gal-thumbs .pd-gal__th'), count = $('.pd-gal__count b');
  let gi = 0;
  const goto = (i, smooth = true) => track.scrollTo({ left: i * track.clientWidth, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  thumbs.forEach((b, i) => b.addEventListener('click', () => goto(i)));
  track.addEventListener('scroll', () => {
    const i = Math.round(track.scrollLeft / track.clientWidth);
    if (i === gi) return; gi = i;
    count.textContent = i + 1;
    thumbs.forEach((b, k) => b.setAttribute('aria-current', k === i));
    thumbs[i] && thumbs[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, { passive: true });
  track.addEventListener('keydown', e => { if (e.key === 'ArrowRight') goto(Math.min(p.imgs.length - 1, gi + 1)); if (e.key === 'ArrowLeft') goto(Math.max(0, gi - 1)); });
  const lbItems = p.imgs.map((s, i) => ({ src: s, alt: `${p.short} 상품 이미지 ${i + 1}` }));
  $('.pd-gal__zoom').addEventListener('click', () => lightbox(lbItems, gi));
  $$('.pd-gal__slide img').forEach((img, i) => img.addEventListener('click', () => lightbox(lbItems, i)));

  // ───────── 옵션
  const sel = [];                 // 선택 목록 [{key, t, s, c, qty}]
  const st = { t: null, s: null, c: null };
  let qtySingle = 1;
  const totalEl = $('#pd-total'), priceEl = $('#pd-price');
  function label(it) {
    const t = O.thickness.find(x => x.id === it.t), s = O.size.find(x => x.id === it.s), c = O.color.find(x => x.id === it.c);
    return `${t.label} ${t.sub} / ${s.label} ${s.w}×200 / ${c.label}`;
  }
  const unit = it => O.price[`${it.t}-${it.s}`];
  function renderSel() {
    const ul = $('#pd-sel'); if (!ul) return;
    ul.innerHTML = sel.map(it => `<li class="pd-sel__row" data-key="${it.key}"><p class="pd-sel__name">${esc(label(it))}</p>
      <div class="pd-sel__ctl"><div class="qty"><button type="button" data-sq="-1" aria-label="수량 줄이기" ${it.qty <= 1 ? 'disabled' : ''}>${UI.I.minus}</button><span>${it.qty}</span><button type="button" data-sq="1" aria-label="수량 늘리기">${UI.I.plus}</button></div>
      <b>${won(unit(it) * it.qty)}</b><button type="button" class="pd-sel__del" data-sdel aria-label="${esc(label(it))} 삭제">${UI.I.x}</button></div></li>`).join('');
    totalEl.textContent = won(sel.reduce((s, it) => s + unit(it) * it.qty, 0));
    $('#pd-hint').hidden = sel.length > 0;
  }
  function sizePrices() {
    $$('#po-s-g [data-v]').forEach(b => {
      const v = b.dataset.v, el = $('[data-p]', b);
      el.textContent = st.t ? won(O.price[`${st.t}-${v}`]) : won(Math.min(O.price[`7-${v}`], O.price[`12-${v}`])) + '~';
    });
  }
  if (p.full) {
    $$('.pd-opt [role="radiogroup"]').forEach(g => {
      const key = { 'po-t-g': 't', 'po-s-g': 's', 'po-c-g': 'c' }[g.id], bs = $$('[role="radio"]', g);
      bs.forEach((b, i) => {
        b.tabIndex = i === 0 ? 0 : -1;
        b.addEventListener('click', () => pick(b));
        b.addEventListener('keydown', e => {
          const d = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 0;
          if (d) { e.preventDefault(); const n = bs[(i + d + bs.length) % bs.length]; n.focus(); pick(n); }
        });
      });
      function pick(b) {
        bs.forEach(x => { x.setAttribute('aria-checked', x === b); x.tabIndex = x === b ? 0 : -1; });
        st[key] = b.dataset.v;
        if (key === 't') sizePrices();
        if (st.t && st.s && st.c) {
          const k = `${st.t}-${st.s}-${st.c}`, f = sel.find(x => x.key === k);
          if (f) { f.qty = Math.min(99, f.qty + 1); toast('이미 고른 옵션이라 수량을 1개 늘렸습니다.'); }
          else sel.push({ key: k, t: st.t, s: st.s, c: st.c, qty: 1 });
          const v = O.price[`${st.t}-${st.s}`], base = v === p.price;
          priceEl.textContent = won(v);
          $('.pd-price__now .from')?.remove();
          $('.pd-price__list').hidden = !base; $('.pd-price__now .rate').hidden = !base;
          const cp = $('.pd-price__cp');
          if (cp) { $('b', cp).textContent = won(v - 10000); cp.firstChild.textContent = '선택 옵션 회원 쿠폰 적용 시 '; cp.childNodes[2].textContent = ''; }
          // 사이즈·색상은 다음 선택을 위해 비운다(두께는 유지)
          st.s = st.c = null;
          ['po-s-g', 'po-c-g'].forEach(id => $$(`#${id} [role="radio"]`).forEach(x => x.setAttribute('aria-checked', 'false')));
          renderSel();
        } else {
          const need = [!st.t && '두께', !st.s && '사이즈', !st.c && '색상'].filter(Boolean);
          $('#pd-hint').textContent = `${need.join(', ')}을(를) 고르면 아래에 담깁니다.`;
          $('#pd-hint').hidden = false;
        }
      }
    });
    sizePrices();
    $('#pd-sel').addEventListener('click', e => {
      const row = e.target.closest('.pd-sel__row'); if (!row) return;
      const it = sel.find(x => x.key === row.dataset.key);
      const q = e.target.closest('[data-sq]');
      if (q) { it.qty = Math.max(1, Math.min(99, it.qty + +q.dataset.sq)); renderSel(); }
      if (e.target.closest('[data-sdel]')) { sel.splice(sel.indexOf(it), 1); renderSel(); }
    });
    renderSel();
  } else {
    const q = $('#pd-qty');
    q.addEventListener('click', e => {
      const b = e.target.closest('[data-q]'); if (!b) return;
      qtySingle = Math.max(1, Math.min(99, qtySingle + +b.dataset.q));
      $('span', q).textContent = qtySingle;
      $('[data-q="-1"]', q).disabled = qtySingle <= 1;
      totalEl.textContent = won(p.price * qtySingle);
    });
  }
  function items() {
    if (!p.full) return [{ key: String(p.id), id: p.id, name: p.name, opt: '', price: p.price, img: p.imgs[0], qty: qtySingle }];
    return sel.map(it => ({ key: `29-${it.key}`, id: 29, name: p.name, opt: label(it), price: unit(it), img: it.c === 'ivory' ? p.imgs[8] : p.imgs[0], qty: it.qty }));
  }
  function needOptions() {
    if (!p.full || sel.length) return false;
    toast('두께·사이즈·색상을 먼저 골라 주세요.');
    if (matchMedia('(max-width: 1023px)').matches && !$('#buy').classList.contains('is-open')) openSheet();
    else $('#pd-opt').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    return true;
  }
  function doCart() {
    if (needOptions()) return;
    items().forEach(it => cart.add(it));
    closeLayer($('#buy'));
    toast('장바구니에 담았습니다.', { action: '보기', onAction: () => openLayer('cart') });
  }
  function doBuy(e) {
    if (needOptions()) return;
    $('#order-mall').href = p.mall;
    const np = $('#order-npay');
    if (p.store) { np.hidden = false; np.href = p.store; } else np.hidden = true;
    closeLayer($('#buy'));
    setTimeout(() => openLayer('order', e && e.currentTarget), 80);
  }
  $('#pd-cart').addEventListener('click', doCart);
  $('#pd-buy').addEventListener('click', doBuy);
  $('#sh-cart').addEventListener('click', doCart);
  $('#sh-buy').addEventListener('click', doBuy);
  $('#pd-share').addEventListener('click', async () => {
    const data = { title: p.name, url: location.href.split('#')[0] };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(data.url);
      toast('상품 링크를 복사했습니다.', { icon: UI.I.link });
    } catch (e) { if (e && e.name !== 'AbortError') toast('링크 복사에 실패했습니다. 주소창의 링크를 이용해 주세요.'); }
  });

  // ───────── 모바일 구매바 + 옵션 시트(옵션 블록을 시트로 옮겼다가 되돌림)
  const buybar = $('#buybar'), slot = $('#pd-opt-slot'), sheetSlot = $('#buy-slot'), opt = $('#pd-opt');
  function openSheet(e) { sheetSlot.appendChild(opt); openLayer('buy', e && e.currentTarget); }
  $('#bb-buy').addEventListener('click', openSheet);
  $('#buy').addEventListener('layer:closed', () => slot.appendChild(opt));
  const btns = $('.pd-btns');
  new IntersectionObserver(([en]) => {
    const show = !en.isIntersecting && en.boundingClientRect.top < 0;
    buybar.classList.toggle('is-on', show);
    document.body.classList.toggle('has-buybar', show);
  }).observe(btns);

  // ───────── 탭 스크롤스파이
  const tabLinks = $$('.pd-tabs a');
  const secs = tabLinks.map(a => $(a.getAttribute('href')));
  const spy = new IntersectionObserver(es => {
    es.forEach(en => { if (en.isIntersecting) tabLinks.forEach(a => a.setAttribute('aria-current', a.getAttribute('href') === '#' + en.target.id)); });
  }, { rootMargin: '-45% 0px -50% 0px' });
  secs.forEach(s => s && spy.observe(s));

  // ───────── 상세 이미지: 스켈레톤 → 로드, 동영상은 보일 때만 재생, 접기/펼치기
  $$('.dt img').forEach(img => {
    const done = () => img.closest('.dt').classList.add('is-ready');
    if (img.complete && img.naturalWidth) done(); else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }
  });
  const vio = new IntersectionObserver(es => es.forEach(en => {
    const v = en.target;
    if (en.isIntersecting) {
      if (!v.src && v.dataset.src) { v.src = v.dataset.src; v.addEventListener('loadeddata', () => v.parentElement.classList.add('is-ready'), { once: true }); }
      if (!reduce) v.play().catch(() => {});
    } else v.pause();
  }), { rootMargin: '200px 0px' });
  $$('.dt video').forEach(v => { v.parentElement.classList.add('is-ready'); vio.observe(v); });
  // 유튜브: 누를 때만 iframe 을 붙인다(미리보기는 로컬 썸네일)
  $$('.dt-yt').forEach(b => b.addEventListener('click', () => {
    b.closest('.dt').insertAdjacentHTML('beforeend', `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(b.dataset.yt)}?autoplay=1&rel=0&playsinline=1" title="${esc(b.dataset.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`);
    b.remove();
  }));
  const wrap = $('#dt-wrap'), more = $('#dt-more');
  more.addEventListener('click', () => {
    const open = wrap.classList.toggle('is-folded') === false;
    more.setAttribute('aria-expanded', open);
    more.firstChild.textContent = open ? '상세정보 접기' : '상세정보 펼쳐보기';
    if (!open) $('#detail').scrollIntoView({ behavior: 'auto' });
  });

  // ───────── 리뷰·Q&A
  photoStrip($('#photo-strip'));
  $$('.pd .acc').forEach(a => accordion(a));
  readyThumbs($('.pd'));
  if (location.hash === '#reviews') setTimeout(() => $('#reviews').scrollIntoView(), 60);
})();
