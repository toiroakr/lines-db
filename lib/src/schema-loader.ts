import { pathToFileURL } from 'node:url';
import { access } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import type { StandardSchema } from './types.js';

export class SchemaLoader {
  /**
   * Check if a schema file exists for a table
   */
  static async hasSchema(jsonlPath: string): Promise<boolean> {
    const dir = dirname(jsonlPath);
    const tableName = basename(jsonlPath, '.jsonl');
    const schemaPath = join(dir, `${tableName}.schema.ts`);

    try {
      await access(schemaPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load a validation schema file for a table
   * Requires ${tableName}.schema.ts to exist alongside the JSONL file
   */
  static async loadSchema(jsonlPath: string): Promise<StandardSchema> {
    const dir = dirname(jsonlPath);
    const tableName = basename(jsonlPath, '.jsonl');
    const schemaPath = join(dir, `${tableName}.schema.ts`);

    try {
      await access(schemaPath);
    } catch (error) {
      throw new Error(`Schema file not found for table '${tableName}'. Expected: ${schemaPath}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }

    try {
      const schemaUrl = pathToFileURL(schemaPath).href;
      // Add cache busting query parameter to force reload on each import
      // This ensures schema changes are picked up immediately
      const cacheBustedUrl = `${schemaUrl}?t=${Date.now()}`;
      const module = await import(cacheBustedUrl);
      const schema = module.default || module.schema;

      if (schema && this.isStandardSchema(schema)) {
        return schema;
      }

      throw new Error(`Schema file ${schemaPath} does not export a valid StandardSchema`);
    } catch (error) {
      throw new Error(
        `Failed to load schema for table '${tableName}' from ${schemaPath}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }

  /**
   * Check if an object implements the StandardSchema interface
   */
  private static isStandardSchema(obj: unknown): obj is StandardSchema {
    if (!obj || typeof obj !== 'object') return false;

    const schema = obj as Record<string, unknown>;
    const standard = schema['~standard'];

    if (!standard || typeof standard !== 'object') return false;

    const standardObj = standard as Record<string, unknown>;

    return (
      standardObj.version === 1 &&
      typeof standardObj.vendor === 'string' &&
      typeof standardObj.validate === 'function'
    );
  }
}
