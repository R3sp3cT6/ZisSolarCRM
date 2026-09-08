import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeHistory,nextHistoryDay} from '../lib/history-coverage.ts';
import {hourlyReportCoverage} from '../lib/fusionsolar.ts';
import {slotsForDay} from '../lib/energy.ts';
test('history completeness requires every hour, production, export and MEMO price',()=>{
 const full={day:'2026-09-07',hours:24,production:24,exported:24,priced:24};
 assert.equal(summarizeHistory('2026-09-07','2026-09-08',[full],['2026-09-07']).complete,true);
 for(const key of ['hours','production','exported','priced']){const report=summarizeHistory('2026-09-07','2026-09-08',[{...full,[key]:23}],['2026-09-07']);assert.equal(report.complete,false);}
 assert.equal(summarizeHistory('2026-09-07','2026-09-08',[full],[]).complete,false);
 assert.equal(summarizeHistory('2026-10-25','2026-10-26',[],[]).expectedHours,25);
});
test('one returned record and null production cannot mark a whole day complete',()=>{
 const rows=slotsForDay('2026-09-07').map(s=>({start:s.start,productionKwh:0,exportKwh:0}));const now=new Date('2026-09-08T12:00:00Z');
 assert.equal(hourlyReportCoverage(rows,'2026-09-07',now).complete,true);
 assert.equal(hourlyReportCoverage(rows.slice(0,1),'2026-09-07',now).complete,false);
 assert.equal(hourlyReportCoverage(rows.map(r=>({...r,productionKwh:null})),'2026-09-07',now).complete,false);
});
test('a recent incomplete day does not starve unrequested history; legacy flags are rechecked',()=>{
 const reports=[{period:'2026-09-07',payload:JSON.stringify({complete:true}),updated_at:'2026-09-08T00:00:00Z'}];
 assert.equal(nextHistoryDay('2026-09-05','2026-09-08',reports,Date.parse('2026-09-08T12:00:00Z')),'2026-09-06');
 assert.equal(nextHistoryDay('2026-09-07','2026-09-08',reports,Date.parse('2026-09-16T12:00:00Z')),'2026-09-07');
});
