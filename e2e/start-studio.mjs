import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
cpSync(new URL('fixtures/', import.meta.url), dataDir, { recursive: true });

const cli = new URL('../lib/bin/cli.mjs', import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), 'studio', dataDir, '--port', port];
await import(cli.href);
