// 수면 가이드 썸네일: 글마다 매트리스·상품 실사 사진 + 제목 → assets/img/blog/<slug>.jpg·.webp (1200×630, 공유 이미지 겸용)
// 사용:
//   node tools/blog/thumb.mjs            썸네일이 없는 글만(--missing 과 같음)
//   node tools/blog/thumb.mjs --all      전부 다시
//   node tools/blog/thumb.mjs <slug> ... 지정한 글만
// Chrome이 필요하다(CHROME_PATH 또는 기본 설치 경로). 글 머리말에 photo: assets/img/... 를 적으면 그 사진을 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPosts } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BLOG = path.join(ROOT, 'content/blog');
const OUT = path.join(ROOT, 'assets/img/blog');
const W = 1200, H = 630;

// 글자 없는 실사 사진만 골라 둔 상품별 사진 묶음
const POOL = {
  29: ['01', '09', '06', '04', '08', '07'],
  30: ['01', '05', '02', '06', '07', '08'],
  39: ['02', '03', '09', '04', '05', '08'],
  40: ['01', '03', '02', '07', '04', '09', '08'],
  43: ['02', '04', '05', '03', '06', '07', '08'],
  36: ['01', '07', '02', '08', '09'],
  37: ['01', '03', '07', '02', '04', '09'],
  38: ['04', '03', '05', '06', '08', '09'],
  44: ['05', '02', '04', '06', '07', '08'],
};
// 카테고리마다 배경색을 달리해 목록에서 한눈에 구분되게
const THEME = {
  '구매 가이드': { dark: true, bg: '#0E2440', ink: '#FFFFFF', em: '#36C7F2', chip: 'rgba(255,255,255,.14)', chipInk: '#FFFFFF', sub: 'rgba(255,255,255,.72)' },
  '사용 팁': { bg: '#E4F5FC', ink: '#0E2440', em: '#0A7DBE', chip: '#FFFFFF', chipInk: '#0A7DBE', sub: '#4A5A6E' },
  '제품 이야기': { bg: '#F4F1EA', ink: '#15181C', em: '#0A7DBE', chip: '#FFFFFF', chipInk: '#15181C', sub: '#5E6670' },
  '생활 공간': { bg: '#E9F0EA', ink: '#15181C', em: '#0A7DBE', chip: '#FFFFFF', chipInk: '#2F5A3A', sub: '#56645A' },
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataURI = f => `data:image/${/\.png$/i.test(f) ? 'png' : 'jpeg'};base64,${fs.readFileSync(path.join(ROOT, f)).toString('base64')}`;

function chromePath() {
  const list = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  const hit = list.find(p => fs.existsSync(p));
  if (!hit) throw new Error('Chrome을 찾지 못했습니다(CHROME_PATH 환경 변수로 지정)');
  return hit;
}

// 사진 고르기: 머리말 photo → 같은 상품 글끼리 날짜순으로 돌려 가며(연달아 같은 사진이 나오지 않게)
function photoFor(p, posts) {
  if (p.photo && fs.existsSync(path.join(ROOT, p.photo))) return p.photo;
  const id = POOL[p.product] ? +p.product : 29;
  const pool = POOL[id];
  const same = posts.filter(x => (POOL[x.product] ? +x.product : 29) === id && !x.photo).sort((a, b) => (a.date + a.slug).localeCompare(b.date + b.slug));
  const i = Math.max(0, same.findIndex(x => x.slug === p.slug));
  return `assets/img/products/${id}/${pool[i % pool.length]}.jpg`;
}

// 제목 속 대표 키워드에 색을 입힌다
function titleHTML(title, keyword) {
  const t = esc(title);
  const k = keyword && esc(keyword);
  return k && t.includes(k) ? t.replace(k, `<em>${k}</em>`) : t;
}

function html(p, photo) {
  const th = THEME[p.category] || THEME['구매 가이드'];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700;900&display=block" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{font-family:'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif;background:${th.bg};color:${th.ink};-webkit-font-smoothing:antialiased}
.card{display:grid;grid-template-columns:620px 1fr;width:${W}px;height:${H}px}
.txt{display:flex;flex-direction:column;padding:60px 56px 52px 64px}
.chip{align-self:flex-start;padding:9px 18px;border-radius:999px;background:${th.chip};color:${th.chipInk};font-size:22px;font-weight:700;letter-spacing:-.01em}
h1{margin-top:auto;font-size:var(--fs,60px);line-height:1.24;font-weight:900;letter-spacing:-.045em;word-break:keep-all;overflow-wrap:anywhere}
h1 em{font-style:normal;color:${th.em}}
.brand{display:flex;align-items:center;gap:12px;margin-top:auto;padding-top:28px;font-size:23px;font-weight:700;color:${th.sub}}
.brand img{display:block;width:auto;height:44px}
.brand span{padding-left:14px;border-left:2px solid currentColor;line-height:1}
.ph{position:relative;overflow:hidden}
.ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ph::after{content:'';position:absolute;left:0;top:0;bottom:0;width:6px;background:${th.em}}
</style></head><body><div class="card">
<div class="txt"><span class="chip">${esc(p.category || '수면 가이드')}</span><h1 id="t">${titleHTML(p.title, p.keyword)}</h1>
<p class="brand"><img src="${dataURI(th.dark ? 'assets/img/brand/logo-white.png' : 'assets/img/brand/logo.png')}" alt=""><span>수면 가이드</span></p></div>
<div class="ph"><img src="${dataURI(photo)}" alt=""></div>
</div></body></html>`;
}

export async function makeThumbs({ only = null, all = false } = {}) {
  const posts = loadPosts(BLOG);
  const todo = posts.filter(p => only ? only.includes(p.slug) : all || !fs.existsSync(path.join(OUT, `${p.slug}.jpg`)));
  if (!todo.length) { console.log('thumb: 만들 썸네일 없음'); return []; }
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = path.join(OUT, '_thumb.html');
  const made = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    for (const p of todo) {
      const photo = photoFor(p, posts);
      fs.writeFileSync(tmp, html(p, photo));
      await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0', timeout: 30000 });
      // 웹폰트를 기다린 뒤, 제목이 4줄을 넘지 않게 글자 크기를 줄인다
      await page.evaluate(async () => {
        await document.fonts.ready;
        const h = document.getElementById('t');
        for (let fs = 62; fs >= 40; fs -= 2) {
          h.style.setProperty('--fs', fs + 'px');
          const lines = Math.round(h.getBoundingClientRect().height / (fs * 1.24));
          if (lines <= (fs >= 52 ? 3 : 4)) break;
        }
      });
      const font = await page.evaluate(() => document.fonts.check('900 40px "Noto Sans KR"'));
      if (!font) console.log(`thumb: ${p.slug} — 웹폰트를 못 불러와 시스템 글꼴로 그렸습니다`);
      await page.screenshot({ path: path.join(OUT, `${p.slug}.jpg`), type: 'jpeg', quality: 86 });
      await page.screenshot({ path: path.join(OUT, `${p.slug}.webp`), type: 'webp', quality: 82 });
      console.log(`thumb: assets/img/blog/${p.slug}.jpg (${photo})`);
      made.push(p.slug);
    }
  } finally {
    await browser.close();
    fs.rmSync(tmp, { force: true });
  }
  return made;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const slugs = args.filter(a => !a.startsWith('--'));
  makeThumbs({ only: slugs.length ? slugs : null, all: args.includes('--all') })
    .catch(e => { console.error('thumb 실패:', e.message); process.exit(1); });
}
