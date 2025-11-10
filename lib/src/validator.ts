import { readdir, stat } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { JsonlReader } from './jsonl-reader.js';
import { SchemaLoader } from './schema-loader.js';
import { LinesDB } from './database.js';
import type { StandardSchemaIssue } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrorDetail[];
  warnings: string[];
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
    const allWarnings: string[] = [];
    const filesWithSchema: string[] = [];

    // Filter files with schema and collect warnings for files without schema
    for (const file of jsonlFiles) {
      const hasSchema = await SchemaLoader.hasSchema(file);
      if (hasSchema) {
        filesWithSchema.push(file);
      } else {
        const tableName = basename(file, '.jsonl');
        allWarnings.push(`Skipping validation for '${tableName}': schema file not found`);
      }
    }

    // Validate schema for each file with schema
    for (const file of filesWithSchema) {
      const result = await this.validateFile(file);
      allErrors.push(...result.errors);
      allWarnings.push(...result.warnings);
    }

    // Then, validate by actually loading into database
    if (filesWithSchema.length > 0 && allErrors.length === 0) {
      const dbErrors = await this.validateWithDatabase(dirPath, filesWithSchema);
      allErrors.push(...dbErrors);
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
    };
  }

  /**
   * Validate by loading data into an actual database
   * This catches constraint violations (unique, primary key, foreign key, etc.)
   */
  private async validateWithDatabase(
    dirPath: string,
    jsonlFiles: string[],
  ): Promise<ValidationErrorDetail[]> {
    const errors: ValidationErrorDetail[] = [];

    // Capture console.warn messages
    const warnMessages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const message = args.map((arg) => String(arg)).join(' ');
      warnMessages.push(message);
      // Still output to console for debugging
      originalWarn(...args);
    };

    try {
      // Try to initialize database with the data directory
      const db = LinesDB.create({ dataDir: dirPath });
      await db.initialize();
      await db.close();

      // Check if there were any loading errors
      for (const message of warnMessages) {
        if (message.includes('Failed to load table')) {
          // Extract table name from message
          const tableNameMatch = message.match(/Failed to load table '([^']+)'/);
          const tableName = tableNameMatch ? tableNameMatch[1] : 'unknown';

          const file = jsonlFiles.find((f) => basename(f, '.jsonl') === tableName);

          errors.push({
            file: file || `${dirPath}/${tableName}.jsonl`,
            tableName,
            rowIndex: 0,
            issues: [
              {
                message: message.replace(/^Warning:\s*/, ''),
                path: [],
              },
            ],
            type: 'schema',
          });
        }
      }
    } catch (error) {
      // If initialization itself fails, report it
      errors.push({
        file: dirPath,
        tableName: 'database',
        rowIndex: 0,
        issues: [
          {
            message: `Database initialization failed: ${error instanceof Error ? error.message : String(error)}`,
            path: [],
          },
        ],
        type: 'schema',
      });
    } finally {
      // Restore console.warn
      console.warn = originalWarn;
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

    // Validate each row with schema
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

    // If schema validation passed, validate with database
    if (errors.length === 0) {
      const dirPath = dirname(filePath);
      const dbErrors = await this.validateWithDatabase(dirPath, [filePath]);
      errors.push(...dbErrors);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  }
}
