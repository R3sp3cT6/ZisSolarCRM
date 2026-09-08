export type Currency='EUR'|'MKD';
// Display conversion, verified against the Development Bank rate list of 8 September 2026.
export const EUR_MKD=61.495;
export const CURRENCY_KEY='zis-solar-currency';
let currency:Currency='EUR';
const listeners=new Set<()=>void>();
export const getCurrency=()=>currency;
export const subscribeCurrency=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function setCurrency(next:Currency){currency=next;try{localStorage.setItem(CURRENCY_KEY,next);}catch{}listeners.forEach(fn=>fn());}
export function convertMoney(value:number|null|undefined,unit:Currency=currency){return value==null?null:value*(unit==='MKD'?EUR_MKD:1);}
export const currencySymbol=()=>currency==='MKD'?'MKD':'€';
export function currencyText(value:string){return currency==='MKD'?value.replace(/EUR|€/g,'MKD'):value;}
