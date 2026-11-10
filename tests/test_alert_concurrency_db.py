"""Opt-in concurrency check against a disposable PostgreSQL database."""
import os
import sys
import threading
import uuid
from pathlib import Path

import pytest

DSN = os.getenv('SPOTLIGHT_TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not DSN, reason='requires disposable PostgreSQL')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_overlapping_alert_runs_wait_and_recheck_sent_records():
    import psycopg
    from psycopg import sql
    import releasebot

    schema = 'alert_test_' + uuid.uuid4().hex
    started, second_ready, release = threading.Event(), threading.Event(), threading.Event()
    first = second = None
    sends, results, failures = [], [], []
    entry = {'user_id': 7, 'email': 'test@example.invalid', 'display_name': 'Test',
             'matches': [{'tmdb_id': 1, 'media_type': 'movie', 'title': 'Test', 'providers': ['Example']}]}
    with psycopg.connect(DSN, autocommit=True) as setup:
        setup.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        setup.execute(sql.SQL('CREATE TABLE {}.sent_notifications (tmdb_id bigint, media_type text, notification_kind text, channel text, user_id bigint)').format(sql.Identifier(schema)))
        setup.execute(sql.SQL('CREATE TABLE {}.users (id bigint, email text, notify_watchlist_drops boolean)').format(sql.Identifier(schema)))
        setup.execute(sql.SQL('INSERT INTO {}.users VALUES (7, %s, true)').format(sql.Identifier(schema)), ('test@example.invalid',))
        setup.execute(sql.SQL('CREATE TABLE {}.watchlist_items (user_id bigint, tmdb_id bigint, media_type text, bucket text)').format(sql.Identifier(schema)))
        setup.execute(sql.SQL("INSERT INTO {}.watchlist_items VALUES (7, 1, 'movie', 'watchlist')").format(sql.Identifier(schema)))
        try:
            def worker(block):
                try:
                    with psycopg.connect(DSN) as conn:
                        conn.execute(sql.SQL('SET search_path TO {}').format(sql.Identifier(schema)))
                        def send(*_args):
                            sends.append('sent')
                            if block:
                                started.set()
                                assert release.wait(10)
                        if not block:
                            second_ready.set()
                        results.append(releasebot.send_user_watchlist_alerts([entry], conn, send))
                except Exception as exc:
                    failures.append(exc)

            first = threading.Thread(target=worker, args=(True,))
            second = threading.Thread(target=worker, args=(False,))
            first.start()
            assert started.wait(10)
            second.start()
            assert second_ready.wait(10)
            second.join(0.2)
            assert second.is_alive()
            release.set()
            first.join(10)
            second.join(10)
            assert not first.is_alive() and not second.is_alive()
            assert not failures
            assert sends == ['sent']
            assert sorted(results) == [(0, 0), (1, 1)]
            # A preference change while a run waits must be seen after the lock.
            setup.execute(sql.SQL('DELETE FROM {}.sent_notifications').format(sql.Identifier(schema)))
            sends.clear()
            results.clear()
            second_ready.clear()
            with psycopg.connect(DSN) as blocker:
                blocker.execute('SELECT pg_advisory_xact_lock(%s)', (releasebot.WATCHLIST_ALERT_LOCK_KEY,))
                second = threading.Thread(target=worker, args=(False,))
                second.start()
                assert second_ready.wait(10)
                second.join(0.2)
                assert second.is_alive()
                setup.execute(sql.SQL('UPDATE {}.users SET notify_watchlist_drops=false WHERE id=7').format(sql.Identifier(schema)))
                blocker.commit()
                second.join(10)
                assert not second.is_alive()
            assert not failures
            assert sends == [] and results == [(0, 0)]
            # The same applies if the title moves to Watched while waiting.
            setup.execute(sql.SQL('UPDATE {}.users SET notify_watchlist_drops=true WHERE id=7').format(sql.Identifier(schema)))
            sends.clear()
            results.clear()
            second_ready.clear()
            with psycopg.connect(DSN) as blocker:
                blocker.execute('SELECT pg_advisory_xact_lock(%s)', (releasebot.WATCHLIST_ALERT_LOCK_KEY,))
                second = threading.Thread(target=worker, args=(False,))
                second.start()
                assert second_ready.wait(10)
                second.join(0.2)
                assert second.is_alive()
                setup.execute(sql.SQL("UPDATE {}.watchlist_items SET bucket='watched' WHERE user_id=7").format(sql.Identifier(schema)))
                blocker.commit()
                second.join(10)
                assert not second.is_alive()
            assert not failures
            assert sends == [] and results == [(0, 0)]
        finally:
            release.set()
            for thread in (first, second):
                if thread and thread.ident is not None:
                    thread.join(10)
            setup.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
