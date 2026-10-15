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
  if (!['index.html', 'app.js', 'style.css', 'data.json', 'index.txt'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', ({'app.js': 'text/javascript', 'style.css': 'text/css', 'data.json': 'application/json'})[name] || 'text/html');
  res.end(fs.readFileSync(path.join(directory, name)));
});

async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('#content [data-entering], #content [data-exiting], #content [data-photo-closing]') &&
    !document.querySelector('#content').style.height &&
    ![...document.querySelectorAll('.dish-photo')].some(el => el.style.height && el.style.height !== 'auto'), null, {timeout: 10000});
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

    await page.locator('#menu-btn').click();
    await page.locator('#opening-row').click();
    await page.locator('#price-row').click();
    await page.reload();
    await page.waitForSelector('html.anim-ready');
    assert.equal(await page.locator('#opening-row').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#price-row').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('show-opening') || el.classList.contains('show-prices')), false);
    await page.locator('#menu-btn').click();
    await page.locator('#opening-row').click();
    await page.locator('#price-row').click();
    await page.reload();
    await page.waitForSelector('html.anim-ready');
    assert.equal(await page.locator('#opening-row').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#price-row').getAttribute('aria-pressed'), 'true');

    const dish = await page.locator('[data-mensa="uzh-untere-mensa"] .dish').first().elementHandle();
    await page.locator('#menu-btn').click();
    await page.locator('#photo-row').click(); // wait for the drawer's slide before the burst
    for (let i = 0; i < 5; i++) await page.locator('#photo-row').click({force: true});
    await page.locator('.selector-mensas [data-mensa="eth-9"]').click();
    for (let i = 0; i < 3; i++) await page.locator('.selector-mensas [data-mensa="eth-9"]').click({force: true});
    await verifyMenus(page, data, '2026-10-13');
    assert.equal(await dish.evaluate(el => el.isConnected && el === document.querySelector('[data-mensa="uzh-untere-mensa"] .dish')), true, 'photo toggles reuse the dish node');
    assert.equal(await page.locator('#photo-row').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('img.dish-photo').count(), 1);
    await page.locator('#menu-btn').click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('scroll-locked'));
    if (process.env.BROWSER_SCREENSHOT) await page.screenshot({path: process.env.BROWSER_SCREENSHOT, fullPage: true});

    await page.evaluate(() => localStorage.setItem('eth-uzh-nutrition-prefs', JSON.stringify({selected: ['eth-9'], photos: false})));
    await page.reload();
    await page.waitForSelector('html.anim-ready');
    assert.equal(await page.locator('#opening-row').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#price-row').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#content .mensa-section').count(), 1);
    await verifyMenus(page, data, '2026-10-13');
    assert.deepEqual(errors, []);

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
