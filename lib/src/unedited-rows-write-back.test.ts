import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

const FULL_FILLED_SCHEMA = `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, full: data.a + '-' + data.b } }) } };
`;

describe('LinesDB write-back of the rows an edit did not touch', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;
  const file = () => join(dataDir, 'items.jsonl');
  const lines = [
    '{"id":1,"a":"x","b":"y","full":"x-y"}',
    '{"id":2,"a":"p","b":"q","full":"p-q"}',
    '{"id":3,"a":"m","b":"n","full":"edited by hand"}',
  ];

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-unedited-'));
    await writeFile(file(), `${lines.join('\n')}\n`);
    await writeFile(join(dataDir, 'items.schema.ts'), FULL_FILLED_SCHEMA);
    db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
    unwrap(await db.initialize());
  });

  afterEach(async () => {
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('leaves the line of a row as the file holds it, though the schema computes another value for a field of it', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.update('items', { a: 'z' }, { id: 1 }))));

    expect(await readFile(file(), 'utf-8')).toBe(`{"id":1,"a":"z","b":"y","full":"x-y"}\n${lines[1]}\n${lines[2]}\n`);
  });
});
