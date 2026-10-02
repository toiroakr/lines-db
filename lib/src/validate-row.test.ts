import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

const NAME_REQUIRED = `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) =>
  typeof data.name === 'string' ? { value: { ...data, age: data.age ?? 20 } } : { issues: [{ message: 'Name is required', path: [{ key: 'name' }] }] } } };
`;

describe('LinesDB.validateRow', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-validate-row-'));
    await writeFile(join(dataDir, 'people.schema.ts'), NAME_REQUIRED);
  });

  afterEach(async () => {
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('gives the row as the table schema validates it', async () => {
    await writeFile(join(dataDir, 'people.jsonl'), '{"id":1,"name":"Alice"}\n');
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());

    expect(unwrap(db.validateRow('people', { id: 2, name: 'Bob' }))).toEqual({ id: 2, name: 'Bob', age: 20 });
  });

  it('gives the issues of a row the schema refuses', async () => {
    await writeFile(join(dataDir, 'people.jsonl'), '{"id":1,"name":"Alice"}\n');
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());

    const result = db.validateRow('people', { id: 2 });

    expect(!result.ok && result.error.issues).toEqual([{ message: 'Name is required', path: [{ key: 'name' }] }]);
  });

  it('checks a row of a table left out on load, so a failing row can be fixed before it is written', async () => {
    await writeFile(join(dataDir, 'people.jsonl'), '{"id":1}\n');
    db = LinesDB.create<TableDefs>({ dataDir });
    expect(unwrap(await db.initialize()).errors).toHaveLength(1);

    expect(unwrap(db.validateRow('people', { id: 1, name: 'Alice' }))).toEqual({ id: 1, name: 'Alice', age: 20 });
  });

  it('fails for a table the database does not have', async () => {
    await writeFile(join(dataDir, 'people.jsonl'), '{"id":1,"name":"Alice"}\n');
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());

    expect(db.validateRow('peple', { id: 1 }).ok).toBe(false);
  });
});
