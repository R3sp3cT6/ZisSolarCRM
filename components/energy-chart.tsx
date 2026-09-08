'use client';

import {useEffect, useMemo, useState} from 'react';
import {Activity, ArrowUpRight, ChartCandlestick, ChartLine, Info} from 'lucide-react';
import {Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type BarShapeProps} from 'recharts';
import {buildEnergyCandles, type EnergyCandle, type Ohlc} from '@/lib/energy-candles';
import {toMwh} from '@/lib/energy-report';
import type {Period} from '@/lib/energy';
import type {getDashboard} from '@/lib/solar-server';

type Data = Awaited<ReturnType<typeof getDashboard>>;
type CandlePoint = EnergyCandle & {ohlc: Ohlc | null; range: [number, number] | null};
type ChartMode = 'line' | 'candle';
const formatValue = (value: number) => new Intl.NumberFormat('mk-MK', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(value);
const preferenceKey = 'zis-solar-energy-chart';
const tooltipStyle = {borderRadius: 10, borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'var(--foreground)', fontSize: 14};

function CandleShape({x, y, width, height, payload}: BarShapeProps) {
  const point = payload as CandlePoint;
  const candle = point?.ohlc;
  if (!candle || ![x, y, width, height].every(Number.isFinite)) return null;
  const center = x + width / 2;
  const bodyWidth = Math.min(width, 22);
  const span = candle.high - candle.low;
  const pixel = (value: number) => span === 0 ? y + height / 2 : y + (candle.high - value) / span * height;
  const open = pixel(candle.open), close = pixel(candle.close);
  const color = candle.close >= candle.open ? 'var(--candle-up)' : 'var(--candle-down)';
  const description = `${point.label}: почетна ${formatValue(candle.open)}, највисока ${formatValue(candle.high)}, најниска ${formatValue(candle.low)}, крајна ${formatValue(candle.close)}`;
  return <g role="img" aria-label={description} className="energy-candle">
    <title>{description}</title>
    <line x1={center} x2={center} y1={y} y2={y + height} stroke={color} strokeWidth={1.5}/>
    {Math.abs(open - close) < 2
      ? <line x1={center - bodyWidth / 2} x2={center + bodyWidth / 2} y1={open} y2={open} stroke={color} strokeWidth={2.5}/>
      : <rect x={center - bodyWidth / 2} y={Math.min(open, close)} width={bodyWidth} height={Math.abs(open - close)} fill={color} stroke={color} rx={1.5}/>}
  </g>;
}

function EmptyChart({onConnect}: {onConnect?: () => void}) {
  return <div className="empty-chart"><div className="grid-lines">{[0, 1, 2, 3].map(i => <div key={i}/>)}</div>
    <div className="empty-message"><span className="empty-icon"><Activity size={25}/></span>
      <strong>Вашиот енергетски преглед започнува тука</strong><p>Графикот ќе се пополни со првите мерења.</p>
      {onConnect && <button className="text-button" onClick={onConnect}>Внеси податоци од централата <ArrowUpRight size={15}/></button>}
    </div>
    <div className="chart-axis">{['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'].map(hour => <span key={hour}>{hour}</span>)}</div>
  </div>;
}

export function EnergyChart({data, period, onConnect}: {data: Data | null; period: Period; onConnect?: () => void}) {
  const [mode, setMode] = useState<ChartMode>('line');
  const [metric, setMetric] = useState<'production' | 'revenue'>('production');
  useEffect(() => {
    try { if (localStorage.getItem(preferenceKey) === 'candle') setMode('candle'); } catch {}
  }, []);
  const chooseMode = (next: ChartMode) => {
    setMode(next);
    try { localStorage.setItem(preferenceKey, next); } catch {}
  };
  const candles = useMemo(() => data ? buildEnergyCandles(data.rows, period, data.range) : [], [data, period]);
  const points: CandlePoint[] = candles.map(candle => ({...candle, ohlc: candle[metric], range: candle[metric] ? [candle[metric].low, candle[metric].high] : null}));
  const available = points.filter(point => point.ohlc !== null);
  const unit = metric === 'production' ? 'MWh' : 'EUR';
  const low = available.length ? Math.min(...available.map(point => point.ohlc!.low)) : 0;
  const high = available.length ? Math.max(...available.map(point => point.ohlc!.high)) : 0;
  const padding = Math.max((high - low) * .12, Math.abs(high) * .04, .02);
  const domain: [number, number] = [metric === 'production' ? Math.max(0, low - padding) : low - padding, high + padding];
  const grouping = period === 'year' ? 'По месец' : period === 'month' ? 'По ден' : mode === 'candle' && period === 'day' ? 'На 3 часа' : 'По час';
  const hasLine = data?.chart.some(point => point.productionKwh !== null || point.revenue !== null);

  return <section className="panel chart-panel">
    <div className="panel-heading energy-chart-heading">
      <div><h2>Производство и приход</h2><p>Енергијата низ времето, претворена во вредност.</p></div>
      <div className="energy-chart-actions">
        <div className="chart-view-switch" role="group" aria-label="Тип на график">
          <button type="button" aria-pressed={mode === 'line'} onClick={() => chooseMode('line')}><ChartLine size={16}/>Линиски</button>
          <button type="button" aria-pressed={mode === 'candle'} onClick={() => chooseMode('candle')}><ChartCandlestick size={16}/>Свеќичен</button>
        </div>
        <span className="small-pill">{grouping}</span>
      </div>
    </div>
    {mode === 'line' ? <>
      <div className="chart-legend"><span><i className="legend-line green-line"/>Производство · MWh</span><span><i className="legend-line blue-line"/>Приход · EUR</span></div>
      {hasLine && data ? <div className="live-chart"><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data.chart.map(point => ({...point, productionMwh: toMwh(point.productionKwh)}))} margin={{top: 24, right: 0, bottom: 10, left: 0}}>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false}/>
          <XAxis dataKey="label" tickFormatter={value => String(value).split(' ')[0]} tick={{fontSize: 12, fill: 'var(--chart-label)'}} axisLine={false} tickLine={false} minTickGap={30}/>
          <YAxis yAxisId="energy" tickFormatter={value => formatValue(Number(value))} tick={{fontSize: 12, fill: 'var(--chart-label)'}} axisLine={false} tickLine={false} width={60}/>
          <YAxis yAxisId="money" orientation="right" tick={{fontSize: 12, fill: 'var(--chart-blue)'}} axisLine={false} tickLine={false} width={48}/>
          <Tooltip formatter={(value, name) => [formatValue(Number(value)), name === 'productionMwh' ? 'Производство (MWh)' : 'Приход (EUR)']} contentStyle={tooltipStyle}/>
          <Line yAxisId="energy" dataKey="productionMwh" type="monotone" stroke="var(--chart-green)" strokeWidth={2.5} dot={{r: 2.5}} activeDot={{r: 5}} connectNulls={false}/>
          <Line yAxisId="money" dataKey="revenue" type="monotone" stroke="var(--chart-blue)" strokeWidth={2.5} dot={{r: 2.5}} activeDot={{r: 5}} connectNulls={false}/>
        </ComposedChart>
      </ResponsiveContainer></div> : <EmptyChart onConnect={onConnect}/>}
    </> : <>
      <div className="candle-toolbar">
        <div className="chart-view-switch candle-metric-switch" role="group" aria-label="Податоци за свеќичен график">
          <button type="button" aria-pressed={metric === 'production'} onClick={() => setMetric('production')}>Производство · MWh</button>
          <button type="button" aria-pressed={metric === 'revenue'} onClick={() => setMetric('revenue')}>Приход · EUR</button>
        </div>
        <div className="candle-legend"><span><i className="candle-up"/>Раст / исто</span><span><i className="candle-down"/>Пад</span></div>
      </div>
      {available.length ? <div className="live-chart"><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{top: 20, right: 12, bottom: 10, left: 0}} barCategoryGap="28%">
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false}/>
          <XAxis dataKey="label" tickFormatter={value => String(value).split('–')[0].split(' ')[0]} tick={{fontSize: 12, fill: 'var(--chart-label)'}} axisLine={false} tickLine={false} minTickGap={24}/>
          <YAxis domain={domain} tickFormatter={value => formatValue(Number(value))} tick={{fontSize: 12, fill: 'var(--chart-label)'}} axisLine={false} tickLine={false} width={64}/>
          <ReferenceLine y={0} stroke="var(--chart-zero)"/>
          <Tooltip cursor={{fill: 'var(--secondary)', opacity: .5}} content={({active, payload}) => {
            const point = payload?.[0]?.payload as CandlePoint | undefined;
            const value = point?.ohlc;
            return active && point && value ? <div className="candle-tooltip">
              <strong>{point.label} · {unit}</strong>
              <dl>{[['Почетна', value.open], ['Највисока', value.high], ['Најниска', value.low], ['Крајна', value.close]].map(([label, number]) => <div key={label}><dt>{label}</dt><dd>{formatValue(Number(number))}</dd></div>)}</dl>
              <small>Часовни мерења: {value.count} / {point.slots}</small>
            </div> : null;
          }}/>
          <Bar dataKey="range" name={unit} shape={props => <CandleShape {...props}/>} isAnimationActive={false} maxBarSize={26}/>
        </ComposedChart>
      </ResponsiveContainer></div> : <div className="candle-empty"><ChartCandlestick size={30}/><strong>{data ? 'Нема часовни мерења за свеќичен приказ' : 'Се вчитуваат мерењата…'}</strong><p>Изберете друг период или отворете го линискиот приказ.</p></div>}
      <div className="candle-note"><Info size={16}/><span>Секоја свеќа ги прикажува првата, последната, најниската и највисоката <strong>часовна вредност</strong> во периодот, а не неговиот збир. При едно мерење се прикажува цртичка; празнините значат дека нема мерења.</span></div>
    </>}
  </section>;
}
