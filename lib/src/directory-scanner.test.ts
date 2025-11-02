import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DirectoryScanner } from './directory-scanner.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('DirectoryScanner', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `scanner-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('scanDirectory', () => {
    it('should find JSONL files in directory', async () => {
      await writeFile(join(testDir, 'users.jsonl'), '{"id":1}\n');
      await writeFile(join(testDir, 'products.jsonl'), '{"id":1}\n');

      const tables = await DirectoryScanner.scanDirectory(testDir);

      expect(tables.size).toBe(2);
      expect(tables.has('users')).toBe(true);
      expect(tables.has('products')).toBe(true);
    });

    it('should create correct table config', async () => {
      await writeFile(join(testDir, 'users.jsonl'), '{"id":1}\n');

      const tables = await DirectoryScanner.scanDirectory(testDir);
      const usersConfig = tables.get('users');

      expect(usersConfig).toBeDefined();
      expect(usersConfig?.jsonlPath).toBe(join(testDir, 'users.jsonl'));
      expect(usersConfig?.autoInferSchema).toBe(true);
    });

    it('should ignore non-JSONL files', async () => {
      await writeFile(join(testDir, 'users.jsonl'), '{"id":1}\n');
      await writeFile(join(testDir, 'readme.txt'), 'readme');
      await writeFile(join(testDir, 'config.json'), '{}');

      const tables = await DirectoryScanner.scanDirectory(testDir);

      expect(tables.size).toBe(1);
      expect(tables.has('users')).toBe(true);
    });

    it('should handle empty directory', async () => {
      const tables = await DirectoryScanner.scanDirectory(testDir);

      expect(tables.size).toBe(0);
    });

    it('should throw error for non-existent directory', async () => {
      const nonExistentDir = join(testDir, 'nonexistent');

      await expect(DirectoryScanner.scanDirectory(nonExistentDir)).rejects.toThrow(
        'Failed to scan directory',
      );
    });

    it('should handle multiple JSONL files', async () => {
      const fileNames = ['users', 'products', 'orders', 'categories', 'reviews'];

      for (const name of fileNames) {
        await writeFile(join(testDir, `${name}.jsonl`), '{"id":1}\n');
      }

      const tables = await DirectoryScanner.scanDirectory(testDir);

      expect(tables.size).toBe(5);
      for (const name of fileNames) {
        expect(tables.has(name)).toBe(true);
      }
    });

    it('should handle files with multiple dots in name', async () => {
      await writeFile(join(testDir, 'test.backup.jsonl'), '{"id":1}\n');

      const tables = await DirectoryScanner.scanDirectory(testDir);

      expect(tables.size).toBe(1);
      expect(tables.has('test.backup')).toBe(true);
    });
  });
});
