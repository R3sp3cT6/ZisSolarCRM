export type IconMean = {
  lead: number;
  direct: number;
  diffuse: number;
};
export type IconHour = { start: string; irradiance: number; diffuse: number };

/** ICON ASWDIR_S/ASWDIFD_S are averages SINCE RUN START. Recover each
 * interval by differencing energy, never treating these as instantaneous GHI. */
export function iconHours(runAt: string, means: IconMean[]): IconHour[] {
  const run = Date.parse(runAt),
    seen = new Set<number>();
  if (!Number.isFinite(run) || run % 3600000) throw Error('Invalid ICON run');
  for (const m of means) {
    if (
      !Number.isInteger(m.lead) ||
      m.lead < 0 ||
      m.lead > 78 ||
      seen.has(m.lead) ||
      ![m.direct, m.diffuse].every(
        (v) => Number.isFinite(v) && v >= 0 && v <= 1600,
      )
    )
      throw Error('Invalid ICON mean');
    seen.add(m.lead);
  }
  return [...means]
    .sort((a, b) => a.lead - b.lead)
    .flatMap((m) => {
      if (!m.lead) return [];
      const previous = means.find((p) => p.lead === m.lead - 1);
      if (m.lead > 1 && !previous) return [];
      const direct = m.lead * m.direct - (m.lead - 1) * (previous?.direct ?? 0);
      const diffuse =
        m.lead * m.diffuse - (m.lead - 1) * (previous?.diffuse ?? 0);
      if (direct < -1 || diffuse < -1 || direct + diffuse > 1800)
        throw Error('Invalid ICON hourly flux');
      return [
        {
          start: new Date(run + (m.lead - 1) * 3600000).toISOString(),
          irradiance: Math.max(0, direct) + Math.max(0, diffuse),
          diffuse: Math.max(0, diffuse),
        },
      ];
    });
}
