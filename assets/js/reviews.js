/* 상품 페이지 '구매평 모아 보기' — 이야기(주제)·종류·정렬·찾기·더 보기. 서버 /api/reviews(tools/reviews/api.mjs)
   빌드가 추천순 6개를 미리 그려 둔다. 서버가 없는 미리보기 사이트에서는 그 6개만 보이고 거르기·더 보기는 숨긴다 */
(function () {
  const el = document.getElementById('rva');
  if (!el || !window.fetch || !window.UI || !window.RENDER) return;
  const { $, $$ } = UI, pid = el.dataset.pid, list = $('.rva__list', el), more = $('.rva__more', el), info = $('.rva__info', el);
  let TOP = {}; try { TOP = Object.fromEntries(JSON.parse(el.dataset.topics || '[]')); } catch (e) { TOP = {}; }
  const st = { f: 'all', k: '', sort: 'rec', q: '', page: 0, pages: 1, fresh: true };
  let seq = 0;
  const hl = () => { try { return st.k && TOP[st.k] ? new RegExp(TOP[st.k], 'g') : null; } catch (e) { return null; } };
  async function load(reset) {
    const my = ++seq;
    if (reset) { st.page = 0; st.fresh = false; }
    const p = new URLSearchParams({ pid, f: st.f, sort: st.sort, page: String(st.page + 1), n: '10' });
    if (st.k) p.set('k', st.k); if (st.q) p.set('q', st.q);
    more.disabled = true; el.classList.add('is-busy');
    try {
      const r = await fetch('/api/reviews?' + p.toString(), { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json(); if (my !== seq) return;
      const h = hl(), html = j.items.map((x, i) => RENDER.rvCard(x, `rva-${my}-${j.page}-${i}`, h)).join('');
      if (reset) list.innerHTML = html || '<p class="rva__empty">조건에 맞는 구매평이 없습니다.</p>'; else list.insertAdjacentHTML('beforeend', html);
      st.page = j.page; st.pages = j.pages;
      const lab = [st.k && $(`.rva__topics [data-k="${st.k}"]`, el) ? $(`.rva__topics [data-k="${st.k}"]`, el).firstChild.textContent.trim() : '', st.q ? `'${st.q}'` : ''].filter(Boolean).join(' · ');
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
  pick('.rva__tabs button', 'f', 'f');
  $('.rva__sort', el).addEventListener('change', e => { st.sort = e.target.value; load(true); });
  $('.rva__search', el).addEventListener('submit', e => { e.preventDefault(); st.q = $('input', e.target).value.trim().slice(0, 20); load(true); });
  more.addEventListener('click', () => load(st.fresh));   // 처음 '더 보기'는 미리 그린 6개를 첫 10개로 바꿔 이어 간다
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-ph]'); if (!b) return;
    UI.lightbox([{ src: b.dataset.ph, alt: '구매평 사진', cap: '네이버 스마트스토어 포토 구매평' }], 0);
  });
  // 서버가 있는지 한 번 확인(미리보기 사이트는 정적이라 /api 가 없다)
  fetch(`/api/reviews?pid=${encodeURIComponent(pid)}&n=1`, { headers: { Accept: 'application/json' } })
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(j => { el.classList.add('is-live'); more.hidden = j.total <= list.children.length; })
    .catch(() => el.classList.add('is-static'));
  UI.fitReviews(list);
})();
