"""Shared validation, TMDB resolution, and upsert logic for the title_relations
generators (sync_relations_tmdb.py, sync_relations_wikidata.py, seed_relations.py).

Implemented once here so all three inherit the same rules (design doc §5.1):

    1. Resolve to a real TMDB id — anything that doesn't resolve is dropped,
       not guessed. This is the hallucination filter.
    2. Reject self-edges (from == to).
    3. Reject edges to unreleased titles where direction='before' — a
       prerequisite cannot be unreleased.
    4. Populate denormalised display fields from the same TMDB response used
       to validate.
    5. Cap fan-out at 12 edges per kind per origin title.

Also owns reciprocation (§3.6): every 'must' edge is written in both
directions by the loader, not by each generator, so a follows/followed-by
pair only has to be described once by the caller.
"""

from __future__ import annotations

import os
import re
import time
import unicodedata
from datetime import date, datetime
from typing import Any, Literal

import requests

TMDB_BASE_URL = "https://api.themoviedb.org/3"
MAX_EDGES_PER_KIND = 12
REQUEST_TIMEOUT_SECONDS = 30
TMDB_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 0.6

MediaType = Literal["movie", "tv"]
Direction = Literal["before", "after"]
Kind = Literal["must", "can"]
Source = Literal["tmdb", "wikidata", "seed", "llm"]

# Mirrors the precedence CASE expressions in migrations/0003_title_relations.sql §3.5.
_KIND_RANK = {"must": 1, "can": 0}
_SOURCE_RANK = {"tmdb": 3, "wikidata": 2, "seed": 1, "llm": 0}

UPSERT_SQL = """
INSERT INTO title_relations
    (from_media_type, from_tmdb_id, to_media_type, to_tmdb_id, kind, direction,
     reason, source, confidence, to_title, to_poster_path, to_release_date)
VALUES (%(from_media_type)s, %(from_tmdb_id)s, %(to_media_type)s, %(to_tmdb_id)s, %(kind)s, %(direction)s,
        %(reason)s, %(source)s, %(confidence)s, %(to_title)s, %(to_poster_path)s, %(to_release_date)s)
ON CONFLICT (from_media_type, from_tmdb_id, to_media_type, to_tmdb_id)
DO UPDATE SET
    kind            = EXCLUDED.kind,
    direction       = EXCLUDED.direction,
    reason          = EXCLUDED.reason,
    source          = EXCLUDED.source,
    confidence      = EXCLUDED.confidence,
    to_title        = EXCLUDED.to_title,
    to_poster_path  = EXCLUDED.to_poster_path,
    to_release_date = EXCLUDED.to_release_date,
    updated_at      = now()
WHERE (
    CASE EXCLUDED.kind WHEN 'must' THEN 1 ELSE 0 END,
    CASE EXCLUDED.source WHEN 'tmdb' THEN 3 WHEN 'wikidata' THEN 2 WHEN 'seed' THEN 1 ELSE 0 END
) > (
    CASE title_relations.kind WHEN 'must' THEN 1 ELSE 0 END,
    CASE title_relations.source WHEN 'tmdb' THEN 3 WHEN 'wikidata' THEN 2 WHEN 'seed' THEN 1 ELSE 0 END
)
RETURNING (xmax = 0) AS inserted
"""

_OPPOSITE: dict[Direction, Direction] = {"before": "after", "after": "before"}


def load_local_env(root: Any) -> None:
    """Fill unset vars from a repo-root .env, for manual local runs."""
    env_path = root / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


def _to_iso_date(raw: Any) -> str | None:
    if not raw:
        return None
    text = str(raw).strip()
    if len(text) < 10:
        return None
    return text[:10]


class TmdbUnavailable(Exception):
    """TMDB never gave a definitive answer — connection reset, timeout, 5xx, or
    a rate-limit that outlived the retries.

    Deliberately distinct from a 404. "This title does not exist" is evidence a
    generator hallucinated it and the edge should be dropped; "we could not ask"
    is not evidence of anything, and reporting the two the same way would let a
    bad network quietly gut a seed run while the log claimed the data was wrong.
    """


def tmdb_get(
    session: requests.Session,
    path: str,
    tmdb_key: str,
    params: dict[str, Any] | None = None,
    attempts: int = TMDB_ATTEMPTS,
) -> dict[str, Any] | None:
    """GET a TMDB path, retrying transient failures with exponential backoff.

    Returns the parsed body, or None for a genuine 404. Raises TmdbUnavailable
    when every attempt failed without a definitive answer.
    """
    last_error: Exception | str = "no attempt made"

    for attempt in range(attempts):
        try:
            response = session.get(
                f"{TMDB_BASE_URL}{path}",
                params={**(params or {}), "api_key": tmdb_key},
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as err:
            # Request exceptions can contain the full URL, including api_key.
            last_error = type(err).__name__
        else:
            if response.status_code == 404:
                return None
            if response.status_code == 200:
                try:
                    return response.json()
                except ValueError as err:
                    last_error = type(err).__name__
            else:
                last_error = f"HTTP {response.status_code}"

        if attempt < attempts - 1:
            time.sleep(RETRY_BACKOFF_SECONDS * (2**attempt))

    raise TmdbUnavailable(f"{path}: {last_error}") from None


def _match_key(raw: str) -> str:
    """Fold case, accents and punctuation so 'WALL·E' still matches 'WALL-E',
    without letting a substring pass as an equal title. Mirrors _match_key in
    backfill_ratings.py, which exists for the same reason: attributing data to
    a confidently-wrong title is worse than attributing none."""
    text = unicodedata.normalize("NFKD", raw or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^0-9a-z]+", " ", text.lower())
    return " ".join(text.split())


def titles_match(expected: str, actual: str) -> bool:
    if not expected or not actual:
        return False
    return _match_key(expected) == _match_key(actual)


def years_match(expected: int | None, iso_date: str | None, tolerance: int = 1) -> bool:
    """True when the years agree within `tolerance`, or when either side is
    unknown — an absent date is not evidence of a mismatch."""
    if expected is None or not iso_date:
        return True
    try:
        return abs(int(str(iso_date)[:4]) - int(expected)) <= tolerance
    except (TypeError, ValueError):
        return True


def _is_unreleased(release_date: str | None) -> bool:
    if not release_date:
        return False
    try:
        return datetime.strptime(release_date, "%Y-%m-%d").date() > date.today()
    except ValueError:
        return False


class Candidate:
    """One TMDB-resolved edge, ready for validation and upsert."""

    def __init__(
        self,
        to_media_type: MediaType,
        to_tmdb_id: int,
        to_title: str,
        to_poster_path: str | None,
        to_release_date: str | None,
        direction: Direction | None,
        reason: str | None,
    ):
        self.to_media_type = to_media_type
        self.to_tmdb_id = to_tmdb_id
        self.to_title = to_title
        self.to_poster_path = to_poster_path
        self.to_release_date = to_release_date
        self.direction = direction
        self.reason = reason


def resolve_title_year(
    session: requests.Session,
    tmdb_key: str,
    media_type: MediaType,
    title: str,
    year: int | None,
) -> Candidate | None:
    """Name + year -> a confident TMDB match (exact title, release year within
    ±1). Used by generators that only have a name to go on (Wikidata, the
    offline seed) — never by the TMDB-collection generator, which already has
    a real id. Returns None rather than guessing when nothing matches well
    enough; the caller must drop the candidate, not invent one.

    TMDB titles are not unique — confirmed in production, where a calendar
    row titled "King" (2026) matched an unrelated 17-minute short also titled
    "King" (2026) instead of the intended theatrical release, because (a) the
    intended title didn't even appear in a plain-query search's first page
    without `year` sent to the request itself, and (b) taking the first
    exact-title hit picked whichever the API listed first, not the right one.
    Both fixes apply here: `year` is sent as a real search parameter, not just
    a local post-filter, and every exact-title match found is ranked — closest
    to `year`, then most popular — rather than returning the first one.
    """
    path = "/search/movie" if media_type == "movie" else "/search/tv"
    params = {"query": title, "include_adult": "false"}
    if year is not None:
        params["year" if media_type == "movie" else "first_air_date_year"] = year
    payload = tmdb_get(session, path, tmdb_key, params)
    results = (payload or {}).get("results", [])

    candidates = []
    for r in results:
        candidate_title = r.get("title") or r.get("name") or ""
        if not titles_match(title, candidate_title):
            continue
        candidate_date = r.get("release_date") or r.get("first_air_date") or ""
        if not years_match(year, candidate_date):
            continue
        candidates.append(r)

    if not candidates:
        return None

    def rank(r: dict[str, Any]) -> tuple[float, float]:
        candidate_date = r.get("release_date") or r.get("first_air_date") or ""
        year_gap = float("inf")
        if year is not None and candidate_date:
            try:
                year_gap = abs(int(candidate_date[:4]) - year)
            except ValueError:
                pass
        return (year_gap, -float(r.get("popularity") or 0))

    candidates.sort(key=rank)
    best = candidates[0]
    candidate_date = best.get("release_date") or best.get("first_air_date") or ""
    return Candidate(
        media_type,
        best["id"],
        best.get("title") or best.get("name") or title,
        best.get("poster_path"),
        _to_iso_date(candidate_date),
        None,
        None,
    )


def fetch_by_id(
    session: requests.Session,
    tmdb_key: str,
    media_type: MediaType,
    tmdb_id: int,
) -> Candidate | None:
    """Authoritative lookup by TMDB id, for edges that already know their id.
    The seed loader needs this for the `from` side, whose denormalised fields
    the reciprocal write copies in."""
    path = "movie" if media_type == "movie" else "tv"
    r = tmdb_get(session, f"/{path}/{tmdb_id}", tmdb_key)
    if r is None:
        return None

    return Candidate(
        media_type,
        r.get("id", tmdb_id),
        r.get("title") or r.get("name") or "Untitled",
        r.get("poster_path"),
        _to_iso_date(r.get("release_date") or r.get("first_air_date")),
        None,
        None,
    )


def prepare_edge(
    from_media_type: MediaType,
    from_tmdb_id: int,
    candidate: Candidate,
    direction: Direction | None,
    reason: str | None,
) -> Candidate | None:
    """Applies the self-edge and unreleased-prerequisite rules (§5.1 rules 2-3).
    Returns None when the candidate must be dropped."""
    if candidate.to_media_type == from_media_type and candidate.to_tmdb_id == from_tmdb_id:
        return None
    if direction == "before" and _is_unreleased(candidate.to_release_date):
        return None
    candidate.direction = direction
    candidate.reason = reason
    return candidate


def cap_fanout(candidates: list[Candidate], kind: Kind, origin_label: str) -> list[Candidate]:
    """At most 12 edges per kind per origin. A generator returning more is a
    signal it drifted into recommendations, so the overflow is logged, not
    silently truncated."""
    if len(candidates) <= MAX_EDGES_PER_KIND:
        return candidates
    print(
        f"  [{origin_label}] {kind}: {len(candidates)} candidates, capping to "
        f"{MAX_EDGES_PER_KIND} (generator drifted into recommendations?)"
    )
    return candidates[:MAX_EDGES_PER_KIND]


def upsert_edge(
    cur: Any,
    from_media_type: MediaType,
    from_tmdb_id: int,
    from_title: str,
    from_poster_path: str | None,
    from_release_date: str | None,
    kind: Kind,
    source: Source,
    confidence: float,
    candidate: Candidate,
) -> str:
    """Upserts one edge under the §3.5 precedence rule, and — for 'must' edges
    only — writes the reciprocal edge in the opposite direction (§3.6), using
    the origin title's own denormalised fields as that edge's `to_*` columns.

    Returns 'inserted', 'updated', or 'skipped' (precedence kept the existing
    row). Re-running a generator over unchanged data yields all 'skipped',
    which is the idempotency guarantee the loaders report on."""
    cur.execute(
        UPSERT_SQL,
        {
            "from_media_type": from_media_type,
            "from_tmdb_id": from_tmdb_id,
            "to_media_type": candidate.to_media_type,
            "to_tmdb_id": candidate.to_tmdb_id,
            "kind": kind,
            "direction": candidate.direction,
            "reason": candidate.reason,
            "source": source,
            "confidence": confidence,
            "to_title": candidate.to_title,
            "to_poster_path": candidate.to_poster_path,
            "to_release_date": candidate.to_release_date,
        },
    )
    row = cur.fetchone()
    # RETURNING (xmax = 0) distinguishes a fresh insert from an update; no row
    # at all means the precedence WHERE clause rejected the write.
    status = "skipped" if row is None else ("inserted" if row[0] else "updated")

    if kind == "must" and candidate.direction is not None:
        cur.execute(
            UPSERT_SQL,
            {
                "from_media_type": candidate.to_media_type,
                "from_tmdb_id": candidate.to_tmdb_id,
                "to_media_type": from_media_type,
                "to_tmdb_id": from_tmdb_id,
                "kind": "must",
                "direction": _OPPOSITE[candidate.direction],
                "reason": None,
                "source": source,
                "confidence": confidence,
                "to_title": from_title,
                "to_poster_path": from_poster_path,
                "to_release_date": from_release_date,
            },
        )

    return status


def get_working_set(cur: Any, limit: int) -> list[tuple[int, str, str]]:
    """Titles worth generating relations for: everything already saved plus
    everything in the release radar — the same "few hundred titles" scope the
    design doc scopes the offline seed to (§5.4), reused here since it is the
    only set of titles this deployment already has TMDB ids for."""
    cur.execute(
        """
        SELECT tmdb_id, media_type, min(title) AS title
        FROM (
            SELECT tmdb_id, media_type, title FROM watchlist_items
            UNION ALL
            SELECT tmdb_id, media_type, title FROM release_items
        ) AS candidates
        GROUP BY tmdb_id, media_type
        ORDER BY tmdb_id
        LIMIT %s
        """,
        (limit,),
    )
    return cur.fetchall()


def rate_limit_gap(seconds: float) -> None:
    time.sleep(seconds)
