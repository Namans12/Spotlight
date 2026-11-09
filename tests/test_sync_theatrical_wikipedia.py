"""parse_table's rowspan-walking and the OTT-platform skip.

Wikipedia's per-language release tables carry month and day only on the
first row of each group, via rowspan — every following row in that group
omits those cells entirely, so the column count of a <tr> (7 / 6 / 5) is
the only signal for how much of the date to carry forward. Reproduced here
with a small fixture table shaped exactly like the real one (see
release_tables' docstring) rather than a live fetch, so a future edit to
the walking logic can't silently break without a fast, offline signal.

The OTT-platform skip is tested against a genuine ambiguity in the source
data: Wikipedia's per-year film lists don't mark which entries are
theatrical vs. straight-to-streaming, so a production/studio cell naming a
known streaming platform is treated as disqualifying rather than guessed
at (see module docstring in sync_theatrical_wikipedia.py).
"""

from __future__ import annotations

import sys
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import sync_theatrical_wikipedia as w  # noqa: E402

FIXTURE_HTML = """
<table class="wikitable sortable">
<tbody>
<tr><th colspan="2">Opening</th><th>Title</th><th>Director</th><th>Cast</th><th>Studio</th><th>Ref.</th></tr>
<tr>
  <td rowspan="3"><b>J<br/>A<br/>N<br/>U<br/>A<br/>R<br/>Y</b></td>
  <td rowspan="2">2</td>
  <td><i>First Film</i></td>
  <td>Dir A</td>
  <td>Cast A</td>
  <td>Indie Studio</td>
  <td>[1]</td>
</tr>
<tr>
  <td><i>Second Film</i></td>
  <td>Dir B</td>
  <td>Cast B</td>
  <td>Netflix Productions</td>
  <td>[2]</td>
</tr>
<tr>
  <td>9</td>
  <td><i>Third Film</i></td>
  <td>Dir C</td>
  <td>Cast C</td>
  <td>Another Studio</td>
  <td>[3]</td>
</tr>
</tbody>
</table>
"""

OTHER_TABLE_HTML = """
<table class="wikitable"><tr><th>Rank</th><th>Title</th><th>Studio</th></tr>
<tr><td>1</td><td>Highest Grosser</td><td>Some Studio</td></tr></table>
"""


def test_release_tables_finds_only_the_opening_header_table():
    soup = BeautifulSoup(FIXTURE_HTML + OTHER_TABLE_HTML, "html.parser")
    tables = w.release_tables(soup)
    assert len(tables) == 1
    assert tables[0].find("th").get_text(strip=True) == "Opening"


def test_parse_table_carries_month_and_day_across_rowspan_rows():
    soup = BeautifulSoup(FIXTURE_HTML, "html.parser")
    table = w.release_tables(soup)[0]
    table._sync_wikipedia_year = 2026
    rows = w.parse_table(table, "https://en.wikipedia.org/wiki/Fixture")
    titles_by_date = {r["title"]: r["release_date"] for r in rows}

    # Second Film is dropped for naming a known OTT platform as its studio,
    # not because the date-carrying logic failed on it too.
    assert titles_by_date == {
        "First Film": "2026-01-02",
        "Third Film": "2026-01-09",
    }


def test_parse_table_skips_rows_naming_a_streaming_platform():
    soup = BeautifulSoup(FIXTURE_HTML, "html.parser")
    table = w.release_tables(soup)[0]
    table._sync_wikipedia_year = 2026
    rows = w.parse_table(table, "https://en.wikipedia.org/wiki/Fixture")
    assert all(r["title"] != "Second Film" for r in rows)


def test_wikipedia_same_title_same_day_with_distinct_source_rows_stays_distinct():
    html = FIXTURE_HTML.replace('Second Film', 'First Film').replace('Netflix Productions', 'Other Studio')
    soup = BeautifulSoup(html, 'html.parser')
    table = w.release_tables(soup)[0]
    table._sync_wikipedia_year = 2026
    rows = [r for r in w.parse_table(table, 'https://en.wikipedia.org/wiki/Fixture') if r['title'] == 'First Film']
    assert len(rows) == 2
    assert rows[0]['source_fingerprint'] != rows[1]['source_fingerprint']
