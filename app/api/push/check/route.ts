import {secretMatches} from '@/lib/password';
import {reportTime} from '@/lib/push-policy';
import {fusionOwner,syncFusion,fusionConfigured} from '@/lib/fusionsolar-server';
import {sendDailyPush} from '@/lib/push-server';
import {db} from '@/db';
import {localDate} from '@/lib/energy';
export const dynamic='force-dynamic';
export const maxDuration=240;
export async function GET(request:Request){
 if(!secretMatches(request.headers.get('authorization'),process.env.CRON_SECRET?'Bearer '+process.env.CRON_SECRET:undefined))return new Response('Unauthorized',{status:401});
 if(!reportTime()||!fusionConfigured())return Response.json({skipped:true});
 const owner=fusionOwner()!;
 const pending=await db().prepare("SELECT s.id FROM push_subscriptions s JOIN users u ON u.id=s.user_id LEFT JOIN push_deliveries d ON d.subscription_id=s.id AND d.day=? WHERE u.active=true AND u.plant_owner=? AND (d.status IS NULL OR (d.status!='sent' AND d.attempts<3)) LIMIT 1").bind(localDate(),owner).first();
 if(!pending)return Response.json({skipped:true});
 await syncFusion(owner,localDate(),{active:true,evening:true});
 const result=await sendDailyPush(owner);
 return Response.json(result,{status:'failed' in result&&result.failed?502:200});
}
