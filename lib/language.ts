import translations from './translations.json' with {type:'json'};
import {currencyText} from './currency';
export type Language = 'mk' | 'en';
export const LANGUAGE_KEY = 'zis-solar-language';
let language: Language = 'mk';
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export const getLocale = () => language === 'en' ? 'en-GB' : 'mk-MK';
export const subscribeLanguage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setLanguage(next: Language) {
  language = next;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    document.title = next === 'en' ? 'ZIS Solar · Production and revenue' : 'ZIS Solar · Производство и приход';
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch {}
  }
  listeners.forEach(listener => listener());
}
const dictionary: Record<string,string> = translations;
const escaped = Object.keys(dictionary).sort((a,b)=>b.length-a.length).map(key=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
const phrases = new RegExp('(?<![\\p{L}])(?:'+escaped.join('|')+')(?![\\p{L}])','gu');
export function translate(value: string, lang: Language): string {
  if (lang === 'mk') return value;
  const key = value.trim();
  if (dictionary[key]) return value.replace(key, dictionary[key]);
  // Handles server messages and labels containing dynamic counts or timestamps.
  return value.replace(phrases, match => dictionary[match]);
}
export function t<T>(value: T): T { return (typeof value === 'string' ? currencyText(translate(value, language)) : value) as T; }
