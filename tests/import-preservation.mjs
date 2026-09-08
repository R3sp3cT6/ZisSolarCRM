// Run against a maintenance database with --conditions=react-server --experimental-transform-types --import ./tests/register-ts.mjs.
import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {saveReadings} from '../lib/solar-server.ts';
const sql=neon(process.env.DATABASE_URL),owner='test-import-'+crypto.randomUUID();
const start='2026-04-10T10:00:00.000Z',observedAt=new Date().toISOString();
const row={start,productionKwh:500,exportKwh:490,powerKw:null,observedAt};
try{
 await saveReadings(owner,[row],'XLSX');
 await saveReadings(owner,[{...row,productionKwh:null,exportKwh:null}],'Huawei',true);
 let [saved]=await sql.query('SELECT * FROM readings WHERE owner=$1',[owner]);
 assert.equal(saved.production_kwh,500);assert.equal(saved.export_kwh,490);
 await saveReadings(owner,[{...row,productionKwh:501,exportKwh:null}],'Huawei',true);
 [saved]=await sql.query('SELECT * FROM readings WHERE owner=$1',[owner]);
 assert.equal(saved.production_kwh,501);assert.equal(saved.export_kwh,490);
 await saveReadings(owner,[{...row,productionKwh:0,exportKwh:0}],'Huawei',true);
 [saved]=await sql.query('SELECT * FROM readings WHERE owner=$1',[owner]);
 assert.equal(saved.production_kwh,0);assert.equal(saved.export_kwh,0);
 await saveReadings(owner,[{...row,exportKwh:null}],'Manual');
 [saved]=await sql.query('SELECT * FROM readings WHERE owner=$1',[owner]);
 assert.equal(saved.production_kwh,500);assert.equal(saved.export_kwh,null);
 assert.equal((await sql.query('SELECT * FROM reading_revisions WHERE owner=$1',[owner])).length,5);
 console.log('PASS: API gaps preserve imports, measured corrections and zeros update, explicit manual edits remain supported, all revisions retained.');
}finally{
 await sql.transaction(['reading_revisions','readings','plants'].map(table=>sql.query('DELETE FROM '+table+' WHERE owner=$1',[owner])));
}
