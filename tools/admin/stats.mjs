// 사이트 자체 방문 집계(어드민 '유입'·'주문' 화면) — GA4 없이도 보이게, 개인정보 없이 날짜별 숫자만
//   페이지 보기: tools/serve.mjs 가 html 응답마다 countPage() — 봇은 따로(bots), /admin·/api 제외
//   방문자: (IP + 브라우저) 를 그날만 쓰는 소금값으로 해시해 하루 중복만 거른다. IP·해시는 다음 날 버리고 숫자만 남김. 쿠키 없음
//   클릭·주문서: 사이트 스크립트가 /api/t 로 보내는 이벤트(구매하기·장바구니·스마트스토어/N Pay·공식몰·전화·카카오·주문서 제출)
//   저장: DATA_DIR/analytics/YYYY-MM-DD.json (Railway 볼륨). 볼륨이 없으면 메모리에만(재배포하면 사라짐)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'analytics') : (process.env.STATS_DIR || '');
export const persistent = () => !!DIR;
const kst = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
const days = new Map();   // 날짜 → 집계(오늘·최근 것만 메모리에)

const blank = date => ({ date, pv: 0, uv: 0, entries: 0, pages: {}, sources: {}, refs: {}, ai: {}, devices: {}, bots: {}, events: {}, products: {}, orders: { n: 0, sum: 0, items: {}, pay: {} }, _salt: crypto.randomBytes(16).toString('hex'), _seen: [] });
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
const inc = (o, k, n = 1) => { if (!k) return; o[k] = (o[k] || 0) + n; };

// 유입 경로 묶음
const AI_HOSTS = [[/chatgpt\.com|chat\.openai\.com/, 'ChatGPT'], [/perplexity\.ai/, 'Perplexity'], [/gemini\.google\.com|bard\.google\.com/, 'Gemini'], [/copilot\.microsoft\.com|bing\.com\/chat/, 'Copilot'], [/claude\.ai/, 'Claude'], [/wrtn\.ai/, '뤼튼'], [/clova|cue\.search\.naver/, '네이버 AI'], [/you\.com|phind\.com|poe\.com|deepseek/, '기타 AI']];
function source(ref, selfHost, utm) {
  if (utm) return { group: `캠페인(${utm.slice(0, 30)})`, host: '' };
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
const clientIp = req => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

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
    touch();
  } catch { /* 집계 실패가 페이지를 막지 않게 */ }
}

// 사이트 스크립트 이벤트: POST /api/t {e, id?, total?, items?, pay?}
const EVENTS = new Set(['buy_click', 'cart_click', 'store_click', 'mall_click', 'call_click', 'kakao_click', 'checkout_submit']);
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

// 어드민 조회: 최근 n일 합계 + 날짜별
export function summary(n = 7) {
  const list = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = kst(Date.now() - i * 864e5);
    let d = days.get(date);
    if (!d && DIR) { const f = path.join(DIR, `${date}.json`); if (fs.existsSync(f)) try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* 무시 */ } }
    list.push(d || { date, pv: 0, uv: 0, entries: 0, pages: {}, sources: {}, refs: {}, ai: {}, devices: {}, bots: {}, events: {}, products: {}, orders: { n: 0, sum: 0, items: {}, pay: {} } });
  }
  const add = (a, b) => { for (const [k, v] of Object.entries(b || {})) a[k] = (a[k] || 0) + v; return a; };
  const tot = { pv: 0, uv: 0, entries: 0, pages: {}, sources: {}, refs: {}, ai: {}, devices: {}, bots: {}, events: {}, products: {}, orders: { n: 0, sum: 0, items: {}, pay: {} } };
  for (const d of list) {
    tot.pv += d.pv; tot.uv += d.uv; tot.entries += d.entries;
    for (const k of ['pages', 'sources', 'refs', 'ai', 'devices', 'bots', 'events']) add(tot[k], d[k]);
    for (const [id, p] of Object.entries(d.products || {})) { tot.products[id] = tot.products[id] || { views: 0, buy: 0 }; tot.products[id].views += p.views; tot.products[id].buy += p.buy; }
    tot.orders.n += d.orders.n; tot.orders.sum += d.orders.sum; add(tot.orders.items, d.orders.items); add(tot.orders.pay, d.orders.pay);
  }
  return { days: list.map(d => ({ date: d.date, pv: d.pv, uv: d.uv, entries: d.entries, ai: Object.values(d.ai || {}).reduce((a, b) => a + b, 0), orders: d.orders.n, events: d.events })), total: tot, persistent: persistent() };
}
