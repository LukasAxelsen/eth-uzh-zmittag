#!/usr/bin/env python3
"""Offline regressions for Food2050's published menu formats and Zurich dates."""

import importlib.util
import copy
import json
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("menu", ROOT / "menu.py")
menu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(menu)
FIXTURES = Path(__file__).with_name("fixtures")


class MenuRegressionTests(unittest.TestCase):
    def setUp(self):
        menu._weekly_cache.clear()
        clock = patch.object(menu, 'TODAY', '2026-10-13')
        clock.start()
        self.addCleanup(clock.stop)

    def test_weekly_urls_encode_the_food2050_organisation_comma(self):
        self.assertTrue(menu.UZH_WEEKLY_URLS)
        for slug, url in menu.UZH_WEEKLY_URLS.items():
            with self.subTest(slug=slug):
                self.assertIn("%2C", url)
                self.assertNotIn(",", url)

    def test_migrated_weekly_and_detail_pages(self):
        weekly = (FIXTURES / "uzh-weekly.html").read_text()
        detail = (FIXTURES / "uzh-detail.html").read_text()
        def get(url, **kwargs):
            return weekly if url.endswith("/weekly") else detail
        with patch.object(menu, "http_get", side_effect=get), \
             patch.object(menu, "TODAY", "2026-10-13"), \
             patch.object(menu, "UZH_LOCATIONS", {"zentrum": ("Central", {"untere-mensa": "Untere Mensa"})}):
            mensas = menu.fetch_uzh()
        dishes = mensas[0]["meals"]["Lunch"]
        self.assertEqual(len(dishes), 3)
        self.assertEqual(dishes[0]["dish"], "Tofu Ragout")
        self.assertEqual(dishes[0]["line"], "Garden")
        self.assertIn("Pastetli", dishes[0]["desc"])
        self.assertEqual(dishes[0]["nutrition"]["p100"]["kcal"], 132.5)
        self.assertEqual(dishes[0]["nutrition"]["total"]["weight"], 580)
        self.assertEqual(dishes[0]["price"][0], {"label": "STUD", "value": 6.1})
        self.assertIn("2026-10-13", dishes[0]["photo"])

    def test_future_date_uses_its_own_detail_page(self):
        weekly = (FIXTURES / "uzh-weekly.html").read_text().replace('2026-10-13', '2026-10-20')
        detail = (FIXTURES / "uzh-detail.html").read_text()
        urls = []
        def get(url, **kwargs):
            urls.append(url)
            return weekly if '/weekly' in url else detail
        with patch.object(menu, "http_get", side_effect=get):
            dishes = menu.scrape_uzh_date("untere-mensa", "2026-10-20")
        self.assertEqual(len(dishes), 3)
        self.assertTrue(urls[0].endswith('/weekly?week=43&year=2026'))
        self.assertTrue(all(u.endswith("/2026-10-20") for u in urls[1:]))

    def test_future_week_uses_only_its_published_dishes_and_links(self):
        current = (FIXTURES / 'uzh-weekly.html').read_text()
        future = (FIXTURES / 'uzh-oerlikon-next-week.html').read_text()
        detail = (FIXTURES / 'uzh-missing-fields.html').read_text()
        urls = []
        def get(url, **kwargs):
            urls.append(url)
            if '/weekly' in url:
                return future if '?week=43&year=2026' in url else current
            if ',butcher/2026-10-19' in url:
                return (FIXTURES / 'uzh-unsupported-detail.html').read_text()
            return detail
        with patch.object(menu, 'http_get', side_effect=get):
            dishes = menu.scrape_uzh_date('uzh-binzmuehle', '2026-10-19')
            menu.scrape_uzh_date('uzh-binzmuehle', '2026-10-20')
        self.assertEqual([d['dish'] for d in dishes], ['Springrolls', 'Offene Capuns'])
        self.assertEqual(sum('/weekly' in u for u in urls), 1, 'cache each outlet/week once')
        self.assertFalse(any(',butcher/2026-10-19' in u for u in urls))

    def test_future_dated_empty_week_does_not_probe_old_categories(self):
        empty = (FIXTURES / 'uzh-tierspital-next-week.html').read_text()
        urls = []
        def get(url, **kwargs):
            urls.append(url)
            return empty if '?week=43&year=2026' in url else (FIXTURES / 'uzh-weekly.html').read_text()
        with patch.object(menu, 'http_get', side_effect=get), \
             patch.object(menu, 'UZH_LOCATIONS', {'other': ('Other', {'tierspital': 'Tierspital Mensa'})}):
            mensa = menu.fetch_uzh('2026-10-19')[0]
        self.assertEqual(mensa['meals']['Lunch'], [])
        self.assertEqual(mensa['service']['status'], 'confirmed_empty')
        self.assertEqual(len(urls), 1)

    def test_week_query_uses_iso_year_at_new_year(self):
        weekly = (FIXTURES / 'uzh-empty.html').read_text().replace('2026-10-13', '2027-01-01')
        with patch.object(menu, 'http_get', return_value=weekly) as get:
            self.assertEqual(menu.scrape_uzh_date('untere-mensa', '2027-01-01'), [])
        self.assertTrue(get.call_args.args[0].endswith('/weekly?week=53&year=2026'))

    def test_empty_weekend_does_not_reuse_weekday_menus(self):
        with patch.object(menu, "http_get", return_value=(FIXTURES / "uzh-weekly.html").read_text()) as get:
            self.assertEqual(menu.scrape_uzh_date("untere-mensa", "2026-10-17"), [])
        self.assertEqual(get.call_count, 1)

    def test_legacy_next_data_still_loads(self):
        outlet = {"calendar": {"week": {"daily": [
            {"from": {"dateLocal": "2026-10-13T00:00:00+02:00"}, "menuItems": []}
        ]}}}
        payload = {"props": {"pageProps": {"organisation": {"outlet": outlet}}}}
        html = '<script type="application/json" id="__NEXT_DATA__">' + json.dumps(payload) + '</script>'
        with patch.object(menu, "http_get", return_value=html):
            self.assertEqual(menu._load_uzh_weekly("untere-mensa"), {"2026-10-13": []})

    def test_changed_detail_is_not_an_empty_menu(self):
        for html in ['<html>Not found</html>', '<script id="__NEXT_DATA__">{"props":{"pageProps":null}}</script>',
                     '<script id="__NEXT_DATA__">{"props":{"pageProps":{"organisation":42}}}</script>']:
            with self.subTest(html=html), patch.object(menu, 'http_get', return_value=html):
                with self.assertRaises(menu.SourceError) as error:
                    menu.scrape_uzh_detail('https://example.com/menu')
                self.assertEqual(error.exception.status, 'parse_failed')
                self.assertEqual(error.exception.stage, 'detail')

    def test_optional_detail_name_and_stats_do_not_hide_prices(self):
        item = {"dish": {"imageUrl": "https://example.com/photo.jpg"},
                "prices": [{"amount": "6.1", "priceCategory": {"name": "Studierende"}}]}
        payload = {"props": {"pageProps": {"organisation": {"outlet": {"menuCategory": {"menuItem": item}}}}}}
        html = '<script id="__NEXT_DATA__">' + json.dumps(payload) + '</script>'
        with patch.object(menu, "http_get", return_value=html):
            detail = menu.scrape_uzh_detail("https://example.com/menu")
        self.assertEqual(detail["price"], [{"label": "STUD", "value": 6.1}])
        self.assertEqual(detail["nutrition"], {"p100": {}, "total": {}})
        self.assertEqual(detail["photo"], "https://example.com/photo.jpg")

    def test_captured_garden_saturated_fat_is_grams_for_both_bases(self):
        with patch.object(menu, 'http_get', return_value=(FIXTURES / 'uzh-garden-detail.html').read_text()):
            detail = menu.scrape_uzh_detail('https://app.food2050.ch/de/zfv/universitat-zurich,campus-zentrum/untere-mensa/mittagsverpflegung,hauptspeisen,garden/2026-10-13')
        self.assertEqual(detail['nutrition']['p100']['saturated'], 2.0)
        self.assertEqual(detail['nutrition']['total']['saturated'], 11.42562)
        self.assertEqual(detail['nutrition']['total']['weight'], 580)

    def test_missing_saturated_fat_keeps_dishes_and_empty_cells(self):
        with patch.object(menu, 'http_get', return_value=(FIXTURES / 'uzh-detail.html').read_text()):
            dish = menu.build_uzh_dish_from_detail('https://example.com/garden/2026-10-13')
        self.assertEqual(dish['dish'], 'Tofu Ragout')
        self.assertNotIn('saturated', dish['nutrition']['p100'])
        self.assertNotIn('saturated', dish['nutrition']['total'])

    def test_future_absence_is_explicit_null_not_an_unknown_detail_shape(self):
        empty = '<script id="__NEXT_DATA__">{"props":{"pageProps":{"menuItem":null}}}</script>'
        with patch.object(menu, 'http_get', return_value=empty):
            self.assertIsNone(menu.build_uzh_dish_from_detail('https://example.com/garden/2026-10-20'))
        changed = '<script id="__NEXT_DATA__">{"props":{"pageProps":{"menuItem":{}}}}</script>'
        with patch.object(menu, 'http_get', return_value=changed):
            with self.assertRaisesRegex(menu.SourceError, 'dish.name'):
                menu.build_uzh_dish_from_detail('https://example.com/garden/2026-10-20')

    def test_captured_unpublished_week_is_distinct_from_empty_or_closed(self):
        with patch.object(menu, 'http_get', return_value=(FIXTURES / 'uzh-unpublished-week.html').read_text()), \
             patch.object(menu, 'UZH_LOCATIONS', {'zentrum': ('Central', {'obere-mensa': 'Obere Mensa'})}):
            mensa = menu.fetch_uzh('2026-10-13')[0]
        self.assertEqual(mensa['service']['status'], 'not_published')
        self.assertEqual(mensa['meals'], {'Lunch': [], 'Dinner': []})

    def test_missing_daily_without_explicit_unpublished_message_is_parse_failure(self):
        html = (FIXTURES / 'uzh-unpublished-week.html').read_text().replace('Für diese Woche ist kein Menüplan verfügbar.', 'Unknown new response')
        with patch.object(menu, 'http_get', return_value=html), \
             patch.object(menu, 'UZH_LOCATIONS', {'zentrum': ('Central', {'obere-mensa': 'Obere Mensa'})}):
            mensa = menu.fetch_uzh('2026-10-13')[0]
        self.assertEqual(mensa['service']['status'], 'parse_failed')

    def test_zurich_date_uses_winter_offset(self):
        instant = datetime(2026, 12, 1, 22, 30, tzinfo=ZoneInfo("UTC"))
        with patch.object(menu, "datetime") as clock:
            clock.now.side_effect = lambda tz: instant.astimezone(tz)
            self.assertEqual(menu._current_date(), "2026-12-01")
        instant = datetime(2026, 7, 1, 22, 30, tzinfo=ZoneInfo("UTC"))
        with patch.object(menu, "datetime") as clock:
            clock.now.side_effect = lambda tz: instant.astimezone(tz)
            self.assertEqual(menu._current_date(), "2026-07-02")


class ServingNutritionTests(unittest.TestCase):
    def test_only_missing_totals_are_calculated_and_zeros_survive(self):
        total, calculated = menu.complete_serving_nutrition(
            {'kcal': 120, 'protein': 8.427672, 'fat': 0, 'salt': 0.1},
            {'weight': 600, 'kcal': 685, 'protein': 48.20994, 'salt': 0})
        self.assertEqual(total, {'weight': 600, 'kcal': 685, 'protein': 48.20994, 'fat': 0, 'salt': 0})
        self.assertEqual(calculated, ['fat'])

    def test_unknown_or_zero_weight_never_infers_a_portion(self):
        for weight in (None, 0):
            total = {} if weight is None else {'weight': weight}
            self.assertEqual(menu.complete_serving_nutrition({'kcal': 120}, total), (total, []))

    def test_food2050_fallback_uses_unrounded_density_and_preserves_supplied_amount(self):
        facts = menu._uzh_item_facts({'dish': {'stats': {
            'servingWeight': {'amount': 580, 'unit': 'g'},
            'protein': {'amountPer100g': 4.607985416666667, 'unit': 'g'},
            'energy': {'amountPer100g': 121.2509875, 'amount': 582.00474, 'unit': 'kcal'},
        }}})['nutrition']
        self.assertEqual(facts['p100']['protein'], 4.6)
        self.assertAlmostEqual(facts['total']['protein'], 26.726315)
        self.assertEqual(facts['total']['kcal'], 582.00474)


class SVMenuTests(unittest.TestCase):
    def setUp(self):
        menu._sv_week_cache.clear()
        self.week = json.loads((FIXTURES / 'sv-polyterrasse-week.json').read_text())
        self.raw = (FIXTURES / 'eth-polyterrasse-2026-10-14.json').read_text()

    def fetch(self, document=None):
        def week(mid, year, week):
            self.assertEqual((year, week), (2026, 42))
            return (self.week if document is None else document) if mid == 18509 else None
        with patch.object(menu, 'http_get', return_value=self.raw), patch.object(menu, '_load_sv_week', side_effect=week):
            return menu.fetch_eth('2026-10-14')

    def test_captured_polyterrasse_matches_and_keeps_inconsistent_direct_values(self):
        mensas = self.fetch()
        self.assertEqual(len(mensas), 22)
        dishes = next(m for m in mensas if m['id'] == 'eth-9')['meals']['Lunch']
        piccata = next(d for d in dishes if d['dish'] == 'Piccata Milanese')
        self.assertEqual(piccata['nutrition']['total']['weight'], 600)
        self.assertEqual(piccata['nutrition']['total']['kcal'], 685)
        self.assertEqual(piccata['nutrition']['total']['protein'], 48.20994)
        self.assertEqual(piccata['nutritionSource']['productId'], 23701014)
        self.assertEqual(piccata['nutritionSource']['calculatedTotals'], [])
        self.assertIn('fiber', piccata['nutrition']['p100'])
        self.assertEqual(sum(bool(d['nutrition']['total']) for d in dishes), 5)
        buffet = next(d for d in dishes if d['dish'] == 'Hot & Cold Buffet')
        self.assertEqual(buffet['nutrition']['total'], {})

    def test_missing_serving_fields_use_weight_and_keep_other_serving_fields(self):
        product = self.week['Days'][0]['Categories'][0]['Products'][0]
        del product['NutritionFacts']['ProteinsPerServing']
        ds = next(m for m in self.fetch() if m['id'] == 'eth-9')['meals']['Lunch']
        dish = next(d for d in ds if d['dish'] == 'Piccata Milanese')
        self.assertAlmostEqual(dish['nutrition']['total']['protein'], 50.566032)
        self.assertEqual(dish['nutrition']['total']['kcal'], 685)
        self.assertEqual(dish['nutritionSource']['calculatedTotals'], ['protein'])

    def test_weight_only_source_can_complete_existing_cookpit_densities(self):
        nutrition, supplied, calculated = menu._sv_nutrition({'WeightInGrams': 450}, {'kcal': 120, 'protein': 5, 'salt': 0})
        self.assertEqual(nutrition['total'], {'weight': 450, 'kcal': 540, 'protein': 22.5, 'salt': 0})
        self.assertEqual(supplied, [])
        self.assertEqual(calculated, ['kcal', 'protein', 'salt'])

    def test_zero_weight_and_all_zero_sv_facts_are_unknown_buffet(self):
        nutrition, supplied, calculated = menu._sv_nutrition({'WeightInGrams': 0, 'NutritionFacts': {
            'KCalPer100': 0, 'KCalPerServing': 0, 'ProteinsPer100': 0, 'ProteinsPerServing': 0,
        }}, {'kcal': 123})
        self.assertEqual(nutrition, {'p100': {'kcal': 123}, 'total': {}})
        self.assertEqual((supplied, calculated), ([], []))

    def test_matching_allows_ingredient_order_and_explicit_long_truncation_only(self):
        product = {'Id': 1, 'Name': 'Bowl', 'Teaser': 'Tofu | Rice | Sauce'}
        doc = {'StoreId': 42014, 'MenuCardId': 18514, 'Days': [{'Date': '2026-10-15',
            'Categories': [{'Name': 'WORLD', 'Products': [product]}]}]}
        products = menu._sv_products(doc, 42014, 18514, '2026-10-15')
        dish = {'line': "Viola's Diner 2", 'dish': 'Bowl', 'desc': 'Rice | Sauce | Tofu'}
        self.assertEqual(menu._sv_match(products, dish, 11), (product, 'ingredient-order'))
        self.assertEqual(menu._sv_match(products, dish, 9), (None, None))
        dish['desc'] = 'Tofu | Rice | Rice | Sauce'
        self.assertEqual(menu._sv_match(products, dish, 11), (None, None))
        product['Teaser'] = 'Frikadelle | Sriracha Mayo oder Sesam Wasabi Sauce | Basmatireis oder Quinoa | Süsskartoffeln | Kale | Coleslaw'
        products = menu._sv_products(doc, 42014, 18514, '2026-10-15')
        dish['desc'] = product['Teaser'][:100] + '..'
        self.assertEqual(menu._sv_match(products, dish, 11), (product, 'truncated-description'))
        dish['desc'] = 'Frikadelle..'
        self.assertEqual(menu._sv_match(products, dish, 11), (None, None))
        dish['desc'] = product['Teaser'][:100]  # no source truncation marker
        self.assertEqual(menu._sv_match(products, dish, 11), (None, None))

    def test_kj_is_converted_only_when_kcal_is_absent(self):
        nutrition, _, _ = menu._sv_nutrition({'WeightInGrams': 400, 'NutritionFacts': {
            'KJPer100': 418.4, 'KJPerServing': 1673.6,
        }}, {})
        self.assertEqual(nutrition, {'p100': {'kcal': 100}, 'total': {'kcal': 400, 'weight': 400}})

    def test_different_date_line_name_sides_or_duplicate_never_join(self):
        for mutation in ('date', 'line', 'name', 'sides', 'duplicate'):
            document = copy.deepcopy(self.week)
            day = document['Days'][0]
            cat = day['Categories'][0]
            product = cat['Products'][0]
            if mutation == 'date': day['Date'] = '2026-10-15T00:00:00Z'
            if mutation == 'line': cat['Name'] = 'OTHER'
            if mutation == 'name': product['Name'] += ' (vegetarisch)'
            if mutation == 'sides': product['Teaser'] += ' | Salat'
            if mutation == 'duplicate': cat['Products'].append(copy.deepcopy(product))
            with self.subTest(mutation=mutation):
                dishes = next(m for m in self.fetch(document) if m['id'] == 'eth-9')['meals']['Lunch']
                dish = next(d for d in dishes if d['dish'] == 'Piccata Milanese')
                self.assertNotIn('nutritionSource', dish)
                self.assertEqual(dish['nutrition']['total'], {})

    def test_wrong_store_or_menu_is_an_explicit_source_failure(self):
        for key in ('StoreId', 'MenuCardId'):
            document = copy.deepcopy(self.week)
            document[key] += 1
            with self.subTest(key=key):
                mensa = next(m for m in self.fetch(document) if m['id'] == 'eth-9')
                self.assertEqual(mensa['service']['status'], 'parse_failed')
                self.assertTrue(mensa['meals']['Lunch'])

    def test_sv_failure_keeps_menus_but_blocks_publication(self):
        with patch.object(menu, 'http_get', return_value=self.raw), patch.object(menu, '_load_sv_week',
                side_effect=menu.SourceError('request_failed', 'sv-menu', 'SV unavailable')):
            mensas = menu.fetch_eth('2026-10-14')
        self.assertEqual(len(mensas), 22)
        self.assertEqual(menu.source_summary(mensas)['status'], 'request_failed')
        self.assertEqual(menu.source_summary(mensas)['issues'][0]['stage'], 'sv-menu')

    def test_week_cache_uses_iso_year_and_caches_missing_documents(self):
        client = Mock()
        client.week.return_value = None
        with patch.object(menu, '_sv_client', client):
            menu._load_sv_week(18509, 2026, 42)
            menu._load_sv_week(18509, 2026, 42)
            menu._load_sv_week(18509, 2026, 43)
        self.assertEqual(client.week.call_count, 2)
        mensa = {'id': 'eth-9', 'meals': {'Lunch': [{'line': '', 'dish': '', 'desc': ''}], 'Dinner': []}}
        with patch.object(menu, '_load_sv_week', return_value=None) as load:
            menu.enrich_eth_nutrition([mensa], '2027-01-01')
        load.assert_called_once_with(18509, 2026, 53)

    def test_invalid_numeric_values_fail_instead_of_populating_totals(self):
        original = self.week['Days'][0]['Categories'][0]['Products'][0]
        for field, value in [('WeightInGrams', -1), ('KCalPerServing', float('nan')),
                             ('FatsPer100', 101), ('ProteinsPerServing', 601)]:
            product = copy.deepcopy(original)
            if field == 'WeightInGrams': product[field] = value
            else: product['NutritionFacts'][field] = value
            with self.subTest(field=field), self.assertRaises(menu.SourceError):
                menu._sv_nutrition(product, {})


class SVTransportTests(unittest.TestCase):
    def test_current_bundle_discovery_guest_session_and_published_document(self):
        from sv_menu import PublicMenus
        path = 'projects/test-sv/databases/(default)/documents/Release/de-CH/Menus/18509/Years/2026/Weeks/42'
        def get(url, **kwargs):
            if url.endswith('.ch/'):
                return '<script src="main-CURRENT.js"></script>'
            if url.endswith('main-CURRENT.js'):
                return 'import{a}from"./chunk-CONFIG.js";'
            if url.endswith('chunk-CONFIG.js'):
                return 'apiKey:"public-client-key",projectId:"test-sv",brand:"test",appsApi:{baseUrl:"https://apps-live-eu.qnips.com/cons/api",authHeader:"public-guest-header"}'
            self.assertEqual(kwargs['headers']['Authorization'], 'public-guest-header')
            return json.dumps({'Environment': 'Release', 'CustomToken': 'ephemeral-custom-token'})
        def post(url, body, headers=None):
            if 'identitytoolkit' in url:
                self.assertEqual(json.loads(body)['token'], 'ephemeral-custom-token')
                return {'idToken': 'ephemeral-id-token', 'expiresIn': '3600'}
            self.assertEqual(json.loads(body), {'documents': [path]})
            self.assertEqual(headers['Authorization'], 'Bearer ephemeral-id-token')
            return [{'found': {'name': path, 'fields': {'Days': {'arrayValue': {}},
                'StoreId': {'integerValue': '42009'}, 'MenuCardId': {'integerValue': '18509'}}}}]
        client = PublicMenus(get, Mock(side_effect=post))
        self.assertEqual(client.week(18509, 2026, 42)['StoreId'], 42009)
        client.week(18509, 2026, 42)
        self.assertEqual(client.post.call_count, 3)  # sign-in once, document twice

    def test_explicit_missing_document_is_not_a_transport_failure(self):
        from sv_menu import PublicMenus
        path = 'projects/test-sv/databases/(default)/documents/Release/de-CH/Menus/18509/Years/2026/Weeks/43'
        client = PublicMenus(Mock(), Mock(return_value=[{'missing': path}]))
        client.config = {'projectId': 'test-sv'}
        client.token = 'test-token'
        with patch.object(client, '_session'):
            self.assertIsNone(client.week(18509, 2026, 43))
            client.post.return_value = {}
            with self.assertRaisesRegex(ValueError, 'invalid published menu'):
                client.week(18509, 2026, 43)


if __name__ == "__main__":
    unittest.main()
