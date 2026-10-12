"""Resumable bounded HTTP range downloads with publisher SHA256 verification."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import re
import time
import requests
from huggingface_hub import HfApi

root = Path('work/forecast-research/timesfm')
meta = json.loads((root / 'model.json').read_text())
info = HfApi().model_info(meta['model'], revision=meta['revision'], files_metadata=True)
weights = next(f for f in info.siblings if f.rfilename == 'model.safetensors')
index = requests.get('https://download.pytorch.org/whl/cpu/torch/', timeout=30)
index.raise_for_status()
name = 'torch-2.8.0+cpu-cp312-cp312-win_amd64.whl'
wheel = next(u for u, label in re.findall(r'href="([^"]+)"[^>]*>([^<]+)', index.text) if label == name)
cache = Path(os.environ['LOCALAPPDATA']) / 'ZisSolar/model-cache/models--google--timesfm-2.5-200m-pytorch/snapshots' / meta['revision']
assets = [
    (f"https://huggingface.co/{meta['model']}/resolve/{meta['revision']}/model.safetensors", cache / 'model.safetensors', weights.lfs.sha256),
    (wheel.split('#')[0], root / 'packages' / name, wheel.split('sha256=')[1]),
]
receipts = []
for url, path, digest in assets:
    path.parent.mkdir(parents=True, exist_ok=True)
    response = requests.get(url, headers={'Range': 'bytes=0-0'}, timeout=60)
    response.raise_for_status()
    assert response.status_code == 206
    total = int(response.headers['content-range'].split('/')[-1])
    parts = path.parent / (path.name + '.parts')
    parts.mkdir(exist_ok=True)
    chunk_size = 16 * 1024 * 1024
    starts = list(range(0, total, chunk_size))
    def chunk(start):
        end = min(total, start + chunk_size) - 1
        part = parts / str(start)
        if part.exists() and part.stat().st_size == end - start + 1:
            return
        for attempt in range(3):
            try:
                res = requests.get(url, headers={'Range': f'bytes={start}-{end}'}, timeout=120)
                res.raise_for_status()
                assert res.status_code == 206 and res.headers['content-range'] == f'bytes {start}-{end}/{total}'
                assert len(res.content) == end - start + 1
                part.write_bytes(res.content)
                return
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(1)
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(chunk, start) for start in starts]
        for i, future in enumerate(as_completed(futures), 1):
            future.result()
            if i % 10 == 0 or i == len(starts):
                print(json.dumps({'asset': path.name, 'parts': i, 'totalParts': len(starts)}), flush=True)
    check = hashlib.sha256()
    with path.open('wb') as output:
        for start in starts:
            content = (parts / str(start)).read_bytes()
            check.update(content)
            output.write(content)
    assert check.hexdigest() == digest, 'Publisher checksum mismatch'
    # Only delete the exact chunk files created by this downloader.
    for start in starts:
        (parts / str(start)).unlink()
    parts.rmdir()
    receipts.append({'asset': path.name, 'bytes': total, 'sha256': digest, 'url': url})
    (root / 'download-receipts.json').write_text(json.dumps(receipts, indent=2))
    print(json.dumps({'verified': path.name, 'bytes': total, 'sha256': digest}), flush=True)
