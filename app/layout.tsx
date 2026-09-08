import type {Metadata} from 'next';
import {ThemeToggle} from '@/components/theme-toggle';
import {themeBootstrap} from '@/lib/theme';
import './globals.css';
import './theme.css';
import './mobile.css';
export const metadata: Metadata = {
  title: 'ZIS Solar · Производство и приход',
  description: 'Вашата соларна централа, MEMO цени и приход на едно место.',
  icons: {
    icon: {url: '/zis-solar-icon.svg', type: 'image/svg+xml', sizes: 'any'},
    apple: {url: '/zis-solar-logo-transparent.png', type: 'image/png'},
  },
};
export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="mk" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{__html: themeBootstrap}}/></head>
    <body><ThemeToggle/>{children}</body>
  </html>;
}
