import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LinesDB } from '../../lib/src/database.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Undefined value handling in schema inference', () => {
  const testDir = join(
    __dirname,
    '.test-tmp',
    `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  );
  const dataPath = join(testDir, 'TestTable.jsonl');
  const schemaPath = join(testDir, 'TestTable.schema.ts');

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });

    // Create JSONL file with data that will have undefined values after validation
    await writeFile(
      dataPath,
      `{"name":"Alice","age":30}
{"name":"Bob","age":25}`,
    );

    // Create schema that adds an optional field with undefined value
    await writeFile(
      schemaPath,
      `import { defineSchema } from '@toiroakr/lines-db';

export const schema = defineSchema(
  {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (data) => {
        // Add optionalField with undefined value
        const value = {
          ...(typeof data === 'object' && data !== null ? data : {}),
          optionalField: undefined,
        };
        return { value };
      },
    },
  },
);
`,
    );
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should handle undefined values in schema inference', async () => {
    const db = LinesDB.create({ dataDir: testDir });
    await db.initialize();

    const schema = db.getSchema('TestTable');
    expect(schema).toBeDefined();

    // When all values are undefined (converted to null), the column is created with NULL type
    const optionalFieldColumn = schema?.columns.find((col) => col.name === 'optionalField');
    expect(optionalFieldColumn).toBeDefined();
    expect(optionalFieldColumn?.type).toBe('NULL');
    expect(optionalFieldColumn?.notNull).toBe(false);

    await db.close();
  });

  it('should successfully insert and query data with undefined fields', async () => {
    const db = LinesDB.create({ dataDir: testDir });
    await db.initialize();

    const rows = db.find('TestTable');
    expect(rows).toHaveLength(2);

    // All rows should have name, age, and optionalField
    // undefined values are converted to null in the database
    for (const row of rows) {
      expect(row).toHaveProperty('name');
      expect(row).toHaveProperty('age');
      expect(row).toHaveProperty('optionalField');
      expect(row.optionalField).toBeNull();
    }

    await db.close();
  });
});
