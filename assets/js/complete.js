/* 주문 완료
   - 홈페이지 결제(?o=주문번호&t=조회키): 서버(/api/pay/order)에서 가린 요약을 받아 보여 준다. 결제가 안 됐으면 이유와 '다시 결제하기'
   - 결제가 끝난 상품만 장바구니에서 뺀다(바로 구매는 장바구니를 건드리지 않음)
   - 예전 미리보기 요약(sessionStorage jam_order_done)은 상단에 '실제 주문 아님'을 표시해 그대로 보여 준다 */
(function () {
  const { $, won, esc, store, cart } = UI;
  const { CHECKOUT } = JAM;
  const q = new URLSearchParams(location.search);

  function render(o) {
    const pv = o.mode !== 'pg';
    $('#done-pv').hidden = !pv;
    $('#done-body').hidden = false;
    $('#done-t').textContent = pv ? '주문 완료 화면 미리보기' : '주문이 접수되었습니다';
    if (pv) document.title = '주문 완료(미리보기) | 잠스쿨';
    $('#done-no').textContent = o.no;
    $('#done-pay').textContent = o.payLabel;
    $('#done-total').textContent = won(o.total);
    if (o.points) { $('#done-pt-w').hidden = false; $('#done-pt').textContent = `-${won(o.points)} (주문 금액 ${won(o.orderTotal)})`; }
    $('#done-bank').hidden = !pv || o.pay !== 'bank';
    $('#done-name').textContent = o.name;
    $('#done-tel').textContent = o.tel;
    $('#done-addr').textContent = o.addr;
    if (o.memo) { $('#done-memo').textContent = o.memo; $('#done-memo-w').hidden = false; }
    $('#done-items').innerHTML = o.items.map(x => `<li class="co-item"><span class="co-item__img">${RENDER.pic(x.img, 'alt="" width="72" height="72" loading="lazy"')}</span><div><p class="co-item__n">${esc(x.name)}</p>${x.opt ? `<p class="co-item__o">${esc(x.opt)}</p>` : ''}<p class="co-item__q">${x.qty}개 · <b>${won(x.qty * x.price)}</b></p></div></li>`).join('');

    const mat = o.items.some(x => x.cat === 'mattress'), has29 = o.items.some(x => x.id === 29);
    const flow = [
      ['결제 확인', o.pay === 'bank' && pv ? '입금이 확인되면 출고 준비를 시작합니다.' : '결제가 확인되면 출고 준비를 시작합니다.'],
      ['출고', '오후 1시 이전에 결제(입금)가 확인되면 당일 출고합니다. 주말·공휴일은 쉽니다.'],
      ['배송', `평균 1~3일 걸립니다. ${CHECKOUT.couriers}로 보냅니다.${o.jeju ? ' ' + CHECKOUT.shipNote : ''}`],
    ];
    if (mat) flow.push(['받은 뒤', '압축 포장을 풀면 원래 크기로 돌아오기까지 2일 정도 걸립니다. 포장을 열기 전에 사이즈를 먼저 확인해 주세요.']);
    if (has29) flow.push(['14일 무료체험', '3단 접이식 매트리스는 받은 날부터 14일 동안 써 보고 결정할 수 있습니다(기간 한정, 반품 시 왕복 배송비 고객 부담).']);
    $('#done-flow').innerHTML = flow.map(([t, d], i) => `<li><span class="done-flow__n">${i + 1}</span><div><b>${esc(t)}</b><p>${esc(d)}</p></div></li>`).join('');
  }
  // 배송 현황(결제 완료 주문): 결제 완료 → 상품 준비 중 → 배송 중 → 배송 완료, 택배 조회, 취소·반품·교환·환불
  const md = iso => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const link = (u, t) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t);
  function track(o) {
    const s = o.ship; if (!s || !s.steps || !s.steps.length) return;
    $('#done-track').hidden = false;
    $('#done-stage').textContent = s.stage;
    const T = { prep: '상품을 준비하고 있습니다', shipped: '배송 중입니다', delivered: '배송이 완료되었습니다', returned: '반품이 완료되었습니다', claim: /요청$/.test(s.stage) ? `${s.stage}을 접수했습니다` : s.stage };
    if (T[s.stageKey]) $('#done-t').textContent = T[s.stageKey];
    $('#done-steps').innerHTML = s.steps.map((x, i) => `<li class="${x.done ? 'on' : ''}"><b>${i + 1}</b><span>${esc(x.label)}</span><small>${x.at ? esc(md(x.at)) : ''}</small></li>`).join('');
    if (s.invoice) { const el = $('#done-inv'); el.hidden = false; el.innerHTML = `${esc(s.courier)} 송장번호 <b>${esc(s.invoice)}</b> · ${link(s.track, '배송 조회')}`; }
    const c = s.claim, bits = [];
    if (c) {
      bits.push(`<b>${esc(c.label)}</b>`);
      if (c.pickup) bits.push(`회수 ${esc(c.pickup.courier)} ${esc(c.pickup.invoice)} · ${link(c.pickup.track, '조회')}`);
      if (c.resend) bits.push(`재발송 ${esc(c.resend.courier)} ${esc(c.resend.invoice)} · ${link(c.resend.track, '조회')}`);
    }
    if (s.refunded) bits.push(`환불 ${won(s.refunded)}`);
    if (bits.length) { const el = $('#done-claim'); el.hidden = false; el.innerHTML = bits.join('<br>'); }
    if (s.due) { const el = $('#done-due'); el.hidden = false; el.innerHTML = `<b>${esc(s.due)}</b> · 오후 1시 이전 결제는 당일 출고합니다(주말·공휴일 제외).`; }
    request(o, s);
    // 보낸 뒤부터(반품·교환 요청 중이어도): 상품마다 '구매평 쓰기'(상품 페이지에서 구매 확인 없이 바로 쓰기 창이 열린다)
    if (o.canReview && q.get('o') && q.get('t')) {
      UI.$$('#done-items .co-item').forEach((li, i) => { const x = o.items[i]; if (!x || !x.id) return; li.lastElementChild.insertAdjacentHTML('beforeend', `<a class="btn btn--line btn--sm co-item__rv" href="product-${encodeURIComponent(x.id)}.html?write=1&o=${encodeURIComponent(q.get('o'))}&t=${encodeURIComponent(q.get('t'))}#rva">구매평 쓰기</a>`); });
    }
  }
  // 손님 요청: 발송 전 = 주문 취소 요청, 받은 뒤 7일 안 = 반품·교환 요청. 보낸 뒤에는 화면을 다시 불러 진행 상황을 보여 준다
  const REQ = {
    cancel: { btn: '주문 취소 요청', t: '어떤 이유로 취소하시나요?', note: '발송 전 주문은 확인 뒤 결제를 전액 취소해 드립니다(카드사에 따라 3~7영업일).' },
    return: { btn: '반품 요청', t: '어떤 이유로 반품하시나요?', note: '회수 택배가 방문합니다. 단순 변심은 왕복 배송비(매트리스 36,000원 · 그 밖의 상품 6,000원)를 빼고 환불하고, 상품 불량·오배송은 배송비를 받지 않습니다.' },
    exchange: { btn: '교환 요청', t: '어떤 이유로 교환하시나요?', note: '회수 뒤 새 상품을 보내 드립니다. 단순 교환의 왕복 배송비는 고객 부담입니다. 바꿀 옵션을 자세한 내용에 적어 주세요.' },
  };
  function request(o, s) {
    const can = s.can || {}, types = [...(can.cancel ? ['cancel'] : []), ...(can.ret ? ['return', 'exchange'] : [])];
    if (!types.length || !s.reasons) return;
    $('#done-req').hidden = false;
    $('#done-req-btns').innerHTML = types.map(t => `<button class="btn btn--line btn--sm" type="button" data-req="${t}">${REQ[t].btn}</button>`).join('');
    const form = $('#done-req-form');
    let type = '';
    $('#done-req-btns').addEventListener('click', e => {
      const b = e.target.closest('[data-req]'); if (!b) return;
      type = b.dataset.req; form.hidden = false; $('#done-req-msg').textContent = '';
      $('#done-req-t').textContent = REQ[type].t; $('#done-req-note').textContent = REQ[type].note;
      $('#done-req-reasons').innerHTML = (s.reasons[type] || []).map((r, i) => `<label class="done-req__r"><input type="radio" name="req-r" value="${esc(r)}" ${i ? '' : 'checked'}> ${esc(r)}</label>`).join('');
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    $('#done-req-x').addEventListener('click', () => { form.hidden = true; });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('#done-req-msg'), r = (form.querySelector('[name="req-r"]:checked') || {}).value, detail = $('#done-req-detail').value.trim();
      if (!r) { msg.textContent = '사유를 골라 주세요.'; return; }
      if (r === '기타' && !detail) { msg.textContent = '자세한 내용을 적어 주세요.'; return; }
      const btn = form.querySelector('[type=submit]'); btn.disabled = true; msg.textContent = '';
      try {
        const res = await fetch('/api/pay/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ o: q.get('o'), t: q.get('t'), type, reason: r, detail }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { msg.textContent = j.error || '요청을 보내지 못했습니다.'; btn.disabled = false; return; }
        UI.toast(`${REQ[type].btn.replace(' 요청', '')} 요청을 보냈습니다. 확인 뒤 연락드립니다.`, { icon: UI.I.check });
        setTimeout(() => location.reload(), 900);
      } catch (err) { msg.textContent = '요청을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.'; btn.disabled = false; }
    });
  }
  function failView(msg, retry) {
    $('#done-wait').hidden = true;
    $('#done-fail').hidden = false;
    $('#done-fail-msg').textContent = msg;
    $('#done-retry').href = retry;
    document.title = '결제가 완료되지 않았습니다 | 잠스쿨';
  }

  // ───────── 홈페이지 결제 결과
  if (q.get('o') && q.get('t')) {
    let pend = null;
    try { pend = JSON.parse(store.sget('jam_pg_pending') || 'null'); } catch (e) { pend = null; }
    const retry = pend && pend.buyNow ? 'checkout.html?buy=now' : 'checkout.html';
    const url = `/api/pay/order?o=${encodeURIComponent(q.get('o'))}&t=${encodeURIComponent(q.get('t'))}`;
    $('#done-wait').hidden = false;
    let tries = 0;
    (async function load() {
      let o = null;
      try { const r = await fetch(url, { cache: 'no-store' }); o = r.ok ? await r.json() : null; } catch (e) { o = null; }
      if (!o) {
        if (tries++ < 2) { setTimeout(load, 1500); return; }
        failView('주문 정보를 불러오지 못했습니다. 카드 승인 문자를 받으셨다면 고객센터로 알려 주세요.', retry); return;
      }
      if (o.status === 'approving' && tries++ < 15) { setTimeout(load, 2000); return; }
      if (o.status === 'paid') {
        $('#done-wait').hidden = true;
        if (pend && pend.moid === o.no) {
          if (!pend.buyNow) { cart.items = cart.items.filter(x => !(pend.keys || []).includes(x.key)); cart.save(); }
          try { sessionStorage.removeItem('jam_pg_pending'); } catch (e) { /* 무시 */ }
        }
        render(o); track(o);
        // 광고 매체 구매 전환(주문번호당 한 번, 주문 조회로 다시 열면 보내지 않음)
        if (!q.get('v') && window.jamAd && !store.get('jam_ad_' + o.no, null)) { store.set('jam_ad_' + o.no, 1); try { window.jamAd('purchase', { value: o.total, order: o.no }); } catch (e) { /* 무시 */ } }
        return;
      }
      if (o.status === 'cancelled') { failView(`${o.ship && o.ship.stage ? o.ship.stage : '취소된 주문입니다'}(주문번호 ${o.no})${o.ship && o.ship.refunded ? ` · 환불 ${won(o.ship.refunded)}` : ''}. 카드 취소는 카드사에 따라 3~7영업일 걸릴 수 있습니다.`, 'shop.html'); return; }
      if (o.status === 'check' || o.status === 'approving') { failView(`결제 결과를 확인하고 있습니다. 카드 승인 문자를 받으셨다면 고객센터로 주문번호 ${o.no}를 알려 주세요.`, retry); return; }
      failView(o.fail || '결제가 완료되지 않았습니다.', retry);
    })();
    return;
  }
  if (q.get('e')) {
    failView(q.get('e') === 'save' ? '결제 처리 중 문제가 생겨 결제를 취소했습니다. 다시 시도해 주세요.' : '주문 정보를 확인하지 못했습니다. 카드 승인 문자를 받으셨다면 고객센터로 알려 주세요.', 'checkout.html');
    return;
  }

  // ───────── 주문·배송 조회(주문번호 + 휴대폰): 맞으면 이 화면을 조회 주소로 다시 연다
  const lf = $('#lookup');
  if (lf) lf.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#lk-msg'), no = $('#lk-no').value.trim(), tel = $('#lk-tel').value.replace(/[^0-9]/g, '');
    msg.textContent = '';
    if (!/^JS/i.test(no) || tel.length < 10) { msg.textContent = '주문번호(JS로 시작)와 휴대폰 번호를 확인해 주세요.'; return; }
    try {
      const r = await fetch('/api/pay/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ no, tel }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { msg.textContent = j.error || '조회하지 못했습니다.'; return; }
      location.href = `order-complete.html?o=${encodeURIComponent(j.o)}&t=${encodeURIComponent(j.t)}&v=1`;
    } catch (err) { msg.textContent = '조회하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'; }
  });

  // ───────── 예전 미리보기 요약(30분이 지난 요약은 보여 주지 않는다)
  let o = null;
  try { o = JSON.parse(store.sget('jam_order_done') || 'null'); } catch (e) { o = null; }
  if (!o || !o.items || Date.now() - (o.at || 0) > 30 * 60 * 1000) { $('#done-none').hidden = false; return; }
  render(o);
})();
