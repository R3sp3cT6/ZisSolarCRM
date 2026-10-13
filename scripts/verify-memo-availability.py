"""Independent receipt selection, fixed rule and monthly metric verification."""
import json,datetime as dt,hashlib,math
from pathlib import Path
def read(p): return json.loads(Path(p).read_text(encoding='utf-8'))
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def stamp(v): return dt.datetime.fromisoformat(v.replace('Z','+00:00'))
root='work/forecast-research/memo-availability/'
prices=read(root+'prices.json'); old=read('docs/full-history-evaluation.json'); result=read('docs/memo-availability-evaluation.json')
for path,h in result['frozen']['hashes'].items(): assert sha(path)==h,path
index={}
for p in prices['records']: index.setdefault(p['start'],[]).append(p)
def decision(start,origin):
    candidates=[p for p in index.get(start,[]) if stamp(p['fetched_at'])<=stamp(origin)]
    if not candidates: return 'unknown',None,None
    latest=max(stamp(p['fetched_at']) for p in candidates)
    values={p['eur_cents'] for p in candidates if stamp(p['fetched_at'])==latest}
    if len(values)!=1: return 'unknown',None,None
    value=next(iter(values)); return 'negative' if value<0 else 'nonnegative',value/100,latest
def verify_score(rows,key,expected):
    if not rows: assert expected is None; return
    a=sum(r['actualKwh'] for r in rows); p=sum(r[key] for r in rows); e=sum(abs(r[key]-r['actualKwh']) for r in rows)
    values={'hours':len(rows),'days':len({r['date'] for r in rows}),'actualMwh':a/1000,'predictedMwh':p/1000,
      'absoluteErrorMwh':e/1000,'wape':100*e/a if a else None,'maeKwh':e/len(rows),
      'rmseKwh':math.sqrt(sum((r[key]-r['actualKwh'])**2 for r in rows)/len(rows)),'biasMwh':(p-a)/1000}
    for k,v in values.items():
        if v is None: assert expected[k] is None
        else: assert math.isclose(v,expected[k],abs_tol=1e-8,rel_tol=1e-10),(key,k,v,expected[k])
checked=0
for mode,track in result['tracks'].items():
    assert len(track['rows'])==len(old['tracks'][mode]['rows'])
    for r,o in zip(track['rows'],old['tracks'][mode]['rows']):
        assert r['start']==o['start'] and r['actualKwh']==o['actualKwh'] and r['control']==o['catboostAll'] and r['v32']==o['v32']
        for kind,suffix,origin in [('reconstructed','Reconstructed',prices['exportedAt']),('causal','Causal',r['originAt'])]:
            state,value,received=decision(r['start'],origin)
            assert r[kind]['state']==state and r[kind]['memoEurMwh']==value
            assert (stamp(r[kind]['receivedAt']) if r[kind]['receivedAt'] else None)==received
            assert r['policy'+suffix]==(0 if state=='negative' else r['control'])
            assert r['v32'+suffix]==(None if r['v32'] is None else 0 if state=='negative' else r['v32'])
        checked+=1
    for key,expected in track['scores'].items(): verify_score(track['rows'],key,expected)
    for month in track['monthly']:
        rows=[r for r in track['rows'] if r['date'].startswith(month['month'])]
        for key,expected in month['scores'].items(): verify_score(rows,key,expected)
        for k,c in month['coverage'].items():
            neg=[r for r in rows if r[k]['state']=='negative']
            assert c['knownPriceHours']==sum(r[k]['state']!='unknown' for r in rows)
            assert c['negativeHours']==len(neg)
            assert c['changedHours']==sum(r['control']!=0 for r in neg)
            assert c['positiveActualHoursOnNegative']==sum(r['actualKwh']>0 for r in neg)
            assert math.isclose(c['actualMwhOnNegative'],sum(r['actualKwh'] for r in neg)/1000,abs_tol=1e-9)
    matched=[r for r in track['rows'] if r['date'].startswith('2026-10') and r['v32'] is not None]
    for key,expected in track['matchedOctober'].items(): verify_score(matched,key,expected)
report={'status':'passed','checkedRows':checked,'evaluationSha256':sha('docs/memo-availability-evaluation.json'),'checkedAt':dt.datetime.now(dt.timezone.utc).isoformat()}
Path('docs/memo-availability-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report))
