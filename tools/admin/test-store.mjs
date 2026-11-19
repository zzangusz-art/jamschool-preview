// 어드민 저장소(운영 GitHub 모드) 읽기 시험 — node tools/admin/test-store.mjs
//   서버에 배포된 파일을 먼저 읽고, 어드민이 저장한 파일은 다음 배포 전까지 메모리에서 돌려주는지. GitHub API 는 가짜로 대신한다
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-store-'));
const put = (p, t) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); };
put('content/blog/a.md', 'A-local'); put('content/blog/b.md', 'B-local'); put('content/site.json', '{"v":"local"}');

const calls = [];
let fail = null, patch422 = 0;   // fail: 저장(블롭 만들기) 때 GitHub 오류 흉내, patch422: 그사이 다른 커밋이 올라온 횟수
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url).replace('https://api.github.com/repos/zzangusz-art/jamschool-preview', ''), m = opt.method || 'GET';
  calls.push(`${m} ${u.split('?')[0]}`);
  const json = (o, s = 200) => ({ status: s, ok: s < 300, json: async () => o });
  if (m === 'GET' && u.startsWith('/contents/content/site.json')) return json({ content: Buffer.from('{"v":"github"}').toString('base64'), sha: 's1' });
  if (m === 'GET' && u.startsWith('/contents/')) return json({}, 404);
  if (m === 'GET' && u.startsWith('/git/ref/')) return json({ object: { sha: 'head' } });
  if (m === 'GET' && u.startsWith('/git/commits/')) return json({ tree: { sha: 'tree0' } });
  if (fail && m === 'POST' && u === '/git/blobs') return json({ message: fail.msg }, fail.status);
  if (m === 'PATCH' && patch422 > 0) { patch422--; return json({ message: 'Update is not a fast forward' }, 422); }
  if (m === 'POST' && u === '/git/blobs') return json({ sha: 'blob' + calls.length });
  if (m === 'POST' && u === '/git/trees') return json({ sha: 'tree1' });
  if (m === 'POST' && u === '/git/commits') return json({ sha: 'c1' });
  if (m === 'PATCH') return json({});
  if (m === 'GET' && u.startsWith('/commits')) return json([{ sha: 'c1', commit: { message: 'm', author: { name: 'x', date: '2026-11-18' } } }]);
  return json({}, 500);
};
process.env.GITHUB_TOKEN = 'test-token';
delete process.env.ADMIN_STORE;
const { makeStore } = await import('./store.mjs');
const s = makeStore(root);
let n = 0; const ok = name => console.log('ok', ++n, name);

assert.equal(s.kind, 'github');
assert.equal((await s.read('content/blog/a.md')).text, 'A-local');
assert.deepEqual((await s.list('content/blog')).map(x => x.name).sort(), ['a.md', 'b.md']);
assert.equal(calls.length, 0); ok('배포된 파일을 GitHub 요청 없이 읽음');

assert.equal((await s.read('content/site.json', { fresh: true })).text, '{"v":"github"}'); ok('fresh 는 GitHub 최신본');
assert.equal(await s.read('assets/js/detail-99.js'), null); ok('서버에 없는 파일은 GitHub 확인 뒤 없음');
assert.equal(await s.read('../outside.txt'), null); ok('사이트 폴더 밖은 읽지 않음');

await s.commit([{ path: 'content/blog/c.md', text: 'C-new' }, { path: 'content/blog/a.md', text: 'A-edited' }, { path: 'content/blog/b.md', delete: true }, { path: 'assets/img/blog/c.jpg', base64: 'AAAA' }], 'msg');
assert.equal((await s.read('content/blog/a.md')).text, 'A-edited');
assert.equal((await s.read('content/blog/c.md')).text, 'C-new');
assert.equal(await s.read('content/blog/b.md'), null);
assert.deepEqual((await s.list('content/blog')).map(x => x.name).sort(), ['a.md', 'c.md']);
ok('저장한 내용은 다음 배포 전에도 바로 보임(수정·새 글·삭제)');

calls.length = 0; await s.recent(8); await s.recent(8);
assert.equal(calls.filter(c => c.startsWith('GET /commits')).length, 1); ok('최근 변경 15초 캐시');

const site = [{ path: 'content/site.json', text: '{}' }];
fail = { status: 403, msg: 'Resource not accessible by personal access token' };
await assert.rejects(s.commit(site, 'opt'), e => e.status === 502 && /쓰기 권한/.test(e.message) && /Contents 를 Read and write/.test(e.message) && /jamschool-preview/.test(e.message));
ok('토큰에 쓰기 권한 없음(403) → 502 + 권한 고치는 법 안내(어드민이 로그아웃하지 않음)');
fail = { status: 401, msg: 'Bad credentials' };
await assert.rejects(s.commit(site, 'opt'), e => e.status === 502 && /만료/.test(e.message) && /GITHUB_TOKEN/.test(e.message));
ok('토큰 만료·삭제(401) → 502 + 새 토큰 안내(401 그대로 넘기면 화면이 로그아웃)');
fail = { status: 403, msg: 'API rate limit exceeded for user' };
await assert.rejects(s.commit(site, 'opt'), e => e.status === 502 && /한도/.test(e.message)); ok('요청 한도 초과 403 은 따로 안내');
fail = null; patch422 = 1; calls.length = 0;
assert.equal((await s.commit(site, 'opt')).sha, 'c1');
assert.equal(calls.filter(c => c.startsWith('PATCH')).length, 2); ok('그사이 다른 커밋(422) → 최신 위에 다시 저장');
patch422 = 3;
await assert.rejects(s.commit(site, 'opt'), e => e.status === 422); patch422 = 0; ok('세 번 겹치면 422 로 알림');

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n저장소 읽기 시험 ${n}개 통과`);
