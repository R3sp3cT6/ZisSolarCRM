import 'server-only';
import {localDate,slotsForDay,type ReadingInput} from './energy';
import {FUSION_ORIGIN,FUSION_STATION,parseFusionLive} from './fusionsolar';
import {LIVE_REFRESH_MS,GRID_EXPORT_COUNTER,parseCounterHistory,counterAnchor,counterHours,liveCounterDelta,type CounterAnchor,type LiveHour} from './fusion-telemetry';
import {liveObservation,type LiveObservation} from './forecast-trial';
const env=process.env,HOUR=3600000,DAY=24*HOUR;
export type FusionState={forecastObservation?:LiveObservation|null;calls?:Record<string,number[]>;session?:string;expires?:number;devices?:number[];meters?:number[];devicesAt?:number;live?:ReturnType<typeof parseFusionLive>;liveHour?:LiveHour;anchors?:{production?:CounterAnchor;export?:CounterAnchor};historyAt?:{production?:number;export?:number};lastSuccess?:string;error?:string|null;lastHour?:number;lastBackfill?:number;lastAttempt?:string};
type Envelope={success:boolean;failCode:number;data:any;params?:Record<string,unknown>};
async function seal(value:string,owner:string){
 const key=await secretKey(owner);const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(owner)},key,new TextEncoder().encode(value));
 return btoa(String.fromCharCode(...iv,...new Uint8Array(encrypted)));
}
async function unseal(value:string,owner:string){
 const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:new TextEncoder().encode(owner)},await secretKey(owner),bytes.slice(12)));
}
async function secretKey(owner:string){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.FUSIONSOLAR_PASSWORD+'\n'+owner)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
function apiError(code:number){return code===407?'Huawei го достигна ограничувањето за API повици. Следното преземање ќе се обиде подоцна.':code===20400?'Huawei ја одби API најавата. Проверете ја API сметката.':`Huawei не го исполни барањето (код ${code}).`;}

export function fusionClient(owner:string,state:FusionState,persist:()=>Promise<unknown>){
 state.calls??={};
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

 return {available,reserve,call};
}
export async function collectTelemetry(state:FusionState,api:ReturnType<typeof fusionClient>,save:(rows:ReadingInput[])=>Promise<number>,daily=false,onProductionHistory?:(values:unknown,ids:number[],receivedAt:Date)=>Promise<void>){
 const {available,reserve,call}=api;let updated=0;const errors:string[]=[];
 async function attempt(work:()=>Promise<void>){try{await work();}catch(error){errors.push(error instanceof Error?error.message:'Неуспешно Huawei преземање.');}}
  // Both series need a boundary for the current hour. Share the 26/day quota
  // equally and fetch the oldest eligible series, one batch per refresh.
  // An arbitrary two-hour inverter delay leaves production blank on alternate hours.
  await attempt(async()=>{
   const now=Date.now(),start=new Date(Math.floor(now/HOUR)*HOUR).toISOString();
   const localHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Skopje',hour:'2-digit',hourCycle:'h23'}).format(now));
   if(!daily&&(localHour<6||localHour>21||now%HOUR<300000))return;
   const path='/thirdData/getDevHistoryKpi';if(!available(path,60000,26))return;
   const kind=(['production','export'] as const).filter(kind=>{
    const supported=kind==='export'?state.meters?.length===1:!!state.devices?.length&&state.devices.length<=10;
    return supported&&(!state.historyAt?.[kind]||state.historyAt[kind]!<Date.parse(start))&&available(kind==='export'?'meter-history':'inverter-history',HOUR-60000,13);
   }).sort((a,b)=>(state.historyAt?.[a]??0)-(state.historyAt?.[b]??0))[0];
   if(!kind)return;
   const ids=kind==='export'?state.meters!:state.devices!;
   const previous=localDate(new Date(Date.parse(slotsForDay(localDate())[0].start)-HOUR));
   const from=Date.parse(slotsForDay(previous)[0].start);
   await reserve(kind==='export'?'meter-history':'inverter-history',HOUR-60000,13);
   const values=await call(path,{devIds:ids.join(','),devTypeId:kind==='export'?17:1,startTime:from,endTime:now},60000,26);
   const samples=parseCounterHistory(values,ids,kind==='export'?GRID_EXPORT_COUNTER:'total_cap',from,now);
   if(kind==='production'&&onProductionHistory){try{await onProductionHistory(values,ids,new Date());}catch{console.warn('Historical trial observations deferred');}}
   const rows=[previous,localDate()].flatMap(day=>counterHours(samples,ids,day,kind));
   if(rows.length)updated+=await save(rows);
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
   state.forecastObservation=liveObservation(devices,state.devices);
   const productionKwh=liveCounterDelta(devices,state.anchors?.production,'total_cap');
   state.liveHour={start:liveStart,productionKwh,exportKwh:null,observedAt:new Date().toISOString()};
  });
  await attempt(async()=>{
   const key='/thirdData/getDevRealKpi:17';if(state.meters?.length!==1||!available(key,LIVE_REFRESH_MS,288))return;
   const meter=await call('/thirdData/getDevRealKpi',{devIds:state.meters.join(','),devTypeId:17},LIVE_REFRESH_MS,288,key);
   const exportKwh=liveCounterDelta(meter,state.anchors?.export,GRID_EXPORT_COUNTER);
   state.liveHour={start:liveStart,productionKwh:state.liveHour?.productionKwh??null,exportKwh,observedAt:new Date().toISOString()};
  });

 return {updated,error:errors[0]??null};
}
