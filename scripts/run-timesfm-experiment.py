"""Fixed local experiment. Reads causal inputs only; never reads targets."""
import dataclasses
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import time

import numpy as np
import torch
import timesfm
from huggingface_hub import hf_hub_download

ROOT = Path('work/forecast-research/timesfm')
def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

frozen = json.loads(Path('docs/timesfm-frozen.json').read_text())
assert sha(ROOT / 'inputs.json') == frozen['inputSha256']
for name, digest in frozen['codeHashes'].items():
    assert sha(name) == digest, f'Code changed after freeze: {name}'
assert sha('docs/timesfm-experiment-plan.md') == frozen['protocolSha256']
data = json.loads((ROOT / 'inputs.json').read_text())
model_meta = json.loads((ROOT / 'model.json').read_text())
assert model_meta['license'] == 'apache-2.0'
cache = os.path.join(os.environ['LOCALAPPDATA'], 'ZisSolar', 'model-cache')
weights = hf_hub_download(model_meta['model'], 'model.safetensors', revision=model_meta['revision'], cache_dir=cache, local_files_only=True)
torch.manual_seed(42)
np.random.seed(42)
torch.set_num_threads(4)
start = time.perf_counter()
model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(model_meta['model'], revision=model_meta['revision'], cache_dir=cache, local_files_only=True, torch_compile=False)
config = timesfm.ForecastConfig(max_context=256, max_horizon=32, normalize_inputs=True, per_core_batch_size=1, use_continuous_quantile_head=False, force_flip_invariance=True, infer_is_positive=True, fix_quantile_crossing=False, return_backcast=True)
model.compile(config)
load_seconds = time.perf_counter() - start
metadata = {
    **model_meta, 'weightsSha256': sha(weights), 'python': platform.python_version(),
    'packages': {p: importlib.metadata.version(p) for p in ['timesfm', 'torch', 'numpy', 'jax', 'jaxlib', 'scikit-learn', 'huggingface-hub']},
    'device': str(model.model.device), 'deviceName': torch.cuda.get_device_name(0) if torch.cuda.is_available() else platform.processor(),
    'torchCompile': False, 'forecastConfig': dataclasses.asdict(config), 'effectiveForecastConfig': dataclasses.asdict(model.forecast_config), 'xregMode': 'xreg + timesfm', 'ridge': 1.0,
    'loadSeconds': load_seconds, 'inputSha256': frozen['inputSha256'], 'protocolSha256': frozen['protocolSha256'],
}
print(json.dumps({'loaded': metadata['deviceName'], 'seconds': load_seconds, 'revision': model_meta['revision']}), flush=True)
results = []
for fold in data['candidates']:
    started = time.perf_counter()
    x = np.asarray([h['value'] for h in fold['context']], dtype=np.float64)
    assert len(x) == 240 and np.isfinite(x).all()
    # Each date is a separate regression. A pooled batch would leak later folds.
    with torch.inference_mode():
        plain, _ = model.forecast(horizon=28, inputs=[x])
    plain = np.asarray(plain[0])[-28:]
    all_hours = fold['context'] + fold['future']
    cov = {key: [[h['covariates'][key] for h in all_hours]] for key in all_hours[0]['covariates']}
    with torch.inference_mode():
        weather, quantiles = model.forecast_with_covariates(inputs=[x], dynamic_numerical_covariates=cov, xreg_mode='xreg + timesfm', ridge=1.0, force_on_cpu=True)
    weather = np.asarray(weather[0])
    assert plain.shape == weather.shape == (28,)
    assert np.isfinite(plain).all() and np.isfinite(weather).all()
    def physical(value, h):
        return float(np.clip(value, 0, data['config']['acKw'])) if h['clearSky'] > 0 else 0.0
    hours = []
    for i, h in enumerate(fold['future']):
        p, w = physical(plain[i], h), physical(weather[i], h)
        hours.append({
            'start': h['start'], 'baselineKwh': h['baselineKwh'], 'persistenceKwh': h['persistenceKwh'],
            'timesfmKwh': p, 'timesfmWeatherKwh': w, 'blendKwh': physical((w + h['baselineKwh']) / 2, h),
            'rawTimesfmKwh': float(plain[i]), 'rawTimesfmWeatherKwh': float(weather[i]),
        })
    result = {'date': fold['date'], 'originAt': fold['originAt'], 'seconds': time.perf_counter() - started, 'hours': hours}
    results.append(result)
    (ROOT / 'predictions.json').write_text(json.dumps({'metadata': metadata, 'results': results}, allow_nan=False))
    print(json.dumps({'completed': fold['date'], 'seconds': round(result['seconds'], 2)}), flush=True)
metadata['peakGpuBytes'] = torch.cuda.max_memory_allocated() if torch.cuda.is_available() else None
metadata['totalInferenceSeconds'] = sum(r['seconds'] for r in results)
(ROOT / 'predictions.json').write_text(json.dumps({'metadata': metadata, 'results': results}, allow_nan=False))
print(json.dumps({'finished': len(results), 'inferenceSeconds': metadata['totalInferenceSeconds'], 'peakGpuBytes': metadata['peakGpuBytes']}), flush=True)
