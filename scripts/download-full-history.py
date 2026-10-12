"""Bounded native-hourly GFS archive, previous-day12UTC; records publication evidence."""
import concurrent.futures, datetime as dt, email.utils, hashlib, json, pathlib, threading, time, urllib.request
import eccodes
import requests

source = json.loads(pathlib.Path('work/forecast-research/full-history/source.json').read_text(encoding='utf-8'))
root = pathlib.Path('work/forecast-research/full-history/gfs')
root.mkdir(parents=True, exist_ok=True)
lock = threading.Lock()
local = threading.local()
first, last = dt.date.fromisoformat(source['first']), dt.date.fromisoformat(source['last'])

def get(url, path, byte_range=None):
    meta_path = path.with_suffix(path.suffix + '.http.json')
    if path.exists() and meta_path.exists():
        return path.read_bytes(), json.loads(meta_path.read_text())
    for attempt in range(3):
        try:
            headers = {'User-Agent': 'ZISSolar-Research/1.0'}
            if byte_range: headers['Range'] = 'bytes=' + byte_range
            if not hasattr(local, 'session'): local.session = requests.Session()
            with local.session.get(url, headers=headers, timeout=35, stream=True, allow_redirects=False) as r:
                r.raise_for_status()
                assert not byte_range or r.status_code == 206
                if byte_range: assert r.headers['Content-Range'].startswith('bytes ' + byte_range + '/')
                raw = r.raw.read(4_000_001)
                assert len(raw) <= 4_000_000
                meta = {'receivedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'lastModified': r.headers.get('Last-Modified')}
            path.write_bytes(raw)
            meta_path.write_text(json.dumps(meta))
            return raw, meta
        except Exception:
            if attempt == 2: raise
            time.sleep(1)

def field(task):
    day, lead = task
    run = dt.datetime.combine(day - dt.timedelta(days=1), dt.time(12), dt.timezone.utc)
    folder = root / day.isoformat()
    folder.mkdir(exist_ok=True)
    url = f'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{run:%Y%m%d}/12/atmos/gfs.t12z.pgrb2.0p25.f{lead:03}'
    index, im = get(url + '.idx', folder / f'f{lead:03}.idx')
    lines = [s.split(':') for s in index.decode().strip().splitlines()]
    matches = [i for i, r in enumerate(lines) if ':DSWRF:surface:' in ':'.join(r) and 'ave fcst' in r[5]]
    assert len(matches) == 1
    i = matches[0]; start, end = int(lines[i][1]), int(lines[i + 1][1]) - 1
    byte_range = f'{start}-{end}'
    raw, meta = get(url, folder / f'f{lead:03}.grib2', byte_range)
    assert len(raw) == end - start + 1
    published = email.utils.parsedate_to_datetime(meta['lastModified'])
    assert published <= run + dt.timedelta(hours=6), 'Published after forecast cutoff'
    with lock:
        h = eccodes.codes_new_from_message(raw)
        try:
            assert eccodes.codes_get(h, 'dataDate') == int(run.strftime('%Y%m%d'))
            assert eccodes.codes_get(h, 'dataTime') == 1200
            assert eccodes.codes_get(h, 'stepType') == 'avg'
            assert eccodes.codes_get(h, 'units') == 'W m**-2'
            a, b = eccodes.codes_get(h, 'startStep'), eccodes.codes_get(h, 'endStep')
            assert b == lead
            point = eccodes.codes_grib_find_nearest(h, 41.068056, 21.036111, npoints=1)[0]
            assert point['distance'] < 25
            return {'day': day.isoformat(), 'startLead': a, 'endLead': b, 'value': point['value'], 'latitude': point['lat'], 'longitude': point['lon'], 'distanceKm': point['distance'], **meta, 'url': url, 'byteRange': byte_range, 'sha256': hashlib.sha256(raw).hexdigest(), 'indexSha256': hashlib.sha256(index).hexdigest()}
        finally: eccodes.codes_release(h)

days = [first + dt.timedelta(days=i) for i in range((last-first).days + 1)]
reused = 0
for day in days:
    existing = pathlib.Path('work/forecast-research/site-learning/gfs') / (day.isoformat()+'.json')
    if existing.exists() and not (root / (day.isoformat()+'.json')).exists():
        (root / (day.isoformat()+'.json')).write_bytes(existing.read_bytes())
        reused += 1
pending = [day for day in days if not (root / (day.isoformat() + '.json')).exists()]
print(json.dumps({'range':[str(first),str(last)],'reusedDays':reused,'pendingDays':len(pending)}),flush=True)
# Native means ending at10..34 cover every delivery hour; f7..9 establish reset baselines.
tasks = [(day, lead) for day in pending for lead in range(7, 35)]
results = {day.isoformat(): [] for day in pending}
failures = []
def safe_field(task):
    try: return field(task)
    except Exception as error: return {'failedDay':task[0].isoformat(),'lead':task[1],'error':str(error)}
with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
    for value in pool.map(safe_field, tasks):
        if 'failedDay' in value:
            failures.append(value)
            print(json.dumps(value),flush=True)
            continue
        values = results[value['day']]
        values.append(value)
        if len(values) == 28:
            run = dt.datetime.combine(dt.date.fromisoformat(value['day']) - dt.timedelta(days=1), dt.time(12), dt.timezone.utc)
            output = {'date': value['day'], 'provider': 'NOAA GFS', 'nativeResolutionHours': 1, 'runAt': run.isoformat(), 'originAt': (run + dt.timedelta(hours=6)).isoformat(), 'fields': sorted(values, key=lambda f: f['endLead'])}
            (root / (value['day'] + '.json')).write_text(json.dumps(output))
            print(json.dumps({'day': value['day'], 'fields': len(values)}), flush=True)
summary={'requestedDays':len(days),'completeDays':sum((root/(str(d)+'.json')).exists() for d in days),'failures':failures}
(root.parent/'download-status.json').write_text(json.dumps(summary))
print(json.dumps(summary), flush=True)
