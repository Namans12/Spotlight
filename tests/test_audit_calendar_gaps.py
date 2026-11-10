import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from audit_calendar_gaps import movie_reason, tv_reason


def test_movie_diagnosis_never_confuses_global_or_digital_dates_with_regional_theatrical():
    data = {'title': 'Film', 'release_dates': {'results': [
        {'iso_3166_1': 'US', 'release_dates': [{'type': 3, 'release_date': '2026-11-10'}]},
        {'iso_3166_1': 'IN', 'release_dates': [{'type': 4, 'release_date': '2026-11-10'}]}]}}
    assert movie_reason(data, 'wikipedia', 'Film', '2026-11-10', 'IN') == 'no_regional_theatrical_date'
    assert movie_reason(data, 'wikipedia', 'Other', '2026-11-10', 'IN') == 'title_mismatch'
    data['release_dates']['results'][1]['release_dates'].append({'type': 3, 'release_date': '2026-11-12'})
    assert movie_reason(data, 'wikipedia', 'Film', '2026-11-10', 'IN') == 'different_regional_date'


def test_tv_diagnosis_does_not_infer_region():
    assert tv_reason({'name': 'Show', 'first_air_date': '2026-11-11'}, 'csv_seed', 'Show', '2026-11-10') == 'different_global_first_air_date'
    assert tv_reason({'name': 'Show'}, 'csv_seed', 'Show', '2026-11-10') == 'no_global_first_air_date'
