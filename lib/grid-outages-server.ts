import 'server-only';
import { createHash } from 'node:crypto';
import {
  GRID_OUTAGES_URL,
  GRID_OUTAGES_VERSION,
  parseGridNotices,
  type GridNoticeSnapshot,
} from './grid-outages';

const MAX_BYTES = 2 * 1024 * 1024;

/** One bounded public request per existing forecast run; no independent poller. */
export async function fetchGridOutages(): Promise<GridNoticeSnapshot> {
  const snapshot: GridNoticeSnapshot = {
    version: GRID_OUTAGES_VERSION,
    sourceUrl: GRID_OUTAGES_URL,
    status: 'unavailable',
    requestedAt: new Date().toISOString(),
    receivedAt: null,
    publishedAt: null,
    timeBasis: 'source-wall-clock-unverified',
    applicability: 'unconfirmed',
    appliedToForecast: false,
    notices: [],
    raw: null,
    sha256: null,
    error: 'request-failed',
  };
  try {
    const response = await fetch(GRID_OUTAGES_URL, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok || !response.body) return snapshot;
    snapshot.error = 'invalid-response';
    if (
      !response.headers
        .get('content-type')
        ?.toLowerCase()
        .includes('application/json')
    ) {
      await response.body.cancel();
      return snapshot;
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          return snapshot;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    snapshot.receivedAt = new Date().toISOString();
    const bytes = Buffer.concat(chunks);
    snapshot.raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    snapshot.sha256 = createHash('sha256').update(bytes).digest('hex');
    snapshot.notices = parseGridNotices(JSON.parse(snapshot.raw));
    snapshot.status = 'available';
    snapshot.error = null;
  } catch {
    // A failed public feed is recorded as unknown, not an empty outage schedule.
  }
  return snapshot;
}
