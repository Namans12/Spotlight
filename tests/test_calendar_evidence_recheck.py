import os
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import recheck_calendar_evidence as recheck
from lib_relations import TmdbUnavailable


def test_only_exact_regional_dates_are_verified_and_requests_are_shared(monkeypatch):
    monkeypatch.setattr(recheck, 'rate_limit_gap', lambda *_: None)
    calls = []
    def lookup(session, path, key, params):
        calls.append(path)
        dates = [{'type': 2, 'release_date': '2026-11-10'}, {'type': 3, 'release_date': '2026-11-11'}] if path.endswith('/1') else []
        return {'release_dates': {'results': [{'iso_3166_1': 'IN', 'release_dates': dates}]}}
    rows = [(1, 1, '2026-11-10', 'tmdb_upcoming', 'A'), (2, 1, '2026-11-11', 'tmdb_upcoming', 'A'), (3, 2, '2026-11-10', 'tmdb_upcoming', 'B')]
    verified = recheck.verified_candidates(rows, None, 'key', 'IN', lookup)
    assert [v[0] for v in verified] == [1, 2]
    assert verified[0][3].endswith('+00:00')
    assert calls == ['/movie/1', '/movie/2']


def test_upstream_failure_stops_before_any_write(monkeypatch):
    class Cursor:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, sql, args): assert sql == recheck.SELECT_CANDIDATES
        def fetchall(self): return [(1, 1, '2026-11-10', 'tmdb_upcoming', 'A')]
    class Connection:
        def cursor(self): return Cursor()
        def commit(self): pytest.fail('must not write after failure')
    def fail(*args): raise TmdbUnavailable('offline')
    monkeypatch.setattr(recheck, 'verified_candidates', fail)
    with pytest.raises(TmdbUnavailable):
        recheck.run(Connection(), None, 'key', apply=True)


def test_external_movies_require_exact_title_and_regional_date(monkeypatch):
    monkeypatch.setattr(recheck, 'rate_limit_gap', lambda *_: None)
    rows = [(1, 11, '2026-11-10', 'wikipedia', 'Right Film'),
            (2, 12, '2026-11-10', 'district_in', 'Wrong Film'),
            (3, 13, '2026-11-10', 'csv_seed', 'Right Film')]
    def detail(_s, path, _k, _params):
        return {'title': 'Different Film' if path.endswith('/12') else 'Right Film', 'release_dates': {'results': [
            {'iso_3166_1': 'IN', 'release_dates': [{'type': 3, 'release_date': '2026-11-11' if path.endswith('/13') else '2026-11-10'}]}]}}
    result = recheck.verified_candidates(rows, None, 'key', 'IN', detail)
    assert [r[0] for r in result] == [1]


def test_regional_dates_ignore_invalid_foreign_and_non_theatrical():
    payload = {'release_dates': {'results': [
        {'iso_3166_1': 'IN', 'release_dates': [{'type': 3, 'release_date': '2026-11-10'},
          {'type': 2, 'release_date': '2026-11-12'}, {'type': 3, 'release_date': '2026-99-99'},
          {'type': 4, 'release_date': '2026-11-13'}]},
        {'iso_3166_1': 'US', 'release_dates': [{'type': 3, 'release_date': '2026-11-14'}]}]}}
    assert recheck.regional_theatrical_dates(payload, 'IN') == {'2026-11-10', '2026-11-12'}


def test_title_match_preserves_non_latin_identity():
    assert recheck.exact_title_match('東京物語', '東京物語')
    assert not recheck.exact_title_match('東京物語', '七人の侍')
    assert not recheck.exact_title_match('!!!', '???')


@pytest.mark.skipif(not os.getenv('SPOTLIGHT_TEST_DATABASE_URL'), reason='requires disposable PostgreSQL')
def test_database_recheck_skips_conflicts_and_is_idempotent(monkeypatch):
    import psycopg
    future = date.today() + timedelta(days=2)
    with psycopg.connect(os.environ['SPOTLIGHT_TEST_DATABASE_URL']) as conn:
        with conn.cursor() as cur:
            cur.execute('''CREATE TEMP TABLE calendar_entries (id bigint primary key, tmdb_id bigint,
                release_date date, origin text, entry_type text, media_type text, is_theatrical boolean,
                evidence jsonb, source_url text, title text)''')
            for item_id, movie_id in [(1, 101), (2, 102), (3, 103), (4, 103)]:
                cur.execute('''INSERT INTO calendar_entries VALUES (%s,%s,%s,'tmdb_upcoming','Movie',
                    'movie',true,NULL,%s,'A')''', (item_id, movie_id, future, f'https://www.themoviedb.org/movie/{movie_id}'))
            cur.execute("UPDATE calendar_entries SET evidence = '{\"region\":\"IN\",\"date_source\":\"tmdb_regional_theatrical\"}' WHERE id=4")
        def verified(rows, session, key, region):
            assert [r[0] for r in rows] == [1, 2]
            return [(1, 101, str(future), '2026-11-10T00:00:00+00:00', 'tmdb_upcoming', 'A')]
        monkeypatch.setattr(recheck, 'verified_candidates', verified)
        assert recheck.run(conn, None, 'key', apply=True) == (2, 1, 1)
        with conn.cursor() as cur:
            cur.execute('SELECT id, evidence FROM calendar_entries ORDER BY id')
            rows = cur.fetchall()
            assert rows[0][1]['region'] == 'IN'
            assert rows[0][1]['observed_at']
            assert rows[1][1] is None and rows[2][1] is None
        monkeypatch.setattr(recheck, 'verified_candidates', lambda rows, *args: [])
        assert recheck.run(conn, None, 'key', apply=True) == (1, 0, 0)
