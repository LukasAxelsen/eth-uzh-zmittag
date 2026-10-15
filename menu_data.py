"""Shared publication boundary for the scraper and deployment guard."""
import json
import math
import re
from datetime import date, datetime
from zoneinfo import ZoneInfo
from urllib.parse import urlparse

MEAL_SLOTS = ('Lunch', 'Dinner')
SOURCE_NAMES = ('ETH', 'UZH')
HEALTHY_STATES = {'ok', 'confirmed_empty', 'not_published', 'confirmed_closed'}


def zurich_today():
    return datetime.now(ZoneInfo('Europe/Zurich')).date().isoformat()


def load_payload(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# Stable product roster, independent of whichever IDs a response happens to return.
EXPECTED_IDS = {f'eth-{n}' for n in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19, 20, 22, 23, 27, 28)} | {
    'uzh-untere-mensa', 'uzh-obere-mensa', 'uzh-lichthof', 'uzh-mensa',
    'uzh-green-kitchen', 'uzh-seerose', 'uzh-binzmuehle', 'uzh-cityport',
    'uzh-tierspital', 'uzh-botanischergarten',
}
NUTRIENTS = {'kcal', 'protein', 'fat', 'saturated', 'carbs', 'sugar', 'salt', 'fiber', 'weight'}


def validate_closure_evidence(service, path):
    evidence = service.get('evidence')
    if not isinstance(service.get('reason'), str) or not service['reason'].strip():
        raise ValueError(f'{path}.evidence: closure reason is required')
    if not isinstance(evidence, dict) or evidence.get('kind') not in ('source', 'calendar'):
        raise ValueError(f'{path}.evidence: source or calendar evidence is required')
    url = evidence.get('url')
    if not isinstance(url, str) or urlparse(url).scheme not in ('https', 'http') or not urlparse(url).netloc:
        raise ValueError(f'{path}.evidence.url: an official source URL is required')
    iso_date(evidence.get('confirmedOn'), path + '.evidence.confirmedOn')


def validate_closures(records):
    if not isinstance(records, list):
        raise ValueError('closures: expected an array of verified dated records')
    seen = set()
    for i, record in enumerate(records):
        path = f'closures[{i}]'
        if not isinstance(record, dict):
            raise ValueError(f'{path}: expected an object')
        iso_date(record.get('date'), path + '.date')
        if record.get('mensa') not in EXPECTED_IDS:
            raise ValueError(f'{path}.mensa: expected a stable roster id')
        key = (record['date'], record['mensa'])
        if key in seen:
            raise ValueError(f'{path}: duplicate closure for {key}')
        seen.add(key)
        validate_closure_evidence(record, path)
    return records


def iso_date(value, path):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError(f'{path}: expected ISO date YYYY-MM-DD, got {value!r}')
    try:
        return date.fromisoformat(value)
    except ValueError as err:
        raise ValueError(f'{path}: invalid ISO date {value!r}') from err


def finite_number(value, path):
    try:
        finite = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise ValueError(f'{path}: expected a finite number')
    if value < 0:
        raise ValueError(f'{path}: must not be negative')
    return value


def validate_dish(dish, path):
    if not isinstance(dish, dict) or not isinstance(dish.get('dish'), str) or not dish['dish'].strip():
        raise ValueError(f'{path}.dish: expected a non-empty dish name')
    for field in ('line', 'desc', 'photo'):
        if field in dish and not isinstance(dish[field], str):
            raise ValueError(f'{path}.{field}: expected a string')
    prices = dish.get('price', [])
    if not isinstance(prices, list):
        raise ValueError(f'{path}.price: expected an array')
    for i, price in enumerate(prices):
        pp = f'{path}.price[{i}]'
        if not isinstance(price, dict) or not isinstance(price.get('label'), str) or not price['label'].strip():
            raise ValueError(f'{pp}.label: expected a price label')
        finite_number(price.get('value'), pp + '.value')
    nutrition = dish.get('nutrition', {})
    if not isinstance(nutrition, dict) or set(nutrition) - {'p100', 'total'}:
        raise ValueError(f'{path}.nutrition: expected p100/total objects')
    for basis in ('p100', 'total'):
        values = nutrition.get(basis, {})
        np = f'{path}.nutrition.{basis}'
        if not isinstance(values, dict) or set(values) - NUTRIENTS:
            raise ValueError(f'{np}: invalid nutrition fields')
        for key, value in values.items():
            finite_number(value, np + '.' + key)
            if basis == 'p100' and (key == 'weight' or (key != 'kcal' and value > 100)):
                raise ValueError(f'{np}.{key}: invalid per-100g range')
        if basis == 'total' and 'weight' in values:
            for key, value in values.items():
                if key not in ('kcal', 'weight') and value > values['weight']:
                    raise ValueError(f'{np}.{key}: exceeds serving weight')


def validate_day(iso, day):
    if not isinstance(day, dict):
        raise ValueError(f'{iso}: expected a day object')
    mensas = day.get('mensas')
    if not isinstance(mensas, list) or len(mensas) != 32:
        raise ValueError(f'{iso}.mensas must contain 32 entries')
    ids, counts = set(), {source: 0 for source in SOURCE_NAMES}
    for index, mensa in enumerate(mensas):
        path = f'{iso}.mensas[{index}]'
        if not isinstance(mensa, dict) or not isinstance(mensa.get('id'), str):
            raise ValueError(f'{path}.id: expected a string')
        mid = mensa['id']
        path = f'{iso}.{mid}'
        if mid in ids:
            raise ValueError(f'{path}: duplicate id')
        if mid not in EXPECTED_IDS:
            raise ValueError(f'{path}: expected a stable roster id')
        ids.add(mid)
        for key in ('name', 'group'):
            if not isinstance(mensa.get(key), str) or not mensa[key].strip():
                raise ValueError(f'{path}.{key}: expected a non-empty string')
        meals = mensa.get('meals')
        if not isinstance(meals, dict) or set(meals) != set(MEAL_SLOTS):
            raise ValueError(f'{path}.meals: expected Lunch and Dinner')
        opening = mensa.get('opening')
        if not isinstance(opening, dict) or set(opening) != set(MEAL_SLOTS):
            raise ValueError(f'{path}.opening: expected Lunch and Dinner')
        for slot in MEAL_SLOTS:
            if opening[slot] is not None and not isinstance(opening[slot], str):
                raise ValueError(f'{path}.opening.{slot}: expected string or null')
            dishes = meals[slot]
            if not isinstance(dishes, list):
                raise ValueError(f'{path}.meals.{slot}: expected an array')
            for i, dish in enumerate(dishes):
                validate_dish(dish, f'{path}.meals.{slot}[{i}]')
            counts['ETH' if mid.startswith('eth-') else 'UZH'] += len(dishes)
    if ids != EXPECTED_IDS:
        raise ValueError(f'{iso}.mensas: stable roster ids are missing')
    sources = day.get('sources')
    if not isinstance(sources, dict) or set(sources) != set(SOURCE_NAMES):
        raise ValueError(f'{iso}.sources: ETH and UZH are required')
    for source, health in sources.items():
        path = f'{iso} {source}'
        if not isinstance(health, dict):
            raise ValueError(f'{path}: invalid source health')
        status = health.get('status')
        if status not in HEALTHY_STATES:
            issues = health.get('issues')
            issue = issues[0] if isinstance(issues, list) and issues and isinstance(issues[0], dict) else {}
            raise ValueError(f'{path} {status} stage={issue.get("stage", "health")}: {issue.get("message", "invalid source health")}')
        if health.get('issues') != []:
            raise ValueError(f'{path}.issues: healthy source must have no failures')
        if type(health.get('dishCount')) is not int or health['dishCount'] != counts[source]:
            raise ValueError(f'{path}.dishCount: does not match meals')
        if (status == 'ok') != (counts[source] > 0):
            raise ValueError(f'{path}.status: does not match meals')
        for mensa in mensas:
            if not mensa['id'].startswith(source.lower() + '-'):
                continue
            service = mensa.get('service')
            if not isinstance(service, dict) or service.get('status') not in HEALTHY_STATES:
                raise ValueError(f'{path}.{mensa["id"]}.service: missing or failed outlet status')
            if service['status'] == 'confirmed_closed':
                validate_closure_evidence(service, f'{path}.{mensa["id"]}.service')
            has_dishes = any(mensa['meals'].values())
            if (service['status'] == 'ok') != has_dishes:
                raise ValueError(f'{path}.{mensa["id"]}.service: does not match meals')
        source_mensas = [m for m in mensas if m['id'].startswith(source.lower() + '-')]
        states = {m['service']['status'] for m in source_mensas}
        expected = ('ok' if counts[source] else 'confirmed_closed' if states == {'confirmed_closed'} else
                    'not_published' if 'not_published' in states else 'confirmed_empty')
        if status != expected:
            raise ValueError(f'{path}.status: does not match outlet states ({expected})')
    return counts


def validate_payload(payload, allow_empty_today=False, *, expected_today=None):
    """Validate the entire window. Clock injection is only for offline tests."""
    if not isinstance(payload, dict):
        raise ValueError('root must be a JSON object')
    today = payload.get('date')
    today_date = iso_date(today, 'date')
    expected_today = expected_today or zurich_today()
    if today != expected_today:
        raise ValueError(f'date {today!r} must equal Europe/Zurich today {expected_today}')
    days = payload.get('days')
    if not isinstance(days, dict) or today not in days:
        raise ValueError(f'days: missing active day {today}')
    available = []
    for iso, day in days.items():
        iso_date(iso, 'days')
        counts = validate_day(iso, day)
        if sum(counts.values()):
            available.append(iso)
    if payload.get('availableDates') != sorted(available):
        raise ValueError('availableDates: must equal the sorted unique dates containing menus')
    day = days[today]
    count = sum(h['dishCount'] for h in day['sources'].values())
    if today_date.weekday() < 5:
        for source, health in day['sources'].items():
            if health['status'] == 'not_published':
                raise ValueError(f'{today} {source} not_published stage=coverage: no confirmed menu response for today')
        confirmed_closed = all(m['service']['status'] == 'confirmed_closed' for m in day['mensas'])
        if count == 0 and not confirmed_closed and not allow_empty_today:
            raise ValueError(f'{today} is a weekday but contains no dishes; confirmed closure evidence is required')
    return {'date': today, 'dateCount': len(days), 'mensaCount': len(day['mensas']),
            'dishCount': count, 'sources': day['sources']}
