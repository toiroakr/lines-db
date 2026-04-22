import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SchemaLoader } from './schema-loader.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SchemaLoader', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `schema-loader-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadSchema', () => {
    it('should load schema from .ts file', async () => {
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
            validate: () => ({ value: {} })
          }
        };
      `,
      );

      const schema = await SchemaLoader.loadSchema(jsonlPath);

      expect(schema).toBeDefined();
      expect(schema['~standard'].version).toBe(1);
      expect(schema['~standard'].vendor).toBe('test');
    });

    it('should load default export', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');
      const schemaPath = join(testDir, 'users.schema.ts');

      await writeFile(jsonlPath, '{"id":1}\n');
      await writeFile(
        schemaPath,
        `
        export default {
          '~standard': {
            version: 1,
            vendor: 'default-export',
            validate: () => ({ value: {} })
          }
        };
      `,
      );

      const schema = await SchemaLoader.loadSchema(jsonlPath);

      expect(schema['~standard'].vendor).toBe('default-export');
    });

    it('should load schema from .mts file', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');
      const schemaPath = join(testDir, 'users.schema.mts');

      await writeFile(jsonlPath, '{"id":1}\n');
      await writeFile(
        schemaPath,
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'mts-test',
            validate: () => ({ value: {} })
          }
        };
      `,
      );

      const schema = await SchemaLoader.loadSchema(jsonlPath);

      expect(schema).toBeDefined();
      expect(schema['~standard'].vendor).toBe('mts-test');
    });

    it('should load schema from .cts file', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');
      const schemaPath = join(testDir, 'users.schema.cts');

      await writeFile(jsonlPath, '{"id":1}\n');
      await writeFile(
        schemaPath,
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'cts-test',
            validate: () => ({ value: {} })
          }
        };
      `,
      );

      const schema = await SchemaLoader.loadSchema(jsonlPath);

      expect(schema).toBeDefined();
      expect(schema['~standard'].vendor).toBe('cts-test');
    });

    it('should prefer .schema.ts over .schema.mts when both exist', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');

      await writeFile(jsonlPath, '{"id":1}\n');
      await writeFile(
        join(testDir, 'users.schema.ts'),
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'ts-priority',
            validate: () => ({ value: {} })
          }
        };
      `,
      );
      await writeFile(
        join(testDir, 'users.schema.mts'),
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'mts-secondary',
            validate: () => ({ value: {} })
          }
        };
      `,
      );

      const schema = await SchemaLoader.loadSchema(jsonlPath);
      expect(schema['~standard'].vendor).toBe('ts-priority');
    });

    it('should throw when no schema file exists', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');
      await writeFile(jsonlPath, '{"id":1}\n');

      await expect(SchemaLoader.loadSchema(jsonlPath)).rejects.toThrow(/Schema file not found/);
    });

    it('should list all supported extensions in error message', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');
      await writeFile(jsonlPath, '{"id":1}\n');

      await expect(SchemaLoader.loadSchema(jsonlPath)).rejects.toThrow(/\.schema\.ts.*\.schema\.mts.*\.schema\.cts/);
    });

    it('should throw for invalid schema export', async () => {
      const jsonlPath = join(testDir, 'users.jsonl');
      const schemaPath = join(testDir, 'users.schema.ts');

      await writeFile(jsonlPath, '{"id":1}\n');
      await writeFile(
        schemaPath,
        `
        export const schema = {
          notAStandardSchema: true
        };
      `,
      );

      await expect(SchemaLoader.loadSchema(jsonlPath)).rejects.toThrow(/does not export a valid StandardSchema/);
    });

    it('should validate StandardSchema structure', async () => {
      const jsonlPath = join(testDir, 'test.jsonl');
      const schemaPath = join(testDir, 'test.schema.ts');

      await writeFile(jsonlPath, '{"id":1}\n');

      // Missing validate function
      await writeFile(
        schemaPath,
        `
        export const schema = {
          '~standard': {
            version: 1,
            vendor: 'test'
          }
        };
      `,
      );

      await expect(SchemaLoader.loadSchema(jsonlPath)).rejects.toThrow(/does not export a valid StandardSchema/);

      // Wrong version
      await writeFile(
        schemaPath,
        `
        export const schema = {
          '~standard': {
            version: 2,
            vendor: 'test',
            validate: () => ({ value: {} })
          }
        };
      `,
      );

      await expect(SchemaLoader.loadSchema(jsonlPath)).rejects.toThrow(/does not export a valid StandardSchema/);
    });
  });
});
