import {getUser,authLimit} from '@/lib/auth';
import {syncFusion} from '@/lib/fusionsolar-server';
import {localDate} from '@/lib/energy';
export const dynamic='force-dynamic';
export const maxDuration=240;
export const runtime='nodejs';

// Viewers may trigger a server-controlled refresh, never supply measurements,
// credentials, plant IDs, dates or configuration changes.
export async function POST(request:Request){
 const user=await getUser();
 if(!user)return Response.json({error:'Најавете се за пристап.'},{status:401});
 if(request.headers.get('Origin')!==new URL(request.url).origin)return Response.json({error:'Невалидно потекло на барањето.'},{status:403});
 if(!await authLimit('solar-refresh:'+user.userId,30))return Response.json({error:'Премногу освежувања. Обидете се подоцна.'},{status:429});
 try{
  return Response.json(await syncFusion(user.plantOwner,localDate(),{active:true}),{headers:{'Cache-Control':'private, no-store'}});
 }catch{
  return Response.json({error:'Освежувањето не успеа. Зачуваните податоци остануваат достапни.'},{status:502});
 }
}
