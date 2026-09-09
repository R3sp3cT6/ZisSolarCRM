import {getUser,sameOrigin} from '@/lib/auth';
import {recordVisit} from '@/lib/session-cache';
export async function POST(request:Request){
 if(!sameOrigin(request))return new Response(null,{status:403});
 const user=await getUser();if(!user)return new Response(null,{status:401});
 await recordVisit(user);
 return new Response(null,{status:204});
}
