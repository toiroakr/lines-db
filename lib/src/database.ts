import { createDatabase, type SQLiteDatabase } from './sqlite-adapter.js';
import { JsonlReader, hashJsonlContent } from './jsonl-reader.js';
import { JsonlWriter } from './jsonl-writer.js';
import { SchemaLoader } from './schema-loader.js';
import { DirectoryScanner } from './directory-scanner.js';
import { hasBackward } from './schema.js';
import { keepUnknownFields, mergeFields } from './merge-fields.js';
import { findSchemaFile } from './schema-extensions.js';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  DatabaseConfig,
  TableSchema,
  JsonObject,
  TableConfig,
  StandardSchema,
  ValidationError,
  JsonlConflictError,
  Table,
  TableDefs,
  WriteFilledValues,
  WhereCondition,
  ValidationResult,
  ValidationErrorDetail,
  TableValidationResult,
  ForeignKeyDefinition,
} from './types.js';
import type { BiDirectionalSchema } from './schema.js';
import { type Result, ok, err, toError, unwrap } from './result.js';

/**
 * Options for {@link LinesDB.update}
 */
export interface UpdateOptions {
  /** Validate each updated row against the table's schema. Defaults to true */
  validate?: boolean;
  /**
   * Fields to leave to the schema: each updated row stores the value its schema fills in for them, and
   * a write-back removes them from the row's line
   */
  resetToDefault?: readonly string[];
}

/**
 * Options for {@link LinesDB.sync}
 */
export interface SyncOptions {
  /**
   * Fields written back to the JSONL file.
   * When provided, only these fields are taken from the database and merged into the matching
   * JSONL line; every other field keeps the value the file already had. An empty list takes no
   * field from the database, so existing lines keep every value they hold - rows added to or
   * removed from the database are still reflected.
   * Defaults to `writeBackFields` from the database config, or writing every field of the row.
   */
  fields?: readonly string[];
  /**
   * Which values the validation schema fills in to write into the file.
   * Defaults to `writeFilledValues` from the database config, or `'all'`.
   */
  writeFilledValues?: WriteFilledValues;
}

/**
 * Sync options plus how to treat fields a table does not have: a sync asked for one table by name
 * rejects them, while a sync covering every table just leaves them out.
 */
type InternalSyncOptions = SyncOptions & { strictFields?: boolean };

/** The rows a table is about to be written back as, and what its file held before */
interface PreparedWriteBack {
  tableName: string;
  jsonlPath: string;
  rows: JsonObject[];
  /** Undefined when the file did not exist */
  previousContent: string | undefined;
}

/** The fields set and reset on a row since its table was last written back */
interface FieldChanges {
  set: Set<string>;
  reset: Set<string>;
  /** Whether the row was inserted, rather than read from a line */
  inserted: boolean;
}

function cloneFieldChanges(changes: Map<string, Map<string, FieldChanges>>): Map<string, Map<string, FieldChanges>> {
  return new Map(
    Array.from(changes, ([tableName, byRow]) => [
      tableName,
      new Map(
        Array.from(byRow, ([rowid, row]) => [
          rowid,
          { set: new Set(row.set), reset: new Set(row.reset), inserted: row.inserted },
        ]),
      ),
    ]),
  );
}

/** Column alias a query reads a row's rowid under, next to its fields */
const ROWID_ALIAS = '__lines_db_rowid';

/** The fields a row given to an insert names, leaving out those it leaves undefined */
function givenFields(row: object): string[] {
  return Object.entries(row)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}

/** Whether a value read from SQLite and one about to be stored are the same */
function sameStoredValue(stored: unknown, next: unknown): boolean {
  if (stored === null || stored === undefined || next === null) return (stored ?? null) === next;
  return String(stored) === String(next);
}

/** The JSONL file a row was read from, and its index among that file's rows */
interface RowOrigin {
  file: string;
  rowIndex: number;
}

export class LinesDB<Tables extends TableDefs> {
  private db: SQLiteDatabase;
  private config: DatabaseConfig<Tables>;
  private schemas: Map<string, TableSchema> = new Map();
  private validationSchemas: Map<string, StandardSchema | undefined> = new Map();
  private tables: Map<string, TableConfig> = new Map();
  private inTransaction: boolean = false;
  private syncQueue: Map<string, Promise<void>> = new Map();
  /** The order a table's schema declares its fields in, as the rows it computes list them */
  private keyOrders: Map<string, Set<string>> = new Map();
  /** The row each rowid was inserted from, per table loaded with detailed validation */
  private rowOriginsByRowid: Map<string, Map<string, RowOrigin>> = new Map();
  /**
   * The fields set and reset on each row (by rowid) since its table was last written back: a line
   * holds the fields a user wrote, so only what changed since it was written needs remembering
   */
  private fieldChanges: Map<string, Map<string, FieldChanges>> = new Map();
  /**
   * The tables raw SQL may have changed since they were last written back: which fields it set is
   * unknown, so their rows are written back whole
   */
  private rawSqlTables: Set<string> = new Set();
  /** Whether a transaction() call is past its guard but has not begun yet */
  private transactionStarting = false;
  /** The tables changed in the running transaction, or 'all' once raw SQL may have changed any */
  private transactionChanges: Set<string> | 'all' | undefined;
  /** Hash of each JSONL file's content as this database last read or wrote it */
  private fileHashes: Map<string, string> = new Map();
  /**
   * Hash of each JSONL file's content as this database last read or wrote it, kept for a table that
   * failed to load too: unlike fileHashes, it only tells whether a file changed and guards no write
   */
  private observedHashes: Map<string, string> = new Map();
  /** The JSONL files the data directories held when the tables were scanned */
  private scannedJsonlFiles: string[] = [];
  /** Each table's schema file and a hash of its content as the tables were loaded, or '' for none */
  private schemaFileStates: Map<string, string> = new Map();

  private constructor(config: DatabaseConfig<Tables>, dbPath?: string) {
    this.config = config;
    this.db = createDatabase(dbPath ?? ':memory:');
  }

  static create<Tables extends TableDefs>(config: DatabaseConfig<Tables>, dbPath?: string): LinesDB<Tables> {
    return new LinesDB<Tables>(config, dbPath);
  }

  /**
   * Initialize database by loading all JSONL files or a specific table
   * Uses dependency resolution to ensure foreign key references are loaded in correct order
   * @param options Optional configuration for initialization
   * @param options.tableName Optional table name to initialize. If not provided, initializes all tables
   * @param options.detailedValidate If true, performs detailed validation by inserting rows one by one to catch constraint violations
   * @param options.transform Optional transform function to apply to rows before validation (only applied to the specified tableName)
   * @returns Result wrapping a ValidationResult with validation status, errors, and warnings
   */
  async initialize(options?: {
    tableName?: string;
    detailedValidate?: boolean;
    transform?: (row: JsonObject) => JsonObject;
  }): Promise<Result<ValidationResult, Error>> {
    try {
      return ok(await this.initializeInternal(options));
    } catch (error) {
      return err(toError(error));
    }
  }

  private async initializeInternal(options?: {
    tableName?: string;
    detailedValidate?: boolean;
    transform?: (row: JsonObject) => JsonObject;
  }): Promise<ValidationResult> {
    if (this.hasSeveralDataDirs() && !this.config.schemaDir) {
      throw new Error(
        'schemaDir is required when dataDir lists several directories: a data set directory does not hold the schemas of its tables',
      );
    }

    this.db.exec('PRAGMA query_only = OFF');
    try {
      return await this.loadTables(options);
    } finally {
      // Raw SQL through execute() or query() must not change a database whose changes cannot be written back
      if (this.hasSeveralDataDirs()) {
        this.db.exec('PRAGMA query_only = ON');
      }
    }
  }

  private async loadTables(options?: {
    tableName?: string;
    detailedValidate?: boolean;
    transform?: (row: JsonObject) => JsonObject;
  }): Promise<ValidationResult> {
    const allErrors: ValidationErrorDetail[] = [];
    const allWarnings: string[] = [];
    const allRowCounts = new Map<string, number>();
    const tableName = options?.tableName;
    const detailedValidate = options?.detailedValidate ?? false;
    const transform = options?.transform;

    // Scan directory for JSONL files
    this.tables = await DirectoryScanner.scanDirectory(this.config.dataDir);
    this.scannedJsonlFiles = listJsonlFiles(this.tables);
    this.observedHashes.clear();
    this.schemaFileStates.clear();
    for (const [name, config] of this.tables) {
      this.schemaFileStates.set(name, await this.schemaFileState(name, config));
    }

    // Determine which tables to load
    const tablesToLoad = tableName ? [tableName] : Array.from(this.tables.keys());

    // Validate that all requested tables exist BEFORE starting to load
    for (const tableNameToLoad of tablesToLoad) {
      if (!this.tables.has(tableNameToLoad)) {
        const dataDirs = [this.config.dataDir].flat().map((dir) => `'${dir}'`);
        throw new Error(`Table '${tableNameToLoad}' not found in directory ${dataDirs.join(', ')}`);
      }
    }

    // Track loaded tables and tables currently being loaded (for circular dependency detection)
    const loadedTables = new Set<string>();
    const loadingTables = new Set<string>();
    const attemptedTables = new Set<string>(); // Track all attempted tables (loaded or not)
    const allDeferredForeignKeys: Array<{
      tableName: string;
      foreignKey: ForeignKeyDefinition;
      filePath: string;
    }> = [];

    // Load tables with dependency resolution
    for (const tableNameToLoad of tablesToLoad) {
      if (!attemptedTables.has(tableNameToLoad)) {
        // Only apply transform to the specified table
        const tableTransform = tableNameToLoad === tableName ? transform : undefined;
        const {
          errors,
          warnings,
          rowCounts: tableRowCounts,
          deferredForeignKeys,
        } = await this.loadTableWithDependencies(
          tableNameToLoad,
          loadedTables,
          loadingTables,
          attemptedTables,
          detailedValidate,
          tableTransform,
        );
        allErrors.push(...errors);
        allWarnings.push(...warnings);
        allDeferredForeignKeys.push(...deferredForeignKeys);
        for (const [k, v] of tableRowCounts) {
          allRowCounts.set(k, v);
        }
      }
    }

    // Validate deferred foreign keys (from circular dependencies) now that all tables are loaded
    if (detailedValidate && allDeferredForeignKeys.length > 0) {
      for (const { tableName: tName, foreignKey: fk, filePath } of allDeferredForeignKeys) {
        // Only validate if the referenced table was actually loaded
        if (!loadedTables.has(fk.references.table)) {
          continue;
        }
        const deferredErrors = this.validateDeferredForeignKey(tName, fk, filePath);
        allErrors.push(...deferredErrors);
      }
    }

    // Build per-table results
    const tableResults: TableValidationResult[] = tablesToLoad.map((name) => {
      const tableErrors = allErrors.filter((e) => e.tableName === name);
      const tableWarnings = allWarnings.filter((w) => w.includes(`'${name}'`));
      return {
        tableName: name,
        valid: tableErrors.length === 0,
        rowCount: allRowCounts.get(name) ?? 0,
        errors: tableErrors,
        warnings: tableWarnings,
      };
    });

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
      tableResults,
    };
  }

  /**
   * Load a table and its dependencies recursively
   */
  private async loadTableWithDependencies(
    tableName: string,
    loadedTables: Set<string>,
    loadingTables: Set<string>,
    attemptedTables: Set<string>,
    detailedValidate: boolean,
    transform?: (row: JsonObject) => JsonObject,
  ): Promise<{
    errors: ValidationErrorDetail[];
    warnings: string[];
    rowCounts: Map<string, number>;
    deferredForeignKeys: Array<{
      tableName: string;
      foreignKey: ForeignKeyDefinition;
      filePath: string;
    }>;
  }> {
    const errors: ValidationErrorDetail[] = [];
    const warnings: string[] = [];
    const rowCounts = new Map<string, number>();
    const deferredForeignKeys: Array<{
      tableName: string;
      foreignKey: ForeignKeyDefinition;
      filePath: string;
    }> = [];

    // Skip if already attempted (loaded or not)
    if (attemptedTables.has(tableName)) {
      return { errors, warnings, rowCounts, deferredForeignKeys };
    }

    // Mark as attempted
    attemptedTables.add(tableName);

    // Check for circular dependencies
    if (loadingTables.has(tableName)) {
      throw new Error(`Circular dependency detected for table '${tableName}'`);
    }

    // Get table config
    const tableConfig = this.tables.get(tableName);
    if (!tableConfig) {
      throw new Error(`Table configuration not found for '${tableName}'`);
    }

    // Mark as currently loading
    loadingTables.add(tableName);

    try {
      // Load schema module to check for foreign key dependencies
      // We need to load the entire module to access foreignKeys export
      let foreignKeys: BiDirectionalSchema['foreignKeys'];

      try {
        const { pathToFileURL } = await import('node:url');
        const schemaPath = await this.findTableSchemaFile(tableName, tableConfig);
        if (schemaPath) {
          const schemaUrl = pathToFileURL(schemaPath).href;
          const schemaModule = await import(`${schemaUrl}?t=${Date.now()}`);

          // Try to get foreign keys from exported 'schema' or directly from module
          const schemaExport = schemaModule.schema || schemaModule.default;
          foreignKeys = schemaExport?.foreignKeys || schemaModule.foreignKeys;
        }
      } catch {
        // Schema file not found - will continue without validation
      }

      // If there are foreign key dependencies, load them first
      if (foreignKeys && foreignKeys.length > 0) {
        for (const fk of foreignKeys) {
          const referencedTable = fk.references.table;

          // Skip self-referencing foreign keys (e.g., nullable parent_id columns)
          if (referencedTable === tableName) {
            continue;
          }

          if (!attemptedTables.has(referencedTable)) {
            // Check if referenced table exists in our tables map
            if (this.tables.has(referencedTable)) {
              // Dependencies should not have transform applied
              const depResult = await this.loadTableWithDependencies(
                referencedTable,
                loadedTables,
                loadingTables,
                attemptedTables,
                detailedValidate,
                undefined,
              );
              errors.push(...depResult.errors);
              warnings.push(...depResult.warnings);
              deferredForeignKeys.push(...depResult.deferredForeignKeys);
              for (const [k, v] of depResult.rowCounts) {
                rowCounts.set(k, v);
              }
            } else {
              throw new Error(
                `Foreign key reference to non-existent table '${referencedTable}' in table '${tableName}'`,
              );
            }
          }
        }
      }

      // Determine which FK dependencies failed or are circular (attempted but not loaded)
      const failedDependencies = new Set<string>();
      const circularDependencies = new Set<string>();
      if (foreignKeys && foreignKeys.length > 0) {
        for (const fk of foreignKeys) {
          const referencedTable = fk.references.table;
          if (referencedTable === tableName) continue;
          if (attemptedTables.has(referencedTable) && !loadedTables.has(referencedTable)) {
            if (loadingTables.has(referencedTable)) {
              // Circular dependency: table is currently being loaded
              circularDependencies.add(referencedTable);
            } else {
              // Actual failure: table attempted but not loaded
              failedDependencies.add(referencedTable);
            }
          }
        }
        if (failedDependencies.size > 0) {
          for (const dep of failedDependencies) {
            warnings.push(
              `Skipping foreign key validation for table '${tableName}': referenced table '${dep}' has validation errors`,
            );
          }
        }
      }

      // Combine failed and circular dependencies for table loading (both need FK skipping)
      const allSkippedDependencies = new Set([...failedDependencies, ...circularDependencies]);

      // Now load this table
      const {
        loaded,
        rowCount,
        errors: loadErrors,
      } = await this.loadTable(tableName, tableConfig, detailedValidate, transform, allSkippedDependencies);
      errors.push(...loadErrors);
      rowCounts.set(tableName, rowCount);

      if (loaded) {
        loadedTables.add(tableName);

        // Track circular dependency FKs for deferred validation
        if (foreignKeys && circularDependencies.size > 0) {
          for (const fk of foreignKeys) {
            if (circularDependencies.has(fk.references.table)) {
              deferredForeignKeys.push({
                tableName,
                foreignKey: fk,
                filePath: tableConfig.jsonlPath,
              });
            }
          }
        }
      } else {
        // Table was not loaded (e.g., empty data)
        warnings.push(`Table '${tableName}' was not loaded (no data or skipped)`);
        this.tables.delete(tableName);
      }
    } finally {
      // Remove from loading set
      loadingTables.delete(tableName);
    }

    return { errors, warnings, rowCounts, deferredForeignKeys };
  }

  /**
   * Find the schema file of a table in schemaDir, or next to the table's JSONL file when unset
   */
  private async findTableSchemaFile(tableName: string, config: TableConfig): Promise<string | undefined> {
    return findSchemaFile(this.config.schemaDir ?? dirname(config.jsonlPath), tableName);
  }

  /**
   * Load a single table from JSONL file
   * @returns Object with loaded status and validation errors
   */
  private async loadTable(
    tableName: string,
    config: TableConfig,
    detailedValidate: boolean,
    transform?: (row: JsonObject) => JsonObject,
    failedDependencies?: Set<string>,
  ): Promise<{ loaded: boolean; rowCount: number; errors: ValidationErrorDetail[] }> {
    // Read every JSONL file of the table, remembering where each row came from
    let data: JsonObject[] = [];
    const origins: RowOrigin[] = [];
    const contentHashes = new Map<string, string>();
    for (const jsonlPath of config.jsonlPaths ?? [config.jsonlPath]) {
      const readResult = await JsonlReader.readSnapshot(jsonlPath);
      if (!readResult.ok) {
        throw readResult.error;
      }
      const { rows, contentHash } = readResult.value;
      if (!rows.ok) {
        throw rows.error;
      }
      if (contentHash !== undefined) {
        contentHashes.set(jsonlPath, contentHash);
        this.observedHashes.set(jsonlPath, contentHash);
      }
      rows.value.forEach((row, rowIndex) => {
        data.push(row);
        origins.push({ file: jsonlPath, rowIndex });
      });
    }

    // Apply transform if provided (before validation)
    const transformedFields: string[][] = [];
    if (transform) {
      data = data.map((row) => {
        const transformed = transform(row);
        transformedFields.push(
          Object.keys(transformed).filter((key) => JSON.stringify(transformed[key]) !== JSON.stringify(row[key])),
        );
        return transformed;
      });
    }

    // Load validation schema if provided or try to auto-load
    let validationSchema = config.validationSchema;
    const schemaMetadata: {
      primaryKey?: string;
      foreignKeys?: BiDirectionalSchema['foreignKeys'];
      indexes?: BiDirectionalSchema['indexes'];
    } = {};

    const schemaPath = config.validationSchema ? undefined : await this.findTableSchemaFile(tableName, config);
    if (!validationSchema && schemaPath) {
      try {
        validationSchema = await SchemaLoader.loadSchema(config.jsonlPath, dirname(schemaPath));
      } catch (_error) {
        // Schema file not found or failed to load - this is OK, table can still be used without validation
      }
    }

    // Load schema metadata (foreignKeys, primaryKey, indexes) from schema module
    // SchemaLoader.loadSchema() only returns the validation schema object, not metadata
    if (!config.validationSchema) {
      // Only load if not already provided via config
      try {
        const { pathToFileURL } = await import('node:url');
        if (!schemaPath) throw new Error('Schema file not found');
        const schemaUrl = pathToFileURL(schemaPath).href;
        const schemaModule = await import(`${schemaUrl}?t=${Date.now()}`);

        // Try to get metadata from exported 'schema' or directly from module
        const schemaExport = schemaModule.schema || schemaModule.default;

        if (schemaExport?.primaryKey) {
          schemaMetadata.primaryKey = schemaExport.primaryKey;
        } else if (schemaModule.primaryKey) {
          schemaMetadata.primaryKey = schemaModule.primaryKey;
        }

        if (schemaExport?.foreignKeys) {
          schemaMetadata.foreignKeys = schemaExport.foreignKeys;
        } else if (schemaModule.foreignKeys) {
          schemaMetadata.foreignKeys = schemaModule.foreignKeys;
        }

        if (schemaExport?.indexes) {
          schemaMetadata.indexes = schemaExport.indexes;
        } else if (schemaModule.indexes) {
          schemaMetadata.indexes = schemaModule.indexes;
        }

        // Debug: log loaded metadata
        if (process.env.DEBUG_LINES_DB) {
          console.log(`[lines-db] Schema metadata for ${tableName}:`);
          console.log(`  primaryKey: ${schemaMetadata.primaryKey}`);
          console.log(`  foreignKeys: ${JSON.stringify(schemaMetadata.foreignKeys)}`);
          console.log(`  indexes: ${JSON.stringify(schemaMetadata.indexes)}`);
        }
      } catch (_error) {
        // Schema file not found - this is OK
        // Debug: log error for investigation
        if (process.env.DEBUG_LINES_DB) {
          console.warn(
            `[lines-db] Failed to load schema metadata for ${tableName}:`,
            _error instanceof Error ? _error.message : String(_error),
          );
        }
      }
    }

    this.validationSchemas.set(tableName, validationSchema);

    // Validate data first and collect validated (transformed) data
    const validationErrors: Array<{
      rowIndex: number;
      rowData: JsonObject;
      error: ValidationError;
    }> = [];
    const validatedData: JsonObject[] = [];
    // The field order describes the rows this load computes, so a reload does not keep the order a
    // schema had the last time the table was loaded
    this.keyOrders.delete(tableName);

    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      try {
        const validatedRow = this.validateAndTransform(tableName, row);
        this.recordKeyOrder(tableName, validatedRow);
        validatedData.push(validatedRow);
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

    // Convert validation errors to ValidationErrorDetail format
    const validationErrorDetails: ValidationErrorDetail[] = validationErrors.map((ve) => ({
      ...origins[ve.rowIndex],
      tableName,
      issues: ve.error.issues,
      type: 'schema' as const,
    }));

    if (validationErrors.length > 0) {
      // Return errors instead of throwing
      return { loaded: false, rowCount: data.length, errors: validationErrorDetails };
    }

    // Determine schema - infer from validated data if auto-inference is enabled
    let schema: TableSchema;
    let inferredSchema: TableSchema | undefined;

    // Always infer schema from validated data to capture valueType information (e.g., boolean)
    if (validatedData.length > 0) {
      inferredSchema = unwrap(JsonlReader.inferSchema(tableName, validatedData));
    }

    if (config.schema) {
      schema = config.schema;
      // Merge valueType information from inferred schema
      if (inferredSchema) {
        for (const inferredCol of inferredSchema.columns) {
          const schemaCol = schema.columns.find((c) => c.name === inferredCol.name);
          if (schemaCol && inferredCol.valueType && !schemaCol.valueType) {
            schemaCol.valueType = inferredCol.valueType;
          }
        }
      }
    } else if (config.autoInferSchema !== false) {
      if (validatedData.length === 0) {
        return { loaded: false, rowCount: 0, errors: [] };
      }
      // Use inferred schema
      schema = inferredSchema!;
    } else {
      // Critical error - throw exception
      throw new Error(`No schema provided for table ${tableName} and autoInferSchema is disabled`);
    }

    // Enhance schema with constraints from validation schema and schema metadata
    // Priority: config.validationSchema (as BiDirectionalSchema) > schemaMetadata
    const biSchema = validationSchema as BiDirectionalSchema;
    const primaryKey = biSchema?.primaryKey || schemaMetadata.primaryKey;
    const foreignKeys = biSchema?.foreignKeys || schemaMetadata.foreignKeys;
    const indexes = biSchema?.indexes || schemaMetadata.indexes;

    if (primaryKey && !schema.columns.some((col) => col.primaryKey)) {
      // Add primary key constraint to column
      const col = schema.columns.find((c) => c.name === primaryKey);
      if (col) {
        col.primaryKey = true;
      }
    } else if (!primaryKey && !schema.columns.some((col) => col.primaryKey)) {
      // If no primary key is defined, use 'id' column as primary key if it exists
      // This matches the behavior of JsonlReader.inferSchema()
      const idColumn = schema.columns.find((c) => c.name === 'id');
      if (idColumn) {
        idColumn.primaryKey = true;
      }
    }
    if (foreignKeys) {
      schema.foreignKeys =
        failedDependencies && failedDependencies.size > 0
          ? foreignKeys.filter((fk) => !failedDependencies.has(fk.references.table))
          : foreignKeys;
    }
    if (indexes) {
      schema.indexes = indexes;

      // Apply unique constraint from single-column unique indexes to column definitions
      // This is required for foreign key references, as SQLite requires the referenced column
      // to have a UNIQUE constraint in the table definition (not just an index)
      for (const index of indexes) {
        if (index.unique && index.columns.length === 1) {
          const col = schema.columns.find((c) => c.name === index.columns[0]);
          if (col && !col.unique && !col.primaryKey) {
            col.unique = true;
          }
        }
      }
    }

    this.schemas.set(tableName, schema);

    // Create table
    this.createTable(schema);

    // Insert validated data (with detailed validation if requested)
    if (detailedValidate) {
      const insertErrors = this.insertDataWithDetailedValidation(tableName, schema, validatedData, origins);
      if (insertErrors.length > 0) {
        return { loaded: false, rowCount: data.length, errors: insertErrors };
      }
    } else {
      this.insertData(tableName, schema, validatedData);
    }

    this.fieldChanges.delete(tableName);
    if (transformedFields.some((fields) => fields.length > 0)) {
      const rowids = this.queryInternal<JsonObject>(
        `SELECT rowid AS "${ROWID_ALIAS}" FROM ${this.quoteTableName(tableName)} ORDER BY rowid`,
      );
      rowids.forEach((row, index) => {
        const set = transformedFields[index] ?? [];
        if (set.length > 0) this.noteFieldChanges(tableName, row[ROWID_ALIAS] as number | bigint, { set });
      });
    }

    for (const [jsonlPath, contentHash] of contentHashes) {
      this.fileHashes.set(jsonlPath, contentHash);
    }
    return { loaded: true, rowCount: data.length, errors: [] };
  }

  /**
   * Create table in SQLite with constraints and indexes
   */
  private createTable(schema: TableSchema): void {
    // Note: Foreign key constraints are enabled at database connection level (see sqlite-adapter.ts)
    // No need to enable them here for each table

    // Quote table name to handle special characters
    const quotedTableName = this.quoteTableName(schema.name);

    // Build a set of columns that should have UNIQUE constraint
    // This includes columns marked as unique in schema AND single-column unique indexes
    // The latter is required for foreign key references, as SQLite requires the referenced column
    // to have a UNIQUE constraint in the table definition (not just a separately created index)
    const uniqueColumns = new Set<string>();
    for (const col of schema.columns) {
      if (col.unique) {
        uniqueColumns.add(col.name);
      }
    }
    if (schema.indexes) {
      for (const index of schema.indexes) {
        if (index.unique && index.columns.length === 1) {
          uniqueColumns.add(index.columns[0]);
        }
      }
    }

    const columnDefs = schema.columns.map((col) => {
      // JSON type is stored as TEXT in SQLite
      const sqlType = col.type === 'JSON' ? 'TEXT' : col.type;
      const parts = [this.quoteIdentifier(col.name), sqlType];
      if (col.primaryKey) parts.push('PRIMARY KEY');
      if (col.notNull) parts.push('NOT NULL');
      if (uniqueColumns.has(col.name) && !col.primaryKey) parts.push('UNIQUE');
      return parts.join(' ');
    });

    // Add foreign key constraints
    const foreignKeyDefs: string[] = [];
    if (schema.foreignKeys && schema.foreignKeys.length > 0) {
      for (const fk of schema.foreignKeys) {
        const fkParts = [
          `FOREIGN KEY (${this.quoteIdentifier(fk.column)})`,
          `REFERENCES ${this.quoteTableName(fk.references.table)}(${this.quoteIdentifier(fk.references.column)})`,
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
        const resolvedIndexName = index.name || `idx_${safeTableName}_${index.columns.join('_')}_${i}`;
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
   * Insert data into table using batch insert (multiple rows per SQL)
   * SQLite has a parameter limit (default 999), so we batch rows accordingly
   * Throws exception if any constraint violation occurs
   */
  private insertData(tableName: string, schema: TableSchema, data: JsonObject[]): void {
    if (data.length === 0) return;

    const columnNames = schema.columns.map((col) => col.name);
    const quotedColumns = columnNames.map((name) => this.quoteIdentifier(name));
    const columnCount = columnNames.length;

    // Calculate batch size to stay under SQLite's parameter limit (999)
    // Leave some margin for safety
    const maxBatchSize = Math.floor(900 / columnCount);
    const batchSize = Math.max(1, Math.min(maxBatchSize, 100));

    // Process data in batches
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      const rowPlaceholders = columnNames.map(() => '?').join(', ');
      const valuesPlaceholders = batch.map(() => `(${rowPlaceholders})`).join(', ');
      const sql = `INSERT INTO ${this.quoteTableName(tableName)} (${quotedColumns.join(', ')}) VALUES ${valuesPlaceholders}`;

      const values: (string | number | bigint | null | Uint8Array)[] = [];
      for (const row of batch) {
        for (const col of columnNames) {
          values.push(this.normalizeValue(row[col]));
        }
      }

      const stmt = this.db.prepare(sql);
      stmt.run(...values);
    }
  }

  /**
   * Insert data into table one row at a time with detailed error reporting
   * This is used for validation to catch constraint violations
   */
  private insertDataWithDetailedValidation(
    tableName: string,
    schema: TableSchema,
    data: JsonObject[],
    origins: RowOrigin[],
  ): ValidationErrorDetail[] {
    const errors: ValidationErrorDetail[] = [];
    const columnNames = schema.columns.map((col) => col.name);
    const quotedColumns = columnNames.map((name) => this.quoteIdentifier(name));
    const placeholders = columnNames.map(() => '?').join(', ');
    const sql = `INSERT INTO ${this.quoteTableName(tableName)} (${quotedColumns.join(', ')}) VALUES (${placeholders})`;

    const stmt = this.db.prepare(sql);
    const rowOrigins = new Map<string, RowOrigin>();
    this.rowOriginsByRowid.set(tableName, rowOrigins);

    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      try {
        const values = columnNames.map((col) => this.normalizeValue(row[col]));
        const { lastInsertRowid } = stmt.run(...values);
        rowOrigins.set(String(lastInsertRowid), origins[rowIndex]);
      } catch (error) {
        // Constraint violation occurred - analyze and record details
        const constraintError = this.analyzeConstraintError(
          error,
          origins[rowIndex].file,
          tableName,
          origins[rowIndex].rowIndex,
          row,
          schema.foreignKeys || [],
        );
        if (constraintError) {
          errors.push(constraintError);
        }
      }
    }

    return errors;
  }

  /**
   * Analyze constraint error and extract detailed information
   */
  private analyzeConstraintError(
    error: unknown,
    file: string,
    tableName: string,
    rowIndex: number,
    row: JsonObject,
    foreignKeys: ForeignKeyDefinition[],
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
          const result = this.queryInternal(
            `SELECT COUNT(*) as count FROM ${this.quoteIdentifier(fk.references.table)} WHERE ${this.quoteIdentifier(fk.references.column)} = ?`,
            [this.normalizeValue(fkValue)],
          );
          if (result.length > 0 && (result[0] as { count: number }).count === 0) {
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
   * Validate a deferred foreign key constraint after all tables have been loaded.
   * Used for circular dependency FK validation.
   */
  private validateDeferredForeignKey(
    tableName: string,
    fk: ForeignKeyDefinition,
    filePath: string,
  ): ValidationErrorDetail[] {
    const errors: ValidationErrorDetail[] = [];
    const quotedTable = this.quoteTableName(tableName);
    const quotedColumn = this.quoteIdentifier(fk.column);
    const quotedRefTable = this.quoteTableName(fk.references.table);
    const quotedRefColumn = this.quoteIdentifier(fk.references.column);

    // Find rows where the FK value does not exist in the referenced table
    const sql = `SELECT rowid as rid, ${quotedColumn} as val FROM ${quotedTable} WHERE ${quotedColumn} IS NOT NULL AND ${quotedColumn} NOT IN (SELECT ${quotedRefColumn} FROM ${quotedRefTable})`;

    try {
      const rows = this.queryInternal<{ rid: number | bigint; val: string | number }>(sql);
      const rowOrigins = this.rowOriginsByRowid.get(tableName);
      for (const row of rows) {
        errors.push({
          ...(rowOrigins?.get(String(row.rid)) ?? { file: filePath, rowIndex: Number(row.rid) - 1 }),
          tableName,
          issues: [],
          type: 'foreignKey',
          foreignKeyError: {
            column: fk.column,
            value: row.val,
            referencedTable: fk.references.table,
            referencedColumn: fk.references.column,
          },
        });
      }
    } catch (_) {
      // Table might not exist - skip validation
    }

    return errors;
  }

  /**
   * Execute a raw SQL query
   */
  query<T = unknown>(sql: string, params: (string | number | bigint | null | Uint8Array)[] = []): Result<T[], Error> {
    try {
      this.enforceReadOnlySql();
      this.refuseTransactionControl(sql);
      return ok(this.trackRawSql(() => this.queryInternal<T>(sql, params)));
    } catch (error) {
      return err(toError(error));
    }
  }

  private queryInternal<T = unknown>(sql: string, params: (string | number | bigint | null | Uint8Array)[] = []): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  /**
   * Execute a SQL query that returns a single row
   */
  queryOne<T = unknown>(
    sql: string,
    params: (string | number | bigint | null | Uint8Array)[] = [],
  ): Result<T | null, Error> {
    try {
      this.enforceReadOnlySql();
      this.refuseTransactionControl(sql);
      return ok(this.trackRawSql(() => this.queryOneInternal<T>(sql, params)));
    } catch (error) {
      return err(toError(error));
    }
  }

  private queryOneInternal<T = unknown>(
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
  ): Result<{ changes: number | bigint; lastInsertRowid: number | bigint }, Error> {
    try {
      this.enforceReadOnlySql();
      this.refuseTransactionControl(sql);
      return ok(this.trackRawSql(() => this.executeInternal(sql, params)));
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Run a caller's SQL, and when it changed rows, write back every table whole: which tables and
   * fields raw SQL changed is unknown, and a query() can change rows with RETURNING too
   */
  private trackRawSql<T>(run: () => T): T {
    const before = this.totalChanges();
    const result = run();
    if (this.totalChanges() !== before) {
      for (const tableName of this.schemas.keys()) this.rawSqlTables.add(tableName);
      if (this.transactionChanges) this.transactionChanges = 'all';
    }
    return result;
  }

  private totalChanges(): number {
    return Number((this.db.prepare('SELECT total_changes() AS n').get() as { n: number | bigint }).n);
  }

  private executeInternal(
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
  find<K extends keyof Tables & string>(tableName: K, where?: WhereCondition<Tables[K]>): Result<Tables[K][], Error> {
    try {
      return ok(this.findInternal(tableName, where));
    } catch (error) {
      return err(toError(error));
    }
  }

  private findInternal<K extends keyof Tables & string>(tableName: K, where?: WhereCondition<Tables[K]>): Tables[K][] {
    // If no where condition, return all rows
    if (where === undefined) {
      const rows = this.queryInternal(`SELECT * FROM ${this.quoteTableName(tableName)}`);
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
      const rawRows = this.queryInternal(`SELECT * FROM ${this.quoteTableName(tableName)}`);
      rows = rawRows.map((row) => this.deserializeRow(tableName, row)) as Tables[K][];
      return this.applyOrConditionWithFilters(rows, where as WhereCondition<Tables[K]>);
    }

    // Normal case: use SQL WHERE clause
    if (sql) {
      const rawRows = this.queryInternal(`SELECT * FROM ${this.quoteTableName(tableName)} WHERE ${sql}`, values);
      rows = rawRows.map((row) => this.deserializeRow(tableName, row)) as Tables[K][];
    } else {
      // If only function filters (AND case), get all rows
      const rawRows = this.queryInternal(`SELECT * FROM ${this.quoteTableName(tableName)}`);
      rows = rawRows.map((row) => this.deserializeRow(tableName, row)) as Tables[K][];
    }

    // Apply function filters for AND conditions
    return this.applyFunctionFilters(rows, functionFilters);
  }

  /**
   * Find a single row by condition (supports OR/AND with arrays and function filters)
   */
  findOne<K extends keyof Tables & string>(
    tableName: K,
    where: WhereCondition<Tables[K]>,
  ): Result<Tables[K] | null, Error> {
    try {
      return ok(this.findOneInternal(tableName, where));
    } catch (error) {
      return err(toError(error));
    }
  }

  private findOneInternal<K extends keyof Tables & string>(
    tableName: K,
    where: WhereCondition<Tables[K]>,
  ): Tables[K] | null {
    const { sql, values, functionFilters } = this.buildWhereClause(where);

    let rows: Tables[K][];
    if (sql) {
      const rawRows = this.queryInternal(`SELECT * FROM ${this.quoteTableName(tableName)} WHERE ${sql}`, values);
      rows = rawRows.map((row) => this.deserializeRow(tableName, row)) as Tables[K][];
    } else {
      // If only function filters, get all rows
      const rawRows = this.queryInternal(`SELECT * FROM ${this.quoteTableName(tableName)}`);
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
   * Validate data using StandardSchema and return the transformed value
   * Note: Only synchronous validation is supported
   */
  private validateAndTransform(tableName: string, data: unknown): JsonObject {
    const schema = this.validationSchemas.get(tableName);
    if (!schema) {
      return data as JsonObject;
    }

    const result = schema['~standard'].validate(data);

    // Only synchronous validation is supported
    if (result instanceof Promise) {
      throw new Error('Asynchronous validation is not supported. Please use synchronous validation schemas.');
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

    // Return the transformed value from validation
    // When there are no issues, result.value should be present
    const transformedValue = ('value' in result ? result.value : data) as JsonObject;

    // Convert undefined values to null for JSON compatibility
    const normalizedValue: JsonObject = {};
    for (const [key, value] of Object.entries(transformedValue)) {
      normalizedValue[key] = value === undefined ? null : value;
    }

    return normalizedValue;
  }

  /**
   * Validate data using StandardSchema (without returning transformed value)
   * Note: Only synchronous validation is supported
   */
  private validateData(tableName: string, data: unknown): void {
    // Use validateAndTransform but discard the result
    this.validateAndTransform(tableName, data);
  }

  /**
   * Remember the order a computed row lists its fields in - the order the schema declares them, since
   * that is the order a hook or a validation fills a row in. A sync inserts a key the line did not
   * have at the place this order gives it.
   */
  private recordKeyOrder(tableName: string, row: JsonObject): void {
    const order = this.keyOrders.get(tableName) ?? new Set<string>();
    for (const key of Object.keys(row)) {
      // A set keeps the order keys were added in, so a field only some rows carry lands after the
      // ones already seen - which is where the row that carries it puts it too
      order.add(key);
    }
    this.keyOrders.set(tableName, order);
  }

  /**
   * Insert a row into a table with validation
   */
  insert<K extends keyof Tables & string>(
    tableName: K,
    data: Tables[K],
  ): Result<{ changes: number | bigint; lastInsertRowid: number | bigint }, Error> {
    try {
      return ok(this.insertInternal(tableName, data));
    } catch (error) {
      return err(toError(error));
    }
  }

  private insertInternal<K extends keyof Tables & string>(
    tableName: K,
    data: Tables[K],
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    this.assertWritable(tableName);

    // Not inserting the row as given: a value the schema fills in would be missing, unlike in a loaded row
    const row = this.validateAndTransform(tableName, data);

    const schema = this.schemas.get(tableName);
    if (!schema) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    const columnNames = Object.keys(row);
    const quotedColumns = columnNames.map((col) => this.quoteIdentifier(col));
    const placeholders = columnNames.map(() => '?').join(', ');
    const sql = `INSERT INTO ${this.quoteTableName(tableName)} (${quotedColumns.join(', ')}) VALUES (${placeholders})`;

    const values = Object.values(row).map((v) => this.normalizeValue(v));
    const result = this.executeInternal(sql, values);
    this.noteFieldChanges(tableName, result.lastInsertRowid, { set: givenFields(data), inserted: true });

    // Auto-sync if not in transaction
    this.afterWrite(tableName, result.changes);

    return result;
  }

  /**
   * Batch insert rows with validation per record.
   */
  batchInsert<K extends keyof Tables & string>(
    tableName: K,
    records: Tables[K][],
  ): Result<{ changes: number | bigint; lastInsertRowid: number | bigint }, Error> {
    try {
      return ok(this.batchInsertInternal(tableName, records));
    } catch (error) {
      return err(toError(error));
    }
  }

  private batchInsertInternal<K extends keyof Tables & string>(
    tableName: K,
    records: Tables[K][],
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    this.assertWritable(tableName);

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
      const row = this.validateAndTransform(tableName, record);

      const columnNames = Object.keys(row);
      const quotedColumns = columnNames.map((col) => this.quoteIdentifier(col));
      const placeholders = columnNames.map(() => '?').join(', ');
      const sql = `INSERT INTO ${this.quoteTableName(tableName)} (${quotedColumns.join(', ')}) VALUES (${placeholders})`;

      const values = columnNames.map((col) => this.normalizeValue(row[col]));

      const result = this.executeInternal(sql, values);
      this.noteFieldChanges(tableName, result.lastInsertRowid, { set: givenFields(record), inserted: true });
      totalChanges += BigInt(result.changes);
      lastRowid = BigInt(result.lastInsertRowid);
    }

    this.afterWrite(tableName, totalChanges);

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
    options?: UpdateOptions,
  ): Result<{ changes: number | bigint; lastInsertRowid: number | bigint }, Error> {
    try {
      return ok(this.updateInternal(tableName, data, where, options));
    } catch (error) {
      return err(toError(error));
    }
  }

  private updateInternal<K extends keyof Tables & string>(
    tableName: K,
    data: Partial<Tables[K]>,
    where: WhereCondition<Tables[K]>,
    options?: UpdateOptions,
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    this.assertWritable(tableName);

    const schema = this.schemas.get(tableName);
    if (!schema) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    // Validate by default (can be disabled with validate: false)
    const shouldValidate = options?.validate !== false;
    const hasValidationSchema = this.validationSchemas.has(tableName);

    if (shouldValidate && hasValidationSchema) {
      // Get existing rows to merge with partial data
      const existingRows = this.findInternal(tableName, where);

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

    const targets = this.queryInternal<JsonObject>(
      `SELECT rowid AS "${ROWID_ALIAS}", * FROM ${this.quoteTableName(tableName)} WHERE ${whereSql}`,
      whereValues,
    );

    // Not computed after the UPDATE: a reset the schema refuses must fail the update before it changes anything
    const resetFields = options?.resetToDefault ?? [];
    const resets =
      resetFields.length > 0 ? this.computeResets(tableName, targets, data as JsonObject, resetFields) : [];

    let result: { changes: number | bigint; lastInsertRowid: number | bigint } = { changes: 0, lastInsertRowid: 0 };
    if (Object.keys(data).length > 0) {
      const setClauses = Object.keys(data)
        .map((key) => `${this.quoteIdentifier(key)} = ?`)
        .join(', ');
      const sql = `UPDATE ${this.quoteTableName(tableName)} SET ${setClauses} WHERE ${whereSql}`;
      const values = [...Object.values(data).map((v) => this.normalizeValue(v)), ...whereValues];
      result = this.executeInternal(sql, values);
    }

    for (const target of targets) {
      const set = Object.keys(data).filter(
        (key) => !sameStoredValue(target[key], this.normalizeValue((data as Record<string, unknown>)[key])),
      );
      this.noteFieldChanges(tableName, target[ROWID_ALIAS] as number | bigint, { set });
    }

    if (resets.length > 0) {
      result = this.applyResets(tableName, resets, resetFields);
    }

    // Auto-sync if not in transaction
    this.afterWrite(tableName, result.changes);

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
  ): Result<{ changes: number | bigint; lastInsertRowid: number | bigint }, Error> {
    try {
      return ok(this.batchUpdateInternal(tableName, records, options));
    } catch (error) {
      return err(toError(error));
    }
  }

  private batchUpdateInternal<K extends keyof Tables & string>(
    tableName: K,
    records: Array<Partial<Tables[K]> & Record<string, unknown>>,
    options?: { validate?: boolean },
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    this.assertWritable(tableName);

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
        throw new Error(`Record is missing primary key '${String(pkName)}': ${JSON.stringify(record)}`);
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
      const existingRows = this.findInternal(tableName, orCondition);

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
          throw new Error(`No existing row found with ${String(pkName)}=${JSON.stringify(pkValue)}`);
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
      const result = this.updateInternal(tableName, record as Partial<Tables[K]>, where, {
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
  ): Result<{ changes: number | bigint; lastInsertRowid: number | bigint }, Error> {
    try {
      return ok(this.deleteInternal(tableName, where));
    } catch (error) {
      return err(toError(error));
    }
  }

  private deleteInternal<K extends keyof Tables & string>(
    tableName: K,
    where: WhereCondition<Tables[K]>,
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    this.assertWritable(tableName);

    const schema = this.schemas.get(tableName);
    if (!schema) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    const { sql: whereSql, values, functionFilters } = this.buildWhereClause(where);

    if (functionFilters.length > 0) {
      throw new Error('Function filters are not supported in delete operations');
    }

    const deleted = this.rowidsWhere(tableName, whereSql, values);
    const sql = `DELETE FROM ${this.quoteTableName(tableName)} WHERE ${whereSql}`;
    const result = this.executeInternal(sql, values);
    this.forgetFieldChanges(tableName, deleted);

    // Auto-sync if not in transaction
    this.afterWrite(tableName, result.changes);

    return result;
  }

  /**
   * Batch delete rows by primary key.
   */
  batchDelete<K extends keyof Tables & string>(
    tableName: K,
    records: Array<Partial<Tables[K]> & Record<string, unknown>>,
  ): Result<{ changes: number | bigint; lastInsertRowid: number | bigint }, Error> {
    try {
      return ok(this.batchDeleteInternal(tableName, records));
    } catch (error) {
      return err(toError(error));
    }
  }

  private batchDeleteInternal<K extends keyof Tables & string>(
    tableName: K,
    records: Array<Partial<Tables[K]> & Record<string, unknown>>,
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    this.assertWritable(tableName);

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
    const deleted = this.rowidsWhere(tableName, `${this.quoteIdentifier(pkName)} IN (${placeholders})`, values);
    const result = this.executeInternal(sql, values);
    this.forgetFieldChanges(tableName, deleted);

    this.afterWrite(tableName, result.changes);

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
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value;
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
            const clause = Array.isArray(item) ? buildCondition(item, true) : buildCondition(item, true);
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
  private applyOrConditionWithFilters<T extends Record<string, unknown>>(rows: T[], condition: WhereCondition<T>): T[] {
    return rows.filter((row) => this.matchesOrCondition(row, condition));
  }

  /**
   * Check if a row matches an OR/AND condition (recursively)
   */
  private matchesOrCondition<T extends Record<string, unknown>>(row: T, condition: WhereCondition<T>): boolean {
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
   * A database composed from several data directories is read-only: the rows of its tables have no
   * single file to be written back to
   */
  private hasSeveralDataDirs(): boolean {
    return typeof this.config.dataDir !== 'string' && this.config.dataDir.length > 1;
  }

  /**
   * Turn query_only back on before running a caller's SQL, since an earlier call may have run
   * `PRAGMA query_only = OFF`
   */
  /**
   * Refuse SQL that would end a transaction() before it writes the files back: committed early, the
   * change could no longer be rolled back when the write-back fails
   */
  private refuseTransactionControl(sql: string): void {
    if (!this.inTransaction) return;
    if (/^\s*(BEGIN|COMMIT|END|ROLLBACK(?!\s+(TRANSACTION\s+)?TO\b))\b/i.test(sql)) {
      throw new Error(
        `'${sql.trim()}' would end the transaction before its files are written back; return from the callback to commit, or throw to roll back`,
      );
    }
  }

  private enforceReadOnlySql(): void {
    if (this.hasSeveralDataDirs()) {
      this.db.exec('PRAGMA query_only = ON');
    }
  }

  private assertWritable(tableName?: string): void {
    if (this.hasSeveralDataDirs()) {
      const target = tableName ? `table '${tableName}'` : 'the database';
      throw new Error(
        `Cannot write to ${target}: dataDir lists several directories, so its rows have no single file to be written back to`,
      );
    }
  }

  /**
   * Sync a specific table back to its JSONL file
   * Syncs of the same table run one after another: auto-sync is fire-and-forget, and a write-back
   * that reads the file first must never see a file another sync is halfway through writing.
   */
  private async syncTable(tableName: string, options?: InternalSyncOptions): Promise<void> {
    const pending = this.syncQueue.get(tableName) ?? Promise.resolve();
    const current = pending.then(() => this.writeTable(tableName, options));

    this.syncQueue.set(
      tableName,
      current.catch(() => {}),
    );

    return current;
  }

  /**
   * Write a table back to its JSONL file
   * Uses backward transformation when available
   */
  private async writeTable(tableName: string, options?: InternalSyncOptions): Promise<void> {
    await this.writePrepared(await this.prepareWriteBack(tableName, options));
  }

  /**
   * The rows a table is written back as, laid over the lines of its file; fails when the file changed
   * since this database last read or wrote it
   */
  private async prepareWriteBack(tableName: string, options?: InternalSyncOptions): Promise<PreparedWriteBack> {
    this.assertWritable(tableName);

    const tableConfig = this.tables.get(tableName);
    if (!tableConfig) {
      throw new Error(`Table ${tableName} not found`);
    }

    // Get all rows from the table. Order by rowid so the rows arrive in insertion order:
    // without it SQLite may return them in any order, and matching rows to their existing
    // line by position depends on that order being the one the file was read in.
    const { rowids, rows: deserializedRows, lineRows } = this.readStoredRows(tableName);
    let finalRows = lineRows;

    const previousContent = await readFile(tableConfig.jsonlPath, 'utf-8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    const existingRows = await this.readUnchangedRows(tableConfig.jsonlPath);

    // An empty list means no field is written back, not that every field is
    const fields = options?.fields ?? this.config.writeBackFields;
    if ((options?.writeFilledValues ?? this.config.writeFilledValues ?? 'all') === 'primaryKey') {
      finalRows = this.keepWrittenFields(tableName, rowids, deserializedRows, finalRows, existingRows, fields).map(
        ({ written }) => written,
      );
    }
    finalRows = this.mergeWithExistingLines(tableName, existingRows, finalRows, {
      fields,
      strictFields: options?.strictFields ?? false,
    });

    return { tableName, jsonlPath: tableConfig.jsonlPath, rows: finalRows, previousContent };
  }

  /**
   * Every row of a table in rowid order - the order the file was read in - as stored and as its line
   * would hold it, after the backward transformation
   */
  private readStoredRows(tableName: string): { rowids: string[]; rows: JsonObject[]; lineRows: JsonObject[] } {
    const stored = this.queryInternal<JsonObject>(
      `SELECT rowid AS "${ROWID_ALIAS}", * FROM ${this.quoteTableName(tableName)} ORDER BY rowid`,
    );
    const rowids = stored.map((row) => String(row[ROWID_ALIAS]));
    const rows = stored.map(({ [ROWID_ALIAS]: _rowid, ...row }) => this.deserializeRow(tableName, row));

    const validationSchema = this.validationSchemas.get(tableName);
    const lineRows =
      validationSchema && hasBackward(validationSchema)
        ? rows.map((row) => (validationSchema as BiDirectionalSchema<Table, Table>).backward!(row) as JsonObject)
        : rows;
    return { rowids, rows, lineRows };
  }

  /**
   * Narrow each row to the fields a user wrote - the ones its line holds, plus those set since and
   * minus those reset to their default - its primary key and the fields named to be written back, so
   * a value the schema fills in stays out of the file
   */
  private keepWrittenFields(
    tableName: string,
    rowids: string[],
    rows: JsonObject[],
    lineRows: JsonObject[],
    existingRows: JsonObject[],
    namedFields: readonly string[] = [],
  ): Array<{ written: JsonObject; narrowed: boolean }> {
    const pkName = this.schemas.get(tableName)?.columns.find((col) => col.primaryKey)?.name;
    const lines = this.matchExistingRows(tableName, lineRows, existingRows, { required: false });
    const changes = this.fieldChanges.get(tableName);

    return lineRows.map((lineRow, index) => {
      const line = lines?.[index];
      const rowChanges = changes?.get(rowids[index]);
      // Not narrowed when the backward transformation renames fields: the line's keys name other fields
      const renamesFields = Object.keys(lineRow).some((key) => !Object.hasOwn(rows[index], key));
      // Not narrowed without a line unless the row was inserted: a row whose key changed has lost its
      // line too, and narrowing it would drop the fields that line held
      if (renamesFields || this.rawSqlTables.has(tableName) || (!line && !rowChanges?.inserted)) {
        return { written: lineRow, narrowed: false };
      }

      const keep = new Set([...Object.keys(line ?? {}), ...(rowChanges?.set ?? [])]);
      for (const key of rowChanges?.reset ?? []) keep.delete(key);
      for (const key of namedFields) keep.add(key);
      if (pkName) keep.add(pkName);
      return {
        written: Object.fromEntries(Object.entries(lineRow).filter(([key]) => keep.has(key))) as JsonObject,
        narrowed: true,
      };
    });
  }

  private rowidsWhere(
    tableName: string,
    whereSql: string,
    values: (string | number | bigint | null | Uint8Array)[],
  ): string[] {
    return this.queryInternal<JsonObject>(
      `SELECT rowid AS "${ROWID_ALIAS}" FROM ${this.quoteTableName(tableName)} WHERE ${whereSql}`,
      values,
    ).map((row) => String(row[ROWID_ALIAS]));
  }

  /**
   * Forget the field changes of deleted rows: a deleted row's rowid can be given to a row inserted
   * later, which must not inherit them
   */
  private forgetFieldChanges(tableName: string, rowids: string[]): void {
    for (const rowid of rowids) {
      this.fieldChanges.get(tableName)?.delete(rowid);
    }
  }

  private noteFieldChanges(
    tableName: string,
    rowid: number | bigint,
    changes: { set?: readonly string[]; reset?: readonly string[]; inserted?: boolean },
  ): void {
    const byRow = this.fieldChanges.get(tableName) ?? new Map<string, FieldChanges>();
    const rowChanges = byRow.get(String(rowid)) ?? {
      set: new Set<string>(),
      reset: new Set<string>(),
      inserted: false,
    };
    if (changes.inserted) rowChanges.inserted = true;
    for (const key of changes.set ?? []) {
      rowChanges.set.add(key);
      rowChanges.reset.delete(key);
    }
    for (const key of changes.reset ?? []) {
      rowChanges.reset.add(key);
      rowChanges.set.delete(key);
    }
    byRow.set(String(rowid), rowChanges);
    this.fieldChanges.set(tableName, byRow);
  }

  /**
   * Store the value the schema fills in for each reset field, as validating the row without the field
   * gives it, and remember the field as reset so it leaves the line
   */
  /** The value the schema fills in for each reset field of each target, validating the row without them */
  private computeResets(
    tableName: string,
    targets: JsonObject[],
    data: JsonObject,
    fields: readonly string[],
  ): Array<{ rowid: number | bigint; values: ReturnType<LinesDB<Tables>['normalizeValue']>[] }> {
    return targets.map((target) => {
      const { [ROWID_ALIAS]: rowid, ...stored } = target;
      const row = { ...this.deserializeRow(tableName, stored), ...data };
      for (const field of fields) delete row[field];
      const validated = this.validateAndTransform(tableName, row);
      return { rowid: rowid as number | bigint, values: fields.map((field) => this.normalizeValue(validated[field])) };
    });
  }

  /** Store the values computeResets gave, and remember the fields as reset so they leave the line */
  private applyResets(
    tableName: string,
    resets: Array<{ rowid: number | bigint; values: ReturnType<LinesDB<Tables>['normalizeValue']>[] }>,
    fields: readonly string[],
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    let changes = 0n;
    const setClauses = fields.map((field) => `${this.quoteIdentifier(field)} = ?`).join(', ');
    for (const { rowid, values } of resets) {
      const result = this.executeInternal(
        `UPDATE ${this.quoteTableName(tableName)} SET ${setClauses} WHERE rowid = ?`,
        [...values, rowid],
      );
      changes += BigInt(result.changes);
      this.noteFieldChanges(tableName, rowid, { reset: fields });
    }
    return { changes, lastInsertRowid: 0 };
  }

  /**
   * Every row of a table with the fields the schema filled in rather than the file: the ones its line
   * does not hold and no write set, which a write-back leaves out of the file
   */
  async findWithDefaults<K extends keyof Tables & string>(
    tableName: K,
  ): Promise<Result<Array<{ row: Tables[K]; defaulted: string[] }>, Error>> {
    try {
      const tableConfig = this.tables.get(tableName);
      if (!tableConfig || !this.schemas.has(tableName)) {
        throw new Error(`Table '${tableName}' is not loaded`);
      }
      const { rowids, rows, lineRows } = this.readStoredRows(tableName);
      const read = await JsonlReader.read(tableConfig.jsonlPath);
      if (!read.ok && (read.error as NodeJS.ErrnoException).code !== 'ENOENT') throw read.error;
      const existingRows = read.ok ? read.value : [];

      const kept = this.keepWrittenFields(tableName, rowids, rows, lineRows, existingRows, this.config.writeBackFields);
      return ok(
        rows.map((row, index) => ({
          row: row as Tables[K],
          defaulted: kept[index].narrowed
            ? Object.keys(row).filter((key) => !Object.hasOwn(kept[index].written, key))
            : [],
        })),
      );
    } catch (error) {
      return err(toError(error));
    }
  }

  private async writePrepared({ tableName, jsonlPath, rows }: PreparedWriteBack): Promise<void> {
    await JsonlWriter.write(jsonlPath, rows);
    this.fieldChanges.delete(tableName);
    this.rawSqlTables.delete(tableName);
    const contentHash = hashJsonlContent(JsonlWriter.serialize(rows));
    this.fileHashes.set(jsonlPath, contentHash);
    this.observedHashes.set(jsonlPath, contentHash);
  }

  /**
   * Write a table back to its file, or leave it to the running transaction, which writes back the
   * tables it changed once its callback is done
   */
  private afterWrite(tableName: string, changes: number | bigint): void {
    // Not counted when no row changed: writing the table back could then fail on a file it never touched
    if (BigInt(changes) === 0n && this.transactionChanges) return;
    const tableNames = [tableName, ...this.tablesChangedByForeignKeyActions(tableName)];
    if (this.transactionChanges) {
      if (this.transactionChanges !== 'all') for (const name of tableNames) this.transactionChanges.add(name);
      return;
    }
    for (const name of tableNames) {
      this.syncTable(name).catch((err) => {
        console.error(`Failed to sync table ${name}:`, err);
      });
    }
  }

  /**
   * The tables whose rows an ON DELETE / ON UPDATE action can change when a table's rows change,
   * following the actions on to the tables they change in turn
   */
  private tablesChangedByForeignKeyActions(tableName: string): string[] {
    const found = new Set<string>();
    const visit = (referenced: string) => {
      for (const [name, schema] of this.schemas) {
        if (found.has(name) || name === tableName) continue;
        const acts = (schema.foreignKeys ?? []).some(
          (fk) =>
            fk.references.table === referenced &&
            [fk.onDelete, fk.onUpdate].some((action) => action === 'CASCADE' || action === 'SET NULL'),
        );
        if (acts) {
          found.add(name);
          visit(name);
        }
      }
    };
    visit(tableName);
    return Array.from(found);
  }

  private tablesChangedInTransaction(): string[] {
    const changes = this.transactionChanges;
    return changes === 'all' ? Array.from(this.schemas.keys()) : Array.from(changes ?? []);
  }

  /**
   * Write several tables back, checking every file before writing any, so a file changed on disk
   * fails the write-back before it has written part of it
   */
  private async writeBackTogether(tableNames: string[]): Promise<PreparedWriteBack[]> {
    await this.waitForPendingSyncs();
    const prepared = [];
    for (const tableName of tableNames) {
      prepared.push(await this.prepareWriteBack(tableName));
    }
    const written: PreparedWriteBack[] = [];
    try {
      for (const table of prepared) {
        // Counted as written before the write: a write that fails can still have truncated the file
        written.push(table);
        await this.writePrepared(table);
      }
    } catch (error) {
      throw await this.restoreAll(written, error);
    }
    return written;
  }

  /**
   * Put back every written file, going on past one that cannot be put back, and give the error to
   * throw: the one that made the write-back fail, naming the files left holding what was written
   */
  private async restoreAll(written: PreparedWriteBack[], error: unknown): Promise<unknown> {
    const notRestored: string[] = [];
    for (const table of written) {
      await this.restorePrepared(table).catch(() => notRestored.push(table.jsonlPath));
    }
    if (notRestored.length === 0) return error;
    return new Error(
      `${toError(error).message}\nThese files could not be put back and hold rows the database does not: ${notRestored.join(', ')}`,
      { cause: error },
    );
  }

  /**
   * Put back the content a file held before {@link writePrepared} wrote over it. The file is expected
   * to hold that content even when putting it back fails, so a file left holding the written rows
   * counts as changed on disk instead of matching the database
   */
  private async restorePrepared({ jsonlPath, previousContent }: PreparedWriteBack): Promise<void> {
    if (previousContent === undefined) {
      this.fileHashes.delete(jsonlPath);
      this.observedHashes.delete(jsonlPath);
      await rm(jsonlPath, { force: true });
      return;
    }
    this.fileHashes.set(jsonlPath, hashJsonlContent(previousContent));
    this.observedHashes.set(jsonlPath, hashJsonlContent(previousContent));
    await writeFile(jsonlPath, previousContent, 'utf-8');
  }

  /**
   * Lay the rows out over the lines the JSONL file already holds.
   *
   * Rows keep the order the file lists them in - the database returns rows in its own order, and
   * an integer primary key is SQLite's rowid, so writing rows back in query order would reshuffle
   * the file. Rows the file never had follow, in database order.
   *
   * With `fields`, only those fields are taken from the row and every other field keeps the value
   * its line already had, so values a validation hook computed and fields the file omitted are
   * never materialized. Fields this table does not have are simply not written, so one list can
   * cover a directory of tables that do not all share it; a sync asked for a single table by name
   * rejects them instead, since there the caller named both the table and the fields.
   */
  private mergeWithExistingLines(
    tableName: string,
    existingRows: JsonObject[],
    rows: JsonObject[],
    options: { fields?: readonly string[]; strictFields: boolean },
  ): JsonObject[] {
    if (rows.length === 0) {
      return rows;
    }

    const { fields } = options;
    const tableFields = fields?.filter((field) => rows.some((row) => field in row));
    if (fields && tableFields && options.strictFields && tableFields.length < fields.length) {
      const unknownFields = fields.filter((field) => !tableFields.includes(field));
      throw new Error(
        `Cannot write back field(s) [${unknownFields.join(', ')}] for table '${tableName}': ` +
          `no such field in the rows written back to the file.`,
      );
    }

    // Without `fields` the rows are written whole, so matching them to their line only decides the
    // order: fall back to database order rather than failing when they cannot be matched
    const existing = this.matchExistingRows(tableName, rows, existingRows, { required: fields !== undefined });
    if (!existing) {
      return rows;
    }

    const rowByLine = new Map<JsonObject, JsonObject>();
    const newRows: JsonObject[] = [];
    rows.forEach((row, index) => {
      const base = existing[index];
      if (base) {
        rowByLine.set(base, row);
      } else {
        newRows.push(row);
      }
    });

    const columns = new Set(this.schemas.get(tableName)?.columns.map((column) => column.name));
    const writtenRows = existingRows
      .filter((base) => rowByLine.has(base))
      .map((base) => {
        const row = keepUnknownFields(base, rowByLine.get(base)!, columns);
        // A row missing a named field - a backward transformation can drop it - keeps what the file
        // holds, and a field the line did not have is inserted where the schema declares it
        return tableFields
          ? mergeFields(base, row, { fields: tableFields, keyOrder: this.keyOrders.get(tableName) })
          : row;
      });

    return [...writtenRows, ...newRows];
  }

  /**
   * Pair each row with the JSONL line it came from, indexed the same way as `rows`.
   * Returns undefined when the rows cannot be matched and the caller can do without it.
   */
  private matchExistingRows(
    tableName: string,
    rows: JsonObject[],
    existingRows: JsonObject[],
    options: { required: boolean },
  ): Array<JsonObject | undefined> | undefined {
    // Nothing in the file to preserve, so every row is one the file never had
    if (existingRows.length === 0) {
      return rows.map(() => undefined);
    }

    const pkName = this.schemas.get(tableName)?.columns.find((col) => col.primaryKey)?.name;
    const pkValues = pkName ? existingRows.map((row) => row[pkName]) : [];
    const hasUsablePk =
      pkName !== undefined &&
      pkValues.every((value) => value !== undefined && value !== null) &&
      new Set(pkValues.map((value) => String(value))).size === pkValues.length;

    if (hasUsablePk) {
      const byPk = new Map(existingRows.map((row, index) => [String(pkValues[index]), row]));
      return rows.map((row) => {
        const pkValue = row[pkName!];
        return pkValue === undefined || pkValue === null ? undefined : byPk.get(String(pkValue));
      });
    }

    // No usable primary key in the file: fall back to matching rows to lines by position.
    // Only safe while the row count is unchanged, since anything else means rows were
    // added or removed and positions no longer line up.
    if (rows.length !== existingRows.length) {
      if (!options.required) {
        return undefined;
      }
      throw new Error(
        `Cannot write back selected fields for table '${tableName}': ` +
          `the file has ${existingRows.length} row(s) but the table has ${rows.length}, and ` +
          `${pkName ? `column '${pkName}' is not usable as a primary key in the file` : 'the table has no primary key'}, ` +
          `so rows cannot be matched to their existing lines.`,
      );
    }

    return existingRows;
  }

  /**
   * Read the rows a JSONL file currently holds, treating a missing file as empty, and refuse to go on
   * when the file is not the one this database last read or wrote: writing over it would drop the
   * changes made to it since
   */
  private async readUnchangedRows(jsonlPath: string): Promise<JsonObject[]> {
    const result = await JsonlReader.readSnapshot(jsonlPath);
    if (!result.ok && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw result.error;
    }
    const snapshot = result.ok ? result.value : { rows: ok<JsonObject[]>([]), contentHash: undefined };

    const knownHash = this.fileHashes.get(jsonlPath);
    if (knownHash !== undefined && snapshot.contentHash !== knownHash) {
      const conflictError = new Error(
        `JSONL file '${jsonlPath}' was changed after the database read it, so it was not overwritten. ` +
          `Create the database again and call initialize() to load the current file, then retry the write.`,
      ) as JsonlConflictError;
      conflictError.name = 'JsonlConflictError';
      conflictError.file = jsonlPath;
      throw conflictError;
    }

    return unwrap(snapshot.rows);
  }

  /**
   * Tell whether the files the tables were loaded from changed since this database last read or
   * wrote them: a JSONL file was edited, added or removed, or a table's schema file was edited, added
   * or removed. When they did, the database holds rows or a schema the files no longer have; create it
   * again and call initialize() to load the current files.
   */
  async hasExternalChanges(): Promise<Result<boolean, Error>> {
    try {
      return ok((await this.findExternalChangesInternal()).length > 0);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * The files that changed since this database last read or wrote them, as {@link hasExternalChanges}
   * tells: each JSONL file edited, added or removed, and each schema file edited, added or removed
   */
  async findExternalChanges(): Promise<Result<string[], Error>> {
    try {
      return ok(await this.findExternalChangesInternal());
    } catch (error) {
      return err(toError(error));
    }
  }

  private async findExternalChangesInternal(): Promise<string[]> {
    // A write-back still in flight has written its file before it records the file's hash
    await this.waitForPendingSyncs();
    const changed = new Set<string>();

    for (const [file, knownHash] of this.observedHashes) {
      const content = await readFile(file, 'utf-8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (content === undefined || hashJsonlContent(content) !== knownHash) changed.add(file);
    }

    const tables = await DirectoryScanner.scanDirectory(this.config.dataDir);
    const scanned = new Set(listJsonlFiles(tables));
    for (const file of this.scannedJsonlFiles) if (!scanned.has(file)) changed.add(file);
    for (const file of scanned) if (!this.scannedJsonlFiles.includes(file)) changed.add(file);

    for (const name of new Set([...this.schemaFileStates.keys(), ...tables.keys()])) {
      const knownState = this.schemaFileStates.get(name) ?? '';
      const config = tables.get(name);
      const state = config ? await this.schemaFileState(name, config) : await this.stateOfKnownSchemaFile(knownState);
      if (state !== knownState) changed.add((state || knownState).split('\0')[0]);
    }
    return [...changed];
  }

  /** The state of the schema file a state names, for a table whose JSONL file is gone */
  private async stateOfKnownSchemaFile(knownState: string): Promise<string> {
    if (!knownState) return '';
    const schemaPath = knownState.split('\0')[0];
    const content = await readFile(schemaPath, 'utf-8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    return content === undefined ? '' : `${schemaPath}\0${hashJsonlContent(content)}`;
  }

  private async schemaFileState(tableName: string, config: TableConfig): Promise<string> {
    if (config.validationSchema) return '';
    const schemaPath = await this.findTableSchemaFile(tableName, config);
    if (!schemaPath) return '';
    return `${schemaPath}\0${hashJsonlContent(await readFile(schemaPath, 'utf-8'))}`;
  }

  /**
   * Sync database changes back to JSONL files
   * Uses backward transformation when available
   * @param tableName Optional table name to sync. If not provided, syncs all loaded tables
   * @param options Optional sync options, e.g. the fields to write back
   */
  async sync(tableName?: string, options?: SyncOptions): Promise<Result<void, Error>> {
    try {
      await this.syncInternal(tableName, options);
      return ok(undefined);
    } catch (error) {
      return err(toError(error));
    }
  }

  private async syncInternal(tableName?: string, options?: SyncOptions): Promise<void> {
    this.assertWritable(tableName);
    if (this.inTransaction) {
      throw new Error(
        'sync() is not supported inside a transaction: the transaction writes back the tables it changed once it commits, and a file written earlier would keep rows it rolls back',
      );
    }

    if (tableName) {
      // Sync only the specified table
      if (!this.schemas.has(tableName)) {
        throw new Error(`Table '${tableName}' is not loaded`);
      }
      // The caller named both the table and the fields, so a field it does not have is a mistake
      await this.syncTable(tableName, { ...options, strictFields: options?.fields !== undefined });
    } else {
      // Sync all tables that are loaded (present in schemas map)
      for (const [name] of this.schemas) {
        await this.syncTable(name, options);
      }
    }
  }

  /**
   * Execute a function within a transaction
   * Automatically commits on success or rolls back on error.
   *
   * Note: `tx` (the argument `fn` receives) is the same Result-returning API as `this` - a failed
   * `tx.insert()`/`tx.update()`/etc. inside `fn` does not throw and therefore does not roll back the
   * transaction on its own. To abort on such a failure, check the Result and `throw result.error`
   * (or any error) from `fn`; only a thrown error rolls the transaction back.
   */
  async transaction<T>(fn: (tx: LinesDB<Tables>) => Promise<T> | T): Promise<Result<T, Error>> {
    if (this.inTransaction || this.transactionStarting) {
      return err(new Error('Nested transactions are not supported'));
    }
    // Not left to inTransaction: it is set only after the awaits below, which a second call could slip past
    this.transactionStarting = true;

    let fieldChangesBefore: Map<string, Map<string, FieldChanges>> | undefined;
    let rawSqlTablesBefore: Set<string> | undefined;
    let written: PreparedWriteBack[] = [];
    try {
      // Not beginning first: a pending auto-sync would then read, and write out, rows still uncommitted
      await this.waitForPendingSyncs();
      fieldChangesBefore = cloneFieldChanges(this.fieldChanges);
      rawSqlTablesBefore = new Set(this.rawSqlTables);
      this.db.exec('BEGIN TRANSACTION');
      this.inTransaction = true;
      this.transactionStarting = false;
      this.transactionChanges = new Set();

      const result = await fn(this);

      // Written back before COMMIT, so a failed write-back rolls the change back instead of leaving the
      // database holding rows its files do not; a read-only database has no changes to write back
      if (this.db.isTransaction() === false) {
        throw new Error('The transaction was ended by SQL run through getDb() before its files were written back');
      }
      if (!this.hasSeveralDataDirs()) {
        written = await this.writeBackTogether(this.tablesChangedInTransaction());
      }

      this.db.exec('COMMIT');
      this.inTransaction = false;
      this.transactionChanges = undefined;

      return ok(result);
    } catch (error) {
      this.transactionStarting = false;
      this.transactionChanges = undefined;
      if (fieldChangesBefore) this.fieldChanges = fieldChangesBefore;
      if (rawSqlTablesBefore) this.rawSqlTables = rawSqlTablesBefore;
      // Not only when writing a file fails: a COMMIT failing after the writes leaves files holding rolled-back rows
      const failure = await this.restoreAll(written, error);
      if (this.inTransaction) {
        try {
          this.db.exec('ROLLBACK');
        } catch (_rollbackError) {
          // Report the original error rather than a failure to roll back
        }
      }
      this.inTransaction = false;
      return err(toError(failure));
    }
  }

  /**
   * Wait for every queued sync to finish, so a fire-and-forget auto-sync is not dropped
   */
  private async waitForPendingSyncs(): Promise<void> {
    const awaited = new Set<Promise<void>>();
    // Queued promises never reject: syncTable stores them with their rejection swallowed
    let pending = Array.from(this.syncQueue.values());

    while (pending.length > 0) {
      for (const promise of pending) {
        awaited.add(promise);
      }
      await Promise.all(pending);
      pending = Array.from(this.syncQueue.values()).filter((promise) => !awaited.has(promise));
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<Result<void, Error>> {
    try {
      await this.waitForPendingSyncs();
      try {
        this.db.close();
      } catch (_error) {
        // Ignore errors if database is already closed
      }
      return ok(undefined);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Get the underlying SQLite database instance
   */
  getDb(): SQLiteDatabase {
    return this.db;
  }
}

function listJsonlFiles(tables: Map<string, TableConfig>): string[] {
  return Array.from(tables.values())
    .flatMap((config) => config.jsonlPaths ?? [config.jsonlPath])
    .sort();
}
