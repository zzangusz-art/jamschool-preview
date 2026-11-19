// Railway 볼륨(DATA_DIR) 데이터 옮기기 — 어드민 '데이터 옮기기'(관리자 전용)
//   볼륨에 있는 것: admin-users.json(어드민 계정) · orders/(결제 주문·결제 켜기 설정) · analytics/(방문 집계)
//   내보내기: 볼륨 파일 전체를 JSON 한 개로(파일마다 base64). 주문에 배송지가 있으므로 옮긴 뒤 PC 에서 지운다
//   가져오기: 같은 경로 파일은 덮어쓰고, 덮어쓰기 전 원래 파일은 DATA_DIR/_before-import/<시각>/ 에 남긴다
//   볼륨 표식: DATA_DIR/.volume-created — 볼륨이 처음 쓰인 시각. 서버를 다시 배포한 뒤에도 이 시각이 그대로면 볼륨이 붙어 있는 것
import fs from 'node:fs';
import path from 'node:path';

export const FORMAT = 'jamschool-data';
const MARK = '.volume-created', KEEP = '_before-import';
const STARTED = new Date().toISOString();
const dir = () => process.env.DATA_DIR || '';
const kstStamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\D/g, '').slice(0, 14);

// 볼륨 표식(서버가 켜질 때 한 번)
export function ensureMarker() {
  const d = dir(); if (!d) return;
  try { fs.mkdirSync(d, { recursive: true }); const f = path.join(d, MARK); if (!fs.existsSync(f)) fs.writeFileSync(f, new Date().toISOString()); }
  catch (e) { console.error('[backup] 볼륨 표식 실패', e.message); }
}

// 내보낼 파일 목록(표식·가져오기 전 보관본·임시 파일 제외)
function walk(root, rel = '') {
  const out = [];
  let ents = []; try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!rel && (e.name === MARK || e.name === KEEP)) continue;
    if (e.isDirectory()) out.push(...walk(root, r));
    else if (e.isFile() && !e.name.endsWith('.tmp')) out.push(r);
  }
  return out;
}
const group = p => p === 'admin-users.json' ? 'users' : p === 'orders/settings.json' ? 'settings' : /^orders\/JS\w+\.json$/.test(p) ? 'orders' : /^analytics\/\d{4}-\d{2}-\d{2}\.json$/.test(p) ? 'analytics' : 'other';   // 보관한 시험 주문·집계 정리 기록은 기타

const ENV = [
  ['DATA_DIR', '볼륨 경로(/data) — 없으면 주문·계정·집계가 재배포 때 사라짐'],
  ['SESSION_SECRET', '어드민 로그인 유지'],
  ['ADMIN_USERS', '첫 어드민 계정(볼륨에 계정 파일이 없을 때만 씀)'],
  ['CANONICAL_HOST', '정식 주소 jamschool.kr 로 모으기 — 도메인을 옮긴 뒤에 넣기'],
  ['GITHUB_TOKEN', '어드민에서 블로그·상품·상세 저장(없으면 저장 안 됨)'],
  ['SEEDPAY_MERCHANT_KEY', '씨드페이먼츠 상점 키(결제)'],
  ['SEEDPAY_MID', '씨드페이먼츠 상점 ID(없으면 코드 기본값 Startz002m)'],
  ['NOTIFY_TELEGRAM_TOKEN', '주문 텔레그램 알림(선택)'],
  ['NOTIFY_TELEGRAM_CHAT_ID', '주문 텔레그램 알림 대화방(선택)'],
];

// 지금 서버·볼륨 상태(값은 보내지 않고 '있음/없음'만)
export function volumeInfo(host) {
  const d = dir(), files = d ? walk(d) : [];
  const counts = { users: 0, settings: 0, orders: 0, analytics: 0, other: 0 }; let bytes = 0;
  for (const f of files) { counts[group(f)]++; try { bytes += fs.statSync(path.join(d, f)).size; } catch { /* 무시 */ } }
  let created = ''; try { created = fs.readFileSync(path.join(d, MARK), 'utf8').trim(); } catch { /* 없음 */ }
  let backups = []; try { backups = fs.readdirSync(path.join(d, KEEP)).sort().reverse().slice(0, 5); } catch { /* 없음 */ }
  const R = process.env;
  return {
    host: host || '', railway: { project: R.RAILWAY_PROJECT_NAME || '', service: R.RAILWAY_SERVICE_NAME || '', environment: R.RAILWAY_ENVIRONMENT_NAME || '', domain: R.RAILWAY_PUBLIC_DOMAIN || '', volume: R.RAILWAY_VOLUME_MOUNT_PATH || '' },
    dataDir: d, volumeCreated: created, serverStarted: STARTED, files: files.length, bytes, counts, backups,
    env: ENV.map(([name, what]) => ({ name, what, set: !!(R[name] || '').trim() })),
  };
}

export function exportBundle(host) {
  const d = dir(); if (!d) throw Object.assign(new Error('이 서버에는 볼륨(DATA_DIR)이 없습니다'), { status: 400 });
  const files = walk(d).map(p => { const abs = path.join(d, p), st = fs.statSync(abs); return { path: p, mtime: st.mtime.toISOString(), base64: fs.readFileSync(abs).toString('base64') }; });
  return { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), from: host || '', railway: process.env.RAILWAY_PROJECT_NAME || '', counts: volumeInfo(host).counts, files };
}

// 경로 검사: 상대 경로, 영문·숫자·.-_/ 만, 위로 올라가기·표식·보관 폴더 금지
const SAFE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/]+$/;
export function importBundle(bundle, { before } = {}) {
  const d = dir(); if (!d) throw Object.assign(new Error('이 서버에는 볼륨(DATA_DIR)이 없습니다 — Railway 에 볼륨을 붙이고 DATA_DIR=/data 를 넣은 뒤 다시 하세요'), { status: 400 });
  if (!bundle || bundle.format !== FORMAT || !Array.isArray(bundle.files)) throw Object.assign(new Error('잠스쿨 데이터 파일이 아닙니다'), { status: 400 });
  const list = [];
  for (const f of bundle.files) {
    const p = String(f && f.path || '');
    if (!SAFE.test(p) || p.split('/')[0] === KEEP || p === MARK || p.endsWith('.tmp') || typeof f.base64 !== 'string') throw Object.assign(new Error(`파일 경로가 올바르지 않습니다: ${p.slice(0, 80)}`), { status: 400 });
    const abs = path.resolve(d, p);
    if (!abs.startsWith(path.resolve(d) + path.sep)) throw Object.assign(new Error(`파일 경로가 올바르지 않습니다: ${p.slice(0, 80)}`), { status: 400 });
    list.push({ p, abs, buf: Buffer.from(f.base64, 'base64'), mtime: f.mtime });
  }
  if (typeof before === 'function') before();   // 방문 집계 메모리 → 파일
  const keep = path.join(d, KEEP, kstStamp());
  let written = 0, replaced = 0;
  const counts = { users: 0, settings: 0, orders: 0, analytics: 0, other: 0 };
  for (const x of list) {
    fs.mkdirSync(path.dirname(x.abs), { recursive: true });
    if (fs.existsSync(x.abs)) { const k = path.join(keep, x.p); fs.mkdirSync(path.dirname(k), { recursive: true }); fs.copyFileSync(x.abs, k); replaced++; }
    fs.writeFileSync(x.abs + '.tmp', x.buf); fs.renameSync(x.abs + '.tmp', x.abs);
    const t = Date.parse(x.mtime); if (t) try { fs.utimesSync(x.abs, new Date(t), new Date(t)); } catch { /* 무시 */ }
    written++; counts[group(x.p)]++;
  }
  return { ok: true, written, replaced, counts, keptIn: replaced ? path.relative(d, keep).replace(/\\/g, '/') : '' };
}
