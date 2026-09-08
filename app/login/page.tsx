import {getUser} from '@/lib/auth';
import {redirect} from 'next/navigation';
import LoginForm from './login-form';
export const dynamic='force-dynamic';
export default async function Login(){if(await getUser())redirect('/');return <LoginForm/>;}
