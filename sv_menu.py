"""Read SV's public Qnips menus using the website's guest session.

Only public Release documents are read. Client configuration is discovered
from the current website bundle; guest credentials stay in memory.
"""
import json
import re
import time
from urllib.parse import urljoin

SITE = 'https://sv-gastronomie.ch/'


def decode_value(value):
    """Decode the Firestore REST value envelope, without guessing types."""
    if not isinstance(value, dict) or len(value) != 1:
        raise ValueError('SV: invalid Firestore value')
    kind, item = next(iter(value.items()))
    if kind == 'nullValue':
        return None
    if kind in ('stringValue', 'timestampValue', 'booleanValue'):
        return item
    if kind == 'integerValue':
        return int(item)
    if kind == 'doubleValue':
        return float(item)
    if kind == 'arrayValue':
        return [decode_value(v) for v in item.get('values', [])]
    if kind == 'mapValue':
        return {k: decode_value(v) for k, v in item.get('fields', {}).items()}
    raise ValueError(f'SV: unsupported Firestore value type {kind}')


class PublicMenus:
    def __init__(self, get, post):
        self.get, self.post = get, post
        self.config = None
        self.token = None
        self.expires = 0

    def _configuration(self):
        html = self.get(SITE)
        scripts = re.findall(r'<script\b[^>]*\bsrc=["\']([^"\']+\.js)["\']', html)
        queue = [urljoin(SITE, s) for s in scripts if s.startswith('main-')]
        visited, config = set(), {}
        while queue and len(visited) < 80:
            url = queue.pop()
            if url in visited or not url.startswith(SITE):
                continue
            visited.add(url)
            source = self.get(url)
            for key in ('apiKey', 'projectId', 'brand', 'baseUrl', 'authHeader'):
                found = re.search(r'\b' + key + r':"([^"\n]+)"', source)
                if found:
                    config[key] = found[1]
            if all(k in config for k in ('apiKey', 'projectId', 'brand', 'baseUrl', 'authHeader')):
                if (not re.fullmatch(r'[a-z0-9-]+', config['projectId']) or
                        not re.fullmatch(r'https://apps-[a-z-]+\.qnips\.com/cons/api', config['baseUrl'])):
                    raise ValueError('SV: unexpected public client configuration')
                return config
            # Foundation/configuration chunks occur last in Angular imports.
            queue.extend(urljoin(url, s) for s in re.findall(
                r'(?:from|import)"(\./[^"/]+\.js)"', source))
        raise ValueError('SV: public client configuration was not found')

    def _session(self):
        if self.token and time.monotonic() < self.expires:
            return
        if self.config is None:
            self.config = self._configuration()
        cfg = self.config
        # Use exactly the unauthenticated visitor route used by the SV site.
        guest = json.loads(self.get(cfg['baseUrl'] + '/FirebaseInfo', headers={
            'Authorization': cfg['authHeader'], 'App-Brand': cfg['brand'],
            'Response-Version': 'v3', 'Accept-Language': 'de-CH',
        }))
        if not isinstance(guest, dict) or guest.get('Environment') != 'Release' or not guest.get('CustomToken'):
            raise ValueError('SV: public guest session is unavailable')
        session = self.post(
            'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + cfg['apiKey'],
            json.dumps({'token': guest['CustomToken'], 'returnSecureToken': True}),
        )
        if not isinstance(session, dict) or not session.get('idToken'):
            raise ValueError('SV: public guest sign-in failed')
        self.token = session['idToken']
        self.expires = time.monotonic() + min(float(session.get('expiresIn', 3600)), 3600) - 60

    def week(self, menu_id, year, week):
        self._session()
        root = f"projects/{self.config['projectId']}/databases/(default)/documents"
        path = f'{root}/Release/de-CH/Menus/{menu_id}/Years/{year}/Weeks/{week}'
        # batchGet represents an unpublished document as `missing` in a 200
        # response, keeping absence distinct from HTTP/authentication failures.
        response = self.post('https://firestore.googleapis.com/v1/' + root + ':batchGet',
                             json.dumps({'documents': [path]}),
                             headers={'Authorization': 'Bearer ' + self.token})
        if not isinstance(response, list) or len(response) != 1:
            raise ValueError('SV: invalid published menu response')
        record = response[0]
        if not isinstance(record, dict):
            raise ValueError('SV: invalid published menu record')
        if record.get('missing') == path:
            return None
        found = record.get('found', {})
        if not isinstance(found, dict) or found.get('name') != path or not isinstance(found.get('fields'), dict):
            raise ValueError('SV: unexpected published menu document')
        return {k: decode_value(v) for k, v in found['fields'].items()}
