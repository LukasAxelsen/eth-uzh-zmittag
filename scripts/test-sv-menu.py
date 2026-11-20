#!/usr/bin/env python3
"""SV website-format and live-check regressions; no network or real credentials."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import menu
from sv_menu import PublicMenus, SITE

CONFIG = (Path(__file__).with_name('fixtures') / 'sv-client-config-2026-11-20.js').read_text()
DOCUMENT = 'projects/fixture-sv/databases/(default)/documents/Release/de-CH/Menus/18509/Years/2026/Weeks/47'


def client_for(config=CONFIG, script='main-CURRENT.js', imports='import{c}from"./chunk-CONFIG.js";'):
    pages = {SITE: f'<script src="{script}"></script>',
             SITE + 'main-CURRENT.js': imports, SITE + 'chunk-CONFIG.js': config,
             'https://apps-live-eu.qnips.com/cons/api/FirebaseInfo': json.dumps({
                 'Environment': 'Release', 'CustomToken': 'fixture-custom-token'})}
    def post(url, body, headers=None):
        if url.startswith('https://identitytoolkit.googleapis.com/'):
            return {'idToken': 'fixture-id-token', 'expiresIn': '3600'}
        return [{'found': {'name': DOCUMENT, 'fields': {
            'StoreId': {'integerValue': '42009'}, 'MenuCardId': {'integerValue': '18509'},
            'Days': {'arrayValue': {}}}}}]
    return PublicMenus(Mock(side_effect=lambda url, **kw: pages[url]), Mock(side_effect=post))


class SVConfigurationTests(unittest.TestCase):
    def test_november_20_bundle_reaches_published_menu(self):
        # Same boundary as production: discover config -> guest sign-in -> week.
        client = client_for()
        self.assertEqual(client.week(18509, 2026, 47), {
            'StoreId': 42009, 'MenuCardId': 18509, 'Days': []})
        self.assertEqual(client.post.call_count, 2)
        self.assertEqual(json.loads(client.post.call_args.args[1]), {'documents': [DOCUMENT]})
        self.assertEqual(client.post.call_args.kwargs['headers'], {'Authorization': 'Bearer fixture-id-token'})

    def test_static_quote_styles_and_whitespace(self):
        for quote in ('"', "'", '`'):
            for quoted_keys in (False, True):
                config = CONFIG.replace('`', quote)
                for key in ('brand', 'baseUrl', 'authHeader', 'apiKey', 'projectId'):
                    config = config.replace(key + ':', ('"' + key + '"' if quoted_keys else key) + ' :\n ')
                with self.subTest(quote=quote, quoted_keys=quoted_keys):
                    self.assertEqual(client_for(config)._configuration()['projectId'], 'fixture-sv')

    def test_script_paths_and_import_quote_styles(self):
        for script in ('main-CURRENT.js', './main-CURRENT.js', '/main-CURRENT.js', SITE + 'main-CURRENT.js'):
            for quote in ('"', "'"):
                with self.subTest(script=script, quote=quote):
                    imports = 'import {c} from ' + quote + './chunk-CONFIG.js' + quote + ';'
                    self.assertEqual(client_for(script=script, imports=imports)._configuration()['brand'], 'fixture-brand')

    def test_dynamic_or_escaped_values_are_not_used_as_credentials(self):
        for expression in ('`${runtimeSecret}`', '"prefix" + runtimeSecret', r'"escaped\x20value"'):
            client = client_for(CONFIG.replace('`fixture-public-header`', expression))
            with self.subTest(expression=expression), self.assertRaisesRegex(ValueError, 'configuration'):
                client.week(18509, 2026, 47)
            client.post.assert_not_called()

    def test_external_scripts_and_imports_are_not_followed(self):
        for kwargs in ({'script': 'https://example.com/main-CURRENT.js'},
                       {'imports': 'import{c}from"https://example.com/config.js";'}):
            client = client_for(**kwargs)
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(ValueError, 'configuration'):
                client._configuration()
            self.assertTrue(all(call.args[0].startswith(SITE) for call in client.get.call_args_list))

    def test_import_cycles_stop_and_do_not_refetch(self):
        client = client_for(config='import{c}from"./main-CURRENT.js";')
        with self.assertRaisesRegex(ValueError, 'configuration'):
            client._configuration()
        self.assertEqual(client.get.call_count, 3)

    def test_unexpected_configuration_origin_is_rejected(self):
        client = client_for(CONFIG.replace('https://apps-live-eu.qnips.com/cons/api', 'https://example.com/api'))
        with self.assertRaisesRegex(ValueError, 'unexpected public client configuration'):
            client.week(18509, 2026, 47)
        client.post.assert_not_called()

    def test_build_error_identifies_configuration_without_leaking_credentials(self):
        with patch.object(menu, '_sv_client', client_for(config='const config={};')), \
             patch.object(menu, '_sv_week_cache', {}):
            with self.assertRaises(menu.SourceError) as caught:
                menu._load_sv_week(18509, 2026, 47)
        self.assertIn('configuration', str(caught.exception))
        self.assertNotIn('fixture-public-header', str(caught.exception))
        self.assertNotIn('fixture-id-token', str(caught.exception))

    def test_unexpected_error_text_is_not_logged(self):
        client = Mock()
        client.week.side_effect = ValueError('sensitive response: fixture-secret')
        with patch.object(menu, '_sv_client', client), patch.object(menu, '_sv_week_cache', {}):
            with self.assertRaises(menu.SourceError) as caught:
                menu._load_sv_week(18509, 2026, 47)
        self.assertNotIn('fixture-secret', str(caught.exception))


class LiveCheckExitTests(unittest.TestCase):
    def test_eth_failure_status_fails_live_check(self):
        spec = importlib.util.spec_from_file_location('smoke_menu', ROOT / 'scripts/smoke-menu.py')
        smoke = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(smoke)
        for status in ('parse_failed', 'request_failed', 'ok', 'not_published', 'confirmed_empty'):
            with self.subTest(status=status), patch.object(sys, 'argv', ['smoke-menu.py', '--source', 'ETH']), \
                 patch.object(smoke.menu, 'fetch_eth', return_value=[]), \
                 patch.object(smoke.menu, 'source_summary', return_value={'status': status}), \
                 contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(smoke.main(), 1 if status.endswith('_failed') else 0)


if __name__ == '__main__':
    unittest.main()
