"""Must Watch generator, source B: Wikidata narrative sequence.

Free SPARQL endpoint, no key, no auth. Resolves a TMDB id to a Wikidata entity
via P4947 (TMDB movie ID) / P4983 (TMDB TV series ID), then reads:

    P155  follows            -> must, direction='before'
    P156  followed by        -> must, direction='after'
    P179  part of the series -> context only, never an edge of its own

P179 identifies the series so P155/P156 can be sanity-checked against it. An
edge pointing outside the series is suspicious and is written at confidence
0.60 — below MUST_CONFIDENCE_FLOOR, so it lands in the table for inspection
without ever rendering.

Every related entity must round-trip back to a TMDB id via P4947/P4983.
Anything that doesn't is dropped; there is deliberately no title-search
fallback here, because Wikidata labels and TMDB titles disagree often enough
to produce confidently wrong matches.

    python scripts/sync_relations_wikidata.py --spot-check   # REQUIRED FIRST — see below
    python scripts/sync_relations_wikidata.py --dry-run
    python scripts/sync_relations_wikidata.py

=============================================================================
SPOT CHECK RESULT, 2026-08-16: THIS GENERATOR IS NOT SHIPPED. DO NOT RUN THE
SYNC WITHOUT REDOING THE CHECK AND READING THIS FIRST.
=============================================================================

`--spot-check` over 19 resolved titles returned 18 edges across 10 of them.
Three were wrong:

    Empire Strikes Back  -> before: The Star Wars Holiday Special
    Mad Max: Fury Road   -> before: Mad Max Beyond Thunderdome
    Mad Max: Fury Road   -> after:  Furiosa: A Mad Max Saga

The first two are brand sequence sold as narrative necessity. The third is
worse: Furiosa is a *prequel*, so encoding release order inverts the direction
outright — exactly the divergence this check exists to find. ~17% wrong, on a
feature where one bad "you must watch this first" costs more trust than ten
missing edges buy.

Three further findings, each independently disqualifying:

  1. The P179 sanity check does not work. Once duplicate rows are collapsed
     (see `collapse`), zero edges in the sample crossed a series boundary —
     including all three wrong ones. It cannot separate good from bad, so the
     0.60 confidence tier it was meant to feed never triggers.

  2. Coverage is thin and lands where it is least needed. Seven sample titles
     produced nothing at all, including every MCU entry — the shared universe
     the design doc singles out as the case users care most about. What it does
     return (Godfather, LOTR, Toy Story, John Wick, Star Wars) is almost
     entirely already covered by TMDB collections in Phase 1.

  3. Precedence makes its mistakes permanent. 'wikidata' outranks 'seed', so
     once a wrong edge is written the offline seed — the component the design
     doc names as the fallback carrier for cross-franchise continuity — can
     never correct it. Verified against the real upsert predicate. Writing at
     0.70 does not help: the row still exists and still blocks the seed, it
     just also never renders.

Per the design doc's own escape hatch ("If Phase 2's spot-check fails, skip it
entirely and go to Phase 3 ... Nothing downstream depends on Wikidata
shipping"), Phase 2 is skipped. The script is kept because `--spot-check` is
worth re-running if Wikidata's sequence data improves, and because the reasons
above should not have to be rediscovered.

THE SPOT CHECK GATES THIS GENERATOR.

P155/P156 on shared-universe films sometimes encodes *release* order rather
than *narrative necessity*, and those diverge — notably across the MCU, where
release order would name Black Panther as Infinity War's predecessor while the
film someone actually needs is Thor: Ragnarok. Chained at depth, release-order
edges manufacture a "required viewing" list that is really just a filmography.

`--spot-check` queries a fixed sample spanning tight sequels, a shared
universe, non-English franchises, and titles that should have no edge at all,
then prints what Wikidata claims for each so it can be judged by hand. Run it
before trusting this generator at scale. If contamination is common, pass
`--confidence 0.70` so every edge lands below the render floor and the offline
seed carries cross-franchise continuity instead.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

from lib_relations import (  # noqa: E402
    Candidate,
    TmdbUnavailable,
    cap_fanout,
    fetch_by_id,
    get_working_set,
    load_local_env,
    prepare_edge,
    rate_limit_gap,
    resolve_title_year,
    upsert_edge,
)

WDQS_ENDPOINT = "https://query.wikidata.org/sparql"
# WDQS requires a descriptive User-Agent identifying the client.
USER_AGENT = "Spotlight/0.1 (https://github.com/Namans12/Spotlight; title-relations sync) python-requests"
# WDQS asks for roughly one request per second from anonymous clients.
WDQS_GAP_SECONDS = 1.0
WDQS_TIMEOUT_SECONDS = 60
WDQS_ATTEMPTS = 3
# WDQS enforces a 60s query ceiling. A single UNION of P155/P156 with the label
# service and two OPTIONALs over 40 ids exceeds it, so the two directions are
# asked separately in small batches — twice the round trips, each far cheaper.
BATCH_SIZE = 15

DEFAULT_CONFIDENCE = 1.00
OUT_OF_SERIES_CONFIDENCE = 0.60

# Deliberately mixed: tight two-part stories where Wikidata should be exactly
# right, a shared universe where release order and narrative necessity diverge,
# non-English franchises, and titles whose "predecessor" is a reboot or a
# thematic sequel rather than a required watch.
SPOT_CHECK: list[tuple[str, str, int]] = [
    ("movie", "Dune", 2021),
    ("movie", "Dune: Part Two", 2024),
    ("movie", "Avengers: Infinity War", 2018),
    ("movie", "Avengers: Endgame", 2019),
    ("movie", "Captain America: Civil War", 2016),
    ("movie", "Thor: Ragnarok", 2017),
    ("movie", "Black Panther", 2018),
    ("movie", "The Godfather", 1972),
    ("movie", "The Godfather Part II", 1974),
    ("movie", "The Empire Strikes Back", 1980),
    ("movie", "Return of the Jedi", 1983),
    ("movie", "The Lord of the Rings: The Two Towers", 2002),
    ("movie", "The Lord of the Rings: The Return of the King", 2003),
    ("movie", "John Wick: Chapter 2", 2017),
    ("movie", "The Dark Knight", 2008),
    ("movie", "Baahubali 2: The Conclusion", 2017),
    ("movie", "Toy Story 3", 2010),
    ("movie", "Mad Max: Fury Road", 2015),
    ("movie", "Blade Runner 2049", 2017),
    ("movie", "Top Gun: Maverick", 2022),
]

QUERY_TEMPLATE = """
SELECT ?tmdbId ?otherTmdb ?otherLabel ?series ?otherSeries WHERE {
  VALUES ?tmdbId { %(values)s }
  ?item wdt:%(idProp)s ?tmdbId .
  ?item wdt:%(seqProp)s ?other .
  ?other wdt:%(idProp)s ?otherTmdb .
  OPTIONAL { ?item  wdt:P179 ?series }
  OPTIONAL { ?other wdt:P179 ?otherSeries }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
"""

# P155 "follows" means the other title comes first, so it is what you watch
# before. P156 "followed by" is the continuation.
SEQUENCE_PROPS = [("P155", "before"), ("P156", "after")]


class WikidataUnavailable(Exception):
    """WDQS gave no usable answer. Like TmdbUnavailable, this is explicitly not
    evidence that an edge is wrong — only that we could not ask."""


def run_query(
    session: requests.Session,
    media_type: str,
    seq_prop: str,
    tmdb_ids: list[int],
) -> list[dict[str, Any]]:
    """One batched SPARQL round trip for a single sequence property. Retries
    transient failures — WDQS times out under load often enough that one slow
    response is not a reason to lose a whole batch."""
    if not tmdb_ids:
        return []
    query = QUERY_TEMPLATE % {
        "values": " ".join(f'"{i}"' for i in tmdb_ids),
        "idProp": "P4947" if media_type == "movie" else "P4983",
        "seqProp": seq_prop,
    }

    last_error: Exception | str = "no attempt made"
    for attempt in range(WDQS_ATTEMPTS):
        try:
            response = session.get(
                WDQS_ENDPOINT,
                params={"query": query, "format": "json"},
                headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"},
                timeout=WDQS_TIMEOUT_SECONDS,
            )
        except requests.RequestException as err:
            last_error = err
        else:
            if response.status_code == 200:
                try:
                    return response.json().get("results", {}).get("bindings", [])
                except ValueError as err:
                    last_error = f"unparseable response: {err}"
            else:
                last_error = f"HTTP {response.status_code}: {response.text[:160]}"
        if attempt < WDQS_ATTEMPTS - 1:
            rate_limit_gap(WDQS_GAP_SECONDS * (2**attempt))

    raise WikidataUnavailable(str(last_error))


def _val(binding: dict[str, Any], key: str) -> str | None:
    entry = binding.get(key)
    return entry.get("value") if entry else None


class Edge:
    """One P155/P156 claim, already round-tripped to a TMDB id."""

    def __init__(self, binding: dict[str, Any], direction: str):
        self.from_tmdb_id = int(_val(binding, "tmdbId"))
        self.to_tmdb_id = int(_val(binding, "otherTmdb"))
        self.direction = direction
        self.to_label = _val(binding, "otherLabel") or "?"
        self.series: set[str] = set()
        self.other_series: set[str] = set()

    @property
    def in_series(self) -> bool:
        """True when the two ends share at least one P179 series.

        Membership *overlap* is the question, not equality: real films belong to
        several series at once (Empire Strikes Back is in the original trilogy,
        the Skywalker Saga, and Star Wars at large), so demanding a single
        matching value would flag obviously-correct edges as suspicious. When
        either side declares no series we cannot contradict the claim, so it
        passes — only genuine disagreement is treated as out-of-series.
        """
        if not self.series or not self.other_series:
            return True
        return bool(self.series & self.other_series)

    def confidence(self, base: float) -> float:
        return base if self.in_series else OUT_OF_SERIES_CONFIDENCE


def collapse(bindings: list[dict[str, Any]], direction: str) -> list[Edge]:
    """WDQS emits one row per (series, otherSeries) combination, so a title in
    three series pointing at one in two comes back six times. Collapse to a
    single edge per ordered pair, unioning both series sets."""
    grouped: dict[tuple[int, int], Edge] = {}
    for binding in bindings:
        edge = Edge(binding, direction)
        key = (edge.from_tmdb_id, edge.to_tmdb_id)
        existing = grouped.setdefault(key, edge)
        if series := _val(binding, "series"):
            existing.series.add(series)
        if other_series := _val(binding, "otherSeries"):
            existing.other_series.add(other_series)
    return list(grouped.values())


def spot_check(session: requests.Session, tmdb_session: requests.Session, tmdb_key: str) -> int:
    print("Resolving the spot-check sample against TMDB...\n")
    resolved: list[tuple[str, int, str]] = []
    for media_type, title, year in SPOT_CHECK:
        try:
            candidate = resolve_title_year(tmdb_session, tmdb_key, media_type, title, year)
        except TmdbUnavailable as err:
            print(f"  ! {title} ({year}): TMDB unreachable ({err})")
            continue
        if candidate is None:
            print(f"  ! {title} ({year}): no confident TMDB match, excluded from the sample")
            continue
        resolved.append((media_type, candidate.to_tmdb_id, candidate.to_title))

    print(f"\n{len(resolved)} of {len(SPOT_CHECK)} sample titles resolved. Querying Wikidata...\n")

    ids = [tmdb_id for _, tmdb_id, _ in resolved]
    edges: dict[int, list[Edge]] = {}
    for seq_prop, direction in SEQUENCE_PROPS:
        for start in range(0, len(ids), BATCH_SIZE):
            batch = ids[start : start + BATCH_SIZE]
            try:
                bindings = run_query(session, "movie", seq_prop, batch)
            except WikidataUnavailable as err:
                print(f"  ! {seq_prop} batch failed: {err}", file=sys.stderr)
                rate_limit_gap(WDQS_GAP_SECONDS)
                continue
            for edge in collapse(bindings, direction):
                edges.setdefault(edge.from_tmdb_id, []).append(edge)
            rate_limit_gap(WDQS_GAP_SECONDS)

    out_of_series = 0
    without_edges = 0
    print("=" * 78)
    for _, tmdb_id, name in resolved:
        found = edges.get(tmdb_id, [])
        if not found:
            without_edges += 1
            print(f"\n{name}\n    (no P155/P156 with a TMDB round-trip)")
            continue
        print(f"\n{name}")
        for edge in sorted(found, key=lambda e: e.direction or ""):
            flag = "" if edge.in_series else "   <-- OUT OF SERIES (would be written at 0.60)"
            if not edge.in_series:
                out_of_series += 1
            arrow = "watch before" if edge.direction == "before" else "comes after"
            print(f"    {arrow:>12}: {edge.to_label} (tmdb {edge.to_tmdb_id}){flag}")
    print("\n" + "=" * 78)

    total_edges = sum(len(v) for v in edges.values())
    print(
        f"\n{total_edges} edges across {len(edges)} titles; "
        f"{without_edges} sample titles produced none; {out_of_series} crossed a series boundary."
    )
    print(
        "\nJudge by hand before shipping this generator:\n"
        "  - Does each 'watch before' name the film the story actually requires,\n"
        "    or merely the previous release in a shared universe?\n"
        "  - Do reboots/soft sequels (Mad Max, Top Gun, Blade Runner) claim a\n"
        "    prerequisite that is really just an earlier film in the brand?\n"
        "\nIf release-order contamination is common, run the real sync with\n"
        "--confidence 0.70 so nothing renders, and let the offline seed carry\n"
        "cross-franchise continuity instead."
    )
    return 0


def sync(
    session: requests.Session,
    tmdb_session: requests.Session,
    tmdb_key: str,
    dsn: str,
    limit: int,
    base_confidence: float,
    dry_run: bool,
) -> int:
    counts = {"inserted": 0, "updated": 0, "skipped": 0}
    dropped = 0
    lowered = 0

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            working_set = get_working_set(cur, limit)
            by_type: dict[str, list[int]] = {"movie": [], "tv": []}
            names: dict[int, str] = {}
            for tmdb_id, media_type, title in working_set:
                by_type[media_type].append(tmdb_id)
                names[tmdb_id] = title
            print(f"{len(working_set)} titles in working set "
                  f"({len(by_type['movie'])} movies, {len(by_type['tv'])} tv)")

            all_edges: list[tuple[str, Edge]] = []
            for media_type, ids in by_type.items():
                for seq_prop, direction in SEQUENCE_PROPS:
                    for start in range(0, len(ids), BATCH_SIZE):
                        batch = ids[start : start + BATCH_SIZE]
                        try:
                            bindings = run_query(session, media_type, seq_prop, batch)
                        except WikidataUnavailable as err:
                            print(f"  batch of {len(batch)} {media_type} ids ({seq_prop}) skipped: {err}")
                            rate_limit_gap(WDQS_GAP_SECONDS)
                            continue
                        all_edges.extend((media_type, e) for e in collapse(bindings, direction))
                        rate_limit_gap(WDQS_GAP_SECONDS)

            print(f"{len(all_edges)} candidate edges returned by Wikidata")

            grouped: dict[tuple[str, int], list[Edge]] = {}
            for media_type, edge in all_edges:
                grouped.setdefault((media_type, edge.from_tmdb_id), []).append(edge)

            for (media_type, from_tmdb_id), found in grouped.items():
                try:
                    origin = fetch_by_id(tmdb_session, tmdb_key, media_type, from_tmdb_id)
                except TmdbUnavailable as err:
                    print(f"  {names.get(from_tmdb_id, from_tmdb_id)}: TMDB unreachable ({err})")
                    continue
                if origin is None:
                    dropped += len(found)
                    continue

                candidates: list[tuple[Candidate, float]] = []
                for edge in found:
                    try:
                        target = fetch_by_id(tmdb_session, tmdb_key, media_type, edge.to_tmdb_id)
                    except TmdbUnavailable as err:
                        print(f"    {edge.to_label}: TMDB unreachable ({err})")
                        continue
                    if target is None:
                        print(f"    DROPPED {edge.to_label}: tmdb id {edge.to_tmdb_id} does not resolve")
                        dropped += 1
                        continue
                    prepared = prepare_edge(media_type, from_tmdb_id, target, edge.direction, None)
                    if prepared is None:
                        print(f"    DROPPED {edge.to_label}: self-edge or unreleased prerequisite")
                        dropped += 1
                        continue
                    confidence = edge.confidence(base_confidence)
                    if confidence < base_confidence:
                        lowered += 1
                    candidates.append((prepared, confidence))

                capped = cap_fanout([c for c, _ in candidates], "must", f"{media_type}:{from_tmdb_id}")
                for candidate, confidence in candidates[: len(capped)]:
                    label = f"{origin.to_title} --[{candidate.direction}]--> {candidate.to_title}"
                    if dry_run:
                        print(f"  would write must @ {confidence:.2f}: {label}")
                        continue
                    status = upsert_edge(
                        cur,
                        media_type,
                        from_tmdb_id,
                        origin.to_title,
                        origin.to_poster_path,
                        origin.to_release_date,
                        "must",
                        "wikidata",
                        confidence,
                        candidate,
                    )
                    counts[status] += 1
                    if status != "skipped":
                        print(f"  {status} must @ {confidence:.2f}: {label}")

        if not dry_run:
            conn.commit()

    if dry_run:
        print(f"\ndry run complete, dropped {dropped}")
    else:
        print(
            f"\n{counts['inserted']} inserted, {counts['updated']} updated, "
            f"{counts['skipped']} skipped by precedence, {dropped} dropped"
        )
    if lowered:
        print(f"{lowered} edge(s) crossed a series boundary and were written at {OUT_OF_SERIES_CONFIDENCE:.2f}")
    return 0


def main() -> int:
    load_local_env(ROOT)

    parser = argparse.ArgumentParser(description="Sync Must Watch edges from Wikidata P155/P156.")
    parser.add_argument("--spot-check", action="store_true", help="Query the fixed sample and print it for manual review. Run this first.")
    parser.add_argument("--limit", type=int, default=500, help="Max working-set titles (default 500).")
    parser.add_argument(
        "--confidence",
        type=float,
        default=DEFAULT_CONFIDENCE,
        help=f"Confidence for in-series edges (default {DEFAULT_CONFIDENCE}). Use 0.70 to store below the render floor.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print what would be written; write nothing.")
    args = parser.parse_args()

    tmdb_key = os.getenv("TMDB_API_KEY")
    if not tmdb_key:
        print("TMDB_API_KEY is not set", file=sys.stderr)
        return 1

    session = requests.Session()
    tmdb_session = requests.Session()

    if args.spot_check:
        return spot_check(session, tmdb_session, tmdb_key)

    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1
    return sync(session, tmdb_session, tmdb_key, dsn, args.limit, args.confidence, args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
