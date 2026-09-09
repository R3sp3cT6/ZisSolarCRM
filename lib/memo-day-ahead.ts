import 'server-only';
import {localDate,localHour,slotsForDay} from './energy';
import {secretMatches} from './password';
import {db,syncMemo} from './solar-server';
import {cacheRead,cacheWrite,withCacheLock} from './shared-cache';
import {rebuildSnapshot} from './solar-cache';

export function nextMarketDay(now=new Date()){
 // Advance the local calendar day, including 23/25-hour days at DST changes.
 return localDate(slotsForDay(localDate(now)).at(-1)!.end);
}
export function memoSyncTime(now=new Date()){
 const hour=localHour(now.toISOString());
 return hour===11||hour===12;
}
export function completeMarketDay(day:string,starts:string[]){
 const expected=slotsForDay(day),actual=new Set(starts);
 return actual.size===expected.length&&expected.every(slot=>actual.has(slot.start));
}

export async function syncMemoDayAhead(owner:string,now=new Date()){
 if(!owner)throw Error('Недостасува сопственикот на централата.');
 const day=nextMarketDay(now),key=`memo-day-ahead:${owner}:${day}`;
 const done=()=>({day,updated:0,complete:true,cached:true,error:null});
 if(await cacheRead(key))return done();
 const result=await withCacheLock('plant:'+owner,async()=>{
  // The same plant lease also protects snapshot rebuilds, imports and Huawei sync.
  if(await cacheRead(key))return done();
  const memo=await syncMemo(day);
  const {results}=await db().prepare('SELECT start FROM prices WHERE market_date=?').bind(day).all<{start:string}>();
  const complete=!memo.error&&completeMarketDay(day,results.map(row=>row.start));
  // Publish first. A failed rebuild must remain retryable even if SQL was saved.
  await rebuildSnapshot(owner);
  if(complete)await cacheWrite(key,{completedAt:new Date().toISOString()},3*86400);
  return {...memo,day,complete,error:memo.error??(complete?null:'MEMO сè уште нема објавено целосни часовни цени за овој датум.')};
 });
 return result.busy?{day,updated:0,complete:false,busy:true,error:'Податоците веќе се дополнуваат. Следниот cron ќе се обиде повторно.'}:result.value;
}

export async function handleMemoCron(request:Request,scheduled=true,now=new Date()){
 const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(!secretMatches(request.headers.get('authorization'),process.env.CRON_SECRET?'Bearer '+process.env.CRON_SECRET:undefined))return new Response('Unauthorized',{status:401});
 // Vercel schedules are UTC. The unused seasonal invocation exits before cache/SQL.
 if(scheduled&&!memoSyncTime(now))return json({skipped:true});
 const owner=process.env.FUSIONSOLAR_OWNER;
 if(!owner)return json({error:'Не е конфигурирана централа.'},503);
 try{
  const result=await syncMemoDayAhead(owner,now);
  return json(result,result.complete?200:'busy' in result?503:502);
 }catch{return json({error:'Преземањето на MEMO цените не успеа.'},502);}
}
