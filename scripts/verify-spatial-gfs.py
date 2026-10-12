"""Independent spatial geometry, hourly integration and score verification."""
import datetime as dt
import email.utils
import hashlib
import json
import pathlib
import numpy as np
ROOT=pathlib.Path('work/forecast-research/spatial-gfs')
def read(p):return json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def stamp(s):return dt.datetime.fromisoformat(s.replace('Z','+00:00'))
input=read(ROOT/'inputs.json');frozen=read('docs/spatial-gfs-frozen.json');report=read('docs/spatial-gfs-evaluation.json');runs=read(ROOT/'runs.json')
assert sha(ROOT/'inputs.json')==frozen['inputSha256']==report['inputSha256']
for p,h in frozen['codeHashes'].items():assert sha(p)==h,p
count=0;hour_count=0;maximum=0
for d,run in zip(input['days'],runs):
    assert d['date']==run['date']
    for f in d['fields']:
        count+=1
        assert email.utils.parsedate_to_datetime(f['lastModified'])<stamp(d['originAt'])
        corners=f['corners'];assert abs(sum(p['weight'] for p in corners)-1)<1e-12
        assert all(0<=p['weight']<=1 for p in corners)
        assert abs(sum(p['weight']*p['latitude'] for p in corners)-input['config']['latitude'])<1e-10
        assert abs(sum(p['weight']*p['longitude'] for p in corners)-input['config']['longitude'])<1e-10
        assert abs(sum(p['weight']*p['value'] for p in corners)-f['bilinear'])<1e-9
        assert len(f['neighbourhood'])==9 and len({(p['latitude'],p['longitude']) for p in f['neighbourhood']})==9
        assert abs(sum(p['value'] for p in f['neighbourhood'])/9-f['mean9'])<1e-9
        assert f['nearest']['value']==f['value']
    by_end={f['endLead']:f for f in d['fields']}
    for method,forecasts in run['forecasts'].items():
        field='value' if method=='nearest' else method
        for h in forecasts:
            lead=int((stamp(h['start'])-stamp(d['runAt'])).total_seconds()/3600)+1
            f=by_end[lead];duration=f['endLead']-f['startLead'];prev=by_end.get(lead-1)
            if duration>1:assert prev and prev['startLead']==f['startLead']
            ghi=duration*f[field]-(duration-1)*(prev[field] if prev else 0)
            if ghi<1e-9:ghi=0
            maximum=max(maximum,abs(ghi-h['irradiance']));hour_count+=1
assert maximum<1e-8
original={r['start']:r for r in read('docs/site-learning-evaluation.json')['rows']}
for r in report['rows']:
    assert abs(r['v32']-original[r['start']]['v32'])<1e-8
    assert abs(r['nearest']-original[r['start']]['nativePhysics'])<1e-8
    assert r['actualKwh']==original[r['start']]['actualKwh']
selection=read(ROOT/'selection.json');assert report['selected']==selection['selected']==min(['bilinear','mean9'],key=lambda k:selection['scores'][k]['wape'])
bootstrap={}
for period in ['all','september','october']:
    rows=[r for r in report['rows'] if period=='all' or (r['date']<'2026-10-01')==(period=='september')]
    a=np.array([r['actualKwh'] for r in rows])
    for key in ['v32','nearest','bilinear','mean9']:
        e=np.array([r[key] for r in rows])-a;s=report['scores'][period][key]
        assert abs(s['wape']-100*np.abs(e).sum()/a.sum())<1e-8
        assert abs(s['rmseKwh']-np.sqrt((e*e).mean()))<1e-8
    ds=[d for d in report['daily'] if period=='all' or (d['date']<'2026-10-01')==(period=='september')]
    rng=np.random.default_rng(42);deltas=[]
    for _ in range(5000):
        sample=[ds[i]['scores'] for i in rng.integers(0,len(ds),len(ds))]
        deltas.append(sum((s[report['selected']]['wape']-s['v32']['wape'])*s['v32']['actualMwh'] for s in sample)/sum(s['v32']['actualMwh'] for s in sample))
    bootstrap[period]={'deltaPp95':np.percentile(deltas,[2.5,97.5]).tolist(),'wins':sum(d['scores'][report['selected']]['wape']<d['scores']['v32']['wape'] for d in ds),'days':len(ds)}
verification={'status':'passed','verifiedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'fields':count,'hourlyConversions':hour_count,'maxIrradianceDifference':maximum,'inputSha256':sha(ROOT/'inputs.json'),'runsSha256':sha(ROOT/'runs.json'),'evaluationSha256':sha('docs/spatial-gfs-evaluation.json'),'bootstrap':bootstrap}
pathlib.Path('docs/spatial-gfs-verification.json').write_text(json.dumps(verification,indent=2)+'\n',encoding='utf-8')
lines=['# Просторна проверка на облачните прогнози','', 'Тестирани се оригинални часовни GFS податоци со најблиската мрежна точка, билинеарна пресметка од четирите околни точки и просек од 3×3 точки. Одзивот на централата, температурата, ветерот и претходната калибрација се идентични. Не се применува временско измазнување или тричасовна агрегација.','', '| Варијанта | 21–30 септември WAPE | 1–11 октомври WAPE | Сите 21 дена |','|---|---:|---:|---:|']
for k,label in [('v32','Архивиран v3.2'),('nearest','Изворен часовен GFS, најблиска точка'),('bilinear','Билинеарна пресметка'),('mean9','Просек од 9 точки')]:
    s=report['scores'];lines.append(f"| {label} | {s['september'][k]['wape']:.4f}% | {s['october'][k]['wape']:.4f}% | {s['all'][k]['wape']:.4f}% |")
lines+=['', '**Нема активација.** Просекот од 9 точки е избран само според септември. Помага во однос на најблиската оригинална часовна точка, но во октомври е полош од v3.2. Условот за нова жива проба не е исполнет. Нема промена на формулите, радиусот или тежините по резултатот.','', 'Ова исклучува уште една едноставна причина како доволно решение за целта под 5%. Просторното измазнување само по себе не ја погодува точната временска положба на облаците. Нема доказ за 95% точност.','', 'Проверени се 588 оригинални GRIB полиња, 1.512 часовни конверзии, геометријата/тежините, оригиналните timestamps/checksums и идентичноста на двата контроли. Сите 272 часа / 72,28493 MWh се исти меѓу моделите. Резултатите се ретроспективни на веќе разгледувани датуми; bootstrap не ги прави независни.','', '[Протокол и научни извори](forecast-spatial-gfs-plan.md). [Сите часови и денови](spatial-gfs-evaluation.json). [Независна проверка](spatial-gfs-verification.json).']
pathlib.Path('docs/spatial-gfs-results.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps(verification))
