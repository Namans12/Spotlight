"""The primary-only guard on search()'s year-drop TV rescue.

This rescue exists for a real reason (see search()'s own docstring: Sugar,
Big Brother, King of the Hill were all wrongly linked to a decoy movie
without it) and a real regression when applied too broadly (Mirzapur — a
'Movie' row whose fallback attempt at 'tv' rescued the wrong, unrelated,
massively popular TV series sharing the bare title). Both scenarios are
reproduced here against a fake TMDB, so the guard can't quietly regress in
either direction.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import backfill_calendar_tmdb as bc  # noqa: E402


class FakeResponse:
    def __init__(self, payload):
        self.status_code = 200
        self._payload = payload

    def json(self):
        return self._payload


class FakeSession:
    """results_by_query: {(path, query, has_year_param): [result, ...]}."""

    def __init__(self, results_by_query):
        self._results = results_by_query

    def get(self, url, params=None, timeout=None):
        path = url.split("themoviedb.org/3")[-1] if "themoviedb.org/3" in url else url
        query = (params or {}).get("query")
        has_year = "year" in (params or {}) or "first_air_date_year" in (params or {})
        key = (path, query, has_year)
        return FakeResponse({"results": self._results.get(key, [])})


def result(id_, title=None, name=None, release_date=None, first_air_date=None, popularity=1.0):
    r = {"id": id_, "popularity": popularity}
    if title is not None:
        r["title"] = title
    if name is not None:
        r["name"] = name
    if release_date is not None:
        r["release_date"] = release_date
    if first_air_date is not None:
        r["first_air_date"] = first_air_date
    return r


def test_mirzapur_regression_wrong_type_fallback_is_not_rescued():
    """A 'Movie' row: no movie match, then TV attempted as a FALLBACK. The
    only TV title match is a real but unrelated show sharing the bare title,
    at the wrong year — must NOT be rescued on a non-primary attempt."""
    mirzapur_series = result(84105, name="Mirzapur", first_air_date="2018-11-16", popularity=850.0)
    session = FakeSession({
        ("/search/movie", "Mirzapur", False): [],
        ("/search/movie", "Mirzapur", True): [],
        ("/search/tv", "Mirzapur", False): [mirzapur_series],
        ("/search/tv", "Mirzapur", True): [],
    })
    movie_result = bc.search(session, "key", "movie", "Mirzapur", date(2026, 9, 4), is_primary=True)
    assert movie_result is None

    tv_result = bc.search(session, "key", "tv", "Mirzapur", date(2026, 9, 4), is_primary=False)
    assert tv_result is None, "the unrelated 2018 series must not be rescued as a fallback match"


def test_sugar_style_rescue_still_works_on_the_primary_attempt():
    """A 'Show' row: TV is the PRIMARY attempt. No year-matching candidate
    (the real show renewed years after its first_air_date), but the
    year-dropped, popularity-ranked rescue must still find the real show."""
    # Neither candidate's actual air date is within a year of the calendar's
    # date — that's the whole premise of the bug: the year check alone can't
    # tell the real, renewed-years-later show from a same-titled decoy.
    real_sugar = result(202555, name="Sugar", first_air_date="2024-04-05", popularity=30.57)
    decoy = result(999999, name="Sugar", first_air_date="2020-06-01", popularity=0.66)
    session = FakeSession({
        ("/search/tv", "Sugar", False): [real_sugar, decoy],
        ("/search/tv", "Sugar", True): [],  # the year-scoped query finds neither
    })
    got = bc.search(session, "key", "tv", "Sugar", date(2026, 1, 12), is_primary=True)
    assert got is not None
    assert got["id"] == 202555, "the real, far-more-popular show must win the rescue"


def test_primary_attempt_with_no_candidates_at_all_is_still_unmatched():
    session = FakeSession({
        ("/search/tv", "Nothing Like This", False): [],
        ("/search/tv", "Nothing Like This", True): [],
    })
    assert bc.search(session, "key", "tv", "Nothing Like This", date(2026, 1, 1), is_primary=True) is None


def test_fallback_attempt_that_would_have_matched_by_year_still_matches():
    """The guard only removes the year-DROPPED rescue; a fallback attempt
    that finds a real, year-matching candidate must still succeed normally."""
    good = result(555, title="Some Film", release_date="2026-09-04", popularity=5.0)
    session = FakeSession({
        ("/search/movie", "Some Film", False): [good],
        ("/search/movie", "Some Film", True): [good],
    })
    got = bc.search(session, "key", "movie", "Some Film", date(2026, 9, 4), is_primary=False)
    assert got is not None and got["id"] == 555


# --------------------------------------------------------------------------
# KNOWN_WRONG_MATCHES — a confirmed title-collision decoy must never be
# offered again, even when it's the ONLY candidate TMDB returns. Without
# this, unlinking a row after finding this by hand (tmdb_id -> NULL) just
# makes it a fresh backfill candidate that re-discovers the same wrong id
# on the very next run — found happening in production.
# --------------------------------------------------------------------------

def test_known_wrong_match_is_excluded_even_as_the_only_candidate():
    decoy = result(1669683, title="Giant", release_date="2026-04-21", popularity=5.0)
    assert ("movie", 1669683) in bc.KNOWN_WRONG_MATCHES
    session = FakeSession({
        ("/search/movie", "Giant", False): [decoy],
        ("/search/movie", "Giant", True): [decoy],
    })
    assert bc.search(session, "key", "movie", "Giant", date(2026, 5, 22), is_primary=True) is None


def test_known_wrong_match_excluded_from_the_tv_rescue_too():
    decoy = result(254821, name="Perfect Match", first_air_date="2025-01-25", popularity=999.0)
    assert ("tv", 254821) in bc.KNOWN_WRONG_MATCHES
    session = FakeSession({
        ("/search/tv", "Perfect Match", False): [decoy],
        ("/search/tv", "Perfect Match", True): [],
    })
    assert bc.search(session, "key", "tv", "Perfect Match", date(2026, 5, 13), is_primary=True) is None


def test_a_different_id_with_the_same_title_is_not_affected():
    """The exclusion is keyed on the specific id, not the title string — a
    genuinely different, correctly-matching "Giant" must still be found."""
    real = result(999, title="Giant", release_date="2026-05-22", popularity=5.0)
    session = FakeSession({
        ("/search/movie", "Giant", False): [real],
        ("/search/movie", "Giant", True): [real],
    })
    got = bc.search(session, "key", "movie", "Giant", date(2026, 5, 22), is_primary=True)
    assert got is not None and got["id"] == 999


# --------------------------------------------------------------------------
# NEVER_AUTO_MATCH_TITLES — proven-generic titles are skipped before any
# TMDB call, rather than chased id-by-id: re-excluding one bad "Giant" id
# just surfaced a DIFFERENT wrong "Giant" (a boxing biopic) on the very next
# run, same year, so a per-id blocklist alone cannot keep up with this title.
# --------------------------------------------------------------------------

def test_known_generic_titles_are_flagged():
    assert bc.is_too_generic_to_match("Giant")
    assert bc.is_too_generic_to_match("giant")
    assert bc.is_too_generic_to_match("  Perfect Match  ")


def test_ordinary_titles_are_not_flagged():
    assert not bc.is_too_generic_to_match("Mirzapur: The Movie")
    assert not bc.is_too_generic_to_match("Khalifa Part 1")
    assert not bc.is_too_generic_to_match("A Perfect Match")  # substring, not the exact title


def test_main_reports_candidates_without_writing(monkeypatch, capsys):
    class Cursor:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, query, params):
            assert query == bc.CANDIDATE_SQL
        def fetchall(self): return [(1, 'Unique Film', date(2026, 11, 13), 'Movie')]

    class Connection:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def cursor(self): return Cursor()

    def connect(dsn, *, options):
        assert options == '-c default_transaction_read_only=on'
        return Connection()

    monkeypatch.setattr(bc, 'load_local_env', lambda *_: None)
    monkeypatch.setattr(bc.psycopg, 'connect', connect)
    monkeypatch.setattr(bc, 'search', lambda *_args, **_kwargs: {'id': 12})
    monkeypatch.setattr(bc, 'rate_limit_gap', lambda *_: None)
    monkeypatch.setattr(sys, 'argv', ['backfill_calendar_tmdb.py'])
    monkeypatch.setenv('DATABASE_URL', 'unused')
    monkeypatch.setenv('TMDB_API_KEY', 'unused')
    assert bc.main() == 0
    assert 'possible movie:12' in capsys.readouterr().out
