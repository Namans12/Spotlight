"""find_watchlist_matches must only match the owner's own watchlist rows —
the app now supports multiple Google accounts, each with a private
watchlist, and the owner is the only one who receives Telegram alerts."""

from __future__ import annotations

from datetime import date

import releasebot as rb


class FakeCursor:
    def __init__(self, rows):
        self._rows = rows
        self.last_query = None
        self.last_params = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, query, params=None):
        self.last_query = query
        self.last_params = params

    def fetchall(self):
        return self._rows


class FakeConn:
    def __init__(self, rows):
        self._cursor = FakeCursor(rows)

    def cursor(self):
        return self._cursor


def item(title, tmdb_id, media_type="movie", providers=("Netflix",)):
    return rb.ReleaseItem(
        tmdb_id=tmdb_id,
        title=title,
        media_type=media_type,
        language="en",
        release_date=date(2026, 9, 2),
        rating=5.0,
        popularity=1.0,
        overview="",
        tmdb_url="https://example.invalid",
        poster_url="/p.jpg",
        providers=providers,
        evidence=rb.ReleaseEvidence("IN", "tmdb_regional_digital", "tmdb_regional_availability", "2026-09-02T08:00:00+00:00"),
    )


def digest_with(*items):
    return {"region": "IN", "generated_at": "2026-09-02T14:00:00+05:30", "out_now": {"start": "2026-09-02", "end": "2026-09-03", "sections": {"english": list(items)}}}


def test_matches_owner_row_from_fake_query_result():
    # The real query already filters by email in SQL (WHERE u.email =
    # ANY(%s)); the fake cursor just returns what a correctly-scoped query
    # would return, so this test checks the Python-side matching logic.
    out_now_item = item("A Title", tmdb_id=42, media_type="movie")
    conn = FakeConn(rows=[(42, "movie")])

    matches = rb.find_watchlist_matches(
        digest_with(out_now_item), conn, owner_emails=["owner@example.com"]
    )

    assert matches == [
        {"tmdb_id": 42, "media_type": "movie", "title": "A Title", "providers": ["Netflix"]}
    ]


def test_no_match_when_owner_query_returns_nothing():
    # Simulates another user's watchlist row for the same title: the SQL
    # filter excludes it, so the fake cursor returns an empty result set.
    out_now_item = item("A Title", tmdb_id=42, media_type="movie")
    conn = FakeConn(rows=[])

    matches = rb.find_watchlist_matches(
        digest_with(out_now_item), conn, owner_emails=["owner@example.com"]
    )

    assert matches == []


def test_passes_owner_emails_list_as_query_param():
    # Needs at least one out_now item — an empty digest returns early
    # (see test_empty_out_now_returns_early_without_querying below)
    # without ever reaching the query.
    conn = FakeConn(rows=[])
    rb.find_watchlist_matches(
        digest_with(item("Unrelated", tmdb_id=1)),
        conn,
        owner_emails=["a@example.com", "b@example.com"],
    )

    assert conn.cursor().last_params == (["a@example.com", "b@example.com"],)
    assert "ANY(%s)" in conn.cursor().last_query
    assert "u.email" in conn.cursor().last_query


def test_empty_out_now_returns_early_without_querying():
    conn = FakeConn(rows=[(42, "movie")])
    matches = rb.find_watchlist_matches(digest_with(), conn, owner_emails=["owner@example.com"])

    assert matches == []
    assert conn.cursor().last_query is None


class FakeAlertCursor:
    """Simulates the sent_notifications dedup table: `already_sent` seeds
    which (tmdb_id, media_type, channel) rows already exist, matching what a
    previous run's INSERT would have left behind."""

    def __init__(self, already_sent):
        self.already_sent = set(already_sent)
        self.inserted: list[tuple] = []
        self._pending_select: tuple | None = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, query, params=None):
        if query.strip().startswith("SELECT pg_advisory_xact_lock"):
            return
        if query.strip().startswith("SELECT"):
            self._pending_select = params
        elif query.strip().startswith("INSERT"):
            self.inserted.append(params)
            self.already_sent.add(params)

    def fetchone(self):
        return (1,) if self._pending_select in self.already_sent else None


class FakeAlertConn:
    def __init__(self, already_sent=()):
        self._cursor = FakeAlertCursor(already_sent)
        self.committed = False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.committed = True


def match(tmdb_id, media_type="movie", title="Some Title", providers=("Netflix",)):
    return {"tmdb_id": tmdb_id, "media_type": media_type, "title": title, "providers": list(providers)}


def test_send_watchlist_alerts_sends_and_records_a_brand_new_match():
    conn = FakeAlertConn()
    sent_texts: list[str] = []

    sent = rb.send_watchlist_alerts([match(1)], conn, telegram_sender=sent_texts.append)

    assert sent == 1
    assert len(sent_texts) == 1
    assert (1, "movie", "telegram") in conn.cursor().inserted
    assert conn.committed


def test_send_watchlist_alerts_skips_a_match_already_notified_on_that_channel():
    conn = FakeAlertConn(already_sent={(1, "movie", "telegram")})
    sent_texts: list[str] = []

    sent = rb.send_watchlist_alerts([match(1)], conn, telegram_sender=sent_texts.append)

    assert sent == 0
    assert sent_texts == []


def test_send_watchlist_alerts_reports_only_genuinely_new_sends():
    # The exact scenario behind "the log said 3, only 1 message arrived": 3
    # matches, 2 already alerted on Telegram by an earlier run, 1 new. The
    # caller's log line must report 1, not len(matches) == 3 — that
    # over-count was the actual bug, not a missed send.
    conn = FakeAlertConn(already_sent={(1, "movie", "telegram"), (2, "movie", "telegram")})
    sent_texts: list[str] = []

    sent = rb.send_watchlist_alerts(
        [match(1), match(2), match(3)], conn, telegram_sender=sent_texts.append
    )

    assert sent == 1
    assert len(sent_texts) == 1


def test_send_watchlist_alerts_treats_each_channel_independently():
    # Telegram already notified for this title, email hasn't — email must
    # still fire. This is also what makes `len(matches) - sent` the wrong
    # formula for "already notified" once more than one channel is enabled:
    # a single match can rack up sent-count contributions from >1 channel.
    conn = FakeAlertConn(already_sent={(1, "movie", "telegram")})
    telegram_texts: list[str] = []
    email_texts: list[str] = []

    sent = rb.send_watchlist_alerts(
        [match(1)], conn, telegram_sender=telegram_texts.append, email_sender=email_texts.append
    )

    assert sent == 1
    assert telegram_texts == []
    assert len(email_texts) == 1


def test_send_watchlist_alerts_message_names_the_title_and_providers():
    conn = FakeAlertConn()
    sent_texts: list[str] = []

    rb.send_watchlist_alerts(
        [match(1, title="Gandhari", providers=["Netflix", "JioHotstar"])],
        conn,
        telegram_sender=sent_texts.append,
    )

    assert sent_texts == ["🎯 From your watchlist: Gandhari is now on Netflix, JioHotstar"]


def test_alerts_require_arrived_date_and_local_evidence():
    from dataclasses import replace

    eligible = item("Eligible", 1)
    evidence = eligible.evidence
    candidates = [
        eligible,
        replace(eligible, tmdb_id=2, release_date="2026-09-03"),  # future, even inside window
        replace(eligible, tmdb_id=3, release_date="2026-09-01"),  # before window
        replace(eligible, tmdb_id=4, evidence=None),
        replace(eligible, tmdb_id=5, evidence=replace(evidence, region="US")),
        replace(eligible, tmdb_id=6, evidence=replace(evidence, date_source=None)),
        replace(eligible, tmdb_id=7, evidence=replace(evidence, provider_source=None)),
        replace(eligible, tmdb_id=8, providers=()),
    ]
    assert [x.tmdb_id for x in rb.eligible_watchlist_items(digest_with(*candidates))] == [1]
    assert rb.eligible_watchlist_items({"out_now": {"sections": {"english": candidates}}}) == []


def test_both_matchers_reject_unknown_evidence_before_querying_watchlists():
    from dataclasses import replace

    unknown = replace(item("Unverified", 42), evidence=None)
    conn = FakeConn(rows=[(42, "movie")])
    assert rb.find_watchlist_matches(digest_with(unknown), conn, ["owner@example.com"]) == []
    assert conn.cursor().last_query is None
    assert rb.find_watchlist_matches_by_user(digest_with(unknown), conn) == []
    assert conn.cursor().last_query is None


def test_release_evidence_is_written_and_unknown_stays_null():
    import json
    from dataclasses import replace

    class Cursor:
        def __init__(self): self.calls = []
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def execute(self, sql, params): self.calls.append((sql, params))
    class Conn:
        def __init__(self): self.c = Cursor(); self.committed = False
        def cursor(self): return self.c
        def commit(self): self.committed = True

    known = item("Known", 1)
    unknown = replace(item("Unknown", 2), evidence=None)
    digest = {"region": "IN", "generated_at": "2026-09-02T14:00:00+05:30", "out_now": {"start": "2026-09-02", "end": "2026-09-03", "sections": {"english": [known, unknown]}}, "coming_up": {"start": "2026-09-04", "end": "2026-09-10", "sections": {}}}
    conn = Conn()
    assert rb.write_release_items_to_db(digest, conn) == 2
    inserts = [(sql, values) for sql, values in conn.c.calls if 'INSERT INTO release_items' in sql]
    assert 'evidence = EXCLUDED.evidence' in inserts[0][0]
    assert json.loads(inserts[0][1][-2])["region"] == "IN"
    assert inserts[1][1][-2] is None
    assert conn.committed


def test_alerts_reject_stale_missing_and_future_evidence():
    from dataclasses import replace
    current = item('Film', 42)
    stale = replace(current.evidence, observed_at='2026-08-30T08:00:00+00:00')
    future = replace(current.evidence, observed_at='2026-09-03T08:00:00+00:00')
    assert rb.eligible_watchlist_items(digest_with(replace(current, evidence=stale))) == []
    assert rb.eligible_watchlist_items(digest_with(replace(current, evidence=future))) == []
    assert rb.eligible_watchlist_items(digest_with(replace(current, evidence=replace(current.evidence, observed_at=None)))) == []


def test_alert_sender_deduplicates_identical_title_events_per_user():
    from dataclasses import replace
    current = item('Film', 42)
    conn = FakeConn(rows=[(42, 'movie')])
    matches = rb.find_watchlist_matches(digest_with(current, replace(current, season_number=2)), conn, ['owner@example.com'])
    delivery = FakeAlertConn()
    sent = []
    assert rb.send_watchlist_alerts(matches, delivery, telegram_sender=sent.append) == 1
    assert len(sent) == 1


def test_owner_alert_combines_only_individually_verified_provider_observations():
    from dataclasses import replace
    current = item('Film', 42)
    second = replace(current, providers=('Prime Video', 'Netflix'))
    unverified = replace(current, providers=('Unverified',), evidence=None)
    matches = rb.find_watchlist_matches(digest_with(current, second, unverified), FakeConn(rows=[(42, 'movie')]), ['owner@example.com'])
    assert len(matches) == 1
    assert matches[0]['providers'] == ['Netflix', 'Prime Video']
