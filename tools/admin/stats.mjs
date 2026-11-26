// 사이트 자체 방문 집계(어드민 '유입'·'주문' 화면) — GA4 없이도 보이게, 개인정보 없이 날짜별 숫자만
//   페이지 보기: tools/serve.mjs 가 html 응답마다 countPage() — 봇은 따로(bots), /admin·/api 제외
//   방문자: (IP + 브라우저) 를 그날만 쓰는 소금값으로 해시해 하루 중복만 거른다. IP·해시는 다음 날 버리고 숫자만 남김. 쿠키 없음
//   클릭·주문서: 사이트 스크립트가 /api/t 로 보내는 이벤트(구매하기·장바구니·스마트스토어/N Pay·공식몰·전화·카카오·주문서 제출)
//   저장: DATA_DIR/analytics/YYYY-MM-DD.json (Railway 볼륨). 볼륨이 없으면 메모리에만(재배포하면 사라짐)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { clientIp } from '../client-ip.mjs';

const DIR = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'analytics') : (process.env.STATS_DIR || '');
export const persistent = () => !!DIR;
const kst = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
const days = new Map();   // 날짜 → 집계(오늘·최근 것만 메모리에)

const blank = date => ({ date, pv: 0, uv: 0, entries: 0, pages: {}, sources: {}, refs: {}, ai: {}, devices: {}, bots: {}, events: {}, products: {}, orders: { n: 0, sum: 0, items: {}, pay: {} }, direct: { how: {}, land: {} }, _salt: crypto.randomBytes(16).toString('hex'), _seen: [] });
function day(date = kst()) {
  if (!days.has(date)) {
    let d = null;
    if (DIR) { const f = path.join(DIR, `${date}.json`); if (fs.existsSync(f)) try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* 깨진 파일 */ } }
    d = d || blank(date);
    if (date === kst() && !d._salt) Object.assign(d, { _salt: crypto.randomBytes(16).toString('hex'), _seen: [] });
    d._set = new Set(d._seen || []);
    days.set(date, d);
    for (const k of [...days.keys()]) if (k < kst(Date.now() - 2 * 864e5)) days.delete(k);   // 메모리엔 사흘치만
  }
  return days.get(date);
}
let dirty = false, timer = null;
function flush() {
  if (!DIR || !dirty) return; dirty = false;
  fs.mkdirSync(DIR, { recursive: true });
  for (const d of days.values()) {
    const keep = d.date === kst();   // 지난 날은 해시·소금값을 지운다
    const { _set, ...rest } = d;
    const out = keep ? { ...rest, _seen: [..._set] } : (({ _salt, _seen, ...x }) => x)(rest);
    fs.writeFileSync(path.join(DIR, `${d.date}.json.tmp`), JSON.stringify(out)); fs.renameSync(path.join(DIR, `${d.date}.json.tmp`), path.join(DIR, `${d.date}.json`));
  }
}
const touch = () => { dirty = true; if (!timer) timer = setTimeout(() => { timer = null; flush(); }, 30000); };
process.on('SIGTERM', () => { flush(); process.exit(0); });
// 데이터 가져오기(backup.mjs) 앞뒤: 메모리 집계를 파일로 쓰고, 가져온 뒤에는 메모리를 비워 파일에서 다시 읽게 한다
export const flushNow = () => { dirty = true; flush(); };
export const forgetCache = () => days.clear();
const inc = (o, k, n = 1) => { if (!k) return; o[k] = (o[k] || 0) + n; };

// 유입 경로 묶음
const AI_HOSTS = [[/chatgpt\.com|chat\.openai\.com/, 'ChatGPT'], [/perplexity\.ai/, 'Perplexity'], [/gemini\.google\.com|bard\.google\.com/, 'Gemini'], [/copilot\.microsoft\.com|bing\.com\/chat/, 'Copilot'], [/claude\.ai/, 'Claude'], [/wrtn\.ai/, '뤼튼'], [/clova|cue\.search\.naver/, '네이버 AI'], [/you\.com|phind\.com|poe\.com|deepseek/, '기타 AI']];
// ChatGPT 등은 답변 속 링크에 utm_source=chatgpt.com 을 붙인다 → 캠페인이 아니라 'AI 답변'으로
const aiOfUtm = utm => (AI_HOSTS.find(([re]) => re.test(String(utm || '').toLowerCase())) || [])[1] || '';
function source(ref, selfHost, utm) {
  if (utm) { const ai = aiOfUtm(utm); return ai ? { group: 'AI 답변', host: ai } : { group: `캠페인(${utm.slice(0, 30)})`, host: '' }; }
  if (!ref) return { group: '직접 방문', host: '' };
  let u; try { u = new URL(ref); } catch { return { group: '기타', host: '' }; }
  const h = u.hostname.replace(/^www\.|^m\./, '');
  if (!h || h === selfHost || h.endsWith('.' + selfHost)) return null;   // 사이트 안 이동
  for (const [re, name] of AI_HOSTS) if (re.test(h + u.pathname)) return { group: 'AI 답변', host: name };
  if (/search\.naver\.com/.test(h)) return { group: '네이버 검색', host: h };
  if (/naver\.com|naver\.me/.test(h)) return { group: '네이버(블로그·카페·쇼핑)', host: h };
  if (/^google\.|\.google\./.test(h) || h === 'google.com') return { group: '구글', host: h };
  if (/daum\.net|kakao\.com|kakaocdn/.test(h)) return { group: /kakao/.test(h) ? '카카오' : '다음', host: h };
  if (/bing\.com/.test(h)) return { group: 'Bing', host: h };
  if (/instagram\.com|facebook\.com|threads\.net|t\.co$|twitter\.com|x\.com|youtube\.com|youtu\.be|tiktok\.com|band\.us/.test(h)) return { group: 'SNS·영상', host: h };
  if (/jamschool\.co\.kr|smartstore\.naver\.com/.test(h)) return { group: '공식몰·스마트스토어', host: h };
  return { group: '다른 사이트', host: h };
}
const BOT_RE = /bot|crawl|spider|slurp|yeti|daumoa|preview|facebookexternalhit|kakaotalk-scrap|monitor|curl|wget|python|node-fetch|axios|go-http|java\/|headless|lighthouse|pingdom|uptime|semrush|ahrefs|mj12|petal|bytespider|gptbot|chatgpt-user|oai-searchbot|claude|anthropic|perplexity|ccbot|google-inspectiontool|google-extended|validator|scan/i;
const BOT_NAMES = [[/gptbot|oai-searchbot|chatgpt-user/i, 'OpenAI(ChatGPT)'], [/claudebot|claude-|anthropic/i, 'Anthropic(Claude)'], [/perplexity/i, 'Perplexity'], [/google-extended|googleother/i, 'Google AI'], [/googlebot|google-inspectiontool/i, 'Googlebot'], [/yeti/i, '네이버 Yeti'], [/bingbot|bingpreview/i, 'Bingbot'], [/daumoa|daum/i, '다음'], [/bytespider/i, 'ByteDance'], [/ccbot/i, 'Common Crawl']];
const device = ua => /ipad|tablet/i.test(ua) ? '태블릿' : /mobi|iphone|android/i.test(ua) ? '휴대폰' : 'PC';

// 직접 방문(이전 페이지 주소 없음·utm 없음)을 한 번 더 나눈다 — 숫자만 남김(2026-11-20부터)
//   ① 링크에 붙은 표시: 주문 조회·구매평 쓰기 주소(우리 문자·화면), 광고·앱이 붙이는 클릭 표시(gclid·fbclid·NaPm 등)
//   ② 앱 안 브라우저(브라우저 이름표 User-Agent): 카카오톡·네이버 앱·인스타그램 등은 이전 주소를 안 보내는 일이 많다
//   ③ 브라우저가 알려 주는 요청 출처(Sec-Fetch-Site): none = 주소 입력·즐겨찾기·새로고침·다른 앱(문자 등)에서 열기, cross-site = 다른 사이트인데 주소를 숨김
const IN_APP = [[/KAKAOTALK/i, '카카오톡 안 브라우저'], [/NAVER\(inapp|NAVER\/\d/i, '네이버 앱 안 브라우저'], [/Instagram/i, '인스타그램 앱 안 브라우저'], [/FBAN|FBAV|FB_IAB|FBIOS/i, '페이스북 앱 안 브라우저'],
  [/BAND\//i, '밴드 앱 안 브라우저'], [/\bLine\//i, '라인 앱 안 브라우저'], [/DaumApps|DaumDevice/i, '다음 앱 안 브라우저'], [/KAKAOSTORY/i, '카카오스토리 앱 안 브라우저'], [/; wv\)|WebView/i, '그 밖의 앱 안 브라우저']];
export function directHow(req, ua, p) {
  let q; try { q = new URL(req.url, 'http://x').searchParams; } catch { q = new URLSearchParams(); }
  return howOf(q, p, ua, String((req.headers || {})['sec-fetch-site'] || ''));
}
// sf: 브라우저가 알려 주는 요청 출처(서버에서만 앎, 없으면 ''). 주문 유입(브라우저 기록)에서는 null → 앱 안 브라우저가 아니면 '주소 입력·즐겨찾기·문자 등'
function howOf(q, p, ua, sf) {
  if (p === '/order-complete' && q.get('o')) return '주문 조회 링크(문자·결제 화면)';
  if (q.get('write') === '1') return '구매평 쓰기 링크(문자·주문 조회)';
  if (q.has('gclid') || q.has('gbraid') || q.has('wbraid')) return '구글 광고';
  if (q.has('fbclid')) return '인스타·페이스북 링크';
  if (q.has('NaPm') || q.has('n_media') || q.has('n_query')) return '네이버 광고·쇼핑 링크';
  if (q.has('ttclid')) return '틱톡 링크';
  const app = IN_APP.find(([re]) => re.test(ua)); if (app) return app[1];
  if (sf === 'none') return device(ua) === 'PC' ? 'PC 주소 입력·즐겨찾기' : '휴대폰 주소 입력·즐겨찾기·문자';
  if (sf === 'cross-site') return '출처를 숨긴 다른 사이트';
  if (sf === 'same-origin' || sf === 'same-site') return '사이트 안 이동(주소 없음)';
  if (sf === null) return device(ua) === 'PC' ? '주소 입력·즐겨찾기 등' : '주소 입력·즐겨찾기·문자 등';
  return '알 수 없음';
}

// ───────── 결제 주문의 유입 경로(2026-11-26)
//   사이트 스크립트(build.mjs TRACK_JS)가 손님 브라우저(localStorage jam_src)에 '들어온 곳'을 기억해 두고, 주문서가 결제를 시작할 때 함께 보낸다.
//     last  = 마지막으로 바깥(검색·SNS·광고·다른 사이트)에서 들어온 때(30일 안, 그 사이 직접 방문은 덮지 않음) → '결제로 이어진 유입'
//     first = 처음 들어온 때(90일 안) · sess = 이번 방문 첫 페이지 · n = 방문 횟수
//   방문 집계와 같은 묶음(source)으로 나누고 검색어·캠페인·광고 표시를 붙인다. 이전 페이지 주소는 host+경로만(쿼리는 버리고 검색어만 따로)
const AD_OF = q => q.has('gclid') || q.has('gbraid') || q.has('wbraid') ? '구글 광고' : q.has('NaPm') || q.has('n_media') || q.has('n_query') ? '네이버 광고·쇼핑' : q.has('fbclid') ? '인스타·페이스북' : q.has('ttclid') ? '틱톡' : '';
function touchOf(t, ua, selfHost) {
  if (!t || typeof t !== 'object') return null;
  const at = Number(t.at); if (!(at > 1.6e12 && at < Date.now() + 864e5)) return null;
  const ref = String(t.ref || '').slice(0, 500), qs = String(t.q || '').slice(0, 500);
  const land = (String(t.land || '/').slice(0, 120).replace(/[^\w\-./가-힣]/g, '').replace(/index\.html$/, '').replace(/\.html$/, '')) || '/';
  let q; try { q = new URLSearchParams(qs.replace(/^\?/, '')); } catch { q = new URLSearchParams(); }
  const utm = (q.get('utm_source') || '').slice(0, 40);
  const s = source(ref, selfHost, utm) || { group: '직접 방문', host: '' };   // 우리 사이트 주소가 이전 페이지면(드묾) 직접 방문으로
  let refHost = '', refPath = '', kw = '';
  try { const u = new URL(ref); refHost = u.hostname; refPath = u.pathname.slice(0, 80); kw = u.searchParams.get('query') || u.searchParams.get('q') || u.searchParams.get('wd') || ''; } catch { /* 주소 없음 */ }
  kw = String(kw || q.get('utm_term') || q.get('n_query') || q.get('n_keyword') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const camp = [q.get('utm_campaign'), q.get('utm_medium')].filter(Boolean).join(' · ').slice(0, 60), ad = AD_OF(q);
  // 이전 주소 없이 광고·SNS 클릭 표시만 있으면(앱 안 브라우저가 주소를 안 보내는 일이 많음) '직접 방문' 대신 그 광고·SNS 로
  const group = s.group === '직접 방문' && ad ? (/인스타|틱톡/.test(ad) ? 'SNS·영상' : ad) : s.group;
  return { group, host: s.host || '', kw, camp, ad, how: group === '직접 방문' ? howOf(q, land, ua, null) : '', ref: refHost ? (refHost + refPath).slice(0, 120) : '', land, at: new Date(at).toISOString() };
}
export function orderSource(src, ua = '', selfHost = 'jamschool.kr') {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
  ua = String(ua || '');
  const last = touchOf(src.last, ua, selfHost), first = touchOf(src.first, ua, selfHost), sess = touchOf(src.sess, ua, selfHost);
  if (!last && !first && !sess) return null;
  const n = Math.min(Math.max(Math.round(Number(src.n) || 1), 1), 9999), app = IN_APP.find(([re]) => re.test(ua));
  return { last: last || sess || first, first: first || last || sess, sess: sess || last || first, visits: n, app: app ? app[1] : '' };
}
// 한 줄 설명(엑셀·알림·처리 기록): 네이버 검색 · 검색어 '접이식 매트리스' · 네이버 광고·쇼핑
export const srcText = t => !t ? '' : [t.group, t.kw ? `검색어 '${t.kw}'` : '', t.host && !/검색$/.test(t.group) ? t.host : '', t.camp, t.ad && !t.group.includes(t.ad) ? t.ad : '', t.how].filter(Boolean).join(' · ');

// 페이지 보기 1건(serve.mjs 가 html 200 응답 때 부른다)
export function countPage(req, pathname, selfHost) {
  try {
    const ua = String(req.headers['user-agent'] || '');
    const d = day();
    if (!ua || BOT_RE.test(ua)) { const b = BOT_NAMES.find(([re]) => re.test(ua)); inc(d.bots, b ? b[1] : '기타 봇·도구'); touch(); return; }
    if (req.headers['purpose'] === 'prefetch' || req.headers['sec-purpose'] === 'prefetch') return;
    const p = pathname.replace(/index\.html$/, '').replace(/\.html$/, '') || '/';
    d.pv++; inc(d.pages, p);
    const m = p.match(/^\/product-(\d+)$/); if (m) { d.products[m[1]] = d.products[m[1]] || { views: 0, buy: 0 }; d.products[m[1]].views++; }
    const id = crypto.createHash('sha256').update(d._salt + clientIp(req) + ua).digest('base64url').slice(0, 16);
    const utm = (() => { try { return new URL(req.url, 'http://x').searchParams.get('utm_source') || ''; } catch { return ''; } })();
    const s = source(String(req.headers.referer || ''), selfHost, utm);
    if (!d._set.has(id)) { d._set.add(id); d.uv++; inc(d.devices, device(ua)); }
    if (s) { d.entries++; inc(d.sources, s.group); if (s.host) inc(s.group === 'AI 답변' ? d.ai : d.refs, s.host); }
    if (s && s.group === '직접 방문') { const x = d.direct || (d.direct = { how: {}, land: {} }); inc(x.how, directHow(req, ua, p)); inc(x.land, p); }
    touch();
  } catch { /* 집계 실패가 페이지를 막지 않게 */ }
}

// 사이트 스크립트 이벤트: POST /api/t {e, id?, total?, items?, pay?}
const EVENTS = new Set(['buy_click', 'cart_click', 'store_click', 'mall_click', 'call_click', 'kakao_click', 'checkout_submit', 'member_join']);
const rate = new Map();
export function countEvent(req, body) {
  const ua = String(req.headers['user-agent'] || '');
  if (!ua || BOT_RE.test(ua)) return;
  const ip = clientIp(req), now = Date.now(), r = rate.get(ip) || { n: 0, t: now };
  if (now - r.t > 60e3) { r.n = 0; r.t = now; } if (++r.n > 60) return; rate.set(ip, r);   // 1분 60건 넘으면 무시
  const e = String(body.e || ''); if (!EVENTS.has(e)) return;
  const d = day(); inc(d.events, e);
  const pid = /^\d{1,4}$/.test(String(body.id || '')) ? String(body.id) : '';
  if (pid && (e === 'buy_click' || e === 'cart_click')) { d.products[pid] = d.products[pid] || { views: 0, buy: 0 }; d.products[pid].buy++; }
  if (e === 'checkout_submit') {   // 미리보기 주문서 제출: 이름·연락처·주소는 받지 않는다
    d.orders.n++; d.orders.sum += Math.min(Math.max(Math.round(+body.total || 0), 0), 20e6);
    inc(d.orders.pay, ['card', 'bank', 'npay', 'kakaopay'].includes(body.pay) ? body.pay : '기타');
    for (const it of (Array.isArray(body.items) ? body.items : []).slice(0, 20)) if (/^\d{1,4}$/.test(String(it.id))) inc(d.orders.items, String(it.id), Math.min(Math.max(+it.qty || 1, 1), 50));
  }
  touch();
}

// 주문 흐름 새로 시작(어드민 '결제 주문' → 시험 기록 정리, 총괄 관리자): 이 날짜 전의 클릭·주문서·상품 조회는 집계에서 뺀다.
//   날짜 파일은 그대로 두고(되돌리려면 _orders-since.json 삭제), 오늘 것은 정리 시각까지의 숫자를 _before-reset-*.json 에 남기고 0 으로
const SINCE = () => DIR ? path.join(DIR, '_orders-since.json') : '';
let since = (() => { try { return JSON.parse(fs.readFileSync(SINCE(), 'utf8')).since || ''; } catch { return ''; } })();
export const ordersSince = () => since;
export function resetOrderStats(by) {
  const d = day(), date = kst(), at = new Date().toISOString();
  if (DIR) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, `_before-reset-${Date.now()}.json`), JSON.stringify({ date, at, by, events: d.events, products: d.products, orders: d.orders })); }
  d.events = {}; d.products = {}; d.orders = { n: 0, sum: 0, items: {}, pay: {} };
  since = date;
  if (DIR) fs.writeFileSync(SINCE(), JSON.stringify({ since: date, at, by }));
  dirty = true; flush();
  return { since };
}

// 어드민 조회: 최근 n일 합계 + 날짜별(유입 경로·기기도 날짜별로 — 그래프에서 날짜를 누르면 그날 것만 본다)
//   offset: 며칠 앞으로 밀어서(지난 기간 비교: summary(7, 7) = 그 전 7일)
// 예전 기록의 '캠페인(chatgpt.com)' 같은 것은 읽을 때 'AI 답변'으로 묶는다(파일은 그대로)
function aiFix(d) {
  const keys = Object.keys(d.sources || {}).filter(k => /^캠페인\(/.test(k) && aiOfUtm(k.slice(4, -1)));
  if (!keys.length) return d;
  const sources = { ...d.sources }, ai = { ...(d.ai || {}) };
  for (const k of keys) { const n = sources[k], name = aiOfUtm(k.slice(4, -1)); delete sources[k]; sources['AI 답변'] = (sources['AI 답변'] || 0) + n; ai[name] = (ai[name] || 0) + n; }
  return { ...d, sources, ai };
}
export function summary(n = 7, offset = 0) {
  const list = [];
  for (let i = n - 1 + offset; i >= offset; i--) {
    const date = kst(Date.now() - i * 864e5);
    let d = days.get(date);
    if (!d && DIR) { const f = path.join(DIR, `${date}.json`); if (fs.existsSync(f)) try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* 무시 */ } }
    if (d && since && date < since) d = { ...d, events: {}, products: {}, orders: { n: 0, sum: 0, items: {}, pay: {} } };   // 주문 흐름 시작 전(시험 기록)
    if (d) d = aiFix(d);
    list.push(d || { date, pv: 0, uv: 0, entries: 0, pages: {}, sources: {}, refs: {}, ai: {}, devices: {}, bots: {}, events: {}, products: {}, orders: { n: 0, sum: 0, items: {}, pay: {} } });
  }
  const add = (a, b) => { for (const [k, v] of Object.entries(b || {})) a[k] = (a[k] || 0) + v; return a; };
  const tot = { pv: 0, uv: 0, entries: 0, pages: {}, sources: {}, refs: {}, ai: {}, devices: {}, bots: {}, events: {}, products: {}, orders: { n: 0, sum: 0, items: {}, pay: {} }, direct: { how: {}, land: {} } };
  for (const d of list) {
    tot.pv += d.pv; tot.uv += d.uv; tot.entries += d.entries;
    if (d.direct) { add(tot.direct.how, d.direct.how); add(tot.direct.land, d.direct.land); }
    for (const k of ['pages', 'sources', 'refs', 'ai', 'devices', 'bots', 'events']) add(tot[k], d[k]);
    for (const [id, p] of Object.entries(d.products || {})) { tot.products[id] = tot.products[id] || { views: 0, buy: 0 }; tot.products[id].views += p.views; tot.products[id].buy += p.buy; }
    tot.orders.n += d.orders.n; tot.orders.sum += d.orders.sum; add(tot.orders.items, d.orders.items); add(tot.orders.pay, d.orders.pay);
  }
  // directFrom: 직접 방문 자세히를 모으기 시작한 날(이 기간 안에서 처음 기록이 있는 날)
  const df = list.find(d => d.direct);
  return { days: list.map(d => ({ date: d.date, pv: d.pv, uv: d.uv, entries: d.entries, ai: Object.values(d.ai || {}).reduce((a, b) => a + b, 0), orders: d.orders.n, events: d.events, sources: d.sources || {}, devices: d.devices || {}, direct: d.direct || null })), total: tot, persistent: persistent(), ordersSince: since, directFrom: df ? df.date : '' };
}
