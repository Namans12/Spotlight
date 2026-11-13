import csv
import io
import zipfile

from scripts.prepare_movielens_eval import prepare


def _csv(headers, rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue()


def test_temporal_holdout_excludes_ties_and_previously_seen_tmdb_ids(tmp_path):
    archive = tmp_path / "ratings.zip"
    movies = [(n, f"Film {n}", "Comedy") for n in range(1, 23)]
    # Film 15 is a duplicate TMDB identity of training film 1; films 16 and
    # 17 share the cutoff timestamp, straddling the split.
    links = [(n, "", 1 if n == 15 else n) for n in range(1, 23)]
    ratings = [(1, n, 1 if n in (1, 18) else 5, 14 if n in (16, 17) else n) for n in range(1, 23)]
    with zipfile.ZipFile(archive, "w") as data:
        data.writestr("ml-latest-small/movies.csv", _csv(["movieId", "title", "genres"], movies))
        data.writestr("ml-latest-small/links.csv", _csv(["movieId", "imdbId", "tmdbId"], links))
        data.writestr("ml-latest-small/ratings.csv", _csv(["userId", "movieId", "rating", "timestamp"], ratings))
    result, summary = prepare(archive)
    assert summary["cases"] == 1
    case = result["cases"][0]
    assert set(case["feedback"]) == {"movie:1"}
    assert not ({1, 15, 16, 17} & {candidate["id"] for candidate in case["candidates"]})
    assert case["judgments"]["movie:18"] == "not_relevant"
    assert case["judgments"]["movie:19"] == "relevant"
    assert prepare(archive) == (result, summary)
