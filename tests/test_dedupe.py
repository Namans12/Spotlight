"""Distinct event dates and seasons survive digest deduplication."""

from __future__ import annotations

from datetime import date

import releasebot as rb

OUT = (date(2026, 8, 19), date(2026, 8, 20))
UP = (date(2026, 8, 21), date(2026, 8, 27))


def item(title, tmdb_id, release_date, *, providers=(), media_type="movie", poster="/p.jpg", popularity=1.0):
    return rb.ReleaseItem(
        tmdb_id=tmdb_id,
        title=title,
        media_type=media_type,
        language="ta",
        release_date=release_date,
        rating=5.0,
        popularity=popularity,
        overview="",
        tmdb_url="https://example.invalid",
        poster_url=poster,
        providers=providers,
    )


def total(*section_dicts):
    return sum(len(v) for d in section_dicts for v in d.values())


def test_different_dates_remain_distinct_events():
    """The exact live bug: Jana Nayagan in July (cinema) and August (OTT)."""
    cinema = item("Jana Nayagan", 1235877, "2026-07-23")
    ott = item("Jana Nayagan", 1235877, "2026-08-21", providers=("ZEE5",))
    out = {"popular": [cinema], "hindi": [], "english": []}
    up = {"popular": [ott], "hindi": [], "english": []}

    rb.drop_cross_window_duplicates(out, up, OUT, UP)

    assert out["popular"] == [cinema]
    assert up["popular"] == [ott]


def test_distinct_titles_are_untouched():
    a, b = item("A", 1, "2026-08-19"), item("B", 2, "2026-08-22")
    out, up = {"popular": [a]}, {"popular": [b]}
    rb.drop_cross_window_duplicates(out, up, OUT, UP)
    assert out["popular"] == [a] and up["popular"] == [b]


def test_value_identical_copies_collapse_to_one():
    """ReleaseItem is a frozen dataclass, so two copies compare equal.

    An equality-based filter kept both; the dedupe must compare identity.
    """
    a = item("X", 7, "2026-08-19")
    b = item("X", 7, "2026-08-19")
    assert a == b and a is not b
    out, up = {"popular": [a]}, {"popular": [b]}
    rb.drop_cross_window_duplicates(out, up, OUT, UP)
    assert total(out, up) == 1


def test_distinct_dates_are_not_discarded_even_outside_windows():
    bare = item("Y", 3, "2026-07-01")
    rich = item("Y", 3, "2026-07-02", providers=("Netflix",))
    out, up = {"popular": [bare]}, {"popular": [rich]}
    rb.drop_cross_window_duplicates(out, up, OUT, UP)
    assert out["popular"] == [bare] and up["popular"] == [rich]


def test_same_tmdb_id_with_different_media_type_is_not_a_duplicate():
    movie = item("Dup", 9, "2026-08-19", media_type="movie")
    show = item("Dup", 9, "2026-08-22", media_type="tv")
    out, up = {"popular": [movie]}, {"popular": [show]}
    rb.drop_cross_window_duplicates(out, up, OUT, UP)
    assert out["popular"] == [movie] and up["popular"] == [show]


def test_unparseable_date_remains_separate_from_a_real_date():
    tba = item("Z", 4, "TBA")
    dated = item("Z", 4, "2026-08-21", providers=("Netflix",))
    out, up = {"popular": [tba]}, {"popular": [dated]}
    rb.drop_cross_window_duplicates(out, up, OUT, UP)
    assert out["popular"] == [tba] and up["popular"] == [dated]


def test_three_distinct_dates_of_one_title_remain_separate():
    a = item("Y", 8, "2026-07-01")
    b = item("Y", 8, "2026-08-19", providers=("Netflix",))
    c = item("Y", 8, "2026-08-25")
    out = {"popular": [a], "english": [b]}
    up = {"popular": [c]}
    rb.drop_cross_window_duplicates(out, up, OUT, UP)
    assert total(out, up) == 3
    assert out["english"] == [b]


def test_a_single_placement_is_left_alone():
    only = item("Solo", 11, "2026-08-19")
    out, up = {"popular": [only]}, {"popular": []}
    rb.drop_cross_window_duplicates(out, up, OUT, UP)
    assert out["popular"] == [only]


def test_distinct_same_name_titles_and_dates_are_not_collapsed():
    items = [item('Same', 1, '2026-08-19'), item('Same', 2, '2026-08-19'),
             item('Same', 1, '2026-08-20')]
    assert len(rb.dedupe(items)) == 3
    merged = rb.merge_sections({'english': items[:1]}, {'english': items[1:]})
    assert len(merged['english']) == 3


def test_seasons_remain_distinct_and_same_event_combines_verified_providers():
    from dataclasses import replace
    evidence = rb.ReleaseEvidence('IN', 'tmdb_regional_digital', 'tmdb_regional_availability', event_kind='digital')
    first = replace(item('Show', 9, '2026-08-19', providers=('Netflix',), media_type='tv'), season_number=1, evidence=evidence)
    second = replace(first, season_number=2)
    another_observation = replace(first, providers=('ZEE5',))
    merged = rb.merge_sections({'english': [first, second]}, {'english': [another_observation]})['english']
    assert len(merged) == 2
    assert set(next(i for i in merged if i.season_number == 1).providers) == {'Netflix', 'ZEE5'}
