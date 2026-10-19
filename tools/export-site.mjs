// 서빙할 파일만 골라 배포 폴더로 내보낸다. (먼저 node build.mjs 실행)
// 사용: node tools/export-site.mjs <출력폴더> [--preview <미리보기 주소>]
//   --preview: 모든 페이지 noindex, robots.txt Disallow, og:image 를 미리보기 주소로 (운영 배포에는 쓰지 않음)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || '_site');
const i = process.argv.indexOf('--preview');
const PREVIEW = i > -1 ? (process.argv[i + 1] || '').replace(/\/?$/, '/') : null;
const SKIP = [/^src[\\/]/, /^tools[\\/]/, /^content[\\/]/, /^node_modules[\\/]/, /^\.github[\\/]/, /^\.git([\\/]|$)/, /^_site[\\/]/,
  /^package(-lock)?\.json$/, /^build\.(mjs|bat)$/, /^README\.md$/, /^\.gitignore$/, /^assets[\\/]js[\\/]detail-\d+\.js$/, /\.log$/];

fs.rmSync(OUT, { recursive: true, force: true });
let n = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name), rel = path.relative(ROOT, abs);
    if (SKIP.some(r => r.test(rel))) continue;
    if (e.isDirectory()) { walk(abs); continue; }
    const dst = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(abs, dst); n++;
  }
})(ROOT);

if (PREVIEW) {
  (function walkHtml(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walkHtml(abs); continue; }
      if (!e.name.endsWith('.html')) continue;
      let s = fs.readFileSync(abs, 'utf8');
      if (!s.includes('name="robots"')) s = s.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex, nofollow">');
      s = s.replace(/(property="og:image" content=")https:\/\/jamschool\.co\.kr\//g, `$1${PREVIEW}`);
      fs.writeFileSync(abs, s);
    }
  })(OUT);
  fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
}
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`export: ${n} files → ${OUT}${PREVIEW ? ' (preview: noindex)' : ''}`);
