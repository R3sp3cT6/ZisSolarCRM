'use client';
import {CheckCircle2,Info,AlertCircle,X} from 'lucide-react';
import {t} from '@/lib/language';
import {format} from 'date-fns';
import {mk} from 'date-fns/locale/mk';
import {enGB} from 'date-fns/locale/en-GB';
import {useLanguage} from '@/components/language-switch';
import type {ManualRefreshResult,RefreshItem} from '@/lib/manual-refresh-result';

function message(item:RefreshItem){
 switch(item.status){
  case 'partial':return t('Тековните податоци се проверени. Часовната архива сè уште се дополнува.');
  case 'updated':return t('Податоците се преземени и зачувани.');
  case 'cached':return item.source==='Huawei'?t('Нема ново мерење. Huawei го ограничува освежувањето на околу 5 минути.'):t('Цените се неодамна проверени.');
  case 'pending':return t('Цените сè уште не се објавени.');
  case 'busy':return t('Веќе се преземаат податоци. Обидете се повторно наскоро.');
  case 'unconfigured':return t('Huawei поврзувањето не е конфигурирано.');
  default:return t('Преземањето не заврши целосно. Обидете се повторно.');
 }
}
export function ManualRefreshFeedback({result,onDismiss}:{result:ManualRefreshResult;onDismiss:()=>void}){
 const language=useLanguage();
 return <section className="manual-refresh-feedback" role="status" aria-live="polite" aria-atomic="true">
  <div className="manual-refresh-feedback-heading"><strong>{t('Резултат од освежувањето')}</strong><button className="icon-button" type="button" onClick={onDismiss} aria-label={t('Затвори')}><X size={15}/></button></div>
  <ul>{result.items.map(item=>{
   const Icon=item.status==='updated'?CheckCircle2:item.status==='error'||item.status==='unconfigured'?AlertCircle:Info;
   return <li key={item.source+item.day} className={'refresh-result-'+item.status}>
    <Icon size={17}/><div><strong>{item.source} · {format(new Date(item.day+'T12:00:00Z'),'d MMM yyyy',{locale:language==='en'?enGB:mk})}</strong><span>{message(item)}</span>{item.source==='Huawei'&&item.productionThrough&&<span>{t('Последен завршен производствен интервал до')} {new Intl.DateTimeFormat(language==='en'?'en-GB':'mk-MK',{timeZone:'Europe/Skopje',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(item.productionThrough))}.</span>}</div>
   </li>;
  })}</ul>
 </section>;
}
