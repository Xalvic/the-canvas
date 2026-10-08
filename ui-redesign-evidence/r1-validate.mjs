// Runs inherited browser gates without overwriting their M11 screenshot evidence.
import { readFileSync, writeFileSync, unlinkSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = resolve(root, "ui-redesign-evidence");
const spec = resolve(root, "e2e/r1-disposable-layout.spec.ts");
const config = resolve(evidence, "r1-disposable.config.ts");
const output = resolve(evidence, "r1-test-results");
if (existsSync(spec) || existsSync(config)) throw new Error("Disposable R1 files already exist; inspect them first.");
try {
  writeFileSync(spec, readFileSync(resolve(root, "e2e/ux-layout.spec.ts"), "utf8")
    .replaceAll("workspace-ux-evidence/m11-", "ui-redesign-evidence/r1-"));
  writeFileSync(config, `import { defineConfig } from "@playwright/test";
import base from "../playwright.config";
export default defineConfig({ ...base, testDir: "../e2e", outputDir: "./r1-test-results",
  reporter: [["list"], ["json", { outputFile: "${resolve(evidence, "r1-browser-results.json").replaceAll("\\", "/")}" }]],
  projects: [
    { name: "layout", testMatch: "r1-disposable-layout.spec.ts" },
    { name: "preferences", testMatch: "responsive.spec.ts", grep: /mobile dock, settings tray|phone and tablet breakpoints|light is the default/ },
    { name: "semantics", testMatch: "ux-simplification.spec.ts", grep: /minimal guest UI|app menu keyboard navigation/ },
    { name: "primitives", testMatch: "ui-primitives.spec.ts" },
  ],
});`);
  const result = spawnSync(process.execPath, [resolve(root, "node_modules/@playwright/test/cli.js"), "test", "-c", config], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  // Only remove the task-owned output directory after a successful gate.
  if (result.status === 0 && dirname(output) === evidence && existsSync(output)) rmSync(output, { recursive: true });
} finally {
  if (existsSync(spec)) unlinkSync(spec);
  if (existsSync(config)) unlinkSync(config);
}
