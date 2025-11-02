import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { LinesDB, TypeGenerator, type DatabaseConfig, type TableDefs } from 'lines-db';
import type { ValidationError } from 'lines-db';
import { join } from 'node:path';
import { mkdir, rm, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('LinesDB Validation', () => {
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

  describe('insert with validation', () => {
    it('should insert valid data', () => {
      const result = db.insert('users', {
        id: 10,
        name: 'Eve',
        age: 28,
        email: 'eve@example.com',
      });

      expect(result.changes).toBe(1);
      const user = db.findOne('users', { id: 10 });
      expect(user).toBeTruthy();
    });

    it('should reject invalid email', () => {
      try {
        db.insert('users', {
          id: 11,
          name: 'Frank',
          age: 30,
          email: 'not-an-email',
        });
        expect.fail('Should have thrown ValidationError');
      } catch (error) {
        const validationError = error as ValidationError;
        expect(validationError.name).toBe('ValidationError');
        expect(validationError.issues.length).toBeGreaterThan(0);
      }
    });

    it('should reject negative age', () => {
      try {
        db.insert('users', {
          id: 12,
          name: 'Grace',
          age: -5,
          email: 'grace@example.com',
        });
        expect.fail('Should have thrown ValidationError');
      } catch (error) {
        const validationError = error as ValidationError;
        expect(validationError.name).toBe('ValidationError');
        expect(validationError.issues.length).toBeGreaterThan(0);
      }
    });

    it('should reject age over 150', () => {
      try {
        db.insert('users', {
          id: 13,
          name: 'Henry',
          age: 200,
          email: 'henry@example.com',
        });
        expect.fail('Should have thrown ValidationError');
      } catch (error) {
        const validationError = error as ValidationError;
        expect(validationError.name).toBe('ValidationError');
        expect(validationError.issues.length).toBeGreaterThan(0);
      }
    });

    it('should reject empty name', () => {
      try {
        db.insert('users', {
          id: 14,
          name: '',
          age: 25,
          email: 'test@example.com',
        });
        expect.fail('Should have thrown ValidationError');
      } catch (error) {
        const validationError = error as ValidationError;
        expect(validationError.name).toBe('ValidationError');
        expect(validationError.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('update', () => {
    it('should update with partial data', () => {
      const result = db.update('users', { age: 31 }, { id: 1 });

      expect(result.changes).toBe(1);

      const user = db.findOne('users', { id: 1 });
      expect(user?.age).toBe(31);
    });

    it('should allow any update data (validation is skipped)', () => {
      // Note: UPDATE operations skip validation to allow partial updates
      const result = db.update('users', { email: 'newemail@example.com' }, { id: 1 });

      expect(result.changes).toBe(1);
    });
  });

  describe('delete', () => {
    it('should delete rows', () => {
      const result = db.delete('users', { id: 3 });
      expect(result.changes).toBe(1);

      const user = db.findOne('users', { id: 3 });
      expect(user).toBeNull();
    });

    it('should delete multiple rows with same condition', () => {
      // Insert multiple users with same age
      db.insert('users', {
        id: 20,
        name: 'Test1',
        age: 99,
        email: 'test1@example.com',
      });
      db.insert('users', {
        id: 21,
        name: 'Test2',
        age: 99,
        email: 'test2@example.com',
      });

      const result = db.delete('users', { age: 99 });
      expect(result.changes).toBe(2);
    });
  });

  describe('products validation', () => {
    it('should insert valid product', () => {
      const result = db.insert('products', {
        id: 10,
        name: 'Monitor',
        price: 299.99,
        inStock: true,
      });

      expect(result.changes).toBe(1);
    });

    it('should reject negative price', () => {
      try {
        db.insert('products', {
          id: 11,
          name: 'Invalid Product',
          price: -10,
          inStock: true,
        });
        expect.fail('Should have thrown ValidationError');
      } catch (error) {
        const validationError = error as ValidationError;
        expect(validationError.name).toBe('ValidationError');
        expect(validationError.issues.length).toBeGreaterThan(0);
      }
    });

    it('should reject empty product name', () => {
      try {
        db.insert('products', {
          id: 12,
          name: '',
          price: 50,
          inStock: true,
        });
        expect.fail('Should have thrown ValidationError');
      } catch (error) {
        const validationError = error as ValidationError;
        expect(validationError.name).toBe('ValidationError');
        expect(validationError.issues.length).toBeGreaterThan(0);
      }
    });
  });
});
