-- Spotlight migration 0016: Release Pulse.
--
-- Release Pulse is a separate service (services/pulse) that answers "who is
-- this title for, and where in this city should it be talking to them" from
-- Qloo's taste data. It shares this database but owns only the tables below;
-- nothing here is read by the main app or the sync worker, so the migration
-- is purely additive and safe to run against a live database.

BEGIN;

-- Maps a TMDB title to the Qloo entity that describes it. Qloo has its own ids,
-- so every Pulse request for a title starts with "which entity is this", and
-- that lookup (an IMDb-id match, else a name search) costs a Qloo call.
--
-- A miss is stored as a row with not_found = true rather than left absent, for
-- the same reason title_ratings does it: without the row, every title Qloo does
-- not know is re-searched on every request, forever, and the titles it does not
-- know are exactly the ones that never get cheaper. The row also records how
-- the match was made, because an id match is trustworthy and a name search is
-- a guess, and the UI is allowed to treat them differently.
CREATE TABLE IF NOT EXISTS qloo_entities (
    tmdb_id         BIGINT      NOT NULL,
    media_type      TEXT        NOT NULL CHECK (media_type IN ('movie', 'tv')),
    imdb_id         TEXT,
    qloo_entity_id  TEXT,
    method          TEXT        CHECK (method IN ('imdb', 'search')),
    not_found       BOOLEAN     NOT NULL DEFAULT false,
    resolved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tmdb_id, media_type)
);

-- A cache of what Qloo said, not a mirror of Qloo. Qloo's terms do not allow
-- redistributing its data, so this table exists to avoid asking twice and to
-- keep the demo inside Qloo's rate limits, and nothing else: rows are keyed by
-- the question that was asked and carry fetched_at so they can be expired, and
-- there is deliberately no query that lists or exports them wholesale.
--
-- kind is one of demographics, heatmap, places, place_tags, artists, brands,
-- trends. city_slug is '' (not NULL) for the kinds that do not depend on a
-- city: a NULL would make the primary key unable to enforce one row per
-- question, since NULLs never compare equal. params keeps the exact request
-- so a cached answer is never served for a different question, and status
-- records a cached failure so a dead endpoint is not hammered either.
CREATE TABLE IF NOT EXISTS qloo_evidence (
    entity_id   TEXT        NOT NULL,
    city_slug   TEXT        NOT NULL DEFAULT '',
    kind        TEXT        NOT NULL,
    params      JSONB,
    status      TEXT,
    payload     JSONB,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_id, city_slug, kind)
);

-- Every Wikidata place id we accept, mapped to the city it belongs to. It is a
-- table of QIDs rather than one QID per city because Wikidata splits places:
-- Delhi (Q1353) and New Delhi (Q987) are different items, and a film "set in
-- New Delhi" is a Delhi film as far as anyone browsing by city is concerned.
-- Aliases all point at the same slug, so adding one is a row, not a code change.
CREATE TABLE IF NOT EXISTS places (
    qid        TEXT PRIMARY KEY,
    city_slug  TEXT NOT NULL,
    name       TEXT NOT NULL
);

-- Which titles were filmed in, or set in, which launch city. Kept separate
-- because they are different claims: a film shot in Mumbai and a film about
-- Mumbai that was shot in a Budapest studio feed different features, and
-- collapsing them would answer neither question. source records whether
-- Wikidata, Wikipedia categories, or both said so, since agreement is the
-- strongest signal this table has. The landmark columns hold the one
-- recognisable place a title is tied to, when a source named one.
CREATE TABLE IF NOT EXISTS title_locations (
    tmdb_id        BIGINT           NOT NULL,
    media_type     TEXT             NOT NULL,
    city_slug      TEXT             NOT NULL,
    kind           TEXT             NOT NULL CHECK (kind IN ('filmed', 'set')),
    source         TEXT             CHECK (source IN ('wikidata', 'wikipedia', 'both')),
    landmark_label TEXT,
    landmark_lat   DOUBLE PRECISION,
    landmark_lon   DOUBLE PRECISION,
    PRIMARY KEY (tmdb_id, media_type, city_slug, kind)
);

-- The read that matters: "titles filmed (or set) in this city", from the city
-- page. The primary key leads with tmdb_id, so without this that read would
-- scan the whole table.
CREATE INDEX IF NOT EXISTS idx_title_locations_city_kind ON title_locations (city_slug, kind);

-- Neighbourhood centroids per launch city, so a heatmap cell can be named
-- ("Bandra") instead of shown as a coordinate. Reference data, written by
-- the data build rather than by a request.
CREATE TABLE IF NOT EXISTS neighbourhoods (
    city_slug  TEXT             NOT NULL,
    name       TEXT             NOT NULL,
    lat        DOUBLE PRECISION,
    lon        DOUBLE PRECISION,
    PRIMARY KEY (city_slug, name)
);

-- The cost cap for the server-held LLM key. Pulse calls the model with a key
-- that belongs to us, not the visitor, and the service is public, so without a
-- ceiling one script could spend the whole budget in an afternoon. One counter
-- per anonymous session per day per kind of call gives the per-session limit;
-- the global daily limit is the sum over the day, so there is no separate
-- global row to keep in step. session_hash is a hash, never the raw session
-- id, so this table cannot be replayed as credentials.
CREATE TABLE IF NOT EXISTS pulse_usage (
    session_hash  TEXT    NOT NULL,
    day           DATE    NOT NULL,
    kind          TEXT    NOT NULL CHECK (kind IN ('chat', 'campaign')),
    count         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_hash, day, kind)
);

COMMIT;
