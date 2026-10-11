'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, FlaskConical } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useLanguage } from './language-switch';
import { getLanguage } from '@/lib/language';
import { formatNumber } from '@/lib/number-format';
import type { TrialView } from '@/lib/forecast-trial';
const l = (mk: string, en: string) => (getLanguage() === 'en' ? en : mk);
const n = (v: number | null | undefined, d = 2) =>
  formatNumber(v, d, getLanguage());
const time = (s: string, day = false) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Skopje',
    ...(day ? ({ day: '2-digit', month: '2-digit' } as const) : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(s));
export function ForecastTrialPanel({ canManage }: { canManage: boolean }) {
  useLanguage();
  const [view, setView] = useState<TrialView | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    fetch('/api/forecast-trial', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((v) => {
        if (alive) setView(v);
      })
      .catch(() => {
        if (alive)
          setError(
            l('Пробниот приказ не е достапен.', 'Trial view is unavailable.'),
          );
      });
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/forecast-trial', {
        method: canManage ? 'POST' : 'GET',
        cache: 'no-store',
      });
      if (!r.ok) throw Error();
      setView(await r.json());
      setNow(Date.now());
    } catch {
      setError(
        l(
          'Освежувањето не успеа. Последната проба е зачувана.',
          'Refresh failed. The last trial is retained.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const day = view?.dayAhead,
    intra = view?.intraday,
    point = view?.satellite.points.at(-1);
  const fresh = !!intra && now - Date.parse(intra.issuedAt) <= 15 * 60000;
  const satelliteFresh = point && now - Date.parse(point.slotTime) < 45 * 60000;
  const sum = (field: 'baselineKwh' | 'predictedKwh') =>
    day?.hours.every((h) => h[field] !== null)
      ? day.hours.reduce((s, h) => s + h[field]!, 0) / 1000
      : null;
  const statuses: Record<string, string> = {
    'insufficient-observations': l(
      'Чека две свежи Huawei мерења.',
      'Waiting for two fresh Huawei readings.',
    ),
    'stale-measurement': l(
      'Huawei мерењето е застарено.',
      'Huawei reading is stale.',
    ),
    'stale-weather': l(
      'Потребна е свежа временска прогноза.',
      'A fresh weather forecast is required.',
    ),
    'incomplete-or-stopped': l(
      'Нецелосни мерења или неактивен инвертор.',
      'Incomplete readings or an inactive inverter.',
    ),
    'low-sun': l(
      'Недоволно зрачење за стабилна корекција.',
      'Insufficient irradiance for a stable correction.',
    ),
    'unstable-measurements': l(
      'Нестабилни мерења; корекцијата е прескокната.',
      'Unstable readings; correction skipped.',
    ),
  };
  return (
    <section className="panel forecast-trial" aria-busy={busy}>
      <div className="forecast-toolbar">
        <div>
          <h2>
            <FlaskConical size={19} />{' '}
            {l('Проба на новиот модел', 'New model trial')}
          </h2>
          <p>
            {l(
              'ICON-EU + свежи Huawei мерења · споредба со v3.2',
              'ICON-EU + fresh Huawei readings · comparison with v3.2',
            )}
          </p>
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} className={busy ? 'spinning' : ''} />
          {busy
            ? l('Се пресметува…', 'Calculating…')
            : canManage
              ? l('Освежи проба', 'Refresh trial')
              : l('Освежи приказ', 'Refresh view')}
        </button>
      </div>
      {error && (
        <p role="alert" className="form-feedback error">
          {error}
        </p>
      )}
      <p className="forecast-fine">
        {l(
          'Пробните прогнози се зачувуваат пред мерењата. Подобра точност сè уште не е докажана; официјалниот модел останува v3.2.',
          'Trial forecasts are saved before measurements arrive. Improved accuracy is not yet established; the official model remains v3.2.',
        )}
      </p>
      {day ? (
        <>
          <div className="trial-totals">
            <div>
              <span>ICON-EU</span>
              <strong>
                {n(sum('predictedKwh'), 3)} <small>MWh</small>
              </strong>
            </div>
            <div>
              <span>v3.2 · {l('исти часови', 'same hours')}</span>
              <strong>
                {n(sum('baselineKwh'), 3)} <small>MWh</small>
              </strong>
            </div>
            <div>
              <span>{l('Прогноза за', 'Forecast for')}</span>
              <strong>
                {new Intl.DateTimeFormat('en-GB', {
                  timeZone: 'Europe/Skopje',
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                }).format(new Date(day.hours[0].start))}
              </strong>
            </div>
          </div>
          <p className="forecast-fine">
            {l('Зачувано', 'Saved')}: {time(day.issuedAt, true)} · DWD ICON-EU:{' '}
            {day.weatherRunAt ? time(day.weatherRunAt, true) : '—'} ·{' '}
            {l('локално време, Ресен', 'local time, Resen')}
          </p>
          <div className="trial-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={day.hours.map((h) => ({
                  label: time(h.start),
                  base: h.baselineKwh === null ? null : h.baselineKwh / 1000,
                  trial: h.predictedKwh === null ? null : h.predictedKwh / 1000,
                }))}
                margin={{ top: 10, right: 15, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="3 5"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  minTickGap={35}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                />
                <YAxis
                  width={48}
                  tickFormatter={(v) => n(v, 2)}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                  }}
                  formatter={(v) => `${n(Number(v), 3)} MWh`}
                />
                <Line
                  type="linear"
                  dataKey="base"
                  name="v3.2"
                  stroke="#82baff"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  type="linear"
                  dataKey="trial"
                  name="ICON-EU"
                  stroke="#e4a6a8"
                  strokeDasharray="6 5"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="forecast-fine">
            {l(
              'Сина: v3.2 · Испрекината црвена: ICON-EU · MWh по час',
              'Blue: v3.2 · Dashed red: ICON-EU · MWh per hour',
            )}
          </p>
        </>
      ) : (
        <p>
          {l(
            'Нема зачувана проба. Администраторот може да ја започне; потоа се обновува со постојниот распоред.',
            'No trial saved. An administrator can start it; it then follows the existing schedule.',
          )}
        </p>
      )}
      <div className="trial-details">
        <div>
          <h3>{l('Следни 15–60 минути', 'Next 15–60 minutes')}</h3>
          {intra && fresh && intra.status === 'ready' ? (
            <>
              <p className="forecast-fine">
                Huawei: {time(intra.correction!.measuredAt, true)} ·{' '}
                {l('издадено', 'issued')} {time(intra.issuedAt)}
              </p>
              <div className="trial-intervals">
                {intra.hours.map((h) => (
                  <div key={h.start}>
                    <span>
                      {time(h.start)}–{time(h.end)}
                    </span>
                    <strong>
                      {n(
                        h.predictedKwh === null ? null : h.predictedKwh / 1000,
                        3,
                      )}{' '}
                      MWh
                    </strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p>
              {intra && !fresh
                ? l(
                    'Последната краткорочна проба е застарена.',
                    'The last short-term trial is stale.',
                  )
                : (statuses[intra?.status ?? 'insufficient-observations'] ??
                  l(
                    'Недостига временска покриеност.',
                    'Weather coverage is incomplete.',
                  ))}
            </p>
          )}
          <p className="forecast-fine">
            {l(
              'Се пресметува при постојното освежување на Huawei, додека апликацијата е активна.',
              'Calculated during existing Huawei refreshes while the application is active.',
            )}
          </p>
        </div>
        <div>
          <h3>{l('Сателит · Ресен', 'Satellite · Resen')}</h3>
          {point ? (
            <>
              <p>
                <strong>{n(point.ghi, 1)} W/m²</strong> ·{' '}
                {point.quality === 'night'
                  ? l('ноќ', 'night')
                  : point.quality === 'good'
                    ? l('валиден запис', 'valid retrieval')
                    : l('одбиен квалитет', 'rejected quality')}
              </p>
              <p className="forecast-fine">
                {l('Сателитски термин', 'Satellite slot')}:{' '}
                {time(point.slotTime, true)}
                {!satelliteFresh
                  ? ' · ' +
                    l(
                      'застарено за краткорочна корекција',
                      'stale for short-term correction',
                    )
                  : ''}
                <br />
                {n(point.latitude, 2)}° N, {n(point.longitude, 2)}° E ·{' '}
                {l('дифузен дел', 'diffuse fraction')}:{' '}
                {point.diffuseFraction === null
                  ? '—'
                  : n(point.diffuseFraction * 100, 0) + '%'}
              </p>
            </>
          ) : (
            <p>
              {view?.satellite.status === 'unconfigured'
                ? l(
                    'Чека серверско поврзување со сметката.',
                    'Waiting for the server account connection.',
                  )
                : l(
                    'Сателитските податоци не се достапни.',
                    'Satellite data is unavailable.',
                  )}
            </p>
          )}
          <p className="forecast-fine">
            {l(
              'Зачувуваме зрачење и квалитет за валидација. Сателитот сè уште не ја коригира прогнозата и не следи сенки на поединечни панели.',
              'Irradiance and quality are archived for validation. Satellite data does not yet adjust forecasts or track shadows on individual panels.',
            )}
          </p>
          <a
            className="forecast-fine"
            href="https://lsa-saf.eumetsat.int/en/data/products/radiation/"
            target="_blank"
            rel="noreferrer"
          >
            EUMETSAT LSA SAF · MDSSFTD · CC BY 4.0
          </a>
        </div>
      </div>
      <h3>
        {l(
          'Проверка со подоцнежни мерења · WAPE',
          'Evaluation against later measurements · WAPE',
        )}
      </h3>
      {view?.scores.some((s) => s.hours > 0) ? (
        view.scores
          .filter((s) => s.hours > 0)
          .map((s) => (
            <p key={s.kind}>
              {s.kind === 'day-ahead'
                ? l(
                    'Ден однапред · v3.2 → ICON-EU',
                    'Day ahead · v3.2 → ICON-EU',
                  )
                : l(
                    'Краткорочно · ICON-EU → Huawei корекција',
                    'Short term · ICON-EU → Huawei correction',
                  ) +
                  ' · ' +
                  Number(s.kind.slice(-1)) * 30 +
                  '–' +
                  (Number(s.kind.slice(-1)) + 1) * 30 +
                  ' min'}
              :{' '}
              <strong>
                {n(s.baselineWape)}% → {n(s.candidateWape)}%
              </strong>{' '}
              · {s.hours}{' '}
              {s.kind === 'day-ahead'
                ? l('часа', 'hours')
                : l('интервали', 'intervals')}
            </p>
          ))
      ) : (
        <p>
          {l(
            'Нема завршени споредливи интервали. Процент ќе се појави по пристигнувањето на реалните мерења.',
            'No completed comparable intervals. A percentage will appear after actual measurements arrive.',
          )}
        </p>
      )}
      <p className="forecast-fine">
        {l(
          'Помал WAPE е подобар. Истите интервали и првата зачувана проба се споредуваат одделно по хоризонт.',
          'Lower WAPE is better. The same intervals and first saved trial are compared separately by lead time.',
        )}{' '}
        <a
          href="https://opendata.dwd.de/weather/nwp/icon-eu/"
          target="_blank"
          rel="noreferrer"
        >
          DWD ICON-EU
        </a>
      </p>
    </section>
  );
}
