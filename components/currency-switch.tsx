'use client';
import {useEffect,useSyncExternalStore} from 'react';
import {CURRENCY_KEY,EUR_MKD,getCurrency,setCurrency,subscribeCurrency} from '@/lib/currency';
export function useCurrency(){return useSyncExternalStore(subscribeCurrency,getCurrency,()=> 'EUR' as const);}
export function CurrencySwitch(){const currency=useCurrency();useEffect(()=>{const sync=()=>{try{setCurrency(localStorage.getItem(CURRENCY_KEY)==='MKD'?'MKD':'EUR');}catch{}};sync();const changed=(e:StorageEvent)=>{if(e.key===CURRENCY_KEY)sync();};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);
 return <div className="currency-switch" role="group" aria-label="Currency / Валута" title={`1 EUR = ${EUR_MKD} MKD · Display rate / Курс за приказ · 08.09.2026`}><button aria-pressed={currency==='EUR'} onClick={()=>setCurrency('EUR')}>EUR</button><button aria-pressed={currency==='MKD'} onClick={()=>setCurrency('MKD')}>MKD</button></div>;
}
