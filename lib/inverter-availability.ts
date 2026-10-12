/** Read-only Huawei device evidence. A missing sample is never a shutdown. */
export type InverterSample = {
  deviceId: number;
  measuredAt: string;
  receivedAt: string;
  source: 'live' | 'history';
  powerKw: number | null;
  totalKwh: number | null;
  stateCode: number | null;
  startupRaw: number | null;
  shutdownRaw: number | null;
  startupAt: string | null;
  shutdownAt: string | null;
};
const STEP = 300000;
const number = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// This plant's historical response returns epoch seconds (including floating
// rounding noise). Other Huawei API versions document milliseconds. Keep raw
// values, accept either only within a plausible non-future epoch range.
function eventTime(raw: number | null, measured: number): string | null {
  if (raw === null || raw <= 0) return null;
  const t = Math.round(raw < 1e11 ? raw * 1000 : raw);
  return t >= Date.UTC(2000, 0, 1) && t <= measured
    ? new Date(t).toISOString()
    : null;
}

export function inverterSamples(
  input: unknown,
  ids: number[],
  receivedAt: Date,
  source: InverterSample['source'] = 'history',
): InverterSample[] {
  const received = receivedAt.getTime();
  if (
    !Array.isArray(input) ||
    !Number.isFinite(received) ||
    !ids.length ||
    ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(ids).size !== ids.length
  )
    return [];
  const allowed = new Set(ids),
    duplicate = new Set<string>();
  const samples = new Map<string, InverterSample>();
  for (const row of input) {
    const t = row?.collectTime,
      id = row?.devId,
      m = row?.dataItemMap;
    if (
      !allowed.has(id) ||
      !Number.isSafeInteger(t) ||
      t < Date.UTC(2000, 0, 1) ||
      t % STEP !== 0 ||
      t > received ||
      (source === 'live' && received - t > 15 * 60000) ||
      !m
    )
      continue;
    const key = id + ':' + t;
    if (samples.has(key)) duplicate.add(key);
    const power = number(m.active_power),
      total = number(m.total_cap);
    const state = number(m.inverter_state),
      startup = number(m.open_time),
      shutdown = number(m.close_time);
    samples.set(key, {
      deviceId: id,
      measuredAt: new Date(t).toISOString(),
      receivedAt: receivedAt.toISOString(),
      source,
      powerKw: power !== null && Math.abs(power) <= 2000 ? power : null,
      totalKwh: total !== null && total >= 0 ? total : null,
      stateCode:
        state !== null &&
        Number.isSafeInteger(state) &&
        state >= 0 &&
        state <= 65535
          ? state
          : null,
      startupRaw: startup,
      shutdownRaw: shutdown,
      startupAt: eventTime(startup, t),
      shutdownAt: eventTime(shutdown, t),
    });
  }
  // Keep partial device coverage; discard ambiguous duplicates, not other devices.
  return [...samples.entries()]
    .filter(([key]) => !duplicate.has(key))
    .map(([, sample]) => sample)
    .sort(
      (a, b) =>
        a.measuredAt.localeCompare(b.measuredAt) || a.deviceId - b.deviceId,
    );
}

export function inverterCondition(s: InverterSample) {
  // Huawei SmartPVMS NBI inverter_state enumeration; unfamiliar states stay unknown.
  if (s.powerKw === null || s.stateCode === null) return 'unknown';
  if ([768, 769, 770, 771, 772, 773].includes(s.stateCode))
    return s.powerKw === 0 ? 'reported-shutdown' : 'inconsistent';
  if (s.stateCode === 40960)
    return s.powerKw === 0 ? 'no-irradiation' : 'inconsistent';
  if (s.stateCode === 513) return 'power-limited';
  if (s.stateCode === 514) return 'self-derating';
  if (s.stateCode === 512)
    return s.powerKw > 0 ? 'producing' : 'zero-without-shutdown';
  if ([0, 1, 2, 3, 256, 1792].includes(s.stateCode))
    return 'starting-or-standby';
  return 'unknown';
}

export type InverterInterruption = {
  kind: 'reported-shutdown' | 'power-limited';
  deviceId: number;
  firstObserved: string;
  lastObserved: string;
  startAfter: string | null;
  resumedBy: string | null;
  nextProductionObservedAt: string | null;
  samples: number;
  stateCodes: number[];
};

/** Observation bounds, never second-accurate inferred event times. A gap splits
 * evidence; resumption requires positive measured output at the next 5-min slot. */
export function inverterInterruptions(
  samples: InverterSample[],
  kind: InverterInterruption['kind'] = 'reported-shutdown',
): InverterInterruption[] {
  const result: InverterInterruption[] = [];
  for (const id of new Set(samples.map((s) => s.deviceId))) {
    const rows = samples
      .filter((s) => s.deviceId === id)
      .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
    let event: InverterInterruption | null = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i],
        previous = rows[i - 1];
      const adjacent =
        previous &&
        Date.parse(row.measuredAt) - Date.parse(previous.measuredAt) === STEP;
      if (event && !adjacent) {
        if (inverterCondition(row) === 'producing')
          event.nextProductionObservedAt = row.measuredAt;
        result.push(event);
        event = null;
      }
      if (inverterCondition(row) === kind) {
        if (!event)
          event = {
            kind,
            deviceId: id,
            firstObserved: row.measuredAt,
            lastObserved: row.measuredAt,
            startAfter:
              adjacent && inverterCondition(previous) === 'producing'
                ? previous.measuredAt
                : null,
            resumedBy: null,
            nextProductionObservedAt: null,
            samples: 0,
            stateCodes: [],
          };
        event.lastObserved = row.measuredAt;
        event.samples++;
        if (!event.stateCodes.includes(row.stateCode!))
          event.stateCodes.push(row.stateCode!);
      } else if (event) {
        if (adjacent && inverterCondition(row) === 'producing') {
          event.resumedBy = row.measuredAt;
          event.nextProductionObservedAt = row.measuredAt;
        }
        result.push(event);
        event = null;
      }
    }
    if (event) result.push(event);
  }
  return result.sort(
    (a, b) =>
      a.firstObserved.localeCompare(b.firstObserved) || a.deviceId - b.deviceId,
  );
}
