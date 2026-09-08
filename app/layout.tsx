import type {Metadata} from 'next';
import {headers} from 'next/headers';
import {ThemeToggle} from '@/components/theme-toggle';
import {themeBootstrap} from '@/lib/theme';
import './globals.css';
import './theme.css';
import './mobile.css';
import './period-tabs.css';
import './calendar-records.css';
export const metadata: Metadata = {
  title: 'ZIS Solar · Производство и приход',
  description: 'Вашата соларна централа, MEMO цени и приход на едно место.',
  icons: {
    icon: {url: '/zis-solar-icon.svg', type: 'image/svg+xml', sizes: 'any'},
    apple: {url: '/zis-solar-logo-transparent.png', type: 'image/png'},
  },
};
export default async function Layout({children}:{children:React.ReactNode}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <html lang="mk" suppressHydrationWarning>
    <head><script nonce={nonce} dangerouslySetInnerHTML={{__html: themeBootstrap}}/></head>
    <body><ThemeToggle/>{children}</body>
  </html>;
}
