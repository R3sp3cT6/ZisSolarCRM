import {historyDays,nextHistoryDay} from './history-coverage';
import 'server-only';
const env=process.env;
import {db,ensurePlant,saveReadings,syncMemo} from './solar-server';
import {localDate,validDate,slotsForDay} from './energy';
import {FUSION_STATION,FUSION_GRID_DATE,hourlyReportCoverage,parseFusionHours,parseFusionReport} from './fusionsolar';

import {fusionClient,collectTelemetry,type FusionState as State} from './fusion-client';
import {cacheRead,cacheWrite} from './shared-cache';
import {recordLiveTrial,recordHistoricalTrial} from './forecast-trial-live';
const HOUR=3600000,DAY=24*HOUR;
export function fusionConfigured(){return !!(env.FUSIONSOLAR_USERNAME&&env.FUSIONSOLAR_PASSWORD&&env.FUSIONSOLAR_OWNER);}
export function fusionOwner(){return env.FUSIONSOLAR_OWNER;}
export async function syncFusionDirect(owner:string,requestedDay=localDate(),options:{active?:boolean;daily?:boolean;evening?:boolean;manual?:boolean}={}){
 if(!fusionConfigured())return {configured:false,updated:0,error:null};
 if(owner!==fusionOwner())throw new Error('Оваа централа е поврзана со профилот на сопственикот.');
 if(!validDate(requestedDay)||requestedDay>localDate()||requestedDay<FUSION_GRID_DATE)throw new Error('Изберете датум од 03.04.2026 до денес.');
 const connection=db();await ensurePlant(owner);await connection.prepare('INSERT INTO fusion_state (owner) VALUES (?) ON CONFLICT(owner) DO NOTHING').bind(owner).run();
 const lock=crypto.randomUUID(),started=Date.now();
 const locked=await connection.prepare("UPDATE fusion_state SET lock_token=?,lock_until=? WHERE owner=? AND lock_until<? AND COALESCE((state::jsonb->>'lastAttempt')::timestamptz,'epoch'::timestamptz)<?::timestamptz RETURNING state").bind(lock,started+240000,owner,started,new Date(options.active?started-305000:started+1).toISOString()).first<{state:string}>();
 if(!locked){
  if(!await cacheRead<State>('fusion:'+owner)){
   const stored=await connection.prepare('SELECT state FROM fusion_state WHERE owner=?').bind(owner).first<{state:string}>();
   if(stored)await cacheWrite('fusion:'+owner,JSON.parse(stored.state));
  }
  return {configured:true,updated:0,cached:true,error:null};
 }
 const storedState:State=JSON.parse(locked.state),cachedState=await cacheRead<State>('fusion:'+owner);
 const state:State=cachedState&&Date.parse(cachedState.lastAttempt??'')>=Date.parse(storedState.lastAttempt??'1970-01-01')?cachedState:storedState;state.calls??={};state.lastAttempt=new Date(started).toISOString();let updated=0;const errors:string[]=[];
 const previousSuccess=state.lastSuccess;
 const persist=async()=>{await cacheWrite('fusion:'+owner,state);return connection.prepare('UPDATE fusion_state SET state=? WHERE owner=? AND lock_token=?').bind(JSON.stringify(state),owner,lock).run();};
 const api=fusionClient(owner,state,persist);const {available,reserve,call}=api;
 async function attempt(work:()=>Promise<void>){try{await work();}catch(error){errors.push(error instanceof Error?error.message:'Неуспешно Huawei преземање.');}}
 async function hours(day:string){
  const prior=await connection.prepare("SELECT payload,updated_at FROM fusion_reports WHERE owner=? AND kind='hour' AND period=?").bind(owner,day).first<{payload:string;updated_at:string}>();
  if(prior&&day<localDate()&&JSON.parse(prior.payload).version===2&&JSON.parse(prior.payload).complete)return;
  if(prior&&Date.now()-Date.parse(prior.updated_at)<(options.manual?60000:day===localDate()?HOUR:2*HOUR))return;
  if(!available('/thirdData/getKpiStationHour',60000,24))return;
  const values=await call('/thirdData/getKpiStationHour',{stationCodes:FUSION_STATION,collectTime:Date.parse(day+'T12:00:00Z')},60000,24);
  const rows=parseFusionHours(values,day);if(rows.length)updated+=await saveReadings(owner,rows,'Huawei FusionSolar · часовен извештај',true);
  await connection.prepare("INSERT INTO fusion_reports (owner,kind,period,payload,updated_at) VALUES (?,'hour',?,?,?) ON CONFLICT(owner,kind,period) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(owner,day,JSON.stringify(hourlyReportCoverage(rows,day)),new Date().toISOString()).run();
  await syncMemo(day);
 }
 try{
  if(options.active||options.daily)await attempt(async()=>{const result=await syncMemo(localDate());if(result.error)throw new Error(result.error);});
  await attempt(async()=>{
   if(state.devices&&state.meters&&state.devicesAt&&Date.now()-state.devicesAt<DAY)return;
   if(!available('/thirdData/getDevList',HOUR,20))return;
   const devices=await call('/thirdData/getDevList',{stationCodes:FUSION_STATION},HOUR,20);
   if(!Array.isArray(devices)||devices.some(d=>d.stationCode!==FUSION_STATION))throw new Error('Huawei врати уреди од друга централа.');
   const ids=devices.filter(d=>d.devTypeId===1).map(d=>d.id);if(!ids.length||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)))throw new Error('Не е достапна целосна листа на инвертери.');state.devices=ids;state.meters=devices.filter(d=>d.devTypeId===17).map(d=>d.id);if(state.meters.some(id=>!Number.isSafeInteger(id)))throw new Error('Невалидна листа на броила.');state.devicesAt=Date.now();
   await connection.prepare('UPDATE plants SET name=? WHERE owner=? AND name=?').bind('ZIS Solar',owner,'Мојата централа').run();
  });
  const telemetry=await collectTelemetry(state,api,rows=>saveReadings(owner,rows,'Huawei FusionSolar · device counters',true,true),options.daily,(values,ids,receivedAt)=>recordHistoricalTrial(owner,values,ids,receivedAt));
  updated+=telemetry.updated;if(telemetry.error)errors.push(telemetry.error);
  try{await recordLiveTrial(owner,state.forecastObservation);}catch{console.warn('Trial observation deferred');}
  // The daily pass closes yesterday first; active visits refresh today's report.
  await attempt(async()=>{await hours(options.daily?localDate(new Date(Date.parse(slotsForDay(localDate())[0].start)-HOUR)):localDate());});
  if(options.evening){state.error=errors[0]??null;return {configured:true,updated,error:state.error,connected:!!state.live,liveUpdated:state.lastSuccess!==previousSuccess,lastSuccess:state.lastSuccess??null};}
  await attempt(async()=>{
   const period=requestedDay.slice(0,7);const stored=await connection.prepare("SELECT updated_at FROM fusion_reports WHERE owner=? AND kind='day' AND period=?").bind(owner,period).first<{updated_at:string}>();
   if(!stored||Date.now()-Date.parse(stored.updated_at)>(period===localDate().slice(0,7)?6*HOUR:30*DAY)){
    if(!available('/thirdData/getKpiStationDay',60000,24))return;
    const values=parseFusionReport(await call('/thirdData/getKpiStationDay',{stationCodes:FUSION_STATION,collectTime:Date.parse(requestedDay+'T12:00:00Z')},60000,24),'day',requestedDay);
    await connection.prepare("INSERT INTO fusion_reports (owner,kind,period,payload,updated_at) VALUES (?,'day',?,?,?) ON CONFLICT(owner,kind,period) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(owner,period,JSON.stringify(values),new Date().toISOString()).run();
   }
   const year=requestedDay.slice(0,4);const yearly=await connection.prepare("SELECT updated_at FROM fusion_reports WHERE owner=? AND kind='month' AND period=?").bind(owner,year).first<{updated_at:string}>();
   if(!yearly||Date.now()-Date.parse(yearly.updated_at)>6*HOUR){
    if(!available('/thirdData/getKpiStationMonth',60000,24))return;
    const values=parseFusionReport(await call('/thirdData/getKpiStationMonth',{stationCodes:FUSION_STATION,collectTime:Date.parse(requestedDay+'T12:00:00Z')},60000,24),'month',requestedDay);
    await connection.prepare("INSERT INTO fusion_reports (owner,kind,period,payload,updated_at) VALUES (?,'month',?,?,?) ON CONFLICT(owner,kind,period) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(owner,year,JSON.stringify(values),new Date().toISOString()).run();
   }
  });
  await attempt(async()=>{
   if(!available('/thirdData/getKpiStationDay',60000,24))return;
   const reports=await connection.prepare("SELECT period,payload,updated_at FROM fusion_reports WHERE owner=? AND kind='day'").bind(owner).all<{period:string;payload:string;updated_at:string}>();
   const byMonth=new Map(reports.results.map(r=>[r.period,r]));
   const days=historyDays(FUSION_GRID_DATE,localDate());
   const months=[...new Set(days.map(day=>day.slice(0,7)))];
   const missing=months.find(month=>!byMonth.has(month))??months.find(month=>{
    const report=byMonth.get(month)!;
    if(Date.now()-Date.parse(report.updated_at)<7*DAY)return false;
    const valid=new Set(JSON.parse(report.payload).filter((r:{productionKwh:number|null;exportKwh:number|null})=>r.productionKwh!==null&&r.exportKwh!==null).map((r:{key:string})=>r.key));
    return days.some(day=>day.startsWith(month)&&!valid.has(day));
   });
   if(!missing)return;
   const date=missing+'-15';
   const values=parseFusionReport(await call('/thirdData/getKpiStationDay',{stationCodes:FUSION_STATION,collectTime:Date.parse(date+'T12:00:00Z')},60000,24),'day',date);
   await connection.prepare("INSERT INTO fusion_reports (owner,kind,period,payload,updated_at) VALUES (?,'day',?,?,?) ON CONFLICT(owner,kind,period) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(owner,missing,JSON.stringify(values),new Date().toISOString()).run();
  });
  await attempt(async()=>{
   if(!available('/thirdData/getKpiStationHour',60000,24))return;
   // Current-day hourly reports take priority; historical backfill runs only in the daily job.
   if(!options.daily)return;
   if(state.lastBackfill&&Date.now()-state.lastBackfill<30*60000)return;
   const backfills=(state.calls!['backfill']??[]).filter(t=>t>Date.now()-DAY);state.calls!['backfill']=backfills;if(backfills.length>=10)return;
   const reports=await connection.prepare("SELECT period,payload,updated_at FROM fusion_reports WHERE owner=? AND kind='hour'").bind(owner).all<{period:string;payload:string;updated_at:string}>();
   const day=nextHistoryDay(FUSION_GRID_DATE,localDate(),reports.results);
   if(!day)return;
   await hours(day);state.lastBackfill=Date.now();backfills.push(Date.now());
  });
  await attempt(async()=>{
   const [prices,runs]=await Promise.all([
    connection.prepare('SELECT market_date,count(*)::integer AS count FROM prices GROUP BY market_date').all<{market_date:string;count:number}>(),
    connection.prepare('SELECT market_date,attempted_at FROM sync_runs').all<{market_date:string;attempted_at:string}>()
   ]);
   const counts=new Map(prices.results.map(r=>[r.market_date,r.count]));
   const attempts=new Map(runs.results.map(r=>[r.market_date,Date.parse(r.attempted_at)]));
   const missing=historyDays(FUSION_GRID_DATE,localDate()).reverse().find(day=>counts.get(day)!==slotsForDay(day).length&&Date.now()-(attempts.get(day)??0)>6*HOUR);
   if(missing)await syncMemo(missing);
  });
  state.error=errors[0]??null;await persist();return {configured:true,updated,error:state.error,connected:!!state.live,liveUpdated:state.lastSuccess!==previousSuccess,lastSuccess:state.lastSuccess??null};
 }finally{
  await persist();await connection.prepare('UPDATE fusion_state SET lock_until=0,lock_token=NULL WHERE owner=? AND lock_token=?').bind(owner,lock).run();
 }
}

export async function syncFusion(owner:string,requestedDay=localDate(),options:{active?:boolean;daily?:boolean;evening?:boolean;manual?:boolean}={}){
 const {syncAndCache}=await import('./solar-cache');return syncAndCache(owner,requestedDay,options);
}
