'use client';
import {t} from '@/lib/language';
import {useLanguage} from '@/components/language-switch';


import {useEffect, useState} from 'react';
import {Moon, Sun} from 'lucide-react';
import {THEME_STORAGE_KEY} from '@/lib/theme';

export function ThemeToggle() {useLanguage();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      let preference: string | null = null;
      try { preference = localStorage.getItem(THEME_STORAGE_KEY); } catch {}
      const next = preference === 'dark' || (preference !== 'light' && system.matches);
      document.documentElement.classList.toggle('dark', next);
      setDark(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) sync();
    };
    sync();
    system.addEventListener('change', sync);
    window.addEventListener('storage', onStorage);
    return () => {
      system.removeEventListener('change', sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    setDark(next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light'); } catch {}
  }

  return <button type="button" className="theme-toggle" onClick={toggle}
    aria-label={t("Темен режим")} aria-pressed={dark}
    title={dark ? t("Премини во светол режим") : t("Премини во темен режим")}>
    <Moon className="theme-moon" size={19} aria-hidden="true"/>
    <Sun className="theme-sun" size={19} aria-hidden="true"/>
  </button>;
}
