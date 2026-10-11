// Archive device telemetry through the application's existing locked/quota-aware
// client. This does not update measurements, dispatch power commands or create a poller.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cacheRead,
  cacheWrite,
  withCacheLock,
  sharedCache,
} from '../lib/shared-cache.ts';
import { fusionClient } from '../lib/fusion-client.ts';
import { slotsForDay, validDate } from '../lib/energy.ts';
import { db } from '../db/index.ts';
const [date] = process.argv.slice(2);
assert.ok(validDate(date));
assert.ok(sharedCache(), 'Reuse shared session/quota state');
assert.ok(
  process.env.FUSIONSOLAR_PASSWORD &&
    process.env.FUSIONSOLAR_PASSWORD !== '[SENSITIVE]' &&
    process.env.FUSIONSOLAR_USERNAME &&
    process.env.FUSIONSOLAR_USERNAME !== '[SENSITIVE]',
  'Load the private Huawei credential before accessing shared session state',
);
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
assert.ok(owner);
const path = 'work/forecast-research/huawei-five-minute/' + date + '.json';
assert.ok(!fs.existsSync(path), 'Already archived');
const result = await withCacheLock(
  'plant:' + owner,
  async () => {
    const state = await cacheRead('fusion:' + owner);
    assert.ok(
      state?.devices?.length === 8,
      'Expected complete configured inverter list',
    );
    const persist = () => cacheWrite('fusion:' + owner, state);
    const api = fusionClient(owner, state, persist);
    assert.ok(
      api.available('/thirdData/getDevHistoryKpi', 60000, 26),
      'Huawei shared quota unavailable; do not bypass',
    );
    const slots = slotsForDay(date),
      from = Date.parse(slots[0].start),
      to = Math.min(Date.parse(slots.at(-1).end), Date.now());
    assert.ok(from < to);
    const values = await api.call(
      '/thirdData/getDevHistoryKpi',
      {
        devIds: state.devices.join(','),
        devTypeId: 1,
        startTime: from,
        endTime: to,
      },
      60000,
      26,
    );
    assert.ok(Array.isArray(values));
    fs.mkdirSync('work/forecast-research/huawei-five-minute', {
      recursive: true,
    });
    const saved = {
      date,
      receivedAt: new Date().toISOString(),
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      devices: state.devices,
      values,
      sha256: createHash('sha256').update(JSON.stringify(values)).digest('hex'),
    };
    fs.writeFileSync(path, JSON.stringify(saved));
    return {
      date,
      rows: values.length,
      devices: state.devices.length,
      times: new Set(values.map((v) => v.collectTime)).size,
      fields: Object.keys(values[0]?.dataItemMap ?? {}),
      first: values.length
        ? new Date(Math.min(...values.map((v) => v.collectTime))).toISOString()
        : null,
      last: values.length
        ? new Date(Math.max(...values.map((v) => v.collectTime))).toISOString()
        : null,
    };
  },
  90,
);
console.log(JSON.stringify(result));
