// 블로그 글(content/blog/*.md) 읽기: 머리말 파싱 + 마크다운(필요한 만큼만) → HTML, 목차·FAQ 추출
import fs from 'node:fs';
import path from 'node:path';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('머리말(---)이 없습니다');
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  meta.tags = (meta.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  return { meta, body: m[2].trim() };
}

// 인라인: **굵게**, [링크](주소)
function inline(t) {
  let s = esc(t);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, href) => {
    const safe = /^(https?:\/\/|\/|#|[a-z0-9-]+\.html|blog\/|product-)/i.test(href) ? href : '#';
    const ext = /^https?:\/\//.test(safe) && !/^https?:\/\/jamschool\.kr/.test(safe);
    return `<a href="${esc(safe)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${txt}</a>`;
  });
  return s;
}
const slugify = (t, i) => 'h-' + (i + 1);

export function renderMarkdown(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [], toc = [];
  let i = 0, h2 = 0;
  const flushPara = buf => { if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`); };
  let para = [];
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { flushPara(para); para = []; i++; continue; }
    let m;
    if ((m = l.match(/^##\s+(.+)/)) && !l.startsWith('###')) {
      flushPara(para); para = [];
      const id = slugify(m[1], h2++); toc.push({ id, t: m[1].trim() });
      out.push(`<h2 id="${id}">${inline(m[1].trim())}</h2>`); i++; continue;
    }
    if ((m = l.match(/^###\s+(.+)/))) { flushPara(para); para = []; out.push(`<h3>${inline(m[1].trim())}</h3>`); i++; continue; }
    // 사진 한 줄: ![설명](assets/img/blog/...) — 어드민에서 올린 사진(사이트 안 경로만)
    if ((m = l.match(/^!\[([^\]]*)\]\((assets\/img\/[\w\-./가-힣]+\.(?:jpe?g|png|webp|gif))\)\s*$/i))) {
      flushPara(para); para = [];
      out.push(`<figure class="post__fig"><img src="${esc(m[2])}" alt="${esc(m[1])}" loading="lazy" decoding="async">${m[1] ? `<figcaption>${esc(m[1])}</figcaption>` : ''}</figure>`); i++; continue;
    }
    if (/^>\s?/.test(l)) {
      flushPara(para); para = [];
      const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`); continue;
    }
    if (/^\|.*\|\s*$/.test(l)) {
      flushPara(para); para = [];
      const rows = []; while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(rows[0]); const body = rows.slice(/^\|\s*:?-{2,}/.test(rows[1] || '') ? 2 : 1).map(cells);
      out.push(`<table><thead><tr>${head.map(c => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l)) {
      flushPara(para); para = [];
      const ordered = /^\s*\d+[.)]\s+/.test(l), items = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/).test(lines[i])) items.push(lines[i++].replace(/^\s*(?:[-*]|\d+[.)])\s+/, ''));
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    para.push(l.trim()); i++;
  }
  flushPara(para);
  return { html: out.join('\n'), toc };
}

// "## 자주 묻는 질문" 아래의 "### Q. 질문" + 답 문단을 FAQ로 떼어 낸다
export function splitFaq(body) {
  const m = body.match(/\n##\s+자주 묻는 질문\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!m) return { body, faq: [] };
  const faq = [];
  for (const part of m[1].split(/\n###\s+/).map(s => s.trim()).filter(Boolean)) {
    const [qLine, ...rest] = part.split('\n');
    const q = qLine.replace(/^Q[.:]\s*/, '').trim();
    const a = rest.join('\n').trim().replace(/^A[.:]\s*/, '');
    if (q && a) faq.push({ q, a });
  }
  return { body: body.replace(m[0], '\n'), faq };
}

export function loadPosts(dir) {
  if (!fs.existsSync(dir)) return [];
  // draft: true(어드민 '임시저장') 글은 사이트·사이트맵·RSS 에 내보내지 않는다
  return fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_')).map(f => ({ f, ...parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8')) })).filter(x => x.meta.draft !== 'true').map(({ f, meta, body }) => {
    for (const k of ['title', 'description', 'slug', 'date', 'category']) if (!meta[k]) throw new Error(`${f}: ${k} 누락`);
    const { body: main, faq } = splitFaq(body);
    const { html, toc } = renderMarkdown(main);
    const chars = body.replace(/\s+/g, '').length;
    return { ...meta, file: f, html, toc, faq: faq.map(x => ({ q: x.q, a: x.a, html: renderMarkdown(x.a).html })), minutes: Math.max(2, Math.ceil(chars / 500)), text: main };
  }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
}
