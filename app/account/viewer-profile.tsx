'use client';
import {useLanguage} from '@/components/language-switch';
import {t} from '@/lib/language';
export function ViewerProfile({name,email,role}:{name:string;email:string;role:string}){
  useLanguage();
  return <main className="account-page"><section className="panel"><a href="/">{t('← Назад кон прегледот')}</a><h1>{t('Мој профил')}</h1><p>{name}</p><p>{email} · {t(role)}</p><p>{t('Имате пристап до прегледите, MEMO цените и CSV извештаите. За промена на пристапот или лозинката обратете се кај администраторот.')}</p></section></main>;
}
