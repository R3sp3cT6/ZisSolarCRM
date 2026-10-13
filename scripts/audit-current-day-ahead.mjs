import fs from 'node:fs';
import {db} from '../db/index.ts';
import {getCachedDashboard} from '../lib/solar-cache.ts';
import {localDate} from '../lib/energy.ts';
const {owner}=await db().prepare("SELECT owner FROM plants WHERE name='ZIS Solar'").first();
const day=localDate();
const data=await getCachedDashboard(owner,day,'month');
const result={auditedAt:new Date().toISOString(),day,range:data.range,
  score:data.forecastComparison.dayAheadScore,
  note:'Current prospectively issued day-ahead dashboard cohort; not the frozen April–October historical experiment. Partial hours excluded. Current day and month incomplete.'};
fs.writeFileSync('docs/current-day-ahead-audit.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
