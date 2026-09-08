import {ViewerProfile} from './viewer-profile';
import {getUser} from '@/lib/auth';
import {redirect} from 'next/navigation';
import PasswordForm from './password-form';
import {isAdmin,roleLabels} from '@/lib/roles';
export const dynamic='force-dynamic';
export default async function Account(){const user=await getUser();if(!user)redirect('/login');if(isAdmin(user))return <PasswordForm/>;return <ViewerProfile name={user.displayName} email={user.email} role={roleLabels[user.role]}/>;}
