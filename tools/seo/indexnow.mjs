// IndexNow: 운영 사이트맵에서 새로 생기거나 lastmod 가 바뀐 주소만 골라 api.indexnow.org 로 알린다
// (IndexNow 참여 검색엔진 — Bing·네이버·Yandex·Seznam 등 — 이 같은 목록을 나눠 받는다. Bing 은 ChatGPT 검색·Copilot 의 바탕)
// 사용: node tools/seo/indexnow.mjs [--all] [--dry]
//   --all : 지난 제출 기록과 상관없이 사이트맵 전체   --dry : 고른 주소만 보여 주고 보내지 않음
// 키: src/site-tags.json indexNowKey (빌드가 사이트 루트에 <키>.txt 로 내보냄). 운영에 키 파일이 아직 없으면 보내지 않는다.
// 제출 기록: 측정/indexnow.json (주소별로 마지막으로 알린 lastmod)
import fs from 'node:fs';
import path from 'node:path';
import { MEASURE, SITE_ROOT, kstDate } from '../monitor/lib.mjs';

const HOST = 'jamschool.kr', SITE = `https://${HOST}/`;
const key = (JSON.parse(fs.readFileSync(path.join(SITE_ROOT, 'src/site-tags.json'), 'utf8')).indexNowKey || '').trim();
const all = process.argv.includes('--all'), dry = process.argv.includes('--dry');
const STATE = path.join(MEASURE, 'indexnow.json');
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { sent: {}, log: [] };

if (!/^[\w-]{8,128}$/.test(key)) { console.log('IndexNow 키 없음(src/site-tags.json indexNowKey) — 건너뜀'); process.exit(0); }
const get = async u => { const r = await fetch(u, { headers: { 'cache-control': 'no-cache' } }); return { ok: r.ok, status: r.status, text: await r.text() }; };

const kf = await get(`${SITE}${key}.txt`).catch(e => ({ ok: false, status: e.message, text: '' }));
if (!kf.ok || kf.text.trim() !== key) { console.log(`운영에 키 파일이 아직 없음(${SITE}${key}.txt → ${kf.status}) — 배포 뒤 다시 실행`); process.exit(0); }

const sm = await get(`${SITE}sitemap.xml`);
if (!sm.ok) { console.log(`사이트맵을 못 읽음(${sm.status})`); process.exit(1); }
const urls = [...sm.text.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].map(m => ({ loc: m[1], lastmod: m[2] }));
const pick = urls.filter(u => all || state.sent[u.loc] !== u.lastmod);
if (!pick.length) { console.log(`IndexNow: 바뀐 주소 없음(사이트맵 ${urls.length}개)`); process.exit(0); }
if (dry) { console.log(`IndexNow(보내지 않음): ${pick.length}개\n  ${pick.map(u => `${u.lastmod} ${u.loc}`).join('\n  ')}`); process.exit(0); }

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key, keyLocation: `${SITE}${key}.txt`, urlList: pick.map(u => u.loc) }),
});
// 200 = 받음, 202 = 받았고 키 확인 대기. 그 밖(400·403·422·429)은 기록하지 않고 다음 실행 때 다시
const okay = res.status === 200 || res.status === 202;
if (okay) for (const u of pick) state.sent[u.loc] = u.lastmod;
state.log = [...(state.log || []), { date: kstDate(), status: res.status, n: pick.length }].slice(-60);
fs.writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n');
console.log(`IndexNow: ${pick.length}개 → ${res.status} ${okay ? '접수' : '실패 — ' + (await res.text()).slice(0, 200)}`);
process.exit(okay ? 0 : 1);
