import test from 'node:test';
import assert from 'node:assert/strict';
import {convertMoney,EUR_MKD,setCurrency,currencyText} from '../lib/currency.ts';
import {energyReportCsv,formatMwh} from '../lib/energy-report.ts';
test('currency conversion preserves nulls, signs, source values and energy units',()=>{
 assert.equal(convertMoney(null,'MKD'),null);
 assert.equal(convertMoney(0,'MKD'),0);
 assert.equal(convertMoney(-10,'MKD'),-10*EUR_MKD);
 const memo=100,kwh=1234,revenue=kwh/1000*(memo*.94-2.2);
 assert.ok(Math.abs(convertMoney(revenue,'MKD')-kwh/1000*(convertMoney(memo,'MKD')*.94-convertMoney(2.2,'MKD')))<1e-8);
 const energy=formatMwh(kwh);
 try{setCurrency('MKD');assert.equal(formatMwh(kwh),energy);assert.equal(currencyText('EUR / MWh'),'MKD / MWh');assert.ok(Math.abs(convertMoney(10)-614.95)<1e-8);}finally{setCurrency('EUR');}
 assert.equal(convertMoney(10),10);
});
test('CSV declares selected currency and converts all monetary fields once',()=>{
 const rows=[{start:'2026-09-08T10:00:00Z',productionKwh:1000,exportKwh:900,memo:100,sale:91.8,revenue:82.62,estimate:null,priceFetchedAt:null}];
 const original=JSON.stringify(rows);
 try{setCurrency('MKD');const [header,line]=energyReportCsv(rows,'test').split('\n');assert.match(header,/memo_mkd_mwh,sale_mkd_mwh,revenue_mkd,estimate_mkd/);const fields=line.split(',');assert.equal(fields[1],'1.00');assert.equal(fields[3],'6149.50');assert.equal(Number(fields[5]),82.62*EUR_MKD);assert.equal(JSON.stringify(rows),original);}finally{setCurrency('EUR');}
 assert.match(energyReportCsv(rows,'test'),/revenue_eur/);
});
