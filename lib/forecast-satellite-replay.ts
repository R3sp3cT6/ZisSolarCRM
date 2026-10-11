import { backtestOrigin, type BacktestPayload } from './forecast-backtest';
import {
  calibrateHourly,
  type CalibrationRevision,
} from './forecast-hourly-calibration';
import type { ForecastConfig, WeatherHour } from './forecast-model';
import type { SolarCalibration } from './forecast-solar';
import type { SatellitePoint } from './forecast-satellite';
import {
  satelliteCorrection,
  satellitePower,
} from './forecast-satellite-nowcast';

export const SATELLITE_REPLAY_VERSION = 'satellite-csi-v1-on-v3.2-replay';
export type SatelliteReplayInputs = {
  replay: {
    payload: BacktestPayload;
    inputs: {
      config: ForecastConfig;
      days: {
        date: string;
        weather: WeatherHour[];
        calibration: SolarCalibration;
      }[];
    };
  };
  revisions: CalibrationRevision[];
  satellitePoints: SatellitePoint[];
};

/** Reproduce the archived component experiment for ALL source hours, including
 * zero nights and hours without actual readings. Actual target values never
 * select the plotted hours or enter the predictions. Historical delivery is an
 * explicit assumption in copies; original receivedAt timestamps stay untouched.
 * This is an hour-ahead retrospective replay, never a backdated forecast_run. */
export function satelliteReplay(
  inputs: SatelliteReplayInputs,
  identity: { id: string; createdAt: string; evaluationId: string },
): BacktestPayload {
  const { config, days: sources } = inputs.replay.inputs;
  if (!config.acKw || !Number.isFinite(Date.parse(identity.createdAt)))
    throw Error('Invalid satellite replay configuration');
  const predictions = inputs.replay.payload.days.flatMap((day) =>
    day.hours.flatMap((h) =>
      h.productionKwh === null
        ? []
        : [
            {
              start: h.start,
              baseKwh: h.productionKwh,
              originAt: h.originAt,
              source: 'historical' as const,
            },
          ],
    ),
  );
  const points = new Map(inputs.satellitePoints.map((p) => [p.slotTime, p]));
  const days = inputs.replay.payload.days.map((day) => {
    const source = sources.find((s) => s.date === day.date);
    const gain = calibrateHourly(
      predictions,
      inputs.revisions,
      new Date(backtestOrigin(day.date).originAt),
      config.acKw!,
    ).factor;
    const hours = day.hours.map((h) => {
      const origin = new Date(h.start);
      const weather = source?.weather.find((w) => w.start === h.start);
      if (
        h.productionKwh === null ||
        !Number.isFinite(h.productionKwh) ||
        !weather ||
        !source ||
        origin.getTime() > Date.parse(identity.createdAt)
      )
        return {
          ...h,
          originAt: h.start,
          productionKwh: null,
          baselineKwh: null,
          satelliteWeight: 0,
        };
      const baselineKwh = Math.min(config.acKw!, h.productionKwh * gain);
      const satellite = [45, 30].flatMap((lag) => {
        const point = points.get(
          new Date(origin.getTime() - lag * 60000).toISOString(),
        );
        return point
          ? [
              {
                ...point,
                receivedAt: new Date(
                  Date.parse(point.createdAt) + 120000,
                ).toISOString(),
              },
            ]
          : [];
      });
      const state = satelliteCorrection(satellite, config, origin);
      let productionKwh = 0,
        satelliteWeight = 0;
      for (let i = 0; i < 12; i++) {
        const value = satellitePower(
          origin.getTime() + (i + 0.5) * 300000,
          baselineKwh,
          weather,
          config,
          source.calibration,
          state,
        );
        productionKwh += value.powerKw / 12;
        satelliteWeight += value.weight / 12;
      }
      return {
        ...h,
        originAt: h.start,
        productionKwh,
        baselineKwh,
        satelliteWeight,
      };
    });
    return {
      ...day,
      hours,
      productionKwh: hours.every((h) => h.productionKwh !== null)
        ? hours.reduce((sum, h) => sum + h.productionKwh!, 0)
        : null,
    };
  });
  return {
    ...inputs.replay.payload,
    ...identity,
    days,
    modelVersion: SATELLITE_REPLAY_VERSION,
    source: 'NOAA GFS + LSA SAF',
    method: 'satellite-hour-ahead',
  };
}
