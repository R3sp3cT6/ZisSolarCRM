"""Original hourly NOAA radiation partition and temperature, bounded public reads.

Raw GRIB cache lives outside OneDrive; decoded point evidence stays with research.
No fitting, target observations, database access or runtime configuration changes.
"""
import argparse
import concurrent.futures
import datetime as dt
import email.utils
import hashlib
import json
import os
import pathlib
import threading
import time
import eccodes
import requests

CACHE = pathlib.Path(os.environ['LOCALAPPDATA']) / 'ZisSolar' / 'gfs-sflux-research'
OUT = pathlib.Path('work/forecast-research/sflux')
VARIABLES = ['DSWRF', 'VDDSF', 'NDDSF', 'TMP']
LAT, LON = 41.068056, 21.036111
LOCAL = threading.local()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def get(url, path, byte_range=None):
    meta_path = path.with_suffix(path.suffix + '.http.json')
    if path.exists() and meta_path.exists():
        raw, meta = path.read_bytes(), json.loads(meta_path.read_text())
        assert len(raw) == meta['bytes'] and sha(raw) == meta['sha256']
        return raw, meta
    if not hasattr(LOCAL, 'session'):
        LOCAL.session = requests.Session()
    limit = 8_000_000 if byte_range else 150_000
    for attempt in range(3):
        try:
            headers = {'User-Agent': 'ZISSolar-Research/1.0'}
            if byte_range:
                headers['Range'] = 'bytes=' + byte_range
            with LOCAL.session.get(url, headers=headers, timeout=40, stream=True, allow_redirects=False) as response:
                response.raise_for_status()
                if byte_range:
                    assert response.status_code == 206
                    assert response.headers['Content-Range'].startswith('bytes ' + byte_range + '/')
                raw = response.raw.read(limit + 1)
                assert len(raw) <= limit, 'Unexpected field size'
                meta = {'receivedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                        'lastModified': response.headers.get('Last-Modified'),
                        'etag': response.headers.get('ETag'), 'sha256': sha(raw), 'bytes': len(raw),
                        'url': url, 'byteRange': byte_range}
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
            meta_path.write_text(json.dumps(meta))
            return raw, meta
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1)

def field(task):
    date, lead = task
    day = dt.date.fromisoformat(date)
    run = dt.datetime.combine(day - dt.timedelta(days=1), dt.time(12), dt.timezone.utc)
    folder = CACHE / date
    target = folder / f'f{lead:03}.decoded.json'
    if target.exists():
        result = json.loads(target.read_text())
        assert result['date'] == date and result['lead'] == lead and result['version'] == 'sflux-point-v1'
        return result
    base = f'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{run:%Y%m%d}/12/atmos/'
    files = {'native': base + f'gfs.t12z.sfluxgrbf{lead:03}.grib2',
             'temperature': base + f'gfs.t12z.pgrb2.0p25.f{lead:03}'}
    indices = {}
    for kind, url in files.items():
        raw_index, index_meta = get(url + '.idx', folder / f'f{lead:03}-{kind}.idx')
        indices[kind] = (raw_index, [line.split(':') for line in raw_index.decode().strip().splitlines()], index_meta)
    def download_variable(variable):
        kind = 'temperature' if variable == 'TMP' else 'native'
        raw_index, lines, index_meta = indices[kind]
        matches = [i for i, r in enumerate(lines) if r[3] == variable and
                   (r[4] == '2 m above ground' if variable == 'TMP' else r[4] == 'surface' and 'ave fcst' in r[5])]
        assert len(matches) == 1, (variable, matches)
        i = matches[0]
        begin, end = int(lines[i][1]), int(lines[i + 1][1]) - 1
        byte_range = f'{begin}-{end}'
        raw, meta = get(files[kind], folder / f'f{lead:03}-{variable}.grib2', byte_range)
        assert len(raw) == end - begin + 1
        for metadata in [meta, index_meta]:
            publication = email.utils.parsedate_to_datetime(metadata['lastModified'])
            assert publication <= run + dt.timedelta(hours=6), 'Source publication after forecast cutoff'
        return variable, raw, meta, raw_index, index_meta

    # HTTP-only threads; ecCodes decoding remains sequential inside each process.
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as http_pool:
        downloads = list(http_pool.map(download_variable, VARIABLES))
    fields = []
    for variable, raw, meta, raw_index, index_meta in downloads:
        handle = eccodes.codes_new_from_message(raw)
        try:
            assert eccodes.codes_get(handle, 'dataDate') == int(run.strftime('%Y%m%d'))
            assert eccodes.codes_get(handle, 'dataTime') == 1200
            unit = eccodes.codes_get(handle, 'units')
            step_type = eccodes.codes_get(handle, 'stepType')
            assert unit == ('K' if variable == 'TMP' else 'W m**-2'), unit
            assert step_type == ('instant' if variable == 'TMP' else 'avg'), step_type
            assert eccodes.codes_get(handle, 'endStep') == lead
            point = eccodes.codes_grib_find_nearest(handle, LAT, LON, npoints=1)[0]
            assert point['distance'] < 25
            value = point['value']
            assert (180 < value < 340) if variable == 'TMP' else (0 <= value < 1600)
            fields.append({'variable': variable, 'startLead': eccodes.codes_get(handle, 'startStep'),
                           'endLead': lead, 'value': value, 'units': unit, 'stepType': step_type,
                           'gridType': eccodes.codes_get(handle, 'gridType'),
                           'latitude': point['lat'], 'longitude': point['lon'], 'distanceKm': point['distance'],
                           'indexSha256': sha(raw_index), 'indexLastModified': index_meta['lastModified'], **meta})
        finally:
            eccodes.codes_release(handle)
    result = {'version': 'sflux-point-v1', 'date': date, 'lead': lead, 'fields': fields}
    target.write_text(json.dumps(result, allow_nan=False))
    return result

def safe_field(task):
    try:
        return field(task)
    except Exception as error:
        return {'failedDate': task[0], 'lead': task[1], 'error': str(error)}

def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--date')
    parser.add_argument('--workers', type=int, default=12)
    args = parser.parse_args()
    assert 1 <= args.workers <= 16
    source = json.loads(pathlib.Path('work/forecast-research/full-history/source.json').read_text(encoding='utf-8'))
    days = [d['date'] for d in source['days']]
    if args.date:
        assert args.date in days
        days = [args.date]
    OUT.mkdir(parents=True, exist_ok=True)
    pending = [d for d in days if not (OUT / (d + '.json')).exists()]
    print(json.dumps({'requestedDays': len(days), 'pendingDays': len(pending), 'workers': args.workers}), flush=True)
    results = {d: [] for d in pending}
    failures = []
    started = time.perf_counter()
    # Per-process ecCodes handles avoid sharing its native decoder between threads.
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(safe_field, (d, lead)) for d in pending for lead in range(7, 35)]
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            item = future.result()
            completed += 1
            if 'failedDate' in item:
                failures.append(item)
                print(json.dumps(item), flush=True)
                continue
            date = item['date']
            results[date].append(item)
            if len(results[date]) == 28:
                day = dt.date.fromisoformat(date)
                run_at = dt.datetime.combine(day - dt.timedelta(days=1), dt.time(12), dt.timezone.utc)
                output = {'version': 'sflux-point-v1', 'date': date, 'runAt': run_at.isoformat(),
                          'originAt': (run_at + dt.timedelta(hours=6)).isoformat(),
                          'retrievedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                          'fields': [f for point in sorted(results[date], key=lambda r: r['lead']) for f in point['fields']]}
                (OUT / (date + '.json')).write_text(json.dumps(output, allow_nan=False))
                print(json.dumps({'date': date, 'complete': True, 'fields': len(output['fields'])}), flush=True)
            if completed % 100 == 0:
                print(json.dumps({'completedTasks': completed, 'totalTasks': len(futures), 'seconds': round(time.perf_counter() - started)}), flush=True)
    status = {'requestedDays': len(days), 'completeDays': sum((OUT / (d + '.json')).exists() for d in days),
              'failures': failures, 'seconds': time.perf_counter() - started,
              'finishedAt': dt.datetime.now(dt.timezone.utc).isoformat()}
    (OUT / ('pilot-status.json' if args.date else 'download-status.json')).write_text(json.dumps(status))
    print(json.dumps(status), flush=True)

if __name__ == '__main__':
    run()
