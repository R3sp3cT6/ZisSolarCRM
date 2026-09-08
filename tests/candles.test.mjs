import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEnergyCandles} from '../lib/energy-candles.ts';
import {rangeFor, slotsForDay} from '../lib/energy.ts';

test('candles use chronological hourly observations and retain zero, negative revenue and missing values', () => {
  const day='2026-09-08';
  const slots=slotsForDay(day);
  const rows=[
    {start:slots[2].start,productionKwh:500,revenue:-3},
    {start:slots[0].start,productionKwh:0,revenue:0},
    {start:slots[1].start,productionKwh:900,revenue:null},
  ];
  const original=structuredClone(rows);
  const candles=buildEnergyCandles(rows,'day',rangeFor(day,'day'));
  assert.equal(candles.length,8);
  assert.deepEqual(candles[0].production,{open:0,high:.9,low:0,close:.5,count:3});
  assert.deepEqual(candles[0].revenue,{open:0,high:0,low:-3,close:-3,count:2});
  assert.equal(candles[1].production,null);
  assert.equal(candles[0].slots,3);
  assert.deepEqual(rows,original);
});

test('monthly and yearly candles preserve observation extrema instead of using period sums', () => {
  const a={start:'2026-08-31T22:00:00.000Z',productionKwh:600,revenue:40};
  const b={start:'2026-09-01T22:00:00.000Z',productionKwh:100,revenue:10};
  const month=buildEnergyCandles([a,b],'month',rangeFor('2026-09-08','month'));
  assert.equal(month.length,30);
  assert.equal(month[0].production.close,.6);
  assert.equal(month[1].production.close,.1);
  const year=buildEnergyCandles([b,a],'year',rangeFor('2026-09-08','year'));
  assert.equal(year.length,12);
  assert.deepEqual(year[8].production,{open:.6,high:.6,low:.1,close:.1,count:2});
  assert.equal(year[7].production,null);
});

test('DST buckets include both repeated hours and omit the skipped hour', () => {
  for (const [day,count,firstCount] of [['2026-03-29',23,2],['2026-10-25',25,4]]) {
    const rows=slotsForDay(day).map((slot,i)=>({start:slot.start,productionKwh:i*10,revenue:i}));
    const candles=buildEnergyCandles(rows,'day',rangeFor(day,'day'));
    assert.equal(candles.length,8);
    assert.equal(candles[0].slots,firstCount);
    assert.equal(candles.reduce((sum,candle)=>sum+candle.production.count,0),count);
    assert.equal(candles[0].production.close,(firstCount-1)/100);
  }
});

test('a single hourly observation is flat and out-of-range observations cannot affect it', () => {
  const slots=slotsForDay('2026-09-08');
  const row={start:slots[5].start,productionKwh:627.17,revenue:0};
  const candles=buildEnergyCandles([row,{...row,start:slots[6].start,productionKwh:10000}],'hour',rangeFor('2026-09-08','hour',row.start));
  assert.equal(candles.length,1);
  assert.deepEqual(candles[0].production,{open:.62717,high:.62717,low:.62717,close:.62717,count:1});
  assert.deepEqual(candles[0].revenue,{open:0,high:0,low:0,close:0,count:1});
});
