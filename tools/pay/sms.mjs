// 손님 안내 문자(솔라피 SOLAPI) — 주문 단계가 바뀌면 손님 휴대폰으로 알린다(쇼핑몰 공통 방식: 주문 접수·발송(송장·배송 조회)·환불·요청 접수)
//   환경 변수(Railway 에만, 공개 저장소라 코드·커밋에 값을 쓰지 않는다):
//     SOLAPI_API_KEY · SOLAPI_API_SECRET  솔라피 콘솔 › API Key 관리에서 만든 값(비밀)
//     SOLAPI_SENDER                       솔라피에 등록·인증한 발신번호(예: 0212345678)
//   셋 중 하나라도 없으면 보내지 않는다(주문 처리는 그대로). 보내는 것은 기다리지 않고, 실패는 주문 처리 기록에만 남긴다.
//   규격: https://solapi.com/developers/api/authentication-api-key — Authorization: HMAC-SHA256 apiKey, date(ISO 8601), salt(12~64자), signature = HMAC-SHA256(secret, date+salt) hex
//         POST https://api.solapi.com/messages/v4/send-many { messages: [{ to, from, text, type, subject }] } → count.registeredSuccess/registeredFailed
//   문구·켜기는 어드민 '배송 설정 › 손님 안내 문자'(DATA_DIR/orders/msg.json). #{이름} 같은 칸은 보낼 때 채운다
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const URL_SEND = 'https://api.solapi.com/messages/v4/send-many';
const KEY = () => (process.env.SOLAPI_API_KEY || '').trim(), SECRET = () => (process.env.SOLAPI_API_SECRET || '').trim();
const SENDER = () => (process.env.SOLAPI_SENDER || '').replace(/\D/g, '');
const HOST = () => (process.env.CANONICAL_HOST || '').trim().toLowerCase() || 'jamschool.kr';
const log = (...a) => console.log('[sms]', ...a);
export const smsReady = () => !!(KEY() && SECRET() && SENDER());
export const smsStatus = () => ({ ready: smsReady(), key: !!KEY(), secret: !!SECRET(), sender: SENDER() ? SENDER().replace(/^(\d{2,3})\d+(\d{4})$/, '$1-****-$2') : '' });

export const MSG_EVENTS = {
  paid: { label: '결제 완료(주문 접수)', on: true, text: '[잠스쿨] #{이름}님, 주문이 접수되었습니다.\n주문번호 #{주문번호}\n#{상품} #{금액}\n#{출고예정}\n주문·배송 조회 #{조회주소}' },
  shipped: { label: '발송(송장 입력)', on: true, text: '[잠스쿨] #{이름}님, 주문하신 상품을 보냈습니다.\n#{택배사} #{송장번호}\n배송 조회 #{배송조회}\n주문 조회 #{조회주소}' },
  claim: { label: '취소·반품·교환 요청 접수', on: true, text: '[잠스쿨] #{이름}님, #{요청} 요청을 접수했습니다.\n주문번호 #{주문번호}\n처리 상황은 주문 조회에서 보실 수 있습니다.\n#{조회주소}' },
  refunded: { label: '환불(결제 취소)', on: true, text: '[잠스쿨] #{이름}님, #{환불금액}이 환불(결제 취소)되었습니다.\n주문번호 #{주문번호}\n카드사에 따라 영업일 기준 3~7일 걸릴 수 있습니다.' },
  resent: { label: '교환 상품 재발송', on: true, text: '[잠스쿨] #{이름}님, 교환 상품을 보냈습니다.\n#{택배사} #{송장번호}\n배송 조회 #{배송조회}' },
  delivered: { label: '배송 완료(직접 누를 때)', on: false, text: '[잠스쿨] #{이름}님, 상품이 배송 완료되었습니다. 받은 상품에 문제가 있으면 7일 안에 주문 조회에서 반품·교환을 요청해 주세요.\n#{조회주소}' },
};
export const MSG_VARS = ['이름', '주문번호', '상품', '금액', '출고예정', '조회주소', '택배사', '송장번호', '배송조회', '요청', '환불금액'];
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export function msgSettings(dir) {
  const s = readJson(path.join(dir, 'msg.json'), {}), out = {};
  for (const [k, d] of Object.entries(MSG_EVENTS)) out[k] = { label: d.label, on: s[k] && s[k].on != null ? !!s[k].on : d.on, text: s[k] && s[k].text ? s[k].text : d.text, base: d.text };
  return out;
}
export function saveMsgSettings(dir, d, user) {
  const cur = msgSettings(dir), n = {};
  for (const k of Object.keys(MSG_EVENTS)) {
    const v = (d || {})[k] || {}, text = String(v.text ?? cur[k].text).replace(/\r\n?/g, '\n').trim().slice(0, 1000);
    if (!text) { const e = new Error(`${MSG_EVENTS[k].label}: 문구가 비어 있습니다`); e.status = 400; throw e; }
    n[k] = { on: v.on != null ? !!v.on : cur[k].on, text };
  }
  n.at = new Date().toISOString(); n.by = user.id;
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'msg.json'), JSON.stringify(n, null, 1));
  return msgSettings(dir);
}
// #{칸} 채우기 — 모르는 칸은 지운다
export const fill = (text, v) => String(text).replace(/#\{([^}]{1,10})\}/g, (m, k) => v[k] != null ? String(v[k]) : '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
const bytes = s => [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0);   // 문자 길이(한글 2바이트) — 90바이트 넘으면 장문(LMS)

async function solapi(to, text) {
  const date = new Date().toISOString(), salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', SECRET()).update(date + salt).digest('hex');
  const long = bytes(text) > 90;
  const r = await fetch(URL_SEND, { method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `HMAC-SHA256 apiKey=${KEY()}, date=${date}, salt=${salt}, signature=${signature}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ to, from: SENDER(), text, type: long ? 'LMS' : 'SMS', ...(long ? { subject: '[잠스쿨]' } : {}) }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`솔라피 ${r.status} ${j.errorCode || ''} ${j.errorMessage || ''}`.trim());
  const c = j.count || {};
  if (c.registeredFailed > 0 || c.registeredSuccess === 0) throw new Error(`솔라피 접수 실패 ${JSON.stringify(j.failedMessageList || c).slice(0, 160)}`);
  return { ok: true, type: long ? 'LMS' : 'SMS', groupId: j.groupId || '' };
}
// 보내기 — 절대 throw 하지 않는다. to 는 휴대폰 번호(숫자만)
export async function sendSms(to, text) {
  const n = String(to || '').replace(/\D/g, '');
  if (!smsReady()) return { ok: false, skipped: true, error: '문자 연결 안 됨(솔라피 변수 없음)' };
  if (!/^01[016789]\d{7,8}$/.test(n)) return { ok: false, error: '휴대폰 번호가 아님' };
  try { const r = await solapi(n, text); log('보냄', n.slice(0, 3) + '****' + n.slice(-4), r.type); return r; }
  catch (e) { const msg = String(e && e.message || e).replace(SECRET() || '\u0000', '***'); log('실패', msg); return { ok: false, error: msg.slice(0, 200) }; }
}
// 주문 문자 값
const won = n => `${(Math.round(+n || 0)).toLocaleString('ko-KR')}원`;
export function orderVars(o, extra = {}) {
  const first = o.items && o.items[0], more = o.items && o.items.length > 1 ? ` 외 ${o.items.length - 1}건` : '';
  return {
    이름: (o.buyer && o.buyer.name) || '고객', 주문번호: o.moid, 상품: first ? `${first.gname || first.name}${more}` : '', 금액: won(o.amount),
    조회주소: `https://${HOST()}/order-complete.html?o=${encodeURIComponent(o.moid)}&t=${encodeURIComponent(o.token || '')}`, ...extra,
  };
}
export const _test = { solapi, bytes };
