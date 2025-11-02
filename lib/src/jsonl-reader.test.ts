import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonlReader } from './jsonl-reader.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('JsonlReader', () => {
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `jsonl-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test.jsonl');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('read', () => {
    it('should read and parse JSONL file', async () => {
      const content = '{"id": 1, "name": "Alice"}\n{"id": 2, "name": "Bob"}\n';
      await writeFile(testFilePath, content);

      const result = await JsonlReader.read(testFilePath);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 1, name: 'Alice' });
      expect(result[1]).toEqual({ id: 2, name: 'Bob' });
    });

    it('should handle empty lines', async () => {
      const content = '{"id": 1}\n\n{"id": 2}\n';
      await writeFile(testFilePath, content);

      const result = await JsonlReader.read(testFilePath);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 1 });
      expect(result[1]).toEqual({ id: 2 });
    });

    it('should handle trailing newlines', async () => {
      const content = '{"id": 1}\n{"id": 2}\n\n\n';
      await writeFile(testFilePath, content);

      const result = await JsonlReader.read(testFilePath);

      expect(result).toHaveLength(2);
    });

    it('should throw error for invalid JSON', async () => {
      const content = '{"id": 1}\n{invalid json}\n';
      await writeFile(testFilePath, content);

      await expect(JsonlReader.read(testFilePath)).rejects.toThrow('Failed to parse JSON line');
    });
  });

  describe('inferSchema', () => {
    it('should infer schema with basic types', () => {
      const data = [
        { id: 1, name: 'Alice', age: 30, active: true },
        { id: 2, name: 'Bob', age: 25, active: false },
      ];

      const schema = JsonlReader.inferSchema('users', data);

      expect(schema.name).toBe('users');
      expect(schema.columns).toHaveLength(4);

      const idColumn = schema.columns.find((col) => col.name === 'id');
      expect(idColumn).toEqual({
        name: 'id',
        type: 'INTEGER',
        notNull: true,
        primaryKey: true,
      });

      const nameColumn = schema.columns.find((col) => col.name === 'name');
      expect(nameColumn?.type).toBe('TEXT');

      const ageColumn = schema.columns.find((col) => col.name === 'age');
      expect(ageColumn?.type).toBe('INTEGER');

      const activeColumn = schema.columns.find((col) => col.name === 'active');
      expect(activeColumn?.type).toBe('INTEGER'); // Boolean stored as INTEGER
    });

    it('should infer JSON type for objects', () => {
      const data1 = { id: 1, metadata: { key: 'value' } };
      const data2 = { id: 2, metadata: { foo: 'bar' } };

      const schema = JsonlReader.inferSchema('records', [data1, data2]);

      const metadataColumn = schema.columns.find((col) => col.name === 'metadata');
      expect(metadataColumn?.type).toBe('JSON');
    });

    it('should infer JSON type for arrays', () => {
      const data = [
        { id: 1, tags: ['a', 'b', 'c'] },
        { id: 2, tags: ['x', 'y'] },
      ];

      const schema = JsonlReader.inferSchema('records', data);

      const tagsColumn = schema.columns.find((col) => col.name === 'tags');
      expect(tagsColumn?.type).toBe('JSON');
    });

    it('should handle nullable columns', () => {
      const data = [
        { id: 1, name: 'Alice', email: null },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ];

      const schema = JsonlReader.inferSchema('users', data);

      const emailColumn = schema.columns.find((col) => col.name === 'email');
      expect(emailColumn?.type).toBe('TEXT');
      expect(emailColumn?.notNull).toBe(false);
    });

    it('should handle mixed numeric types as REAL', () => {
      const data = [
        { id: 1, value: 10 },
        { id: 2, value: 10.5 },
      ];

      const schema = JsonlReader.inferSchema('records', data);

      const valueColumn = schema.columns.find((col) => col.name === 'value');
      expect(valueColumn?.type).toBe('REAL');
    });

    it('should use TEXT as fallback for mixed types', () => {
      const data = [
        { id: 1, mixed: 'text' },
        { id: 2, mixed: 123 },
      ];

      const schema = JsonlReader.inferSchema('records', data);

      const mixedColumn = schema.columns.find((col) => col.name === 'mixed');
      expect(mixedColumn?.type).toBe('TEXT');
    });

    it('should throw error for empty data', () => {
      expect(() => JsonlReader.inferSchema('empty', [])).toThrow(
        'Cannot infer schema from empty data',
      );
    });

    it('should handle REAL numbers', () => {
      const data = [
        { id: 1, price: 99.99 },
        { id: 2, price: 149.5 },
      ];

      const schema = JsonlReader.inferSchema('products', data);

      const priceColumn = schema.columns.find((col) => col.name === 'price');
      expect(priceColumn?.type).toBe('REAL');
    });
  });
});
