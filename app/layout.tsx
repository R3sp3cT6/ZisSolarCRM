import type {Metadata} from 'next';
import './globals.css';
export const metadata: Metadata = {title:'ZIS Solar · Производство и приход',description:'Вашата соларна централа, MEMO цени и приход на едно место.'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="mk"><body>{children}</body></html>;}
