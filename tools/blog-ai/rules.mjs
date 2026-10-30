// 수면 가이드 글 규칙(생성기 generate.mjs 와 관리자 어드민이 같이 쓴다): 타사명·금지 표현·카테고리·대표 키워드 검사
// 외부 링크는 공식 홈·공식몰·스마트스토어만 허용
export const OWN_LINK = /^https?:\/\/(?:jamschool\.kr|jamschool\.co\.kr|smartstore\.naver\.com\/healingq)/;

export const COMPETITORS = ['엘라비아', '엠마', '딥코어', '나혼자살림', '센스맘', '탑토퍼', '꼬메벨로', '슬릭스', '알파침대', '에스베딩', '뜨란채', '삼익', '포세뜨', '캐나다프리모', '자미스', '베드리움', '스너그홈', '아라홈', '더릭스', '동서가구', '이너스', '한샘', '몽스홈', '숙면연구소', '에넥스', '로디아스', '시몬스', '에이스침대', '지누스', '슬립퍼', '몽제', '삼분의일', '코웨이', '템퍼', '이브자리', '까사미아'];
export const BANNED = [
  [/치료|완치|교정 ?효과|질환|처방|의학적|임상|의사가 추천|특효|효능/, '의료·효능 표현'],
  [/(?:통증|증상|디스크|요통|허리 ?병).{0,8}(?:사라|없어지|줄어|완화|해소|낫|좋아지|개선)/, '통증·증상 개선 단정'],
  [/최고의|최상의|업계 ?1위|국내 ?1위|유일한|유일하게|단연|압도적|완벽한|혁신적인|놀라운/, '최상급·과장 표현'],
  [/100% ?(?:효과|만족)|부작용(?:이)? 없|평생 사용|영구적/, '보장성 과장'],
  [/알아보겠습니다|살펴보겠습니다|결론적으로|요약하자면|꿀팁|🙂|😊|👍|✨|💡/, '상투 표현·이모지'],
];
export const CATEGORIES = ['구매 가이드', '사용 팁', '제품 이야기', '생활 공간'];

// 제목 유사도: 공백 뺀 글자 2개 묶음의 자카드 계수
const bigrams = s => { const t = s.replace(/\s+/g, ''); const set = new Set(); for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2)); return set; };
export const similar = (a, b) => { const A = bigrams(a), B = bigrams(b); let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n || 1); };
export const norm = s => String(s || '').replace(/\s+/g, '');
const count = (hay, needle) => needle ? hay.split(needle).length - 1 : 0;
export function checkKeyword(meta, body, keyword, posts) {
  const errs = [];
  if (!keyword) return errs;
  const first = (body || '').trim().split(/\n\s*\n/)[0] || '';
  if (!norm(meta.title).includes(norm(keyword))) errs.push(`제목에 대표 키워드 "${keyword}" 없음`);
  if (!norm(first).includes(norm(keyword))) errs.push(`첫 문단에 대표 키워드 "${keyword}" 없음`);
  const n = count(norm(body), norm(keyword));
  if (n < 2 || n > 10) errs.push(`대표 키워드 본문 ${n}회 — 2~10회`);
  for (const p of posts) {
    if (p.slug === meta.slug) continue;
    if (p.keyword && norm(p.keyword) === norm(keyword)) errs.push(`이미 같은 대표 키워드로 발행된 글: ${p.slug}`);
    const sim = similar(meta.title || '', p.title || '');
    if (sim >= 0.5) errs.push(`제목이 기존 글과 비슷함(${sim.toFixed(2)}): ${p.title}`);
  }
  return errs;
}

// 사람이 쓴 글(어드민) 검사: 발행을 막는 것(block)과 고치면 좋은 것(warn)으로 나눈다
export function checkPost(md, meta, body, posts = []) {
  const block = [], warn = [];
  for (const [re, why] of BANNED) { const m = md.match(re); if (m) block.push(`금지 표현(${why}): "${m[0]}"`); }
  for (const c of COMPETITORS) if (md.includes(c)) block.push(`타사 상품·브랜드명: ${c}`);
  if (/수니홈|sooneehome/i.test(md)) block.push('타사 상품·브랜드명: 수니홈');
  for (const m of md.matchAll(/https?:\/\/[^\s)]+/g)) if (!OWN_LINK.test(m[0])) block.push(`외부 링크: ${m[0]}`);
  warn.push(...checkKeyword(meta, body, meta.keyword, posts));
  const len = (body || '').replace(/\s+/g, '').length;
  if (len < 800) warn.push(`본문 ${len}자(공백 제외) — 800자 이상이면 검색에 유리`);
  if ((body.match(/^##\s/mg) || []).length < 3) warn.push('## 소제목 3개 이상이면 목차가 붙고 읽기 쉬움');
  if (!/^##\s+자주 묻는 질문/m.test(body)) warn.push('"## 자주 묻는 질문" 섹션이 있으면 AI 검색·FAQ 노출에 유리');
  if (meta.title && [...meta.title].length > 34) warn.push(`제목 ${[...meta.title].length}자 — 34자 이내면 검색 결과에서 잘리지 않음`);
  if (meta.description && [...meta.description].length > 80) warn.push(`설명 ${[...meta.description].length}자 — 80자 이내 권장`);
  return { block, warn };
}
