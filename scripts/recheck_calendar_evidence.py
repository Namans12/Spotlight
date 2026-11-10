"""Recheck legacy TMDB theatrical rows without inferring dates or deleting rows.

Dry-run by default. --apply updates only still-unchanged, unverified rows after
the exact stored date is confirmed as the earliest theatrical date in region.
Rows already represented by a verified event are deliberately left untouched.
"""
from __future__ import annotations

import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

import psycopg
import requests
from psycopg.types.json import Jsonb

from lib_relations import TmdbUnavailable, load_local_env
from sync_calendar_tmdb import theatrical_window

ROOT = Path(__file__).resolve().parent.parent

SELECT_CANDIDATES = """
SELECT a.id, a.tmdb_id, a.release_date::text
FROM calendar_entries a
WHERE a.origin = 'tmdb_upcoming' AND a.entry_type = 'Movie'
  AND a.media_type = 'movie' AND a.is_theatrical = true
  AND a.evidence IS NULL AND a.tmdb_id IS NOT NULL
  AND a.source_url = 'https://www.themoviedb.org/movie/' || a.tmdb_id::text
  AND a.release_date >= CURRENT_DATE
  AND NOT EXISTS (SELECT 1 FROM calendar_entries b
    WHERE b.origin = 'tmdb_upcoming' AND b.tmdb_id = a.tmdb_id
      AND b.media_type = 'movie' AND b.release_date = a.release_date
      AND b.evidence->>'region' = %s
      AND b.evidence->>'date_source' = 'tmdb_regional_theatrical')
ORDER BY a.release_date, a.id LIMIT %s
"""

UPDATE_EVIDENCE = """
UPDATE calendar_entries a SET evidence = %s
WHERE a.id = %s AND a.tmdb_id = %s AND a.release_date = %s::date
  AND a.origin = 'tmdb_upcoming' AND a.entry_type = 'Movie'
  AND a.media_type = 'movie' AND a.is_theatrical = true AND a.evidence IS NULL
  AND a.source_url = 'https://www.themoviedb.org/movie/' || a.tmdb_id::text
  AND NOT EXISTS (SELECT 1 FROM calendar_entries b
    WHERE b.id <> a.id AND b.origin = 'tmdb_upcoming' AND b.tmdb_id = a.tmdb_id
      AND b.media_type = 'movie' AND b.release_date = a.release_date
      AND b.evidence->>'region' = %s
      AND b.evidence->>'date_source' = 'tmdb_regional_theatrical')
"""


def verified_candidates(rows, session, key, region, lookup=theatrical_window):
    """Fetch all observations before writing, and fail closed on upstream failure."""
    checked = {}
    verified = []
    for row_id, tmdb_id, stored_date in rows:
        if tmdb_id not in checked:
            found = lookup(session, key, tmdb_id, region, None)[0]
            checked[tmdb_id] = (found, datetime.now(timezone.utc).isoformat())
        if checked[tmdb_id][0] == str(stored_date):
            verified.append((row_id, tmdb_id, str(stored_date), checked[tmdb_id][1]))
    return verified


def run(conn, session, key, region='IN', limit=100, apply=False):
    with conn.cursor() as cur:
        cur.execute(SELECT_CANDIDATES, (region, limit))
        candidates = cur.fetchall()
    verified = verified_candidates(candidates, session, key, region)
    updated = 0
    if apply:
        with conn.cursor() as cur:
            for row_id, tmdb_id, stored_date, observed_at in verified:
                evidence = {'region': region, 'date_source': 'tmdb_regional_theatrical',
                            'date_precision': 'day', 'event_kind': 'theatrical',
                            'source_url': f'https://www.themoviedb.org/movie/{tmdb_id}',
                            'observed_at': observed_at}
                cur.execute(UPDATE_EVIDENCE, (Jsonb(evidence), row_id, tmdb_id, stored_date, region))
                updated += cur.rowcount
        conn.commit()
    return len(candidates), len(verified), updated


def main():
    load_local_env(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--region', default='IN')
    parser.add_argument('--limit', type=int, default=100)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    region = args.region.upper()
    if len(region) != 2 or not region.isascii() or not region.isalpha() or not 1 <= args.limit <= 200:
        parser.error('region must be a two-letter country code and limit must be 1–200')
    dsn, key = os.getenv('DATABASE_URL'), os.getenv('TMDB_API_KEY')
    if not dsn or not key:
        parser.error('DATABASE_URL and TMDB_API_KEY are required')
    try:
        with psycopg.connect(dsn) as conn:
            scanned, verified, updated = run(conn, requests.Session(), key, region, args.limit, args.apply)
    except TmdbUnavailable:
        print('TMDB unavailable; no evidence was written.')
        return 1
    print(f'{scanned} candidates checked; {verified} exact regional matches; {updated} rows updated')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
