// 상품 옵션 시험 — node tools/admin/test-options.mjs
//   data.js JAM.OPT(3단 기본값이 예전 가격표·라벨과 같은지, 다른 상품에 옵션을 넣었을 때 가격·key·품절), options.mjs cleanOpts(잘못된 값 거절), 결제 서버 lineFor
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { cleanOpts, canon, OptError } from './options.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets/js/data.js'), 'utf8');
const jam = ov => { const ctx = { window: { WEBP: new Set(), JAM_OVERRIDES: ov || {} } }; ctx.globalThis = ctx.window; vm.createContext(ctx); vm.runInContext(SRC, ctx); return ctx.window.JAM; };
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('OK', n + '.', name); };
const throws = (fn, re) => assert.throws(fn, e => e instanceof OptError && re.test(e.message), String(re));

const J = jam(), P29 = J.PRODUCTS.find(p => p.id === 29), O = J.OPTIONS_29;
await ok('3단 기본 옵션 = 예전 가격표(두께×사이즈 6개 × 색상 2) · 라벨 · 아이보리 사진 · 대표 가격', () => {
  for (const t of O.thickness) for (const s of O.size) for (const c of O.color) {
    const x = J.OPT.parse(P29, `29-${t.id}-${s.id}-${c.id}`);
    assert.equal(x.price, O.price[`${t.id}-${s.id}`]); assert.equal(x.list, O.list[`${t.id}-${s.id}`]);
    assert.equal(x.label, `${t.label} ${t.sub} / ${s.label} ${s.w}×200 / ${c.label}`);
    assert.equal(x.img, c.id === 'ivory' ? P29.imgs[8] : P29.imgs[0]);
  }
  assert.equal(P29.price, 139000); assert.equal(P29.list, 269000); assert.equal(P29.from, true);
  assert.equal(J.OPT.parse(P29, '29-12-XX-gray'), null); assert.equal(J.OPT.parse(P29, '30-12-SS-gray'), null);
  assert.ok(J.PRODUCTS.filter(p => p.id !== 29).every(p => !J.OPT.of(p) && !p.from));
});
await ok('3단 기본값을 그대로 저장하면 덮어쓰기 없음(canon 같음)', () => {
  const c = cleanOpts(JSON.parse(JSON.stringify(P29.opts)), P29);
  assert.equal(canon(c), canon(jam().PRODUCTS.find(p => p.id === 29).opts));
});
const p30 = J.PRODUCTS.find(p => p.id === 30);
const opts30 = {
  groups: [
    { id: 's', name: '사이즈', note: '', price: true, values: [{ id: 'MS', label: '멀티싱글', sub: '75 × 200' }, { id: 'SS', label: '슈퍼싱글', sub: '110 × 200' }, { id: 'Q', label: '퀸', sub: '150 × 200', off: true }] },
    { id: 'c', name: '색상', price: false, values: [{ id: 'gray', label: '그레이', hex: '#7d8187' }, { id: 'pink', label: '핑크', hex: '#F2C6CF', img: 2 }] },
  ],
  prices: { MS: { price: 64000, list: 105000 }, SS: { price: 79000, list: '' }, Q: { price: 99000, list: 150000 } },
};
await ok('다른 상품(떡실신)에 사이즈·색상 옵션: 정리·대표 가격·~부터·품절·사진·key', () => {
  const c = cleanOpts(opts30, p30);
  assert.equal(c.groups[1].values[0].hex, '#7D8187'); assert.deepEqual(c.prices.SS, { price: 79000, list: 79000 });
  const K = jam({ opts: { 30: c } }), p = K.PRODUCTS.find(x => x.id === 30);
  assert.equal(p.price, 64000); assert.equal(p.list, 105000); assert.equal(p.from, true);
  const x = K.OPT.parse(p, '30-SS-pink');
  assert.deepEqual([x.price, x.list, x.label, x.img, x.off], [79000, 79000, '슈퍼싱글 110×200 / 핑크', p.imgs[2], false]);
  assert.equal(K.OPT.parse(p, '30-Q-gray').off, true);
  assert.equal(JSON.stringify(K.OPT.range(p, [null, null])), JSON.stringify({ lo: 64000, hi: 79000 }));
  assert.equal(K.OPT.names(p.opts), '사이즈와 색상을');
  // 옵션 없음(null) 저장: 3단도 수량만
  const L = jam({ opts: { 29: null } }); assert.equal(L.OPT.of(L.PRODUCTS.find(x => x.id === 29)), null);
});
await ok('가격 묶음이 없으면 기본 판매가 하나(조합만 고름)', () => {
  const c = cleanOpts({ groups: [{ id: 'c', name: '색상', values: [{ id: 'a', label: '그레이' }, { id: 'b', label: '아이보리' }] }] }, p30);
  assert.deepEqual(c.prices, {});
  const K = jam({ opts: { 30: c } }), p = K.PRODUCTS.find(x => x.id === 30);
  assert.equal(K.OPT.parse(p, '30-b').price, p.price); assert.equal(p.from, false);
});
await ok('잘못된 값 거절(이름·겹침·가격·정가·사진·개수·번호)', () => {
  const g = (o = {}) => ({ id: 's', name: '사이즈', price: true, values: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], ...o });
  const pr = { a: { price: 1000 }, b: { price: 2000 } };
  throws(() => cleanOpts({ groups: [g({ name: ' ' })], prices: pr }, p30), /이름/);
  throws(() => cleanOpts({ groups: [g(), g({ id: 't' })], prices: pr }, p30), /겹칩니다/);
  throws(() => cleanOpts({ groups: [g({ values: [{ id: 'a', label: 'A' }, { id: 'b', label: 'A' }] })], prices: pr }, p30), /같은 이름/);
  throws(() => cleanOpts({ groups: [g()], prices: { a: { price: 1000 } } }, p30), /판매가/);
  throws(() => cleanOpts({ groups: [g()], prices: { a: { price: 1000, list: 500 }, b: { price: 2000 } } }, p30), /정가/);
  throws(() => cleanOpts({ groups: [g({ values: [{ id: 'a', label: 'A', img: 99 }] })], prices: { a: { price: 1000 } } }, p30), /사진/);
  throws(() => cleanOpts({ groups: [g({ values: [{ id: 'a-b', label: 'A' }] })], prices: {} }, p30), /번호/);
  throws(() => cleanOpts({ groups: [1, 2, 3, 4, 5].map(i => g({ id: 'g' + i, name: '묶음' + i, price: false })) }, p30), /4개/);
  throws(() => cleanOpts({ groups: [g({ values: [{ id: 'a', label: 'A', hex: 'red' }] })], prices: { a: { price: 1000 } } }, p30), /색/);
  assert.equal(cleanOpts({ groups: [] }, p30), null);
  // 꺾쇠는 지운다
  assert.equal(cleanOpts({ groups: [g({ price: false, name: '<b>사이즈</b>' })] }, p30).groups[0].name, 'b사이즈/b');
});
await ok('결제 서버 lineFor: 옵션 상품은 조합 key 만, 품절·없는 조합·옵션 없이 담은 줄 거절', async () => {
  const PAY = await import('../pay/seedpay.mjs');
  const K = jam({ opts: { 30: cleanOpts(opts30, p30) } });
  const line = PAY._test.lineFor;
  assert.equal(line(K, '30-SS-gray', 2).price, 79000);
  assert.equal(line(K, '30-SS-gray', 2).opt, '슈퍼싱글 110×200 / 그레이');
  assert.throws(() => line(K, '30-Q-gray', 1), /품절/);
  assert.throws(() => line(K, '30-XL-gray', 1), /옵션/);
  assert.throws(() => line(K, '30', 1), /상품/);
  assert.equal(line(K, '36', 1).price, K.PRODUCTS.find(p => p.id === 36).price);
  assert.equal(line(K, '29-7-MS-ivory', 1).price, 139000);
});
console.log(`\n상품 옵션 시험 ${n}개 통과`);
