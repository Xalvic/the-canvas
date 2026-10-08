import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(readFileSync(resolve(root, "ui-redesign-evidence/r2-inherited-work.json"), "utf8"));
const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
const current = new Map(status.trimEnd().split("\n").map((line) => [line.slice(3).replace(/^"|"$/g, ""), line.slice(0, 2)]));
const allowed = new Set([
  "UI_REDESIGN_IMPLEMENTATION_PLAN.md", "docs/ui-redesign-r2.md", "src/styles.css", "src/workspace-shell.css",
  "src/ui-primitives.css", "src/components/Menu.tsx", "src/components/Dialog.tsx", "src/components/AppMenu.tsx",
  "src/components/BoardIdentity/BoardIdentity.tsx", "src/components/Account/Account.tsx", "src/components/CollaborationPresence.tsx",
  "src/components/ServerBoards/ServerBoards.tsx", "src/components/ServerBoards/PageSidebar.tsx", "src/canvas/viewport/CanvasViewport.tsx",
  "e2e/ux-layout.spec.ts", "e2e/workspace-shell.spec.ts",
]);
const changes = baseline.filter((file) => !allowed.has(file.path)).flatMap((file) => {
  const path = resolve(root, file.path);
  const hash = existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : undefined;
  return hash !== file.sha256 || (current.get(file.path) ?? "  ") !== file.status ? [file.path] : [];
});
const inherited = new Set(baseline.map((file) => file.path));
const unexpected = [...current.keys()].filter((path) => !inherited.has(path) && !allowed.has(path) && !path.startsWith("ui-redesign-evidence/r2-"));
const result = { inspected: baseline.filter((file) => !allowed.has(file.path)).length, authorizedPlanUpdateExcluded: true, changedInheritedFiles: changes, unexpectedFiles: unexpected, oldPlanRemainsDeleted: !existsSync(resolve(root, "WORKSPACE_UX_IMPLEMENTATION_PLAN.md")) };
writeFileSync(resolve(root, "ui-redesign-evidence/r2-preservation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
if (changes.length || unexpected.length || !result.oldPlanRemainsDeleted) process.exitCode = 1;
