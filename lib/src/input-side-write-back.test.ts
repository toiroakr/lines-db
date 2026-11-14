import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

// A create hook: the schema turns the typed code "1" into "ORD-1", as a TailorDB `create` hook does
const PREFIX_SCHEMA = `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, code: 'ORD-' + data.code } }) } };
`;

describe('LinesDB write-back with a schema that transforms a value the user set', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;
  const read = () => readFile(join(dataDir, 'orders.jsonl'), 'utf-8');

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-input-side-'));
    await writeFile(join(dataDir, 'orders.jsonl'), '{"id":1,"code":"a"}\n{"id":2,"code":"b"}\n');
    await writeFile(join(dataDir, 'orders.schema.ts'), PREFIX_SCHEMA);
    db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
    unwrap(await db.initialize());
  });

  afterEach(async () => {
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('writes the value an insert was given, not the value the schema transforms it to', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.insert('orders', { id: 3, code: '1' }))));

    expect(await read()).toContain('{"id":3,"code":"1"}');
  });

  it('writes the value an update set, not the value the schema transforms it to', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.update('orders', { code: '1' }, { id: 1 }))));

    expect(await read()).toBe('{"id":1,"code":"1"}\n{"id":2,"code":"b"}\n');
  });

  it('keeps the value of a line nothing wrote to while another row is edited', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.update('orders', { code: '1' }, { id: 1 }))));

    expect(await read()).toContain('{"id":2,"code":"b"}');
  });

  it('reads back as the transformed value after the write', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.insert('orders', { id: 3, code: '1' }))));
    await db.close();
    db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
    unwrap(await db.initialize());

    expect(unwrap(db.findOne('orders', { id: 3 }))).toEqual({ id: 3, code: 'ORD-1' });
  });

  it('writes the value each record of a batch insert was given', async () => {
    unwrap(
      await db.transaction((tx) =>
        unwrap(
          tx.batchInsert('orders', [
            { id: 3, code: '1' },
            { id: 4, code: '2' },
          ]),
        ),
      ),
    );

    expect(await read()).toContain('{"id":3,"code":"1"}\n{"id":4,"code":"2"}');
  });

  it('writes the value of a later update, not the one the insert was given', async () => {
    unwrap(
      await db.transaction((tx) => {
        unwrap(tx.insert('orders', { id: 3, code: '1' }));
        unwrap(tx.update('orders', { code: '2' }, { id: 3 }));
      }),
    );

    expect(await read()).toContain('{"id":3,"code":"2"}');
  });
});

describe('LinesDB.findWithDefaults input side', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-input-rows-'));
    await writeFile(join(dataDir, 'orders.jsonl'), '{"id":1,"code":"a"}\n');
    await writeFile(join(dataDir, 'orders.schema.ts'), PREFIX_SCHEMA);
    db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
    unwrap(await db.initialize());
  });

  afterEach(async () => {
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('gives the value a line holds beside the value the schema makes of it', async () => {
    const [{ row, input }] = unwrap(await db.findWithDefaults('orders'));

    expect({ row, input }).toEqual({ row: { id: 1, code: 'ORD-a' }, input: { id: 1, code: 'a' } });
  });

  it('gives the value an insert was given for the row it added', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.insert('orders', { id: 2, code: '1' }))));

    const inserted = unwrap(await db.findWithDefaults('orders')).find(({ row }) => row.id === 2);

    expect(inserted?.input).toEqual({ id: 2, code: '1' });
  });
});
