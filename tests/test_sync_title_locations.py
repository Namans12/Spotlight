"""Filming-location sync: the parts that decide what ends up in title_locations.

Wikidata is not trustworthy by default (see the docstring of
sync_relations_wikidata.py: ~17% of its edges were wrong in a spot check), so
what these pin down is the discipline around it: only rows that map to a real
TMDB id survive, the two sources are reconciled instead of double-counted, a
known bulk-import artefact is dropped, and the nightly run can never fail or
write on a database that has not had migration 0016 applied. Everything runs
against fakes; there is no network and no database.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import sync_title_locations as slt  # noqa: E402
from sync_title_locations import (  # noqa: E402
    article_members,
    article_titles,
    carry_over,
    city_for_qid,
    drop_suspect,
    merge_rows,
    neighbourhood_rows,
    to_rows,
    wikidata_rows,
)


# --------------------------------------------------------------------------- #
# Pure functions
# --------------------------------------------------------------------------- #


def test_same_title_from_both_sources_becomes_both():
    wd = [(1, "movie", "delhi", "filmed", "wikidata", "Chandni Chowk", 28.65, 77.23)]
    wp = [(1, "movie", "delhi", "filmed", "wikipedia", None, None, None)]
    assert merge_rows(wd, wp) == [(1, "movie", "delhi", "filmed", "both", "Chandni Chowk", 28.65, 77.23)]


def test_single_source_keeps_its_own_source():
    wd = [(1, "movie", "delhi", "filmed", "wikidata", None, None, None)]
    wp = [(2, "tv", "delhi", "set", "wikipedia", None, None, None)]
    assert merge_rows(wd, wp) == [
        (1, "movie", "delhi", "filmed", "wikidata", None, None, None),
        (2, "tv", "delhi", "set", "wikipedia", None, None, None),
    ]


def test_filmed_and_set_are_separate_claims():
    wd = [(1, "movie", "delhi", "filmed", "wikidata", None, None, None)]
    wp = [(1, "movie", "delhi", "set", "wikipedia", None, None, None)]
    out = merge_rows(wd, wp)
    assert {(r[3], r[4]) for r in out} == {("filmed", "wikidata"), ("set", "wikipedia")}


def test_duplicate_wikidata_rows_collapse_to_one_with_a_deterministic_landmark():
    # A film with several filming locations inside the city yields several
    # rows for one primary key; the table can hold only one landmark, and the
    # choice must not depend on the order WDQS happened to answer in.
    a = (1, "movie", "delhi", "filmed", "wikidata", "Red Fort", 28.65, 77.24)
    b = (1, "movie", "delhi", "filmed", "wikidata", "India Gate", 28.61, 77.23)
    c = (1, "movie", "delhi", "filmed", "wikidata", None, None, None)
    expected = [(1, "movie", "delhi", "filmed", "wikidata", "India Gate", 28.61, 77.23)]
    assert merge_rows([a, b, c], []) == expected
    assert merge_rows([c, b, a], []) == expected


def test_new_delhi_rolls_up_to_delhi():
    assert city_for_qid("Q987") == "delhi"
    assert city_for_qid("Q1353") == "delhi"


def test_unknown_qid_has_no_city():
    assert city_for_qid("Q42") is None


def test_rows_without_tmdb_id_are_dropped():
    assert to_rows([{"qid": "Q1", "tmdb_movie": None, "tmdb_tv": None}], "delhi", "filmed", "wikipedia") == []


def test_to_rows_maps_movie_and_tv_ids_and_ignores_non_numeric_ids():
    items = [
        {"qid": "Q1", "tmdb_movie": "12", "tmdb_tv": None},
        {"qid": "Q2", "tmdb_movie": None, "tmdb_tv": "34"},
        {"qid": "Q3", "tmdb_movie": "not-a-number", "tmdb_tv": None},
    ]
    assert to_rows(items, "mumbai", "set", "wikipedia") == [
        (12, "movie", "mumbai", "set", "wikipedia", None, None, None),
        (34, "tv", "mumbai", "set", "wikipedia", None, None, None),
    ]


def test_ooty_bulk_import_is_ignored():
    rows = [(5, "movie", "ooty", "filmed", "wikidata", None, None, None)]
    assert drop_suspect(rows) == []


def test_drop_suspect_keeps_launch_cities():
    rows = [(5, "movie", "delhi", "filmed", "wikidata", None, None, None)]
    assert drop_suspect(rows) == rows


def test_subcategories_are_not_recursed():
    # categorymembers returns ns=14 (subcategory) and ns=0 (article); only ns=0 survive
    assert article_titles([{"ns": 14, "title": "Category:Indian Army in films"}, {"ns": 0, "title": "Rang De Basanti"}]) == ["Rang De Basanti"]


def test_article_members_keeps_the_page_props_of_articles_only():
    members = [
        {"ns": 14, "title": "Category:X", "pageprops": {"wikibase_item": "Q9"}},
        {"ns": 0, "title": "Delhi Belly", "pageprops": {"wikibase_item": "Q5"}},
    ]
    assert [m["title"] for m in article_members(members)] == ["Delhi Belly"]


# --------------------------------------------------------------------------- #
# Wikidata bindings -> rows
# --------------------------------------------------------------------------- #


def _binding(city="Q1353", loc="Q1353", label="Delhi", coord=None, tm=None, tv=None):
    b = {
        "city": {"value": f"http://www.wikidata.org/entity/{city}"},
        "loc": {"value": f"http://www.wikidata.org/entity/{loc}"},
        "locLabel": {"value": label},
    }
    if coord:
        b["coord"] = {"value": coord}
    if tm:
        b["tm"] = {"value": tm}
    if tv:
        b["tv"] = {"value": tv}
    return b


def test_filming_in_the_city_itself_has_no_landmark():
    rows = wikidata_rows([_binding(tm="7", coord="Point(77.2 28.6)")], "filmed")
    assert rows == [(7, "movie", "delhi", "filmed", "wikidata", None, None, None)]


def test_filming_inside_the_city_carries_the_landmark_and_its_coordinates():
    b = _binding(loc="Q500", label="Chandni Chowk", coord="Point(77.23 28.65)", tm="7")
    assert wikidata_rows([b], "filmed") == [
        (7, "movie", "delhi", "filmed", "wikidata", "Chandni Chowk", 28.65, 77.23)
    ]


def test_an_alias_of_the_city_is_not_a_landmark():
    b = _binding(city="Q1353", loc="Q987", label="New Delhi", coord="Point(77.2 28.6)", tv="9")
    assert wikidata_rows([b], "filmed") == [(9, "tv", "delhi", "filmed", "wikidata", None, None, None)]


def test_a_landmark_without_coordinates_or_an_english_label_is_not_kept():
    no_coord = _binding(loc="Q500", label="Chandni Chowk", tm="1")
    no_label = _binding(loc="Q501", label="Q501", coord="Point(77.1 28.1)", tm="2")
    assert wikidata_rows([no_coord, no_label], "filmed") == [
        (1, "movie", "delhi", "filmed", "wikidata", None, None, None),
        (2, "movie", "delhi", "filmed", "wikidata", None, None, None),
    ]


def test_set_rows_never_carry_a_landmark():
    b = _binding(loc="Q500", label="Chandni Chowk", coord="Point(77.23 28.65)", tm="7")
    assert wikidata_rows([b], "set") == [(7, "movie", "delhi", "set", "wikidata", None, None, None)]


def test_bindings_for_a_qid_that_is_not_a_launch_city_are_dropped():
    assert wikidata_rows([_binding(city="Q42", tm="1")], "filmed") == []


def test_a_suspect_filming_location_is_dropped():
    b = _binding(loc=slt.OOTY_QID, label="Ooty", coord="Point(76.7 11.4)", tm="3")
    assert wikidata_rows([b], "filmed") == []


# --------------------------------------------------------------------------- #
# A half that could not be fetched must not wipe what is already stored
# --------------------------------------------------------------------------- #


def test_carry_over_relabels_stored_rows_as_the_missing_source():
    stored = [
        (1, "movie", "delhi", "filmed", "both", "Red Fort", 28.65, 77.24),
        (2, "movie", "delhi", "filmed", "wikipedia", None, None, None),
        (3, "movie", "delhi", "filmed", "wikidata", None, None, None),
    ]
    assert carry_over(stored, "wikidata") == [
        (1, "movie", "delhi", "filmed", "wikidata", "Red Fort", 28.65, 77.24),
        (3, "movie", "delhi", "filmed", "wikidata", None, None, None),
    ]
    assert carry_over(stored, "wikipedia") == [
        (1, "movie", "delhi", "filmed", "wikipedia", None, None, None),
        (2, "movie", "delhi", "filmed", "wikipedia", None, None, None),
    ]


# --------------------------------------------------------------------------- #
# Neighbourhoods
# --------------------------------------------------------------------------- #


def _nb(label, coord="Point(77.1 28.1)"):
    b = {"itemLabel": {"value": label}}
    if coord:
        b["coord"] = {"value": coord}
    return b


def test_neighbourhoods_without_coordinates_are_skipped():
    rows = neighbourhood_rows([_nb("Bandra", "Point(72.83 19.06)"), _nb("Nowhere", None)], "mumbai")
    assert rows == [("mumbai", "Bandra", 19.06, 72.83)]


def test_neighbourhoods_without_an_english_label_are_skipped():
    assert neighbourhood_rows([_nb("Q12345")], "mumbai") == []


def test_neighbourhoods_are_deduplicated_sorted_by_label_and_capped():
    bindings = [_nb(f"N{i:02d}") for i in range(40, 0, -1)] + [_nb("N05")]
    rows = neighbourhood_rows(bindings, "pune", cap=25)
    assert [r[1] for r in rows] == [f"N{i:02d}" for i in range(1, 26)]


# --------------------------------------------------------------------------- #
# The run: the production-safety guard, and what a failure does
# --------------------------------------------------------------------------- #


class FakeCursor:
    def __init__(self, existing_tables: set[str], stored_rows: list[tuple] | None = None):
        self.existing_tables = existing_tables
        self.stored_rows = stored_rows or []
        self.statements: list[str] = []
        self.inserted: list[tuple] = []
        self._result: list[tuple] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        text = " ".join(sql.split())
        self.statements.append(text)
        if text.startswith("SELECT to_regclass"):
            name = params[0]
            self._result = [(name,)] if name.split(".")[-1] in self.existing_tables else [(None,)]
        elif text.startswith("SELECT tmdb_id"):
            self._result = list(self.stored_rows)
        else:
            self._result = []

    def executemany(self, sql, seq):
        text = " ".join(sql.split())
        self.statements.append(text)
        if text.startswith("INSERT INTO title_locations"):
            self.inserted.extend(seq)

    def fetchone(self):
        return self._result[0]

    def fetchall(self):
        return self._result


class FakeConn:
    def __init__(self, cursor: FakeCursor):
        self._cursor = cursor
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


def _no_network(monkeypatch):
    def boom(*a, **k):  # pragma: no cover - only reached if the guard fails
        raise AssertionError("the guard must run before any network call")

    for name in ("fetch_wikipedia_rows", "fetch_wikidata_rows", "fetch_place_names", "fetch_neighbourhood_bindings"):
        monkeypatch.setattr(slt, name, boom)


def test_missing_tables_are_reported():
    cur = FakeCursor({"places"})
    assert slt.missing_tables(cur) == ["title_locations", "neighbourhoods"]


@pytest.mark.parametrize("argv", [[], ["--neighbourhoods"]])
def test_run_without_the_pulse_tables_prints_one_line_and_writes_nothing(monkeypatch, capsys, argv):
    # Production does not have migration 0016, and the nightly workflow points
    # at production. The step must be a harmless no-op there, never an error.
    _no_network(monkeypatch)
    cur = FakeCursor(set())
    conn = FakeConn(cur)

    assert slt.main(argv, connect=lambda: conn) == 0

    out = capsys.readouterr().out.strip().splitlines()
    assert len(out) == 1
    assert "title_locations" in out[0] and "skipping" in out[0].lower()
    writes = [s for s in cur.statements if not s.startswith("SELECT")]
    assert writes == []
    assert conn.commits == 0


def test_run_with_only_some_tables_still_skips(monkeypatch, capsys):
    _no_network(monkeypatch)
    cur = FakeCursor({"places", "title_locations"})
    assert slt.main([], connect=lambda: FakeConn(cur)) == 0
    assert [s for s in cur.statements if not s.startswith("SELECT")] == []
    assert "neighbourhoods" in capsys.readouterr().out


def _patch_sources(monkeypatch, wikipedia, wikidata):
    monkeypatch.setattr(slt, "fetch_place_names", lambda session: {})
    monkeypatch.setattr(slt, "fetch_wikipedia_rows", wikipedia)
    monkeypatch.setattr(slt, "fetch_wikidata_rows", wikidata)
    monkeypatch.setattr(slt, "rate_limit_gap", lambda s: None)


def _unavailable(*a, **k):
    raise slt.SourceUnavailable("down")


def test_one_failed_half_does_not_stop_the_other_and_keeps_stored_rows(monkeypatch):
    stored = [(9, "movie", "delhi", "filmed", "wikidata", "Red Fort", 28.65, 77.24)]
    cur = FakeCursor(set(slt.PULSE_TABLES), stored_rows=stored)
    conn = FakeConn(cur)
    wp_row = (1, "movie", "delhi", "filmed", "wikipedia", None, None, None)
    _patch_sources(
        monkeypatch,
        wikipedia=lambda session, city: [wp_row] if city["slug"] == "delhi" else [],
        wikidata=_unavailable,
    )

    assert slt.main(["--city", "delhi"], connect=lambda: conn) == 0

    # Wikipedia's fresh row is written, and the Wikidata row stored from an
    # earlier run survives the delete + insert instead of being wiped by an
    # outage.
    assert sorted(cur.inserted) == sorted([wp_row, stored[0]])
    assert conn.commits == 1


def test_every_source_failing_writes_nothing_and_exits_non_zero(monkeypatch):
    cur = FakeCursor(set(slt.PULSE_TABLES))
    conn = FakeConn(cur)
    _patch_sources(monkeypatch, wikipedia=_unavailable, wikidata=_unavailable)

    assert slt.main([], connect=lambda: conn) == 1

    assert cur.inserted == []
    assert conn.commits == 0


def test_a_city_whose_write_fails_rolls_back_without_stopping_the_rest(monkeypatch):
    cur = FakeCursor(set(slt.PULSE_TABLES))
    real_executemany = cur.executemany

    def flaky(sql, seq):
        rows = list(seq)
        if rows and rows[0][2] == "mumbai":
            raise RuntimeError("deadlock")
        real_executemany(sql, rows)

    cur.executemany = flaky
    conn = FakeConn(cur)
    _patch_sources(
        monkeypatch,
        wikipedia=lambda session, city: [(1, "movie", city["slug"], "filmed", "wikipedia", None, None, None)],
        wikidata=lambda session, city: [],
    )

    assert slt.main(["--city", "delhi", "--city", "mumbai"], connect=lambda: conn) == 0

    assert [r[2] for r in cur.inserted] == ["delhi"]
    assert conn.rollbacks >= 1 and conn.commits == 1


def test_dry_run_never_opens_a_connection(monkeypatch, capsys):
    _patch_sources(
        monkeypatch,
        wikipedia=lambda session, city: [(1, "movie", city["slug"], "filmed", "wikipedia", None, None, None)],
        wikidata=lambda session, city: [],
    )

    def no_db():  # pragma: no cover
        raise AssertionError("dry run must not connect")

    assert slt.main(["--dry-run", "--city", "delhi"], connect=no_db) == 0
    assert "delhi" in capsys.readouterr().out


def test_wdqs_waits_out_a_429_and_then_succeeds(monkeypatch):
    calls = []

    def flaky(session, query):
        calls.append(query)
        if len(calls) == 1:
            raise slt.WikidataUnavailable("HTTP 429: ")
        return [{"ok": True}]

    sleeps: list[float] = []
    monkeypatch.setattr(slt, "run_sparql", flaky)
    monkeypatch.setattr(slt, "rate_limit_gap", sleeps.append)

    assert slt.wdqs(None, "SELECT 1") == [{"ok": True}]
    assert len(calls) == 2
    assert max(sleeps) >= slt.WDQS_THROTTLE_COOLDOWN_SECONDS


def test_wdqs_does_not_retry_a_timeout_beyond_run_sparqls_own_backoff(monkeypatch):
    def timeout(session, query):
        raise slt.WikidataUnavailable("read timed out")

    monkeypatch.setattr(slt, "run_sparql", timeout)
    monkeypatch.setattr(slt, "rate_limit_gap", lambda s: None)

    with pytest.raises(slt.SourceUnavailable):
        slt.wdqs(None, "SELECT 1")
