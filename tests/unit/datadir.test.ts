import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { LinesDB, TypeGenerator } from 'lines-db';
import type { DatabaseConfig, TableDefs } from 'lines-db';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, rm, cp } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('LinesDB dataDir auto-discovery', () => {
  let db: LinesDB<TableDefs>;
  let testDir: string;
  let config: DatabaseConfig;

  function createDb() {
    return LinesDB.create(config);
  }

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
    // Clean up environment variable
    delete process.env.LINES_DB_TEST_PROJECT_ROOT;
  });

  describe('directory scanning', () => {
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

    it('should auto-discover all JSONL files in dataDir', () => {
      const tableNames = db.getTableNames();

      // Should find users.jsonl, products.jsonl, orders.jsonl, customers.jsonl, orders-with-fk.jsonl, test-migrate.jsonl, and error-output.jsonl
      expect(tableNames.includes('users')).toBeTruthy();
      expect(tableNames.includes('products')).toBeTruthy();
      expect(tableNames.includes('orders')).toBeTruthy();
      expect(tableNames.includes('customers')).toBeTruthy();
      expect(tableNames.includes('orders-with-fk')).toBeTruthy();
      expect(tableNames.length).toBe(7);
    });

    it('should load data from all discovered tables', () => {
      const users = db.find('users');
      const products = db.find('products');
      const orders = db.find('orders');

      expect(users.length).toBe(3);
      expect(products.length).toBe(3);
      expect(orders.length).toBe(3);
    });

    it('should auto-load validation schemas from dataDir', () => {
      // Validation schema should be automatically loaded
      // Valid insert should succeed
      const result = db.insert('users', {
        id: 100,
        name: 'Test User',
        age: 25,
        email: 'test@example.com',
      });
      expect(result.changes).toBe(1);

      // Invalid insert should throw
      expect(() => {
        db.insert('users', {
          id: 101,
          name: '',
          age: 30,
          email: 'invalid-email',
        });
      }).toThrow();
    });
  });

  describe('error handling', () => {
    it('should throw error when dataDir does not exist', async () => {
      const invalidConfig: DatabaseConfig = {
        dataDir: join(__dirname, 'nonexistent'),
      };

      const testDb = LinesDB.create(invalidConfig);

      await expect(testDb.initialize()).rejects.toThrow('Failed to scan directory');
    });
  });
});
