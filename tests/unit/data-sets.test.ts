import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LinesDB } from '../../lib/src/database.js';
import { unwrap } from '../../lib/src/result.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
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
});
