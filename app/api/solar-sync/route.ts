import {fusionConfigured,fusionOwner,syncFusion} from '@/lib/fusionsolar-server';
import {syncMemo,db} from '@/lib/solar-server';
import {localDate} from '@/lib/energy';
import {secretMatches} from '@/lib/password';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=240;
export async function GET(request:Request){
 if(!secretMatches(request.headers.get('authorization'),process.env.CRON_SECRET?'Bearer '+process.env.CRON_SECRET:undefined))return new Response('Unauthorized',{status:401});
 if(!fusionConfigured())return Response.json({error:'Huawei не е конфигуриран.'},{status:503});
 const id=crypto.randomUUID();
 try{
  await db().prepare("INSERT INTO collector_runs(id,status) VALUES (?,'running')").bind(id).run();
  const memo=await syncMemo(localDate());const fusion=await syncFusion(fusionOwner()!,localDate());
  const status=memo.error||fusion.error?'partial':'success';
  await db().prepare('UPDATE collector_runs SET status=?,completed_at=now(),detail=? WHERE id=?').bind(status,JSON.stringify({memo,fusion}),id).run();
  await db().batch([db().prepare("DELETE FROM collector_runs WHERE started_at<now()-interval '30 days'"),db().prepare('DELETE FROM auth_limits WHERE reset_at<now()'),db().prepare('DELETE FROM sessions WHERE expires_at<now()')]);
  return Response.json({memo,fusion},{status:status==='success'?200:502,headers:{'Cache-Control':'no-store'}});
 }catch{await db().prepare("UPDATE collector_runs SET status='error',completed_at=now() WHERE id=?").bind(id).run().catch(()=>{});return Response.json({error:'Синхронизацијата не успеа.'},{status:502});}
}
export const POST=GET;
