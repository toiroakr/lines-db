import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { LinesDB, type DatabaseConfig, type TableDefs } from '@toiroakr/lines-db';
import { join } from 'node:path';
import { mkdir, rm, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Schema Constraints (Primary Keys, Foreign Keys, Indexes)', () => {
  let db: LinesDB<TableDefs>;
  let testDir: string;
  let config: DatabaseConfig;

  beforeEach(async () => {
    const testTmpDir = join(__dirname, '.test-tmp');
    await mkdir(testTmpDir, { recursive: true });

    testDir = join(testTmpDir, `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    await mkdir(testDir);

    const fixturesDir = join(__dirname, './fixtures');
    await cp(fixturesDir, testDir, { recursive: true });

    process.env.LINES_DB_TEST_PROJECT_ROOT = '';

    config = {
      dataDir: testDir,
    };

    db = LinesDB.create(config);
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
    delete process.env.LINES_DB_TEST_PROJECT_ROOT;
  });

  describe('Primary Key Constraints', () => {
    it('should enforce primary key uniqueness', () => {
      const customersSchema = db.getSchema('customers');
      expect(customersSchema).toBeTruthy();

      const idColumn = customersSchema?.columns.find((col) => col.name === 'id');
      expect(idColumn?.primaryKey).toBe(true);

      // Try to insert duplicate primary key
      expect(() => {
        db.execute('INSERT INTO customers (id, name, email) VALUES (?, ?, ?)', [
          1,
          'Duplicate',
          'duplicate@example.com',
        ]);
      }).toThrow();
    });
  });

  describe('Foreign Key Constraints', () => {
    it('should have foreign key defined in schema', () => {
      const ordersSchema = db.getSchema('orders-with-fk');
      expect(ordersSchema).toBeTruthy();
      expect(ordersSchema?.foreignKeys).toBeTruthy();
      expect(ordersSchema?.foreignKeys?.length).toBe(1);

      const fk = ordersSchema?.foreignKeys?.[0];
      expect(fk?.column).toBe('customerId');
      expect(fk?.references.table).toBe('customers');
      expect(fk?.references.column).toBe('id');
      expect(fk?.onDelete).toBe('CASCADE');
    });

    it('should enforce foreign key constraint on insert', () => {
      // Try to insert order with non-existent customer
      expect(() => {
        db.execute(
          'INSERT INTO "orders-with-fk" (id, customerId, amount, status) VALUES (?, ?, ?, ?)',
          [999, 999, 100, 'pending'],
        );
      }).toThrow();
    });

    it('should cascade delete when parent is deleted', () => {
      // Get orders for customer 1
      const ordersBefore = db.query('SELECT * FROM "orders-with-fk" WHERE customerId = ?', [1]);
      expect(ordersBefore.length).toBe(3);

      // Delete customer 1
      db.execute('DELETE FROM customers WHERE id = ?', [1]);

      // Orders should be cascaded
      const ordersAfter = db.query('SELECT * FROM "orders-with-fk" WHERE customerId = ?', [1]);
      expect(ordersAfter.length).toBe(0);
    });

    it('should support foreign key reference to non-primary-key column with unique index', () => {
      // This test reproduces a bug that occurred on Windows Command Prompt where
      // "foreign key mismatch" errors were thrown when a table referenced a non-primary-key
      // column that had a unique index (e.g., _User.name -> User.email).
      //
      // Root cause: SQLite requires the referenced column to have a UNIQUE constraint
      // in the CREATE TABLE definition itself, not just a separately created index.
      // The file system ordering on Windows CMD caused tables to be processed in a
      // different order, exposing this schema definition issue.
      //
      // Fix: When loading schemas, single-column unique indexes are now automatically
      // converted to UNIQUE constraints on the column definition.
      const childSchema = db.getSchema('child-table');
      expect(childSchema).toBeTruthy();
      expect(childSchema?.foreignKeys).toBeTruthy();
      expect(childSchema?.foreignKeys?.length).toBe(1);

      const fk = childSchema?.foreignKeys?.[0];
      expect(fk?.column).toBe('parentEmail');
      expect(fk?.references.table).toBe('parent-table');
      expect(fk?.references.column).toBe('email');

      // Verify parent table's email column has unique constraint in schema
      const parentSchema = db.getSchema('parent-table');
      expect(parentSchema).toBeTruthy();
      const emailColumn = parentSchema?.columns.find((col) => col.name === 'email');
      expect(emailColumn?.unique).toBe(true);

      // Verify data was loaded successfully
      const children = db.query('SELECT * FROM "child-table"');
      expect(children.length).toBe(3);

      // Verify foreign key constraint is enforced
      expect(() => {
        db.execute('INSERT INTO "child-table" (id, parentEmail, data) VALUES (?, ?, ?)', [
          999,
          'nonexistent@example.com',
          'test',
        ]);
      }).toThrow();
    });

    it('should support _User -> User.email foreign key pattern (sdk/example pattern)', () => {
      // This test reproduces the exact pattern from sdk/example where:
      // - _User.name references User.email
      // - User.email is NOT primary key but has unique index
      // - File name starts with underscore (_User) which sorts before User
      //
      // This pattern caused "foreign key mismatch" error on Windows CMD due to
      // file system ordering differences.
      const underscoreUserSchema = db.getSchema('_User');
      expect(underscoreUserSchema).toBeTruthy();
      expect(underscoreUserSchema?.foreignKeys).toBeTruthy();
      expect(underscoreUserSchema?.foreignKeys?.length).toBe(1);

      const fk = underscoreUserSchema?.foreignKeys?.[0];
      expect(fk?.column).toBe('name');
      expect(fk?.references.table).toBe('User');
      expect(fk?.references.column).toBe('email');

      // Verify User table's email column has unique constraint in schema
      const userSchema = db.getSchema('User');
      expect(userSchema).toBeTruthy();
      const emailColumn = userSchema?.columns.find((col) => col.name === 'email');
      expect(emailColumn?.unique).toBe(true);

      // Verify data was loaded successfully (this is where the error would occur)
      const underscoreUsers = db.query('SELECT * FROM "_User"');
      expect(underscoreUsers.length).toBe(2);

      // Verify foreign key constraint is enforced
      expect(() => {
        db.execute('INSERT INTO "_User" (name, password) VALUES (?, ?)', [
          'nonexistent@example.com',
          'test',
        ]);
      }).toThrow();
    });
  });

  describe('Index Constraints', () => {
    it('should have indexes defined in schema', () => {
      const customersSchema = db.getSchema('customers');
      expect(customersSchema).toBeTruthy();
      expect(customersSchema?.indexes).toBeTruthy();
      expect(customersSchema?.indexes?.length).toBe(1);

      const emailIndex = customersSchema?.indexes?.[0];
      expect(emailIndex?.columns).toEqual(['email']);
      expect(emailIndex?.unique).toBe(true);
    });

    it('should enforce unique index constraint', () => {
      // Try to insert duplicate email
      expect(() => {
        db.execute('INSERT INTO customers (id, name, email) VALUES (?, ?, ?)', [
          99,
          'Test User',
          'john@example.com', // Duplicate email
        ]);
      }).toThrow();
    });

    it('should have multiple indexes on orders table', () => {
      const ordersSchema = db.getSchema('orders-with-fk');
      expect(ordersSchema?.indexes).toBeTruthy();
      expect(ordersSchema?.indexes?.length).toBe(2);

      const customerIdIndex = ordersSchema?.indexes?.find((idx) =>
        idx.columns.includes('customerId'),
      );
      expect(customerIdIndex).toBeTruthy();

      const statusIndex = ordersSchema?.indexes?.find((idx) => idx.columns.includes('status'));
      expect(statusIndex).toBeTruthy();
    });

    it('should verify indexes exist in SQLite', () => {
      // Query SQLite to check if indexes exist
      interface IndexRow {
        name: string;
      }
      const indexes = db.query<IndexRow>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='customers'",
      );

      // Should have at least the email index (plus SQLite auto-created pk index)
      expect(indexes.length).toBeGreaterThan(0);

      const indexNames = indexes.map((idx) => idx.name);
      const hasEmailIndex = indexNames.some((name) => name.includes('email'));
      expect(hasEmailIndex).toBe(true);
    });
  });
});
