'use client';
import {CheckCircle2,Info,AlertCircle,X} from 'lucide-react';
import {t,getLocale} from '@/lib/language';
import {useLanguage} from '@/components/language-switch';
import type {ManualRefreshResult,RefreshItem} from '@/lib/manual-refresh-result';

function message(item:RefreshItem){
 switch(item.status){
  case 'updated':return t('Податоците се преземени и зачувани.');
  case 'cached':return item.source==='Huawei'?t('Нема ново мерење. Huawei го ограничува освежувањето на околу 5 минути.'):t('Цените се неодамна проверени.');
  case 'pending':return t('Цените сè уште не се објавени.');
  case 'busy':return t('Веќе се преземаат податоци. Обидете се повторно наскоро.');
  case 'unconfigured':return t('Huawei поврзувањето не е конфигурирано.');
  default:return t('Преземањето не заврши целосно. Обидете се повторно.');
 }
}
export function ManualRefreshFeedback({result,onDismiss}:{result:ManualRefreshResult;onDismiss:()=>void}){
 useLanguage();
 return <section className="manual-refresh-feedback" role="status" aria-live="polite" aria-atomic="true">
  <div className="manual-refresh-feedback-heading"><strong>{t('Резултат од освежувањето')}</strong><button className="icon-button" type="button" onClick={onDismiss} aria-label={t('Затвори')}><X size={15}/></button></div>
  <ul>{result.items.map(item=>{
   const Icon=item.status==='updated'?CheckCircle2:item.status==='error'||item.status==='unconfigured'?AlertCircle:Info;
   return <li key={item.source+item.day} className={'refresh-result-'+item.status}>
    <Icon size={17}/><div><strong>{item.source} · {new Intl.DateTimeFormat(getLocale(),{day:'numeric',month:'short'}).format(new Date(item.day+'T12:00:00Z'))}</strong><span>{message(item)}</span></div>
   </li>;
  })}</ul>
 </section>;
}
