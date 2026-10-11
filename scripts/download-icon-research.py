"""Archive fixed original DWD runs. Offline research; no cache or SQL mutation.

Retain original publication headers and receipt time. Do not treat a model's
initialization as the time its files became publicly available.
"""
import argparse, bz2, concurrent.futures, datetime as dt, hashlib, json, pathlib, threading, urllib.request
import eccodes

p = argparse.ArgumentParser()
p.add_argument('--run', required=True, help='YYYYMMDDHH')
p.add_argument('--first', required=True, type=int)
p.add_argument('--last', required=True, type=int)
p.add_argument('--out', required=True)
args = p.parse_args()
run = dt.datetime.strptime(args.run, '%Y%m%d%H').replace(tzinfo=dt.timezone.utc)
assert run.hour in (0, 6, 12, 18)
assert 0 <= args.first < args.last <= 78
out = pathlib.Path(args.out) / args.run
out.mkdir(parents=True, exist_ok=True)
lock = threading.Lock()

def step(task):
    lead, field = task
    name = f'icon-eu_europe_regular-lat-lon_single-level_{args.run}_{lead:03}_{field}'
    url = f'https://opendata.dwd.de/weather/nwp/icon-eu/grib/{run.hour:02}/{field.lower()}/{name}.grib2.bz2'
    packed_path, meta_path = out/(name+'.grib2.bz2'), out/(name+'.json')
    if packed_path.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text())
        assert hashlib.sha256(packed_path.read_bytes()).hexdigest() == meta['sha256']
        return meta
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'ZISSolar-Validation/1.0'}), timeout=30) as r:
        packed = r.read(4_000_001)
        assert len(packed) <= 4_000_000
        modified = r.headers.get('Last-Modified')
    raw = bz2.decompress(packed)
    assert len(raw) < 4_000_000
    with lock:
        h = eccodes.codes_new_from_message(raw)
        try:
            assert eccodes.codes_get(h, 'dataDate') == int(args.run[:8])
            assert eccodes.codes_get(h, 'dataTime') == run.hour*100
            assert eccodes.codes_get(h, 'shortName') == field
            assert eccodes.codes_get(h, 'units') == 'W m-2'
            assert eccodes.codes_get(h, 'stepType') == 'avg'
            assert eccodes.codes_get_long(h, 'startStep') == 0
            assert eccodes.codes_get_long(h, 'endStep') == lead
            assert eccodes.codes_get(h, 'gridType') == 'regular_ll'
            point = eccodes.codes_grib_find_nearest(h, 41.068056, 21.036111, npoints=1)[0]
            assert 0 <= point['value'] <= 1600
            meta = {'url':url, 'sha256':hashlib.sha256(packed).hexdigest(),
                'gribSha256':hashlib.sha256(raw).hexdigest(), 'runAt':run.isoformat(),
                'receivedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
                'lastModified':modified, 'field':field, 'lead':lead,
                'value':point['value'], 'latitude':point['lat'], 'longitude':point['lon'],
                'distanceKm':point['distance'], 'units':'W m-2', 'stepType':'avg', 'startStep':0}
        finally:
            eccodes.codes_release(h)
    packed_path.write_bytes(packed)
    meta_path.write_text(json.dumps(meta, indent=2))
    return meta

tasks = [(lead, field) for lead in range(args.first, args.last+1) for field in ('ASWDIR_S','ASWDIFD_S')]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    files = list(pool.map(step, tasks))
source = {'provider':'DWD ICON-EU', 'runAt':run.isoformat(), 'fetchedAt':dt.datetime.now(dt.timezone.utc).isoformat(), 'files':files}
(out/'source.json').write_text(json.dumps(source, indent=2))
print(json.dumps({'run':args.run, 'files':len(files), 'latitude':files[0]['latitude'], 'longitude':files[0]['longitude']}), flush=True)
