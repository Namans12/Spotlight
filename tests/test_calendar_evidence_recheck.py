import os
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import recheck_calendar_evidence as recheck
from lib_relations import TmdbUnavailable


def test_only_exact_regional_dates_are_verified_and_requests_are_shared():
    calls = []
    def lookup(session, key, title_id, region, fallback):
        calls.append((title_id, region))
        return ('2026-11-10' if title_id == 1 else None, None, None)
    rows = [(1, 1, '2026-11-10'), (2, 1, '2026-11-11'), (3, 2, '2026-11-10')]
    verified = recheck.verified_candidates(rows, None, 'key', 'IN', lookup)
    assert len(verified) == 1 and verified[0][:3] == (1, 1, '2026-11-10')
    assert verified[0][3].endswith('+00:00')
    assert calls == [(1, 'IN'), (2, 'IN')]


def test_upstream_failure_stops_before_any_write(monkeypatch):
    class Cursor:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, sql, args): assert sql == recheck.SELECT_CANDIDATES
        def fetchall(self): return [(1, 1, '2026-11-10')]
    class Connection:
        def cursor(self): return Cursor()
        def commit(self): pytest.fail('must not write after failure')
    def fail(*args): raise TmdbUnavailable('offline')
    monkeypatch.setattr(recheck, 'verified_candidates', fail)
    with pytest.raises(TmdbUnavailable):
        recheck.run(Connection(), None, 'key', apply=True)


@pytest.mark.skipif(not os.getenv('SPOTLIGHT_TEST_DATABASE_URL'), reason='requires disposable PostgreSQL')
def test_database_recheck_skips_conflicts_and_is_idempotent(monkeypatch):
    import psycopg
    future = date.today() + timedelta(days=2)
    with psycopg.connect(os.environ['SPOTLIGHT_TEST_DATABASE_URL']) as conn:
        with conn.cursor() as cur:
            cur.execute('''CREATE TEMP TABLE calendar_entries (id bigint primary key, tmdb_id bigint,
                release_date date, origin text, entry_type text, media_type text, is_theatrical boolean,
                evidence jsonb, source_url text)''')
            for item_id, movie_id in [(1, 101), (2, 102), (3, 103), (4, 103)]:
                cur.execute('''INSERT INTO calendar_entries VALUES (%s,%s,%s,'tmdb_upcoming','Movie',
                    'movie',true,NULL,%s)''', (item_id, movie_id, future, f'https://www.themoviedb.org/movie/{movie_id}'))
            cur.execute("UPDATE calendar_entries SET evidence = '{\"region\":\"IN\",\"date_source\":\"tmdb_regional_theatrical\"}' WHERE id=4")
        def verified(rows, session, key, region):
            assert [r[0] for r in rows] == [1, 2]
            return [(1, 101, str(future), '2026-11-10T00:00:00+00:00')]
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
