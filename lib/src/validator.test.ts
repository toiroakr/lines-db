import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Validator } from './validator.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Validator', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `validator-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('validate file', () => {
    it('should validate file with valid data', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');
      const schemaPath = join(testDir, 'users.schema.ts');

      await writeFile(jsonlPath, '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n');
      await writeFile(
        schemaPath,
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'test',
            validate: (data) => {
              const issues = [];
              if (!data.id || !data.name) {
                issues.push({ message: 'Missing required fields' });
              }
              return { value: data, issues };
            }
          }
        };
      `,
      );

      const validator = new Validator({ path: jsonlPath });
      const result = await validator.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect validation errors', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');
      const schemaPath = join(testDir, 'users.schema.ts');

      await writeFile(jsonlPath, '{"id":1,"name":"Alice"}\n{"id":2}\n');
      await writeFile(
        schemaPath,
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'test',
            validate: (data) => {
              const issues = [];
              if (!data.name) {
                issues.push({ message: 'Missing name field', path: ['name'] });
              }
              return { value: data, issues };
            }
          }
        };
      `,
      );

      const validator = new Validator({ path: jsonlPath });
      const result = await validator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].rowIndex).toBe(2);
      expect(result.errors[0].tableName).toBe('users');
      expect(result.errors[0].issues).toHaveLength(1);
    });

    it('should throw when no schema exists', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');
      await writeFile(jsonlPath, '{"id":1}\n{"id":2}\n');

      const validator = new Validator({ path: jsonlPath });
      await expect(validator.validate()).rejects.toThrow(/Schema file not found/);
    });

    it('should handle multiple validation errors in single file', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');
      const schemaPath = join(testDir, 'users.schema.ts');

      await writeFile(jsonlPath, '{"id":1}\n{"id":2}\n{"id":3,"name":"Charlie"}\n');
      await writeFile(
        schemaPath,
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'test',
            validate: (data) => {
              const issues = [];
              if (!data.name) {
                issues.push({ message: 'Missing name' });
              }
              return { value: data, issues };
            }
          }
        };
      `,
      );

      const validator = new Validator({ path: jsonlPath });
      const result = await validator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].rowIndex).toBe(1);
      expect(result.errors[1].rowIndex).toBe(2);
    });

    it('should return 0-based rowIndex (first line = index 0)', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');
      const schemaPath = join(testDir, 'users.schema.ts');

      // Line 1: valid, Line 2: invalid (no name), Line 3: invalid (no name)
      await writeFile(
        jsonlPath,
        '{"id":1,"name":"Alice"}\n{"id":2}\n{"id":3}\n',
      );
      await writeFile(
        schemaPath,
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'test',
            validate: (data) => {
              const issues = [];
              if (!data.name) {
                issues.push({ message: 'Missing name field', path: ['name'] });
              }
              return { value: data, issues };
            }
          }
        };
      `,
      );

      const validator = new Validator({ path: jsonlPath });
      const result = await validator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      // First error is on line 2 of the file, which is index 1 (0-based)
      expect(result.errors[0].rowIndex).toBe(1);
      expect(result.errors[0].file).toBe(jsonlPath);
      // Second error is on line 3 of the file, which is index 2 (0-based)
      expect(result.errors[1].rowIndex).toBe(2);
      expect(result.errors[1].file).toBe(jsonlPath);
    });

    it('should return 0-based rowIndex for first line error', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');
      const schemaPath = join(testDir, 'users.schema.ts');

      // First line has error
      await writeFile(jsonlPath, '{"id":1}\n{"id":2,"name":"Bob"}\n');
      await writeFile(
        schemaPath,
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'test',
            validate: (data) => {
              const issues = [];
              if (!data.name) {
                issues.push({ message: 'Missing name field', path: ['name'] });
              }
              return { value: data, issues };
            }
          }
        };
      `,
      );

      const validator = new Validator({ path: jsonlPath });
      const result = await validator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      // First line (line 1 in file) should be index 0
      expect(result.errors[0].rowIndex).toBe(0);
      expect(result.errors[0].file).toBe(jsonlPath);
    });
  });

  describe('validate directory', () => {
    it('should validate all JSONL files in directory', async () => {
      const usersPath = join(testDir, 'users.jsonl');
      const productsPath = join(testDir, 'products.jsonl');
      const usersSchemaPath = join(testDir, 'users.schema.ts');
      const productsSchemaPath = join(testDir, 'products.schema.ts');

      await writeFile(usersPath, '{"id":1,"name":"Alice"}\n');
      await writeFile(productsPath, '{"id":1,"name":"Product"}\n');
      await writeFile(
        usersSchemaPath,
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'test',
            validate: (data) => ({ value: data, issues: [] })
          }
        };
      `,
      );
      await writeFile(
        productsSchemaPath,
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'test',
            validate: (data) => ({ value: data, issues: [] })
          }
        };
      `,
      );

      const validator = new Validator({ path: testDir });
      const result = await validator.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should collect errors from multiple files', async () => {
      const usersPath = join(testDir, 'users.jsonl');
      const usersSchemaPath = join(testDir, 'users.schema.ts');
      const productsPath = join(testDir, 'products.jsonl');
      const productsSchemaPath = join(testDir, 'products.schema.ts');

      await writeFile(usersPath, '{"id":1}\n');
      await writeFile(
        usersSchemaPath,
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'test',
            validate: (data) => ({
              value: data,
              issues: data.name ? [] : [{ message: 'Missing name' }]
            })
          }
        };
      `,
      );

      await writeFile(productsPath, '{"id":1}\n');
      await writeFile(
        productsSchemaPath,
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'test',
            validate: (data) => ({
              value: data,
              issues: data.price ? [] : [{ message: 'Missing price' }]
            })
          }
        };
      `,
      );

      const validator = new Validator({ path: testDir });
      const result = await validator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });

    it('should throw error for directory with no JSONL files', async () => {
      await writeFile(join(testDir, 'readme.txt'), 'no jsonl files here');

      const validator = new Validator({ path: testDir });

      await expect(validator.validate()).rejects.toThrow('No JSONL files found');
    });
  });

  describe('error handling', () => {
    it('should throw error for non-JSONL file', async () => {
      const txtPath = join(testDir, 'test.txt');
      await writeFile(txtPath, 'not a jsonl file');

      const validator = new Validator({ path: txtPath });

      await expect(validator.validate()).rejects.toThrow('Invalid path');
    });

    it('should reject async validation', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');
      const schemaPath = join(testDir, 'users.schema.ts');

      await writeFile(jsonlPath, '{"id":1}\n');
      await writeFile(
        schemaPath,
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'test',
            validate: async (data) => {
              return { value: data, issues: [] };
            }
          }
        };
      `,
      );

      const validator = new Validator({ path: jsonlPath });

      await expect(validator.validate()).rejects.toThrow(
        'Asynchronous validation is not supported',
      );
    });
  });
});
