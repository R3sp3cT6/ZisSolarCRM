import {slotsForDay,type ReadingInput} from './energy';
import {energyValue} from './fusionsolar';

export const LIVE_REFRESH_MS=305000;
export const HOUR_MS=3600000;
// Verified against this plant's hourly ongrid_power: 14 and 96 kWh on 09.09.2026.
// Meter direction is installation-specific; never substitute reverse_active_cap.
export const GRID_EXPORT_COUNTER='active_cap';
export type CounterSample={at:number;id:number;counter:number|null};
export type CounterAnchor={start:string;values:{id:number;counter:number}[]};
export type LiveHour={start:string;productionKwh:number|null;exportKwh:number|null;observedAt:string};

export function parseCounterHistory(input:unknown,ids:number[],field:'total_cap'|'active_cap',from:number,to:number,now=Date.now()):CounterSample[]{
 if(!Array.isArray(input)||!ids.length||new Set(ids).size!==ids.length)throw Error('Невалидна историја на бројачи.');
 const allowed=new Set(ids),seen=new Set<string>();
 return input.map(point=>{
  const {devId,collectTime,dataItemMap}=point??{};
  if(!allowed.has(devId)||!Number.isSafeInteger(collectTime)||collectTime%300000!==0||collectTime<from||collectTime>to||collectTime>now)throw Error('Неусогласено мерење од бројач.');
  const key=devId+':'+collectTime;if(seen.has(key))throw Error('Повторено мерење од бројач.');seen.add(key);
  return {id:devId,at:collectTime,counter:energyValue(dataItemMap?.[field])};
 }).sort((a,b)=>a.at-b.at||a.id-b.id);
}

export function counterAnchor(samples:CounterSample[],ids:number[],start:string):CounterAnchor|null{
 const at=Date.parse(start),values=ids.map(id=>samples.find(p=>p.at===at&&p.id===id));
 if(values.some(p=>!p||p.counter===null))return null;
 return {start,values:values.map(p=>({id:p!.id,counter:p!.counter!}))};
}

export function counterDelta(start:CounterAnchor,end:CounterAnchor):number|null{
 if(start.values.length!==end.values.length||!start.values.length)return null;
 let sum=0;
 for(const first of start.values){
  const last=end.values.find(p=>p.id===first.id);
  if(!last||last.counter<first.counter)return null;
  sum+=last.counter-first.counter;
 }
 // Device counters expose up to three decimal places; avoid binary subtraction noise.
 return Math.round(sum*1000)/1000;
}

export function counterHours(samples:CounterSample[],ids:number[],day:string,kind:'production'|'export',now=new Date()):ReadingInput[]{
 const rows:ReadingInput[]=[];
 for(const slot of slotsForDay(day)){
  if(Date.parse(slot.end)>now.getTime())continue;
  const first=counterAnchor(samples,ids,slot.start),last=counterAnchor(samples,ids,slot.end);
  if(!first||!last)continue;
  // A reset anywhere between the boundaries invalidates the difference.
  const window=samples.filter(p=>p.at>=Date.parse(slot.start)&&p.at<=Date.parse(slot.end));
  const reset=ids.some(id=>{let previous:number|null=null;return window.filter(p=>p.id===id).some(p=>{if(p.counter===null)return false;const declined=previous!==null&&p.counter<previous;previous=p.counter;return declined;});});
  const value=reset?null:counterDelta(first,last);if(value===null)continue;
  rows.push({start:slot.start,productionKwh:kind==='production'?value:null,exportKwh:kind==='export'?value:null,powerKw:null,observedAt:now.toISOString()});
 }
 return rows;
}

export function liveCounterDelta(input:unknown,anchor:CounterAnchor|null|undefined,field:'total_cap'|'active_cap',now=Date.now()):number|null{
 if(!anchor||Date.parse(anchor.start)!==Math.floor(now/HOUR_MS)*HOUR_MS||!Array.isArray(input)||input.length!==anchor.values.length)return null;
 const ids=new Set(input.map(p=>p.devId));
 if(ids.size!==anchor.values.length)return null;
 const values=input.map(p=>({id:p.devId,counter:energyValue(p.dataItemMap?.[field])}));
 if(values.some(p=>p.counter===null))return null;
 return counterDelta(anchor,{start:new Date(now).toISOString(),values:values as CounterAnchor['values']});
}

export function readingCoverage(starts:string[],from:string,to:string,now=Date.now()){
 const first=Date.parse(from),end=Math.min(Date.parse(to),Math.floor(now/HOUR_MS)*HOUR_MS);
 const measured=new Set(starts),missingStarts:string[]=[];
 for(let at=first;at+HOUR_MS<=end;at+=HOUR_MS){const start=new Date(at).toISOString();if(!measured.has(start))missingStarts.push(start);}
 return {expected:Math.max(0,Math.floor((end-first)/HOUR_MS)),missing:missingStarts.length,missingStarts};
}
