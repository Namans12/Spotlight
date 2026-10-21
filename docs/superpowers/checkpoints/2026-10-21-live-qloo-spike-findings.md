# Live Qloo spike: findings and lock-in (2026-10-21)

First run of Release Pulse against the real Qloo hackathon host. This is a summary: it
holds no raw Qloo responses and no lists of returned entity, venue or brand names
(Qloo's terms forbid publishing its data). Raw output from `services/pulse/spike/spike.ts`
goes to the gitignored `services/pulse/spike/out/`. Tag-id taxonomy strings, counts and
qualitative statements are the only Qloo-derived content here.

## What the live run showed

**Worked as built**
- `where_popular` heatmap cells carry `lat`, `lon`, `geohash`, `affinity` and `popularity`,
  as the recipe reads them. Usually 20 cells per title and city; a very new title can have
  only a handful.
- `qloo_recommend` for places and artists, including `include_tags` filters. IMDb id to
  entity through `/entities` resolved reliably.
- `qloo_entity_tags`, `qloo_find_tags` and `qloo_audience_demographics` (for established
  titles) return what the recipes expect.

**Needed fixing (all fixed, see below)**
- Entity resolution: a transient TMDB failure made `resolveOmdbLookup` return null for three
  titles, and `resolveTitle` cached `not_found` for 3 days. They resolved fine on retry.
- Venue entity-tags are mostly noise. Food-relevant families are
  `urn:tag:specialty_dish:place:*`, `urn:tag:genre:place:*`, `urn:tag:cuisine:qloo:*`,
  `urn:tag:dining_option:qloo:*` and `urn:tag:popular_food_item:qloo:*`. The rest
  (`keyword`, `hobby`, `category`, `archetype`, `decor`, `amenity`, `style`, `lifestyle`,
  `hotel_rating`, `credit_card`, `cost_description`, `inclusivity`, `genre:brand`,
  `genre:music`, `genre:media`, ...) says nothing about food and was surfacing as "themes".
- Unfiltered brand recommendations for a food business were luxury cars and tech. With
  `include_tags: ["urn:tag:genre:brand:food_and_beverage"]` (verified live) they are food
  and drink brands.
- `qloo_recommend` for artists or brands answered HTTP 400 `QLOO_CONTRACT` (not retryable)
  for one brand-new title while working for others: a thin-signal entity. It was an `error`
  section, so it was never cached and re-failed on every request.
- Unfiltered places for a title include landmarks, hotels and malls alongside food places.
  Venue entities are sometimes duplicated.
- Demographics come back `ok` with zero rows (our `empty`) for brand-new 2026 releases.

## What changed

| Item | Change |
|---|---|
| L1 | `src/tmdbLookup.ts`: `lookupTmdbTitle` returns null only for a TMDB 404; retries network errors, timeouts, 429 (Retry-After capped at 2 s) and 5xx up to 3 times (250 ms, 750 ms backoff, 8 s timeout each); throws `TmdbUnavailableError` after that and `TmdbNotConfiguredError` for a missing key. `resolveTitle` uses it, caches nothing on a throw, memoises the lookup per resolution (a 404 included). Key and URL never appear in errors. |
| L2 | An empty demographics section says Qloo has no audience profile for the title yet. |
| L3 | A non-retryable `QLOO_CONTRACT` on artists, brands, places or the venue step of place themes is an `empty` section with an honest note (so it caches for 3 days) plus one `console.warn` line (call and code only). Auth, rate-limit and transport errors are unchanged. |
| L4 | Place themes keep only the five food families above, deduped by lowercased name (highest affinity), strongest first, capped at 12, with an honest empty note. Filtered at the client mapping step, so the cache holds the filtered list. Fixture tag ids use a food family. |
| L5 | Brands request `include_tags: ["urn:tag:genre:brand:food_and_beverage"]` (named constant, "verified live 2026-10-21"); provenance and limits text updated. |
| L6 | `places()` dedupes venues with the same name and address (case and padding aside), keeping the highest affinity, before any cap. Same-named venues at different addresses, or with no address, are kept. |
| L7 | Plan the Night's `places_open` fetch uses a broad food-and-drink tag set (queries restaurant, cafe, bar, dessert; first two place tags each) from the brief's memoised lookup. Cache kind and key unchanged. A failed tag lookup degrades the section and skips caching, as the brief does. |
| L8 | `src/qloo/recipes.ts` header records what is verified live and what is not. Throwaway probe scripts deleted; `spike/spike.ts` kept, lint-clean, with a usage header, and now resolves titles through `lookupTmdbTitle`. |

## Re-run after the changes

One run of `spike/spike.ts` (about 70 live calls):
- Entity resolution: 12 of 12 releases resolved (go/no-go bar was 7 of 10).
- Cafe-tag places returned a full list of venues for every title in Delhi, Mumbai and New
  York; every venue has an address, none has lat/lon or tags.
- Artists and brands: `ok` everywhere except one thin-signal title, where artists came back
  `empty` with the thin-signal note (and one contract-rejection warning in the log) instead
  of `error`.
- Themes are food-family names (dishes, cuisines, cafe and restaurant genres). Two of nine
  title-city combinations had no food theme left after filtering and show the empty note.
- Brands are food and drink brands (soft drinks, energy drinks, coffee).
- Demographics: `ok` for the established title, `empty` with the new note for the two
  brand-new ones. Trends: `empty` for all three.
- A separate small check of Plan the Night's tag set for one title in Delhi: the tag lookup
  succeeded (7 tag ids) and the list was no longer dominated by landmarks, but a museum
  still appeared and a banquet hall (dropped on read by the lodging filter).

## Still unverified / known gaps

- **Trends are empty for every title tried.** The recipe's point shape and field names are
  still guesses. The SPA hides a trend section that is not `ok`.
- **Demographics are empty for brand-new titles**, so the audience section is missing for
  exactly the releases the product is about; it needs a fallback or an honest empty state in
  the UI.
- **Venue coordinates and tags are absent** from the harness's place rows, so venues cannot
  be mapped and cannot be matched to themes.
- **Place themes can come out empty** (2 of 9 combinations in the re-run); `entity_tags` is
  asked for 20 tags over 10 venues and mostly returns noise for some cities. Raising the
  limit or merging more venues is untested.
- **Plan the Night may still show a landmark** (for example a museum) when its category is
  tagged as a place genre; the lodging blocklist does not cover it.
- **The contract-rejection mapping hides a genuine recipe bug as `empty`** in the UI; the
  only signal is the server-log warning, so watch the logs after any recipe change.
- **Groq (the campaign writer and chat) has not been run live.**
- Nothing is deployed, and the hackathon base URL is only exercised from a laptop.
