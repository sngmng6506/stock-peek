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

## 검색

| 채널            | 입력                  | 출력                                                                        | 오류                                      |
| --------------- | --------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| `search:stocks` | `{ market, keyword }` | `{ market, symbol, name, type?, localName? }[]` 최대 10개. 빈 검색어는 `[]` | `ERR_UNKNOWN_MARKET`, `ERR_SEARCH_FAILED` |

## 패널

| 채널                          | 방식            | 입력                            | 설명                                     |
| ----------------------------- | --------------- | ------------------------------- | ---------------------------------------- |
| `panel:lock` / `panel:unlock` | send            | —                               | 모달이 열린 동안 자동 숨김 중지          |
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
