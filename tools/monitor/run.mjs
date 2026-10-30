// 예약 실행 입구(Windows 작업 스케줄러 'JamSchool-AI-Monitor', 매일 10:30): node tools/monitor/run.mjs [auto|daily|weekly|monthly]
//   auto  : 오늘 측정(ai-check) + 블로그 키워드 점검 + 전후 비교 화면 캡처(capture-pages), 그리고 아직 없는 리포트 채우기 —
//           지난주(월~일) 주간 리포트, 지난달 월간 리포트. PC가 꺼져 있던 날이 있어도 다음 실행 때 빠진 리포트를 만든다
//   daily : 측정 + 키워드 점검 + 화면 캡처만 / weekly·monthly : 해당 리포트만 다시 만들기
// 실행 기록: 측정/monitor.log (같은 시간에 두 번 돌지 않게 잠금)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MEASURE, REPORT_DIR, SITE_ROOT, addDays, kstDate, readCsv } from './lib.mjs';

const mode = process.argv[2] || 'auto';
fs.mkdirSync(MEASURE, { recursive: true });
const LOG = path.join(MEASURE, 'monitor.log'), LOCK = path.join(MEASURE, '.monitor.lock');
const log = s => { const line = `[${new Date().toLocaleString('ko-KR')}] ${s}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };
try { const pid = +fs.readFileSync(LOCK, 'utf8'); if (pid && pid !== process.pid) { try { process.kill(pid, 0); log(`다른 실행이 진행 중(pid ${pid}) — 종료`); process.exit(0); } catch { /* 죽은 잠금 */ } } } catch { /* 잠금 없음 */ }
fs.writeFileSync(LOCK, String(process.pid));
process.on('exit', () => { try { if (+fs.readFileSync(LOCK, 'utf8') === process.pid) fs.unlinkSync(LOCK); } catch { /* no-op */ } });

const step = (name, args) => {
  log(`▶ ${name}`);
  const r = spawnSync(process.execPath, args, { cwd: SITE_ROOT, encoding: 'utf8', timeout: 45 * 60e3 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n');
  fs.appendFileSync(LOG, out.map(l => '    ' + l).join('\n') + '\n');
  log(`${r.status === 0 ? '✓' : '✗'} ${name}${r.status === 0 ? '' : ` (exit ${r.status})`} — ${out.filter(Boolean).slice(-1)[0] || ''}`);
  return r.status === 0;
};

const today = kstDate();
const dow = new Date(today + 'T00:00:00Z').getUTCDay();          // 0=일 … 1=월
const lastSunday = addDays(today, -(dow === 0 ? 7 : dow));       // 다 끝난 지난주의 일요일
const lastMonth = addDays(today.slice(0, 8) + '01', -1).slice(0, 7);
const has = f => fs.existsSync(path.join(REPORT_DIR, f));

if (mode === 'auto' || mode === 'daily') {
  step('AI 검색·검색엔진 노출 측정', ['tools/monitor/ai-check.mjs']);
  step('블로그 대표 키워드 점검', ['tools/monitor/keyword-check.mjs']);
  step('전후 비교 화면 캡처', ['tools/monitor/capture-pages.mjs']);
}
// 측정 기록이 없는 기간(측정 시작 전)은 리포트를 만들지 않는다
const rows = readCsv();
const measured = (a, b) => rows.some(r => r.date >= a && r.date <= b);
const wk = measured(addDays(lastSunday, -6), lastSunday), mo = rows.some(r => r.date.startsWith(lastMonth));
if (mode === 'auto' && !wk && !has(`잠스쿨_주간리포트_${lastSunday}.pdf`)) log(`주간 리포트(${lastSunday}) 건너뜀 — 그 주 측정 기록 없음`);
if (mode === 'auto' && !mo && !has(`잠스쿨_월간리포트_${lastMonth}.pdf`)) log(`월간 리포트(${lastMonth}) 건너뜀 — 그 달 측정 기록 없음`);
if (mode === 'weekly' || (mode === 'auto' && wk && !has(`잠스쿨_주간리포트_${lastSunday}.pdf`))) step(`주간 리포트(${addDays(lastSunday, -6)} ~ ${lastSunday})`, ['tools/monitor/report.mjs', '--period', 'week', '--end', lastSunday]);
if (mode === 'monthly' || (mode === 'auto' && mo && !has(`잠스쿨_월간리포트_${lastMonth}.pdf`))) step(`월간 리포트(${lastMonth})`, ['tools/monitor/report.mjs', '--period', 'month', '--month', lastMonth]);
log('끝');
