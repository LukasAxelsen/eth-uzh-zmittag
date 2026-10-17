import assert from 'node:assert/strict';
import {createPreferenceSync} from '../template/account-sync.mjs';

const defaults = {meal: 'Lunch', selected: ['eth-9'], photos: true, openingTimes: true, prices: true,
  theme: 'light', customGroups: {}, hiddenGroups: [], collapsedMensas: []};
const clone = value => structuredClone(value);
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
function device({stored = new Map(), initial = defaults} = {}) {
  let prefs = clone(initial), state, auth, receive, online = true, deferred = null;
  const writes = [];
  const adapter = {
    isOnline: () => online,
    onAuth(fn) { auth = fn; },
    watch(uid, fn) { receive = fn; return () => {}; },
    write(uid, patch) { writes.push({uid, patch: clone(patch)}); return deferred || Promise.resolve(); },
    signIn: async () => {}, signOut: async () => auth(null),
  };
  const sync = createPreferenceSync(adapter, {
    readPrefs: () => clone(prefs), applyPrefs: value => {prefs = clone(value);},
    onChange: value => {state = value;}, delay: 0,
    storage: {getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value)},
  });
  sync.start();
  return {sync, stored, writes, get prefs() {return prefs;}, get state() {return state;},
    login: (uid = 'A') => auth({uid, displayName: 'Test account'}),
    receive: value => receive(value === null ? null : {schemaVersion: 1, prefs: clone(value)}),
    edit(patch) {prefs = {...prefs, ...patch}; sync.save(clone(prefs));},
    online(value) {online = value; if (!value) sync.offline();},
    defer() {return new Promise(resolve => {deferred = new Promise(done => resolve(done));});},
  };
}

// New account uploads without prompting; dates never enter the document.
const fresh = device(); fresh.login(); fresh.receive(null); await tick();
assert.deepEqual(fresh.writes[0].patch, defaults);
assert.equal(fresh.state.status, 'synced');

// Existing account: no write or local replacement until an explicit choice.
const existing = device(); existing.login(); existing.receive({...defaults, meal: 'Dinner'});
assert.equal(existing.state.status, 'choice');
assert.equal(existing.prefs.meal, 'Lunch'); await tick(); assert.equal(existing.writes.length, 0);
existing.sync.resolveConflict('cloud');
assert.equal(existing.prefs.meal, 'Dinner'); assert.equal(existing.writes.length, 0);
existing.edit({photos: false}); await tick();
assert.deepEqual(existing.writes[0].patch, {photos: false});

// Old documents remain valid; default group deletion/reset patches one field.
const legacy = device(); legacy.login();
const oldPrefs = clone(defaults); delete oldPrefs.hiddenGroups;
legacy.receive(oldPrefs); legacy.sync.resolveConflict('cloud');
assert.deepEqual(legacy.prefs.hiddenGroups, []);
legacy.edit({hiddenGroups: ['Central']}); await tick();
assert.deepEqual(legacy.writes[0].patch, {hiddenGroups: ['Central']});
legacy.edit({hiddenGroups: []}); await tick();
assert.deepEqual(legacy.writes.at(-1).patch, {hiddenGroups: []});

// Choosing local includes local edits made while the conflict was pending.
const local = device(); local.login(); local.receive({...defaults, meal: 'Dinner'});
local.edit({theme: 'dark'}); local.sync.resolveConflict('local'); await tick();
assert.deepEqual(local.writes[0].patch, {meal: 'Lunch', theme: 'dark'});

// Offline changes survive reload; remote fields and local fields merge.
existing.online(false); existing.edit({photos: true}); await tick();
assert.equal(existing.state.status, 'offline');
const resumed = device({stored: existing.stored, initial: existing.prefs});
resumed.login(); resumed.receive({...defaults, meal: 'Dinner', photos: false, theme: 'dark'}); await tick();
assert.equal(resumed.prefs.theme, 'dark'); assert.equal(resumed.prefs.photos, true);
assert.deepEqual(resumed.writes[0].patch, {photos: true});

// A quick reversal during a slow write must remain queued after the first ack.
const rapid = device(); rapid.login(); rapid.receive(defaults); rapid.sync.resolveConflict('cloud');
const release = await rapid.defer(); rapid.edit({theme: 'dark'}); await tick();
rapid.edit({theme: 'light'}); rapid.receive({...defaults, theme: 'dark'}); release(); await tick(); await tick();
assert.equal(rapid.prefs.theme, 'light');
assert.deepEqual(rapid.writes.at(-1).patch, {theme: 'light'});

// Finishing an old account's write must not mutate a new account's state.
const accounts = device(); accounts.login(); accounts.receive(null); const finish = await accounts.defer();
await tick(); await accounts.sync.signOut(); accounts.login('B'); accounts.receive({...defaults, meal: 'Dinner'});
finish(); await tick(); assert.equal(accounts.state.user.uid, 'B'); assert.equal(accounts.state.status, 'choice');
assert.equal(accounts.writes.filter(write => write.uid === 'B').length, 0);

console.log('PASS: first upload, both conflict choices, field patches, offline reload/merge, rapid reversals and account isolation');

// Personal data and all settings participate in the SAME conflict and patch path.
const {DEFAULT_NUTRITION} = await import('../template/nutrition.mjs');
const full = {...defaults, userProfile: {ageYears: 30, sex: 'male', weightKg: 75}, nutritionSettings: {...DEFAULT_NUTRITION}};
const cloudData = {...full, selected: ['eth-3'], userProfile: {ageYears: 42, sex: 'female'},
  nutritionSettings: {...DEFAULT_NUTRITION, standard: 'us_nasem'}};
const nutritionCloud = device({initial: full}); nutritionCloud.login(); nutritionCloud.receive(cloudData);
assert.equal(nutritionCloud.state.status, 'choice');
assert.deepEqual(nutritionCloud.prefs, full);
nutritionCloud.sync.resolveConflict('cloud');
assert.deepEqual(nutritionCloud.prefs, cloudData);
const nutritionLocal = device({initial: full}); nutritionLocal.login(); nutritionLocal.receive(cloudData);
nutritionLocal.sync.resolveConflict('local'); await tick();
assert.deepEqual(nutritionLocal.writes[0].patch, {selected: full.selected, userProfile: full.userProfile, nutritionSettings: full.nutritionSettings});
const upgraded = device({initial: full}); upgraded.login(); upgraded.receive(defaults); upgraded.sync.resolveConflict('cloud');
assert.deepEqual(upgraded.prefs.userProfile, {});
assert.deepEqual(upgraded.prefs.nutritionSettings, DEFAULT_NUTRITION);
upgraded.online(false); upgraded.edit({userProfile: {ageYears: 36}});
const onlineProfile = device({initial: upgraded.prefs, stored: upgraded.stored}); onlineProfile.login();
onlineProfile.receive({...defaults, userProfile: {}, nutritionSettings: {...DEFAULT_NUTRITION, standard: 'efsa'}, theme: 'dark'});
await tick();
assert.equal(onlineProfile.prefs.userProfile.ageYears, 36);
assert.equal(onlineProfile.prefs.nutritionSettings.standard, 'efsa');
assert.equal(onlineProfile.prefs.theme, 'dark');
assert.deepEqual(onlineProfile.writes[0].patch, {userProfile: {ageYears: 36}});
const badProfile = device({initial: full}); badProfile.login(); badProfile.receive({...full, userProfile: {ageYears: -5}});
assert.equal(badProfile.state.status, 'error'); assert.equal(badProfile.writes.length, 0);
console.log('PASS: unified nutrition conflict, legacy cloud upgrade, offline profile merge and invalid cloud rejection');

// The interface language is one more preference field: same choice, same single-field patches.
const lingual = device({initial: {...defaults, language: 'de'}}); lingual.login(); lingual.receive({...defaults, language: 'ja'});
assert.equal(lingual.state.status, 'choice');
lingual.sync.resolveConflict('cloud');
assert.equal(lingual.prefs.language, 'ja');
lingual.edit({language: 'fr'}); await tick();
assert.deepEqual(lingual.writes.at(-1).patch, {language: 'fr'});
const legacyLanguage = device({initial: {...defaults, language: 'zh-Hant'}}); legacyLanguage.login(); legacyLanguage.receive(defaults);
legacyLanguage.sync.resolveConflict('local'); await tick();
assert.deepEqual(legacyLanguage.writes[0].patch, {language: 'zh-Hant'}, 'documents from before the setting gain it');
const badLanguage = device(); badLanguage.login(); badLanguage.receive({...defaults, language: 'xx'});
assert.equal(badLanguage.state.status, 'error'); assert.equal(badLanguage.writes.length, 0);
console.log('PASS: language syncs through the shared choice, legacy documents upgrade, unknown codes are rejected');
