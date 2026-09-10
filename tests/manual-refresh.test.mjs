import {test,mock,beforeEach} from 'node:test';
import assert from 'node:assert/strict';

let user,authorized,authReads,calls,fusion,memoErrors,failFusion,failPublication,locked,limited;
mock.module('../lib/auth.ts',{namedExports:{
 getUser:async fresh=>{authReads.push(fresh);return authorized?user:null;},
 authLimit:async(key,max)=>{assert.equal(key,'solar-manual-refresh:admin-id');assert.equal(max,15);return !limited;},
 sameOrigin:request=>request.headers.get('origin')===new URL(request.url).origin
}});
mock.module('../lib/fusionsolar-server.ts',{namedExports:{syncFusion:async(owner,day,options)=>{
 calls.push(['Huawei',owner,day,options]);if(failFusion)throw Error('private provider detail');return fusion;
}}});
mock.module('../lib/solar-server.ts',{namedExports:{syncMemo:async(day,force)=>{
 calls.push(['MEMO',day,force]);const error=memoErrors[day];if(error instanceof Error)throw error;
 return {updated:error?0:24,error:error??null,cached:false};
}}});
mock.module('../lib/solar-cache.ts',{namedExports:{mutateAndCache:async(owner,work)=>{
 if(locked)throw Error('Податоците веќе се дополнуваат. Обидете се повторно.');
 calls.push(['lock',owner]);const result=await work();if(failPublication)throw Error('private database detail');
 calls.push(['publish',owner]);return result;
}}});
const {handleManualRefresh}=await import('../lib/manual-refresh.ts');
const now=new Date('2026-09-10T06:30:00Z');
const request=(body={source:'overview'},origin='https://example.com')=>new Request('https://example.com/api/solar-refresh/manual',{
 method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)
});
beforeEach(()=>{
 user={userId:'admin-id',plantOwner:'assigned-plant',role:'admin'};authorized=true;authReads=[];calls=[];
 fusion={configured:true,updated:2,error:null,liveUpdated:true,lastSuccess:now.toISOString()};
 memoErrors={};failFusion=false;failPublication=false;locked=false;limited=false;
});

test('fresh server authorization denies anonymous users, viewers, and foreign origins before collecting data',async()=>{
 authorized=false;assert.equal((await handleManualRefresh(request(),now)).status,401);
 authorized=true;user.role='viewer';assert.equal((await handleManualRefresh(request(),now)).status,403);
 user.role='admin';assert.equal((await handleManualRefresh(request({},'https://other.example'),now)).status,403);
 assert.deepEqual(authReads,[true,true,true]);assert.deepEqual(calls,[]);
});
test('invalid selections and request limit never reach collectors',async()=>{
 for(const body of [{source:'unknown'},{source:'market',date:'2026-02-30'},{source:'market',date:'2026-09-12'},{source:'market',date:'2022-12-31'}]){
  assert.equal((await handleManualRefresh(request(body),now)).status,400);
 }
 limited=true;assert.equal((await handleManualRefresh(request(),now)).status,429);assert.deepEqual(calls,[]);
});
test('overview uses the assigned owner and cron collectors, saves today and tomorrow, then publishes the shared snapshot',async()=>{
 const response=await handleManualRefresh(request({source:'overview',owner:'another-plant',date:'1999-01-01'}),now);
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 const result=await response.json();assert.equal(result.items.length,3);assert.ok(result.items.every(item=>item.status==='updated'));
 assert.deepEqual(calls,[['Huawei','assigned-plant','2026-09-10',{manual:true,evening:true}],['lock','assigned-plant'],['MEMO','2026-09-10',true],['MEMO','2026-09-11',true],['publish','assigned-plant']]);
});
test('market refresh avoids Huawei and deduplicates a selected tomorrow',async()=>{
 const response=await handleManualRefresh(request({source:'market',date:'2026-09-11'}),now);
 assert.equal((await response.json()).items.length,1);
 assert.deepEqual(calls,[['lock','assigned-plant'],['MEMO','2026-09-11',true],['publish','assigned-plant']]);
});
test('tomorrow follows the local calendar across midnight and DST',async()=>{
 await handleManualRefresh(request({source:'market',date:'2026-10-25'}),new Date('2026-10-24T22:30:00Z'));
 assert.deepEqual(calls.filter(c=>c[0]==='MEMO').map(c=>c[1]),['2026-10-25','2026-10-26']);
});
test('an unpublished tomorrow is pending while today succeeds; Huawei cooldown does not claim new readings',async()=>{
 fusion={configured:true,updated:0,error:null,liveUpdated:false};
 memoErrors['2026-09-11']='MEMO сè уште нема објавено целосни часовни цени за овој датум.';
 const result=await (await handleManualRefresh(request(),now)).json();
 assert.deepEqual(result.items.map(item=>item.status),['cached','updated','pending']);
});
test('independent source failures still allow the other collectors to run, without exposing private errors',async()=>{
 failFusion=true;memoErrors['2026-09-10']=Error('private database password');
 const result=await (await handleManualRefresh(request(),now)).json();
 assert.deepEqual(result.items.map(item=>item.status),['error','error','updated']);
 assert.ok(!JSON.stringify(result).includes('private'));
});
test('failed cache publication and concurrent plant work are not reported as success',async()=>{
 failPublication=true;
 let result=await (await handleManualRefresh(request({source:'market',date:'2026-09-10'}),now)).json();
 assert.deepEqual(result.items.map(item=>item.status),['error','error']);
 calls=[];failPublication=false;locked=true;fusion={configured:true,updated:0,error:null,busy:true};
 result=await (await handleManualRefresh(request(),now)).json();
 assert.deepEqual(result.items.map(item=>item.status),['busy','busy','busy']);
 assert.equal(calls.filter(c=>c[0]==='MEMO').length,0);
});
