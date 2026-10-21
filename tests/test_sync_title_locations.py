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
    distance_km,
    neighbourhood_rows,
    to_rows,
    valid_qid,
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

MUMBAI = {"slug": "mumbai", "name": "Mumbai", "lat": 19.076, "lon": 72.8777}


def _nb(label, qid=None, sl=5, coord="Point(72.85 19.05)"):
    b = {
        "item": {"value": f"http://www.wikidata.org/entity/{qid or 'Q' + str(abs(hash(label)) % 10**7)}"},
        "label": {"value": label},
        "sl": {"value": str(sl)},
    }
    if coord:
        b["coord"] = {"value": coord}
    return b


def _names(rows):
    return [r[1] for r in rows]


def test_neighbourhoods_without_coordinates_are_skipped():
    rows = neighbourhood_rows([_nb("Bandra", "Q1", coord="Point(72.83 19.06)"), _nb("Nowhere", "Q2", coord=None)], MUMBAI)
    assert rows == [("mumbai", "Bandra", 19.06, 72.83)]


def test_neighbourhoods_without_an_english_label_are_skipped():
    assert neighbourhood_rows([_nb("Q12345", "Q12345")], MUMBAI) == []


def test_neighbourhoods_rank_by_sitelinks_then_label_then_qid_and_ignore_input_order():
    bindings = [
        _nb("Zeta", "Q3", sl=30),
        _nb("Alpha", "Q9", sl=5),
        _nb("Beta", "Q8", sl=5),
        _nb("Gamma", "Q1", sl=50),
    ]
    expected = ["Gamma", "Zeta", "Alpha", "Beta"]
    assert _names(neighbourhood_rows(bindings, MUMBAI)) == expected
    assert _names(neighbourhood_rows(list(reversed(bindings)), MUMBAI)) == expected


def test_the_cap_keeps_the_most_notable_and_has_no_minimum_threshold():
    bindings = [_nb(f"N{i:02d}", f"Q{i}", sl=i) for i in range(1, 41)]
    assert _names(neighbourhood_rows(bindings, MUMBAI, cap=25)) == [f"N{i:02d}" for i in range(40, 15, -1)]
    # a tiny city with one barely-linked area still gets it
    assert _names(neighbourhood_rows([_nb("Hamlet", "Q7", sl=1)], MUMBAI)) == ["Hamlet"]


def test_the_same_item_answering_under_several_classes_is_one_row():
    bindings = [_nb("Dadar", "Q5", sl=12), _nb("Dadar", "Q5", sl=12), _nb("Dadar", "Q5", sl=12)]
    assert len(neighbourhood_rows(bindings, MUMBAI)) == 1


def test_names_that_differ_only_by_case_collide_and_the_more_notable_item_wins():
    a = _nb("Bandra West", "Q1", sl=3, coord="Point(72.0 19.0)")
    b = _nb("Bandra west", "Q2", sl=9, coord="Point(72.1 19.1)")
    for order in ([a, b], [b, a]):
        assert neighbourhood_rows(order, MUMBAI) == [("mumbai", "Bandra west", 19.1, 72.1)]


def test_equal_notability_collisions_pick_the_lowest_qid_not_the_first_row():
    a = _nb("Marol", "Q20", sl=4, coord="Point(72.0 19.0)")
    b = _nb("MAROL", "Q10", sl=4, coord="Point(72.1 19.1)")
    assert neighbourhood_rows([a, b], MUMBAI) == neighbourhood_rows([b, a], MUMBAI)
    # ties in sitelinks break on the label (upper case sorts first), then QID
    assert _names(neighbourhood_rows([a, b], MUMBAI)) == ["MAROL"]


def test_labels_are_normalised():
    rows = neighbourhood_rows(
        [_nb("  Paschim Vihar..  ", "Q1"), _nb("Lower   Parel ", "Q2"), _nb("Chembur,", "Q3")], MUMBAI
    )
    assert sorted(_names(rows)) == ["Chembur", "Lower Parel", "Paschim Vihar"]


def test_the_city_itself_and_streets_are_not_neighbourhoods():
    bindings = [
        _nb("Mumbai", "Q1"),
        _nb("mumbai", "Q2"),
        _nb("Garstin Bastion Road", "Q3"),
        _nb("Janpath Marg", "Q4"),
        _nb("Fifth Avenue", "Q5"),
        _nb("Baker Street", "Q6"),
        _nb("Western Suburbs", "Q7"),
        _nb("Bandra", "Q8"),
        _nb("Roadside", "Q9"),
    ]
    assert sorted(_names(neighbourhood_rows(bindings, MUMBAI))) == ["Bandra", "Roadside"]


def test_points_far_from_the_city_are_rejected():
    near = _nb("Juhu", "Q1", coord="Point(72.83 19.1)")
    far = _nb("Pune-ish", "Q2", coord="Point(73.8567 18.5204)")  # ~120 km away
    assert _names(neighbourhood_rows([near, far], MUMBAI)) == ["Juhu"]


def test_distance_km_is_roughly_right():
    assert distance_km(19.076, 72.8777, 19.076, 72.8777) == pytest.approx(0, abs=1e-6)
    assert distance_km(19.076, 72.8777, 18.5204, 73.8567) == pytest.approx(120, abs=6)


def test_only_well_formed_qids_are_valid():
    assert valid_qid("Q123")
    assert not valid_qid("Q")
    assert not valid_qid("Q12 } DROP")
    assert not valid_qid("q12")
    assert not valid_qid("Q12\n")


def test_seed_qids_are_validated_on_load(tmp_path, monkeypatch):
    seed = tmp_path / "seed.json"
    seed.write_text('{"goa": ["Q4841379", "Q1 } SELECT", "nonsense"]}')
    monkeypatch.setattr(slt, "SEED_PATH", seed)
    assert slt.load_seed() == {"goa": ["Q4841379"]}


def test_a_missing_seed_file_means_no_seed(tmp_path, monkeypatch):
    monkeypatch.setattr(slt, "SEED_PATH", tmp_path / "nope.json")
    assert slt.load_seed() == {}


def test_neighbourhood_fetch_asks_one_query_per_class_plus_extras_and_the_seed(monkeypatch):
    queries: list[str] = []
    monkeypatch.setattr(slt, "wdqs", lambda session, q: queries.append(q) or [])
    monkeypatch.setattr(slt, "load_seed", lambda: {"goa": ["Q4841379"]})
    goa = next(c for c in slt.CITIES if c["slug"] == "goa")

    slt.fetch_neighbourhood_bindings(None, goa)

    classes = len(slt.NEIGHBOURHOOD_CLASSES) + len(slt.NEIGHBOURHOOD_EXTRA_CLASSES["goa"])
    assert len(queries) == classes + 1
    around = [q for q in queries if "wikibase:around" in q]
    assert len(around) == classes
    assert all(f"Point({goa['lon']} {goa['lat']})" in q for q in around)
    assert all('"45"' in q for q in around)
    assert "VALUES ?item { wd:Q4841379 }" in queries[-1]


# --------------------------------------------------------------------------- #
# The run: the production-safety guard, and what a failure does
# --------------------------------------------------------------------------- #


class FakeCursor:
    def __init__(self, existing_tables: set[str], stored_rows: list[tuple] | None = None, neighbourhoods_stored=False):
        self.existing_tables = existing_tables
        self.stored_rows = stored_rows or []
        self.neighbourhoods_stored = neighbourhoods_stored
        self.statements: list[str] = []
        self.calls: list[tuple[str, tuple]] = []
        self.inserted: list[tuple] = []
        self.nb_inserted: list[tuple] = []
        self._result: list[tuple] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        text = " ".join(sql.split())
        self.statements.append(text)
        self.calls.append((text, tuple(params)))
        if text.startswith("SELECT 1 FROM neighbourhoods"):
            self._result = [(1,)] if self.neighbourhoods_stored else []
        elif text.startswith("SELECT to_regclass"):
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
        if text.startswith("INSERT INTO neighbourhoods"):
            self.nb_inserted.extend(seq)

    def fetchone(self):
        return self._result[0] if self._result else None

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


# --------------------------------------------------------------------------- #
# Circuit breaker
# --------------------------------------------------------------------------- #


def test_breaker_opens_after_two_consecutive_failing_cities_and_a_success_resets_the_streak():
    b = slt.CircuitBreaker(limit=2)
    b.record_city({"wdqs"}, set())
    b.record_city(set(), {"wdqs"})  # a good city in between resets it
    b.record_city({"wdqs"}, set())
    assert not b.blocked("wdqs")
    b.record_city({"wdqs"}, set())
    assert b.blocked("wdqs") and not b.blocked("wikipedia")


def test_a_dead_source_is_skipped_for_the_remaining_cities(monkeypatch, capsys):
    cur = FakeCursor(set(slt.PULSE_TABLES))
    conn = FakeConn(cur)
    asked: list[str] = []

    def dead_wikipedia(session, city):
        asked.append(city["slug"])
        raise slt.SourceUnavailable("down", "wikipedia")

    _patch_sources(
        monkeypatch,
        wikipedia=dead_wikipedia,
        wikidata=lambda session, city: [(1, "movie", city["slug"], "filmed", "wikidata", None, None, None)],
    )

    assert slt.main(["--city", "delhi", "--city", "mumbai", "--city", "pune", "--city", "goa"], connect=lambda: conn) == 0

    # Wikipedia was tried for the first two cities only; Wikidata kept working
    # for all four and each city still wrote its Wikidata rows.
    assert asked == ["delhi", "mumbai"]
    assert {r[2] for r in cur.inserted} == {"delhi", "mumbai", "pune", "goa"}
    assert "wikipedia failed for 2 cities in a row" in capsys.readouterr().out


def test_a_dead_wdqs_stops_both_halves_after_two_cities(monkeypatch):
    cur = FakeCursor(set(slt.PULSE_TABLES))
    conn = FakeConn(cur)
    asked: list[tuple[str, str]] = []

    def dead(kind):
        def fetch(session, city):
            asked.append((kind, city["slug"]))
            raise slt.SourceUnavailable("timeout", "wdqs")

        return fetch

    _patch_sources(monkeypatch, wikipedia=dead("wp"), wikidata=dead("wd"))

    assert slt.main(["--city", "delhi", "--city", "mumbai", "--city", "pune"], connect=lambda: conn) == 1

    assert {slug for _, slug in asked} == {"delhi", "mumbai"}
    assert cur.inserted == []


# --------------------------------------------------------------------------- #
# An empty answer is not trusted over stored rows
# --------------------------------------------------------------------------- #

STORED_WP = (7, "movie", "delhi", "filmed", "wikipedia", None, None, None)
STORED_WD = (8, "movie", "delhi", "filmed", "wikidata", "Red Fort", 28.65, 77.24)


def test_a_source_returning_nothing_does_not_wipe_its_stored_rows(monkeypatch, capsys):
    cur = FakeCursor(set(slt.PULSE_TABLES), stored_rows=[STORED_WP, STORED_WD])
    conn = FakeConn(cur)
    fresh = (1, "movie", "delhi", "filmed", "wikidata", None, None, None)
    _patch_sources(monkeypatch, wikipedia=lambda s, c: [], wikidata=lambda s, c: [fresh])

    assert slt.main(["--city", "delhi"], connect=lambda: conn) == 0

    assert sorted(cur.inserted) == sorted([fresh, STORED_WP])
    assert "returned no rows but some are stored" in capsys.readouterr().out


def test_both_sources_empty_with_stored_rows_leaves_the_city_untouched(monkeypatch):
    cur = FakeCursor(set(slt.PULSE_TABLES), stored_rows=[STORED_WP, STORED_WD])
    conn = FakeConn(cur)
    _patch_sources(monkeypatch, wikipedia=lambda s, c: [], wikidata=lambda s, c: [])

    assert slt.main(["--city", "delhi"], connect=lambda: conn) == 1

    assert not any(text.startswith(("DELETE", "INSERT")) for text, _ in cur.calls)
    assert conn.commits == 0


def test_an_empty_source_with_nothing_stored_is_just_empty(monkeypatch):
    cur = FakeCursor(set(slt.PULSE_TABLES))
    conn = FakeConn(cur)
    _patch_sources(monkeypatch, wikipedia=lambda s, c: [], wikidata=lambda s, c: [])

    assert slt.main(["--city", "pune"], connect=lambda: conn) == 0

    assert conn.commits == 1
    assert cur.inserted == []


def test_an_empty_neighbourhood_answer_does_not_erase_stored_neighbourhoods(monkeypatch, capsys):
    cur = FakeCursor(set(slt.PULSE_TABLES), neighbourhoods_stored=True)
    conn = FakeConn(cur)
    monkeypatch.setattr(slt, "fetch_neighbourhood_bindings", lambda session, city: [])
    monkeypatch.setattr(slt, "rate_limit_gap", lambda s: None)

    assert slt.main(["--neighbourhoods", "--city", "goa"], connect=lambda: conn) == 1

    assert not any(text.startswith(("DELETE", "INSERT")) for text, _ in cur.calls)
    assert "keeping them" in capsys.readouterr().out


def test_neighbourhoods_are_replaced_per_city(monkeypatch):
    cur = FakeCursor(set(slt.PULSE_TABLES))
    conn = FakeConn(cur)
    monkeypatch.setattr(
        slt, "fetch_neighbourhood_bindings", lambda session, city: [_nb("Juhu", "Q1", coord="Point(72.83 19.1)")]
    )
    monkeypatch.setattr(slt, "rate_limit_gap", lambda s: None)

    assert slt.main(["--neighbourhoods", "--city", "mumbai"], connect=lambda: conn) == 0

    assert ("DELETE FROM neighbourhoods WHERE city_slug = %s", ("mumbai",)) in cur.calls
    assert cur.nb_inserted == [("mumbai", "Juhu", 19.1, 72.83)]


# --------------------------------------------------------------------------- #
# Writes are scoped to the city being synced
# --------------------------------------------------------------------------- #


def test_a_city_write_deletes_only_that_city_and_upserts_its_places(monkeypatch):
    cur = FakeCursor(set(slt.PULSE_TABLES))
    conn = FakeConn(cur)
    row = (1, "movie", "delhi", "filmed", "wikipedia", None, None, None)
    _patch_sources(monkeypatch, wikipedia=lambda s, c: [row], wikidata=lambda s, c: [])
    monkeypatch.setattr(slt, "fetch_place_names", lambda session: {"Q987": "New Delhi"})

    assert slt.main(["--city", "delhi"], connect=lambda: conn) == 0

    deletes = [(t, p) for t, p in cur.calls if t.startswith("DELETE")]
    assert deletes == [("DELETE FROM title_locations WHERE city_slug = %s", ("delhi",))]
    places = [p for t, p in cur.calls if t.startswith("INSERT INTO places")]
    # one row per QID, aliases included; the alias has its own label, the other
    # falls back to the city name when no label was fetched
    assert places == [("Q1353", "delhi", "Delhi"), ("Q987", "delhi", "New Delhi")]
    assert cur.inserted == [row]


# --------------------------------------------------------------------------- #
# QIDs from the network are checked before they reach query text
# --------------------------------------------------------------------------- #


def test_malformed_qids_never_reach_the_tmdb_query(monkeypatch):
    queries: list[str] = []
    monkeypatch.setattr(slt, "wdqs", lambda session, q: queries.append(q) or [])
    cache: dict = {}

    slt.tmdb_ids_for_qids(None, ["Q5", "Q6 } DELETE", "evil", "Q7"], cache)

    assert len(queries) == 1
    assert "wd:Q5 wd:Q7" in queries[0]
    assert "DELETE" not in queries[0] and "evil" not in queries[0]
    assert set(cache) == {"Q5", "Q7"}
