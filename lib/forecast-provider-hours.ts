import type { SolarField } from './forecast-provider-grib';
export type ProviderHour = { start: string; irradiance: number };
export function providerHours(
  runAt: string,
  fields: SolarField[],
  provider: 'arpege' | 'gfs',
): ProviderHour[] {
  const run = Date.parse(runAt);
  if (!Number.isFinite(run)) throw Error('Invalid solar initialization');
  const points = new Map<number, SolarField>();
  for (const f of fields) {
    if (
      points.has(f.endLead) ||
      !Number.isInteger(f.startLead) ||
      !Number.isInteger(f.endLead) ||
      f.endLead <= f.startLead ||
      !Number.isFinite(f.value) ||
      f.value < 0
    )
      throw Error('Invalid solar intervals');
    points.set(f.endLead, f);
  }
  return [...points.values()]
    .sort((a, b) => a.endLead - b.endLead)
    .flatMap((f) => {
      const prev = points.get(f.endLead - 1),
        duration = f.endLead - f.startLead;
      if (provider === 'arpege' && f.startLead !== 0)
        throw Error('Accumulation reset');
      if (duration > 1 && (!prev || prev.startLead !== f.startLead)) return [];
      const ghi =
        provider === 'arpege'
          ? (f.value - (prev?.value ?? 0)) / 3600
          : duration * f.value - (duration - 1) * (prev?.value ?? 0);
      if (!Number.isFinite(ghi) || ghi < -0.5 || ghi > 1800)
        throw Error('Invalid hourly solar energy');
      return [
        {
          start: new Date(run + (f.endLead - 1) * 3600000).toISOString(),
          irradiance: ghi < 1e-9 ? 0 : ghi,
        },
      ];
    });
}
