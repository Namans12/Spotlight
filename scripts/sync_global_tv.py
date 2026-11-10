"""Discover global TV first-air dates; never infer a regional launch or provider."""
import argparse
import os
from datetime import date, datetime, timezone
from pathlib import Path

import psycopg
import requests
from psycopg.types.json import Jsonb

from lib_relations import TmdbUnavailable, load_local_env
from sync_calendar_tmdb import discover, month_ranges, MAX_PAGES_TV
from lib_py.event_identity import source_record_key

UPSERT = """
INSERT INTO calendar_entries
  (release_date,title,language,entry_type,is_theatrical,platform_or_distributor,
   details,source,source_url,origin,tmdb_id,media_type,poster_url,evidence,source_key)
VALUES (%(release_date)s,%(title)s,%(language)s,'Show',false,NULL,
        %(details)s,'TMDB',%(source_url)s,'tmdb_upcoming',%(tmdb_id)s,'tv',%(poster_url)s,%(evidence)s,%(source_key)s)
ON CONFLICT (origin,source_key) DO UPDATE SET
  evidence=EXCLUDED.evidence,
  poster_url=COALESCE(calendar_entries.poster_url,EXCLUDED.poster_url)
WHERE calendar_entries.tmdb_id=EXCLUDED.tmdb_id AND calendar_entries.media_type='tv'
  AND calendar_entries.release_date=EXCLUDED.release_date
"""


def collect(session, key, ranges, countries='IN|US|GB', fetch=discover):
    rows = []
    seen = set()
    for start, end in ranges:
        params = {'first_air_date.gte': start, 'first_air_date.lte': end,
                  'sort_by': 'popularity.desc', 'include_adult': 'false'}
        if countries:
            params['with_origin_country'] = countries
        shows = fetch(session, key, '/discover/tv', params, max_pages=MAX_PAGES_TV)
        print(f'{start[:7]}: {len(shows)} global candidates' + (' (page cap reached)' if len(shows) >= MAX_PAGES_TV * 20 else ''))
        for show in shows:
            tmdb_id, raw_date = show.get('id'), show.get('first_air_date')
            if not isinstance(tmdb_id, int) or isinstance(tmdb_id, bool) or tmdb_id <= 0:
                continue
            try:
                checked_date = date.fromisoformat(raw_date)
            except (TypeError, ValueError):
                continue
            if not date.fromisoformat(start) <= checked_date <= date.fromisoformat(end):
                continue
            identity = (tmdb_id, raw_date)
            if identity in seen:
                continue
            seen.add(identity)
            source_url = f'https://www.themoviedb.org/tv/{tmdb_id}'
            rows.append({'release_date': raw_date, 'title': show.get('name') or 'Untitled',
                         'language': show.get('original_language'), 'details': show.get('overview') or None,
                         'source_url': source_url, 'tmdb_id': tmdb_id,
                         'poster_url': f"https://image.tmdb.org/t/p/w342{show['poster_path']}" if show.get('poster_path') else None,
                         'source_key': source_record_key('global', 'tv', tmdb_id, 'first_air', raw_date),
                         'evidence': {'region': None, 'date_source': 'tmdb_global_first_air', 'event_kind': 'global_premiere',
                                      'date_precision': 'day', 'observed_at': datetime.now(timezone.utc).isoformat(), 'source_url': source_url}})
    return rows


def main():
    load_local_env(Path(__file__).resolve().parent.parent)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--months', type=int, default=6)
    parser.add_argument('--countries', default='IN,US,GB', help='Origin-country discovery filter, not release territory.')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.months <= 12:
        parser.error('months must be 1–12')
    dsn, key = os.getenv('DATABASE_URL'), os.getenv('TMDB_API_KEY')
    if not dsn or not key:
        parser.error('DATABASE_URL and TMDB_API_KEY are required')
    countries = '|'.join(c.strip().upper() for c in args.countries.split(',') if c.strip())
    try:
        rows = collect(requests.Session(), key, month_ranges(date.today(), args.months), countries)
    except TmdbUnavailable:
        print('TMDB unavailable; no rows written.')
        return 1
    if args.dry_run:
        print(f'{len(rows)} global first-air observations; no rows written')
        return 0
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(UPSERT, {**row, 'evidence': Jsonb(row['evidence'])})
        conn.commit()
    print(f'{len(rows)} global first-air observations processed')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
