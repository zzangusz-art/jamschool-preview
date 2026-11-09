// 수면 가이드 썸네일: 글마다 매트리스·상품 실사 사진 + 제목 → assets/img/blog/<slug>.jpg·.webp (1200×630, 공유 이미지 겸용)
// 사용:
//   node tools/blog/thumb.mjs            썸네일이 없는 글만(--missing 과 같음)
//   node tools/blog/thumb.mjs --all      전부 다시
//   node tools/blog/thumb.mjs <slug> ... 지정한 글만
// Chrome이 필요하다(CHROME_PATH 또는 기본 설치 경로). 글 머리말에 photo: assets/img/... 를 적으면 그 사진을 쓴다.
// 적지 않으면 아직 어느 글도 안 쓴 사진 중 주제에 맞는 것을 골라 머리말에 적어 둔다(다시 만들어도 같은 사진, 다음 글은 이 사진을 피함).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPosts } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BLOG = path.join(ROOT, 'content/blog');
const OUT = path.join(ROOT, 'assets/img/blog');
const W = 1200, H = 630;

// 실사 사진만 골라 둔 상품별 사진 묶음. 같은 장면은 한 장만 넣는다(3단 ss-01=01, ss-02=04, ss-04=05, ss-05=06, ss-06=09, ss-07=10)
// 3단의 scenes/ 는 썸네일에 쓸 만한 크기만 넣었다(sofa-lie·floor-lie 는 너무 작아 뺐다)
const shots = (id, names) => names.map(n => `assets/img/products/${id}/${n}.jpg`);
const scenes = names => names.map(n => `assets/img/scenes/${n}.jpg`);
const POOL = {
  29: [...shots(29, ['01', '08', '05', '10']), ...scenes(['laptop', 'sleep-side', 'type-bed', 'type-floor', 'ivory-sit']),
    ...shots(29, ['02', '04', '06', '07', '09', 'ss-08', 'ss-09']), ...scenes(['sofa-sit']), ...shots(29, ['03'])],
  30: shots(30, ['01', '05', '02', '06', '07', '08']),
  39: shots(39, ['02', '03', '09', '04', '05', '08']),
  40: shots(40, ['01', '03', '02', '07', '04', '09', '08']),
  43: shots(43, ['02', '04', '05', '03', '06', '07', '08']),
  36: shots(36, ['01', '07', '02', '08', '09']),
  37: shots(37, ['01', '03', '07', '02', '04', '09']),
  38: shots(38, ['04', '03', '05', '06', '08', '09']),
  44: shots(44, ['05', '02', '04', '06', '07', '08']),
};
// 3단 사진의 장면: 글 제목·대표 키워드에 이 말이 있으면 그 사진을 먼저 쓴다
const SCENE = {
  'assets/img/products/29/01.jpg': ['무게', '손님', '접이식 침대', '거실'],             // 접는 장면
  'assets/img/products/29/02.jpg': ['원룸', '아침'],                                  // 일어나 기지개
  'assets/img/products/29/03.jpg': ['두께', '7cm', '12cm'],                           // 7cm·12cm 비교
  'assets/img/products/29/04.jpg': ['사이즈', '슈퍼싱글', '퀸', '멀티싱글'],            // 사이즈 겹침
  'assets/img/products/29/05.jpg': ['세탁', '방수', '커버', '진드기', '미끄럼', '라돈', '시험'],        // 커버 근접
  'assets/img/products/29/06.jpg': ['압축', '기준'],                                  // 세워 접은 모양
  'assets/img/products/29/07.jpg': ['밀도', '탄탄', '국내 생산', '라돈', '유해물질'],   // 커버를 누르는 손
  'assets/img/products/29/08.jpg': ['침대 위', '교체', '수명'],                        // 침대 위에 올린 모습
  'assets/img/products/29/09.jpg': ['관리', '아이보리'],                               // 바닥에 깐 아이보리
  'assets/img/products/29/10.jpg': ['보관', '차박', '캠핑', '이사'],                    // 보관 가방
  'assets/img/products/29/ss-08.jpg': ['바닥', '퀸'],                                 // 바닥에 깐 그레이
  'assets/img/products/29/ss-09.jpg': ['이음매', '단점'],                              // 칸 사이가 보이는 옆모습
  'assets/img/scenes/laptop.jpg': ['자취', '재택'],
  'assets/img/scenes/sleep-side.jpg': ['1인용', '부모님', '후기'],
  'assets/img/scenes/type-bed.jpg': ['토퍼', '침대 위'],
  'assets/img/scenes/type-floor.jpg': ['바닥', '전기장판'],
  'assets/img/scenes/ivory-sit.jpg': ['아이보리', '색상'],
  'assets/img/scenes/sofa-sit.jpg': ['소파', '거실'],
};
// 글자가 있거나(03) 작은(sofa-sit) 사진은 글 주제가 맞을 때만 쓴다
const ONLY_FIT = new Set(['assets/img/products/29/03.jpg', 'assets/img/scenes/sofa-sit.jpg']);
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

// 글이 쓴 사진 → 그 글들
const photoUse = posts => { const use = new Map(); for (const x of posts) if (x.photo) use.set(x.photo, [...(use.get(x.photo) || []), x.slug]); return use; };

// 사진 고르기: 머리말 photo → 다른 글이 덜 쓴 사진 → 주제에 맞는 장면 → 묶음 순서. 전부 쓰고 나면 가장 적게 쓴 사진을 다시 쓴다
export function pickPhoto(p, posts) {
  if (p.photo && fs.existsSync(path.join(ROOT, p.photo))) return p.photo;
  const use = photoUse(posts.filter(x => x.slug !== p.slug));
  const n = f => (use.get(f) || []).length;
  const text = `${p.title} ${p.keyword || ''}`;
  const fit = f => (SCENE[f] || []).filter(w => text.includes(w)).length;
  const pool = POOL[POOL[p.product] ? +p.product : 29].filter(f => !ONLY_FIT.has(f) || fit(f));
  return pool.map((f, i) => ({ f, i })).sort((a, b) => n(a.f) - n(b.f) || fit(b.f) - fit(a.f) || a.i - b.i)[0].f;
}

// 고른 사진을 글 머리말에 적어 둔다
function pinPhoto(p, photo) {
  const f = path.join(BLOG, p.file);
  const src = fs.readFileSync(f, 'utf8');
  if (/^photo:/m.test(src)) fs.writeFileSync(f, src.replace(/^photo:.*$/m, `photo: ${photo}`));
  else fs.writeFileSync(f, src.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, `$1\nphoto: ${photo}$2`));
}

// 점검용(tools/monitor/keyword-check.mjs): 겹친 사진, 상품별 아직 안 쓴 사진 수
export function photoStatus(posts) {
  const use = photoUse(posts);
  return { dup: [...use].filter(([, slugs]) => slugs.length > 1), left: id => (POOL[POOL[id] ? +id : 29]).filter(f => !use.has(f)).length };
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
      const pinned = p.photo && fs.existsSync(path.join(ROOT, p.photo));
      const photo = pickPhoto(p, posts);
      if (!pinned && posts.some(x => x.slug !== p.slug && x.photo === photo)) console.log(`thumb: ${p.slug} — 안 쓴 사진이 없어 ${photo} 를 다시 씁니다. 상품 사진을 더 받아 POOL 에 넣으면 풀립니다`);
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
      if (!pinned) { pinPhoto(p, photo); p.photo = photo; }
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
