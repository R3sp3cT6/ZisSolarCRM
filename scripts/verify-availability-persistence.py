"""Independent implementation of the frozen rule, receipt selection and WAPE."""
import datetime as dt
import hashlib
import json
import math
import pathlib

def read(p): return json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def stamp(v): return dt.datetime.fromisoformat(v.replace('Z','+00:00'))

data=read('work/forecast-research/full-history/inputs.json')
old=read('docs/full-history-evaluation.json')
result=read('docs/availability-persistence-evaluation.json')
frozen=read('docs/availability-persistence-frozen.json')
assert sha('work/forecast-research/full-history/inputs.json')==frozen['inputSha256']
assert sha('docs/full-history-evaluation.json')==frozen['evaluationSha256']
assert sha('work/forecast-research/full-history/runs.json')==frozen['runSha256']
for p,h in frozen['codeHashes'].items(): assert sha(p)==h,p
days={d['date']:d for d in data['days']}
checked=0
for mode,track in result['tracks'].items():
    triggers=set()
    for decision in track['decisions']:
        cutoff=stamp(decision['originAt'])
        if mode=='archiveReconstruction':
            known={r['start']:(i,r) for i,r in enumerate(data['actual'])}
        else:
            known={}
            for i,r in sorted(enumerate(data['revisions']),key=lambda pair:(stamp(pair[1]['observedAt']),str(pair[1]['id']))):
                if stamp(r['start'])+dt.timedelta(hours=1)<=stamp(r['observedAt'])<cutoff: known[r['start']]=(i,r)
        date=dt.date.fromisoformat(decision['date'])
        flags=[]
        for offset,evidence in zip((3,2),decision['evidence']):
            previous=(date-dt.timedelta(days=offset)).isoformat()
            assert previous==evidence['date']
            if previous not in days:
                assert evidence['status']=='missing-weather-day'; flags.append(False); continue
            source=[h for h in days[previous]['hours'] if h['clearSky']>0]
            assert [h['start'] for h in source]==[h['start'] for h in evidence['hours']]
            measured=[]
            for h,e in zip(source,evidence['hours']):
                row=known.get(h['start'])
                actual=row[1]['productionKwh'] if row else None
                assert e['productionKwh']==actual
                assert e['index']==(row[0] if row else None)
                assert e['observedAt']==(row[1].get('observedAt') if row else None)
                assert e['irradiance']==h['irradiance']
                assert stamp(h['start'])+dt.timedelta(hours=1)<cutoff
                measured.append(actual); checked+=1
            valid=bool(source) and all(y is not None and math.isfinite(y) and 0<=y<=data['config']['acKw'] for y in measured)
            strong=sum(h['irradiance']>=300 for h in source)
            flag=valid and strong>=3 and max(measured)<=.01*data['config']['acKw']
            flags.append(flag)
            assert (evidence['status']=='near-zero')==flag
        trigger=all(flags)
        assert trigger==decision['trigger']
        if trigger: triggers.add(decision['date'])
    assert len(track['rows'])==len(old['tracks'][mode]['rows'])
    for r,original in zip(track['rows'],old['tracks'][mode]['rows']):
        assert (r['start'],r['actualKwh'],r['control'])==(original['start'],original['actualKwh'],original['catboostAll'])
        assert r['persistence']==(0 if r['date'] in triggers else r['control'])
    def check(rows,scores):
        for method,s in scores.items():
            if not rows: assert s is None; continue
            a=sum(r['actualKwh'] for r in rows)
            p=sum(r[method] for r in rows)
            absolute=sum(abs(r[method]-r['actualKwh']) for r in rows)
            assert s['hours']==len(rows)
            assert s['days']==len({r['date'] for r in rows})
            expected={'actualMwh':a/1000,'predictedMwh':p/1000,'absoluteErrorMwh':absolute/1000,'wape':100*absolute/a if a else None,'maeKwh':absolute/len(rows),'rmseKwh':math.sqrt(sum((r[method]-r['actualKwh'])**2 for r in rows)/len(rows)),'biasMwh':(p-a)/1000}
            for k,v in expected.items():
                if v is None: assert s[k] is None
                else: assert abs(s[k]-v)<1e-8,(k,s[k],v)
    check(track['rows'],track['scores'])
    for m in track['monthly']: check([r for r in track['rows'] if r['date'].startswith(m['month'])],m['scores'])
    for t in track['triggered']: check([r for r in track['rows'] if r['date']==t['date']],{k:t[k] for k in ['control','persistence']})
    check([r for r in track['rows'] if r['date'].startswith('2026-10') and r['v32'] is not None],track['v32MatchedOctober'])

proof={'status':'passed','verifiedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'measurementChecks':checked,'tracks':len(result['tracks']),'predictionChecks':sum(len(t['rows']) for t in result['tracks'].values()),'evaluationSha256':sha('docs/availability-persistence-evaluation.json'),'verifierSha256':sha('scripts/verify-availability-persistence.py'),'note':'Independent rule, completed-hour/receipt selection, exact unchanged targets/control, all monthly metrics; no new holdout or model promotion.'}
pathlib.Path('docs/availability-persistence-verification.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
print(json.dumps(proof))
