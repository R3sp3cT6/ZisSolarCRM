import {test,mock,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {archiveDue,ACTIVE_GAP_MS,ARCHIVE_INTERVAL_MS} from '../lib/cache-policy.ts';
import {buildDashboard} from '../lib/dashboard.ts';
import {localDate,slotsForDay} from '../lib/energy.ts';
let entries=new Map(),locks=new Set(),loads=0,syncs=0,telemetryCalls=0,saves=[],failSave=false,failAck=false;
const read=async key=>structuredClone(entries.get(key)??null);
const write=async(key,value)=>{if(failAck&&key==='pending:owner'&&value.length===0){failAck=false;throw Error('ack interrupted');}entries.set(key,structuredClone(value));};
mock.module('../lib/shared-cache.ts',{namedExports:{sharedCache:()=>({}),cacheRead:read,cacheWrite:write,withCacheLock:async(key,work)=>{if(locks.has(key))return {busy:true};locks.add(key);try{return {busy:false,value:await work()};}finally{locks.delete(key);}}}});
const snapshot=()=>({owner:'owner',plant:{name:'Plant',capacity_kw:800},readings:[],prices:[],reports:[],syncs:[],fusionState:{},configured:true,savedAt:new Date().toISOString()});
mock.module('../lib/solar-server.ts',{namedExports:{loadDashboardSnapshot:async()=>{loads++;return snapshot();},getDashboard:()=>{throw Error('Unexpected database read');},saveReadings:async(owner,rows,source,preserve,fillOnly)=>{assert.equal(owner,'owner');assert.equal(preserve,true);assert.equal(fillOnly,true);if(failSave)throw Error('database unavailable');saves.push(rows);return rows.length;}}});
mock.module('../lib/fusionsolar-server.ts',{namedExports:{fusionConfigured:()=>true,fusionOwner:()=> 'owner',syncFusionDirect:async()=>{syncs++;return {configured:true,updated:0,error:null};}}});
mock.module('../lib/fusion-client.ts',{namedExports:{fusionClient:()=>({}),collectTelemetry:async(state,client,save)=>{telemetryCalls++;await save([reading()]);return {updated:1,error:null};}}});
const {getCachedDashboard,refreshActive,flushPending,overlayPending}=await import('../lib/solar-cache.ts');
function reading(){return {start:slotsForDay(localDate())[0].start,productionKwh:0,exportKwh:null,powerKw:null,observedAt:new Date().toISOString()};}
beforeEach(()=>{entries=new Map();locks=new Set();loads=0;syncs=0;telemetryCalls=0;saves=[];failSave=false;failAck=false;});
test('archive on first visit, returning after idle, or hourly activity, not every live refresh',()=>{
 const now=100000000;assert.equal(archiveDue(null,now),true);
 assert.equal(archiveDue({lastActive:now-310000,lastArchived:now-310000},now),false);
 assert.equal(archiveDue({lastActive:now-ACTIVE_GAP_MS,lastArchived:now-ACTIVE_GAP_MS},now),true);
 assert.equal(archiveDue({lastActive:now,lastArchived:now-ARCHIVE_INTERVAL_MS},now),true);
});
test('all warm period reads avoid database, isolate owners and validate input',async()=>{
 entries.set('dashboard:owner',snapshot());
 for(const period of ['day','month','year'])assert.equal((await getCachedDashboard('owner',localDate(),period)).storage,'cache');
 assert.equal(loads,0);assert.equal(syncs,0);
 entries.set('dashboard:other',snapshot());await assert.rejects(getCachedDashboard('other',localDate(),'day'),/централата/);
 await assert.rejects(getCachedDashboard('owner','invalid','day'));
 assert.equal(loads,0);
});
test('simultaneous visitors share one live refresh, buffer results, and never touch Neon',async()=>{
 const now=Date.now();entries.set('dashboard:owner',snapshot());entries.set('activity:owner',{lastActive:now-310000,lastArchived:now-310000});entries.set('fusion:owner',{devicesAt:now,devices:[1],lastAttempt:new Date(now-320000).toISOString()});
 const responses=await Promise.all([refreshActive('owner'),refreshActive('owner')]);
 assert.equal(telemetryCalls,1);assert.ok(responses.some(r=>r.busy));assert.equal(loads,0);assert.equal(syncs,0);assert.equal(saves.length,0);
 assert.equal(entries.get('pending:owner').length,1);
 await refreshActive('owner');assert.equal(telemetryCalls,1);
});
test('first active visitor flushes durable records and creates a shared database snapshot',async()=>{
 entries.set('pending:owner',[{id:'batch',rows:[reading()]}]);
 assert.equal((await refreshActive('owner')).storage,'database');
 assert.equal(syncs,1);assert.equal(loads,1);assert.equal(saves.length,1);assert.deepEqual(entries.get('pending:owner'),[]);
});
test('failed writes and interrupted acknowledgements retain batches for safe fill-only replay',async()=>{
 const batch={id:'batch',rows:[reading()]};entries.set('pending:owner',[batch]);
 failSave=true;await assert.rejects(flushPending('owner'),/database/);assert.deepEqual(entries.get('pending:owner'),[batch]);
 failSave=false;failAck=true;await assert.rejects(flushPending('owner'),/ack/);assert.deepEqual(entries.get('pending:owner'),[batch]);
 await flushPending('owner');assert.deepEqual(entries.get('pending:owner'),[]);assert.equal(saves.length,2);
});
test('pending counter data fills gaps without erasing archive, turning missing values into zero, or mutating cache',()=>{
 const base=snapshot(),r=reading();base.readings=[{start:r.start,production_kwh:12,export_kwh:null,power_kw:null,observed_at:r.observedAt,updated_at:r.observedAt,source:'XLSX'}];
 const over=overlayPending(base,[{id:'one',rows:[{...r,productionKwh:99,exportKwh:4}]}],null);
 assert.equal(over.readings[0].production_kwh,12);assert.equal(over.readings[0].export_kwh,4);assert.equal(base.readings[0].export_kwh,null);
 const blank=overlayPending(snapshot(),[{id:'two',rows:[r]}],null);assert.equal(blank.readings[0].production_kwh,0);assert.equal(blank.readings[0].export_kwh,null);
});
test('cached projections calculate production, income, calendar and missing hours from the same inputs',()=>{
 const base=snapshot(),day='2026-09-08',start=slotsForDay(day)[8].start,now=Date.parse('2026-09-09T08:00:00Z');
 base.readings=[{start,production_kwh:120,export_kwh:100,power_kw:90,observed_at:start,updated_at:start,source:'measured'}];
 base.prices=[{start,market_date:day,eur_cents:10000,fetched_at:start}];
 for(const period of ['day','month','year']){
  const d=buildDashboard(base,day,period,undefined,now);assert.equal(d.totals.productionKwh,120);assert.equal(d.totals.exportKwh,100);assert.ok(Math.abs(d.totals.revenue-9.18)<1e-10);assert.equal(d.dailyRevenue[0].partial,true);assert.equal(d.dailyRevenue[0].revenue,9.18);assert.ok(d.productionDays.includes(day));assert.equal(d.power.stale,true);
 }
 assert.equal(buildDashboard(base,day,'day',undefined,now).totals.missing,23);
});
