// 블로그 대표 키워드 겹침 점검(매일) — 하나회원권 scripts/topic-overlap.js 의 잠스쿨판
//   node tools/monitor/keyword-check.mjs        → 측정/블로그/키워드점검_<날짜>.md · .json
// 점검: ① 발행 글끼리 대표 키워드 중복 ② 제목 유사도(글자 2개 묶음 0.5 이상 — 생성기와 같은 기준) ③ 대표 키워드가 거의 같은 글(0.7 이상)
//       ④ 대기열(todo)이 이미 발행된 키워드와 겹침·대기열 안 중복 ⑤ 상품 페이지와 같은 검색어를 노리는 글이 그 상품 페이지로 링크하는지
//       ⑥ 대기열 남은 편수·소진 예상일 ⑦ 생성기 규칙 검사(generate.mjs --check)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseFrontmatter } from '../blog/lib.mjs';
import { BLOG_DIR, SITE_ROOT, addDays, arg, kstDate } from './lib.mjs';

const date = arg('date', kstDate());
const CONTENT = path.join(SITE_ROOT, 'content/blog');
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
const grams = s => { const t = norm(s).replace(/\s/g, ''); const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
const sim = (a, b) => { const A = grams(a), B = grams(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); };
// 대표 키워드가 겹치는가: 「접는 매트리스」→「접는 매트리스 소파」처럼 뒤에 말을 붙인 롱테일은 일부러 만든 묶음이라 제외,
// 「접이식 매트리스 추천」↔「3단 접이식 매트리스 추천」처럼 앞 수식어만 다르거나 글자가 거의 같으면 겹침
const close = (a, b) => { if (a === b) return false; const [s, l] = a.length < b.length ? [a, b] : [b, a]; if (l.startsWith(s + ' ')) return false; return l.endsWith(s) || sim(a, b) >= 0.7; };

const posts = fs.readdirSync(CONTENT).filter(f => f.endsWith('.md')).map(f => {
  const src = fs.readFileSync(path.join(CONTENT, f), 'utf8'); const { meta, body } = parseFrontmatter(src);
  return { file: f, slug: meta.slug || f.replace(/\.md$/, ''), title: meta.title, keyword: norm(meta.keyword), date: meta.date, product: meta.product ? +meta.product : null, body };
}).sort((a, b) => String(b.date).localeCompare(String(a.date)));
const topics = JSON.parse(fs.readFileSync(path.join(CONTENT, '_topics.json'), 'utf8'));
const todo = topics.filter(t => t.status === 'todo');

const warn = [], info = [];
// ① 대표 키워드 중복 / 키워드 없음
const byKw = new Map();
for (const p of posts) { if (!p.keyword) { warn.push(`대표 키워드 없음: ${p.title} (${p.file})`); continue; } byKw.set(p.keyword, [...(byKw.get(p.keyword) || []), p]); }
for (const [k, list] of byKw) if (list.length > 1) warn.push(`대표 키워드 중복 「${k}」: ${list.map(p => p.title).join(' / ')}`);
// ②③ 제목·키워드 유사
for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++) {
  const a = posts[i], b = posts[j];
  const st = sim(a.title, b.title); if (st >= 0.5) warn.push(`제목이 비슷함(${st.toFixed(2)}): 「${a.title}」 · 「${b.title}」`);
  if (a.keyword && b.keyword && close(a.keyword, b.keyword)) info.push(`대표 키워드가 겹침: 「${a.keyword}」 · 「${b.keyword}」 — 같은 검색 결과를 두고 서로 경쟁할 수 있음`);
}
// ④ 대기열
const published = new Set(posts.map(p => p.keyword));
const seenTodo = new Map();
for (const t of todo) {
  const k = norm(t.keyword);
  if (published.has(k)) warn.push(`대기열 주제가 이미 발행된 키워드와 같음 「${k}」: ${t.id}`);
  if (seenTodo.has(k)) warn.push(`대기열 안에서 키워드 중복 「${k}」: ${seenTodo.get(k)} · ${t.id}`); else seenTodo.set(k, t.id);
  const near = posts.find(p => p.keyword && close(p.keyword, k));
  if (near) info.push(`대기열 「${k}」(${t.id})이 발행 글 「${near.keyword}」와 겹침 — 각도를 바꾸거나 키워드 조정`);
}
// ⑤ 상품 페이지와 같은 검색어 → 상품 페이지 링크 확인
const ctx = { window: {} }; ctx.globalThis = ctx.window;
const vm = await import('node:vm'); vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(SITE_ROOT, 'assets/js/data.js'), 'utf8').replace(/typeof window !== 'undefined' \? window : globalThis/, 'window'), ctx);
const PRODUCTS = ctx.window.JAM.PRODUCTS;
for (const p of posts) {
  const prod = PRODUCTS.find(x => p.keyword && (p.keyword.includes(x.short) || x.short.includes(p.keyword)));
  if (prod && !new RegExp(`product-${prod.id}\\.html`).test(p.body)) info.push(`「${p.title}」이 상품 「${prod.short}」과 같은 검색어 → 본문에 product-${prod.id}.html 링크를 넣으면 상품 페이지와 서로 밀어 줌`);
}
// ⑥ 대기열 소진
const perDay = 3, daysLeft = Math.floor(todo.length / perDay);
const runOut = addDays(date, daysLeft);
(daysLeft <= 7 ? warn : info).push(`대기열 남은 주제 ${todo.length}편 — 하루 ${perDay}편이면 ${runOut} 무렵 소진${daysLeft <= 7 ? '. 새 주제를 _topics.json 에 추가해야 자동 발행이 이어짐' : ''}`);
// ⑦ 생성기 규칙 검사
let check = { ok: true, out: '' };
try { check.out = execFileSync('node', ['tools/blog-ai/generate.mjs', '--check'], { cwd: SITE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
catch (e) { check = { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` }; warn.push('생성기 규칙 검사 실패 — 아래 로그 확인'); }

const recent = posts.filter(p => p.date && p.date >= addDays(date, -6));
const last = posts.map(p => p.date).filter(Boolean).sort().pop();
if (!last || last < addDays(date, -2)) warn.push(`최근 새 글 없음(마지막 발행 ${last || '없음'}) — 자동 발행이 멈춘 것 같음. GitHub 저장소 시크릿 ANTHROPIC_API_KEY 와 Actions 실행 기록 확인`);
const report = { date, posts: posts.length, todo: todo.length, runOut, warn, info, recent: recent.map(p => ({ date: p.date, title: p.title, keyword: p.keyword, slug: p.slug })), check: { ok: check.ok } };
fs.mkdirSync(BLOG_DIR, { recursive: true });
fs.writeFileSync(path.join(BLOG_DIR, `키워드점검_${date}.json`), JSON.stringify(report, null, 1), 'utf8');
fs.writeFileSync(path.join(BLOG_DIR, `키워드점검_${date}.md`), [
  `# 블로그 대표 키워드 점검 — ${date}`, '',
  `발행 ${posts.length}편 · 대기열 ${todo.length}편(소진 예상 ${runOut}) · 생성기 규칙 검사 ${check.ok ? '통과' : '실패'}`, '',
  '## 고칠 것', ...(warn.length ? warn.map(w => `- ${w}`) : ['- 없음(겹치는 대표 키워드·비슷한 제목 없음)']), '',
  '## 참고', ...(info.length ? info.map(w => `- ${w}`) : ['- 없음']), '',
  '## 최근 7일 발행', '| 날짜 | 제목 | 대표 키워드 |', '|---|---|---|', ...recent.map(p => `| ${p.date} | [${p.title}](https://jamschool.kr/blog/${p.slug}.html) | ${p.keyword} |`), '',
  '## 발행 글 대표 키워드 전체', ...posts.map(p => `- ${p.date} 「${p.keyword}」 ${p.title}`),
  ...(check.ok ? [] : ['', '## 생성기 검사 로그', '```', check.out.slice(-3000), '```']),
].join('\n') + '\n', 'utf8');
console.log(`키워드 점검: 발행 ${posts.length} · 대기열 ${todo.length} · 고칠 것 ${warn.length} · 참고 ${info.length} → 측정/블로그/키워드점검_${date}.md`);
for (const w of warn) console.log('  !', w);
