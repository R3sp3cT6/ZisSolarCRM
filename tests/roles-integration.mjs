import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {hashPassword} from '../lib/password.ts';
const base=process.env.TEST_BASE_URL||'http://localhost:3001';
const sql=neon(process.env.DATABASE_URL),owner='role-test-'+randomUUID(),foreign='role-test-'+randomUUID();
const password='Role test '+randomUUID(),newPassword='Reset test '+randomUUID(),viewerName='reader-'+randomUUID();
let adminCookie='',viewerCookie='',viewerId='';
async function request(path,body,cookie=adminCookie,origin=base){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{Origin:origin,'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data,response};}
async function login(username,secret=password){const result=await request('/api/auth/login',{username,password:secret},'');assert.equal(result.status,200,JSON.stringify(result.data));return result.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');}
function update(overrides={}){return {action:'update',id:viewerId,username:viewerName,displayName:'Read only tester',role:'viewer',active:true,password:'',...overrides};}
try {
  const encoded=await hashPassword(password);
  for(const id of [owner,foreign])await sql.transaction([sql.query('INSERT INTO plants(owner,name,created_at) VALUES ($1,$2,$3)',[id,id,new Date().toISOString()]),sql.query("INSERT INTO users(id,username,display_name,password_hash,plant_owner,role) VALUES ($1,$1,$1,$2,$1,'admin')",[id,encoded])]);
  adminCookie=await login(owner);
  assert.equal((await request('/api/users',undefined,'')).status,401);
  const create={action:'create',username:viewerName,displayName:'Read only tester',password,role:'viewer',active:true,plantOwner:foreign};
  assert.equal((await request('/api/users',create,adminCookie,'https://untrusted.example')).status,403);
  assert.equal((await request('/api/users',{...create,role:'superadmin'})).status,400);
  const created=await request('/api/users',create);assert.equal(created.status,201,JSON.stringify(created.data));viewerId=created.data.id;
  assert.equal((await request('/api/users',create)).status,409);
  const listed=await request('/api/users');assert.equal(listed.status,200);assert.equal(listed.data.users.length,2);assert.ok(!JSON.stringify(listed.data).includes('password'));
  const [stored]=await sql.query('SELECT plant_owner,role FROM users WHERE id=$1',[viewerId]);assert.equal(stored.plant_owner,owner);assert.equal(stored.role,'viewer');
  const reading={start:'2026-09-07T10:00:00.000Z',productionKwh:1200,exportKwh:1100};
  assert.equal((await request('/api/solar',{action:'import',readings:[reading]})).status,200);
  viewerCookie=await login(viewerName);
  for(const period of ['hour','day','month','year']){
    const data=await request('/api/solar?date=2026-09-07&period='+period+'&hour='+encodeURIComponent(reading.start)+'&owner='+foreign,undefined,viewerCookie);
    assert.equal(data.status,200);assert.equal(data.data.plant.name,owner);assert.equal(data.data.totals.productionKwh,1200);assert.equal(data.data.totals.exportKwh,1100);
  }
  for(const body of [{action:'plant',name:'Unauthorized',capacityKw:null},{action:'import',readings:[reading]},{action:'sync',date:'2026-09-07',force:true},{action:'fusion',date:'2026-09-07'}])assert.equal((await request('/api/solar',body,viewerCookie)).status,403);
  assert.equal((await request('/api/users',undefined,viewerCookie)).status,403);
  assert.equal((await request('/api/users',{...create,role:'admin'},viewerCookie)).status,403);
  assert.equal((await request('/api/users',update({role:'admin'}),viewerCookie)).status,403);
  assert.equal((await request('/api/auth/password',{currentPassword:password,password:newPassword},viewerCookie)).status,403);
  const viewerPage=await request('/',undefined,viewerCookie);assert.equal(viewerPage.status,200);assert.ok(!viewerPage.data.includes('Мојата централа'));assert.ok(!viewerPage.data.includes('Корисници'));assert.ok(viewerPage.data.includes('Само преглед'));
  const account=await request('/account',undefined,viewerCookie);assert.ok(!account.data.includes('currentPassword'));
  assert.equal((await request('/api/users',update({id:foreign,username:foreign}))).status,404);
  assert.equal((await request('/api/users',update({id:owner,username:owner,active:false}))).status,403);
  assert.equal((await request('/api/users',update({id:owner,username:owner,role:'viewer'}))).status,403);
  assert.equal((await request('/api/users',update({password:newPassword}))).status,200);
  assert.equal((await request('/api/solar',undefined,viewerCookie)).status,401);
  assert.equal((await request('/api/auth/login',{username:viewerName,password},'')).status,401);
  viewerCookie=await login(viewerName,newPassword);
  assert.equal((await request('/api/users',update({active:false}))).status,200);
  assert.equal((await request('/api/solar',undefined,viewerCookie)).status,401);
  assert.equal((await request('/api/auth/login',{username:viewerName,password:newPassword},'')).status,401);
  assert.equal((await request('/api/users',update({role:'admin'}))).status,200);
  viewerCookie=await login(viewerName,newPassword);
  assert.equal((await request('/api/users',undefined,viewerCookie)).status,200);
  assert.equal((await request('/api/users',update({active:false}),viewerCookie)).status,403);
  assert.equal((await request('/api/solar',{action:'plant',name:'Shared plant',capacityKw:1000},viewerCookie)).status,200);
  assert.equal((await request('/api/solar?date=2026-09-07&period=day')).data.plant.name,'Shared plant');
  assert.equal((await request('/api/users',update())).status,200);
  assert.equal((await request('/api/users',undefined,viewerCookie)).status,401);
  viewerCookie=await login(viewerName,newPassword);
  assert.equal((await request('/api/users',undefined,viewerCookie)).status,403);
  console.log('PASS: admin creation/editing, shared data in every period, read-only UI, blocked mutations/escalation, tenant isolation, protected owner, password reset, role changes, disabled logins and immediate session revocation.');
} finally {
  await sql.transaction([
    sql.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE plant_owner=ANY($1::text[]))',[[owner,foreign]]),
    sql.query("DELETE FROM auth_limits WHERE key IN (SELECT 'users:'||id FROM users WHERE plant_owner=ANY($1::text[])) OR key IN (SELECT 'password:'||id FROM users WHERE plant_owner=ANY($1::text[]))",[[owner,foreign]]),
    sql.query('DELETE FROM users WHERE plant_owner=ANY($1::text[])',[[owner,foreign]]),
    ...['readings','reading_revisions','fusion_reports','fusion_state','plants'].map(table=>sql.query('DELETE FROM '+table+' WHERE owner=ANY($1::text[])',[[owner,foreign]])),
  ]);
}
