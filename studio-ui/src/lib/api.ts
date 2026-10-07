import type { Issue, JsonObject, JsonValue, TableInfo, WriteError } from './types';
import type { toBatch } from './pending';
import { authorized } from './session';

export interface TablesResponse {
  dataDir: string;
  dataDirs?: string[];
  tables: TableInfo[];
  problems: string[];
}

export interface RowsResponse {
  rows: JsonObject[];
  defaulted: string[][];
  /** The issues of each row that fails validation, by its index */
  issues?: Record<string, Issue[]>;
  /** For a table with failing rows: the file its rows were read from, sent back with changes to it */
  revision?: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({ message: response.statusText }))) as T & { message?: string };
  if (!response.ok) throw { status: response.status, ...body } as WriteError;
  return body;
}

/** The error a request failed with, as the server answers one even when the request never reached it */
export function toWriteError(error: unknown): WriteError {
  if (typeof error === 'object' && error !== null && 'status' in error && 'message' in error)
    return error as WriteError;
  return { status: 0, message: error instanceof Error ? error.message : String(error) };
}

export async function fetchTables(): Promise<TablesResponse> {
  return readJson(await fetch('/api/tables', authorized()));
}

export interface ForeignKeyDefinition {
  column: string;
  references: { table: string; column: string };
  onDelete?: string;
  onUpdate?: string;
}

export interface IndexDefinition {
  name?: string;
  columns: string[];
  unique?: boolean;
}

/** What the schema file declares, as the server read it from the loaded table */
export interface DefinitionColumn {
  name: string;
  type: string;
  primaryKey?: boolean;
  unique?: boolean;
  /** Declared: the field may be left out of a row */
  optional?: boolean;
  /** Declared: the value may be null */
  nullable?: boolean;
  /** Inferred from the rows: every row has the field */
  notNull?: boolean;
}

export interface SchemaDefinition {
  /** Whether the columns are read from the schema's types, or inferred from the values in the rows */
  columnsFrom: 'schema' | 'rows';
  columns: DefinitionColumn[];
  foreignKeys: ForeignKeyDefinition[];
  indexes: IndexDefinition[];
}

export interface SchemaResponse {
  file: string;
  source: string;
  /** Null for a table with failing rows, which is not loaded */
  definition: SchemaDefinition | null;
}

export async function fetchSchema(table: string): Promise<SchemaResponse> {
  return readJson(await fetch(`/api/tables/${encodeURIComponent(table)}/schema`, authorized()));
}

export async function fetchRows(table: string): Promise<RowsResponse> {
  return readJson(await fetch(`/api/tables/${encodeURIComponent(table)}/rows`, authorized()));
}

/** The rows of a table with failing rows that a save wrote but that still fail, by their index */
export interface SaveResult {
  stillFailing?: Array<{ index: number; issues: Issue[] }>;
}

export async function saveChanges(table: string, batch: ReturnType<typeof toBatch>): Promise<SaveResult> {
  return readJson<SaveResult>(
    await fetch(
      `/api/tables/${encodeURIComponent(table)}/changes`,
      authorized({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch) }),
    ),
  );
}

export function keyOf(row: JsonObject, primaryKey: string): JsonValue {
  return row[primaryKey] ?? null;
}
