"""Independent Python verification of the TypeScript MOS replay; no model tuning."""
import datetime as dt
import hashlib
import json
import math
import pathlib
import numpy as np

ROOT = pathlib.Path('work/forecast-research/local-mos')
def read(p): return json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def stamp(s): return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
def day(s): return stamp(s).astimezone(dt.timezone(dt.timedelta(hours=2))).date()
# This replay is September/early October, entirely UTC+2 in Resen. Runtime uses IANA time.
data=read(ROOT/'inputs.json'); runs=read(ROOT/'runs.json'); report=read('docs/local-mos-evaluation.json'); frozen=read('docs/local-mos-frozen.json')
assert sha(ROOT/'inputs.json') == frozen['inputSha256'] == report['inputSha256']
for p,h in frozen['codeHashes'].items(): assert sha(p)==h, p
assert frozen['preScoreCodeHashes']['lib/forecast-local-mos.ts']==frozen['codeHashes']['lib/forecast-local-mos.ts']
assert frozen['preScoreCodeHashes']['docs/forecast-local-mos-plan.md']==frozen['codeHashes']['docs/forecast-local-mos-plan.md']
assert stamp(frozen['frozenAt']) < stamp(report['evaluatedAt'])
revisions=sorted(data['revisions'],key=lambda r:(stamp(r['observedAt']),str(r['id'])))
by_start={h['start']:h for d in data['days'] for h in d['hours']}
verified=0; max_error=0
for run in runs:
    origin=stamp(run['originAt']); latest={}
    for r in revisions:
        if stamp(r['observedAt'])<origin and stamp(r['start'])+dt.timedelta(hours=1)<=stamp(r['observedAt']): latest[r['start']]=r
    for p in run['train']:
        r=latest[p['start']]
        assert r['id']==p['revisionId'] and r['productionKwh']==p['actualKwh']
        assert day(p['start'])<day(run['originAt']) and 0<(origin-stamp(p['start'])).total_seconds()/86400<=30
        assert stamp(p['originAt'])<stamp(p['start'])<stamp(p['observedAt'])<origin
        source=by_start[p['start']]
        assert all(p[k]==source[k] for k in ['baseKwh','csi','solarHour','clearSky'])
        verified+=1
    assert len({p['start'] for p in run['train']})==len(run['train'])
    for out in run['output']:
        target=by_start[out['start']]; factor=1
        if target['baseKwh']>=5 and target['clearSky']>=50:
            weighted=[];days={}
            for p in run['train']:
                age=(origin-stamp(p['start'])).total_seconds()/86400
                w=p['baseKwh']*math.exp(-.5*(((p['solarHour']-target['solarHour'])/2)**2+((p['csi']-target['csi'])/.25)**2))*2**(-age/14)
                weighted.append((p['actualKwh']/p['baseKwh'],w)); key=day(p['start']);days[key]=days.get(key,0)+w
            total=sum(w for _,w in weighted)
            eh=total**2/sum(w*w for _,w in weighted) if total else 0
            ed=total**2/sum(w*w for w in days.values()) if total else 0
            if len(days)>=7 and eh>=20 and ed>=5:
                weighted.append((1,total/3));acc=0
                for ratio,w in sorted(weighted):
                    acc+=w
                    if acc>=total*2/3:
                        factor=max(.85,min(1.15,ratio));break
        expected=min(data['config']['acKw'],target['baseKwh']*factor)
        max_error=max(max_error,abs(expected-out['productionKwh']))
        assert abs(factor-out['factor'])<1e-10 and abs(expected-out['productionKwh'])<1e-8
assert max_error<1e-8
# Compare v3.2 to independently preserved experiment values; no relabelled benchmark.
old={r['start']:r['v32'] for r in read('docs/site-learning-evaluation.json')['rows']}
old.update({r['start']:r['v32'] for r in read('work/forecast-research/response-development.json')['rows']})
for r in report['rows']: assert abs(r['v32']-old[r['start']])<1e-8
bootstrap={}
for period in ['all','september','october']:
    rows=[r for r in report['rows'] if period=='all' or (r['date']<'2026-10-01')==(period=='september')]
    actual=np.array([r['actualKwh'] for r in rows]);
    for model in ['v32','mos']:
        error=np.array([r[model] for r in rows])-actual; score=report['scores'][period][model]
        assert abs(score['wape']-100*np.abs(error).sum()/actual.sum())<1e-8
        assert abs(score['rmseKwh']-np.sqrt((error*error).mean()))<1e-8
    days=[d for d in report['daily'] if period=='all' or (d['date']<'2026-10-01')==(period=='september')]
    rng=np.random.default_rng(42); differences=[]
    for _ in range(5000):
        sample=[days[i] for i in rng.integers(0,len(days),len(days))]
        differences.append(sum((d['mos']['wape']-d['v32']['wape'])*d['v32']['actualMwh'] for d in sample)/sum(d['v32']['actualMwh'] for d in sample))
    bootstrap[period]={'pairedDayDeltaPp95':np.percentile(differences,[2.5,97.5]).tolist(),'wins':sum(d['mos']['wape']<d['v32']['wape']-1e-9 for d in days),'losses':sum(d['mos']['wape']>d['v32']['wape']+1e-9 for d in days),'days':len(days)}
result={'status':'passed','verifiedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'origins':len(runs),'trainingRevisionChecks':verified,'predictionChecks':sum(len(r['output']) for r in runs),'maxIndependentErrorKwh':max_error,'evaluationSha256':sha('docs/local-mos-evaluation.json'),'inputsSha256':sha(ROOT/'inputs.json'),'runsSha256':sha(ROOT/'runs.json'),'bootstrap':bootstrap,'note':'Exploratory reused historical dates; bootstrap does not remove development/selection bias. No prospective promotion.'}
pathlib.Path('docs/local-mos-verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
