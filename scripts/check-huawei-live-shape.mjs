// One read-only API sample through the shared session, lock and quota ledger.
// Raw telemetry stays in ignored work/; no session or credential is exported.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
import {
  cacheRead,
  cacheWrite,
  withCacheLock,
  sharedCache,
} from '../lib/shared-cache.ts';
import { fusionClient } from '../lib/fusion-client.ts';
import { liveObservation } from '../lib/forecast-trial.ts';
import { inverterSamples } from '../lib/inverter-availability.ts';

assert.ok(sharedCache());
for (const name of ['FUSIONSOLAR_USERNAME', 'FUSIONSOLAR_PASSWORD']) {
  assert.ok(
    process.env[name] && process.env[name] !== '[SENSITIVE]',
    'Load private credentials',
  );
}
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
assert.ok(owner);
const result = await withCacheLock(
  'plant:' + owner,
  async () => {
    const state = await cacheRead('fusion:' + owner);
    assert.ok(state?.devices?.length === 8);
    const api = fusionClient(owner, state, () =>
      cacheWrite('fusion:' + owner, state),
    );
    const endpoint = '/thirdData/getDevRealKpi',
      key = endpoint + ':1';
    assert.ok(
      api.available(key, 300000, 288) && api.available(endpoint, 300000, 288),
      'Shared live quota unavailable',
    );
    const requestedAt = new Date().toISOString();
    const values = await api.call(
      endpoint,
      { devIds: state.devices.join(','), devTypeId: 1 },
      300000,
      288,
      key,
    );
    const receivedAt = new Date();
    assert.ok(Array.isArray(values));
    const saved = {
      requestedAt,
      receivedAt: receivedAt.toISOString(),
      endpoint,
      devices: state.devices,
      values,
    };
    const raw = JSON.stringify(saved);
    const path =
      'work/forecast-research/huawei-live/' +
      receivedAt.toISOString().replaceAll(':', '-') +
      '.json';
    fs.mkdirSync('work/forecast-research/huawei-live', { recursive: true });
    fs.writeFileSync(path, raw, { flag: 'wx' });
    return {
      path,
      sha256: createHash('sha256').update(raw).digest('hex'),
      receivedAt,
      rows: values.length,
      fields: [...new Set(values.flatMap((row) => Object.keys(row)))],
      mapFields: [
        ...new Set(values.flatMap((row) => Object.keys(row.dataItemMap ?? {}))),
      ],
      timestamps: values.map((row) => ({
        collectTime: row.collectTime ?? null,
        mapCollectTime: row.dataItemMap?.collectTime ?? null,
      })),
      usableObservation:
        liveObservation(values, state.devices, receivedAt) !== null,
      usableInverterSamples: inverterSamples(
        values,
        state.devices,
        receivedAt,
        'live',
      ).length,
    };
  },
  90,
);
console.log(JSON.stringify(result));
