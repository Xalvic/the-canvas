import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = resolve(root, "ui-redesign-evidence/r3-inherited-work.json");
const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
const current = new Map(status.trimEnd().split("\n").map((line) => [line.slice(3).replace(/^"|"$/g, ""), line.slice(0, 2)]));
const hash = (path) => existsSync(resolve(root, path)) ? createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex") : undefined;
if (process.argv.includes("--capture")) {
  if (existsSync(baselinePath)) throw new Error("R3 baseline already exists.");
  const paths = new Set([...current.keys(), "docs/learning-checkpoint.md", "docs/learning-plan.md", "docs/learning-progress.md"]);
  const baseline = [...paths].filter((path) => !path.startsWith("ui-redesign-evidence/r3-")).map((path) => ({ path, status: current.get(path) ?? "  ", sha256: hash(path) }));
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`Captured ${baseline.length} inherited entries.`);
} else {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const allowed = new Set(["UI_REDESIGN_IMPLEMENTATION_PLAN.md", "docs/ui-redesign-r3.md", "src/styles.css", "src/editor-controls.css", "src/components/Toolbar/Toolbar.tsx", "src/components/ToolOptions/ToolOptions.tsx", "src/components/ZoomControls/ZoomControls.tsx", "src/canvas/viewport/CanvasViewport.tsx", "e2e/editor-controls.spec.ts"]);
  const protectedEntries = baseline.filter((file) => !allowed.has(file.path));
  const changed = protectedEntries.filter((file) => hash(file.path) !== file.sha256 || (current.get(file.path) ?? "  ") !== file.status).map((file) => file.path);
  const inherited = new Set(baseline.map((file) => file.path));
  const unexpected = [...current.keys()].filter((path) => !inherited.has(path) && !allowed.has(path) && !path.startsWith("ui-redesign-evidence/r3-"));
  const result = { inspected: protectedEntries.length, changedInheritedFiles: changed, unexpectedFiles: unexpected, oldPlanRemainsDeleted: !existsSync(resolve(root, "WORKSPACE_UX_IMPLEMENTATION_PLAN.md")) };
  writeFileSync(resolve(root, "ui-redesign-evidence/r3-preservation.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
  if (changed.length || unexpected.length || !result.oldPlanRemainsDeleted) process.exitCode = 1;
}
