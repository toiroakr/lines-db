import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { JsonlReader } from './jsonl-reader.js';
import { SchemaLoader } from './schema-loader.js';
import type { StandardSchemaIssue, JsonObject } from './types.js';
import type { BiDirectionalSchema } from './schema.js';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrorDetail[];
}

export interface ValidationErrorDetail {
  file: string;
  tableName: string;
  rowIndex: number;
  issues: ReadonlyArray<StandardSchemaIssue>;
  type?: 'schema' | 'foreignKey';
  foreignKeyError?: {
    column: string;
    value: unknown;
    referencedTable: string;
    referencedColumn: string;
  };
}

export interface ValidatorOptions {
  path: string; // File or directory path
  projectRoot?: string;
}

export class Validator {
  private path: string;
  private projectRoot: string;

  constructor(options: ValidatorOptions) {
    this.path = options.path;
    this.projectRoot = options.projectRoot || process.cwd();
  }

  /**
   * Validate JSONL file(s)
   */
  async validate(): Promise<ValidationResult> {
    // Use absolute path if provided, otherwise resolve relative to projectRoot
    const fullPath = this.path.startsWith('/') ? this.path : join(this.projectRoot, this.path);
    const stats = await stat(fullPath);

    if (stats.isDirectory()) {
      return this.validateDirectory(fullPath);
    } else if (stats.isFile() && fullPath.endsWith('.jsonl')) {
      return this.validateFile(fullPath);
    } else {
      throw new Error(`Invalid path: ${this.path}. Must be a directory or .jsonl file.`);
    }
  }

  /**
   * Validate all JSONL files in a directory
   */
  private async validateDirectory(dirPath: string): Promise<ValidationResult> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const jsonlFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => join(dirPath, entry.name));

    if (jsonlFiles.length === 0) {
      throw new Error(`No JSONL files found in directory: ${dirPath}`);
    }

    const allErrors: ValidationErrorDetail[] = [];

    // First, validate schema for each file
    for (const file of jsonlFiles) {
      const result = await this.validateFile(file);
      allErrors.push(...result.errors);
    }

    // Then, validate foreign keys across all tables
    const fkErrors = await this.validateForeignKeys(dirPath, jsonlFiles);
    allErrors.push(...fkErrors);

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
    };
  }

  /**
   * Validate foreign key constraints across all tables
   */
  private async validateForeignKeys(
    dirPath: string,
    jsonlFiles: string[],
  ): Promise<ValidationErrorDetail[]> {
    const errors: ValidationErrorDetail[] = [];

    // Load all table data
    const tableData = new Map<string, JsonObject[]>();
    const tableSchemas = new Map<string, BiDirectionalSchema>();

    for (const file of jsonlFiles) {
      const tableName = basename(file, '.jsonl');
      const data = await JsonlReader.read(file);
      const schema = await SchemaLoader.loadSchema(file);

      tableData.set(tableName, data);
      tableSchemas.set(tableName, schema as BiDirectionalSchema);
    }

    // Check foreign keys for each table
    for (const file of jsonlFiles) {
      const tableName = basename(file, '.jsonl');
      const schema = tableSchemas.get(tableName);
      const data = tableData.get(tableName);

      if (!schema || !data || !schema.foreignKeys) {
        continue;
      }

      // Check each foreign key constraint
      for (const fk of schema.foreignKeys) {
        const referencedTable = fk.references.table;
        const referencedData = tableData.get(referencedTable);

        if (!referencedData) {
          // Referenced table not found - skip validation
          continue;
        }

        // Build index of referenced values for fast lookup
        const referencedValues = new Set<string>();
        for (const refRow of referencedData) {
          // Build composite key from referenced columns
          const keyValues = fk.references.columns.map((col) => refRow[col]);
          const compositeKey = JSON.stringify(keyValues);
          referencedValues.add(compositeKey);
        }

        // Check each row in current table
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          const foreignKeyValues = fk.columns.map((col) => row[col]);
          const compositeKey = JSON.stringify(foreignKeyValues);

          // Check if foreign key value exists in referenced table
          if (!referencedValues.has(compositeKey)) {
            errors.push({
              file,
              tableName,
              rowIndex: i, // 0-indexed, will be converted to 1-indexed in formatter
              issues: [],
              type: 'foreignKey',
              foreignKeyError: {
                column: fk.columns.join(', '),
                value: foreignKeyValues.length === 1 ? foreignKeyValues[0] : foreignKeyValues,
                referencedTable: referencedTable,
                referencedColumn: fk.references.columns.join(', '),
              },
            });
          }
        }
      }
    }

    return errors;
  }

  /**
   * Validate a single JSONL file
   */
  private async validateFile(filePath: string): Promise<ValidationResult> {
    const tableName = basename(filePath, '.jsonl');
    const data = await JsonlReader.read(filePath);

    // Try to load schema
    const schema = await SchemaLoader.loadSchema(filePath);

    const errors: ValidationErrorDetail[] = [];

    // Validate each row
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const result = schema['~standard'].validate(row);

      // Only synchronous validation is supported
      if (result instanceof Promise) {
        throw new Error('Asynchronous validation is not supported.');
      }

      if (result.issues && result.issues.length > 0) {
        errors.push({
          file: filePath,
          tableName,
          rowIndex: i, // 0-indexed, will be converted to 1-indexed in formatter
          issues: result.issues,
          type: 'schema',
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
