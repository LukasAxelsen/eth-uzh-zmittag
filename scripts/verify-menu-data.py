#!/usr/bin/env python3
"""Fail a deployment before unsafe menu data goes live."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from menu_data import load_payload, validate_payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('data_file', type=Path)
    parser.add_argument('--allow-empty-today', action='store_true',
                        help='allow a known empty weekday; source errors are still blocked')
    args = parser.parse_args()
    try:
        result = validate_payload(load_payload(args.data_file), args.allow_empty_today)
    except (OSError, ValueError) as err:
        print(f'Menu health check failed: {err}', file=sys.stderr)
        raise SystemExit(1)
    sources = ', '.join(f'{s}={v["status"]} ({v["dishCount"]} dishes)' for s, v in result['sources'].items())
    print(f'Menu health check passed: {result["date"]}; {result["mensaCount"]} mensas; {sources}')


if __name__ == '__main__':
    main()
