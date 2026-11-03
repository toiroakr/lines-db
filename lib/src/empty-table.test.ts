import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { unwrap } from './result.js';
import type { TableDefs, TableSchema } from './types.js';

const PEOPLE_SCHEMA = `export const schema = { primaryKey: 'id', '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, id: data.id ?? 'generated-' + data.name } }) } };
`;

const PEOPLE_COLUMNS: TableSchema = {
  name: 'people',
  columns: [
    { name: 'id', type: 'TEXT', notNull: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'active', type: 'INTEGER', notNull: false, valueType: 'boolean' },
  ],
};

describe('a table whose JSONL file has no rows', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs> | undefined;
  const peoplePath = () => join(dataDir, 'people.jsonl');

  const load = async (config: { schemaOfEmptyTable?: () => TableSchema | undefined } = {}) => {
    await writeFile(peoplePath(), '');
    await writeFile(join(dataDir, 'people.schema.ts'), PEOPLE_SCHEMA);
    db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey', ...config });
    return unwrap(await db.initialize());
  };

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-empty-'));
  });

  afterEach(async () => {
    await db?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('is left out, as before, when nothing tells which columns it has', async () => {
    const result = await load();

    expect(db!.getTableNames()).not.toContain('people');
    expect(result.warnings).toContain("Table 'people' was not loaded (no data or skipped)");
  });

  it('is loaded as a table with no rows when the columns are given', async () => {
    const result = await load({ schemaOfEmptyTable: () => PEOPLE_COLUMNS });

    expect(db!.getTableNames()).toContain('people');
    expect(unwrap(db!.query('SELECT * FROM people'))).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('keeps the primary key the schema file names on the columns given', async () => {
    await load({ schemaOfEmptyTable: () => PEOPLE_COLUMNS });

    expect(db!.getSchema('people')!.columns.find((column) => column.primaryKey)?.name).toBe('id');
  });

  it('takes a first row and writes it to the file with the primary key the schema generated', async () => {
    await load({ schemaOfEmptyTable: () => PEOPLE_COLUMNS });

    unwrap(await db!.transaction((tx) => void unwrap(tx.insert('people', { name: 'Alice' }))));

    expect(await readFile(peoplePath(), 'utf-8')).toBe('{"id":"generated-Alice","name":"Alice"}\n');
  });

  it('gives back a boolean column as a boolean after its first row', async () => {
    await load({ schemaOfEmptyTable: () => PEOPLE_COLUMNS });

    unwrap(await db!.transaction((tx) => void unwrap(tx.insert('people', { name: 'Alice', active: true }))));

    expect(unwrap(db!.find('people'))[0]).toMatchObject({ name: 'Alice', active: true });
  });

  it('is not reported as having validation errors when a table refers to it', async () => {
    await load();
    await writeFile(join(dataDir, 'orders.jsonl'), '{"id":"o1","personId":"p1"}\n');
    await writeFile(
      join(dataDir, 'orders.schema.ts'),
      `export const schema = { foreignKeys: [{ column: 'personId', references: { table: 'people', column: 'id' } }],
  '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };\n`,
    );
    await db!.close();
    db = LinesDB.create<TableDefs>({ dataDir });

    const result = unwrap(await db.initialize());

    expect(result.warnings).toContain(
      "Skipping foreign key validation for table 'orders': referenced table 'people' has no rows to read its columns from",
    );
    expect(result.warnings.join('\n')).not.toContain('has validation errors');
  });

  it('takes a first row with a field the validator adds beyond the columns given', async () => {
    await writeFile(peoplePath(), '');
    await writeFile(
      join(dataDir, 'people.schema.ts'),
      `export const schema = { primaryKey: 'id', '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, id: data.id ?? 'generated-' + data.name, slug: data.name.toLowerCase() } }) } };\n`,
    );
    db = LinesDB.create<TableDefs>({
      dataDir,
      writeFilledValues: 'primaryKey',
      schemaOfEmptyTable: () => PEOPLE_COLUMNS,
    });
    unwrap(await db.initialize());

    unwrap(await db.transaction((tx) => void unwrap(tx.insert('people', { name: 'Alice' }))));

    expect(unwrap(db.find('people'))[0]).toMatchObject({ name: 'Alice', slug: 'alice' });
    expect(await readFile(peoplePath(), 'utf-8')).toBe('{"id":"generated-Alice","name":"Alice"}\n');
  });

  it('is left out, not failed on load, when the columns given are none', async () => {
    const result = await load({ schemaOfEmptyTable: () => ({ name: 'people', columns: [] }) });

    expect(db!.getTableNames()).not.toContain('people');
    expect(result.warnings).toContain("Table 'people' was not loaded (no data or skipped)");
  });

  describe('with a validator that adds a field the columns given lack', () => {
    const SLUG_SCHEMA = `export const schema = { primaryKey: 'id', '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, id: data.id ?? 'generated-' + data.name, slug: data.name.toLowerCase() } }) } };\n`;

    const loadWithSlug = async (tableName?: string) => {
      await writeFile(peoplePath(), '');
      await writeFile(join(dataDir, 'people.schema.ts'), SLUG_SCHEMA);
      await writeFile(join(dataDir, 'notes.jsonl'), '{"id":"n1"}\n');
      await writeFile(join(dataDir, 'notes.schema.ts'), PEOPLE_SCHEMA);
      db = LinesDB.create<TableDefs>({
        dataDir,
        writeFilledValues: 'primaryKey',
        schemaOfEmptyTable: ({ tableName }) => (tableName === 'people' ? PEOPLE_COLUMNS : undefined),
      });
      unwrap(await db.initialize(tableName ? { tableName } : undefined));
    };

    it('takes a batch of first rows', async () => {
      await loadWithSlug();

      unwrap(db!.batchInsert('people', [{ name: 'Alice' }, { name: 'Bob' }]));

      expect(unwrap(db!.find('people')).map((row) => row.slug)).toEqual(['alice', 'bob']);
    });

    it('still takes a first row after a transaction that added the column was rolled back', async () => {
      await loadWithSlug();

      const failed = await db!.transaction((tx) => {
        unwrap(tx.insert('people', { name: 'Alice' }));
        throw new Error('stop here');
      });
      expect(failed.ok).toBe(false);
      unwrap(db!.batchInsert('people', [{ name: 'Bob' }]));

      expect(unwrap(db!.find('people')).map((row) => row.slug)).toEqual(['bob']);
    });

    it('still takes a first row after another table alone was loaded again', async () => {
      await loadWithSlug('people');
      unwrap(await db!.initialize({ tableName: 'notes' }));

      unwrap(await db!.transaction((tx) => void unwrap(tx.insert('people', { name: 'Alice' }))));

      expect(unwrap(db!.find('people'))[0]).toMatchObject({ name: 'Alice', slug: 'alice' });
    });
  });
});
