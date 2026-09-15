import { readFile } from 'node:fs/promises';
import { normalize } from 'node:path';
import type { JsonObject, ColumnDefinition, TableSchema, JsonlParseError } from './types.js';
import { type Result, ok, err, toError } from './result.js';

export class JsonlReader {
  private static overrides: Map<string, JsonObject[]> | null = null;

  /**
   * Temporarily override the data returned for specific JSONL files.
   * Useful for scenarios like migration validation where in-memory data should be used.
   */
  static async withOverrides<T>(overrides: Map<string, JsonObject[]>, fn: () => Promise<T>): Promise<T> {
    const normalized = new Map<string, JsonObject[]>();
    for (const [filePath, rows] of overrides) {
      normalized.set(normalize(filePath), rows);
    }

    const previousOverrides = this.overrides;
    this.overrides = normalized;

    try {
      return await fn();
    } finally {
      this.overrides = previousOverrides;
    }
  }

  /**
   * Read JSONL file and parse each line as JSON
   */
  static async read(filePath: string): Promise<Result<JsonObject[], JsonlParseError | Error>> {
    const overrideRows = this.overrides?.get(normalize(filePath));
    if (overrideRows) {
      // Return clones to avoid accidental mutations from consumers
      return ok(overrideRows.map((row) => JSON.parse(JSON.stringify(row)) as JsonObject));
    }

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch (error) {
      return err(toError(error));
    }

    const rawLines = (content.startsWith('\u{feff}') ? content.slice(1) : content).split('\n');

    const rows: JsonObject[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i].endsWith('\r') ? rawLines[i].slice(0, -1) : rawLines[i];
      if (line.trim().length === 0) continue;

      try {
        rows.push(JSON.parse(line) as JsonObject);
      } catch (error) {
        const parseError = new Error(`Failed to parse JSON line: ${line}`, { cause: error }) as JsonlParseError;
        parseError.name = 'JsonlParseError';
        parseError.file = filePath;
        parseError.line = i + 1;
        return err(parseError);
      }
    }

    return ok(rows);
  }

  /**
   * Infer schema from JSONL data
   */
  static inferSchema(tableName: string, data: JsonObject[]): Result<TableSchema, Error> {
    if (data.length === 0) {
      return err(new Error('Cannot infer schema from empty data'));
    }

    const columnTypes = new Map<string, Set<string>>();
    const booleanColumns = new Set<string>();
    const nonBooleanColumns = new Set<string>();

    // Collect all column names and their types
    for (const row of data) {
      for (const [key, value] of Object.entries(row)) {
        if (!columnTypes.has(key)) {
          columnTypes.set(key, new Set());
        }
        columnTypes.get(key)!.add(this.inferType(value));

        if (typeof value === 'boolean') {
          booleanColumns.add(key);
        } else if (value !== null) {
          nonBooleanColumns.add(key);
        }
      }
    }

    // Convert to column definitions
    const columns: ColumnDefinition[] = [];
    for (const [columnName, types] of columnTypes.entries()) {
      const typeArray = Array.from(types);

      // If multiple types exist, prefer TEXT as a safe fallback
      let sqlType: ColumnDefinition['type'] = 'TEXT';

      if (typeArray.length === 1) {
        sqlType = typeArray[0] as ColumnDefinition['type'];
      } else if (typeArray.every((t) => t === 'INTEGER' || t === 'REAL')) {
        sqlType = 'REAL'; // Use REAL if we have mixed numeric types
      } else if (!typeArray.includes('NULL')) {
        // If there are multiple non-null types, use TEXT
        sqlType = 'TEXT';
      } else if (typeArray.length === 2 && typeArray.includes('NULL')) {
        // If one type + NULL, use the non-null type
        sqlType = typeArray.find((t) => t !== 'NULL') as ColumnDefinition['type'];
      }

      const isBooleanColumn = booleanColumns.has(columnName) && !nonBooleanColumns.has(columnName);

      columns.push({
        name: columnName,
        type: sqlType,
        notNull: !typeArray.includes('NULL'),
        valueType: isBooleanColumn ? 'boolean' : undefined,
      });
    }

    // If there's an 'id' column, make it primary key
    const idColumn = columns.find((col) => col.name === 'id');
    if (idColumn) {
      idColumn.primaryKey = true;
    }

    return ok({
      name: tableName,
      columns,
    });
  }

  private static inferType(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'INTEGER' : 'REAL';
    }
    if (typeof value === 'string') return 'TEXT';
    if (typeof value === 'boolean') return 'INTEGER'; // SQLite stores booleans as integers
    if (typeof value === 'object') return 'JSON'; // Store objects/arrays as JSON
    return 'TEXT';
  }
}
