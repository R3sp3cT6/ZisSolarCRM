"""Verify the completed source probe against actual GRIB bytes independently."""
import datetime as dt
import email.utils
import hashlib
import importlib.util
import json
import os
import pathlib
import eccodes

DATE = '2026-06-15'
ROOT = pathlib.Path('work/forecast-research/sflux')
CACHE = pathlib.Path(os.environ['LOCALAPPDATA']) / 'ZisSolar' / 'gfs-sflux-research' / DATE

def read(path):
    return json.loads(pathlib.Path(path).read_text(encoding='utf-8'))

def run():
    source = read(ROOT / (DATE + '.json'))
    forecast = read('work/forecast-research/full-history/inputs.json')
    day = next(d for d in forecast['days'] if d['date'] == DATE)
    inputs = {f"{f['variable']}:{f['endLead']}": f for f in source['fields']}
    assert len(inputs) == len(source['fields']) == 112
    origin = dt.datetime.fromisoformat(source['originAt'])
    raw_bytes = 0
    for f in source['fields']:
        path = CACHE / f"f{f['endLead']:03}-{f['variable']}.grib2"
        raw = path.read_bytes()
        raw_bytes += len(raw)
        assert hashlib.sha256(raw).hexdigest() == f['sha256']
        metadata = read(path.with_suffix('.grib2.http.json'))
        assert metadata['sha256'] == f['sha256'] and metadata['receivedAt'] == f['receivedAt']
        assert email.utils.parsedate_to_datetime(metadata['lastModified']) <= origin
        h = eccodes.codes_new_from_message(raw)
        try:
            assert eccodes.codes_get(h, 'discipline') == 0
            expected = {'DSWRF': (4, 192), 'VDDSF': (4, 201), 'NDDSF': (4, 203), 'TMP': (0, 0)}[f['variable']]
            assert (eccodes.codes_get(h, 'parameterCategory'), eccodes.codes_get(h, 'parameterNumber')) == expected
            assert eccodes.codes_get(h, 'dataDate') == 20260614 and eccodes.codes_get(h, 'dataTime') == 1200
            assert eccodes.codes_get(h, 'endStep') == f['endLead']
            assert eccodes.codes_get(h, 'startStep') == f['startLead']
            assert eccodes.codes_get(h, 'units') == f['units']
            assert eccodes.codes_get(h, 'stepType') == f['stepType']
            assert eccodes.codes_get(h, 'typeOfLevel') == ('heightAboveGround' if f['variable'] == 'TMP' else 'surface')
            assert eccodes.codes_get(h, 'level') == (2 if f['variable'] == 'TMP' else 0)
            point = eccodes.codes_grib_find_nearest(h, 41.068056, 21.036111, npoints=1)[0]
            assert point['value'] == f['value'] and point['lat'] == f['latitude'] and point['lon'] == f['longitude']
        finally:
            eccodes.codes_release(h)
    spec = importlib.util.spec_from_file_location('sflux', 'scripts/sflux-features.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    prepared = module.prepare(source, day)
    # Separate arithmetic directly from saved raw-field values, no hourly() helper.
    for hour in prepared['hours']:
        start = dt.datetime.fromisoformat(hour['start'].replace('Z', '+00:00'))
        lead = int((start - dt.datetime.fromisoformat(source['runAt'])).total_seconds() / 3600)
        components = {}
        for variable in ('DSWRF', 'VDDSF', 'NDDSF'):
            current = inputs[f'{variable}:{lead+1}']
            length = lead + 1 - current['startLead']
            before = inputs[f'{variable}:{lead}'] if length > 1 else None
            if before:
                assert before['startLead'] == current['startLead']
            components[variable] = current['value'] * length - (before['value'] * (length-1) if before else 0)
        ghi = max(0, components['DSWRF'])
        dhi = max(0, min(ghi, components['VDDSF'] + components['NDDSF']))
        assert abs(ghi-hour['ghi']) < 1e-9 and abs(dhi-hour['diffuse']) < 1e-9
        temp = (inputs[f'TMP:{lead}']['value'] + inputs[f'TMP:{lead+1}']['value'])/2 - 273.15
        assert abs(temp-hour['temperature']) < 1e-9
    (ROOT / 'pilot-features.json').write_text(json.dumps(prepared), encoding='utf-8')
    audit = {'status': 'passed', 'verifiedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
             'date': DATE, 'rawFieldsChecked': 112, 'rawBytesChecked': raw_bytes,
             'hours': len(prepared['hours']), 'radiationPointDistanceKm': source['fields'][0]['distanceKm'],
             'radiationPoint': [source['fields'][0]['latitude'], source['fields'][0]['longitude']],
             'ghiWhM2': sum(h['ghi'] for h in prepared['hours']), 'diffuseWhM2': sum(h['diffuse'] for h in prepared['hours']),
             'roundingAdjustments': prepared['roundingAdjustments'],
             'sourceSha256': hashlib.sha256((ROOT / (DATE + '.json')).read_bytes()).hexdigest(),
             'featuresSha256': hashlib.sha256((ROOT / 'pilot-features.json').read_bytes()).hexdigest(),
             'forecastScored': False, 'productionChanged': False}
    pathlib.Path('docs/sflux-pilot-verification.json').write_text(json.dumps(audit, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(audit), flush=True)

if __name__ == '__main__':
    run()
