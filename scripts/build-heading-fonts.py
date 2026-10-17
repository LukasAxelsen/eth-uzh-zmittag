#!/usr/bin/env python3
"""build-heading-fonts.py — self-hosted CJK serif subsets for the date heading.

The Chinese and Japanese date heading draws from a tiny, fixed character set
(digits, 月/日, the weekday names). Subsets of Noto Serif SC / TC / JP give
every platform the same serif with the correct regional glyph forms
(Simplified: GB, Traditional: Taiwan, Japanese: JIS), served from this site:
no third-party font service, which mainland China could not reach anyway.

    pip install fonttools brotli
    python3 scripts/build-heading-fonts.py

Run it whenever a CJK catalog's date.* text changes; verify-i18n-contract.py
fails until the subsets cover every character the heading can show.
"""

import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "template" / "fonts"
MANIFEST = FONTS / "heading-fonts.json"
CACHE = Path.home() / ".cache" / "zmittag-fonts"
REPOSITORY = "google/fonts"
COMMIT = "47d54ca1ebb14fd864695f1d39dc734f39017c33"
WEIGHT = 600  # #date-heading font-weight; one static instance, never synthesized
SOURCES = {
    "zh-Hans": ("Zmittag Heading SC", "heading-sc.woff2", "ofl/notoserifsc/NotoSerifSC[wght].ttf",
                "050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9"),
    "zh-Hant": ("Zmittag Heading TC", "heading-tc.woff2", "ofl/notoseriftc/NotoSerifTC[wght].ttf",
                "0077e18f57c6908f4a000969880940bdb0dad057c0e8d98b49dc364c3d1b09c6"),
    "ja": ("Zmittag Heading JP", "heading-jp.woff2", "ofl/notoserifjp/NotoSerifJP[wght].ttf",
           "2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc"),
}
LICENSE = "ofl/notoserifsc/OFL.txt"


def heading_characters(catalog):
    """Every character the localized date heading can display."""
    text = (re.sub(r"\{\w+\}", "", catalog["date.heading"]) + "".join(catalog["date.weekdays"]) +
            "".join(catalog["date.monthsInDate"]) + "0123456789")
    return "".join(sorted(set(text)))


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def fetch(path, expected=None):
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / (COMMIT[:12] + "-" + Path(path).name)
    if not cached.exists():
        url = f"https://github.com/{REPOSITORY}/raw/{COMMIT}/" + urllib.request.quote(path)
        print(f"  download {url}")
        cached.write_bytes(urllib.request.urlopen(url, timeout=120).read())
    data = cached.read_bytes()
    if expected and sha256(data) != expected:
        sys.exit(f"{path}: sha256 {sha256(data)} != pinned {expected}")
    return cached


def main():
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    FONTS.mkdir(parents=True, exist_ok=True)
    manifest = {"repository": REPOSITORY, "commit": COMMIT, "license": "OFL-1.1 (OFL.txt)",
                "weight": WEIGHT, "fonts": {}}
    for code, (family, name, path, digest) in SOURCES.items():
        catalog = json.loads((ROOT / "template" / "i18n" / f"{code}.json").read_text(encoding="utf-8"))
        characters = heading_characters(catalog)
        font = instantiateVariableFont(TTFont(fetch(path, digest), recalcTimestamp=False), {"wght": WEIGHT},
                                       updateFontNames=True)
        if font["OS/2"].usWeightClass != WEIGHT:
            sys.exit(f"{path}: instance weight {font['OS/2'].usWeightClass} != {WEIGHT}")
        missing = [c for c in characters if c != " " and ord(c) not in font.getBestCmap()]
        if missing:
            sys.exit(f"{path} lacks {''.join(missing)}")
        options = subset.Options()
        options.flavor = "woff2"
        options.hinting = False
        options.desubroutinize = True
        subsetter = subset.Subsetter(options)
        subsetter.populate(text=characters)
        subsetter.subset(font)
        font.flavor = "woff2"
        font.recalcTimestamp = False
        out = FONTS / name
        font.save(out)
        manifest["fonts"][code] = {"family": family, "file": name, "source": path, "sourceSha256": digest,
                                   "sha256": sha256(out.read_bytes()), "characters": characters}
        print(f"  {code}: {name} {out.stat().st_size} bytes, {len(characters)} characters")
    (FONTS / "OFL.txt").write_bytes(fetch(LICENSE).read_bytes())
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {MANIFEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
