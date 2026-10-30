// Railway 등 Node 호스팅용 정적 서버 (의존성 없음). 먼저 npm run build(빌드 + _site 내보내기)
// 사용: node tools/serve.mjs [폴더=_site]   — Railway 는 package.json 의 start 로 실행
// - PORT(기본 8080), 확장자별 Content-Type, mp4 Range 요청(사파리 영상 재생), html 은 no-cache·나머지 7일 캐시, 텍스트 gzip
// - Railway 는 운영(jamschool.kr)이라 기본은 색인 허용. 환경변수
//     CANONICAL_HOST=jamschool.kr  다른 호스트(www·*.up.railway.app)로 온 요청을 https://jamschool.kr 로 301 (도메인 연결 뒤 설정)
//     SITE_NOINDEX=1               미리보기로 쓸 때: 모든 응답 X-Robots-Tag noindex, robots.txt 전체 차단
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { handleAdmin } from './admin/server.mjs';

const ROOT = path.resolve(process.argv[2] || '_site');
const PORT = +process.env.PORT || 8080;
const INDEX = process.env.SITE_NOINDEX !== '1';
const HOST = (process.env.CANONICAL_HOST || '').trim().toLowerCase();
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.pdf': 'application/pdf',
};
const TEXT = /^(text\/|application\/(json|xml)|image\/svg)/;
// 캐시: 페이지·사이트맵·RSS·robots 는 매번 확인(Cloudflare 가 오래 들고 있지 않게), js·css 1시간, 사진·영상·글꼴 7일
const cacheFor = type => /^text\/(html|plain)|application\/(xml|json)/.test(type) ? 'no-cache' : /javascript|text\/css/.test(type) ? 'public, max-age=3600' : 'public, max-age=604800';
if (!fs.existsSync(path.join(ROOT, 'index.html'))) { console.error(`${ROOT}/index.html 없음 — 먼저 npm run build`); process.exit(1); }

// URL → 파일(폴더면 index.html, 확장자 없으면 .html). ROOT 밖은 거절
function resolve(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch { return null; }
  const abs = path.join(ROOT, p);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  for (const cand of [abs, path.join(abs, 'index.html'), path.extname(abs) ? null : abs + '.html']) {
    if (!cand) continue;
    const st = fs.statSync(cand, { throwIfNoEntry: false });
    if (st && st.isFile()) return { abs: cand, st };
  }
  return null;
}

const gz = new Map();   // 파일 경로 → { mtime, body } (텍스트 파일 gzip 결과 재사용)
function gzipped(f) {
  const hit = gz.get(f.abs);
  if (hit && hit.mtime === f.st.mtimeMs) return hit.body;
  const body = zlib.gzipSync(fs.readFileSync(f.abs));
  gz.set(f.abs, { mtime: f.st.mtimeMs, body });
  return body;
}

http.createServer(async (req, res) => {
  // 관리자 어드민(/admin, /api/admin/*) — 정식 주소 이동·정적 파일보다 먼저
  if (await handleAdmin(req, res)) return;
  if (!INDEX) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  const url = req.url || '/';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
  if (HOST && host && host !== HOST && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) && !host.endsWith('.railway.internal') && host !== 'healthcheck.railway.app') {
    res.writeHead(301, { Location: `https://${HOST}${url}` }); res.end(); return;
  }
  if (!INDEX && url.split('?')[0] === '/robots.txt') { res.writeHead(200, { 'Content-Type': TYPES['.txt'] }); res.end('User-agent: *\nDisallow: /\n'); return; }
  const f = resolve(url);
  if (!f) { res.writeHead(404, { 'Content-Type': TYPES['.html'] }); res.end('<!doctype html><meta charset="utf-8"><title>404</title><p>페이지를 찾을 수 없습니다. <a href="/">홈으로</a></p>'); return; }
  const type = TYPES[path.extname(f.abs).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Last-Modified': f.st.mtime.toUTCString(), 'Accept-Ranges': 'bytes',
    'Cache-Control': cacheFor(type) };
  const since = Date.parse(req.headers['if-modified-since'] || '');
  if (since && since >= Math.floor(f.st.mtimeMs / 1000) * 1000) { res.writeHead(304, headers); res.end(); return; }
  const size = f.st.size;
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    const start = range[1] === '' ? size - +range[2] : +range[1];
    const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(+range[2], size - 1);
    if (!(start >= 0 && start <= end && start < size)) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(f.abs, { start, end }).pipe(res);
    return;
  }
  if (TEXT.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const body = gzipped(f);
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(f.abs).pipe(res);
}).listen(PORT, () => console.log(`serve: ${ROOT} → :${PORT}${INDEX ? '' : ' (미리보기: noindex)'}${HOST ? ` · 정식 주소 https://${HOST}` : ''}`));
