// 발송용 엑셀 — 어드민 '결제 주문'에서 고른 결제 완료 주문을 택배사·3PL 양식으로(tools/admin/xlsx.mjs)
//   택배 접수용: 주문 1건 = 1줄(받는 분·연락처·주소·물품명·수량·배송메세지). 로젠 iLOGEN '주문등록/출력(복수건)'은 엑셀 열과 항목을
//     한 번 짝지어 '엑셀 타입'으로 저장해 두고 쓰는 방식이라, 열 이름을 택배 용어(수하인 등)에 맞춰 두었다. 대신택배 등도 같은 방식
//   3PL 출고용: 상품 1개 = 1줄(상품코드 = 장바구니 키, 예: 29-12-SS-gray). 업체 양식이 따로 있으면 열을 옮겨 붙이면 된다
//   전체 정보: 주문 1건 = 1줄, 결제·주문자·받는 분 전부(보관·정산 확인용)
import { xlsx } from '../admin/xlsx.mjs';

const tel = t => { const d = String(t || '').replace(/\D/g, ''); return d.replace(/^(02)(\d{3,4})(\d{4})$/, '$1-$2-$3').replace(/^(0\d{2})(\d{3,4})(\d{4})$/, '$1-$2-$3') || d; };
const mobile = t => /^01\d/.test(String(t || '').replace(/\D/g, '')) ? tel(t) : '';
const kdt = iso => iso ? new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '';
const nm = x => `${x.gname || x.name}${x.opt ? ` (${x.opt})` : ''}`;
const quota = q => !q || +q === 0 ? '일시불' : `${+q}개월`;

export const FORMATS = {
  courier: { label: '택배 접수용 — 로젠·대신 등(주문 1건 = 1줄)', name: '택배접수' },
  '3pl': { label: '3PL 출고용(상품 1개 = 1줄)', name: '3PL출고' },
  full: { label: '전체 정보 — 보관·정산 확인용', name: '주문전체' },
};

export function shipRows(orders, format) {
  if (format === '3pl') return {
    widths: [24, 17, 17, 22, 28, 36, 6, 10, 15, 9, 44, 24, 26, 10, 15, 11, 12],
    rows: [['주문번호', '주문일시', '결제일시', '상품코드', '상품명', '옵션', '수량', '받는분', '받는분 연락처', '우편번호', '주소', '상세주소', '배송메시지', '주문자', '주문자 연락처', '상품 금액', '제주·도서산간'],
      ...orders.flatMap(o => o.items.map(x => [o.moid, kdt(o.createdAt), kdt(o.paidAt), x.key || String(x.id), x.gname || x.name, x.opt || '', x.qty,
        o.receiver.name, tel(o.receiver.tel), o.receiver.zip, o.receiver.addr1, o.receiver.addr2, o.receiver.memo || '', o.buyer.name, tel(o.buyer.tel), x.price * x.qty, o.receiver.jeju ? 'Y' : '']))],
  };
  if (format === 'full') return {
    widths: [24, 17, 17, 10, 8, 12, 14, 8, 11, 11, 8, 50, 10, 15, 24, 10, 15, 9, 44, 24, 26, 12],
    rows: [['주문번호', '주문일시', '결제일시', '상태', '발송', '결제수단', '카드', '할부', '승인번호', '결제 금액', '배송비', '상품', '주문자', '주문자 연락처', '주문자 이메일', '받는분', '받는분 연락처', '우편번호', '주소', '상세주소', '배송메시지', '제주·도서산간'],
      ...orders.map(o => { const pg = o.pg || {}; return [o.moid, kdt(o.createdAt), kdt(o.paidAt), o.statusName || o.status, (o.fulfil || {}).status === 'shipped' ? '발송함' : '발송 전', o.payLabel || '',
        pg.cardName || '', pg.cardName ? quota(pg.cardQuota) : '', pg.authCode || '', o.amount, o.ship || 0, o.items.map(x => `${nm(x)} × ${x.qty}`).join(', '),
        o.buyer.name, tel(o.buyer.tel), o.buyer.email || '', o.receiver.name, tel(o.receiver.tel), o.receiver.zip, o.receiver.addr1, o.receiver.addr2, o.receiver.memo || '', o.receiver.jeju ? 'Y' : '']; })],
  };
  return {
    widths: [24, 10, 15, 15, 9, 60, 50, 6, 30, 12],
    rows: [['주문번호', '수하인명', '수하인전화', '수하인휴대폰', '우편번호', '수하인주소', '물품명', '수량', '배송메세지', '제주·도서산간'],
      ...orders.map(o => [o.moid, o.receiver.name, tel(o.receiver.tel), mobile(o.receiver.tel), o.receiver.zip, `${o.receiver.addr1} ${o.receiver.addr2}`.trim(),
        o.items.map(x => `${nm(x)} ${x.qty}개`).join(', '), o.items.reduce((a, x) => a + x.qty, 0), o.receiver.memo || '', o.receiver.jeju ? 'Y' : ''])],
  };
}
export function shipExport(orders, format) {
  const f = FORMATS[format] ? format : 'courier', { rows, widths } = shipRows(orders, f);
  const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/-/g, '').replace('T', '-').replace(':', '');
  return { name: `잠스쿨_${FORMATS[f].name}_${stamp}_${orders.length}건.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf: xlsx(FORMATS[f].name, rows, { widths }) };
}
