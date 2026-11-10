/* 주문서: 주문 상품(바로 구매 또는 장바구니 선택분), 주문자·배송지(다음 우편번호), 결제 수단, 동의, 검증, 결제 요청
   결제: 서버(/api/pay/config)가 홈페이지 결제를 켜 두었으면(또는 ?pg=test 시험) 씨드페이먼츠·나이스페이 결제창으로 결제하고,
   꺼져 있으면 같은 상품의 스마트스토어로 보낸다. 금액·주문 저장·승인은 서버(tools/pay/nicepay.mjs)가 한다 */
(function () {
  const { $, $$, won, esc, toast, openLayer, closeLayer, cart, store } = UI;
  const { OPTIONS_29: O, CHECKOUT, CS } = JAM;
  const form = $('#co-form'); if (!form) return;
  const qs = new URLSearchParams(location.search);
  const buyNow = qs.get('buy') === 'now', pgTest = qs.get('pg') === 'test';
  let PG = null;   // 홈페이지 결제 설정(켜져 있을 때만)

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

  // ───────── 결제 수단: 처음엔 주문서에 그려진 목록, 홈페이지 결제가 켜지면 CHECKOUT.pgPay(서버가 준 목록)로 바꾼다
  let pay = CHECKOUT.pay[0].id, payList = CHECKOUT.pay, payBtns = [];
  function pickPay(b, focus) {
    payBtns.forEach(x => { const on = x === b; x.setAttribute('aria-checked', on); x.tabIndex = on ? 0 : -1; });
    pay = b.dataset.v; if (focus) b.focus();
    $('#paym-note').textContent = (payList.find(m => m.id === pay) || {}).note || '';
    f('bank-fld').hidden = pay !== 'bank' || !!PG;   // 입금자명은 무통장입금(결제 꺼짐)일 때만
    if (pay === 'bank' && !PG && !f('dep').value) f('dep').value = f('b-name').value;
    clearErr('pay');
  }
  function setupPay(list) {
    payList = list;
    const MARK = { npay: '<b class="npay-mark" aria-hidden="true">N</b>', kakaopay: '<b class="kpay-mark" aria-hidden="true">pay</b>' };
    if (list !== CHECKOUT.pay) $('#paym').innerHTML = list.map((m, i) => `<button class="paym__opt${m.id === 'npay' ? ' paym__opt--npay' : m.id === 'kakaopay' ? ' paym__opt--kakao' : ''}" type="button" role="radio" aria-checked="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-v="${esc(m.id)}">${MARK[m.id] || ''}${esc(m.label)}</button>`).join('');
    payBtns = $$('#paym [role="radio"]');
    payBtns.forEach((b, i) => {
      b.addEventListener('click', () => pickPay(b));
      b.addEventListener('keydown', e => {
        const d = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 0;
        if (d) { e.preventDefault(); pickPay(payBtns[(i + d + payBtns.length) % payBtns.length], true); }
      });
    });
    pickPay(payBtns[0]);
  }
  setupPay(CHECKOUT.pay);
  fetch('/api/pay/config', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(c => {
    if (!c || !c.ready || !(c.enabled || pgTest) || !c.methods || !c.methods.length) return;
    PG = c;
    $$('.co-pv').forEach(x => x.remove());   // '스마트스토어에서 결제' 안내
    setupPay(c.methods);
    // 간편결제 단독 호출은 나이스페이 결제창(약관 동의 화면)을 건너뛰므로 주문서에서 결제대행 약관 동의를 받는다
    const T = 'https://github.com/nicepayments/nicepay-manual/blob/main/api/terms/';
    $('#agree').insertAdjacentHTML('beforeend', `<div class="agree__item"><label class="ck"><input type="checkbox" class="ag" id="ag-pg"><span class="ck__box" aria-hidden="true"></span><span><em class="agree__req">필수</em>결제대행 서비스 약관(전자금융거래 이용약관, 개인정보 수집·이용, 개인정보 제3자 제공)에 동의합니다</span></label>
      <p class="agree__links" style="margin:4px 0 0 30px;font-size:13px">결제대행사 나이스페이먼츠 약관 원문: <a href="${T}electronicFinancialTransactions.md" target="_blank" rel="noopener">전자금융거래</a> · <a href="${T}collectPersonalInfo.md" target="_blank" rel="noopener">개인정보 수집·이용</a> · <a href="${T}sharingPersonalInformation.md" target="_blank" rel="noopener">제3자 제공</a></p></div>`);
    f('ag-all').checked = false;
    if (pgTest && !c.enabled) toast('시험 결제 모드입니다. 실제로 결제되니 확인 후 관리자 화면에서 취소해 주세요.');
  }).catch(() => { /* 설정을 못 읽으면 스마트스토어 결제 그대로 */ });

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
    if (pay === 'bank' && !PG) need('dep', '입금하실 분 이름을 입력해 주세요.');
    if (!ags().every(x => x.checked)) { setErr('ag', '필수 항목에 모두 동의해 주세요.'); errs.push('ag-all'); }
    return errs;
  }

  // ───────── 홈페이지 결제: 서버가 주문을 만들고(금액은 서버 계산) 결제창 값을 주면 나이스페이 결제창(goPay)을 연다.
  // 인증이 끝나면 결제창이 nicepaySubmit() 을 부르고, 폼이 /api/pay/return 으로 넘어가 서버가 승인한 뒤 주문 완료 화면으로 보낸다.
  // 휴대폰은 goPay() 가 결제 페이지로 넘어갔다가 ReturnURL(/api/pay/return)로 돌아온다.
  const payButtons = () => $$('.co-pay, #co-bar-pay');
  let pgjs = null;
  const loadPg = src => pgjs || (pgjs = new Promise((ok, no) => {
    if (typeof window.goPay === 'function') { ok(); return; }
    const s = document.createElement('script'); s.src = src; s.charset = 'euc-kr';
    s.onload = () => (typeof window.goPay === 'function' ? ok() : no(new Error('pg')));
    s.onerror = () => { pgjs = null; no(new Error('pg')); };
    document.head.appendChild(s);
  }));
  async function payPg() {
    payButtons().forEach(b => { b.disabled = true; });
    const memo = f('r-memo').value === 'direct' ? f('r-memo-x').value.trim() : f('r-memo').value;
    try {
      const res = await fetch('/api/pay/ready', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: pay, buyNow, items: items.map(x => ({ key: x.key, qty: x.qty })),
          buyer: { name: f('b-name').value.trim(), tel: f('b-tel').value, email: f('b-mail').value.trim() },
          receiver: { name: f('r-name').value.trim(), tel: f('r-tel').value, zip: f('r-zip').value, addr1: f('r-addr1').value.trim(), addr2: f('r-addr2').value.trim(), memo, jeju: !$('#co-jeju').hidden },
        }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok || !r.fields) throw new Error(r.error || '결제를 시작하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
      if (+r.fields.Amt !== total) { toast(`상품 가격이 바뀌어 결제 금액이 ${won(+r.fields.Amt)}입니다. 주문서를 새로 불러옵니다.`); setTimeout(() => location.reload(), 1800); return; }
      await loadPg(r.script).catch(() => { throw new Error('결제 창을 불러오지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.'); });
      document.getElementById('nice-pay-form')?.remove();
      const pf = document.createElement('form');
      pf.id = 'nice-pay-form'; pf.name = 'payForm'; pf.method = 'post'; pf.action = r.action; pf.acceptCharset = 'euc-kr';
      Object.entries(r.fields).forEach(([k, v]) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; pf.appendChild(i); });
      document.body.appendChild(pf);
      window.nicepaySubmit = () => { pf.submit(); };
      window.nicepayClose = () => { payButtons().forEach(b => { b.disabled = false; }); toast('결제 창을 닫았습니다. 결제하려면 다시 눌러 주세요.'); };
      store.sset('jam_pg_pending', JSON.stringify({ moid: r.moid, keys: items.map(x => x.key), buyNow }));
      beaconSubmit();
      window.goPay(pf);
    } catch (err) {
      payButtons().forEach(b => { b.disabled = false; });
      toast(err.message || '결제를 시작하지 못했습니다.');
    }
  }

  // 결제가 꺼져 있을 때: 결제를 누르면 스마트스토어로 보낸다. 상품이 하나면 그 상품 페이지로 바로, 여러 개면 상품별 버튼
  const storeOf = id => SHOP.P(id).store || CHECKOUT.storeHome;
  // 어드민 '주문' 집계용(이름·연락처·주소는 보내지 않는다)
  function beaconSubmit() {
    try { navigator.sendBeacon && navigator.sendBeacon('/api/t', new Blob([JSON.stringify({ e: 'checkout_submit', total, pay, items: items.map(x => ({ id: x.id, qty: x.qty })) })], { type: 'application/json' })); } catch (e) { /* 집계 실패는 무시 */ }
  }
  function toStore(opener) {
    beaconSubmit();
    const ids = [...new Set(items.map(x => x.id))];
    if (ids.length === 1) { toast('스마트스토어로 이동합니다. 같은 옵션을 골라 결제해 주세요.'); setTimeout(() => { location.href = storeOf(ids[0]); }, 700); return; }
    $('#pvm-list').innerHTML = ids.map(id => {
      const p = SHOP.P(id), it = items.filter(x => x.id === id);
      return `<li><span>${esc(p.short)}<small class="pvm__opt">${esc(it.map(x => `${x.opt || ''} ${x.qty}개`.trim()).join(' · '))}</small></span><span class="pvm__btns"><a class="btn btn--npay btn--sm" href="${esc(storeOf(id))}" target="_blank" rel="noopener">스마트스토어에서 결제</a></span></li>`;
    }).join('');
    openLayer('pvm', opener);
  }

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
    if (!PG) { toStore(opener); return; }
    await payPg();
  });
})();
