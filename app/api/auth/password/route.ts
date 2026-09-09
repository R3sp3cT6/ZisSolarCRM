import {withSessionRevocation} from '@/lib/session-cache';
import {readJson,RequestError} from '@/lib/request-security';
import {getUser,authLimit,createSession,sameOrigin} from '@/lib/auth';
import {db} from '@/db/index';
import {hashPassword,validPassword,verifyPassword} from '@/lib/password';
import {isAdmin} from '@/lib/roles';
export async function POST(request:Request){
 if(!sameOrigin(request))return new Response('Forbidden',{status:403});const user=await getUser(true);if(!user)return new Response('Unauthorized',{status:401});
 if(!isAdmin(user))return Response.json({error:'За промена на лозинката обратете се кај администраторот.'},{status:403});
 if(!await authLimit('password:'+user.userId,5))return Response.json({error:'Обидете се по 15 минути.'},{status:429});
 try{const body=await readJson(request,2048);const row=await db().prepare('SELECT password_hash FROM users WHERE id=?').bind(user.userId).first<{password_hash:string}>();
 if(!row||!await verifyPassword(body.currentPassword,row.password_hash))return Response.json({error:'Тековната лозинка не е точна.'},{status:400});
 if(!validPassword(body.password))return Response.json({error:'Новата лозинка треба да содржи од 12 до 128 знаци.'},{status:400});
 const nextHash=await hashPassword(body.password);await withSessionRevocation(user.userId,()=>db().batch([db().prepare('UPDATE users SET password_hash=? WHERE id=?').bind(nextHash,user.userId),db().prepare('DELETE FROM sessions WHERE user_id=?').bind(user.userId)]));await createSession(user.userId,nextHash);return Response.json({ok:true});
 }catch(error){if(error instanceof RequestError)return Response.json({error:error.message},{status:error.status});return Response.json({error:'Лозинката не е променета. Обидете се повторно.'},{status:400});}
}
