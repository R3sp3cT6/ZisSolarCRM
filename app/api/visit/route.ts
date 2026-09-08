import {getUser,sameOrigin} from '@/lib/auth';
import {db} from '@/db';
export async function POST(request:Request){
 if(!sameOrigin(request))return new Response(null,{status:403});
 const user=await getUser();if(!user)return new Response(null,{status:401});
 await db().prepare("UPDATE users SET visit_count=visit_count+CASE WHEN last_visit_at IS NULL OR last_visit_at<now()-interval '30 minutes' THEN 1 ELSE 0 END,last_visit_at=now() WHERE id=?").bind(user.userId).run();
 return new Response(null,{status:204});
}
