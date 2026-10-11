import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_SCHEDULE } from '../lib/contracts.ts';
let cached, queries, busy, rows;
mock.module('../lib/shared-cache.ts', {
  namedExports: {
    cacheRead: async () => cached,
    cacheWrite: async (key, value, ttl) => {
      assert.equal(ttl, 7 * 86400);
      cached = value;
    },
    withCacheLock: async (key, work) =>
      busy ? { busy: true } : { busy: false, value: await work() },
  },
});
mock.module('../db/index.ts', {
  namedExports: {
    db: () => ({
      prepare: () => ({
        all: async () => {
          queries++;
          return { results: rows };
        },
      }),
    }),
  },
});
const { readContracts } = await import('../lib/contracts-server.ts');
beforeEach(() => {
  cached = null;
  queries = 0;
  busy = false;
  rows = structuredClone(CONTRACT_SCHEDULE);
});
void test('persisted contracts use the shared cache so warm reads do not wake SQL', async () => {
  assert.deepEqual(await readContracts(), CONTRACT_SCHEDULE);
  assert.equal(queries, 1);
  await readContracts();
  await readContracts();
  assert.equal(queries, 1);
});
void test('a missing contract schedule fails rather than silently mispricing revenue', async () => {
  rows = [];
  await assert.rejects(readContracts(), /Invalid persisted contract/);
  assert.equal(cached, null);
  busy = true;
  await assert.rejects(readContracts(), /loading/);
  assert.equal(queries, 1);
});
