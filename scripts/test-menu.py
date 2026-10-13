#!/usr/bin/env python3
"""Offline regressions for Food2050's published menu formats and Zurich dates."""

import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("menu", ROOT / "menu.py")
menu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(menu)
FIXTURES = Path(__file__).with_name("fixtures")


class MenuRegressionTests(unittest.TestCase):
    def setUp(self):
        menu._weekly_cache.clear()

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
        weekly = (FIXTURES / "uzh-weekly.html").read_text()
        detail = (FIXTURES / "uzh-detail.html").read_text()
        urls = []
        def get(url, **kwargs):
            urls.append(url)
            return weekly if url.endswith("/weekly") else detail
        with patch.object(menu, "http_get", side_effect=get):
            dishes = menu.scrape_uzh_date("untere-mensa", "2026-10-20")
        self.assertEqual(len(dishes), 3)
        self.assertTrue(all(u.endswith("/2026-10-20") for u in urls[1:]))

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

    def test_unavailable_detail_has_complete_empty_shape(self):
        with patch.object(menu, "http_get", return_value="<html>Not found</html>"):
            self.assertEqual(menu.scrape_uzh_detail("https://example.com/menu"), {
                "photo": "", "price": [], "nutrition": {"p100": {}, "total": {}}
            })

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

    def test_zurich_date_uses_winter_offset(self):
        instant = datetime(2026, 12, 1, 22, 30, tzinfo=ZoneInfo("UTC"))
        with patch.object(menu, "datetime") as clock:
            clock.now.side_effect = lambda tz: instant.astimezone(tz)
            self.assertEqual(menu._current_date(), "2026-12-01")
        instant = datetime(2026, 7, 1, 22, 30, tzinfo=ZoneInfo("UTC"))
        with patch.object(menu, "datetime") as clock:
            clock.now.side_effect = lambda tz: instant.astimezone(tz)
            self.assertEqual(menu._current_date(), "2026-07-02")


if __name__ == "__main__":
    unittest.main()
