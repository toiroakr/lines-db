import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { LinesDB, TypeGenerator, type DatabaseConfig, type TableDefs } from '@toiroakr/lines-db';
import { join } from 'node:path';
import { mkdir, rm, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface User {
  id: number;
  name: string;
  age: number;
  email: string;
}

describe('LinesDB WHERE Conditions', () => {
  let db: LinesDB<TableDefs>;
  let testDir: string;
  let config: DatabaseConfig;

  function createDb() {
    return LinesDB.create(config);
  }

  beforeEach(async () => {
    const testTmpDir = join(__dirname, '.test-tmp');
    await mkdir(testTmpDir, { recursive: true });

    testDir = join(testTmpDir, `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    await mkdir(testDir);

    await cp(join(__dirname, './fixtures'), testDir, { recursive: true });
    process.env.LINES_DB_TEST_PROJECT_ROOT = '';

    const generator = new TypeGenerator({ dataDir: testDir });
    await generator.generate();

    config = { dataDir: testDir };
    db = createDb();
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
    delete process.env.LINES_DB_TEST_PROJECT_ROOT;
  });

  describe('OR conditions (array syntax)', () => {
    it('should find rows with simple OR condition', () => {
      const result = db.find('users', [{ name: 'Alice' }, { name: 'Bob' }]) as unknown as User[];
      expect(result.length).toBe(2);
      expect(result.map((u) => u.name).sort()).toEqual(['Alice', 'Bob']);
    });

    it('should find rows with OR condition on different fields', () => {
      const result = db.find('users', [{ name: 'Alice' }, { age: 25 }]) as unknown as User[];
      expect(result.length).toBe(2);
      expect(result.map((u) => u.name).sort()).toEqual(['Alice', 'Bob']);
    });

    it('should work with findOne using OR condition', () => {
      const result = db.findOne('users', [
        { name: 'Bob' },
        { name: 'Charlie' },
      ]) as unknown as User | null;
      expect(result).toBeTruthy();
      expect(['Bob', 'Charlie']).toContain(result?.name);
    });
  });

  describe('AND conditions with OR (nested)', () => {
    it('should handle AND within OR correctly', () => {
      // (name = Alice AND age = 30) OR (name = Bob AND age = 25)
      const result = db.find('users', [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]) as unknown as User[];
      expect(result.length).toBe(2);
      expect(result.map((u) => u.name).sort()).toEqual(['Alice', 'Bob']);
    });

    it('should handle nested arrays (OR within OR)', () => {
      // ((name = Alice) OR (name = Bob)) OR (age = 35)
      const result = db.find('users', [
        [{ name: 'Alice' }, { name: 'Bob' }],
        { age: 35 },
      ]) as unknown as User[];
      expect(result.length).toBe(3);
      expect(result.map((u) => u.name).sort()).toEqual(['Alice', 'Bob', 'Charlie']);
    });
  });

  describe('Function filters', () => {
    it('should filter with function on age', () => {
      const result = db.find('users', {
        age: (age: unknown) => (age as number) > 25,
      }) as unknown as User[];
      expect(result.length).toBe(2);
      expect(result.map((u) => u.name).sort()).toEqual(['Alice', 'Charlie']);
    });

    it('should filter with function on string field', () => {
      const result = db.find('users', {
        name: (name: unknown) => (name as string).startsWith('C'),
      }) as unknown as User[];
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Charlie');
    });

    it('should combine SQL conditions with function filters', () => {
      // SQL: age < 35, then JS filter: name starts with A or B
      const result = db.find('users', {
        age: (age: unknown) => (age as number) < 35,
        name: (name: unknown) => ['A', 'B'].some((prefix) => (name as string).startsWith(prefix)),
      }) as unknown as User[];
      expect(result.length).toBe(2);
      expect(result.map((u) => u.name).sort()).toEqual(['Alice', 'Bob']);
    });

    it('should work with findOne and function filter', () => {
      const result = db.findOne('users', {
        age: (age: unknown) => (age as number) >= 35,
      }) as unknown as User | null;
      expect(result).toBeTruthy();
      expect(result?.name).toBe('Charlie');
    });

    it('should handle function filters that match nothing', () => {
      const result = db.find('users', {
        age: (age: unknown) => (age as number) > 100,
      }) as unknown as User[];
      expect(result.length).toBe(0);
    });
  });

  describe('Combining OR and function filters', () => {
    it('should handle OR with function filters', () => {
      // (name = Alice) OR (age > 30)
      const result = db.find('users', [
        { name: 'Alice' },
        { age: (age: unknown) => (age as number) > 30 },
      ]) as unknown as User[];
      expect(result.length).toBe(2);
      expect(result.map((u) => u.name).sort()).toEqual(['Alice', 'Charlie']);
    });

    it('should handle complex OR with mixed conditions', () => {
      // (name = Bob AND age = 25) OR (age > 30)
      const result = db.find('users', [
        { name: 'Bob', age: 25 },
        { age: (age: unknown) => (age as number) > 30 },
      ]) as unknown as User[];
      expect(result.length).toBe(2);
      expect(result.map((u) => u.name).sort()).toEqual(['Bob', 'Charlie']);
    });
  });

  describe('Update and Delete with conditions', () => {
    it('should update with OR condition', () => {
      db.update('users', { age: 100 }, [{ name: 'Alice' }, { name: 'Bob' }]);

      const result = db.find('users', { age: 100 }) as unknown as User[];
      expect(result.length).toBe(2);
      expect(result.map((u) => u.name).sort()).toEqual(['Alice', 'Bob']);
    });

    it('should delete with OR condition', () => {
      db.delete('users', [{ name: 'Alice' }, { name: 'Bob' }]);

      const remaining = db.find('users') as unknown as User[];
      expect(remaining.length).toBe(1);
      expect(remaining[0].name).toBe('Charlie');
    });

    it('should throw error when using function filter in update', () => {
      expect(() => {
        db.update('users', { age: 100 }, { age: (age: unknown) => (age as number) > 25 });
      }).toThrow('Function filters are not supported in update operations');
    });

    it('should throw error when using function filter in delete', () => {
      expect(() => {
        db.delete('users', { age: (age: unknown) => (age as number) < 30 });
      }).toThrow('Function filters are not supported in delete operations');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty OR array', () => {
      const result = db.find('users', []) as unknown as User[];
      expect(result.length).toBe(0);
    });

    it('should handle single condition in array', () => {
      const result = db.find('users', [{ name: 'Alice' }]) as unknown as User[];
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Alice');
    });

    it('should handle deeply nested arrays', () => {
      // [[[{ name: 'Alice' }]]]
      const result = db.find('users', [[[{ name: 'Alice' }]]]) as unknown as User[];
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Alice');
    });
  });
});
