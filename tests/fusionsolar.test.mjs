import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFusionHours,parseFusionLive,parseFusionReport,FUSION_STATION} from '../lib/fusionsolar.ts';
import {slotsForDay} from '../lib/energy.ts';
const hour=(time,map)=>({stationCode:FUSION_STATION,collectTime:Date.parse(time),dataItemMap:map});
test('Huawei PV yield and grid delivery remain distinct; newest placeholders wait',()=>{
 const now=new Date('2026-09-08T13:05:00Z');
 const rows=parseFusionHours([hour('2026-09-08T10:00:00Z',{PVYield:627.17,ongrid_power:623,inverter_power:999}),hour('2026-09-08T12:00:00Z',{PVYield:0,ongrid_power:0})],'2026-09-08',now);
 assert.equal(rows.length,1);assert.equal(rows[0].productionKwh,627.17);assert.equal(rows[0].exportKwh,623);assert.equal(rows[0].powerKw,null);
 assert.equal(parseFusionHours([hour('2026-09-08T10:00:00Z',{PVYield:5,ongrid_power:null})],'2026-09-08',now)[0].exportKwh,null);
 assert.equal(parseFusionHours([hour('2026-09-08T10:00:00Z',{PVYield:null,inverter_power:999})],'2026-09-08',now).length,0);
});
test('Huawei rejects cross-plant, duplicate and shifted-day data',()=>{
 const row=hour('2026-09-08T10:00:00Z',{PVYield:2});const now=new Date('2026-09-09T12:00:00Z');
 assert.throws(()=>parseFusionHours([{...row,stationCode:'other'}],'2026-09-08',now));assert.throws(()=>parseFusionHours([row,row],'2026-09-08',now));assert.throws(()=>parseFusionHours([row],'2026-09-07',now));
});
test('Huawei DST hour mapping keeps each actual instant',()=>{
 for(const day of ['2026-03-29','2026-10-25']){const slots=slotsForDay(day);const rows=parseFusionHours(slots.map(s=>hour(s.start,{PVYield:1,ongrid_power:0})),day,new Date('2026-11-01T00:00:00Z'));assert.equal(rows.length,slots.length);assert.equal(new Set(rows.map(r=>r.start)).size,slots.length);}
});
test('Live power requires every inverter and uses kW independently of daily kWh',()=>{
 const plant=[{stationCode:FUSION_STATION,dataItemMap:{day_power:3738.76,day_on_grid_energy:3717,month_power:35475.02}}];
 const devices=[{devId:1,dataItemMap:{active_power:62.422}},{devId:2,dataItemMap:{active_power:80}}];
 const complete=parseFusionLive(plant,devices,[1,2]);assert.equal(complete.powerKw,142.422);assert.equal(complete.dayExportKwh,3717);assert.equal(complete.dayProductionKwh,3738.76);
 assert.equal(parseFusionLive(plant,devices.slice(0,1),[1,2]).powerKw,null);assert.equal(parseFusionLive(plant,devices.concat(devices[0]),[1,2]).powerKw,null);
});
test('Report periods validate calendar keys instead of mixing years',()=>{
 const row=hour('2026-09-06T22:00:00Z',{PVYield:4000,ongrid_power:3980});assert.equal(parseFusionReport([row],'day','2026-09-08')[0].key,'2026-09-07');assert.throws(()=>parseFusionReport([row],'day','2026-08-08'));
});
