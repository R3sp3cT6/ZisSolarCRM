import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson, contentSecurityPolicy} from '../lib/request-security.ts';

const request = (body, headers={}) => new Request('https://zissolar.vercel.app/api/test', {method:'POST',headers:{'content-type':'application/json',...headers},body});
test('JSON boundaries reject malformed/non-object input and non-JSON media', async()=>{
  for(const body of ['null','[]','42','"value"','{']) await assert.rejects(readJson(request(body),100),{status:400});
  await assert.rejects(readJson(request('{}',{'content-type':'text/plain'}),100),{status:415});
  assert.deepEqual(await readJson(request('{"name":"Ресен"}'),100),{name:'Ресен'});
});
test('body limit counts UTF-8 bytes and cancels chunked input without Content-Length',async()=>{
  await assert.rejects(readJson(request('{"x":"аааа"}'),12),{status:413});
  let cancelled=false;
  const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}});
  const streamed=new Request('https://zissolar.vercel.app/api/test',{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'});
  await assert.rejects(readJson(streamed,12),{status:413});assert.equal(cancelled,true);
  await assert.rejects(readJson(request('{}',{'content-length':'9999'}),100),{status:413});
});
test('production CSP requires a nonce and blocks script eval, framing and off-site submissions',()=>{
  const csp=contentSecurityPolicy('test-nonce');
  const scripts=csp.split('; ').find(p=>p.startsWith('script-src'));
  assert.ok(scripts.includes("'nonce-test-nonce'"));assert.ok(scripts.includes("'strict-dynamic'"));
  assert.ok(!scripts.includes('unsafe-inline'));assert.ok(!scripts.includes('unsafe-eval'));
  for(const directive of ["frame-ancestors 'none'","object-src 'none'","base-uri 'none'","form-action 'self'","connect-src 'self'"])assert.ok(csp.includes(directive));
});
