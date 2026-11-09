"""Parsing rules for district.in's structured "upcoming movies" page.

Ameer Log, Brahmakamala, Bhagyashaali and five others were entirely missing
from the calendar for one representative Friday because TMDB has no typed
theatrical record for most small regional Indian releases. These tests target
the extraction logic against fixtures shaped like the real page — the two
verified failure modes are a page layout change (silent zero results) and a
language name not in the map (silently mis-language a title) — both must fail
loud, not quiet.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import sync_theatrical_district as d  # noqa: E402


def make_next_data(records: list[dict]) -> dict:
    """A trimmed but structurally real Next.js payload shape."""
    return {
        "props": {
            "pageProps": {
                "data": {
                    "serverState": {
                        "EDSResponse": {
                            "rails": [{"items": [{"ItemDetails": {"MovieData": r}} for r in records]}]
                        }
                    }
                }
            }
        }
    }


def make_html(records: list[dict], item_list: list[tuple[str, str]]) -> str:
    """item_list: [(movie_id, url), ...] — the JSON-LD ItemList block."""
    ld_items = ",".join(
        f'{{"@type":"ListItem","position":{i+1},'
        f'"item":{{"@type":"Movie","url":"{url}","name":"x"}}}}'
        for i, (_, url) in enumerate(item_list)
    )
    next_data = json.dumps(make_next_data(records))
    return (
        f'<script type="application/ld+json">{{"@type":"ItemList","itemListElement":[{ld_items}]}}</script>'
        f'<script id="__NEXT_DATA__" type="application/json">{next_data}</script>'
    )


BRAHMAKAMALA = {
    "movie_id": "230759",
    "name": "Brahmakamala",
    "image": "https://cdn.district.in/x.jpg",
    "movie_variants": [{"language": "Kannada"}],
    "release_date": "1787270400",  # 2026-08-21T00:00:00Z
    "reason_to_watch": "A gripping family drama",
}


# --------------------------------------------------------------------------
# parse_next_data / item_list_urls — must survive real page structure
# --------------------------------------------------------------------------

def test_parse_next_data_extracts_the_json_payload():
    html = make_html([BRAHMAKAMALA], [("230759", "https://www.district.in/movies/brahmakamala-MV230759")])
    data = d.parse_next_data(html)
    assert data is not None
    assert d.extract_movies(data)[0]["name"] == "Brahmakamala"


def test_parse_next_data_returns_none_on_layout_change():
    """A page with no __NEXT_DATA__ script must fail loud (None), not
    silently succeed with zero movies indistinguishable from a slow week."""
    assert d.parse_next_data("<html><body>no next data here</body></html>") is None


def test_item_list_urls_maps_movie_id_to_its_real_url():
    html = make_html([BRAHMAKAMALA], [("230759", "https://www.district.in/movies/brahmakamala-MV230759")])
    urls = d.item_list_urls(html)
    assert urls == {"230759": "https://www.district.in/movies/brahmakamala-MV230759"}


def test_item_list_urls_empty_when_block_absent():
    assert d.item_list_urls("<html>no json-ld here</html>") == {}


# --------------------------------------------------------------------------
# extract_movies — walks the whole tree, not a hardcoded path
# --------------------------------------------------------------------------

def test_extract_movies_finds_records_regardless_of_nesting_depth():
    data = make_next_data([BRAHMAKAMALA, {"movie_id": "1", "name": "Other Film", "release_date": "1787270400"}])
    got = d.extract_movies(data)
    assert {r["name"] for r in got} == {"Brahmakamala", "Other Film"}


def test_extract_movies_deduplicates_by_movie_id():
    """The same film can appear in more than one rail on one page."""
    data = make_next_data([BRAHMAKAMALA, dict(BRAHMAKAMALA)])
    assert len(d.extract_movies(data)) == 1


def test_extract_movies_ignores_non_movie_dicts():
    data = {"some_id": "123", "unrelated": {"movie_id": "x"}}  # no "name" alongside movie_id
    assert d.extract_movies(data) == []


# --------------------------------------------------------------------------
# parse_release_date — epoch seconds -> ISO date
# --------------------------------------------------------------------------

def test_parse_release_date_decodes_epoch_seconds():
    assert d.parse_release_date("1787270400") == "2026-08-21"


def test_parse_release_date_rejects_garbage():
    for bad in (None, "", "not-a-number", [], {}):
        assert d.parse_release_date(bad) is None


# --------------------------------------------------------------------------
# primary_language — must satisfy migration 0009's ISO-only CHECK constraint
# --------------------------------------------------------------------------

def test_primary_language_maps_known_names():
    assert d.primary_language({"movie_variants": [{"language": "Kannada"}]}) == "kn"
    assert d.primary_language({"movie_variants": [{"language": "Tamil"}]}) == "ta"


def test_primary_language_takes_the_first_variant_for_dubbed_releases():
    multi = {"movie_variants": [{"language": "Gujarati"}, {"language": "Hindi"}]}
    assert d.primary_language(multi) == "gu"


def test_primary_language_none_for_unmapped_or_missing():
    """A wrong language would violate migration 0009's ISO CHECK constraint if
    ever guessed wrong — None (skip) is correct, a fabricated code is not."""
    assert d.primary_language({"movie_variants": [{"language": "Klingon"}]}) is None
    assert d.primary_language({"movie_variants": []}) is None
    assert d.primary_language({}) is None


# --------------------------------------------------------------------------
# build_row — end to end for one record
# --------------------------------------------------------------------------

def test_build_row_produces_a_complete_row():
    row = d.build_row(BRAHMAKAMALA, "https://www.district.in/movies/brahmakamala-MV230759")
    assert row == {
        "release_date": "2026-08-21",
        "title": "Brahmakamala",
        "language": "kn",
        "details": "A gripping family drama",
        "source_url": "https://www.district.in/movies/brahmakamala-MV230759",
        "poster_url": "https://cdn.district.in/x.jpg",
    }


def test_build_row_none_without_a_usable_date():
    assert d.build_row({"name": "X", "release_date": None}, None) is None


def test_build_row_none_without_a_title():
    assert d.build_row({"name": "", "release_date": "1787270400"}, None) is None


def test_build_row_source_url_is_none_when_not_in_item_list():
    """A wrong guessed URL is worse than no URL at all."""
    row = d.build_row(BRAHMAKAMALA, None)
    assert row["source_url"] is None


def test_different_district_movie_ids_get_distinct_source_keys(monkeypatch):
    records = [dict(BRAHMAKAMALA, movie_id='1'), dict(BRAHMAKAMALA, movie_id='2')]
    monkeypatch.setattr(d, 'fetch_page', lambda *_: make_html(records, []))
    rows = d.collect(object(), ['hyderabad'])
    assert len(rows) == 2
    assert rows[0]['source_key'] != rows[1]['source_key']


def test_same_district_movie_id_with_different_dates_stays_distinct():
    two_dates = [BRAHMAKAMALA, dict(BRAHMAKAMALA, release_date='1787356800')]
    assert len(d.extract_movies(make_next_data(two_dates))) == 2
