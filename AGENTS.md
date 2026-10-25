# AGENTS.md

AI·기여자용 작업 규칙. 사용자 소개는 [README.md](README.md).

## 개요

- Windows 데스크톱 위젯. 화면 가장자리 hover 시 관심 종목 시세 패널 표시
- 데이터: KR 네이버 금융, US Yahoo Finance
- 스택: Electron, electron-vite, React 19, `electron-store`
- 계정·증권사 연동 없음

## 명령

```bash
npm install
npm run dev                    # 개발 실행
npm run lint                   # CI는 --max-warnings 0
npm run build                  # 번들
npm run build:win              # 설치파일 → dist/
npm run sync:version           # package.json 버전 → website/
cd server && npx wrangler dev  # Worker 로컬 (localhost:8787)
```

## 구조

```
src/main/index.js         창·트레이·IPC 핸들러·자동 업데이트
src/main/stockService.js  폴링, lastGood 캐시, 시세·보유 병합
src/main/watchlist.js     관심종목 CRUD
src/main/preferences.js   도킹·언어·welcome 설정
src/main/api/             naver.js, yahoo.js, proxy.js
src/preload/index.js      contextBridge IPC 화이트리스트
src/renderer/src/         App.jsx, components/, i18n/
server/src/worker.js      Cloudflare Worker 프록시 (현재 미사용)
website/                  랜딩 페이지 (한/영)
scripts/                  prepare-release.mjs, sync-version.mjs
```

## 규칙

- HTTP: `eFetch`(Electron `net.fetch`)만 사용. Node `fetch`는 시스템 프록시·인증서를 무시해 사내망에서 실패
- 시세 병합: `{...quote, ...holding}` 순서 유지. 사용자 입력(수량·평단)이 API 값에 덮이면 안 됨
- 네트워크 실패: `lastGood` 값 유지 + stale 표시
- 폴링: 한/미 중 하나라도 장중이면 3초, 모두 장외면 60초, 차트 10분 캐시, 미국 서머타임 반영
- 멀티모니터: `displayId` 저장, 해당 모니터 없으면 primary로 폴백
- IPC 추가: `main/index.js` 핸들러와 `preload/index.js` 화이트리스트 둘 다 수정
- UI 문구: `i18n/translations.js`에 ko·en 둘 다 추가
- 미니멀: 기능 추가보다 제거·단순화 우선
- 비밀값: 토큰·계정 ID·인증서 커밋 금지

## 배포

| 대상     | 트리거                   | 방식                                                  |
| -------- | ------------------------ | ----------------------------------------------------- |
| 앱       | main에 앱 파일 push      | `release.yml`: 패치 버전 증가 → lint → 빌드 → Release |
| 웹사이트 | main에 `website/**` push | Cloudflare Pages Git 연동이 자동 배포 (Actions 아님)  |
| Worker   | 수동                     | `cd server && npx wrangler deploy`                    |

- 앱 파일: `src/`, `resources/`, `build/`, `package*.json`, `electron-builder.yml` 등. 문서만 바뀌면 릴리즈 안 됨
- 릴리즈 워크플로우가 main에 버전 커밋을 push하므로 작업 전 `git pull`
- 태그 수동 생성 금지. minor·major는 `package.json` 버전을 최신 태그보다 높여서 push
- 실패 시 재시도: Actions → Release → Run workflow
- `.gitattributes`(eol=lf) 유지. 없으면 Windows 러너에서 CRLF로 lint 실패
- 웹사이트 버전 표기: 릴리즈 워크플로우가 `sync:version` 결과를 버전 커밋에 포함
- Worker 프록시: `proxy.js`의 `USE_QUOTE_PROXY = false`. 네이버·야후가 CF IP를 차단해 직접 호출만 사용

## 체크리스트

- `npm run lint`, `npm run build` 통과
- 한·영 UI 확인
- 좌·우 도킹 hover 동작 확인
