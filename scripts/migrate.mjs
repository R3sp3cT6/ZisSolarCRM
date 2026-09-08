import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const sql=neon(process.env.DATABASE_URL);
await sql.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
const migrations=[{version:'001',url:new URL('../db/schema.sql',import.meta.url)},...(await readdir(new URL('../db/migrations/',import.meta.url))).filter(name=>/^\d+_.+\.sql$/.test(name)).sort().map(name=>({version:name.split('_')[0],url:new URL('../db/migrations/'+name,import.meta.url)}))];
for(const migration of migrations){
 const schema=(await readFile(migration.url,'utf8')).replace(/\r\n/g,'\n'),hash=createHash('sha256').update(schema).digest('hex');
 const windowsHash=createHash('sha256').update(schema.replace(/\n/g,'\r\n')).digest('hex');
 const [existing]=await sql.query('SELECT checksum FROM schema_migrations WHERE version=$1',[migration.version]);
 if(existing&&existing.checksum!==hash&&existing.checksum!==windowsHash)throw new Error('Migration '+migration.version+' checksum differs. Add a new migration.');
 if(!existing){await sql.transaction([sql.query('SELECT pg_advisory_xact_lock(725891241)'),...schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>sql.query(s)),sql.query('INSERT INTO schema_migrations(version,checksum) VALUES ($1,$2)',[migration.version,hash])]);console.log('Applied migration '+migration.version);}
}
console.log('Database schema is current.');
