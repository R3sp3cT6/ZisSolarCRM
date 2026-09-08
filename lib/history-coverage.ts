import {slotsForDay} from './energy';

export type DayCoverage = {day:string;hours:number;production:number;exported:number;priced:number};
export function historyDays(from:string,today:string){
  const days:string[]=[];
  for(let ms=Date.parse(from+'T12:00:00Z');ms<Date.parse(today+'T12:00:00Z');ms+=86400000)days.push(new Date(ms).toISOString().slice(0,10));
  return days;
}
export function summarizeHistory(from:string,today:string,groups:DayCoverage[],dailyKeys:string[]){
  const days=historyDays(from,today),byDay=new Map(groups.map(g=>[g.day,g])),daily=new Set(dailyKeys);
  let expectedHours=0,hours=0,production=0,exported=0,priced=0,completeDays=0,dailyDays=0;
  const missingDays:string[]=[];
  for(const day of days){
    const expected=slotsForDay(day).length,g=byDay.get(day);expectedHours+=expected;
    hours+=Number(g?.hours??0);production+=Number(g?.production??0);exported+=Number(g?.exported??0);priced+=Number(g?.priced??0);
    if(daily.has(day))dailyDays++;
    if(g&&Number(g.hours)===expected&&Number(g.production)===expected&&Number(g.exported)===expected&&Number(g.priced)===expected)completeDays++;else missingDays.push(day);
  }
  return {from,through:days.at(-1)??from,totalDays:days.length,expectedHours,hours,production,exported,priced,completeDays,dailyDays,missingDays,complete:days.length>0&&completeDays===days.length&&dailyDays===days.length};
}

/** New days first; incomplete source reports are retried after a cooldown, never starve older days. */
export function nextHistoryDay(from:string,today:string,reports:{period:string;payload:string;updated_at:string}[],now=Date.now()){
  const days=historyDays(from,today).reverse(),byDay=new Map(reports.map(r=>[r.period,r]));
  return days.find(day=>!byDay.has(day))??days.find(day=>{
    const r=byDay.get(day)!;const p=JSON.parse(r.payload);
    return !(p.version===2&&p.complete)&&now-Date.parse(r.updated_at)>=7*86400000;
  })??null;
}
