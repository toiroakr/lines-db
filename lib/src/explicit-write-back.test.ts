import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

// `id` and `age` default; `id` is the primary key
const DEFAULTS_SCHEMA = `export const schema = { primaryKey: 'id', '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, id: data.id ?? 'generated-' + data.name, age: data.age ?? 20 } }) } };
`;

describe("LinesDB write-back with writeFilledValues: 'primaryKey'", () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;
  const peoplePath = () => join(dataDir, 'people.jsonl');

  const load = async (lines: string, schema = DEFAULTS_SCHEMA, table = 'people') => {
    await writeFile(join(dataDir, `${table}.jsonl`), lines);
    await writeFile(join(dataDir, `${table}.schema.ts`), schema);
    db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
    unwrap(await db.initialize());
  };
  const write = async (fn: (tx: LinesDB<TableDefs>) => unknown) => unwrap(await db.transaction((tx) => void fn(tx)));

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-explicit-'));
  });

  afterEach(async () => {
    await db?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('leaves a field its line omitted out of the line when another field of the row is edited', async () => {
    await load('{"id":"a","name":"Alice"}\n');

    await write((tx) => unwrap(tx.update('people', { name: 'Alicia' }, { id: 'a' })));

    expect(await readFile(peoplePath(), 'utf-8')).toBe('{"id":"a","name":"Alicia"}\n');
  });

  it('keeps the lines of the rows that were not edited as they were', async () => {
    await load('{"id":"a","name":"Alice"}\n{"id":"b","name":"Bob","age":40}\n');

    await write((tx) => unwrap(tx.update('people', { name: 'Bobby' }, { id: 'b' })));

    expect(await readFile(peoplePath(), 'utf-8')).toBe(
      '{"id":"a","name":"Alice"}\n{"id":"b","name":"Bobby","age":40}\n',
    );
  });

  it('writes an inserted row with the fields it was given, not with the values the schema fills in', async () => {
    await load('{"id":"a","name":"Alice"}\n');

    await write((tx) => unwrap(tx.insert('people', { id: 'c', name: 'Carol' })));

    expect(await readFile(peoplePath(), 'utf-8')).toBe('{"id":"a","name":"Alice"}\n{"id":"c","name":"Carol"}\n');
  });

  it('writes the primary key of an inserted row even when the schema filled it in, so the row keeps it', async () => {
    await load('{"id":"a","name":"Alice"}\n');

    await write((tx) => unwrap(tx.insert('people', { name: 'Carol' })));

    expect(await readFile(peoplePath(), 'utf-8')).toBe(
      '{"id":"a","name":"Alice"}\n{"id":"generated-Carol","name":"Carol"}\n',
    );
  });

  it('writes a field its line omitted once it is set to a value other than the one the schema filled in', async () => {
    await load('{"id":"a","name":"Alice"}\n');

    await write((tx) => unwrap(tx.update('people', { age: 31 }, { id: 'a' })));

    expect(await readFile(peoplePath(), 'utf-8')).toBe('{"id":"a","name":"Alice","age":31}\n');
  });

  it('leaves a field out of the line when it is set to exactly the value the schema fills in, as nothing changed', async () => {
    await load('{"id":"a","name":"Alice"}\n');

    await write((tx) => unwrap(tx.update('people', { age: 20, name: 'Alicia' }, { id: 'a' })));

    expect(await readFile(peoplePath(), 'utf-8')).toBe('{"id":"a","name":"Alicia"}\n');
  });

  it('removes a field from the line when it is reset to its default, and holds the value the schema fills in', async () => {
    await load('{"id":"a","name":"Alice","age":31}\n');

    await write((tx) => unwrap(tx.update('people', {}, { id: 'a' }, { resetToDefault: ['age'] })));

    expect(await readFile(peoplePath(), 'utf-8')).toBe('{"id":"a","name":"Alice"}\n');
    expect(unwrap(db.findOne('people', { id: 'a' }))).toMatchObject({ age: 20 });
  });

  it('does not pass the changes of a batch-deleted row on to a row inserted later in its rowid', async () => {
    await load('{"id":"a","name":"Alice"}\n');

    await write((tx) => {
      unwrap(tx.update('people', { age: 31 }, { id: 'a' }));
      unwrap(tx.batchDelete('people', [{ id: 'a' }]));
      unwrap(tx.insert('people', { id: 'b', name: 'Bob' }));
    });

    expect(await readFile(peoplePath(), 'utf-8')).toBe('{"id":"b","name":"Bob"}\n');
  });

  it('reports a filled field named after an Object member as filled by the schema', async () => {
    const memberSchema = `export const schema = { primaryKey: 'id', '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, toString: Object.hasOwn(data, 'toString') ? data.toString : 'default' } }) } };
`;
    await load('{"id":"a"}\n', memberSchema, 'members');

    expect(unwrap(await db.findWithDefaults('members'))).toEqual([
      { row: { id: 'a', toString: 'default' }, defaulted: ['toString'] },
    ]);
  });

  it('keeps every field of a row whose primary key was changed, as its line can no longer be matched by key', async () => {
    await load('{"id":"a","name":"Alice","nickname":"Ali"}\n');

    await write((tx) => unwrap(tx.update('people', { id: 'z' }, { id: 'a' })));

    expect(JSON.parse(await readFile(peoplePath(), 'utf-8'))).toMatchObject({
      id: 'z',
      name: 'Alice',
      nickname: 'Ali',
    });
  });

  it('reports the fields of each row that the schema filled in rather than the file', async () => {
    await load('{"id":"a","name":"Alice"}\n{"id":"b","name":"Bob","age":40}\n');

    expect(unwrap(await db.findWithDefaults('people'))).toEqual([
      { row: { id: 'a', name: 'Alice', age: 20 }, defaulted: ['age'] },
      { row: { id: 'b', name: 'Bob', age: 40 }, defaulted: [] },
    ]);
  });

  it('writes every field of the rows of a schema whose backward transform renames fields, as the line keys no longer match', async () => {
    const renaming = `export const schema = { backward: (row) => ({ id: row.id, full_name: row.fullName }), '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { id: data.id, fullName: data.full_name ?? data.fullName } }) } };
`;
    await load('{"id":1,"full_name":"Alice"}\n', renaming, 'renamed');

    await write((tx) => unwrap(tx.update('renamed', { fullName: 'Alicia' }, { id: 1 })));

    expect(await readFile(join(dataDir, 'renamed.jsonl'), 'utf-8')).toBe('{"id":1,"full_name":"Alicia"}\n');
  });

  it('writes the fields a migration transform set while loading', async () => {
    await writeFile(peoplePath(), '{"id":"a","name":"Alice"}\n');
    await writeFile(join(dataDir, 'people.schema.ts'), DEFAULTS_SCHEMA);
    db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
    unwrap(await db.initialize({ tableName: 'people', transform: (row) => ({ ...row, nickname: 'Ali' }) }));

    unwrap(await db.sync('people'));

    expect(await readFile(peoplePath(), 'utf-8')).toBe('{"id":"a","name":"Alice","nickname":"Ali"}\n');
  });
});

describe('LinesDB writeFilledValues', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;
  const peoplePath = () => join(dataDir, 'people.jsonl');

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-filled-'));
    await writeFile(peoplePath(), '{"id":"a","name":"Alice"}\n');
    await writeFile(join(dataDir, 'people.schema.ts'), DEFAULTS_SCHEMA);
  });

  afterEach(async () => {
    await db?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('writes every value the schema filled in when it is not set, as a write-back always has', async () => {
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());

    unwrap(await db.sync('people'));

    expect(await readFile(peoplePath(), 'utf-8')).toBe('{"id":"a","name":"Alice","age":20}\n');
  });

  it('lets a sync choose for itself over the database config', async () => {
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());

    unwrap(await db.sync('people', { writeFilledValues: 'primaryKey' }));

    expect(await readFile(peoplePath(), 'utf-8')).toBe('{"id":"a","name":"Alice"}\n');
  });
});
