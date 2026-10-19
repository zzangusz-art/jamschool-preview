/* 홈: 히어로 스크롤 시퀀스, 접기 시퀀스(캔버스), 베스트 상품, 사이즈 가이드, 시험성적, 리뷰, 사용 장면, FAQ */
(function () {
  const { $, $$, won, esc, toast, openLayer, accordion, tabs, cart, lightbox, readyThumbs, reduce } = UI;
  const { PRODUCTS, OPTIONS_29: O, TESTS, USES } = JAM;
  const P29 = PRODUCTS.find(p => p.id === 29);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const eio = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const eo = t => 1 - Math.pow(1 - t, 3);
  const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
  let ticking = false;
  const loops = [];
  function onFrame() { ticking = false; loops.forEach(f => f()); }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onFrame); } }, { passive: true });
  addEventListener('resize', debounce(() => { loops.forEach(f => f(true)); }, 120));

  // ───────── HERO: 15초 필름 → 스크롤하면 카드로 줄고 배너 문구가 아래에서 올라온다
  (function hero() {
    const hero = $('.hero'); if (!hero) return;
    const stage = $('.hero__stage'), media = $('.hero__media'), video = $('#hero-video'), copy = $('.hero__copy'), cue = $('.hero__cue'), shade = $('.hero__shade'), ctrl = $('.hero__ctrl');
    const isPortrait = () => matchMedia('(max-aspect-ratio: 1/1)').matches;
    const saveData = navigator.connection && navigator.connection.saveData;
    let wantPlay = !reduce && !saveData, cur = '';
    function setSrc() {
      const pt = isPortrait();
      const src = pt ? 'assets/video/hero-mobile.mp4' : 'assets/video/hero-desktop.mp4';
      if (src === cur) return; cur = src;
      video.poster = pt ? 'assets/video/hero-mobile.jpg' : 'assets/video/hero-desktop.jpg';
      video.src = src;
      if (wantPlay) video.play().catch(() => setCtrl(false));
    }
    function setCtrl(playing) {
      ctrl.dataset.state = playing ? 'playing' : 'paused';
      ctrl.setAttribute('aria-label', playing ? '영상 일시정지' : '영상 재생');
      ctrl.innerHTML = `<svg><use href="#i-${playing ? 'pause' : 'play'}"/></svg>`;
    }
    ctrl.addEventListener('click', () => {
      wantPlay = video.paused;
      if (wantPlay) video.play().catch(() => {}); else video.pause();
    });
    video.addEventListener('play', () => setCtrl(true));
    video.addEventListener('pause', () => setCtrl(false));
    setCtrl(wantPlay);
    setSrc();
    addEventListener('resize', debounce(setSrc, 250));
    new IntersectionObserver(([e]) => { if (!wantPlay) return; e.isIntersecting ? video.play().catch(() => {}) : video.pause(); }).observe(hero);

    const kids = [...copy.children];
    let copyH = copy.offsetHeight, stageH = stage.offsetHeight;
    loops.push(function (resized) {
      if (resized) { copyH = copy.offsetHeight; stageH = stage.offsetHeight; }
      const r = hero.getBoundingClientRect();
      const total = r.height - stageH;
      const p = clamp(-r.top / total);
      window.__pinHero = r.bottom > innerHeight * .35; document.body.classList.toggle('in-hero', !!(window.__pinHero || window.__pinFold));
      if (r.bottom < 0) return;
      const e = eio(clamp((p - .03) / .5));
      // 영상 박스는 항상 원본 비율을 유지(좁은 화면에서 좌우 글자 잘림 방지)
      const va = isPortrait() ? 9 / 16 : 16 / 9, W = stage.clientWidth, m = Math.min(18, innerWidth * .04);
      const iw = W, ih = W / va >= stageH ? stageH : W / va;
      const iy = (stageH - ih) / 2;
      let fh = Math.max(stageH * .3, stageH - copyH - m * 2.4), fw = fh * va;
      if (fw > W - m * 2) { fw = W - m * 2; fh = fw / va; }
      const L = (a, b) => (a + (b - a) * e).toFixed(1) + 'px';
      Object.assign(media.style, { left: L(0, (W - fw) / 2), top: L(iy, m), width: L(iw, fw), height: L(ih, fh), borderRadius: (22 * e).toFixed(1) + 'px' });
      shade.style.opacity = (e * .7).toFixed(3);
      cue.style.opacity = String(1 - clamp(p / .06));
      kids.forEach((el, i) => {
        const k = eo(clamp((p - .28 - i * .055) / .2));
        el.style.opacity = k.toFixed(3);
        el.style.transform = `translateY(${((1 - k) * 28).toFixed(1)}px)`;
        el.style.visibility = k < .02 ? 'hidden' : 'visible';
      });
    });
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
  document.addEventListener('click', e => {
    const q = e.target.closest('[data-quick]');
    if (q) { e.preventDefault(); openQuick(+q.dataset.quick, q); }
  });
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
  function openQuick(id, opener) {
    const p = PRODUCTS.find(x => x.id === id); if (!p) return;
    const st = { t: '12', s: 'SS', c: 'gray', qty: 1 };
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
    $('#qv-add').addEventListener('click', () => {
      addToCart(p, p.full ? st : null);
      UI.closeLayer($('#quick'));
    });
    openLayer('quick', opener);
  }
  function optLabel(st) {
    const t = O.thickness.find(x => x.id === st.t), s = O.size.find(x => x.id === st.s), c = O.color.find(x => x.id === st.c);
    return `${t.label} ${t.sub} / ${s.label} ${s.w}×200 / ${c.label}`;
  }
  function addToCart(p, st) {
    const item = st
      ? { key: `29-${st.t}-${st.s}-${st.c}`, id: 29, name: p.name, opt: optLabel(st), price: O.price[`${st.t}-${st.s}`], img: st.c === 'ivory' ? p.imgs[8] : p.imgs[0] }
      : { key: String(p.id), id: p.id, name: p.name, opt: '', price: p.price, img: p.imgs[0] };
    cart.add(item);
    toast('장바구니에 담았습니다.', { action: '보기', onAction: () => openLayer('cart') });
  }

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
  loops.forEach(f => f(true));
})();
