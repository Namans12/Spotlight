"""One-time loader: release_calendar_may_dec_2026.csv -> calendar_entries.

Run once, manually, against production DATABASE_URL:

    python scripts/seed_calendar_csv.py

Safe to re-run: source-record keys distinguish rows and their duplicate occurrences.
"""

from __future__ import annotations

import csv
from collections import Counter
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib_py.db import get_connection
from lib_py.event_identity import source_record_key
from platform_names import classify_platform, media_type_from_entry_type

CSV_PATH = Path(__file__).resolve().parent.parent / "release_calendar_may_dec_2026.csv"


def main() -> None:
    conn = get_connection()
    inserted = 0
    with conn.cursor() as cur, open(CSV_PATH, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        seen: Counter[str] = Counter()
        for row in reader:
            fingerprint = source_record_key(row)
            seen[fingerprint] += 1
            source_key = source_record_key(fingerprint, seen[fingerprint])
            cur.execute(
                """
                INSERT INTO calendar_entries
                    (release_date, title, language, entry_type, is_theatrical,
                     platform_or_distributor, details, source, source_url, origin,
                     media_type, source_key)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'csv_seed',%s,%s)
                ON CONFLICT (origin, source_key) DO NOTHING
                """,
                (
                    row["date"],
                    row["title"],
                    row.get("language") or None,
                    row["type"],
                    classify_platform(row["type"], row.get("platform_or_distributor")) == "theatrical",
                    row.get("platform_or_distributor") or None,
                    row.get("details") or None,
                    row.get("source") or None,
                    row.get("source_url") or None,
                    media_type_from_entry_type(row["type"]),
                    source_key,
                ),
            )
            inserted += cur.rowcount
    conn.commit()

    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM calendar_entries")
        total = cur.fetchone()[0]
    conn.close()

    print(f"Seeded {inserted} new calendar entries ({total} total rows in calendar_entries)")


if __name__ == "__main__":
    main()
