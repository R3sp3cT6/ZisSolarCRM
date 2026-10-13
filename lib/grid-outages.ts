/** Public notices are evidence of a plan, never proof of this plant's outage. */
export const GRID_OUTAGES_PAGE =
  'https://elektrodistribucija.mk/Grid/OutagesMap.aspx';
export const GRID_OUTAGES_URL =
  'https://portal-api.elektrodistribucija.mk/DSO/Prekini/ZemiPrekini';
export const GRID_OUTAGES_VERSION = 'elektrodistribucija-notices-v1';

export type GridNotice = {
  id: string;
  centerId: number;
  type: string;
  settlement: string;
  location: string;
  startLocal: string;
  endLocal: string;
  voltage: string;
};

export type GridNoticeSnapshot = {
  version: typeof GRID_OUTAGES_VERSION;
  sourceUrl: typeof GRID_OUTAGES_URL;
  status: 'available' | 'unavailable';
  requestedAt: string;
  receivedAt: string | null;
  // This endpoint supplies neither publication time nor a timezone offset.
  publishedAt: null;
  timeBasis: 'source-wall-clock-unverified';
  applicability: 'unconfirmed';
  appliedToForecast: false;
  notices: GridNotice[];
  raw: string | null;
  sha256: string | null;
  error: 'request-failed' | 'invalid-response' | null;
};

function text(value: unknown, limit = 10000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit)
    throw Error('Invalid notice text');
  return value.trim();
}

function wallClock(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)
  )
    throw Error('Invalid notice time');
  // Appending Z here validates the calendar only; the returned value is NOT UTC.
  const date = new Date(value + 'Z');
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 19) !== value
  )
    throw Error('Invalid notice date');
  return value;
}

export function parseGridNotices(input: unknown): GridNotice[] {
  if (!Array.isArray(input) || input.length > 10000)
    throw Error('Invalid notice list');
  const seen = new Set<string>();
  return input.map((row) => {
    if (!row || typeof row !== 'object') throw Error('Invalid notice row');
    const id = text(row.prekinID, 80);
    if (
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) ||
      seen.has(id)
    )
      throw Error('Duplicate or invalid notice ID');
    seen.add(id);
    if (!Number.isSafeInteger(row.kecId) || row.kecId < 0)
      throw Error('Invalid notice center');
    const startLocal = wallClock(row.pocetok),
      endLocal = wallClock(row.kraj);
    if (endLocal <= startLocal) throw Error('Invalid notice interval');
    return {
      id,
      centerId: row.kecId,
      type: text(row.tipPrekin, 200),
      settlement: text(row.nasMesto),
      location: text(row.adresa),
      startLocal,
      endLocal,
      voltage: text(row.napNivo, 100),
    };
  });
}

/** Only a receipt already in hand at the origin may be used in a replay. */
export function gridSnapshotAtOrigin(
  snapshot: GridNoticeSnapshot,
  origin: Date,
): GridNoticeSnapshot | null {
  const received = snapshot.receivedAt ? Date.parse(snapshot.receivedAt) : NaN;
  return snapshot.status === 'available' &&
    Number.isFinite(received) &&
    received <= origin.getTime()
    ? snapshot
    : null;
}
