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

    // Validate by loading into database with detailed error tracking
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
   * Validate by loading data into database one row at a time
   * This catches constraint violations and extracts detailed error information
   */
  private async validateWithDatabase(
    dirPath: string,
    jsonlFiles: string[],
  ): Promise<ValidationErrorDetail[]> {
    const errors: ValidationErrorDetail[] = [];

    try {
      const db = LinesDB.create({ dataDir: ':memory:' });

      // Load all tables one by one, checking each row
      for (const file of jsonlFiles) {
        const tableName = basename(file, '.jsonl');
        const data = await JsonlReader.read(file);

        // Load schema and metadata
        let schema: any;
        let foreignKeys: any[] = [];
        let indexes: any[] = [];
        let primaryKey: string | undefined;
        try {
          schema = await SchemaLoader.loadSchema(file);
          const { pathToFileURL } = await import('node:url');
          const schemaPath = file.replace('.jsonl', '.schema.ts');
          const schemaUrl = pathToFileURL(schemaPath).href;
          const schemaModule = await import(`${schemaUrl}?t=${Date.now()}`);
          const schemaExport = schemaModule.schema || schemaModule.default;
          if (schemaExport?.foreignKeys) {
            foreignKeys = schemaExport.foreignKeys;
          }
          if (schemaExport?.indexes) {
            indexes = schemaExport.indexes;
          }
          if (schemaExport?.primaryKey) {
            primaryKey = schemaExport.primaryKey;
          }
        } catch (_error) {
          // Schema not found or failed to load
          continue;
        }

        // Create table schema
        try {
          const tableSchema = this.createTableSchema(
            tableName,
            data,
            schema,
            foreignKeys,
            indexes,
            primaryKey,
          );

          // Create the table in the database
          this.createTableInDb(db, tableSchema);

          // Insert rows one by one to catch constraint violations
          for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
            const row = data[rowIndex];
            try {
              this.insertRowIntoDb(db, tableName, tableSchema, row);
            } catch (error) {
              // Constraint violation occurred
              const constraintError = this.analyzeConstraintError(
                error,
                file,
                tableName,
                rowIndex,
                row,
                foreignKeys,
                db,
              );
              if (constraintError) {
                errors.push(constraintError);
              }
            }
          }
        } catch (_error) {
          // Skip this table and continue if table creation fails
          continue;
        }
      }

      await db.close();
    } catch (error) {
      // Database initialization failed
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
    }

    return errors;
  }

  /**
   * Create table schema from data and validation schema
   */
  private createTableSchema(
    tableName: string,
    data: any[],
    validationSchema: any,
    foreignKeys: any[],
    indexes: any[],
    primaryKey?: string,
  ): any {
    if (data.length === 0) {
      throw new Error(`No data found in ${tableName}`);
    }

    // Infer schema from data
    const schema = JsonlReader.inferSchema(tableName, data);

    // Set primary key if specified
    if (primaryKey) {
      const pkColumn = schema.columns.find((col: any) => col.name === primaryKey);
      if (pkColumn) {
        pkColumn.primaryKey = true;
      }
    } else if (!schema.columns.some((col: any) => col.primaryKey)) {
      // If no primary key is defined, use 'id' column as primary key if it exists
      // This matches the behavior of database.ts
      const idColumn = schema.columns.find((c: any) => c.name === 'id');
      if (idColumn) {
        idColumn.primaryKey = true;
      }
    }

    // Add foreign keys
    if (foreignKeys && foreignKeys.length > 0) {
      schema.foreignKeys = foreignKeys;
    }

    // Add indexes
    if (indexes && indexes.length > 0) {
      schema.indexes = indexes;
    }

    return schema;
  }

  /**
   * Create table in database
   */
  private createTableInDb(db: LinesDB<any>, schema: any): void {
    const columns = schema.columns.map((col: any) => {
      let colDef = `${this.quoteIdentifier(col.name)} ${col.type.toUpperCase()}`;
      if (col.primaryKey) {
        colDef += ' PRIMARY KEY';
      }
      return colDef;
    });

    // Add foreign key constraints
    if (schema.foreignKeys && schema.foreignKeys.length > 0) {
      for (const fk of schema.foreignKeys) {
        columns.push(
          `FOREIGN KEY (${this.quoteIdentifier(fk.column)}) REFERENCES ${this.quoteIdentifier(fk.references.table)}(${this.quoteIdentifier(fk.references.column)})`,
        );
      }
    }

    const sql = `CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(schema.name)} (${columns.join(', ')})`;
    db.execute(sql);

    // Create indexes
    if (schema.indexes && schema.indexes.length > 0) {
      for (const index of schema.indexes) {
        const indexName = index.name || `idx_${schema.name}_${index.columns.join('_')}`;
        const uniqueKeyword = index.unique ? 'UNIQUE' : '';
        const indexColumns = index.columns
          .map((col: string) => this.quoteIdentifier(col))
          .join(', ');
        const indexSql = `CREATE ${uniqueKeyword} INDEX IF NOT EXISTS ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(schema.name)} (${indexColumns})`;
        db.execute(indexSql);
      }
    }
  }

  /**
   * Insert a row into database
   */
  private insertRowIntoDb(db: LinesDB<any>, tableName: string, schema: any, row: any): void {
    const columnNames = schema.columns.map((col: any) => col.name);
    const quotedColumns = columnNames.map((name: string) => this.quoteIdentifier(name));
    const placeholders = columnNames.map(() => '?').join(', ');
    const sql = `INSERT INTO ${this.quoteIdentifier(tableName)} (${quotedColumns.join(', ')}) VALUES (${placeholders})`;

    const values = columnNames.map((col: string) => {
      const value = row[col];
      if (value === null || value === undefined) return null;
      if (typeof value === 'object') return JSON.stringify(value);
      if (typeof value === 'boolean') return value ? 1 : 0;
      return value;
    });

    db.execute(sql, values);
  }

  /**
   * Analyze constraint error and extract detailed information
   */
  private analyzeConstraintError(
    error: any,
    file: string,
    tableName: string,
    rowIndex: number,
    row: any,
    foreignKeys: any[],
    db: LinesDB<any>,
  ): ValidationErrorDetail | null {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Foreign key constraint
    if (errorMessage.includes('FOREIGN KEY constraint failed')) {
      // Find which foreign key failed
      for (const fk of foreignKeys) {
        const fkValue = row[fk.column];
        if (fkValue === null || fkValue === undefined) continue;

        // Check if referenced value exists
        try {
          const result = db.query(
            `SELECT COUNT(*) as count FROM ${this.quoteIdentifier(fk.references.table)} WHERE ${this.quoteIdentifier(fk.references.column)} = ?`,
            [fkValue],
          );
          if (result.length > 0 && (result[0] as any).count === 0) {
            return {
              file,
              tableName,
              rowIndex,
              issues: [],
              type: 'foreignKey',
              foreignKeyError: {
                column: fk.column,
                value: fkValue,
                referencedTable: fk.references.table,
                referencedColumn: fk.references.column,
              },
            };
          }
        } catch (_) {
          // Referenced table doesn't exist yet
        }
      }
    }

    // Other constraint errors (primary key, unique, etc.)
    return {
      file,
      tableName,
      rowIndex,
      issues: [
        {
          message: errorMessage,
          path: [],
        },
      ],
      type: 'schema',
    };
  }

  /**
   * Quote SQL identifier
   */
  private quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
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

    // If schema validation passed, validate database constraints
    if (errors.length === 0) {
      const dirPath = dirname(filePath);

      // Get all JSONL files in the directory
      const entries = await readdir(dirPath, { withFileTypes: true });
      const allJsonlFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => join(dirPath, entry.name));

      // Validate database constraints (including foreign keys)
      const dbErrors = await this.validateWithDatabase(dirPath, allJsonlFiles);
      // Only include errors for the current file
      errors.push(...dbErrors.filter((e) => e.file === filePath));
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  }
}
