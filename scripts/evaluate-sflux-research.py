"""Fixed weather-input ablation; same model, fit cohorts, outcomes and origins."""
import ast
import datetime as dt
import hashlib
import importlib.metadata
import json
import pathlib
import time
import numpy as np
from catboost import CatBoostRegressor

ROOT = pathlib.Path('work/forecast-research/sflux')
METHODS = ['coarseGhi', 'nativeGhi', 'nativePartitionTemperature']

def read(path):
    return json.loads(pathlib.Path(path).read_text(encoding='utf-8'))

def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()

def write(path, value):
    pathlib.Path(path).write_text(json.dumps(value, allow_nan=False, separators=(',', ':')), encoding='utf-8')

def fit(rows, hours, ac):
    model = CatBoostRegressor(loss_function='MAE', iterations=160, depth=4, learning_rate=.05,
        l2_leaf_reg=10, border_count=32, random_seed=42, bootstrap_type='No', random_strength=0,
        thread_count=4, verbose=False, allow_writing_files=False)
    model.fit(np.array([r['values'] for r in rows]), np.array([r['value'] for r in rows]))
    raw = model.predict(np.array([h['values'] for h in hours])) * ac
    return [0.0 if h['clearSky'] == 0 else float(np.clip(v, 0, ac)) for h, v in zip(hours, raw)]

def run():
    frozen = read('docs/sflux-research-frozen.json')
    assert sha(ROOT / 'inputs.json') == frozen['inputSha256']
    for path, digest in frozen['codeHashes'].items():
        assert sha(path) == digest, path
    inputs = read(ROOT / 'inputs.json')
    data = inputs['data']
    assert sha('work/forecast-research/full-history/runs.json') == inputs['originalRunsSha256']
    assert sha('docs/full-history-evaluation.json') == inputs['originalEvaluationSha256']
    old_runs = read('work/forecast-research/full-history/runs.json')
    old_scores = read('docs/full-history-evaluation.json')
    original_code = read('work/forecast-research/full-history/frozen-source.json')['scripts/evaluate-full-history.py']
    nodes = ast.Module(body=[n for n in ast.parse(original_code).body if isinstance(n, ast.FunctionDef) and n.name in ('stamp', 'training', 'metric')], type_ignores=[])
    scope = {'dt': dt, 'np': np, 'data': data, 'AC': data['config']['acKw'],
        'features': {h['start']: (d, h) for d in data['days'] for h in d['hours']},
        'revisions': sorted(enumerate(data['revisions']), key=lambda pair: (pair[1]['observedAt'], str(pair[1]['id'])))}
    exec(compile(nodes, '<original-full-history-selector>', 'exec'), scope)
    prepared = {h['start']: h for d in inputs['days'] for h in d['hours']}
    metric = scope['metric']
    started = time.perf_counter()
    tracks, runs = {}, {}
    for mode in ('archiveReconstruction', 'receiptCausal'):
        rows, folds = [], []
        old_by_date = {r['date']: r for r in old_runs[mode]}
        for day in data['days']:
            if day['date'] not in old_by_date:
                continue
            original = scope['training'](mode, day)['All']
            old = old_by_date[day['date']]
            assert [r['index'] for r in original] == old['trainingIndices']['All']
            outputs = {}
            for method in METHODS:
                training = [dict(r, values=prepared[r['start']][method]) for r in original]
                future = [{'values': prepared[h['start']][method], 'clearSky': h['clearSky']} for h in day['hours']]
                outputs[method] = fit(training, future, scope['AC'])
            assert np.allclose(outputs['coarseGhi'], old['outputs']['catboostAll'], rtol=0, atol=1e-9), day['date']
            folds.append({'date': day['date'], 'originAt': day['originAt'],
                'trainingIndices': [r['index'] for r in original], 'starts': [h['start'] for h in day['hours']], 'outputs': outputs})
            for i, h in enumerate(day['hours']):
                actual = h['actualKwh']
                if actual is None or not np.isfinite(actual) or actual < 0 or (h['clearSky'] <= 0 and actual == 0):
                    continue
                rows.append({'date': day['date'], 'start': h['start'], 'actualKwh': actual,
                    'v32': h['v32'], **{m: outputs[m][i] for m in METHODS}})
            if len(folds) % 20 == 0:
                print(json.dumps({'track': mode, 'through': day['date'], 'folds': len(folds)}), flush=True)
        assert [(r['start'], r['actualKwh']) for r in rows] == [(r['start'], r['actualKwh']) for r in old_scores['tracks'][mode]['rows']]
        score = lambda subset: {m: metric(subset, m) for m in METHODS}
        matched = [r for r in rows if r['v32'] is not None]
        tracks[mode] = {'scores': score(rows), 'monthly': [
            {'month': month, 'scores': score([r for r in rows if r['date'].startswith(month)])}
            for month in sorted({d['date'][:7] for d in data['days']})],
            'v32MatchedOctober': {m: metric([r for r in matched if r['date'].startswith('2026-10')], m) for m in ['v32', *METHODS]},
            'daily': [{'date': d, 'scores': score([r for r in rows if r['date'] == d])} for d in sorted({r['date'] for r in rows})],
            'rows': rows}
        runs[mode] = folds
        print(json.dumps({'track': mode, 'scores': tracks[mode]['scores']}), flush=True)
    output = {'version': inputs['version'], 'evaluatedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'seconds': time.perf_counter() - started, 'first': data['first'], 'last': data['last'], 'methods': METHODS,
        'inputSha256': frozen['inputSha256'], 'packages': {p: importlib.metadata.version(p) for p in ['catboost', 'numpy', 'eccodes']},
        'tracks': tracks, 'promotion': False,
        'warning': 'Retrospective replay with original pre-origin weather, not as-issued CRM accuracy. All valid outage outcomes retained. No new panel geometry or installed DC capacity assumed.'}
    write(ROOT / 'runs.json', runs)
    write('docs/sflux-research-evaluation.json', output)
    print(json.dumps({'finished': True, 'seconds': output['seconds'], 'promotion': False}), flush=True)

if __name__ == '__main__':
    run()
