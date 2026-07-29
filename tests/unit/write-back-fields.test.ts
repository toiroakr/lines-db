import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LinesDB } from '../../lib/src/database.js';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = join(__dirname, '../../lib/bin/cli.mjs');

/**
 * Schema that mimics a generated seed schema: no `backward`, and validation fills in
 * fields the JSONL file never carried (an id and a hook-computed value).
 */
const HOOK_SCHEMA = `import { defineSchema } from '@toiroakr/lines-db';

let counter = 0;

export const schema = defineSchema(
  {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (data) => {
        const row = typeof data === 'object' && data !== null ? data : {};
        return {
          value: {
            id: row.id ?? \`generated-\${++counter}\`,
            nickname: null,
            ...row,
            computed: \`computed-\${row.name}\`,
          },
        };
      },
    },
    primaryKey: 'id',
  },
);
`;

async function readJsonl(filePath: string): Promise<Record<string, unknown>[]> {
  const content = await readFile(filePath, 'utf-8');
  return content
    .trim()
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('write-back fields', () => {
  let testDir: string;
  let dataPath: string;

  beforeEach(async () => {
    testDir = join(__dirname, '.test-tmp', `write-back-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    dataPath = join(testDir, 'User.jsonl');
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, 'User.schema.ts'), HOOK_SCHEMA);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('materializes every field when no fields are declared', async () => {
    await writeFile(dataPath, `{"name":"John"}\n{"name":"Jane"}\n`);

    const db = LinesDB.create({ dataDir: testDir });
    await db.initialize();
    await db.sync('User');
    await db.close();

    const rows = await readJsonl(dataPath);
    // Existing behaviour: hook-computed values and omitted optional fields are baked in
    expect(rows[0]).toEqual({
      id: expect.any(String),
      nickname: null,
      name: 'John',
      computed: 'computed-John',
    });
  });

  it('writes back only the declared fields and keeps the rest of each line untouched', async () => {
    await writeFile(dataPath, `{"name":"John"}\n{"name":"Jane"}\n`);

    const db = LinesDB.create({ dataDir: testDir });
    await db.initialize();
    await db.sync('User', { fields: ['id'] });
    const ids = db.find('User').map((row) => (row as { id: string }).id);
    await db.close();

    const rows = await readJsonl(dataPath);
    expect(rows).toEqual([
      { name: 'John', id: ids[0] },
      { name: 'Jane', id: ids[1] },
    ]);
  });

  it('takes the fields to write back from the database config', async () => {
    await writeFile(dataPath, `{"name":"John"}\n`);

    const db = LinesDB.create({ dataDir: testDir, writeBackFields: ['id'] });
    await db.initialize();
    await db.sync('User');
    await db.close();

    const rows = await readJsonl(dataPath);
    expect(rows).toEqual([{ name: 'John', id: expect.any(String) }]);
  });

  it('lets sync options override the database config', async () => {
    await writeFile(dataPath, `{"name":"John"}\n`);

    const db = LinesDB.create({ dataDir: testDir, writeBackFields: ['id'] });
    await db.initialize();
    await db.sync('User', { fields: ['computed'] });
    await db.close();

    const rows = await readJsonl(dataPath);
    expect(rows).toEqual([{ name: 'John', computed: 'computed-John' }]);
  });

  it('matches rows by primary key when the file carries one', async () => {
    await writeFile(
      dataPath,
      `{"id":"u1","name":"John"}\n{"id":"u2","name":"Jane","nickname":"J"}\n{"id":"u3","name":"Judy"}\n`,
    );

    const db = LinesDB.create({ dataDir: testDir, writeBackFields: ['nickname'] });
    await db.initialize();
    // Deleting a row must not shift which line the remaining rows are merged into
    db.delete('User', { id: 'u1' });
    db.update('User', { nickname: 'Ju' }, { id: 'u3' });
    await db.sync('User');
    await db.close();

    const rows = await readJsonl(dataPath);
    expect(rows).toEqual([
      { id: 'u2', name: 'Jane', nickname: 'J' },
      { id: 'u3', name: 'Judy', nickname: 'Ju' },
    ]);
  });

  it('writes rows that have no matching line in full', async () => {
    await writeFile(dataPath, `{"id":"u1","name":"John"}\n`);

    const db = LinesDB.create({ dataDir: testDir, writeBackFields: ['nickname'] });
    await db.initialize();
    db.insert('User', { id: 'u2', name: 'Jane', nickname: 'J', computed: 'computed-Jane' });
    await db.sync('User');
    await db.close();

    const rows = await readJsonl(dataPath);
    expect(rows).toEqual([
      // A declared field is always taken from the database, even when it is null there
      { id: 'u1', name: 'John', nickname: null },
      // Nothing to preserve for a row the file never had, so it is written whole
      { id: 'u2', name: 'Jane', nickname: 'J', computed: 'computed-Jane' },
    ]);
  });

  it('flushes the auto-sync of a write before closing', async () => {
    await writeFile(dataPath, `{"id":"u1","name":"John"}\n{"id":"u2","name":"Jane"}\n`);

    const db = LinesDB.create({ dataDir: testDir, writeBackFields: ['nickname'] });
    await db.initialize();
    // Overlapping auto-syncs, with no explicit sync to wait on
    db.update('User', { nickname: 'J' }, { id: 'u1' });
    db.update('User', { nickname: 'Ja' }, { id: 'u2' });
    await db.close();

    const rows = await readJsonl(dataPath);
    expect(rows).toEqual([
      { id: 'u1', name: 'John', nickname: 'J' },
      { id: 'u2', name: 'Jane', nickname: 'Ja' },
    ]);
  });

  it('backfills a file that only some rows carry a primary key in', async () => {
    await writeFile(dataPath, `{"name":"John"}\n{"id":"u2","name":"Jane","nickname":"J"}\n{"name":"Judy"}\n`);

    const db = LinesDB.create({ dataDir: testDir, writeBackFields: ['id'] });
    await db.initialize();
    await db.sync('User');
    await db.close();

    const rows = await readJsonl(dataPath);
    expect(rows).toEqual([
      { name: 'John', id: expect.any(String) },
      { id: 'u2', name: 'Jane', nickname: 'J' },
      { name: 'Judy', id: expect.any(String) },
    ]);
  });

  it('writes no field back when the list is empty', async () => {
    await writeFile(dataPath, `{"name":"John"}\n`);

    const db = LinesDB.create({ dataDir: testDir, writeBackFields: [] });
    await db.initialize();
    await db.sync('User');
    await db.close();

    // An empty list must not fall back to writing the whole row
    expect(await readJsonl(dataPath)).toEqual([{ name: 'John' }]);
  });

  it('keeps the file value for rows the backward transformation drops the field from', async () => {
    await writeFile(join(testDir, 'Event.jsonl'), `{"id":"e1","note":"keep"}\n{"id":"e2","note":"stale"}\n`);
    await writeFile(
      join(testDir, 'Event.schema.ts'),
      `import { defineSchema } from '@toiroakr/lines-db';

export const schema = defineSchema(
  {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (data) => ({ value: { ...data, note: 'from-db' } }),
    },
    primaryKey: 'id',
  },
  {
    // Drops 'note' for e1, so the written row does not carry the field at all
    backward: (output) => (output.id === 'e1' ? { id: output.id } : output),
  },
);
`,
    );

    const db = LinesDB.create({ dataDir: testDir, writeBackFields: ['note'] });
    await db.initialize({ tableName: 'Event' });
    await db.sync('Event');
    await db.close();

    expect(await readJsonl(join(testDir, 'Event.jsonl'))).toEqual([
      { id: 'e1', note: 'keep' },
      { id: 'e2', note: 'from-db' },
    ]);
  });

  it('keeps the file line order when the database returns rows in another order', async () => {
    // An integer primary key is SQLite's rowid, so a query returns these rows as 1, 2, 3
    await writeFile(join(testDir, 'Item.jsonl'), `{"id":3,"name":"c"}\n{"id":1,"name":"a"}\n{"id":2,"name":"b"}\n`);
    await writeFile(
      join(testDir, 'Item.schema.ts'),
      `import { defineSchema } from '@toiroakr/lines-db';

export const schema = defineSchema(
  {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (data) => ({ value: { ...data, computed: 'derived' } }),
    },
    primaryKey: 'id',
  },
);
`,
    );

    const db = LinesDB.create({ dataDir: testDir, writeBackFields: ['name'] });
    await db.initialize({ tableName: 'Item' });
    db.update('Item', { name: 'A' }, { id: 1 });
    await db.sync('Item');
    await db.close();

    expect(await readJsonl(join(testDir, 'Item.jsonl'))).toEqual([
      { id: 3, name: 'c' },
      { id: 1, name: 'A' },
      { id: 2, name: 'b' },
    ]);
  });

  it('rejects fields the table does not have', async () => {
    await writeFile(dataPath, `{"name":"John"}\n`);

    const db = LinesDB.create({ dataDir: testDir });
    await db.initialize();

    await expect(db.sync('User', { fields: ['nickname', 'typo'] })).rejects.toThrow(
      /Cannot write back field\(s\) \[typo\] for table 'User'/,
    );

    await db.close();
    // The file must be left alone when the write-back is rejected
    expect(await readJsonl(dataPath)).toEqual([{ name: 'John' }]);
  });

  it('refuses to guess when rows cannot be matched to their lines', async () => {
    await writeFile(dataPath, `{"name":"John"}\n{"name":"Jane"}\n`);

    const db = LinesDB.create({ dataDir: testDir, writeBackFields: ['id'] });
    await db.initialize();
    // The file has no ids to match on, and the row count no longer lines up
    db.insert('User', { id: 'u3', name: 'Judy', nickname: null, computed: 'computed-Judy' });

    await expect(db.sync('User')).rejects.toThrow(
      /the file has 2 row\(s\) but the table has 3.*cannot be matched to their existing lines/s,
    );

    await db.close();
    expect(await readJsonl(dataPath)).toEqual([{ name: 'John' }, { name: 'Jane' }]);
  });

  it('applies the backward transformation before merging', async () => {
    await writeFile(join(testDir, 'Event.jsonl'), `{"date":"2024-01-01T00:00:00.000Z","note":"kickoff"}\n`);
    await writeFile(
      join(testDir, 'Event.schema.ts'),
      `import { defineSchema } from '@toiroakr/lines-db';

export const schema = defineSchema(
  {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (data) => {
        const row = typeof data === 'object' && data !== null ? data : {};
        return { value: { ...row, date: new Date(row.date), seq: 1 } };
      },
    },
  },
  {
    backward: (output) => ({ ...output, date: new Date(output.date).toISOString(), seq: String(output.seq) }),
  },
);
`,
    );

    const db = LinesDB.create({ dataDir: testDir, writeBackFields: ['seq'] });
    await db.initialize({ tableName: 'Event' });
    await db.sync('Event');
    await db.close();

    const rows = await readJsonl(join(testDir, 'Event.jsonl'));
    // `seq` comes from the backward transformation, `date` and `note` from the file
    expect(rows).toEqual([{ date: '2024-01-01T00:00:00.000Z', note: 'kickoff', seq: '1' }]);
  });

  it('backfills ids through the migrate CLI without touching other fields', async () => {
    await writeFile(dataPath, `{"name":"John"}\n{"name":"Jane","nickname":"J"}\n`);

    await execFileAsync(process.execPath, [cliPath, 'migrate', dataPath, '(row) => row', '--fields', 'id']);

    const rows = await readJsonl(dataPath);
    expect(rows).toEqual([
      { name: 'John', id: expect.any(String) },
      { name: 'Jane', nickname: 'J', id: expect.any(String) },
    ]);
  });

  it('honours --fields on the transaction-backed directory migration', async () => {
    await writeFile(dataPath, `{"name":"John"}\n{"name":"Jane"}\n`);

    // A directory migration with --filter writes back through a transaction
    await execFileAsync(process.execPath, [
      cliPath,
      'migrate',
      testDir,
      '(row) => ({ ...row, name: row.name.toUpperCase() })',
      '--filter',
      '{ "name": "John" }',
      '--fields',
      'id,name',
    ]);

    const rows = await readJsonl(dataPath);
    expect(rows).toEqual([
      { name: 'JOHN', id: expect.any(String) },
      { name: 'Jane', id: expect.any(String) },
    ]);
  });

  it('leaves out fields a table does not have', async () => {
    // A seed directory where one table is keyed on something other than an id
    await writeFile(dataPath, `{"name":"John"}\n`);
    await writeFile(join(testDir, 'Account.jsonl'), `{"email":"john@example.com","password":"secret"}\n`);
    await writeFile(
      join(testDir, 'Account.schema.ts'),
      `import { defineSchema } from '@toiroakr/lines-db';

export const schema = defineSchema(
  {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (data) => ({ value: { ...data, computed: 'derived' } }),
    },
    primaryKey: 'email',
  },
);
`,
    );

    await execFileAsync(process.execPath, [cliPath, 'migrate', testDir, '(row) => row', '--fields', 'id']);

    expect(await readJsonl(dataPath)).toEqual([{ name: 'John', id: expect.any(String) }]);
    // Account has no id, so nothing is written back to it - not even its computed field
    expect(await readJsonl(join(testDir, 'Account.jsonl'))).toEqual([
      { email: 'john@example.com', password: 'secret' },
    ]);
  });

  it('fails when --fields names a field no table has', async () => {
    await writeFile(dataPath, `{"name":"John"}\n`);

    await expect(
      execFileAsync(process.execPath, [cliPath, 'migrate', testDir, '(row) => row', '--fields', 'idd']),
    ).rejects.toThrow(/--fields names field\(s\) no table has: idd/);

    expect(await readJsonl(dataPath)).toEqual([{ name: 'John' }]);
  });

  it('migrates every field through the CLI when --fields is omitted', async () => {
    await writeFile(dataPath, `{"name":"John"}\n`);

    await execFileAsync(process.execPath, [cliPath, 'migrate', dataPath, '(row) => row']);

    const rows = await readJsonl(dataPath);
    expect(rows).toEqual([{ id: expect.any(String), nickname: null, name: 'John', computed: 'computed-John' }]);
  });
});
