// 작업 전(이전 공식몰 jamschool.co.kr) vs 작업 후(새 공식 홈 jamschool.kr) — 검색엔진·AI가 읽는 구조를 같은 기준으로 잰다
//   node tools/monitor/compare.mjs  → ../research/before-after-<날짜>.json
// 미래애드원 tools/measure/compare.mjs 를 옮기고, 10-12 진단서(잠스쿨 방향성 및 제안.pdf)의 항목을 더했다:
//   구조화 데이터 가격 vs 화면 판매가, 상품 사진 설명(alt), 질문형 소제목, FAQ 구조화 데이터, 반품·교환·체험 안내, 시험 근거, 주소(canonical·사이트맵), robots·llms.txt
// 원시 HTML 기준(자바스크립트 실행 전). 순위·유입 같은 성과가 아니라 구조 비교다.
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT, kstDate } from './lib.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const SIDES = {
  before: { name: '이전 공식몰', base: 'https://jamschool.co.kr/', pages: { home: '', p29: 'shop_view/?idx=29', p30: 'shop_view/?idx=30' } },
  after: { name: '새 공식 홈', base: 'https://jamschool.kr/', pages: { home: '', p29: 'product-29.html', p30: 'product-30.html' } },
};

async function get(u) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    return { status: r.status, text: r.ok ? await r.text() : '', url: r.url };
  } catch (e) { return { status: 0, text: '', err: String(e.message || e) }; }
}

function analyze(html) {
  const m = re => (html.match(re) || [])[1] || '';
  const ldRaw = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(x => x[1]);
  const types = new Set(), prices = [];
  for (const j of ldRaw) {
    for (const t of j.matchAll(/"@type"\s*:\s*(\[[^\]]*\]|"[^"]+")/g)) t[1].replace(/[\[\]"]/g, '').split(',').forEach(s => s.trim() && types.add(s.trim()));
    for (const p of j.matchAll(/"(price|lowPrice|highPrice)"\s*:\s*"?([\d.]+)/g)) prices.push([p[1], +p[2]]);
  }
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const body = noScript.replace(/<template[\s\S]*?<\/template>/gi, ' ');
  const text = body.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  // 상품 사진: 템플릿 안(지연 삽입 상세)까지 포함해 센다. 1px·아이콘(svg) 제외
  const imgs = [...noScript.matchAll(/<img\b[^>]*>/gi)].map(x => x[0]).filter(t => !/\.svg|width=["']?1["'\s>]|data:image/i.test(t));
  const noAlt = imgs.filter(t => !/\balt\s*=/i.test(t)).length;                      // alt 속성 자체가 없음
  const emptyAlt = imgs.filter(t => /\balt\s*=\s*(""|'')/i.test(t)).length;            // alt="" — 같은 사진의 작은 썸네일·장식이면 정상
  const heads = [...body.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)].map(x => x[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  const title = m(/<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s+/g, ' ').trim();
  return {
    title, titleLen: [...title].length,
    description: m(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || m(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
    h1: (html.match(/<h1[\s>]/gi) || []).length,
    canonical: m(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i),
    ogImage: !!m(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i),
    jsonld: ldRaw.length, types: [...types].sort(), prices,
    faqSchema: types.has('FAQPage'),
    questionHeads: heads.filter(x => /\?$|까\??$|나요\??$|요\?$/.test(x)).length, heads: heads.length,
    imgs: imgs.length, imgNoAlt: noAlt, imgEmptyAlt: emptyAlt,
    textChars: text.length,
    returnInfo: /반품/.test(text) && /교환/.test(text), trialInfo: /14일/.test(text) && /체험/.test(text),
    evidence: (text.match(/KATRI|FITI|SGS|KTR|성적서|시험\s?번호|NO\.\s?[A-Z]/g) || []).length,
  };
}
function robotsInfo(txt) {
  if (!txt) return { file: false };
  const lines = txt.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).length;
  return { file: true, lines, mentionsAI: /GPTBot|OAI-SearchBot|PerplexityBot|ClaudeBot|Claude-User|Google-Extended/i.test(txt), sitemap: /sitemap:/i.test(txt) };
}

const out = { measured: new Date().toISOString(), note: '원시 HTML(자바스크립트 실행 전) 기준. before = 이전 공식몰(jamschool.co.kr, 리뉴얼 전 그대로 운영 중), after = 새 공식 홈 운영 주소(jamschool.kr).', sides: {} };
for (const [key, s] of Object.entries(SIDES)) {
  const r = { name: s.name, base: s.base, pages: {} };
  for (const [pid, rel] of Object.entries(s.pages)) { const g = await get(new URL(rel, s.base).href); r.pages[pid] = { url: g.url || new URL(rel, s.base).href, status: g.status, ...analyze(g.text) }; }
  const robots = await get(new URL('robots.txt', s.base).href), sm = await get(new URL('sitemap.xml', s.base).href), llms = await get(new URL('llms.txt', s.base).href);
  const locs = [...sm.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(x => x[1]);
  r.robots = robotsInfo(robots.status === 200 ? robots.text : '');
  r.sitemap = { urls: locs.length, sample: locs.slice(0, 3), host: [...new Set(locs.map(u => { try { return new URL(u).host; } catch { return ''; } }))] };
  // llms.txt 는 마크다운(# 제목 + 설명)이어야 AI 가 회사·제품 요약으로 읽는다. robots 형식 몇 줄은 '있지만 내용 없음'
  const lt = llms.status === 200 && !/<html/i.test(llms.text) ? llms.text : '';
  r.llms = { file: !!lt, markdown: /^#\s/m.test(lt), chars: lt.length, lines: lt.split(/\r?\n/).filter(x => x.trim()).length };
  out.sides[key] = r;
  console.log(s.name, JSON.stringify({ home: r.pages.home.title, h1: r.pages.home.h1, types: r.pages.p29.types, prices: r.pages.p29.prices, imgs: [r.pages.p29.imgs, r.pages.p29.imgNoAlt], sitemap: r.sitemap.urls, llms: r.llms }));
}
const dir = path.join(PROJECT, 'research'); fs.mkdirSync(dir, { recursive: true });
const f = path.join(dir, `before-after-${kstDate()}.json`);
fs.writeFileSync(f, JSON.stringify(out, null, 1));
console.log('saved', path.relative(PROJECT, f));
