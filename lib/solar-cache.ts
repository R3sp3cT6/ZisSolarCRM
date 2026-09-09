import 'server-only';
import {cacheRead,cacheWrite,sharedCache,withCacheLock} from './shared-cache';
import {archiveDue,LIVE_INTERVAL_MS,type Activity} from './cache-policy';
import {loadDashboardSnapshot,saveReadings,getDashboard} from './solar-server';
import {buildDashboard,type DashboardSnapshot} from './dashboard';
import {syncFusionDirect,fusionConfigured,fusionOwner} from './fusionsolar-server';
import {collectTelemetry,fusionClient,type FusionState} from './fusion-client';
import {localDate,rangeFor,type Period,type ReadingInput} from './energy';

export type PendingBatch={id:string;rows:ReadingInput[]};
const pendingKey=(owner:string)=>'pending:'+owner;

// Counter readings remain in durable Redis until each database transaction succeeds.
// fillOnly makes replay after an interrupted acknowledgement idempotent.
export async function flushPending(owner:string){
 const batches=await cacheRead<PendingBatch[]>(pendingKey(owner))??[];
 let written=0;
 for(let i=0;i<batches.length;i++){
  written+=await saveReadings(owner,batches[i].rows,'Huawei FusionSolar · device counters',true,true);
  await cacheWrite(pendingKey(owner),batches.slice(i+1));
 }
 return written;
}
async function queueReadings(owner:string,rows:ReadingInput[]){
 const batches=await cacheRead<PendingBatch[]>(pendingKey(owner))??[];
 await cacheWrite(pendingKey(owner),[...batches,{id:crypto.randomUUID(),rows}]);
 return rows.length;
}
export function overlayPending(snapshot:DashboardSnapshot,batches:PendingBatch[],state:FusionState|null){
 const rows=new Map(snapshot.readings.map(r=>[r.start,{...r}]));
 for(const batch of batches)for(const r of batch.rows){
  const prior=rows.get(r.start);
  if(prior){prior.production_kwh??=r.productionKwh;prior.export_kwh??=r.exportKwh;prior.power_kw??=r.powerKw;}
  else rows.set(r.start,{start:r.start,production_kwh:r.productionKwh,export_kwh:r.exportKwh,power_kw:r.powerKw,observed_at:r.observedAt,updated_at:r.observedAt,source:'Huawei FusionSolar · device counters'});
 }
 return {...snapshot,readings:[...rows.values()].sort((a,b)=>a.start.localeCompare(b.start)),fusionState:state?{live:state.live,liveHour:state.liveHour,lastSuccess:state.lastSuccess,error:state.error}:snapshot.fusionState};
}
export async function rebuildSnapshot(owner:string){
 const snapshot=await loadDashboardSnapshot(owner);
 await cacheWrite('dashboard:'+owner,snapshot,7*86400);
 return snapshot;
}
export async function mutateAndCache<T>(owner:string,work:()=>Promise<T>){
 const result=await withCacheLock('plant:'+owner,async()=>{const value=await work();await rebuildSnapshot(owner);return value;});
 if(result.busy)throw Error('Податоците веќе се дополнуваат. Обидете се повторно.');
 return result.value;
}
async function archive(owner:string,day:string,options:{active?:boolean;daily?:boolean;evening?:boolean}){
 const queued=await flushPending(owner);
 const result=await syncFusionDirect(owner,day,options);
 await rebuildSnapshot(owner);
 const previous=await cacheRead<Activity>('activity:'+owner);
 await cacheWrite('activity:'+owner,{lastActive:previous?.lastActive??0,lastArchived:Date.now()});
 return {...result,updated:result.updated+queued,storage:'database' as const};
}
export async function syncAndCache(owner:string,day:string,options:{active?:boolean;daily?:boolean;evening?:boolean}={}){
 if(!sharedCache())return syncFusionDirect(owner,day,options);
 const result=await withCacheLock('plant:'+owner,()=>archive(owner,day,options));
 return result.busy?{configured:fusionConfigured(),updated:0,cached:true,busy:true,error:null}:result.value;
}
export async function refreshActive(owner:string){
 if(!sharedCache())return syncFusionDirect(owner,localDate(),{active:true});
 if(!fusionConfigured())return {configured:false,updated:0,error:null};
 if(owner!==fusionOwner())throw Error('Невалидна централа.');
 const result=await withCacheLock('plant:'+owner,async()=>{
  const now=Date.now(),activity=await cacheRead<Activity>('activity:'+owner);
  await cacheWrite('activity:'+owner,{lastActive:now,lastArchived:activity?.lastArchived??0});
  const [state,snapshot]=await Promise.all([cacheRead<FusionState>('fusion:'+owner),cacheRead<DashboardSnapshot>('dashboard:'+owner)]);
  if(archiveDue(activity,now)||!snapshot||!state?.devicesAt||now-state.devicesAt>=86400000){
   return archive(owner,localDate(),{active:true});
  }
  if(now-Date.parse(state.lastAttempt??'1970-01-01')<LIVE_INTERVAL_MS)return {configured:true,updated:0,cached:true,error:state.error??null,storage:'cache' as const};
  state.lastAttempt=new Date(now).toISOString();
  const persist=()=>cacheWrite('fusion:'+owner,state);
  // Reservations are durably saved before Huawei calls, even on request failure.
  await persist();
  const telemetry=await collectTelemetry(state,fusionClient(owner,state,persist),rows=>queueReadings(owner,rows));
  state.error=telemetry.error;await persist();
  return {configured:true,updated:telemetry.updated,error:telemetry.error,connected:!!state.live,storage:'cache' as const};
 });
 return result.busy?{configured:true,updated:0,cached:true,busy:true,error:null}:result.value;
}
export async function getCachedDashboard(owner:string,day:string,period:Period,hour?:string){
 rangeFor(day,period,hour);
 if(!sharedCache())return {...await getDashboard(owner,day,period,hour),storage:'database' as const};
 let snapshot=await cacheRead<DashboardSnapshot>('dashboard:'+owner);
 if(!snapshot){
  const loaded=await withCacheLock('plant:'+owner,()=>rebuildSnapshot(owner));
  if(loaded.busy){
   // Another visitor is already restoring the shared snapshot. Do not stampede Neon.
   snapshot=await cacheRead<DashboardSnapshot>('dashboard:'+owner);
   if(!snapshot)throw Error('Податоците се дополнуваат. Обидете се повторно за неколку секунди.');
  }else snapshot=loaded.value;
 }
 if(snapshot.owner!==owner)throw Error('Невалиден кеш за централата.');
 const [state,batches]=await Promise.all([cacheRead<FusionState>('fusion:'+owner),cacheRead<PendingBatch[]>(pendingKey(owner))]);
 return {...buildDashboard(overlayPending(snapshot,batches??[],state),day,period,hour),storage:'cache' as const,archivedAt:snapshot.savedAt};
}
