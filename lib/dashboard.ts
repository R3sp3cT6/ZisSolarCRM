import {summarizeHistory,type DayCoverage} from './history-coverage';
import {CONTRACT,rangeFor,slotsForDay,localDate,hourLabel,salePrice,revenue,type Period} from './energy';
import {FUSION_GRID_DATE,type parseFusionLive} from './fusionsolar';
import {readingCoverage,type LiveHour} from './fusion-telemetry';
export type DbReading={start:string;production_kwh:number|null;export_kwh:number|null;power_kw:number|null;observed_at:string;source:string;updated_at:string};
export type DbPrice={start:string;market_date:string;eur_cents:number;fetched_at:string};
export type DashboardSnapshot={owner:string;plant:{name:string;capacity_kw:number|null}|null;readings:DbReading[];prices:DbPrice[];reports:{kind:string;period:string;payload:string;updated_at:string}[];syncs:{market_date:string;attempted_at:string;succeeded_at:string|null;error:string|null}[];fusionState:{live?:ReturnType<typeof parseFusionLive>;liveHour?:LiveHour;lastSuccess?:string;error?:string|null};configured:boolean;savedAt:string};

export function buildDashboard(snapshot:DashboardSnapshot,day:string,period:Period,hour?:string,now=Date.now()){
 const {from,to}=rangeFor(day,period,hour);
 const currentStart=new Date(Math.floor(now/3600000)*3600000).toISOString();
 const plant=snapshot.plant;
 const readingsResult={results:snapshot.readings.filter(r=>r.start>=from&&r.start<to)};
 const pricesResult={results:snapshot.prices.filter(p=>p.start>=from&&p.start<to)};
 const dayPricesResult={results:snapshot.prices.filter(p=>p.market_date===day)};
 const latest=snapshot.readings.filter(r=>r.power_kw!==null).sort((a,b)=>b.observed_at.localeCompare(a.observed_at))[0];
 const currentPrice=snapshot.prices.find(p=>p.start===currentStart);
 const syncEntry=snapshot.syncs.find(s=>s.market_date===day);
 const sync=syncEntry?{attempted_at:syncEntry.attempted_at,succeeded_at:syncEntry.succeeded_at,error:syncEntry.error}:null;
 const reportRecord=snapshot.reports.find(r=>r.kind===(period==='year'?'month':'day')&&r.period===(period==='year'?day.slice(0,4):day.slice(0,7)));
 const archiveCount={count:snapshot.reports.filter(r=>r.kind==='hour'&&JSON.parse(r.payload).version===2&&JSON.parse(r.payload).complete===true).length};
 const dailyReports={results:snapshot.reports.filter(r=>r.kind==='day')};
 const allPrices=new Map(snapshot.prices.map(p=>[p.start,p]));
 const days=new Map<string,DayCoverage & {has_production:boolean;revenue:number|null}>();
 for(const r of snapshot.readings){
  const date=localDate(r.start),p=allPrices.get(r.start);
  const d=days.get(date)??{day:date,hours:0,production:0,exported:0,priced:0,has_production:false,revenue:null};
  d.hours++;if(r.production_kwh!==null)d.production++;if(r.export_kwh!==null)d.exported++;
  if((r.production_kwh??0)>0)d.has_production=true;
  if(r.export_kwh!==null&&p){d.priced++;d.revenue=(d.revenue??0)+revenue(r.export_kwh,p.eur_cents/100);}
  days.set(date,d);
 }
 const historyGroups={results:[...days.values()].sort((a,b)=>a.day.localeCompare(b.day))};
 const fusionState=snapshot.fusionState;
 const history=summarizeHistory(FUSION_GRID_DATE,localDate(new Date(now)),historyGroups.results,dailyReports.results.flatMap(r=>JSON.parse(r.payload).filter((v:{productionKwh:number|null;exportKwh:number|null})=>v.productionKwh!==null&&v.exportKwh!==null).map((v:{key:string})=>v.key)));
 const fusion={history,configured:snapshot.configured,connected:!!fusionState.live,lastSuccess:fusionState.lastSuccess??null,error:fusionState.error??null,live:fusionState.live??null,archivedDays:archiveCount?.count??0,gridDate:FUSION_GRID_DATE};
 const report=reportRecord?JSON.parse(reportRecord.payload) as {key:string;productionKwh:number|null;exportKwh:number|null}[]:[];
 const live=fusion.live;
 const productionDays=[...new Set([
  ...historyGroups.results.filter(r=>r.has_production).map(r=>r.day),
  ...dailyReports.results.flatMap(r=>(JSON.parse(r.payload) as {key:string;productionKwh:number|null}[]).filter(v=>v.productionKwh!==null&&v.productionKwh>0).map(v=>v.key)),
  ...(live&&live.dayProductionKwh!==null&&live.dayProductionKwh>0?[live.day]:[])
 ])].sort();
 if(live&&period==='year'&&day.slice(0,4)===live.day.slice(0,4)){const month=report.find(r=>r.key===live.day.slice(0,7));if(month)month.productionKwh=live.monthProductionKwh;}
 if(live&&['day','month'].includes(period)&&day.slice(0,7)===live.day.slice(0,7)){const today=report.find(r=>r.key===live.day);if(today){today.productionKwh=live.dayProductionKwh;today.exportKwh=live.dayExportKwh;}}
 const readingMap=new Map(readingsResult.results.map(r=>[r.start,r]));const priceMap=new Map(pricesResult.results.map(r=>[r.start,r]));
 // The unfinished hour is an ephemeral view, never an archived full-hour reading.
 const liveHour=fusionState.liveHour;
 if(liveHour?.start===currentStart&&currentStart>=from&&currentStart<to&&now-Date.parse(liveHour.observedAt)<900000&&(liveHour.exportKwh!==null||liveHour.productionKwh!==null)){
  const prior=readingMap.get(currentStart);
  if(!prior||Date.parse(liveHour.observedAt)>=Date.parse(prior.observed_at))readingMap.set(currentStart,{start:currentStart,production_kwh:liveHour.productionKwh??prior?.production_kwh??null,export_kwh:liveHour.exportKwh??prior?.export_kwh??null,power_kw:prior?.power_kw??null,observed_at:liveHour.observedAt,source:'Huawei FusionSolar · live counters',updated_at:liveHour.observedAt});
 }
 const allStarts=[...new Set([...readingMap.keys(),...priceMap.keys()])].sort();
 const rows=allStarts.map(start=>{const r=readingMap.get(start);const p=priceMap.get(start);const memo=p?p.eur_cents/100:null;return {start,productionKwh:r?.production_kwh??null,exportKwh:r?.export_kwh??null,memo,sale:memo===null?null:salePrice(memo),revenue:r?.export_kwh!=null&&memo!==null?revenue(r.export_kwh,memo):null,estimate:r&&r.production_kwh!==null&&r.export_kwh===null&&memo!==null?revenue(r.production_kwh,memo):null,source:r?.source??null,observedAt:r?.observed_at??null,priceFetchedAt:p?.fetched_at??null,partial:start===currentStart};});
 const actual=rows.filter(r=>r.source!==null);const priced=actual.filter(r=>r.revenue!==null);const expectedFrom=fusion.configured?Math.max(Date.parse(from),Date.parse(slotsForDay(FUSION_GRID_DATE)[0].start)):Date.parse(from);const coverage=readingCoverage(actual.map(r=>r.start),new Date(expectedFrom).toISOString(),to,now);const expected=coverage.expected;
 const totals={productionKwh:actual.some(r=>r.productionKwh!==null)?actual.reduce((s,r)=>s+(r.productionKwh??0),0):null,exportKwh:actual.some(r=>r.exportKwh!==null)?actual.reduce((s,r)=>s+(r.exportKwh??0),0):null,revenue:priced.length?priced.reduce((s,r)=>s+r.revenue!,0):null,estimate:actual.some(r=>r.estimate!==null)?actual.reduce((s,r)=>s+(r.estimate??0),0):null,readings:actual.length,priced:priced.length,expected,missing:coverage.missing,partial:actual.some(r=>r.partial),unpriced:actual.filter(r=>r.exportKwh!==null&&r.memo===null).length,unmetered:actual.filter(r=>r.exportKwh===null).length};
 let productionSource='Часовна архива';
 const periodReport=report.filter(r=>period==='day'?r.key===day:period==='hour'?false:true);
 if(periodReport.some(r=>r.productionKwh!==null)){totals.productionKwh=periodReport.reduce((s,r)=>s+(r.productionKwh??0),0);if(periodReport.some(r=>r.exportKwh!==null))totals.exportKwh=periodReport.reduce((s,r)=>s+(r.exportKwh??0),0);productionSource='Huawei извештај';}
 if(period==='day'&&live?.day===day){totals.productionKwh=live.dayProductionKwh;totals.exportKwh=live.dayExportKwh;productionSource='Huawei · тековен ден';}
 const groups=new Map<string,{label:string;productionKwh:number|null;exportKwh:number|null;revenue:number|null;missingPrice:boolean;partial:boolean}>();
 for(const row of rows){const date=localDate(row.start);const key=period==='year'?date.slice(0,7):period==='month'?date:row.start;const label=period==='year'?date.slice(5,7):period==='month'?date.slice(8,10):hourLabel(row.start);const g=groups.get(key)??{label,productionKwh:null,exportKwh:null,revenue:null,missingPrice:false,partial:false};
 if(row.partial&&row.source!==null)g.partial=true;
 if(row.productionKwh!==null)g.productionKwh=(g.productionKwh??0)+row.productionKwh;if(row.exportKwh!==null)g.exportKwh=(g.exportKwh??0)+row.exportKwh;if(row.revenue!==null)g.revenue=(g.revenue??0)+row.revenue;if(row.exportKwh!==null&&row.memo===null)g.missingPrice=true;groups.set(key,g);}
 for(const r of periodReport){if(!['year','month'].includes(period))continue;const key=r.key;const g=groups.get(key)??{label:period==='year'?key.slice(5,7):key.slice(8,10),productionKwh:null,exportKwh:null,revenue:null,missingPrice:false,partial:false};g.productionKwh=r.productionKwh;g.exportKwh=r.exportKwh;groups.set(key,g);}
 const currentPower=live?.powerKw!=null?{kw:live.powerKw,observedAt:live.retrievedAt,stale:now-Date.parse(live.retrievedAt)>900000}:latest?{kw:latest.power_kw,observedAt:latest.observed_at,stale:now-Date.parse(latest.observed_at)>600000}:null;
 return {plant,day,period,productionDays,dailyRevenue:historyGroups.results.map(r=>({day:r.day,revenue:r.revenue===null?null:Number(r.revenue),partial:r.day>=localDate(new Date(now))||Number(r.priced)<slotsForDay(r.day).length})),range:{from,to},slots:slotsForDay(day),totals,rows,productionSource,fusion,chart:[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,g])=>({...g,revenue:g.missingPrice?null:g.revenue})),market:dayPricesResult.results.map(p=>({start:p.start,label:hourLabel(p.start),memo:p.eur_cents/100,sale:salePrice(p.eur_cents/100)})),currentPrice:currentPrice?{memo:currentPrice.eur_cents/100,sale:salePrice(currentPrice.eur_cents/100),fetchedAt:currentPrice.fetched_at}:null,power:currentPower,sync,contract:CONTRACT,generatedAt:new Date(now).toISOString()};
}
