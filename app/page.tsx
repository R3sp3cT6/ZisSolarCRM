import {VisitTracker} from '@/components/visit-tracker';
import Dashboard from './solar-app';
import { getUser } from '@/lib/auth';
import {redirect} from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Home({searchParams}:{searchParams:Promise<{view?:string}>}) {
 const user = await getUser();
 if(!user)redirect('/login');
 const {view}=await searchParams;
 const initialPage=view&&['overview','market','archive','forecast','connect','users'].includes(view)?view:'overview';
 return <><VisitTracker/><Dashboard initialPage={initialPage} user={{id:user.userId,name:user.displayName,email:user.email,role:user.role}} /></>;
}

