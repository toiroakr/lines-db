export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface Column {
  name: string;
  type: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB' | 'NULL' | 'JSON' | string;
  primaryKey?: boolean;
  notNull?: boolean;
  valueType?: 'boolean';
}

export interface TableInfo {
  name: string;
  columns: Column[];
  primaryKey: string | null;
  rowCount: number;
  readOnlyReason: string | null;
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
