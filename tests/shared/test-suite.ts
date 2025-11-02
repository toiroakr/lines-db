/**
 * Common test suite that can be run across different runtimes
 * This file exports test functions that accept test runner primitives
 */

export interface TestRunner {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<void>) => void;
  beforeEach: (fn: () => void | Promise<void>) => void;
  afterEach: (fn: () => void | Promise<void>) => void;
  expect: {
    (actual: any): {
      toBe: (expected: any) => void;
      toEqual: (expected: any) => void;
      toBeTruthy: () => void;
      toBeFalsy: () => void;
      toBeNull: () => void;
      toBeGreaterThan: (expected: number) => void;
      toContain: (expected: any) => void;
      toHaveLength: (expected: number) => void;
    };
  };
}

export function runDatabaseTests(runner: TestRunner, createDb: () => any | Promise<any>) {
  const { describe, it, beforeEach, afterEach, expect } = runner;

  // Shared db instance (used when beforeEach is supported)
  let sharedDb: any;

  // Setup beforeEach if supported
  beforeEach(async () => {
    sharedDb = await createDb();
    await sharedDb.initialize();
  });

  // Setup afterEach if supported
  afterEach(async () => {
    if (sharedDb) {
      await sharedDb.close();
    }
  });

  // Helper to get db - creates new one if sharedDb not available (no beforeEach support)
  const getDb = async () => {
    if (sharedDb) {
      return sharedDb;
    }
    // If beforeEach didn't run, create a new one
    const testDb = await createDb();
    await testDb.initialize();
    return testDb;
  };

  const closeDb = async (testDb: any) => {
    // Only close if it's not the shared instance
    if (testDb !== sharedDb) {
      await testDb.close();
    }
  };

  describe('LinesDB', () => {
    describe('initialization', () => {
      it('should load all tables', async () => {
        const testDb = await getDb();
        const tableNames = testDb.getTableNames();
        expect(tableNames).toContain('users');
        expect(tableNames).toContain('products');
        await closeDb(testDb);
      });

      it('should infer schema correctly', async () => {
        const testDb = await getDb();
        const userSchema = testDb.getSchema('users');
        expect(userSchema).toBeTruthy();
        expect(userSchema?.name).toBe('users');
        expect(userSchema?.columns).toHaveLength(4);

        const idColumn = userSchema?.columns.find((col: any) => col.name === 'id');
        expect(idColumn?.type).toBe('INTEGER');
        expect(idColumn?.primaryKey).toBe(true);
        await closeDb(testDb);
      });
    });

    describe('find without where', () => {
      it('should return all rows from a table', async () => {
        const testDb = await getDb();
        const users = testDb.find('users');
        expect(users).toHaveLength(3);
        await closeDb(testDb);
      });

      it('should return correct data', async () => {
        const testDb = await getDb();
        const users = testDb.find('users');
        expect(users[0].id).toBe(1);
        expect(users[0].name).toBe('Alice');
        expect(users[0].age).toBe(30);
        expect(users[0].email).toBe('alice@example.com');
        await closeDb(testDb);
      });
    });

    describe('find', () => {
      it('should find rows by single condition', async () => {
        const testDb = await getDb();
        const result = testDb.find('users', { name: 'Bob' });
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Bob');
        expect(result[0].age).toBe(25);
        await closeDb(testDb);
      });

      it('should find rows by multiple conditions', async () => {
        const testDb = await getDb();
        const result = testDb.find('users', { name: 'Alice', age: 30 });
        expect(result).toHaveLength(1);
        expect(result[0].email).toBe('alice@example.com');
        await closeDb(testDb);
      });

      it('should return empty array when no match', async () => {
        const testDb = await getDb();
        const result = testDb.find('users', { name: 'NonExistent' });
        expect(result).toHaveLength(0);
        await closeDb(testDb);
      });
    });

    describe('findOne', () => {
      it('should find a single row', async () => {
        const testDb = await getDb();
        const result = testDb.findOne('users', { id: 2 });
        expect(result).toBeTruthy();
        expect(result?.name).toBe('Bob');
        await closeDb(testDb);
      });

      it('should return null when no match', async () => {
        const testDb = await getDb();
        const result = testDb.findOne('users', { id: 999 });
        expect(result).toBeNull();
        await closeDb(testDb);
      });
    });

    describe('query', () => {
      it('should execute custom SQL queries', async () => {
        const testDb = await getDb();
        const result = testDb.query('SELECT * FROM users WHERE age > ?', [25]);
        expect(result).toHaveLength(2);
        const names = result.map((u: any) => u.name);
        expect(names).toContain('Alice');
        expect(names).toContain('Charlie');
        await closeDb(testDb);
      });

      it('should handle COUNT queries', async () => {
        const testDb = await getDb();
        const result = testDb.query('SELECT COUNT(*) as count FROM users');
        expect(result[0].count).toBe(3);
        await closeDb(testDb);
      });
    });

    describe('queryOne', () => {
      it('should return single row', async () => {
        const testDb = await getDb();
        const result = testDb.queryOne('SELECT COUNT(*) as count FROM users');
        expect(result?.count).toBe(3);
        await closeDb(testDb);
      });
    });

    describe('execute', () => {
      it('should execute INSERT statements', async () => {
        const testDb = await getDb();
        const result = testDb.execute(
          'INSERT INTO users (id, name, age, email) VALUES (?, ?, ?, ?)',
          [4, 'David', 40, 'david@example.com'],
        );

        expect(result.changes).toBe(1);

        const users = testDb.find('users');
        expect(users).toHaveLength(4);
        await closeDb(testDb);
      });

      it('should execute UPDATE statements', async () => {
        const testDb = await getDb();
        const result = testDb.execute('UPDATE users SET age = ? WHERE name = ?', [31, 'Alice']);

        expect(result.changes).toBe(1);

        const alice = testDb.findOne('users', { name: 'Alice' });
        expect(alice?.age).toBe(31);
        await closeDb(testDb);
      });

      it('should execute DELETE statements', async () => {
        const testDb = await getDb();
        const result = testDb.execute('DELETE FROM users WHERE id = ?', [3]);

        expect(result.changes).toBe(1);

        const users = testDb.find('users');
        expect(users).toHaveLength(2);
        await closeDb(testDb);
      });
    });

    describe('boolean handling', () => {
      it('should handle boolean values correctly', async () => {
        const testDb = await getDb();
        const products = testDb.find('products');
        expect(products[0].inStock).toBe(1);
        expect(products[2].inStock).toBe(0);
        await closeDb(testDb);
      });
    });
  });
}
