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
| `quantity`, `avgPrice`           | number?  | 사용자 입력 보유 정보. 시세보다 우선                              |
| `stale`                          | boolean? | 갱신 실패, 마지막 정상 시세 표시 중                               |
| `error`, `errorCode`             | string?  | 한 번도 시세를 받지 못한 경우만. 화면은 `errorCode`만 번역해 표시 |

## 시세

| 채널               | 방식            | 입력 | 출력                       |
| ------------------ | --------------- | ---- | -------------------------- |
| `stocks:get-cache` | invoke          | —    | `Stock[]` 마지막 결과      |
| `stocks:refresh`   | invoke          | —    | 강제 갱신 (실패 대기 무시) |
| `stocks:update`    | main → renderer | —    | `Stock[]`, 갱신될 때마다   |

## 관심 종목

모두 성공 시 저장된 목록 `{ market, symbol, quantity?, avgPrice? }[]`을 돌려주고 시세 갱신을 시작한다.

| 채널                       | 입력                                                           | 오류                                                                               |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `watchlist:add`            | `{ market, symbol, quantity?, avgPrice? }`                     | `ERR_UNKNOWN_MARKET`, `ERR_INVALID_SYMBOL`, `ERR_DUPLICATE`, `ERR_INVALID_HOLDING` |
| `watchlist:update-holding` | `{ market, symbol, quantity?, avgPrice? }` (둘 다 비우면 삭제) | `ERR_NOT_FOUND`, `ERR_INVALID_HOLDING`                                             |
| `watchlist:remove`         | `{ market, symbol }`                                           | — (없으면 그대로)                                                                  |
| `watchlist:reorder`        | `{ market, symbol }[]`                                         | `ERR_INVALID_ORDER`. 목록에 없는 항목은 무시, 빠진 항목은 끝에 유지                |

`quantity`·`avgPrice`: 비어 있으면 미입력, 아니면 0보다 큰 유한한 수.

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
