// Redirect inherited screenshot paths so earlier evidence remains intact.
import { readFileSync, writeFileSync, unlinkSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = resolve(root, "ui-redesign-evidence");
const spec = resolve(root, "e2e/r3-disposable-layout.spec.ts");
const primitives = resolve(root, "e2e/r3-disposable-primitives.spec.ts");
const shell = resolve(root, "e2e/r3-disposable-shell.spec.ts");
const config = resolve(evidence, "r3-disposable.config.ts");
const output = resolve(evidence, "r3-test-results");
if ([spec, primitives, shell, config].some(existsSync)) throw new Error("Inspect existing disposable R3 files first.");
try {
  writeFileSync(spec, readFileSync(resolve(root, "e2e/ux-layout.spec.ts"), "utf8").replaceAll("workspace-ux-evidence/m11-", "ui-redesign-evidence/r3-"));
  writeFileSync(primitives, readFileSync(resolve(root, "e2e/ui-primitives.spec.ts"), "utf8").replaceAll("ui-redesign-evidence/r1-", "ui-redesign-evidence/r3-"));
  writeFileSync(shell, readFileSync(resolve(root, "e2e/workspace-shell.spec.ts"), "utf8").replaceAll("ui-redesign-evidence/r2-", "ui-redesign-evidence/r3-"));
  writeFileSync(config, `import { defineConfig } from "@playwright/test";
import base from "../playwright.config";
export default defineConfig({ ...base, testDir: "../e2e", outputDir: "./r3-test-results",
  use: { ...base.use, reducedMotion: "reduce" },
  reporter: [["list"], ["json", { outputFile: "${resolve(evidence, "r3-browser-results.json").replaceAll("\\", "/")}" }]],
  projects: [
    { name: "layout", testMatch: "r3-disposable-layout.spec.ts" },
    { name: "preferences", testMatch: "responsive.spec.ts" },
    { name: "semantics", testMatch: "ux-simplification.spec.ts", grep: /minimal guest UI|missing images and device failures/ },
    { name: "primitives", testMatch: "r3-disposable-primitives.spec.ts" },
    { name: "shell", testMatch: "r3-disposable-shell.spec.ts" },
    { name: "appearance", testMatch: "usability.spec.ts", grep: /one-shot Note|text inherits preferences|stroke appearance slider|mobile contextual panels/ },
    { name: "pen", testMatch: "pen-input.spec.ts", grep: /high-zoom selection|Escape and explicit tool change/ },
    { name: "editor", testMatch: "editor-controls.spec.ts" },
  ],
});`);
  const result = spawnSync(process.execPath, [resolve(root, "node_modules/@playwright/test/cli.js"), "test", "-c", config, ...process.argv.slice(2)], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (result.status === 0 && dirname(output) === evidence && existsSync(output)) rmSync(output, { recursive: true });
} finally {
  for (const path of [spec, primitives, shell, config]) if (existsSync(path)) unlinkSync(path);
}
