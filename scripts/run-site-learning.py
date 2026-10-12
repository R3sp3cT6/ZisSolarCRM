"""Frozen causal plant-response experiment. Fit never receives target outcomes."""
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
from sklearn.neighbors import KNeighborsRegressor
from sklearn.preprocessing import PolynomialFeatures, StandardScaler

ROOT = pathlib.Path('work/forecast-research/site-learning')
def read(path): return json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
def write(path, value): pathlib.Path(path).write_text(json.dumps(value, allow_nan=False, separators=(',', ':')), encoding='utf-8')
def sha(path): return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def stamp(value): return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
frozen = read('docs/site-learning-frozen.json')
assert sha(ROOT / 'inputs.json') == frozen['inputSha256']
for name, digest in frozen['hashes'].items(): assert sha(name) == digest, name
data = read(ROOT / 'inputs.json')
AC = data['config']['acKw']
METHODS = ['catboost', 'ridge', 'analog']
revisions = sorted(data['revisions'], key=lambda r: (r['observedAt'], str(r['id'])))
weather = {h['start']: (d, h) for d in data['days'] for h in d['hours']}

def training(origin):
    cutoff = stamp(origin); oldest = cutoff - dt.timedelta(days=45)
    known = {}
    for r in revisions:
        if stamp(r['observedAt']) < cutoff and stamp(r['start']) + dt.timedelta(hours=1) <= stamp(r['observedAt']): known[r['start']] = r
    rows = []
    for start, r in sorted(known.items()):
        if start not in weather or not oldest <= stamp(start) < cutoff: continue
        d, h = weather[start]
        if stamp(d['originAt']) >= cutoff or h['clearSky'] <= 0: continue
        y = r['productionKwh']
        if y is None or not np.isfinite(y) or y < 0 or y > AC: continue
        rows.append({'start': start, 'date': d['date'], 'values': h['values'], 'value': y / AC, 'revisionId': r['id'], 'observedAt': r['observedAt'], 'weatherOriginAt': d['originAt']})
    assert len(rows) >= 120 and len(set(r['date'] for r in rows)) >= 10, (origin, len(rows))
    return rows

def fit(method, rows):
    x, y = np.array([r['values'] for r in rows]), np.array([r['value'] for r in rows])
    if method == 'catboost':
        model = CatBoostRegressor(loss_function='MAE', iterations=160, depth=4, learning_rate=.05, l2_leaf_reg=10, border_count=32, random_seed=42, bootstrap_type='No', random_strength=0, thread_count=4, verbose=False, allow_writing_files=False)
        model.fit(x, y)
        return model, None, None
    poly = PolynomialFeatures(degree=2, include_bias=False) if method == 'ridge' else None
    z = poly.fit_transform(x) if poly else x
    scaler = StandardScaler().fit(z)
    model = Ridge(alpha=10, positive=True) if method == 'ridge' else KNeighborsRegressor(n_neighbors=20, weights='distance', n_jobs=1)
    model.fit(scaler.transform(z), y)
    return model, scaler, poly

def predict(fitted, hours):
    model, scaler, poly = fitted
    x = np.array([h['values'] for h in hours])
    if poly: x = poly.transform(x)
    if scaler: x = scaler.transform(x)
    raw = model.predict(x) * AC
    return [{'start': h['start'], 'rawKwh': float(v), 'kwh': 0 if h['clearSky'] == 0 else float(np.clip(v, 0, AC))} for h, v in zip(hours, raw)]

def metrics(rows, key):
    assert rows
    a = np.array([r['actualKwh'] for r in rows]); p = np.array([r[key] for r in rows]); e = p - a
    return {'hours': len(rows), 'days': len(set(r['date'] for r in rows)), 'actualMwh': float(a.sum()/1000), 'predictedMwh': float(p.sum()/1000), 'wape': float(100*np.abs(e).sum()/a.sum()), 'maeKwh': float(np.abs(e).mean()), 'rmseKwh': float(np.sqrt((e*e).mean())), 'biasMwh': float(e.sum()/1000), 'biasPercent': float(100*e.sum()/a.sum())}

started = time.perf_counter(); runs = []; rows = []; selected = None
for d in data['days']:
    if d['date'] < '2026-09-21': continue
    # Selection is durably frozen before any October model is scored.
    if d['date'] == '2026-10-01':
        scores = {m: metrics(rows, m) for m in METHODS}
        selected = min(METHODS, key=lambda m: scores[m]['wape'])
        write(ROOT / 'selection.json', {'selected': selected, 'selectedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'period': ['2026-09-21', '2026-09-30'], 'scores': scores, 'frozenInput': frozen['inputSha256'], 'warning': 'Exploratory retrospective selection; dates were previously inspected in other experiments.'})
        print(json.dumps({'selected': selected, 'selectionScores': scores}), flush=True)
    train = training(d['originAt'])
    outputs = {m: predict(fit(m, train), d['hours']) for m in METHODS}
    run = {'date': d['date'], 'originAt': d['originAt'], 'training': train, 'outputs': outputs}
    runs.append(run)
    for i, h in enumerate(d['hours']):
        if h['clearSky'] <= 0 and (h['actualKwh'] or 0) <= 0: continue
        assert h['actualKwh'] is not None and h['baselineKwh'] is not None and h['nativePhysicsKwh'] is not None, h['start']
        rows.append({'date': d['date'], 'start': h['start'], 'actualKwh': h['actualKwh'], 'v32': h['baselineKwh'], 'nativePhysics': h['nativePhysicsKwh'], **{m: outputs[m][i]['kwh'] for m in METHODS}})
    print(json.dumps({'date': d['date'], 'trainingHours': len(train), 'trainingDays': len(set(r['date'] for r in train))}), flush=True)

keys = ['v32', 'nativePhysics', *METHODS]
evaluation = {'version': 'solar-site-learning-v1', 'evaluatedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'selected': selected, 'selection': read(ROOT / 'selection.json'), 'seconds': time.perf_counter()-started, 'python': platform.python_version(), 'packages': {p: importlib.metadata.version(p) for p in ['catboost','numpy','scikit-learn','eccodes']}, 'inputSha256': frozen['inputSha256'], 'scores': {label: {m: metrics(subset,m) for m in keys} for label, subset in [('all', rows), ('selection', [r for r in rows if r['date']<'2026-10-01']), ('october', [r for r in rows if r['date']>='2026-10-01'])]}, 'daily': [{'date': date, 'scores': {m:metrics([r for r in rows if r['date']==date],m) for m in keys}} for date in sorted(set(r['date'] for r in rows))], 'rows': rows}
write(ROOT / 'runs.json', runs)
write('docs/site-learning-evaluation.json', evaluation)

# One final, frozen challenger trained only on known, completed intervals.
origin = dt.datetime.now(dt.timezone.utc).isoformat(); train = training(origin)
model, scaler, poly = fit(selected, train)
if selected == 'catboost':
    model.save_model(str(ROOT / 'catboost.json'), format='json')
    raw = read(ROOT / 'catboost.json')
    for tree in raw['oblivious_trees']: assert all(s['split_type'] == 'FloatFeature' for s in tree['splits'])
    portable = {'scale': raw['scale_and_bias'][0], 'bias': raw['scale_and_bias'][1][0], 'trees': [{'splits':[{'feature':s['float_feature_index'],'border':s['border']} for s in t['splits']], 'leaves':t['leaf_values']} for t in raw['oblivious_trees']]}
elif selected == 'ridge':
    portable = {'means':scaler.mean_.tolist(),'scales':scaler.scale_.tolist(),'powers':poly.powers_.tolist(),'coefficients':model.coef_.tolist(),'intercept':float(model.intercept_)}
else:
    portable = {'means':scaler.mean_.tolist(),'scales':scaler.scale_.tolist(),'x':model._fit_X.tolist(),'y':model._y.tolist(),'neighbors':20}
artifact = {'version':'solar-site-learning-v1','method':selected,'trainedAt':origin,'trainingEnd':max(r['start'] for r in train),'validUntil':(stamp(origin)+dt.timedelta(days=7)).isoformat(),'latitude':data['config']['latitude'],'longitude':data['config']['longitude'],'acKw':AC,'features':data['featureNames'],'trainingHours':len(train),'trainingDays':len(set(r['date'] for r in train)),'model':portable}
write(ROOT / 'model.json', artifact)
test_hours = [h for d in data['days'] if d['date']>='2026-09-21' for h in d['hours']]
write(ROOT / 'portable-fixtures.json', [{'values':h['values'],'clearSky':h['clearSky'], **p} for h,p in zip(test_hours,predict((model,scaler,poly),test_hours))])
write(ROOT / 'final-training.json',train)
print(json.dumps({'selected':selected,'scores':evaluation['scores'],'modelBytes':(ROOT/'model.json').stat().st_size}), flush=True)
