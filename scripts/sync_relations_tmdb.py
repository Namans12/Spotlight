"""Must Watch generator, source A: TMDB collection chains.

Discovers every TMDB collection referenced by the working set (watchlist +
release radar — see lib_relations.get_working_set), then writes the whole
chain for each: for parts sorted by release date, one 'must' edge per
*consecutive pair* (later --before--> earlier), with lib_relations.upsert_edge
adding the reciprocal (earlier --after--> later).

Consecutive pairs only, never origin-to-every-part: the direct-edge model
reconstructs full chains by traversal at read time (lib/relationsDb.ts), so
shortcut edges would make hop counts meaningless.

Chains are written for the entire collection rather than only the parts that
happen to sit in the working set. Anything less dead-ends the walk at the
working-set boundary, which is exactly the case the depth traversal exists to
serve ("show the full chain" from a title whose predecessors nobody has
saved).

Fan-out is structurally at most one edge per direction per title here, so the
shared 12-edge cap can never bind — it is enforced in the generators that can
actually drift (Wikidata, the offline seed).

TV has no TMDB collection concept, so this generator only covers movies;
sequences spanning a franchise's TV side are Wikidata's / the offline seed's
job.

Idempotent, upserts under the precedence rule (source='tmdb' outranks
everything but another 'tmdb' write). Safe to re-run.

    python scripts/sync_relations_tmdb.py
    python scripts/sync_relations_tmdb.py --limit 50 --dry-run
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
    plan_collection,
    sort_by_release,
)
from lib_relations import (  # noqa: E402
    Candidate,
    TmdbUnavailable,
    get_working_set,
    load_local_env,
    prepare_edge,
    rate_limit_gap,
    tmdb_get,
    upsert_edge,
)

REQUEST_GAP_SECONDS = 0.1
DEFAULT_LIMIT = 500

# Mirrors SIBLING_CONFIDENCE in lib/relationsDb.ts: above CAN_CONFIDENCE_FLOOR
# (0.5) so "same series" edges render, below MUST_CONFIDENCE_FLOOR (0.75) so
# nothing reading confidence alone can promote one into a prerequisite.
SIBLING_CONFIDENCE = 0.60

# How a collection is classified — one continuous story, several independent
# arcs, or an episodic anthology — lives in data/collection-shapes.json and is
# applied by scripts/lib_collection_shapes.py, which the request-path warm
# (lib/relationsDb.ts) reads too. Sharing that file is what stops a re-run of
# this generator from overwriting the runtime's correct answer with a naive
# chain, or the other way round.
#
# This replaced a local MULTI_ARC_COLLECTIONS dict keyed by *arc sizes*. Sizes
# cannot describe a collection like Insidious, where The Red Door continues
# Chapter 2 across two prequels released in between, so arcs are explicit id
# groups now. The reasoning for a hand-verified list over a gap-detection
# heuristic is unchanged and is restated in the JSON file's own $doc.


def fetch_movie_detail(session: requests.Session, tmdb_key: str, tmdb_id: int) -> dict | None:
    return tmdb_get(session, f"/movie/{tmdb_id}", tmdb_key)


def fetch_collection(session: requests.Session, tmdb_key: str, collection_id: int) -> dict | None:
    return tmdb_get(session, f"/collection/{collection_id}", tmdb_key)


def sorted_parts(collection: dict) -> list[dict]:
    """Release order. Undated parts sort last so they never slot in ahead of a
    dated one and invent a prerequisite that doesn't exist yet."""
    return sort_by_release([p for p in (collection.get("parts") or []) if p.get("id")])


def consecutive_pairs(parts: list[dict], collection_id: int) -> list[tuple[dict, dict]]:
    """Release-order (earlier, later) pairs to chain with a must-before edge,
    one per adjacent pair within each arc — never across an arc boundary, and
    never at all for a collection classified episodic."""
    return plan_collection(collection_id, parts).must


def part_to_candidate(part: dict) -> Candidate:
    return Candidate(
        "movie",
        part["id"],
        part.get("title") or "Untitled",
        part.get("poster_path"),
        part.get("release_date") or None,
        None,
        None,
    )


def main() -> int:
    load_local_env(ROOT)

    parser = argparse.ArgumentParser(description="Sync Must Watch edges from TMDB collections.")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help=f"Max working-set titles to scan (default {DEFAULT_LIMIT}).")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be written; write nothing.")
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
    edges_written = 0
    dropped = 0
    unavailable = 0
    counts = {"inserted": 0, "updated": 0, "skipped": 0}

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            working_set = get_working_set(cur, args.limit)
            movies = [(tid, title) for tid, media_type, title in working_set if media_type == "movie"]
            print(f"{len(movies)} movies in working set (of {len(working_set)} total titles)")

            # Pass 1: which collections does the working set touch? Deduped, so
            # a collection with three saved members costs one fetch, not three.
            collections: dict[int, str] = {}
            for tmdb_id, title in movies:
                try:
                    detail = fetch_movie_detail(session, tmdb_key, tmdb_id)
                except TmdbUnavailable as err:
                    print(f"  skipped {title}: TMDB unreachable ({err})")
                    unavailable += 1
                    continue
                rate_limit_gap(REQUEST_GAP_SECONDS)
                if not detail:
                    continue
                belongs = detail.get("belongs_to_collection")
                if belongs and belongs.get("id"):
                    collections[belongs["id"]] = belongs.get("name") or str(belongs["id"])

            print(f"{len(collections)} distinct collections referenced")

            # Pass 2: write each collection's chain end to end.
            for collection_id, collection_name in collections.items():
                try:
                    collection = fetch_collection(session, tmdb_key, collection_id)
                except TmdbUnavailable as err:
                    print(f"  skipped {collection_name}: TMDB unreachable ({err})")
                    unavailable += 1
                    continue
                rate_limit_gap(REQUEST_GAP_SECONDS)
                if not collection:
                    continue

                parts = sorted_parts(collection)
                if len(parts) < 2:
                    continue

                plan = plan_collection(collection_id, parts)
                for warning in plan.warnings:
                    print(f"    WARN {warning}")
                print(
                    f"  {collection_name}: {len(parts)} parts, classified {plan.classification} "
                    f"({len(plan.must)} must, {len(plan.can)} can)"
                )

                for earlier, later in plan.must:
                    candidate = prepare_edge("movie", later["id"], part_to_candidate(earlier), "before", None)
                    if candidate is None:
                        dropped += 1
                        print(f"    dropped: {later.get('title')} -> {earlier.get('title')} (self-edge/unreleased prerequisite)")
                        continue

                    label = f"{later.get('title')} --[before]--> {earlier.get('title')}"
                    if args.dry_run:
                        print(f"    would write must: {label}")
                        edges_written += 1
                        continue

                    status = upsert_edge(
                        cur,
                        "movie",
                        later["id"],
                        later.get("title") or "Untitled",
                        later.get("poster_path"),
                        later.get("release_date") or None,
                        "must",
                        "tmdb",
                        1.00,
                        candidate,
                    )
                    counts[status] += 1
                    if status != "skipped":
                        edges_written += 1
                        print(f"    {status} must: {label}")

                # Titles that belong to no chain — every part of an episodic
                # collection, a singleton arc, an excluded spin-off — are still
                # worth surfacing, just never as a prerequisite. Written at
                # SIBLING_CONFIDENCE so they render as Can Watch and can never
                # be mistaken for one (see MUST_CONFIDENCE_FLOOR).
                for source, target, reason in plan.can:
                    candidate = prepare_edge("movie", source["id"], part_to_candidate(target), None, reason)
                    if candidate is None:
                        dropped += 1
                        continue

                    label = f"{source.get('title')} --[can]--> {target.get('title')}"
                    if args.dry_run:
                        print(f"    would write can: {label}")
                        edges_written += 1
                        continue

                    status = upsert_edge(
                        cur,
                        "movie",
                        source["id"],
                        source.get("title") or "Untitled",
                        source.get("poster_path"),
                        source.get("release_date") or None,
                        "can",
                        "tmdb",
                        SIBLING_CONFIDENCE,
                        candidate,
                    )
                    counts[status] += 1
                    if status != "skipped":
                        edges_written += 1

        if not args.dry_run:
            conn.commit()

    if args.dry_run:
        print(f"would write {edges_written} edges (plus reciprocals), dropped {dropped}")
    else:
        print(
            f"{counts['inserted']} inserted, {counts['updated']} updated, "
            f"{counts['skipped']} skipped by precedence, {dropped} dropped "
            f"(each written edge also writes its reciprocal)"
        )
    if unavailable:
        print(f"{unavailable} lookup(s) failed because TMDB was unreachable — re-run to pick them up")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
