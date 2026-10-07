import { cpSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = process.argv[2];
if (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error('Pass the port allocated by the e2e runner');
}

const output = fileURLToPath(new URL('.e2e/', import.meta.url));
mkdirSync(output, { recursive: true });
const dataDir = mkdtempSync(join(output, 'studio-data-'));
process.once('exit', () => rmSync(dataDir, { recursive: true, force: true }));
const schemaDir = join(dataDir, 'schemas');
mkdirSync(schemaDir);
cpSync(new URL('fixtures/', import.meta.url), dataDir, { recursive: true });
for (const file of readdirSync(dataDir)) {
  if (file.includes('.schema.')) renameSync(join(dataDir, file), join(schemaDir, file));
}

const localDir = join(dataDir, 'local');
mkdirSync(localDir);

const cli = new URL('../lib/bin/cli.mjs', import.meta.url);
process.argv = [
  process.execPath,
  fileURLToPath(cli),
  'studio',
  dataDir,
  '--data-dir',
  localDir,
  '--schema-dir',
  schemaDir,
  '--port',
  port,
];
await import(cli.href);
