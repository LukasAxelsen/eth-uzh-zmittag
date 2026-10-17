#!/usr/bin/env python3
"""Offline behavior tests at the scrape, publication and serialization boundaries."""
import contextlib
import copy
import importlib.util
import io
import json
import sys
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
FIXTURES = Path(__file__).with_name('fixtures')


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


menu = module('menu', ROOT / 'menu.py')
guard = module('guard', ROOT / 'scripts/verify-menu-data.py')


def setUpModule():
    # These tests isolate the existing Cookpit/Food2050 publication boundary.
    # SV transport, matching and failure propagation have their own regressions.
    menu._test_sv_patch = patch.object(menu, '_load_sv_week', return_value=None)
    menu._test_sv_patch.start()


def tearDownModule():
    menu._test_sv_patch.stop()


def fixture(name):
    return (FIXTURES / name).read_text()


def replies(uzh='uzh-weekly.html', eth='eth-normal.json', detail='uzh-detail.html'):
    def get(url, **kwargs):
        if 'idapps.ethz.ch' in url:
            return fixture(eth)
        if url.split('?', 1)[0].endswith('/weekly'):
            return fixture(uzh)
        return fixture(detail)
    return get


def payload(uzh='uzh-weekly.html', eth='eth-normal.json'):
    menu._weekly_cache.clear()
    with patch.object(menu, 'http_get', side_effect=replies(uzh, eth)), contextlib.redirect_stderr(io.StringIO()):
        day = menu.collect_day('2026-10-13')
    return {'date': '2026-10-13', 'days': {'2026-10-13': day},
            'availableDates': ['2026-10-13'] if any(m['meals']['Lunch'] for m in day['mensas']) else []}


class SourceHealthTests(unittest.TestCase):
    def setUp(self):
        menu._weekly_cache.clear()

    def test_healthy_eth_cannot_hide_uzh_http_failure(self):
        def get(url, **kwargs):
            if 'idapps.ethz.ch' in url:
                return fixture('eth-normal.json')
            raise menu.SourceError('request_failed', 'request', 'HTTP 404: ' + url)
        logs = io.StringIO()
        with patch.object(menu, 'http_get', side_effect=get), contextlib.redirect_stderr(logs):
            day = menu.collect_day('2026-10-13')
        self.assertEqual(len(day['mensas']), 32)
        self.assertEqual(day['sources']['ETH']['status'], 'ok')
        self.assertEqual(day['sources']['UZH']['status'], 'request_failed')
        self.assertEqual(day['sources']['UZH']['issues'][0]['stage'], 'weekly')
        self.assertIn('404', day['sources']['UZH']['issues'][0]['message'])
        self.assertRegex(logs.getvalue(), 'UZH.*request_failed.*stage=weekly.*404')

    def test_200_with_changed_structure_is_parse_failure(self):
        with patch.object(menu, 'http_get', side_effect=replies(uzh='uzh-changed.html')), contextlib.redirect_stderr(io.StringIO()):
            day = menu.collect_day('2026-10-13')
        self.assertEqual(day['sources']['UZH']['status'], 'parse_failed')
        self.assertEqual(day['sources']['UZH']['issues'][0]['stage'], 'weekly')

    def test_source_confirmed_empty_is_distinct_from_failure(self):
        with patch.object(menu, 'http_get', side_effect=replies(uzh='uzh-empty.html', eth='eth-empty.json')):
            day = menu.collect_day('2026-10-13')
        self.assertEqual(day['sources']['ETH']['status'], 'confirmed_empty')
        self.assertEqual(day['sources']['UZH']['status'], 'confirmed_empty')
        self.assertEqual(len(day['mensas']), 32)

    def test_missing_optional_fields_preserves_menu_and_roster(self):
        with patch.object(menu, 'http_get', side_effect=replies(detail='uzh-missing-fields.html')):
            day = menu.collect_day('2026-10-13')
        self.assertEqual(day['sources']['UZH']['status'], 'ok')
        self.assertEqual(len(day['mensas']), 32)
        dish = next(m for m in day['mensas'] if m['id'] == 'uzh-untere-mensa')['meals']['Lunch'][0]
        self.assertEqual(dish['photo'], '')
        self.assertEqual(dish['nutrition'], {'p100': {}, 'total': {}})

    def test_malformed_detail_and_eth_fields_keep_failure_classification(self):
        for source in ('ETH', 'UZH'):
            menu._weekly_cache.clear()
            def get(url, **kwargs):
                if source == 'ETH' and 'idapps.ethz.ch' in url:
                    raw = json.loads(fixture('eth-normal.json'))
                    raw['meals'][0]['meal-price-array'] = [42]
                    return json.dumps(raw)
                if source == 'UZH' and not url.endswith('/weekly') and 'idapps' not in url:
                    return '<script id="__NEXT_DATA__">{"props":{"pageProps":{"menuItem":{"dish":42}}}}</script>'
                return replies()(url)
            with self.subTest(source=source), patch.object(menu, 'http_get', side_effect=get), contextlib.redirect_stderr(io.StringIO()):
                day = menu.collect_day('2026-10-13')
                self.assertEqual(day['sources'][source]['status'], 'parse_failed')
                self.assertTrue(day['sources'][source]['issues'][0]['stage'])

    def test_actual_transport_errors_and_200_parse_errors_have_distinct_results(self):
        for failure, status in [('404', 'request_failed'), ('timeout', 'request_failed'), ('changed', 'parse_failed'), ('empty', 'parse_failed')]:
            menu._weekly_cache.clear()
            def run(cmd, **kwargs):
                url = cmd[-1]
                if 'idapps.ethz.ch' in url:
                    return subprocess.CompletedProcess(cmd, 0, fixture('eth-normal.json'), '')
                if failure == 'timeout':
                    raise subprocess.TimeoutExpired(cmd, kwargs['timeout'])
                if failure == '404':
                    return subprocess.CompletedProcess(cmd, 22, '', 'curl: (22) The requested URL returned error: 404')
                if failure == 'empty':
                    return subprocess.CompletedProcess(cmd, 0, '', '')
                return subprocess.CompletedProcess(cmd, 0, fixture('uzh-changed.html'), '')
            with self.subTest(failure=failure), patch.object(menu.subprocess, 'run', side_effect=run), \
                 patch.object(menu.time, 'sleep'), contextlib.redirect_stderr(io.StringIO()):
                day = menu.collect_day('2026-10-13')
            self.assertEqual(day['sources']['ETH']['status'], 'ok')
            self.assertEqual(day['sources']['UZH']['status'], status)
            self.assertEqual(day['sources']['UZH']['issues'][0]['stage'], 'weekly')

    def test_captured_eth_empty_root_is_unpublished_not_closed_or_confirmed_empty(self):
        with patch.object(menu, 'http_get', side_effect=replies(eth='eth-unpublished.json')):
            day = menu.collect_day('2026-10-17')
        self.assertEqual(day['sources']['ETH']['status'], 'not_published')
        self.assertTrue(all(not m['meals']['Lunch'] for m in day['mensas'] if m['id'].startswith('eth-')))
        self.assertEqual(len(day['mensas']), 32)

    def test_unrecognized_nonempty_eth_response_still_fails(self):
        with patch.object(menu, 'http_get', return_value='{"new_format": []}'), contextlib.redirect_stderr(io.StringIO()):
            day = menu.collect_day('2026-10-17')
        self.assertEqual(day['sources']['ETH']['status'], 'parse_failed')


class OutputPreservationTests(unittest.TestCase):
    def test_http_and_parse_failures_preserve_all_previous_files(self):
        for failure in ('timeout', '404', 'changed detail'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                old = {name: 'previous valid ' + name for name in ('data.json', 'index.txt', 'index.html', 'app.js', 'style.css')}
                for name, contents in old.items():
                    (Path(directory) / name).write_text(contents)
                def get(url, **kwargs):
                    if 'idapps.ethz.ch' in url or url.endswith('/weekly'):
                        return replies()(url)
                    if failure == 'changed detail':
                        return fixture('uzh-changed.html')
                    raise menu.SourceError('request_failed', 'request', failure)
                with patch.object(menu, 'http_get', side_effect=get), patch.object(menu, '_current_date', return_value='2026-10-13'), \
                     patch.object(menu, 'OUTPUT_DIR', directory), contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaisesRegex(ValueError, 'UZH.*(request_failed|parse_failed)'):
                        menu.main()
                self.assertEqual({p.name: p.read_text() for p in Path(directory).iterdir()}, old)

    def test_template_failure_also_preserves_all_previous_files(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'data.json').write_text('previous valid data')
            with patch.object(menu, 'http_get', side_effect=replies()), patch.object(menu, '_current_date', return_value='2026-10-13'), \
                 patch.object(menu, 'OUTPUT_DIR', directory), patch.object(menu, 'TEMPLATE_DIR', directory), \
                 patch('menu_data.zurich_today', return_value='2026-10-13'):
                with self.assertRaises(OSError):
                    menu.main()
            self.assertEqual((Path(directory) / 'data.json').read_text(), 'previous valid data')

    def test_serialization_rejects_even_unexpected_nonfinite_metadata_before_writing(self):
        data = payload()
        data['extraMetadata'] = float('nan')
        with tempfile.TemporaryDirectory() as directory, patch.object(menu, 'OUTPUT_DIR', directory), \
             patch('menu_data.zurich_today', return_value='2026-10-13'):
            previous = Path(directory) / 'data.json'
            previous.write_text('previous valid data')
            with self.assertRaisesRegex(ValueError, 'JSON'):
                menu.publish_site(data)
            self.assertEqual(previous.read_text(), 'previous valid data')

    def test_successful_build_publishes_valid_whole_window_and_both_sources(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(menu, 'OUTPUT_DIR', directory), \
             patch.object(menu, '_current_date', return_value='2026-10-13'), patch('menu_data.zurich_today', return_value='2026-10-13'), \
             patch.object(menu, 'http_get', side_effect=replies()), contextlib.redirect_stdout(io.StringIO()):
            menu.main()
            data = guard.load_payload(Path(directory) / 'data.json')
            report = guard.validate_payload(data, expected_today='2026-10-13')
            self.assertEqual(report['dateCount'], 15)
            self.assertEqual(report['mensaCount'], 32)
            self.assertEqual(report['sources']['ETH']['status'], 'ok')
            self.assertEqual(report['sources']['UZH']['status'], 'ok')
            self.assertEqual({p.name for p in Path(directory).iterdir()}, {'data.json', 'index.txt', 'index.html', 'style.css', 'app.js', 'firebase-config.js', 'account-sync.mjs', 'nutrition.mjs', 'nutrition-core'})
            self.assertEqual({p.name for p in (Path(directory) / 'nutrition-core').iterdir()}, {'core.mjs', 'reference-data.mjs', 'hall.mjs'})
            adapter = (Path(directory) / 'nutrition.mjs').read_text()
            self.assertIn("from './nutrition-core/core.mjs?v=", adapter)
            self.assertNotIn('../zmittag-nutrition-core/', adapter)


class PublicationHealthTests(unittest.TestCase):
    def test_stale_build_is_rejected_even_with_complete_menus(self):
        with self.assertRaisesRegex(ValueError, 'date.*Europe/Zurich'):
            guard.validate_payload(payload(), expected_today='2026-10-14')

    def test_each_source_must_be_healthy_before_publication(self):
        data = payload(uzh='uzh-changed.html')
        with self.assertRaisesRegex(ValueError, '2026-10-13.*UZH.*parse_failed.*weekly'):
            guard.validate_payload(data, expected_today='2026-10-13')

    def test_unpublished_today_is_protected_even_when_other_source_has_meals(self):
        data = payload(eth='eth-unpublished.json')
        with self.assertRaisesRegex(ValueError, 'ETH.*not_published.*coverage'):
            guard.validate_payload(data, expected_today='2026-10-13')


class DateWindowTests(unittest.TestCase):
    def setUp(self):
        self.data = payload()
        menu._weekly_cache.clear()
        with patch.object(menu, 'http_get', side_effect=replies(eth='eth-empty.json')):
            self.data['days']['2026-10-17'] = menu.collect_day('2026-10-17')

    def validate(self):
        return guard.validate_payload(self.data, expected_today='2026-10-13')

    def test_legal_weekend_and_future_missing_optional_values_pass(self):
        self.data['days']['2026-10-20'] = copy.deepcopy(self.data['days']['2026-10-17'])
        future = self.data['days']['2026-10-20']
        future['mensas'][0]['meals']['Lunch'] = [{'dish': 'Future published meal'}]
        future['mensas'][0]['service']['status'] = 'ok'
        future['sources']['ETH'] = {'status': 'ok', 'dishCount': 1, 'issues': []}
        self.data['availableDates'].append('2026-10-20')
        self.assertEqual(self.validate()['dateCount'], 3)

    def test_captured_unpublished_future_responses_are_legal(self):
        menu._weekly_cache.clear()
        with patch.object(menu, 'http_get', side_effect=replies(eth='eth-unpublished.json', uzh='uzh-unpublished-week.html')):
            self.data['days']['2026-10-20'] = menu.collect_day('2026-10-20')
        self.assertEqual(self.validate()['dateCount'], 3)
        self.assertEqual(self.data['days']['2026-10-20']['sources']['ETH']['status'], 'not_published')

    def test_real_unsupported_future_details_are_blocked_with_date_source_and_stage(self):
        menu._weekly_cache.clear()
        def get(url, **kwargs):
            if '/weekly' in url:
                return fixture('uzh-weekly.html').replace('2026-10-13', '2026-10-19')
            return replies(detail='uzh-unsupported-detail.html')(url, **kwargs)
        with patch.object(menu, 'http_get', side_effect=get), contextlib.redirect_stderr(io.StringIO()):
            self.data['days']['2026-10-19'] = menu.collect_day('2026-10-19')
        self.data['availableDates'].append('2026-10-19')
        with self.assertRaisesRegex(ValueError, '2026-10-19.*UZH.*parse_failed.*detail.*menuItem'):
            self.validate()

    def test_bad_future_roster_fails_with_date_and_field(self):
        self.data['days']['2026-10-17']['mensas'] = [{'wrong': True}]
        with self.assertRaisesRegex(ValueError, '2026-10-17.*mensas'):
            self.validate()

    def test_duplicate_and_changed_ids_fail_in_future_day(self):
        for replacement, pattern in [('eth-1', 'duplicate'), ('eth-999', 'stable.*id')]:
            with self.subTest(replacement=replacement):
                self.data['days']['2026-10-17']['mensas'][1]['id'] = replacement
                with self.assertRaisesRegex(ValueError, '2026-10-17.*' + pattern):
                    self.validate()

    def test_invalid_future_meal_slot_fails(self):
        self.data['days']['2026-10-17']['mensas'][0]['meals']['Lunch'] = {}
        with self.assertRaisesRegex(ValueError, '2026-10-17.*eth-1.*meals.Lunch'):
            self.validate()

    def test_non_string_or_blank_dish_name_fails(self):
        for name in [None, 123, '', '   ']:
            with self.subTest(name=name):
                self.data['days']['2026-10-17']['mensas'][0]['meals']['Lunch'] = [{'dish': name}]
                with self.assertRaisesRegex(ValueError, '2026-10-17.*eth-1.*dish'):
                    self.validate()

    def test_nonfinite_price_and_nutrition_fail_with_field(self):
        dish = self.data['days']['2026-10-13']['mensas'][8]['meals']['Lunch'][0]
        for value in [float('nan'), float('inf'), -float('inf'), True, '6.10']:
            with self.subTest(value=value):
                dish['price'][0]['value'] = value
                with self.assertRaisesRegex(ValueError, '2026-10-13.*eth-9.*price.*value'):
                    self.validate()
        dish['price'][0]['value'] = 0
        dish['nutrition']['p100']['salt'] = float('nan')
        with self.assertRaisesRegex(ValueError, '2026-10-13.*eth-9.*nutrition.p100.salt'):
            self.validate()

    def test_index_is_exact_sorted_unique_menu_date_set(self):
        for dates in [['2026-10-13', '2026-10-99'], [], ['2026-10-13', '2026-10-13'], ['2026-10-13', '2026-10-17']]:
            with self.subTest(dates=dates):
                self.data['availableDates'] = dates
                with self.assertRaisesRegex(ValueError, 'availableDates'):
                    self.validate()

    def test_noncanonical_and_impossible_day_dates_fail(self):
        for iso in ['20261017', '2026-02-30', 'not-a-date']:
            with self.subTest(iso=iso):
                self.data['days'][iso] = self.data['days'].pop('2026-10-17', self.data['days'].get(iso, self.data['days']['2026-10-13']))
                with self.assertRaisesRegex(ValueError, 'days.*ISO'):
                    self.validate()
                del self.data['days'][iso]

    def test_huge_numeric_value_is_reported_as_a_field_error(self):
        dish = self.data['days']['2026-10-13']['mensas'][8]['meals']['Lunch'][0]
        dish['price'][0]['value'] = 10 ** 1000
        with self.assertRaisesRegex(ValueError, 'price.*value'):
            self.validate()

    def test_source_summary_cannot_claim_confirmed_empty_for_unpublished_date(self):
        future = self.data['days']['2026-10-17']
        future['mensas'][-1]['service']['status'] = 'not_published'
        with self.assertRaisesRegex(ValueError, '2026-10-17.*UZH.*status'):
            self.validate()


class NumericBoundaryTests(unittest.TestCase):
    def test_generic_parser_preserves_finite_zero_and_negative_numbers(self):
        for value, expected in [(0, 0), ('0', 0), ('12.5', 12.5), (' 1,25 ', 1.25), (-1, -1), ('', None), ('  ', None), (None, None)]:
            with self.subTest(value=value):
                self.assertEqual(menu._num(value), expected)

    def test_invalid_numbers_are_errors_not_missing_data(self):
        for value in ['NaN', 'Infinity', '-Infinity', float('nan'), float('inf'), True, 'oops', '1e999']:
            with self.subTest(value=value), self.assertRaises(menu.SourceError) as error:
                menu._num(value)
            self.assertEqual(error.exception.status, 'parse_failed')

    def test_source_zero_values_survive_json_and_raw_text(self):
        item = {'dish': {'stats': {'salt': {'unit': 'g', 'amountPer100g': '0', 'amount': 0}}},
                'prices': [{'amount': 0, 'currency': 'CHF'}]}
        html = '<script id="__NEXT_DATA__">' + json.dumps({'props': {'pageProps': {'menuItem': item}}}) + '</script>'
        with patch.object(menu, 'http_get', return_value=html):
            facts = menu.scrape_uzh_detail('https://example.com/detail')
        self.assertEqual(facts['price'][0]['value'], 0)
        self.assertEqual(facts['nutrition'], {'p100': {'salt': 0}, 'total': {'salt': 0}})
        self.assertEqual(menu.format_nutrition(facts['nutrition']['p100']), 'salt=0g')
        raw = json.loads(fixture('eth-normal.json'))
        raw['meals'][0].update({'salt': 0, 'meal-price-array': [{'price': '0', 'customer-group-code': 10}]})
        with patch.object(menu, 'http_get', return_value=json.dumps(raw)):
            dish = menu.fetch_eth('2026-10-13')[8]['meals']['Lunch'][0]
        self.assertEqual(dish['nutrition']['p100']['salt'], 0)
        self.assertEqual(dish['price'][0]['value'], 0)

    def test_illegal_price_nutrition_and_units_are_classified(self):
        cases = [({'prices': [{'amount': '-1'}]}, 'price'),
                 ({'dish': {'stats': {'salt': {'amount': '-1', 'unit': 'g'}}}}, 'salt'),
                 ({'dish': {'stats': {'fat': {'amountPer100g': 101, 'unit': 'g'}}}}, 'fat'),
                 ({'dish': {'stats': {'salt': {'amount': 1, 'unit': 'mg'}}}}, 'unit'),
                 ({'dish': {'stats': {'fat': {'amount': 21, 'unit': 'g'}, 'servingWeight': {'amount': 20, 'unit': 'g'}}}}, 'servingWeight')]
        for item, field in cases:
            html = '<script id="__NEXT_DATA__">' + json.dumps({'props': {'pageProps': {'menuItem': item}}}) + '</script>'
            with self.subTest(item=item), patch.object(menu, 'http_get', return_value=html):
                with self.assertRaisesRegex(menu.SourceError, field):
                    menu.scrape_uzh_detail('https://example.com/detail')

    def test_failed_build_does_not_overwrite_last_valid_output(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = Path(directory) / 'data.json'
            previous.write_text('{"last_valid": true}')
            def get(url, **kwargs):
                if 'idapps.ethz.ch' in url:
                    raw = json.loads(fixture('eth-normal.json'))
                    raw['meals'][0]['salt'] = 'NaN'
                    return json.dumps(raw)
                return fixture('uzh-empty.html') if url.endswith('/weekly') else fixture('uzh-missing-fields.html')
            with patch.object(menu, 'http_get', side_effect=get), patch.object(menu, '_current_date', return_value='2026-10-13'), \
                 patch.object(menu, 'OUTPUT_DIR', directory), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaisesRegex(ValueError, 'ETH.*parse_failed'):
                    menu.main()
            self.assertEqual(previous.read_text(), '{"last_valid": true}')


def closures_for(day):
    return [{'date': '2026-10-13', 'mensa': m['id'], 'reason': 'Fixture: confirmed campus closure',
             'evidence': {'kind': 'calendar', 'url': 'https://example.com/official-calendar', 'confirmedOn': '2026-10-12'}}
            for m in day['mensas']]


class ClosureTests(unittest.TestCase):
    def setUp(self):
        menu._weekly_cache.clear()

    def test_confirmed_closure_can_publish_an_empty_weekday(self):
        empty = payload(uzh='uzh-empty.html', eth='eth-empty.json')
        with patch.object(menu, 'http_get', side_effect=replies(uzh='uzh-empty.html', eth='eth-empty.json')):
            empty['days']['2026-10-13'] = menu.collect_day('2026-10-13', closures=closures_for(empty['days']['2026-10-13']))
        report = guard.validate_payload(empty, expected_today='2026-10-13')
        self.assertEqual(report['dishCount'], 0)
        self.assertEqual(report['sources']['ETH']['status'], 'confirmed_closed')
        self.assertEqual(report['sources']['UZH']['status'], 'confirmed_closed')
        self.assertEqual(empty['days']['2026-10-13']['mensas'][0]['service']['evidence']['kind'], 'calendar')

    def test_closure_cannot_relabel_source_failure_or_bypass_publication(self):
        empty = payload(uzh='uzh-empty.html', eth='eth-empty.json')
        for status, message in [('request_failed', 'timeout'), ('request_failed', '404'), ('parse_failed', 'structure changed')]:
            menu._weekly_cache.clear()
            def get(url, **kwargs):
                if 'idapps.ethz.ch' in url:
                    return fixture('eth-empty.json')
                raise menu.SourceError(status, 'request', message)
            with self.subTest(status=status, message=message), patch.object(menu, 'http_get', side_effect=get), contextlib.redirect_stderr(io.StringIO()):
                empty['days']['2026-10-13'] = menu.collect_day('2026-10-13', closures=closures_for(empty['days']['2026-10-13']))
                self.assertEqual(empty['days']['2026-10-13']['sources']['UZH']['status'], status)
                with self.assertRaisesRegex(ValueError, 'UZH.*' + status):
                    guard.validate_payload(empty, allow_empty_today=True, expected_today='2026-10-13')

    def test_closure_requires_evidence_and_no_conflicting_menu(self):
        good = payload()
        with patch.object(menu, 'http_get', side_effect=replies()):
            with self.assertRaisesRegex(ValueError, 'closure.*meals'):
                menu.collect_day('2026-10-13', closures=closures_for(good['days']['2026-10-13']))
        closed = copy.deepcopy(good)
        closed['days']['2026-10-13']['mensas'][0]['service'] = {'status': 'confirmed_closed'}
        with self.assertRaisesRegex(ValueError, 'service.*evidence'):
            guard.validate_payload(closed, expected_today='2026-10-13')

    def test_future_empty_remains_ordinary_empty_and_not_closed(self):
        with patch.object(menu, 'http_get', side_effect=replies(eth='eth-empty.json')):
            day = menu.collect_day('2026-10-17')
        self.assertEqual(day['sources']['UZH']['status'], 'confirmed_empty')
        self.assertTrue(all(m['service']['status'] != 'confirmed_closed' for m in day['mensas']))

    def test_invalid_empty_closure_object_is_not_treated_as_no_closures(self):
        with patch.object(menu, 'http_get', side_effect=replies()):
            with self.assertRaisesRegex(ValueError, 'closures.*array'):
                menu.collect_day('2026-10-13', closures={})

    def test_confirmed_empty_source_can_coexist_with_healthy_source(self):
        data = payload(uzh='uzh-empty.html')
        result = guard.validate_payload(data, expected_today='2026-10-13')
        self.assertEqual(result['sources']['UZH']['status'], 'confirmed_empty')
        self.assertEqual(result['sources']['ETH']['dishCount'], 1)

    def test_unconfirmed_empty_weekday_stays_blocked(self):
        data = payload(uzh='uzh-empty.html', eth='eth-empty.json')
        with self.assertRaisesRegex(ValueError, 'weekday.*no dishes'):
            guard.validate_payload(data, expected_today='2026-10-13')


if __name__ == '__main__':
    unittest.main()
