"""theatrical_window: choosing a displayed date and, when relevant, an origin
date to show alongside it. Uses a fake session so no TMDB call happens."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import sync_calendar_tmdb as sync  # noqa: E402


class FakeResponse:
    def __init__(self, payload):
        self.status_code = 200
        self._payload = payload

    def json(self):
        return self._payload


class FakeSession:
    """Stands in for requests.Session: tmdb_get calls session.get(...)."""

    def __init__(self, payload):
        self._payload = payload

    def get(self, url, params=None, timeout=None):
        return FakeResponse(self._payload)


def release_dates(production_country=None, **by_country):
    """by_country: {"IN": ["2026-08-21"], "US": ["2026-07-23"]} -> TMDB shape.
    Each date is recorded as a type-3 (theatrical) release. production_country
    defaults to the first key passed, matching the common case where the
    production country is also the one with a recorded date."""
    countries = list(by_country)
    prod = production_country if production_country is not None else (countries[0] if countries else None)
    return {
        "release_dates": {
            "results": [
                {
                    "iso_3166_1": cc,
                    "release_dates": [{"type": 3, "release_date": f"{d}T00:00:00.000Z"} for d in dates],
                }
                for cc, dates in by_country.items()
            ]
        },
        "production_countries": [{"iso_3166_1": prod}] if prod else [],
    }


def window(payload, region="IN", fallback=None):
    return sync.theatrical_window(FakeSession(payload), "key", 1, region, fallback)


def test_india_date_used_when_it_matches_the_production_countrys_date():
    """A same-day worldwide release — nothing to put in parentheses."""
    got = window(release_dates(production_country="US", IN=["2026-08-21"], US=["2026-08-21"]))
    assert got == ("2026-08-21", None, None)


def test_foreign_origin_shown_when_india_lags_behind():
    """A US film that opens weeks before its India release."""
    got = window(release_dates(production_country="US", US=["2026-07-23"], IN=["2026-08-21"]))
    assert got == ("2026-08-21", "US", "2026-07-23")


def test_india_is_itself_the_origin_no_bracket():
    """A regional Indian film — India IS the production country."""
    got = window(release_dates(production_country="IN", IN=["2026-08-21"]))
    assert got == ("2026-08-21", None, None)


def test_a_faster_foreign_rollout_is_not_mistaken_for_the_origin():
    """The exact bug this design avoids: a US film's distributor opens France
    a day early, but the origin is still the US, not France."""
    got = window(release_dates(production_country="US", FR=["2026-08-19"], US=["2026-08-21"], IN=["2026-08-25"]))
    assert got == ("2026-08-25", "US", "2026-08-21"), "France must never appear as the origin"


def test_foreign_origin_is_not_an_india_date():
    """Nothing to show in parentheses when the shown date IS the origin date."""
    got = window(release_dates(production_country="US", US=["2026-07-23"], GB=["2026-07-30"]))
    assert got == (None, None, None)


def test_other_foreign_date_is_not_an_india_date():
    """The production country itself has nothing recorded, but another
    territory does — showing that beats showing nothing."""
    got = window(release_dates(production_country="US", GB=["2026-07-30"]))
    assert got == (None, None, None)


def test_missing_release_dates_do_not_use_discover_fallback():
    """A detail-call data gap must not drop a movie discover already found."""
    got = window({"release_dates": {"results": []}, "production_countries": []}, fallback="2026-08-21")
    assert got == (None, None, None)


def test_no_data_and_no_fallback_yields_nothing():
    got = window({"release_dates": {"results": []}, "production_countries": []})
    assert got == (None, None, None)


def test_multiple_dates_in_one_country_the_earliest_is_used():
    got = window(release_dates(production_country="IN", IN=["2026-08-25", "2026-08-21"]))
    assert got == ("2026-08-21", None, None)


def test_type_1_premiere_dates_are_ignored():
    """A festival premiere (type 1) is not a theatrical release."""
    payload = {
        "release_dates": {
            "results": [
                {"iso_3166_1": "US", "release_dates": [{"type": 1, "release_date": "2026-01-01T00:00:00.000Z"}]},
                {"iso_3166_1": "IN", "release_dates": [{"type": 3, "release_date": "2026-08-21T00:00:00.000Z"}]},
            ]
        },
        "production_countries": [{"iso_3166_1": "US"}],
    }
    got = window(payload)
    assert got == ("2026-08-21", None, None), "the type-1 US date must not become the origin"


def test_missing_production_countries_field_never_crashes():
    got = window(release_dates(production_country=None, IN=["2026-08-21"]))
    assert got == ("2026-08-21", None, None)
