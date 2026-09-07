"""Find TMDB collections this deployment chains without a hand-verified entry.

data/collection-shapes.json is a curated list, so its usefulness decays: new
titles reach the site every week, and each one can pull in a collection nobody
has judged. An unjudged collection is chained end to end, which is right most
of the time and badly wrong for an anthology — the failure that put a 24-part
Netflix documentary series in this database as a prerequisite chain.

This is the tool that finds those before a user does. It walks the collections
the database actually touches, applies the same classifier the app uses, and
reports what falls through, ranked by how many titles each one affects.

Read-only. Touches no rows, writes nothing, and needs only DATABASE_URL and
TMDB_API_KEY.

    python scripts/audit_collection_shapes.py
    python scripts/audit_collection_shapes.py --limit 200 --min-parts 4
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

from lib_collection_shapes import (  # noqa: E402
    EPISODIC_PART_THRESHOLD,
    get_collection_shape,
    plan_collection,
)
from lib_relations import (  # noqa: E402
    TmdbUnavailable,
    load_local_env,
    rate_limit_gap,
    tmdb_get,
)

REQUEST_GAP_SECONDS = 0.1

# A two-part collection is a sequel; there is essentially no way for the chain
# rule to be wrong about it, so reviewing those is noise. Three or more is
# where anthologies start appearing.
DEFAULT_MIN_PARTS = 3


def movie_ids_in_use(cur, limit: int) -> list[int]:
    """Every movie this deployment has an opinion about — saved titles, the
    release radar, and anything a relation edge already points at."""
    cur.execute(
        """
        SELECT DISTINCT tmdb_id::bigint AS id FROM (
            SELECT tmdb_id, media_type FROM watchlist_items
            UNION
            SELECT tmdb_id, media_type FROM release_items
            UNION
            SELECT to_tmdb_id, to_media_type FROM title_relations
            UNION
            SELECT from_tmdb_id, from_media_type FROM title_relations
        ) AS t
        WHERE media_type = 'movie'
        ORDER BY id
        LIMIT %s
        """,
        (limit,),
    )
    return [row[0] for row in cur.fetchall()]


def main() -> int:
    load_local_env(ROOT)

    parser = argparse.ArgumentParser(description="Audit TMDB collection classifications.")
    parser.add_argument("--limit", type=int, default=1000, help="Max movie ids to scan (default 1000).")
    parser.add_argument(
        "--min-parts",
        type=int,
        default=DEFAULT_MIN_PARTS,
        help=f"Only report collections with at least this many parts (default {DEFAULT_MIN_PARTS}).",
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

    session = requests.Session()

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            ids = movie_ids_in_use(cur, args.limit)

    print(f"{len(ids)} distinct movie ids in use")

    collections: dict[int, str] = {}
    unavailable = 0
    for tmdb_id in ids:
        try:
            detail = tmdb_get(session, f"/movie/{tmdb_id}", tmdb_key)
        except TmdbUnavailable:
            unavailable += 1
            continue
        rate_limit_gap(REQUEST_GAP_SECONDS)
        belongs = (detail or {}).get("belongs_to_collection")
        if belongs and belongs.get("id"):
            collections[belongs["id"]] = belongs.get("name") or str(belongs["id"])

    print(f"{len(collections)} distinct collections referenced\n")

    unclassified: list[tuple[int, int, str, str]] = []
    classified: list[tuple[int, int, str, str]] = []

    for collection_id, name in collections.items():
        try:
            payload = tmdb_get(session, f"/collection/{collection_id}", tmdb_key)
        except TmdbUnavailable:
            unavailable += 1
            continue
        rate_limit_gap(REQUEST_GAP_SECONDS)
        if not payload:
            continue

        parts = [p for p in (payload.get("parts") or []) if p.get("id")]
        if len(parts) < args.min_parts:
            continue

        plan = plan_collection(collection_id, parts)
        row = (len(parts), collection_id, payload.get("name") or name, plan.classification)
        if get_collection_shape(collection_id) is None:
            unclassified.append(row)
        else:
            classified.append(row)

        for warning in plan.warnings:
            print(f"  WARN {warning}")

    unclassified.sort(reverse=True)
    classified.sort(reverse=True)

    print("\n=== NOT in data/collection-shapes.json — chained end to end ===")
    print("Review any of these that is an anthology, a reboot line, or carries a spin-off.\n")
    print(f"{'parts':>5}  {'id':>8}  classification  name")
    for n, cid, name, classification in unclassified:
        # Anything already flagged episodic here got there by the size
        # fallback, not by review — worth a curated entry either way.
        flag = "  <-- size fallback" if classification == "episodic" else ""
        print(f"{n:>5}  {cid:>8}  {classification:<14}  {name}{flag}")

    print(f"\n=== Already curated ({len(classified)}) ===")
    for n, cid, name, classification in classified:
        print(f"{n:>5}  {cid:>8}  {classification:<14}  {name}")

    print(
        f"\n{len(unclassified)} unreviewed collection(s) at >= {args.min_parts} parts. "
        f"Size fallback bites above {EPISODIC_PART_THRESHOLD} parts."
    )
    if unavailable:
        print(f"{unavailable} lookup(s) failed because TMDB was unreachable — re-run to pick them up")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
