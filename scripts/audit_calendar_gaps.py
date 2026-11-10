"""Read-only, bounded diagnosis of calendar evidence recheck mismatches."""
import os
from collections import Counter
from pathlib import Path

import psycopg
import requests

from lib_relations import TmdbUnavailable, load_local_env, rate_limit_gap, tmdb_get
from recheck_calendar_evidence import SELECT_CANDIDATES, exact_title_match
from recheck_global_tv import SELECT as SELECT_TV


def movie_reason(payload, origin, title, stored_date, region):
    if not payload:
        return 'title_not_found'
    if origin != 'tmdb_upcoming' and not any(exact_title_match(title, n) for n in (payload.get('title'), payload.get('original_title')) if n):
        return 'title_mismatch'
    regions = (payload.get('release_dates') or {}).get('results') or []
    dates = [str(d['release_date'])[:10] for r in regions if r.get('iso_3166_1') == region
             for d in r.get('release_dates', []) if d.get('type') in (2, 3) and d.get('release_date')]
    if not dates:
        return 'no_regional_theatrical_date'
    return 'exact_match' if min(dates) == str(stored_date) else 'different_regional_date'


def tv_reason(payload, origin, title, stored_date):
    if not payload:
        return 'title_not_found'
    if origin != 'tmdb_upcoming' and not any(exact_title_match(title, n) for n in (payload.get('name'), payload.get('original_name')) if n):
        return 'title_mismatch'
    found = payload.get('first_air_date')
    if not found:
        return 'no_global_first_air_date'
    return 'exact_match' if found == str(stored_date) else 'different_global_first_air_date'


def audit(conn, session, key, region='IN', limit=200, fetch=tmdb_get):
    with conn.cursor() as cur:
        cur.execute(SELECT_CANDIDATES, (region, limit))
        movies = cur.fetchall()
        cur.execute(SELECT_TV, (limit,))
        tvs = cur.fetchall()
    counts = Counter()
    cache = {}
    for category, rows in [('movie', movies), ('tv', tvs)]:
        for _row_id, tmdb_id, stored_date, origin, title in rows:
            cache_key = (category, tmdb_id)
            if cache_key not in cache:
                path = f'/{category}/{tmdb_id}'
                cache[cache_key] = fetch(session, path, key, {'append_to_response': 'release_dates'} if category == 'movie' else None)
                rate_limit_gap(0.15)
            data = cache[cache_key]
            reason = movie_reason(data, origin, title, stored_date, region) if category == 'movie' else tv_reason(data, origin, title, stored_date)
            counts[(category, origin, reason)] += 1
    return counts


def main():
    load_local_env(Path(__file__).resolve().parent.parent)
    dsn, key = os.getenv('DATABASE_URL'), os.getenv('TMDB_API_KEY')
    if not dsn or not key:
        raise SystemExit('DATABASE_URL and TMDB_API_KEY are required')
    try:
        with psycopg.connect(dsn, options='-c default_transaction_read_only=on') as conn:
            result = audit(conn, requests.Session(), key)
    except TmdbUnavailable:
        print('TMDB unavailable; audit incomplete.')
        return 1
    for (category, origin, reason), count in sorted(result.items()):
        print(f'{category} / {origin} / {reason}: {count}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
