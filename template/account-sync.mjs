// Account transport is isolated from the page and animation pipeline.
// The personal nutrition profile shares the same document and conflict choice.
import {DEFAULT_NUTRITION, validNutritionPreferences} from './nutrition.mjs';
const KEYS = ['meal', 'selected', 'photos', 'openingTimes', 'prices', 'theme', 'customGroups', 'hiddenGroups', 'collapsedMensas', 'userProfile', 'nutritionSettings'];
const withDefaults = value => ({hiddenGroups: [], userProfile: {}, nutritionSettings: {...DEFAULT_NUTRITION}, ...value});
const copy = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const changed = (before, after) => Object.fromEntries(KEYS.filter(key => Object.hasOwn(after, key) && !same(before[key], after[key])).map(key => [key, after[key]]));

function validPreferences(p) {
  return p && typeof p === 'object' && ['Lunch', 'Dinner'].includes(p.meal) &&
    validNutritionPreferences(p) &&
    ['light', 'dark', 'auto'].includes(p.theme) &&
    ['photos', 'openingTimes', 'prices'].every(key => typeof p[key] === 'boolean') &&
    ['selected', 'collapsedMensas'].every(key => Array.isArray(p[key]) && p[key].length <= 64 && p[key].every(id => typeof id === 'string')) &&
    (p.hiddenGroups === undefined || (Array.isArray(p.hiddenGroups) && p.hiddenGroups.length <= 64 && p.hiddenGroups.every(name => typeof name === 'string'))) &&
    p.customGroups && typeof p.customGroups === 'object' && !Array.isArray(p.customGroups) &&
    Object.keys(p.customGroups).length <= 50 && Object.values(p.customGroups).every(ids =>
      Array.isArray(ids) && ids.length <= 64 && ids.every(id => typeof id === 'string'));
}

/** Testable sync state machine; adapter alone knows Firebase. */
export function createPreferenceSync(adapter, {readPrefs, applyPrefs, onChange, storage, delay = 350}) {
  let user = null, baseline = {}, pending = {}, remote = null;
  let ready = false, choosing = false, interactive = false, phase = 'signed-out';
  let epoch = 0, flight = false, timer = null, unwatch = null;
  let resume = null;
  const notify = (status, issue) => { phase = status; onChange({user, status, ...(issue ? {issue} : {})}); };
  const cacheKey = () => 'eth-uzh-nutrition-sync-' + user.uid;
  function persist() {
    if (!user || !ready) return;
    try { storage.setItem(cacheKey(), JSON.stringify({baseline, pending})); } catch { /* local-only mode still works */ }
  }
  function schedule() {
    clearTimeout(timer);
    if (ready && !choosing && Object.keys(pending).length) timer = setTimeout(flush, delay);
  }
  async function flush() {
    if (!user || !ready || choosing || flight || !Object.keys(pending).length) return;
    if (!adapter.isOnline()) { notify('offline'); return; }
    const generation = epoch, uid = user.uid, patch = copy(pending);
    flight = true;
    notify('syncing');
    try {
      await adapter.write(uid, patch);
      if (generation !== epoch) return;
      baseline = {...baseline, ...patch};
      for (const key of Object.keys(patch)) if (same(pending[key], patch[key])) delete pending[key];
      persist();
      notify(Object.keys(pending).length ? 'syncing' : 'synced');
    } catch (err) {
      if (generation !== epoch) return;
      notify(adapter.isOnline() ? 'error' : 'offline', adapter.isOnline() ? err.code || 'sync-failed' : undefined);
    } finally {
      if (generation === epoch) { flight = false; }
    }
    if (generation === epoch && phase !== 'error') schedule();
  }
  function receive(document) {
    if (document && (document.schemaVersion !== 1 || !validPreferences(document.prefs))) {
      notify('error', 'invalid-cloud-preferences');
      return;
    }
    remote = document ? withDefaults(copy(document.prefs)) : null;
    if (choosing) return; // Keep the newest remote data for the eventual choice.
    if (!ready) {
      if (remote && (!resume || interactive)) {
        choosing = true;
        notify('choice');
        return;
      }
      if (resume && remote) {
        // Merge only locally changed fields; a device changing photos must
        // not overwrite another device's meal choice or selected mensas.
        pending = {...resume.pending, ...changed(resume.baseline, readPrefs())};
      } else pending = changed({}, readPrefs());
      ready = true;
      interactive = false;
    }
    baseline = remote || {};
    const merged = {...baseline, ...pending};
    if (validPreferences(merged) && !same(readPrefs(), merged)) applyPrefs(copy(merged));
    persist();
    notify(Object.keys(pending).length ? 'syncing' : 'synced');
    schedule();
  }
  function watch() {
    if (unwatch) unwatch();
    const generation = epoch;
    unwatch = adapter.watch(user.uid, document => {
      if (generation === epoch) receive(document);
    }, err => {
      if (generation === epoch) notify(adapter.isOnline() ? 'error' : 'offline', adapter.isOnline() ? err.code || 'sync-failed' : undefined);
    });
  }
  function authChanged(next) {
    epoch += 1;
    clearTimeout(timer);
    if (unwatch) unwatch();
    unwatch = null;
    user = next ? {uid: next.uid, displayName: next.displayName || '', photoURL: next.photoURL || ''} : null;
    ready = false; choosing = false; flight = false; remote = null; pending = {}; baseline = {}; resume = null;
    if (!user) { notify('signed-out'); return; }
    try {
      const saved = JSON.parse(storage.getItem(cacheKey()));
      if (saved && saved.baseline && saved.pending && validPreferences({...saved.baseline, ...saved.pending})) {
        resume = {...saved, baseline: withDefaults(saved.baseline)};
      }
    } catch { /* a first login always asks before replacing existing cloud data */ }
    notify(adapter.isOnline() ? 'connecting' : 'offline');
    watch();
  }
  return {
    start() { adapter.onAuth(authChanged); },
    save(value) {
      if (!user || !ready || choosing) return;
      pending = {...pending, ...changed({...baseline, ...pending}, value)};
      persist();
      schedule();
    },
    resolveConflict(choice) {
      if (!user || !choosing || !['cloud', 'local'].includes(choice)) return;
      baseline = remote || {};
      pending = choice === 'local' ? changed(baseline, readPrefs()) : {};
      choosing = false; ready = true; interactive = false;
      if (choice === 'cloud' && remote) applyPrefs(copy(remote));
      persist();
      notify(Object.keys(pending).length ? 'syncing' : 'synced');
      schedule();
    },
    signIn() {
      interactive = true;
      // Called directly from a click: keep the user gesture for Safari popups.
      const result = adapter.signIn();
      notify('signing-in');
      result.catch(err => {
        interactive = false;
        notify(user ? phase : 'signed-out', err.code);
      });
    },
    async signOut() {
      // Fence callbacks immediately; old account data cannot reach a new login.
      epoch += 1;
      clearTimeout(timer);
      if (unwatch) { unwatch(); unwatch = null; }
      ready = false;
      notify('signing-out');
      try { await adapter.signOut(); }
      catch (err) { notify('error', err.code || 'signout-failed'); if (user) watch(); }
    },
    retry() {
      if (!user) return;
      if (!adapter.isOnline()) { notify('offline'); return; }
      if (choosing) { notify('choice'); return; }
      notify('connecting');
      watch();
      if (ready) schedule();
    },
    offline() { if (user) notify('offline'); },
  };
}

/** Load only Firebase Auth + Firestore. Menu browsing has no SDK dependency. */
export async function connectFirebase(config) {
  const [appSDK, authSDK, dbSDK] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js'),
  ]);
  const app = appSDK.initializeApp(config);
  const auth = authSDK.getAuth(app);
  await authSDK.setPersistence(auth, authSDK.browserLocalPersistence);
  const db = dbSDK.initializeFirestore(app, {localCache: dbSDK.memoryLocalCache()});
  const provider = new authSDK.GoogleAuthProvider();
  provider.setCustomParameters({prompt: 'select_account'});
  const reference = uid => dbSDK.doc(db, 'users', uid, 'preferences', 'current');
  return {
    isOnline: () => navigator.onLine,
    onAuth: callback => authSDK.onAuthStateChanged(auth, callback),
    signIn: () => authSDK.signInWithPopup(auth, provider),
    signOut: () => authSDK.signOut(auth),
    watch(uid, receive, fail) {
      return dbSDK.onSnapshot(reference(uid), {includeMetadataChanges: true}, snapshot => {
        // A cache miss is not evidence of a new account. Wait for the server
        // before deciding to upload, and ignore optimistic local snapshots.
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        receive(snapshot.exists() ? snapshot.data() : null);
      }, fail);
    },
    write(uid, prefs) {
      return dbSDK.setDoc(reference(uid), {schemaVersion: 1, prefs, updatedAt: dbSDK.serverTimestamp()}, {
        mergeFields: ['schemaVersion', 'updatedAt', ...Object.keys(prefs).map(key => new dbSDK.FieldPath('prefs', key))],
      });
    },
  };
}
