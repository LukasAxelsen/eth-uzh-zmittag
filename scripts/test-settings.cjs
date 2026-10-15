// Exercise the existing data/render and preference entry points with a small VM.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8')
  .replace(/\ninit\(\);\s*$/, '');
let stored = null;
const closed = { id: 'eth-9', name: 'ETH Mensa Polyterrasse', group: 'Central',
  opening: { Lunch: null, Dinner: null }, meals: { Lunch: [], Dinner: [] },
  service: { status: 'confirmed_closed', reason: 'Campus holiday',
    evidence: { kind: 'calendar', url: 'https://example.com/calendar', confirmedOn: '2026-10-12' } } };
const context = vm.createContext({ console, Intl, Date, setTimeout, clearTimeout,
  window: { matchMedia: () => ({ matches: false }) },
  document: {getElementById: () => null},
  fetch: async () => ({ ok: true, json: async () => ({ date: '2026-10-12', days: { '2026-10-12': { mensas: [closed] } } }) }),
  localStorage: { getItem: () => stored, setItem: (key, value) => { stored = value; } },
});
vm.runInContext(source, context);
context.closed = closed;

(async () => {
  vm.runInContext('prefs = loadPrefs(); data = { days: { "2026-10-12": normalizeMensas([closed]) } }; selectedDate = "2026-10-12"', context);
  const html = vm.runInContext('mensaSectionHTML(activeMensas()[0])', context);
  assert.match(html, /Closed today.*Campus holiday/);
  assert.doesNotMatch(html, /No meals available/);
  assert.equal(vm.runInContext('mensaSectionHTML(normalizeMensas([{...closed, service: {status: "confirmed_empty"}}])[0]).includes("No meals available")', context), true);
  await vm.runInContext('fetchData().then(value => {data = value; selectedDate = "2026-10-13";})', context);
  assert.doesNotMatch(vm.runInContext('mensaSectionHTML(activeMensas()[0])', context), /Closed today/, 'a missing date cannot inherit yesterday\'s closure');
  assert.equal(vm.runInContext('nutriSegment({salt: 0, sugar: 0}, false)', context), 'sugar=0g, salt=0g');
  vm.runInContext('renderAll = () => {}; prefs = loadPrefs(); onOpeningToggleClick(); onPriceToggleClick(); prefs = loadPrefs();', context);
  assert.equal(vm.runInContext('prefs.openingTimes', context), false, 'opening-times off survives reload');
  assert.equal(vm.runInContext('prefs.prices', context), false, 'prices off survives reload');
  assert.equal(JSON.parse(stored).openingTimes, false);
  assert.equal(JSON.parse(stored).prices, false);
  vm.runInContext('onOpeningToggleClick(); onPriceToggleClick(); prefs = loadPrefs();', context);
  assert.equal(vm.runInContext('prefs.openingTimes && prefs.prices', context), true, 'on survives reload');
  stored = JSON.stringify({ meal: 'Lunch', photos: false });
  assert.equal(vm.runInContext('loadPrefs().openingTimes && loadPrefs().prices', context), true, 'old storage uses current defaults');
  console.log('PASS: confirmed closure, ordinary empty menu, missing date and zero-value raw text');
  console.log('PASS: opening-times/prices off and on persist; old storage defaults remain on');
})().catch(err => { console.error(err); process.exitCode = 1; });
