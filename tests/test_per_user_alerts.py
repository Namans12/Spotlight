"""Per-account watchlist-drop alerts.

The alert pipeline already existed and only ever notified one person. Widening
it has three ways to go wrong, and each is worse than the feature not shipping:

  - emailing an account that never opted in
  - emailing the same account about the same title on every run
  - one account's alert consuming the only dedupe slot, so everyone else is
    silently skipped forever (the shape of the pre-0013 unique constraint)

These cover all three against a fake cursor, so no database or SMTP is needed.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import releasebot  # noqa: E402


class FakeItem:
    """The subset of ReleaseItem the matcher touches."""

    def __init__(self, tmdb_id: int, media_type: str, title: str, providers: list[str]):
        self.tmdb_id = tmdb_id
        self.media_type = media_type
        self.title = title
        self.providers = providers


class FakeCursor:
    """Answers the two shapes of query these functions issue, and records the
    inserts so a test can assert what was written."""

    def __init__(self, watchlist_rows: list[tuple], already_sent: set[tuple]):
        self._watchlist_rows = watchlist_rows
        self._already_sent = already_sent
        self._result: list[tuple] = []
        self.inserts: list[tuple] = []

    def execute(self, sql: str, params: tuple = ()):  # noqa: D102
        text = " ".join(sql.split())
        if text.startswith("SELECT u.id, u.email"):
            self._result = list(self._watchlist_rows)
        elif text.startswith("SELECT 1 FROM sent_notifications"):
            tmdb_id, media_type, user_id = params
            self._result = [(1,)] if (tmdb_id, media_type, user_id) in self._already_sent else []
        elif text.startswith("INSERT INTO sent_notifications"):
            self.inserts.append(params)
            self._already_sent.add((params[0], params[1], params[2]))
            self._result = []
        else:  # pragma: no cover - a query this fake was not taught about
            raise AssertionError(f"unexpected query: {text[:80]}")

    def fetchall(self):
        return self._result

    def fetchone(self):
        return self._result[0] if self._result else None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeConn:
    def __init__(self, cursor: FakeCursor):
        self._cursor = cursor
        self.commits = 0

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commits += 1


def digest_with(*items: FakeItem) -> dict:
    return {"out_now": {"sections": {"hindi": list(items)}}}


DUNE = FakeItem(693134, "movie", "Dune: Part Two", ["Netflix"])
WICK = FakeItem(603692, "movie", "John Wick: Chapter 4", ["JioHotstar"])


def test_only_opted_in_accounts_are_considered():
    """The SQL filters on notify_watchlist_drops, so an account that never
    asked contributes no rows at all — asserted by feeding the cursor only the
    rows that query would return."""
    cursor = FakeCursor([(7, "a@example.com", "Ada", 693134, "movie")], set())
    result = releasebot.find_watchlist_matches_by_user(digest_with(DUNE), FakeConn(cursor))

    assert [e["user_id"] for e in result] == [7]
    assert [m["title"] for m in result[0]["matches"]] == ["Dune: Part Two"]


def test_groups_matches_per_account():
    cursor = FakeCursor(
        [
            (7, "a@example.com", "Ada", 693134, "movie"),
            (7, "a@example.com", "Ada", 603692, "movie"),
            (9, "b@example.com", "Bo", 603692, "movie"),
        ],
        set(),
    )
    result = releasebot.find_watchlist_matches_by_user(digest_with(DUNE, WICK), FakeConn(cursor))

    by_user = {e["user_id"]: e for e in result}
    assert sorted(m["title"] for m in by_user[7]["matches"]) == ["Dune: Part Two", "John Wick: Chapter 4"]
    assert [m["title"] for m in by_user[9]["matches"]] == ["John Wick: Chapter 4"]


def test_ignores_saved_titles_that_did_not_drop():
    """A watchlist row only matters if the title is in this run's out_now."""
    cursor = FakeCursor([(7, "a@example.com", "Ada", 111111, "movie")], set())
    assert releasebot.find_watchlist_matches_by_user(digest_with(DUNE), FakeConn(cursor)) == []


def test_empty_digest_short_circuits():
    cursor = FakeCursor([(7, "a@example.com", "Ada", 693134, "movie")], set())
    assert releasebot.find_watchlist_matches_by_user(digest_with(), FakeConn(cursor)) == []


def test_one_email_per_account_not_one_per_title():
    """Four saved films dropping on the same Wednesday is four reasons to
    unsubscribe if it is four emails."""
    sent: list[tuple] = []
    cursor = FakeCursor([], set())
    entries = [
        {
            "user_id": 7,
            "email": "a@example.com",
            "display_name": "Ada Lovelace",
            "matches": [
                {"tmdb_id": 693134, "media_type": "movie", "title": "Dune: Part Two", "providers": ["Netflix"]},
                {"tmdb_id": 603692, "media_type": "movie", "title": "John Wick: Chapter 4", "providers": []},
            ],
        }
    ]

    accounts, titles = releasebot.send_user_watchlist_alerts(
        entries, FakeConn(cursor), lambda to, subject, text: sent.append((to, subject, text))
    )

    assert (accounts, titles) == (1, 2)
    assert len(sent) == 1
    to, subject, body = sent[0]
    assert to == "a@example.com"
    assert "2 titles" in subject
    assert "Dune: Part Two" in body and "John Wick: Chapter 4" in body
    assert body.startswith("Hi Ada,")
    # A title with no known provider still reads as a sentence.
    assert "a streaming platform" in body


def test_never_repeats_a_title_to_the_same_account():
    sent: list[tuple] = []
    cursor = FakeCursor([], already_sent={(693134, "movie", 7)})
    entries = [
        {
            "user_id": 7,
            "email": "a@example.com",
            "display_name": "Ada",
            "matches": [
                {"tmdb_id": 693134, "media_type": "movie", "title": "Dune: Part Two", "providers": ["Netflix"]}
            ],
        }
    ]

    accounts, titles = releasebot.send_user_watchlist_alerts(
        entries, FakeConn(cursor), lambda to, subject, text: sent.append((to, subject, text))
    )

    assert (accounts, titles) == (0, 0)
    assert sent == []
    assert cursor.inserts == []


def test_one_account_being_told_does_not_silence_everyone_else():
    """The pre-0013 unique constraint was global, so the first account alerted
    about a title consumed the only row that would ever exist for it. This is
    the regression that made the feature look like it worked."""
    sent: list[tuple] = []
    cursor = FakeCursor([], already_sent={(693134, "movie", 7)})
    match = {"tmdb_id": 693134, "media_type": "movie", "title": "Dune: Part Two", "providers": ["Netflix"]}
    entries = [
        {"user_id": 7, "email": "a@example.com", "display_name": "Ada", "matches": [dict(match)]},
        {"user_id": 9, "email": "b@example.com", "display_name": "Bo", "matches": [dict(match)]},
    ]

    accounts, titles = releasebot.send_user_watchlist_alerts(
        entries, FakeConn(cursor), lambda to, subject, text: sent.append((to, subject, text))
    )

    # Ada was already told; Bo has not been, and still gets it.
    assert (accounts, titles) == (1, 1)
    assert [to for to, _s, _b in sent] == ["b@example.com"]
    assert cursor.inserts == [(693134, "movie", 9)]


def test_a_failed_send_is_not_recorded_so_the_next_run_retries():
    def explode(_to, _subject, _text):
        raise RuntimeError("SMTP refused")

    cursor = FakeCursor([], set())
    entries = [
        {
            "user_id": 7,
            "email": "bad@example.com",
            "display_name": "Ada",
            "matches": [{"tmdb_id": 693134, "media_type": "movie", "title": "Dune", "providers": []}],
        }
    ]

    accounts, titles = releasebot.send_user_watchlist_alerts(entries, FakeConn(cursor), explode)

    assert (accounts, titles) == (0, 0)
    assert cursor.inserts == []


def test_one_bad_address_does_not_stop_the_rest():
    sent: list[tuple] = []

    def flaky(to, subject, text):
        if to == "bad@example.com":
            raise RuntimeError("SMTP refused")
        sent.append((to, subject, text))

    cursor = FakeCursor([], set())
    match = {"tmdb_id": 693134, "media_type": "movie", "title": "Dune", "providers": []}
    entries = [
        {"user_id": 7, "email": "bad@example.com", "display_name": "Ada", "matches": [dict(match)]},
        {"user_id": 9, "email": "good@example.com", "display_name": "Bo", "matches": [dict(match)]},
    ]

    accounts, titles = releasebot.send_user_watchlist_alerts(entries, FakeConn(cursor), flaky)

    assert (accounts, titles) == (1, 1)
    assert [to for to, _s, _b in sent] == ["good@example.com"]


def test_single_title_subject_names_it():
    sent: list[tuple] = []
    cursor = FakeCursor([], set())
    entries = [
        {
            "user_id": 7,
            "email": "a@example.com",
            "display_name": "Ada",
            "matches": [{"tmdb_id": 1, "media_type": "movie", "title": "Sholay", "providers": ["Prime Video"]}],
        }
    ]

    releasebot.send_user_watchlist_alerts(
        entries, FakeConn(cursor), lambda to, subject, text: sent.append((to, subject, text))
    )

    assert "Sholay is out" in sent[0][1]
