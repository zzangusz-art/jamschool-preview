// 어드민 저장소 — 고친 내용을 어디에 저장하나
//   GitHub(운영): GITHUB_TOKEN(이 저장소 Contents 읽기·쓰기만 허용한 fine-grained 토큰), GITHUB_REPO(기본 zzangusz-art/jamschool-preview), GITHUB_BRANCH(기본 main)
//     저장 = 커밋 1개(여러 파일을 한 번에) → Railway·GitHub Pages 가 자동으로 다시 배포(약 2분)
//   로컬(시험·PC 작업): ADMIN_STORE=local → 이 폴더 파일을 직접 고치고 빌드(npm run build). 커밋은 deploy.bat 이 나중에
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function makeStore(root) {
  // 로컬 시험: ADMIN_LOCAL_ROOT(저장할 폴더, 기본 이 사이트 폴더), ADMIN_LOCAL_NOBUILD=1 이면 저장 뒤 빌드 안 함
  return process.env.ADMIN_STORE === 'local' ? localStore(process.env.ADMIN_LOCAL_ROOT || root) : githubStore(root);
}

// 운영 읽기 속도: 서버에 배포된 저장소 파일(= 마지막으로 배포된 커밋)을 먼저 읽는다. GitHub API 로 파일마다 읽으면
// 글 목록 한 번에 55번 요청(약 8초)이 들기 때문. 어드민이 저장한 파일은 다시 배포되기 전까지 메모리(overlay)에서 돌려준다.
// 저장소에 다른 커밋(자동 발행 등)이 올라오면 Railway 가 다시 배포하므로 서버 파일도 곧 최신이 된다(그사이 2~3분은 이전 내용).
// fresh: true 로 읽으면 GitHub 최신본(저장 직전 읽고-고쳐-쓰는 파일에 쓴다).
function githubStore(root) {
  const REPO = process.env.GITHUB_REPO || 'zzangusz-art/jamschool-preview', BRANCH = process.env.GITHUB_BRANCH || 'main';
  const token = () => process.env.GITHUB_TOKEN || '';
  async function gh(method, url, body) {
    const res = await fetch(`https://api.github.com/repos/${REPO}${url}`, { method,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'jamschool-admin', ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    if (res.status === 404) return null;
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {   // GitHub 의 401·403 을 그대로 넘기면 어드민 화면이 '로그인 풀림'으로 알고 고치던 내용을 버린다 → 502 + 한국어 안내
      const e = new Error(ghError(res.status, j.message || '')); e.ghStatus = res.status; e.status = res.status === 422 ? 422 : 502; throw e;
    }
    return j;
  }
  function ghError(status, m) {
    const tag = `(GitHub ${status}: ${m})`;
    if (status === 401) return `저장하지 못했습니다 — GitHub 토큰이 만료됐거나 지워졌습니다. 새 토큰을 만들어 Railway 변수 GITHUB_TOKEN 을 바꿔 주세요 ${tag}`;
    if (status === 403 && /rate limit/i.test(m)) return `GitHub 요청 한도를 넘었습니다. 잠시 뒤 다시 저장해 주세요 ${tag}`;
    if (status === 403) return `저장하지 못했습니다 — GitHub 토큰에 저장소 ${REPO} 쓰기 권한이 없습니다. GitHub › Settings › Developer settings › Fine-grained tokens › 이 토큰에서 Repository access 에 ${REPO.split('/')[1]} 를 넣고 Permissions › Contents 를 Read and write 로 바꿔 주세요(토큰 값은 그대로) ${tag}`;
    return `GitHub 오류 ${tag}`;
  }
  const enc = p => p.split('/').map(encodeURIComponent).join('/');
  const ROOT = path.resolve(root || '.');
  const disk = p => { const a = path.resolve(ROOT, p); return a.startsWith(ROOT + path.sep) ? a : null; };
  const overlay = new Map();   // 이번 서버가 켜진 뒤 어드민이 저장한 파일: path → { text } | { deleted: true }
  let recentCache = null;
  return {
    kind: 'github', ready: () => !!token(),
    async read(p, { fresh = false } = {}) {
      if (!fresh) {
        const o = overlay.get(p);
        if (o) return o.deleted ? null : { text: o.text, sha: 'overlay' };
        const a = disk(p);
        if (a && fs.existsSync(a) && fs.statSync(a).isFile()) return { text: fs.readFileSync(a, 'utf8'), sha: 'local' };
      }
      const j = await gh('GET', `/contents/${enc(p)}?ref=${BRANCH}`);
      if (!j || Array.isArray(j)) return null;
      let b64 = j.content;
      if (!b64 && j.sha) b64 = (await gh('GET', `/git/blobs/${j.sha}`)).content;   // 1MB 넘는 파일
      return { text: Buffer.from(b64 || '', 'base64').toString('utf8'), sha: j.sha };
    },
    async list(dir) {
      const a = disk(dir);
      let out;
      if (a && fs.existsSync(a)) out = fs.readdirSync(a, { withFileTypes: true }).map(e => ({ name: e.name, path: `${dir}/${e.name}`, type: e.isDirectory() ? 'dir' : 'file' }));
      else { const j = await gh('GET', `/contents/${enc(dir)}?ref=${BRANCH}`); out = Array.isArray(j) ? j.map(x => ({ name: x.name, path: x.path, type: x.type, size: x.size })) : []; }
      for (const [p, o] of overlay) {   // 저장했지만 아직 배포 전인 파일 더하기·빼기
        if (path.posix.dirname(p) !== dir) continue;
        const name = path.posix.basename(p), i = out.findIndex(x => x.name === name);
        if (o.deleted) { if (i >= 0) out.splice(i, 1); } else if (i < 0) out.push({ name, path: p, type: 'file' });
      }
      return out;
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
        try {
          await gh('PATCH', `/git/refs/heads/${BRANCH}`, { sha: c.sha, force: false });
          for (const f of files) {   // 다음 배포 전까지 서버 파일 대신 이 내용을 돌려준다(사진은 읽을 일이 없어 목록용 표시만)
            if (f.delete) overlay.set(f.path, { deleted: true });
            else overlay.set(f.path, { text: f.text != null ? f.text : '' });
          }
          recentCache = null;
          return { sha: c.sha };
        }
        catch (e) { if (e.ghStatus !== 422 || attempt === 2) throw e; }   // 그사이 다른 커밋(AI 글 발행 등)이 올라옴 → 최신 위에 다시
      }
    },
    async recent(n = 20, p) {
      const key = `${n}|${p || ''}`;
      if (recentCache && recentCache.key === key && Date.now() - recentCache.at < 15000) return recentCache.list;
      const j = await gh('GET', `/commits?sha=${BRANCH}&per_page=${n}${p ? '&path=' + encodeURIComponent(p) : ''}`);
      const list = (j || []).map(c => ({ sha: c.sha, message: c.commit.message, author: c.commit.author.name, date: c.commit.author.date }));
      recentCache = { key, at: Date.now(), list };
      return list;
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
