import { ZONE, localDate, localHour } from './energy';

const offsetFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  timeZoneName: 'shortOffset',
});

// Ordinary times remain uncluttered. Only the repeated autumn hour needs an
// offset to distinguish two different measurements with the same wall time.
export function repeatedHourSuffix(value: string): string {
  const at = Date.parse(value);
  const day = localDate(value),
    hour = localHour(value);
  const repeated = [-3600000, 3600000].some((delta) => {
    const other = new Date(at + delta).toISOString();
    return localDate(other) === day && localHour(other) === hour;
  });
  if (!repeated) return '';
  const offset = offsetFormat
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')!.value;
  return ` (${offset.replace('GMT', 'UTC')})`;
}

export function formatPlantTime(
  value: string,
  locale = 'mk-MK',
  withDate = false,
): string {
  return (
    new Intl.DateTimeFormat(locale, {
      timeZone: ZONE,
      ...(withDate
        ? ({ day: '2-digit', month: '2-digit', year: 'numeric' } as const)
        : {}),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value)) + repeatedHourSuffix(value)
  );
}
