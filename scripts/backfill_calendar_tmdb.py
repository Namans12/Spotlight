"""Report candidate TMDB matches for calendar rows without changing identities.

Title and date heuristics are not proof of identity. Review candidates against
independent sources before using them; --dry-run is accepted for compatibility.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

from lib_relations import (  # noqa: E402
    TmdbUnavailable,
    load_local_env,
    rate_limit_gap,
    titles_match,
    tmdb_get,
    years_match,
)

REQUEST_GAP_SECONDS = 0.15

# (media_type, tmdb_id) pairs confirmed BY HAND to be a different, unrelated
# production that merely shares a title string with a calendar row — a title
# collision the automated match can't see through, because the string really
# is identical (see verify_calendar_tmdb_links.py's docstring for the general
# shape of this: title-string matching plus a release-date check catches a
# rename, but not a same-titled decoy).
#
# This exists because the collision recurs on every re-run otherwise: a row
# manually unlinked after finding this (tmdb_id set back to NULL) becomes a
# fresh backfill candidate again, and nothing about the match itself changed —
# the same wrong id is still the best-scoring title match TMDB will offer, so
# without this list the very next nightly run relinks the exact same wrong
# title. Add an entry here, never delete a row over it.
KNOWN_WRONG_MATCHES: set[tuple[str, int]] = {
    # "Perfect Match" (our row, a Netflix dating show) -> TMDB's "Perfect
    # Match" (id 254821) is actually a Chinese Song Dynasty period drama.
    ("tv", 254821),
    # "Giant" (our row) -> TMDB's "Giant" (id 1669683) is an unrelated
    # Ukrainian short about the Molodist Film Festival.
    ("movie", 1669683),
}

# Title strings proven, more than once, to be too generic for title+year
# matching to trust at all — re-running backfill after excluding one bad id
# above just found a DIFFERENT wrong "Giant" (a Prince Naseem Hamed
# biopic) and a different wrong "Perfect Match" (a 2002 Channel 4 game
# show); both merely share a release year with our row, which years_match's
# tolerance treats as good enough. A title common enough to collide twice in
# a single genre-agnostic global search is common enough to collide a third
# time, so these are skipped before any TMDB call is even made — cheaper and
# safer than growing KNOWN_WRONG_MATCHES one decoy id at a time forever.
NEVER_AUTO_MATCH_TITLES: set[str] = {"giant", "perfect match"}


def is_too_generic_to_match(title: str) -> bool:
    return title.strip().casefold() in NEVER_AUTO_MATCH_TITLES

CANDIDATE_SQL = """
SELECT id, title, release_date, entry_type
  FROM calendar_entries
 WHERE tmdb_id IS NULL
 ORDER BY release_date
 LIMIT %s
"""

def expected_media_type(entry_type: str | None) -> str:
    """The CSV's own vocabulary is just Show / Movie."""
    return "tv" if (entry_type or "").strip().lower().startswith("show") else "movie"


SEASON_SUFFIX = re.compile(r"\s+season\s+\d+\s*$", re.IGNORECASE)


def title_variants(title: str, media_type: str) -> list[str]:
    """The editorial feed writes a season out ("Undekhi Season 3") where TMDB
    lists the series alone. Strip that suffix as a fallback — but only for TV
    searches, since on a film "Part II" style numbering is part of the real
    title and dropping it would match the wrong entry outright.

    A season's air date is the series' `first_air_date` only for season one, so
    the year check is skipped on the stripped variant; the exact title match is
    what keeps it honest.
    """
    variants = [title]
    if media_type == "tv":
        stripped = SEASON_SUFFIX.sub("", title).strip()
        if stripped and stripped != title:
            variants.append(stripped)
    return variants


def _days_from(target: date, iso_date: str) -> float:
    if not iso_date:
        return float("inf")
    try:
        return abs((datetime.strptime(iso_date, "%Y-%m-%d").date() - target).days)
    except ValueError:
        return float("inf")


def search(
    session: requests.Session,
    tmdb_key: str,
    media_type: str,
    title: str,
    release_date: date,
    is_primary: bool = True,
):
    """TMDB search, returning the best-matching result or None.

    TMDB titles are not unique: a generic word like "King" can name two
    unrelated 2026 releases at once, and TMDB's relevance ranking does not
    reliably put the intended one first — confirmed directly, where a
    17-minute short (popularity 1.6) outranked the real theatrical release
    (popularity 2.3) in search results, and taking the first exact-title hit
    silently linked the calendar to the wrong film.

    So every exact-title candidate within a year is collected, not just the
    first, and the one closest in days to the calendar's own release date
    wins — a signal TMDB's ranking doesn't have and we do.

    That collection only works if the right candidate is actually on the page
    fetched, though — and for a common word like "King", it often isn't: TMDB
    's plain-query search for "King" doesn't return the 2026-12-24 release on
    page 1 at all (confirmed directly), only the unrelated short film.

    So the primary variant is queried twice — once plain, once with
    `year`/`first_air_date_year` — and the results are merged. The year-scoped
    call is what surfaces "King"'s real match at all. But that same param is a
    hard, exact-year filter with no tolerance: confirmed directly, querying a
    legitimately-linked show with `first_air_date_year` set to the *calendar's*
    year (2026) returned zero results, because its real first_air_date is
    2025 — a normal regional/streaming delay, not a wrong link. Sending only
    the year-scoped query would have silently unlinked every title arriving in
    this calendar more than a few months after its original release. The plain
    query is what still finds those; local `years_match` (±1 year) is the only
    place tolerance is actually applied.
    """
    path = "/search/movie" if media_type == "movie" else "/search/tv"
    year = release_date.year if release_date else None
    year_param = "year" if media_type == "movie" else "first_air_date_year"

    for index, variant in enumerate(title_variants(title, media_type)):
        is_stripped = index > 0
        base_params = {"query": variant, "include_adult": "false"}

        payloads = [tmdb_get(session, path, tmdb_key, base_params)]
        # Skipped for the season-stripped fallback: that variant exists
        # precisely because the season's own air date is not the series'
        # first_air_date, so biasing the request toward `year` would defeat it.
        if not is_stripped and year is not None:
            payloads.append(tmdb_get(session, path, tmdb_key, {**base_params, year_param: year}))

        by_id = {}
        for payload in payloads:
            for result in (payload or {}).get("results", []):
                if (media_type, result["id"]) in KNOWN_WRONG_MATCHES:
                    continue
                by_id[result["id"]] = result

        candidates = []
        for result in by_id.values():
            candidate_title = result.get("title") or result.get("name") or ""
            if not titles_match(variant, candidate_title):
                continue
            candidate_date = result.get("release_date") or result.get("first_air_date") or ""
            if not is_stripped and not years_match(year, candidate_date):
                continue
            candidates.append((result, candidate_date))

        # A renewed TV show's first_air_date can be years — sometimes decades
        # — before whatever season this calendar row represents, so an empty
        # year-tolerant result here is not evidence the show is missing from
        # TMDB. It is evidence the year check is the wrong tool for TV.
        #
        # Found in production, 10 rows deep: Sugar, Big Brother, King of the
        # Hill, The Chosen and others were all linked to an unrelated MOVIE
        # that happened to satisfy the year check, because this function
        # returned None for the correct TV search and the caller's fallback
        # tried the other media type next. Getting the media type right
        # matters more than getting the date close, so for TV the year
        # restriction is dropped and retried — title match is still required —
        # before this variant gives up.
        #
        # Tiebreak among the fallback candidates is by popularity, not date:
        # date is exactly the signal we just gave up trusting, so reusing it
        # here just relocates the same failure. Confirmed directly — sorting
        # this branch by date picked an obscure US "Trying" (popularity 0.66)
        # over the real Apple TV+ show (30.57), and an obscure regional "Big
        # Brother" format over the CBS original, purely because each decoy's
        # air date happened to land a few days closer to the target year.
        # Every genuine match found in production had popularity several
        # times higher than any same-titled decoy; that gap is the reliable
        # part once the calendar date itself no longer disambiguates.
        #
        # `is_primary` guards this: found in production, "Mirzapur" — an
        # entry_type='Movie' row, so the caller's `order` tries "movie" first,
        # "tv" second as a fallback — had no movie match, fell into this exact
        # branch on the SECONDARY "tv" attempt, and the highest-popularity
        # title match was the wildly popular original Mirzapur TV series: a
        # completely different, unrelated production from the "Mirzapur: The
        # Movie" this row actually meant. Popularity alone disambiguates a
        # decoy from the real match when TV is what the source data already
        # said this was (Sugar, Big Brother — the case above); it does not
        # disambiguate "any TV show with this title" from "the movie this row
        # actually is" when TV is only being tried because the expected type
        # failed. So the rescue fires only on the primary attempt; on a
        # fallback attempt this row is left unmatched instead of guessing.
        if not candidates and media_type == "tv" and not is_stripped and is_primary:
            fallback = [
                result
                for result in by_id.values()
                if titles_match(variant, result.get("title") or result.get("name") or "")
            ]
            if fallback:
                fallback.sort(key=lambda r: -(r.get("popularity") or 0))
                return fallback[0]
            continue

        if not candidates:
            continue
        if len(candidates) > 1:
            candidates.sort(key=lambda c: _days_from(release_date, c[1]))
        return candidates[0][0]
    return None


def main() -> int:
    load_local_env(ROOT)

    parser = argparse.ArgumentParser(description="Link calendar_entries rows to TMDB.")
    parser.add_argument("--limit", type=int, default=1000, help="Max unresolved rows to attempt (default 1000).")
    parser.add_argument("--dry-run", action="store_true", help="Compatibility option; reporting is always read-only.")
    args = parser.parse_args()

    dsn = os.getenv("DATABASE_URL")
    tmdb_key = os.getenv("TMDB_API_KEY")
    if not dsn:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1
    if not tmdb_key:
        print("TMDB_API_KEY is not set", file=sys.stderr)
        return 1

    session = requests.Session()
    matched = 0
    unmatched = 0
    unavailable = 0

    with psycopg.connect(dsn, options='-c default_transaction_read_only=on') as conn:
        with conn.cursor() as cur:
            cur.execute(CANDIDATE_SQL, (args.limit,))
            rows = cur.fetchall()
            print(f"{len(rows)} calendar rows still missing a TMDB id\n")

            for row_id, title, release_date, entry_type in rows:
                if is_too_generic_to_match(title):
                    print(f"  no confident match: {title!r} (skipped — too generic to match safely)")
                    unmatched += 1
                    continue
                year = release_date.year if release_date else None
                primary = expected_media_type(entry_type)
                # Try the type the CSV implies, then the other: the editorial
                # feed labels limited series as films often enough to matter.
                order = [primary, "tv" if primary == "movie" else "movie"]

                result = None
                found_type = None
                try:
                    for media_type in order:
                        result = search(
                            session, tmdb_key, media_type, title, release_date,
                            is_primary=(media_type == primary),
                        )
                        rate_limit_gap(REQUEST_GAP_SECONDS)
                        if result is not None:
                            found_type = media_type
                            break
                except TmdbUnavailable as err:
                    print(f"  UNAVAILABLE {title!r}: {err} — re-run to pick it up")
                    unavailable += 1
                    continue

                if result is None:
                    print(f"  no confident match: {title!r} ({year or '?'}, {primary})")
                    unmatched += 1
                    continue

                matched += 1
                print(f"  REVIEW id={row_id} {title!r} -> possible {found_type}:{result['id']}")

    print(f"\n{matched} possible matches for review, {unmatched} without a candidate, {unavailable} unreachable; no rows changed")
    if unavailable:
        print("Re-run to retry the unreachable ones — nothing about them was judged bad.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
