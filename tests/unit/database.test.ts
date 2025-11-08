import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import {
  LinesDB,
  TypeGenerator,
  type DatabaseConfig,
  type ColumnDefinition,
  type TableDefs,
} from '@toiroakr/lines-db';
import { join } from 'node:path';
import { mkdir, rm, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define User type for testing
interface User {
  id: number;
  name: string;
  age: number;
  email: string;
}

describe('LinesDB', () => {
  let db: LinesDB<TableDefs>;
  let testDir: string;
  let config: DatabaseConfig;

  function createDb() {
    return LinesDB.create(config);
  }

  beforeEach(async () => {
    // Create test directory in tests/unit/.test-tmp/
    const testTmpDir = join(__dirname, '.test-tmp');
    await mkdir(testTmpDir, { recursive: true });

    testDir = join(testTmpDir, `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    await mkdir(testDir);

    // Copy fixtures to test directory
    const fixturesDir = join(__dirname, './fixtures');
    await cp(fixturesDir, testDir, { recursive: true });

    // Set environment variable for testing (projectRoot = empty string)
    process.env.LINES_DB_TEST_PROJECT_ROOT = '';

    // Generate type definitions
    const generator = new TypeGenerator({ dataDir: testDir });
    await generator.generate();

    config = {
      dataDir: testDir,
    };

    db = createDb();
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
    // Clean up environment variable
    delete process.env.LINES_DB_TEST_PROJECT_ROOT;
  });

  describe('initialization', () => {
    it('should load all tables', () => {
      const tableNames = db.getTableNames();
      expect(tableNames.includes('users')).toBeTruthy();
      expect(tableNames.includes('products')).toBeTruthy();
    });

    it('should infer schema correctly', () => {
      const userSchema = db.getSchema('users');
      expect(userSchema).toBeTruthy();
      expect(userSchema?.name).toBe('users');
      expect(userSchema?.columns.length).toBe(4);

      const idColumn = userSchema?.columns.find((col: ColumnDefinition) => col.name === 'id');
      expect(idColumn?.type).toBe('INTEGER');
      expect(idColumn?.primaryKey).toBe(true);
    });
  });

  describe('find without where', () => {
    it('should return all rows from a table', () => {
      const users = db.find('users');
      expect(users.length).toBe(3);
    });

    it('should return correct data', () => {
      const users = db.find('users');
      // Type inference test skipped when using LinesDB<any>
      // expectTypeOf(users).toEqualTypeOf<User[]>();
      expect(users[0].id).toBe(1);
      expect(users[0].name).toBe('Alice');
      expect(users[0].age).toBe(30);
      expect(users[0].email).toBe('alice@example.com');
    });
  });

  describe('find', () => {
    it('should find rows by single condition', () => {
      const result = db.find('users', { name: 'Bob' });
      // Type inference test skipped when using LinesDB<any>
      // expectTypeOf(result).toEqualTypeOf<User[]>();
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Bob');
      expect(result[0].age).toBe(25);
    });

    it('should find rows by multiple conditions', () => {
      const result = db.find('users', { name: 'Alice', age: 30 });
      expect(result.length).toBe(1);
      expect(result[0].email).toBe('alice@example.com');
    });

    it('should return empty array when no match', () => {
      const result = db.find('users', { name: 'NonExistent' });
      expect(result.length).toBe(0);
    });
  });

  describe('findOne', () => {
    it('should find a single row', () => {
      const result = db.findOne('users', { id: 2 });
      // Type inference test skipped when using LinesDB<any>
      // expectTypeOf(result).toEqualTypeOf<User | null>();
      expect(result).toBeTruthy();
      expect(result?.name).toBe('Bob');
    });

    it('should return null when no match', () => {
      const result = db.findOne('users', { id: 999 });
      expect(result).toBeNull();
    });
  });

  describe('query', () => {
    it('should execute custom SQL queries', () => {
      const result = db.query<User>('SELECT * FROM users WHERE age > ?', [25]);
      expect(result.length).toBe(2);
      expect(result.map((u: User) => u.name).includes('Alice')).toBeTruthy();
      expect(result.map((u: User) => u.name).includes('Charlie')).toBeTruthy();
    });

    it('should handle COUNT queries', () => {
      const result = db.query<{ count: number }>('SELECT COUNT(*) as count FROM users');
      expect(result[0].count).toBe(3);
    });
  });

  describe('queryOne', () => {
    it('should return single row', () => {
      interface CountResult {
        count: number;
      }

      const result = db.queryOne<CountResult>('SELECT COUNT(*) as count FROM users');
      expect(result?.count).toBe(3);
    });
  });

  describe('execute', () => {
    it('should execute INSERT statements', () => {
      const result = db.execute('INSERT INTO users (id, name, age, email) VALUES (?, ?, ?, ?)', [
        4,
        'David',
        40,
        'david@example.com',
      ]);

      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBe(4);

      const users = db.find('users');
      expect(users.length).toBe(4);
    });

    it('should execute UPDATE statements', () => {
      const result = db.execute('UPDATE users SET age = ? WHERE name = ?', [31, 'Alice']);

      expect(result.changes).toBe(1);

      const alice = db.findOne('users', { name: 'Alice' });
      expect(alice?.age).toBe(31);
    });

    it('should execute DELETE statements', () => {
      const result = db.execute('DELETE FROM users WHERE id = ?', [3]);

      expect(result.changes).toBe(1);

      const users = db.find('users');
      expect(users.length).toBe(2);
    });
  });

  describe('boolean handling', () => {
    it('should handle boolean values correctly', () => {
      const products = db.find('products');
      // Schema transforms 0/1 to boolean, so expect boolean values
      expect(products[0].inStock).toBe(true);
      expect(products[2].inStock).toBe(false);
    });
  });
});
