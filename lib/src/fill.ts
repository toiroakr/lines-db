import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Result, ok, err, toError } from './result.js';
import { hasBackward, type BiDirectionalSchema } from './schema.js';
import { findSchemaFile } from './schema-extensions.js';
import type { JsonObject, JsonValue, StandardSchema, Table } from './types.js';

/** Computes the values a row gets, from the row as its line holds it */
export type RowFiller = (row: JsonObject) => Record<string, unknown>;

export interface FillFieldsOptions {
  /** A data directory, or one `.jsonl` file in it */
  path: string;
  /** Fields to fill. Defaults to each table's primary key: `primaryKey` in its schema file, or `id` */
  fields?: readonly string[];
  /** Directory the `<Table>.schema.{ts,mts,cts}` files are looked up in. Defaults to the data directory */
  schemaDir?: string;
  /**
   * Builds the function that computes a table's row values from its schema module. Defaults to the
   * value its validation schema (the `schema` or default export) gives a row, after its backward
   * transformation; a row the schema rejects gains nothing. Throwing stops the fill before any file
   * is written.
   */
  loadFiller?: (schemaModule: Record<string, unknown>, context: { tableName: string; schemaPath: string }) => RowFiller;
}

export interface FilledFile {
  /** Name of the table, matching the JSONL file name */
  table: string;
  file: string;
  /** The fields written into at least one of its rows */
  fields: string[];
  /** How many rows gained a value */
  count: number;
}

export interface FillFieldsResult {
  filled: FilledFile[];
  /** Tables without a schema file, so nothing could compute their values */
  tablesWithoutSchema: string[];
  /** The 1-based lines of each file that are not JSON objects, so nothing was filled in there */
  unreadableLines: Array<{ file: string; lines: number[] }>;
  /** Fields to fill that no row of any table got a value for */
  unproducedFields: string[];
}

/** A JSONL line, kept as text so a line that gains nothing is written back verbatim */
interface Line {
  text: string;
  /** The separator after the line, kept so CRLF survives */
  eol: string;
  row: JsonObject | undefined;
}

/**
 * Fill the named fields into the rows of the JSONL files that have no value for them, with the values
 * each table computes for a row. A value already in the file is never replaced, and a line that gains
 * nothing is left byte for byte; a line that does gain a value is written with its keys in the order
 * the computed row lists them. Every value is computed before any file is written.
 */
export async function fillFields(options: FillFieldsOptions): Promise<Result<FillFieldsResult, Error>> {
  try {
    return ok(await fillFieldsInternal(options));
  } catch (error) {
    return err(toError(error));
  }
}

async function fillFieldsInternal(options: FillFieldsOptions): Promise<FillFieldsResult> {
  if (options.fields && options.fields.length === 0) {
    throw new Error('No fields to fill. Name at least one field.');
  }
  const { dataDir, tableNames } = await resolveTables(options.path);
  const schemaDir = options.schemaDir ?? dataDir;
  const loadFiller = options.loadFiller ?? fillerFromValidationSchema;

  const tablesWithoutSchema: string[] = [];
  const tables: Array<{ table: string; fields: readonly string[]; fill: RowFiller }> = [];
  for (const table of tableNames) {
    const schemaPath = await findSchemaFile(schemaDir, table);
    if (!schemaPath) {
      tablesWithoutSchema.push(table);
      continue;
    }
    const schemaModule = (await import(`${pathToFileURL(schemaPath).href}?t=${Date.now()}`)) as Record<string, unknown>;
    tables.push({
      table,
      fields: options.fields ?? [primaryKeyOf(schemaModule)],
      fill: loadFiller(schemaModule, { tableName: table, schemaPath }),
    });
  }

  const produced = new Set<string>();
  const unreadableLines: FillFieldsResult['unreadableLines'] = [];
  const filled: FilledFile[] = [];
  const writes: Array<{ file: string; content: string }> = [];
  for (const { table, fields, fill } of tables) {
    const file = join(dataDir, `${table}.jsonl`);
    const lines = splitLines(await readFile(file, 'utf-8'));
    const written = new Set<string>();
    const unreadable: number[] = [];
    let count = 0;

    lines.forEach((line, index) => {
      if (!line.row) {
        if (line.text.trim() !== '') unreadable.push(index + 1);
        return;
      }
      const computed = fill(line.row);
      const gained = fields.filter((field) => {
        if (isBlank(ownValue(computed, field))) return false;
        produced.add(field);
        return isBlank(ownValue(line.row!, field));
      });
      if (gained.length === 0) return;
      for (const field of gained) {
        setField(line.row, field, computed[field] as JsonValue);
        written.add(field);
      }
      line.text = serializeRow(line.row, Object.keys(computed));
      count += 1;
    });

    if (unreadable.length > 0) unreadableLines.push({ file, lines: unreadable });
    if (count === 0) continue;
    writes.push({ file, content: lines.map((line) => `${line.text}${line.eol}`).join('') });
    filled.push({ table, file, fields: [...written], count });
  }

  for (const { file, content } of writes) {
    await writeFile(file, content, 'utf-8');
  }

  const named = options.fields ?? [...new Set(tables.flatMap(({ fields }) => fields))];
  return {
    filled,
    tablesWithoutSchema,
    unreadableLines,
    unproducedFields: tableNames.length > 0 ? named.filter((field) => !produced.has(field)) : [],
  };
}

async function resolveTables(path: string): Promise<{ dataDir: string; tableNames: string[] }> {
  const stats = await stat(path);
  if (stats.isDirectory()) {
    const entries = await readdir(path);
    const tableNames = entries
      .filter((entry) => entry.endsWith('.jsonl'))
      .map((entry) => basename(entry, '.jsonl'))
      .sort();
    return { dataDir: path, tableNames };
  }
  if (stats.isFile() && path.endsWith('.jsonl')) {
    return { dataDir: dirname(path), tableNames: [basename(path, '.jsonl')] };
  }
  throw new Error(`Invalid path: ${path}. Must be a directory or .jsonl file.`);
}

function primaryKeyOf(schemaModule: Record<string, unknown>): string {
  const schema = (schemaModule.schema ?? schemaModule.default) as { primaryKey?: unknown } | undefined;
  const primaryKey = schema?.primaryKey ?? schemaModule.primaryKey;
  return typeof primaryKey === 'string' ? primaryKey : 'id';
}

function fillerFromValidationSchema(
  schemaModule: Record<string, unknown>,
  { schemaPath }: { schemaPath: string },
): RowFiller {
  const schema = (schemaModule.schema ?? schemaModule.default) as StandardSchema | undefined;
  if (!schema || typeof schema !== 'object' || !('~standard' in schema)) {
    throw new Error(`${schemaPath} does not export a StandardSchema as \`schema\` or as its default export`);
  }
  return (row) => {
    const result = schema['~standard'].validate(row);
    if (result instanceof Promise) {
      throw new Error(`${schemaPath}: asynchronous validation is not supported`);
    }
    if (result.issues) return {};
    return hasBackward(schema)
      ? ((schema as BiDirectionalSchema<Table, Table>).backward!(result.value) as Record<string, unknown>)
      : result.value;
  };
}

function ownValue(row: Record<string, unknown>, field: string): unknown {
  return Object.hasOwn(row, field) ? row[field] : undefined;
}

// Not `row[field] = value`: a field named `__proto__` would go through the inherited setter and leave
// no own property for the serializer to read back
function setField(row: JsonObject, field: string, value: JsonValue): void {
  Object.defineProperty(row, field, { value, enumerable: true, writable: true, configurable: true });
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  // A nested field the row never had can come back as an object of blank values, which fills nothing in
  return Object.values(value).every(isBlank);
}

function splitLines(content: string): Line[] {
  if (content === '') return [];
  return content.split('\n').map((raw, index, all) => {
    const carriage = raw.endsWith('\r') ? '\r' : '';
    const text = carriage ? raw.slice(0, -1) : raw;
    let row: JsonObject | undefined;
    if (text.trim() !== '') {
      try {
        const parsed: unknown = JSON.parse(text);
        row =
          parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : undefined;
      } catch {
        row = undefined;
      }
    }
    return { text, eol: index === all.length - 1 ? carriage : `${carriage}\n`, row };
  });
}

/** The row with its keys in the order the computed row lists them, and keys it does not list after those */
function serializeRow(row: JsonObject, fieldOrder: string[]): string {
  const rank = new Map(fieldOrder.map((field, index) => [field, index]));
  const rankOf = (key: string): number => rank.get(key) ?? fieldOrder.length;
  const ordered = Object.entries(row).sort(([a], [b]) => rankOf(a) - rankOf(b));
  const out: JsonObject = {};
  for (const [key, value] of ordered) setField(out, key, value);
  return JSON.stringify(out);
}
