"""사우디 거래소(Saudi Exchange) 종목 목록 → data/sa-stocks.json

items: [코드(4자리), 아랍어 이름, 영어 이름, 시장(Main|Nomu)]
아랍어 종목명 표시·검색용. 시세는 Yahoo(.SR)에서 받음.
출처: saudiexchange.sa 사이트 검색창이 쓰는 공개 목록 (ThemeSearchUtilityServlet).
GitHub Actions(update-sa-stocks.yml)가 매월 실행. 로컬: python scripts/update_sa_stocks.py data/sa-stocks.json [json경로]
"""
import json
import os
import re
import sys
import unicodedata
import urllib.request

URL = 'https://www.saudiexchange.sa/tadawul.eportal.theme.helper/ThemeSearchUtilityServlet'
MIN_ITEMS = 200  # 이보다 적으면 응답 형식이 바뀐 것으로 보고 중단


def notice(msg):
    if os.environ.get('GITHUB_ACTIONS'):
        print(f'::notice::{msg}'[:3900])
    else:
        print(msg)


def pick(d, *keys):
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ''


def main(out_path, source=None):
    if source:
        raw = open(source, 'rb').read()
    else:
        req = urllib.request.Request(URL, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Referer': 'https://www.saudiexchange.sa/',
            'X-Requested-With': 'XMLHttpRequest',
        })
        raw = urllib.request.urlopen(req, timeout=60).read()

    try:
        data = json.loads(raw.decode('utf-8-sig'))
    except ValueError:
        notice(f'not JSON; first bytes: {raw[:300]!r}')
        raise
    rows = data if isinstance(data, list) else next((v for v in data.values() if isinstance(v, list)), [])
    if rows:
        notice(f'{len(rows)} rows; keys: {sorted(rows[0].keys())}; sample: {json.dumps(rows[0], ensure_ascii=False)[:600]}')

    items = {}
    for r in rows:
        code = pick(r, 'symbol', 'Symbol', 'companySymbol')
        if not re.fullmatch(r'\d{4}', code):
            continue  # 4자리 주식 코드만 (펀드·채권·ETF 코드 형식은 제외)
        market = pick(r, 'market_type', 'marketType', 'market')
        ar = pick(r, 'tradingNameAr', 'companyNameAR', 'companyNameAr', 'nameAr')
        en = pick(r, 'tradingNameEn', 'companyNameEN', 'companyNameEn', 'nameEn')
        if not ar:
            continue
        ar = unicodedata.normalize('NFKC', ar)
        mk = 'Nomu' if re.search(r'nomu|parallel|نمو|S', market, re.I) and market.upper() != 'M' else 'Main'
        items[code] = [code, ar, en, mk]

    if len(items) < MIN_ITEMS:
        raise SystemExit(f'only {len(items)} items parsed; refusing to write')

    lines = ',\n'.join('    ' + json.dumps(it, ensure_ascii=False) for it in sorted(items.values()))
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('{\n  "source": "Saudi Exchange",\n  "items": [\n' + lines + '\n  ]\n}\n')
    notice(f'{len(items)} items -> {out_path}; e.g. {items.get("2222")}')


if __name__ == '__main__':
    try:
        main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    except BaseException as e:  # noqa: BLE001
        if os.environ.get('GITHUB_ACTIONS'):
            print(f'::error::{type(e).__name__}: {e}'[:3900])
        raise
