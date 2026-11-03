import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

const GENERIC_SCHEMA = `export const schema = { primaryKey: 'id', '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };
`;

// A column of any JSON value: an object in the first row makes it a JSON column
const SEED = '{"id":"seed","data":{"k":1}}\n{"id":"blank","data":null}\n';

const VALUES: Array<[string, unknown]> = [
  ['a string that reads as a number', '123'],
  ['a string that reads as a boolean', 'true'],
  ['a string that reads as null', 'null'],
  ['a string that reads as an object', '{"a":1}'],
  ['a string that is not JSON', 'abc'],
  ['an empty string', ''],
  ['a number', 123],
  ['a boolean', true],
  ['false', false],
  ['an object', { a: 1 }],
  ['an array holding a string and a number', ['2', 3]],
  ['null', null],
];

describe('a JSON column', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs> | undefined;
  const notesPath = () => join(dataDir, 'notes.jsonl');

  const load = async (lines = SEED, schema = GENERIC_SCHEMA) => {
    await writeFile(notesPath(), lines);
    await writeFile(join(dataDir, 'notes.schema.ts'), schema);
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());
  };

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-json-column-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it.each(VALUES)('gives back %s as the value it was inserted with', async (_name, value) => {
    await load();

    unwrap(db!.insert('notes', { id: 'n', data: value }));

    expect(unwrap(db!.findOne('notes', { id: 'n' }))!.data).toStrictEqual(value);
  });

  it.each(VALUES)('writes %s to the file as the value it was inserted with', async (_name, value) => {
    await load();

    unwrap(await db!.transaction((tx) => void unwrap(tx.insert('notes', { id: 'n', data: value }))));

    const lines = (await readFile(notesPath(), 'utf-8')).trim().split('\n');
    expect(JSON.parse(lines[2])).toStrictEqual({ id: 'n', data: value });
  });

  it.each(VALUES)('gives back %s as the value a batch insert stored', async (_name, value) => {
    await load();

    unwrap(db!.batchInsert('notes', [{ id: 'n', data: value }]));

    expect(unwrap(db!.findOne('notes', { id: 'n' }))!.data).toStrictEqual(value);
  });

  it.each(VALUES)('gives back %s as the value an update stored', async (_name, value) => {
    await load();

    unwrap(db!.update('notes', { data: value }, { id: 'seed' }));

    expect(unwrap(db!.findOne('notes', { id: 'seed' }))!.data).toStrictEqual(value);
  });

  it('finds a row by the string its JSON column holds, apart from the number that reads alike', async () => {
    await load();
    unwrap(db!.insert('notes', { id: 'as-string', data: '123' }));
    unwrap(db!.insert('notes', { id: 'as-number', data: 123 }));

    expect(unwrap(db!.find('notes', { data: '123' })).map((row) => row.id)).toEqual(['as-string']);
    expect(unwrap(db!.find('notes', { data: 123 })).map((row) => row.id)).toEqual(['as-number']);
  });

  it('does not warn when it holds a string that is not JSON', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await load();

    unwrap(db!.insert('notes', { id: 'n', data: 'abc' }));
    unwrap(db!.findOne('notes', { id: 'n' }));

    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps a string as it was when only another field of its row is edited', async () => {
    await load(`${SEED.trim()}\n{"id":"n","data":{"k":2},"label":"x"}\n`);
    unwrap(await db!.transaction((tx) => void unwrap(tx.update('notes', { data: '123' }, { id: 'n' }))));

    unwrap(await db!.transaction((tx) => void unwrap(tx.update('notes', { label: 'y' }, { id: 'n' }))));

    const lines = (await readFile(notesPath(), 'utf-8')).trim().split('\n');
    expect(JSON.parse(lines[2])).toStrictEqual({ id: 'n', data: '123', label: 'y' });
  });

  it('gives back the string the schema fills in when a field is reset to its default', async () => {
    await load(
      SEED,
      `export const schema = { primaryKey: 'id', '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, data: data.data === undefined ? '123' : data.data } }) } };\n`,
    );

    unwrap(db!.update('notes', {}, { id: 'seed' }, { resetToDefault: ['data'] }));

    expect(unwrap(db!.findOne('notes', { id: 'seed' }))!.data).toBe('123');
  });
});
