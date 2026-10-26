"""다운로드 배지 + 사용 추이 기록 (download-badge.yml이 매일 실행)

입력: GitHub 릴리즈 목록 JSON(stdin), badges 브랜치 폴더 경로
출력(그 폴더에):
  downloads.json  README 배지 (shields.io endpoint) — 설치 파일(.exe·.dmg) 다운로드 합계
  usage.csv       날짜별 누적값과 하루 증가분, 하루 사용자 수

하루 사용자 수: 앱(v1.6.17~)은 하루 한 번 최신 릴리즈의 ping-win/ping-mac(1바이트)을 받음.
그 다운로드 수의 하루 증가분이 그날 앱을 켠 기기 수 (식별자 없음).

추정치(ping 이전 버전 포함 참고용): 앱은 실행 중 업데이트를 확인하며 latest.yml(Windows)·latest-mac.yml(Mac)을 받음.
시작 시 1번 + 1시간마다 + 패널 열 때(15분에 1번까지). 하루 몇 시간 켜두는 사용자가
대략 하루 12번 확인한다고 가정하고 하루 증가분 ÷ 12로 계산. 절대값보다 추이를 볼 것.
"""
import csv
import datetime
import json
import os
import sys

CHECKS_PER_USER_PER_DAY = 12


def main(out_dir):
    releases = json.load(sys.stdin)
    if releases and isinstance(releases[0], list):  # gh api --paginate --slurp
        releases = [r for page in releases for r in page]

    installers = checks = ping_win = ping_mac = 0
    for r in releases:
        for a in r.get('assets', []):
            name, n = a['name'], a['download_count']
            if name.endswith('setup.exe') or name.endswith('.dmg'):
                installers += n
            elif name in ('latest.yml', 'latest-mac.yml'):
                checks += n
            elif name == 'ping-win':
                ping_win += n
            elif name == 'ping-mac':
                ping_mac += n

    with open(os.path.join(out_dir, 'downloads.json'), 'w') as f:
        json.dump({'schemaVersion': 1, 'label': 'downloads', 'message': f'{installers:,}', 'color': 'blue'}, f)
        f.write('\n')

    path = os.path.join(out_dir, 'usage.csv')
    header = ['date', 'daily_users', 'daily_users_win', 'daily_users_mac',
              'ping_win_total', 'ping_mac_total',
              'update_checks_total', 'installer_downloads_total',
              'update_checks_day', 'installer_downloads_day', 'active_users_estimate']
    rows = []
    if os.path.exists(path):
        with open(path, newline='') as f:
            rows = [r for r in csv.DictReader(f)]

    today = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
    rows = [r for r in rows if r['date'] != today]  # 같은 날 재실행은 덮어씀
    prev = rows[-1] if rows else None
    def prev_int(key):
        try:
            return int(prev.get(key) or 0)
        except ValueError:
            return 0

    if prev:
        d_checks = checks - prev_int('update_checks_total')
        d_inst = installers - prev_int('installer_downloads_total')
        est = str(round(d_checks / CHECKS_PER_USER_PER_DAY))
        d_win = ping_win - prev_int('ping_win_total')
        d_mac = ping_mac - prev_int('ping_mac_total')
        users = d_win + d_mac
    else:
        d_checks = d_inst = est = d_win = d_mac = users = ''
    rows.append({'date': today, 'daily_users': users, 'daily_users_win': d_win, 'daily_users_mac': d_mac,
                 'ping_win_total': ping_win, 'ping_mac_total': ping_mac,
                 'update_checks_total': checks, 'installer_downloads_total': installers,
                 'update_checks_day': d_checks, 'installer_downloads_day': d_inst, 'active_users_estimate': est})

    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=header, extrasaction='ignore', restval='')
        w.writeheader()
        w.writerows(rows)
    print(f'installers={installers} daily_users={users} (win {d_win}, mac {d_mac}) est_active={est}')


if __name__ == '__main__':
    main(sys.argv[1])
