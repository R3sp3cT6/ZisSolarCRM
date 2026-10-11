"""Archive original GFS DSWRF interval means, including bounds for de-averaging.
Uses the same fixed prior-day 12 UTC run as download-gfs-backtest.py.
Requires eccodes; no credentials or paid API. Never treat averages as instant values.
"""
import argparse, concurrent.futures, datetime as dt, hashlib, json, pathlib, threading, urllib.request
import eccodes
p = argparse.ArgumentParser()
p.add_argument('--from-date', required=True)
p.add_argument('--to-date', required=True)
p.add_argument('--out', required=True)
p.add_argument('--hourly', action='store_true', help='Archive native hourly means for diagnostic replay; use a separate output directory.')
args = p.parse_args()
out = pathlib.Path(args.out)
out.mkdir(parents=True, exist_ok=True)
first, last = dt.date.fromisoformat(args.from_date), dt.date.fromisoformat(args.to_date)
assert 0 <= (last-first).days < 32
decode_lock = threading.Lock()

def download(url, path, byte_range=None):
    if path.exists(): return path.read_bytes()
    headers = {'User-Agent':'ZISSolar-Validation/1.0'}
    if byte_range: headers['Range']='bytes='+byte_range
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=40) as r:
        if byte_range and r.status != 206: raise ValueError('Range not honoured')
        raw=r.read(4_000_001)
        if len(raw)>4_000_000: raise ValueError('Response too large')
    path.write_bytes(raw)
    return raw

def step(day, lead):
    run=dt.datetime.combine(day-dt.timedelta(days=1),dt.time(12),dt.timezone.utc)
    stamp=run.strftime('%Y%m%d'); name=f'{stamp}-12-f{lead:03}'
    url=f'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{stamp}/12/atmos/gfs.t12z.pgrb2.0p25.f{lead:03}'
    index=download(url+'.idx',out/(name+'.idx'))
    lines=[s.split(':') for s in index.decode().strip().splitlines()]
    matches=[i for i,row in enumerate(lines) if ':DSWRF:surface:' in ':'.join(row) and 'ave fcst' in row[5]]
    assert len(matches)==1
    i=matches[0]; start,end=int(lines[i][1]),int(lines[i+1][1])-1
    byte_range=f'{start}-{end}'
    raw=download(url,out/(name+'-radiation.grib2'),byte_range)
    assert len(raw)==end-start+1
    with decode_lock:
        m=eccodes.codes_new_from_message(raw)
        try:
            assert eccodes.codes_get(m,'dataDate')==int(stamp)
            assert eccodes.codes_get(m,'dataTime')==1200
            assert eccodes.codes_get(m,'stepType')=='avg'
            assert eccodes.codes_get(m,'endStep')==lead
            a,b=eccodes.codes_get(m,'startStep'),eccodes.codes_get(m,'endStep')
            point=eccodes.codes_grib_find_nearest(m,41.068056,21.036111,npoints=1)[0]
            return {'runAt':run.isoformat().replace('+00:00','Z'),
                'start':(run+dt.timedelta(hours=a)).isoformat().replace('+00:00','Z'),
                'end':(run+dt.timedelta(hours=b)).isoformat().replace('+00:00','Z'),
                'value':point['value'],'latitude':point['lat'],'longitude':point['lon'],
                'distanceKm':point['distance'],'units':eccodes.codes_get(m,'units'),
                'sourceUrl':url,'byteRange':byte_range,'sha256':hashlib.sha256(raw).hexdigest(),
                'indexSha256':hashlib.sha256(index).hexdigest()}
        finally: eccodes.codes_release(m)

for i in range((last-first).days+1):
    day=first+dt.timedelta(days=i); target=out/(day.isoformat()+('-radiation-hourly.json' if args.hourly else '-radiation.json'))
    if target.exists():
        print(day,'already archived',flush=True); continue
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        values=list(pool.map(lambda lead:step(day,lead),range(7,37) if args.hourly else range(9,37,3)))
    target.write_text(json.dumps({'day':day.isoformat(),'provider':'NOAA GFS',
        'fetchedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'intervals':values},indent=2))
    print(day,'saved',len(values),'DSWRF intervals',flush=True)
