'use client';
import {UserRound} from 'lucide-react';
import {PushSettings} from './push-settings';
import PasswordForm from '@/app/account/password-form';
import {t} from '@/lib/language';
import {useLanguage} from './language-switch';
import {roleLabels,type Role} from '@/lib/roles';

export function AccountSettings({user}:{user:{name:string;email:string;role:Role}}){
 useLanguage();
 return <div className="settings-grid">
  <PushSettings/>
  <div className="settings-profile">
   <section id="profile" className="panel">
    <div className="panel-heading"><h2>{t('Мој профил')}</h2><UserRound size={20}/></div>
    <dl className="settings-details">
     <div><dt>{t('Име и презиме')}</dt><dd>{user.name}</dd></div>
     <div><dt>{t('Е-пошта')}</dt><dd>{user.email}</dd></div>
     <div><dt>{t('Улога')}</dt><dd>{t(roleLabels[user.role])}</dd></div>
    </dl>
    {user.role!=='admin'&&<p className="fine-print">{t('За промена на пристапот или лозинката обратете се кај администраторот.')}</p>}
   </section>
   {user.role==='admin'&&<PasswordForm embedded/>}
  </div>
 </div>;
}
