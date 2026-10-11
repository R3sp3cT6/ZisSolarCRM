"""Archive original, native-hourly ARPEGE Europe solar forecasts for Resen.

Public Météo-France SP1 packages, Open Licence 2.0. This is an offline
research collector; it does not change production forecasts or measurements.
Requires requests and eccodes. Binary packages stay in ignored work/.
"""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import requests
import eccodes as ec

parser = argparse.ArgumentParser()
parser.add_argument('--run', required=True, help='Original initialization YYYYMMDDHH')
parser.add_argument('--last', type=int, default=24)
parser.add_argument('--out', default='work/forecast-research/arpege')
args = parser.parse_args()
run = dt.datetime.strptime(args.run, '%Y%m%d%H').replace(tzinfo=dt.timezone.utc)
assert run.hour in (0, 6, 12, 18) and 1 <= args.last <= 48
iso = run.strftime('%Y-%m-%dT%H:00:00Z')
folder = pathlib.Path(args.out) / args.run
folder.mkdir(parents=True, exist_ok=True)
files, points = [], []
for first in range(0, args.last, 12):
    chunk = f'{0 if first == 0 else first + 1:03}H{first + 12:03}H'
    name = f'arpege__01__SP1__{chunk}__{iso}.grib2'
    url = f'https://meteofrance-pnt.s3.rbx.io.cloud.ovh.net/pnt/{iso}/arpege/01/SP1/{name}'
    dest = folder / (chunk + '.grib2')
    metadata = dest.with_suffix('.json')
    if not (dest.exists() and metadata.exists()):
        with requests.get(url, stream=True, timeout=60) as response:
            response.raise_for_status()
            size = 0
            with dest.with_suffix('.part').open('wb') as target:
                for data in response.iter_content(1024 * 1024):
                    size += len(data)
                    if size > 120_000_000:
                        raise ValueError('Oversized ARPEGE package')
                    target.write(data)
            dest.with_suffix('.part').replace(dest)
            metadata.write_text(json.dumps({
                'url': url, 'receivedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'lastModified': response.headers.get('Last-Modified'),
                'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(), 'bytes': size,
            }, indent=2))
    record = json.loads(metadata.read_text())
    assert record['url'] == url
    assert record['sha256'] == hashlib.sha256(dest.read_bytes()).hexdigest()
    files.append(record)
    with dest.open('rb') as stream:
        while (handle := ec.codes_grib_new_from_file(stream)) is not None:
            try:
                if ec.codes_get(handle, 'shortName') != 'ssrd':
                    continue
                assert ec.codes_get(handle, 'units') == 'J m**-2'
                assert ec.codes_get(handle, 'stepType') == 'accum'
                assert ec.codes_get(handle, 'typeOfLevel') == 'surface'
                assert ec.codes_get_long(handle, 'dataDate') == int(args.run[:8])
                assert ec.codes_get_long(handle, 'dataTime') == run.hour * 100
                assert ec.codes_get_long(handle, 'startStep') == 0
                assert ec.codes_get_long(handle, 'stepUnits') == 1
                assert ec.codes_get(handle, 'gridType') == 'regular_ll'
                assert abs(ec.codes_get(handle, 'iDirectionIncrementInDegrees') - .1) < 1e-9
                assert abs(ec.codes_get(handle, 'jDirectionIncrementInDegrees') - .1) < 1e-9
                lead = ec.codes_get_long(handle, 'endStep')
                if lead > args.last:
                    continue
                point = ec.codes_grib_find_nearest(handle, 41.068056, 21.036111)[0]
                assert point['distance'] < 15
                assert 0 <= point['value'] < 200_000_000
                points.append({
                    'lead': lead, 'joulesM2': point['value'],
                    'latitude': point['lat'], 'longitude': point['lon'],
                    'distanceKm': point['distance'], 'url': url,
                    'messageSha256': hashlib.sha256(ec.codes_get_message(handle)).hexdigest(),
                })
            finally:
                ec.codes_release(handle)
    print(f'{args.run} {chunk}: archived {len(points)} solar fields', flush=True)
points.sort(key=lambda p: p['lead'])
assert [p['lead'] for p in points] == list(range(1, args.last + 1))
hours = []
previous = 0
clamped_joules = 0
for point in points:
    ghi = (point['joulesM2'] - previous) / 3600
    assert -.5 <= ghi <= 1800
    # Independently packed cumulative fields can fall slightly during darkness.
    # Preserve the raw totals; allow only sub-0.5 W/m2 quantization, never resets.
    clamped_joules += max(0, -ghi) * 3600
    hours.append({
        'start': (run + dt.timedelta(hours=point['lead'] - 1)).isoformat(),
        'irradiance': max(0, ghi), 'resolutionHours': 1,
    })
    previous = point['joulesM2']
assert abs(sum(p['irradiance'] for p in hours) * 3600 - previous - clamped_joules) < .001
payload = {
    'provider': 'Meteo-France ARPEGE Europe', 'license': 'Open Licence 2.0',
    'runAt': iso, 'fetchedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
    'site': {'latitude': 41.068056, 'longitude': 21.036111},
    'gridDegrees': .1, 'resolutionHours': 1, 'files': files,
    'negativeQuantizationClampedWhM2': clamped_joules / 3600,
    'points': points, 'hours': hours,
}
(folder / 'source.json').write_text(json.dumps(payload, indent=2) + '\n')
print(f'Validated {len(hours)} native-hourly solar intervals for Resen', flush=True)
