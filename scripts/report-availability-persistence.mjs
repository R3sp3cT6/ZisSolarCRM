import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const result = read('docs/availability-persistence-evaluation.json'),
  verification = read('docs/availability-persistence-verification.json');
assert.equal(verification.status, 'passed');
assert.equal(
  createHash('sha256')
    .update(fs.readFileSync('docs/availability-persistence-evaluation.json'))
    .digest('hex'),
  verification.evaluationSha256,
);
const fmt = (n, d = 2) =>
  n == null
    ? '—'
    : n.toLocaleString('mk-MK', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
const lines = [
  '# Ден однапред: задржување на речиси нултиот одзив',
  '',
  '**Не се активира во CRM.** Фиксното правило да ја продолжи речиси нултата работа во следниот ден даде мало подобрување само во историската реконструкција. Не ја постигна целта под 5% месечен часовен WAPE. Официјален останува v3.2.',
  '',
  'Ова е една нова каузална претпоставка врз исти зачувани CatBoost-all предвидувања, без повторна обука или промена на временскиот модел. Потребни се два целосни претходни дена со сите дневни мерења ≤1% од AC капацитетот и најмалку три часа со однапред прогнозирано зрачење ≥300 W/m². Издавањето е до 18 UTC претходниот ден; тековниот календарски ден не се користи како целосен. Вистинските прекини/рестартирања остануваат во резултатите. Нултиот одзив не е доказ за команда за исклучување.',
  '',
  '[Фиксен протокол](availability-persistence-plan.md) · [Замрзнати влезови/код](availability-persistence-frozen.json) · [Независна проверка](availability-persistence-verification.json)',
  '',
];
for (const [mode, title] of [
  ['archiveReconstruction', 'Историска реконструкција'],
  ['receiptCausal', 'Со вистински времиња на пристигнување'],
]) {
  const t = result.tracks[mode];
  lines.push(
    '## ' + title,
    '',
    `Исти ${t.scores.control.hours} часа / ${t.scores.control.days} дена, реално ${fmt(t.scores.control.actualMwh, 3)} MWh. WAPE **${fmt(t.scores.control.wape)}% → ${fmt(t.scores.persistence.wape)}%**. Правилото се активира на ${t.triggered.length} датуми.`,
    '',
    '| Месец | Дена / часа | Реално MWh | Контрола WAPE | Ново правило WAPE |',
    '|---|---:|---:|---:|---:|',
  );
  for (const m of t.monthly)
    lines.push(
      `| ${m.month} | ${m.scores.control ? `${m.scores.control.days} / ${m.scores.control.hours}` : '—'} | ${fmt(m.scores.control?.actualMwh, 3)} | ${fmt(m.scores.control?.wape)}% | ${fmt(m.scores.persistence?.wape)}% |`,
    );
  lines.push(
    '',
    `На истите октомвриски часови: v3.2 **${fmt(t.v32MatchedOctober.v32.wape)}%**, CatBoost со/без правилото **${fmt(t.v32MatchedOctober.persistence.wape)}%**. Нема подобрување за октомври.`,
    '',
  );
}
lines.push(
  '## Што научивме',
  '',
  'Реконструкцијата има 25 активирања: 5–28 јули и 20 август. Апсолутната грешка се намалува за 2,431870 MWh вкупно, но не во сите активирани денови. На 20 август има реално 4,800930 MWh, а правилото предвидува нула; контролата веќе била близу нула. Ова покажува дека продолжувањето на стар прекин не може да предвиди ненадејно повторно вклучување. Не е оправдано тој ден да се отстрани од оценувањето.',
  '',
  'Во јули има само 0,798310 MWh на споредливите часови. WAPE останува 1.983,41% по правилото (претходно 2.288,17%), бидејќи заедничката временска/оперативна прогноза сè уште греши многу во однос на малиот реален збир. Процентот не се сокрива или ограничува на 100%; само приказната скала max(0,100−WAPE) има долна граница нула.',
  '',
  'Патеката со вистински receipts нема активирање. Историските јулски податоци биле увезени подоцна; не можеме да ги претставиме како навреме познати во јули. Резултатот останува 24,336398%.',
  '',
  'Независната Python проверка потврди 6.115 претходни мерења и 2.818 оценети предвидувања, непроменети таргети/контрола и сите месечни метрики. Три регресиски теста и насочениот lint поминаа. Ова не е независен идeн holdout и не оправдува нова верзија во продукција.',
  '',
  'Следниот независен кандидат останува однапред дефинираниот експеримент со новата GFS мрежа, директната/дифузната компонента и температурата. Неговото преземање продолжува во постојниот процес; ова правило не е додадено во неговите фиксни варијанти.',
);
fs.writeFileSync(
  'docs/availability-persistence-results.md',
  lines.join('\n') + '\n',
);
console.log('Report written; no promotion, target not reached.');
