# 할 일

코드로 못 하고 각 서비스 관리 화면에서 직접 해야 하는 작업. 끝나면 체크하고, `docs/market-expansion.md` 3번 항목도 같이 체크.

## 검색 노출 (인도 시장 추가 후)

- [ ] Google Search Console 사이트맵 다시 제출
  - 사이트 페이지 목록(sitemap.xml)이 바뀌었으니 다시 읽어 달라고 구글에 알림
  - [search.google.com/search-console](https://search.google.com/search-console) → `stock-peek.com` 선택 → Sitemaps → `https://stock-peek.com/sitemap.xml` 제출
  - 안 해도 구글이 언젠가 다시 읽지만, 하면 더 빨리 반영됨
- [ ] Bing Webmaster Tools 등록과 사이트맵 제출
  - ChatGPT 검색·Copilot이 Bing 색인을 씀 → 등록돼 있어야 AI 답변에 나올 가능성이 커짐
  - [bing.com/webmasters](https://www.bing.com/webmasters)에서 사이트 추가. Google Search Console 계정을 연결해 가져오기를 쓰면 빠름
  - 등록 후 `https://stock-peek.com/sitemap.xml` 제출

## 사우디 시장·아랍어 출시 후 확인

- [ ] 실제 앱에서 사우디 종목 검색·추가: `2222`(아람코), `1120`(알라지히), `Aramco` 검색. 개발 환경에서는 Yahoo 접속이 막혀 `.SR` 티커 응답을 확인하지 못함
- [ ] 사우디 장중(일–목 한국 시간 16:00–21:00)에 3초 갱신, 카드에 "15분 지연" 표시
- [ ] 아랍어 번역 원어민 검토: 앱(`src/shared/i18n/ar.js`), 웹(`site/pages/ar/`)
- [ ] Windows·Mac에서 아랍어 화면 확인 (트레이 메뉴·알림 포함)
- [ ] Google Search Console에서 `/ar` 페이지 색인 확인
