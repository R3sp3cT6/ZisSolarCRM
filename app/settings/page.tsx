import {VisitTracker} from '@/components/visit-tracker';
import Dashboard from '../solar-app';
import {getUser} from '@/lib/auth';
import {redirect} from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Settings(){
 const user=await getUser();if(!user)redirect('/login');
 return <><VisitTracker/><Dashboard initialPage="settings" user={{id:user.userId,name:user.displayName,email:user.email,role:user.role}}/></>;
}
