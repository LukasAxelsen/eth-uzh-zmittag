// Real browser regressions, served from an offline fixture build. No live menus.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-browser-'));
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!['index.html', 'app.js', 'firebase-config.js', 'account-sync.mjs', 'style.css', 'data.json', 'index.txt'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', (/\.(m?js)$/.test(name) ? 'text/javascript' : ({'style.css': 'text/css', 'data.json': 'application/json'})[name]) || 'text/html');
  if (name === 'firebase-config.js') { res.end('window.ZMITTAG_FIREBASE_CONFIG = null;'); return; }
  res.end(fs.readFileSync(path.join(directory, name)));
});

async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('#content [data-entering], #content [data-exiting], #content [data-photo-closing]') &&
    !document.querySelector('#content').style.height &&
    ![...document.querySelectorAll('.dish-photo')].some(el => el.style.height && el.style.height !== 'auto'), null, {timeout: 10000});
}

async function sidebar(page, name) {
  if (await page.locator('#menu-btn').getAttribute('aria-expanded') === 'false') await page.locator('#menu-btn').click();
  await page.getByRole('tab', {name, exact: true}).click();
  await page.waitForFunction(() => !document.querySelector('#sidebar-pages [data-entering], #sidebar-pages [data-exiting]'));
}

async function verifyMenus(page, data, iso) {
  await settle(page);
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('eth-uzh-nutrition-prefs')));
  const selected = data.days[iso].mensas.filter(m => prefs.selected.includes(m.id));
  const actual = await page.locator('#content .mensa-section').evaluateAll(nodes => nodes.map(el => ({
    id: el.dataset.key, dishes: [...el.querySelectorAll('.dish-name')].map(el => el.textContent)
  })));
  assert.deepEqual(actual, selected.map(m => ({id: m.id, dishes: m.meals[prefs.meal].map(d => d.dish)})));
  const geometry = await page.locator('#content').evaluate(el => ({height: el.getBoundingClientRect().height, scroll: el.scrollHeight, inline: el.style.height}));
  assert.equal(geometry.inline, '');
  assert.ok(Math.abs(geometry.height - geometry.scroll) < 3, 'final content is not locked or clipped');
}

async function verifySidebar(browser, url) {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: width === 320 ? 'reduce' : 'no-preference'});
    const page = await context.newPage();
    const errors = []; page.on('pageerror', err => errors.push(err.message));
    await page.clock.install({time: new Date('2026-10-13T10:00:00Z')});
    await page.goto(url); await page.waitForSelector('html.anim-ready');
    const dish = await page.locator('#content .dish').first().elementHandle();
    await sidebar(page, 'Mensas');
    assert.equal(await page.getByRole('heading', {name: 'Mensas', exact: true}).count(), 0);
    const selected = await page.evaluate(() => JSON.parse(localStorage.getItem('eth-uzh-nutrition-prefs')).selected);
    await page.getByRole('button', {name: 'Add group', exact: true}).click();
    await page.locator('#group-input').fill('My lunch'); await page.locator('#group-input').press('Enter');
    const central = page.locator('.group-chip[data-group="Central"]');
    await central.hover();
    assert.equal(await page.getByRole('button', {name: 'Delete group Central', exact: true}).isVisible(), true);
    await page.getByRole('button', {name: 'Delete group Central', exact: true}).click();
    await page.waitForFunction(() => !document.querySelector('.group-chip[data-group="Central"]'));
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('eth-uzh-nutrition-prefs')).selected), selected);
    await page.getByRole('button', {name: 'Reset groups', exact: true}).click();
    await page.locator('#sidebar-dialog').waitFor({state: 'visible'});
    const promptStyle = await page.locator('#sidebar-dialog').evaluate(el => {
      const style = getComputedStyle(el);
      const frames = el.getAnimations().flatMap(animation => animation.effect.getKeyframes());
      return {border: style.borderTopWidth, shadow: style.boxShadow, animation: style.animationName,
        transforms: frames.map(frame => frame.transform)};
    });
    assert.equal(promptStyle.border, '0px'); assert.equal(promptStyle.shadow, 'none');
    if (width === 320) assert.equal(promptStyle.animation, 'none', 'reduced motion disables the scale entrance');
    else {
      assert.equal(promptStyle.animation, 'dialog-pop');
      assert.ok(promptStyle.transforms.includes('scale(1.025)'), 'center scale has a restrained overshoot');
    }
    const resetAction = page.locator('[data-dialog-action="reset"]');
    assert.equal(await resetAction.evaluate(el => getComputedStyle(el).borderTopWidth), '0px');
    await resetAction.hover();
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-dialog-action="reset"]');
      return getComputedStyle(el).backgroundColor === 'rgb(29, 29, 31)';
    });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#sidebar-dialog').evaluate(el => el.open), false);
    assert.equal(await page.locator('#menu-btn').getAttribute('aria-expanded'), 'true', 'Escape closes only the alert');
    assert.equal(await page.locator('#groups-reset').evaluate(el => el === document.activeElement), true);
    await page.locator('#groups-reset').click();
    await page.locator('[data-dialog-action="reset"]').click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('eth-uzh-nutrition-prefs')).customGroups), {});
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('eth-uzh-nutrition-prefs')).selected), selected);
    assert.equal(await page.getByRole('button', {name: 'Apply group Central', exact: true}).count(), 1);
    await page.locator('#groups-undo').click();
    await page.waitForFunction(() => !document.querySelector('.group-chip[data-group="Central"]'));
    assert.equal(await page.getByRole('button', {name: 'Apply group My lunch', exact: true}).count(), 1);
    assert.equal(await page.locator('#groups-undo').isDisabled(), true);
    const row = await page.locator('.selector-mensas .mensa-row').first().elementHandle();
    await sidebar(page, 'Setting');
    const appearance = await page.locator('#appearance-seg').boundingBox();
    assert.ok(Math.abs(appearance.x + appearance.width / 2 - (width < 768 ? width : 380) / 2) < 2, 'appearance is centered');
    for (const theme of ['Dark', 'Light', 'Auto']) {
      await page.getByRole('button', {name: theme, exact: true}).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme.toLowerCase());
      assert.equal(await page.getByRole('tab', {name: 'Setting', exact: true}).getAttribute('aria-selected'), 'true');
    }
    await page.emulateMedia({colorScheme: 'dark'});
    assert.equal(await page.locator('#selector').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
    await sidebar(page, 'My Data');
    assert.equal(await page.locator('#sidebar-pages [data-entering], #sidebar-pages [data-exiting]').count(), 0);
    assert.equal(await page.getByRole('button', {name: 'Login', exact: true}).isVisible(), true);
    assert.equal(await page.locator('#account-status').isVisible(), false);
    const avatar = await page.locator('#account-avatar').boundingBox();
    assert.equal(avatar.width, 40); assert.ok(avatar.x < 30, 'small avatar aligns with the left content edge');
    await page.locator('#account-avatar').click();
    await page.locator('[data-dialog-action="cancel"]').click();
    await page.getByRole('tab', {name: 'My Data', exact: true}).focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => !document.querySelector('#sidebar-pages [data-entering], #sidebar-pages [data-exiting]'));
    await page.waitForFunction(() => !document.getElementById('sidebar-pages').getAnimations({subtree: true}).some(a => a.playState === 'running' || a.playState === 'pending'));
    assert.equal(await page.getByRole('tab', {name: 'Mensas', exact: true}).getAttribute('aria-selected'), 'true');
    assert.equal(await row.evaluate(el => el.isConnected && el === document.querySelector('.selector-mensas .mensa-row')), true, 'completed tab swaps reuse mensa rows');
    for (const tab of ['My Data', 'Setting', 'Mensas', 'Setting', 'Mensas']) {
      await page.getByRole('tab', {name: tab, exact: true}).click({force: true});
    }
    await page.waitForFunction(() => !document.querySelector('#sidebar-pages [data-entering], #sidebar-pages [data-exiting]'));
    assert.equal(await page.locator('#sidebar-pages > .sidebar-page:visible').count(), 1);
    await page.waitForFunction(() => !document.getElementById('sidebar-pages').getAnimations({subtree: true}).some(a => a.playState === 'running' || a.playState === 'pending'));
    assert.equal(await dish.evaluate(el => el.isConnected && el === document.querySelector('#content .dish')), true, 'tabs never rebuild menu content');
    assert.equal(await page.locator('#selector').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    const nav = await page.locator('#sidebar-tabs').boundingBox();
    assert.ok(nav.x >= 0 && nav.x + nav.width <= (width < 768 ? width : 380), 'tabs fit drawer width');
    assert.ok(Math.abs(nav.x + nav.width / 2 - (width < 768 ? width : 380) / 2) < 2, 'tabs are centered');
    if (width === 390) {
      await page.locator('#groups-reset').click();
      await page.waitForFunction(() => !document.querySelector('#sidebar-dialog [data-entering]'));
      await page.screenshot({path: '/tmp/zmittag-sidebar-mobile-dark.png'});
      await page.locator('[data-dialog-action="cancel"]').click();
    }
    if (width === 1280) await page.screenshot({path: '/tmp/zmittag-sidebar-desktop-dark.png'});
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS: sidebar — desktop/390px/320px, theme/auto, reset/cancel/undo, focus, cached nodes and rapid tab switches');
}

async function verifyAccountUI(browser, url) {
  const controller = fs.readFileSync(path.join(root, 'template/account-sync.mjs'), 'utf8').split('/** Load only Firebase')[0];
  for (const hasCloud of [true, false]) {
    const context = await browser.newContext({reducedMotion: 'reduce'});
    await context.route('**/firebase-config.js?*', route => route.fulfill({contentType: 'text/javascript', body:
      'window.ZMITTAG_FIREBASE_CONFIG={apiKey:"fixture",projectId:"fixture",appId:"fixture",authDomain:"fixture"};'}));
    await context.route('**/account-sync.mjs?*', route => route.fulfill({contentType: 'text/javascript', body: controller + `
      export async function connectFirebase() {
        let auth;
        window.fixtureWrites=[];
        return {
          isOnline:()=>true,
          onAuth(callback){auth=callback;callback(null);},
          signIn(){auth({uid:'fixture-user',displayName:'Fixture User',photoURL:'https://example.com/avatar.png'});return Promise.resolve();},
          signOut(){auth(null);return Promise.resolve();},
          watch(uid,receive){queueMicrotask(()=>receive(${hasCloud ? '{schemaVersion:1,prefs:{...JSON.parse(localStorage.getItem("eth-uzh-nutrition-prefs")),meal:"Dinner",theme:"dark"}}' : 'null'}));return ()=>{};},
          write(uid,patch){window.fixtureWrites.push(patch);return Promise.resolve();}
        };
      }` }));
    const page = await context.newPage();
    const errors=[]; page.on('pageerror', err=>errors.push(err.message));
    await page.clock.install({time: new Date('2026-10-13T10:00:00Z')});
    await page.goto(url); await page.waitForSelector('html.anim-ready');
    await sidebar(page, 'My Data');
    await page.waitForFunction(()=>document.getElementById('account-login').textContent==='Login' && !document.getElementById('account-login').disabled);
    await page.locator('#account-login').click();
    await page.waitForFunction(()=>document.getElementById('account-name').textContent==='Fixture User');
    assert.equal(await page.locator('#account-photo img').getAttribute('src'), 'https://example.com/avatar.png');
    assert.equal(await page.getByRole('button', {name:'Logout',exact:true}).isVisible(), true);
    assert.equal(await page.locator('#account-login').isVisible(), false);
    if (hasCloud) {
      await page.locator('#sidebar-dialog').waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
      await page.locator('[data-dialog-action="cancel"]').click();
      assert.equal(await page.getByRole('button',{name:'Choose preferences',exact:true}).isVisible(),true);
      await page.locator('#account-action').click();
      await page.getByRole('button',{name:'Use cloud preferences',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Dinner',exact:true}).getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
      assert.match(await page.locator('#date-heading').innerText(),/October 13/);
      assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
      await page.locator('#account-signout').click();
      assert.equal(await page.getByRole('button', {name:'Login',exact:true}).isVisible(), true);
      assert.equal(await page.locator('#account-photo img').count(), 0);
      assert.equal(await page.getByRole('button',{name:'Dinner',exact:true}).getAttribute('aria-pressed'),'true','sign-out preserves local preferences');
      await page.getByRole('button',{name:'Lunch',exact:true}).click();
      await page.locator('#account-avatar').click();
      await page.getByRole('button',{name:'Use this device',exact:true}).click();
      await page.waitForFunction(()=>window.fixtureWrites.length>0);
      assert.deepEqual(await page.evaluate(()=>window.fixtureWrites[0]),{meal:'Lunch'});
    } else {
      await page.waitForFunction(()=>window.fixtureWrites.length>0);
      assert.equal(await page.locator('#sidebar-dialog').evaluate(el=>el.open),false,'a new account uploads without prompting');
      const upload=await page.evaluate(()=>window.fixtureWrites[0]);
      assert.equal(upload.meal,'Lunch'); assert.equal(Object.hasOwn(upload,'selectedDate'),false);
    }
    assert.deepEqual(errors,[]);
    await context.close();
  }
  console.log('PASS: account UI — profile, new-account upload, deferred conflict, cloud/local choices and sign-out');
}

(async () => {
  let browser;
  try {
    execFileSync(process.env.PYTHON || 'python3', [path.join(__dirname, 'build-test-preview.py'), '--output', directory]);
    const data = JSON.parse(fs.readFileSync(path.join(directory, 'data.json')));
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const url = `http://127.0.0.1:${server.address().port}/?v=hardening`;
    browser = await chromium.launch({headless: true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {})});
    const context = await browser.newContext({viewport: {width: 1280, height: 900}, timezoneId: 'America/Los_Angeles'});
    await context.route('https://storage.googleapis.com/**', route => route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#ddd"/></svg>'}));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.clock.install({time: new Date('2026-10-13T10:00:00Z')});
    await page.goto(url);
    await page.waitForSelector('html.anim-ready');
    assert.match(await page.locator('#date-heading').innerText(), /October 13/);
    assert.match(await page.locator('[data-mensa="eth-1"] .hours-line').innerText(), /Closed today.*Fixture campus closure/);
    assert.match(await page.locator('[data-mensa="eth-2"] .hours-line').innerText(), /No meals available/);
    await verifyMenus(page, data, '2026-10-13');

    const collapseTitle = page.locator('#content [data-mensa="eth-9"] .mensa-title');
    await collapseTitle.click();
    assert.equal(await collapseTitle.getAttribute('aria-expanded'), 'false');
    await collapseTitle.click();
    assert.equal(await collapseTitle.getAttribute('aria-expanded'), 'true');
    await page.waitForFunction(() => document.querySelector('#content [data-mensa="eth-9"] .mensa-dishes').style.maxHeight === 'none');

    await page.locator('#date-trigger').click();
    assert.equal(await page.locator('.cal-cell.selected.today').getAttribute('data-date'), '2026-10-13');
    await page.locator('.cal-cell[data-date="2026-10-14"]').click();
    assert.equal(await page.locator('#date-trigger').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.cal-cell.selected').getAttribute('data-date'), '2026-10-14');
    assert.equal(await page.locator('.cal-cell.today').getAttribute('data-date'), '2026-10-13');
    await verifyMenus(page, data, '2026-10-14');
    const piccata = page.locator('[data-mensa="eth-9"] .dish').filter({has: page.getByText('Piccata Milanese', {exact: true})});
    const energy = piccata.locator('tbody tr').filter({has: page.getByText('Energy', {exact: true})});
    const weight = piccata.locator('tbody tr').filter({has: page.getByText('Weight', {exact: true})});
    assert.equal(await energy.locator('td').nth(2).innerText(), '685 kcal');
    assert.equal(await weight.locator('td').nth(2).innerText(), '600 g');
    for (const iso of ['2026-10-13', '2026-10-14', '2026-10-13', '2026-10-14', '2026-10-13']) {
      await page.locator(`.cal-cell[data-date="${iso}"]`).click({force: true});
    }
    await verifyMenus(page, data, '2026-10-13');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#date-trigger').getAttribute('aria-expanded'), 'false');

    await sidebar(page, 'Setting');
    await page.locator('#opening-row').click();
    await page.locator('#price-row').click();
    await page.reload();
    await page.waitForSelector('html.anim-ready');
    await sidebar(page, 'Setting');
    assert.equal(await page.locator('#opening-row').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#price-row').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('show-opening') || el.classList.contains('show-prices')), false);
    await page.locator('#opening-row').click();
    await page.locator('#price-row').click();
    await page.reload();
    await page.waitForSelector('html.anim-ready');
    await sidebar(page, 'Setting');
    assert.equal(await page.locator('#opening-row').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#price-row').getAttribute('aria-pressed'), 'true');

    const dish = await page.locator('[data-mensa="uzh-untere-mensa"] .dish').first().elementHandle();
    await page.locator('#photo-row').click(); // wait for the drawer's slide before the burst
    for (let i = 0; i < 5; i++) await page.locator('#photo-row').click({force: true});
    await sidebar(page, 'Mensas');
    await page.locator('.selector-mensas [data-mensa="eth-9"]').click();
    for (let i = 0; i < 3; i++) await page.locator('.selector-mensas [data-mensa="eth-9"]').click({force: true});
    await verifyMenus(page, data, '2026-10-13');
    assert.equal(await dish.evaluate(el => el.isConnected && el === document.querySelector('[data-mensa="uzh-untere-mensa"] .dish')), true, 'photo toggles reuse the dish node');
    await sidebar(page, 'Setting');
    assert.equal(await page.locator('#photo-row').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('img.dish-photo').count(), 1);
    await page.locator('#menu-btn').click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('scroll-locked'));
    if (process.env.BROWSER_SCREENSHOT) await page.screenshot({path: process.env.BROWSER_SCREENSHOT, fullPage: true});

    await page.evaluate(() => localStorage.setItem('eth-uzh-nutrition-prefs', JSON.stringify({selected: ['eth-9'], photos: false})));
    await page.reload();
    await page.waitForSelector('html.anim-ready');
    await sidebar(page, 'Setting');
    assert.equal(await page.locator('#opening-row').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#price-row').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#content .mensa-section').count(), 1);
    await verifyMenus(page, data, '2026-10-13');
    assert.deepEqual(errors, []);

    await verifySidebar(browser, url);
    await verifyAccountUI(browser, url);

    const reduced = await browser.newContext({reducedMotion: 'reduce'});
    const reducedPage = await reduced.newPage();
    await reducedPage.clock.install({time: new Date('2026-10-13T10:00:00Z')});
    await reducedPage.goto(url);
    await reducedPage.waitForSelector('html.anim-ready');
    await reducedPage.getByRole('button', {name: 'Dinner', exact: true}).click();
    assert.equal(await reducedPage.locator('#content [data-entering], #content [data-exiting]').count(), 0);
    await verifyMenus(reducedPage, data, '2026-10-13');
    console.log('PASS: real Chromium — SV serving totals/weight, cross-day menus/calendar, confirmed closure, preferences off/on/upgrade, rapid date/photo/mensa toggles, reused nodes, final geometry and reduced motion');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, {recursive: true, force: true});
  }
})().catch(err => {console.error(err); process.exitCode = 1;});
