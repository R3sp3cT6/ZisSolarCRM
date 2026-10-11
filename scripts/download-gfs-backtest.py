"""Fetch a small, reproducible GFS point archive; no credentials or paid API.

Requires eccodes. GRIB byte ranges and decoded point values are preserved locally.
Only 12 UTC runs from the day BEFORE delivery are used. Three-hour snapshots
are decoded as instantaneous fields; averaged TCDC records are excluded.
"""
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import pathlib
import urllib.request
import threading
decode_lock = threading.Lock()
import eccodes

p = argparse.ArgumentParser()
p.add_argument('--from-date', required=True)
p.add_argument('--to-date', required=True)
p.add_argument('--out', required=True)
args = p.parse_args()
out = pathlib.Path(args.out)
out.mkdir(parents=True, exist_ok=True)
first, last = dt.date.fromisoformat(args.from_date), dt.date.fromisoformat(args.to_date)
assert 0 <= (last-first).days < 32
fields = {'temperature': ':TMP:2 m above ground:', 'u': ':UGRD:10 m above ground:',
          'v': ':VGRD:10 m above ground:', 'cloud': ':TCDC:entire atmosphere:'}

def download(url, path, byte_range=None):
    if path.exists():
        return path.read_bytes()
    headers = {'User-Agent': 'ZISSolar-HistoricalValidation/1.0'}
    if byte_range:
        headers['Range'] = 'bytes=' + byte_range
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=40) as r:
        if byte_range and r.status != 206:
            raise ValueError('Range request was not honoured')
        value = r.read(4_000_001)
        if len(value) > 4_000_000:
            raise ValueError('Unexpectedly large weather response')
    path.write_bytes(value)
    return value

def step(day, lead):
    run = dt.datetime.combine(day-dt.timedelta(days=1), dt.time(12), dt.timezone.utc)
    stamp = run.strftime('%Y%m%d')
    name = f'{stamp}-12-f{lead:03}'
    url = f'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{stamp}/12/atmos/gfs.t12z.pgrb2.0p25.f{lead:03}'
    index = download(url+'.idx', out/(name+'.idx')).decode()
    lines = [line.split(':') for line in index.strip().splitlines()]
    result = {'validAt': (run+dt.timedelta(hours=lead)).isoformat().replace('+00:00','Z'),
              'runAt': run.isoformat().replace('+00:00','Z'), 'sourceUrl': url,
              'indexSha256': hashlib.sha256(index.encode()).hexdigest(), 'fields': {}}
    for key, marker in fields.items():
        matches = [i for i, row in enumerate(lines) if marker in ':'.join(row) and row[5] == f'{lead} hour fcst']
        if len(matches) != 1:
            raise ValueError(f'Ambiguous field {name} {key}')
        i = matches[0]
        start, end = int(lines[i][1]), int(lines[i+1][1])-1
        byte_range = f'{start}-{end}'
        raw = download(url, out/(name+'-'+key+'.grib2'), byte_range)
        if len(raw) != end-start+1:
            raise ValueError('Truncated GRIB range')
        with decode_lock:
            message = eccodes.codes_new_from_message(raw)
            try:
                assert eccodes.codes_get(message, 'dataDate') == int(stamp)
                assert eccodes.codes_get(message, 'dataTime') == 1200
                assert eccodes.codes_get(message, 'endStep') == lead
                assert eccodes.codes_get(message, 'stepType') == 'instant'
                point = eccodes.codes_grib_find_nearest(message, 41.068056, 21.036111, npoints=1)[0]
                result['fields'][key] = {'value': point['value'], 'latitude': point['lat'],
                    'longitude': point['lon'], 'distanceKm': point['distance'],
                    'units': eccodes.codes_get(message, 'units'), 'shortName': eccodes.codes_get(message,'shortName'),
                    'byteRange': byte_range, 'sha256': hashlib.sha256(raw).hexdigest()}
            finally:
                eccodes.codes_release(message)
    return result

days = [first+dt.timedelta(days=i) for i in range((last-first).days+1)]
for day in days:
    target = out/(day.isoformat()+'.json')
    if target.exists():
        print(day, 'already archived', flush=True)
        continue
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        values = list(pool.map(lambda h: step(day,h), range(9,37,3)))
    target.write_text(json.dumps({'day': day.isoformat(), 'provider':'NOAA GFS',
        'gridDegrees':0.25, 'resolutionHours':3, 'latitude':41.068056, 'longitude':21.036111,
        'fetchedAt':dt.datetime.now(dt.timezone.utc).isoformat(), 'points':values}, indent=2))
    print(day, 'saved', len(values), 'forecast steps', flush=True)
