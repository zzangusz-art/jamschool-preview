// 어드민 목록 편집(blocks.mjs) 시험 — node tools/admin/test-blocks.mjs
//   기본값이 모두 검사를 통과하는지, 잘못된 값은 거절되는지, 바꾼 값이 data.js 를 거쳐 그대로 쓰이는지
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { BLOCKS, cleanBlock } from './blocks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let n = 0; const ok = s => console.log('ok', ++n, s);
const jam = (ov = {}) => {
  const ctx = { window: { WEBP: new Set(), JAM_OVERRIDES: ov } }; ctx.globalThis = ctx.window; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/data.js'), 'utf8').replace(/typeof window !== 'undefined' \? window : globalThis/, 'window'), ctx);
  return JSON.parse(JSON.stringify(ctx.window.JAM));
};
const J = jam(), uploads = [];
const ctx = { products: J.PRODUCTS.map(p => p.id), lastSize: 0, image(v, f) { if (v && v.data) { uploads.push(v); if (f.sizeKey) this.lastSize = v.w; return (f.base ? 'up/' : 'assets/img/up/') + 'x.jpg'; } if (!/^assets\/img\//.test((f.base || '') + v)) { const e = new Error('사진'); e.status = 400; throw e; } return v; } };
const rejects = (name, value, re) => assert.rejects(cleanBlock(name, value, ctx), e => e.status === 400 && re.test(e.message), `${name} 거절`);

// 1) 기본값 13개: 통과하고, 두 번 다듬어도 같다
for (const k of Object.keys(BLOCKS)) { const a = await cleanBlock(k, J[k], ctx), b = await cleanBlock(k, a, ctx); assert.deepEqual(a, b, k); }
ok(`기본값 ${Object.keys(BLOCKS).length}개 모두 검사 통과·안정`);

// 2) 잘못된 값은 거절
await rejects('FAQ', [{ c: 'product', q: '', a: ['답'] }], /질문: 비어/);
await rejects('FAQ', [{ c: 'xx', q: '질문', a: ['답'] }], /고를 수 없는/);
await rejects('HERO_SLIDES', [{ ...J.HERO_SLIDES[0], bg: 'red' }], /#RRGGBB/);
await rejects('HERO_SLIDES', [{ ...J.HERO_SLIDES[0], id: 9999 }], /없는 상품/);
await rejects('HERO_SLIDES', [{ ...J.HERO_SLIDES[0], img: 'https://evil.example/x.jpg' }], /사진/);
await rejects('HERO_SLIDES', [{ ...J.HERO_SLIDES[0], sub: '가'.repeat(41) }], /40자 이내/);
await rejects('TRUST', [{ icon: 'i-nope', text: '문구' }], /아이콘/);
await rejects('TRUST', [], /1개 이상/);
await rejects('REVIEWS', 'x', /형식/);
await rejects('REVIEWS', [{ id: 'a***', text: '좋아요' }], /상품을 골라/);
await rejects('PHOTOS', [{ pid: 29, src: 'https://evil.example/x.jpg' }], /사진/);
ok('빈 칸·없는 분류·색 형식·없는 상품·사이트 밖 사진·글자 수·없는 아이콘·빈 목록·상품 안 고른 구매평 거절');

// 3) 사진 올리기: 슬라이드 크기(size) 기록, 상품 없음 = 회원 혜택 배너, 띄어쓰기
const slide = (await cleanBlock('HERO_SLIDES', [{ ...J.HERO_SLIDES[0], id: '', img: { data: 'data:image/jpeg;base64,AA==', w: 900, h: 900 }, title: ['새 제목', '강조'] }], ctx))[0];
assert.equal(slide.img, 'assets/img/up/x.jpg'); assert.equal(slide.size, 900); assert.equal(slide.event, 'banner'); assert.equal(slide.id, undefined);
assert.deepEqual(slide.title, ['새 제목 ', '강조']);
const test = (await cleanBlock('TESTS', [{ ...J.TESTS[0], cert: { data: 'data:image/jpeg;base64,AA==', w: 10, h: 10 } }], ctx))[0];
assert.equal(test.cert, 'up/x.jpg');
ok('사진 올리면 경로·크기 기록(성적서는 assets/img/ 기준), 상품 없으면 이벤트 배너, 제목 앞부분 뒤 띄어쓰기');

// 4) 저장한 값이 data.js 에서 그대로 쓰인다(목록 통째, 묶음은 바뀐 칸만, 제공고시)
const faq = await cleanBlock('FAQ', [{ c: 'ship', q: '새 질문', a: '첫 문단\n둘째 문단' }], ctx);
const cs = await cleanBlock('CS', { ...J.CS, tel: '02-123-4567' }, ctx);
const J2 = jam({ blocks: { FAQ: faq, CS: cs, REVIEW_BASIS: '새 기준' }, notice: { 43: [['소재', ['면 100%']]] } });
assert.deepEqual(J2.FAQ, [{ c: 'ship', q: '새 질문', a: ['첫 문단', '둘째 문단'] }]);
assert.equal(J2.CS.tel, '02-123-4567'); assert.equal(J2.CS.telHref, 'tel:021234567'); assert.equal(J2.CS.mail, J.CS.mail);
assert.equal(J2.REVIEW_BASIS, '새 기준'); assert.deepEqual(J2.NOTICE[43], [['소재', ['면 100%']]]); assert.deepEqual(J2.NOTICE[30], J.NOTICE[30]);
assert.equal(J2.HERO_SLIDES.length, J.HERO_SLIDES.length);
assert.ok(J.REVIEWS.every(r => r.pid === 29) && J.SHORT_REVIEWS.every(r => r.pid === 29 && r.text) && J.PHOTOS.every(x => x.pid === 29 && x.src));
const J3 = jam({ blocks: { PHOTOS: ['assets/img/reviews/r01.jpg', { pid: 43, src: 'assets/img/up/a.jpg' }], SHORT_REVIEWS: ['옛 형식'] } });
assert.deepEqual(J3.PHOTOS, [{ pid: 29, src: 'assets/img/reviews/r01.jpg' }, { pid: 43, src: 'assets/img/up/a.jpg' }]); assert.deepEqual(J3.SHORT_REVIEWS, [{ pid: 29, text: '옛 형식' }]);
ok('data.js 가 고친 목록·고객센터(전화 링크 자동)·기준 문구·제공고시를 쓰고, 구매평은 상품별(예전 형식은 3단으로), 나머지는 그대로');

// 5) 팝업·상단 띠 배너: 기본은 없음, 날짜·기간·링크 검사, 사진은 선택, 저장하면 data.js 가 쓴다
assert.deepEqual([J.POPUPS, J.EVENTS], [[], []]);
assert.ok(!J.HERO_SLIDES.some(s => !s.id) && !J.FAQ.some(f => /쿠폰/.test(f.q + f.a.join(''))));
const pop = await cleanBlock('POPUPS', [{ on: true, title: '연말 이벤트', text: '첫 줄\n둘째 줄', btn: ['보러 가기', 'product-29.html'], where: 'all', start: '2026-12-01', end: '2026-12-31', img: '' }], ctx);
assert.deepEqual(pop, [{ on: true, title: '연말 이벤트', text: '첫 줄\n둘째 줄', btn: ['보러 가기', 'product-29.html'], where: 'all', start: '2026-12-01', end: '2026-12-31' }]);
const imgPop = await cleanBlock('POPUPS', [{ on: false, img: { data: 'data:image/jpeg;base64,AA==', w: 900, h: 1200 }, where: 'home' }], ctx);
assert.deepEqual(imgPop, [{ on: false, img: 'assets/img/up/x.jpg', where: 'home' }]);
await rejects('POPUPS', [{ on: true, where: 'home' }], /제목이나 사진/);
await rejects('POPUPS', [{ on: true, title: 't', where: 'home', start: '2026-12-31', end: '2026-12-01' }], /마지막 날이 시작일보다/);
await rejects('POPUPS', [{ on: true, title: 't', where: 'home', start: '12/01' }], /날짜 형식/);
await rejects('POPUPS', [{ on: true, title: 't', where: 'home', btn: ['열기', 'javascript:alert(1)'] }], /이동 주소/);
await rejects('POPUPS', [{ on: true, title: 't', where: 'pdp' }], /고를 수 없는/);
await rejects('POPUPS', Array.from({ length: 6 }, () => ({ on: true, title: 't', where: 'home' })), /최대 5개/);
const ev = await cleanBlock('EVENTS', [{ on: true, em: '무료배송', text: '전 상품 무료배송 중', link: 'https://jamschool.kr/shop.html', start: '', end: '2026-12-31' }], ctx);
assert.deepEqual(ev, [{ on: true, em: '무료배송', text: '전 상품 무료배송 중', link: 'https://jamschool.kr/shop.html', end: '2026-12-31' }]);
await rejects('EVENTS', [{ on: true, text: '문구', link: 'javascript:alert(1)' }], /이동 주소/);
await rejects('EVENTS', [{ on: true, text: '' }], /문구: 비어/);
assert.deepEqual(await cleanBlock('EVENTS', [], ctx), []);
const J4 = jam({ blocks: { POPUPS: pop, EVENTS: ev } });
assert.deepEqual([J4.POPUPS, J4.EVENTS], [pop, ev]);
ok('팝업·띠 배너: 기본 없음·쿠폰 슬라이드/FAQ 없음, 날짜·기간 순서·링크·보여 줄 곳·최대 개수 검사, 사진만 팝업, 빈 목록 저장, data.js 반영');

console.log(`\n목록 편집 시험 ${n}개 통과`);
