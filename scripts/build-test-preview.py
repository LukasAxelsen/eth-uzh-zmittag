#!/usr/bin/env python3
"""Build a clearly labelled offline fixture preview through the real pipeline."""
import argparse
from datetime import date, timedelta
import json
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import menu

FIXTURES = Path(__file__).with_name('fixtures')
TODAY = '2026-10-13'


def fixture_response(url, **kwargs):
    if 'idapps.ethz.ch' in url:
        filename = ('eth-polyterrasse-2026-10-14.json' if 'date=2026-10-14' in url else
                    'eth-normal.json' if f'date={TODAY}' in url else 'eth-empty.json')
        return (FIXTURES / filename).read_text()
    if url.split('?', 1)[0].endswith('/weekly'):
        if '/untere-mensa/' in url:
            return (FIXTURES / 'uzh-weekly.html').read_text()
        daily = [{'from': {'dateLocal': (date(2026, 10, 13) + timedelta(days=i)).isoformat() + 'T00:00:00+02:00'},
                  'menuItems': []} for i in range(15)]
        props = {'outlet': {'calendar': {'week': {'daily': daily}}}}
    elif url.endswith('/2026-10-13'):
        return (FIXTURES / ('uzh-garden-detail.html' if ',garden/' in url else 'uzh-missing-fields.html')).read_text()
    else:
        props = {'menuItem': None}
    return '<script id="__NEXT_DATA__">' + json.dumps({'props': {'pageProps': props}}) + '</script>'


def sv_week_fixture(menu_id, year, week):
    if (menu_id, year, week) == (18509, 2026, 42):
        return json.loads((FIXTURES / 'sv-polyterrasse-week.json').read_text())
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    closure_file = args.output / 'fixture-closures.json'
    closure_file.write_text(json.dumps([{'date': TODAY, 'mensa': 'eth-1', 'reason': 'Fixture campus closure',
        'evidence': {'kind': 'calendar', 'url': 'https://example.com/fixture-calendar', 'confirmedOn': '2026-10-12'}}]))
    with patch.object(menu, 'http_get', side_effect=fixture_response), \
         patch.object(menu, '_load_sv_week', side_effect=sv_week_fixture), \
         patch.object(menu, '_current_date', return_value=TODAY), patch('menu_data.zurich_today', return_value=TODAY), \
         patch.object(menu, 'OUTPUT_DIR', str(args.output)):
        menu.main(closure_file=str(closure_file))
    index = args.output / 'index.html'
    html = index.read_text().replace('VER_PLACEHOLDER', 'hardening-preview')
    # Distinguish the demo's data from live menus without changing production UI.
    html = html.replace('Refresh scheduled at 03:17 / 07:17 UTC', 'Offline test fixtures')
    index.write_text(html)
    closure_file.unlink()


if __name__ == '__main__':
    main()
