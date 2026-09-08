"""OTT Radar (ReleaseBot).

Twice-weekly OTT release digest for India:
  - Hindi OTT releases (movies + shows)
  - English OTT releases (movies + shows)
  - Popular releases in any other language above a popularity threshold

Runs Wednesday and Friday at 2:00 PM IST via GitHub Actions.
Each digest has two parts:
  - "Out Now"   : releases from today until the day before the next run
  - "Coming Up" : releases in the ~7 days after that (forward preview)

Delivery: Telegram push + HTML email + a Postgres table the web app reads.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import smtplib
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

# Re-exported by requests since 2.26; imported from here rather than urllib3
# directly, which is only a transitive dependency and is not pinned.
from requests.adapters import HTTPAdapter, Retry

import news_sources
from platform_names import normalize_platform, normalize_platforms


TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500"
TELEGRAM_BASE_URL = "https://api.telegram.org"

# GitHub Actions runs Wednesday (2) and Friday (4). Monday is 0.
TRIGGER_WEEKDAYS = (2, 4)

SECTION_ORDER = ("hindi", "english", "popular")
SECTION_LABELS = {
    "hindi": "Hindi OTT",
    "english": "English OTT",
    "popular": "Popular (Other Languages)",
}
SECTION_EMOJI = {
    "hindi": "🇮🇳",
    "english": "🌍",
    "popular": "🔥",
}


@dataclass(frozen=True)
class ReleaseItem:
    tmdb_id: int
    title: str
    media_type: str
    language: str
    release_date: str
    rating: float | None
    popularity: float
    overview: str
    tmdb_url: str
    poster_url: str | None
    providers: tuple[str, ...] = ()


def env_required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def env_list(name: str, default: str) -> list[str]:
    return [part.strip() for part in os.getenv(name, default).split(",") if part.strip()]


def env_required_list(name: str) -> list[str]:
    parts = [part.strip() for part in env_required(name).split(",") if part.strip()]
    if not parts:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return parts


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class TmdbClient:
    def __init__(self, api_key: str, region: str) -> None:
        self.api_key = api_key
        self.region = region
        self.session = requests.Session()
        # Retries live on the adapter, not in a wrapper around session.get():
        # urllib3 retries a dropped connection on a fresh one from the pool,
        # which is what a TMDB-side reset needs, and it is safe to share across
        # the eight worker threads the fetchers use. pool_maxsize matches that
        # fan-out so threads don't discard and rebuild connections under load.
        retry = Retry(
            total=4,
            connect=4,
            read=3,
            backoff_factor=0.6,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET"}),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=16)
        self.session.mount("https://", adapter)

        # Opt-in response cache, off unless TMDB_CACHE_DIR is set. It exists for
        # two reasons. Development: a full digest is ~400 requests, and on a
        # network that resets connections a single run may never finish — with a
        # cache each attempt keeps what it got, so repeated runs converge. And
        # re-running the pipeline to check a change stops being rate-limited
        # guesswork. Deliberately NOT on by default in production: provider
        # attribution appears days after a title goes live, and serving that from
        # a stale cache is exactly the staleness this radar exists to avoid.
        raw_dir = os.getenv("TMDB_CACHE_DIR", "").strip()
        self.cache_dir = Path(raw_dir) if raw_dir else None
        self.cache_ttl = float(os.getenv("TMDB_CACHE_TTL_SECONDS", "21600"))  # 6h
        if self.cache_dir:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            print(
                f"  TMDB cache: {self.cache_dir} (ttl {self.cache_ttl:.0f}s)",
                file=sys.stderr,
            )

    def _cache_path(self, path: str, params: dict[str, Any]) -> Path | None:
        if not self.cache_dir:
            return None
        # api_key is excluded from the key so a rotated key doesn't orphan the
        # cache, and so the filename never contains a secret.
        payload = json.dumps(
            [path, sorted((k, str(v)) for k, v in params.items() if k != "api_key")],
            sort_keys=True,
        )
        return self.cache_dir / f"{hashlib.sha256(payload.encode()).hexdigest()}.json"

    def get(self, path: str, **params: Any) -> dict[str, Any]:
        cached = self._cache_path(path, params)
        if cached and cached.exists():
            age = time.time() - cached.stat().st_mtime
            if age < self.cache_ttl:
                try:
                    return json.loads(cached.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    pass  # corrupt entry: fall through and refetch

        params["api_key"] = self.api_key
        response = self.session.get(f"{TMDB_BASE_URL}{path}", params=params, timeout=30)
        response.raise_for_status()
        data = response.json()

        if cached:
            try:
                cached.write_text(json.dumps(data), encoding="utf-8")
            except OSError:  # pragma: no cover - a read-only cache dir is not fatal
                pass
        return data

    def discover(self, media_type: str, pages: int = 2, **params: Any) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for page in range(1, pages + 1):
            payload = self.get(f"/discover/{media_type}", page=page, **params)
            results.extend(payload.get("results", []))
            if page >= int(payload.get("total_pages", 1)):
                break
        return results

    def search_multi(self, query: str) -> list[dict[str, Any]]:
        payload = self.get("/search/multi", query=query, include_adult="false", region=self.region)
        return payload.get("results", [])

    def movie_details(self, movie_id: int) -> dict[str, Any]:
        return self.get(f"/movie/{movie_id}", append_to_response="release_dates,watch/providers")

    def tv_details(self, tv_id: int) -> dict[str, Any]:
        return self.get(f"/tv/{tv_id}", append_to_response="watch/providers")

    def tv_season(self, tv_id: int, season_number: int) -> dict[str, Any]:
        return self.get(f"/tv/{tv_id}/season/{season_number}")

    def details_or_empty(self, media_type: str, item_id: int) -> dict[str, Any]:
        """Details for one title, or {} if TMDB could not be reached for it.

        The fetchers map this across a thread pool, and `executor.map` re-raises
        the first exception it hit — so without this one unreachable title took
        the entire digest down with it (and with the digest, that run's Postgres
        refresh). A title that returns {} simply lands without providers.
        """
        try:
            return (
                self.movie_details(item_id)
                if media_type == "movie"
                else self.tv_details(item_id)
            )
        except Exception as exc:  # pragma: no cover - network resilience
            print(f"  TMDB details failed for {media_type}/{item_id}: {exc}", file=sys.stderr)
            return {}


# Networks that are themselves streaming platforms. Used as a fallback when a
# brand-new show has no watch-provider attribution on TMDB yet (provider data
# usually appears only days after a title goes live on the service).
# Membership is tested on the *normalized* name, so every spelling variant
# ("Prime Video", "Amazon Prime Video with Ads") collapses to one entry here.
#
# One global set, deliberately not keyed by region. An earlier version gated this
# by region so an India digest would never name a service like Hulu — correct
# when the site was India-only, wrong now that it is global: a reader outside
# India is better served by "Hulu" than by "Platform TBA". Naming a platform the
# reader may not be able to subscribe to is now an accepted trade, because the
# alternative is withholding the only availability information we have.
STREAMING_NETWORKS = {
    # India
    "JioHotstar", "ZEE5", "SonyLIV", "Sun NXT", "aha", "Hoichoi",
    "Amazon MX Player", "Lionsgate Play", "BookMyShow Stream", "Chaupal",
    "ManoramaMAX", "Planet Marathi", "Eros Now", "STAGE", "ULLU",
    # Global / multi-region
    "Netflix", "Amazon Prime", "Apple TV+", "Disney+", "HBO Max", "Paramount+",
    "Peacock", "Hulu", "Crunchyroll", "Viki", "Discovery+", "YouTube", "Viu",
    "MUBI", "Tubi", "Stan", "BritBox", "AMC+", "Starz", "Showtime", "ITVX",
    "BBC iPlayer", "Channel 4", "SkyShowtime", "Rakuten Viki", "Shahid",
}

# TMDB splits per-title availability across buckets. These mean "included with a
# subscription / free to watch right now".
AVAILABILITY_BUCKETS = ("flatrate", "ads", "free")
# These mean "you can watch it, but you pay per title".
PURCHASE_BUCKETS = ("rent", "buy")

BUY_RENT_SUFFIX = " (Buy/Rent)"
# Used when a title is known to be purchase-only but we have no usable store
# name — better than "Platform TBA", which implies we know nothing at all.
GENERIC_BUY_RENT = "Buy/Rent"
# A title can be purchasable in 30+ territories; listing every store is noise.
MAX_PROVIDERS = 3


def _names_in_region(details: dict[str, Any], region: str, buckets: tuple[str, ...]) -> list[str]:
    """One entry per listing, empty string included.

    A nameless entry is kept deliberately: for the purchase buckets, "there is a
    listing here but we cannot name the store" still means the title is buyable,
    which is worth saying. `normalize_platforms` drops the blanks before any name
    is shown, so this never yields a phantom platform.
    """
    payload = details.get("watch/providers", {}).get("results", {}).get(region, {})
    return [
        entry.get("provider_name") or ""
        for bucket in buckets
        for entry in payload.get(bucket, []) or []
    ]


def _names_any_region(details: dict[str, Any], buckets: tuple[str, ...]) -> list[str]:
    """Provider names from every territory, most widely-carried first.

    Ranking by territory count keeps the answer stable and meaningful: a store
    that carries a title in 30 countries is a better one-line answer than one
    that carries it in a single small market.
    """
    results = details.get("watch/providers", {}).get("results", {}) or {}
    counts: dict[str, int] = defaultdict(int)
    for region in results:
        # A store listed in both rent and buy for one region still counts once.
        for name in set(_names_in_region(details, region, buckets)):
            counts[name] += 1
    return [name for name, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]


def flatrate_providers(details: dict[str, Any], region: str) -> tuple[str, ...]:
    """Platforms a title is watchable on with a subscription in `region`.

    Reads every availability bucket, not just `flatrate` — an ad-tier-only or
    free-tier-only title used to come back empty and render as "Platform TBA".
    """
    return normalize_platforms(_names_in_region(details, region, AVAILABILITY_BUCKETS))


def _tag_buy_rent(names: list[str]) -> tuple[str, ...]:
    """Label purchase-only availability so it can never read as a subscription.

    Telling a reader "Amazon Prime" when the title is really a paid rental there
    is a worse error than telling them nothing, so the tag is not optional.
    """
    tagged = tuple(f"{n}{BUY_RENT_SUFFIX}" for n in normalize_platforms(names)[:MAX_PROVIDERS])
    # Purchase availability with no usable store name still beats "Platform TBA".
    return tagged or ((GENERIC_BUY_RENT,) if names else ())


def rent_buy_providers(details: dict[str, Any], region: str) -> tuple[str, ...]:
    """Stores where a title can be bought or rented in `region`."""
    return _tag_buy_rent(_names_in_region(details, region, PURCHASE_BUCKETS))


def resolve_providers(
    details: dict[str, Any], region: str, fallback: str | None = None
) -> tuple[str, ...]:
    """Best available answer to "where can I watch this?", widest-relevance first.

    The order encodes a preference, not a guess: a subscription in the reader's
    own region is the most useful answer, and a store in some other territory is
    the least — but all of them beat "Platform TBA". The cross-region steps exist
    because TMDB's India provider data is thin while its US/UK data is rich:
    Toy Story 5 carries rent/buy entries in 36 territories and none in India, so
    a region-only lookup reported nothing for a film that was plainly available.
    """
    if subs := flatrate_providers(details, region):
        return subs[:MAX_PROVIDERS]
    if purchase := rent_buy_providers(details, region):
        return purchase
    if subs_anywhere := normalize_platforms(_names_any_region(details, AVAILABILITY_BUCKETS)):
        return subs_anywhere[:MAX_PROVIDERS]
    if purchase_anywhere := _tag_buy_rent(_names_any_region(details, PURCHASE_BUCKETS)):
        return purchase_anywhere
    # No availability recorded anywhere. The network that made it is the last
    # real signal — a brand-new title often has one before it has providers.
    networks = normalize_platforms(n.get("name", "") for n in details.get("networks", []))
    if from_network := tuple(n for n in networks if n in STREAMING_NETWORKS):
        return from_network[:MAX_PROVIDERS]
    if fallback:
        # News-scraped hint from news_sources — normalized so its curated
        # spelling matches the TMDB-derived names.
        hint = normalize_platform(fallback)
        return (hint,) if hint else ()
    return ()


def digital_release_date(details: dict[str, Any], region: str) -> str | None:
    """Best-available 'digital' (OTT) release date for a movie.

    Prefers the region-specific digital (type 4) date, falls back to the
    earliest digital date recorded for any country. Returns 'YYYY-MM-DD' or
    None. Region-specific digital dates are sparse on TMDB, hence the
    fallback.
    """
    countries = details.get("release_dates", {}).get("results", [])

    region_dates = [
        rd["release_date"][:10]
        for country in countries
        if country.get("iso_3166_1") == region
        for rd in country.get("release_dates", [])
        if rd.get("type") == 4 and rd.get("release_date")
    ]
    if region_dates:
        return min(region_dates)

    any_dates = [
        rd["release_date"][:10]
        for country in countries
        for rd in country.get("release_dates", [])
        if rd.get("type") == 4 and rd.get("release_date")
    ]
    return min(any_dates) if any_dates else None


def tmdb_item_url(media_type: str, item_id: int) -> str:
    path = "movie" if media_type == "movie" else "tv"
    return f"https://www.themoviedb.org/{path}/{item_id}"


def poster_url(path: str | None) -> str | None:
    return f"{TMDB_IMAGE_BASE_URL}{path}" if path else None


def normalize_movie(raw: dict[str, Any], providers: tuple[str, ...] = ()) -> ReleaseItem:
    return ReleaseItem(
        tmdb_id=raw["id"],
        title=raw.get("title") or raw.get("original_title") or "Untitled",
        media_type="movie",
        language=raw.get("original_language") or "unknown",
        release_date=raw.get("release_date") or "TBA",
        rating=raw.get("vote_average"),
        popularity=float(raw.get("popularity") or 0),
        overview=raw.get("overview") or "",
        tmdb_url=tmdb_item_url("movie", raw["id"]),
        poster_url=poster_url(raw.get("poster_path")),
        providers=providers,
    )


def normalize_tv(raw: dict[str, Any], providers: tuple[str, ...] = ()) -> ReleaseItem:
    return ReleaseItem(
        tmdb_id=raw["id"],
        title=raw.get("name") or raw.get("original_name") or "Untitled",
        media_type="tv",
        language=raw.get("original_language") or "unknown",
        release_date=raw.get("first_air_date") or "TBA",
        rating=raw.get("vote_average"),
        popularity=float(raw.get("popularity") or 0),
        overview=raw.get("overview") or "",
        tmdb_url=tmdb_item_url("tv", raw["id"]),
        poster_url=poster_url(raw.get("poster_path")),
        providers=providers,
    )


def dedupe(items: list[ReleaseItem]) -> list[ReleaseItem]:
    seen: set[tuple[str, str, str]] = set()
    unique: list[ReleaseItem] = []
    for item in sorted(items, key=lambda x: (x.release_date, -x.popularity, x.title)):
        key = (item.media_type, item.title.lower(), item.release_date)
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


# ---------------------------------------------------------------------------
# Scheduling windows
# ---------------------------------------------------------------------------


def next_trigger_day(today: date) -> date:
    """First Wednesday or Friday strictly after `today`."""
    for offset in range(1, 8):
        candidate = today + timedelta(days=offset)
        if candidate.weekday() in TRIGGER_WEEKDAYS:
            return candidate
    raise RuntimeError("unreachable")


def compute_windows(today: date) -> dict[str, tuple[date, date]]:
    """Out Now: today .. day before next run. Coming Up: next run .. +6 days."""
    upcoming = next_trigger_day(today)
    return {
        "out_now": (today, upcoming - timedelta(days=1)),
        "coming_up": (upcoming, upcoming + timedelta(days=6)),
    }


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------


def fetch_ott_movies(
    tmdb: TmdbClient,
    start_date: str,
    end_date: str,
    language: str | None = None,
    per_query_limit: int = 20,
) -> list[ReleaseItem]:
    """OTT movie releases in [start_date, end_date] for the region.

    Two candidate pools, merged:
      A. Movies with a confirmed region digital (type 4) release date in the
         window (`with_release_type=4` + `region`). Reliable when studios
         submit the date; sparse otherwise.
      B. Popular movies currently streamable (flatrate) in the region whose
         theatrical release was within the last ~6 months — i.e. titles that
         just arrived on a platform. Their actual OTT date is resolved from
         the release-dates endpoint and filtered client-side.

    Provider attribution is used when present but NOT required: TMDB adds
    provider data only after a title is live, so requiring it would silently
    drop everything that releases this week (the bug that emptied the digest).
    """
    confirmed = tmdb.discover(
        "movie",
        region=tmdb.region,
        with_release_type="4",
        sort_by="popularity.desc",
        **({"with_original_language": language} if language else {}),
        **{"release_date.gte": start_date, "release_date.lte": end_date},
    )
    recent_start = (date.fromisoformat(start_date) - timedelta(days=180)).isoformat()
    streaming = tmdb.discover(
        "movie",
        watch_region=tmdb.region,
        with_watch_monetization_types="flatrate",
        sort_by="popularity.desc",
        **({"with_original_language": language} if language else {}),
        **{"primary_release_date.gte": recent_start, "primary_release_date.lte": end_date},
    )

    confirmed_ids = {raw["id"] for raw in confirmed}
    seen: set[int] = set()
    ordered: list[dict[str, Any]] = []
    for raw in confirmed[:per_query_limit] + streaming[:per_query_limit]:
        movie_id = raw.get("id")
        if movie_id is None or movie_id in seen:
            continue
        seen.add(movie_id)
        ordered.append(raw)

    with ThreadPoolExecutor(max_workers=8) as executor:
        details_list = list(executor.map(lambda r: tmdb.details_or_empty("movie", r["id"]), ordered))

    items: list[ReleaseItem] = []
    for raw, details in zip(ordered, details_list):
        movie_id = raw["id"]
        best_date = digital_release_date(details, tmdb.region)
        providers = resolve_providers(details, tmdb.region)

        if not best_date:
            if movie_id in confirmed_ids:
                # Filter guarantees a region digital date exists in-window even
                # if we could not extract the exact day.
                best_date = raw.get("release_date") or start_date
            elif providers and raw.get("release_date"):
                # Straight-to-OTT originals: primary release date IS the OTT date.
                best_date = raw["release_date"]

        if best_date and start_date <= best_date <= end_date:
            enriched = dict(raw)
            enriched["release_date"] = best_date
            items.append(normalize_movie(enriched, providers))
    return items


def fetch_ott_shows(
    tmdb: TmdbClient,
    start_date: str,
    end_date: str,
    language: str | None = None,
    limit: int = 20,
) -> list[ReleaseItem]:
    """Shows premiering in the window.

    No `with_watch_monetization_types` server-side filter: provider data does
    not exist yet for shows premiering this week, so that filter excludes
    exactly the shows we want (this is what returned 0 for every run).
    Instead we fetch by air-date window and keep a show when it has flatrate
    providers in the region OR it airs on a known streaming network
    (Netflix / Prime / Hotstar / ... originals).
    """
    params: dict[str, Any] = {
        "sort_by": "popularity.desc",
        "first_air_date.gte": start_date,
        "first_air_date.lte": end_date,
    }
    if language:
        params["with_original_language"] = language
    raws = tmdb.discover("tv", **params)[:limit]

    with ThreadPoolExecutor(max_workers=8) as executor:
        details_list = list(executor.map(lambda r: tmdb.details_or_empty("tv", r["id"]), raws))

    items: list[ReleaseItem] = []
    for raw, details in zip(raws, details_list):
        providers = resolve_providers(details, tmdb.region)
        if not providers:
            continue  # linear-TV-only / not a streaming release in this region
        items.append(normalize_tv(raw, providers))
    return items


def fetch_language_ott(
    tmdb: TmdbClient,
    language: str,
    start_date: str,
    end_date: str,
) -> list[ReleaseItem]:
    items = fetch_ott_movies(tmdb, start_date, end_date, language)
    items += fetch_ott_shows(tmdb, start_date, end_date, language)
    return dedupe(items)[:20]


def fetch_popular_ott(
    tmdb: TmdbClient,
    exclude_languages: list[str],
    start_date: str,
    end_date: str,
    min_popularity: float,
) -> list[ReleaseItem]:
    """Any-language OTT releases above a popularity threshold (Tamil, Telugu, Korean...).

    If the threshold filters everything out (TMDB popularity scores vary a
    lot week to week), fall back to the top titles by popularity so the
    section is never empty when releases exist.
    """
    candidates = [
        item
        for item in fetch_ott_movies(tmdb, start_date, end_date)
        + fetch_ott_shows(tmdb, start_date, end_date)
        if item.language not in exclude_languages
    ]
    candidates = dedupe(candidates)
    above = [item for item in candidates if item.popularity >= min_popularity]
    if len(above) < 5:
        remaining = sorted(
            (item for item in candidates if item not in above),
            key=lambda item: -item.popularity,
        )
        above += remaining[: 5 - len(above)]
    return dedupe(above)[:20]


def fetch_window_sections(
    tmdb: TmdbClient,
    languages: list[str],
    start: date,
    end: date,
    min_popularity: float,
) -> dict[str, list[ReleaseItem]]:
    start_s, end_s = start.isoformat(), end.isoformat()
    sections: dict[str, list[ReleaseItem]] = {}
    label_by_language = {"hi": "hindi", "en": "english"}
    for language in languages:
        section = label_by_language.get(language, language)
        sections[section] = fetch_language_ott(tmdb, language, start_s, end_s)
        print(f"  [{start_s}..{end_s}] {section}: {len(sections[section])} items", file=sys.stderr)
    sections["popular"] = fetch_popular_ott(tmdb, languages, start_s, end_s, min_popularity)
    print(f"  [{start_s}..{end_s}] popular: {len(sections['popular'])} items", file=sys.stderr)
    return sections


# ---------------------------------------------------------------------------
# News augmentation
# ---------------------------------------------------------------------------
#
# TMDB's India OTT discover feeds are thin, so the digest kept missing titles
# that the weekly "OTT releases this week" round-ups all list. We harvest those
# curated titles (news_sources) and validate/enrich each against TMDB here:
# real title, language, rating, poster, providers, links. Anything TMDB can't
# confirm as a near-term movie/show is dropped, which filters the scraper noise.


def _norm_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


# \b before each keyword so the trailing 's' of a real word is never read as the
# season marker — "Bigg Boss 18" must not become ("Bigg Bos", 18).
_SEASON_SUFFIX_RE = re.compile(
    r"\s*(?:[-–—:]\s*)?\b(?:season|series|s)\s*(\d{1,2})\s*$", re.IGNORECASE
)


def _split_season(title: str) -> tuple[str, int | None]:
    """Separate 'Outer Banks Season 5' into ('Outer Banks', 5).

    TMDB has no searchable entity for a season: /search/multi returns nothing at
    all for "Outer Banks Season 5", so every returning show's new season was
    silently unmatched — which is why Outer Banks S5, Stillwater S5, Love Is
    Blind: UK S3, Average Joe S2 and The Traitors S2 were all missing while the
    round-ups led with them. Search the series, then date the season.
    """
    m = _SEASON_SUFFIX_RE.search(title)
    if not m:
        return title, None
    base = title[: m.start()].strip(" -–—:")
    # "Berlin 1" is likelier a title than a season; require a real base name.
    return (base, int(m.group(1))) if len(base) >= 3 else (title, None)


def _match_search_result(candidate_title: str, results: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick the TMDB movie/tv result that best matches a scraped title."""
    cn = _norm_title(candidate_title)
    if len(cn) < 3:
        return None
    ctoks = set(cn.split())
    best: dict[str, Any] | None = None
    best_score = 0.0
    for r in results:
        if r.get("media_type") not in ("movie", "tv"):
            continue
        name = r.get("title") or r.get("name") or ""
        rn = _norm_title(name)
        if not rn:
            continue
        if cn == rn:
            score = 100.0
        elif rn.startswith(cn) or cn.startswith(rn):
            score = 70.0
        elif len(cn) >= 5 and (cn in rn or rn in cn):
            score = 50.0
        else:
            union = ctoks | set(rn.split())
            jaccard = len(ctoks & set(rn.split())) / len(union) if union else 0
            if jaccard >= 0.7:
                score = 45.0
            else:
                continue
        score += min(float(r.get("popularity") or 0), 200) / 10
        if score > best_score:
            best_score = score
            best = r
    return best


def _item_from_search(
    result: dict[str, Any],
    release_date: str,
    providers: tuple[str, ...],
    season: int | None = None,
) -> ReleaseItem:
    media_type = "movie" if result.get("media_type") == "movie" else "tv"
    title = (
        result.get("title")
        or result.get("name")
        or result.get("original_title")
        or result.get("original_name")
        or "Untitled"
    )
    # We searched the series but are announcing one season; say which, so the
    # digest reads "Outer Banks Season 5" and not a bare "Outer Banks" that
    # looks like the 2020 premiere.
    if season is not None and not re.search(r"season\s*\d", title, re.IGNORECASE):
        title = f"{title} Season {season}"
    return ReleaseItem(
        tmdb_id=result["id"],
        title=title,
        media_type=media_type,
        language=result.get("original_language") or "unknown",
        release_date=release_date,
        rating=result.get("vote_average"),
        popularity=float(result.get("popularity") or 0),
        overview=result.get("overview") or "",
        tmdb_url=tmdb_item_url(media_type, result["id"]),
        poster_url=poster_url(result.get("poster_path")),
        providers=providers,
    )


def section_for_language(language: str, languages: list[str]) -> str:
    mapping = {"hi": "hindi", "en": "english"}
    if language in mapping:
        return mapping[language]
    if language in languages:  # a configured language without a named section
        return language
    return "popular"


def enrich_news_candidates(
    tmdb: TmdbClient,
    candidates: list[news_sources.Candidate],
    languages: list[str],
    today: date,
    next_trigger: date,
    horizon_end: date,
    recency_days: int = 45,
) -> dict[str, dict[str, list[ReleaseItem]]]:
    """Validate scraped titles against TMDB and bucket them into the two windows.

    Returns {"out_now": {section: [...]}, "coming_up": {section: [...]}}.

    The date a title is filed under is its *OTT* date, resolved from the
    release-dates endpoint — never the primary date that /search returns. Those
    differ by months for anything that played in cinemas first: Jana Nayagan
    opened on 23 July and streams on 21 August, and filing it under July put a
    theatrical date on the calendar labelled as a streaming premiere, in the
    wrong month, while a second copy sat correctly under August.

    A movie with no digital date and no providers is dropped rather than filed
    under its theatrical date — that is how cinema-only releases (7 Dogs,
    Irumudi, Khalifa) were reaching the OTT digest.
    """
    lo = today - timedelta(days=recency_days)
    hi = horizon_end + timedelta(days=10)

    def lookup(
        cand: news_sources.Candidate,
    ) -> tuple[news_sources.Candidate, dict[str, Any], int | None] | None:
        base, season = _split_season(cand.title)
        try:
            results = tmdb.search_multi(cand.title)
            match = _match_search_result(cand.title, results)
            if not match and season is not None:
                # TMDB cannot search a season; fall back to the series name.
                match = _match_search_result(base, tmdb.search_multi(base))
        except Exception:  # pragma: no cover - network resilience
            return None
        if not match:
            return None
        # A season number only means anything for a series.
        return cand, match, (season if match.get("media_type") == "tv" else None)

    with ThreadPoolExecutor(max_workers=8) as executor:
        matched = [m for m in executor.map(lookup, candidates) if m]

    # De-duplicate by TMDB id (several round-ups point at the same title) before
    # spending a details call on each. Keyed with the season so S4 and S5 of one
    # show stay separate entries rather than one overwriting the other.
    by_id: dict[
        tuple[str, int, int | None], tuple[news_sources.Candidate, dict[str, Any], int | None]
    ] = {}
    for cand, match, season in matched:
        by_id[(match.get("media_type", ""), match["id"], season)] = (cand, match, season)

    def resolve(
        entry: tuple[news_sources.Candidate, dict[str, Any], int | None]
    ) -> tuple[news_sources.Candidate, dict[str, Any], str, tuple[str, ...], int | None] | None:
        """Attach the OTT date and platforms, or drop the candidate.

        One details fetch serves both — it carries release_dates and
        watch/providers together, so this replaces the separate provider pass.
        """
        cand, match, season = entry
        media_type = "movie" if match.get("media_type") == "movie" else "tv"
        try:
            details = (
                tmdb.movie_details(match["id"])
                if media_type == "movie"
                else tmdb.tv_details(match["id"])
            )
        except Exception:  # pragma: no cover - network resilience
            return None

        providers = resolve_providers(details, tmdb.region, cand.platform)

        if media_type == "movie":
            ott_date = digital_release_date(details, tmdb.region)
            if not ott_date:
                # No digital date on record. Only a title already streaming can
                # be dated from its primary release (straight-to-OTT original);
                # anything else is a cinema release we have no OTT date for.
                if not providers:
                    return None
                ott_date = (match.get("release_date") or "")[:10]
        else:
            # Shows have no separate digital date — the air date IS the drop
            # date. Require a platform so linear-TV-only airings stay out.
            if not providers:
                return None
            ott_date = ""
            if season is not None:
                # first_air_date is when the *series* began (Outer Banks: 2020),
                # so a returning season must be dated from the season itself.
                try:
                    ott_date = (tmdb.tv_season(match["id"], season).get("air_date") or "")[:10]
                except Exception:  # pragma: no cover - network resilience
                    ott_date = ""
            if not ott_date:
                ott_date = (match.get("first_air_date") or "")[:10]

        if not ott_date:
            return None
        try:
            parsed = date.fromisoformat(ott_date)
        except ValueError:
            return None
        if not (lo <= parsed <= hi):
            return None
        return cand, match, ott_date, providers, season

    with ThreadPoolExecutor(max_workers=8) as executor:
        resolved = [r for r in executor.map(resolve, by_id.values()) if r]

    buckets: dict[str, dict[str, list[ReleaseItem]]] = {
        "out_now": {s: [] for s in SECTION_ORDER},
        "coming_up": {s: [] for s in SECTION_ORDER},
    }
    for cand, match, ott_date, providers, season in resolved:
        item = _item_from_search(match, ott_date, providers, season)
        window = "coming_up" if date.fromisoformat(ott_date) >= next_trigger else "out_now"
        section = section_for_language(item.language, languages)
        buckets[window][section].append(item)

    total = sum(len(v) for w in buckets.values() for v in w.values())
    print(
        f"  news: {len(candidates)} candidates -> {len(by_id)} TMDB-confirmed"
        f" -> {len(resolved)} with an OTT date -> {total} placed",
        file=sys.stderr,
    )
    return buckets


def _item_richness(item: ReleaseItem) -> tuple[int, int, float]:
    return (int(bool(item.poster_url)), int(bool(item.providers)), item.popularity)


def drop_cross_window_duplicates(
    out_sections: dict[str, list[ReleaseItem]],
    up_sections: dict[str, list[ReleaseItem]],
    out_window: tuple[date, date],
    up_window: tuple[date, date],
) -> None:
    """Keep one copy of each title across both windows, in place.

    `merge_sections` de-duplicates within a window, so a title that the discover
    pass dated differently from the news pass survived in both — the calendar
    then rendered the same film in two months. When a title appears twice, the
    copy whose date actually falls inside its own window wins; failing that, the
    richer copy does.
    """

    def in_window(item: ReleaseItem, window: tuple[date, date]) -> bool:
        try:
            return window[0] <= date.fromisoformat(item.release_date) <= window[1]
        except ValueError:  # 'TBA' and other non-dates
            return False

    # (owning sections dict, section name, item, that window's bounds)
    Placement = tuple[dict[str, list[ReleaseItem]], str, ReleaseItem, tuple[date, date]]
    placements: dict[tuple[str, int], list[Placement]] = {}
    for sections, window in ((out_sections, out_window), (up_sections, up_window)):
        for section, items in sections.items():
            for item in items:
                placements.setdefault((item.media_type, item.tmdb_id), []).append(
                    (sections, section, item, window)
                )

    for spots in placements.values():
        if len(spots) < 2:
            continue
        best = max(spots, key=lambda s: (int(in_window(s[2], s[3])), _item_richness(s[2])))
        winner = best[2]
        for sections, section, item, _window in spots:
            # Identity, not equality: ReleaseItem is a frozen dataclass, so two
            # value-identical copies compare equal and both would survive.
            if item is winner:
                continue
            sections[section] = [x for x in sections[section] if x is not item]


def merge_sections(
    base: dict[str, list[ReleaseItem]],
    extra: dict[str, list[ReleaseItem]],
) -> dict[str, list[ReleaseItem]]:
    """Merge news items into a window's sections, de-duplicating by title and
    keeping the richer copy (poster/providers/popularity)."""
    for section, items in extra.items():
        combined = base.get(section, []) + items
        best: dict[tuple[str, str], ReleaseItem] = {}
        for item in combined:
            key = (item.media_type, _norm_title(item.title))
            current = best.get(key)
            if current is None or _item_richness(item) > _item_richness(current):
                best[key] = item
        base[section] = sorted(
            best.values(), key=lambda x: (x.release_date, -x.popularity, x.title)
        )
    return base


# ---------------------------------------------------------------------------
# Diagnostics (runs during dry runs to pinpoint why queries return nothing)
# ---------------------------------------------------------------------------


def _diag_query(tmdb: TmdbClient, label: str, media_type: str, **params: Any) -> None:
    try:
        payload = tmdb.get(f"/discover/{media_type}", **params)
        total = payload.get("total_results", 0)
        date_key = "release_date" if media_type == "movie" else "first_air_date"
        name_key = "title" if media_type == "movie" else "name"
        top = ", ".join(
            f"{r.get(name_key)!r} ({r.get(date_key)}, {r.get('original_language')})"
            for r in payload.get("results", [])[:4]
        )
        print(f"DIAG {label}: total={total} | {top}", file=sys.stderr)
    except Exception as exc:
        print(f"DIAG {label}: ERROR {exc}", file=sys.stderr)


def run_diagnostics(tmdb: TmdbClient, start: date, end: date) -> None:
    s, e = start.isoformat(), end.isoformat()
    print(f"DIAG region={tmdb.region} window={s}..{e}", file=sys.stderr)

    _diag_query(tmdb, "tv watch_region+flatrate+dates", "tv",
                watch_region=tmdb.region, with_watch_monetization_types="flatrate",
                sort_by="popularity.desc",
                **{"first_air_date.gte": s, "first_air_date.lte": e})
    _diag_query(tmdb, "tv watch_region+flatrate (no dates)", "tv",
                watch_region=tmdb.region, with_watch_monetization_types="flatrate",
                sort_by="popularity.desc")
    _diag_query(tmdb, "tv dates only (no watch filter)", "tv",
                sort_by="popularity.desc",
                **{"first_air_date.gte": s, "first_air_date.lte": e})
    _diag_query(tmdb, "tv watch_region only", "tv",
                watch_region=tmdb.region, sort_by="popularity.desc",
                **{"first_air_date.gte": s, "first_air_date.lte": e})

    _diag_query(tmdb, "movie watch_region+flatrate sort=primary_release_date", "movie",
                watch_region=tmdb.region, with_watch_monetization_types="flatrate",
                sort_by="primary_release_date.desc")
    _diag_query(tmdb, "movie watch_region+flatrate sort=popularity", "movie",
                watch_region=tmdb.region, with_watch_monetization_types="flatrate",
                sort_by="popularity.desc")
    _diag_query(tmdb, "movie release_type=4 + region + dates", "movie",
                region=tmdb.region, with_release_type="4", sort_by="popularity.desc",
                **{"release_date.gte": s, "release_date.lte": e})
    _diag_query(tmdb, "movie dates only", "movie",
                sort_by="popularity.desc",
                **{"release_date.gte": s, "release_date.lte": e})

    for lang in ("hi", "en"):
        _diag_query(tmdb, f"tv lang={lang} watch_region+flatrate+dates", "tv",
                    watch_region=tmdb.region, with_watch_monetization_types="flatrate",
                    with_original_language=lang, sort_by="popularity.desc",
                    **{"first_air_date.gte": s, "first_air_date.lte": e})
        _diag_query(tmdb, f"movie lang={lang} watch_region+flatrate", "movie",
                    watch_region=tmdb.region, with_watch_monetization_types="flatrate",
                    with_original_language=lang, sort_by="primary_release_date.desc")


# ---------------------------------------------------------------------------
# Sample data (for local testing / bootstrap without a TMDB key)
# ---------------------------------------------------------------------------


def sample_sections(start: date) -> dict[str, list[ReleaseItem]]:
    # Negative, sequential fake ids so sample data can never collide with a real TMDB id.
    _counter = iter(range(-1, -1000, -1))

    def item(title: str, media_type: str, language: str, offset: int, provider: str, rating: float, pop: float) -> ReleaseItem:
        return ReleaseItem(
            tmdb_id=next(_counter),
            title=title,
            media_type=media_type,
            language=language,
            release_date=(start + timedelta(days=offset)).isoformat(),
            rating=rating,
            popularity=pop,
            overview=f"Sample overview for {title}. Replace with real TMDB data on the next scheduled run.",
            tmdb_url="https://www.themoviedb.org/",
            poster_url=None,
            providers=(provider,),
        )

    return {
        "hindi": [
            item("Sample Hindi Thriller", "movie", "hi", 0, "Netflix", 7.4, 80),
            item("Sample Hindi Drama S2", "tv", "hi", 1, "Amazon Prime Video", 8.1, 65),
        ],
        "english": [
            item("Sample English Blockbuster", "movie", "en", 0, "JioHotstar", 7.9, 120),
            item("Sample English Limited Series", "tv", "en", 1, "Apple TV+", 8.4, 90),
        ],
        "popular": [
            item("Sample Telugu Action Epic", "movie", "te", 0, "Netflix", 8.0, 150),
            item("Sample Korean Survival Show", "tv", "ko", 1, "Netflix", 8.6, 200),
        ],
    }


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------


def rating_text(rating: float | None) -> str:
    if rating is None or rating == 0:
        return "No rating yet"
    return f"{rating:.1f}/10"


def escape_html(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def item_line(item: ReleaseItem) -> str:
    d = item.release_date if item.release_date != "TBA" else "date TBA"
    kind = "Movie" if item.media_type == "movie" else "Show"
    return (
        f"• <b>{escape_html(item.title)}</b> ({kind}, {d})\n"
        f"  ⭐ {rating_text(item.rating)} | <a href=\"{item.tmdb_url}\">TMDB</a>"
    )


def item_plain_line(item: ReleaseItem) -> str:
    d = item.release_date if item.release_date != "TBA" else "date TBA"
    kind = "Movie" if item.media_type == "movie" else "Show"
    return f"- {item.title} ({kind}, {d})\n  Rating: {rating_text(item.rating)} | TMDB: {item.tmdb_url}"


def group_by_provider(items: list[ReleaseItem]) -> dict[str, list[ReleaseItem]]:
    grouped: dict[str, list[ReleaseItem]] = defaultdict(list)
    for item in items:
        provider_key = ", ".join(item.providers[:2]) if item.providers else "Platform TBA"
        grouped[provider_key].append(item)
    return grouped


def add_telegram_sections(lines: list[str], sections: dict[str, list[ReleaseItem]]) -> None:
    for section in SECTION_ORDER:
        items = sections.get(section, [])
        lines.append(f"{SECTION_EMOJI[section]} <b>{SECTION_LABELS[section]}</b>")
        if not items:
            lines.append("Nothing found for this section.")
            lines.append("")
            continue
        for provider, provider_items in sorted(group_by_provider(items).items()):
            lines.append(f"<b>{escape_html(provider)}</b>")
            lines.extend(item_line(item) for item in provider_items[:6])
        lines.append("")


def format_message(digest: dict[str, Any]) -> str:
    lines = [
        "📡 <b>OTT Radar</b>",
        f"OTT releases for <b>{digest['region']}</b> — Hindi, English + Popular",
        "",
        f"🟢 <b>OUT NOW</b> ({digest['out_now']['start']} → {digest['out_now']['end']})",
        "",
    ]
    add_telegram_sections(lines, digest["out_now"]["sections"])
    lines.append(f"🔵 <b>COMING UP</b> ({digest['coming_up']['start']} → {digest['coming_up']['end']})")
    lines.append("")
    add_telegram_sections(lines, digest["coming_up"]["sections"])
    if digest.get("dashboard_url"):
        lines.append(f"🌐 <a href=\"{digest['dashboard_url']}\">Open the OTT Radar dashboard</a>")
    return "\n".join(lines).strip()


def add_plain_sections(lines: list[str], sections: dict[str, list[ReleaseItem]]) -> None:
    for section in SECTION_ORDER:
        items = sections.get(section, [])
        lines.append(SECTION_LABELS[section])
        if not items:
            lines.append("Nothing found for this section.")
            lines.append("")
            continue
        for provider, provider_items in sorted(group_by_provider(items).items()):
            lines.append(f"\n{provider}")
            lines.extend(item_plain_line(item) for item in provider_items[:6])
        lines.append("")


def format_plain_message(digest: dict[str, Any]) -> str:
    lines = [
        "OTT Radar",
        f"OTT releases for {digest['region']} — Hindi, English + Popular",
        "",
        f"OUT NOW ({digest['out_now']['start']} to {digest['out_now']['end']})",
        "",
    ]
    add_plain_sections(lines, digest["out_now"]["sections"])
    lines.append(f"COMING UP ({digest['coming_up']['start']} to {digest['coming_up']['end']})")
    lines.append("")
    add_plain_sections(lines, digest["coming_up"]["sections"])
    if digest.get("dashboard_url"):
        lines.append(f"Dashboard: {digest['dashboard_url']}")
    return "\n".join(lines).strip()


def email_item_card(item: ReleaseItem) -> str:
    kind = "Movie" if item.media_type == "movie" else "Show"
    d = item.release_date if item.release_date != "TBA" else "Date TBA"
    providers = ", ".join(item.providers[:3]) if item.providers else ""
    overview = escape_html(item.overview[:220] + ("..." if len(item.overview) > 220 else ""))
    poster = (
        f'<img src="{item.poster_url}" alt="" style="width:72px;height:108px;object-fit:cover;border-radius:8px;margin-right:14px;">'
        if item.poster_url
        else '<div style="width:72px;height:108px;border-radius:8px;background:#1b1f28;margin-right:14px;"></div>'
    )
    provider_html = (
        f'<div style="font-size:12px;color:#ffa11a;font-weight:700;margin-top:5px;">{escape_html(providers)}</div>'
        if providers
        else ""
    )
    overview_html = f'<div style="font-size:13px;color:#9096a3;margin-top:7px;">{overview}</div>' if overview else ""

    return f"""
      <div style="display:flex;padding:14px;border:1px solid #232734;border-radius:12px;margin:10px 0;background:#15181f;">
        {poster}
        <div>
          <div style="font-size:16px;font-weight:700;color:#e8eaf0;">{escape_html(item.title)}</div>
          <div style="font-size:13px;color:#7d8598;margin-top:4px;">{kind} · {d} · <span style="color:#ffd166;">★ {rating_text(item.rating)}</span></div>
          {provider_html}
          {overview_html}
          <div style="margin-top:8px;"><a href="{item.tmdb_url}" style="color:#ffa11a;text-decoration:none;font-weight:700;">Open on TMDB</a></div>
        </div>
      </div>
    """


def email_sections_html(sections: dict[str, list[ReleaseItem]]) -> str:
    blocks: list[str] = []
    for section in SECTION_ORDER:
        items = sections.get(section, [])
        title = f"{SECTION_EMOJI[section]} {SECTION_LABELS[section]}"
        if not items:
            content = '<p style="color:#7d8598;margin-top:8px;">Nothing found for this section.</p>'
        else:
            groups = []
            for provider, provider_items in sorted(group_by_provider(items).items()):
                groups.append(
                    f"""
                    <div style="margin-top:14px;">
                      <h3 style="font-size:15px;margin:0 0 6px;color:#ffa11a;">{escape_html(provider)}</h3>
                      {"".join(email_item_card(item) for item in provider_items[:6])}
                    </div>
                    """
                )
            content = "".join(groups)
        blocks.append(
            f"""
            <section style="margin-top:24px;">
              <h2 style="font-size:20px;margin:0 0 8px;color:#e8eaf0;">{escape_html(title)}</h2>
              {content}
            </section>
            """
        )
    return "".join(blocks)


def format_email_html(digest: dict[str, Any]) -> str:
    dashboard_html = ""
    if digest.get("dashboard_url"):
        dashboard_html = (
            f'<p style="margin:14px 0 0;"><a href="{digest["dashboard_url"]}" '
            'style="color:#ffa11a;font-weight:700;text-decoration:none;">🔦 Open Spotlight</a></p>'
        )
    return f"""<!doctype html>
<html>
  <body style="font-family: 'Inter', -apple-system, Helvetica, Arial, sans-serif; line-height: 1.5; color: #e8eaf0;background:#0d0f14;margin:0;padding:24px;">
    <div style="max-width: 760px; margin: 0 auto;background:#15181f;border:1px solid #232734;border-radius:18px;padding:24px;">
      <h1 style="font-size:28px;margin:0;font-weight:800;color:#ffa11a;">🔦 Spotlight</h1>
      <p style="font-size:13px;color:#7d8598;margin:2px 0 0;font-weight:600;letter-spacing:0.02em;">Find what's worth watching</p>
      <p style="font-size:15px;color:#9096a3;margin:14px 0 0;">
        OTT releases for <b style="color:#e8eaf0;">{escape_html(digest['region'])}</b> — Hindi, English + Popular
      </p>
      {dashboard_html}
      <h2 style="font-size:22px;margin:26px 0 0;color:#2fcf8e;">🟢 Out Now ({digest['out_now']['start']} → {digest['out_now']['end']})</h2>
      {email_sections_html(digest['out_now']['sections'])}
      <h2 style="font-size:22px;margin:26px 0 0;color:#ffd166;">🔵 Coming Up ({digest['coming_up']['start']} → {digest['coming_up']['end']})</h2>
      {email_sections_html(digest['coming_up']['sections'])}
    </div>
  </body>
</html>"""


# ---------------------------------------------------------------------------
# Delivery
# ---------------------------------------------------------------------------


def split_telegram_message(message: str, limit: int = 3900) -> list[str]:
    if len(message) <= limit:
        return [message]

    parts: list[str] = []
    current = ""
    for block in message.split("\n\n"):
        if len(current) + len(block) + 2 > limit:
            parts.append(current.strip())
            current = block
        else:
            current = f"{current}\n\n{block}" if current else block
    if current:
        parts.append(current.strip())
    return parts


def send_telegram_message(bot_token: str, chat_id: str, message: str) -> None:
    for part in split_telegram_message(message):
        response = requests.post(
            f"{TELEGRAM_BASE_URL}/bot{bot_token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": part,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
            timeout=30,
        )
        response.raise_for_status()


def send_email_message(
    smtp_host: str,
    smtp_port: int,
    smtp_username: str,
    smtp_password: str,
    email_from: str,
    email_to: str,
    subject: str,
    text_body: str,
    html_body: str,
) -> None:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = email_from
    message["To"] = email_to
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
        server.starttls()
        server.login(smtp_username, smtp_password)
        server.send_message(message)


# ---------------------------------------------------------------------------
# JSON feed for the PWA dashboard
# ---------------------------------------------------------------------------


def sections_to_json(sections: dict[str, list[ReleaseItem]]) -> dict[str, list[dict[str, Any]]]:
    return {
        section: [asdict(item) | {"providers": list(item.providers)} for item in items]
        for section, items in sections.items()
    }


# ---------------------------------------------------------------------------
# Postgres write path (the site's actual read path — see api/releases.ts)
# ---------------------------------------------------------------------------


def write_release_items_to_db(digest: dict[str, Any], conn: Any) -> int:
    """UPSERT this digest's ReleaseItems into release_items, pruning rows from
    older runs of the same (region, window_kind) that no longer appear.
    Returns the number of rows written."""
    region = digest["region"]
    generated_at = digest["generated_at"]
    count = 0
    with conn.cursor() as cur:
        for window_kind in ("out_now", "coming_up"):
            window = digest[window_kind]
            for section, items in window["sections"].items():
                for item in items:
                    cur.execute(
                        """
                        INSERT INTO release_items
                            (tmdb_id, media_type, title, language, release_date, rating,
                             popularity, overview, tmdb_url, poster_url, providers,
                             region, section, window_kind, window_start, window_end, generated_at, updated_at)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
                        ON CONFLICT (tmdb_id, media_type, region, window_kind, section)
                        DO UPDATE SET
                            title = EXCLUDED.title, release_date = EXCLUDED.release_date,
                            rating = EXCLUDED.rating, popularity = EXCLUDED.popularity,
                            overview = EXCLUDED.overview, poster_url = EXCLUDED.poster_url,
                            providers = EXCLUDED.providers, window_start = EXCLUDED.window_start,
                            window_end = EXCLUDED.window_end, generated_at = EXCLUDED.generated_at,
                            updated_at = now()
                        """,
                        (
                            item.tmdb_id,
                            item.media_type,
                            item.title,
                            item.language,
                            item.release_date if item.release_date != "TBA" else None,
                            item.rating,
                            item.popularity,
                            item.overview,
                            item.tmdb_url,
                            item.poster_url,
                            list(item.providers),
                            region,
                            section,
                            window_kind,
                            window["start"],
                            window["end"],
                            generated_at,
                        ),
                    )
                    count += 1
        for window_kind in ("out_now", "coming_up"):
            cur.execute(
                "DELETE FROM release_items WHERE region=%s AND window_kind=%s AND generated_at < %s",
                (region, window_kind, generated_at),
            )
    conn.commit()
    return count


def find_watchlist_matches(
    digest: dict[str, Any], conn: Any, owner_emails: list[str]
) -> list[dict[str, Any]]:
    """Cross-reference this digest's out_now items against the owner's own
    watchlist/watchLater buckets (scoped by owner_emails — other users'
    watchlists must never trigger an alert to the owner). Returns matches
    worth alerting on."""
    all_out_now_items = [item for items in digest["out_now"]["sections"].values() for item in items]
    if not all_out_now_items:
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT wi.tmdb_id, wi.media_type
            FROM watchlist_items wi
            JOIN users u ON u.id = wi.user_id
            WHERE wi.bucket IN ('watchlist','watchLater') AND u.email = ANY(%s)
            """,
            (owner_emails,),
        )
        watched_keys = {(row[0], row[1]) for row in cur.fetchall()}
    matches = []
    for item in all_out_now_items:
        if (item.tmdb_id, item.media_type) in watched_keys:
            matches.append(
                {
                    "tmdb_id": item.tmdb_id,
                    "media_type": item.media_type,
                    "title": item.title,
                    "providers": list(item.providers),
                }
            )
    return matches


def find_watchlist_matches_by_user(digest: dict[str, Any], conn: Any) -> list[dict[str, Any]]:
    """The same cross-reference as find_watchlist_matches, once per account
    that has opted in.

    Returns one entry per user who has at least one match:
    {"user_id", "email", "display_name", "matches": [...]}.

    Only accounts with users.notify_watchlist_drops = true are considered, so
    an account that never asked to hear from us never does. One query for the
    whole set rather than one per user: this runs inside a scheduled job whose
    other steps are already network-bound, and a per-user round trip would
    scale badly for no reason.
    """
    all_out_now_items = [item for items in digest["out_now"]["sections"].values() for item in items]
    if not all_out_now_items:
        return []

    # Keyed by (tmdb_id, media_type) so the join below is a lookup, not a scan.
    out_now_by_key = {(item.tmdb_id, item.media_type): item for item in all_out_now_items}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT u.id, u.email, u.display_name, wi.tmdb_id, wi.media_type
            FROM watchlist_items wi
            JOIN users u ON u.id = wi.user_id
            WHERE wi.bucket IN ('watchlist','watchLater')
              AND u.notify_watchlist_drops = true
            ORDER BY u.id
            """
        )
        rows = cur.fetchall()

    by_user: dict[int, dict[str, Any]] = {}
    for user_id, email, display_name, tmdb_id, media_type in rows:
        item = out_now_by_key.get((tmdb_id, media_type))
        if item is None:
            continue
        entry = by_user.setdefault(
            user_id,
            {"user_id": user_id, "email": email, "display_name": display_name, "matches": []},
        )
        entry["matches"].append(
            {
                "tmdb_id": item.tmdb_id,
                "media_type": item.media_type,
                "title": item.title,
                "providers": list(item.providers),
            }
        )
    return list(by_user.values())


def send_user_watchlist_alerts(
    users_with_matches: list[dict[str, Any]],
    conn: Any,
    email_sender: Any,
) -> tuple[int, int]:
    """Emails each opted-in account about the titles from *their* watchlist
    that just landed.

    `email_sender` is a callable taking (to_address, subject, text). One
    message per account per run rather than one per title: four separate
    emails because four saved films dropped on the same Wednesday is how a
    useful alert becomes an unsubscribe.

    Deduped per (user, title, channel) against sent_notifications, so a title
    that was already announced to this account in an earlier run is not
    repeated — and, thanks to migration 0013, one account being told does not
    consume the only slot for everyone else.

    Returns (accounts_emailed, titles_announced).
    """
    accounts = 0
    titles = 0

    with conn.cursor() as cur:
        for entry in users_with_matches:
            user_id = entry["user_id"]
            fresh = []
            for match in entry["matches"]:
                cur.execute(
                    """
                    SELECT 1 FROM sent_notifications
                    WHERE tmdb_id=%s AND media_type=%s
                      AND notification_kind='watchlist_drop' AND channel='email'
                      AND user_id=%s
                    """,
                    (match["tmdb_id"], match["media_type"], user_id),
                )
                if cur.fetchone() is None:
                    fresh.append(match)

            if not fresh:
                continue

            lines_out = [
                f"- {m['title']} — now on {', '.join(m['providers']) or 'a streaming platform'}"
                for m in fresh
            ]
            subject = (
                f"🎯 {fresh[0]['title']} is out"
                if len(fresh) == 1
                else f"🎯 {len(fresh)} titles from your watchlist are out"
            )
            body = (
                f"Hi {entry['display_name'].split(' ')[0] or 'there'},\n\n"
                "These landed on streaming this week, from your Spotlight watchlist:\n\n"
                + "\n".join(lines_out)
                + "\n\nYou can turn these off any time from the account menu on Spotlight.\n"
            )

            try:
                email_sender(entry["email"], subject, body)
            except Exception as exc:  # pragma: no cover - depends on live SMTP
                # One bad address must not stop the rest of the run, and
                # nothing is recorded as sent, so the next run retries it.
                print(f"  alert to user {user_id} failed: {exc}", file=sys.stderr)
                continue

            accounts += 1
            titles += len(fresh)
            for match in fresh:
                cur.execute(
                    """
                    INSERT INTO sent_notifications
                        (tmdb_id, media_type, notification_kind, channel, user_id)
                    VALUES (%s,%s,'watchlist_drop','email',%s)
                    """,
                    (match["tmdb_id"], match["media_type"], user_id),
                )
    conn.commit()
    return accounts, titles


def send_watchlist_alerts(
    matches: list[dict[str, Any]],
    conn: Any,
    telegram_sender: Any = None,
    email_sender: Any = None,
) -> int:
    """For each match, skip channels already alerted (sent_notifications), else
    send and log. telegram_sender/email_sender are callables taking `text`.

    Returns the number of channel-sends actually made — a match whose only
    enabled channel was already notified for this title in a previous run
    sends nothing here, and the caller's log line needs to say that rather
    than count it as sent."""
    sent = 0
    with conn.cursor() as cur:
        for match in matches:
            for channel, sender in (("telegram", telegram_sender), ("email", email_sender)):
                if not sender:
                    continue
                cur.execute(
                    """
                    SELECT 1 FROM sent_notifications
                    WHERE tmdb_id=%s AND media_type=%s AND notification_kind='watchlist_drop' AND channel=%s
                    """,
                    (match["tmdb_id"], match["media_type"], channel),
                )
                if cur.fetchone():
                    continue
                providers_text = ", ".join(match["providers"]) or "a streaming platform"
                text = f"🎯 From your watchlist: {match['title']} is now on {providers_text}"
                sender(text)
                sent += 1
                cur.execute(
                    """
                    INSERT INTO sent_notifications (tmdb_id, media_type, notification_kind, channel)
                    VALUES (%s,%s,'watchlist_drop',%s)
                    """,
                    (match["tmdb_id"], match["media_type"], channel),
                )
    conn.commit()
    return sent


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def build_digest(now: datetime | None = None, diagnostics: bool = False) -> dict[str, Any]:
    """Fetch both windows and return the digest dict (sections = ReleaseItem lists).

    Shared by the scheduled GitHub Action and the on-demand Vercel API.
    Honors REGION / LANGUAGES / POPULAR_MIN_POPULARITY / RELEASE_TIMEZONE /
    USE_SAMPLE_DATA / DASHBOARD_URL env vars.
    """
    region = os.getenv("REGION", "IN")
    languages = env_list("LANGUAGES", "hi,en")
    min_popularity = float(os.getenv("POPULAR_MIN_POPULARITY", "25"))
    timezone = ZoneInfo(os.getenv("RELEASE_TIMEZONE", "Asia/Kolkata"))

    if now is None:
        now = datetime.now(timezone)
    windows = compute_windows(now.date())
    out_start, out_end = windows["out_now"]
    up_start, up_end = windows["coming_up"]

    if env_bool("USE_SAMPLE_DATA", False):
        out_sections = sample_sections(out_start)
        up_sections = sample_sections(up_start)
    else:
        tmdb = TmdbClient(env_required("TMDB_API_KEY"), region)
        if diagnostics:
            run_diagnostics(tmdb, out_start, up_end)
        out_sections = fetch_window_sections(tmdb, languages, out_start, out_end, min_popularity)
        up_sections = fetch_window_sections(tmdb, languages, up_start, up_end, min_popularity)

        if env_bool("NEWS_ENABLED", True):
            try:
                extra_urls = tuple(env_list("NEWS_URLS", ""))
                index_urls = tuple(
                    env_list("NEWS_INDEX_URLS", "")
                ) or news_sources.ROUNDUP_INDEX_URLS
                candidates = news_sources.fetch_news_candidates(
                    extra_urls=extra_urls, index_urls=index_urls
                )
                buckets = enrich_news_candidates(
                    tmdb, candidates, languages, now.date(), up_start, up_end
                )
                merge_sections(out_sections, buckets["out_now"])
                merge_sections(up_sections, buckets["coming_up"])
                # merge_sections only de-duplicates within one window; a title
                # the two passes dated differently needs collapsing across both.
                drop_cross_window_duplicates(
                    out_sections, up_sections, (out_start, out_end), (up_start, up_end)
                )
                # Popular can now overflow; keep the section focused.
                for sections in (out_sections, up_sections):
                    sections["popular"] = sections["popular"][:30]
            except Exception as exc:  # pragma: no cover - never fail the digest on news
                print(f"  news augmentation skipped: {exc}", file=sys.stderr)

    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "region": region,
        "dashboard_url": os.getenv("DASHBOARD_URL", ""),
        "out_now": {"start": out_start.isoformat(), "end": out_end.isoformat(), "sections": out_sections},
        "coming_up": {"start": up_start.isoformat(), "end": up_end.isoformat(), "sections": up_sections},
    }


def build_digest_payload(now: datetime | None = None) -> dict[str, Any]:
    """JSON-ready digest, same shape api/releases.ts serves from Postgres. Used by scripts/legacy_live_releases.py."""
    digest = build_digest(now)
    return {
        "generated_at": digest["generated_at"],
        "region": digest["region"],
        "out_now": {
            "start": digest["out_now"]["start"],
            "end": digest["out_now"]["end"],
            "sections": sections_to_json(digest["out_now"]["sections"]),
        },
        "coming_up": {
            "start": digest["coming_up"]["start"],
            "end": digest["coming_up"]["end"],
            "sections": sections_to_json(digest["coming_up"]["sections"]),
        },
    }


def main() -> int:
    try:  # Windows consoles default to cp1252; force UTF-8 so emoji/arrows in print() don't crash.
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    dry_run = env_bool("DRY_RUN", False)
    telegram_enabled = env_bool("TELEGRAM_ENABLED", True) and not dry_run
    email_enabled = env_bool("EMAIL_ENABLED", False) and not dry_run
    # Separate from telegram_enabled/email_enabled, which mean "this
    # channel's credentials are configured" and are also used to gate the
    # watchlist-drop alerts below. This flag controls only the full
    # Out Now/Coming Up broadcast, so the broadcast can be turned off while
    # watchlist alerts keep working.
    send_broadcast_digest = env_bool("SEND_BROADCAST_DIGEST", True) and not dry_run

    digest = build_digest(diagnostics=dry_run or env_bool("DIAGNOSTICS", False))
    out_sections = digest["out_now"]["sections"]
    up_sections = digest["coming_up"]["sections"]
    out_start = date.fromisoformat(digest["out_now"]["start"])
    out_end = date.fromisoformat(digest["out_now"]["end"])

    message = format_message(digest)
    plain_message = format_plain_message(digest)

    sent_channels: list[str] = []
    # Failures recorded here fail the whole run (see the `return 1` at the
    # bottom of main()) without skipping the channels below — Telegram/Email
    # still send on a DB failure, so a subscriber isn't also denied the digest
    # they'd otherwise have gotten. The run still ends non-zero so GitHub
    # Actions shows it red instead of green: a write failure here means the
    # live site is reading stale Postgres data until the next successful run,
    # and that must be loud, not a silent stderr line nobody watches.
    failures: list[str] = []

    db_conn = None
    if os.getenv("DATABASE_URL"):
        from lib_py.db import get_connection

        db_conn = get_connection()
        try:
            n = write_release_items_to_db(digest, db_conn)
            print(f"Wrote {n} rows to Postgres release_items")
            sent_channels.append("Postgres")
        except Exception as exc:  # pragma: no cover
            print(f"Postgres write failed: {exc}", file=sys.stderr)
            failures.append(f"Postgres write failed: {exc}")

    if telegram_enabled and send_broadcast_digest:
        send_telegram_message(env_required("TELEGRAM_BOT_TOKEN"), env_required("TELEGRAM_CHAT_ID"), message)
        sent_channels.append("Telegram")

    if email_enabled and send_broadcast_digest:
        subject = f"OTT Radar: Out now {out_start.isoformat()} → {out_end.isoformat()} + coming up"
        send_email_message(
            smtp_host=env_required("SMTP_HOST"),
            smtp_port=int(os.getenv("SMTP_PORT", "587")),
            smtp_username=env_required("SMTP_USERNAME"),
            smtp_password=env_required("SMTP_PASSWORD"),
            email_from=os.getenv("EMAIL_FROM", os.getenv("SMTP_USERNAME", "")),
            email_to=env_required("EMAIL_TO"),
            subject=subject,
            text_body=plain_message,
            html_body=format_email_html(digest),
        )
        sent_channels.append("Email")

    # Watchlist-drop alerts only make sense alongside the real digest send
    # (not the nightly DB-only refresh, which runs with DRY_RUN=true and
    # neither channel enabled).
    if db_conn is not None and not dry_run and (telegram_enabled or email_enabled):
        try:
            owner_emails = env_required_list("NOTIFY_OWNER_EMAILS")
        except RuntimeError as exc:
            # A misconfigured owner list is a config bug, not a transient
            # send failure — with the broadcast off, missed alerts are the
            # only symptom, so this must be loud (see the Postgres-failure
            # `failures` list above) rather than swallowed as non-fatal.
            print(f"Watchlist-alert step failed: {exc}", file=sys.stderr)
            failures.append(f"Watchlist-alert step failed: {exc}")
        else:
            try:
                matches = find_watchlist_matches(digest, db_conn, owner_emails)
                if matches:
                    telegram_sender = (
                        (lambda text: send_telegram_message(env_required("TELEGRAM_BOT_TOKEN"), env_required("TELEGRAM_CHAT_ID"), text))
                        if telegram_enabled
                        else None
                    )
                    email_sender = (
                        (
                            lambda text: send_email_message(
                                smtp_host=env_required("SMTP_HOST"),
                                smtp_port=int(os.getenv("SMTP_PORT", "587")),
                                smtp_username=env_required("SMTP_USERNAME"),
                                smtp_password=env_required("SMTP_PASSWORD"),
                                email_from=os.getenv("EMAIL_FROM", os.getenv("SMTP_USERNAME", "")),
                                email_to=env_required("EMAIL_TO"),
                                subject="🎯 From your watchlist",
                                text_body=text,
                                html_body=f"<p>{escape_html(text)}</p>",
                            )
                        )
                        if email_enabled
                        else None
                    )
                    sent = send_watchlist_alerts(matches, db_conn, telegram_sender, email_sender)
                    # A "channel-send" per match per enabled channel — with both
                    # Telegram and email on, one match can account for 2. Compare
                    # against that ceiling, not len(matches), or this goes
                    # negative the moment more than one channel is enabled.
                    enabled_channels = sum(1 for s in (telegram_sender, email_sender) if s)
                    already_notified = len(matches) * enabled_channels - sent
                    print(
                        f"Watchlist check: {len(matches)} match(es), sent {sent} new alert(s)"
                        + (f", {already_notified} already notified previously" if already_notified else "")
                    )
                else:
                    print(f"Watchlist check: 0 matches for {len(owner_emails)} owner email(s)")
            except Exception as exc:  # pragma: no cover
                print(f"Watchlist-alert step failed (non-fatal): {exc}", file=sys.stderr)

    # Per-account alerts. Separate from the owner block above on purpose: that
    # one is env-configured and fires through whichever channels the
    # deployment has switched on, while this one is opt-in per account and
    # emails each person at their own verified Google address.
    #
    # Gated on SMTP rather than on EMAIL_ENABLED, which controls the broadcast
    # digest — a deployment can perfectly well want per-user alerts and no
    # broadcast, and that is in fact this deployment's configuration.
    if db_conn is not None and not dry_run and os.getenv("SMTP_HOST"):
        try:
            per_user = find_watchlist_matches_by_user(digest, db_conn)
            if per_user:

                def _send_user_email(to_address: str, subject: str, text: str) -> None:
                    send_email_message(
                        smtp_host=env_required("SMTP_HOST"),
                        smtp_port=int(os.getenv("SMTP_PORT", "587")),
                        smtp_username=env_required("SMTP_USERNAME"),
                        smtp_password=env_required("SMTP_PASSWORD"),
                        email_from=os.getenv("EMAIL_FROM", os.getenv("SMTP_USERNAME", "")),
                        email_to=to_address,
                        subject=subject,
                        text_body=text,
                        html_body="".join(f"<p>{escape_html(line)}</p>" for line in text.splitlines() if line.strip()),
                    )

                accounts, titles = send_user_watchlist_alerts(per_user, db_conn, _send_user_email)
                print(
                    f"Per-user watchlist alerts: {len(per_user)} account(s) with matches, "
                    f"emailed {accounts} about {titles} title(s)"
                )
            else:
                print("Per-user watchlist alerts: no opted-in account had a match")
        except Exception as exc:  # pragma: no cover
            # Non-fatal for the same reason the owner block is: the digest and
            # the database refresh are the job's real output, and a mail
            # failure must not fail the run or block the next one.
            print(f"Per-user watchlist alerts failed (non-fatal): {exc}", file=sys.stderr)

    if db_conn is not None:
        db_conn.close()

    if dry_run:
        print("--- DRY RUN: Telegram/plain message preview ---")
        print(plain_message)
        print("--- END PREVIEW ---")

    counts = {
        section: (len(out_sections.get(section, [])), len(up_sections.get(section, [])))
        for section in SECTION_ORDER
    }
    summary = ", ".join(f"{section}: {out}/{up}" for section, (out, up) in counts.items())

    if failures:
        print(f"OTT Radar completed with failures → sent: {', '.join(sent_channels) or 'none'} | out-now/coming-up counts: {summary}")
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print(f"OTT Radar done → {', '.join(sent_channels)} | out-now/coming-up counts: {summary}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"OTT Radar failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
