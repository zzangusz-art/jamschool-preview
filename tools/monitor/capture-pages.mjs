// 전후 비교용 화면 캡처 — 주간·월간 리포트의 '처음 vs 지금' 사진
//   node tools/monitor/capture-pages.mjs [--full] [--only new|old]
//   새 공식 홈(jamschool.kr) 주요 페이지: PC(1440×900)·휴대폰(390×844) 첫 화면을 매일, 전체 화면은 주 1회(월요일, 또는 7일 넘게 없을 때)
//   이전 사이트(jamschool.co.kr — 리뉴얼 전부터 있던 공식몰): 처음 한 번 '기준' + 매달 첫 실행 때 한 번, 첫 화면·전체 화면 모두
// 저장: 측정/스크린샷/<날짜>/<site>_<page>_<pc|mo>[_full].jpg + 그날 index.json(주소·시각·크기·실패)
//       측정/스크린샷/기준.json — 사이트별 첫 캡처 날짜(리포트의 '처음' 사진)
// 검색 결과·AI 답변 화면은 ai-check.mjs 가 측정/AI검색/<날짜>/ 에 매일 남긴다. 봇 차단·로그인 화면은 우회하지 않고 그대로 찍는다
import fs from 'node:fs';
import path from 'node:path';
import { DEVICES, SHOT_DIR, SITES, arg, findChrome, kstDate, readShotBase, shotDays } from './lib.mjs';

const today = kstDate();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const only = arg('only', '');
const base = readShotBase();
const daysOld = (site, kind) => { const d = shotDays(site, kind).pop(); return d ? (Date.parse(today) - Date.parse(d)) / 864e5 : Infinity; };
const dow = new Date(today + 'T00:00:00Z').getUTCDay();
const plan = [];
for (const [key, s] of Object.entries(SITES)) {
  if (only && only !== key) continue;
  const first = !base[s.host];
  if (key === 'old' && !first && !process.argv.includes('--full') && shotDays(key).some(d => d.slice(0, 7) === today.slice(0, 7))) continue;   // 이전 사이트는 한 달에 한 번
  const full = key === 'old' || first || process.argv.includes('--full') || dow === 1 || daysOld(key, '_full.jpg') >= 7;
  plan.push({ key, s, full });
}
if (!plan.length) { console.log('오늘 찍을 화면 없음(이전 사이트는 이번 달 캡처 완료)'); process.exit(0); }
const chrome = findChrome();
if (!chrome) { console.log('크롬을 찾지 못해 캡처를 건너뜁니다(CHROME_PATH).'); process.exit(0); }

const out = path.join(SHOT_DIR, today);
fs.mkdirSync(out, { recursive: true });
const idxFile = path.join(out, 'index.json');
const index = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : [];
const keep = (rec) => { const i = index.findIndex(x => x.file === rec.file); if (i >= 0) index[i] = rec; else index.push(rec); };
const { default: puppeteer } = await import('puppeteer-core');
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--lang=ko-KR', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars'] });
let ok = 0, bad = 0;
try {
  for (const { key, s, full } of plan) {
    for (const [pid, label, url] of s.pages) {
      for (const [dev, vp] of Object.entries(DEVICES)) {
        const page = await browser.newPage();
        const name = `${key}_${pid}_${dev}`;
        try {
          await page.setViewport(vp);
          if (vp.isMobile) await page.setUserAgent((await browser.userAgent()).replace(/\(Windows[^)]*\)/, '(Linux; Android 14; Pixel 8)').replace(/(Chrome\/[\d.]+)/, '$1 Mobile'));
          await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9' });
          const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
          await sleep(2500);   // 첫 화면 슬라이드·글꼴이 자리 잡게
          await page.screenshot({ path: path.join(out, name + '.jpg'), type: 'jpeg', quality: 72 });
          const rec = { file: name + '.jpg', site: key, host: s.host, page: pid, label, device: dev, url: page.url(), status: res ? res.status() : 0, at: new Date().toISOString() };
          keep(rec); ok++;
          if (full) {
            // 늦게 뜨는 사진까지 나오게 끝까지 내렸다가 맨 위로
            await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += innerHeight * 0.8) { scrollTo(0, y); await new Promise(r => setTimeout(r, 250)); } scrollTo(0, 0); });
            await sleep(1200);
            const h = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 15000));
            await page.screenshot({ path: path.join(out, name + '_full.jpg'), type: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: vp.width, height: h }, captureBeyondViewport: true });
            keep({ ...rec, file: name + '_full.jpg', full: true, height: h }); ok++;
          }
        } catch (err) { keep({ file: name + '.jpg', site: key, host: s.host, page: pid, label, device: dev, url, error: String(err.message || err).slice(0, 160), at: new Date().toISOString() }); bad++; }
        finally { await page.close().catch(() => {}); }
      }
    }
    if (!base[s.host] && index.some(x => x.site === key && !x.error)) base[s.host] = today;
  }
} finally { await browser.close(); }
fs.writeFileSync(idxFile, JSON.stringify(index, null, 1), 'utf8');
fs.writeFileSync(path.join(SHOT_DIR, '기준.json'), JSON.stringify(base, null, 1), 'utf8');
console.log(`캡처 ${ok}장${bad ? ` · 실패 ${bad}` : ''} → 측정/스크린샷/${today}/ (${plan.map(p => `${p.s.host}${p.full ? '+전체' : ''}`).join(', ')}) · 기준일 ${Object.entries(base).map(([k, v]) => `${k} ${v}`).join(', ')}`);
