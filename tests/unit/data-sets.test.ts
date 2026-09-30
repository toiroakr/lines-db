import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LinesDB } from '../../lib/src/database.js';
import { unwrap } from '../../lib/src/result.js';
import type { TableDefs } from '../../lib/src/types.js';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * A StandardSchema that rejects rows without a string `name`, with lines-db metadata attached.
 * Written without imports so the schema file loads from any directory.
 */
function schemaSource(options: {
  primaryKey?: string;
  requireName?: boolean;
  foreignKeys?: Array<{ column: string; references: { table: string; column: string } }>;
}): string {
  return `
export const schema = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) =>
      ${options.requireName ? "typeof value.name === 'string'" : 'true'}
        ? { value }
        : { issues: [{ message: 'name is required', path: [{ key: 'name' }] }] },
  },
  primaryKey: ${JSON.stringify(options.primaryKey ?? 'id')},
  foreignKeys: ${JSON.stringify(options.foreignKeys ?? [])},
};
`;
}

describe('data sets', () => {
  let rootDir: string;
  let cogsDir: string;

  beforeEach(async () => {
    rootDir = join(__dirname, '.test-tmp', `data-sets-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    cogsDir = join(rootDir, 'cogs');
    await mkdir(cogsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  describe('schemaDir', () => {
    it('validates the rows of a data directory against the schemas in schemaDir', async () => {
      await writeFile(join(rootDir, 'Item.schema.ts'), schemaSource({ requireName: true }));
      await writeFile(join(cogsDir, 'Item.jsonl'), '{"id":1,"name":"Bolt"}\n{"id":2}\n');

      const db = LinesDB.create({ dataDir: cogsDir, schemaDir: rootDir });
      const result = unwrap(await db.initialize({ detailedValidate: true }));
      await db.close();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ file: join(cogsDir, 'Item.jsonl'), tableName: 'Item', rowIndex: 1 });
    });

    it('checks foreign keys declared by the schemas in schemaDir', async () => {
      await writeFile(join(rootDir, 'Item.schema.ts'), schemaSource({}));
      await writeFile(
        join(rootDir, 'ItemValuation.schema.ts'),
        schemaSource({ foreignKeys: [{ column: 'itemId', references: { table: 'Item', column: 'id' } }] }),
      );
      await writeFile(join(cogsDir, 'Item.jsonl'), '{"id":1}\n');
      await writeFile(join(cogsDir, 'ItemValuation.jsonl'), '{"id":1,"itemId":1}\n{"id":2,"itemId":99}\n');

      const db = LinesDB.create({ dataDir: cogsDir, schemaDir: rootDir });
      const result = unwrap(await db.initialize({ detailedValidate: true }));
      await db.close();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        file: join(cogsDir, 'ItemValuation.jsonl'),
        rowIndex: 1,
        foreignKeyError: { column: 'itemId', value: 99, referencedTable: 'Item' },
      });
    });

    it('ignores a schema next to the JSONL file when schemaDir is set', async () => {
      await writeFile(join(cogsDir, 'Item.schema.ts'), schemaSource({ requireName: true }));
      await writeFile(join(cogsDir, 'Item.jsonl'), '{"id":1}\n');

      const db = LinesDB.create({ dataDir: cogsDir, schemaDir: rootDir });
      const result = unwrap(await db.initialize({ detailedValidate: true }));
      await db.close();

      expect(result.valid).toBe(true);
    });
  });

  describe('several data directories', () => {
    beforeEach(async () => {
      await writeFile(join(rootDir, 'Item.schema.ts'), schemaSource({ requireName: true }));
      await writeFile(
        join(rootDir, 'ItemValuation.schema.ts'),
        schemaSource({ foreignKeys: [{ column: 'itemId', references: { table: 'Item', column: 'id' } }] }),
      );
      await writeFile(join(rootDir, 'Item.jsonl'), '{"id":1,"name":"Bolt"}\n{"id":2,"name":"Nut"}\n');
    });

    it('reads the rows of a same-named table from every directory in order', async () => {
      // String ids, so the rowid follows insertion order rather than the id
      await writeFile(join(rootDir, 'Item.jsonl'), '{"id":"b","name":"Bolt"}\n{"id":"n","name":"Nut"}\n');
      await writeFile(join(cogsDir, 'Item.jsonl'), '{"id":"w","name":"Washer"}\n');

      const db = LinesDB.create({ dataDir: [cogsDir, rootDir], schemaDir: rootDir });
      unwrap(await db.initialize());
      const names = unwrap(db.query<{ name: string }>('SELECT name FROM Item ORDER BY rowid')).map((r) => r.name);
      await db.close();

      expect(names).toEqual(['Washer', 'Bolt', 'Nut']);
    });

    it('resolves foreign keys against the rows of every directory', async () => {
      await writeFile(join(cogsDir, 'Item.jsonl'), '{"id":3,"name":"Washer"}\n');
      await writeFile(join(cogsDir, 'ItemValuation.jsonl'), '{"id":1,"itemId":1}\n{"id":2,"itemId":3}\n');

      const db = LinesDB.create({ dataDir: [rootDir, cogsDir], schemaDir: rootDir });
      const result = unwrap(await db.initialize({ detailedValidate: true }));
      await db.close();

      expect(result.errors).toEqual([]);
    });

    it('reports a foreign key error at the line of the file the row came from', async () => {
      await writeFile(join(cogsDir, 'ItemValuation.jsonl'), '{"id":1,"itemId":1}\n{"id":2,"itemId":99}\n');

      const db = LinesDB.create({ dataDir: [rootDir, cogsDir], schemaDir: rootDir });
      const result = unwrap(await db.initialize({ detailedValidate: true }));
      await db.close();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        file: join(cogsDir, 'ItemValuation.jsonl'),
        rowIndex: 1,
        foreignKeyError: { value: 99 },
      });
    });

    it('reports a foreign key checked after a circular dependency at the file the row came from', async () => {
      await writeFile(
        join(rootDir, 'Author.schema.ts'),
        schemaSource({ foreignKeys: [{ column: 'profileId', references: { table: 'Profile', column: 'id' } }] }),
      );
      await writeFile(
        join(rootDir, 'Profile.schema.ts'),
        schemaSource({ foreignKeys: [{ column: 'authorId', references: { table: 'Author', column: 'id' } }] }),
      );
      await writeFile(join(rootDir, 'Author.jsonl'), '{"id":1,"profileId":10}\n');
      await writeFile(join(rootDir, 'Profile.jsonl'), '{"id":10,"authorId":1}\n');
      await writeFile(join(cogsDir, 'Profile.jsonl'), '{"id":20,"authorId":1}\n{"id":30,"authorId":99}\n');

      const db = LinesDB.create({ dataDir: [rootDir, cogsDir], schemaDir: rootDir });
      const result = unwrap(await db.initialize({ tableName: 'Author', detailedValidate: true }));
      await db.close();

      expect(result.errors).toEqual([
        expect.objectContaining({ file: join(cogsDir, 'Profile.jsonl'), tableName: 'Profile', rowIndex: 1 }),
      ]);
    });

    it('reports a schema error at the line of the file the row came from', async () => {
      await writeFile(join(cogsDir, 'Item.jsonl'), '{"id":3,"name":"Washer"}\n{"id":4}\n');

      const db = LinesDB.create({ dataDir: [rootDir, cogsDir], schemaDir: rootDir });
      const result = unwrap(await db.initialize({ detailedValidate: true }));
      await db.close();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ file: join(cogsDir, 'Item.jsonl'), tableName: 'Item', rowIndex: 1 });
    });

    it('reports an id defined in two directories as a violation at the later file', async () => {
      await writeFile(join(cogsDir, 'Item.jsonl'), '{"id":3,"name":"Washer"}\n{"id":2,"name":"Nut again"}\n');

      const db = LinesDB.create({ dataDir: [rootDir, cogsDir], schemaDir: rootDir });
      const result = unwrap(await db.initialize({ detailedValidate: true }));
      await db.close();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ file: join(cogsDir, 'Item.jsonl'), tableName: 'Item', rowIndex: 1 });
      expect(result.errors[0].issues[0].message).toMatch(/UNIQUE constraint failed|PRIMARY KEY/);
    });

    it('reports a JSON parse error with the file and line it occurred in', async () => {
      await writeFile(join(cogsDir, 'Item.jsonl'), '{"id":3,"name":"Washer"}\n\n{broken\n');

      const db = LinesDB.create({ dataDir: [rootDir, cogsDir], schemaDir: rootDir });
      const result = await db.initialize();
      await db.close();

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatchObject({
        name: 'JsonlParseError',
        file: join(cogsDir, 'Item.jsonl'),
        line: 3,
      });
    });

    it('loads a table requested by name from every directory that has it', async () => {
      await writeFile(join(cogsDir, 'Item.jsonl'), '{"id":3,"name":"Washer"}\n');

      const db = LinesDB.create({ dataDir: [rootDir, cogsDir], schemaDir: rootDir });
      const result = unwrap(await db.initialize({ tableName: 'Item' }));
      await db.close();

      expect(result.tableResults).toEqual([expect.objectContaining({ tableName: 'Item', rowCount: 3 })]);
    });

    it('names every data directory when a requested table is in none of them', async () => {
      const db = LinesDB.create({ dataDir: [rootDir, cogsDir], schemaDir: rootDir });
      const result = await db.initialize({ tableName: 'Missing' });
      await db.close();

      expect(!result.ok && result.error.message).toBe(
        `Table 'Missing' not found in directory '${rootDir}', '${cogsDir}'`,
      );
    });

    const readOnlyMessage =
      "Cannot write to table 'Item': dataDir lists several directories, so its rows have no single file to be written back to";

    it('rejects a sync, since a row has no single file to be written back to', async () => {
      const db = LinesDB.create({ dataDir: [rootDir, cogsDir], schemaDir: rootDir });
      unwrap(await db.initialize());
      const result = await db.sync('Item');
      await db.close();

      expect(!result.ok && result.error.message).toBe(readOnlyMessage);
    });

    it.each([
      ['insert', (db: LinesDB<TableDefs>) => db.insert('Item', { id: 5, name: 'Spring' })],
      ['batchInsert', (db: LinesDB<TableDefs>) => db.batchInsert('Item', [{ id: 5, name: 'Spring' }])],
      ['update', (db: LinesDB<TableDefs>) => db.update('Item', { name: 'Spring' }, { id: 1 })],
      ['batchUpdate', (db: LinesDB<TableDefs>) => db.batchUpdate('Item', [{ id: 1, name: 'Spring' }])],
      ['delete', (db: LinesDB<TableDefs>) => db.delete('Item', { id: 1 })],
      ['batchDelete', (db: LinesDB<TableDefs>) => db.batchDelete('Item', [{ id: 1 }])],
    ])('rejects %s without touching the database or the files', async (_, mutate) => {
      const db = LinesDB.create({ dataDir: [rootDir, cogsDir], schemaDir: rootDir });
      unwrap(await db.initialize());
      const result = mutate(db);
      const names = unwrap(db.find('Item')).map((row) => row.name);
      await db.close();

      expect(!result.ok && result.error.message).toBe(readOnlyMessage);
      expect(names).toEqual(['Bolt', 'Nut']);
      expect(await readFile(join(rootDir, 'Item.jsonl'), 'utf-8')).toBe(
        '{"id":1,"name":"Bolt"}\n{"id":2,"name":"Nut"}\n',
      );
    });

    it.each([
      ['execute', (db: LinesDB<TableDefs>) => db.execute('DELETE FROM Item')],
      ['query', (db: LinesDB<TableDefs>) => db.query('DELETE FROM Item RETURNING id')],
    ])('rejects SQL that writes through %s', async (_, write) => {
      const db = LinesDB.create({ dataDir: [rootDir, cogsDir], schemaDir: rootDir });
      unwrap(await db.initialize());
      const result = write(db);
      const count = unwrap(db.find('Item')).length;
      await db.close();

      expect(!result.ok && result.error.message).toMatch(/readonly database/);
      expect(count).toBe(2);
    });

    it('runs a transaction that only reads', async () => {
      const db = LinesDB.create({ dataDir: [rootDir, cogsDir], schemaDir: rootDir });
      unwrap(await db.initialize());
      const result = await db.transaction((tx) => unwrap(tx.find('Item')).length);
      await db.close();

      expect(unwrap(result)).toBe(2);
    });

    it('looks for a schema next to each of the table files when schemaDir is unset', async () => {
      await writeFile(join(cogsDir, 'Part.schema.ts'), schemaSource({ requireName: true }));
      await writeFile(join(rootDir, 'Part.jsonl'), '{"id":1,"name":"Gear"}\n');
      await writeFile(join(cogsDir, 'Part.jsonl'), '{"id":2}\n');

      const db = LinesDB.create({ dataDir: [rootDir, cogsDir] });
      const result = unwrap(await db.initialize({ tableName: 'Part', detailedValidate: true }));
      await db.close();

      expect(result.errors).toEqual([expect.objectContaining({ file: join(cogsDir, 'Part.jsonl'), rowIndex: 0 })]);
    });
  });
});
