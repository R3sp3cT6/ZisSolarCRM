import {withDatabaseUsage} from '@/lib/database-usage';
import {getCachedDashboard,mutateAndCache} from '@/lib/solar-cache';
import {readJson,RequestError} from '@/lib/request-security';
import {getUser,authLimit} from '@/lib/auth';
import {isAdmin} from '@/lib/roles';
import {saveReadings,syncMemo,db,ensurePlant} from '@/lib/solar-server';
import {localDate,validDate,validateReadings,type Period} from '@/lib/energy';
import {syncFusion} from '@/lib/fusionsolar-server';
export const dynamic='force-dynamic';
export const maxDuration=240;
export const runtime='nodejs';
function json(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});}
export async function GET(request:Request){return withDatabaseUsage(async()=>{
 const user=await getUser();if(!user)return json({error:'Најавете се за пристап до податоците.'},401);
 try{const params=new URL(request.url).searchParams;const day=params.get('date')??localDate();const period=(params.get('period')??'day') as Period;return json(await getCachedDashboard(user.plantOwner,day,period,params.get('hour')??undefined));}
 catch(error){console.error('Dashboard query failed');return json({error:'Податоците не може да се вчитаат. Проверете го избраниот период и обидете се повторно.'},400);}
});}
export async function POST(request:Request){
 const user=await getUser(true);if(!user)return json({error:'Најавете се за пристап до податоците.'},401);
 if(!isAdmin(user))return json({error:'Вашата сметка има пристап само за преглед.'},403);
 const origin=request.headers.get('Origin');if(origin!==new URL(request.url).origin)return json({error:'Невалидно потекло на барањето.'},403);
 if(Number(request.headers.get('Content-Length')??0)>500000)return json({error:'Внесот е преголем.'},413);
 try{if(!await authLimit('solar-write:'+user.userId,120))return json({error:'Премногу барања. Обидете се подоцна.'},429);const body=await readJson(request,500000);
  if(body.action==='sync'){if(!validDate(body.date))return json({error:'Невалиден датум.'},400);return json(await mutateAndCache(user.plantOwner,()=>syncMemo(body.date,body.force===true))); }
  if(body.action==='fusion'){return json(await syncFusion(user.plantOwner,body.date??localDate()));}
  if(body.action==='import'){const readings=validateReadings(body.readings);const count=await mutateAndCache(user.plantOwner,()=>saveReadings(user.plantOwner,readings,body.source==='csv'?'CSV':'Рачен внес')); return json({saved:count});}
  if(body.action==='plant'){if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100)return json({error:'Внесете име до 100 знаци.'},400);const cap=body.capacityKw;if(cap!==null&&(typeof cap!=='number'||!Number.isFinite(cap)||cap<=0||cap>10000000))return json({error:'Внесете валидна инсталирана моќност.'},400);await mutateAndCache(user.plantOwner,async()=>{await ensurePlant(user.plantOwner);await db().prepare('UPDATE plants SET name=?,capacity_kw=? WHERE owner=?').bind(body.name.trim(),cap,user.plantOwner).run();});return json({saved:true});}
  return json({error:'Непозната операција.'},400);
 }catch(error){if(error instanceof RequestError)return json({error:error.message},error.status);console.error('Solar mutation failed');return json({error:'Податоците не се зачувани. Проверете го внесот и обидете се повторно.'},400);}
}
