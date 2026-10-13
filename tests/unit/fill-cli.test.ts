import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../lib/bin/cli.mjs', import.meta.url));

describe('fill multiple paths', () => {
  let root: string;
  let files: string[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lines-db-fill-cli-'));
    files = ['first', 'second'].map((dir) => join(root, dir, 'Widget.jsonl'));
    for (const dir of ['first', 'second']) await mkdir(join(root, dir));
    for (const file of files) await writeFile(file, '{"name":"widget"}\n');
    await writeFile(
      join(root, 'Widget.schema.ts'),
      `export const schema = {
        '~standard': { version: 1, vendor: 'test', validate: row => ({ value: { id: 'filled', ...row } }) }
      };`,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('fills directories and files with shared schemas and named fields', async () => {
    const { stdout } = await run(process.execPath, [
      cli,
      'fill',
      join(root, 'first'),
      files[1],
      '--schema-dir',
      root,
      '--fields',
      'id',
    ]);

    for (const file of files) {
      expect(stdout).toContain(file);
      expect(await readFile(file, 'utf-8')).toBe('{"id":"filled","name":"widget"}\n');
    }
  });

  it('leaves earlier directories unchanged when a later path is missing', async () => {
    await expect(
      run(process.execPath, [cli, 'fill', join(root, 'first'), join(root, 'missing'), '--schema-dir', root]),
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('ENOENT') });
    expect(await readFile(files[0], 'utf-8')).toBe('{"name":"widget"}\n');
  });
});
