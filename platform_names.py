"""Canonical streaming-platform naming.

TMDB returns several spellings for the same service ("Amazon Prime Video",
"Prime Video", "Amazon Prime Video with Ads"), and news_sources.py contributes
its own curated names on top. Left alone they fragment the platform filter and
the card grouping into separate entries for one service, so every provider name
is funnelled through here before it reaches the database.

The alias table lives in shared/platforms.json so the TypeScript read path
(shared/platforms.ts, used by api/**) stays in lockstep with this write path.
"""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

_DATA_PATH = Path(__file__).resolve().parent / "shared" / "platforms.json"
_ADD_ON_CHANNEL = re.compile(r"\s+(?:Amazon Channel|Apple TV Channel|Roku Premium Channel)$", re.IGNORECASE)


@lru_cache(maxsize=1)
def _data() -> tuple[dict[str, str], tuple[str, ...]]:
    with _DATA_PATH.open(encoding="utf-8") as fh:
        payload = json.load(fh)
    aliases = {k.lower(): v for k, v in payload["aliases"].items()}
    # Longest-first so " Amazon Channel" is stripped before the shorter
    # " Channel" would chop it into a half-name.
    suffixes = tuple(sorted(payload["stripSuffixes"], key=len, reverse=True))
    return aliases, suffixes


def normalize_platform(raw: str) -> str:
    """Collapse one provider spelling to its canonical name.

    Unknown services pass through trimmed rather than being dropped, so a new
    platform still reaches the UI instead of silently vanishing.
    """
    aliases, suffixes = _data()
    name = (raw or "").strip()
    if not name:
        return ""
    # Add-on channels must not imply a standalone subscription match.
    # A service can carry more than one suffix ("... with Ads Amazon Channel").
    changed = True
    while changed:
        if _ADD_ON_CHANNEL.search(name):
            return name
        changed = False
        for suffix in suffixes:
            if name.lower().endswith(suffix.lower()):
                name = name[: -len(suffix)].strip()
                changed = True
                break

    return aliases.get(name.lower(), name)


@lru_cache(maxsize=1)
def _classification_sets() -> tuple[frozenset[str], frozenset[str]]:
    with _DATA_PATH.open(encoding="utf-8") as fh:
        payload = json.load(fh)
    tv_networks = frozenset(n.lower() for n in payload["tvNetworks"])
    streamers = frozenset(v.lower() for v in payload["aliases"].values())
    return streamers, tv_networks


def split_platform_field(raw: str | None) -> list[str]:
    """Split the calendar CSV's multi-valued distributor column.

    It mixes two separators — ' / ' on the Wikipedia/Deadline rows and ', ' on
    the Hindi rows.
    """
    return [part.strip() for part in re.split(r"[/,]", raw or "") if part.strip()]


def classify_platform(entry_type: str | None, platform_field: str | None) -> str:
    """Classify a calendar row as 'streaming', 'tv_network' or 'theatrical'.

    Parts are compared whole, never as substrings: the previous heuristic tested
    ``"max" in platform`` and so read Miramax as HBO Max, Mahaveer Jain Films as
    aha, and Constantin Film as Stan.
    """
    streamers, tv_networks = _classification_sets()
    parts = split_platform_field(platform_field)

    for part in parts:
        if normalize_platform(_ADD_ON_CHANNEL.sub("", normalize_platform(part))).lower() in streamers:
            return "streaming"
    for part in parts:
        if part.lower() in tv_networks:
            return "tv_network"

    # Unrecognised distributor: a Show is a TV premiere, a Movie is a cinema release.
    return "tv_network" if (entry_type or "").strip().lower() == "show" else "theatrical"


def media_type_from_entry_type(entry_type: str | None) -> str | None:
    """Map the CSV's `Movie`/`Show` onto the app's `movie`/`tv` media type."""
    value = (entry_type or "").strip().lower()
    if value == "movie":
        return "movie"
    if value == "show":
        return "tv"
    return None


_SEASON_SUFFIX = re.compile(r"\s+(?:season\s+\d+|s\d{1,2}|part\s+\d+|chapter\s+\d+)\s*$", re.IGNORECASE)


def calendar_title_key(title: str) -> str:
    """Dedupe key for matching a CSV row against a TMDB row.

    Strips season/part suffixes ('Undekhi Season 3' vs TMDB's 'Undekhi') and
    folds the curly apostrophes the scraped titles use.
    """
    text = unicodedata.normalize("NFKD", title or "")
    for curly, plain in (("‘", "'"), ("’", "'"), ("ʼ", "'"), ("“", '"'), ("”", '"')):
        text = text.replace(curly, plain)
    text = _SEASON_SUFFIX.sub("", text.strip())
    return re.sub(r"\s+", " ", text).strip().lower()


def normalize_platforms(raw: object) -> tuple[str, ...]:
    """Normalize a provider sequence, dropping blanks and duplicates in order."""
    seen: set[str] = set()
    out: list[str] = []
    for entry in raw or ():
        name = normalize_platform(str(entry))
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return tuple(out)
