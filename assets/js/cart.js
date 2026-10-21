/* 장바구니 페이지: 선택·수량·삭제(되돌리기)·3단 옵션 변경, 결제 예정 금액, 선택 상품 주문, 함께 쓰면 좋은 상품, 최근 본 상품 */
(function () {
  const { $, $$, won, esc, toast, openLayer, closeLayer, cart, readyThumbs, I } = UI;
  const { OPTIONS_29: O, CHECKOUT } = JAM;
  const list = $('#cp-items'); if (!list) return;
  const unchecked = new Set();            // 기본은 모두 선택. 해제한 key 만 기억
  const sel = () => cart.items.filter(x => !unchecked.has(x.key));
  // 예전에 담긴 3단 항목은 st 가 없어 key(29-두께-사이즈-색상)에서 읽는다
  const stOf = x => x.st || (x.id === 29 && /^29-/.test(x.key) ? (([, t, s, c]) => ({ t, s, c }))(x.key.split('-')) : null);

  function render() {
    const items = cart.items;
    $('#cp-n').textContent = items.length ? `(${items.length})` : '';
    $('#cp-empty').hidden = items.length > 0;
    $('.cp-tools').hidden = !items.length;
    $('#cp-grid').classList.toggle('is-empty', !items.length);
    list.innerHTML = items.map(x => {
      const on = !unchecked.has(x.key), p = SHOP.P(x.id), href = p ? RENDER.href(p) : '#';
      return `<li class="cp-item${on ? '' : ' is-off'}" data-key="${esc(x.key)}">
        <label class="ck ck--only"><input type="checkbox" class="cp-ck" ${on ? 'checked' : ''} aria-label="${esc(p ? p.short : x.name)} 선택"><span class="ck__box" aria-hidden="true"></span></label>
        <a class="cp-item__img" href="${href}" tabindex="-1" aria-hidden="true">${RENDER.pic(x.img, 'alt="" width="96" height="96" loading="lazy"')}</a>
        <div class="cp-item__info">
          <a class="cp-item__name" href="${href}">${esc(x.name)}</a>
          ${x.opt ? `<p class="cp-item__opt">${esc(x.opt)}</p>` : ''}
          ${stOf(x) ? '<button class="link-btn cp-item__chg" type="button" data-chg>옵션 변경</button>' : ''}
          <div class="cp-item__row">
            <div class="qty" aria-label="수량"><button type="button" data-q="-1" aria-label="수량 줄이기" ${x.qty <= 1 ? 'disabled' : ''}>${I.minus}</button><span aria-live="polite">${x.qty}</span><button type="button" data-q="1" aria-label="수량 늘리기">${I.plus}</button></div>
            <b class="cp-item__price">${won(x.qty * x.price)}</b>
          </div>
        </div>
        <button class="icon-btn cp-item__del" type="button" data-del aria-label="${esc(p ? p.short : x.name)} 삭제">${I.x}</button>
      </li>`;
    }).join('');
    const s = sel(), sub = s.reduce((a, x) => a + x.qty * x.price, 0), n = s.reduce((a, x) => a + x.qty, 0);
    const total = sub + CHECKOUT.shipFee;
    $('#cp-seln').textContent = s.length; $('#cp-totn').textContent = items.length;
    $('#cp-all').checked = items.length > 0 && s.length === items.length;
    $('#cp-all').indeterminate = s.length > 0 && s.length < items.length;
    $('#cp-sub').textContent = won(sub);
    $('#cp-ship').textContent = CHECKOUT.shipFee ? won(CHECKOUT.shipFee) : '무료';
    $('#cp-total').textContent = won(s.length ? total : 0);
    $('#cp-pt').textContent = Math.floor(sub * CHECKOUT.pointRate).toLocaleString('ko-KR') + 'P';
    const label = s.length ? `${s.length === items.length ? '' : '선택 상품 '}주문하기` : '주문할 상품을 골라 주세요';
    $('#cp-order').disabled = !s.length; $('#cp-order').textContent = label;
    $('#cp-bar').hidden = !items.length;
    $('#cp-bar-n').textContent = n; $('#cp-bar-total').textContent = won(s.length ? total : 0);
    $('#cp-bar-order').disabled = !s.length;
    // 함께 쓰면 좋은 상품: 이미 담은 상품은 빼고 4개
    let k = 0;
    $$('#cp-reco .pcard').forEach(c => { const inCart = cart.items.some(x => x.id === +c.dataset.id); c.hidden = inCart || k >= 4; if (!c.hidden) k++; });
    $('#cp-reco').closest('.cp-more').hidden = k === 0;
  }
  // 드로어·빠른 보기에서 장바구니가 바뀌어도 이 페이지를 다시 그린다
  const save = cart.save.bind(cart);
  cart.save = () => { save(); render(); };

  list.addEventListener('change', e => {
    const ck = e.target.closest('.cp-ck'); if (!ck) return;
    const key = ck.closest('.cp-item').dataset.key;
    if (ck.checked) unchecked.delete(key); else unchecked.add(key);
    render();
    $(`.cp-item[data-key="${CSS.escape(key)}"] .cp-ck`)?.focus();
  });
  $('#cp-all').addEventListener('change', e => {
    if (e.target.checked) unchecked.clear(); else cart.items.forEach(x => unchecked.add(x.key));
    render();
  });
  function removeWithUndo(keys, msg) {
    const snap = cart.items.map(x => ({ ...x }));
    cart.items = cart.items.filter(x => !keys.includes(x.key));
    keys.forEach(k => unchecked.delete(k));
    cart.save();
    toast(msg, { action: '되돌리기', ms: 5000, onAction: () => { cart.items = snap; cart.save(); } });
  }
  list.addEventListener('click', e => {
    const row = e.target.closest('.cp-item'); if (!row) return;
    const key = row.dataset.key, it = cart.items.find(x => x.key === key); if (!it) return;
    const q = e.target.closest('[data-q]');
    if (q) { cart.setQty(key, it.qty + +q.dataset.q); $(`.cp-item[data-key="${CSS.escape(key)}"] [data-q="${q.dataset.q}"]`)?.focus(); return; }
    if (e.target.closest('[data-del]')) { removeWithUndo([key], '장바구니에서 삭제했습니다.'); return; }
    if (e.target.closest('[data-chg]')) openChange(it, e.target.closest('[data-chg]'));
  });
  $('#cp-del-sel').addEventListener('click', () => {
    const keys = sel().map(x => x.key);
    if (!keys.length) { toast('삭제할 상품을 골라 주세요.'); return; }
    removeWithUndo(keys, `${keys.length}개 상품을 삭제했습니다.`);
  });

  // 3단 옵션 변경 시트
  let editing = null;
  const est = { t: '12', s: 'SS', c: 'gray' };
  function openChange(it, opener) {
    editing = it.key; Object.assign(est, stOf(it));
    const body = $('#optm-body');
    body.innerHTML = `<div class="field"><p class="field__label">두께</p><div class="seg" role="radiogroup" data-k="t" aria-label="두께">${SHOP.optButtons('t', O.thickness, est.t)}</div></div>
      <div class="field"><p class="field__label">사이즈</p><div class="sizes" role="radiogroup" data-k="s" aria-label="사이즈">${SHOP.optButtons('s', O.size, est.s)}</div></div>
      <div class="field"><p class="field__label">색상</p><div class="colors" role="radiogroup" data-k="c" aria-label="색상">${SHOP.optButtons('c', O.color, est.c)}</div></div>`;
    const sync = () => { $('#optm-price').textContent = won(O.price[`${est.t}-${est.s}`] * it.qty); };
    SHOP.bindRadios(body, (k, v) => { est[k] = v; sync(); });
    sync();
    openLayer('optm', opener);
  }
  $('#optm-ok').addEventListener('click', () => {
    const i = cart.items.findIndex(x => x.key === editing); if (i < 0) return;
    const old = cart.items[i], next = SHOP.itemFor(SHOP.P(29), est, old.qty);
    if (next.key !== old.key) {
      const dup = cart.items.find(x => x.key === next.key);
      if (dup) { dup.qty = Math.min(99, dup.qty + old.qty); cart.items.splice(i, 1); }
      else cart.items.splice(i, 1, next);
      if (unchecked.delete(old.key) && !dup) unchecked.add(next.key);   // 선택 해제 상태는 그대로
    }
    closeLayer($('#optm'));
    cart.save();
    toast(next.key === old.key ? '같은 옵션이라 그대로 두었습니다.' : '옵션을 바꿨습니다.');
  });

  // 주문
  const order = e => { const keys = sel().map(x => x.key); if (keys.length) SHOP.checkoutCart(keys.length === cart.items.length ? null : keys, e.currentTarget); };
  $('#cp-order').addEventListener('click', order);
  $('#cp-bar-order').addEventListener('click', order);
  // 모바일 하단 주문 바와 겹치지 않게
  document.body.classList.add('has-paybar');

  readyThumbs($('#cp-reco'));
  const rec = SHOP.recent.ids();
  if (rec.length) { $('#cp-recent').innerHTML = rec.map(id => SHOP.miniCard(SHOP.P(id))).join(''); $('#cp-recent-sec').hidden = false; }
  render();
})();
