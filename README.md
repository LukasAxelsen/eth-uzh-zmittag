# Zmittag

Zmittag collects lunch and dinner menus for 32 ETH Zürich and University of
Zurich dining locations. It shows the nutrition, prices, opening times and
photos available from the source. The site runs in a browser and can be used
without an account.

Live: <https://lukasaxelsen.github.io/eth-uzh-zmittag/>

## What the site does

- Switch between lunch and dinner, and browse published dates within a
  15-day window starting today. Dates without menus are disabled.
- Compare energy, protein, fat, saturated fat, carbohydrates, sugar, salt
  and fiber per 100 g and per serving, with serving weight where available.
- Select individual locations or campus groups: Central, Hoengg, Irchel,
  Oerlikon and Other. Create or delete groups, reset them, or undo the last
  group change without changing the selected locations.
- Use the Mensas, My Data and Setting sidebar tabs to manage selection,
  account sync, photos, opening times, prices and light/dark/auto appearance.
- Copy menus for the selected date, locations and meal as plain text from
  the raw data panel.

Nutrition coverage varies by location and dish. Missing values remain unknown;
an empty menu is not treated as evidence that a location is closed. A closed
label requires verified evidence for that location and date.

The site does not include an analytics SDK. Preferences are saved in browser
localStorage. Optional Google sign-in uses Firebase Authentication and stores
preferences in a private Firestore document for that account. On first login
to an existing account, the user chooses the cloud or local preferences before
syncing. Sign-out keeps the local preferences. Dates are neither saved nor
synced, and the current account document contains no health profile.
See [Firebase setup and sync behavior](docs/firebase-setup.md).

## For developers

- `data.json` — dated menus, source health and nutrition values
- `index.txt` — one line per dish for today's complete roster
- [CONTRACT.md](CONTRACT.md) — `data.json` schema, DOM class contract, and the animation contract
- [AGENTS.md](AGENTS.md) — mandatory rules for any agent/human editing this repo (animation architecture, prohibitions, workflow)
- `scripts/verify-anim-contract.py` — machine-checkable animation contract; run after any frontend change
- `scripts/verify-i18n-contract.py` — translation contract for the interface languages; run after any text change
- `scripts/verify-menu-data.py` — deployment guard for the generated menu data

## Data sources

| Source | What we use |
| --- | --- |
| [ETH Cookpit API](https://idapps.ethz.ch/cookpit-pub-services/v1/meals) | Public JSON API for all ETH facilities. Energy comes in kJ and is converted to kcal; dish photo URLs come from the API's `image-url` field. |
| [SV public menus](https://sv-gastronomie.ch/stores) | Supplements matched Cookpit dishes with published serving weights, nutrition per serving and fiber for 11 ETH restaurants, including the Polyterrasse and Alumni Lounge dinner menus. |
| [UZH Food2050](https://app.food2050.ch) | Public weekly and dish pages, including embedded Pages Router / App Router data. Each dated dish page supplies nutrition, prices and photos. The former GraphQL endpoint is no longer used. |

Menu collection uses public sources; no personal account or configured secret
is required for the scraper.
SV's current website configuration and standard guest session are discovered
at build time; session tokens stay in memory. The script waits between requests
to stay under Food2050's rate limits.

Published per-serving nutrients take precedence. When a nutrient is missing
and a positive serving weight is known, the backend calculates
`total = per100g × servingWeight / 100`, before display rounding. This fallback
also applies to every UZH Food2050 outlet. SV's zero-weight, zero-filled buffet
records stay unknown. There is no guessed default portion size.

SV matches require the same restaurant, date, lunch/dinner menu, line, dish
name and sides. Ingredient reordering and explicitly truncated long Cookpit
descriptions are supported, along with verified Tannenbar line aliases;
ambiguous matches are left untouched. Each matched dish records
`nutritionSource` with its public URL/IDs and supplied/calculated fields.
An unpublished SV week leaves totals unknown; a failed request or malformed
published menu blocks publication through the existing source-health guard.
FUSION/Compass and other restaurants without verified weights remain partial.

## How it works

`menu.py` fetches ETH and UZH menus, supplements ETH dishes via `sv_menu.py`,
validates them with `menu_data.py`, and writes:

- `output/data.json` — structured data for the frontend
- `output/index.txt` — one line per dish (see [For developers](#for-developers))
- `output/index.html`, `output/style.css`, `output/app.js` — the assembled site
- `output/firebase-config.js`, `output/account-sync.mjs` — public Firebase
  configuration and account sync code

The frontend in `template/` is plain HTML, CSS and JavaScript. `menu.py`
assembles the output without a frontend bundler. Account sync loads the
Firebase SDK from Google's CDN; menu browsing does not require sign-in.

## Project layout

```
menu.py                     Fetches everything, writes output/
sv_menu.py                  SV public guest client and Firestore document decoder
menu_data.py                Shared payload/publication validation
template/
  index.html                Page shell (placeholders get filled in by menu.py)
  style.css                 Apple-flat styling, light/dark/auto themes, responsive
  app.js                    Selection state, date picker, groups, settings, rendering
  account-sync.mjs          Firebase transport and preference sync state machine
  firebase-config.js        Public Web App configuration; no private credentials
firestore.rules             Per-account preference access and document validation
docs/firebase-setup.md      Firebase configuration and account behavior
zmittag-nutrition-core/     Independent calculation module; not wired into the site
scripts/
  verify-anim-contract.py   Machine-checkable animation contract; run after frontend changes
  verify-i18n-contract.py   Complete, current translations; no hard-coded or translated menu text
  verify-menu-data.py       Blocks malformed or unexpectedly empty weekday data
.github/workflows/
  menu.yml                  Daily cron + manual dispatch, builds and deploys a Pages artifact
AGENTS.md                   Rules for any agent or human editing this repo
CONTRACT.md                 data.json schema, DOM class contract, animation contract
```

## Running it locally

The site build needs Python 3.9+, `curl` and network access to the menu
sources. It uses Python's standard library. Node.js 20+ and npm are needed
for the browser checks; CI uses Node.js 24.

```sh
python3 menu.py   # on Windows: py menu.py
```

Then serve the `output/` directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory output
```

Open <http://localhost:8000/?v=local>. Rebuild after changing templates, and
change the query value when checking a new preview. Google sign-in also
requires the Firebase configuration and authorized localhost domain described
in the [setup guide](docs/firebase-setup.md).

Offline regression checks (no live requests):

```sh
python3 scripts/test-menu.py
python3 scripts/test-hardening.py
node scripts/test-date.cjs
node scripts/test-settings.cjs
node scripts/test-account-sync.mjs
node scripts/test-i18n.mjs
node --check template/app.js
node --check template/account-sync.mjs
python3 -m py_compile menu.py menu_data.py sv_menu.py
python3 scripts/verify-anim-contract.py
python3 scripts/verify-i18n-contract.py
```

Real browser regressions also use offline fixtures, with a fixed Zurich clock:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

The browser suite covers day selection and calendar markers, closure text,
preferences after reload and storage upgrades, rapid date/photo/mensa toggles,
node reuse, sidebar tabs, group actions, dialogs, final layout and reduced
motion. `BROWSER_EXECUTABLE` optionally selects an existing Chromium binary.
Fixtures disable production Firebase; real Google login and delivery between
devices need a separate check against the configured project.

The independent nutrition calculation module has its own documentation and
tests. It is included as source and is not currently copied into `output/`:

```sh
npm test --prefix zmittag-nutrition-core
```

See its [README](zmittag-nutrition-core/README.md) for scope, reference
semantics and validation details.

Live smoke checks are separate and opt-in:

```sh
python3 scripts/smoke-menu.py                         # both sources/all outlets
python3 scripts/smoke-menu.py --uzh-outlet untere-mensa # ETH + one UZH outlet
```

They verify source formats, dated responses and fields, with no fixed dish
names or daily dish/photo counts. A passing subset smoke is not evidence that
every outlet/date is healthy; the complete build verifies the full window.

To inspect the UI with clearly labelled test data (never deploy this preview):

```sh
python3 scripts/build-test-preview.py --output /tmp/menu-fixture-preview
python3 -m http.server 8001 --bind 127.0.0.1 --directory /tmp/menu-fixture-preview
```

## Personal nutrition

Personal nutrition is available in **My Data**, below the Google account.
Profiles save locally and share the existing account synchronization and
local/cloud choice with mensa selections, groups and settings. **Setting** has
General (13 nutrition standards and calculation choices), Appearance, and
Language. The default is Swiss BLV with an editable 40% lunch / 30%
dinner planning split. Some standards require additional profile or plan inputs.

## Interface languages

The interface and all nutrition text are available in Chinese (Simplified
and Traditional), Danish, English, French, German, Italian, Japanese, Latin
and Swiss German. Menus keep the language the mensas publish them in. Text
lives in one catalog per language (`template/i18n/<code>.json`, English is
the source). When English text changes in a release, translate the reported
keys in every catalog (an AI pass is fine) and lock the new source:

```sh
python3 scripts/verify-i18n-contract.py               # lists missing/stale keys
python3 scripts/verify-i18n-contract.py --update-lock # once every language is done
```

The check also rejects missing or extra keys, changed placeholders, numbers
or abbreviations, hard-coded UI strings and translated menu data.

Chinese and Japanese text uses fonts of the matching standard on every
platform (Simplified: GB, Traditional: Taiwan, Japanese: JIS). The date
heading's CJK serif is a self-hosted subset of Noto Serif SC/TC/JP
(`template/fonts/`, SIL Open Font License, see `OFL.txt`). If a CJK catalog
changes its date or weekday text, rebuild the subsets:

```sh
pip install fonttools brotli
python3 scripts/build-heading-fonts.py
```

Dish coverage compares only supplied/calculated serving **Total** values with
the active meal's applicable reference. Bars show `current / reference` amounts
and colour; missing totals, undefined targets and incompatible sugar definitions
have no bar. Reference ranges and upper budgets keep their original meaning.
The original calculation core is packaged by `menu.py` without formula changes.
Run `node scripts/test-nutrition.mjs` and `node zmittag-nutrition-core/test/run.mjs`
alongside the existing checks; browser tests also exercise the profile and bars.

## Deployment

The [menu workflow](.github/workflows/menu.yml) runs on a schedule at 03:17
and 07:17 UTC, or through manual dispatch. It runs `menu.py`, validates
`output/data.json`, uploads `output/` as a GitHub Pages artifact, and deploys
that artifact. The workflow has read-only repository access while it builds;
only the separate deployment job can publish to Pages. The offline and browser
regressions run before fetching live menus. A push alone does not trigger
deployment; after syncing code, run **Actions → Build and deploy daily
menus → Run workflow** on the intended branch.

GitHub Pages hosts the website. Firebase provides authentication and preference
storage only. When `firestore.rules` changes, deploy those rules to the
configured Firebase project as described in the setup guide before publishing
the corresponding frontend. Public Firebase configuration belongs in the
repository; CLI credentials and service-account keys do not.

Scheduled runs may be delayed. Each build preloads the next two weeks.
UZH dates use their own ISO-week page and that day's published detail links,
so categories from the current week are never guessed for future dates.
The browser selects today's date in Europe/Zurich independently of the build
date, including after midnight in an open tab. If today's data is absent,
it keeps the mensa list and shows empty meals instead of yesterday's dishes.

In **Settings → Pages**, set the publishing source to **GitHub Actions** once
before using this workflow. A weekday result with no dishes is blocked before
deployment. For a known holiday or closure, use **Run workflow** and enable
`allow_empty_today` to publish the intentionally empty menu. The override
never bypasses freshness, source health or date-window validation.

Verified dated closures belong in `closures.json` (or a file supplied with
`python3 menu.py --closures PATH`). Each record identifies an exact date and
stable mensa ID, a human-readable reason, and evidence with `kind` (`source`
or `calendar`), the official `url`, and ISO `confirmedOn` date. Add records
only after verifying that source; there are no guessed holiday/weekend
closures. A fully confirmed closed day can publish without the manual override.
An empty weekday without complete closure evidence remains blocked.

Every date carries independent ETH/UZH health and per-mensa service status.
Failures include their source, date, outlet and stage in logs. Builds record
observed dish counts for comparison with historical successful data; no fixed
daily count threshold is imposed. Failed requests, changed formats, invalid
fields or stale build dates stop the build before replacing previous output.
All artifacts are staged first and each final file is replaced atomically.

## License

© Aeneanicus. Menu data is property of ETH Zürich and the University of Zurich.
