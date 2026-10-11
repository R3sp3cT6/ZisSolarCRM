import type { ForecastConfig, WeatherHour } from './forecast-model';
import type { IconHour } from './forecast-icon';
import { weatherAdjustedEnergy, type SolarCalibration } from './forecast-solar';
import { TRIAL_VERSION, type TrialHour } from './forecast-trial';

type Previous = {
  issuedAt: string;
  version: string;
  config: ForecastConfig;
  hours: TrialHour[];
};

/** MET starts at the current hour. Keep previously obtained temperature/wind
 * for up to two preceding hours so fresh Huawei power can be normalized against
 * ICON's preceding midpoint. Never invent weather or reuse old predicted kWh. */
export function buildTrialHours(
  icon: IconHour[],
  weather: WeatherHour[],
  baseline: Map<string, number | null>,
  config: ForecastConfig,
  calibration: SolarCalibration,
  previous: Previous | null,
  now = new Date(),
) {
  const thermal = new Map<string, TrialHour['weather']>(
    weather.map((w) => [
      w.start,
      {
        temperature: w.temperature,
        windSpeed: w.windSpeed,
      },
    ]),
  );
  const retained: {
    start: string;
    contextIssuedAt: string;
    weather: NonNullable<TrialHour['weather']>;
  }[] = [];
  const currentHour = Math.floor(now.getTime() / 3600000) * 3600000;
  const issued = Date.parse(previous?.issuedAt ?? '');
  if (
    previous?.version === TRIAL_VERSION &&
    previous.config.version === config.version &&
    issued <= now.getTime() &&
    now.getTime() - issued <= 18 * 3600000
  ) {
    for (const h of previous.hours) {
      const start = Date.parse(h.start),
        w = h.weather;
      if (
        thermal.has(h.start) ||
        start < currentHour - 2 * 3600000 ||
        start >= currentHour ||
        !Number.isFinite(start) ||
        start % 3600000 ||
        !w ||
        !Number.isFinite(w.temperature) ||
        w.temperature < -80 ||
        w.temperature > 70 ||
        (w.windSpeed != null &&
          (!Number.isFinite(w.windSpeed) ||
            w.windSpeed < 0 ||
            w.windSpeed > 100))
      )
        continue;
      thermal.set(h.start, w);
      retained.push({
        start: h.start,
        contextIssuedAt: previous.issuedAt,
        weather: w,
      });
    }
  }
  const hours: TrialHour[] = icon.flatMap((h) => {
    const w = thermal.get(h.start);
    if (!w) return [];
    return [
      {
        start: h.start,
        baselineKwh: baseline.get(h.start) ?? null,
        weather: w,
        iconKwh: weatherAdjustedEnergy(
          {
            ...w,
            start: h.start,
            irradiance: h.irradiance,
            irradianceKind: 'modeled-ghi',
            resolutionHours: 1,
            cloudCover: null,
          },
          config,
          calibration,
        ),
      },
    ];
  });
  return { hours, retained };
}
