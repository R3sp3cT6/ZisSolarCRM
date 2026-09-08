import {authLimit,createSession,sameOrigin} from '@/lib/auth';
import {db} from '@/db/index';
import {tokenHash,verifyPassword} from '@/lib/password';
export const runtime='nodejs';
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Невалидно потекло.'},{status:403});
 if(Number(request.headers.get('content-length'))>2048)return new Response(null,{status:413});
 try{const raw=await request.text();if(raw.length>2048)return new Response(null,{status:413});const body=JSON.parse(raw);const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
 const ip=request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()??'local';
 if(!await authLimit('login-ip:'+tokenHash(ip),10))return Response.json({error:'Премногу обиди. Обидете се по 15 минути.'},{status:429});
 const row=await db().prepare('SELECT id,password_hash FROM users WHERE username=?').bind(username).first<{id:string;password_hash:string}>();
 // Same work for unknown usernames; no account existence is disclosed.
 const valid=await verifyPassword(body.password,row?.password_hash??('scrypt-v1:'+'0'.repeat(32)+':'+'0'.repeat(128)));
 if(!row||!valid)return Response.json({error:'Погрешно корисничко име или лозинка.'},{status:401});
 await createSession(row.id);await db().prepare('DELETE FROM auth_limits WHERE key=?').bind('login-ip:'+tokenHash(ip)).run();
 return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Најавата моментално не е достапна.'},{status:503});}
}
