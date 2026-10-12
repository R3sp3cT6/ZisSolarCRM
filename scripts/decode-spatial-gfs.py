"""Decode existing archived GRIB messages; no network or observed outcomes."""
import datetime as dt
import hashlib
import json
import pathlib
import math
import eccodes
import numpy as np

ROOT=pathlib.Path('work/forecast-research/site-learning/gfs')
OUT=pathlib.Path('work/forecast-research/spatial-gfs');OUT.mkdir(exist_ok=True)
LAT,LON=41.068056,21.036111
read=lambda p:json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
days=[]
for a in sorted(ROOT.glob('*.json')):
    if not '2026-09-21'<=a.stem<='2026-10-11':continue
    day=read(a); fields=[]
    for f in day['fields']:
        p=ROOT/day['date']/f"f{f['endLead']:03}.grib2"; raw=p.read_bytes()
        assert hashlib.sha256(raw).hexdigest()==f['sha256']
        h=eccodes.codes_new_from_message(raw)
        try:
            get=lambda k:eccodes.codes_get(h,k)
            assert get('gridType')=='regular_ll' and get('scanningMode')==0
            assert get('units')=='W m**-2' and get('stepType')=='avg'
            assert get('dataDate')==int(day['runAt'][:10].replace('-','')) and get('dataTime')==1200
            assert get('startStep')==f['startLead'] and get('endStep')==f['endLead']
            dx,dy=get('iDirectionIncrementInDegrees'),get('jDirectionIncrementInDegrees')
            assert dx==dy==.25
            ni,nj=get('Ni'),get('Nj');lat0,lon0=get('latitudeOfFirstGridPointInDegrees'),get('longitudeOfFirstGridPointInDegrees')
            x=((LON-lon0)%360)/dx;y=(lat0-LAT)/dy
            i,j=math.floor(x),math.floor(y);ci,cj=math.floor(x+.5),math.floor(y+.5)
            assert 0<i<ni-2 and 0<j<nj-2
            values=np.array(eccodes.codes_get_values(h));assert len(values)==ni*nj
            def point(ii,jj):
                value=float(values[jj*ni+ii]);assert math.isfinite(value) and 0<=value<=1800
                return {'i':ii,'j':jj,'latitude':lat0-jj*dy,'longitude':((lon0+ii*dx+180)%360)-180,'value':value}
            fx,fy=x-i,y-j
            corners=[{**point(ii,jj),'weight':w} for ii,jj,w in [(i,j,(1-fx)*(1-fy)),(i+1,j,fx*(1-fy)),(i,j+1,(1-fx)*fy),(i+1,j+1,fx*fy)]]
            neighbourhood=[point(ii,jj) for jj in range(cj-1,cj+2) for ii in range(ci-1,ci+2)]
            nearest=point(ci,cj);assert abs(nearest['value']-f['value'])<1e-8
            fields.append({**f,'nearest':nearest,'corners':corners,'neighbourhood':neighbourhood,'bilinear':sum(p['weight']*p['value'] for p in corners),'mean9':sum(p['value'] for p in neighbourhood)/9})
        finally:eccodes.codes_release(h)
    days.append({**day,'fields':fields})
    print(json.dumps({'decoded':day['date'],'fields':len(fields)}),flush=True)
assert len(days)==21
payload={'decodedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'latitude':LAT,'longitude':LON,'days':days}
(OUT/'decoded.json').write_text(json.dumps(payload),encoding='utf-8')
