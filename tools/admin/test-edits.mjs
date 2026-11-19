// 페이지 문구·사진 편집(edits.mjs) 시험 — node tools/admin/test-edits.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { EDIT_FILES, applyEdits, listEdits, stripEditAttrs, textToCore, coreToText } from './edits.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let n = 0; const ok = s => console.log('ok', ++n, s);
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// 1) 모든 칸: 같은 글로 덮어써도 다시 읽은 글이 같다(왕복 안정)
let fields = 0;
for (const f of EDIT_FILES) {
  const html = read(f.file), list = listEdits(html).filter(x => x.kind === 'text');
  const again = listEdits(applyEdits(html, { text: Object.fromEntries(list.map(x => [x.key, x.text])) }));
  for (const x of list) assert.equal(again.find(y => y.key === x.key)?.text, x.text, `${x.key} 왕복`);
  assert.equal(new Set(list.map(x => x.key)).size, list.length, `${f.key} 키 중복`);
  fields += list.length;
}
assert.ok(fields > 500); ok(`편집 칸 ${fields}개 — 같은 글로 덮어쓰면 그대로(키 중복 없음)`);

// 2) 고친 글이 들어가고, 앞뒤 부속(아이콘)은 그대로
const home = read('src/index.tpl.html'), hl = listEdits(home);
const best = hl.find(x => x.text === '잠스쿨 베스트'), more = hl.find(x => x.text === '전체 상품 보기');
let out = applyEdits(home, { text: { [best.key]: '이번 주 베스트', [more.key]: '상품 모두 보기' } });
assert.match(out, /id="best-t">이번 주 베스트<\/h2>/);
assert.match(out, /상품 모두 보기<svg aria-hidden="true"><use href="#i-right"\/><\/svg><\/a>/);
ok('제목·버튼 글 바뀜, 버튼 아이콘(svg)은 그대로');

// 3) 줄바꿈·굵게·강조, 위험한 글자는 글자로
assert.equal(textToCore('첫 줄\n**굵게** ==강조== <script>'), '첫 줄<br><b>굵게</b> <em>강조</em> &lt;script&gt;');
assert.equal(coreToText('폼부터<br class="br-md"> 겉커버까지 <strong>국산</strong> &amp; <em>100%</em>'), '폼부터\n겉커버까지 **국산** & ==100%==');
out = applyEdits(home, { text: { [best.key]: '<img src=x onerror=alert(1)>' } });
assert.ok(!/<img src=x/.test(out)); ok('줄바꿈 <br>, **굵게**, ==강조==, 태그는 글자로 바뀜(스크립트 못 넣음)');

// 4) 부속(작은 글씨)과 본문을 따로: 진행 중인 혜택 「기간 한정」 + 「14일 무료체험」
const ev = read('src/partials/pd-events.html'), el = listEdits(ev);
const tag = el.find(x => x.text === '기간 한정'), body = el.find(x => x.text === '14일 무료체험');
out = stripEditAttrs(applyEdits(ev, { text: { [tag.key]: '오늘만', [body.key]: '30일 무료체험' } }));
assert.match(out, /<li><span>오늘만<\/span>30일 무료체험<\/li>/); ok('바깥 글과 안쪽 작은 글씨를 둘 다 고쳐도 둘 다 반영');

// 5) 사진: 주소·크기·설명, 잘못된 주소는 무시
const pimg = hl.find(x => x.kind === 'img');
out = applyEdits(home, { img: { [pimg.key]: { src: 'assets/img/up/story-1.jpg', w: 800, h: 600, alt: '새 사진 "설명"' } } });
assert.match(out, /<img src="assets\/img\/up\/story-1\.jpg" alt="새 사진 &quot;설명&quot;" width="800" height="600"/);
out = applyEdits(home, { img: { [pimg.key]: { src: 'https://evil.example/x.jpg' } } });
assert.ok(out.includes(`src="${pimg.src}"`)); ok('사진 주소·크기·설명 바뀜, 사이트 밖 주소는 무시');

// 6) 빈 글·없는 키는 무시, 표시 지우기
out = applyEdits(home, { text: { [best.key]: '   ', 'home-999999': '없는 칸' } });
assert.match(out, /id="best-t">잠스쿨 베스트<\/h2>/);
assert.ok(!/data-edit/.test(stripEditAttrs(home))); ok('빈 글·없는 칸은 무시, 표시(data-edit)는 사이트에 안 나감');

console.log(`\n페이지 문구 편집 시험 ${n}개 통과`);
