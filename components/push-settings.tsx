'use client';
import {useEffect,useState} from 'react';
import {Bell} from 'lucide-react';
import {useLanguage} from './language-switch';
export function PushSettings(){
 const language=useLanguage(),en=language==='en';
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[supported,setSupported]=useState(true);
 useEffect(()=>{
  const supported='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;setSupported(supported);
  if(supported)void (async()=>{try{const r=await navigator.serviceWorker.getRegistration('/'),s=await r?.pushManager.getSubscription();if(!s)return;const config=await fetch('/api/push');if(!config.ok)return;const data=await config.json();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s.endpoint)))).map(v=>v.toString(16).padStart(2,'0')).join('');setEnabled(data.subscriptionIds.includes(hash));}catch{}})();
 },[]);
 async function toggle(){
  setBusy(true);setMessage('');
  try{
   if(!enabled){const permission=await Notification.requestPermission();if(permission!=='granted')throw Error(en?'Allow notifications in your browser settings.':'Дозволете известувања во поставките на прелистувачот.');}
   const config=await fetch('/api/push');if(!config.ok)throw Error(en?'Please sign in again.':'Најавете се повторно.');
   const {publicKey}=await config.json();if(!publicKey)throw Error(en?'Notifications are not configured yet.':'Известувањата сè уште не се конфигурирани.');
   await navigator.serviceWorker.register('/sw.js');const registration=await navigator.serviceWorker.ready;
   let subscription=await registration.pushManager.getSubscription();
   if(!subscription&&!enabled){const raw=atob(publicKey.replace(/-/g,'+').replace(/_/g,'/'));const key=Uint8Array.from(raw,c=>c.charCodeAt(0));subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});}
   if(subscription){
    const response=await fetch('/api/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:enabled?'unsubscribe':'subscribe',subscription:subscription.toJSON(),language})});
    if(!response.ok)throw Error(en?'Could not save notification settings.':'Не може да се зачуваат поставките за известувања.');
    if(enabled)await subscription.unsubscribe();
   }
   setEnabled(!enabled);setMessage(en?(enabled?'Notifications disabled.':'Daily notifications enabled on this device.'):(enabled?'Известувањата се исклучени.':'Дневните известувања се вклучени на овој уред.'));
  }catch(error){setMessage(error instanceof Error?error.message:'Error');}finally{setBusy(false);}
 }
 return <section id="notifications" className="panel push-settings"><h2><Bell size={19}/> {en?'Daily phone report':'Дневен извештај на телефон'}</h2><p>{en?'Every day at 21:00 Resen local time, receive daily production and revenue plus this month’s totals.':'Секој ден во 21:00 часот по локално време во Ресен, добивате извештај со дневно производство и приход, плус вкупно за тековниот месец.'}</p><p className="fine-print">{en?'On iPhone: add ZIS Solar to your Home Screen, open it there, then enable notifications. Partial revenue is marked ≈.':'На iPhone: додајте ZIS Solar на почетниот екран, отворете ја оттаму и вклучете известувања. Делумниот приход е означен со ≈.'}</p><button className="button" disabled={busy||!supported} onClick={toggle}>{busy?(en?'Saving…':'Се зачувува…'):enabled?(en?'Disable notifications':'Исклучи известувања'):(en?'Enable notifications':'Вклучи известувања')}</button>{!supported&&<p>{en?'This browser does not support push. On iPhone, open the app from the Home Screen.':'Овој прелистувач не поддржува push. На iPhone отворете ја апликацијата од почетниот екран.'}</p>}<p role="status">{message}</p></section>;
}
