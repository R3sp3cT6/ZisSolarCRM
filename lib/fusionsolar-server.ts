import {historyDays,nextHistoryDay} from './history-coverage';
import 'server-only';
const env=process.env;
import {db,ensurePlant,saveReadings,syncMemo} from './solar-server';
import {localDate,validDate,slotsForDay} from './energy';
import {FUSION_ORIGIN,FUSION_STATION,FUSION_GRID_DATE,hourlyReportCoverage,parseFusionHours,parseFusionLive,parseFusionReport} from './fusionsolar';
import {LIVE_REFRESH_MS,GRID_EXPORT_COUNTER,parseCounterHistory,counterAnchor,counterHours,liveCounterDelta,type CounterAnchor,type LiveHour} from './fusion-telemetry';

type State={calls?:Record<string,number[]>;session?:string;expires?:number;devices?:number[];meters?:number[];devicesAt?:number;live?:ReturnType<typeof parseFusionLive>;liveHour?:LiveHour;anchors?:{production?:CounterAnchor;export?:CounterAnchor};historyAt?:{production?:number;export?:number};lastSuccess?:string;error?:string|null;lastHour?:number;lastBackfill?:number;lastAttempt?:string};
type Envelope={success:boolean;failCode:number;data:any;params?:Record<string,unknown>};
const HOUR=3600000,DAY=24*HOUR;
export function fusionConfigured(){return !!(env.FUSIONSOLAR_USERNAME&&env.FUSIONSOLAR_PASSWORD&&env.FUSIONSOLAR_OWNER);}
export function fusionOwner(){return env.FUSIONSOLAR_OWNER;}
async function seal(value:string,owner:string){
 const key=await secretKey(owner);const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(owner)},key,new TextEncoder().encode(value));
 return btoa(String.fromCharCode(...iv,...new Uint8Array(encrypted)));
}
async function unseal(value:string,owner:string){
 const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:new TextEncoder().encode(owner)},await secretKey(owner),bytes.slice(12)));
}
async function secretKey(owner:string){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.FUSIONSOLAR_PASSWORD+'\n'+owner)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
function apiError(code:number){return code===407?'Huawei го достигна ограничувањето за API повици. Следното преземање ќе се обиде подоцна.':code===20400?'Huawei ја одби API најавата. Проверете ја API сметката.':`Huawei не го исполни барањето (код ${code}).`;}
export async function syncFusion(owner:string,requestedDay=localDate(),options:{active?:boolean;daily?:boolean;evening?:boolean}={}){
 if(!fusionConfigured())return {configured:false,updated:0,error:null};
 if(owner!==fusionOwner())throw new Error('Оваа централа е поврзана со профилот на сопственикот.');
 if(!validDate(requestedDay)||requestedDay>localDate()||requestedDay<FUSION_GRID_DATE)throw new Error('Изберете датум од 03.04.2026 до денес.');
 const connection=db();await ensurePlant(owner);await connection.prepare('INSERT INTO fusion_state (owner) VALUES (?) ON CONFLICT(owner) DO NOTHING').bind(owner).run();
 const lock=crypto.randomUUID(),started=Date.now();
 const locked=await connection.prepare("UPDATE fusion_state SET lock_token=?,lock_until=? WHERE owner=? AND lock_until<? AND COALESCE((state::jsonb->>'lastAttempt')::timestamptz,'epoch'::timestamptz)<?::timestamptz RETURNING state").bind(lock,started+240000,owner,started,new Date(options.active?started-305000:started+1).toISOString()).first<{state:string}>();
 if(!locked)return {configured:true,updated:0,cached:true,error:null};
 const state:State=JSON.parse(locked.state);state.calls??={};state.lastAttempt=new Date(started).toISOString();let updated=0;const errors:string[]=[];
 const persist=()=>connection.prepare('UPDATE fusion_state SET state=? WHERE owner=? AND lock_token=?').bind(JSON.stringify(state),owner,lock).run();
 function available(path:string,interval:number,max:number){const times=(state.calls![path]??[]).filter(t=>t>Date.now()-DAY);state.calls![path]=times;return times.length<max&&(!times.length||Date.now()-times[times.length-1]>=interval);}
 async function reserve(path:string,interval:number,max:number){if(!available(path,interval,max))throw new Error('Следното Huawei преземање е во редица поради API ограничувањето.');state.calls![path].push(Date.now());await persist();}
 let session:{token:string;cookie:string}|null=null;
 async function login(){
  if(session)return session;
  if(state.session&&state.expires&&state.expires>Date.now()+60000){try{session=JSON.parse(await unseal(state.session,owner));if(session)return session;}catch{state.session=undefined;}}
  // A failed password is never retried in a loop; a new login invalidates earlier Huawei tokens.
  await reserve('/thirdData/login',10*60000,144);
  const response=await fetch(FUSION_ORIGIN+'/thirdData/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({userName:env.FUSIONSOLAR_USERNAME,systemCode:env.FUSIONSOLAR_PASSWORD}),signal:AbortSignal.timeout(18000)});
  if(!response.ok)throw new Error('Huawei API серверот не е достапен.');const payload=await response.json() as Envelope;
  if(!payload.success)throw new Error(apiError(payload.failCode));
  const token=response.headers.get('xsrf-token');if(!token)throw new Error('Huawei не врати API токен.');
  const cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');session={token,cookie};state.session=await seal(JSON.stringify(session),owner);state.expires=Date.now()+28*60000;await persist();return session;
 }
 async function call(path:string,body:unknown,interval:number,max:number,key=path){
  const auth=await login();await reserve(key,interval,max);
  const response=await fetch(FUSION_ORIGIN+path,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','Accept':'application/json','XSRF-TOKEN':auth.token,...(auth.cookie?{Cookie:auth.cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(18000)});
  if(!response.ok)throw new Error('Huawei API серверот не одговори успешно.');const payload=await response.json() as Envelope;
  if(!payload.success){if([305,20004].includes(payload.failCode)){state.expires=0;state.session=undefined;}throw new Error(apiError(payload.failCode));}return payload.data;
 }
 async function attempt(work:()=>Promise<void>){try{await work();}catch(error){errors.push(error instanceof Error?error.message:'Неуспешно Huawei преземање.');}}
 async function hours(day:string){
  const prior=await connection.prepare("SELECT payload,updated_at FROM fusion_reports WHERE owner=? AND kind='hour' AND period=?").bind(owner,day).first<{payload:string;updated_at:string}>();
  if(prior&&day<localDate()&&JSON.parse(prior.payload).version===2&&JSON.parse(prior.payload).complete)return;
  if(prior&&Date.now()-Date.parse(prior.updated_at)<(day===localDate()?HOUR:2*HOUR))return;
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
  // History has a shared daily quota. One meter batch per daylight hour and at
  // most eight inverter batches leave capacity within the verified 26/day limit.
  // Fetch only one batch per refresh, respecting the endpoint's minute interval.
  await attempt(async()=>{
   const now=Date.now(),start=new Date(Math.floor(now/HOUR)*HOUR).toISOString();
   const localHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Skopje',hour:'2-digit',hourCycle:'h23'}).format(now));
   if(!options.daily&&(localHour<6||localHour>21||now%HOUR<300000))return;
   const path='/thirdData/getDevHistoryKpi';if(!available(path,60000,26))return;
   const kind=state.meters?.length===1&&available('meter-history',HOUR-60000,16)&&(!state.historyAt?.export||state.historyAt.export<Date.parse(start))?'export':state.devices?.length&&state.devices.length<=10&&available('inverter-history',2*HOUR-60000,8)?'production':null;
   if(!kind)return;
   const ids=kind==='export'?state.meters!:state.devices!;
   const previous=localDate(new Date(Date.parse(slotsForDay(localDate())[0].start)-HOUR));
   const from=Date.parse(slotsForDay(previous)[0].start);
   await reserve(kind==='export'?'meter-history':'inverter-history',kind==='export'?HOUR-60000:2*HOUR-60000,kind==='export'?16:8);
   const values=await call(path,{devIds:ids.join(','),devTypeId:kind==='export'?17:1,startTime:from,endTime:now},60000,26);
   const samples=parseCounterHistory(values,ids,kind==='export'?GRID_EXPORT_COUNTER:'total_cap',from,now);
   const rows=[previous,localDate()].flatMap(day=>counterHours(samples,ids,day,kind));
   if(rows.length)updated+=await saveReadings(owner,rows,'Huawei FusionSolar · device counters',true,true);
   state.anchors??={};const anchor=counterAnchor(samples,ids,start);if(anchor)state.anchors[kind]=anchor;
   state.historyAt??={};state.historyAt[kind]=now;
  });
  const liveStart=new Date(Math.floor(Date.now()/HOUR)*HOUR).toISOString();
  if(state.liveHour?.start!==liveStart)state.liveHour=undefined;
  await attempt(async()=>{
   const key='/thirdData/getDevRealKpi:1';
   if(!state.devices||!available('/thirdData/getStationRealKpi',LIVE_REFRESH_MS,288)||!available(key,LIVE_REFRESH_MS,288)||!available('/thirdData/getDevRealKpi',LIVE_REFRESH_MS,288))return;
   const plant=await call('/thirdData/getStationRealKpi',{stationCodes:FUSION_STATION},LIVE_REFRESH_MS,288);
   const devices=await call('/thirdData/getDevRealKpi',{devIds:state.devices.join(','),devTypeId:1},LIVE_REFRESH_MS,288,key);
   state.live=parseFusionLive(plant,devices,state.devices);state.lastSuccess=new Date().toISOString();
   const productionKwh=liveCounterDelta(devices,state.anchors?.production,'total_cap');
   state.liveHour={start:liveStart,productionKwh,exportKwh:null,observedAt:new Date().toISOString()};
  });
  await attempt(async()=>{
   const key='/thirdData/getDevRealKpi:17';if(state.meters?.length!==1||!available(key,LIVE_REFRESH_MS,288))return;
   const meter=await call('/thirdData/getDevRealKpi',{devIds:state.meters.join(','),devTypeId:17},LIVE_REFRESH_MS,288,key);
   const exportKwh=liveCounterDelta(meter,state.anchors?.export,GRID_EXPORT_COUNTER);
   state.liveHour={start:liveStart,productionKwh:state.liveHour?.productionKwh??null,exportKwh,observedAt:new Date().toISOString()};
  });
  // The daily pass closes yesterday first; active visits refresh today's report.
  await attempt(async()=>{await hours(options.daily?localDate(new Date(Date.parse(slotsForDay(localDate())[0].start)-HOUR)):localDate());});
  if(options.evening){state.error=errors[0]??null;return {configured:true,updated,error:state.error,connected:!!state.live};}
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
  state.error=errors[0]??null;await persist();return {configured:true,updated,error:state.error,connected:!!state.live};
 }finally{
  await persist();await connection.prepare('UPDATE fusion_state SET lock_until=0,lock_token=NULL WHERE owner=? AND lock_token=?').bind(owner,lock).run();
 }
}
