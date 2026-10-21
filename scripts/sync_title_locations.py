"""Which titles were filmed in, or set in, each Release Pulse launch city.

Fills title_locations (plus places and neighbourhoods) from two sources:

  * Wikipedia category membership ("Films shot in Delhi", "Films set in
    Delhi", ...). Broad, because editors tag a film once it is shot there, but
    only a page title: it names no landmark.
  * Wikidata P915 (filming location) and P840 (narrative location), including
    items located *inside* the city, so a film shot at the Red Fort counts for
    Delhi and the Red Fort becomes its landmark.

A title both sources agree on is stored as source='both', the strongest signal
the table has.

Trust, in the spirit of sync_relations_wikidata.py (read its docstring: ~17% of
the Wikidata sequence edges it tried were wrong): a row is kept only when its
Wikidata item maps to a TMDB id through P4947 / P4983. There is no title-search
fallback and nothing is guessed. Wikidata is also known to carry a bulk-import
artefact, ~200 films "filmed in Ooty" (Q9888), which drop_suspect() and
wikidata_rows() refuse.

    python scripts/sync_title_locations.py --check-categories
    python scripts/sync_title_locations.py --neighbourhoods [--dry-run]
    python scripts/sync_title_locations.py [--dry-run] [--city delhi]

Production safety: the nightly workflow runs this against the production
database, where migration 0016 may not be applied. main() therefore checks the
three tables exist first and, when any is missing, prints one line and exits 0
without writing. It touches no table other than those three.

Failure policy: a WDQS timeout or Wikipedia error on one city's half is logged
and that half is skipped; the rows already stored for it are carried over so an
outage never wipes data. A city's delete + insert is one transaction, rolled
back on its own. The exit code is non-zero only when nothing at all could be
written because every source failed.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import requests  # noqa: E402

from lib_py.db import get_connection  # noqa: E402
from lib_relations import load_local_env, rate_limit_gap  # noqa: E402
from sync_relations_wikidata import (  # noqa: E402
    USER_AGENT,
    WDQS_GAP_SECONDS,
    WikidataUnavailable,
    run_sparql,
)

# (tmdb_id, media_type, city_slug, kind, source, landmark_label, lat, lon)
LocRow = tuple[int, str, str, str, str, str | None, float | None, float | None]
# (city_slug, name, lat, lon)
NbRow = tuple[str, str, float, float]

CITIES_PATH = ROOT / "data" / "pulse_cities.json"
PULSE_TABLES = ("title_locations", "places", "neighbourhoods")

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIPEDIA_ATTEMPTS = 4
WIKIPEDIA_TIMEOUT_SECONDS = 30
# MediaWiki accepts up to 50 titles per request for anonymous clients.
WIKIPEDIA_TITLE_BATCH = 50
# Wikipedia asks API clients to run serially, and one request at a time keeps
# the step polite on a shared nightly runner.
WIKIPEDIA_GAP_SECONDS = 0.3

TMDB_LOOKUP_BATCH = 200
WDQS_THROTTLE_ROUNDS = 3
WDQS_THROTTLE_COOLDOWN_SECONDS = 20
WDQS_PAGE_ROWS = 15_000

# Ooty (Udhagamandalam), Q9888. Wikidata has ~200 films with P915 = Ooty from
# a bulk import. It is not a launch city so those rows can never reach a city
# slug anyway; it is listed so a future widening of the city set (or an item
# someone nests under a launch city) cannot quietly import it.
OOTY_QID = "Q9888"
SUSPECT_PLACE_QIDS = frozenset({OOTY_QID})

NEIGHBOURHOOD_CAP = 25
SEED_PATH = ROOT / "data" / "pulse_neighbourhoods_seed.json"

# --- Neighbourhood search ---------------------------------------------------
#
# Why not "P131+ the city": Wikidata files an area under its district or tehsil
# (Hauz Khas -> South Delhi district, Lajpat Nagar -> Jangpura tehsil, Colaba ->
# Mumbai City district, Dadar -> Mumbai), and those chains never reach the city
# item, so a containment query missed nearly every notable Indian area (Delhi
# returned 15 rows, none of them Hauz Khas or Connaught Place). It is a recall
# problem, not a ranking one. Instead each class is asked for within a radius of
# the city centre (wikibase:around), which does not care how the area was filed,
# and the candidates are ranked by how many Wikipedia editions have an article
# (wikibase:sitelinks), which is what separates Colaba from a road with a
# coordinate. Distance and name rules in neighbourhood_rows() throw out the rest.
#
# One query per class, class-first within the radius, each answering in 1-8 s; a
# multi-class or city-first query timed out on WDQS. (qid, closure, why):
#   closure=True asks P31/P279*, safe only because the radius bounds the set.
NEIGHBOURHOOD_CLASSES: tuple[tuple[str, bool, str], ...] = (
    # Q123705 neighbourhood. Closure, because New York files its areas under
    # subclasses ("neighborhood of Manhattan", Q61297932: Harlem, SoHo, Chelsea).
    ("Q123705", True, "neighbourhood"),
    # Q188509 suburb: how Mumbai is typed (Bandra, Andheri, Juhu, Chembur).
    ("Q188509", False, "suburb"),
    # Q3257686 locality: Mumbai's Marol and Oshiwara, and similar small areas.
    ("Q3257686", False, "locality"),
    # Q2755753 area of London: London does not use "neighbourhood" at all
    # (Soho, Camden Town, Brixton, Notting Hill are all typed this way).
    ("Q2755753", False, "area of London"),
    # Q738570 central business district: Connaught Place, which is a place
    # people name a heatmap cell after but is typed as nothing else.
    ("Q738570", False, "central business district"),
    # Deliberately NOT Q486972 "human settlement": some editors type a real area
    # that way (Dadar, Koramangala, Baga) but Wikidata also files every census
    # town and village on a city's outskirts under it. In Delhi those outnumber
    # the areas and, with ~25 slots, pushed out Karol Bagh and Hauz Khas (Loni,
    # Nangloi Jat and Karawal Nagar took their places). The handful of areas that
    # are typed that way come in through the seed file instead.
)

# Cities that need more classes because they have no neighbourhood layer in
# Wikidata. Goa is a state: what people name there are towns and the villages
# and census towns of its coast (Panaji, Margao, Calangute, Anjuna, Candolim).
NEIGHBOURHOOD_EXTRA_CLASSES: dict[str, tuple[tuple[str, bool, str], ...]] = {
    "goa": (
        ("Q515", False, "city"),
        ("Q3957", False, "town"),
        ("Q56436498", False, "village in India"),
        ("Q16830604", False, "census town of India"),
    ),
}

# wikibase:around radius in km. Goa is ~100 km long and its centre is Panaji.
NEIGHBOURHOOD_RADIUS_KM_DEFAULT = 25
NEIGHBOURHOOD_RADIUS_KM = {"goa": 45}
# A point further than this from the city centre is a bad coordinate or a wrong
# place, whatever the query said.
NEIGHBOURHOOD_MAX_DISTANCE_KM = 100

# Labels that are streets or broad regions rather than areas.
# " kaval" (Bengaluru's "<Name> Manavarthe Kaval" protected grazing land) and
# " avenue" (Fifth Avenue outranks most real areas) are the ones that showed up
# in the real data.
NON_AREA_SUFFIXES = (" road", " marg", " street", " avenue", " suburbs", " kaval")

# fullmatch and [0-9]: "$" would let a trailing newline through, and \d accepts
# non-ASCII digits.
_QID_RE = re.compile(r"Q[0-9]+")


class SourceUnavailable(Exception):
    """A source gave no usable answer after retries. Not evidence of anything
    about the data, only that we could not ask. `source` says which one
    ("wikipedia" or "wdqs"), for the circuit breaker."""

    def __init__(self, message: str, source: str = "wdqs"):
        super().__init__(message)
        self.source = source


class CircuitBreaker:
    """Stops asking a source that has failed for `limit` cities in a row.

    A Wikipedia or WDQS outage makes every city burn its full retry budget
    (minutes each); once two consecutive cities have failed on a source the
    outage is not going to end mid-run, so the remaining cities skip it and the
    step finishes inside its time budget."""

    def __init__(self, limit: int = 2):
        self.limit = limit
        self._streak: dict[str, int] = {}
        self.open: set[str] = set()

    def blocked(self, *sources: str) -> bool:
        return any(s in self.open for s in sources)

    def record_city(self, failed: set[str], ok: set[str]) -> None:
        """Call once per city: `failed` sources broke it, `ok` ones worked."""
        for source in ok - failed:
            self._streak[source] = 0
        for source in failed:
            self._streak[source] = self._streak.get(source, 0) + 1
            if self._streak[source] >= self.limit and source not in self.open:
                self.open.add(source)
                print(f"  {source} failed for {self.limit} cities in a row; not trying it for the remaining cities")


def load_cities() -> list[dict[str, Any]]:
    return json.loads(CITIES_PATH.read_text(encoding="utf-8"))


CITIES = load_cities()
CITY_SLUGS = frozenset(c["slug"] for c in CITIES)
# Several QIDs per city (Delhi Q1353 and New Delhi Q987 are different items),
# so the lookup is QID -> slug and an alias is a data change, not a code one.
_QID_TO_CITY = {qid: c["slug"] for c in CITIES for qid in c["qids"]}


def city_for_qid(qid: str) -> str | None:
    return _QID_TO_CITY.get(qid)


# --------------------------------------------------------------------------- #
# Pure row logic
# --------------------------------------------------------------------------- #


def article_members(members: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Articles only. categorymembers also returns subcategories (ns 14), and
    recursing into them pulls in tangents ("Indian Army in films" under a city
    category), so they are deliberately ignored."""
    return [m for m in members if m.get("ns") == 0]


def article_titles(members: list[dict[str, Any]]) -> list[str]:
    return [m["title"] for m in article_members(members)]


def _tmdb_id(value: Any) -> int | None:
    text = str(value).strip() if value is not None else ""
    return int(text) if text.isdigit() else None


def to_rows(items: list[dict[str, Any]], city: str, kind: str, source: str) -> list[LocRow]:
    """QID items -> rows. An item with no TMDB id is dropped, never matched by
    title: that is the whole point of going through P4947 / P4983."""
    rows: list[LocRow] = []
    for item in items:
        for key, media in (("tmdb_movie", "movie"), ("tmdb_tv", "tv")):
            tmdb_id = _tmdb_id(item.get(key))
            if tmdb_id is not None:
                rows.append((tmdb_id, media, city, kind, source, None, None, None))
    return rows


def drop_suspect(rows: list[LocRow]) -> list[LocRow]:
    """Drop rows outside the ten launch cities. This is where a place that
    leaked in from somewhere else (the Ooty bulk import) is stopped."""
    return [r for r in rows if r[2] in CITY_SLUGS]


def merge_rows(wikidata: list[LocRow], wikipedia: list[LocRow]) -> list[LocRow]:
    """One row per primary key. Both sources naming the same title becomes
    'both'. When several rows share a key (a film with several filming spots in
    the city) the landmark is the first label alphabetically, so the stored
    value does not depend on the order WDQS answered in."""
    groups: dict[tuple, list[LocRow]] = {}
    for row in [*wikidata, *wikipedia]:
        groups.setdefault((row[0], row[1], row[2], row[3]), []).append(row)

    merged: list[LocRow] = []
    for key in sorted(groups, key=lambda k: (k[2], k[3], k[0], k[1])):
        rows = groups[key]
        sources = {r[4] for r in rows}
        source = "both" if len(sources) > 1 or "both" in sources else next(iter(sources))
        labelled = sorted((r for r in rows if r[5]), key=lambda r: (r[5], r[6] or 0.0, r[7] or 0.0))
        label, lat, lon = labelled[0][5:8] if labelled else (None, None, None)
        merged.append((key[0], key[1], key[2], key[3], source, label, lat, lon))
    return merged


def carry_over(stored: list[LocRow], source: str) -> list[LocRow]:
    """Stand in for a source that could not be fetched, using what an earlier
    run stored. 'both' rows count for either source; the landmark belongs to
    Wikidata so it is kept only when Wikidata is the one being stood in for."""
    keep_landmark = source == "wikidata"
    out: list[LocRow] = []
    for r in stored:
        if r[4] not in (source, "both"):
            continue
        out.append((r[0], r[1], r[2], r[3], source, *(r[5:8] if keep_landmark else (None, None, None))))
    return out


def _qid(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


def _val(binding: dict[str, Any], key: str) -> str | None:
    entry = binding.get(key)
    return entry.get("value") if entry else None


def parse_point(wkt: str | None) -> tuple[float, float] | None:
    """'Point(lon lat)' -> (lat, lon). WKT puts longitude first."""
    if not wkt or not wkt.startswith("Point(") or not wkt.endswith(")"):
        return None
    try:
        lon_s, lat_s = wkt[6:-1].split()
        return float(lat_s), float(lon_s)
    except ValueError:
        return None


def wikidata_rows(bindings: list[dict[str, Any]], kind: str) -> list[LocRow]:
    """WDQS bindings (?city ?loc ?locLabel ?coord ?tm ?tv) -> rows.

    The landmark is the filming-location item, and only for 'filmed' rows and
    only when that item is something inside the city rather than the city
    (or one of its aliases) itself. It needs an English label and coordinates,
    since a name without a point cannot be drawn."""
    rows: list[LocRow] = []
    for b in bindings:
        city_qid = _qid(_val(b, "city") or "")
        loc_qid = _qid(_val(b, "loc") or "")
        slug = city_for_qid(city_qid)
        if slug is None or loc_qid in SUSPECT_PLACE_QIDS:
            continue

        label = lat = lon = None
        if kind == "filmed" and city_for_qid(loc_qid) is None:
            name = _val(b, "locLabel")
            point = parse_point(_val(b, "coord"))
            # The label service falls back to the bare QID when there is no
            # English label; that is not a name anyone should see.
            if name and point and name != loc_qid:
                label, (lat, lon) = name, point

        for key, media in (("tm", "movie"), ("tv", "tv")):
            tmdb_id = _tmdb_id(_val(b, key))
            if tmdb_id is not None:
                rows.append((tmdb_id, media, slug, kind, "wikidata", label, lat, lon))
    return rows


def valid_qid(value: str) -> bool:
    """QIDs get interpolated into SPARQL text, so only the exact shape is let in."""
    return bool(_QID_RE.fullmatch(value))


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance (haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def clean_label(label: str) -> str:
    """Whitespace collapsed, trailing dots and similar stripped ("Paschim Vihar.."
    -> "Paschim Vihar")."""
    return re.sub(r"[\s.,;:\-\u2013\u2014]+$", "", " ".join(label.split()))


def neighbourhood_rows(bindings: list[dict[str, Any]], city: dict[str, Any], cap: int = NEIGHBOURHOOD_CAP) -> list[NbRow]:
    """The `cap` most notable named areas of a city, from WDQS bindings
    (?item ?label ?coord ?sl).

    Ranked by (-sitelinks, label, QID, point), so a re-run writes the same table
    and no threshold stops a small city from getting rows. Dropped: no
    coordinates (the labeller needs both), more than NEIGHBOURHOOD_MAX_DISTANCE_KM
    from the centre, no English label, a label that is the city itself, and
    streets/regions by label. Duplicates collapse by QID first (an item answers
    under several classes), then by case-insensitive name, keeping the more
    notable item, since the primary key is case-sensitive but two spellings of
    one area on a map are not."""
    candidates = []
    for b in bindings:
        point = parse_point(_val(b, "coord"))
        name = clean_label(_val(b, "label") or "")
        qid = _qid(_val(b, "item") or "")
        if point is None or not name or not qid:
            continue
        if name[0] == "Q" and name[1:].isdigit():  # no English label
            continue
        if name.lower() == city["name"].lower() or name.lower().endswith(NON_AREA_SUFFIXES):
            continue
        if distance_km(city["lat"], city["lon"], *point) > NEIGHBOURHOOD_MAX_DISTANCE_KM:
            continue
        try:
            sitelinks = int(_val(b, "sl") or 0)
        except ValueError:
            sitelinks = 0
        candidates.append((-sitelinks, name, qid, point))
    candidates.sort()

    seen_qids: set[str] = set()
    seen_names: set[str] = set()
    rows: list[NbRow] = []
    for _, name, qid, (lat, lon) in candidates:
        if qid in seen_qids or name.lower() in seen_names:
            continue
        seen_qids.add(qid)
        seen_names.add(name.lower())
        rows.append((city["slug"], name, lat, lon))
        if len(rows) == cap:
            break
    return rows


def load_seed() -> dict[str, list[str]]:
    """Curated notable-area QIDs per city for the places the classes cannot
    reach. QIDs only: names and coordinates are still read from Wikidata."""
    if not SEED_PATH.exists():
        return {}
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    return {slug: [q for q in qids if valid_qid(q)] for slug, qids in seed.items()}


# --------------------------------------------------------------------------- #
# Sources
# --------------------------------------------------------------------------- #


def new_session() -> requests.Session:
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    return session


def wdqs(session: requests.Session, query: str) -> list[dict[str, Any]]:
    """run_sparql plus the >= 1 s gap WDQS asks of anonymous clients.

    run_sparql's own backoff is 1-2 s, which is too short to clear a WDQS
    throttle (a 429 follows a run of slow queries and lasts well beyond that),
    so a 429 gets a longer cooldown and one more round before giving up."""
    for round_ in range(WDQS_THROTTLE_ROUNDS):
        try:
            return run_sparql(session, query)
        except WikidataUnavailable as err:
            if "HTTP 429" in str(err) and round_ < WDQS_THROTTLE_ROUNDS - 1:
                rate_limit_gap(WDQS_THROTTLE_COOLDOWN_SECONDS * (round_ + 1))
                continue
            raise SourceUnavailable(f"WDQS: {err}", "wdqs") from err
        finally:
            rate_limit_gap(WDQS_GAP_SECONDS)
    raise AssertionError("unreachable")  # pragma: no cover


def wikipedia_get(session: requests.Session, params: dict[str, Any]) -> dict[str, Any]:
    """One MediaWiki API call with exponential backoff on 429 / 5xx / timeouts."""
    last: Exception | str = "no attempt made"
    for attempt in range(WIKIPEDIA_ATTEMPTS):
        try:
            response = session.get(
                WIKIPEDIA_API,
                params={"format": "json", "formatversion": "2", **params},
                headers={"User-Agent": USER_AGENT},
                timeout=WIKIPEDIA_TIMEOUT_SECONDS,
            )
        except requests.RequestException as err:
            last = err
        else:
            if response.status_code == 200:
                try:
                    body = response.json()
                except ValueError as err:
                    last = f"unparseable response: {err}"
                else:
                    if "error" not in body:
                        rate_limit_gap(WIKIPEDIA_GAP_SECONDS)
                        return body
                    last = f"API error: {body['error'].get('info', body['error'])}"
            else:
                last = f"HTTP {response.status_code}"
        if attempt < WIKIPEDIA_ATTEMPTS - 1:
            rate_limit_gap(2**attempt)
    raise SourceUnavailable(f"Wikipedia: {last}", "wikipedia")


def category_member_pages(session: requests.Session, category: str) -> list[dict[str, Any]]:
    """Every article in a category, with its Wikidata item, following `continue`."""
    pages: list[dict[str, Any]] = []
    params: dict[str, Any] = {
        "action": "query",
        "generator": "categorymembers",
        "gcmtitle": f"Category:{category}",
        "gcmlimit": 500,
        "gcmnamespace": 0,
        "prop": "pageprops",
        "ppprop": "wikibase_item",
    }
    while True:
        body = wikipedia_get(session, params)
        pages.extend(body.get("query", {}).get("pages", []))
        if "continue" not in body:
            return pages
        params = {**params, **body["continue"]}


def check_categories(session: requests.Session) -> int:
    """Print the member count of every configured category; MISSING when the
    category page does not exist (a mistyped name would otherwise quietly
    yield zero films)."""
    names = sorted({n for c in CITIES for group in c["wikipedia"].values() for n in group})
    info: dict[str, dict[str, Any]] = {}
    for i in range(0, len(names), WIKIPEDIA_TITLE_BATCH):
        batch = names[i : i + WIKIPEDIA_TITLE_BATCH]
        body = wikipedia_get(
            session,
            {"action": "query", "prop": "categoryinfo", "titles": "|".join(f"Category:{n}" for n in batch)},
        )
        for page in body.get("query", {}).get("pages", []):
            info[page["title"].removeprefix("Category:").replace(" ", "_")] = page
        # Titles are normalised (underscores -> spaces) and may be redirected
        # by the API; the key above undoes the former.
    missing = 0
    for name in names:
        page = info.get(name)
        if page is None or page.get("missing"):
            print(f"MISSING  {name}")
            missing += 1
            continue
        ci = page.get("categoryinfo", {})
        print(f"{ci.get('pages', 0):>6} articles  {ci.get('subcats', 0):>3} subcats  {name}")
    if missing:
        print(f"{missing} categories MISSING")
    return 1 if missing else 0


QID_TO_TMDB_QUERY = """
SELECT ?item ?tm ?tv WHERE {
  VALUES ?item { %s }
  OPTIONAL { ?item wdt:P4947 ?tm }
  OPTIONAL { ?item wdt:P4983 ?tv }
}
"""


def tmdb_ids_for_qids(session: requests.Session, qids: list[str], cache: dict[str, list[dict[str, Any]]]) -> None:
    """Fill `cache` with {qid: [{'qid', 'tmdb_movie', 'tmdb_tv'}, ...]} for every
    QID not already in it. A QID with no TMDB property comes back as an empty
    list, so it is not asked about twice."""
    # Only well-formed QIDs reach the query text; Wikipedia's pageprops are
    # data from the network, not something to paste into SPARQL unchecked.
    todo = sorted({q for q in qids if q not in cache and valid_qid(q)})
    for i in range(0, len(todo), TMDB_LOOKUP_BATCH):
        batch = todo[i : i + TMDB_LOOKUP_BATCH]
        bindings = wdqs(session, QID_TO_TMDB_QUERY % " ".join(f"wd:{q}" for q in batch))
        found: dict[str, list[dict[str, Any]]] = {q: [] for q in batch}
        for b in bindings:
            qid = _qid(_val(b, "item") or "")
            if qid in found and (_val(b, "tm") or _val(b, "tv")):
                found[qid].append({"qid": qid, "tmdb_movie": _val(b, "tm"), "tmdb_tv": _val(b, "tv")})
        cache.update(found)


_tmdb_cache: dict[str, list[dict[str, Any]]] = {}


def fetch_wikipedia_rows(session: requests.Session, city: dict[str, Any]) -> list[LocRow]:
    rows: list[LocRow] = []
    for kind, categories in city["wikipedia"].items():
        qids: set[str] = set()
        for category in categories:
            for page in article_members(category_member_pages(session, category)):
                qid = (page.get("pageprops") or {}).get("wikibase_item")
                if qid:
                    qids.add(qid)
        tmdb_ids_for_qids(session, sorted(qids), _tmdb_cache)
        items = [item for q in sorted(qids) for item in _tmdb_cache.get(q, [])]
        rows.extend(to_rows(items, city["slug"], kind, "wikipedia"))
    return rows


WIKIDATA_QUERY = """
SELECT ?city ?loc ?locLabel ?coord ?tm ?tv WHERE {
  VALUES ?city { %(cities)s }
  ?loc wdt:P131* ?city .
  ?film wdt:%(prop)s ?loc .
  OPTIONAL { ?film wdt:P4947 ?tm }
  OPTIONAL { ?film wdt:P4983 ?tv }
  FILTER(BOUND(?tm) || BOUND(?tv))
  OPTIONAL { ?loc wdt:P625 ?coord }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?film ?loc ?city
LIMIT %(limit)d OFFSET %(offset)d
"""


def fetch_wikidata_rows(session: requests.Session, city: dict[str, Any]) -> list[LocRow]:
    """P915 / P840 for the city and for anything located inside it (P131*)."""
    values = " ".join(f"wd:{q}" for q in city["qids"])
    rows: list[LocRow] = []
    for kind, prop in (("filmed", "P915"), ("set", "P840")):
        offset = 0
        while True:
            bindings = wdqs(
                session,
                WIKIDATA_QUERY % {"cities": values, "prop": prop, "limit": WDQS_PAGE_ROWS, "offset": offset},
            )
            rows.extend(wikidata_rows(bindings, kind))
            if len(bindings) < WDQS_PAGE_ROWS:
                break
            offset += WDQS_PAGE_ROWS
    return rows


def fetch_place_names(session: requests.Session) -> dict[str, str]:
    """English labels for every launch-city QID. Best effort: the city's own
    name stands in when WDQS is down, so places is never left unwritten."""
    qids = sorted(_QID_TO_CITY)
    query = "SELECT ?item ?label WHERE { VALUES ?item { %s } ?item rdfs:label ?label FILTER(LANG(?label) = 'en') }" % (
        " ".join(f"wd:{q}" for q in qids)
    )
    try:
        bindings = wdqs(session, query)
    except SourceUnavailable as err:
        print(f"  place labels unavailable, using city names: {err}")
        return {}
    return {_qid(_val(b, "item") or ""): _val(b, "label") or "" for b in bindings}


NEIGHBOURHOOD_QUERY = """
SELECT DISTINCT ?item ?label ?coord ?sl WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(%(lon)s %(lat)s)"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "%(radius)s" .
  }
  ?item %(path)s wd:%(cls)s .
  ?item wikibase:sitelinks ?sl .
  ?item rdfs:label ?label FILTER(LANG(?label) = "en")
}
"""

SEED_QUERY = """
SELECT DISTINCT ?item ?label ?coord ?sl WHERE {
  VALUES ?item { %s }
  ?item wdt:P625 ?coord .
  ?item wikibase:sitelinks ?sl .
  ?item rdfs:label ?label FILTER(LANG(?label) = "en")
}
"""


def fetch_neighbourhood_bindings(session: requests.Session, city: dict[str, Any]) -> list[dict[str, Any]]:
    """Candidates for one city: every class within the radius, plus the seed.
    If any query fails the whole city is reported unavailable, since a table
    rebuilt from some of the classes would silently shrink."""
    slug = city["slug"]
    bindings: list[dict[str, Any]] = []
    for cls, closure, _why in (*NEIGHBOURHOOD_CLASSES, *NEIGHBOURHOOD_EXTRA_CLASSES.get(slug, ())):
        bindings.extend(
            wdqs(
                session,
                NEIGHBOURHOOD_QUERY
                % {
                    "lon": city["lon"],
                    "lat": city["lat"],
                    "radius": NEIGHBOURHOOD_RADIUS_KM.get(slug, NEIGHBOURHOOD_RADIUS_KM_DEFAULT),
                    "path": "wdt:P31/wdt:P279*" if closure else "wdt:P31",
                    "cls": cls,
                },
            )
        )
    seed = load_seed().get(slug, [])
    if seed:
        bindings.extend(wdqs(session, SEED_QUERY % " ".join(f"wd:{q}" for q in seed)))
    return bindings


# --------------------------------------------------------------------------- #
# Database
# --------------------------------------------------------------------------- #


def missing_tables(cur: Any) -> list[str]:
    """The Pulse tables this database does not have. to_regclass returns NULL
    for a missing relation instead of raising, so the check cannot itself fail
    on an un-migrated database."""
    missing = []
    for table in PULSE_TABLES:
        cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
        if cur.fetchone()[0] is None:
            missing.append(table)
    return missing


INSERT_LOCATION = """
INSERT INTO title_locations
  (tmdb_id, media_type, city_slug, kind, source, landmark_label, landmark_lat, landmark_lon)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
"""
UPSERT_PLACE = """
INSERT INTO places (qid, city_slug, name) VALUES (%s, %s, %s)
ON CONFLICT (qid) DO UPDATE SET city_slug = EXCLUDED.city_slug, name = EXCLUDED.name
"""
SELECT_STORED = """
SELECT tmdb_id, media_type, city_slug, kind, source, landmark_label, landmark_lat, landmark_lon
FROM title_locations WHERE city_slug = %s
"""


def stored_rows(cur: Any, slug: str) -> list[LocRow]:
    cur.execute(SELECT_STORED, (slug,))
    return [tuple(r) for r in cur.fetchall()]  # type: ignore[misc]


def write_city(conn: Any, city: dict[str, Any], rows: list[LocRow], names: dict[str, str]) -> None:
    """Replace one city's rows in a single transaction. places gets one row per
    QID, aliases included, so a QID seen anywhere resolves to its city."""
    slug = city["slug"]
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM title_locations WHERE city_slug = %s", (slug,))
            if rows:
                cur.executemany(INSERT_LOCATION, rows)
            for qid in city["qids"]:
                cur.execute(UPSERT_PLACE, (qid, slug, names.get(qid) or city["name"]))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def write_neighbourhoods(conn: Any, slug: str, rows: list[NbRow]) -> None:
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM neighbourhoods WHERE city_slug = %s", (slug,))
            if rows:
                cur.executemany("INSERT INTO neighbourhoods (city_slug, name, lat, lon) VALUES (%s, %s, %s, %s)", rows)
        conn.commit()
    except Exception:
        conn.rollback()
        raise


# --------------------------------------------------------------------------- #
# Runs
# --------------------------------------------------------------------------- #


def _half(
    label: str, slug: str, fetch: Callable[[], list[LocRow]], failures: set[str], skip: bool
) -> list[LocRow] | None:
    """Run one half; None means "no usable answer" (failed or skipped by the
    breaker). The failing source is added to `failures`."""
    if skip:
        print(f"  {slug}: {label} skipped (source marked unavailable this run)")
        return None
    try:
        rows = fetch()
    except SourceUnavailable as err:
        failures.add(err.source)
        print(f"  {slug}: {label} unavailable, skipping: {err}")
        return None
    print(f"  {slug}: {label} gave {len(rows)} rows")
    return rows


def _stored(conn: Any, slug: str) -> list[LocRow]:
    with conn.cursor() as cur:
        old = stored_rows(cur, slug)
    conn.rollback()  # a read, but psycopg opened a transaction for it
    return old


def sync_titles(conn: Any, cities: list[dict[str, Any]], dry_run: bool) -> int:
    session = new_session()
    names = fetch_place_names(session)
    breaker = CircuitBreaker()
    written = failed = 0

    for city in cities:
        slug = city["slug"]
        failures: set[str] = set()
        wikipedia = _half(
            "Wikipedia half", slug, lambda: fetch_wikipedia_rows(session, city), failures, breaker.blocked("wikipedia", "wdqs")
        )
        wikidata = _half("Wikidata half", slug, lambda: fetch_wikidata_rows(session, city), failures, breaker.blocked("wdqs"))
        breaker.record_city(
            failures,
            ({"wikipedia", "wdqs"} if wikipedia is not None else set()) | ({"wdqs"} if wikidata is not None else set()),
        )

        # A source that answers with nothing while rows from it are stored is
        # far more likely broken (a renamed category, a changed query) than
        # right, and trusting it would delete a city's data. Treat as failed.
        stored: list[LocRow] | None = None
        for source, rows in (("wikipedia", wikipedia), ("wikidata", wikidata)):
            if rows == [] and conn is not None:
                stored = _stored(conn, slug) if stored is None else stored
                if carry_over(stored, source):
                    print(f"  {slug}: {source} returned no rows but some are stored; keeping the stored rows")
                    if source == "wikipedia":
                        wikipedia = None
                    else:
                        wikidata = None
        if wikipedia is None and wikidata is None:
            failed += 1
            continue

        try:
            if wikipedia is None or wikidata is None:
                # Rebuilding from half the evidence would delete what the other
                # source supplied last time, so stand in with what is stored.
                # A dry run has no connection to read from, so it simply
                # reports the half it has.
                if conn is not None:
                    old = stored if stored is not None else _stored(conn, slug)
                    wikipedia = carry_over(old, "wikipedia") if wikipedia is None else wikipedia
                    wikidata = carry_over(old, "wikidata") if wikidata is None else wikidata
            rows = drop_suspect(merge_rows(wikidata or [], wikipedia or []))

            counts: dict[tuple[str, str], int] = {}
            for r in rows:
                counts[(r[3], r[4])] = counts.get((r[3], r[4]), 0) + 1
            summary = ", ".join(f"{k}/{s}={n}" for (k, s), n in sorted(counts.items())) or "no rows"
            if dry_run:
                print(f"  {slug}: would write {len(rows)} rows ({summary})")
                written += 1
                continue
            write_city(conn, city, rows, names)
            print(f"  {slug}: wrote {len(rows)} rows ({summary})")
            written += 1
        except Exception as err:  # one city's failed write must not stop the others
            failed += 1
            print(f"  {slug}: write failed and was rolled back: {err}")

    # Non-zero only when nothing at all got through; a partial outage is
    # logged above but is not a failed night.
    return 1 if written == 0 and failed else 0


def has_neighbourhoods(conn: Any, slug: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM neighbourhoods WHERE city_slug = %s LIMIT 1", (slug,))
        found = cur.fetchone() is not None
    conn.rollback()
    return found


def sync_neighbourhoods(conn: Any, cities: list[dict[str, Any]], dry_run: bool) -> int:
    session = new_session()
    breaker = CircuitBreaker()
    written = failed = 0
    for city in cities:
        slug = city["slug"]
        if breaker.blocked("wdqs"):
            failed += 1
            print(f"  {slug}: neighbourhoods skipped (WDQS marked unavailable this run)")
            continue
        try:
            rows = neighbourhood_rows(fetch_neighbourhood_bindings(session, city), city)
        except SourceUnavailable as err:
            failed += 1
            breaker.record_city({"wdqs"}, set())
            print(f"  {slug}: neighbourhoods unavailable, skipping: {err}")
            continue
        breaker.record_city(set(), {"wdqs"})
        print(f"  {slug}: {len(rows)} neighbourhoods")
        for _, name, lat, lon in rows:
            print(f"      {name}  ({lat:.4f}, {lon:.4f})")
        if dry_run:
            written += 1
            continue
        if not rows and has_neighbourhoods(conn, slug):
            # Same reasoning as for title_locations: an empty answer must not
            # erase rows that an earlier run found.
            failed += 1
            print(f"  {slug}: no neighbourhoods returned but some are stored; keeping them")
            continue
        try:
            write_neighbourhoods(conn, slug, rows)
            written += 1
        except Exception as err:
            failed += 1
            print(f"  {slug}: write failed and was rolled back: {err}")
    return 1 if written == 0 and failed else 0


def main(argv: list[str] | None = None, connect: Callable[[], Any] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check-categories", action="store_true", help="verify every Wikipedia category exists")
    parser.add_argument("--neighbourhoods", action="store_true", help="refill the neighbourhoods table")
    parser.add_argument("--dry-run", action="store_true", help="fetch and print, write nothing")
    parser.add_argument("--city", action="append", choices=sorted(CITY_SLUGS), help="limit to a city (repeatable)")
    args = parser.parse_args(argv)

    cities = [c for c in CITIES if not args.city or c["slug"] in args.city]

    if args.check_categories:
        return check_categories(new_session())

    conn = None
    if not args.dry_run:
        load_local_env(ROOT)
        if connect is None and not os.environ.get("DATABASE_URL"):
            print("DATABASE_URL is not set; skipping the title_locations sync.")
            return 0
        conn = (connect or get_connection)()
    try:
        if conn is not None:
            # Guard first: production may not have migration 0016, and this
            # step must be a harmless no-op there rather than a red nightly.
            with conn.cursor() as cur:
                absent = missing_tables(cur)
            conn.rollback()
            if absent:
                print(f"Skipping: table(s) {', '.join(absent)} not found (migration 0016 not applied); nothing written.")
                return 0
        if args.neighbourhoods:
            return sync_neighbourhoods(conn, cities, args.dry_run)
        return sync_titles(conn, cities, args.dry_run)
    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
