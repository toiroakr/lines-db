import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { JsonlWriter } from './jsonl-writer.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

describe('LinesDB.transaction write-back', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;
  const itemsPath = () => join(dataDir, 'items.jsonl');
  const tagsPath = () => join(dataDir, 'tags.jsonl');

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-tx-'));
    await writeFile(itemsPath(), '{"id":1,"name":"a"}\n');
    await writeFile(tagsPath(), '{"id":1,"label":"x"}\n');
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());
  });

  afterEach(async () => {
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('rolls the database back when the write-back fails, so the instance keeps matching the files', async () => {
    await writeFile(itemsPath(), '{"id":1,"name":"edited-in-editor"}\n');

    const result = await db.transaction((tx) => unwrap(tx.update('items', { name: 'A' }, { id: 1 })));

    expect(result.ok).toBe(false);
    expect(unwrap(db.find('items'))).toEqual([{ id: 1, name: 'a' }]);
  });

  it('writes no file when one of the files it would write changed on disk', async () => {
    await writeFile(tagsPath(), '{"id":1,"label":"edited-in-editor"}\n');

    const result = await db.transaction((tx) => {
      unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
      unwrap(tx.update('tags', { label: 'X' }, { id: 1 }));
    });

    expect(result.ok).toBe(false);
    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"a"}\n');
    expect(await readFile(tagsPath(), 'utf-8')).toBe('{"id":1,"label":"edited-in-editor"}\n');
  });

  // Not run on Windows or as root: neither lets chmod make a file unwritable
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'restores the files it already wrote when writing a later one fails, so no file keeps the rolled-back change',
    async () => {
      await chmod(tagsPath(), 0o444);
      try {
        const result = await db.transaction((tx) => {
          unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
          unwrap(tx.update('tags', { label: 'X' }, { id: 1 }));
        });

        expect(result.ok).toBe(false);
      } finally {
        await chmod(tagsPath(), 0o644);
      }
      expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"a"}\n');
    },
  );

  it('writes back only the tables it changed, so a change to another table file does not stop it', async () => {
    await writeFile(tagsPath(), '{"id":1,"label":"edited-in-editor"}\n');

    const result = await db.transaction((tx) => unwrap(tx.update('items', { name: 'A' }, { id: 1 })));

    expect(result.ok).toBe(true);
    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"A"}\n');
    expect(await readFile(tagsPath(), 'utf-8')).toBe('{"id":1,"label":"edited-in-editor"}\n');
  });

  it('writes back every table after raw SQL, as the tables it changed are unknown', async () => {
    unwrap(
      await db.transaction((tx) => {
        unwrap(tx.execute(`UPDATE "tags" SET "label" = 'X' WHERE "id" = 1`));
      }),
    );

    expect(await readFile(tagsPath(), 'utf-8')).toBe('{"id":1,"label":"X"}\n');
  });

  it('writes back the table a query() changed, as a RETURNING statement changes rows too', async () => {
    unwrap(
      await db.transaction((tx) => {
        unwrap(tx.query(`UPDATE "tags" SET "label" = 'X' WHERE "id" = 1 RETURNING *`));
      }),
    );

    expect(await readFile(tagsPath(), 'utf-8')).toBe('{"id":1,"label":"X"}\n');
  });

  it('leaves the other tables to themselves after a query() that only reads', async () => {
    await writeFile(tagsPath(), '{"id":1,"label":"edited-in-editor"}\n');

    const result = await db.transaction((tx) => {
      unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
      unwrap(tx.query('SELECT * FROM "tags"'));
    });

    expect(result.ok).toBe(true);
    expect(await readFile(tagsPath(), 'utf-8')).toBe('{"id":1,"label":"edited-in-editor"}\n');
  });

  it('lets a pending auto-sync finish before the transaction begins, so it cannot write the rolled-back change', async () => {
    await writeFile(tagsPath(), '{"id":1,"label":"edited-in-editor"}\n');
    unwrap(db.insert('items', { id: 2, name: 'b' }));

    // Not awaiting anything here: the auto-sync the insert queued must still be pending as the transaction begins
    const result = await db.transaction((tx) => {
      unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
      unwrap(tx.update('tags', { label: 'X' }, { id: 1 }));
    });

    expect(result.ok).toBe(false);
    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"a"}\n{"id":2,"name":"b"}\n');
  });

  it('writes back the rows a foreign-key action changed in another table', async () => {
    await db.close();
    await writeFile(itemsPath(), '{"id":1,"name":"a","tagId":1}\n');
    await writeFile(
      join(dataDir, 'items.schema.ts'),
      "export const foreignKeys = [{ column: 'tagId', references: { table: 'tags', column: 'id' }, onDelete: 'CASCADE' }];\n" +
        "export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };\n",
    );
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());

    unwrap(await db.transaction((tx) => void unwrap(tx.delete('tags', { id: 1 }))));

    expect((await readFile(itemsPath(), 'utf-8')).trim()).toBe('');
  });

  it('puts the files back when COMMIT fails after they were written', async () => {
    await db.close();
    await writeFile(itemsPath(), '{"id":1,"name":"a","tagId":1}\n');
    await writeFile(
      join(dataDir, 'items.schema.ts'),
      "export const foreignKeys = [{ column: 'tagId', references: { table: 'tags', column: 'id' } }];\n" +
        "export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };\n",
    );
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());

    const result = await db.transaction((tx) => {
      unwrap(tx.execute('PRAGMA defer_foreign_keys = ON'));
      unwrap(tx.insert('items', { id: 2, name: 'b', tagId: 99 }));
    });

    expect(result.ok).toBe(false);
    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"a","tagId":1}\n');
  });

  it('puts back the file whose write failed partway, as a write can truncate it before failing', async () => {
    const write = JsonlWriter.write.bind(JsonlWriter);
    const spy = vi.spyOn(JsonlWriter, 'write').mockImplementation(async (path, rows) => {
      if (path !== tagsPath()) return write(path, rows);
      await writeFile(path, '{"id":1,"lab');
      throw new Error('ENOSPC: no space left on device');
    });
    try {
      const result = await db.transaction((tx) => {
        unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
        unwrap(tx.update('tags', { label: 'X' }, { id: 1 }));
      });

      expect(result.ok).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(await readFile(tagsPath(), 'utf-8')).toBe('{"id":1,"label":"x"}\n');
  });

  it('names a file it could not put back and reports it as changed, so a later write does not overwrite it unseen', async () => {
    const write = JsonlWriter.write.bind(JsonlWriter);
    const spy = vi.spyOn(JsonlWriter, 'write').mockImplementation(async (path, rows) => {
      await write(path, rows);
      if (path === itemsPath()) await chmod(path, 0o444);
      if (path === tagsPath()) throw new Error('ENOSPC: no space left on device');
    });
    try {
      const result = await db.transaction((tx) => {
        unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
        unwrap(tx.update('tags', { label: 'X' }, { id: 1 }));
      });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.message).toContain(itemsPath());
      expect(unwrap(await db.hasExternalChanges())).toBe(true);
    } finally {
      spy.mockRestore();
      await chmod(itemsPath(), 0o644);
    }
  });

  it('refuses SQL that would end the transaction early, as the files are written back before it commits', async () => {
    const result = await db.transaction((tx) => {
      unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
      expect(tx.execute('COMMIT').ok).toBe(false);
      expect(tx.execute(' end transaction').ok).toBe(false);
      expect(tx.query('ROLLBACK').ok).toBe(false);
    });

    expect(result.ok).toBe(true);
    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"A"}\n');
  });

  it('refuses transaction control through getDb() inside a transaction', async () => {
    const result = await db.transaction((tx) => {
      unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
      tx.getDb().exec('COMMIT');
    });

    expect(result.ok).toBe(false);
    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"a"}\n');
    expect(unwrap(db.find('items'))).toEqual([{ id: 1, name: 'a' }]);
  });

  it('writes back a change made through getDb() inside a transaction', async () => {
    unwrap(await db.transaction((tx) => void tx.getDb().prepare('UPDATE items SET name = ?').run('Z')));

    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"Z"}\n');
  });

  it('keeps a field its schema does not know in a line it writes back, as the database has no column to hold it', async () => {
    await db.close();
    await writeFile(itemsPath(), '{"id":1,"name":"a","note":"kept"}\n{"id":2,"name":"b"}\n');
    await writeFile(
      join(dataDir, 'items.schema.ts'),
      "export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: { id: data.id, name: data.name } }) } };\n",
    );
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());

    unwrap(await db.transaction((tx) => void unwrap(tx.update('items', { name: 'B' }, { id: 2 }))));

    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"a","note":"kept"}\n{"id":2,"name":"B"}\n');
  });

  it('refuses a sync inside a transaction, as it would write rows the transaction may roll back', async () => {
    const result = await db.transaction(async (tx) => {
      unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
      unwrap(await tx.sync('items'));
    });

    expect(result.ok).toBe(false);
    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"a"}\n');
  });

  it('refuses a second transaction started before the first one began, instead of rolling the first back', async () => {
    const [first, second] = await Promise.all([
      db.transaction((tx) => unwrap(tx.update('items', { name: 'A' }, { id: 1 }))),
      db.transaction((tx) => unwrap(tx.update('tags', { label: 'X' }, { id: 1 }))),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"A"}\n');
  });

  it('leaves a table that a write did not change out of the write-back, so a change on disk does not stop it', async () => {
    await writeFile(tagsPath(), '{"id":1,"label":"edited-in-editor"}\n');

    const result = await db.transaction((tx) => {
      unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
      unwrap(tx.delete('tags', { id: 999 }));
    });

    expect(result.ok).toBe(true);
    expect(await readFile(tagsPath(), 'utf-8')).toBe('{"id":1,"label":"edited-in-editor"}\n');
  });
});
