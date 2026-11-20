/* 홈페이지 회원 화면 — 로그인(아이디·비밀번호 찾기) · 회원가입 · 마이페이지. 서버 /api/member/*(tools/member/api.mjs)
   로그인 뒤 돌아갈 곳: ?next=checkout.html 처럼 이 사이트의 .html 주소만 받는다 */
(function () {
  const { $, $$, esc, won, toast } = UI;
  const body = document.body.classList;
  const q = new URLSearchParams(location.search);
  const next = (v => /^[a-z0-9-]+\.html(\?[\w=&%.-]*)?$/i.test(v || '') ? v : '')(q.get('next'));
  const H = { 'Content-Type': 'application/json', 'X-Jam-Member': '1' };
  async function call(method, url, data) {
    const r = await fetch(url, { method, headers: method === 'GET' ? { Accept: 'application/json' } : H, body: method === 'GET' ? undefined : JSON.stringify(data || {}), cache: 'no-store', credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || '잠시 뒤 다시 시도해 주세요.'), { status: r.status });
    return j;
  }
  const digits = v => String(v || '').replace(/\D/g, '');
  const fmtTel = v => { const d = digits(v).slice(0, 11); return d.length < 4 ? d : d.length < 8 ? `${d.slice(0, 3)}-${d.slice(3)}` : d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`; };
  $$('input[type="tel"]').forEach(i => i.addEventListener('input', () => { const end = i.selectionEnd === i.value.length; i.value = fmtTel(i.value); if (end) i.setSelectionRange(i.value.length, i.value.length); }));
  const msg = (id, t, ok) => { const el = $(id); if (el) { el.textContent = t || ''; el.classList.toggle('is-ok', !!ok); } };
  const busy = (form, on) => $$('button[type="submit"]', form).forEach(b => { b.disabled = on; });
  const rateFill = c => { if (!c) return; $$('[data-rate]').forEach(x => { x.textContent = c.rate; }); $$('[data-earn]').forEach(x => { x.textContent = c.earnDays; }); };
  const go = () => { location.href = next || 'mypage.html'; };
  // 로그인한 상태로 로그인·가입 화면에 오면 바로 보낸다
  const me = call('GET', '/api/member/me').catch(() => ({ member: null }));
  me.then(j => { rateFill(j.cfg || (j.member && j.member.cfg)); if (j.member && (body.contains('page-login') || body.contains('page-join'))) go(); });
  $$('#lg-join, #lg-join2, #jn-login').forEach(a => { if (next) a.href += `?next=${encodeURIComponent(next)}`; });

  // ───────── 로그인 · 아이디 찾기 · 비밀번호 찾기
  if (body.contains('page-login')) {
    const tabs = $$('[role="tab"]'), forms = { login: $('#lg-form'), fid: $('#fi-form'), fpw: $('#fp-form') };
    const show = k => {
      tabs.forEach(t => { const on = t.dataset.tab === k; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
      Object.entries(forms).forEach(([x, f]) => { f.hidden = x !== k; });
      const f = forms[k].querySelector('input'); if (f) f.focus();
    };
    $$('[data-tab]').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
    if (q.get('tab') && forms[q.get('tab')]) show(q.get('tab'));
    if (q.get('need') === '1') msg('#lg-msg', '로그인이 필요합니다.');
    forms.login.addEventListener('submit', async e => {
      e.preventDefault(); msg('#lg-msg');
      const login = $('#lg-id').value.trim(), pw = $('#lg-pw').value;
      if (!login || !pw) { msg('#lg-msg', '아이디와 비밀번호를 넣어 주세요.'); return; }
      busy(e.target, true);
      try { await call('POST', '/api/member/login', { login, pw, keep: $('#lg-keep').checked }); go(); }
      catch (err) { msg('#lg-msg', err.message); busy(e.target, false); }
    });
    forms.fid.addEventListener('submit', async e => {
      e.preventDefault(); msg('#fi-msg'); $('#fi-out').innerHTML = '';
      const name = $('#fi-name').value.trim(), tel = $('#fi-tel').value;
      if (name.length < 2 || digits(tel).length < 10) { msg('#fi-msg', '이름과 휴대폰 번호를 확인해 주세요.'); return; }
      busy(e.target, true);
      try {
        const j = await call('POST', '/api/member/find-id', { name, tel });
        $('#fi-out').innerHTML = j.list.length ? `<p>가입한 아이디</p><ul>${j.list.map(x => `<li><b>${esc(x.login)}</b> <span>${esc(x.created)} 가입</span></li>`).join('')}</ul><button type="button" class="btn btn--line btn--sm" data-tab="login">로그인하기</button>` : '<p>이 이름·휴대폰 번호로 가입한 아이디가 없습니다.</p>';
        $$('[data-tab]', $('#fi-out')).forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
      } catch (err) { msg('#fi-msg', err.message); }
      busy(e.target, false);
    });
    forms.fpw.addEventListener('submit', async e => {
      e.preventDefault(); msg('#fp-msg');
      const login = $('#fp-id').value.trim(), name = $('#fp-name').value.trim(), tel = $('#fp-tel').value;
      if (!login || name.length < 2 || digits(tel).length < 10) { msg('#fp-msg', '아이디·이름·휴대폰 번호를 모두 넣어 주세요.'); return; }
      busy(e.target, true);
      try {
        const j = await call('POST', '/api/member/find-pw', { login, name, tel });
        msg('#fp-msg', j.sent ? '입력한 정보가 맞으면 가입한 휴대폰으로 임시 비밀번호를 보냈습니다. 문자가 오지 않으면 입력한 정보를 다시 확인해 주세요.' : '지금은 문자로 보내 드릴 수 없습니다. 고객센터(010-9610-8868, 평일 09:00~17:00)나 카카오톡 채널로 아이디를 알려 주시면 확인 뒤 임시 비밀번호를 안내해 드립니다.', true);
      } catch (err) { msg('#fp-msg', err.message); }
      busy(e.target, false);
    });
  }

  // ───────── 회원가입
  if (body.contains('page-join')) {
    const f = $('#jn-form'), err = (id, t) => { $(`#${id}-e`).textContent = t || ''; $(`#${id}`) && $(`#${id}`).setAttribute('aria-invalid', t ? 'true' : 'false'); };
    let idOk = false;
    $('#jn-id').addEventListener('input', () => { idOk = false; $('#jn-id-ok').textContent = ''; });
    $('#jn-id').addEventListener('blur', async () => {
      const v = $('#jn-id').value.trim().toLowerCase(); $('#jn-id').value = v; if (!v) return;
      try { const j = await call('GET', `/api/member/check?login=${encodeURIComponent(v)}`); idOk = j.ok;
        err('jn-id', j.valid ? (j.taken ? '이미 쓰고 있는 아이디입니다.' : '') : '영문 소문자·숫자 4~20자로 정해 주세요(밑줄 _ 가능).'); $('#jn-id-ok').textContent = j.ok ? '쓸 수 있는 아이디입니다.' : ''; } catch (e) { /* 가입할 때 다시 확인 */ }
    });
    const all = $('#jn-all'), ags = $$('.jn-ag');
    const sync = () => { const n = ags.filter(x => x.checked).length; all.checked = n === ags.length; all.indeterminate = n > 0 && n < ags.length; };
    all.addEventListener('change', () => { ags.forEach(x => { x.checked = all.checked; }); sync(); });
    ags.forEach(x => x.addEventListener('change', sync));
    f.addEventListener('submit', async e => {
      e.preventDefault(); msg('#jn-msg');
      const d = { login: $('#jn-id').value.trim().toLowerCase(), pw: $('#jn-pw').value, name: $('#jn-name').value.trim(), tel: $('#jn-tel').value, email: $('#jn-mail').value.trim(),
        agreeTerms: $('#ag-terms').checked, agreePrivacy: $('#ag-priv').checked, age14: $('#ag-14').checked, mkSms: $('#ag-mk').checked, mkEmail: $('#ag-mk').checked };
      let bad = false;
      const chk = (id, cond, t) => { err(id, cond ? '' : t); if (!cond) bad = true; };
      chk('jn-id', /^[a-z0-9][a-z0-9_]{3,19}$/.test(d.login), '영문 소문자·숫자 4~20자로 정해 주세요.');
      chk('jn-pw', d.pw.length >= 8 && /[A-Za-z]/.test(d.pw) && /\d/.test(d.pw), '영문과 숫자를 섞어 8자 이상으로 정해 주세요.');
      chk('jn-pw2', d.pw === $('#jn-pw2').value, '비밀번호가 서로 다릅니다.');
      chk('jn-name', d.name.length >= 2, '이름을 2자 이상 적어 주세요.');
      chk('jn-tel', /^01[016789]\d{7,8}$/.test(digits(d.tel)), '휴대폰 번호를 확인해 주세요.');
      chk('jn-mail', !d.email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email), '이메일 주소 형식을 확인해 주세요.');
      $('#jn-ag-e').textContent = d.agreeTerms && d.agreePrivacy && d.age14 ? '' : '필수 항목(이용약관·개인정보·만 14세 이상)에 동의해 주세요.';
      if (bad || $('#jn-ag-e').textContent) { const x = f.querySelector('[aria-invalid="true"]'); if (x) x.focus(); return; }
      busy(f, true);
      try { await call('POST', '/api/member/join', d); toast('회원가입을 마쳤습니다. 환영합니다!'); setTimeout(go, 600); }
      catch (er) { msg('#jn-msg', er.message); busy(f, false); }
    });
  }

  // ───────── 마이페이지
  if (body.contains('page-my')) {
    let M = null;
    const fmtDate = s => { const d = new Date(Date.parse(s) + 9 * 3600e3).toISOString(); return `${d.slice(0, 10).replace(/-/g, '.')}`; };
    const head = m => {
      $('#my-name').textContent = m.name; $('#my-id').textContent = `${m.login} · ${fmtDate(m.created)} 가입`;
      $('#my-points').textContent = won(m.points); $('#my-points-s').textContent = m.available !== m.points ? `지금 쓸 수 있는 ${won(m.available)}(결제 중인 주문에 잡아 둔 금액 제외)` : '';
      $('#my-temp').hidden = !m.tempPw; $('#out-pt').textContent = won(Math.max(0, m.points));
    };
    const tabs = $$('.mem-tabs [data-sec]');
    const show = k => { tabs.forEach(t => { const on = t.dataset.sec === k; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; }); $$('.my-sec').forEach(s => { s.hidden = s.dataset.sec !== k; }); if (k === 'points') points(); if (k === 'info') info(); history.replaceState(null, '', `#${k}`); };
    tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.sec)));
    $$('[data-go]').forEach(b => b.addEventListener('click', () => show(b.dataset.go)));
    me.then(j => {
      if (!j.member) { location.replace('login.html?need=1&next=mypage.html'); return; }
      M = j.member; head(M); $('#my-wait').hidden = true; $('#my').hidden = false;
      orders(); const h = location.hash.slice(1); if (['points', 'info', 'pw', 'out'].includes(h)) show(h);
    });
    $('#my-logout').addEventListener('click', async () => { await call('POST', '/api/member/logout').catch(() => null); location.href = 'index.html'; });

    async function orders() {
      const box = $('#my-orders');
      try {
        const { orders: list } = await call('GET', '/api/member/orders');
        if (!list.length) { box.innerHTML = '<div class="my-empty"><p>아직 회원으로 주문한 내역이 없습니다.</p><a class="btn btn--primary btn--sm" href="shop.html">상품 보러 가기</a></div>'; return; }
        box.innerHTML = list.map(o => {
          const link = `order-complete.html?o=${encodeURIComponent(o.no)}&t=${encodeURIComponent(o.t)}&v=1`;
          const earn = o.earned ? `<span class="my-earn is-done">${won(o.earned)} 적립됨</span>` : o.earnPlan ? `<span class="my-earn">${won(o.earnPlan)} 적립 예정 · 배송 완료 ${esc(String(M.cfg.earnDays))}일 뒤</span>` : '';
          return `<article class="my-ord"><header><b>${fmtDate(o.at)}</b><span class="my-ord__no">${esc(o.no)}</span><span class="my-ord__st${o.status === 'cancelled' ? ' is-off' : ''}">${esc(o.stage || '')}</span><a class="my-ord__more" href="${link}">주문 상세</a></header>
            <ul>${o.items.map(x => `<li><a href="product-${encodeURIComponent(x.id)}.html">${esc(x.name)}</a>${x.opt ? `<small>${esc(x.opt)}</small>` : ''}<span>${x.qty}개</span>${o.canReview ? `<a class="my-rv" href="product-${encodeURIComponent(x.id)}.html?write=1&o=${encodeURIComponent(o.no)}&t=${encodeURIComponent(o.t)}#rva">구매평 쓰기</a>` : ''}</li>`).join('')}</ul>
            <footer><span>결제 <b>${won(o.amount)}</b>${o.points ? ` · 적립금 ${won(o.points)} 사용` : ''}${o.refunded ? ` · 환불 ${won(o.refunded)}` : ''}</span>${earn}</footer></article>`;
        }).join('');
      } catch (e) { box.innerHTML = `<p class="mem-msg">${esc(e.message)}</p>`; }
    }
    const TYPE = { earn: '구매 적립', use: '주문에 사용', restore: '주문 취소로 돌려받음', revoke: '환불로 적립 회수', admin: '잠스쿨 조정', join: '가입 적립' };
    async function points() {
      try {
        const j = await call('GET', '/api/member/points'), c = j.cfg;
        $('#pt-bal').textContent = won(j.points); $('#pt-av').textContent = won(j.available);
        $('#pt-rule').textContent = c.on ? `결제 금액(적립금으로 낸 금액 제외)의 ${c.rate}%를 배송 완료 ${c.earnDays}일 뒤(반품 기간이 지나면) 적립합니다. ${won(c.minUse)} 이상부터 주문서에서 쓸 수 있고, 주문을 취소하면 쓴 적립금은 돌려드립니다.` : '지금은 적립금 적립·사용을 쉬고 있습니다.';
        $('#pt-log').innerHTML = j.log.length ? `<table class="my-tbl"><thead><tr><th>날짜</th><th>내용</th><th class="r">금액</th><th class="r">잔액</th></tr></thead><tbody>${j.log.map(l => `<tr><td>${fmtDate(l.at)}</td><td>${esc(TYPE[l.type] || l.type)}${l.memo && l.type === 'admin' ? ` · ${esc(l.memo)}` : ''}${l.moid ? `<small>${esc(l.moid)}</small>` : ''}</td><td class="r ${l.amount < 0 ? 'minus' : 'plus'}">${l.amount > 0 ? '+' : ''}${won(l.amount)}</td><td class="r">${won(l.balance)}</td></tr>`).join('')}</tbody></table>` : '<p class="note">아직 적립금 내역이 없습니다.</p>';
      } catch (e) { $('#pt-log').innerHTML = `<p class="mem-msg">${esc(e.message)}</p>`; }
    }
    function info() {
      if (!M) return;
      $('#if-name').value = M.name; $('#if-tel').value = fmtTel(M.tel); $('#if-mail').value = M.email || '';
      const a = M.addr || {}; $('#if-rname').value = a.name || ''; $('#if-rtel').value = a.tel ? fmtTel(a.tel) : ''; $('#if-zip').value = a.zip || ''; $('#if-a1').value = a.addr1 || ''; $('#if-a2').value = a.addr2 || '';
      $('#if-addr-del').hidden = !M.addr; $('#if-mk-sms').checked = !!(M.marketing || {}).sms; $('#if-mk-mail').checked = !!(M.marketing || {}).email;
    }
    // 주소 검색: 카카오 우편번호(누를 때만 불러와 팝업으로)
    $('#if-zipbtn').addEventListener('click', () => {
      const open = () => new daum.Postcode({ oncomplete: d => { $('#if-zip').value = d.zonecode; $('#if-a1').value = d.roadAddress || d.jibunAddress; $('#if-a2').focus(); } }).open();
      if (window.daum && daum.Postcode) { open(); return; }
      const s = document.createElement('script'); s.src = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      s.onload = open; s.onerror = () => toast('주소 검색을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.'); document.head.appendChild(s);
    });
    $('#if-addr-del').addEventListener('click', async () => { try { const j = await call('POST', '/api/member/update', { addr: null }); M = j.member; info(); toast('기본 배송지를 지웠습니다.'); } catch (e) { msg('#if-msg', e.message); } });
    $('#if-form').addEventListener('submit', async e => {
      e.preventDefault(); msg('#if-msg');
      const zip = $('#if-zip').value, d = { name: $('#if-name').value.trim(), tel: $('#if-tel').value, email: $('#if-mail').value.trim(), marketing: { sms: $('#if-mk-sms').checked, email: $('#if-mk-mail').checked } };
      if (zip) { if (!$('#if-a2').value.trim()) { msg('#if-msg', '상세 주소를 적어 주세요.'); return; } d.addr = { zip, addr1: $('#if-a1').value, addr2: $('#if-a2').value.trim(), name: $('#if-rname').value.trim(), tel: $('#if-rtel').value }; }
      busy(e.target, true);
      try { const j = await call('POST', '/api/member/update', d); M = j.member; head(M); info(); msg('#if-msg', '저장했습니다.', true); } catch (er) { msg('#if-msg', er.message); }
      busy(e.target, false);
    });
    $('#pw-form').addEventListener('submit', async e => {
      e.preventDefault(); msg('#pw-msg');
      const cur = $('#pw-cur').value, nx = $('#pw-new').value;
      if (nx !== $('#pw-new2').value) { msg('#pw-msg', '새 비밀번호가 서로 다릅니다.'); return; }
      busy(e.target, true);
      try { await call('POST', '/api/member/password', { cur, next: nx }); e.target.reset(); M.tempPw = false; head(M); msg('#pw-msg', '비밀번호를 바꿨습니다.', true); } catch (er) { msg('#pw-msg', er.message); }
      busy(e.target, false);
    });
    $('#out-form').addEventListener('submit', async e => {
      e.preventDefault(); msg('#out-msg');
      if (!$('#out-ok').checked) { msg('#out-msg', '안내 내용을 확인하고 체크해 주세요.'); return; }
      if (!confirm('정말 탈퇴할까요? 적립금과 회원 정보가 바로 지워집니다.')) return;
      busy(e.target, true);
      try { await call('POST', '/api/member/withdraw', { pw: $('#out-pw').value }); alert('탈퇴했습니다. 그동안 이용해 주셔서 고맙습니다.'); location.href = 'index.html'; }
      catch (er) { msg('#out-msg', er.message); busy(e.target, false); }
    });
  }
})();
