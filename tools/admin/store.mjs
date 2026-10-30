// 어드민 저장소 — 고친 내용을 어디에 저장하나
//   GitHub(운영): GITHUB_TOKEN(이 저장소 Contents 읽기·쓰기만 허용한 fine-grained 토큰), GITHUB_REPO(기본 zzangusz-art/jamschool-preview), GITHUB_BRANCH(기본 main)
//     저장 = 커밋 1개(여러 파일을 한 번에) → Railway·GitHub Pages 가 자동으로 다시 배포(약 2분)
//   로컬(시험·PC 작업): ADMIN_STORE=local → 이 폴더 파일을 직접 고치고 빌드(npm run build). 커밋은 deploy.bat 이 나중에
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function makeStore(root) {
  // 로컬 시험: ADMIN_LOCAL_ROOT(저장할 폴더, 기본 이 사이트 폴더), ADMIN_LOCAL_NOBUILD=1 이면 저장 뒤 빌드 안 함
  return process.env.ADMIN_STORE === 'local' ? localStore(process.env.ADMIN_LOCAL_ROOT || root) : githubStore();
}

function githubStore() {
  const REPO = process.env.GITHUB_REPO || 'zzangusz-art/jamschool-preview', BRANCH = process.env.GITHUB_BRANCH || 'main';
  const token = () => process.env.GITHUB_TOKEN || '';
  async function gh(method, url, body) {
    const res = await fetch(`https://api.github.com/repos/${REPO}${url}`, { method,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'jamschool-admin', ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    if (res.status === 404) return null;
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(`GitHub ${res.status}: ${j.message || ''}`); e.status = res.status; throw e; }
    return j;
  }
  const enc = p => p.split('/').map(encodeURIComponent).join('/');
  return {
    kind: 'github', ready: () => !!token(),
    async read(p) {
      const j = await gh('GET', `/contents/${enc(p)}?ref=${BRANCH}`);
      if (!j || Array.isArray(j)) return null;
      let b64 = j.content;
      if (!b64 && j.sha) b64 = (await gh('GET', `/git/blobs/${j.sha}`)).content;   // 1MB 넘는 파일
      return { text: Buffer.from(b64 || '', 'base64').toString('utf8'), sha: j.sha };
    },
    async list(dir) {
      const j = await gh('GET', `/contents/${enc(dir)}?ref=${BRANCH}`);
      return Array.isArray(j) ? j.map(x => ({ name: x.name, path: x.path, type: x.type, size: x.size })) : [];
    },
    // files: [{ path, text } | { path, base64 } | { path, delete: true }]
    async commit(files, message, author) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const ref = await gh('GET', `/git/ref/heads/${BRANCH}`);
        const head = await gh('GET', `/git/commits/${ref.object.sha}`);
        const tree = [];
        for (const f of files) {
          if (f.delete) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
          const blob = await gh('POST', '/git/blobs', f.base64 != null ? { content: f.base64, encoding: 'base64' } : { content: f.text, encoding: 'utf-8' });
          tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
        }
        const t = await gh('POST', '/git/trees', { base_tree: head.tree.sha, tree });
        const c = await gh('POST', '/git/commits', { message, tree: t.sha, parents: [ref.object.sha], ...(author ? { author: { name: author, email: 'admin@jamschool.kr', date: new Date().toISOString() } } : {}) });
        try { await gh('PATCH', `/git/refs/heads/${BRANCH}`, { sha: c.sha, force: false }); return { sha: c.sha }; }
        catch (e) { if (e.status !== 422 || attempt === 2) throw e; }   // 그사이 다른 커밋(AI 글 발행 등)이 올라옴 → 최신 위에 다시
      }
    },
    async recent(n = 20, p) {
      const j = await gh('GET', `/commits?sha=${BRANCH}&per_page=${n}${p ? '&path=' + encodeURIComponent(p) : ''}`);
      return (j || []).map(c => ({ sha: c.sha, message: c.commit.message, author: c.commit.author.name, date: c.commit.author.date }));
    },
    // 사이트 반영 상태: Railway 가 커밋에 남기는 상태(context 에 서비스 이름)
    async status(sha) {
      const j = await gh('GET', `/commits/${sha}/statuses`) || [];
      const r = j.find(s => /railway|jamschool/i.test(s.context + ' ' + (s.target_url || '')));
      return r ? { state: r.state, description: r.description, at: r.updated_at } : { state: 'unknown' };
    },
  };
}

function localStore(root) {
  const abs = p => { const a = path.resolve(root, p); if (!a.startsWith(path.resolve(root) + path.sep)) throw new Error('경로 오류'); return a; };
  let pending = null;
  const rebuild = () => { if (process.env.ADMIN_LOCAL_NOBUILD) return; clearTimeout(pending); pending = setTimeout(() => { try { execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'ignore' }); execFileSync(process.execPath, ['tools/export-site.mjs', '_site'], { cwd: root, stdio: 'ignore' }); } catch (e) { console.error('로컬 빌드 실패', e.message); } }, 300); };
  return {
    kind: 'local', ready: () => true,
    async read(p) { const a = abs(p); return fs.existsSync(a) ? { text: fs.readFileSync(a, 'utf8'), sha: String(fs.statSync(a).mtimeMs) } : null; },
    async list(dir) { const a = abs(dir); return fs.existsSync(a) ? fs.readdirSync(a, { withFileTypes: true }).map(e => ({ name: e.name, path: `${dir}/${e.name}`, type: e.isDirectory() ? 'dir' : 'file' })) : []; },
    async commit(files, message) {
      for (const f of files) {
        const a = abs(f.path);
        if (f.delete) { if (fs.existsSync(a)) fs.unlinkSync(a); continue; }
        fs.mkdirSync(path.dirname(a), { recursive: true });
        fs.writeFileSync(a, f.base64 != null ? Buffer.from(f.base64, 'base64') : f.text);
      }
      fs.appendFileSync(path.join(root, '..', 'admin-local.log'), `[${new Date().toLocaleString('ko-KR')}] ${message.split('\n')[0]} (${files.length}개 파일)\n`);
      rebuild();
      return { sha: 'local-' + Date.now() };
    },
    async recent(n = 20) {
      try { return execFileSync('git', ['log', `-${n}`, '--format=%H%x09%an%x09%aI%x09%s'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(l => { const [sha, author, date, message] = l.split('\t'); return { sha, author, date, message }; }); }
      catch { return []; }
    },
    async status() { return { state: 'local', description: '로컬 저장(배포는 deploy.bat)' }; },
  };
}
