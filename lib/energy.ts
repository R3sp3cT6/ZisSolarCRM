import {contractFor,CONTRACT_SCHEDULE,type ContractTerms} from './contracts';
export {contractFor,CONTRACT_SCHEDULE,type ContractTerms} from './contracts';
export const ZONE='Europe/Skopje';
export const MEMO_URL='https://dam-data.memo.mk/index.php?action=auction-by-hour&lang=en';
const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
const hourFormat=new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',hourCycle:'h23'});
const labelFormat=new Intl.DateTimeFormat('mk-MK',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'});
export function hourLabel(value:string){return labelFormat.format(new Date(value));}
export function localDate(value:Date|string=new Date()){return dateFormat.format(new Date(value));}
export function validDate(s:unknown):s is string {return typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
export function localHour(value:string){return Number(hourFormat.format(new Date(value)));}
export function slotsForDay(day:string){
 if(!validDate(day))throw new Error('Невалиден датум.');
 const center=Date.parse(day+'T00:00:00Z');const slots=[];
 for(let i=-4;i<28;i++){const start=new Date(center+i*3600000).toISOString();if(localDate(start)!==day)continue;
 const label=hourLabel(start);
 slots.push({start,end:new Date(Date.parse(start)+3600000).toISOString(),hour:localHour(start),label});}
 return slots;
}
export type Period='hour'|'day'|'month'|'year';
export function rangeFor(day:string,period:Period,hour?:string){
 if(!validDate(day)||!['hour','day','month','year'].includes(period))throw new Error('Невалиден период.');
 if(period==='hour'){const slot=slotsForDay(day).find(s=>s.start===hour);if(!slot)throw new Error('Изберете валиден час.');return {from:slot.start,to:slot.end};}
 const first=period==='year'?day.slice(0,4)+'-01-01':period==='month'?day.slice(0,7)+'-01':day;
 const next=new Date(first+'T12:00:00Z');if(period==='year')next.setUTCFullYear(next.getUTCFullYear()+1);else if(period==='month')next.setUTCMonth(next.getUTCMonth()+1);else next.setUTCDate(next.getUTCDate()+1);
 return {from:slotsForDay(first)[0].start,to:slotsForDay(next.toISOString().slice(0,10))[0].start};
}
export function salePrice(memo:number,delivery:string,contracts:readonly ContractTerms[]=CONTRACT_SCHEDULE){const contract=contractFor(delivery,contracts);return memo*contract.share-contract.fixedEurMwh;}
export function revenue(kwh:number,memo:number,delivery:string,contracts:readonly ContractTerms[]=CONTRACT_SCHEDULE){return kwh/1000*salePrice(memo,delivery,contracts);}
export type ReadingInput={start:string;productionKwh:number|null;exportKwh:number|null;powerKw:number|null;observedAt:string};
export function validateReadings(input:unknown,now=new Date()):ReadingInput[]{
 if(!Array.isArray(input)||input.length===0||input.length>1000)throw new Error('Внесете од 1 до 1.000 часовни мерења.');
 const seen=new Set<string>();return input.map((raw,i)=>{const r=raw as Record<string,unknown>;const fail=(message:string):never=>{throw new Error(`Ред ${i+1}: ${message}`);};
 if(!r||typeof r!=='object')return fail('невалидно мерење.');
 if(typeof r.start!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(r.start))return fail('почетокот мора да содржи временска зона.');
 const ms=Date.parse(r.start);if(!Number.isFinite(ms)||ms%3600000!==0||ms>now.getTime()||ms<Date.parse('2023-01-01T00:00:00Z'))return fail('внесете почеток на реален, изминат или тековен час.');
 const start=new Date(ms).toISOString();if(seen.has(start))return fail('часот се повторува во внесот.');seen.add(start);
 const number=(value:unknown,optional=false):number|null=>{if(optional&&(value===null||value===undefined||value===''))return null;if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100000000)return fail('енергијата/моќноста мора да биде ненегативен број.');return value;};
 const productionKwh=number(r.productionKwh)!;const exportKwh=number(r.exportKwh,true);const powerKw=number(r.powerKw,true);
 if(r.observedAt!==undefined&&(typeof r.observedAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(r.observedAt)))return fail('времето на мерење мора да содржи временска зона.');
 const observedAt=typeof r.observedAt==='string'?new Date(r.observedAt):now;if(!Number.isFinite(observedAt.getTime())||observedAt.getTime()<ms||observedAt.getTime()>now.getTime()+60000)return fail('невалидно време на мерење.');
 return {start,productionKwh,exportKwh,powerKw,observedAt:observedAt.toISOString()};
 });
}
export type PricePoint={start:string;marketDate:string;eurCents:number};
function strip(s:string){return s.replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').trim();}
export function parseMemo(html:string):PricePoint[]{
 const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m=>m[1]);
 const table=tables.find(t=>/<td[^>]*>\s*00\s*-\s*01\s*<\/td>/i.test(t));if(!table)throw new Error('MEMO: часовната табела не е пронајдена.');
 const dates=[...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m=>strip(m[1]).match(/(\d{2})\.(\d{2})\.(\d{4})/)).filter(Boolean).map(m=>`${m![3]}-${m![2]}-${m![1]}`);
 if(!dates.length||dates.some(d=>!validDate(d))||new Set(dates).size!==dates.length)throw new Error('MEMO: невалидни датуми.');
 const rows=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>strip(c[1]))).filter(c=>/^\d{2}/.test(c[0]??''));
 if(rows.some(c=>!['€/MWh','EUR/MWh','&euro;/MWh'].includes(c[1])))throw new Error('MEMO: очекувани се цени во EUR/MWh.');
 const result:PricePoint[]=[];
 for(const [column,day] of dates.entries()){
   const slots=slotsForDay(day);
   const values=new Map<number,{cents:number;extra:boolean}[]>();let invalid=false;
   for(const cells of rows){
    const interval=cells[0].match(/^(\d{2})(x?)\s*-\s*(\d{2})(x?)$/i);
    if(!interval){invalid=true;break;}
    const h=Number(interval[1]),extra=!!interval[2],count=slots.filter(s=>s.hour===h).length;
    if(h>23||Number(interval[3])!==h+1||interval[2].toLowerCase()!==interval[4].toLowerCase()||extra&&h!==2){invalid=true;break;}
    const cell=(cells[column+2]??'').replace(/[\s\u00a0]/g,'');if(!cell||cell==='-')continue;
    if(!/^-?\d+,\d{2}$/.test(cell)){invalid=true;break;}
    const cents=Math.round(Number(cell.replace(',','.'))*100);if(!Number.isSafeInteger(cents)){invalid=true;break;}
    // MEMO's weekly table writes zero in the nonexistent spring 02:00 slot,
    // and in the 02x column on ordinary days of the autumn transition week.
    // Ignore only those proven non-delivery placeholders; real zero prices stay.
    if((count===0&&h===2&&slots.length===23)||(extra&&count===1)){
     if(cents!==0){invalid=true;break;}
     continue;
    }
    values.set(h,[...(values.get(h)??[]),{cents,extra}]);
   }
   if(invalid||slots.some(s=>values.get(s.hour)?.length!==slots.filter(t=>t.hour===s.hour).length)||[...values].some(([h])=>!slots.some(s=>s.hour===h)))continue;
   // The web table puts 02x BEFORE 02. MEMO Trader Manual Appendix G (p.161)
   // defines 02X as the SECOND delivery interval; HTML order is not time order.
   const repeated=values.get(2);
   if(repeated?.some(v=>v.extra)){
    if(repeated.length!==2||repeated.filter(v=>v.extra).length!==1)continue;
    repeated.sort((a,b)=>Number(a.extra)-Number(b.extra));
   }
   const counts=new Map<number,number>();for(const slot of slots){const idx=counts.get(slot.hour)??0;counts.set(slot.hour,idx+1);result.push({start:slot.start,marketDate:day,eurCents:values.get(slot.hour)![idx].cents});}
 }
 if(!result.length)throw new Error('MEMO: нема целосни и недвосмислени часовни цени.');return result;
}
