import {buildDashboard,type DashboardSnapshot,type DbReading,type DbPrice} from './dashboard';
import 'server-only';
import {readForecastComparison} from './forecast-comparison-server';
import {attachForecastComparison} from './forecast-comparison';
import {db} from '../db/index';
export {db} from '../db/index';
const env=process.env;
import {CONTRACT,MEMO_URL,parseMemo,localDate,type Period,type ReadingInput} from './energy';
export async function ensurePlant(owner:string){if(!owner)throw Error('Недостасува сопственикот на централата.');await db().prepare('INSERT INTO plants (owner, created_at) VALUES (?, ?) ON CONFLICT(owner) DO NOTHING').bind(owner,new Date().toISOString()).run();}
export async function syncMemo(day:string,force=false){
 const connection=db();const previous=await connection.prepare('SELECT * FROM sync_runs WHERE market_date=?').bind(day).first<{attempted_at:string;succeeded_at:string|null;error:string|null}>();
 if(previous&&Date.now()-Date.parse(previous.attempted_at)<(force?60000:previous.succeeded_at&&!previous.error&&day<localDate()?86400000:300000))return {updated:0,error:previous.error,cached:true};
 const attempted=new Date().toISOString();
 await connection.prepare('INSERT INTO sync_runs (market_date,attempted_at) VALUES (?,?) ON CONFLICT(market_date) DO UPDATE SET attempted_at=excluded.attempted_at').bind(day,attempted).run();
 try{
  const response=await fetch(MEMO_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({date:day}).toString(),signal:AbortSignal.timeout(18000)});
  if(!response.ok)throw new Error('MEMO не одговори успешно.');const html=await response.text();if(html.length>1500000)throw new Error('Неочекуван одговор од MEMO.');
  const points=parseMemo(html);if(!points.some(p=>p.marketDate===day))throw new Error('MEMO сè уште нема објавено целосни часовни цени за овој датум.');
  for(let i=0;i<points.length;i+=40){const statements=points.slice(i,i+40).flatMap(p=>[
    connection.prepare('INSERT INTO price_revisions (id,start,eur_cents,fetched_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM prices WHERE start=? AND eur_cents=?)').bind(crypto.randomUUID(),p.start,p.eurCents,attempted,p.start,p.eurCents),
    connection.prepare('INSERT INTO prices (start,market_date,eur_cents,fetched_at,source) VALUES (?,?,?,?,?) ON CONFLICT(start) DO UPDATE SET eur_cents=excluded.eur_cents,fetched_at=excluded.fetched_at,source=excluded.source').bind(p.start,p.marketDate,p.eurCents,attempted,MEMO_URL)
  ]);await connection.batch(statements);}
  await connection.prepare('UPDATE sync_runs SET succeeded_at=?,error=NULL WHERE market_date=?').bind(attempted,day).run();return {updated:points.length,error:null,cached:false};
 }catch(error){const message=error instanceof Error?error.message:'Неуспешно преземање на MEMO цени.';await connection.prepare('UPDATE sync_runs SET error=? WHERE market_date=?').bind(message,day).run();return {updated:0,error:message,cached:false};}
}
export async function saveReadings(owner:string,rows:ReadingInput[],source:string,preserveMissing=false,fillOnly=false){
 await ensurePlant(owner);const connection=db();const now=new Date().toISOString();
 if(fillOnly){
  const existing=await connection.prepare('SELECT start,production_kwh,export_kwh FROM readings WHERE owner=? AND start=ANY(?::text[])').bind(owner,rows.map(r=>r.start)).all<{start:string;production_kwh:number|null;export_kwh:number|null}>();
  const byStart=new Map(existing.results.map(r=>[r.start,r]));
  rows=rows.filter(r=>{const prior=byStart.get(r.start);return !prior||(prior.production_kwh===null&&r.productionKwh!==null)||(prior.export_kwh===null&&r.exportKwh!==null);});
  if(!rows.length)return 0;
 }
 // One PostgreSQL transaction is atomic: an import either saves every row and its revision, or none.
 const payload=JSON.stringify(rows.map(r=>({...r,id:crypto.randomUUID(),source,contractVersion:CONTRACT.version})));
 // An incomplete API response must not erase measured values imported from device exports.
 const updates=fillOnly
  ? "production_kwh=COALESCE(readings.production_kwh,excluded.production_kwh),export_kwh=COALESCE(readings.export_kwh,excluded.export_kwh),power_kw=COALESCE(readings.power_kw,excluded.power_kw),observed_at=excluded.observed_at,source=CASE WHEN readings.source LIKE '%device counters%' THEN readings.source ELSE readings.source || ' + device counters' END,updated_at=excluded.updated_at"
  : preserveMissing
  ? "production_kwh=COALESCE(excluded.production_kwh,readings.production_kwh),export_kwh=COALESCE(excluded.export_kwh,readings.export_kwh),power_kw=COALESCE(excluded.power_kw,readings.power_kw),observed_at=excluded.observed_at,source=CASE WHEN (excluded.production_kwh IS NULL AND readings.production_kwh IS NOT NULL) OR (excluded.export_kwh IS NULL AND readings.export_kwh IS NOT NULL) THEN readings.source ELSE excluded.source END,updated_at=excluded.updated_at"
  : "production_kwh=excluded.production_kwh,export_kwh=excluded.export_kwh,power_kw=excluded.power_kw,observed_at=excluded.observed_at,source=excluded.source,updated_at=excluded.updated_at";
 const statements=[
 connection.prepare("INSERT INTO reading_revisions (id,owner,start,payload,created_at) SELECT value->>'id',?,value->>'start',value::text,? FROM jsonb_array_elements(?::jsonb)").bind(owner,now,payload),
 connection.prepare("INSERT INTO readings (owner,start,production_kwh,export_kwh,power_kw,observed_at,source,updated_at) SELECT ?,value->>'start',(value->>'productionKwh')::double precision,(value->>'exportKwh')::double precision,(value->>'powerKw')::double precision,value->>'observedAt',?,? FROM jsonb_array_elements(?::jsonb) ON CONFLICT(owner,start) DO UPDATE SET "+updates).bind(owner,source,now,payload)
 ];await connection.batch(statements);return rows.length;
}
export async function loadDashboardSnapshot(owner:string):Promise<DashboardSnapshot>{
 const connection=db();await ensurePlant(owner);
 const [plant,readings,prices,reports,syncs,fusion]=await Promise.all([
  connection.prepare('SELECT name,capacity_kw FROM plants WHERE owner=?').bind(owner).first<DashboardSnapshot['plant']>(),
  connection.prepare('SELECT * FROM readings WHERE owner=? ORDER BY start').bind(owner).all<DbReading>(),
  connection.prepare('SELECT start,market_date,eur_cents,fetched_at FROM prices ORDER BY start').all<DbPrice>(),
  connection.prepare('SELECT kind,period,payload,updated_at FROM fusion_reports WHERE owner=?').bind(owner).all<DashboardSnapshot['reports'][number]>(),
  connection.prepare('SELECT market_date,attempted_at,succeeded_at,error FROM sync_runs').all<DashboardSnapshot['syncs'][number]>(),
  connection.prepare('SELECT state FROM fusion_state WHERE owner=?').bind(owner).first<{state:string}>(),
 ]);
 const state=fusion?JSON.parse(fusion.state):{};
 return {owner,plant,readings:readings.results,prices:prices.results,reports:reports.results,syncs:syncs.results,
  fusionState:{live:state.live,liveHour:state.liveHour,lastSuccess:state.lastSuccess,error:state.error},
  configured:!!(env.FUSIONSOLAR_PASSWORD&&env.FUSIONSOLAR_OWNER===owner),savedAt:new Date().toISOString()};
}
export async function getDashboard(owner:string,day:string,period:Period,hour?:string){
 const [snapshot,forecast]=await Promise.all([loadDashboardSnapshot(owner),readForecastComparison(owner)]);
 return attachForecastComparison(buildDashboard(snapshot,day,period,hour),forecast);
}
