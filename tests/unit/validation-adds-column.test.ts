import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LinesDB } from '../../lib/src/database.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Validation adds column (e.g., auto-generated ID)', () => {
  const testDir = join(
    __dirname,
    '.test-tmp',
    `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  );
  const dataPath = join(testDir, 'User.jsonl');
  const schemaPath = join(testDir, 'User.schema.ts');

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });

    // Create JSONL file without id column
    await writeFile(
      dataPath,
      `{"name":"John","email":"john@example.com"}
{"name":"Jane","email":"jane@example.com"}`,
    );

    // Create schema that adds id column during validation
    await writeFile(
      schemaPath,
      `import { defineSchema } from '@toiroakr/lines-db';

export const schema = defineSchema(
  {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (data) => {
        // Add id field during validation
        const value = {
          id: crypto.randomUUID(),
          ...(typeof data === 'object' && data !== null ? data : {}),
        };
        return { value };
      },
    },
    primaryKey: ['id'],
  },
);
`,
    );
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should infer schema from validated data with added columns', async () => {
    const db = LinesDB.create({ dataDir: testDir });
    await db.initialize();

    const schema = db.getSchema('User');
    expect(schema).toBeDefined();
    expect(schema?.columns.some((col) => col.name === 'id')).toBe(true);
    expect(schema?.columns.some((col) => col.name === 'name')).toBe(true);
    expect(schema?.columns.some((col) => col.name === 'email')).toBe(true);

    // Check that id is marked as primary key
    const idColumn = schema?.columns.find((col) => col.name === 'id');
    expect(idColumn?.primaryKey).toBe(true);

    await db.close();
  });

  it('should insert data with auto-generated id', async () => {
    const db = LinesDB.create({ dataDir: testDir });
    await db.initialize();

    const users = db.find('User');
    expect(users).toHaveLength(2);

    // All users should have an id
    for (const user of users) {
      expect(user).toHaveProperty('id');
      expect(typeof (user as { id: unknown }).id).toBe('string');
      expect((user as { id: string }).id.length).toBeGreaterThan(0);
    }

    await db.close();
  });

  it('should allow batchUpdate with primary key', async () => {
    const db = LinesDB.create({ dataDir: testDir });
    await db.initialize();

    const users = db.find('User');
    expect(users).toHaveLength(2);

    // Update all users
    const updates = users.map((user) => ({
      id: (user as { id: string }).id,
      name: `${user.name} Updated`,
    }));

    const result = db.batchUpdate('User', updates);
    expect(Number(result.changes)).toBe(2);

    // Verify updates
    const updatedUsers = db.find('User');
    for (const user of updatedUsers) {
      expect(user.name).toContain('Updated');
    }

    await db.close();
  });
});
