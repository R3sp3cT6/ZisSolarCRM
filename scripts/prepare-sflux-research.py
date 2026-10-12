"""Require the complete declared source range and freeze an immutable experiment."""
import datetime as dt
import email.utils
import hashlib
import importlib.util
import json
import pathlib

ROOT = pathlib.Path('work/forecast-research/sflux')

def read(path):
    return json.loads(pathlib.Path(path).read_text(encoding='utf-8'))

def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()

def run():
    spec = importlib.util.spec_from_file_location('sflux', 'scripts/sflux-features.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    original_path = 'work/forecast-research/full-history/inputs.json'
    data = read(original_path)
    assert sha(original_path) == read('docs/full-history-verification.json')['inputSha256']
    missing = [d['date'] for d in data['days'] if not (ROOT / (d['date'] + '.json')).exists()]
    assert not missing, f'Incomplete source range: {len(missing)} days, first={missing[:5]}'
    sources, prepared = [], []
    native_points = set()
    now = dt.datetime.now(dt.timezone.utc)
    source_hashes = {}
    for day in data['days']:
        path = ROOT / (day['date'] + '.json')
        source = read(path)
        assert source['version'] == 'sflux-point-v1' and len(source['fields']) == 112
        assert {(f['variable'], f['endLead']) for f in source['fields']} == {(v, i) for v in ('DSWRF', 'VDDSF', 'NDDSF', 'TMP') for i in range(7, 35)}
        origin = module.timestamp(day['originAt'])
        for f in source['fields']:
            assert email.utils.parsedate_to_datetime(f['lastModified']) <= origin
            assert email.utils.parsedate_to_datetime(f['indexLastModified']) <= origin
            assert origin < module.timestamp(f['receivedAt']) <= now
            assert len(f['sha256']) == 64 and len(f['indexSha256']) == 64
            assert 'noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.' in f['url']
            assert f['bytes'] == int(f['byteRange'].split('-')[1]) - int(f['byteRange'].split('-')[0]) + 1
            if f['variable'] != 'TMP':
                assert f['gridType'] == 'regular_gg'
                native_points.add((round(f['latitude'], 6), round(f['longitude'], 6)))
        prepared_day = module.prepare(source, day)
        assert [h['start'] for h in prepared_day['hours']] == [h['start'] for h in day['hours']]
        sources.append(source)
        prepared.append(prepared_day)
        source_hashes[str(path)] = sha(path)
    assert len(native_points) == 1, native_points
    inputs = {'version': 'solar-sflux-features-v1', 'preparedAt': now.isoformat(), 'data': data,
              'sources': sources, 'days': prepared, 'sourceHashes': source_hashes,
              'sourceResearchId': 'solar-full-history-v1-66acd8997e24f971babf',
              'originalInputSha256': sha(original_path),
              'originalRunsSha256': sha('work/forecast-research/full-history/runs.json'),
              'originalEvaluationSha256': sha('docs/full-history-evaluation.json')}
    (ROOT / 'inputs.json').write_text(json.dumps(inputs, allow_nan=False, separators=(',', ':')), encoding='utf-8')
    code_paths = ['scripts/download-sflux-research.py', 'scripts/sflux-features.py',
                  'scripts/prepare-sflux-research.py', 'scripts/evaluate-sflux-research.py',
                  'tests/sflux-features.test.py', 'docs/sflux-research-plan.md']
    # Preserve exact source bytes/newlines on Windows for the archived code hashes.
    code = {p: pathlib.Path(p).read_bytes().decode('utf-8') for p in code_paths}
    frozen = {'frozenAt': now.isoformat(), 'inputSha256': sha(ROOT / 'inputs.json'),
              'codeHashes': {p: sha(p) for p in code_paths}, 'days': len(prepared),
              'fields': sum(len(s['fields']) for s in sources),
              'hourlyValues': sum(len(d['hours']) for d in prepared),
              'roundingAdjustments': sum(len(d['roundingAdjustments']) for d in prepared),
              'nativePoint': sorted(native_points)}
    (ROOT / 'frozen-source.json').write_text(json.dumps(code), encoding='utf-8')
    pathlib.Path('docs/sflux-research-frozen.json').write_text(json.dumps(frozen, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(frozen), flush=True)

if __name__ == '__main__':
    run()
