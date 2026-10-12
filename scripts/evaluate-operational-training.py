"""Fixed training-only operational ablation. Never filter primary outcomes."""
import ast
import datetime as dt
import hashlib
import json
import pathlib
import time
import numpy as np
from catboost import CatBoostRegressor

ROOT = pathlib.Path('work/forecast-research/operational-training')
METHODS = ['control', 'deviceFiltered', 'broadConfirmationSensitivity']

def read(path):
    return json.loads(pathlib.Path(path).read_text(encoding='utf-8'))

def write(path, value):
    pathlib.Path(path).write_text(json.dumps(value, allow_nan=False, separators=(',', ':')), encoding='utf-8')

def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()

def stamp(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))

def flagged(sample):
    p = sample['powerKw']
    if p is None or not np.isfinite(p) or p < 0:
        return False
    return sample['stateCode'] in (513, 514) or (sample['stateCode'] in range(768, 774) and p == 0)

def device_mask(samples):
    """Earliest two-sample witness receipt; duplicates/gaps cannot create evidence."""
    grouped = {}
    seen = set()
    for i, sample in enumerate(samples):
        t = stamp(sample['measuredAt'])
        key = (sample['deviceId'], t)
        assert key not in seen, 'Ambiguous duplicate in normalized inverter evidence'
        seen.add(key)
        assert t.second == 0 and t.microsecond == 0 and t.minute % 5 == 0
        assert stamp(sample['receivedAt']) >= t
        hour = t.replace(minute=0, second=0, microsecond=0).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        grouped.setdefault((hour, sample['deviceId']), []).append((i, sample))
    result = {}
    for (hour, _), points in grouped.items():
        ordered = sorted(points, key=lambda p: p[1]['measuredAt'])
        for (i, a), (j, b) in zip(ordered, ordered[1:]):
            if stamp(b['measuredAt']) - stamp(a['measuredAt']) != dt.timedelta(minutes=5):
                continue
            if not flagged(a) or not flagged(b):
                continue
            receipt = max(a['receivedAt'], b['receivedAt'])
            candidate = {'witnessIndices': [i, j], 'availableAt': receipt}
            if hour not in result or stamp(receipt) < stamp(result[hour]['availableAt']):
                result[hour] = candidate
    return dict(sorted(result.items()))

def filter_training(rows, method, mode, cutoff, mask, confirmation_at):
    removed = []
    kept = []
    for row in rows:
        exclude = False
        if method == 'deviceFiltered' and row['start'] in mask:
            evidence = mask[row['start']]
            exclude = mode == 'archiveReconstruction' or stamp(evidence['availableAt']) < stamp(cutoff)
        elif method == 'broadConfirmationSensitivity':
            confirmed = row['date'].startswith('2026-07') or row['date'] in ('2026-09-11', '2026-09-12')
            exclude = confirmed and (mode == 'archiveReconstruction' or stamp(confirmation_at) < stamp(cutoff))
        (removed if exclude else kept).append(row)
    return kept, removed

def fit(rows, hours, ac):
    x = np.array([r['values'] for r in rows])
    y = np.array([r['value'] for r in rows])
    model = CatBoostRegressor(loss_function='MAE', iterations=160, depth=4, learning_rate=.05,
        l2_leaf_reg=10, border_count=32, random_seed=42, bootstrap_type='No', random_strength=0,
        thread_count=4, verbose=False, allow_writing_files=False)
    model.fit(x, y)
    raw = model.predict(np.array([h['values'] for h in hours])) * ac
    return [0.0 if h['clearSky'] == 0 else float(np.clip(v, 0, ac)) for h, v in zip(hours, raw)]

def run():
    frozen = read('docs/operational-training-frozen.json')
    for path, digest in frozen['hashes'].items():
        assert sha(path) == digest, path
    data = read('work/forecast-research/full-history/inputs.json')
    device_data = read('work/forecast-research/inverter-evidence/inputs.json')
    previous_runs = read('work/forecast-research/full-history/runs.json')
    previous_scores = read('docs/full-history-evaluation.json')
    # Use the exact already-frozen selector and metric, without executing its experiment.
    old_source = read('work/forecast-research/full-history/frozen-source.json')['scripts/evaluate-full-history.py']
    functions = ast.Module(body=[n for n in ast.parse(old_source).body if isinstance(n, ast.FunctionDef) and n.name in ('stamp', 'training', 'metric')], type_ignores=[])
    scope = {'dt': dt, 'np': np, 'data': data, 'AC': data['config']['acKw'],
        'features': {h['start']: (d, h) for d in data['days'] for h in d['hours']},
        'revisions': sorted(enumerate(data['revisions']), key=lambda pair: (pair[1]['observedAt'], str(pair[1]['id'])))}
    exec(compile(functions, '<frozen-full-history-selector>', 'exec'), scope)
    metric = scope['metric']
    mask = device_mask(device_data['samples'])
    confirmation_at = frozen['frozenAt']  # Conservative capture timestamp, not a claimed original receipt.
    write(ROOT / 'mask.json', mask)
    started = time.perf_counter()
    tracks, runs = {}, {}
    for mode in ('archiveReconstruction', 'receiptCausal'):
        rows, fold_runs = [], []
        old_by_date = {r['date']: r for r in previous_runs[mode]}
        for day in data['days']:
            if day['date'] not in old_by_date:
                continue
            original = scope['training'](mode, day)['All']
            old = old_by_date[day['date']]
            assert [r['index'] for r in original] == old['trainingIndices']['All']
            sets = {m: filter_training(original, m, mode, day['originAt'], mask, confirmation_at) for m in METHODS}
            assert all(len(kept) >= 120 and len({r['date'] for r in kept}) >= 10 for kept, _ in sets.values())
            future = [{'values': h['values'], 'clearSky': h['clearSky']} for h in day['hours']]
            outputs, trained = {}, {}
            for method, (kept, _) in sets.items():
                key = tuple(r['index'] for r in kept)
                if key not in trained:
                    trained[key] = fit(kept, future, scope['AC'])
                outputs[method] = trained[key]
            assert np.allclose(outputs['control'], old['outputs']['catboostAll'], rtol=0, atol=1e-9), day['date']
            if mode == 'receiptCausal':
                assert all(not removed for _, removed in sets.values())
                assert all(outputs[m] == outputs['control'] for m in METHODS)
            for i, hour in enumerate(day['hours']):
                actual = hour['actualKwh']
                if actual is None or not np.isfinite(actual) or actual < 0 or (hour['clearSky'] <= 0 and actual == 0):
                    continue
                rows.append({'date': day['date'], 'start': hour['start'], 'actualKwh': actual,
                    'v32': hour['v32'], **{m: outputs[m][i] for m in METHODS}})
            fold_runs.append({'date': day['date'], 'originAt': day['originAt'],
                'trainingIndices': {m: [r['index'] for r in kept] for m, (kept, _) in sets.items()},
                'removedIndices': {m: [r['index'] for r in removed] for m, (_, removed) in sets.items()},
                'starts': [h['start'] for h in day['hours']], 'outputs': outputs})
            if len(fold_runs) % 20 == 0:
                print(json.dumps({'track': mode, 'through': day['date'], 'runs': len(fold_runs)}), flush=True)
        # No different masks, score exclusions or independent reranking of days.
        old_rows = previous_scores['tracks'][mode]['rows']
        assert [(r['start'], r['actualKwh']) for r in rows] == [(r['start'], r['actualKwh']) for r in old_rows]
        score = lambda subset: {m: metric(subset, m) for m in METHODS}
        matched = [r for r in rows if r['v32'] is not None]
        tracks[mode] = {'scores': score(rows), 'monthly': [
            {'month': month, 'scores': score([r for r in rows if r['date'].startswith(month)])}
            for month in sorted({d['date'][:7] for d in data['days']})],
            'v32MatchedOctober': {m: metric([r for r in matched if r['date'].startswith('2026-10')], m) for m in ['v32', *METHODS]},
            'rows': rows}
        runs[mode] = fold_runs
        print(json.dumps({'track': mode, 'scores': tracks[mode]['scores']}), flush=True)
    result = {'version': 'solar-operational-training-v1', 'evaluatedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'seconds': time.perf_counter() - started, 'methods': METHODS, 'first': data['first'], 'last': data['last'],
        'flaggedHours': len(mask), 'tracks': tracks, 'promotion': False,
        'warning': 'Archive reconstruction assumes earlier availability of later-retrieved status evidence. Strict receipt-causal variants are identical. All outage outcomes retained; no whole-July state inferred.'}
    write(ROOT / 'runs.json', runs)
    write('docs/operational-training-evaluation.json', result)
    print(json.dumps({'finished': True, 'seconds': result['seconds'], 'flaggedHours': len(mask)}), flush=True)

if __name__ == '__main__':
    run()
