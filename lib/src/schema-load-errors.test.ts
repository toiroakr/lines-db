import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import type { TableDefs } from './types.js';

describe('LinesDB.initialize with a schema file that cannot be loaded', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs> | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-schema-error-'));
    await writeFile(join(dataDir, 'broken.jsonl'), '{"id":1}\n');
  });

  afterEach(async () => {
    await db?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('fails, naming the file, instead of loading the table without validation', async () => {
    await writeFile(join(dataDir, 'broken.schema.ts'), 'export const schema = {;\n');
    db = LinesDB.create<TableDefs>({ dataDir });

    const result = await db.initialize();

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain('broken.schema.ts');
  });
});
