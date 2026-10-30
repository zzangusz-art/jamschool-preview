// AI 노출 주간·월간 리포트(HTML + PDF) — 하나회원권 build-weekly-new-exposure.js·build-monthly-report.js 의 잠스쿨판
//   node tools/monitor/report.mjs --period week   [--end 2026-11-01]   기간 = end 포함 7일(기본 end = 어제), 비교 = 그 앞 7일
//   node tools/monitor/report.mjs --period month  [--month 2026-11]    기간 = 그 달(기본 = 어제가 속한 달), 비교 = 앞 달
// 출력: 보고/잠스쿨_주간리포트_<end>.html·.pdf, 보고/잠스쿨_월간리포트_<YYYY-MM>.html·.pdf
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseFrontmatter } from '../blog/lib.mjs';
import { AI_DIR, BLOG_DIR, CFG, REPORT_DIR, SITE_ROOT, addDays, arg, findChrome, kstDate, loadEnv, readCsv, safe } from './lib.mjs';

loadEnv();
const period = arg('period', 'week');
const yesterday = addDays(kstDate(), -1);
let from, to, pFrom, pTo, label, outName;
if (period === 'month') {
  const ym = arg('month', yesterday.slice(0, 7));
  from = `${ym}-01`; to = addDays(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 1)).toISOString().slice(0, 10), -1);
  const pm = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
  pFrom = `${pm}-01`; pTo = addDays(from, -1); label = `${ym.replace('-', '년 ')}월 월간`; outName = `잠스쿨_월간리포트_${ym}`;
} else {
  to = arg('end', yesterday); from = addDays(to, -6); pTo = addDays(from, -1); pFrom = addDays(pTo, -6);
  label = `주간(${from} ~ ${to})`; outName = `잠스쿨_주간리포트_${to}`;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rows = readCsv();
const inRange = (r, a, b) => r.date >= a && r.date <= b;
const cur = rows.filter(r => inRange(r, from, to)), prev = rows.filter(r => inRange(r, pFrom, pTo));
const valid = list => list.filter(r => !r.blocked && !r.error);
const hit = r => r.site || r.mall;
const ENG = { naver: '네이버', bing: 'Bing', google: '구글', claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', naverweb: '네이버 웹문서 API', naverblog: '네이버 블로그 API' };
const engines = [...new Set(cur.map(r => r.engine))].sort((a, b) => Object.keys(ENG).indexOf(a) - Object.keys(ENG).indexOf(b));
const days = [...new Set(cur.map(r => r.date))].sort();

// KPI
const kpi = list => { const v = valid(list); return { n: v.length, site: v.filter(r => r.site).length, mall: v.filter(r => r.mall).length, brand: v.filter(r => r.brand).length, days: new Set(list.map(r => r.date)).size,
  qSite: new Set(v.filter(r => r.site).map(r => r.query)).size, qHit: new Set(v.filter(hit).map(r => r.query)).size }; };
const K = kpi(cur), P = kpi(prev);
const delta = (a, b) => (prev.length ? (a - b > 0 ? `<span class="up">▲${a - b}</span>` : a - b < 0 ? `<span class="down">▼${b - a}</span>` : '<span class="eq">–</span>') : '');
const rate = (a, n) => (n ? Math.round(a / n * 100) + '%' : '—');

// 엔진별
const engRows = engines.map(e => { const all = cur.filter(r => r.engine === e), v = valid(all);
  return `<tr><th>${ENG[e] || e}</th><td>${v.length}/${all.length}</td><td>${v.filter(r => r.site).length}</td><td>${v.filter(r => r.mall).length}</td><td>${v.filter(r => r.brand).length}</td><td>${all.filter(r => r.blocked).length || ''}</td><td>${rate(v.filter(r => hit(r) || r.brand).length, v.length)}</td></tr>`; }).join('');

// 질의 × 엔진(기간 마지막 측정일 기준)
const lastDay = days[days.length - 1];
const sym = r => !r ? '<td class="na">·</td>' : r.blocked ? '<td class="blk" title="차단">×</td>' : r.error ? '<td class="na" title="오류">!</td>'
  : `<td class="${r.site ? 's' : r.mall ? 'm' : r.brand ? 'b' : 'n'}">${r.site ? '●' : r.mall ? '◐' : r.brand ? '○' : '–'}${r.rank && (r.site || r.mall) ? `<small>${r.rank}</small>` : ''}</td>`;
const qRows = CFG.queries.map(x => `<tr><th>${esc(x.q)}<small>${esc(x.type)}</small></th>${engines.map(e => sym(cur.find(r => r.date === lastDay && r.engine === e && r.query === x.q))).join('')}<td>${cur.filter(r => r.query === x.q && !r.blocked && !r.error && (hit(r) || r.brand)).length}/${valid(cur.filter(r => r.query === x.q)).length}</td></tr>`).join('');

// 신규·사라진 노출(엔진×질의, 공식 홈·공식몰 기준)
const pairs = list => new Set(valid(list).filter(hit).map(r => `${r.engine}\t${r.query}`));
const curP = pairs(cur), prevP = pairs(prev);
const firstHit = key => cur.filter(r => `${r.engine}\t${r.query}` === key && hit(r)).sort((a, b) => a.date.localeCompare(b.date))[0];
const newP = [...curP].filter(k => !prevP.has(k)).map(firstHit), lostP = [...prevP].filter(k => !curP.has(k)).map(k => k.split('\t'));
const shotOf = r => { const f = path.join(AI_DIR, r.date, `${r.engine}_${safe(r.query)}.jpg`); return fs.existsSync(f) ? pathToFileURL(f).href : ''; };
const newHtml = newP.length ? `<div class="cards">${newP.slice(0, 8).map(r => `<figure>${shotOf(r) ? `<img src="${shotOf(r)}" alt="">` : '<div class="noimg">AI 답변(글)</div>'}<figcaption><b>${ENG[r.engine] || r.engine}</b> · ${esc(r.query)}<br>${r.site ? '공식 홈' : '공식몰·스마트스토어'} 첫 노출 ${r.date}${r.rank ? ` · 링크 ${r.rank}번째` : ''}</figcaption></figure>`).join('')}</div>${newP.length > 8 ? `<p class="note">외 ${newP.length - 8}건</p>` : ''}`
  : `<p class="note">${prev.length ? '지난 기간에 없던 새 노출은 없습니다.' : '비교할 지난 기간 측정이 없어 이번 기간 노출을 기준선으로 삼습니다.'}</p>`;
const lostHtml = lostP.length ? `<ul>${lostP.map(([e, q]) => `<li>${ENG[e] || e} · ${esc(q)}</li>`).join('')}</ul>` : '<p class="note">없음</p>';

// 날짜별 추이(SVG)
const trend = (() => {
  if (days.length < 2) return '<p class="note">측정일이 2일 이상 쌓이면 추이 그래프가 나옵니다.</p>';
  const series = [['공식 홈·공식몰', '#2E7FD9', d => valid(cur.filter(r => r.date === d)).filter(hit).length], ['상호 언급', '#14A38B', d => valid(cur.filter(r => r.date === d)).filter(r => r.brand).length]];
  const W = 720, H = 220, pad = 34, max = Math.max(1, ...days.flatMap(d => series.map(s => s[2](d))));
  const x = i => pad + i * (W - pad * 2) / (days.length - 1), y = v => H - pad - v * (H - pad * 2) / max;
  const grid = [0, Math.round(max / 2), max].map(v => `<line x1="${pad}" x2="${W - pad}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${pad - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const lines = series.map(([n, c, f]) => `<polyline fill="none" stroke="${c}" stroke-width="2.5" points="${days.map((d, i) => `${x(i)},${y(f(d))}`).join(' ')}"/>${days.map((d, i) => `<circle cx="${x(i)}" cy="${y(f(d))}" r="3" fill="${c}"/>`).join('')}`).join('');
  const xl = days.map((d, i) => (days.length <= 10 || i % Math.ceil(days.length / 8) === 0) ? `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${d.slice(5)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">${grid}${lines}${xl}</svg><p class="legend">${series.map(([n, c]) => `<span style="--c:${c}">${n}</span>`).join('')}</p>`;
})();

// 경쟁사 언급
const comp = {}; for (const r of valid(cur)) for (const c of r.competitors) comp[c] = (comp[c] || 0) + 1;
const compHtml = Object.keys(comp).length ? `<table class="t"><tr><th>브랜드</th><th>언급 건수</th></tr>${Object.entries(comp).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, n]) => `<tr><td>${esc(c)}</td><td>${n}</td></tr>`).join('')}</table>` : '<p class="note">없음</p>';

// 블로그
const CONTENT = path.join(SITE_ROOT, 'content/blog');
const posts = fs.readdirSync(CONTENT).filter(f => f.endsWith('.md')).map(f => parseFrontmatter(fs.readFileSync(path.join(CONTENT, f), 'utf8')).meta).filter(m => m.date >= from && m.date <= to).sort((a, b) => a.date.localeCompare(b.date));
const kcFiles = fs.existsSync(BLOG_DIR) ? fs.readdirSync(BLOG_DIR).filter(f => /^키워드점검_\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(6, 16) <= to).sort() : [];
const kc = kcFiles.length ? JSON.parse(fs.readFileSync(path.join(BLOG_DIR, kcFiles[kcFiles.length - 1]), 'utf8')) : null;
const blogHtml = `<p>기간 중 새 글 <b>${posts.length}편</b>${kc ? ` · 대기열 ${kc.todo}편(소진 예상 ${kc.runOut}) · 마지막 키워드 점검 ${kc.date}` : ''}</p>
${posts.length ? `<table class="t"><tr><th>날짜</th><th>제목</th><th>대표 키워드</th></tr>${posts.map(m => `<tr><td>${m.date}</td><td><a href="https://jamschool.kr/blog/${esc(m.slug)}.html">${esc(m.title)}</a></td><td>${esc(m.keyword)}</td></tr>`).join('')}</table>` : ''}
${kc ? `<h3>키워드 점검</h3><ul>${(kc.warn.length ? kc.warn.map(w => `<li class="w">${esc(w)}</li>`) : ['<li>겹치는 대표 키워드·비슷한 제목 없음</li>']).join('')}${kc.info.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="note">키워드 점검 기록이 없습니다.</p>'}`;

// 다음 할 일(데이터에서 자동으로)
const todo = [];
const missing = [['ANTHROPIC_API_KEY', 'Claude'], ['OPENAI_API_KEY', 'ChatGPT'], ['GEMINI_API_KEY', 'Gemini'], ['PERPLEXITY_API_KEY', 'Perplexity'], ['NAVER_CLIENT_ID', '네이버 검색 API']].filter(([k]) => !process.env[k]).map(([, n]) => n);
if (missing.length) todo.push(`AI 답변 측정 키 없음: ${missing.join(', ')} — 측정/.env 에 넣으면 다음 측정부터 포함`);
const blk = engines.filter(e => cur.some(r => r.engine === e && r.blocked));
if (blk.length) todo.push(`검색 결과 화면이 차단된 엔진: ${blk.map(e => ENG[e] || e).join(', ')} — 차단을 피하는 설정은 쓰지 않으므로, 서치콘솔·웹마스터도구의 노출 수치로 보완`);
if (!K.site) todo.push('공식 홈(jamschool.kr) 노출 아직 없음 — 서치어드바이저·서치콘솔 사이트맵 제출과 수집 요청 확인, 상품·블로그 글 색인 대기');
const zero = CFG.queries.filter(x => x.type !== '브랜드' && !valid(cur.filter(r => r.query === x.q)).some(r => hit(r) || r.brand)).map(x => x.q);
if (zero.length) todo.push(`잠스쿨이 한 번도 안 보인 질의: ${zero.join(', ')} — 이 키워드로 블로그 글·FAQ 보강 우선`);
if (kc && kc.warn.length) todo.push(...kc.warn.map(w => `블로그: ${w}`));
const topComp = Object.entries(comp).sort((a, b) => b[1] - a[1])[0];
if (topComp) todo.push(`가장 많이 함께 보인 경쟁 브랜드: ${topComp[0]}(${topComp[1]}건) — 같은 질의에서 잠스쿨만의 근거(국내 생산·시험 성적·보증)를 앞세운 글로 대응`);

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>잠스쿨 AI 노출 ${label} 리포트</title><style>
@page{size:A4;margin:14mm}body{margin:0;color:#0E2440;font:13px/1.65 'Malgun Gothic','Noto Sans KR',sans-serif;background:#fff}
.wrap{max-width:900px;margin:0 auto;padding:28px 18px}h1{font-size:24px;margin:0}h2{font-size:17px;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid #E3EAF2}h3{font-size:14px;margin:16px 0 6px}
.sub{color:#4A5B70;margin:4px 0 18px}.kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.kpi div{background:#F4F7FA;border-radius:10px;padding:12px}.kpi b{display:block;font-size:22px}.kpi span{color:#4A5B70;font-size:12px}
.up{color:#14A38B;font-weight:700}.down{color:#D9472E;font-weight:700}.eq{color:#8A98A8}
table.t,table.q{width:100%;border-collapse:collapse;margin:6px 0}table.t th,table.t td,table.q th,table.q td{border-bottom:1px solid #E3EAF2;padding:6px 8px;text-align:left}table.t th{background:#F4F7FA}
table.q td{text-align:center;font-size:15px}table.q th small{display:block;color:#8A98A8;font-weight:400;font-size:11px}table.q td small{font-size:10px;color:#4A5B70;margin-left:2px}
td.s{color:#2E7FD9}td.m{color:#5A6FD6}td.b{color:#14A38B}td.n,td.na{color:#C3CCD6}td.blk{color:#D9472E}
.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}figure{margin:0;border:1px solid #E3EAF2;border-radius:10px;overflow:hidden}figure img{width:100%;height:220px;object-fit:cover;object-position:top;display:block}.noimg{height:80px;display:grid;place-items:center;background:#F4F7FA;color:#4A5B70}figcaption{padding:8px 10px;font-size:12px}
.chart{width:100%;height:auto}.chart text{font-size:11px;fill:#4A5B70}.chart .g{stroke:#E3EAF2}.legend span{display:inline-flex;align-items:center;margin-right:14px}.legend span::before{content:'';width:12px;height:3px;background:var(--c);margin-right:6px}
.note{color:#4A5B70}li.w{color:#B3261E}ul{padding-left:18px}.foot{margin-top:30px;color:#8A98A8;font-size:11px}a{color:#2E7FD9}
</style></head><body><div class="wrap">
<h1>잠스쿨 AI 검색 노출 ${esc(label)} 리포트</h1>
<p class="sub">기간 ${from} ~ ${to} · 측정 ${K.days}일 · 비교 ${prev.length ? `${pFrom} ~ ${pTo}` : '없음(첫 기간)'} · 질의 ${CFG.queries.length}개 · 엔진 ${engines.map(e => ENG[e] || e).join(', ') || '없음'}</p>
<div class="kpi">
<div><b>${K.site} ${delta(K.site, P.site)}</b><span>공식 홈(jamschool.kr) 노출 · 질의 ${K.qSite}개</span></div>
<div><b>${K.mall} ${delta(K.mall, P.mall)}</b><span>공식몰·스마트스토어 노출</span></div>
<div><b>${K.brand} ${delta(K.brand, P.brand)}</b><span>잠스쿨 상호 언급</span></div>
<div><b>${rate(valid(cur).filter(r => hit(r) || r.brand).length, K.n)}</b><span>유효 측정 ${K.n}건 중 잠스쿨이 보인 비율</span></div>
</div>
<h2>날짜별 추이</h2>${trend}
<h2>새로 보이기 시작한 곳</h2>${newHtml}
<h3>지난 기간엔 보였지만 이번엔 안 보인 곳</h3>${lostHtml}
<h2>질의별 현황 <small class="note">(${lastDay || '—'} 측정 · ● 공식 홈 ◐ 공식몰·스마트스토어 ○ 상호 언급 – 없음 × 차단 · 작은 숫자 = 링크 순서)</small></h2>
<table class="q"><tr><th>질의</th>${engines.map(e => `<th>${ENG[e] || e}</th>`).join('')}<th>기간 노출</th></tr>${qRows}</table>
<h2>엔진별</h2><table class="t"><tr><th>엔진</th><th>유효/전체</th><th>공식 홈</th><th>공식몰</th><th>상호</th><th>차단</th><th>잠스쿨 보인 비율</th></tr>${engRows}</table>
<h2>함께 보인 경쟁 브랜드</h2>${compHtml}
<h2>블로그(수면 가이드)</h2>${blogHtml}
<h2>다음 할 일</h2><ul>${todo.map(t => `<li>${esc(t)}</li>`).join('') || '<li>없음</li>'}</ul>
<p class="foot">측정 방법: 검색 결과 화면(네이버·Bing·구글)은 실제 크롬으로 열어 캡처 후 본문·링크에서 jamschool.kr·jamschool.co.kr·스마트스토어(healingq)·상호를 찾음. 차단 화면이 나오면 그날은 건너뜀. AI 답변(Claude·ChatGPT·Gemini·Perplexity)은 공식 API 에 웹 검색을 켜고 같은 질문을 해 답변·인용 링크로 판정. 원본: 측정/AI검색/&lt;날짜&gt;/, 추이.csv. 생성 ${kstDate()}.</p>
</div></body></html>`;

fs.mkdirSync(REPORT_DIR, { recursive: true });
const htmlPath = path.join(REPORT_DIR, outName + '.html');
fs.writeFileSync(htmlPath, html, 'utf8');
const chrome = findChrome();
if (chrome && !process.argv.includes('--no-pdf')) {
  const { default: puppeteer } = await import('puppeteer-core');
  const b = await puppeteer.launch({ executablePath: chrome, headless: true });
  try { const pg = await b.newPage(); await pg.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' }); await pg.pdf({ path: path.join(REPORT_DIR, outName + '.pdf'), format: 'A4', printBackground: true }); }
  finally { await b.close(); }
}
console.log(`리포트: 보고/${outName}.html${chrome ? ' · .pdf' : ''} (측정 ${cur.length}건, 신규 노출 ${newP.length})`);
