# 시장·언어 확장 체크리스트

대상: 일본(JP) → 인도(IN) → 사우디(SA). 시장 추가와 언어 추가는 별개 작업.

| 국가   | 시장                                                 | 언어                | 비고         |
| ------ | ---------------------------------------------------- | ------------------- | ------------ |
| 일본   | 도쿄증권거래소 `7203.T` (20분 지연) — 시장 추가 완료 | 일본어 UI + 웹      | 1순위        |
| 인도   | NSE `.NS` (실시간) / BSE `.BO` (15분 지연)           | 없음 (영어)         | 시장만       |
| 사우디 | Tadawul `2222.SAU` (15분 지연)                       | 아랍어는 보류 (RTL) | 수요 확인 후 |

## 0. 착수 전 검증

- [ ] Yahoo 시세·차트·검색 응답 확인 (시장별 대표 종목 3개)
- [x] 시세 지연: 일본 20분, 인도 NSE 실시간·BSE 15분, 사우디 15분 (Yahoo 도움말 기준)
- [x] 일본 종목명: Yahoo는 영어명 → JPX 상장 종목 목록으로 해결 (`data/jp-stocks.json`, 월간 자동 갱신)
- [ ] 인도·사우디 현지어 종목명 필요 여부
- [ ] 시장별 거래 시간·점심 휴장·휴장 요일 정리
- [ ] Cloudflare Web Analytics 국가별 방문자 기준선 기록 (출시 후 비교용)

## 1. 시장 추가

- [ ] `src/shared/markets.js`: id, 통화, 소수 자릿수, 시간대, 거래 요일, 세션(점심 휴장은 세션 2개), 심볼 정규식·정규화, 입력 예시 가격
- [ ] `src/main/markets/index.js`: `createYahooProvider({ market, suffix, exchanges })` 등록
- [ ] 번역: `market.<ID>`, `add.searchPlaceholder.<ID>` (모든 언어) → `npm run check:i18n`
- [x] 시세 지연 표시: `markets.js` `delayMinutes` → 카드에 "N분 지연"
- [ ] 시장이 4개 이상이면 종목 추가 화면이 탭 → 드롭다운으로 자동 전환되는지 확인

## 2. 언어 추가

앱

- [ ] `src/shared/languages.js`: code, label(자기 언어로), locale, dir, sitePath
- [ ] `src/shared/i18n/<code>.js` 전체 번역 → `i18n/index.js` 등록 → `npm run check:i18n`
- [ ] 언어가 4개 이상이면 설정 화면이 드롭다운으로 자동 전환되는지 확인
- [ ] RTL(`dir: 'rtl'`): 패널 내부 배치 전면 점검. 화면 좌·우 도킹은 물리 위치라 별개

웹

- [ ] `site/strings/<code>.json` (메뉴·푸터·다운로드 버튼)
- [ ] `site/pages/<code>/home|guide|releases|privacy.html` 번역 (메타 JSON 포함)
- [ ] 데모 패널 예시 종목을 해당 시장 종목으로
- [ ] `npm run build:site` → hreflang·`og:locale`·언어 전환·sitemap 자동 반영 확인

## 3. 검색·AI 검색 노출

- [ ] `website/llms.txt` 지원 시장·언어·새 페이지 URL (수동 관리)
- [ ] `robots.txt`는 전체 허용이라 수정 불필요. 단 Cloudflare의 AI 봇 차단·관리형 robots.txt 설정이 꺼져 있는지 확인 (GPTBot, ClaudeBot, PerplexityBot)
- [ ] Google Search Console 사이트맵 재제출
- [ ] Bing Webmaster Tools 등록·사이트맵 제출 (ChatGPT 검색·Copilot이 Bing 색인 사용)
- [ ] Cloudflare Crawler Hints (IndexNow) 켜기
- [ ] 일본은 Google·Yahoo! JAPAN(Google 색인) 위주라 추가 작업 없음

## 4. 문서·출시

- [ ] `README.md` 기능, `PRIVACY.md`·개인정보 페이지 데이터 출처
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
- 숫자 표기는 인도식 자릿수(lakh·crore) 고려, 통화 `₹`

사우디

- 거래 일–목, 10:00–15:00 AST (금·토 휴장) — `weekdays: [0, 1, 2, 3, 4]`
- 라마단 기간 거래 시간 변경
- 통화 `SAR`, 아랍어 UI는 RTL
