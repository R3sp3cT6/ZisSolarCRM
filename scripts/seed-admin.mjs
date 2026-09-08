import {neon} from '@neondatabase/serverless';
import {hashPassword} from '../lib/password.ts';
if(!process.env.DATABASE_URL||!process.env.FUSIONSOLAR_OWNER||!process.env.ADMIN_PASSWORD)throw new Error('DATABASE_URL, FUSIONSOLAR_OWNER and ADMIN_PASSWORD are required');
const sql=neon(process.env.DATABASE_URL),owner=process.env.FUSIONSOLAR_OWNER;
await sql.transaction([
 sql.query('INSERT INTO plants(owner,name,created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[owner,'ZIS Solar',new Date().toISOString()]),
 sql.query('INSERT INTO users(id,username,display_name,password_hash,plant_owner,role) VALUES ($1,$2,$3,$4,$1,'admin') ON CONFLICT DO NOTHING',[owner,'admin','ZIS Solar',await hashPassword(process.env.ADMIN_PASSWORD)])
]);
console.log('Owner account initialized. Existing passwords were preserved.');
