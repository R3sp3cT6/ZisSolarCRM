'use client';
import {t,getLocale} from '@/lib/language';
import {useLanguage} from '@/components/language-switch';


import {useEffect, useId, useState} from 'react';
import {Activity, ArrowUpRight, ChartColumn, ChartLine} from 'lucide-react';
import {Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {toMwh} from '@/lib/energy-report';
import type {Period} from '@/lib/energy';
import type {getDashboard} from '@/lib/solar-server';

type Data = Awaited<ReturnType<typeof getDashboard>>;
type ChartMode = 'line' | 'column';
const formatValue = (value: number) => new Intl.NumberFormat(getLocale(), {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(value);
const preferenceKey = 'zis-solar-energy-chart';
const tooltipStyle = {borderRadius: 10, borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'var(--foreground)', fontSize: 14};

function EmptyChart({onConnect}: {onConnect?: () => void}) {useLanguage();
  return <div className="empty-chart"><div className="grid-lines">{t([0, 1, 2, 3].map(i => <div key={i}/>))}</div>
    <div className="empty-message"><span className="empty-icon"><Activity size={25}/></span>
      <strong>{t("Вашиот енергетски преглед започнува тука")}</strong><p>{t("Графикот ќе се пополни со првите мерења.")}</p>
      {t(onConnect && <button className="text-button" onClick={onConnect}>{t("Внеси податоци од централата ")}<ArrowUpRight size={15}/></button>)}
    </div>
    <div className="chart-axis">{t(['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'].map(hour => <span key={hour}>{t(hour)}</span>))}</div>
  </div>;
}

export function EnergyChart({data, period, onConnect}: {data: Data | null; period: Period; onConnect?: () => void}) {useLanguage();
  const [mode, setMode] = useState<ChartMode>('line');
  const gradientId = useId();
  useEffect(() => {
    try { if (['column', 'candle'].includes(localStorage.getItem(preferenceKey) ?? '')) setMode('column'); } catch {}
  }, []);
  const chooseMode = (next: ChartMode) => {
    setMode(next);
    try { localStorage.setItem(preferenceKey, next); } catch {}
  };
  const grouping = period === 'year' ? t("По месец") : period === 'month' ? t("По ден") : t("По час");
  const hasLine = data?.chart.some(point => point.productionKwh !== null || point.revenue !== null);

  return <section className="panel chart-panel">
    <div className="panel-heading energy-chart-heading">
      <div><h2>{t("Производство и приход")}</h2><p>{t("Енергијата низ времето, претворена во вредност.")}</p></div>
      <div className="energy-chart-actions">
        <div className="chart-view-switch" role="group" aria-label={t("Тип на график")}>
          <button type="button" aria-pressed={mode === 'line'} onClick={() => chooseMode('line')}><ChartLine size={16}/>{t("Линиски")}</button>
          <button type="button" aria-pressed={mode === 'column'} onClick={() => chooseMode('column')}><ChartColumn size={16}/>{t("Столбест")}</button>
        </div>
        <span className="small-pill">{t(grouping)}</span>
      </div>
    </div>
    <>
      <div className="chart-legend"><span><i className="legend-line green-line"/>{t("Производство · MWh")}</span><span><i className="legend-line blue-line"/>{t("Приход · EUR")}</span></div>
      {t(hasLine && data ? <div className="live-chart"><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data.chart.map(point => ({...point, productionMwh: toMwh(point.productionKwh)}))} margin={{top: 24, right: 0, bottom: 10, left: 0}} barGap={2} barCategoryGap="16%">
          <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-green)" stopOpacity={0.18}/><stop offset="100%" stopColor="var(--chart-green)" stopOpacity={0}/></linearGradient>
            {(['green','blue'] as const).map(color=><linearGradient key={color} id={`${gradientId}-${color}-bar`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={`var(--chart-${color})`} stopOpacity={1}/><stop offset="100%" stopColor={`var(--chart-${color})`} stopOpacity={0.62}/></linearGradient>)}
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false}/>
          <XAxis dataKey="label" tickFormatter={value => String(value).split(' ')[0]} tick={{fontSize: 12, fill: 'var(--chart-label)'}} axisLine={false} tickLine={false} minTickGap={30}/>
          <YAxis yAxisId="energy" label={{value:'MWh',position:'top',offset:10,fill:'var(--chart-green)',fontSize:11,fontWeight:600}} tickFormatter={value => formatValue(Number(value))} tick={{fontSize: 12, fill: 'var(--chart-label)'}} axisLine={false} tickLine={false} width={60}/>
          <YAxis yAxisId="money" label={{value:'EUR',position:'top',offset:10,fill:'var(--chart-blue)',fontSize:11,fontWeight:600}} orientation="right" tick={{fontSize: 12, fill: 'var(--chart-blue)'}} axisLine={false} tickLine={false} width={48}/>
          <Tooltip formatter={(value, name) => [formatValue(Number(value)), name === 'productionMwh' ? t("Производство (MWh)") : t("Приход (EUR)")]} contentStyle={tooltipStyle}/>
          {t(mode === 'line' ? <>
            <Area yAxisId="energy" dataKey="productionMwh" type="monotone" stroke="var(--chart-green)" strokeWidth={2} fill={`url(#${gradientId})`} dot={false} activeDot={{r: 4}} connectNulls={false}/>
            <Line yAxisId="money" dataKey="revenue" type="monotone" stroke="var(--chart-blue)" strokeWidth={2} dot={false} activeDot={{r: 4}} connectNulls={false}/>
          </> : <>
            <Bar yAxisId="energy" dataKey="productionMwh" fill={`url(#${gradientId}-green-bar)`} radius={[6,6,0,0]} maxBarSize={30} isAnimationActive={false}/>
            <Bar yAxisId="money" dataKey="revenue" fill={`url(#${gradientId}-blue-bar)`} radius={[6,6,0,0]} maxBarSize={30} isAnimationActive={false}/>
          </>)}
        </ComposedChart>
      </ResponsiveContainer></div> : <EmptyChart onConnect={onConnect}/>)}
    </>
  </section>;
}
