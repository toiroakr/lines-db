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
      expect(fk?.columns).toEqual(['customerId']);
      expect(fk?.references.table).toBe('customers');
      expect(fk?.references.columns).toEqual(['id']);
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
      expect(ordersBefore.length).toBe(2);

      // Delete customer 1
      db.execute('DELETE FROM customers WHERE id = ?', [1]);

      // Orders should be cascaded
      const ordersAfter = db.query('SELECT * FROM "orders-with-fk" WHERE customerId = ?', [1]);
      expect(ordersAfter.length).toBe(0);
    });
  });

  describe('Composite Foreign Key Constraints', () => {
    it('should have composite foreign key defined in schema', () => {
      const inventorySchema = db.getSchema('inventory');
      expect(inventorySchema).toBeTruthy();
      expect(inventorySchema?.foreignKeys).toBeTruthy();
      expect(inventorySchema?.foreignKeys?.length).toBe(1);

      const fk = inventorySchema?.foreignKeys?.[0];
      expect(fk?.columns).toEqual(['category', 'productSku']);
      expect(fk?.references.table).toBe('products-composite-pk');
      expect(fk?.references.columns).toEqual(['category', 'sku']);
      expect(fk?.onDelete).toBe('CASCADE');
    });

    it('should enforce composite foreign key constraint on insert', () => {
      // Try to insert inventory with non-existent product (both columns must match)
      expect(() => {
        db.execute(
          'INSERT INTO inventory (warehouseId, category, productSku, quantity) VALUES (?, ?, ?, ?)',
          [3, 'electronics', 'NONEXISTENT', 10],
        );
      }).toThrow();

      // Try with valid category but invalid sku
      expect(() => {
        db.execute(
          'INSERT INTO inventory (warehouseId, category, productSku, quantity) VALUES (?, ?, ?, ?)',
          [3, 'electronics', 'SKU999', 10],
        );
      }).toThrow();

      // Try with valid sku but invalid category
      expect(() => {
        db.execute(
          'INSERT INTO inventory (warehouseId, category, productSku, quantity) VALUES (?, ?, ?, ?)',
          [3, 'furniture', 'SKU001', 10],
        );
      }).toThrow();

      // Valid insert should succeed
      expect(() => {
        db.execute(
          'INSERT INTO inventory (warehouseId, category, productSku, quantity) VALUES (?, ?, ?, ?)',
          [3, 'electronics', 'SKU001', 10],
        );
      }).not.toThrow();
    });

    it('should cascade delete with composite foreign key', () => {
      // Get inventory for electronics SKU001
      const inventoryBefore = db.query(
        'SELECT * FROM inventory WHERE category = ? AND productSku = ?',
        ['electronics', 'SKU001'],
      );
      expect(inventoryBefore.length).toBe(1);

      // Delete the product
      db.execute('DELETE FROM "products-composite-pk" WHERE category = ? AND sku = ?', [
        'electronics',
        'SKU001',
      ]);

      // Inventory should be cascaded
      const inventoryAfter = db.query(
        'SELECT * FROM inventory WHERE category = ? AND productSku = ?',
        ['electronics', 'SKU001'],
      );
      expect(inventoryAfter.length).toBe(0);
    });

    it('should verify composite primary key exists', () => {
      const productsSchema = db.getSchema('products-composite-pk');
      expect(productsSchema).toBeTruthy();

      // Find primary key columns
      const pkColumns = productsSchema?.columns.filter((col) => col.primaryKey);
      expect(pkColumns?.length).toBe(2);
      expect(pkColumns?.map((col) => col.name)).toEqual(
        expect.arrayContaining(['category', 'sku']),
      );
    });

    it('should prevent duplicate composite primary key', () => {
      // Try to insert duplicate (category, sku) combination
      expect(() => {
        db.execute(
          'INSERT INTO "products-composite-pk" (category, sku, name, price) VALUES (?, ?, ?, ?)',
          ['electronics', 'SKU001', 'Duplicate Product', 100],
        );
      }).toThrow();
    });

    it('should allow same sku in different categories', () => {
      // SKU001 exists in both electronics and books categories
      const products = db.query<{ category: string; sku: string; name: string; price: number }>(
        'SELECT * FROM "products-composite-pk" WHERE sku = ?',
        ['SKU001'],
      );
      expect(products.length).toBe(2);

      const categories = products.map((p) => p.category);
      expect(categories).toContain('electronics');
      expect(categories).toContain('books');
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
