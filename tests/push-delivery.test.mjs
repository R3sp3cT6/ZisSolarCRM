import {test,mock,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
let reserved=false,sends=[],deleted=[],failure=null;
mock.module('../db/index.ts',{namedExports:{db:()=>({prepare(sql){let params;return {bind(...values){params=values;return this;},async first(){
 if(sql.startsWith('SELECT endpoint'))return params[0]==='device-a'&&params[1]==='user-a'?{endpoint:'https://fcm.googleapis.com/example',p256dh:'public',auth:'auth'}:null;
 if(sql.startsWith('INSERT INTO auth_limits')){if(reserved)return null;reserved=true;return {key:params[0]};}
 throw Error('Unexpected query');
},async run(){assert.match(sql,/DELETE FROM push_subscriptions WHERE id=\? AND user_id=\?/);deleted.push(params);}};}})}});
mock.module('web-push',{defaultExport:{async sendNotification(subscription,payload,options){sends.push({subscription,payload:JSON.parse(payload),options});if(failure)throw failure;return {statusCode:201};}}});
mock.module('../lib/solar-server.ts',{namedExports:{getDashboard(){throw Error('A test must not read or claim the daily report');}}});
const {sendTestPush}=await import('../lib/push-server.ts');
beforeEach(()=>{reserved=false;sends=[];deleted=[];failure=null;process.env.VAPID_PUBLIC_KEY='test-public';process.env.VAPID_PRIVATE_KEY='test-private';});
test('a test cannot send to another account or an unregistered device',async()=>{
 assert.deepEqual(await sendTestPush('user-b','device-a','mk'),{sent:false,reason:'not-subscribed'});
 assert.deepEqual(await sendTestPush('user-a','missing','mk'),{sent:false,reason:'not-subscribed'});
 assert.equal(sends.length,0);assert.equal(reserved,false);
});
test('only the selected device receives one short-lived test; concurrent retries wait',async()=>{
 assert.deepEqual(await sendTestPush('user-a','device-a','mk'),{sent:true});
 assert.deepEqual(await sendTestPush('user-a','device-a','mk'),{sent:false,reason:'rate-limit'});
 assert.equal(sends.length,1);assert.match(sends[0].payload.title,/Тест/);assert.equal(sends[0].options.TTL,300);assert.equal(sends[0].options.urgency,'high');
});
test('missing signing keys do not consume the device test reservation',async()=>{
 delete process.env.VAPID_PRIVATE_KEY;
 assert.deepEqual(await sendTestPush('user-a','device-a','en'),{sent:false,reason:'not-configured'});
 assert.equal(reserved,false);assert.equal(sends.length,0);
});
test('an expired device is removed only for its owner; temporary failures keep it registered',async()=>{
 failure={statusCode:410};assert.deepEqual(await sendTestPush('user-a','device-a','en'),{sent:false,reason:'expired'});assert.deepEqual(deleted,[['device-a','user-a']]);
 reserved=false;deleted=[];failure={statusCode:503};assert.deepEqual(await sendTestPush('user-a','device-a','en'),{sent:false,reason:'provider-error'});assert.deepEqual(deleted,[]);
});
