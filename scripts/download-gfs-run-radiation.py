"""Original native-hourly GFS DSWRF from one explicit initialization."""
import argparse, concurrent.futures, datetime as dt, hashlib, json, pathlib, threading, urllib.request
import eccodes
p = argparse.ArgumentParser()
p.add_argument('--run', required=True)
p.add_argument('--last', required=True, type=int)
p.add_argument('--out', required=True)
args = p.parse_args()
run = dt.datetime.strptime(args.run, '%Y%m%d%H').replace(tzinfo=dt.timezone.utc)
assert run.hour in (0,6,12,18) and 1 <= args.last <= 48
out = pathlib.Path(args.out)/args.run
out.mkdir(parents=True, exist_ok=True)
lock = threading.Lock()
def download(url, target, byte_range=None):
    meta_path = target.with_suffix(target.suffix+'.http.json')
    if target.exists() and meta_path.exists(): return target.read_bytes(), json.loads(meta_path.read_text())
    headers = {'User-Agent':'ZISSolar-Validation/1.0'}
    if byte_range: headers['Range']='bytes='+byte_range
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=40) as r:
        assert not byte_range or r.status == 206
        raw=r.read(4_000_001)
        assert len(raw) <= 4_000_000
        meta={'receivedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'lastModified':r.headers.get('Last-Modified')}
    target.write_bytes(raw)
    meta_path.write_text(json.dumps(meta))
    return raw,meta
def step(lead):
    url=f'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{run:%Y%m%d}/{run.hour:02}/atmos/gfs.t{run.hour:02}z.pgrb2.0p25.f{lead:03}'
    index,indexmeta=download(url+'.idx',out/f'f{lead:03}.idx')
    lines=[s.split(':') for s in index.decode().strip().splitlines()]
    matches=[i for i,row in enumerate(lines) if ':DSWRF:surface:' in ':'.join(row) and 'ave fcst' in row[5]]
    assert len(matches)==1
    i=matches[0]; start,end=int(lines[i][1]),int(lines[i+1][1])-1
    byte_range=f'{start}-{end}'
    raw,meta=download(url,out/f'f{lead:03}.grib2',byte_range)
    assert len(raw)==end-start+1
    with lock:
        h=eccodes.codes_new_from_message(raw)
        try:
            assert eccodes.codes_get(h,'dataDate')==int(args.run[:8])
            assert eccodes.codes_get(h,'dataTime')==run.hour*100
            assert eccodes.codes_get(h,'stepType')=='avg' and eccodes.codes_get(h,'endStep')==lead
            a,b=eccodes.codes_get(h,'startStep'),eccodes.codes_get(h,'endStep')
            point=eccodes.codes_grib_find_nearest(h,41.068056,21.036111,npoints=1)[0]
            return {**meta,'runAt':run.isoformat(), 'start':(run+dt.timedelta(hours=a)).isoformat(),
                'end':(run+dt.timedelta(hours=b)).isoformat(),'value':point['value'],
                'latitude':point['lat'],'longitude':point['lon'],'distanceKm':point['distance'],
                'units':eccodes.codes_get(h,'units'),'sourceUrl':url,'byteRange':byte_range,
                'sha256':hashlib.sha256(raw).hexdigest(),'indexSha256':hashlib.sha256(index).hexdigest()}
        finally: eccodes.codes_release(h)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    values=list(pool.map(step,range(1,args.last+1)))
(out/'source.json').write_text(json.dumps({'provider':'NOAA GFS','runAt':run.isoformat(),
    'fetchedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'intervals':values},indent=2))
print(json.dumps({'run':args.run,'files':len(values)}),flush=True)
