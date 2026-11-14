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

  it('keeps the value of a line when another field of the same row is updated', async () => {
    await writeFile(join(dataDir, 'orders.jsonl'), '{"id":1,"code":"a","note":"n"}\n');
    await db.close();
    db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
    unwrap(await db.initialize());

    unwrap(await db.transaction((tx) => unwrap(tx.update('orders', { note: 'm' }, { id: 1 }))));

    expect(await read()).toBe('{"id":1,"code":"a","note":"m"}\n');
  });

  it('inserts a row whose value is a bigint', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.insert('orders', { id: 5n as unknown as number, code: '1' }))));

    expect(await read()).toContain('"code":"1"');
  });

  it('inserts a row whose transformed field is a bigint, which a file cannot hold', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.insert('orders', { id: 3, code: 1n as unknown as string }))));

    expect(await read()).toContain('{"id":3,"code":"ORD-1"}');
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

describe('LinesDB write-back with writeBackFields and a transforming schema', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-input-named-'));
    await writeFile(join(dataDir, 'orders.jsonl'), '{"id":1,"code":"a"}\n');
    await writeFile(join(dataDir, 'orders.schema.ts'), PREFIX_SCHEMA);
    db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey', writeBackFields: ['code'] });
    unwrap(await db.initialize());
  });

  afterEach(async () => {
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('writes a field named in writeBackFields from the database, as it is for every other write', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.insert('orders', { id: 2, code: '1' }))));

    expect(await readFile(join(dataDir, 'orders.jsonl'), 'utf-8')).toContain('{"id":2,"code":"ORD-1"}');
  });

  it('still reports the value a line holds as the input side of a named field', async () => {
    const [{ input }] = unwrap(await db.findWithDefaults('orders'));

    expect(input).toEqual({ id: 1, code: 'a' });
  });
});

describe('LinesDB write-back of an object the caller changes afterwards', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-input-object-'));
    await writeFile(join(dataDir, 'orders.jsonl'), '{"id":1,"meta":{"code":"a"}}\n');
    await writeFile(
      join(dataDir, 'orders.schema.ts'),
      `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, meta: { code: 'ORD-' + data.meta.code } } }) } };
`,
    );
    db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
    unwrap(await db.initialize());
  });

  afterEach(async () => {
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('writes the object as it was when inserted, not as the caller changed it before the write', async () => {
    const meta = { code: 'a' };

    unwrap(
      await db.transaction((tx) => {
        unwrap(tx.insert('orders', { id: 2, meta }));
        meta.code = 'b';
      }),
    );

    expect(await readFile(join(dataDir, 'orders.jsonl'), 'utf-8')).toContain('{"id":2,"meta":{"code":"a"}}');
  });
});

describe('LinesDB write-back with a schema that transforms the primary key', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;
  const read = () => readFile(join(dataDir, 'orders.jsonl'), 'utf-8');

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-input-pk-'));
    await writeFile(join(dataDir, 'orders.jsonl'), '{"id":"b","note":"n"}\n');
    await writeFile(
      join(dataDir, 'orders.schema.ts'),
      `export const schema = { primaryKey: 'id', '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, id: 'ORD-' + data.id } }) } };
`,
    );
    db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
    unwrap(await db.initialize());
  });

  afterEach(async () => {
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('keeps the key a line holds when another field of the row is updated', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.update('orders', { note: 'm' }, { id: 'ORD-b' }))));

    expect(await read()).toBe('{"id":"b","note":"m"}\n');
  });

  it('keeps the key an insert was given when the row is updated afterwards', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.insert('orders', { id: 'c', note: 'x' }))));
    unwrap(await db.transaction((tx) => unwrap(tx.update('orders', { note: 'y' }, { id: 'ORD-c' }))));

    expect(await read()).toBe('{"id":"b","note":"n"}\n{"id":"c","note":"y"}\n');
  });

  it('reads the file back to the same rows after both writes', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.insert('orders', { id: 'c', note: 'x' }))));
    unwrap(await db.transaction((tx) => unwrap(tx.update('orders', { note: 'y' }, { id: 'ORD-c' }))));
    await db.close();
    db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
    unwrap(await db.initialize());

    expect(unwrap(db.find('orders')).map((row) => row.id)).toEqual(['ORD-b', 'ORD-c']);
  });
});

describe('LinesDB write-back of a table without a primary key and a transforming schema', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;
  const read = () => readFile(join(dataDir, 'notes.jsonl'), 'utf-8');

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-input-nopk-'));
    await writeFile(join(dataDir, 'notes.jsonl'), '{"code":"a","note":"n"}\n{"code":"b","note":"o"}\n');
    await writeFile(
      join(dataDir, 'notes.schema.ts'),
      `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, code: 'ORD-' + data.code } }) } };
`,
    );
    db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
    unwrap(await db.initialize());
  });

  afterEach(async () => {
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('keeps the value of each line when a row is added', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.insert('notes', { code: 'c', note: 'p' }))));

    expect(await read()).toBe('{"code":"a","note":"n"}\n{"code":"b","note":"o"}\n{"code":"c","note":"p"}\n');
  });

  it('keeps the value of each line when a row is deleted', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.delete('notes', { note: 'n' }))));

    expect(await read()).toBe('{"code":"b","note":"o"}\n');
  });

  it('keeps the value of each line when a row is updated after another was added', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.insert('notes', { code: 'c', note: 'p' }))));
    unwrap(await db.transaction((tx) => unwrap(tx.update('notes', { note: 'q' }, { note: 'o' }))));

    expect(await read()).toBe('{"code":"a","note":"n"}\n{"code":"b","note":"q"}\n{"code":"c","note":"p"}\n');
  });

  it('does not give a row added after a delete the line of the row it took the rowid from', async () => {
    unwrap(
      await db.transaction((tx) => {
        unwrap(tx.delete('notes', { note: 'o' }));
        unwrap(tx.insert('notes', { code: 'z', note: 'w' }));
      }),
    );

    expect(await read()).toBe('{"code":"a","note":"n"}\n{"code":"z","note":"w"}\n');
  });

  it('keeps the lines as they were when the transaction is rolled back', async () => {
    await db.transaction((tx) => {
      unwrap(tx.insert('notes', { code: 'c', note: 'p' }));
      throw new Error('stop');
    });
    unwrap(await db.transaction((tx) => unwrap(tx.update('notes', { note: 'q' }, { note: 'n' }))));

    expect(await read()).toBe('{"code":"a","note":"q"}\n{"code":"b","note":"o"}\n');
  });

  it('refuses to write over a file another process changed, so a recorded position never points at a moved line', async () => {
    await writeFile(
      join(dataDir, 'notes.jsonl'),
      '{"code":"x","note":"first"}\n{"code":"a","note":"n"}\n{"code":"b","note":"o"}\n',
    );

    const result = await db.transaction((tx) => unwrap(tx.update('notes', { note: 'q' }, { note: 'n' })));

    expect(!result.ok && result.error.name).toBe('JsonlConflictError');
    expect(await read()).toBe('{"code":"x","note":"first"}\n{"code":"a","note":"n"}\n{"code":"b","note":"o"}\n');
  });
});
