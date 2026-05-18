# Stock Peek — Landing Page

`stock-peek.com`에 배포할 정적 사이트.

## 로컬 미리보기

VS Code Live Server 확장이나 간단한 Python 서버:
```
cd website
python -m http.server 8080
# → http://localhost:8080
```

## Cloudflare Pages 배포

```
cd website
npx wrangler pages deploy . --project-name=stock-peek
```

첫 배포 시 프로젝트 생성 묻고, 그 다음부터는 위 명령으로 갱신.

배포 후 자동 부여되는 URL:
```
https://stock-peek.pages.dev
```

도메인 연결은 Cloudflare 대시보드:
1. 도메인 `stock-peek.com`을 Cloudflare Registrar에서 구매 (또는 외부 등록 후 네임서버를 Cloudflare로)
2. Pages 프로젝트 → Custom domains → `stock-peek.com` 추가
3. DNS 레코드 자동 생성, SSL 자동 발급

## 교체할 placeholder

- `https://github.com/your-handle/stock-peek` → 실제 GitHub 레포 URL
- 다운로드 링크: `releases/latest` (또는 특정 release 파일)
- `og.png` 이미지 (Open Graph)
- `screenshot.png` (실제 스크린샷 추가 시)
