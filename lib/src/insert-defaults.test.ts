import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

const AGE_DEFAULT_SCHEMA = `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, age: data.age === undefined ? 20 : data.age } }) } };
`;

describe('LinesDB insert with schema defaults', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-defaults-'));
    await writeFile(join(dataDir, 'people.jsonl'), '{"id":1,"name":"Alice","age":30}\n');
    await writeFile(join(dataDir, 'people.schema.ts'), AGE_DEFAULT_SCHEMA);
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());
  });

  afterEach(async () => {
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('stores the value the schema fills in for a field the inserted row omits', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.insert('people', { id: 2, name: 'Bob' }))));

    expect(unwrap(db.findOne('people', { id: 2 }))).toEqual({ id: 2, name: 'Bob', age: 20 });
  });

  it('stores the values the schema fills in for every row of a batch insert', async () => {
    unwrap(
      await db.transaction((tx) =>
        unwrap(
          tx.batchInsert('people', [
            { id: 2, name: 'Bob' },
            { id: 3, name: 'Carol', age: 40 },
          ]),
        ),
      ),
    );

    expect(unwrap(db.find('people')).map((row) => row.age)).toEqual([30, 20, 40]);
  });
});
