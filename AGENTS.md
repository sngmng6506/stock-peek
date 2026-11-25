# AGENTS.md

AI·기여자용 작업 규칙. 사용자 소개는 [README.md](README.md).

## 개요

- Windows·Mac 데스크톱 위젯. 화면 가장자리 hover 시 관심 종목 시세 패널 표시
- 데이터: KR 네이버 금융, US·JP·IN·SA 시세 Yahoo Finance (JP 20분·SA 15분 지연, IN은 NSE만), JP 일본어 종목명·검색은 JPX 상장 종목 목록
- 스택: Electron, electron-vite, React 19, `electron-store`
- 계정·증권사 연동 없음

## 명령

```bash
npm install
npm run dev                    # 개발 실행
npm run lint                   # CI는 --max-warnings 0
npm run check:i18n             # 번역 키·자리표시자 누락 검사
npm test                       # 단위 테스트 (tests/*.test.mjs, Electron 없이 도는 순수 모듈만)
npm run build                  # 번들
npm run build:win              # Windows 설치파일 → dist/
npm run build:mac              # Mac dmg·zip → dist/ (macOS에서만)
npm run build:site             # site/ → website/ 생성
npm run check:site             # website/가 최신인지 검사
```

## 구조

```
src/shared/markets.js     시장 정의 (통화·장 시간·심볼 규칙·순서) — main·renderer 공용
src/shared/languages.js   지원 언어 (코드·로케일·방향·사이트 경로)
src/shared/errors.js      오류 코드(ERR_*) 추출·변환
src/shared/i18n/          언어별 번역 (ko.js가 키 기준) — main·renderer 공용
src/main/markets/         시장별 데이터 provider (naver.js, yahoo.js 팩토리, listed.js 현지어 목록+Yahoo, jpx.js, tadawul.js, index.js 등록)
data/jp-stocks.json       JPX 東証上場銘柄一覧 변환본 — 직접 수정 금지 (update-jp-stocks.yml이 매월 갱신)
data/sa-stocks.json       사우디 아랍어 종목명 — 수동 갱신 (Argaam 목록 복사 → scripts/import_sa_stocks.py). 거래소가 자동 수집 차단
src/main/index.js         창·트레이·IPC 핸들러·자동 업데이트
src/main/stockService.js  패널/알림 공유 폴링, lastGood 캐시, 시세·보유 병합
src/main/alertEngine.js  로컬 가격 알림 1회 교차 판정 순수 로직
src/main/alertStore.js   가격 알림 electron-store
src/main/watchlist.js     관심종목 CRUD + 로컬 활동 이력 어댑터
src/main/watchlistRepository.js   관심 목록·보유정보 변경 이벤트 순수 로직 (단일 저장소 전체 쓰기)
tests/activityHistory.test.mjs    활동 이력·baseline·이상/중복 기록 테스트
src/shared/thesisModel.js     투자 관점 순수 계약
src/shared/personalizedPreview.js   로컬 AI 분석 요청 v2 미리보기
src/main/thesisStore.js      투자 관점 로컬 저장 어댑터
src/shared/reportClient.js    리포트 요청 본문 검사·서버 응답 재검증
src/shared/proClient.js       Pro API 클라이언트 (로그인·잔액·충전·리포트, 오류 코드 매핑)
src/main/proSession.js        Pro 세션 토큰 safeStorage 암호화 저장
src/renderer/src/components/ProAccount.jsx  Pro 로그인·잔액·충전 UI
stockpeek-proxy/pro/          Pro API (/v1/*, /pay/*): 인증·크레딧 원장·리포트·토스 결제
tests/helpers/d1.mjs          node:sqlite 기반 D1 대역 (마이그레이션 SQL 그대로 적용)
src/shared/reportArchive.js   생성 리포트 로컬 스냅샷 보관 순수 로직
src/shared/reportHtml.js      A4 리포트 HTML (4개 언어, JavaScript 없음) + PDF 페이지 수
src/main/reportStore.js       리포트 보관 electron-store 어댑터
src/main/reportWindow.js      리포트 보기 창·printToPDF(A4, 여러 장 허용)
tests/personalizedPreview.test.mjs  데이터 포함 선택 및 미리보기 테스트
server/p4/                P4 공식 공시 메타데이터/서버 측 모델 프로토타입 (Electron에 번들 금지)
stockpeek-proxy/           Cloudflare Worker 소스 (운영 Worker는 별도 배포; quote/search 보존)
scripts/check-proxy-sync.mjs  server/p4/와 stockpeek-proxy/lib/ 동일성 검증
scripts/p4-analyze.mjs      수동 개발자 테스트용 CLI (인증된 사용자 API 아님)
docs/p4-pipeline.md         P4 설정·현황·운영 제한
src/main/preferences.js   도킹·언어·welcome 설정
src/preload/index.js      contextBridge IPC 화이트리스트
src/renderer/src/         App.jsx, components/, i18n/ (Provider), lib/ (금액 포맷·오류 번역)
site/                     웹사이트 원본 (site.json, strings/<lang>.json, pages/<lang>/<page>.html, llms.md)
website/                  생성 결과 — HTML·sitemap·llms.txt 직접 수정 금지 (demo.js, style.css, robots.txt, 이미지는 직접)
scripts/                  prepare-release.mjs, build-site.mjs, check-i18n.mjs, update_jp_stocks.py, import_sa_stocks.py, download_stats.py
docs/market-expansion.md  시장·언어 추가 체크리스트
docs/ipc.md               IPC 채널 입력·출력·오류 코드
docs/stock-peek-pro.md    Pro·AI 크레딧 통합 제품/아키텍처 설계 (기준 정책)
docs/design-system.md     패널 UI 색상·글꼴·간격·컴포넌트 값
```

## 규칙

- HTTP: `eFetch`(`src/main/markets/http.js`, Electron `net.fetch`)만 사용. Node `fetch`는 시스템 프록시·인증서를 무시해 사내망에서 실패
- 시장·언어 하드코딩 금지: `'KR'`, `'원'`, `'ko-KR'` 같은 분기 대신 `src/shared/` 레지스트리와 `lib/format.js` 사용
- 활동 이력: `watchlist.items`와 `watchlist.activityHistory`는 `store.store = {...}` **한 번에 저장**. 종목 삭제는 매도가 아니며 보유정보 수정도 매수·매도 거래가 아니다. 기본 목록 초기 상태는 `baseline_imported`로만 기록하고 과거 이력을 추정하지 않는다.
- 시세 병합: `{...quote, ...holding}` 순서 유지. 사용자 입력(수량·평단)이 API 값에 덮이면 안 됨
- 네트워크 실패: `lastGood` 값 유지 + stale 표시
- 가격 알림: 유효한 새 `marketAt` 거래 시각이 있는 시세만 판정; `stale`/오류/장시간 이전 시세로 발송 금지. 처음 관측 가격이 목표측이어도 즉시 알리지 않음; 반대측→목표측 교차에서 1회 발송. Pro 과금 미적용.
- 폴링: 관심 종목이 있는 시장 중 하나라도 장중이면 3초, 아니면 60초. 장 시간은 `Intl` 시간대로 판정(서머타임 자동), 공휴일 미반영. 차트 10분 캐시
- 멀티모니터: `displayId` 저장, 해당 모니터 없으면 primary로 폴백
- IPC 추가: `main/index.js` 핸들러, `preload/index.js` 화이트리스트, `docs/ipc.md` 같이 수정
- UI 문구: `src/shared/i18n/ko.js`에 키 추가 후 모든 언어 파일에 같은 키. `{v}`·`{n}` 자리표시자는 언어 간 동일
- main 오류: 문구 대신 코드(`ERR_*`)로 던지고 화면에서 `errorText()`로 번역. 외부 API 오류 문구는 `codedError`로 코드로 바꿈
- UI 색상·크기 변경: `docs/design-system.md` 같이 수정
- 미니멀: 기능 추가보다 제거·단순화 우선
- Mac: Apple 서명·공증 없음(ad-hoc). 자동 설치 불가 → `IS_MAC`이면 새 버전 알림 + 다운로드 페이지만. Dock 숨김(`LSUIElement`), 메뉴 막대는 `resources/trayTemplate*.png`
- 사용자 수 집계: 하루 한 번 최신 릴리즈의 `ping-win`/`ping-mac`(1바이트)만 받음 (`dailyPing`). 식별자·사용 정보 전송 금지. 바꾸면 개인정보 페이지 4개 언어·`PRIVACY.md`·`site/llms.md` 같이 수정
- 광고: 앱에는 광고 없음, 웹사이트만 Google AdSense (`site.json` `adsenseClient`). 광고 문구는 "앱 광고 없음"으로 구분. 바꾸면 개인정보 페이지 4개 언어·`PRIVACY.md`·`site/llms.md` 같이 수정
- Pages 프록시: `ANALYSIS_ENABLED` 기본 비활성, `ANALYSIS_TEST_TOKEN`은 Cloudflare Secret, `ANALYSIS_DB` D1 바인딩 필수. 무인증/일일 한도 미설정 상태로 LLM 엔드포인트 열지 않음. 기존 Pages 배포 루트 확인 전 자동 배포 성공 주장 금지.
- P4: OpenDART=`DART_API_KEY`, OpenRouter=`OPENROUTER_API_KEY`; 모델 선택=`P4_MODEL` (기본 `anthropic/claude-sonnet-5.5`). `server/p4/` API 키는 서버 환경변수만 사용. `scripts/p4-analyze.mjs` 입력·출력은 `.private/` 아래에 보관(무시 대상). Electron 앱에서 OpenAI/DART 비밀키 직접 호출 금지. 공시 제목만으로 재무·투자 영향을 확정하지 않는다.
- 비밀값: 토큰·계정 ID·인증서 커밋 금지
- 리포트(P5): 응답은 `normalizeAnalysisResult`로 재검증한 것만 저장·렌더링. PDF는 A4 여러 장 허용, 내용을 자르거나 글자를 줄이지 않는다
- Pro(P6): Windows 전용. 세션 토큰은 main에서만 다루고 `safeStorage`로 암호화 저장, 렌더러·로그에 넣지 않는다. 앱 번들에 서버 비밀값 금지. 크레딧은 `credit_ledger` 추가 전용(UPDATE·DELETE 금지), 금액·지급량은 서버만 정한다. 결제 적립은 `/pay/success`의 토스 승인 결과로만. 서버 플래그(`PRO_ENABLED`·`PRO_PUBLIC`·`PRO_REPORTS_ENABLED`·`PAYMENTS_ENABLED`) 기본 0. 서버 SQL 변경은 `migrations/`에 새 파일 추가
- 리포트 창: 정적 HTML만, `javascript:false`·샌드박스. 데이터 URL 창은 `destroy()` 대신 `close()`로 닫는다(다음 창 로드가 `ERR_FAILED`로 실패함)

## 시장·언어 추가

- 시장: `src/shared/markets.js` 항목 → `src/main/markets/index.js` provider 연결 → `market.<ID>`, `add.searchPlaceholder.<ID>` 번역 → `languages.js` 각 언어 `marketOrder`에 추가 (웹 문구의 나라 순서도 이 순서로)
- 앱 언어: `src/shared/languages.js` 항목 → `src/shared/i18n/<code>.js` → `i18n/index.js` 등록 → `npm run check:i18n`
- 웹 언어: `site/strings/<code>.json` + `site/pages/<code>/*.html` → `npm run build:site`. hreflang·언어 전환·sitemap은 자동
- 세부 항목: `docs/market-expansion.md`

## 배포

| 대상          | 트리거                                | 방식                                                                                                                                       |
| ------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 앱            | main에 앱 파일 push                   | `release.yml`: 패치 버전 증가 → lint·i18n·테스트 → Win 빌드 → Release → Mac 빌드 자산 추가                                                   |
| 웹사이트      | main에 `website/**` push              | Cloudflare Pages Git 연동이 자동 배포 (Actions 아님)                                                                                       |
| 검사          | `src/`·`tests/`·`site/`·`website/` 변경, PR | `check.yml`: 단위 테스트, 번역 키, 생성 결과 최신 여부                                                                                                  |
| Mac 확인      | Release 성공 후 (수동 실행 가능)     | `mac-release-check.yml`: 배포된 zip·dmg를 Apple Silicon·Intel 맥에서 체크섬·universal·ad-hoc 서명·LSUIElement 확인 후 실행 검사 (`SMOKE_APP`). 실행 중 github.com 차단(통계 오염 방지) |
| JP 목록       | 매월 8일 (수동 실행 가능)             | `update-jp-stocks.yml`: JPX 엑셀 → `data/jp-stocks.json` 커밋 → 앱 릴리즈                                                                  |
| 다운로드 배지 | 매일 (수동 실행 가능)                 | `download-badge.yml`: 설치 파일 다운로드 합계(배지) + `ping-*` 관측 간 증가분 → `badges` 브랜치 `downloads.json`·`usage.csv`·`stats-state.json` (실제 구간은 `period_start_utc`~`period_end_utc`) |

- `badges`·`ci-screens` 브랜치는 데이터 저장용 (배지·사용 통계, Mac 스크린샷). 브랜치 정리 때 삭제 금지 (저장소 Rulesets로 삭제 차단)
- 앱 파일: `src/`, `data/`, `resources/`, `build/`, `package*.json`, `electron-builder.yml` 등. 문서·웹사이트만 바뀌면 릴리즈 안 됨
- 릴리즈 워크플로우가 main에 버전 커밋을 push하므로 작업 전 `git pull`
- 빌드 중 main에 웹사이트·문서만 바뀐 커밋이 들어오면 그 위에 버전 커밋을 다시 올림. 앱 파일이 바뀌었으면 다음 실행에 넘김
- 태그 수동 생성 금지. minor·major는 `package.json` 버전을 최신 태그보다 높여서 push
- 실패 시 재시도: Actions → Release → Run workflow. Windows·Mac 자산을 초안에 올리고 모두 준비된 뒤 공개
- `.gitattributes`(eol=lf) 유지. 없으면 Windows 러너에서 CRLF로 lint 실패
- 웹사이트 버전·갱신일: 릴리즈 때 `sync:version`(= `build-site --touch`)이 `site/site.json`과 `website/`를 갱신해 버전 커밋에 포함
- 웹사이트 수정: `site/` 고치고 `npm run build:site` 후 둘 다 커밋
- `website/` 충돌(릴리즈 봇의 버전 갱신과 겹침)은 손으로 풀지 말고 `npm run build:site`로 다시 생성
- CSS·JS 주소의 `?v=`는 `build-site`가 `website/style.css`·`demo.js` 내용 해시로 넣음 → CSS·JS 고친 뒤 `npm run build:site` 필수 (`_headers`가 1년 캐시)
- 언어 자동 이동: 기준 언어 홈(`/`)에서만, 브라우저 언어 기준. 크롤러·사이트 안 이동·직접 고른 언어(`localStorage sp-lang`)는 제외. 생성 스크립트 `languageRedirect()`

## 체크리스트

- `npm run lint`, `npm run check:i18n`, `npm test`, `npm run build` 통과
- 웹사이트 변경 시 `npm run build:site` 후 `npm run check:site`
- 모든 지원 언어 UI 확인
- 좌·우 도킹 hover 동작 확인

- Worker 프록시: `stockpeek-proxy/src/worker.js`가 Worker 진입점. 기존 `/api/stock`, `/api/search` 및 CORS/캐시 계약 유지. P4 인증 라우트는 일반 CORS를 적용하지 않는다. 운영 Worker는 GitHub push만으로 배포되지 않음. Wrangler 배포 전 기존 D1 이름/UUID 및 Secret 바인딩 재확인.
