import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
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
});
