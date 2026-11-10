// 어드민 로그인 잠금·손님 IP 판단 시험 — node tools/admin/test-auth.mjs
//   임시 폴더의 시험 계정만 쓰고 운영과 상관없다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-auth-'));
process.env.DATA_DIR = TMP; process.env.ADMIN_STORE = 'local';
const { clientIp, isCloudflare } = await import('../client-ip.mjs');
const A = await import('./auth.mjs');
fs.writeFileSync(path.join(TMP, 'admin-users.json'), JSON.stringify([{ id: 'owner', name: '시험', role: 'owner', hash: A.hashPassword('right-pass-123') }]));
let n = 0; const ok = t => console.log(`OK ${++n}. ${t}`);
const req = (headers, remote = '10.0.0.1') => ({ headers, socket: { remoteAddress: remote } });

// ── 손님 IP
assert.equal(clientIp(req({ 'x-real-ip': '162.158.10.20', 'cf-connecting-ip': '211.36.1.2', 'x-forwarded-for': '1.1.1.1, 211.36.1.2, 162.158.10.20' })), '211.36.1.2');
ok('Cloudflare 를 거친 요청: CF-Connecting-IP(실제 손님)');
assert.equal(clientIp(req({ 'x-real-ip': '211.36.9.9', 'cf-connecting-ip': '5.5.5.5', 'x-forwarded-for': '5.5.5.5' })), '211.36.9.9');
ok('Cloudflare 를 안 거치고 CF-Connecting-IP·X-Forwarded-For 를 꾸민 요청: 접속 주소 그대로');
assert.equal(clientIp(req({ 'x-forwarded-for': '9.9.9.9, 211.36.1.2' })), '211.36.1.2');
ok('X-Real-IP 가 없으면 X-Forwarded-For 첫 값(꾸밀 수 있음)이 아니라 마지막 값');
assert.equal(clientIp(req({ 'x-real-ip': '2606:4700:10::1', 'cf-connecting-ip': '2001:db8::7' })), '2001:db8::7');
assert.equal(clientIp(req({}, '::ffff:127.0.0.1')), '127.0.0.1');
assert.equal(clientIp(req({ 'x-real-ip': '104.16.0.1', 'cf-connecting-ip': 'not-an-ip' })), '104.16.0.1');
assert.ok(isCloudflare('172.64.1.1') && !isCloudflare('8.8.8.8') && !isCloudflare('garbage'));
ok('IPv6 Cloudflare · ::ffff: 표기 · 잘못된 CF-Connecting-IP 무시 · 대역 판정');

// ── 로그인 잠금
const bad = (ip, id = 'owner') => A.login(id, 'wrong', ip).error;
for (let i = 0; i < 10; i++) assert.match(bad('211.36.1.2'), /맞지 않습니다/);
assert.match(bad('211.36.1.2'), /막혔습니다/);
assert.match(A.login('owner', 'right-pass-123', '211.36.1.2').error || '', /막혔습니다/);
ok('같은 IP·아이디 10번 실패 → 11번째부터 막힘(맞는 비밀번호도)');
assert.ok(A.login('owner', 'right-pass-123', '211.36.1.3').user);
ok('다른 IP 에서는 맞는 비밀번호로 로그인됨(사무실 동료가 막히지 않음)');
// IP 를 매번 바꿔도 아이디 기준 30번에서 막힘(위 10번 + 20번)
for (let i = 0; i < 20; i++) assert.match(bad(`203.0.113.${i + 1}`), /맞지 않습니다/);
assert.match(bad('203.0.113.250'), /막혔습니다/);
assert.match(A.login('owner', 'right-pass-123', '198.51.100.1').error || '', /막혔습니다/);
ok('IP 를 매번 바꿔도 같은 아이디 30번 실패 → 어느 IP 에서도 막힘');
assert.match(bad('203.0.113.1', 'other-id'), /맞지 않습니다/);
ok('다른 아이디는 따로 센다');
// 없는 아이디도 똑같이 세고 잠근다(아이디가 있는지 응답으로 알 수 없게)
for (let i = 0; i < 10; i++) bad('203.0.113.77', 'ghost');
assert.match(bad('203.0.113.77', 'ghost'), /막혔습니다/);
ok('없는 아이디도 같은 규칙');

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n로그인 잠금 시험 ${n}개 통과`);
