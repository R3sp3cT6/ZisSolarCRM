import test from 'node:test';
import assert from 'node:assert/strict';
import {translate,t,setLanguage,getLocale,subscribeLanguage} from '../lib/language.ts';
import {formatMwh,energyReportCsv} from '../lib/energy-report.ts';
test('UI messages and dynamic counts translate without changing measured values',()=>{
 assert.equal(translate('Пресметан приход','en'),'Calculated revenue');
 assert.equal(translate('14 пресметани часови','en'),'14 calculated hours');
 assert.equal(translate('Huawei FusionSolar · часовен извештај + XLSX','en'),'Huawei FusionSolar · hourly report + XLSX');
 assert.equal(translate('Погрешно корисничко име или лозинка.','en'),'Incorrect username or password.');
 assert.equal(translate('4.12 MWh','en'),'4.12 MWh');
 assert.equal(translate('Ден','mk'),'Ден');
 const values={productionKwh:4123.56};assert.equal(t(values),values);assert.equal(t(null),null);
});
test('language subscribers update, numbers stay at two decimals and CSV is stable',()=>{
 let notifications=0;const stop=subscribeLanguage(()=>notifications++);
 const rows=[{start:'2026-09-08T10:00:00Z',productionKwh:4123.56,exportKwh:4000,memo:50,sale:44.8,revenue:179.2,estimate:null,priceFetchedAt:null}];
 const before=energyReportCsv(rows,'contract');
 try{setLanguage('en');assert.equal(getLocale(),'en-GB');assert.equal(formatMwh(4123.56),'4.12');assert.equal(t('Ден'),'Day');assert.equal(energyReportCsv(rows,'contract'),before);setLanguage('mk');assert.equal(t('Ден'),'Ден');assert.equal(notifications,2);}finally{stop();setLanguage('mk');}
});
