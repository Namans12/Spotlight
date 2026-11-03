# Task 5 report: filming-location and neighbourhood pipeline

Status: DONE_WITH_CONCERNS. Commit `943d637` "Fill title_locations from Wikipedia categories and Wikidata, nightly" on `feat/release-pulse`.

## What was built

- `scripts/sync_title_locations.py` (new). CLI: `--check-categories`, `--neighbourhoods`, `--dry-run`, default sync, plus `--city <slug>` (repeatable; added so a single city can be re-run and verified without a 5-minute run).
  - Pure functions per brief: `merge_rows`, `city_for_qid` (Q987 and Q1353 -> delhi, from `data/pulse_cities.json`), `to_rows`, `drop_suspect`, `article_titles` (+ `article_members`, which keeps the pageprops), `LocRow`. Also `wikidata_rows`, `neighbourhood_rows`, `carry_over`, `parse_point`.
  - Wikipedia half: `generator=categorymembers` (`gcmnamespace=0`, `gcmlimit=500`, `prop=pageprops`, follows `continue`), subcategories never recursed. QIDs -> TMDB ids via a SPARQL `VALUES` query over P4947/P4983, batches of 200, cached per run. A QID with no TMDB id is dropped; no title fallback.
  - Wikidata half: P915 -> `filmed`, P840 -> `set`, over the city's QIDs and anything `wdt:P131*` inside them, paged at 15k rows. Landmark label/lat/lon only for `filmed` rows, only when the filming-location item is not the city or one of its aliases, and only with an English label plus P625. If several landmarks exist for one title+city, `merge_rows` picks the alphabetically first label so the result does not depend on WDQS row order.
  - `places`: one upserted row per QID per city (aliases included, e.g. Q987 "New Delhi"), names from one WDQS label query, falling back to the city name.
  - `neighbourhoods`: skips items without coordinates or an English label, dedupes by name, caps at 25 sorted by label, prints every row. One delete+insert transaction per city.
  - Production guard (R13): `missing_tables()` uses `to_regclass('public.<table>')` for all three tables before anything else, including before any network call. If any is missing it prints one line and returns 0. It touches no other table.
  - Failure policy: `wdqs()` wraps the shared `run_sparql` and sleeps `WDQS_GAP_SECONDS` after each call. A 429 gets an extra 20 s / 40 s cooldown (two more rounds), because run_sparql's own 1-2 s backoff does not clear a throttle. Wikipedia calls get 4 attempts with exponential backoff. A failed half is logged and skipped. The stored rows for that source are carried over (`carry_over`) so an outage never wipes data. A city where both halves fail is skipped. A city whose write fails is rolled back alone. Exit is 1 only when nothing was written and something failed.
  - `--dry-run` and `--check-categories` need no database. With no `DATABASE_URL` the default mode prints a skip line and exits 0.
- `scripts/sync_relations_wikidata.py`: `run_query` now delegates to a new `run_sparql(session, query)` (the same retry/UA/timeout code, moved, not copied). Behaviour unchanged.
- `.github/workflows/ott-radar-nightly.yml`: new step "Sync filming locations for Release Pulse" after "Load curated watch-order seed", `continue-on-error: true`, env is only `DATABASE_URL`. YAML loads cleanly (checked with Ruby's YAML).
- `data/pulse_cities.json`: unchanged. Every category name was valid, so no fix was needed.

## Tests and TDD

`tests/test_sync_title_locations.py`: 33 tests. They cover the five brief cases, merge/dedupe determinism, `to_rows` with movie/tv and non-numeric ids, Wikidata binding parsing (landmark rules, alias, no coords, no label, suspect Ooty QID, unknown city), `carry_over`, neighbourhood rules, the guard (all tables missing, partial, one parametrised over default and `--neighbourhoods`), a half failing, every source failing -> exit 1, a city write failing -> rollback only that city, dry-run never connecting, and 429 backoff. All use fakes; no DB and no network.

- RED: `.venv/bin/python -m pytest tests/test_sync_title_locations.py -q` -> `ModuleNotFoundError: No module named 'sync_title_locations'` (collection error). A later intermediate RED was the guard test failing because of an extra header line. It was fixed by removing the header, since the guard must print exactly one line.
- GREEN: `.venv/bin/python -m pytest tests/test_sync_title_locations.py` -> `33 passed`.
- Full Python suite: `.venv/bin/python -m pytest` -> `218 passed`.
- `npm run typecheck` -> clean. Root `npx vitest run` -> `31 files, 414 passed`.

## Live verification

1. `--check-categories` (exit 0): no MISSING. Counts per category (articles, subcats):

   | Category | Articles | Subcats |
   |---|---|---|
   | Films_set_in_Bengaluru | 199 | 2 |
   | Films_set_in_Chennai | 394 | 2 |
   | Films_set_in_Delhi | 289 | 7 |
   | Films_set_in_Goa | 136 | 1 |
   | Films_set_in_Hyderabad,_India | 368 | 1 |
   | Films_set_in_Kolkata | 341 | 1 |
   | Films_set_in_London | 2971 | 16 |
   | Films_set_in_Mumbai | 670 | 4 |
   | Films_set_in_New_York_City | 2655 | 15 |
   | Films_set_in_Pune | 33 | 0 |
   | Films_shot_in_Bengaluru | 324 | 2 |
   | Films_shot_in_Chennai | 650 | 0 |
   | Films_shot_in_Delhi | 241 | 0 |
   | Films_shot_in_Goa | 199 | 1 |
   | Films_shot_in_Hyderabad,_India | 662 | 2 |
   | Films_shot_in_Kolkata | 209 | 0 |
   | Films_shot_in_London | 1372 | 14 |
   | Films_shot_in_Mumbai | 838 | 2 |
   | Films_shot_in_New_York_City | 1926 | 2 |
   | Films_shot_in_Pune | 58 | 0 |
   | Television_shows_set_in_Delhi | 68 | 1 |
   | Television_shows_set_in_Hyderabad,_India | 5 | 0 |
   | Television_shows_set_in_Kolkata | 40 | 0 |
   | Television_shows_set_in_London | 777 | 25 |
   | Television_shows_set_in_Mumbai | 197 | 1 |
   | Television_shows_set_in_New_York_City | 788 | 24 |
   | Television_shows_set_in_Pune | 10 | 0 |
   | Television_shows_shot_in_London | 106 | 0 |
   | Television_shows_shot_in_New_York_City | 317 | 1 |

   A mistyped name does come back as `MISSING` (checked against a made-up category).

2. `--neighbourhoods`, then the default sync, against `postgres://postgres@127.0.0.1:54329/spotlight_test`. Rows by city, kind and source:

   ```
   city       kind   both  wikidata  wikipedia   total
   bengaluru  filmed    1         0        284     285
   bengaluru  set      97         3         73     173
   chennai    filmed    2         1        599     602
   chennai    set     138        11        225     374
   delhi      filmed   50         4        178     232
   delhi      set      87         9        236     332
   goa        filmed    2         1        176     179
   goa        set      41         3         82     126
   hyderabad  filmed    3         2        618     623
   hyderabad  set      70         5        277     352
   kolkata    filmed    4         5        179     188
   kolkata    set     185        16        134     335
   london     filmed  412       109       1008    1529
   london     set    2384       320       1217    3921
   mumbai     filmed   24        18        769     811
   mumbai     set     273        40        475     788
   new-york   filmed 1037       418       1080    2535
   new-york   set    2352      1251        987    4590
   pune       filmed    1         0         54      55
   pune       set        1         1         37      39
   ```
   Total 18,069 rows (15,842 movie, 2,227 tv). `places` has 11 rows (Q987 New Delhi -> delhi, plus the ten primaries). `neighbourhoods` has 203 rows: bengaluru 18, chennai 25, delhi 15, hyderabad 25, kolkata 25, london 25, mumbai 25, new-york 25, pune 20, goa 0.
   - Delhi filmed is 232, so the brief's >= 200 holds. The category has 241 articles and 228 map to a TMDB id. The 4 `wikidata`-only rows come on top, and 50 of the 232 are `both`.
   - Spot check by TMDB id, labelled through a reverse P4947 lookup:
     - Rang De Basanti 7913: filmed, both.
     - Delhi Belly 67109: filmed, wikipedia.
     - Band Baaja Baaraat 52696: filmed, both.
     - Khosla Ka Ghosla 15412: stored as `set`/both only. Wikipedia lists it only under "Films set in Delhi", so it is correct that it is absent from `filmed`.
     - Ten random Delhi filmed titles, all plausible: Liar's Dice 248211, Chatrapathy 78628, Vellimoonga 296902, Pati Patni Aur Woh 590350, Chandni Chowk to China 20002, Qayamat Se Qayamat Tak 27964, InCar 1092973, Force 2 426558, Aisha 44248, Vaaimai 272676. Chatrapathy and Vellimoonga are southern films that are in the Wikipedia "shot in Delhi" category.
   - The Ooty bulk import is real. WDQS shows 199 films with P915 = Ooty, and the Ooty QID is Q9888, looked up two independent ways (Wikipedia sitelink and Wikipedia pageprops). It is excluded in `wikidata_rows` and `SUSPECT_PLACE_QIDS`, and `drop_suspect` removes any row outside the ten slugs.

3. Guard: `CREATE DATABASE pulse_guard_check`, then the default run and `--neighbourhoods` both printed `Skipping: table(s) title_locations, places, neighbourhoods not found (migration 0016 not applied); nothing written.`, exit 0. The database still had 0 tables afterward. Then `DROP DATABASE`.

4. Second sync: exit 0. Counts by city/kind/source are identical (`diff` empty). A md5 over the whole `title_locations` table is identical before and after (`b764445a...`, 18069 rows). `places` is still 11 rows and `neighbourhoods` still 203.

## Gotchas and coverage notes

- Wikidata is thin where Wikipedia is rich. Delhi has 54 Wikidata-sourced filmed rows against 228 Wikipedia ones. There are no Delhi landmarks at all, because every P915 item for Delhi is the city or "New Delhi" itself. Landmarks do appear for New York (Manhattan, Brooklyn, Radio City Music Hall, Grand Central...) and London (Old Royal Naval College, Canary Wharf...).
- Neighbourhood class widening: `P31/P279*` over the brief's single class `Q123705` timed out on Delhi (a multi-class closure also hit the 60 s ceiling), and `Q123705` alone gave few results (Delhi 14, Mumbai 18). Final choice is three direct `P31` classes, queried one at a time: Q123705 neighbourhood, Q188509 suburb (Borivali, Chembur, Juhu), Q3257686 locality (Marol, Oshiwara). Q486972 "human settlement" and Q5084 "hamlet" are deliberately excluded because they bring in villages. The class pattern goes first and each container is inlined as its own UNION arm. With `VALUES ?city` or the city pattern first, the New York query timed out; now it takes about 2 s. This is documented in comments.
- London: Wikidata files its districts under Greater London (Q23306), not Q84. Q84 had 1 neighbourhood below it and Q23306 about 60. A constant `NEIGHBOURHOOD_EXTRA_CONTAINERS = {"london": ("Q23306",)}` widens only the neighbourhood search scope. `pulse_cities.json` is untouched, so a film "set in Greater London" is not claimed for the London city page.
- Goa has 0 neighbourhoods. Wikidata only has villages and census towns beneath Goa, which are not in the chosen classes. I did not pad it; the labeler will have no names for Goa.
- WDQS is intermittently throttled: I saw 429s and 40-60 s timeouts while probing, mostly after bursts of heavy queries. The final sync runs (about 5 minutes for ten cities) hit none, but the 429 cooldown is there for the nightly case.

## Files changed

- `/Users/naman/spotlight-qloo/Spotlight/scripts/sync_title_locations.py` (new)
- `/Users/naman/spotlight-qloo/Spotlight/tests/test_sync_title_locations.py` (new)
- `/Users/naman/spotlight-qloo/Spotlight/scripts/sync_relations_wikidata.py` (`run_sparql` extracted from `run_query`)
- `/Users/naman/spotlight-qloo/Spotlight/.github/workflows/ott-radar-nightly.yml` (new step)

## Self-review

- Brief coverage: all modes, pure functions and signatures, guard, nightly step, and the four verification steps are done. Nothing is copied from `sync_relations_wikidata.py`; `USER_AGENT`, `WDQS_GAP_SECONDS` and `run_sparql` are imported.
- No title-search fallback anywhere. Every written row's id came from P4947/P4983.
- YAGNI: `--city` and the Q9888 / extra-containers constants are the only additions beyond the brief, and each is justified above. `carry_over` is the one non-trivial extra; it exists so a WDQS outage cannot delete the other source's rows.
- Pristine output: the run prints one line per half and one per city. Only a hard failure exits non-zero.

## Concerns

1. Neighbourhood cap: "first 25 by label" is alphabetical (brief-mandated), which biases the set toward A-M names for Mumbai, Hyderabad, Chennai and Kolkata (no Worli, for example). Delhi's list includes noisy Wikidata items ("Garstin Bastion Road", "Paschim Vihar.."). A spatially spread or popularity-ordered cap would label heatmaps better. It is a small change if the controller wants it.
2. Wikidata "set" rows with P131* are generous: a film set at any item inside the city counts as set in the city. It is structural, not guessed, but it is the largest source of `wikidata`-only `set` rows for New York (1,251).
3. Goa has no neighbourhoods (see above).
4. The nightly step writes to production, if migration 0016 is ever applied there, with ~18k delete+insert rows on the first run. That is by design; the guard keeps it a no-op until then.


---

# Fix round 1 (commit `876a9cc`)

## Changes

**Important 1: neighbourhood recall and ranking**
- Root cause (investigated with WDQS): the `P131+ city` chain does not reach the city item for most Indian areas. Hauz Khas -> South Delhi district, Lajpat Nagar -> Jangpura tehsil, Karol Bagh -> Karol Bagh tehsil, Colaba -> Mumbai City district, Dadar -> Mumbai. Raising the cap or re-ranking could not bring them back. Other findings:
  - London's districts are typed `Q2755753` "area of London", not neighbourhood.
  - New York's are typed `Q61297932` "neighborhood of Manhattan", a subclass of neighbourhood.
  - Connaught Place is only a `Q738570` "central business district".
  - Dadar, Koramangala and Baga are typed only as `Q486972` "human settlement".
- Containment is replaced with `wikibase:around` per class around the city centre (25 km, Goa 45 km), one query per class, class-first. Each query takes 1-8 s. The closure (`P31/P279*`) is used only for `Q123705`, which is safe because the radius bounds the set. The classes are neighbourhood (closure), suburb, locality, area of London and central business district, plus Goa-only city, town, village in India and census town of India. Each is commented with why it is there.
- `Q486972` "human settlement" is deliberately not a class. I first included it: Delhi's top 25 became Loni, Nangloi Jat, Karawal Nagar and similar outskirts, with only 2 of the 6 acceptance names (Connaught Place and Chandni Chowk). The few areas typed that way come in through the seed instead.
- Candidates carry `wikibase:sitelinks`. `neighbourhood_rows(bindings, city, cap)` now takes the city dict and does the following:
  - ranks by `(-sitelinks, label, QID, point)` with no minimum threshold;
  - dedupes by QID, then case-insensitively by name, keeping the more notable item and not the first WDQS row;
  - cleans labels (strips whitespace and trailing dots/commas, collapses inner spaces);
  - drops a label equal to the city name;
  - drops non-areas by suffix: ` road`, ` marg`, ` street`, ` avenue`, ` suburbs`, ` kaval`. Avenue and Kaval were added after seeing "Fifth Avenue" and Bengaluru's "<X> Manavarthe Kaval" in real output;
  - drops points more than 100 km from the city centre.
- Seed: `data/pulse_neighbourhoods_seed.json`, QIDs only, six items. Names, coordinates and sitelinks are read from Wikidata through `VALUES`.

  | City | QID | Area | Looked up via |
  |---|---|---|---|
  | Mumbai | Q5207921 | Dadar | `wbsearchentities` "suburb of Mumbai" |
  | Bengaluru | Q6025083 | Indiranagar | `wbsearchentities` "neighbourhood in Bangalore" |
  | Bengaluru | Q5320506 | Koramangala | `wbsearchentities` "locality in Bangalore" |
  | Bengaluru | Q1531304 | Basavanagudi | `wbsearchentities` "suburb of Bangalore" |
  | Goa | Q4841379 | Baga | Wikipedia "Baga, Goa" sitelink |

  All five were sanity-checked by label and coordinates, each 4-11 km from its city centre. Delhi, New York and London needed no seed. I considered Saket (Q7402907, 10.5 km from the centre) and dropped it from the seed because Delhi already meets its bar.
- Neighbourhood rows are `--neighbourhoods` only (the nightly step runs the title sync). The cap stays 25.

**Important 2: nightly step**
- The step is now the last in the job, with `timeout-minutes: 20` and `continue-on-error: true`. Only `DATABASE_URL` is passed. The other steps are untouched, and YAML loads (checked with Ruby).
- Circuit breaker (`CircuitBreaker`): after 2 consecutive cities fail on a source, that source is skipped for the remaining cities and the run logs it. Sources are `wikipedia` and `wdqs`; `SourceUnavailable` now carries `.source`. A Wikipedia half needs both sources, so a skipped source counts as a failed half and carry-over applies. It is also applied to `--neighbourhoods` for WDQS.

**Ruled-in small items**
- QIDs are validated with `fullmatch(Q[0-9]+)` before they reach `QID_TO_TMDB_QUERY` (malformed ones are skipped), and also on seed load. A test caught that `^Q\d+$` would have let `"Q12\n"` through, so the check uses `fullmatch` with `[0-9]`.
- A source that returns zero rows without raising, while rows from it are stored for that city, is treated as a failed half: it is logged and carried over. If both halves are empty with rows stored, the city is left untouched and counted failed. An empty neighbourhood result with rows stored is not written ("keeping them").
- The new test `test_a_city_write_deletes_only_that_city_and_upserts_its_places` asserts the exact `DELETE FROM title_locations WHERE city_slug = %s` params `("delhi",)` and the `places` upsert params. `test_neighbourhoods_are_replaced_per_city` asserts the same for neighbourhoods.

## Tests

`tests/test_sync_title_locations.py` now has 55 tests (was 33). New or reworked:
- Ranking: sitelinks, then label, then QID, independent of input order; the cap keeps the most notable; no minimum threshold.
- Dedupe by QID; dedupe case-insensitively, keeping the more notable item and not the first row; lowest-QID tie-break.
- Label normalisation, city-name drop, street/region suffix drops, the 100 km distance guard, `distance_km`.
- `valid_qid`, seed QID validation, missing seed file, and that malformed QIDs never reach the TMDB query.
- The fetch builds one query per class plus the extras and the seed (centre point and radius asserted).
- Circuit breaker unit tests, a dead Wikipedia skipped after 2 cities while Wikidata still writes, and a dead WDQS stopping both halves (exit 1 when nothing written).
- Empty-source rules (3 cases for titles, 1 for neighbourhoods) and the scoped DELETE / places-upsert params.

## Commands and output

- `.venv/bin/python -m pytest` -> `240 passed` (full suite; the new file alone is `55 passed`).
- `npm run typecheck` -> clean. `npx vitest run` -> `31 files, 414 passed`.
- Local DB `postgres://postgres@127.0.0.1:54329/spotlight_test`:
  - `--neighbourhoods`: exit 0, 25 rows per city, 250 total for all ten cities (Goa went from 0 to 25).
  - A second `--neighbourhoods` run: md5 over the whole table unchanged (`c7c9a492...`, 250 rows).
  - Default sync run twice: exit 0 both times. The md5 over `title_locations` is identical before, after run 1 and after run 2 (`b764445a...`, 18,069 rows), and the per-city/kind/source counts are identical to the first report, so nothing in `title_locations` changed. The neighbourhood work did not touch that table, and the breaker did not trip on a healthy run.

## Acceptance (actual rows in the DB, ordered north to south)

| City | Bar | Hit | Names present |
|---|---|---|---|
| Delhi | 4 of 6 | 5 | Hauz Khas, Connaught Place, Karol Bagh, Lajpat Nagar, Chandni Chowk (Saket absent) |
| Mumbai | 4 of 6 | 6 | Colaba, Worli, Bandra, Juhu, Andheri, Dadar |
| Bengaluru | 3 of 6 | 5 | Indiranagar, Koramangala, Whitefield, Jayanagar, Basavanagudi (Wikidata spells it "Malleswaram", which is also in the table) |
| New York | 4 of 6 | 5 | SoHo, Chelsea, Williamsburg, Astoria, Greenwich Village (Harlem absent, though East Harlem is there) |
| London | 4 of 6 | 4 | Soho, Camden Town, Brixton, Notting Hill (Shoreditch and Hackney absent) |
| Goa | 5 rows | 25 | includes Panaji, Calangute, Anjuna, Candolim, Margao (Baga seeded but outranked) |

Rows per city:
- Delhi: Ashok Vihar, Civil Lines, Chandni Chowk, Karol Bagh, Chawri Bazar, Daryaganj, Paharganj, Rajendra Nagar, Connaught Place, Indraprastha, Raisina Hill, Dwarka Sub City, Chanakyapuri, Kotla Mubarakpur Complex, Palam, Lajpat Nagar, Defence Colony, Okhla, Safdarjung, Shaheen Bagh, Nehru Place, Hauz Khas, Chittaranjan Park, Vasant Kunj, Mehrauli
- Mumbai: Borivali, Aarey Milk Colony, Goregaon, Andheri, Powai, Juhu, Ghatkopar, Kurla, Bandra Kurla Complex, Chembur, Bandra, Dharavi, Kharghar, Dadar, Trombay, Worli, Parel, Byculla, Mazagaon, Kamathipura, South Mumbai, Malabar Hill, Churchgate, Nariman Point, Colaba
- Bengaluru: Mathikere, Horamavu, Yeswanthpur, Ramamurthy Nagar, Kadugodi, Shivajinagar, Baiyyappanahalli, Malleswaram, Halasuru, Whitefield, Indiranagar, Jeevanbheemanagar, Austin Town, Nagarbhavi, Ejipura, Basavanagudi, Banashankari, Rajarajeshwari Nagar, Koramangala, Jayanagar, Taverekere, Chikkalasandra, Akshay Nagar, Anjanapura, Electronic City
- New York: East Harlem, Upper Manhattan, Upper West Side, Upper East Side, Columbus Circle, Astoria, Flushing, Hell's Kitchen, Times Square, Midtown Manhattan, Chelsea, Union Square, Greenwich Village, East Village, SoHo, Little Italy, Tribeca, Lower East Side, Chinatown, Battery Park City, Financial District, Lower Manhattan, Williamsburg, Brighton Beach, Coney Island
- London: Tottenham, Wembley, Hampstead, Camden Town, Bloomsbury, Holborn, Paddington, Whitechapel, City of London, East End of London, West End, Soho, Covent Garden, Mayfair, Notting Hill, Charing Cross, Canary Wharf, Kensington, Westminster, Belgravia, Chelsea, Greenwich, Fulham, Brixton, Wimbledon
- Goa: Morjim, Colvale, Siolim, Mapusa, Anjuna, Aldona, Guirim, Saligao, Calangute, Candolim, Reis Magos, Panaji, Mormugao, Chicalim, Vasco da Gama, Pale, Colva, Margao, Benaulim, Curchorem, Navelim, Quepem, Varca, Chinchinim, Cuncolim

All six cities meet their bar. Other cities (Hyderabad, Chennai, Pune, Kolkata) also have 25 rows each and look right (Banjara Hills/Jubilee Hills, Adyar/Mylapore, Koregaon Park/Kothrud, Alipore/Ballygunge).

## Remaining noise and caveats

- Ranking is by sitelinks only, so low-notability tails are arbitrary-but-deterministic: Bengaluru's tail (Mathikere, Horamavu, Taverekere) is small localities, and Mumbai has "Aarey Milk Colony". There is no category filter beyond the class list and suffix list.
- London meets its bar with exactly 4 (Shoreditch is returned by WDQS but ranks 42nd of 842 candidates at 31 sitelinks; Hackney's usable item has 7). I did not pad it.
- WDQS was throttled intermittently during the run (London's title sync took a few minutes of 429 cooldown); the 20-minute step budget and the breaker are sized for that.
- The 25 km search radius can pull in neighbours' areas (Mumbai's Kharghar/Trombay, Bengaluru's Hoskote-side localities). The 100 km guard is only a sanity bound and not a city boundary.
