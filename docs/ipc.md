# IPC 명세

main ↔ renderer 계약. 구현: `src/main/index.js` 핸들러, `src/preload/index.js` 화이트리스트(`window.api`). IPC를 추가·변경하면 세 곳을 같이 수정한다.

## 공통

- `invoke`는 Promise를 돌려준다. `send`는 응답이 없다.
- 실패는 `ERR_*` 코드로 던진다. 화면은 `lib/errors.js`의 `errorText()`로 `error.<CODE>`를 번역한다. IPC를 거치면 메시지 앞에 `Error invoking remote method ...` 접두어가 붙으므로 코드만 추출한다.
- 외부 API 오류 문구는 그대로 넘기지 않고 코드로 바꾼다 (`shared/errors.js` `codedError`).
- 종목 키는 `{ market, symbol }`. `market`은 `src/shared/markets.js`의 id, `symbol`은 시장별 `normalizeSymbol` 후 `symbolPattern`을 통과해야 한다.

## 종목 객체 (`Stock`)

| 필드                             | 형식     | 설명                                                              |
| -------------------------------- | -------- | ----------------------------------------------------------------- |
| `market`, `symbol`               | string   | 종목 키                                                           |
| `name`, `localName`, `localLang` | string   | 표시 이름. 현지어 이름이 있으면 `localName`                       |
| `currency`                       | string   | ISO 통화 코드                                                     |
| `price`, `change`, `changeRatio` | number   | 현재가, 전일 대비, 등락률(%)                                      |
| `isUp`                           | boolean  | `change >= 0`                                                     |
| `prices`                         | number[] | 3개월 일봉 종가 (차트, 10분 캐시)                                 |
| `marketAt`                       | string?  | 공급자가 알려주는 가격의 마지막 거래 시각 (ISO 8601); 없으면 알림 차단 |
| `quantity`, `avgPrice`           | number?  | 사용자 입력 보유 정보. 시세보다 우선                              |
| `stale`                          | boolean? | 갱신 실패, 마지막 정상 시세 표시 중                               |
| `error`, `errorCode`             | string?  | 한 번도 시세를 받지 못한 경우만. 화면은 `errorCode`만 번역해 표시 |

## 시세

| 채널               | 방식            | 입력 | 출력                       |
| ------------------ | --------------- | ---- | -------------------------- |
| `stocks:get-cache` | invoke          | —    | `Stock[]` 마지막 결과      |
| `stocks:refresh`   | invoke          | —    | 강제 갱신 (실패 대기 무시) |
| `stocks:update`    | main → renderer | —    | `Stock[]`, 갱신될 때마다   |

## 가격 알림 (P2)

| 채널 | 입력 | 출력 | 설명 |
|---|---|---|---|
| `alerts:list` | — | `Alert[]` | 로컬에 저장된 가격 알림 |
| `alerts:create` | `{market,symbol,direction:'above'|'below',target:number}` | `Alert` | 1회 조건 생성 |
| `alerts:remove` | `id:string` | `Alert[]` | 조건 삭제 |

- `Alert.status`: `waiting` 또는 `triggered` (완료 조건은 자동 재알림하지 않음).
- 가격 알림은 처음 유효한 거래 시세를 기준 상태로 저장하고, 이후 목표와 반대편→목표편 **실제 교차**가 관측되어야 발송한다.
- `marketAt`(시세 제공처 거래 기준 시각) 미확인·오래된 시세·`stale`/오류·타종목 응답은 평가하지 않는다.
- 기기 절전·앱 종료·주기 조회 간 가격 반전은 감지하지 못할 수 있다. 시장별 지연 가격은 실시간 거래소 알림이 아니다.
- 동일한 종목 알림은 `watchlist:remove` 후 삭제한다.
- 현재 가격 알림 로직은 **로컬 기술 MVP**이고 Pro 라이선스/유료 결제 연동이 없다.

## 관심 종목

모두 성공 시 저장된 목록 `{ market, symbol, quantity?, avgPrice? }[]`을 돌려주고 시세 갱신을 시작한다.

| 채널                       | 입력                                                           | 오류                                                                               |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `watchlist:add`            | `{ market, symbol, quantity?, avgPrice? }`                     | `ERR_UNKNOWN_MARKET`, `ERR_INVALID_SYMBOL`, `ERR_DUPLICATE`, `ERR_INVALID_HOLDING` |
| `watchlist:update-holding` | `{ market, symbol, quantity?, avgPrice? }` (둘 다 비우면 삭제) | `ERR_NOT_FOUND`, `ERR_INVALID_HOLDING`                                             |
| `watchlist:remove`         | `{ market, symbol }`                                           | — (없으면 그대로)                                                                  |
| `watchlist:reorder`        | `{ market, symbol }[]`                                         | `ERR_INVALID_ORDER`. 목록에 없는 항목은 무시, 빠진 항목은 끝에 유지                |

`quantity`·`avgPrice`: 비어 있으면 미입력, 아니면 0보다 큰 유한한 수.

## AI 분석·리포트 (P3 미리보기 + P5 리포트 + P6 Pro)

| 채널 | 입력 | 출력 | 설명 |
|---|---|---|---|
| `ai:get-context` | — | `{stocks:[{market,symbol}], thesis}` | 현재 관심 목록과 로컬 투자 관점 |
| `ai:get-thesis` | — | `{schemaVersion,text,horizon,focus,updatedAt}` | 선택적 자유 입력 투자 관점 |
| `ai:save-thesis` | `{text,horizon,focus}` | 저장한 투자 관점 | 길이·선택값 검증, 원본은 로컬 저장 |
| `ai:preview` | `{selectedKeys,includeHoldings,includeHistory,includeThesis,thesisDraft?,lookbackDays?}` | `{status:'preview_only',request,scope}` | **네트워크 요청 없음, 크레딧 미사용, PDF 미생성** |
| `pro:get-status` | — | `ProStatus` | `{available, payments?, reports?, pack?:{price,credits,currency}, markets?, account?:{email, credits:{available,pending}\|null}\|null}` |
| `pro:request-code` | `email` | — | 로그인 코드 메일 발송 요청 |
| `pro:verify-code` | `{email, code}` | `ProStatus` | 6자리 코드 확인 → 세션 저장 |
| `pro:logout` | — | `ProStatus` | 서버 세션 폐기(실패해도 로컬 세션 삭제) |
| `pro:checkout` | — | `{status:'opened'}` | 서버가 만든 1회용 결제 페이지(`<API>/pay/<token>`)만 기본 브라우저로 연다 |
| `ai:create-report` | `ai:preview`와 같은 옵션 | `{id, reports: ReportSummary[]}` | 로그인 필요. main이 로컬 저장소에서 요청을 **다시 만들어** `POST /v1/reports`로 전송, 1회 차감. 응답 재검증 후 로컬 보관 |
| `ai:list-reports` | — | `ReportSummary[]` | 최신순 `{id,createdAt,asOf,stocks,noNewEvents,summary}` |
| `ai:open-report` | `id` | — | 별도 창에 리포트 표시 (JavaScript 꺼짐, 링크는 기본 브라우저) |
| `ai:save-pdf` | `id` | `{status:'saved'\|'cancelled'}` | 저장된 스냅샷을 A4 PDF로 출력(내용에 따라 여러 장). **서버 호출·차감 없음**, 반복 저장 가능 |
| `ai:delete-report` | `id` | `ReportSummary[]` | 이 PC의 리포트 스냅샷만 삭제 |

- 요청 스키마 `schemaVersion:2`; 최대 5종목, 최근 활동 기간 기본 90일(1–365일), 최대 100건.
- 보유 수량·평단가, 활동 이력, 투자 관점은 **기본 제외**. 각각 사용자 선택이 있는 경우만 미리보기와 요청에 포함.
- `thesisDraft`는 선택적 미저장 편집 내용이며 **미리보기 자체는 저장하지 않음**. 별도 저장 버튼으로만 보관.
- 관심 종목 추가·삭제는 거래 내역으로 간주하지 않는다. 평단가·수량 변경도 매수/매도가 아님.
- **Pro는 Windows 전용.** 다른 OS와, 서버가 공개하지 않은 상태(`/v1/config`의 `pro:false`)에서는 `available:false`이고 아무것도 전송하지 않는다. 클로즈드 베타는 PC 환경변수 `STOCKPEEK_PRO=1`로 화면을 켠다. `STOCKPEEK_API_URL`로 서버 주소를 바꿀 수 있다(https, 또는 로컬 `wrangler dev`용 `http://127.0.0.1`·`localhost`). `STOCKPEEK_PRO_ANY_OS=1`은 개발·테스트용.
- 세션 토큰은 main에만 있고 OS 암호화(`safeStorage`, Windows DPAPI)로 저장한다. 암호화를 쓸 수 없으면 메모리에만 두고 앱 재시작 시 다시 로그인. 렌더러에는 이메일·잔액만 전달.
- 리포트 생성은 클릭마다 새 `Idempotency-Key`. 연결이 끊기면(`ERR_PRO_NETWORK`) 같은 키로 한 번 재시도해 이중 차감 없이 저장된 결과를 받는다.
- 전송 전 검사: 지원 시장(US·KR) 외 종목 → `ERR_ANALYSIS_MARKET`, 본문 12KB 초과 → `ERR_ANALYSIS_TOO_LARGE`, 이미 생성 중 → `ERR_ANALYSIS_IN_PROGRESS`.
- 서버 오류 중 `ERR_EMAIL_INVALID`, `ERR_CODE_INVALID`, `ERR_RATE_LIMITED`, `ERR_SESSION_INVALID`, `ERR_PRO_DISABLED`, `ERR_MAIL_FAILED`, `ERR_CREDITS_INSUFFICIENT`, `ERR_PAYMENTS_DISABLED`, `ERR_ANALYSIS_DISABLED`, `ERR_ANALYSIS_DAILY_LIMIT`, `ERR_ANALYSIS_BUSY`, `ERR_ANALYSIS_IN_PROGRESS`, `ERR_ANALYSIS_NO_COVERAGE`, `ERR_ANALYSIS_REQUEST`만 그대로 전달. 나머지는 `ERR_PRO_FAILED`(리포트는 `ERR_ANALYSIS_FAILED`). 연결 실패 `ERR_PRO_NETWORK`, 시간 초과 `ERR_PRO_TIMEOUT`(리포트 120초, 그 외 15초). `ERR_SESSION_INVALID`면 로컬 세션 삭제.
- 응답은 `src/shared/reportClient.js`가 다시 검증한다(공식 공시 도메인, 인용 ID, 길이, 요청한 종목만, 보유정보 미동의 시 포트폴리오 문단 거부). 실패하면 `ERR_ANALYSIS_RESPONSE`이고 저장하지 않는다. 저장되는 종목 목록에는 보유 수량·평단을 넣지 않는다.
- 로컬 보관: `ai-reports` electron-store, 최신 20개. 공시가 새로 나와도 저장된 스냅샷은 바뀌지 않는다.
- PDF: A4 세로, 내용이 길면 여러 장. 내용을 자르거나 글자를 줄이지 않는다. 출력 실패는 `ERR_REPORT_PDF`.

## 로컬 활동 이력 (P1)

현재 관심 목록과 변경 로그는 같은 `watchlist` electron-store 파일에 한 번의 whole-store write로 저장한다. 기존 설치의 첫 실행 시 현재 목록을 `baseline_imported`로 보존하며 과거 매수·매도를 추정하지 않는다.

| 채널 | 방식 | 입력 | 출력 | 특징 |
|---|---|---|---|---|
| `activity:get-summary` | invoke | — | `{schemaVersion, startedAt, count, recent[]}` | 최근 변경 5건, baseline 제외 |
| `activity:export` | invoke | — | `{status:'saved'\|'cancelled'}` | OS 파일 저장 대화상자에서 JSON 파일 생성. 민감한 보유 정보 포함 가능 |
| `activity:clear` | invoke | — | `{schemaVersion, startedAt, count:0, recent:[]}` | 이력만 초기화, 현재 종목/보유 정보 유지. UI의 삭제 확인 필수 |

- `watchlist_added` / `watchlist_removed` = 관심 목록 변경. **실제 매수·매도 아님**.
- `holding_edited` = 사용자 입력 수량/평단 수정. 거래 체결/거래일/손익을 추정하지 않는다.
- `watchlist_replaced` = 시스템 일괄 목록 교체; 실제 매매로 취급하지 않는다.
- 정렬·조회·값이 달라지지 않은 수정은 이력을 추가하지 않는다.
- 이력 스키마 버전이 알 수 없거나 손상된 경우 `ERR_ACTIVITY_INVALID_HISTORY`를 반환하고 덮어쓰지 않는다.
- 이력은 기본적으로 **로컬 전용**이며 클라우드에 전송하지 않는다.

## 검색

| 채널            | 입력                  | 출력                                                                        | 오류                                      |
| --------------- | --------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| `search:stocks` | `{ market, keyword }` | `{ market, symbol, name, type?, localName? }[]` 최대 10개. 빈 검색어는 `[]` | `ERR_UNKNOWN_MARKET`, `ERR_SEARCH_FAILED` |

## 패널

| 채널                          | 방식            | 입력                            | 설명                                     |
| ----------------------------- | --------------- | ------------------------------- | ---------------------------------------- |
| `panel:lock` / `panel:unlock` | send            | —                               | 자동 숨김 중지. 현재 화면에서 쓰지 않음  |
| `panel:pin` / `panel:unpin`   | send            | —                               | 고정                                     |
| `panel:get-pinned`            | invoke          | —                               | boolean                                  |
| `panel:pinned-changed`        | main → renderer | boolean                         | 트레이 클릭으로 고정될 때                |
| `panel:set-height`            | send            | number (내용 높이, px)          | 자동 높이. 사용자가 크기를 바꿨으면 무시 |
| `panel:resize-start`          | send            | `'width' \| 'height' \| 'both'` | 크기 조절 시작                           |
| `panel:resize-end`            | send            | —                               | 크기 조절 끝                             |
| `panel:resize-ended`          | main → renderer | —                               | 창이 포커스를 잃는 등으로 끝났을 때      |
| `panel:reset-size`            | invoke          | —                               | 기본 크기로                              |
| `dock:get-edge`               | invoke          | —                               | `'left' \| 'right'`                      |
| `dock:edge-changed`           | main → renderer | `'left' \| 'right'`             | 드래그 후 스냅                           |

## 설정·앱

| 채널                     | 방식            | 입력                               | 출력                                                                  |
| ------------------------ | --------------- | ---------------------------------- | --------------------------------------------------------------------- |
| `settings:get`           | invoke          | —                                  | `{ autoStart, version }`                                              |
| `settings:set-autostart` | invoke          | boolean                            | 적용된 값                                                             |
| `lang:get`               | invoke          | —                                  | 언어 코드 (저장값 → OS 언어)                                          |
| `lang:set`               | invoke          | 언어 코드 (지원하지 않으면 무시)   | 적용된 언어 코드                                                      |
| `welcome:check`          | invoke          | —                                  | 환영 화면을 보여줄지                                                  |
| `welcome:dismiss`        | invoke          | —                                  | `true`                                                                |
| `app:get-update`         | invoke          | —                                  | `{ available, ready }`                                                |
| `app:check-update`       | invoke          | —                                  | `{ status: 'latest' \| 'available' \| 'ready' \| 'error', version? }` |
| `app:update-available`   | main → renderer | `{ version, releaseDate, manual }` | `manual`: Mac (직접 내려받기)                                         |
| `app:update-ready`       | main → renderer | `{ version }`                      | Windows 설치 준비됨                                                   |
| `app:install-update`     | send            | —                                  | Windows 설치·재실행, Mac 다운로드 페이지                              |
| `shell:open-external`    | send            | `http(s)://`·`mailto:` URL만       | 기본 브라우저·메일                                                    |
| `app:quit`               | send            | —                                  | 종료                                                                  |
