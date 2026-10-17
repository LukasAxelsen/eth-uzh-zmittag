// Exercise the real boot/data-loading path with a fixed clock and a tiny DOM.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8')
  .replace(/\ninit\(\);\s*$/, '')
  .replace("await import('./nutrition.mjs?v=VER_PLACEHOLDER')", 'testNutritionCore');

async function boot(instant, days) {
  let now = instant;
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  const heading = { textContent: '' };
  let gridWrites = 0;
  let gridHtml = '';
  const grid = { get innerHTML() { return gridHtml; }, set innerHTML(value) { gridWrites++; gridHtml = value; } };
  const elements = { 'date-heading': heading, 'cal-grid': grid, 'cal-title': {}, 'cal-note': {} };
  const context = vm.createContext({
    testNutritionCore: await import('../template/nutrition.mjs'),
    Date: FixedDate, Intl, console, setTimeout, clearTimeout,
    window: { matchMedia: () => ({ matches: false }) },
    document: { title: '', getElementById: (id) => elements[id] || heading, documentElement: { classList: { add() {} } } },
    fetch: async () => ({ ok: true, json: async () => ({ date: '2026-10-12', days }) }),
    localStorage: { getItem: () => JSON.stringify({ selected: ['uzh-untere-mensa'] }), setItem() {} },
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    bindEvents = () => {};
    renderAll = () => { updateDateHeading(); if (calMonth) renderCalendar(); };
    updateSegmented = () => {};
  `, context);
  await vm.runInContext('init()', context);
  return { context, heading, grid, gridWrites: () => gridWrites, setTime: (value) => { now = value; } };
}

const mensa = (name) => ({ id: 'uzh-untere-mensa', name: 'Untere Mensa', group: 'Central',
  opening: { Lunch: '11:00 - 14:00' }, meals: { Lunch: [{ dish: name }], Dinner: [] } });
const days = { '2026-10-12': { mensas: [mensa('Yesterday')] }, '2026-10-13': { mensas: [mensa('Today')] } };

(async () => {
  let app = await boot('2026-10-13T10:00:00Z', days);
  assert.equal(vm.runInContext('selectedDate', app.context), '2026-10-13');
  assert.match(app.heading.textContent, /13/);
  assert.equal(vm.runInContext('activeMensas()[0].meals.Lunch[0].dish', app.context), 'Today');
  vm.runInContext('calMonth = "2026-10-01"; renderCalendar()', app.context);
  assert.match(app.grid.innerHTML, /class="cal-cell selected today"[^>]*data-date="2026-10-13"/);
  const writes = app.gridWrites();
  vm.runInContext('renderAll()', app.context);
  assert.equal(app.gridWrites(), writes, 'ordinary renders preserve calendar nodes');
  vm.runInContext('selectDate("2026-10-12")', app.context);
  assert.match(app.grid.innerHTML, /class="cal-cell selected"[^>]*data-date="2026-10-12"/);
  assert.match(app.grid.innerHTML, /class="cal-cell today"[^>]*data-date="2026-10-13"/);

  // Missing data must retain the roster/preferences and never show yesterday's food.
  app = await boot('2026-10-13T10:00:00Z', { '2026-10-12': days['2026-10-12'] });
  assert.equal(vm.runInContext('selectedDate', app.context), '2026-10-13');
  assert.equal(vm.runInContext('activeMensas().length', app.context), 1);
  assert.equal(vm.runInContext('activeMensas()[0].meals.Lunch.length', app.context), 0);
  assert.equal(vm.runInContext('prefs.selected.has("uzh-untere-mensa")', app.context), true);

  // Zurich midnight, independent of the visitor's device timezone.
  app = await boot('2026-10-12T22:30:00Z', days);
  assert.equal(vm.runInContext('selectedDate', app.context), '2026-10-13');
  app = await boot('2026-12-01T22:30:00Z', days);
  assert.equal(vm.runInContext('selectedDate', app.context), '2026-12-01');

  // A tab left open follows the new day; an explicitly browsed date stays selected.
  app = await boot('2026-10-12T21:59:00Z', days);
  app.setTime('2026-10-12T22:01:00Z');
  vm.runInContext('refreshCurrentDate()', app.context);
  assert.equal(vm.runInContext('selectedDate', app.context), '2026-10-13');
  vm.runInContext('selectDate("2026-10-12")', app.context);
  app.setTime('2026-10-13T22:01:00Z');
  vm.runInContext('refreshCurrentDate()', app.context);
  assert.equal(vm.runInContext('selectedDate', app.context), '2026-10-12');
  console.log('PASS: today at boot, missing data, Zurich DST, and midnight rollover');
})().catch((err) => { console.error(err); process.exitCode = 1; });
