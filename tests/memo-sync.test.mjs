import {test,mock,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {slotsForDay,localHour} from '../lib/energy.ts';

let entries=new Map(),locks=new Set(),cacheReads=0,dbReads=0,downloads=[],rebuilds=0,sourceError=null,missing=false,failRebuild=false;
mock.module('../lib/shared-cache.ts',{namedExports:{
 cacheRead:async key=>{cacheReads++;return entries.get(key)??null;},
 cacheWrite:async(key,value)=>{entries.set(key,value);},
 withCacheLock:async(key,work)=>{if(locks.has(key))return {busy:true};locks.add(key);try{return {busy:false,value:await work()};}finally{locks.delete(key);}}
}});
mock.module('../lib/solar-server.ts',{namedExports:{
 syncMemo:async day=>{downloads.push(day);return {updated:sourceError?0:24,error:sourceError,cached:false};},
 db:()=>({prepare(query){
  assert.equal(query,'SELECT start FROM prices WHERE market_date=?');
  return {bind:day=>({all:async()=>{
   dbReads++;const slots=slotsForDay(day);
   return {results:(missing?slots.slice(1):slots).map(s=>({start:s.start}))};
  }})};
 }})
}});
mock.module('../lib/solar-cache.ts',{namedExports:{rebuildSnapshot:async()=>{rebuilds++;if(failRebuild)throw Error('cache publication interrupted');}}});
const {nextMarketDay,memoSyncTime,completeMarketDay,syncMemoDayAhead,handleMemoCron}=await import('../lib/memo-day-ahead.ts');
const now=new Date('2026-09-09T09:05:00Z');
const request=(token='test-cron-secret')=>new Request('https://example.com/api/memo-sync',{headers:token?{Authorization:'Bearer '+token}:{}});
beforeEach(()=>{entries=new Map();locks=new Set();cacheReads=0;dbReads=0;downloads=[];rebuilds=0;sourceError=null;missing=false;failRebuild=false;process.env.CRON_SECRET='test-cron-secret';process.env.FUSIONSOLAR_OWNER='owner';});

test('the deployed cron covers 11:05 and 12:05 local time in both seasons and DST transitions',()=>{
 const crons=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url))).crons;
 const schedule=crons.find(c=>c.path==='/api/memo-sync').schedule;
 const [minute,hours]=schedule.split(' ');assert.equal(minute,'5');
 for(const day of ['2026-09-09','2026-01-09','2026-03-29','2026-10-25']){
  const accepted=hours.split(',').map(h=>new Date(`${day}T${h.padStart(2,'0')}:05:00Z`)).filter(memoSyncTime).map(d=>localHour(d.toISOString()));
  assert.deepEqual(accepted,[11,12]);
 }
});

test('tomorrow and complete delivery slots follow Skopje dates including midnight and 23/25-hour days',()=>{
 assert.equal(nextMarketDay(new Date('2026-12-31T23:30:00Z')),'2027-01-02');
 assert.equal(nextMarketDay(new Date('2026-03-28T09:05:00Z')),'2026-03-29');
 assert.equal(nextMarketDay(new Date('2026-10-24T09:05:00Z')),'2026-10-25');
 for(const day of ['2026-09-10','2026-03-29','2026-10-25']){
  const starts=slotsForDay(day).map(s=>s.start);
  assert.equal(completeMarketDay(day,starts),true);
  assert.equal(completeMarketDay(day,[starts[0],...starts.slice(0,-1)]),false);
  assert.equal(completeMarketDay(day,[...starts.slice(1),'2025-01-01T00:00:00.000Z']),false);
 }
});

test('unauthorized and unused seasonal invocations exit before cache and database access',async()=>{
 for(const token of [null,'wrong'])assert.equal((await handleMemoCron(request(token),true,now)).status,401);
 delete process.env.CRON_SECRET;assert.equal((await handleMemoCron(request(),false,now)).status,401);
 process.env.CRON_SECRET='test-cron-secret';
 assert.deepEqual(await (await handleMemoCron(request(),true,new Date('2026-09-09T11:05:00Z'))).json(),{skipped:true});
 assert.equal(cacheReads,0);assert.equal(dbReads,0);assert.equal(downloads.length,0);
});

test('successful tomorrow import publishes the cache; duplicates and fallback do no SQL or downloads',async()=>{
 const first=await handleMemoCron(request(),true,now);assert.equal(first.status,200);
 const result=await first.json();assert.equal(result.day,'2026-09-10');assert.equal(result.complete,true);
 assert.deepEqual(downloads,['2026-09-10']);assert.equal(dbReads,1);assert.equal(rebuilds,1);
 const repeat=await handleMemoCron(request(),true,new Date('2026-09-09T10:05:00Z'));
 assert.equal((await repeat.json()).cached,true);assert.equal(downloads.length,1);assert.equal(dbReads,1);assert.equal(rebuilds,1);
});

test('missing prices and failed cache publication remain retryable instead of marking a day done',async()=>{
 missing=true;assert.equal((await handleMemoCron(request(),true,now)).status,502);assert.equal(entries.size,0);
 missing=false;sourceError='MEMO unavailable';assert.equal((await handleMemoCron(request(),true,now)).status,502);assert.equal(entries.size,0);
 sourceError=null;failRebuild=true;assert.equal((await handleMemoCron(request(),true,now)).status,502);assert.equal(entries.size,0);
 failRebuild=false;const retry=await handleMemoCron(request(),true,new Date('2026-09-09T10:05:00Z'));assert.equal(retry.status,200);assert.equal(entries.size,1);
});

test('concurrent invocations share the plant lease and manual recovery bypasses only the clock',async()=>{
 const results=await Promise.all([syncMemoDayAhead('owner',now),syncMemoDayAhead('owner',now)]);
 assert.ok(results.some(r=>r.busy));assert.equal(downloads.length,1);
 entries.clear();const recovery=await handleMemoCron(request(),false,new Date('2026-09-09T16:00:00Z'));assert.equal(recovery.status,200);
 assert.equal((await handleMemoCron(request('wrong'),false,now)).status,401);
});
