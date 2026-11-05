// ETH uploads some photos after the static build. Refresh only missing photos
// from the public, CORS-enabled Cookpit API; menu/nutrition data stays untouched.
const ROOT = 'https://idapps.ethz.ch/cookpit-pub-services/v1/';
const REFRESH_MS = 5 * 60 * 1000;

function sourceKey(source) {
  if (!source || !Number.isInteger(source.mealTimeId) || !Number.isInteger(source.lineId) ||
      typeof source.mealName !== 'string' || typeof source.description !== 'string') return null;
  return JSON.stringify([source.mealTimeId, source.lineId, source.mealName, source.description]);
}

function photoURL(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (url.origin !== 'https://idapps.ethz.ch' || !/^\/cookpit-pub-services\/v1\/images\/\d+$/.test(url.pathname)) return '';
    url.searchParams.set('client-id', 'ethz-wcms');
    return url.href;
  } catch { return ''; }
}

/** Return photo patches for exact source identities, never names alone. */
function photoUpdates(mensas, date, payload) {
  if (!Array.isArray(payload?.meals) || !Array.isArray(payload?.['meal-times'])) return [];
  const times = new Map();
  for (const time of payload['meal-times']) {
    if (time?.date !== date || !Number.isInteger(time['facility-id'])) continue;
    const name = time['meal-time-name'];
    if (typeof name !== 'string') continue;
    const slot = /Abend|Dinner/.test(name) ? 'Dinner' : /Mittag|Lunch/.test(name) ? 'Lunch' : null;
    if (slot) times.set(time['meal-time-id'], {id: 'eth-' + time['facility-id'], slot});
  }
  const photos = new Map();
  for (const meal of payload.meals) {
    const time = times.get(meal?.['meal-time-id']);
    if (!time) continue;
    const key = sourceKey({mealTimeId: meal['meal-time-id'], lineId: meal['line-id'],
      mealName: meal['meal-name'], description: meal.description || ''});
    if (!key) continue;
    const identity = JSON.stringify([time.id, time.slot, key]);
    // Duplicate identities are ambiguous even if only one includes a photo.
    photos.set(identity, photos.has(identity) ? '' : photoURL(meal['image-url']));
  }
  const updates = [];
  for (const mensa of mensas) {
    if (!mensa.id.startsWith('eth-')) continue;
    for (const slot of ['Lunch', 'Dinner']) {
      for (const dish of mensa.meals[slot] || []) {
        if (dish.photo) continue;
        const key = sourceKey(dish.photoSource);
        const photo = key && photos.get(JSON.stringify([mensa.id, slot, key]));
        if (photo) updates.push({dish, photo});
      }
    }
  }
  return updates;
}

/** One request per date per five minutes, including failures; no DOM access. */
export function createEthPhotoRefresher({fetcher = fetch, now = Date.now} = {}) {
  const attempted = new Map(), pending = new Set();
  return async (mensas, date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || pending.has(date) ||
        (attempted.has(date) && now() - attempted.get(date) < REFRESH_MS) ||
        !mensas.some(m => m.id.startsWith('eth-') && ['Lunch', 'Dinner'].some(slot =>
          (m.meals[slot] || []).some(d => !d.photo && sourceKey(d.photoSource))))) return [];
    attempted.set(date, now());
    pending.add(date);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const url = new URL('meals', ROOT);
      url.search = new URLSearchParams({'client-id': 'ethz-wcms', lang: 'de', date, 'facility-id': '9',
        'meal-times-after': date + 'T00:00:00Z', 'meal-times-before': date + 'T23:59:59Z'}).toString();
      const response = await fetcher(url.href, {cache: 'no-cache', credentials: 'omit', signal: controller.signal});
      return response.ok ? photoUpdates(mensas, date, await response.json()) : [];
    } catch {
      // Missing/late photos and a temporarily unavailable source are optional.
      return [];
    } finally {
      clearTimeout(timer);
      pending.delete(date);
    }
  };
}
