import { createDatabase, type SQLiteDatabase } from './sqlite-adapter.js';
import { JsonlReader } from './jsonl-reader.js';
import { JsonlWriter } from './jsonl-writer.js';
import { SchemaLoader } from './schema-loader.js';
import { DirectoryScanner } from './directory-scanner.js';
import { hasBackward } from './schema.js';
import type {
  DatabaseConfig,
  TableSchema,
  JsonObject,
  TableConfig,
  StandardSchema,
  StandardSchemaIssue,
  ValidationError,
  Table,
  TableDefs,
  WhereCondition,
} from './types.js';
import type { BiDirectionalSchema } from './schema.js';

export class LinesDB<Tables extends TableDefs> {
  private db: SQLiteDatabase;
  private config: DatabaseConfig<Tables>;
  private schemas: Map<string, TableSchema> = new Map();
  private validationSchemas: Map<string, StandardSchema | undefined> = new Map();
  private tables: Map<string, TableConfig> = new Map();
  private inTransaction: boolean = false;

  private constructor(config: DatabaseConfig<Tables>, dbPath?: string) {
    this.config = config;
    this.db = createDatabase(dbPath ?? ':memory:');
  }

  static create<Tables extends TableDefs>(
    config: DatabaseConfig<Tables>,
    dbPath?: string,
  ): LinesDB<Tables> {
    return new LinesDB<Tables>(config, dbPath);
  }

  /**
   * Initialize database by loading all JSONL files
   */
  async initialize(): Promise<void> {
    // Scan directory for JSONL files
    this.tables = await DirectoryScanner.scanDirectory(this.config.dataDir);

    // Load all tables
    for (const [tableName, tableConfig] of this.tables) {
      try {
        await this.loadTable(tableName, tableConfig);
      } catch (error) {
        // Log error but continue loading other tables
        console.warn(
          `Warning: Failed to load table '${tableName}':`,
          error instanceof Error ? error.message : String(error),
        );
        // Remove the failed table from the tables map
        this.tables.delete(tableName);
      }
    }
  }

  /**
   * Load a single table from JSONL file
   */
  private async loadTable(tableName: string, config: TableConfig): Promise<void> {
    // Read JSONL file
    const data = await JsonlReader.read(config.jsonlPath);

    if (data.length === 0) {
      return;
    }

    // Load validation schema if provided or try to auto-load
    let validationSchema = config.validationSchema;
    if (!validationSchema) {
      try {
        validationSchema = await SchemaLoader.loadSchema(config.jsonlPath);
      } catch (error) {
        // Schema file not found or failed to load - this is OK, table can still be used without validation
      }
    }
    this.validationSchemas.set(tableName, validationSchema);

    // Determine schema
    let schema: TableSchema;
    if (config.schema) {
      schema = config.schema;
    } else if (config.autoInferSchema !== false) {
      schema = JsonlReader.inferSchema(tableName, data);
    } else {
      throw new Error(`No schema provided for table ${tableName} and autoInferSchema is disabled`);
    }

    // Enhance schema with constraints from validation schema (if available)
    if (validationSchema) {
      const biSchema = validationSchema as BiDirectionalSchema;
      if (biSchema.primaryKey && !schema.columns.some((col) => col.primaryKey)) {
        // Add primary key constraint to columns
        for (const pkColumn of biSchema.primaryKey) {
          const col = schema.columns.find((c) => c.name === pkColumn);
          if (col) {
            col.primaryKey = true;
          }
        }
      }
      if (biSchema.foreignKeys) {
        schema.foreignKeys = biSchema.foreignKeys;
      }
      if (biSchema.indexes) {
        schema.indexes = biSchema.indexes;
      }
    }

    this.schemas.set(tableName, schema);

    // Create table
    this.createTable(schema);

    // Validate data before inserting
    const validationErrors: Array<{
      rowIndex: number;
      rowData: JsonObject;
      error: ValidationError;
    }> = [];

    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      try {
        this.validateData(tableName, row);
      } catch (error) {
        if (error instanceof Error && error.name === 'ValidationError') {
          validationErrors.push({
            rowIndex,
            rowData: row,
            error: error as ValidationError,
          });
        } else {
          throw error;
        }
      }
    }

    if (validationErrors.length > 0) {
      const enhancedError = new Error(
        `Validation failed for ${validationErrors.length} row(s) in table ${tableName}`,
      );
      enhancedError.name = 'ValidationError';
      (enhancedError as unknown as { validationErrors: typeof validationErrors }).validationErrors =
        validationErrors;
      (enhancedError as unknown as { issues: ReadonlyArray<StandardSchemaIssue> }).issues =
        validationErrors[0].error.issues;
      throw enhancedError;
    }

    this.insertData(tableName, schema, data);
  }

  /**
   * Create table in SQLite with constraints and indexes
   */
  private createTable(schema: TableSchema): void {
    // Enable foreign key constraints
    this.db.exec('PRAGMA foreign_keys = ON');

    // Quote table name to handle special characters
    const quotedTableName = this.quoteTableName(schema.name);

    const columnDefs = schema.columns.map((col) => {
      // JSON type is stored as TEXT in SQLite
      const sqlType = col.type === 'JSON' ? 'TEXT' : col.type;
      const parts = [this.quoteIdentifier(col.name), sqlType];
      if (col.primaryKey) parts.push('PRIMARY KEY');
      if (col.notNull) parts.push('NOT NULL');
      if (col.unique) parts.push('UNIQUE');
      return parts.join(' ');
    });

    // Add foreign key constraints
    const foreignKeyDefs: string[] = [];
    if (schema.foreignKeys && schema.foreignKeys.length > 0) {
      for (const fk of schema.foreignKeys) {
        const fkParts = [
          `FOREIGN KEY (${fk.columns.map((col) => this.quoteIdentifier(col)).join(', ')})`,
          `REFERENCES ${this.quoteTableName(fk.references.table)}(${fk.references.columns
            .map((col) => this.quoteIdentifier(col))
            .join(', ')})`,
        ];
        if (fk.onDelete) {
          fkParts.push(`ON DELETE ${fk.onDelete}`);
        }
        if (fk.onUpdate) {
          fkParts.push(`ON UPDATE ${fk.onUpdate}`);
        }
        foreignKeyDefs.push(fkParts.join(' '));
      }
    }

    const allDefs = [...columnDefs, ...foreignKeyDefs];
    const sql = `CREATE TABLE IF NOT EXISTS ${quotedTableName} (${allDefs.join(', ')})`;
    this.db.exec(sql);

    // Create indexes
    if (schema.indexes && schema.indexes.length > 0) {
      for (let i = 0; i < schema.indexes.length; i++) {
        const index = schema.indexes[i];
        // Create safe index name by replacing special characters
        const safeTableName = schema.name.replace(/[^a-zA-Z0-9]/g, '_');
        const resolvedIndexName =
          index.name || `idx_${safeTableName}_${index.columns.join('_')}_${i}`;
        const uniqueKeyword = index.unique ? 'UNIQUE ' : '';
        const indexSql = `CREATE ${uniqueKeyword}INDEX IF NOT EXISTS ${this.quoteIdentifier(resolvedIndexName)} ON ${quotedTableName} (${index.columns
          .map((col) => this.quoteIdentifier(col))
          .join(', ')})`;
        this.db.exec(indexSql);
      }
    }
  }

  /**
   * Quote table name to handle special characters in SQL
   */
  private quoteTableName(tableName: string): string {
    return this.quoteIdentifier(tableName);
  }

  /**
   * Quote identifier for SQL statements, escaping embedded quotes
   */
  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /**
   * Insert data into table
   */
  private insertData(tableName: string, schema: TableSchema, data: JsonObject[]): void {
    const columnNames = schema.columns.map((col) => col.name);
    const quotedColumns = columnNames.map((name) => this.quoteIdentifier(name));
    const placeholders = columnNames.map(() => '?').join(', ');
    const sql = `INSERT INTO ${this.quoteTableName(tableName)} (${quotedColumns.join(', ')}) VALUES (${placeholders})`;

    const stmt = this.db.prepare(sql);

    for (const row of data) {
      const values = columnNames.map((col) => this.normalizeValue(row[col]));
      stmt.run(...values);
    }
  }

  /**
   * Execute a raw SQL query
   */
  query<T = unknown>(
    sql: string,
    params: (string | number | bigint | null | Uint8Array)[] = [],
  ): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  /**
   * Execute a SQL query that returns a single row
   */
  queryOne<T = unknown>(
    sql: string,
    params: (string | number | bigint | null | Uint8Array)[] = [],
  ): T | null {
    const stmt = this.db.prepare(sql);
    const result = stmt.get(...params);
    return result === undefined ? null : (result as T);
  }

  /**
   * Execute a SQL statement (INSERT, UPDATE, DELETE)
   */
  execute(
    sql: string,
    params: (string | number | bigint | null | Uint8Array)[] = [],
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  /**
   * Find rows by condition (supports OR/AND with arrays and function filters)
   * If where is not provided, returns all rows
   */
  find<K extends keyof Tables & string>(tableName: K, where?: WhereCondition<Tables[K]>) {
    // If no where condition, return all rows
    if (where === undefined) {
      const rows = this.query(`SELECT * FROM ${this.quoteTableName(tableName)}`);
      return rows.map((row) => this.deserializeRow(tableName, row)) as Tables[K][];
    }

    // Handle empty array - should return no results
    if (Array.isArray(where) && where.length === 0) {
      return [];
    }

    const { sql, values, functionFilters, hasOrWithFunctionFilters } = this.buildWhereClause(where);

    let rows: Tables[K][];

    // If OR condition has function filters, get all rows and evaluate in JS
    if (hasOrWithFunctionFilters) {
      const rawRows = this.query(`SELECT * FROM ${this.quoteTableName(tableName)}`);
      rows = rawRows.map((row) => this.deserializeRow(tableName, row)) as Tables[K][];
      return this.applyOrConditionWithFilters(rows, where as WhereCondition<Tables[K]>);
    }

    // Normal case: use SQL WHERE clause
    if (sql) {
      const rawRows = this.query(
        `SELECT * FROM ${this.quoteTableName(tableName)} WHERE ${sql}`,
        values,
      );
      rows = rawRows.map((row) => this.deserializeRow(tableName, row)) as Tables[K][];
    } else {
      // If only function filters (AND case), get all rows
      const rawRows = this.query(`SELECT * FROM ${this.quoteTableName(tableName)}`);
      rows = rawRows.map((row) => this.deserializeRow(tableName, row)) as Tables[K][];
    }

    // Apply function filters for AND conditions
    return this.applyFunctionFilters(rows, functionFilters);
  }

  /**
   * Find a single row by condition (supports OR/AND with arrays and function filters)
   */
  findOne<K extends keyof Tables & string>(tableName: K, where: WhereCondition<Tables[K]>) {
    const { sql, values, functionFilters } = this.buildWhereClause(where);

    let rows: Tables[K][];
    if (sql) {
      const rawRows = this.query(
        `SELECT * FROM ${this.quoteTableName(tableName)} WHERE ${sql}`,
        values,
      );
      rows = rawRows.map((row) => this.deserializeRow(tableName, row)) as Tables[K][];
    } else {
      // If only function filters, get all rows
      const rawRows = this.query(`SELECT * FROM ${this.quoteTableName(tableName)}`);
      rows = rawRows.map((row) => this.deserializeRow(tableName, row)) as Tables[K][];
    }

    // Apply function filters and return first match
    const filtered = this.applyFunctionFilters(rows, functionFilters);
    return filtered.length > 0 ? filtered[0] : null;
  }

  /**
   * Deserialize JSON columns in a row
   */
  private deserializeRow<T>(tableName: string, row: T): T {
    const schema = this.schemas.get(tableName);
    if (!schema) return row;

    const deserializedRow = { ...row } as Record<string, unknown>;

    for (const column of schema.columns) {
      const colName = column.name;
      if (!(colName in deserializedRow)) continue;

      const value = deserializedRow[colName];

      if (column.type === 'JSON' && typeof value === 'string') {
        try {
          deserializedRow[colName] = JSON.parse(value);
        } catch (error) {
          // If parsing fails, keep the original value
          console.warn(`Failed to parse JSON column ${colName}:`, error);
        }
        continue;
      }

      if (column.valueType === 'boolean') {
        if (typeof value === 'number') {
          deserializedRow[colName] = value === 0 ? false : true;
        } else if (typeof value === 'bigint') {
          deserializedRow[colName] = value === 0n ? false : true;
        }
      }
    }

    return deserializedRow as T;
  }

  /**
   * Validate data using StandardSchema
   * Note: Only synchronous validation is supported
   */
  private validateData(tableName: string, data: unknown): void {
    const schema = this.validationSchemas.get(tableName);
    if (!schema) {
      return;
    }

    const result = schema['~standard'].validate(data);

    // Only synchronous validation is supported
    if (result instanceof Promise) {
      throw new Error(
        'Asynchronous validation is not supported. Please use synchronous validation schemas.',
      );
    }

    if (result.issues && result.issues.length > 0) {
      // Format detailed error message with all validation issues
      const issueMessages = result.issues
        .map((issue) => {
          // Handle path: can be array of PathSegment or undefined
          let pathStr = 'root';
          if (issue.path && issue.path.length > 0) {
            pathStr = issue.path
              .map((segment) => {
                // PathSegment can be { key: PropertyKey } or just PropertyKey
                if (typeof segment === 'object' && segment !== null && 'key' in segment) {
                  return String(segment.key);
                }
                return String(segment);
              })
              .join('.');
          }
          return `  - ${pathStr}: ${issue.message}`;
        })
        .join('\n');

      const errorMessage = `Validation failed for table '${tableName}':\n${issueMessages}`;
      const error = new Error(errorMessage) as ValidationError;
      error.name = 'ValidationError';
      error.issues = result.issues;
      throw error;
    }
  }

  /**
   * Insert a row into a table with validation
   */
  insert<K extends keyof Tables & string>(
    tableName: K,
    data: Tables[K],
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    // Validate if schema exists
    this.validateData(tableName, data);

    const schema = this.schemas.get(tableName);
    if (!schema) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    const columnNames = Object.keys(data);
    const quotedColumns = columnNames.map((col) => this.quoteIdentifier(col));
    const placeholders = columnNames.map(() => '?').join(', ');
    const sql = `INSERT INTO ${this.quoteTableName(tableName)} (${quotedColumns.join(', ')}) VALUES (${placeholders})`;

    const values = Object.values(data).map((v) => this.normalizeValue(v));
    const result = this.execute(sql, values);

    // Auto-sync if not in transaction
    if (!this.inTransaction) {
      this.syncTable(tableName).catch((err) => {
        console.error(`Failed to sync table ${tableName}:`, err);
      });
    }

    return result;
  }

  /**
   * Batch insert rows with validation per record.
   */
  batchInsert<K extends keyof Tables & string>(
    tableName: K,
    records: Tables[K][],
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    const schema = this.schemas.get(tableName);
    if (!schema) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    if (records.length === 0) {
      return { changes: 0, lastInsertRowid: 0 };
    }

    let totalChanges = 0n;
    let lastRowid = 0n;

    for (const record of records) {
      this.validateData(tableName, record);

      const columnNames = Object.keys(record);
      const quotedColumns = columnNames.map((col) => this.quoteIdentifier(col));
      const placeholders = columnNames.map(() => '?').join(', ');
      const sql = `INSERT INTO ${this.quoteTableName(tableName)} (${quotedColumns.join(', ')}) VALUES (${placeholders})`;

      const values = columnNames.map((col) => this.normalizeValue(record[col as keyof Tables[K]]));

      const result = this.execute(sql, values);
      totalChanges += BigInt(result.changes);
      lastRowid = BigInt(result.lastInsertRowid);
    }

    if (!this.inTransaction) {
      this.syncTable(tableName).catch((err) => {
        console.error(`Failed to sync table ${tableName}:`, err);
      });
    }

    return {
      changes: totalChanges,
      lastInsertRowid: lastRowid,
    };
  }

  /**
   * Update rows in a table with validation (supports OR/AND with arrays)
   * Note: Function filters are not supported for update operations
   * Note: By default, validation is enabled. For partial updates, existing data is fetched
   * and merged before validation. Set options.validate = false to disable validation.
   */
  update<K extends keyof Tables & string>(
    tableName: K,
    data: Partial<Tables[K]>,
    where: WhereCondition<Tables[K]>,
    options?: { validate?: boolean },
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    const schema = this.schemas.get(tableName);
    if (!schema) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    // Validate by default (can be disabled with validate: false)
    const shouldValidate = options?.validate !== false;
    const hasValidationSchema = this.validationSchemas.has(tableName);

    if (shouldValidate && hasValidationSchema) {
      // Get existing rows to merge with partial data
      const existingRows = this.find(tableName, where);

      // Validate each merged row
      for (const existingRow of existingRows) {
        const mergedData = { ...existingRow, ...data };
        this.validateData(tableName, mergedData);
      }
    }

    const { sql: whereSql, values: whereValues, functionFilters } = this.buildWhereClause(where);

    if (functionFilters.length > 0) {
      throw new Error('Function filters are not supported in update operations');
    }

    const setClauses = Object.keys(data)
      .map((key) => `${this.quoteIdentifier(key)} = ?`)
      .join(', ');
    const sql = `UPDATE ${this.quoteTableName(tableName)} SET ${setClauses} WHERE ${whereSql}`;

    const values = [...Object.values(data).map((v) => this.normalizeValue(v)), ...whereValues];

    const result = this.execute(sql, values);

    // Auto-sync if not in transaction
    if (!this.inTransaction) {
      this.syncTable(tableName).catch((err) => {
        console.error(`Failed to sync table ${tableName}:`, err);
      });
    }

    return result;
  }

  /**
   * Batch update rows with record-specific values and validation.
   * Each record must include the primary key to identify the target row.
   * Validation runs once per merged record unless explicitly disabled.
   */
  batchUpdate<K extends keyof Tables & string>(
    tableName: K,
    records: Array<Partial<Tables[K]> & Record<string, unknown>>,
    options?: { validate?: boolean },
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    const schema = this.schemas.get(tableName);
    if (!schema) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    if (records.length === 0) {
      return { changes: 0, lastInsertRowid: 0 };
    }

    // Get primary key column
    const pkColumn = schema.columns.find((col) => col.primaryKey);
    if (!pkColumn) {
      throw new Error(`Table ${tableName} does not have a primary key`);
    }

    const pkName = pkColumn.name;

    // Extract primary key values from records
    const pkValues: unknown[] = [];
    for (const record of records) {
      const pkValue = record[pkName];
      if (pkValue === undefined) {
        throw new Error(
          `Record is missing primary key '${String(pkName)}': ${JSON.stringify(record)}`,
        );
      }
      pkValues.push(pkValue);
    }

    // Validate by default (can be disabled with validate: false)
    const shouldValidate = options?.validate !== false;
    const hasValidationSchema = this.validationSchemas.has(tableName);

    if (shouldValidate && hasValidationSchema) {
      // Build OR condition to fetch all existing rows at once
      const orCondition = pkValues.map((pkValue) => ({
        [pkName]: pkValue,
      })) as WhereCondition<Tables[K]>;

      // Fetch all existing rows in one query
      const existingRows = this.find(tableName, orCondition);

      // Create a map for fast lookup: pkValue -> existingRow
      const existingRowsMap = new Map<unknown, Tables[K]>();
      for (const row of existingRows) {
        const pkValue = (row as Record<string, unknown>)[pkName];
        existingRowsMap.set(pkValue, row);
      }

      // Validate each merged record and collect all errors
      const validationErrors: Array<{
        rowIndex: number;
        rowData: unknown;
        pkValue: unknown;
        error: ValidationError;
      }> = [];

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const pkValue = record[pkName];
        const existingRow = existingRowsMap.get(pkValue);

        if (!existingRow) {
          throw new Error(
            `No existing row found with ${String(pkName)}=${JSON.stringify(pkValue)}`,
          );
        }

        const mergedData = { ...existingRow, ...record };

        try {
          this.validateData(tableName, mergedData);
        } catch (error) {
          // Collect validation errors instead of throwing immediately
          if (error instanceof Error && error.name === 'ValidationError') {
            validationErrors.push({
              rowIndex: i,
              rowData: mergedData,
              pkValue,
              error: error as ValidationError,
            });
          } else {
            throw error;
          }
        }
      }

      // If there are validation errors, throw with all error information
      if (validationErrors.length > 0) {
        const enhancedError = new Error(
          `Validation failed for ${validationErrors.length} row(s)`,
        ) as ValidationError & { validationErrors: typeof validationErrors };
        enhancedError.name = 'ValidationError';
        enhancedError.validationErrors = validationErrors;
        // For backward compatibility, include issues from first error
        enhancedError.issues = validationErrors[0].error.issues;
        throw enhancedError;
      }
    }

    // All validations passed - perform updates
    let totalChanges = 0n;
    let lastRowid = 0n;

    for (const record of records) {
      const pkValue = record[pkName];
      const where = { [pkName]: pkValue } as WhereCondition<Tables[K]>;

      // Call update without validation (already validated above)
      const result = this.update(tableName, record as Partial<Tables[K]>, where, {
        validate: false,
      });

      totalChanges += BigInt(result.changes);
      lastRowid = BigInt(result.lastInsertRowid);
    }

    return {
      changes: totalChanges,
      lastInsertRowid: lastRowid,
    };
  }

  /**
   * Delete rows from a table (supports OR/AND with arrays)
   * Note: Function filters are not supported for delete operations
   */
  delete<K extends keyof Tables & string>(
    tableName: K,
    where: WhereCondition<Tables[K]>,
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    const schema = this.schemas.get(tableName);
    if (!schema) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    const { sql: whereSql, values, functionFilters } = this.buildWhereClause(where);

    if (functionFilters.length > 0) {
      throw new Error('Function filters are not supported in delete operations');
    }

    const sql = `DELETE FROM ${this.quoteTableName(tableName)} WHERE ${whereSql}`;
    const result = this.execute(sql, values);

    // Auto-sync if not in transaction
    if (!this.inTransaction) {
      this.syncTable(tableName).catch((err) => {
        console.error(`Failed to sync table ${tableName}:`, err);
      });
    }

    return result;
  }

  /**
   * Batch delete rows by primary key.
   */
  batchDelete<K extends keyof Tables & string>(
    tableName: K,
    records: Array<Partial<Tables[K]> & Record<string, unknown>>,
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    const schema = this.schemas.get(tableName);
    if (!schema) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    if (records.length === 0) {
      return { changes: 0, lastInsertRowid: 0 };
    }

    const pkColumn = schema.columns.find((col) => col.primaryKey);
    if (!pkColumn) {
      throw new Error(`Table ${tableName} does not have a primary key`);
    }
    const pkName = pkColumn.name;

    const pkValues = records.map((record, index) => {
      const pkValue = record[pkName as keyof Tables[K]];
      if (pkValue === undefined) {
        throw new Error(`Record at index ${index} is missing primary key '${String(pkName)}'`);
      }
      return pkValue;
    });

    const placeholders = pkValues.map(() => '?').join(', ');
    const sql = `DELETE FROM ${this.quoteTableName(tableName)} WHERE ${this.quoteIdentifier(pkName)} IN (${placeholders})`;
    const values = pkValues.map((value) => this.normalizeValue(value));

    const result = this.execute(sql, values);

    if (!this.inTransaction) {
      this.syncTable(tableName).catch((err) => {
        console.error(`Failed to sync table ${tableName}:`, err);
      });
    }

    return {
      changes: BigInt(result.changes),
      lastInsertRowid: BigInt(result.lastInsertRowid),
    };
  }

  /**
   * Normalize value for SQLite
   */
  private normalizeValue(value: unknown): string | number | bigint | null | Uint8Array {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      return value;
    if (value instanceof Uint8Array) return value;
    // For objects, convert to JSON string
    return JSON.stringify(value);
  }

  /**
   * Build WHERE clause from condition (supports OR/AND with arrays and functions)
   */
  private buildWhereClause<T extends Record<string, unknown>>(
    condition: WhereCondition<T>,
  ): {
    sql: string;
    values: Array<string | number | bigint | null | Uint8Array>;
    functionFilters: Array<{
      key: string;
      fn: (value: unknown) => boolean;
    }>;
    hasOrWithFunctionFilters: boolean;
  } {
    const values: Array<string | number | bigint | null | Uint8Array> = [];
    const functionFilters: Array<{ key: string; fn: (value: unknown) => boolean }> = [];
    let hasOrWithFunctionFilters = false;

    const buildCondition = (cond: WhereCondition<T>, isInOr = false): string => {
      // Handle array (OR conditions)
      if (Array.isArray(cond)) {
        const clauses = cond
          .map((item) => {
            const clause = Array.isArray(item)
              ? buildCondition(item, true)
              : buildCondition(item, true);
            return clause ? `(${clause})` : '';
          })
          .filter((clause) => clause !== ''); // Filter out empty clauses

        return clauses.join(' OR ');
      }

      // Handle object (AND conditions)
      const conditions: string[] = [];
      let hasFunctionFilter = false;
      for (const [key, value] of Object.entries(cond)) {
        if (typeof value === 'function') {
          // Function filter - will be applied later
          functionFilters.push({ key, fn: value as (value: unknown) => boolean });
          hasFunctionFilter = true;
        } else {
          // Regular value
          conditions.push(`${this.quoteIdentifier(key)} = ?`);
          values.push(this.normalizeValue(value));
        }
      }

      if (isInOr && hasFunctionFilter) {
        hasOrWithFunctionFilters = true;
      }

      return conditions.join(' AND ');
    };

    const sql = buildCondition(condition);
    return { sql, values, functionFilters, hasOrWithFunctionFilters };
  }

  /**
   * Apply OR condition with function filters by evaluating each row against the condition
   */
  private applyOrConditionWithFilters<T extends Record<string, unknown>>(
    rows: T[],
    condition: WhereCondition<T>,
  ): T[] {
    return rows.filter((row) => this.matchesOrCondition(row, condition));
  }

  /**
   * Check if a row matches an OR/AND condition (recursively)
   */
  private matchesOrCondition<T extends Record<string, unknown>>(
    row: T,
    condition: WhereCondition<T>,
  ): boolean {
    // Handle array (OR conditions)
    if (Array.isArray(condition)) {
      return condition.some((item) => this.matchesOrCondition(row, item));
    }

    // Handle object (AND conditions)
    return Object.entries(condition).every(([key, value]) => {
      const rowValue = row[key as keyof T];
      if (typeof value === 'function') {
        return (value as (value: unknown) => boolean)(rowValue);
      }
      return rowValue === value;
    });
  }

  /**
   * Apply function filters to rows
   */
  private applyFunctionFilters<T extends Record<string, unknown>>(
    rows: T[],
    functionFilters: Array<{ key: string; fn: (value: unknown) => boolean }>,
  ): T[] {
    if (functionFilters.length === 0) return rows;

    return rows.filter((row) => {
      return functionFilters.every(({ key, fn }) => {
        const value = row[key as keyof T];
        return fn(value);
      });
    });
  }

  /**
   * Get table schema
   */
  getSchema(tableName: string): TableSchema | undefined {
    return this.schemas.get(tableName);
  }

  /**
   * Get all table names
   */
  getTableNames(): string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * Sync a specific table back to its JSONL file
   * Uses backward transformation when available
   */
  private async syncTable(tableName: string): Promise<void> {
    const tableConfig = this.tables.get(tableName);
    if (!tableConfig) {
      throw new Error(`Table ${tableName} not found`);
    }

    // Get all rows from the table
    const rows = this.query<JsonObject>(`SELECT * FROM ${this.quoteTableName(tableName)}`);

    // Deserialize JSON columns
    const deserializedRows = rows.map((row) => this.deserializeRow(tableName, row));

    // Apply backward transformation if available
    const validationSchema = this.validationSchemas.get(tableName);
    let finalRows = deserializedRows;

    if (validationSchema && hasBackward(validationSchema)) {
      const biSchema = validationSchema as BiDirectionalSchema<Table, Table>;
      finalRows = deserializedRows.map((row) => biSchema.backward!(row) as JsonObject);
    }

    // Write back to JSONL file
    await JsonlWriter.write(tableConfig.jsonlPath, finalRows);
  }

  /**
   * Sync database changes back to JSONL files
   * Uses backward transformation when available
   */
  async sync(): Promise<void> {
    for (const [tableName] of this.tables) {
      await this.syncTable(tableName);
    }
  }

  /**
   * Execute a function within a transaction
   * Automatically commits on success or rolls back on error
   */
  async transaction<T>(fn: (tx: LinesDB<Tables>) => Promise<T> | T): Promise<T> {
    if (this.inTransaction) {
      throw new Error('Nested transactions are not supported');
    }

    this.db.exec('BEGIN TRANSACTION');
    this.inTransaction = true;

    try {
      const result = await fn(this);
      this.db.exec('COMMIT');
      this.inTransaction = false;

      // Sync all tables after successful commit
      await this.sync();

      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.inTransaction = false;
      throw error;
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    try {
      this.db.close();
    } catch (_error) {
      // Ignore errors if database is already closed
    }
  }

  /**
   * Get the underlying SQLite database instance
   */
  getDb(): SQLiteDatabase {
    return this.db;
  }
}
