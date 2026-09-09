import 'server-only';
import {Redis} from '@upstash/redis';
import {gzip,gunzip} from 'node:zlib';
import {promisify} from 'node:util';
const zip=promisify(gzip),unzip=promisify(gunzip);
type Compressed={encoding:'zis-gzip-v1';value:string};

// Durable, shared storage. Never replace this with a process-local Map on Vercel.
export const CACHE_PREFIX='zis-solar:v1:';
let client:Redis|undefined;
export function sharedCache(){
 const url=process.env.KV_REST_API_URL??process.env.UPSTASH_REDIS_REST_URL;
 const token=process.env.KV_REST_API_TOKEN??process.env.UPSTASH_REDIS_REST_TOKEN;
 if(!url||!token)return null;
 return client??=new Redis({url,token,retry:{retries:1},signal:()=>AbortSignal.timeout(8000)});
}
export const cacheKey=(key:string)=>CACHE_PREFIX+key;
export async function cacheRead<T>(key:string):Promise<T|null>{
 const value=await sharedCache()?.get<T|Compressed>(cacheKey(key))??null;
 if(value&&typeof value==='object'&&'encoding' in value&&value.encoding==='zis-gzip-v1')return JSON.parse((await unzip(Buffer.from((value as Compressed).value,'base64'),{maxOutputLength:16*1024*1024})).toString('utf8')) as T;
 return value as T|null;
}
export async function cacheWrite(key:string,value:unknown,ttl?:number){
 const cache=sharedCache();if(!cache)return;
 const json=JSON.stringify(value);
 const stored=Buffer.byteLength(json)>32768?{encoding:'zis-gzip-v1',value:(await zip(json)).toString('base64')}:value;
 if(ttl)await cache.set(cacheKey(key),stored,{ex:ttl});else await cache.set(cacheKey(key),stored);
}
export async function withCacheLock<T>(key:string,work:()=>Promise<T>,seconds=260):Promise<{busy:true}|{busy:false;value:T}>{
 const cache=sharedCache();if(!cache)return {busy:false,value:await work()};
 const token=crypto.randomUUID(),lock=cacheKey('lock:'+key);
 if(!await cache.set(lock,token,{nx:true,ex:seconds}))return {busy:true};
 try{return {busy:false,value:await work()};}
 finally{await cache.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",[lock],[token]);}
}
