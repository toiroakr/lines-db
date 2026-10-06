import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LinesDB } from './database.js';
import { JsonlWriter } from './jsonl-writer.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

describe('data set write-back', () => {
  let root: string;
  let local: string;
  let db: LinesDB<TableDefs>;
  const baseFile = () => join(root, 'users.jsonl');
  const localFile = () => join(local, 'users.jsonl');
  const base = '{"id":5,"name":"Base"}\n{"id":1,"name":"First"}\n';
  const set = '{"id":2,"name":"Local"}\n';
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'linesdb-sets-'));
    local = join(root, 'local');
    await mkdir(local);
    await writeFile(baseFile(), base);
    await writeFile(localFile(), set);
    db = LinesDB.create({
      dataDir: [root, local],
      schemaDir: root,
      writeDataSets: true,
      writeFilledValues: 'primaryKey',
    });
    unwrap(await db.initialize());
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
    await rm(root, { recursive: true, force: true });
  });
  it('rejects raw mutations through every SQL interface while typed edits remain writable', async () => {
    expect(db.execute("INSERT INTO users (id, name) VALUES (3, 'Raw')").ok).toBe(false);
    expect(db.query('UPDATE users SET id = 8 WHERE id = 2 RETURNING *').ok).toBe(false);
    expect(db.queryOne('DELETE FROM users WHERE id = 1 RETURNING *').ok).toBe(false);
    const handle = db.getDb();
    expect(() => handle.exec('DELETE FROM users WHERE id = 5')).toThrow();
    expect(() => handle.prepare("UPDATE users SET name = 'Raw' WHERE id = 2").run()).toThrow();
    expect(() => handle.prepare('PRAGMA query_only = OFF')).toThrow();
    expect(unwrap(db.query('SELECT COUNT(*) AS count FROM users'))).toEqual([{ count: 3 }]);
    expect(handle.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 3 });
    unwrap(
      await db.transaction((tx) => {
        expect(tx.execute("UPDATE users SET name = 'Raw' WHERE id = 1").ok).toBe(false);
        expect(() => tx.getDb().exec("INSERT INTO users (id, name) VALUES (3, 'Raw')")).toThrow();
        unwrap(tx.update('users', { name: 'Typed' }, { id: 2 }));
      }),
    );
    expect(await readFile(localFile(), 'utf8')).toBe('{"id":2,"name":"Typed"}\n');
  });

  it('keeps the source of a child whose integer primary key is updated by a foreign-key cascade', async () => {
    await db.close();
    const profiles = join(local, 'profiles.jsonl');
    await writeFile(profiles, '{"id":5,"bio":"Local profile"}\n');
    await writeFile(
      join(root, 'profiles.schema.ts'),
      "export const foreignKeys = [{ column: 'id', references: { table: 'users', column: 'id' }, onUpdate: 'CASCADE' }];\n" +
        "export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };\n",
    );
    db = LinesDB.create({ dataDir: [root, local], schemaDir: root, writeDataSets: true });
    unwrap(await db.initialize());
    unwrap(await db.transaction((tx) => unwrap(tx.update('users', { id: 9 }, { id: 5 }))));
    expect(await readFile(profiles, 'utf8')).toBe('{"id":9,"bio":"Local profile"}\n');
    unwrap(await db.transaction((tx) => unwrap(tx.update('profiles', { bio: 'Updated' }, { id: 9 }))));
    expect(await readFile(profiles, 'utf8')).toBe('{"id":9,"bio":"Updated"}\n');
  });

  it('updates and deletes rows in their original files, preserving line order after a key changes', async () => {
    unwrap(
      await db.transaction((tx) => {
        unwrap(tx.update('users', { id: 9, name: 'Changed' }, { id: 5 }));
        unwrap(tx.delete('users', { id: 2 }));
      }),
    );
    expect(await readFile(baseFile(), 'utf8')).toBe('{"id":9,"name":"Changed"}\n{"id":1,"name":"First"}\n');
    expect(await readFile(localFile(), 'utf8')).toBe('\n');
    unwrap(await db.transaction((tx) => unwrap(tx.update('users', { name: 'Again' }, { id: 9 }))));
    expect(await readFile(baseFile(), 'utf8')).toBe('{"id":9,"name":"Again"}\n{"id":1,"name":"First"}\n');
  });
  it('requires an insert destination and writes new rows only to the chosen set, including new files', async () => {
    expect(db.insert('users', { id: 3, name: 'Missing' }).ok).toBe(false);
    expect(db.insert('users', { id: 3, name: 'Outside' }, { dataDir: tmpdir() }).ok).toBe(false);
    unwrap(await db.transaction((tx) => unwrap(tx.insert('users', { id: 3, name: 'New' }, { dataDir: local }))));
    expect(await readFile(baseFile(), 'utf8')).toBe(base);
    expect(await readFile(localFile(), 'utf8')).toBe(set + '{"id":3,"name":"New"}\n');
    const third = join(root, 'third');
    await mkdir(third);
    await db.close();
    db = LinesDB.create({ dataDir: [root, local, third], schemaDir: root, writeDataSets: true });
    unwrap(await db.initialize());
    unwrap(await db.transaction((tx) => unwrap(tx.insert('users', { id: 4, name: 'Third' }, { dataDir: third }))));
    expect(await readFile(join(third, 'users.jsonl'), 'utf8')).toBe('{"id":4,"name":"Third"}\n');
    expect(unwrap(await db.hasExternalChanges())).toBe(false);
    unwrap(await db.transaction((tx) => unwrap(tx.delete('users', { id: 4 }))));
    expect((await readFile(join(third, 'users.jsonl'), 'utf8')).trim()).toBe('');
  });

  it('rolls back every file and row when a later file fails, and retains routing for a retry', async () => {
    const write = JsonlWriter.write.bind(JsonlWriter);
    const failure = vi.spyOn(JsonlWriter, 'write').mockImplementation(async (file, rows) => {
      if (file === localFile() || file.startsWith(localFile() + '.')) throw new Error('disk full');
      return write(file, rows);
    });
    const change = (tx: LinesDB<TableDefs>) => {
      unwrap(tx.update('users', { name: 'Changed' }, { id: 5 }));
      unwrap(tx.insert('users', { id: 3, name: 'New' }, { dataDir: local }));
    };
    expect((await db.transaction(change)).ok).toBe(false);
    expect(await readFile(baseFile(), 'utf8')).toBe(base);
    expect(await readFile(localFile(), 'utf8')).toBe(set);
    expect(unwrap(db.findOne('users', { id: 5 }))).toMatchObject({ name: 'Base' });
    expect(unwrap(db.findOne('users', { id: 3 }))).toBeNull();
    failure.mockRestore();
    unwrap(await db.transaction(change));
    expect(await readFile(localFile(), 'utf8')).toBe(set + '{"id":3,"name":"New"}\n');
  });

  it('preserves the bytes of source files whose rows were not edited', async () => {
    await db.close();
    const formatted = '{ "id":5, "name":"Base" }\n{"id":1,"name":"First"}\n';
    await writeFile(baseFile(), formatted);
    db = LinesDB.create({ dataDir: [root, local], schemaDir: root, writeDataSets: true });
    unwrap(await db.initialize());
    unwrap(await db.transaction((tx) => unwrap(tx.update('users', { name: 'Changed' }, { id: 2 }))));
    expect(await readFile(baseFile(), 'utf8')).toBe(formatted);
  });

  it('refuses to replace a source file changed while the new content is staged', async () => {
    const external = '{"id":5,"name":"External"}\n{"id":1,"name":"First"}\n';
    const write = JsonlWriter.write.bind(JsonlWriter);
    vi.spyOn(JsonlWriter, 'write').mockImplementation(async (file, rows) => {
      await write(file, rows);
      if (file.startsWith(baseFile() + '.')) await writeFile(baseFile(), external);
    });
    expect((await db.transaction((tx) => unwrap(tx.update('users', { name: 'Changed' }, { id: 5 })))).ok).toBe(false);
    expect(await readFile(baseFile(), 'utf8')).toBe(external);
    expect(await readFile(localFile(), 'utf8')).toBe(set);
  });

  it('preserves an external edit made after the first file was saved when a later write fails', async () => {
    const external = '{"id":5,"name":"External"}\n{"id":1,"name":"First"}\n';
    const write = JsonlWriter.write.bind(JsonlWriter);
    vi.spyOn(JsonlWriter, 'write').mockImplementation(async (file, rows) => {
      if (file === localFile() || file.startsWith(localFile() + '.')) {
        await writeFile(baseFile(), external);
        throw new Error('disk full');
      }
      return write(file, rows);
    });
    const result = await db.transaction((tx) => {
      unwrap(tx.update('users', { name: 'Changed' }, { id: 5 }));
      unwrap(tx.update('users', { name: 'Changed' }, { id: 2 }));
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('could not be put back');
    expect(await readFile(baseFile(), 'utf8')).toBe(external);
    expect(await readFile(localFile(), 'utf8')).toBe(set);
    expect(unwrap(await db.hasExternalChanges())).toBe(true);
  });

  it('retains source positions when an automatic sync fails, so a retry preserves untouched fields', async () => {
    await db.close();
    const original = '{"id":5,"name":"Base","age":10}\n{"id":1,"name":"First"}\n';
    await writeFile(baseFile(), original);
    await writeFile(
      join(root, 'users.schema.ts'),
      "export const schema = { '~standard': { version: 1, vendor: 'test', validate: (row) => ({ value: { ...row, age: row.age ?? 20 } }) } };",
    );
    db = LinesDB.create({
      dataDir: [root, local],
      schemaDir: root,
      writeDataSets: true,
      writeFilledValues: 'primaryKey',
    });
    unwrap(await db.initialize());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const write = JsonlWriter.write.bind(JsonlWriter);
    const failure = vi.spyOn(JsonlWriter, 'write').mockImplementation(async (file, rows) => {
      if (file === localFile() || file.startsWith(localFile() + '.')) throw new Error('disk full');
      return write(file, rows);
    });
    unwrap(db.delete('users', { id: 5 }));
    unwrap(db.update('users', { name: 'Changed' }, { id: 2 }));
    expect((await db.sync('users')).ok).toBe(false);
    expect(await readFile(baseFile(), 'utf8')).toBe(original);
    failure.mockRestore();
    unwrap(await db.sync('users'));
    expect(await readFile(baseFile(), 'utf8')).toBe('{"id":1,"name":"First"}\n');
    expect(await readFile(localFile(), 'utf8')).toBe('{"id":2,"name":"Changed"}\n');
  });

  it('writes nothing when any source file changes externally', async () => {
    await writeFile(localFile(), '{"id":2,"name":"External"}\n');
    const result = await db.transaction((tx) => unwrap(tx.update('users', { name: 'Changed' }, { id: 5 })));
    expect(result.ok).toBe(false);
    expect(await readFile(baseFile(), 'utf8')).toBe(base);
    expect(await readFile(localFile(), 'utf8')).toBe('{"id":2,"name":"External"}\n');
  });

  it('writes cascading deletes into a referencing row’s data directory', async () => {
    await db.close();
    const posts = join(local, 'posts.jsonl');
    await writeFile(posts, '{"id":1,"userId":5}\n{"id":2,"userId":2}\n');
    await writeFile(
      join(root, 'posts.schema.ts'),
      "export const foreignKeys = [{ column: 'userId', references: { table: 'users', column: 'id' }, onDelete: 'CASCADE' }];\n" +
        "export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };\n",
    );
    db = LinesDB.create({ dataDir: [root, local], schemaDir: root, writeDataSets: true });
    unwrap(await db.initialize());
    unwrap(await db.transaction((tx) => unwrap(tx.delete('users', { id: 5 }))));
    expect(await readFile(posts, 'utf8')).toBe('{"id":2,"userId":2}\n');
    expect(await readFile(localFile(), 'utf8')).toBe(set);
  });

  it('keeps transformed fields associated with the source row rather than primary-key order', async () => {
    await db.close();
    db = LinesDB.create({
      dataDir: [root, local],
      schemaDir: root,
      writeDataSets: true,
      writeFilledValues: 'primaryKey',
    });
    unwrap(
      await db.initialize({
        tableName: 'users',
        transform: (row) => (row.id === 5 ? { ...row, extra: 'transformed' } : row),
      }),
    );
    unwrap(await db.transaction((tx) => unwrap(tx.update('users', { name: 'Changed' }, { id: 5 }))));
    expect(JSON.parse((await readFile(baseFile(), 'utf8')).split('\n')[0])).toMatchObject({
      id: 5,
      extra: 'transformed',
    });
    expect(await readFile(localFile(), 'utf8')).toBe(set);
  });

  it('keeps omitted defaults matched to each source row after keys change', async () => {
    await db.close();
    await writeFile(
      join(root, 'users.schema.ts'),
      `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (row) => ({ value: { ...row, age: row.age ?? 20 } }) } };`,
    );
    db = LinesDB.create({
      dataDir: [root, local],
      schemaDir: root,
      writeDataSets: true,
      writeFilledValues: 'primaryKey',
    });
    unwrap(await db.initialize());
    expect(unwrap(await db.findWithDefaults('users')).every(({ defaulted }) => defaulted.includes('age'))).toBe(true);
    unwrap(await db.transaction((tx) => unwrap(tx.update('users', { id: 8, name: 'Updated' }, { id: 2 }))));
    expect(await readFile(localFile(), 'utf8')).toBe('{"id":8,"name":"Updated"}\n');
    expect(unwrap(await db.findWithDefaults('users')).every(({ defaulted }) => defaulted.includes('age'))).toBe(true);
  });
});
