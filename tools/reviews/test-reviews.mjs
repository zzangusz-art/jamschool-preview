// 구매평 모아 보기 시험 — node tools/reviews/test-reviews.mjs
//   저장된 데이터(content/reviews)에 개인정보·주문번호가 없는지, 요약과 개수가 맞는지, API 거르기·정렬·찾기·쪽 나누기가 맞는지
//   한 목록(잠스쿨이 고른 BEST → 홈페이지 손님 → 스마트스토어, 겹치는 글 한 번만), 숨긴 스마트스토어 글, 손님 구매평 쓰기(구매 확인·승인 대기·사진)
//   시험은 임시 폴더(구매평 복사본·DATA_DIR)에서 돌린다 — 실제 데이터는 건드리지 않는다
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, one, handleReviews, connect } from './api.mjs';
import * as SITE from './site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), SRC = path.join(ROOT, 'content', 'reviews');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-rv-')), DIR = path.join(TMP, 'reviews-src');
fs.cpSync(SRC, DIR, { recursive: true }); fs.rmSync(path.join(DIR, 'hidden.json'), { force: true });
process.env.REVIEWS_DIR = DIR; process.env.DATA_DIR = path.join(TMP, 'data');
let n = 0; const ok = s => console.log('ok', ++n, s);
const S = JSON.parse(fs.readFileSync(path.join(DIR, 'summary.json'), 'utf8')), T = JSON.parse(fs.readFileSync(path.join(DIR, 'topics.json'), 'utf8'));
global.window = {}; await import(pathToUrl(path.join(ROOT, 'assets/js/data.js')));
function pathToUrl(p) { return 'file:///' + p.replace(/\\/g, '/'); }
const ids = window.JAM.PRODUCTS.map(p => String(p.id));
const ssOf = pid => JSON.parse(fs.readFileSync(path.join(DIR, `${pid}.json`), 'utf8'));
const norm = t => String(t || '').replace(/\s+/g, '').slice(0, 60);
const PICKS = pid => window.JAM.REVIEWS.filter(r => +r.pid === pid && r.text);
const expTotal = pid => { const p = PICKS(pid), seen = new Set(p.map(r => norm(r.text))); return p.length + ssOf(pid).filter(x => !seen.has(norm(x.t))).length; };

try {
  // 1) 데이터: 홈페이지 상품만, 칸은 정해진 것만, 전화·메일·주소 없음, 사진은 네이버 경로
  const KEYS = new Set(['n', 'i', 'd', 's', 't', 'p', 'm', 'b', 'h', 'r', 'k']);
  let all = 0;
  for (const pid of Object.keys(S.products)) {
    assert.ok(ids.includes(pid), `홈페이지에 없는 상품 ${pid}`);
    const list = ssOf(pid);
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
  const Q = (s, o) => query(new URLSearchParams(s), o);
  const a = Q('pid=30&f=photo&k=soft&n=5&page=3');
  assert.equal(a.status, 200); assert.equal(a.body.items.length, 5); assert.ok(a.body.items.every(x => x.p && x.k.includes('soft')));
  assert.equal(a.body.total, ssOf(30).filter(x => x.p && (x.k || []).includes('soft')).length);
  const nw = Q('pid=29&sort=new&n=30').body.items.map(x => x.d); assert.deepEqual(nw, [...nw].sort().reverse());
  const qq = Q('pid=29&q=%ED%80%B8'); assert.ok(qq.body.total > 0 && qq.body.items.every(x => x.t.includes('퀸')));
  assert.equal(Q('pid=29&n=999').body.n, 30); assert.equal(Q('pid=29&page=-3').body.page, 1);
  assert.equal(Q('pid=999').status, 404); assert.equal(Q('pid=36&k=cool').status, 400); assert.equal(Q('pid=36&f=zzz').body.total, expTotal(36));
  const last = Q(`pid=41&n=5&page=2`); assert.equal(last.body.items.length, expTotal(41) - 5);
  ok('API: 포토·주제 함께 거르기(개수 일치)·최신순·찾기·최대 30개·잘못된 쪽·없는 상품 404·그 상품에 없는 주제 400·마지막 쪽');

  // 3) 한 목록: 잠스쿨이 고른 BEST 가 맨 앞(어드민 순서 그대로), 스마트스토어에 같은 글이 있으면 한 번만
  const P29 = PICKS(29), m = Q('pid=29&n=30').body;
  assert.ok(P29.length > 0, '3단 BEST 구매평이 있어야 시험이 뜻이 있다');
  assert.deepEqual(m.items.slice(0, P29.length).map(x => x.t), P29.map(r => r.text));
  assert.ok(m.items.slice(0, P29.length).every(x => x.pk && x.b && x.s === 5));
  assert.equal(m.total, expTotal(29));
  assert.ok(m.total < P29.length + ssOf(29).length, '스마트스토어와 겹친 BEST 글은 한 번만');
  assert.equal(Q('pid=29&f=best').body.total, P29.length + ssOf(29).filter(x => x.b && !P29.some(r => norm(r.text) === norm(x.t))).length);
  assert.equal(one(29, `B29-1`).t, P29[0].text);
  ok(`3단 구매평 하나로: BEST ${P29.length}개 맨 앞 → 스마트스토어 ${ssOf(29).length.toLocaleString('ko-KR')}건, 겹친 글 빼고 ${m.total.toLocaleString('ko-KR')}건`);

  // 4) 정렬: 별점순(5 → 4)·포토리뷰순(사진 있는 글 먼저)·최신순(날짜 없는 BEST 는 뒤)
  const pages = Q('pid=29&n=30').body.pages;
  const st1 = Q('pid=29&sort=star&n=30').body.items, stL = Q(`pid=29&sort=star&n=30&page=${pages}`).body.items;
  assert.ok(st1.every(x => x.s === 5) && stL.every(x => x.s === 4));
  const ph1 = Q('pid=29&sort=photo&n=30').body.items, phL = Q(`pid=29&sort=photo&n=30&page=${pages}`).body.items;
  assert.ok(ph1.every(x => x.p) && phL.every(x => !x.p));
  const nwL = Q(`pid=29&sort=new&n=30&page=${pages}`).body.items; assert.ok(nwL.slice(-P29.length).every(x => x.pk));
  ok('정렬: 별점순·포토리뷰순·최신순(첫 쪽·마지막 쪽)');

  // 5) 숨긴 스마트스토어 글: 손님 화면에서 빠지고, 어드민은 '숨긴 글'로 본다
  const target = m.items.find(x => typeof x.n === 'number');
  const before = Q('pid=29').body.total;
  fs.writeFileSync(path.join(DIR, 'hidden.json'), JSON.stringify([String(target.n)]));
  assert.equal(Q('pid=29').body.total, before - 1);
  assert.ok(!Q('pid=29&n=30').body.items.some(x => x.n === target.n));
  const hv = Q('pid=29&vis=hidden', { admin: true }).body; assert.equal(hv.total, 1); assert.equal(hv.items[0].n, target.n); assert.equal(hv.items[0].hid, true);
  assert.equal(Q('pid=29&vis=all', { admin: true }).body.total, before);
  fs.writeFileSync(path.join(DIR, 'hidden.json'), '[]');
  assert.equal(Q('pid=29').body.total, before);
  ok('숨기기: 손님 목록·개수에서 빠짐, 어드민 숨긴 글 1건, 되돌리면 그대로');

  // 6) 손님 구매평(모듈): 홈페이지 구매 = 바로 게시·주문 상품마다 한 번, 다른 곳 구매 = 승인 대기, 이름 가림, 사진 JPEG 만
  const JPG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString('base64');
  const ORD = { moid: 'JS20261119000000TEST01', token: 'tok1', buyerName: '홍길동', items: [{ id: 29, name: '3단 접이식 매트리스', opt: '퀸 · 12cm' }], can: true };
  const T10 = '두께도 딱 좋고 배송도 빨랐어요. 허리가 편해요';
  const r1 = SITE.add({ pid: 29, stars: 5, text: T10, photos: [JPG] }, ORD);
  assert.equal(r1.status, 'shown'); assert.equal(r1.name, '홍*동'); assert.equal(r1.opt, '퀸 · 12cm'); assert.equal(r1.verified, true);
  assert.ok(SITE.imgFile(r1.photos[0])); assert.equal(SITE.imgFile('../site.json'), null); assert.equal(SITE.imgFile('R1-1.jpg'), null);
  assert.throws(() => SITE.add({ pid: 29, stars: 5, text: T10 }, ORD), /이미/);
  assert.throws(() => SITE.add({ pid: 30, stars: 5, text: T10 }, ORD), /없는 상품/);
  const r2 = SITE.add({ pid: 29, stars: 4, text: '스마트스토어에서 샀는데 쿠션감이 좋아요', src: 'smartstore', name: '김민수' }, null);
  assert.equal(r2.status, 'pending'); assert.equal(r2.name, '김*수'); assert.equal(r2.verified, false);
  const bad = (d, re) => assert.throws(() => SITE.add({ pid: 29, stars: 5, text: T10, src: 'mall', name: '테스터', ...d }, null), re);
  bad({ text: '짧아요' }, /10자/); bad({ stars: 0 }, /별점/); bad({ src: 'site' }, /어디서/); bad({ name: 'a' }, /2자/);
  bad({ photos: ['data:image/png;base64,AAAA'] }, /JPG/); bad({ photos: ['data:image/jpeg;base64,' + Buffer.from('not a jpeg').toString('base64')] }, /형식/);
  assert.deepEqual(SITE.publicItems(29).map(x => x.n), [r1.id], '승인 대기 글은 손님 화면에 없다');
  const c1 = Q('pid=29&f=site').body; assert.equal(c1.total, 1); assert.equal(c1.site, 1); assert.equal(c1.items[0].v, 1); assert.equal(c1.items[0].o, '퀸 · 12cm');
  assert.ok(c1.items[0].ps[0].startsWith('/api/reviews/img/'));
  SITE.update(r2.id, { status: 'shown', reply: '고맙습니다!' }, { id: 'tester', name: '시험' });
  const c2 = Q('pid=29&f=site').body; assert.equal(c2.total, 2);
  const x2 = c2.items.find(x => x.n === r2.id); assert.equal(x2.src, '네이버 스마트스토어'); assert.equal(x2.rp, '고맙습니다!'); assert.equal(x2.v, undefined);
  const rr = Q('pid=29&n=30').body.items; assert.ok(rr.slice(0, P29.length).every(x => x.pk)); assert.ok(rr.slice(P29.length, P29.length + 2).every(x => x.w));
  assert.ok(Q('pid=29&sort=new&n=2').body.items.every(x => x.w), '최신순 맨 앞은 오늘 쓴 손님 구매평');
  SITE.update(r2.id, { status: 'hidden' }, { id: 'tester' }); assert.equal(Q('pid=29&f=site').body.total, 1);
  assert.deepEqual(SITE.counts(), { shown: 1, pending: 0, hidden: 1 });
  ok('손님 구매평: 구매 확인 = 바로 게시·한 번만·이름 가림·옵션, 다른 곳 = 승인 대기, 잘못된 값 6가지, 게시·답글·숨김이 목록에 바로 반영');

  // 7) HTTP: 구매 확인(주문번호+휴대폰 / 조회 주소) → 쓰기 → 목록·사진, 보내기 전 주문은 아직, 관리자 알림
  const notified = [];
  const orders = {
    JS20261119000000TEST02: { moid: 'JS20261119000000TEST02', token: 'tok2', tel: '01012345678', buyerName: '이영희', items: [{ id: 30, name: '토퍼', opt: '' }], can: true },
    JS20261119000000TEST03: { moid: 'JS20261119000000TEST03', token: 'tok3', tel: '01099998888', buyerName: '박철수', items: [{ id: 30, name: '토퍼', opt: '' }], can: false },
  };
  connect({ reviewOrder: ({ o, t, no, tel }) => { const x = orders[o || no]; return x && (o ? x.token === t : x.tel === tel) ? x : null; }, notifyReview: r => notified.push(r) });
  const srv = http.createServer(async (req, res) => { if (!(await handleReviews(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  try {
    const v1 = await post('/api/reviews/verify', { no: 'JS20261119000000TEST02', tel: '01012345678' });
    assert.equal(v1.status, 200); assert.equal(v1.body.o, 'JS20261119000000TEST02'); assert.equal(v1.body.t, 'tok2'); assert.equal(v1.body.can, true);
    assert.deepEqual(v1.body.items, [{ pid: 30, name: '토퍼', opt: '', done: false }]);
    assert.equal((await post('/api/reviews/verify', { no: 'JS20261119000000TEST02', tel: '01000000000' })).status, 404);
    const w1 = await post('/api/reviews/write', { o: v1.body.o, t: v1.body.t, pid: 30, stars: 5, text: '포근하고 냄새도 없어요. 아이 방에 깔았어요', photos: [JPG, JPG] });
    assert.equal(w1.status, 200); assert.equal(w1.body.status, 'shown'); assert.equal(notified.length, 1); assert.equal(notified[0].pid, 30);
    assert.equal((await post('/api/reviews/write', { o: v1.body.o, t: v1.body.t, pid: 30, stars: 5, text: '두 번째로 쓰는 구매평입니다' })).status, 400);
    assert.equal((await post('/api/reviews/verify', { o: 'JS20261119000000TEST02', t: 'tok2' })).body.items[0].done, true);
    assert.equal((await post('/api/reviews/write', { o: v1.body.o, t: 'wrong', pid: 30, stars: 5, text: T10 })).status, 404);
    const w3 = await post('/api/reviews/write', { o: 'JS20261119000000TEST03', t: 'tok3', pid: 30, stars: 5, text: T10 });
    assert.equal(w3.status, 400); assert.match(w3.body.error, /보낸 뒤/);
    const w4 = await post('/api/reviews/write', { src: 'mall', name: '정다운', pid: 30, stars: 4, text: '공식몰에서 샀어요. 폭신해요' });
    assert.equal(w4.status, 200); assert.equal(w4.body.status, 'pending');
    const L = await (await fetch(`${base}/api/reviews?pid=30&f=site`)).json();
    assert.equal(L.total, 1); assert.equal(L.site, 1); assert.equal(L.items[0].ps.length, 2); assert.equal(L.items[0].i, '이*희');
    const img = await fetch(base + L.items[0].ps[0]); assert.equal(img.status, 200); assert.match(img.headers.get('content-type'), /image\/jpeg/);
    assert.equal((await fetch(`${base}/api/reviews/img/..%2F..%2Fsite.json`)).status, 404);
    assert.equal((await fetch(`${base}/api/reviews/write`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  } finally { srv.close(); }
  ok('HTTP: 주문번호+휴대폰 확인·조회 주소 확인·쓰기(사진 2장)·두 번 못 씀·틀린 키 404·보내기 전 400·다른 곳 승인 대기·목록·사진·경로 막기·관리자 알림');
} finally { fs.rmSync(TMP, { recursive: true, force: true }); }

console.log(`\n구매평 시험 ${n}개 통과`);
