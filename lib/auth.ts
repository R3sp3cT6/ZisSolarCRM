import 'server-only';
import {readSession} from './session-cache';
import {cookies} from 'next/headers';
import {randomBytes} from 'node:crypto';
import {db} from '../db/index';
import {tokenHash} from './password';
import type {Role} from './roles';
export const SESSION_COOKIE='zis_session',SESSION_AGE=7*86400;
export type User={userId:string;displayName:string;email:string;role:Role;plantOwner:string};
export async function getUser(fresh=false):Promise<User|null>{const token=(await cookies()).get(SESSION_COOKIE)?.value;if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;return readSession(tokenHash(token),fresh);}
export async function createSession(userId:string,expectedPasswordHash:string){const token=randomBytes(32).toString('base64url');const inserted=await db().prepare('WITH issued AS (INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,id,? FROM users WHERE id=? AND password_hash=? AND active=true RETURNING user_id) UPDATE users SET login_count=login_count+1 WHERE id IN (SELECT user_id FROM issued) RETURNING id AS user_id').bind(tokenHash(token),new Date(Date.now()+SESSION_AGE*1000).toISOString(),userId,expectedPasswordHash).first();if(!inserted)throw new Error('Session could not be issued');(await cookies()).set(SESSION_COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:SESSION_AGE});}
export function sameOrigin(request:Request){return request.headers.get('origin')===new URL(request.url).origin;}
export async function authLimit(key:string,max=10){const row=await db().prepare("INSERT INTO auth_limits(key,attempts,reset_at) VALUES (?,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_limits.reset_at<now() THEN 1 ELSE auth_limits.attempts+1 END,reset_at=CASE WHEN auth_limits.reset_at<now() THEN now()+interval '15 minutes' ELSE auth_limits.reset_at END RETURNING attempts").bind(key).first<{attempts:number}>();return (row?.attempts??max+1)<=max;}
