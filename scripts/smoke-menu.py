#!/usr/bin/env python3
"""Opt-in live source smoke checks, separate from all offline regression tests."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import menu
from menu_data import validate_dish


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', choices=['ETH', 'UZH', 'both'], default='both')
    parser.add_argument('--uzh-outlet', action='append', choices=list(menu.UZH_WEEKLY_URLS),
                        help='limit UZH smoke to named outlets; default checks all')
    args = parser.parse_args()
    today = menu._current_date()
    failures = []
    if args.source in ('ETH', 'both'):
        try:
            mensas = menu.fetch_eth(today)
            for mensa in mensas:
                for slot, dishes in mensa['meals'].items():
                    for i, dish in enumerate(dishes):
                        validate_dish(dish, f'{today}.ETH.{mensa["id"]}.{slot}[{i}]')
            print(f'{today} ETH: {menu.source_summary(mensas)["status"]}', flush=True)
        except (menu.SourceError, ValueError) as err:
            failures.append(f'{today} ETH: {err}')
    if args.source in ('UZH', 'both'):
        for slug in args.uzh_outlet or menu.UZH_WEEKLY_URLS:
            try:
                dishes = menu.scrape_uzh_date(slug, today)
                for i, dish in enumerate(dishes):
                    validate_dish(dish, f'{today}.UZH.{slug}[{i}]')
                status = 'ok' if dishes else 'confirmed_empty' if today in menu._load_uzh_weekly(slug) else 'not_published'
                print(f'{today} UZH/{slug}: {status}', flush=True)
            except (menu.SourceError, ValueError) as err:
                failures.append(f'{today} UZH/{slug}: {getattr(err, "status", "parse_failed")} stage={getattr(err, "stage", "field")}: {err}')
    for failure in failures:
        print(failure, file=sys.stderr)
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
