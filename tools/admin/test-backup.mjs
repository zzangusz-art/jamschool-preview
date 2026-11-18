// 데이터 옮기기(backup.mjs) 시험 — node tools/admin/test-backup.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as B from './backup.mjs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', n, name); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jam-data-'));
const put = (root, p, text) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), text); };

// 옛 서버 볼륨
const A = tmp();
process.env.DATA_DIR = A;
B.ensureMarker();
put(A, 'admin-users.json', '[{"id":"old","hash":"x"}]');
put(A, 'orders/JS20261117000000ABCDEF.json', '{"moid":"JS20261117000000ABCDEF","status":"paid"}');
put(A, 'orders/settings.json', '{"enabled":true}');
put(A, 'analytics/2026-11-17.json', '{"date":"2026-11-17","pv":12}');
put(A, 'analytics/2026-11-18.json.tmp', 'tmp');
put(A, '_before-import/20261101000000/admin-users.json', 'old-backup');

let bundle;
ok('내보내기: 표식·보관본·임시 파일 제외, 나머지 전부', () => {
  bundle = B.exportBundle('old.example');
  const paths = bundle.files.map(f => f.path).sort();
  assert.deepEqual(paths, ['admin-users.json', 'analytics/2026-11-17.json', 'orders/JS20261117000000ABCDEF.json', 'orders/settings.json']);
  assert.equal(bundle.format, 'jamschool-data');
  assert.deepEqual(bundle.counts, { users: 1, settings: 1, orders: 1, analytics: 1, other: 0 });
});
ok('상태: 개수·변수 이름만(값 없음)', () => {
  process.env.SEEDPAY_MERCHANT_KEY = 'secret-value-should-not-appear';
  const v = B.volumeInfo('old.example');
  assert.equal(v.files, 4); assert.ok(v.volumeCreated);
  assert.ok(!JSON.stringify(v).includes('secret-value-should-not-appear'));
  assert.equal(v.env.find(e => e.name === 'SEEDPAY_MERCHANT_KEY').set, true);
  delete process.env.SEEDPAY_MERCHANT_KEY;
});

// 새 서버 볼륨(ADMIN_USERS 로 만든 계정 파일이 이미 있음)
const N = tmp();
process.env.DATA_DIR = N;
B.ensureMarker();
const mark = fs.readFileSync(path.join(N, '.volume-created'), 'utf8');
put(N, 'admin-users.json', '[{"id":"new","hash":"y"}]');
put(N, 'analytics/2026-11-18.json', '{"date":"2026-11-18","pv":1}');

ok('가져오기: 파일 그대로, 덮어쓴 원본은 보관, 다른 파일·표식 유지', () => {
  let flushed = 0;
  const r = B.importBundle(JSON.parse(JSON.stringify(bundle)), { before: () => flushed++ });
  assert.equal(flushed, 1); assert.equal(r.written, 4); assert.equal(r.replaced, 1);
  for (const f of bundle.files) assert.equal(fs.readFileSync(path.join(N, f.path), 'utf8'), fs.readFileSync(path.join(A, f.path), 'utf8'));
  assert.equal(fs.readFileSync(path.join(N, r.keptIn, 'admin-users.json'), 'utf8'), '[{"id":"new","hash":"y"}]');
  assert.equal(fs.readFileSync(path.join(N, 'analytics/2026-11-18.json'), 'utf8'), '{"date":"2026-11-18","pv":1}');
  assert.equal(fs.readFileSync(path.join(N, '.volume-created'), 'utf8'), mark);
});
ok('다시 내보내면 보관본은 빠짐', () => {
  const again = B.exportBundle('new.example').files.map(f => f.path);
  assert.ok(!again.some(p => p.startsWith('_before-import')));
  assert.equal(again.length, 5);
});

const bad = files => () => B.importBundle({ format: 'jamschool-data', files });
const throws400 = fn => { try { fn(); } catch (e) { assert.equal(e.status, 400); return; } assert.fail('거절되지 않음'); };
ok('경로 위조 거절(위로·절대·역슬래시·보관 폴더·표식)', () => {
  const b64 = Buffer.from('x').toString('base64');
  for (const p of ['../evil.json', 'orders/../../evil', '/etc/passwd', 'C:\\x', 'orders\\..\\x', '_before-import/x', '.volume-created', 'a/.. ', '']) throws400(bad([{ path: p, base64: b64 }]));
  assert.ok(!fs.existsSync(path.join(N, '..', 'evil.json')));
});
ok('형식이 다른 파일 거절', () => { throws400(() => B.importBundle({ files: [] })); throws400(() => B.importBundle(null)); });
ok('볼륨 없으면 안내와 함께 거절', () => {
  delete process.env.DATA_DIR;
  throws400(() => B.exportBundle('x')); throws400(() => B.importBundle(bundle));
  assert.equal(B.volumeInfo('x').files, 0);
});

fs.rmSync(A, { recursive: true, force: true }); fs.rmSync(N, { recursive: true, force: true });
console.log(`\n데이터 옮기기 시험 ${n}개 통과`);
