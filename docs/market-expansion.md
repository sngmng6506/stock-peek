# 시장·언어 확장 체크리스트

대상: 일본(JP) → 인도(IN) → 사우디(SA). 시장 추가와 언어 추가는 별개 작업.

| 국가   | 시장                    | 언어                | 비고         |
| ------ | ----------------------- | ------------------- | ------------ |
| 일본   | 도쿄증권거래소 `7203.T` | 일본어 UI + 웹      | 1순위        |
| 인도   | NSE `.NS` / BSE `.BO`   | 없음 (영어)         | 시장만       |
| 사우디 | Tadawul `2222.SR`       | 아랍어는 보류 (RTL) | 수요 확인 후 |

## 0. 착수 전 검증

- [ ] Yahoo 시세·차트·검색 응답 확인 (시장별 대표 종목 3개)
- [ ] 시세 지연 시간 확인 (실시간 / 15분 / 20분)
- [ ] 검색이 현지어 종목명을 받는지 (`トヨタ`, `रिलायंस`, `أرامكو`). 영어명만 오면 종목명 소스 별도 필요
- [ ] 시장별 거래 시간·점심 휴장·휴장 요일·공휴일 정리
- [ ] Cloudflare Web Analytics 국가별 방문자 기준선 기록 (출시 후 비교용)

## 1. 시장 추가 (매 시장마다)

데이터 (main)

- [ ] `src/main/api/`에 시장별 fetch/search (Yahoo 접미사 재사용, `yahoo.js` 일반화)
- [ ] `stockService.js` fetch 분기 (`KR`/`US` 하드코딩)
- [ ] `stockService.js` 장중 판정 `anyMarketOpen()`에 시장 시간 추가
- [ ] `watchlist.js` 심볼 정규화 분기
- [ ] `index.js` `search:stocks` IPC 분기
- [ ] 시세 지연이 있으면 카드에 지연 표시

UI (renderer)

- [ ] `AddStockModal.jsx` 시장 탭 2개 → N개 (넘치면 드롭다운), 검색 placeholder
- [ ] `AddStockModal.jsx`·`HoldingEditModal.jsx` 통화 기호 (`₩`/`$` 하드코딩)
- [ ] `StockCard.jsx` 가격·손익 포맷 (`원`, `ko-KR` 하드코딩) → 시장별 통화·로케일
- [ ] `StockCard.jsx` 수량 단위 (`주` 하드코딩)
- [ ] `App.jsx` 카드 그룹 (`kr`/`us` 두 그룹 + 구분선) → 시장 순서 배열로 일반화, 드래그 순서도 같이
- [ ] 시장 표기 라벨 (`add.korea`/`add.us`) 시장별 추가

## 2. 언어 추가 (일본어 등)

앱

- [ ] `i18n/translations.js` 전체 키 번역
- [ ] `preferences.js` 언어 저장 화이트리스트 (`en`/`ko`만 허용 중)
- [ ] OS 언어 감지 2곳: `main/index.js` `resolveLanguage`, `I18nProvider.jsx`
- [ ] `SettingsModal.jsx` 언어 선택 2개 → N개
- [ ] 트레이 메뉴 문구 (`자동 시작`, `종료` 한국어 하드코딩)
- [ ] 업데이트 알림 문구·다운로드 페이지 URL (`index.js`, ko/en 분기)
- [ ] 웰컴·도움말 화면 문구, 숫자·날짜 포맷

웹 (언어당 페이지 4개)

- [ ] `/ja/` 랜딩·가이드·업데이트 내역·개인정보 페이지
- [ ] 기존 모든 페이지에 `hreflang` 추가 (`ko`·`en`·`ja`·`x-default`)
- [ ] `og:locale` / `og:locale:alternate`, JSON-LD `inLanguage`
- [ ] 상단 언어 전환 (`EN` 단일 링크 → 언어 목록)
- [ ] `demo.js` 문구·OS별 다운로드 버튼 라벨 (ko/en만 있음)
- [ ] 데모 패널 예시 종목을 해당 시장 종목으로
- [ ] `scripts/sync-version.mjs` 대상 페이지 목록 (경로 하드코딩)

## 3. 검색·AI 검색 노출

- [ ] `sitemap.xml` 새 URL + 모든 항목의 `xhtml:link` alternate 갱신
- [ ] `robots.txt` — 현재 전체 허용이라 수정 불필요. 단 Cloudflare의 AI 봇 차단·관리형 robots.txt 설정이 꺼져 있는지 확인 (GPTBot, ClaudeBot, PerplexityBot)
- [ ] `llms.txt` 지원 시장·언어·새 페이지 URL
- [ ] Google Search Console 사이트맵 재제출
- [ ] Bing Webmaster Tools 등록·사이트맵 제출 (ChatGPT 검색·Copilot이 Bing 색인 사용)
- [ ] Cloudflare Crawler Hints (IndexNow) 켜기
- [ ] 국가별 검색엔진: 일본은 Google·Yahoo! JAPAN(Google 색인) 위주라 추가 작업 없음
- [ ] FAQ 구조화 데이터를 언어별로

## 4. 문서·출시

- [ ] `README.md` 기능, `AGENTS.md` 지원 시장·하드코딩 위치
- [ ] `PRIVACY.md`·개인정보 페이지 데이터 출처 (Yahoo 시장 추가)
- [ ] 랜딩·가이드 문구 "한국·미국" → 시장 목록
- [ ] 릴리즈 노트에 신규 시장 명시

## 5. 시장별 QA

- [ ] 장중·장외 갱신 주기 전환 (현지 시간 기준)
- [ ] 휴장일·주말에 마지막 가격 유지
- [ ] 통화·자릿수 표기, 손익 계산
- [ ] 검색 → 추가 → 보유 입력 → 드래그 정렬
- [ ] 기존 KR/US 동작 회귀 없음

## 국가별 특이사항

일본

- 거래 9:00–11:30, 12:30–15:30 JST (점심 휴장)
- 종목명: Yahoo는 영어명 위주라 일본어 종목명 소스 필요 여부 확인
- 통화 `¥`, 소수점 없음, 수량 단위 `株`

인도

- 거래 9:15–15:30 IST
- 같은 종목이 NSE·BSE 양쪽 상장 → 검색 결과 중복 처리 (기본 NSE)
- 숫자 표기 `en-IN` (lakh·crore 자릿수), 통화 `₹`

사우디

- 거래 일–목, 10:00–15:00 AST (금·토 휴장) — 주말 로직이 다름
- 라마단 기간 거래 시간 변경
- 통화 `SAR`(﷼), 아랍어 UI는 RTL: 패널·도킹·차트·숫자 배치 전면 대응 필요
