-- Rebuild derived TMDB and Wikidata relations under conservative curated-only rules.
-- Preserve global and per-user suppression records and all curated/manual edges.
BEGIN;
DELETE FROM title_relations WHERE source IN ('tmdb', 'wikidata') AND suppressed = false;
DELETE FROM title_relation_lookups;
COMMIT;
