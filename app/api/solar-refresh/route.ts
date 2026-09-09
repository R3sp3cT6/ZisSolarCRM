import {withDatabaseUsage} from '@/lib/database-usage';
import {getUser,authLimit} from '@/lib/auth';
import {refreshActive} from '@/lib/solar-cache';
import {refreshLimit} from '@/lib/session-cache';
import {sharedCache} from '@/lib/shared-cache';
export const dynamic='force-dynamic';
export const maxDuration=240;
export const runtime='nodejs';

// Viewers may trigger a server-controlled refresh, never supply measurements,
// credentials, plant IDs, dates or configuration changes.
export async function POST(request:Request){return withDatabaseUsage(async()=>{
 const user=await getUser();
 if(!user)return Response.json({error:'Најавете се за пристап.'},{status:401});
 if(request.headers.get('Origin')!==new URL(request.url).origin)return Response.json({error:'Невалидно потекло на барањето.'},{status:403});
 if(!(sharedCache()?await refreshLimit(user.userId):await authLimit('solar-refresh:'+user.userId,30)))return Response.json({error:'Премногу освежувања. Обидете се подоцна.'},{status:429});
 try{
  return Response.json(await refreshActive(user.plantOwner),{headers:{'Cache-Control':'private, no-store'}});
 }catch{
  return Response.json({error:'Освежувањето не успеа. Зачуваните податоци остануваат достапни.'},{status:502});
 }
});}
