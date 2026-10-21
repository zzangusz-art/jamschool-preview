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
| `tools/blog-ai/generate.mjs` | AI 글 작성·검증 |
| `tools/export-site.mjs` | 서빙 파일만 `_site/` 로 내보내기 (`--preview` 면 noindex) |
| `.github/workflows/site.yml` | 푸시·예약 시 빌드 → GitHub Pages 배포, 예약 시 AI 글 1편 |
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

## 수면 가이드 (블로그)
- 글 추가: `content/blog/<slug>.md` 를 만들고 빌드. 머리말 필수 항목 `title` `description` `slug` `date` `category`(구매 가이드·사용 팁·제품 이야기·생활 공간), 선택 `tags` `product`(29 등) `author`
- 본문 `## 자주 묻는 질문` 아래 `### Q. 질문` + 답 문단은 글 하단 FAQ 아코디언과 FAQPage 구조화 데이터가 된다. `##` 제목이 3개 이상이면 목차가 붙는다
- 홈 `#blog` 섹션에는 최신 3편, `sitemap.xml`·`llms.txt`·RSS에 자동 추가
- 검증만: `node tools/blog-ai/generate.mjs --check` (모든 글을 아래 규칙으로 검사)

### AI 자동 발행
GitHub Actions가 **월·목 오전 10시(KST)** 에 `_topics.json` 의 다음 `todo` 주제로 글 1편을 쓰고, 검증을 통과하면 `content/blog/` 에 커밋해 바로 배포한다.
- 처음 한 번: GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret → 이름 `ANTHROPIC_API_KEY`. 키가 없으면 글 작성 단계만 건너뛰고 배포는 정상 진행
- 지금 1편 쓰기: 저장소 Actions 탭 → site → Run workflow (`수면 가이드 글 1편 AI 작성` 체크)
- 로컬에서: `set ANTHROPIC_API_KEY=...` 후 `npm ci` → `node tools/blog-ai/generate.mjs` (특정 주제는 `--topic <id>`)
- 모델 `claude-opus-5-5`, 서버 측 폴백(`fallbacks: "default"`) 사용 — 기본 모델이 일시적으로 응답하지 못하면 Anthropic이 다른 모델로 대신 처리할 수 있음
- 사실 근거는 `assets/js/data.js` 에서 뽑은 팩트 시트뿐. 검증 규칙: 머리말 형식, 본문 800~4,500자, `##` 3개 이상, FAQ 2개 이상, 의료 효과·최상급·보장 표현 금지, 타사 브랜드명·외부 링크 금지, 팩트 시트에 없는 숫자+단위 금지. 한 번 고쳐 쓰게 하고도 실패하면 `content/drafts/` 에 남기고 주제는 `draft` 로 표시
- 주제 추가: `_topics.json` 에 `{ "id", "title", "angle"(다룰 내용·주의점), "category", "keywords", "status": "todo" }` 를 넣으면 순서대로 쓴다
- 발행 전 사람 검토를 원하면 `site.yml` 의 예약(schedule)을 지우고 필요할 때 Run workflow 로 돌린 뒤 결과를 확인

## 배포 (GitHub Pages)
이 폴더가 곧 git 저장소다(`zzangusz-art/jamschool-preview`, 소스만 올리고 빌드 결과물은 `.gitignore`).
- 반영: 상위 폴더 `deploy-preview.bat` 더블클릭 → 빌드·글 검증 → 커밋 → AI가 올린 글 받아오기(`git pull --rebase`) → 푸시 → Actions가 빌드해 2~3분 뒤 https://zzangusz-art.github.io/jamschool-preview/ 반영
- 미리보기 배포는 `export-site.mjs --preview` 로 모든 페이지 noindex·robots Disallow. 운영 도메인에 올릴 때는 `node build.mjs` 후 `node tools/export-site.mjs <폴더>` (preview 옵션 없이)
- AI가 GitHub에서 글을 커밋하므로, 로컬에서 작업하기 전에 `git pull` 로 받아 두면 충돌이 없다

## 주문·결제
흐름: 전체 상품(`shop.html`, `?cat=mattress|bedding`) → 상품 상세 → 장바구니(`cart.html`) 또는 바로 구매 → 주문서(`checkout.html`) → 주문 완료(`order-complete.html`).
- 장바구니·찜·최근 본 상품은 브라우저 저장(localStorage). 바로 구매 상품과 주문 완료 요약은 sessionStorage(개인정보는 가린 값만, 30분 뒤 안 보임)
- 주문서 금액은 저장된 값이 아니라 `data.js` 상품 가격으로 다시 계산
- 결제 방식은 `assets/js/data.js` 의 `CHECKOUT.mode`
  - `preview`(지금): 주문서 검증까지 진행 → 결제 버튼은 "미리보기라 결제되지 않음" 안내 + 상품별 공식몰·네이버페이 링크 + 주문 완료 화면 미리보기(상단에 '실제 주문 아님' 표시)
  - `handoff`: 자체 결제 없이 운영할 때. 구매하기·주문하기 → 공식몰/네이버페이 선택 창
  - `pg`: PG 계약 후. `checkout.js` 의 `requestPayment()` 에 결제창 호출을 넣고, **결제 승인과 금액 검증은 서버에서**(정적 사이트만으로는 안 됨). 결제가 끝나면 주문한 상품만 장바구니에서 빠짐
- 주소 검색은 다음(카카오) 우편번호 서비스를 버튼 누를 때만 불러오고, 못 불러오면 직접 입력으로 바뀜
- 결제 수단·배송비·적립률·쿠폰·택배사는 `CHECKOUT` 에서 수정. 제주·도서산간 추가 배송비 금액은 공식몰에 없어 금액 없이 안내 문구만 띄움
- 주문서 동의 문구(개인정보 수집·이용, 매트리스 압축 포장 반품 안내)는 운영 전에 고객사 개인정보처리방침과 맞춰 확인할 것

## 영상 다시 만들기
`../motion/render.bat` — 3D 장면(three.js)을 headless Chrome으로 프레임 렌더 → ffmpeg 인코딩. 원본 마스터는 `../motion/masters/`.
웹용 재인코딩:
```
ffmpeg -i hero_1920x1080_master.mp4 -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -g 30 -an -movflags +faststart assets/video/hero-desktop.mp4
```
