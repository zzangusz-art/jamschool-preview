/* 주문서: 주문 상품(바로 구매 또는 장바구니 선택분), 주문자·배송지(다음 우편번호), 결제 수단, 동의, 검증, 결제 요청
   결제 방식은 data.js 의 CHECKOUT.mode — 'preview'(지금)는 결제 대신 안내 창, 'pg' 는 requestPayment() 에 PG 결제창을 붙인다 */
(function () {
  const { $, $$, won, esc, toast, openLayer, closeLayer, cart, store } = UI;
  const { OPTIONS_29: O, CHECKOUT, CS } = JAM;
  const form = $('#co-form'); if (!form) return;
  const buyNow = new URLSearchParams(location.search).get('buy') === 'now';

  // ───────── 주문 상품: 금액은 저장된 값 대신 상품 데이터로 다시 계산한다
  function load() {
    let raw = [];
    if (buyNow) { try { raw = JSON.parse(store.sget(SHOP.BUY_K) || '[]'); } catch (e) { raw = []; } }
    else {
      let keys = null;
      try { const v = store.sget(SHOP.SEL_K); keys = v ? JSON.parse(v) : null; } catch (e) { keys = null; }
      raw = keys && keys.length ? cart.items.filter(x => keys.includes(x.key)) : cart.items;
    }
    return raw.map(x => {
      const p = SHOP.P(x.id); if (!p) return null;
      const qty = Math.max(1, Math.min(99, +x.qty || 1));
      if (p.full) {
        const [, t, s, c] = String(x.key).split('-');
        const price = O.price[`${t}-${s}`];
        if (!price || !O.color.some(k => k.id === c)) return null;
        return { ...SHOP.itemFor(p, { t, s, c }, qty), cat: p.cat };
      }
      return { ...SHOP.itemFor(p, null, qty), cat: p.cat };
    }).filter(Boolean);
  }
  const items = load();
  if (!items.length) { $('#co-empty').hidden = false; return; }
  form.hidden = false; $('#co-bar').hidden = false;
  document.body.classList.add('has-paybar');
  const sub = items.reduce((a, x) => a + x.qty * x.price, 0), total = sub + CHECKOUT.shipFee;
  const hasMat = items.some(x => x.cat === 'mattress');

  $('#co-n').textContent = `${items.length}건`;
  $('#co-items').innerHTML = items.map(x => `<li class="co-item"><span class="co-item__img">${RENDER.pic(x.img, 'alt="" width="72" height="72" loading="lazy"')}</span><div><p class="co-item__n">${esc(x.name)}</p>${x.opt ? `<p class="co-item__o">${esc(x.opt)}</p>` : ''}<p class="co-item__q">${x.qty}개 · <b>${won(x.qty * x.price)}</b></p></div></li>`).join('');
  $('#co-sub').textContent = won(sub);
  $('#co-ship').textContent = CHECKOUT.shipFee ? won(CHECKOUT.shipFee) : '무료';
  $('#co-total').textContent = won(total);
  $('#co-bar-total').textContent = won(total);
  $$('.co-pay, #co-bar-pay').forEach(b => { b.textContent = `${won(total)} 결제하기`; });
  if (hasMat) $$('.agree__item[data-mat]').forEach(el => { el.hidden = false; $('input', el).disabled = false; });

  // ───────── 입력 보조
  const f = id => document.getElementById(id);
  const digits = v => v.replace(/\D/g, '').slice(0, 11);
  const fmtTel = v => { const d = digits(v); return d.length < 4 ? d : d.length < 8 ? `${d.slice(0, 3)}-${d.slice(3)}` : d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`; };
  ['b-tel', 'r-tel'].forEach(id => f(id).addEventListener('input', e => { const el = e.target, end = el.selectionEnd === el.value.length; el.value = fmtTel(el.value); if (end) el.setSelectionRange(el.value.length, el.value.length); }));
  const same = f('same');
  const copy = () => { if (!same.checked) return; f('r-name').value = f('b-name').value; f('r-tel').value = f('b-tel').value; clearErr('r-name'); clearErr('r-tel'); };
  same.addEventListener('change', () => { copy(); f('r-name').readOnly = f('r-tel').readOnly = same.checked; });
  ['b-name', 'b-tel'].forEach(id => f(id).addEventListener('input', copy));
  f('r-memo').addEventListener('change', e => { const x = f('r-memo-x'); x.hidden = e.target.value !== 'direct'; if (!x.hidden) x.focus(); });

  // ───────── 결제 수단
  let pay = CHECKOUT.pay[0].id;
  const payBtns = $$('#paym [role="radio"]');
  function pickPay(b, focus) {
    payBtns.forEach(x => { const on = x === b; x.setAttribute('aria-checked', on); x.tabIndex = on ? 0 : -1; });
    pay = b.dataset.v; if (focus) b.focus();
    $('#paym-note').textContent = (CHECKOUT.pay.find(m => m.id === pay) || {}).note || '';
    f('bank-fld').hidden = pay !== 'bank';
    if (pay === 'bank' && !f('dep').value) f('dep').value = f('b-name').value;
    clearErr('pay');
  }
  payBtns.forEach((b, i) => {
    b.addEventListener('click', () => pickPay(b));
    b.addEventListener('keydown', e => {
      const d = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 0;
      if (d) { e.preventDefault(); pickPay(payBtns[(i + d + payBtns.length) % payBtns.length], true); }
    });
  });
  pickPay(payBtns[0]);

  // ───────── 동의
  const ags = () => $$('.ag').filter(x => !x.disabled);
  const all = f('ag-all');
  all.addEventListener('change', () => { ags().forEach(x => { x.checked = all.checked; }); clearErr('ag'); });
  $('#agree').addEventListener('change', () => { const a = ags(); all.checked = a.every(x => x.checked); all.indeterminate = !all.checked && a.some(x => x.checked); if (all.checked) clearErr('ag'); });
  $$('.agree__more').forEach(b => b.addEventListener('click', () => {
    const d = f(b.getAttribute('aria-controls')), on = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', on); d.hidden = !on; b.textContent = on ? '접기' : '내용 보기';
  }));

  // ───────── 주소 검색: 다음(카카오) 우편번호 서비스. 누를 때만 불러오고, 못 불러오면 직접 입력으로 바꾼다
  const POSTCODE = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
  let pcLoading = null;
  const loadPostcode = () => pcLoading || (pcLoading = new Promise((ok, no) => {
    if (window.daum && daum.Postcode) { ok(); return; }
    const s = document.createElement('script'); s.src = POSTCODE; s.async = true;
    s.onload = () => (window.daum && daum.Postcode ? ok() : no(new Error('postcode'))); s.onerror = () => no(new Error('postcode'));
    document.head.appendChild(s);
  }));
  function manualAddr() {
    pcLoading = null;
    f('r-zip').readOnly = f('r-addr1').readOnly = false;
    f('r-addr1').placeholder = '도로명 주소를 입력해 주세요';
    toast('주소 검색을 불러오지 못했습니다. 우편번호와 주소를 직접 입력해 주세요.');
    f('r-zip').focus();
  }
  function setAddr(zip, addr, sido) {
    f('r-zip').value = zip; f('r-addr1').value = addr; clearErr('r-addr');
    $('#co-jeju').hidden = !(sido === '제주특별자치도' || /^63/.test(zip));
    f('r-addr2').focus();
  }
  f('zip-btn').addEventListener('click', async e => {
    const opener = e.currentTarget;
    openLayer('zipm', opener);
    try {
      await loadPostcode();
      const box = $('#zipm-body'); box.innerHTML = '';
      new daum.Postcode({
        width: '100%', height: '100%',
        oncomplete(d) {
          let extra = '';
          if (d.userSelectedType === 'R') {
            if (d.bname && /[동로가]$/.test(d.bname)) extra += d.bname;
            if (d.buildingName && d.apartment === 'Y') extra += (extra ? ', ' : '') + d.buildingName;
          }
          const base = d.userSelectedType === 'R' ? d.roadAddress : d.jibunAddress;
          closeLayer($('#zipm'));
          setTimeout(() => setAddr(d.zonecode, base + (extra ? ` (${extra})` : ''), d.sido), 60);
        },
      }).embed(box);
    } catch (err) { closeLayer($('#zipm')); setTimeout(manualAddr, 60); }
  });
  f('r-zip').addEventListener('input', e => { if (!e.target.readOnly) { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5); $('#co-jeju').hidden = !/^63/.test(e.target.value); } });

  // ───────── 검증
  function setErr(id, msg) {
    const e = f(`${id}-e`); if (e) e.textContent = msg;
    const inputs = id === 'r-addr' ? ['r-zip', 'r-addr1', 'r-addr2'] : id === 'pay' || id === 'ag' ? [] : [id];
    inputs.forEach(i => { f(i).setAttribute('aria-invalid', 'true'); f(i).setAttribute('aria-describedby', `${id}-e`); });
  }
  function clearErr(id) {
    const e = f(`${id}-e`); if (e) e.textContent = '';
    (id === 'r-addr' ? ['r-zip', 'r-addr1', 'r-addr2'] : [id]).forEach(i => { const el = f(i); if (el && el.tagName !== 'P') el.removeAttribute('aria-invalid'); });
  }
  form.addEventListener('input', e => { const id = e.target.id; if (!id) return; clearErr(/^r-(zip|addr)/.test(id) ? 'r-addr' : id); });
  function validate() {
    const errs = [];
    const need = (id, msg, ok) => { const v = f(id).value.trim(); if (!v || (ok && !ok(v))) { setErr(id, msg); errs.push(id); } };
    need('b-name', '주문하는 분 이름을 입력해 주세요.', v => v.length >= 2);
    need('b-tel', '휴대폰 번호를 정확히 입력해 주세요. 예: 010-1234-5678', v => /^01[016789]\d{7,8}$/.test(digits(v)));
    const m = f('b-mail').value.trim();
    if (m && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m)) { setErr('b-mail', '이메일 주소 형식을 확인해 주세요.'); errs.push('b-mail'); }
    need('r-name', '받는 분 이름을 입력해 주세요.', v => v.length >= 2);
    need('r-tel', '받는 분 휴대폰 번호를 정확히 입력해 주세요.', v => /^01[016789]\d{7,8}$/.test(digits(v)));
    if (!/^\d{5}$/.test(f('r-zip').value) || !f('r-addr1').value.trim()) { setErr('r-addr', '주소 검색으로 배송지 주소를 골라 주세요.'); errs.push('r-zip'); }
    else if (!f('r-addr2').value.trim()) { setErr('r-addr', '상세 주소(동·호수 등)를 입력해 주세요.'); errs.push('r-addr2'); }
    if (pay === 'bank') need('dep', '입금하실 분 이름을 입력해 주세요.');
    if (!ags().every(x => x.checked)) { setErr('ag', '필수 항목에 모두 동의해 주세요.'); errs.push('ag-all'); }
    return errs;
  }

  // ───────── 결제
  // PG 연동 자리: 계약한 결제대행사 SDK 의 결제창 호출을 여기에 넣는다.
  // 결제 승인은 반드시 서버에서 비밀 키로 처리하고, 금액도 서버가 상품 데이터로 다시 계산해야 한다(브라우저 금액을 믿지 않는다).
  async function requestPayment(order) { throw new Error('PG 미연동: assets/js/checkout.js requestPayment()'); }

  const PAY_LABEL = id => (CHECKOUT.pay.find(m => m.id === id) || {}).label || id;
  const mask = s => s.length <= 1 ? s : s.length === 2 ? s[0] + '*' : s[0] + '*'.repeat(s.length - 2) + s[s.length - 1];
  const maskTel = t => { const d = digits(t); return `${d.slice(0, 3)}-****-${d.slice(-4)}`; };
  function orderNo() {
    const d = new Date(), z = n => String(n).padStart(2, '0');
    return `${CHECKOUT.mode === 'pg' ? 'JS' : 'PV'}${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  }
  function summary() {
    const memo = f('r-memo').value === 'direct' ? f('r-memo-x').value.trim() : f('r-memo').value;
    return {
      no: orderNo(), mode: CHECKOUT.mode, pay: pay, payLabel: PAY_LABEL(pay), total, sub, ship: CHECKOUT.shipFee,
      items: items.map(({ id, name, opt, qty, price, img, cat }) => ({ id, name, opt, qty, price, img, cat })),
      name: mask(f('r-name').value.trim()), tel: maskTel(f('r-tel').value), addr: `(${f('r-zip').value}) ${f('r-addr1').value.trim()} · 상세 주소 생략`,
      memo, jeju: !$('#co-jeju').hidden, at: Date.now(),
    };
  }
  function previewModal(opener) {
    const seen = new Set(), rows = [];
    items.forEach(x => {
      if (seen.has(x.id)) return; seen.add(x.id);
      const p = SHOP.P(x.id);
      rows.push(`<li><span>${esc(p.short)}</span><span class="pvm__btns"><a class="btn btn--line btn--sm" href="${esc(p.mall)}">공식몰</a>${p.store ? `<a class="btn btn--npay btn--sm" href="${esc(p.store)}" target="_blank" rel="noopener">네이버페이</a>` : ''}</span></li>`);
    });
    $('#pvm-list').innerHTML = rows.join('');
    openLayer('pvm', opener);
  }
  $('#pvm-done').addEventListener('click', () => {
    store.sset('jam_order_done', JSON.stringify(summary()));
    location.href = 'order-complete.html';
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    $$('.fld__err').forEach(x => { x.textContent = ''; }); $$('[aria-invalid]', form).forEach(x => x.removeAttribute('aria-invalid'));
    const errs = validate();
    if (errs.length) {
      const first = errs[0] === 'r-zip' && f('r-zip').readOnly ? f('zip-btn') : f(errs[0]);
      first.scrollIntoView({ block: 'center', behavior: UI.reduce ? 'auto' : 'smooth' });
      setTimeout(() => first.focus({ preventScroll: true }), UI.reduce ? 0 : 300);
      toast(errs.length > 1 ? `입력이 필요한 항목이 ${errs.length}곳 있습니다.` : '입력 내용을 확인해 주세요.');
      return;
    }
    const opener = e.submitter || $('#co-pay');
    if (CHECKOUT.mode !== 'pg') { previewModal(opener); return; }
    try {
      const btns = $$('.co-pay, #co-bar-pay'); btns.forEach(b => { b.disabled = true; });
      const s = summary();
      await requestPayment(s);
      // 결제가 끝난 상품만 장바구니에서 뺀다(바로 구매는 장바구니를 건드리지 않음)
      if (!buyNow) { cart.items = cart.items.filter(x => !items.some(i => i.key === x.key)); cart.save(); }
      store.sset('jam_order_done', JSON.stringify(s));
      location.href = 'order-complete.html';
    } catch (err) {
      $$('.co-pay, #co-bar-pay').forEach(b => { b.disabled = false; });
      toast('결제를 시작하지 못했습니다. 잠시 뒤 다시 시도하거나 고객센터로 문의해 주세요.');
      console.warn(err);
    }
  });
})();
