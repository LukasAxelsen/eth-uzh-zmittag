# Zmittag

Today's menus for every ETH and UZH Mensa — calories, nutrition facts, and photos for many dishes, plus opening hours and prices. Updated automatically every morning, free, no account, no app.

Live: <https://lukasaxelsen.github.io/eth-uzh-zmittag/>

## Features

- Separate lunch and dinner menus with a one-tap switch
- Nutrition per dish — kcal, protein, fat, saturated fat, carbs, sugar, salt — per 100 g and per serving where available
- Dish photos, opening hours, and dish prices — all toggleable in the Setting panel
- A calendar to browse menus for today and the next two weeks
- Filter by Mensa or campus area (Central, Hoengg, Irchel, Oerlikon, Other), or save your own group of favorites
- Light, dark, and auto theme, and a layout that works on phones

Static site: no tracking.

## For developers

- `index.txt` — one line per dish, for scripts and LLMs
- A "raw data" panel on the site with a copy button
- [CONTRACT.md](CONTRACT.md) — `data.json` schema, DOM class contract, and the animation contract
- [AGENTS.md](AGENTS.md) — mandatory rules for any agent/human editing this repo (animation architecture, prohibitions, workflow)
- `scripts/verify-anim-contract.py` — machine-checkable animation contract; run after any frontend change
- `scripts/verify-menu-data.py` — deployment guard for the generated menu data

## Data sources

| Source | What we use |
| --- | --- |
| [ETH Cookpit API](https://idapps.ethz.ch/cookpit-pub-services/v1/meals) | Public JSON API for all ETH facilities. Energy comes in kJ and is converted to kcal; dish photo URLs come from the API's `image-url` field. |
| [SV public menus](https://sv-gastronomie.ch/stores) | Supplements matched Cookpit dishes with published serving weights, nutrition per serving and fiber for 11 ETH restaurants, including the Polyterrasse and Alumni Lounge dinner menus. |
| [UZH Food2050](https://app.food2050.ch) | Public weekly and dish pages, including embedded Pages Router / App Router data. Each dated dish page supplies nutrition, prices and photos. The former GraphQL endpoint is no longer used. |

All sources are public; no personal account or configured secret is required.
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

The frontend in `template/` is plain HTML/CSS/JS (no framework, no build).

## Project layout

```
menu.py                     Fetches everything, writes output/
sv_menu.py                  SV public guest client and Firestore document decoder
menu_data.py                Shared payload/publication validation
template/
  index.html                Page shell (placeholders get filled in by menu.py)
  style.css                 Apple-flat styling, light/dark/auto themes, responsive
  app.js                    Selection state, date picker, groups, settings, rendering
scripts/
  verify-anim-contract.py   Machine-checkable animation contract; run after frontend changes
  verify-menu-data.py       Blocks malformed or unexpectedly empty weekday data
.github/workflows/
  menu.yml                  Daily cron + manual dispatch, builds and deploys a Pages artifact
AGENTS.md                   Rules for any agent or human editing this repo
CONTRACT.md                 data.json schema, DOM class contract, animation contract
```

## Running it locally

Requirements: Python 3.9+ and `curl` (used for HTTP requests); Node.js for checks. No dependencies to install.

```sh
python3 menu.py   # on Windows: py menu.py
```

Then serve the `output/` directory:

```sh
cd output
python3 -m http.server 8000
```

Open <http://localhost:8000>.

Offline regression checks (no live requests):

```sh
python3 scripts/test-menu.py
python3 scripts/test-hardening.py
node scripts/test-date.cjs
node scripts/test-settings.cjs
node --check template/app.js
python3 -m py_compile menu.py menu_data.py sv_menu.py
python3 scripts/verify-anim-contract.py
```

Real browser regressions also use offline fixtures, with a fixed Zurich clock:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

The browser suite covers day selection and calendar markers, closure text,
preferences after reload and storage upgrades, rapid date/photo/mensa toggles,
node reuse, final layout and reduced motion. `BROWSER_EXECUTABLE` optionally
selects an existing Chromium binary; Node 20+ is required for these tests.

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

## Deployment

GitHub Actions schedules `menu.py` at 03:17 and 07:17 UTC, validates
`output/data.json`, uploads `output/` as a GitHub Pages artifact, and deploys
that artifact. The workflow has read-only repository access while it builds;
only the separate deployment job can publish to Pages. The offline and browser
regressions run before fetching live menus.

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
