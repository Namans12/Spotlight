"""Python mirror of shared/collectionShapes.ts.

Both the offline generator (sync_relations_tmdb.py) and the request-path warm
(lib/relationsDb.ts writeCollectionChain) turn a TMDB collection into edges,
and they must agree — otherwise re-running the generator would overwrite the
runtime's correct answer with the naive one, or vice versa. They agree by
reading the *same* curated file, data/collection-shapes.json, and applying the
same three rules to it:

    chain     one continuous story        -> consecutive pairs become 'must'
    arcs      several independent stories -> consecutive pairs within an arc
    episodic  a brand, not a story        -> no 'must' edges at all

Anything left outside a chain (an episodic collection's parts, a singleton
arc, an excluded spin-off) becomes a 'can' edge reading "same series, not
required" rather than disappearing.

This replaces the MULTI_ARC_COLLECTIONS dict that used to live in
sync_relations_tmdb.py. That dict expressed arcs as *sizes* over the
release-sorted list, which cannot describe a collection like Insidious, where
The Red Door continues Chapter 2 across two prequels released in between. Arcs
are explicit id groups here for that reason.

Keep this file behaviourally identical to the TypeScript. `tests/
test_collection_shapes.py` asserts the same fixtures the TS suite does, so a
divergence fails one of the two.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any, Iterable, Literal

ROOT = Path(__file__).resolve().parent.parent
SHAPES_PATH = ROOT / "data" / "collection-shapes.json"

# Mirrors EPISODIC_PART_THRESHOLD in shared/collectionShapes.ts. Deliberately
# far above any legitimate single narrative: Harry Potter is 8 parts and is a
# real chain, so a lower fallback would demote it. See the JSON file's $doc.
EPISODIC_PART_THRESHOLD = 12

# Mirrors MAX_CAN_NEIGHBOURS. Bounded so an episodic collection cannot exceed
# lib_relations.MAX_EDGES_PER_KIND (12) for any one origin title.
MAX_CAN_NEIGHBOURS = 3

SAME_SERIES_REASON = "Same series — not required to follow this one."
SIDE_STORY_REASON = "A side story in the same series — not required to follow the main films."

Classification = Literal["chain", "arcs", "episodic"]

_UNDATED_SORT_KEY = "9999-99-99"


def _load_shapes() -> dict[str, dict[str, Any]]:
    with SHAPES_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)["collections"]


SHAPES: dict[str, dict[str, Any]] = _load_shapes()


def get_collection_shape(collection_id: int | None) -> dict[str, Any] | None:
    if collection_id is None:
        return None
    return SHAPES.get(str(collection_id))


def sort_by_release(parts: Iterable[dict]) -> list[dict]:
    """Release order, undated last — an unannounced entry must never slot in
    ahead of a dated one and invent a prerequisite."""
    return sorted(parts, key=lambda p: p.get("release_date") or _UNDATED_SORT_KEY)


def _is_unreleased(release_date: str | None, today: str) -> bool:
    return bool(release_date) and release_date > today


class CollectionPlan:
    """What one collection justifies writing.

    `must` holds (earlier, later) pairs — `later` assumes `earlier`. `can`
    holds (from_part, to_part, reason) triples with no direction, matching the
    title_relations CHECK constraints in migrations/0003.
    """

    def __init__(
        self,
        classification: Classification,
        arcs: list[list[dict]],
        loose: list[dict],
        must: list[tuple[dict, dict]],
        can: list[tuple[dict, dict, str]],
        warnings: list[str],
    ):
        self.classification = classification
        self.arcs = arcs
        self.loose = loose
        self.must = must
        self.can = can
        self.warnings = warnings


def _nearest_siblings(ordered: list[dict], index: int, n: int) -> list[dict]:
    return ordered[max(0, index - n) : index] + ordered[index + 1 : index + 1 + n]


def plan_collection(
    collection_id: int | None,
    parts: list[dict],
    today: str | None = None,
) -> CollectionPlan:
    """Classify one collection and return the edges to write for it.

    `parts` are raw TMDB collection parts (`id`, `title`, `release_date`,
    `poster_path`) in any order. `today` is injectable so the
    unreleased-prerequisite rule is testable without freezing the clock.
    """
    today = today or date.today().isoformat()
    warnings: list[str] = []

    ordered = sort_by_release([p for p in parts if p.get("id")])
    shape = get_collection_shape(collection_id)

    excluded = set(shape.get("exclude", []) if shape else [])
    chainable = [p for p in ordered if p["id"] not in excluded]
    by_id = {p["id"]: p for p in chainable}

    if (shape and shape.get("episodic")) or len(chainable) > EPISODIC_PART_THRESHOLD:
        if not (shape and shape.get("episodic")):
            warnings.append(
                f"collection {collection_id}: {len(chainable)} parts exceeds "
                f"EPISODIC_PART_THRESHOLD ({EPISODIC_PART_THRESHOLD}) with no curated "
                "entry — treating as episodic"
            )
        classification: Classification = "episodic"
        arcs: list[list[dict]] = []
        loose = list(ordered)

    elif shape and shape.get("arcs"):
        classification = "arcs"
        claimed: set[int] = set()
        grouped: list[list[dict]] = []

        for arc_ids in shape["arcs"]:
            members = []
            for tmdb_id in arc_ids:
                part = by_id.get(tmdb_id)
                if part is None:
                    warnings.append(
                        f"collection {collection_id}: arc references id {tmdb_id}, "
                        "which the collection no longer contains"
                    )
                    continue
                claimed.add(tmdb_id)
                members.append(part)
            # Within an arc the chain still follows release order; a different
            # narrative order is expressed by `story`, never by arc member order.
            grouped.append(sort_by_release(members))

        unclaimed = [p for p in chainable if p["id"] not in claimed]
        if unclaimed:
            warnings.append(
                f"collection {collection_id}: {len(unclaimed)} part(s) not named in any arc "
                f"({', '.join(str(p['id']) for p in unclaimed)}) — treated as loose"
            )

        # A one-part arc is a deliberate "this stands alone" marker, not a chain.
        arcs = [a for a in grouped if len(a) >= 2]
        loose = (
            [p for p in ordered if p["id"] in excluded]
            + [p for a in grouped if len(a) < 2 for p in a]
            + unclaimed
        )

    else:
        classification = "chain"
        arcs = [chainable] if len(chainable) >= 2 else []
        loose = [p for p in ordered if p["id"] in excluded] + (
            chainable if len(chainable) < 2 else []
        )

    must: list[tuple[dict, dict]] = []
    for arc in arcs:
        for earlier, later in zip(arc, arc[1:]):
            if earlier["id"] == later["id"]:
                continue
            # A prerequisite cannot be unreleased. Drops the pair rather than
            # only its 'before' half, so the reciprocal never claims a
            # continuation from a film nobody can watch yet either.
            if _is_unreleased(earlier.get("release_date"), today):
                continue
            must.append((earlier, later))

    can: list[tuple[dict, dict, str]] = []
    seen: set[tuple[int, int]] = set()
    positions = {p["id"]: i for i, p in enumerate(ordered)}

    for part in loose:
        index = positions.get(part["id"])
        if index is None:
            continue
        for sibling in _nearest_siblings(ordered, index, MAX_CAN_NEIGHBOURS):
            reason = (
                SIDE_STORY_REASON
                if part["id"] in excluded or sibling["id"] in excluded
                else SAME_SERIES_REASON
            )
            for source, target in ((part, sibling), (sibling, part)):
                key = (source["id"], target["id"])
                if source["id"] == target["id"] or key in seen:
                    continue
                seen.add(key)
                can.append((source, target, reason))

    return CollectionPlan(classification, arcs, loose, must, can, warnings)
