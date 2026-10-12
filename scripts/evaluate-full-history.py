"""Fixed full-history experiment. Separate retrospective archive and receipt-causal tracks."""
import datetime as dt
import hashlib
import importlib.metadata
import json
import pathlib
import platform
import time
import numpy as np
from catboost import CatBoostRegressor
from sklearn.linear_model import Ridge
from sklearn.preprocessing import PolynomialFeatures, StandardScaler

ROOT=pathlib.Path('work/forecast-research/full-history')
def read(p): return json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
def write(p,v): pathlib.Path(p).write_text(json.dumps(v,allow_nan=False,separators=(',',':')),encoding='utf-8')
def stamp(s): return dt.datetime.fromisoformat(s.replace('Z','+00:00'))
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
frozen=read('docs/full-history-frozen.json')
assert sha(ROOT/'inputs.json')==frozen['inputSha256']
for p,h in frozen['codeHashes'].items(): assert sha(p)==h,p
data=read(ROOT/'inputs.json'); AC=data['config']['acKw']; assert AC==875
METHODS=['ridge45','ridgeAll','catboost45','catboostAll']
features={h['start']:(d,h) for d in data['days'] for h in d['hours']}
revisions=sorted(enumerate(data['revisions']),key=lambda pair:(pair[1]['observedAt'],str(pair[1]['id'])))

def training(mode,day):
    # Exclude the entire unfinished local origin day, not just hours after origin.
    previous=(dt.date.fromisoformat(day['date'])-dt.timedelta(days=1)).isoformat()
    cutoff=stamp(day['originAt']); oldest=cutoff-dt.timedelta(days=45)
    if mode=='receiptCausal':
        known={}
        for i,r in revisions:
            if stamp(r['observedAt'])<cutoff and stamp(r['start'])+dt.timedelta(hours=1)<=stamp(r['observedAt']): known[r['start']]=(i,r)
    else:
        known={r['start']:(i,r) for i,r in enumerate(data['actual'])}
    all_rows=[]
    for start,(i,r) in sorted(known.items()):
        if start not in features: continue
        d,h=features[start]
        if d['date']>=previous or stamp(d['originAt'])>=cutoff or h['clearSky']<=0: continue
        y=r['productionKwh']
        if y is None or not np.isfinite(y) or y<0 or y>AC: continue
        all_rows.append({'index':i,'start':start,'date':d['date'],'values':h['values'],'value':y/AC})
    rolling=[r for r in all_rows if stamp(r['start'])>=oldest]
    return {'45':rolling,'All':all_rows}

def fit_predict(method,rows,hours):
    x=np.array([r['values'] for r in rows]); y=np.array([r['value'] for r in rows]); future=np.array([h['values'] for h in hours])
    if method.startswith('ridge'):
        poly=PolynomialFeatures(degree=2,include_bias=False)
        z=poly.fit_transform(x); scaler=StandardScaler().fit(z)
        model=Ridge(alpha=10,positive=True).fit(scaler.transform(z),y)
        raw=model.predict(scaler.transform(poly.transform(future)))*AC
    else:
        model=CatBoostRegressor(loss_function='MAE',iterations=160,depth=4,learning_rate=.05,l2_leaf_reg=10,border_count=32,random_seed=42,bootstrap_type='No',random_strength=0,thread_count=4,verbose=False,allow_writing_files=False)
        model.fit(x,y); raw=model.predict(future)*AC
    return [0.0 if h['clearSky']==0 else float(np.clip(v,0,AC)) for h,v in zip(hours,raw)]

def metric(rows,key):
    if not rows:return None
    a=np.array([r['actualKwh'] for r in rows]);p=np.array([r[key] for r in rows]);e=p-a;total=float(a.sum());absolute=float(np.abs(e).sum())
    wape=100*absolute/total if total else None
    return {'hours':len(rows),'days':len({r['date'] for r in rows}),'actualMwh':total/1000,'predictedMwh':float(p.sum()/1000),'absoluteErrorMwh':absolute/1000,'wape':wape,'displayAccuracy':max(0,100-wape) if wape is not None else None,'maeKwh':float(np.abs(e).mean()),'rmseKwh':float(np.sqrt(np.mean(e*e))),'biasMwh':float(e.sum()/1000)}

def summary(rows):return {m:metric(rows,m) for m in METHODS}
def no_confirmed_period(r):return not r['date'].startswith('2026-07') and r['date'] not in ('2026-09-11','2026-09-12')

started=time.perf_counter();tracks={}; all_runs={}
for mode in ['archiveReconstruction','receiptCausal']:
    rows=[];runs=[];unscored=[]
    for d in data['days']:
        train=training(mode,d)
        if any(len(v)<120 or len({r['date'] for r in v})<10 for v in train.values()):
            unscored.append({'date':d['date'],'reason':'insufficient earlier training','hours':{k:len(v) for k,v in train.items()}});continue
        # Inputs contain forecast features only, never target outcomes.
        future=[{'values':h['values'],'clearSky':h['clearSky']} for h in d['hours']]
        outputs={m:fit_predict(m,train['45' if m.endswith('45') else 'All'],future) for m in METHODS}
        scored=0;missing=0
        for i,h in enumerate(d['hours']):
            actual=h['actualKwh']
            if actual is None or not np.isfinite(actual) or actual<0:
                if h['clearSky']>0: missing+=1
                continue
            if h['clearSky']<=0 and actual==0:continue
            rows.append({'date':d['date'],'start':h['start'],'actualKwh':actual,'v32':h['v32'],**{m:outputs[m][i] for m in METHODS}});scored+=1
        runs.append({'date':d['date'],'originAt':d['originAt'],'trainingIndices':{k:[r['index'] for r in v] for k,v in train.items()},'trainingDays':{k:len({r['date'] for r in v}) for k,v in train.items()},'starts':[h['start'] for h in d['hours']],'outputs':outputs,'scoredHours':scored,'missingDaylightHours':missing})
        if len(runs)%10==0: print(json.dumps({'track':mode,'through':d['date'],'days':len(runs),'hours':len(rows)}),flush=True)
    monthly=[]
    for month in sorted({d['date'][:7] for d in data['days']}):
        subset=[r for r in rows if r['date'].startswith(month)]
        monthly.append({'month':month,'scores':summary(subset),'unscoredDays':len([d for d in unscored if d['date'].startswith(month)])})
    matched=[r for r in rows if r['v32'] is not None]
    tracks[mode]={'scores':summary(rows),'monthly':monthly,'withoutConfirmedPeriods':summary([r for r in rows if no_confirmed_period(r)]),'v32Matched':{m:metric(matched,m) for m in ['v32',*METHODS]},'v32MatchedOctober':{m:metric([r for r in matched if r['date'].startswith('2026-10')],m) for m in ['v32',*METHODS]},'daily':[{'date':date,'scores':summary([r for r in rows if r['date']==date])} for date in sorted({r['date'] for r in rows})],'unscored':unscored,'rows':rows}
    all_runs[mode]=runs
    print(json.dumps({'track':mode,'scores':tracks[mode]['scores'],'monthly':monthly}),flush=True)
evaluation={'version':'solar-full-history-v1','evaluatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'first':data['first'],'last':data['last'],'inputSha256':frozen['inputSha256'],'seconds':time.perf_counter()-started,'python':platform.python_version(),'packages':{p:importlib.metadata.version(p) for p in ['catboost','numpy','scikit-learn','eccodes']},'methods':METHODS,'tracks':tracks,'promotion':False,'warning':'Retrospective reconstruction, not as-issued production accuracy. Archive track assumes earlier historical measurements were available despite later imports. Receipt-causal track enforces recorded receipt times. Valid outage zeros remain in primary scores.'}
write(ROOT/'runs.json',all_runs);write('docs/full-history-evaluation.json',evaluation)
print(json.dumps({'done':True,'seconds':evaluation['seconds'],'promotion':False}),flush=True)
