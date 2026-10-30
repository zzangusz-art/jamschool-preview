# 잠스쿨 공식홈 (정적 사이트)

## 미리보기
```
python -m http.server 5517 --directory jamschool-site
```
브라우저에서 http://localhost:5517 (영상·시퀀스 이미지는 파일 직접 열기(file://)보다 서버로 확인)

## 구조
| 경로 | 내용 |
|---|---|
| `index.html` | 홈 (빌드 결과물 — 직접 고치지 말 것, git에 올리지 않음) |
| `product-<id>.html` | 상품 상세 10종 (빌드 결과물) |
| `blog/` | 수면 가이드 목록·글·RSS(`feed.xml`) (빌드 결과물) |
| `shop.html` · `cart.html` · `checkout.html` · `order-complete.html` | 전체 상품(진열)·장바구니·주문서·주문 완료 (빌드 결과물, 장바구니 이후는 noindex) |
| `src/index.tpl.html`, `src/product.tpl.html` | 페이지 템플릿 |
| `src/page.tpl.html`, `src/pages/*.html` | 진열·장바구니·주문서·주문 완료 공용 틀과 본문 |
| `src/blog-index.tpl.html`, `src/blog-post.tpl.html` | 블로그 목록·글 템플릿 (`<base href="../">`) |
| `content/blog/*.md` | **블로그 글 원고** (머리말 `key: value` + 마크다운). `_topics.json` 은 AI가 쓸 주제 대기열 |
| `content/drafts/` | 검증을 통과하지 못한 AI 초안 (발행 안 됨, 사람이 고쳐서 `content/blog/` 로 옮기면 발행) |
| `tools/blog/lib.mjs` | 머리말·마크다운 변환, `## 자주 묻는 질문` → FAQ 아코디언·FAQPage |
| `tools/blog-ai/generate.mjs` | AI 글 작성·검증(대표 키워드·중복 검사) |
| `tools/blog/thumb.mjs` | 글 썸네일 1200×630 생성(Chrome + puppeteer-core) → `assets/img/blog/` |
| `tools/export-site.mjs` | 서빙 파일만 `_site/` 로 내보내기 (`--preview` 면 noindex) |
| `.github/workflows/site.yml` | 푸시·예약 시 빌드 → GitHub Pages 배포, 매일 3번(KST 09·13·18시) AI 글 1편씩 + 썸네일 |
| `assets/js/shop-core.js` | 쇼핑 공용(빠른 보기·3단 옵션·장바구니 담기·최근 본 상품·주문서로 넘기기) — 모든 페이지에서 ui.js 다음에 불러옴 |
| `assets/js/shop.js` · `cart.js` · `checkout.js` · `complete.js` | 진열(분류·정렬·찜) · 장바구니(선택·옵션 변경·되돌리기) · 주문서(검증·우편번호·결제 수단) · 주문 완료 |
| `assets/css/shop.css` | 진열·장바구니·주문서·주문 완료 스타일 |
| `assets/css/sections.css` | 기능·롤링 후기·가격·왜 잠스쿨·블로그 섹션 스타일 |
| `src/partials/` | 헤더·푸터·모달/드로어/시트·SVG 아이콘 |
| `assets/js/data.js` | **상품·가격·옵션·리뷰·FAQ·시험성적 — 내용 수정은 여기 한 곳** |
| `assets/js/render.js` | 브라우저/빌드 공용 마크업 함수 |
| `assets/js/ui.js` | 모달·드로어·바텀시트·토스트·아코디언·탭·장바구니·라이트박스 |
| `assets/js/home.js` | 히어로 스크롤 연출, 접기 시퀀스, 상품 필터·빠른보기, 사이즈 추천 |
| `assets/js/product.js` | 갤러리, 옵션 선택, 구매바, 탭 스크롤스파이, 상세 접기, 상세 유튜브 |
| `assets/js/detail-<id>.js` | 상품별 상세 이미지 목록(순서·크기·대체텍스트, 제외·부분 삭제 사유는 파일 머리 주석). 빌드 전용 |
| `assets/img/**/*.webp` | jpg/png 마다 같은 이름의 WebP. 페이지는 `<picture>`로 WebP를 쓰고 원본은 폴백 |
| `assets/img/detail/<id>/` | 상세 이미지 (NN = 공식몰 상세의 N번째) |
| `assets/video/` | 히어로 영상(데스크톱 16:9 / 모바일 9:16)과 포스터, `detail/` 상세 GIF를 바꾼 MP4 루프+포스터 |
| `assets/seq/`, `assets/seq-m/` | 접기 스크롤 시퀀스 100프레임 (PC 1000px / 모바일 640px) |
| `sitemap.xml`, `robots.txt`, `llms.txt` | 빌드 시 자동 생성 |

## 수정 → 반영
1. `assets/js/data.js` 또는 `src/` 템플릿 수정
2. `build.bat` 더블클릭 (또는 `node build.mjs`)
3. 정적 HTML·구조화 데이터(JSON-LD)·sitemap·llms.txt·블로그가 같이 갱신됨

FAQ·시험 결과·스펙 표·리뷰는 HTML 원문에 들어가 있어 JS 없이도 검색엔진·AI가 읽습니다.

### 이미지를 추가·교체했을 때
`assets/img` 에 jpg/png를 넣었다면 빌드 전에 WebP를 만든다(이미 만든 건 건너뜀). 빌드는 WebP가 없는 파일을 경고하고 그 이미지는 원본 `<img>`로 내보낸다.
```
python ../motion/tools/to_webp.py assets/img
```

### 상세 이미지를 공식몰에서 다시 받을 때
공식몰 상세 본문은 페이지 안 `<template id="prodDetailPC">` 에 들어 있어 스크롤 없이 순서대로 받을 수 있다.
```
python ../motion/tools/fetch_detail.py <작업폴더> 30 39 40 43 36 37 38 44 41
python ../motion/tools/prepare_detail.py <작업폴더> .
python ../motion/tools/to_webp.py assets/img
node build.mjs
```
`prepare_detail.py` 안의 EXCLUDE(가격표·이벤트·옛 안내 제외)와 CUT(이미지 일부 삭제) 목록은 공식몰 상세가 바뀌면 다시 확인해야 한다. 250KB 넘는 움직이는 GIF는 MP4 루프로 바꾼다.

### 스마트스토어 상세·썸네일 가져오기
스마트스토어는 자동 접근이 막혀 있고 Claude 브라우저(내장·Claude in Chrome) 모두 접속 불가라, 평소 크롬에서 상품 페이지를 연 상태로 목록만 캡처한다.
1. **북마크 버튼(권장)**: `../motion/tools/smartstore_bookmarklet.html` 을 크롬으로 열어 「잠스쿨 상세캡처」를 북마크바로 끌어다 놓고(처음 한 번), 상품 페이지마다 그 북마크를 누른다. 스니펫을 고치면 `node ../motion/tools/make_bookmarklet.mjs` 로 다시 만들고 북마크도 다시 끌어다 놓기
   - 콘솔로 할 때: 상품 페이지 → F12 → Console → `smartstore_capture_console.js` 전체 붙여넣기 → Enter (`allow pasting` 은 처음 한 번만 입력하고, 그다음 다시 붙여넣기)
2. 자동으로 「상세정보 펼쳐보기」 → 상세 끝까지 스크롤 → 다운로드 폴더에 `smartstore_<상품번호>_<날짜>.json` 저장. 못 찾으면 직접 펼쳐 스크롤 후 `nvDetail.download()` (막히면 `copy(nvDetail.json())`)
3. `python ../motion/tools/smartstore_fetch.py <json> <작업폴더> --id 29` → 썸네일(`thumbs/`)·상세 이미지(`29/`)·`manifest.json`(상세 글은 `t:'t'`)
4. `python ../motion/tools/apply_smartstore.py <작업폴더> . --id 29 --plan <계획.json> --clean` → `assets/img/detail/29/ss-NN.*`·`assets/js/detail-29.js`·썸네일 `assets/img/products/29/ss-NN.jpg`(기존 01~은 홈·스토리·블로그 사진이라 유지). 먼저 `--dry`
   - 계획 파일: 제외 이미지(`exclude`)·부분 삭제(`cut` 픽셀 구간)·뺄 글(`drop_text` 정규식)·쓸 썸네일 순서(`thumbs`). 예시 `../research/smartstore/plan-29.json`·`plan-30.json`·`plan-39.json`
   - 기준: 네이버 전용 행사(넓다세일·알림받기 쿠폰)·현재 판매가와 다른 가격표는 빼고, 증정 이벤트는 그대로. 썸네일에서 스토어 프로필(옛 로고)·영상 썸네일·추가상품 사진은 뺌
5. data.js `imgs: ssGallery(id, 장수)` 로 바꾸고 `python ../motion/tools/to_webp.py assets/img` → 빌드

### 스마트스토어 리뷰 가져오기
- 같은 설치 페이지의 「잠스쿨 리뷰캡처」(`../motion/tools/smartstore_reviews_console.js`): 상품 페이지에서 누르면 리뷰 탭을 열고 지금 정렬(보통 랭킹순) 그대로 1~5쪽(약 100개)을 2~4초 간격으로 넘겨 `smartstore_reviews_<상품번호>_<날짜>.json` 저장(작성자는 가린 아이디, 별점·날짜·옵션·본문·사진 주소·도움돼요 수). 더 필요하면 콘솔 `nvReviews.auto({ pages: 10 })`(최대 20쪽)
- 사이트에 실을 때: 원문 그대로(맞춤법 포함), 가린 아이디·작성일·「스마트스토어 구매평」 출처 표기. 리뷰 사진은 구매자 저작물이라 홍보 활용 동의 여부를 고객사에 확인한 뒤 사용
- 구조화 데이터에는 별점·리뷰를 넣지 않는다(다른 사이트에서 모은 리뷰라 구글 리뷰 스니펫 정책 위반). build.mjs `productLD` 참고

## 수면 가이드 (블로그)
- 글 추가: `content/blog/<slug>.md` 를 만들고 빌드. 머리말 필수 항목 `title` `description` `slug` `date` `category`(구매 가이드·사용 팁·제품 이야기·생활 공간), 선택 `tags` `keyword`(대표 키워드, 글마다 하나·중복 금지) `product`(29 등) `image`(썸네일 `assets/img/blog/<slug>.jpg`) `photo`(썸네일에 쓸 사진 지정) `author`
- 썸네일: `node tools/blog/thumb.mjs` (없는 것만) / `--all` / `<slug>`. 1200×630, 왼쪽 제목(대표 키워드 하늘색)·오른쪽 상품 실사 사진, 카테고리마다 배경색. Chrome 필요(`CHROME_PATH`). 썸네일이 없으면 카드는 글자만, 공유 이미지는 상품 사진
- 키워드 지도: 상위 폴더 `research/keyword-map-2026-10-23.md` (우선 3단 접이식 매트리스·접는 매트리스·토퍼 매트리스 → 상품명 → 신뢰·브랜드, 경쟁사명 금지)
- 본문 `## 자주 묻는 질문` 아래 `### Q. 질문` + 답 문단은 글 하단 FAQ 아코디언과 FAQPage 구조화 데이터가 된다. `##` 제목이 3개 이상이면 목차가 붙는다
- 홈 `#blog` 섹션에는 최신 3편, `sitemap.xml`·`llms.txt`·RSS에 자동 추가
- 검증만: `node tools/blog-ai/generate.mjs --check` (모든 글을 아래 규칙으로 검사)

### AI 자동 발행
GitHub Actions가 **매일 09·13·18시(KST) 하루 3번** `_topics.json` 의 다음 `todo` 주제로 글 1편씩(하루 3편) 쓰고, 검증을 통과하면 썸네일을 만들어 `content/blog/`·`assets/img/blog/` 에 커밋해 바로 배포한다.
- 처음 한 번: GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret → 이름 `ANTHROPIC_API_KEY`. 키가 없으면 글 작성 단계만 건너뛰고 배포는 정상 진행
- 지금 쓰기: 저장소 Actions 탭 → site → Run workflow (`수면 가이드 글 AI 작성` 체크, 글 수 1~3)
- 로컬에서: `set ANTHROPIC_API_KEY=...` 후 `npm ci` → `node tools/blog-ai/generate.mjs --count 3` (특정 주제는 `--topic <id>`)
- 대표 키워드 규칙: 제목·첫 문단에 반드시, 본문 2~10회. 이미 발행된 글과 대표 키워드가 같거나 제목이 비슷하면(글자 2개 묶음 유사도 0.5 이상) 다시 쓰게 하고, 그래도 안 되면 초안으로 남긴다
- 대기열이 비면 자동 발행이 멈춘다(2026-10-23 기준 39편 ≈ 13일). 그 전에 `_topics.json` 에 주제를 더 넣어야 한다
- 모델 `claude-opus-5-5`, 서버 측 폴백(`fallbacks: "default"`) 사용 — 기본 모델이 일시적으로 응답하지 못하면 Anthropic이 다른 모델로 대신 처리할 수 있음
- 사실 근거는 `assets/js/data.js` 에서 뽑은 팩트 시트뿐. 검증 규칙: 머리말 형식, 본문 800~4,500자, `##` 3개 이상, FAQ 2개 이상, 의료 효과·최상급·보장 표현 금지, 타사 브랜드명·외부 링크 금지, 팩트 시트에 없는 숫자+단위 금지. 한 번 고쳐 쓰게 하고도 실패하면 `content/drafts/` 에 남기고 주제는 `draft` 로 표시
- 주제 추가: `_topics.json` 에 `{ "id", "keyword"(대표, 기존과 겹치지 않게), "keywords", "title", "angle"(다룰 내용·주의점), "category", "product", "photo"(선택), "status": "todo" }` 를 넣으면 순서대로 쓴다
- 발행 전 사람 검토를 원하면 `site.yml` 의 예약(schedule)을 지우고 필요할 때 Run workflow 로 돌린 뒤 결과를 확인

## 관리자 어드민 (https://jamschool.kr/admin, `tools/admin/`)
클라이언트가 기술 지식 없이 블로그·상품·상세페이지를 고치고, 관리자(owner)만 설정·계정·기록을 본다. 하나회원권 owner/manager 권한 분리를 참고.
- 구조: `tools/serve.mjs` 가 `/admin`·`/api/admin/*` 을 `tools/admin/server.mjs` 로 넘긴다. 저장 = GitHub 커밋 1개(`store.mjs`, 여러 파일을 한 번에) → Railway·Pages 자동 재배포(약 2분, 화면 오른쪽 위 '사이트 반영' 표시). 원본은 계속 git 하나 — AI 자동 발행·deploy.bat 과 충돌 없음(커밋 직전 최신 위에 다시 올림)
- 클라이언트: 홈(오늘·7일 방문자, 구매 버튼 클릭, AI 유입, 반영 상태·최근 변경), **방문·유입**(`#/traffic/1|7|30`: 방문자·페이지 열림·외부 유입·AI 답변 유입, 날짜별 그래프, 경로·많이 본 페이지·AI 유입·들어온 사이트·기기·검색엔진/AI 로봇), **주문**(`#/orders/…`: 상품 조회 → 구매·장바구니 클릭 → 주문서 제출 → 스마트스토어 이동 흐름, 주문서 금액(참고용), 공식몰·전화·카카오 클릭, 상품별 조회·클릭률·주문서 수량, 고른 결제 수단 — 실제 결제는 스마트스토어 판매자센터), 블로그(새 글·수정·임시저장=사이트에서 내리기·썸네일·본문 사진·미리보기, 타사명·의료 표현·외부 링크는 발행 차단, 키워드·분량은 안내), **상품·상세페이지**(한 상품 안에서 탭 `#/products/<id>` 기본 정보·사진 / `#/products/<id>/detail` 상세페이지. 옛 주소 `#/detail/<id>` 는 탭으로 넘어감 — 이름·짧은 이름·요약·정가/판매가·배지·특징·사진 순서/추가·스마트스토어 링크, 3단은 옵션별 가격표, 상세는 사진·글 순서·이 아래에 추가·빼기·사진 설명)
- 방문 집계(`tools/admin/stats.mjs`, GA4 없이도 보이게): `serve.mjs` 가 html 응답마다 페이지 보기를 세고(봇·헤드리스 크롬은 따로, /admin·/api 제외), 사이트 스크립트(build.mjs `TRACK_JS`)가 클릭·주문서 제출을 `POST /api/t` 로 보냄(미리보기 github.io 에선 안 보냄). 방문자는 (IP+브라우저)를 그날만 쓰는 소금값으로 해시해 하루 중복만 거르고 다음 날 해시·소금값을 버림 — 쿠키·IP·이름·연락처 저장 없음. 저장 `DATA_DIR/analytics/YYYY-MM-DD.json`(볼륨 없으면 메모리 — 재배포 때 0부터, 관리자 화면에 경고). 이벤트는 IP당 1분 60건까지
- 관리자 전용: 소유확인·추적 코드(`src/site-tags.json`), 블로그 자동 발행 대기열(`_topics.json`), 키워드 점검, 작업 기록(커밋), 계정 관리(추가·비밀번호 새로 만들기·삭제), 블로그 글 삭제
- 데이터: 상품 수정값은 `content/site.json`(data.js 원래 값 위에 덮어씀 — 빌드 vm 과 각 페이지 `window.JAM_OVERRIDES`), 상세는 `assets/js/detail-<id>.js`, 글은 `content/blog/<slug>.md`(어드민 글은 `source: admin`, 임시저장은 `draft: true` → 사이트·사이트맵·RSS 제외). 올린 사진은 `assets/img/{blog,products/<id>,detail/<id>}/up-*` (화면에서 1000~1600px JPEG 로 줄여 올림, GIF 그대로)
- 글 규칙은 `tools/blog-ai/rules.mjs` 하나를 생성기와 어드민이 같이 씀. `generate.mjs --check` 는 어드민 글·임시저장 글엔 차단 규칙(타사명·금지 표현·외부 링크)만 적용
- 보안: 저장소가 공개라 계정은 git 에 없음. 비밀번호는 scrypt 해시, 로그인은 SESSION_SECRET 서명 쿠키(12시간, HttpOnly·SameSite=Strict, 재배포돼도 유지, 비밀번호 바꾸면 기존 로그인 끊김), 쓰기 요청은 `X-Jam-Admin` 헤더 필수, IP+아이디 기준 15분 10회 실패 시 잠금, CSP·noindex, robots `Disallow: /admin`
- **Railway 변수(처음 한 번, 값은 상위 폴더 `관리자/관리자_계정.txt`)**: `SESSION_SECRET`, `ADMIN_USERS`(해시만 든 계정 JSON), `GITHUB_TOKEN`(fine-grained, 이 저장소 Contents 읽기·쓰기만), 볼륨을 `/data` 로 붙이고 `DATA_DIR=/data`(계정 추가·비밀번호 변경 가능해짐, 없으면 ADMIN_USERS 읽기 전용), `CANONICAL_HOST=jamschool.kr`
- 계정 다시 만들기: `node tools/admin/make-users.mjs --force` (결과는 저장소 밖 `../관리자/`)
- 화면: 사이트와 같은 Noto Sans KR·잉크색, 왼쪽 메뉴(현황·콘텐츠·관리자 전용 묶음, 휴대폰은 위쪽 막대+메뉴 버튼). `public/admin.css`·`admin.js`(빌드 없음)
- 로컬에서 띄우기(시험): `ADMIN_STORE=local ADMIN_USERS_FILE=../관리자/admin-users.json PORT=5620 node tools/serve.mjs _site` → http://localhost:5620/admin (저장하면 이 폴더 파일을 직접 고치고 빌드, 커밋은 deploy.bat). 실제 파일을 안 건드리려면 `ADMIN_LOCAL_ROOT=<복사본> ADMIN_LOCAL_NOBUILD=1`

## AI 노출도 측정 · 블로그 키워드 점검 · 주간/월간 리포트 (`tools/monitor/`)
하나회원권(`바탕화면/하나회원권 홈페이지/측정/AI검색`) 체계를 옮겼다. 결과는 저장소 밖 상위 폴더 `측정/`·`보고/`.
- 매일: Claude 데스크톱 예약 작업 `jamschool-ai-monitor`(10:40, 앱이 켜져 있을 때 — 꺼져 있으면 다음 실행 때) → `node tools/monitor/run.mjs auto`
  1. `ai-check.mjs`: 질의 12개(`queries.json`: 브랜드·핵심·상품) × 엔진. 검색 결과 화면(네이버·Bing·구글)은 전용 크롬 프로필 창으로 열어 전체 캡처(jpg)+본문/링크 저장. AI 답변(Claude·ChatGPT·Gemini·Perplexity)과 네이버 검색 API(웹문서·블로그)는 공식 API 로 — `측정/.env` 에 키가 있는 엔진만(예시 `측정/.env.example`). 판정: 공식 홈 jamschool.kr / 공식몰·스마트스토어(jamschool.co.kr, healingq) / 상호 언급(질의 문구 제외) / 경쟁사 / 링크 순서(광고 포함). → `측정/AI검색/<날짜>/`(result.json·요약 md·jpg·txt), 누적 `측정/AI검색/추이.csv`
     - 하나회원권 스크립트의 봇 감지 회피 설정(webdriver 숨김·AutomationControlled 끄기·차단 뒤 재시도)과 대화형 AI 웹 화면 자동 조작은 쓰지 않는다. 차단 화면이 나오면 그날 그 엔진은 건너뛰고 `blocked=1` 로 남긴다(Bing '마지막 한 단계' 확인 화면 포함 — 2026-10-30 Bing 11건을 차단으로 고침)
  2. `keyword-check.mjs`: 발행 글 대표 키워드 중복, 제목 유사도(0.5↑), 앞 수식어만 다른 키워드 겹침(뒤에 말을 붙인 롱테일은 의도된 묶음이라 제외), 대기열이 발행 키워드와 겹침, 상품 페이지와 같은 검색어인 글의 상품 링크, 대기열 소진 예상일, 3일 넘게 새 글 없음(자동 발행 멈춤), `generate.mjs --check` → `측정/블로그/키워드점검_<날짜>.md·json`
  3. `capture-pages.mjs`(전후 비교 사진): 새 공식 홈 jamschool.kr(첫 화면·3단 상품·전체 상품·수면 가이드) PC 1440×900·휴대폰 390×844 첫 화면을 매일, 전체 화면은 주 1회(월요일·7일 넘게 없을 때), 이전 사이트 jamschool.co.kr(첫 화면·3단 상품)은 처음 한 번 기준 + 매달 한 번 → `측정/스크린샷/<날짜>/<new|old>_<page>_<pc|mo>[_full].jpg`·`index.json`, 첫 캡처일 `측정/스크린샷/기준.json`(2026-10-30 — 그 전 캡처는 없음). 헤드리스 크롬이라 사이트 방문 집계엔 봇으로 잡힘. 다시 찍기 `--full`, 한쪽만 `--only new|old`
  4. 리포트: 지난주(월~일) 주간 리포트가 없으면 `report.mjs --period week`, 지난달 월간 리포트가 없으면 `--period month` → `보고/잠스쿨_주간리포트_<일요일>.html·pdf`, `보고/잠스쿨_월간리포트_<YYYY-MM>.html·pdf` (KPI·지난 기간 대비, **처음과 지금**(리뉴얼 전 공식몰 ↔ 지금 공식 홈, 공식 홈 첫 캡처 ↔ 기간 마지막 캡처, 검색 결과 화면 첫 측정일 ↔ 기간 마지막 — 차단·오류 없이 측정된 날만), 날짜별 추이, 새로 보이기 시작한 곳 캡처, 질의×엔진 표, 엔진별, 경쟁 브랜드, 블로그 발행·키워드 점검, 다음 할 일). 측정 기록이 없는 기간은 건너뜀
- 수동: `node tools/monitor/run.mjs daily|weekly|monthly`, 한 엔진·질의만 `node tools/monitor/ai-check.mjs --engines naver --queries "잠스쿨,3단 접이식 매트리스"`. 실행 기록 `측정/monitor.log`
- 질의를 바꾸면 `queries.json` 만 고친다(추이는 질의 문자열로 묶이므로 같은 질의는 문구를 바꾸지 말 것)

## 배포 (Railway 운영 jamschool.kr + GitHub Pages 미리보기)
이 폴더가 곧 git 저장소다(`zzangusz-art/jamschool-preview`, 소스만 올리고 빌드 결과물은 `.gitignore`). 푸시 한 번으로 두 곳이 자동 배포된다.
- 반영: 상위 폴더 `deploy.bat` 더블클릭(메시지 지정은 `deploy.bat "메시지"`) → 빌드·글 검증 → 커밋 → AI가 올린 글 받아오기(`git pull --rebase`) → 푸시
- **Claude 작업 완료 시 자동 배포**: 상위 폴더 `.claude/settings.local.json` 의 Stop 훅 → `deploy-hook.mjs` → `deploy.bat --hook`. 소스 변경·안 올린 커밋이 없으면 바로 끝나고(0.3초), 배포했거나 실패하면 한 줄 알림 + `deploy.log`. 끄려면 그 파일의 `hooks` 를 지운다. 경로의 `&` 때문에 cmd 를 직접 부르지 않고 deploy-hook.mjs 를 거친다. deploy.bat 은 cp949·CRLF 로 저장(UTF-8+chcp 65001 이면 한글 주석이 명령으로 읽힘)
- Railway(운영): Railpack 이 `npm ci` → `npm run build`(빌드 + `_site` 내보내기) → `npm start`(`tools/serve.mjs _site`, 의존성 없는 정적 서버: gzip·영상 Range·캐시). 2026-10-29 이전엔 start 명령이 없어 "Railpack failed to prepare the build" 로 실패. 환경변수 `CANONICAL_HOST=jamschool.kr`(www·*.up.railway.app → 301), 미리보기로 쓸 때만 `SITE_NOINDEX=1`
- GitHub Pages(미리보기): Actions 가 `export-site.mjs --preview` 로 모든 페이지 noindex·robots Disallow → https://zzangusz-art.github.io/jamschool-preview/
- 정식 주소(canonical·사이트맵·구조화 데이터)는 `build.mjs` 의 `SITE = https://jamschool.kr/`. 로그인·약관·구매평 링크는 공식몰 jamschool.co.kr 그대로
- 소유확인·추적 코드: `src/site-tags.json` 에 값만 넣고 배포(네이버·구글·Bing 소유확인 메타, GTM, GA4, 네이버 애널리틱스). 빈 항목은 넣지 않음. GTM·GA4 가 있으면 주요 클릭(스마트스토어·N Pay `jam_store_click`, 구매하기 `jam_buy_click`, 장바구니 `jam_cart_click`, 전화 `jam_call_click`, 카카오 `jam_kakao_click`, 공식몰 이동 `jam_mall_click`)을 dataLayer·GA4 이벤트로 보냄. GA4 를 GTM 안에서도 켜면 이중 집계되니 둘 중 하나만
- AI가 GitHub에서 글을 커밋하므로, 로컬에서 작업하기 전에 `git pull` 로 받아 두면 충돌이 없다

## 주문·결제
흐름: 전체 상품(`shop.html`, `?cat=mattress|bedding`) → 상품 상세 → 장바구니(`cart.html`) 또는 바로 구매 → 주문서(`checkout.html`) → 주문 완료(`order-complete.html`).
- 장바구니·찜·최근 본 상품은 브라우저 저장(localStorage). 바로 구매 상품과 주문 완료 요약은 sessionStorage(개인정보는 가린 값만, 30분 뒤 안 보임)
- 주문서 금액은 저장된 값이 아니라 `data.js` 상품 가격으로 다시 계산
- 결제 방식은 `assets/js/data.js` 의 `CHECKOUT.mode`
  - `preview`(지금, PG 연동 전): 주문서 검증까지 진행 → '결제하기'를 누르면 주문서 제출을 집계(`checkout_submit`: 금액·결제 수단·상품 id·수량만)하고 스마트스토어로 이동 — 상품이 하나면 그 상품의 `store` 주소로 바로, 여럿이면 상품별 '스마트스토어에서 결제' 버튼 창. `store` 가 없는 상품은 `CHECKOUT.storeHome`(스마트스토어 첫 화면). 주문서 위 안내는 '결제는 잠스쿨 스마트스토어에서'
  - 결제 수단: 신용·체크카드, 무통장입금, 네이버페이, **카카오페이**(`CHECKOUT.pay`, 선택하면 노란색). PG 붙일 때 같은 id(`kakaopay`)로 결제창 연결
  - `handoff`: 자체 결제 없이 운영할 때. 구매하기·주문하기 → 공식몰/네이버페이 선택 창
  - `pg`: PG 계약 후. `checkout.js` 의 `requestPayment()` 에 결제창 호출을 넣고, **결제 승인과 금액 검증은 서버에서**(정적 사이트만으로는 안 됨). 결제가 끝나면 주문한 상품만 장바구니에서 빠짐
- 주소 검색은 다음(카카오) 우편번호 서비스를 버튼 누를 때만 불러오고, 못 불러오면 직접 입력으로 바뀜
- 결제 수단·배송비·적립률·쿠폰·택배사는 `CHECKOUT` 에서 수정. 제주·도서산간 추가 배송비 금액은 공식몰에 없어 금액 없이 안내 문구만 띄움
- 주문서 동의 문구(개인정보 수집·이용, 매트리스 압축 포장 반품 안내)는 운영 전에 고객사 개인정보처리방침과 맞춰 확인할 것

## 로고
원본: 상위 폴더 `jamschool logo/jamschool logo.ai` (VER.01 컬러 · VER.02 어두운 배경용 · VER.03 흰색 단색, 가로형·세로형).
- `assets/img/brand/logo.png` 헤더·구조화 데이터(VER.01 가로형), `logo-white.png` 푸터(VER.02 가로형), `logo-v.png` 히어로 영상 처음·끝(VER.01 세로형), `symbol.png` 학사모만
- 파비콘 `favicon.ico`·`favicon.svg`·`assets/img/brand/apple-touch-icon.png` 은 학사모 심볼로 만듦
- 블로그 썸네일 하단에도 같은 로고(네이비 배경은 흰색 로고)

## 영상 다시 만들기
`../motion/render.bat` — 3D 장면(three.js)을 headless Chrome으로 프레임 렌더 → ffmpeg 인코딩. 원본 마스터는 `../motion/masters/`.
웹용 재인코딩:
```
ffmpeg -i hero_1920x1080_master.mp4 -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -g 30 -an -movflags +faststart assets/video/hero-desktop.mp4
```
