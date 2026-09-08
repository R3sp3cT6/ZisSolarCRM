import 'server-only';
import webpush from 'web-push';
import {db} from '../db/index';
import {getDashboard} from './solar-server';
import {localDate} from './energy';
import {reportTime} from './push-policy';
import type {parseFusionLive} from './fusionsolar';
export async function sendDailyPush(owner:string){
 const state=await db().prepare('SELECT state FROM fusion_state WHERE owner=?').bind(owner).first<{state:string}>();
 const live=state?(JSON.parse(state.state).live as ReturnType<typeof parseFusionLive>):null;
 if(!reportTime())return {sent:0,reason:'awaiting-21-local'};
 if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return {sent:0,reason:'not-configured'};
 const day=localDate();
 const subscriptions=await db().prepare("SELECT s.* FROM push_subscriptions s JOIN users u ON u.id=s.user_id WHERE u.active=true AND u.plant_owner=?").bind(owner).all<{id:string;endpoint:string;p256dh:string;auth:string;language:'mk'|'en'}>();
 if(!subscriptions.results.length)return {sent:0,reason:'no-subscribers'};
 const [daily,monthly]=await Promise.all([getDashboard(owner,day,'day'),getDashboard(owner,day,'month')]);
 let sent=0,failed=0;
 for(const s of subscriptions.results){
  const claim=await db().prepare("INSERT INTO push_deliveries(subscription_id,day,status) VALUES(?,?,'sending') ON CONFLICT(subscription_id,day) DO UPDATE SET status='sending',attempts=push_deliveries.attempts+1,updated_at=now() WHERE push_deliveries.status!='sent' AND push_deliveries.attempts<3 AND push_deliveries.updated_at<now()-interval '10 minutes' RETURNING day").bind(s.id,day).first();
  if(!claim)continue;
  const en=s.language==='en',fmt=(v:number|null)=>v===null?'—':new Intl.NumberFormat(en?'en-GB':'mk-MK',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
  const partial=(data:typeof daily)=>data.totals.missing>0||data.totals.unpriced>0||data.totals.unmetered>0;
  const income=(data:typeof daily)=>(partial(data)?'≈':'')+fmt(data.totals.revenue)+' €';
  const body=`${en?'Today':'Денес'}: ${fmt(daily.totals.productionKwh===null?null:daily.totals.productionKwh/1000)} MWh · ${income(daily)}\n${en?'This month':'Овој месец'}: ${fmt((live?.monthProductionKwh??monthly.totals.productionKwh)===null?null:(live?.monthProductionKwh??monthly.totals.productionKwh)!/1000)} MWh · ${income(monthly)}${partial(daily)||partial(monthly)?'\n'+(en?'≈ Partial revenue':'≈ Делумен приход'):''}`;
  try{
   await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify({title:`ZIS Solar · ${day}`,body,tag:'zis-daily-'+day,url:'/'}),{TTL:43200,timeout:10000,vapidDetails:{subject:'https://zissolar.vercel.app',publicKey:process.env.VAPID_PUBLIC_KEY,privateKey:process.env.VAPID_PRIVATE_KEY}});
   await db().prepare("UPDATE push_deliveries SET status='sent',updated_at=now() WHERE subscription_id=? AND day=?").bind(s.id,day).run();sent++;
  }catch(error){
   const status=(error as {statusCode?:number}).statusCode;
   if(status===404||status===410)await db().prepare('DELETE FROM push_subscriptions WHERE id=?').bind(s.id).run();
   else await db().prepare("UPDATE push_deliveries SET status='failed',updated_at=now() WHERE subscription_id=? AND day=?").bind(s.id,day).run();
   failed++;
  }
 }
 return {sent,failed};
}
