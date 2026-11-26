// 발송용 엑셀 — 어드민 '결제 주문'에서 고른 결제 완료 주문을 택배사·3PL 양식으로(tools/admin/xlsx.mjs)
//   택배 접수용: 주문 1건 = 1줄(받는 분·연락처·주소·물품명·수량·배송메세지). 로젠 iLOGEN '주문등록/출력(복수건)'은 엑셀 열과 항목을
//     한 번 짝지어 '엑셀 타입'으로 저장해 두고 쓰는 방식이라, 열 이름을 택배 용어(수하인 등)에 맞춰 두었다. 대신택배 등도 같은 방식
//   3PL 발주서: 업체 발주서 샘플(2026-11-19 받음)과 같은 열 — 받는분(이름 뒤 판매처 표시, 예: 홍길동(공))·우편번호·주소 전체·전화·기타연락처·운임구분·(빈 칸)·품목명·품목명·배송메세지1·주문번호.
//     수량 열이 없어 상품 1개 = 1줄. 품목명은 상품별 3PL 이름 + 두께형(cm)_사이즈 / 색상(tools/pay/fulfil.mjs tplItemName, 이름·판매처 표시는 어드민 '배송 설정')
//   전체 정보: 주문 1건 = 1줄, 결제·주문자·받는 분 전부(보관·정산 확인용)
import { xlsx } from '../admin/xlsx.mjs';
import { srcText } from '../admin/stats.mjs';   // '전체 정보' 엑셀의 유입 경로 열

const tel = t => { const d = String(t || '').replace(/\D/g, ''); return d.replace(/^(02)(\d{3,4})(\d{4})$/, '$1-$2-$3').replace(/^(0\d{2})(\d{3,4})(\d{4})$/, '$1-$2-$3') || d; };
const mobile = t => /^01\d/.test(String(t || '').replace(/\D/g, '')) ? tel(t) : '';
const kdt = iso => iso ? new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '';
const nm = x => `${x.gname || x.name}${x.opt ? ` (${x.opt})` : ''}`;
const COURIER = { logen: '로젠택배', daesin: '대신택배', cj: 'CJ대한통운', hanjin: '한진택배', lotte: '롯데택배', epost: '우체국택배', kdexp: '경동택배', etc: '기타' };
const quota = q => !q || +q === 0 ? '일시불' : `${+q}개월`;

export const FORMATS = {
  courier: { label: '택배 접수용 — 로젠·대신 등(주문 1건 = 1줄)', name: '택배접수' },
  '3pl': { label: '3PL 발주서 — 받는분·품목명(상품 1개 = 1줄)', name: '3PL발주서' },
  full: { label: '전체 정보 — 보관·정산 확인용', name: '주문전체' },
};

// ctx = { J: 사이트 데이터, cfg: 배송 설정, tplName(item, J, cfg) } — 어드민이 넘긴다(없으면 기본 이름)
export function shipRows(orders, format, ctx = {}) {
  const cfg = ctx.cfg || { from: {}, tpl: { suffix: '', fare: '1' } }, from = cfg.from || {};
  const tplName = x => ctx.tplName && ctx.J ? ctx.tplName(x, ctx.J, cfg) : nm(x);
  if (format === '3pl') return {
    widths: [12, 14, 77, 14, 15, 8, 8, 54, 7, 24, 24],
    rows: [['받는분', '받는분우편번호', '받는분주소(전체, 분할)', '받는분전화번호', '받는분기타연락처', '운임구분', '', '품목명', '품목명', '배송메세지1', '주문번호'],
      ...orders.flatMap(o => o.items.flatMap(x => Array.from({ length: Math.max(1, x.qty) }, () => [`${o.receiver.name}${(cfg.tpl || {}).suffix || ''}`, o.receiver.zip, `${o.receiver.addr1} ${o.receiver.addr2}`.trim(),
        tel(o.receiver.tel), tel(o.receiver.tel), +((cfg.tpl || {}).fare || 1) || 1, '', tplName(x), '', o.receiver.memo || '', o.moid])))],
  };
  if (format === '3pl-old') return {
    widths: [24, 17, 17, 22, 28, 36, 6, 10, 15, 9, 44, 24, 26, 10, 15, 11, 12],
    rows: [['주문번호', '주문일시', '결제일시', '상품코드', '상품명', '옵션', '수량', '받는분', '받는분 연락처', '우편번호', '주소', '상세주소', '배송메시지', '주문자', '주문자 연락처', '상품 금액', '제주·도서산간'],
      ...orders.flatMap(o => o.items.map(x => [o.moid, kdt(o.createdAt), kdt(o.paidAt), x.key || String(x.id), x.gname || x.name, x.opt || '', x.qty,
        o.receiver.name, tel(o.receiver.tel), o.receiver.zip, o.receiver.addr1, o.receiver.addr2, o.receiver.memo || '', o.buyer.name, tel(o.buyer.tel), x.price * x.qty, o.receiver.jeju ? 'Y' : '']))],
  };
  if (format === 'full') return {
    widths: [24, 17, 17, 10, 12, 12, 14, 8, 11, 11, 8, 50, 10, 15, 24, 10, 15, 9, 44, 24, 26, 12, 11, 16, 10, 40],
    rows: [['주문번호', '주문일시', '결제일시', '상태', '배송 단계', '결제수단', '카드', '할부', '승인번호', '결제 금액', '배송비', '상품', '주문자', '주문자 연락처', '주문자 이메일', '받는분', '받는분 연락처', '우편번호', '주소', '상세주소', '배송메시지', '제주·도서산간', '택배사', '송장번호', '환불액', '유입 경로'],
      ...orders.map(o => { const pg = o.pg || {}; return [o.moid, kdt(o.createdAt), kdt(o.paidAt), o.statusName || o.status, ({ new: '신규 주문', prep: '상품 준비 중', shipped: '배송 중', delivered: '배송 완료' })[(o.fulfil || {}).status || 'new'], o.payLabel || '',
        pg.cardName || '', pg.cardName ? quota(pg.cardQuota) : '', pg.authCode || '', o.amount, o.ship || 0, o.items.map(x => `${nm(x)} × ${x.qty}`).join(', '),
        o.buyer.name, tel(o.buyer.tel), o.buyer.email || '', o.receiver.name, tel(o.receiver.tel), o.receiver.zip, o.receiver.addr1, o.receiver.addr2, o.receiver.memo || '', o.receiver.jeju ? 'Y' : '',
        (o.fulfil || {}).invoice ? COURIER[(o.fulfil || {}).courier] || '' : '', (o.fulfil || {}).invoice || '', (o.refunds || []).reduce((a, r) => a + (r.amount || 0), 0), o.src && o.src.last ? srcText(o.src.last) : '']; })],
  };
  return {
    widths: [24, 10, 15, 15, 9, 60, 50, 6, 30, 12],
    rows: [['주문번호', '수하인명', '수하인전화', '수하인휴대폰', '우편번호', '수하인주소', '물품명', '수량', '배송메세지', '제주·도서산간', '송하인명', '송하인전화', '송하인우편번호', '송하인주소'],
      ...orders.map(o => [o.moid, o.receiver.name, tel(o.receiver.tel), mobile(o.receiver.tel), o.receiver.zip, `${o.receiver.addr1} ${o.receiver.addr2}`.trim(),
        o.items.map(x => `${nm(x)} ${x.qty}개`).join(', '), o.items.reduce((a, x) => a + x.qty, 0), o.receiver.memo || '', o.receiver.jeju ? 'Y' : '',
        from.name || '', tel(from.tel), from.zip || '', `${from.addr1 || ''} ${from.addr2 || ''}`.trim()])],
  };
}
export function shipExport(orders, format, ctx = {}) {
  const f = FORMATS[format] ? format : 'courier', { rows, widths } = shipRows(orders, f, ctx);
  const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/-/g, '').replace('T', '-').replace(':', '');
  return { name: `잠스쿨_${FORMATS[f].name}_${stamp}_${orders.length}건.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf: xlsx(FORMATS[f].name, rows, { widths }) };
}
