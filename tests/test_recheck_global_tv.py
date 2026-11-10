import sys
import os
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import recheck_global_tv as tv
from lib_relations import TmdbUnavailable


def test_global_first_air_matches_only_and_never_writes_region(monkeypatch):
    monkeypatch.setattr(tv, 'rate_limit_gap', lambda *_: None)
    class Cursor:
        rowcount = 1
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, sql, args):
            if sql == tv.UPDATE:
                assert args[0].obj['region'] is None
                assert args[0].obj['date_source'] == 'tmdb_global_first_air'
                assert args[1] == 1
        def fetchall(self): return [(1, 11, '2026-11-10', 'tmdb_upcoming', 'Show'), (2, 12, '2026-11-10', 'tmdb_upcoming', 'Other')]
    class Conn:
        def cursor(self): return Cursor()
        def commit(self): self.committed = True
    conn = Conn()
    assert tv.run(conn, None, 'key', apply=True, fetch=lambda s, p, k: {'first_air_date': '2026-11-10' if p.endswith('/11') else '2026-11-11'}) == (2, 1, 1)
    assert conn.committed


def test_tv_upstream_failure_prevents_all_writes(monkeypatch):
    monkeypatch.setattr(tv, 'rate_limit_gap', lambda *_: None)
    class Cursor:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, sql, args): assert sql == tv.SELECT
        def fetchall(self): return [(1, 11, '2026-11-10', 'tmdb_upcoming', 'Show')]
    class Conn:
        def cursor(self): return Cursor()
        def commit(self): pytest.fail('must not commit')
    def fail(*args): raise TmdbUnavailable('unavailable')
    with pytest.raises(TmdbUnavailable): tv.run(Conn(), None, 'key', apply=True, fetch=fail)


@pytest.mark.skipif(not os.getenv('SPOTLIGHT_TEST_DATABASE_URL'), reason='requires disposable PostgreSQL')
def test_database_global_tv_excludes_editorial_identity_guesses(monkeypatch):
    import psycopg
    monkeypatch.setattr(tv, 'rate_limit_gap', lambda *_: None)
    future = date.today() + timedelta(days=1)
    with psycopg.connect(os.environ['SPOTLIGHT_TEST_DATABASE_URL'], client_encoding='UTF8') as conn:
        with conn.cursor() as cur:
            cur.execute('''CREATE TEMP TABLE calendar_entries (id bigint primary key, tmdb_id bigint,
                release_date date, origin text, entry_type text, media_type text, is_theatrical boolean,
                evidence jsonb, source_url text, title text)''')
            cur.execute("INSERT INTO calendar_entries VALUES (1,11,%s,'csv_seed','Show','tv',false,NULL,'https://example.org','Good Show'), (2,12,%s,'csv_seed','Show','tv',false,NULL,'https://example.org','Wrong Show')", (future, future))
        assert tv.run(conn, None, 'key', apply=True, fetch=lambda s, p, k: {'name':'Good Show','first_air_date':str(future)}) == (0, 0, 0)
        with conn.cursor() as cur:
            cur.execute('SELECT evidence FROM calendar_entries ORDER BY id')
            rows = cur.fetchall()
            assert rows[0][0] is None
            assert rows[1][0] is None
