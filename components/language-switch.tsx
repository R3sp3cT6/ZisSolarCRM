'use client';
import {useEffect,useSyncExternalStore} from 'react';
import {getLanguage,subscribeLanguage,setLanguage,LANGUAGE_KEY} from '@/lib/language';
export function useLanguage(){return useSyncExternalStore(subscribeLanguage,getLanguage,()=> 'mk' as const);}
export function LanguageSwitch(){
  const language=useLanguage();
  useEffect(()=>{
    const sync=()=>{try{setLanguage(localStorage.getItem(LANGUAGE_KEY)==='en'?'en':'mk');}catch{setLanguage('mk');}};
    sync();
    const changed=(event:StorageEvent)=>{if(event.key===LANGUAGE_KEY)sync();};
    window.addEventListener('storage',changed);
    return ()=>window.removeEventListener('storage',changed);
  },[]);
  return <div className="language-switch" role="group" aria-label={language==='en'?'Language':'Јазик'}>
    <button type="button" lang="mk" aria-label="Македонски" aria-pressed={language==='mk'} onClick={()=>setLanguage('mk')}>МК</button>
    <button type="button" lang="en" aria-label="English" aria-pressed={language==='en'} onClick={()=>setLanguage('en')}>EN</button>
  </div>;
}
