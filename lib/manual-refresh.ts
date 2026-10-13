import 'server-only';
import {getUser,authLimit,sameOrigin} from './auth';
import {isAdmin} from './roles';
import {readJson,RequestError} from './request-security';
import {localDate,validDate,slotsForDay} from './energy';
import {syncFusion} from './fusionsolar-server';
import {syncMemo} from './solar-server';
import {mutateAndCache} from './solar-cache';
import type {RefreshSource,RefreshItem,ManualRefreshResult} from './manual-refresh-result';

const pendingMemo='MEMO сè уште нема објавено целосни часовни цени за овој датум.';
const plantBusy='Податоците веќе се дополнуваат. Обидете се повторно.';

export async function runManualRefresh(owner:string,source:RefreshSource,day:string,now=new Date()):Promise<ManualRefreshResult>{
 const today=localDate(now),tomorrow=localDate(slotsForDay(today).at(-1)!.end);
 const items:RefreshItem[]=[];
 if(source==='overview'){
  try{
   // Same collector and plant lease as cron; provider quotas remain in force.
   // The short pass refreshes current measurements without starting history backfill.
   const result=await syncFusion(owner,today,{manual:true,evening:true});
   const productionThrough='productionThrough' in result?result.productionThrough:undefined;
   const delayed=productionThrough!==undefined&&(productionThrough===null||Date.parse(productionThrough)<Math.floor(now.getTime()/3600000)*3600000);
   items.push({source:'Huawei',day:today,updated:result.updated,
    status:!result.configured?'unconfigured':'busy' in result&&result.busy?'busy':result.error?'error':delayed?'partial':('liveUpdated' in result&&result.liveUpdated)||result.updated>0?'updated':'cached',
    ...(productionThrough!==undefined?{productionThrough}:{}),
    lastSuccess:'lastSuccess' in result?result.lastSuccess:null});
  }catch{items.push({source:'Huawei',day:today,status:'error',updated:0});}
 }
 const dates=[...new Set([source==='overview'?today:day,tomorrow])];
 try{
  const memo=await mutateAndCache(owner,async()=>{
   const results:RefreshItem[]=[];
   for(const date of dates){
    try{
     const result=await syncMemo(date,true);
     results.push({source:'MEMO',day:date,updated:result.updated,
      status:result.error===pendingMemo?'pending':result.error?'error':result.cached?'cached':'updated'});
    }catch{results.push({source:'MEMO',day:date,status:'error',updated:0});}
   }
   return results;
  });
  items.push(...memo);
 }catch(error){
  // A failed snapshot publication must not be presented as a successful refresh.
  const status=error instanceof Error&&error.message===plantBusy?'busy':'error';
  items.push(...dates.map((date):RefreshItem=>({source:'MEMO',day:date,status,updated:0})));
 }
 return {source,items};
}

export async function handleManualRefresh(request:Request,now=new Date()){
 const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
 try{
  // Fresh authorization also covers an admin whose role was just revoked.
  const user=await getUser(true);
  if(!user)return json({error:'Најавете се за пристап до податоците.'},401);
  if(!isAdmin(user))return json({error:'Вашата сметка има пристап само за преглед.'},403);
  if(!sameOrigin(request))return json({error:'Невалидно потекло на барањето.'},403);
  const body=await readJson(request,1024);
  if(body.source!=='overview'&&body.source!=='market')return json({error:'Непозната операција.'},400);
  const today=localDate(now),tomorrow=localDate(slotsForDay(today).at(-1)!.end);
  const day=body.source==='overview'?today:body.date;
  if(!validDate(day)||day<'2023-01-01'||day>tomorrow)return json({error:'Невалиден датум.'},400);
  if(!await authLimit('solar-manual-refresh:'+user.userId,15))return json({error:'Премногу барања. Обидете се подоцна.'},429);
  return json(await runManualRefresh(user.plantOwner,body.source,day,now));
 }catch(error){
  if(error instanceof RequestError)return json({error:error.message},error.status);
  return json({error:'Освежувањето не успеа.'},502);
 }
}
