"""Argaam 「أسعار الشركات」 페이지를 복사한 텍스트 → data/sa-stocks.json

사우디 거래소는 해외·서버 접속을 막아 자동 수집이 안 됨 → 손으로 갱신 (1년에 몇 번).
갱신: https://www.argaam.com/ar/company/companies-prices 를 브라우저로 열어 전체 선택·복사 →
텍스트 파일로 저장 → python scripts/import_sa_stocks.py <txt> data/sa-stocks.json

items: [코드(4자리), 아랍어 짧은 이름, 구분(Main|REIT|ETF|Fund)]
목록에 없는 종목(Nomu, 신규 상장)은 앱이 4자리 코드로 Yahoo에서 찾음.
"""
import datetime
import json
import re
import sys
import unicodedata

SECTION_TYPES = {
    'الصناديق العقارية المتداولة': 'REIT',
    'صناديق المؤشرات المتداولة': 'ETF',
    'صناديق الاستثمار المغلقة': 'Fund',
}
MIN_ITEMS = 200
STOP = 'الأكثر مشاهدة'  # 표 끝


def main(src, out_path):
    lines = open(src, encoding='utf-8').read().splitlines()
    section = 'Main'
    items = {}
    prev = ''
    for line in lines:
        text = line.strip()
        if text == STOP:
            break
        if text.startswith('رمز السهم'):
            # 표 머리줄 바로 위 줄이 섹터 이름
            section = SECTION_TYPES.get(prev, 'Main')
        m = re.match(r'^(\d{4})\t(.+?)\t?$', line.rstrip('\n'))
        if m:
            name = unicodedata.normalize('NFKC', m.group(2)).strip()
            items[m.group(1)] = [m.group(1), name, section]
        if text:
            prev = text
    if len(items) < MIN_ITEMS:
        raise SystemExit(f'only {len(items)} items parsed; refusing to write')
    rows = ',\n'.join('    ' + json.dumps(it, ensure_ascii=False) for it in sorted(items.values()))
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('{\n  "source": "Argaam companies prices (manual copy)",\n')
        f.write(f'  "asOf": "{datetime.date.today().isoformat()}",\n  "items": [\n{rows}\n  ]\n}}\n')
    counts = {}
    for it in items.values():
        counts[it[2]] = counts.get(it[2], 0) + 1
    print(f'{len(items)} items {counts} -> {out_path}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
