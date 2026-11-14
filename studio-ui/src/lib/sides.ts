import type { Column, JsonObject, JsonValue } from './types';
import { isBoolean, isNumber } from './values';

/** Which side of a value a table shows: what the file holds, what the schema makes of it, or both */
export type ValueView = 'input' | 'output' | 'both';

/** The value a field holds in the file: the one on its line, or the row's own when the line lacks it */
export function inputOf(row: JsonObject, input: JsonObject | undefined, name: string): JsonValue | undefined {
  return input && Object.hasOwn(input, name) ? input[name] : row[name];
}

/** Whether the schema made the field something other than what the file holds */
export function differs(row: JsonObject, input: JsonObject | undefined, name: string): boolean {
  // Not null for a missing value: a field the schema removed differs from a null the line holds
  return canonical(inputOf(row, input, name)) !== canonical(row[name]);
}

/** The value as JSON text with object keys in order, so two objects with the same entries read the same */
function canonical(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

/** Whether the schema transformed any value of the rows, so that the two sides are worth choosing between */
export function hasTransformed(rows: JsonObject[], inputs: JsonObject[] | undefined): boolean {
  return rows.some((row, index) => {
    const input = inputs?.[index];
    // Not the row's fields alone: a field only the line holds is one the schema removed or renamed
    const names = new Set([...Object.keys(row), ...Object.keys(input ?? {})]);
    return [...names].some((name) => differs(row, input, name));
  });
}

export interface Shown {
  value: JsonValue | undefined;
  /** The output beside the input, when the view shows both and they differ */
  output?: JsonValue;
  /** Not editable: an output cannot be mapped back to the input that made it */
  readOnly: boolean;
}

/** What a field of a stored row shows under a view */
export function shownOf(row: JsonObject, input: JsonObject | undefined, name: string, view: ValueView): Shown {
  if (view === 'output') return { value: row[name], readOnly: true };
  const value = inputOf(row, input, name);
  return view === 'both' && differs(row, input, name) && row[name] !== undefined
    ? { value, output: row[name], readOnly: false }
    : { value, readOnly: false };
}

/** Whether a value is not of the type the editor of a column gives */
function strays(column: Column, value: JsonValue): boolean {
  if (column.type === 'JSON') return false;
  if (isBoolean(column)) return typeof value !== 'boolean';
  if (isNumber(column)) return typeof value !== 'number';
  return column.type === 'TEXT' && typeof value !== 'string';
}

/**
 * The column as its input side is typed. The column is typed by what the schema makes of a value, and the lines
 * may hold another: `"yes"` for a field the schema makes a boolean. Such a column is edited as text, or as JSON when
 * the lines hold more than strings, so that what the schema takes can be typed
 */
export function inputColumn(column: Column, rows: JsonObject[], inputs: JsonObject[] | undefined): Column {
  if (!inputs) return column;
  // Not the value the schema filled in for a line without one: that is an output, and says nothing of the input type
  const held = rows
    .map((_row, index) => inputs[index]?.[column.name])
    .filter((value): value is JsonValue => value !== undefined && value !== null);
  if (!held.some((value) => strays(column, value))) return column;
  const { valueType: _valueType, ...rest } = column;
  // Not text when some values are not strings: a text editor would turn the number 31 into the string "31"
  return { ...rest, type: held.every((value) => typeof value === 'string') ? 'TEXT' : 'JSON' };
}

/**
 * The columns of the Input view: the table's, typed by the input side, and those only the lines hold, which the schema
 * renames or removes (`legacy_name` of a line the schema makes `name` of). A column no line holds and the schema does
 * not fill in is one the schema makes from others, so it is marked as such rather than offered as an input
 */
export function inputSideColumns(
  columns: Column[],
  rows: JsonObject[],
  inputs: JsonObject[] | undefined,
  defaulted: string[][],
): Column[] {
  const typed = columns.map((column) => inputColumn(column, rows, inputs));
  if (!inputs || rows.length === 0) return typed;
  const known = new Set(columns.map((column) => column.name));
  const madeBySchema = (name: string) =>
    rows.every((_row, index) => !Object.hasOwn(inputs[index] ?? {}, name) && !(defaulted[index] ?? []).includes(name));
  const lineOnly = [...new Set(inputs.flatMap((input) => Object.keys(input ?? {})))].filter((name) => !known.has(name));
  return [
    ...typed.map((column) =>
      !column.primaryKey && madeBySchema(column.name) ? { ...column, outputOnly: true } : column,
    ),
    ...lineOnly.map((name): Column => ({
      name,
      type: inputs.every(
        (input) => input?.[name] === undefined || input[name] === null || typeof input[name] === 'string',
      )
        ? 'TEXT'
        : 'JSON',
      inputOnly: true,
    })),
  ];
}
