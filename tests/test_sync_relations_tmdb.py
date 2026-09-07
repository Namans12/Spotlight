"""consecutive_pairs must never chain a must-before edge across an arc
boundary inside a bundled TMDB collection.

TMDB's "Star Wars Collection" (id 10) lists all 9 mainline saga films —
original, prequel, and sequel trilogies — as one collection sorted by release
date:

    1977 ANH, 1980 ESB, 1983 ROTJ, 1999 TPM, 2002 AOTC, 2005 ROTS,
    2015 TFA, 2017 TLJ, 2019 TROS

A naive zip(parts, parts[1:]) walk invents two nonsense prerequisites at the
trilogy boundaries: ROTJ-before-TPM and ROTS-before-TFA. Real single-story
collections (Iron Man, Harry Potter, ...) are unaffected — they carry no entry
in data/collection-shapes.json and so still get the full linear chain.

The classification itself now lives in that shared JSON file rather than in a
dict inside the generator, so lib/relationsDb.ts's request-path warm reaches
the same verdict. tests/test_collection_shapes.py covers the engine directly;
this file covers the generator's use of it.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import sync_relations_tmdb as srt  # noqa: E402

STAR_WARS_COLLECTION_ID = 10


def part(title: str, release_date: str, tmdb_id: int) -> dict:
    return {"id": tmdb_id, "title": title, "release_date": release_date}


STAR_WARS_PARTS = [
    part("Star Wars", "1977-05-25", 11),
    part("The Empire Strikes Back", "1980-05-17", 1891),
    part("Return of the Jedi", "1983-05-23", 1892),
    part("The Phantom Menace", "1999-05-19", 1893),
    part("Attack of the Clones", "2002-05-16", 1894),
    part("Revenge of the Sith", "2005-05-19", 1895),
    part("The Force Awakens", "2015-12-18", 140607),
    part("The Last Jedi", "2017-12-15", 181808),
    part("The Rise of Skywalker", "2019-12-20", 181812),
]


def pair_titles(pairs: list[tuple[dict, dict]]) -> list[tuple[str, str]]:
    return [(earlier["title"], later["title"]) for earlier, later in pairs]


def test_star_wars_collection_splits_into_three_trilogies_not_one_chain():
    pairs = pair_titles(srt.consecutive_pairs(STAR_WARS_PARTS, STAR_WARS_COLLECTION_ID))

    # The sequel trilogy continues the original directly, so those six are one
    # arc; the prequels are a separate line that neither requires.
    assert pairs == [
        ("Star Wars", "The Empire Strikes Back"),
        ("The Empire Strikes Back", "Return of the Jedi"),
        ("Return of the Jedi", "The Force Awakens"),
        ("The Force Awakens", "The Last Jedi"),
        ("The Last Jedi", "The Rise of Skywalker"),
        ("The Phantom Menace", "Attack of the Clones"),
        ("Attack of the Clones", "Revenge of the Sith"),
    ]


def test_star_wars_collection_never_crosses_a_trilogy_boundary():
    pairs = pair_titles(srt.consecutive_pairs(STAR_WARS_PARTS, STAR_WARS_COLLECTION_ID))

    assert ("Return of the Jedi", "The Phantom Menace") not in pairs
    assert ("Revenge of the Sith", "The Force Awakens") not in pairs
    # ...and nothing else links a prequel to either of the other two trilogies.
    assert not any("Menace" in a or "Clones" in a or "Sith" in a for a, b in pairs if "Menace" not in b and "Clones" not in b and "Sith" not in b)


def test_ordinary_collection_still_gets_the_full_linear_chain():
    """A collection absent from data/collection-shapes.json (e.g. Iron Man) is
    unaffected — every release-date-consecutive pair is a real prerequisite."""
    iron_man_parts = [
        part("Iron Man", "2008-05-02", 1726),
        part("Iron Man 2", "2010-05-07", 10138),
        part("Iron Man 3", "2013-05-03", 68721),
    ]

    pairs = pair_titles(srt.consecutive_pairs(iron_man_parts, collection_id=14))

    assert pairs == [
        ("Iron Man", "Iron Man 2"),
        ("Iron Man 2", "Iron Man 3"),
    ]


def test_stale_arc_ids_are_reported_rather_than_silently_misapplied():
    """If TMDB adds a part to a curated collection without the JSON entry
    being updated, the extra part must be reported and left out of the chain
    rather than quietly appended to whichever arc happens to be last."""
    parts_with_extra = STAR_WARS_PARTS + [part("A New Spinoff", "2024-01-01", 999999)]

    plan = srt.plan_collection(STAR_WARS_COLLECTION_ID, parts_with_extra)

    assert any("not named in any arc" in w for w in plan.warnings)
    assert 999999 in {p["id"] for p in plan.loose}
    # The real arcs are still produced correctly alongside the warning.
    assert ("Return of the Jedi", "The Phantom Menace") not in pair_titles(plan.must)


def test_sorted_parts_puts_undated_entries_last():
    unordered = [
        part("Sequel", "2020-01-01", 2),
        {"id": 3, "title": "Announced", "release_date": None},
        part("Original", "2010-01-01", 1),
    ]

    assert [p["id"] for p in srt.sorted_parts({"parts": unordered})] == [1, 2, 3]
