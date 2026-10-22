/* 홈: 히어로 스크롤 시퀀스, 접기 시퀀스(캔버스), 베스트 상품, 사이즈 가이드, 시험성적, 리뷰, 사용 장면, FAQ */
(function () {
  const { $, $$, won, esc, toast, openLayer, accordion, tabs, cart, lightbox, readyThumbs, reduce } = UI;
  const { PRODUCTS, OPTIONS_29: O, TESTS, USES } = JAM;
  const P29 = PRODUCTS.find(p => p.id === 29);
  const { optButtons, bindRadios, addToCart } = SHOP;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const eio = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const eo = t => 1 - Math.pow(1 - t, 3);
  const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
  let ticking = false;
  const loops = [];
  function onFrame() { ticking = false; loops.forEach(f => f()); }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onFrame); } }, { passive: true });
  addEventListener('resize', debounce(() => { loops.forEach(f => f(true)); }, 120));

  // ───────── HERO: 15초 쇼릴을 한 번 재생 → 끝나면(또는 건너뛰기) 제품 슬라이드 배너로 넘어간다
  // 같은 세션에서 다시 오거나, 동작 줄이기·데이터 절약이면 슬라이드부터. '15초 영상'으로 다시 볼 수 있다.
  (function hero() {
    const hero = $('.hero'); if (!hero) return;
    const video = $('#hero-video'), ctrl = $('.hero__ctrl'), skip = $('#hero-skip'), bar = $('#hero-bar');
    const region = $('#hero-slides'), slides = $$('.hs', hero), dots = $$('.hs__dot', hero), cur = $('#hs-cur');
    const pauseBtn = $('.hs__pause', hero), replay = $('.hs__replay', hero);
    const isPortrait = () => matchMedia('(max-aspect-ratio: 1/1)').matches;
    const saveData = navigator.connection && navigator.connection.saveData;
    const SEEN = 'jam_reel_seen', DUR = 5500;
    let mode = '', src = '', idx = 0, elapsed = 0, last = 0, userPaused = !!reduce, hold = false, visible = true;

    function setSrc() {
      const pt = isPortrait(), s = pt ? 'assets/video/hero-mobile.mp4' : 'assets/video/hero-desktop.mp4';
      if (s === src) return; src = s;
      video.poster = pt ? 'assets/video/hero-mobile.jpg' : 'assets/video/hero-desktop.jpg';
      video.src = s;
      if (mode === 'reel') video.play().catch(() => setMode('slides'));
    }
    function setCtrl(playing) {
      ctrl.dataset.state = playing ? 'playing' : 'paused';
      ctrl.setAttribute('aria-label', playing ? '영상 일시정지' : '영상 재생');
      ctrl.innerHTML = `<svg><use href="#i-${playing ? 'pause' : 'play'}"/></svg>`;
    }
    function setMode(m, instant) {
      if (m === mode) return;
      mode = m;
      if (instant) hero.classList.add('no-anim');
      hero.dataset.mode = m;
      if (instant) requestAnimationFrame(() => requestAnimationFrame(() => hero.classList.remove('no-anim')));
      if (m === 'reel') {
        setSrc();
        try { video.currentTime = 0; } catch (e) { /* 아직 메타데이터 전 */ }
        video.play().catch(() => setMode('slides'));
      } else {
        video.pause();
        UI.store.sset(SEEN, '1');
        elapsed = 0; go(idx);
        // 첫 장을 보는 동안 나머지 슬라이드 사진을 미리 받아 둔다(넘길 때 사진이 늦게 뜨지 않게)
        setTimeout(() => slides.forEach(sl => { const im = sl.querySelector('img'); if (im && im.loading === 'lazy') im.loading = 'eager'; }), 800);
      }
    }
    ctrl.addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
    video.addEventListener('play', () => setCtrl(true));
    video.addEventListener('pause', () => setCtrl(false));
    video.addEventListener('ended', () => setMode('slides'));
    video.addEventListener('timeupdate', () => { if (video.duration) bar.style.transform = `scaleX(${(video.currentTime / video.duration).toFixed(4)})`; });
    skip.addEventListener('click', () => { setMode('slides'); setTimeout(() => region.focus({ preventScroll: true }), 60); });
    replay.addEventListener('click', () => { setMode('reel'); setTimeout(() => skip.focus({ preventScroll: true }), 80); });
    addEventListener('resize', debounce(() => { if (mode === 'reel') setSrc(); }, 250));

    // 슬라이드
    function go(i) {
      idx = (i + slides.length) % slides.length; elapsed = 0;
      slides.forEach((s, k) => {
        const on = k === idx;
        s.classList.toggle('is-on', on);
        if (on) { s.removeAttribute('aria-hidden'); s.inert = false; } else { s.setAttribute('aria-hidden', 'true'); s.inert = true; }
      });
      dots.forEach((d, k) => { d.setAttribute('aria-current', k === idx); d.style.setProperty('--p', k === idx ? 0 : 1); });
      cur.textContent = idx + 1;
      hero.classList.toggle('is-dark', slides[idx].classList.contains('hs--dark'));
    }
    dots.forEach((d, k) => d.addEventListener('click', () => go(k)));
    $('.hs__prev', hero).addEventListener('click', () => go(idx - 1));
    $('.hs__next', hero).addEventListener('click', () => go(idx + 1));
    function setPaused(p) {
      userPaused = p;
      pauseBtn.setAttribute('aria-pressed', p);
      pauseBtn.setAttribute('aria-label', p ? '자동 넘김 다시 시작' : '자동 넘김 멈춤');
      pauseBtn.innerHTML = `<svg aria-hidden="true"><use href="#i-${p ? 'play' : 'pause'}"/></svg>`;
    }
    pauseBtn.addEventListener('click', () => setPaused(!userPaused));
    setPaused(userPaused);
    // 마우스를 올리거나 키보드 포커스가 안에 있으면 잠시 멈춤
    region.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') hold = true; });
    region.addEventListener('pointerleave', () => { hold = false; });
    region.addEventListener('focusin', () => { hold = true; });
    region.addEventListener('focusout', e => { if (!region.contains(e.relatedTarget)) hold = false; });
    region.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1); }
    });
    // 스와이프
    let sx = null, sy = 0;
    region.addEventListener('pointerdown', e => { if (e.target.closest('a, button')) return; sx = e.clientX; sy = e.clientY; });
    region.addEventListener('pointerup', e => {
      if (sx == null) return; const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) go(idx + (dx < 0 ? 1 : -1));
    });
    // 자동 넘김(진행 막대): 화면에 보이고, 멈춤이 아니고, 탭이 보일 때만
    (function tick(now) {
      const dt = last ? Math.min(100, now - last) : 0; last = now;
      if (mode === 'slides' && !userPaused && !hold && visible && !document.hidden) {
        elapsed += dt;
        dots[idx] && dots[idx].style.setProperty('--p', Math.min(1, elapsed / DUR).toFixed(3));
        if (elapsed >= DUR) go(idx + 1);
      }
      requestAnimationFrame(tick);
    })(0);
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (mode === 'reel') { if (visible) video.play().catch(() => {}); else video.pause(); }
    }).observe(hero);
    // 히어로가 화면을 덮고 있으면 플로팅 버튼을 숨긴다(접기 시퀀스와 같은 규칙)
    loops.push(() => {
      const r = hero.getBoundingClientRect();
      window.__pinHero = r.bottom > innerHeight * .35;
      document.body.classList.toggle('in-hero', !!(window.__pinHero || window.__pinFold));
    });

    const skipReel = reduce || saveData || UI.store.sget(SEEN);
    if (skipReel) { video.preload = 'none'; setMode('slides', true); } else setMode('reel', true);
  })();

  // ───────── FOLD: 이미지 시퀀스를 스크롤에 맞춰 캔버스에 그린다
  (function fold() {
    const sec = $('#fold'); if (!sec) return;
    const stage = $('.fold__stage', sec), cv = $('#fold-canvas'), c = cv.getContext('2d');
    const steps = $$('.fold-step', sec), bars = $$('.fold__bar b', sec);
    const N = 100, small = innerWidth < 768;
    const dir = small ? 'assets/seq-m/' : 'assets/seq/';
    const frames = new Array(N);
    const loaded = new Array(N).fill(false);
    let want = 0, drawn = -1;
    const order = [];
    for (const st of [33, 11, 4, 2, 1]) for (let i = 0; i < N; i += st) if (!order.includes(i)) order.push(i);
    if (!order.includes(N - 1)) order.splice(1, 0, N - 1);
    let started = false;
    function load() {
      if (started) return; started = true;
      let q = 0;
      const next = () => {
        if (q >= order.length) return;
        const i = order[q++], img = new Image();
        img.decoding = 'async';
        img.onload = () => { frames[i] = img; loaded[i] = true; if (Math.abs(i - want) <= 3 || drawn < 0) draw(want); next(); };
        img.onerror = next;
        img.src = `${dir}f${String(i).padStart(3, '0')}.jpg`;
      };
      for (let k = 0; k < 4; k++) next();
    }
    new IntersectionObserver(([e]) => { if (e.isIntersecting) load(); }, { rootMargin: '120% 0px' }).observe(sec);
    function size() {
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      const px = Math.round(r.width * dpr);
      const cap = small ? 640 : 1000;
      cv.width = cv.height = Math.min(px, cap);
      drawn = -1; draw(want);
    }
    function draw(i) {
      let k = -1;
      for (let d = 0; d < N; d++) { if (loaded[i - d]) { k = i - d; break; } if (loaded[i + d]) { k = i + d; break; } }
      if (k < 0 || k === drawn) return;
      drawn = k;
      c.drawImage(frames[k], 0, 0, cv.width, cv.height);
    }
    size();
    let last = -1;
    loops.push(function (resized) {
      if (resized) size();
      const r = sec.getBoundingClientRect();
      window.__pinFold = innerWidth < 1024 && r.top < innerHeight * .5 && r.bottom > innerHeight * .6;
      document.body.classList.toggle('in-hero', !!(window.__pinHero || window.__pinFold));
      if (r.bottom < 0 || r.top > innerHeight) return;
      const p = clamp(-r.top / (r.height - stage.offsetHeight));
      want = Math.round(p * (N - 1)); draw(want);
      const s = p < .3 ? 0 : p < .62 ? 1 : 2;
      if (s !== last) { steps.forEach((el, i) => el.classList.toggle('is-on', i === s)); last = s; }
      const f = [clamp(p / .3), clamp((p - .3) / .32), clamp((p - .62) / .38)];
      bars.forEach((b, i) => { b.style.transform = `scaleX(${f[i].toFixed(3)})`; });
    });
  })();

  // ───────── BEST: 스켈레톤 → 실제 이미지, 분류 필터, 빠른 보기
  const grid = $('#best-grid');
  if (grid) {
    readyThumbs(grid);
    const filter = $('#best-filter');
    tabs(filter, (i, t) => {
      const f = t.dataset.f;
      $$('.pcard', grid).forEach(card => {
        const show = f === 'all' || card.dataset.cat === f;
        card.hidden = !show;
        if (show && !reduce) card.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.22,.8,.2,1)' });
      });
    });
  }
  // 빠른 보기·옵션 버튼·장바구니 담기는 shop-core.js(SHOP) 공용

  // ───────── GUIDE: 추천 → 옵션 → 도식·스펙
  (function guide() {
    const panel = $('#guide-panel'); if (!panel) return;
    const st = { t: '12', s: 'SS', c: 'gray' };
    const reco = { t: null, s: null };
    $('#opt-t').innerHTML = optButtons('t', O.thickness, st.t); $('#opt-t').dataset.k = 't';
    $('#opt-s').innerHTML = optButtons('s', O.size, st.s); $('#opt-s').dataset.k = 's';
    $('#opt-c').innerHTML = optButtons('c', O.color, st.c); $('#opt-c').dataset.k = 'c';
    const noteT = $('#lb-t-note'), list = $('#spec-list'), svg = $('#viz'), recoA = $('#reco-a');
    let shown = { w: 110, h: 36, th: 12 }, anim = null;
    function render() {
      const k = `${st.t}-${st.s}`, s = O.size.find(x => x.id === st.s), t = O.thickness.find(x => x.id === st.t);
      noteT.textContent = t.note;
      list.innerHTML = `
        <div><dt>펼친 크기</dt><dd>${s.w} × 200 × ${st.t}cm</dd></div>
        <div><dt>접은 크기</dt><dd>${s.w} × 67 × ${O.folded[st.t]}cm</dd></div>
        <div><dt>무게</dt><dd>${O.weight[k]}kg</dd></div>
        <div class="is-price"><dt>판매가</dt><dd>${won(O.price[k])}</dd></div>`;
      tween({ w: s.w, h: O.folded[st.t], th: +st.t });
      $$('.size-opt', panel).forEach(b => { const v = b.dataset.v; let sm = b.querySelector('.sp'); if (!sm) { sm = document.createElement('small'); sm.className = 'sp'; b.appendChild(sm); } sm.textContent = won(O.price[`${st.t}-${v}`]); });
    }
    function tween(to) {
      const from = { ...shown }, t0 = performance.now(), d = reduce ? 1 : 420;
      cancelAnimationFrame(anim);
      (function step(n) {
        const k = Math.min(1, (n - t0) / d), e = eo(k);
        shown = { w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e, th: from.th + (to.th - from.th) * e };
        svg.innerHTML = viz(shown);
        if (k < 1) anim = requestAnimationFrame(step);
      })(t0);
    }
    function viz({ w, h, th }) {
      const k = 1.32, L = 200 * k, Wd = w * k, x0 = 170 - Wd / 2, y0 = 42;
      const k2 = 1.1, FW = w * k2, FH = h * k2 * 1.35, dx = 67 * k2 * .55, dy = 67 * k2 * .32;
      const fx = 452 - (FW + dx) / 2, fy = 300 - FH;
      const layers = [0, 1, 2].map(i => `<line x1="${fx}" x2="${fx + FW}" y1="${fy + FH * (i + 1) / 3}" y2="${fy + FH * (i + 1) / 3}" stroke="#E9ECEF" stroke-width="1.6"/>`).join('');
      return `<defs><pattern id="qp" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="11" height="11" fill="#8A8E94"/><path d="M0 0H11M0 0V11" stroke="#73777D" stroke-width="1.2"/></pattern></defs>
        <rect x="${x0}" y="${y0}" width="${Wd}" height="${L}" rx="7" fill="url(#qp)"/>
        <line x1="${x0}" x2="${x0 + Wd}" y1="${y0 + L / 3}" y2="${y0 + L / 3}" stroke="#5E6268" stroke-width="2.4"/><line x1="${x0}" x2="${x0 + Wd}" y1="${y0 + 2 * L / 3}" y2="${y0 + 2 * L / 3}" stroke="#5E6268" stroke-width="2.4"/>
        <g stroke="#0A7DBE" stroke-width="1.6"><line x1="${x0}" x2="${x0 + Wd}" y1="${y0 - 14}" y2="${y0 - 14}"/><line x1="${x0}" x2="${x0}" y1="${y0 - 20}" y2="${y0 - 8}"/><line x1="${x0 + Wd}" x2="${x0 + Wd}" y1="${y0 - 20}" y2="${y0 - 8}"/>
        <line x1="${x0 - 14}" x2="${x0 - 14}" y1="${y0}" y2="${y0 + L}"/><line x1="${x0 - 20}" x2="${x0 - 8}" y1="${y0}" y2="${y0}"/><line x1="${x0 - 20}" x2="${x0 - 8}" y1="${y0 + L}" y2="${y0 + L}"/></g>
        <text x="${x0 + Wd / 2}" y="${y0 - 24}" text-anchor="middle" font-size="24" font-weight="800" fill="#15181C">${Math.round(w)}cm</text>
        <text x="${x0 - 30}" y="${y0 + L / 2}" text-anchor="middle" font-size="24" font-weight="800" fill="#15181C" transform="rotate(-90 ${x0 - 30} ${y0 + L / 2})">200cm</text>
        <text x="${x0 + Wd + 12}" y="${y0 + L - 4}" font-size="20" font-weight="700" fill="#66707C">${Math.round(th)}cm</text>
        <polygon points="${fx},${fy} ${fx + dx},${fy - dy} ${fx + FW + dx},${fy - dy} ${fx + FW},${fy}" fill="#A3A7AD"/>
        <polygon points="${fx + FW},${fy} ${fx + FW + dx},${fy - dy} ${fx + FW + dx},${fy + FH - dy} ${fx + FW},${fy + FH}" fill="#6E7278"/>
        <rect x="${fx}" y="${fy}" width="${FW}" height="${FH}" fill="#858990"/>${layers}
        <text x="${fx + FW / 2}" y="${fy + FH + 30}" text-anchor="middle" font-size="24" font-weight="800" fill="#15181C">${Math.round(w)}cm</text>
        <text x="${fx + FW + dx + 10}" y="${fy + FH / 2 - dy / 2 + 9}" font-size="24" font-weight="800" fill="#15181C">${Math.round(h)}cm</text>
        <text x="${fx + FW / 2 + dx / 2 + 6}" y="${fy - dy - 12}" text-anchor="middle" font-size="20" font-weight="700" fill="#66707C">깊이 67cm</text>`;
    }
    bindRadios(panel, (k, v) => {
      if (k === 't' || k === 's' || k === 'c') { st[k] = v; render(); }
    });
    // 추천 칩
    $$('[data-reco]', panel).forEach(g => $$('[role="radio"]', g).forEach(b => b.addEventListener('click', () => {
      $$('[role="radio"]', g).forEach(x => x.setAttribute('aria-checked', x === b));
      reco[g.dataset.reco] = b.dataset.v;
      if (reco.t && reco.s) {
        st.t = reco.t; st.s = reco.s;
        [['#opt-t', st.t], ['#opt-s', st.s]].forEach(([sel, val]) => $$('[role="radio"]', $(sel)).forEach(x => { x.setAttribute('aria-checked', x.dataset.v === val); x.tabIndex = x.dataset.v === val ? 0 : -1; }));
        const t = O.thickness.find(x => x.id === st.t), s = O.size.find(x => x.id === st.s);
        recoA.textContent = `추천: ${t.label} ${t.sub} · ${s.label}(${s.w}cm) — ${won(O.price[`${st.t}-${st.s}`])}`;
        render();
      } else recoA.textContent = reco.t ? '이제 쓰는 사람을 골라 주세요.' : '이제 까는 곳을 골라 주세요.';
    })));
    $('#guide-add').addEventListener('click', () => addToCart(P29, st));
    render();
  })();

  // ───────── SAFETY: 아코디언 + 성적서 라이트박스
  const tests = $('#tests');
  if (tests) {
    accordion(tests);
    const items = TESTS.map(t => ({ src: 'assets/img/' + t.cert, alt: `${t.q} 시험성적서`, cap: `${t.q} · ${t.org}` }));
    tests.addEventListener('click', e => { const b = e.target.closest('[data-cert]'); if (b) lightbox(items, +b.dataset.cert); });
  }

  // ───────── REVIEW
  UI.photoStrip && UI.photoStrip($('#photo-strip'));

  // ───────── USE 탭
  // 구매 이유 벤토: 시연 영상은 보일 때만 받아서 재생(동작 줄이기면 포스터만), 비교 7가지 접기
  (function bento() {
    const v = $('.bento video[data-src]');
    if (v && !reduce && 'IntersectionObserver' in window) new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { if (!v.src) v.src = v.dataset.src; v.play().catch(() => {}); } else v.pause();
    }, { rootMargin: '120px 0px' }).observe(v);
    const more = $('#why-more'); if (more) accordion(more);
  })();
  // 비교 근거 카드의 '성적서 보기' → 같은 성적서 이미지 라이트박스
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-proof-cert]'); if (!b) return;
    const items = TESTS.map(t => ({ src: 'assets/img/' + t.cert, alt: `${t.q} 시험성적서`, cap: `${t.q} · ${t.org}` }));
    lightbox(items, +b.dataset.proofCert);
  });
  const useTabs = $('#use-tabs');
  if (useTabs) tabs(useTabs, (i, t) => { const p = $('#use-p'); p.innerHTML = RENDER.usePanel(USES[i]); p.setAttribute('aria-labelledby', t.id); });

  // ───────── FAQ 필터 + 아코디언
  const faq = $('#faq-list');
  if (faq) {
    accordion(faq);
    $$('#faq-filter .chip').forEach(b => b.addEventListener('click', () => {
      $$('#faq-filter .chip').forEach(x => x.setAttribute('aria-pressed', x === b));
      const f = b.dataset.f;
      $$('[data-c]', faq).forEach(it => { it.hidden = !(f === 'all' || it.dataset.c === f); });
    }));
  }
  // ───────── PRICE: 두께 탭 + 카드에서 바로 담기
  const priceTabs = $('#price-tabs');
  if (priceTabs) tabs(priceTabs, (i, t) => {
    $$('#price .price-grid').forEach(p => { p.hidden = p.id !== t.getAttribute('aria-controls'); });
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-add29]'); if (!b) return;
    const [t, s] = b.dataset.add29.split('-');
    addToCart(P29, { t, s, c: 'gray' });
  });

  // ───────── 롤링 후기: 멈춤 버튼(움직이는 콘텐츠 정지 수단), 카드 누르면 전문 모달
  const roll = $('.roll'), rollBtn = $('#roll-toggle');
  if (roll && rollBtn) {
    if (reduce) rollBtn.hidden = true;
    rollBtn.addEventListener('click', () => {
      const on = roll.classList.toggle('is-paused');
      rollBtn.setAttribute('aria-pressed', on);
      rollBtn.textContent = on ? '롤링 다시 시작' : '롤링 멈춤';
    });
    roll.addEventListener('click', e => {
      const c = e.target.closest('[data-rv]'); if (!c) return;
      const r = JAM.REVIEWS[+c.dataset.rv];
      $('#rvm-body').innerHTML = `<p class="rv__top"><span class="stars" style="--v:5" aria-label="별점 5점"></span></p><p class="rvm-text" style="margin-top:10px">${esc(r.text)}</p><p class="rvm-foot">${esc(r.id)}${r.opt ? ' · ' + esc(r.opt) : ''} · 스마트스토어 구매평 (원문에서 일부 발췌)</p>`;
      openLayer('rvm', c);
    });
  }
  loops.forEach(f => f(true));
})();
