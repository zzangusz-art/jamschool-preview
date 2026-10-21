/* 잠스쿨 공식홈 — 공통 UI: 레이어(모달·드로어·시트), 토스트, 아코디언, 탭, 장바구니, 라이트박스 */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const won = n => n.toLocaleString('ko-KR') + '원';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const I = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.3 0 5.6 3.1 4.4 6.6C19.5 15.9 12 20.5 12 20.5z"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    minus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  };

  // ── 저장소(사생활 모드 등에서 실패해도 동작하도록)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 무시 */ } },
    sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 무시 */ } },
  };

  // ── 토스트
  function toast(msg, opt = {}) {
    let box = $('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${opt.icon || I.check}<span>${esc(msg)}</span>${opt.action ? `<button type="button">${esc(opt.action)}</button>` : ''}`;
    if (opt.action) el.querySelector('button').addEventListener('click', () => { opt.onAction && opt.onAction(); kill(); });
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    let t = setTimeout(kill, opt.ms || 2800);
    function kill() { clearTimeout(t); el.classList.add('out'); setTimeout(() => el.remove(), 300); }
    return kill;
  }

  // ── 레이어(모달/드로어/시트) 공통: 포커스 트랩, ESC, 딤 클릭, 스크롤 잠금, 포커스 복귀
  const stack = [];
  function openLayer(el, opener) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el || el.classList.contains('is-open')) return;
    el._opener = opener || document.activeElement;
    el.classList.add('is-open');
    el.removeAttribute('hidden');
    el.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-shown')));
    stack.push(el);
    document.body.classList.add('is-locked');
    const f = el.querySelector('[autofocus]') || el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    setTimeout(() => f && f.focus({ preventScroll: true }), 60);
    el.dispatchEvent(new CustomEvent('layer:open'));
  }
  function closeLayer(el) {
    el = el || stack[stack.length - 1];
    if (!el || !el.classList.contains('is-open')) return;
    el.classList.remove('is-shown');
    el.setAttribute('aria-hidden', 'true');
    const i = stack.indexOf(el); if (i > -1) stack.splice(i, 1);
    setTimeout(() => { el.classList.remove('is-open'); el.dispatchEvent(new CustomEvent('layer:closed')); }, reduce ? 0 : 380);
    if (!stack.length) document.body.classList.remove('is-locked');
    if (el._opener && el._opener.focus) el._opener.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', e => {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') { e.preventDefault(); closeLayer(top); }
    if (e.key === 'Tab') {
      const f = $$('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', top).filter(x => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if (top.classList.contains('lightbox')) {
      if (e.key === 'ArrowLeft') top._go && top._go(-1);
      if (e.key === 'ArrowRight') top._go && top._go(1);
    }
  });
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]');
    if (o) { e.preventDefault(); openLayer(o.dataset.open, o); return; }
    const c = e.target.closest('[data-close]');
    if (c) { e.preventDefault(); closeLayer(c.closest('.layer')); return; }
    if (e.target.classList.contains('layer__dim')) closeLayer(e.target.closest('.layer'));
  });

  // ── 아코디언 (높이 애니메이션)
  function accordion(root, { single = true } = {}) {
    $$('.acc__btn', root).forEach(btn => {
      if (btn._acc) return; btn._acc = true;
      const panel = document.getElementById(btn.getAttribute('aria-controls'));
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        if (single && !open) $$('.acc__btn[aria-expanded="true"]', root).forEach(b => toggle(b, false));
        toggle(btn, !open);
      });
      function toggle(b, on) {
        const p = document.getElementById(b.getAttribute('aria-controls'));
        b.setAttribute('aria-expanded', on);
        const h = p.firstElementChild.offsetHeight;
        if (on) { p.style.height = h + 'px'; p.addEventListener('transitionend', function te() { if (b.getAttribute('aria-expanded') === 'true') p.style.height = 'auto'; p.removeEventListener('transitionend', te); }); }
        else { p.style.height = h + 'px'; requestAnimationFrame(() => { p.style.height = '0px'; }); }
      }
      if (btn.getAttribute('aria-expanded') === 'true') panel.style.height = 'auto';
    });
  }
  const accItem = (...a) => RENDER.accItem(...a);

  // ── 탭(키보드 좌우 이동)
  function tabs(list, onChange) {
    const ts = $$('[role="tab"]', list);
    ts.forEach((t, i) => {
      t.addEventListener('click', () => select(i));
      t.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight') { e.preventDefault(); select((i + 1) % ts.length, true); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); select((i - 1 + ts.length) % ts.length, true); }
      });
    });
    function select(i, focus) {
      ts.forEach((t, j) => { t.setAttribute('aria-selected', i === j); t.tabIndex = i === j ? 0 : -1; });
      if (focus) ts[i].focus();
      onChange && onChange(i, ts[i]);
    }
    return select;
  }

  // ── 스크롤 등장 / 카운트업
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('is-in');
    if (e.target.hasAttribute('data-count')) countUp(e.target);
    io.unobserve(e.target);
  }), { rootMargin: '0px 0px -12% 0px' }) : null;
  function reveal(root = document) { $$('[data-reveal], [data-count]', root).forEach(el => io ? io.observe(el) : el.classList.add('is-in')); }
  function countUp(el) {
    const to = parseFloat(el.dataset.count), dec = (el.dataset.count.split('.')[1] || '').length, dur = 1400;
    if (reduce) { el.textContent = to.toLocaleString('ko-KR', { minimumFractionDigits: dec, maximumFractionDigits: dec }); return; }
    const t0 = performance.now();
    (function step(t) {
      const p = Math.min(1, (t - t0) / dur), v = to * (1 - Math.pow(1 - p, 4));
      el.textContent = v.toLocaleString('ko-KR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  // ── 장바구니 / 찜
  const CART_K = 'jam_cart_v1', WISH_K = 'jam_wish_v1';
  const cart = {
    items: store.get(CART_K, []),
    save() { store.set(CART_K, this.items); renderCart(); },
    add(it) {
      const f = this.items.find(x => x.key === it.key);
      if (f) f.qty = Math.min(99, f.qty + (it.qty || 1)); else this.items.push({ ...it, qty: it.qty || 1 });
      this.save();
      const b = $('.cart-count'); if (b) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
    },
    setQty(key, q) { const f = this.items.find(x => x.key === key); if (f) { f.qty = Math.max(1, Math.min(99, q)); this.save(); } },
    remove(key) { this.items = this.items.filter(x => x.key !== key); this.save(); },
    count() { return this.items.reduce((s, x) => s + x.qty, 0); },
    total() { return this.items.reduce((s, x) => s + x.qty * x.price, 0); },
  };
  const wish = {
    ids: new Set(store.get(WISH_K, [])),
    toggle(id) { this.ids.has(id) ? this.ids.delete(id) : this.ids.add(id); store.set(WISH_K, [...this.ids]); return this.ids.has(id); },
    has(id) { return this.ids.has(id); },
  };
  function renderCart() {
    const n = cart.count();
    $$('.cart-count').forEach(b => { b.textContent = n; b.classList.toggle('has', n > 0); });
    const body = $('#cart-body'), foot = $('#cart-foot');
    if (!body) return;
    if (!cart.items.length) {
      body.innerHTML = `<div class="cart-empty">${I.bag}<p>장바구니가 비어 있습니다.</p><a class="btn btn--line btn--sm" href="shop.html" style="margin-top:16px">전체 상품 보기</a></div>`;
      foot.hidden = true; return;
    }
    foot.hidden = false;
    body.innerHTML = cart.items.map(x => `
      <div class="citem" data-key="${esc(x.key)}">
        ${RENDER.pic(x.img, 'alt="" width="76" height="76" loading="lazy"')}
        <div>
          <p class="citem__name">${esc(x.name)}</p>
          ${x.opt ? `<p class="citem__opt">${esc(x.opt)}</p>` : ''}
          <div class="citem__row">
            <div class="qty" aria-label="수량">
              <button type="button" data-q="-1" aria-label="수량 줄이기" ${x.qty <= 1 ? 'disabled' : ''}>${I.minus}</button><span>${x.qty}</span><button type="button" data-q="1" aria-label="수량 늘리기">${I.plus}</button>
            </div>
            <b class="citem__price">${won(x.qty * x.price)}</b>
          </div>
          <button type="button" class="citem__del" data-del>삭제</button>
        </div>
      </div>`).join('');
    $('#cart-sub').textContent = won(cart.total());
    $('#cart-total').textContent = won(cart.total());
  }
  document.addEventListener('click', e => {
    const row = e.target.closest('.citem'); if (!row) return;
    const key = row.dataset.key, it = cart.items.find(x => x.key === key);
    const q = e.target.closest('[data-q]');
    if (q && it) cart.setQty(key, it.qty + +q.dataset.q);
    if (e.target.closest('[data-del]')) { cart.remove(key); toast('장바구니에서 삭제했습니다.'); }
  });

  // ── 라이트박스 (스와이프·키보드)
  function lightbox(items, start = 0) {
    let lb = $('#lightbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.className = 'layer lightbox'; lb.id = 'lightbox'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', '이미지 크게 보기'); lb.setAttribute('aria-hidden', 'true');
      lb.innerHTML = `<div class="layer__dim"></div><div class="lb"><div class="lb__head"><span class="lb__count" aria-live="polite"></span><button class="icon-btn" type="button" data-close aria-label="닫기">${I.x}</button></div><div class="lb__stage"><button class="lb__nav lb__prev" type="button" aria-label="이전 이미지">${I.left}</button><picture><source type="image/webp"><img alt=""></picture><button class="lb__nav lb__next" type="button" aria-label="다음 이미지">${I.right}</button></div><p class="lb__cap"></p></div>`;
      document.body.appendChild(lb);
      $('.lb__prev', lb).addEventListener('click', () => lb._go(-1));
      $('.lb__next', lb).addEventListener('click', () => lb._go(1));
      let sx = null;
      $('.lb__stage', lb).addEventListener('pointerdown', e => { sx = e.clientX; });
      $('.lb__stage', lb).addEventListener('pointerup', e => { if (sx == null) return; const d = e.clientX - sx; if (Math.abs(d) > 50) lb._go(d < 0 ? 1 : -1); sx = null; });
      $('.lb__stage', lb).addEventListener('click', e => { if (e.target === e.currentTarget) closeLayer(lb); });
    }
    let i = start;
    lb._go = d => { i = (i + d + items.length) % items.length; show(); };
    function show() {
      const it = items[i], img = $('.lb__stage img', lb);
      RENDER.swap(img, it.src); img.alt = it.alt || '';
      $('.lb__cap', lb).textContent = it.cap || '';
      $('.lb__count', lb).textContent = items.length > 1 ? `${i + 1} / ${items.length}` : '';
      $$('.lb__nav', lb).forEach(b => b.hidden = items.length < 2);
    }
    show(); openLayer(lb);
  }

  // ── 상품 카드 (render.js 공용)
  const productCard = p => RENDER.productCard(p, wish.has(p.id));
  const rate = RENDER.rate;
  // 이미지 로드되면 스켈레톤 제거
  function readyThumbs(root) {
    $$('.pcard', root).forEach(c => {
      const img = $('.pcard__thumb img', c), done = () => { c.classList.remove('is-loading'); $('.pcard__thumb', c).classList.add('is-ready'); };
      if (img.complete && img.naturalWidth) done(); else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }
    });
  }
  document.addEventListener('click', e => {
    const w = e.target.closest('[data-wish]');
    if (w) {
      e.preventDefault();
      const id = +w.dataset.wish, on = wish.toggle(id);
      $$(`[data-wish="${id}"]`).forEach(b => b.setAttribute('aria-pressed', on));
      toast(on ? '찜 목록에 담았습니다.' : '찜 목록에서 뺐습니다.', { icon: I.heart });
    }
  });

  // ── 헤더/공통 초기화
  function initChrome() {
    const top = $('.topbar');
    if (top && store.sget('jam_topbar_off')) top.hidden = true;
    $('.topbar__close')?.addEventListener('click', () => { top.hidden = true; store.sset('jam_topbar_off', '1'); });
    const header = $('.header'), fabTop = $('.fab__top');
    const onScroll = () => {
      const y = scrollY;
      header && header.classList.toggle('is-scrolled', y > 8);
      fabTop && fabTop.classList.toggle('is-on', y > innerHeight * 1.2);
    };
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    fabTop?.addEventListener('click', () => scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }));
    // 모바일 메뉴 아코디언
    $$('.mnav [aria-controls]').forEach(b => b.addEventListener('click', () => {
      const p = document.getElementById(b.getAttribute('aria-controls')), on = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', on);
      p.style.height = on ? p.firstElementChild.offsetHeight + 'px' : '0px';
    }));
    $$('#menu a').forEach(a => a.addEventListener('click', () => closeLayer($('#menu'))));
    // 검색
    const input = $('#search-input'), res = $('#search-res');
    if (input) {
      const run = () => {
        const q = input.value.trim();
        const list = q ? JAM.PRODUCTS.filter(p => (p.name + ' ' + p.key).toLowerCase().includes(q.toLowerCase())) : JAM.PRODUCTS.slice(0, 4);
        const hl = s => q ? esc(s).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`) : esc(s);
        res.innerHTML = list.length ? list.map(p => `<a href="product-${p.id}.html">${RENDER.pic(p.imgs[0], 'alt="" width="56" height="56" loading="lazy"')}<div><b>${hl(p.name)}</b><span>${won(p.price)}${p.full ? '~' : ''}</span></div></a>`).join('')
          : `<p class="search-empty">‘${esc(q)}’에 맞는 상품이 없습니다.<br>매트리스, 베개, 쿠션으로 찾아보세요.</p>`;
      };
      input.addEventListener('input', run);
      $('#search')?.addEventListener('layer:open', () => { input.value = ''; run(); });
      $$('#search [data-kw]').forEach(b => b.addEventListener('click', () => { input.value = b.dataset.kw; run(); input.focus(); }));
    }
    // 쿠폰
    $$('[data-coupon]').forEach(b => b.addEventListener('click', () => {
      if (store.sget('jam_coupon')) { toast('이미 받은 쿠폰입니다. 회원가입 후 마이페이지에서 확인하세요.'); return; }
      store.sset('jam_coupon', '1');
      closeLayer($('#coupon'));
      toast('가입축하 쿠폰 10,000원을 받았습니다.', { action: '회원가입', onAction: () => { location.href = 'https://jamschool.co.kr/'; } });
    }));
    // 주문: 장바구니 전체를 주문서로 (shop-core.js 가 없는 페이지는 주문서로 바로 이동)
    $('#cart-order')?.addEventListener('click', e => {
      const opener = e.currentTarget; closeLayer($('#cart'));
      setTimeout(() => window.SHOP ? SHOP.checkoutCart(null, opener) : (location.href = 'checkout.html'), 120);
    });
    renderCart();
    reveal();
  }

  // ── 포토 구매평 스트립 + 리뷰 더보기
  function photoStrip(el) {
    if (!el) return;
    const ph = JAM.PHOTOS;
    el.innerHTML = ph.map((s, i) => `<button type="button" aria-label="포토 구매평 ${i + 1} 크게 보기">${RENDER.pic(s, 'alt="" width="160" height="160" loading="lazy"')}</button>`).join('');
    $$('button', el).forEach((b, i) => b.addEventListener('click', () => lightbox(ph.map((s, k) => ({ src: s, alt: `포토 구매평 ${k + 1}`, cap: '3단 접이식 매트리스 포토 구매평' })), i)));
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('.rv__more'); if (!b) return;
    const t = document.getElementById(b.getAttribute('aria-controls')), on = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', on); t.style.webkitLineClamp = on ? 'unset' : ''; t.style.display = on ? 'block' : '';
    b.textContent = on ? '접기' : '더보기';
  });
  // 줄 수가 넘치지 않는 리뷰는 더보기 숨김
  function fitReviews(root = document) {
    $$('.rv__text', root).forEach(t => { const b = t.nextElementSibling; if (b && b.classList.contains('rv__more')) b.hidden = t.scrollHeight <= t.clientHeight + 2; });
  }
  addEventListener('load', () => fitReviews());

  window.UI = { $, $$, won, esc, I, toast, photoStrip, fitReviews, openLayer, closeLayer, accordion, accItem, tabs, reveal, cart, wish, renderCart, lightbox, productCard, readyThumbs, rate, store, reduce };
  document.addEventListener('DOMContentLoaded', initChrome);
})();
