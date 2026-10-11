import type {Metadata} from 'next';
import {headers} from 'next/headers';
import {ThemeToggle} from '@/components/theme-toggle';
import {LanguageSwitch} from '@/components/language-switch';
import {themeBootstrap} from '@/lib/theme';
import './globals.css';
import './theme.css';
import './mobile.css';
import './period-tabs.css';
import './calendar-records.css';
import './language.css';
import './interactions.css';
import './mobile-reading.css';
import './forecast.css';
export const metadata: Metadata = {
  title: 'ZIS Solar · Производство и приход',
  description: 'Вашата соларна централа, MEMO цени и приход на едно место.',
  icons: {
    icon: {url: '/zis-solar-icon.svg', type: 'image/svg+xml', sizes: 'any'},
    apple: {url: '/zis-app-icon-180.png', type: 'image/png', sizes: '180x180'},
  },
};
export default async function Layout({children}:{children:React.ReactNode}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <html lang="mk" suppressHydrationWarning>
    <head><script nonce={nonce} dangerouslySetInnerHTML={{__html: themeBootstrap}}/></head>
    <body><LanguageSwitch/><ThemeToggle/>{children}</body>
  </html>;
}
