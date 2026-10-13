import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCounterHistory,counterAnchor,counterHours,liveCounterDelta,readingCoverage,retainLiveHours} from '../lib/fusion-telemetry.ts';
import {parseFusionHours,FUSION_STATION} from '../lib/fusionsolar.ts';
import {slotsForDay} from '../lib/energy.ts';
import {energyReportCsv} from '../lib/energy-report.ts';
const point=(id,time,n)=>({devId:id,collectTime:Date.parse(time),dataItemMap:{active_cap:n,total_cap:n}});
const from=Date.parse('2026-09-09T04:00:00Z'),to=Date.parse('2026-09-09T07:05:00Z');
void test('partial counters retain each field through nulls, resets, stale responses and the next hour',()=>{
 const start='2026-09-09T07:00:00.000Z',now=Date.parse('2026-09-09T08:10:00Z');
 const row=(at,productionKwh,exportKwh)=>({start,observedAt:`2026-09-09T07:${at}:00Z`,productionKwh,exportKwh});
 const original=[row('10',20,18)],before=structuredClone(original);
 const kept=retainLiveHours(original,[row('20',30,null),row('25',null,25),row('30',0,0),row('05',100,100),row('35',null,null)],now);
 assert.deepEqual(original,before);assert.equal(kept.length,1);
 assert.deepEqual(kept[0],{start,productionKwh:30,exportKwh:25,productionObservedAt:'2026-09-09T07:20:00Z',exportObservedAt:'2026-09-09T07:25:00Z',observedAt:'2026-09-09T07:25:00Z'});
 assert.deepEqual(retainLiveHours(kept,[row('59',-1,NaN),{...row('50',40,35),observedAt:'2026-09-09T08:01:00Z'}],now),kept);
});
void test('a provisional live hour cannot be exported and re-imported as a completed measurement',()=>{
 const row={start:'2026-09-09T07:00:00.000Z',productionKwh:28.01,exportKwh:28,memo:100,sale:91.8,revenue:2.5704,estimate:null,priceFetchedAt:null,partial:true};
 assert.equal(energyReportCsv([row],'v1').split('\n').length,1);
 assert.equal(energyReportCsv([{...row,partial:false}],'v1').split('\n').length,2);
});
void test('meter boundaries recover exact completed hours and retain a partial current hour separately',()=>{
 const raw=[point(17,'2026-09-09T04:00:00Z',513201),point(17,'2026-09-09T05:00:00Z',513215),point(17,'2026-09-09T06:00:00Z',513311),point(17,'2026-09-09T07:00:00Z',513561),point(17,'2026-09-09T07:05:00Z',513589)];
 const samples=parseCounterHistory(raw,[17],'active_cap',from,to,to);
 const rows=counterHours(samples,[17],'2026-09-09','export',new Date(to));
 assert.deepEqual(rows.map(r=>r.exportKwh),[14,96,250]);
 assert.ok(rows.every(r=>r.productionKwh===null));
 const anchor=counterAnchor(samples,[17],'2026-09-09T07:00:00.000Z');
 assert.equal(liveCounterDelta([raw.at(-1)],anchor,'active_cap',to),28);
 assert.equal(liveCounterDelta([raw.at(-1)],anchor,'active_cap',to+3600000),null);
});
void test('missing devices, duplicate points, mismatched timestamps and counter resets cannot manufacture energy',()=>{
 const raw=[point(1,'2026-09-09T04:00:00Z',100),point(1,'2026-09-09T04:30:00Z',0),point(1,'2026-09-09T05:00:00Z',110)];
 const samples=parseCounterHistory(raw,[1],'total_cap',from,to,to);
 assert.equal(counterHours(samples,[1],'2026-09-09','production',new Date(to)).length,0);
 assert.equal(counterHours(samples,[1,2],'2026-09-09','production',new Date(to)).length,0);
 assert.throws(()=>parseCounterHistory([raw[0],raw[0]],[1],'total_cap',from,to,to));
 assert.throws(()=>parseCounterHistory([raw[0]],[2],'total_cap',from,to,to));
 assert.throws(()=>parseCounterHistory([{...raw[0],collectTime:from+1}],[1],'total_cap',from,to,to));
});
void test('all inverter differences are required and null is never a measured zero',()=>{
 const raw=[point(1,'2026-09-09T04:00:00Z',100),point(2,'2026-09-09T04:00:00Z',200),point(1,'2026-09-09T05:00:00Z',110),point(2,'2026-09-09T05:00:00Z',220)];
 assert.equal(counterHours(parseCounterHistory(raw,[1,2],'total_cap',from,to,to),[1,2],'2026-09-09','production',new Date(to))[0].productionKwh,30);
 raw[3].dataItemMap.total_cap=null;
 assert.equal(counterHours(parseCounterHistory(raw,[1,2],'total_cap',from,to,to),[1,2],'2026-09-09','production',new Date(to)).length,0);
});
void test('coverage excludes the unfinished hour, cannot be masked by future records, and handles DST',()=>{
 const slots=slotsForDay('2026-09-09');const now=Date.parse('2026-09-09T07:15:00Z');
 const coverage=readingCoverage([...slots.slice(0,8).map(s=>s.start),slots[9].start],slots[0].start,slots.at(-1).end,now);
 assert.equal(coverage.expected,9);assert.equal(coverage.missing,1);assert.deepEqual(coverage.missingStarts,[slots[8].start]);
 for(const day of ['2026-03-29','2026-10-25']){const s=slotsForDay(day);const r=readingCoverage(s.map(x=>x.start),s[0].start,s.at(-1).end,Date.parse('2026-11-01'));assert.equal(r.expected,s.length);assert.equal(r.missing,0);}
});
void test('positive completed report hours are usable immediately; ongoing and recent empty placeholders wait',()=>{
 const row=(time,value)=>({stationCode:FUSION_STATION,collectTime:Date.parse(time),dataItemMap:{PVYield:value,ongrid_power:value}});
 const rows=parseFusionHours([row('2026-09-09T06:00:00Z',250),row('2026-09-09T07:00:00Z',10)],'2026-09-09',new Date(to));
 assert.equal(rows.length,1);assert.equal(rows[0].productionKwh,250);
 assert.equal(parseFusionHours([row('2026-09-09T06:00:00Z',0)],'2026-09-09',new Date(to)).length,0);
});
