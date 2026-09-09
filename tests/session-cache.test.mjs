import {test,mock,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
let entries,queries,row,onLookup,failRead;
const user={userId:'user',displayName:'Viewer',email:'viewer@example.com',role:'viewer',plantOwner:'owner'};
const get=async key=>{if(failRead)throw Error('cache offline');return structuredClone(entries.get(key)??null);};
const set=async(key,value)=>{entries.set(key,structuredClone(value));};
const redis={eval:async(script,keys,args)=>{if(entries.get(keys[0])===false)return 0;entries.set(keys[0],JSON.parse(args[0]));return 1;}};
mock.module('../lib/shared-cache.ts',{namedExports:{sharedCache:()=>redis,cacheRead:get,cacheWrite:set,cacheKey:key=>key,withCacheLock:async(key,fn)=>({busy:false,value:await fn()})}});
mock.module('../db/index.ts',{namedExports:{db:()=>({prepare(sql){return {bind(){return this;},async first(){queries++;if(onLookup)await onLookup(queries);return structuredClone(row);},async run(){queries++;}};}})}});
const {readSession,revokeSession,withSessionRevocation,recordVisit}=await import('../lib/session-cache.ts');
const prime=()=>entries.set('session:token',{user,expiresAt:Date.now()+3600000,version:'0'});
beforeEach(()=>{entries=new Map();queries=0;row={id:'user',display_name:'Viewer',username:'viewer@example.com',role:'viewer',plant_owner:'owner',expires_at:new Date(Date.now()+3600000).toISOString()};onLookup=null;failRead=false;});
test('a warm valid session performs no database queries and preserves plant/role scope',async()=>{
 prime();assert.deepEqual(await readSession('token'),user);assert.equal(queries,0);
});
test('an expired cached session and a deleted database session cannot authorize access',async()=>{
 prime();entries.get('session:token').expiresAt=Date.now()-1;row=null;assert.equal(await readSession('token'),null);assert.equal(queries,1);
});
test('logout tombstones immediately reject access without a database query',async()=>{
 prime();await revokeSession('token');assert.equal(await readSession('token'),null);assert.equal(queries,0);
});
test('logout during a cache fill cannot be overwritten by the in-flight validation',async()=>{
 onLookup=async n=>{if(n===2)await revokeSession('token');};assert.equal(await readSession('token'),null);assert.equal(entries.get('session:token'),false);
});
test('role changes fence cached sessions during mutation and revalidate afterward',async()=>{
 prime();await withSessionRevocation('user',async()=>{assert.equal(await readSession('token'),null);assert.equal(queries,0);row=null;});
 assert.equal(await readSession('token'),null);assert.equal(queries,1);
});
test('a concurrent revocation prevents publishing an old validation under a new version',async()=>{
 onLookup=async n=>{if(n===2)entries.set('session-version:user','new-version');};
 assert.equal(await readSession('token'),null);assert.equal(entries.has('session:token'),false);
});
test('cache failures fail closed, rather than serving an unrevocable session',async()=>{
 prime();failRead=true;await assert.rejects(readSession('token'),/offline/);assert.equal(queries,0);
});
test('focus events inside a visit update the shared timestamp without waking the database',async()=>{
 entries.set('visit:user',Date.now()-60000);await recordVisit(user);await recordVisit(user);assert.equal(queries,0);
 entries.set('visit:user',Date.now()-31*60000);await recordVisit(user);assert.equal(queries,1);
});
