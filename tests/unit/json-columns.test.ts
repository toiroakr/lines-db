import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { LinesDB, TypeGenerator, type DatabaseConfig, type TableDefs } from '@toiroakr/lines-db';
import { join } from 'node:path';
import { mkdir, rm, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define Order type for testing
interface Order {
  id: number;
  customerId: number;
  items: Array<{ name: string; quantity: number; price: number }>;
  metadata: Record<string, unknown> | null;
}

describe('LinesDB JSON Columns', () => {
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

  describe('schema inference', () => {
    it('should infer JSON type for object columns', () => {
      const schema = db.getSchema('orders');
      expect(schema).toBeTruthy();

      const itemsColumn = schema!.columns.find((col) => col.name === 'items');
      expect(itemsColumn?.type).toBe('JSON');

      const metadataColumn = schema!.columns.find((col) => col.name === 'metadata');
      expect(metadataColumn?.type).toBe('JSON');
    });
  });

  describe('data loading', () => {
    it('should load and deserialize JSON columns', () => {
      const orders = db.find('orders') as unknown as Order[];
      expect(orders.length).toBe(3);

      // Check first order
      expect(Array.isArray(orders[0].items)).toBeTruthy();
      expect(orders[0].items.length).toBe(2);
      expect(orders[0].items[0].name).toBe('Laptop');
      expect(orders[0].items[0].quantity).toBe(1);
      expect(orders[0].items[0].price).toBe(999.99);

      expect(typeof orders[0].metadata).toBe('object');
      const metadata = orders[0].metadata as { source: string; campaign: string };
      expect(metadata.source).toBe('web');
      expect(metadata.campaign).toBe('summer2024');
    });

    it('should handle empty arrays', () => {
      const order = db.findOne('orders', { id: 3 }) as unknown as Order | undefined;
      expect(order).toBeTruthy();
      expect(Array.isArray(order!.items)).toBeTruthy();
      expect(order!.items.length).toBe(0);
    });

    it('should handle null JSON values', () => {
      const order = db.findOne('orders', { id: 3 }) as unknown as Order | undefined;
      expect(order).toBeTruthy();
      expect(order!.metadata).toBeNull();
    });
  });

  describe('insert with JSON columns', () => {
    it('should insert data with JSON columns', () => {
      const result = db.insert('orders', {
        id: 10,
        customerId: 200,
        items: [{ name: 'Monitor', quantity: 1, price: 299.99 }],
        metadata: { source: 'api', version: '2.0' },
      });

      expect(result.changes).toBe(1);

      const order = db.findOne('orders', { id: 10 }) as unknown as Order | undefined;
      expect(order).toBeTruthy();
      expect(Array.isArray(order!.items)).toBeTruthy();
      expect(order!.items[0].name).toBe('Monitor');
      expect(order!.metadata?.source).toBe('api');
    });

    it('should validate nested JSON structure', () => {
      expect(() => {
        db.insert('orders', {
          id: 11,
          customerId: 201,
          items: [
            { name: 'Product', quantity: -1, price: 50 }, // Invalid: negative quantity
          ],
          metadata: {},
        });
      }).toThrow();
    });

    it('should allow complex nested structures', () => {
      const result = db.insert('orders', {
        id: 12,
        customerId: 202,
        items: [
          { name: 'Product A', quantity: 5, price: 10.99 },
          { name: 'Product B', quantity: 3, price: 25.5 },
          { name: 'Product C', quantity: 1, price: 100.0 },
        ],
        metadata: {
          source: 'bulk-order',
          discount: { type: 'percentage', value: 10 },
          tags: ['wholesale', 'priority'],
        },
      });

      expect(result.changes).toBe(1);

      const order = db.findOne('orders', { id: 12 }) as unknown as Order | undefined;
      expect(order).toBeTruthy();
      expect(order!.items.length).toBe(3);
      expect(order!.metadata).toBeTruthy();
      const metadata = order!.metadata as {
        discount: { type: string; value: number };
        tags: string[];
      };
      expect(metadata.discount.type).toBe('percentage');
      expect(metadata.discount.value).toBe(10);
      expect(Array.isArray(metadata.tags)).toBeTruthy();
      expect(metadata.tags.length).toBe(2);
    });
  });

  describe('update with JSON columns', () => {
    it('should update JSON columns', () => {
      const result = db.update(
        'orders',
        {
          items: [{ name: 'Updated Product', quantity: 10, price: 50 }],
        },
        { id: 1 },
      );

      expect(result.changes).toBe(1);

      const order = db.findOne('orders', { id: 1 }) as unknown as Order | undefined;
      expect(order).toBeTruthy();
      expect(order!.items.length).toBe(1);
      expect(order!.items[0].name).toBe('Updated Product');
    });
  });

  describe('query with JSON columns', () => {
    it('should work with custom SQL queries', () => {
      // Note: JSON columns won't be automatically deserialized with raw queries
      // Users should use selectAll, find, or findOne for automatic deserialization
      const orders = db.query<Order>('SELECT * FROM orders WHERE id < ?', [3]);
      expect(orders.length).toBe(2);
    });
  });
});
