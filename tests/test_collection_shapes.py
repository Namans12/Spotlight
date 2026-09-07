"""scripts/lib_collection_shapes.py must stay behaviourally identical to
shared/collectionShapes.ts.

They are two implementations of one rule set, run by two different halves of
the app: the offline generator and the request-path warm. If they diverge, a
generator re-run silently overwrites the runtime's correct answer with a
different one — and because 'must' outranks 'can' in the upsert precedence
ladder, a wrong edge written that way cannot be corrected by the other side.

The fixtures below are the same real TMDB collections shared/
collectionShapes.test.ts uses, and the expectations are the same expectations.
A divergence fails on one side or the other.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from lib_collection_shapes import (  # noqa: E402
    EPISODIC_PART_THRESHOLD,
    MAX_CAN_NEIGHBOURS,
    SAME_SERIES_REASON,
    SIDE_STORY_REASON,
    plan_collection,
)

PAST = "2030-01-01"  # everything in these fixtures has released


def parts(rows: list[tuple[int, str, str | None]]) -> list[dict]:
    return [
        {"id": tmdb_id, "title": title, "poster_path": None, "release_date": release_date}
        for tmdb_id, title, release_date in rows
    ]


STAR_WARS = parts([
    (11, "Star Wars", "1977-05-25"),
    (1891, "The Empire Strikes Back", "1980-05-20"),
    (1892, "Return of the Jedi", "1983-05-25"),
    (1893, "The Phantom Menace", "1999-05-19"),
    (1894, "Attack of the Clones", "2002-05-15"),
    (1895, "Revenge of the Sith", "2005-05-17"),
    (140607, "The Force Awakens", "2015-12-15"),
    (181808, "The Last Jedi", "2017-12-13"),
    (181812, "The Rise of Skywalker", "2019-12-18"),
])

HARRY_POTTER = parts([
    (671, "Philosopher's Stone", "2001-11-16"),
    (672, "Chamber of Secrets", "2002-11-13"),
    (673, "Prisoner of Azkaban", "2004-05-31"),
    (674, "Goblet of Fire", "2005-11-16"),
    (675, "Order of the Phoenix", "2007-07-08"),
    (767, "Half-Blood Prince", "2009-07-15"),
    (12444, "Deathly Hallows: Part 1", "2010-11-17"),
    (12445, "Deathly Hallows: Part 2", "2011-07-12"),
])

BOND = parts([
    (646, "Dr. No", "1962-10-07"),
    (657, "From Russia with Love", "1963-10-10"),
    (658, "Goldfinger", "1964-09-20"),
    (660, "Thunderball", "1965-12-11"),
    (36557, "Casino Royale", "2006-11-14"),
    (10764, "Quantum of Solace", "2008-10-29"),
    (37724, "Skyfall", "2012-10-24"),
    (206647, "Spectre", "2015-10-26"),
    (370172, "No Time to Die", "2021-09-29"),
    (1184696, "Untitled James Bond Film", None),
])

GODFATHER = parts([
    (238, "The Godfather", "1972-03-14"),
    (240, "The Godfather Part II", "1974-12-20"),
    (242, "The Godfather Part III", "1990-12-25"),
    (1674276, "Coda: The Death of Michael Corleone", "2020-12-08"),
])

INSIDIOUS = parts([
    (49018, "Insidious", "2011-03-31"),
    (91586, "Chapter 2", "2013-09-12"),
    (280092, "Chapter 3", "2015-05-28"),
    (406563, "The Last Key", "2018-01-03"),
    (614479, "The Red Door", "2023-07-05"),
    (1291595, "Out of the Further", "2026-08-19"),
])

JUMANJI = parts([
    (8844, "Jumanji", "1995-12-15"),
    (353486, "Welcome to the Jungle", "2017-12-20"),
    (512200, "The Next Level", "2019-12-04"),
    (1260649, "Open World", "2026-12-24"),
])

DUNE = parts([
    (438631, "Dune", "2021-09-15"),
    (693134, "Dune: Part Two", "2024-02-27"),
    (1170608, "Dune: Part Three", "2026-12-15"),
])


def must_pairs(plan) -> list[str]:
    return [f"{later['id']}<-{earlier['id']}" for earlier, later in plan.must]


def test_harry_potter_stays_a_single_chain():
    plan = plan_collection(1241, HARRY_POTTER, PAST)
    assert plan.classification == "chain"
    assert must_pairs(plan) == [
        "672<-671",
        "673<-672",
        "674<-673",
        "675<-674",
        "767<-675",
        "12444<-767",
        "12445<-12444",
    ]
    assert plan.can == []


def test_star_wars_never_chains_across_a_trilogy_boundary():
    plan = plan_collection(10, STAR_WARS, PAST)
    assert plan.classification == "arcs"
    assert must_pairs(plan) == [
        "1891<-11",
        "1892<-1891",
        "140607<-1892",
        "181808<-140607",
        "181812<-181808",
        "1894<-1893",
        "1895<-1894",
    ]


def test_insidious_red_door_follows_chapter_two_across_the_prequels():
    plan = plan_collection(228446, INSIDIOUS, PAST)
    assert must_pairs(plan) == ["91586<-49018", "614479<-91586", "1291595<-614479", "406563<-280092"]


def test_bond_asserts_no_prerequisite_but_still_links_siblings():
    plan = plan_collection(645, BOND, PAST)
    assert plan.classification == "episodic"
    assert plan.must == []
    assert plan.can

    per_origin: dict[int, int] = {}
    for source, _target, _reason in plan.can:
        per_origin[source["id"]] = per_origin.get(source["id"], 0) + 1
    assert max(per_origin.values()) <= MAX_CAN_NEIGHBOURS * 2
    assert all(reason == SAME_SERIES_REASON for _s, _t, reason in plan.can)


def test_godfather_coda_is_a_side_story_not_a_fourth_film():
    plan = plan_collection(230, GODFATHER, PAST)
    assert must_pairs(plan) == ["240<-238", "242<-240"]
    assert [p["id"] for p in plan.loose] == [1674276]
    assert all(reason == SIDE_STORY_REASON for _s, _t, reason in plan.can)


def test_jumanji_1995_is_linked_but_not_required():
    plan = plan_collection(495527, JUMANJI, PAST)
    assert must_pairs(plan) == ["512200<-353486", "1260649<-512200"]
    assert [p["id"] for p in plan.loose] == [8844]
    can_pairs = {(s["id"], t["id"]) for s, t, _r in plan.can}
    assert (8844, 353486) in can_pairs
    assert (353486, 8844) in can_pairs


def test_unreleased_prerequisite_is_dropped():
    assert must_pairs(plan_collection(726871, DUNE, "2026-09-08")) == ["693134<-438631", "1170608<-693134"]
    assert must_pairs(plan_collection(726871, DUNE, "2023-01-01")) == ["693134<-438631"]


def test_size_fallback_only_bites_far_above_any_real_chain():
    over = parts([(9_000_000 + i, f"Entry {i}", f"20{10 + i:02d}-01-01") for i in range(EPISODIC_PART_THRESHOLD + 1)])
    under = parts([(9_100_000 + i, f"Entry {i}", f"20{10 + i:02d}-01-01") for i in range(EPISODIC_PART_THRESHOLD)])

    over_plan = plan_collection(424242, over, PAST)
    assert over_plan.classification == "episodic"
    assert any("EPISODIC_PART_THRESHOLD" in w for w in over_plan.warnings)

    assert plan_collection(424243, under, PAST).classification == "chain"


def test_part_order_does_not_matter():
    assert must_pairs(plan_collection(1241, list(reversed(HARRY_POTTER)), PAST)) == must_pairs(
        plan_collection(1241, HARRY_POTTER, PAST)
    )


def test_unknown_and_null_collection_ids_are_plain_chains():
    assert plan_collection(123456789, HARRY_POTTER, PAST).classification == "chain"
    assert plan_collection(None, HARRY_POTTER, PAST).classification == "chain"


def test_undated_parts_sort_last():
    plan = plan_collection(645, BOND, PAST)
    assert plan.loose[-1]["id"] == 1184696
