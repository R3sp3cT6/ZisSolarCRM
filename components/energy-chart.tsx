'use client';

import {useEffect, useId, useState} from 'react';
import {Activity, ArrowUpRight, ChartColumn, ChartLine} from 'lucide-react';
import {Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {toMwh} from '@/lib/energy-report';
import type {Period} from '@/lib/energy';
import type {getDashboard} from '@/lib/solar-server';

type Data = Awaited<ReturnType<typeof getDashboard>>;
type ChartMode = 'line' | 'column';
const formatValue = (value: number) => new Intl.NumberFormat('mk-MK', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(value);
const preferenceKey = 'zis-solar-energy-chart';
const tooltipStyle = {borderRadius: 10, borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'var(--foreground)', fontSize: 14};

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
  const gradientId = useId();
  useEffect(() => {
    try { if (['column', 'candle'].includes(localStorage.getItem(preferenceKey) ?? '')) setMode('column'); } catch {}
  }, []);
  const chooseMode = (next: ChartMode) => {
    setMode(next);
    try { localStorage.setItem(preferenceKey, next); } catch {}
  };
  const grouping = period === 'year' ? 'По месец' : period === 'month' ? 'По ден' : 'По час';
  const hasLine = data?.chart.some(point => point.productionKwh !== null || point.revenue !== null);

  return <section className="panel chart-panel">
    <div className="panel-heading energy-chart-heading">
      <div><h2>Производство и приход</h2><p>Енергијата низ времето, претворена во вредност.</p></div>
      <div className="energy-chart-actions">
        <div className="chart-view-switch" role="group" aria-label="Тип на график">
          <button type="button" aria-pressed={mode === 'line'} onClick={() => chooseMode('line')}><ChartLine size={16}/>Линиски</button>
          <button type="button" aria-pressed={mode === 'column'} onClick={() => chooseMode('column')}><ChartColumn size={16}/>Столбест</button>
        </div>
        <span className="small-pill">{grouping}</span>
      </div>
    </div>
    <>
      <div className="chart-legend"><span><i className="legend-line green-line"/>Производство · MWh</span><span><i className="legend-line blue-line"/>Приход · EUR</span></div>
      {hasLine && data ? <div className="live-chart"><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data.chart.map(point => ({...point, productionMwh: toMwh(point.productionKwh)}))} margin={{top: 24, right: 0, bottom: 10, left: 0}} barGap={3} barCategoryGap="22%">
          <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-green)" stopOpacity={0.18}/><stop offset="100%" stopColor="var(--chart-green)" stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false}/>
          <XAxis dataKey="label" tickFormatter={value => String(value).split(' ')[0]} tick={{fontSize: 12, fill: 'var(--chart-label)'}} axisLine={false} tickLine={false} minTickGap={30}/>
          <YAxis yAxisId="energy" tickFormatter={value => formatValue(Number(value))} tick={{fontSize: 12, fill: 'var(--chart-label)'}} axisLine={false} tickLine={false} width={60}/>
          <YAxis yAxisId="money" orientation="right" tick={{fontSize: 12, fill: 'var(--chart-blue)'}} axisLine={false} tickLine={false} width={48}/>
          <Tooltip formatter={(value, name) => [formatValue(Number(value)), name === 'productionMwh' ? 'Производство (MWh)' : 'Приход (EUR)']} contentStyle={tooltipStyle}/>
          {mode === 'line' ? <>
            <Area yAxisId="energy" dataKey="productionMwh" type="monotone" stroke="var(--chart-green)" strokeWidth={2} fill={`url(#${gradientId})`} dot={false} activeDot={{r: 4}} connectNulls={false}/>
            <Line yAxisId="money" dataKey="revenue" type="monotone" stroke="var(--chart-blue)" strokeWidth={2} dot={false} activeDot={{r: 4}} connectNulls={false}/>
          </> : <>
            <Bar yAxisId="energy" dataKey="productionMwh" fill="var(--chart-green)" maxBarSize={26} isAnimationActive={false}/>
            <Bar yAxisId="money" dataKey="revenue" fill="var(--chart-blue)" maxBarSize={26} isAnimationActive={false}/>
          </>}
        </ComposedChart>
      </ResponsiveContainer></div> : <EmptyChart onConnect={onConnect}/>}
    </>
  </section>;
}
