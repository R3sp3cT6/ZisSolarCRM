import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = 'work/forecast-research/operational-training/';
const hash = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = (p) => JSON.parse(fs.readFileSync(p));
const previous = read('docs/full-history-verification.json');
assert.equal(previous.status, 'passed');
assert.equal(hash('work/forecast-research/full-history/inputs.json'), previous.inputSha256);
assert.equal(hash('work/forecast-research/full-history/runs.json'), previous.runsSha256);
assert.equal(hash('docs/full-history-evaluation.json'), previous.evaluationSha256);
const sources = [
  'work/forecast-research/full-history/inputs.json',
  'work/forecast-research/full-history/runs.json',
  'work/forecast-research/full-history/frozen-source.json',
  'docs/full-history-evaluation.json',
  'work/forecast-research/inverter-evidence/inputs.json',
];
const codePaths = [
  'scripts/evaluate-operational-training.py',
  'scripts/prepare-operational-training.mjs',
  'tests/operational-training.test.py',
  'docs/operational-training-plan.md',
];
const frozen = {
  frozenAt: new Date().toISOString(),
  sourceResearchIds: ['solar-full-history-v1-66acd8997e24f971babf', 'inverter-evidence-v1-60ce0c99f8c8a4f2e59c'],
  hashes: Object.fromEntries([...sources, ...codePaths].map((p) => [p, hash(p)])),
};
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(root + 'frozen-source.json', JSON.stringify(Object.fromEntries(codePaths.map((p) => [p, fs.readFileSync(p, 'utf8')]))));
fs.writeFileSync('docs/operational-training-frozen.json', JSON.stringify(frozen, null, 2) + '\n');
console.log(JSON.stringify(frozen));
