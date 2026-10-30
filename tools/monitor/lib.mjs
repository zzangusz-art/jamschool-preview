// AI 노출도 측정 공통: 경로·날짜·키(.env)·판정·추이.csv
// 결과는 저장소 밖(상위 폴더) 측정/·보고/ 에 쌓는다 — 하나회원권 홈페이지/측정/AI검색 과 같은 구조
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROJECT = path.resolve(SITE_ROOT, '..');
export const MEASURE = path.join(PROJECT, '측정');
export const AI_DIR = path.join(MEASURE, 'AI검색');
export const BLOG_DIR = path.join(MEASURE, '블로그');
export const REPORT_DIR = path.join(PROJECT, '보고');
export const CSV = path.join(AI_DIR, '추이.csv');
export const CFG = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'queries.json'), 'utf8'));

// KST 날짜(YYYY-MM-DD), n일 더하기
export const kstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
export const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
export const safe = s => s.replace(/[^\w가-힣]+/g, '_').replace(/^_|_$/g, '');

// API 키: 환경 변수 → 측정/.env (KEY=값 한 줄씩). 값은 어디에도 출력하지 않는다
export function loadEnv() {
  const f = path.join(MEASURE, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// 판정: site = 공식 홈(jamschool.kr), mall = 공식몰·스마트스토어, brand = 상호 언급(질의 문구 자체는 빼고), 경쟁사, 순위(링크 목록에서 우리 링크가 몇 번째)
export function judge(text, links, query) {
  const low = s => String(s || '').toLowerCase();
  const hay = low(text) + '\n' + links.map(l => low(l.url) + ' ' + low(l.title)).join('\n');
  const own = u => CFG.site.concat(CFG.mall).some(d => low(u).includes(d));
  const idx = links.findIndex(l => own(l.url) || own(l.title));
  const body = String(text || '').split(query).join(' ');
  return {
    site: CFG.site.some(d => hay.includes(d)),
    mall: CFG.mall.some(d => hay.includes(d)),
    brand: CFG.brand.some(b => body.includes(b)),
    competitors: CFG.competitors.filter(c => hay.includes(low(c)) || String(text || '').includes(c)),
    rank: idx >= 0 ? idx + 1 : null,
  };
}

// 추이.csv: 같은 날짜·엔진을 다시 측정하면 그 줄을 바꿔 쓴다
export const CSV_HEAD = ['date', 'engine', 'kind', 'query', 'type', 'site', 'mall', 'brand', 'rank', 'competitors', 'blocked', 'error'];
const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function readCsv() {
  if (!fs.existsSync(CSV)) return [];
  const rows = [];
  for (const line of fs.readFileSync(CSV, 'utf8').replace(/^\ufeff/, '').split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    const r = Object.fromEntries(CSV_HEAD.map((k, i) => [k, out[i] ?? '']));
    for (const k of ['site', 'mall', 'brand', 'blocked']) r[k] = r[k] === '1';
    r.rank = r.rank ? +r.rank : null; r.competitors = r.competitors ? r.competitors.split('|') : [];
    rows.push(r);
  }
  return rows;
}
export function writeRows(date, engines, results) {
  fs.mkdirSync(AI_DIR, { recursive: true });
  const keep = readCsv().filter(r => !(r.date === date && engines.includes(r.engine)));
  const all = keep.concat(results).sort((a, b) => a.date.localeCompare(b.date));
  const line = r => [r.date, r.engine, r.kind, r.query, r.type, r.site ? 1 : 0, r.mall ? 1 : 0, r.brand ? 1 : 0, r.rank ?? '', (r.competitors || []).join('|'), r.blocked ? 1 : 0, r.error || ''].map(cell).join(',');
  fs.writeFileSync(CSV, '\ufeff' + CSV_HEAD.join(',') + '\n' + all.map(line).join('\n') + '\n', 'utf8');
}

export function findChrome() {
  const list = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium'];
  return list.find(p => p && fs.existsSync(p));
}
