# 몰래주식 (Stock Peek)

화면 우측 가장자리 hover로 즐겨찾기 한국·미국 주식 시세를 슬라이드 인하는 Windows 데스크톱 위젯.

> 일하다가 몰래, 게임하다가 몰래 — 시세만 빠르게.

## 다운로드

[Releases](https://github.com/sngmng6506/stock-peek/releases/latest) 페이지에서 최신 `.exe` installer를 받으세요.

## 기능

- 화면 우측 5px hover + 0.3초 머무름 → 패널 슬라이드 인
- 한국 종목 (네이버 금융) + 미국 종목 (Yahoo Finance)
- 종목 이름/티커로 검색해서 추가
- 30일 일봉 sparkline
- 드래그앤드롭으로 순서 변경
- 트레이 아이콘 + 윈도우 시작 시 자동 실행
- 적응형 갱신 (장 시간 5초, 장 외 60초)
- 카드 수에 따라 패널 높이 자동 조정
- 새 릴리즈 자동 감지 → 트레이/설정에서 업데이트 알림

## 개발

```bash
npm install
npm run dev          # 개발 서버 + Electron
npm run build:win    # Windows installer 빌드 → dist/
```

## 아키텍처

```
[Electron 앱] ─→ [Cloudflare Worker proxy] ─→ 네이버 / Yahoo
                       │
                       └─ Cache API로 응답 캐싱
```

- `src/` — Electron 앱 (main + preload + renderer)
- `server/` — Cloudflare Worker proxy
- `website/` — 랜딩 페이지 (Cloudflare Pages 배포)

## 라이선스

MIT. 비공식 API를 사용하므로 개인 학습용으로만.

## 문의

[sngmng6506@gmail.com](mailto:sngmng6506@gmail.com)
