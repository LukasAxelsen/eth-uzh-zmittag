#!/usr/bin/env python3
"""
Fetch all ETH + UZH mensa menus into data.json (structured, for the frontend)
and index.txt (plain text, for AI consumption).

Sources:
  - ETH facilities: Cookpit REST API (public, no auth). One call returns all
    facilities; meals are filtered client-side via meal-times mapping.
  - SV public menus: matching ETH dishes gain published serving weights
    and nutrients; missing totals are calculated from positive portions.
  - UZH outlets: public Food2050 weekly and dish pages. Embedded page data
    provides dated menus, nutrition, prices and photos.
"""
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
from urllib.parse import quote
from sv_menu import PublicMenus
from menu_data import validate_payload, validate_closures, validate_day, iso_date
from datetime import timedelta, datetime
from zoneinfo import ZoneInfo

# Pause before every HTTP request. Food2050 (app.food2050.ch) rate-limits
# rapid bursts, so the pacing lives inside http_get/http_post and covers the
# whole UZH scrape: list-API POSTs, weekly pages and per-dish detail pages.
SCRAPE_DELAY = 0.4  # seconds

USER_AGENT = "Mozilla/5.0 (compatible; eth-uzh-zmittag/1.0)"

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

def _current_date():
    """Zurich-local today, including summer/winter clock changes."""
    return datetime.now(ZoneInfo("Europe/Zurich")).date().isoformat()


TODAY = _current_date()

BASE = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE, "output")
TEMPLATE_DIR = os.path.join(BASE, "template")

# ETH facility-id -> (display name, default group)
ETH_FACILITIES = {
    1: ("bQm", "Central"),
    2: ("CafeBar", "Central"),
    3: ("Clausiusbar", "Central"),
    4: ("Kiosk CLA", "Central"),
    5: ("Dozentenfoyer", "Central"),
    6: ("Einstein & Zweistein", "Central"),
    7: ("food&lab", "Central"),
    8: ("Archimedes", "Central"),
    9: ("Mensa Polyterrasse", "Central"),
    10: ("Polysnack", "Central"),
    11: ("Tannenbar", "Central"),
    12: ("Eureka Take Away", "Central"),
    13: ("Zwei Grad Bistro", "Central"),
    14: ("Alumni quattro Lounge", "Central"),
    15: ("Bellavista", "Hoengg"),
    16: ("Mendokoro", "Hoengg"),
    19: ("food market", "Irchel"),
    20: ("FUSION meal", "Hoengg"),
    22: ("Rice Up!", "Hoengg"),
    23: ("Octavo", "Oerlikon"),
    27: ("Science Lounge", "Irchel"),
    28: ("Flavour Kitchen", "Irchel"),
}

# ETH meal-time names -> Lunch/Dinner (anything else is dropped)
ETH_LUNCH_NAMES = ("Mittag", "Mittagessen", "Lunch")
ETH_DINNER_NAMES = ("Abend", "Abendessen", "Dinner")

# ETH customer-group codes -> display labels (user's STUD/INT/EXT format)
ETH_PRICE_LABELS = {
    10: "STUD",       # Studierende
    11: "INT",        # Interne
    12: "INT&STUD",   # Interne & Studierende
    13: "EXT",        # Extern
    14: "ALL",        # Alle Besucher (single-price outlets)
}

# Cookpit facility -> (SV store, official name, meal-slot menu IDs).
# Verified against SV's public store directory, including both dinner menus.
ETH_SV_MENUS = {
    3: (42011, 'Clausiusbar', {'Lunch': 18511}),
    5: (42005, 'Dozentenfoyer', {'Lunch': 18502}),
    7: (42013, 'FoodLAB', {'Lunch': 18513}),
    8: (42010, 'Archimedes', {'Lunch': 18510}),
    9: (42009, 'Polyterrasse', {'Lunch': 18509, 'Dinner': 18508}),
    10: (42012, 'Polysnack', {'Lunch': 18512}),
    11: (42014, 'Tannenbar', {'Lunch': 18514}),
    14: (42007, 'Alumni Lounge', {'Lunch': 18504, 'Dinner': 18657}),
    16: (42006, 'Mendokoro', {'Lunch': 18503}),
    19: (42008, 'Food market', {'Lunch': 18505}),
    23: (42015, 'Octavo', {'Lunch': 18515}),
}

SV_NUTRIENT_MAP = {
    'KCal': 'kcal', 'Proteins': 'protein', 'Fats': 'fat', 'Sats': 'saturated',
    'Carbs': 'carbs', 'Sugar': 'sugar', 'Salt': 'salt', 'Roughage': 'fiber',
}

# UZH outlet opening hours (lunch service), verified 2026-08-10 from the
# ZFV operator pages (zfv.ch/de/essen-gehen/...) — Food2050 has no
# structured hours, so this table is the source of truth. Weekends are
# closed for every UZH outlet (all pages say Montag-Freitag). Lichthof
# is closed for renovation (page: "vorübergehend geschlossen").
UZH_OPENING = {
    "untere-mensa": {"Lunch": "11:00 - 14:30", "Dinner": "17:00 - 19:00"},
    "obere-mensa": {"Lunch": "11:00 - 14:30", "Dinner": None},
    "lichthof": {"Lunch": None, "Dinner": None},
    "mensa": {"Lunch": "11:00 - 14:00", "Dinner": None},
    "green-kitchen": {"Lunch": "11:00 - 14:00", "Dinner": None},
    "seerose": {"Lunch": "07:30 - 19:30", "Dinner": None},
    "uzh-binzmuehle": {"Lunch": "11:15 - 14:15", "Dinner": None},
    "uzh-cityport": {"Lunch": "09:00 - 14:30", "Dinner": None},
    "tierspital": {"Lunch": "06:30 - 16:30", "Dinner": None},
    "uzh-botanischergarten": {"Lunch": "08:00 - 17:00", "Dinner": None},
}

# UZH price-category names -> display labels (Food2050 detail pages)
UZH_PRICE_LABELS = {
    "Studierende": "STUD",
    "Mitarbeitende": "INT",
    "Externe": "EXT",
    "Gäste": "GUEST",
    "Alle": "ALL",
}

# Food2050 location-id -> (default group, kitchen-slug -> display name)
UZH_LOCATIONS = {
    "e321519e-3f83-4a10-b6d8-22d395ebfc5d": ("Central", {
        "untere-mensa": "Untere Mensa", "obere-mensa": "Obere Mensa",
        "lichthof": "Lichthof",
    }),
    "2d415736-961b-4237-9a6e-f825577e6c73": ("Irchel", {
        "mensa": "Mensa Irchel", "green-kitchen": "Green Kitchen Lab",
        "seerose": "Seerose",
    }),
    "6c3a3659-a85b-4224-b340-a342396626b3": ("Oerlikon", {
        "uzh-binzmuehle": "Mensa Oerlikon",
    }),
    "2f761b0c-5a03-43dc-8cdc-378df8536d01": ("Other", {
        "uzh-cityport": "Cityport Mensa",
    }),
    "0663eb48-5f4d-4ca0-bdd7-238257009003": ("Other", {
        "tierspital": "Tierspital Mensa",
    }),
    "5bbfd257-fb0a-48c2-a406-891fa647da45": ("Other", {
        "uzh-botanischergarten": "Botanischer Garten",
    }),
}

# Outlets with a public Food2050 weekly page (used for nutrition scraping).
# NOTE: web slugs/paths differ from the GraphQL API slugs (e.g. API
# "green-kitchen" -> web "green-kitchen-lab", API "uzh-cityport" -> web
# "cityport/cityport"). Each entry was verified against the outlet page's
# own /menu/weekly links.
UZH_WEEKLY_URLS = {
    "untere-mensa": "https://app.food2050.ch/de/zfv/universitat-zurich%2Ccampus-zentrum/untere-mensa/mittagsverpflegung/menu/weekly",
    "obere-mensa": "https://app.food2050.ch/de/zfv/universitat-zurich%2Ccampus-zentrum/obere-mensa/mittagsverpflegung/menu/weekly",
    "lichthof": "https://app.food2050.ch/de/zfv/universitat-zurich%2Ccampus-zentrum/lichthof/mittagsverpflegung/menu/weekly",
    "mensa": "https://app.food2050.ch/de/zfv/universitat-zurich%2Ccampus-irchel/mensa/mittagsverpflegung/menu/weekly",
    "green-kitchen": "https://app.food2050.ch/de/zfv/universitat-zurich%2Ccampus-irchel/green-kitchen-lab/mittagsverpflegung/menu/weekly",
    "seerose": "https://app.food2050.ch/de/zfv/universitat-zurich%2Ccampus-irchel/seerose/mittag/menu/weekly",
    "uzh-binzmuehle": "https://app.food2050.ch/de/zfv/universitat-zurich%2Ccampus-oerlikon/mensa-binzmuhle/mittagsverpflegung/menu/weekly",
    "uzh-cityport": "https://app.food2050.ch/de/zfv/universitat-zurich%2Ccityport/cityport/mittagsverpflegung/menu/weekly",
    "tierspital": "https://app.food2050.ch/de/zfv/universitat-zurich%2Ctierspital-1/tierspital/mittagsverpflegung/menu/weekly",
    "uzh-botanischergarten": "https://app.food2050.ch/de/zfv/universitat-zurich%2Cbotanischer-garten/botanischer-garten/mittagsverpflegung/menu/weekly",
}

# All nutrition rows the frontend table shows (fixed order)
NUTRITION_KEYS = ["kcal", "protein", "fat", "saturated", "carbs", "sugar", "salt", "fiber", "weight"]

ETH_NUTRIENT_KEYS = ["energy", "protein", "fat", "saturated-fatty-acids", "carbohydrates", "sugar", "salt"]
ETH_NUTRIENT_LABELS = ["kcal", "protein", "fat", "saturated", "carbs", "sugar", "salt"]

# Food2050 stats key -> data.json label. The source emits "fibers"
# (plural) and "energy" already in kcal — no conversion needed.
UZH_NUTRIENT_MAP = {
    "energy": "kcal", "protein": "protein", "fat": "fat", "saturatedFat": "saturated",
    "carbohydrates": "carbs", "sugar": "sugar",
    "salt": "salt", "fibers": "fiber",
}


# --------------------------------------------------------------------------
# HTTP + numeric helpers
# --------------------------------------------------------------------------

class SourceError(ValueError):
    """A failed request or invalid source response, never an empty menu."""
    def __init__(self, status, stage, message):
        super().__init__(message)
        self.status, self.stage = status, stage

    def record(self):
        return {"status": self.status, "stage": self.stage, "message": str(self)}


def source_body(url, stage):
    try:
        body = http_get(url)
    except SourceError as err:
        raise SourceError(err.status, stage, str(err)) from err
    if not body:
        raise SourceError("parse_failed", stage, f"successful request has an empty body: {url}")
    return body


def _num(value):
    """Parse a finite number; missing is None, and a real zero stays zero."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        if isinstance(value, bool) or not isinstance(value, (str, int, float)):
            raise ValueError('not a number')
        text = value.strip().replace(',', '.') if isinstance(value, str) else value
        f = float(text)
        if not math.isfinite(f):
            raise ValueError('not finite')
    except (TypeError, ValueError, OverflowError) as err:
        raise SourceError('parse_failed', 'numeric', f'invalid number {value!r}') from err
    return f


def field_number(value, path, *, per100=False, energy=False):
    """Price/nutrition constraints belong to the field, not the parser."""
    try:
        result = _num(value)
        if result is not None and (result < 0 or (per100 and not energy and result > 100)):
            raise ValueError('outside non-negative field range')
        return result
    except (SourceError, ValueError) as err:
        raise SourceError('parse_failed', 'numeric', f'{path}: {err}') from err


def _keep_number(value):
    """Like _num, but keeps integers as ints (UZH per-serving amounts)."""
    f = _num(value)
    if f is None:
        return None
    return int(f) if f.is_integer() else f


def complete_serving_nutrition(p100, total):
    """Fill missing serving fields from a positive, source-supplied weight.

    Direct serving values (including zero) always win. Call this before
    rounding per-100g values for display, to avoid multiplying rounding error.
    """
    result = dict(total)
    weight = field_number(result.get('weight'), 'nutrition.total.weight')
    calculated = []
    if weight is not None and weight > 0:
        for key in NUTRITION_KEYS:
            if key == 'weight' or key in result or key not in p100:
                continue
            amount = field_number(p100[key], f'nutrition.p100.{key}', per100=True, energy=key == 'kcal')
            if amount is not None:
                result[key] = field_number(round(amount * weight / 100, 6), f'nutrition.total.{key}')
                calculated.append(key)
    return result, calculated


# --------------------------------------------------------------------------
# Text normalization (name/desc formatting sync)
#
# Sources disagree wildly: UZH dishes are ALL-CAPS blobs ("HUMMUS BOWL,
# Ofengemüse, Süsskartoffeln"), ETH sometimes stores names in caps too
# (Flavour Kitchen, some Abend entries), separators vary (' | ', ', ', '/'),
# and line names are lowercase slugs ('farm') or brand caps ('STREET').
# These helpers normalize everything to the Polyterrasse-lunch style:
#   line — Dish | Ingredient | Ingredient …
# --------------------------------------------------------------------------

# Words kept lowercase when title-casing ALL-CAPS names (de/en/fr/it).
TITLE_CASE_STOPWORDS = {
    "mit", "und", "of", "and", "the", "a", "an", "de", "la", "le", "les",
    "en", "au", "aux", "du", "des", "in", "im", "auf", "aus", "für", "fuer",
    "bei", "von", "zum", "zur", "am", "zu", "an", "da", "del", "di", "della",
    "on", "at", "&",
}

# Category words that sometimes leak into UZH dish names ("FARM SHAKSHUKA").
UZH_NAME_PREFIXES = ("FARM ", "BUTCHER ", "GARDEN ", "VEGAN ")


def clean_text(s):
    """Strip and collapse internal whitespace ('a  |  b' -> 'a | b')."""
    return " ".join(str(s or "").split())


def title_case(s):
    """Title-case an ALL-CAPS name: 'HUMMUS BOWL' -> 'Hummus Bowl'."""
    words = []
    for w in s.split():
        low = w.lower()
        if low in TITLE_CASE_STOPWORDS:
            words.append(low)
        else:
            words.append(w[0].upper() + w[1:].lower())
    return " ".join(words)


def clean_dish_name(name):
    """Trim a dish name and de-CAPSIFY it when the source is all caps."""
    name = clean_text(name)
    if name.isupper():
        name = title_case(name)
    return name


def title_slug(line):
    """Line names: title-case lowercase slugs ('farm' -> 'Farm'); keep brand caps."""
    line = clean_text(line)
    if line.islower():
        return title_case(line)
    return line


def uzh_category_from_url(detail_url):
    """Extract the category (line) segment from a Food2050 detail URL.

    Detail URLs look like ``.../mittagsverpflegung,{meal},{category}/{date}``
    (e.g. ``...,hauptspeisen,garden/2026-08-03``). The segment directly
    before the trailing date is the category. Older URLs used ``unten`` as
    the meal segment and some outlets use ``mittag`` — taking the last
    path segment covers every variant, so the line survives even when the
    JSON payload omits ``menuItem.category`` (which the detail page does).
    """
    m = re.search(r"/([^/]+)/(\d{4}-\d{2}-\d{2})$", detail_url or "")
    seg = m.group(1) if m else ""
    # The last path segment is comma-joined ("mittagsverpflegung,hauptspeisen,garden");
    # the category is its final part.
    return seg.rsplit(",", 1)[-1] if seg else ""

def normalize_desc(desc):
    """Unify ingredient lists to ' | ' separators regardless of source style
    (ETH pipes, UZH commas, Tannenbar slashes)."""
    desc = clean_text(desc)
    if not desc:
        return ""
    chunks = []
    for part in re.split(r"[,/|]", desc):
        part = part.strip()
        if part:
            chunks.append(part)
    return " | ".join(chunks)


def split_uzh_name(name):
    """Split a UZH blob into (head, rest): 'HUMMUS BOWL, Ofengemüse, ...'
    -> ('HUMMUS BOWL', 'Ofengemüse, ...'). No comma -> (name, '')."""
    if "," in name:
        head, rest = name.split(",", 1)
        return head.strip(), rest.strip()
    return name.strip(), ""


def strip_uzh_prefix(head):
    """Drop a category word that leaked into the name ('FARM SHAKSHUKA' -> 'SHAKSHUKA')."""
    upper = head.upper()
    for p in UZH_NAME_PREFIXES:
        if upper.startswith(p) and len(upper) > len(p) + 1:
            return head[len(p):].strip()
    return head


def build_uzh_dish(name, line) -> dict:
    """One UZH dish with the name/desc split + normalized casing."""
    head, rest = split_uzh_name(name)
    head = strip_uzh_prefix(head)
    return {
        "line": title_slug(line),
        "dish": clean_dish_name(head),
        "desc": normalize_desc(rest),
    }


def _uzh_named_dish(dish, line):
    """New pages publish ingredients separately; old pages embed them in name."""
    result = build_uzh_dish(dish.get("name", ""), line)
    description = normalize_desc(dish.get("description") or "")
    if description:
        result["desc"] = description
    return result


def _curl(args, timeout=30):
    """Return a response body; retain transport errors after both attempts."""
    cmd = ["curl", "-fsSL", "--connect-timeout", "10", "-A", USER_AGENT] + args
    error = "empty response"
    for attempt in range(2):
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            if result.returncode == 0:
                return result.stdout
            error = result.stderr.strip() or f"curl exit {result.returncode}"
        except (OSError, subprocess.TimeoutExpired) as err:
            error = str(err)
        if attempt == 0:
            time.sleep(SCRAPE_DELAY)  # brief backoff before the retry
    raise SourceError("request_failed", "request", f"{args[0]}: {error}")


def http_get(url, timeout=30, headers=None):
    """GET a URL; raise SourceError on a failed request."""
    time.sleep(SCRAPE_DELAY)  # pace every request (Food2050 rate limits)
    args = [url]
    for key, value in (headers or {}).items():
        args += ['-H', f'{key}: {value}']
    return _curl(args, timeout=timeout)


def http_post(url, body, headers=None, timeout=30):
    """POST JSON; transport failures raise, absent/invalid JSON returns {}."""
    time.sleep(SCRAPE_DELAY)  # pace every request (Food2050 rate limits)
    args = ["-X", "POST", url, "-H", "Content-Type: application/json"]
    for k, v in (headers or {}).items():
        args += ["-H", f"{k}: {v}"]
    args += ["-d", body]
    text = _curl(args, timeout=timeout)
    try:
        return json.loads(text) if text else {}
    except ValueError:
        return {}


# --------------------------------------------------------------------------
# ETH
# --------------------------------------------------------------------------

def eth_meal_slot(meal_time_name):
    """Map an ETH meal-time name to a slot ('Lunch'|'Dinner') or None."""
    if any(t in meal_time_name for t in ETH_DINNER_NAMES):
        return "Dinner"
    if any(t in meal_time_name for t in ETH_LUNCH_NAMES):
        return "Lunch"
    return None


def fetch_eth(date=None):
    """Return list of {id, name, group, meals: {Lunch: [...], Dinner: [...]}}."""
    date = date or TODAY
    url = (
        f"https://idapps.ethz.ch/cookpit-pub-services/v1/meals"
        f"?client-id=ethz-wcms&lang=de&date={date}&facility-id=9"
        f"&meal-times-after={date}T00:00:00Z&meal-times-before={date}T23:59:59Z"
    )
    body = source_body(url, "response")
    try:
        data = json.loads(body)
        # The dated Cookpit endpoint returns exactly {} for unpublished
        # dates (captured on 2026-10-17). Keep this distinct from a dated
        # explicit [] response and from an unrecognized non-empty schema.
        unpublished = data == {}
        meals, meal_times = ([], []) if unpublished else (data["meals"], data["meal-times"])
        if not isinstance(meals, list) or not isinstance(meal_times, list):
            raise ValueError("meals and meal-times must be arrays")
        if any(not isinstance(m, dict) for m in meals + meal_times):
            raise ValueError("meals and meal-times entries must be objects")
    except (KeyError, TypeError, ValueError) as err:
        raise SourceError("parse_failed", "response", f"ETH meals/meal-times: {err}") from err

    # meal-time-id -> (facility-id, meal-time-name, time-from, time-to)
    mt_map = {
        mt.get("meal-time-id"): (
            mt.get("facility-id"),
            mt.get("meal-time-name", ""),
            mt.get("time-from", ""),
            mt.get("time-to", ""),
        )
        for mt in meal_times if mt.get("meal-time-id")
    }

    # facility-id -> {slot: "HH:MM - HH:MM"} (opening hours per meal)
    opening = {}
    for mt in meal_times:
        fid = mt.get("facility-id")
        slot = eth_meal_slot(mt.get("meal-time-name", ""))
        if fid not in ETH_FACILITIES or slot is None:
            continue
        tf = fmt_eth_time(mt.get("time-from", ""))
        tt = fmt_eth_time(mt.get("time-to", ""))
        if tf and tt:
            opening.setdefault(fid, {})[slot] = f"{tf} - {tt}"

    # facility-id -> {Lunch: [dishes], Dinner: [dishes]}
    per_facility = {}
    for m in meals:
        if not isinstance(m.get("meal-name"), str) or not m["meal-name"].strip():
            raise SourceError("parse_failed", "response", "ETH meal-name is missing or empty")
        mt_id = m.get("meal-time-id")
        if mt_id not in mt_map:
            raise SourceError("parse_failed", "response", f"ETH unknown meal-time-id {mt_id!r}")
        fid, mt_name, _, _ = mt_map[mt_id]
        if fid not in ETH_FACILITIES:
            continue
        slot = eth_meal_slot(mt_name)
        if slot is None:
            continue

        # ETH occasionally packs "Main dish | Side" into meal-name — fold
        # the side part into the desc so the dish name stays clean.
        name_parts = [p for p in m["meal-name"].split("|")]
        extra = " | ".join(p.strip() for p in name_parts[1:])
        raw_desc = m.get("description", "")
        if extra:
            raw_desc = f"{extra} | {raw_desc}"

        # Prices: customer-group array -> [{label, value}] (STUD/INT/EXT)
        prices = []
        for p in (m.get("meal-price-array") or []):
            val = field_number(p.get("price"), "ETH price")
            if val is None:
                continue
            prices.append({
                "label": ETH_PRICE_LABELS.get(
                    p.get("customer-group-code"),
                    (p.get("customer-group-desc-short") or "").strip() or "CHF",
                ),
                "value": val,
            })

        dish = {
            "line": title_slug(m.get("line-name", "")),
            "dish": clean_dish_name(name_parts[0]),
            "desc": normalize_desc(raw_desc),
            # ETH image URLs require the client-id query param — without
            # it the API returns an error text, not the JPEG.
            "photo": (m.get("image-url") or "").rstrip("/") + "?client-id=ethz-wcms" if m.get("image-url") else "",
            "nutrition": {},
            "price": prices,
            "priceUnit": (m.get("price-unit-desc-short") or "").strip(),
        }
        # ETH energy is kJ. There is no confirmed zero-as-missing sentinel:
        # retain supplied zeros, and omit only genuinely absent values.
        nutr = {}
        for nk, nl in zip(ETH_NUTRIENT_KEYS, ETH_NUTRIENT_LABELS):
            val = field_number(m.get(nk), f"ETH nutrition.{nk}", per100=True, energy=nl == 'kcal')
            if val is None:
                continue
            if nl == "kcal":
                val = val / 4.184
            nutr[nl] = val
        dish["nutrition"]["p100"] = nutr
        dish["nutrition"]["total"] = {}

        per_facility.setdefault(fid, {"Lunch": [], "Dinner": []})[slot].append(dish)

    result = []
    for fid, (name, group) in ETH_FACILITIES.items():
        # Keep every configured facility even when it has no dishes today
        # (weekends, holidays) so the frontend renders it with its
        # "no meals" notice instead of silently disappearing.
        meals_by_slot = per_facility.get(fid, {"Lunch": [], "Dinner": []})
        result.append({
            "id": f"eth-{fid}",
            "name": f"ETH {name}",
            "group": group,
            "opening": {
                "Lunch": (opening.get(fid) or {}).get("Lunch"),
                "Dinner": (opening.get(fid) or {}).get("Dinner"),
            },
            "meals": {
                "Lunch": meals_by_slot.get("Lunch", []),
                "Dinner": meals_by_slot.get("Dinner", []),
            },
            "service": {"status": "ok" if any(meals_by_slot.values()) else 'not_published' if unpublished else "confirmed_empty"},
        })
    enrich_eth_nutrition(result, date)
    # Serving calculations use unrounded densities; retain the existing
    # one-decimal Cookpit energy output after supplementation is complete.
    for mensa in result:
        for dishes in mensa['meals'].values():
            for dish in dishes:
                p100 = dish['nutrition']['p100']
                if 'kcal' in p100:
                    p100['kcal'] = round(p100['kcal'], 1)
    return result


_sv_client = None
_sv_week_cache = {}


def _load_sv_week(menu_id, year, week):
    global _sv_client
    key = (menu_id, year, week)
    if key not in _sv_week_cache:
        try:
            if _sv_client is None:
                _sv_client = PublicMenus(http_get, http_post)
            _sv_week_cache[key] = _sv_client.week(*key)
        except (SourceError, ValueError, TypeError, KeyError) as err:
            # Do not emit session values or credential-bearing URLs in logs.
            status = err.status if isinstance(err, SourceError) else 'parse_failed'
            _sv_week_cache[key] = SourceError(status, 'sv-menu', f'SV menu {menu_id}, {year}-W{week}: public menu unavailable ({status})')
    value = _sv_week_cache[key]
    if isinstance(value, SourceError):
        raise value
    return value


def _nutrition_match_key(dish):
    """Exact menu identity after shared display normalization; no fuzzy join."""
    def text(value):
        return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())
    return tuple(text(dish[k]) for k in ('line', 'dish', 'desc'))


def _sv_products(document, store_id, menu_id, date):
    if document is None:  # unpublished week, never reuse another date
        return {}
    if (not isinstance(document, dict) or document.get('StoreId') != store_id or
            document.get('MenuCardId') != menu_id or not isinstance(document.get('Days'), list)):
        raise SourceError('parse_failed', 'sv-menu', f'SV menu {menu_id}: wrong store/menu or missing Days')
    products = {}
    seen_dates = set()
    for day in document['Days']:
        if not isinstance(day, dict) or not isinstance(day.get('Date'), str):
            raise SourceError('parse_failed', 'sv-menu', f'SV menu {menu_id}: invalid date')
        day_date = day['Date'][:10]
        iso_date(day_date, 'SV day.Date')
        if day_date in seen_dates:
            raise SourceError('parse_failed', 'sv-menu', f'SV menu {menu_id}: duplicate date')
        seen_dates.add(day_date)
        if day_date != date:
            continue
        categories = day.get('Categories')
        if not isinstance(categories, list):
            raise SourceError('parse_failed', 'sv-menu', f'SV menu {menu_id}: missing Categories')
        for category in categories:
            if not isinstance(category, dict) or not isinstance(category.get('Products'), list):
                raise SourceError('parse_failed', 'sv-menu', f'SV menu {menu_id}: invalid category')
            for product in category['Products']:
                if (not isinstance(product, dict) or not isinstance(product.get('Name'), str) or
                        not product['Name'].strip() or not isinstance(product.get('Teaser', ''), str) or
                        not isinstance(category.get('Name'), str) or type(product.get('Id')) is not int):
                    raise SourceError('parse_failed', 'sv-menu', f'SV menu {menu_id}: invalid product identity')
                parts = product['Name'].split('|')
                desc = ' | '.join([p.strip() for p in parts[1:]] + [product.get('Teaser', '')])
                key = _nutrition_match_key({'line': title_slug(category['Name']),
                    'dish': clean_dish_name(parts[0]), 'desc': normalize_desc(desc)})
                products.setdefault(key, []).append(product)
    return products


def _sv_match(products, dish, fid):
    line, name, desc = _nutrition_match_key(dish)
    # Tannenbar publishes the same two lines under different operator labels.
    if fid == 11:
        line = {"viola's diner 2": 'world', "viola's diner 3": 'green'}.get(line, line)
    exact = products.get((line, name, desc), [])
    if exact:
        return (exact[0], 'exact') if len(exact) == 1 else (None, None)
    matches = []
    prefix = desc.rstrip('.').rstrip() if desc.endswith('..') else ''
    for (sv_line, sv_name, sv_desc), candidates in products.items():
        if (sv_line, sv_name) != (line, name):
            continue
        # Ingredient order does not change recipe identity; preserve duplicates.
        if desc and sorted(desc.split(' | ')) == sorted(sv_desc.split(' | ')):
            matches.extend((p, 'ingredient-order') for p in candidates)
        # Cookpit visibly truncates long Teasers with '..'. Match only an
        # explicit long prefix with the exact same dish and mapped menu line.
        elif len(prefix) >= 80 and sv_desc.startswith(prefix):
            matches.extend((p, 'truncated-description') for p in candidates)
    return matches[0] if len(matches) == 1 else (None, None)


def _sv_nutrition(product, cookpit_p100):
    facts = product.get('NutritionFacts')
    if facts is not None and not isinstance(facts, dict):
        raise SourceError('parse_failed', 'sv-menu', 'SV NutritionFacts must be an object')
    facts = facts or {}
    p100, total = dict(cookpit_p100), {}
    source_values = []
    for prefix, key in SV_NUTRIENT_MAP.items():
        per100 = field_number(facts.get(prefix + 'Per100'), f'SV {prefix}Per100', per100=True, energy=key == 'kcal')
        amount = field_number(facts.get(prefix + 'PerServing'), f'SV {prefix}PerServing')
        # Matched SV densities keep calculated fields on the same recipe as
        # the SV serving weight, and supply fiber omitted by Cookpit.
        if per100 is not None:
            p100[key] = per100
            source_values.append(per100)
        if amount is not None:
            total[key] = amount
            source_values.append(amount)
    for suffix, target in (('Per100', p100), ('PerServing', total)):
        if 'kcal' not in target:
            kj = field_number(facts.get('KJ' + suffix), 'SV KJ' + suffix, energy=True)
            if kj is not None:
                target['kcal'] = round(kj / 4.184, 6)
                source_values.append(kj)
    weight = field_number(product.get('WeightInGrams'), 'SV WeightInGrams')
    if weight == 0 and source_values and not any(source_values):
        # Choose-5 and similar configurable offers use zero-filled facts
        # together with zero weight as placeholders, not measured zero food.
        return {'p100': dict(cookpit_p100), 'total': {}}, [], []
    # SV uses zero weight for buffet/unknown portions. It is not a 0g meal.
    if weight is not None and weight > 0:
        total['weight'] = _keep_number(weight)
    supplied = [k for k in NUTRITION_KEYS if k in total and k != 'weight']
    total, calculated = complete_serving_nutrition(p100, total)
    for key, value in total.items():
        if key not in ('kcal', 'weight') and 'weight' in total and value > total['weight']:
            raise SourceError('parse_failed', 'sv-menu', f'SV {key} exceeds serving weight')
    return {'p100': p100, 'total': total}, supplied, calculated


def enrich_eth_nutrition(mensas, date):
    """Supplement existing dishes only; Cookpit still owns roster and menus."""
    year, week, _ = iso_date(date, 'SV date').isocalendar()
    for mensa in mensas:
        fid = int(mensa['id'].split('-')[1])
        if fid not in ETH_SV_MENUS:
            continue
        store_id, store_name, slots = ETH_SV_MENUS[fid]
        try:
            for slot, menu_id in slots.items():
                dishes = mensa['meals'][slot]
                if not dishes:
                    continue
                products = _sv_products(_load_sv_week(menu_id, year, week), store_id, menu_id, date)
                for dish in dishes:
                    product, match = _sv_match(products, dish, fid)
                    if product is None:
                        continue  # absent or ambiguous identity, keep unknown
                    nutrition, supplied, calculated = _sv_nutrition(product, dish['nutrition']['p100'])
                    dish['nutrition'] = nutrition
                    dish['nutritionSource'] = {
                        'provider': 'SV', 'url': 'https://sv-gastronomie.ch/menu/' + quote(f'ETH, {store_name}, Zürich'),
                        'date': date, 'storeId': store_id, 'menuId': menu_id, 'productId': product['Id'],
                        'suppliedTotals': supplied, 'calculatedTotals': calculated, 'match': match,
                    }
        except (SourceError, ValueError, TypeError, KeyError) as err:
            if not isinstance(err, SourceError):
                err = SourceError('parse_failed', 'sv-menu', f'SV menu {menu_id}: invalid published data')
            mensa['service'] = err.record()


def fmt_eth_time(ts):
    """'11:00:00+02:00' -> '11:00' ('' when missing/invalid)."""
    m = re.match(r"(\d{1,2}):(\d{2})", ts or "")
    if not m:
        return ""
    return f"{int(m.group(1)):02d}:{m.group(2)}"


# --------------------------------------------------------------------------
# UZH (Food2050)
# --------------------------------------------------------------------------

def fetch_uzh(date=None):
    """Return list of {id, name, group, meals} for all UZH Food2050 outlets.

    Every configured outlet is always included, even with empty meals
    (weekends, holidays, API hiccups) so the frontend renders it with
    its "no meals" notice instead of dropping it silently.
    """
    date = date or TODAY
    result = []
    for group, slug_names in UZH_LOCATIONS.values():
        for slug, name in slug_names.items():
            # Each date uses its own published week's dish list and links.
            try:
                dishes = scrape_uzh_date(slug, date)
                service = {"status": "ok" if dishes else (
                    "confirmed_empty" if date in _load_uzh_weekly(slug, date) else "not_published"
                )}
            except (SourceError, KeyError, TypeError, AttributeError, ValueError) as err:
                if not isinstance(err, SourceError):
                    err = SourceError('parse_failed', 'detail', f'{slug}: {err}')
                dishes, service = [], err.record()

            # Opening hours: table + weekend rule (every UZH outlet is
            # closed Sat/Sun per the operator pages).
            opening = UZH_OPENING.get(slug, {"Lunch": None, "Dinner": None})
            if datetime.strptime(date, "%Y-%m-%d").weekday() >= 5:
                opening = {"Lunch": None, "Dinner": None}

            result.append({
                # Some kitchen slugs already carry a "uzh-" prefix
                # (uzh-binzmuehle, uzh-cityport, uzh-botanischergarten).
                "id": "uzh-" + slug.removeprefix("uzh-"),
                "name": name,
                "group": group,
                "opening": opening,
                "meals": {"Lunch": dishes, "Dinner": []},
                "service": service,
            })
    return result


def uzh_dishes_from_list(today_offer):
    """Build dishes from the list API (no nutrition available).

    Recipe titles can be empty (Botanischer Garten publishes only display
    names) — fall back to the displayName so the outlet is not dropped.
    """
    dishes = []
    for offer in today_offer:
        for item in offer.get("digitalMenuItems") or []:
            recipe = item.get("recipe") or {}
            title = (recipe.get("title") or {}).get("de") or ""
            name = title or item.get("displayName") or ""
            if not clean_text(name):
                continue
            d = build_uzh_dish(name, "")
            d["photo"] = ""
            d["price"] = []
            d["nutrition"] = {"p100": {}, "total": {}}
            dishes.append(d)
    return dishes


def scrape_uzh_weekly(slug):
    """Scrape today's dishes + nutrition from the Food2050 weekly page.

    Returns a list of dishes. Source failures raise SourceError.
    """
    wk = _load_uzh_weekly(slug)
    if wk is None:
        return None
    items = wk.get(TODAY) or []
    if not items:
        return []  # page loaded, but nothing is served today

    dishes = []
    for item in items:
        dish_name = (item.get("dish") or {}).get("name", "")
        if not clean_text(dish_name):
            continue
        cat = (item.get("category") or {}).get("name", "") or uzh_category_from_url(item.get("detailUrl", ""))
        d = _uzh_named_dish(item.get("dish") or {}, cat)
        detail = scrape_uzh_detail(item.get("detailUrl"))
        d["photo"] = detail["photo"]
        d["price"] = detail["price"]
        d["nutrition"] = detail["nutrition"]
        dishes.append(d)
    return dishes


# Weekly pages parsed once per outlet and ISO week: {date: [menuItems]}.
# Only published detailUrls are requested; categories can change by date.
_weekly_cache = {}


def _food2050_props(html):
    """Decode public Pages Router or App Router page data without running JS.

    App Router's Flight chunks contain JSON records and references to
    shared objects. Join chunks before decoding and resolve data references.
    """
    legacy = re.search(r'<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if legacy:
        try:
            props = json.loads(legacy.group(1))["props"]["pageProps"]
            return props if isinstance(props, dict) else {}
        except (KeyError, ValueError, TypeError):
            return {}

    decoder = json.JSONDecoder()
    chunks = []
    for match in re.finditer(r'self\.__next_f\.push\(\s*', html):
        try:
            chunk, _ = decoder.raw_decode(html, match.end())
            if isinstance(chunk, list) and len(chunk) == 2 and chunk[0] == 1 and isinstance(chunk[1], str):
                chunks.append(chunk[1])
        except ValueError:
            continue
    stream = ''.join(chunks)
    records = {}
    for match in re.finditer(r'(?:^|\n)([0-9a-f]+):', stream):
        try:
            records[match.group(1)], _ = decoder.raw_decode(stream, match.end())
        except ValueError:
            continue  # module/control records aren't menu JSON

    def resolve(value, seen=frozenset()):
        if isinstance(value, dict):
            return {k: resolve(v, seen) for k, v in value.items()}
        if isinstance(value, list):
            return [resolve(v, seen) for v in value]
        if not isinstance(value, str) or not re.fullmatch(r'\$[0-9a-f]+(?::[^:]+)*', value):
            return value
        if value in seen:
            return None
        path = value[1:].split(':')
        target = records.get(path[0])
        try:
            for part in path[1:]:
                if isinstance(target, list):
                    target = target[3] if part == 'props' else target[int(part)]
                else:
                    target = target[part]
        except (KeyError, IndexError, ValueError, TypeError):
            return None
        return resolve(target, seen | {value})

    for value in records.values():
        if isinstance(value, list) and len(value) == 4 and isinstance(value[3], dict):
            props = value[3]
            if 'outlet' in props or 'menuItem' in props:
                return resolve(props)
    return {}


def _food2050_outlet(props):
    organisation = props.get('organisation')
    outlet = props.get('outlet') or (organisation.get('outlet') if isinstance(organisation, dict) else None)
    return outlet if isinstance(outlet, dict) else {}


def _food2050_menu_item(html):
    props = _food2050_props(html)
    category = _food2050_outlet(props).get("menuCategory") or {}
    parent = props if "menuItem" in props else category
    if not isinstance(parent, dict) or "menuItem" not in parent:
        raise SourceError("parse_failed", "detail", "Food2050 menuItem field is missing")
    item = parent["menuItem"]
    if item is None:
        return None  # explicit no dish for this dated category
    if not isinstance(item, dict):
        raise SourceError("parse_failed", "detail", "Food2050 menuItem must be an object or null")
    return item


def _load_uzh_weekly(slug, date=None):
    """Parse the requested week's page once per outlet and ISO week.

    Returns {date: [menuItems]} with validated calendar/menu structure.
    Caches both successful pages and SourceError failures across the window.
    """
    year, week, _ = datetime.strptime(date or TODAY, '%Y-%m-%d').isocalendar()
    cache_key = (slug, year, week)
    if cache_key in _weekly_cache:
        if isinstance(_weekly_cache[cache_key], SourceError):
            raise _weekly_cache[cache_key]
        return _weekly_cache[cache_key]
    url = UZH_WEEKLY_URLS.get(slug)
    if not url:
        raise SourceError("parse_failed", "weekly", f"no configured URL for {slug}")
    if (year, week) != datetime.strptime(TODAY, '%Y-%m-%d').isocalendar()[:2]:
        # Use the same ISO week/year query as Food2050's navigation.
        url += f'?week={week}&year={year}'

    try:
        html = source_body(url, "weekly")
        outlet = _food2050_outlet(_food2050_props(html))
        calendar = (outlet.get("menuCategory") or {}).get("calendar")
        if calendar is None:
            calendar = outlet.get("calendar")  # some outlets render it at outlet level
        published_week = calendar['week']
        if ('daily' not in published_week and 'menuCategory' in outlet and outlet['menuCategory'] is None and
                'Für diese Woche ist kein Menüplan verfügbar.' in html):
            # Captured Obere Mensa format: a dated week and an explicit
            # unpublished-menu notice. This is NOT empty service or closure.
            first = iso_date(published_week['from']['dateLocal'][:10], 'calendar.week.from')
            last = iso_date(published_week['lastDay']['dateLocal'][:10], 'calendar.week.lastDay')
            if first > last:
                raise ValueError('calendar.week range is reversed')
            _weekly_cache[cache_key] = {}
            return {}
        daily = published_week['daily']
        if not isinstance(daily, list):
            raise ValueError("calendar.week.daily must be an array")
        by_date = {}
        for index, day in enumerate(daily):
            frm = day["from"]["dateLocal"]
            day_date = frm[:10]
            if datetime.strptime(day_date, "%Y-%m-%d").date().isoformat() != day_date:
                raise ValueError(f"daily[{index}].from.dateLocal is not ISO")
            if day_date in by_date:
                raise ValueError(f"duplicate daily date {day_date}")
            items = day["menuItems"]
            if not isinstance(items, list):
                raise ValueError(f"{day_date}.menuItems must be an array")
            for item in items:
                name = item["dish"]["name"]
                if not isinstance(name, str) or not name.strip():
                    raise ValueError(f"{day_date}.menuItems.dish.name is empty")
            by_date[day_date] = items
    except SourceError as err:
        _weekly_cache[cache_key] = err
        raise
    except (KeyError, ValueError, TypeError, AttributeError) as err:
        error = SourceError("parse_failed", "weekly", f"{slug}: {err}")
        _weekly_cache[cache_key] = error
        raise error from err
    _weekly_cache[cache_key] = by_date
    return by_date


def scrape_uzh_date(slug, date):
    """Read this date's published dishes and details from its own week."""
    by_date = _load_uzh_weekly(slug, date)
    dishes = []
    for item in (by_date or {}).get(date, []):
        dish_name = (item.get("dish") or {}).get("name", "")
        if not clean_text(dish_name):
            continue
        cat = (item.get("category") or {}).get("name", "") or uzh_category_from_url(item.get("detailUrl", ""))
        d = _uzh_named_dish(item.get("dish") or {}, cat)
        detail = scrape_uzh_detail(item.get("detailUrl"))
        d["photo"] = detail["photo"]
        d["price"] = detail["price"]
        d["nutrition"] = detail["nutrition"]
        dishes.append(d)
    return dishes


def build_uzh_dish_from_detail(detail_url):
    """Build a dish from a detail page alone (name + nutrition + photo).

    Returns None only for an explicit null menuItem at that URL/date.
    """
    if not detail_url:
        return None
    menu_item = _food2050_menu_item(source_body(detail_url, "detail"))
    if menu_item is None:
        return None
    dish = menu_item.get("dish") or {}
    if not isinstance(dish, dict):
        raise SourceError('parse_failed', 'detail', 'dish must be an object')
    dish_name = dish.get("name", "")
    if not isinstance(dish_name, str) or not dish_name.strip():
        raise SourceError('parse_failed', 'detail', 'dish.name is missing or empty')
    # The detail page's menuItem carries no category field — the
    # category slug lives in the URL path (.../mittagsverpflegung,unten,
    # {cat}/{date}, seerose: .../mittag,{cat}/{date}). Recover it from
    # the last path segment before the date, restoring hyphens that
    # stand in for spaces ("voll-anders" -> "voll anders").
    category = ((menu_item.get("category") or {}).get("name", "") or
                uzh_category_from_url(detail_url)).replace("-", " ")
    d = _uzh_named_dish(dish, category)
    d.update(_uzh_item_facts(menu_item))
    return d


def _uzh_item_facts(menu_item):
    """A complete detail shape, even when optional name/stats/price are absent."""
    dish = menu_item.get("dish") or {}
    if not isinstance(dish, dict):
        raise SourceError('parse_failed', 'detail', 'dish must be an object')
    d = {"photo": clean_text(dish.get("imageUrl"))}
    # Prices live on the menuItem (not the dish) — same shape as
    # scrape_uzh_detail returns.
    prices = []
    raw_prices = menu_item.get('prices')
    if raw_prices is not None and not isinstance(raw_prices, list):
        raise SourceError('parse_failed', 'detail', 'prices must be an array')
    for p in (raw_prices or []):
        if not isinstance(p, dict):
            raise SourceError('parse_failed', 'detail', 'price must be an object')
        if p.get('currency') not in (None, 'CHF'):
            raise SourceError('parse_failed', 'numeric', 'price.currency must be CHF')
        amount = field_number(p.get("amount"), 'UZH price.amount')
        if amount is None:
            continue
        cat = (p.get("priceCategory") or {}).get("name", "")
        prices.append({
            "label": UZH_PRICE_LABELS.get(cat, cat.upper() or "CHF"),
            "value": amount,
        })
    d["price"] = prices
    stats = dish.get("stats") or {}
    if not isinstance(stats, dict):
        raise SourceError('parse_failed', 'detail', 'dish.stats must be an object')
    p100, total = {}, {}
    for key, label in UZH_NUTRIENT_MAP.items():
        v = stats.get(key)
        if v is None:
            continue
        if not isinstance(v, dict):
            raise SourceError('parse_failed', 'detail', f'dish.stats.{key} must be an object')
        unit = v.get('unit')
        expected_unit = 'kcal' if label == 'kcal' else 'g'
        if unit not in (None, expected_unit):
            raise SourceError('parse_failed', 'numeric', f'dish.stats.{key}.unit must be {expected_unit}')
        per100 = field_number(v.get("amountPer100g"), f'UZH stats.{key}.amountPer100g', per100=True, energy=label == 'kcal')
        if per100 is not None:
            p100[label] = per100
        amount = field_number(v.get("amount"), f'UZH stats.{key}.amount')
        if amount is not None:
            total[label] = int(amount) if amount.is_integer() else amount
    sw = stats.get("servingWeight")
    if isinstance(sw, dict):
        if sw.get('unit') not in (None, 'g'):
            raise SourceError('parse_failed', 'numeric', 'servingWeight.unit must be g')
        weight = field_number(sw.get("amount"), 'UZH stats.servingWeight.amount')
        if weight is not None:
            total["weight"] = int(weight) if weight.is_integer() else weight
            for label, amount in total.items():
                if label not in ('kcal', 'weight') and amount > weight:
                    raise SourceError('parse_failed', 'numeric', f'UZH stats.{label}.amount exceeds servingWeight.amount')
    elif sw is not None:
        raise SourceError('parse_failed', 'detail', 'servingWeight must be an object')
    total, _ = complete_serving_nutrition(p100, total)
    d["nutrition"] = {"p100": {k: round(v, 1) for k, v in p100.items()}, "total": total}
    return d


def scrape_uzh_detail(detail_url):
    """Fetch one dish's nutrition, photo and prices with a complete empty shape."""
    item = _food2050_menu_item(source_body(detail_url, "detail")) if detail_url else {}
    return _uzh_item_facts(item or {})


def source_summary(mensas):
    """Aggregate explicit outlet results, with failures taking precedence."""
    issues = [dict(m["service"], mensa=m["id"]) for m in mensas
              if m["service"]["status"] in ("request_failed", "parse_failed")]
    statuses = {m["service"]["status"] for m in mensas}
    count = sum(len(ds) for m in mensas for ds in m["meals"].values())
    status = (issues[0]["status"] if issues else "ok" if count else
              "confirmed_closed" if statuses == {"confirmed_closed"} else
              "not_published" if "not_published" in statuses else "confirmed_empty")
    return {"status": status, "dishCount": count, "issues": issues}


def collect_day(date, *, closures=None):
    """The scrape boundary: complete roster plus independent source health."""
    try:
        eth = fetch_eth(date)
    except (SourceError, KeyError, TypeError, AttributeError, ValueError) as err:
        if not isinstance(err, SourceError):
            err = SourceError('parse_failed', 'response', f'ETH: {err}')
        eth = [{"id": f"eth-{fid}", "name": f"ETH {name}", "group": group,
                "opening": {"Lunch": None, "Dinner": None},
                "meals": {"Lunch": [], "Dinner": []}, "service": err.record()}
               for fid, (name, group) in ETH_FACILITIES.items()]
    uzh = fetch_uzh(date)
    mensas = eth + uzh
    by_id = {m['id']: m for m in mensas}
    for record in validate_closures([] if closures is None else closures):
        if record['date'] != date:
            continue
        mensa = by_id[record['mensa']]
        if mensa['service']['status'] in ('request_failed', 'parse_failed'):
            continue  # evidence must never hide an observed source failure
        if any(mensa['meals'].values()):
            raise ValueError(f"closure {date} {mensa['id']} conflicts with published meals")
        mensa['service'] = {'status': 'confirmed_closed', 'reason': record['reason'],
                            'evidence': dict(record['evidence'])}
        mensa['opening'] = {'Lunch': None, 'Dinner': None}
    sources = {"ETH": source_summary(eth), "UZH": source_summary(uzh)}
    for source, health in sources.items():
        for issue in health["issues"]:
            print(f"{date} {source} {issue['mensa']} {issue['status']} "
                  f"stage={issue['stage']}: {issue['message']}", file=sys.stderr)
    return {"mensas": mensas, "sources": sources}


# --------------------------------------------------------------------------
# Plain-text dump (raw data for AI consumption)
# --------------------------------------------------------------------------

def _fmt_num(v):
    """Render a number the way JS String(n) does: whole floats lose the
    trailing '.0' (18.0 -> '18', 0.58 -> '0.58'). Keeps index.txt byte-
    identical with the frontend copy button (JSON round-trip drops .0)."""
    if isinstance(v, int):
        return str(v)
    s = str(v)
    return s.rstrip("0").rstrip(".") if "." in s else s


def format_nutrition(nutr):
    """One nutrition segment, e.g. 'kcal=152, protein=5.3g' ('' when empty)."""
    parts = []
    for key in NUTRITION_KEYS:
        v = nutr.get(key)
        if v is not None:
            unit = "" if key == "kcal" else "g"
            parts.append(f"{key}={_fmt_num(v)}{unit}")
    return ", ".join(parts)


def dish_body(line, dish, desc):
    """'line — dish | desc' with empty segments and line==dish duplicates dropped."""
    line = clean_text(line)
    dish = clean_text(dish)
    if line and line.lower() != dish.lower():
        head = f"{line} — {dish}"
    else:
        head = dish
    if desc:
        return f"{head} | {desc}"
    return head


def render_txt(mensas, date=None):
    """One physical line per dish: NAME/SLOT: line — dish | desc | per100g: … | total: …"""
    lines = [f"ETH/UZH Mensa Menus — {date or TODAY}", "=" * 60, ""]
    for m in mensas:
        for slot in ("Lunch", "Dinner"):
            for d in m["meals"][slot]:
                segs = []
                p100 = format_nutrition(d.get("nutrition", {}).get("p100", {}))
                if p100:
                    segs.append(f"per100g: {p100}")
                total = format_nutrition(d.get("nutrition", {}).get("total", {}))
                if total:
                    segs.append(f"total: {total}")
                nutr_str = " | ".join(segs) if segs else "nutrition=N/A"
                # Collapse embedded whitespace/newlines (ETH descriptions
                # contain them) so index.txt stays one physical line per dish.
                body = " ".join(dish_body(d.get("line", ''), d["dish"], d.get("desc", '')).split())
                lines.append(f'{m["name"]}/{slot}: {body} | {nutr_str}')
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# Assemble output
# --------------------------------------------------------------------------

def main(allow_empty_today=False, closure_file=None):
    global TODAY, _sv_client
    TODAY = _current_date()
    _weekly_cache.clear()
    _sv_week_cache.clear()
    _sv_client = None
    with open(closure_file or os.path.join(BASE, 'closures.json'), encoding='utf-8') as f:
        closures = validate_closures(json.load(f))

    # Calendar data window: today + the next 14 calendar days. Weekends
    # and days without source data are included as empty-day entries so
    # the calendar can mark them unavailable; the frontend only enables
    # dates that actually carry data.
    today_dt = datetime.strptime(TODAY, "%Y-%m-%d").date()
    date_window = [TODAY] + [
        (today_dt + timedelta(days=i)).isoformat()
        for i in range(1, 15)
    ]

    days = {}
    for d in date_window:
        # ETH: one call returns all facilities for the date.
        # UZH: read each date's own ISO-week page and published detail URLs.
        days[d] = collect_day(d, closures=closures)
        validate_day(d, days[d])  # stop promptly on an observed source failure

    payload = {
        "date": TODAY,
        "days": days,
        "availableDates": sorted(d for d, day in days.items() if any(
            m["meals"]["Lunch"] or m["meals"]["Dinner"] for m in day["mensas"]
        )),
    }
    publish_site(payload, allow_empty_today=allow_empty_today)

    n = sum(len(m["meals"]["Lunch"]) + len(m["meals"]["Dinner"]) for m in days[TODAY]["mensas"])
    total = sum(
        len(mm["meals"]["Lunch"]) + len(mm["meals"]["Dinner"])
        for day in days.values() for mm in day["mensas"]
    )
    print(f"Done — {len(days[TODAY]['mensas'])} mensas today ({n} dishes); "
          f"{len(days)} dates, {total} dishes total")


def publish_site(payload, *, allow_empty_today=False):
    """Validate and stage every artifact before replacing any published file."""
    validate_payload(payload, allow_empty_today)
    today = payload['date']
    # Serialize in memory first: even an unexpected NaN must never truncate
    # the previous data file. All source/field validation already ran above.
    files = {'data.json': json.dumps(payload, ensure_ascii=False, indent=1, allow_nan=False),
             'index.txt': render_txt(payload['days'][today]['mensas'], today)}

    # Assemble static site from template/. Cache-busting version: git short
    # hash (falls back to a timestamp) — forces browsers to fetch fresh
    # style.css/app.js on every deploy instead of serving stale caches.
    try:
        rev = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip() or datetime.now().strftime("%Y%m%d%H%M")
    except Exception:
        rev = datetime.now().strftime("%Y%m%d%H%M")

    with open(os.path.join(TEMPLATE_DIR, "index.html")) as f:
        html = (f.read()
                .replace("DATE_PLACEHOLDER", today)
                .replace("VER_PLACEHOLDER", rev))
    files['index.html'] = html

    with open(os.path.join(TEMPLATE_DIR, "style.css")) as f:
        css = f.read()
    files['style.css'] = css

    with open(os.path.join(TEMPLATE_DIR, "app.js")) as f:
        files['app.js'] = f.read().replace("DATE_PLACEHOLDER", today).replace("VER_PLACEHOLDER", rev)
    for name in ('firebase-config.js', 'account-sync.mjs', 'nutrition.mjs', 'i18n.mjs'):
        with open(os.path.join(TEMPLATE_DIR, name), encoding='utf-8') as f:
            files[name] = f.read().replace('../zmittag-nutrition-core/', './nutrition-core/')
    # UI/nutrition message catalogs; scripts/verify-i18n-contract.py checks them.
    for name in sorted(os.listdir(os.path.join(TEMPLATE_DIR, 'i18n'))):
        if name.endswith('.json') and name != 'source.lock.json':
            with open(os.path.join(TEMPLATE_DIR, 'i18n', name), encoding='utf-8') as f:
                files['i18n/' + name] = f.read()
    for name in ('core.mjs', 'reference-data.mjs', 'hall.mjs'):
        with open(os.path.join(BASE, 'zmittag-nutrition-core', name)) as f:
            files['nutrition-core/' + name] = f.read()
    # Include the build revision on transitive ES module imports as well.
    for name in list(files):
        if name.endswith('.mjs'):
            files[name] = re.sub(r"(from\s+['\"])(\.[^'\"]+\.mjs)(['\"])",
                                 lambda m: m[1] + m[2] + '?v=' + rev + m[3], files[name])
    parent = os.path.dirname(os.path.abspath(OUTPUT_DIR))
    os.makedirs(parent, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.menu-build-', dir=parent) as staging:
        for name, contents in files.items():
            os.makedirs(os.path.dirname(os.path.join(staging, name)), exist_ok=True)
            with open(os.path.join(staging, name), 'w', encoding='utf-8') as f:
                f.write(contents)
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        # data.json is switched last; each replacement is atomic on this FS.
        for name in [name for name in files if name != 'data.json'] + ['data.json']:
            os.makedirs(os.path.dirname(os.path.join(OUTPUT_DIR, name)), exist_ok=True)
            os.replace(os.path.join(staging, name), os.path.join(OUTPUT_DIR, name))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-empty-today', action='store_true')
    parser.add_argument('--closures', help='verified dated source/calendar closure records')
    args = parser.parse_args()
    try:
        main(args.allow_empty_today, args.closures)
    except (SourceError, ValueError, OSError) as err:
        print(f'Build blocked: {err}', file=sys.stderr)
        raise SystemExit(1)
