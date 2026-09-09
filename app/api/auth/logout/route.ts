import {revokeSession} from '@/lib/session-cache';
import {cookies} from 'next/headers';
import {sameOrigin,SESSION_COOKIE} from '@/lib/auth';
import {db} from '@/db/index';
import {tokenHash} from '@/lib/password';
export async function POST(request:Request){if(!sameOrigin(request))return new Response('Forbidden',{status:403});const jar=await cookies();const token=jar.get(SESSION_COOKIE)?.value;if(token){await revokeSession(tokenHash(token));await db().prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash(token)).run();}jar.delete(SESSION_COOKIE);return Response.redirect(new URL('/login',request.url),303);}
