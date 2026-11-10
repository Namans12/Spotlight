"""title_matches: telling a wrong TMDB link apart from a season-suffixed one.

Found via this exact check: "Perfect Match" (our row) linked to a TMDB entry
also called "Perfect Match" whose overview is a Song Dynasty period drama —
title-string match, wrong film. Text similarity alone can't catch that (see
reconcile_calendar_duplicates.py's docstring for the general shape of this
problem); the caller does the overview-level judgment, this just decides
whether a title counts as "the same one" at the string level.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import verify_calendar_tmdb_links as v  # noqa: E402


def test_exact_title_matches():
    assert v.title_matches("Judaa", "Judaa", "movie")


def test_case_and_punctuation_folded():
    assert v.title_matches("Toxic: A Fairy Tale For Grown-ups", "Toxic: A Fairy Tale for Grown-ups", "movie")
    assert v.title_matches("EXAM", "Exam", "tv")


def test_season_suffix_stripped_for_tv_only():
    assert v.title_matches("The Glass House Season 1", "The Glass House", "tv")
    # The same stripping must NOT apply to movies — a film's own numbering
    # ("Part 1") is part of its real title, not a season suffix to discard.
    assert not v.title_matches("The Glass House Season 1", "The Glass House", "movie")


def test_genuinely_different_titles_do_not_match():
    assert not v.title_matches("Perfect Match", "The Journey of Flower", "tv")
    assert not v.title_matches("Disaem Gey Mam", "Disaster Guy", "tv")
    assert not v.title_matches("Giant", "Colossus", "movie")


def test_same_word_different_title_still_flagged_as_mismatch():
    """A shared title string ("Perfect Match") is exactly the case this
    function must still call a match — the wrongness lives in the overview,
    which is a human/caller judgment this function doesn't attempt."""
    assert v.title_matches("Perfect Match", "Perfect Match", "tv")


# --------------------------------------------------------------------------
# dates_agree — the signal that tells a TMDB rename apart from a wrong link
# once the title strings already disagree.
# --------------------------------------------------------------------------

def test_dates_agree_on_an_exact_match():
    """"Khalifa Part 1" -> "Khalifa: The Ruler": same tmdb_id, same date —
    TMDB renamed the record, the link itself was always correct."""
    assert v.dates_agree("2026-08-20", "2026-08-20")


def test_dates_disagree_flags_a_real_wrong_match():
    """"Giant" linked to an unrelated Ukrainian festival film: different date
    entirely, on top of the title mismatch — a real wrong link."""
    assert not v.dates_agree("2026-05-22", "2026-04-21")


def test_dates_agree_is_strict_not_tolerant():
    """One day off is not corroboration — that's what years_match's tolerance
    is for elsewhere; this check exists specifically because the title
    already failed to match, so a near-miss date proves nothing."""
    assert not v.dates_agree("2026-08-20", "2026-08-21")


def test_dates_agree_handles_missing_data_without_crashing():
    assert not v.dates_agree(None, "2026-08-20")
    assert not v.dates_agree("2026-08-20", None)
    assert not v.dates_agree(None, None)


# --------------------------------------------------------------------------
# LANGUAGE_OVERRIDES — a specific tmdb_id known to have wrong data on TMDB's
# side must not have a manual correction silently reverted on the next run.
# --------------------------------------------------------------------------

def test_language_override_wins_over_tmdbs_own_value():
    assert v.LANGUAGE_OVERRIDES.get(1649723) == "pa"


def test_ids_without_an_override_are_unaffected():
    assert v.LANGUAGE_OVERRIDES.get(999999999) is None


def test_verifier_reports_conflicts_without_mutating_rows(monkeypatch, capsys):
    statements = []
    class Cursor:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, sql): statements.append(sql)
        def fetchall(self): return [(1, 'Old Title', 'hi', 10, 'movie', '2026-11-10')]
    class Connection:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def cursor(self): return Cursor()
        def commit(self): raise AssertionError('must not commit')
    def connect(_dsn, **kwargs):
        assert 'default_transaction_read_only=on' in kwargs.get('options', '')
        return Connection()
    monkeypatch.setenv('DATABASE_URL', 'fixture')
    monkeypatch.setenv('TMDB_API_KEY', 'fixture')
    monkeypatch.setattr(v, 'load_local_env', lambda *_: None)
    monkeypatch.setattr(v.psycopg, 'connect', connect)
    monkeypatch.setattr(v, 'tmdb_request', lambda *_: {'title': 'Another Title', 'release_date': '2026-11-10', 'original_language': 'en'})
    monkeypatch.setattr(sys, 'argv', ['verify_calendar_tmdb_links.py'])
    assert v.main() == 0
    assert len(statements) == 1 and statements[0].lstrip().startswith('SELECT')
    assert 'no rows changed' in capsys.readouterr().out
