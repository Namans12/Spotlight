"""Fill in regional theatrical releases TMDB under-serves — same job as
sync_theatrical_district.py, sourced from Wikipedia instead.

district.in is IP-blocked from GitHub Actions runners: confirmed by testing
every header variant (default UA, full browser headers, a cookie warm-up)
from a real workflow_dispatch run — even the plain homepage 403s. That's
Akamai denying GitHub's hosted-runner ranges outright, not a fingerprint
check a header tweak can get past. Wikipedia isn't adversarial to scraping
the same way and isn't blocked.

Coverage is narrower than district.in's, and that gap is disclosed rather
than silently dropped: Wikipedia maintains a dedicated per-year "List of
<language> films of <year>" page only for languages with enough editors —
Telugu, Tamil, Kannada, Malayalam and Hindi have one; Punjabi does not
(404) and Bengali's redirects to an un-tabled list page. district.in's
Kolkata (Bengali) and Punjabi coverage has no replacement here.

These per-language lists mix theatrical and straight-to-OTT titles in the
same table with no column marking which is which. A row whose production
company names a known streaming platform is skipped outright rather than
guessed at — see OTT_PRODUCTION_MARKERS — since wrongly marking a
streaming-only release as theatrical is a worse error than missing a
theatrical one.

    python scripts/sync_theatrical_wikipedia.py --dry-run
    python scripts/sync_theatrical_wikipedia.py --languages te,ta
    python scripts/sync_theatrical_wikipedia.py
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

from lib_relations import load_local_env  # noqa: E402

REQUEST_TIMEOUT_SECONDS = 25
REQUEST_GAP_SECONDS = 0.5

# Wikipedia's bot policy (https://w.wiki/4wJS) asks for a UA identifying the
# tool and where to find it — a bare default UA gets a 403 with a message
# pointing at that policy (confirmed by testing).
USER_AGENT = "Mozilla/5.0 (OTT-Radar; +https://github.com/Namans12/Spotlight)"

# Wikipedia's own name for each language's per-year list page. Only
# languages with a maintained "List of X films of YYYY" page are listed —
# see module docstring for the ones that don't have one.
LANGUAGE_PAGE_NAMES = {
    "te": "Telugu",
    "ta": "Tamil",
    "kn": "Kannada",
    "ml": "Malayalam",
    "hi": "Hindi",
}

MONTHS = {
    "JANUARY": 1, "FEBRUARY": 2, "MARCH": 3, "APRIL": 4, "MAY": 5, "JUNE": 6,
    "JULY": 7, "AUGUST": 8, "SEPTEMBER": 9, "OCTOBER": 10, "NOVEMBER": 11, "DECEMBER": 12,
}

# Checked against the Production company / Studio cell (lowercased). A film
# co-produced with one of these almost always means a straight-to-streaming
# release, not a cinema one — see module docstring for why these rows are
# dropped rather than kept and marked theatrical.
OTT_PRODUCTION_MARKERS = (
    "netflix", "amazon prime", "prime video", "hotstar", "sonyliv", "sony liv",
    "zee5", "aha video", "mx player", "hoichoi", "sun nxt", "manorama max",
    "eros now", "erosnow", "youtube", "jiocinema", "jio cinema",
    "lionsgate play", "chaupal",
)

UPSERT_SQL = """
INSERT INTO calendar_entries
    (release_date, title, language, entry_type, is_theatrical,
     platform_or_distributor, details, source, source_url, origin,
     media_type, poster_url)
VALUES (%(release_date)s, %(title)s, %(language)s, 'Movie', true,
        NULL, NULL, 'wikipedia', %(source_url)s, 'wikipedia',
        'movie', NULL)
ON CONFLICT (release_date, title, entry_type) DO UPDATE SET
    -- Enrich only, same convention as sync_theatrical_district.py: never
    -- clobber a value another source already supplied.
    language   = COALESCE(calendar_entries.language, EXCLUDED.language),
    source_url = COALESCE(calendar_entries.source_url, EXCLUDED.source_url)
RETURNING (xmax = 0) AS inserted
"""


def fetch_page(session: requests.Session, slug: str) -> str | None:
    url = f"https://en.wikipedia.org/wiki/{slug}"
    try:
        resp = session.get(url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        print(f"  {slug}: request failed — {exc}", file=sys.stderr)
        return None
    if resp.status_code != 200:
        print(f"  {slug}: HTTP {resp.status_code}", file=sys.stderr)
        return None
    return resp.text


def release_tables(soup: BeautifulSoup) -> list[Any]:
    """Every wikitable whose header row starts with "Opening" — the
    month+day release-schedule tables, as opposed to a page's "highest
    grossing" or legend tables, which share the wikitable class but not
    this header shape."""
    out = []
    for table in soup.find_all("table", class_="wikitable"):
        header_row = table.find("tr")
        if header_row is None:
            continue
        first_th = header_row.find("th")
        if first_th and "opening" in first_th.get_text(strip=True).lower():
            out.append(table)
    return out


def parse_table(table: Any, source_url: str) -> list[dict[str, Any]]:
    """Walk a release-schedule table's rows, carrying the month/day forward
    across the rowspan cells that mark a new month or day only once per
    group. Row shape is positional (Title, Director, Cast, Production,
    Ref) rather than matched by header text — verified identical across
    every language's page bar minor header-label wording differences."""
    rows: list[dict[str, Any]] = []
    month_num: int | None = None
    day_num: int | None = None

    for tr in table.find_all("tr")[1:]:
        cells = tr.find_all("td")
        if not cells:
            continue
        # 7 cells: this row opens a new month (and day); 6: a new day within
        # the same month; 5: another title on the same day as the row above.
        leading = len(cells) - 5
        if leading not in (0, 1, 2):
            continue
        if leading == 2:
            month_num = MONTHS.get(cells[0].get_text(strip=True).upper())
            cells = cells[1:]
        if leading >= 1:
            day_text = cells[0].get_text(strip=True)
            day_num = int(day_text) if day_text.isdigit() else None
            cells = cells[1:]
        if month_num is None or day_num is None or len(cells) < 4:
            continue

        title = cells[0].get_text(strip=True)
        production = cells[3].get_text(strip=True)
        if not title:
            continue
        if any(marker in production.lower() for marker in OTT_PRODUCTION_MARKERS):
            continue

        try:
            release_date = date(_table_year(table), month_num, day_num).isoformat()
        except ValueError:
            continue

        rows.append({"title": title, "release_date": release_date, "source_url": source_url})
    return rows


def _table_year(table: Any) -> int:
    """The year is carried on the page, not the table — set by the caller
    via an attribute rather than threaded through every function."""
    return table._sync_wikipedia_year  # type: ignore[attr-defined]


def collect(session: requests.Session, languages: list[str], years: list[int]) -> list[dict[str, Any]]:
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for lang in languages:
        name = LANGUAGE_PAGE_NAMES.get(lang)
        if not name:
            print(f"  {lang}: no Wikipedia per-year film list for this language, skipping", file=sys.stderr)
            continue
        new_for_lang = 0
        for year in years:
            slug = f"List_of_{name}_films_of_{year}"
            time.sleep(REQUEST_GAP_SECONDS)
            html = fetch_page(session, slug)
            if html is None:
                continue
            soup = BeautifulSoup(html, "html.parser")
            source_url = f"https://en.wikipedia.org/wiki/{slug}"
            for table in release_tables(soup):
                table._sync_wikipedia_year = year  # type: ignore[attr-defined]
                for row in parse_table(table, source_url):
                    key = (row["title"].lower(), row["release_date"])
                    if key in by_key:
                        continue
                    row["language"] = lang
                    by_key[key] = row
                    new_for_lang += 1
        print(f"  {lang} ({name}): {new_for_lang} distinct films found")
    return list(by_key.values())


def main() -> int:
    load_local_env(ROOT)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--languages", default=",".join(LANGUAGE_PAGE_NAMES), help="Comma-separated ISO language codes."
    )
    parser.add_argument(
        "--horizon-days", type=int, default=180,
        help="Drop rows dated more than this many days out (default 180), matching sync_theatrical_district.py.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Report what would be written; write nothing.")
    args = parser.parse_args()

    dsn = os.getenv("DATABASE_URL")
    if not dsn and not args.dry_run:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1

    languages = [c.strip() for c in args.languages.split(",") if c.strip()]
    today = date.today()
    cutoff = (today + timedelta(days=args.horizon_days)).isoformat()
    years = sorted({today.year, (today + timedelta(days=args.horizon_days)).year})

    session = requests.Session()
    rows = collect(session, languages, years)
    in_horizon = [r for r in rows if today.isoformat() <= r["release_date"] <= cutoff]
    print(f"\n{len(rows)} distinct films found, {len(in_horizon)} within {args.horizon_days} days")

    if args.dry_run:
        for row in sorted(in_horizon, key=lambda r: r["release_date"])[:30]:
            print(f"  {row['release_date']}  {row['language']:4}  {row['title']}")
        return 0

    inserted = updated = 0
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            for row in in_horizon:
                cur.execute(UPSERT_SQL, row)
                result = cur.fetchone()
                if result and result[0]:
                    inserted += 1
                else:
                    updated += 1
        conn.commit()

    print(f"{inserted} new calendar rows, {updated} existing rows enriched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
