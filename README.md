# 몰래주식 (Stock Peek)

[![Download](https://img.shields.io/github/v/release/sngmng6506/stock-peek?label=download&style=flat-square)](https://github.com/sngmng6506/stock-peek/releases/latest)
[![License](https://img.shields.io/badge/license-BSL-blue?style=flat-square)](#라이선스)

화면 가장자리에 마우스만 가져가면 관심 종목 시세가 슬라이드로 나타나는 Windows 데스크톱 위젯. 한국·미국 주식 지원.

**[stock-peek.com](https://stock-peek.com/)** · [English](https://stock-peek.com/en)

> 일하다가 몰래, 게임하다가 몰래 — 시세만 빠르게.

<!-- TODO: 데모 GIF 추가 (앱 hover → 슬라이드 인 장면 5~6초 녹화 후 아래 경로에 배치) -->
<!-- ![demo](docs/demo.gif) -->

## 다운로드

[Releases](https://github.com/sngmng6506/stock-peek/releases/latest)에서 최신 `.exe` 설치 파일을 받으세요. 설치 후 새 버전은 앱 안에서 자동으로 알려줍니다.

## 기능

- 화면 가장자리 hover → 패널 슬라이드 인, 벗어나면 사라짐
- 한국 종목 (네이버 금융) + 미국 종목 (Yahoo Finance)
- 종목명·티커로 검색해서 추가, 보유 수량·평단가 입력 시 평가손익 표시
- 1거래일 sparkline 차트
- 드래그로 순서 변경 / 좌·우 모서리 도킹 / 멀티모니터 지원
- 한국어·English (OS 언어 자동 감지 + 설정에서 전환)
- 트레이 아이콘 + 윈도우 시작 시 자동 실행
- 장 시간 5초 / 장 외 60초 적응형 갱신
- 네트워크 끊김 시 마지막 가격 유지

## 개발

```bash
npm install
npm run dev          # 개발 서버 + Electron
npm run build:win    # Windows installer 빌드 → dist/
```

## 아키텍처

```
[Electron 앱] ──→ [Cloudflare Worker proxy] ──→ 네이버 / Yahoo
        │                  (프록시 실패 시)
        └──────── net.fetch 직접 호출 폴백 ───────→ 네이버 / Yahoo
```

Electron 메인 프로세스는 `net.fetch`로 시스템 프록시/인증서를 그대로 사용하므로 사내망 등에서도 동작합니다.

- `src/` — Electron 앱 (main · preload · renderer)
- `server/` — Cloudflare Worker proxy
- `website/` — 랜딩 페이지 (Cloudflare Pages 배포, 한/영)

## 라이선스

BSL.

## 문의

[sngmng6506@gmail.com](mailto:sngmng6506@gmail.com) · [Buy Me a Coffee ☕](https://buymeacoffee.com/sngmng)
