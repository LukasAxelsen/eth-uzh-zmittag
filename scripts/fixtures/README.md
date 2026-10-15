# Offline fixtures

These fixtures exercise behavior; they are not a complete live menu snapshot.

- `uzh-weekly.html`: minimized captured Food2050 Untere Mensa response for
  2026-10-12 through 2026-10-18; retains split Flight chunks and shared references.
- `uzh-detail.html`: minimized Garden response with optional saturated-fat
  field removed, covering partial nutrition.
- `uzh-garden-detail.html`: nutrition, name, photo and prices preserved from
  the captured 2026-10-13 Garden detail record at
  `https://app.food2050.ch/de/zfv/universitat-zurich,campus-zentrum/untere-mensa/mittagsverpflegung,hauptspeisen,garden/2026-10-13`.
  `saturatedFat` reports `unit: "g"`, `amountPer100g: 1.969934482758621`,
  `amount: 11.42562`, and serving weight 580 g. The public adapter rounds
  per-100g values to one decimal, yielding 2.0 g, and preserves serving values.
- `eth-normal.json` / `eth-empty.json`: synthetic Cookpit response shapes
  for normal service and explicitly empty meals.
- `eth-polyterrasse-2026-10-14.json` / `sv-polyterrasse-week.json`: minimized
  captured Cookpit and SV public menu records for matching regression tests.
  The SV fixture keeps that date's six lunch categories, product IDs,
  Teasers, weights and nutrition. Piccata publishes 600 g and 685 kcal per
  serving despite 120 kcal/100 g; this inconsistency must remain visible in
  the data instead of being overwritten with a calculated 720 kcal.
  Guest sessions, client credentials and tokens are never stored in fixtures.
- `eth-unpublished.json`: exact empty-object response captured from the
  dated Cookpit endpoint for 2026-10-17. This is unpublished data, not
  confirmation of closure or empty service. Future/weekend dates allow it;
  an unpublished source on the current weekday remains protected.
- `uzh-empty.html`: synthetic dated empty calendar in the legacy page shape.
- `uzh-changed.html`: HTTP-200 body without the expected published menu data.
- `uzh-missing-fields.html`: synthetic valid detail with absent photo,
  nutrition and prices.
- `uzh-unpublished-week.html`: minimized real 2026-10-13 Obere Mensa response:
  `menuCategory: null`, a dated week range, and the explicit visible message
  `Für diese Woche ist kein Menüplan verfügbar.` This is `not_published`,
  not confirmed empty service or confirmed closure. A missing `daily` field
  without this positive source evidence remains a parse failure.
- `uzh-unsupported-detail.html`: minimized visible response captured for
  2026-10-19 Butcher details at Mensa Oerlikon and Tierspital. The upstream
  page reports unsupported menu-item types and supplies no menuItem data;
  this stays a detail parse failure, with no inferred empty menu/closure.
- `uzh-oerlikon-next-week.html` / `uzh-tierspital-next-week.html`: minimized
  official week-43 responses captured on 2026-10-15 using the site's own
  `?week=43&year=2026` navigation. Oerlikon lists Garden and Farm on October
  19, without Butcher; Tierspital has dated empty lists for that week.
  Reusing the preceding week's categories fabricated unsupported detail
  requests. These fixtures require following the requested week's actual
  links, caching by outlet/week and preserving genuine detail failures.

HTTP faults are simulated at the transport boundary. Dated closure records
use explicit fixture reasons and example.com evidence; they never enter the
production `closures.json`. The browser preview labels its data as fixtures.
