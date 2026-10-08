import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gate = process.argv[2];
if (!['standard', 'integration'].includes(gate)) throw new Error('Use standard or integration');
const directory = resolve(root, gate === 'standard' ? 'e2e' : 'e2e-integration');
const copies = readdirSync(directory).filter((name) => name.endsWith('.spec.ts') && !name.startsWith('r7-disposable-') && name !== 'pen-production.spec.ts')
  .map((name) => ({ source: resolve(directory, name), copy: resolve(directory, `r7-disposable-${name}`) }));
if (copies.some(({ copy }) => existsSync(copy))) throw new Error('Inspect leftover R7 disposable specs first');
try {
  for (const { source, copy } of copies) {
    const content = readFileSync(source, 'utf8')
      .replaceAll('workspace-ux-evidence/m11-', `ui-redesign-evidence/r7-${gate}-`)
      .replace(/ui-redesign-evidence\/(r[0-6])-/g, 'ui-redesign-evidence/r7-$1-')
      .replaceAll('test-results/', 'test-results/r7-');
    writeFileSync(copy, content, { flag: 'wx' });
  }
  const result = spawnSync(process.execPath, [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test', '-c', `ui-redesign-evidence/r7-${gate}.config.ts`, ...process.argv.slice(3)], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, SCRIBBLE_UX_BASELINE: '', SCRIBBLE_WORKSPACE_BASELINE: '' },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { for (const { copy } of copies) if (existsSync(copy)) unlinkSync(copy); }
