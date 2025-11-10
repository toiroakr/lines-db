// Re-export StandardSchema types from official package
import type { StandardSchemaV1 } from '@standard-schema/spec';

export type Table = Record<string, unknown>;
export type StandardSchema<
  Input extends Table = Table,
  Output extends Table = Input,
> = StandardSchemaV1<Input, Output>;
export type StandardSchemaResult<Output> = StandardSchemaV1.Result<Output>;
export type StandardSchemaIssue = StandardSchemaV1.Issue;

// Export the official type as well
export type { StandardSchemaV1 };

// Type inference helpers for StandardSchema
// These work with any StandardSchema-compatible schema (Valibot, Zod, etc.)
export type InferInput<T> = T extends StandardSchemaV1<infer I, unknown> ? I : never;
export type InferOutput<T> = T extends StandardSchemaV1<unknown, infer O> ? O : never;

export interface ForeignKeyDefinition {
  column: string;
  references: {
    table: string;
    column: string;
  };
  onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

export interface IndexDefinition {
  name?: string;
  columns: string[];
  unique?: boolean;
}

export interface TableSchema {
  name: string;
  columns: ColumnDefinition[];
  foreignKeys?: ForeignKeyDefinition[];
  indexes?: IndexDefinition[];
}

export interface ColumnDefinition {
  name: string;
  type: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB' | 'NULL' | 'JSON';
  primaryKey?: boolean;
  notNull?: boolean;
  unique?: boolean;
  valueType?: 'boolean';
}

export type TableDefs = Record<string, Table>;
export declare const TABLES_BRAND: unique symbol;

export interface DatabaseConfig<_Tables extends TableDefs = TableDefs> {
  dataDir: string; // Directory containing JSONL files
  readonly [TABLES_BRAND]?: _Tables;
}

export type ExtractTables<Config> = Config extends {
  readonly [TABLES_BRAND]?: infer T;
}
  ? T extends TableDefs
    ? T
    : TableDefs
  : Config extends DatabaseConfig<infer T>
    ? T
    : TableDefs;

export interface TableConfig {
  jsonlPath: string;
  schema?: TableSchema;
  autoInferSchema?: boolean;
  validationSchema?: StandardSchema; // Optional validation schema
}

export interface ValidationError extends Error {
  name: 'ValidationError';
  issues: ReadonlyArray<StandardSchemaIssue>;
}

export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

// WHERE condition types for filtering
export type WhereValue<T> = T | ((value: T) => boolean);

export type WhereObject<T extends Table> = {
  [K in keyof T]?: WhereValue<T[K]>;
};

export type WhereCondition<T extends Table> =
  | WhereObject<T> // Single object with AND conditions
  | WhereConditionArray<T>; // Array with OR conditions

export type WhereConditionArray<T extends Table> = Array<WhereObject<T> | WhereConditionArray<T>>;
