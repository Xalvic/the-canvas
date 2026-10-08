import { readFileSync, writeFileSync, unlinkSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = resolve(root, "ui-redesign-evidence");
const copies = [
  ["ux-layout", "workspace-ux-evidence/m11-", "ui-redesign-evidence/r5-layout-"],
  ["workspace-shell", "ui-redesign-evidence/r2-", "ui-redesign-evidence/r5-shell-"],
  ["editor-controls", "ui-redesign-evidence/r3-", "ui-redesign-evidence/r5-editor-"],
].map(([name, before, after]) => ({ path: resolve(root, `e2e/r5-disposable-${name}.spec.ts`), source: resolve(root, `e2e/${name}.spec.ts`), before, after }));
const config = resolve(evidence, "r5-disposable.config.ts");
if ([config, ...copies.map((copy) => copy.path)].some(existsSync)) throw new Error("Inspect existing disposable R5 fixtures first");
try {
  for (const copy of copies) writeFileSync(copy.path, readFileSync(copy.source, "utf8").replaceAll(copy.before, copy.after));
  writeFileSync(config, `import { defineConfig } from "@playwright/test";
import base from "../playwright.config";
export default defineConfig({ ...base, testDir: "../e2e", testMatch: "r5-disposable-*.spec.ts", outputDir: "./r5-regression-results",
  grepInvert: /drawer and sharing stay inside/,
  webServer: { ...base.webServer, cwd: ${JSON.stringify(root)} },
  reporter: [["list"], ["json", { outputFile: "${resolve(evidence, "r5-regression-browser-results.json").replaceAll("\\", "/")}" }]],
});`);
  const result = spawnSync(process.execPath, [resolve(root, "node_modules/@playwright/test/cli.js"), "test", "-c", config, ...process.argv.slice(2)], { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  const output = resolve(evidence, "r5-regression-results");
  if (result.status === 0 && dirname(output) === evidence && existsSync(output)) rmSync(output, { recursive: true });
} finally { for (const path of [config, ...copies.map((copy) => copy.path)]) if (existsSync(path)) unlinkSync(path); }
