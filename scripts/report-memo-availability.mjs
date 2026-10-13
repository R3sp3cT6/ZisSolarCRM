import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync('docs/memo-availability-evaluation.json'));
const f = (n) => n == null ? '—' : n.toFixed(2);
const lines = ['# Negative MEMO price diagnostic', '', `Evaluated: ${data.evaluatedAt}.`, '',
  'No scored hour had a negative MEMO price. The policy changed zero predictions, so WAPE did not improve. No model was promoted and no inverter command was sent.', '',
  'The archive reconstruction assumes historical availability of weather and prices. The receipt-causal track uses genuine receipt cutoffs. The shutdown policy was only confirmed on 12 October; applying it historically is an assumption in both tracks.', ''];
for (const [name, track] of Object.entries(data.tracks)) {
  lines.push(`## ${name}`, '', '| Month | Hours | Actual MWh | Control WAPE | Reconstructed policy WAPE | Receipt policy WAPE |', '|---|---:|---:|---:|---:|---:|');
  for (const row of [...track.monthly, {month:'All', ...track}]) {
    const s = row.scores;
    lines.push(`| ${row.month} | ${s.control?.hours ?? 0} | ${f(s.control?.actualMwh)} | ${f(s.control?.wape)}% | ${f(s.policyReconstructed?.wape)}% | ${f(s.policyCausal?.wape)}% |`);
  }
  const s = track.matchedOctober;
  lines.push('', `Matched October: ${s.v32.hours} hours. v3.2 WAPE ${f(s.v32.wape)}%; CatBoost control ${f(s.control.wape)}%. Both are unchanged by the policy.`, '');
}
lines.push('All measured shutdown zeros and restarts remain in the original cohorts. Future negative prices can affect the separate saved candidate, but this test supplies no measured accuracy gain. Full hourly evidence and price coverage are in memo-availability-evaluation.json.', '');
fs.writeFileSync('docs/memo-availability-results.md', lines.join('\n'));
