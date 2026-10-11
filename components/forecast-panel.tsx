'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  CloudSun,
  RefreshCw,
  Settings2,
  ArrowUpRight,
  Info,
  CheckCircle2,
  Clock3,
} from 'lucide-react';
import {
  Area,
  Line,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useLanguage } from './language-switch';
import { useCurrency } from './currency-switch';
import { getLanguage, getLocale } from '@/lib/language';
import { convertMoney, getCurrency } from '@/lib/currency';
import { salePrice, contractFor } from '@/lib/energy';
import type { ForecastConfig, ForecastPayload } from '@/lib/forecast-model';
import { formatNumber } from '@/lib/number-format';
import { ForecastConditions } from './forecast-conditions';

type View = { config: ForecastConfig; forecast: ForecastPayload | null };
const l = (mk: string, en: string) => (getLanguage() === 'en' ? en : mk);
const number = (value: number | null | undefined, digits = 2) =>
  formatNumber(value, digits, getLanguage());
const money = (value: number | null | undefined, digits = 2) =>
  number(convertMoney(value), digits);
const percent = (value: number | null | undefined) =>
  value == null ? '—' : number(value, 1) + '%';
const date = (value: string, short = false) => {
  const d = new Date(value + 'T12:00:00Z');
  if (getLanguage() === 'mk') {
    const days = short
      ? ['нед', 'пон', 'вто', 'сре', 'чет', 'пет', 'саб']
      : [
          'недела',
          'понеделник',
          'вторник',
          'среда',
          'четврток',
          'петок',
          'сабота',
        ];
    const months = [
      'јан',
      'фев',
      'мар',
      'апр',
      'мај',
      'јун',
      'јул',
      'авг',
      'сеп',
      'окт',
      'ное',
      'дек',
    ];
    return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Skopje',
    weekday: short ? 'short' : 'long',
    day: 'numeric',
    month: 'short',
  }).format(d);
};
const time = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Skopje',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
const hour = (value: string) =>
  new Intl.DateTimeFormat(getLocale(), {
    timeZone: 'Europe/Skopje',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
function SettingsForm({
  config,
  busy,
  onSave,
}: {
  config: ForecastConfig;
  busy: boolean;
  onSave: (config: ForecastConfig) => void;
}) {
  const [values, setValues] = useState(config);
  const fields: {
    key: Exclude<keyof ForecastConfig, 'version'>;
    label: string;
    min: number;
    max: number;
    step: string;
    optional?: boolean;
  }[] = [
    {
      key: 'latitude',
      label: l('Географска ширина', 'Latitude'),
      min: -90,
      max: 90,
      step: '0.000001',
      optional: true,
    },
    {
      key: 'longitude',
      label: l('Географска должина', 'Longitude'),
      min: -180,
      max: 180,
      step: '0.000001',
      optional: true,
    },
    {
      key: 'dcKwp',
      label: l('Панели · DC kWp', 'Panels · DC kWp'),
      min: 0.1,
      max: 1000000,
      step: '0.1',
      optional: true,
    },
    {
      key: 'acKw',
      label: l('Лимит на моделот · AC kW', 'Model output cap · AC kW'),
      min: 0.1,
      max: 1000000,
      step: '0.1',
      optional: true,
    },
    {
      key: 'tilt',
      label: l('Наклон · °', 'Tilt · °'),
      min: 0,
      max: 90,
      step: '0.1',
      optional: true,
    },
    {
      key: 'azimuth',
      label: l('Азимут · 0° југ', 'Azimuth · 0° south'),
      min: -180,
      max: 180,
      step: '0.1',
      optional: true,
    },
    {
      key: 'lossPercent',
      label: l('Системски загуби · %', 'System losses · %'),
      min: 0,
      max: 50,
      step: '0.1',
    },
    {
      key: 'gamma',
      label: l(
        'Температурен коефициент · 1/°C',
        'Temperature coefficient · 1/°C',
      ),
      min: -0.01,
      max: 0,
      step: '0.0001',
    },
    { key: 'noct', label: 'NOCT · °C', min: 20, max: 70, step: '0.1' },
    {
      key: 'inverterEfficiency',
      label: l('Ефикасност на инвертер · 0–1', 'Inverter efficiency · 0–1'),
      min: 0.5,
      max: 1,
      step: '0.01',
    },
  ];
  return (
    <details className="panel forecast-settings">
      <summary>
        <Settings2 size={18} />
        {l('Поставки на прогнозата', 'Forecast settings')}
      </summary>
      <p>
        {l(
          'Внесете ги параметрите од техничката документација. Азимут: −90° исток, 0° југ, +90° запад. Празните полиња остануваат непотврдени.',
          'Enter parameters from the technical documentation. Azimuth: −90° east, 0° south, +90° west. Blank fields remain unconfirmed.',
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(values);
        }}
      >
        <div className="forecast-form-grid">
          {fields.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type="number"
                min={f.min}
                max={f.max}
                step={f.step}
                required={!f.optional}
                value={values[f.key] ?? ''}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [f.key]:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
        <p className="forecast-fine">
          {l(
            '14% загуби, −0,004/°C, NOCT 45°C и ефикасност 0,96 се почетни претпоставки, не измерени параметри. За повеќе ориентации е потребен посебен модел по група панели.',
            '14% losses, −0.004/°C, NOCT 45°C and efficiency 0.96 are initial assumptions, not measured parameters. Multiple orientations require a separate model per panel group.',
          )}
        </p>
        <p className="forecast-fine">
          {l(
            'MET Norway обезбедува облачност и температура без API клуч. Додека DC kWp, наклонот и азимутот се непотврдени, моделот користи измерен производствен профил коригиран за време. AC лимитот е горна граница, не гарантирана расположлива моќност.',
            'MET Norway supplies cloud cover and temperature without an API key. Until DC kWp, tilt and azimuth are confirmed, the model uses a weather-adjusted measured production profile. The AC cap is an upper bound, not guaranteed available power.',
          )}
        </p>
        <button className="button" disabled={busy} type="submit">
          {l('Зачувај и пресметај', 'Save and calculate')}
        </button>
      </form>
    </details>
  );
}
export function ForecastPanel({ canManage }: { canManage: boolean }) {
  useLanguage();
  useCurrency();
  const [view, setView] = useState<View | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [selected, setSelected] = useState(''),
    [checkedAt, setCheckedAt] = useState(() => Date.now());
  const load = useCallback(
    () =>
      fetch('/api/forecast')
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw Error(body.error);
          return body as View;
        })
        .then((body) => {
          setView(body);
          setCheckedAt(Date.now());
          setError('');
        })
        .catch(() =>
          setError(
            l(
              'Прогнозата не е достапна. Обидете се повторно.',
              'Forecast unavailable. Please retry.',
            ),
          ),
        )
        .finally(() => setLoading(false)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function update(config?: ForecastConfig) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          config ? { action: 'configure', config } : { action: 'refresh' },
        ),
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.error);
      setView(body);
      setCheckedAt(Date.now());
    } catch (e) {
      setError(
        getLanguage() === 'en'
          ? 'Calculation failed. Your last saved forecast remains available. Please retry.'
          : e instanceof Error
            ? e.message
            : 'Пресметката не успеа.',
      );
    } finally {
      setBusy(false);
    }
  }
  const forecast = view?.forecast,
    day = forecast?.days.find((d) => d.date === selected) ?? forecast?.days[0];
  const contract = contractFor(
    day?.date ?? new Date().toISOString(),
    forecast?.contracts,
  );
  const stale =
    !!forecast &&
    (checkedAt - Date.parse(forecast.issuedAt) > 24 * 3600000 ||
      forecast.config.version !== view?.config.version);
  const weatherOnly =
    !!day &&
    day.hours.every(
      (h) =>
        h.productionSource === 'weather' ||
        h.productionSource === 'weather-history',
    );
  const rows =
    day?.hours.map((h) => ({
      label: hour(h.start),
      start: h.start,
      production: h.productionKwh === null ? null : h.productionKwh / 1000,
      revenue: convertMoney(h.revenueEur),
      power: h.powerKw,
      cloud: h.weather?.cloudCover ?? null,
      price: convertMoney(h.memo),
      official: h.priceSource === 'official' ? convertMoney(h.memo) : null,
      estimate: h.priceSource === 'forecast' ? convertMoney(h.memo) : null,
    })) ?? [];
  const tooltip = {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    color: 'var(--foreground)',
  };
  return (
    <div className="forecast-page" aria-busy={busy || loading}>
      <div className="forecast-toolbar">
        <span className="forecast-label">
          <CloudSun size={18} />
          {l('Експериментален модел · 7 дена', 'Experimental model · 7 days')}
        </span>
        <button
          type="button"
          className="button secondary"
          disabled={busy || loading}
          onClick={() => (canManage ? void update() : void load())}
        >
          <RefreshCw size={16} className={busy ? 'spinning' : ''} />
          {busy
            ? l('Се пресметува…', 'Calculating…')
            : canManage
              ? l('Пресметај прогноза', 'Calculate forecast')
              : l('Освежи приказ', 'Refresh view')}
        </button>
      </div>
      {error && (
        <div className="form-feedback error" role="alert">
          {error}
          <button type="button" onClick={() => void load()}>
            {l('Повтори', 'Retry')}
          </button>
        </div>
      )}
      {stale && (
        <output className="forecast-notice warning">
          <Clock3 size={18} />
          {l(
            'Оваа прогноза е стара или поставките се променети. Проверете нова пресметка пред користење.',
            'This forecast is old or its settings have changed. Check a new calculation before use.',
          )}
        </output>
      )}
      {!forecast ? (
        <section className="panel forecast-empty">
          <CloudSun size={38} />
          <h2>
            {loading
              ? l('Се вчитува прогнозата…', 'Loading forecast…')
              : l(
                  'Првата прогноза се подготвува',
                  'The first forecast is being prepared',
                )}
          </h2>
          <p>
            {canManage
              ? l(
                  'Пресметајте прогноза од зачуваната историја или дополнете ги поставките за временскиот модел.',
                  'Calculate from saved history or complete the weather model settings.',
                )
              : l(
                  'Прогнозата ќе се појави по следната серверска пресметка.',
                  'The forecast will appear after the next server calculation.',
                )}
          </p>
        </section>
      ) : (
        <>
          <div className="forecast-meta">
            <span>
              {l('Пресметано', 'Calculated')}: {time(forecast.issuedAt)}
            </span>
            <span>{l('Локално време · Ресен', 'Local time · Resen')}</span>
            <span>
              {l(
                'Автоматски: 08:20 · 12:20 · 18:20',
                'Automatic: 08:20 · 12:20 · 18:20',
              )}
            </span>
          </div>
          {forecast.warnings.includes('history-production') && (
            <div className="forecast-notice">
              <Info size={20} />
              <div>
                <strong>
                  {l(
                    'Производството е историска референца',
                    'Production is a historical reference',
                  )}
                </strong>
                <p>
                  {l(
                    'Се користи медијана од последните целосни денови. Облачноста за идните денови сè уште не е вклучена; приходот е сценарио, не гарантирана заработка.',
                    'Uses the median of recent complete days. Future cloud cover is not yet included; revenue is a scenario, not guaranteed earnings.',
                  )}
                </p>
              </div>
            </div>
          )}
          {forecast.warnings.includes('modeled-radiation') && (
            <div className="forecast-notice">
              <CloudSun size={20} />
              <div>
                <strong>
                  {l(
                    'Прогнозирано сончево зрачење · NOAA GFS',
                    'Forecast solar irradiance · NOAA GFS',
                  )}
                </strong>
                <p>
                  {l(
                    'Производството го користи прогнозираното зрачење на површината, температурата и ветерот, со одзив од последните целосни дневни Huawei мерења. Зрачењето е во тричасовни интервали, распределено по час според положбата на сонцето. Локалните облаци и сенки сè уште можат да предизвикаат отстапувања.',
                    'Production uses forecast surface irradiance, temperature and wind, with a response fitted to recent complete daylight Huawei readings. Three-hour irradiance intervals are allocated to hours using solar position. Local clouds and shading can still cause errors.',
                  )}
                </p>
              </div>
            </div>
          )}
          {forecast.warnings.includes('estimated-radiation') && (
            <div className="forecast-notice">
              <CloudSun size={20} />
              <div>
                <strong>
                  {l(
                    'Процена од облачност за часови без директна прогноза за зрачење',
                    'Cloud-based estimate where irradiance forecasts are unavailable',
                  )}
                </strong>
                <p>
                  {l(
                    'За секој час се пресметуваат сончевото зрачење, очекуваната моќност и приходот. Зрачењето е проценето од облачноста и положбата на сонцето; производствениот одзив е изведен од Huawei мерењата. Ова е почетен модел, без потврдена точност.',
                    'Solar irradiance, expected power and revenue are calculated for each hour. Irradiance is estimated from cloud cover and the sun’s position; the production response is derived from Huawei readings. This is an initial model with accuracy still to be established.',
                  )}
                </p>
              </div>
            </div>
          )}
          <fieldset
            className="forecast-days"
            aria-label={l('Изберете ден за прогноза', 'Select forecast day')}
          >
            {forecast.days.map((d) => (
              <button
                type="button"
                key={d.date}
                className={
                  'forecast-day ' + (d.date === day?.date ? 'selected' : '')
                }
                aria-pressed={d.date === day?.date}
                onClick={() => setSelected(d.date)}
              >
                <span>{date(d.date, true)}</span>
                <strong>
                  <span className="forecast-approx">≈ </span>
                  {money(d.revenueEur, 0)} <small>{getCurrency()}</small>
                </strong>
                <span>
                  {number(
                    d.productionKwh === null ? null : d.productionKwh / 1000,
                  )}{' '}
                  MWh
                </span>
                <span className="forecast-day-weather">
                  <CloudSun size={14} /> {number(d.daylightCloudCover, 0)}%{' '}
                  {l('облачност', 'cloud cover')}
                </span>
                <small
                  className={
                    d.officialHours === d.hours.length
                      ? 'forecast-official'
                      : ''
                  }
                >
                  {d.officialHours === d.hours.length
                    ? l('Официјална цена', 'Official price')
                    : l('Проценета цена', 'Estimated price')}
                </small>
              </button>
            ))}
          </fieldset>
          {forecast.warnings.some((w) => w.startsWith('missing-')) && (
            <div className="forecast-notice warning">
              <Info size={18} />
              {l(
                'За дел од пресметките недостигаат временски податоци, технички параметри, мерења или цени. Не се заменуваат со повторен историски просек или нула.',
                'Some calculations lack weather, technical settings, readings or prices. These are not replaced with a repeated historical average or zero.',
              )}
            </div>
          )}
          {day && (
            <>
              <section className="panel forecast-detail">
                <div className="panel-heading">
                  <div>
                    <h2>{date(day.date)}</h2>
                    <p>
                      {weatherOnly
                        ? l(
                            'Временска прогноза → моќност → производство → приход',
                            'Weather forecast → power → production → revenue',
                          )
                        : l(
                            'Нецелосна временска прогноза или производствен модел',
                            'Incomplete weather forecast or production model',
                          )}
                    </p>
                  </div>
                  <span className="small-pill">
                    {day.hours.length} {l('часа', 'hours')}
                  </span>
                </div>
                <div className="forecast-metrics">
                  <div>
                    <span>{l('Производство', 'Production')}</span>
                    <strong>
                      ≈{' '}
                      {number(
                        day.productionKwh === null
                          ? null
                          : day.productionKwh / 1000,
                      )}{' '}
                      <small>MWh</small>
                    </strong>
                  </div>
                  <div>
                    <span>{l('Проценет приход', 'Estimated revenue')}</span>
                    <strong>
                      ≈ {money(day.revenueEur)} <small>{getCurrency()}</small>
                    </strong>
                  </div>
                  <div>
                    <span>{l('Просечна MEMO цена', 'Mean MEMO price')}</span>
                    <strong>
                      {money(day.meanPrice)} <small>{getCurrency()}/MWh</small>
                    </strong>
                  </div>
                  <div>
                    <span>
                      {l(
                        'Цена пондерирана со испорака',
                        'Export-weighted price',
                      )}
                    </span>
                    <strong>
                      {money(day.capturePrice)}{' '}
                      <small>{getCurrency()}/MWh</small>
                    </strong>
                  </div>
                </div>
                <div className="forecast-chart-title">
                  <h3>
                    {l('Производство и приход', 'Production and revenue')}
                  </h3>
                  <span>
                    {l(
                      'Испрекината линија = процена',
                      'Dashed line = estimate',
                    )}
                  </span>
                </div>
                <div className="forecast-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={rows}
                      margin={{ top: 15, right: 4, left: 0, bottom: 10 }}
                    >
                      <defs>
                        <linearGradient
                          id="forecast-green"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="var(--chart-green)"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="100%"
                            stopColor="var(--chart-green)"
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        vertical={false}
                        stroke="var(--chart-grid)"
                        strokeDasharray="3 5"
                      />
                      <XAxis
                        dataKey="label"
                        minTickGap={25}
                        tick={{ fill: 'var(--chart-label)', fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        yAxisId="energy"
                        width={49}
                        tick={{ fill: 'var(--chart-label)', fontSize: 10 }}
                        tickFormatter={(v) => number(v, 1)}
                        tickLine={false}
                        axisLine={false}
                        label={{
                          value: 'MWh',
                          position: 'insideTopLeft',
                          fill: 'var(--chart-green)',
                          fontSize: 10,
                        }}
                      />
                      <YAxis
                        yAxisId="revenue"
                        orientation="right"
                        width={55}
                        tick={{ fill: 'var(--chart-label)', fontSize: 10 }}
                        tickFormatter={(v) => number(v, 0)}
                        tickLine={false}
                        axisLine={false}
                        label={{
                          value: getCurrency(),
                          position: 'insideTopRight',
                          fill: 'var(--chart-blue)',
                          fontSize: 10,
                        }}
                      />
                      <Tooltip
                        contentStyle={tooltip}
                        formatter={(value, name) => [
                          number(typeof value === 'number' ? value : null),
                          name,
                        ]}
                      />
                      <Area
                        yAxisId="energy"
                        dataKey="production"
                        name={l('Производство · MWh', 'Production · MWh')}
                        type="monotone"
                        stroke="var(--chart-green)"
                        strokeDasharray="6 4"
                        fill="url(#forecast-green)"
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="revenue"
                        dataKey="revenue"
                        name={l('Приход · ', 'Revenue · ') + getCurrency()}
                        type="monotone"
                        stroke="var(--chart-blue)"
                        strokeDasharray="6 4"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="forecast-chart-title">
                  <h3>{l('Часовни MEMO цени', 'Hourly MEMO prices')}</h3>
                  <span>
                    {day.officialHours}/{day.hours.length}{' '}
                    {l('објавени', 'published')} · {getCurrency()}/MWh
                  </span>
                </div>
                <div className="forecast-chart forecast-price-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={rows}
                      margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                    >
                      <CartesianGrid
                        vertical={false}
                        stroke="var(--chart-grid)"
                        strokeDasharray="3 5"
                      />
                      <XAxis
                        dataKey="label"
                        minTickGap={25}
                        tick={{ fill: 'var(--chart-label)', fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        width={49}
                        tick={{ fill: 'var(--chart-label)', fontSize: 10 }}
                        tickFormatter={(v) => number(v, 0)}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={tooltip}
                        formatter={(value, name) => [
                          number(typeof value === 'number' ? value : null) +
                            ' ' +
                            getCurrency() +
                            '/MWh',
                          name,
                        ]}
                      />
                      <ReferenceLine
                        y={convertMoney(contract.fixedEurMwh / contract.share)!}
                        stroke="var(--muted-foreground)"
                        strokeDasharray="2 5"
                      />
                      <Line
                        dataKey="official"
                        name={l('Официјална MEMO цена', 'Official MEMO price')}
                        stroke="var(--chart-green)"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        dataKey="estimate"
                        name={l('Прогноза на цена', 'Price forecast')}
                        stroke="var(--chart-blue)"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="forecast-fine">
                  {l(
                    'Праг за негативна продажна цена',
                    'Negative selling-price threshold',
                  )}
                  : {money(contract.fixedEurMwh / contract.share)}{' '}
                  {getCurrency()}/MWh · {day.negativeSaleHours}{' '}
                  {l('часа под прагот.', 'hours below the threshold.')}{' '}
                  {l(
                    'Приход = испорачани MWh × (MEMO × 0,94 −',
                    'Revenue = exported MWh × (MEMO × 0.94 −',
                  )}{' '}
                  {money(contract.fixedEurMwh)} {getCurrency()}/MWh).{' '}
                </p>
              </section>
              {forecast.pricingAdjusted && (
                <p className="forecast-fine">
                  {l(
                    'Приходот е коригиран според договорот што важи од 01.10.2026; зачуваната прогноза за производство останува иста.',
                    'Revenue is adjusted for the contract effective 1 October 2026; the saved production forecast is unchanged.',
                  )}
                </p>
              )}
              <section className="panel forecast-conditions">
                <div className="panel-heading">
                  <div>
                    <h2>
                      {l(
                        'Времето и моќноста по час',
                        'Weather and hourly power',
                      )}
                    </h2>
                    <p>
                      {l(
                        'Како условите го менуваат очекуваното производство.',
                        'How conditions change expected production.',
                      )}
                    </p>
                  </div>
                  <CloudSun size={22} />
                </div>
                <div className="forecast-metrics">
                  <div>
                    <span>
                      {l(
                        'Највисока просечна часовна моќност',
                        'Highest hourly average power',
                      )}
                    </span>
                    <strong>
                      ≈ {number(day.peakPowerKw, 0)} <small>kW</small>
                    </strong>
                  </div>
                  <div>
                    <span>
                      {l(
                        'Облачност во дневните часови',
                        'Daylight cloud cover',
                      )}
                    </span>
                    <strong>
                      {number(day.daylightCloudCover, 0)} <small>%</small>
                    </strong>
                  </div>
                  <div>
                    <span>
                      {l('Горна граница на моделот', 'Model output cap')}
                    </span>
                    <strong>
                      {number(forecast.config.acKw, 0)} <small>kW AC</small>
                    </strong>
                  </div>
                  <div>
                    <span>
                      {l(
                        'Денови за производствениот одзив',
                        'Production-response history',
                      )}
                    </span>
                    <strong>
                      {forecast.calibration?.days ?? forecast.historyDays}{' '}
                      <small>
                        {l(
                          'дена со целосни сончеви часови',
                          'days with complete daylight hours',
                        )}
                      </small>
                    </strong>
                  </div>
                </div>
                <div className="forecast-chart-title">
                  <h3>{l('Очекувана моќност · kW', 'Expected power · kW')}</h3>
                  <span>{l('Облачност · %', 'Cloud cover · %')}</span>
                </div>
                <div className="forecast-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={rows}
                      margin={{ top: 12, right: 2, bottom: 6, left: 0 }}
                    >
                      <CartesianGrid
                        stroke="var(--border)"
                        strokeDasharray="3 6"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        minTickGap={25}
                        tick={{ fill: 'var(--chart-label)', fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        yAxisId="power"
                        width={44}
                        tick={{ fill: 'var(--chart-green)', fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        yAxisId="cloud"
                        orientation="right"
                        domain={[0, 100]}
                        width={38}
                        tickFormatter={(v) => v + '%'}
                        tick={{ fill: 'var(--chart-blue)', fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={tooltip}
                        formatter={(value, name) => [
                          number(typeof value === 'number' ? value : null, 1) +
                            (name === l('Облачност', 'Cloud cover')
                              ? '%'
                              : ' kW'),
                          name,
                        ]}
                      />
                      <Area
                        yAxisId="power"
                        type="monotone"
                        dataKey="power"
                        name={l('Моќност', 'Power')}
                        stroke="var(--chart-green)"
                        fill="var(--chart-green)"
                        fillOpacity={0.12}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="cloud"
                        type="linear"
                        dataKey="cloud"
                        name={l('Облачност', 'Cloud cover')}
                        stroke="var(--chart-blue)"
                        strokeDasharray="5 4"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="forecast-fine">
                  {l(
                    'kW е просечна моќност во часот, не моментален врв. Подоцнежните временски точки се со чекор до 6 часа и се интерполираат. Границата од инвертерите не предвидува дефекти, исклучувања, снег или ограничувања од мрежата.',
                    'kW is average power over the hour, not an instantaneous peak. Later weather points are spaced up to 6 hours apart and interpolated. The inverter cap does not predict faults, shutdowns, snow or grid curtailment.',
                  )}
                </p>
                <ForecastConditions
                  day={day}
                  source={forecast.weather.atmosphere}
                />
              </section>
              <details className="panel forecast-hourly">
                <summary>
                  {l(
                    'Часовна пресметка на прогнозата',
                    'Hourly forecast calculation',
                  )}
                </summary>
                <div className="forecast-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{l('Час', 'Hour')}</th>
                        <th>MWh</th>
                        <th>kW</th>
                        <th>{l('Облачност', 'Cloud cover')} %</th>
                        <th>°C</th>
                        <th>
                          {l('Зрачење', 'Irradiance')} W/m²
                          <small>
                            {forecast.weather.provider === 'met-norway'
                              ? l('проценето GHI', 'estimated GHI')
                              : 'GTI'}
                          </small>
                        </th>
                        <th>MEMO {getCurrency()}/MWh</th>
                        <th>{l('Ваша цена', 'Your price')}</th>
                        <th>
                          {l('Приход', 'Revenue')} {getCurrency()}
                        </th>
                        <th>{l('Извор на цена', 'Price source')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.hours.map((h) => (
                        <tr key={h.start}>
                          <th>
                            {hour(h.start)}
                            <small>
                              {new Date(h.start).toISOString().slice(11, 16)}{' '}
                              UTC
                            </small>
                          </th>
                          <td>
                            {number(
                              h.productionKwh === null
                                ? null
                                : h.productionKwh / 1000,
                              3,
                            )}
                          </td>
                          <td>{number(h.powerKw, 0)}</td>
                          <td>{number(h.weather?.cloudCover, 0)}</td>
                          <td>{number(h.weather?.temperature, 1)}</td>
                          <td>{number(h.weather?.irradiance, 0)}</td>
                          <td>{money(h.memo)}</td>
                          <td>
                            {money(
                              h.memo === null
                                ? null
                                : salePrice(
                                    h.memo,
                                    h.start,
                                    forecast?.contracts,
                                  ),
                            )}
                          </td>
                          <td>{money(h.revenueEur)}</td>
                          <td>
                            {h.priceSource === 'official'
                              ? l('MEMO · објавено', 'MEMO · published')
                              : h.priceSource === 'forecast'
                                ? l('Модел', 'Model')
                                : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
          <section className="panel forecast-validation">
            <div className="panel-heading">
              <div>
                <h2>
                  {l(
                    'Колку е проверен моделот?',
                    'How well has the model been tested?',
                  )}
                </h2>
                <p>
                  {l(
                    'Реални грешки, без ветување за 100% точност.',
                    'Measured errors, without a promise of 100% accuracy.',
                  )}
                </p>
              </div>
              <CheckCircle2 size={22} />
            </div>
            <div className="forecast-validation-grid">
              <div>
                <span>
                  {l(
                    'Ретроспективна проверка · цена',
                    'Retrospective test · price',
                  )}
                </span>
                <strong>
                  {money(forecast.priceScores[0]?.mae)}{' '}
                  <small>{getCurrency()}/MWh MAE</small>
                </strong>
                <p>
                  {l(
                    'Фиксен модел 50% последен ден + 50% ист ден во неделата. Последни 56 дена; секој тест користи само претходни денови. Историските цени може да содржат подоцнежни исправки.',
                    'Fixed model: 50% last day + 50% same weekday. Last 56 days; each test uses only earlier days. Historical prices may include later revisions.',
                  )}
                </p>
              </div>
              <div>
                <span>
                  {l(
                    'Проверка по објавување на прогнозите',
                    'Evaluation after forecast publication',
                  )}
                </span>
                <strong>
                  {forecast.liveScore.hours
                    ? money(forecast.liveScore.mae)
                    : '—'}{' '}
                  <small>{getCurrency()}/MWh MAE</small>
                </strong>
                <p>
                  {forecast.liveScore.hours}{' '}
                  {l(
                    'проверени часовни прогнози. Се споредува првата зачувана прогноза за секој час со објавената MEMO цена.',
                    'verified hourly forecasts. Compares the first saved forecast for each hour with the published MEMO price.',
                  )}
                </p>
              </div>
            </div>
            <div className="forecast-production-score">
              <strong>
                {l('Часовна грешка — WAPE', 'Hourly error — WAPE')}:{' '}
                {percent(forecast.productionScore?.wape)} ·{' '}
                {number(forecast.productionScore?.mae, 1)} kWh MAE
              </strong>
              <p className="forecast-fine">
                {l('Основен → коригиран модел', 'Baseline → corrected model')}:{' '}
                {percent(forecast.productionScore?.baselineWape)} →{' '}
                {percent(forecast.productionScore?.wape)} WAPE
              </p>
              <p className="forecast-fine">
                {forecast.productionScore?.hours ?? 0}{' '}
                {l(
                  'споредени часови од однапред зачувани GFS прогнози за следниот ден, од оваа верзија и поставки. Основниот и коригираниот модел се оценуваат на истите Huawei мерења. Ноќните двојни нули се исклучени.',
                  'paired hours from GFS day-ahead forecasts saved in advance, from this version and configuration. Baseline and corrected models use identical Huawei measurements. Nighttime double zeros are excluded.',
                )}
              </p>
            </div>
            {forecast.hourlyCalibration && (
              <div className="forecast-production-score">
                <strong>
                  {l('Цел: помал часовен WAPE', 'Target: lower hourly WAPE')}
                </strong>
                <p className="forecast-fine">
                  {forecast.hourlyCalibration.status === 'accepted'
                    ? l(
                        'Активна корекција за утре',
                        'Day-ahead correction active',
                      )
                    : l(
                        'Основен модел; корекцијата сè уште не ја поминала проверката',
                        'Baseline model; correction has not passed validation',
                      )}
                  {' · ×'}
                  {number(forecast.hourlyCalibration.factor, 3)}
                </p>
                <p className="forecast-fine">
                  {l(
                    'Проверка по редослед на деновите',
                    'Rolling chronological validation',
                  )}
                  :{' '}
                  {percent(forecast.hourlyCalibration.validation.baselineWape)}{' '}
                  →{' '}
                  {percent(forecast.hourlyCalibration.validation.candidateWape)}{' '}
                  WAPE
                  {' · '}
                  {forecast.hourlyCalibration.validation.days}{' '}
                  {l('дена', 'days')},{' '}
                  {forecast.hourlyCalibration.validation.hours}{' '}
                  {l('часа', 'hours')}
                </p>
                <p className="forecast-fine">
                  {l(
                    'Корекцијата учи од апсолутните часовни грешки. Се применува само ако претходната проверка го намали WAPE за најмалку 2% релативно. Не гарантира подобрување секој ден.',
                    'The correction learns from absolute hourly errors. It is applied only when prior validation reduces WAPE by at least 2% relatively. It does not guarantee improvement every day.',
                  )}{' '}
                  {forecast.hourlyCalibration.source !== 'prospective' &&
                    l(
                      'Проверката вклучува историски симулации; потребна е и проверка на нови, однапред издадени прогнози.',
                      'Validation includes historical simulations; new forecasts issued in advance still need to be evaluated.',
                    )}
                </p>
              </div>
            )}
            <details>
              <summary>
                {l(
                  'Грешка по хоризонт · 1–7 дена',
                  'Error by horizon · 1–7 days',
                )}
              </summary>
              <div className="forecast-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{l('Дена однапред', 'Days ahead')}</th>
                      <th>{l('Тестирани дена', 'Test days')}</th>
                      <th>MAE</th>
                      <th>RMSE</th>
                      <th>{l('MAE дневен просек', 'Daily mean MAE')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.priceScores.map((s) => (
                      <tr key={s.lead}>
                        <th>{s.lead}</th>
                        <td>{s.days}</td>
                        <td>{money(s.mae)}</td>
                        <td>{money(s.rmse)}</td>
                        <td>{money(s.dailyMeanMae)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <p className="forecast-fine">
              {l(
                'MAE е просечна апсолутна грешка во цена; помала е подобро. Нема калибриран интервал на доверба. Производството и приходот сè уште немаат потврдена точност.',
                'MAE is mean absolute price error; lower is better. No calibrated confidence interval is available. Production and revenue accuracy has not yet been established.',
              )}
            </p>
          </section>
          <section className="panel forecast-sources">
            <h2>{l('Извори и свежина', 'Sources and freshness')}</h2>
            <dl>
              <div>
                <dt>MEMO</dt>
                <dd>
                  {forecast.history.priceHours}{' '}
                  {l('часовни цени', 'hourly prices')} ·{' '}
                  <a
                    href="https://dam-data.memo.mk/index.php?action=auction-by-hour&lang=en"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {l('Извор', 'Source')} <ArrowUpRight size={12} />
                  </a>
                </dd>
              </div>
              <div>
                <dt>Huawei</dt>
                <dd>
                  {forecast.calibration?.days ?? forecast.historyDays}{' '}
                  {l('дена за сончевиот одзив', 'days for solar response')} ·{' '}
                  {forecast.history.latestReading
                    ? time(forecast.history.latestReading)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>
                  <a
                    href={
                      forecast.weather.provider === 'met-norway'
                        ? 'https://www.met.no/'
                        : 'https://open-meteo.com/'
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {forecast.weather.provider === 'met-norway'
                      ? 'MET Norway / ECMWF'
                      : 'Open-Meteo'}{' '}
                    <ArrowUpRight size={12} />
                  </a>
                </dt>
                <dd>
                  {forecast.weather.status === 'ready'
                    ? l('Поврзано', 'Connected')
                    : forecast.weather.status === 'failed'
                      ? l('Изворот не одговори', 'Provider unavailable')
                      : l('Недостасува GPS-локација', 'Missing GPS location')}
                  {forecast.weather.fetchedAt
                    ? ' · ' + time(forecast.weather.fetchedAt)
                    : ''}
                </dd>
              </div>
              <div>
                <dt>{l('Модел', 'Model')}</dt>
                <dd>{forecast.version}</dd>
              </div>
              {forecast.weather.radiation && (
                <div>
                  <dt>
                    <a
                      href="https://thredds.ucar.edu/thredds/catalog/grib/NCEP/GFS/Global_0p25deg/catalog.html"
                      target="_blank"
                      rel="noreferrer"
                    >
                      NOAA GFS · UCAR <ArrowUpRight size={12} />
                    </a>
                  </dt>
                  <dd>
                    {forecast.weather.radiation.status === 'ready' ? (
                      <>
                        {l('Издадено', 'Issued')}:{' '}
                        {time(forecast.weather.radiation.issuedAt!)}
                        <br />
                        {l('Мрежна точка', 'Grid point')}:{' '}
                        {number(forecast.weather.radiation.latitude, 3)},{' '}
                        {number(forecast.weather.radiation.longitude, 3)} ·
                        0.25°
                      </>
                    ) : (
                      l(
                        'Нема свежо зрачење; се користи процена од облачност.',
                        'No fresh irradiance; using a cloud-based estimate.',
                      )
                    )}
                  </dd>
                </div>
              )}
              {forecast.weather.provider === 'met-norway' && (
                <div>
                  <dt>
                    <a
                      href="https://silam.fmi.fi/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      FMI SILAM <ArrowUpRight size={12} />
                    </a>
                  </dt>
                  <dd>
                    {forecast.weather.atmosphere?.status === 'ready' ? (
                      <>
                        {l('Издадено', 'Issued')}:{' '}
                        {time(forecast.weather.atmosphere.issuedAt!)}
                        <br />
                        {l('Мрежна точка', 'Grid point')}:{' '}
                        {number(forecast.weather.atmosphere.latitude, 3)},{' '}
                        {number(forecast.weather.atmosphere.longitude, 3)} ·
                        0.2°
                      </>
                    ) : (
                      l('Нема свежи податоци', 'No fresh data')
                    )}
                  </dd>
                </div>
              )}
              <div>
                <dt>{l('Испорака / производство', 'Export / production')}</dt>
                <dd>
                  {number(
                    forecast.exportRatio === null
                      ? null
                      : forecast.exportRatio * 100,
                    1,
                  )}
                  % · {l('од спарени мерења', 'from paired measurements')}
                </dd>
              </div>
            </dl>
            {forecast.weather.provider === 'met-norway' && (
              <p className="forecast-fine">
                {l('Временски податоци', 'Weather data')}: MET Norway ·{' '}
                <a
                  href="https://creativecommons.org/licenses/by/4.0/"
                  target="_blank"
                  rel="noreferrer"
                >
                  CC BY 4.0
                </a>
                .{' '}
                {l(
                  'Температурата и временските услови се интерполирани. Зрачењето е од NOAA GFS кога е достапно, инаку е наша процена од облачност; производството е наша пресметка. MET издадено',
                  'Temperature and weather conditions are interpolated. Irradiance comes from NOAA GFS where available, otherwise from our cloud estimate; production is our calculation. MET issued',
                )}
                :{' '}
                {forecast.weather.issuedAt
                  ? time(forecast.weather.issuedAt)
                  : '—'}
                . {l('Атмосферски податоци', 'Atmospheric data')}: Finnish
                Meteorological Institute (SILAM),{' '}
                <a
                  href="https://en.ilmatieteenlaitos.fi/open-data-licence"
                  target="_blank"
                  rel="noreferrer"
                >
                  CC BY 4.0
                </a>
                .{' '}
                {l(
                  'Ефектот од аеросоли е експериментална процена со Solis, според референтен AOD 0.1. Параметрите за атмосфера и ладење се општи, сè уште не се калибрирани за оваа централа.',
                  'The aerosol effect is an experimental Solis estimate against reference AOD 0.1. Atmospheric and cooling parameters are generic and have not yet been calibrated for this plant.',
                )}
              </p>
            )}
            <p className="forecast-fine">
              {l(
                'Официјалните цени се објавени факти; производството и приходот за идните денови остануваат процени. Овој модул не ја вклучува и исклучува централата.',
                'Official prices are published facts; future production and revenue remain estimates. This module does not switch the plant on or off.',
              )}
            </p>
          </section>
        </>
      )}
      {canManage && view && (
        <SettingsForm
          key={view.config.version}
          config={view.config}
          busy={busy}
          onSave={(config) => void update(config)}
        />
      )}
    </div>
  );
}
