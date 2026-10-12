import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = 'work/forecast-research/sflux/';
const read = (p) => JSON.parse(fs.readFileSync(p));
const hash = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const evaluation = read('docs/sflux-research-evaluation.json');
const verification = read('docs/sflux-research-verification.json');
const frozen = read('docs/sflux-research-frozen.json');
const inputs = read(root + 'inputs.json');
assert.equal(verification.status, 'passed');
assert.equal(verification.sourceDays, 192);
assert.equal(frozen.days, 192);
for (const [p, h] of Object.entries(verification.hashes)) assert.equal(hash(p), h);
const fmt = (x, digits = 2) => x === null || x === undefined ? '—' : x.toLocaleString('mk-MK', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const names = {
  coarseGhi: 'Постоечка мрежа · вкупно зрачење',
  nativeGhi: 'Нова мрежа · вкупно зрачење',
  nativePartitionTemperature: 'Нова мрежа · компоненти на зрачењето + температура',
};
const lines = [
  '# Споредба со дополнителни податоци за зрачење и температура', '',
  `Период на изворните податоци: **${evaluation.first}–${evaluation.last}**, 192 дена. Оценето на ${evaluation.evaluatedAt}.`, '',
  '**Ова е повторна историска пресметка. Не е независно докажана точност на идните прогнози. Официјалниот модел не е заменет автоматски.**', '',
  'Се споредуваат три однапред дефинирани временски влезови со истиот CatBoost модел, истите параметри, истите претходни часови за обука и истите реални часови за оценување. Новата мрежа е одделена од дополнителните променливи, за да се види кој дел придонесува за разликата. Прекините и валидните нули остануваат во оценката.', '',
  'WAPE е збирот на апсолутните часовни грешки поделен со збирот на реалното производство. Приказната скала е max(0, 100−WAPE); таа не е веројатност ниту гаранција. Месечен WAPE не е просек од дневните проценти.', '',
];
const targets = {};
for (const [mode, title] of [
  ['archiveReconstruction', 'Историска реконструкција со денешната архива'],
  ['receiptCausal', 'Повторна пресметка со реално време на пристигнување на мерењата'],
]) {
  const track = evaluation.tracks[mode];
  const base = track.scores.coarseGhi;
  lines.push(`## ${title}`, '',
    mode === 'archiveReconstruction'
      ? 'Оваа патека претпоставува дека претходните историски мерења биле достапни тогаш, иако дел се увезени подоцна. Целниот ден никогаш не влегува во обуката.'
      : 'Во обуката влегува само последната завршена ревизија што навистина пристигнала пред прогнозниот момент. Раните месеци без такви записи немаат оценка. Временскиот влез е оригиналната прогноза објавена пред тој момент.',
    '', `Оценети **${fmt(base.days, 0)} дена / ${fmt(base.hours, 0)} часа / ${fmt(base.actualMwh, 3)} MWh**. Пропуштените мерења не се претворени во нули.`, '',
    '| Варијанта | WAPE | Скала 100−WAPE | MAE kWh | RMSE kWh | Прогноза MWh | Потпишана разлика MWh |',
    '|---|---:|---:|---:|---:|---:|---:|');
  for (const method of evaluation.methods) {
    const s = track.scores[method];
    lines.push(`| ${names[method]} | ${fmt(s.wape)}% | ${fmt(s.displayAccuracy)}% | ${fmt(s.maeKwh)} | ${fmt(s.rmseKwh)} | ${fmt(s.predictedMwh, 3)} | ${fmt(s.biasMwh, 3)} |`);
  }
  lines.push('', '| Месец | Оценети дена / часа | Реално MWh | Постоечка мрежа WAPE | Нова мрежа WAPE | Компоненти + температура WAPE |',
    '|---|---:|---:|---:|---:|---:|');
  for (const m of track.monthly) {
    const coverage = m.scores.coarseGhi;
    const percent = (method) => m.scores[method]?.wape === null || m.scores[method]?.wape === undefined ? '—' : fmt(m.scores[method].wape) + '%';
    lines.push(`| ${m.month} | ${coverage ? `${coverage.days} / ${coverage.hours}` : '—'} | ${fmt(coverage?.actualMwh, 3)} | ${percent('coarseGhi')} | ${percent('nativeGhi')} | ${percent('nativePartitionTemperature')} |`);
  }
  lines.push('', 'Оценетите часови се исти кај сите три варијанти. Месеците со непотполни мерења или почетно загревање на моделот не претставуваат целосно измерен месец. WAPE над 100% останува видлив; малиот реален збир за време на долги прекини може да произведе многу голем релативен процент.', '',
    '### Споредба со зачуваната v3.2 пресметка за октомври', '',
    '| Варијанта | Исти часови | Реално MWh | WAPE | Скала 100−WAPE |', '|---|---:|---:|---:|---:|');
  for (const method of ['v32', ...evaluation.methods]) {
    const s = track.v32MatchedOctober[method];
    lines.push(`| ${method === 'v32' ? 'Зачувана v3.2 реконструкција' : names[method]} | ${s?.hours ?? '—'} | ${fmt(s?.actualMwh, 3)} | ${s?.wape === null || !s ? '—' : fmt(s.wape) + '%'} | ${s?.displayAccuracy === null || !s ? '—' : fmt(s.displayAccuracy) + '%'} |`);
  }
  targets[mode] = {};
  for (const method of evaluation.methods) {
    const scored = track.monthly.filter((m) => Number.isFinite(m.scores[method]?.wape));
    targets[mode][method] = {
      evaluatedMonths: scored.map((m) => m.month),
      belowFivePercent: scored.filter((m) => m.scores[method].wape < 5).map((m) => m.month),
      atOrAboveFivePercent: scored.filter((m) => m.scores[method].wape >= 5).map((m) => m.month),
      unavailableMonths: track.monthly.filter((m) => !Number.isFinite(m.scores[method]?.wape)).map((m) => m.month),
    };
  }
}
const radiationPoint = inputs.sources[0].fields.find((f) => f.variable === 'DSWRF');
const thermalPoint = inputs.sources[0].fields.find((f) => f.variable === 'TMP');
lines.push('', '## Проверка и ограничувања', '',
  `Проверени ${fmt(verification.featuresChecked, 0)} часовни влезови, ${fmt(verification.trainingChecks, 0)} членства во обуката и ${fmt(verification.predictionsChecked, 0)} предвидувања. Независно повторно се пресметани сите месечни метрики, а контролниот модел ја репродуцира претходно зачуваната пресметка. Изворните GRIB податоци се валидирани при преземање; независното повторно декодирање на raw бинарни полиња е направено за пробниот ден 15 јуни. Тоа не се претставува како второ декодирање на секое поле од целата архива.`, '',
  `Точката за зрачење е ${radiationPoint.latitude.toFixed(6)} N / ${radiationPoint.longitude.toFixed(6)} E, оддалечена ${fmt(radiationPoint.distanceKm)} km од централата. Температурата е од посебната 0,25° мрежа, на ${fmt(thermalPoint.distanceKm)} km. Растојанието до точката не е просторна резолуција или точност на сенката врз панелите.`, '',
  `Кодот и податоците се замрзнати пред оценувањето: ${frozen.frozenAt}. Зачувани се ${fmt(frozen.fields, 0)} изворни полиња и ${fmt(frozen.roundingAdjustments, 0)} мали корекции од нумеричка квантизација. Толеранцијата 0,5 W/m² е фиксирана пред тестот; поголема неконзистентност ја прекинува подготовката.`, '',
  'Радијациските компоненти се добиени од оригинални часовни прогнозни записи, со проверени граници на преклопените просеци. Директната компонента е хоризонтална, не DNI. Температурата е интерполација меѓу две соседни изворни часовни прогнозни точки. Нема тричасовно измислување на часовно зрачење и нема набљудувано целно време употребено како прогноза.', '',
  'Не се претпоставени непознати DC kWp, наклон или азимут. Ова е научен одзив на централата од податоци, а не физички модел со потврдена геометрија на панелите. Идно непланирано исклучување не се внесува ретроактивно во прогнозата.', '',
  'Датумите биле разгледувани во претходни експерименти. Дури и ако некој ретроспективен резултат падне под 5%, потребен е независен тест со однапред зачувани прогнози пред да се тврди постигната идна точност од 95%. Овој извештај не го промовира моделот и не ја означува целта како завршена.', '',
  '[Фиксиран протокол](sflux-research-plan.md) · [Целосни нумерички резултати](sflux-research-evaluation.json) · [Независна проверка](sflux-research-verification.json)', '',
);
fs.writeFileSync('docs/sflux-research-results.md', lines.join('\n'));
fs.writeFileSync('docs/sflux-research-target-audit.json', JSON.stringify({
  version: evaluation.version, createdAt: new Date().toISOString(), targets,
  prospectivelyValidated: false, goalComplete: false, promotion: false,
  reason: 'Retrospective monthly diagnostics do not by themselves prove the requested future accuracy.',
}, null, 2) + '\n');
console.log(JSON.stringify({ report: 'docs/sflux-research-results.md', prospectivelyValidated: false, promotion: false }));
