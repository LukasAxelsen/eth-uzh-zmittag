#!/usr/bin/env python3
"""verify-i18n-contract.py — the translation contract (UI and nutrition text only).

English (template/i18n/en.json) is the source catalog. Every other language in
template/i18n.mjs is a complete, same-shaped copy of it. Menu data (mensa, dish
and line names, ingredients, prices, closure reasons, raw/AI text) is never
translated and never enters a catalog.

    python3 scripts/verify-i18n-contract.py               # check
    python3 scripts/verify-i18n-contract.py --update-lock # after re-translating

Release workflow: change English, run this script, translate the keys it
reports as missing/stale into every language (an AI pass is fine — the checks
below catch structural mistakes), then run --update-lock and commit the
catalogs together with the lock.
"""

import hashlib
import importlib.util
import json
import re
import subprocess
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "template"
CATALOGS = TEMPLATE / "i18n"
LOCK = CATALOGS / "source.lock.json"
SOURCE = "en"
# Product requirement: these languages must always ship.
REQUIRED = {"en", "de", "gsw", "fr", "it", "da", "zh-Hans", "zh-Hant", "ja", "la"}
# Proper names and build placeholders that the HTML may show untranslated.
HTML_LITERALS = {"© Aeneanicus", "GitHub", "Cookpit API", "Food2050", "DATE_PLACEHOLDER"}
# Capitalised words that are ordinary words rather than abbreviations.
NOT_ABBREVIATIONS = {"OK"}
TRANSLATED_ATTRS = ("aria-label", "title", "placeholder", "alt")
STATIC_ATTRS = ("aria-label", "title")  # what updateStaticText() applies
JS_FILES = ("app.js", "nutrition.mjs", "account-sync.mjs", "i18n.mjs")

FAILURES = []


def check(name, ok, detail=""):
    if ok:
        print(f"  ok  {name}")
    else:
        FAILURES.append(name)
        print(f" FAIL {name}")
        if detail:
            for line in str(detail).splitlines():
                print(f"        {line}")


def node_json(module, expression):
    """Evaluate a JSON-serialisable expression against an ES module."""
    script = ("import(process.argv[1]).then(m => process.stdout.write(JSON.stringify(" +
              expression + ")))")
    out = subprocess.run(["node", "--input-type=module", "-e", script, (TEMPLATE / module).as_uri()],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def digest_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def placeholders(text):
    return sorted(re.findall(r"\{(\w+)\}", text))


def digits(text):
    return Counter(re.findall(r"\d+", re.sub(r"\{\w+\}", "", text)))


def abbreviations(text):
    """Upper-case tokens (BLV, DGE/ÖGE, S3, NG246, DRIs -> DRI) that every language keeps."""
    found = set()
    for word in re.findall(r"[A-Za-zÄÖÜäöü0-9/&+-]+", text):
        stem = word[:-1] if word.endswith("s") and len(word) > 2 and word[:-1].upper() == word[:-1] else word
        if (len(stem) >= 2 and re.fullmatch(r"[A-ZÄÖÜ0-9/&+-]+", stem) and re.search(r"[A-ZÄÖÜ]", stem)
                and stem not in NOT_ABBREVIATIONS):
            found.add(stem)
    return found


def preview(value):
    return json.dumps(value, ensure_ascii=False)[:120]


# ---------------------------------------------------------------- languages
print("== A. language manifest (template/i18n.mjs) ==")
languages = node_json("i18n.mjs", "{source: m.SOURCE_LANGUAGE, languages: m.LANGUAGES, "
                                  "labels: m.LANGUAGES.map(m.languageLabel), codes: m.LANGUAGE_CODES}")
codes = [lang["code"] for lang in languages["languages"]]
check("source language is English", languages["source"] == SOURCE and SOURCE in codes)
check("language codes are unique", len(codes) == len(set(codes)), codes)
check("required languages ship", REQUIRED <= set(codes), sorted(REQUIRED - set(codes)))
names = [lang["name"] for lang in languages["languages"]]
check("picker is sorted by English name", names == sorted(names, key=str.casefold), names)
expected_labels = [lang["name"] if lang["name"] == lang["native"] else f"{lang['name']} · {lang['native']}"
                   for lang in languages["languages"]]
check("picker labels read 'English name · native name'", languages["labels"] == expected_labels,
      languages["labels"])
files = {path.stem for path in CATALOGS.glob("*.json") if path != LOCK}
check("one catalog file per language, no orphans", files == set(codes),
      f"missing: {sorted(set(codes) - files)} orphan: {sorted(files - set(codes))}")

# ---------------------------------------------------------------- catalogs
print("== B. catalogs are complete, same-shaped copies of English ==")
catalogs = {}
for code in codes:
    path = CATALOGS / f"{code}.json"
    try:
        catalogs[code] = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        check(f"{code}.json is valid UTF-8 JSON", False, err)
en = catalogs.get(SOURCE, {})
check("en.json is a flat object of strings / string lists",
      isinstance(en, dict) and all(isinstance(v, str) or (isinstance(v, list) and all(isinstance(x, str) for x in v))
                                   for v in en.values()))
for code, catalog in catalogs.items():
    if code == SOURCE:
        continue
    missing = [k for k in en if k not in catalog]
    extra = [k for k in catalog if k not in en]
    check(f"{code}: same keys as en", not missing and not extra,
          "\n".join([f"missing {k}: {preview(en[k])}" for k in missing] + [f"extra {k}" for k in extra]))
    check(f"{code}: same key order as en (diffs line up)", [k for k in catalog if k in en] == [k for k in en if k in catalog])
    problems = []
    for key, source in en.items():
        if key not in catalog:
            continue
        value = catalog[key]
        if isinstance(source, list):
            if not (isinstance(value, list) and len(value) == len(source) and all(isinstance(x, str) and x.strip() for x in value)):
                problems.append(f"{key}: needs {len(source)} non-empty strings")
            continue
        if not isinstance(value, str) or not value.strip():
            problems.append(f"{key}: empty or not a string")
            continue
        if placeholders(value) != placeholders(source):
            problems.append(f"{key}: placeholders {placeholders(value)} != {placeholders(source)}")
        if digits(value) != digits(source):
            problems.append(f"{key}: numbers {sorted(digits(value).elements())} != {sorted(digits(source).elements())}")
        lost = [a for a in abbreviations(source) if a not in value]
        if lost:
            problems.append(f"{key}: keep abbreviations {lost}")
        if "<" in value or ">" in value:
            problems.append(f"{key}: markup is rendered as text")
    check(f"{code}: placeholders, numbers and abbreviations match en", not problems, "\n".join(problems))

print("== C. source lock (English changes force re-translation) ==")
lock = json.loads(LOCK.read_text(encoding="utf-8")) if LOCK.exists() else {}
if "--update-lock" in sys.argv:
    LOCK.write_text(json.dumps({k: digest(v) for k, v in en.items()}, ensure_ascii=False, indent=1) + "\n",
                    encoding="utf-8")
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    print("  lock updated from en.json")
stale = [k for k in en if lock.get(k) != digest(en[k])]
check("every English key matches the lock (translations are current)", not stale and set(lock) == set(en),
      "\n".join([f"changed/new {k}: {preview(en[k])}" for k in stale] +
                [f"removed {k}" for k in set(lock) - set(en)] +
                ["Re-translate these keys in every language, then run --update-lock."]))

# ---------------------------------------------------------------- usage
print("== D. markup and code use the catalog (no hard-coded UI text) ==")
key_re = re.compile(r"^[a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$")
namespaces = {k.split(".")[0] for k in en}


class Markup(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

    def __init__(self):
        super().__init__()
        self.stack, self.keys, self.problems = [], set(), []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if self.stack and ("data-i18n" in self.stack[-1][1] or "data-i18n-default" in self.stack[-1][1]):
            self.problems.append(f"<{tag}> inside a data-i18n element (text-only leaves)")
        for name, value in attrs.items():
            if name.startswith("data-i18n"):
                self.keys.add(value)
                if value not in en:
                    self.problems.append(f'{name}="{value}" is not in en.json')
        for attr in TRANSLATED_ATTRS:
            value = attrs.get(attr)
            if not value:
                continue
            key = attrs.get(f"data-i18n-{attr}") or attrs.get(f"data-i18n-default-{attr}")
            if not key:
                self.problems.append(f'<{tag} {attr}="{value}"> needs data-i18n-{attr}')
            elif en.get(key) != value:
                self.problems.append(f'<{tag} {attr}="{value}"> differs from en "{key}" = {preview(en.get(key))}')
        for name in attrs:
            if name.startswith("data-i18n-") and not name.startswith("data-i18n-default"):
                if name[len("data-i18n-"):] not in STATIC_ATTRS:
                    self.problems.append(f"{name}: updateStaticText() only applies {STATIC_ATTRS}")
        if tag not in self.VOID:
            self.stack.append((tag, attrs, []))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.stack.pop()

    def handle_endtag(self, tag):
        while self.stack:
            open_tag, attrs, text = self.stack.pop()
            key = attrs.get("data-i18n") or attrs.get("data-i18n-default")
            content = " ".join("".join(text).split())
            if key and content and en.get(key) != content:
                self.problems.append(f'<{open_tag}> "{content}" differs from en "{key}" = {preview(en.get(key))}')
            if open_tag == tag:
                break

    def handle_data(self, data):
        if not self.stack or self.stack[-1][0] in ("script", "style", "title"):
            return
        self.stack[-1][2].append(data)
        text = " ".join(data.split())
        attrs = self.stack[-1][1]
        if (text and any(c.isalpha() for c in text) and "data-i18n" not in attrs
                and "data-i18n-default" not in attrs and text not in HTML_LITERALS):
            self.problems.append(f'untranslated text "{text}" in <{self.stack[-1][0]}>')


markup = Markup()
markup.feed((TEMPLATE / "index.html").read_text(encoding="utf-8"))
check("index.html: every visible text and label comes from en.json", not markup.problems, "\n".join(markup.problems))

sources = {name: (TEMPLATE / name).read_text(encoding="utf-8") for name in JS_FILES}
app = sources["app.js"]
literals = set()
unknown = []
for name, text in sources.items():
    for value in re.findall(r"['\"]([a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)['\"]", text):
        if key_re.match(value) and value.split(".")[0] in namespaces:
            literals.add(value)
            if value not in en:
                unknown.append(f"{name}: '{value}'")
calls = re.findall(r"\bt(?:List)?\(\s*'([^']+)'", app)
unknown += [f"app.js: t('{k}')" for k in calls if k not in en]
check("every key literal in code exists in en.json", not unknown, "\n".join(unknown))
built = re.findall(r"\bt(?:List)?\(\s*(?:`|'[^']*'\s*\+)", app)
check("no keys assembled by string concatenation in app.js (keys stay greppable)", not built, built)
generated = node_json("nutrition.mjs", "m.messageKeys()")
check("nutrition.mjs messageKeys() all exist in en.json", all(k in en for k in generated),
      [k for k in generated if k not in en])
dead = [k for k in en if k not in literals | markup.keys | set(generated)]
check("no unused keys in en.json", not dead, dead)

hardcoded = []
for name in ("app.js", "nutrition.mjs", "account-sync.mjs"):
    text = sources[name]
    hardcoded += [f"{name}: {m}" for m in re.findall(
        r"\.(?:textContent|title|placeholder|alt)\s*=\s*['\"`][^'\"`]*[A-Za-z]{2}[^'\"`]*['\"`]", text)
        if not re.search(r"=\s*['\"`]Zmittag\b", m)]  # brand + ISO date in the tab title
    hardcoded += [f"{name}: {m}" for m in re.findall(
        r"setAttribute\('(?:aria-label|aria-valuetext|title|placeholder)',\s*['\"`][^'\"`]*[A-Za-z]{2}", text)]
    for key, value in en.items():
        if isinstance(value, str) and " " in value.strip() and (f"'{value}'" in text or f"`{value}`" in text):
            hardcoded.append(f"{name}: '{value}' duplicates {key}")
check("no hard-coded UI strings in JS", not hardcoded, "\n".join(hardcoded))


def js_section(start, end):
    i = app.find(start)
    if i < 0:
        return ""
    j = app.find(end, i)
    return app[i:j if j >= 0 else len(app)]


raw = js_section("function dishRawLine", "function formatDate")
check("raw/AI text stays untranslated (byte-identical with index.txt)",
      bool(raw) and not re.search(r"\bt(?:List)?\(", raw))
data_fields = re.findall(r"\bt\(\s*(?:m\.name|m\.group|g\.name|d\.(?:dish|desc|line)|dish|desc|line|label|"
                         r"service\.reason|p\.label)\b", app)
check("menu data is never passed through t()", not data_fields, data_fields)
dish_key = js_section("function dishKey", "\n}\n")
check("dish keys never include the language (switching reuses dish nodes)",
      bool(dish_key) and "language" not in dish_key.lower())
handler = js_section("async function onLanguageChange", "\n}\n")
check("language change mutates state then renderAll (no second render path)",
      "prefs.language = code" in handler and "savePrefs();" in handler and "renderAll();" in handler)
render_all = js_section("function renderAll()", "\n}\n")
check("renderAll applies static text and the picker",
      "updateStaticText();" in render_all and "renderLanguageSelect();" in render_all)
check("<html lang> follows the shown language", "document.documentElement.lang = activeLanguage()" in app)

print("== E. preference sync and build ==")
rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
rule_codes = re.search(r"p\.language in \[([^\]]*)\]", rules)
check("firestore.rules accepts exactly the shipped languages",
      "'language'" in rules and bool(rule_codes) and
      re.findall(r"'([^']+)'", rule_codes.group(1)) == codes)
sync = sources["account-sync.mjs"]
check("account sync carries and validates language",
      "'language'" in sync and "LANGUAGE_CODES.includes(p.language)" in sync and "from './i18n.mjs'" in sync)
menu = (ROOT / "menu.py").read_text(encoding="utf-8")
check("menu.py publishes i18n.mjs and every catalog", "'i18n.mjs'" in menu and "'i18n/' + name" in menu)

# ---------------------------------------------------------------- CJK typography
print("== F. CJK typography (regional Han glyph forms, self-hosted heading serif) ==")
CSS = (TEMPLATE / "style.css").read_text(encoding="utf-8")
FONT_DIR = TEMPLATE / "fonts"
# Han code points are shared; glyph forms differ per standard. Every CJK-capable
# family is classified so a stack can never borrow another region's glyphs.
REGION_FONTS = {
    "SC": {"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC",
           "Noto Sans SC", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "Noto Serif SC", "SimSun",
           "Zmittag Heading SC"},
    "TC": {"PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", "Source Han Sans TC", "Noto Sans TC",
           "Songti TC", "Noto Serif CJK TC", "Source Han Serif TC", "Noto Serif TC", "PMingLiU",
           "Zmittag Heading TC"},
    "JP": {"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Meiryo", "Yu Gothic", "YuGothic", "Noto Sans CJK JP",
           "Source Han Sans JP", "Noto Sans JP", "Hiragino Mincho ProN", "Yu Mincho", "YuMincho",
           "Noto Serif CJK JP", "Source Han Serif JP", "Noto Serif JP", "Zmittag Heading JP"},
}
LATIN_FONTS = {"-apple-system", "BlinkMacSystemFont", "SF Pro Text", "Helvetica Neue", "Helvetica", "Arial",
               "ui-serif", "New York", "Georgia", "Times New Roman", "ui-monospace", "SF Mono", "SFMono-Regular",
               "Menlo", "Consolas", "sans-serif", "serif", "monospace"}
CJK_REGION = {"zh-Hans": "SC", "zh-Hant": "TC", "ja": "JP"}
TOKENS = ("--font", "--font-serif", "--font-mono")


def stacks(block):
    found = {}
    for token in TOKENS:
        m = re.search(re.escape(token) + r":\s*([^;]+);", block)
        if m:
            found[token] = [f.strip().strip('"') for f in m.group(1).replace("\n", " ").split(",")]
    return found


root_block = re.search(r":root\s*\{(.*?)\n\}", CSS, re.S).group(1)
base = stacks(root_block)
check("base stacks name no CJK fonts (non-CJK languages never force a region)",
      set(base) == set(TOKENS) and all(f in LATIN_FONTS for families in base.values() for f in families),
      {t: [f for f in fs if f not in LATIN_FONTS] for t, fs in base.items()})
check("no system-ui anywhere (on CJK Windows it is the system region's UI font)",
      "system-ui" not in re.sub(r"/\*.*?\*/", "", CSS, flags=re.S))
manifest_path = FONT_DIR / "heading-fonts.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"fonts": {}}
spec = importlib.util.spec_from_file_location("heading_fonts", ROOT / "scripts" / "build-heading-fonts.py")
heading_fonts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(heading_fonts)  # shares heading_characters() with the font build
for code in codes:
    region = CJK_REGION.get(code) or (code.startswith(("zh", "ja")) and "?")
    if not region:
        continue
    block = re.search(r":lang\(" + re.escape(code) + r"\)\s*\{(.*?)\}", CSS, re.S)
    found = stacks(block.group(1)) if block else {}
    foreign = [f for families in found.values() for f in families
               if f not in LATIN_FONTS and f not in REGION_FONTS.get(region, set())]
    check(f"{code}: --font/--font-serif/--font-mono name only {region} fonts after the Latin ones",
          set(found) == set(TOKENS) and not foreign and
          all(any(f in REGION_FONTS[region] for f in families) for families in found.values()), foreign or found)
    entry = manifest["fonts"].get(code)
    font_file = FONT_DIR / entry["file"] if entry else None
    check(f"{code}: heading subset exists and matches its manifest",
          bool(font_file) and font_file.exists() and digest_file(font_file) == entry["sha256"],
          "run scripts/build-heading-fonts.py")
    if not entry:
        continue
    needed = heading_fonts.heading_characters(catalogs[code])
    missing = "".join(c for c in needed if c not in entry["characters"])
    check(f"{code}: subset covers every character the heading can show", not missing,
          f"missing {missing!r}: run scripts/build-heading-fonts.py")
    face = re.search(r"@font-face\s*\{[^}]*font-family:\s*\"" + re.escape(entry["family"]) + r"\"[^}]*\}", CSS)
    check(f"{code}: @font-face serves fonts/{entry['file']} at the heading weight, first in --font-serif",
          bool(face) and f'url("fonts/{entry["file"]}' in face.group(0) and
          f"font-weight: {manifest['weight']};" in face.group(0) and
          found.get("--font-serif", [None])[0] == entry["family"])
heading_rule = re.search(r"#date-heading\s*\{([^}]*)\}", CSS).group(1)
check("the heading uses the language's serif token at the subset weight",
      "font-family: var(--font-serif);" in heading_rule and f"font-weight: {manifest.get('weight')};" in heading_rule)
check("the licence ships with the fonts", (FONT_DIR / "OFL.txt").exists())
check("language options carry their own lang (native names keep their glyph forms)",
      "option.lang = code" in app and "option[lang] { font-family: var(--font); }" in CSS)
check("menu.py publishes the fonts and versions their URLs",
      "'fonts/' + name" in menu and "css.replace(\"VER_PLACEHOLDER\", rev)" in menu)

print()
if FAILURES:
    print(f"I18N CONTRACT VIOLATIONS ({len(FAILURES)}):")
    for f in FAILURES:
        print(f"  - {f}")
    sys.exit(1)
print(f"I18n contract intact — {len(codes)} languages × {len(en)} keys.")
