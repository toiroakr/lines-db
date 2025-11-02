import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonlWriter } from './jsonl-writer.js';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('JsonlWriter', () => {
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `jsonl-writer-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test.jsonl');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('write', () => {
    it('should write data to JSONL file', async () => {
      const data = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];

      await JsonlWriter.write(testFilePath, data);

      const content = await readFile(testFilePath, 'utf-8');
      expect(content).toBe('{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n');
    });

    it('should write empty array', async () => {
      await JsonlWriter.write(testFilePath, []);

      const content = await readFile(testFilePath, 'utf-8');
      expect(content).toBe('\n');
    });

    it('should write complex objects', async () => {
      const data1 = { id: 1, metadata: { key: 'value' }, tags: ['a', 'b'] };
      const data2 = { id: 2, active: true, score: 99.5 };

      await JsonlWriter.write(testFilePath, [data1, data2]);

      const content = await readFile(testFilePath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual(data1);
      expect(JSON.parse(lines[1])).toEqual(data2);
    });

    it('should overwrite existing file', async () => {
      await JsonlWriter.write(testFilePath, [{ id: 1 }]);
      await JsonlWriter.write(testFilePath, [{ id: 2 }]);

      const content = await readFile(testFilePath, 'utf-8');
      expect(content).toBe('{"id":2}\n');
    });
  });

  describe('append', () => {
    it('should append data to existing file', async () => {
      await JsonlWriter.write(testFilePath, [{ id: 1, name: 'Alice' }]);
      await JsonlWriter.append(testFilePath, [{ id: 2, name: 'Bob' }]);

      const content = await readFile(testFilePath, 'utf-8');
      expect(content).toBe('{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n');
    });

    it('should create file if it does not exist', async () => {
      await JsonlWriter.append(testFilePath, [{ id: 1, name: 'Alice' }]);

      const content = await readFile(testFilePath, 'utf-8');
      expect(content).toBe('{"id":1,"name":"Alice"}\n');
    });

    it('should append multiple records', async () => {
      await JsonlWriter.write(testFilePath, [{ id: 1 }]);
      await JsonlWriter.append(testFilePath, [{ id: 2 }, { id: 3 }, { id: 4 }]);

      const content = await readFile(testFilePath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(4);
      expect(JSON.parse(lines[0])).toEqual({ id: 1 });
      expect(JSON.parse(lines[3])).toEqual({ id: 4 });
    });

    it('should handle empty array append', async () => {
      await JsonlWriter.write(testFilePath, [{ id: 1 }]);
      await JsonlWriter.append(testFilePath, []);

      const content = await readFile(testFilePath, 'utf-8');
      // Appending empty array adds just a newline
      expect(content).toBe('{"id":1}\n\n');
    });
  });
});
