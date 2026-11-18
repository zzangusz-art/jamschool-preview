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
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url).replace('https://api.github.com/repos/zzangusz-art/jamschool-preview', ''), m = opt.method || 'GET';
  calls.push(`${m} ${u.split('?')[0]}`);
  const json = (o, s = 200) => ({ status: s, ok: s < 300, json: async () => o });
  if (m === 'GET' && u.startsWith('/contents/content/site.json')) return json({ content: Buffer.from('{"v":"github"}').toString('base64'), sha: 's1' });
  if (m === 'GET' && u.startsWith('/contents/')) return json({}, 404);
  if (m === 'GET' && u.startsWith('/git/ref/')) return json({ object: { sha: 'head' } });
  if (m === 'GET' && u.startsWith('/git/commits/')) return json({ tree: { sha: 'tree0' } });
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

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n저장소 읽기 시험 ${n}개 통과`);
