import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseGridNotices, gridSnapshotAtOrigin } from '../lib/grid-outages.ts';
import { fetchGridOutages } from '../lib/grid-outages-server.ts';

const notice = {
  prekinID: '932ee59b-1cca-447b-a96e-71c8dcdb2415',
  kecId: 14,
  tipPrekin: 'Планиран прекин',
  nasMesto: 'РЕСЕН',
  adresa: 'Дел од една улица',
  pocetok: '2026-10-25T02:00:42',
  kraj: '2026-10-25T04:30:54',
  napNivo: '10 kV',
};

await test('preserves the source wall-clock including DST ambiguity and does not infer plant applicability', () => {
  const [parsed] = parseGridNotices([notice]);
  assert.equal(parsed.startLocal, notice.pocetok);
  assert.equal(parsed.endLocal, notice.kraj);
  assert.equal('startUtc' in parsed, false);
  assert.equal('appliesToPlant' in parsed, false);
  assert.throws(() => parseGridNotices([notice, notice]), /Duplicate/);
  assert.throws(
    () => parseGridNotices([{ ...notice, pocetok: '2026-02-30T02:00:00' }]),
    /date/,
  );
  assert.throws(
    () => parseGridNotices([{ ...notice, kraj: notice.pocetok }]),
    /interval/,
  );
  assert.throws(() => parseGridNotices({ notices: [] }), /list/);
});

await test('later receipts and failed collection cannot become day-ahead outage knowledge', () => {
  const snapshot = {
    status: 'available',
    receivedAt: '2026-10-12T18:00:01Z',
    notices: [],
  };
  assert.equal(
    gridSnapshotAtOrigin(snapshot, new Date('2026-10-12T18:00:00Z')),
    null,
  );
  assert.equal(
    gridSnapshotAtOrigin(snapshot, new Date('2026-10-12T18:00:01Z')),
    snapshot,
  );
  assert.equal(
    gridSnapshotAtOrigin(
      { ...snapshot, status: 'unavailable' },
      new Date('2026-10-13'),
    ),
    null,
  );
  assert.equal(
    gridSnapshotAtOrigin(
      { ...snapshot, receivedAt: null },
      new Date('2026-10-13'),
    ),
    null,
  );
});

await test('archives exact source bytes/hash and distinguishes valid empty data from a failed feed', async () => {
  const raw = JSON.stringify([notice]);
  const fetch = mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(raw, { headers: { 'content-type': 'application/json' } }),
  );
  try {
    const source = await fetchGridOutages();
    assert.equal(source.status, 'available');
    assert.equal(source.raw, raw);
    assert.equal(source.sha256, createHash('sha256').update(raw).digest('hex'));
    assert.equal(source.appliedToForecast, false);
    assert.equal(source.publishedAt, null);
    assert.equal(source.applicability, 'unconfirmed');
    assert.ok(source.receivedAt >= source.requestedAt);
    fetch.mock.mockImplementation(
      async () =>
        new Response('[]', { headers: { 'content-type': 'application/json' } }),
    );
    assert.equal((await fetchGridOutages()).status, 'available');
    fetch.mock.mockImplementation(
      async () => new Response('[]', { status: 503 }),
    );
    const failed = await fetchGridOutages();
    assert.equal(failed.status, 'unavailable');
    assert.equal(failed.receivedAt, null);
    fetch.mock.mockImplementation(
      async () =>
        new Response('<html>error</html>', {
          headers: { 'content-type': 'text/html' },
        }),
    );
    assert.equal((await fetchGridOutages()).status, 'unavailable');
    fetch.mock.mockImplementation(
      async () =>
        new Response(JSON.stringify([notice, notice]), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const duplicate = await fetchGridOutages();
    assert.equal(duplicate.status, 'unavailable');
    assert.ok(duplicate.raw);
    fetch.mock.mockImplementation(
      async () =>
        new Response(' '.repeat(2 * 1024 * 1024 + 1), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    assert.equal((await fetchGridOutages()).status, 'unavailable');
    fetch.mock.mockImplementation(async () => {
      throw Error('private upstream failure');
    });
    assert.ok(
      !JSON.stringify(await fetchGridOutages()).includes('private upstream'),
    );
  } finally {
    fetch.mock.restore();
  }
});
