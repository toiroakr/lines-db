export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface Column {
  name: string;
  type: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB' | 'NULL' | 'JSON' | string;
  primaryKey?: boolean;
  notNull?: boolean;
  valueType?: 'boolean';
  /** A field the schema refuses as a key, in a table with failing rows: a fix can only remove it */
  unknown?: boolean;
}

export interface TableInfo {
  name: string;
  columns: Column[];
  primaryKey: string | null;
  rowCount: number;
  /**
   * How many rows fail validation. Such a table is not loaded, and its rows are edited in the file by
   * their index there, with adding and deleting rows off until they pass
   */
  invalidRows: number;
  readOnlyReason: string | null;
  /** The name of the table's schema file in the data directory, or null when it has none */
  schemaFile: string | null;
}

export interface Issue {
  message: string;
  path?: Array<PropertyKey | { key: PropertyKey }>;
}

export interface FailedChange {
  kind: 'insert' | 'update' | 'delete';
  index: number;
  key?: JsonValue;
}

export interface WriteError {
  status: number;
  message: string;
  issues?: Issue[];
  change?: FailedChange;
}
