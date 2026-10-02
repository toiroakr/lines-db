import type { Issue, JsonObject, JsonValue, TableInfo, WriteError } from './types';
import type { toBatch } from './pending';

export interface TablesResponse {
  dataDir: string;
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

export async function fetchTables(): Promise<TablesResponse> {
  return readJson(await fetch('/api/tables'));
}

export interface SchemaResponse {
  file: string;
  source: string;
}

export async function fetchSchema(table: string): Promise<SchemaResponse> {
  return readJson(await fetch(`/api/tables/${encodeURIComponent(table)}/schema`));
}

export async function fetchRows(table: string): Promise<RowsResponse> {
  return readJson(await fetch(`/api/tables/${encodeURIComponent(table)}/rows`));
}

/** The rows of a table with failing rows that a save wrote but that still fail, by their index */
export interface SaveResult {
  stillFailing?: Array<{ index: number; issues: Issue[] }>;
}

export async function saveChanges(table: string, batch: ReturnType<typeof toBatch>): Promise<SaveResult> {
  return readJson<SaveResult>(
    await fetch(`/api/tables/${encodeURIComponent(table)}/changes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    }),
  );
}

export function keyOf(row: JsonObject, primaryKey: string): JsonValue {
  return row[primaryKey] ?? null;
}
