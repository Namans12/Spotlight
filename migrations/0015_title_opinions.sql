-- Spotlight migration 0015: did you actually like it?
--
-- The watched bucket records that someone saw a title. It does not record
-- whether they enjoyed it, and the difference is the whole reason watch
-- history has never been allowed to drive recommendations: marking a film
-- seen and then being served three more like it is only correct half the
-- time, and the other half is the film you watched on a flight and regretted.
--
-- Its own table rather than a column on watchlist_items, and not for tidiness.
-- addWatchlistItem is purge-then-insert (lib/watchlistDb.ts) and toggleWatched
-- deletes the row outright, so a rating stored there would be destroyed every
-- time someone un-marked and re-marked a title as seen — silently, and most
-- often for the people using the feature most. An opinion is about the title,
-- not about where it currently sits in someone's lists, and it outlives every
-- move between them.

BEGIN;

CREATE TABLE IF NOT EXISTS title_opinions (
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tmdb_id    BIGINT      NOT NULL,
    media_type TEXT        NOT NULL CHECK (media_type IN ('movie', 'tv')),
    -- Two states, not a star rating. "Would you watch another like this" is a
    -- question people answer honestly and instantly; "is this a seven or an
    -- eight" is one they answer slowly, inconsistently, and differently from
    -- each other, which makes the numbers incomparable across accounts.
    liked      BOOLEAN     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One opinion per title per account; changing your mind updates it.
    -- No opinion at all is the absence of a row, which is deliberately
    -- distinct from a neutral rating: "I have not said" is not "I am
    -- indifferent", and only the second would be evidence.
    PRIMARY KEY (user_id, tmdb_id, media_type)
);

-- The only read: "everything this account has an opinion about", issued once
-- when the watchlist state loads so a taste profile can be built in the
-- browser without a request per title.
CREATE INDEX IF NOT EXISTS idx_title_opinions_user ON title_opinions (user_id);

COMMIT;
