import {getTimes} from 'suncalc';
import {localDate} from './energy';
export function eveningWindow(now=new Date()) {
 const sunset=getTimes(new Date(localDate(now)+'T12:00:00Z'),41.09,21.01).sunset;
 return !!sunset&&now>=sunset;
}
export function dayEnded(live:{day:string;retrievedAt:string;powerKw:number|null;dayProductionKwh:number|null;inverters:number;reportingInverters:number}|null,now=new Date()) {
 return !!live&&eveningWindow(now)&&live.day===localDate(now)&&live.powerKw===0&&
  live.dayProductionKwh!==null&&live.dayProductionKwh>0&&live.inverters>0&&live.reportingInverters===live.inverters&&
  Date.parse(live.retrievedAt)<=now.getTime()&&now.getTime()-Date.parse(live.retrievedAt)<10*60000;
}
export function validSubscription(value:unknown):value is {endpoint:string;keys:{p256dh:string;auth:string}} {
 if(!value||typeof value!=='object')return false;
 const s=value as {endpoint?:unknown;keys?:{p256dh?:unknown;auth?:unknown}};
 if(typeof s.endpoint!=='string'||s.endpoint.length>2048||typeof s.keys?.p256dh!=='string'||typeof s.keys.auth!=='string')return false;
 try{const u=new URL(s.endpoint);const hosts=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','wns.windows.com','notify.windows.com'];
 return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))&&/^[\w-]{87}=?$/.test(s.keys.p256dh)&&/^[\w-]{22}={0,2}$/.test(s.keys.auth);
 }catch{return false;}
}

export function reportTime(now=new Date()){return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Skopje',hour:'2-digit',hourCycle:'h23'}).format(now)==='21';}
