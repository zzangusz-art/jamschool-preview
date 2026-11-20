// 방문 집계 시험 — node tools/admin/test-stats.mjs
//   직접 방문(이전 주소·utm 없음)을 링크 표시·앱 안 브라우저·브라우저 출처 정보로 나누고, 처음 연 페이지를 센다. 검색·사이트 안 이동은 직접 방문에 안 들어감
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-stats-'));
delete process.env.DATA_DIR; process.env.STATS_DIR = TMP;
const { countPage, summary, directHow } = await import('./stats.mjs');
let n = 0; const ok = s => console.log('ok', ++n, s);
const UA = {
  pc: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  kakao: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.9.0',
  naverApp: 'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.10.3)',
  insta: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0',
  webview: 'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0 Mobile Safari/537.36',
};
let ip = 1;
const req = (url, ua, h = {}) => ({ url, headers: { 'user-agent': ua, ...h }, socket: { remoteAddress: `10.0.0.${ip++}` } });
const hit = (url, ua, h, p) => countPage(req(url, ua, h), p || url.split('?')[0], 'jamschool.kr');
try {
  // 1) 나누기 규칙
  const D = (url, ua, h = {}) => directHow(req(url, ua, h), ua, url.split('?')[0].replace(/\.html$/, ''));
  assert.match(D('/order-complete.html?o=JS1&t=a', UA.iphone), /주문 조회 링크/);
  assert.match(D('/product-29.html?write=1&o=JS1&t=a', UA.kakao), /구매평 쓰기 링크/);   // 링크 표시가 앱보다 먼저
  assert.match(D('/?gclid=x', UA.pc), /구글 광고/); assert.match(D('/?fbclid=x', UA.insta), /인스타·페이스북 링크/); assert.match(D('/?NaPm=ct%3Dx', UA.iphone), /네이버 광고·쇼핑/);
  assert.match(D('/', UA.kakao), /카카오톡/); assert.match(D('/', UA.naverApp), /네이버 앱/); assert.match(D('/', UA.insta), /인스타그램 앱/); assert.match(D('/', UA.webview), /그 밖의 앱/);
  assert.match(D('/', UA.pc, { 'sec-fetch-site': 'none' }), /^PC 주소 입력/); assert.match(D('/', UA.iphone, { 'sec-fetch-site': 'none' }), /^휴대폰 주소 입력/);
  assert.match(D('/', UA.pc, { 'sec-fetch-site': 'cross-site' }), /출처를 숨긴/); assert.match(D('/', UA.pc), /알 수 없음/);
  ok('나누기: 주문 조회·구매평 쓰기 주소, 구글·메타·네이버 클릭 표시, 카카오톡·네이버·인스타·그 밖의 앱, 주소 입력(PC·휴대폰)·주소 숨김·알 수 없음');

  // 2) 집계: 직접 방문만 자세히, 검색·사이트 안 이동·봇은 빼고, 처음 연 페이지
  hit('/', UA.kakao); hit('/product-29.html', UA.kakao); hit('/', UA.pc, { 'sec-fetch-site': 'none' });
  hit('/order-complete.html?o=JS1&t=a', UA.iphone, { 'sec-fetch-site': 'none' });
  hit('/product-30.html', UA.iphone, { referer: 'https://m.search.naver.com/search.naver?query=x' });   // 네이버 검색
  hit('/shop.html', UA.pc, { referer: 'https://jamschool.kr/' });                                        // 사이트 안 이동
  hit('/', 'Mozilla/5.0 (compatible; Googlebot/2.1)');                                                   // 봇
  hit('/?utm_source=kakao_channel', UA.kakao);                                                            // 꼬리표 → 캠페인
  const t = summary(1).total;
  assert.equal(t.sources['직접 방문'], 4); assert.equal(t.sources['네이버 검색'], 1); assert.equal(t.sources['캠페인(kakao_channel)'], 1);
  assert.equal(Object.values(t.direct.how).reduce((a, b) => a + b, 0), 4);
  assert.equal(t.direct.how['카카오톡 안 브라우저'], 2); assert.equal(t.direct.how['주문 조회 링크(문자·결제 화면)'], 1);
  assert.deepEqual(t.direct.land, { '/': 2, '/product-29': 1, '/order-complete': 1 });
  assert.ok(summary(1).days[0].direct && summary(1).directFrom);
  ok('집계: 직접 방문 4번만 자세히(카카오톡 2·주소 입력 1·주문 조회 1), 처음 연 페이지, 검색·사이트 안 이동·봇·꼬리표 붙은 링크는 직접 방문 아님');
} finally { fs.rmSync(TMP, { recursive: true, force: true }); }
console.log(`\n방문 집계 시험 ${n}개 통과`);
process.exit(0);
