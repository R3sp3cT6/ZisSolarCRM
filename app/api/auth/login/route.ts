import {authLimit,createSession,sameOrigin} from '@/lib/auth';
import {db} from '@/db/index';
import {tokenHash,verifyPassword} from '@/lib/password';
import {readJson,RequestError} from '@/lib/request-security';
export const runtime='nodejs';
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Невалидно потекло.'},{status:403});
 try {
  const body=await readJson(request,2048);
  const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
  if(!/^[a-z0-9][a-z0-9._+\-]*@[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?)+$/.test(username)||typeof body.password!=='string'||body.password.length>128)return Response.json({error:'Погрешна е-пошта или лозинка.'},{status:401});
  // Vercel overwrites this trusted header; never trust a caller's X-Forwarded-For.
  const ip=process.env.VERCEL?request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()??'unknown':'local';
  const ipKey='login-ip:'+tokenHash(ip),accountKey='login-account:'+tokenHash(username);
  if(!await authLimit(ipKey,30))return Response.json({error:'Премногу обиди. Обидете се по 15 минути.'},{status:429,headers:{'Retry-After':'900'}});
  if(!await authLimit(accountKey,10))return Response.json({error:'Премногу обиди. Обидете се по 15 минути.'},{status:429,headers:{'Retry-After':'900'}});
  const row=await db().prepare('SELECT id,password_hash,active FROM users WHERE username=?').bind(username).first<{id:string;password_hash:string;active:boolean}>();
  const valid=await verifyPassword(body.password,row?.password_hash??('scrypt-v1:'+'0'.repeat(32)+':'+'0'.repeat(128)));
  if(!row||!row.active||!valid)return Response.json({error:'Погрешна е-пошта или лозинка.'},{status:401});
  await createSession(row.id,row.password_hash);
  await db().prepare('DELETE FROM auth_limits WHERE key=?').bind(accountKey).run();
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  if(error instanceof RequestError)return Response.json({error:error.message},{status:error.status});
  return Response.json({error:'Најавата моментално не е достапна.'},{status:503});
 }
}
