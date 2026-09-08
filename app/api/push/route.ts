import {createHash} from 'node:crypto';
import {getUser,authLimit,sameOrigin} from '@/lib/auth';
import {db} from '@/db';
import {readJson,RequestError} from '@/lib/request-security';
import {validSubscription} from '@/lib/push-policy';
export const dynamic='force-dynamic';
export async function GET(){const user=await getUser();if(!user)return new Response('Unauthorized',{status:401});const subscriptions=await db().prepare('SELECT id FROM push_subscriptions WHERE user_id=?').bind(user.userId).all<{id:string}>();return Response.json({publicKey:process.env.VAPID_PUBLIC_KEY??null,subscriptionIds:subscriptions.results.map(s=>s.id)},{headers:{'Cache-Control':'private, no-store'}});}
export async function POST(request:Request){
 const user=await getUser();if(!user)return new Response('Unauthorized',{status:401});
 if(!sameOrigin(request))return new Response('Forbidden',{status:403});
 if(!await authLimit('push:'+user.userId,20))return new Response('Too many requests',{status:429});
 try{
  const body=await readJson(request,5000);
  if(!validSubscription(body.subscription)||!['subscribe','unsubscribe'].includes(body.action)||!['mk','en'].includes(body.language))return new Response('Invalid subscription',{status:400});
  const s=body.subscription,id=createHash('sha256').update(s.endpoint).digest('hex');
  if(body.action==='unsubscribe'){await db().prepare('DELETE FROM push_subscriptions WHERE id=? AND user_id=?').bind(id,user.userId).run();return Response.json({ok:true});}
  if(!process.env.VAPID_PRIVATE_KEY||!process.env.VAPID_PUBLIC_KEY)return new Response('Push unavailable',{status:503});
  await db().prepare('INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,language) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,language=excluded.language').bind(id,user.userId,s.endpoint,s.keys.p256dh,s.keys.auth,body.language).run();
  return Response.json({ok:true});
 }catch(e){return Response.json({error:'Notification settings could not be saved.'},{status:e instanceof RequestError?e.status:500});}
}
