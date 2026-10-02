import type { Column, JsonValue } from './types';
import { readJsonc } from './json-ranges';

export type Parsed = { value: JsonValue } | { error: string };

export function isBoolean(column: Pick<Column, 'valueType'>): boolean {
  return column.valueType === 'boolean';
}

export function isNumber(column: Pick<Column, 'type' | 'valueType'>): boolean {
  return !isBoolean(column) && (column.type === 'INTEGER' || column.type === 'REAL');
}

/** The value typed into a cell's editor, read as the column's type */
export function parseInput(column: Pick<Column, 'type' | 'valueType'>, text: string): Parsed {
  if (isBoolean(column)) {
    return text === 'true' || text === 'false' ? { value: text === 'true' } : { error: 'Choose true or false' };
  }
  if (column.type === 'JSON') {
    const read = readJsonc(text);
    return 'error' in read ? { error: `Not valid JSON: ${read.error}` } : { value: read.value as JsonValue };
  }
  if (isNumber(column)) {
    const number = Number(text);
    return text.trim() === '' || !Number.isFinite(number) ? { error: 'Enter a number' } : { value: number };
  }
  return { value: text };
}

/** A value as a cell shows it */
export function formatValue(value: JsonValue | undefined): string {
  if (value === undefined) return '';
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** A value as its editor starts with it */
export function editableText(column: Pick<Column, 'type'>, value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (column.type === 'JSON') return JSON.stringify(value, null, 2);
  return String(value);
}
