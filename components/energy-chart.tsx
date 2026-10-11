'use client';
import { convertMoney, getCurrency } from '@/lib/currency';
import { useCurrency } from '@/components/currency-switch';
import { t, getLocale } from '@/lib/language';
import { useLanguage } from '@/components/language-switch';
import { useIsMobile } from '@/hooks/use-mobile';

import { useEffect, useId, useState } from 'react';
import { Activity, ArrowUpRight, ChartColumn, ChartLine } from 'lucide-react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toMwh } from '@/lib/energy-report';
import type { Period } from '@/lib/energy';
import type { getDashboard } from '@/lib/solar-server';

type Data = Awaited<ReturnType<typeof getDashboard>>;
type ChartMode = 'line' | 'column';
const formatValue = (value: number) =>
  new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
const preferenceKey = 'zis-solar-energy-chart';
const tooltipStyle = {
  borderRadius: 10,
  borderColor: 'var(--border)',
  backgroundColor: 'var(--card)',
  color: 'var(--foreground)',
  fontSize: 14,
};

function UnitTick({
  x = 0,
  y = 0,
  payload,
  unit,
  energy = false,
}: {
  x?: number;
  y?: number;
  payload?: { value: number | string };
  unit: string;
  energy?: boolean;
}) {
  const value = Number(payload?.value ?? 0);
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor={energy ? 'end' : 'start'}
      fill={energy ? 'var(--chart-label)' : 'var(--chart-blue)'}
      fontSize={11}
    >
      <tspan>
        {energy
          ? formatValue(value)
          : new Intl.NumberFormat(getLocale(), {
              maximumFractionDigits: 2,
            }).format(value)}
      </tspan>
      <tspan dx={3} fontSize={8} opacity={0.75}>
        {unit}
      </tspan>
    </text>
  );
}

function EmptyChart({ onConnect }: { onConnect?: () => void }) {
  useLanguage();
  useCurrency();
  return (
    <div className="empty-chart">
      <div className="grid-lines">
        {t([0, 1, 2, 3].map((i) => <div key={i} />))}
      </div>
      <div className="empty-message">
        <span className="empty-icon">
          <Activity size={25} />
        </span>
        <strong>{t('Вашиот енергетски преглед започнува тука')}</strong>
        <p>{t('Графикот ќе се пополни со првите мерења.')}</p>
        {t(
          onConnect && (
            <button className="text-button" onClick={onConnect}>
              {t('Внеси податоци од централата ')}
              <ArrowUpRight size={15} />
            </button>
          ),
        )}
      </div>
      <div className="chart-axis">
        {t(
          ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'].map(
            (hour) => <span key={hour}>{t(hour)}</span>,
          ),
        )}
      </div>
    </div>
  );
}

export function EnergyChart({
  data,
  period,
  onConnect,
}: {
  data: Data | null;
  period: Period;
  onConnect?: () => void;
}) {
  useLanguage();
  useCurrency();
  const [mode, setMode] = useState<ChartMode>('line');
  const mobile = useIsMobile();
  const gradientId = useId();
  useEffect(() => {
    try {
      if (
        ['column', 'candle'].includes(localStorage.getItem(preferenceKey) ?? '')
      )
        setMode('column');
    } catch {}
  }, []);
  const chooseMode = (next: ChartMode) => {
    setMode(next);
    try {
      localStorage.setItem(preferenceKey, next);
    } catch {}
  };
  const grouping =
    period === 'year'
      ? t('По месец')
      : period === 'month'
        ? t('По ден')
        : t('По час');
  const hasLine = data?.chart.some(
    (point) =>
      point.productionKwh !== null ||
      point.revenue !== null ||
      point.forecastProductionKwh != null,
  );
  const comparison = data?.forecastComparison;

  return (
    <section className="panel chart-panel">
      <div className="panel-heading energy-chart-heading">
        <div>
          <h2>{t('Производство и приход')}</h2>
          <p>{t('Енергијата низ времето, претворена во вредност.')}</p>
        </div>
        <div className="energy-chart-actions">
          <div
            className="chart-view-switch"
            role="group"
            aria-label={t('Тип на график')}
          >
            <button
              type="button"
              aria-pressed={mode === 'line'}
              onClick={() => chooseMode('line')}
            >
              <ChartLine size={16} />
              {t('Линиски')}
            </button>
            <button
              type="button"
              aria-pressed={mode === 'column'}
              onClick={() => chooseMode('column')}
            >
              <ChartColumn size={16} />
              {t('Столбест')}
            </button>
          </div>
          <span className="small-pill">{t(grouping)}</span>
        </div>
      </div>
      <>
        <div className="chart-legend">
          <span>
            <i className="legend-line green-line" />
            {t('Производство · MWh')}
          </span>
          <span>
            <i className="legend-line blue-line" />
            {t('Приход · EUR')}
          </span>
          <span>
            <i className="legend-line forecast-line" />
            {t('Прогнозирано производство · MWh')}
          </span>
        </div>
        {comparison && (
          <p className="forecast-comparison-note">
            {t(
              comparison.status === 'unavailable'
                ? 'Споредбата со прогнозата моментално не е достапна.'
                : comparison.status === 'missing'
                  ? 'За овој период нема однапред зачувана временска прогноза за производство.'
                  : 'Првата зачувана прогноза пред секој час. Празнините означуваат недостасувачка прогноза.',
            )}
            {comparison.coveredHours > 0 &&
              (period === 'month' ||
                period === 'year' ||
                data?.chart.some((point) => point.partial)) && (
                <span>
                  {t(
                    period === 'month' || period === 'year'
                      ? 'Се прикажуваат само целосно прогнозирани денови или месеци.'
                      : 'Прогнозата е за цел час; тековното мерење сè уште се дополнува.',
                  )}
                </span>
              )}
          </p>
        )}
        {t(
          hasLine && data ? (
            <div className="live-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={data.chart.map((point) => ({
                    ...point,
                    revenue: convertMoney(point.revenue),
                    productionMwh: toMwh(point.productionKwh),
                    forecastMwh: toMwh(point.forecastProductionKwh ?? null),
                  }))}
                  margin={{ top: 24, right: 0, bottom: 10, left: 0 }}
                  barGap={2}
                  barCategoryGap="20%"
                >
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--chart-green)"
                        stopOpacity={0.18}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--chart-green)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                    {(['green', 'blue'] as const).map((color) => (
                      <linearGradient
                        key={color}
                        id={`${gradientId}-${color}-bar`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor={`var(--chart-${color})`}
                          stopOpacity={0.85}
                        />
                        <stop
                          offset="45%"
                          stopColor={`var(--column-${color}-mid)`}
                        />
                        <stop
                          offset="100%"
                          stopColor={`var(--column-${color}-base)`}
                        />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid
                    stroke="var(--chart-grid)"
                    strokeDasharray="3 5"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tickFormatter={(value) => String(value).split(' ')[0]}
                    tick={{ fontSize: 12, fill: 'var(--chart-label)' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={30}
                  />
                  <YAxis
                    yAxisId="energy"
                    tick={<UnitTick unit="MWh" energy />}
                    axisLine={false}
                    tickLine={false}
                    width={mobile ? 64 : 78}
                    tickCount={mobile ? 4 : 5}
                  />
                  <YAxis
                    yAxisId="money"
                    orientation="right"
                    tick={<UnitTick unit={getCurrency()} />}
                    axisLine={false}
                    tickLine={false}
                    width={getCurrency() === 'MKD' ? 80 : mobile ? 56 : 66}
                    tickCount={mobile ? 4 : 5}
                  />
                  <Tooltip
                    labelFormatter={(label, items) =>
                      `${String(label).split(' GMT')[0]}${items[0]?.payload?.partial ? ' · ' + t(period === 'day' || period === 'hour' ? 'Тековен час' : 'Делумен период') : ''}`
                    }
                    formatter={(value, name) => [
                      formatValue(Number(value)),
                      name === 'productionMwh'
                        ? t('Производство (MWh)')
                        : name === 'forecastMwh'
                          ? t('Прогноза (MWh)')
                          : t('Приход (EUR)'),
                    ]}
                    contentStyle={tooltipStyle}
                  />
                  {t(
                    mode === 'line' ? (
                      <>
                        <Area
                          yAxisId="energy"
                          dataKey="productionMwh"
                          type="monotone"
                          stroke="var(--chart-green)"
                          strokeWidth={2}
                          fill={`url(#${gradientId})`}
                          dot={false}
                          activeDot={{ r: 4 }}
                          connectNulls={false}
                        />
                        <Line
                          yAxisId="money"
                          dataKey="revenue"
                          type="monotone"
                          stroke="var(--chart-blue)"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                          connectNulls={false}
                        />
                      </>
                    ) : (
                      <>
                        <Bar
                          yAxisId="energy"
                          dataKey="productionMwh"
                          fill={`url(#${gradientId}-green-bar)`}
                          fillOpacity={0.28}
                          isAnimationActive={false}
                          shape={(props) => (
                            <Rectangle
                              {...props}
                              width={Number(props.width) * 2 + 2}
                              radius={[4, 4, 0, 0]}
                            />
                          )}
                        />
                        <Bar
                          yAxisId="money"
                          dataKey="revenue"
                          fill={`url(#${gradientId}-blue-bar)`}
                          fillOpacity={1}
                          isAnimationActive={false}
                          shape={(props) => (
                            <Rectangle
                              {...props}
                              x={Number(props.x) - Number(props.width) - 2}
                              width={Number(props.width) * 2 + 2}
                              radius={[4, 4, 0, 0]}
                            />
                          )}
                        />
                      </>
                    ),
                  )}
                  <Line
                    yAxisId="energy"
                    dataKey="forecastMwh"
                    type="monotone"
                    stroke="var(--chart-forecast)"
                    strokeWidth={2}
                    strokeDasharray="6 6"
                    strokeLinecap="round"
                    dot={
                      data.chart.filter(
                        (point) => point.forecastProductionKwh != null,
                      ).length === 1
                        ? { r: 3, strokeWidth: 0 }
                        : false
                    }
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart onConnect={onConnect} />
          ),
        )}
      </>
    </section>
  );
}
