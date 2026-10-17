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
  if (!['index.html', 'app.js', 'firebase-config.js', 'account-sync.mjs', 'nutrition.mjs', 'i18n.mjs', 'nutrition-core/core.mjs', 'nutrition-core/hall.mjs', 'nutrition-core/reference-data.mjs', 'style.css', 'data.json', 'index.txt'].includes(name) &&
      !/^i18n\/[\w-]+\.json$/.test(name) && !/^fonts\/[\w-]+\.woff2$/.test(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', (/\.(m?js)$/.test(name) ? 'text/javascript' : /\.json$/.test(name) ? 'application/json' :
    /\.woff2$/.test(name) ? 'font/woff2' : ({'style.css': 'text/css'})[name]) || 'text/html');
  if (name === 'firebase-config.js') { res.end('window.ZMITTAG_FIREBASE_CONFIG = null;'); return; }
  res.end(fs.readFileSync(path.join(directory, name)));
});

const LANGUAGE_LABELS = ['Chinese (Simplified) · 简体中文', 'Chinese (Traditional) · 繁體中文', 'Danish · Dansk', 'English',
  'French · Français', 'German · Deutsch', 'Italian · Italiano', 'Japanese · 日本語', 'Latin · Latina', 'Swiss German · Schwiizertüütsch'];
const LANGUAGE_CODES = ['zh-Hans', 'zh-Hant', 'da', 'en', 'fr', 'de', 'it', 'ja', 'la', 'gsw'];

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

async function verifyNutrition(browser, url) {
  for (const width of [1280, 390, 320]) {
    const reduced = width === 320;
    const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: reduced ? 'reduce' : 'no-preference'});
    await context.addInitScript(() => {
      if (!localStorage.getItem('eth-uzh-nutrition-prefs')) localStorage.setItem('eth-uzh-nutrition-prefs', JSON.stringify({selected: ['eth-9'], photos: false}));
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({time: new Date('2026-10-14T10:00:00Z')});
    await page.goto(url); await page.waitForSelector('html.anim-ready');
    assert.equal(await page.getByRole('meter').count(), 0, 'no profile, no invented comparison');
    const plus = await page.locator('#group-add-btn').evaluate(el => {
      const style = getComputedStyle(el);
      return {w: el.offsetWidth, h: el.offsetHeight, radius: style.borderTopLeftRadius, color: style.color, border: style.borderTopColor, svg: !!el.querySelector('svg')};
    });
    assert.equal(plus.svg, true, 'add control uses a thin plus glyph');
    assert.equal(plus.w, plus.h);
    assert.ok(plus.w > 0 && (plus.radius === '50%' || plus.radius === plus.w / 2 + 'px'), 'add control is a circle');
    assert.equal(plus.color, 'rgb(29, 29, 31)');
    assert.equal(plus.border, 'rgb(210, 210, 215)');
    const dish = page.locator('.dish').filter({has: page.getByText('Piccata Milanese', {exact: true})});
    const original = await dish.elementHandle();
    await sidebar(page, 'My Data');
    for (const [id, value] of [['ageYears','30'], ['heightCm','180'], ['weightKg','75']]) {
      await page.locator('#nutrition-profile-' + id).fill(value);
    }
    await page.locator('#nutrition-profile-sex').selectOption('male');
    await page.locator('#nutrition-profile-activity-pal').selectOption('1.6');
    await settle(page);
    assert.equal(await dish.locator('[role="meter"]').count(), 7);
    assert.equal(await dish.locator('[data-nutrient="sugar"] [role="meter"]').count(), 0);
    assert.equal(await dish.locator('[data-nutrient="weight"] [role="meter"]').count(), 0);
    const protein = dish.locator('[data-nutrient="protein"] .nutrient-coverage');
    assert.equal(await protein.locator('.coverage-amount').innerText(), '48.2 / 24.9 g');
    assert.equal(await protein.getAttribute('data-tone'), 'met', 'PRI is not an upper limit');
    assert.equal(await protein.locator('.coverage-track').innerText(), '', 'the bar has no visible status text');
    const proteinNode = await protein.elementHandle();
    assert.equal(await page.evaluate(() => {const result = nutritionCache.result; renderAll(); return result === nutritionCache.result;}), true, 'unrelated renders reuse the calculation');
    await page.locator('#nutrition-settings-lunchPercent').fill('95');
    assert.equal(await page.locator('#nutrition-settings-lunchPercent').getAttribute('aria-invalid'), 'true');
    await settle(page);
    assert.equal(await page.getByRole('meter').count(), 0, 'invalid allocation removes comparisons');
    await page.locator('#nutrition-settings-lunchPercent').fill('40');
    await settle(page);
    await page.locator('#nutrition-profile-weightKg').fill('76');
    await page.locator('#nutrition-profile-weightKg').fill('75');
    await settle(page);
    assert.equal(await original.evaluate(node => node.isConnected), true);
    assert.equal(await proteinNode.evaluate(node => node.isConnected), false, 'removed meter is recreated after the invalid allocation');
    const stable = await protein.elementHandle();
    await page.locator('#nutrition-settings-lunchPercent').fill('35');
    await page.locator('#nutrition-settings-lunchPercent').fill('40');
    await settle(page);
    assert.equal(await stable.evaluate(node => node.isConnected), true, 'valid edits keep the same meter');
    await page.locator('#nutrition-profile-weightKg').fill('100');
    await page.locator('#nutrition-profile-referenceWeightKg').fill('1');
    assert.equal(await page.locator('#nutrition-profile-referenceWeightKg').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#nutrition-profile-referenceWeightKg').isVisible(), true, 'conditional fields survive invalid drafts');
    await page.locator('#nutrition-profile-referenceWeightKg').fill('75');
    await page.locator('#nutrition-profile-weightKg').fill('75');
    await settle(page);
    await page.reload(); await page.waitForSelector('html.anim-ready');
    await sidebar(page, 'My Data');
    assert.equal(await page.locator('#nutrition-profile-ageYears').inputValue(), '30');
    assert.equal(await page.locator('#nutrition-settings-lunchPercent').inputValue(), '40');
    assert.equal(await page.locator('label[for="nutrition-profile-ageYears"] + .field-entry .field-unit').innerText(), 'years');
    assert.equal(await page.locator('label[for="nutrition-profile-heightCm"] + .field-entry .field-unit').innerText(), 'cm');
    assert.equal(await page.locator('label[for="nutrition-profile-weightKg"] + .field-entry .field-unit').innerText(), 'kg');
    assert.equal(await page.getByText('Saved on this browser').count(), 0);
    assert.equal(await page.getByText('Completed years').count(), 0);
    assert.equal(await page.getByText('Planning split').count(), 0);
    assert.equal(await page.getByText('Your meal targets are ready').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.NUTRITION_SCREENSHOTS) await page.screenshot({path: path.join(process.env.NUTRITION_SCREENSHOTS, `nutrition-profile-${width}.png`)});
    await sidebar(page, 'Setting');
    assert.deepEqual(await page.locator('#sidebar-page-setting h3').allTextContents(), ['General','Appearance','Language']);
    assert.deepEqual(await page.locator('#site-language option').allTextContents(), LANGUAGE_LABELS);
    assert.equal(await page.locator('#site-language').inputValue(), 'en');
    assert.equal(await page.getByText('Display language', {exact: true}).count(), 0);
    assert.equal(await page.getByText('Some guidelines do not define energy').count(), 0);
    for (const standard of ['efsa','us_nasem','who','issn','ch_blv']) await page.locator('#nutrition-settings-standard').selectOption(standard);
    const hint = page.locator('#nutrition-settings-standard-hint');
    assert.match(await hint.innerText(), /^Swiss \(Wikipedia, official site\) BLV/);
    assert.equal(await hint.locator('a').count(), 2);
    assert.match(await hint.locator('a').nth(0).getAttribute('href'), /wikipedia\.org/);
    await page.locator('#nutrition-settings-standard').selectOption('who');
    assert.match(await page.locator('#nutrition-settings-standard-hint').innerText(), /^WHO \(Wikipedia, official site\)/);
    await page.locator('#nutrition-settings-standard').selectOption('ch_blv');
    await settle(page);
    assert.equal(await dish.locator('[role="meter"]').count(), 7);
    if (process.env.NUTRITION_SCREENSHOTS) await page.screenshot({path: path.join(process.env.NUTRITION_SCREENSHOTS, `nutrition-settings-${width}.png`)});
    await page.getByRole('button',{name:'Dark',exact:true}).click();
    await page.locator('#menu-btn').click();
    await settle(page);
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)');
    if (process.env.NUTRITION_SCREENSHOTS) await page.screenshot({path: path.join(process.env.NUTRITION_SCREENSHOTS, `nutrition-dark-${width}.png`)});
    if (reduced) assert.equal(await protein.locator('.coverage-fill').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS: nutrition — persisted profile, Total-only bars, reference semantics, invalid/recovered inputs, cached calculations, reused dishes/meters, standard switches, 320/390px, dark mode and reduced motion');
}

/** Fonts Chromium actually used for a node's text (DevTools protocol). */
async function platformFonts(page, selector) {
  const client = await page.context().newCDPSession(page);
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const {root} = await client.send('DOM.getDocument', {depth: -1});
  const {nodeId} = await client.send('DOM.querySelector', {nodeId: root.nodeId, selector});
  const {fonts} = await client.send('CSS.getPlatformFontsForNode', {nodeId});
  await client.detach();
  return fonts;
}

// System CJK fonts by the standard their Han glyphs follow (whatever this machine has installed).
const REGIONAL_FONT = /^(?:Noto (?:Sans|Serif) CJK (SC|TC|HK|JP|KR)|Source Han (?:Sans|Serif) (SC|TC|HK|JP|KR)|PingFang (SC|TC|HK)|(Hiragino|Meiryo|Yu Gothic|Yu Mincho|IPA)|(Microsoft YaHei|SimSun)|(Microsoft JhengHei|PMingLiU))/;
function fontRegion(family) {
  const m = REGIONAL_FONT.exec(family);
  if (!m) return null;
  return m[1] || m[2] || m[3] || (m[4] && 'JP') || (m[5] && 'SC') || (m[6] && 'TC');
}

async function verifyCjkTypography(browser, url) {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({time: new Date('2026-10-14T10:00:00Z')});
  const seen = [];
  for (const [code, region, heading] of [['zh-Hans', 'SC', '10月14日 星期三'], ['zh-Hant', 'TC', '10月14日 星期三'], ['ja', 'JP', '10月14日（水曜日）']]) {
    await page.goto(url);
    await page.evaluate(language => localStorage.setItem('eth-uzh-nutrition-prefs', JSON.stringify({selected: ['eth-9'], photos: false, language})), code);
    await page.reload(); await page.waitForSelector('html.anim-ready');
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('#date-heading').innerText(), heading);
    // Every heading glyph comes from the self-hosted regional serif, on any platform.
    const headingFonts = await platformFonts(page, '#date-heading');
    assert.deepEqual(headingFonts.map(f => [f.familyName, f.isCustomFont]), [[`Noto Serif ${region} SemiBold`, true]], `${code} heading serif`);
    assert.ok(['normal', '0px'].includes(await page.locator('#date-heading').evaluate(el => getComputedStyle(el).letterSpacing)), 'Han text is set solid');
    // UI text: whichever regional system font renders it must follow this language's standard.
    for (const selector of ['.header .seg-option[data-meal="Lunch"]', '#sidebar-tab-setting', '.nutrient-values .n-label', '#raw-toggle']) {
      for (const font of await platformFonts(page, selector)) {
        seen.push(`${code} ${selector}: ${font.familyName}`);
        const fontsRegion = fontRegion(font.familyName);
        assert.ok(fontsRegion === null || fontsRegion === region, `${code} ${selector} rendered with ${font.familyName}`);
      }
    }
    const stack = await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily);
    assert.match(stack, /^-apple-system, BlinkMacSystemFont, "SF Pro Text"/, 'Latin text keeps the SF stack');
    if (process.env.LANGUAGE_SCREENSHOTS) await page.locator('.header').screenshot({path: path.join(process.env.LANGUAGE_SCREENSHOTS, `heading-${code}.png`)});
  }
  // Native names in the picker keep their own standard in any interface language.
  assert.deepEqual(await page.locator('#site-language option').evaluateAll(options => options.map(o => o.lang)), LANGUAGE_CODES);
  // Non-CJK languages keep New York / Georgia and never download a CJK font.
  await page.evaluate(() => localStorage.setItem('eth-uzh-nutrition-prefs', JSON.stringify({selected: ['eth-9'], language: 'de'})));
  const fontRequests = [];
  page.on('request', request => { if (/\.woff2/.test(request.url())) fontRequests.push(request.url()); });
  await page.reload(); await page.waitForSelector('html.anim-ready');
  await page.evaluate(() => document.fonts.ready);
  assert.equal((await platformFonts(page, '#date-heading')).some(f => f.isCustomFont), false);
  assert.deepEqual(fontRequests, []);
  if (process.env.CJK_FONT_LOG) console.log(seen.join('\n'));
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS: CJK typography — regional heading serif (SC/TC/JP subsets), regional UI glyphs, option lang, no CJK font for other languages');
}

/** Visible text or labels that are raw catalog keys (a missing translation path). */
function leakedKeys(page) {
  return page.evaluate(() => {
    const key = /^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
    const leaks = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (key.test(walker.currentNode.textContent.trim())) leaks.push(walker.currentNode.textContent.trim());
    for (const el of document.querySelectorAll('[aria-label], [title], [aria-valuetext]')) {
      for (const attr of ['aria-label', 'title', 'aria-valuetext']) if (key.test(el.getAttribute(attr) || '')) leaks.push(attr + '=' + el.getAttribute(attr));
    }
    return leaks;
  });
}

async function verifyLanguages(browser, url) {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  await context.addInitScript(() => {
    if (!localStorage.getItem('eth-uzh-nutrition-prefs')) localStorage.setItem('eth-uzh-nutrition-prefs', JSON.stringify({selected: ['eth-9'], photos: false,
      userProfile: {ageYears: 30, sex: 'male', heightCm: 180, weightKg: 75, activity: {pal: 1.6}}}));
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({time: new Date('2026-10-14T10:00:00Z')});
  await page.goto(url); await page.waitForSelector('html.anim-ready');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en', 'an English browser starts in English');
  const dish = page.locator('#content [data-mensa="eth-9"] .dish').filter({has: page.getByText('Piccata Milanese', {exact: true})});
  const dishNode = await dish.elementHandle();
  const meter = await dish.locator('[data-nutrient="protein"] .nutrient-coverage').elementHandle();
  const menuText = await page.locator('#content [data-mensa="eth-9"]').evaluate(el => [el.querySelector('.mensa-name').textContent,
    ...[...el.querySelectorAll('.dish-label, .dish-name, .dish-desc')].map(node => node.textContent)]);
  const raw = await page.locator('#raw-text').textContent();
  await sidebar(page, 'Setting');
  await page.locator('#site-language').selectOption('de');
  await page.waitForFunction(() => document.documentElement.lang === 'de');
  await settle(page);
  assert.deepEqual(await page.locator('#sidebar-tabs [role="tab"]').allTextContents(), ['Mensen', 'Profil', 'Optionen']);
  assert.deepEqual(await page.locator('.header .seg-option').allTextContents(), ['Mittag', 'Abend']);
  assert.equal(await page.locator('#date-heading').innerText(), 'Mittwoch, 14. Oktober');
  assert.deepEqual(await page.locator('#sidebar-page-setting h3').allTextContents(), ['Allgemein', 'Darstellung', 'Sprache']);
  assert.deepEqual(await dish.locator('thead th').allTextContents(), ['Nährwerte', 'pro 100 g', 'Gesamt']);
  assert.equal(await dish.locator('.n-label').first().innerText(), 'Energie');
  assert.equal(await dish.locator('[data-nutrient="protein"] .coverage-track').getAttribute('aria-label'), 'Protein · Abdeckung Mittag');
  assert.match(await dish.locator('[data-nutrient="protein"] .coverage-track').getAttribute('aria-valuetext'), /Planungsreferenz für Mahlzeiten/);
  assert.equal(await dishNode.evaluate(node => node.isConnected), true, 'language switches reuse dish nodes');
  assert.equal(await meter.evaluate(node => node.isConnected), true, 'and their coverage meters');
  assert.deepEqual(await page.locator('#content [data-mensa="eth-9"]').evaluate(el => [el.querySelector('.mensa-name').textContent,
    ...[...el.querySelectorAll('.dish-label, .dish-name, .dish-desc')].map(node => node.textContent)]), menuText, 'menu data keeps its source language');
  assert.equal(await page.locator('#raw-text').textContent(), raw, 'raw/AI text keeps the index.txt format');
  assert.match(await page.locator('#nutrition-settings-standard-hint').innerText(), /^Schweizer \(Wikipedia, offizielle Website\) BLV gibt/);
  assert.equal(await page.locator('#nutrition-settings-standard option:checked').innerText(), 'Schweizer BLV');
  assert.deepEqual(await page.locator('#site-language option').allTextContents(), LANGUAGE_LABELS, 'language names never translate');
  await sidebar(page, 'Mensen');
  assert.equal(await page.getByRole('button', {name: 'Gruppe Central anwenden', exact: true}).count(), 1);
  assert.equal(await page.locator('#groups-undo').getAttribute('title'), 'Gruppenänderung rückgängig machen');
  await sidebar(page, 'Profil');
  assert.equal(await page.locator('label[for="nutrition-profile-ageYears"]').innerText(), 'Alter');
  assert.equal(await page.locator('label[for="nutrition-profile-ageYears"] + .field-entry .field-unit').innerText(), 'Jahre');
  await page.locator('#nutrition-profile-ageYears').fill('30.5');
  assert.equal(await page.locator('#nutrition-profile-ageYears-error').innerText(), 'Gib eine ganze Zahl von 0 bis 120 ein.');
  await page.locator('#nutrition-profile-ageYears').fill('30');
  await settle(page);
  assert.deepEqual(await leakedKeys(page), []);
  if (process.env.LANGUAGE_SCREENSHOTS) await page.screenshot({path: path.join(process.env.LANGUAGE_SCREENSHOTS, 'language-de-1280.png')});
  await page.reload(); await page.waitForSelector('html.anim-ready');
  assert.equal(await page.locator('html').getAttribute('lang'), 'de', 'the choice persists');
  assert.equal(await page.locator('#date-heading').innerText(), 'Mittwoch, 14. Oktober');
  assert.equal(await page.locator('#raw-toggle').innerText(), 'Rohdaten anzeigen');
  await page.locator('#raw-toggle').click();
  assert.equal(await page.locator('#raw-toggle').innerText(), 'Rohdaten ausblenden');
  assert.deepEqual(errors, []);
  await context.close();

  // Every language at the narrowest width: no leaked keys, nothing wider than the screen.
  const narrow = await browser.newContext({viewport: {width: 320, height: 800}});
  const small = await narrow.newPage();
  small.on('pageerror', error => errors.push(error.message));
  await small.clock.install({time: new Date('2026-10-14T10:00:00Z')});
  for (const [index, label] of LANGUAGE_LABELS.entries()) {
    const code = LANGUAGE_CODES[index];
    await small.goto(url);
    await small.evaluate(language => localStorage.setItem('eth-uzh-nutrition-prefs', JSON.stringify({selected: ['eth-9', 'eth-1'], photos: false,
      userProfile: {ageYears: 30, sex: 'male', heightCm: 180, weightKg: 75, activity: {pal: 1.6}}, language})), code);
    await small.reload(); await small.waitForSelector('html.anim-ready');
    assert.equal(await small.locator('html').getAttribute('lang'), code, label);
    await small.locator('#date-trigger').click();
    await settle(small);
    const page320 = await small.evaluate(() => ({
      page: document.documentElement.scrollWidth <= innerWidth,
      meal: document.querySelector('.header .segmented').getBoundingClientRect().right <= innerWidth,
      calendar: document.querySelector('.calendar-inner').scrollWidth <= document.querySelector('.calendar-inner').clientWidth,
    }));
    assert.deepEqual(page320, {page: true, meal: true, calendar: true}, `${label} page fits 320px`);
    if (process.env.LANGUAGE_SCREENSHOTS) await small.screenshot({path: path.join(process.env.LANGUAGE_SCREENSHOTS, `language-${code}-320-page.png`)});
    await small.locator('#menu-btn').click();
    for (const tab of ['mensas', 'data', 'setting']) {
      await small.locator('#sidebar-tab-' + tab).click();
      const fit = await small.evaluate(() => ({
        drawer: document.getElementById('selector').scrollWidth <= document.getElementById('selector').clientWidth,
        tabs: document.getElementById('sidebar-tabs').getBoundingClientRect().right <= innerWidth,
      }));
      assert.deepEqual(fit, {drawer: true, tabs: true}, `${label} drawer fits 320px on ${tab}`);
    }
    // The sliding thumb assumes equal one-line segments: a wrapping label misaligns it.
    const wrapped = await small.evaluate(() => [...document.querySelectorAll('.seg-option')].filter((option) => {
      const range = document.createRange();
      range.selectNodeContents(option);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size > 1 || option.scrollWidth > option.clientWidth + 1;
    }).map((option) => option.textContent));
    assert.deepEqual(wrapped, [], `${label} segmented labels stay on one line at 320px`);
    assert.deepEqual(await leakedKeys(small), [], label);
    if (process.env.LANGUAGE_SCREENSHOTS) await small.screenshot({path: path.join(process.env.LANGUAGE_SCREENSHOTS, `language-${code}-320-setting.png`)});
  }
  assert.deepEqual(errors, []);
  await narrow.close();
  console.log('PASS: languages — in-place switch, reused dishes/meters, untouched menu data and raw text, translated nutrition, errors and labels, persistence, all 10 languages at 320px');
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
    await verifyNutrition(browser, url);
    await verifyLanguages(browser, url);
    await verifyCjkTypography(browser, url);

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
