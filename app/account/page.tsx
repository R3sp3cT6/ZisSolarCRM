import {getUser} from '@/lib/auth';
import {redirect} from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Account(){if(!await getUser())redirect('/login');redirect('/settings#notifications');}
