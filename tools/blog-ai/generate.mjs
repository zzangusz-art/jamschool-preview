// 잠스쿨 수면 가이드 — AI 글 자동 작성기
// 사용:
//   node tools/blog-ai/generate.mjs            다음 주제 1편 작성 → 검증 통과 시 content/blog/<slug>.md 로 발행
//   node tools/blog-ai/generate.mjs --topic id  특정 주제
//   node tools/blog-ai/generate.mjs --count 3   대기열 순서대로 3편
//   node tools/blog-ai/generate.mjs --check     API 호출 없이 기존 글 전체를 같은 검증기로 검사
// 주제마다 대표 키워드(keyword) 하나: 제목·첫 문단 필수, 이미 발행된 글과 키워드·제목이 겹치면 발행하지 않는다.
// 발행한 글은 썸네일(assets/img/blog/<slug>.jpg)을 함께 만든다(tools/blog/thumb.mjs, Chrome 필요).
// 검증에 실패한 글은 발행하지 않고 content/drafts/ 에 남긴다(사람이 보고 고친 뒤 content/blog/ 로 옮기면 발행).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, loadPosts } from '../blog/lib.mjs';
import { BANNED, CATEGORIES, COMPETITORS, OWN_LINK, checkKeyword, checkPost, norm, similar } from './rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BLOG = path.join(ROOT, 'content/blog');
const DRAFTS = path.join(ROOT, 'content/drafts');
const TOPICS = path.join(BLOG, '_topics.json');
const MODEL = process.env.BLOG_MODEL || 'claude-opus-5-5';
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };

// ── 사실 목록: 사이트 데이터(data.js)에서만 만든다. 순서를 고정해 프롬프트 캐시가 유지되게 한다
function loadData() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/data.js'), 'utf8'), ctx);
  return ctx.window.JAM;
}
const won = n => n.toLocaleString('ko-KR') + '원';
function factSheet(J) {
  const O = J.OPTIONS_29, P = J.PRODUCTS.find(p => p.id === 29);
  const L = [];
  L.push('[브랜드] 잠스쿨(JAMSCHOOL). 상호 잠스쿨, 대표 노치영. 국내 생산 매트리스 브랜드. 고객센터 010-9610-8868(평일 09:00~17:00, 토·일·공휴일 휴무).');
  L.push(`[대표 제품] ${P.name}. 공식몰 주소 product-29.html. 구매평 ${P.reviews.toLocaleString('ko-KR')}건, 평점 ${P.rating.toFixed(2)}(2026년 10월 공식몰 기준).`);
  L.push('[두께] 침대형 7cm(침대 프레임 위), 바닥형 12cm(바닥에 바로, 침대 위에서도 가능). 고객의 70% 이상이 바닥형 선택. 성인 1인에게는 바닥형 슈퍼싱글 권장.');
  L.push('[사이즈] 길이 200cm. 폭 멀티싱글 75cm, 슈퍼싱글 110cm, 퀸 150cm. 멀티싱글=체구 작은 분·아이·차박·캠핑·간이침대, 슈퍼싱글=성인 1인, 퀸=2인 또는 성인 1인이 넓게.');
  L.push(`[접은 크기] 폭 × 깊이 ${O.depthFolded}cm × 높이(7cm형 ${O.folded['7']}cm, 12cm형 ${O.folded['12']}cm).`);
  for (const t of O.thickness) for (const s of O.size) { const k = `${t.id}-${s.id}`; L.push(`[옵션] ${t.label} ${t.sub} ${s.label}: 펼친 ${s.w}×200×${t.id}cm, 접은 ${s.w}×${O.depthFolded}×${O.folded[t.id]}cm, 무게 ${O.weight[k]}kg, 할인가 ${won(O.price[k])}(정가 ${won(O.list[k])}, 2026년 10월 상세페이지 이벤트 가격표 기준).`); }
  L.push('[색상] 그레이, 아이보리. 색상별 가격 같음.');
  L.push(`[쿠폰] 공식몰 신규 회원 가입축하 쿠폰 10,000원 → 침대형 멀티싱글 ${(O.price['7-MS'] - 10000).toLocaleString('ko-KR')}원부터.`);
  L.push('[폼] 4세대 고밀도 폼, 100% 국산 폼. 밀도 31kg/m³(KATRI 시험성적서 측정값 31.30kg/m³, KS M 6672, 표기 기준 31±2kg/m³). 반복 압축 영구 줄음률 시험 KS M 6672:2016 100,000회. 잠스쿨 연구소 4세대 제품.');
  L.push('[커버] 에어론 솜을 넣은 누빔 커버. 지퍼 3개로 세 칸 분리. 찬물 단독 세탁, 중성세제·세탁망 권장, 뜨거운 물·건조기는 수축 원인. 바닥면 미끄럼 방지 코팅.');
  L.push('[사용] 열에 강한 소재 — 전기장판·돌침대·온열 제품과 함께 사용 가능. 압축 포장 배송, 원래 크기로 복원까지 약 2일. 출고 전 기본 탈취→자연 건조→자외선 살균 소독 3단계 탈취. 4단계 유해물질 제거 공정. 섬유 탈취제(페브리즈 등) 사용 시 반품 어려움.');
  L.push('[활용] 접어서 보관, 두 장 겹쳐 앉고 한 장 세우면 소파 등받이, 펼치면 침대. 자취방, 잦은 이사, 차박, 손님용, 거실 휴식, 재택근무.');
  for (const t of J.TESTS) L.push(`[시험] ${t.q} — ${t.org}: ${t.rows.map(r => r.join(' ')).join(', ')}.`);
  L.push('[상세페이지 안내] 성인은 자는 동안 땀을 약 250ml 흘린다(브랜드 상세페이지 안내 문구). 방수 속커버 사용 권장, 이벤트 기간에는 방수 속커버를 매트리스에 씌워 발송.');
  L.push('[보증·구매] 14일 무료체험(기간 한정 이벤트, 반품 시 왕복 배송비 고객 부담, 환불은 수거 접수일 기준 3~10일). 2년 안에 폼이 꺼지면 폼 무상 교체. (기간 한정) 무료 배송. 오후 1시 이전 결제 확인 시 당일 출고(주말·공휴일 제외), 평균 1~3일, 로젠택배·대신택배. 교환·반품은 수령 후 7일 이내 고객센터 접수, 단순 변심 왕복 배송비 매트리스 36,000원(편도 18,000원)·커버류 6,000원(편도 3,000원), 제주·도서산간 +7,000원, 제품 하자는 무료. 압축 포장 개봉 후 반품 어려울 수 있음.');
  const M = J.MARKET;
  L.push(`[시세] ${M.source} 등록 상품 ${M.basis}, ${M.date} 조회: ${M.bands.map(b => `${b.k}(${b.sub}) ${won(b.lo)}~${won(b.hi)}`).join(', ')}. 잠스쿨 바닥형 12cm 슈퍼싱글 ${won(M.ours.v)} — 폼 매트리스 중 높은 가격대, 스프링 내장·천연라텍스와 비슷한 가격대. 같은 조사에서 다나와 사양란에 밀도를 적은 일반 폼 3단 접이식은 ${M.density.total}개 중 ${M.density.listed}개, 얇은 폼은 5~6cm가 흔했다. 경쟁사 상품명은 쓰지 않는다.`);
  // 다른 상품(상품명 키워드 글용): 이름·요약·특징·가격·구매평 + 공식몰 상품정보 제공고시
  for (const p of J.PRODUCTS.filter(x => x.id !== 29)) {
    L.push(`[상품 ${p.id}] ${p.name}(줄여서 "${p.short}", 상세 product-${p.id}.html). ${p.summary}.${p.points.length ? ` 특징: ${p.points.join(', ')}.` : ''} 할인가 ${won(p.price)}(정가 ${won(p.list)}), 구매평 ${p.reviews.toLocaleString('ko-KR')}건 평점 ${p.rating.toFixed(2)}(2026년 10월 공식몰 기준).`);
    const N = (J.NOTICE || {})[p.id];
    if (N) L.push(`[상품 ${p.id} 제공고시] ${N.map(([k, v]) => `${k}: ${v.join(' / ')}`).join(' | ')}`);
  }
  L.push('[상품 36 상세 문구] 탄탄함 대신 폭신한 쿠션감을 찾으면 삼각 등쿠션을 다리베개로 쓰는 것도 권한다.');
  // 실제 구매평(원문 일부). 인용할 때는 원문을 바꾸지 않는다
  for (const r of J.REVIEWS) L.push(`[구매평 ${r.id}${r.opt ? ' · ' + r.opt : ''}] ${r.text.slice(0, 220)}${r.text.length > 220 ? '…' : ''}`);
  for (const t of J.SHORT_REVIEWS) L.push(`[짧은 구매평] ${t}`);
  return L.join('\n');
}
// 글에 나온 "숫자+단위"가 사실 목록에 있는지 확인하기 위한 허용 숫자
function allowedNumbers(sheet) {
  const set = new Set(['1', '2', '3', '4', '5', '6', '7', '10', '12', '30', '100', '2026']);
  for (const m of sheet.matchAll(/\d[\d,]*(?:\.\d+)?/g)) set.add(m[0].replace(/,/g, ''));
  return set;
}


function validate(md, { allowed, slugs, keyword, posts = [] }) {
  const errs = [];
  let meta, body;
  try { ({ meta, body } = parseFrontmatter(md)); } catch (e) { return { ok: false, errs: ['머리말 형식 오류: ' + e.message] }; }
  for (const k of ['title', 'description', 'slug', 'category', 'tags']) if (!meta[k] || (Array.isArray(meta[k]) && !meta[k].length)) errs.push(`머리말 ${k} 누락`);
  if (meta.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.slug)) errs.push('slug는 영문 소문자·숫자·하이픈만');
  if (meta.slug && slugs.has(meta.slug)) errs.push(`이미 있는 slug: ${meta.slug}`);
  if (meta.category && !CATEGORIES.includes(meta.category)) errs.push(`category는 ${CATEGORIES.join('/')} 중 하나`);
  if (meta.title && (meta.title.length < 12 || meta.title.length > 60)) errs.push('제목은 12~60자');
  if (meta.description && (meta.description.length < 40 || meta.description.length > 140)) errs.push('설명은 40~140자');
  const len = (body || '').replace(/\s+/g, '').length;
  if (len < 800 || len > 4500) errs.push(`본문 길이 ${len}자(공백 제외) — 800~4,500자`);
  if (!/\n##\s+자주 묻는 질문/.test('\n' + body)) errs.push('"## 자주 묻는 질문" 섹션 없음');
  if ((body.match(/\n###\s+Q\./g) || []).length < 2) errs.push('FAQ 질문(### Q.) 2개 이상 필요');
  if ((body.match(/^##\s/mg) || []).length < 3) errs.push('## 소제목 3개 이상 필요');
  for (const [re, why] of BANNED) { const m = md.match(re); if (m) errs.push(`금지 표현(${why}): "${m[0]}"`); }
  for (const c of COMPETITORS) if (md.includes(c)) errs.push(`타사 상품·브랜드명 사용: ${c}`);
  if (/수니홈|sooneehome/i.test(md)) errs.push('타사 상품·브랜드명 사용: 수니홈');
  for (const m of md.matchAll(/https?:\/\/[^\s)]+/g)) if (!OWN_LINK.test(m[0])) errs.push(`외부 링크 금지: ${m[0]}`);
  const unknown = new Set();
  for (const m of body.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(kg\/m³|kg|cm|mm|㎛|원|회|Bq\/m³|Bq|일|년|개월|%|ml|시|만)/g)) {
    const n = m[1].replace(/,/g, '');
    if (!allowed.has(n)) unknown.add(m[0]);
  }
  if (unknown.size) errs.push(`사실 목록에 없는 수치: ${[...unknown].join(', ')}`);
  errs.push(...checkKeyword(meta, body, keyword || meta.keyword, posts));
  return { ok: errs.length === 0, errs, meta, len };
}

const SYSTEM = (sheet) => `당신은 잠스쿨 공식몰 "수면 가이드" 담당 에디터입니다. 3단 접이식 매트리스·토퍼·베개를 사려는 사람이 검색창이나 AI에게 묻는 질문에, 브랜드가 직접 확인한 사실로 답하는 글을 씁니다.

# 반드시 지킬 것
- 아래 [사실 목록]에 있는 내용만 사실로 씁니다. 목록에 없는 수치·시험·효과·후기를 만들지 않습니다. 모르는 것은 쓰지 않습니다.
- 건강·의료 효과를 말하지 않습니다(치료, 통증 완화, 디스크 개선, 자세 교정 효과 등 금지). 허리 이야기를 할 때는 "탄탄하게 받쳐 준다"처럼 제품 특성만 말하고, 증상이 있으면 의료진과 상담하라고 안내합니다.
- 타사 브랜드·상품명을 쓰지 않습니다. 시장 비교는 [사실 목록]의 시세 범위만, 조회일과 출처를 밝혀서 씁니다. 다른 제품을 깎아내리지 않습니다.
- 최상급·과장 표현(최고, 1위, 유일, 완벽, 혁신)과 상투 표현(알아보겠습니다, 결론적으로, 꿀팁), 이모지를 쓰지 않습니다.
- 가격과 이벤트는 바뀔 수 있으니 "2026년 10월 상세페이지 할인가 기준"처럼 기준 시점을 붙입니다.

# 문체
- 존댓말 "-습니다/-입니다"체. 한 문장은 짧게, 한 문단은 2~4문장.
- 첫 문단에서 질문에 바로 답합니다(결론 먼저). 그다음 이유와 숫자.
- 숫자를 비교할 때는 마크다운 표를 씁니다. 목록은 꼭 필요할 때만.
- 사람이 직접 쓴 글처럼, 같은 문장 구조를 반복하지 않습니다. "~하는 것이 중요합니다" 같은 말로 문단을 끝내지 않습니다.
- 내부 링크는 상품 상세(product-<번호>.html, 사실 목록의 상품 번호), 전체 상품(shop.html), 홈 섹션(index.html#price, index.html#safety, index.html#faq), 기존 글(blog/<slug>.html)만 씁니다.
- 대표 키워드는 제목 앞부분과 첫 문단에 자연스럽게 넣고, 소제목 하나에도 넣습니다. 본문 전체에서 3~8번 정도, 한 문장에 두 번 넣지 않습니다.
- 상품명은 "(줄여서 …)"의 짧은 이름을 씁니다. 베개·다리베개·쿠션도 효과는 말하지 않고 높이·소재·세탁·쓰는 장면만 씁니다.
- 구매평을 인용할 때는 [구매평] 원문을 짧게 그대로 따옴표로 옮기고 "구매평 일부"라고 밝힙니다. 후기를 지어내지 않습니다.

# 출력 형식 (이 형식 외의 말은 출력하지 않습니다)
---
title: (12~60자, 검색 질문이 드러나게)
description: (40~140자, 글의 답을 한 문장으로)
slug: (영문 소문자-하이픈, 주제 뜻이 드러나게)
category: (구매 가이드 | 사용 팁 | 제품 이야기 | 생활 공간 중 하나)
tags: (쉼표로 구분 3~5개)
---
(첫 문단: 질문에 대한 답)

## (소제목 3~6개)
...

## 자주 묻는 질문

### Q. (질문)
(답 1~3문장)

### Q. (질문)
(답 1~3문장)

본문은 공백 제외 1,000~2,500자로 씁니다.

[사실 목록]
${sheet}`;

function userMsg(topic, posts, today) {
  return `오늘 날짜: ${today}
주제 ID: ${topic.id}
주제: ${topic.title}
대표 키워드(제목·첫 문단 필수): ${topic.keyword || topic.title}
함께 쓸 검색어: ${(topic.keywords || []).join(', ')}
다룰 방향: ${topic.angle}
권장 카테고리: ${topic.category}
중심 상품: product-${topic.product || 29}.html

이미 발행된 글(대표 키워드·제목이 겹치지 않게 하고, 관련 있으면 내부 링크로 연결):
${posts.map(p => `- ${p.title}${p.keyword ? ` [키워드: ${p.keyword}]` : ''} → blog/${p.slug}.html`).join('\n') || '- 없음'}

위 형식대로 글 한 편을 써 주세요.`;
}

async function callClaude(client, system, messages) {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // 안전 분류기가 거절하면 서버가 권장 모델로 다시 시도
    output_config: { effort: 'high' },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  });
  if (res.stop_reason === 'refusal') return { refused: true, res };
  if (res.stop_reason === 'max_tokens') throw new Error('max_tokens 도달 — 글이 잘렸습니다');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim().replace(/^```(?:markdown)?\s*|\s*```$/g, '');
  return { text, res };
}

async function main() {
  const J = loadData();
  const sheet = factSheet(J);
  const allowed = allowedNumbers(sheet);
  const posts = loadPosts(BLOG);

  if (flag('--check')) {
    let bad = 0;
    for (const f of fs.readdirSync(BLOG).filter(f => f.endsWith('.md') && !f.startsWith('_'))) {
      const md = fs.readFileSync(path.join(BLOG, f), 'utf8');
      // 어드민에서 사람이 쓴 글(source: admin)·임시저장 글은 금지 표현·타사명·외부 링크만 막는다(분량·FAQ 등은 어드민이 안내만)
      const { meta: m, body: b } = parseFrontmatter(md);
      if (m.source === 'admin' || m.draft === 'true') {
        const r = checkPost(md, m, b, posts.filter(p => p.slug !== m.slug));
        console.log(`${r.block.length ? 'NG ' : 'OK '} ${f} (어드민${m.draft === 'true' ? '·임시저장' : ''})${r.block.length ? '\n    - ' + r.block.join('\n    - ') : ''}`);
        if (r.block.length && m.draft !== 'true') bad++;
        continue;
      }
      const v = validate(md, { allowed, slugs: new Set(), posts });
      console.log(`${v.ok ? 'OK ' : 'NG '} ${f} (${v.len ?? '?'}자)${v.ok ? '' : '\n    - ' + v.errs.join('\n    - ')}`);
      if (!v.ok) bad++;
    }
    process.exit(bad ? 1 : 0);
  }

  const topics = JSON.parse(fs.readFileSync(TOPICS, 'utf8'));
  const id = opt('--topic');
  const n = Math.max(1, Math.min(5, +(opt('--count') || 1)));
  const queue = id ? topics.filter(t => t.id === id) : topics.filter(t => t.status === 'todo').slice(0, n);
  if (!queue.length) { console.log('작성할 주제가 없습니다(_topics.json 의 status:"todo" 없음).'); return; }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic(); // ANTHROPIC_API_KEY 등 환경 자격 증명 사용
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  const system = SYSTEM(sheet);
  for (const topic of queue) {
    // 앞에서 발행한 글까지 다시 읽어 키워드·제목 중복을 막는다
    await writeOne({ client, system, topic, posts: loadPosts(BLOG), allowed, today });
    fs.writeFileSync(TOPICS, JSON.stringify(topics, null, 2) + '\n');
  }
}

async function writeOne({ client, system, topic, posts, allowed, today }) {
  const messages = [{ role: 'user', content: userMsg(topic, posts, today) }];
  const slugs = new Set(posts.map(p => p.slug));
  const keyword = topic.keyword;

  let out, v;
  for (let attempt = 1; attempt <= 2; attempt++) {
    out = await callClaude(client, system, messages);
    if (out.refused) { console.log(`거절됨(${out.res.stop_details?.category ?? '분류 없음'}) — ${topic.id} 는 이번 회차에 발행하지 않습니다.`); return; }
    const u = out.res.usage;
    console.log(`[${topic.id}] 응답 ${attempt}차: 입력 ${u.input_tokens} / 캐시 읽기 ${u.cache_read_input_tokens ?? 0} / 출력 ${u.output_tokens} 토큰, 모델 ${out.res.model}`);
    v = validate(out.text, { allowed, slugs, keyword, posts });
    if (v.ok) break;
    console.log('검증 실패:\n  - ' + v.errs.join('\n  - '));
    if (attempt === 1) {
      messages.push({ role: 'assistant', content: out.res.content });
      messages.push({ role: 'user', content: `아래 문제를 고쳐서 같은 형식으로 글 전체를 다시 써 주세요.\n- ${v.errs.join('\n- ')}` });
    }
  }

  // 머리말에 날짜·작성자·상품·대표 키워드·썸네일·AI 작성 표시를 붙인다
  let meta, body;
  try { ({ meta, body } = parseFrontmatter(out.text)); } catch { meta = {}; body = out.text; }
  const slug = meta.slug || topic.id;
  const front = ['---', `title: ${meta.title}`, `description: ${meta.description}`, `slug: ${slug}`, `date: ${today}`,
    `category: ${meta.category}`, `tags: ${(meta.tags || []).join(', ')}`, `keyword: ${keyword || ''}`, `product: ${topic.product || 29}`,
    `image: assets/img/blog/${slug}.jpg`, ...(topic.photo ? [`photo: ${topic.photo}`] : []), 'author: 잠스쿨 편집팀', `generated: ${MODEL} ${today}`, `topic: ${topic.id}`, '---'].join('\n');
  const md = `${front}\n${body}\n`;

  if (!v.ok) {
    fs.mkdirSync(DRAFTS, { recursive: true });
    const f = path.join(DRAFTS, `${today}-${topic.id}.md`);
    fs.writeFileSync(f, `<!-- 검증 실패로 발행하지 않음:\n- ${v.errs.join('\n- ')}\n-->\n` + md);
    console.log(`초안으로 저장: ${path.relative(ROOT, f)}`);
    topic.status = 'draft'; topic.draft = path.relative(ROOT, f).replace(/\\/g, '/');
    return;
  }
  const f = path.join(BLOG, `${slug}.md`);
  fs.writeFileSync(f, md);
  console.log(`발행: ${path.relative(ROOT, f)} (${v.len}자, 대표 키워드 "${keyword}")`);
  topic.status = 'done'; topic.slug = slug; topic.date = today;
  // 썸네일: 실패해도 글은 발행 상태로 둔다(빌드가 상품 사진으로 대신 보여 준다)
  try {
    const { makeThumbs } = await import('../blog/thumb.mjs');
    await makeThumbs({ only: [slug] });
  } catch (e) { console.log('썸네일 생성 건너뜀:', e.message); }
}

main().catch(async err => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => ({ default: null }));
  if (Anthropic && err instanceof Anthropic.AuthenticationError) console.error('인증 실패: ANTHROPIC_API_KEY를 확인하세요.');
  else if (Anthropic && err instanceof Anthropic.RateLimitError) console.error('요청 한도 초과: 잠시 뒤 다시 실행하세요.');
  else if (Anthropic && err instanceof Anthropic.BadRequestError) console.error('요청 오류(400):', err.message);
  else if (Anthropic && err instanceof Anthropic.APIConnectionError) console.error('연결 오류:', err.message);
  else if (Anthropic && err instanceof Anthropic.APIError) console.error(`API 오류 ${err.status}:`, err.message);
  else console.error(err);
  process.exit(1);
});
