# AGENTS.md

AI/기여자용 작업 가이드. 사용자용 소개는 README.md.

## 프로젝트

Windows 데스크톱 위젯. 화면 가장자리 hover 시 관심 종목 시세 패널 표시. KR(네이버 금융)·US(Yahoo Finance).
Electron + electron-vite + React 19, 저장은 `electron-store`. 계정·증권사 연동 없음.

## 명령

```bash
npm install
npm run dev                  # Electron 개발 실행
npm run lint                 # CI는 --max-warnings 0 (경고도 실패)
npm run build                # 번들만
npm run build:win            # NSIS 설치파일 → dist/
npm run sync:version         # package.json 버전 → website/ 메타 동기화
cd server && npx wrangler dev   # Worker 로컬 (localhost:8787)
```

## 구조

```
src/main/index.js        창·트레이·IPC 핸들러·auto-update (IPC 채널 전부 여기)
src/main/stockService.js 적응형 폴링, lastGood 캐시, 시세+보유 병합
src/main/watchlist.js    관심종목 CRUD
src/main/preferences.js  dock 위치·언어·welcome 설정
src/main/api/            naver.js · yahoo.js · proxy.js (net.fetch)
src/preload/index.js     contextBridge 화이트리스트 — 새 IPC는 여기에도 추가
src/renderer/src/        App.jsx, components/, i18n/translations.js
server/src/worker.js     Cloudflare Worker 프록시 (Cache API, KV 미사용)
website/                 랜딩 (한/영, 정적, Cloudflare Pages)
scripts/                 prepare-release.mjs, sync-version.mjs
```

## 지켜야 할 것

- HTTP는 반드시 `eFetch`(Electron `net.fetch`). Node `fetch` 금지 — 시스템 프록시/인증서 무시돼 사내망에서 실패.
- 시세 병합은 `{...quote, ...holding}` 순서 유지. API 응답이 사용자 입력(수량·평단)을 덮으면 안 됨.
- fetch 실패 시 `lastGood` 값 유지 + stale 표시. 빈 값으로 덮지 말 것.
- 폴링: 한/미 중 하나라도 장중 3s, 둘 다 장외 60s, 차트 10분 캐시. 미국 장 시간은 서머타임 반영.
- 멀티모니터: `displayId` 저장, 해당 모니터 없으면 primary 폴백.
- UI 문구는 `i18n/translations.js`에 ko/en 둘 다 추가.
- 미니멀 원칙: 기능 추가보다 제거·단순화 우선.
- 토큰·계정 ID·인증서 커밋 금지.

## 프록시 상태

`proxy.js`의 `USE_QUOTE_PROXY = false` — 네이버/야후가 CF edge IP를 차단해 현재 직접 호출만 사용. Worker 코드는 보존. 재활성화 시 true로 변경, 배포는 `cd server && npx wrangler deploy`.

## 릴리즈 (자동)

- main에 앱 파일(`src/`, `resources/`, `build/`, `package*.json`, `electron-builder.yml` 등) push → `.github/workflows/release.yml`이 다음 패치 버전 선택 → lint → Windows 빌드 → SHA256 → 버전 커밋+태그 push → GitHub Release 게시.
- `latest.yml`로 인앱 자동 업데이트.
- 워크플로우가 main에 버전 커밋을 push하므로 작업 전 `git pull`.
- 수동 태그 생성 금지. minor/major는 `package.json` 버전을 기존 태그보다 높게 올려서 push.
- 재시도: Actions → Release → Run workflow.
- Windows 러너 CRLF 문제는 `.gitattributes`(eol=lf)로 해결됨. 지우지 말 것.
- website/server/문서만 바뀌면 릴리즈 안 됨.

## 웹사이트 배포

main에 `website/**` 변경 push → `deploy-website.yml`이 `sync:version` 후 Pages 프로젝트 `stock-peek`에 배포.
필요 시크릿: `CLOUDFLARE_API_TOKEN`(Pages Edit), `CLOUDFLARE_ACCOUNT_ID`. 로컬 미리보기: `cd website && python -m http.server 8080`.

## 변경 후 확인

- `npm run lint`, `npm run build`
- 한/영 UI 둘 다, 좌/우 도킹 hover 동작
