import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  inverterSamples,
  inverterCondition,
  inverterInterruptions,
} from '../lib/inverter-availability.ts';
const root = 'work/forecast-research/huawei-five-minute/';
const dates = [
  '2026-07-15',
  '2026-09-11',
  '2026-09-12',
  '2026-10-10',
  '2026-10-11',
];
const hash = (x) => createHash('sha256').update(x).digest('hex');
const inputs = dates.map((date) =>
  JSON.parse(fs.readFileSync(root + date + '.json')),
);
const rows = [],
  days = [];
for (const input of inputs) {
  assert.equal(hash(JSON.stringify(input.values)), input.sha256);
  const samples = inverterSamples(
    input.values,
    input.devices,
    new Date(input.receivedAt),
  );
  assert.equal(
    samples.length,
    input.values.length,
    'Unexpected discarded actual device evidence',
  );
  // Verify values independently against source maps; no inferred zeros or status.
  const source = new Map(
    input.values.map((r) => [r.devId + ':' + r.collectTime, r]),
  );
  const states = {},
    conditions = {};
  for (const s of samples) {
    const original = source.get(s.deviceId + ':' + Date.parse(s.measuredAt));
    assert.equal(s.stateCode, original.dataItemMap.inverter_state);
    assert.equal(s.powerKw, original.dataItemMap.active_power);
    assert.equal(s.totalKwh, original.dataItemMap.total_cap);
    assert.equal(s.receivedAt, input.receivedAt);
    const condition = inverterCondition(s);
    conditions[condition] = (conditions[condition] ?? 0) + 1;
    const stat = (states[s.stateCode] ??= {
      samples: 0,
      zeroPowerSamples: 0,
      minPowerKw: Infinity,
      maxPowerKw: -Infinity,
    });
    stat.samples++;
    stat.zeroPowerSamples += +(s.powerKw === 0);
    stat.minPowerKw = Math.min(stat.minPowerKw, s.powerKw);
    stat.maxPowerKw = Math.max(stat.maxPowerKw, s.powerKw);
  }
  const events = ['reported-shutdown', 'power-limited'].flatMap((kind) =>
    inverterInterruptions(samples, kind),
  );
  for (const event of events) {
    const points = samples.filter(
      (s) =>
        s.deviceId === event.deviceId &&
        s.measuredAt >= event.firstObserved &&
        s.measuredAt <= event.lastObserved,
    );
    assert.equal(points.length, event.samples);
    assert.ok(points.every((s) => inverterCondition(s) === event.kind));
    assert.equal(
      Date.parse(event.lastObserved) - Date.parse(event.firstObserved),
      (event.samples - 1) * 300000,
    );
  }
  rows.push(...samples);
  days.push({
    date: input.date,
    receivedAt: input.receivedAt,
    sourceSha256: input.sha256,
    samples: samples.length,
    devices: input.devices.length,
    states,
    conditions,
    events: events.map(({ deviceId, ...e }) => ({
      ...e,
      inverter: input.devices.indexOf(deviceId) + 1,
    })),
  });
}
const unique = new Map();
for (const row of rows.sort((a, b) =>
  a.receivedAt.localeCompare(b.receivedAt),
)) {
  const key = row.deviceId + ':' + row.measuredAt;
  if (!unique.has(key)) unique.set(key, row);
}
const payload = {
  version: 'inverter-evidence-v1',
  auditedAt: new Date().toISOString(),
  samples: rows.length,
  uniqueSamples: unique.size,
  days,
  verification: 'passed',
  officialForecastChanged: false,
  limitations: [
    'Five-minute observation bounds are not exact second-level switching times.',
    'open_time/close_time may be null or refer to an older startup/shutdown.',
    'One July day does not establish the whole month.',
    'History retrieved today is not a historically available forecast input.',
    'Power-limited does not identify who set the limit or its purpose.',
  ],
};
fs.writeFileSync(
  'docs/inverter-evidence.json',
  JSON.stringify(payload, null, 2) + '\n',
);
fs.mkdirSync('work/forecast-research/inverter-evidence', { recursive: true });
fs.writeFileSync(
  'work/forecast-research/inverter-evidence/inputs.json',
  JSON.stringify({
    inputs,
    samples: [...unique.values()],
    code: fs.readFileSync('lib/inverter-availability.ts', 'utf8'),
  }),
);
const local = (t) =>
  t
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Skopje',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(t))
    : 'неутврдено';
const lines = [
  '# Проверка на прекините од Huawei инвертерите',
  '',
  `Проверени **${rows.length} поединечни записи**, ${unique.size} уникатни, од 8 инвертери. Времињата подолу се локални за Ресен.`,
  ``,
  `Ова е доказ од уредите, не нова оценка за точност на прогнозата. Официјалниот модел останува v3.2.`,
  ``,
  '| Датум | Статус | Инвертери | Записи | Минимална / максимална моќност по инвертер |',
  '|---|---|---:|---:|---:|',
];
for (const d of days)
  for (const code of ['768', '769', '513'])
    if (d.states[code]) {
      const s = d.states[code];
      lines.push(
        `| ${d.date} | ${code} · ${{ 768: 'исклучување по грешка', 769: 'исклучување по команда', 513: 'ограничена моќност' }[code]} | ${new Set(d.events.filter((e) => e.stateCodes.includes(Number(code))).map((e) => e.inverter)).size} | ${s.samples} | ${s.minPowerKw} / ${s.maxPowerKw} kW |`,
      );
    }
lines.push(
  '',
  '## Набљудувани исклучувања',
  '',
  '| Ден | Инвертер | Последно производство пред прекинот | Прв запис на исклучување | Последен запис на исклучување | Следно забележано производство |',
  '|---|---:|---|---|---|---|',
);
for (const d of days)
  for (const e of d.events.filter((e) => e.kind === 'reported-shutdown'))
    lines.push(
      `| ${d.date} | ${e.inverter} | ${local(e.startAfter)} | ${local(e.firstObserved)} | ${local(e.lastObserved)} | ${local(e.nextProductionObservedAt)}${e.nextProductionObservedAt && !e.resumedBy ? ' · празнина во мерењата' : ''} |`,
    );
lines.push(
  '',
  'Границите се од петминутни мерења. На пример, ако последното производство е во 07:15, а првиот статус на исклучување во 07:20, настанот е меѓу тие два момента. Недостасувачките записи не се пополнуваат и не ги спојуваат прекините.',
  '',
  'На 15 јули е потврден режим на ограничена моќност; само од овој режим не може да се утврди кој ја поставил командата. Тоа не е доказ за точните прекини во сите јулски денови. Во проверените 10 и 11 октомври нема статус на исклучување од разгледуваните кодови — ниското производство само по себе не се прогласува за дефект.',
  '',
  'Промената ја задржува поединечната моќност, статус, бројач, оригинални времиња на старт/стоп и вистинскиот час на прием. Се користат истите Huawei повици и постојното архивирање; нема дополнителен cron или постојано будење на SQL. Делумната покриеност по уреди е зачувана. Мерењата и приходите не се препишуваат.',
  '',
  'Следната обука може да ги издвојува часовите со доказ за техничко исклучување/ограничување само кога тој доказ е достапен пред обуката. Главната WAPE оценка и понатаму ги задржува прекините. Новите историски статуси се добиени сега и не се враќаат наназад како тогаш познати информации.',
  '',
  'Извори: [Huawei SmartPVMS NBI, 25.2.0 — официјален документ објавен во огледало](https://www.scribd.com/document/980589962/SmartPVMS-25-2-0-Northbound-API-Reference), [Huawei device interfaces](https://support.huawei.com/enterprise/mx/doc/EDOC1100306384/2630ae1b/device-data-interfaces), [RdTools: разграничување на прекин и комуникациски празнини](https://rdtools.readthedocs.io/en/stable/examples/system_availability_example.html).',
);
fs.writeFileSync('docs/inverter-evidence.md', lines.join('\n') + '\n');
console.log(
  JSON.stringify({
    samples: payload.samples,
    uniqueSamples: payload.uniqueSamples,
    days: days.map((d) => ({
      date: d.date,
      conditions: d.conditions,
      events: d.events.length,
    })),
    verification: payload.verification,
  }),
);
