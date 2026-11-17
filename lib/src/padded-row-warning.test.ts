import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

const PEOPLE_SCHEMA = `export const schema = { primaryKey: 'id', '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };
`;

describe('a JSONL row with a character around it that JSON does not allow as whitespace', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs> | undefined;

  const load = async (content: string) => {
    await writeFile(join(dataDir, 'people.jsonl'), content);
    await writeFile(join(dataDir, 'people.schema.ts'), PEOPLE_SCHEMA);
    db = LinesDB.create<TableDefs>({ dataDir });
    return unwrap(await db.initialize());
  };

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-padded-'));
  });

  afterEach(async () => {
    await db?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('is loaded, and the validation result warns with the table, file, and line', async () => {
    const result = await load('{"id":"1"}\n {"id":"2"}\n');

    expect(result.valid).toBe(true);
    expect(unwrap(db!.query('SELECT id FROM people ORDER BY id'))).toEqual([{ id: '1' }, { id: '2' }]);
    expect(result.warnings).toEqual([
      `Table 'people': ${join(dataDir, 'people.jsonl')}:2 has U+00A0 around its row, which JSON does not allow`,
    ]);
    expect(result.tableResults.find((table) => table.tableName === 'people')?.warnings).toEqual(result.warnings);
  });

  it('loads a file with so many padded rows that its warnings cannot be spread into one call', async () => {
    const rows = Array.from({ length: 300_000 }, (_, index) => `\u00a0{"id":"${index}"}`);

    const result = await load(`${rows.join('\n')}\n`);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(300_000);
  }, 120_000);

  it('gives no warning for a file whose rows have none', async () => {
    const result = await load('{"id":"1"}\n  {"id":"2"}\t\n');

    expect(result.warnings).toEqual([]);
  });
});
