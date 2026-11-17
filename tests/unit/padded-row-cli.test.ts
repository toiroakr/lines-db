import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../lib/bin/cli.mjs', import.meta.url));

const NAME_REQUIRED_SCHEMA = `export const schema = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => (typeof value.name === 'string' ? { value } : { issues: [{ message: 'name is required', path: ['name'] }] }),
  },
  primaryKey: 'id',
};`;

describe('validate a table with a row padded with a character JSON does not allow as whitespace', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await realpath(await mkdtemp(join(tmpdir(), 'lines-db-padded-cli-')));
    await writeFile(join(dataDir, 'people.schema.ts'), NAME_REQUIRED_SCHEMA);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const validate = async () => {
    try {
      const { stdout, stderr } = await run(process.execPath, [cli, 'validate', dataDir]);
      return { code: 0, stdout, stderr };
    } catch (error) {
      const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
      return { code, stdout, stderr };
    }
  };

  it('prints the warning when the table is valid', async () => {
    await writeFile(join(dataDir, 'people.jsonl'), '{"id":"1","name":"a"}\n {"id":"2","name":"b"}\n');

    const result = await validate();

    expect(result.code).toBe(0);
    expect(result.stderr).toContain(`people.jsonl:2 has U+00A0 around its row, which JSON does not allow`);
  });

  it('prints the warning when the table is also invalid', async () => {
    await writeFile(join(dataDir, 'people.jsonl'), '{"id":"1"}\n {"id":"2","name":"b"}\n');

    const result = await validate();

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`people.jsonl:2 has U+00A0 around its row, which JSON does not allow`);
  });
});
