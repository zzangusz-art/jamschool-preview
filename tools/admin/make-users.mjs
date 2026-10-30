// 어드민 첫 계정 만들기(관리자 1 + 클라이언트 2): 비밀번호를 새로 만들고, 해시만 담은 계정 파일과 Railway 에 넣을 값을 저장소 밖에 쓴다
//   node tools/admin/make-users.mjs                → ../관리자/ (admin-users.json, 관리자_계정.txt)
//   node tools/admin/make-users.mjs --out <폴더>
// 저장소가 공개이므로 결과 파일은 절대 jamschool-site 안에 두지 않는다. 비밀번호는 관리자_계정.txt 에만 있다(전달 뒤 각자 '내 계정'에서 변경).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, newPassword } from './auth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const i = process.argv.indexOf('--out');
const OUT = path.resolve(i > 0 ? process.argv[i + 1] : path.join(ROOT, '..', '관리자'));
if (OUT.startsWith(ROOT + path.sep)) { console.error('저장소 안에는 만들 수 없습니다'); process.exit(1); }
const ACCOUNTS = [
  { id: 'kevin', name: 'Kevin', role: 'owner' },
  { id: 'jamschool01', name: '잠스쿨 담당자 1', role: 'client' },
  { id: 'jamschool02', name: '잠스쿨 담당자 2', role: 'client' },
];
if (fs.existsSync(path.join(OUT, 'admin-users.json')) && !process.argv.includes('--force')) { console.error(`${OUT}\\admin-users.json 이 이미 있습니다(다시 만들려면 --force)`); process.exit(1); }
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const made = ACCOUNTS.map(a => ({ ...a, pw: newPassword() }));
const users = made.map(({ pw, ...a }) => ({ ...a, hash: hashPassword(pw), created: today }));
const secret = crypto.randomBytes(32).toString('hex');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'admin-users.json'), JSON.stringify(users, null, 1));
fs.writeFileSync(path.join(OUT, '관리자_계정.txt'), [
  `잠스쿨 관리자 어드민 계정 (${today} 생성) — 이 파일은 외부에 올리지 말 것`,
  '주소: https://jamschool.kr/admin', '',
  ...made.map(a => `${a.role === 'owner' ? '[관리자]' : '[클라이언트]'} ${a.name}\n  아이디: ${a.id}\n  첫 비밀번호: ${a.pw}`), '',
  '첫 로그인 뒤 왼쪽 아래 「내 계정」에서 비밀번호를 바꾸게 하세요(Railway 볼륨 연결 뒤 가능).', '',
  '── Railway(jamschool.kr 서비스) → Variables 에 넣을 값 ──',
  `SESSION_SECRET=${secret}`,
  `ADMIN_USERS=${JSON.stringify(users)}`,
  'GITHUB_TOKEN=(GitHub → Settings → Developer settings → Fine-grained tokens → 저장소 zzangusz-art/jamschool-preview 만, Contents: Read and write)',
  'DATA_DIR=/data   (Railway → 서비스 → Settings → Volumes 에서 /data 로 볼륨 추가한 뒤)',
  'CANONICAL_HOST=jamschool.kr', '',
].join('\n'));
console.log(`계정 ${users.length}개 → ${OUT}\\관리자_계정.txt (비밀번호·Railway 변수), admin-users.json`);
