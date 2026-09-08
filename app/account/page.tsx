import {getUser} from '@/lib/auth';
import {redirect} from 'next/navigation';
import PasswordForm from './password-form';
import {isAdmin,roleLabels} from '@/lib/roles';
export const dynamic='force-dynamic';
export default async function Account(){const user=await getUser();if(!user)redirect('/login');if(isAdmin(user))return <PasswordForm/>;return <main className="account-page"><section className="panel"><a href="/">← Назад кон прегледот</a><h1>Мој профил</h1><p>{user.displayName}</p><p>{user.email} · {roleLabels[user.role]}</p><p>Имате пристап до прегледите, MEMO цените и CSV извештаите. За промена на пристапот или лозинката обратете се кај администраторот.</p></section></main>;}
