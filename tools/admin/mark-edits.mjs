// 템플릿에 '어드민에서 고칠 수 있음' 표시(data-edit·data-edit-img)를 붙인다 — node tools/admin/mark-edits.mjs [--dry]
//   이미 붙은 번호는 그대로 두고, 새로 생긴 문구·사진에만 다음 번호를 붙인다(번호가 곧 content/site.json 의 저장 키라서 바꾸면 안 된다)
//   글 부분이 있는 요소만: 글 + <br>·<b>·<strong>·<em> 로만 된 것(앞뒤 아이콘·작은 글씨는 그대로 두고 가운데만 고침, edits.mjs splitCore)
//   빼는 것: <head>·<script>·<style>·<svg>·<noscript>·<textarea>·<select> 안, 화면 낭독기 전용(sr-only), 숫자 애니메이션(data-count), 빌드가 채우는 자리
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDIT_FILES, closeOf, splitCore, coreToText } from './edits.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRY = process.argv.includes('--dry');
const TAGS = 'h1|h2|h3|h4|h5|p|li|dt|dd|td|th|blockquote|figcaption|summary|a|button|span|small|label|legend|caption|b|strong|em';
const SKIP_IN = ['head', 'script', 'style', 'svg', 'noscript', 'textarea', 'select', 'template'];

let total = 0;
for (const f of EDIT_FILES) {
  const file = path.join(ROOT, f.file);
  if (!fs.existsSync(file)) { console.log(`없음: ${f.file}`); continue; }
  let html = fs.readFileSync(file, 'utf8');
  // 빼는 구역
  const skip = [];
  for (const t of SKIP_IN) for (const m of html.matchAll(new RegExp(`<${t}\\b[^>]*>`, 'g'))) { const c = closeOf(html, t, m.index + m[0].length); if (c) skip.push([m.index, c.end]); }
  const inSkip = i => skip.some(([a, b]) => a <= i && i < b);
  const maxNo = re => Math.max(0, ...[...html.matchAll(re)].map(m => +m[1]));
  let n = maxNo(new RegExp(`data-edit="${f.key}-(\\d+)"`, 'g')), ni = maxNo(new RegExp(`data-edit-img="${f.key}-img-(\\d+)"`, 'g'));
  const ins = [];   // [위치, 넣을 글]
  const samples = [];
  for (const m of html.matchAll(new RegExp(`<(${TAGS})\\b([^>]*)>`, 'g'))) {
    const tag = m[1], attrs = m[2], at = m.index, openEnd = at + m[0].length;
    if (/^(b|strong|em)$/.test(tag) && !attrs.trim()) continue;   // 속성 없는 굵게·강조는 부모 글의 일부(따로 꾸민 것만 따로 고침)
    if (inSkip(at) || /\sdata-edit=/.test(attrs) || /\bsr-only\b/.test(attrs) || /\sdata-count=/.test(attrs)) continue;
    const c = closeOf(html, tag, openEnd); if (!c) continue;
    const sp = splitCore(html.slice(openEnd, c.innerEnd)); if (!sp) continue;
    ins.push([at + 1 + tag.length, ` data-edit="${f.key}-${String(++n).padStart(3, '0')}"`]);
    if (samples.length < 4) samples.push(coreToText(sp.core).slice(0, 40));
  }
  let imgs = 0;
  for (const m of html.matchAll(/<img\b([^>]*?)(\s*\/?)>/g)) {
    if (inSkip(m.index) || /\sdata-edit-img=/.test(m[1]) || !/\ssrc="assets\/img\//.test(m[1])) continue;
    ins.push([m.index + 4 + m[1].length, ` data-edit-img="${f.key}-img-${++ni}"`]); imgs++;   // 맨 뒤에 붙인다(빌드 picturize 가 <img src=" 로 시작하는 것을 찾음)
  }
  ins.sort((a, b) => b[0] - a[0]);
  for (const [i, s] of ins) html = html.slice(0, i) + s + html.slice(i);
  total += ins.length;
  console.log(`${f.label}(${f.file}): 새 표시 ${ins.length - imgs}개 · 사진 ${imgs}개${samples.length ? ` 예: ${samples.join(' / ')}` : ''}`);
  if (!DRY && ins.length) fs.writeFileSync(file, html);
}
console.log(`${DRY ? '(시험) ' : ''}모두 ${total}개`);
