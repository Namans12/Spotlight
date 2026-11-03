# Task 3 report: Schema and the city registry

Commit: 231ea2d "Add the Pulse schema and the launch-city registry" (branch feat/release-pulse)

## Built
- `migrations/0016_release_pulse.sql`: one BEGIN/COMMIT, six tables with IF NOT EXISTS exactly as in the brief, plus `idx_title_locations_city_kind` on `(city_slug, kind)`. Long "why" comments per table in the 0014/0015 voice (not_found rows like title_ratings; qloo_evidence is a cache, not a mirror, Qloo terms forbid redistribution; city_slug '' not NULL; places holds aliases like New Delhi Q987; filmed vs set; pulse_usage is the cost cap for the server-held LLM key).
- `data/pulse_cities.json`: ten cities, brief QIDs and prewarm flags verbatim, qlooLocationQuery values as specified.
- `services/pulse/src/cities.ts`: `City`, `getCity`, `allCities`, pure `parseCities(raw)`. Loader reads the JSON via fs, path resolved from `import.meta.url`, parses at module load. parseCities throws naming the entry/slug and field for: non-array, non-object entry, missing slug, duplicate slug, bad name/lat/lon/qlooLocationQuery/country (IN/US/GB)/prewarm, empty qids, bad wikipedia.filmed/set. `allCities()` returns copies.
- README Setup step 5: added 0014, 0015, 0016 to the migration list (one line).

## TDD
- RED: `npm --prefix services/pulse test -- cities` before cities.ts existed:
  `FAIL src/cities.test.ts ... Failed to load url ./cities.js ... Does the file exist?` Test Files 1 failed, no tests. Expected: module did not exist.
- GREEN: `npm --prefix services/pulse test`: 3 files, 17 tests passed (cities.test.ts: 9 = 3 brief tests verbatim + known-slug shape + 5 parseCities tests).

## Verification
- `npm --prefix services/pulse test`: 17 passed.
- `npm run typecheck`: clean (all five tsconfigs).
- root `npx vitest run`: 31 files, 414 passed.

## psql (local throwaway Postgres, per ruling R3; LC_ALL=en_US.UTF-8)
Command: `psql -h /tmp -p 54329 -U postgres -d spotlight_test -f migrations/0016_release_pulse.sql`
- Run 1: `BEGIN`, 5x `CREATE TABLE` / `CREATE INDEX` (7 statements in all), `COMMIT`.
- Run 2 (idempotency): `BEGIN`, a `NOTICE: relation "..." already exists, skipping` for each of the 6 tables and the index, `COMMIT`. No errors.
- `\dt` lists all six: neighbourhoods, places, pulse_usage, qloo_entities, qloo_evidence, title_locations. `\di idx_title_locations*` shows idx_title_locations_city_kind.
- CHECK rejection:
  - `INSERT INTO qloo_entities (tmdb_id, media_type) VALUES (1, 'book');` -> `ERROR: new row for relation "qloo_entities" violates check constraint "qloo_entities_media_type_check"`
  - `INSERT INTO title_locations (...) VALUES (1,'movie','delhi','x');` -> `ERROR: ... violates check constraint "title_locations_kind_check"`
  - `INSERT INTO pulse_usage (session_hash, day, kind) VALUES ('h', current_date, 'other');` -> `ERROR: ... violates check constraint "pulse_usage_kind_check"`
- Rolled-back positive check: qloo_evidence insert without city_slug defaults to '' (length 0).
Not applied to Neon (none exists yet, R3).

## Wikipedia categories (checked with the MediaWiki API, batched `titles=` query; per-title curl loop was rate-limited)
Confirmed to exist and used:
- Delhi: Films_shot_in_Delhi; Films_set_in_Delhi, Television_shows_set_in_Delhi
- Mumbai: Films_shot_in_Mumbai; Films_set_in_Mumbai, Television_shows_set_in_Mumbai
- Bengaluru: Films_shot_in_Bengaluru; Films_set_in_Bengaluru
- Hyderabad: Films_shot_in_Hyderabad,_India; Films_set_in_Hyderabad,_India, Television_shows_set_in_Hyderabad,_India
- Chennai: Films_shot_in_Chennai; Films_set_in_Chennai
- Pune: Films_shot_in_Pune; Films_set_in_Pune, Television_shows_set_in_Pune
- Kolkata: Films_shot_in_Kolkata; Films_set_in_Kolkata, Television_shows_set_in_Kolkata
- Goa: Films_shot_in_Goa; Films_set_in_Goa
- New York: Films_shot_in_New_York_City, Television_shows_shot_in_New_York_City; Films_set_in_New_York_City, Television_shows_set_in_New_York_City
- London: Films_shot_in_London, Television_shows_shot_in_London; Films_set_in_London, Television_shows_set_in_London
Not found / left out (TV set categories, city level): Bengaluru/Bangalore, Chennai, Goa ("Television shows set in ..." missing; "Television series set in ..." forms are all missing too). Also missing: Television shows shot/filmed in Delhi and Mumbai. Observations for Task 5: the Bangalore-named categories exist but are empty (0 pages; Bengaluru is the populated name); state-level categories exist (Television shows set in Karnataka 13, Tamil Nadu 345, Telangana 1, Maharashtra 17, West Bengal 10, India 51) but were not used since they are not city-scoped; "Films set in Hyderabad" (no ", India") is missing.

## Files changed
migrations/0016_release_pulse.sql, data/pulse_cities.json, services/pulse/src/cities.ts, services/pulse/src/cities.test.ts, README.md

## Self-review
- Brief columns/constraints verbatim. Judgment calls: neighbourhoods lat/lon left nullable and title_locations media_type/source unconstrained or nullable exactly as the brief gives (no extra NOT NULLs beyond the brief's). I did add NOT NULL to `qloo_evidence.entity_id`/`kind` and similar PK columns, which PK already implies, so no behavioural change.
- parseCities also validates qids/wikipedia (beyond what City exposes) so a bad edit that would only break Task 5 still fails at startup; small, and in the brief's "validate the JSON shape" spirit.
- Coordinates are city centres (Goa = Panaji); approximate, not used for anything precise yet.

## Concerns
- None blocking. The three missing TV categories mean Bengaluru/Chennai/Goa have film-only "set" lists until Task 5 decides whether to use state-level categories.
