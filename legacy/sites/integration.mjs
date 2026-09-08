import assert from 'node:assert/strict';
const base='http://localhost:3000';
const noAuth=await fetch(base+'/api/solar');assert.equal(noAuth.status,401);
const auth=await fetch(base+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});
const cookie=auth.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');assert.ok(cookie);
async function get(period='day'){const r=await fetch(base+'/api/solar?date=2026-09-07&period='+period,{headers:{cookie}});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
async function post(body,origin=base){const r=await fetch(base+'/api/solar',{method:'POST',headers:{cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={error:text};}return {status:r.status,data};}
const csrf=await post({action:'sync',date:'2026-09-07'},'https://untrusted.example');assert.equal(csrf.status,403);
const sync=await post({action:'sync',date:'2026-09-07'});assert.equal(sync.status,200);assert.equal(sync.data.error,null,JSON.stringify(sync.data));
const initial=await get();assert.equal(initial.market.length,24);assert.equal(initial.totals.readings,0,'Test requires an empty local readings database.');
const rows=[{start:'2026-09-06T22:00:00Z',productionKwh:110,exportKwh:100},{start:'2026-09-06T23:00:00Z',productionKwh:50,exportKwh:null}];
const saved=await post({action:'import',readings:rows});assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.data.saved,2);
const again=await post({action:'import',readings:rows});assert.equal(again.status,200);
const day=await get();assert.equal(day.totals.readings,2);assert.equal(day.totals.productionKwh,160);assert.equal(day.totals.exportKwh,100);assert.equal(day.totals.priced,1);assert.equal(day.totals.unmetered,1);
assert.ok(Math.abs(day.totals.revenue-100/1000*(day.market[0].memo*.94-2.2))<1e-9);
assert.ok(day.totals.estimate!==null);assert.equal(day.power,null);
for(const period of ['month','year']){const result=await get(period);assert.equal(result.totals.productionKwh,160);assert.equal(result.totals.revenue,day.totals.revenue);}
const before=day.totals.productionKwh;
const invalid=await post({action:'import',readings:[rows[0],{...rows[1],productionKwh:-5}]});assert.equal(invalid.status,400);assert.equal((await get()).totals.productionKwh,before);
console.log('PASS: authentication, CSRF, real MEMO prices, durable import, idempotent totals, measured vs estimated revenue, day/month/year aggregation and invalid-import rollback.');

