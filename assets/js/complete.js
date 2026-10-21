/* 주문 완료: 주문서가 넘긴 요약(가린 개인정보)을 보여 준다. 미리보기 주문이면 상단에 '실제 주문 아님'을 표시 */
(function () {
  const { $, won, esc, store } = UI;
  const { CHECKOUT } = JAM;
  let o = null;
  try { o = JSON.parse(store.sget('jam_order_done') || 'null'); } catch (e) { o = null; }
  // 30분이 지난 요약은 보여 주지 않는다
  if (!o || !o.items || Date.now() - (o.at || 0) > 30 * 60 * 1000) { $('#done-none').hidden = false; return; }
  const pv = o.mode !== 'pg';
  $('#done-pv').hidden = !pv;
  $('#done-body').hidden = false;
  $('#done-t').textContent = pv ? '주문 완료 화면 미리보기' : '주문이 접수되었습니다';
  if (pv) document.title = '주문 완료(미리보기) | 잠스쿨 공식몰';
  $('#done-no').textContent = o.no;
  $('#done-pay').textContent = o.payLabel;
  $('#done-total').textContent = won(o.total);
  $('#done-bank').hidden = o.pay !== 'bank';
  $('#done-name').textContent = o.name;
  $('#done-tel').textContent = o.tel;
  $('#done-addr').textContent = o.addr;
  if (o.memo) { $('#done-memo').textContent = o.memo; $('#done-memo-w').hidden = false; }
  $('#done-items').innerHTML = o.items.map(x => `<li class="co-item"><span class="co-item__img">${RENDER.pic(x.img, 'alt="" width="72" height="72" loading="lazy"')}</span><div><p class="co-item__n">${esc(x.name)}</p>${x.opt ? `<p class="co-item__o">${esc(x.opt)}</p>` : ''}<p class="co-item__q">${x.qty}개 · <b>${won(x.qty * x.price)}</b></p></div></li>`).join('');

  const mat = o.items.some(x => x.cat === 'mattress'), has29 = o.items.some(x => x.id === 29);
  const flow = [
    ['결제 확인', o.pay === 'bank' ? '입금이 확인되면 출고 준비를 시작합니다.' : '결제가 확인되면 출고 준비를 시작합니다.'],
    ['출고', '오후 1시 이전에 결제(입금)가 확인되면 당일 출고합니다. 주말·공휴일은 쉽니다.'],
    ['배송', `평균 1~3일 걸립니다. ${CHECKOUT.couriers}로 보냅니다.${o.jeju ? ' ' + CHECKOUT.shipNote : ''}`],
  ];
  if (mat) flow.push(['받은 뒤', '압축 포장을 풀면 원래 크기로 돌아오기까지 2일 정도 걸립니다. 포장을 열기 전에 사이즈를 먼저 확인해 주세요.']);
  if (has29) flow.push(['14일 무료체험', '3단 접이식 매트리스는 받은 날부터 14일 동안 써 보고 결정할 수 있습니다(기간 한정, 반품 시 왕복 배송비 고객 부담).']);
  $('#done-flow').innerHTML = flow.map(([t, d], i) => `<li><span class="done-flow__n">${i + 1}</span><div><b>${esc(t)}</b><p>${esc(d)}</p></div></li>`).join('');
})();
