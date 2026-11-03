### Task 3: Schema and the city registry

**Files:**
- Create: `migrations/0016_release_pulse.sql`
- Create: `data/pulse_cities.json`
- Create: `services/pulse/src/cities.ts`
- Test: `services/pulse/src/cities.test.ts`

**Interfaces:**
- Produces the tables, all created with `IF NOT EXISTS` inside one
  `BEGIN/COMMIT`:
  - `qloo_entities(tmdb_id BIGINT, media_type TEXT CHECK IN ('movie','tv'), imdb_id TEXT, qloo_entity_id TEXT, method TEXT CHECK IN ('imdb','search'), not_found BOOLEAN NOT NULL DEFAULT false, resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tmdb_id, media_type))`
  - `qloo_evidence(entity_id TEXT, city_slug TEXT NOT NULL DEFAULT '', kind TEXT, params JSONB, status TEXT, payload JSONB, fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (entity_id, city_slug, kind))`. `kind` is one of `demographics`, `heatmap`, `places`, `place_tags`, `artists`, `brands`, `trends`. `city_slug` is `''` for city-independent kinds.
  - `places(qid TEXT PRIMARY KEY, city_slug TEXT NOT NULL, name TEXT NOT NULL)`, which maps every QID (including aliases such as New Delhi Q987) to a city slug.
  - `title_locations(tmdb_id BIGINT, media_type TEXT, city_slug TEXT, kind TEXT CHECK IN ('filmed','set'), source TEXT CHECK IN ('wikidata','wikipedia','both'), landmark_label TEXT, landmark_lat DOUBLE PRECISION, landmark_lon DOUBLE PRECISION, PRIMARY KEY (tmdb_id, media_type, city_slug, kind))`, plus an index on `(city_slug, kind)`.
  - `neighbourhoods(city_slug TEXT, name TEXT, lat DOUBLE PRECISION, lon DOUBLE PRECISION, PRIMARY KEY (city_slug, name))`
  - `pulse_usage(session_hash TEXT, day DATE, kind TEXT CHECK IN ('chat','campaign'), count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (session_hash, day, kind))`. The global total is the sum over the day.
- Produces `data/pulse_cities.json`, an array of
  `{ slug, name, country, lat, lon, qids: string[], qlooLocationQuery: string, wikipedia: { filmed: string[], set: string[] }, prewarm: boolean }`.
  - QIDs: delhi `["Q1353","Q987"]`, mumbai `["Q1156"]`, bengaluru
    `["Q1355"]`, hyderabad `["Q1361"]`, chennai `["Q1352"]`, pune
    `["Q1538"]`, kolkata `["Q1348"]`, goa `["Q1171"]`, new-york `["Q60"]`,
    london `["Q84"]`.
  - `prewarm` is true for delhi, mumbai, bengaluru, new-york and london.
  - Wikipedia category names are exact titles without the `Category:`
    prefix. Examples: `Films_shot_in_Delhi`, `Films_set_in_Delhi`,
    `Television_shows_set_in_Delhi`. Task 5 verifies every listed name
    exists.
- Produces, in `services/pulse/src/cities.ts`:
  - `interface City { slug; name; country; lat; lon; qlooLocationQuery; prewarm }`
  - `getCity(slug: string): City | null`
  - `allCities(): City[]`

- [ ] **Step 1: Write failing tests.**

```ts
it("knows all ten launch cities", () => {
  expect(allCities().map(c => c.slug).sort()).toEqual(["bengaluru","chennai","delhi","goa","hyderabad","kolkata","london","mumbai","new-york","pune"]);
});
it("pre-warms exactly the five demo cities", () => {
  expect(allCities().filter(c => c.prewarm).map(c => c.slug).sort()).toEqual(["bengaluru","delhi","london","mumbai","new-york"]);
});
it("returns null for an unknown slug", () => { expect(getCity("atlantis")).toBeNull(); });
```

- [ ] **Step 2:** Run `npm --prefix services/pulse test -- cities`.
  Expected: FAIL.
- [ ] **Step 3:** Write the JSON, `cities.ts` (it reads
  `../../../data/pulse_cities.json` through `fs` at module load), and the
  migration.
- [ ] **Step 4:** Run the tests. Expected: PASS. Apply the migration to
  the **hackathon** Neon branch:
  `psql "$PULSE_DATABASE_URL" -f migrations/0016_release_pulse.sql`.
  Expected: `COMMIT`. Then run `\dt qloo_*` and expect both tables listed.
- [ ] **Step 5:** Add `0016_release_pulse.sql` to the README migration
  list (Setup step 5). Commit.

```bash
git add migrations/0016_release_pulse.sql data/pulse_cities.json services/pulse/src/cities.ts services/pulse/src/cities.test.ts README.md
git commit -m "Add the Pulse schema and the launch-city registry"
```

