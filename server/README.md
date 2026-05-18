# Stock Peek — Cloudflare Worker Proxy

비공식 API(네이버/Yahoo)를 직접 호출하지 않고 이 Worker를 거치도록 해서:
- IP를 Cloudflare edge로 분산 (단일 IP 차단 위험 회피)
- Cache API로 응답 캐싱 (동일 종목 여러 사용자 → 네이버 호출 1회만)
- 다중 사용자 배포 시 차단 리스크↓

## 배포

### 1. Cloudflare 계정 + Wrangler CLI

```bash
cd server
npm install
npx wrangler login
```

브라우저가 열리고 Cloudflare 계정 인증 → 완료되면 터미널에 `Successfully logged in` 표시.

### 2. 배포

```bash
npx wrangler deploy
```

성공하면 다음과 같은 출력:
```
Total Upload: 3.50 KiB / gzip: 1.20 KiB
Uploaded stockpeek-proxy (X.XX sec)
Published stockpeek-proxy (X.XX sec)
  https://stockpeek-proxy.<your-handle>.workers.dev
Current Deployment ID: ...
```

이 URL이 본인 Worker URL입니다.

### 3. 클라이언트에 URL 박기

`src/main/api/proxy.js` 열고 `WORKER_URL`을 본인 URL로 교체:

```js
export const WORKER_URL = 'https://stockpeek-proxy.your-handle.workers.dev'
```

이제 Electron 앱 재빌드(`npm run build:win`)하면 모든 API 호출이 Worker를 통해 나갑니다.

빈 문자열로 두면 클라이언트가 직접 네이버/Yahoo를 호출합니다 (개발/디버그용).

## 로컬 테스트

```bash
cd server
npx wrangler dev
# → http://localhost:8787
```

브라우저로 동작 확인:
- `http://localhost:8787/health` → `{"ok":true,"name":"stockpeek-proxy"}`
- `http://localhost:8787/api/stock?market=KR&symbol=005930`
- `http://localhost:8787/api/search?market=US&q=apple`

## 비용

- **Workers**: 무료 일 100,000 요청 (사용자 1000명 × 일 종일 패널 켜놓아도 한도 안 닿음)
- **Cache API**: 무제한 (Workers 무료 plan에 포함)
- **KV는 미사용** (write 한도 회피 위해 Cache API만 사용)

초과 시 $5/월로 천만 요청까지.
