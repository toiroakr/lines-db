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
  /** Whether the schema lets the field be null; unknown when not given */
  nullable?: boolean;
  /** Whether the schema lets the key be left out of a row, its value then left to the schema; unknown when not given */
  optional?: boolean;
  /**
   * What the schema takes of each object inside a JSON value, by its path there with list indexes as
   * `*`: `''` for the value itself, `items.*.name` for a key of each item
   */
  nested?: Record<string, NestedLeeway>;
}

/** What the schema takes of an object inside a JSON value: keys it does not name, and leaving a key out */
export interface NestedLeeway {
  open?: boolean;
  optional?: boolean;
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
  /** The foreign keys of the table: which column refers to which column of which table */
  references: Reference[];
}

export interface Reference {
  column: string;
  table: string;
  referencedColumn: string;
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
