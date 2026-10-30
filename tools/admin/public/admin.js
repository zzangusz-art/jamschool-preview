/* 잠스쿨 관리자 화면 — 블로그·상품·상세페이지(클라이언트) + 설정·자동 발행·키워드 점검·작업 기록·계정(관리자 전용)
   저장하면 서버가 저장소에 반영하고, 약 2분 뒤 사이트에 나온다(오른쪽 위 '사이트 반영' 표시). */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => (+n || 0).toLocaleString('ko-KR') + '원';
  const len = s => [...String(s || '')].length;
  let ME = null, dirty = false;

  async function api(method, url, data) {
    const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'X-Jam-Admin': '1', ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401 && ME && !url.endsWith('/login')) { ME.user = null; dirty = false; render(); }
    if (!res.ok) { const e = new Error(j.error || `오류(${res.status})`); e.data = j; throw e; }
    return j;
  }
  let tt;
  function toast(t, ms = 3800) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), ms); }
  const fail = e => toast(e.message || String(e), 6000);

  // ── 사이트 반영 표시: 저장 커밋의 배포 상태를 15초마다 확인
  let deploy = { state: '', text: '' }, watcher = null;
  function setDeploy(state, text) { deploy = { state, text }; const el = $('#deploy'); if (el) { el.className = 'deploy ' + state; el.textContent = text; el.hidden = !text; } }
  function watchDeploy(sha) {
    clearInterval(watcher);
    if (!sha || String(sha).startsWith('local')) { setDeploy('success', ME.store === 'local' ? '로컬에 저장됨(배포는 deploy.bat)' : ''); return; }
    setDeploy('pending', '사이트 반영 중… (약 2분)'); let n = 0;
    watcher = setInterval(async () => {
      n++;
      try {
        const s = await api('GET', `/api/admin/status/${sha}`);
        if (s.state === 'success') { setDeploy('success', '사이트 반영 완료 ✓'); clearInterval(watcher); }
        else if (s.state === 'failure' || s.state === 'error') { setDeploy('failure', '사이트 반영 실패 — 관리자에게 알려 주세요'); clearInterval(watcher); }
      } catch { /* 다음에 다시 */ }
      if (n > 40) { clearInterval(watcher); setDeploy('', ''); }
    }, 15000);
  }
  const saved = (r, what) => { dirty = false; toast(`${what} 저장했습니다. 약 2분 뒤 사이트에 반영됩니다.`); watchDeploy(r.commit); };

  // ── 사진: 큰 사진은 줄여서(JPEG) 올린다. GIF 는 움직임 유지를 위해 그대로
  const readURL = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
  const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('사진을 열지 못했습니다')); i.src = src; });
  async function prepImage(file, maxW) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('JPG·PNG·WebP·GIF 사진만 올릴 수 있습니다');
    const url = await readURL(file), img = await loadImg(url);
    if (file.type === 'image/gif') { if (file.size > 8e6) throw new Error('GIF 는 8MB 이하로 올려 주세요'); return { data: url, w: img.naturalWidth, h: img.naturalHeight }; }
    const s = Math.min(1, maxW / img.naturalWidth), w = Math.round(img.naturalWidth * s), ht = Math.round(img.naturalHeight * s);
    const c = document.createElement('canvas'); c.width = w; c.height = ht;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, ht); x.drawImage(img, 0, 0, w, ht);
    return { data: c.toDataURL('image/jpeg', 0.86), w, h: ht };
  }
  function pickFiles(multiple) {
    return new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/jpeg,image/png,image/webp,image/gif'; i.multiple = multiple; i.onchange = () => ok([...i.files]); i.click(); });
  }
  const site = p => '/' + String(p || '').replace(/^\//, '');
  const tmpId = () => Math.random().toString(36).slice(2, 9);

  // ── 화면 틀
  const ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    traffic: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    orders: '<path d="M5 7h14l-1.2 12.1a1 1 0 0 1-1 .9H7.2a1 1 0 0 1-1-.9z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
    blog: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    products: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
    settings: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>',
    topics: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    log: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-3.8-5.9"/>',
    me: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  };
  const ico = k => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  const NAV = [['현황', [['', '홈', 'home'], ['traffic', '방문·유입', 'traffic'], ['orders', '주문', 'orders']]], ['콘텐츠', [['blog', '블로그', 'blog'], ['products', '상품·상세페이지', 'products']]]];
  const OWNER_NAV = [['settings', '소유확인·추적 코드', 'settings'], ['topics', '블로그 자동 발행', 'topics'], ['check', '키워드 점검', 'check'], ['log', '작업 기록', 'log'], ['users', '계정 관리', 'users']];
  const route = () => location.hash.replace(/^#\/?/, '').split('/');
  // shell(제목, { desc: 제목 아래 한 줄, tool: 오른쪽 버튼, back: [주소, 글자] })
  function shell(title, o = {}) {
    const r = route()[0], isOwner = ME.user.role === 'owner';
    const link = ([k, t, i]) => `<a href="#/${k}" class="${r === k ? 'on' : ''}">${ico(i)}<span>${t}</span></a>`;
    $('#app').innerHTML = `<div class="shell"><aside class="side" id="side"><a class="brand" href="#/"><img src="/assets/img/brand/logo.png" alt="잠스쿨"><span>관리자</span></a>
      <button class="navbtn" id="navbtn" type="button" aria-expanded="false" aria-controls="side-nav">${ico('menu')}<span>메뉴</span></button>
      <nav id="side-nav">${NAV.map(([g, list]) => `<p class="grp">${g}</p>${list.map(link).join('')}`).join('')}
        ${isOwner ? `<p class="grp own">관리자 전용</p>${OWNER_NAV.map(link).join('')}` : ''}
        <div class="bottom">${link(['me', '내 계정', 'me'])}<a href="/" target="_blank" rel="noopener">${ico('out')}<span>사이트 보기</span></a><a href="#" id="logout">${ico('logout')}<span>로그아웃</span></a></div></nav>
      <p class="who"><b>${h(ME.user.name)}</b>${h(ME.user.roleName)} · ${h(ME.user.id)}</p></aside>
      <main class="main"><div class="top"><div class="tt">${o.back ? `<a class="back" href="${o.back[0]}">← ${h(o.back[1])}</a>` : ''}<h1 id="ttl">${h(title)}</h1>${o.desc ? `<p>${o.desc}</p>` : ''}</div>${o.tool || ''}<span id="deploy" class="deploy ${deploy.state}" ${deploy.text ? '' : 'hidden'}>${h(deploy.text)}</span></div>
      ${!ME.storeReady ? '<div class="box bad">저장소 연결이 안 되어 있어 저장할 수 없습니다. 관리자에게 알려 주세요(Railway 변수 GITHUB_TOKEN).</div>' : ''}
      <div id="view"><p class="help">불러오는 중…</p></div></main></div>`;
    // 휴대폰: 메뉴 버튼으로 펼치고, 메뉴를 고르면 닫는다
    $('#navbtn').onclick = () => { const open = $('#side').classList.toggle('open'); $('#navbtn').setAttribute('aria-expanded', open); $('#navbtn span').textContent = open ? '닫기' : '메뉴'; };
    $('#side-nav').addEventListener('click', e => { if (e.target.closest('a')) $('#side').classList.remove('open'); });
    $('#logout').onclick = async e => { e.preventDefault(); await api('POST', '/api/admin/logout').catch(() => {}); ME.user = null; render(); };
    return $('#view');
  }

  function loginView() {
    $('#app').innerHTML = `<div class="login-wrap"><div class="login-art" style="background-image:url(/assets/img/scenes/sleep-side.jpg)"><b>고친 내용은 2분 뒤<br>jamschool.kr 에 보입니다</b><p>블로그 · 상품 · 상세페이지 · 방문과 주문</p></div>
      <form class="login" id="lf"><img src="/assets/img/brand/logo.png" alt="잠스쿨"><h1>관리자 로그인</h1><p class="sub">받은 아이디와 비밀번호를 넣어 주세요.</p>
      ${ME.ready ? '' : '<div class="box warn">아직 계정 설정이 끝나지 않았습니다. 관리자에게 문의해 주세요.</div>'}
      <label for="id">아이디</label><input type="text" id="id" autocomplete="username" autocapitalize="off" required>
      <label for="pw">비밀번호</label><input type="password" id="pw" autocomplete="current-password" required>
      <div class="actions static"><button class="btn pri" style="width:100%">로그인</button></div><p class="help" id="lerr" role="alert"></p></form></div>`;
    $('#lf').onsubmit = async e => {
      e.preventDefault();
      try { await api('POST', '/api/admin/login', { id: $('#id').value, pw: $('#pw').value }); await boot(); }
      catch (err) { $('#lerr').textContent = err.message; }
    };
    $('#id').focus();
  }

  // ── 숫자·그래프 도우미
  const num = n => (+n || 0).toLocaleString('ko-KR');
  const sum = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const pct = (a, b) => b ? `${Math.round(a / b * 1000) / 10}%` : '-';
  const top = (o, n = 10) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
  const md = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  const nice = m => { const p = 10 ** Math.floor(Math.log10(m)); return [1, 2, 5, 10].map(x => x * p).find(x => x >= m); };
  const empty = t => `<p class="empty">${t}</p>`;
  // 막대 표: [[이름, 값], …] → 이름 · 막대 · 숫자
  function bars(rows, total, name = x => h(x)) {
    if (!rows.length) return empty('아직 기록이 없습니다.');
    const max = rows[0][1] || 1;
    return `<table class="list"><tbody>${rows.map(([k, n]) => `<tr><td>${name(k)}</td><td class="bar-td"><div class="bar"><span><i style="width:${Math.max(2, n / max * 100)}%"></i></span><em>${num(n)}</em></div></td><td class="r sub">${pct(n, total)}</td></tr>`).join('')}</tbody></table>`;
  }
  // 날짜별 막대 그래프(SVG). series: [[키, 색, 이름]] — 앞의 것이 뒤에 깔린다
  function chart(days, series) {
    const W = innerWidth < 820 ? 360 : 760, H = innerWidth < 820 ? 190 : 200, L = 36, R = 6, T = 10, B = 26;   // 휴대폰은 좁게 그려 글자가 작아지지 않게
    const max = nice(Math.max(2, ...days.flatMap(d => series.map(([k]) => d[k] || 0))));
    const bw = (W - L - R) / days.length, every = Math.ceil(days.length / (W < 500 ? 6 : 10));
    const y = v => T + (H - T - B) * (1 - v / max);
    const grid = [0, .5, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#EEF1F4"/><text x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end">${num(max * f)}</text>`).join('');
    const rects = series.map(([k, c], si) => days.map((d, i) => { const v = d[k] || 0, w = Math.max(2, Math.min(si ? 22 : 34, bw * (si ? .46 : .7))); return `<rect x="${L + i * bw + (bw - w) / 2}" y="${y(v)}" width="${w}" height="${Math.max(0, H - B - y(v))}" rx="2" fill="${c}"><title>${md(d.date)} ${series[si][2]} ${num(v)}</title></rect>`; }).join('')).join('');
    const last = days.length - 1, labels = days.map((d, i) => (i % every === 0 && last - i >= every / 2) || i === last ? `<text x="${i === last && days.length > 1 ? W - R : L + i * bw + bw / 2}" y="${H - 8}" text-anchor="${i === last && days.length > 1 ? 'end' : 'middle'}">${md(d.date)}</text>` : '').join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="날짜별 그래프">${grid}${rects}${labels}</svg><div class="legend">${series.map(([, c, t]) => `<span style="--c:${c}">${t}</span>`).join('')}</div>`;
  }
  const PERIODS = [['1', '오늘'], ['7', '최근 7일'], ['30', '최근 30일']];
  const period = base => { const n = PERIODS.some(([k]) => k === route()[1]) ? route()[1] : '7'; return { n, seg: `<div class="seg">${PERIODS.map(([k, t]) => `<a href="#/${base}/${k}" class="${k === n ? 'on' : ''}">${t}</a>`).join('')}</div>` }; };
  const PAGE_NAME = { '/': '첫 화면', '/shop': '전체 상품', '/blog/': '수면 가이드(블로그 목록)', '/cart': '장바구니', '/checkout': '주문서', '/order-complete': '주문 완료' };
  const pageName = (p, s) => { const m = p.match(/^\/product-(\d+)$/); return h(PAGE_NAME[p] || (m && s.names[m[1]] ? `상품 · ${s.names[m[1]]}` : '') || (s.titles[p] ? `글 · ${s.titles[p]}` : '') || p) + ` <small class="sub">${h(p)}</small>`; };
  const persistNote = s => s.persistent || ME.user.role !== 'owner' ? '' : '<div class="box warn">Railway 볼륨(DATA_DIR)이 아직 없어 방문 숫자가 메모리에만 있습니다. 다시 배포하면 0부터 셉니다.</div>';

  // ── 홈
  async function dashboard() {
    const v = shell(`${ME.user.name}님, 안녕하세요`, { desc: '저장한 내용은 약 2분 뒤 사이트에 반영됩니다. 반영 상태는 오른쪽 위에 보입니다.' });
    const [d, s] = await Promise.all([api('GET', '/api/admin/dashboard'), api('GET', '/api/admin/stats?days=7').catch(() => null)]);
    const st = d.status && d.status.state;
    const today = s ? s.days[s.days.length - 1] : null;
    v.innerHTML = `${s ? `<div class="kpis"><div class="kpi"><span>오늘 방문자</span><b>${num(today.uv)}</b><small>페이지 ${num(today.pv)}번 열림</small></div>
        <div class="kpi"><span>7일 방문자</span><b>${num(s.total.uv)}</b><small>하루 평균 ${num(Math.round(s.total.uv / 7))}명</small></div>
        <div class="kpi"><span>7일 구매 버튼 클릭</span><b>${num((s.total.events.buy_click || 0) + (s.total.events.cart_click || 0) + (s.total.events.store_click || 0))}</b><small>구매·장바구니·스마트스토어</small></div>
        <div class="kpi"><span>7일 AI 답변에서 온 방문</span><b>${num(sum(s.total.ai))}</b><small>ChatGPT·Perplexity 등</small></div></div>` : ''}
      <div class="cols"><div class="card"><h2>바로 가기</h2><p class="h-sub">자주 하는 일</p><div class="actions static"><a class="btn pri" href="#/blog/new">새 블로그 글 쓰기</a><a class="btn" href="#/products">상품·상세페이지</a><a class="btn" href="#/traffic">방문·유입 보기</a><a class="btn" href="#/orders">주문 보기</a></div></div>
        <div class="card"><h2>사이트 반영 상태</h2><p class="h-sub">마지막으로 저장한 내용이 사이트에 올라갔는지</p><p>${st === 'success' ? '<span class="tag live">최근 변경까지 반영 완료</span>' : st === 'pending' ? '<span class="tag draft">반영 중</span>' : st === 'failure' || st === 'error' ? '<span class="tag bad">반영 실패 — 관리자 확인 필요</span>' : st === 'local' ? '<span class="tag">로컬 저장 모드</span>' : '<span class="tag">확인 중</span>'}</p></div></div>
      <div class="card"><h2>최근 변경</h2><p class="h-sub">누가 무엇을 고쳤는지(최근 순)</p><table class="list"><thead><tr><th>시간</th><th>내용</th><th>누가</th></tr></thead><tbody>${d.recent.length ? '' : '<tr><td colspan="3" class="empty">아직 기록이 없습니다.</td></tr>'}${d.recent.map(c => `<tr><td class="nw">${h(new Date(c.date).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</td><td>${h(c.message.split('\n')[0].replace(/^어드민: /, ''))}</td><td class="nw">${h(c.author)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ── 방문·유입
  async function traffic() {
    const { n, seg } = period('traffic');
    const v = shell('방문·유입', { desc: '사이트에 몇 명이 어디서 들어왔는지. 같은 사람은 하루 한 번만 셉니다(쿠키·개인정보 없이).', tool: seg });
    const s = await api('GET', `/api/admin/stats?days=${n}`), t = s.total, ai = sum(t.ai);
    v.innerHTML = `${persistNote(s)}<div class="kpis"><div class="kpi"><span>방문자</span><b>${num(t.uv)}</b><small>${n === '1' ? '오늘' : `하루 평균 ${num(Math.round(t.uv / +n))}명`}</small></div>
        <div class="kpi"><span>페이지 열림</span><b>${num(t.pv)}</b><small>방문자 1명당 ${t.uv ? (t.pv / t.uv).toFixed(1) : '-'}쪽</small></div>
        <div class="kpi"><span>다른 곳에서 들어옴</span><b>${num(t.entries)}</b><small>검색·블로그·SNS 등(직접 입력 포함)</small></div>
        <div class="kpi"><span>AI 답변에서 들어옴</span><b>${num(ai)}</b><small>${ai ? top(t.ai, 2).map(([k]) => h(k)).join('·') : 'ChatGPT·Perplexity·Gemini 등'}</small></div></div>
      ${n !== '1' ? `<div class="card"><h2>날짜별</h2><p class="h-sub">막대를 누르거나 마우스를 올리면 숫자가 보입니다</p>${chart(s.days, [['pv', '#D9DFE6', '페이지 열림'], ['uv', '#15181C', '방문자']])}</div>` : ''}
      <div class="cols"><div class="card"><h2>어디서 왔나</h2><p class="h-sub">들어온 경로별(사이트 안 이동은 빼고)</p>${bars(top(t.sources, 12), t.entries)}</div>
        <div class="card"><h2>많이 본 페이지</h2><p class="h-sub">페이지 열림 순</p>${bars(top(t.pages, 12), t.pv, p => pageName(p, s))}</div></div>
      <div class="cols"><div class="card"><h2>AI 답변 유입</h2><p class="h-sub">AI 답변 속 링크를 눌러 들어온 방문</p>${bars(top(t.ai, 8), ai)}</div>
        <div class="card"><h2>들어온 사이트</h2><p class="h-sub">검색·블로그·카페 등 주소별</p>${bars(top(t.refs, 10), sum(t.refs))}</div></div>
      <div class="cols"><div class="card"><h2>기기</h2><p class="h-sub">방문자 기준</p>${bars(top(t.devices), t.uv)}</div>
        <div class="card"><h2>검색엔진·AI 로봇 방문</h2><p class="h-sub">사람이 아닌 수집 로봇이 읽어간 횟수(방문자 숫자에는 안 들어감)</p>${bars(top(t.bots, 10), sum(t.bots))}</div></div>
      <p class="help">GA4·네이버 애널리틱스를 연결하면 거기서도 더 자세히 볼 수 있습니다. 이 화면 숫자는 사이트 서버가 직접 센 것이라 조금 다를 수 있습니다.</p>`;
  }

  // ── 주문(결제 연동 전: 주문서 → 스마트스토어 결제)
  const PAY_NAME = { card: '카드', bank: '무통장입금', npay: '네이버페이', kakaopay: '카카오페이', 기타: '기타' };
  async function orders() {
    const { n, seg } = period('orders');
    const v = shell('주문', { desc: '사이트에서 구매 버튼을 누르고 주문서를 낸 흐름입니다.', tool: seg });
    const s = await api('GET', `/api/admin/stats?days=${n}`), t = s.total, e = t.events || {};
    const views = Object.values(t.products).reduce((a, p) => a + p.views, 0), buy = (e.buy_click || 0) + (e.cart_click || 0), sent = (e.store_click || 0) + (e.checkout_submit || 0);
    const step = (label, val, base, note) => `<div><span>${label}</span><b>${num(val)}</b><small>${base == null ? note : `${note} · ${pct(val, base)}`}</small></div>`;
    const rows = Object.entries(t.products).map(([id, p]) => [id, p, t.orders.items[id] || 0]).sort((a, b) => b[1].views - a[1].views);
    v.innerHTML = `${persistNote(s)}<div class="box info"><b>결제(PG) 연결 전입니다.</b> 주문서에서 '결제하기'를 누르면 같은 상품의 잠스쿨 스마트스토어로 넘어가 거기서 결제합니다. 실제 결제·배송은 <a href="https://sell.smartstore.naver.com/" target="_blank" rel="noopener">스마트스토어 판매자센터</a>에서 확인하세요.</div>
      <div class="funnel">${step('상품 페이지 조회', views, null, '상품 상세를 연 수')}${step('구매·장바구니 클릭', buy, views, '조회 대비')}${step('주문서 제출', t.orders.n, buy || null, buy ? '클릭 대비' : '주문서에서 결제하기')}${step('스마트스토어로 이동', sent, null, 'N Pay·스마트스토어 버튼 포함')}</div>
      <div class="kpis"><div class="kpi"><span>주문서 금액 합계</span><b>${won(t.orders.sum)}</b><small>참고용 — 실제 결제 금액 아님</small></div>
        <div class="kpi"><span>공식몰로 이동</span><b>${num(e.mall_click)}</b><small>jamschool.co.kr</small></div>
        <div class="kpi"><span>전화 걸기</span><b>${num(e.call_click)}</b><small>휴대폰에서 번호 누름</small></div>
        <div class="kpi"><span>카카오톡 문의</span><b>${num(e.kakao_click)}</b><small>상담 버튼</small></div></div>
      ${n !== '1' ? `<div class="card"><h2>날짜별 주문서</h2><p class="h-sub">주문서를 내고 스마트스토어로 넘어간 수</p>${chart(s.days, [['orders', '#0B8ED2', '주문서 제출']])}</div>` : ''}
      <div class="card"><h2>상품별</h2><p class="h-sub">조회 많은 순 · 구매 클릭률이 낮으면 가격·사진·상세페이지를 먼저 보세요</p>
        ${rows.length ? `<table class="list"><thead><tr><th>상품</th><th class="r">조회</th><th class="r">구매 클릭</th><th class="r">클릭률</th><th class="r">주문서 수량</th><th></th></tr></thead><tbody>${rows.map(([id, p, q]) => `<tr><td><b>${h(s.names[id] || '상품 ' + id)}</b></td><td class="r">${num(p.views)}</td><td class="r">${num(p.buy)}</td><td class="r">${pct(p.buy, p.views)}</td><td class="r">${num(q)}</td><td class="r nw"><a class="btn sm" href="#/products/${h(id)}">고치기</a></td></tr>`).join('')}</tbody></table>` : empty('아직 상품을 본 기록이 없습니다.')}</div>
      <div class="cols"><div class="card"><h2>고른 결제 수단</h2><p class="h-sub">주문서에서 고른 것(실제 결제는 스마트스토어)</p>${bars(top(t.orders.pay), t.orders.n, k => h(PAY_NAME[k] || k))}</div>
        <div class="card"><h2>버튼 클릭</h2><p class="h-sub">사이트에서 누른 버튼</p>${bars(top({ '구매하기': e.buy_click || 0, '장바구니 담기': e.cart_click || 0, '스마트스토어·N Pay': e.store_click || 0, '공식몰': e.mall_click || 0, '전화': e.call_click || 0, '카카오톡': e.kakao_click || 0 }).filter(x => x[1]), sum(e) - (e.checkout_submit || 0))}</div></div>`;
  }

  // ── 블로그 목록
  async function blogList() {
    const v = shell('블로그', { desc: '사이트의 수면 가이드 글입니다. 자동 발행 글도 여기서 고치거나 내릴 수 있습니다.', tool: '<a class="btn pri" href="#/blog/new">새 글 쓰기</a>' });
    const { posts } = await api('GET', '/api/admin/posts');
    const owner = ME.user.role === 'owner';
    v.innerHTML = `<div class="card"><table class="list"><thead><tr><th>제목</th><th>날짜</th><th>분류</th><th>대표 키워드</th><th>상태</th><th></th></tr></thead><tbody>
      ${posts.map(p => `<tr><td><b>${h(p.title)}</b>${p.source && p.source !== 'admin' ? ' <span class="tag ai">자동 발행</span>' : ''}</td><td class="nw">${h(p.date)}</td><td class="nw">${h(p.category)}</td><td>${h(p.keyword)}</td>
        <td>${p.draft ? '<span class="tag draft">임시저장</span>' : '<span class="tag live">발행</span>'}</td>
        <td class="nw"><a class="btn sm" href="#/blog/edit/${h(p.slug)}">수정</a> ${p.draft ? '' : `<a class="btn sm" href="/blog/${h(p.slug)}.html" target="_blank" rel="noopener">보기</a>`} ${owner ? `<button class="btn sm danger" data-del="${h(p.slug)}">삭제</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="help">자동 발행 글은 하루 세 번 올라옵니다. 고쳐도 되고, 내리고 싶으면 수정 화면에서 '임시저장(사이트에서 내리기)'을 누르세요.</p>`;
    v.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('이 글을 완전히 지울까요? 되돌리려면 개발 쪽 작업이 필요합니다.')) return;
      try { const r = await api('DELETE', `/api/admin/posts/${b.dataset.del}`); saved(r, '삭제를'); blogList(); } catch (e) { fail(e); }
    });
  }

  // ── 블로그 글쓰기
  async function blogEdit(slug) {
    const v = shell(slug ? '블로그 글 수정' : '새 블로그 글', { back: ['#/blog', '블로그 목록'] });
    const [{ products }, post] = await Promise.all([api('GET', '/api/admin/products'), slug ? api('GET', `/api/admin/posts/${slug}`) : Promise.resolve({ meta: { date: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) }, body: '' })]);
    const m = post.meta, uploads = new Map(); let thumb = null;
    v.innerHTML = `<div class="card">
      <label for="f-title">제목 <small>검색 결과에 보이는 제목. 대표 키워드를 앞쪽에, 34자 이내</small></label><input type="text" id="f-title" value="${h(m.title)}"><div class="count" data-for="f-title" data-max="34"></div>
      <label for="f-kw">대표 키워드 <small>이 글로 노출되고 싶은 검색어 하나(예: 접는 매트리스 보관). 제목과 첫 문단에 넣어 주세요</small></label><input type="text" id="f-kw" value="${h(m.keyword)}">
      <div class="row"><div><label for="f-cat">분류</label><select id="f-cat">${ME.categories.map(c => `<option ${c === m.category ? 'selected' : ''}>${h(c)}</option>`).join('')}</select></div>
        <div><label for="f-date">날짜</label><input type="date" id="f-date" value="${h(m.date)}"></div>
        <div><label for="f-prod">관련 상품 <small>글 아래 상품 카드</small></label><select id="f-prod"><option value="">없음</option>${products.map(p => `<option value="${p.id}" ${String(p.id) === String(m.product) ? 'selected' : ''}>${h(p.short)}</option>`).join('')}</select></div></div>
      <label for="f-desc">설명 <small>검색 결과 제목 아래 보이는 문장. 80자 이내(비우면 첫 문단에서 자동)</small></label><textarea id="f-desc" style="min-height:70px">${h(m.description)}</textarea><div class="count" data-for="f-desc" data-max="80"></div>
      <label for="f-tags">태그 <small>쉼표로 구분</small></label><input type="text" id="f-tags" value="${h(m.tags)}">
      <label>대표 사진(썸네일) <small>가로 1200 × 세로 630 정도가 가장 잘 보입니다</small></label>
      <div class="thumbs" id="thumb">${m.image ? `<figure><img src="${h(site(m.image))}" alt=""></figure>` : '<p class="help">없으면 관련 상품 사진이 대신 쓰입니다.</p>'}</div><button class="btn sm" id="b-thumb" type="button">사진 고르기</button>
    </div>
    <div class="card"><label for="f-body" style="margin-top:0">본문</label>
      <div class="toolbar"><button class="btn sm" data-md="h2">소제목</button><button class="btn sm" data-md="h3">작은 제목</button><button class="btn sm" data-md="b">굵게</button><button class="btn sm" data-md="ul">목록</button><button class="btn sm" data-md="link">링크</button><button class="btn sm" data-md="img">사진 넣기</button><button class="btn sm" data-md="faq">자주 묻는 질문 넣기</button></div>
      <div class="tabs"><button class="on" data-tab="write">쓰기</button><button data-tab="preview">미리보기</button></div>
      <textarea class="body" id="f-body" placeholder="첫 문단에 대표 키워드를 넣고, ## 소제목으로 나눠 쓰면 검색과 AI 답변에 잘 잡힙니다.">${h(post.body)}</textarea><div class="preview" id="pv" hidden></div>
      <p class="help">줄 맨 앞에 ## 를 쓰면 소제목, ### 는 작은 제목, - 는 목록, **글자** 는 굵게입니다. 글 끝에 '자주 묻는 질문'을 넣으면 검색 결과에 질문·답으로 나올 수 있습니다.</p>
      <div id="checks"></div></div>
    <div class="actions"><button class="btn ok" id="b-pub">발행하기</button><button class="btn" id="b-draft">${slug && !m.draft ? '임시저장(사이트에서 내리기)' : '임시저장'}</button><a class="btn" href="#/blog">목록으로</a></div>`;
    const ta = $('#f-body');
    const counts = () => v.querySelectorAll('.count').forEach(c => { const n = len($('#' + c.dataset.for).value); c.textContent = `${n}자 / 권장 ${c.dataset.max}자`; c.classList.toggle('over', n > +c.dataset.max); });
    v.addEventListener('input', () => { dirty = true; counts(); }); counts();
    const insert = (before, after = '', ph = '') => { const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || ph; ta.setRangeText(before + sel + after, s, e, 'end'); ta.focus(); dirty = true; };
    const line = pre => { const s = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1; ta.setRangeText(pre, s, s, 'end'); ta.focus(); dirty = true; };
    v.querySelectorAll('[data-md]').forEach(b => b.onclick = async () => {
      const k = b.dataset.md;
      if (k === 'h2') line('## '); else if (k === 'h3') line('### '); else if (k === 'ul') line('- ');
      else if (k === 'b') insert('**', '**', '강조할 글'); else if (k === 'link') insert('[', '](https://jamschool.kr/product-29.html)', '링크 글자');
      else if (k === 'faq') insert('\n\n## 자주 묻는 질문\n\n### Q. 질문을 적어 주세요\n답을 적어 주세요.\n\n### Q. 두 번째 질문\n답을 적어 주세요.\n');
      else if (k === 'img') { try { for (const f of await pickFiles(true)) { const p = await prepImage(f, 1600), id = tmpId(); uploads.set(id, p.data); insert(`\n![사진 설명을 적어 주세요](tmp:${id})\n`); } } catch (e) { fail(e); } }
    });
    $('#b-thumb').onclick = async () => { try { const [f] = await pickFiles(false); if (!f) return; const p = await prepImage(f, 1200); thumb = p.data; $('#thumb').innerHTML = `<figure><img src="${thumb}" alt=""></figure>`; dirty = true; } catch (e) { fail(e); } };
    v.querySelectorAll('[data-tab]').forEach(b => b.onclick = async () => {
      v.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
      const pv = b.dataset.tab === 'preview'; ta.hidden = pv; $('#pv').hidden = !pv;
      if (pv) {
        const body = ta.value.replace(/\(tmp:(\w+)\)/g, '(assets/img/blog/__tmp__$1.jpg)');
        const { html } = await api('POST', '/api/admin/preview', { body });
        $('#pv').innerHTML = html.replace(/src="assets\/img\/blog\/__tmp__(\w+)\.jpg"/g, (_, id) => `src="${uploads.get(id) || ''}"`).replace(/src="assets\//g, 'src="/assets/');
      }
    });
    const showChecks = r => {
      $('#checks').innerHTML = (r.block && r.block.length ? `<div class="box bad"><b>발행 전에 고쳐야 할 것</b><ul>${r.block.map(x => `<li>${h(x)}</li>`).join('')}</ul></div>` : '')
        + (r.warn && r.warn.length ? `<div class="box warn"><b>고치면 검색에 더 유리한 것</b><ul>${r.warn.map(x => `<li>${h(x)}</li>`).join('')}</ul></div>` : (r.ok ? '<div class="box ok">검사 통과</div>' : ''));
    };
    const save = async draft => {
      const meta = { slug, title: $('#f-title').value, keyword: $('#f-kw').value, category: $('#f-cat').value, date: $('#f-date').value, product: $('#f-prod').value, description: $('#f-desc').value, tags: $('#f-tags').value, author: m.author };
      const used = [...ta.value.matchAll(/\(tmp:(\w+)\)/g)].map(x => x[1]);
      try {
        v.querySelectorAll('.actions .btn').forEach(b => b.disabled = true);
        const r = await api('POST', '/api/admin/posts', { meta, body: ta.value, draft, thumb, uploads: used.map(id => ({ tmp: id, data: uploads.get(id) })) });
        showChecks(r); saved(r, draft ? '임시저장으로' : '글을');
        location.hash = `#/blog/edit/${r.slug}`; if (slug === r.slug) blogEdit(r.slug);
      } catch (e) { if (e.data && (e.data.block || e.data.warn)) showChecks(e.data); fail(e); }
      finally { v.querySelectorAll('.actions .btn').forEach(b => b.disabled = false); }
    };
    $('#b-pub').onclick = () => save(false); $('#b-draft').onclick = () => save(true);
  }

  // ── 상품·상세페이지(한 상품 안에서 탭으로)
  async function productList() {
    const v = shell('상품·상세페이지', { desc: '상품을 누르면 이름·가격·사진과 상세페이지(긴 설명 사진)를 한 화면에서 고칩니다.' });
    const { products } = await api('GET', '/api/admin/products');
    v.innerHTML = `<div class="grid">${products.map(p => `<div class="pcard"><a href="#/products/${p.id}"><img src="${h(site(p.img))}" alt="" loading="lazy"></a><div><a href="#/products/${p.id}"><b>${h(p.short)}</b></a><span>${won(p.price)}${p.full ? '부터' : ''}</span>
      <p class="pc-links"><a href="#/products/${p.id}">기본 정보</a><a href="#/products/${p.id}/detail">상세페이지</a></p></div></div>`).join('')}</div>`;
  }
  const ptabs = (id, on) => `<nav class="ptabs" aria-label="상품 편집"><a href="#/products/${id}" class="${on === 'info' ? 'on' : ''}">기본 정보·사진</a><a href="#/products/${id}/detail" class="${on === 'detail' ? 'on' : ''}">상세페이지</a></nav>`;
  async function productEdit(id) {
    const v = shell('상품', { back: ['#/products', '상품 목록'] });
    const { product: p, options29: o } = await api('GET', `/api/admin/products/${id}`);
    $('#ttl').textContent = p.short;
    let imgs = p.imgs.map(src => ({ src }));
    const BADGES = ['BEST', 'SALE', 'MD', 'NEW', '오늘출발'];
    const keys = o ? o.thickness.flatMap(t => o.size.map(s => [`${t.id}-${s.id}`, `${t.label} ${t.sub} · ${s.label}`])) : [];
    v.innerHTML = `${ptabs(id, 'info')}<div class="card"><h2>기본 정보</h2><p class="h-sub">상품 카드와 상품 페이지 위쪽에 보이는 내용</p>
      <label for="p-name">상품명 <small>상품 페이지 제목에 쓰입니다</small></label><input type="text" id="p-name" value="${h(p.name)}">
      <div class="row"><div><label for="p-short">짧은 이름 <small>카드·메뉴</small></label><input type="text" id="p-short" value="${h(p.short)}"></div>
        <div><label for="p-store">스마트스토어 링크 <small>있으면 N Pay 버튼</small></label><input type="text" id="p-store" value="${h(p.store)}"></div></div>
      <label for="p-sum">한 줄 요약</label><input type="text" id="p-sum" value="${h(p.summary)}">
      ${o ? '' : `<div class="row"><div><label for="p-list">정가</label><input type="number" id="p-list" value="${h(p.list)}"></div><div><label for="p-price">판매가</label><input type="number" id="p-price" value="${h(p.price)}"></div></div>`}
      <label>배지</label><div class="checks">${BADGES.map(b => `<label><input type="checkbox" value="${b}" class="p-badge" ${p.badges.includes(b) ? 'checked' : ''}>${b}</label>`).join('')}</div>
      <label for="p-points">특징 <small>한 줄에 하나씩, 상품 카드·상세 위에 보입니다</small></label><textarea id="p-points" style="min-height:110px">${h(p.points.join('\n'))}</textarea></div>
      ${o ? `<div class="card"><h2>옵션별 가격(3단 접이식)</h2><table class="opt"><tr><th>옵션</th><th>판매가</th><th>정가</th></tr>${keys.map(([k, t]) => `<tr><td>${h(t)}</td><td><input type="number" data-op="price" data-k="${k}" value="${o.price[k]}"></td><td><input type="number" data-op="list" data-k="${k}" value="${o.list[k]}"></td></tr>`).join('')}</table><p class="help">가장 싼 옵션의 가격이 '~원부터'로 보입니다.</p></div>` : ''}
      <div class="card"><h2>상품 사진</h2><p class="h-sub">첫 번째 사진이 대표 사진입니다. 화살표로 순서를 바꾸세요. 정사각형(1000×1000)이 가장 잘 보입니다.</p><div class="thumbs" id="imgs"></div><div class="actions static"><button class="btn sm" id="p-add" type="button">사진 추가</button></div></div>
      <div class="actions"><button class="btn ok" id="p-save">저장하기</button><a class="btn" href="#/products/${p.id}/detail">상세페이지 고치기</a><a class="btn" href="/product-${p.id}.html" target="_blank" rel="noopener">상품 페이지 보기 ↗</a></div>`;
    const drawImgs = () => {
      $('#imgs').innerHTML = imgs.map((x, i) => `<figure class="${i ? '' : 'first'}"><img src="${h(x.data || site(x.src))}" alt=""><figcaption><button class="btn sm" data-mv="${i}" data-d="-1" ${i ? '' : 'disabled'}>←</button><button class="btn sm danger" data-rm="${i}">삭제</button><button class="btn sm" data-mv="${i}" data-d="1" ${i < imgs.length - 1 ? '' : 'disabled'}>→</button></figcaption></figure>`).join('');
      $('#imgs').querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const i = +b.dataset.mv, j = i + +b.dataset.d; [imgs[i], imgs[j]] = [imgs[j], imgs[i]]; dirty = true; drawImgs(); });
      $('#imgs').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { if (imgs.length < 2) return toast('사진은 한 장 이상 있어야 합니다'); imgs.splice(+b.dataset.rm, 1); dirty = true; drawImgs(); });
    };
    drawImgs(); v.addEventListener('input', () => { dirty = true; });
    $('#p-add').onclick = async () => { try { for (const f of await pickFiles(true)) { const x = await prepImage(f, 1000); imgs.push({ data: x.data }); } dirty = true; drawImgs(); } catch (e) { fail(e); } };
    $('#p-save').onclick = async () => {
      const product = { name: $('#p-name').value, short: $('#p-short').value, summary: $('#p-sum').value, store: $('#p-store').value, list: o ? 0 : $('#p-list').value, price: o ? 0 : $('#p-price').value,
        badges: [...v.querySelectorAll('.p-badge:checked')].map(x => x.value), points: $('#p-points').value.split('\n'), imgs: imgs.map(x => x.data ? { data: x.data } : x.src) };
      const options29 = o ? { price: {}, list: {} } : null;
      if (o) v.querySelectorAll('[data-op]').forEach(i => { options29[i.dataset.op][i.dataset.k] = +i.value; });
      $('#p-save').disabled = true;
      try { const r = await api('POST', `/api/admin/products/${id}`, { product, options29 }); saved(r, '상품 정보를'); productEdit(id); } catch (e) { fail(e); } finally { $('#p-save').disabled = false; }
    };
  }

  async function detailEdit(id) {
    const v = shell('상품', { back: ['#/products', '상품 목록'] });
    const [{ items: raw }, { product: p }] = await Promise.all([api('GET', `/api/admin/detail/${id}`), api('GET', `/api/admin/products/${id}`)]);
    $('#ttl').textContent = p.short;
    let items = raw.map(x => ({ ...x, key: tmpId(), text: x.t === 't' ? (x.text || []).join('\n') : undefined }));
    v.innerHTML = `${ptabs(id, 'detail')}<div class="card"><h2>상세페이지</h2><p class="h-sub">상품 페이지 아래 '상세정보'에 위에서부터 이 순서로 보입니다. ↑↓ 로 순서를 바꾸고, '이 아래에 추가'로 사진이나 글을 끼워 넣습니다. 사진 설명은 검색엔진과 화면 낭독기가 읽습니다(무엇이 보이는지 한 문장).</p>
      <div class="items" id="items"></div>
      <div class="actions static"><button class="btn sm" id="d-img">맨 아래에 사진 추가</button><button class="btn sm" id="d-txt">맨 아래에 글 추가</button></div></div>
      <div class="actions"><button class="btn ok" id="d-save">저장하기</button><a class="btn" href="#/products/${id}">기본 정보 고치기</a><a class="btn" href="/product-${id}.html#detail" target="_blank" rel="noopener">상품 페이지 보기 ↗</a></div>`;
    const addImgs = async at => { try { const files = await pickFiles(true); const add = []; for (const f of files) { const x = await prepImage(f, 1000); add.push({ t: 'i', data: x.data, w: x.w, h: x.h, alt: '', key: tmpId() }); } items.splice(at, 0, ...add); dirty = true; draw(); } catch (e) { fail(e); } };
    const draw = () => {
      $('#items').innerHTML = items.map((x, i) => {
        const pic = x.t === 'i' ? `<img class="pic" src="${h(x.data || site(x.src))}" alt="" loading="lazy">` : x.t === 'v' ? `<img class="pic" src="${h(site(x.poster))}" alt="">` : x.t === 'y' ? `<img class="pic" src="${h(site(x.poster))}" alt="">` : '<div class="txt">글</div>';
        const body = x.t === 'i' ? `<label style="margin:0 0 4px">사진 설명</label><input type="text" data-alt="${i}" value="${h(x.alt)}" placeholder="예: 3단 접이식 매트리스를 접어 세운 모습">${x.data ? '<p class="help">새로 추가한 사진(저장하면 올라갑니다)</p>' : ''}`
          : x.t === 't' ? `<label style="margin:0 0 4px">글</label><textarea data-txt="${i}" style="min-height:90px">${h(x.text)}</textarea>`
          : `<p class="help">${x.t === 'v' ? '움직이는 영상(순서만 바꾸거나 뺄 수 있습니다)' : '유튜브 영상'}</p>`;
        return `<div class="item"><div>${pic}</div><div>${body}</div><div class="ctl"><button class="btn sm" data-mv="${i}" data-d="-1" ${i ? '' : 'disabled'}>↑</button><button class="btn sm" data-mv="${i}" data-d="1" ${i < items.length - 1 ? '' : 'disabled'}>↓</button><button class="btn sm" data-ai="${i}">이 아래에 사진 추가</button><button class="btn sm" data-at="${i}">이 아래에 글 추가</button><button class="btn sm danger" data-rm="${i}">빼기</button></div></div>`;
      }).join('') || '<p class="help">아직 항목이 없습니다. 사진을 추가하세요.</p>';
      const box = $('#items');
      box.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const i = +b.dataset.mv, j = i + +b.dataset.d; [items[i], items[j]] = [items[j], items[i]]; dirty = true; draw(); });
      box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { items.splice(+b.dataset.rm, 1); dirty = true; draw(); });
      box.querySelectorAll('[data-ai]').forEach(b => b.onclick = () => addImgs(+b.dataset.ai + 1));
      box.querySelectorAll('[data-at]').forEach(b => b.onclick = () => { items.splice(+b.dataset.at + 1, 0, { t: 't', text: '', key: tmpId() }); dirty = true; draw(); });
      box.querySelectorAll('[data-alt]').forEach(i => i.oninput = () => { items[+i.dataset.alt].alt = i.value; dirty = true; });
      box.querySelectorAll('[data-txt]').forEach(i => i.oninput = () => { items[+i.dataset.txt].text = i.value; dirty = true; });
    };
    draw();
    $('#d-img').onclick = () => addImgs(items.length);
    $('#d-txt').onclick = () => { items.push({ t: 't', text: '', key: tmpId() }); dirty = true; draw(); };
    $('#d-save').onclick = async () => {
      $('#d-save').disabled = true;
      try {
        const r = await api('POST', `/api/admin/detail/${id}`, { items: items.map(x => x.t === 't' ? { t: 't', text: x.text } : x.data ? { t: 'i', data: x.data, w: x.w, h: x.h, alt: x.alt } : { t: x.t, src: x.src, id: x.id, alt: x.alt }) });
        saved(r, '상세페이지를'); detailEdit(id);
      } catch (e) { fail(e); } finally { $('#d-save').disabled = false; }
    };
  }

  // ── 관리자 전용
  async function settings() {
    const v = shell('소유확인·추적 코드', { desc: '검색엔진 소유확인 값과 방문 분석 도구 ID. 저장하면 모든 페이지에 들어갑니다.' });
    const { tags } = await api('GET', '/api/admin/settings');
    const F = [['naverSiteVerification', '네이버 서치어드바이저 소유확인', 'meta 태그의 content 값'], ['googleSiteVerification', '구글 서치콘솔 소유확인', 'google-site-verification 의 content 값'], ['bingSiteVerification', 'Bing 웹마스터 소유확인', 'msvalidate.01 의 content 값'],
      ['gtm', 'Google 태그 관리자(GTM)', 'GTM-XXXXXXX'], ['ga4', 'GA4 측정 ID', 'G-XXXXXXXXXX (GTM 안에서 GA4 를 켰다면 비워 두기 — 이중 집계)'], ['naverAnalytics', '네이버 애널리틱스', '사이트 ID(wcs_add["wa"] 값)']];
    v.innerHTML = `<div class="card">${F.map(([k, t, ph]) => `<label for="s-${k}">${t} <small>${ph}</small></label><input type="text" id="s-${k}" value="${h(tags[k])}">`).join('')}
      <p class="help">저장하면 모든 페이지 &lt;head&gt;·&lt;body&gt; 에 들어갑니다. 비운 항목은 넣지 않습니다.</p></div><div class="actions"><button class="btn ok" id="s-save">저장하기</button></div>`;
    $('#s-save').onclick = async () => { try { const r = await api('POST', '/api/admin/settings', { tags: Object.fromEntries(F.map(([k]) => [k, $('#s-' + k).value])) }); saved(r, '설정을'); } catch (e) { fail(e); } };
  }
  async function topics() {
    const v = shell('블로그 자동 발행', { desc: '위에서부터 하루 세 편(09·13·18시) AI 가 글을 씁니다.' });
    const [{ topics: list }, { products }] = await Promise.all([api('GET', '/api/admin/topics'), api('GET', '/api/admin/products')]);
    let todo = list.filter(t => t.status === 'todo'); const done = list.filter(t => t.status !== 'todo');
    const draw = () => {
      v.innerHTML = `<div class="box info">매일 09·13·18시에 위에서부터 한 편씩 AI 가 글을 씁니다(GitHub 시크릿 ANTHROPIC_API_KEY 필요). 남은 주제 <b>${todo.length}편</b> · 발행 완료 ${done.length}편. 대표 키워드는 글마다 하나, 이미 쓴 키워드와 겹치지 않게.</div>
        <div class="card"><table class="list"><thead><tr><th>#</th><th>대표 키워드</th><th>가제</th><th>분류</th><th>상품</th><th></th></tr></thead><tbody>${todo.map((t, i) => `<tr><td>${i + 1}</td><td><input type="text" data-f="keyword" data-i="${i}" value="${h(t.keyword)}"></td><td><input type="text" data-f="title" data-i="${i}" value="${h(t.title)}"></td>
          <td><select data-f="category" data-i="${i}">${ME.categories.map(c => `<option ${c === t.category ? 'selected' : ''}>${c}</option>`).join('')}</select></td><td><select data-f="product" data-i="${i}"><option value="">-</option>${products.map(p => `<option value="${p.id}" ${String(p.id) === String(t.product) ? 'selected' : ''}>${h(p.short)}</option>`).join('')}</select></td>
          <td class="nw"><button class="btn sm" data-mv="${i}" data-d="-1">↑</button><button class="btn sm" data-mv="${i}" data-d="1">↓</button><button class="btn sm danger" data-rm="${i}">빼기</button></td></tr>`).join('')}</tbody></table>
        <div class="actions static"><button class="btn sm" id="t-add">주제 추가</button></div></div>
        <div class="actions"><button class="btn ok" id="t-save">저장하기</button></div>`;
      v.querySelectorAll('[data-f]').forEach(i => i.oninput = i.onchange = () => { const t = todo[+i.dataset.i]; t[i.dataset.f] = i.dataset.f === 'product' ? (i.value ? +i.value : undefined) : i.value; dirty = true; });
      v.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const i = +b.dataset.mv, j = i + +b.dataset.d; if (j < 0 || j >= todo.length) return; [todo[i], todo[j]] = [todo[j], todo[i]]; dirty = true; draw(); });
      v.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { todo.splice(+b.dataset.rm, 1); dirty = true; draw(); });
      $('#t-add').onclick = () => { todo.push({ id: '', keyword: '', title: '', category: ME.categories[0], status: 'todo' }); dirty = true; draw(); };
      $('#t-save').onclick = async () => { try { const r = await api('POST', '/api/admin/topics', { topics: [...done, ...todo] }); saved(r, '대기열을'); topics(); } catch (e) { fail(e); } };
    };
    draw();
  }
  async function check() {
    const v = shell('키워드 점검', { desc: '발행 글과 대기열의 대표 키워드·제목이 서로 겹치지 않는지 봅니다.' });
    const r = await api('GET', '/api/admin/check');
    v.innerHTML = `<div class="card"><p>발행 글 ${r.posts}편 · 대기열 ${r.todo}편 · 마지막 발행 ${h(r.last || '-')}</p>${r.warn.length ? `<div class="box warn"><ul>${r.warn.map(w => `<li>${h(w)}</li>`).join('')}</ul></div>` : '<div class="box ok">겹치는 대표 키워드·비슷한 제목이 없습니다.</div>'}
      <p class="help">AI 노출도 일일 측정과 주간·월간 리포트는 관리자 PC(3. 잠스쿨/측정, 보고 폴더)에 쌓입니다.</p></div>`;
  }
  async function log() {
    const v = shell('작업 기록', { desc: '사이트 저장소에 들어간 변경(어드민 저장·자동 발행·개발 작업) 전체.' });
    const { commits } = await api('GET', '/api/admin/log');
    v.innerHTML = `<div class="card"><table class="list"><thead><tr><th>시간</th><th>내용</th><th>누가</th></tr></thead><tbody>${commits.map(c => `<tr><td class="nw">${h(new Date(c.date).toLocaleString('ko-KR'))}</td><td>${h(c.message.split('\n')[0])}</td><td>${h(c.author)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  async function users() {
    const v = shell('계정 관리', { desc: '관리자·클라이언트 계정. 비밀번호는 새로 만들 때 한 번만 보입니다.' });
    const { users: list, canWrite } = await api('GET', '/api/admin/users');
    v.innerHTML = `${canWrite ? '' : '<div class="box warn">계정 추가·비밀번호 변경은 Railway 볼륨(DATA_DIR) 연결 뒤에 됩니다. 지금은 Railway 변수 ADMIN_USERS 로 읽기만 합니다.</div>'}
      <div id="pwbox"></div><div class="card"><table class="list"><thead><tr><th>아이디</th><th>이름</th><th>권한</th><th></th></tr></thead><tbody>${list.map(u => `<tr><td>${h(u.id)}</td><td>${h(u.name)}</td><td>${u.role === 'owner' ? '<span class="tag ai">관리자</span>' : '<span class="tag">클라이언트</span>'}</td>
        <td>${canWrite ? `<button class="btn sm" data-reset="${h(u.id)}">비밀번호 새로 만들기</button> ${u.id === ME.user.id ? '' : `<button class="btn sm danger" data-del="${h(u.id)}">삭제</button>`}` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${canWrite ? `<div class="card"><h2>계정 추가</h2><div class="row"><div><label for="u-id">아이디</label><input type="text" id="u-id" placeholder="영문 소문자·숫자"></div><div><label for="u-name">이름</label><input type="text" id="u-name"></div><div><label for="u-role">권한</label><select id="u-role"><option value="client">클라이언트</option><option value="owner">관리자</option></select></div></div><div class="actions static"><button class="btn pri" id="u-add">추가하기</button></div></div>` : ''}`;
    const showPw = (id, pw) => { $('#pwbox').innerHTML = `<div class="box ok"><b>${h(id)}</b> 계정의 새 비밀번호: <span class="pw">${h(pw)}</span><p class="help">지금 한 번만 보입니다. 본인에게 안전하게 전달하고, 첫 로그인 뒤 '내 계정'에서 바꾸게 하세요.</p></div>`; };
    v.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => { if (!confirm(`${b.dataset.reset} 의 비밀번호를 새로 만들까요? 지금 비밀번호는 바로 막힙니다.`)) return; try { const r = await api('POST', '/api/admin/users', { action: 'reset', id: b.dataset.reset }); showPw(b.dataset.reset, r.password); } catch (e) { fail(e); } });
    v.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm(`${b.dataset.del} 계정을 삭제할까요?`)) return; try { await api('POST', '/api/admin/users', { action: 'delete', id: b.dataset.del }); users(); } catch (e) { fail(e); } });
    const add = $('#u-add'); if (add) add.onclick = async () => { try { const id = $('#u-id').value.trim(); const r = await api('POST', '/api/admin/users', { action: 'create', id, name: $('#u-name').value, role: $('#u-role').value }); await users(); showPw(id, r.password); } catch (e) { fail(e); } };
  }
  async function me() {
    const v = shell('내 계정');
    v.innerHTML = `<div class="card"><p>${h(ME.user.name)} (${h(ME.user.id)}) · ${h(ME.user.roleName)}</p>${ME.canWriteUsers ? `<h2>비밀번호 바꾸기</h2>
      <label for="m-cur">지금 비밀번호</label><input type="password" id="m-cur" autocomplete="current-password"><label for="m-new">새 비밀번호 <small>10자 이상, 영문·숫자 섞기</small></label><input type="password" id="m-new" autocomplete="new-password">
      <div class="actions static"><button class="btn pri" id="m-save">바꾸기</button></div>` : '<p class="help">비밀번호 변경은 관리자에게 요청해 주세요.</p>'}</div>`;
    const b = $('#m-save'); if (b) b.onclick = async () => { try { await api('POST', '/api/admin/me/password', { current: $('#m-cur').value, next: $('#m-new').value }); toast('비밀번호를 바꿨습니다. 다시 로그인해 주세요.'); ME.user = null; setTimeout(render, 1200); } catch (e) { fail(e); } };
  }

  // ── 길 찾기
  async function render() {
    if (!ME.user) return loginView();
    const [a, b] = route();
    const owner = ME.user.role === 'owner';
    try {
      if (a === 'blog' && b === 'new') await blogEdit(null);
      else if (a === 'blog' && b === 'edit') await blogEdit(route()[2]);
      else if (a === 'blog') await blogList();
      else if (a === 'products' && b && route()[2] === 'detail') await detailEdit(b);
      else if (a === 'products' && b) await productEdit(b);
      else if (a === 'products') await productList();
      else if (a === 'detail') { location.replace(b ? `#/products/${b}/detail` : '#/products'); return; }
      else if (a === 'traffic') await traffic();
      else if (a === 'orders') await orders();
      else if (a === 'me') await me();
      else if (owner && a === 'settings') await settings();
      else if (owner && a === 'topics') await topics();
      else if (owner && a === 'check') await check();
      else if (owner && a === 'log') await log();
      else if (owner && a === 'users') await users();
      else await dashboard();
    } catch (e) { if (ME.user) { const v = $('#view'); if (v) v.innerHTML = `<div class="box bad">${h(e.message)}</div>`; } }
  }
  let lastHash = location.hash;
  window.addEventListener('hashchange', () => {
    if (dirty && !confirm('저장하지 않은 내용이 있습니다. 이 화면을 떠날까요?')) { history.replaceState(null, '', lastHash); return; }
    dirty = false; lastHash = location.hash; render();
  });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  async function boot() { ME = await api('GET', '/api/admin/me'); render(); }
  boot().catch(e => { $('#app').innerHTML = `<p class="boot">${h(e.message)}</p>`; });
})();
