import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LinesDB } from './database.js';
import type { DatabaseConfig } from './types.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('LinesDB', () => {
  let testDir: string;
  const GENERIC_SCHEMA_SOURCE = `import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';

const rawSchema = v.record(v.string(), v.unknown());

export const schema = defineSchema(rawSchema);
`;

  const writeTable = async (tableName: string, contents: string) => {
    await writeFile(join(testDir, `${tableName}.jsonl`), contents);
    await writeFile(join(testDir, `${tableName}.schema.ts`), GENERIC_SCHEMA_SOURCE);
  };

  beforeEach(async () => {
    testDir = join(tmpdir(), `linesdb-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('should create and initialize database', async () => {
      await writeTable('users', '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n');

      type Tables = {
        users: { id: number; name: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const tables = db.getTableNames();
      expect(tables).toContain('users');

      await db.close();
    });

    it('should load table with .schema.mts schema file', async () => {
      await writeFile(join(testDir, 'users.jsonl'), '{"id":1,"name":"Alice"}\n');
      await writeFile(join(testDir, 'users.schema.mts'), GENERIC_SCHEMA_SOURCE);

      const config: DatabaseConfig = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const tables = db.getTableNames();
      expect(tables).toContain('users');

      await db.close();
    });

    it('should load table with .schema.cts schema file', async () => {
      await writeFile(join(testDir, 'users.jsonl'), '{"id":1,"name":"Alice"}\n');
      await writeFile(join(testDir, 'users.schema.cts'), GENERIC_SCHEMA_SOURCE);

      const config: DatabaseConfig = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const tables = db.getTableNames();
      expect(tables).toContain('users');

      await db.close();
    });

    it('should load multiple tables', async () => {
      await writeTable('users', '{"id":1}\n');
      await writeTable('products', '{"id":1}\n');

      type Tables = {
        users: { id: number };
        products: { id: number };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const tableNames = db.getTableNames();
      expect(tableNames).toHaveLength(2);
      expect(tableNames).toContain('users');
      expect(tableNames).toContain('products');

      await db.close();
    });

    it('should infer schema from data', async () => {
      await writeTable('users', '{"id":1,"name":"Alice","age":30}\n');

      type Tables = {
        users: { id: number; name: string; age: number };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const schema = db.getSchema('users');
      expect(schema).toBeDefined();
      expect(schema?.name).toBe('users');
      expect(schema?.columns).toHaveLength(3);

      await db.close();
    });
  });

  describe('query operations', () => {
    it('should select all rows', async () => {
      await writeTable('users', '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n');

      type Tables = {
        users: { id: number; name: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const users = db.find('users');
      expect(users).toHaveLength(2);
      expect(users[0]).toEqual({ id: 1, name: 'Alice' });
      expect(users[1]).toEqual({ id: 2, name: 'Bob' });

      await db.close();
    });

    it('should find rows by condition', async () => {
      await writeTable('users', '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n{"id":3,"name":"Alice"}\n');

      type Tables = {
        users: { id: number; name: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const alices = db.find('users', { name: 'Alice' });
      expect(alices).toHaveLength(2);
      expect(alices[0].id).toBe(1);
      expect(alices[1].id).toBe(3);

      await db.close();
    });

    it('should find single row', async () => {
      await writeTable('users', '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n');

      type Tables = {
        users: { id: number; name: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const user = db.findOne('users', { id: 2 });
      expect(user).toEqual({ id: 2, name: 'Bob' });

      await db.close();
    });

    it('should return null when row not found', async () => {
      await writeTable('users', '{"id":1,"name":"Alice"}\n');

      type Tables = {
        users: { id: number; name: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const user = db.findOne('users', { id: 999 });
      expect(user).toBeNull();

      await db.close();
    });
  });

  describe('insert operations', () => {
    it('should insert new row', async () => {
      await writeTable('users', '{"id":1,"name":"Alice"}\n');

      type Tables = {
        users: { id: number; name: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const result = db.insert('users', { id: 2, name: 'Bob' });
      expect(result.changes).toBe(1);

      const users = db.find('users');
      expect(users).toHaveLength(2);

      await db.close();
    });

    it('should validate on insert when schema exists', async () => {
      await writeFile(join(testDir, 'users.jsonl'), '{"id":1,"name":"Alice"}\n');
      await writeFile(
        join(testDir, 'users.schema.ts'),
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'test',
            validate: (data) => {
              const issues = [];
              if (!data.name || data.name.length === 0) {
                issues.push({ message: 'Name is required' });
              }
              return { value: data, issues };
            }
          }
        };
      `,
      );

      type Tables = {
        users: { id: number; name: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      expect(() => {
        db.insert('users', { id: 2, name: '' });
      }).toThrow(/Validation/);

      await db.close();
    });

    it('should batch insert rows', async () => {
      await writeTable('users', '{"id":1,"name":"Alice"}\n');

      type Tables = {
        users: { id: number; name: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const result = db.batchInsert('users', [
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Carol' },
      ]);

      expect(result.changes).toBe(2n);

      const users = db.find('users');
      expect(users).toHaveLength(3);
      expect(users.map((u) => u.name).sort()).toEqual(['Alice', 'Bob', 'Carol']);

      await db.close();
    });
  });

  describe('update operations', () => {
    it('should update existing rows', async () => {
      await writeTable('users', '{"id":1,"name":"Alice","age":30}\n{"id":2,"name":"Bob","age":25}\n');

      type Tables = {
        users: { id: number; name: string; age: number };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const result = db.update('users', { age: 31 }, { id: 1 });
      expect(result.changes).toBe(1);

      const user = db.findOne('users', { id: 1 });
      expect(user?.age).toBe(31);

      await db.close();
    });

    it('should update multiple rows', async () => {
      await writeTable('users', '{"id":1,"name":"Alice","active":true}\n{"id":2,"name":"Bob","active":true}\n');

      type Tables = {
        users: { id: number; name: string; active: boolean };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const result = db.update('users', { active: false }, { active: true });
      expect(result.changes).toBe(2);

      await db.close();
    });

    it('should batch update rows with distinct values', async () => {
      await writeTable('users', '{"id":1,"name":"Alice","age":30}\n{"id":2,"name":"Bob","age":25}\n');

      type Tables = {
        users: { id: number; name: string; age: number };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const result = db.batchUpdate('users', [
        { id: 1, age: 31 },
        { id: 2, age: 27 },
      ]);
      expect(result.changes).toBe(2n);

      const users = db.find('users');
      const alice = users.find((u) => u.id === 1);
      const bob = users.find((u) => u.id === 2);
      expect(alice?.age).toBe(31);
      expect(bob?.age).toBe(27);

      await db.close();
    });
  });

  describe('delete operations', () => {
    it('should delete rows', async () => {
      await writeTable('users', '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n');

      type Tables = {
        users: { id: number; name: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const result = db.delete('users', { id: 1 });
      expect(result.changes).toBe(1);

      const users = db.find('users');
      expect(users).toHaveLength(1);
      expect(users[0].id).toBe(2);

      await db.close();
    });

    it('should delete multiple rows', async () => {
      await writeTable('users', '{"id":1,"name":"Alice"}\n{"id":2,"name":"Alice"}\n{"id":3,"name":"Bob"}\n');

      type Tables = {
        users: { id: number; name: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const result = db.delete('users', { name: 'Alice' });
      expect(result.changes).toBe(2);

      const users = db.find('users');
      expect(users).toHaveLength(1);

      await db.close();
    });

    it('should batch delete rows by primary key', async () => {
      await writeTable('users', '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n{"id":3,"name":"Carol"}\n');

      type Tables = {
        users: { id: number; name: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const result = db.batchDelete('users', [{ id: 1 }, { id: 3 }]);
      expect(result.changes).toBe(2n);

      const users = db.find('users');
      expect(users).toHaveLength(1);
      expect(users[0].id).toBe(2);

      await db.close();
    });
  });

  describe('JSON columns', () => {
    it('should handle JSON objects', async () => {
      await writeTable('records', '{"id":1,"data":{"key":"value"}}\n');

      type Tables = {
        records: { id: number; data: { key: string } };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const records = db.find('records');
      expect(records[0].data).toEqual({ key: 'value' });

      await db.close();
    });

    it('should handle JSON arrays', async () => {
      await writeTable('records', '{"id":1,"tags":["a","b","c"]}\n');

      type Tables = {
        records: { id: number; tags: string[] };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const records = db.find('records');
      expect(records[0].tags).toEqual(['a', 'b', 'c']);

      await db.close();
    });

    it('should insert JSON columns', async () => {
      await writeTable('records', '{"id":1,"data":{}}\n');

      type Tables = {
        records: { id: number; data: { key: string } };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      db.insert('records', { id: 2, data: { key: 'new value' } });

      const record = db.findOne('records', { id: 2 });
      expect(record?.data).toEqual({ key: 'new value' });

      await db.close();
    });
  });

  describe('raw SQL queries', () => {
    it('should execute raw queries', async () => {
      await writeFile(join(testDir, 'users.jsonl'), '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n');

      type Tables = {
        users: { id: number; name: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const result = db.query<{ id: number; name: string }>('SELECT * FROM users WHERE id > ?', [1]);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Bob');

      await db.close();
    });

    it('should execute queryOne', async () => {
      await writeTable('users', '{"id":1,"name":"Alice"}\n');

      type Tables = {
        users: { id: number; name: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      await db.initialize();

      const result = db.queryOne<{ name: string }>('SELECT name FROM users WHERE id = ?', [1]);

      expect(result?.name).toBe('Alice');

      await db.close();
    });
  });

  describe('circular foreign key validation', () => {
    const writeSchemaWithFK = async (
      tableName: string,
      primaryKey: string,
      foreignKeys: Array<{ column: string; references: { table: string; column: string } }>,
      uniqueColumns: string[] = [],
    ) => {
      const fkJson = JSON.stringify(foreignKeys);
      const indexDefs = uniqueColumns
        .map((col) => `{ name: "${tableName}_${col}_idx", columns: ["${col}"], unique: true }`)
        .join(', ');
      const indexesLine = uniqueColumns.length > 0 ? `indexes: [${indexDefs}],` : '';
      // Use inline StandardSchema without external imports (dynamic import from /tmp can't resolve npm packages)
      const source = `
const baseSchema = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => ({ value })
  }
};

export const schema = Object.assign(Object.create(baseSchema), {
  '~standard': baseSchema['~standard'],
  primaryKey: "${primaryKey}",
  foreignKeys: ${fkJson},
  ${indexesLine}
});
`;
      await writeFile(join(testDir, `${tableName}.schema.ts`), source);
    };

    it('should validate circular foreign keys after all tables are loaded', async () => {
      // authors and profiles reference each other bidirectionally
      await writeFile(
        join(testDir, 'authors.jsonl'),
        '{"id":"1","name":"Alice","profile_code":"a-001"}\n{"id":"2","name":"Bob","profile_code":"b-001"}\n',
      );
      await writeSchemaWithFK(
        'authors',
        'id',
        [{ column: 'profile_code', references: { table: 'profiles', column: 'code' } }],
        ['profile_code'],
      );

      await writeFile(
        join(testDir, 'profiles.jsonl'),
        '{"code":"a-001","author_id":"1","bio":"Author A"}\n{"code":"b-001","author_id":"2","bio":"Author B"}\n',
      );
      await writeSchemaWithFK(
        'profiles',
        'code',
        [{ column: 'author_id', references: { table: 'authors', column: 'id' } }],
        ['code'],
      );

      type Tables = {
        authors: { id: string; name: string; profile_code: string };
        profiles: { code: string; author_id: string; bio: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      const result = await db.initialize({ detailedValidate: true });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);

      await db.close();
    });

    it('should detect orphan in authors (no matching profile)', async () => {
      await writeFile(
        join(testDir, 'authors.jsonl'),
        '{"id":"1","name":"Alice","profile_code":"a-001"}\n{"id":"2","name":"Orphan","profile_code":"missing"}\n',
      );
      await writeSchemaWithFK(
        'authors',
        'id',
        [{ column: 'profile_code', references: { table: 'profiles', column: 'code' } }],
        ['profile_code'],
      );

      await writeFile(join(testDir, 'profiles.jsonl'), '{"code":"a-001","author_id":"1","bio":"Author A"}\n');
      await writeSchemaWithFK(
        'profiles',
        'code',
        [{ column: 'author_id', references: { table: 'authors', column: 'id' } }],
        ['code'],
      );

      type Tables = {
        authors: { id: string; name: string; profile_code: string };
        profiles: { code: string; author_id: string; bio: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      const result = await db.initialize({ detailedValidate: true });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].foreignKeyError).toMatchObject({
        column: 'profile_code',
        value: 'missing',
        referencedTable: 'profiles',
        referencedColumn: 'code',
      });

      await db.close();
    });

    it('should detect orphan in profiles (no matching author)', async () => {
      await writeFile(join(testDir, 'authors.jsonl'), '{"id":"1","name":"Alice","profile_code":"a-001"}\n');
      await writeSchemaWithFK(
        'authors',
        'id',
        [{ column: 'profile_code', references: { table: 'profiles', column: 'code' } }],
        ['profile_code'],
      );

      await writeFile(
        join(testDir, 'profiles.jsonl'),
        '{"code":"a-001","author_id":"1","bio":"Author A"}\n{"code":"x-999","author_id":"999","bio":"Orphan"}\n',
      );
      await writeSchemaWithFK(
        'profiles',
        'code',
        [{ column: 'author_id', references: { table: 'authors', column: 'id' } }],
        ['code'],
      );

      type Tables = {
        authors: { id: string; name: string; profile_code: string };
        profiles: { code: string; author_id: string; bio: string };
      };

      const config: DatabaseConfig<Tables> = { dataDir: testDir };
      const db = LinesDB.create(config);
      const result = await db.initialize({ detailedValidate: true });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].foreignKeyError).toMatchObject({
        column: 'author_id',
        value: '999',
        referencedTable: 'authors',
        referencedColumn: 'id',
      });

      await db.close();
    });
  });
});
