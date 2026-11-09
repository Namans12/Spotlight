"""Report possible calendar overlaps without merging or deleting records.

A shared title ID and date do not prove that region, release kind or season
match. This diagnostic is intentionally read-only, including without --dry-run.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

from lib_relations import load_local_env  # noqa: E402

REQUEST_GAP_SECONDS = 0.2
TMDB_ATTEMPTS = 4


def tmdb_request(session: requests.Session, tmdb_key: str, path: str, params: dict) -> dict | None:
    for attempt in range(TMDB_ATTEMPTS):
        try:
            resp = session.get(
                f"https://api.themoviedb.org/3{path}",
                params={**params, "api_key": tmdb_key},
                timeout=25,
            )
            if resp.status_code == 200:
                return resp.json()
        except requests.RequestException:
            pass
        time.sleep(0.6 * (2**attempt))
    return None


def canonical_title(session, tmdb_key, tmdb_id: int, media_type: str) -> str | None:
    path = f"/movie/{tmdb_id}" if media_type == "movie" else f"/tv/{tmdb_id}"
    data = tmdb_request(session, tmdb_key, path, {})
    if not data:
        return None
    return data.get("title") or data.get("name")


def title_search_confirms(session, tmdb_key, title: str, media_type: str, expected_id: int) -> bool:
    """Does searching TMDB for this row's own exact title turn up the shared id?

    This is the corroboration test — real evidence the row's own title, not
    just its stored tmdb_id, points at the same production.
    """
    path = "/search/movie" if media_type == "movie" else "/search/tv"
    data = tmdb_request(session, tmdb_key, path, {"query": title, "include_adult": "false"})
    ids = {r.get("id") for r in (data or {}).get("results", [])}
    return expected_id in ids


def is_placeholder_title(title: str) -> bool:
    """A pre-announcement working title ("Untitled Venky - Anil Ravipudi
    Film") is never itself a searchable TMDB entry, so it always fails
    title_search_confirms even when it IS the same production as the keeper
    row, later renamed — unlike a genuinely distinct film (e.g. "Raghu In
    Leela", which is a real title that simply doesn't share a TMDB record with
    whatever it got wrongly linked to). The industry convention this matches
    ("Untitled <name> Film/Project") is specific enough that a false positive
    — two unrelated films sharing one tmdb_id+date where one is coincidentally
    also an "Untitled ..." placeholder — is not a realistic failure mode.
    """
    return title.strip().casefold().startswith("untitled")


def find_groups(cur) -> list[tuple[int, str, str, list[dict]]]:
    cur.execute(
        """
        SELECT tmdb_id, media_type, release_date::text
        FROM calendar_entries
        WHERE tmdb_id IS NOT NULL
        GROUP BY tmdb_id, media_type, release_date
        HAVING count(*) > 1
        """
    )
    keys = cur.fetchall()
    groups = []
    for tmdb_id, media_type, release_date in keys:
        cur.execute(
            """
            SELECT id, title, entry_type, platform_or_distributor, details, poster_url
            FROM calendar_entries
            WHERE tmdb_id = %s AND media_type = %s AND release_date = %s
            """,
            (tmdb_id, media_type, release_date),
        )
        cols = ["id", "title", "entry_type", "platform_or_distributor", "details", "poster_url"]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        groups.append((tmdb_id, media_type, release_date, rows))
    return groups


def main() -> int:
    """Report possible overlaps without deleting or unlinking observations.

    Matching a title ID and day is not enough to prove event identity (region,
    release kind and season can differ). Review candidates separately.
    """
    load_local_env(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Accepted for compatibility; reporting is always read-only.")
    parser.parse_args()
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL must be set", file=sys.stderr)
        return 1
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            groups = find_groups(cur)
    print(f"{len(groups)} possible title/date overlaps; no rows changed")
    for tmdb_id, media_type, release_date, rows in groups:
        print(f"  REVIEW {media_type}:{tmdb_id} ({release_date}): "
              f"{[row['title'] for row in rows]!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
