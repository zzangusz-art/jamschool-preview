// 구매평 모아 보기 시험 — node tools/reviews/test-reviews.mjs
//   저장된 데이터(content/reviews)에 개인정보·주문번호가 없는지, 요약과 개수가 맞는지, API 거르기·정렬·찾기·쪽 나누기가 맞는지
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), DIR = path.join(ROOT, 'content', 'reviews');
let n = 0; const ok = s => console.log('ok', ++n, s);
const S = JSON.parse(fs.readFileSync(path.join(DIR, 'summary.json'), 'utf8')), T = JSON.parse(fs.readFileSync(path.join(DIR, 'topics.json'), 'utf8'));
global.window = {}; await import(pathToUrl(path.join(ROOT, 'assets/js/data.js')));
function pathToUrl(p) { return 'file:///' + p.replace(/\\/g, '/'); }
const ids = window.JAM.PRODUCTS.map(p => String(p.id));

// 1) 데이터: 홈페이지 상품만, 칸은 정해진 것만, 전화·메일·주소 없음, 사진은 네이버 경로
const KEYS = new Set(['n', 'i', 'd', 's', 't', 'p', 'm', 'b', 'h', 'r', 'k']);
let all = 0;
for (const pid of Object.keys(S.products)) {
  assert.ok(ids.includes(pid), `홈페이지에 없는 상품 ${pid}`);
  const list = JSON.parse(fs.readFileSync(path.join(DIR, `${pid}.json`), 'utf8'));
  assert.equal(list.length, S.products[pid].total);
  for (const x of list) {
    for (const k of Object.keys(x)) assert.ok(KEYS.has(k), `모르는 칸 ${k}`);
    assert.match(x.d, /^20\d\d-\d\d-\d\d$/); assert.ok(x.s === 4 || x.s === 5); assert.ok(x.t.length > 0);
    assert.ok(!/01[016789][-. ]?\d{3,4}[-. ]?\d{4}/.test(x.t + (x.r || '')), '전화번호'); assert.ok(!/[\w.]+@[\w.]+\.[a-z]{2,}/i.test(x.t), '메일');
    if (x.p) assert.ok(!/^https?:/.test(x.p) || /^https:\/\/[^/]*pstatic\.net\//.test(x.p), x.p);
    if (x.k) { const set = T.sets[T.products[pid]]; assert.ok(x.k.every(k => set.includes(k)), `${pid} 주제 ${x.k}`); }
  }
  const P = S.products[pid];
  assert.equal(P.photo, list.filter(x => x.p).length); assert.equal(P.month, list.filter(x => x.m).length);
  for (const [k, c] of P.topics) assert.equal(c, list.filter(x => (x.k || []).includes(k)).length, `${pid} ${k}`);
  all += list.length;
}
ok(`데이터 ${Object.keys(S.products).length}개 상품 ${all.toLocaleString('ko-KR')}건: 홈페이지 상품만·정해진 칸만·전화·메일 없음·요약 개수 일치`);

// 2) API: 종류·주제·정렬·찾기·쪽 나누기, 잘못된 값
const Q = s => query(new URLSearchParams(s));
const a = Q('pid=30&f=photo&k=soft&n=5&page=3');
assert.equal(a.status, 200); assert.equal(a.body.items.length, 5); assert.ok(a.body.items.every(x => x.p && x.k.includes('soft')));
assert.equal(a.body.total, JSON.parse(fs.readFileSync(path.join(DIR, '30.json'), 'utf8')).filter(x => x.p && (x.k || []).includes('soft')).length);
const nw = Q('pid=29&sort=new&n=30').body.items.map(x => x.d); assert.deepEqual(nw, [...nw].sort().reverse());
const rec = Q('pid=29&n=3').body.items; assert.ok(rec[0].b || rec[0].p, '추천순 첫 글은 BEST·포토');
const qq = Q('pid=29&q=%ED%80%B8'); assert.ok(qq.body.total > 0 && qq.body.items.every(x => x.t.includes('퀸')));
assert.equal(Q('pid=29&n=999').body.n, 30); assert.equal(Q('pid=29&page=-3').body.page, 1);
assert.equal(Q('pid=999').status, 404); assert.equal(Q('pid=36&k=cool').status, 400); assert.equal(Q('pid=36&f=zzz').body.total, S.products['36'].total);
const last = Q(`pid=41&n=5&page=2`); assert.equal(last.body.items.length, S.products['41'].total - 5);
ok('API: 포토·주제 함께 거르기(개수 일치)·최신순·추천순·찾기·최대 30개·잘못된 쪽·없는 상품 404·그 상품에 없는 주제 400·마지막 쪽');

console.log(`\n구매평 시험 ${n}개 통과`);
