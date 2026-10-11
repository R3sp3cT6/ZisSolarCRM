'use client';
import type { ForecastDay, AtmosphereSource } from '@/lib/forecast-model';
import { formatNumber } from '@/lib/number-format';
import { getLanguage } from '@/lib/language';

export function ForecastConditions({
  day,
  source,
}: {
  day: ForecastDay;
  source?: AtmosphereSource;
}) {
  const language = getLanguage();
  const l = (mk: string, en: string) => (language === 'en' ? en : mk);
  const n = (v: number | null | undefined, digits = 0) =>
    formatNumber(v, digits, language);
  const daylight = day.hours.filter(
    (h) => (h.weather?.clearSkyIrradiance ?? 0) > 10,
  );
  if (!daylight.length) return null;
  const weather = daylight.map((h) => h.weather!);
  const clear = weather.reduce((sum, w) => sum + w.clearSkyIrradiance!, 0);
  const received = weather.reduce((sum, w) => sum + w.irradiance, 0);
  const withAerosols = weather.filter((w) => w.aerosolFactor != null);
  const rainHours = day.hours.filter((h) => h.weather?.precipitationMm != null);
  const rain = rainHours.length
    ? rainHours.reduce((sum, h) => sum + h.weather!.precipitationMm!, 0)
    : null;
  const winds = weather.flatMap((w) =>
    w.windSpeed == null ? [] : [w.windSpeed],
  );
  const avgWind = winds.length
    ? winds.reduce((a, b) => a + b, 0) / winds.length
    : null;
  const aerosolEffect = withAerosols.length
    ? 100 *
      (withAerosols.reduce(
        (sum, w) => sum + w.clearSkyIrradiance! * w.aerosolFactor!,
        0,
      ) /
        withAerosols.reduce((sum, w) => sum + w.clearSkyIrradiance!, 0) -
        1)
    : null;
  const hour = (value: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Skopje',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value));
  return (
    <div className="forecast-conditions">
      <h3>{l('Влијание на временските услови', 'Weather effects')}</h3>
      <div className="forecast-condition-grid">
        <div>
          <span>
            {l(
              'Зрачење / референтно ведро небо',
              'Irradiance / reference clear sky',
            )}
          </span>
          <strong>
            ≈ {n((100 * received) / clear)}
            <small>%</small>
          </strong>
          <p>
            {l(
              'Со облачност, магла и достапните аеросоли.',
              'Including clouds, fog and available aerosol data.',
            )}
          </p>
        </div>
        <div>
          <span>
            {l('Ефект од аеросоли · процена', 'Aerosol effect · estimate')}
          </span>
          <strong>
            {aerosolEffect === null
              ? '—'
              : `≈ ${aerosolEffect > 0 ? '+' : ''}${n(aerosolEffect, 1)}`}
            <small>%</small>
          </strong>
          <p>
            {l(
              'Според референтна атмосфера; покриени',
              'Versus a reference atmosphere; covered',
            )}{' '}
            {withAerosols.length}/{weather.length}{' '}
            {l('дневни часа.', 'daylight hours.')}
          </p>
        </div>
        <div>
          <span>
            {l(
              'Ветер · дневен просек на 10 m',
              'Wind · daylight average at 10 m',
            )}
          </span>
          <strong>
            {n(avgWind, 1)}
            <small>m/s</small>
          </strong>
          <p>
            {l(
              'Влегува во процената на ладење на панелите.',
              'Used to estimate panel cooling.',
            )}
          </p>
        </div>
        <div>
          <span>
            {l('Врнежи · достапни часови', 'Precipitation · available hours')}
          </span>
          <strong>
            {rainHours.length < day.hours.length && rain !== null ? '≈ ' : ''}
            {n(rain, 1)}
            <small>mm</small>
          </strong>
          <p>
            {rainHours.length}/{day.hours.length}{' '}
            {l(
              'часа. Не претпоставуваме дека дождот ги исчистил панелите.',
              'hours. Rain is not assumed to have cleaned the panels.',
            )}
          </p>
        </div>
      </div>
      <p className="forecast-fine">
        {l(
          'Ова се процени од временски модели, не сателитско следење на поединечни облаци. Облачните слоеви се преклопуваат и не се собираат. Ветерот на 10 m не ја покажува брзината на облаците.',
          'These are weather-model estimates, not satellite tracking of individual clouds. Cloud layers overlap and are not added together. Wind at 10 m is not cloud-motion speed.',
        )}{' '}
        {l(
          'Прашината во воздухот е вклучена кога има податоци; наталожена нечистотија, снег и сенки од околни објекти не се измерени.',
          'Airborne dust is included when data is available; deposited dirt, snow cover and shadows from nearby objects are not measured.',
        )}
      </p>
      {source?.status !== 'ready' && (
        <p className="forecast-condition-status">
          {l(
            'SILAM моментално нема свежи податоци. Се користи временскиот модел без нова корекција за аеросоли.',
            'Fresh SILAM data is currently unavailable. The weather model runs without a new aerosol correction.',
          )}
        </p>
      )}
      {source?.status === 'ready' && withAerosols.length < weather.length && (
        <p className="forecast-condition-status">
          {l(
            'Дел од денот е надвор од достапната прогноза или опсегот на моделот за аеросоли. За тие часови се користи референтната атмосфера.',
            'Part of this day is outside aerosol coverage or the aerosol model’s valid range. Those hours use the reference atmosphere.',
          )}
        </p>
      )}
      <details className="forecast-weather-details">
        <summary>
          {l('Детални временски услови по час', 'Detailed hourly weather')}
        </summary>
        <section
          className="forecast-table-wrap"
          // Keyboard users need to scroll this wide data table.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          aria-label={l(
            'Временски услови · лизгајте хоризонтално',
            'Weather conditions · scroll horizontally',
          )}
        >
          <table>
            <thead>
              <tr>
                <th>{l('Час', 'Hour')}</th>
                <th>
                  {l(
                    'Ниски / средни / високи облаци',
                    'Low / mid / high cloud',
                  )}
                  <small>%</small>
                </th>
                <th>{l('Магла', 'Fog')} %</th>
                <th>{l('Влажност', 'Humidity')} %</th>
                <th>{l('Ветер', 'Wind')} m/s</th>
                <th>
                  {l('Врнежи', 'Rain')} mm
                  <small>{l('по час', 'per hour')}</small>
                </th>
                <th>
                  {l('Аеросоли / прашина', 'Aerosols / dust')}
                  <small>AOD 550 nm</small>
                </th>
                <th>
                  {l('Зрачење', 'Irradiance')}
                  <small>W/m² · GHI</small>
                </th>
              </tr>
            </thead>
            <tbody>
              {day.hours.map((h) => {
                const w = h.weather;
                return (
                  <tr key={h.start}>
                    <th>
                      {hour(h.start)}
                      <small>
                        {(w?.resolutionHours ?? 0) > 1
                          ? l('интерполирано · ', 'interpolated · ') +
                            w!.resolutionHours +
                            ' h'
                          : '1 h'}
                      </small>
                    </th>
                    <td>
                      {n(w?.cloudLow)} / {n(w?.cloudMid)} / {n(w?.cloudHigh)}
                    </td>
                    <td>{n(w?.fogCover)}</td>
                    <td>{n(w?.humidity)}</td>
                    <td>{n(w?.windSpeed, 1)}</td>
                    <td>
                      {w?.precipitationResolutionHours === 6 ? '≈ ' : ''}
                      {n(w?.precipitationMm, 1)}
                    </td>
                    <td>
                      {n(w?.aerosolOpticalDepth, 3)} /{' '}
                      {n(w?.dustOpticalDepth, 3)}
                    </td>
                    <td>{n(w?.irradiance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <p className="forecast-fine">
          {l(
            '— = нема податок. Прашината е дел од вкупните аеросоли, не дополнителна загуба. ≈ кај врнежи значи рамномерно распределен 6-часовен вкупен износ.',
            '— = unavailable. Dust is part of total aerosols, not an additional loss. ≈ precipitation means a 6-hour total distributed evenly across its hours.',
          )}
        </p>
      </details>
    </div>
  );
}
