-- Spotlight migration 0014: where each account is up to in a series.
--
-- The watched bucket is binary and television is not. Marking Breaking Bad
-- watched says "I have finished this show"; it has nothing to say about
-- someone three episodes into season two, which is the state most people are
-- in for most of the shows they care about. That state currently has nowhere
-- to live, so the app can neither answer "what do I put on next" nor count a
-- part-watched series honestly in a year in review.
--
-- One pointer per show, not one tick per episode. The pointer answers every
-- question this app actually asks — what is next, how much is left, am I done
-- — with one row per series rather than one per episode, and people watch
-- television in order. Per-episode ticks would be the right model for a
-- service that also wants to know you skipped 4x07, and this is not that.
--
-- Absence of a row means "not started". There is deliberately no zero row:
-- season 1 episode 0 would mean "started season one, watched none of it",
-- which is indistinguishable from not having started, and storing it would
-- make "have they begun?" a two-part question forever.

BEGIN;

CREATE TABLE IF NOT EXISTS title_progress (
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tmdb_id    BIGINT      NOT NULL,
    -- Films have no seasons. Constrained rather than merely documented,
    -- because a movie row here would be a silent write with no way to render
    -- it. The column exists at all so lookups can key on the same
    -- (tmdb_id, media_type) pair as every other title table.
    media_type TEXT        NOT NULL CHECK (media_type = 'tv'),
    -- Season 0 is TMDB's "Specials" and is excluded from its own
    -- number_of_seasons, so it is not a season progress can point at.
    -- src/lib/progress.ts clamps a stored pointer on every read; this stops
    -- an obviously wrong one being written in the first place.
    season     INTEGER     NOT NULL CHECK (season >= 1),
    episode    INTEGER     NOT NULL CHECK (episode >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One pointer per show per account. The upsert in lib/progressDb.ts relies
    -- on this being the conflict target.
    PRIMARY KEY (user_id, tmdb_id, media_type)
);

-- The only read this table has: "everything this account is part-way through",
-- issued once when the watchlist state loads. The primary key already covers
-- lookups by (user, title); this covers the scan by user alone.
CREATE INDEX IF NOT EXISTS idx_title_progress_user ON title_progress (user_id);

COMMIT;
