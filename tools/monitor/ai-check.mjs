// AI 검색·검색엔진 노출 일일 측정 — 하나회원권 hana-site/scripts/ai-capture.js 를 잠스쿨용으로 옮김
//   node tools/monitor/ai-check.mjs                       키가 있는 AI API + 검색 결과 화면(네이버·Bing·구글) 전부
//   node tools/monitor/ai-check.mjs --engines naver,claude --queries "3단 접이식 매트리스,잠스쿨"
// 결과: 측정/AI검색/<날짜>/ result.json · 요약_<날짜>.md · 엔진_질의.jpg/.txt, 누적 측정/AI검색/추이.csv
// 하나회원권 스크립트와 다른 점: 검색엔진 봇 감지를 피하는 설정(webdriver 숨김·AutomationControlled 끄기·차단 뒤 재시도)은 쓰지 않는다.
//   차단 화면이 나오면 그날 그 엔진은 건너뛴다(blocked=1). 대화형 AI는 웹 화면 자동 조작 대신 공식 API(키가 있을 때만).
import fs from 'node:fs';
import path from 'node:path';
import { AI_DIR, CFG, arg, findChrome, judge, kstDate, loadEnv, safe, writeRows } from './lib.mjs';

loadEnv();
const env = k => process.env[k] || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cut = (s, n = 20000) => String(s || '').slice(0, n);

// ── AI API: 질문(ask)에 웹 검색을 켜고 답하게 한 뒤, 답변 글과 인용 링크로 판정
const API = {
  claude: {
    key: 'ANTHROPIC_API_KEY',
    async run(ask) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic();
      const messages = [{ role: 'user', content: ask }];
      let text = '', links = [];
      for (let turn = 0; turn < 3; turn++) {   // 서버 도구가 길어지면 pause_turn 으로 끊겨 오므로 이어서 받는다
        const res = await client.messages.create({ model: env('CLAUDE_MODEL') || 'claude-sonnet-5-5', max_tokens: 2048,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }], messages });
        for (const b of res.content) {
          if (b.type === 'text') { text += b.text; for (const c of b.citations || []) if (c.url) links.push({ url: c.url, title: c.title }); }
          if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url) links.push({ url: r.url, title: r.title });
        }
        if (res.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: res.content });
      }
      return { text, links };
    },
  },
  chatgpt: {
    key: 'OPENAI_API_KEY',
    async run(ask) {
      const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: env('OPENAI_MODEL') || 'gpt-5', tools: [{ type: 'web_search' }], input: ask }) });
      const j = await res.json(); if (!res.ok) throw new Error(j.error?.message || res.status);
      let text = ''; const links = [];
      for (const o of j.output || []) for (const c of o.content || []) if (c.type === 'output_text') {
        text += c.text; for (const a of c.annotations || []) if (a.url) links.push({ url: a.url, title: a.title });
      }
      return { text, links };
    },
  },
  gemini: {
    key: 'GEMINI_API_KEY',
    async run(ask) {
      const model = env('GEMINI_MODEL') || 'gemini-2.5-flash';
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST',
        headers: { 'x-goog-api-key': env('GEMINI_API_KEY'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: ask }] }], tools: [{ google_search: {} }] }) });
      const j = await res.json(); if (!res.ok) throw new Error(j.error?.message || res.status);
      const c = (j.candidates || [])[0] || {};
      const text = (c.content?.parts || []).map(p => p.text || '').join('');
      const links = (c.groundingMetadata?.groundingChunks || []).map(g => g.web).filter(Boolean).map(w => ({ url: w.uri, title: w.title }));   // title 이 출처 도메인
      return { text, links };
    },
  },
  perplexity: {
    key: 'PERPLEXITY_API_KEY',
    async run(ask) {
      const res = await fetch('https://api.perplexity.ai/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${env('PERPLEXITY_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: env('PERPLEXITY_MODEL') || 'sonar', messages: [{ role: 'user', content: ask }] }) });
      const j = await res.json(); if (!res.ok) throw new Error(j.error?.message || res.status);
      const links = (j.search_results || []).map(r => ({ url: r.url, title: r.title })).concat((j.citations || []).map(u => ({ url: u })));
      return { text: j.choices?.[0]?.message?.content || '', links };
    },
  },
  // 네이버 검색 API(developers.naver.com 애플리케이션, 검색 API 사용): 웹문서 상위 30개에서 우리 링크 순위, 블로그 30개에서 상호 언급
  naverweb: {
    key: 'NAVER_CLIENT_ID', useQ: true,
    async run(q) { return naverApi('webkr', q); },
  },
  naverblog: {
    key: 'NAVER_CLIENT_ID', useQ: true,
    async run(q) { return naverApi('blog', q); },
  },
};
async function naverApi(kind, q) {
  const res = await fetch(`https://openapi.naver.com/v1/search/${kind}.json?query=${encodeURIComponent(q)}&display=30`, {
    headers: { 'X-Naver-Client-Id': env('NAVER_CLIENT_ID'), 'X-Naver-Client-Secret': env('NAVER_CLIENT_SECRET') } });
  const j = await res.json(); if (!res.ok) throw new Error(j.errorMessage || res.status);
  const strip = s => String(s || '').replace(/<[^>]+>/g, '');
  const items = j.items || [];
  return { text: items.map(i => `${strip(i.title)} ${strip(i.description)} ${i.bloggername || ''}`).join('\n'), links: items.map(i => ({ url: i.link, title: strip(i.title) })) };
}

// ── 검색 결과 화면: 실제 크롬 창(전용 프로필)으로 열어 전체 화면 캡처 + 본문·링크로 판정
const SERP = {
  naver: { url: q => `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`, own: /naver\.com|naver\.net|pstatic\.net/ },
  bing: { url: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=ko&cc=KR`, own: /bing\.com|microsoft\.com|msn\.com/ },
  google: { url: q => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=ko&gl=kr`, own: /google\.[a-z.]+|gstatic\.com|youtube\.com\/results/ },
};
const BLOCK_RE = /unusual traffic|비정상적인 트래픽|자동화된 요청|로봇이 아닙니다|not a robot|verify you are human|보안 문자|captcha|마지막 한 단계|아래 과제 해결|one last step|solve the challenge/i;   // Bing 확인 단계 화면 포함

const engines = arg('engines', [...Object.keys(API).filter(e => env(API[e].key)), ...Object.keys(SERP)].join(',')).split(',').map(s => s.trim()).filter(e => API[e] || SERP[e]);
const want = arg('queries', '');
const queries = want ? want.split(',').map(s => s.trim()).filter(Boolean).map(q => CFG.queries.find(x => x.q === q) || { q, type: '기타', ask: q }) : CFG.queries;
const date = arg('date', kstDate());
const outDir = path.join(AI_DIR, date); fs.mkdirSync(outDir, { recursive: true });
const missing = Object.entries(API).filter(([, a]) => !env(a.key)).map(([e]) => e);

const results = [];
function record(base, j, extra) {
  const r = { date, ...base, ...j, ...extra };
  results.push(r);
  console.log(`${r.engine} | ${r.query} | 홈 ${r.site ? 'O' : '-'} | 공식몰 ${r.mall ? 'O' : '-'} | 상호 ${r.brand ? 'O' : '-'}${r.rank ? ' | ' + r.rank + '위' : ''} | 경쟁 ${r.competitors.join(',') || '-'}${r.blocked ? ' | 차단' : ''}${r.error ? ' | 오류 ' + r.error : ''}`);
}

// AI API
for (const e of engines.filter(e => API[e])) {
  if (!env(API[e].key)) { console.log(`${e}: ${API[e].key} 없음 — 건너뜀`); continue; }
  for (const x of queries) {
    const base = { engine: e, kind: 'api', query: x.q, type: x.type, file: '' };
    try {
      const { text, links } = await API[e].run(API[e].useQ ? x.q : x.ask);
      const f = path.join(outDir, `${e}_${safe(x.q)}.txt`);
      fs.writeFileSync(f, cut(`질문: ${API[e].useQ ? x.q : x.ask}\n\n${text}\n\n[출처]\n${links.map((l, i) => `${i + 1}. ${l.title || ''} ${l.url}`).join('\n')}`), 'utf8');
      record({ ...base, file: path.basename(f) }, judge(text, links, x.q), { blocked: false, error: '', cites: links.slice(0, 20).map(l => l.url) });
    } catch (err) { record(base, { site: false, mall: false, brand: false, competitors: [], rank: null }, { blocked: false, error: String(err.message || err).slice(0, 160) }); }
    await sleep(1500);
  }
}

// 검색 결과 화면
const serpEngines = engines.filter(e => SERP[e]);
if (serpEngines.length) {
  const chrome = findChrome();
  if (!chrome) console.log('크롬을 찾지 못해 검색 결과 화면 측정을 건너뜁니다(CHROME_PATH).');
  else {
    const { default: puppeteer } = await import('puppeteer-core');
    const browser = await puppeteer.launch({ executablePath: chrome, headless: process.argv.includes('--headless'), userDataDir: path.join(AI_DIR, '.chrome-profile'),
      defaultViewport: { width: 1280, height: 900 }, args: ['--lang=ko-KR', '--window-size=1280,900', '--no-first-run', '--no-default-browser-check'] });
    try {
      for (const e of serpEngines) {
        const S = SERP[e]; let blocked = false;
        for (const x of queries) {
          const base = { engine: e, kind: 'serp', query: x.q, type: x.type, file: '' };
          if (blocked) { record(base, { site: false, mall: false, brand: false, competitors: [], rank: null }, { blocked: true, error: '앞 질의에서 차단 — 오늘은 건너뜀' }); continue; }
          const page = await browser.newPage();
          try {
            await page.goto(S.url(x.q), { waitUntil: 'domcontentloaded', timeout: 45000 });
            await sleep(3500);
            const text = await page.evaluate(() => (document.body.innerText || '').slice(0, 200000));
            if (BLOCK_RE.test(text) || /\/sorry\//.test(page.url())) { blocked = true; record(base, { site: false, mall: false, brand: false, competitors: [], rank: null }, { blocked: true, error: '차단 화면' }); continue; }
            const all = await page.evaluate(() => [...document.querySelectorAll('a[href^="http"]')].map(a => ({ url: a.href, title: (a.innerText || '').trim().slice(0, 80) })));
            const seen = new Set();
            const links = all.filter(l => { const host = (l.url.match(/^https?:\/\/([^/]+)/) || [])[1] || ''; if (S.own.test(host) || seen.has(host + l.url.slice(0, 80))) return false; seen.add(host + l.url.slice(0, 80)); return true; });
            const shot = path.join(outDir, `${e}_${safe(x.q)}.jpg`);
            await page.screenshot({ path: shot, type: 'jpeg', quality: 55, fullPage: true, captureBeyondViewport: true }).catch(() => page.screenshot({ path: shot, type: 'jpeg', quality: 55 }));
            fs.writeFileSync(path.join(outDir, `${e}_${safe(x.q)}.txt`), cut(text + '\n\n[링크]\n' + links.slice(0, 60).map((l, i) => `${i + 1}. ${l.title} ${l.url}`).join('\n')), 'utf8');
            record({ ...base, file: path.basename(shot) }, judge(text, links, x.q), { blocked: false, error: '' });
          } catch (err) { record(base, { site: false, mall: false, brand: false, competitors: [], rank: null }, { blocked: false, error: String(err.message || err).slice(0, 160) }); }
          finally { await page.close().catch(() => {}); }
          await sleep(8000);   // 같은 엔진에 연달아 보내지 않도록 간격
        }
      }
    } finally { await browser.close().catch(() => {}); }
  }
}

// 저장: result.json · 요약 md · 추이.csv
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(results, null, 1), 'utf8');
writeRows(date, [...new Set(results.map(r => r.engine))], results);
const ok = results.filter(r => !r.error && !r.blocked);
const md = [`# 잠스쿨 AI 검색·검색 노출 측정 — ${date}`, '',
  '| 질의 | 유형 | 엔진 | 공식 홈 | 공식몰·스마트스토어 | 상호 언급 | 순위 | 경쟁사 | 비고 |', '|---|---|---|---|---|---|---|---|---|',
  ...results.map(r => `| ${r.query} | ${r.type} | ${r.engine} | ${r.site ? '✅' : '—'} | ${r.mall ? '✅' : '—'} | ${r.brand ? '✅' : '—'} | ${r.rank || ''} | ${r.competitors.join(', ') || '—'} | ${r.blocked ? '차단' : ''}${r.error && !r.blocked ? '오류: ' + r.error : ''} |`),
  '', `- 유효 측정 ${ok.length}/${results.length} · 공식 홈 노출 ${ok.filter(r => r.site).length} · 공식몰 ${ok.filter(r => r.mall).length} · 상호 언급 ${ok.filter(r => r.brand).length}`,
  missing.length ? `- 키가 없어 건너뛴 AI 엔진: ${missing.join(', ')} (측정/.env 에 키를 넣으면 다음 측정부터 포함)` : '- AI 엔진 키 모두 있음',
  `- 원본: \`측정/AI검색/${date}/\``];
fs.writeFileSync(path.join(outDir, `요약_${date}.md`), md.join('\n') + '\n', 'utf8');
console.log(`완료: ${results.length}건 → ${outDir}`);
