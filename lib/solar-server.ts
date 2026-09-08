import {env} from 'cloudflare:workers';
import {CONTRACT,MEMO_URL,parseMemo,rangeFor,slotsForDay,localDate,hourLabel,salePrice,revenue,type Period,type ReadingInput} from './energy';
import {FUSION_GRID_DATE,type parseFusionLive} from './fusionsolar';
export function db(){if(!env.DB)throw new Error('Базата моментално не е достапна.');return env.DB;}
export async function ensurePlant(owner:string){await db().prepare('INSERT INTO plants (owner, created_at) VALUES (?, ?) ON CONFLICT(owner) DO NOTHING').bind(owner,new Date().toISOString()).run();}
export async function syncMemo(day:string,force=false){
 const connection=db();const previous=await connection.prepare('SELECT * FROM sync_runs WHERE market_date=?').bind(day).first<{attempted_at:string;succeeded_at:string|null;error:string|null}>();
 if(previous&&Date.now()-Date.parse(previous.attempted_at)<(force?60000:previous.succeeded_at&&!previous.error&&day<localDate()?86400000:300000))return {updated:0,error:previous.error,cached:true};
 const attempted=new Date().toISOString();
 await connection.prepare('INSERT INTO sync_runs (market_date,attempted_at) VALUES (?,?) ON CONFLICT(market_date) DO UPDATE SET attempted_at=excluded.attempted_at').bind(day,attempted).run();
 try{
  const response=await fetch(MEMO_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({date:day}).toString(),signal:AbortSignal.timeout(18000)});
  if(!response.ok)throw new Error('MEMO не одговори успешно.');const html=await response.text();if(html.length>1500000)throw new Error('Неочекуван одговор од MEMO.');
  const points=parseMemo(html);if(!points.some(p=>p.marketDate===day))throw new Error('MEMO сè уште нема објавено целосни часовни цени за овој датум.');
  for(let i=0;i<points.length;i+=40){const statements=points.slice(i,i+40).flatMap(p=>[
    connection.prepare('INSERT INTO price_revisions (id,start,eur_cents,fetched_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM prices WHERE start=? AND eur_cents=?)').bind(crypto.randomUUID(),p.start,p.eurCents,attempted,p.start,p.eurCents),
    connection.prepare('INSERT INTO prices (start,market_date,eur_cents,fetched_at,source) VALUES (?,?,?,?,?) ON CONFLICT(start) DO UPDATE SET eur_cents=excluded.eur_cents,fetched_at=excluded.fetched_at,source=excluded.source').bind(p.start,p.marketDate,p.eurCents,attempted,MEMO_URL)
  ]);await connection.batch(statements);}
  await connection.prepare('UPDATE sync_runs SET succeeded_at=?,error=NULL WHERE market_date=?').bind(attempted,day).run();return {updated:points.length,error:null,cached:false};
 }catch(error){const message=error instanceof Error?error.message:'Неуспешно преземање на MEMO цени.';await connection.prepare('UPDATE sync_runs SET error=? WHERE market_date=?').bind(message,day).run();return {updated:0,error:message,cached:false};}
}
export async function saveReadings(owner:string,rows:ReadingInput[],source:string){
 await ensurePlant(owner);const connection=db();const now=new Date().toISOString();
 // One D1 batch is atomic: an import either saves every row and its revision, or none.
 const payload=JSON.stringify(rows.map(r=>({...r,id:crypto.randomUUID(),source,contractVersion:CONTRACT.version})));
 const statements=[
 connection.prepare("INSERT INTO reading_revisions (id,owner,start,payload,created_at) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.start'),value,? FROM json_each(?)").bind(owner,now,payload),
 connection.prepare("INSERT INTO readings (owner,start,production_kwh,export_kwh,power_kw,observed_at,source,updated_at) SELECT ?,json_extract(value,'$.start'),json_extract(value,'$.productionKwh'),json_extract(value,'$.exportKwh'),json_extract(value,'$.powerKw'),json_extract(value,'$.observedAt'),?,? FROM json_each(?) WHERE 1 ON CONFLICT(owner,start) DO UPDATE SET production_kwh=excluded.production_kwh,export_kwh=excluded.export_kwh,power_kw=excluded.power_kw,observed_at=excluded.observed_at,source=excluded.source,updated_at=excluded.updated_at").bind(owner,source,now,payload)
 ];await connection.batch(statements);return rows.length;
}
type DbReading={start:string;production_kwh:number|null;export_kwh:number|null;power_kw:number|null;observed_at:string;source:string;updated_at:string};
type DbPrice={start:string;eur_cents:number;fetched_at:string};
export async function getDashboard(owner:string,day:string,period:Period,hour?:string){
 const {from,to}=rangeFor(day,period,hour);const connection=db();await ensurePlant(owner);
 const currentStart=new Date(Math.floor(Date.now()/3600000)*3600000).toISOString();
 const [plant,readingsResult,pricesResult,dayPricesResult,latest,currentPrice,sync,fusionRecord,reportRecord,archiveCount]=await Promise.all([
 connection.prepare('SELECT name,capacity_kw FROM plants WHERE owner=?').bind(owner).first(),
 connection.prepare('SELECT * FROM readings WHERE owner=? AND start>=? AND start<? ORDER BY start').bind(owner,from,to).all<DbReading>(),
 connection.prepare('SELECT start,eur_cents,fetched_at FROM prices WHERE start>=? AND start<? ORDER BY start').bind(from,to).all<DbPrice>(),
 connection.prepare('SELECT start,eur_cents,fetched_at FROM prices WHERE market_date=? ORDER BY start').bind(day).all<DbPrice>(),
 connection.prepare('SELECT power_kw,observed_at FROM readings WHERE owner=? AND power_kw IS NOT NULL ORDER BY observed_at DESC LIMIT 1').bind(owner).first<{power_kw:number;observed_at:string}>(),
 connection.prepare('SELECT eur_cents,fetched_at FROM prices WHERE start=?').bind(currentStart).first<{eur_cents:number;fetched_at:string}>(),
 connection.prepare('SELECT attempted_at,succeeded_at,error FROM sync_runs WHERE market_date=?').bind(day).first(),
 connection.prepare('SELECT state FROM fusion_state WHERE owner=?').bind(owner).first<{state:string}>(),
 connection.prepare('SELECT payload FROM fusion_reports WHERE owner=? AND kind=? AND period=?').bind(owner,period==='year'?'month':'day',period==='year'?day.slice(0,4):day.slice(0,7)).first<{payload:string}>(),
 connection.prepare("SELECT count(*) AS count FROM fusion_reports WHERE owner=? AND kind='hour' AND json_extract(payload,'$.complete')=1").bind(owner).first<{count:number}>()
 ]);
 const fusionState=fusionRecord?JSON.parse(fusionRecord.state) as {live?:ReturnType<typeof parseFusionLive>;lastSuccess?:string;error?:string}:{};
 const fusion={configured:!!(env.FUSIONSOLAR_PASSWORD&&env.FUSIONSOLAR_OWNER===owner),connected:!!fusionState.live,lastSuccess:fusionState.lastSuccess??null,error:fusionState.error??null,live:fusionState.live??null,archivedDays:archiveCount?.count??0,gridDate:FUSION_GRID_DATE};
 const report=reportRecord?JSON.parse(reportRecord.payload) as {key:string;productionKwh:number|null;exportKwh:number|null}[]:[];
 const live=fusion.live;
 if(live&&period==='year'&&day.slice(0,4)===live.day.slice(0,4)){const month=report.find(r=>r.key===live.day.slice(0,7));if(month)month.productionKwh=live.monthProductionKwh;}
 if(live&&['day','month'].includes(period)&&day.slice(0,7)===live.day.slice(0,7)){const today=report.find(r=>r.key===live.day);if(today){today.productionKwh=live.dayProductionKwh;today.exportKwh=live.dayExportKwh;}}
 const readingMap=new Map(readingsResult.results.map(r=>[r.start,r]));const priceMap=new Map(pricesResult.results.map(r=>[r.start,r]));
 const allStarts=[...new Set([...readingMap.keys(),...priceMap.keys()])].sort();
 const rows=allStarts.map(start=>{const r=readingMap.get(start);const p=priceMap.get(start);const memo=p?p.eur_cents/100:null;return {start,productionKwh:r?.production_kwh??null,exportKwh:r?.export_kwh??null,memo,sale:memo===null?null:salePrice(memo),revenue:r?.export_kwh!=null&&memo!==null?revenue(r.export_kwh,memo):null,estimate:r&&r.production_kwh!==null&&r.export_kwh===null&&memo!==null?revenue(r.production_kwh,memo):null,source:r?.source??null,observedAt:r?.observed_at??null,priceFetchedAt:p?.fetched_at??null,partial:start===currentStart};});
 const actual=rows.filter(r=>r.source!==null);const priced=actual.filter(r=>r.revenue!==null);const expectedFrom=fusion.configured?Math.max(Date.parse(from),Date.parse(slotsForDay(FUSION_GRID_DATE)[0].start)):Date.parse(from);const expected=Math.max(0,Math.ceil((Math.min(Date.parse(to),Date.now())-expectedFrom)/3600000));
 const totals={productionKwh:actual.some(r=>r.productionKwh!==null)?actual.reduce((s,r)=>s+(r.productionKwh??0),0):null,exportKwh:actual.some(r=>r.exportKwh!==null)?actual.reduce((s,r)=>s+(r.exportKwh??0),0):null,revenue:priced.length?priced.reduce((s,r)=>s+r.revenue!,0):null,estimate:actual.some(r=>r.estimate!==null)?actual.reduce((s,r)=>s+(r.estimate??0),0):null,readings:actual.length,priced:priced.length,expected,missing:Math.max(0,expected-actual.length),unpriced:actual.filter(r=>r.exportKwh!==null&&r.memo===null).length,unmetered:actual.filter(r=>r.exportKwh===null).length};
 let productionSource='Часовна архива';
 const periodReport=report.filter(r=>period==='day'?r.key===day:period==='hour'?false:true);
 if(periodReport.some(r=>r.productionKwh!==null)){totals.productionKwh=periodReport.reduce((s,r)=>s+(r.productionKwh??0),0);if(periodReport.some(r=>r.exportKwh!==null))totals.exportKwh=periodReport.reduce((s,r)=>s+(r.exportKwh??0),0);productionSource='Huawei извештај';}
 if(period==='day'&&live?.day===day){totals.productionKwh=live.dayProductionKwh;totals.exportKwh=live.dayExportKwh;productionSource='Huawei · тековен ден';}
 const groups=new Map<string,{label:string;productionKwh:number|null;exportKwh:number|null;revenue:number|null;missingPrice:boolean}>();
 for(const row of rows){const date=localDate(row.start);const key=period==='year'?date.slice(0,7):period==='month'?date:row.start;const label=period==='year'?date.slice(5,7):period==='month'?date.slice(8,10):hourLabel(row.start);const g=groups.get(key)??{label,productionKwh:null,exportKwh:null,revenue:null,missingPrice:false};
 if(row.productionKwh!==null)g.productionKwh=(g.productionKwh??0)+row.productionKwh;if(row.exportKwh!==null)g.exportKwh=(g.exportKwh??0)+row.exportKwh;if(row.revenue!==null)g.revenue=(g.revenue??0)+row.revenue;if(row.exportKwh!==null&&row.memo===null)g.missingPrice=true;groups.set(key,g);}
 for(const r of periodReport){if(!['year','month'].includes(period))continue;const key=r.key;const g=groups.get(key)??{label:period==='year'?key.slice(5,7):key.slice(8,10),productionKwh:null,exportKwh:null,revenue:null,missingPrice:false};g.productionKwh=r.productionKwh;g.exportKwh=r.exportKwh;groups.set(key,g);}
 const currentPower=live?.powerKw!=null?{kw:live.powerKw,observedAt:live.retrievedAt,stale:Date.now()-Date.parse(live.retrievedAt)>900000}:latest?{kw:latest.power_kw,observedAt:latest.observed_at,stale:Date.now()-Date.parse(latest.observed_at)>600000}:null;
 return {plant,day,period,range:{from,to},slots:slotsForDay(day),totals,rows,productionSource,fusion,chart:[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,g])=>({...g,revenue:g.missingPrice?null:g.revenue})),market:dayPricesResult.results.map(p=>({start:p.start,label:hourLabel(p.start),memo:p.eur_cents/100,sale:salePrice(p.eur_cents/100)})),currentPrice:currentPrice?{memo:currentPrice.eur_cents/100,sale:salePrice(currentPrice.eur_cents/100),fetchedAt:currentPrice.fetched_at}:null,power:currentPower,sync,contract:CONTRACT,generatedAt:new Date().toISOString()};
}


