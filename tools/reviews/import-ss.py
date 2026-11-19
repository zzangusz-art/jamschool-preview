# 네이버 스마트스토어 구매평 엑셀 → 홈페이지 구매평 데이터(content/reviews/<상품번호>.json, summary.json)
#   python tools/reviews/import-ss.py <엑셀 폴더> [--stats]
#   - 스마트스토어 '리뷰 관리 › 엑셀 다운로드' 파일(열: 상품번호·상품명·리뷰구분·구매자평점·포토/영상·리뷰상세내용·…·리뷰글번호·관련리뷰상세내용·전시상태·베스트리뷰)
#   - 같은 리뷰(리뷰글번호)는 한 번만, 블라인드·content/reviews/hidden.json 에 적은 리뷰글번호는 뺀다
#   - 스마트스토어 상품번호 → 홈페이지 상품 번호(SS_MAP). 위탁 판매 상품(체온계·비데 등)과 홈페이지에 없는 상품(커버 단품·전기매트 등)은 뺀다
#   - 주제 분류는 content/reviews/topics.json(글에 그 말이 들어 있으면 그 주제). 주문번호·이름은 저장하지 않는다(아이디는 스마트스토어가 가린 그대로)
import sys, os, re, json, glob, collections, datetime
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(SITE, 'content', 'reviews')
PHOTO_BASE = 'https://phinf.pstatic.net/checkout.phinf/'

SS_MAP = {
    '4673873956': 30, '9511832839': 30, '9536009718': 30,       # 떡실신 매트리스(8cm)
    '7338124791': 29, '9536059413': 29,                         # 3단 접이식 매트리스
    '5649123568': 39, '9511840840': 39,                         # 폭신탄탄 양면 매트리스
    '4673889625': 40, '4673903078': 40,                         # 엄마품 메모리폼 토퍼
    '10833749947': 43,                                          # 정착베개
    '5006392148': 36,                                           # 다리베개
    '7339117262': 37,                                           # 거북목 경추 베개(원통)
    '5006420316': 38, '5417612132': 38, '5417092031': 38,       # 삼각 등받이쿠션 S·M·L
    '10321518681': 44,                                          # 듀라론 쿨매트
    '8345177498': 41,                                           # 하픽 손목보호대
}
COLS = ['상품번호', '상품명', '리뷰구분', '구매자평점', '포토/영상', '리뷰상세내용', '리뷰도움수', '등록자', '리뷰등록일', '리뷰글번호', '관련리뷰글번호', '관련리뷰상세내용', '전시상태', '베스트리뷰']

def clean(t, n=4000):
    t = str(t or '').replace('\r\n', '\n').replace('\r', '\n')
    t = re.sub(r'[​-‏  ﻿]', '', t)
    t = re.sub(r'https?://\S+|www\.\S+', '', t)
    t = re.sub(r'01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}', '(전화번호 가림)', t)
    t = re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '(메일 가림)', t)
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r' *\n *', '\n', t)
    t = re.sub(r'\n{3,}', '\n\n', t)
    return t.strip()[:n]

def main():
    if len(sys.argv) < 2: print(__doc__ or '사용: import-ss.py <엑셀 폴더>'); sys.exit(1)
    src, stats = sys.argv[1], '--stats' in sys.argv
    topics = json.load(open(os.path.join(OUT, 'topics.json'), encoding='utf-8'))
    T = {k: re.compile(v['re']) for k, v in topics['topics'].items()}
    hidden = set(json.load(open(os.path.join(OUT, 'hidden.json'), encoding='utf-8'))) if os.path.exists(os.path.join(OUT, 'hidden.json')) else set()
    rows, files = {}, sorted(glob.glob(os.path.join(src, '*.xlsx')))
    for f in files:
        ws = openpyxl.load_workbook(f, read_only=True).worksheets[0]
        it = ws.iter_rows(values_only=True); head = [str(h or '').strip() for h in next(it)]
        ix = {c: head.index(c) for c in COLS if c in head}
        miss = [c for c in COLS if c not in ix]
        if miss: print('열이 없음', os.path.basename(f), miss); sys.exit(2)
        for r in it:
            no = str(r[ix['리뷰글번호']] or '').strip()
            if no: rows[no] = {c: r[ix[c]] for c in COLS}
    out, skipped = collections.defaultdict(list), collections.Counter()
    for no, r in rows.items():
        pid = SS_MAP.get(str(r['상품번호']).strip())
        if str(r['전시상태'] or '') != '정상': skipped['블라인드·숨김'] += 1; continue
        if no in hidden: skipped['어드민에서 숨김'] += 1; continue
        if not pid: skipped[f"홈페이지에 없는 상품 · {str(r['상품명'])[:40]}"] += 1; continue
        text = clean(r['리뷰상세내용'])
        if not text: skipped['내용 없음'] += 1; continue
        d = str(r['리뷰등록일'] or '')
        m = re.match(r'(\d{4})\.(\d{2})\.(\d{2})', d)
        if not m: skipped['날짜 없음'] += 1; continue
        photo = str(r['포토/영상'] or '').strip()
        rec = {'n': int(no) if no.isdigit() else no, 'i': str(r['등록자'] or '').strip()[:20], 'd': f'{m[1]}-{m[2]}-{m[3]}', 's': int(r['구매자평점'] or 5), 't': text}
        if photo.startswith(PHOTO_BASE): rec['p'] = photo[len(PHOTO_BASE):]
        elif photo.startswith('https://'): rec['p'] = photo
        if str(r['리뷰구분'] or '') == '한달사용': rec['m'] = 1
        if str(r['베스트리뷰'] or '') == 'Y': rec['b'] = 1
        h = int(r['리뷰도움수'] or 0)
        if h: rec['h'] = h
        rel = clean(r['관련리뷰상세내용'], 300)
        if rec.get('m') and rel: rec['r'] = rel
        sets = topics['sets'][topics['products'][str(pid)]]
        k = [t for t in sets if T[t].search(text)]
        if k: rec['k'] = k
        out[pid].append(rec)
    # 추천순: BEST > 포토 > 한 달 사용 > 글 길이 > 도움 > 최근(정렬 키는 저장하지 않음)
    score = lambda x: (100 if x.get('b') else 0) + (30 if x.get('p') else 0) + (15 if x.get('m') else 0) + min(len(x['t']), 250) / 5 + min(x.get('h', 0), 20) * 2 + (int(x['d'][:4]) - 2022) * 4
    summary = {'source': '네이버 스마트스토어 구매평', 'files': [os.path.basename(f) for f in files], 'updated': datetime.date.today().isoformat(), 'products': {}, 'skipped': dict(skipped.most_common())}
    os.makedirs(OUT, exist_ok=True)
    for pid, lst in sorted(out.items()):
        lst.sort(key=lambda x: (-score(x), x['d'], str(x['n'])))
        C = collections.Counter(t for x in lst for t in x.get('k', []))
        sets = topics['sets'][topics['products'][str(pid)]]
        days = sorted(x['d'] for x in lst)
        summary['products'][str(pid)] = {
            'total': len(lst), 'photo': sum(1 for x in lst if x.get('p')), 'month': sum(1 for x in lst if x.get('m')), 'best': sum(1 for x in lst if x.get('b')),
            'r5': sum(1 for x in lst if x['s'] == 5), 'r4': sum(1 for x in lst if x['s'] == 4), 'from': days[0], 'to': days[-1],
            'years': dict(sorted(collections.Counter(x['d'][:4] for x in lst).items())),
            'topics': [[t, C[t]] for t in sorted(sets, key=lambda t: -C[t]) if C[t]],
        }
        with open(os.path.join(OUT, f'{pid}.json'), 'w', encoding='utf-8') as fp:
            json.dump(lst, fp, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT, 'summary.json'), 'w', encoding='utf-8') as fp:
        json.dump(summary, fp, ensure_ascii=False, indent=1)
    tot = sum(len(v) for v in out.values())
    print(f'원본 {len(rows)}건(고유) → 홈페이지 {tot}건, 뺀 것 {sum(skipped.values())}건')
    for pid, p in summary['products'].items(): print(pid, p['total'], '포토', p['photo'], '한달', p['month'], 'BEST', p['best'], p['from'], '~', p['to'], ' '.join(f'{topics["topics"][t]["label"]}{n}' for t, n in p['topics'][:8]))
    if stats:
        import random; random.seed(1)
        for pid in ['29', '30', '36']:
            lst = out[int(pid)]
            for t, _ in summary['products'][pid]['topics'][:10]:
                xs = [x for x in lst if t in x.get('k', [])]
                print(f'\n== {pid} {topics["topics"][t]["label"]} ({len(xs)})')
                for x in random.sample(xs, min(3, len(xs))): print('  -', x['t'][:90].replace('\n', ' '))

if __name__ == '__main__':
    main()
