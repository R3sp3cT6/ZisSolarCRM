import {hourLabel, localDate, localHour, type Period} from './energy';
import {toMwh} from './energy-report';

export type Ohlc = {open: number; high: number; low: number; close: number; count: number};
export type EnergyCandle = {
  key: string;
  label: string;
  slots: number;
  production: Ohlc | null;
  revenue: Ohlc | null;
};
type Sample = {start: string; productionKwh: number | null; revenue: number | null};

function bucket(start: string, period: Period) {
  const date = localDate(start);
  if (period === 'year') return {key: date.slice(0, 7), label: date.slice(5, 7)};
  if (period === 'month') return {key: date, label: date.slice(8, 10)};
  if (period === 'hour') return {key: start, label: hourLabel(start)};
  const hour = Math.floor(localHour(start) / 3) * 3;
  const label = `${String(hour).padStart(2, '0')}:00–${String(hour + 3).padStart(2, '0')}:00`;
  return {key: `${date}T${String(hour).padStart(2, '0')}`, label};
}

function include(current: Ohlc | null, value: number | null): Ohlc | null {
  if (value === null || !Number.isFinite(value)) return current;
  if (current === null) return {open: value, high: value, low: value, close: value, count: 1};
  return {...current, high: Math.max(current.high, value), low: Math.min(current.low, value), close: value, count: current.count + 1};
}

/** OHLC of actual hourly values, not period totals or interpolated observations. */
export function buildEnergyCandles(rows: Sample[], period: Period, range: {from: string; to: string}): EnergyCandle[] {
  const from = Date.parse(range.from), to = Date.parse(range.to);
  const groups = new Map<string, EnergyCandle>();
  // Step through real UTC hours so 23/25-hour local days retain every observation.
  for (let time = from; time < to; time += 3_600_000) {
    const item = bucket(new Date(time).toISOString(), period);
    const group = groups.get(item.key) ?? {...item, slots: 0, production: null, revenue: null};
    group.slots++;
    groups.set(item.key, group);
  }
  const ordered = rows.filter(row => Date.parse(row.start) >= from && Date.parse(row.start) < to)
    .slice().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (const row of ordered) {
    const group = groups.get(bucket(new Date(row.start).toISOString(), period).key);
    if (!group) continue;
    group.production = include(group.production, toMwh(row.productionKwh));
    group.revenue = include(group.revenue, row.revenue);
  }
  return [...groups.values()];
}
