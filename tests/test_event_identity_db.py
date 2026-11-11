"""Opt-in PostgreSQL migration/ingestion test against a disposable database."""
import os
import sys
from pathlib import Path
import pytest

DSN = os.getenv('SPOTLIGHT_TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not DSN, reason='requires disposable PostgreSQL')
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))


def test_migration_and_writers_keep_distinct_events(monkeypatch, tmp_path):
    import psycopg
    import releasebot as rb
    import seed_calendar_csv as seed
    import sync_calendar_tmdb as tmdb
    import sync_theatrical_district as district
    import sync_theatrical_wikipedia as wiki
    import reconcile_calendar_duplicates as reconcile

    with psycopg.connect(DSN, client_encoding='UTF8') as conn:
        with conn.cursor() as cur:
            # Legacy Wikipedia imports asserted theatrical by default; the new
            # importer does not. That flag alone must not split a duplicate,
            # but an actual difference in evidence must remain distinct.
            cur.execute("""SELECT
                ('{"title":"Film","is_theatrical":true,"evidence":null}'::jsonb - 'is_theatrical') =
                ('{"title":"Film","is_theatrical":false,"evidence":null}'::jsonb - 'is_theatrical'),
                ('{"title":"Film","is_theatrical":true,"evidence":null}'::jsonb - 'is_theatrical') =
                ('{"title":"Film","is_theatrical":false,"evidence":{"region":"IN"}}'::jsonb - 'is_theatrical')""")
            assert cur.fetchone() == (True, False)
            cur.execute('''CREATE TEMP TABLE calendar_entries (
                id BIGSERIAL PRIMARY KEY, release_date DATE NOT NULL, title TEXT NOT NULL,
                language TEXT, entry_type TEXT NOT NULL, is_theatrical BOOLEAN NOT NULL DEFAULT false,
                platform_or_distributor TEXT, details TEXT, source TEXT, source_url TEXT,
                tmdb_id BIGINT, media_type TEXT, origin TEXT NOT NULL DEFAULT 'csv_seed',
                poster_url TEXT, origin_region TEXT, origin_release_date DATE, evidence JSONB,
                UNIQUE (release_date, title, entry_type))''')
            cur.execute('''CREATE TEMP TABLE release_items (
                tmdb_id BIGINT NOT NULL, media_type TEXT NOT NULL, title TEXT NOT NULL, language TEXT NOT NULL,
                release_date DATE, rating NUMERIC, popularity NUMERIC NOT NULL, overview TEXT NOT NULL,
                tmdb_url TEXT NOT NULL, poster_url TEXT, providers TEXT[] NOT NULL, region TEXT NOT NULL,
                section TEXT NOT NULL, window_kind TEXT NOT NULL, window_start DATE NOT NULL,
                window_end DATE NOT NULL, generated_at TIMESTAMPTZ NOT NULL, evidence JSONB,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (tmdb_id,media_type,region,window_kind,section))''')
            cur.execute("INSERT INTO calendar_entries (release_date,title,entry_type,origin) VALUES ('2026-11-09','Same','Movie','csv_seed')")
            cur.execute("""INSERT INTO release_items (tmdb_id,media_type,title,language,release_date,
                popularity,overview,tmdb_url,providers,region,section,window_kind,window_start,window_end,generated_at)
                VALUES (99,'movie','Legacy','en','2026-11-09',1,'','',ARRAY[]::text[],'US',
                'english','out_now','2026-11-09','2026-11-10',now())""")
            cur.execute((ROOT / 'migrations/0018_event_identity.sql').read_text(encoding='utf-8-sig'))
            base = dict(release_date='2026-11-09', title='Same', language='en', entry_type='Movie', is_theatrical=True,
                        platform=None, details=None, source_url='https://example.org/film', tmdb_id=1, media_type='movie',
                        poster_url=None, origin_region=None, origin_release_date=None, event_region='IN', source_key='tmdb-1')
            for row in (base, base, dict(base, tmdb_id=2, source_key='tmdb-2'), dict(base, event_region='US', source_key='tmdb-us')):
                cur.execute(tmdb.UPSERT_SQL, row); cur.fetchone()
            cur.execute("UPDATE calendar_entries SET tmdb_id=NULL, media_type=NULL WHERE source_key='tmdb-1'")
            cur.execute(tmdb.UPSERT_SQL, base)
            assert cur.fetchone() is None
            cur.execute("SELECT tmdb_id, media_type FROM calendar_entries WHERE source_key='tmdb-1'")
            assert cur.fetchone() == (None, None)
            cur.execute(tmdb.UPSERT_SQL, dict(base, tmdb_id=3, source_key='tmdb-2'))
            assert cur.fetchone() is None
            cur.execute("SELECT tmdb_id FROM calendar_entries WHERE source_key='tmdb-2'")
            assert cur.fetchone()[0] == 2
            cur.execute(tmdb.UPSERT_SQL, dict(base, event_region='IN', source_key='tmdb-us'))
            assert cur.fetchone() is None
            d = dict(base, source_key='district-1')
            for row in (d, d, dict(d, source_key='district-2')):
                cur.execute(district.UPSERT_SQL, row); cur.fetchone()
            w = dict(base, source_key='wiki-1')
            for row in (w, w, dict(w, source_key='wiki-2')):
                cur.execute(wiki.UPSERT_SQL, row); cur.fetchone()
            cur.execute("SELECT bool_or(is_theatrical) FROM calendar_entries WHERE origin='wikipedia'")
            assert cur.fetchone()[0] is False
            cur.execute('SELECT origin, count(*) FROM calendar_entries GROUP BY origin ORDER BY origin')
            assert dict(cur.fetchall()) == {'csv_seed': 1, 'district_in': 2, 'tmdb_upcoming': 3, 'wikipedia': 2}
            cur.execute("SELECT source_key FROM calendar_entries WHERE origin='csv_seed'")
            assert cur.fetchone()[0] is None

        class BorrowedConnection:
            def cursor(self): return conn.cursor()
            def commit(self): conn.commit()
            def close(self): pass
        csv_file = tmp_path / 'seed.csv'
        csv_file.write_text('date,title,language,type,platform_or_distributor,details,source,source_url\n'
                            '2026-11-09,Same,English,Movie,Studio,,Test,https://a\n'
                            '2026-11-09,Same,English,Movie,Studio,,Test,https://a\n'
                            '2026-11-09,Same,English,Movie,Studio,,Test,https://b\n', encoding='utf-8')
        monkeypatch.setattr(seed, 'CSV_PATH', csv_file)
        monkeypatch.setattr(seed, 'get_connection', lambda: BorrowedConnection())
        seed.main(); seed.main()
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM calendar_entries WHERE origin='csv_seed'")
            assert cur.fetchone()[0] == 4
            cur.execute('SELECT count(*) FROM calendar_entries')
            before = cur.fetchone()[0]

        class ReadOnlyConnection:
            def __enter__(self): return conn
            def __exit__(self, *args): return False
        monkeypatch.setattr(reconcile, 'load_local_env', lambda *_: None)
        monkeypatch.setattr(reconcile.psycopg, 'connect', lambda *_: ReadOnlyConnection())
        monkeypatch.setattr(sys, 'argv', ['reconcile_calendar_duplicates.py'])
        monkeypatch.setenv('DATABASE_URL', 'unused')
        assert reconcile.main() == 0
        with conn.cursor() as cur:
            cur.execute('SELECT count(*) FROM calendar_entries')
            assert cur.fetchone()[0] == before

        def release(day, season):
            return rb.ReleaseItem(7, 'Series', 'tv', 'en', day, None, 1, '', '', None, ('Netflix',), None, season)
        digest = {'region': 'IN', 'generated_at': '2026-11-09T12:00:00+05:30',
                  'out_now': {'start': '2026-11-09', 'end': '2026-11-10', 'sections': {'english': [release('2026-11-09', 1), release('2026-11-09', 2), release('2026-11-10', 1)]}},
                  'coming_up': {'start': '2026-11-11', 'end': '2026-11-17', 'sections': {}}}
        rb.write_release_items_to_db(digest, conn)
        rb.write_release_items_to_db(digest, conn)
        with conn.cursor() as cur:
            cur.execute('SELECT count(*), count(DISTINCT event_key) FROM release_items')
            assert cur.fetchone() == (4, 4)
            cur.execute("SELECT event_key FROM release_items WHERE tmdb_id=99")
            assert cur.fetchone()[0] == 'legacy'


def test_watch_order_reset_preserves_manual_and_suppression_data():
    import psycopg
    with psycopg.connect(DSN, client_encoding='UTF8', autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute('CREATE TEMP TABLE title_relations (source text, suppressed boolean)')
            cur.execute('CREATE TEMP TABLE title_relation_lookups (id integer)')
            cur.execute('CREATE TEMP TABLE user_relation_suppressions (id integer)')
            cur.execute("INSERT INTO title_relations VALUES ('tmdb',false),('tmdb',true),('wikidata',false),('seed',false)")
            cur.execute('INSERT INTO title_relation_lookups VALUES (1)')
            cur.execute('INSERT INTO user_relation_suppressions VALUES (1)')
            cur.execute((ROOT / 'migrations/0019_rebuild_unverified_relations.sql').read_text(encoding='utf-8-sig'))
            cur.execute('SELECT source, suppressed FROM title_relations ORDER BY source')
            assert cur.fetchall() == [('seed', False), ('tmdb', True)]
            cur.execute('SELECT count(*) FROM title_relation_lookups')
            assert cur.fetchone()[0] == 0
            cur.execute('SELECT count(*) FROM user_relation_suppressions')
            assert cur.fetchone()[0] == 1
