### Task 5: Filming-location and neighbourhood pipeline (Python)

**Files:**
- Create: `scripts/sync_title_locations.py`
- Create: `tests/test_sync_title_locations.py`
- Modify: `.github/workflows/ott-radar-nightly.yml`. Add a step after the
  watch-order syncs that runs `python scripts/sync_title_locations.py`
  with `DATABASE_URL`.

**Interfaces:**
- Consumes: `data/pulse_cities.json` (Task 3), and the `title_locations`,
  `places` and `neighbourhoods` tables (Task 3).
- Reuses: `run_query`, the `USER_AGENT` constant and the backoff pattern
  from `scripts/sync_relations_wikidata.py`. Import them, don't copy them.
- Produces:
  - CLI modes: `--check-categories` (verifies every listed category exists
    and prints its member count), `--neighbourhoods` (refills the
    `neighbourhoods` table), `--dry-run`, and the default (sync).
  - Pure functions:
    - `merge_rows(wikidata: list[LocRow], wikipedia: list[LocRow]) -> list[LocRow]`
    - `LocRow = (tmdb_id, media_type, city_slug, kind, source, landmark_label, lat, lon)`
    - `drop_suspect(rows) -> rows`, which removes the Ooty bulk-import
      place QID.

- [ ] **Step 1: Write failing tests.** Use a fake cursor, as in
  `tests/test_per_user_alerts.py`.

```python
def test_same_title_from_both_sources_becomes_both():
    wd = [(1, "movie", "delhi", "filmed", "wikidata", "Chandni Chowk", 28.65, 77.23)]
    wp = [(1, "movie", "delhi", "filmed", "wikipedia", None, None, None)]
    assert merge_rows(wd, wp) == [(1, "movie", "delhi", "filmed", "both", "Chandni Chowk", 28.65, 77.23)]

def test_new_delhi_rolls_up_to_delhi():
    assert city_for_qid("Q987") == "delhi"

def test_rows_without_tmdb_id_are_dropped():
    assert to_rows([{"qid": "Q1", "tmdb_movie": None, "tmdb_tv": None}], "delhi", "filmed", "wikipedia") == []

def test_ooty_bulk_import_is_ignored():
    rows = [(5, "movie", "ooty", "filmed", "wikidata", None, None, None)]
    assert drop_suspect(rows) == []

def test_subcategories_are_not_recursed():
    # categorymembers returns ns=14 (subcategory) and ns=0 (article); only ns=0 survive
    assert article_titles([{"ns": 14, "title": "Category:Indian Army in films"}, {"ns": 0, "title": "Rang De Basanti"}]) == ["Rang De Basanti"]
```

- [ ] **Step 2:** Run `pytest tests/test_sync_title_locations.py -v`.
  Expected: FAIL.
- [ ] **Step 3:** Implement each source as follows.
  - **Wikipedia:**
    - `action=query&generator=categorymembers&gcmtitle=Category:<name>&gcmlimit=500&gcmnamespace=0&prop=pageprops&ppprop=wikibase_item`,
      following `continue`.
    - QIDs → TMDB ids via SPARQL `VALUES` over P4947/P4983, in batches of
      ≤ 200.
  - **Wikidata:** P915 and P840 for each city's QIDs, plus P625 on the
    filming-location item for landmark coordinates. Page at ≤ 15k rows.
  - **Neighbourhoods:** items with `wdt:P31/wdt:P279* wd:Q123705`
    (neighbourhood) and `wdt:P131+ <city qid>`, with P625. Insert name, lat
    and lon. Print them for a hand check.
  - **Writes:** delete the city's rows, then insert, in one transaction per
    city.
- [ ] **Step 4:** Run `pytest`. Expected: PASS. Then run
  `python scripts/sync_title_locations.py --check-categories`.
  - Expected: a count printed for every category, with no `MISSING`.
  - Fix any `MISSING` name in `data/pulse_cities.json` and re-run.
  - Then run `--neighbourhoods` and the sync against the hackathon DB.
    Expect Delhi `filmed` ≥ 200 rows.
- [ ] **Step 5: Commit.**

```bash
git add scripts/sync_title_locations.py tests/test_sync_title_locations.py .github/workflows/ott-radar-nightly.yml data/pulse_cities.json
git commit -m "Fill title_locations from Wikipedia categories and Wikidata, nightly"
```

