import {localDate, slotsForDay, type ReadingInput} from './energy';

export const FUSION_ORIGIN='https://eu5.fusionsolar.huawei.com';
export const FUSION_STATION='NE=252974614';
export const FUSION_GRID_DATE='2026-04-03';

export function hourlyReportCoverage(rows:ReadingInput[],day:string,now=new Date()){
 const expected=slotsForDay(day).length;
 const production=rows.filter(r=>r.productionKwh!==null).length;
 const exported=rows.filter(r=>r.exportKwh!==null).length;
 return {version:2,count:rows.length,expected,production,exported,complete:day<localDate(now)&&rows.length===expected&&production===expected&&exported===expected};
}
type Point={stationCode?:string;collectTime?:number;dataItemMap?:Record<string,unknown>};
export function energyValue(value:unknown):number|null{
 return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100000000?value:null;
}
export function parseFusionHours(input:unknown,day:string,now=new Date()):ReadingInput[]{
 if(!Array.isArray(input))throw new Error('Huawei не врати часовни мерења.');
 const allowed=new Set(slotsForDay(day).map(s=>s.start));const seen=new Set<string>();const rows:ReadingInput[]=[];
 for(const point of input as Point[]){
  if(point.stationCode!==FUSION_STATION)throw new Error('Huawei врати податоци за друга централа.');
  if(typeof point.collectTime!=='number'||!Number.isFinite(point.collectTime)||point.collectTime%3600000!==0)throw new Error('Huawei врати невалидно време на мерење.');
  const start=new Date(point.collectTime).toISOString();if(!allowed.has(start)||seen.has(start))throw new Error('Huawei врати неусогласени часови.');seen.add(start);
  // Huawei can return a zero placeholder for the latest hour while its report is still being calculated.
  if(point.collectTime+7200000>now.getTime())continue;
  const map=point.dataItemMap??{};
  const production=energyValue(Object.hasOwn(map,'PVYield')?map.PVYield:map.inverter_power);
  const exported=energyValue(map.ongrid_power);if(production===null&&exported===null)continue;
  rows.push({start,productionKwh:production,exportKwh:exported,powerKw:null,observedAt:now.toISOString()});
 }
 return rows.sort((a,b)=>a.start.localeCompare(b.start));
}
export function parseFusionLive(plantData:unknown,deviceData:unknown,expectedIds:number[],now=new Date()){
 if(!Array.isArray(plantData)||plantData.length!==1||plantData[0].stationCode!==FUSION_STATION)throw new Error('Невалидни тековни податоци од Huawei.');
 const map=plantData[0].dataItemMap??{};
 const devices=Array.isArray(deviceData)?deviceData:[];
 const byId=new Map(devices.map(d=>[d.devId,d.dataItemMap]));
 const powers=expectedIds.map(id=>byId.get(id)?.active_power);
 const complete=expectedIds.length>0&&devices.length===expectedIds.length&&byId.size===expectedIds.length&&powers.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<10000000);
 // active_power for string inverters is kW. A meter uses W and is not added to inverter output.
 return {retrievedAt:now.toISOString(),day:localDate(now),dayProductionKwh:energyValue(map.day_power),dayExportKwh:energyValue(map.day_on_grid_energy),monthProductionKwh:energyValue(map.month_power),totalProductionKwh:energyValue(map.total_power),powerKw:complete?Math.max(0,powers.reduce((s,v)=>s+v,0)):null,inverters:expectedIds.length,reportingInverters:expectedIds.filter(id=>energyValue(byId.get(id)?.active_power)!==null).length};
}
export function parseFusionReport(input:unknown,kind:'day'|'month',requestedDay:string){
 if(!Array.isArray(input))throw new Error('Huawei не врати извештај.');
 const seen=new Set<string>();
 return (input as Point[]).map(p=>{
  if(p.stationCode!==FUSION_STATION||typeof p.collectTime!=='number'||!Number.isFinite(p.collectTime))throw new Error('Невалиден Huawei извештај.');
  const date=localDate(new Date(p.collectTime));const key=kind==='month'?date.slice(0,7):date;
  if(!key.startsWith(kind==='month'?requestedDay.slice(0,4):requestedDay.slice(0,7))||seen.has(key))throw new Error('Неусогласени датуми во Huawei извештајот.');seen.add(key);
  const map=p.dataItemMap??{};return {key,productionKwh:energyValue(Object.hasOwn(map,'PVYield')?map.PVYield:map.inverter_power),exportKwh:energyValue(map.ongrid_power)};
 });
}
