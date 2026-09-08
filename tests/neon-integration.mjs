import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {hashPassword} from '../lib/password.ts';
const base=process.env.TEST_BASE_URL||'http://localhost:3000';
const sql=neon(process.env.DATABASE_URL),owner='test-'+randomUUID(),username=owner,password='Integration passphrase '+randomUUID();
let cookie='';
async function request(path,body,origin=base,session=cookie){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(session?{cookie:session}:{}),...(body?{Origin:origin,'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});let data;try{data=await r.json();}catch{data={};}return {status:r.status,data,r};}
try{
 await sql.transaction([sql.query('INSERT INTO plants(owner,created_at) VALUES ($1,$2)',[owner,new Date().toISOString()]),sql.query("INSERT INTO users(id,username,display_name,password_hash,plant_owner,role) VALUES ($1,$2,$3,$4,$1,'admin')",[owner,username,'Integration test',await hashPassword(password)])]);
 assert.equal((await request('/api/solar')).status,401);
 assert.equal((await fetch(base+'/api/solar',{headers:{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'fake@example.com'}})).status,401);
 assert.equal((await request('/api/solar-sync')).status,401);
 assert.equal((await request('/api/auth/login',{username,password},'https://untrusted.example')).status,403);
 assert.equal((await request('/api/auth/login',{username,password:'wrong password'})).status,401);
 const login=await request('/api/auth/login',{username,password});assert.equal(login.status,200,JSON.stringify(login.data));cookie=login.r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');assert.ok(cookie);assert.match(login.r.headers.get('set-cookie'),/HttpOnly/i);assert.match(login.r.headers.get('set-cookie'),/SameSite=lax/i);
 assert.equal((await request('/api/solar',{action:'plant',name:'Bad',capacityKw:null},'https://untrusted.example')).status,403);
 const rows=[{start:'2026-09-06T22:00:00Z',productionKwh:110,exportKwh:100},{start:'2026-09-06T23:00:00Z',productionKwh:50,exportKwh:null}];
 for(let i=0;i<2;i++){const saved=await request('/api/solar',{action:'import',readings:rows});assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.saved,2);}
 const daily=await request('/api/solar?date=2026-09-07&period=day');assert.equal(daily.status,200,JSON.stringify(daily.data));assert.equal(daily.data.totals.productionKwh,160);assert.equal(daily.data.totals.readings,2);assert.equal(daily.data.totals.priced,1);assert.equal(daily.data.totals.unmetered,1);assert.equal(daily.data.market.length,24);
 assert.ok(Math.abs(daily.data.totals.revenue-0.1*(daily.data.market[0].memo*.94-2.2))<1e-9);
 for(const period of ['month','year'])assert.equal((await request('/api/solar?date=2026-09-07&period='+period)).data.totals.revenue,daily.data.totals.revenue);
 assert.equal((await request('/api/solar',{action:'import',readings:[rows[0],{...rows[1],productionKwh:-5}]})).status,400);
 const marker=randomUUID();await assert.rejects(sql.transaction([sql.query('INSERT INTO reading_revisions(id,owner,start,payload,created_at) VALUES ($1,$2,$3,$4,$5)',[marker,owner,rows[0].start,'{}',new Date().toISOString()]),sql.query('UPDATE readings SET production_kwh=-1 WHERE owner=$1',[owner])]));assert.equal((await sql.query('SELECT id FROM reading_revisions WHERE id=$1',[marker])).length,0);
 const changed=await request('/api/auth/password',{currentPassword:password,password:password+' new'});assert.equal(changed.status,200,JSON.stringify(changed.data));const old=cookie;cookie=changed.r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');assert.equal((await request('/api/solar',undefined,base,old)).status,401);assert.equal((await request('/api/solar')).status,200);
 assert.equal((await request('/api/auth/logout',{})).status,303);assert.equal((await request('/api/solar')).status,401);
 console.log('PASS: Neon transactions, private login, forged-header rejection, CSRF, durable archive, correct hourly revenue, period aggregation, password change, revoked sessions and logout.');
}finally{await sql.transaction(['sessions','users','readings','reading_revisions','fusion_reports','fusion_state','plants'].map(table=>sql.query('DELETE FROM '+table+' WHERE '+(table==='sessions'?'user_id':table==='users'?'id':'owner')+'=$1',[owner])));await sql.query('DELETE FROM auth_limits WHERE key=$1',['password:'+owner]);}
