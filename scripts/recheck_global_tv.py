"""Recheck TMDB-origin first-air dates; they do not establish regional availability."""
import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

import psycopg
import requests
from psycopg.types.json import Jsonb

from lib_relations import TmdbUnavailable, load_local_env, tmdb_get, rate_limit_gap

SELECT = """SELECT id, tmdb_id, release_date::text, origin, title FROM calendar_entries
WHERE origin = 'tmdb_upcoming' AND entry_type='Show' AND media_type='tv'
  AND is_theatrical=false AND evidence IS NULL AND tmdb_id IS NOT NULL
  AND source_url='https://www.themoviedb.org/tv/' || tmdb_id::text
  AND release_date >= CURRENT_DATE ORDER BY release_date,id LIMIT %s"""
UPDATE = """UPDATE calendar_entries SET evidence=%s WHERE id=%s AND tmdb_id=%s
  AND release_date=%s::date AND origin=%s AND title=%s AND origin = 'tmdb_upcoming' AND entry_type='Show'
  AND media_type='tv' AND is_theatrical=false AND evidence IS NULL
  AND source_url='https://www.themoviedb.org/tv/' || tmdb_id::text"""


def run(conn, session, key, limit=200, apply=False, fetch=tmdb_get):
    with conn.cursor() as cur:
        cur.execute(SELECT, (limit,))
        rows = cur.fetchall()
    observations = {}
    matches = []
    for row_id, tmdb_id, stored_date, origin, title in rows:
        if origin != 'tmdb_upcoming':
            continue
        if tmdb_id not in observations:
            data = fetch(session, f'/tv/{tmdb_id}', key) or {}
            observations[tmdb_id] = (data, datetime.now(timezone.utc).isoformat())
            rate_limit_gap(0.15)
        data, checked = observations[tmdb_id]
        if data.get('first_air_date') == str(stored_date):
            matches.append((row_id, tmdb_id, str(stored_date), checked, origin, title))
    updated = 0
    if apply:
        with conn.cursor() as cur:
            for row_id, tmdb_id, stored_date, checked, origin, title in matches:
                evidence = {'region': None, 'date_source': 'tmdb_global_first_air',
                            'event_kind': 'global_premiere', 'date_precision': 'day',
                            'observed_at': checked, 'source_url': f'https://www.themoviedb.org/tv/{tmdb_id}'}
                cur.execute(UPDATE, (Jsonb(evidence), row_id, tmdb_id, stored_date, origin, title))
                updated += cur.rowcount
        conn.commit()
    return len(rows), len(matches), updated


def main():
    load_local_env(Path(__file__).resolve().parent.parent)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=200)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.limit <= 300:
        parser.error('limit must be 1–300')
    dsn, key = os.getenv('DATABASE_URL'), os.getenv('TMDB_API_KEY')
    if not dsn or not key:
        parser.error('DATABASE_URL and TMDB_API_KEY are required')
    try:
        with psycopg.connect(dsn) as conn:
            checked, matches, updated = run(conn, requests.Session(), key, args.limit, args.apply)
    except TmdbUnavailable:
        print('TMDB unavailable; no evidence was written.')
        return 1
    print(f'{checked} global TV candidates checked; {matches} matches; {updated} rows updated')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
