/* 상품 페이지 '구매평 모아 보기' — 이야기(주제)·종류·정렬·찾기·더 보기 + 구매평 쓰기. 서버 /api/reviews(tools/reviews/api.mjs)
   빌드가 추천순 6개를 미리 그려 둔다. 서버가 없는 미리보기 사이트에서는 그 6개만 보이고 거르기·더 보기·쓰기는 숨긴다
   구매평 쓰기: 이 홈페이지에서 산 손님은 주문번호+휴대폰(또는 주문 조회의 '구매평 쓰기' 링크)으로 확인 → 바로 게시,
              공식몰·스마트스토어 등 다른 곳에서 산 손님은 구매처·이름 → 관리자 확인 뒤 게시. 사진은 브라우저에서 줄여 최대 3장 */
(function () {
  const el = document.getElementById('rva');
  if (!el || !window.fetch || !window.UI || !window.RENDER) return;
  const { $, $$, esc } = UI, pid = el.dataset.pid, list = $('.rva__list', el), more = $('.rva__more', el), info = $('.rva__info', el);
  let TOP = {}; try { TOP = Object.fromEntries(JSON.parse(el.dataset.topics || '[]')); } catch (e) { TOP = {}; }
  const st = { f: 'all', k: '', sort: 'rec', q: '', page: 0, pages: 1, fresh: true, bust: 0 };
  let seq = 0;
  const hl = () => { try { return st.k && TOP[st.k] ? new RegExp(TOP[st.k], 'g') : null; } catch (e) { return null; } };
  async function load(reset) {
    const my = ++seq;
    if (reset) { st.page = 0; st.fresh = false; }
    const p = new URLSearchParams({ pid, f: st.f, sort: st.sort, page: String(st.page + 1), n: '10' });
    if (st.k) p.set('k', st.k); if (st.q) p.set('q', st.q); if (st.bust) p.set('_', String(st.bust));
    more.disabled = true; el.classList.add('is-busy');
    try {
      const r = await fetch('/api/reviews?' + p.toString(), { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json(); if (my !== seq) return;
      const h = hl(), html = j.items.map((x, i) => RENDER.rvCard(x, `rva-${my}-${j.page}-${i}`, h)).join('');
      if (reset) list.innerHTML = html || '<p class="rva__empty">조건에 맞는 구매평이 없습니다.</p>'; else list.insertAdjacentHTML('beforeend', html);
      st.page = j.page; st.pages = j.pages; siteTab(j.site);
      const tb = st.k && $(`.rva__topics [data-k="${st.k}"]`, el);
      const lab = [tb ? tb.firstChild.textContent.trim() : '', st.q ? `'${st.q}'` : ''].filter(Boolean).join(' · ');
      info.textContent = `${lab ? lab + ' — ' : ''}${j.total.toLocaleString('ko-KR')}건`;
      more.hidden = st.page >= st.pages; more.disabled = false;
      UI.fitReviews(list);
    } catch (e) {
      if (my === seq && reset) info.textContent = '지금은 구매평을 더 불러올 수 없습니다. 잠시 뒤 다시 시도해 주세요.';
      more.hidden = true;
    } finally { if (my === seq) el.classList.remove('is-busy'); }
  }
  const pick = (sel, key, attr) => $$(sel, el).forEach(b => b.addEventListener('click', () => {
    st[key] = b.dataset[attr]; $$(sel, el).forEach(x => x.setAttribute('aria-pressed', String(x === b))); load(true);
  }));
  pick('.rva__topics button', 'k', 'k');
  const tabsEl = $('.rva__tabs', el);
  // 홈페이지 손님 구매평 탭: 서버가 알려 주는 개수로 붙이거나 숫자만 고친다
  function siteTab(n) {
    if (!(n > 0)) return;
    const label = `홈페이지 구매 ${(+n).toLocaleString('ko-KR')}`, b = $('[data-f="site"]', tabsEl);
    if (b) b.textContent = label; else tabsEl.insertAdjacentHTML('beforeend', `<button type="button" data-f="site" aria-pressed="false">${label}</button>`);
  }
  tabsEl.addEventListener('click', e => {
    const b = e.target.closest('button[data-f]'); if (!b) return;
    st.f = b.dataset.f; $$('button', tabsEl).forEach(x => x.setAttribute('aria-pressed', String(x === b))); load(true);
  });
  $('.rva__sort', el).addEventListener('change', e => { st.sort = e.target.value; load(true); });
  $('.rva__search', el).addEventListener('submit', e => { e.preventDefault(); st.q = $('input', e.target).value.trim().slice(0, 20); load(true); });
  more.addEventListener('click', () => load(st.fresh));   // 처음 '더 보기'는 미리 그린 6개를 첫 10개로 바꿔 이어 간다
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-ph]'); if (!b) return;
    const srcs = (b.dataset.phs || b.dataset.ph).split(' ').filter(Boolean);
    UI.lightbox(srcs.map((src, i) => ({ src, alt: `구매평 사진 ${i + 1}`, cap: '구매평 사진' })), +b.dataset.k || 0);
  });
  // 서버가 있는지 한 번 확인(미리보기 사이트는 정적이라 /api 가 없다)
  fetch(`/api/reviews?pid=${encodeURIComponent(pid)}&n=1`, { headers: { Accept: 'application/json' } })
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(j => {
      el.classList.add('is-live'); more.hidden = j.total <= list.children.length;
      siteTab(j.site);
      openFromLink();
    })
    .catch(() => el.classList.add('is-static'));
  UI.fitReviews(list);

  // ───────── 구매평 쓰기
  const name = (document.querySelector('.pd-info__name, .pd-info h1, h1') || {}).textContent || '이 상품';
  let lay = null, ctx = { o: '', t: '', verified: false, src: '', who: '', opt: '' }, photos = [];
  const SRC = [['mall', '공식몰(jamschool.co.kr)'], ['smartstore', '네이버 스마트스토어'], ['etc', '그 밖의 판매처']];
  function layer() {
    if (lay) return lay;
    lay = document.createElement('div');
    lay.className = 'layer modal'; lay.id = 'rvw'; lay.setAttribute('role', 'dialog'); lay.setAttribute('aria-modal', 'true'); lay.setAttribute('aria-labelledby', 'rvw-t'); lay.setAttribute('aria-hidden', 'true'); lay.hidden = true;
    lay.innerHTML = `<div class="layer__dim"></div><div class="modal__box rvw"><div class="modal__head"><h2 id="rvw-t">구매평 쓰기</h2><button class="icon-btn" type="button" data-close aria-label="닫기">${UI.I.x}</button></div><div class="modal__body">
      <div class="rvw__step" data-step="who"><p class="rvw__q">어디서 구매하셨나요?</p>
        <div class="rvw__who"><button class="btn btn--line" type="button" data-who="site">이 홈페이지에서 구매</button><button class="btn btn--line" type="button" data-who="other">공식몰·스마트스토어 등에서 구매</button></div>
        <form class="rvw__f" data-form="site" hidden novalidate><p class="note">주문번호(JS로 시작)와 주문하신 분 또는 받는 분 휴대폰 번호로 구매를 확인합니다.</p>
          <label class="sr-only" for="rvw-no">주문번호</label><input id="rvw-no" type="text" placeholder="주문번호(JS로 시작)" autocapitalize="characters" autocomplete="off">
          <label class="sr-only" for="rvw-tel">휴대폰 번호</label><input id="rvw-tel" type="tel" inputmode="tel" placeholder="휴대폰 번호">
          <button class="btn btn--primary" type="submit">구매 확인</button></form>
        <form class="rvw__f" data-form="other" hidden novalidate><label for="rvw-src">구매한 곳</label><select id="rvw-src">${SRC.map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select>
          <label for="rvw-name">이름 또는 별명 <small>가려서 보입니다(예: 김*수)</small></label><input id="rvw-name" type="text" maxlength="10" autocomplete="name">
          <p class="note">다른 곳에서 산 구매평은 잠스쿨이 확인한 뒤 올라갑니다.</p><button class="btn btn--primary" type="submit">다음</button></form>
        <p class="rvw__msg" role="alert"></p></div>
      <form class="rvw__step" data-step="write" hidden novalidate>
        <p class="rvw__prod"></p>
        <div class="rvw__stars" role="radiogroup" aria-label="별점" data-v="5">${[1, 2, 3, 4, 5].map(n => `<label><input type="radio" name="rvw-s" value="${n}" ${n === 5 ? 'checked' : ''}><span aria-hidden="true">★</span><span class="sr-only">${n}점</span></label>`).join('')}</div>
        <label class="sr-only" for="rvw-text">구매평</label><textarea id="rvw-text" rows="6" maxlength="1000" placeholder="써 보니 어떠셨나요? 두께·쿠션감·배송·사이즈 등 다른 분께 도움이 되는 이야기를 10자 이상 남겨 주세요."></textarea>
        <p class="rvw__cnt"><span id="rvw-n">0</span> / 1000자</p>
        <div class="rvw__ph"><label class="btn btn--line btn--sm" for="rvw-file">사진 추가(최대 3장)</label><input id="rvw-file" type="file" accept="image/*" multiple hidden><div class="rvw__thumbs"></div></div>
        <p class="note">전화번호·주소 같은 개인정보는 쓰지 말아 주세요. 상품과 관계없는 글·광고는 숨길 수 있습니다.</p>
        <button class="btn btn--primary btn--block" type="submit">구매평 올리기</button>
        <p class="rvw__msg" role="alert"></p></form>
      <div class="rvw__step" data-step="done" hidden><p class="rvw__done"></p><button class="btn btn--primary btn--block" type="button" data-close>닫기</button></div>
    </div></div>`;
    document.body.appendChild(lay);
    const msg = s => { $$('.rvw__msg', lay).forEach(m => { m.textContent = s || ''; }); };
    $$('[data-who]', lay).forEach(b => b.addEventListener('click', () => {
      $$('[data-who]', lay).forEach(x => x.setAttribute('aria-pressed', String(x === b))); msg('');
      $('[data-form="site"]', lay).hidden = b.dataset.who !== 'site'; $('[data-form="other"]', lay).hidden = b.dataset.who !== 'other';
      (b.dataset.who === 'site' ? $('#rvw-no', lay) : $('#rvw-name', lay)).focus();
    }));
    $('[data-form="site"]', lay).addEventListener('submit', async e => {
      e.preventDefault(); msg('');
      const no = $('#rvw-no', lay).value.trim(), tel = $('#rvw-tel', lay).value.replace(/[^0-9]/g, '');
      if (!/^JS/i.test(no) || tel.length < 10) { msg('주문번호(JS로 시작)와 휴대폰 번호를 확인해 주세요.'); return; }
      await verify({ no, tel });
    });
    $('[data-form="other"]', lay).addEventListener('submit', e => {
      e.preventDefault(); const nm = $('#rvw-name', lay).value.trim();
      if (nm.length < 2) { msg('이름(별명)을 2자 이상 적어 주세요.'); return; }
      ctx = { o: '', t: '', verified: false, src: $('#rvw-src', lay).value, who: nm, opt: '' }; step('write');
    });
    const stars = $('.rvw__stars', lay); stars.addEventListener('change', e => { stars.dataset.v = e.target.value; });
    const ta = $('#rvw-text', lay); ta.addEventListener('input', () => { $('#rvw-n', lay).textContent = [...ta.value].length; });
    $('#rvw-file', lay).addEventListener('change', async e => {
      const files = [...e.target.files].slice(0, 3 - photos.length); e.target.value = '';
      for (const f of files) { try { photos.push(await shrink(f)); } catch (err) { msg('사진을 읽지 못했습니다. JPG·PNG 사진으로 다시 골라 주세요.'); } }
      drawThumbs();
    });
    $('.rvw__thumbs', lay).addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; photos.splice(+b.dataset.del, 1); drawThumbs(); });
    $('[data-step="write"]', lay).addEventListener('submit', submit);
    return lay;
  }
  const step = s => {
    $$('.rvw__step', lay).forEach(x => { x.hidden = x.dataset.step !== s; });
    if (s === 'write') {
      $('.rvw__prod', lay).innerHTML = `<b>${esc(name.trim())}</b>${ctx.opt ? `<br><small>${esc(ctx.opt)}</small>` : ''}${ctx.verified ? '<span class="rvw__ok">홈페이지 구매 확인됨</span>' : `<span class="rvw__ok rvw__ok--wait">${esc((SRC.find(x => x[0] === ctx.src) || [, ''])[1])} 구매 · 확인 뒤 게시</span>`}`;
      setTimeout(() => $('#rvw-text', lay).focus(), 50);
    }
  };
  async function verify(body) {
    try {
      const r = await fetch('/api/reviews/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { $$('.rvw__msg', lay).forEach(m => { m.textContent = j.error || '확인하지 못했습니다.'; }); return false; }
      const it = j.items.find(x => String(x.pid) === String(pid));
      const say = s => { $$('.rvw__msg', lay).forEach(m => { m.innerHTML = s; }); step('who'); };
      if (!it) { say(`이 주문에는 이 상품이 없습니다. 주문하신 상품: ${j.items.map(x => `<a href="product-${esc(x.pid)}.html?write=1&o=${encodeURIComponent(j.o)}&t=${encodeURIComponent(j.t)}#rva">${esc(x.name)}</a>`).join(', ')}`); return false; }
      if (it.done) { say('이 상품은 이미 구매평을 쓰셨습니다. 고맙습니다!'); return false; }
      if (!j.can) { say('상품을 보낸 뒤부터 구매평을 쓸 수 있습니다. 받아 보신 뒤 다시 와 주세요.'); return false; }
      ctx = { o: j.o, t: j.t, verified: true, src: 'site', who: '', opt: it.opt }; step('write'); return true;
    } catch (e) { $$('.rvw__msg', lay).forEach(m => { m.textContent = '확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'; }); return false; }
  }
  // 사진 줄이기: 긴 변 1280px JPEG(1.5MB 안으로)
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
      const sc = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * sc)); c.height = Math.max(1, Math.round(img.naturalHeight * sc));
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      let q = 0.82, d = c.toDataURL('image/jpeg', q);
      while (d.length > 1.9e6 && q > 0.4) { q -= 0.12; d = c.toDataURL('image/jpeg', q); }
      return d;
    } finally { URL.revokeObjectURL(url); }
  }
  function drawThumbs() {
    $('.rvw__thumbs', lay).innerHTML = photos.map((d, i) => `<span><img src="${d}" alt="올릴 사진 ${i + 1}"><button type="button" data-del="${i}" aria-label="사진 ${i + 1} 빼기">${UI.I.x}</button></span>`).join('');
    $('label[for="rvw-file"]', lay).hidden = photos.length >= 3;
  }
  async function submit(e) {
    e.preventDefault();
    const f = e.currentTarget, msg = $('.rvw__msg', f), text = $('#rvw-text', lay).value.trim(), stars = +((f.querySelector('[name="rvw-s"]:checked') || {}).value || 0);
    if ([...text].length < 10) { msg.textContent = '구매평을 10자 이상 써 주세요.'; return; }
    const btn = $('[type=submit]', f); btn.disabled = true; msg.textContent = '';
    try {
      const body = { pid, stars, text, photos, ...(ctx.verified ? { o: ctx.o, t: ctx.t } : { src: ctx.src, name: ctx.who }) };
      const r = await fetch('/api/reviews/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { msg.textContent = j.error || '올리지 못했습니다.'; btn.disabled = false; return; }
      $('.rvw__done', lay).innerHTML = j.status === 'shown' ? '<b>구매평이 올라갔습니다.</b><br>소중한 구매평 고맙습니다!' : '<b>구매평을 받았습니다.</b><br>잠스쿨이 확인한 뒤 올라갑니다. 고맙습니다!';
      step('done'); photos = []; drawThumbs(); $('#rvw-text', lay).value = ''; btn.disabled = false;
      if (j.status === 'shown') { st.bust = Date.now(); st.sort = 'new'; $('.rva__sort', el).value = 'new'; load(true); }
    } catch (err) { msg.textContent = '올리지 못했습니다. 잠시 뒤 다시 시도해 주세요.'; btn.disabled = false; }
  }
  function open(opener) { layer(); photos = []; drawThumbs(); $$('.rvw__msg', lay).forEach(m => { m.textContent = ''; }); $$('[data-who]', lay).forEach(x => x.setAttribute('aria-pressed', 'false')); $$('.rvw__f', lay).forEach(x => { x.hidden = true; }); step('who'); UI.openLayer(lay, opener); }
  $$('[data-write]', el).forEach(b => b.addEventListener('click', e => open(e.currentTarget)));
  // 주문 조회의 '구매평 쓰기' 링크(?write=1&o=…&t=…): 구매 확인을 건너뛰고 바로 쓰기
  async function openFromLink() {
    const q = new URLSearchParams(location.search);
    if (q.get('write') !== '1') return;
    open(null);
    if (q.get('o') && q.get('t')) { $('[data-form="site"]', lay).hidden = false; await verify({ o: q.get('o'), t: q.get('t') }); }
  }
})();
