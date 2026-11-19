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
  // ratio(가로/세로)를 주면 가운데를 그 비율로 잘라서 올린다(예: 1 = 정사각형)
  async function prepImage(file, maxW, ratio) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('JPG·PNG·WebP·GIF 사진만 올릴 수 있습니다');
    const url = await readURL(file), img = await loadImg(url);
    if (file.type === 'image/gif') { if (file.size > 8e6) throw new Error('GIF 는 8MB 이하로 올려 주세요'); return { data: url, w: img.naturalWidth, h: img.naturalHeight }; }
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (ratio) { if (sw / sh > ratio) { const nw = Math.round(sh * ratio); sx = Math.round((sw - nw) / 2); sw = nw; } else { const nh = Math.round(sw / ratio); sy = Math.round((sh - nh) / 2); sh = nh; } }
    const s = Math.min(1, maxW / sw), w = Math.round(sw * s), ht = Math.round(sh * s);
    const c = document.createElement('canvas'); c.width = w; c.height = ht;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, ht); x.drawImage(img, sx, sy, sw, sh, 0, 0, w, ht);
    return { data: c.toDataURL('image/jpeg', 0.86), w, h: ht };
  }
  function pickFiles(multiple) {
    return new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/jpeg,image/png,image/webp,image/gif'; i.multiple = multiple; i.onchange = () => ok([...i.files]); i.click(); });
  }
  const site = p => '/' + String(p || '').replace(/^\//, '');
  const tmpId = () => Math.random().toString(36).slice(2, 9);

  // ── 화면 틀(메뉴는 글자만)
  const NAV = [
    ['현황', [['', '홈'], ['traffic', '방문·유입'], ['payments', '결제 주문'], ['orders', '주문 흐름']]],
    ['사이트 꾸미기', [['site/home', '홈 화면'], ['texts', '페이지 문구·사진'], ['products', '상품·상세페이지'], ['site/reviews', '구매평'], ['site/faq', '자주 묻는 질문'], ['site/info', '기본 정보']]],
    ['글', [['blog', '블로그']]],
  ];
  const OWNER_NAV = [['settings', '소유확인·추적 코드'], ['topics', '블로그 자동 발행'], ['check', '키워드 점검'], ['log', '작업 기록'], ['users', '계정 관리'], ['data', '서버·데이터 옮기기']];
  const route = () => location.hash.replace(/^#\/?/, '').split('/');
  // shell(제목, { desc: 제목 아래 한 줄, tool: 오른쪽 버튼, back: [주소, 글자] })
  function shell(title, o = {}) {
    const cur = route().join('/'), isOwner = ME.user.role === 'owner';
    const on = k => k === '' ? cur === '' : cur === k || cur.startsWith(k + '/');
    const link = ([k, t]) => `<a href="#/${k}" class="${on(k) ? 'on' : ''}">${t}</a>`;
    $('#app').innerHTML = `<div class="shell"><aside class="side" id="side"><a class="brand" href="#/"><img src="/assets/img/brand/logo.png" alt="잠스쿨"><span>관리자</span></a>
      <button class="navbtn" id="navbtn" type="button" aria-expanded="false" aria-controls="side-nav"><span>메뉴</span></button>
      <nav id="side-nav">${NAV.map(([g, list]) => `<p class="grp">${g}</p>${list.map(link).join('')}`).join('')}
        ${isOwner ? `<p class="grp own">총괄 관리자 전용</p>${OWNER_NAV.map(link).join('')}` : ''}
        <div class="bottom">${link(['me', '내 계정'])}<a href="/" target="_blank" rel="noopener">사이트 보기 ↗</a><a href="#" id="logout">로그아웃</a></div></nav>
      <p class="who"><b>${h(ME.user.name)}</b>${h(ME.user.roleName)} · ${h(ME.user.id)}</p></aside>
      <main class="main"><div class="top"><div class="tt">${o.back ? `<a class="back" href="${o.back[0]}">← ${h(o.back[1])}</a>` : ''}<h1 id="ttl">${h(title)}</h1>${o.desc ? `<p>${o.desc}</p>` : ''}</div>${o.tool || ''}<span id="deploy" class="deploy ${deploy.state}" ${deploy.text ? '' : 'hidden'}>${h(deploy.text)}</span></div>
      ${!ME.storeReady ? '<div class="box bad">저장소 연결이 안 되어 있어 저장할 수 없습니다. 관리자에게 알려 주세요(Railway 변수 GITHUB_TOKEN).</div>' : ''}
      <div id="view"><p class="help">불러오는 중…</p></div></main></div>`;
    // 휴대폰: 메뉴 버튼으로 펼치고, 메뉴를 고르면 닫는다
    $('#navbtn').onclick = () => { const open = $('#side').classList.toggle('open'); $('#navbtn').setAttribute('aria-expanded', open); $('#navbtn span').textContent = open ? '닫기' : '메뉴'; };
    hideTip();
    $('#side-nav').addEventListener('click', e => { if (e.target.closest('a')) $('#side').classList.remove('open'); });
    $('#logout').onclick = async e => { e.preventDefault(); await api('POST', '/api/admin/logout').catch(() => {}); ME.user = null; render(); };
    return $('#view');
  }

  function loginView() {
    $('#app').innerHTML = `<div class="login-wrap"><div class="login-art" style="background-image:url(/assets/img/scenes/sleep-side.jpg)"></div>
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
  const PERIODS = [['1', '오늘'], ['7', '최근 7일'], ['30', '최근 30일'], ['90', '최근 90일']];
  const period = base => { const n = PERIODS.some(([k]) => k === route()[1]) ? route()[1] : '7'; return { n, seg: `<div class="seg">${PERIODS.map(([k, t]) => `<a href="#/${base}/${k}" class="${k === n ? 'on' : ''}">${t}</a>`).join('')}</div>` }; };
  const PAGE_NAME = { '/': '첫 화면', '/shop': '전체 상품', '/blog/': '수면 가이드(블로그 목록)', '/cart': '장바구니', '/checkout': '주문서', '/order-complete': '주문 완료' };
  const pageName = (p, s) => { const m = p.match(/^\/product-(\d+)$/); return h(PAGE_NAME[p] || (m && s.names[m[1]] ? `상품 · ${s.names[m[1]]}` : '') || (s.titles[p] ? `글 · ${s.titles[p]}` : '') || p) + ` <small class="sub">${h(p)}</small>`; };
  const persistNote = s => s.persistent || ME.user.role !== 'owner' ? '' : '<div class="box warn">Railway 볼륨(DATA_DIR)이 아직 없어 방문 숫자가 메모리에만 있습니다. 다시 배포하면 0부터 셉니다.</div>';

  // ── 홈: 방문·결제만 간단히(숫자 4개 · 14일 방문자 선 그래프 · 14일 결제 금액 막대 · 최근 결제 주문 · 유입 상위 5)
  // 막대 그래프(한 계열): vals[i] 값, extra(i) 말풍선에 더할 줄. 막대마다 마우스·키보드로 그날 숫자
  function barChart(box, dates, vals, opt = {}) {
    const draw = () => {
      box.textContent = '';
      const W = Math.max(300, box.clientWidth), H = W < 520 ? 210 : 250, L = 50, R = 8, T = 14, B = 28, n = dates.length;   // 선 그래프와 같은 높이
      const max = nice(Math.max(opt.min || 1, ...vals)), bw = (W - L - R) / n, w = Math.max(3, Math.min(26, bw * .6));
      const y = v => T + (H - T - B) * (1 - v / max), fmtA = opt.axis || (v => num(v));
      const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lc', role: 'img', 'aria-label': opt.label || '막대 그래프' });
      for (const f of [0, .5, 1]) {
        svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y(max * f), y2: y(max * f), class: f ? 'grid' : 'base' }));
        const t = svgEl('text', { x: L - 8, y: y(max * f) + 4, 'text-anchor': 'end' }); t.textContent = fmtA(max * f); svg.appendChild(t);
      }
      const every = Math.ceil(n / (W < 520 ? 5 : 8));
      dates.forEach((d, i) => {
        if (i % every && i !== n - 1) return; if (i !== n - 1 && n - 1 - i < every / 2) return;
        const t = svgEl('text', { x: L + i * bw + bw / 2, y: H - 8, 'text-anchor': 'middle' }); t.textContent = md(d); svg.appendChild(t);
      });
      vals.forEach((v, i) => {
        const x0 = L + i * bw + (bw - w) / 2, y0 = y(v), hh = H - B - y0, r = Math.min(4, w / 2, hh);
        if (v > 0) svg.appendChild(svgEl('path', { d: `M${x0},${H - B} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + w - r} Q${x0 + w},${y0} ${x0 + w},${y0 + r} V${H - B} Z`, fill: opt.color || C1, class: 'bar-m' }));
        const hit = svgEl('rect', { x: L + i * bw, y: T, width: bw, height: H - T - B, fill: 'transparent', tabindex: 0, class: 'hit', 'aria-label': `${dates[i]} ${opt.name} ${opt.fmt ? opt.fmt(v) : num(v)}` });
        const show = e => { hit.setAttribute('fill', 'rgba(21,24,28,.04)'); showTip(e, [[opt.color || C1, opt.name, opt.fmt ? opt.fmt(v) : num(v)], ...(opt.extra ? opt.extra(i) : [])], `${dates[i]} (${WD[wdOf(dates[i])]})`); };
        const hide = () => { hit.setAttribute('fill', 'transparent'); hideTip(); };
        hit.addEventListener('pointerenter', show); hit.addEventListener('pointermove', show); hit.addEventListener('focus', show);
        hit.addEventListener('pointerleave', hide); hit.addEventListener('blur', hide);
        svg.appendChild(hit);
      });
      box.appendChild(svg);
    };
    draw();
    return draw;
  }
  // 표에 쓸 짧은 상품 이름: '잠스쿨 '·옵션 괄호 빼고 × 수량만
  const shortItem = t => String(t || '').replace(/^잠스쿨\s*/, '').replace(/\s*\([^)]*\)/, '');
  async function dashboard() {
    const v = shell(`${ME.user.name}님, 안녕하세요`, { desc: '오늘 방문과 결제를 한눈에 봅니다. 자세한 내용은 각 그래프의 \'자세히\'에서 봅니다.' });
    const from = new Date(Date.now() + 9 * 3600e3 - 13 * 864e5).toISOString().slice(0, 10);
    const [s, p] = await Promise.all([api('GET', '/api/admin/stats?days=14').catch(() => null), api('GET', `/api/admin/payments?from=${from}`).catch(() => null)]);
    const days = s ? s.days : [], dates = days.map(d => d.date);
    const today = days[days.length - 1] || { uv: 0, pv: 0 }, yday = days[days.length - 2] || { uv: 0 };
    const last7 = days.slice(-7), prev7 = days.slice(-14, -7), u7 = last7.reduce((a, d) => a + d.uv, 0), up7 = prev7.reduce((a, d) => a + d.uv, 0);
    const orders = p ? p.orders : [], paid = orders.filter(o => o.status === 'paid'), tday = dates[dates.length - 1] || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const paidToday = paid.filter(o => o.day === tday);
    const payBy = dates.map(dt => paid.filter(o => o.day === dt)), paySum = payBy.map(l => l.reduce((a, o) => a + o.amount, 0));
    const src7 = sumObj(last7.map(d => d.sources)), ent7 = last7.reduce((a, d) => a + d.entries, 0);
    const recent = orders.slice(0, 5);
    v.innerHTML = `${s ? persistNote(s) : ''}<div class="kpis">
        <div class="kpi"><span>오늘 방문자</span><b>${num(today.uv)}명</b><small>${delta(today.uv, yday.uv)} 어제 ${num(yday.uv)}명</small></div>
        <div class="kpi"><span>최근 7일 방문자</span><b>${num(u7)}명</b><small>${delta(u7, up7)} 직전 7일 ${num(up7)}명</small></div>
        <div class="kpi"><span>오늘 결제</span><b>${num(paidToday.length)}건</b><small>${won(paidToday.reduce((a, o) => a + o.amount, 0))}</small></div>
        <div class="kpi"><span>발송 전 주문</span><b>${num(p ? p.todo : 0)}건</b><small>${p && p.todo ? '<a href="#/payments" id="go-todo">보낼 주문 보기 →</a>' : '보낼 주문 없음'}</small></div></div>
      <div class="cols"><div class="card"><div class="ch"><div><h2>방문자</h2><p class="h-sub">최근 14일 · 마우스를 올리면 그날 숫자</p></div><a class="btn sm" href="#/traffic/30">자세히</a></div><div class="lcbox" id="d-visit">${s ? '' : empty('방문 기록을 불러오지 못했습니다.')}</div></div>
        <div class="card"><div class="ch"><div><h2>결제 금액</h2><p class="h-sub">최근 14일 결제 완료(취소 제외) · 14일 합계 ${won(paySum.reduce((a, b) => a + b, 0))}</p></div><a class="btn sm" href="#/payments">자세히</a></div><div class="lcbox" id="d-pay"></div></div></div>
      <div class="cols"><div class="card"><div class="ch"><div><h2>최근 결제 주문</h2><p class="h-sub">최근 14일 중 최신 5건</p></div><a class="btn sm" href="#/payments">결제 주문</a></div>
          ${recent.length ? `<table class="list rtbl"><thead><tr><th>일시</th><th>상품</th><th class="r">금액</th><th>상태</th></tr></thead><tbody>${recent.map(o => `<tr><td class="nw">${h(md(o.day))} ${h(o.time)}</td><td class="ell"><a href="#/payments/${h(o.moid)}" title="${h(o.items.join(', '))}">${h(shortItem(o.items[0]))}${o.items.length > 1 ? ` 외 ${o.items.length - 1}건` : ''}</a></td><td class="r nw">${won(o.amount)}</td><td class="nw"><span class="tag ${PST[o.status] || ''}">${h(o.statusName)}</span>${o.status === 'paid' ? ` <span class="tag ${o.fulfil === 'shipped' ? 'live' : 'draft'}">${o.fulfil === 'shipped' ? '발송함' : '발송 전'}</span>` : ''}</td></tr>`).join('')}</tbody></table>` : empty('최근 14일 결제 주문이 없습니다.')}</div>
        <div class="card"><div class="ch"><div><h2>어디서 왔나</h2><p class="h-sub">최근 7일 · 들어온 경로 상위 5</p></div><a class="btn sm" href="#/traffic/7">자세히</a></div>${bars(top(src7, 5), ent7)}</div></div>`;
    const gt = $('#go-todo'); if (gt) gt.onclick = e => { e.preventDefault(); PAYF.range = 'all'; PAYF.st = 'todo'; location.hash = '#/payments'; };
    const draws = [];
    if (s) draws.push(lineChart($('#d-visit'), dates, [{ name: '방문자', color: C1, area: true, on: true, values: days.map(d => d.uv) }], { label: '최근 14일 방문자 선 그래프' }));
    draws.push(barChart($('#d-pay'), dates, paySum, { name: '결제 금액', label: '최근 14일 결제 금액 막대 그래프', fmt: won, axis: x => x >= 10000 ? `${Math.round(x / 1000) / 10}만` : num(x), min: 100000, extra: i => [[CG, '결제 건수', `${payBy[i].length}건`]] }));
    const here = location.hash;
    let rt; window.onresize = () => { clearTimeout(rt); rt = setTimeout(() => { if (location.hash !== here) { window.onresize = null; return; } draws.forEach(f => f()); }, 150); };
  }

  // ── 방문·유입(움직이는 그래프): 날짜별 선 그래프(마우스를 올리면 그날 숫자, 누르면 그날만 보기) · 유입 경로 레이더 · 요일 레이더 · 기기 도넛
  //   색: 이번 기간 파랑 · 지난 기간 주황(점선) · 셋째 초록 — 색만으로 구분하지 않게 범례·숫자를 함께 둔다
  const C1 = '#2a78d6', C2 = '#eb6834', C3 = '#1baf7a', CG = '#98A1AC';
  const SVGNS = 'http://www.w3.org/2000/svg';
  let tipEl = null;
  function showTip(e, rows, title) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('role', 'status'); document.body.appendChild(tipEl); }
    tipEl.textContent = '';
    if (title) { const t = document.createElement('p'); t.className = 'tip-t'; t.textContent = title; tipEl.appendChild(t); }
    for (const [c, label, val, dash] of rows) {
      const p = document.createElement('p'), k = document.createElement('i'), b = document.createElement('b'), s = document.createElement('span');
      k.style.borderTopColor = c; if (dash) k.style.borderTopStyle = 'dashed'; b.textContent = val; s.textContent = label; p.append(k, b, s); tipEl.appendChild(p);
    }
    tipEl.hidden = false;
    const r = e.clientX != null ? { x: e.clientX, y: e.clientY } : (() => { const b = e.target.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top }; })();
    const w = tipEl.offsetWidth, ht = tipEl.offsetHeight;
    tipEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.x + 14)) + 'px';
    tipEl.style.top = Math.max(8, r.y - ht - 12 < 8 ? r.y + 18 : r.y - ht - 12) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.hidden = true; }
  const svgEl = (tag, attrs = {}) => { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  const delta = (a, b) => {
    if (!b) return a ? '<em class="dl up">새로 생김</em>' : '<em class="dl">변화 없음</em>';
    const d = Math.round((a - b) / b * 1000) / 10;
    return d === 0 ? '<em class="dl">변화 없음</em>' : `<em class="dl ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</em>`;
  };
  // 유입 경로 묶음(레이더 축) — stats.mjs source() 의 이름을 8개 축으로
  const SRC_AX = [['네이버 검색', ['네이버 검색']], ['네이버 블로그·카페', ['네이버(블로그·카페·쇼핑)']], ['구글', ['구글']], ['직접 방문', ['직접 방문']], ['SNS·영상', ['SNS·영상']], ['AI 답변', ['AI 답변']], ['공식몰·스토어', ['공식몰·스마트스토어']], ['그 밖', null]];
  const srcProfile = sources => { const out = SRC_AX.map(() => 0); for (const [k, c] of Object.entries(sources || {})) { let i = SRC_AX.findIndex(([, ks]) => ks && ks.includes(k)); if (i < 0) i = SRC_AX.length - 1; out[i] += c; } return out; };
  const WD = ['월', '화', '수', '목', '금', '토', '일'];
  const wdOf = date => (new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay() + 6) % 7;
  const weekdayAvg = days => { const s = Array(7).fill(0), c = Array(7).fill(0); for (const d of days) { const w = wdOf(d.date); s[w] += d.uv; c[w]++; } return s.map((x, i) => c[i] ? Math.round(x / c[i] * 10) / 10 : 0); };
  const sumObj = list => list.reduce((a, o) => { for (const [k, x] of Object.entries(o || {})) a[k] = (a[k] || 0) + x; return a; }, {});

  // 선 그래프: series [{ key, name, color, dash, area, values[], on }]. onPick(i) 날짜 누름
  function lineChart(box, dates, series, opt = {}) {
    const draw = () => {
      box.textContent = '';
      const W = Math.max(300, box.clientWidth), H = W < 520 ? 210 : 250, L = 40, R = 12, T = 14, B = 28, n = dates.length;
      const vis = series.filter(s => s.on);
      const max = nice(Math.max(2, ...vis.flatMap(s => s.values)));
      const x = i => n < 2 ? (L + W - R) / 2 : L + i * (W - L - R) / (n - 1), y = v => T + (H - T - B) * (1 - v / max);
      const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lc', role: 'img', 'aria-label': opt.label || '날짜별 그래프' });
      for (const f of max >= 8 ? [0, .25, .5, .75, 1] : [0, .5, 1]) {
        svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y(max * f), y2: y(max * f), class: f ? 'grid' : 'base' }));
        const t = svgEl('text', { x: L - 8, y: y(max * f) + 4, 'text-anchor': 'end' }); t.textContent = num(Math.round(max * f * 10) / 10); svg.appendChild(t);
      }
      const every = Math.ceil(n / (W < 520 ? 5 : 9));
      dates.forEach((d, i) => { if (i % every && i !== n - 1) return; if (i !== n - 1 && n - 1 - i < every / 2) return; const t = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': i === n - 1 && n > 1 ? 'end' : i === 0 ? 'start' : 'middle' }); t.textContent = md(d); svg.appendChild(t); });
      if (opt.pick != null) svg.appendChild(svgEl('rect', { x: x(opt.pick) - Math.max(6, (W - L - R) / Math.max(1, n - 1) / 2), y: T, width: Math.max(12, (W - L - R) / Math.max(1, n - 1)), height: H - T - B, class: 'pickband' }));
      for (const s of vis) {
        const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
        if (s.area && n > 1) svg.appendChild(svgEl('path', { d: `M${x(0)},${y(0)} L${pts.join(' L')} L${x(n - 1)},${y(0)} Z`, fill: s.color, 'fill-opacity': .1 }));
        svg.appendChild(svgEl('path', { d: `M${pts.join(' L')}`, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...(s.dash ? { 'stroke-dasharray': '5 4' } : {}) }));
        if (n <= 31) s.values.forEach((v, i) => svg.appendChild(svgEl('circle', { cx: x(i), cy: y(v), r: 2.5, fill: s.color })));
      }
      const hair = svgEl('line', { y1: T, y2: H - B, class: 'hair', visibility: 'hidden' }), dots = svgEl('g', { visibility: 'hidden' });
      vis.forEach(s => dots.appendChild(svgEl('circle', { r: 5, fill: '#fff', stroke: s.color, 'stroke-width': 2 })));
      svg.append(hair, dots);
      const hit = svgEl('rect', { x: L - 6, y: 0, width: W - L - R + 12, height: H - B + 6, fill: 'transparent', tabindex: 0, class: 'hit', 'aria-label': '날짜를 고르려면 왼쪽·오른쪽 화살표, 그날만 보려면 Enter' });
      svg.appendChild(hit); box.appendChild(svg);
      let cur = -1;
      const at = (i, e) => {
        cur = Math.max(0, Math.min(n - 1, i)); hair.setAttribute('x1', x(cur)); hair.setAttribute('x2', x(cur)); hair.setAttribute('visibility', 'visible'); dots.setAttribute('visibility', 'visible');
        [...dots.children].forEach((c, k) => { c.setAttribute('cx', x(cur)); c.setAttribute('cy', y(vis[k].values[cur])); });
        showTip(e, vis.map(s => [s.color, s.name, num(s.values[cur]), s.dash]), `${dates[cur]} (${WD[wdOf(dates[cur])]})${opt.pickHint ? ' · 누르면 그날만 보기' : ''}`);
      };
      const idx = e => { const b = svg.getBoundingClientRect(), px = (e.clientX - b.left) * W / b.width; return n < 2 ? 0 : Math.round((px - L) / ((W - L - R) / (n - 1))); };
      hit.addEventListener('pointermove', e => at(idx(e), e));
      hit.addEventListener('pointerleave', () => { hair.setAttribute('visibility', 'hidden'); dots.setAttribute('visibility', 'hidden'); hideTip(); });
      hit.addEventListener('click', e => opt.onPick && opt.onPick(idx(e)));
      hit.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault(); const ni = Math.max(0, Math.min(n - 1, (cur < 0 ? n - 1 : cur) + (e.key === 'ArrowRight' ? 1 : -1))), b = svg.getBoundingClientRect();
          at(ni, { clientX: b.left + x(ni) * b.width / W, clientY: b.top + y(Math.max(...vis.map(q => q.values[ni]))) * b.height / H });
        }
        if (e.key === 'Enter' && cur >= 0 && opt.onPick) opt.onPick(cur);
      });
      hit.addEventListener('blur', hideTip);
    };
    draw();
    return draw;
  }
  // 레이더: axes[이름], series [{ name, color, dash, values[], on }], fmt(값) → 글자. 축 끝 점에 마우스를 올리면 모든 기간 값
  function radarChart(box, axes, series, fmt, opt = {}) {
    const draw = () => {
      box.textContent = '';
      const S = Math.min(440, Math.max(280, box.clientWidth)), cx = S / 2, cy = S / 2 - 4, R = S / 2 - (S < 380 ? 70 : 64), n = axes.length;
      const names = S < 380 && opt.short ? opt.short : axes;   // 휴대폰: 짧은 축 이름
      const vis = series.filter(s => s.on);
      const max = Math.max(1e-9, ...vis.flatMap(s => s.values)) * 1.08;
      const ang = i => -Math.PI / 2 + i * 2 * Math.PI / n, pt = (i, f) => [cx + Math.cos(ang(i)) * R * f, cy + Math.sin(ang(i)) * R * f];
      const svg = svgEl('svg', { viewBox: `0 0 ${S} ${S}`, class: 'rc', role: 'img', 'aria-label': opt.label || '레이더 그래프' });
      for (const f of [.25, .5, .75, 1]) svg.appendChild(svgEl('polygon', { points: axes.map((_, i) => pt(i, f).join(',')).join(' '), class: 'ring' }));
      axes.forEach((a, i) => {
        const [x2, y2] = pt(i, 1); svg.appendChild(svgEl('line', { x1: cx, y1: cy, x2, y2, class: 'spoke' }));
        const [lx, ly] = pt(i, 1.13), c = Math.cos(ang(i));
        const t = svgEl('text', { x: lx, y: ly + 4, 'text-anchor': Math.abs(c) < .3 ? 'middle' : c > 0 ? 'start' : 'end', class: 'ax' }); t.textContent = names[i]; svg.appendChild(t);
      });
      const ring = svgEl('text', { x: cx + 4, y: cy - R * .5 - 3, class: 'rl' }); ring.textContent = fmt(max / 1.08 * .5, true); svg.appendChild(ring);
      for (const s of vis) svg.appendChild(svgEl('polygon', { points: s.values.map((v, i) => pt(i, v / max).join(',')).join(' '), fill: s.color, 'fill-opacity': s.dash ? .06 : .16, stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', ...(s.dash ? { 'stroke-dasharray': '5 4' } : {}) }));
      for (const s of vis) s.values.forEach((v, i) => { const [x, y] = pt(i, v / max); svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 4, fill: s.dash ? '#fff' : s.color, stroke: s.color, 'stroke-width': 2 })); });
      axes.forEach((a, i) => {
        const [x, y] = pt(i, Math.max(...vis.map(s => s.values[i] / max), .12)), hit = svgEl('circle', { cx: x, cy: y, r: 14, fill: 'transparent', tabindex: 0, class: 'hit', 'aria-label': `${a}: ${vis.map(s => `${s.name} ${fmt(s.values[i])}`).join(', ')}` });
        const show = e => showTip(e, vis.map(s => [s.color, s.name, fmt(s.values[i]), s.dash]), a);
        hit.addEventListener('pointerenter', show); hit.addEventListener('pointermove', show); hit.addEventListener('focus', show);
        hit.addEventListener('pointerleave', hideTip); hit.addEventListener('blur', hideTip);
        svg.appendChild(hit);
      });
      box.appendChild(svg);
    };
    draw();
    return draw;
  }
  // 도넛(기기): [[이름, 값, 색]] — 조각에 마우스를 올리면 가운데에 이름·비율
  function donut(box, parts) {
    box.textContent = '';
    const total = parts.reduce((a, p) => a + p[1], 0), S = 200, r = 78, w = 26, c = S / 2;
    const svg = svgEl('svg', { viewBox: `0 0 ${S} ${S}`, class: 'dc', role: 'img', 'aria-label': parts.map(p => `${p[0]} ${pct(p[1], total)}`).join(', ') || '기록 없음' });
    const mid = svgEl('text', { x: c, y: c - 2, 'text-anchor': 'middle', class: 'dv' }), mid2 = svgEl('text', { x: c, y: c + 18, 'text-anchor': 'middle', class: 'dk' });
    const reset = () => { mid.textContent = num(total); mid2.textContent = '방문자'; };
    if (!total) svg.appendChild(svgEl('circle', { cx: c, cy: c, r, fill: 'none', stroke: '#EEF1F4', 'stroke-width': w }));
    let a0 = -Math.PI / 2;
    for (const [name, v, col] of parts) {
      if (!v) continue;
      const a1 = a0 + v / total * Math.PI * 2, gap = parts.filter(p => p[1]).length > 1 ? .02 : 0, s = a0 + gap, e = a1 - gap, big = e - s > Math.PI ? 1 : 0;
      const P = (a, rr) => `${c + Math.cos(a) * rr},${c + Math.sin(a) * rr}`;
      const path = v === total ? svgEl('circle', { cx: c, cy: c, r, fill: 'none', stroke: col, 'stroke-width': w })
        : svgEl('path', { d: `M${P(s, r)} A${r},${r} 0 ${big} 1 ${P(e, r)}`, fill: 'none', stroke: col, 'stroke-width': w });
      path.setAttribute('class', 'seg'); path.setAttribute('tabindex', 0);
      const show = ev => { mid.textContent = pct(v, total); mid2.textContent = `${name} ${num(v)}명`; showTip(ev, [[col, name, `${num(v)}명 · ${pct(v, total)}`]]); };
      path.addEventListener('pointerenter', show); path.addEventListener('focus', show);
      path.addEventListener('pointerleave', () => { reset(); hideTip(); }); path.addEventListener('blur', () => { reset(); hideTip(); });
      svg.appendChild(path); a0 = a1;
    }
    reset(); svg.append(mid, mid2); box.appendChild(svg);
    const lg = document.createElement('ul'); lg.className = 'dlg';
    for (const [name, v, col] of parts) { const li = document.createElement('li'), i = document.createElement('i'), b = document.createElement('b'), s = document.createElement('span'); i.style.background = col; s.textContent = name; b.textContent = `${num(v)}명 · ${pct(v, total)}`; li.append(i, s, b); lg.appendChild(li); }
    box.appendChild(lg);
  }
  // 범례 버튼(누르면 그 계열 숨기기/보이기)
  function legend(el, series, redraw) {
    el.innerHTML = series.map((s, i) => `<button type="button" class="lgb${s.on ? '' : ' off'}" data-i="${i}" aria-pressed="${s.on}"><i style="border-top-color:${s.color};border-top-style:${s.dash ? 'dashed' : 'solid'}"></i>${h(s.name)}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.onclick = () => { const s = series[+b.dataset.i]; if (s.on && series.filter(x => x.on).length === 1) return; s.on = !s.on; legend(el, series, redraw); redraw(); });
  }

  async function traffic() {
    const { n, seg } = period('traffic');
    const v = shell('방문·유입', { desc: '사이트에 몇 명이 어디서 들어왔는지. 같은 사람은 하루 한 번만 셉니다(쿠키·개인정보 없이). 그래프에 마우스를 올리거나 눌러 보세요.', tool: seg });
    const s = await api('GET', `/api/admin/stats?days=${n}`), t = s.total, p = s.prev.total;
    const vs = n === '1' ? '어제' : `직전 ${n}일`;
    const pages = t.uv ? (t.pv / t.uv).toFixed(1) : '-', ppages = p.uv ? (p.pv / p.uv).toFixed(1) : '-';
    v.innerHTML = `${persistNote(s)}<div class="kpis">
        <div class="kpi"><span>방문자</span><b>${num(t.uv)}</b><small>${delta(t.uv, p.uv)} ${vs} ${num(p.uv)}명</small></div>
        <div class="kpi"><span>페이지 열림</span><b>${num(t.pv)}</b><small>${delta(t.pv, p.pv)} ${vs} ${num(p.pv)}번</small></div>
        <div class="kpi"><span>다른 곳에서 들어옴</span><b>${num(t.entries)}</b><small>${delta(t.entries, p.entries)} ${vs} ${num(p.entries)}번</small></div>
        <div class="kpi"><span>1명당 본 페이지</span><b>${pages}</b><small>${vs} ${ppages}쪽${n === '1' ? '' : ` · 하루 평균 ${num(Math.round(t.uv / +n))}명`}</small></div></div>
      ${n !== '1' ? `<div class="card"><div class="ch"><div><h2>날짜별 흐름</h2><p class="h-sub">마우스를 올리면 그날 숫자, 누르면 아래 유입·기기가 그날 기준으로 바뀝니다. 점선은 ${vs}(같은 순서의 날)입니다.</p></div><div class="lg" id="lc-lg"></div></div><div class="lcbox" id="lc"></div></div>` : ''}
      <div id="pickbar"></div>
      <div class="cols"><div class="card"><div class="ch"><div><h2>유입 경로 레이더</h2><p class="h-sub" id="rs-sub">들어온 경로가 어디에 많이 몰렸는지(비율). 점에 마우스를 올리면 숫자</p></div><div class="lg" id="rs-lg"></div></div><div class="rcbox" id="rs"></div>
          <details class="tbl"><summary>숫자로 보기</summary><div id="rs-tbl"></div></details></div>
        <div class="card">${+n >= 7 ? `<div class="ch"><div><h2>요일별 방문 레이더</h2><p class="h-sub">요일마다 하루 평균 방문자</p></div><div class="lg" id="rw-lg"></div></div><div class="rcbox" id="rw"></div>
          <details class="tbl"><summary>숫자로 보기</summary><div id="rw-tbl"></div></details>` : '<h2>요일별 방문 레이더</h2><p class="h-sub">최근 7일 이상을 고르면 요일별로 보입니다.</p>'}</div></div>
      <div class="cols"><div class="card"><h2>기기</h2><p class="h-sub" id="dv-sub">방문자 기준 · 조각에 마우스를 올리면 비율</p><div class="dcbox" id="dv"></div></div>
        <div class="card"><h2>어디서 왔나</h2><p class="h-sub" id="src-sub">들어온 경로별(사이트 안 이동은 빼고)</p><div id="src-bars">${bars(top(t.sources, 12), t.entries)}</div></div></div>
      <div class="cols"><div class="card"><h2>많이 본 페이지</h2><p class="h-sub">페이지 열림 순</p>${bars(top(t.pages, 12), t.pv, x => pageName(x, s))}</div>
        <div class="card"><h2>들어온 사이트</h2><p class="h-sub">검색·블로그·카페 등 주소별</p>${bars(top(t.refs, 10), sum(t.refs))}</div></div>
      <div class="card"><h2>검색엔진·AI 로봇 방문</h2><p class="h-sub">사람이 아닌 수집 로봇이 읽어간 횟수(방문자 숫자에는 안 들어감)</p>${bars(top(t.bots, 10), sum(t.bots))}</div>
      <p class="help">GA4·네이버 애널리틱스를 연결하면 거기서도 더 자세히 볼 수 있습니다. 이 화면 숫자는 사이트 서버가 직접 센 것이라 조금 다를 수 있습니다.</p>`;
    const dates = s.days.map(d => d.date);
    let pick = null;
    // 레이더·기기·유입 막대: 기간 전체 또는 고른 날
    const rsSeries = [{ name: '', color: C1, on: true, values: [] }, { name: '', color: C2, dash: true, on: true, values: [] }];
    const shareFmt = (x, ring) => ring ? `${Math.round(x)}%` : `${Math.round(x * 10) / 10}%`;
    let rsDraw = () => {};
    const tbl = (axes, ser, fmtv) => `<table class="list"><thead><tr><th></th>${ser.map(x => `<th class="r">${h(x.name)}</th>`).join('')}</tr></thead><tbody>${axes.map((a, i) => `<tr><td>${h(a)}</td>${ser.map(x => `<td class="r">${fmtv(x, i)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const fill = () => {
      const day = pick != null ? s.days[pick] : null;
      const curSrc = day ? day.sources : t.sources, curDev = day ? day.devices : t.devices, curEnt = day ? day.entries : t.entries;
      const cmpSrc = day ? t.sources : p.sources;
      const a = srcProfile(curSrc), b = srcProfile(cmpSrc), sa = a.reduce((x, y) => x + y, 0), sb = b.reduce((x, y) => x + y, 0);
      rsSeries[0].name = day ? `${md(day.date)}(그날)` : `이번 ${n === '1' ? '오늘' : `${n}일`}`; rsSeries[0].values = a.map(x => sa ? x / sa * 100 : 0); rsSeries[0].counts = a;
      rsSeries[1].name = day ? `이번 ${n}일 전체` : vs; rsSeries[1].values = b.map(x => sb ? x / sb * 100 : 0); rsSeries[1].counts = b;
      rsDraw = radarChart($('#rs'), SRC_AX.map(x => x[0]), rsSeries, shareFmt, { label: '유입 경로 비율 레이더', short: ['네이버 검색', '블로그·카페', '구글', '직접 방문', 'SNS·영상', 'AI 답변', '공식몰', '그 밖'] });
      legend($('#rs-lg'), rsSeries, () => rsDraw());
      $('#rs-tbl').innerHTML = tbl(SRC_AX.map(x => x[0]), rsSeries, (x, i) => `${num(x.counts[i])}번 · ${shareFmt(x.values[i])}`);
      $('#rs-sub').textContent = sa ? (day ? `${day.date} 하루와 ${n}일 전체의 유입 비율 비교` : `이번 기간과 ${vs}의 유입 비율 비교. 점에 마우스를 올리면 숫자`) : '아직 다른 곳에서 들어온 기록이 없습니다.';
      donut($('#dv'), [['휴대폰', curDev['휴대폰'] || 0, C1], ['PC', curDev.PC || 0, C2], ['태블릿', curDev['태블릿'] || 0, C3]]);
      $('#dv-sub').textContent = day ? `${day.date} 하루 방문자 기준` : '방문자 기준 · 조각에 마우스를 올리면 비율';
      $('#src-bars').innerHTML = bars(top(curSrc, 12), curEnt); $('#src-sub').textContent = day ? `${day.date} 하루 들어온 경로` : '들어온 경로별(사이트 안 이동은 빼고)';
      $('#pickbar').innerHTML = day ? `<div class="box info pick"><b>${h(day.date)}(${WD[wdOf(day.date)]})만 보는 중</b> — 방문자 ${num(day.uv)} · 페이지 ${num(day.pv)} · 들어옴 ${num(day.entries)} <button class="btn sm" id="unpick" type="button">기간 전체로</button></div>` : '';
      if (day) $('#unpick').onclick = () => { pick = null; fill(); if (lcDraw) lcDraw(); };
    };
    let lcDraw = null;
    if (n !== '1') {
      const prevUv = s.prev.days.map(d => d.uv);
      const lcSeries = [{ name: '방문자', color: C1, area: true, on: true, values: s.days.map(d => d.uv) }, { name: '페이지 열림', color: C3, on: true, values: s.days.map(d => d.pv) }, { name: `${vs} 방문자`, color: C2, dash: true, on: true, values: prevUv }];
      const opt = { label: '날짜별 방문자·페이지 열림 선 그래프', pickHint: true, onPick: i => { pick = pick === i ? null : i; opt.pick = pick; fill(); lcDraw(); } };
      lcDraw = lineChart($('#lc'), dates, lcSeries, opt);
      legend($('#lc-lg'), lcSeries, () => lcDraw());
    }
    fill();
    let rwDraw = null;
    if (+n >= 7) {
      const rwSeries = [{ name: `이번 ${n}일`, color: C1, on: true, values: weekdayAvg(s.days) }, { name: vs, color: C2, dash: true, on: true, values: weekdayAvg(s.prev.days) }];
      const fmt = x => `${Math.round(x * 10) / 10}명`;
      rwDraw = radarChart($('#rw'), WD, rwSeries, fmt, { label: '요일별 평균 방문자 레이더' });
      legend($('#rw-lg'), rwSeries, () => rwDraw());
      $('#rw-tbl').innerHTML = tbl(WD, rwSeries, (x, i) => fmt(x.values[i]));
    }
    // 화면 폭이 바뀌면 다시 그림(같은 화면일 때만)
    const here = location.hash;
    let rt; window.onresize = () => { clearTimeout(rt); rt = setTimeout(() => { if (location.hash !== here) { window.onresize = null; return; } lcDraw && lcDraw(); rsDraw(); rwDraw && rwDraw(); }, 150); };
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
    v.innerHTML = `${persistNote(s)}${ME.user.role === 'owner' ? `<div class="box info"><b>주문서까지 온 흐름입니다.</b> 홈페이지 결제로 실제 결제된 주문은 <a href="#/payments">결제 주문</a>에서 봅니다. 홈페이지 결제가 꺼져 있을 때는 '결제하기'를 누르면 같은 상품의 잠스쿨 스마트스토어로 넘어가 거기서 결제합니다. 실제 결제·배송은 <a href="https://sell.smartstore.naver.com/" target="_blank" rel="noopener">스마트스토어 판매자센터</a>에서 확인하세요.${s.ordersSince ? ` <br><small>주문 흐름은 ${h(s.ordersSince)}부터 셉니다(그 전은 시험 기록).</small>` : ''}</div>` : ''}
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

  // ── 결제 주문(홈페이지 결제: 씨드페이먼츠) — 주문자·배송지 확인, 발송 처리, 결제 취소(관리자), 결제 켜기/끄기(관리자)
  const PST = { paid: 'live', cancelled: '', check: 'bad', failed: 'draft', approving: 'draft', ready: '' };
  const dt = s => s ? new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
  const telFmt = t => String(t || '').replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  // 결제 주문 화면 상태(자세히 보고 돌아와도 그대로): 기간·상태
  const PAYF = { range: '30', from: '', to: '', st: 'paid' };
  const RANGES = [['0', '오늘'], ['1', '어제'], ['7', '최근 7일'], ['30', '최근 30일'], ['all', '전체 기간'], ['pick', '날짜 고르기']];
  const OST = [['todo', '발송 전'], ['paid', '결제 완료 전체'], ['shipped', '발송함'], ['issue', '취소·확인 필요'], ['tries', '결제 시도 전체']];
  const kToday = (back = 0) => new Date(Date.now() + 9 * 3600e3 - back * 864e5).toISOString().slice(0, 10);
  const WDK = ['일', '월', '화', '수', '목', '금', '토'];
  const dayLabel = s => `${+s.slice(5, 7)}월 ${+s.slice(8, 10)}일 (${WDK[new Date(s + 'T00:00:00Z').getUTCDay()]})${s === kToday() ? ' · 오늘' : s === kToday(1) ? ' · 어제' : ''}`;
  const rangeDates = () => { const r = PAYF.range; if (r === 'pick') return [PAYF.from, PAYF.to]; if (r === 'all') return ['', '']; if (r === '0') return [kToday(), kToday()]; if (r === '1') return [kToday(1), kToday(1)]; return [kToday(+r - 1), kToday()]; };
  const stOk = (o, st) => st === 'todo' ? o.status === 'paid' && o.fulfil !== 'shipped' : st === 'paid' ? o.status === 'paid' : st === 'shipped' ? o.status === 'paid' && o.fulfil === 'shipped' : st === 'issue' ? ['check', 'cancelled', 'approving'].includes(o.status) : true;
  // 서버가 준 엑셀 파일을 내려받기(이름은 Content-Disposition 의 filename*)
  async function download(url, data) {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'X-Jam-Admin': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `오류(${res.status})`); }
    const cd = res.headers.get('content-disposition') || '', name = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/) || [])[1] || 'jamschool.xlsx');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return name;
  }
  async function payments() {
    const owner = ME.user.role === 'owner';
    const v = shell('결제 주문', { desc: '홈페이지에서 결제된 주문입니다. 날짜별로 보고, 보낼 주문을 골라 택배 엑셀을 내려받은 뒤 \'발송 처리\'를 눌러 주세요.' });
    const [from, to] = rangeDates();
    const d = await api('GET', `/api/admin/payments?${PAYF.st === 'tries' ? 'all=1&' : ''}from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}`);
    // ── 총괄 관리자만: 결제 켜기·상점·결제통보·중계·알림·시험 기록 정리
    let ownerBox = '';
    if (owner) {
      const state = !d.keySet ? '<div class="box bad"><b>상점키가 없습니다.</b> Railway 변수 SEEDPAY_MERCHANT_KEY 를 넣어야 결제할 수 있습니다.</div>'
        : `<div class="box ${d.enabled ? 'ok' : 'info'}"><b>홈페이지 결제 ${d.enabled ? '켜짐' : '꺼짐'}</b> ${d.enabled ? '주문서에서 카드로 바로 결제합니다.' : '지금은 주문서에서 결제하기를 누르면 스마트스토어로 넘어갑니다. 시험 결제는 장바구니에 상품을 담고 <a href="/checkout.html?pg=test" target="_blank" rel="noopener">주문서(시험 결제)</a>에서 할 수 있습니다(실제 결제되니 확인 후 취소).'}
          · 상점 ID ${h(d.mid)}${d.test ? ' · <b>씨드페이먼츠 테스트 서버(devpay)</b>' : ''}${d.dataDir ? '' : ' · <b>주의: 저장 볼륨(DATA_DIR)이 없어 재배포하면 주문 기록이 지워집니다</b>'}
          <br><small>결제통보 URL <code>${h(d.notiUrl)}</code> — 씨드페이먼츠 가맹점 관리자(mms.seedpayments.co.kr) → 가맹점정보 → 결제환경 설정 → 결제결과 통보관리에 신용카드용으로 등록하면, 가맹점 관리자에서 한 취소도 여기 반영됩니다.</small>
          ${d.relay ? `<br><small>한국 중계 ${d.relay.on ? `켜짐 <code>${h(d.relay.url)}</code>` : '꺼짐(Railway 변수 SEEDPAY_RELAY_URL 없음)'} · 중계 키 해시(중계 쪽 RELAY_KEY_SHA256 에 넣는 값, 비밀 아님) <code>${h(d.relay.keyHash || '-')}</code></small>` : ''}
          <div class="actions static"><button class="btn ${d.enabled ? '' : 'pri'} sm" id="pay-toggle">${d.enabled ? '홈페이지 결제 끄기' : '홈페이지 결제 켜기'}</button> <button class="btn sm" id="pay-probe">결제 서버 연결 점검</button></div><div id="probe-out"></div></div>`;
      const nt = d.notify || {}, on = nt.token && nt.chats;
      const notify = `<div class="box ${on ? 'ok' : 'info'}"><b>주문 알림(텔레그램) ${on ? `켜짐 · 대화방 ${nt.chats}곳` : nt.token ? '대화방 ID 필요' : '꺼짐'}</b>
          ${on ? '결제 완료·확인 필요 주문이 들어오면 텔레그램으로 바로 알려 줍니다.' : nt.token ? '텔레그램에서 봇에게 아무 말이나 보낸 뒤 \'대화방 ID 찾기\'를 누르고, 찾은 ID 를 Railway 변수 NOTIFY_TELEGRAM_CHAT_ID 에 넣어 주세요.'
            : 'Railway 변수 NOTIFY_TELEGRAM_TOKEN(봇 토큰)과 NOTIFY_TELEGRAM_CHAT_ID(대화방 ID)를 넣으면 결제 완료·확인 필요 주문을 텔레그램으로 알려 줍니다.'}
          ${nt.badChats ? `<br><b>NOTIFY_TELEGRAM_CHAT_ID 에 형식이 맞지 않는 값이 ${nt.badChats}개 있습니다(숫자 ID 를 쉼표로 구분).</b>` : ''}
          ${nt.token ? `<div class="actions static"><button class="btn sm" id="notify-test">${on ? '시험 알림 보내기' : '대화방 ID 찾기'}</button></div>` : ''}</div>`;
      ownerBox = `<details class="ownbox"><summary>총괄 관리자 전용 · 결제 설정·알림·시험 기록 정리 <span class="tag ${d.enabled ? 'live' : ''}">결제 ${d.enabled ? '켜짐' : '꺼짐'}</span></summary>${state}${notify}
        <div class="box info"><b>시험 기록 정리</b> 지금까지의 결제 주문을 보관 폴더(볼륨 orders/_archive)로 옮기고, '주문 흐름' 숫자를 오늘부터 새로 셉니다. 방문·유입 숫자와 결제 켜기 설정은 그대로입니다.${d.since ? ` <br><small>지금은 ${h(d.since)}부터 셉니다.</small>` : ''}
          <div class="actions static" id="reset-box"><button class="btn sm danger" type="button" id="reset-1">시험 기록 정리하기</button></div></div></details>`;
    }
    // ── 이 기간 숫자
    const paidIn = d.orders.filter(o => o.status === 'paid'), todoIn = paidIn.filter(o => o.fulfil !== 'shipped');
    const list = d.orders.filter(o => stOk(o, PAYF.st));
    const days = []; for (const o of list) { let g = days.find(x => x.day === o.day); if (!g) days.push(g = { day: o.day, list: [] }); g.list.push(o); }
    const row = o => `<div class="orow${o.status === 'paid' ? '' : ' off'}">
        <input type="checkbox" data-sel="${h(o.moid)}" ${o.status === 'paid' ? '' : 'disabled'} aria-label="${h(o.receiver)} 주문 고르기">
        <div class="o-time">${h(o.time)}</div>
        <div class="o-main"><p class="o-items">${o.items.map(h).join('<br>')}</p>
          <p class="o-to"><b>${h(o.receiver)}</b> · ${h(telFmt(o.tel))} · (${h(o.zip)}) ${h(o.addr)}${o.jeju ? ' · <b class="o-warn">제주·도서산간</b>' : ''}</p>
          ${o.memo ? `<p class="o-memo">배송 메모: ${h(o.memo)}</p>` : ''}${o.fail && o.status !== 'paid' ? `<p class="o-memo">${h(o.fail)}</p>` : ''}
          <p class="o-id">${h(o.moid)} · ${h(o.payLabel || '')}</p></div>
        <div class="o-side"><b>${won(o.amount)}</b><span class="tag ${PST[o.status] || ''}">${h(o.statusName)}</span>${o.status === 'paid' ? (o.fulfil === 'shipped' ? `<span class="tag live">발송함 ${h(dt(o.shippedAt))}</span>` : '<span class="tag draft">발송 전</span>') : ''}<a class="btn sm" href="#/payments/${h(o.moid)}">자세히</a></div></div>`;
    v.innerHTML = `${ownerBox}
      <div class="card ofbar"><div class="seg wrap" role="group" aria-label="기간">${RANGES.map(([k, t]) => `<a href="#" data-range="${k}" class="${PAYF.range === k ? 'on' : ''}">${t}</a>`).join('')}</div>
        <div class="ofpick" ${PAYF.range === 'pick' ? '' : 'hidden'}><input type="date" id="of-from" value="${h(PAYF.from)}" aria-label="시작 날짜"> ~ <input type="date" id="of-to" value="${h(PAYF.to)}" aria-label="끝 날짜"><button class="btn sm" type="button" id="of-go">보기</button></div>
        <div class="seg wrap" role="group" aria-label="상태">${OST.map(([k, t]) => `<a href="#" data-st="${k}" class="${PAYF.st === k ? 'on' : ''}">${t}</a>`).join('')}</div></div>
      <div class="kpis k3"><div class="kpi"><span>결제 완료</span><b>${num(paidIn.length)}건</b><small>${won(paidIn.reduce((a, o) => a + o.amount, 0))}</small></div>
        <div class="kpi"><span>발송 전</span><b>${num(todoIn.length)}건</b><small>${d.todo !== todoIn.length ? `기간 밖까지 모두 ${num(d.todo)}건 · <a href="#" id="all-todo">모두 보기</a>` : '이 기간 기준'}</small></div>
        <div class="kpi"><span>발송함</span><b>${num(paidIn.length - todoIn.length)}건</b><small>${h(from ? (from === to ? dayLabel(from) : `${from} ~ ${to || '오늘'}`) : '전체 기간')}</small></div></div>
      <div class="obar"><label class="chk"><input type="checkbox" id="o-all"> 보이는 결제 완료 주문 모두 고르기</label><span class="o-n" id="o-n">0건 고름</span>
        <select id="o-fmt" aria-label="엑셀 양식">${(d.formats || []).map(([k, t]) => `<option value="${h(k)}">${h(t)}</option>`).join('')}</select>
        <button class="btn sm pri" type="button" id="o-xls" disabled>엑셀 내려받기</button><button class="btn sm" type="button" id="o-ship" disabled>발송 처리</button><button class="btn sm" type="button" id="o-unship" disabled>발송 전으로</button></div>
      ${days.length ? days.map(g => { const pd = g.list.filter(o => o.status === 'paid'); return `<section class="oday"><h3>${h(dayLabel(g.day))}<small>${g.list.length}건${pd.length ? ` · 결제 완료 ${pd.length}건 ${won(pd.reduce((a, o) => a + o.amount, 0))}` : ''}</small></h3>${g.list.map(row).join('')}</section>`; }).join('')
        : `<div class="card">${empty(PAYF.st === 'todo' ? '이 기간에 보낼 주문이 없습니다.' : '이 기간에 주문이 없습니다.')}</div>`}
      <p class="help">엑셀: '택배 접수용'은 주문 1건이 1줄(로젠 iLOGEN 등 복수건 접수 화면에서 열과 항목을 한 번 맞춰 엑셀 타입으로 저장해 두면 계속 쓸 수 있습니다), '3PL 출고용'은 상품 1개가 1줄입니다. 손님 이름·연락처·주소가 들어 있으니 접수 뒤에는 PC 에서 지워 주세요.</p>`;
    // 고르기
    const sel = new Set();
    const sync = () => {
      $('#o-n').textContent = `${sel.size}건 고름`;
      ['#o-xls', '#o-ship', '#o-unship'].forEach(k => { $(k).disabled = !sel.size; });
      const boxes = [...v.querySelectorAll('[data-sel]:not(:disabled)')]; $('#o-all').checked = boxes.length > 0 && boxes.every(b => b.checked);
    };
    v.querySelectorAll('[data-sel]').forEach(b => b.onchange = () => { if (b.checked) sel.add(b.dataset.sel); else sel.delete(b.dataset.sel); b.closest('.orow').classList.toggle('picked', b.checked); sync(); });
    $('#o-all').onchange = e => { v.querySelectorAll('[data-sel]:not(:disabled)').forEach(b => { b.checked = e.target.checked; if (b.checked) sel.add(b.dataset.sel); else sel.delete(b.dataset.sel); b.closest('.orow').classList.toggle('picked', b.checked); }); sync(); };
    sync();
    // 기간·상태
    v.querySelectorAll('[data-range]').forEach(a => a.onclick = e => { e.preventDefault(); PAYF.range = a.dataset.range; if (PAYF.range === 'pick') { if (!PAYF.from) { PAYF.from = kToday(6); PAYF.to = kToday(); } } payments(); });
    v.querySelectorAll('[data-st]').forEach(a => a.onclick = e => { e.preventDefault(); PAYF.st = a.dataset.st; payments(); });
    const go = $('#of-go'); if (go) go.onclick = () => { PAYF.from = $('#of-from').value; PAYF.to = $('#of-to').value; if (PAYF.from && PAYF.to && PAYF.from > PAYF.to) [PAYF.from, PAYF.to] = [PAYF.to, PAYF.from]; payments(); };
    const at = $('#all-todo'); if (at) at.onclick = e => { e.preventDefault(); PAYF.range = 'all'; PAYF.st = 'todo'; payments(); };
    // 엑셀·발송 처리
    $('#o-xls').onclick = async () => {
      $('#o-xls').disabled = true;
      try { const name = await download('/api/admin/payments-export', { moids: [...sel], format: $('#o-fmt').value }); toast(`${name} 을(를) 내려받았습니다. 택배 접수가 끝나면 '발송 처리'를 눌러 주세요.`, 6000); }
      catch (e) { fail(e); } finally { $('#o-xls').disabled = !sel.size; }
    };
    const ship = status => async () => {
      try { const r = await api('POST', '/api/admin/payments-ship', { moids: [...sel], status }); toast(status === 'shipped' ? `${r.changed}건 발송 처리했습니다` : `${r.changed}건을 발송 전으로 돌렸습니다`); payments(); }
      catch (e) { fail(e); }
    };
    $('#o-ship').onclick = ship('shipped'); $('#o-unship').onclick = ship('new');
    if (!owner) return;
    // ── 총괄 관리자 버튼
    const nb = $('#notify-test');
    if (nb) nb.onclick = async () => {
      nb.disabled = true;
      try {
        const r = await api('POST', '/api/admin/payments-notify-test', {});
        if (r.chats && r.chats.length) alert(`${r.msg}\n\n${r.chats.map(c => `${c.name || '(이름 없음)'} · ${c.type === 'private' ? '개인 대화' : c.type === 'channel' ? '채널' : '그룹'}: ${c.id}`).join('\n')}`);
        else toast(r.msg, 6000);
      } catch (e) { toast(e.message); }
      nb.disabled = false;
    };
    const pb = $('#pay-probe');
    if (pb) pb.onclick = async () => {
      pb.disabled = true; $('#probe-out').innerHTML = '<p class="help">점검 중…(10초 안팎)</p>';
      try {
        const r = await api('GET', '/api/admin/payments-probe');
        const a = r.approval || {}, where = [r.country, r.city, r.org].filter(Boolean).join(' · ');
        const head = r.via === 'relay' ? (r.verdict === 'ok' ? `<b>한국 중계 서버를 거쳐 씨드 승인 서버에 정상 연결됩니다.</b> 중계 ${h(r.relayUrl)}${r.relay.region ? ` (${h(r.relay.region)})` : ''}${r.relay.db ? ` · 정지 방지 DB 기록 ${r.relay.db.ok ? '정상' : '실패'}` : ''} · 처리 ${h((r.relay.stats || {}).ok ?? 0)}건(실패 ${h((r.relay.stats || {}).fail ?? 0)})` : `<b>중계 서버 이상:</b> ${h(r.relay.error || '응답 없음')} — 이 상태에서는 결제창을 열지 않고 스마트스토어 결제를 안내합니다.`)
          : r.verdict === 'ok' ? '<b>씨드 승인 서버가 이 서버의 요청을 받습니다.</b>' : r.verdict === 'blocked' ? '<b>씨드 승인 서버가 이 서버를 막고 있습니다(HTTP 403).</b> 이 상태로는 카드 인증 뒤 승인이 되지 않아 주문이 \'확인 필요\'로 남습니다. 씨드페이먼츠에 아래 IP 등록(또는 해외 IP 허용)을 요청해야 합니다.' : `<b>씨드 승인 서버 응답 이상</b>(${h(a.status || a.error || '?')})`;
        $('#probe-out').innerHTML = `<div class="box ${r.verdict === 'ok' ? 'ok' : 'bad'}" style="margin-top:10px">${head}<br><small>이 서버가 나가는 IP <code>${h(r.ip || '확인 못 함')}</code>${where ? ` (${h(where)})` : ''}${r.region ? ` · Railway 지역 ${h(r.region)}` : ''} · 승인 주소 응답 ${h(a.status || a.error || '-')}${a.server ? ` (${h(a.server)})` : ''} · 결제창 스크립트 ${h(r.script.status || r.script.error)} · ${h(new Date(r.at).toLocaleString('ko-KR'))}</small></div>`;
      } catch (e) { $('#probe-out').innerHTML = ''; fail(e); }
      pb.disabled = false;
    };
    const tg = $('#pay-toggle');
    if (tg) tg.onclick = async () => {
      const on = !d.enabled;
      if (!confirm(on ? '홈페이지 결제를 켤까요? 주문서에서 바로 카드 결제가 됩니다. 시험 결제와 취소를 먼저 확인했는지 확인해 주세요.' : '홈페이지 결제를 끌까요? 주문서에서 결제하기를 누르면 다시 스마트스토어로 넘어갑니다.')) return;
      tg.disabled = true;
      try { await api('POST', '/api/admin/payments-settings', { enabled: on }); toast(on ? '홈페이지 결제를 켰습니다' : '홈페이지 결제를 껐습니다'); payments(); }
      catch (e) { toast(e.message); tg.disabled = false; }
    };
    // 시험 기록 정리: 브라우저 확인 창 대신 화면 안에서 한 번 더 묻는다
    $('#reset-1').onclick = () => {
      $('#reset-box').innerHTML = `<p style="margin:0 0 8px"><b>정말 정리할까요?</b> 지금 있는 결제 주문 기록이 목록에서 빠지고(보관 폴더에 남음), 주문 흐름은 ${h(kToday())}부터 다시 셉니다.</p><button class="btn sm danger" type="button" id="reset-2">정리하기</button> <button class="btn sm" type="button" id="reset-no">그만두기</button>`;
      $('#reset-no').onclick = () => payments();
      $('#reset-2').onclick = async () => {
        $('#reset-2').disabled = true;
        try { const r = await api('POST', '/api/admin/payments-reset', { confirm: '정리' }); toast(`정리했습니다: 주문 ${r.archived}건 보관${r.keptReady ? `(결제 중일 수 있는 ${r.keptReady}건은 남김)` : ''}, 주문 흐름은 ${r.since}부터`, 7000); payments(); }
        catch (e) { fail(e); $('#reset-2').disabled = false; }
      };
    };
  }
  async function payDetail(moid) {
    const v = shell('결제 주문 상세', { back: ['#/payments', '결제 주문'] });
    const { order: o, canCancel } = await api('GET', `/api/admin/payments/${encodeURIComponent(moid)}`);
    const dl = rows => `<table class="list"><tbody>${rows.filter(r => r[1] !== '' && r[1] != null).map(([k, val]) => `<tr><th style="width:130px">${h(k)}</th><td>${val}</td></tr>`).join('')}</tbody></table>`;
    const pg = o.pg || {}, rc = o.receiver, by = o.buyer;
    v.innerHTML = `<div class="cols"><div class="card"><h2>결제</h2><p class="h-sub">주문번호 ${h(o.moid)}</p>${dl([
        ['상태', `<span class="tag ${PST[o.status] || ''}">${h(o.statusName)}</span>${o.fail && o.status !== 'paid' ? ` ${h(o.fail.msg)}` : ''}`],
        ['결제 금액', `<b>${won(o.amount)}</b>${o.ship ? ` (배송비 ${won(o.ship)} 포함)` : ''}`], ['결제 수단', h(o.payLabel)],
        ['카드', pg.cardName ? h(`${pg.cardName} ${pg.cardNo || ''} · ${!pg.cardQuota || +pg.cardQuota === 0 ? '일시불' : +pg.cardQuota + '개월'}`) : ''],
        ['승인번호', h(pg.authCode || '')], ['거래번호(TID)', h(pg.tid || '')], ['주문 일시', h(dt(o.createdAt))], ['결제 일시', h(dt(o.paidAt))],
        ['취소', o.cancel ? h(`${dt(o.cancel.at)} · ${o.cancel.msg} · ${o.cancel.by}`) : ''],
      ])}</div>
      <div class="card"><h2>배송</h2><p class="h-sub">${o.status === 'paid' ? (o.fulfil && o.fulfil.status === 'shipped' ? `발송 처리함 · ${h(dt(o.fulfil.at))} ${h(o.fulfil.by || '')}` : '아직 발송 전') : '결제 완료 주문만 보냅니다'}</p>${dl([
        ['받는 분', h(rc.name)], ['연락처', h(telFmt(rc.tel))], ['주소', h(`(${rc.zip}) ${rc.addr1} ${rc.addr2}`)], ['배송 메모', h(rc.memo || '')],
        ['제주·도서산간', rc.jeju ? '<b>추가 배송비 안내 필요</b>' : ''], ['주문하는 분', h(`${by.name} · ${telFmt(by.tel)}${by.email ? ' · ' + by.email : ''}`)],
      ])}</div></div>
      <div class="card"><h2>주문 상품</h2><table class="list"><thead><tr><th>상품</th><th>옵션</th><th class="r">수량</th><th class="r">금액</th></tr></thead><tbody>${o.items.map(x => `<tr><td>${h(x.name)}</td><td>${h(x.opt || '')}</td><td class="r">${x.qty}</td><td class="r">${won(x.price * x.qty)}</td></tr>`).join('')}</tbody></table></div>
      ${o.status === 'paid' ? `<div class="actions static"><button class="btn pri" id="ship">${o.fulfil && o.fulfil.status === 'shipped' ? '발송 전으로 되돌리기' : '발송 처리'}</button>${canCancel ? '<button class="btn danger" id="cancel">결제 취소(전액)</button>' : ''}</div>` : ''}
      <div class="card" style="margin-top:16px"><h2>처리 기록</h2>${dl((o.history || []).map(x => [dt(x.at), h(`${x.ev}${x.note ? ' · ' + x.note : ''}`)]))}</div>`;
    const sb = $('#ship'), cb = $('#cancel');
    if (sb) sb.onclick = async () => {
      sb.disabled = true;
      try { await api('POST', `/api/admin/payments/${encodeURIComponent(moid)}/fulfil`, { status: o.fulfil && o.fulfil.status === 'shipped' ? 'new' : 'shipped' }); toast('저장했습니다'); payDetail(moid); }
      catch (e) { toast(e.message); sb.disabled = false; }
    };
    if (cb) cb.onclick = async () => {
      const reason = prompt(`${won(o.amount)} 전액을 취소합니다. 되돌릴 수 없습니다.\n취소 사유를 적어 주세요.`, '고객 요청 취소');
      if (reason == null) return;
      cb.disabled = true;
      try { await api('POST', `/api/admin/payments/${encodeURIComponent(moid)}/cancel`, { reason }); toast('결제를 취소했습니다'); payDetail(moid); }
      catch (e) { toast(e.message, 6000); cb.disabled = false; }
    };
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
  const ptabs = (id, on) => `<nav class="ptabs" aria-label="상품 편집"><a href="#/products/${id}" class="${on === 'info' ? 'on' : ''}">기본 정보·사진</a><a href="#/products/${id}/detail" class="${on === 'detail' ? 'on' : ''}">상세페이지</a><a href="#/products/${id}/notice" class="${on === 'notice' ? 'on' : ''}">상품정보 제공고시</a></nav>`;
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
      <div class="row"><div><label for="p-rating">평점 <small>별점 평균(0~5, 예: 4.87)</small></label><input type="number" id="p-rating" step="0.01" min="0" max="5" value="${h(p.rating)}"></div><div><label for="p-reviews">구매평 수 <small>상품 카드·상품 페이지에 보임</small></label><input type="number" id="p-reviews" min="0" value="${h(p.reviews)}"></div></div>
      ${o ? '' : `<div class="row"><div><label for="p-list">정가</label><input type="number" id="p-list" value="${h(p.list)}"></div><div><label for="p-price">판매가</label><input type="number" id="p-price" value="${h(p.price)}"></div></div>`}
      <label>배지</label><div class="checks">${BADGES.map(b => `<label><input type="checkbox" value="${b}" class="p-badge" ${p.badges.includes(b) ? 'checked' : ''}>${b}</label>`).join('')}</div>
      <label for="p-points">특징 <small>한 줄에 하나씩, 상품 카드·상세 위에 보입니다</small></label><textarea id="p-points" style="min-height:110px">${h(p.points.join('\n'))}</textarea></div>
      ${o ? `<div class="card"><h2>옵션별 가격(3단 접이식)</h2><table class="opt"><tr><th>옵션</th><th>판매가</th><th>정가</th></tr>${keys.map(([k, t]) => `<tr><td>${h(t)}</td><td><input type="number" data-op="price" data-k="${k}" value="${o.price[k]}"></td><td><input type="number" data-op="list" data-k="${k}" value="${o.list[k]}"></td></tr>`).join('')}</table><p class="help">가장 싼 옵션의 가격이 '~원부터'로 보입니다.</p></div>` : ''}
      <div class="card"><h2>상품 사진</h2><p class="h-sub">첫 번째 사진이 대표 사진입니다. 화살표로 순서를 바꾸세요. 정사각형(1000×1000)이 가장 잘 보입니다.</p><div class="thumbs" id="imgs"></div><div class="actions static"><button class="btn sm" id="p-add" type="button">사진 추가</button></div></div>
      <div class="actions"><button class="btn ok" id="p-save">저장하기</button><a class="btn" href="#/products/${p.id}/detail">상세페이지 고치기</a><a class="btn" href="#/site/reviews/REVIEWS/${p.id}">이 상품 구매평</a><a class="btn" href="/product-${p.id}.html" target="_blank" rel="noopener">상품 페이지 보기 ↗</a></div>`;
    const drawImgs = () => {
      $('#imgs').innerHTML = imgs.map((x, i) => `<figure class="${i ? '' : 'first'}"><img src="${h(x.data || site(x.src))}" alt=""><figcaption><button class="btn sm" data-mv="${i}" data-d="-1" ${i ? '' : 'disabled'}>←</button><button class="btn sm danger" data-rm="${i}">삭제</button><button class="btn sm" data-mv="${i}" data-d="1" ${i < imgs.length - 1 ? '' : 'disabled'}>→</button></figcaption></figure>`).join('');
      $('#imgs').querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const i = +b.dataset.mv, j = i + +b.dataset.d; [imgs[i], imgs[j]] = [imgs[j], imgs[i]]; dirty = true; drawImgs(); });
      $('#imgs').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { if (imgs.length < 2) return toast('사진은 한 장 이상 있어야 합니다'); imgs.splice(+b.dataset.rm, 1); dirty = true; drawImgs(); });
    };
    drawImgs(); v.addEventListener('input', () => { dirty = true; });
    $('#p-add').onclick = async () => { try { for (const f of await pickFiles(true)) { const x = await prepImage(f, 1000); imgs.push({ data: x.data }); } dirty = true; drawImgs(); } catch (e) { fail(e); } };
    $('#p-save').onclick = async () => {
      const product = { name: $('#p-name').value, short: $('#p-short').value, summary: $('#p-sum').value, store: $('#p-store').value, rating: $('#p-rating').value, reviews: $('#p-reviews').value, list: o ? 0 : $('#p-list').value, price: o ? 0 : $('#p-price').value,
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

  // ── 사이트 꾸미기 ① 목록 편집(홈 화면·구매평·자주 묻는 질문·기본 정보) — 서버 정의(tools/admin/blocks.mjs)대로 칸을 그린다
  const MENU_FIRST = { home: 'HERO_SLIDES', reviews: 'REVIEWS', faq: 'FAQ', info: 'CS' };
  const MENU_TITLE = { home: '홈 화면', reviews: '구매평', faq: '자주 묻는 질문', info: '기본 정보' };
  const MENU_DESC = {
    home: '홈에 보이는 슬라이드·카드·표를 고칩니다. 섹션 제목·설명 문구는 <a href="#/texts/home">페이지 문구·사진 › 홈</a>에서 고칩니다.',
    reviews: '홈과 상품 페이지에 보이는 구매평입니다. 상품별 구매평 수·평점은 <a href="#/products">상품 정보</a>에서 고칩니다.',
    faq: '홈의 자주 묻는 질문과 상품 페이지 Q&A 에 보입니다.',
    info: '여러 페이지에 쓰이는 기본 정보입니다. 바닥글(회사 정보)은 <a href="#/texts/footer">페이지 문구·사진 › 바닥글</a>에서 고칩니다.',
  };
  const clone = x => JSON.parse(JSON.stringify(x ?? null));
  const getP = (o, p) => p.reduce((a, k) => a == null ? a : a[k], o);
  const setP = (root, p, val) => { let o = root; p.slice(0, -1).forEach((k, i) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = typeof p[i + 1] === 'number' ? [] : {}; o = o[k]; }); o[p[p.length - 1]] = val; };
  const pathOf = s => s === '' ? [] : String(s).split('.').map(k => /^\d+$/.test(k) ? +k : k);
  const imgSrc = (val, base = '') => !val ? '' : typeof val === 'object' ? (val.data || site(base + (val.src || ''))) : site(base + val);
  const plainSum = x => String(Array.isArray(x) ? x.join(' ') : x ?? '').replace(/\*\*|==/g, '').replace(/\s+/g, ' ').trim();
  function fieldHTML(f, val, path, P) {
    const id = 'f-' + String(path || 'v').replace(/\./g, '-'), dp = `data-p="${path}"`;
    const lab = f.label || f.help ? `<label for="${id}">${h(f.label || '')}${f.help ? ` <small>${h(f.help)}</small>` : ''}</label>` : '';
    const cnt = f.max ? `<div class="count" data-cnt="${path}" data-max="${f.max}"></div>` : '';
    switch (f.t) {
      case 'text': return `${lab}<input type="text" id="${id}" ${dp} value="${h(val ?? '')}">${cnt}`;
      case 'area': return `${lab}<textarea id="${id}" ${dp} rows="${f.rows || 3}" style="min-height:0">${h(val ?? '')}</textarea>${cnt}`;
      case 'lines': return `${lab}<textarea id="${id}" ${dp} rows="${f.rows || 3}" style="min-height:0">${h(Array.isArray(val) ? val.join('\n') : val ?? '')}</textarea>`;
      case 'pair': return `<p class="flab">${h(f.label)}</p><div class="row">${[0, 1].map(k => `<div><label for="${id}-${k}" class="sm">${h(f.labels ? f.labels[k] : '')}</label><input type="text" id="${id}-${k}" data-p="${path}.${k}" value="${h(String((val || [])[k] ?? '').trim())}"></div>`).join('')}</div>`;
      case 'color': return `${lab}<div class="colr"><input type="color" id="${id}" ${dp} value="${h(/^#[0-9a-f]{6}$/i.test(val || '') ? val : '#ffffff')}"><code>${h(val || '')}</code></div>`;
      case 'check': return `<label class="chk"><input type="checkbox" ${dp} ${val ? 'checked' : ''}> ${h(f.label)}</label>`;
      case 'select': return `${lab}<select id="${id}" ${dp}>${f.opts.map(([k, t]) => `<option value="${h(k)}" ${k === val ? 'selected' : ''}>${h(t)}</option>`).join('')}</select>`;
      case 'icon': return `${lab}<select id="${id}" ${dp}>${P.icons.map(([k, t]) => `<option value="${h(k)}" ${k === val ? 'selected' : ''}>${h(t)}</option>`).join('')}</select>`;
      case 'product': return `${lab}<select id="${id}" ${dp} data-num="1">${f.need ? '' : '<option value="">상품 없음(회원 혜택 배너)</option>'}${P.products.map(p => `<option value="${p.id}" ${p.id === +val ? 'selected' : ''}>${h(p.short)}</option>`).join('')}</select>`;
      case 'num': return `${lab}<input type="number" id="${id}" ${dp} data-num="1" value="${h(val ?? '')}">`;
      case 'image': return `${lab}<div class="imgf">${val ? `<img src="${h(imgSrc(val, f.base))}" alt="">` : '<span class="noimg">사진 없음</span>'}<div><button class="btn sm" type="button" data-act="img" data-p="${path}" data-maxw="${f.maxW || 1600}" data-ratio="${f.ratio || ''}">사진 바꾸기</button>${val && typeof val === 'object' && val.data ? '<p class="help">새 사진(저장하면 올라갑니다)</p>' : ''}</div></div>`;
      case 'table': {
        const rows = f.one ? [val || {}] : (val || []);
        return `<p class="flab">${h(f.label)}</p><div class="tbl-wrap"><table class="tbl-ed"><thead><tr>${f.cols.map(c => `<th>${h(c.label)}</th>`).join('')}${f.one ? '' : '<th></th>'}</tr></thead><tbody>${rows.map((r, ri) => `<tr>${f.cols.map(c => `<td><input type="${c.t === 'num' ? 'number' : 'text'}" aria-label="${h(c.label)}" data-p="${path}${f.one ? '' : '.' + ri}.${c.k}" ${c.t === 'num' ? 'data-num="1"' : ''} value="${h((r || {})[c.k] ?? '')}"></td>`).join('')}${f.one ? '' : `<td><button class="btn sm danger" type="button" data-act="row-del" data-p="${path}.${ri}">빼기</button></td>`}</tr>`).join('')}</tbody></table></div>${f.one ? '' : `<button class="btn sm" type="button" data-act="row-add" data-p="${path}" data-tuple="${f.tuple ? 1 : ''}">줄 추가</button>`}`;
      }
      default: return '';
    }
  }
  const blankOf = def => {
    if (def.prim) return '';
    const o = {};
    for (const f of def.fields) o[f.k] = f.t === 'lines' ? [] : f.t === 'pair' ? (f.optional ? undefined : ['', '']) : f.t === 'color' ? '#F5F0EA' : f.t === 'check' ? false : f.t === 'select' ? f.opts[0][0] : f.t === 'icon' ? 'i-check' : f.t === 'table' ? (f.tuple ? [['', '']] : []) : f.t === 'image' || f.t === 'product' ? '' : f.t === 'num' ? 0 : '';
    return o;
  };
  async function siteBlocks(menu, name, pf) {
    if (!MENU_FIRST[menu]) { location.replace('#/site/home'); return; }
    name = name || MENU_FIRST[menu];
    const v = shell(MENU_TITLE[menu], { desc: MENU_DESC[menu] });
    const d = await api('GET', `/api/admin/blocks/${encodeURIComponent(name)}`);
    const def = d.def, P = { products: d.products, icons: d.icons };
    let S = clone(d.value);
    // 상품별 보기(byProduct): pf = 고른 상품 번호(없으면 전체). 저장은 언제나 전체 목록
    const PF = def.byProduct ? +pf || 0 : 0;
    const visIdx = () => S.map((_, i) => i).filter(i => !PF || +(S[i] || {}).pid === PF);
    const open = new Set(def.list && !def.prim && visIdx().length <= 3 ? visIdx() : []);
    const prodName = id => (P.products.find(x => x.id === +id) || {}).short;
    const sumOf = (it, i) => name === 'HERO_SLIDES' ? `${prodName(it.id) || '회원 혜택 배너'} · ${plainSum(it.title)}` : `${def.byProduct && !PF ? `${prodName(it.pid) || '상품 없음'} · ` : ''}${plainSum(def.title ? it[def.title] : it) || `${i + 1}번`}`;
    const imgField = !def.prim && def.list ? def.fields.find(f => f.t === 'image') : null;
    // k = 보이는 순서(0부터), n = 보이는 개수 — 위·아래는 보이는 것끼리 바꾼다
    const ctl = (i, n, k = i) => `<span class="bi-ctl"><button class="btn sm" type="button" data-act="up" data-p="${i}" ${k ? '' : 'disabled'} aria-label="위로">↑</button><button class="btn sm" type="button" data-act="down" data-p="${i}" ${k < n - 1 ? '' : 'disabled'} aria-label="아래로">↓</button><button class="btn sm danger" type="button" data-act="del" data-p="${i}" ${S.length > (def.min || 0) ? '' : 'disabled'}>빼기</button></span>`;
    const pfBar = () => def.byProduct ? `<div class="pfbar" role="group" aria-label="상품으로 보기"><a href="#/site/${menu}/${name}" class="${PF ? '' : 'on'}">전체 <b>${S.length}</b></a>${P.products.map(x => { const c = S.filter(it => +it.pid === x.id).length; return `<a href="#/site/${menu}/${name}/${x.id}" class="${PF === x.id ? 'on' : ''}${c ? '' : ' zero'}">${h(x.short)} <b>${c}</b></a>`; }).join('')}</div>` : '';
    const none = () => PF && !visIdx().length ? `<p class="empty">「${h(prodName(PF) || '')}」 ${h(def.label)}이 아직 없습니다. 아래 버튼으로 넣어 주세요.</p>` : '';
    const counts = () => v.querySelectorAll('[data-cnt]').forEach(c => { const inp = v.querySelector(`[data-p="${c.dataset.cnt}"]`), k = len(inp ? inp.value : ''); c.textContent = `${k}자 / ${c.dataset.max}자까지`; c.classList.toggle('over', k > +c.dataset.max); });
    const draw = () => {
      let body;
      if (def.scalar) body = `<div class="card">${fieldHTML({ ...def.scalar, label: def.label }, S, '', P)}</div>`;
      else if (!def.list) body = `<div class="card">${def.fields.map(f => fieldHTML(f, S[f.k], f.k, P)).join('')}</div>`;
      else if (def.grid) {
        const vi = visIdx(), imf = def.fields.find(f => f.t === 'image'), pf2 = def.fields.find(f => f.k === 'pid');
        body = `${pfBar()}<div class="card">${none()}<div class="thumbs">${vi.map((i, k) => `<figure><img src="${h(imgSrc(S[i][imf.k], imf.base))}" alt=""><div class="fsel">${fieldHTML({ ...pf2, label: '' }, S[i].pid, `${i}.pid`, P)}</div><figcaption><button class="btn sm" type="button" data-act="up" data-p="${i}" ${k ? '' : 'disabled'} aria-label="앞으로">←</button><button class="btn sm danger" type="button" data-act="del" data-p="${i}" ${S.length > (def.min || 0) ? '' : 'disabled'}>빼기</button><button class="btn sm" type="button" data-act="down" data-p="${i}" ${k < vi.length - 1 ? '' : 'disabled'} aria-label="뒤로">→</button></figcaption></figure>`).join('')}</div>
          <div class="actions static"><button class="btn sm" type="button" data-act="add-img" data-maxw="${imf.maxW || 1000}" data-ratio="${imf.ratio || ''}">사진 추가${PF ? `(${h(prodName(PF) || '')})` : ''}</button></div></div>`;
      }
      else if (def.prim && def.prim.t === 'image') body = `<div class="card"><div class="thumbs">${S.map((x, i) => `<figure><img src="${h(imgSrc(x))}" alt=""><figcaption><button class="btn sm" type="button" data-act="up" data-p="${i}" ${i ? '' : 'disabled'} aria-label="앞으로">←</button><button class="btn sm danger" type="button" data-act="del" data-p="${i}" ${S.length > (def.min || 0) ? '' : 'disabled'}>빼기</button><button class="btn sm" type="button" data-act="down" data-p="${i}" ${i < S.length - 1 ? '' : 'disabled'} aria-label="뒤로">→</button></figcaption></figure>`).join('')}</div>
          <div class="actions static"><button class="btn sm" type="button" data-act="add-img" data-maxw="${def.prim.maxW || 1000}" data-ratio="${def.prim.ratio || ''}">사진 추가</button></div></div>`;
      else if (def.prim) body = `<div class="card"><div class="plist">${S.map((x, i) => `<div class="pl"><span class="bi-no">${i + 1}</span><textarea data-p="${i}" rows="2" style="min-height:0" aria-label="${i + 1}번">${h(x)}</textarea>${ctl(i, S.length)}</div>`).join('')}</div>
          <div class="actions static"><button class="btn sm" type="button" data-act="add" ${def.max && S.length >= def.max ? 'disabled' : ''}>추가</button></div></div>`;
      else body = `${pfBar()}${none()}<div class="bis">${visIdx().map((i, k, vi) => [S[i], i, k, vi.length]).map(([it, i, k, vn]) => `<details class="bi" data-i="${i}" ${open.has(i) ? 'open' : ''}><summary><span class="bi-no">${k + 1}</span>${imgField && it[imgField.k] ? `<img class="bi-img" src="${h(imgSrc(it[imgField.k], imgField.base))}" alt="">` : ''}<span class="bi-t" data-sum="${i}">${h(sumOf(it, i))}</span>${ctl(i, vn, k)}</summary>
          <div class="bi-body">${def.fields.map(f => `<div class="fd">${fieldHTML(f, it[f.k], `${i}.${f.k}`, P)}</div>`).join('')}</div></details>`).join('')}</div>
          <div class="actions static"><button class="btn sm" type="button" data-act="add" ${def.max && S.length >= def.max ? 'disabled' : ''}>새 항목 추가</button>${visIdx().length > 3 ? '<button class="btn sm" type="button" data-act="openall">모두 펼치기</button>' : ''}</div>`;
      v.innerHTML = `<nav class="ptabs scroll" aria-label="${h(MENU_TITLE[menu])}">${d.siblings.map(x => `<a href="#/site/${menu}/${x.name}" class="${x.name === name ? 'on' : ''}">${h(x.label)}${x.changed ? '<i class="dot" title="처음 값과 다르게 고친 항목"></i>' : ''}</a>`).join('')}</nav>
        <div class="box info">${h(def.desc)}${def.anchor ? ` <a href="${h(def.anchor)}" target="_blank" rel="noopener">사이트에서 보기 ↗</a>` : ''}${d.changed ? '<br><small>지금은 처음 값과 다르게 고친 상태입니다.</small>' : ''}</div>
        ${body}
        <div class="actions"><button class="btn ok" id="b-save" type="button">저장하기</button>${d.changed ? '<button class="btn" id="b-reset" type="button">처음 값으로 되돌리기</button>' : ''}<a class="btn" href="${h(def.anchor || '/')}" target="_blank" rel="noopener">사이트 보기 ↗</a></div>`;
      counts();
      $('#b-save').onclick = async () => {
        $('#b-save').disabled = true;
        try { const r = await api('POST', `/api/admin/blocks/${encodeURIComponent(name)}`, { value: S }); saved(r, `「${def.label}」 내용을`); await siteBlocks(menu, name); }
        catch (e) { fail(e); if ($('#b-save')) $('#b-save').disabled = false; }
      };
      const rb = $('#b-reset');
      if (rb) rb.onclick = async () => {
        if (!confirm(`「${def.label}」을 처음 값으로 되돌릴까요? 지금까지 고친 내용이 사이트에서 사라집니다.`)) return;
        try { const r = await api('POST', `/api/admin/blocks/${encodeURIComponent(name)}`, { reset: true }); saved(r, '처음 값으로 되돌리기를'); await siteBlocks(menu, name); } catch (e) { fail(e); }
      };
    };
    draw();
    v.addEventListener('input', e => {
      const el = e.target.closest('[data-p]'); if (!el || el.tagName === 'BUTTON') return;
      let val = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.num) val = el.value === '' ? '' : +el.value;
      const p = pathOf(el.dataset.p);
      if (!p.length) S = val; else setP(S, p, val);
      if (el.type === 'color' && el.nextElementSibling) el.nextElementSibling.textContent = val;
      dirty = true; counts();
      if (def.byProduct && p[1] === 'pid') { draw(); return; }   // 상품을 바꾸면 칩 숫자·보이는 목록 다시
      if (def.list && !def.prim && typeof p[0] === 'number') { const t = v.querySelector(`[data-sum="${p[0]}"]`); if (t) t.textContent = sumOf(S[p[0]], p[0]); }
    });
    v.addEventListener('toggle', e => { const dd = e.target; if (dd.matches && dd.matches('details.bi')) { if (dd.open) open.add(+dd.dataset.i); else open.delete(+dd.dataset.i); } }, true);
    v.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      e.preventDefault();
      const act = b.dataset.act, p = pathOf(b.dataset.p ?? '');
      try {
        if (act === 'up' || act === 'down') {
          const vi = visIdx(), pos = vi.indexOf(p[0]), i = p[0], j = vi[pos + (act === 'up' ? -1 : 1)]; if (j == null) return;
          [S[i], S[j]] = [S[j], S[i]]; const oi = open.has(i), oj = open.has(j); open.delete(i); open.delete(j); if (oi) open.add(j); if (oj) open.add(i);
        } else if (act === 'del') { S.splice(p[0], 1); const next = new Set(); for (const k of open) if (k < p[0]) next.add(k); else if (k > p[0]) next.add(k - 1); open.clear(); next.forEach(k => open.add(k)); }
        else if (act === 'add') { const it = blankOf(def); if (def.byProduct) it.pid = PF || 29; S.push(it); open.add(S.length - 1); }
        else if (act === 'openall') { visIdx().forEach(i => open.add(i)); }
        else if (act === 'img') { const [f] = await pickFiles(false); if (!f) return; const x = await prepImage(f, +b.dataset.maxw || 1600, +b.dataset.ratio || 0); setP(S, p, { data: x.data, w: x.w, h: x.h }); }
        else if (act === 'add-img') { for (const f of await pickFiles(true)) { const x = await prepImage(f, +b.dataset.maxw || 1000, +b.dataset.ratio || 0), img = { data: x.data, w: x.w, h: x.h }; S.push(def.grid ? { pid: PF || 29, src: img } : img); } }
        else if (act === 'row-add') { const arr = getP(S, p) || []; arr.push(b.dataset.tuple ? ['', ''] : {}); setP(S, p, arr); }
        else if (act === 'row-del') { const arr = getP(S, p.slice(0, -1)); arr.splice(p[p.length - 1], 1); }
        else return;
        if (act !== 'openall') dirty = true;
        draw();
      } catch (err) { fail(err); }
    });
  }

  // ── 사이트 꾸미기 ② 페이지 문구·사진(템플릿의 data-edit 칸, tools/admin/edits.mjs)
  const KIND = t => /^h[1-5]$/.test(t) ? '제목' : t === 'a' || t === 'button' ? '버튼·링크' : t === 'li' ? '목록' : ['td', 'th', 'dt', 'dd'].includes(t) ? '표' : t === 'label' ? '입력칸 이름' : t === 'summary' ? '펼치기 제목' : t === 'img' ? '사진' : '글';
  const taRows = s => Math.min(10, Math.max(1, String(s).split('\n').length + Math.floor(len(s) / 70)));
  async function texts(fileKey) {
    const v = shell('페이지 문구·사진', { desc: '홈·상품 페이지·주문서·약관 등 사이트 곳곳의 글자와 사진을 고칩니다. 바꾼 칸만 저장되고, 언제든 처음 문구로 되돌릴 수 있습니다.' });
    const { files } = await api('GET', '/api/admin/texts');
    if (!files.some(f => f.key === fileKey)) fileKey = 'home';
    const d = await api('GET', `/api/admin/texts/${fileKey}`);
    const items = d.items.map(x => x.kind === 'img' ? { ...x, val: x.cur ? { ...x.cur } : null, orig: JSON.stringify(x.cur || null) } : { ...x, val: x.cur ?? x.text, orig: x.cur ?? x.text });
    const byKey = new Map(items.map(x => [x.key, x]));
    const groups = [];
    for (const it of items) { let g = groups.find(x => x.name === it.group); if (!g) groups.push(g = { name: it.group, anchor: it.anchor, list: [] }); g.list.push(it); }
    const page = d.file.page, pageBase = page.split('#')[0];
    const imgOf = it => it.val ? (it.val.data || site(it.val.src)) : site(it.src);
    const itemHTML = it => it.kind === 'img'
      ? `<div class="tx tx-img" data-k="${it.key}"><img src="${h(imgOf(it))}" alt=""><div><div class="tx-h"><span class="tag">사진</span><span class="tag draft" data-chg ${it.val ? '' : 'hidden'}>바뀜</span></div>
          <div class="actions static" style="margin-top:6px"><button class="btn sm" type="button" data-img="${it.key}">사진 바꾸기</button><button class="btn sm" type="button" data-reset="${it.key}" ${it.val ? '' : 'hidden'}>처음 사진으로</button></div>
          <label for="alt-${it.key}" class="sm">사진 설명 <small>검색엔진·화면 낭독기가 읽습니다</small></label><input type="text" id="alt-${it.key}" data-alt="${it.key}" value="${h((it.val && it.val.alt) || it.alt)}"></div></div>`
      : `<div class="tx" data-k="${it.key}"><div class="tx-h"><span class="tag">${KIND(it.tag)}</span><span class="tag draft" data-chg ${it.val !== it.text ? '' : 'hidden'}>바뀜</span><button class="btn sm" type="button" data-reset="${it.key}" ${it.val !== it.text ? '' : 'hidden'}>처음 문구로</button></div>
          <textarea data-k="${it.key}" rows="${taRows(it.val)}" aria-label="${h(KIND(it.tag))}: ${h(it.text.slice(0, 30))}">${h(it.val)}</textarea><p class="help tx-o" ${it.val !== it.text ? '' : 'hidden'}>처음 문구: ${h(it.text)}</p></div>`;
    v.innerHTML = `<div class="tx-bar"><select id="tx-file" aria-label="고칠 페이지">${files.map(f => `<option value="${f.key}" ${f.key === fileKey ? 'selected' : ''}>${h(f.label)} · ${f.count}칸${f.changed ? ` (바꾼 칸 ${f.changed})` : ''}</option>`).join('')}</select>
        <input type="search" id="tx-q" placeholder="글자로 찾기" aria-label="글자로 찾기"><label class="chk"><input type="checkbox" id="tx-ch"> 바꾼 칸만</label><a class="btn sm" href="${h(page)}" target="_blank" rel="noopener">이 페이지 보기 ↗</a></div>
      <p class="help" style="margin:0 0 14px">Enter 로 줄을 바꾸고, <b>**글자**</b> 는 굵게, <b>==글자==</b> 는 강조 색이 됩니다. 칸을 비우거나 '처음 문구로'를 누르면 원래 문구로 돌아갑니다. 저장하면 약 2분 뒤 사이트에 반영됩니다.</p>
      ${groups.map(g => `<section class="card tx-g"><div class="ch"><h2>${h(g.name || d.file.label)}</h2>${g.anchor ? `<a class="btn sm" href="${h(pageBase)}#${h(g.anchor)}" target="_blank" rel="noopener">사이트에서 보기 ↗</a>` : ''}</div>${g.list.map(itemHTML).join('')}</section>`).join('') || empty('이 페이지에는 고칠 수 있는 칸이 없습니다.')}
      <p class="empty" id="tx-none" hidden>찾는 글자가 없습니다.</p>
      <div class="actions"><button class="btn ok" id="tx-save" type="button">저장하기</button><span class="help" id="tx-n" style="align-self:center;margin:0"></span></div>`;
    const changedN = () => items.filter(it => it.kind === 'img' ? JSON.stringify(it.val) !== it.orig : it.val !== it.orig).length;
    const mark = it => {
      const box = v.querySelector(`.tx[data-k="${it.key}"]`); if (!box) return;
      const chg = it.kind === 'img' ? !!it.val : it.val !== it.text;
      box.querySelector('[data-chg]').hidden = !chg; box.querySelector('[data-reset]').hidden = !chg;
      const o = box.querySelector('.tx-o'); if (o) o.hidden = !chg;
      const n = changedN(); $('#tx-n').textContent = n ? `저장 안 한 칸 ${n}개` : '';
    };
    const filter = () => {
      const q = $('#tx-q').value.trim(), only = $('#tx-ch').checked; let any = false;
      v.querySelectorAll('.tx-g').forEach(g => {
        let vis = 0;
        g.querySelectorAll('.tx').forEach(box => { const it = byKey.get(box.dataset.k); const hay = it.kind === 'img' ? `${it.alt} ${(it.val && it.val.alt) || ''} 사진` : `${it.val} ${it.text}`; const ok = (!q || hay.includes(q)) && (!only || (it.kind === 'img' ? !!it.val : it.val !== it.text)); box.hidden = !ok; if (ok) vis++; });
        g.hidden = !vis; if (vis) any = true;
      });
      $('#tx-none').hidden = any || !items.length;
    };
    $('#tx-q').oninput = filter; $('#tx-ch').onchange = filter;
    $('#tx-file').onchange = e => { location.hash = `#/texts/${e.target.value}`; };
    v.addEventListener('input', e => {
      const ta = e.target.closest('textarea[data-k]'), al = e.target.closest('[data-alt]');
      if (ta) { const it = byKey.get(ta.dataset.k); it.val = ta.value; ta.rows = taRows(ta.value); dirty = true; mark(it); }
      if (al) { const it = byKey.get(al.dataset.alt); it.val = { ...(it.val || { src: it.src, w: it.w, h: it.h }), alt: al.value }; if (!it.val.data && it.val.src === it.src && (al.value.trim() === it.alt || !al.value.trim())) it.val = null; dirty = true; mark(it); }
    });
    v.addEventListener('click', async e => {
      const rb = e.target.closest('[data-reset]'), ib = e.target.closest('[data-img]');
      if (rb) {
        const it = byKey.get(rb.dataset.reset), box = v.querySelector(`.tx[data-k="${it.key}"]`);
        if (it.kind === 'img') { it.val = null; box.querySelector('img').src = site(it.src); box.querySelector('[data-alt]').value = it.alt; }
        else { it.val = it.text; const ta = box.querySelector('textarea'); ta.value = it.text; ta.rows = taRows(it.text); }
        dirty = true; mark(it);
      }
      if (ib) {
        const it = byKey.get(ib.dataset.img);
        try { const [f] = await pickFiles(false); if (!f) return; const x = await prepImage(f, 1600, it.w && it.h ? it.w / it.h : 0); it.val = { data: x.data, w: x.w, h: x.h, alt: v.querySelector(`[data-alt="${it.key}"]`).value }; v.querySelector(`.tx[data-k="${it.key}"] img`).src = x.data; dirty = true; mark(it); toast('원래 사진과 같은 비율로 맞춰 잘랐습니다'); }
        catch (err) { fail(err); }
      }
    });
    $('#tx-save').onclick = async () => {
      const text = {}, img = {};
      for (const it of items) {
        if (it.kind === 'img') { if (JSON.stringify(it.val) !== it.orig) img[it.key] = it.val; }
        else if (it.val !== it.orig) text[it.key] = it.val;
      }
      if (!Object.keys(text).length && !Object.keys(img).length) { toast('바꾼 칸이 없습니다'); return; }
      $('#tx-save').disabled = true;
      try { const r = await api('POST', `/api/admin/texts/${fileKey}`, { text, img }); saved(r, `「${d.file.label}」 문구를`); await texts(fileKey); }
      catch (err) { fail(err); if ($('#tx-save')) $('#tx-save').disabled = false; }
    };
  }

  // ── 상품정보 제공고시(상품 안 세 번째 탭)
  async function noticeEdit(id) {
    const v = shell('상품', { back: ['#/products', '상품 목록'] });
    const [{ product: p }, n] = await Promise.all([api('GET', `/api/admin/products/${id}`), api('GET', `/api/admin/notice/${id}`)]);
    $('#ttl').textContent = p.short;
    let rows = clone(n.rows).map(r => [r[0], (r[1] || []).join('\n')]);
    const draw = () => {
      v.innerHTML = `${ptabs(id, 'notice')}<div class="card"><h2>상품정보 제공고시</h2><p class="h-sub">상품 페이지 아래쪽 표입니다(전자상거래법 표시 항목). 내용은 한 줄이 한 줄로 보입니다.</p>
        ${rows.length ? '' : '<div class="box warn">아직 표가 없습니다. 항목을 추가해 주세요(예: 소재, 색상, 치수, 제품 구성, 제조자, 제조국, 세탁 방법 및 취급 시 주의사항, 품질보증기준, A/S 책임자와 전화번호).</div>'}
        <div class="items">${rows.map((r, i) => `<div class="nrow"><div><label for="nt-${i}" class="sm">항목</label><input type="text" id="nt-${i}" data-n="${i}.0" value="${h(r[0])}" placeholder="예: 소재"></div>
          <div><label for="nv-${i}" class="sm">내용</label><textarea id="nv-${i}" data-n="${i}.1" rows="${Math.min(6, r[1].split('\n').length + 1)}" style="min-height:0">${h(r[1])}</textarea></div>
          <div class="ctl"><button class="btn sm" type="button" data-mv="${i}" data-d="-1" ${i ? '' : 'disabled'} aria-label="위로">↑</button><button class="btn sm" type="button" data-mv="${i}" data-d="1" ${i < rows.length - 1 ? '' : 'disabled'} aria-label="아래로">↓</button><button class="btn sm danger" type="button" data-rm="${i}">빼기</button></div></div>`).join('')}</div>
        <div class="actions static"><button class="btn sm" type="button" id="n-add">항목 추가</button></div></div>
        <div class="actions"><button class="btn ok" id="n-save" type="button">저장하기</button>${n.changed ? '<button class="btn" id="n-reset" type="button">처음 값으로 되돌리기</button>' : ''}<a class="btn" href="/product-${id}.html" target="_blank" rel="noopener">상품 페이지 보기 ↗</a></div>`;
      v.querySelectorAll('[data-n]').forEach(el => el.oninput = () => { const [i, k] = el.dataset.n.split('.').map(Number); rows[i][k] = el.value; dirty = true; });
      v.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const i = +b.dataset.mv, j = i + +b.dataset.d; [rows[i], rows[j]] = [rows[j], rows[i]]; dirty = true; draw(); });
      v.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { rows.splice(+b.dataset.rm, 1); dirty = true; draw(); });
      $('#n-add').onclick = () => { rows.push(['', '']); dirty = true; draw(); };
      $('#n-save').onclick = async () => { $('#n-save').disabled = true; try { const r = await api('POST', `/api/admin/notice/${id}`, { rows }); saved(r, '상품정보 제공고시를'); noticeEdit(id); } catch (e) { fail(e); $('#n-save').disabled = false; } };
      const rb = $('#n-reset'); if (rb) rb.onclick = async () => { if (!confirm('제공고시를 처음 값으로 되돌릴까요?')) return; try { const r = await api('POST', `/api/admin/notice/${id}`, { reset: true }); saved(r, '되돌리기를'); noticeEdit(id); } catch (e) { fail(e); } };
    };
    draw();
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
    const v = shell('계정 관리', { desc: '총괄 관리자·잠스쿨 관리자 계정. 비밀번호는 새로 만들 때 한 번만 보입니다.' });
    const { users: list, canWrite } = await api('GET', '/api/admin/users');
    v.innerHTML = `${canWrite ? '' : '<div class="box warn">계정 추가·비밀번호 변경은 Railway 볼륨(DATA_DIR) 연결 뒤에 됩니다. 지금은 Railway 변수 ADMIN_USERS 로 읽기만 합니다.</div>'}
      <div id="pwbox"></div><div class="card"><table class="list"><thead><tr><th>아이디</th><th>이름</th><th>권한</th><th></th></tr></thead><tbody>${list.map(u => `<tr><td>${h(u.id)}</td><td>${h(u.name)}</td><td>${u.role === 'owner' ? '<span class="tag ai">총괄 관리자</span>' : '<span class="tag">잠스쿨 관리자</span>'}</td>
        <td>${canWrite ? `<button class="btn sm" data-reset="${h(u.id)}">비밀번호 새로 만들기</button> ${u.id === ME.user.id ? '' : `<button class="btn sm danger" data-del="${h(u.id)}">삭제</button>`}` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${canWrite ? `<div class="card"><h2>계정 추가</h2><div class="row"><div><label for="u-id">아이디</label><input type="text" id="u-id" placeholder="영문 소문자·숫자"></div><div><label for="u-name">이름</label><input type="text" id="u-name"></div><div><label for="u-role">권한</label><select id="u-role"><option value="client">잠스쿨 관리자</option><option value="owner">총괄 관리자</option></select></div></div><div class="actions static"><button class="btn pri" id="u-add">추가하기</button></div></div>` : ''}`;
    const showPw = (id, pw) => { $('#pwbox').innerHTML = `<div class="box ok"><b>${h(id)}</b> 계정의 새 비밀번호: <span class="pw">${h(pw)}</span><p class="help">지금 한 번만 보입니다. 본인에게 안전하게 전달하고, 첫 로그인 뒤 '내 계정'에서 바꾸게 하세요.</p></div>`; };
    v.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => { if (!confirm(`${b.dataset.reset} 의 비밀번호를 새로 만들까요? 지금 비밀번호는 바로 막힙니다.`)) return; try { const r = await api('POST', '/api/admin/users', { action: 'reset', id: b.dataset.reset }); showPw(b.dataset.reset, r.password); } catch (e) { fail(e); } });
    v.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm(`${b.dataset.del} 계정을 삭제할까요?`)) return; try { await api('POST', '/api/admin/users', { action: 'delete', id: b.dataset.del }); users(); } catch (e) { fail(e); } });
    const add = $('#u-add'); if (add) add.onclick = async () => { try { const id = $('#u-id').value.trim(); const r = await api('POST', '/api/admin/users', { action: 'create', id, name: $('#u-name').value, role: $('#u-role').value }); await users(); showPw(id, r.password); } catch (e) { fail(e); } };
  }
  // 서버·데이터 옮기기: Railway 볼륨(DATA_DIR) 내용을 파일 한 개로 내보내고, 새 서버에서 가져온다
  async function dataMove() {
    const v = shell('서버·데이터 옮기기', { desc: 'Railway 볼륨에 있는 어드민 계정·결제 주문·결제 설정·방문 집계를 파일 한 개로 내보내고, 다른 Railway 서버에서 가져옵니다.' });
    const d = await api('GET', '/api/admin/data');
    const kb = n => n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
    const when = s => s ? new Date(s).toLocaleString('ko-KR') : '-';
    const rw = d.railway, where = [rw.project && `프로젝트 ${rw.project}`, rw.service && `서비스 ${rw.service}`, rw.environment].filter(Boolean).join(' · ');
    const persist = !d.dataDir ? '<span class="tag bad">볼륨 없음</span>' : d.volumeCreated && d.volumeCreated < d.serverStarted ? '<span class="tag live">재배포 뒤에도 유지됨</span>' : '<span class="tag">아직 확인 전(한 번 재배포 뒤 다시 보기)</span>';
    const C = d.counts;
    v.innerHTML = `<div class="card"><h2>지금 접속한 서버</h2>
        <table class="list"><tbody>
          <tr><th>주소</th><td><b>${h(d.host)}</b>${rw.domain && rw.domain !== d.host ? ` <small>(Railway 주소 ${h(rw.domain)})</small>` : ''}</td></tr>
          <tr><th>Railway</th><td>${h(where || '알 수 없음')}</td></tr>
          <tr><th>볼륨</th><td>${d.dataDir ? `${h(d.dataDir)} · 처음 쓴 시각 ${h(when(d.volumeCreated))} · 서버 시작 ${h(when(d.serverStarted))} ${persist}` : '<span class="tag bad">DATA_DIR 없음 — 주문·계정·집계가 재배포 때 사라집니다</span>'}</td></tr>
          <tr><th class="nw">들어 있는 것</th><td>파일 ${d.files}개(${kb(d.bytes)}) — 어드민 계정 ${C.users ? '있음' : '없음'}, 결제 주문 ${C.orders}건, 결제 켜기 설정 ${C.settings ? '있음' : '없음'}, 방문 집계 ${C.analytics}일${C.other ? `, 기타 ${C.other}개` : ''}</td></tr>
        </tbody></table></div>
      <div class="card"><h2>Railway 변수 확인</h2><p class="help">값은 보이지 않고 넣었는지만 표시합니다. 새 서버에서도 같은 항목이 '있음'이어야 합니다.</p>
        <table class="list"><tbody>${d.env.map(e => `<tr><td class="nw"><code>${h(e.name)}</code></td><td>${e.set ? '<span class="tag live">있음</span>' : '<span class="tag">없음</span>'}</td><td>${h(e.what)}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><h2>1. 내보내기 (옮기기 전 서버에서)</h2>
        <p>볼륨 파일 전체를 <b>jamschool-data-날짜.json</b> 한 개로 내려받습니다. 결제 주문에는 손님 이름·연락처·배송지가 들어 있으니, 새 서버에 가져온 뒤 PC 에서 지워 주세요.</p>
        <p class="help">내보낸 뒤 들어온 주문은 파일에 없습니다. 도메인을 옮기기 직전에 내보내거나, 잠시 '결제 주문'에서 홈페이지 결제를 꺼 두세요.</p>
        <div class="actions static"><button class="btn pri" id="d-export" ${d.dataDir ? '' : 'disabled'}>데이터 내보내기</button></div></div>
      <div class="card"><h2>2. 가져오기 (새 서버에서)</h2>
        <p>내보낸 파일을 고르면 같은 이름의 파일은 파일 내용으로 바뀝니다. 바뀌기 전 파일은 볼륨의 <code>_before-import</code> 폴더에 남겨 둡니다.</p>
        <p class="help">어드민 계정도 옛 서버 것으로 바뀌므로, 가져온 뒤에는 옛 서버의 아이디·비밀번호로 다시 로그인합니다.</p>
        ${d.backups.length ? `<p class="help">이전 가져오기 보관본: ${d.backups.map(h).join(', ')}</p>` : ''}
        <div class="actions static"><button class="btn" id="d-import" ${d.dataDir ? '' : 'disabled'}>파일 골라 가져오기</button></div><div id="d-result"></div></div>`;
    $('#d-export').onclick = async () => {
      try {
        const b = await api('POST', '/api/admin/data-export');
        const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `jamschool-data-${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/\D/g, '')}.json`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        toast(`내보냈습니다: 파일 ${b.files.length}개(주문 ${b.counts.orders}건 · 집계 ${b.counts.analytics}일)`);
      } catch (e) { fail(e); }
    };
    $('#d-import').onclick = () => {
      const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/json,.json';
      i.onchange = async () => {
        const f = i.files[0]; if (!f) return;
        let b; try { b = JSON.parse(await f.text()); } catch { fail(new Error('파일을 읽지 못했습니다(JSON 아님)')); return; }
        if (!b || b.format !== 'jamschool-data' || !Array.isArray(b.files)) { fail(new Error('잠스쿨 데이터 파일이 아닙니다')); return; }
        const c = b.counts || {};
        if (!confirm(`${b.from || '알 수 없는 서버'}에서 ${new Date(b.exportedAt).toLocaleString('ko-KR')}에 내보낸 파일입니다.\n파일 ${b.files.length}개(계정 ${c.users ? '있음' : '없음'} · 주문 ${c.orders || 0}건 · 집계 ${c.analytics || 0}일)를\n지금 서버(${d.host})에 가져올까요?`)) return;
        try {
          const r = await api('POST', '/api/admin/data-import', { bundle: b });
          $('#d-result').innerHTML = `<div class="box ok">가져왔습니다: 파일 ${r.written}개(계정 ${r.counts.users ? '있음' : '없음'} · 주문 ${r.counts.orders}건 · 결제 설정 ${r.counts.settings ? '있음' : '없음'} · 집계 ${r.counts.analytics}일)${r.replaced ? ` · 바뀐 파일 ${r.replaced}개의 원래 내용은 ${h(r.keptIn)} 에 보관` : ''}. 계정이 바뀌었으면 다시 로그인해 주세요.</div>`;
          setTimeout(() => api('GET', '/api/admin/me').then(m => { ME = m; if (!ME.user) render(); else dataMove(); }).catch(() => {}), 2500);
        } catch (e) { fail(e); }
      };
      i.click();
    };
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
      else if (a === 'products' && b && route()[2] === 'notice') await noticeEdit(b);
      else if (a === 'site') await siteBlocks(b, route()[2], route()[3]);
      else if (a === 'texts') await texts(b);
      else if (a === 'products' && b) await productEdit(b);
      else if (a === 'products') await productList();
      else if (a === 'detail') { location.replace(b ? `#/products/${b}/detail` : '#/products'); return; }
      else if (a === 'traffic') await traffic();
      else if (a === 'orders') await orders();
      else if (a === 'payments' && b && b !== 'all') await payDetail(b);
      else if (a === 'payments') await payments();
      else if (a === 'me') await me();
      else if (owner && a === 'settings') await settings();
      else if (owner && a === 'topics') await topics();
      else if (owner && a === 'check') await check();
      else if (owner && a === 'log') await log();
      else if (owner && a === 'users') await users();
      else if (owner && a === 'data') await dataMove();
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
