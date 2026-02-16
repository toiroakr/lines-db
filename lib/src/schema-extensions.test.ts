import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isSchemaFile,
  extractTableNameFromSchemaFile,
  rewriteExtensionForImport,
  findSchemaFile,
  findSchemaFileInEntries,
  SCHEMA_EXTENSIONS,
} from './schema-extensions.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('schema-extensions', () => {
  describe('isSchemaFile', () => {
    it('should recognize .schema.ts', () => {
      expect(isSchemaFile('users.schema.ts')).toBe(true);
    });

    it('should recognize .schema.mts', () => {
      expect(isSchemaFile('users.schema.mts')).toBe(true);
    });

    it('should recognize .schema.cts', () => {
      expect(isSchemaFile('users.schema.cts')).toBe(true);
    });

    it('should reject non-schema files', () => {
      expect(isSchemaFile('users.ts')).toBe(false);
      expect(isSchemaFile('db.ts')).toBe(false);
      expect(isSchemaFile('schema.ts')).toBe(false);
    });
  });

  describe('extractTableNameFromSchemaFile', () => {
    it('should extract from .schema.ts', () => {
      expect(extractTableNameFromSchemaFile('users.schema.ts')).toBe('users');
    });

    it('should extract from .schema.mts', () => {
      expect(extractTableNameFromSchemaFile('users.schema.mts')).toBe('users');
    });

    it('should extract from .schema.cts', () => {
      expect(extractTableNameFromSchemaFile('users.schema.cts')).toBe('users');
    });

    it('should return null for non-schema files', () => {
      expect(extractTableNameFromSchemaFile('users.ts')).toBeNull();
      expect(extractTableNameFromSchemaFile('db.ts')).toBeNull();
    });
  });

  describe('rewriteExtensionForImport', () => {
    it('.schema.ts -> .schema.js', () => {
      expect(rewriteExtensionForImport('./users.schema.ts')).toBe('./users.schema.js');
    });

    it('.schema.mts -> .schema.mjs', () => {
      expect(rewriteExtensionForImport('./users.schema.mts')).toBe('./users.schema.mjs');
    });

    it('.schema.cts -> .schema.cjs', () => {
      expect(rewriteExtensionForImport('./users.schema.cts')).toBe('./users.schema.cjs');
    });

    it('should not modify paths without matching extensions', () => {
      expect(rewriteExtensionForImport('./users.js')).toBe('./users.js');
    });
  });

  describe('findSchemaFile', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `schema-ext-test-${Date.now()}`);
      await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true });
    });

    it('should find .schema.ts file', async () => {
      await writeFile(join(testDir, 'users.schema.ts'), 'export const schema = {};');
      const result = await findSchemaFile(testDir, 'users');
      expect(result).toBe(join(testDir, 'users.schema.ts'));
    });

    it('should find .schema.mts file', async () => {
      await writeFile(join(testDir, 'users.schema.mts'), 'export const schema = {};');
      const result = await findSchemaFile(testDir, 'users');
      expect(result).toBe(join(testDir, 'users.schema.mts'));
    });

    it('should find .schema.cts file', async () => {
      await writeFile(join(testDir, 'users.schema.cts'), 'export const schema = {};');
      const result = await findSchemaFile(testDir, 'users');
      expect(result).toBe(join(testDir, 'users.schema.cts'));
    });

    it('should prefer .schema.ts over .schema.mts', async () => {
      await writeFile(join(testDir, 'users.schema.ts'), 'export const schema = {};');
      await writeFile(join(testDir, 'users.schema.mts'), 'export const schema = {};');
      const result = await findSchemaFile(testDir, 'users');
      expect(result).toBe(join(testDir, 'users.schema.ts'));
    });

    it('should return undefined when no schema file exists', async () => {
      const result = await findSchemaFile(testDir, 'users');
      expect(result).toBeUndefined();
    });
  });

  describe('findSchemaFileInEntries', () => {
    it('should find .schema.ts in entries', () => {
      const entries = [
        { isFile: () => true, name: 'users.jsonl' },
        { isFile: () => true, name: 'users.schema.ts' },
      ];
      const result = findSchemaFileInEntries('/data', 'users', entries);
      expect(result).toBe(join('/data', 'users.schema.ts'));
    });

    it('should find .schema.mts in entries', () => {
      const entries = [
        { isFile: () => true, name: 'users.jsonl' },
        { isFile: () => true, name: 'users.schema.mts' },
      ];
      const result = findSchemaFileInEntries('/data', 'users', entries);
      expect(result).toBe(join('/data', 'users.schema.mts'));
    });

    it('should prefer .schema.ts over .schema.mts in entries', () => {
      const entries = [
        { isFile: () => true, name: 'users.schema.ts' },
        { isFile: () => true, name: 'users.schema.mts' },
      ];
      const result = findSchemaFileInEntries('/data', 'users', entries);
      expect(result).toBe(join('/data', 'users.schema.ts'));
    });

    it('should return undefined when no schema file in entries', () => {
      const entries = [{ isFile: () => true, name: 'users.jsonl' }];
      const result = findSchemaFileInEntries('/data', 'users', entries);
      expect(result).toBeUndefined();
    });
  });

  describe('SCHEMA_EXTENSIONS', () => {
    it('should have correct priority order', () => {
      expect(SCHEMA_EXTENSIONS).toEqual(['.schema.ts', '.schema.mts', '.schema.cts']);
    });
  });
});
