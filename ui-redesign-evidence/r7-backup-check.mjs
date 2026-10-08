import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createDecipheriv, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only validation of this session's local backup; never restores a database.
const directory = fileURLToPath(new URL('../backups/r7-local-1791399833928/', import.meta.url));
const archive = readFileSync(join(directory, 'database.enc'));
const keyHex = readFileSync(join(directory, 'database.key'), 'utf8').trim();
assert.match(keyHex, /^[a-f0-9]{64}$/);
const header = Buffer.from('SCRIBBLE-R7-1');
assert.ok(archive.subarray(0, header.length).equals(header));
const nonce = archive.subarray(header.length, header.length + 12);
const payload = archive.subarray(header.length + 12);
const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), nonce);
decipher.setAuthTag(payload.subarray(0, 16));
const plaintext = Buffer.concat([decipher.update(payload.subarray(16)), decipher.final()]);
assert.equal(plaintext.subarray(0, 5).toString(), 'PGDMP');
const listing = execFileSync(join(process.env.LOCALAPPDATA, 'Programs/DockerDesktop/resources/bin/docker.exe'),
  ['exec', '-i', 'scribble-local-postgres-1', 'pg_restore', '--list'],
  { input: plaintext, windowsHide: true, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
const result = { authenticatedDecryption: true, postgresArchiveReadable: true, format: 'postgres-custom',
  bytes: plaintext.length, sha256: createHash('sha256').update(plaintext).digest('hex'),
  tagPosition: 'prefix', authenticatedHeader: false,
  tableEntries: listing.split('\n').filter((line) => / TABLE public /.test(line)).length,
  restorePerformed: false };
writeFileSync(new URL('./r7-backup-check.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
