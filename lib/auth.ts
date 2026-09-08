import 'server-only';
import {cookies} from 'next/headers';
import {randomBytes} from 'node:crypto';
import {db} from '../db/index';
import {tokenHash} from './password';
import type {Role} from './roles';
export const SESSION_COOKIE='zis_session',SESSION_AGE=7*86400;
export type User={userId:string;displayName:string;email:string;role:Role;plantOwner:string};
export async function getUser():Promise<User|null>{const token=(await cookies()).get(SESSION_COOKIE)?.value;if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;const row=await db().prepare('SELECT u.id,u.display_name,u.username,u.role,u.plant_owner FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>now() AND u.active=true').bind(tokenHash(token)).first<{id:string;display_name:string;username:string;role:Role;plant_owner:string}>();return row?{userId:row.id,displayName:row.display_name,email:row.username,role:row.role,plantOwner:row.plant_owner}:null;}
export async function createSession(userId:string){const token=randomBytes(32).toString('base64url');await db().batch([db().prepare('DELETE FROM sessions WHERE expires_at<now()'),db().prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(tokenHash(token),userId,new Date(Date.now()+SESSION_AGE*1000).toISOString())]);(await cookies()).set(SESSION_COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:SESSION_AGE});}
export function sameOrigin(request:Request){return request.headers.get('origin')===new URL(request.url).origin;}
export async function authLimit(key:string,max=10){const row=await db().prepare("INSERT INTO auth_limits(key,attempts,reset_at) VALUES (?,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_limits.reset_at<now() THEN 1 ELSE auth_limits.attempts+1 END,reset_at=CASE WHEN auth_limits.reset_at<now() THEN now()+interval '15 minutes' ELSE auth_limits.reset_at END RETURNING attempts").bind(key).first<{attempts:number}>();return (row?.attempts??max+1)<=max;}
