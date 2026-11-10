"""Report possible title, date and language inconsistencies without modifying rows.

A title mismatch or a shared global date cannot establish that an editorial
record is a wrong match or a rename. The report is read-only even without
--dry-run; review conflicting sources before changing identity or evidence.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

from lib_relations import load_local_env, titles_match  # noqa: E402

SEASON_SUFFIX = re.compile(r"\s+season\s+\d+\s*$", re.IGNORECASE)
TMDB_ATTEMPTS = 4

# tmdb_id -> the correct language, for records where TMDB's own data is known
# BY HAND to be wrong. This script otherwise treats `original_language` as
# ground truth (see the module docstring), which is right for the other ~40
# disagreements it found in one pass — but "Judaa" (tmdb_id 1649723) is a thin
# TMDB stub whose only overview text is "Directed by Simerjit SIngh" and whose
# original_language is 'en'; district.in's own dedicated coverage names the
# same director for a Punjabi film. Without this override, this script's own
# automated pass overwrites a hand-corrected language back to TMDB's wrong
# value on every re-run — found happening in production the first time this
# ran after the manual fix.
LANGUAGE_OVERRIDES: dict[int, str] = {
    1649723: "pa",  # Judaa
}


def tmdb_request(session: requests.Session, tmdb_key: str, path: str) -> dict | None:
    for attempt in range(TMDB_ATTEMPTS):
        try:
            resp = session.get(f"https://api.themoviedb.org/3{path}", params={"api_key": tmdb_key}, timeout=20)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 404:
                return None
        except requests.RequestException:
            pass
        time.sleep(0.6 * (2**attempt))
    return None


def title_matches(stored_title: str, tmdb_title: str, media_type: str) -> bool:
    if titles_match(stored_title, tmdb_title):
        return True
    if media_type == "tv":
        stripped = SEASON_SUFFIX.sub("", stored_title).strip()
        if stripped != stored_title and titles_match(stripped, tmdb_title):
            return True
    return False


def dates_agree(stored: object, tmdb_date: str | None) -> bool:
    """Exact-day agreement only — this is corroboration for a title that
    already failed to match, not a fuzzy release-date tolerance check like
    `years_match`. A near-miss here is exactly as uninformative as the title
    mismatch it's meant to explain away."""
    return bool(stored and tmdb_date) and str(stored) == tmdb_date


def main() -> int:
    load_local_env(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Accepted for compatibility; reporting is always read-only.")
    parser.add_argument("--limit", type=int, default=None, help="Check at most this many linked rows.")
    args = parser.parse_args()

    dsn = os.getenv("DATABASE_URL")
    tmdb_key = os.getenv("TMDB_API_KEY")
    if not dsn or not tmdb_key:
        print("DATABASE_URL and TMDB_API_KEY must both be set", file=sys.stderr)
        return 1

    session = requests.Session()
    unlinked = relanguaged = retitled = checked = unreachable = 0

    with psycopg.connect(dsn, options='-c default_transaction_read_only=on') as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, title, language, tmdb_id, media_type, release_date::text
                FROM calendar_entries
                WHERE tmdb_id IS NOT NULL AND media_type IS NOT NULL
                ORDER BY id
                """
                + (f" LIMIT {int(args.limit)}" if args.limit else "")
            )
            rows = cur.fetchall()
        print(f"{len(rows)} linked rows to verify\n")

        for id_, title, language, tmdb_id, media_type, release_date in rows:
            path = f"/movie/{tmdb_id}" if media_type == "movie" else f"/tv/{tmdb_id}"
            data = tmdb_request(session, tmdb_key, path)
            checked += 1
            if not data:
                unreachable += 1
                continue

            tmdb_title = data.get("title") or data.get("name") or ""
            tmdb_lang = LANGUAGE_OVERRIDES.get(tmdb_id, data.get("original_language"))
            tmdb_date = data.get("release_date") or data.get("first_air_date")

            if not title_matches(title, tmdb_title, media_type):
                if dates_agree(release_date, tmdb_date):
                    # Same production, renamed on TMDB since we linked it —
                    # refresh our text to match, the link itself is fine.
                    print(f"  REVIEW title/date match id={id_} {title!r} vs {tmdb_title!r} (tmdb_id={tmdb_id})")
                    retitled += 1
                else:
                    print(f"  REVIEW title/date mismatch id={id_} {title!r} vs {tmdb_title!r} (tmdb_id={tmdb_id})")
                    unlinked += 1
                continue

            if tmdb_lang and language and tmdb_lang != language:
                print(f"  REVIEW language id={id_} {title!r}: {language!r} vs {tmdb_lang!r}")
                relanguaged += 1

            if checked % 200 == 0:
                print(f"  ...{checked}/{len(rows)} checked", file=sys.stderr)

    print(
        f"\nchecked {checked} ({unreachable} unreachable) — "
        f"review: {unlinked} title/date mismatches, {retitled} possible renames, {relanguaged} language differences; no rows changed"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
