import test from 'node:test';
import assert from 'node:assert/strict';
import {dayEnded,validSubscription} from '../lib/push-policy.ts';
test('daily report requires evening, fresh complete zero readings and actual daily production',()=>{
 const now=new Date('2026-09-08T20:00:00Z');
 const live={day:'2026-09-08',retrievedAt:now.toISOString(),powerKw:0,dayProductionKwh:4000,inverters:8,reportingInverters:8};
 assert.equal(dayEnded(live,now),true);
 for(const change of [{powerKw:null},{powerKw:1},{dayProductionKwh:0},{reportingInverters:7},{day:'2026-09-07'},{retrievedAt:'2026-09-08T19:00:00Z'}])assert.equal(dayEnded({...live,...change},now),false);
 const noon=new Date('2026-09-08T10:00:00Z');assert.equal(dayEnded({...live,retrievedAt:noon.toISOString()},noon),false);
 assert.equal(dayEnded(null,now),false);
});
test('push endpoints reject private hosts, credentials and misleading domain suffixes',()=>{
 const keys={p256dh:'a'.repeat(87),auth:'b'.repeat(22)};
 assert.ok(validSubscription({endpoint:'https://fcm.googleapis.com/fcm/send/example',keys}));
 for(const endpoint of ['http://fcm.googleapis.com/a','https://localhost/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.com/a','https://u:p@fcm.googleapis.com/a','https://fcm.googleapis.com:8080/a'])assert.equal(validSubscription({endpoint,keys}),false);
 assert.equal(validSubscription({endpoint:'https://fcm.googleapis.com/a',keys:{p256dh:'x',auth:'y'}}),false);
});

test('21:00 schedule follows summer and winter time',async()=>{const {reportTime}=await import('../lib/push-policy.ts');for(const d of ['2026-09-08T19:00:00Z','2026-12-08T20:00:00Z'])assert.equal(reportTime(new Date(d)),true);for(const d of ['2026-09-08T20:00:00Z','2026-12-08T19:00:00Z','2026-09-08T18:59:00Z'])assert.equal(reportTime(new Date(d)),false);});
