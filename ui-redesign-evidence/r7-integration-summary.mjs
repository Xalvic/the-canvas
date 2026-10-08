import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const files = ['r7-integration-results.json', 'r7-integration-recheck-results.json', 'r7-integration-final-results.json'];
const reports = files.map((file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')));
const specs = (suite) => [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specs)];
const full = specs(reports[0]);
const cases = new Map(full.map((spec) => [spec.id, { title: spec.title, file: spec.file, status: spec.tests[0].results.at(-1)?.status, source: files[0] }]));
for (let index = 1; index < reports.length; index++) {
  for (const spec of specs(reports[index])) {
    const result = spec.tests[0].results.at(-1);
    if (!result || result.status === 'skipped') continue;
    assert.ok(cases.has(spec.id), 'Recheck contains a case absent from the full run');
    assert.equal(cases.get(spec.id).title, spec.title);
    cases.set(spec.id, { title: spec.title, file: spec.file, status: result.status, source: files[index] });
  }
}
const failures = [...cases.values()].filter((item) => item.status !== 'passed');
const summary = { method: 'Full run plus focused recheck after fixture corrections; application unchanged between these runs',
  uniqueCases: cases.size, passed: cases.size - failures.length, failedOrUnrun: failures.length,
  runs: reports.map((report, index) => ({ file: files[index], ...report.stats, errors: report.errors ?? [] })),
  cases: [...cases.values()] };
writeFileSync(new URL('./r7-integration-summary.json', import.meta.url), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ uniqueCases: summary.uniqueCases, passed: summary.passed, failedOrUnrun: summary.failedOrUnrun }));
assert.equal(failures.length, 0, 'Required integration cases remain failed or unrun');
for (const report of reports) assert.equal(report.errors?.length ?? 0, 0, 'Non-test integration errors remain');
