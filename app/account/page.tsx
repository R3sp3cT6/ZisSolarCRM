import {getUser} from '@/lib/auth';
import {redirect} from 'next/navigation';
import PasswordForm from './password-form';
export const dynamic='force-dynamic';
export default async function Account(){if(!await getUser())redirect('/login');return <PasswordForm/>;}
