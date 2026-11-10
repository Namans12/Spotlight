import sys
import os
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import sync_global_tv as sync
from lib_relations import TmdbUnavailable


def test_global_discovery_never_claims_country_or_provider_and_deduplicates():
    calls = []
    def fetch(_session, _key, path, params, max_pages):
        calls.append((path, params, max_pages))
        return [{'id': 12, 'name': 'Example', 'first_air_date': '2026-11-10'},
                {'id': 12, 'name': 'Example', 'first_air_date': '2026-11-10'},
                {'id': 13, 'name': 'Outside', 'first_air_date': '2026-12-01'},
                {'id': 14, 'name': 'Invalid', 'first_air_date': 'invalid'}]
    rows = sync.collect(None, 'key', [('2026-11-01', '2026-11-30')], fetch=fetch)
    assert len(rows) == 1
    assert rows[0]['evidence']['region'] is None
    assert rows[0]['evidence']['event_kind'] == 'global_premiere'
    assert 'provider_source' not in rows[0]['evidence']
    assert calls[0][1]['with_origin_country'] == 'IN|US|GB'


def test_discovery_failure_is_not_a_partial_result():
    def fail(*args, **kwargs): raise TmdbUnavailable('offline')
    with pytest.raises(TmdbUnavailable): sync.collect(None, 'key', [('2026-11-01', '2026-11-30')], fetch=fail)


@pytest.mark.skipif(not os.getenv('SPOTLIGHT_TEST_DATABASE_URL'), reason='requires disposable PostgreSQL')
def test_global_event_upsert_is_idempotent():
    import psycopg
    from psycopg.types.json import Jsonb
    rows = sync.collect(None, 'key', [('2026-11-01', '2026-11-30')],
                        fetch=lambda *a, **k: [{'id': 12, 'name': 'Example', 'first_air_date': '2026-11-10'}])
    with psycopg.connect(os.environ['SPOTLIGHT_TEST_DATABASE_URL'], client_encoding='UTF8') as conn:
        with conn.cursor() as cur:
            cur.execute('''CREATE TEMP TABLE calendar_entries (release_date date,title text,language text,
              entry_type text,is_theatrical boolean,platform_or_distributor text,details text,source text,
              source_url text,origin text,tmdb_id bigint,media_type text,poster_url text,evidence jsonb,
              source_key text, UNIQUE(origin,source_key))''')
            row = {**rows[0], 'evidence': Jsonb(rows[0]['evidence'])}
            cur.execute(sync.UPSERT, row)
            cur.execute(sync.UPSERT, row)
            cur.execute('SELECT count(*), min(evidence->>\'date_source\') FROM calendar_entries')
            assert cur.fetchone() == (1, 'tmdb_global_first_air')
