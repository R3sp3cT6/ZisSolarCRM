import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {collectTelemetry} from '../lib/fusion-client.ts';
import {FUSION_STATION} from '../lib/fusionsolar.ts';

const HOUR=3600000,now=Date.parse('2026-09-09T08:45:00.000Z');
const point=(id,at,counter)=>({devId:id,collectTime:at,dataItemMap:{total_cap:counter,active_cap:counter}});
function apiFor(state,{missingBoundary=false}={}){
 const requests=[];
 const available=(key,interval,max)=>{
  const times=(state.calls?.[key]??[]).filter(t=>t>now-24*HOUR);
  return times.length<max&&now-(times.at(-1)??0)>=interval;
 };
 const reserve=async(key,interval,max)=>{
  assert.ok(available(key,interval,max),'quota is respected');
  state.calls??={};(state.calls[key]??=[]).push(now);
 };
 const call=async(path,body,interval,max,key=path)=>{
  await reserve(key,interval,max);requests.push({path,body});
  if(path==='/thirdData/getDevHistoryKpi'){
   const ids=body.devIds.split(',').map(Number),boundary=Date.parse('2026-09-09T08:00:00Z');
   return ids.flatMap(id=>[point(id,boundary-HOUR,100),point(id,missingBoundary?boundary+300000:boundary,110)]);
  }
  if(path==='/thirdData/getStationRealKpi')return [{stationCode:FUSION_STATION,dataItemMap:{day_power:40}}];
  return body.devIds.split(',').map(Number).map(devId=>({devId,dataItemMap:{total_cap:115,active_cap:115,active_power:30}}));
 };
 return {api:{available,reserve,call},requests};
}

test('missing current production is collected hourly while warm meter data is retained',async()=>{
 mock.timers.enable({apis:['Date'],now});
 try{
  const state={devices:[1,2],meters:[17],calls:{'inverter-history':[now-75*60000],'meter-history':[now-20*60000]},historyAt:{production:now-75*60000,export:now-20*60000},anchors:{export:{start:'2026-09-09T08:00:00.000Z',values:[{id:17,counter:110}]}}};
  const {api,requests}=apiFor(state),saved=[],history=[];
  const result=await collectTelemetry(state,api,async rows=>{saved.push(...rows);return rows.length;},false,async(values,ids,receivedAt)=>{history.push({values,ids,receivedAt});});
  assert.equal(result.error,null);
  assert.equal(requests.filter(r=>r.path.endsWith('getDevHistoryKpi')).length,1);
  assert.equal(requests[0].body.devTypeId,1);
  assert.equal(history.length,1);assert.deepEqual(history[0].ids,[1,2]);assert.equal(history[0].values.length,4);assert.equal(history[0].receivedAt.getTime(),now);
  assert.equal(saved.find(r=>r.start==='2026-09-09T07:00:00.000Z').productionKwh,20);
  assert.equal(state.liveHour.productionKwh,10);
  assert.equal(state.liveHour.exportKwh,5);
  assert.ok(saved.every(r=>r.start<state.liveHour.start),'live hour never archived');
 }finally{mock.timers.reset();}
});

test('both stale series receive turns; neither type can consume the other quota',async()=>{
 mock.timers.enable({apis:['Date'],now});
 try{
  for(const oldest of ['production','export']){
   const state={devices:[1],meters:[17],historyAt:{production:now-2*HOUR,export:now-2*HOUR,[oldest]:now-3*HOUR}};
   const {api,requests}=apiFor(state);
   await collectTelemetry(state,api,async()=>0);
   assert.equal(requests.find(r=>r.path.endsWith('getDevHistoryKpi')).body.devTypeId,oldest==='production'?1:17);
  }
  for(const key of ['/thirdData/getDevHistoryKpi','inverter-history']){
   const state={devices:[1],calls:{[key]:Array.from({length:key==='inverter-history'?13:26},(_,i)=>now-24*HOUR+(i+1)*60000)}};
   const {api,requests}=apiFor(state);
   await collectTelemetry(state,api,async()=>0);
   assert.ok(!requests.some(r=>r.path.endsWith('getDevHistoryKpi')));
   assert.ok(state.live.powerKw>0,'live power continues when history quota is spent');
  }
 }finally{mock.timers.reset();}
});

test('a missing hourly boundary stays unknown even with fresh realtime power',async()=>{
 mock.timers.enable({apis:['Date'],now});
 try{
  const state={devices:[1]},saved=[];
  const {api}=apiFor(state,{missingBoundary:true});
  await collectTelemetry(state,api,async rows=>{saved.push(...rows);return rows.length;});
  assert.equal(state.live.powerKw,30);
  assert.equal(state.liveHour.productionKwh,null);
  assert.equal(saved.length,0);
 }finally{mock.timers.reset();}
});
