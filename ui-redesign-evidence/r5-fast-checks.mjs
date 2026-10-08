import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const outputFile = "ui-redesign-evidence/r5-fast-results.json";
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--reporter=json", `--outputFile=${outputFile}`], {
  encoding: "utf8", stdio: "pipe", windowsHide: true, env: { ...process.env, TEST_DATABASE_URL: "" },
});
const report = JSON.parse(readFileSync(outputFile, "utf8"));
const failures = report.testResults.flatMap((suite) => suite.assertionResults.filter((test) => test.status === "failed").map((test) => test.fullName));
console.log(JSON.stringify({ passed: report.numPassedTests, failed: report.numFailedTests, pending: report.numPendingTests, failures }));
if (result.status !== 0 || !report.success) process.exitCode = 1;
