// 상품 옵션 검사(어드민 '상품 › 옵션' 저장 전) — 구조는 assets/js/data.js 의 JAM.OPT 설명 참고
//   opts = { groups: [{ id, name, note, price, values: [{ id, label, sub?, hex?, img?, off? }] }], prices: { '<가격 묶음 값 id-…>': { price, list, off? } } }
//   묶음 4개·선택지 20개·전체 조합 400개·가격 조합 120개까지. 값 id 는 장바구니 key 에 들어가므로 영문·숫자만(화면에서 자동으로 만든다)
const GID = /^[a-z0-9]{1,8}$/, VID = /^[A-Za-z0-9]{1,12}$/, HEX = /^#[0-9a-fA-F]{6}$/;
const line = (s, max) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, max);
export class OptError extends Error { constructor(msg) { super(msg); this.status = 400; } }
const need = (ok, msg) => { if (!ok) throw new OptError(msg); };
const int = v => (v === '' || v == null ? NaN : Math.round(+String(v).replace(/[,\s원]/g, '')));
export const combos = groups => groups.reduce((acc, g) => acc.flatMap(a => g.values.map(v => [...a, v])), [[]]);

// raw → 깨끗한 opts 또는 null(옵션 없음). 틀리면 OptError(화면에 그대로 보여 줄 문구)
export function cleanOpts(raw, product) {
  if (!raw || !Array.isArray(raw.groups) || !raw.groups.length) return null;
  need(raw.groups.length <= 4, '옵션 묶음은 4개까지 만들 수 있습니다');
  const nImg = (product && product.imgs || []).length;
  const gids = new Set(), names = new Set();
  const groups = raw.groups.map((g, gi) => {
    const id = String(g && g.id || '');
    need(GID.test(id) && !gids.has(id), '옵션 묶음 번호가 잘못됐습니다. 화면을 새로 고친 뒤 다시 저장해 주세요'); gids.add(id);
    const name = line(g.name, 12);
    need(name, `${gi + 1}번째 옵션 묶음의 이름(예: 사이즈·두께·색상)을 넣어 주세요`);
    need(!names.has(name), `옵션 묶음 이름 「${name}」이 겹칩니다`); names.add(name);
    const raws = Array.isArray(g.values) ? g.values : [];
    need(raws.length >= 1, `「${name}」에 선택지를 하나 이상 넣어 주세요`);
    need(raws.length <= 20, `「${name}」 선택지는 20개까지입니다`);
    const vids = new Set(), labels = new Set();
    const values = raws.map((v, vi) => {
      const vid = String(v && v.id || '');
      need(VID.test(vid) && !vids.has(vid), '선택지 번호가 잘못됐습니다. 화면을 새로 고친 뒤 다시 저장해 주세요'); vids.add(vid);
      const label = line(v.label, 20);
      need(label, `「${name}」 ${vi + 1}번째 선택지 이름을 넣어 주세요`);
      need(!labels.has(label), `「${name}」에 같은 이름의 선택지(「${label}」)가 두 개 있습니다`); labels.add(label);
      const out = { id: vid, label };
      const sub = line(v.sub, 20); if (sub) out.sub = sub;
      if (v.hex) { need(HEX.test(v.hex), `「${label}」 색상 칩 색이 잘못됐습니다`); out.hex = v.hex.toUpperCase(); }
      if (v.img !== '' && v.img != null) { const n = int(v.img); need(Number.isInteger(n) && n >= 0 && n < nImg, `「${label}」에 고른 사진이 없습니다(상품 사진 ${nImg}장)`); out.img = n; }
      if (v.off) out.off = true;
      return out;
    });
    return { id, name, note: line(g.note, 40), price: !!g.price, values };
  });
  need(combos(groups).length <= 400, `조합이 ${combos(groups).length}개입니다. 400개 이하가 되게 선택지를 줄여 주세요`);
  const pg = groups.filter(g => g.price), prices = {};
  if (pg.length) {
    const rows = combos(pg);
    need(rows.length <= 120, `가격이 달라지는 조합이 ${rows.length}개입니다. 120개 이하가 되게 줄여 주세요('가격이 달라짐'을 끌 수 있는 묶음은 꺼 주세요)`);
    const src = raw.prices || {};
    for (const vs of rows) {
      const key = vs.map(v => v.id).join('-'), lab = vs.map(v => v.label).join(' · '), r = src[key] || {};
      const price = int(r.price), list = r.list === '' || r.list == null ? price : int(r.list);
      need(Number.isInteger(price) && price >= 100 && price <= 1e7, `「${lab}」 판매가를 100원~1,000만 원 사이로 넣어 주세요`);
      need(Number.isInteger(list) && list >= price && list <= 1e7, `「${lab}」 정가는 판매가보다 작을 수 없습니다(할인이 없으면 비워 두세요)`);
      prices[key] = { price, list, ...(r.off ? { off: true } : {}) };
    }
  }
  return { groups, prices };
}

// 키 순서와 상관없이 같은지 비교(3단 기본값과 같으면 저장하지 않는다)
export const canon = x => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(n => [n, v[n]])) : v));
