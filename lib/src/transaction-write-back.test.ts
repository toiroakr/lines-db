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

  it('writes back what SQL run through getDb() changed before a later statement of it failed', async () => {
    unwrap(
      await db.transaction((tx) => {
        try {
          tx.getDb().exec("UPDATE items SET name = 'Z'; INSERT INTO no_such_table VALUES (1)");
        } catch {
          // The caller goes on, keeping the change the first statement made
        }
      }),
    );

    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"Z"}\n');
  });

  it('keeps a field its schema does not know on a row whose primary key changed', async () => {
    await db.close();
    await writeFile(itemsPath(), '{"id":1,"name":"a","note":"kept"}\n');
    await writeFile(
      join(dataDir, 'items.schema.ts'),
      "export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: { id: data.id, name: data.name } }) } };\n",
    );
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());

    unwrap(await db.transaction((tx) => void unwrap(tx.update('items', { id: 9 }, { id: 1 }))));

    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":9,"name":"a","note":"kept"}\n');
  });

  it('refuses a write made while a transaction writes its files back, which the files would miss', async () => {
    const write = JsonlWriter.write.bind(JsonlWriter);
    let lateWrite: { ok: boolean } | undefined;
    const spy = vi.spyOn(JsonlWriter, 'write').mockImplementation(async (path, rows) => {
      lateWrite ??= db.insert('tags', { id: 2, label: 'late' });
      return write(path, rows);
    });
    try {
      unwrap(await db.transaction((tx) => void unwrap(tx.update('items', { name: 'A' }, { id: 1 }))));
    } finally {
      spy.mockRestore();
    }

    expect(lateWrite?.ok).toBe(false);
    expect(unwrap(db.find('tags'))).toEqual([{ id: 1, label: 'x' }]);
  });

  it('refuses a write made through the database while the callback awaits, and commits the tx writes', async () => {
    let outside: { ok: boolean } | undefined;
    let outsideQuery: { ok: boolean } | undefined;
    const result = await db.transaction(async (tx) => {
      unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
      await Promise.resolve();
      outside = db.insert('tags', { id: 2, label: 'x' });
      outsideQuery = db.query("INSERT INTO tags (id, label) VALUES (3, 'y')");
      unwrap(tx.insert('tags', { id: 4, label: 'z' }));
    });

    expect(result.ok).toBe(true);
    expect(outside?.ok).toBe(false);
    expect(outsideQuery?.ok).toBe(false);
    expect(unwrap(db.find('tags'))).toEqual([
      { id: 1, label: 'x' },
      { id: 4, label: 'z' },
    ]);
  });

  it('refuses a write made through the database during a transaction that then rolls back, so none is reported ok and lost', async () => {
    let outside: { ok: boolean } | undefined;
    const result = await db.transaction(async (tx) => {
      unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
      await Promise.resolve();
      outside = db.insert('tags', { id: 2, label: 'x' });
      throw new Error('changed my mind');
    });

    expect(result.ok).toBe(false);
    expect(outside?.ok).toBe(false);
  });

  it('refuses SQL run through a getDb() taken from the database while the callback awaits', async () => {
    let threw = false;
    await db.transaction(async () => {
      await Promise.resolve();
      try {
        db.getDb().exec("INSERT INTO tags (id, label) VALUES (5, 'w')");
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(true);
  });

  it('refuses a write made through a tx kept from an earlier transaction while a later one runs', async () => {
    let kept: typeof db | undefined;
    unwrap(
      await db.transaction((tx) => {
        kept = tx;
      }),
    );

    let stale: { ok: boolean } | undefined;
    const result = await db.transaction(async () => {
      await Promise.resolve();
      stale = kept!.insert('tags', { id: 2, label: 'x' });
    });

    expect(result.ok).toBe(true);
    expect(stale?.ok).toBe(false);
    expect(unwrap(db.find('tags'))).toEqual([{ id: 1, label: 'x' }]);
  });

  it('still answers reads made through the database while the callback awaits', async () => {
    let queried: unknown;
    let prepared: unknown;
    await db.transaction(async () => {
      await Promise.resolve();
      queried = db.query('SELECT label FROM tags');
      prepared = db.getDb().prepare('SELECT label FROM tags').all();
    });

    expect(queried).toEqual({ ok: true, value: [{ label: 'x' }] });
    expect(prepared).toEqual([{ label: 'x' }]);
  });

  it('refuses a write made while a transaction is starting, as its write-back would read the transaction', async () => {
    const started = db.transaction((tx) => void unwrap(tx.update('items', { name: 'A' }, { id: 1 })));
    const early = db.insert('tags', { id: 2, label: 'early' });
    unwrap(await started);

    expect(early.ok).toBe(false);
  });

  it('refuses a statement prepared in a transaction when it runs while the files are written back', async () => {
    let statement: { run(...params: unknown[]): unknown } | undefined;
    let late: unknown;
    const write = JsonlWriter.write.bind(JsonlWriter);
    const spy = vi.spyOn(JsonlWriter, 'write').mockImplementation(async (path, rows) => {
      if (late === undefined) {
        try {
          late = statement?.run('Z');
        } catch (error) {
          late = error;
        }
      }
      return write(path, rows);
    });
    try {
      unwrap(
        await db.transaction((tx) => {
          statement = tx.getDb().prepare('UPDATE tags SET label = ?');
          unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
        }),
      );
    } finally {
      spy.mockRestore();
    }

    expect(late).toBeInstanceOf(Error);
    expect(unwrap(db.find('tags'))).toEqual([{ id: 1, label: 'x' }]);
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
  it('refuses a query() that changes rows while a transaction is starting, and still answers one that reads', async () => {
    const started = db.transaction((tx) => void unwrap(tx.update('items', { name: 'A' }, { id: 1 })));
    const write = db.query("UPDATE tags SET label = 'early' RETURNING id");
    const writeOne = db.queryOne("UPDATE tags SET label = 'early' RETURNING id");
    const read = db.query('SELECT label FROM tags');
    unwrap(await started);

    expect(write.ok).toBe(false);
    expect(writeOne.ok).toBe(false);
    expect(unwrap(read)).toEqual([{ label: 'x' }]);
    expect(unwrap(db.find('tags'))).toEqual([{ id: 1, label: 'x' }]);
  });

  it('refuses SQL through getDb() while a transaction is starting, as its write-back would miss it', async () => {
    const started = db.transaction((tx) => void unwrap(tx.update('items', { name: 'A' }, { id: 1 })));
    const early = () => db.getDb().prepare('UPDATE tags SET label = ?').run('early');
    expect(early).toThrow();
    unwrap(await started);

    expect(unwrap(db.find('tags'))).toEqual([{ id: 1, label: 'x' }]);
  });

  it('writes back the records a batchInsert() inserted before a later one failed', async () => {
    unwrap(
      await db.transaction((tx) => {
        // The caller goes on without the failed record, keeping the ones inserted before it
        tx.batchInsert('tags', [
          { id: 2, label: 'y' },
          { id: 3, no_such_column: 1 },
        ] as never);
      }),
    );

    expect(await readFile(tagsPath(), 'utf-8')).toBe('{"id":1,"label":"x"}\n{"id":2,"label":"y"}\n');
  });

  it('refuses transaction control behind a leading comment', async () => {
    const result = await db.transaction((tx) => {
      unwrap(tx.update('items', { name: 'A' }, { id: 1 }));
      expect(tx.execute('/* done */ COMMIT').ok).toBe(false);
      expect(tx.execute('-- done\nCOMMIT').ok).toBe(false);
    });

    expect(result.ok).toBe(true);
    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"A"}\n');
  });

  it('gives a row inserted in the rowid of a row raw SQL deleted none of the fields its schema does not know', async () => {
    await db.close();
    await writeFile(itemsPath(), '{"id":"a","name":"a","note":"kept"}\n');
    await writeFile(
      join(dataDir, 'items.schema.ts'),
      "export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: { id: data.id, name: data.name } }) } };\n",
    );
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());

    unwrap(
      await db.transaction((tx) => {
        unwrap(tx.execute("DELETE FROM items WHERE id = 'a'"));
        unwrap(tx.insert('items', { id: 'b', name: 'b' }));
      }),
    );

    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":"b","name":"b"}\n');
  });

  it('gives a row raw SQL inserted in the rowid of a row it deleted none of the fields its schema does not know', async () => {
    await db.close();
    await writeFile(itemsPath(), '{"id":"a","name":"a","note":"kept"}\n');
    await writeFile(
      join(dataDir, 'items.schema.ts'),
      "export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: { id: data.id, name: data.name } }) } };\n",
    );
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());

    unwrap(
      await db.transaction((tx) => {
        unwrap(tx.execute("DELETE FROM items WHERE id = 'a'"));
        unwrap(tx.execute("INSERT INTO items (id, name) VALUES ('b', 'b')"));
      }),
    );

    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":"b","name":"b"}\n');
  });

  it('keeps a field its schema does not know on a row whose deletion was rolled back', async () => {
    await db.close();
    await writeFile(itemsPath(), '{"id":1,"name":"a","note":"kept"}\n');
    await writeFile(
      join(dataDir, 'items.schema.ts'),
      "export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: { id: data.id, name: data.name } }) } };\n",
    );
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());

    const rolledBack = await db.transaction((tx) => {
      unwrap(tx.delete('items', { id: 1 }));
      throw new Error('changed my mind');
    });
    unwrap(await db.transaction((tx) => void unwrap(tx.update('items', { name: 'B' }, { id: 1 }))));

    expect(rolledBack.ok).toBe(false);
    expect(await readFile(itemsPath(), 'utf-8')).toBe('{"id":1,"name":"B","note":"kept"}\n');
  });
});
