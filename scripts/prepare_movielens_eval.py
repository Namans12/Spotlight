"""Create a local, exploratory Tonight evaluation from MovieLens latest-small.

The source archive is supplied by the operator; this script does not download
or distribute it. Review GroupLens's licence before using or sharing its data.
Historical low ratings are only a proxy for Tonight's 'not interested' action.
"""
from __future__ import annotations

import argparse
import collections
import csv
import io
import json
import random
import zipfile
from pathlib import Path


def prepare(archive: Path) -> tuple[dict, dict]:
    with zipfile.ZipFile(archive) as data:
        def records(name: str) -> list[dict[str, str]]:
            with data.open(f"ml-latest-small/{name}") as raw:
                return list(csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")))

        movies = {row["movieId"]: row for row in records("movies.csv")}
        links = {row["movieId"]: row["tmdbId"] for row in records("links.csv")
                 if row["tmdbId"].isdigit() and int(row["tmdbId"]) > 0}
        ratings: dict[str, list[dict[str, str]]] = collections.defaultdict(list)
        for row in records("ratings.csv"):
            ratings[row["userId"]].append(row)

    filters = {"mood": "", "maxMinutes": None, "language": "", "services": [],
               "includeRentBuy": False, "mediaType": "movie"}
    cases = []
    for user, rows in sorted(ratings.items(), key=lambda pair: int(pair[0])):
        rows = [row for row in rows if row["movieId"] in movies and row["movieId"] in links]
        rows.sort(key=lambda row: (int(row["timestamp"]), int(row["movieId"])))
        split = len(rows) * 7 // 10
        train = rows[:split]
        cutoff = int(train[-1]["timestamp"]) if train else 0
        seen = {links[row["movieId"]] for row in train}
        future = [row for row in rows[split:] if int(row["timestamp"]) > cutoff and links[row["movieId"]] not in seen]
        negatives = [row for row in train if float(row["rating"]) <= 2 and
                     movies[row["movieId"]]["genres"] != "(no genres listed)"][-3:]
        if not negatives:
            continue
        unique = {}
        for row in future:
            unique.setdefault(int(links[row["movieId"]]), row)
        holdout = list(unique.items())[:20]
        if (len(holdout) < 5 or not any(float(row["rating"]) >= 4 for _, row in holdout)
                or not any(float(row["rating"]) <= 2 for _, row in holdout)):
            continue
        random.Random(100000 + int(user)).shuffle(holdout)

        def genres(movie_id: str) -> list[str]:
            return [{"Children": "Family", "Sci-Fi": "Science Fiction"}.get(name, name)
                    for name in movies[movie_id]["genres"].split("|") if name != "(no genres listed)"]

        candidates = [{"id": tmdb_id, "title": movies[row["movieId"]]["title"], "mediaType": "movie",
                       "originalLanguage": "", "releaseDate": "", "genres": genres(row["movieId"])}
                      for tmdb_id, row in holdout]
        judgments = {f"movie:{tmdb_id}": ("relevant" if float(row["rating"]) >= 4 else "not_relevant")
                     for tmdb_id, row in holdout if float(row["rating"]) >= 4 or float(row["rating"]) <= 2}
        feedback = {f"movie:{links[row['movieId']]}": {"kind": "not_interested", "genres": genres(row["movieId"])}
                    for row in negatives}
        cases.append({"name": f"case-{len(cases) + 1}", "filters": filters, "candidates": candidates,
                      "offers": {}, "feedback": feedback, "duelWeights": {}, "judgments": judgments})
    return {"cases": cases}, {"cases": len(cases), "candidate_count": sum(len(case["candidates"]) for case in cases),
                              "rating_users": len(ratings)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Locally obtained ml-latest-small.zip")
    parser.add_argument("output", type=Path, help="Local evaluation JSON; do not commit source data")
    args = parser.parse_args()
    cases, summary = prepare(args.archive)
    if not cases["cases"]:
        parser.error("No eligible cases found")
    args.output.write_text(json.dumps(cases), encoding="utf-8")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
