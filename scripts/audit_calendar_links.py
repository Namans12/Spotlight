"""Audit every calendar_entries row already linked to TMDB, looking for a
silent mismatch — a row pointing at the wrong film or show.

Written after finding exactly this in production: a CSV row titled "King"
(Red Chillies Entertainment, releasing 2026-12-24) had been linked to
tmdb_id 1669639 — a 17-minute short also titled "King", releasing five
months off, on 2026-07-26. The root cause (backfill_calendar_tmdb.py never
sent `year` as an actual search parameter, and took the first exact-title
match rather than the best one) is fixed, but that fix only prevents new
mismatches — it does nothing for rows already linked before the fix existed.

Covers both ways a row gets a tmdb_id:

  - origin='csv_seed'      linked after the fact by backfill_calendar_tmdb.py,
                           via a title *search* — the step that could pick the
                           wrong same-titled result (the King bug).
  - origin='tmdb_upcoming' written directly by sync_calendar_tmdb.py from one
                           /discover result object — title, id, and date all
                           come from the same object, so there is no search
                           step to get ambiguous. A MISMATCH found here is a
                           more surprising, different-shaped bug (e.g. the
                           TMDB id was later merged into another record) than
                           a MISMATCH found in a csv_seed row, and is worth
                           reading closely rather than pattern-matching to
                           the King fix.

This runs in two stages either way, because a big date gap alone is not proof
of a wrong link:

  1. Compare each linked row's own release_date against what TMDB reports for
     the tmdb_id it was linked to. Anything beyond `--threshold-days` (default
     45, generous on purpose) becomes a *suspect* — same signature the King
     bug had, a ~5-month gap.

  2. Every suspect is re-run through the fixed matcher (same title, same
     calendar date) as a second opinion. A season-renewal row ("Undekhi
     Season 3") will always show a huge gap against its series' first
     air date — that is expected, not a bug — and the matcher confirms it by
     independently landing on the exact same id. Only a row where the matcher
     now disagrees is reported as a MISMATCH, which is the actual King-shaped
     signal: the old (unfixed) search picked one title, the fixed one picks
     another.

Always read-only: a title/date match is a candidate for review, not proof.

    python scripts/audit_calendar_links.py
    python scripts/audit_calendar_links.py --threshold-days 60 --limit 100
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

from lib_relations import TmdbUnavailable, load_local_env, rate_limit_gap, tmdb_get  # noqa: E402
from backfill_calendar_tmdb import search  # noqa: E402

REQUEST_GAP_SECONDS = 0.12
DEFAULT_THRESHOLD_DAYS = 45

CANDIDATE_SQL = """
SELECT id, title, release_date, media_type, tmdb_id, origin
FROM calendar_entries
WHERE origin IN ('csv_seed', 'tmdb_upcoming') AND tmdb_id IS NOT NULL
ORDER BY id
LIMIT %s
"""


def main() -> int:
    load_local_env(ROOT)

    parser = argparse.ArgumentParser(description="Find calendar rows linked to the wrong TMDB title.")
    parser.add_argument("--limit", type=int, default=2000, help="Max linked rows to check (default 2000).")
    parser.add_argument(
        "--threshold-days",
        type=int,
        default=DEFAULT_THRESHOLD_DAYS,
        help=f"Flag rows whose TMDB date differs by more than this many days (default {DEFAULT_THRESHOLD_DAYS}).",
    )
    args = parser.parse_args()

    dsn = os.getenv("DATABASE_URL")
    tmdb_key = os.getenv("TMDB_API_KEY")
    if not dsn:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1
    if not tmdb_key:
        print("TMDB_API_KEY is not set", file=sys.stderr)
        return 1

    with psycopg.connect(dsn, options='-c default_transaction_read_only=on') as conn:
        with conn.cursor() as cur:
            cur.execute(CANDIDATE_SQL, (args.limit,))
            rows = cur.fetchall()

    by_origin = {}
    for row in rows:
        by_origin[row[5]] = by_origin.get(row[5], 0) + 1
    origin_breakdown = ", ".join(f"{count} {origin}" for origin, count in sorted(by_origin.items()))
    print(f"{len(rows)} rows already linked ({origin_breakdown}) — checking each against TMDB's real date\n")

    session = requests.Session()
    suspects = []
    checked = 0
    unavailable = 0

    for row_id, title, release_date, media_type, tmdb_id, origin in rows:
        path = f"/movie/{tmdb_id}" if media_type == "movie" else f"/tv/{tmdb_id}"
        try:
            payload = tmdb_get(session, path, tmdb_key, {})
        except TmdbUnavailable as err:
            unavailable += 1
            print(f"  UNAVAILABLE id={row_id} {title!r}: {err}")
            continue
        checked += 1
        rate_limit_gap(REQUEST_GAP_SECONDS)

        real_date_str = (payload or {}).get("release_date") or (payload or {}).get("first_air_date") or ""
        real_title = (payload or {}).get("title") or (payload or {}).get("name") or ""
        if not real_date_str:
            continue
        try:
            real_date = datetime.strptime(real_date_str, "%Y-%m-%d").date()
        except ValueError:
            continue

        diff_days = abs((real_date - release_date).days)
        if diff_days > args.threshold_days:
            suspects.append((row_id, title, release_date, real_title, real_date, diff_days, tmdb_id, media_type, origin))

    print(f"\nchecked {checked}, {unavailable} unreachable (skipped, not flagged — a network failure is not evidence of a bad link)")
    print(f"\n{len(suspects)} suspect row(s) by date-diff alone. A big gap is not proof of a wrong link on its own —")
    print("a renewed show's season air date is expected to differ from its series' first_air_date, and some")
    print("titles are legitimately linked but reach this calendar on a delayed regional/streaming date.")
    print(
        "So each suspect is re-run through the fixed matcher (same title, same calendar date) as a second "
        "opinion: if it independently lands on the SAME id, the existing link is corroborated, not contradicted."
    )

    confirmed_ok = []
    mismatches = []
    unclear = []

    for row_id, title, cal_date, real_title, real_date, diff, tmdb_id, media_type, origin in sorted(suspects, key=lambda s: -s[5]):
        try:
            rematch = search(session, tmdb_key, media_type, title, cal_date)
        except TmdbUnavailable as err:
            unclear.append((row_id, title, cal_date, tmdb_id, media_type, origin, real_title, real_date, diff, f"unreachable: {err}"))
            continue
        rate_limit_gap(REQUEST_GAP_SECONDS)

        if rematch is None:
            unclear.append((row_id, title, cal_date, tmdb_id, media_type, origin, real_title, real_date, diff, "matcher found no confident candidate at all"))
        elif rematch["id"] == tmdb_id:
            confirmed_ok.append((row_id, title, cal_date, tmdb_id, media_type, origin, real_title, real_date, diff))
        else:
            rematch_title = rematch.get("title") or rematch.get("name") or "?"
            mismatches.append((row_id, title, cal_date, tmdb_id, media_type, origin, real_title, real_date, diff, rematch["id"], rematch_title, rematch.get("release_date") or rematch.get("first_air_date")))

    print(f"\n=== {len(confirmed_ok)} candidates where matcher agrees; identity and event still require review ===")
    for row_id, title, cal_date, tmdb_id, media_type, origin, real_title, real_date, diff in confirmed_ok:
        print(f"  id={row_id:5} [{origin}]  {title!r} ({cal_date}) == {media_type}:{tmdb_id} {real_title!r} ({real_date})  diff={diff}d  [OK, no action]")

    print(f"\n=== {len(mismatches)} MISMATCH: matcher would now pick a different title; review both identities ===")
    for row_id, title, cal_date, tmdb_id, media_type, origin, real_title, real_date, diff, new_id, new_title, new_date in mismatches:
        flag = "  <-- surprising for tmdb_upcoming (no search step at creation — look closely)" if origin == "tmdb_upcoming" else ""
        print(f"  id={row_id:5}  calendar: {title!r} ({cal_date})  [{media_type}, {origin}]{flag}")
        print(f"           currently linked -> tmdb_id={tmdb_id} {real_title!r} ({real_date})  diff={diff}d")
        print(f"           matcher now picks -> tmdb_id={new_id} {new_title!r} ({new_date})")

    print(f"\n=== {len(unclear)} unclear: could not get a second opinion ===")
    for row_id, title, cal_date, tmdb_id, media_type, origin, real_title, real_date, diff, reason in unclear:
        print(f"  id={row_id:5} [{origin}]  {title!r} ({cal_date})  ->  {tmdb_id} {real_title!r}  diff={diff}d  ({reason})")

    print("\nCandidates require independent review; no rows changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
