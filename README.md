# 잠스쿨 공식홈 (정적 사이트)

## 미리보기
```
python -m http.server 5517 --directory jamschool-site
```
브라우저에서 http://localhost:5517 (영상·시퀀스 이미지는 파일 직접 열기(file://)보다 서버로 확인)

## 구조
| 경로 | 내용 |
|---|---|
| `index.html` | 홈 (빌드 결과물 — 직접 고치지 말 것) |
| `product-<id>.html` | 상품 상세 10종 (빌드 결과물) |
| `src/index.tpl.html`, `src/product.tpl.html` | 페이지 템플릿 |
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
3. 정적 HTML·구조화 데이터(JSON-LD)·sitemap·llms.txt가 같이 갱신됨

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

## 미리보기 배포 (GitHub Pages)
https://zzangusz-art.github.io/jamschool-preview/ — 상위 폴더의 `deploy-preview.bat` 더블클릭으로 빌드·복사·푸시(반영 1~2분).
미리보기 사본(`../deploy-preview/`)에만 noindex·robots Disallow를 넣는다. 운영 배포에는 이 폴더(jamschool-site)의 빌드 결과를 쓴다.

## 결제 연동
장바구니는 브라우저 저장(localStorage) 미리보기입니다. ‘주문하기/구매하기’는 공식몰 결제 페이지와 네이버페이(스마트스토어)로 연결됩니다. 자체 결제를 붙이려면 PG 연동이 별도로 필요합니다.

## 영상 다시 만들기
`../motion/render.bat` — 3D 장면(three.js)을 headless Chrome으로 프레임 렌더 → ffmpeg 인코딩. 원본 마스터는 `../motion/masters/`.
웹용 재인코딩:
```
ffmpeg -i hero_1920x1080_master.mp4 -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -g 30 -an -movflags +faststart assets/video/hero-desktop.mp4
```
