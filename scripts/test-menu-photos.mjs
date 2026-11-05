// Replay the actual scraper -> static snapshot -> late official upload path.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createEthPhotoRefresher} from '../template/menu-photos.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const payload = JSON.parse(readFileSync(new URL('./fixtures/eth-archimedes-2026-11-05.json', import.meta.url)));
const snapshot = JSON.parse(execFileSync('python3', ['-c', `
import json
from pathlib import Path
from unittest.mock import patch
import menu
raw = json.loads(Path('scripts/fixtures/eth-archimedes-2026-11-05.json').read_text())
for dish in raw['meals']: dish['image-url'] = ''
with patch.object(menu, 'http_get', return_value=json.dumps(raw)), patch.object(menu, '_load_sv_week', return_value=None):
    print(json.dumps(menu.fetch_eth('2026-11-05')))
`], {cwd: root, encoding: 'utf8'}));
const copy = value => structuredClone(value);
const archimedes = mensas => mensas.find(m => m.id === 'eth-8').meals.Lunch;
const response = data => ({ok: true, json: async () => data});

let calls = 0, clock = 0;
const refresh = createEthPhotoRefresher({now: () => clock, fetcher: async (url, options) => {
  calls++;
  assert.equal(new URL(url).searchParams.get('date'), '2026-11-05');
  assert.equal(options.cache, 'no-cache');
  assert.equal(options.credentials, 'omit');
  return response(payload);
}});
const mensas = copy(snapshot);
assert.ok(archimedes(mensas).every(d => d.photo === ''));
const updates = await refresh(mensas, '2026-11-05');
assert.equal(updates.length, 4, 'late Archimedes uploads fill all four matching dishes');
assert.equal(updates[0].dish, archimedes(mensas)[0], 'patch refers to the existing state record');
assert.equal(updates[0].photo, 'https://idapps.ethz.ch/cookpit-pub-services/v1/images/78432?client-id=ethz-wcms');
assert.ok(archimedes(mensas).every(d => d.photo === ''), 'source reader does not mutate app state');
await refresh(mensas, '2026-11-05');
assert.equal(calls, 1, 'repeated focus/timer events are throttled');
clock = 5 * 60 * 1000;
await refresh(mensas, '2026-11-05');
assert.equal(calls, 2, 'retry after five minutes can discover later uploads');
for (const {dish, photo} of updates) dish.photo = photo;
clock *= 2;
assert.deepEqual(await refresh(mensas, '2026-11-05'), []);
assert.equal(calls, 2, 'complete photos need no source request');

for (const [label, mutate] of [
  ['different date', p => { p['meal-times'][0].date = '2026-11-04'; }],
  ['different restaurant', p => { p['meal-times'][0]['facility-id'] = 9; }],
  ['different slot', p => { p['meal-times'][0]['meal-time-name'] = 'Abend'; }],
  ['changed line', p => { p.meals.forEach(m => m['line-id']++); }],
  ['changed name', p => { p.meals.forEach(m => m['meal-name'] += ' vegan'); }],
  ['changed recipe', p => { p.meals.forEach(m => m.description += ' | Neue Sauce'); }],
  ['duplicate identities', p => { p.meals.push(...copy(p.meals)); }],
  ['missing images', p => { p.meals.forEach(m => m['image-url'] = null); }],
  ['untrusted image source', p => { p.meals.forEach(m => m['image-url'] = 'https://example.com/photo.jpg'); }],
]) {
  const changed = copy(payload); mutate(changed);
  const read = createEthPhotoRefresher({fetcher: async () => response(changed)});
  assert.deepEqual(await read(copy(snapshot), '2026-11-05'), [], label);
}

const partial = copy(snapshot);
archimedes(partial)[0].photo = 'https://example.com/existing.jpg';
const read = createEthPhotoRefresher({fetcher: async () => response(payload)});
assert.equal((await read(partial, '2026-11-05')).length, 3, 'published photos remain untouched');

for (const failure of [async () => { throw Error('offline'); }, async () => ({ok: false}),
  async () => response({}), async () => ({ok: true, json: async () => {throw Error('invalid JSON');}})]) {
  let failures = 0;
  const read = createEthPhotoRefresher({fetcher: async () => {failures++; return failure();}});
  assert.deepEqual(await read(copy(snapshot), '2026-11-05'), []);
  assert.deepEqual(await read(copy(snapshot), '2026-11-05'), []);
  assert.equal(failures, 1, 'failures are quiet and throttled');
}
let finish, pendingCalls = 0;
const pending = createEthPhotoRefresher({fetcher: () => {
  pendingCalls++;
  return new Promise(resolve => {finish = resolve;});
}});
const first = pending(copy(snapshot), '2026-11-05');
assert.deepEqual(await pending(copy(snapshot), '2026-11-05'), []);
finish(response(payload));
assert.equal((await first).length, 4);
assert.equal(pendingCalls, 1, 'in-flight requests coalesce');

console.log('PASS: late Archimedes photos, exact date/restaurant/slot/recipe identity, reused state, throttling, concurrency and offline fallback');
