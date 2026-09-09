import 'server-only';
import {db} from '../db/index';
import {cacheRead,cacheWrite,sharedCache,cacheKey,withCacheLock} from './shared-cache';
import type {User} from './auth';
type Session={user:User;expiresAt:number;version:string};
type Row={id:string;display_name:string;username:string;role:User['role'];plant_owner:string;expires_at:string};
const ttl=7*86400;
const versionKey=(id:string)=>'session-version:'+id;
async function lookup(hash:string){return db().prepare('SELECT u.id,u.display_name,u.username,u.role,u.plant_owner,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>now() AND u.active=true').bind(hash).first<Row>();}
const userOf=(row:Row):User=>({userId:row.id,displayName:row.display_name,email:row.username,role:row.role,plantOwner:row.plant_owner});
export async function readSession(hash:string,fresh=false):Promise<User|null>{
 const cache=sharedCache();if(!cache){const row=await lookup(hash);return row?userOf(row):null;}
 const key='session:'+hash,existing=await cacheRead<Session|false>(key);
 if(existing===false)return null;
 if(existing&&!fresh&&existing.expiresAt>Date.now()){
  const version=await cacheRead<string>(versionKey(existing.user.userId))??'0';
  if(version.startsWith('blocked:'))return null;
  if(version===existing.version)return existing.user;
 }
 const initial=await lookup(hash);if(!initial)return null;
 const before=await cacheRead<string>(versionKey(initial.id))??'0';
 if(before.startsWith('blocked:'))return null;
 // Validate again inside a stable revocation version. A concurrent role change
 // or password reset cannot publish an old session under a new cache version.
 const row=await lookup(hash);if(!row)return null;
 const after=await cacheRead<string>(versionKey(row.id))??'0';
 if(before!==after||after.startsWith('blocked:'))return null;
 const entry:Session={user:userOf(row),expiresAt:Date.parse(row.expires_at),version:after};
 // Logout tombstones must not be overwritten by an in-flight cache fill.
 const stored=await cache.eval("if redis.call('GET',KEYS[1])=='false' then return 0 end redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]); return 1",[cacheKey(key)],[JSON.stringify(entry),Math.max(1,Math.ceil((entry.expiresAt-Date.now())/1000))]);
 return stored===1?entry.user:null;
}
export async function revokeSession(hash:string){await cacheWrite('session:'+hash,false,ttl);}
export async function withSessionRevocation<T>(userId:string,work:()=>Promise<T>){
 if(!sharedCache())return work();
 const result=await withCacheLock('revoke:'+userId,async()=>{
  await cacheWrite(versionKey(userId),'blocked:'+crypto.randomUUID());
  try{return await work();}
  finally{await cacheWrite(versionKey(userId),crypto.randomUUID());}
 },30);
 if(result.busy)throw Error('Промената веќе се обработува.');
 return result.value;
}
export async function recordVisit(user:User){
 const update=()=>db().prepare("UPDATE users SET visit_count=visit_count+CASE WHEN last_visit_at IS NULL OR last_visit_at<now()-interval '30 minutes' THEN 1 ELSE 0 END,last_visit_at=now() WHERE id=?").bind(user.userId).run();
 if(!sharedCache()){await update();return;}
 await withCacheLock('visit:'+user.userId,async()=>{
  const key='visit:'+user.userId,now=Date.now();let last=await cacheRead<number>(key);
  if(last===null){const row=await db().prepare('SELECT last_visit_at FROM users WHERE id=?').bind(user.userId).first<{last_visit_at:string|null}>();last=row?.last_visit_at?Date.parse(row.last_visit_at):0;}
  if(now-last>=30*60000)await update();
  await cacheWrite(key,now,ttl);
 },15);
}
export async function refreshLimit(userId:string){
 const cache=sharedCache();if(!cache)return true;
 const key=cacheKey('refresh-limit:'+userId);
 const count=await cache.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end return n",[key],[]);
 return Number(count)<=60;
}
