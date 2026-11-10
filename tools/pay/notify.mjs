// 결제 주문 알림(텔레그램 봇) — nicepay.mjs 가 결제 완료(paid) 저장 직후와 '확인 필요'(check) 때 부른다
//   환경 변수(Railway 에만 넣는다. 공개 저장소라 코드·커밋에 값을 쓰지 않는다):
//     NOTIFY_TELEGRAM_TOKEN    BotFather 가 준 봇 토큰(비밀)
//     NOTIFY_TELEGRAM_CHAT_ID  알림 받을 대화방 ID(여러 곳이면 쉼표로). 모르면 비워 두고 봇에게 말을 건 뒤
//                              어드민 '결제 주문' → '대화방 ID 찾기'를 누르면 알려 준다
//   둘 중 하나라도 없으면 보내지 않는다. 결제 처리는 알림을 기다리지 않고(비동기), 실패는 로그만 남긴다.
//   알림 내용: 주문번호·상품·수량·금액·받는 분 이름·어드민 링크. 전화번호·주소·이메일·카드번호는 넣지 않는다.
const API = 'https://api.telegram.org';
const TIMEOUT = 10000;
const TOKEN = () => (process.env.NOTIFY_TELEGRAM_TOKEN || '').trim();
const RAW_CHATS = () => (process.env.NOTIFY_TELEGRAM_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const CHATS = () => RAW_CHATS().filter(s => /^(-?\d{1,20}|@\w{5,32})$/.test(s));
const HOST = () => (process.env.CANONICAL_HOST || '').trim().toLowerCase() || 'jamschool.kr';
const log = (...a) => console.log('[notify]', ...a);
const hide = s => { const t = TOKEN(); s = String(s ?? ''); return t ? s.split(t).join('***') : s; };   // 로그에 토큰이 섞이지 않게
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const won = n => `${String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
export const adminLink = moid => `https://${HOST()}/admin#/payments/${encodeURIComponent(moid)}`;

async function tg(method, body) {
  const r = await fetch(`${API}/bot${TOKEN()}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(`텔레그램 ${r.status} ${j.description || ''}`.trim());
  return j.result;
}
const sendAll = text => Promise.allSettled(CHATS().map(chat_id => tg('sendMessage', { chat_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } })));

// 알림 문구(HTML). kind: 'paid' | 'check'
export function orderText(o, kind = 'paid', reason = '') {
  const lines = [
    `<b>${kind === 'check' ? '⚠️ [잠스쿨] 결제 확인 필요' : '🛒 [잠스쿨] 새 결제 주문'}</b>`,
    `주문번호 ${esc(o.moid)}`,
    ...(o.items || []).map(x => `· ${esc(x.name)}${x.opt ? ` (${esc(x.opt)})` : ''} × ${esc(x.qty)}`),
    `금액 <b>${won(o.amount)}</b>${o.payLabel ? ` (${esc(o.payLabel)})` : ''}`,
    `받는 분 ${esc((o.receiver && o.receiver.name) || '-')}`,
    ...(kind === 'check' && reason ? [`사유 ${esc(String(reason).slice(0, 200))}`] : []),
    `<a href="${esc(adminLink(o.moid))}">관리자 화면에서 보기</a>`,
  ];
  return lines.join('\n');
}

// 주문 알림 — 절대 throw 하지 않고, 기다리지 않아도 된다(시험용으로 결과 Promise 를 돌려줌)
const INFLIGHT = new Set();
export function notifyOrder(o, kind = 'paid', reason = '') {
  let p;
  try {
    if (!TOKEN() || !CHATS().length) return Promise.resolve({ sent: 0, skipped: true });
    const text = orderText(o, kind, reason);   // 지금 상태로 바로 만든다(보내는 동안 주문이 바뀌어도 상관없게)
    p = sendAll(text).then(rs => {
      const bad = rs.filter(r => r.status === 'rejected');
      if (bad.length) log('실패', o.moid, kind, ...bad.map(r => hide(r.reason && r.reason.message)));
      else log('보냄', o.moid, kind, `${rs.length}곳`);
      return { sent: rs.length - bad.length, failed: bad.length };
    }).catch(e => { log('실패', o.moid, kind, hide(e && e.message)); return { sent: 0, failed: 1 }; });
  } catch (e) { log('실패', o && o.moid, kind, hide(e && e.message)); return Promise.resolve({ sent: 0, failed: 1 }); }
  INFLIGHT.add(p); p.finally(() => INFLIGHT.delete(p));
  return p;
}
export const settled = () => Promise.allSettled([...INFLIGHT]);   // 시험용: 보내는 중인 알림이 끝날 때까지

// ───────── 관리자 어드민: 상태 · 시험 알림(대화방 ID 가 없으면 봇에게 말을 건 대화방을 찾아 준다)
export function notifyStatus() {
  return { channel: 'telegram', token: !!TOKEN(), chats: CHATS().length, badChats: RAW_CHATS().length - CHATS().length };
}
export async function notifyTest(user) {
  if (!TOKEN()) return { ok: false, msg: 'Railway 변수 NOTIFY_TELEGRAM_TOKEN 이 없습니다' };
  try {
    if (!CHATS().length) {
      const ups = await tg('getUpdates', { limit: 100 });
      const seen = new Map();
      for (const u of ups || []) {
        const c = (u.message || u.edited_message || u.channel_post || u.my_chat_member || {}).chat;
        if (c && !seen.has(String(c.id))) seen.set(String(c.id), { id: String(c.id), type: c.type, name: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '' });
      }
      const chats = [...seen.values()];
      return { ok: false, chats, msg: chats.length ? '찾은 대화방 ID 를 Railway 변수 NOTIFY_TELEGRAM_CHAT_ID 에 넣고 다시 배포되면 시험 알림을 보내 보세요'
        : '찾은 대화방이 없습니다. 텔레그램에서 봇에게 아무 말이나 보낸 뒤(그룹이면 봇을 초대한 뒤) 다시 눌러 주세요' };
    }
    const rs = await sendAll(`✅ <b>[잠스쿨] 주문 알림 시험</b>\n이 대화방으로 결제 완료·확인 필요 주문 알림이 옵니다.\n보낸 사람 ${esc(user && user.name)}(${esc(user && user.id)})`);
    const bad = rs.filter(r => r.status === 'rejected').map(r => hide(r.reason && r.reason.message));
    log('시험', user && user.id, bad.length ? `실패 ${bad.join(' / ')}` : `보냄 ${rs.length}곳`);
    return { ok: !bad.length, sent: rs.length - bad.length, msg: bad.length ? `보내지 못함: ${bad.join(' / ')}` : `시험 알림을 ${rs.length}곳에 보냈습니다` };
  } catch (e) { return { ok: false, msg: `텔레그램 요청 실패: ${hide(e && e.message)}` }; }
}
