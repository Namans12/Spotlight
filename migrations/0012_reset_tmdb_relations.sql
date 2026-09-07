-- Spotlight migration 0012: clear machine-derived relation edges so they are
-- rebuilt under the collection-shape rules.
--
-- Every 'tmdb' edge in this table was written by the old rule "each
-- release-adjacent pair in a TMDB collection is a Must Watch prerequisite".
-- That rule is right for a tight sequel series and wrong for an anthology, a
-- multi-timeline franchise, or a collection carrying a spin-off — see
-- data/collection-shapes.json. Live examples in this database before this
-- migration:
--
--   * The Phantom Menace --before--> Return of the Jedi   (trilogy boundary)
--   * Untold: a 24-part Netflix documentary anthology chained end to end, so
--     "Untold: The Liver King" claimed 15 prerequisite films
--   * Scary Movie, Halloweentown, Best of the Best, Rush Hour: the same
--
-- These cannot be repaired in place. The upsert precedence ladder (§3.5) ranks
-- 'must' above 'can', so the corrected code's "same series, not required"
-- edges are rejected by the ON CONFLICT ... WHERE clause and the wrong 'must'
-- row survives. Deleting is the only way the new writes can land.
--
-- Safe to re-run, and safe to run before deploying the new code (the site
-- simply shows fewer relations until a warm refills them).

BEGIN;

-- 1. Machine-derived edges only.
--
-- source='seed' and source='wikidata' are untouched: the offline seed is
-- hand-authored continuity (data/relations_seed.json) and is the *better*
-- data, and nothing in this change affects how either was produced.
--
-- suppressed = true is untouched as well. That flag is a human decision — a
-- global thumbs-down applied by hand — and this database has four of them,
-- including on the Star Wars boundary edge above. Deleting the row would
-- discard the record of that judgement; leaving it costs nothing, because a
-- suppressed row never renders and the read layer filters it out before
-- anything else.
DELETE FROM title_relations
WHERE source = 'tmdb'
  AND suppressed = false;

-- 2. Forget which titles have been asked about.
--
-- Without this, api/relations.ts's warm path sees a fresh lookup row for every
-- title it has ever checked and skips the refill for RELATIONS_LOOKUP_TTL_DAYS
-- (30). The chains deleted above would simply be missing for a month. Clearing
-- the table makes the next view of each title re-fetch and re-derive it under
-- the new rules.
--
-- This is a cache, not a record: found_collection is re-derivable from TMDB on
-- demand, which is the whole reason it is stored separately from the edges.
DELETE FROM title_relation_lookups;

-- Deliberately NOT touched: user_relation_suppressions. Per-user thumbs-downs
-- are user data keyed by (user_id, from, to) in their own table, so they
-- survive this untouched and keep applying to any edge that comes back.

COMMIT;
