import test from 'node:test';
import assert from 'node:assert/strict';
import {slotsForDay,rangeFor,validDate,salePrice,revenue,validateReadings,parseMemo,localDate} from '../lib/energy.ts';
test('contract uses MWh conversion and keeps zero and negative prices',()=>{
 assert.equal(salePrice(100),91.8);assert.equal(revenue(500,100),45.9);
 assert.equal(salePrice(0),-2.2);assert.equal(revenue(1000,0),-2.2);
 assert.ok(Math.abs(revenue(1000,-20)+21)<1e-9);assert.equal(revenue(0,100),0);
});
test('Skopje delivery days preserve 23 and 25 hour DST dates',()=>{
 const spring=slotsForDay('2026-03-29');assert.equal(spring.length,23);assert.ok(!spring.some(s=>s.hour===2));
 const autumn=slotsForDay('2026-10-25');assert.equal(autumn.length,25);assert.equal(new Set(autumn.map(s=>s.start)).size,25);assert.equal(autumn.filter(s=>s.hour===2).length,2);
 assert.notEqual(autumn.filter(s=>s.hour===2)[0].label,autumn.filter(s=>s.hour===2)[1].label);
 assert.equal(slotsForDay('2026-09-08').length,24);assert.equal(localDate('2026-09-07T22:00:00Z'),'2026-09-08');
});
test('ranges use local calendar boundaries and reject ambiguous hour choices',()=>{
 assert.deepEqual(rangeFor('2026-09-08','month'),{from:'2026-08-31T22:00:00.000Z',to:'2026-09-30T22:00:00.000Z'});
 assert.deepEqual(rangeFor('2026-09-08','year'),{from:'2025-12-31T23:00:00.000Z',to:'2026-12-31T23:00:00.000Z'});
 assert.throws(()=>rangeFor('2026-09-08','hour','2026-09-08T00:00:00Z'));assert.ok(!validDate('2026-02-30'));
});
test('readings reject cumulative ambiguity, invalid numbers and duplicated instants',()=>{
 const now=new Date('2026-09-08T12:30:00Z');const row={start:'2026-09-08T12:00:00+02:00',productionKwh:5,exportKwh:null};
 assert.equal(validateReadings([row],now)[0].start,'2026-09-08T10:00:00.000Z');assert.equal(validateReadings([row],now)[0].exportKwh,null);
 for(const edit of [{productionKwh:-1},{productionKwh:NaN},{productionKwh:''},{start:'2026-09-08T12:00:00'},{start:'2026-09-08T10:30:00Z'},{start:'2026-09-09T10:00:00Z'}])assert.throws(()=>validateReadings([{...row,...edit}],now));
 assert.throws(()=>validateReadings([row,{...row,start:'2026-09-08T10:00:00Z'}],now));
});
function fixture(day,hours=Array.from({length:24},(_,i)=>i),currency='€/MWh'){
 const display=day.split('-').reverse().join('.');return `<table><thead><tr><th></th><th></th><th>${display}</th></tr></thead><tbody>${hours.map(h=>`<tr><td>${String(h).padStart(2,'0')} - ${String(h+1).padStart(2,'0')}</td><td>${currency}</td><td>${h===12?'-10,00':'100,00'}</td></tr>`).join('')}</tbody></table>`;
}
test('MEMO parser refuses missing prices, wrong units and ambiguous DST data',()=>{
 const points=parseMemo(fixture('2026-09-08'));assert.equal(points.length,24);assert.equal(points[12].eurCents,-1000);assert.equal(points[0].start,'2026-09-07T22:00:00.000Z');
 assert.throws(()=>parseMemo(fixture('2026-09-08',undefined,'MKD/MWh')));
 assert.throws(()=>parseMemo(fixture('2026-09-08').replace('<td>100,00</td>','<td>-</td>')));
 assert.throws(()=>parseMemo(fixture('2026-10-25')));
 const repeated=[0,1,2,2,...Array.from({length:21},(_,i)=>i+3)];assert.equal(parseMemo(fixture('2026-10-25',repeated)).length,25);
 assert.equal(parseMemo(fixture('2026-03-29',Array.from({length:24},(_,i)=>i).filter(i=>i!==2))).length,23);
});
