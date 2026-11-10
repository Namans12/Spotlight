"""Legacy District parser, retained for tests and historical data provenance.

Automated District collection is disabled in scheduled workflows: District's
terms restrict scraping. Do not run this collector without authorization.

sync_calendar_tmdb.py's theatrical coverage is licensed and reliable, but it is
bounded by what TMDB records: a spot-check of one Friday found 8 of 16 films
playing in Hyderabad cinemas were absent from TMDB entirely, or present with no
release date at all (Ameer Log: on TMDB, status "Released", zero release-date
records). No query change fixes that — the data simply isn't there. This script
covers the gap with district.in (Zomato's ticketing platform), whose per-city
"upcoming movies" pages embed a fully structured, dated, per-language film list
in the page's Next.js payload — no HTML-scraping fragility, just JSON.

Every district.in release is treated as India's own date — these are Indian
cinema listings, not a foreign film's home-market date — so origin_region and
origin_release_date are never set by this script; see
sync_calendar_tmdb.py's theatrical_window() for the "US: 13 Aug" case.

Deliberately single-source for now: a second source with its own spelling of
"Khatarnaak Safar: Hard Ride" would create a near-duplicate row rather than an
update, since calendar_entries' uniqueness is on the exact title string. Adding
Siasat or Wikipedia as a second source needs fuzzy title matching first.

    python scripts/sync_theatrical_district.py --dry-run
    python scripts/sync_theatrical_district.py --cities hyderabad,mumbai
    python scripts/sync_theatrical_district.py
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

from lib_py.event_identity import source_record_key
from lib_relations import load_local_env  # noqa: E402

BASE_URL = "https://www.district.in/movies/upcoming-movies-in-{city}"
REQUEST_TIMEOUT_SECONDS = 25
REQUEST_GAP_SECONDS = 0.5

# Cities chosen for regional-language coverage, not population: each is the
# primary market for at least one language TMDB under-serves. Add a city here
# to add its region's cinema to the calendar; slugs are district.in's own
# (Bengaluru, not "bangalore" — confirmed by fetch, not guessed).
DEFAULT_CITIES = (
    "hyderabad",   # Telugu
    "chennai",     # Tamil
    "bengaluru",   # Kannada
    "mumbai",      # Hindi, Marathi
    "delhi-ncr",   # Hindi
    "kochi",       # Malayalam
    "kolkata",     # Bengali
)

# district.in's own language names -> the ISO 639-1 codes calendar_entries
# stores post-migration-0009. Names not in this map are skipped rather than
# guessed at, per print_skip below.
LANGUAGE_TO_ISO = {
    "hindi": "hi", "english": "en", "tamil": "ta", "telugu": "te",
    "kannada": "kn", "malayalam": "ml", "punjabi": "pa", "bengali": "bn",
    "marathi": "mr", "gujarati": "gu", "odia": "or", "assamese": "as",
    "japanese": "ja", "urdu": "ur", "bhojpuri": "bho", "tulu": "tcy",
}

UPSERT_SQL = """
INSERT INTO calendar_entries
    (release_date, title, language, entry_type, is_theatrical,
     platform_or_distributor, details, source, source_url, origin,
     media_type, poster_url, source_key)
VALUES (%(release_date)s, %(title)s, %(language)s, 'Movie', true,
        NULL, %(details)s, 'district.in', %(source_url)s, 'district_in',
        'movie', %(poster_url)s, %(source_key)s)
ON CONFLICT (origin, source_key) DO UPDATE SET
    -- Enrich only, same convention as sync_calendar_tmdb.py: never clobber a
    -- value another source already supplied.
    language   = COALESCE(calendar_entries.language, EXCLUDED.language),
    poster_url = COALESCE(calendar_entries.poster_url, EXCLUDED.poster_url),
    details    = COALESCE(calendar_entries.details, EXCLUDED.details),
    source_url = COALESCE(calendar_entries.source_url, EXCLUDED.source_url)
RETURNING (xmax = 0) AS inserted
"""


def fetch_page(session: requests.Session, city: str) -> str | None:
    url = BASE_URL.format(city=city)
    try:
        resp = session.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (OTT-Radar; +https://github.com/)"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        print(f"  {city}: request failed — {exc}", file=sys.stderr)
        return None
    if resp.status_code != 200:
        print(f"  {city}: HTTP {resp.status_code}", file=sys.stderr)
        return None
    return resp.text


def parse_next_data(html: str) -> dict[str, Any] | None:
    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def item_list_urls(html: str) -> dict[str, str]:
    """movie_id -> canonical district.in URL, from the page's JSON-LD ItemList.

    The typed movie records inside __NEXT_DATA__ carry no URL field of their
    own; the separate schema.org <script type="application/ld+json"> block
    does, keyed by the "MV<id>" suffix on each URL — a different block in the
    same HTML response, not something derivable from __NEXT_DATA__ itself.
    """
    out: dict[str, str] = {}
    for m in re.finditer(r'"item":\{"@type":"Movie","url":"(https://[^"]+-MV(\d+))"', html):
        out[m.group(2)] = m.group(1)
    return out


def extract_movies(next_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Every {movie_id, name, ...} record found anywhere in the Next.js payload.

    The payload nests these several rails deep and the exact path has already
    changed once between page variants, so this walks the whole tree rather
    than indexing a fixed path — the fragile part of scraping a page we don't
    control is kept to "does this record shape still exist", not "is it still
    at props.pageProps.data.serverState.EDS....rails[3].items[7]".
    """
    found: list[dict[str, Any]] = []
    seen_ids: set[tuple[str, str]] = set()

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if "movie_id" in node and "name" in node:
                identity = (str(node["movie_id"]), str(node.get("release_date")))
                if identity not in seen_ids:
                    seen_ids.add(identity)
                    found.append(node)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(next_data)
    return found


def parse_release_date(epoch_seconds: Any) -> str | None:
    try:
        return datetime.fromtimestamp(int(epoch_seconds), tz=timezone.utc).date().isoformat()
    except (TypeError, ValueError, OSError):
        return None


def primary_language(record: dict[str, Any]) -> str | None:
    """The first listed variant, mapped to its ISO code.

    Roughly a third of district.in's records list several languages (a film
    dubbed into multiple markets) — district.in orders the original first in
    every sample checked, but that ordering isn't documented, so a
    multi-language record is a heuristic, not a guarantee.
    """
    variants = record.get("movie_variants") or []
    if not variants:
        return None
    name = (variants[0].get("language") or "").strip().lower()
    return LANGUAGE_TO_ISO.get(name)


def build_row(record: dict[str, Any], url: str | None) -> dict[str, Any] | None:
    release_date = parse_release_date(record.get("release_date"))
    if not release_date:
        return None
    title = (record.get("name") or "").strip()
    if not title:
        return None
    return {
        "release_date": release_date,
        "title": title,
        "language": primary_language(record),
        "details": (record.get("reason_to_watch") or "").strip() or None,
        # None rather than a guessed URL when the ItemList didn't cover this
        # record — a wrong link is worse than no link.
        "source_url": url,
        "poster_url": record.get("image") or None,
    }


def collect(session: requests.Session, cities: list[str]) -> list[dict[str, Any]]:
    """Retain each distinct source movie and date across cities."""
    by_id: dict[tuple[str, str], dict[str, Any]] = {}
    for i, city in enumerate(cities):
        if i:
            time.sleep(REQUEST_GAP_SECONDS)
        html = fetch_page(session, city)
        if html is None:
            continue
        next_data = parse_next_data(html)
        if next_data is None:
            print(f"  {city}: __NEXT_DATA__ not found — page layout may have changed", file=sys.stderr)
            continue
        records = extract_movies(next_data)
        urls = item_list_urls(html)
        new = 0
        for record in records:
            mid = record["movie_id"]
            row = build_row(record, urls.get(mid))
            if row:
                key = (str(mid), row["release_date"])
                if key in by_id:
                    continue
                row["source_key"] = source_record_key(*key)
                by_id[key] = row
                new += 1
        print(f"  {city}: {len(records)} listed, {new} new")
    return list(by_id.values())


def main() -> int:
    load_local_env(ROOT)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cities", default=",".join(DEFAULT_CITIES), help="Comma-separated district.in city slugs."
    )
    parser.add_argument(
        "--horizon-days", type=int, default=180,
        help="Drop rows dated more than this many days out (default 180) — district.in "
        "lists some films over a year ahead with placeholder dates that later move.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Report what would be written; write nothing.")
    args = parser.parse_args()

    dsn = os.getenv("DATABASE_URL")
    if not dsn and not args.dry_run:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1

    cities = [c.strip() for c in args.cities.split(",") if c.strip()]
    cutoff = (date.today() + timedelta(days=args.horizon_days)).isoformat()

    session = requests.Session()
    rows = collect(session, cities)
    in_horizon = [r for r in rows if r["release_date"] <= cutoff]
    no_language = sum(1 for r in in_horizon if not r["language"])
    print(
        f"\n{len(rows)} distinct films found, {len(in_horizon)} within {args.horizon_days} days "
        f"({no_language} with an unmapped language — see LANGUAGE_TO_ISO)"
    )

    if args.dry_run:
        for row in sorted(in_horizon, key=lambda r: r["release_date"])[:30]:
            print(f"  {row['release_date']}  {row['language'] or '??':4}  {row['title']}")
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
