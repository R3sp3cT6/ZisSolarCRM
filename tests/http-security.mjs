import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {tokenHash} from '../lib/password.ts';
const base=process.env.TEST_BASE_URL||'http://localhost:3001';
if(!new URL(base).hostname.match(/^(localhost|127\.0\.0\.1)$/))throw Error('Rate-limit tests must use the local test server.');
const username='security-probe-'+randomUUID();
const sql=neon(process.env.DATABASE_URL);
const send=(body,extra={})=>fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...extra},body});
try{
 for(const path of ['/api/solar','/api/users','/api/solar-sync'])assert.equal((await fetch(base+path)).status,401);
 for(const path of ['/.env','/.env.local','/zissolarpass.txt','/.git/config'])assert.equal((await fetch(base+path)).status,404);
 assert.equal((await send('{}',{Origin:'https://untrusted.example'})).status,403);
 assert.equal((await send('null')).status,400);
 assert.equal((await send('{}',{'Content-Type':'text/plain'})).status,415);
 assert.equal((await send(JSON.stringify({username,password:'x'.repeat(2500)}))).status,413);
 const pages=await Promise.all([fetch(base+'/login'),fetch(base+'/login',{headers:{'x-nonce':'attacker-nonce'}})]);
 const nonces=pages.map(r=>r.headers.get('content-security-policy').match(/'nonce-([^']+)'/)[1]);
 assert.notEqual(nonces[0],nonces[1]);assert.notEqual(nonces[1],'attacker-nonce');
 for(const r of pages){assert.equal(r.headers.get('x-frame-options'),'DENY');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('cache-control'),/no-store/);}
 for(let i=0;i<10;i++)assert.equal((await send(JSON.stringify({username,password:'wrong password'}),{'x-forwarded-for':'192.0.2.'+i})).status,401);
 const limited=await send(JSON.stringify({username,password:'wrong password'}));assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'900');
 console.log('PASS: anonymous API denial, private-file denial, CSRF, body limits, nonce uniqueness/spoof resistance, cache headers and login throttling.');
}finally{await sql.query('DELETE FROM auth_limits WHERE key=$1',['login-account:'+tokenHash(username)]);}
